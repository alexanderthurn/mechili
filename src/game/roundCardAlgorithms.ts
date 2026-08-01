/**
 * Between-round card presets: match config stores only an id; each algorithm
 * owns schedule + pool progression and the English select-box blurb.
 */

import {
    drawRoundCardOffer,
    type RoundCard,
    type RoundCardDrawPool,
} from './cards';

/** How many choices each offer shows (capped by pool size). */
const DEFAULT_OFFER_COUNT = 4;

export abstract class RoundCardAlgorithm {
    abstract readonly id: string;
    /** Full select-option text (name + what the player gets). */
    abstract describe(): string;
    abstract shouldOffer(round: number): boolean;
    /** Pool used when {@link shouldOffer} is true for this round. */
    abstract poolForRound(round: number): RoundCardDrawPool;

    offerCount(): number {
        return DEFAULT_OFFER_COUNT;
    }

    drawOffer(round: number, rng: () => number): RoundCard[] {
        if (!this.shouldOffer(round)) return [];
        return drawRoundCardOffer(rng, {
            offerCount: this.offerCount(),
            pool: this.poolForRound(round),
        });
    }
}

/** No between-round offers. */
class OffRoundCards extends RoundCardAlgorithm {
    readonly id = 'off';
    describe(): string {
        return 'Off — no between-round cards';
    }
    shouldOffer(): boolean {
        return false;
    }
    poolForRound(): RoundCardDrawPool {
        return 'runes';
    }
}

/** Base runes on even rounds only (sparse). */
class RunesSpareRoundCards extends RoundCardAlgorithm {
    readonly id = 'runes-spare';
    describe(): string {
        return 'Runes Only (Spare) — base runes on rounds 2, 4, 6, 8, 10';
    }
    shouldOffer(round: number): boolean {
        return round >= 2 && round % 2 === 0;
    }
    poolForRound(): RoundCardDrawPool {
        return 'runes';
    }
}

/** Base runes every round from round 2. */
class RunesEveryRoundCards extends RoundCardAlgorithm {
    readonly id = 'runes-every';
    describe(): string {
        return 'Runes Only (Every Round) — base runes every round from round 2';
    }
    shouldOffer(round: number): boolean {
        return round >= 2;
    }
    poolForRound(): RoundCardDrawPool {
        return 'runes';
    }
}

/**
 * Escalating pools across the match:
 * rounds 2–4 runes → 5–7 unit packs → 8–10 spells.
 */
class FullRoundCards extends RoundCardAlgorithm {
    readonly id = 'full';
    describe(): string {
        return 'Full — rounds 2–4 runes, 5–7 unit packs, 8–10 spells';
    }
    shouldOffer(round: number): boolean {
        return round >= 2 && round <= 10;
    }
    poolForRound(round: number): RoundCardDrawPool {
        if (round <= 4) return 'runes';
        if (round <= 7) return 'units';
        return 'spells';
    }
}

export const DEFAULT_ROUND_CARD_PRESET_ID = 'off';

export const ROUND_CARD_ALGORITHMS: readonly RoundCardAlgorithm[] = [
    new OffRoundCards(),
    new RunesSpareRoundCards(),
    new RunesEveryRoundCards(),
    new FullRoundCards(),
];

export function roundCardAlgorithmById(id: string | undefined | null): RoundCardAlgorithm {
    const found = ROUND_CARD_ALGORITHMS.find((a) => a.id === id);
    return found ?? ROUND_CARD_ALGORITHMS.find((a) => a.id === DEFAULT_ROUND_CARD_PRESET_ID)!;
}
