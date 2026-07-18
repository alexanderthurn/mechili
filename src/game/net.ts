import Peer, { type DataConnection } from 'peerjs';
import type { Action, LoggedAction } from './actions';
import type { Opponent } from './ai';
import type { ChatItem } from './emotes';
import { getPlayerName, peerRoomId, roomCodeFromName } from './player';
import type { GameSettings } from './settings';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
        );
    });
}

/** bumped on any change that affects game logic — mismatched peers refuse to play */
export const GAME_VERSION = 12; // v12: projectiles aim/hit/land on terrain height, not y=0

const CONNECT_TIMEOUT_MS = 20_000;
const HEARTBEAT_MS = 5000;

/**
 * The quick-match endpoint (backend/matchmaking.php, bundled in dist).
 * Override per deployment with ?match=<url>.
 */
export function isLocalhost(): boolean {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** localhost (dev) or the public play host — same hosts that use the Melodan backend path */
export function isMelodanPlayHost(): boolean {
    return isLocalhost() || location.hostname === 'play.melodan.com';
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
        return 'https://play.melodan.com/backend/matchmaking.php';
    }

    return new URL('./backend/matchmaking.php', location.href).href;
}

export interface LobbyRoom {
    name: string;
    peer: string;
}

/** the menu's global chat endpoint — chat.php next to matchmaking.php */
export function chatUrl(): string {
    return new URL('chat.php', matchUrl()).href;
}

/** match telemetry endpoint — stats.php next to matchmaking.php */
export function statsUrl(): string {
    return new URL('stats.php', matchUrl()).href;
}

/** open-track profiles / soft MMR — player.php next to matchmaking.php */
export function playerUrl(): string {
    return new URL('player.php', matchUrl()).href;
}

export interface GlobalChatState {
    sticky: string | null;
    messages: { name: string; text: string; ts: number }[];
}

export async function fetchGlobalChat(): Promise<GlobalChatState> {
    const res = await fetch(`${chatUrl()}?action=list`);
    const data = (await res.json()) as Partial<GlobalChatState>;
    return { sticky: data.sticky ?? null, messages: data.messages ?? [] };
}

export async function postGlobalChat(name: string, text: string): Promise<void> {
    await fetch(
        `${chatUrl()}?action=post&name=${encodeURIComponent(name)}&text=${encodeURIComponent(text)}`,
    ).catch(() => undefined);
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
    /** the survivor's answer: seed + full action log (in the SENDER's perspective);
     *  battleElapsed = how far its currently RUNNING battle has played (null in build);
     *  phaseRemaining = the sender's live build-phase clock (replay can't
     *  reconstruct it — it isn't a logged action) */
    | {
          type: 'state';
          version: number;
          seed: number;
          settings: GameSettings;
          actions: LoggedAction[];
          battleElapsed: number | null;
          phaseRemaining: number;
      }
    /** battle playback speed — kept in sync so both players finish together */
    | { type: 'speed'; multiplier: number }
    /** chat: emote or short text — never part of game state */
    | { type: 'chat'; item: ChatItem }
    /** local battle sim finished — the peer may still be watching theirs
     *  (fast-forward speed is per-client); the next build phase waits for both */
    | { type: 'battleEnd'; round: number }
    /** post-reconnect: "I've finished rebuilding and am about to resume my
     *  clock" — a reloading peer's asset load takes real seconds, so a
     *  survivor that resumed instantly would otherwise burn that time for
     *  nothing; both sides hold until they've traded this */
    | { type: 'ready' };

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
        // 'close'/'error' on the connection AND 'error' on the peer can all
        // fire for the same underlying drop — without this guard each one
        // re-invokes the caller's onClose (e.g. restarting the reconnect
        // grace countdown mid-count)
        let closed = false;
        const fireClose = () => {
            if (closed) return;
            closed = true;
            this.onClose?.();
        };
        conn.on('close', fireClose);
        conn.on('error', fireClose);
        peer.on('error', fireClose);
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

    /** survivor who OWNS the room id: keep the peer open, wait for the rejoin.
     *  Bounded by `signal` — the caller times this out (reconnect grace window). */
    awaitReconnect(signal: AbortSignal): Promise<NetSession> {
        return awaitConnection(this.peer, this.localName, signal).then((s) => {
            s.setRemoteName(this.remoteName);
            return s;
        });
    }

    /** survivor on the other end: redial the dropped peer until it comes back,
     *  or `signal` fires (the caller's reconnect grace window elapsed). */
    async redial(signal: AbortSignal, delayMs = 3000): Promise<NetSession> {
        for (;;) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
                return await connectTo(
                    this.peer,
                    this.remoteId,
                    this.localName,
                    this.remoteName,
                    signal,
                );
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') throw e;
                await delay(delayMs, signal);
            }
        }
    }
}

// --- resume marker: enough to find the match again after a reload ---

const RESUME_KEY = 'mechili-resume';

export interface ResumeMarker {
    side: 'a' | 'b';
    names: { local: string; opponent: string };
    /** the opponent's last-known PeerJS id (redialed after our reload) */
    remotePeerId: string;
    /**
     * our own last-known PeerJS id — reopened verbatim after a reload,
     * regardless of whether it's a human-readable room id (Host Room) or an
     * auto-generated one (Matchmaking). Nothing about *which side* reloaded
     * changes this: either side's id can always be reclaimed the same way.
     */
    ownPeerId: string;
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

// --- single-player resume: full match state in session storage ---

const SINGLE_KEY = 'mechili-single';

export interface SinglePlayerSave {
    version: number;
    seed: number;
    settings: GameSettings;
    actions: LoggedAction[];
    battleElapsed: number | null;
    /** optional: older saves predate this field, hydrate falls back to a full timer */
    phaseRemaining?: number;
    localName: string;
}

export function saveSinglePlayer(state: Omit<SinglePlayerSave, 'version'>): void {
    try {
        sessionStorage.setItem(SINGLE_KEY, JSON.stringify({ version: GAME_VERSION, ...state }));
    } catch {
        /* private browsing / quota */
    }
}

export function loadSinglePlayer(): SinglePlayerSave | null {
    try {
        const raw = sessionStorage.getItem(SINGLE_KEY);
        return raw ? (JSON.parse(raw) as SinglePlayerSave) : null;
    } catch {
        return null;
    }
}

export function clearSinglePlayer(): void {
    try {
        sessionStorage.removeItem(SINGLE_KEY);
    } catch {
        /* ignore */
    }
}

/** re-registers `id` with the signaling server, riding out the brief window
 *  where it may not have released our pre-reload registration yet */
async function reopenOwnId(id: string, signal?: AbortSignal, attempts = 6, delayMs = 2000): Promise<Peer> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await openPeer(id, signal);
        } catch (e) {
            if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
            if (i === attempts - 1) throw e;
            await delay(delayMs, signal);
        }
    }
    throw new Error('Could not reopen connection');
}

/** repeatedly dials `remoteId` until it connects or `signal` fires */
async function redialUntilConnected(
    peer: Peer,
    remoteId: string,
    localName: string,
    remoteName: string,
    signal?: AbortSignal,
    delayMs = 3000,
): Promise<NetSession> {
    for (;;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            return await connectTo(peer, remoteId, localName, remoteName, signal);
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
            await delay(delayMs, signal);
        }
    }
}

/**
 * After a reload: reopen our OWN previous peer id (remembered regardless of
 * whether it happens to look like a hosted room — an auto-generated
 * Matchmaking id is just as reclaimable) and race two strategies at once:
 * wait for the peer to dial back in, or dial them ourselves at their last-
 * known id. We can't know in advance which side needs to be "the listener"
 * this time — either side could be the one that just reloaded — so trying
 * both and taking whichever connects first works regardless.
 */
export async function resumeSession(marker: ResumeMarker, signal?: AbortSignal): Promise<NetSession> {
    let peer: Peer | null = null;
    const abort = () => peer?.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    try {
        peer = await reopenOwnId(marker.ownPeerId, signal);
        const p = peer;
        const session = await raceReconnectStrategies(
            (s) => awaitConnection(p, marker.names.local, s),
            (s) => redialUntilConnected(p, marker.remotePeerId, marker.names.local, marker.names.opponent, s),
            signal,
        );
        session.setRemoteName(marker.names.opponent);
        return session;
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}

/**
 * Races "wait for the peer to dial us" against "we dial the peer" — takes
 * whichever connects first, then cancels the other so it doesn't leave a
 * dangling listener (or keep redialing) that could double-wrap some LATER,
 * unrelated reconnect on the same Peer object. Both strategies get their
 * OWN abort signal (chained to the caller's) so cancelling one never touches
 * the other. Exported: `wireReconnect` (main.ts) races
 * `NetSession.awaitReconnect`/`redial` the same way for a live (non-reload)
 * disconnect.
 */
export async function raceReconnectStrategies(
    listen: (signal: AbortSignal) => Promise<NetSession>,
    dial: (signal: AbortSignal) => Promise<NetSession>,
    signal?: AbortSignal,
): Promise<NetSession> {
    const listenAbort = new AbortController();
    const dialAbort = new AbortController();
    const onOuterAbort = () => {
        listenAbort.abort();
        dialAbort.abort();
    };
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const listening = listen(listenAbort.signal);
    const dialing = dial(dialAbort.signal);
    listening.catch(() => undefined);
    dialing.catch(() => undefined);
    try {
        const session = await Promise.race([listening, dialing]);
        listenAbort.abort();
        dialAbort.abort();
        return session;
    } finally {
        signal?.removeEventListener('abort', onOuterAbort);
    }
}

function openPeer(id?: string, signal?: AbortSignal): Promise<Peer> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const peer = id ? new Peer(id) : new Peer();
        const onAbort = () => {
            peer.destroy();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        peer.on('open', () => {
            signal?.removeEventListener('abort', onAbort);
            resolve(peer);
        });
        peer.on('error', (e) => {
            signal?.removeEventListener('abort', onAbort);
            reject(e);
        });
    });
}

function connectTo(
    peer: Peer,
    remoteId: string,
    localName: string,
    remoteName: string,
    signal?: AbortSignal,
): Promise<NetSession> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(
            () => reject(new Error('Room not found or host offline')),
            CONNECT_TIMEOUT_MS,
        );
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const conn = peer.connect(remoteId, { reliable: true });
        conn.on('open', () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(new NetSession('guest', peer, conn, localName, remoteName));
        });
        conn.on('error', (e) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(e);
        });
        peer.on('error', (e) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(e);
        });
    });
}

function awaitConnection(peer: Peer, localName: string, signal?: AbortSignal): Promise<NetSession> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        // detach on EITHER outcome — left registered, a losing race attempt
        // (see resumeSession/wireReconnect) would still be listening for a
        // NEXT incoming connection and could double-wrap a later reconnect
        const onConnection = (conn: DataConnection) => {
            conn.on('open', () => {
                signal?.removeEventListener('abort', onAbort);
                peer.off('connection', onConnection);
                resolve(new NetSession('host', peer, conn, localName, ''));
            });
        };
        const onAbort = () => {
            peer.off('connection', onConnection);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        peer.on('connection', onConnection);
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
