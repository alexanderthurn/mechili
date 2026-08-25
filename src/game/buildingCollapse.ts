import type { Group } from 'three';

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
    startRotZ: number;
    endRotX: number;
    endRotZ: number;
    /** Local Y at collapse start — tip can lift a wide base, so we sink to compensate. */
    startY: number;
    sink: number;
};

const COLLAPSE_DUR = 0.72;
/** Squash height — about half the previous rubble height. */
const RUBBLE_Y = 0.28;
/** Slight footprint shrink so the wreck reads smaller, not ballooned. */
const RUBBLE_XZ = 0.92;
/** Hammer of the Gods — pancaked into the dirt. */
const HAMMER_CRUSH_Y = 0.045;
const HAMMER_CRUSH_XZ = 1.45;
const HAMMER_CRUSH_DUR = 0.28;

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
        startRotZ: mesh.rotation.z,
        endRotX: tipX,
        endRotZ: tipZ,
        startY: mesh.position.y,
        sink: opts?.sink ?? 0,
    };
    mesh.userData.buildingCollapse = state;
    return state;
}

/**
 * Hammer of the Gods: slam the mesh paper-thin onto the ground (units + buildings).
 * Uses the same ticker as {@link beginBuildingCollapse}.
 */
export function beginHammerCrush(
    mesh: Group,
    opts?: { groundY?: number; startAt?: number },
): BuildingCollapseState {
    const sx = mesh.scale.x;
    const sy = mesh.scale.y;
    const sz = mesh.scale.z;
    const state: BuildingCollapseState = {
        startAt: opts?.startAt ?? -1,
        dur: HAMMER_CRUSH_DUR,
        startScaleX: sx,
        startScaleY: sy,
        startScaleZ: sz,
        endScaleX: sx * HAMMER_CRUSH_XZ,
        endScaleY: Math.max(0.02, sy * HAMMER_CRUSH_Y),
        endScaleZ: sz * HAMMER_CRUSH_XZ,
        startRotX: mesh.rotation.x,
        startRotZ: mesh.rotation.z,
        endRotX: 0,
        endRotZ: 0,
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
    mesh.rotation.x = state.startRotX + (state.endRotX - state.startRotX) * e;
    mesh.rotation.z = state.startRotZ + (state.endRotZ - state.startRotZ) * e;
    // Pull the pivot down as it tips so a wide footprint doesn't hang in the air
    mesh.position.y = state.startY - state.sink * e;
    if (u >= 1) {
        mesh.scale.set(state.endScaleX, state.endScaleY, state.endScaleZ);
        mesh.rotation.x = state.endRotX;
        mesh.rotation.z = state.endRotZ;
        mesh.position.y = state.startY - state.sink;
        return false;
    }
    return true;
}

export function clearBuildingCollapse(mesh: Group): void {
    delete mesh.userData.buildingCollapse;
    delete mesh.userData.hammerCrushed;
}
