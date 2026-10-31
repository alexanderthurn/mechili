import type { Object3D } from 'three';
import { worldHeightAt } from './map';
import type { InstancedSkinData } from './instancedSkin';

/**
 * A long, rigid body (a wheeled carriage) sits on the slope under it instead of
 * level at its centre's height: pitched along its wheelbase, rolled across its
 * track, at the mean height of its four contacts. Render-only — the sim walks the
 * flat plane — so it cannot touch determinism.
 */
export interface GroundConformSpec {
    /** front-to-back contact distance (wheelbase), GLB units */
    length: number;
    /** left-to-right contact distance (track), GLB units */
    width: number;
}

/**
 * Pose `mesh` (a unit proxy at world `x`/`z`, yawed by `rotation.y`) on the ground:
 * `lift` is added to the contacts' mean height. Switches the proxy to yaw-first Euler
 * order, so `rotation.y` stays the plain facing everyone else reads, x the pitch, z the roll.
 */
export function conformToGround(mesh: Object3D, spec: GroundConformSpec, skin: InstancedSkinData, x: number, z: number, lift: number): void {
    const s = mesh.scale.x * (skin.rootPerModel ?? 1);
    const halfL = (spec.length * s) / 2;
    const halfW = (spec.width * s) / 2;
    const yaw = mesh.rotation.y;
    // rest forward is −Z, right is +X
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const front = worldHeightAt(x + fx * halfL, z + fz * halfL);
    const back = worldHeightAt(x - fx * halfL, z - fz * halfL);
    const right = worldHeightAt(x + rx * halfW, z + rz * halfW);
    const left = worldHeightAt(x - rx * halfW, z - rz * halfW);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = Math.atan2(front - back, 2 * halfL); // nose up on a rise
    mesh.rotation.z = Math.atan2(right - left, 2 * halfW); // right side up where the ground is higher
    mesh.position.y = (front + back + right + left) / 4 + lift;
}
