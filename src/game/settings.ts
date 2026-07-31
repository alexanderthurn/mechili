import { STANDARD_MAP, type MapSize } from './map';
import { DISPLAY } from './displayNames';
import type { UnitType } from './units';
import type { SeatDef, SeatId } from './seats';

/**
 * Phase length in seconds: a constant, or a per-round schedule
 * (round 1 → index 0, round 2 → index 1, …; last entry repeats).
 */
export type RoundTimer = number | number[];

/**
 * Everything that defines a match, as one plain JSON-serializable object —
 * so different game modes are just different settings, and multiplayer can
 * pass them around (lobby, server list, replay header).
 */
export interface GameSettings {
    map: MapSize;
    /** deployment / build-phase length */
    buildTimeSeconds: RoundTimer;
    /** battle / attacking-phase length */
    battleTimeSeconds: RoundTimer;
    /** seconds to choose the specialist card; on expiry one is auto-picked */
    specialistTimeSeconds: RoundTimer;
    /** between-round card pick length (before the deploy clock starts) */
    cardTimeSeconds: RoundTimer;
    /** each player's hit points; surviving enemy units bite into these after every battle */
    startingHp: number;
    economy: EconomySettings;
    towers: TowerSettings;
    leveling: LevelingSettings;
    sell: SellSettings;
    rallyRoute: RallyRouteSettings;
    deploy: DeploySettings;
    boosts: BoostSettings;
    /**
     * Seeds all match randomness (enemy AI decisions). A replay of the same
     * actions with the same seed reproduces the game exactly. Unset = the
     * game rolls one at startup.
     */
    seed?: number;
    /**
     * horde PvPvE mode: a neutral dwarf horde spawns from a ring in the
     * surrounding forest and marches inward, hostile to both players.
     * Unset, or `factor: 'off'`, both mean off — see {@link hordeEnabled}.
     */
    horde?: HordeSettings;
    /**
     * the match roster (seats on sides). Unset = classic 1v1 (two implicit
     * seats). Local modes only for now — never sent over the wire.
     */
    seats?: SeatDef[];
    /**
     * Between-round card offers (not the round-0 specialist pick).
     * - `false` — never (current default)
     * - `true`  — every round ≥ 2
     * - number[] — only those rounds, e.g. `[3, 6, 9]`
     * Custom games can override this later.
     */
    roundCards: boolean | number[];
}

/**
 * Which rounds spawn a horde wave, shaped exactly like {@link GameSettings.roundCards}
 * (`boolean | number[]`) rather than a hand-built per-level table:
 * - `'off'` — horde mode disabled entirely (no waves at all, not even the finale).
 * - `'low' | 'medium' | 'high'` — shorthand for a canonical round list (see
 *   `HORDE_FACTOR_PRESET_ROUNDS`).
 * - `'ultra'` — every round gets a wave.
 * - `number[]` — an explicit round list, bypassing presets entirely (like
 *   `roundCards: [3, 6, 9]` today).
 * The final round (`HORDE_FINAL_ROUND`) always spawns a wave whenever the
 * factor isn't `'off'`, regardless of which preset/array is chosen — see
 * `isHordeRoundActive`.
 */
export type HordeFactor = 'off' | 'low' | 'medium' | 'high' | 'ultra' | number[];

export interface HordeSettings {
    /** which rounds spawn a wave — see {@link HordeFactor} */
    factor: HordeFactor;
    /** supply value of round 1's wave (spent entirely on dwarf packs) */
    baseBudget: number;
    /** extra supply value added to the wave each active round after the first */
    budgetPerRound: number;
    /**
     * flat multiplier applied to the final round's budget on top of the
     * normal growth formula — deliberately just "bigger" for now; the one
     * lever to make the finale feel overwhelming without a separate
     * special-cased mechanic.
     */
    finaleBudgetMultiplier: number;
    /**
     * share of the wave that hunts the match-HP leader (spawns biased to the
     * leader's half of the spawn ring); the rest spawns near the weaker
     * player's half. On equal HP the wave has no bias.
     */
    leaderShare: number;
}

/** the last round of the match — the horde's wave here always fires,
 *  boosted by `finaleBudgetMultiplier`, regardless of `factor` */
export const HORDE_FINAL_ROUND = 10;

const HORDE_FACTOR_PRESET_ROUNDS: Record<'low' | 'medium' | 'high', number[]> = {
    low: [HORDE_FINAL_ROUND],
    medium: [5, HORDE_FINAL_ROUND],
    high: [3, 5, 7, HORDE_FINAL_ROUND],
};

/**
 * Whether horde mode is structurally active at all (any round ever spawns a
 * wave) — `undefined` (settings built without horde at all, e.g. replays
 * older than this feature) and an explicit `factor: 'off'` (the one on/off
 * lever, `?hordeFactor=off`) both count as "not active" here, so anything
 * gated on horde mode being on — not just whether a wave spawns this round,
 * but things like the neutral-strip lock and the wider horde-mode camera
 * bounds too — treats them identically.
 */
export function hordeEnabled(horde: HordeSettings | undefined): horde is HordeSettings {
    return !!horde && horde.factor !== 'off';
}

/** whether this round spawns a horde wave — mirrors `shouldOfferRoundCards`'s shape */
export function isHordeRoundActive(horde: HordeSettings | undefined, round: number): boolean {
    if (!hordeEnabled(horde)) return false;
    if (round === HORDE_FINAL_ROUND) return true;
    const { factor } = horde;
    if (factor === 'off') return false; // narrows the preset-lookup below; hordeEnabled already excluded this
    if (factor === 'ultra') return true;
    if (Array.isArray(factor)) return factor.includes(round);
    return HORDE_FACTOR_PRESET_ROUNDS[factor].includes(round);
}

/** this round's wave budget — existing linear growth, times the finale
 *  multiplier on the last round. Caller is expected to have already
 *  checked `isHordeRoundActive`. */
export function hordeBudgetForRound(horde: HordeSettings, round: number): number {
    const base = horde.baseBudget + horde.budgetPerRound * (round - 1);
    return round === HORDE_FINAL_ROUND ? base * horde.finaleBudgetMultiplier : base;
}

export const DEFAULT_HORDE: HordeSettings = {
    factor: 'medium',
    baseBudget: 300,
    budgetPerRound: 200,
    finaleBudgetMultiplier: 4,
    leaderShare: 0.65,
};

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
 * Research Center: permanent army-wide stat boosts, one tier bought after the
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
    /** Command Tower: price of +1 buy for the running round only */
    extraSlotCost: number;
    /** Command Tower: +rangeBoost range for all ranged units this round only */
    rangedRangeBoostCost: number;
    rangeBoost: number;
    /** Command Tower: +speedBoost speed for all units this round only */
    armySpeedBoostCost: number;
    speedBoost: number;
    /** Command Tower: Credit — gain this much supply now (once per round) */
    creditGain: number;
    /** Command Tower: Credit — repay this much at the start of the next deployment */
    creditDebt: number;
    /** board extras (shields, rockets) have their own cap: supply spent on them per round */
    extrasBudgetPerRound: number;
    /** first-time flank mech deploys spawn for this many seconds (whenever flanks are open) */
    flankSpawnSeconds: number;
}

/** the sell ability: bought ONCE at the Research Center, then permanent */
export interface SellSettings {
    abilityCost: number;
    /** units sellable per deployment phase once owned */
    maxPerRound: number;
    /** refund = unit base cost × this */
    refundFactor: number;
}

/** Research Center: one-time purchase of a single rally-route charge */
export interface RallyRouteSettings {
    abilityCost: number;
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
    specialistTimeSeconds: 15,
    cardTimeSeconds: 15,
    startingHp: 2000,
    economy: {
        startingSupply: 200,
        supplyGrowthPerRound: 200,
        unitCosts: {
            dwarf: 100,
            archer: 100,
            crowRider: 200,
            ballista: 400,
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
    rallyRoute: {
        abilityCost: 100,
    },
    deploy: {
        unitsPerRound: 2,
        extraSlotCost: 50,
        rangedRangeBoostCost: 100,
        rangeBoost: 5,
        armySpeedBoostCost: 50,
        speedBoost: 3,
        creditGain: 200,
        creditDebt: 300,
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
    roundCards: true,
};

/** resolve a constant or per-round timer for the given round (round 1 → index 0) */
export function secondsForRound(timer: RoundTimer, round: number): number {
    if (typeof timer === 'number') return timer;
    if (timer.length === 0) return 0;
    const i = Math.max(0, round - 1);
    return timer[Math.min(i, timer.length - 1)]!;
}

/** whether this build-phase round should open a between-round card offer */
export function shouldOfferRoundCards(settings: GameSettings, round: number): boolean {
    const schedule = settings.roundCards;
    if (schedule === false) return false;
    if (Array.isArray(schedule)) return schedule.includes(round);
    return round >= 2;
}

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
        rallyRoute: { ...DEFAULT_SETTINGS.rallyRoute, ...settings.rallyRoute },
        deploy: { ...DEFAULT_SETTINGS.deploy, ...settings.deploy },
        boosts: { ...DEFAULT_SETTINGS.boosts, ...settings.boosts },
        leveling: { ...DEFAULT_SETTINGS.leveling, ...settings.leveling },
    };
}

/**
 * Every seat's supply balance, driven by an {@link EconomySettings}.
 * Keyed by SeatId — in classic 1v1 that's seat 0 (player) and seat 1
 * (enemy); in duo modes each of the four commanders has their own purse.
 */
export class Economy {
    private readonly balances: number[];

    constructor(
        private readonly settings: EconomySettings,
        seatCount = 2,
    ) {
        this.balances = new Array(seatCount).fill(0);
    }

    get seatCount(): number {
        return this.balances.length;
    }

    costOf(type: UnitType): number {
        return this.settings.unitCosts[type.id] ?? type.cost;
    }

    /** a tech's current price: base + escalation per tech already owned for the type */
    techCostOf(tech: { cost: number }, ownedCountForType: number): number {
        return tech.cost + ownedCountForType * this.settings.techCostEscalation;
    }

    balance(seat: SeatId): number {
        return this.balances[seat] ?? 0;
    }

    /** escalating income: round 1 grants 200, round 2 grants 400, ... — every seat, full share */
    grantRoundIncome(round: number): void {
        const income =
            this.settings.startingSupply + (round - 1) * this.settings.supplyGrowthPerRound;
        for (let s = 0; s < this.balances.length; s++) this.balances[s]! += income;
    }

    canAfford(seat: SeatId, type: UnitType): boolean {
        return this.balance(seat) >= this.costOf(type);
    }

    /** deducts the cost; returns false (and deducts nothing) when unaffordable */
    charge(seat: SeatId, type: UnitType): boolean {
        return this.spend(seat, this.costOf(type));
    }

    /** deducts an arbitrary amount (tech, items, ...) if affordable */
    spend(seat: SeatId, amount: number): boolean {
        if (this.balance(seat) < amount) return false;
        this.balances[seat]! -= amount;
        return true;
    }

    /** pays an amount back (action undo refunds) */
    credit(seat: SeatId, amount: number): void {
        this.balances[seat] = this.balance(seat) + amount;
    }

    /** always deducts (Credit debt); may leave a negative balance */
    debit(seat: SeatId, amount: number): void {
        this.balances[seat] = this.balance(seat) - amount;
    }
}

export interface SettingRow {
    label: string;
    value: string;
    note?: string;
}
export interface SettingGroup {
    title: string;
    rows: SettingRow[];
}

function fmtTimer(t: RoundTimer): string {
    return typeof t === 'number' ? `${t}s` : t.map((v) => `${v}s`).join('/');
}

/**
 * Human-readable reference tables for a GameSettings object — the single
 * source both the homepage's "Match settings" section and the in-game
 * settings panel (click the supply counter) render from, so there's exactly
 * one place turning raw settings numbers into labeled rows. Describes the
 * SETTINGS PASSED IN, not just the defaults — the horde group in particular
 * reflects whatever factor is actually active for this match (including a
 * custom round list or `?hordeFactor=` override), not a hardcoded "Medium".
 */
export function describeGameSettings(settings: GameSettings): SettingGroup[] {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const horde = settings.horde;
    const hordeRows: SettingRow[] = [];
    if (!hordeEnabled(horde)) {
        hordeRows.push({ label: 'Status', value: 'Off' });
    } else {
        const activeRounds: number[] = [];
        for (let r = 1; r <= HORDE_FINAL_ROUND; r++) {
            if (isHordeRoundActive(horde, r)) activeRounds.push(r);
        }
        hordeRows.push(
            {
                label: 'Active rounds',
                value: Array.isArray(horde.factor) ? 'Custom' : horde.factor,
                note: `waves on round ${activeRounds.join(', ')}`,
            },
            { label: 'Round 1 wave value', value: `${horde.baseBudget} supply` },
            { label: 'Growth per active round', value: `+${horde.budgetPerRound} supply` },
            {
                label: 'Final round multiplier',
                value: `${horde.finaleBudgetMultiplier}×`,
                note: `round ${HORDE_FINAL_ROUND} always fires, boosted, no matter the level`,
            },
            {
                label: 'Leader bias',
                value: pct(horde.leaderShare),
                note: 'share of the wave aimed at whoever is currently ahead on HP',
            },
        );
    }

    return [
        {
            title: 'Timers & HP',
            rows: [
                { label: 'Deployment phase', value: fmtTimer(settings.buildTimeSeconds) },
                { label: 'Battle phase', value: fmtTimer(settings.battleTimeSeconds) },
                { label: 'Specialist pick', value: fmtTimer(settings.specialistTimeSeconds) },
                { label: 'Round card pick', value: fmtTimer(settings.cardTimeSeconds) },
                { label: 'Starting HP', value: `${settings.startingHp}` },
            ],
        },
        {
            title: 'Economy',
            rows: [
                { label: 'Round 1 income', value: `${settings.economy.startingSupply} supply` },
                {
                    label: 'Income growth',
                    value: `+${settings.economy.supplyGrowthPerRound}/round`,
                    note: 'round N grants startingSupply + (N-1) × growth',
                },
                {
                    label: `${DISPLAY.tech} cost escalation`,
                    value: `+${settings.economy.techCostEscalation}`,
                    note: `added to a ${DISPLAY.tech.toLowerCase()}’s price per ${DISPLAY.tech.toLowerCase()} already owned of that unit type`,
                },
            ],
        },
        {
            title: 'Round cards',
            rows: [
                {
                    label: 'Schedule',
                    value:
                        settings.roundCards === false ? 'Off' : settings.roundCards === true ? 'On' : 'Custom',
                    note: Array.isArray(settings.roundCards)
                        ? `rounds ${settings.roundCards.join(', ')}`
                        : 'from round 2 onward when on',
                },
            ],
        },
        { title: 'Horde mode', rows: hordeRows },
        {
            title: 'Towers',
            rows: [
                {
                    label: 'Per lost tower',
                    value: `×${settings.towers.debuffPerLostTower.speedMult} speed, ×${settings.towers.debuffPerLostTower.attackMult} attack, ×${settings.towers.debuffPerLostTower.damageTakenMult} damage taken`,
                    note: 'applies to that side’s units only, stacking multiplicatively, while the debuff runs',
                },
                {
                    label: 'Debuff duration',
                    value: `${settings.towers.debuffDuration.baseSeconds}s at level 1`,
                    note: `−${settings.towers.debuffDuration.stepSeconds}s per level above 1; a new tower loss adds its duration on top`,
                },
                {
                    label: 'Upgrade cost',
                    value: `${settings.towers.upgrade.baseCost} supply, +${settings.towers.upgrade.costStep}/level`,
                    note: `up to level ${settings.towers.upgrade.maxLevel}`,
                },
            ],
        },
        {
            title: 'Deploy',
            rows: [
                { label: 'Buys per round', value: `${settings.deploy.unitsPerRound}` },
                {
                    label: 'Extra buy slot',
                    value: `${settings.deploy.extraSlotCost} supply`,
                    note: 'Garrison — this round only',
                },
                {
                    label: 'Ranged range boost',
                    value: `${settings.deploy.rangedRangeBoostCost} supply → +${settings.deploy.rangeBoost} range`,
                    note: 'Garrison — all ranged units, this round only',
                },
                {
                    label: 'Army speed boost',
                    value: `${settings.deploy.armySpeedBoostCost} supply → +${settings.deploy.speedBoost} speed`,
                    note: 'Garrison — whole army, this round only',
                },
                {
                    label: 'Loan',
                    value: `+${settings.deploy.creditGain} now, −${settings.deploy.creditDebt} next round`,
                    note: 'Garrison — once per round',
                },
                {
                    label: 'Extras budget',
                    value: `${settings.deploy.extrasBudgetPerRound} supply/round`,
                    note: 'shields, rockets',
                },
                {
                    label: 'Flank grace',
                    value: `${settings.deploy.flankSpawnSeconds}s`,
                    note: 'first flank deploys once flanks open',
                },
            ],
        },
        {
            title: 'Leveling',
            rows: [
                { label: 'Stat bonus per level', value: `+${pct(settings.leveling.statBonusPerLevel)} hp/damage` },
                { label: 'Max level', value: `${settings.leveling.maxLevel}` },
                {
                    label: 'Level cost',
                    value: `${pct(settings.leveling.levelCostFactor)} of pack cost`,
                    note: 'leveling is a purchase, never automatic',
                },
                {
                    label: 'Recruit at level 2',
                    value: `${settings.leveling.recruitLevel2Cost} supply`,
                    note: 'once-per-round switch — new recruits arrive pre-leveled',
                },
            ],
        },
        {
            title: 'Sell',
            rows: [
                {
                    label: 'Ability cost',
                    value: `${settings.sell.abilityCost} supply, one-time`,
                    note: 'Vanguard — once bought, permanent',
                },
                { label: 'Sells per round', value: `${settings.sell.maxPerRound}` },
                { label: 'Refund', value: pct(settings.sell.refundFactor), note: 'of the unit’s base cost' },
            ],
        },
        {
            title: 'Rally Route',
            rows: [
                {
                    label: 'Ability cost',
                    value: `${settings.rallyRoute.abilityCost} supply, one-time`,
                    note: `Vanguard — grants one rally-route ${DISPLAY.tactic.toLowerCase()} charge`,
                },
                {
                    label: 'Boosts',
                    value: 'Army-wide stat tiers',
                },
            ],
        },
        {
            title: 'Boosts',
            rows: settings.boosts.costs.map((cost, i) => ({
                label: `Tier ${i + 1}`,
                value: `${cost} supply → +${pct(settings.boosts.attackTiers[i]!)} damage, +${pct(settings.boosts.hpTiers[i]!)} hp`,
                note: 'Vanguard — totals, not stacked on top of the previous tier',
            })),
        },
    ];
}
