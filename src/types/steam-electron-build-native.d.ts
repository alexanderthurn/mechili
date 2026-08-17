/**
 * Ambient types for `steam-electron-build/native` — the package ships a
 * plain JS helper module (safe no-ops outside Electron), no `.d.ts`. Kept in
 * sync by hand with `native/index.js` in that package.
 */
declare module 'steam-electron-build/native' {
    export function isElectron(): boolean;

    export const steam: {
        isAvailable(): boolean;
        getUserName(): Promise<string>;
        getSteamId(): Promise<string>;
        /** Local player's Steam medium avatar as a data URL, or null */
        getAvatarDataUrl(): Promise<string | null>;
        /** Steam beta branch, or null when on the default/public branch */
        getCurrentBetaName(): Promise<string | null>;
        /** App id we were launched as — a playtest/demo differs from the built-in one; 0 outside Steam */
        getAppId(): Promise<number>;
        unlockAchievement(id: string): Promise<void>;
        getUnlockedAchievements(ids: string[]): Promise<string[]>;
        getStat(name: string): Promise<number>;
        setStat(name: string, value: number): Promise<void>;
        activateOverlay(dialog?: string): Promise<void>;
        openStore(): Promise<void>;
        /** Electron ≥1.9: friends-list presence. A lobbyId gives friends a Join Game button. */
        setPresence(presence: {
            status?: string;
            lobbyId?: string | null;
            groupSize?: number;
        }): Promise<boolean>;
        clearPresence(): Promise<void>;
        quit(): Promise<void>;
    };

    /** mirrors main.cjs's `describeLobby()` */
    export interface SteamLobbyInfo {
        id: string;
        memberCount: number;
        memberLimit: number | null;
        owner: string;
        data: Record<string, string>;
    }

    export const lobby: {
        isAvailable(): boolean;
        /** 'private': invite-only, not returned by getLobbies. 'public': discoverable. */
        create(type: 'private' | 'public', maxMembers: number): Promise<SteamLobbyInfo | null>;
        join(lobbyId: string): Promise<SteamLobbyInfo | null>;
        leave(): Promise<void>;
        getMembers(): Promise<string[]>;
        getOwner(): Promise<string | null>;
        setData(key: string, value: string): Promise<boolean>;
        getData(key: string): Promise<string | null>;
        getFullData(): Promise<Record<string, string>>;
        mergeFullData(data: Record<string, string>): Promise<boolean>;
        setJoinable(flag: boolean): Promise<boolean>;
        /** false = no lobby, or the overlay refused */
        openInviteDialog(): Promise<boolean>;
        /** direct lobby invite, no overlay; false = could not send */
        inviteUser(steamId64: string): Promise<boolean>;
        getLobbies(): Promise<SteamLobbyInfo[]>;
        /** lobby id from a "Join Game" invite that launched the app, once (Electron ≥1.8.1) */
        takePendingJoin(): Promise<string | null>;
        /** fires on any member joining/leaving the CURRENT lobby */
        onChatUpdate(cb: (data: { lobby: string; userChanged: string; memberStateChange: number }) => void): void;
        /** fires when the user accepts a Steam overlay/friends-list "Join Game" invite */
        onJoinRequested(cb: (data: { lobbySteamId: string }) => void): void;
    };

    /** A Steam friend, as `friends.list()` reports them. */
    export interface SteamFriend {
        steamId64: string;
        name: string;
        /** EPersonaState: 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5 trade, 6 play */
        state: number;
        /** playing THIS app right now — Steam exposes no ownership API */
        inThisGame: boolean;
    }

    export const friends: {
        isAvailable(): boolean;
        list(): Promise<SteamFriend[]>;
        /** data URL, or null while Steam has not cached it yet */
        avatar(steamId64: string): Promise<string | null>;
    };

    export const net: {
        isAvailable(): boolean;
        /** payload is any JSON-serializable value — this layer only moves bytes */
        send(steamId64: string, payload: unknown): Promise<boolean>;
        onData(cb: (packet: { steamId64: string; data: unknown }) => void): void;
        /**
         * A peer's connection ended. `graceful` = closed cleanly by them;
         * otherwise a locally detected problem (timeout, unreachable), which
         * Steam may still recover from on the next send.
         *
         * Optional: older runtimes do not expose it (see net-steam.ts, which
         * treats it purely as a speed-up over its own keepalive).
         */
        onClosed?(cb: (info: { steamId64: string; graceful: boolean }) => void): void;
    };

    /** LAN PeerServer + UDP discovery (opt-in: steamElectronBuild.lan === true) */
    export interface LanRoom {
        name: string;
        peerId: string;
        host: string;
        port: number;
        path: string;
        maxPlayers: number | null;
        data: Record<string, unknown>;
    }

    export const lan: {
        /** true when Electron AND steamElectronBuild.lan === true */
        isAvailable(): Promise<boolean>;
        startHost(options?: {
            name?: string;
            peerId?: string;
            port?: number;
            path?: string;
            maxPlayers?: number | null;
            data?: Record<string, unknown>;
        }): Promise<LanRoom | null>;
        stopHost(): Promise<void>;
        updateHost(patch?: {
            name?: string;
            peerId?: string;
            maxPlayers?: number | null;
            data?: Record<string, unknown>;
        }): Promise<LanRoom | null>;
        listRooms(options?: { timeoutMs?: number }): Promise<LanRoom[]>;
        getHostInfo(): Promise<LanRoom | null>;
    };

    export const win: {
        setFullscreen(flag: boolean): Promise<void>;
        isFullscreen(): Promise<boolean>;
        /** Multiplier on the automatic high-DPI zoom (Electron ≥1.7; no-op elsewhere) */
        setUiScale(factor: number): Promise<void>;
        /** Electron ≥1.8: hold the window close until confirmQuit() (1.5s cap) */
        wantsQuitHook(): Promise<void>;
        onBeforeQuit(cb: () => void): void;
        confirmQuit(): Promise<void>;
        getUiScale(): Promise<number>;
        close(): Promise<void>;
    };

    export function toggleFullscreen(): Promise<void>;

    export const storage: {
        /** `file` names a file in the app-data dir; default save.json */
        load(file?: string): Promise<Record<string, unknown>>;
        save(data: Record<string, unknown>, file?: string): Promise<void>;
    };

    export function openUrl(url: string): void;

    /**
     * Mirror prefix-matched localStorage keys into the cloud-synced save file.
     * File wins at startup, memory for the rest of the session. Resolves false
     * in a browser, where there is no save file. Await before the first read.
     */
    /**
     * Present in steam-electron-build ≥1.4 — Electron mirrors localStorage into
     * a cloud .sav. Older installs omit it; callers must feature-detect.
     */
    export function mirrorLocalStorage(options?: {
        /** File in the app-data dir (default save.json) — pick one your Auto-Cloud rule matches */
        file?: string;
        prefix?: string;
        /** Carves out a whole namespace so a second mirror can own those keys */
        excludePrefix?: string;
        exclude?: string[];
        debounceMs?: number;
    }): Promise<boolean>;
}
