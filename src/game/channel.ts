/**
 * Build channel: open (web/OSS, PHP honor-system) vs steam (later, Steamworks).
 * Steam builds must never call open player.php / PeerJS matchmaking.
 */
export type BuildChannel = 'open' | 'steam';

/** compile-time flavor — Steam Electron build will flip this */
export const BUILD_CHANNEL: BuildChannel = 'open';

export function isOpenBuild(): boolean {
    return BUILD_CHANNEL === 'open';
}

export function isSteamBuild(): boolean {
    return BUILD_CHANNEL === 'steam';
}
