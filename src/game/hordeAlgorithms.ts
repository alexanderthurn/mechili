/**
 * Horde mode presets: match config stores only an id; each algorithm owns
 * spawn schedule, income step, and the select-box blurb.
 * Wave *composition* lives in {@link hordeWavePlan} (hordeRoster.ts).
 */

import { t } from '../i18n';

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

    /**
     * The horde's income step: round N pays `income × N` into its purse, which
     * {@link hordeWavePlan} spends on packs that stay for good. The only intensity knob.
     */
    income(): number {
        return 0;
    }

}

class OffHorde extends HordeAlgorithm {
    readonly id = 'off';
    describe(): string {
        return t('settings:hordeOff', { defaultValue: 'Off — no waves' });
    }
    enabled(): boolean {
        return false;
    }
    shouldSpawn(): boolean {
        return false;
    }
}

/** A wave every round; the presets differ only in how fast the horde's income grows. */
class GrowingHorde extends HordeAlgorithm {
    constructor(
        readonly id: string,
        private readonly step: number,
        private readonly label: () => string,
    ) {
        super();
    }
    describe(): string {
        return this.label();
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(_round: number): boolean {
        return true;
    }
    income(): number {
        return this.step;
    }
}

export const DEFAULT_HORDE_PRESET_ID = 'off';

export const HORDE_ALGORITHMS: readonly HordeAlgorithm[] = [
    new OffHorde(),
    new GrowingHorde('low', 100, () => t('settings:hordeLow', { income: 100, defaultValue: 'Low — income +100 every round' })),
    new GrowingHorde('medium', 200, () => t('settings:hordeMedium', { income: 200, defaultValue: 'Medium — income +200 every round' })),
    new GrowingHorde('high', 300, () => t('settings:hordeHigh', { income: 300, defaultValue: 'High — income +300 every round' })),
    new GrowingHorde('ultra', 400, () => t('settings:hordeUltra', { income: 400, defaultValue: 'Ultra — income +400 every round' })),
];

export function hordeAlgorithmById(id: string | undefined | null): HordeAlgorithm {
    const found = HORDE_ALGORITHMS.find((a) => a.id === id);
    return found ?? HORDE_ALGORITHMS.find((a) => a.id === DEFAULT_HORDE_PRESET_ID)!;
}
