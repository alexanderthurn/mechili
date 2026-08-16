/**
 * Multiplayer discovery preference — one transport at a time (no dual race).
 * Settings: Steam | Web | LAN. No Auto, no silent fallback between modes.
 */

import { isElectron, lan, steam } from 'steam-electron-build/native';
import { prefs, type Prefs } from './prefs';

export type MultiplayerTransportPref = Prefs['multiplayerTransport'];

/** Concrete path used for a host/join attempt. */
export type MultiplayerTransport = 'steam' | 'matchmaking' | 'lan';

/** True when Steamworks initialized at app launch (not merely Electron preload). */
export async function steamReady(): Promise<boolean> {
    if (!steam.isAvailable()) return false;
    try {
        const id = await steam.getSteamId();
        return !!id && id !== '0';
    } catch {
        return false;
    }
}

export async function lanReady(): Promise<boolean> {
    try {
        return await lan.isAvailable();
    } catch {
        return false;
    }
}

/**
 * Resolve the player's pref into that transport, or null if it is unavailable.
 * Never switches to a different mode.
 */
export async function resolveMultiplayerTransport(
    pref: MultiplayerTransportPref = prefs().multiplayerTransport,
): Promise<MultiplayerTransport | null> {
    if (pref === 'steam') return (await steamReady()) ? 'steam' : null;
    if (pref === 'matchmaking') {
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
        return online ? 'matchmaking' : null;
    }
    if (pref === 'lan') return (await lanReady()) ? 'lan' : null;
    return null;
}

/** Which transports can actually work here, right now. */
export async function availableTransports(): Promise<MultiplayerTransport[]> {
    const out: MultiplayerTransport[] = [];
    if (await steamReady()) out.push('steam');
    // Matchmaking needs the internet, but connectivity comes and goes — keep it
    // listed and let the attempt report the failure, rather than hiding the
    // option from someone whose wifi blinked while the dialog was open.
    out.push('matchmaking');
    if (await lanReady()) out.push('lan');
    return out;
}

/**
 * Boot-time correction: move off a default nobody chose when it cannot work.
 * An explicit pick is never touched — that is the no-silent-fallback rule.
 */
export async function resolveStartupTransport(
    pref: MultiplayerTransportPref,
    chosen: boolean,
): Promise<MultiplayerTransportPref | null> {
    if (chosen) return null;
    const available = await availableTransports();
    if (available.includes(pref as MultiplayerTransport)) return null;
    return available[0] ?? null;
}

export function transportLookingStatus(t: MultiplayerTransport): string {
    switch (t) {
        case 'steam':
            return 'Looking for a match… Steam';
        case 'matchmaking':
            return 'Looking for a match… Matchmaking';
        case 'lan':
            return 'Looking for a match… LAN';
    }
}

export function transportConnectedStatus(t: MultiplayerTransport): string {
    switch (t) {
        case 'steam':
            return 'Connected via Steam';
        case 'matchmaking':
            return 'Connected via Matchmaking';
        case 'lan':
            return 'Connected via LAN';
    }
}

export function transportUnavailableMessage(
    pref: MultiplayerTransportPref = prefs().multiplayerTransport,
): string {
    switch (pref) {
        case 'steam':
            return 'Steam multiplayer needs the Steam client. Pick Web or LAN in Settings, or start Steam and relaunch.';
        case 'matchmaking':
            return 'Online Matchmaking needs an internet connection.';
        case 'lan':
            return isElectron()
                ? 'LAN is unavailable (enable steamElectronBuild.lan and restart).'
                : 'LAN multiplayer is only available in the Steam/Electron app.';
        default:
            return 'No multiplayer path available. Check Settings → Multiplayer.';
    }
}

export function transportLabel(t: MultiplayerTransport): string {
    switch (t) {
        case 'steam':
            return 'Steam';
        case 'matchmaking':
            return 'Matchmaking';
        case 'lan':
            return 'LAN';
    }
}
