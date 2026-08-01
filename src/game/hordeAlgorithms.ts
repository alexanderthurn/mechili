/**
 * Horde mode presets: match config stores only an id; each algorithm owns
 * which rounds spawn waves (and later bias / conditional pressure) plus the
 * English select-box blurb.
 */

/** Last match round — finale wave when the preset is enabled. */
export const HORDE_FINAL_ROUND = 10;

/** Budget / bias knobs algorithms can read (shared defaults). */
export interface HordeKnobs {
    baseBudget: number;
    budgetPerRound: number;
    finaleBudgetMultiplier: number;
    leaderShare: number;
}

export const DEFAULT_HORDE_KNOBS: HordeKnobs = {
    baseBudget: 300,
    budgetPerRound: 200,
    finaleBudgetMultiplier: 4,
    leaderShare: 0.65,
};

/**
 * Optional runtime context for future conditional algorithms
 * (leader-only pressure, HP gates, etc.).
 */
export interface HordeContext {
    round: number;
    playerHp?: number;
    enemyHp?: number;
}

export abstract class HordeAlgorithm {
    abstract readonly id: string;
    /** Full select-option text (name + what the player gets). */
    abstract describe(): string;
    /** Structurally on — camera widen, neutral strip lock, etc. */
    abstract enabled(): boolean;
    /** Whether this round materializes a wave. */
    abstract shouldSpawn(round: number, ctx?: HordeContext): boolean;

    budget(round: number, knobs: HordeKnobs = DEFAULT_HORDE_KNOBS): number {
        const base = knobs.baseBudget + knobs.budgetPerRound * (round - 1);
        return round === HORDE_FINAL_ROUND ? base * knobs.finaleBudgetMultiplier : base;
    }

    leaderShare(knobs: HordeKnobs = DEFAULT_HORDE_KNOBS): number {
        return knobs.leaderShare;
    }
}

class OffHorde extends HordeAlgorithm {
    readonly id = 'off';
    describe(): string {
        return 'Off — no forest waves';
    }
    enabled(): boolean {
        return false;
    }
    shouldSpawn(): boolean {
        return false;
    }
}

/** Finale only. */
class LowHorde extends HordeAlgorithm {
    readonly id = 'low';
    describe(): string {
        return `Low — finale only (round ${HORDE_FINAL_ROUND}, boosted)`;
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(round: number): boolean {
        return round === HORDE_FINAL_ROUND;
    }
}

/** Mid check + finale. */
class MediumHorde extends HordeAlgorithm {
    readonly id = 'medium';
    describe(): string {
        return `Medium — waves on rounds 5 and ${HORDE_FINAL_ROUND}`;
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(round: number): boolean {
        return round === 5 || round === HORDE_FINAL_ROUND;
    }
}

/** Frequent pressure. */
class HighHorde extends HordeAlgorithm {
    readonly id = 'high';
    describe(): string {
        return `High — waves on rounds 3, 5, 7, and ${HORDE_FINAL_ROUND}`;
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(round: number): boolean {
        return round === 3 || round === 5 || round === 7 || round === HORDE_FINAL_ROUND;
    }
}

/** Every round. */
class UltraHorde extends HordeAlgorithm {
    readonly id = 'ultra';
    describe(): string {
        return `Ultra — a wave every round (1–${HORDE_FINAL_ROUND})`;
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(_round: number): boolean {
        return true;
    }
}

export const DEFAULT_HORDE_PRESET_ID = 'off';

export const HORDE_ALGORITHMS: readonly HordeAlgorithm[] = [
    new OffHorde(),
    new LowHorde(),
    new MediumHorde(),
    new HighHorde(),
    new UltraHorde(),
];

export function hordeAlgorithmById(id: string | undefined | null): HordeAlgorithm {
    const found = HORDE_ALGORITHMS.find((a) => a.id === id);
    return found ?? HORDE_ALGORITHMS.find((a) => a.id === DEFAULT_HORDE_PRESET_ID)!;
}
