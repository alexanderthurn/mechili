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
} as const;

/** the model's parts that bend with the ground (the rest stand rigid: towers, rubble) */
const SECTION_PREFIX = 'center';

const _member = new Matrix4();
const _rel = new Matrix4();
const _inv = new Matrix4();
const _m = new Matrix4();
const _v = new Vector3();
const _s = new Vector3();
const _box = new Box3();

/**
 * Re-lay one wall member on the ground. `originX/Z` is the pack origin (as
 * in Unit.seatMembers), `alongZ` whether the wall runs along z (turned on its
 * footprint), `footY` the member's own world height (the ground at its centre).
 */
export function drapeWall(member: Group, originX: number, originZ: number, alongZ: boolean, footY: number): void {
    member.updateMatrix();
    member.updateMatrixWorld(true);
    // the member's world matrix from the origin it is being seated at (a drag
    // preview seats it before the view has moved there)
    _member.makeTranslation(originX, 0, originZ).multiply(member.matrix);
    _inv.copy(member.matrixWorld).invert();
    member.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const base = drapeBase(mesh);
        const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
        _rel.multiplyMatrices(_inv, mesh.matrixWorld);
        _m.multiplyMatrices(_member, _rel);
        // world units per geometry unit upward (yaw-only model: local y is world y)
        const scaleY = _s.setFromMatrixScale(_m).y || 1;
        const section = mesh.name.startsWith(SECTION_PREFIX);
        let rigidDy = 0;
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
            if (section) {
                // the ground on the wall's centre line, level with this vertex
                dy = alongZ ? worldHeightAt(originX, _v.z) - footY : worldHeightAt(_v.x, originZ) - footY;
            }
            if (_v.y - footY < WALL_DRAPE.bottom) dy -= WALL_DRAPE.skirt;
            pos.setY(i / 3, base[i + 1]! + dy / scaleY);
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
