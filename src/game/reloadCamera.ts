/**
 * Dev convenience: a page reload (Vite after a code change, or F5) brings the
 * camera back to where it was. The pose is written once, on `pagehide` — never
 * per frame — into sessionStorage, which belongs to this tab only and is gone
 * when the tab closes, so nothing lands in the player's localStorage. The next
 * match start takes it (and removes it), so it applies exactly once.
 */

import type { RigState } from '../engine/cameraRig';

const KEY = 'melodan-reload-camera';

export function saveReloadCamera(pose: RigState): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(pose));
    } catch {
        /* storage blocked — just no restore */
    }
}

/** The pose saved before the last reload, if any; consumed on read. */
export function takeReloadCamera(): RigState | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (raw === null) return null;
        sessionStorage.removeItem(KEY);
        const p = JSON.parse(raw) as Partial<RigState>;
        const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
        if (!ok(p.x) || !ok(p.z) || !ok(p.zoom) || !ok(p.heading) || !ok(p.pitch)) return null;
        return { x: p.x, z: p.z, zoom: p.zoom, heading: p.heading, pitch: p.pitch };
    } catch {
        return null;
    }
}
