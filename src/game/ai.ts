import { quantizeWorld, quantizeYaw, type Action } from './actions';
import { detCos, detSin } from './detMath';
import { unlockCostFor } from './cards';
import type { RoundCard, SpecialityId, StartCard } from './cards';
import type { PlacementController } from './placement';
import type { DeploySettings, Economy } from './settings';
import {
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    MOVE_UNIT_ID,
    TUTOR_ID,
    SELL_UNIT_ID,
    usesSpellPlacement,
} from './tactics';
import type { TechTree } from './tech';
import type { Loadout } from './techCatalog';
import { isPlayerBuyable, type Team, type Unit, type UnitType } from './units';
import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import { itemSlotLimit } from './items';
import { chooseRebuildCommander, YearBrain } from './aiYear';
import { AI_WALL_ID, isSiegeType, placeWallPlan, wallPlanCells, wallsToTend, readEnemyWalls, siegeWanted, wallsWanted } from './aiWalls';
import type { LevelingSettings } from './settings';
import { aiFeatures, type AiDifficulty, type AiPersonality } from './aiProfile';
import { readThreat, threatLines, type BattleRecord, type ThreatMap } from './aiThreat';

/**
 * A side's decision maker. The built-in AI implements it; a future network
 * opponent will too (its "decisions" being actions received from the peer).
 * Everything an opponent does flows through the same dispatcher as the
 * player's input — no other channel exists.
 */
export interface Opponent {
    /** pick one of the offered specialist cards */
    chooseStarter(offer: readonly StartCard[]): void;
    /** act at the start of a build phase: techs, buys, rearranging — then lock in */
    onBuildPhase(round: number): void;
    /** answer the between-round card offer (pick or skip) */
    onRoundCards(offer: readonly RoundCard[]): void;
    /**
     * Re-run deploy actions without locking in again (cheat mid-phase top-up):
     * buys, reposition, items, spells, upgrades.
     */
    rerunBuildActions?(): void;
    /** what it read before its last build, for the debug overlay (`name` = the seat's) */
    debugLines?(name: string): string[];
}

export class AiOpponent implements Opponent {
    constructor(
        private readonly team: Team,
        /** the seat this brain commands — its purse, its lane, its packs */
        private readonly seat: SeatId,
        private readonly ctx: {
            /** the unit and building definitions this match plays with */
            types: TypeRegistry;
            dispatch: (action: Action) => boolean;
            placement: PlacementController;
            economy: Economy;
            techTree: TechTree;
            /** per-SEAT — own card's shop unlocks, never shared */
            unlockedUnits: string[][];
            /** per-SEAT — own once-per-round shop-unlock gate */
            unlockUsedThisRound: boolean[];
            /** per-SEAT — never shared */
            items: string[][];
            /** per-SEAT — never shared */
            tactics: string[][];
            /** per-SEAT chosen commander — prices its own shop unlocks */
            speciality: (SpecialityId | null)[];
            commander: (string | null)[];
            /** the AI's own seeded stream — nothing else may consume it */
            rng: () => number;
            /** per-SEAT talent picks; AI seats normally have none and get
             *  the catalog default (PROGRESSION_PLAN.md §1c) */
            loadoutOf: (seat: SeatId) => Loadout | undefined;
            /** shop deploy prices (extra slot, base rune, …) */
            deploySettings: DeploySettings;
            /** per-SEAT stronghold spells already bought this match */
            forgeSpellOwned: string[][];
            /** this seat's commander forge-spell pool */
            forgeSpellsOf: (seat: SeatId) => readonly string[] | undefined;
            /**
             * Campaign climb: wipe + wealth-matched fresh rebuild each round.
             * Practice / MP leave this unset/false.
             */
            climb?: boolean;
            /** 'lockInOnly': skip every purchase and just lock in (scenario opponents) */
            opponents?: 'build' | 'lockInOnly';
            /** Campaign: deterministic per-round stream (seed + round) */
            rngForRound?: (round: number) => () => number;
            /** leveling rules (the planner reads level multipliers and prices) */
            leveling: LevelingSettings;
            /** The Year: this seat's role — its planner knows who has the base */
            yearRole?: 'attacker' | 'defender';
            /** new packs this seat may deploy in a build phase */
            deployCap: () => number;
            /** planner choice overrides for this seat (arena experiments) */
            plannerOverrides?: Record<string, number>;
            /** Stone Walls this seat may still place this round (0 / unset: none) */
            wallsLeft?: () => number;
            /** how the towers did in the last battle (null before the first) */
            lastBattle?: () => BattleRecord | null;
            /** the seat's strength and style, set in the lobby (aiProfile) */
            difficulty: AiDifficulty;
            personality: AiPersonality;
        },
    ) {}

    /** the enemy as read at the start of the last build (AI_PLAN.md, "Threat map") */
    private threat: ThreatMap | null = null;

    debugLines(name: string): string[] {
        if (!this.threat) return [];
        return threatLines(`${name} (${this.ctx.difficulty}, ${this.ctx.personality})`, this.threat, this.ctx.lastBattle?.() ?? null, this.team, this.seat);
    }

    chooseStarter(offer: readonly StartCard[]): void {
        // a Siege rebuilds this side every round: pick for lasting combat effects
        const pick =
            this.ctx.climb && offer.length > 0
                ? chooseRebuildCommander(offer, this.ctx.types)
                : offer[Math.floor(this.ctx.rng() * offer.length)]!;
        this.ctx.dispatch({ kind: 'chooseCard', team: this.team, seat: this.seat, cardId: pick.id });
    }

    onRoundCards(offer: readonly RoundCard[]): void {
        const affordable = offer.filter((c) => this.ctx.economy.balance(this.seat) >= c.cost);
        const pick =
            affordable.length > 0
                ? affordable[Math.floor(this.ctx.rng() * affordable.length)]!
                : null;
        this.ctx.dispatch({
            kind: 'roundCard',
            team: this.team,
            seat: this.seat,
            cardId: pick?.id ?? null,
        });
    }

    onBuildPhase(round: number): void {
        // a scenario's authored army fights as placed — lock in, nothing else
        if (this.ctx.opponents !== 'lockInOnly') {
            // a Siege rebuilds this side from nothing every round; elsewhere the army stays
            if (this.ctx.climb) this.ctx.dispatch({ kind: 'clearArmy', team: this.team, seat: this.seat });
            this.build(this.ctx.rngForRound?.(round) ?? this.ctx.rng);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /** cheat mid-deploy: the same round again, without another lock-in */
    rerunBuildActions(): void {
        this.build(this.ctx.rng);
    }

    /**
     * One build phase, every mode (AI_PLAN.md): walls, then the planner's army
     * (kept and extended, or rebuilt in a Siege) — scored or, on the easier
     * levels, random — then runes, spells and building levels as the
     * difficulty allows.
     */
    private build(rng: () => number): void {
        const features = aiFeatures(this.ctx.difficulty);
        // read the enemy first: where its army stands, which posture that is (acted on from step 3)
        this.threat = readThreat(this.ctx.placement, this.team, this.seat);
        // 0) walls: its own fortress, siege against theirs
        this.answerWalls(rng);
        // 1) the army
        new YearBrain(
            this.ctx,
            this.team,
            this.seat,
            this.ctx.yearRole ?? 'defender',
            rng,
            this.ctx.plannerOverrides,
            features.unitChoice,
        ).playRound({ keep: !this.ctx.climb, slots: this.ctx.deployCap() });
        // 2) spare supply → a shop rune; then everything in the bag onto packs
        this.maybeBuyRune(rng);
        this.applyItems(rng);
        // 3) spells: the Stronghold's forge spells (not in a Siege's rebuilt army), then the strip
        if (features.spells) {
            if (!this.ctx.climb) this.buyForgeSpells();
            this.placeTactics(rng);
        }
        // 4) last, with what's left: buildings help least
        if (features.buildingUpgrades) this.upgradeBuildings();
    }

    /**
     * Walls, before the army (one logic for both brains, see aiWalls): the
     * next pieces of its fortress plan (whose tiles its packs keep off),
     * its walls levelled and manned with archers, then siege packs against the other side's walls when they matter —
     * unlocking one if none is in the shop yet.
     */
    private answerWalls(rng: () => number): void {
        const { placement, economy, dispatch } = this.ctx;
        const wall = this.ctx.types.byId(AI_WALL_ID);
        // the plan's tiles stay free of its own packs, so it can always be finished
        const plans = !!wall && !!this.ctx.wallsLeft && this.ctx.wallsLeft() > 0;
        placement.setAiAvoid(this.seat, plans ? wallPlanCells(placement, this.team, wall) : new Set());
        if (wall && this.ctx.wallsLeft) {
            const count = wallsWanted(placement, this.team, this.seat, {
                wallsLeft: this.ctx.wallsLeft(),
                supply: economy.balance(this.seat),
                wallCost: economy.costOf(wall),
                defender: this.ctx.yearRole === 'defender',
            });
            placeWallPlan(placement, this.team, this.seat, wall, count, (slot) =>
                dispatch({ kind: 'buy', team: this.team, seat: this.seat, typeId: wall.id, ...slot }),
            );
            // tend what stands (first tests: everything, each round): one level up each, then
            // archers onto every free post — the actions refuse when maxed, manned or unaffordable
            const tend = wallsToTend(placement, this.team, this.seat);
            for (const w of tend) dispatch({ kind: 'upgradeTower', team: this.team, seat: this.seat, unitId: w.id });
            for (const w of tend) while (dispatch({ kind: 'buyWallPost', team: this.team, seat: this.seat, unitId: w.id }));
        }
        const have = placement
            .allUnits()
            .filter((u) => u.seat === this.seat && !u.destroyed && !u.type.structure && isSiegeType(u.type)).length;
        for (let need = siegeWanted(readEnemyWalls(placement, this.team)) - have; need > 0; need--) {
            if (this.affordableArmyTypes(isSiegeType).length === 0) this.unlockSiege();
            if (!this.buyUnit(this.preferLesserOwned(this.affordableArmyTypes(isSiegeType), rng), rng)) break;
        }
    }

    /**
     * Low priority, with what the army left: one level a round on each of
     * its base buildings — the Stronghold first
     * (its own share of the side's keep), then its two towers, lowest level
     * first. The action refuses when maxed or unaffordable.
     */
    private upgradeBuildings(): void {
        const { placement, dispatch } = this.ctx;
        const rank = (u: Unit) => (u.type.baseAnchor === 'stronghold' ? 0 : 1);
        const buildings = placement
            .allUnits()
            .filter(
                (u) =>
                    u.team === this.team &&
                    !u.destroyed &&
                    !!u.type.baseAnchor &&
                    (u.type.baseAnchor === 'stronghold' || u.seat === this.seat),
            )
            .sort((a, b) => rank(a) - rank(b) || a.level - b.level || a.id - b.id);
        for (const u of buildings) dispatch({ kind: 'upgradeTower', team: this.team, seat: this.seat, unitId: u.id });
    }

    /** this round's unlock on the cheapest siege type of the shop, if it's still free and affordable */
    private unlockSiege(): void {
        const { economy, unlockedUnits, unlockUsedThisRound, commander, types } = this.ctx;
        if (unlockUsedThisRound[this.seat]) return;
        const owner = types.commander(commander[this.seat] ?? '');
        let best: { id: string; cost: number } | null = null;
        for (const id of this.shop()) {
            const t = types.byId(id);
            if (!t || !isSiegeType(t) || unlockedUnits[this.seat]!.includes(id)) continue;
            const cost = unlockCostFor(id, owner, types);
            if (cost <= economy.balance(this.seat) && (!best || cost < best.cost)) best = { id, cost };
        }
        if (best) this.ctx.dispatch({ kind: 'unlockUnit', team: this.team, seat: this.seat, typeId: best.id });
    }

    /** the unit types this seat's shop holds (its commander's own shop, else the normal one) */
    private shop(): readonly string[] {
        return this.ctx.types.shopFor(this.ctx.types.commander(this.ctx.commander[this.seat] ?? ''));
    }

    /** unlocked, buyable army types this seat can afford right now */
    private affordableArmyTypes(pred?: (t: UnitType) => boolean): UnitType[] {
        const { economy, unlockedUnits } = this.ctx;
        const shop = this.shop();
        return this.ctx.types.roster.filter(
            (t) =>
                !t.extra &&
                shop.includes(t.id) &&
                unlockedUnits[this.seat]!.includes(t.id) &&
                economy.canAfford(this.seat, t) &&
                (!pred || pred(t)),
        );
    }

    /** how many of this seat's army packs are of each type (for first-buy diversity) */
    private ownedArmyCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        for (const u of this.ctx.placement.allUnits()) {
            if (u.seat !== this.seat || u.type.structure || u.type.extra) continue;
            counts.set(u.type.id, (counts.get(u.type.id) ?? 0) + 1);
        }
        return counts;
    }

    /**
     * Among candidates, prefer types this seat has fewer of (missing first,
     * then the lesser count). Ties break randomly.
     */
    private preferLesserOwned(
        candidates: readonly UnitType[],
        rng: () => number = this.ctx.rng,
    ): UnitType | null {
        if (candidates.length === 0) return null;
        const counts = this.ownedArmyCounts();
        let best: UnitType[] = [];
        let bestCount = Number.POSITIVE_INFINITY;
        for (const t of candidates) {
            const n = counts.get(t.id) ?? 0;
            if (n < bestCount) {
                bestCount = n;
                best = [t];
            } else if (n === bestCount) {
                best.push(t);
            }
        }
        return best[Math.floor(rng() * best.length)]!;
    }

    private buyUnit(type: UnitType | null, rng: () => number = this.ctx.rng): boolean {
        if (!type) return false;
        const { dispatch, placement } = this.ctx;
        const spot = placement.findAiSpot(this.team, this.seat, type, rng);
        if (!spot) return false;
        return dispatch({
            kind: 'buy',
            team: this.team,
            seat: this.seat,
            typeId: type.id,
            anchor: spot.anchor,
            rotated: spot.rotated,
        });
    }

    /**
     * After army buys: if supply covers a base rune, buy one so it can be
     * equipped in {@link applyItems}. Runes do not use deploy buy slots.
     */
    private maybeBuyRune(rng: () => number = this.ctx.rng): void {
        const { dispatch, economy, deploySettings } = this.ctx;
        // Escalating price is applied in the action; gate on the base price so
        // we don't bother when supply is clearly short.
        if (economy.balance(this.seat) < deploySettings.baseRuneCost) return;
        const itemId = this.ctx.types.baseRuneIds[Math.floor(rng() * this.ctx.types.baseRuneIds.length)]!;
        dispatch({ kind: 'buyRune', team: this.team, seat: this.seat, itemId });
    }

    private applyItems(rng: () => number = this.ctx.rng): void {
        const { dispatch, placement, items } = this.ctx;
        const team = this.team;
        const bag = [...items[this.seat]!];
        if (bag.length === 0) return;
        // fill emptier packs first so items spread across the army
        while (bag.length > 0) {
            const packs = placement
                .allUnits()
                .filter(
                    (u) =>
                        u.seat === this.seat &&
                        !u.type.structure &&
                        !u.type.extra &&
                        u.items.length < itemSlotLimit(u.type),
                )
                .sort((a, b) => a.items.length - b.items.length);
            if (packs.length === 0) break;
            const unit = packs[0]!;
            const i = Math.floor(rng() * bag.length);
            const itemId = bag.splice(i, 1)[0]!;
            if (!dispatch({ kind: 'applyItem', team, seat: this.seat, unitId: unit.id, itemId })) {
                bag.push(itemId);
                break;
            }
        }
    }

    private placeTactics(rng: () => number = this.ctx.rng): void {
        const { dispatch, placement, tactics } = this.ctx;
        const team = this.team;
        // Nobody worth a charge: the horde marches in from off the board (the
        // spell lands on empty ground), and no spell can hurt a building any
        // more — towers and strongholds fall to armies only.
        const foes = placement
            .allUnits()
            .filter(
                (u) =>
                    u.team !== team &&
                    u.team !== 'horde' &&
                    !u.type.extra &&
                    !u.type.structure,
            );
        const allies = placement
            .allUnits()
            .filter((u) => u.team === team && !u.type.structure && !u.type.extra);
        if (foes.length === 0) return;

        const foePoint = () => {
            const u = foes[Math.floor(rng() * foes.length)]!;
            const jitter = (rng() - 0.5) * 8;
            return {
                x: quantizeWorld(u.world.x + jitter),
                z: quantizeWorld(u.world.z + jitter),
            };
        };
        const allyPoint = () => {
            const u = (allies.length ? allies : foes)[Math.floor(rng() * (allies.length || foes.length))]!;
            return { x: quantizeWorld(u.world.x), z: quantizeWorld(u.world.z) };
        };

        // shuffle held tactics, place at most two so the field stays readable
        const MAX_TACTICS = 2;
        // own-unit tactics have no ground target for the placer to aim at
        const pool = [...new Set(tactics[this.seat])].filter(
            (id) => id !== SELL_UNIT_ID && id !== MOVE_UNIT_ID && id !== TUTOR_ID,
        );
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [pool[i], pool[j]] = [pool[j]!, pool[i]!];
        }

        let placed = 0;
        for (const tacticId of pool) {
            if (placed >= MAX_TACTICS) break;
            const tactic = this.ctx.types.tactic(tacticId);
            if (!tactic) continue;

            let ok = false;
            if (tacticId === RALLY_ROUTE_ID && allies.length > 0) {
                const a = allyPoint();
                const b = foePoint();
                const c = foePoint();
                ok = dispatch({
                    kind: 'placeRallyRoute',
                    team,
                    seat: this.seat,
                    startX: a.x,
                    startZ: a.z,
                    midX: b.x,
                    midZ: b.z,
                    endX: c.x,
                    endZ: c.z,
                });
            } else if (tacticId === OIL_SPILL_ID) {
                const a = foePoint();
                const b = foePoint();
                ok = dispatch({
                    kind: 'placeOilSpill',
                    team,
                    seat: this.seat,
                    startX: a.x,
                    startZ: a.z,
                    endX: b.x,
                    endZ: b.z,
                });
            } else if (usesSpellPlacement(tactic)) {
                let p = foePoint();
                if (tactic.targeting === 'point') {
                    ok = dispatch({ kind: 'placeSpell', team, seat: this.seat, tacticId, x: p.x, z: p.z });
                } else if (tactic.targeting === 'two-point') {
                    let q = foePoint();
                    // a path spell (the dragon) is drawn at its full length:
                    // the line through both foes, centred between them —
                    // two picks close together made a stubby strafe. The
                    // dispatcher keeps it on the board and within maxSpan.
                    if (tactic.maxSpan) {
                        let dx = q.x - p.x;
                        let dz = q.z - p.z;
                        let len = Math.sqrt(dx * dx + dz * dz);
                        if (len < 1) {
                            const yaw = rng() * Math.PI * 2;
                            dx = detCos(yaw);
                            dz = detSin(yaw);
                            len = 1;
                        }
                        const half = tactic.maxSpan / 2 / len;
                        const mx = (p.x + q.x) / 2;
                        const mz = (p.z + q.z) / 2;
                        p = { x: quantizeWorld(mx - dx * half), z: quantizeWorld(mz - dz * half) };
                        q = { x: quantizeWorld(mx + dx * half), z: quantizeWorld(mz + dz * half) };
                    }
                    ok = dispatch({
                        kind: 'placeSpell',
                        team,
                        seat: this.seat,
                        tacticId,
                        x: p.x,
                        z: p.z,
                        endX: q.x,
                        endZ: q.z,
                    });
                } else if (tactic.targeting === 'point-yaw') {
                    ok = dispatch({
                        kind: 'placeSpell',
                        team,
                        seat: this.seat,
                        tacticId,
                        x: p.x,
                        z: p.z,
                        yaw: quantizeYaw(rng() * Math.PI * 2),
                    });
                }
            }
            if (ok) placed++;
        }
    }

    /** every forge spell of its commander's pool it can pay for */
    private buyForgeSpells(): void {
        const { dispatch, economy, forgeSpellOwned, forgeSpellsOf } = this.ctx;
        const owned = forgeSpellOwned[this.seat]!;
        let bought = true;
        while (bought) {
            bought = false;
            for (const tacticId of forgeSpellsOf(this.seat) ?? []) {
                if (owned.includes(tacticId)) continue;
                const cost = this.ctx.types.tactic(tacticId)?.strongholdCost;
                if (cost === undefined || economy.balance(this.seat) < cost) continue;
                if (dispatch({ kind: 'buyForgeSpell', team: this.team, seat: this.seat, tacticId })) bought = true;
            }
        }
    }
}
