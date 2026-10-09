import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from 'three';
import { cellKey, worldHeightAt, type BattleMap, type Cell } from './map';
import type { GridExtent } from './units';

/**
 * Joining walls while placing one: a wall's towers stand on its two end tiles,
 * and a wall joins another by sharing such a tile. While a wall rides the
 * cursor, every open end of the placed walls shows a ring (a peg waiting for
 * the next piece), the carried wall's own end tiles show smaller rings, and
 * a carried wall within `reach` tiles of fitting an open end snaps onto it.
 * Render / input only — the placed wall is an ordinary anchor. Tweak live:
 * - reach: tiles the free position may be off and still snap
 * - socketRadius / endRadius: ring sizes (world units)
 * - pulseHz: how fast the open ends breathe
 */
export const WALL_SNAP = {
    reach: 1,
    socketRadius: 1.7,
    endRadius: 1.15,
    pulseHz: 1.1,
    /** open end, waiting */
    socketColor: 0xd8c08a,
    /** the end the carried wall snapped onto */
    snapColor: 0xffd04a,
    /** the carried wall's own tower tiles */
    endColor: 0xf2ead8,
} as const;

/** a wall's two tower tiles: the first and last tile along its length */
export function wallEnds(anchor: Cell, fp: GridExtent): [Cell, Cell] {
    return [
        { col: anchor.col, row: anchor.row },
        { col: anchor.col + fp.cols - 1, row: anchor.row + fp.rows - 1 },
    ];
}

export interface PlacedWall {
    anchor: Cell;
    fp: GridExtent;
}

/** tower tiles only one wall stands on — where the next piece can join */
export function openWallEnds(walls: readonly PlacedWall[]): Cell[] {
    const count = new Map<string, { cell: Cell; n: number }>();
    for (const w of walls) {
        for (const end of wallEnds(w.anchor, w.fp)) {
            const key = cellKey(end);
            const e = count.get(key);
            if (e) e.n++;
            else count.set(key, { cell: end, n: 1 });
        }
    }
    return [...count.values()].filter((e) => e.n === 1).map((e) => e.cell);
}

/**
 * Where a wall carried at `free` lands: the free anchor, or — when one of its
 * end tiles can sit on an open end within `reach` tiles — that joined anchor.
 * `fits(anchor)` is the board's own placement rule; a joined anchor must also
 * leave the other walls' tiles alone except the shared tower tile.
 */
export function snapWallAnchor(
    free: Cell,
    fp: GridExtent,
    walls: readonly PlacedWall[],
    fits: (anchor: Cell) => boolean,
    coveredCells: (fp: GridExtent, anchor: Cell) => Cell[] | null,
): { anchor: Cell; socket: Cell | null } {
    const sockets = openWallEnds(walls);
    if (sockets.length === 0) return { anchor: free, socket: null };
    const taken = new Set<string>();
    for (const w of walls) for (const c of coveredCells(w.fp, w.anchor) ?? []) taken.add(cellKey(c));
    let best: { anchor: Cell; socket: Cell; d: number } | null = null;
    for (const socket of sockets) {
        for (const end of [{ col: 0, row: 0 }, { col: fp.cols - 1, row: fp.rows - 1 }]) {
            const anchor = { col: socket.col - end.col, row: socket.row - end.row };
            const d = Math.max(Math.abs(anchor.col - free.col), Math.abs(anchor.row - free.row));
            if (d > WALL_SNAP.reach || (best && d >= best.d)) continue;
            const cells = coveredCells(fp, anchor);
            if (!cells) continue;
            const socketKey = cellKey(socket);
            // joined at the tower tile only — never lying along another wall
            if (cells.some((c) => cellKey(c) !== socketKey && taken.has(cellKey(c)))) continue;
            if (!fits(anchor)) continue;
            best = { anchor, socket, d };
        }
    }
    return best ? { anchor: best.anchor, socket: best.socket } : { anchor: free, socket: null };
}

/** the rings on the ground while a wall rides the cursor */
export class WallSnapMarkers {
    private readonly rings: Mesh[] = [];
    private used = 0;

    constructor(
        private readonly scene: Scene,
        private readonly map: BattleMap,
    ) {}

    /**
     * Draw this frame's rings: every open end (the snapped one bright and
     * swelling), and the carried wall's own two end tiles.
     */
    show(sockets: readonly Cell[], snapped: Cell | null, ghostEnds: readonly Cell[], timeSeconds: number): void {
        this.used = 0;
        const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * WALL_SNAP.pulseHz);
        const snapKey = snapped ? cellKey(snapped) : null;
        for (const s of sockets) {
            const hit = cellKey(s) === snapKey;
            this.ring(
                s,
                WALL_SNAP.socketRadius * (hit ? 1.1 + 0.08 * pulse : 0.92 + 0.08 * pulse),
                hit ? WALL_SNAP.snapColor : WALL_SNAP.socketColor,
                hit ? 0.95 : 0.35 + 0.3 * pulse,
            );
        }
        for (const e of ghostEnds) {
            if (cellKey(e) === snapKey) continue; // the bright socket ring already marks it
            this.ring(e, WALL_SNAP.endRadius, WALL_SNAP.endColor, 0.55);
        }
        for (let i = this.used; i < this.rings.length; i++) this.rings[i]!.visible = false;
    }

    hide(): void {
        for (const r of this.rings) r.visible = false;
    }

    private ring(cell: Cell, radius: number, color: number, opacity: number): void {
        let mesh = this.rings[this.used];
        if (!mesh) {
            const geo = new RingGeometry(0.78, 1, 48);
            geo.rotateX(-Math.PI / 2);
            mesh = new Mesh(
                geo,
                new MeshBasicMaterial({
                    transparent: true,
                    side: DoubleSide,
                    depthWrite: false,
                    blending: AdditiveBlending,
                }),
            );
            mesh.renderOrder = 5;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.rings.push(mesh);
        }
        this.used++;
        const c = this.map.areaCenter(cell, 1, 1);
        mesh.position.set(c.x, worldHeightAt(c.x, c.z) + 0.15, c.z);
        mesh.scale.setScalar(radius);
        const mat = mesh.material as MeshBasicMaterial;
        mat.color.setHex(color);
        mat.opacity = opacity;
        mesh.visible = true;
    }
}
