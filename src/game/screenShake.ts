import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export type ScreenShakeOpts = {
    /** Peak positional offset in world units */
    intensity: number;
    /** Seconds until fully decayed */
    duration: number;
    /** Oscillation speed (rad/s); higher = buzzier */
    frequency?: number;
};

type ActiveShake = ScreenShakeOpts & { elapsed: number };

let camera: PerspectiveCamera | null = null;
let getLookTarget: (() => Vector3) | null = null;
const basePos = new Vector3();
const baseTarget = new Vector3();
const offset = new Vector3();
const active: ActiveShake[] = [];

/** Bind the camera used for shake — call once when the match scene boots. */
export function installScreenShake(cam: PerspectiveCamera, lookTarget: () => Vector3): void {
    camera = cam;
    getLookTarget = lookTarget;
}

/**
 * Trigger a screen shake from anywhere (hammer impacts, HP particles, etc.).
 * Multiple calls stack and decay independently.
 */
export function screenShake(opts: ScreenShakeOpts): void {
    active.push({ ...opts, elapsed: 0 });
}

/** Advance shake decay and apply jitter to the bound camera. */
export function updateScreenShake(dtSeconds: number): void {
    if (!camera || !getLookTarget || active.length === 0) return;

    basePos.copy(camera.position);
    baseTarget.copy(getLookTarget());

    offset.set(0, 0, 0);
    for (let i = active.length - 1; i >= 0; i--) {
        const s = active[i]!;
        s.elapsed += dtSeconds;
        const t = MathUtils.clamp(s.elapsed / s.duration, 0, 1);
        const decay = 1 - t * t;
        const freq = s.frequency ?? 28;
        const phase = s.elapsed * freq;
        const amp = s.intensity * decay;
        offset.x += Math.sin(phase * 1.07) * amp;
        offset.y += Math.cos(phase * 1.31) * amp * 0.65;
        offset.z += Math.sin(phase * 0.89 + 1.2) * amp;
        if (t >= 1) active.splice(i, 1);
    }

    camera.position.set(basePos.x + offset.x, basePos.y + offset.y, basePos.z + offset.z);
    camera.lookAt(baseTarget);
}

/** Clear pending shakes (match teardown). */
export function clearScreenShake(): void {
    active.length = 0;
}
