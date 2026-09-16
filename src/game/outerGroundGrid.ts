/**
 * Outer-ground XZ lattice.
 * - Ultra (`dense`): ~3× finer spacing on the mountain band (optics + sculpt).
 * - High/medium (`mountainSparse`): coarser spacing on the mountain band —
 *   the gebirge is pure visuals; near-board ring stays at meadow step for
 *   horde / lakes / relevant gameplay-adjacent optics.
 * - Otherwise: uniform spacing.
 *
 * The battle-map rectangle is cut out (inset rim under the board mesh).
 */

import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Distance past the board edge where the fine mountain grid begins.
 * Horde spawns only in d ∈ [45, 125] (game.ts HORDE_RING_*); this sits just beyond.
 */
export const MOUNTAIN_DENSE_FROM = 130;

/** Linear density multiplier in the mountain band vs meadow (3 → ~9× verts/area). */
export const MOUNTAIN_DENSE_MULT = 3;

/**
 * How far the board hole is inset from the AABB. Keeps a rim of outer-ground
 * verts tucked under the battle mesh so the seam never opens a gap (the
 * lattice does not land exactly on ±halfW / ±halfH).
 */
const BOARD_HOLE_INSET = 12;

/**
 * Build the outer ground base plane (already XZ-oriented like `PlaneGeometry`
 * after `rotateX(-π/2)`), with a rectangular hole under the board.
 */
export function createOuterGroundGeometry(
    size: number,
    segs: number,
    opts: {
        dense: boolean;
        /** High/medium: fewer verts on the mountain rim (optics). */
        mountainSparse?: boolean;
        halfW: number;
        halfH: number;
        denseFrom?: number;
        denseMult?: number;
    },
): BufferGeometry {
    const half = size * 0.5;
    const stepNear = size / Math.max(1, segs);
    const denseFrom = opts.denseFrom ?? MOUNTAIN_DENSE_FROM;
    const mult = opts.denseMult ?? MOUNTAIN_DENSE_MULT;

    let xs: number[];
    let zs: number[];
    if (opts.dense) {
        const stepFar = stepNear / mult;
        xs = sampleAxis(half, stepNear, stepFar, opts.halfW + denseFrom);
        zs = sampleAxis(half, stepNear, stepFar, opts.halfH + denseFrom);
    } else if (opts.mountainSparse) {
        // Opposite of Ultra: meadow step near the board, coarser on mountains.
        const stepFar = stepNear * mult;
        xs = sampleAxis(half, stepNear, stepFar, opts.halfW + denseFrom);
        zs = sampleAxis(half, stepNear, stepFar, opts.halfH + denseFrom);
    } else {
        xs = sampleAxis(half, stepNear, stepNear, Number.POSITIVE_INFINITY);
        zs = sampleAxis(half, stepNear, stepNear, Number.POSITIVE_INFINITY);
    }

    const holeW = Math.max(0, opts.halfW - BOARD_HOLE_INSET);
    const holeH = Math.max(0, opts.halfH - BOARD_HOLE_INSET);
    return buildRectilinearXZ(xs, zs, size, holeW, holeH);
}

/** Walk [-half, +half] with near then far spacing past fineBeyond. */
function sampleAxis(
    half: number,
    stepNear: number,
    stepFar: number,
    fineBeyond: number,
): number[] {
    const out: number[] = [];
    let x = -half;
    out.push(x);
    const eps = 1e-4;
    while (x < half - eps) {
        const step = Math.abs(x) >= fineBeyond - eps ? stepFar : stepNear;
        const next = Math.min(half, x + step);
        if (next <= x + eps) break;
        x = next;
        out.push(x);
    }
    out[out.length - 1] = half;
    return out;
}

/**
 * Structured grid on XZ (Y=0), omitting verts inside the inset board hole.
 * UVs match PlaneGeometry after rotateX(-π/2): u along +X, v along −Z.
 */
function buildRectilinearXZ(
    xs: number[],
    zs: number[],
    size: number,
    holeHalfW: number,
    holeHalfH: number,
): BufferGeometry {
    const nx = xs.length;
    const nz = zs.length;
    const half = size * 0.5;

    const keep = new Int32Array(nx * nz);
    keep.fill(-1);
    let vertCount = 0;
    for (let iz = 0; iz < nz; iz++) {
        const z = zs[iz]!;
        for (let ix = 0; ix < nx; ix++) {
            const x = xs[ix]!;
            if (Math.abs(x) <= holeHalfW && Math.abs(z) <= holeHalfH) continue;
            keep[iz * nx + ix] = vertCount++;
        }
    }

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    for (let iz = 0; iz < nz; iz++) {
        const z = zs[iz]!;
        for (let ix = 0; ix < nx; ix++) {
            const vi = keep[iz * nx + ix]!;
            if (vi < 0) continue;
            const x = xs[ix]!;
            positions[vi * 3] = x;
            positions[vi * 3 + 1] = 0;
            positions[vi * 3 + 2] = z;
            uvs[vi * 2] = (x + half) / size;
            uvs[vi * 2 + 1] = 1 - (z + half) / size;
        }
    }

    const indices: number[] = [];
    for (let iz = 0; iz < nz - 1; iz++) {
        for (let ix = 0; ix < nx - 1; ix++) {
            const a = keep[iz * nx + ix]!;
            const b = keep[iz * nx + ix + 1]!;
            const c = keep[(iz + 1) * nx + ix]!;
            const d = keep[(iz + 1) * nx + ix + 1]!;
            if (a < 0 || b < 0 || c < 0 || d < 0) continue;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    return geo;
}
