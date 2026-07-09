import {
    CanvasTexture,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    SRGBColorSpace,
    Vector3,
} from 'three';

/** world units per grid tile */
export const CELL = 4;

import { THEME } from '../theme';

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

    constructor(readonly size: MapSize = STANDARD_MAP) {
        this.cols = size.zoneCols + 2 * size.flankCols;
        this.rows = 2 * size.zoneRows + size.neutralRows;
        this.width = this.cols * CELL;
        this.height = this.rows * CELL;
        this.halfW = this.width / 2;
        this.halfH = this.height / 2;
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
    isPlayerCell(cell: Cell): boolean {
        const zr = this.ownRows();
        const inPlayerHalf = cell.row < zr;
        const inEnemyHalf = cell.row >= this.rows - zr;
        if (!this.inFlankCols(cell.col)) return inPlayerHalf;
        return this.flanksUnlocked && inEnemyHalf;
    }

    isEnemyCell(cell: Cell): boolean {
        const zr = this.ownRows();
        const inPlayerHalf = cell.row < zr;
        const inEnemyHalf = cell.row >= this.rows - zr;
        if (!this.inFlankCols(cell.col)) return inEnemyHalf;
        return this.flanksUnlocked && inPlayerHalf;
    }

    /** The ground plane: a code-generated texture on a real 3D plane mesh. */
    createMesh(seed = 1337): Mesh {
        const geometry = new PlaneGeometry(this.width, this.height);
        geometry.rotateX(-Math.PI / 2); // lie flat; texture top edge faces -z (enemy side)
        const material = new MeshStandardMaterial({
            map: this.createGroundTexture(seed),
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        return mesh;
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
        // enemy half (top) and player half (bottom)
        paintZone(flankPx, 0, w - 2 * flankPx, zonePx, THEME.enemyTint);
        paintZone(flankPx, h - zonePx, w - 2 * flankPx, zonePx, THEME.playerTint);
        if (this.flanksUnlocked) {
            // flanks beside the opponent's half belong to you
            paintZone(0, 0, flankPx, zonePx, THEME.playerTint);
            paintZone(w - flankPx, 0, flankPx, zonePx, THEME.playerTint);
            paintZone(0, h - zonePx, flankPx, zonePx, THEME.enemyTint);
            paintZone(w - flankPx, h - zonePx, flankPx, zonePx, THEME.enemyTint);
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

        const geometry = new PlaneGeometry(this.width, this.height);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        mesh.position.y = 0.02;
        return mesh;
    }
}
