import { ROUND_CARDS, SKIP_CARD_REWARD, START_CARDS, type SpecialityId } from './cards';
import { ITEMS } from './items';
import type { Cell } from './map';
import type { PlacementController } from './placement';
import type {
    BoostSettings,
    DeploySettings,
    Economy,
    LevelingSettings,
    SellSettings,
    TowerSettings,
} from './settings';
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
/** raises a base building one level (no XP needed, rising supply cost) */
export interface UpgradeTowerAction {
    kind: 'upgradeTower';
    team: Team;
    unitId: number;
}
/** unlocks selling PERMANENTLY (Command Tower, once per match) */
export interface BuySellAbilityAction {
    kind: 'buySellAbility';
    team: Team;
}
/** sells a pack for its refund — limited per deployment phase */
export interface SellUnitAction {
    kind: 'sellUnit';
    team: Team;
    unitId: number;
}
/** Research Center: +1 unit purchase for the RUNNING round only */
export interface BuyDeploySlotAction {
    kind: 'buyDeploySlot';
    team: Team;
}
/** Command Tower: the next tier of a permanent army-wide stat boost */
export interface BuyBoostAction {
    kind: 'buyBoost';
    team: Team;
    boost: 'attack' | 'hp';
}
/** the pre-round-1 specialist pick: starting army + HP + speciality + items */
export interface ChooseCardAction {
    kind: 'chooseCard';
    team: Team;
    cardId: string;
}
/** equips an inventory item onto a pack — permanent once the deployment ends */
export interface ApplyItemAction {
    kind: 'applyItem';
    team: Team;
    unitId: number;
    itemId: string;
}
/** the between-round card pick; cardId null = skip (paid the skip reward). NOT undoable. */
export interface RoundCardAction {
    kind: 'roundCard';
    team: Team;
    cardId: string | null;
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
    | UpgradeTowerAction
    | BuySellAbilityAction
    | SellUnitAction
    | BuyDeploySlotAction
    | BuyBoostAction
    | ChooseCardAction
    | ApplyItemAction
    | RoundCardAction
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
    /** chooseCard: the spawned starting army + the HP it replaced + granted items */
    units?: Unit[];
    prevHp?: number;
    grantedItems?: string[];
}

export interface ActionContext {
    placement: PlacementController;
    economy: Economy;
    techTree: TechTree;
    leveling: LevelingSettings;
    towers: TowerSettings;
    sellSettings: SellSettings;
    deploySettings: DeploySettings;
    boostSettings: BoostSettings;
    /** per-team recruit level for the running round (reset to 1 each round) */
    recruitLevel: Record<Team, number>;
    /** per-team sell state: `owned` is permanent, `used` resets each round */
    sellState: { owned: Record<Team, boolean>; used: Record<Team, number> };
    /**
     * per-team buy limits: `limit` is the permanent baseline (specials may
     * raise it for good), `extra` and `used` reset every round
     */
    deployState: { limit: Record<Team, number>; extra: Record<Team, number>; used: Record<Team, number> };
    /** per-team tier (0 = none) of each permanent army boost */
    boostState: Record<'attack' | 'hp', Record<Team, number>>;
    /** each side's chosen card speciality (null until the pick) */
    speciality: Record<Team, SpecialityId | null>;
    /** each side's UNEQUIPPED pack items (item ids; duplicates stack) */
    items: Record<Team, string[]>;
    /** whether each side already took (or skipped) this round's card */
    roundCardTaken: Record<Team, boolean>;
    /** player HP pools (cards set the starting value) */
    hp: { get: (team: Team) => number; set: (team: Team, hp: number) => void };
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

/** supply price of a base building's next level: baseCost, then +costStep per level taken */
export function towerUpgradeCost(currentLevel: number, towers: TowerSettings): number {
    return towers.upgrade.baseCost + (currentLevel - 1) * towers.upgrade.costStep;
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
        return this.log.some(
            (e) => e.round === round && e.action.team === team && e.action.kind !== 'roundCard',
        );
    }

    /** reverts and forgets one side's MOST RECENT undoable action of the given round */
    undoLast(round: number, team: Team): boolean {
        for (let i = this.log.length - 1; i >= 0; i--) {
            const e = this.log[i]!;
            if (e.round !== round || e.action.team !== team) continue;
            if (e.action.kind === 'roundCard') continue; // final — the offer is gone
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
                // structures aren't buyable — except the board extras
                if (!type || (type.structure && !type.extra)) return false;
                // per-round buy limit: permanent baseline + this round's extra
                // slots; board extras don't consume a slot
                const deploy = this.ctx.deployState;
                if (
                    !type.extra &&
                    deploy.used[action.team] >= deploy.limit[action.team] + deploy.extra[action.team]
                ) {
                    return false;
                }
                // an active recruit level adds one level's premium on top
                // (the elite specialist pays it too — only the SWITCH is free
                // for them); extras never recruit levels
                const level = type.extra ? 1 : recruitLevel[action.team];
                const premium = level > 1 ? levelCost(type, economy, leveling) * (level - 1) : 0;
                if (economy.balance(action.team) < economy.costOf(type) + premium) return false;
                const unit = placement.placeUnit(action.team, type, action.anchor, action.rotated);
                if (!unit) return false;
                if (level > 1) {
                    economy.spend(action.team, premium);
                    unit.level = level;
                    unit.refreshLevelBadge();
                }
                entry.paid = economy.costOf(type) + premium;
                entry.unit = unit;
                if (!type.extra) deploy.used[action.team]++;
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
                if (techTree.has(action.team, type.id, tech.id)) return false;
                // every owned tech of the type makes the remaining ones pricier
                const owned = techTree.ownedFor(action.team, type.id).size;
                const cost = economy.techCostOf(tech, owned);
                if (!economy.spend(action.team, cost)) return false;
                techTree.add(action.team, type.id, tech.id);
                entry.paid = cost;
                return true;
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
                if (this.ctx.speciality[action.team] === 'elite') return false; // already permanent
                if (recruitLevel[action.team] > 1) return false; // once per round
                if (!economy.spend(action.team, leveling.recruitLevel2Cost)) return false;
                entry.paid = leveling.recruitLevel2Cost;
                recruitLevel[action.team] = 2;
                return true;
            }
            case 'upgradeTower': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || !unit.type.structure || unit.type.extra) {
                    return false;
                }
                if (unit.level >= this.ctx.towers.upgrade.maxLevel) return false;
                const cost = towerUpgradeCost(unit.level, this.ctx.towers);
                if (!economy.spend(action.team, cost)) return false;
                entry.paid = cost;
                unit.level++;
                unit.refreshLevelBadge();
                return true;
            }
            case 'buySellAbility': {
                if (this.ctx.sellState.owned[action.team]) return false; // already unlocked
                if (!economy.spend(action.team, this.ctx.sellSettings.abilityCost)) return false;
                entry.paid = this.ctx.sellSettings.abilityCost;
                this.ctx.sellState.owned[action.team] = true;
                return true;
            }
            case 'sellUnit': {
                const sell = this.ctx.sellState;
                if (!sell.owned[action.team]) return false;
                if (sell.used[action.team] >= this.ctx.sellSettings.maxPerRound) return false;
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || unit.type.structure) return false;
                const refund = Math.round(
                    economy.costOf(unit.type) * this.ctx.sellSettings.refundFactor,
                );
                entry.unit = unit;
                entry.paid = refund;
                placement.removeUnit(unit);
                economy.credit(action.team, refund);
                sell.used[action.team]++;
                return true;
            }
            case 'buyDeploySlot': {
                if (this.ctx.deployState.extra[action.team] >= 1) return false; // once per round
                if (!economy.spend(action.team, this.ctx.deploySettings.extraSlotCost)) return false;
                entry.paid = this.ctx.deploySettings.extraSlotCost;
                this.ctx.deployState.extra[action.team]++;
                return true;
            }
            case 'buyBoost': {
                const state = this.ctx.boostState[action.boost];
                const tier = state[action.team];
                if (tier >= this.ctx.boostSettings.costs.length) return false; // maxed
                const cost = this.ctx.boostSettings.costs[tier]!;
                if (!economy.spend(action.team, cost)) return false;
                entry.paid = cost;
                state[action.team]++;
                return true;
            }
            case 'chooseCard': {
                if (this.ctx.speciality[action.team] !== null) return false; // one card per match
                const card = START_CARDS.find((c) => c.id === action.cardId);
                if (!card) return false;
                this.ctx.speciality[action.team] = card.speciality;
                entry.prevHp = this.ctx.hp.get(action.team);
                this.ctx.hp.set(action.team, card.startingHp);
                // the starting army — free, placed ring-wise from the zone center
                entry.units = [];
                for (const typeId of card.units) {
                    const type = unitTypeById(typeId);
                    if (!type) continue;
                    const anchor = placement.findStartSpot(action.team, type);
                    if (!anchor) continue;
                    const unit = placement.spawn(type, anchor, action.team, false, true);
                    if (!unit) continue;
                    // the starting army counts as a round-1 deployment, so the
                    // player can still arrange it freely in the first round
                    unit.deployedRound = 1;
                    entry.units.push(unit);
                }
                if (card.items) {
                    this.ctx.items[action.team].push(...card.items);
                    entry.grantedItems = [...card.items];
                }
                return true;
            }
            case 'applyItem': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || unit.type.structure) return false;
                if (unit.items.length > 0) return false; // exactly ONE item per pack
                if (!ITEMS[action.itemId]) return false;
                const inventory = this.ctx.items[action.team];
                const held = inventory.indexOf(action.itemId);
                if (held < 0) return false;
                inventory.splice(held, 1);
                unit.items.push(action.itemId);
                return true;
            }
            case 'roundCard': {
                if (this.ctx.roundCardTaken[action.team]) return false; // one per round
                if (action.cardId === null) {
                    // skip: take the consolation supply instead
                    economy.credit(action.team, SKIP_CARD_REWARD);
                    entry.paid = -SKIP_CARD_REWARD;
                    this.ctx.roundCardTaken[action.team] = true;
                    return true;
                }
                const card = ROUND_CARDS.find((c) => c.id === action.cardId);
                if (!card) return false;
                if (!economy.spend(action.team, card.cost)) return false;
                entry.paid = card.cost;
                entry.units = [];
                for (const typeId of card.units ?? []) {
                    const type = unitTypeById(typeId);
                    if (!type) continue;
                    const anchor = placement.findStartSpot(action.team, type);
                    if (!anchor) continue;
                    const unit = placement.spawn(type, anchor, action.team, false, true);
                    if (unit) entry.units.push(unit); // movable: deployedRound = this round
                }
                if (card.items) {
                    this.ctx.items[action.team].push(...card.items);
                    entry.grantedItems = [...card.items];
                }
                this.ctx.roundCardTaken[action.team] = true;
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
                if (!e.unit!.type.extra) this.ctx.deployState.used[action.team]--;
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
            case 'upgradeTower': {
                const unit = placement.unitById(action.unitId)!;
                unit.level--;
                unit.refreshLevelBadge();
                economy.credit(action.team, e.paid!);
                break;
            }
            case 'buySellAbility':
                this.ctx.sellState.owned[action.team] = false;
                economy.credit(action.team, e.paid!);
                break;
            case 'sellUnit':
                placement.restoreUnit(e.unit!);
                economy.spend(action.team, e.paid!); // take the refund back
                this.ctx.sellState.used[action.team]--;
                break;
            case 'buyDeploySlot':
                this.ctx.deployState.extra[action.team]--;
                economy.credit(action.team, e.paid!);
                break;
            case 'buyBoost':
                this.ctx.boostState[action.boost][action.team]--;
                economy.credit(action.team, e.paid!);
                break;
            case 'chooseCard': {
                for (const unit of e.units!) placement.removeUnit(unit);
                const inventory = this.ctx.items[action.team];
                for (const id of e.grantedItems ?? []) {
                    const held = inventory.indexOf(id);
                    if (held >= 0) inventory.splice(held, 1);
                }
                this.ctx.hp.set(action.team, e.prevHp!);
                this.ctx.speciality[action.team] = null;
                break;
            }
            case 'applyItem': {
                const unit = placement.unitById(action.unitId)!;
                const worn = unit.items.lastIndexOf(action.itemId);
                if (worn >= 0) unit.items.splice(worn, 1);
                this.ctx.items[action.team].push(action.itemId);
                break;
            }
            case 'roundCard':
                break; // excluded from undo — the offer can't be re-shown
            case 'endDeployment':
                break; // closes a round — never sits in an undoable tail
        }
    }
}
