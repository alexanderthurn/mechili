import type { Cell } from './map';
import type { PlacementController } from './placement';
import type { Economy, LevelingSettings } from './settings';
import type { TechTree } from './tech';
import { unitTypeById, type Team, type Unit, type UnitType } from './units';

/**
 * Every way a player (or the enemy AI) can affect the game, as plain data.
 * ALL game mutation flows through {@link ActionDispatcher.dispatch} — the
 * UI, the AI, a replay file and a future network peer are just different
 * action producers. Together with the match seed, the applied-action log is
 * the complete save: nothing else needs persisting, battles re-simulate
 * deterministically from the deployments.
 */
export interface BuyAction {
    kind: 'buy';
    team: Team;
    typeId: string;
    /** resolved spawn spot — the "find a free spot" search runs before the action is made */
    anchor: Cell;
    rotated: boolean;
}
export interface MoveAction {
    kind: 'move';
    team: Team;
    unitId: number;
    anchor: Cell;
}
export interface MoveGroupAction {
    kind: 'moveGroup';
    team: Team;
    unitIds: number[];
    /** rigid translation of the whole formation, in cells */
    dc: number;
    dr: number;
}
export interface RotateAction {
    kind: 'rotate';
    team: Team;
    unitId: number;
}
export interface BuyTechAction {
    kind: 'buyTech';
    team: Team;
    typeId: string;
    techId: string;
}
/** spends banked XP + supply to raise a pack exactly one level */
export interface BuyLevelAction {
    kind: 'buyLevel';
    team: Team;
    unitId: number;
}
/** once per round: every later buy this round arrives at level 2 (paying the premium) */
export interface RecruitLevelAction {
    kind: 'recruitLevel';
    team: Team;
}
export interface EndDeploymentAction {
    kind: 'endDeployment';
    team: Team;
}

export type Action =
    | BuyAction
    | MoveAction
    | MoveGroupAction
    | RotateAction
    | BuyTechAction
    | BuyLevelAction
    | RecruitLevelAction
    | EndDeploymentAction;

/** one applied action as stored in a replay */
export interface LoggedAction {
    round: number;
    /** seconds since the round's build phase began — presentation metadata
     *  ONLY (playback pacing); outcomes never depend on it */
    t: number;
    action: Action;
}

/** log entries additionally carry whatever their revert needs, per kind */
interface LogEntry extends LoggedAction {
    /** buy: the spawned pack */
    unit?: Unit;
    /** buy / buyTech / buyLevel / recruitLevel: supply actually charged */
    paid?: number;
    /** move: the anchor the pack came from */
    from?: Cell;
    /** buyLevel: banked XP before the purchase */
    xpBefore?: number;
}

export interface ActionContext {
    placement: PlacementController;
    economy: Economy;
    techTree: TechTree;
    leveling: LevelingSettings;
    /** per-team recruit level for the running round (reset to 1 each round) */
    recruitLevel: Record<Team, number>;
    /** current round + seconds into its build phase, stamped onto log entries */
    clock: () => { round: number; t: number };
    /** phase transition lives in the Game — the dispatcher only reports it */
    onEndDeployment: (team: Team) => void;
}

/** supply price of raising a pack of this type by one level */
export function levelCost(type: UnitType, economy: Economy, leveling: LevelingSettings): number {
    return Math.round(economy.costOf(type) * leveling.levelCostFactor);
}

/** banked XP a pack needs before its next level can be bought */
export function xpForNextLevel(unit: Unit, economy: Economy, leveling: LevelingSettings): number {
    return economy.costOf(unit.type) * leveling.xpThresholdFactor * unit.level;
}

/**
 * Validates actions against the current state, applies them, and keeps the
 * ordered log that doubles as undo history and replay data.
 */
export class ActionDispatcher {
    private readonly log: LogEntry[] = [];

    constructor(private readonly ctx: ActionContext) {}

    /** applies and logs the action; false = rejected, nothing changed */
    dispatch(action: Action): boolean {
        const entry: LogEntry = { ...this.ctx.clock(), action };
        if (!this.apply(action, entry)) return false;
        this.log.push(entry);
        return true;
    }

    /** true when `team` has revertible actions in `round` (drives the undo button) */
    canUndo(round: number, team: Team): boolean {
        return this.log.some((e) => e.round === round && e.action.team === team);
    }

    /** reverts and forgets one side's MOST RECENT action of the given round */
    undoLast(round: number, team: Team): boolean {
        for (let i = this.log.length - 1; i >= 0; i--) {
            const e = this.log[i]!;
            if (e.round !== round || e.action.team !== team) continue;
            this.revert(e);
            this.log.splice(i, 1);
            return true;
        }
        return false;
    }

    /** the match as pure data — with the settings and seed this reproduces everything */
    serializable(): LoggedAction[] {
        return this.log.map((e) => ({
            round: e.round,
            t: Math.round(e.t * 10) / 10,
            action: e.action,
        }));
    }

    private apply(action: Action, entry: LogEntry): boolean {
        const { placement, economy, techTree, leveling, recruitLevel } = this.ctx;
        switch (action.kind) {
            case 'buy': {
                const type = unitTypeById(action.typeId);
                if (!type || type.structure) return false;
                // an active recruit level adds one level's premium on top
                const level = recruitLevel[action.team];
                const premium = level > 1 ? levelCost(type, economy, leveling) * (level - 1) : 0;
                if (economy.balance(action.team) < economy.costOf(type) + premium) return false;
                const unit = placement.placeUnit(action.team, type, action.anchor, action.rotated);
                if (!unit) return false;
                if (premium > 0) {
                    economy.spend(action.team, premium);
                    unit.level = level;
                    unit.refreshLevelBadge();
                }
                entry.paid = economy.costOf(type) + premium;
                entry.unit = unit;
                return true;
            }
            case 'move': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || !placement.canReposition(unit)) return false;
                entry.from = { ...unit.cell };
                return placement.moveUnit(unit, action.anchor);
            }
            case 'moveGroup': {
                const units = action.unitIds.map((id) => placement.unitById(id));
                const valid = units.every(
                    (u): u is Unit => !!u && u.team === action.team && placement.canReposition(u),
                );
                if (!valid) return false;
                return placement.moveUnits(units as Unit[], action.dc, action.dr);
            }
            case 'rotate': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || !placement.canReposition(unit)) return false;
                return placement.rotateUnit(unit);
            }
            case 'buyTech': {
                const type = unitTypeById(action.typeId);
                const tech = type?.techs.find((t) => t.id === action.techId);
                if (!type || !tech) return false;
                entry.paid = tech.cost;
                return techTree.buy(action.team, type, tech, economy);
            }
            case 'buyLevel': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || unit.type.structure) return false;
                if (unit.level >= leveling.maxLevel) return false;
                const threshold = xpForNextLevel(unit, economy, leveling);
                if (unit.xp < threshold) return false;
                const cost = levelCost(unit.type, economy, leveling);
                if (!economy.spend(action.team, cost)) return false;
                entry.paid = cost;
                entry.xpBefore = unit.xp;
                unit.xp = Math.max(0, unit.xp - threshold);
                unit.level++;
                unit.refreshLevelBadge();
                return true;
            }
            case 'recruitLevel': {
                if (recruitLevel[action.team] > 1) return false; // once per round
                if (!economy.spend(action.team, leveling.recruitLevel2Cost)) return false;
                entry.paid = leveling.recruitLevel2Cost;
                recruitLevel[action.team] = 2;
                return true;
            }
            case 'endDeployment': {
                this.ctx.onEndDeployment(action.team);
                return true;
            }
        }
    }

    /** exact inverse of apply — safe because a round's reverts run newest-first */
    private revert(e: LogEntry): void {
        const { placement, economy, techTree } = this.ctx;
        const action = e.action;
        switch (action.kind) {
            case 'buy':
                placement.removeUnit(e.unit!);
                economy.credit(action.team, e.paid!);
                break;
            case 'move':
                placement.moveUnit(placement.unitById(action.unitId)!, e.from!);
                break;
            case 'moveGroup':
                placement.moveUnits(
                    action.unitIds.map((id) => placement.unitById(id)!),
                    -action.dc,
                    -action.dr,
                );
                break;
            case 'rotate':
                placement.rotateUnit(placement.unitById(action.unitId)!);
                break;
            case 'buyTech':
                techTree.remove(action.team, action.typeId, action.techId);
                economy.credit(action.team, e.paid!);
                break;
            case 'buyLevel': {
                const unit = placement.unitById(action.unitId)!;
                unit.level--;
                unit.xp = e.xpBefore!;
                unit.refreshLevelBadge();
                economy.credit(action.team, e.paid!);
                break;
            }
            case 'recruitLevel':
                this.ctx.recruitLevel[action.team] = 1;
                economy.credit(action.team, e.paid!);
                break;
            case 'endDeployment':
                break; // closes a round — never sits in an undoable tail
        }
    }
}
