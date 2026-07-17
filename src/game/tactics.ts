import { CELL } from './map';
import { OIL_SPILL_DURATION_ROUNDS, OIL_SPILL_RADIUS } from './fire';

/** tactical orders (not pack items) — granted by round cards, consumed per placement */
export const RALLY_ROUTE_ID = 'rallyRoute';
export const OIL_SPILL_ID = 'oilSpill';
/** selling a pack — charges come from the Command Tower's sell ability, not cards */
export const SELL_UNIT_ID = 'sellUnit';

/**
 * Max center-to-center distance for two-point tactics (rally corridor / oil capsule).
 * Keeps placements readable and stops a single charge from covering the whole board.
 */
export const TACTIC_MAX_SPAN = 14 * CELL;

/**
 * HOW TO ADD A TACTIC — the whole system in one checklist:
 *  1. Register it here: an id constant + a TACTICS entry. `kind` decides how
 *     the strip and charge accounting behave (see below) — nothing else in
 *     the HUD needs touching, the strip renders every TACTICS entry generically.
 *  2. Give it an action in actions.ts. Validate + consume charges there:
 *     'placement' kinds count their placements against the inventory total;
 *     'oneShot' kinds call consumeTacticCharge() so undo, save/reload and the
 *     greyed-out strip entry all work automatically. NEW ACTION KINDS THAT
 *     CARRY UNIT IDS MUST BE ADDED TO Game.swapPerspective (peer desync!).
 *  3. Wire the targeting in Game.handleTacticGroundClick (the strip arms the
 *     tactic for you) plus any draft/preview visuals.
 *  4. Grant charges through a round card (`tactics: [id]` in cards.ts) —
 *     cards are logged actions, so replay/reload handles them for free.
 *     Grants OUTSIDE the action log (dev freebies) must exist before a
 *     reload's replay: add the id to TEST_TACTIC_GRANTS in game.ts, done.
 *
 * `kind` semantics:
 *  - 'placement': the charge stays in the inventory; using it creates a
 *    placement on the board (rally route, oil stamp) that the player can
 *    right-click in the strip to reset. Available = charges − placements.
 *  - 'oneShot': using it removes the charge from the inventory; the log
 *    entry records it (usedTactic) so undo restores it and the strip keeps
 *    the spent charge visible greyed-out for the rest of the round.
 */
export const TACTICS: Record<
    string,
    {
        id: string;
        name: string;
        icon: string;
        description: string;
        kind: 'placement' | 'oneShot';
        /** oil spill only */
        oilRadius?: number;
        oilDurationRounds?: number;
    }
> = {
    [RALLY_ROUTE_ID]: {
        id: RALLY_ROUTE_ID,
        name: 'Rally Route',
        icon: '⚑',
        kind: 'placement',
        description:
            'Place a start and end zone. Units in the start circle march to matching positions at the end, fighting along the way.',
    },
    [OIL_SPILL_ID]: {
        id: OIL_SPILL_ID,
        name: 'Oil Spill',
        icon: '🛢',
        kind: 'placement',
        description:
            'Place two oil circles — outline during deploy; oil lands at battle start (ward discs stay clear). Connected oil ignites as one field when fire touches it.',
        oilRadius: OIL_SPILL_RADIUS,
        oilDurationRounds: OIL_SPILL_DURATION_ROUNDS,
    },
    [SELL_UNIT_ID]: {
        id: SELL_UNIT_ID,
        name: 'Sell Pack',
        icon: '💰',
        kind: 'oneShot',
        description:
            'Click to arm, then click one of your packs to sell it for a supply refund.',
    },
};

/** capture radius around each rally point (world units) */
export const RALLY_ROUTE_RADIUS = 5 * CELL;
/** how close a mech must get to its personal destination */
export const RALLY_ROUTE_REACH = CELL * 0.5;
/** if a mech cannot get closer for this long, treat the route as complete */
export const RALLY_ROUTE_STUCK_SEC = 3;

export interface RallyRoute {
    id: number;
    team: import('./units').Team;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
}

/** one oil stamp action record (capsule: two circles + strip between) */
export interface OilStamp {
    id: number;
    team: import('./units').Team;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    radius: number;
    /** last inclusive round this stamp's oil remains */
    expiresRound: number;
    placedRound: number;
}

/** pull `end` toward `start` so center distance ≤ maxSpan */
export function clampTacticEnd(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    maxSpan = TACTIC_MAX_SPAN,
): { x: number; z: number } {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.hypot(dx, dz);
    if (len <= maxSpan || len < 1e-9) return { x: endX, z: endZ };
    const s = maxSpan / len;
    return { x: startX + dx * s, z: startZ + dz * s };
}

/** keep a tactic circle fully on the board (margin = circle radius) */
export function clampTacticPoint(
    x: number,
    z: number,
    halfW: number,
    halfH: number,
    radius: number,
): { x: number; z: number } {
    return {
        x: Math.max(-halfW + radius, Math.min(halfW - radius, x)),
        z: Math.max(-halfH + radius, Math.min(halfH - radius, z)),
    };
}
