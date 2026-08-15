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
        openInviteDialog(): Promise<void>;
        getLobbies(): Promise<SteamLobbyInfo[]>;
        /** fires on any member joining/leaving the CURRENT lobby */
        onChatUpdate(cb: (data: { lobby: string; userChanged: string; memberStateChange: number }) => void): void;
        /** fires when the user accepts a Steam overlay/friends-list "Join Game" invite */
        onJoinRequested(cb: (data: { lobbySteamId: string }) => void): void;
    };

    export const net: {
        isAvailable(): boolean;
        /** payload is any JSON-serializable value — this layer only moves bytes */
        send(steamId64: string, payload: unknown): Promise<boolean>;
        onData(cb: (packet: { steamId64: string; data: unknown }) => void): void;
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
        exclude?: string[];
        debounceMs?: number;
    }): Promise<boolean>;
}
