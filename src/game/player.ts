import { migrateUserStorage, USER_NAME_KEY } from './userStorage';

/** Longest display name, in characters — Steam's own limit, so a Steam name always fits. */
export const PLAYER_NAME_MAX = 32;

/**
 * PeerJS id suffix and web account key — lowercase alphanumeric, underscore,
 * hyphen. A name with at least two of those keeps exactly that (so existing
 * keys never change); any other name (李明, Øx, ★★) gets `u` + a hash of the
 * whole name. backend/player.php nameKey() computes the same.
 */
export function roomCodeFromName(name: string): string {
    const lower = name.trim().toLowerCase();
    const ascii = lower.replace(/[^a-z0-9_-]/g, '');
    return ascii.length >= 2 ? ascii : `u${fnv1a64Hex(lower)}`;
}

/** FNV-1a 64-bit over the UTF-8 bytes — same as PHP hash('fnv1a64', ...). */
function fnv1a64Hex(s: string): string {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(s)) {
        h ^= BigInt(b);
        h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
}

export function peerRoomId(name: string): string {
    return `mechili-room-${roomCodeFromName(name)}`;
}

function randomDefaultName(): string {
    return `Player${1000 + Math.floor(Math.random() * 9000)}`;
}

/**
 * Clean a name for display: any script, control and text-direction characters
 * removed, whitespace collapsed, cut to {@link PLAYER_NAME_MAX} characters.
 * null when nothing is left.
 */
export function validatePlayerName(raw: string): string | null {
    const clean = raw
        .normalize('NFC')
        .replace(/[\p{Cc}\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    const name = Array.from(clean).slice(0, PLAYER_NAME_MAX).join('').trim();
    return name || null;
}

export function getPlayerName(): string {
    migrateUserStorage();
    try {
        const saved = localStorage.getItem(USER_NAME_KEY);
        if (saved && validatePlayerName(saved)) return saved;
    } catch {
        /* private browsing */
    }
    const name = randomDefaultName();
    setPlayerName(name);
    return name;
}

export function setPlayerName(name: string): boolean {
    const valid = validatePlayerName(name);
    if (!valid) return false;
    try {
        localStorage.setItem(USER_NAME_KEY, valid);
    } catch {
        return false;
    }
    return true;
}
