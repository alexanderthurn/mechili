/**
 * Hard's army by roles (AI_PLAN.md, "Roles"): a few fixed unit types, like a
 * good player keeps — chaff, one answer each to chaff, air and walls, and a
 * strong unit — and which of them the enemy's army needs answered most.
 */
import { isChaff } from './aiCounters';
import type { BattleRecord } from './aiThreat';
import { readEnemyWalls } from './aiWalls';
import type { TypeRegistry } from './content/typeRegistry';
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
/**
 * What a loss weighs, for all its HP (a share of HP lost weighs that share):
 * a pack 1, a debuff tower 3 (its debuff), the Stronghold (or Tent) 5 — its
 * fall ends the match. Chaff, walls and other buildings 0: they're there to
 * be hit.
 */
const LOSS_WEIGHT = { pack: 1, tower: 3, keep: 5 };
/** a weak point counts from this much loss (half a pack) */
const WEAK_FROM = 0.5;

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

/** what dealt a loss: flyers, chaff, or anything else */
export type LossKind = 'air' | 'chaff' | 'other';

export interface WeakPoint {
    kind: LossKind;
    /** the loss its kind dealt (pack 1, debuff tower 3, Stronghold 5, by share of HP) */
    loss: number;
    /** the own pack or building that lost most to it */
    victimId: number;
}

function lossWeight(t: UnitType): number {
    if (t.onDestroyed?.collapseOwnArmy) return LOSS_WEIGHT.keep;
    if (t.baseAnchor === 'research' || t.baseAnchor === 'command') return LOSS_WEIGHT.tower;
    if (t.structure || t.extra || t.wall || isChaff(t)) return 0;
    return LOSS_WEIGHT.pack;
}

function lossKind(t: UnitType): LossKind {
    return t.flying ? 'air' : isChaff(t) ? 'chaff' : 'other';
}

/**
 * The seat's weak points of the last battle, biggest first: what it lost,
 * by the kind of unit that dealt it — only losses that hurt (not chaff or
 * walls), and only from {@link WEAK_FROM} on.
 */
export function readWeakPoints(record: BattleRecord, seat: SeatId, types: TypeRegistry): WeakPoint[] {
    const total = { air: 0, chaff: 0, other: 0 };
    const worst: Record<LossKind, { id: number; loss: number } | null> = { air: null, chaff: null, other: null };
    for (const l of record.losses) {
        if (l.seat !== seat) continue;
        const victim = types.byId(l.typeId);
        const weight = victim ? lossWeight(victim) : 0;
        if (weight <= 0) continue;
        let lost = 0;
        for (const hp of l.by.values()) lost += hp;
        // healed and hit again: never more than all of it
        const scale = (weight * Math.min(1, lost / Math.max(1, l.maxHp))) / Math.max(1, lost);
        const mine = { air: 0, chaff: 0, other: 0 };
        for (const [typeId, hp] of l.by) {
            const attacker = types.byId(typeId);
            if (attacker) mine[lossKind(attacker)] += hp * scale;
        }
        for (const k of ['air', 'chaff', 'other'] as const) {
            total[k] += mine[k];
            if (mine[k] > (worst[k]?.loss ?? 0)) worst[k] = { id: l.unitId, loss: mine[k] };
        }
    }
    return (['air', 'chaff', 'other'] as const)
        .filter((k) => total[k] >= WEAK_FROM && worst[k])
        .map((k) => ({ kind: k, loss: total[k], victimId: worst[k]!.id }))
        .sort((a, b) => b.loss - a.loss);
}
