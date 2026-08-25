import { quantizeWorld, quantizeYaw, type Action } from './actions';
import { SHOP_UNIT_IDS } from './cards';
import { unlockCostForSpeciality } from './cards';
import type { RoundCard, SpecialityId, StartCard } from './cards';
import type { PlacementController } from './placement';
import type { DeploySettings, Economy } from './settings';
import {
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    MOVE_UNIT_ID,
    TUTOR_ID,
    SELL_UNIT_ID,
    TACTICS,
    usesSpellPlacement,
} from './tactics';
import type { TechTree } from './tech';
import { techsForUnit, type Loadout } from './techCatalog';
import { UNIT_TYPES, isPlayerBuyable, unitTypeById, type Team, type UnitType } from './units';
import type { SeatId } from './seats';
import { BASE_RUNE_IDS, itemSlotLimit } from './items';

/** army packs cheaper than this are preferred for the AI's first buy each round */
const CHEAP_UNIT_COST = 200;

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
}

export class AiOpponent implements Opponent {
    constructor(
        private readonly team: Team,
        /** the seat this brain commands — its purse, its lane, its packs */
        private readonly seat: SeatId,
        private readonly ctx: {
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
            /** the AI's own seeded stream — nothing else may consume it */
            rng: () => number;
            /** per-SEAT talent picks; AI seats normally have none and get
             *  the catalog default (PROGRESSION_PLAN.md §1c) */
            loadoutOf: (seat: SeatId) => Loadout | undefined;
            /** garrison / shop deploy prices (extra slot, base rune, …) */
            deploySettings: DeploySettings;
            /** per-SEAT stronghold spells already bought this match */
            forgeSpellOwned: string[][];
            /** this seat's commander forge-spell pool */
            forgeSpellsOf: (seat: SeatId) => readonly string[] | undefined;
        },
    ) {}

    chooseStarter(offer: readonly StartCard[]): void {
        const pick = offer[Math.floor(this.ctx.rng() * offer.length)]!;
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

    onBuildPhase(_round: number): void {
        this.runBuildActions();
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /** cheat mid-deploy: same spend/move/cast loop without another lock-in */
    rerunBuildActions(): void {
        this.runBuildActions();
    }

    private runBuildActions(): void {
        const { placement, rng } = this.ctx;
        const team = this.team;

        // 1) first buy: prefer a cheap unit (< 200); unlock one if needed
        this.buyUnit(this.pickFirstBuyType());

        // 2) remaining deploy slots: random among affordable unlocked types
        for (let guard = 0; guard < 30; guard++) {
            const affordable = this.affordableArmyTypes();
            if (affordable.length === 0) break;
            const type = affordable[Math.floor(rng() * affordable.length)]!;
            if (!this.buyUnit(type)) break;
        }

        // 3) spare ~100 supply → +1 garrison slot + a shop rune to equip
        this.maybeBuySlotAndRune();

        // rearrange packs
        for (const unit of placement.allUnits()) {
            if (unit.seat !== this.seat || !placement.canReposition(unit)) continue;
            if (rng() < 0.25) continue;
            const spot = placement.findAiSpot(team, this.seat, unit.type, rng);
            if (!spot) continue;
            if (spot.rotated !== unit.rotated) {
                this.ctx.dispatch({ kind: 'rotate', team, seat: this.seat, unitId: unit.id });
            }
            this.ctx.dispatch({
                kind: 'move',
                team,
                seat: this.seat,
                unitId: unit.id,
                anchor: spot.anchor,
            });
        }

        // equip inventory items onto bare packs
        this.applyItems();

        // cast available tactics / spells toward the opponent
        this.placeTactics();

        // leftover: pack levels → stronghold spells → unit techs (never buildings)
        this.spendLeftoverUpgrades();
    }

    /** unlocked, buyable army types this seat can afford right now */
    private affordableArmyTypes(pred?: (t: UnitType) => boolean): UnitType[] {
        const { economy, unlockedUnits } = this.ctx;
        return UNIT_TYPES.filter(
            (t) =>
                !t.extra &&
                isPlayerBuyable(t) &&
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
    private preferLesserOwned(candidates: readonly UnitType[]): UnitType | null {
        if (candidates.length === 0) return null;
        const counts = this.ownedArmyCounts();
        const { rng } = this.ctx;
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

    /**
     * Prefer cost &lt; 200, and among those the type this seat has fewer of —
     * unlock that type first when it is still locked (even if another cheap
     * type is already buyable). If still nothing cheap, fall back to any
     * affordable type (same diversity).
     */
    private pickFirstBuyType(): UnitType | null {
        const { economy, unlockedUnits, unlockUsedThisRound, speciality } = this.ctx;
        const unlocked = unlockedUnits[this.seat]!;

        const allCheap: UnitType[] = [];
        for (const id of SHOP_UNIT_IDS) {
            const t = unitTypeById(id);
            if (t && t.cost < CHEAP_UNIT_COST) allCheap.push(t);
        }
        const preferred = this.preferLesserOwned(allCheap);
        if (
            preferred &&
            !unlocked.includes(preferred.id) &&
            !unlockUsedThisRound[this.seat] &&
            unlockCostForSpeciality(preferred.id, speciality[this.seat] ?? null) <=
                economy.balance(this.seat)
        ) {
            this.ctx.dispatch({
                kind: 'unlockUnit',
                team: this.team,
                seat: this.seat,
                typeId: preferred.id,
            });
        }

        const cheap = this.affordableArmyTypes((t) => t.cost < CHEAP_UNIT_COST);
        const pool = cheap.length > 0 ? cheap : this.affordableArmyTypes();
        return this.preferLesserOwned(pool);
    }

    private buyUnit(type: UnitType | null): boolean {
        if (!type) return false;
        const { dispatch, placement, rng } = this.ctx;
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
     * After army buys: if supply covers +1 deploy slot and a base rune, buy both
     * so the rune can be equipped in {@link applyItems}.
     */
    private maybeBuySlotAndRune(): void {
        const { dispatch, economy, rng, deploySettings } = this.ctx;
        const need = deploySettings.extraSlotCost + deploySettings.baseRuneCost;
        if (economy.balance(this.seat) < need) return;
        if (!dispatch({ kind: 'buyDeploySlot', team: this.team, seat: this.seat })) return;
        const itemId = BASE_RUNE_IDS[Math.floor(rng() * BASE_RUNE_IDS.length)]!;
        dispatch({ kind: 'buyRune', team: this.team, seat: this.seat, itemId });
    }

    private applyItems(): void {
        const { dispatch, placement, items, rng } = this.ctx;
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
                        u.items.length < itemSlotLimit(u.type.id),
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

    private placeTactics(): void {
        const { dispatch, placement, tactics, rng } = this.ctx;
        const team = this.team;
        const foes = placement
            .allUnits()
            .filter((u) => u.team !== team && !u.type.extra);
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
            const tactic = TACTICS[tacticId];
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
                const p = foePoint();
                if (tactic.targeting === 'point') {
                    ok = dispatch({ kind: 'placeSpell', team, seat: this.seat, tacticId, x: p.x, z: p.z });
                } else if (tactic.targeting === 'two-point') {
                    const q = foePoint();
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

    /**
     * leftover supply: pack levels first, then stronghold forge spells, then
     * unit techs. Never upgrades buildings.
     */
    private spendLeftoverUpgrades(): void {
        const { dispatch, placement, economy, techTree, forgeSpellOwned, forgeSpellsOf } = this.ctx;
        const team = this.team;

        let leveled = true;
        while (leveled) {
            leveled = false;
            for (const unit of placement.allUnits()) {
                if (unit.seat !== this.seat || unit.type.structure || unit.type.extra) continue;
                if (dispatch({ kind: 'buyLevel', team, seat: this.seat, unitId: unit.id })) {
                    leveled = true;
                }
            }
        }

        const ownedSpells = forgeSpellOwned[this.seat]!;
        let boughtSpell = true;
        while (boughtSpell) {
            boughtSpell = false;
            const pool = forgeSpellsOf(this.seat) ?? [];
            for (const tacticId of pool) {
                if (ownedSpells.includes(tacticId)) continue;
                const cost = TACTICS[tacticId]?.strongholdCost;
                if (cost === undefined || economy.balance(this.seat) < cost) continue;
                if (dispatch({ kind: 'buyForgeSpell', team, seat: this.seat, tacticId })) {
                    boughtSpell = true;
                }
            }
        }

        const ownedTypeIds = [
            ...new Set(
                placement
                    .allUnits()
                    .filter((u) => u.seat === this.seat && !u.type.structure && !u.type.extra)
                    .map((u) => u.type.id),
            ),
        ];

        let bought = true;
        while (bought) {
            bought = false;
            for (const typeId of ownedTypeIds) {
                const type = unitTypeById(typeId);
                const techs = type ? techsForUnit(type.id, this.ctx.loadoutOf(this.seat)) : [];
                if (!type || techs.length === 0) continue;
                const owned = techTree.ownedFor(this.seat, type.id);
                for (const tech of techs) {
                    if (owned.has(tech.id)) continue;
                    const cost = economy.techCostOf(tech, owned.size);
                    if (economy.balance(this.seat) < cost) continue;
                    if (
                        dispatch({
                            kind: 'buyTech',
                            team,
                            seat: this.seat,
                            typeId: type.id,
                            techId: tech.id,
                        })
                    ) {
                        bought = true;
                    }
                }
            }
        }
    }
}
