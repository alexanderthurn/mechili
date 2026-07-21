import { FLANK_SPAWN_HALF_MULT, ROUND_CARDS, SKIP_CARD_REWARD, START_CARDS, starterUnlockedUnits, unitUnlockCost, type SpecialityId } from './cards';
import {
    ACID_SPILL_RADIUS,
    FIRE_SPILL_RADIUS,
    HAZARD_POUR_DELAY_SEC,
    HAZARD_POUR_DURATION_SEC,
    HazardField,
    OIL_SPILL_DURATION_ROUNDS,
    OIL_SPILL_RADIUS,
    livingShieldDisks,
    type HazardPour,
} from './fire';
import { ITEMS } from './items';
import {
    DRAGON_POUR_DURATION_SEC,
    OIL_SPILL_ID,
    RALLY_ROUTE_ID,
    SELL_UNIT_ID,
    TACTICS,
    clampTacticEnd,
    pointInSafeZone,
    usesSpellPlacement,
    type OilStamp,
    type RallyRoute,
    type SpellStamp,
} from './tactics';
import type { Cell } from './map';
import type { PlacementController } from './placement';
import type {
    BoostSettings,
    DeploySettings,
    Economy,
    LevelingSettings,
    RallyRouteSettings,
    SellSettings,
    TowerSettings,
} from './settings';
import type { TechTree } from './tech';
import { primarySeatOf, type SeatDef, type SeatId } from './seats';
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
    /** target anchor (defaults to the current one) — mirrored boards need it
     *  because rotating a non-square footprint in place shifts its rectangle */
    anchor?: Cell;
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
/** unlocks selling PERMANENTLY (Research Center, once per match) */
export interface BuySellAbilityAction {
    kind: 'buySellAbility';
    team: Team;
}
/** grants one rally-route charge (Research Center, once per match) */
export interface BuyRallyRouteAbilityAction {
    kind: 'buyRallyRouteAbility';
    team: Team;
}
/** sells a pack for its refund — spends an ability charge (per-round) or a
 *  card-granted sell tactic (one-shot) */
export interface SellUnitAction {
    kind: 'sellUnit';
    team: Team;
    unitId: number;
}
/** Command Tower: +1 unit purchase for the RUNNING round only */
export interface BuyDeploySlotAction {
    kind: 'buyDeploySlot';
    team: Team;
}
/** Command Tower: +range for all ranged units this round only */
export interface BuyRoundRangeBoostAction {
    kind: 'buyRoundRangeBoost';
    team: Team;
}
/** Command Tower: +speed for all units this round only */
export interface BuyRoundSpeedBoostAction {
    kind: 'buyRoundSpeedBoost';
    team: Team;
}
/** Command Tower: +supply now, debt collected next deployment (once per round) */
export interface BuyCreditAction {
    kind: 'buyCredit';
    team: Team;
}
/** Research Center: the next tier of a permanent army-wide stat boost */
export interface BuyBoostAction {
    kind: 'buyBoost';
    team: Team;
    boost: 'attack' | 'hp';
}
/**
 * Gift supply to an ally seat (team modes only). Deducted from the sender
 * immediately (like any purchase); credited to the recipient at the START
 * of the NEXT round's build phase — the same moment as normal round income
 * — rather than instantly, so there's no real-time concurrency question at
 * all (by the time it's applied, every client has already converged on this
 * round's full action log).
 */
export interface SendSupplyAction {
    kind: 'sendSupply';
    team: Team;
    toSeat: SeatId;
    amount: number;
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
/** unlock one new shop unit type for this deployment round */
export interface UnlockUnitAction {
    kind: 'unlockUnit';
    team: Team;
    typeId: string;
}
/** places a rally route on the battlefield — consumes one tactic charge */
export interface PlaceRallyRouteAction {
    kind: 'placeRallyRoute';
    team: Team;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
}
/** clears a placed rally route — refunds the tactic charge */
export interface RemoveRallyRouteAction {
    kind: 'removeRallyRoute';
    team: Team;
    routeId: number;
}
/** stamps an oil capsule (two circles + strip) — consumes one Oil Spill charge */
export interface PlaceOilSpillAction {
    kind: 'placeOilSpill';
    team: Team;
    /** quantized world coords (peers must agree exactly) */
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
}
/** undoes one oil stamp (rebuilds the oil layer from remaining stamps) */
export interface RemoveOilSpillAction {
    kind: 'removeOilSpill';
    team: Team;
    stampId: number;
}
/** stamps a battle spell — intent until battle start fires it */
export interface PlaceSpellAction {
    kind: 'placeSpell';
    team: Team;
    tacticId: string;
    /** quantized world coords (peers must agree exactly) */
    x: number;
    z: number;
    /** two-point spells only (acid capsule) */
    endX?: number;
    endZ?: number;
    /** point-yaw spells only (hammer footprint orientation), quantized radians */
    yaw?: number;
}
/** clears a spell stamp placed THIS round (fired stamps are history) */
export interface RemoveSpellAction {
    kind: 'removeSpell';
    team: Team;
    stampId: number;
}

type ActionVariant =
    | BuyAction
    | MoveAction
    | MoveGroupAction
    | RotateAction
    | BuyTechAction
    | BuyLevelAction
    | RecruitLevelAction
    | UpgradeTowerAction
    | BuySellAbilityAction
    | BuyRallyRouteAbilityAction
    | SellUnitAction
    | BuyDeploySlotAction
    | BuyRoundRangeBoostAction
    | BuyRoundSpeedBoostAction
    | BuyCreditAction
    | BuyBoostAction
    | SendSupplyAction
    | ChooseCardAction
    | ApplyItemAction
    | RoundCardAction
    | EndDeploymentAction
    | UnlockUnitAction
    | PlaceRallyRouteAction
    | RemoveRallyRouteAction
    | PlaceOilSpillAction
    | RemoveOilSpillAction
    | PlaceSpellAction
    | RemoveSpellAction;

/**
 * Every action carries its acting SEAT alongside the side (`team`). Omitted
 * seat = the side's primary seat (classic 1v1 wire compatibility — remote
 * 1v1 actions arrive seatless and resolve to the enemy's only seat).
 */
export type Action = ActionVariant & { seat?: SeatId };

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
    grantedTactics?: string[];
    /** the one-shot tactic charge this action consumed, if any (see consumeTacticCharge) */
    usedTactic?: string;
    /** placeRallyRoute: the spawned route */
    rallyRoute?: RallyRoute;
    /** placeOilSpill / removeOilSpill */
    oilStamp?: OilStamp;
    /** placeSpell / removeSpell */
    spellStamp?: SpellStamp;
}

export interface ActionContext {
    placement: PlacementController;
    economy: Economy;
    techTree: TechTree;
    leveling: LevelingSettings;
    towers: TowerSettings;
    sellSettings: SellSettings;
    rallyRouteSettings: RallyRouteSettings;
    deploySettings: DeploySettings;
    boostSettings: BoostSettings;
    /** the match roster — actions resolve their acting seat against it */
    seats: SeatDef[];
    /** per-SEAT recruit level for the running round (reset to 1 each round) */
    recruitLevel: number[];
    /** per-SEAT sell state (own Command Tower): `owned` is permanent, `used` resets each round */
    sellState: { owned: boolean[]; used: number[] };
    /** per-SEAT Research Center: one-time rally-route purchase (permanent flag) */
    rallyRouteOwned: boolean[];
    /**
     * per-team buy limits: `limit` is the permanent baseline (specials may
     * raise it for good), `extra` and `used` reset every round
     */
    /** per-SEAT buy limits (limit permanent; extra/used/extrasSpent reset per round) */
    deployState: {
        limit: number[];
        extra: number[];
        used: number[];
        /** supply spent on board extras this round (own budget, resets per round) */
        extrasSpent: number[];
    };
    /** per-SEAT tier (0 = none) of each permanent army boost (own Command Tower) */
    boostState: Record<'attack' | 'hp', number[]>;
    /** per-SEAT round-only stat boosts from the Research Center (reset each round) */
    roundBoosts: { range: boolean[]; speed: boolean[] };
    /** Command Tower Credit (per SEAT): used this round (reset each deployment) */
    creditUsed: boolean[];
    /** Command Tower Credit (per SEAT): debt still owed at the next deployment start */
    creditDebt: boolean[];
    /** each side's chosen card speciality (null until the pick) */
    speciality: Record<Team, SpecialityId | null>;
    /** per-team multiplier on flank spawn duration (Flanky card → 0.5) */
    flankSpawnMult: Record<Team, number>;
    /**
     * Each SEAT's own unequipped pack items (item ids; duplicates stack) —
     * per-seat, never shared, so two teammates can never race to consume the
     * same instance (unlike tactics below, still a per-side pool).
     */
    items: string[][];
    /** tactical order charges (e.g. rally routes) — not pack items */
    tactics: Record<Team, string[]>;
    /** rally routes placed this deployment round (cleared each round) */
    rallyRoutes: RallyRoute[];
    /** monotonic id source for rally routes */
    rallyRouteIds: { next: number };
    /**
     * Persistent oil grid (shared, both teams). `oilBaseline` is the field at
     * the start of the current build phase; `oilStamps` are this deployment's
     * placements (undo rebuilds baseline + stamps).
     */
    oilField: HazardField;
    oilBaseline: HazardField;
    oilStamps: OilStamp[];
    oilStampIds: { next: number };
    /**
     * Battle-spell stamps, kept FOREVER (not cleared per round): stamps of
     * the running round are pending intent; older ones are the fired history
     * that drives the per-tactic cooldown window.
     */
    spellStamps: SpellStamp[];
    spellStampIds: { next: number };
    /** whether each side already took (or skipped) this round's card */
    roundCardTaken: Record<Team, boolean>;
    /** which sides have locked in this deployment — battle needs BOTH */
    deployReady: Record<Team, boolean>;
    /** per-seat lock-in; a SIDE is deployReady when all its seats are */
    seatReady: boolean[];
    /** whether a seat has already made its one-time starter-card pick */
    starterPicked: boolean[];
    /** per-SEAT unit types currently buyable in the shop (starter + own unlocks) */
    unlockedUnits: string[][];
    /** each SEAT may unlock at most one new unit type per deployment round */
    unlockUsedThisRound: boolean[];
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

/** banked XP needed to buy the next level at a given veterancy */
export function xpThresholdFor(
    type: UnitType,
    level: number,
    economy: Economy,
    leveling: LevelingSettings,
): number {
    return economy.costOf(type) * leveling.xpThresholdFactor * level;
}

/** banked XP a pack needs before its next level can be bought */
export function xpForNextLevel(unit: Unit, economy: Economy, leveling: LevelingSettings): number {
    return xpThresholdFor(unit.type, unit.level, economy, leveling);
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

    /** card picks are final (the overlay is gone — undoing one would leave the
     *  player with no speciality and no way to re-pick) and a lock-in can't be
     *  taken back */
    private static isUndoable(action: Action): boolean {
        return (
            action.kind !== 'roundCard' &&
            action.kind !== 'chooseCard' &&
            action.kind !== 'endDeployment'
        );
    }

    /** true when `seat` has revertible actions in `round` (drives the undo button) */
    canUndo(round: number, seat: SeatId): boolean {
        return this.log.some(
            (e) =>
                e.round === round &&
                this.actorSeat(e.action) === seat &&
                ActionDispatcher.isUndoable(e.action),
        );
    }

    /** reverts and forgets one SEAT's MOST RECENT undoable action of the given round */
    undoLast(round: number, seat: SeatId): boolean {
        for (let i = this.log.length - 1; i >= 0; i--) {
            const e = this.log[i]!;
            if (e.round !== round || this.actorSeat(e.action) !== seat) continue;
            if (!ActionDispatcher.isUndoable(e.action)) continue;
            this.revert(e);
            this.log.splice(i, 1);
            return true;
        }
        return false;
    }

    /**
     * Rounds in which `team` spent a one-shot charge of `tacticId`, `since`
     * or later. Cooldowns are DERIVED from these log records: a use in round
     * R blocks one charge through round R + cooldownRounds. Undo removes the
     * record, replay rebuilds it — availability needs no extra state.
     */
    tacticUseRounds(team: Team, tacticId: string, since: number): number[] {
        return this.log
            .filter(
                (e) =>
                    e.action.team === team && e.usedTactic === tacticId && e.round >= since,
            )
            .map((e) => e.round);
    }

    /** free one-shot charges of `tacticId` in `round`: inventory − cooling uses */
    availableTacticCharges(team: Team, tacticId: string, round: number): number {
        const cooldown = TACTICS[tacticId]?.cooldownRounds ?? 0;
        const inventory = this.ctx.tactics[team].filter((id) => id === tacticId).length;
        const cooling = this.tacticUseRounds(team, tacticId, round - cooldown).length;
        return inventory - cooling;
    }

    /**
     * Spends one one-shot charge of `tacticId` and records it on the log
     * entry — cooldown, undo, replay and the strip's greyed-out entry all
     * derive from that record. Every 'oneShot' tactic action MUST consume
     * its charge through this.
     */
    private consumeTacticCharge(entry: LogEntry, team: Team, tacticId: string): boolean {
        if (this.availableTacticCharges(team, tacticId, entry.round) < 1) return false;
        entry.usedTactic = tacticId;
        return true;
    }

    /** one side's applied actions of a round, in order — the network batch */
    actionsFor(round: number, team: Team): Action[] {
        return this.log
            .filter((e) => e.round === round && e.action.team === team)
            .map((e) => e.action);
    }

    /** between-round card picks for a side (null cardId = skipped), in round order */
    roundCardPicks(team: Team): { round: number; cardId: string | null }[] {
        const out: { round: number; cardId: string | null }[] = [];
        for (const e of this.log) {
            if (e.action.kind !== 'roundCard' || e.action.team !== team) continue;
            out.push({ round: e.round, cardId: e.action.cardId });
        }
        return out;
    }

    /** the acting seat of an action — explicit, or the side's primary seat */
    actorSeat(action: Action): SeatId {
        return action.seat ?? primarySeatOf(this.ctx.seats, action.team);
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
        const seat = this.actorSeat(action);
        switch (action.kind) {
            case 'buy': {
                const type = unitTypeById(action.typeId);
                // structures aren't buyable — except the board extras
                if (!type || (type.structure && !type.extra)) return false;
                if (
                    !type.extra &&
                    !this.ctx.unlockedUnits[seat]!.includes(action.typeId)
                ) {
                    return false;
                }
                // per-round buy limit: permanent baseline + this round's extra
                // slots; board extras instead draw from their own supply budget
                const deploy = this.ctx.deployState;
                if (
                    !type.extra &&
                    deploy.used[seat]! >= deploy.limit[seat]! + deploy.extra[seat]!
                ) {
                    return false;
                }
                if (
                    type.extra &&
                    deploy.extrasSpent[seat]! + economy.costOf(type) >
                        this.ctx.deploySettings.extrasBudgetPerRound
                ) {
                    return false;
                }
                // an active recruit level adds one level's premium on top
                // (the elite specialist pays it too — only the SWITCH is free
                // for them); extras never recruit levels
                const level = type.extra ? 1 : recruitLevel[seat]!;
                const premium = level > 1 ? levelCost(type, economy, leveling) * (level - 1) : 0;
                if (economy.balance(seat) < economy.costOf(type) + premium) return false;
                const unit = placement.placeUnit(action.team, type, action.anchor, action.rotated, seat);
                if (!unit) return false;
                if (level > 1) {
                    economy.spend(seat, premium);
                    unit.level = level;
                    unit.refreshLevelBadge();
                }
                entry.paid = economy.costOf(type) + premium;
                entry.unit = unit;
                if (type.extra) deploy.extrasSpent[seat] = (this.ctx.deployState.extrasSpent[seat] ?? 0) + economy.costOf(type);
                else deploy.used[seat] = (this.ctx.deployState.used[seat] ?? 0) + 1;
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
                entry.from = { ...unit.cell };
                return placement.rotateUnit(unit, action.anchor);
            }
            case 'buyTech': {
                const type = unitTypeById(action.typeId);
                const tech = type?.techs.find((t) => t.id === action.techId);
                if (!type || !tech) return false;
                if (techTree.has(seat, type.id, tech.id)) return false;
                // every owned tech of the type makes the remaining ones pricier
                // — per SEAT now, so this reads only your own count, never a
                // shared one two teammates could race to price differently
                const owned = techTree.ownedFor(seat, type.id).size;
                const cost = economy.techCostOf(tech, owned);
                if (!economy.spend(seat, cost)) return false;
                techTree.add(seat, type.id, tech.id);
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
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                entry.xpBefore = unit.xp;
                unit.xp = Math.max(0, unit.xp - threshold);
                unit.level++;
                unit.refreshLevelBadge();
                return true;
            }
            case 'recruitLevel': {
                if (this.ctx.speciality[action.team] === 'elite') return false; // already permanent
                if (recruitLevel[seat]! > 1) return false; // once per round
                if (!economy.spend(seat, leveling.recruitLevel2Cost)) return false;
                entry.paid = leveling.recruitLevel2Cost;
                recruitLevel[seat] = 2;
                return true;
            }
            case 'upgradeTower': {
                const unit = placement.unitById(action.unitId);
                if (!unit || unit.team !== action.team || !unit.type.structure || unit.type.extra) {
                    return false;
                }
                if (unit.level >= this.ctx.towers.upgrade.maxLevel) return false;
                const cost = towerUpgradeCost(unit.level, this.ctx.towers);
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                unit.level++;
                unit.refreshLevelBadge();
                return true;
            }
            case 'buySellAbility': {
                if (this.ctx.sellState.owned[seat]) return false; // already unlocked
                if (!economy.spend(seat, this.ctx.sellSettings.abilityCost)) return false;
                entry.paid = this.ctx.sellSettings.abilityCost;
                this.ctx.sellState.owned[seat] = true;
                return true;
            }
            case 'buyRallyRouteAbility': {
                if (this.ctx.rallyRouteOwned[seat]) return false; // once per match, per seat
                const cost = this.ctx.rallyRouteSettings.abilityCost;
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                this.ctx.rallyRouteOwned[seat] = true;
                // the resulting CHARGE still lands in the side's shared tactics
                // pool (deliberately not split — see items comment above); a
                // plain push is race-safe regardless of order, unlike the
                // owned-flag check above which is why THAT needed to go per-seat
                this.ctx.tactics[action.team].push(RALLY_ROUTE_ID);
                entry.grantedTactics = [RALLY_ROUTE_ID];
                return true;
            }
            case 'sellUnit': {
                // per-round ability charges first, then one-shot card tactics
                const sell = this.ctx.sellState;
                const abilityCharges = sell.owned[seat] ? this.ctx.sellSettings.maxPerRound : 0;
                const useAbility = sell.used[seat]! < abilityCharges;
                const unit = placement.unitById(action.unitId);
                // own units only — same scoping as applyItem/movability
                if (!unit || unit.team !== action.team || unit.seat !== seat || unit.type.structure) {
                    return false;
                }
                if (useAbility) sell.used[seat]!++;
                else if (!this.consumeTacticCharge(entry, action.team, SELL_UNIT_ID)) {
                    return false;
                }
                const refund = Math.round(
                    economy.costOf(unit.type) * this.ctx.sellSettings.refundFactor,
                );
                entry.unit = unit;
                entry.paid = refund;
                placement.removeUnit(unit);
                economy.credit(seat, refund);
                return true;
            }
            case 'buyDeploySlot': {
                if (this.ctx.deployState.extra[seat]! >= 1) return false; // once per round
                if (!economy.spend(seat, this.ctx.deploySettings.extraSlotCost)) return false;
                entry.paid = this.ctx.deploySettings.extraSlotCost;
                this.ctx.deployState.extra[seat] = (this.ctx.deployState.extra[seat] ?? 0) + 1;
                return true;
            }
            case 'buyRoundRangeBoost': {
                if (this.ctx.roundBoosts.range[seat]) return false;
                const cost = this.ctx.deploySettings.rangedRangeBoostCost;
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                this.ctx.roundBoosts.range[seat] = true;
                return true;
            }
            case 'buyRoundSpeedBoost': {
                if (this.ctx.roundBoosts.speed[seat]) return false;
                const cost = this.ctx.deploySettings.armySpeedBoostCost;
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                this.ctx.roundBoosts.speed[seat] = true;
                return true;
            }
            case 'buyCredit': {
                if (this.ctx.creditUsed[seat]!) return false; // once per round
                const gain = this.ctx.deploySettings.creditGain;
                economy.credit(seat, gain);
                entry.paid = gain; // undo takes the gain back
                this.ctx.creditUsed[seat] = true;
                this.ctx.creditDebt[seat] = true;
                return true;
            }
            case 'buyBoost': {
                const state = this.ctx.boostState[action.boost];
                const tier = state[seat]!;
                if (tier >= this.ctx.boostSettings.costs.length) return false; // maxed
                const cost = this.ctx.boostSettings.costs[tier]!;
                if (!economy.spend(seat, cost)) return false;
                entry.paid = cost;
                state[seat]!++;
                return true;
            }
            case 'sendSupply': {
                // only to an ally seat, never yourself; the recipient is
                // credited later (see game.ts startBuildPhase, which reads
                // this same round's sendSupply actions back out of the log)
                const to = this.ctx.seats[action.toSeat];
                if (!to || to.team !== action.team || action.toSeat === seat) return false;
                if (!Number.isFinite(action.amount) || action.amount <= 0) return false;
                if (!economy.spend(seat, action.amount)) return false;
                entry.paid = action.amount;
                return true;
            }
            case 'chooseCard': {
                // one starter pick per SEAT — in duo modes each commander
                // picks their own opening army, own shop unlocks, own tactic.
                // Only speciality/HP stay a single shared side-wide effect,
                // decided by the side's PRIMARY seat — this MUST be keyed by
                // which seat it is, never by "whichever pick gets processed
                // first": local-vs-relayed arrival order differs per client
                // over a real network (my own pick applies instantly; a
                // teammate's arrives with network latency), so "first" is a
                // different pick on each client — a guaranteed side-wide
                // desync the moment two seats on one side are on different
                // machines.
                if (this.ctx.starterPicked[seat]) return false;
                const card = START_CARDS.find((c) => c.id === action.cardId);
                if (!card) return false;
                this.ctx.starterPicked[seat] = true;
                if (seat === primarySeatOf(this.ctx.seats, action.team)) {
                    this.ctx.speciality[action.team] = card.speciality;
                    if (card.speciality === 'flanky') {
                        this.ctx.flankSpawnMult[action.team] = FLANK_SPAWN_HALF_MULT;
                    }
                    entry.prevHp = this.ctx.hp.get(action.team);
                    this.ctx.hp.set(action.team, card.startingHp);
                }
                // shop unlocks are per-SEAT (your own card decides your own
                // buyable roster — no sharing, per-seat like items), so unlike
                // speciality/HP above this is unconditional, not primary-only
                this.ctx.unlockedUnits[seat] = starterUnlockedUnits(card);
                // items (tactics) are additive per CARD, not an overwrite like
                // speciality/HP/unlocks above — every seat's own pick grants
                // its own items into ITS OWN pool (items are per-seat, never
                // shared — see actions.ts applyItem), primary or not, so a
                // non-primary seat's tactic isn't silently dropped
                if (card.items) {
                    this.ctx.items[seat]!.push(...card.items);
                    entry.grantedItems = [...card.items];
                }
                // the starting army — free, placed ring-wise from THIS SEAT's lane
                entry.units = [];
                for (const typeId of card.units) {
                    const type = unitTypeById(typeId);
                    if (!type) continue;
                    const anchor = placement.findStartSpot(action.team, type, seat);
                    if (!anchor) continue;
                    const unit = placement.spawn(type, anchor, action.team, false, true, seat);
                    if (!unit) continue;
                    // the starting army counts as a round-1 deployment, so the
                    // player can still arrange it freely in the first round
                    unit.deployedRound = 1;
                    entry.units.push(unit);
                }
                return true;
            }
            case 'applyItem': {
                const unit = placement.unitById(action.unitId);
                // items are a per-SEAT pool now (never shared) — a seat may
                // only equip its own items onto its own units, so there's no
                // resource two different clients could both grab at once
                if (!unit || unit.team !== action.team || unit.seat !== seat || unit.type.structure) {
                    return false;
                }
                if (unit.items.length > 0) return false; // exactly ONE item per pack
                if (!ITEMS[action.itemId]) return false;
                const inventory = this.ctx.items[seat]!;
                const held = inventory.indexOf(action.itemId);
                if (held < 0) return false;
                inventory.splice(held, 1);
                unit.items.push(action.itemId);
                return true;
            }
            case 'roundCard': {
                // side-wide resource (v1 scope — cards stay per SIDE, not
                // per seat): only the PRIMARY seat may act on it, same
                // determinism reasoning as chooseCard above — "whoever's
                // pick gets processed first" is a network-order race once
                // two seats share a side across two machines.
                if (seat !== primarySeatOf(this.ctx.seats, action.team)) return false;
                if (this.ctx.roundCardTaken[action.team]) return false; // one per round
                if (action.cardId === null) {
                    // skip: take the consolation supply instead
                    economy.credit(seat, SKIP_CARD_REWARD);
                    entry.paid = -SKIP_CARD_REWARD;
                    this.ctx.roundCardTaken[action.team] = true;
                    return true;
                }
                const card = ROUND_CARDS.find((c) => c.id === action.cardId);
                if (!card) return false;
                if (!economy.spend(seat, card.cost)) return false;
                entry.paid = card.cost;
                entry.units = [];
                for (const typeId of card.units ?? []) {
                    const type = unitTypeById(typeId);
                    if (!type) continue;
                    const anchor = placement.findStartSpot(action.team, type, seat);
                    if (!anchor) continue;
                    const unit = placement.spawn(type, anchor, action.team, false, true, seat);
                    if (unit) entry.units.push(unit); // movable: deployedRound = this round
                }
                if (card.items) {
                    // round cards are primary-seat-only (gated above), so
                    // `seat` is always the primary here — same pool either way
                    this.ctx.items[seat]!.push(...card.items);
                    entry.grantedItems = [...card.items];
                }
                if (card.tactics) {
                    this.ctx.tactics[action.team].push(...card.tactics);
                    entry.grantedTactics = [...card.tactics];
                }
                if (card.flankSpawnHalf) {
                    this.ctx.flankSpawnMult[action.team] = FLANK_SPAWN_HALF_MULT;
                }
                this.ctx.roundCardTaken[action.team] = true;
                return true;
            }
            case 'endDeployment': {
                if (this.ctx.seatReady[seat]) return false; // this seat already locked in
                this.ctx.seatReady[seat] = true;
                // the side locks when its last seat does
                const sideReady = this.ctx.seats.every(
                    (def, i) => def.team !== action.team || this.ctx.seatReady[i],
                );
                if (!sideReady) return true;
                if (this.ctx.deployReady[action.team]) return false;
                this.ctx.deployReady[action.team] = true;
                this.ctx.onEndDeployment(action.team);
                return true;
            }
            case 'unlockUnit': {
                if (this.ctx.unlockUsedThisRound[seat]) return false;
                if (this.ctx.unlockedUnits[seat]!.includes(action.typeId)) return false;
                const cost = unitUnlockCost(action.typeId);
                if (!Number.isFinite(cost)) return false;
                if (cost > 0 && !economy.spend(seat, cost)) return false;
                this.ctx.unlockedUnits[seat]!.push(action.typeId);
                this.ctx.unlockUsedThisRound[seat] = true;
                entry.paid = cost;
                return true;
            }
            case 'placeRallyRoute': {
                if (!TACTICS[RALLY_ROUTE_ID]) return false;
                const max =
                    this.ctx.tactics[action.team].filter((id) => id === RALLY_ROUTE_ID).length;
                const placed = this.ctx.rallyRoutes.filter((r) => r.team === action.team).length;
                if (max < 1 || placed >= max) return false;
                const end = clampTacticEnd(
                    action.startX,
                    action.startZ,
                    action.endX,
                    action.endZ,
                );
                const route: RallyRoute = {
                    id: this.ctx.rallyRouteIds.next++,
                    team: action.team,
                    startX: action.startX,
                    startZ: action.startZ,
                    endX: end.x,
                    endZ: end.z,
                };
                this.ctx.rallyRoutes.push(route);
                entry.rallyRoute = route;
                return true;
            }
            case 'removeRallyRoute': {
                const i = this.ctx.rallyRoutes.findIndex(
                    (r) => r.id === action.routeId && r.team === action.team,
                );
                if (i < 0) return false;
                entry.rallyRoute = this.ctx.rallyRoutes[i];
                this.ctx.rallyRoutes.splice(i, 1);
                return true;
            }
            case 'placeOilSpill': {
                if (!TACTICS[OIL_SPILL_ID]) return false;
                const max =
                    this.ctx.tactics[action.team].filter((id) => id === OIL_SPILL_ID).length;
                const placed = this.ctx.oilStamps.filter((s) => s.team === action.team).length;
                if (max < 1 || placed >= max) return false;
                const { round } = this.ctx.clock();
                const duration =
                    TACTICS[OIL_SPILL_ID]!.oilDurationRounds ?? OIL_SPILL_DURATION_ROUNDS;
                const radius = TACTICS[OIL_SPILL_ID]!.oilRadius ?? OIL_SPILL_RADIUS;
                const end = clampTacticEnd(
                    action.startX,
                    action.startZ,
                    action.endX,
                    action.endZ,
                );
                const stamp: OilStamp = {
                    id: this.ctx.oilStampIds.next++,
                    team: action.team,
                    startX: action.startX,
                    startZ: action.startZ,
                    endX: end.x,
                    endZ: end.z,
                    radius,
                    placedRound: round,
                    expiresRound: round + duration - 1,
                };
                this.ctx.oilStamps.push(stamp);
                entry.oilStamp = stamp;
                // stamps are intent-only until battle start — keep field on baseline
                resetOilFieldToBaseline(this.ctx);
                return true;
            }
            case 'removeOilSpill': {
                const i = this.ctx.oilStamps.findIndex(
                    (s) => s.id === action.stampId && s.team === action.team,
                );
                if (i < 0) return false;
                entry.oilStamp = this.ctx.oilStamps[i];
                this.ctx.oilStamps.splice(i, 1);
                resetOilFieldToBaseline(this.ctx);
                return true;
            }
            case 'placeSpell': {
                const tactic = TACTICS[action.tacticId];
                if (!tactic || !usesSpellPlacement(tactic)) return false;
                if (
                    tactic.targeting !== 'point' &&
                    tactic.targeting !== 'two-point' &&
                    tactic.targeting !== 'point-yaw'
                ) {
                    return false;
                }
                if (tactic.targeting === 'two-point' &&
                    (action.endX === undefined || action.endZ === undefined)) {
                    return false;
                }
                if (tactic.targeting === 'point-yaw' && action.yaw === undefined) {
                    return false;
                }
                const { round } = this.ctx.clock();
                // charges: inventory minus stamps still pending or cooling down
                const inventory = this.ctx.tactics[action.team].filter(
                    (id) => id === action.tacticId,
                ).length;
                const blocking = this.ctx.spellStamps.filter(
                    (s) =>
                        s.team === action.team &&
                        s.tacticId === action.tacticId &&
                        s.placedRound >= round - tactic.cooldownRounds,
                ).length;
                if (blocking >= inventory) return false;
                // safe zone binds here, not only in the aiming UI
                if (
                    tactic.respectsSafeZone &&
                    pointInSafeZone(
                        this.ctx.placement.allUnits(),
                        action.team,
                        action.x,
                        action.z,
                        tactic.radius ?? 0,
                    )
                ) {
                    return false;
                }
                // capsule end pulled toward start so peers agree on the span
                const end =
                    action.endX !== undefined && action.endZ !== undefined
                        ? clampTacticEnd(
                              action.x,
                              action.z,
                              action.endX,
                              action.endZ,
                              tactic.maxSpan,
                          )
                        : null;
                const stamp: SpellStamp = {
                    id: this.ctx.spellStampIds.next++,
                    tacticId: action.tacticId,
                    team: action.team,
                    x: action.x,
                    z: action.z,
                    ...(end ? { endX: end.x, endZ: end.z } : {}),
                    ...(action.yaw !== undefined ? { yaw: action.yaw } : {}),
                    placedRound: round,
                };
                this.ctx.spellStamps.push(stamp);
                entry.spellStamp = stamp;
                return true;
            }
            case 'removeSpell': {
                const { round } = this.ctx.clock();
                const i = this.ctx.spellStamps.findIndex(
                    (s) =>
                        s.id === action.stampId &&
                        s.team === action.team &&
                        s.placedRound === round, // fired stamps are history
                );
                if (i < 0) return false;
                entry.spellStamp = this.ctx.spellStamps[i];
                this.ctx.spellStamps.splice(i, 1);
                return true;
            }
        }
    }

    /** exact inverse of apply — safe because a round's reverts run newest-first */
    private revert(e: LogEntry): void {
        const { placement, economy, techTree } = this.ctx;
        const action = e.action;
        const seat = this.actorSeat(action);
        switch (action.kind) {
            case 'buy':
                placement.removeUnit(e.unit!);
                economy.credit(seat, e.paid!);
                if (e.unit!.type.extra) {
                    this.ctx.deployState.extrasSpent[seat] = (this.ctx.deployState.extrasSpent[seat] ?? 0) - e.paid!;
                } else {
                    this.ctx.deployState.used[seat] = (this.ctx.deployState.used[seat] ?? 0) - 1;
                }
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
                placement.rotateUnit(placement.unitById(action.unitId)!, e.from);
                break;
            case 'buyTech':
                techTree.remove(seat, action.typeId, action.techId);
                economy.credit(seat, e.paid!);
                break;
            case 'buyLevel': {
                const unit = placement.unitById(action.unitId)!;
                unit.level--;
                unit.xp = e.xpBefore!;
                unit.refreshLevelBadge();
                economy.credit(seat, e.paid!);
                break;
            }
            case 'recruitLevel':
                this.ctx.recruitLevel[seat] = 1;
                economy.credit(seat, e.paid!);
                break;
            case 'upgradeTower': {
                const unit = placement.unitById(action.unitId)!;
                unit.level--;
                unit.refreshLevelBadge();
                economy.credit(seat, e.paid!);
                break;
            }
            case 'buySellAbility':
                this.ctx.sellState.owned[seat] = false;
                economy.credit(seat, e.paid!);
                break;
            case 'buyRallyRouteAbility': {
                this.ctx.rallyRouteOwned[seat] = false;
                for (const id of e.grantedTactics ?? []) {
                    const i = this.ctx.tactics[action.team].lastIndexOf(id);
                    if (i >= 0) this.ctx.tactics[action.team].splice(i, 1);
                }
                // drop excess placed routes if the charge was already used
                const max = this.ctx.tactics[action.team].filter((id) => id === RALLY_ROUTE_ID)
                    .length;
                for (let i = this.ctx.rallyRoutes.length - 1; i >= 0; i--) {
                    const route = this.ctx.rallyRoutes[i]!;
                    if (route.team !== action.team) continue;
                    const placed = this.ctx.rallyRoutes.filter((r) => r.team === action.team).length;
                    if (placed <= max) break;
                    this.ctx.rallyRoutes.splice(i, 1);
                }
                economy.credit(seat, e.paid!);
                break;
            }
            case 'sellUnit':
                placement.restoreUnit(e.unit!);
                economy.spend(seat, e.paid!); // take the refund back
                // a spent one-shot charge frees up when undoLast drops the log
                // entry (its use record IS the log entry) — only the per-round
                // ability counter needs rolling back by hand
                if (e.usedTactic === undefined) this.ctx.sellState.used[seat]!--;
                break;
            case 'buyDeploySlot':
                this.ctx.deployState.extra[seat] = (this.ctx.deployState.extra[seat] ?? 0) - 1;
                economy.credit(seat, e.paid!);
                break;
            case 'buyRoundRangeBoost':
                this.ctx.roundBoosts.range[seat] = false;
                economy.credit(seat, e.paid!);
                break;
            case 'buyRoundSpeedBoost':
                this.ctx.roundBoosts.speed[seat] = false;
                economy.credit(seat, e.paid!);
                break;
            case 'buyCredit':
                this.ctx.creditUsed[seat] = false;
                this.ctx.creditDebt[seat] = false;
                economy.spend(seat, e.paid!); // take the gain back
                break;
            case 'buyBoost':
                this.ctx.boostState[action.boost][seat]!--;
                economy.credit(seat, e.paid!);
                break;
            case 'sendSupply':
                // just refunds the sender — the log entry itself IS the
                // pending delivery record, so removing it (undoLast already
                // dropped it before calling revert) is the whole cancellation
                economy.credit(seat, e.paid!);
                break;
            case 'applyItem': {
                const unit = placement.unitById(action.unitId)!;
                const worn = unit.items.lastIndexOf(action.itemId);
                if (worn >= 0) unit.items.splice(worn, 1);
                this.ctx.items[seat]!.push(action.itemId); // seat = actorSeat(action), its own pool
                break;
            }
            case 'placeRallyRoute': {
                const route = e.rallyRoute!;
                const i = this.ctx.rallyRoutes.findIndex((r) => r.id === route.id);
                if (i >= 0) this.ctx.rallyRoutes.splice(i, 1);
                break;
            }
            case 'removeRallyRoute': {
                this.ctx.rallyRoutes.push(e.rallyRoute!);
                break;
            }
            case 'placeOilSpill': {
                const stamp = e.oilStamp!;
                const i = this.ctx.oilStamps.findIndex((s) => s.id === stamp.id);
                if (i >= 0) this.ctx.oilStamps.splice(i, 1);
                resetOilFieldToBaseline(this.ctx);
                break;
            }
            case 'removeOilSpill': {
                this.ctx.oilStamps.push(e.oilStamp!);
                resetOilFieldToBaseline(this.ctx);
                break;
            }
            case 'placeSpell': {
                const stamp = e.spellStamp!;
                const i = this.ctx.spellStamps.findIndex((s) => s.id === stamp.id);
                if (i >= 0) this.ctx.spellStamps.splice(i, 1);
                break;
            }
            case 'removeSpell': {
                this.ctx.spellStamps.push(e.spellStamp!);
                break;
            }
            case 'chooseCard':
            case 'roundCard':
            case 'endDeployment':
                break; // excluded from undo (see isUndoable)
            case 'unlockUnit': {
                const list = this.ctx.unlockedUnits[seat]!;
                const i = list.lastIndexOf(action.typeId);
                if (i >= 0) list.splice(i, 1);
                this.ctx.unlockUsedThisRound[seat] = false;
                if (e.paid) economy.credit(seat, e.paid);
                break;
            }
        }
    }
}

/**
 * Build-phase oil field = baseline only. This round's stamps are intent until
 * {@link prepareHazardPours} at battle start (drips land mid-battle; ward
 * discs stay clear). Also resets acid to baseline — shared HazardField.
 */
export function resetOilFieldToBaseline(
    ctx: Pick<ActionContext, 'oilField' | 'oilBaseline'>,
): void {
    ctx.oilField.oilExpires.set(ctx.oilBaseline.oilExpires);
    ctx.oilField.acidExpires.set(ctx.oilBaseline.acidExpires);
    ctx.oilField.clearFire();
}

/**
 * Reset the hazard field to the cross-round baseline, punch living ward
 * discs out of carry-over oil/acid, and return pour schedules for the sim
 * (left→right drips). Does NOT stamp the new capsules yet.
 */
export function prepareHazardPours(
    ctx: Pick<
        ActionContext,
        'oilStamps' | 'spellStamps' | 'oilField' | 'oilBaseline' | 'placement'
    >,
    round: number,
): HazardPour[] {
    resetOilFieldToBaseline(ctx);
    const shields = livingShieldDisks(ctx.placement.allUnits());
    ctx.oilField.clearOilInsideShields(shields);
    ctx.oilField.clearAcidInsideShields(shields);

    const pours: HazardPour[] = [];
    const oils = [...ctx.oilStamps].sort((a, b) => a.id - b.id);
    for (const s of oils) {
        pours.push({
            kind: 'oil',
            x: s.startX,
            z: s.startZ,
            x2: s.endX,
            z2: s.endZ,
            radius: s.radius,
            delaySeconds: HAZARD_POUR_DELAY_SEC,
            durationSeconds: HAZARD_POUR_DURATION_SEC,
            expiresRound: s.expiresRound,
        });
    }
    const acids = ctx.spellStamps
        .filter((s) => s.placedRound === round && TACTICS[s.tacticId]?.acidCapsule)
        .sort((a, b) => a.id - b.id);
    for (const s of acids) {
        const tactic = TACTICS[s.tacticId]!;
        const radius = tactic.radius ?? ACID_SPILL_RADIUS;
        const durationRounds = tactic.acidCapsule!.durationRounds;
        pours.push({
            kind: 'acid',
            x: s.x,
            z: s.z,
            x2: s.endX ?? s.x,
            z2: s.endZ ?? s.z,
            radius,
            delaySeconds: HAZARD_POUR_DELAY_SEC,
            durationSeconds: HAZARD_POUR_DURATION_SEC,
            expiresRound: round + durationRounds - 1,
        });
    }
    const fires = ctx.spellStamps
        .filter((s) => s.placedRound === round && TACTICS[s.tacticId]?.fireCapsule)
        .sort((a, b) => a.id - b.id);
    for (const s of fires) {
        const tactic = TACTICS[s.tacticId]!;
        const radius = tactic.radius ?? FIRE_SPILL_RADIUS;
        const fire = tactic.fireCapsule!;
        pours.push({
            kind: 'fire',
            x: s.x,
            z: s.z,
            x2: s.endX ?? s.x,
            z2: s.endZ ?? s.z,
            radius,
            delaySeconds: HAZARD_POUR_DELAY_SEC,
            durationSeconds: HAZARD_POUR_DURATION_SEC,
            expiresRound: 0,
            burnSeconds: fire.burnSeconds,
            intensity: fire.intensity,
        });
    }
    // dragon breath: same progressive fire paint, timed to the spell delay (no air-drip lag)
    const dragons = ctx.spellStamps
        .filter(
            (s) =>
                s.placedRound === round &&
                TACTICS[s.tacticId]?.spell?.igniteCapsule &&
                s.endX !== undefined &&
                s.endZ !== undefined,
        )
        .sort((a, b) => a.id - b.id);
    for (const s of dragons) {
        const tactic = TACTICS[s.tacticId]!;
        const spell = tactic.spell!;
        const ignite = spell.igniteCapsule!;
        pours.push({
            kind: 'fire',
            x: s.x,
            z: s.z,
            x2: s.endX!,
            z2: s.endZ!,
            radius: tactic.radius ?? FIRE_SPILL_RADIUS,
            delaySeconds: spell.delaySeconds,
            durationSeconds: DRAGON_POUR_DURATION_SEC,
            expiresRound: 0,
            burnSeconds: ignite.burnSeconds,
            intensity: ignite.intensity,
            damage: ignite.damage,
            fallSeconds: 0,
        });
    }
    return pours;
}

/** quantize world coords so peers never disagree on float noise */
export function quantizeWorld(v: number): number {
    return Math.round(v * 20) / 20;
}

/** quantize yaw (radians) to ~0.5° steps for lockstep agreement */
export function quantizeYaw(rad: number): number {
    return Math.round(rad * (180 / Math.PI) * 2) / 2 * (Math.PI / 180);
}
