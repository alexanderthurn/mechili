import type { Group } from 'three';

/** Render-only air-unit crash — sim death stays instant. */
export type DeathFallState = {
    startY: number;
    groundY: number;
    /** Render clock at fall start; negative until first tick. */
    startAt: number;
    dur: number;
    tipX: number;
    tipZ: number;
    startRotX: number;
    startRotZ: number;
    startMeshX: number;
    startMeshZ: number;
    driftX: number;
    driftZ: number;
    /** World xz of the pack origin (for landing VFX / ground sample). */
    originX: number;
    originZ: number;
};

/** World point where a crash just hit the lawn. */
export type CrashLand = { x: number; y: number; z: number };

/** Ground mech tip-over after death (render-only). */
export type DeathTipState = {
    /** Render clock at tip start; negative until first tick. */
    startAt: number;
    dur: number;
    tipX: number;
    tipZ: number;
    startRotX: number;
    startRotZ: number;
    groundY: number;
};

const MIN_DUR = 0.45;
const MAX_DUR = 0.9;
const DEATH_TIP_DUR = 0.38;
/** Full-power (heavy overkill) horizontal fling in world units. */
const MAX_CRASH_DRIFT = 36;

/** Fall duration from drop height (crow ~short, high flyers longer). */
export function deathFallDuration(drop: number): number {
    return Math.min(MAX_DUR, Math.max(MIN_DUR, 0.35 + Math.max(0, drop) * 0.018));
}

/**
 * Knock intensity 0..1 from killing blow vs victim max HP.
 * Fair/~1× kills (archer into crow) stay mild; big overkill (ballista) → 1.
 */
export function crashKnockPower(dealt: number, maxHp: number): number {
    const r = dealt / Math.max(1, maxHp);
    // archer ~1.4× → ~0.14 (~5u); ballista overkill → 1 (~36u)
    return Math.min(1, Math.max(0.08, (r - 0.9) / 4));
}

/** Tip-over magnitude (radians) — ballista overkill lays them flatter. */
export function deathTipAmount(dealt: number, maxHp: number): number {
    return 1.1 + crashKnockPower(dealt, maxHp) * 0.55;
}

/**
 * Map world knock xz into local tip rotations so the corpse falls along the blow.
 * Rest forward is −Z; `facingYaw` is mesh.rotation.y.
 */
export function deathTipFromKnock(
    facingYaw: number,
    knockX: number,
    knockZ: number,
    amount: number,
): { tipX: number; tipZ: number } {
    const len = Math.hypot(knockX, knockZ);
    if (len < 1e-6) {
        return { tipX: amount * 0.25, tipZ: amount };
    }
    const nx = knockX / len;
    const nz = knockZ / len;
    const c = Math.cos(facingYaw);
    const s = Math.sin(facingYaw);
    // world → local (inverse of rest-forward −Z bake used by AttackNode)
    const lx = nx * c - nz * s;
    const lz = nx * s + nz * c;
    return {
        tipX: amount * -lz,
        tipZ: amount * lx,
    };
}

export function beginDeathFall(
    mesh: Group,
    groundY: number,
    tipZ: number,
    startAt: number,
    originX: number,
    originZ: number,
    driftX = 0,
    driftZ = 0,
    startY = mesh.position.y,
    tipX = 0.55,
): DeathFallState {
    const driftLen = Math.hypot(driftX, driftZ);
    const state: DeathFallState = {
        startY,
        groundY,
        startAt,
        // long flings need a beat longer in the air so the throw reads
        dur: deathFallDuration(startY - groundY) + Math.min(0.55, driftLen * 0.012),
        tipZ,
        tipX,
        startRotX: mesh.rotation.x,
        startRotZ: mesh.rotation.z,
        startMeshX: mesh.position.x,
        startMeshZ: mesh.position.z,
        driftX,
        driftZ,
        originX,
        originZ,
    };
    mesh.userData.deathFall = state;
    return state;
}

/** Apply fall pose. Returns false when finished (caller should clear state). */
export function tickDeathFall(
    mesh: Group,
    state: DeathFallState,
    renderTime: number,
    sampleGroundY: (worldX: number, worldZ: number) => number,
): boolean {
    if (state.startAt < 0) state.startAt = renderTime;
    const u = Math.min(1, Math.max(0, (renderTime - state.startAt) / state.dur));
    // Gravity-ish drop; horizontal ease-out so the fling reads early
    const e = u * u;
    const h = 1 - (1 - u) * (1 - u);
    const mx = state.startMeshX + state.driftX * h;
    const mz = state.startMeshZ + state.driftZ * h;
    mesh.position.x = mx;
    mesh.position.z = mz;
    const groundY = sampleGroundY(state.originX + mx, state.originZ + mz);
    state.groundY = groundY;
    mesh.position.y = state.startY + (groundY - state.startY) * e;
    mesh.rotation.z = state.startRotZ + (state.tipZ - state.startRotZ) * u;
    mesh.rotation.x = state.startRotX + (state.tipX - state.startRotX) * u;
    if (u < 1) return true;
    mesh.position.y = groundY;
    mesh.rotation.z = state.tipZ;
    mesh.rotation.x = state.tipX;
    return false;
}

export function clearDeathFall(mesh: Group): void {
    delete mesh.userData.deathFall;
}

/**
 * Stomp / dive can pin the mesh to the lawn while sim altitude is still air.
 * Lift back to hover and clear stomp tilt so the crash arc always reads.
 */
export function snapFlyerForDeathFall(mesh: Group, hoverY: number, visualScale: number): void {
    if (mesh.position.y < hoverY - 0.5) mesh.position.y = hoverY;
    mesh.rotation.x = 0;
    mesh.scale.setScalar(visualScale);
}

/** Tip a ground mech onto its side over a short beat (render-only). */
export function beginDeathTip(
    mesh: Group,
    tipZ: number,
    groundY: number,
    startAt: number,
    tipX = 0.35,
): DeathTipState {
    const state: DeathTipState = {
        startAt,
        dur: DEATH_TIP_DUR,
        tipX,
        tipZ,
        startRotX: mesh.rotation.x,
        startRotZ: mesh.rotation.z,
        groundY,
    };
    mesh.userData.deathTip = state;
    return state;
}

/** Apply tip pose. Returns false when finished. */
export function tickDeathTip(mesh: Group, state: DeathTipState, renderTime: number): boolean {
    if (state.startAt < 0) state.startAt = renderTime;
    const u = Math.min(1, Math.max(0, (renderTime - state.startAt) / state.dur));
    const e = u * u * (3 - 2 * u);
    mesh.rotation.z = state.startRotZ + (state.tipZ - state.startRotZ) * e;
    mesh.rotation.x = state.startRotX + (state.tipX - state.startRotX) * e;
    mesh.position.y = state.groundY;
    if (u >= 1) {
        mesh.rotation.z = state.tipZ;
        mesh.rotation.x = state.tipX;
        return false;
    }
    return true;
}

export function clearDeathTip(mesh: Group): void {
    delete mesh.userData.deathTip;
}

export function crashLandFromFall(state: DeathFallState): CrashLand {
    const mx = state.startMeshX + state.driftX;
    const mz = state.startMeshZ + state.driftZ;
    return {
        x: state.originX + mx,
        y: state.groundY + 0.12,
        z: state.originZ + mz,
    };
}

export function crashDriftFromKnock(
    dealt: number,
    maxHp: number,
    dirX: number,
    dirZ: number,
): { driftX: number; driftZ: number } {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return { driftX: 0, driftZ: 0 };
    const dist = MAX_CRASH_DRIFT * crashKnockPower(dealt, maxHp);
    return { driftX: (dirX / len) * dist, driftZ: (dirZ / len) * dist };
}
