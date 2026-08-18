/**
 * Identity / profile keys that sync via Steam Auto-Cloud `user.sav`.
 * Settings (prefs, custom game, etc.) live in the per-app, per-machine
 * settings file instead — see main.ts. Identity stays global on purpose, so
 * anything experimental belongs in the settings namespace, not this one.
 *
 * Shared `mechili-user-` prefix so one mirrorLocalStorage call can own the file.
 */

export const USER_STORAGE_PREFIX = 'mechili-user-';

export const USER_NAME_KEY = `${USER_STORAGE_PREFIX}name`;
export const USER_AVATAR_KEY = `${USER_STORAGE_PREFIX}avatar`;
export const USER_AVATAR_STEAM_KEY = `${USER_STORAGE_PREFIX}avatar-steam`;

/** Keys excluded from the settings save (identity + auth credential). */
export const SETTINGS_SAV_EXCLUDE = [
    USER_NAME_KEY,
    USER_AVATAR_KEY,
    USER_AVATAR_STEAM_KEY,
    // Legacy names (pre user.sav split) — drop from settings if still present.
    'mechili-username',
    'mechili-avatar',
    'mechili-avatar-steam',
    'mechili-open-auth',
    // Which match this machine dropped out of — transient and machine-specific;
    // syncing it would offer "Resume" on a device that was never in that match.
    'mechili-star-resume',
] as const;

/**
 * Move a legacy localStorage key to its user.sav name once.
 * Keeps whichever value already lives under the new key.
 */
export function migrateUserStorageKey(legacyKey: string, nextKey: string): void {
    try {
        if (localStorage.getItem(nextKey) != null) {
            localStorage.removeItem(legacyKey);
            return;
        }
        const raw = localStorage.getItem(legacyKey);
        if (raw == null) return;
        localStorage.setItem(nextKey, raw);
        localStorage.removeItem(legacyKey);
    } catch {
        /* private browsing */
    }
}

/**
 * Drop a "custom" avatar that is really just a copy of the Steam one.
 *
 * The pre-split key held whichever avatar was in use, so migrating it forward
 * left players whose avatar came FROM Steam looking like they had picked their
 * own — hasCustomAvatar() said yes, and ~120 KB of duplicate base64 went to the
 * cloud on every write. The Steam cache covers that case by itself.
 */
function dropRedundantCustomAvatar(): void {
    try {
        const custom = localStorage.getItem(USER_AVATAR_KEY);
        if (custom && custom === localStorage.getItem(USER_AVATAR_STEAM_KEY)) {
            localStorage.removeItem(USER_AVATAR_KEY);
        }
    } catch {
        /* private browsing */
    }
}

export function migrateUserStorage(): void {
    migrateUserStorageKey('mechili-username', USER_NAME_KEY);
    migrateUserStorageKey('mechili-avatar', USER_AVATAR_KEY);
    migrateUserStorageKey('mechili-avatar-steam', USER_AVATAR_STEAM_KEY);
    dropRedundantCustomAvatar();
}

/** True for identity keys that must survive a settings reset. */
export function isUserStorageKey(key: string): boolean {
    return key.startsWith(USER_STORAGE_PREFIX);
}
