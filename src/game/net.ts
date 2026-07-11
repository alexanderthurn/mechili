import Peer, { type DataConnection } from 'peerjs';
import type { Action, LoggedAction } from './actions';
import type { Opponent } from './ai';
import { getPlayerName, peerRoomId, roomCodeFromName } from './player';
import type { GameSettings } from './settings';

/** bumped on any change that affects game logic — mismatched peers refuse to play */
export const GAME_VERSION = 3; // v3: checksums + resume/state (reconnect & desync recovery)

const CONNECT_TIMEOUT_MS = 20_000;
const HEARTBEAT_MS = 5000;

/**
 * The quick-match endpoint (backend/matchmaking.php, bundled in dist).
 * Override per deployment with ?match=<url>.
 */
function isLocalhost(): boolean {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

export function matchUrl(): string {
    const params = new URLSearchParams(location.search);
    const override = params.get('match');
    if (override) return override;

    if (isLocalhost()) {
        const branch = params.get('branch');
        if (branch) {
            return `https://feuerware.com/2025/mechili/${encodeURIComponent(branch)}/backend/matchmaking.php`;
        }
        return 'https://mechili.feuerware.com/backend/matchmaking.php';
    }

    return new URL('./backend/matchmaking.php', location.href).href;
}

export interface LobbyRoom {
    name: string;
    peer: string;
}

/**
 * Everything that crosses the wire. Actions stream LIVE as they happen —
 * hiding the opponent's deployment is purely a local rendering rule (until
 * your own lock-in), not a transmission delay.
 */
export type NetMessage =
    | { type: 'hello'; name: string }
    | { type: 'setup'; version: number; seed: number; settings: GameSettings; hostName: string; guestName: string }
    | { type: 'starter'; cardId: string }
    | { type: 'action'; round: number; action: Action }
    | { type: 'undo'; round: number }
    /** state checksum at every battle start — mismatch = desync, triggers a resync */
    | { type: 'check'; round: number; hash: number }
    /** a reloaded/rejoining peer asks for the full match state */
    | { type: 'resume' }
    /** the survivor's answer: seed + full action log (in the SENDER's perspective) */
    | { type: 'state'; version: number; seed: number; settings: GameSettings; actions: LoggedAction[] };

/** the remote player as an Opponent: it acts via received messages, so the
 *  local hooks are all no-ops */
export class NetworkOpponent implements Opponent {
    chooseStarter(): void {}
    onBuildPhase(): void {}
    onRoundCards(): void {}
}

/** one open peer-to-peer connection, host or guest */
export class NetSession {
    onClose: (() => void) | null = null;
    private handler: ((msg: NetMessage) => void) | null = null;
    private readonly backlog: NetMessage[] = [];

    readonly localName: string;
    remoteName: string;

    constructor(
        readonly role: 'host' | 'guest',
        private readonly peer: Peer,
        private readonly conn: DataConnection,
        localName: string,
        remoteName: string,
    ) {
        this.localName = localName;
        this.remoteName = remoteName;
        conn.on('data', (data) => {
            const msg = data as NetMessage;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
        conn.on('close', () => this.onClose?.());
        conn.on('error', () => this.onClose?.());
        peer.on('error', () => this.onClose?.());
    }

    /** installs the message handler and drains anything that arrived early */
    attach(handler: (msg: NetMessage) => void): void {
        this.handler = handler;
        while (this.backlog.length > 0) handler(this.backlog.shift()!);
    }

    send(msg: NetMessage): void {
        this.conn.send(msg);
    }

    /** waits for the next single message (used for the setup handshake) */
    once(): Promise<NetMessage> {
        return new Promise((resolve) => {
            if (this.backlog.length > 0) {
                resolve(this.backlog.shift()!);
                return;
            }
            this.handler = (msg) => {
                this.handler = null;
                resolve(msg);
            };
        });
    }

    close(): void {
        this.onClose = null;
        this.conn.close();
        this.peer.destroy();
    }

    /** host learns the guest's display name during handshake */
    setRemoteName(name: string): void {
        this.remoteName = name;
    }

    get ownId(): string {
        return this.peer.id;
    }

    get remoteId(): string {
        return this.conn.peer;
    }

    /** survivor who OWNS the room id: keep the peer open, wait for the rejoin */
    awaitReconnect(): Promise<NetSession> {
        return awaitConnection(this.peer, this.localName).then((s) => {
            s.setRemoteName(this.remoteName);
            return s;
        });
    }

    /** survivor on the other end: redial the dropped peer until it comes back */
    async redial(attempts = 20, delayMs = 3000): Promise<NetSession> {
        for (let i = 0; i < attempts; i++) {
            try {
                return await connectTo(this.peer, this.remoteId, this.localName, this.remoteName);
            } catch {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
        throw new Error('Opponent did not come back');
    }
}

// --- resume marker: enough to find the match again after a reload ---

const RESUME_KEY = 'mechili-resume';

export interface ResumeMarker {
    side: 'a' | 'b';
    names: { local: string; opponent: string };
    /** the opponent's PeerJS id (redialed directly after our reload) */
    remotePeerId: string;
    /** our own id IF it is a recreatable room id, else null */
    ownRoomId: string | null;
}

export function saveResumeMarker(marker: ResumeMarker): void {
    try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(marker));
    } catch {
        /* private browsing */
    }
}

export function loadResumeMarker(): ResumeMarker | null {
    try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        return raw ? (JSON.parse(raw) as ResumeMarker) : null;
    } catch {
        return null;
    }
}

export function clearResumeMarker(): void {
    try {
        sessionStorage.removeItem(RESUME_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * After a reload: reopen our side of the connection. If we owned a room id
 * we re-host it (the survivor redials it); otherwise we dial the survivor.
 */
export async function resumeSession(marker: ResumeMarker): Promise<NetSession> {
    if (marker.ownRoomId) {
        const peer = await openPeer(marker.ownRoomId);
        const session = await Promise.race([
            awaitConnection(peer, marker.names.local),
            new Promise<NetSession>((_, reject) =>
                setTimeout(() => reject(new Error('Opponent did not reconnect')), 60_000),
            ),
        ]);
        session.setRemoteName(marker.names.opponent);
        return session;
    }
    const peer = await openPeer();
    for (let i = 0; i < 15; i++) {
        try {
            return await connectTo(peer, marker.remotePeerId, marker.names.local, marker.names.opponent);
        } catch {
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    throw new Error('Could not reach the opponent');
}

function openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
        const peer = id ? new Peer(id) : new Peer();
        peer.on('open', () => resolve(peer));
        peer.on('error', (e) => reject(e));
    });
}

function connectTo(
    peer: Peer,
    remoteId: string,
    localName: string,
    remoteName: string,
): Promise<NetSession> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Room not found or host offline')),
            CONNECT_TIMEOUT_MS,
        );
        const conn = peer.connect(remoteId, { reliable: true });
        conn.on('open', () => {
            clearTimeout(timer);
            resolve(new NetSession('guest', peer, conn, localName, remoteName));
        });
        conn.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        peer.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

function awaitConnection(peer: Peer, localName: string): Promise<NetSession> {
    return new Promise((resolve) => {
        peer.on('connection', (conn) => {
            conn.on('open', () => {
                resolve(new NetSession('host', peer, conn, localName, ''));
            });
        });
    });
}

async function lobbyLeave(peerId: string): Promise<void> {
    await fetch(`${matchUrl()}?action=leave&peer=${encodeURIComponent(peerId)}`).catch(() => undefined);
}

async function lobbyRegister(peerId: string, name: string): Promise<void> {
    await fetch(
        `${matchUrl()}?action=host&peer=${encodeURIComponent(peerId)}&name=${encodeURIComponent(name)}`,
    ).catch(() => undefined);
}

/** Public lobby rooms (refreshed by the menu every few seconds). */
export async function fetchLobbyRooms(): Promise<LobbyRoom[]> {
    const res = await fetch(`${matchUrl()}?action=list`);
    const data = (await res.json()) as { rooms?: LobbyRoom[] };
    return data.rooms ?? [];
}

/** a cancellable matchmaking attempt */
export interface Pending {
    session: Promise<NetSession>;
    cancel: () => void;
}

/**
 * Quick match via the PHP endpoint: register our PeerJS id as waiting, or
 * take a waiting one and connect to it.
 */
export function quickMatch(onStatus: (status: string) => void): Pending {
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let peer: Peer | null = null;
    const localName = getPlayerName();

    const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (peer) void lobbyLeave(peer.id);
    };

    const session = (async () => {
        onStatus('Connecting…');
        peer = await openPeer();
        if (cancelled) throw new Error('cancelled');
        onStatus('Searching for an opponent…');
        const res = await fetch(`${matchUrl()}?action=join&peer=${encodeURIComponent(peer.id)}`);
        const data = (await res.json()) as { match: string | null };
        if (cancelled) throw new Error('cancelled');
        if (data.match) {
            onStatus('Opponent found — connecting…');
            return await connectTo(peer, data.match, localName, 'Opponent');
        }
        heartbeat = setInterval(() => {
            void fetch(`${matchUrl()}?action=join&peer=${encodeURIComponent(peer!.id)}`).catch(
                () => undefined,
            );
        }, HEARTBEAT_MS);
        onStatus('Waiting for an opponent…');
        const s = await awaitConnection(peer, localName);
        cleanup();
        return s;
    })();

    return {
        session,
        cancel: () => {
            cancelled = true;
            cleanup();
            peer?.destroy();
        },
    };
}

/**
 * Host a public room. The room code is the player's username — friends can
 * find it in the lobby list or connect directly by name.
 */
export function hostLobby(onStatus: (status: string) => void): Pending {
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let peer: Peer | null = null;
    const name = getPlayerName();
    const roomId = peerRoomId(name);

    const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (peer) void lobbyLeave(peer.id);
    };

    const session = (async () => {
        onStatus('Opening room…');
        try {
            peer = await openPeer(roomId);
        } catch {
            throw new Error(`Name "${name}" is already hosting — pick another username`);
        }
        if (cancelled) throw new Error('cancelled');
        await lobbyRegister(peer.id, name);
        heartbeat = setInterval(() => {
            void lobbyRegister(peer!.id, name);
        }, HEARTBEAT_MS);
        onStatus(`Room open — waiting for an opponent…`);
        const s = await awaitConnection(peer, name);
        cleanup();
        return s;
    })();

    return {
        session,
        cancel: () => {
            cancelled = true;
            cleanup();
            peer?.destroy();
        },
    };
}

/** Join a public room by the host's username (room code). */
export function joinLobby(hostName: string, onStatus: (status: string) => void): Pending {
    let peer: Peer | null = null;
    const localName = getPlayerName();
    const code = roomCodeFromName(hostName);
    if (!code) {
        return {
            session: Promise.reject(new Error('Invalid room name')),
            cancel: () => undefined,
        };
    }

    const session = (async () => {
        onStatus(`Joining "${hostName.trim()}"…`);
        peer = await openPeer();
        return await connectTo(peer, peerRoomId(hostName), localName, hostName.trim());
    })();

    return { session, cancel: () => peer?.destroy() };
}

/** Guest sends hello; host waits for the guest's display name. */
export async function handshake(session: NetSession): Promise<void> {
    if (session.role === 'guest') {
        session.send({ type: 'hello', name: session.localName });
        return;
    }
    const msg = await Promise.race([
        session.once(),
        new Promise<NetMessage>((_, reject) =>
            setTimeout(() => reject(new Error('Opponent did not respond')), CONNECT_TIMEOUT_MS),
        ),
    ]);
    if (msg.type !== 'hello') throw new Error('Unexpected handshake');
    session.setRemoteName(msg.name);
}
