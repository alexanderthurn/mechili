/**
 * Quality-independent landscape heights: a regular world heightfield is the
 * source of truth for authored maps. Any scenery mesh (Ultra dense / High
 * sparse mountains) drapes it; sim samples the field directly so High and
 * Ultra share the same gameplay heights on the board + near ring.
 */

import type { BufferAttribute, Mesh } from 'three';
import type { BattleMap } from './map';
import { registerOuterHeight } from './map';

/** Crest distance past board — matches scenery MOUNTAIN_PEAK_END. */
export const OUTER_SPAN_PAST_BOARD = 500;

/** Authoritative bake grid cell size (world units). Fine enough for Ultra detail. */
export const LANDSCAPE_BAKE_CELL = 5;

/** Cell size for ephemeral mesh→sim sync when no bake field exists yet. */
const LIVE_OUTER_CELL = 6;

export type HeightSampler = (x: number, z: number) => number;

/** Square row-major Y grid in world space. */
export interface LandscapeHeightfield {
    originX: number;
    originZ: number;
    size: number;
    res: number;
    heights: number[];
}

export function makeLandscapeHeightfieldBounds(map: Pick<BattleMap, 'halfW' | 'halfH'>): {
    originX: number;
    originZ: number;
    size: number;
    res: number;
} {
    const halfSpan = Math.max(map.halfW, map.halfH) + OUTER_SPAN_PAST_BOARD;
    const size = halfSpan * 2;
    const res = Math.max(8, Math.ceil(size / LANDSCAPE_BAKE_CELL));
    return { originX: -halfSpan, originZ: -halfSpan, size, res };
}

export function sampleHeightfield(hf: LandscapeHeightfield, x: number, z: number): number {
    const { originX, originZ, size, res, heights } = hf;
    if (res < 2 || heights.length < res * res) return 0;
    const cell = size / (res - 1);
    const fx = (x - originX) / cell;
    const fz = (z - originZ) / cell;
    const x0 = Math.min(res - 2, Math.max(0, Math.floor(fx)));
    const z0 = Math.min(res - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const tz = Math.min(1, Math.max(0, fz - z0));
    const i00 = z0 * res + x0;
    const y0 = heights[i00]! * (1 - tx) + heights[i00 + 1]! * tx;
    const y1 = heights[i00 + res]! * (1 - tx) + heights[i00 + res + 1]! * tx;
    return y0 * (1 - tz) + y1 * tz;
}

/**
 * Exact bilinear sample matching the board PlaneGeometry (cols*2 × rows*2).
 */
export function boardHeightSamplerFromMesh(mesh: Mesh, map: BattleMap): HeightSampler | null {
    const segsW = map.cols * 2;
    const segsH = map.rows * 2;
    const nx = segsW + 1;
    const nz = segsH + 1;
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    if (pos.count !== nx * nz) return null;

    const yOff = mesh.position.y;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) heights[i] = pos.getY(i) + yOff;

    const { halfW, halfH, width, height } = map;
    return (x: number, z: number): number => {
        const fx = ((x + halfW) / width) * segsW;
        const fz = ((z + halfH) / height) * segsH;
        const x0 = Math.min(segsW - 1, Math.max(0, Math.floor(fx)));
        const z0 = Math.min(segsH - 1, Math.max(0, Math.floor(fz)));
        const tx = Math.min(1, Math.max(0, fx - x0));
        const tz = Math.min(1, Math.max(0, fz - z0));
        const i00 = z0 * nx + x0;
        const y0 = heights[i00]! * (1 - tx) + heights[i00 + 1]! * tx;
        const y1 = heights[i00 + nx]! * (1 - tx) + heights[i00 + nx + 1]! * tx;
        return y0 * (1 - tz) + y1 * tz;
    };
}

function splatMeshIntoGrid(
    mesh: Mesh,
    grid: Float32Array,
    filled: Uint8Array,
    origin: number,
    cell: number,
    n: number,
    skip?: (x: number, z: number) => boolean,
): void {
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    const yOff = mesh.position.y;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (skip?.(x, z)) continue;
        const ix = Math.min(n - 1, Math.max(0, Math.floor((x - origin) / cell)));
        const iz = Math.min(n - 1, Math.max(0, Math.floor((z - origin) / cell)));
        const idx = iz * n + ix;
        const y = pos.getY(i) + yOff;
        if (!filled[idx] || y > grid[idx]!) {
            grid[idx] = y;
            filled[idx] = 1;
        }
    }
}

function dilateGrid(grid: Float32Array, filled: Uint8Array, n: number, passes: number): void {
    for (let pass = 0; pass < passes; pass++) {
        const next = filled.slice();
        for (let iz = 0; iz < n; iz++) {
            for (let ix = 0; ix < n; ix++) {
                const idx = iz * n + ix;
                if (filled[idx]) continue;
                let best = Infinity;
                let y = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const jx = ix + dx;
                        const jz = iz + dz;
                        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
                        const j = jz * n + jx;
                        if (!filled[j]) continue;
                        const d2 = dx * dx + dz * dz;
                        if (d2 < best) {
                            best = d2;
                            y = grid[j]!;
                        }
                    }
                }
                if (Number.isFinite(best)) {
                    grid[idx] = y;
                    next[idx] = 1;
                }
            }
        }
        filled.set(next);
    }
}

/** Build the authoritative bake heightfield from board + outer meshes. */
export function rasterizeLandscapeHeightfield(
    boardMesh: Mesh,
    outerMesh: Mesh,
    map: Pick<BattleMap, 'halfW' | 'halfH'>,
): LandscapeHeightfield {
    const { originX, originZ, size, res } = makeLandscapeHeightfieldBounds(map);
    const cell = size / Math.max(1, res - 1);
    const grid = new Float32Array(res * res);
    const filled = new Uint8Array(res * res);
    // Board first, then outer (outer wins only outside board when both fill a cell).
    splatMeshIntoGrid(boardMesh, grid, filled, originX, cell, res);
    splatMeshIntoGrid(outerMesh, grid, filled, originX, cell, res, (x, z) => {
        return Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH;
    });
    dilateGrid(grid, filled, res, 4);
    return {
        originX,
        originZ,
        size,
        res,
        heights: Array.from(grid),
    };
}

/** Ephemeral outer sampler from the live mesh (editor before first Save). */
export function outerHeightSamplerFromMesh(mesh: Mesh, map: BattleMap): HeightSampler {
    const halfSpan = Math.max(map.halfW, map.halfH) + OUTER_SPAN_PAST_BOARD;
    const n = Math.max(8, Math.ceil((halfSpan * 2) / LIVE_OUTER_CELL));
    const origin = -halfSpan;
    const cell = (halfSpan * 2) / n;
    const grid = new Float32Array(n * n);
    const filled = new Uint8Array(n * n);
    splatMeshIntoGrid(mesh, grid, filled, origin, cell, n, (x, z) => {
        return Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH;
    });
    dilateGrid(grid, filled, n, 3);
    const { halfW, halfH } = map;
    return (x, z) => {
        if (Math.abs(x) <= halfW && Math.abs(z) <= halfH) return 0;
        const fx = (x - origin) / cell;
        const fz = (z - origin) / cell;
        const x0 = Math.min(n - 2, Math.max(0, Math.floor(fx)));
        const z0 = Math.min(n - 2, Math.max(0, Math.floor(fz)));
        const tx = Math.min(1, Math.max(0, fx - x0));
        const tz = Math.min(1, Math.max(0, fz - z0));
        const i00 = z0 * n + x0;
        const y0 = grid[i00]! * (1 - tx) + grid[i00 + 1]! * tx;
        const y1 = grid[i00 + n]! * (1 - tx) + grid[i00 + n + 1]! * tx;
        return y0 * (1 - tz) + y1 * tz;
    };
}

export function samplerFromHeightfield(hf: LandscapeHeightfield, map: BattleMap): {
    board: HeightSampler;
    outer: HeightSampler;
} {
    const { halfW, halfH } = map;
    const board: HeightSampler = (x, z) => sampleHeightfield(hf, x, z);
    const outer: HeightSampler = (x, z) => {
        if (Math.abs(x) <= halfW && Math.abs(z) <= halfH) return 0;
        return sampleHeightfield(hf, x, z);
    };
    return { board, outer };
}

/** Drape a mesh onto the heightfield (Y only — XZ lean is Ultra-visual). */
export function applyHeightfieldToMesh(mesh: Mesh, hf: LandscapeHeightfield): void {
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    const yOff = mesh.position.y;
    for (let i = 0; i < pos.count; i++) {
        const y = sampleHeightfield(hf, pos.getX(i), pos.getZ(i));
        pos.setY(i, y - yOff);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
}

/** Apply heightfield Y onto a raw position attribute (outer ground before Mesh wrap). */
export function applyHeightfieldToPositions(
    pos: BufferAttribute | { count: number; getX: (i: number) => number; getZ: (i: number) => number; setY: (i: number, y: number) => void; needsUpdate: boolean },
    hf: LandscapeHeightfield,
    yOff = -0.05,
): void {
    for (let i = 0; i < pos.count; i++) {
        pos.setY(i, sampleHeightfield(hf, pos.getX(i), pos.getZ(i)) - yOff);
    }
    pos.needsUpdate = true;
}

/** Push sculpted board + outer heights into the live sim/visual height fns. */
export function syncLandscapeHeights(opts: {
    map: BattleMap;
    boardMesh: Mesh;
    outerMesh: Mesh | null;
    proceduralOuter: HeightSampler;
    /** Prefer bake heightfield when present (quality-independent). */
    heightfield?: LandscapeHeightfield | null;
}): void {
    if (opts.heightfield) {
        const { board, outer } = samplerFromHeightfield(opts.heightfield, opts.map);
        opts.map.setReliefOverride(board);
        registerOuterHeight(outer);
        return;
    }

    const board = boardHeightSamplerFromMesh(opts.boardMesh, opts.map);
    opts.map.setReliefOverride(board);

    if (opts.outerMesh) {
        registerOuterHeight(outerHeightSamplerFromMesh(opts.outerMesh, opts.map));
    } else {
        registerOuterHeight(opts.proceduralOuter);
    }
}

/** Clear board override and restore procedural outer height. */
export function clearLandscapeHeightOverrides(map: BattleMap, proceduralOuter: HeightSampler): void {
    map.setReliefOverride(null);
    registerOuterHeight(proceduralOuter);
}
