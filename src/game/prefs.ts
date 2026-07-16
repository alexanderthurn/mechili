/** Player preferences, persisted in localStorage (not match state). */

/** Outer world / forests / terrain detail. */
export type SceneryQuality = 'ultra' | 'high' | 'medium' | 'low';
/** Battlefield sand / blood / scorch wear on the ground. */
export type GroundEffectsQuality = 'full' | 'medium' | 'off';

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
     * Ground wear (sand footprints, blood, scorch). Independent of scenery
     * when scenery is medium/high; no-op on low (no detail ground).
     * - full: footprints + blood + scorch, ~12 Hz mask upload
     * - medium: footprints + scorch, lighter / slower updates
     * - off: no wear mask work
     */
    groundEffects: GroundEffectsQuality;
    /**
     * Cap on `devicePixelRatio` for the WebGL canvas.
     * 2 = current default (retina), 1.5 = medium, 1 = 1:1 CSS pixels.
     */
    dprCap: 2 | 1.5 | 1;
    /**
     * Who casts unit shadows from the instance pools.
     * Scenery / ground shadows are unchanged.
     */
    unitShadows: 'all' | 'structures' | 'off';
    /** When false, dead/wrecked mechs are not drawn (still revive next round). */
    renderDeadUnits: boolean;
}

const KEY = 'mechili-prefs';
const DEFAULTS: Prefs = {
    combatChat: true,
    globalChat: true,
    scenery: 'medium',
    groundEffects: 'full',
    dprCap: 2,
    unitShadows: 'all',
    renderDeadUnits: true,
};

let cached: Prefs | null = null;
const listeners: (() => void)[] = [];

function migrateScenery(raw: unknown): SceneryQuality {
    if (raw === 'ultra' || raw === 'high' || raw === 'medium' || raw === 'low') return raw;
    if (raw === 'full') return 'medium'; // former default look
    if (raw === 'minimal') return 'low';
    return DEFAULTS.scenery;
}

function normalizePrefs(p: Prefs): Prefs {
    p.scenery = migrateScenery(p.scenery);
    if (p.groundEffects !== 'full' && p.groundEffects !== 'medium' && p.groundEffects !== 'off') {
        p.groundEffects = DEFAULTS.groundEffects;
    }
    if (p.dprCap !== 2 && p.dprCap !== 1.5 && p.dprCap !== 1) p.dprCap = 2;
    if (p.unitShadows !== 'all' && p.unitShadows !== 'structures' && p.unitShadows !== 'off') {
        p.unitShadows = 'all';
    }
    if (typeof p.renderDeadUnits !== 'boolean') p.renderDeadUnits = true;
    return p;
}

/** True when mountains / forests / textured ground are enabled. */
export function sceneryDetailed(quality: SceneryQuality = prefs().scenery): boolean {
    return quality !== 'low';
}

/** Shadow-map edge length for the current scenery tier. */
export function sceneryShadowMapSize(quality: SceneryQuality = prefs().scenery): number {
    if (quality === 'ultra' || quality === 'high') return 4096;
    if (quality === 'medium') return 2048;
    return 1024;
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

export function prefs(): Prefs {
    if (!cached) {
        cached = { ...DEFAULTS };
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const stored = JSON.parse(raw) as Partial<Prefs> & {
                    muteChat?: boolean;
                    scenery?: unknown;
                };
                Object.assign(cached, stored);
                cached.scenery = migrateScenery(stored.scenery);
                // migrate the old "mute opponent chat" flag
                if (stored.muteChat !== undefined && stored.combatChat === undefined) {
                    cached.combatChat = !stored.muteChat;
                }
            }
        } catch {
            /* private browsing */
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
