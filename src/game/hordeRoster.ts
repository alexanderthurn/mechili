/**
 * Authored horde wave composition — exact pack counts from round slot + cycle
 * level. Presets only gate which rounds fire and (Ultra) multiply counts.
 */

import { HORDE_CYCLE_LEN, HORDE_FINAL_ROUND } from './hordeAlgorithms';
import {
    BAT,
    HORDE_BRUT,
    HORDE_FARMER,
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
 *
 * Join order follows power (weak → strong). Each type keeps showing up
 * after it unlocks; only the bosses are one-per-finale.
 *
 *   Black Brood     — every wave (fodder); 1 pack swapped for 2 Bat packs
 *   Bat             — 2 per wave (from the brood swap); +3 more on Mother night
 *   Webweaver       — from slot 5
 *   Dead Farmer     — from slot 7
 *   Black Spider    — Mother night (slot 9) every cycle
 *   Hans            — Mother night from cycle 2 (round 18, 27, …)
 *
 * Medium’s spawn rounds are those beats: 3 brood, 5 +weaver, 7 +farmer,
 * 9 spider, 18 +Hans. Ultra doubles all counts via `countMult`.
 */
export function hordeWavePlan(round: number, countMult = 1): HordeWaveEntry[] {
    const s = hordeSlot(round);
    const level = hordeCycle(round);
    const m = Math.max(1, Math.floor(countMult));
    const motherNight = s === HORDE_FINAL_ROUND;
    // Every wave: −1 brood, +2 bats. Mother night: +3 more bats.
    // Slot 9 example (m=1): brood 8 + bats 5 (2+3). Ultra doubles both.
    const brut = Math.max(0, s - 1) * m;
    const bats = (2 + (motherNight ? 3 : 0)) * m;
    const web = Math.max(0, s - 4) * m;
    const farmer = Math.max(0, s - 6) * m;
    const spinne = (motherNight ? 1 : 0) * m;
    // Hans is the stronger spider — he joins the finale from the second circle on.
    const komtur = motherNight && level >= 2 ? 1 * m : 0;
    const out: HordeWaveEntry[] = [];
    for (let i = 0; i < brut; i++) out.push({ type: HORDE_BRUT, level });
    for (let i = 0; i < bats; i++) out.push({ type: BAT, level });
    for (let i = 0; i < web; i++) out.push({ type: HORDE_WEBWEAVER, level });
    for (let i = 0; i < farmer; i++) out.push({ type: HORDE_FARMER, level });
    for (let i = 0; i < spinne; i++) out.push({ type: HORDE_SPINNE, level });
    for (let i = 0; i < komtur; i++) out.push({ type: HORDE_KOMTUR, level });
    return out;
}
