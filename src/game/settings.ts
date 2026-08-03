import { STANDARD_MAP, type MapSize } from './map';
import { DISPLAY } from './displayNames';
import {
    DEFAULT_ROUND_CARD_PRESET_ID,
    ROUND_CARD_ALGORITHMS,
    roundCardAlgorithmById,
} from './roundCardAlgorithms';
import {
    DEFAULT_HORDE_PRESET_ID,
    HORDE_ALGORITHMS,
    HORDE_FINAL_ROUND,
    hordeAlgorithmById,
} from './hordeAlgorithms';

export { HORDE_FINAL_ROUND, DEFAULT_HORDE_PRESET_ID, HORDE_ALGORITHMS, hordeAlgorithmById } from './hordeAlgorithms';
export type { HordeContext, HordeAlgorithm } from './hordeAlgorithms';
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
 *
 * Catalog data (unit cost/hp, card pools, horde budgets) lives on the
 * entity / algorithm — this object only picks modes and match-wide knobs.
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
     * Horde algorithm id (see {@link HORDE_ALGORITHMS}).
     * Owns rounds, budget, and leader bias.
     */
    hordePreset: string;
    /**
     * the match roster (seats on sides). Unset = classic 1v1 (two implicit
     * seats). Local modes only for now — never sent over the wire.
     */
    seats?: SeatDef[];
    /**
     * Between-round card algorithm id (see {@link ROUND_CARD_ALGORITHMS}).
     * Owns schedule + pool progression.
     */
    roundCardPreset: string;
}

/** Whether horde mode is structurally active (camera widen, waves possible). */
export function hordeEnabled(settings: GameSettings): boolean {
    return hordeAlgorithmById(settings.hordePreset).enabled();
}

/** whether this round spawns a horde wave */
export function isHordeRoundActive(settings: GameSettings, round: number): boolean {
    return hordeAlgorithmById(settings.hordePreset).shouldSpawn(round);
}

/** this round's wave budget — caller should have checked {@link isHordeRoundActive} */
export function hordeBudgetForRound(settings: GameSettings, round: number): number {
    return hordeAlgorithmById(settings.hordePreset).budget(round);
}

/** leader-hunt spawn share for the active preset */
export function hordeLeaderShare(settings: GameSettings): number {
    return hordeAlgorithmById(settings.hordePreset).leaderShare();
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
     * Towers are debuffs, not score: destroying an ENEMY building does
     * nothing to you; losing your OWN Command Tower or Research Center
     * applies these multipliers to YOUR SEAT's units only (never a
     * teammate's) while the debuff timer runs. Flat effect — it doesn't
     * matter how many of a seat's own buildings are down at once, or how
     * many seats a side has; only the DURATION stacks (see debuffDuration).
     * Stronghold destruction currently triggers no debuff at all (a
     * separate penalty for it is still TBD).
     */
    debuffPerLostTower: {
        speedMult: number;
        attackMult: number;
        damageTakenMult: number;
    };
    /**
     * How long a tower loss debuffs its seat. Level 1 lasts baseSeconds; each
     * level above 1 subtracts stepSeconds (level 2 → 8s, level 3 → 6s, …). If
     * another building falls (from the SAME seat) during an active debuff,
     * its own full duration is added on top — unchanged regardless of team
     * size, since the debuff is scoped per seat now, not per side.
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

/** how many unit / base-rune purchases a deployment phase allows */
export interface DeploySettings {
    /** each player's STARTING per-round buy limit (specials may raise it permanently later) */
    unitsPerRound: number;
    /** shop price of a base rune (earth/fire/water/wind); shares the buy limit with units */
    baseRuneCost: number;
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
    /** every owned tech of a unit type raises the price of its remaining techs by this */
    techCostEscalation: number;
}

/** Custom Game pace presets — edit this list to change the select options. */
export interface CustomGamePacePreset {
    id: string;
    label: string;
    buildSeconds: number;
    battleSeconds: number;
    specialistSeconds: number;
    cardSeconds: number;
}

export const CUSTOM_GAME_PACE_PRESETS: readonly CustomGamePacePreset[] = [
    { id: 'blitz', label: 'Blitz', buildSeconds: 30, battleSeconds: 90, specialistSeconds: 10, cardSeconds: 5 },
    { id: 'quick', label: 'Quick', buildSeconds: 60, battleSeconds: 90, specialistSeconds: 10, cardSeconds: 10 },
    { id: 'standard', label: 'Standard', buildSeconds: 90, battleSeconds: 90, specialistSeconds: 15, cardSeconds: 15 },
    { id: 'relaxed', label: 'Relaxed', buildSeconds: 180, battleSeconds: 90, specialistSeconds: 180, cardSeconds: 180 },
    { id: 'long', label: 'Long', buildSeconds: 9999, battleSeconds: 90, specialistSeconds: 9999, cardSeconds: 9999 },
];

export const DEFAULT_CUSTOM_GAME_PACE_ID = 'standard';

export function customGamePaceById(id: string | undefined | null): CustomGamePacePreset {
    const found = CUSTOM_GAME_PACE_PRESETS.find((p) => p.id === id);
    return found ?? CUSTOM_GAME_PACE_PRESETS.find((p) => p.id === DEFAULT_CUSTOM_GAME_PACE_ID)!;
}

/** Select-option text: name plus the four timings from the preset. */
export function formatCustomGamePaceOption(p: CustomGamePacePreset): string {
    return `${p.label} — Deploy ${p.buildSeconds}s · Battle ${p.battleSeconds}s · ${DISPLAY.commander} ${p.specialistSeconds}s · Cards ${p.cardSeconds}s`;
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
        baseRuneCost: 50,
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
    hordePreset: DEFAULT_HORDE_PRESET_ID,
    roundCardPreset: DEFAULT_ROUND_CARD_PRESET_ID,
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
    return roundCardAlgorithmById(settings.roundCardPreset).shouldOffer(round);
}

/** Older saves/replays/URL knobs that normalize maps into presets. */
type LegacyGameSettings = GameSettings & {
    roundCards?: boolean | number[];
    roundCardItems?: string[];
    roundCardOfferCount?: number;
    horde?: { factor?: string | number[] };
};

/** fills in settings added after older saves/replays were recorded */
export function normalizeGameSettings(settings: GameSettings): GameSettings {
    const legacy = settings as LegacyGameSettings;
    const towers = settings.towers ?? DEFAULT_SETTINGS.towers;
    const {
        roundCards: _rc,
        roundCardItems: _ri,
        roundCardOfferCount: _ro,
        horde: _h,
        ...rest
    } = legacy;
    return {
        ...DEFAULT_SETTINGS,
        ...rest,
        economy: {
            ...DEFAULT_SETTINGS.economy,
            ...settings.economy,
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
        roundCardPreset: resolveRoundCardPreset(legacy),
        hordePreset: resolveHordePreset(legacy),
    };
}

function resolveHordePreset(settings: LegacyGameSettings): string {
    const known = HORDE_ALGORITHMS.find((a) => a.id === settings.hordePreset);
    if (known) return known.id;
    const factor = settings.horde?.factor;
    if (typeof factor === 'string' && HORDE_ALGORITHMS.some((a) => a.id === factor)) return factor;
    // custom round lists → closest named preset (high covers sparse mid-game lists)
    if (Array.isArray(factor) && factor.length > 0) return 'high';
    return DEFAULT_HORDE_PRESET_ID;
}

function resolveRoundCardPreset(settings: LegacyGameSettings): string {
    const known = ROUND_CARD_ALGORITHMS.find((a) => a.id === settings.roundCardPreset);
    if (known) return known.id;
    const schedule = settings.roundCards;
    if (schedule === true) return 'runes-every';
    if (Array.isArray(schedule) && schedule.length > 0) {
        const evenSpare = [2, 4, 6, 8, 10];
        const matchesSpare =
            schedule.length === evenSpare.length && evenSpare.every((r) => schedule.includes(r));
        return matchesSpare ? 'runes-spare' : 'runes-every';
    }
    return DEFAULT_ROUND_CARD_PRESET_ID;
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
        return type.cost;
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
 * settings panel (click the supply counter) render from.
 */
export function describeGameSettings(settings: GameSettings): SettingGroup[] {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const hordeRows: SettingRow[] = [];
    if (!hordeEnabled(settings)) {
        hordeRows.push({ label: 'Status', value: 'Off' });
    } else {
        const activeRounds: number[] = [];
        for (let r = 1; r <= HORDE_FINAL_ROUND; r++) {
            if (isHordeRoundActive(settings, r)) activeRounds.push(r);
        }
        hordeRows.push({
            label: 'Preset',
            value: hordeAlgorithmById(settings.hordePreset).describe(),
            note: `waves on round ${activeRounds.join(', ')}`,
        });
    }

    return [
        {
            title: 'Timers & HP',
            rows: [
                { label: 'Deployment phase', value: fmtTimer(settings.buildTimeSeconds) },
                { label: 'Battle phase', value: fmtTimer(settings.battleTimeSeconds) },
                { label: `${DISPLAY.commander} pick`, value: fmtTimer(settings.specialistTimeSeconds) },
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
                    label: 'Preset',
                    value: roundCardAlgorithmById(settings.roundCardPreset).describe(),
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
                { label: 'Buys per round', value: `${settings.deploy.unitsPerRound}`, note: 'shared by units and base runes' },
                {
                    label: 'Base rune',
                    value: `${settings.deploy.baseRuneCost} supply`,
                    note: 'shop — uses one buy slot',
                },
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
