/**
 * Board-height combat helpers: elevation range bonus and slope locomotion.
 * Outer mountains stay visual-only — sample {@link simGroundHeightAt} only.
 */

import { hypot } from './detMath';
import { simGroundHeightAt } from './map';

/** Horizontal range gained/lost per world-unit of height difference. */
export const RANGE_PER_WU = 0.45;
/** Cap so sculpted cliffs / tall keeps stay readable. */
export const RANGE_ELEV_MAX_BONUS = 10;
export const RANGE_ELEV_MAX_PENALTY = 8;

/** Rise/run above this → prefer slide / crawl instead of full forward step. */
export const SLOPE_BLOCK_GRADE = 0.72;
/** Uphill speed cost: speed /= (1 + grade * cost). */
export const SLOPE_UPHILL_COST = 2.4;
/** When every direction is too steep, still inch forward so packs don't freeze. */
export const SLOPE_STRUGGLE = 0.12;

/** Elevation delta → range delta (positive = high-ground advantage). */
export function elevationRangeBonus(shooterY: number, targetY: number): number {
    const dh = shooterY - targetY;
    const raw = dh * RANGE_PER_WU;
    return Math.min(RANGE_ELEV_MAX_BONUS, Math.max(-RANGE_ELEV_MAX_PENALTY, raw));
}

/**
 * Surface-to-surface weapon reach. When `elevation` is true (ranged), high
 * ground extends reach and low ground shortens it.
 */
export function effectiveWeaponReach(
    baseRange: number,
    fromRadius: number,
    toRadius: number,
    shooterY: number,
    targetY: number,
    elevation = false,
): number {
    const bonus = elevation ? elevationRangeBonus(shooterY, targetY) : 0;
    return Math.max(0.5, baseRange + bonus) + fromRadius + toRadius;
}

/**
 * Ring / FOV preview radius bonus: how much farther this shooter reaches vs
 * a target standing on local board ground (Stronghold battlements light up).
 */
export function rangePreviewBonus(shooterFeetY: number, x: number, z: number): number {
    const ground = simGroundHeightAt(x, z);
    return Math.max(0, elevationRangeBonus(shooterFeetY, ground));
}

/**
 * Slope factor along a proposed XZ step. Returns a multiplier in (0, 1]
 * (1 = flat / downhill). Steep faces return a small struggle crawl, not 0.
 */
export function slopeMoveFactor(x0: number, z0: number, moveX: number, moveZ: number, stepLen: number): number {
    if (stepLen < 1e-4) return 1;
    const h0 = simGroundHeightAt(x0, z0);
    const h1 = simGroundHeightAt(x0 + moveX * stepLen, z0 + moveZ * stepLen);
    const grade = (h1 - h0) / stepLen;
    if (grade >= SLOPE_BLOCK_GRADE) return SLOPE_STRUGGLE;
    if (grade <= 0) return 1;
    return 1 / (1 + grade * SLOPE_UPHILL_COST);
}

/**
 * Pick a walkable heading: prefer forward, else slide along the slope
 * (left/right), else struggle crawl. Keeps packs from freezing on cliffs.
 */
export function resolveSlopeMove(
    x0: number,
    z0: number,
    moveX: number,
    moveZ: number,
    stepLen: number,
    preferRight: boolean,
): { mx: number; mz: number; factor: number } {
    const forward = slopeMoveFactor(x0, z0, moveX, moveZ, stepLen);
    if (forward > SLOPE_STRUGGLE + 1e-4) {
        return { mx: moveX, mz: moveZ, factor: forward };
    }

    // Perpendicular slides (contour-ish), biased slightly toward the goal.
    const leftX = -moveZ;
    const leftZ = moveX;
    const rightX = moveZ;
    const rightZ = -moveX;
    const order = preferRight
        ? [
              [rightX, rightZ],
              [leftX, leftZ],
          ]
        : [
              [leftX, leftZ],
              [rightX, rightZ],
          ];

    let best: { mx: number; mz: number; factor: number } | null = null;
    for (const [sx, sz] of order) {
        // Mostly lateral, slight forward so they still progress around the face.
        let dx = sx! * 0.9 + moveX * 0.25;
        let dz = sz! * 0.9 + moveZ * 0.25;
        const len = hypot(dx, dz) || 1e-6;
        dx /= len;
        dz /= len;
        const f = slopeMoveFactor(x0, z0, dx, dz, stepLen);
        if (!best || f > best.factor) best = { mx: dx, mz: dz, factor: f };
        if (f > SLOPE_STRUGGLE + 1e-4) return { mx: dx, mz: dz, factor: f };
    }

    // Pure lateral as last try before struggle.
    for (const [sx, sz] of order) {
        const f = slopeMoveFactor(x0, z0, sx!, sz!, stepLen);
        if (f > SLOPE_STRUGGLE + 1e-4) return { mx: sx!, mz: sz!, factor: f };
        if (!best || f > best.factor) best = { mx: sx!, mz: sz!, factor: f };
    }

    return best ?? { mx: moveX, mz: moveZ, factor: SLOPE_STRUGGLE };
}
