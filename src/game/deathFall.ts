import { Quaternion, Vector3, type Group } from 'three';
import { worldHeightAt } from './map';

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

/**
 * Skinned death clip playing — seat on the lawn while the mixer tips them.
 * Yaw eases from combat facing toward the knock-aligned fall direction.
 */
export type DeathClipState = {
    startAt: number;
    dur: number;
    groundY: number;
    startYaw: number;
    endYaw: number;
    /** Share of {@link dur} used to ease yaw (0 = snap, 1 = whole clip). */
    yawBlend: number;
};

const MIN_DUR = 0.45;
const MAX_DUR = 0.9;
const DEATH_TIP_DUR = 0.48;
/** Full-power (heavy overkill) horizontal fling in world units. */
const MAX_CRASH_DRIFT = 36;
/** Radians — tip all the way onto their side (flat on the lawn). */
const LAY_FLAT = Math.PI * 0.5;

/** Fall duration from drop height (crow ~short, high flyers longer). */
export function deathFallDuration(drop: number): number {
    return Math.min(MAX_DUR, Math.max(MIN_DUR, 0.35 + Math.max(0, drop) * 0.018));
}

/**
 * Knock intensity 0..1 from killing blow vs victim max HP.
 * Fair/chip kills (archer into crow) barely fling; big overkill (ballista) → 1.
 */
export function crashKnockPower(dealt: number, maxHp: number): number {
    const r = dealt / Math.max(1, maxHp);
    // Sub-overkill: no forced minimum — arrows used to shove crows sideways
    if (r < 1.2) return Math.min(0.18, Math.max(0, (r - 0.85) / 2.5));
    return Math.min(1, Math.max(0.18, (r - 0.9) / 4));
}

/** Tip-over magnitude (radians) — always near-flat; overkill adds a little extra flop. */
export function deathTipAmount(dealt: number, maxHp: number): number {
    return LAY_FLAT + crashKnockPower(dealt, maxHp) * 0.18;
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
    // Tip so the crown moves with the blow (Rx/Rz right-hand → negate local axes).
    return {
        tipX: amount * lz,
        tipZ: amount * -lx,
    };
}

/**
 * Yaw so an authored fall direction in holder XZ (rest forward −Z) lines up
 * with the world knock. Three.js Ry: (x,z) → (c x + s z, −s x + c z).
 */
export function deathYawFromKnock(
    knockX: number,
    knockZ: number,
    fallLocalX: number,
    fallLocalZ: number,
    fallbackYaw: number,
): number {
    const kLen = Math.hypot(knockX, knockZ);
    const fLen = Math.hypot(fallLocalX, fallLocalZ);
    if (kLen < 1e-6 || fLen < 1e-6) return fallbackYaw;
    const nx = knockX / kLen;
    const nz = knockZ / kLen;
    const fx = fallLocalX / fLen;
    const fz = fallLocalZ / fLen;
    // Want Ry(yaw) * fallLocal = knock  → yaw = atan2(knock) − atan2(fallLocal)
    return Math.atan2(nx, nz) - Math.atan2(fx, fz);
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

/** Seat a skinned death clip on the lawn for `dur` seconds (no Rx/Rz tip). */
export function beginDeathClip(
    mesh: Group,
    groundY: number,
    dur: number,
    startAt: number,
    endYaw?: number,
    /** 0..1 of clip duration spent easing yaw toward knock alignment */
    yawBlend = 0.4,
): DeathClipState {
    const state: DeathClipState = {
        startAt,
        dur: Math.max(0.2, dur),
        groundY,
        startYaw: mesh.rotation.y,
        endYaw: endYaw ?? mesh.rotation.y,
        yawBlend: Math.min(1, Math.max(0, yawBlend)),
    };
    mesh.userData.deathClip = state;
    // Clip owns the tip — clear any leftover procedural lean from walk.
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;
    mesh.position.y = groundY;
    return state;
}

function lerpYaw(from: number, to: number, t: number): number {
    const tau = Math.PI * 2;
    let d = ((to - from) % tau + tau) % tau;
    if (d > Math.PI) d -= tau;
    return from + d * t;
}

/** Seat while the death clip plays. Returns false when finished. */
export function tickDeathClip(mesh: Group, state: DeathClipState, renderTime: number): boolean {
    if (state.startAt < 0) state.startAt = renderTime;
    mesh.position.y = state.groundY;
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;
    const u = Math.min(1, Math.max(0, (renderTime - state.startAt) / state.dur));
    // Ease yaw early in the fall so the side-lay lines up without a hard snap.
    const yawU =
        state.yawBlend <= 1e-6 ? 1 : Math.min(1, u / Math.max(1e-6, state.yawBlend));
    const e = yawU * yawU * (3 - 2 * yawU);
    mesh.rotation.y = lerpYaw(state.startYaw, state.endYaw, e);
    return u < 1;
}

export function clearDeathClip(mesh: Group): void {
    delete mesh.userData.deathClip;
}

/** Bake the finished tip pose so later frames can add terrain slope. */
export function settleCorpsePose(mesh: Group): void {
    mesh.userData.corpseSettled = true;
    mesh.userData.corpseTipX = mesh.rotation.x;
    mesh.userData.corpseTipZ = mesh.rotation.z;
}

/**
 * Forget a baked pose, so the next death bakes its own.
 *
 * `corpseSettled` lives on the mesh, and meshes outlive the round that killed
 * them — without this a unit's SECOND death would be overwritten by the angles
 * its FIRST one settled at, which reads as the corpse suddenly sitting back up.
 */
export function clearCorpsePose(mesh: Group): void {
    delete mesh.userData.corpseSettled;
    delete mesh.userData.corpseTipX;
    delete mesh.userData.corpseTipZ;
}

const _corpseUp = new Vector3(0, 1, 0);
const _corpseNormal = new Vector3();
const _corpseSlope = new Quaternion();

/**
 * Keep a settled wreck flat on the lawn and tilted with the local slope
 * (same central-difference normal idea as blob shadows).
 *
 * The slope turn is applied in WORLD space, on top of the corpse's own pose:
 * folding it into the mesh's own pitch / roll angles mixes it with the yaw the
 * body fell at, which left corpses lying across the slope at odd angles.
 */
export function alignSettledCorpse(
    mesh: Group,
    worldX: number,
    worldZ: number,
    groundY: number,
): void {
    if (!mesh.userData.corpseSettled) {
        settleCorpsePose(mesh);
    }
    const tipX = mesh.userData.corpseTipX as number;
    const tipZ = mesh.userData.corpseTipZ as number;
    const h = 0.85;
    const dyx = worldHeightAt(worldX + h, worldZ) - worldHeightAt(worldX - h, worldZ);
    const dyz = worldHeightAt(worldX, worldZ + h) - worldHeightAt(worldX, worldZ - h);
    // ground normal from the two central differences
    _corpseNormal.set(-dyx / (2 * h), 1, -dyz / (2 * h)).normalize();
    mesh.rotation.x = tipX;
    mesh.rotation.z = tipZ;
    _corpseSlope.setFromUnitVectors(_corpseUp, _corpseNormal);
    mesh.quaternion.premultiply(_corpseSlope);
    // Slight sink so the silhouette kisses the grass instead of hovering
    mesh.position.y = groundY - 0.06;
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
