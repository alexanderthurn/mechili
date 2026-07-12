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
    sell: SellSettings;
    deploy: DeploySettings;
    boosts: BoostSettings;
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
     * Towers are debuffs, not score: destroying an ENEMY tower does nothing to
     * you; each of YOUR OWN towers that falls applies these multipliers to all
     * of that side's units, stacking multiplicatively, while the debuff timer
     * runs (duration depends on the fallen tower's level).
     */
    debuffPerLostTower: {
        speedMult: number;
        attackMult: number;
        damageTakenMult: number;
    };
    /**
     * How long a tower loss debuffs its side. Level 1 lasts baseSeconds; each
     * level above 1 subtracts stepSeconds (level 2 → 8s, level 3 → 6s, …).
     * If another tower falls during an active debuff, the new duration is added.
     */
    debuffDuration: {
        baseSeconds: number;
        stepSeconds: number;
    };
    /**
     * Towers level like units (+base hp per level) but need no XP — just
     * supply, on a rising ladder: baseCost, +costStep per level taken.
     */
    upgrade: {
        baseCost: number;
        costStep: number;
        maxLevel: number;
    };
}

/**
 * Command Tower: permanent army-wide stat boosts, one tier bought after the
 * other on the same button. Tier values are TOTALS (tier 2 replaces tier 1).
 */
export interface BoostSettings {
    /** price of tier 1, tier 2, ... (also defines how many tiers exist) */
    costs: number[];
    /** total damage bonus at each tier (0.1 = +10%) */
    attackTiers: number[];
    /** total hp bonus at each tier */
    hpTiers: number[];
}

/** how many unit purchases a deployment phase allows */
export interface DeploySettings {
    /** each player's STARTING per-round buy limit (specials may raise it permanently later) */
    unitsPerRound: number;
    /** Research Center: price of +1 buy for the running round only */
    extraSlotCost: number;
    /** Research Center: +rangeBoost range for all ranged units this round only */
    rangedRangeBoostCost: number;
    rangeBoost: number;
    /** Research Center: +speedBoost speed for all units this round only */
    armySpeedBoostCost: number;
    speedBoost: number;
    /** board extras (shields, rockets) have their own cap: supply spent on them per round */
    extrasBudgetPerRound: number;
    /** first-time flank mech deploys spawn for this many seconds (whenever flanks are open) */
    flankSpawnSeconds: number;
}

/** the sell ability: bought ONCE at the Command Tower, then permanent */
export interface SellSettings {
    abilityCost: number;
    /** units sellable per deployment phase once owned */
    maxPerRound: number;
    /** refund = unit base cost × this */
    refundFactor: number;
}

export interface EconomySettings {
    /** income granted in round 1 */
    startingSupply: number;
    /** how much the round income GROWS each round: round N grants startingSupply + (N-1) * growth */
    supplyGrowthPerRound: number;
    /** cost per unit type id; a type missing here falls back to its built-in cost */
    unitCosts: Record<string, number>;
    /** every owned tech of a unit type raises the price of its remaining techs by this */
    techCostEscalation: number;
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
            wasp: 200,
            fortress: 400,
            shield: 100,
            rocket: 50,
        },
        techCostEscalation: 200,
    },
    towers: {
        debuffPerLostTower: {
            speedMult: 0.1,
            attackMult: 0.1,
            damageTakenMult: 2.0,
        },
        debuffDuration: {
            baseSeconds: 10,
            stepSeconds: 2,
        },
        upgrade: {
            baseCost: 100, // level 2 costs 100, then 150, 200, 250
            costStep: 50,
            maxLevel: 5,
        },
    },
    sell: {
        abilityCost: 100,
        maxPerRound: 1,
        refundFactor: 1,
    },
    deploy: {
        unitsPerRound: 2,
        extraSlotCost: 50,
        rangedRangeBoostCost: 100,
        rangeBoost: 5,
        armySpeedBoostCost: 50,
        speedBoost: 3,
        extrasBudgetPerRound: 500,
        flankSpawnSeconds: 5,
    },
    boosts: {
        costs: [100, 300],
        attackTiers: [0.1, 0.2],
        hpTiers: [0.15, 0.3],
    },
    leveling: {
        statBonusPerLevel: 1,
        xpThresholdFactor: 1,
        maxLevel: 9,
        levelCostFactor: 0.5,
        recruitLevel2Cost: 100,
    },
};

/** fills in settings added after older saves/replays were recorded */
export function normalizeGameSettings(settings: GameSettings): GameSettings {
    const towers = settings.towers ?? DEFAULT_SETTINGS.towers;
    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        economy: {
            ...DEFAULT_SETTINGS.economy,
            ...settings.economy,
            unitCosts: { ...DEFAULT_SETTINGS.economy.unitCosts, ...settings.economy.unitCosts },
        },
        towers: {
            ...DEFAULT_SETTINGS.towers,
            ...towers,
            debuffPerLostTower: {
                ...DEFAULT_SETTINGS.towers.debuffPerLostTower,
                ...towers.debuffPerLostTower,
            },
            debuffDuration: {
                ...DEFAULT_SETTINGS.towers.debuffDuration,
                ...towers.debuffDuration,
            },
            upgrade: { ...DEFAULT_SETTINGS.towers.upgrade, ...towers.upgrade },
        },
        sell: { ...DEFAULT_SETTINGS.sell, ...settings.sell },
        deploy: { ...DEFAULT_SETTINGS.deploy, ...settings.deploy },
        boosts: { ...DEFAULT_SETTINGS.boosts, ...settings.boosts },
        leveling: { ...DEFAULT_SETTINGS.leveling, ...settings.leveling },
    };
}

/** Both players' supply balances, driven by an {@link EconomySettings}. */
export class Economy {
    private readonly balances: Record<Team, number> = { player: 0, enemy: 0 };

    constructor(private readonly settings: EconomySettings) {}

    costOf(type: UnitType): number {
        return this.settings.unitCosts[type.id] ?? type.cost;
    }

    /** a tech's current price: base + escalation per tech already owned for the type */
    techCostOf(tech: { cost: number }, ownedCountForType: number): number {
        return tech.cost + ownedCountForType * this.settings.techCostEscalation;
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
