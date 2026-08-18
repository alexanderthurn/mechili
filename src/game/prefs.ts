/** Player preferences, persisted in localStorage (not match state). */

import { steam } from 'steam-electron-build/native';

import { probeHardware, type HardwareProbe } from './hardwareTier';
import { touchFirstDevice } from './inputCapabilities';
import type { UiFontId } from '../theme';
import { isUserStorageKey } from './userStorage';

/** Outer world / forests / terrain detail ('off' also disables all weather FX). */
export type SceneryQuality = 'ultra' | 'high' | 'medium' | 'low' | 'off';
/** Battlefield ground texture + sand / blood / scorch wear. */
export type GroundEffectsQuality = 'high' | 'medium' | 'low' | 'off';
/** Combat fire VFX density (visual only — never affects sim). */
export type FireVfxQuality = 'high' | 'medium' | 'low' | 'off';
/** Blood spray / gib particle volume (visual only; ground stains are groundEffects). */
export type BloodFxQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';

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
    /**
     * Outer world quality. Applies immediately (rebuilds scenery mid-match).
     * - ultra: wall of trees just past the board edge (still instanced)
     * - high: dense forests outside the board + Tripo near board
     * - medium: billboard forest (no low-poly cones; no tree blob shadows)
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
     * Blood spray / gib particle volume (visual only). Ground blood stains are
     * governed by {@link groundEffects}; this only scales the airborne gore.
     * - off: no blood particles
     * - low → ultra: rising particle counts; ultra throws full fountains
     */
    bloodFx: BloodFxQuality;
    /**
     * Cap on `devicePixelRatio` for the WebGL canvas.
     * 2 = current default (retina), 1.5 = medium, 1 = 1:1 CSS pixels.
     */
    /**
     * 3D/Pixi render resolution as a fraction of the display's own pixels:
     * effectiveDpr = devicePixelRatio × renderScale. A fraction rather than a
     * devicePixelRatio cap so it means the same thing on every monitor, and so
     * the UI-size zoom cannot change it (zoom moves devicePixelRatio and the CSS
     * viewport in opposite directions, which cancels out here but not for a cap).
     */
    renderScale: 1 | 0.75 | 0.5 | 0.33;
    /** In-match debug overlay (FPS, timings, sync state). Was ?debug only. */
    debugOverlay: boolean;
    /** HTML UI zoom multiplier on top of the automatic high-DPI factor (Electron only). */
    uiScale: 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
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
    /** UI typeface — Cinzel / Exo 2 / Marcellus (live-switched via --font-ui). Default: Marcellus. */
    uiFont: UiFontId;
    /**
     * How Matchmaking / Custom host finds opponents.
     * steam / matchmaking / lan — only that path (fails clearly if unavailable).
     */
    multiplayerTransport: 'steam' | 'matchmaking' | 'lan';
    /**
     * True once the player picks a connection themselves. Until then the boot
     * check is free to move off an unavailable default — a stored value nobody
     * chose is a guess, and stranding someone on "Steam" because Steam was not
     * running at first launch is worse than quietly using what works.
     */
    transportChosen: boolean;
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
    'scenery' | 'groundEffects' | 'fireVfx' | 'bloodFx' | 'renderScale' | 'shadows' | 'renderDeadUnits' | 'antialias'
>;

export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsPresetValues> = {
    low: {
        scenery: 'low',
        groundEffects: 'low',
        fireVfx: 'low',
        bloodFx: 'low',
        renderScale: 0.5,
        shadows: 'low',
        renderDeadUnits: false,
        antialias: false,
    },
    medium: {
        scenery: 'medium',
        groundEffects: 'medium',
        fireVfx: 'medium',
        bloodFx: 'medium',
        renderScale: 0.75,
        shadows: 'medium',
        renderDeadUnits: false,
        antialias: false,
    },
    high: {
        scenery: 'high',
        groundEffects: 'high',
        fireVfx: 'medium',
        bloodFx: 'high',
        renderScale: 1,
        shadows: 'high',
        renderDeadUnits: true,
        antialias: true,
    },
    ultra: {
        scenery: 'ultra',
        groundEffects: 'high',
        fireVfx: 'high',
        bloodFx: 'ultra',
        renderScale: 1,
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
            p.bloodFx === v.bloodFx &&
            p.renderScale === v.renderScale &&
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

/** What the first-run probe decided, or null when prefs were already stored.
 *  Surfaced for the debug overlay and for answering "why does it look like
 *  that on my machine". */
let lastHardwareProbe: HardwareProbe | null = null;
export function hardwareProbe(): HardwareProbe | null {
    return lastHardwareProbe;
}
const DEFAULTS: Prefs = {
    combatChat: true,
    ...GRAPHICS_PRESETS.high,
    controlScheme: 'auto',
    uiFont: 'marcellus',
    uiScale: 1,
    debugOverlay: false,
    // Steam builds default to Steam lobbies, the browser to the web backend.
    // Read once at load: the preload defines window.steam before any renderer
    // code runs, and resolveMultiplayerTransport never silently falls back, so
    // a wrong default here strands the player rather than degrading.
    multiplayerTransport: steam.isAvailable() ? 'steam' : 'matchmaking',
    transportChosen: false,
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

function migrateBloodFx(raw: unknown): BloodFxQuality {
    if (raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'ultra') {
        return raw;
    }
    return DEFAULTS.bloodFx;
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
    p.bloodFx = migrateBloodFx(p.bloodFx);
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
    // dprCap capped devicePixelRatio; renderScale is a fraction of it. The map is
    // approximate by nature — a cap of 1 meant native on a 1x monitor but half on
    // a retina one — so aim for "looks about the same on a HiDPI display".
    const legacyCap = (p as Prefs & { dprCap?: number }).dprCap;
    if (p.renderScale === undefined && typeof legacyCap === 'number') {
        p.renderScale = legacyCap >= 2 ? 1 : legacyCap >= 1.5 ? 0.75 : legacyCap >= 0.75 ? 0.5 : 0.33;
    }
    delete (p as Prefs & { dprCap?: number }).dprCap;
    if (![1, 0.75, 0.5, 0.33].includes(p.renderScale)) p.renderScale = DEFAULTS.renderScale;
    if (![0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].includes(p.uiScale)) p.uiScale = DEFAULTS.uiScale;
    if (typeof p.debugOverlay !== 'boolean') p.debugOverlay = DEFAULTS.debugOverlay;
    if (typeof p.transportChosen !== 'boolean') p.transportChosen = DEFAULTS.transportChosen;
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
    if (p.uiFont !== 'cinzel' && p.uiFont !== 'exo2' && p.uiFont !== 'marcellus') {
        p.uiFont = DEFAULTS.uiFont;
    }
    // Former 'auto' pref → concrete Web path (no silent transport picking).
    if ((p.multiplayerTransport as string) === 'auto') {
        p.multiplayerTransport = 'matchmaking';
    }
    if (
        p.multiplayerTransport !== 'steam' &&
        p.multiplayerTransport !== 'matchmaking' &&
        p.multiplayerTransport !== 'lan'
    ) {
        p.multiplayerTransport = DEFAULTS.multiplayerTransport;
    }
    return p;
}

/** True when mountains / forests / textured ground are enabled. */
export function sceneryDetailed(quality: SceneryQuality = prefs().scenery): boolean {
    return quality !== 'low' && quality !== 'off';
}

/**
 * Multiplier on blood-particle counts for the current setting. 0 = off (no
 * blood particles). Ultra throws full fountains; low keeps it sparse.
 */
export function bloodParticleScale(quality: BloodFxQuality = prefs().bloodFx): number {
    switch (quality) {
        case 'off':
            return 0;
        case 'low':
            return 0.4;
        case 'medium':
            return 0.75;
        case 'high':
            return 1.3;
        case 'ultra':
            return 4.8;
    }
}

/**
 * Energy multiplier on blood spray — scales launch speed, upward throw, and
 * random spread together. Lower tiers keep blood low and tight (a subdued
 * spatter); high and ultra let it fountain up and fan out.
 */
export function bloodIntensityScale(quality: BloodFxQuality = prefs().bloodFx): number {
    switch (quality) {
        case 'off':
        case 'low':
            return 0.45;
        case 'medium':
            return 0.7;
        case 'high':
        case 'ultra':
            return 1;
    }
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
            p.bloodFx === v.bloodFx &&
            p.renderScale === v.renderScale &&
            p.shadows === v.shadows &&
            p.renderDeadUnits === v.renderDeadUnits
        ) {
            return id;
        }
    }
    return null;
}

/**
 * Per-key sanitising for whatever the save file happens to contain.
 *
 * Deliberately LENIENT: the goal is that a setting is never lost to a
 * recoverable difference, and never crashes the game either way. A number that
 * arrived as a string is still that number; a value from a build with finer
 * steps than this one clamps to the nearest step we do have, rather than
 * snapping back to the default and throwing the player's choice away. Only a
 * genuinely unusable value — null, NaN, an object where a scalar belongs, a
 * word matching no option — falls back.
 *
 * Returning `undefined` means "keep the default". A key with no entry here is
 * ignored entirely, so forgetting to add one for a NEW setting fails safe:
 * the default stands instead of an unchecked value being adopted.
 *
 * Runs AFTER the migrations below, on their output — validating first would
 * discard the very shapes they exist to rescue.
 */
type Sanitizer = (v: unknown) => unknown;

function asBool(v: unknown): boolean | undefined {
    if (typeof v === 'boolean') return v;
    // tolerate the shapes JSON round-trips and hand-edits produce
    if (v === 'true' || v === 1) return true;
    if (v === 'false' || v === 0) return false;
    return undefined;
}

/** nearest allowed number — a finer step from a newer build lands next door */
function asNearest(allowed: readonly number[]): Sanitizer {
    return (v) => {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        if (!Number.isFinite(n)) return undefined;
        return allowed.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best));
    };
}

/** one of a fixed set of words, matched loosely (case, stray whitespace) */
function asWord(allowed: readonly string[]): Sanitizer {
    return (v) => {
        if (typeof v !== 'string') return undefined;
        const want = v.trim().toLowerCase();
        return allowed.find((o) => o.toLowerCase() === want);
    };
}

const QUALITY_5 = ['off', 'low', 'medium', 'high', 'ultra'] as const;
const QUALITY_4 = ['off', 'low', 'medium', 'high'] as const;

const SANITIZERS: Partial<Record<keyof Prefs, Sanitizer>> = {
    combatChat: asBool,
    debugOverlay: asBool,
    renderDeadUnits: asBool,
    antialias: asBool,
    transportChosen: asBool,
    mobileTuned: asBool,
    renderScale: asNearest([1, 0.75, 0.5, 0.33]),
    uiScale: asNearest([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]),
    scenery: asWord(['ultra', 'high', 'medium', 'low', 'off']),
    groundEffects: asWord(QUALITY_4),
    fireVfx: asWord(QUALITY_4),
    bloodFx: asWord(QUALITY_5),
    shadows: asWord(QUALITY_5),
    controlScheme: asWord(['auto', 'mouse', 'touch', 'gamepad']),
    uiFont: asWord(['cinzel', 'exo2', 'marcellus']),
    multiplayerTransport: asWord(['steam', 'matchmaking', 'lan']),
};

/** Copy `candidate` over `into`, one key at a time, keeping the existing value
 *  wherever the stored one cannot be made sense of. */
function applySanitized(into: Prefs, candidate: Record<string, unknown>): void {
    for (const [key, raw] of Object.entries(candidate)) {
        const check = SANITIZERS[key as keyof Prefs];
        if (!check) continue;               // unknown / unvalidated key: ignore
        const ok = check(raw);
        if (ok !== undefined) (into as unknown as Record<string, unknown>)[key] = ok;
    }
}

export function prefs(): Prefs {
    if (!cached) {
        cached = { ...DEFAULTS };
        let hadStoredPrefs = false;
        try {
            const raw = localStorage.getItem(KEY);
            hadStoredPrefs = !!raw;
            if (raw) {
                const stored = JSON.parse(raw) as Partial<Prefs> & {
                    muteChat?: boolean;
                    scenery?: unknown;
                    unitShadows?: unknown;
                };
                // Migrations first, sanitising second. They rescue shapes the
                // sanitisers would rightly reject ('full' scenery, unitShadows,
                // muteChat), so running them the other way round would discard
                // exactly the data they exist to carry forward.
                const candidate: Record<string, unknown> = { ...stored };
                candidate.scenery = migrateScenery(stored.scenery);
                candidate.groundEffects = migrateGroundEffects(stored.groundEffects);
                candidate.fireVfx = migrateFireVfx(stored.fireVfx);
                if (stored.shadows === undefined && stored.unitShadows !== undefined) {
                    candidate.shadows = migrateShadowQuality(stored.unitShadows);
                }
                // migrate the old "mute opponent chat" flag
                if (stored.muteChat !== undefined && stored.combatChat === undefined) {
                    candidate.combatChat = !stored.muteChat;
                }
                // the one gate into `cached`: anything unusable leaves the
                // default in place instead of being adopted
                applySanitized(cached, candidate);
                // prefs saved before the antialias field: keep the user's
                // preset intact if they were on one, otherwise stay smooth.
                // Last, because it reads the finished `cached`.
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
        } else if (!hadStoredPrefs) {
            // Fresh profile only — a first launch, or straight after Reset.
            // Gated on "nothing was stored" rather than a flag so it can never
            // overrule a preference that already exists: the moment prefs are
            // saved, this stops running. It also means Reset re-probes, which
            // is what someone asking for defaults back would expect.
            const probe = probeHardware();
            if (probe.preset !== 'high') Object.assign(cached, GRAPHICS_PRESETS[probe.preset]);
            lastHardwareProbe = probe;
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

/**
 * Wipe settings localStorage (prefs + other mechili-* keys) and restore defaults.
 * Keeps identity in user.sav (`mechili-user-*`) and the open-track auth token.
 */
export function resetSettingsStorage(): void {
    try {
        const doomed: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('mechili-') && !isUserStorageKey(key) && key !== 'mechili-open-auth') {
                doomed.push(key);
            }
        }
        for (const key of doomed) localStorage.removeItem(key);
    } catch {
        /* private browsing */
    }
    cached = { ...DEFAULTS };
    if (touchFirstDevice()) {
        Object.assign(cached, GRAPHICS_PRESETS.low);
        cached.mobileTuned = true;
    }
    normalizePrefs(cached);
    try {
        localStorage.setItem(KEY, JSON.stringify(cached));
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

/**
 * True when the in-match debug overlay should show. ?debug stays as an override
 * so a build can be inspected without touching (and persisting) the setting.
 */
export function debugEnabled(): boolean {
    if (prefs().debugOverlay) return true;
    try {
        return new URLSearchParams(location.search).has('debug');
    } catch {
        return false;
    }
}

/**
 * Effective WebGL pixel ratio. renderScale is a fraction of the display's own
 * ratio, so the backing store works out to physicalPixels × renderScale
 * regardless of window size or UI zoom.
 */
export function effectiveDpr(): number {
    return (window.devicePixelRatio || 1) * prefs().renderScale;
}
