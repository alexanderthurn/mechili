import { lobby, net, steam, type SteamLobbyInfo } from 'steam-electron-build/native';
import { getAvatarDataUrl } from './avatar';
import { activeLoadout } from './loadouts';
import { getPlayerName } from './player';
import {
    CONNECT_TIMEOUT_MS,
    GAME_VERSION,
    STAR_RECONNECT_GRACE_MS,
    isRevealable,
    seatVisionPolicy,
    watchLiveness,
    type GuestSession,
    type HostHub,
    type NetMessage,
    type SessionPending,
    type SpectateResult,
    type SpectatorLink,
    type SpectatorTransport,
    type SpectatorViewerLink,
} from './net';
import type { CanonicalSeatDef, SeatId } from './seats';
import type { Loadout } from './techCatalog';
import { t } from '../i18n';

/**
 * Steam-backed transport, parallel to `net.ts`'s PeerJS+PHP one — chosen at
 * the menu based on `steam.isAvailable()` (see main.ts), never touching the
 * web/dev build's path. The wire PROTOCOL is unchanged: every message here
 * is a `NetMessage` from `net.ts`, including the existing `starJoin`/
 * `starSetup` handshake for star-mode seat assignment — Steam only replaces
 * *how bytes move*, never what's carried over them.
 *
 * Underneath, the runtime speaks `ISteamNetworkingSockets` (NOT
 * `ISteamNetworkingMessages`): a P2P listen socket, `connectP2P` per remote,
 * an explicit accept, and a poll group drained on a timer — see
 * steam-electron-build's `runtime/main.cjs`. `net.send`/`net.onData` hide all
 * of that behind a steamId64-addressed send and one inbound callback, which
 * READS connectionless but is not: there are real connection handles with
 * real state. Two consequences that matter up here:
 *
 * - A send to a remote we have no live connection to dials one and queues
 *   the payload until it is established, so the first message of a
 *   handshake never needs the connection to exist yet.
 * - A connection CAN die (`ProblemDetectedLocally`, closed by peer), and
 *   the runtime forgets it when that happens. Steam Datagram Relay makes
 *   that rarer than raw WebRTC — it retries and falls back to relays on its
 *   own — but "the session survives any blip, so packets just resume" is
 *   NOT a guarantee to build on. The next send simply dials again, which is
 *   transparent to the sender but is a reconnect, not an unbroken session.
 *
 * So reconnection here is explicit, exactly as on the PeerJS path, and for
 * the same reason: the transport recovering its socket says nothing about
 * the HOST still believing we hold a seat. Detection is `SteamChannel`'s
 * `watchLiveness` (the primary signal — Steam surfaces no per-connection
 * close event to this layer, only the coarser, slower lobby-membership
 * change), and recovery is the shared `starRejoin` → `matchCatchUp`
 * handshake against a seat the host suspends for `STAR_RECONNECT_GRACE_MS`.
 */

// ── P2P message routing ──────────────────────────────────────────────────────
// `net.onData` is a single Electron IPC channel — every listener registered
// on it (one per session-like object, if each installed its own) would fire
// for every packet, from any sender. Install exactly one dispatcher here and
// fan out by sender steamId64, so SteamSession/SteamGuestSession/
// SteamStarHub can each behave like NetSession's one-handler-per-connection
// model without leaking duplicate listeners.

const routes = new Map<string, (msg: NetMessage) => void>();
/**
 * Fallback for a packet from a steamId64 with no channel yet. Players always
 * announce themselves through the lobby first, so they arrive already routed —
 * this exists for SPECTATORS, who deliberately never join the lobby (see
 * `SteamSpectatorTransport`) and so are unknown until their first `spectate`
 * message lands here.
 */
let onUnrouted: ((steamId64: string, msg: NetMessage) => void) | null = null;
/** the channel currently owning each remote id, for close notifications */
const liveChannels = new Map<string, SteamChannel>();
let dispatcherInstalled = false;

function installDispatcher(): void {
    if (dispatcherInstalled) return;
    dispatcherInstalled = true;
    // Steam telling us a peer is gone, rather than us inferring it from
    // silence — turns a clean quit into an instant drop instead of one that
    // takes the full keepalive timeout to notice. Purely an accelerator: the
    // watchdog stays the authority, since a hard kill reports nothing at all.
    net.onClosed?.(({ steamId64, graceful }) => {
        // ONLY a peer-initiated close is final. A locally detected problem
        // (timeout, unreachable) is exactly the blip Steam Datagram Relay
        // exists to paper over — the next send dials a fresh connection and
        // traffic resumes, which the watchdog tolerates silently. Treating
        // that as a disconnect would turn recoverable hiccups into full
        // reconnect handshakes, strictly worse than waiting.
        if (!graceful) return;
        liveChannels.get(steamId64)?.markClosed();
    });
    net.onData((packet) => {
        const { steamId64, data } = packet as { steamId64: string; data: NetMessage };
        // A spectate handshake always goes to the acceptor, even from a sender
        // we already have a channel for: that is a watcher whose first attempt
        // timed out and who is trying again, and delivering it to the stale
        // channel would drop it into the hub as an unknown message and leave
        // them waiting forever for a catch-up that is never sent.
        if (data.type === 'spectate' && onUnrouted) {
            onUnrouted(steamId64, data);
            return;
        }
        const route = routes.get(steamId64);
        if (route) route(data);
        else onUnrouted?.(steamId64, data);
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
     * is the PRIMARY disconnect signal here, not a fallback: nothing
     * reaches this layer the way PeerJS's DataConnection 'close'/'error'
     * does. The runtime DOES watch connection state (it has to, to forget
     * dead handles) but does not forward it over IPC, so from here a drop
     * looks like silence and nothing else. Every caller of `SteamChannel`
     * also keeps the coarser, slower lobby-membership check running
     * alongside this as a secondary fast path (see `SteamGuestSession`/
     * `SteamStarHub`).
     */
    onClose: (() => void) | null = null;

    /**
     * Our own entry in `routes`, kept so `dispose()` can delete it ONLY
     * while it is still the registered one. `routes` is keyed by remote
     * steamId64 alone, and a guest redial deliberately opens a SECOND
     * channel to the same host before the first is torn down — so the
     * newer channel clobbers the older one's entry. Without this identity
     * check the older channel's (later) dispose would delete the *newer*
     * channel's route and silently mute a connection that just
     * successfully reconnected.
     */
    private readonly route: (msg: NetMessage) => void;
    /** onClose already fired, or this channel is disposed — keeps the Steam
     *  close notification and the watchdog from both firing it */
    private closed = false;

    constructor(readonly remoteSteamId: string) {
        installDispatcher();
        this.route = (msg) => {
            this.liveness.markSeen();
            if (msg.type === 'ping') {
                this.send({ type: 'pong' });
                return;
            }
            if (msg.type === 'pong') return;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        };
        routes.set(remoteSteamId, this.route);
        liveChannels.set(remoteSteamId, this);
        // registered before this assignment, but routes' callback only ever
        // fires asynchronously (via net.onData's IPC dispatch) — never
        // synchronously during registration — so `this.liveness` is always
        // set by the time any message could actually arrive.
        this.liveness = watchLiveness(
            () => void net.send(this.remoteSteamId, { type: 'ping' }),
            // through markClosed, not straight to onClose, so this and the
            // Steam-reported close share one "already gone" flag rather than
            // racing to fire the same callback twice
            () => this.markClosed(),
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

    /**
     * Steam reported this peer's connection closed by them. Same outcome the
     * liveness watchdog would reach on its own after the timeout — just now,
     * and only once: whichever gets there first wins, and the other finds the
     * watchdog already stopped.
     */
    markClosed(): void {
        if (this.closed) return;
        this.closed = true;
        this.liveness.stop();
        this.onClose?.();
    }

    dispose(): void {
        this.closed = true;
        this.liveness.stop();
        if (routes.get(this.remoteSteamId) === this.route) routes.delete(this.remoteSteamId);
        if (liveChannels.get(this.remoteSteamId) === this) liveChannels.delete(this.remoteSteamId);
    }

    /** `SpectatorViewerLink`'s half of dispose — same teardown, the name the
     *  transport-agnostic `SpectatorHub` calls it by. */
    close(): void {
        this.dispose();
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

    /**
     * Announce ourselves to the host again after a drop, so it hands back the
     * seat it has been holding.
     *
     * Much less work than the PeerJS redial, though not for the reason an
     * earlier version of this comment gave: the socket underneath is a real
     * `ISteamNetworkingSockets` connection, not a connectionless one. What
     * makes this cheap is that we never have to rebuild it BY HAND — sending
     * to a steamId64 we have no live connection to dials one and queues the
     * payload until it is up (see the module header). So what actually needs
     * repairing is only the host's belief that we are here: rejoining the
     * lobby (a no-op when we never left it) and sending starRejoin is the
     * whole reconnection.
     *
     * Returns a fresh session so the caller's own wiring is rebuilt exactly as
     * it is on the PeerJS path. THIS session is retired here (see `handoff`)
     * rather than by the caller: on success the caller keeps the old `Game`'s
     * star session deliberately unclosed (`destroy({ keepStarSession: true })`)
     * — and `close()` would be wrong for it anyway, since its `lobby.leave()`
     * would drop us straight back out of the lobby we just rejoined.
     */
    async redial(mySeat: SeatId, signal: AbortSignal, delayMs = 3000): Promise<GuestSession> {
        for (;;) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
                const room = await lobby.join(this.lobbyId);
                if (!room) throw new Error('lobby gone');
                const next = new SteamGuestSession(room.owner, this.lobbyId);
                this.handoff();
                next.send({
                    type: 'starRejoin',
                    seat: mySeat,
                    name: getPlayerName(),
                    version: GAME_VERSION,
                });
                return next;
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') throw e;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    /**
     * Everything `close()` does EXCEPT leaving the lobby — for handing this
     * session's place over to a replacement that lives in the SAME lobby.
     * Without it the retired session keeps a lobby-chat listener polling
     * getMembers() for the rest of the process, once more per reconnect,
     * and its dead channel's onClose could still fire reconnect logic at a
     * `Game` that has already been torn down and replaced.
     *
     * Safe to run before `close()` later does the same work again:
     * unsubscribing twice is a no-op, and `dispose()` only drops its
     * `routes` entry while it still owns it.
     */
    private handoff(): void {
        this.onClose = null;
        this.unsubscribe();
        this.channel.dispose();
    }

    close(): void {
        this.handoff();
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
    onSeatSuspended: ((seat: SeatId) => void) | null = null;
    onSeatReconnected: ((seat: SeatId) => void) | null = null;
    onSeatReclaimedFromAi: ((seat: SeatId) => void) | null = null;
    onDebugEvent: ((category: string, data?: unknown) => void) | null = null;
    /** fired whenever a guest joins/leaves before match start (lobby display) */
    onRosterChange: (() => void) | null = null;

    /** `channel: null` = seat suspended, held for a rejoin inside the grace
     *  window (mirrors StarHub's `conn: null`). */
    private readonly bySeat = new Map<
        SeatId,
        { steamId64: string; channel: SteamChannel | null; buffer: NetMessage[] }
    >();
    private readonly reconnectTimers = new Map<SeatId, ReturnType<typeof setTimeout>>();
    /** seats handed to AI after the window elapsed — reclaimable by their
     *  original player later, with no deadline (see StarHub.markReclaimable) */
    private readonly reclaimableSeats = new Set<SeatId>();
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
    markReclaimable(seat: SeatId): void {
        this.reclaimableSeats.add(seat);
    }
    isReclaimable(seat: SeatId): boolean {
        return this.reclaimableSeats.has(seat);
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
        // a suspended seat is still held, but nobody is on the other end
        return [...this.bySeat].filter(([, v]) => v.channel !== null).map(([seat]) => seat);
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
        onJoin: (
            name: string,
            version: number,
            avatar?: string | null,
            loadout?: Loadout,
        ) => SeatId | { reject: string },
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
                    // Only a LIVE seat blocks a fresh handshake. A suspended
                    // seat still holds the id of the player we are waiting for,
                    // and they come back under that same id — skipping them
                    // here would leave them in the lobby, never handshaking,
                    // while their own seat waits to be reclaimed.
                    if (
                        [...this.bySeat.values()].some(
                            (v) => v.channel !== null && v.steamId64 === steamId64,
                        )
                    ) {
                        continue;
                    }
                    this.pending.add(steamId64);
                    void this.handleNewMember(steamId64, onJoin);
                }
            });
        });
    }

    private async handleNewMember(
        steamId64: string,
        onJoin: (
            name: string,
            version: number,
            avatar?: string | null,
            loadout?: Loadout,
        ) => SeatId | { reject: string },
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

        // Explicit "I was seat N, let me back in". Both seat AND name must
        // match a seat we are actually holding: the seat number alone is a
        // small guessable integer, so name is what makes this an identity
        // check rather than a seat grab.
        if (msg.type === 'starRejoin') {
            const holding = this.bySeat.get(msg.seat);
            if (
                msg.version === GAME_VERSION &&
                holding?.channel === null &&
                this.roster[msg.seat]?.name === msg.name &&
                this.reclaimSeat(msg.seat, channel, steamId64)
            ) {
                return;
            }
            channel.send({
                type: 'starRejoinRejected',
                reason: t('menu:versionMismatchRejoin'),
            });
            channel.dispose();
            return;
        }

        if (msg.type !== 'starJoin') {
            channel.dispose();
            return;
        }

        // A returning player whose own client forgot the match (reload, crash,
        // reopened link) sends a plain starJoin — match it against a held seat
        // before treating them as a newcomer, or they are told the room is
        // full while their own seat sits waiting for them.
        if (msg.version === GAME_VERSION) {
            const held = this.findDroppedSeatByName(msg.name);
            if (held !== null && this.reclaimSeat(held, channel, steamId64)) return;

            // Came back after the window elapsed: the seat is AI-controlled but
            // still carries their name, so it can be handed back with no
            // deadline (the AI-takeover counterpart, checked after the held-seat
            // case since such a seat has left bySeat entirely).
            const fromAi = this.findReclaimableSeatByName(msg.name);
            if (fromAi !== null) {
                this.reclaimableSeats.delete(fromAi);
                this.bySeat.set(fromAi, { steamId64, channel, buffer: [] });
                channel.attach((m) => this.onMessage?.(fromAi, m));
                channel.onClose = () => this.dropSeat(fromAi, channel);
                const entry = this.roster[fromAi];
                if (entry) this.setRosterEntry(fromAi, { ...entry, controller: 'human' });
                this.onDebugEvent?.('star.aiReclaimAttempt', { seat: fromAi, name: msg.name, accepted: true });
                this.onSeatReclaimedFromAi?.(fromAi);
                this.onRosterChange?.();
                return;
            }
        }

        const result = onJoin(msg.name, msg.version, msg.avatar, msg.loadout);
        if (typeof result !== 'number') {
            channel.send({ type: 'starRejected', reason: result.reject });
            channel.dispose();
            return;
        }
        const seat = result;
        channel.attach((m) => this.onMessage?.(seat, m));
        channel.onClose = () => this.dropSeat(seat, channel);
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
    /**
     * @param via the channel whose close triggered this, when there is one.
     *  A reclaim is routinely FASTER than this host noticing the original
     *  drop (the guest redials after ~3s, our liveness watchdog gives up
     *  after ~10s), so the dead channel's onClose can land after the seat
     *  already holds a healthy replacement. Without this check that late,
     *  stale callback would dispose the live channel and suspend a player
     *  who is right there — the worst possible time, mid-reconnect.
     *  Omitted by the lobby-membership scan, which speaks for the seat
     *  itself rather than for any one channel.
     */
    private dropSeat(seat: SeatId, via?: SteamChannel): void {
        const viewer = this.bySeat.get(seat);
        // Already suspended: the lobby-membership scan sees a player who left
        // as absent on every update, and re-entering here would re-fire
        // onSeatSuspended and start a second grace timer, orphaning the first.
        // Leaving the lobby is not final during the window — a restarting
        // client leaves it too, and coming back is the whole point.
        if (!viewer || viewer.channel === null) return;
        if (via !== undefined && viewer.channel !== via) {
            via.dispose();
            return;
        }
        viewer.channel.dispose();

        // Already handed to AI: the seat is reclaimable with no deadline, so
        // there is nothing to hold and nothing to suspend (see StarHub).
        if (this.reclaimableSeats.has(seat)) {
            this.bySeat.delete(seat);
            this.onRosterChange?.();
            return;
        }

        // Pre-match a departure is just a departure: free the slot so the next
        // comer can take it. There is no match state worth holding it for.
        if (this.inLobby) {
            this.bySeat.delete(seat);
            const entry = this.roster[seat];
            if (entry) this.setRosterEntry(seat, { side: entry.side, controller: 'human', name: 'Waiting…' });
            this.onRosterChange?.();
            this.onSeatDropped?.(seat);
            return;
        }

        // Mid-match: hold the seat for STAR_RECONNECT_GRACE_MS, exactly as the
        // PeerJS host does — the Game's countdown, AI-takeover and catch-up all
        // key off these callbacks and were simply never reached before.
        viewer.channel = null;
        // moot now: a reclaim gets a fresh authoritative matchCatchUp instead
        viewer.buffer.length = 0;
        this.onDebugEvent?.('star.seatSuspended', { seat, graceMs: STAR_RECONNECT_GRACE_MS });
        this.onSeatSuspended?.(seat);
        this.onRosterChange?.();
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(seat);
            const current = this.bySeat.get(seat);
            if (!current || current.channel !== null) return;   // reclaimed meanwhile
            this.bySeat.delete(seat);
            this.onDebugEvent?.('star.graceWindowElapsed', { seat });
            this.onRosterChange?.();
            this.onSeatDropped?.(seat);
        }, STAR_RECONNECT_GRACE_MS);
        this.reconnectTimers.set(seat, timer);
    }

    /** A returning player takes their held seat back. */
    private reclaimSeat(seat: SeatId, channel: SteamChannel, steamId64: string): boolean {
        const viewer = this.bySeat.get(seat);
        if (!viewer || viewer.channel !== null) return false;
        const timer = this.reconnectTimers.get(seat);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.reconnectTimers.delete(seat);
        }
        viewer.channel = channel;
        viewer.steamId64 = steamId64;
        channel.attach((m) => this.onMessage?.(seat, m));
        channel.onClose = () => this.dropSeat(seat, channel);
        this.onDebugEvent?.('star.seatReclaimed', { seat });
        this.onSeatReconnected?.(seat);
        this.onRosterChange?.();
        return true;
    }

    /** An AI-controlled seat still carrying its original player's name — the
     *  takeover counterpart of findDroppedSeatByName, with no deadline. */
    private findReclaimableSeatByName(name: string): SeatId | null {
        for (const seat of this.reclaimableSeats) {
            if (this.roster[seat]?.name === name) return seat;
        }
        return null;
    }

    /** A held seat whose roster name matches — the same identity check the
     *  PeerJS host uses; `seat` alone is a guessable integer. */
    private findDroppedSeatByName(name: string): SeatId | null {
        for (const [seat, viewer] of this.bySeat) {
            if (viewer.channel !== null) continue;
            if (this.roster[seat]?.name === name) return seat;
        }
        return null;
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
        viewer.channel?.send({ type: 'starRejected', reason: t('menu:kickedByHost') });
        viewer.channel?.dispose();
        this.bySeat.delete(seat);
        const entry = this.roster[seat];
        if (entry) this.setRosterEntry(seat, { side: entry.side, controller: 'human', name: 'Waiting…' });
        this.onRosterChange?.();
    }

    send(seat: SeatId, msg: NetMessage): void {
        this.bySeat.get(seat)?.channel?.send(msg);
    }

    broadcast(msg: NetMessage, exclude?: SeatId): void {
        for (const [seat, { channel }] of this.bySeat) {
            if (seat === exclude) continue;
            channel?.send(msg);
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
                for (const buffered of viewer.buffer) viewer.channel?.send(buffered);
                viewer.buffer.length = 0;
            }
            if (seat === fromSeat) continue;
            // A suspended seat buffers regardless of vision: it gets an
            // authoritative matchCatchUp on reclaim, so this only matters for
            // the seats still listening.
            if (viewer.channel && isRevealable(policy, fromSide, sideLocked)) {
                viewer.channel.send(msg);
            } else if (viewer.channel) {
                viewer.buffer.push(msg);
            }
        }
    }

    flushAllBuffers(): void {
        for (const viewer of this.bySeat.values()) {
            for (const buffered of viewer.buffer) viewer.channel?.send(buffered);
            viewer.buffer.length = 0;
        }
    }

    /** Backfills a reclaiming seat's build backlog — see StarHub's own doc
     *  comment for what it is for. Reached on this transport too now that a
     *  Steam seat can be suspended and reclaimed (Game.starSeatReconnected →
     *  excludedActionsForSeatResume). */
    seedBuildBuffer(seat: SeatId, msg: Extract<NetMessage, { type: 'action' | 'undo' }>): void {
        this.bySeat.get(seat)?.buffer.push(msg);
    }

    close(): void {
        this.unsubscribeLobbyUpdate?.();
        this.unsubscribeLobbyUpdate = null;
        // A suspended seat's grace timer outlives the hub otherwise, firing
        // onSeatDropped into a torn-down match a minute later (StarHub.close
        // clears its own for the same reason).
        for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
        this.reconnectTimers.clear();
        this.reclaimableSeats.clear();
        for (const { channel } of this.bySeat.values()) channel?.dispose();
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
    await lobby.mergeFullData({
        mode,
        game: 'melodan',
        version: String(GAME_VERSION),
        host: getPlayerName(),
    });
    return { hub: new SteamStarHub(room.id, room.owner, initialRoster), lobbyId: room.id };
}

/**
 * Publish what the room list shows, for a lobby we host. Same facts the web
 * backend gets from registerSpectateEndpoint — seats without avatars, since a
 * lobby data value is a string and the LAN announce that shares this record is
 * a single UDP datagram. Absent keys simply render a plainer row.
 */
export async function advertiseSteamRoom(ad: {
    seats?: { name: string; side: 'a' | 'b'; connected: boolean }[];
    round?: number;
    spectate?: string | null;
}): Promise<void> {
    await lobby.mergeFullData({
        host: getPlayerName(),
        seats: ad.seats ? JSON.stringify(ad.seats) : '',
        // `!== undefined`, not truthiness: round 0 is a real round (the first
        // deployment, before any battle) and would otherwise advertise blank
        round: ad.round !== undefined ? String(ad.round) : '',
        spectate: ad.spectate ?? '',
    });
}

// ── spectating ───────────────────────────────────────────────────────────────
// Spectators do NOT join the Steam lobby. The lobby is sized to the roster and
// its membership drives seat assignment/suspension, so putting watchers in it
// would collide with both. They are not needed there either: Steam's P2P layer
// connects by steamId64 alone, and the runtime accepts every inbound connection
// request, so the host's own id IS the spectate endpoint — the exact role the
// PeerJS hub's peer id plays on the web transport.

/**
 * Steam-backed spectator acceptor for the shared `SpectatorHub`. All the
 * vision/fog and buffering logic stays in that one hub; this only supplies
 * connections, so spectating behaves identically on every transport.
 */
export class SteamSpectatorTransport implements SpectatorTransport {
    /** SteamChannel keeps its own watchdog and reports death through onClose —
     *  see SpectatorTransport.managesLiveness for why the hub must not add a
     *  second one on top of it. */
    readonly managesLiveness = true;

    /** channels handed out to watchers, so close() can tear down any that the
     *  hub never admitted (rejected version, handshake abandoned mid-flight) */
    private readonly channels = new Set<SteamChannel>();

    private constructor(readonly endpoint: string) {}

    /** `endpoint` is our own steamId64 — resolved up front so the room ad can
     *  carry it the moment the match starts. */
    static async open(): Promise<SteamSpectatorTransport> {
        const steamId64 = await steam.getSteamId();
        if (!steamId64 || steamId64 === '0') throw new Error('Steam identity unavailable');
        return new SteamSpectatorTransport(String(steamId64));
    }

    /** kept so close() only clears the acceptor while it is still ours — same
     *  identity discipline as SteamChannel's `routes` entry */
    private acceptor: ((steamId64: string, msg: NetMessage) => void) | null = null;

    listen(handlers: {
        onSpectate: (name: string, version: number, link: SpectatorViewerLink) => void;
        onData: (link: SpectatorViewerLink, msg: NetMessage) => void;
        onDrop: (link: SpectatorViewerLink) => void;
    }): void {
        installDispatcher();
        this.acceptor = (steamId64, msg) => {
            // Anything but the handshake from a stranger is discarded rather
            // than answered — an unknown sender must not be able to make this
            // host allocate a channel just by sending noise at it.
            if (msg.type !== 'spectate') return;
            const channel = new SteamChannel(steamId64);
            this.channels.add(channel);
            channel.attach((m) => handlers.onData(channel, m));
            channel.onClose = () => {
                this.channels.delete(channel);
                channel.dispose();
                handlers.onDrop(channel);
            };
            handlers.onSpectate(msg.name, msg.version, channel);
        };
        onUnrouted = this.acceptor;
    }

    close(): void {
        if (this.acceptor !== null && onUnrouted === this.acceptor) onUnrouted = null;
        this.acceptor = null;
        for (const channel of this.channels) channel.dispose();
        this.channels.clear();
    }
}

/** A spectator's own end of a Steam link to a host's hub — the counterpart of
 *  `SpectatorSession`, minus PeerJS's peer lifecycle (there is no peer to
 *  destroy, and no lobby to leave: we never joined one). */
class SteamSpectatorSession implements SpectatorLink {
    onClose: (() => void) | null = null;

    constructor(private readonly channel: SteamChannel) {
        channel.onClose = () => this.onClose?.();
    }

    attach(handler: (msg: NetMessage) => void): void {
        this.channel.attach(handler);
    }

    send(msg: NetMessage): void {
        this.channel.send(msg);
    }

    close(): void {
        this.onClose = null;
        this.channel.dispose();
    }
}

/**
 * Watch an in-progress Steam match, given the host's steamId64 (carried in the
 * room ad's `spectate` field). Mirrors `joinAsSpectator` message for message —
 * only the bytes' path differs.
 */
export async function joinSteamAsSpectator(
    hostSteamId: string,
    name: string,
    signal?: AbortSignal,
): Promise<SpectateResult> {
    const channel = new SteamChannel(hostSteamId);
    try {
        channel.send({ type: 'spectate', name, version: GAME_VERSION });
        const msg = await new Promise<NetMessage>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Host did not respond')), CONNECT_TIMEOUT_MS);
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            void channel.once().then((m) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(m);
            });
        });
        if (msg.type === 'spectateRejected') throw new Error(msg.reason);
        if (msg.type !== 'matchCatchUp' || msg.viewer.kind !== 'spectator') {
            throw new Error('Unexpected reply from host');
        }
        if (msg.version !== GAME_VERSION) throw new Error(t('menu:versionMismatchShort'));
        return {
            session: new SteamSpectatorSession(channel),
            seed: msg.seed,
            settings: msg.settings,
            actions: msg.actions,
            battleElapsed: msg.battleElapsed,
            phaseRemaining: msg.phaseRemaining,
            roster: msg.roster,
            vision: msg.viewer.vision,
        };
    } catch (e) {
        channel.dispose();
        throw e;
    }
}

/** Join a 2v2+ star room over Steam by lobby id — same `starJoin` handshake as `joinStarRoom`. */
export async function joinSteamStarRoom(lobbyId: string): Promise<SteamGuestSession> {
    const room = await lobby.join(lobbyId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    const session = new SteamGuestSession(room.owner, lobbyId);
    session.send({
        type: 'starJoin',
        name: getPlayerName(),
        version: GAME_VERSION,
        avatar: getAvatarDataUrl(),
        loadout: activeLoadout(),
    });
    return session;
}

/**
 * Accept a Steam overlay/friends-list "Join Game" invite. Every lobby is a
 * star lobby regardless of layout — 1v1 is just a two-seat roster — so the
 * guest session is the same either way; `mode` is reported only because the
 * caller may want it for status text.
 */
export async function joinSteamLobby(lobbySteamId: string): Promise<{
    mode: '1v1' | '2v2';
    session: SteamGuestSession;
    /** the running match's spectate endpoint (host steamId64), if it has
     *  already started — lets a caller whose seat request is refused fall
     *  back to watching instead of dead-ending */
    spectate: string | null;
    hostName: string;
}> {
    const room = await lobby.join(lobbySteamId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    const session = new SteamGuestSession(room.owner, room.id);
    session.send({
        type: 'starJoin',
        name: getPlayerName(),
        version: GAME_VERSION,
        avatar: getAvatarDataUrl(),
        loadout: activeLoadout(),
    });
    return {
        mode: room.data.mode === '1v1' ? '1v1' : '2v2',
        session,
        spectate: room.data.spectate || null,
        hostName: room.data.host || 'Steam player',
    };
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
