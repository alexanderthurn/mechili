import { Vector3, type Object3D } from 'three';
import type { BattleMap, Cell } from './map';
import type { Unit } from './units';
import { wallEnds } from './wallSnap';

/**
 * Two walls in a straight line that share an end tile read as one long wall:
 * neither stands its tower there (towers, rubble at their feet), and the
 * sections run through. A corner (the walls turned to each other) keeps its
 * tower. Render-only, from the placed walls; re-checked only when one moves,
 * turns, comes or goes. Tweak live:
 * - nudge: model units one of two meeting walls' sections step forward, so
 *   the slivers where they overlap on the shared tile don't flicker
 */
export const WALL_JOINS = {
    nudge: 0.01,
} as const;

/** the model's parts at each end (see the wall model's node names) */
const END_PARTS = [
    ['left', 'leftbottom'],
    ['right', 'rightbottom', 'rightbottom2'],
] as const;
const SECTION_PREFIX = 'center';

const _p = new Vector3();

export class WallJoins {
    private key = '';

    constructor(private readonly map: BattleMap) {}

    /** call every frame with the placed units; does work only when walls changed */
    update(units: readonly Unit[]): void {
        const walls = units.filter((u) => u.type.wall && !u.destroyed);
        const key = walls.map((u) => `${u.id}:${u.cell.col},${u.cell.row},${u.rotated ? 1 : 0}`).join('|');
        if (key === this.key) return;
        this.key = key;

        // which end tiles of which walls meet another wall straight on
        const hidden = new Map<Unit, Set<number>>();
        const nudged = new Set<Unit>();
        for (let i = 0; i < walls.length; i++) {
            for (let k = i + 1; k < walls.length; k++) {
                const a = walls[i]!;
                const b = walls[k]!;
                if (a.rotated !== b.rotated || a.team !== b.team) continue;
                const ea = this.endsOf(a);
                const eb = this.endsOf(b);
                // straight on: a's far end on b's near end, or the other way round
                // (sharing the same end would lay them on top of each other)
                const join = same(ea[1], eb[0]) ? ([1, 0] as const) : same(ea[0], eb[1]) ? ([0, 1] as const) : null;
                if (!join) continue;
                add(hidden, a, join[0]);
                add(hidden, b, join[1]);
                nudged.add(b);
            }
        }
        for (const w of walls) this.apply(w, hidden.get(w) ?? new Set(), nudged.has(w));
    }

    private endsOf(u: Unit): [Cell, Cell] {
        const fp = u.rotated ? { cols: u.type.footprint.rows, rows: u.type.footprint.cols } : u.type.footprint;
        return wallEnds(u.cell, fp);
    }

    /** show / hide each end's tower: the end parts nearest the hidden end tile go */
    private apply(u: Unit, hiddenEnds: Set<number>, nudge: boolean): void {
        const ends = this.endsOf(u).map((c) => this.map.areaCenter(c, 1, 1));
        for (const m of u.members) {
            m.mesh.updateMatrixWorld(true);
            for (const parts of END_PARTS) {
                const tower = m.mesh.getObjectByName(parts[0]);
                if (!tower) continue;
                tower.getWorldPosition(_p);
                const end = _p.distanceToSquared(ends[0]!) <= _p.distanceToSquared(ends[1]!) ? 0 : 1;
                const show = !hiddenEnds.has(end);
                for (const name of parts) {
                    const part = m.mesh.getObjectByName(name);
                    if (part) part.visible = show;
                }
            }
            m.mesh.traverse((o) => {
                if (o.name.startsWith(SECTION_PREFIX)) nudgeSection(o, nudge);
            });
        }
    }
}

function same(a: Cell, b: Cell): boolean {
    return a.col === b.col && a.row === b.row;
}

function add(map: Map<Unit, Set<number>>, u: Unit, end: number): void {
    const set = map.get(u) ?? new Set<number>();
    set.add(end);
    map.set(u, set);
}

/** a section's depth position, stepped forward a hair or back to where it was */
function nudgeSection(o: Object3D, on: boolean): void {
    const base = (o.userData.joinBaseZ as number | undefined) ?? o.position.z;
    o.userData.joinBaseZ = base;
    o.position.z = base + (on ? WALL_JOINS.nudge : 0);
}
