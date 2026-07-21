/**
 * Shared oil / fire / acid hazard layer for the battlefield.
 *
 * Deterministic: no randomness, fixed neighbor order, integer cell indices.
 * Both peers must build the same field from the same actions + sim steps.
 *
 * - Oil AND acid persist across rounds (per-cell expiresRound). At battle
 *   start they pour left→right as drips (shield discs stay clear).
 * - Fire Spill pours the same way but is battle-only (cleared when the
 *   battle ends); weapon/meteor fire shares that channel.
 * - Igniting any oil cell flood-fills the whole connected oil component.
 */

import { CELL, STANDARD_MAP, type MapSize } from './map';

/** world units per hazard cell — finer than board tiles for splat connectivity */
export const HAZARD_CELL = 2;

/** default Oil Spill tactic stamp */
export const OIL_SPILL_RADIUS = 4 * CELL;
export const OIL_SPILL_DURATION_ROUNDS = 1;

/** default Acid Spill tactic stamp — same shape as oil, different per-step effect */
export const ACID_SPILL_RADIUS = 4 * CELL;
export const ACID_SPILL_DURATION_ROUNDS = 1;
/** percent of MAX HP per second while standing in acid (a global rate, like OIL_SPEED_MULT) */
export const ACID_DPS_PERCENT = 3;

/** Fire Spill — same capsule as oil/acid; battle-seconds burn (not round expiry) */
export const FIRE_SPILL_RADIUS = 4 * CELL;
export const FIRE_SPILL_BURN_SEC = 12;
export const FIRE_SPILL_INTENSITY = 14;

/** after battle freeze, wait this long before the first drip starts falling */
export const HAZARD_POUR_DELAY_SEC = 0.55;
/** time to sweep drips from capsule start → end */
export const HAZARD_POUR_DURATION_SEC = 1.35;
/** how long each drip falls through the air before hitting the ground */
export const HAZARD_DRIP_FALL_SEC = 0.4;

/** one oil/acid/fire capsule that pours left→right during battle */
export interface HazardPour {
    kind: 'oil' | 'acid' | 'fire';
    x: number;
    z: number;
    x2: number;
    z2: number;
    radius: number;
    /** seconds after battle freeze before the first drip starts falling */
    delaySeconds: number;
    /** seconds to sweep drips from start → end */
    durationSeconds: number;
    /** oil/acid: inclusive round expiry; unused for fire (0) */
    expiresRound: number;
    /** fire only: ground-fire lifetime from impact */
    burnSeconds?: number;
    /** fire only: DPS intensity for the stamped disc */
    intensity?: number;
    /**
     * Fire only: direct damage applied in the stamped disc when the drip lands
     * (dragon breath). Ward domes absorb like spell strikes.
     */
    damage?: number;
    /**
     * Air-fall before stamp (defaults to {@link HAZARD_DRIP_FALL_SEC}).
     * Use 0 for an instant ground paint (dragon breath ray).
     */
    fallSeconds?: number;
}

/** Fire Bolt / weapon ground-fire defaults (can be overridden per UnitType.fire) */
export const DEFAULT_GROUND_FIRE_DURATION = 16;
export const DEFAULT_GROUND_FIRE_INTENSITY = 14;

/** ground units on oil cells move at this fraction of normal speed */
export const OIL_SPEED_MULT = 0.55;

/** ground circle of an active ward stone (blocks oil stamps into its disc) */
export type ShieldDisk = { x: number; z: number; radius: number };

/** every living ward stone disc (oil cannot enter any dome) */
export function livingShieldDisks(
    units: readonly {
        consumed: boolean;
        destroyed: boolean;
        world: { x: number; z: number };
        type: { shield?: { radius: number } };
    }[],
): ShieldDisk[] {
    const out: ShieldDisk[] = [];
    for (const u of units) {
        if (u.consumed || u.destroyed) continue;
        const spec = u.type.shield;
        if (!spec) continue;
        out.push({ x: u.world.x, z: u.world.z, radius: spec.radius });
    }
    return out;
}

export function insideAnyShield(x: number, z: number, shields: readonly ShieldDisk[]): boolean {
    for (const s of shields) {
        const dx = x - s.x;
        const dz = z - s.z;
        if (dx * dx + dz * dz <= s.radius * s.radius) return true;
    }
    return false;
}

/** first ward disc covering a world XZ point (if any) */
export function shieldAtPoint(
    x: number,
    z: number,
    shields: readonly ShieldDisk[],
): ShieldDisk | null {
    for (const s of shields) {
        const dx = x - s.x;
        const dz = z - s.z;
        if (dx * dx + dz * dz <= s.radius * s.radius) return s;
    }
    return null;
}

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

/** weapon / rocket profile — burn victims, ignite ground, and/or stamp oil */
export interface FireProfile {
    burn?: FireBurnSpec;
    ground?: FireGroundSpec;
    /** splash oil onto the shared hazard layer at impact (shield discs stay clear) */
    oil?: { radius: number };
}

/**
 * UnitType.fire plus any owned tech `fire` profiles. Tech fields overlay
 * (tech oil/ground/burn replace missing base fields; both present → tech wins).
 */
export function resolveFireProfile(
    type: { id: string; fire?: FireProfile; techs: { id: string; fire?: FireProfile }[] },
    team: string,
    hasTech: (team: 'player' | 'enemy', typeId: string, techId: string) => boolean,
): FireProfile | undefined {
    let profile: FireProfile | undefined = type.fire
        ? {
              burn: type.fire.burn ? { ...type.fire.burn } : undefined,
              ground: type.fire.ground ? { ...type.fire.ground } : undefined,
              oil: type.fire.oil ? { ...type.fire.oil } : undefined,
          }
        : undefined;
    for (const tech of type.techs) {
        if (!tech.fire || !hasTech(team as 'player' | 'enemy', type.id, tech.id)) continue;
        if (!profile) profile = {};
        if (tech.fire.burn) profile.burn = { ...tech.fire.burn };
        if (tech.fire.ground) profile.ground = { ...tech.fire.ground };
        if (tech.fire.oil) profile.oil = { ...tech.fire.oil };
    }
    if (!profile?.burn && !profile?.ground && !profile?.oil) return undefined;
    return profile;
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
    /** last inclusive round the acid cell remains (0 = empty) — same model as oilExpires */
    readonly acidExpires: Uint16Array;

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
        this.acidExpires = new Uint16Array(n);
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
        (f as { acidExpires: Uint16Array }).acidExpires = new Uint16Array(n);
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

    clearAcid(): void {
        this.acidExpires.fill(0);
    }

    /** wipe oil cells that sit inside any of the given ward discs */
    clearOilInsideShields(shields: readonly ShieldDisk[]): void {
        if (shields.length === 0) return;
        for (let cz = 0; cz < this.cellRows; cz++) {
            for (let cx = 0; cx < this.cellCols; cx++) {
                const i = this.index(cx, cz);
                if (this.oilExpires[i]! === 0) continue;
                const c = this.cellCenter(cx, cz);
                if (insideAnyShield(c.x, c.z, shields)) this.oilExpires[i] = 0;
            }
        }
    }

    /** wipe acid cells that sit inside any of the given ward discs */
    clearAcidInsideShields(shields: readonly ShieldDisk[]): void {
        if (shields.length === 0) return;
        for (let cz = 0; cz < this.cellRows; cz++) {
            for (let cx = 0; cx < this.cellCols; cx++) {
                const i = this.index(cx, cz);
                if (this.acidExpires[i]! === 0) continue;
                const c = this.cellCenter(cx, cz);
                if (insideAnyShield(c.x, c.z, shields)) this.acidExpires[i] = 0;
            }
        }
    }

    /** drop oil that has expired before `round` (inclusive last round already passed) */
    expireOilBefore(round: number): void {
        for (let i = 0; i < this.oilExpires.length; i++) {
            const exp = this.oilExpires[i]!;
            if (exp !== 0 && exp < round) this.oilExpires[i] = 0;
        }
    }

    /** drop acid that has expired before `round` — same rule as expireOilBefore */
    expireAcidBefore(round: number): void {
        for (let i = 0; i < this.acidExpires.length; i++) {
            const exp = this.acidExpires[i]!;
            if (exp !== 0 && exp < round) this.acidExpires[i] = 0;
        }
    }

    /** copy oil + acid (+ empty fire) for a new battle — fire never carries over */
    cloneForBattle(): HazardField {
        const copy = HazardField.blankLike(this);
        copy.oilExpires.set(this.oilExpires);
        copy.acidExpires.set(this.acidExpires);
        return copy;
    }

    /** replace match oil + acid with post-battle remainders (fire discarded) */
    adoptOilFrom(battle: HazardField): void {
        this.oilExpires.set(battle.oilExpires);
        this.acidExpires.set(battle.acidExpires);
        this.clearFire();
    }

    /**
     * Visit cell centers covered by a disc stamp (same geometry as
     * {@link stampOil} / fire discs). No mutation — used for placement preview.
     */
    forEachDiscCells(
        x: number,
        z: number,
        radius: number,
        fn: (wx: number, wz: number, cx: number, cz: number) => void,
    ): void {
        if (radius <= 0) return;
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
                fn(c.x, c.z, cx, cz);
            }
        }
    }

    /**
     * Stadium / capsule: cells within `radius` of either endpoint or the
     * segment between them. Same silhouette as a two-circle oil spill.
     */
    forEachCapsuleCells(
        ax: number,
        az: number,
        bx: number,
        bz: number,
        radius: number,
        fn: (wx: number, wz: number, cx: number, cz: number) => void,
    ): void {
        if (radius <= 0) return;
        const r2 = radius * radius;
        const minX = Math.min(ax, bx) - radius;
        const maxX = Math.max(ax, bx) + radius;
        const minZ = Math.min(az, bz) - radius;
        const maxZ = Math.max(az, bz) + radius;
        const { cx: c0 } = this.worldToCell(minX, minZ);
        const { cx: c1 } = this.worldToCell(maxX, maxZ);
        const { cz: z0 } = this.worldToCell(minX, minZ);
        const { cz: z1 } = this.worldToCell(maxX, maxZ);
        const abx = bx - ax;
        const abz = bz - az;
        const ab2 = abx * abx + abz * abz;
        for (let cz = z0; cz <= z1; cz++) {
            for (let cx = c0; cx <= c1; cx++) {
                if (!this.inBounds(cx, cz)) continue;
                const c = this.cellCenter(cx, cz);
                let d2: number;
                if (ab2 < 1e-12) {
                    const dx = c.x - ax;
                    const dz = c.z - az;
                    d2 = dx * dx + dz * dz;
                } else {
                    let t = ((c.x - ax) * abx + (c.z - az) * abz) / ab2;
                    if (t < 0) t = 0;
                    else if (t > 1) t = 1;
                    const qx = ax + abx * t;
                    const qz = az + abz * t;
                    const dx = c.x - qx;
                    const dz = c.z - qz;
                    d2 = dx * dx + dz * dz;
                }
                if (d2 > r2) continue;
                fn(c.x, c.z, cx, cz);
            }
        }
    }

    /**
     * Stamp a disc of oil. Overlapping cells keep the later expiry
     * (`Math.max`). Order of cell writes is row-major ix, iz — deterministic.
     * Pass battle `now` so oil cannot land under (or stay next to) live flame.
     */
    stampOil(
        x: number,
        z: number,
        radius: number,
        expiresRound: number,
        blockedBy: readonly ShieldDisk[] = [],
        now?: number,
    ): void {
        if (expiresRound <= 0) return;
        this.forEachDiscCells(x, z, radius, (wx, wz, cx, cz) => {
            if (blockedBy.length > 0 && insideAnyShield(wx, wz, blockedBy)) return;
            const i = this.index(cx, cz);
            // flame already owns this cell — oil would be burned instantly
            if (now !== undefined && this.fireUntil[i]! > now) return;
            const prev = this.oilExpires[i]!;
            this.oilExpires[i] = prev === 0 ? expiresRound : Math.max(prev, expiresRound);
        });
        if (now !== undefined) this.igniteOilTouchingFire(now);
    }

    /** stamp oil into a two-circle capsule (strip + both discs) */
    stampOilCapsule(
        ax: number,
        az: number,
        bx: number,
        bz: number,
        radius: number,
        expiresRound: number,
        /** cells inside these discs are skipped (enemy ward stones) */
        blockedBy: readonly ShieldDisk[] = [],
    ): void {
        if (expiresRound <= 0) return;
        this.forEachCapsuleCells(ax, az, bx, bz, radius, (wx, wz, cx, cz) => {
            if (blockedBy.length > 0 && insideAnyShield(wx, wz, blockedBy)) return;
            const i = this.index(cx, cz);
            const prev = this.oilExpires[i]!;
            this.oilExpires[i] = prev === 0 ? expiresRound : Math.max(prev, expiresRound);
        });
    }

    /** stamp a disc of acid (ward discs skipped) — used by progressive pour drips */
    stampAcid(
        x: number,
        z: number,
        radius: number,
        expiresRound: number,
        blockedBy: readonly ShieldDisk[] = [],
    ): void {
        if (expiresRound <= 0) return;
        this.forEachDiscCells(x, z, radius, (wx, wz, cx, cz) => {
            if (blockedBy.length > 0 && insideAnyShield(wx, wz, blockedBy)) return;
            const i = this.index(cx, cz);
            const prev = this.acidExpires[i]!;
            this.acidExpires[i] = prev === 0 ? expiresRound : Math.max(prev, expiresRound);
        });
    }

    /**
     * Stamp acid into a two-circle capsule — same geometry / expiry / ward
     * blocking as {@link stampOilCapsule}. Prefer progressive drips in battle;
     * this remains for any full-capsule commit helpers.
     */
    stampAcidCapsule(
        ax: number,
        az: number,
        bx: number,
        bz: number,
        radius: number,
        expiresRound: number,
        /** cells inside these discs are skipped (enemy ward stones) */
        blockedBy: readonly ShieldDisk[] = [],
    ): void {
        if (expiresRound <= 0) return;
        this.forEachCapsuleCells(ax, az, bx, bz, radius, (wx, wz, cx, cz) => {
            if (blockedBy.length > 0 && insideAnyShield(wx, wz, blockedBy)) return;
            const i = this.index(cx, cz);
            const prev = this.acidExpires[i]!;
            this.acidExpires[i] = prev === 0 ? expiresRound : Math.max(prev, expiresRound);
        });
    }

    hasAcidAt(x: number, z: number): boolean {
        const { cx, cz } = this.worldToCell(x, z);
        if (!this.inBounds(cx, cz)) return false;
        return this.acidExpires[this.index(cx, cz)]! !== 0;
    }

    /** iterate active acid cell centers (for VFX — order is deterministic) */
    forEachAcidCell(fn: (x: number, z: number, expiresRound: number) => void): void {
        for (let cz = 0; cz < this.cellRows; cz++) {
            for (let cx = 0; cx < this.cellCols; cx++) {
                const i = this.index(cx, cz);
                const exp = this.acidExpires[i]!;
                if (exp === 0) continue;
                const c = this.cellCenter(cx, cz);
                fn(c.x, c.z, exp);
            }
        }
    }

    /**
     * Light a disc of ground fire at battle time `now`, lasting until
     * `now + duration`. Then ignite every oil cell connected to those seeds.
     * Returns how many oil cells were consumed (for VFX events).
     * Cells inside `blockedBy` ward discs are skipped (Fire Spill / shields).
     */
    stampFire(
        x: number,
        z: number,
        radius: number,
        now: number,
        duration: number,
        intensity: number,
        blockedBy: readonly ShieldDisk[] = [],
    ): number {
        if (radius <= 0 || duration <= 0 || intensity <= 0) return 0;
        const until = now + duration;
        const seedOil: number[] = [];

        this.forEachDiscCells(x, z, radius, (wx, wz, cx, cz) => {
            if (blockedBy.length > 0 && insideAnyShield(wx, wz, blockedBy)) return;
            const i = this.index(cx, cz);
            this.setFireCell(i, until, intensity);
            if (this.oilExpires[i]! !== 0) seedOil.push(i);
        });

        const consumed = this.igniteConnectedOil(seedOil, until, intensity);
        // any oil that somehow still sits under the new blaze is gone
        this.consumeOilUnderFire(now);
        return consumed;
    }

    /** oil cannot remain under active flame — burned away immediately */
    consumeOilUnderFire(now: number): void {
        for (let i = 0; i < this.oilExpires.length; i++) {
            if (this.fireUntil[i]! > now && this.oilExpires[i]! !== 0) {
                this.oilExpires[i] = 0;
            }
        }
    }

    /**
     * Oil that touches a live fire cell ignites as one connected component
     * (e.g. pitch bolted next to an existing blaze).
     */
    igniteOilTouchingFire(now: number): number {
        const seeds: number[] = [];
        let until = now;
        let intensity = 0;
        const neigh = [-1, 1, -this.cellCols, this.cellCols];
        for (let i = 0; i < this.fireUntil.length; i++) {
            const fireUntil = this.fireUntil[i]!;
            if (fireUntil <= now) continue;
            until = Math.max(until, fireUntil);
            intensity = Math.max(intensity, this.fireDps[i]!);
            if (this.oilExpires[i]! !== 0) seeds.push(i);
            const cx = i % this.cellCols;
            const cz = (i / this.cellCols) | 0;
            for (const d of neigh) {
                const j = i + d;
                if (j < 0 || j >= this.oilExpires.length) continue;
                if (d === -1 && cx === 0) continue;
                if (d === 1 && cx === this.cellCols - 1) continue;
                if (d === -this.cellCols && cz === 0) continue;
                if (d === this.cellCols && cz === this.cellRows - 1) continue;
                if (this.oilExpires[j]! !== 0) seeds.push(j);
            }
        }
        if (seeds.length === 0 || intensity <= 0) {
            this.consumeOilUnderFire(now);
            return 0;
        }
        const consumed = this.igniteConnectedOil(seeds, until, intensity);
        this.consumeOilUnderFire(now);
        return consumed;
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
