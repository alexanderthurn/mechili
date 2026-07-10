import { STANDARD_MAP, type MapSize } from './map';
import type { Team, UnitType } from './units';

/**
 * Everything that defines a match, as one plain JSON-serializable object —
 * so different game modes are just different settings, and multiplayer can
 * pass them around (lobby, server list, replay header).
 */
export interface GameSettings {
    map: MapSize;
    /** phase lengths in seconds */
    buildTimeSeconds: number;
    battleTimeSeconds: number;
    /** each player's hit points; surviving enemy units bite into these after every battle */
    startingHp: number;
    economy: EconomySettings;
    towers: TowerSettings;
    leveling: LevelingSettings;
    /**
     * Seeds all match randomness (enemy AI decisions). A replay of the same
     * actions with the same seed reproduces the game exactly. Unset = the
     * game rolls one at startup.
     */
    seed?: number;
}

export interface LevelingSettings {
    /**
     * Each level ADDS this fraction of the base hp/damage: 1 means a
     * 40 hp / 8 dmg unit has 80/16 at level 2, 120/24 at level 3, ...
     */
    statBonusPerLevel: number;
    /** xp needed for the next level = pack cost × this × current level */
    xpThresholdFactor: number;
    maxLevel: number;
    /** buying one level costs pack base cost × this (leveling is a purchase, never automatic) */
    levelCostFactor: number;
    /** price of the once-per-round "recruits arrive at level 2" switch */
    recruitLevel2Cost: number;
}

export interface TowerSettings {
    /**
     * Towers are buffs, not score: each destroyed OWN tower applies these
     * multipliers to all of that side's units, stacking multiplicatively,
     * for the rest of the battle it fell in (towers rebuild between rounds).
     */
    debuffPerLostTower: {
        speedMult: number;
        attackMult: number;
        damageTakenMult: number;
    };
}

export interface EconomySettings {
    /** income granted in round 1 */
    startingSupply: number;
    /** how much the round income GROWS each round: round N grants startingSupply + (N-1) * growth */
    supplyGrowthPerRound: number;
    /** cost per unit type id; a type missing here falls back to its built-in cost */
    unitCosts: Record<string, number>;
}

export const DEFAULT_SETTINGS: GameSettings = {
    map: STANDARD_MAP,
    buildTimeSeconds: 90,
    battleTimeSeconds: 90,
    startingHp: 2000,
    economy: {
        startingSupply: 200,
        supplyGrowthPerRound: 200,
        unitCosts: {
            crawler: 100,
            marksman: 100,
            wasp: 100,
            fortress: 400,
        },
    },
    towers: {
        debuffPerLostTower: {
            speedMult: 0.6,
            attackMult: 0.7,
            damageTakenMult: 1.3,
        },
    },
    leveling: {
        statBonusPerLevel: 1,
        xpThresholdFactor: 1,
        maxLevel: 9,
        levelCostFactor: 0.5,
        recruitLevel2Cost: 100,
    },
};

/** Both players' supply balances, driven by an {@link EconomySettings}. */
export class Economy {
    private readonly balances: Record<Team, number> = { player: 0, enemy: 0 };

    constructor(private readonly settings: EconomySettings) {}

    costOf(type: UnitType): number {
        return this.settings.unitCosts[type.id] ?? type.cost;
    }

    balance(team: Team): number {
        return this.balances[team];
    }

    /** escalating income: round 1 grants 200, round 2 grants 400, round 3 grants 600, ... */
    grantRoundIncome(round: number): void {
        const income =
            this.settings.startingSupply + (round - 1) * this.settings.supplyGrowthPerRound;
        this.balances.player += income;
        this.balances.enemy += income;
    }

    canAfford(team: Team, type: UnitType): boolean {
        return this.balances[team] >= this.costOf(type);
    }

    /** deducts the cost; returns false (and deducts nothing) when unaffordable */
    charge(team: Team, type: UnitType): boolean {
        return this.spend(team, this.costOf(type));
    }

    /** deducts an arbitrary amount (tech, items, ...) if affordable */
    spend(team: Team, amount: number): boolean {
        if (this.balances[team] < amount) return false;
        this.balances[team] -= amount;
        return true;
    }

    /** pays an amount back (action undo refunds) */
    credit(team: Team, amount: number): void {
        this.balances[team] += amount;
    }
}
