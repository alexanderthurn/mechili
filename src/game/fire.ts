/**
 * Shared oil / fire hazard layer for the battlefield.
 *
 * Deterministic: no randomness, fixed neighbor order, integer cell indices.
 * Both peers must build the same field from the same actions + sim steps.
 *
 * - Oil persists across rounds (per-cell expiresRound).
 * - Fire is battle-only (cleared when the battle ends).
 * - Igniting any oil cell flood-fills the whole connected oil component.
 */

import { CELL, STANDARD_MAP, type MapSize } from './map';

/** world units per hazard cell — finer than board tiles for splat connectivity */
export const HAZARD_CELL = 2;

/** default Oil Spill tactic stamp */
export const OIL_SPILL_RADIUS = 4 * CELL;
export const OIL_SPILL_DURATION_ROUNDS = 2;

/** Fire Bolt / weapon ground-fire defaults (can be overridden per UnitType.fire) */
export const DEFAULT_GROUND_FIRE_DURATION = 8;
export const DEFAULT_GROUND_FIRE_INTENSITY = 28;

/** ground units on oil cells move at this fraction of normal speed */
export const OIL_SPEED_MULT = 0.55;

export interface FireBurnSpec {
    /** damage per second while burning */
    dps: number;
    /** seconds; re-hit refreshes the timer */
    duration: number;
}

export interface FireGroundSpec {
    /** how much ground lights up around the impact */
    radius: number;
    /** active flame lifetime (battle seconds) */
    duration: number;
    /** DPS applied each step to ground units standing in the fire */
    intensity: number;
}

/** weapon / rocket profile — burn victims and/or ignite the ground */
export interface FireProfile {
    burn?: FireBurnSpec;
    ground?: FireGroundSpec;
}

/** how strongly a unit type takes burn damage (1 = normal, 0 = immune) */
export interface BurnAffinity {
    takenMult: number;
    durationMult?: number;
}

export function mapHazardSize(size: MapSize = STANDARD_MAP): {
    cols: number;
    rows: number;
    width: number;
    height: number;
    halfW: number;
    halfH: number;
} {
    const cols = size.zoneCols + 2 * size.flankCols;
    const rows = 2 * size.zoneRows + size.neutralRows;
    const width = cols * CELL;
    const height = rows * CELL;
    return { cols, rows, width, height, halfW: width / 2, halfH: height / 2 };
}

/**
 * One shared oil+fire grid. Match state owns oil; BattleSim clones oil and
 * owns fire for the battle, then returns remaining oil at battle end.
 */
export class HazardField {
    readonly cellCols: number;
    readonly cellRows: number;
    readonly cellSize: number;
    readonly halfW: number;
    readonly halfH: number;
    /** last inclusive round the oil cell remains (0 = empty) */
    readonly oilExpires: Uint16Array;
    /** sim elapsed when fire in this cell ends (0 = empty) */
    readonly fireUntil: Float32Array;
    /** DPS while standing in this fire cell */
    readonly fireDps: Float32Array;

    constructor(mapSize: MapSize = STANDARD_MAP, cellSize = HAZARD_CELL) {
        const m = mapHazardSize(mapSize);
        this.cellSize = cellSize;
        this.halfW = m.halfW;
        this.halfH = m.halfH;
        this.cellCols = Math.ceil(m.width / cellSize);
        this.cellRows = Math.ceil(m.height / cellSize);
        const n = this.cellCols * this.cellRows;
        this.oilExpires = new Uint16Array(n);
        this.fireUntil = new Float32Array(n);
        this.fireDps = new Float32Array(n);
    }

    /** empty field with the same dimensions (used by clone helpers) */
    static blankLike(src: HazardField): HazardField {
        const f = Object.create(HazardField.prototype) as HazardField;
        (f as { cellCols: number }).cellCols = src.cellCols;
        (f as { cellRows: number }).cellRows = src.cellRows;
        (f as { cellSize: number }).cellSize = src.cellSize;
        (f as { halfW: number }).halfW = src.halfW;
        (f as { halfH: number }).halfH = src.halfH;
        const n = src.cellCols * src.cellRows;
        (f as { oilExpires: Uint16Array }).oilExpires = new Uint16Array(n);
        (f as { fireUntil: Float32Array }).fireUntil = new Float32Array(n);
        (f as { fireDps: Float32Array }).fireDps = new Float32Array(n);
        return f;
    }

    index(cx: number, cz: number): number {
        return cz * this.cellCols + cx;
    }

    inBounds(cx: number, cz: number): boolean {
        return cx >= 0 && cz >= 0 && cx < this.cellCols && cz < this.cellRows;
    }

    /** world → cell (deterministic floor toward -∞ via Math.floor) */
    worldToCell(x: number, z: number): { cx: number; cz: number } {
        const cx = Math.floor((x + this.halfW) / this.cellSize);
        const cz = Math.floor((z + this.halfH) / this.cellSize);
        return { cx, cz };
    }

    cellCenter(cx: number, cz: number): { x: number; z: number } {
        return {
            x: -this.halfW + (cx + 0.5) * this.cellSize,
            z: -this.halfH + (cz + 0.5) * this.cellSize,
        };
    }

    clearFire(): void {
        this.fireUntil.fill(0);
        this.fireDps.fill(0);
    }

    clearOil(): void {
        this.oilExpires.fill(0);
    }

    /** drop oil that has expired before `round` (inclusive last round already passed) */
    expireOilBefore(round: number): void {
        for (let i = 0; i < this.oilExpires.length; i++) {
            const exp = this.oilExpires[i]!;
            if (exp !== 0 && exp < round) this.oilExpires[i] = 0;
        }
    }

    /** copy oil (+ empty fire) for a new battle — fire never carries over */
    cloneForBattle(): HazardField {
        const copy = HazardField.blankLike(this);
        copy.oilExpires.set(this.oilExpires);
        return copy;
    }

    /** replace match oil with post-battle remaining oil (fire discarded) */
    adoptOilFrom(battle: HazardField): void {
        this.oilExpires.set(battle.oilExpires);
        this.clearFire();
    }

    /**
     * Stamp a disc of oil. Overlapping cells keep the later expiry
     * (`Math.max`). Order of cell writes is row-major ix, iz — deterministic.
     */
    stampOil(x: number, z: number, radius: number, expiresRound: number): void {
        if (radius <= 0 || expiresRound <= 0) return;
        const r2 = radius * radius;
        const { cx: c0, cz: z0 } = this.worldToCell(x, z);
        const span = Math.ceil(radius / this.cellSize) + 1;
        for (let cz = z0 - span; cz <= z0 + span; cz++) {
            for (let cx = c0 - span; cx <= c0 + span; cx++) {
                if (!this.inBounds(cx, cz)) continue;
                const c = this.cellCenter(cx, cz);
                const dx = c.x - x;
                const dz = c.z - z;
                if (dx * dx + dz * dz > r2) continue;
                const i = this.index(cx, cz);
                const prev = this.oilExpires[i]!;
                this.oilExpires[i] = prev === 0 ? expiresRound : Math.max(prev, expiresRound);
            }
        }
    }

    /**
     * Light a disc of ground fire at battle time `now`, lasting until
     * `now + duration`. Then ignite every oil cell connected to those seeds.
     * Returns how many oil cells were consumed (for VFX events).
     */
    stampFire(
        x: number,
        z: number,
        radius: number,
        now: number,
        duration: number,
        intensity: number,
    ): number {
        if (radius <= 0 || duration <= 0 || intensity <= 0) return 0;
        const until = now + duration;
        const r2 = radius * radius;
        const { cx: c0, cz: z0 } = this.worldToCell(x, z);
        const span = Math.ceil(radius / this.cellSize) + 1;
        const seedOil: number[] = [];

        for (let cz = z0 - span; cz <= z0 + span; cz++) {
            for (let cx = c0 - span; cx <= c0 + span; cx++) {
                if (!this.inBounds(cx, cz)) continue;
                const c = this.cellCenter(cx, cz);
                const dx = c.x - x;
                const dz = c.z - z;
                if (dx * dx + dz * dz > r2) continue;
                const i = this.index(cx, cz);
                this.setFireCell(i, until, intensity);
                if (this.oilExpires[i]! !== 0) seedOil.push(i);
            }
        }

        return this.igniteConnectedOil(seedOil, until, intensity);
    }

    private setFireCell(i: number, until: number, intensity: number): void {
        const prev = this.fireUntil[i]!;
        if (prev === 0 || until > prev) this.fireUntil[i] = until;
        this.fireDps[i] = Math.max(this.fireDps[i]!, intensity);
    }

    /**
     * BFS over oil cells (4-neighbor, fixed order). Converts oil → fire.
     * Scratch visit uses fireUntil temporarily only for oil cells being processed
     * via a separate Uint8Array to stay clear.
     */
    igniteConnectedOil(seedIndices: number[], until: number, intensity: number): number {
        if (seedIndices.length === 0) return 0;
        const visited = new Uint8Array(this.oilExpires.length);
        const queue: number[] = [];
        for (const i of seedIndices) {
            if (this.oilExpires[i]! === 0 || visited[i]) continue;
            visited[i] = 1;
            queue.push(i);
        }
        // stable seed order already; BFS expands with fixed neighbor deltas
        const neigh = [-1, 1, -this.cellCols, this.cellCols];
        let consumed = 0;
        let head = 0;
        while (head < queue.length) {
            const i = queue[head++]!;
            this.oilExpires[i] = 0;
            this.setFireCell(i, until, intensity);
            consumed++;
            const cx = i % this.cellCols;
            const cz = (i / this.cellCols) | 0;
            for (const d of neigh) {
                const j = i + d;
                if (j < 0 || j >= this.oilExpires.length) continue;
                // reject wrap on left/right edges
                if (d === -1 && cx === 0) continue;
                if (d === 1 && cx === this.cellCols - 1) continue;
                if (d === -this.cellCols && cz === 0) continue;
                if (d === this.cellCols && cz === this.cellRows - 1) continue;
                if (visited[j] || this.oilExpires[j]! === 0) continue;
                visited[j] = 1;
                queue.push(j);
            }
        }
        return consumed;
    }

    /** expire finished fire cells (call each sim step) */
    tickFire(now: number): void {
        for (let i = 0; i < this.fireUntil.length; i++) {
            if (this.fireUntil[i]! !== 0 && this.fireUntil[i]! <= now) {
                this.fireUntil[i] = 0;
                this.fireDps[i] = 0;
            }
        }
    }

    /** strongest active fire DPS under a world point (0 if none) */
    fireDpsAt(x: number, z: number, now: number): number {
        const { cx, cz } = this.worldToCell(x, z);
        if (!this.inBounds(cx, cz)) return 0;
        const i = this.index(cx, cz);
        if (this.fireUntil[i]! <= now) return 0;
        return this.fireDps[i]!;
    }

    hasOilAt(x: number, z: number): boolean {
        const { cx, cz } = this.worldToCell(x, z);
        if (!this.inBounds(cx, cz)) return false;
        return this.oilExpires[this.index(cx, cz)]! !== 0;
    }

    /** iterate active fire cell centers (for VFX — order is deterministic) */
    forEachFireCell(now: number, fn: (x: number, z: number, dps: number, until: number) => void): void {
        for (let cz = 0; cz < this.cellRows; cz++) {
            for (let cx = 0; cx < this.cellCols; cx++) {
                const i = this.index(cx, cz);
                const until = this.fireUntil[i]!;
                if (until <= now) continue;
                const c = this.cellCenter(cx, cz);
                fn(c.x, c.z, this.fireDps[i]!, until);
            }
        }
    }

    forEachOilCell(fn: (x: number, z: number, expiresRound: number) => void): void {
        for (let cz = 0; cz < this.cellRows; cz++) {
            for (let cx = 0; cx < this.cellCols; cx++) {
                const i = this.index(cx, cz);
                const exp = this.oilExpires[i]!;
                if (exp === 0) continue;
                const c = this.cellCenter(cx, cz);
                fn(c.x, c.z, exp);
            }
        }
    }
}

/** refresh timer + keep strongest DPS (affinity already applied by caller) */
export function applyBurnStatus(
    state: { burnUntil: number; burnDps: number },
    now: number,
    dps: number,
    duration: number,
): void {
    if (dps <= 0 || duration <= 0) return;
    state.burnUntil = now + duration;
    state.burnDps = Math.max(state.burnDps, dps);
}
