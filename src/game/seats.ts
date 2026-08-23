import { normalizeLoadout } from './loadouts';
import type { Loadout } from './techCatalog';
import type { Team } from './units';

/**
 * Seats: one army per seat, one or two seats per side. The roster is DATA
 * (mode = roster + settings, per TEAM_MODES_PLAN §2) — nothing in the sim
 * says "2" or "4". v1 scope (local duo mode): economy, deploy slots,
 * recruit level and credit are PER SEAT; techs, boosts, cards, items and
 * tactics stay per SIDE (a deliberate shared-side design for now — revisit
 * when networked team play lands).
 *
 * Seats are keyed by LOCAL perspective team ('player' = my side) because
 * the whole state layer still thinks in local teams; the canonical-seat
 * wire format of the plan comes with networked team modes, not here.
 */
export type SeatId = number;

/**
 * A battle faction — hostility, match HP, tower debuffs (per
 * TEAM_MODES_PLAN.md §2b's Tier 2: "side-keyed state becomes arrays over
 * SideId instead of a {player,enemy} pair"). CANONICAL — identical value
 * for the same physical side on every client, unlike `SeatDef.team` (each
 * client's own "player = mine" local relabeling). Only ever 0/1 today (no
 * mode ships a 3rd side yet), but nothing here hardcodes that.
 */
export type SideId = number;

export interface SeatDef {
    team: Team;
    /** canonical — see SideId's doc comment */
    side: SideId;
    controller: 'human' | 'ai';
    name: string;
    /** optional player face (data URL) — shown in the fight-bar portrait */
    avatar?: string | null;
    /** this seat's pregame talent picks (PROGRESSION_PLAN.md §1). Unset =
     *  the catalog default, which is what AI seats and pre-loadout replays
     *  use. Combat-affecting, so it must be identical on every client —
     *  it rides the canonical roster, never a local decision. */
    loadout?: Loadout;
}

/** the implicit 1v1 roster — classic behavior, seat 0 = the local player */
export function classicSeats(localName: string, opponentName: string): SeatDef[] {
    return [
        { team: 'player', side: 0, controller: 'human', name: localName },
        { team: 'enemy', side: 1, controller: 'ai', name: opponentName },
    ];
}

/**
 * Classic 1v1's canonical roster: host is always canonical side 'a', guest
 * is always canonical side 'b' — identical content on every client, exactly
 * like a star room's `CanonicalSeatDef[]`. `localizeRoster` turns this into
 * each client's own local `SeatDef[]` ("player" = mine), same as star mode.
 * Unlike a star room, there's no `starSetup` handshake to exchange this —
 * both clients already know each other's name (`playerNames`) and their own
 * `side`, so each independently reconstructs the identical canonical roster
 * without needing a wire message for it.
 */
export function canonicalClassicSeats(
    hostName: string,
    guestName: string,
    hostAvatar?: string | null,
    guestAvatar?: string | null,
): CanonicalSeatDef[] {
    return [
        { side: 'a', controller: 'human', name: hostName, avatar: hostAvatar || undefined },
        { side: 'b', controller: 'human', name: guestName, avatar: guestAvatar || undefined },
    ];
}

/** 2v2 skirmish roster: human + AI ally vs two AI commanders */
export function duoSeats(localName: string): SeatDef[] {
    return [
        { team: 'player', side: 0, controller: 'human', name: localName },
        { team: 'player', side: 0, controller: 'ai', name: 'Ally' },
        { team: 'enemy', side: 1, controller: 'ai', name: 'Foe West' },
        { team: 'enemy', side: 1, controller: 'ai', name: 'Foe East' },
    ];
}

/** the first seat of a side — the default actor when an action has no seat */
export function primarySeatOf(seats: readonly SeatDef[], team: Team): SeatId {
    const i = seats.findIndex((s) => s.team === team);
    return i >= 0 ? i : 0;
}

export function seatIdsOf(seats: readonly SeatDef[], team: Team): SeatId[] {
    const ids: SeatId[] = [];
    for (let i = 0; i < seats.length; i++) if (seats[i]!.team === team) ids.push(i);
    return ids;
}

/** every seat on a given canonical side, in roster order */
export function sideIdsOf(seats: readonly SeatDef[], side: SideId): SeatId[] {
    const ids: SeatId[] = [];
    for (let i = 0; i < seats.length; i++) if (seats[i]!.side === side) ids.push(i);
    return ids;
}

/** a seat's own canonical side */
export function sideOf(seats: readonly SeatDef[], seat: SeatId): SideId {
    return seats[seat]?.side ?? 0;
}

/** how many distinct canonical sides this roster has (today: always 2) */
export function sideCount(seats: readonly SeatDef[]): number {
    let max = -1;
    for (const s of seats) if (s.side > max) max = s.side;
    return max + 1;
}

/**
 * The WIRE/canonical roster shape for networked N-seat matches (2v2+):
 * `side` is canonical ('a'/'b', matching the classic host/guest convention)
 * and identical content on every client — unlike `SeatDef.team`, which is
 * each client's own LOCAL relabeling of "which side is mine". Only used by
 * the star-netcode path (settings.seats.length > 2); classic 1v1 keeps its
 * existing swapPerspective translation entirely untouched.
 */
export interface CanonicalSeatDef {
    side: 'a' | 'b';
    controller: 'human' | 'ai';
    name: string;
    /** optional custom player face (data URL); omitted for AI / unset */
    avatar?: string | null;
    /** Custom Game lobby only: this seat's own "I'm ready" checkbox state
     *  — host-authoritative, reset whenever the lobby settings change (see
     *  the 'lobbyReady'/'lobbySettings' NetMessage doc comments). Never
     *  meaningful once the match has actually started. */
    ready?: boolean;
    /** this seat's talent picks, carried to every client by starSetup /
     *  starRoster / matchCatchUp exactly like `avatar`. ALWAYS normalized
     *  before it lands here (see `normalizeLoadout`) — it feeds the sim. */
    loadout?: Loadout;
}

/**
 * One-time translation at match setup: canonical roster + "which side am
 * I" → a LOCAL `SeatDef[]` with `.team` relabeled to each client's own
 * perspective ('player' = mine), SAME ARRAY ORDER/INDEX as the canonical
 * roster on every client. This is the only place a canonical seat becomes
 * a local one — everything downstream (economy, zones, AI, HUD, unit ids)
 * consumes the result exactly like the existing local duo roster, unaware
 * this seat happens to be networked.
 */
export function localizeRoster(canonical: readonly CanonicalSeatDef[], mySide: 'a' | 'b'): SeatDef[] {
    return canonical.map((c) => ({
        team: c.side === mySide ? 'player' : 'enemy',
        // canonical numeric SideId — 'a' -> 0, 'b' -> 1, SAME on every
        // client regardless of `mySide` (unlike `team` above)
        side: c.side === 'a' ? 0 : 1,
        controller: c.controller,
        name: c.name,
        avatar: c.avatar || undefined,
        // Normalize HERE as well as at the host's onJoin: this is the single
        // funnel every wire roster passes through on its way to becoming sim
        // input, so it is the one place that also covers a roster arriving
        // from the HOST (starSetup / starRoster / matchCatchUp). Without it a
        // modified host could hand a guest a loadout the allowlist forbids
        // and the guest's own buyTech gate would honour it.
        loadout: c.loadout ? normalizeLoadout(c.loadout) : undefined,
    }));
}

/** true for the second (or later) seat of a side — drives the alt color */
export function isSecondarySeat(seats: readonly SeatDef[], seat: SeatId): boolean {
    if (seat < 0 || seat >= seats.length) return false;
    return seatIdsOf(seats, seats[seat]!.team).indexOf(seat) > 0;
}

/**
 * Which lane of its side's deploy zone a seat owns: 'full' when the seat is
 * alone on its side, else 'left'/'right' halves (in canonical board x).
 */
export function seatLane(seats: readonly SeatDef[], seat: SeatId): 'full' | 'left' | 'right' {
    const team = seats[seat]!.team;
    const ids = seatIdsOf(seats, team);
    if (ids.length < 2) return 'full';
    return ids.indexOf(seat) === 0 ? 'left' : 'right';
}
