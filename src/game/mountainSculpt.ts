/**
 * Ultra-only visual mountain sculpt on the outer ground mesh.
 * Does not change gameplay {@link terrainHeight} — only vertex positions.
 *
 * Overhang = as Y rises on a face, verts move toward the board center
 * (upper rock sits further in than the rock below — a leaning / hanging face).
 */

import type { BufferAttribute, InterleavedBufferAttribute } from 'three';
import { MOUNTAIN_DENSE_FROM } from './outerGroundGrid';

/** Tunables — raise later if Ultra needs more drama. */
export const ULTRA_MOUNTAIN = {
    /** How many strong overhang faces around the ring. */
    overhangCount: 12,
    /**
     * How far toward the board the crest of an overhang leans (wu).
     * Mid-height is a fraction of this; top leans most.
     */
    overhangLean: 55,
    /** Influence radius around each overhang site. */
    overhangRadius: 100,
    /** Extra mid-band cliffs (0..1). */
    cliffStrength: 0.85,
    /** Near-flat alpine shelves (0..1). */
    flatStrength: 0.72,
    /** Broad ring-wide lean (weaker than seeded overhangs). */
    globalLean: 10,
    /** Min ring-distance for sculpt (past horde / meadow). */
    sculptFrom: MOUNTAIN_DENSE_FROM,
} as const;

const PEAK_END = 500;

export interface UltraSculptCtx {
    halfW: number;
    halfH: number;
    noise: (x: number, z: number) => number;
    seed: number;
}

/**
 * In-place sculpt of outer-ground positions (already Y-displaced by terrainHeight).
 */
export function sculptUltraMountainPositions(
    pos: BufferAttribute | InterleavedBufferAttribute,
    ctx: UltraSculptCtx,
    params: typeof ULTRA_MOUNTAIN = ULTRA_MOUNTAIN,
): void {
    const { halfW, halfH, noise, seed } = ctx;
    const sites = overhangSites(params.overhangCount, halfW, halfH, seed, noise);

    for (let i = 0; i < pos.count; i++) {
        const x0 = pos.getX(i);
        const z0 = pos.getZ(i);
        let y = pos.getY(i);

        const wx = Math.max(0, Math.abs(x0) - halfW);
        const wz = Math.max(0, Math.abs(z0) - halfH);
        const d = Math.hypot(wx, wz);
        if (d < params.sculptFrom || y < 8) continue;

        const climb =
            smooth01((d - params.sculptFrom) / 80) * (1 - smooth01((d - (PEAK_END - 40)) / 50));
        if (climb < 0.02) continue;

        // Outward XZ from the board (mountain grows this way). Overhang leans −fwd.
        const wlen = d || 1;
        const fwdX = ((x0 < -halfW ? -1 : x0 > halfW ? 1 : 0) * wx) / wlen;
        const fwdZ = ((z0 < -halfH ? -1 : z0 > halfH ? 1 : 0) * wz) / wlen;
        if (fwdX === 0 && fwdZ === 0) continue;

        const y0 = y;
        // 0 at foothills → 1 near crest: how much this vert is “upper rock”
        const hLean = smooth01((y0 - 35) / 160);

        const shelfN = noise(x0 / 55 + 19.2, z0 / 55 + 7.7);
        const cliffN = noise(x0 / 38 + 3.1, z0 / 38 + 44.4);
        const micro = noise(x0 / 14 + 8.8, z0 / 14 + 2.2);

        // Flatten alpine ledges — never raise above y0.
        const shelfMask =
            smooth01((shelfN - 0.58) / 0.22) *
            smooth01((y - 40) / 50) *
            (1 - smooth01((y - 200) / 80)) *
            climb *
            params.flatStrength;
        if (shelfMask > 0.01) {
            const shelfY = Math.min(y0, 55 + shelfN * 70 + micro * 8);
            y = y * (1 - shelfMask) + shelfY * shelfMask;
        }

        // Steepen: deepen recesses only.
        const steepMask =
            smooth01((cliffN - 0.48) / 0.28) *
            smooth01((y - 25) / 40) *
            climb *
            params.cliffStrength *
            (1 - shelfMask);
        if (steepMask > 0.01) {
            const base = 20 + noise(x0 / 90 + 1.1, z0 / 90 + 5.5) * 90;
            const delta = y - base;
            if (delta < 0) y = base + delta * (1 + steepMask * 1.35);
        }

        // --- Overhang: higher verts sit closer to board center than lower ones ---
        // leanAmt grows with height so each step up moves “a bit back to the center”.
        let leanAmt = params.globalLean * hLean * hLean * climb * (1 - shelfMask * 0.85);

        for (const site of sites) {
            const dd = Math.hypot(x0 - site.x, z0 - site.z);
            if (dd > params.overhangRadius) continue;
            const fall = 1 - dd / params.overhangRadius;
            const fallW = fall * fall * (3 - 2 * fall);
            // Strong lean only on the face (not on flat shelves)
            leanAmt += params.overhangLean * hLean * hLean * fallW * site.strength * (1 - shelfMask);
        }

        // Extra lean on cliffy noise so steep walls overhang more
        leanAmt += steepMask * hLean * 12;

        const dx = -fwdX * leanAmt;
        const dz = -fwdZ * leanAmt;

        y = Math.min(y, y0);
        pos.setXYZ(i, x0 + dx, y, z0 + dz);
    }

    pos.needsUpdate = true;
}

function overhangSites(
    count: number,
    halfW: number,
    halfH: number,
    seed: number,
    noise: (x: number, z: number) => number,
): { x: number; z: number; strength: number }[] {
    const out: { x: number; z: number; strength: number }[] = [];
    for (let i = 0; i < count; i++) {
        const t = (i + 0.17) / count;
        const ang = t * Math.PI * 2 + seed * 0.0001;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const d = 250 + noise(ca * 40 + i, sa * 40 + seed * 0.01) * 100;
        out.push({
            x: ca * (halfW + d),
            z: sa * (halfH + d),
            strength: 0.75 + noise(i * 3.7 + 2.1, seed * 0.02) * 0.25,
        });
    }
    return out;
}

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}
