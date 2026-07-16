import { CELL } from './map';
import { OIL_SPILL_DURATION_ROUNDS, OIL_SPILL_RADIUS } from './fire';

/** tactical orders (not pack items) — granted by round cards, consumed per placement */
export const RALLY_ROUTE_ID = 'rallyRoute';
export const OIL_SPILL_ID = 'oilSpill';

export const TACTICS: Record<
    string,
    {
        id: string;
        name: string;
        icon: string;
        description: string;
        /** oil spill only */
        oilRadius?: number;
        oilDurationRounds?: number;
    }
> = {
    [RALLY_ROUTE_ID]: {
        id: RALLY_ROUTE_ID,
        name: 'Rally Route',
        icon: '⚑',
        description:
            'Place a start and end zone. Units in the start circle march to matching positions at the end, fighting along the way.',
    },
    [OIL_SPILL_ID]: {
        id: OIL_SPILL_ID,
        name: 'Oil Spill',
        icon: '🛢',
        description:
            'Stamp oil onto the shared ground layer. Connected oil ignites as one field when fire touches it. Lasts a few rounds until burned or expired.',
        oilRadius: OIL_SPILL_RADIUS,
        oilDurationRounds: OIL_SPILL_DURATION_ROUNDS,
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

/** one oil stamp action record (the field itself merges stamps) */
export interface OilStamp {
    id: number;
    team: import('./units').Team;
    x: number;
    z: number;
    radius: number;
    /** last inclusive round this stamp's oil remains */
    expiresRound: number;
    placedRound: number;
}
