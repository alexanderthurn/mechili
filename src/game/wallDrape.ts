import { Box3, BufferAttribute, Matrix4, Mesh, Vector3, type Group } from 'three';
import { worldHeightAt } from './map';

/**
 * A wall laid over uneven ground (render-only; the sim's wall is a flat
 * rectangle). Its towers stand upright, each on the ground under its own
 * centre; the plain sections between them follow the ground vertex by vertex
 * along the wall's line, so a wall climbs a hill and sags into a hollow. The
 * bottom edge reaches a little into the ground everywhere, so no light shows
 * under it where the ground falls away across the wall's depth. Tweak live:
 * - skirt: world units the bottom edge sinks below the ground
 * - bottom: a vertex this close above the wall's foot counts as its bottom edge
 */
export const WALL_DRAPE = {
    skirt: 0.8,
    bottom: 0.25,
    /** world units from a joined end over which the sections slope to the meeting height */
    blend: 2.5,
} as const;

/** a joined end: its tile centre, and the height there as a multiple of this wall's own (its walkway's: kWalk) */
export interface WallMeet {
    x: number;
    z: number;
    k: number;
    kWalk: number;
}

/** the model's parts that bend with the ground (the rest stand rigid: towers, rubble) */
const SECTION_PREFIX = 'center';
/** walkway pieces (see wallWalk.ts) — also sections, but meet at the walkways' height */
const WALKWAY_PREFIX = 'centerWalk';

const _member = new Matrix4();
const _rel = new Matrix4();
const _inv = new Matrix4();
const _m = new Matrix4();
const _mInv = new Matrix4();
const _w = new Vector3();
const _v = new Vector3();
const _s = new Vector3();
const _box = new Box3();

/**
 * Re-lay one wall member on the ground. `originX/Z` is the pack origin (as
 * in Unit.seatMembers), `alongZ` whether the wall runs along z (turned on its
 * footprint), `footY` the member's own world height (the ground at its centre).
 */
export function drapeWall(
    member: Group,
    originX: number,
    originZ: number,
    alongZ: boolean,
    footY: number,
    meets: readonly WallMeet[] = [],
): void {
    member.updateMatrix();
    member.updateMatrixWorld(true);
    // the member's world matrix from the origin it is being seated at (a drag
    // preview seats it before the view has moved there)
    _member.makeTranslation(originX, 0, originZ).multiply(member.matrix);
    _inv.copy(member.matrixWorld).invert();
    // the wall's own centre line (a wall may stand off its tiles' middle, see UnitType.wall.shift)
    const lineX = originX + member.position.x;
    const lineZ = originZ + member.position.z;
    member.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const base = drapeBase(mesh);
        const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
        _rel.multiplyMatrices(_inv, mesh.matrixWorld);
        _m.multiplyMatrices(_member, _rel);
        // world units per geometry unit upward (yaw-only model: local y is world y)
        const scaleY = _s.setFromMatrixScale(_m).y || 1;
        _mInv.copy(_m).invert();
        const section = mesh.name.startsWith(SECTION_PREFIX);
        // the walkway meets its neighbour's walkway, not its wall
        const walkway = mesh.name.startsWith(WALKWAY_PREFIX);
        let rigidDy = 0;
        // which half of the wall this section is (its middle's side of the wall's centre):
        // the model's two halves are one mesh twice, mirrored, overlapping a hair in the
        // middle — each stops at the centre instead, or the overlap flickers
        let half = 0;
        if (section) {
            _box.makeEmpty();
            for (let i = 0; i < base.length; i += 3) _box.expandByPoint(_v.set(base[i]!, base[i + 1]!, base[i + 2]!));
            _box.getCenter(_v).applyMatrix4(_m);
            half = Math.sign(alongZ ? _v.z - lineZ : _v.x - lineX);
        }
        if (!section) {
            // a tower: lifted as one piece to the ground under its own centre
            _box.makeEmpty();
            for (let i = 0; i < base.length; i += 3) _box.expandByPoint(_v.set(base[i]!, base[i + 1]!, base[i + 2]!));
            _box.getCenter(_v).applyMatrix4(_m);
            rigidDy = worldHeightAt(_v.x, _v.z) - footY;
        }
        for (let i = 0; i < base.length; i += 3) {
            _v.set(base[i]!, base[i + 1]!, base[i + 2]!).applyMatrix4(_m);
            let dy = rigidDy;
            let clamped = false;
            if (section) {
                // a joined end: the sections stop at the shared tile's centre, so the two
                // walls butt together there instead of overlapping (no flicker, no open end)
                for (const m of meets) {
                    const out = alongZ ? Math.sign(m.z - originZ) : Math.sign(m.x - originX);
                    const past = alongZ ? (_v.z - m.z) * out : (_v.x - m.x) * out;
                    if (past <= 0) continue;
                    if (alongZ) _v.z = m.z;
                    else _v.x = m.x;
                    clamped = true;
                }
                // …and each half stops at the wall's own middle
                if (half !== 0 && (alongZ ? _v.z - lineZ : _v.x - lineX) * half < 0) {
                    if (alongZ) _v.z = lineZ;
                    else _v.x = lineX;
                    clamped = true;
                }
                // the ground on the wall's centre line, level with this vertex
                dy = alongZ ? worldHeightAt(lineX, _v.z) - footY : worldHeightAt(_v.x, lineZ) - footY;
                // near a joined end: taller or lower toward the height the two walls meet at
                let k = 1;
                for (const m of meets) {
                    // inward from the joined tile's centre; past it (where the two walls
                    // overlap) both stand at the meeting height, so they meet exactly there
                    const out = alongZ ? Math.sign(m.z - originZ) : Math.sign(m.x - originX);
                    const along = Math.max(0, alongZ ? (m.z - _v.z) * out : (m.x - _v.x) * out);
                    const w = Math.max(0, 1 - along / WALL_DRAPE.blend);
                    k += ((walkway ? m.kWalk : m.k) - 1) * w * w * (3 - 2 * w);
                }
                if (k !== 1) dy += (_v.y - footY) * (k - 1);
            }
            if (_v.y - footY < WALL_DRAPE.bottom) dy -= WALL_DRAPE.skirt;
            pos.setY(i / 3, base[i + 1]! + dy / scaleY);
            if (clamped) {
                _w.copy(_v).applyMatrix4(_mInv);
                pos.setX(i / 3, _w.x);
                pos.setZ(i / 3, _w.z);
            } else {
                pos.setX(i / 3, base[i]!);
                pos.setZ(i / 3, base[i + 2]!);
            }
        }
        pos.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
    });
}

/**
 * The mesh's untouched positions. The first drape gives the mesh its own
 * geometry (the template's is shared by every wall) and keeps the original.
 */
function drapeBase(mesh: Mesh): Float32Array {
    const kept = mesh.userData.drapeBase as Float32Array | undefined;
    if (kept) return kept;
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const base = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        base[i * 3] = pos.getX(i);
        base[i * 3 + 1] = pos.getY(i);
        base[i * 3 + 2] = pos.getZ(i);
    }
    // a quantized GLB stores i16 positions: the draped heights need floats
    mesh.geometry.setAttribute('position', new BufferAttribute(base.slice(), 3));
    mesh.userData.drapeBase = base;
    return base;
}
