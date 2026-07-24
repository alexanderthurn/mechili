const STORAGE_KEY = 'mechili-username';

/** PeerJS id suffix — lowercase alphanumeric, underscore, hyphen. */
export function roomCodeFromName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export function peerRoomId(name: string): string {
    return `mechili-room-${roomCodeFromName(name)}`;
}

function randomDefaultName(): string {
    return `Player${1000 + Math.floor(Math.random() * 9000)}`;
}

/** Sanitize for display; returns null if unusable as a room code. */
export function validatePlayerName(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed.length > 16) return null;
    const code = roomCodeFromName(trimmed);
    if (code.length < 2) return null;
    return trimmed;
}

export function getPlayerName(): string {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
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
        localStorage.setItem(STORAGE_KEY, valid);
    } catch {
        return false;
    }
    return true;
}
