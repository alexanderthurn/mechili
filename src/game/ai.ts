import { quantizeWorld, quantizeYaw, type Action } from './actions';
import type { RoundCard, StartCard } from './cards';
import { SHOP_UNIT_IDS, unitUnlockCost } from './cards';
import type { PlacementController } from './placement';
import type { Economy } from './settings';
import {
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    SELL_UNIT_ID,
    TACTICS,
    usesSpellPlacement,
} from './tactics';
import type { TechTree } from './tech';
import { UNIT_TYPES, unitTypeById, type Team } from './units';

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
        private readonly ctx: {
            dispatch: (action: Action) => boolean;
            placement: PlacementController;
            economy: Economy;
            techTree: TechTree;
            unlockedUnits: Record<Team, string[]>;
            unlockUsedThisRound: Record<Team, boolean>;
            items: Record<Team, string[]>;
            tactics: Record<Team, string[]>;
            /** the AI's own seeded stream — nothing else may consume it */
            rng: () => number;
        },
    ) {}

    chooseStarter(offer: readonly StartCard[]): void {
        const pick = offer[Math.floor(this.ctx.rng() * offer.length)]!;
        this.ctx.dispatch({ kind: 'chooseCard', team: this.team, cardId: pick.id });
    }

    onRoundCards(offer: readonly RoundCard[]): void {
        // takes an affordable UNIT card most of the time, else skips
        const candidates = offer.filter(
            (c) => c.units && this.ctx.economy.balance(this.team) >= c.cost,
        );
        const pick = candidates.length > 0 && this.ctx.rng() < 0.75 ? candidates[0]! : null;
        this.ctx.dispatch({ kind: 'roundCard', team: this.team, cardId: pick?.id ?? null });
    }

    onBuildPhase(_round: number): void {
        this.runBuildActions();
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team });
    }

    /** cheat mid-deploy: same spend/move/cast loop without another lock-in */
    rerunBuildActions(): void {
        this.runBuildActions();
    }

    private runBuildActions(): void {
        const { dispatch, placement, economy, rng, unlockedUnits, unlockUsedThisRound } = this.ctx;
        const team = this.team;
        const unlocked = unlockedUnits[team];

        // one unlock per round — pick an affordable locked type when possible
        if (!unlockUsedThisRound[team]) {
            const locked = SHOP_UNIT_IDS.filter((id) => !unlocked.includes(id));
            const affordable = locked.filter((id) => unitUnlockCost(id) <= economy.balance(team));
            const pool = affordable.length > 0 ? affordable : locked;
            if (pool.length > 0 && rng() < 0.85) {
                const typeId = pool[Math.floor(rng() * pool.length)]!;
                dispatch({ kind: 'unlockUnit', team, typeId });
            }
        }

        // 1) fill every deploy slot first
        for (let guard = 0; guard < 30; guard++) {
            const affordable = UNIT_TYPES.filter(
                (t) =>
                    !t.extra &&
                    unlockedUnits[team].includes(t.id) &&
                    economy.canAfford(team, t),
            );
            if (affordable.length === 0) break;
            const type = affordable[Math.floor(rng() * affordable.length)]!;
            const spot = placement.findEnemySpot(type, rng);
            if (!spot) break;
            const done = dispatch({
                kind: 'buy',
                team,
                typeId: type.id,
                anchor: spot.anchor,
                rotated: spot.rotated,
            });
            if (!done) break;
        }

        // rearrange packs
        for (const unit of placement.allUnits()) {
            if (unit.team !== team || !placement.canReposition(unit)) continue;
            if (rng() < 0.25) continue;
            const spot = placement.findEnemySpot(unit.type, rng);
            if (!spot) continue;
            if (spot.rotated !== unit.rotated) {
                dispatch({ kind: 'rotate', team, unitId: unit.id });
            }
            dispatch({ kind: 'move', team, unitId: unit.id, anchor: spot.anchor });
        }

        // equip inventory items onto bare packs
        this.applyItems();

        // cast available tactics / spells toward the opponent
        this.placeTactics();

        // leftover supply → techs / levels / towers
        this.spendLeftoverUpgrades();
    }

    private applyItems(): void {
        const { dispatch, placement, items, rng } = this.ctx;
        const team = this.team;
        const bag = [...items[team]];
        if (bag.length === 0) return;
        const packs = placement
            .allUnits()
            .filter((u) => u.team === team && !u.type.structure && !u.type.extra && u.items.length === 0);
        for (const unit of packs) {
            if (bag.length === 0) break;
            const i = Math.floor(rng() * bag.length);
            const itemId = bag.splice(i, 1)[0]!;
            if (dispatch({ kind: 'applyItem', team, unitId: unit.id, itemId })) {
                // inventory was mutated by dispatch; keep bag in sync
            } else {
                bag.push(itemId);
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
        const pool = [...new Set(tactics[team])].filter((id) => id !== SELL_UNIT_ID);
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
                ok = dispatch({
                    kind: 'placeRallyRoute',
                    team,
                    startX: a.x,
                    startZ: a.z,
                    endX: b.x,
                    endZ: b.z,
                });
            } else if (tacticId === OIL_SPILL_ID) {
                const a = foePoint();
                const b = foePoint();
                ok = dispatch({
                    kind: 'placeOilSpill',
                    team,
                    startX: a.x,
                    startZ: a.z,
                    endX: b.x,
                    endZ: b.z,
                });
            } else if (usesSpellPlacement(tactic)) {
                const p = foePoint();
                if (tactic.targeting === 'point') {
                    ok = dispatch({ kind: 'placeSpell', team, tacticId, x: p.x, z: p.z });
                } else if (tactic.targeting === 'two-point') {
                    const q = foePoint();
                    ok = dispatch({
                        kind: 'placeSpell',
                        team,
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

    /** spend remaining supply on techs / levels / tower upgrades while affordable */
    private spendLeftoverUpgrades(): void {
        const { dispatch, placement, economy, techTree } = this.ctx;
        const team = this.team;

        const ownedTypeIds = [
            ...new Set(
                placement
                    .allUnits()
                    .filter((u) => u.team === team && !u.type.structure && !u.type.extra)
                    .map((u) => u.type.id),
            ),
        ];

        let bought = true;
        while (bought) {
            bought = false;
            for (const typeId of ownedTypeIds) {
                const type = unitTypeById(typeId);
                if (!type?.techs.length) continue;
                const owned = techTree.ownedFor(team, type.id);
                for (const tech of type.techs) {
                    if (owned.has(tech.id)) continue;
                    const cost = economy.techCostOf(tech, owned.size);
                    if (economy.balance(team) < cost) continue;
                    if (dispatch({ kind: 'buyTech', team, typeId: type.id, techId: tech.id })) {
                        bought = true;
                    }
                }
            }
        }

        for (const unit of placement.allUnits()) {
            if (unit.team !== team || unit.type.structure || unit.type.extra) continue;
            dispatch({ kind: 'buyLevel', team, unitId: unit.id });
        }

        for (const unit of placement.allUnits()) {
            if (unit.team !== team || !unit.type.structure || unit.type.extra) continue;
            dispatch({ kind: 'upgradeTower', team, unitId: unit.id });
        }
    }
}
