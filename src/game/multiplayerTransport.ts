/**
 * Multiplayer discovery preference — one transport at a time (no dual race).
 * Settings: Auto | Steam | Matchmaking | LAN.
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
 * Resolve the player's pref into a concrete transport, or null if impossible.
 *
 * Auto: offline + LAN → LAN; Steam ready + online → Steam; online → Matchmaking;
 * else LAN if available.
 */
export async function resolveMultiplayerTransport(
    pref: MultiplayerTransportPref = prefs().multiplayerTransport,
): Promise<MultiplayerTransport | null> {
    const onSteam = await steamReady();
    const onLan = await lanReady();
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (pref === 'steam') return onSteam ? 'steam' : null;
    if (pref === 'matchmaking') return online ? 'matchmaking' : null;
    if (pref === 'lan') return onLan ? 'lan' : null;

    // auto
    if (!online && onLan) return 'lan';
    if (onSteam && online) return 'steam';
    if (online) return 'matchmaking';
    if (onLan) return 'lan';
    return null;
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
            return 'Steam multiplayer needs the Steam client. Pick Matchmaking or LAN in Settings, or start Steam and relaunch.';
        case 'matchmaking':
            return 'Online Matchmaking needs an internet connection.';
        case 'lan':
            return isElectron()
                ? 'LAN is unavailable (enable steamElectronBuild.lan and restart).'
                : 'LAN multiplayer is only available in the Steam/Electron app.';
        default:
            return 'No multiplayer path available. Check your connection, Steam, or Settings → Multiplayer.';
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
