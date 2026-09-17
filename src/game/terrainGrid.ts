/**
 * The board's relief as a grid — the one height source for the sim, ballistics
 * and the visuals, and the thing battle effects deform.
 *
 * Nodes sit exactly on the board mesh's vertices (cols·2 × rows·2 segments,
 * 2 wu), so the mesh shows precisely what the sim walks on. A lookup is a
 * bilinear read of four values — its cost doesn't grow with the number of
 * craters. A deformation writes only the cells it covers, once, inside the
 * sim step it happens in, so every client (and a replay, a reconnect, a
 * spectator catching up) derives the same grid. The renderer copies the
 * changed rectangle into the meshes once per frame.
 *
 * Determinism: integer loops, plain float arithmetic, detCos/detSin for
 * rotations, polynomial falloffs (no Math.pow / Math.sin).
 */
import type { BufferAttribute, BufferGeometry } from 'three';
import { detCos, detSin } from './detMath';

/** inclusive node rectangle */
export interface TerrainRect {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

export class TerrainGrid {
    /** nodes per axis */
    readonly nx: number;
    readonly nz: number;
    readonly halfW: number;
    readonly halfH: number;
    readonly cellX: number;
    readonly cellZ: number;
    /** the undeformed relief (procedural or a static map) */
    private readonly base: Float32Array;
    /** the relief the battle plays on */
    readonly heights: Float32Array;
    /** nodes changed since the renderer last looked */
    private dirty: TerrainRect | null = null;
    /** nodes deformed since the last reset (a reset only rewrites these) */
    private deformed: TerrainRect | null = null;

    constructor(board: { cols: number; rows: number; halfW: number; halfH: number }) {
        this.nx = board.cols * 2 + 1;
        this.nz = board.rows * 2 + 1;
        this.halfW = board.halfW;
        this.halfH = board.halfH;
        this.cellX = (board.halfW * 2) / (this.nx - 1);
        this.cellZ = (board.halfH * 2) / (this.nz - 1);
        this.base = new Float32Array(this.nx * this.nz);
        this.heights = new Float32Array(this.nx * this.nz);
    }

    /** (re)fill the undeformed relief from a height function; clears any deformation */
    setBase(height: (x: number, z: number) => number): void {
        for (let iz = 0; iz < this.nz; iz++) {
            const z = -this.halfH + iz * this.cellZ;
            for (let ix = 0; ix < this.nx; ix++) {
                this.base[iz * this.nx + ix] = height(-this.halfW + ix * this.cellX, z);
            }
        }
        this.heights.set(this.base);
        this.deformed = null;
        this.markDirty({ x0: 0, z0: 0, x1: this.nx - 1, z1: this.nz - 1 });
    }

    /** undo every deformation (battle start / end) */
    reset(): void {
        const r = this.deformed;
        if (!r) return;
        for (let iz = r.z0; iz <= r.z1; iz++) {
            const row = iz * this.nx;
            for (let ix = r.x0; ix <= r.x1; ix++) this.heights[row + ix] = this.base[row + ix]!;
        }
        this.deformed = null;
        this.markDirty(r);
    }

    /** height at a world point — bilinear between nodes, clamped to the board edge outside it */
    sample(x: number, z: number): number {
        const fx = (x + this.halfW) / this.cellX;
        const fz = (z + this.halfH) / this.cellZ;
        const maxX = this.nx - 2;
        const maxZ = this.nz - 2;
        const x0 = fx < 0 ? 0 : fx >= maxX ? maxX : Math.floor(fx);
        const z0 = fz < 0 ? 0 : fz >= maxZ ? maxZ : Math.floor(fz);
        const tx = fx - x0 < 0 ? 0 : fx - x0 > 1 ? 1 : fx - x0;
        const tz = fz - z0 < 0 ? 0 : fz - z0 > 1 ? 1 : fz - z0;
        const h = this.heights;
        const i = z0 * this.nx + x0;
        const y0 = h[i]! + (h[i + 1]! - h[i]!) * tx;
        const y1 = h[i + this.nx]! + (h[i + this.nx + 1]! - h[i + this.nx]!) * tx;
        return y0 + (y1 - y0) * tz;
    }

    /**
     * Press an oriented rectangle toward `targetY` (Hammer of the Gods): full
     * inside 82 % of the half extents, easing out linearly to the edge.
     */
    flattenRect(cx: number, cz: number, halfWidth: number, halfDepth: number, yaw: number, targetY: number): void {
        const hw = Math.max(1e-3, halfWidth);
        const hd = Math.max(1e-3, halfDepth);
        const c = detCos(yaw);
        const s = detSin(yaw);
        const reach = Math.sqrt(hw * hw + hd * hd);
        const rect = this.nodeRect(cx - reach, cz - reach, cx + reach, cz + reach);
        if (!rect) return;
        for (let iz = rect.z0; iz <= rect.z1; iz++) {
            const dz = -this.halfH + iz * this.cellZ - cz;
            const row = iz * this.nx;
            for (let ix = rect.x0; ix <= rect.x1; ix++) {
                const dx = -this.halfW + ix * this.cellX - cx;
                const ax = Math.abs(dx * c + dz * s) / hw;
                const az = Math.abs(-dx * s + dz * c) / hd;
                if (ax > 1 || az > 1) continue;
                const edge = ax > az ? ax : az;
                const w = edge <= 0.82 ? 1 : 1 - (edge - 0.82) / 0.18;
                const i = row + ix;
                this.heights[i] = this.heights[i]! + (targetY - this.heights[i]!) * w;
            }
        }
        this.noteDeformed(rect);
    }

    /**
     * A bowl: lowers the ground by `depth` at the center, fading to nothing at
     * `radius` ((1 − d²/r²)² falloff). Negative depth raises a mound.
     */
    crater(cx: number, cz: number, radius: number, depth: number): void {
        const r = Math.max(1e-3, radius);
        const r2 = r * r;
        const rect = this.nodeRect(cx - r, cz - r, cx + r, cz + r);
        if (!rect) return;
        for (let iz = rect.z0; iz <= rect.z1; iz++) {
            const dz = -this.halfH + iz * this.cellZ - cz;
            const row = iz * this.nx;
            for (let ix = rect.x0; ix <= rect.x1; ix++) {
                const dx = -this.halfW + ix * this.cellX - cx;
                const d2 = dx * dx + dz * dz;
                if (d2 >= r2) continue;
                const t = 1 - d2 / r2;
                this.heights[row + ix] = this.heights[row + ix]! - depth * t * t;
            }
        }
        this.noteDeformed(rect);
    }

    /** the changed node rectangle since the last call (null: nothing changed) */
    takeDirty(): TerrainRect | null {
        const r = this.dirty;
        this.dirty = null;
        return r;
    }

    /** a fingerprint of the current relief (state hash) */
    checksum(): number {
        let h = 0x811c9dc5;
        for (let i = 0; i < this.heights.length; i++) {
            h = Math.imul(h ^ Math.round(this.heights[i]! * 1024), 16777619);
        }
        return h >>> 0;
    }

    /**
     * Copy a node rectangle into a mesh laid out like the board (PlaneGeometry
     * cols·2 × rows·2, rotated flat): Y from the grid, normals from its slopes
     * (when the geometry has them), and upload just those rows.
     */
    writeToGeometry(geometry: BufferGeometry, rect: TerrainRect): void {
        const pos = geometry.attributes.position as BufferAttribute | undefined;
        if (!pos || pos.count !== this.nx * this.nz) return;
        const normal = geometry.attributes.normal as BufferAttribute | undefined;
        // normals of the ring around the rect see the change too
        const x0 = Math.max(0, rect.x0 - 1);
        const z0 = Math.max(0, rect.z0 - 1);
        const x1 = Math.min(this.nx - 1, rect.x1 + 1);
        const z1 = Math.min(this.nz - 1, rect.z1 + 1);
        const h = this.heights;
        for (let iz = z0; iz <= z1; iz++) {
            for (let ix = x0; ix <= x1; ix++) {
                const i = iz * this.nx + ix;
                pos.setY(i, h[i]!);
                if (!normal) continue;
                const l = h[iz * this.nx + Math.max(0, ix - 1)]!;
                const r = h[iz * this.nx + Math.min(this.nx - 1, ix + 1)]!;
                const u = h[Math.max(0, iz - 1) * this.nx + ix]!;
                const d = h[Math.min(this.nz - 1, iz + 1) * this.nx + ix]!;
                const gx = (r - l) / ((Math.min(this.nx - 1, ix + 1) - Math.max(0, ix - 1)) * this.cellX);
                const gz = (d - u) / ((Math.min(this.nz - 1, iz + 1) - Math.max(0, iz - 1)) * this.cellZ);
                const len = Math.sqrt(gx * gx + 1 + gz * gz);
                normal.setXYZ(i, -gx / len, 1 / len, -gz / len);
            }
        }
        const start = z0 * this.nx;
        const count = (z1 - z0 + 1) * this.nx;
        pos.clearUpdateRanges();
        pos.addUpdateRange(start * 3, count * 3);
        pos.needsUpdate = true;
        if (normal) {
            normal.clearUpdateRanges();
            normal.addUpdateRange(start * 3, count * 3);
            normal.needsUpdate = true;
        }
    }

    /** world-space bounds of a node rectangle */
    worldBounds(rect: TerrainRect): { minX: number; maxX: number; minZ: number; maxZ: number } {
        return {
            minX: -this.halfW + rect.x0 * this.cellX,
            maxX: -this.halfW + rect.x1 * this.cellX,
            minZ: -this.halfH + rect.z0 * this.cellZ,
            maxZ: -this.halfH + rect.z1 * this.cellZ,
        };
    }

    private nodeRect(minX: number, minZ: number, maxX: number, maxZ: number): TerrainRect | null {
        const x0 = Math.max(0, Math.ceil((minX + this.halfW) / this.cellX));
        const z0 = Math.max(0, Math.ceil((minZ + this.halfH) / this.cellZ));
        const x1 = Math.min(this.nx - 1, Math.floor((maxX + this.halfW) / this.cellX));
        const z1 = Math.min(this.nz - 1, Math.floor((maxZ + this.halfH) / this.cellZ));
        return x0 > x1 || z0 > z1 ? null : { x0, z0, x1, z1 };
    }

    private noteDeformed(rect: TerrainRect): void {
        this.deformed = union(this.deformed, rect);
        this.markDirty(rect);
    }

    private markDirty(rect: TerrainRect): void {
        this.dirty = union(this.dirty, rect);
    }
}

function union(a: TerrainRect | null, b: TerrainRect): TerrainRect {
    if (!a) return { ...b };
    return { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) };
}
