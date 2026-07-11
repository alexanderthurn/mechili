import Peer, { type DataConnection } from 'peerjs';
import type { Action } from './actions';
import type { Opponent } from './ai';
import type { GameSettings } from './settings';

/** bumped on any change that affects game logic — mismatched peers refuse to play */
export const GAME_VERSION = 2; // v2: shared-board protocol (no mirrored coordinates)

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
            return `https://feuerware.com/2025/mechili/${encodeURIComponent(branch)}/matchmaking.php`;
        }
        return 'https://mechili.feuerware.com/matchmaking.php';
    }

    return new URL('./backend/matchmaking.php', location.href).href;
}

/**
 * Everything that crosses the wire. Actions stream LIVE as they happen —
 * hiding the opponent's deployment is purely a local rendering rule (until
 * your own lock-in), not a transmission delay.
 */
export type NetMessage =
    | { type: 'setup'; version: number; seed: number; settings: GameSettings }
    | { type: 'starter'; cardId: string }
    | { type: 'action'; round: number; action: Action }
    | { type: 'undo'; round: number };

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

    constructor(
        readonly role: 'host' | 'guest',
        private readonly peer: Peer,
        private readonly conn: DataConnection,
    ) {
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
                this.handler = null; // later messages queue for attach()
                resolve(msg);
            };
        });
    }

    close(): void {
        this.onClose = null;
        this.conn.close();
        this.peer.destroy();
    }
}

function openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
        const peer = id ? new Peer(id) : new Peer();
        peer.on('open', () => resolve(peer));
        peer.on('error', (e) => reject(e));
    });
}

function connectTo(peer: Peer, remoteId: string): Promise<NetSession> {
    return new Promise((resolve, reject) => {
        const conn = peer.connect(remoteId, { reliable: true });
        conn.on('open', () => resolve(new NetSession('guest', peer, conn)));
        conn.on('error', (e) => reject(e));
        peer.on('error', (e) => reject(e));
    });
}

function awaitConnection(peer: Peer): Promise<NetSession> {
    return new Promise((resolve) => {
        peer.on('connection', (conn) => {
            conn.on('open', () => resolve(new NetSession('host', peer, conn)));
        });
    });
}

/** a cancellable matchmaking attempt */
export interface Pending {
    session: Promise<NetSession>;
    cancel: () => void;
}

/**
 * Quick match via the PHP endpoint: register our PeerJS id as waiting, or
 * take a waiting one and connect to it. The waiting side learns of the match
 * through the incoming PeerJS connection itself — no polling needed, only
 * heartbeats so stale entries expire server-side.
 */
export function quickMatch(onStatus: (status: string) => void): Pending {
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let peer: Peer | null = null;

    const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (peer) {
            void fetch(`${matchUrl()}?action=leave&peer=${peer.id}`).catch(() => undefined);
        }
    };

    const session = (async () => {
        onStatus('Connecting…');
        peer = await openPeer();
        if (cancelled) throw new Error('cancelled');
        onStatus('Searching for an opponent…');
        const res = await fetch(`${matchUrl()}?action=join&peer=${peer.id}`);
        const data = (await res.json()) as { match: string | null };
        if (cancelled) throw new Error('cancelled');
        if (data.match) {
            onStatus('Opponent found — connecting…');
            return await connectTo(peer, data.match);
        }
        // we are the waiting side: keep our entry fresh until someone connects
        heartbeat = setInterval(() => {
            void fetch(`${matchUrl()}?action=join&peer=${peer!.id}`).catch(() => undefined);
        }, 5000);
        onStatus('Waiting for an opponent…');
        const s = await awaitConnection(peer);
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

/** Custom rooms need no server: the room code IS the host's PeerJS id. */
export function hostRoom(code: string, onStatus: (status: string) => void): Pending {
    let peer: Peer | null = null;
    const session = (async () => {
        onStatus('Opening room…');
        peer = await openPeer(`mechili-room-${code.toLowerCase()}`);
        onStatus(`Room "${code}" open — waiting for your opponent…`);
        return await awaitConnection(peer);
    })();
    return { session, cancel: () => peer?.destroy() };
}

export function joinRoom(code: string, onStatus: (status: string) => void): Pending {
    let peer: Peer | null = null;
    const session = (async () => {
        onStatus('Connecting to room…');
        peer = await openPeer();
        return await connectTo(peer, `mechili-room-${code.toLowerCase()}`);
    })();
    return { session, cancel: () => peer?.destroy() };
}

/** a short shareable room code */
export function makeRoomCode(): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
}
