import {
    CanvasTexture,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    SRGBColorSpace,
    Vector3,
} from 'three';

/** world units per grid tile */
export const CELL = 4;

const PLAYER_TINT = 'rgba(47, 184, 212,';
const ENEMY_TINT = 'rgba(212, 72, 47,';

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

function mulberry32(seed: number): () => number {
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

    worldToCell(p: Vector3): Cell | null {
        const col = Math.floor((p.x + this.halfW) / CELL);
        const row = Math.floor((this.halfH - p.z) / CELL);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        return { col, row };
    }

    private inFlankCols(col: number): boolean {
        return col < this.size.flankCols || col >= this.cols - this.size.flankCols;
    }

    /** own half minus the opponent's flanks, plus own flanks beside the opponent's half */
    isPlayerCell(cell: Cell): boolean {
        const inPlayerHalf = cell.row < this.size.zoneRows;
        const inEnemyHalf = cell.row >= this.rows - this.size.zoneRows;
        return (inPlayerHalf && !this.inFlankCols(cell.col)) || (inEnemyHalf && this.inFlankCols(cell.col));
    }

    isEnemyCell(cell: Cell): boolean {
        const inPlayerHalf = cell.row < this.size.zoneRows;
        const inEnemyHalf = cell.row >= this.rows - this.size.zoneRows;
        return (inEnemyHalf && !this.inFlankCols(cell.col)) || (inPlayerHalf && this.inFlankCols(cell.col));
    }

    /** The ground plane: a code-generated texture on a real 3D plane mesh. */
    createMesh(seed = 1337): Mesh {
        const geometry = new PlaneGeometry(this.width, this.height);
        geometry.rotateX(-Math.PI / 2); // lie flat; texture top edge faces -z (enemy side)
        const material = new MeshStandardMaterial({
            map: this.createGroundTexture(seed),
            roughness: 0.95,
            metalness: 0,
        });
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        return mesh;
    }

    /** Battlefield ground drawn entirely in code: scorched soil, craters, grid, deployment zones. */
    private createGroundTexture(seed: number): CanvasTexture {
        const TEX_SCALE = 8; // texture pixels per world unit
        const w = this.width * TEX_SCALE;
        const h = this.height * TEX_SCALE;
        const cellPx = CELL * TEX_SCALE;
        const rng = mulberry32(seed);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        ctx.fillStyle = '#272b26';
        ctx.fillRect(0, 0, w, h);

        const circle = (x: number, y: number, r: number) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
        };

        // decoration counts scale with the field area
        const density = (this.width * this.height) / 9000;

        // large soft tonal patches
        const patchTones = ['#2e332c', '#22261f', '#2b2d33', '#30322a'];
        for (let i = 0; i < 260 * density; i++) {
            ctx.globalAlpha = 0.07 + rng() * 0.06;
            ctx.fillStyle = patchTones[Math.floor(rng() * patchTones.length)]!;
            circle(rng() * w, rng() * h, 12 + rng() * 90);
            ctx.fill();
        }
        // small debris speckles
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 500 * density; i++) {
            ctx.fillStyle = rng() > 0.5 ? '#4a4f45' : '#15181a';
            circle(rng() * w, rng() * h, 1 + rng() * 3);
            ctx.fill();
        }
        // craters: dark bowl + lighter rim
        for (let i = 0; i < 14 * density; i++) {
            const cx = rng() * w;
            const cy = rng() * h;
            const r = 14 + rng() * 40;
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = '#101312';
            circle(cx, cy, r);
            ctx.fill();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#3d4038';
            ctx.lineWidth = r * 0.22;
            circle(cx, cy, r);
            ctx.stroke();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#0a0c0c';
            circle(cx - r * 0.25, cy - r * 0.25, r * 0.45);
            ctx.fill();
        }

        // deployment zone tints (texture top = enemy/far edge at z = -halfH).
        // each half: owner's color in the center, the opponent's flank strips outside
        ctx.globalAlpha = 1;
        const zonePx = this.size.zoneRows * cellPx;
        const flankPx = this.size.flankCols * cellPx;
        const paintZone = (x: number, y: number, zw: number, zh: number, tint: string) => {
            ctx.fillStyle = `${tint} 0.1)`;
            ctx.fillRect(x, y, zw, zh);
            ctx.strokeStyle = `${tint} 0.5)`;
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, zw - 3, zh - 3);
        };
        // enemy half (top): enemy center, player flanks
        paintZone(flankPx, 0, w - 2 * flankPx, zonePx, ENEMY_TINT);
        paintZone(0, 0, flankPx, zonePx, PLAYER_TINT);
        paintZone(w - flankPx, 0, flankPx, zonePx, PLAYER_TINT);
        // player half (bottom): player center, enemy flanks
        paintZone(flankPx, h - zonePx, w - 2 * flankPx, zonePx, PLAYER_TINT);
        paintZone(0, h - zonePx, flankPx, zonePx, ENEMY_TINT);
        paintZone(w - flankPx, h - zonePx, flankPx, zonePx, ENEMY_TINT);

        // grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
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
        ctx.strokeStyle = 'rgba(216, 198, 106, 0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // field border
        ctx.strokeStyle = 'rgba(86, 93, 82, 0.9)';
        ctx.lineWidth = 5;
        ctx.strokeRect(2.5, 2.5, w - 5, h - 5);

        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
    }
}
