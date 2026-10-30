/**
 * Hard's army by roles (AI_PLAN.md, "Roles"): a few fixed unit types, like a
 * good player keeps — chaff, one answer each to chaff, air and walls, and a
 * strong unit — and which of them the enemy's army needs answered most.
 */
import { isChaff } from './aiCounters';
import { readEnemyWalls } from './aiWalls';
import type { PlacementController } from './placement';
import type { SeatId } from './seats';
import type { Team, Unit, UnitType } from './units';

/** the fixed units of the roles (the chaff: the commander's own, else the first of these in the shop) */
export const AI_ROLES = {
    chaff: ['goblin', 'dwarf'],
    antiChaff: 'hammerer',
    antiAir: 'archer',
    antiWall: 'ballista',
};
/** a strong unit costs at least this much */
export const STRONG_FROM = 200;
/** the round's 3rd pack is chaff before this round, the ranking's from it on */
export const THIRD_PACK_FREE_FROM = 5;
/** an answer covers what it faces once its value is this share of it */
const ANSWERED = 0.5;
/** the strong unit is helpless (a second one joins) once this share of the enemy is what it can't hit */
const HELPLESS_SHARE = 0.5;

export type Need = 'air' | 'chaff' | 'walls' | 'strong';

export interface Roster {
    chaff: string;
    /** the strong units, the first one first; a second only once the first is helpless */
    strong: string[];
}

function valueOf(u: Unit): number {
    return u.type.cost * Math.max(1, u.level);
}

function onBoard(u: Unit): boolean {
    return u.team !== 'horde' && !u.destroyed && !u.summoned;
}

/** the army's units only: no buildings, walls or other extras */
function isPack(u: Unit): boolean {
    return onBoard(u) && !u.type.structure && !u.type.extra && !u.type.wall;
}

/** what the strong unit `t` can't hit of `u` */
function cantHit(t: UnitType, u: Unit): boolean {
    return u.type.flying ? !t.targets.air : !t.targets.ground;
}

/**
 * How much of each kind of the enemy's army is still unanswered: its value
 * less twice what this seat fields against it (half the value answers it).
 * Walls count only where they matter (aiWalls).
 */
export function readNeeds(placement: PlacementController, team: Team, seat: SeatId, roster: Roster): Record<Need, number> {
    const enemy = { air: 0, chaff: 0, walls: 0, strong: 0 };
    const own = { air: 0, chaff: 0, walls: 0, strong: 0 };
    const wallsMatter = readEnemyWalls(placement, team).relevant;
    for (const u of placement.allUnits()) {
        if (!onBoard(u)) continue;
        if (u.team !== team) {
            if (u.type.wall) {
                if (wallsMatter) enemy.walls += valueOf(u);
            } else if (isPack(u)) {
                if (u.type.flying) enemy.air += valueOf(u);
                else if (isChaff(u.type)) enemy.chaff += valueOf(u);
                else enemy.strong += valueOf(u);
            }
        } else if (u.seat === seat && isPack(u)) {
            const id = u.type.id;
            if (id === AI_ROLES.antiAir) own.air += valueOf(u);
            else if (id === AI_ROLES.antiChaff) own.chaff += valueOf(u);
            else if (id === AI_ROLES.antiWall) own.walls += valueOf(u);
            else if (roster.strong.includes(id)) own.strong += valueOf(u);
        }
    }
    const need = (k: Need) => enemy[k] - own[k] / ANSWERED;
    return { air: need('air'), chaff: need('chaff'), walls: need('walls'), strong: need('strong') };
}

/** whether the enemy's army is mostly what `strong` can't hit */
export function strongHelpless(placement: PlacementController, team: Team, strong: UnitType): boolean {
    let all = 0;
    let unhit = 0;
    for (const u of placement.allUnits()) {
        if (u.team === team || !isPack(u)) continue;
        all += valueOf(u);
        if (cantHit(strong, u)) unhit += valueOf(u);
    }
    return all > 0 && unhit / all >= HELPLESS_SHARE;
}
