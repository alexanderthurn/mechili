import { lobby, net, type SteamLobbyInfo } from 'steam-electron-build/native';
import { getPlayerName } from './player';
import { GAME_VERSION, type GuestSession, type HostHub, type NetMessage, type Session, type SessionPending } from './net';
import type { CanonicalSeatDef, SeatId } from './seats';

/**
 * Steam-backed transport, parallel to `net.ts`'s PeerJS+PHP one — chosen at
 * the menu based on `steam.isAvailable()` (see main.ts), never touching the
 * web/dev build's path. The wire PROTOCOL is unchanged: every message here
 * is a `NetMessage` from `net.ts`, including the existing `starJoin`/
 * `starSetup` handshake for star-mode seat assignment — Steam only replaces
 * *how bytes move*, never what's carried over them.
 *
 * Not covered (same v1 scope as the PeerJS star path): spectating,
 * reconnect/resume — a dropped Steam P2P session gets the same "give up"
 * treatment star mode already has.
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

    constructor(readonly remoteSteamId: string) {
        installDispatcher();
        routes.set(remoteSteamId, (msg) => {
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
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

// ── 1v1 ───────────────────────────────────────────────────────────────────────

/** 1v1 over Steam: a 2-member lobby + P2P to the one other member. */
export class SteamSession implements Session {
    onClose: (() => void) | null = null;
    private readonly channel: SteamChannel;
    private readonly unsubscribe: () => void;

    constructor(
        readonly remoteSteamId: string,
        readonly lobbyId: string,
    ) {
        this.channel = new SteamChannel(remoteSteamId);
        // Steam has no per-connection "close" event like PeerJS's DataConnection
        // — a drop only shows up as the lobby losing a member.
        this.unsubscribe = onLobbyChatUpdate(() => {
            void lobby.getMembers().then((members) => {
                if (!members.includes(remoteSteamId)) this.onClose?.();
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

    close(): void {
        this.onClose = null;
        this.unsubscribe();
        this.channel.dispose();
        void lobby.leave();
    }
}

/**
 * Host a 1v1 room: opens a lobby and waits for the second member to appear.
 * `onLobbyReady` (if given) fires once the lobby itself exists — before the
 * `session` promise resolves, which only happens once a second member has
 * actually joined — so a caller wanting to show Steam's invite dialog right
 * after hosting isn't racing `lobby.create()` (calling `openInviteDialog()`
 * before that resolves is a silent no-op: `currentLobby` is still null).
 */
export function hostSteamRoom(isPublic: boolean, onLobbyReady?: (lobbyId: string) => void): SessionPending<SteamSession> {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const session = (async () => {
        const room = await lobby.create(isPublic ? 'public' : 'private', 2);
        if (!room) throw new Error('Could not open a Steam lobby — is Steam running?');
        // tagged even for a private (invite-only) lobby: `onSteamJoinRequested`
        // (main.ts) needs this to tell a 1v1 invite from a 2v2 one, and
        // joining is the only way to read a lobby's data at all (see there)
        await lobby.mergeFullData({ mode: '1v1' });
        onLobbyReady?.(room.id);
        if (cancelled) {
            void lobby.leave();
            throw new Error('cancelled');
        }
        return await new Promise<SteamSession>((resolve) => {
            unsubscribe = onLobbyChatUpdate(() => {
                void lobby.getMembers().then((members) => {
                    const other = members.find((m) => m !== room.owner);
                    if (other) {
                        unsubscribe?.();
                        resolve(new SteamSession(other, room.id));
                    }
                });
            });
        });
    })();
    return {
        session,
        cancel: () => {
            cancelled = true;
            unsubscribe?.();
            void lobby.leave();
        },
    };
}

/** Join a 1v1 room by Steam lobby id (from an invite accept or a getLobbies() scan). */
export function joinSteamRoom(lobbyId: string): SessionPending<SteamSession> {
    let cancelled = false;
    const session = (async () => {
        const room = await lobby.join(lobbyId);
        if (!room || cancelled) throw new Error(cancelled ? 'cancelled' : 'Could not join the Steam lobby.');
        const hostSteamId = room.owner;
        return new SteamSession(hostSteamId, lobbyId);
    })();
    return {
        session,
        cancel: () => {
            cancelled = true;
        },
    };
}

/**
 * Anonymous 1v1 matching: join any open public lobby, or host one if none
 * exists. Tagged with the resulting role — unlike `hostSteamRoom`/
 * `joinSteamRoom` individually (each unambiguous by construction), this
 * convenience wrapper doesn't know in advance which one it'll end up doing,
 * and the caller (`beginSteamNetGame`'s handshake direction) needs to know.
 */
export async function quickSteamMatch(): Promise<{ session: SteamSession; role: 'host' | 'guest' }> {
    const openRooms = await lobby.getLobbies();
    const open = openRooms.find((r) => r.data.mode === '1v1' && r.memberCount < (r.memberLimit ?? 2));
    if (open) return { session: await joinSteamRoom(open.id).session, role: 'guest' };
    return { session: await hostSteamRoom(true).session, role: 'host' };
}

// ── 2v2+ star ─────────────────────────────────────────────────────────────────

/** Guest side of a star (2v2+) room over Steam — same shape as `StarGuestSession`. */
export class SteamGuestSession implements GuestSession {
    onClose: (() => void) | null = null;
    private readonly channel: SteamChannel;
    private readonly unsubscribe: () => void;

    constructor(
        readonly hostSteamId: string,
        readonly lobbyId: string,
    ) {
        this.channel = new SteamChannel(hostSteamId);
        this.unsubscribe = onLobbyChatUpdate(() => {
            void lobby.getMembers().then((members) => {
                if (!members.includes(hostSteamId)) this.onClose?.();
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
    listen(onJoin: (name: string, version: number, steamId64: string) => SeatId | { reject: string }): void {
        if (this.accepting) return;
        this.accepting = true;
        onLobbyChatUpdate(() => {
            void lobby.getMembers().then((members) => {
                const present = new Set(members);
                // a member who left mid-handshake (quit before sending starJoin)
                // must not stay blocked forever — steamId64 is a persistent
                // identity, unlike a PeerJS connection attempt, so a stale
                // `pending` entry would refuse them on every future rejoin too
                for (const steamId64 of this.pending) {
                    if (!present.has(steamId64)) this.pending.delete(steamId64);
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
        onJoin: (name: string, version: number, steamId64: string) => SeatId | { reject: string },
    ): Promise<void> {
        const channel = new SteamChannel(steamId64);
        const msg = await channel.once();
        this.pending.delete(steamId64);
        if (msg.type !== 'starJoin') {
            channel.dispose();
            return;
        }
        const result = onJoin(msg.name, msg.version, steamId64);
        if (typeof result !== 'number') {
            channel.send({ type: 'starRejected', reason: result.reject });
            channel.dispose();
            return;
        }
        const seat = result;
        channel.attach((m) => this.onMessage?.(seat, m));
        this.bySeat.set(seat, { steamId64, channel, buffer: [] });
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

    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
        sideLocked: (side: 'a' | 'b') => boolean,
    ): void {
        const fromSide = this.sideOf(fromSeat);
        for (const [seat, viewer] of this.bySeat) {
            if (seat === fromSeat) continue;
            const isAlly = this.sideOf(seat) === fromSide;
            if (isAlly || sideLocked(fromSide)) {
                if (viewer.buffer.length > 0) {
                    for (const buffered of viewer.buffer) viewer.channel.send(buffered);
                    viewer.buffer.length = 0;
                }
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

    close(): void {
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
): Promise<{ hub: SteamStarHub; lobbyId: string }> {
    const room = await lobby.create(isPublic ? 'public' : 'private', initialRoster.length);
    if (!room) throw new Error('Could not open a Steam lobby — is Steam running?');
    // tagged even for a private (invite-only) lobby — see hostSteamRoom's note
    await lobby.mergeFullData({ mode: '2v2' });
    return { hub: new SteamStarHub(room.id, room.owner, initialRoster), lobbyId: room.id };
}

/** Join a 2v2+ star room over Steam by lobby id — same `starJoin` handshake as `joinStarRoom`. */
export async function joinSteamStarRoom(lobbyId: string): Promise<SteamGuestSession> {
    const room = await lobby.join(lobbyId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    const session = new SteamGuestSession(room.owner, lobbyId);
    session.send({ type: 'starJoin', name: getPlayerName(), version: GAME_VERSION });
    return session;
}

/**
 * Accept a Steam overlay/friends-list "Join Game" invite: the lobby's mode
 * isn't knowable before joining (Steam has no way to read an unjoined
 * lobby's data through this wrapper — unlike a `getLobbies()` scan result,
 * which already carries `.data`), so this joins first and branches on the
 * `mode` tag `hostSteamRoom`/`hostSteamStarRoom` always set.
 */
export async function joinSteamLobby(
    lobbySteamId: string,
): Promise<{ mode: '1v1'; session: SteamSession } | { mode: '2v2'; session: SteamGuestSession }> {
    const room = await lobby.join(lobbySteamId);
    if (!room) throw new Error('Could not join the Steam lobby.');
    if (room.data.mode === '2v2') {
        const session = new SteamGuestSession(room.owner, room.id);
        session.send({ type: 'starJoin', name: getPlayerName(), version: GAME_VERSION });
        return { mode: '2v2', session };
    }
    return { mode: '1v1', session: new SteamSession(room.owner, room.id) };
}

/** anonymous 2v2 matching (the "Play" button): join any open public star
 *  lobby, or host one if none exists — mirrors main.ts's existing PHP-room
 *  discover-or-host logic for the same button. */
export async function hostOrJoinSteamStar(
    initialRoster: CanonicalSeatDef[],
): Promise<{ role: 'host'; hub: SteamStarHub; lobbyId: string } | { role: 'guest'; session: SteamGuestSession; lobbyId: string }> {
    const openRooms = await lobby.getLobbies();
    const open = openRooms.find((r) => r.data.mode === '2v2' && r.memberCount < (r.memberLimit ?? initialRoster.length));
    if (open) {
        const session = await joinSteamStarRoom(open.id);
        return { role: 'guest', session, lobbyId: open.id };
    }
    const { hub, lobbyId } = await hostSteamStarRoom(initialRoster, true);
    return { role: 'host', hub, lobbyId };
}

export type { SteamLobbyInfo };
