/**
 * Authored horde wave composition — exact pack counts from round slot + cycle
 * level. Presets only gate which rounds fire and (Ultra) multiply counts.
 */

import { HORDE_CYCLE_LEN, HORDE_FINAL_ROUND } from './hordeAlgorithms';
import type { TypeRegistry } from './content/typeRegistry';
import type { UnitType } from './units';

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
 *   Black Brood     — every wave (fodder), one pack per slot
 *   Bat             — half the brood, rounded down (so none on slot 1); +3 more on Mother night
 *   Webweaver       — from slot 5
 *   Dead Farmer     — from slot 7
 *   Black Spider    — Mother night (slot 9) every cycle
 *   Hans            — Mother night from cycle 2 (round 18, 27, …)
 *
 * Medium’s spawn rounds are those beats: 3 brood, 5 +weaver, 7 +farmer,
 * 9 spider, 18 +Hans. Ultra doubles all counts via `countMult`.
 */
export function hordeWavePlan(round: number, countMult: number, types: TypeRegistry): HordeWaveEntry[] {
    const s = hordeSlot(round);
    const level = hordeCycle(round);
    const m = Math.max(1, Math.floor(countMult));
    const motherNight = s === HORDE_FINAL_ROUND;
    // Brood grows with the slot; bats are half of it, rounded down, so the
    // first night is brood only. Mother night adds 3 more bat packs.
    // Slot 9 example (m=1): brood 9 + bats 7 (4+3). Ultra doubles both.
    const brut = s * m;
    const bats = (Math.floor(s / 2) + (motherNight ? 3 : 0)) * m;
    const web = Math.max(0, s - 4) * m;
    const farmer = Math.max(0, s - 6) * m;
    const spinne = (motherNight ? 1 : 0) * m;
    // Hans is the stronger spider — he joins the finale from the second circle on.
    const komtur = motherNight && level >= 2 ? 1 * m : 0;
    const out: HordeWaveEntry[] = [];
    const add = (count: number, typeId: string) => {
        if (count <= 0) return;
        const type = types.require(typeId);
        for (let i = 0; i < count; i++) out.push({ type, level });
    };
    add(brut, 'hordeZombie'); // Black Brood (legacy id)
    add(bats, 'bat');
    add(web, 'hordeWebweaver');
    add(farmer, 'hordeFarmer');
    add(spinne, 'hordeSpinne');
    add(komtur, 'hordeKomtur');
    return out;
}
