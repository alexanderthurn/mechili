import Peer, { type DataConnection } from 'peerjs';
import type { Action, LoggedAction } from './actions';
import type { Opponent } from './ai';
import type { ChatItem } from './emotes';
import { getPlayerName, peerRoomId, roomCodeFromName } from './player';
import type { CanonicalSeatDef, SeatId } from './seats';
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
export const GAME_VERSION = 14; // v14: deployCaughtUp gate before battle (fog flush race)

const CONNECT_TIMEOUT_MS = 20_000;
const HEARTBEAT_MS = 5000;

/**
 * The quick-match endpoint (backend/matchmaking.php, bundled in dist).
 * Override per deployment with ?match=<url>.
 */
export function isLocalhost(): boolean {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
    // LAN dev: a phone/tablet reaches the vite server via the machine's
    // private address or mDNS name — same rules as localhost apply
    if (h.endsWith('.local')) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
    return false;
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
    mode: '1v1' | '2v2';
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

/** community suggestions — suggest.php next to matchmaking.php */
export function suggestUrl(): string {
    return new URL('suggest.php', matchUrl()).href;
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
 * Everything that crosses the wire. Build-phase `action`/`undo` are withheld
 * until the *receiving* peer has locked in (sender-side buffer). Spectators
 * get a per-connection vision policy (default: battle-only).
 */
export type NetMessage =
    | { type: 'hello'; name: string }
    | { type: 'setup'; version: number; seed: number; settings: GameSettings; hostName: string; guestName: string }
    | { type: 'starter'; cardId: string }
    | { type: 'action'; round: number; action: Action }
    /** `seat` is unused by classic 1v1 (implicitly "the opponent"); star mode
     *  needs it since more than one remote seat can send an undo */
    | { type: 'undo'; round: number; seat?: SeatId }
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
    /** chat: emote or short text — never part of game state. `from` is
     *  required (not just implied by "whoever's on the other end of this
     *  connection") because spectators mean more than one possible sender —
     *  the host relays a spectator's chat to the player link too. */
    | { type: 'chat'; item: ChatItem; from: { name: string; role: 'player' | 'spectator' } }
    /** local battle sim finished — the peer may still be watching theirs
     *  (fast-forward speed is per-client); the next build phase waits for both */
    /** `seat` unused by classic 1v1 (implicitly "the opponent"); star mode's
     *  host needs it to attribute + aggregate across N watchers */
    | { type: 'battleEnd'; round: number; seat?: SeatId }
    /** post-reconnect: "I've finished rebuilding and am about to resume my
     *  clock" — a reloading peer's asset load takes real seconds, so a
     *  survivor that resumed instantly would otherwise burn that time for
     *  nothing; both sides hold until they've traded this */
    | { type: 'ready' }
    /** spectator's opening handshake, sent immediately on connecting to the
     *  host's dedicated broadcast Peer (never the player link) */
    | { type: 'spectate'; name: string; version: number }
    /** host's reply: everything needed to catch up to the CURRENT visible
     *  state for this spectator's vision policy */
    | {
          type: 'spectateAccepted';
          version: number;
          seed: number;
          settings: GameSettings;
          actions: LoggedAction[];
          battleElapsed: number | null;
          phaseRemaining: number;
          roster: RosterEntry[];
          vision: SpectatorVision;
      }
    | { type: 'spectateRejected'; reason: string }
    /** full roster snapshot, broadcast to players + spectators whenever a
     *  spectator joins or leaves */
    | { type: 'roster'; entries: RosterEntry[] }
    /** host pushes an updated vision policy to one spectator */
    | { type: 'visionUpdate'; vision: SpectatorVision }
    /** guest asks host to grant/revoke live deploy vision for a spectator
     *  (guest may only grant its own seat `'b'`) */
    | { type: 'spectateGrant'; spectatorName: string; seat: 'a' | 'b'; grant: boolean }
    /**
     * Sent after flushing the outbound build buffer to the peer. Battle must
     * not start until both sides have locked in AND each has received the
     * other's `deployCaughtUp` (otherwise the second locker races ahead of
     * the first's sell/buys still in flight).
     */
    | { type: 'deployCaughtUp'; round: number }
    // ---- star topology (2v2+, N seats): host-relayed, own message family so
    // the classic 2-seat path above stays completely untouched ------------
    /** guest's opening handshake on connecting to a star (2v2+) room */
    | { type: 'starJoin'; name: string; version: number }
    /** host's per-recipient match setup: canonical roster + which seat is theirs.
     *  `settings.seats` is unset here — the LOCAL roster is derived per client
     *  via `localizeRoster(roster, yourSide)`, never sent pre-relabeled. */
    | {
          type: 'starSetup';
          version: number;
          seed: number;
          settings: GameSettings;
          roster: CanonicalSeatDef[];
          yourSeat: SeatId;
          yourSide: 'a' | 'b';
      }
    /** lobby membership, broadcast whenever a seat's controller/name changes
     *  (a friend joins, an empty seat gets AI-filled at start) */
    | { type: 'starRoster'; roster: CanonicalSeatDef[] }
    /** host declines a join (room full, version mismatch) */
    | { type: 'starRejected'; reason: string }
    /** host → each guest once every seat has locked in for the round and the
     *  fog buffers are flushed (guaranteed delivered-before on an ordered
     *  connection, so no separate per-client ack round-trip is needed) */
    | { type: 'starBattleStart'; round: number }
    /** host → every guest: everyone (all human seats) finished watching the
     *  battle — start the next build phase now (fast-forward speed is
     *  per-client, so this needs the same host-arbitrated go-signal as
     *  starBattleStart rather than each client deciding independently) */
    | { type: 'starNextRound'; round: number };

/**
 * What a spectator may see during the build phase.
 * - `battle`: withhold build actions until both players have locked in
 * - `live`: stream build actions for the listed seats immediately
 *   (`'a'` = host seat, `'b'` = guest seat)
 */
export type SpectatorVision =
    | { mode: 'battle' }
    | { mode: 'live'; seats: Array<'a' | 'b'> };

/**
 * One seat at the match, for roster display. `team` is a plain string (not
 * the current 2-value `Team` union) and `role`/team are already separated —
 * neither should need to change shape when a future multi-player mode adds
 * more than two player seats.
 */
export interface RosterEntry {
    name: string;
    role: 'player' | 'spectator';
    team?: string;
}

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

/**
 * Host-side only, for 2v2+ "star" rooms (settings.seats.length > 2): one
 * Peer accepting a connection per REMOTE seat-holding guest (never between
 * guests — that's the whole point of the star: guests keep the exact same
 * single-connection shape they already have for 1v1, only the HOST's side
 * fans out). Deliberately parallel to `SpectatorHub`'s proven pattern
 * (per-viewer buffer, vision-filtered relay) rather than a new design —
 * lower risk than inventing a mesh from scratch. Pure relay: it knows
 * connections, seats and sides, but NOT game rules — gating/AI/dispatch
 * all stay in `Game`, exactly like `NetSession` today.
 *
 * Trust note: the host sees every guest's traffic in cleartext (listen-
 * server model) — a deliberate, documented v1 tradeoff over a full mesh,
 * acceptable for friend games. See TEAM_MODES_PLAN.md §3.
 */
export class StarHub {
    private readonly bySeat = new Map<SeatId, { conn: DataConnection; buffer: NetMessage[] }>();
    private roster: CanonicalSeatDef[];

    /** fired whenever a guest joins/leaves before match start (lobby display) */
    onRosterChange: (() => void) | null = null;
    /** fired once a connected guest sends a message post-setup (actions, chat, etc.) */
    onMessage: ((seat: SeatId, msg: NetMessage) => void) | null = null;
    /** fired if a connected (post-setup) guest's connection drops */
    onSeatDropped: ((seat: SeatId) => void) | null = null;

    private constructor(
        private readonly peer: Peer,
        initialRoster: CanonicalSeatDef[],
    ) {
        this.roster = initialRoster;
    }

    static async open(initialRoster: CanonicalSeatDef[], id?: string): Promise<StarHub> {
        const peer = await openPeer(id);
        return new StarHub(peer, initialRoster);
    }

    get peerId(): string {
        return this.peer.id;
    }

    currentRoster(): CanonicalSeatDef[] {
        return this.roster;
    }

    sideOf(seat: SeatId): 'a' | 'b' {
        return this.roster[seat]?.side ?? 'a';
    }

    /** the next open (human, unfilled) seat in canonical order, or null if full */
    nextOpenSeat(): SeatId | null {
        for (let i = 1; i < this.roster.length; i++) {
            // seat 0 is always the host itself
            if (this.roster[i]!.controller === 'human' && !this.bySeat.has(i)) return i;
        }
        return null;
    }

    /**
     * Accepts connections until every human seat is filled or the host
     * starts early (remaining open seats get AI-filled by the caller).
     * `onJoin` may reject (room full, version mismatch) before `admit`.
     */
    listen(onJoin: (name: string, version: number, conn: DataConnection) => SeatId | null): void {
        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                const onData = (data: unknown) => {
                    const msg = data as NetMessage;
                    if (msg.type !== 'starJoin') {
                        conn.close();
                        return;
                    }
                    conn.off('data', onData);
                    const seat = onJoin(msg.name, msg.version, conn);
                    if (seat === null) return; // onJoin already sent starRejected + closed
                    this.bySeat.set(seat, { conn, buffer: [] });
                    conn.on('data', (d) => this.onMessage?.(seat, d as NetMessage));
                    conn.on('close', () => this.dropSeat(seat));
                    conn.on('error', () => this.dropSeat(seat));
                    this.onRosterChange?.();
                };
                conn.on('data', onData);
            });
        });
    }

    /** call once a joining connection is accepted, before/with `starSetup` */
    setRosterEntry(seat: SeatId, entry: CanonicalSeatDef): void {
        this.roster = this.roster.map((s, i) => (i === seat ? entry : s));
    }

    private dropSeat(seat: SeatId): void {
        if (!this.bySeat.delete(seat)) return;
        this.onSeatDropped?.(seat);
        this.onRosterChange?.();
    }

    send(seat: SeatId, msg: NetMessage): void {
        this.bySeat.get(seat)?.conn.send(msg);
    }

    /** every connected guest (not the host's own seat(s)); `exclude` skips
     *  one seat — used when relaying a message THAT seat just sent, so it
     *  doesn't get echoed back to its own sender */
    broadcast(msg: NetMessage, exclude?: SeatId): void {
        for (const [seat, { conn }] of this.bySeat) {
            if (seat === exclude) continue;
            conn.send(msg);
        }
    }

    /**
     * Vision-filtered relay of one build-phase action/undo: live to every
     * ally (same side) recipient immediately; buffered per-recipient for
     * enemy-side recipients until `sideLocked(fromSide)` is true, at which
     * point that recipient's WHOLE buffer flushes (only one enemy side
     * exists per recipient — Tier 1, sides stay binary).
     */
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
        sideLocked: (side: 'a' | 'b') => boolean,
    ): void {
        const fromSide = this.sideOf(fromSeat);
        for (const [seat, viewer] of this.bySeat) {
            if (seat === fromSeat) continue; // never echo back to the sender
            const isAlly = this.sideOf(seat) === fromSide;
            if (isAlly || sideLocked(fromSide)) {
                if (viewer.buffer.length > 0) {
                    for (const buffered of viewer.buffer) viewer.conn.send(buffered);
                    viewer.buffer.length = 0;
                }
                viewer.conn.send(msg);
            } else {
                viewer.buffer.push(msg);
            }
        }
    }

    /** force-flush every recipient's buffer (all sides now locked) */
    flushAllBuffers(): void {
        for (const viewer of this.bySeat.values()) {
            for (const buffered of viewer.buffer) viewer.conn.send(buffered);
            viewer.buffer.length = 0;
        }
    }

    connectedSeats(): SeatId[] {
        return [...this.bySeat.keys()];
    }

    close(): void {
        for (const { conn } of this.bySeat.values()) conn.close();
        this.bySeat.clear();
        this.peer.destroy();
    }
}

/**
 * Guest side of a star (2v2+) room: a single connection to the host,
 * shaped like `NetSession` (attach/send/once) but without the host/guest
 * role split — a star guest never accepts inbound connections itself.
 */
export class StarGuestSession {
    onClose: (() => void) | null = null;
    private handler: ((msg: NetMessage) => void) | null = null;
    private readonly backlog: NetMessage[] = [];

    constructor(
        private readonly peer: Peer,
        private readonly conn: DataConnection,
    ) {
        conn.on('data', (data) => {
            const msg = data as NetMessage;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
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

    attach(handler: (msg: NetMessage) => void): void {
        this.handler = handler;
        while (this.backlog.length > 0) handler(this.backlog.shift()!);
    }

    send(msg: NetMessage): void {
        this.conn.send(msg);
    }

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
}

/**
 * What `Game` needs to know about its star-mode connection: whether it's
 * the relay (host) or a spoke (guest), and which canonical seat this
 * client occupies. `mySeat` is NOT necessarily 0 for a guest — only the
 * host is guaranteed seat 0 by the join-order convention.
 */
export type StarRole =
    | { role: 'host'; hub: StarHub; mySeat: SeatId }
    | { role: 'guest'; session: StarGuestSession; mySeat: SeatId };

/**
 * Host a 2v2+ star room: opens a peer, registers it in the public/room-code
 * lobby exactly like `hostLobby`, and returns the `StarHub` for the caller
 * to drive the join/seat-assignment/start flow (kept in main.ts, alongside
 * the seat-picker UI — connection plumbing only lives here).
 */
export async function hostStarRoom(
    initialRoster: CanonicalSeatDef[],
    onStatus: (status: string) => void,
): Promise<{ hub: StarHub; roomId: string; cleanup: () => void }> {
    const name = getPlayerName();
    const roomId = peerRoomId(name);
    onStatus('Opening room…');
    let hub: StarHub;
    try {
        hub = await StarHub.open(initialRoster, roomId);
    } catch {
        throw new Error(`Name "${name}" is already hosting — pick another username`);
    }
    // reuses the SAME room-code registration as 1v1 custom rooms, tagged
    // mode=2v2 so the room list can route joiners to the star join flow
    await lobbyRegister(hub.peerId, name, '2v2');
    const heartbeat = setInterval(() => void lobbyRegister(hub.peerId, name, '2v2'), HEARTBEAT_MS);
    return {
        hub,
        roomId,
        cleanup: () => {
            clearInterval(heartbeat);
            void lobbyLeave(hub.peerId);
        },
    };
}

/** Join a 2v2+ star room by the host's username (room code) — same lookup as `joinLobby`. */
export function joinStarRoom(hostName: string, onStatus: (status: string) => void): SessionPending<StarGuestSession> {
    let peer: Peer | null = null;
    const localName = getPlayerName();
    const code = roomCodeFromName(hostName);
    if (!code) {
        return { session: Promise.reject(new Error('Invalid room name')), cancel: () => undefined };
    }
    const session = (async () => {
        onStatus(`Joining "${hostName.trim()}"…`);
        peer = await openPeer();
        const conn = await new Promise<DataConnection>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Room not found or host offline')),
                CONNECT_TIMEOUT_MS,
            );
            const c = peer!.connect(peerRoomId(hostName), { reliable: true });
            c.on('open', () => {
                clearTimeout(timer);
                resolve(c);
            });
            c.on('error', (e) => {
                clearTimeout(timer);
                reject(e);
            });
        });
        conn.send({ type: 'starJoin', name: localName, version: GAME_VERSION });
        return new StarGuestSession(peer, conn);
    })();
    return { session, cancel: () => peer?.destroy() };
}

/** identical shape to {@link Pending}, generalized (kept separate — `Pending` stays untouched for the existing 1v1 flow) */
export interface SessionPending<T> {
    session: Promise<T>;
    cancel: () => void;
}

/**
 * Host-side only: a dedicated PeerJS connection point, entirely separate
 * from the player-link `NetSession`/`Peer`, that accepts any number of
 * spectator connections for the life of the match. Kept independent on
 * purpose — the player link already has its own reconnect machinery (grace
 * timers, the redial/listen race); folding spectator traffic into that same
 * Peer object would mean teaching all of it to tell a spectator apart from
 * a returning opponent. A stranger dialing the WRONG endpoint (this one)
 * can only ever become a spectator, never accidentally get treated as the
 * live opponent.
 *
 * Known limitation (acceptable for now): if the host reloads, this Peer
 * object dies with everything else and spectators are dropped — there is no
 * spectator-side reconnect yet.
 */
export class SpectatorHub {
    private readonly viewers = new Map<
        DataConnection,
        { name: string; vision: SpectatorVision; buildBuffer: NetMessage[] }
    >();

    /** fired whenever a spectator connects or disconnects */
    onRosterChange: (() => void) | null = null;
    /** fired for chat relayed FROM a spectator (needs mirroring to the
     *  player link and every other spectator) */
    onSpectatorChat: ((name: string, item: ChatItem) => void) | null = null;

    private constructor(private readonly peer: Peer) {}

    static async open(): Promise<SpectatorHub> {
        const peer = await openPeer();
        return new SpectatorHub(peer);
    }

    get peerId(): string {
        return this.peer.id;
    }

    get count(): number {
        return this.viewers.size;
    }

    names(): string[] {
        return [...this.viewers.values()].map((v) => v.name);
    }

    /** current vision per spectator name (for pause-menu grant toggles) */
    visionByName(): { name: string; vision: SpectatorVision }[] {
        return [...this.viewers.values()].map((v) => ({ name: v.name, vision: v.vision }));
    }

    /**
     * Wires the persistent connection acceptor — unlike `awaitConnection`,
     * this never detaches, since any number of spectators may join over the
     * match's lifetime. `onJoin` decides whether to accept (e.g. version
     * check) and, if so, is responsible for replying with `spectateAccepted`
     * (or `spectateRejected` + closing the connection).
     */
    listen(onJoin: (name: string, version: number, conn: DataConnection) => void): void {
        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                const onData = (data: unknown) => {
                    const msg = data as NetMessage;
                    if (msg.type !== 'spectate') {
                        conn.close();
                        return;
                    }
                    conn.off('data', onData);
                    conn.on('data', (d) => this.onData(conn, d as NetMessage));
                    onJoin(msg.name, msg.version, conn);
                };
                conn.on('data', onData);
                conn.on('close', () => this.drop(conn));
                conn.on('error', () => this.drop(conn));
            });
        });
    }

    /** call once `onJoin` has accepted a spectator (sent `spectateAccepted`) */
    admit(name: string, conn: DataConnection, vision: SpectatorVision = { mode: 'battle' }): void {
        this.viewers.set(conn, { name, vision, buildBuffer: [] });
        this.onRosterChange?.();
    }

    /** grant or revoke live build vision for a seat on a named spectator */
    setSeatLive(spectatorName: string, seat: 'a' | 'b', grant: boolean): SpectatorVision | null {
        for (const [conn, viewer] of this.viewers) {
            if (viewer.name !== spectatorName) continue;
            const seats =
                viewer.vision.mode === 'live' ? new Set(viewer.vision.seats) : new Set<'a' | 'b'>();
            if (grant) seats.add(seat);
            else seats.delete(seat);
            viewer.vision = seats.size === 0 ? { mode: 'battle' } : { mode: 'live', seats: [...seats] };
            conn.send({ type: 'visionUpdate', vision: viewer.vision });
            return viewer.vision;
        }
        return null;
    }

    private onData(conn: DataConnection, msg: NetMessage): void {
        if (msg.type !== 'chat') return; // spectators may only ever chat
        const viewer = this.viewers.get(conn);
        if (!viewer) return;
        this.onSpectatorChat?.(viewer.name, msg.item);
    }

    private drop(conn: DataConnection): void {
        if (!this.viewers.delete(conn)) return;
        this.onRosterChange?.();
    }

    /**
     * Fan a non-build message to every spectator immediately.
     * Build `action`/`undo` use {@link relayBuild} instead.
     */
    broadcast(msg: NetMessage): void {
        for (const conn of this.viewers.keys()) conn.send(msg);
    }

    /**
     * Relay a build-phase action/undo with vision filtering.
     * `seat` is which player originated it (`'a'` host, `'b'` guest).
     * When `bothLocked`, battle-vision spectators receive their backlog + this msg.
     */
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        seat: 'a' | 'b',
        bothLocked: boolean,
    ): void {
        for (const [conn, viewer] of this.viewers) {
            const live =
                viewer.vision.mode === 'live' && viewer.vision.seats.includes(seat);
            if (live || bothLocked) {
                if (viewer.buildBuffer.length > 0) {
                    for (const buffered of viewer.buildBuffer) conn.send(buffered);
                    viewer.buildBuffer.length = 0;
                }
                conn.send(msg);
            } else {
                viewer.buildBuffer.push(msg);
            }
        }
    }

    /** flush every spectator's build backlog (both players locked / battle start) */
    flushBuildBuffers(): void {
        for (const [conn, viewer] of this.viewers) {
            for (const buffered of viewer.buildBuffer) conn.send(buffered);
            viewer.buildBuffer.length = 0;
        }
    }

    close(): void {
        for (const conn of this.viewers.keys()) conn.close();
        this.viewers.clear();
        this.peer.destroy();
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

async function lobbyRegister(peerId: string, name: string, mode: '1v1' | '2v2' = '1v1'): Promise<void> {
    await fetch(
        `${matchUrl()}?action=host&peer=${encodeURIComponent(peerId)}&name=${encodeURIComponent(name)}&mode=${mode}`,
    ).catch(() => undefined);
}

/**
 * Discovery for `SpectatorHub`/`joinAsSpectator`: register (and heartbeat)
 * a live match's spectate endpoint under its room name, so a spectator can
 * find it later. `roomName` is whatever the host is already discoverable
 * as — reuses the room-name-lookup convention `joinLobby`/`peerRoomId`
 * already establish, just tagged separately so it never shows up in the
 * normal "join as a player" room list.
 */
export function registerSpectateEndpoint(peerId: string, roomName: string): () => void {
    let stopped = false;
    const beat = () => {
        void fetch(
            `${matchUrl()}?action=spectate-register&peer=${encodeURIComponent(peerId)}&name=${encodeURIComponent(roomName)}`,
        ).catch(() => undefined);
    };
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    return () => {
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat);
        void lobbyLeave(peerId);
    };
}

/** Look up a live match's spectate endpoint by room name, if one is open. */
export async function lookupSpectateEndpoint(roomName: string): Promise<string | null> {
    const res = await fetch(`${matchUrl()}?action=spectate-lookup&name=${encodeURIComponent(roomName)}`);
    const data = (await res.json()) as { peer?: string | null };
    return data.peer ?? null;
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

/**
 * A spectator's own connection to a host's `SpectatorHub`. Deliberately NOT
 * a `NetSession` — there's no host/guest role, no redial/reconnect, no
 * `setup`/`hello` handshake; it's a plain receive-and-occasionally-chat link
 * to whatever the host is mirroring.
 */
export class SpectatorSession {
    private handler: ((msg: NetMessage) => void) | null = null;
    private readonly backlog: NetMessage[] = [];
    onClose: (() => void) | null = null;

    constructor(
        private readonly peer: Peer,
        private readonly conn: DataConnection,
    ) {
        conn.on('data', (data) => {
            const msg = data as NetMessage;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
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

    attach(handler: (msg: NetMessage) => void): void {
        this.handler = handler;
        while (this.backlog.length > 0) handler(this.backlog.shift()!);
    }

    send(msg: NetMessage): void {
        this.conn.send(msg);
    }

    close(): void {
        this.onClose = null;
        this.conn.close();
        this.peer.destroy();
    }
}

export interface SpectateResult {
    session: SpectatorSession;
    seed: number;
    settings: GameSettings;
    actions: LoggedAction[];
    battleElapsed: number | null;
    phaseRemaining: number;
    roster: RosterEntry[];
    vision: SpectatorVision;
}

/**
 * Join an in-progress match as a spectator, given the host's dedicated
 * broadcast peer id (looked up via matchmaking, see `lookupSpectateEndpoint`).
 * Returns everything needed to reconstruct current state locally (same
 * shape of need as a reconnect) plus the live session for the ongoing
 * stream. This is connection-level only — feeding the result into an actual
 * on-screen (read-only) match view is separate, later work.
 */
export async function joinAsSpectator(
    hostPeerId: string,
    name: string,
    signal?: AbortSignal,
): Promise<SpectateResult> {
    const peer = await openPeer(undefined, signal);
    try {
        const conn = await new Promise<DataConnection>((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            const timer = setTimeout(
                () => reject(new Error('Host not found or offline')),
                CONNECT_TIMEOUT_MS,
            );
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            const c = peer.connect(hostPeerId, { reliable: true });
            c.on('open', () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(c);
            });
            c.on('error', (e) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(e);
            });
        });
        conn.send({ type: 'spectate', name, version: GAME_VERSION });
        const msg = await new Promise<NetMessage>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Host did not respond')), CONNECT_TIMEOUT_MS);
            const onData = (data: unknown) => {
                clearTimeout(timer);
                conn.off('data', onData);
                resolve(data as NetMessage);
            };
            conn.on('data', onData);
        });
        if (msg.type === 'spectateRejected') throw new Error(msg.reason);
        if (msg.type !== 'spectateAccepted') throw new Error('Unexpected reply from host');
        if (msg.version !== GAME_VERSION) throw new Error('Version mismatch');
        return {
            session: new SpectatorSession(peer, conn),
            seed: msg.seed,
            settings: msg.settings,
            actions: msg.actions,
            battleElapsed: msg.battleElapsed,
            phaseRemaining: msg.phaseRemaining,
            roster: msg.roster,
            vision: msg.vision,
        };
    } catch (e) {
        peer.destroy();
        throw e;
    }
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
