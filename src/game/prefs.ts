/** Player preferences, persisted in localStorage (not match state). */

import { touchFirstDevice } from './inputCapabilities';

/** Outer world / forests / terrain detail ('off' also disables all weather FX). */
export type SceneryQuality = 'ultra' | 'high' | 'medium' | 'low' | 'off';
/** Battlefield ground texture + sand / blood / scorch wear. */
export type GroundEffectsQuality = 'high' | 'medium' | 'low' | 'off';
/** Combat fire VFX density (visual only — never affects sim). */
export type FireVfxQuality = 'high' | 'medium' | 'low' | 'off';

/**
 * Fire VFX tiers (for tuning):
 *
 * | tier   | tongues (max) | fill rule | extras |
 * |--------|---------------|-----------|--------|
 * | off    | — | tint only | — |
 * | low    | — | particles | light sparks |
 * | medium | 1024 | **1+ tongue per fire cell** (extras if budget allows) | smoke |
 * | high   | 2048 | same, denser extras on small blazes | heavy + smoke |
 *
 * Coverage comes first: every burning hazard cell gets a billboard whenever
 * cell count ≤ maxTongues (typical oil spills fit). Only pathological mega-blazes
 * thin cells, and then tongues widen to close gaps.
 * Sim oil/fire hitboxes are always the same — quality is visual only.
 */

export interface Prefs {
    /** show the in-match (combat) chat at all: bar, bubbles, messages */
    combatChat: boolean;
    /** show the global chat panel in the main menu */
    globalChat: boolean;
    /**
     * Outer world quality. Applies immediately (rebuilds scenery mid-match).
     * - ultra: wall of trees just past the board edge (still instanced)
     * - high: dense forests outside the board
     * - medium: standard mountains / lakes / forests (former "full")
     * - low: flat board + flat green world, no decoration
     */
    scenery: SceneryQuality;
    /**
     * Cosmetic ground wear (sand footprints, blood, scorch). Does not gate
     * oil/fire puddles — those are always drawn (gameplay-relevant).
     * - high: footprints + blood + scorch, ~12 Hz mask upload
     * - medium: footprints + scorch, lighter / slower updates
     * - low / off: no wear mask work
     */
    groundEffects: GroundEffectsQuality;
    /** Optional fire VFX on top of always-on oil/fire ground tint (see FireVfxQuality). */
    fireVfx: FireVfxQuality;
    /**
     * Cap on `devicePixelRatio` for the WebGL canvas.
     * 2 = current default (retina), 1.5 = medium, 1 = 1:1 CSS pixels.
     */
    dprCap: 2 | 1.5 | 1;
    /**
     * Sun shadow quality (visual only).
     * - off: no shadows
     * - low: blob discs under units (no shadow-map pass)
     * - medium: 1024 hard map, structures only
     * - high: 2048 soft map, all units
     * - ultra: up to 4096 soft map, all units, wider penumbra
     */
    shadows: ShadowQuality;
    /** When false, dead/wrecked mechs are not drawn (still revive next round). */
    renderDeadUnits: boolean;
    /**
     * MSAA on the 3D canvas. Read once at renderer creation, so a change
     * takes effect with the next match (mobile tile GPUs pay a real cost).
     */
    antialias: boolean;
    /**
     * Player-chosen control scheme override.
     * 'auto' follows the live-detected input method (see game/inputCapabilities.ts);
     * the others pin the HUD/camera/placement input language regardless of
     * what device last generated an event.
     */
    controlScheme: ControlScheme;
    /**
     * One-shot flag: a touch-first device was dropped to the low preset once
     * (phones crash on desktop-grade settings). Never downgrades again, so
     * the user's own choices stick.
     */
    mobileTuned: boolean;
}

export type ControlScheme = 'auto' | 'mouse' | 'touch' | 'gamepad';

/** Sun shadow map quality (visual only). */
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';

/** One-click graphics bundles (common game pattern: Low → Ultra). */
export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export type GraphicsPresetValues = Pick<
    Prefs,
    'scenery' | 'groundEffects' | 'fireVfx' | 'dprCap' | 'shadows' | 'renderDeadUnits' | 'antialias'
>;

export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsPresetValues> = {
    low: {
        scenery: 'low',
        groundEffects: 'low',
        fireVfx: 'low',
        dprCap: 1,
        shadows: 'low',
        renderDeadUnits: false,
        antialias: false,
    },
    medium: {
        scenery: 'medium',
        groundEffects: 'medium',
        fireVfx: 'medium',
        dprCap: 1.5,
        shadows: 'medium',
        renderDeadUnits: false,
        antialias: false,
    },
    high: {
        scenery: 'high',
        groundEffects: 'high',
        fireVfx: 'medium',
        dprCap: 2,
        shadows: 'high',
        renderDeadUnits: true,
        antialias: true,
    },
    ultra: {
        scenery: 'ultra',
        groundEffects: 'high',
        fireVfx: 'high',
        dprCap: 2,
        shadows: 'ultra',
        renderDeadUnits: true,
        antialias: true,
    },
};

/** Returns the matching preset, or null when the user has mixed custom values. */
export function detectGraphicsPreset(p: Prefs = prefs()): GraphicsPreset | null {
    for (const id of ['low', 'medium', 'high', 'ultra'] as const) {
        const v = GRAPHICS_PRESETS[id];
        if (
            p.scenery === v.scenery &&
            p.groundEffects === v.groundEffects &&
            p.fireVfx === v.fireVfx &&
            p.dprCap === v.dprCap &&
            p.shadows === v.shadows &&
            p.renderDeadUnits === v.renderDeadUnits &&
            p.antialias === v.antialias
        ) {
            return id;
        }
    }
    return null;
}

export function applyGraphicsPreset(preset: GraphicsPreset): void {
    updatePrefs(GRAPHICS_PRESETS[preset]);
}

const KEY = 'mechili-prefs';
const DEFAULTS: Prefs = {
    combatChat: true,
    globalChat: true,
    scenery: 'medium',
    groundEffects: 'high',
    fireVfx: 'medium',
    dprCap: 2,
    shadows: 'high',
    renderDeadUnits: true,
    antialias: true,
    controlScheme: 'auto',
    mobileTuned: false,
};

let cached: Prefs | null = null;
const listeners: (() => void)[] = [];

function migrateScenery(raw: unknown): SceneryQuality {
    if (raw === 'ultra' || raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'off') {
        return raw;
    }
    if (raw === 'full') return 'medium'; // former default look
    if (raw === 'minimal') return 'low';
    return DEFAULTS.scenery;
}

function migrateGroundEffects(raw: unknown): GroundEffectsQuality {
    if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'off') return raw;
    if (raw === 'ultra' || raw === 'full') return 'high'; // former top tier names
    return DEFAULTS.groundEffects;
}

function migrateFireVfx(raw: unknown): FireVfxQuality {
    if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'off') return raw;
    if (raw === 'ultra') return 'high'; // former top tier name
    return DEFAULTS.fireVfx;
}

function migrateShadowQuality(raw: unknown): ShadowQuality {
    if (raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'ultra') {
        return raw;
    }
    if (raw === 'structures') return 'low';
    if (raw === 'all') return 'high';
    return DEFAULTS.shadows;
}

function normalizePrefs(p: Prefs & { unitShadows?: unknown }): Prefs {
    p.scenery = migrateScenery(p.scenery);
    p.groundEffects = migrateGroundEffects(p.groundEffects);
    p.fireVfx = migrateFireVfx(p.fireVfx);
    if (p.shadows === undefined && p.unitShadows !== undefined) {
        p.shadows = migrateShadowQuality(p.unitShadows);
    }
    p.shadows = migrateShadowQuality(p.shadows);
    delete p.unitShadows;
    if (
        p.fireVfx !== 'high' &&
        p.fireVfx !== 'medium' &&
        p.fireVfx !== 'low' &&
        p.fireVfx !== 'off'
    ) {
        p.fireVfx = DEFAULTS.fireVfx;
    }
    if (p.dprCap !== 2 && p.dprCap !== 1.5 && p.dprCap !== 1) p.dprCap = 2;
    if (
        p.shadows !== 'off' &&
        p.shadows !== 'low' &&
        p.shadows !== 'medium' &&
        p.shadows !== 'high' &&
        p.shadows !== 'ultra'
    ) {
        p.shadows = DEFAULTS.shadows;
    }
    if (typeof p.renderDeadUnits !== 'boolean') p.renderDeadUnits = true;
    if (typeof p.antialias !== 'boolean') p.antialias = DEFAULTS.antialias;
    if (typeof p.mobileTuned !== 'boolean') p.mobileTuned = false;
    if (
        p.controlScheme !== 'auto' &&
        p.controlScheme !== 'mouse' &&
        p.controlScheme !== 'touch' &&
        p.controlScheme !== 'gamepad'
    ) {
        p.controlScheme = DEFAULTS.controlScheme;
    }
    return p;
}

/** True when mountains / forests / textured ground are enabled. */
export function sceneryDetailed(quality: SceneryQuality = prefs().scenery): boolean {
    return quality !== 'low' && quality !== 'off';
}

/** True when the weather system runs (fog, clouds, rain, stars, day/night). */
export function sceneryWeatherFx(quality: SceneryQuality = prefs().scenery): boolean {
    return quality !== 'off';
}

/** Shadow-map edge length for the current scenery tier (upper cap for shadows). */
export function sceneryShadowMapSize(quality: SceneryQuality = prefs().scenery): number {
    if (quality === 'ultra' || quality === 'high') return 4096;
    if (quality === 'medium') return 2048;
    return 1024;
}

/** Effective sun shadow-map resolution for a shadow tier + scenery cap. */
export function shadowMapSize(
    tier: ShadowQuality = prefs().shadows,
    scenery: SceneryQuality = prefs().scenery,
): number {
    const cap = sceneryShadowMapSize(scenery);
    switch (tier) {
        case 'medium':
            return Math.min(1024, cap);
        case 'high':
            return Math.min(2048, cap);
        case 'ultra':
            return cap;
        default:
            return 512;
    }
}

/** True when units get cheap ground discs (low: all units; medium: units the
 *  shadow map skips — only structures cast there). */
export function shadowUsesBlobs(tier: ShadowQuality = prefs().shadows): boolean {
    return tier === 'low' || tier === 'medium';
}

/** True when the directional-light shadow map is rendered. */
export function shadowUsesMap(tier: ShadowQuality = prefs().shadows): boolean {
    return tier === 'medium' || tier === 'high' || tier === 'ultra';
}

/** PCF soft penumbra radius (high / ultra only). */
export function shadowSoftRadius(tier: ShadowQuality = prefs().shadows): number {
    return tier === 'ultra' ? 4 : 2;
}

/** Shadow-map refresh stride — medium updates every other frame to save GPU. */
export function shadowUpdateStride(tier: ShadowQuality = prefs().shadows): number {
    return tier === 'medium' ? 2 : 1;
}

/**
 * Camera far plane — outer meadow is 3000 across; high/ultra must see the
 * full mountain ring without hard clip.
 */
export function sceneryCameraFar(quality: SceneryQuality = prefs().scenery): number {
    if (quality === 'ultra' || quality === 'high') return 4800;
    if (quality === 'medium') return 2800;
    return 1400;
}

/**
 * Multiplier on weather fog distances so high/ultra haze doesn't eat mountains.
 */
export function sceneryFogScale(quality: SceneryQuality = prefs().scenery): number {
    if (quality === 'ultra' || quality === 'high') return 1.9;
    if (quality === 'medium') return 1.2;
    return 1;
}

/**
 * Strength of the ground-mist height fog (0 disables it entirely) and of the
 * forest fog cards.
 */
export function sceneryHeightFog(quality: SceneryQuality = prefs().scenery): number {
    if (quality === 'ultra') return 1.15;
    if (quality === 'high') return 1;
    if (quality === 'medium') return 0.55;
    return 0;
}

/** Preset whose pre-antialias fields match — for stored prefs that predate the antialias field. */
function legacyPresetOf(p: Prefs): GraphicsPreset | null {
    for (const id of ['low', 'medium', 'high', 'ultra'] as const) {
        const v = GRAPHICS_PRESETS[id];
        if (
            p.scenery === v.scenery &&
            p.groundEffects === v.groundEffects &&
            p.fireVfx === v.fireVfx &&
            p.dprCap === v.dprCap &&
            p.shadows === v.shadows &&
            p.renderDeadUnits === v.renderDeadUnits
        ) {
            return id;
        }
    }
    return null;
}

export function prefs(): Prefs {
    if (!cached) {
        cached = { ...DEFAULTS };
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const stored = JSON.parse(raw) as Partial<Prefs> & {
                    muteChat?: boolean;
                    scenery?: unknown;
                    unitShadows?: unknown;
                };
                Object.assign(cached, stored);
                cached.scenery = migrateScenery(stored.scenery);
                cached.groundEffects = migrateGroundEffects(stored.groundEffects);
                cached.fireVfx = migrateFireVfx(stored.fireVfx);
                if (stored.shadows === undefined && stored.unitShadows !== undefined) {
                    cached.shadows = migrateShadowQuality(stored.unitShadows);
                }
                // migrate the old "mute opponent chat" flag
                if (stored.muteChat !== undefined && stored.combatChat === undefined) {
                    cached.combatChat = !stored.muteChat;
                }
                // prefs saved before the antialias field: keep the user's
                // preset intact if they were on one, otherwise stay smooth
                if (stored.antialias === undefined) {
                    const legacy = legacyPresetOf(cached);
                    if (legacy) cached.antialias = GRAPHICS_PRESETS[legacy].antialias;
                }
            }
        } catch {
            /* private browsing */
        }
        // phones/tablets get the low preset once — first run, and also for
        // prefs stored back when only desktop-grade settings existed
        if (touchFirstDevice() && !cached.mobileTuned) {
            Object.assign(cached, GRAPHICS_PRESETS.low);
            cached.mobileTuned = true;
        }
        normalizePrefs(cached);
    }
    return cached;
}

export function updatePrefs(patch: Partial<Prefs>): void {
    Object.assign(prefs(), patch);
    normalizePrefs(prefs());
    try {
        localStorage.setItem(KEY, JSON.stringify(prefs()));
    } catch {
        /* ignore */
    }
    for (const listener of [...listeners]) listener();
}

/** notified after every change; returns the unsubscribe function */
export function onPrefsChange(listener: () => void): () => void {
    listeners.push(listener);
    return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
    };
}

/** Effective WebGL pixel ratio from the current pref + device. */
export function effectiveDpr(): number {
    return Math.min(window.devicePixelRatio || 1, prefs().dprCap);
}
