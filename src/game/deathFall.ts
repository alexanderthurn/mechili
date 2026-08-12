import type { Group } from 'three';

/** Render-only air-unit crash — sim death stays instant. */
export type DeathFallState = {
    startY: number;
    groundY: number;
    startAt: number;
    dur: number;
    tipZ: number;
    startRotX: number;
    startRotZ: number;
};

const MIN_DUR = 0.45;
const MAX_DUR = 0.9;

/** Fall duration from drop height (crow ~short, high flyers longer). */
export function deathFallDuration(drop: number): number {
    return Math.min(MAX_DUR, Math.max(MIN_DUR, 0.35 + Math.max(0, drop) * 0.018));
}

export function beginDeathFall(
    mesh: Group,
    groundY: number,
    tipZ: number,
    startAt: number,
): DeathFallState {
    const startY = mesh.position.y;
    const state: DeathFallState = {
        startY,
        groundY,
        startAt,
        dur: deathFallDuration(startY - groundY),
        tipZ,
        startRotX: mesh.rotation.x,
        startRotZ: mesh.rotation.z,
    };
    mesh.userData.deathFall = state;
    return state;
}

/** Apply fall pose. Returns false when finished (caller should clear state). */
export function tickDeathFall(mesh: Group, state: DeathFallState, elapsed: number): boolean {
    const u = Math.min(1, Math.max(0, (elapsed - state.startAt) / state.dur));
    // Gravity-ish: slow start, accelerate into the lawn
    const e = u * u;
    mesh.position.y = state.startY + (state.groundY - state.startY) * e;
    mesh.rotation.z = state.startRotZ + (state.tipZ - state.startRotZ) * u;
    mesh.rotation.x = state.startRotX + 0.55 * u;
    if (u < 1) return true;
    mesh.position.y = state.groundY;
    mesh.rotation.z = state.tipZ;
    mesh.rotation.x = state.startRotX + 0.55;
    return false;
}

export function clearDeathFall(mesh: Group): void {
    delete mesh.userData.deathFall;
}
