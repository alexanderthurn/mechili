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

export interface SeatDef {
    team: Team;
    controller: 'human' | 'ai';
    name: string;
}

/** the implicit 1v1 roster — classic behavior, seat 0 = the local player */
export function classicSeats(localName: string, opponentName: string): SeatDef[] {
    return [
        { team: 'player', controller: 'human', name: localName },
        { team: 'enemy', controller: 'ai', name: opponentName },
    ];
}

/** 2v2 skirmish roster: human + AI ally vs two AI commanders */
export function duoSeats(localName: string): SeatDef[] {
    return [
        { team: 'player', controller: 'human', name: localName },
        { team: 'player', controller: 'ai', name: 'Ally' },
        { team: 'enemy', controller: 'ai', name: 'Foe West' },
        { team: 'enemy', controller: 'ai', name: 'Foe East' },
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
