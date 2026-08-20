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
};

const COLLAPSE_DUR = 0.72;
/** Squash height as a fraction of the live building scale — keep some mass, not a pancake. */
const RUBBLE_Y = 0.55;
/** Almost no footprint bulge (bulge read as a balloon deflating). */
const RUBBLE_XZ = 1.02;

/**
 * Animate a structure into the rubble pose (squash + lean).
 * Call after marking the mesh dead; does not change sim state.
 */
export function beginBuildingCollapse(
    mesh: Group,
    opts?: { tipX?: number; tipZ?: number; startAt?: number },
): BuildingCollapseState {
    const sx = mesh.scale.x;
    const sy = mesh.scale.y;
    const sz = mesh.scale.z;
    const tipZ = opts?.tipZ ?? 0.22;
    const tipX = opts?.tipX ?? 0.08;
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
    };
    mesh.userData.buildingCollapse = state;
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
    if (u >= 1) {
        mesh.scale.set(state.endScaleX, state.endScaleY, state.endScaleZ);
        mesh.rotation.x = state.endRotX;
        mesh.rotation.z = state.endRotZ;
        return false;
    }
    return true;
}

export function clearBuildingCollapse(mesh: Group): void {
    delete mesh.userData.buildingCollapse;
}
