import {
    CanvasTexture,
    Color,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    Vector2,
    Vector3,
} from 'three';

import {
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    loadWorldTexture,
} from './worldTextures';

/** world units covered by one repeat of the grass detail texture (field AND outer meadow) */
export const DETAIL_TILE = 20;
export { grassAlbedoUrl, grassNormalUrl, sandAlbedoUrl };

/** world units per grid tile */
export const CELL = 4;

import { THEME } from '../theme';
import { teamColors } from './colors';
import { prefs, type GroundEffectsQuality } from './prefs';

export interface Cell {
    col: number;
    row: number;
}

export function cellKey(cell: Cell): string {
    return `${cell.col}:${cell.row}`;
}

/** The composable dimensions of a battlefield, all in tiles. */
export interface MapSize {
    /** each player's main territory width */
    zoneCols: number;
    /** each player's main territory depth */
    zoneRows: number;
    /** no-placement strip between the two territories (split evenly) */
    neutralRows: number;
    /** width of the flank strips beside the opponent's half */
    flankCols: number;
}

export const STANDARD_MAP: MapSize = {
    zoneCols: 60,
    zoneRows: 30,
    neutralRows: 4,
    flankCols: 6,
};

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where each side's base buildings sit: `xFrac` across the zone width,
 * `rowFrac` into the zone depth (0 = own edge, 1 = toward the neutral strip),
 * `r` the flat-relief radius around the building. Shared by game.ts
 * (spawning) and BattleMap (keeping the ground flat underneath).
 */
export const BASE_ANCHORS = {
    research: { xFrac: 0.25, rowFrac: 0.62, r: 9 },
    command: { xFrac: 0.75, rowFrac: 0.62, r: 9 },
    stronghold: { xFrac: 0.5, rowFrac: 0.22, r: 14 },
} as const;

let groundHeightFn: (x: number, z: number) => number = () => 0;

/**
 * Visual terrain height under a world position. Unit MESHES ride this so they
 * stand on the relief; the sim itself keeps walking on the flat y=0 plane.
 * Wired to the active BattleMap when it is constructed.
 */
export function groundHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z);
}

let outerHeightFn: (x: number, z: number) => number = () => 0;

/** the scenery registers its outer-terrain height here (0 inside the board) */
export function registerOuterHeight(fn: (x: number, z: number) => number): void {
    outerHeightFn = fn;
}

/** total visual terrain height anywhere: board relief + outer world */
export function worldHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z) + outerHeightFn(x, z);
}

/**
 * Height that keeps a footprint clear of the relief. Uses a single center
 * sample (cheap enough for per-frame battle seating); steep mounds may clip
 * the uphill edge slightly.
 */
export function groundSupportAt(x: number, z: number, _radius = 0.7): number {
    return groundHeightFn(x, z);
}

/**
 * SIM-side alias of {@link groundHeightAt}. The board height is never gated
 * by graphics settings, so both names return the same value — the sim code
 * uses this name to make its determinism requirement explicit.
 */
export function simGroundHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z);
}

/** sim-side alias of {@link groundSupportAt} */
export function simGroundSupportAt(x: number, z: number, _radius = 0.7): number {
    return groundHeightFn(x, z);
}

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/** seeded smooth 2D value noise in [0, 1] — cheap terrain-shaping building block */
export function makeValueNoise(seed: number): (x: number, y: number) => number {
    const lattice = (ix: number, iy: number): number => {
        let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 69069)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const sx = smooth01(x - ix);
        const sy = smooth01(y - iy);
        const a = lattice(ix, iy);
        const b = lattice(ix + 1, iy);
        const c = lattice(ix, iy + 1);
        const d = lattice(ix + 1, iy + 1);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
}

/**
 * A battlefield built from a {@link MapSize}. Owns the grid math
 * (world x: -halfW..+halfW with +x screen-right; world z: -halfH at the enemy
 * edge (far) to +halfH at the player edge (near); rows counted from the
 * player edge) and generates the ground mesh.
 */
export class BattleMap {
    readonly cols: number;
    readonly rows: number;
    readonly width: number;
    readonly height: number;
    readonly halfW: number;
    readonly halfH: number;

    /** round 1 restricts deployment to the main zones; the game unlocks these from round 2 */
    flanksUnlocked = false;
    /** when unlocked, the neutral strip is split between the players (half each) */
    neutralUnlocked = false;
    /**
     * Network guests own the FAR half: both peers hold the IDENTICAL board
     * and only the camera differs — no coordinates are ever mirrored.
     */
    ownAtFar = false;

    /** live sand-wear mask is ready for stamping */
    get sandReady(): boolean {
        return this.sandMask !== null;
    }

    /** the field's macro tone canvas — the outer meadow samples its clamped edge */
    groundMacro: CanvasTexture | null = null;

    /** live sand-wear mask (null until ground textures finish loading) */
    private sandMask: CanvasTexture | null = null;
    private sandCtx: CanvasRenderingContext2D | null = null;
    private sandW = 0;
    private sandH = 0;
    private sandSeed = 0;
    private sandDirty = false;
    private sandFlushAt = 0;

    /**
     * Oil / active-fire mask (separate from wear RGB): R = oil, G = fire.
     * Driven by HazardField for look only — never gameplay truth.
     */
    private hazardMask: CanvasTexture | null = null;
    private hazardCtx: CanvasRenderingContext2D | null = null;
    private hazardW = 0;
    private hazardH = 0;
    private hazardDirty = false;
    private hazardFlushAt = 0;
    /** updated each frame for fire flicker in the ground shader */
    private hazardTimeUniform: { value: number } | null = null;

    /** ground texture + wear quality (the board's SHAPE is never gated) */
    private groundEffects: GroundEffectsQuality = prefs().groundEffects;

    setGroundEffects(quality: GroundEffectsQuality): void {
        this.groundEffects = quality;
    }

    /** wear stamping runs on high/medium; 'low' keeps the texture only */
    private wearEnabled(): boolean {
        return this.groundEffects === 'high' || this.groundEffects === 'medium';
    }

    constructor(readonly size: MapSize = STANDARD_MAP) {
        this.cols = size.zoneCols + 2 * size.flankCols;
        this.rows = 2 * size.zoneRows + size.neutralRows;
        this.width = this.cols * CELL;
        this.height = this.rows * CELL;
        this.halfW = this.width / 2;
        this.halfH = this.height / 2;
        groundHeightFn = (x, z) => this.heightAt(x, z);
    }

    cellCenter(col: number, row: number): Vector3 {
        return new Vector3(-this.halfW + (col + 0.5) * CELL, 0, this.halfH - (row + 0.5) * CELL);
    }

    /** center of a cols x rows tile rectangle anchored at `cell` (its top-left, enemy-most tile) */
    areaCenter(cell: Cell, cols: number, rows: number): Vector3 {
        return new Vector3(
            -this.halfW + (cell.col + cols / 2) * CELL,
            0,
            this.halfH - (cell.row + rows / 2) * CELL,
        );
    }

    inBounds(cell: Cell): boolean {
        return cell.col >= 0 && cell.col < this.cols && cell.row >= 0 && cell.row < this.rows;
    }

    worldToCell(p: Vector3): Cell | null {
        const col = Math.floor((p.x + this.halfW) / CELL);
        const row = Math.floor((this.halfH - p.z) / CELL);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        return { col, row };
    }

    private inFlankCols(col: number): boolean {
        return col < this.size.flankCols || col >= this.cols - this.size.flankCols;
    }

    /** rows of a side's territory, measured from its own edge (grows into the neutral strip once unlocked) */
    private ownRows(): number {
        return this.size.zoneRows + (this.neutralUnlocked ? this.size.neutralRows / 2 : 0);
    }

    /** own half minus the opponent's flanks, plus (once unlocked) own flanks beside the opponent's half */
    private zoneHalf(cell: Cell, near: boolean): boolean {
        const zr = this.ownRows();
        const inNear = cell.row < zr;
        const inFar = cell.row >= this.rows - zr;
        const ownHalf = near ? inNear : inFar;
        const oppHalf = near ? inFar : inNear;
        if (!this.inFlankCols(cell.col)) return ownHalf;
        return this.flanksUnlocked && oppHalf;
    }

    isPlayerCell(cell: Cell): boolean {
        return this.zoneHalf(cell, !this.ownAtFar);
    }

    isEnemyCell(cell: Cell): boolean {
        return this.zoneHalf(cell, this.ownAtFar);
    }

    /** flank strips beside the opponent's half — deployable from round 2 once unlocked */
    isFlankDeployCell(cell: Cell, team: 'player' | 'enemy'): boolean {
        if (!this.flanksUnlocked || !this.inFlankCols(cell.col)) return false;
        const near = team === 'player' ? !this.ownAtFar : this.ownAtFar;
        const zr = this.ownRows();
        const oppHalf = near ? cell.row >= this.rows - zr : cell.row < zr;
        return oppHalf;
    }

    /** center row of a team's main zone (near = row 0 side, the +z edge) */
    zoneCenterRow(near: boolean): number {
        const half = Math.floor(this.size.zoneRows / 2);
        return near ? half : this.rows - 1 - half;
    }

    private readonly reliefNoise = makeValueNoise(9241);

    /**
     * Visual-only relief: gentle mounds rising up to `reliefDepth`, never
     * below 0. The sim keeps walking on the flat y=0 plane — feet wade a bit
     * into a mound, which the grass hides (better than hovering over dips).
     * Flat near the borders (to meet the outer meadow) and under the four
     * base buildings (so the castles sit cleanly).
     */
    /**
     * The board's relief. ALWAYS on — never gated by graphics settings: the
     * sim's ballistics read it, so it must be identical on every machine in a
     * match, and the visuals simply show the same truth.
     */
    heightAt(x: number, z: number): number {
        const WAVE = 46;
        const n =
            this.reliefNoise(x / WAVE + 37.2, z / WAVE + 11.7) * 0.72 +
            this.reliefNoise(x / (WAVE * 0.41) + 5.1, z / (WAVE * 0.41) + 91.3) * 0.28;
        const hill = smooth01((n - 0.44) / 0.42); // the higher part of the noise mounds up
        const edge = Math.min(this.halfW - Math.abs(x), this.halfH - Math.abs(z));
        let fade = smooth01(edge / 14);
        for (const a of this.baseAnchors()) {
            const d = Math.hypot(x - a.x, z - a.z);
            fade = Math.min(fade, smooth01((d - a.r) / 10));
        }
        return THEME.terrain.reliefDepth * hill * fade;
    }

    /** approximate centers of the base buildings on both sides (see game.ts spawnTowers) */
    baseAnchors(): { x: number; z: number; r: number }[] {
        const { flankCols, zoneCols, zoneRows } = this.size;
        const anchors: { x: number; z: number; r: number }[] = [];
        for (const a of Object.values(BASE_ANCHORS)) {
            const x = -this.halfW + (flankCols + zoneCols * a.xFrac) * CELL;
            const z = this.halfH - zoneRows * a.rowFrac * CELL;
            anchors.push({ x, z, r: a.r }, { x: -x, z: -z, r: a.r });
        }
        return anchors;
    }

    /** displace a ground-aligned plane's vertices by the relief height */
    private applyRelief(geometry: PlaneGeometry): void {
        const pos = geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
            pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
        }
        pos.needsUpdate = true;
    }

    /** The ground plane: a code-generated texture on a real 3D plane mesh. */
    createMesh(seed = 1337): Mesh {
        const geometry = new PlaneGeometry(this.width, this.height, this.cols * 2, this.rows * 2);
        geometry.rotateX(-Math.PI / 2); // lie flat; texture top edge faces -z (enemy side)
        this.applyRelief(geometry);
        geometry.computeVertexNormals();
        const macro = this.createGroundTexture(seed);
        this.groundMacro = macro; // scenery continues this tone past the border
        // Oil/fire is gameplay-visible: always on, fixed mask res — independent of
        // the cosmetic ground-effects pref (sand/blood/scorch).
        const hazardMask = this.ensureHazardMask();
        const material = new MeshStandardMaterial({
            map: macro,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        this.attachGroundShader(material, macro, { hazardMask });
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        // ground effects 'off' keeps the plain macro canvas — no detail textures /
        // wear, but oil+fire still show via the hazard inject above
        if (this.groundEffects !== 'off') {
            void this.upgradeGroundMaterial(mesh, macro, seed);
        }
        return mesh;
    }

    /**
     * Ground wear mask (RGB): R = sand, G = blood, B = scorch.
     * Starts with light sand patches; combat stamps accumulate. Sand stamps
     * use source-over red so walking gradually washes blood/burns back to sand.
     */
    private createSandMask(seed: number): CanvasTexture {
        const w = this.groundEffects === 'medium' ? 256 : 512;
        const h = Math.round((w * this.height) / this.width);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        this.sandW = w;
        this.sandH = h;
        this.sandSeed = seed;
        this.sandCtx = ctx;
        this.paintBaseSand(ctx, w, h, seed);
        const tex = new CanvasTexture(canvas);
        this.sandMask = tex;
        return tex;
    }

    /** faint loose sand patches only (R channel) — no building courtyards */
    private paintBaseSand(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        seed: number,
    ): void {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const rng = mulberry32(seed ^ 0x5eed);
        const pxPerUnit = w / this.width;
        const patches = Math.round((this.width * this.height) / 22000);
        for (let i = 0; i < patches; i++) {
            const cx = w * (0.08 + rng() * 0.84);
            const cy = h * (0.08 + rng() * 0.84);
            const blobs = 2 + Math.floor(rng() * 3);
            for (let b = 0; b < blobs; b++) {
                const r = (2.5 + rng() * 5) * pxPerUnit;
                this.drawWearBlob(
                    ctx,
                    cx + (rng() - 0.5) * r * 1.4,
                    cy + (rng() - 0.5) * r * 1.4,
                    r,
                    0.35 + rng() * 0.25,
                    'r',
                );
            }
        }
    }

    /**
     * Soft radial stamp into one mask channel. Source-over with a pure R/G/B
     * color fades the other channels — so sand (R) walking over blood (G)
     * gradually restores a sandy look.
     */
    private drawWearBlob(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        r: number,
        alpha: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const a = Math.min(1, Math.max(0.02, alpha));
        const rgb =
            channel === 'r' ? `255,0,0` : channel === 'g' ? `0,255,0` : `0,0,255`;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${rgb},${a})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    private stampWearChannel(
        x: number,
        z: number,
        radius: number,
        strength: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const r = Math.max(0.5, radius) * (this.sandW / this.width);
        this.drawWearBlob(ctx, cx, cy, r, strength, channel);
        this.sandDirty = true;
    }

    /** Stamp sandy wear (R). Also scrubs blood/scorch underfoot. */
    stampSand(x: number, z: number, radius: number, strength = 0.09): void {
        if (!this.wearEnabled()) return;
        const s = this.groundEffects === 'medium' ? strength * 0.55 : strength;
        this.stampWearChannel(x, z, radius, s, 'r');
    }

    /** Stamp blood under a hit/kill (G) — tight stain, short soft edge. */
    stampBlood(x: number, z: number, radius: number, strength = 0.14): void {
        if (this.groundEffects !== 'high') return; // medium: sand + scorch only
        this.stampWearChannel(x, z, radius, strength, 'g');
        this.stampWearChannel(x, z, radius * 1.35, strength * 0.35, 'g');
    }

    /** Stamp scorched earth under explosions / big breaks (B). */
    stampScorch(x: number, z: number, radius: number, strength = 0.16): void {
        if (!this.wearEnabled()) return;
        const s = this.groundEffects === 'medium' ? strength * 0.65 : strength;
        this.stampWearChannel(x, z, radius, s, 'b');
    }

    /** Push pending canvas stamps to the GPU (throttled unless `force`). */
    flushSandMask(now = performance.now(), force = false): void {
        if (!this.sandDirty || !this.sandMask) return;
        const minMs = this.groundEffects === 'medium' ? 160 : 80;
        if (!force && now - this.sandFlushAt < minMs) return;
        this.sandMask.needsUpdate = true;
        this.sandDirty = false;
        this.sandFlushAt = now;
    }

    /** Oil/fire mask: R = oil, G = active fire. Fixed size so every machine matches. */
    private ensureHazardMask(): CanvasTexture {
        if (this.hazardMask && this.hazardCtx) return this.hazardMask;
        // fixed — not tied to groundEffects quality (gameplay silhouette must match)
        const w = 256;
        const h = Math.round((w * this.height) / this.width);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        this.hazardW = w;
        this.hazardH = h;
        this.hazardCtx = ctx;
        const tex = new CanvasTexture(canvas);
        this.hazardMask = tex;
        return tex;
    }

    private stampHazardChannel(
        x: number,
        z: number,
        radius: number,
        strength: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const ctx = this.hazardCtx;
        if (!ctx || !this.hazardMask) return;
        const cx = ((x + this.halfW) / this.width) * this.hazardW;
        const cy = ((z + this.halfH) / this.height) * this.hazardH;
        const r = Math.max(0.5, radius) * (this.hazardW / this.width);
        this.drawWearBlob(ctx, cx, cy, r, strength, channel);
        this.hazardDirty = true;
    }

    /**
     * Rebuild oil (R) + fire (G) from the sim hazard field. Optional draft
     * stamps the same capsule silhouette as a real oil spill (visual only),
     * skipping cells inside ward-stone discs.
     */
    syncHazardFromField(
        field: {
            forEachOilCell: (fn: (x: number, z: number) => void) => void;
            forEachFireCell: (
                now: number,
                fn: (x: number, z: number, dps: number, until: number) => void,
            ) => void;
            forEachAcidCell: (fn: (x: number, z: number, expiresRound: number) => void) => void;
            forEachCapsuleCells: (
                ax: number,
                az: number,
                bx: number,
                bz: number,
                radius: number,
                fn: (wx: number, wz: number) => void,
            ) => void;
            cellSize: number;
        },
        now = 0,
        draft: {
            startX: number;
            startZ: number;
            endX: number;
            endZ: number;
            radius: number;
        } | null = null,
        blockedBy: readonly { x: number; z: number; radius: number }[] = [],
    ): void {
        this.ensureHazardMask();
        const ctx = this.hazardCtx;
        if (!ctx || !this.hazardMask) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.hazardW, this.hazardH);
        const cellR = field.cellSize * 0.85;
        const stampOilCell = (x: number, z: number) => {
            this.stampHazardChannel(x, z, cellR, 0.55, 'r');
            this.stampHazardChannel(x, z, cellR * 1.35, 0.22, 'r');
        };
        field.forEachOilCell((x, z) => stampOilCell(x, z));
        field.forEachFireCell(now, (x, z) => {
            this.stampHazardChannel(x, z, cellR, 0.7, 'g');
            this.stampHazardChannel(x, z, cellR * 1.4, 0.3, 'g');
        });
        field.forEachAcidCell((x, z) => {
            this.stampHazardChannel(x, z, cellR, 0.6, 'b');
            this.stampHazardChannel(x, z, cellR * 1.35, 0.25, 'b');
        });
        if (draft) {
            field.forEachCapsuleCells(
                draft.startX,
                draft.startZ,
                draft.endX,
                draft.endZ,
                draft.radius,
                (x, z) => {
                    if (blockedBy.length > 0) {
                        for (const s of blockedBy) {
                            const dx = x - s.x;
                            const dz = z - s.z;
                            if (dx * dx + dz * dz <= s.radius * s.radius) return;
                        }
                    }
                    stampOilCell(x, z);
                },
            );
        }
        this.hazardDirty = true;
        this.flushHazardMask(performance.now(), true);
    }

    /** Soft fire bloom at an impact (extra visual punch; field sync still owns shape). */
    stampHazardFire(x: number, z: number, radius: number, strength = 0.45): void {
        this.ensureHazardMask();
        this.stampHazardChannel(x, z, radius, strength, 'g');
        this.stampHazardChannel(x, z, radius * 1.3, strength * 0.4, 'g');
    }

    flushHazardMask(now = performance.now(), force = false): void {
        if (!this.hazardDirty || !this.hazardMask) return;
        // always flush reasonably fast — oil/fire is gameplay-readable
        const minMs = 80;
        if (!force && now - this.hazardFlushAt < minMs) return;
        this.hazardMask.needsUpdate = true;
        this.hazardDirty = false;
        this.hazardFlushAt = now;
    }

    /** Drive fire flicker in the ground shader (visual only). */
    setHazardTime(t: number): void {
        if (this.hazardTimeUniform) this.hazardTimeUniform.value = t;
    }

    /**
     * Shared ground fragment inject: optional wear (sand/blood/scorch) + always
     * oil/fire hazard. Used by both the plain macro material and the detailed upgrade.
     */
    private attachGroundShader(
        material: MeshStandardMaterial,
        macro: CanvasTexture,
        opts: {
            hazardMask: CanvasTexture;
            sand?: import('three').Texture | null;
            sandMask?: CanvasTexture | null;
        },
    ): void {
        const { hazardMask, sand = null, sandMask = null } = opts;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uMacro = { value: macro };
            shader.uniforms.uMacroBase = { value: new Color(THEME.terrain.base) };
            shader.uniforms.uHazardTime = { value: 0 };
            shader.uniforms.uHazardMask = { value: hazardMask };
            this.hazardTimeUniform = shader.uniforms.uHazardTime as { value: number };
            shader.vertexShader =
                'varying vec2 vMacroUv;\n' +
                shader.vertexShader.replace(
                    '#include <uv_vertex>',
                    '#include <uv_vertex>\n\tvMacroUv = uv;',
                );
            let inject = '';
            let extraUniforms =
                'uniform sampler2D uHazardMask;\nuniform float uHazardTime;\n';
            if (sand && sandMask) {
                shader.uniforms.uSand = { value: sand };
                shader.uniforms.uSandMask = { value: sandMask };
                extraUniforms += 'uniform sampler2D uSand;\nuniform sampler2D uSandMask;\n';
                inject +=
                    '\tvec3 wear = texture2D(uSandMask, vMacroUv).rgb;\n' +
                    '\tfloat sandLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
                    '\tfloat scorchM = smoothstep(0.12, 0.45, wear.b);\n' +
                    '\tfloat bloodM = smoothstep(0.08, 0.35, wear.g);\n' +
                    '\tfloat sandM = smoothstep(0.06, 0.38, wear.r - (sandLum - 0.25) * 0.35);\n' +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.09, 0.07), scorchM * 0.85);\n' +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.005, 0.008), bloodM);\n' +
                    '\tvec3 sandTexel = texture2D(uSand, vMapUv).rgb;\n' +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, sandTexel, sandM);\n';
            }
            // oil / fire / acid — always, gameplay-readable on every quality setting
            inject +=
                '\tvec3 haz = texture2D(uHazardMask, vMacroUv).rgb;\n' +
                '\tfloat oilM = smoothstep(0.06, 0.4, haz.r);\n' +
                '\tfloat fireM = smoothstep(0.08, 0.45, haz.g);\n' +
                '\tfloat acidM = smoothstep(0.06, 0.4, haz.b);\n' +
                '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.03, 0.015), oilM * 0.92);\n' +
                '\tfloat flicker = 0.65 + 0.35 * sin(uHazardTime * 9.0 + vMacroUv.x * 40.0 + vMacroUv.y * 28.0);\n' +
                '\tvec3 fireCol = mix(vec3(0.08, 0.02, 0.0), vec3(1.0, 0.35, 0.05), flicker);\n' +
                '\tdiffuseColor.rgb = mix(diffuseColor.rgb, fireCol, fireM * 0.9);\n' +
                '\tfloat bubble = 0.7 + 0.3 * sin(uHazardTime * 3.0 + vMacroUv.x * 60.0 - vMacroUv.y * 50.0);\n' +
                '\tvec3 acidCol = mix(vec3(0.09, 0.13, 0.015), vec3(0.55, 0.78, 0.10), bubble);\n' +
                '\tdiffuseColor.rgb = mix(diffuseColor.rgb, acidCol, acidM * 0.88);\n';
            inject += '\tdiffuseColor.rgb *= texture2D(uMacro, vMacroUv).rgb / max(uMacroBase, vec3(1e-3));\n';
            shader.fragmentShader =
                'uniform sampler2D uMacro;\nuniform vec3 uMacroBase;\nvarying vec2 vMacroUv;\n' +
                extraUniforms +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${inject}`);
        };
        material.customProgramCacheKey = () =>
            `ground-hazard${sand && sandMask ? '-wear-rgb' : ''}`;
    }

    /**
     * Softly fade all wear toward clean grass. `keep` is how much remains
     * (0.7 ≈ 30% fade). Call once per new round so scars heal over time.
     */
    fadeWear(keep = 0.7): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const k = Math.min(1, Math.max(0, keep));
        const v = Math.round(k * 255);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, 0, this.sandW, this.sandH);
        ctx.restore();
        this.sandMask.needsUpdate = true;
        this.sandDirty = false;
        this.sandFlushAt = performance.now();
    }

    /** Wipe unit wear and reseed light base patches (new match only). */
    clearSandWear(): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        this.paintBaseSand(ctx, this.sandW, this.sandH, this.sandSeed);
        this.sandMask.needsUpdate = true;
        this.sandDirty = false;
        this.sandFlushAt = performance.now();
    }

    /** Radius for a pack courtyard stamp from its tile footprint. */
    packSandRadius(cols: number, rows: number): number {
        return Math.max(cols, rows) * CELL * 0.38;
    }

    /**
     * How hard a ground unit presses into the sand (1 ≈ archer/dwarf).
     * Uses `type.sandWeight` when set; otherwise derives from cost + bulk.
     */
    sandStampWeight(type: {
        sandWeight?: number;
        cost: number;
        collisionRadius: number;
        meshScale: number;
    }): number {
        if (type.sandWeight !== undefined) return type.sandWeight;
        const costW = type.cost / 100;
        const bulkW = (type.collisionRadius * type.meshScale) / 2.5;
        return Math.max(0.55, Math.min(4.5, 0.5 * costW + 0.5 * bulkW));
    }

    /**
     * Swaps the macro-only ground material for the detailed one once the
     * generated grass textures arrive: a high-frequency tiled albedo+normal
     * carries the blade detail, while the macro canvas (meadow drift, stripes,
     * dirt, flowers, sun wash, vignette, border) modulates it — divided by the
     * base tone so it acts as pure relative variation. Until then (or if the
     * files are missing) the ground keeps the plain macro look.
     */
    private async upgradeGroundMaterial(mesh: Mesh, macro: CanvasTexture, seed: number): Promise<void> {
        const [albedo, normal] = await Promise.all([
            loadWorldTexture(grassAlbedoUrl),
            loadWorldTexture(grassNormalUrl),
        ]);
        if (!albedo || !normal) return;
        // sand is optional garnish — without it the ground is plain grass
        const sand = await loadWorldTexture(sandAlbedoUrl);
        const repeat = new Vector2(
            this.width / DETAIL_TILE,
            this.height / DETAIL_TILE,
        );
        const tile = (t: typeof albedo) => {
            t.wrapS = t.wrapT = RepeatWrapping;
            t.repeat.copy(repeat);
            t.anisotropy = 8;
        };
        tile(albedo);
        // boot preload may already have set this; keep local path correct too
        albedo.colorSpace = SRGBColorSpace;
        tile(normal);
        if (sand) {
            tile(sand);
            sand.colorSpace = SRGBColorSpace;
        }
        const wearOn = this.wearEnabled();
        const sandMask = sand && wearOn ? this.createSandMask(seed) : null;
        if (!sandMask) {
            this.sandMask = null;
            this.sandCtx = null;
        }
        const hazardMask = this.ensureHazardMask();

        const material = new MeshStandardMaterial({
            map: albedo,
            normalMap: normal,
            normalScale: new Vector2(0.35, 0.35),
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        this.attachGroundShader(material, macro, {
            hazardMask,
            sand: sandMask ? sand : null,
            sandMask,
        });

        const previous = mesh.material as MeshStandardMaterial;
        mesh.material = material;
        previous.dispose(); // keeps `macro` alive — dispose() frees the program, not textures
    }

    /**
     * Battlefield ground drawn entirely in code: a well-kept lawn. Big soft
     * shapes carry the variation; fine detail stays low-contrast so unit
     * silhouettes read clearly against it.
     */
    private createGroundTexture(seed: number): CanvasTexture {
        const TEX_SCALE = 8; // texture pixels per world unit
        const w = this.width * TEX_SCALE;
        const h = this.height * TEX_SCALE;
        const rng = mulberry32(seed);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        const t = THEME.terrain;
        ctx.fillStyle = t.base;
        ctx.fillRect(0, 0, w, h);

        const circle = (x: number, y: number, r: number) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
        };

        // decoration counts scale with the field area
        const density = (this.width * this.height) / 9000;

        // very large soft meadow patches — low-frequency color drift
        for (let i = 0; i < 140 * density; i++) {
            const tone = t.meadow[Math.floor(rng() * t.meadow.length)]!;
            const r = 60 + rng() * 220;
            const cx = rng() * w;
            const cy = rng() * h;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, tone);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.08 + rng() * 0.1;
            ctx.fillStyle = grad;
            circle(cx, cy, r);
            ctx.fill();
        }

        // mown-lawn stripes: gentle diagonal light bands
        {
            const stripePx = 4 * CELL * TEX_SCALE;
            const diag = Math.hypot(w, h);
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.rotate(-0.32);
            ctx.globalAlpha = 1;
            ctx.fillStyle = t.stripe;
            for (let x = -diag / 2; x < diag / 2; x += stripePx * 2) {
                ctx.fillRect(x, -diag / 2, stripePx, diag);
            }
            ctx.restore();
        }

        // faint worn-earth patches — a lived-on field, kept very subtle
        for (let i = 0; i < 6 * density; i++) {
            const cx = rng() * w;
            const cy = rng() * h;
            const r = 24 + rng() * 60;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, t.dirt);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = grad;
            circle(cx, cy, r);
            ctx.fill();
        }

        // grass blades: short strokes instead of dot noise — dark first, bright on top
        const blades = (color: string, count: number, alpha: number) => {
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const x = rng() * w;
                const y = rng() * h;
                const len = 3 + rng() * 6;
                const lean = (rng() - 0.5) * 4;
                ctx.moveTo(x, y);
                ctx.lineTo(x + lean, y - len);
            }
            ctx.stroke();
        };
        blades(t.bladeDark, 700 * density, 0.14);
        blades(t.bladeBright, 900 * density, 0.16);

        // rare wildflowers, growing in small clusters
        for (let i = 0; i < 14 * density; i++) {
            const cx = rng() * w;
            const cy = rng() * h;
            const color = t.flowers[Math.floor(rng() * t.flowers.length)]!;
            const dots = 3 + Math.floor(rng() * 5);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.75;
            for (let d = 0; d < dots; d++) {
                circle(cx + (rng() - 0.5) * 30, cy + (rng() - 0.5) * 30, 1.2 + rng() * 1.2);
                ctx.fill();
            }
        }

        // warm sunny wash toward the far (enemy) edge
        const sunGrad = ctx.createLinearGradient(0, 0, 0, h);
        sunGrad.addColorStop(0, t.sunWashTop);
        sunGrad.addColorStop(1, t.sunWashBottom);
        ctx.globalAlpha = 1;
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, w, h);

        // soft vignette — darker rim frames the battlefield
        const vin = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
        vin.addColorStop(0, 'rgba(0,0,0,0)');
        vin.addColorStop(1, t.vignette);
        ctx.fillStyle = vin;
        ctx.fillRect(0, 0, w, h);

        // wash unique lawn paint out near the border so the field edge meets
        // the outer grass instead of cutting from stripes → plain meadow
        {
            const rim = 16 * TEX_SCALE;
            ctx.fillStyle = t.base;
            for (let i = 0; i < rim; i++) {
                ctx.globalAlpha = (1 - i / rim) * 0.7;
                ctx.fillRect(i, 0, 1, h);
                ctx.fillRect(w - 1 - i, 0, 1, h);
                ctx.fillRect(0, i, w, 1);
                ctx.fillRect(0, h - 1 - i, w, 1);
            }
            ctx.globalAlpha = 1;
        }

        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
    }

    /**
     * The placement helper overlay: tile grid + deployment zone tints. Only
     * shown during the build phase — the war phase plays on clean terrain.
     */
    createOverlayMesh(): Mesh {
        const TEX_SCALE = 8;
        const w = this.width * TEX_SCALE;
        const h = this.height * TEX_SCALE;
        const cellPx = CELL * TEX_SCALE;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        const t = THEME.terrain;

        // deployment zone tints: each half has the owner's color in the
        // center; the flank strips belong to the opponent once unlocked.
        // the zones grow into the neutral strip once that is unlocked
        const zonePx = (this.size.zoneRows + (this.neutralUnlocked ? this.size.neutralRows / 2 : 0)) * cellPx;
        const flankPx = this.size.flankCols * cellPx;
        const paintZone = (x: number, y: number, zw: number, zh: number, tint: string) => {
            ctx.fillStyle = `${tint} 0.12)`;
            ctx.fillRect(x, y, zw, zh);
            ctx.strokeStyle = `${tint} 0.55)`;
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, zw - 3, zh - 3);
        };
        // texture top = far (-z) half; whose that is depends on ownAtFar
        const nearTint = this.ownAtFar ? teamColors.enemy.tint : teamColors.player.tint;
        const farTint = this.ownAtFar ? teamColors.player.tint : teamColors.enemy.tint;
        paintZone(flankPx, 0, w - 2 * flankPx, zonePx, farTint);
        paintZone(flankPx, h - zonePx, w - 2 * flankPx, zonePx, nearTint);
        if (this.flanksUnlocked) {
            // flanks beside the opponent's half belong to you
            paintZone(0, 0, flankPx, zonePx, nearTint);
            paintZone(w - flankPx, 0, flankPx, zonePx, nearTint);
            paintZone(0, h - zonePx, flankPx, zonePx, farTint);
            paintZone(w - flankPx, h - zonePx, flankPx, zonePx, farTint);
        } else {
            // locked in round 1: neutral grey
            ctx.fillStyle = t.flankLocked;
            ctx.fillRect(0, 0, flankPx, h);
            ctx.fillRect(w - flankPx, 0, flankPx, h);
        }

        // tile grid
        ctx.strokeStyle = t.grid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let c = 1; c < this.cols; c++) {
            ctx.moveTo(c * cellPx, 0);
            ctx.lineTo(c * cellPx, h);
        }
        for (let r = 1; r < this.rows; r++) {
            ctx.moveTo(0, r * cellPx);
            ctx.lineTo(w, r * cellPx);
        }
        ctx.stroke();

        // center line through the neutral strip
        ctx.strokeStyle = t.centerLine;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;

        // follows the ground relief so grid lines hug the terrain
        const geometry = new PlaneGeometry(this.width, this.height, this.cols * 2, this.rows * 2);
        geometry.rotateX(-Math.PI / 2);
        this.applyRelief(geometry);
        const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        mesh.position.y = 0.02;
        return mesh;
    }
}
