/**
 * What a multi-selection can do in one click (the group panel): every selected
 * piece takes ONE step of an action, the pieces that can't take it are left
 * out — level up (packs with the XP banked, walls / gates / towers below their
 * top level), make gate (plain walls without archers), archers (one each on a
 * walkway with a free post), walkway (walls without one).
 *
 * Only the plan lives here: the actions themselves are the ordinary single
 * ones, sent one by one under one {@link Action.batch} number (one Undo takes
 * them all back). The group panel offers a step only when all of it can be
 * paid — supply, and for archers one of the round's buys each.
 */
import { buildingUpgradeFor, type Action } from './actions';
import type { TowerSettings } from './settings';
import type { SeatId } from './seats';
import type { Unit, UnitType } from './units';

export type GroupActionId = 'level' | 'gate' | 'archers' | 'walkway';
/** the panel's order */
export const GROUP_ACTION_IDS: readonly GroupActionId[] = ['level', 'walkway', 'archers', 'gate'];

export interface GroupStep {
    id: GroupActionId;
    /** in the order they are sent */
    actions: Action[];
    /** pieces it acts on */
    count: number;
    /** supply, all of it */
    cost: number;
    /** buys of the round it takes (archers) */
    buys: number;
}

export interface GroupContext {
    seat: SeatId;
    towers: TowerSettings;
    /** every unit on the board (archers posted on walls are counted from it) */
    allUnits(): readonly Unit[];
    /** a pack's level-up is ready: XP banked, below the top level */
    packReady(u: Unit): boolean;
    /** a pack's level-up price */
    levelCost(u: Unit): number;
    /** what one archer on this wall costs */
    postCost(type: UnitType): number;
}

/** each action the selection could take now, with what it touches and costs (none that touch nothing) */
export function groupSteps(units: readonly Unit[], ctx: GroupContext): GroupStep[] {
    const own = units.filter((u) => !u.destroyed && u.seat === ctx.seat);
    const posted = (wall: Unit) => ctx.allUnits().filter((p) => p.hostUnitId === wall.id).length;
    const steps: GroupStep[] = [];
    const add = (id: GroupActionId, items: { action: Action; cost: number; buys?: number }[]) => {
        if (items.length === 0) return;
        steps.push({
            id,
            actions: items.map((i) => i.action),
            count: items.length,
            cost: items.reduce((sum, i) => sum + i.cost, 0),
            buys: items.reduce((sum, i) => sum + (i.buys ?? 0), 0),
        });
    };

    // level up: the lowest first (the order only shows in the log — the whole step is paid or none)
    const level: { action: Action; cost: number }[] = [];
    for (const u of [...own].sort((a, b) => a.level - b.level || a.id - b.id)) {
        if (!u.type.structure) {
            if (ctx.packReady(u)) level.push({ action: { kind: 'buyLevel', team: 'player', unitId: u.id }, cost: ctx.levelCost(u) });
            continue;
        }
        // base buildings and walls level for supply; the other extras (Ward Stone, Fire Bolt) don't level
        if (u.type.extra && !u.type.wall) continue;
        const up = buildingUpgradeFor(u, ctx.seat, ctx.towers);
        if (up && !up.maxed) level.push({ action: { kind: 'upgradeTower', team: 'player', unitId: u.id }, cost: up.cost });
    }
    add('level', level);

    const walls = own.filter((u) => !!u.type.wall);
    add(
        'walkway',
        walls
            .filter((w) => !w.type.wall!.autoWalk && !w.wallWalk)
            .map((w) => ({ action: { kind: 'buildWallWalk', team: 'player', unitId: w.id } as Action, cost: w.type.wall!.walkCost ?? 20 })),
    );
    add(
        'archers',
        walls
            .filter((w) => !!w.type.wall!.posts && w.wallWalk && posted(w) < w.type.wall!.posts!.count)
            .map((w) => ({ action: { kind: 'buyWallPost', team: 'player', unitId: w.id } as Action, cost: ctx.postCost(w.type), buys: 1 })),
    );
    // a wall carrying archers stays a wall: the gate would cost them
    add(
        'gate',
        walls
            .filter((w) => !!w.type.wall!.makeGate && posted(w) === 0)
            .map((w) => ({ action: { kind: 'makeGate', team: 'player', unitId: w.id } as Action, cost: w.type.wall!.makeGate!.cost })),
    );
    return steps.sort((a, b) => GROUP_ACTION_IDS.indexOf(a.id) - GROUP_ACTION_IDS.indexOf(b.id));
}
