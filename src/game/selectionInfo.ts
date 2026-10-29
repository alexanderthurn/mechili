/**
 * The unit details pane: what Game hands the HUD for a selected pack, building
 * or battle unit (SelectionInfo) — stats with levels and techs, items, the
 * Research Center / Command Tower / Stronghold offers, and the fogged view of
 * an enemy's while his deployment is hidden. Reads the match only, never
 * changes it.
 */

import { itemDescription, itemName, t, tacticDescription, tacticName, techName, unitName } from '../i18n';
import type { Phase, SelectionInfo } from '../ui/hud';
import { buildingMaxLevel, buildingUpgradeFor, garrisonSeatManned, garrisonSeatSlots } from './actions';
import type { TypeRegistry } from './content/typeRegistry';
import { type ForgeSlot, forgeHintText, forgeIngredientIcons, forgeProductInfo, forgeRecipesCraftableFromBag, resolveForge } from './forgeRecipes';
import { itemSlotLimit } from './items';
import { loadoutShowsAll } from './loadouts';
import type { MatchRules } from './matchRules';
import type { PlacementController } from './placement';
import { type SeatDef, type SeatId, seatIdsOf } from './seats';
import { isSiege, rallyRouteBuyMax, type Economy, type GameSettings } from './settings';
import { actorSeat, actorTeam, type Actor, type BattleSim } from './sim';
import { TechTree, effectiveTargets, type ResolvedStats } from './tech';
import { type Loadout, allowedTechIds, techSlotLimit, techsForUnit } from './techCatalog';
import type { TutorialRuntime } from './tutorialRuntime';
import { type BattleTeam, type BuildingAbilityId, type Team, type Unit, type UnitType, hasAbility, isTargetMarked, techDescription, techIcon } from './units';

/** deploy-intel capture of Research Center / Command Tower / Stronghold seat state */
export interface BuildingIntelSnapshot {
    recruitLevel: number[];
    deployExtra: number[];
    rangeBoost: boolean[];
    speedBoost: boolean[];
    creditUsed: boolean[];
    boostAttack: number[];
    boostHp: number[];
    sellOwned: boolean[];
    rallyBought: number[];
    movePackOwned: boolean[];
    /** Stronghold commander spells bought (per seat) at phase start — fogged view */
    forgeSpellOwned: string[][];
    /** archers posted on each side's battlements at phase start — fogged view */
    strongholdArchers: Record<Team, number>;
    /** Stronghold oven contents (item ids) at phase start — fogged view */
    forge: Record<Team, (string | null)[]>;
    /** whether each oven was paid for at phase start — fogged view, and the
     *  reason the chimney and the panel cannot leak a live burn */
    forgeLit: Record<Team, boolean>;
}

export interface BuildingIntelSeat {
    recruitLevel: number;
    deployExtra: number;
    rangeBoost: boolean;
    speedBoost: boolean;
    creditUsed: boolean;
    boostAttack: number;
    boostHp: number;
    sellOwned: boolean;
    rallyBought: number;
    movePackOwned: boolean;
}

/** what the details pane reads of the match — Game hands it out with live getters */
export interface SelectionInfoHost {
    readonly phase: Phase;
    readonly round: number;
    readonly sim: BattleSim | null;
    readonly placement: PlacementController;
    readonly types: TypeRegistry;
    readonly settings: GameSettings;
    readonly rules: MatchRules;
    readonly seats: readonly SeatDef[];
    readonly humanSeat: SeatId;
    readonly economy: Economy;
    readonly techTree: TechTree;
    readonly tutorial: TutorialRuntime | null;
    readonly editorMode: 'author' | 'test' | null;
    readonly playerCanAct: boolean;
    readonly armedItem: string | null;
    readonly itemInventory: readonly (readonly string[])[];
    readonly forgeSlots: Record<Team, (ForgeSlot | null)[]>;
    readonly forgeSpellOwned: readonly (readonly string[])[];
    /** the deploy-intel capture shown while the enemy's deployment is fogged */
    readonly buildingIntelSnapshot: BuildingIntelSnapshot | null;
    resolvedStats(unit: Unit): ResolvedStats;
    /** {@link resolvedStats}, or the fogged view of an enemy pack */
    resolvedStatsView(unit: Unit): ResolvedStats;
    levelInfo(u: Unit): { level: number; xp: number; xpNext: number; statMult: number };
    levelScaleOf(unit: Unit, kind: 'damage' | 'range', level?: number, innateOnly?: boolean): number;
    levelUpInfo(u: Unit, lv: { xp: number; xpNext: number }): SelectionInfo['levelUp'];
    intelTechOwned(u: Unit): ReadonlySet<string>;
    intelBuildingSeat(u: Unit, seat?: SeatId): BuildingIntelSeat;
    ownerName(team: BattleTeam, seat?: SeatId): string;
    unitHasTech(seat: SeatId, typeId: string, techId: string): boolean;
    loadoutOf(seat: SeatId): Loadout | undefined;
    canDropArmedItemOn(unit: Unit): boolean;
    canDropForgeOn(unit: Unit): boolean;
    forgeSpellsOf(seat: SeatId): readonly string[] | undefined;
    teamForgePool(team: Team): string[];
    yearAttackerTeam(): Team;
}

export class SelectionInfoBuilder {
    constructor(private readonly host: SelectionInfoHost) {}

    actorInfo(a: Actor): SelectionInfo {
        const u = a.unit;
        const empDisabled = !!this.host.sim && a.empUntil > this.host.sim.elapsed + 1e-9;
        const rs = empDisabled
            ? TechTree.statsWithOwned(u.type, new Set(u.type.innateTechs ?? []), this.host.types)
            : this.host.resolvedStats(u);
        const lv = this.host.levelInfo(u);
        const team = actorTeam(a);
        const seat = actorSeat(a);
        const hasTech = (s: SeatId, typeId: string, techId: string) => {
            if (u.type.innateTechs?.includes(techId)) return true;
            if (empDisabled) return false;
            return this.host.techTree.has(s, typeId, techId);
        };
        return {
            name: unitName(u.type.id, u.type.name),
            team,
            owner: this.host.ownerName(team, seat),
            hits: targetsLabel(effectiveTargets(u.type, seat, hasTech, this.host.types)),
            strengths: strengthsLabel(u.type),
            hp: a.hp,
            maxHp: a.maxHp,
            damage: rs.damage * lv.statMult * this.host.levelScaleOf(u, 'damage', lv.level, empDisabled),
            range: Math.round(rs.range * this.host.levelScaleOf(u, 'range', lv.level, empDisabled)),
            minRange: rs.minRange > 0 ? Math.round(rs.minRange) : undefined,
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: rs.splashRadius || undefined,
            structure: !!u.type.structure,
            onDestroyed: this.destructionNote(u),
            unitId: u.id,
            items: this.selectionItems(u, false),
            itemSlotCount:
                u.type.structure || u.type.extra ? 0 : itemSlotLimit(u.type),
            itemDropReady: !u.type.structure && this.host.canDropArmedItemOn(u),
            record: u.type.structure
                ? undefined
                : { damageDealt: u.damageDealt, kills: u.kills },
            alive: 1,
            total: 1,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            techs: this.techSelection(u, empDisabled),
            ...this.researchCenterSelection(u),
            ...this.commandTowerSelection(u),
            ...this.strongholdSelection(u),
        };
    }

    unitInfo(u: Unit): SelectionInfo {
        const rs = this.host.resolvedStatsView(u);
        const lv = this.host.levelInfo(u);
        const fogItems = this.host.placement.intelOf(u)?.items;
        const ownInteractive = u.team === 'player' && this.host.playerCanAct;
        return {
            name: unitName(u.type.id, u.type.name),
            team: u.team,
            owner: this.host.ownerName(u.team, u.seat),
            strengths: strengthsLabel(u.type),
            hits: targetsLabel(
                effectiveTargets(
                    u.type,
                    u.seat,
                    (s, typeId, techId) => this.host.techTree.has(s, typeId, techId),
                    this.host.types,
                ),
            ),
            hp: rs.hp * lv.statMult,
            maxHp: rs.hp * lv.statMult,
            damage: rs.damage * lv.statMult * this.host.levelScaleOf(u, 'damage', lv.level),
            range: Math.round(rs.range * this.host.levelScaleOf(u, 'range', lv.level)),
            minRange: rs.minRange > 0 ? Math.round(rs.minRange) : undefined,
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: rs.splashRadius || undefined,
            alive: u.members.length,
            total: u.members.length,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            structure: !!u.type.structure,
            onDestroyed: this.destructionNote(u),
            unitId: u.id,
            items: this.selectionItems(u, ownInteractive && !fogItems, fogItems),
            itemSlotCount:
                u.type.structure || u.type.extra ? 0 : itemSlotLimit(u.type),
            itemDropReady: !u.type.structure && this.host.canDropArmedItemOn(u),
            record: u.type.structure ? undefined : { damageDealt: u.damageDealt, kills: u.kills },
            // base buildings level for supply alone, on a rising price ladder
            towerUpgrade: (() => {
                if (!ownInteractive || !u.type.structure || (u.type.extra && !u.type.wall) || this.host.tutorial?.boostLessonOnly) return undefined;
                if (this.host.tutorial?.allowedGarrisonOffers()?.upgrade === false) return undefined;
                const up = buildingUpgradeFor(u, this.host.humanSeat, this.host.settings.towers);
                if (!up) return undefined; // an ally's own tower
                return {
                    cost: up.cost,
                    affordable: this.host.economy.balance(this.host.humanSeat) >= up.cost,
                    maxed: up.maxed,
                    maxLevel: buildingMaxLevel(u, this.host.seats, this.host.settings.towers),
                };
            })(),
            // experiment: a wall's walkway (no tile when it comes with the wall)
            wallWalk:
                ownInteractive && u.type.wall && !u.type.wall.autoWalk
                    ? {
                          cost: u.type.wall.walkCost ?? 20,
                          affordable: this.host.economy.balance(this.host.humanSeat) >= (u.type.wall.walkCost ?? 20),
                          built: u.wallWalk,
                      }
                    : undefined,
            wallPosts: (() => {
                const posts = u.type.wall?.posts;
                if (!ownInteractive || !posts || !u.wallWalk) return undefined;
                const owned = this.host.placement.allUnits().filter((p) => p.hostUnitId === u.id).length;
                return {
                    cost: posts.cost,
                    owned,
                    max: posts.count,
                    affordable: this.host.economy.balance(this.host.humanSeat) >= posts.cost,
                };
            })(),
            // a wall of mine: turn it into a gate (one way)
            makeGate:
                ownInteractive && u.type.wall?.makeGate
                    ? {
                          typeId: u.type.wall.makeGate.typeId,
                          cost: u.type.wall.makeGate.cost,
                          affordable: this.host.economy.balance(this.host.humanSeat) >= u.type.wall.makeGate.cost,
                          archers: this.host.placement.hasPosts(u),
                      }
                    : undefined,
            // an enemy wall: my Target switch, while I deploy
            targetMark:
                u.type.wall && u.team === 'enemy' && this.host.phase === 'build' && this.host.playerCanAct
                    ? { on: isTargetMarked(u, this.host.humanSeat) }
                    : undefined,
            // the next level is a purchase: needs banked XP and supply
            levelUp: this.host.levelUpInfo(u, lv),
            techs: this.techSelection(u),
            ...this.researchCenterSelection(u),
            ...this.commandTowerSelection(u),
            ...this.strongholdSelection(u),
        };
    }

    /** pack detail rune squares — removable only for this-deploy applications on own packs */
    private selectionItems(
        u: Unit,
        allowRemove: boolean,
        fogItems?: readonly string[],
    ): SelectionInfo['items'] {
        const itemIds = fogItems ?? u.items;
        if (!itemIds.length) return undefined;
        return itemIds.map((id, i) => ({
            id,
            icon: this.host.types.rune(id)?.icon ?? '?',
            name: itemName(id, this.host.types.rune(id)?.name ?? id),
            desc: itemDescription(id, this.host.types.rune(id)?.description ?? '', this.host.types.rune(id)?.mods),
            removable:
                allowRemove &&
                u.seat === this.host.humanSeat &&
                !u.type.structure &&
                u.itemAppliedRound[i] === this.host.round,
        }));
    }

    /** pack tech slots — always that unit's {@link techSlotLimit}; empty pads unused picks.
     *  Horde / innate packs list owned techs (e.g. Mother of Spiders) with live produce %.
     *  `hexDisableResearched`: battle EMP — every talent slot shows as inactive. */
    private techSelection(u: Unit, hexDisableResearched = false): SelectionInfo['techs'] {
        if (u.type.structure || u.type.extra) return undefined;
        const markDisabled = (_id: string, _owned: boolean) => hexDisableResearched;
        const isHorde = u.team === 'horde' || u.seat < 0;
        if (isHorde) {
            const ids = new Set<string>([...(u.type.innateTechs ?? []), ...allowedTechIds(u.type)]);
            const slots: NonNullable<SelectionInfo['techs']> = [];
            for (const id of ids) {
                if (!this.host.unitHasTech(u.seat, u.type.id, id)) continue;
                const t = this.host.types.talent(id);
                if (!t) continue;
                slots.push({
                    id: t.id,
                    name: techName(t.id, t.name),
                    desc: techDescription(t),
                    icon: techIcon(t),
                    cost: 0,
                    owned: true,
                    affordable: false,
                    produce: this.produceProgressInfo(u, t.id),
                    disabled: markDisabled(t.id, true) || undefined,
                });
            }
            return slots.length ? slots : undefined;
        }
        const canBuy = u.seat === this.host.humanSeat && this.host.playerCanAct;
        const selected = techsForUnit(u.type, this.host.types, this.host.loadoutOf(u.seat));
        // the editor's sandbox shows every talent the type has, not only the slot count
        const slotsN =
            (this.host.editorMode === 'author' || loadoutShowsAll(this.host.rules.loadout)) && u.seat === this.host.humanSeat
                ? Math.max(techSlotLimit(u.type), selected.length)
                : techSlotLimit(u.type);
        const owned = this.host.intelTechOwned(u);
        const ownedCount = owned.size;
        const bal = this.host.economy.balance(u.seat);
        const slots: NonNullable<SelectionInfo['techs']> = [];
        // A lesson can narrow this pack's talent list to a single entry.
        const soleTechId = this.host.tutorial?.soleTechFor(u) ?? null;
        if (soleTechId) {
            const only = this.host.types.talent(soleTechId);
            if (!only) return undefined;
            const isOwned = owned.has(only.id) || !!u.type.innateTechs?.includes(only.id);
            const cost = this.host.economy.techCostOf(only, ownedCount);
            return [
                {
                    id: only.id,
                    name: techName(only.id, only.name),
                    desc: techDescription(only),
                    icon: techIcon(only),
                    cost,
                    owned: isOwned,
                    affordable: canBuy && !isOwned && bal >= cost,
                    produce: isOwned ? this.produceProgressInfo(u, only.id) : undefined,
                    disabled: markDisabled(only.id, isOwned) || undefined,
                },
            ];
        }
        for (let i = 0; i < slotsN; i++) {
            const t = selected[i];
            if (!t) {
                slots.push({ empty: true });
                continue;
            }
            const isOwned = owned.has(t.id) || !!u.type.innateTechs?.includes(t.id);
            const cost = this.host.economy.techCostOf(t, ownedCount);
            slots.push({
                id: t.id,
                name: techName(t.id, t.name),
                desc: techDescription(t),
                icon: techIcon(t),
                cost,
                owned: isOwned,
                affordable: canBuy && !isOwned && bal >= cost,
                produce: isOwned ? this.produceProgressInfo(u, t.id) : undefined,
                disabled: markDisabled(t.id, isOwned) || undefined,
            });
        }
        return slots;
    }

    /** Live produce-tech ring data while a battle sim is running. */
    private produceProgressInfo(
        u: Unit,
        techId: string,
    ): NonNullable<Exclude<NonNullable<SelectionInfo['techs']>[number], { empty: true }>>['produce'] {
        if (!this.host.sim) return undefined;
        const p = this.host.sim.productionProgress(u, techId);
        return p ?? undefined;
    }

    /**
     * Research Center tiles — always listed when that building is selected
     * (deploy + battle). Active flags use deploy intel while fogged.
     */
    private researchCenterSelection(u: Unit): Pick<
        SelectionInfo,
        'recruit' | 'deploySlot' | 'rangeBoost' | 'speedBoost' | 'credit'
    > {
        const has = (a: BuildingAbilityId) => hasAbility(u.type, a);
        const offers = (['recruitLevel', 'deploySlot', 'rangeBoost', 'speedBoost', 'credit'] as const).some(has);
        if (!offers || this.host.tutorial?.boostLessonOnly) return {};
        const seat = this.panelSeatOf(u);
        const canBuy = seat === this.host.humanSeat && this.host.playerCanAct;
        const bal = this.host.economy.balance(seat);
        const intel = this.host.intelBuildingSeat(u, seat);
        const all = {
            recruit: {
                cost: this.host.settings.leveling.recruitLevel2Cost,
                active: intel.recruitLevel > 1,
                affordable: canBuy && bal >= this.host.settings.leveling.recruitLevel2Cost,
            },
            deploySlot: {
                cost: this.host.settings.deploy.extraSlotCost,
                active: intel.deployExtra > 0,
                affordable: canBuy && bal >= this.host.settings.deploy.extraSlotCost,
            },
            rangeBoost: {
                cost: this.host.settings.deploy.rangedRangeBoostCost,
                bonus: this.host.settings.deploy.rangeBoost,
                active: intel.rangeBoost,
                affordable: canBuy && bal >= this.host.settings.deploy.rangedRangeBoostCost,
            },
            speedBoost: {
                cost: this.host.settings.deploy.armySpeedBoostCost,
                bonus: this.host.settings.deploy.speedBoost,
                active: intel.speedBoost,
                affordable: canBuy && bal >= this.host.settings.deploy.armySpeedBoostCost,
            },
            credit: {
                gain: this.host.settings.deploy.creditGain,
                debt: this.host.settings.deploy.creditDebt,
                active: intel.creditUsed,
                affordable: canBuy,
            },
        };
        const gated = this.host.tutorial?.allowedGarrisonOffers() ?? null;
        if (gated) {
            return {
                recruit: has('recruitLevel') && gated.recruit ? all.recruit : undefined,
                deploySlot: has('deploySlot') && gated.deploySlot ? all.deploySlot : undefined,
                rangeBoost: has('rangeBoost') && gated.extras ? all.rangeBoost : undefined,
                speedBoost: has('speedBoost') && gated.extras ? all.speedBoost : undefined,
                credit: has('credit') && gated.extras ? all.credit : undefined,
            };
        }
        return {
            recruit: has('recruitLevel') ? all.recruit : undefined,
            deploySlot: has('deploySlot') ? all.deploySlot : undefined,
            rangeBoost: has('rangeBoost') ? all.rangeBoost : undefined,
            speedBoost: has('speedBoost') ? all.speedBoost : undefined,
            credit: has('credit') ? all.credit : undefined,
        };
    }

    /**
     * Command Tower permanent tracks — always listed when selected; owned /
     * tier state uses deploy intel while fogged.
     */
    private commandTowerSelection(
        u: Unit,
    ): Pick<
        SelectionInfo,
        'boosts' | 'sellAbility' | 'rallyRouteAbility' | 'movePackAbility' | 'forgeSpells'
    > {
        const has = (a: BuildingAbilityId) => hasAbility(u.type, a);
        if (!(['armyBoosts', 'selling', 'rallyRoute', 'movePack', 'vanguardSpells'] as const).some(has)) return {};
        const seat = this.panelSeatOf(u);
        const canBuy = seat === this.host.humanSeat && this.host.playerCanAct;
        const bal = this.host.economy.balance(seat);
        const intel = this.host.intelBuildingSeat(u, seat);
        const boosts: SelectionInfo['boosts'] = (['attack', 'hp'] as const).map((id) => {
            const tiers =
                id === 'attack' ? this.host.settings.boosts.attackTiers : this.host.settings.boosts.hpTiers;
            const tier = id === 'attack' ? intel.boostAttack : intel.boostHp;
            const maxed = tier >= tiers.length;
            const pct = Math.round(tiers[maxed ? tier - 1 : tier]! * 100);
            const cost = maxed ? 0 : this.host.settings.boosts.costs[tier]!;
            const allowed = this.host.tutorial?.allowedBoostIds();
            const unlocked = allowed == null || allowed.includes(id);
            return {
                id,
                label:
                    id === 'attack'
                        ? t('hud:armyAttackBoost', { pct })
                        : t('hud:armyHpBoost', { pct }),
                cost,
                affordable: canBuy && !maxed && unlocked && bal >= cost,
                maxed,
            };
        });
        // Tutorial 3 round 2 is the boost lesson — the other tracks would only
        // drain the supply its End Deployment gate needs.
        if (this.host.tutorial?.boostLessonOnly) {
            const allowed = this.host.tutorial.allowedBoostIds();
            const shown =
                allowed === null
                    ? boosts
                    : boosts?.filter((b) => allowed.includes(b.id) || b.maxed);
            return { boosts: has('armyBoosts') ? shown : undefined };
        }
        // Later Tutorial 3 rounds: hide Vanguard buys entirely (Garrison lesson).
        if (this.host.tutorial?.allowedGarrisonOffers()) {
            return {};
        }
        const all = {
            sellAbility: {
                cost: this.host.settings.sell.abilityCost,
                owned: intel.sellOwned,
                affordable: canBuy && bal >= this.host.settings.sell.abilityCost,
            },
            rallyRouteAbility: {
                cost: this.host.settings.rallyRoute.abilityCost,
                owned: intel.rallyBought,
                max: rallyRouteBuyMax(
                    isSiege(this.host.settings) ? this.host.yearAttackerTeam() : null,
                    u.team === 'horde' ? 'player' : u.team,
                ),
                affordable: canBuy && bal >= this.host.settings.rallyRoute.abilityCost,
            },
            movePackAbility: {
                cost: this.host.settings.movePack.abilityCost,
                owned: intel.movePackOwned,
                affordable: canBuy && bal >= this.host.settings.movePack.abilityCost,
            },
        };
        // Spells sold here (a vanguardCost) sit in the same list as Sell / Move / Rally Route,
        // one more buy each, once per match.
        const bought =
            this.host.placement.isIntelFogged(u) && this.host.buildingIntelSnapshot
                ? (this.host.buildingIntelSnapshot.forgeSpellOwned[seat] ?? [])
                : (this.host.forgeSpellOwned[seat] ?? []);
        const forgeSpells = has('vanguardSpells')
            ? this.host.types.tactics
                  .filter((tac) => tac.vanguardCost !== undefined)
                  .map((tac) => {
                      const cost = tac.vanguardCost!;
                      const owned = bought.includes(tac.id);
                      return {
                          tacticId: tac.id,
                          icon: tac.icon,
                          name: tacticName(tac.id, tac.name),
                          desc: tacticDescription(tac.id, tac.description),
                          cost,
                          owned,
                          affordable: canBuy && !owned && bal >= cost,
                      };
                  })
            : undefined;
        return {
            boosts: has('armyBoosts') ? boosts : undefined,
            sellAbility: has('selling') ? all.sellAbility : undefined,
            rallyRouteAbility: has('rallyRoute') ? all.rallyRouteAbility : undefined,
            movePackAbility: has('movePack') ? all.movePackAbility : undefined,
            forgeSpells,
        };
    }

    /**
     * What a building's fall costs its owner, in the width of a stat value —
     * it replaces the combat rows a structure has no use for. Reads live match
     * settings: the Stronghold's answer depends on `strongholdMode`.
     */
    private destructionNote(u: Unit): string | undefined {
        if (!u.type.structure) return undefined;
        const onDestroyed = u.type.onDestroyed;
        if (onDestroyed?.collapseOwnArmy) {
            return this.host.settings.strongholdMode === 'lifeline' ? t('hud:instantLoss') : t('hud:noEffect');
        }
        if (!onDestroyed?.seatDebuff) return undefined;
        // the window shrinks as the building levels, so read it off THIS one —
        // and a fully upgraded tower reaches 0, where the sim applies nothing
        const dur = this.host.settings.towers.debuffDuration;
        const seconds = Math.max(0, dur.baseSeconds - (u.level - 1) * dur.stepSeconds);
        return seconds > 0 ? t('hud:secondDebuff', { n: seconds }) : t('hud:noEffect');
    }

    private strongholdSelection(
        u: Unit,
    ): Pick<SelectionInfo, 'sendSupply' | 'forge' | 'forgeSpells' | 'strongholdArchers'> {
        const has = (a: BuildingAbilityId) => hasAbility(u.type, a);
        if (!(['forge', 'forgeSpells', 'sendSupply'] as const).some(has) && !u.type.garrison) return {};
        const out: Pick<SelectionInfo, 'sendSupply' | 'forge' | 'forgeSpells' | 'strongholdArchers'> = {};
        const team: Team = u.team === 'horde' ? 'player' : u.team;
        const teamSeats = seatIdsOf(this.host.seats, team);
        const canBuy = u.team === 'player' && this.host.playerCanAct;
        const fogged = this.host.placement.isIntelFogged(u);

        // Ally supply gift — only when this side has two seats
        if (teamSeats.length >= 2 && has('sendSupply')) {
            const amount = 100;
            out.sendSupply = {
                amount,
                affordable: canBuy && this.host.economy.balance(this.host.humanSeat) >= amount,
            };
        }

        // Battlement archers, priced and buyable for your own keep only. The
        // count follows the same fog window the forge and the spells do: an
        // archer the enemy posted THIS round is not on their wall yet as far
        // as you know, and the panel must not be the one place that says so.
        // Your own keep shows YOUR posts (each seat mans and pays for its own
        // block, see garrisonSeatSlots); an enemy keep shows the side's total.
        const garrison = u.type.garrison;
        if (garrison) {
            const own = u.team === 'player';
            const manned = own
                ? garrisonSeatManned(this.host.placement, u, this.host.humanSeat)
                : fogged && this.host.buildingIntelSnapshot && u.type.baseAnchor === 'stronghold'
                  ? (this.host.buildingIntelSnapshot.strongholdArchers[team] ?? 0)
                  : this.postedOn(u);
            const nextCost = this.host.types.garrisonPostCost(u.type, manned);
            const slotMax = own
                ? garrisonSeatSlots(u, this.host.seats, this.host.humanSeat).length
                : garrison.ownerOnly
                  ? Math.min(garrison.slots.length, garrison.perSeat)
                  : Math.min(garrison.slots.length, garrison.perSeat * teamSeats.length);
            out.strongholdArchers = {
                tower: !!garrison.ownerOnly,
                cost: nextCost,
                owned: manned,
                max: slotMax,
                affordable:
                    canBuy &&
                    manned < slotMax &&
                    this.host.economy.balance(this.host.humanSeat) >= nextCost,
            };
        }

        // Commander forge spells: own seat can buy; enemy seats show owned /
        // last-round intel (same fog window as Research Center / Command Tower).
        const spellSeats = u.team === 'player' ? [this.host.humanSeat] : teamSeats;
        // Tutorial 2 round 1 teaches the wall only — the forge shelf stays empty.
        const forgeShelfOpen = has('forgeSpells') && !this.host.tutorial?.forgeSpellsHidden;
        out.forgeSpells = forgeShelfOpen
            ? spellSeats.flatMap((seat) => {
                  const bought =
                      fogged && this.host.buildingIntelSnapshot
                          ? (this.host.buildingIntelSnapshot.forgeSpellOwned[seat] ?? [])
                          : (this.host.forgeSpellOwned[seat] ?? []);
                  const bal = this.host.economy.balance(seat);
                  const seatCanBuy = canBuy && seat === this.host.humanSeat;
                  return (this.host.forgeSpellsOf(seat) ?? [])
                      .map((tacticId) => {
                          const t = this.host.types.tactic(tacticId);
                          // no strongholdCost = this spell isn't sold here
                          if (!t || t.strongholdCost === undefined) return null;
                          const cost = t.strongholdCost;
                          const owned = bought.includes(tacticId);
                          return {
                              tacticId,
                              icon: t.icon,
                              name: tacticName(tacticId, t.name),
                              desc: tacticDescription(tacticId, t.description),
                              cost,
                              owned,
                              affordable: seatCanBuy && !owned && bal >= cost,
                          };
                      })
                      .filter((e): e is NonNullable<typeof e> => e !== null);
              })
            : [];

        if (!has('forge')) return out;

        const snapIds =
            fogged && this.host.buildingIntelSnapshot
                ? this.host.buildingIntelSnapshot.forge[team]
                : null;
        const live = this.host.forgeSlots[team]!;
        const hintSlots: (ForgeSlot | null)[] = snapIds
            ? snapIds.map((id) => (id ? { itemId: id, seat: -1 as SeatId, round: -1 } : null))
            : live;
        const slotCount = snapIds?.length ?? live.length;
        const ovenEmpty = !fogged && live.every((s) => s === null);
        const pool = this.host.teamForgePool(team);
        const suggestions =
            // TEMP: one-click forge-fill shortcuts disabled
            false && ovenEmpty && canBuy && !this.host.armedItem
                ? forgeRecipesCraftableFromBag(
                      this.host.types,
                      this.host.itemInventory[this.host.humanSeat] ?? [],
                      pool,
                  ).map((r) => ({
                      tacticId: r.productId,
                      icon: r.spellIcon,
                      name: r.spellName,
                      desc: r.spellDesc,
                      itemIds: r.ingredients,
                  }))
                : [];
        const bakeResult = resolveForge(this.host.types, hintSlots, pool);
        const bakeInfo = bakeResult.product
            ? forgeProductInfo(this.host.types, bakeResult.product)
            : null;
        const lit = !!bakeInfo;
        out.forge = {
            slotCount,
            lit,
            canUnlight: false,
            bakeAffordable: true,
            dropReady: !fogged && this.host.canDropForgeOn(u),
            hint: forgeHintText(this.host.types, hintSlots, fogged ? 'this' : 'next', pool, lit),
            suggestions,
            spellPool: pool,
            bake: bakeInfo
                ? {
                      id:
                          bakeResult.product?.kind === 'item'
                              ? bakeResult.product.id
                              : undefined,
                      icon: bakeInfo.icon,
                      name: bakeInfo.name,
                      desc: bakeInfo.desc,
                      forgeCost: 0,
                      ingredientIcons:
                          bakeResult.product?.kind === 'tactic'
                              ? forgeIngredientIcons(this.host.types, bakeResult.product.id)
                              : [],
                  }
                : undefined,
            slots: Array.from({ length: slotCount }, (_, i) => {
                if (snapIds) {
                    const id = snapIds[i];
                    if (!id) return null;
                    return {
                        id,
                        icon: this.host.types.rune(id)?.icon ?? '?',
                        name: itemName(id, this.host.types.rune(id)?.name ?? id),
                        desc: itemDescription(id, this.host.types.rune(id)?.description ?? '', this.host.types.rune(id)?.mods),
                        removable: false,
                    };
                }
                const s = live[i];
                if (!s) return null;
                return {
                    id: s.itemId,
                    icon: this.host.types.rune(s.itemId)?.icon ?? '?',
                    name: itemName(s.itemId, this.host.types.rune(s.itemId)?.name ?? s.itemId),
                    desc: itemDescription(s.itemId, this.host.types.rune(s.itemId)?.description ?? '', this.host.types.rune(s.itemId)?.mods),
                    removable:
                        canBuy && s.seat === this.host.humanSeat && s.round === this.host.round,
                };
            }),
        };

        return out;
    }

    /** units posted on this building */
    postedOn(host: Unit): number {
        let n = 0;
        for (const u of this.host.placement.allUnits()) {
            if (u.hostUnitId === host.id && !u.consumed) n++;
        }
        return n;
    }

    /** phase-start building action state, or live once this building isn't fogged */
    /**
     * Whose purchases a building's panel shows and sells: its owner's — or,
     * on a side's only building of its kind (a Siege's Tent, shared by two
     * attackers), the local seat's when it has none of its own.
     */
    private panelSeatOf(u: Unit): SeatId {
        if (u.team !== 'player' || u.seat === this.host.humanSeat) return u.seat;
        const ownsOne = this.host.placement.allUnits().some((b) => b.type === u.type && b.seat === this.host.humanSeat && !b.destroyed);
        return ownsOne ? u.seat : this.host.humanSeat;
    }
}

/**
 * The details pane's "Hits" line, after the layers: what the unit is especially strong
 * against, joined (only buildings and walls so far — UnitType.buildingDamageMult).
 */
function strengthsLabel(type: UnitType): string {
    const parts: string[] = [];
    const walls = type.buildingDamageMult ?? 1;
    if (walls !== 1) parts.push(t('hud:vsWalls', { mult: Math.round(walls * 10) / 10, defaultValue: '{{mult}}x vs walls' }));
    return parts.join(', ');
}

/** Short label for the details-pane "Hits" row. */
function targetsLabel(targets: { ground: boolean; air: boolean }): string {
    if (targets.ground && targets.air) return t('hud:groundAir');
    if (targets.ground) return t('hud:groundOnly');
    if (targets.air) return t('hud:airOnly');
    return t('hud:none');
}
