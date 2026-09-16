/**
 * Outer-ground XZ lattice. Default = uniform PlaneGeometry (cheap).
 * Ultra scenery: ~3× linear spacing past the horde ring
 * (d ≥ {@link MOUNTAIN_DENSE_FROM}), still a heightfield — sculpting later.
 */

import { BufferAttribute, BufferGeometry, PlaneGeometry } from 'three';

/**
 * Distance past the board edge where the fine mountain grid begins.
 * Horde spawns only in d ∈ [45, 125] (game.ts HORDE_RING_*); this sits just beyond.
 */
export const MOUNTAIN_DENSE_FROM = 130;

/** Linear density multiplier in the mountain band vs meadow (3 → ~9× verts/area). */
export const MOUNTAIN_DENSE_MULT = 4;

/**
 * Build the outer ground base plane (Y up before callers rotate… actually
 * returns already XZ-oriented like `PlaneGeometry` after `rotateX(-π/2)`).
 */
export function createOuterGroundGeometry(
    size: number,
    segs: number,
    opts: {
        dense: boolean;
        halfW: number;
        halfH: number;
        denseFrom?: number;
        denseMult?: number;
    },
): BufferGeometry {
    if (!opts.dense) {
        const geo = new PlaneGeometry(size, size, segs, segs);
        geo.rotateX(-Math.PI / 2);
        return geo;
    }

    const denseFrom = opts.denseFrom ?? MOUNTAIN_DENSE_FROM;
    const mult = opts.denseMult ?? MOUNTAIN_DENSE_MULT;
    const half = size * 0.5;
    const stepNear = size / Math.max(1, segs);
    const stepFar = stepNear / mult;

    const xs = sampleAxis(half, stepNear, stepFar, opts.halfW + denseFrom);
    const zs = sampleAxis(half, stepNear, stepFar, opts.halfH + denseFrom);
    return buildRectilinearXZ(xs, zs, size);
}

/** Walk [-half, +half] with coarse then fine spacing. */
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
 * Structured grid on XZ (Y=0). UVs match PlaneGeometry after rotateX(-π/2):
 * u along +X, v along −Z so meadow tiling phase stays consistent.
 */
function buildRectilinearXZ(xs: number[], zs: number[], size: number): BufferGeometry {
    const nx = xs.length;
    const nz = zs.length;
    const vertCount = nx * nz;
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const half = size * 0.5;

    for (let iz = 0; iz < nz; iz++) {
        const z = zs[iz]!;
        for (let ix = 0; ix < nx; ix++) {
            const x = xs[ix]!;
            const i = iz * nx + ix;
            positions[i * 3] = x;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = z;
            uvs[i * 2] = (x + half) / size;
            // PlaneGeometry: v increases with original +Y; after rotateX(-π/2)
            // that maps to −Z, so invert Z for UV.v.
            uvs[i * 2 + 1] = 1 - (z + half) / size;
        }
    }

    const quadCount = (nx - 1) * (nz - 1);
    const indices = new Uint32Array(quadCount * 6);
    let t = 0;
    for (let iz = 0; iz < nz - 1; iz++) {
        for (let ix = 0; ix < nx - 1; ix++) {
            const a = iz * nx + ix;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            indices[t++] = a;
            indices[t++] = c;
            indices[t++] = b;
            indices[t++] = b;
            indices[t++] = c;
            indices[t++] = d;
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setIndex(new BufferAttribute(indices, 1));
    return geo;
}
