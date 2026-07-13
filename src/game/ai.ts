import type { Action } from './actions';
import type { RoundCard, StartCard } from './cards';
import { SHOP_UNIT_IDS, unitUnlockCost } from './cards';
import type { PlacementController } from './placement';
import type { Economy } from './settings';
import type { TechTree } from './tech';
import { UNIT_TYPES, type Team } from './units';

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

    onBuildPhase(round: number): void {
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

        // sometimes tech up before spending the rest on units
        if (round >= 2 && rng() < 0.6) {
            const type = UNIT_TYPES[Math.floor(rng() * UNIT_TYPES.length)]!;
            const unowned = type.techs.filter((t) => !techTree.has(team, type.id, t.id));
            const tech = unowned[Math.floor(rng() * unowned.length)];
            const techCost = tech
                ? economy.techCostOf(tech, techTree.ownedFor(team, type.id).size)
                : 0;
            if (tech && economy.balance(team) >= techCost + 200) {
                dispatch({ kind: 'buyTech', team, typeId: type.id, techId: tech.id });
            }
        }

        // deploy this round's units — invisible to the player until battle
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
            if (!spot) break; // no space left
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

        // done for the round — the battle waits for both sides' lock-in
        dispatch({ kind: 'endDeployment', team: this.team });
    }
}
