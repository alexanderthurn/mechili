/**
 * Horde mode presets: match config stores only an id; each algorithm owns
 * spawn schedule, pack-count multiplier, leader bias, and the select-box blurb.
 * Wave *composition* lives in {@link hordeWavePlan} (hordeRoster.ts).
 */

import { t } from '../i18n';

/** Length of one forest circle (Mother on the last slot). */
export const HORDE_CYCLE_LEN = 9;

/** Last slot of each circle — Mother night (rounds 9, 18, 27, …). */
export const HORDE_FINAL_ROUND = HORDE_CYCLE_LEN;

/** Share of packs in the large army camp (HP leader's side). Rest → trailer camp. */
const LEADER_SHARE = 0.8;

/**
 * Optional runtime context for future conditional algorithms
 * (leader-only pressure, HP gates, etc.).
 */
export interface HordeContext {
    round: number;
    playerHp?: number;
    enemyHp?: number;
}

/** Slot 1–{@link HORDE_CYCLE_LEN} inside the current circle. */
function slotOf(round: number): number {
    return (((Math.max(1, round) - 1) % HORDE_CYCLE_LEN) + 1);
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
     * Pack-count multiplier for {@link hordeWavePlan}. Ultra doubles;
     * others are 1. Budget shopping is gone — this is the only intensity knob.
     */
    countMult(): number {
        return 1;
    }

    /**
     * @deprecated Composition no longer spends a budget. Kept so old callers
     * compile; always 0.
     */
    budget(_round: number): number {
        return 0;
    }

    leaderShare(): number {
        return LEADER_SHARE;
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

/** Mid check + Mother night. */
class LowHorde extends HordeAlgorithm {
    readonly id = 'low';
    describe(): string {
        return t('settings:hordeLow', {
            final: HORDE_FINAL_ROUND,
            defaultValue: `Low — waves on 5 and Mother night (${HORDE_FINAL_ROUND})`,
        });
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(round: number): boolean {
        const s = slotOf(round);
        return s === 5 || s === HORDE_FINAL_ROUND;
    }
}

/** Brood → weaver → farmer → Mother night. */
class MediumHorde extends HordeAlgorithm {
    readonly id = 'medium';
    describe(): string {
        return t('settings:hordeMedium', {
            defaultValue:
                'Medium — brood on 3, weavers on 5, farmers on 7, Mother night (9 / 18+ Hans)',
        });
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(round: number): boolean {
        const s = slotOf(round);
        return s === 3 || s === 5 || s === 7 || s === HORDE_FINAL_ROUND;
    }
}

/** Full ramp every round. */
class HighHorde extends HordeAlgorithm {
    readonly id = 'high';
    describe(): string {
        return t('settings:hordeHigh', { defaultValue: 'High — a wave every round' });
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(_round: number): boolean {
        return true;
    }
}

/** Full ramp, double pack counts. */
class UltraHorde extends HordeAlgorithm {
    readonly id = 'ultra';
    describe(): string {
        return t('settings:hordeUltra', {
            defaultValue: 'Ultra — every round, double pack counts',
        });
    }
    enabled(): boolean {
        return true;
    }
    shouldSpawn(_round: number): boolean {
        return true;
    }
    countMult(): number {
        return 2;
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
