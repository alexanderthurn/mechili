/** Player preferences, persisted in localStorage (not match state). */
export interface Prefs {
    /** show the in-match (combat) chat at all: bar, bubbles, messages */
    combatChat: boolean;
    /** show the global chat panel in the main menu */
    globalChat: boolean;
    /**
     * 'full' = mountains, lakes, forests, grass, relief, big shadows.
     * 'minimal' = flat board + flat green world, no decoration — for old
     * machines. Applies immediately, also mid-match.
     */
    scenery: 'full' | 'minimal';
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
    scenery: 'full',
    dprCap: 2,
    unitShadows: 'all',
    renderDeadUnits: true,
};

let cached: Prefs | null = null;
const listeners: (() => void)[] = [];

function normalizePrefs(p: Prefs): Prefs {
    if (p.dprCap !== 2 && p.dprCap !== 1.5 && p.dprCap !== 1) p.dprCap = 2;
    if (p.unitShadows !== 'all' && p.unitShadows !== 'structures' && p.unitShadows !== 'off') {
        p.unitShadows = 'all';
    }
    if (typeof p.renderDeadUnits !== 'boolean') p.renderDeadUnits = true;
    return p;
}

export function prefs(): Prefs {
    if (!cached) {
        cached = { ...DEFAULTS };
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const stored = JSON.parse(raw) as Partial<Prefs> & { muteChat?: boolean };
                Object.assign(cached, stored);
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
