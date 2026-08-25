import { Euler, Group, Quaternion, Vector3 } from 'three';
import { worldHeightAt } from './map';

/** Render-only structure rubble settle — sim death stays instant. */
export type BuildingCollapseState = {
    /** Render clock at start; negative until first tick. */
    startAt: number;
    dur: number;
    startScaleX: number;
    startScaleY: number;
    startScaleZ: number;
    endScaleX: number;
    endScaleY: number;
    endScaleZ: number;
    startRotX: number;
    startRotY: number;
    startRotZ: number;
    endRotX: number;
    endRotY: number;
    endRotZ: number;
    /** Hammer: slerp these instead of euler (random face flat on the lawn). */
    startQuat?: Quaternion;
    endQuat?: Quaternion;
    /** Local Y at collapse start — tip can lift a wide base, so we sink to compensate. */
    startY: number;
    sink: number;
};

const COLLAPSE_DUR = 0.72;
/** Squash height — about half the previous rubble height. */
const RUBBLE_Y = 0.28;
/** Slight footprint shrink so the wreck reads smaller, not ballooned. */
const RUBBLE_XZ = 0.92;
/** Hammer of the Gods — pancaked into the dirt (same 4% height as scenery crush). */
const HAMMER_CRUSH_Y = 0.04;
/** Mild footprint widen — was 1.55, read as ballooned. */
const HAMMER_CRUSH_XZ = 1.2;
const HAMMER_CRUSH_DUR = 0.28;
/**
 * Mesh Y offset for pancakes. Must NOT use {@link GROUND_UNIT_Y} (−0.08): that
 * sinks standing feet into the lawn, which buries a 4%-tall squash completely
 * (blood still pops at torso height — the “invisible on hills” look).
 */
export const HAMMER_CRUSH_SEAT_Y = 0.03;

const _worldUp = new Vector3(0, 1, 0);
const _localUp = new Vector3();
const _qAlign = new Quaternion();
const _qTwist = new Quaternion();
const _qTip = new Quaternion();
const _qTmp = new Quaternion();
const _euler = new Euler();

/**
 * Animate a structure into the rubble pose (squash + lean).
 * Call after marking the mesh dead; does not change sim state.
 */
export function beginBuildingCollapse(
    mesh: Group,
    opts?: { tipX?: number; tipZ?: number; startAt?: number; sink?: number },
): BuildingCollapseState {
    const sx = mesh.scale.x;
    const sy = mesh.scale.y;
    const sz = mesh.scale.z;
    const tipZ = opts?.tipZ ?? 0.08;
    const tipX = opts?.tipX ?? 0.03;
    const state: BuildingCollapseState = {
        startAt: opts?.startAt ?? -1,
        dur: COLLAPSE_DUR,
        startScaleX: sx,
        startScaleY: sy,
        startScaleZ: sz,
        endScaleX: sx * RUBBLE_XZ,
        endScaleY: sy * RUBBLE_Y,
        endScaleZ: sz * RUBBLE_XZ,
        startRotX: mesh.rotation.x,
        startRotY: mesh.rotation.y,
        startRotZ: mesh.rotation.z,
        endRotX: tipX,
        endRotY: mesh.rotation.y,
        endRotZ: tipZ,
        startY: mesh.position.y,
        sink: opts?.sink ?? 0,
    };
    mesh.userData.buildingCollapse = state;
    return state;
}

/**
 * Deterministic tumble + which model face hits the dirt (peers agree).
 * `face` 0..5 → ±Y / ±X / ±Z becomes the thin axis (world up).
 */
export function hammerCrushSpin(seed: number): {
    start: { x: number; y: number; z: number };
    endYaw: number;
    face: number;
} {
    const u = (n: number) => ((Math.imul(seed ^ n, 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
    const face = (Math.imul(seed ^ 0xdeadbeef, 2246822519) >>> 0) % 6;
    return {
        start: { x: u(0x9e3779b9), y: u(0x85ebca6b), z: u(0xc2b2ae35) },
        endYaw: u(0x27d4eb2f),
        face,
    };
}

/** Terrain pitch/roll so a pancake hugs the ground normal (same idea as corpse align). */
export function groundTipAt(x: number, z: number): { tipX: number; tipZ: number } {
    const h = 0.85;
    const dyx = worldHeightAt(x + h, z) - worldHeightAt(x - h, z);
    const dyz = worldHeightAt(x, z + h) - worldHeightAt(x, z - h);
    return {
        tipX: Math.atan2(dyz, 2 * h),
        tipZ: Math.atan2(-dyx, 2 * h),
    };
}

function faceLocalUp(face: number, out: Vector3): Vector3 {
    switch (face) {
        case 1:
            return out.set(0, -1, 0);
        case 2:
            return out.set(1, 0, 0);
        case 3:
            return out.set(-1, 0, 0);
        case 4:
            return out.set(0, 0, 1);
        case 5:
            return out.set(0, 0, -1);
        default:
            return out.set(0, 1, 0);
    }
}

/** Thin along the local axis that will point at world up after {@link flatOnGroundQuat}. */
function crushEndScale(
    sx: number,
    sy: number,
    sz: number,
    face: number,
): { x: number; y: number; z: number } {
    const thin = HAMMER_CRUSH_Y;
    const wide = HAMMER_CRUSH_XZ;
    if (face <= 1) return { x: sx * wide, y: sy * thin, z: sz * wide };
    if (face <= 3) return { x: sx * thin, y: sy * wide, z: sz * wide };
    return { x: sx * wide, y: sy * wide, z: sz * thin };
}

/**
 * Orient so `face`'s local axis → world up, then twist around up, then tip to terrain.
 * Squashing that local axis then flattens cleanly onto the ground.
 */
function flatOnGroundQuat(face: number, endYaw: number, tipX: number, tipZ: number): Quaternion {
    faceLocalUp(face, _localUp);
    _qAlign.setFromUnitVectors(_localUp, _worldUp);
    _qTwist.setFromAxisAngle(_worldUp, endYaw);
    _qTip.setFromEuler(_euler.set(tipX, 0, tipZ, 'XYZ'));
    // tip * twist * align — model face → up, spin on lawn, then follow slope
    return _qTip.clone().multiply(_qTwist).multiply(_qAlign);
}

/**
 * Hammer of the Gods: random 3D tumble, then flatten onto the ground normal.
 * A random model face (±X/Y/Z) becomes the thin axis so you don't always see the top.
 */
export function beginHammerCrush(
    mesh: Group,
    opts?: {
        groundY?: number;
        startAt?: number;
        spin?: { start: { x: number; y: number; z: number }; endYaw: number; face: number };
        /** Ground-normal tip at the crush seat (from {@link groundTipAt}). */
        endTipX?: number;
        endTipZ?: number;
    },
): BuildingCollapseState {
    const spin = opts?.spin;
    const face = spin?.face ?? 0;
    const endYaw = spin?.endYaw ?? mesh.rotation.y;
    const endTipX = opts?.endTipX ?? 0;
    const endTipZ = opts?.endTipZ ?? 0;

    const startQuat = new Quaternion();
    if (spin) {
        startQuat.setFromEuler(_euler.set(spin.start.x, spin.start.y, spin.start.z, 'XYZ'));
        mesh.quaternion.copy(startQuat);
    } else {
        startQuat.copy(mesh.quaternion);
    }
    const endQuat = flatOnGroundQuat(face, endYaw, endTipX, endTipZ);

    const sx = mesh.scale.x;
    const sy = mesh.scale.y;
    const sz = mesh.scale.z;
    const endS = crushEndScale(sx, sy, sz, face);

    const state: BuildingCollapseState = {
        startAt: opts?.startAt ?? -1,
        dur: HAMMER_CRUSH_DUR,
        startScaleX: sx,
        startScaleY: sy,
        startScaleZ: sz,
        endScaleX: endS.x,
        endScaleY: endS.y,
        endScaleZ: endS.z,
        startRotX: mesh.rotation.x,
        startRotY: mesh.rotation.y,
        startRotZ: mesh.rotation.z,
        endRotX: endTipX,
        endRotY: endYaw,
        endRotZ: endTipZ,
        startQuat,
        endQuat,
        startY: opts?.groundY ?? mesh.position.y,
        sink: 0,
    };
    mesh.position.y = state.startY;
    mesh.userData.buildingCollapse = state;
    mesh.userData.hammerCrushed = true;
    return state;
}

/** Apply collapse pose. Returns false when finished. */
export function tickBuildingCollapse(
    mesh: Group,
    state: BuildingCollapseState,
    renderTime: number,
): boolean {
    if (state.startAt < 0) state.startAt = renderTime;
    const u = Math.min(1, Math.max(0, (renderTime - state.startAt) / state.dur));
    // heavy drop then soft settle — avoid the early balloon squash
    const e = u < 0.4 ? (u / 0.4) * (u / 0.4) * 0.55 : 0.55 + 0.45 * (1 - Math.pow(1 - (u - 0.4) / 0.6, 2));
    mesh.scale.set(
        state.startScaleX + (state.endScaleX - state.startScaleX) * e,
        state.startScaleY + (state.endScaleY - state.startScaleY) * e,
        state.startScaleZ + (state.endScaleZ - state.startScaleZ) * e,
    );
    if (state.startQuat && state.endQuat) {
        _qTmp.copy(state.startQuat).slerp(state.endQuat, e);
        mesh.quaternion.copy(_qTmp);
    } else {
        mesh.rotation.x = state.startRotX + (state.endRotX - state.startRotX) * e;
        mesh.rotation.y = state.startRotY + (state.endRotY - state.startRotY) * e;
        mesh.rotation.z = state.startRotZ + (state.endRotZ - state.startRotZ) * e;
    }
    // Pull the pivot down as it tips so a wide footprint doesn't hang in the air
    mesh.position.y = state.startY - state.sink * e;
    if (u >= 1) {
        mesh.scale.set(state.endScaleX, state.endScaleY, state.endScaleZ);
        if (state.endQuat) mesh.quaternion.copy(state.endQuat);
        else {
            mesh.rotation.x = state.endRotX;
            mesh.rotation.y = state.endRotY;
            mesh.rotation.z = state.endRotZ;
        }
        mesh.position.y = state.startY - state.sink;
        return false;
    }
    return true;
}

export function clearBuildingCollapse(mesh: Group): void {
    delete mesh.userData.buildingCollapse;
    // Keep hammerCrushed so pancakes stay visible after the squash anim ends
}

/** Round reset / revive — drop the permanent pancake flag too. */
export function clearHammerCrush(mesh: Group): void {
    delete mesh.userData.buildingCollapse;
    delete mesh.userData.hammerCrushed;
}
