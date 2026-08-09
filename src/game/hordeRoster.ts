/**
 * Authored horde wave composition — exact pack counts from round slot + cycle
 * level. Presets only gate which rounds fire and (Ultra) multiply counts.
 */

import { HORDE_CYCLE_LEN, HORDE_FINAL_ROUND } from './hordeAlgorithms';
import {
    HORDE_BRUT,
    HORDE_KOMTUR,
    HORDE_SPINNE,
    HORDE_WEBWEAVER,
    type UnitType,
} from './units';

/** 1–{@link HORDE_CYCLE_LEN} within the current circle. */
export function hordeSlot(round: number): number {
    return (((Math.max(1, round) - 1) % HORDE_CYCLE_LEN) + 1);
}

/** 1-based cycle; packs spawn at this veterancy level. */
export function hordeCycle(round: number): number {
    return Math.floor((Math.max(1, round) - 1) / HORDE_CYCLE_LEN) + 1;
}

export interface HordeWaveEntry {
    type: UnitType;
    level: number;
}

/**
 * Exact packs for this match round. `countMult` is 1 normally, 2 for Ultra.
 * Brut +1/slot; Webweavers from slot 3; Mother on slot 9; Der Komtur from
 * the second Mother night onward (rounds 18, 27, …).
 */
export function hordeWavePlan(round: number, countMult = 1): HordeWaveEntry[] {
    const s = hordeSlot(round);
    const level = hordeCycle(round);
    const m = Math.max(1, Math.floor(countMult));
    const brut = s * m;
    const web = Math.max(0, s - 2) * m;
    const motherNight = s === HORDE_FINAL_ROUND;
    const spinne = (motherNight ? 1 : 0) * m;
    // Second circle+ finale: one Komtur (Ultra still doubles)
    const komtur = motherNight && level >= 2 ? 1 * m : 0;
    const out: HordeWaveEntry[] = [];
    for (let i = 0; i < brut; i++) out.push({ type: HORDE_BRUT, level });
    for (let i = 0; i < web; i++) out.push({ type: HORDE_WEBWEAVER, level });
    for (let i = 0; i < spinne; i++) out.push({ type: HORDE_SPINNE, level });
    for (let i = 0; i < komtur; i++) out.push({ type: HORDE_KOMTUR, level });
    return out;
}
