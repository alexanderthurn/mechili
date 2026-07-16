import {
    CanvasTexture,
    Color,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    Vector2,
    Vector3,
} from 'three';

const grassAlbedoUrl = new URL('../../assets/textures/grass-albedo.webp', import.meta.url).href;
const grassNormalUrl = new URL('../../assets/textures/grass-normal.webp', import.meta.url).href;
const sandAlbedoUrl = new URL('../../assets/textures/sand-albedo.webp', import.meta.url).href;

/** world units per grid tile */
export const CELL = 4;

import { THEME } from '../theme';
import { teamColors } from './colors';

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

    /** world units covered by one repeat of the grass detail texture */
    private static readonly DETAIL_TILE = 20;

    private readonly reliefNoise = makeValueNoise(9241);

    /**
     * Visual-only relief: gentle mounds rising up to `reliefDepth`, never
     * below 0. The sim keeps walking on the flat y=0 plane — feet wade a bit
     * into a mound, which the grass hides (better than hovering over dips).
     * Flat near the borders (to meet the outer meadow) and under the four
     * base buildings (so the castles sit cleanly).
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
        const material = new MeshStandardMaterial({
            map: macro,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        void this.upgradeGroundMaterial(mesh, macro, seed);
        return mesh;
    }

    /**
     * Where the sand shows through the grass: a low-frequency blob mask over
     * the whole field. Clusters of overlapping soft circles make organic
     * patches; the shader adds the high-frequency ragged edge.
     */
    private createSandMask(seed: number): CanvasTexture {
        const w = 512;
        const h = Math.round((w * this.height) / this.width);
        const rng = mulberry32(seed ^ 0x5eed);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        const pxPerUnit = w / this.width;
        const blob = (x: number, y: number, r: number, alpha: number) => {
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        };

        // sand courtyards under the base buildings (canvas top = -z, far side)
        for (const a of this.baseAnchors()) {
            const cx = ((a.x + this.halfW) / this.width) * w;
            const cy = ((a.z + this.halfH) / this.height) * h;
            for (let b = 0; b < 8; b++) {
                const r = a.r * (0.55 + rng() * 0.5) * pxPerUnit;
                blob(
                    cx + (rng() - 0.5) * a.r * 0.9 * pxPerUnit,
                    cy + (rng() - 0.5) * a.r * 0.9 * pxPerUnit,
                    r,
                    0.8 + rng() * 0.2,
                );
            }
        }

        // a few loose patches elsewhere for variety
        const patches = Math.round((this.width * this.height) / 14000);
        for (let i = 0; i < patches; i++) {
            const cx = w * (0.06 + rng() * 0.88);
            const cy = h * (0.06 + rng() * 0.88);
            const blobs = 3 + Math.floor(rng() * 5);
            for (let b = 0; b < blobs; b++) {
                const r = (3.5 + rng() * 8) * pxPerUnit;
                blob(cx + (rng() - 0.5) * r * 1.6, cy + (rng() - 0.5) * r * 1.6, r, 0.55 + rng() * 0.3);
            }
        }
        return new CanvasTexture(canvas);
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
        const loader = new TextureLoader();
        let albedo, normal;
        try {
            [albedo, normal] = await Promise.all([
                loader.loadAsync(grassAlbedoUrl),
                loader.loadAsync(grassNormalUrl),
            ]);
        } catch {
            return;
        }
        // sand is optional garnish — without it the ground is plain grass
        const sand = await loader.loadAsync(sandAlbedoUrl).catch(() => null);
        const repeat = new Vector2(
            this.width / BattleMap.DETAIL_TILE,
            this.height / BattleMap.DETAIL_TILE,
        );
        const tile = (t: typeof albedo) => {
            t.wrapS = t.wrapT = RepeatWrapping;
            t.repeat.copy(repeat);
            t.anisotropy = 8;
        };
        tile(albedo);
        albedo.colorSpace = SRGBColorSpace;
        tile(normal);
        if (sand) {
            tile(sand);
            sand.colorSpace = SRGBColorSpace;
        }
        const sandMask = sand ? this.createSandMask(seed) : null;

        const material = new MeshStandardMaterial({
            map: albedo,
            normalMap: normal,
            normalScale: new Vector2(0.35, 0.35),
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uMacro = { value: macro };
            shader.uniforms.uMacroBase = { value: new Color(THEME.terrain.base) };
            shader.vertexShader =
                'varying vec2 vMacroUv;\n' +
                shader.vertexShader.replace(
                    '#include <uv_vertex>',
                    '#include <uv_vertex>\n\tvMacroUv = uv;',
                );
            // sand first (a full detail layer under the same lighting),
            // then the macro modulation over whatever ground is showing
            let inject = '';
            if (sand && sandMask) {
                shader.uniforms.uSand = { value: sand };
                shader.uniforms.uSandMask = { value: sandMask };
                inject +=
                    '\tvec3 sandTexel = texture2D(uSand, vMapUv).rgb;\n' +
                    '\tfloat sandLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
                    '\tfloat sandM = texture2D(uSandMask, vMacroUv).r;\n' +
                    // bright grass blades overhang into the patch: raggier edge
                    '\tsandM = smoothstep(0.30, 0.62, sandM - (sandLum - 0.25) * 0.5);\n' +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, sandTexel, sandM);\n';
            }
            inject += '\tdiffuseColor.rgb *= texture2D(uMacro, vMacroUv).rgb / max(uMacroBase, vec3(1e-3));\n';
            shader.fragmentShader =
                'uniform sampler2D uMacro;\nuniform vec3 uMacroBase;\nvarying vec2 vMacroUv;\n' +
                (sand ? 'uniform sampler2D uSand;\nuniform sampler2D uSandMask;\n' : '') +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${inject}`);
        };
        material.customProgramCacheKey = () => `ground-macro-detail${sand ? '-sand' : ''}`;

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

        // field border
        ctx.strokeStyle = t.border;
        ctx.lineWidth = 5;
        ctx.strokeRect(2.5, 2.5, w - 5, h - 5);

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
