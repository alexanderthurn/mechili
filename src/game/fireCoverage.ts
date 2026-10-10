import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { worldHeightAt } from './map';

/**
 * Where the selected ranged unit can actually hit: the ground it covers is
 * tinted, one shape with a smooth border; what a hill, a building or a wall
 * hides from it stays clear. Each cell is asked of the sim's own shot test (BattleSim.shotCovers),
 * so it never promises a shot the battle won't fire. Render-only, rebuilt
 * only when the unit, its spot or the board's buildings change. Tweak live:
 * - cell: world units per grid step (smaller = finer and slower to work out)
 * - refine: see below
 * - lift: world units above the ground
 * - opacity: how strong the tint is
 */
export const FIRE_COVERAGE = {
    cell: 1.25,
    /** halvings of a border edge to place the outline (each one more probe per border edge) */
    refine: 4,
    lift: 0.06,
    opacity: 0.22,
} as const;

export class FireCoverage {
    private readonly mesh: Mesh;
    private key = '';
    /** whether the last work-out had anything to show */
    private shown = false;

    constructor(scene: Scene) {
        this.mesh = new Mesh(
            new BufferGeometry(),
            new MeshBasicMaterial({
                transparent: true,
                opacity: FIRE_COVERAGE.opacity,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
            }),
        );
        this.mesh.renderOrder = 4;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    hide(): void {
        this.mesh.visible = false;
        this.key = '';
    }

    /**
     * Show the coverage for `key` (who, where, what stands on the board). Only
     * when the key changes is `area` asked for the centre, the radius and the
     * per-cell test, and the cells worked out again.
     */
    show(
        key: string,
        color: number,
        area: () => { x: number; z: number; radius: number; covers: (x: number, z: number) => boolean } | null,
    ): void {
        (this.mesh.material as MeshBasicMaterial).color.setHex(color);
        if (key === this.key) {
            this.mesh.visible = this.shown;
            return;
        }
        this.key = key;
        const got = area();
        this.shown = got !== null;
        this.mesh.visible = this.shown;
        if (!got) return;
        const { x, z, radius, covers } = got;
        // marching squares: the coverage is asked at the grid's corners; each cell
        // is filled with the part of it that's inside, its outline cut where the
        // edge between an inside and an outside corner crosses over — found by
        // halving that edge a few times — so the shape follows the real border
        // (the round range limit, a wall's shadow) instead of stair-stepping
        const c = FIRE_COVERAGE.cell;
        const n = Math.ceil(radius / c) + 1;
        const size = 2 * n + 1;
        const inside = new Uint8Array(size * size);
        const at = (i: number, j: number) => inside[(i + n) * size + (j + n)] === 1;
        for (let i = -n; i <= n; i++) {
            for (let j = -n; j <= n; j++) {
                if ((i * i + j * j) * c * c > radius * radius) continue;
                if (covers(x + i * c, z + j * c)) inside[(i + n) * size + (j + n)] = 1;
            }
        }
        // where the border crosses the edge from corner (i0, j0) to (i1, j1), one inside
        const crossings = new Map<number, [number, number]>();
        const cross = (i0: number, j0: number, i1: number, j1: number): [number, number] => {
            const key = (Math.min(i0, i1) + n) * size * 2 + (Math.min(j0, j1) + n) * 2 + (i0 === i1 ? 1 : 0);
            const known = crossings.get(key);
            if (known) return known;
            // in → out along the edge
            let ax = x + i0 * c;
            let az = z + j0 * c;
            let bx = x + i1 * c;
            let bz = z + j1 * c;
            if (!at(i0, j0)) [ax, az, bx, bz] = [bx, bz, ax, az];
            for (let k = 0; k < FIRE_COVERAGE.refine; k++) {
                const mx = (ax + bx) / 2;
                const mz = (az + bz) / 2;
                if (covers(mx, mz)) [ax, az] = [mx, mz];
                else [bx, bz] = [mx, mz];
            }
            const p: [number, number] = [(ax + bx) / 2, (az + bz) / 2];
            crossings.set(key, p);
            return p;
        };
        const verts: number[] = [];
        const lift = (px: number, pz: number) => worldHeightAt(px, pz) + FIRE_COVERAGE.lift;
        const poly: [number, number][] = [];
        for (let i = -n; i < n; i++) {
            for (let j = -n; j < n; j++) {
                // corners round the cell: (i,j) (i+1,j) (i+1,j+1) (i,j+1)
                const ring: [number, number][] = [
                    [i, j],
                    [i + 1, j],
                    [i + 1, j + 1],
                    [i, j + 1],
                ];
                let any = false;
                for (const [ci, cj] of ring) if (at(ci, cj)) any = true;
                if (!any) continue;
                poly.length = 0;
                for (let k = 0; k < 4; k++) {
                    const [ci, cj] = ring[k]!;
                    const [ni, nj] = ring[(k + 1) % 4]!;
                    const here = at(ci, cj);
                    if (here) poly.push([x + ci * c, z + cj * c]);
                    if (here !== at(ni, nj)) poly.push(cross(ci, cj, ni, nj));
                }
                // a fan from the first point (the cell pieces are convex)
                for (let k = 1; k + 1 < poly.length; k++) {
                    const a = poly[0]!;
                    const b = poly[k]!;
                    const d = poly[k + 1]!;
                    // counter-clockwise seen from above (+y up): a, d, b
                    verts.push(a[0], lift(a[0], a[1]), a[1], d[0], lift(d[0], d[1]), d[1], b[0], lift(b[0], b[1]), b[1]);
                }
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
        this.mesh.geometry.dispose();
        this.mesh.geometry = geometry;
    }
}
