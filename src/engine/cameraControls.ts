import type { Vector3 } from 'three';
import type { CameraRig } from './cameraRig';

const EDGE_MARGIN = 24; // px from the viewport edge that triggers edge scrolling
const ROTATE_SPEED = Math.PI / 2; // rad/s for Q/E
const ORBIT_HEADING_PER_PX = 0.005; // rad per dragged pixel
const ORBIT_PITCH_PER_PX = 0.004;

/**
 * Typical RTS camera input on top of {@link CameraRig}:
 *  - WASD / arrows: heading-relative panning
 *  - mouse at screen edges: edge scrolling
 *  - middle drag: orbit — left/right rotates, up/down tilts forward/backward
 *  - right drag: grab the ground and pan (the point stays under the cursor)
 *  - wheel: straight zoom toward the cursor
 *  - Q / E: rotate, Home: reset rotation, tilt and zoom
 */
export class CameraControls {
    /** set to false to disable edge scrolling (e.g. in windowed dev) */
    edgeScroll = true;
    /** fired on a middle CLICK (press without drag) — orbit only starts once the mouse moves */
    onMiddleClick: (() => void) | null = null;

    private readonly pressed = new Set<string>();
    private dragGround: Vector3 | null = null;
    private orbitLast: { x: number; y: number } | null = null;
    private orbitStart: { x: number; y: number } | null = null;
    private pointer: { x: number; y: number } | null = null;
    private readonly disposers: (() => void)[] = [];

    constructor(
        private readonly rig: CameraRig,
        private readonly surface: HTMLElement,
    ) {
        const listen = (
            targetEl: HTMLElement | Window,
            type: string,
            handler: (e: any) => void,
            options?: AddEventListenerOptions,
        ) => {
            targetEl.addEventListener(type, handler, options);
            this.disposers.push(() => targetEl.removeEventListener(type, handler));
        };

        listen(window, 'keydown', (e: KeyboardEvent) => {
            this.pressed.add(e.code);
            if (e.code === 'Home') this.rig.resetView();
        });
        listen(window, 'keyup', (e: KeyboardEvent) => this.pressed.delete(e.code));
        listen(window, 'blur', () => {
            this.pressed.clear();
            this.pointer = null;
        });

        listen(
            surface,
            'wheel',
            (e: WheelEvent) => {
                e.preventDefault();
                const local = this.toLocal(e);
                this.rig.zoomAt(Math.exp(e.deltaY * 0.0012), local.x, local.y);
            },
            { passive: false },
        );

        listen(surface, 'contextmenu', (e: MouseEvent) => e.preventDefault());
        listen(surface, 'pointerdown', (e: PointerEvent) => {
            if (e.button === 1) {
                e.preventDefault(); // no middle-click autoscroll
                this.orbitLast = { x: e.clientX, y: e.clientY };
                this.orbitStart = { x: e.clientX, y: e.clientY };
                this.surface.setPointerCapture(e.pointerId);
            } else if (e.button === 2) {
                this.dragGround = this.pick(e);
                this.surface.setPointerCapture(e.pointerId);
            }
        });
        listen(surface, 'pointermove', (e: PointerEvent) => {
            this.pointer = this.toLocal(e);
            if (this.orbitLast) {
                const dx = e.clientX - this.orbitLast.x;
                const dy = e.clientY - this.orbitLast.y;
                this.orbitLast = { x: e.clientX, y: e.clientY };
                // drag left rotates right, drag down tilts toward top-down
                this.rig.orbit(-dx * ORBIT_HEADING_PER_PX, dy * ORBIT_PITCH_PER_PX);
                return;
            }
            if (!this.dragGround) return;
            const now = this.pick(e);
            if (!now) return;
            this.rig.pan(this.dragGround.x - now.x, this.dragGround.z - now.z, true);
        });
        listen(surface, 'pointerleave', () => {
            this.pointer = null;
        });
        listen(surface, 'pointerup', (e: PointerEvent) => {
            if (e.button === 1 && this.orbitStart) {
                const moved = Math.hypot(e.clientX - this.orbitStart.x, e.clientY - this.orbitStart.y);
                if (moved <= 5) this.onMiddleClick?.();
            }
            this.dragGround = null;
            this.orbitLast = null;
            this.orbitStart = null;
        });
        listen(surface, 'pointercancel', () => {
            this.dragGround = null;
            this.orbitLast = null;
            this.orbitStart = null;
        });
    }

    update(dtSeconds: number): void {
        // rotation
        let spin = 0;
        if (this.pressed.has('KeyQ')) spin += 1;
        if (this.pressed.has('KeyE')) spin -= 1;
        if (spin !== 0) this.rig.rotate(spin * ROTATE_SPEED * dtSeconds);

        // keyboard + edge panning, relative to the camera heading
        let dx = 0;
        let dz = 0;
        if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) dz += 1;
        if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) dz -= 1;
        if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) dx -= 1;
        if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) dx += 1;

        if (this.edgeScroll && this.pointer && !this.dragGround) {
            const rect = this.surface.getBoundingClientRect();
            if (this.pointer.x < EDGE_MARGIN) dx -= 1;
            if (this.pointer.x > rect.width - EDGE_MARGIN) dx += 1;
            if (this.pointer.y < EDGE_MARGIN) dz += 1;
            if (this.pointer.y > rect.height - EDGE_MARGIN) dz -= 1;
        }

        if (dx !== 0 || dz !== 0) {
            const speed = this.rig.zoom * 0.9 * dtSeconds;
            const invLen = 1 / Math.hypot(dx, dz);
            const fwd = this.rig.groundForward;
            const right = this.rig.groundRight;
            this.rig.pan(
                (right.x * dx + fwd.x * dz) * speed * invLen,
                (right.z * dx + fwd.z * dz) * speed * invLen,
            );
        }
    }

    private toLocal(e: MouseEvent): { x: number; y: number } {
        const rect = this.surface.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private pick(e: PointerEvent): Vector3 | null {
        const rect = this.surface.getBoundingClientRect();
        return this.rig.screenToGround(
            e.clientX - rect.left,
            e.clientY - rect.top,
            rect.width,
            rect.height,
        );
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
    }
}
