import { lobby, net, type SteamLobbyInfo } from 'steam-electron-build/native';
import { getAvatarDataUrl } from './avatar';
import { getPlayerName } from './player';
import {
    GAME_VERSION,
    isRevealable,
    seatVisionPolicy,
    watchLiveness,
    type GuestSession,
    type HostHub,
    type NetMessage,
    type Session,
    type SessionPending,
} from './net';
import type { CanonicalSeatDef, SeatId } from './seats';

/**
 * Steam-backed transport, parallel to `net.ts`'s PeerJS+PHP one — chosen at
 * the menu based on `steam.isAvailable()` (see main.ts), never touching the
 * web/dev build's path. The wire PROTOCOL is unchanged: every message here
 * is a `NetMessage` from `net.ts`, including the existing `starJoin`/
 * `starSetup` handshake for star-mode seat assignment — Steam only replaces
 * *how bytes move*, never what's carried over them.
 *
 * Disconnect DETECTION now matches the PeerJS path (see `SteamChannel`'s
 * `watchLiveness` wiring) — a drop is noticed within a bounded time
 * regardless of transport. Still not covered: an explicit reconnect/resume
 * handshake. Unlike PeerJS's WebRTC, Steam's own P2P layer (Steam Datagram
 * Relay via `ISteamNetworkingMessages`, underneath this wrapper's
 * connectionless `net.send`/`net.onData`) transparently retries/relay-falls-
 * back on its own — a brief drop never tears down the underlying session,
 * so once real connectivity returns, packets simply resume without any
 * application-level "I'm back" step. That means the grace window itself
 * can be much simpler here than PeerJS's redial+`matchCatchUp` dance:
 * there is nothing to reconstruct, since nothing was ever destroyed. A
 * silence that outlasts the watchdog's timeout is instead treated as
 * genuinely, permanently gone — same terminal "give up" treatment as
 * before, just now reliably triggered instead of relying on the coarser,
 * slower lobby-membership signal alone.
 */

// ── P2P message routing ──────────────────────────────────────────────────────
// `net.onData` is a single Electron IPC channel — every listener registered
// on it (one per session-like object, if each installed its own) would fire
// for every packet, from any sender. Install exactly one dispatcher here and
// fan out by sender steamId64, so SteamSession/SteamGuestSession/
// SteamStarHub can each behave like NetSession's one-handler-per-connection
// model without leaking duplicate listeners.

const routes = new Map<string, (msg: NetMessage) => void>();
let dispatcherInstalled = false;

function installDispatcher(): void {
    if (dispatcherInstalled) return;
    dispatcherInstalled = true;
    net.onData((packet) => {
        const { steamId64, data } = packet as { steamId64: string; data: NetMessage };
        routes.get(steamId64)?.(data);
    });
}

/**
 * Backlog-buffered per-remote message channel, mirroring `NetSession`/
 * `StarGuestSession`'s own single-settable-handler + backlog pattern one
 * level down, so those classes' `attach`/`once`/`send` behavior can be
 * reproduced verbatim on top of Steam P2P.
 */
class SteamChannel {
    private handler: ((msg: NetMessage) => void) | null = null;
    private readonly backlog: NetMessage[] = [];
    private readonly liveness: { markSeen: () => void; stop: () => void };
    /**
     * Fires once total silence (ping, pong, or any real message all count
     * as "alive" — see `watchLiveness`) exceeds the liveness timeout. This
     * is the PRIMARY disconnect signal here, not a fallback: Steam has no
     * per-connection close/error event the way PeerJS's DataConnection
     * does — every caller of `SteamChannel` also keeps the coarser,
     * slower lobby-membership check running alongside this as a secondary
     * fast path (see `SteamSession`/`SteamGuestSession`/`SteamStarHub`).
     */
    onClose: (() => void) | null = null;

    constructor(readonly remoteSteamId: string) {
        installDispatcher();
        routes.set(remoteSteamId, (msg) => {
            this.liveness.markSeen();
            if (msg.type === 'ping') {
                this.send({ type: 'pong' });
                return;
            }
            if (msg.type === 'pong') return;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
        // registered before this assignment, but routes' callback only ever
        // fires asynchronously (via net.onData's IPC dispatch) — never
        // synchronously during registration — so `this.liveness` is always
        // set by the time any message could actually arrive.
        this.liveness = watchLiveness(
            () => void net.send(this.remoteSteamId, { type: 'ping' }),
            () => this.onClose?.(),
        );
    }

    attach(handler: (msg: NetMessage) => void): void {
        this.handler = handler;
        while (this.backlog.length > 0) handler(this.backlog.shift()!);
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

    send(msg: NetMessage): void {
        void net.send(this.remoteSteamId, msg);
    }

    dispose(): void {
        this.liveness.stop();
        routes.delete(this.remoteSteamId);
    }
}

/** small pub-sub over a single-listener push API (mirrors the routing problem above, broadcast instead of keyed) */
function multiplexed<T>(subscribe: (cb: (v: T) => void) => void): (cb: (v: T) => void) => () => void {
    const listeners = new Set<(v: T) => void>();
    let installed = false;
    return (cb) => {
        if (!installed) {
            installed = true;
            subscribe((v) => {
                for (const l of listeners) l(v);
            });
        }
        listeners.add(cb);
        return () => listeners.delete(cb);
    };
}

const onLobbyChatUpdate = multiplexed(lobby.onChatUpdate);
/** fires when the user accepts a Steam overlay/friends-list "Join Game" invite */
export const onSteamJoinRequested = multiplexed(lobby.onJoinRequested);

// ── star rooms (every layout, 1v1 included) ───────────────────────────────────

/** Guest side of a star room over Steam — same shape as `StarGuestSession`. */
export class SteamGuestSession implements GuestSession {
    onClose: (() => void) | null = null;
    private readonly channel: SteamChannel;
    private readonly unsubscribe: () => void;

    constructor(
        readonly hostSteamId: string,
        readonly lobbyId: string,
    ) {
        this.channel = new SteamChannel(hostSteamId);
        // see SteamSession's identical guard
        let closed = false;
        const fireClose = () => {
            if (closed) return;
            closed = true;
            this.onClose?.();
        };
        this.channel.onClose = fireClose;
        this.unsubscribe = onLobbyChatUpdate(() => {
            void lobby.getMembers().then((members) => {
                if (!members.includes(hostSteamId)) fireClose();
            });
        });
    }

    attach(handler: (msg: NetMessage) => void): void {
        this.channel.attach(handler);
    }

    once(): Promise<NetMessage> {
        return this.channel.once();
    }

    send(msg: NetMessage): void {
        this.channel.send(msg);
    }

    /** Steam star matches have no reconnect story yet (still v1 scope, same
     *  as `SteamStarHub`'s onSeatSuspended/onSeatReconnected stubs) — always
     *  fails so callers fall back to today's existing suspend/give-up UX. */
    async redial(): Promise<GuestSession> {
        throw new Error('Steam star reconnect is not implemented');
    }

    close(): void {
        this.onClose = null;
        this.unsubscribe();
        this.channel.dispose();
        void lobby.leave();
    }
}

/**
 * Host side of a star (2v2+) room over Steam: a Steam lobby (host = owner)
 * with up to 4 members; the host relays via P2P to each guest's steamId64.
 * `relayBuild`/`flushAllBuffers` mirror `StarHub`'s vision-filtered
 * buffering verbatim — pure message-buffering logic with nothing PeerJS-
 * specific in it, only `send`'s bottom layer differs.
 */
export class SteamStarHub implements HostHub {
    onMessage: ((seat: SeatId, msg: NetMessage) => void) | null = null;
    onSeatDropped: ((seat: SeatId) => void) | null = null;
    // Steam star matches have no reconnect story yet (still v1 scope, same
    // as before) — a drop goes straight to onSeatDropped like it always
    // has; these three are here only to satisfy HostHub and are never fired.
    onSeatSuspended: ((seat: SeatId) => void) | null = null;
    onSeatReconnected: ((seat: SeatId) => void) | null = null;
    onSeatReclaimedFromAi: ((seat: SeatId) => void) | null = null;
    onDebugEvent: ((category: string, data?: unknown) => void) | null = null;
    /** fired whenever a guest joins/leaves before match start (lobby display) */
    onRosterChange: (() => void) | null = null;

    private readonly bySeat = new Map<SeatId, { steamId64: string; channel: SteamChannel; buffer: NetMessage[] }>();
    /** members currently mid-handshake (joined the lobby, `starJoin` not seen
     *  yet) — without this, a second `onChatUpdate` firing before the first
     *  handshake resolves would open a duplicate `SteamChannel` for the same
     *  steamId64 and orphan the first one's `.once()` forever */
    private readonly pending = new Set<string>();
    private roster: CanonicalSeatDef[];
    private accepting = false;
    /** true until leaveLobby() is called — see dropSeat's own doc comment. */
    private inLobby = true;
    /** unsubscribe from the shared onLobbyChatUpdate multiplexer, set by listen(); called from close() so a hosted match doesn't leak a listener for the process lifetime. */
    private unsubscribeLobbyUpdate: (() => void) | null = null;

    /** call once ownership of this hub passes to the running Game (see
     *  main.ts's startSteamStarMatch) — from here on, a drop no longer
     *  resets the roster entry (Game's own AI-fill logic owns that once
     *  the match has started). */
    leaveLobby(): void {
        this.inLobby = false;
    }

    constructor(
        readonly lobbyId: string,
        /** this client's own steamId64 — the lobby owner, excluded from the new-member scan in `listen()` */
        private readonly hostSteamId: string,
        initialRoster: CanonicalSeatDef[],
    ) {
        this.roster = initialRoster;
    }

    currentRoster(): CanonicalSeatDef[] {
        return this.roster;
    }

    setRosterEntry(seat: SeatId, entry: CanonicalSeatDef): void {
        this.roster = this.roster.map((s, i) => (i === seat ? entry : s));
    }

    // no reconnect story yet (see class doc comment) — nothing to mark
    // reclaimable, this just satisfies HostHub
    markReclaimable(): void {}
    isReclaimable(): boolean {
        return false;
    }

    sideOf(seat: SeatId): 'a' | 'b' {
        return this.roster[seat]?.side ?? 'a';
    }

    /** the next open (human, unfilled) seat in canonical order, or null if full */
    nextOpenSeat(): SeatId | null {
        for (let i = 1; i < this.roster.length; i++) {
            if (this.roster[i]!.controller === 'human' && !this.bySeat.has(i)) return i;
        }
        return null;
    }

    connectedSeats(): SeatId[] {
        return [...this.bySeat.keys()];
    }

    /**
     * Starts watching the Steam lobby for new members and handshaking each
     * one over P2P (`starJoin`/`starSetup`, same as PeerJS's `StarHub.listen`)
     * until every human seat is filled or the host starts early. `onJoin`
     * returns a seat to accept, or `{ reject: reason }` to decline (room
     * full, version mismatch) — unlike PeerJS's `StarHub.listen` (whose
     * callback gets the raw `DataConnection` to reply on directly), this
     * class owns the only channel to the joiner, so it sends the rejection
     * itself rather than handing that capability to the caller. Steam gives
     * no member-kick API — a rejected member just never gets a game seat
     * (acceptable for this trust model: friends playing together).
     */
    listen(
        onJoin: (name: string, version: number, avatar?: string | null) => SeatId | { reject: string },
    ): void {
        if (this.accepting) return;
        this.accepting = true;
        this.unsubscribeLobbyUpdate = onLobbyChatUpdate(() => {
            void lobby.getMembers().then((members) => {
                const present = new Set(members);
                // a member who left mid-handshake (quit before sending starJoin)
                // must not stay blocked forever — steamId64 is a persistent
                // identity, unlike a PeerJS connection attempt, so a stale
                // `pending` entry would refuse them on every future rejoin too
                for (const steamId64 of this.pending) {
                    if (!present.has(steamId64)) this.pending.delete(steamId64);
                }
                // secondary fast path for an already-seated member leaving —
                // each seat's own channel.onClose (the watchdog, see
                // SteamChannel) is the primary signal and handles this on its
                // own via dropSeat, but Steam's lobby-membership signal can
                // sometimes notice a hard leave/kick faster. dropSeat is
                // idempotent (guards on bySeat.has), so racing both is safe.
                for (const [seat, viewer] of this.bySeat) {
                    if (!present.has(viewer.steamId64)) this.dropSeat(seat);
                }
                for (const steamId64 of members) {
                    if (steamId64 === this.hostSteamId || this.pending.has(steamId64)) continue;
                    if ([...this.bySeat.values()].some((v) => v.steamId64 === steamId64)) continue;
                    this.pending.add(steamId64);
                    void this.handleNewMember(steamId64, onJoin);
                }
            });
        });
    }

    private async handleNewMember(
        steamId64: string,
        onJoin: (name: string, version: number, avatar?: string | null) => SeatId | { reject: string },
    ): Promise<void> {
        const channel = new SteamChannel(steamId64);
        // wired before the handshake resolves — without this, a peer that
        // joins the lobby and goes silent (or leaves) before ever sending
        // `starJoin` fires the liveness watchdog's onClose against a still-
        // null handler, so the channel is never disposed and its `routes`
        // entry (plus this steamId64's `pending` membership) leaks for the
        // rest of the process's life.
        let settled = false;
        channel.onClose = () => {
            if (settled) return;
            settled = true;
            this.pending.delete(steamId64);
            channel.dispose();
        };
        const msg = await channel.once();
        if (settled) return;
        settled = true;
        this.pending.delete(steamId64);
        if (msg.type !== 'starJoin') {
            channel.dispose();
            return;
        }
        const result = onJoin(msg.name, msg.version, msg.avatar);
        if (typeof result !== 'number') {
            channel.send({ type: 'starRejected', reason: result.reject });
            channel.dispose();
            return;
        }
        const seat = result;
        channel.attach((m) => this.onMessage?.(seat, m));
        channel.onClose = () => this.dropSeat(seat);
        this.bySeat.set(seat, { steamId64, channel, buffer: [] });
        this.onRosterChange?.();
    }

    /**
     * A seat's connection is gone for good. Unlike PeerJS's `StarHub`,
     * there's no grace window here yet — see this file's own doc comment
     * for why that's a smaller gap than it looks (Steam's P2P self-heals a
     * brief drop with no app-level step needed at all; this only ever
     * fires once the liveness watchdog has given up, or Steam's lobby
     * signal reports a genuine departure). Idempotent via the `bySeat.has`
     * guard: the watchdog and the lobby-scan secondary path in `listen()`
     * can both try to drop the same seat.
     *
     * Pre-match (`inLobby`), this ALSO resets the roster entry back to an
     * open "Waiting…" slot instead of leaving the departed player's stale
     * name in place — onSeatDropped is never wired up until Game's own
     * wireStar() runs at match start, so nothing else would ever do this
     * for a lobby-phase drop (found live: host still showed a guest in
     * the roster table after that guest clicked Cancel).
     */
    private dropSeat(seat: SeatId): void {
        if (!this.bySeat.has(seat)) return;
        this.bySeat.get(seat)!.channel.dispose();
        this.bySeat.delete(seat);
        if (this.inLobby) {
            const entry = this.roster[seat];
            if (entry) this.setRosterEntry(seat, { side: entry.side, controller: 'human', name: 'Waiting…' });
        }
        this.onRosterChange?.();
        this.onSeatDropped?.(seat);
    }

    /**
     * Host explicitly removes a still-joined seat before the match has
     * started — a lobby-only concept, distinct from dropSeat's "gone for
     * good" (which still fires onSeatDropped, a signal meaningless here
     * since Game doesn't exist yet). Resets the roster entry straight
     * back to an open "Waiting…" slot so nextOpenSeat() offers it again
     * immediately, and to keep the lobby roster table from showing the
     * kicked player's stale name.
     */
    kickSeat(seat: SeatId): void {
        if (seat === 0) return; // the host can't kick themselves
        const viewer = this.bySeat.get(seat);
        if (!viewer) return;
        viewer.channel.send({ type: 'starRejected', reason: 'Kicked by the host.' });
        viewer.channel.dispose();
        this.bySeat.delete(seat);
        const entry = this.roster[seat];
        if (entry) this.setRosterEntry(seat, { side: entry.side, controller: 'human', name: 'Waiting…' });
        this.onRosterChange?.();
    }

    send(seat: SeatId, msg: NetMessage): void {
        this.bySeat.get(seat)?.channel.send(msg);
    }

    broadcast(msg: NetMessage, exclude?: SeatId): void {
        for (const [seat, { channel }] of this.bySeat) {
            if (seat === exclude) continue;
            channel.send(msg);
        }
    }

    /** Same vision gate as PeerJS `StarHub.relayBuild` — see `isRevealable`. */
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
        sideLocked: (side: 'a' | 'b') => boolean,
    ): void {
        const fromSide = this.sideOf(fromSeat);
        for (const [seat, viewer] of this.bySeat) {
            const policy = seatVisionPolicy(this.sideOf(seat));
            // flush newly-entitled backlog even for the locking sender
            // (must not echo `msg` back to them — see StarHub.relayBuild)
            if (
                viewer.buffer.length > 0 &&
                [...policy.ownSides].every((side) => sideLocked(side))
            ) {
                for (const buffered of viewer.buffer) viewer.channel.send(buffered);
                viewer.buffer.length = 0;
            }
            if (seat === fromSeat) continue;
            if (isRevealable(policy, fromSide, sideLocked)) {
                viewer.channel.send(msg);
            } else {
                viewer.buffer.push(msg);
            }
        }
    }

    flushAllBuffers(): void {
        for (const viewer of this.bySeat.values()) {
            for (const buffered of viewer.buffer) viewer.channel.send(buffered);
            viewer.buffer.length = 0;
        }
    }

    /** HostHub interface conformance — see StarHub's own doc comment for
     *  why this exists. Steam star has no reconnect story yet (this class's
     *  own doc comment), so nothing calls this today, but keeping the real
     *  implementation (not a stub) means it's already correct if that ever
     *  changes. */
    seedBuildBuffer(seat: SeatId, msg: Extract<NetMessage, { type: 'action' | 'undo' }>): void {
        this.bySeat.get(seat)?.buffer.push(msg);
    }

    close(): void {
        this.unsubscribeLobbyUpdate?.();
        this.unsubscribeLobbyUpdate = null;
        for (const { channel } of this.bySeat.values()) channel.dispose();
        this.bySeat.clear();
        void lobby.leave();
    }
}

/** Host a 2v2+ star room over Steam: opens a lobby, returns the hub for the
 *  caller to drive join/seat-assignment/start (mirrors `hostStarRoom`). */
export async function hostSteamStarRoom(
    initialRoster: CanonicalSeatDef[],
    isPublic: boolean,
    mode: '1v1' | '2v2' = '2v2',
): Promise<{ hub: SteamStarHub; lobbyId: string }> {
    const room = await lobby.create(isPublic ? 'public' : 'private', initialRoster.length);
    if (!room) throw new Error('Could not open a Steam lobby — is Steam running?');
    // tagged even for a private (invite-only) lobby — see hostSteamRoom's note.
    // The mode is what the room list shows, so it has to be the real one: this
    // used to be hardcoded '2v2' and mislabelled every 1v1 star room.
    await lobby.mergeFullData({ mode, game: 'melodan', version: String(GAME_VERSION) });
    return { hub: new SteamStarHub(room.id, room.owner, initialRoster), lobbyId: room.id };
}

/** Join a 2v2+ star room over Steam by lobby id — same `starJoin` handshake as `joinStarRoom`. */
export async function joinSteamStarRoom(lobbyId: string): Promise<SteamGuestSession> {
    const room = await lobby.join(lobbyId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    const session = new SteamGuestSession(room.owner, lobbyId);
    session.send({ type: 'starJoin', name: getPlayerName(), version: GAME_VERSION, avatar: getAvatarDataUrl() });
    return session;
}

/**
 * Accept a Steam overlay/friends-list "Join Game" invite. Every lobby is a
 * star lobby regardless of layout — 1v1 is just a two-seat roster — so the
 * guest session is the same either way; `mode` is reported only because the
 * caller may want it for status text.
 */
export async function joinSteamLobby(
    lobbySteamId: string,
): Promise<{ mode: '1v1' | '2v2'; session: SteamGuestSession }> {
    const room = await lobby.join(lobbySteamId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    const session = new SteamGuestSession(room.owner, room.id);
    session.send({ type: 'starJoin', name: getPlayerName(), version: GAME_VERSION, avatar: getAvatarDataUrl() });
    return { mode: room.data.mode === '1v1' ? '1v1' : '2v2', session };
}

/** anonymous matching (the "Play" button): join any open public star lobby of
 *  the same layout, or host one if none exists — mirrors main.ts's existing
 *  PHP-room discover-or-host logic for the same button. */
export async function hostOrJoinSteamStar(
    initialRoster: CanonicalSeatDef[],
    mode: '1v1' | '2v2' = '2v2',
): Promise<{ role: 'host'; hub: SteamStarHub; lobbyId: string } | { role: 'guest'; session: SteamGuestSession; lobbyId: string }> {
    const openRooms = await lobby.getLobbies();
    // Same filter the browsable room list applies: matching on mode alone let
    // quick match connect to a lobby running another build, only to be rejected
    // by the host's version check after the round trip.
    const open = openRooms.find(
        (r) =>
            r.data.game === 'melodan' &&
            (!r.data.version || r.data.version === String(GAME_VERSION)) &&
            r.data.mode === mode &&
            r.memberCount < (r.memberLimit ?? initialRoster.length),
    );
    if (open) {
        const session = await joinSteamStarRoom(open.id);
        return { role: 'guest', session, lobbyId: open.id };
    }
    const { hub, lobbyId } = await hostSteamStarRoom(initialRoster, true, mode);
    return { role: 'host', hub, lobbyId };
}

export type { SteamLobbyInfo };
