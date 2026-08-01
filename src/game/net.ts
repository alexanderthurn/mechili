import Peer, { type DataConnection } from 'peerjs';
import type { Action, LoggedAction } from './actions';
import type { Opponent } from './ai';
import type { DebugEvent } from './debugLog';
import type { ChatItem } from './emotes';
import { getPlayerName, peerRoomId, roomCodeFromName } from './player';
import type { CanonicalSeatDef, SeatId } from './seats';
import type { GameSettings } from './settings';
import type { Team } from './units';

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
export const GAME_VERSION = 20; // v20: 'starSync' now carries the dropped seat(s)' names, for a non-host's own "waiting" notice

const CONNECT_TIMEOUT_MS = 20_000;
const HEARTBEAT_MS = 5000;
/** how long a star seat's connection may stay dropped before the host gives
 *  up and frees it — matches classic 1v1's RECONNECT_GRACE_SECONDS (main.ts) */
export const STAR_RECONNECT_GRACE_MS = 60_000;

/**
 * The quick-match endpoint (backend/matchmaking.php, bundled in dist).
 * On localhost, `?branch=` or the Vite-baked git branch picks the feuerware
 * deploy; melodan/main/master use play.melodan.com.
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

/**
 * Branches that use production play.melodan.com when developing on localhost.
 * Everything else (including `melodan`) hits feuerware.com/2025/mechili/<branch>/.
 */
const PLAY_HOST_DEV_BRANCHES = new Set(['main', 'master']);

/**
 * Dev backend branch: `?branch=` wins, else the git branch baked in by Vite.
 * Returns null when we should use play.melodan.com.
 */
export function resolvedDevBranch(): string | null {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('branch')?.trim();
    if (fromUrl) return fromUrl;
    const fromGit = typeof __GIT_BRANCH__ === 'string' ? __GIT_BRANCH__.trim() : '';
    if (!fromGit || PLAY_HOST_DEV_BRANCHES.has(fromGit)) return null;
    return fromGit;
}

/**
 * Site / deploy URL for a branch name (git or Steam beta).
 * `main`/`master` → melodan.com; other branches (incl. `melodan`) → feuerware preview.
 */
export function branchSiteUrl(branch?: string | null): string {
    const b = (branch?.trim() || resolvedDevBranch() || '').trim();
    if (!b || PLAY_HOST_DEV_BRANCHES.has(b)) return 'https://melodan.com/';
    return `https://feuerware.com/2025/mechili/${encodeURIComponent(b)}/`;
}

/** Base URL for PHP endpoints under /backend/ (trailing slash). */
function localhostBackendDir(): string {
    const branch = resolvedDevBranch();
    if (!branch) return 'https://play.melodan.com/backend/';
    return `https://feuerware.com/2025/mechili/${encodeURIComponent(branch)}/backend/`;
}

export function matchUrl(): string {
    if (isLocalhost()) {
        return new URL('matchmaking.php', localhostBackendDir()).href;
    }

    return new URL('./backend/matchmaking.php', location.href).href;
}

/** one seat, as shown in the menu's room list — enough for a client to
 *  recognize its own name and offer "resume" instead of "spectate" without
 *  connecting first. Deliberately NOT `CanonicalSeatDef`: that's the wire's
 *  own roster shape, seen only after connecting; this is the smaller,
 *  public-facing subset the backend actually needs to store/return. */
export interface RoomRosterEntry {
    name: string;
    side: 'a' | 'b';
    connected: boolean;
}

export interface LobbyRoom {
    name: string;
    peer: string;
    mode: '1v1' | '2v2';
    /** `lobby` = waiting for a player, join normally; `spectate` = a match
     *  already running — connect to `peer` as a spectator instead */
    kind: 'lobby' | 'spectate';
    /** only ever present on `kind: 'spectate'` rows — see spectate-register.
     *  A client can match its OWN name against this to offer "resume" for a
     *  seat currently shown `connected: false`, instead of "spectate". */
    roster?: RoomRosterEntry[];
    /** current round number — display-only for now */
    round?: number;
    /** opaque passthrough for whatever a future menu wants to show (map,
     *  etc.) — the backend stores and returns it verbatim, never reads it */
    data?: unknown;
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
 * Everything that crosses the wire. Build-phase `action`/`undo` now send
 * immediately in every mode (trust-world tradeoff, deferred encryption
 * reintroduces fog here later — see TEAM_MODES_PLAN.md). Spectators get a
 * per-connection vision policy (default: battle-only), unaffected by that
 * change.
 */
export type NetMessage =
    | { type: 'hello'; name: string }
    | { type: 'setup'; version: number; seed: number; settings: GameSettings; hostName: string; guestName: string }
    /** `side` (wire-level 'a'/'b') is who picked — the two real players never
     *  need it (each just knows "mine" vs "the peer's"), but a spectator
     *  watching both sides can't tell the two picks apart without it; see
     *  onSpectateMessage's 'starter' handling. */
    | { type: 'starter'; cardId: string; side?: 'a' | 'b' }
    /**
     * `side` is the WIRE-LEVEL, canonical host/guest tag ('a'/'b') this
     * message was relayed for — set only when mirroring to spectators, who
     * otherwise have no way to tell the two real players apart. `action.seat`
     * is perspective-relative ("0 = mine", identical on both real clients —
     * see Game.seatRank's doc comment), so a spectator resolving team from
     * `action.seat` alone collapses both players onto the same seat. The
     * two real players never read this field; they already know who they are.
     *
     * `seq` is the ORIGINATING seat's own monotonic counter (one shared
     * sequence per seat across both action and undo), stamped once at
     * origination and never touched by any relay hop — lets any recipient
     * (another seat, the host relaying onward) notice a skipped number and
     * know immediately something's missing, instead of only ever
     * discovering it indirectly later (a stuck phase, a battle-start hash
     * mismatch). See Game.seedSeqTracking's doc comment for how both sides
     * agree on the starting count after any hydrate/resync.
     */
    | { type: 'action'; round: number; action: Action; side?: 'a' | 'b'; seq: number }
    /** `seat` is unused by classic 1v1 (implicitly "the opponent"); star mode
     *  needs it since more than one remote seat can send an undo. `side` is
     *  the same spectator-only wire tag as on `action` above. `seq` is the
     *  same per-seat monotonic counter `action` uses (see its doc comment). */
    | { type: 'undo'; round: number; seat?: SeatId; side?: 'a' | 'b'; seq: number }
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
     *  the host relays a spectator's chat to the player link too.
     *  `role: 'system'` is a host-originated announcement (a spectator
     *  joined/left, a seat reconnected) rather than something a person
     *  typed — `name` is the relevant person's name for context, but a
     *  receiver renders it via Hud.addSystemMessage (no sender chip, no
     *  commander-card bubble), not addChat. */
    | { type: 'chat'; item: ChatItem; from: { name: string; role: 'player' | 'spectator' | 'system' } }
    /** dev-only (`?debug`): batched debug events, streamed to whichever
     *  client is the host so `DebugLog.dump()` can print one aggregated,
     *  cross-client timeline — never part of game state, never rendered */
    | { type: 'debugLog'; events: DebugEvent[] }
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
    /**
     * A player explicitly chose "Quit to menu" mid-match (as opposed to a
     * dropped connection) — sent right before closing, so the recipient(s)
     * can resolve immediately (forfeit win / AI takeover) instead of running
     * the reconnect-grace flow for a connection that's never coming back.
     * Classic 1v1: peer→peer, either direction. Star: guest→host (that
     * seat quit) or host→every guest (the host itself quit, whole match
     * ends — no host migration).
     */
    | { type: 'quit' }
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
    | { type: 'starNextRound'; round: number }
    /** every client's battle-start state fingerprint, sent to the host for
     *  N-way comparison. A mismatch is logged AND treated as a resync
     *  trigger for the disagreeing seat(s) — see Game.verifyStarChecks. */
    | { type: 'starCheck'; round: number; seat: SeatId; hash: number }
    /**
     * Host → every connected seat: a seat dropped (`suspended:true`) or
     * every dropped seat has caught up and confirmed ready
     * (`suspended:false`) — broadcast, not just host-local bookkeeping, so
     * every OTHER connected seat (not just the host) pauses/resumes in
     * lockstep too (previously only the host paused; other seats kept
     * ticking through the whole outage, unaware, ending up ahead of the
     * host and the reconnecting seat once it returned — a real 2v2+ gap,
     * never caught by 1v1-only reconnect testing). `target` is the exact
     * point every seat should be at: `phaseRemaining` for `phase:'build'`,
     * `sim.elapsed` for `phase:'battle'` — explicit on both messages (not
     * an implicit "just freeze/unfreeze wherever you are") so a recipient
     * always reconciles to a precise number rather than assuming zero
     * relay latency. Disconnect time is always free: the resume target
     * always equals the pause target, since nothing advances while
     * everyone is correctly paused — this is never used to skip time
     * forward as a fairness penalty. `names`: every currently-pending
     * (dropped, not yet reconnected) seat's name, so a non-host recipient
     * can show the same "<name> disconnected — waiting <time>" notice the
     * host shows, instead of a generic message with no idea who dropped —
     * always sent (empty array on `suspended:false`, unused there). */
    | {
          type: 'starSync';
          suspended: boolean;
          round: number;
          phase: 'build' | 'battle';
          target: number;
          names: string[];
      }
    /**
     * Guest → host only: this guest's own per-seat `seq` tracking
     * (Game.lastSeqSeen) noticed a gap in relayed action/undo traffic —
     * a message from some seat was skipped or dropped in transit despite
     * the connection staying up. Treated exactly like that guest needing
     * to reconnect (see Game.beginStarSeatSuspend/starSeatReconnected):
     * pause the whole match, resend the full state via `starResumeState`,
     * resume once the guest confirms with `ready` — the same recovery
     * path already used for a real drop, not a second mechanism. The
     * host is always the source of truth here: this only fires for a
     * gap in what the HOST relayed, which the host's own log can always
     * answer fully (see Game.onStarMessage's doc comment on the rarer,
     * not-auto-recovered reverse direction). */
    | { type: 'starResyncRequest' }
    /**
     * A guest whose connection to the host dropped, redialing the SAME
     * host peer id with its OWN still-alive Peer object (no page reload —
     * that's a separate, still-unbuilt story for star mode, same as
     * before). `seat` is what it remembers being assigned; the host only
     * accepts this if that seat is currently marked "awaiting reconnect"
     * (see StarHub.dropSeat/reclaimSeat) — never treated as proof on its
     * own, same "trust the outcome, not the claim" spirit as elsewhere,
     * though here the claim IS the seat we're trying to identify by, so
     * the host cross-checks it against its own pending-reconnect state.
     */
    | { type: 'starRejoin'; seat: SeatId; version: number }
    /**
     * Host's answer to a valid reclaim (starRejoin, OR a starJoin whose name
     * matched a currently-dropped seat — see StarHub.findDroppedSeatByName):
     * the full state to hydrate from, vision-filtered by isRevealable for
     * the RECLAIMING seat's own side (same predicate StarHub.relayBuild
     * already uses) — shaped like classic 1v1's 'state' message.
     *
     * `seat`/`seed`/`settings`/`roster` are only load-bearing for a COLD
     * reconnect (the reclaiming client's own Game object is gone — thrown
     * back to the main menu, not an in-session redial) — that client has
     * nothing else to construct a fresh Game instance from. An in-session
     * redial's Game object already has all of these from its own
     * construction and simply ignores the repeats.
     */
    | {
          type: 'starResumeState';
          version: number;
          seat: SeatId;
          seed: number;
          settings: GameSettings;
          roster: CanonicalSeatDef[];
          actions: LoggedAction[];
          battleElapsed: number | null;
          phaseRemaining: number;
      }
    /** host declines a starRejoin (seat not actually pending, version
     *  mismatch, or the seat was already reclaimed by a race winner) */
    | { type: 'starRejoinRejected'; reason: string }
    /**
     * Star host → every guest and spectator: `team`'s side has no humans
     * left (its last seat quit — see Game.starForfeit) and forfeits.
     * Deliberately NOT relayed through the ordinary fog/round-gated action
     * relay — a match-ending signal must never sit buffered behind the
     * forfeiting side's own lock-in state or a recipient's currently-
     * displayed round/phase, both of which the normal 'action' relay does.
     */
    | { type: 'starForfeit'; team: Team }
    /**
     * App-level liveness check — see {@link watchLiveness}. WebRTC's own
     * 'close'/'error' events fire promptly for an ORDERLY teardown (a
     * reload actively closes the RTCPeerConnection as part of unloading the
     * page) but are NOT a reliable or prompt signal for a hard browser
     * close/crash/cable-pull: nothing tells the other side anything
     * happened, so it can sit indefinitely in whatever state it was
     * already in until the underlying ICE connection eventually times out
     * on its own (inconsistent across browsers, sometimes very slow).
     * `ping`/`pong` is deliberately swallowed at the transport layer
     * (NetSession/StarGuestSession/StarHub, never reaches Game) — it only
     * exists to keep `lastSeenAt` fresh so a real gap can be detected fast
     * and consistently regardless of HOW the peer vanished.
     */
    | { type: 'ping' }
    | { type: 'pong' };

const LIVENESS_PING_MS = 2_000;
// Declaring a connection "dead" here is cheap to get wrong: it only marks
// the seat's conn null and starts the ordinary STAR_RECONNECT_GRACE_MS
// (60s) reconnect window (see StarHub.dropSeat) — the exact same,
// fully-recoverable path a real close/error takes. A false positive (a
// merely-throttled or briefly-hiccuping peer that's still actually there)
// just self-heals once its next ping gets through and it reclaims the
// seat; nothing is lost or destroyed by guessing wrong. That's what makes
// a short timeout safe to use here, unlike a true "give up" deadline.
// Chrome's (and similar browsers') "intensive timer throttling" only
// clamps a hidden tab's timers to once/minute after 5+ continuously
// backgrounded minutes — well past this timeout, so a spectator or
// player briefly alt-tabbing mid-match won't trip it.
const LIVENESS_TIMEOUT_MS = 10_000;

/**
 * Shared app-level connection-liveness watchdog — ping every
 * `LIVENESS_PING_MS`, and if NO traffic (ping, pong, or any real game
 * message — anything counts as "still alive") has arrived for
 * `LIVENESS_TIMEOUT_MS`, fire `onDead` exactly once. Callers still keep
 * their own 'close'/'error' listeners too (an orderly drop should still be
 * as instant as it already is) — this only covers the gap those miss.
 *
 * Exported for net-steam.ts too: this is pure application-layer message
 * traffic, no WebRTC-specific dependency at all, so it's the SAME
 * mechanism for both transports rather than a parallel reimplementation.
 * For Steam specifically it's the PRIMARY disconnect signal, not a
 * fallback — Steam has no per-connection close/error event to fall back
 * from (a drop there only shows up as the lobby losing a member, a
 * coarser and slower signal — see SteamChannel's own doc comment).
 */
export function watchLiveness(
    send: () => void,
    onDead: () => void,
): { markSeen: () => void; stop: () => void } {
    let lastSeenAt = Date.now();
    let dead = false;
    const pingTimer = setInterval(() => {
        try {
            send();
        } catch {
            // a send failure on an already-broken connection is exactly
            // what this watchdog exists to catch — let the timeout below
            // fire rather than throwing out of a timer callback
        }
    }, LIVENESS_PING_MS);
    const checkTimer = setInterval(() => {
        if (dead) return;
        if (Date.now() - lastSeenAt > LIVENESS_TIMEOUT_MS) {
            dead = true;
            clearInterval(pingTimer);
            clearInterval(checkTimer);
            onDead();
        }
    }, LIVENESS_PING_MS);
    return {
        markSeen: () => {
            lastSeenAt = Date.now();
        },
        stop: () => {
            dead = true;
            clearInterval(pingTimer);
            clearInterval(checkTimer);
        },
    };
}

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
 * Which of the two host-relay "who sees this build action and when" gates
 * a viewer uses — a real seat (StarHub) or a spectator (SpectatorHub).
 * Both hubs independently implement the same "per-viewer buffer, flush
 * whatever just became revealable, then send-or-buffer this message"
 * shape; `isRevealable` below is the one gate predicate shared between
 * them, so there's a single place that decides visibility instead of two
 * slightly different reimplementations of the same idea.
 *
 * One shape for every viewer, not "seat vs spectator": `ownSides` is the
 * viewer's own side(s) (empty for a spectator — no side of their own),
 * always visible with no lock/grant needed. `granted` is an explicit
 * early-access grant, keyed the same way regardless of viewer kind — today
 * only ever populated for spectators (see SpectatorHub.setSeatLive), but
 * nothing here assumes that; a future grant from one player to another
 * (ally or opponent) is the same shape, same predicate, no new code path.
 */
export interface VisionPolicy {
    ownSides: ReadonlySet<'a' | 'b'>;
    granted: ReadonlySet<'a' | 'b'>;
}

/**
 * Is a build action/undo FROM `fromSide` visible to a viewer with `policy`
 * right now? `sideLocked` is supplied by the caller (Game owns lock-in
 * state; this module only knows connections).
 *
 * A viewer with an own side (a real seat, ally or opponent) only ever
 * needs THAT side's own lock — once `fromSide` locks in, it has nothing
 * left to act on this round, so revealing it can't leak an advantage back
 * against its own future choices. A NEUTRAL viewer (no own side — a true
 * spectator) instead waits for EVERY side to lock before seeing anything
 * ungranted: without that stricter bar, a spectator could relay one side's
 * reveal to the other side while it's still building, a real leak a seat
 * viewer's own gate can't cause. This asymmetry is deliberate and must
 * survive any future refactor of this function.
 */
export function isRevealable(
    policy: VisionPolicy,
    fromSide: 'a' | 'b',
    sideLocked: (side: 'a' | 'b') => boolean,
): boolean {
    if (policy.ownSides.has(fromSide)) return true;
    if (policy.granted.has(fromSide)) return true;
    if (policy.ownSides.size > 0) return sideLocked(fromSide);
    return sideLocked('a') && sideLocked('b');
}

/** VisionPolicy for a real seat viewer — always sees its own side; no
 *  explicit grants exist for seats yet (see isRevealable's doc comment on
 *  why the model allows for it regardless). */
export function seatVisionPolicy(side: 'a' | 'b'): VisionPolicy {
    return { ownSides: new Set([side]), granted: new Set() };
}

/** VisionPolicy for a spectator viewer — no own side; granted sides come
 *  from its own live-vision grant state (SpectatorHub.setSeatLive). */
export function spectatorVisionPolicy(vision: SpectatorVision): VisionPolicy {
    return { ownSides: new Set(), granted: new Set(vision.mode === 'live' ? vision.seats : []) };
}

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
    /** star mode only — lets a receiving client notice a seat got taken
     *  over by AI mid-match (see Game.takeOverSeatWithAi/refreshCommanders)
     *  and update its own commander display accordingly. Classic 1v1 has
     *  no AI-takeover concept (a quit forfeits immediately instead), so its
     *  entries never set this. */
    controller?: 'human' | 'ai';
}

/** the remote player as an Opponent: it acts via received messages, so the
 *  local hooks are all no-ops */
export class NetworkOpponent implements Opponent {
    chooseStarter(): void {}
    onBuildPhase(): void {}
    onRoundCards(): void {}
}

/**
 * What `Game`/`main.ts` need from a 1v1 connection during actual play and
 * its own recovery — the FULL shared surface, so `main.ts`'s reconnect
 * wiring (`wireReconnect`) never has to know or care which transport this
 * is (`NetSession`/PeerJS, `SteamSession`/Steam, or a future one) — it only
 * ever calls methods declared here. Naming/handshake setup still stays each
 * transport's own concern (`resumeSession`/`hostSteamRoom` etc. construct a
 * fresh `Session` however they need to).
 */
export interface Session {
    onClose: (() => void) | null;
    attach(handler: (msg: NetMessage) => void): void;
    /** waits for the next single message (used for the post-recovery handshake) */
    once(): Promise<NetMessage>;
    send(msg: NetMessage): void;
    close(): void;
    /**
     * Called once `onClose` has fired: attempt to recover this SAME
     * logical connection, resolving with a replacement `Session` if/when
     * it succeeds (bounded by `signal` — the caller owns the timeout).
     * Omit entirely (leave undefined) if this transport has nothing left
     * to try once `onClose` fires — the caller then treats the grace
     * window as already elapsed, uniformly, with no transport check of
     * its own. PeerJS's DataConnection can genuinely die and needs an
     * explicit redial (see `NetSession.attemptRecovery`); Steam's own P2P
     * layer self-heals a brief drop transparently BEFORE its watchdog-
     * driven `onClose` ever fires (see net-steam.ts's own doc comment), so
     * by the time `onClose` fires there, there's nothing left worth
     * retrying — `SteamSession` simply doesn't implement this method.
     */
    attemptRecovery?(signal: AbortSignal): Promise<Session>;
    /** identity fields behind the (PeerJS-only) cold-reload resume marker —
     *  undefined for transports (Steam) with no such feature. */
    ownId?: string;
    remoteId?: string;
}

/**
 * What `Game` needs from the star (2v2+) host relay during actual play —
 * lobby-formation concerns (`listen`/`setRosterEntry`/`currentRoster`/
 * `nextOpenSeat`/`peerId`/`onRosterChange`) stay main.ts's concern,
 * operating on the concrete `StarHub` directly before the match starts.
 */
export interface HostHub {
    onMessage: ((seat: SeatId, msg: NetMessage) => void) | null;
    /** grace window elapsed with no reconnect — final, seat is freed */
    onSeatDropped: ((seat: SeatId) => void) | null;
    /** connection just dropped — seat stays reserved, awaiting a
     *  starRejoin within the grace window (see StarHub.dropSeat) */
    onSeatSuspended: ((seat: SeatId) => void) | null;
    /** a previously-suspended seat successfully reclaimed its connection */
    onSeatReconnected: ((seat: SeatId) => void) | null;
    broadcast(msg: NetMessage, exclude?: SeatId): void;
    send(seat: SeatId, msg: NetMessage): void;
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
        sideLocked: (side: 'a' | 'b') => boolean,
    ): void;
    flushAllBuffers(): void;
    connectedSeats(): SeatId[];
    sideOf(seat: SeatId): 'a' | 'b';
    currentRoster(): CanonicalSeatDef[];
    /** corrects this hub's own roster entry for a seat — needed whenever a
     *  seat's controller changes after the initial join (AI takeover,
     *  AI-fill at match start): nextOpenSeat() reads this hub's roster, not
     *  Game's local seat state, to decide what's available to a new joiner. */
    setRosterEntry(seat: SeatId, entry: CanonicalSeatDef): void;
    close(): void;
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
export class StarHub implements HostHub {
    // conn: null means the seat is reserved but currently disconnected —
    // awaiting a starRejoin within its grace window (see dropSeat). Kept in
    // the map (not deleted) so nextOpenSeat still treats it as occupied,
    // not up for grabs by a brand new joiner.
    private readonly bySeat = new Map<
        SeatId,
        {
            conn: DataConnection | null;
            buffer: NetMessage[];
            liveness: { markSeen: () => void; stop: () => void } | null;
        }
    >();
    private readonly reconnectTimers = new Map<SeatId, ReturnType<typeof setTimeout>>();
    private roster: CanonicalSeatDef[];

    /** fired whenever a guest joins/leaves before match start (lobby display) */
    onRosterChange: (() => void) | null = null;
    /** fired once a connected guest sends a message post-setup (actions, chat, etc.) */
    onMessage: ((seat: SeatId, msg: NetMessage) => void) | null = null;
    /** grace window elapsed with no reconnect — final, seat is freed */
    onSeatDropped: ((seat: SeatId) => void) | null = null;
    /** connection just dropped — seat stays reserved, awaiting a
     *  starRejoin within the grace window */
    onSeatSuspended: ((seat: SeatId) => void) | null = null;
    /** a previously-suspended seat successfully reclaimed its connection */
    onSeatReconnected: ((seat: SeatId) => void) | null = null;

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
     * Also accepts `starRejoin` from a previously-connected seat trying to
     * reclaim its (still-reserved, see dropSeat) slot after a drop — that
     * path never calls `onJoin` at all, since it isn't a new join.
     */
    listen(onJoin: (name: string, version: number, conn: DataConnection) => SeatId | null): void {
        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                const onData = (data: unknown) => {
                    const msg = data as NetMessage;
                    if (msg.type === 'starRejoin') {
                        conn.off('data', onData);
                        if (msg.version !== GAME_VERSION || !this.reclaimSeat(msg.seat, conn)) {
                            conn.send({
                                type: 'starRejoinRejected',
                                reason: 'Version mismatch, or that seat is no longer awaiting reconnect.',
                            });
                            conn.close();
                        }
                        return;
                    }
                    if (msg.type !== 'starJoin') {
                        conn.close();
                        return;
                    }
                    conn.off('data', onData);
                    // A returning player whose OWN Game object is gone
                    // (thrown back to the main menu, not an in-session
                    // redial — that uses 'starRejoin' with a remembered
                    // seat number instead) looks exactly like a fresh join
                    // on the wire. Match by name against any currently-
                    // dropped seat before treating it as one, reusing the
                    // same reclaim path (and grace window) as an explicit
                    // starRejoin.
                    const droppedSeat = this.findDroppedSeatByName(msg.name);
                    if (droppedSeat !== null) {
                        if (msg.version !== GAME_VERSION || !this.reclaimSeat(droppedSeat, conn)) {
                            conn.send({
                                type: 'starRejoinRejected',
                                reason: 'Version mismatch, or that seat is no longer awaiting reconnect.',
                            });
                            conn.close();
                        }
                        return;
                    }
                    const seat = onJoin(msg.name, msg.version, conn);
                    if (seat === null) return; // onJoin already sent starRejected + closed
                    this.bySeat.set(seat, { conn, buffer: [], liveness: null });
                    this.wireSeatConn(seat, conn);
                    this.onRosterChange?.();
                };
                conn.on('data', onData);
            });
        });
    }

    /**
     * A previously-connected seat's connection just came back — swap the
     * dead connection out for the new one and cancel its grace timer.
     * Returns false if this seat isn't actually pending (already gone,
     * never existed, or a race already reclaimed it), in which case the
     * caller must reject the attempt rather than silently no-op.
     */
    private reclaimSeat(seat: SeatId, conn: DataConnection): boolean {
        const viewer = this.bySeat.get(seat);
        if (!viewer || viewer.conn !== null) return false;
        const timer = this.reconnectTimers.get(seat);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.reconnectTimers.delete(seat);
        }
        viewer.conn = conn;
        this.wireSeatConn(seat, conn);
        this.onSeatReconnected?.(seat);
        this.onRosterChange?.();
        return true;
    }

    /** shared per-seat connection wiring — used for both a fresh join and a
     *  successful reclaim. Intercepts ping/pong (see watchLiveness) before
     *  anything reaches `onMessage`, and starts this seat's own liveness
     *  watchdog so a hard client-side close/crash is detected as fast and
     *  reliably as an orderly one, instead of depending on however promptly
     *  the browser/OS happens to tear down the underlying connection. */
    private wireSeatConn(seat: SeatId, conn: DataConnection): void {
        const viewer = this.bySeat.get(seat);
        viewer?.liveness?.stop(); // replacing a reclaimed connection's own prior watchdog
        conn.on('data', (d) => {
            const msg = d as NetMessage;
            this.bySeat.get(seat)?.liveness?.markSeen();
            if (msg.type === 'ping') {
                conn.send({ type: 'pong' });
                return;
            }
            if (msg.type === 'pong') return;
            this.onMessage?.(seat, msg);
        });
        conn.on('close', () => this.dropSeat(seat));
        conn.on('error', () => this.dropSeat(seat));
        if (viewer) {
            viewer.liveness = watchLiveness(
                () => conn.send({ type: 'ping' }),
                () => this.dropSeat(seat),
            );
        }
    }

    /** call once a joining connection is accepted, before/with `starSetup` */
    setRosterEntry(seat: SeatId, entry: CanonicalSeatDef): void {
        this.roster = this.roster.map((s, i) => (i === seat ? entry : s));
    }

    /** a currently-dropped (conn: null, still within its grace window) seat
     *  whose roster name matches — lets a returning player reclaim purely
     *  by identity, with no memory of their own seat number (see the
     *  'starJoin' branch of listen() for why that matters). */
    private findDroppedSeatByName(name: string): SeatId | null {
        for (const [seat, viewer] of this.bySeat) {
            if (viewer.conn !== null) continue;
            if (this.roster[seat]?.name === name) return seat;
        }
        return null;
    }

    /**
     * A seat's connection just closed/errored. Doesn't free the seat
     * immediately — keeps it reserved (conn: null) for STAR_RECONNECT_GRACE_MS,
     * awaiting a starRejoin, before giving up for good. A stale event for
     * an already-handled drop (e.g. both 'close' and 'error' firing for
     * the same connection) or a seat that already reclaimed itself is a
     * safe no-op (viewer.conn !== null check below).
     */
    private dropSeat(seat: SeatId): void {
        const viewer = this.bySeat.get(seat);
        if (!viewer || viewer.conn === null) return;
        viewer.conn = null;
        viewer.liveness?.stop();
        viewer.liveness = null;
        // the live-relay buffer is moot now — a successful reclaim gets a
        // fresh, authoritative starResumeState instead (see Game's
        // onSeatReconnected), so stale buffered entries would only risk
        // double-delivery once StarHub.relayBuild resumes flushing to them
        viewer.buffer.length = 0;
        this.onSeatSuspended?.(seat);
        this.onRosterChange?.();
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(seat);
            if (this.bySeat.get(seat)?.conn !== null) return; // reclaimed in the meantime
            this.bySeat.delete(seat);
            this.onSeatDropped?.(seat);
            this.onRosterChange?.();
        }, STAR_RECONNECT_GRACE_MS);
        this.reconnectTimers.set(seat, timer);
    }

    send(seat: SeatId, msg: NetMessage): void {
        this.bySeat.get(seat)?.conn?.send(msg);
    }

    /** every connected guest (not the host's own seat(s)); `exclude` skips
     *  one seat — used when relaying a message THAT seat just sent, so it
     *  doesn't get echoed back to its own sender */
    broadcast(msg: NetMessage, exclude?: SeatId): void {
        for (const [seat, { conn }] of this.bySeat) {
            if (seat === exclude || !conn) continue;
            conn.send(msg);
        }
    }

    /**
     * Vision-filtered relay of one build-phase action/undo: live to every
     * ally (same side) recipient immediately; buffered per-recipient for
     * enemy-side recipients until `sideLocked(fromSide)` is true, at which
     * point that recipient's WHOLE buffer flushes (only one enemy side
     * exists per recipient — Tier 1, sides stay binary). Gate itself is the
     * shared `isRevealable` predicate (see its doc comment) — same one
     * SpectatorHub uses, just with a `{kind:'seat'}` policy per recipient.
     */
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
        sideLocked: (side: 'a' | 'b') => boolean,
    ): void {
        const fromSide = this.sideOf(fromSeat);
        for (const [seat, viewer] of this.bySeat) {
            // never echo back to the sender; a currently-disconnected
            // recipient gets fully caught up via starResumeState on
            // reconnect instead — nothing useful to buffer for them here
            if (seat === fromSeat || !viewer.conn) continue;
            const policy = seatVisionPolicy(this.sideOf(seat));
            if (isRevealable(policy, fromSide, sideLocked)) {
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
            if (!viewer.conn) continue;
            for (const buffered of viewer.buffer) viewer.conn.send(buffered);
            viewer.buffer.length = 0;
        }
    }

    /** connected AND currently reachable — excludes a seat mid-reconnect-gap */
    connectedSeats(): SeatId[] {
        return [...this.bySeat.entries()].filter(([, v]) => v.conn !== null).map(([seat]) => seat);
    }

    close(): void {
        for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
        this.reconnectTimers.clear();
        for (const { conn } of this.bySeat.values()) conn?.close();
        this.bySeat.clear();
        this.peer.destroy();
    }
}

/** What `Game` needs from a star guest connection during actual play. */
export interface GuestSession {
    onClose: (() => void) | null;
    attach(handler: (msg: NetMessage) => void): void;
    send(msg: NetMessage): void;
    once(): Promise<NetMessage>;
    close(): void;
    /** this session was superseded by a fresh one from a successful
     *  redial() — stop listening/reporting without tearing down anything
     *  the NEW session still needs (e.g. a shared Peer object) */
    discard(): void;
    redial(mySeat: SeatId, signal: AbortSignal, delayMs?: number): Promise<GuestSession>;
}

/**
 * Guest side of a star (2v2+) room: a single connection to the host,
 * shaped like `NetSession` (attach/send/once) but without the host/guest
 * role split — a star guest never accepts inbound connections itself.
 */
export class StarGuestSession implements GuestSession {
    onClose: (() => void) | null = null;
    private handler: ((msg: NetMessage) => void) | null = null;
    private readonly backlog: NetMessage[] = [];
    private closed = false;
    // `peer` is shared and reused across every redial (see redial() below) —
    // a per-session peer.on('error', ...) that's never removed stacks one
    // more listener onto that same long-lived Peer every reconnect cycle.
    // Bound once so both fireClose() and discard()/close() can remove this
    // EXACT listener instance.
    private readonly onPeerError = () => this.fireClose();
    private readonly liveness: { markSeen: () => void; stop: () => void };

    constructor(
        private readonly peer: Peer,
        private readonly conn: DataConnection,
    ) {
        conn.on('data', (data) => {
            const msg = data as NetMessage;
            this.liveness.markSeen();
            if (msg.type === 'ping') {
                conn.send({ type: 'pong' });
                return;
            }
            if (msg.type === 'pong') return;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
        conn.on('close', () => this.fireClose());
        conn.on('error', () => this.fireClose());
        peer.on('error', this.onPeerError);
        this.liveness = watchLiveness(() => conn.send({ type: 'ping' }), () => this.fireClose());
    }

    private fireClose(): void {
        if (this.closed) return;
        this.closed = true;
        this.liveness.stop();
        this.peer.off('error', this.onPeerError);
        this.onClose?.();
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

    /**
     * Superseded by a fresh reconnected session (a successful redial()) —
     * stop listening on the shared, still-alive Peer object without
     * destroying it (unlike close(), which is for actually leaving the
     * match and needs the peer gone too).
     */
    discard(): void {
        this.onClose = null;
        this.closed = true;
        this.liveness.stop();
        this.peer.off('error', this.onPeerError);
    }

    close(): void {
        this.onClose = null;
        this.closed = true;
        this.liveness.stop();
        this.peer.off('error', this.onPeerError);
        this.conn.close();
        this.peer.destroy();
    }

    /**
     * Redials the SAME host peer id with our OWN still-alive Peer object —
     * an in-session reconnect after a dropped connection, never a full page
     * reload (that's a separate, still-unbuilt story for star mode, same
     * as before this). Retries until `signal` aborts (caller's grace
     * window owns that). Sends `starRejoin` as soon as the raw connection
     * opens and returns a fresh `StarGuestSession` wrapping it — whether
     * the host actually ACCEPTS the rejoin (vs. `starRejoinRejected`, e.g.
     * the grace window already elapsed on their end) is the caller's own
     * `.once()` to interpret, same as `joinStarRoom`'s initial `starJoin`.
     */
    async redial(mySeat: SeatId, signal: AbortSignal, delayMs = 3000): Promise<StarGuestSession> {
        const hostId = this.conn.peer;
        for (;;) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
                const conn = await connectRawTo(this.peer, hostId, signal);
                conn.send({ type: 'starRejoin', seat: mySeat, version: GAME_VERSION });
                return new StarGuestSession(this.peer, conn);
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') throw e;
                await delay(delayMs, signal);
            }
        }
    }
}

/** Like `connectTo`, but returns the raw connection instead of a `NetSession`
 *  — used by star mode's own handshake shapes (starJoin/starRejoin), which
 *  aren't NetSession's hello/setup protocol. */
function connectRawTo(peer: Peer, remoteId: string, signal?: AbortSignal): Promise<DataConnection> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        // a timed-out/aborted/errored attempt still holds a live
        // RTCPeerConnection underneath — must be explicitly closed or it
        // leaks for the rest of the tab's life. A retry loop (redial())
        // calling this repeatedly without this leaked one dangling
        // RTCPeerConnection per failed attempt, eventually hitting the
        // browser's hard cap on concurrent/cumulative peer connections.
        // `peer` itself is shared and long-lived across every retry, so its
        // own 'error' listener must be torn down on every settle path too —
        // otherwise each retry stacks another one for the rest of the tab's
        // life (a leaked listener, not a connection, but the same species
        // of bug).
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            peer.off('error', onPeerError);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.close();
            reject(new Error('Room not found or host offline'));
        }, CONNECT_TIMEOUT_MS);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.close();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const onPeerError = (e: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.close();
            reject(e);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        peer.on('error', onPeerError);
        const conn = peer.connect(remoteId, { reliable: true });
        conn.on('open', () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(conn);
        });
        conn.on('error', (e) => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.close();
            reject(e);
        });
    });
}

/**
 * What `Game` needs to know about its star-mode connection: whether it's
 * the relay (host) or a spoke (guest), and which canonical seat this
 * client occupies. `mySeat` is NOT necessarily 0 for a guest — only the
 * host is guaranteed seat 0 by the join-order convention. Typed against the
 * `HostHub`/`GuestSession` interfaces (not the concrete `StarHub`/
 * `StarGuestSession` classes) so a future transport (e.g. Steam P2P) can
 * hand `Game` a same-shaped object without `Game` itself changing at all;
 * `StarHub`/`StarGuestSession` (PeerJS) already satisfy them.
 */
export type StarRole =
    | { role: 'host'; hub: HostHub; mySeat: SeatId }
    | { role: 'guest'; session: GuestSession; mySeat: SeatId };

/**
 * Host a 2v2+ star room: opens a peer, registers it in the public/room-code
 * lobby exactly like `hostLobby`, and returns the `StarHub` for the caller
 * to drive the join/seat-assignment/start flow (kept in main.ts, alongside
 * the seat-picker UI — connection plumbing only lives here).
 */
export async function hostStarRoom(
    initialRoster: CanonicalSeatDef[],
    onStatus: (status: string) => void,
    mode: '1v1' | '2v2' = '2v2',
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
    // reuses the SAME room-code registration as 1v1 custom rooms — `mode`
    // is purely a display label for the room list now (every room is
    // star-hosted; joining always goes through the star join flow
    // regardless of `mode`, see joinStarRoom's callers in main.ts).
    await lobbyRegister(hub.peerId, name, mode);
    const heartbeat = setInterval(() => void lobbyRegister(hub.peerId, name, mode), HEARTBEAT_MS);
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
        {
            name: string;
            vision: SpectatorVision;
            buildBuffer: NetMessage[];
            liveness: { markSeen: () => void; stop: () => void };
        }
    >();

    /** fired whenever a spectator connects or disconnects */
    onRosterChange: (() => void) | null = null;
    /** fired once a spectator is fully admitted (after onRosterChange, so a
     *  caller announcing this can rely on the roster already reflecting it) */
    onSpectatorJoined: ((name: string) => void) | null = null;
    /** fired once a spectator's connection drops, named — onRosterChange
     *  alone can't tell a caller WHO left, just that the roster changed */
    onSpectatorLeft: ((name: string) => void) | null = null;
    /** fired for chat relayed FROM a spectator (needs mirroring to the
     *  player link and every other spectator) */
    onSpectatorChat: ((name: string, item: ChatItem) => void) | null = null;
    /** fired for a batch of debug events from a spectator (dev-only, `?debug`) */
    onSpectatorDebugLog: ((events: DebugEvent[]) => void) | null = null;

    private constructor(
        private readonly peer: Peer,
        /** dev-only (`?debug`): routes through the owning Game's DebugLog
         *  instead of a bare console.info, so these events join the
         *  aggregated cross-client timeline too — see debugLog.ts */
        private readonly debugLog: (category: string, data?: unknown) => void,
    ) {}

    static async open(debugLog: (category: string, data?: unknown) => void = () => {}): Promise<SpectatorHub> {
        const peer = await openPeer();
        return new SpectatorHub(peer, debugLog);
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
        // same app-level liveness watchdog as player connections (see
        // watchLiveness's doc comment) — a spectator's hard browser-close
        // deserves the same fast, consistent detection as a player's,
        // rather than depending on however promptly WebRTC's own
        // 'close'/'error' happens to fire for a non-orderly drop.
        const liveness = watchLiveness(
            () => conn.send({ type: 'ping' }),
            () => this.drop(conn),
        );
        this.viewers.set(conn, { name, vision, buildBuffer: [], liveness });
        this.onRosterChange?.();
        this.onSpectatorJoined?.(name);
    }

    /** grant or revoke live build vision for a seat on a named spectator */
    setSeatLive(spectatorName: string, seat: 'a' | 'b', grant: boolean): SpectatorVision | null {
        this.debugLog('vision.setSeatLive', {
            spectatorName,
            seat,
            grant,
            knownNames: [...this.viewers.values()].map((v) => v.name),
        });
        for (const [conn, viewer] of this.viewers) {
            if (viewer.name !== spectatorName) continue;
            const seats =
                viewer.vision.mode === 'live' ? new Set(viewer.vision.seats) : new Set<'a' | 'b'>();
            if (grant) seats.add(seat);
            else seats.delete(seat);
            viewer.vision = seats.size === 0 ? { mode: 'battle' } : { mode: 'live', seats: [...seats] };
            conn.send({ type: 'visionUpdate', vision: viewer.vision });
            this.debugLog('vision.setSeatLiveMatched', {
                vision: viewer.vision,
                bufferLenBeforeFlush: viewer.buildBuffer.length,
            });
            // Grant takes effect immediately — anything of this seat's
            // already sitting in the backlog (bought/leveled before the
            // checkbox was clicked) would otherwise sit invisible until
            // this seat's next action happens to trigger a flush, which
            // reads as "vision granted but nothing changed" to a spectator.
            if (grant) this.flushRevealable(conn, viewer, false);
            this.debugLog('vision.setSeatLiveFlushed', { bufferLenAfterFlush: viewer.buildBuffer.length });
            return viewer.vision;
        }
        this.debugLog('vision.setSeatLiveNoMatch', { spectatorName });
        return null;
    }

    /**
     * Is this build message revealable to `viewer` right now? Delegates to
     * the shared `isRevealable` (see its doc comment) — `bothLocked`
     * already collapses "both sides locked" into one boolean here (a
     * spectator never needs to ask about one side alone), so the shared
     * predicate's `sideLocked` callback just returns that same value
     * regardless of which side it's asked about. `msg.side` is only
     * absent for message shapes this hub never actually relays through
     * here in practice (see mirrorBuildToSpectators/relayStarBuildMessage,
     * which always stamp it) — falls back to the bothLocked-only gate.
     */
    private isRevealable(
        viewer: { vision: SpectatorVision },
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        bothLocked: boolean,
    ): boolean {
        if (!msg.side) return bothLocked;
        return isRevealable(spectatorVisionPolicy(viewer.vision), msg.side, () => bothLocked);
    }

    /**
     * Sends every currently-revealable entry out of `viewer`'s backlog,
     * keeping still-fogged entries buffered in order. Per-message, not
     * all-or-nothing: the backlog can hold both seats' withheld actions at
     * once (e.g. one seat live, the other not), so a flush triggered by one
     * seat becoming revealable must not leak the other seat's still-fogged
     * actions along with it.
     */
    private flushRevealable(
        conn: DataConnection,
        viewer: { vision: SpectatorVision; buildBuffer: NetMessage[] },
        bothLocked: boolean,
    ): void {
        if (viewer.buildBuffer.length === 0) return;
        const remaining: NetMessage[] = [];
        for (const buffered of viewer.buildBuffer) {
            const m = buffered as Extract<NetMessage, { type: 'action' | 'undo' }>;
            if (this.isRevealable(viewer, m, bothLocked)) conn.send(buffered);
            else remaining.push(buffered);
        }
        viewer.buildBuffer = remaining;
    }

    /** does at least one connected spectator currently have live vision on `seat`? */
    anyLiveFor(seat: 'a' | 'b'): boolean {
        for (const viewer of this.viewers.values()) {
            if (viewer.vision.mode === 'live' && viewer.vision.seats.includes(seat)) return true;
        }
        return false;
    }

    private onData(conn: DataConnection, msg: NetMessage): void {
        this.viewers.get(conn)?.liveness.markSeen();
        if (msg.type === 'ping') {
            conn.send({ type: 'pong' });
            return;
        }
        if (msg.type === 'pong') return;
        // spectators may only ever chat, or (dev-only) stream debug events
        if (msg.type === 'debugLog') {
            this.onSpectatorDebugLog?.(msg.events);
            return;
        }
        if (msg.type !== 'chat') return;
        const viewer = this.viewers.get(conn);
        if (!viewer) return;
        this.onSpectatorChat?.(viewer.name, msg.item);
    }

    private drop(conn: DataConnection): void {
        const viewer = this.viewers.get(conn);
        if (!viewer) return;
        viewer.liveness.stop();
        this.viewers.delete(conn);
        this.onRosterChange?.();
        this.onSpectatorLeft?.(viewer.name);
    }

    /**
     * Fan a non-build message to every spectator immediately.
     * Build `action`/`undo` use {@link relayBuild} instead.
     */
    broadcast(msg: NetMessage): void {
        for (const conn of this.viewers.keys()) conn.send(msg);
    }

    /**
     * Seeds a just-admitted spectator's build backlog directly, bypassing
     * {@link relayBuild}'s live/bothLocked check. Used to backfill actions
     * that were excluded from their initial catch-up snapshot (they already
     * happened before this spectator connected, per the same vision policy
     * `relayBuild` enforces going forward) — without this, that content is
     * lost forever: `relayBuild`'s per-connection buffer only starts
     * accumulating messages relayed from admission onward, so an action
     * from before this exact connection was never buffered at all. Seeding
     * it here means it flushes naturally the next time
     * {@link flushBuildBuffers} runs (both sides lock in, round resolves).
     */
    seedBuildBuffer(conn: DataConnection, msg: Extract<NetMessage, { type: 'action' | 'undo' }>): void {
        this.viewers.get(conn)?.buildBuffer.push(msg);
    }

    /**
     * Relay a build-phase action/undo with vision filtering.
     * `msg.side` is which player originated it (`'a'` host, `'b'` guest).
     * When `bothLocked`, battle-vision spectators receive their backlog + this msg.
     */
    relayBuild(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        bothLocked: boolean,
    ): void {
        for (const [conn, viewer] of this.viewers) {
            // flush whatever's newly revealable first (e.g. a seat granted
            // live vision since its last action) — per-message, so a
            // still-fogged OTHER seat's backlog entries never leak along
            // with it (see flushRevealable's doc comment)
            this.flushRevealable(conn, viewer, bothLocked);
            const revealNow = this.isRevealable(viewer, msg, bothLocked);
            this.debugLog('vision.relayBuild', {
                viewerName: viewer.name,
                msgKind: msg.type === 'action' ? msg.action.kind : 'undo',
                msgSide: msg.side,
                vision: viewer.vision,
                bothLocked,
                revealNow,
                bufferLenAfter: revealNow ? viewer.buildBuffer.length : viewer.buildBuffer.length + 1,
            });
            if (revealNow) conn.send(msg);
            else viewer.buildBuffer.push(msg);
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

// --- star resume marker: enough to rejoin a star room after a reload ---
// Simpler than classic 1v1's ResumeMarker: joinStarRoom always dials the
// host's room code fresh (no peer ids to remember), and the host's own
// name-matched implicit reclaim (StarHub.findDroppedSeatByName) does the
// rest — so all that needs to survive a reload is which room to rejoin.
// Host-only concept in reverse: only a GUEST ever saves one — if the
// HOST's own tab reloads, its StarHub (and the whole match) is gone with
// it, nothing to resume into.

const STAR_RESUME_KEY = 'mechili-star-resume';

export interface StarResumeMarker {
    hostName: string;
    names: { local: string; opponent: string };
}

export function saveStarResumeMarker(marker: StarResumeMarker): void {
    try {
        sessionStorage.setItem(STAR_RESUME_KEY, JSON.stringify(marker));
    } catch {
        /* private browsing */
    }
}

export function loadStarResumeMarker(): StarResumeMarker | null {
    try {
        const raw = sessionStorage.getItem(STAR_RESUME_KEY);
        return raw ? (JSON.parse(raw) as StarResumeMarker) : null;
    } catch {
        return null;
    }
}

export function clearStarResumeMarker(): void {
    try {
        sessionStorage.removeItem(STAR_RESUME_KEY);
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
export interface SpectateRegistration {
    /** push the current snapshot to the backend right now, instead of
     *  waiting for the next periodic heartbeat (up to HEARTBEAT_MS late
     *  otherwise) — call this whenever the roster actually changes (a
     *  drop, a reconnect, an AI takeover), so the room list reflects it
     *  promptly enough for another player to trust "resume" vs "spectate". */
    refreshNow: () => void;
    stop: () => void;
}

export function registerSpectateEndpoint(
    peerId: string,
    roomName: string,
    mode: '1v1' | '2v2' = '1v1',
    /** queried fresh on every beat (periodic or forced) — never cached, so
     *  round/roster always reflect the CURRENT match state, not whatever
     *  it was at registration time */
    snapshot: () => { roster?: RoomRosterEntry[]; round?: number; data?: unknown } = () => ({}),
): SpectateRegistration {
    let stopped = false;
    const beat = () => {
        if (stopped) return;
        const snap = snapshot();
        const params = new URLSearchParams({
            action: 'spectate-register',
            peer: peerId,
            name: roomName,
            mode,
        });
        if (snap.roster) params.set('roster', JSON.stringify(snap.roster));
        if (snap.round !== undefined) params.set('round', String(snap.round));
        if (snap.data !== undefined) params.set('data', JSON.stringify(snap.data));
        void fetch(`${matchUrl()}?${params.toString()}`).catch(() => undefined);
    };
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    return {
        refreshNow: beat,
        stop: () => {
            if (stopped) return;
            stopped = true;
            clearInterval(heartbeat);
            void lobbyLeave(peerId);
        },
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
    private readonly liveness: { markSeen: () => void; stop: () => void };

    constructor(
        private readonly peer: Peer,
        private readonly conn: DataConnection,
    ) {
        let closed = false;
        const fireClose = () => {
            if (closed) return;
            closed = true;
            this.liveness.stop();
            this.onClose?.();
        };
        conn.on('data', (data) => {
            const msg = data as NetMessage;
            this.liveness.markSeen();
            if (msg.type === 'ping') {
                conn.send({ type: 'pong' });
                return;
            }
            if (msg.type === 'pong') return;
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
        conn.on('close', fireClose);
        conn.on('error', fireClose);
        peer.on('error', fireClose);
        this.liveness = watchLiveness(() => conn.send({ type: 'ping' }), fireClose);
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
        this.liveness.stop();
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

