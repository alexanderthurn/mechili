/** Client-side Elo preview — mirrors backend/player.php constants. */

export const DEFAULT_MMR = 1000;
export const ELO_K = 32;

export function eloExpected(ra: number, rb: number): number {
    return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/** Returns [newA, newB] after a rated result from A's perspective. */
export function eloApply(
    ra: number,
    rb: number,
    result: 'victory' | 'defeat' | 'draw',
): [number, number] {
    const scoreA = result === 'victory' ? 1 : result === 'defeat' ? 0 : 0.5;
    const ea = eloExpected(ra, rb);
    const eb = eloExpected(rb, ra);
    const na = Math.max(0, Math.round(ra + ELO_K * (scoreA - ea)));
    const nb = Math.max(0, Math.round(rb + ELO_K * (1 - scoreA - eb)));
    return [na, nb];
}

/** MMR delta for side A given the match result from A's perspective. */
export function mmrDelta(
    ra: number,
    rb: number,
    result: 'victory' | 'defeat' | 'draw',
): { before: number; after: number; delta: number } {
    const [after] = eloApply(ra, rb, result);
    return { before: ra, after, delta: after - ra };
}

export function formatMmrDelta(delta: number): string {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return String(delta);
    return '±0';
}
