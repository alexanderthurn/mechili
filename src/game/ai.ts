import type { Action } from './actions';
import type { RoundCard, StartCard } from './cards';
import { SHOP_UNIT_IDS, unitUnlockCost } from './cards';
import type { PlacementController } from './placement';
import type { Economy } from './settings';
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
        // (it has no use for items yet)
        const candidates = offer.filter(
            (c) => c.units && this.ctx.economy.balance(this.team) >= c.cost,
        );
        const pick = candidates.length > 0 && this.ctx.rng() < 0.75 ? candidates[0]! : null;
        this.ctx.dispatch({ kind: 'roundCard', team: this.team, cardId: pick?.id ?? null });
    }

    onBuildPhase(_round: number): void {
        const { dispatch, placement, economy, techTree, rng, unlockedUnits, unlockUsedThisRound } =
            this.ctx;
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

        // 1) fill every deploy slot first (buy fails when slots or supply run out)
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

        // rearrange fresh deployments (starting army included in round 1) —
        // moves stay invisible to the player until lock-in via intel snapshot
        for (const unit of placement.allUnits()) {
            if (unit.team !== this.team || !placement.canReposition(unit)) continue;
            if (rng() < 0.3) continue; // some stay where they are
            const spot = placement.findEnemySpot(unit.type, rng);
            if (!spot) continue;
            if (spot.rotated !== unit.rotated) {
                dispatch({ kind: 'rotate', team: this.team, unitId: unit.id });
            }
            dispatch({ kind: 'move', team: this.team, unitId: unit.id, anchor: spot.anchor });
        }

        // 2) leftover supply → upgrades (techs, then pack levels, then towers)
        this.spendOnUpgrades();

        // done for the round — the battle waits for both sides' lock-in
        dispatch({ kind: 'endDeployment', team: this.team });
    }

    /** spend remaining supply on techs / levels / tower upgrades while affordable */
    private spendOnUpgrades(): void {
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

        // techs for types we actually field — keep buying while anything is affordable
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

        // pack levels when XP is banked
        for (const unit of placement.allUnits()) {
            if (unit.team !== team || unit.type.structure || unit.type.extra) continue;
            dispatch({ kind: 'buyLevel', team, unitId: unit.id });
        }

        // base building levels
        for (const unit of placement.allUnits()) {
            if (unit.team !== team || !unit.type.structure || unit.type.extra) continue;
            dispatch({ kind: 'upgradeTower', team, unitId: unit.id });
        }
    }
}
