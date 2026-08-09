/**
 * Authored horde wave composition — exact pack counts from round slot + cycle
 * level. Presets only gate which rounds fire and (Ultra) multiply counts.
 */

import {
    HORDE_BRUT,
    HORDE_SPINNE,
    HORDE_WEBWEAVER,
    type UnitType,
} from './units';

/** 1–10 within the current 10-round circle. */
export function hordeSlot(round: number): number {
    return (((Math.max(1, round) - 1) % 10) + 1);
}

/** 1-based cycle; packs spawn at this veterancy level. */
export function hordeCycle(round: number): number {
    return Math.floor((Math.max(1, round) - 1) / 10) + 1;
}

export interface HordeWaveEntry {
    type: UnitType;
    level: number;
}

/**
 * Exact packs for this match round. `countMult` is 1 normally, 2 for Ultra.
 * Expand order: Brut → Webweaver → Spinne (Mother on slot 10).
 */
export function hordeWavePlan(round: number, countMult = 1): HordeWaveEntry[] {
    const s = hordeSlot(round);
    const level = hordeCycle(round);
    const m = Math.max(1, Math.floor(countMult));
    const brut = 2 * s * m;
    const web = Math.max(0, s - 2) * m;
    const spinne = (s === 10 ? 1 : 0) * m;
    const out: HordeWaveEntry[] = [];
    for (let i = 0; i < brut; i++) out.push({ type: HORDE_BRUT, level });
    for (let i = 0; i < web; i++) out.push({ type: HORDE_WEBWEAVER, level });
    for (let i = 0; i < spinne; i++) out.push({ type: HORDE_SPINNE, level });
    return out;
}
