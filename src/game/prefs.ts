/** Player preferences, persisted in localStorage (not match state). */
export interface Prefs {
    /** show the in-match (combat) chat at all: bar, bubbles, messages */
    combatChat: boolean;
    /** show the global chat panel in the main menu */
    globalChat: boolean;
    /**
     * 'full' = mountains, lakes, forests, grass, relief, big shadows.
     * 'minimal' = flat board + flat green world, no decoration — for old
     * machines. Applies when the next match starts.
     */
    scenery: 'full' | 'minimal';
}

const KEY = 'mechili-prefs';
const DEFAULTS: Prefs = { combatChat: true, globalChat: true, scenery: 'full' };

let cached: Prefs | null = null;
const listeners: (() => void)[] = [];

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
    }
    return cached;
}

export function updatePrefs(patch: Partial<Prefs>): void {
    Object.assign(prefs(), patch);
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
