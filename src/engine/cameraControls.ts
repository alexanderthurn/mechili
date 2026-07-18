import type { Vector3 } from 'three';
import type { CameraRig } from './cameraRig';

const EDGE_MARGIN = 24; // px from the viewport edge that triggers edge scrolling
const ROTATE_SPEED = Math.PI / 2; // rad/s for Q/E
const ORBIT_HEADING_PER_PX = 0.005; // rad per dragged pixel
const ORBIT_PITCH_PER_PX = 0.004;

/** single-finger drags shorter than this stay taps (placement clicks) */
const TOUCH_PAN_SLOP = 9;
/**
 * Two-finger gestures are winner-takes-all: the first intent to cross its
 * threshold locks the gesture until a finger lifts, so zooming never also
 * rotates and twisting never also zooms.
 */
const PINCH_ZOOM_THRESHOLD = 24; // px of finger-distance change
const TWIST_THRESHOLD = 0.12; // rad of finger-pair rotation (~7°)
const TILT_THRESHOLD = 20; // px of midpoint travel up/down

/**
 * Typical RTS camera input on top of {@link CameraRig}:
 *  - WASD / arrows: heading-relative panning
 *  - mouse at screen edges: edge scrolling
 *  - middle drag: orbit — left/right rotates, up/down tilts forward/backward
 *  - right drag: grab the ground and pan (the point stays under the cursor)
 *  - wheel: straight zoom toward the cursor
 *  - Q / E: rotate, Home: reset rotation, tilt and zoom
 *
 * Touch (no mouse buttons — gestures instead):
 *  - one-finger drag: grab the ground and pan (taps stay placement clicks;
 *    suppressed while a ghost/carried pack rides the finger)
 *  - pinch: zoom at the midpoint
 *  - two-finger twist: rotate the heading (map-app style)
 *  - two fingers dragged up/down together: tilt
 */
export class CameraControls {
    /** set to false to disable edge scrolling (e.g. in windowed dev) */
    edgeScroll = true;
    /** fired on a middle CLICK (press without drag) — orbit only starts once the mouse moves */
    onMiddleClick: (() => void) | null = null;
    /** fired on a right CLICK (press without drag) — pan only counts once the mouse moves */
    onRightClick: (() => void) | null = null;
    /** while true, one-finger drags aim/carry instead of panning (game wires placement state) */
    suppressTouchPan: (() => boolean) | null = null;

    private readonly pressed = new Set<string>();
    private dragGround: Vector3 | null = null;
    private dragStart: { x: number; y: number } | null = null;
    private orbitLast: { x: number; y: number } | null = null;
    private orbitStart: { x: number; y: number } | null = null;
    private pointer: { x: number; y: number } | null = null;
    private readonly touches = new Map<number, { x: number; y: number }>();
    private touchPanGround: Vector3 | null = null;
    private touchPanActive = false;
    private touchDown: { x: number; y: number } | null = null;
    private pinchLast: { dist: number; midX: number; midY: number; angle: number } | null = null;
    private pinchStart: { dist: number; midX: number; midY: number; angle: number } | null = null;
    private pinchMode: 'idle' | 'zoom' | 'twist' | 'tilt' = 'idle';
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

        // stop the browser from scrolling/pinch-zooming the page itself
        surface.style.touchAction = 'none';

        listen(surface, 'contextmenu', (e: MouseEvent) => e.preventDefault());
        listen(surface, 'pointerdown', (e: PointerEvent) => {
            if (e.pointerType === 'touch') {
                this.onTouchDown(e);
                return;
            }
            if (e.button === 1) {
                e.preventDefault(); // no middle-click autoscroll
                this.orbitLast = { x: e.clientX, y: e.clientY };
                this.orbitStart = { x: e.clientX, y: e.clientY };
                this.surface.setPointerCapture(e.pointerId);
            } else if (e.button === 2) {
                this.dragGround = this.pick(e);
                this.dragStart = { x: e.clientX, y: e.clientY };
                this.surface.setPointerCapture(e.pointerId);
            }
        });
        listen(surface, 'pointermove', (e: PointerEvent) => {
            if (e.pointerType === 'touch') {
                this.onTouchMove(e);
                return;
            }
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
            if (e.pointerType === 'touch') {
                this.onTouchEnd(e);
                return;
            }
            if (e.button === 1 && this.orbitStart) {
                const moved = Math.hypot(e.clientX - this.orbitStart.x, e.clientY - this.orbitStart.y);
                if (moved <= 5) this.onMiddleClick?.();
            }
            if (e.button === 2 && this.dragStart) {
                const moved = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
                if (moved <= 5) this.onRightClick?.();
            }
            this.dragGround = null;
            this.dragStart = null;
            this.orbitLast = null;
            this.orbitStart = null;
        });
        listen(surface, 'pointercancel', (e: PointerEvent) => {
            if (e.pointerType === 'touch') {
                this.onTouchEnd(e);
                return;
            }
            this.dragGround = null;
            this.dragStart = null;
            this.orbitLast = null;
            this.orbitStart = null;
        });
    }

    // --- touch gestures ----------------------------------------------------

    private onTouchDown(e: PointerEvent): void {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 1) {
            this.touchDown = { x: e.clientX, y: e.clientY };
            this.touchPanGround = this.pickAt(e.clientX, e.clientY);
            this.touchPanActive = false;
        } else if (this.touches.size === 2) {
            // second finger: abandon panning, start pinch/twist/tilt
            this.touchPanGround = null;
            this.touchPanActive = false;
            this.pinchLast = this.pinchState();
            this.pinchStart = this.pinchLast;
            this.pinchMode = 'idle';
        } else {
            this.pinchLast = null;
        }
    }

    private onTouchMove(e: PointerEvent): void {
        const touch = this.touches.get(e.pointerId);
        if (!touch) return;
        touch.x = e.clientX;
        touch.y = e.clientY;

        if (this.touches.size === 1 && this.touchPanGround && this.touchDown) {
            if (!this.touchPanActive) {
                const moved = Math.hypot(e.clientX - this.touchDown.x, e.clientY - this.touchDown.y);
                if (moved <= TOUCH_PAN_SLOP) return; // still a potential tap
                if (this.suppressTouchPan?.()) return; // finger carries a ghost — placement aims
                this.touchPanActive = true;
            }
            const now = this.pickAt(e.clientX, e.clientY);
            if (now) this.rig.pan(this.touchPanGround.x - now.x, this.touchPanGround.z - now.z, true);
            return;
        }

        if (this.touches.size === 2 && this.pinchLast && this.pinchStart) {
            const pinch = this.pinchState();
            if (!pinch) return;
            let angleDelta = pinch.angle - this.pinchLast.angle;
            if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
            else if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

            if (this.pinchMode === 'idle') {
                // first intent past its threshold wins the whole gesture
                let angleFromStart = pinch.angle - this.pinchStart.angle;
                if (angleFromStart > Math.PI) angleFromStart -= 2 * Math.PI;
                else if (angleFromStart < -Math.PI) angleFromStart += 2 * Math.PI;
                if (Math.abs(pinch.dist - this.pinchStart.dist) > PINCH_ZOOM_THRESHOLD) {
                    this.pinchMode = 'zoom';
                } else if (Math.abs(angleFromStart) > TWIST_THRESHOLD) {
                    this.pinchMode = 'twist';
                } else if (Math.abs(pinch.midY - this.pinchStart.midY) > TILT_THRESHOLD) {
                    this.pinchMode = 'tilt';
                }
            }

            if (this.pinchMode === 'zoom' && pinch.dist > 0 && this.pinchLast.dist > 0) {
                const rect = this.surface.getBoundingClientRect();
                this.rig.zoomAt(
                    this.pinchLast.dist / pinch.dist,
                    pinch.midX - rect.left,
                    pinch.midY - rect.top,
                );
            } else if (this.pinchMode === 'twist') {
                this.rig.orbit(angleDelta, 0);
            } else if (this.pinchMode === 'tilt') {
                this.rig.orbit(0, (pinch.midY - this.pinchLast.midY) * ORBIT_PITCH_PER_PX);
            }
            this.pinchLast = pinch;
        }
    }

    private onTouchEnd(e: PointerEvent): void {
        this.touches.delete(e.pointerId);
        if (this.touches.size < 2) {
            this.pinchLast = null;
            this.pinchStart = null;
            this.pinchMode = 'idle';
        }
        if (this.touches.size === 1) {
            // hand the pan over to the remaining finger
            const [rest] = this.touches.values();
            this.touchDown = { x: rest!.x, y: rest!.y };
            this.touchPanGround = this.pickAt(rest!.x, rest!.y);
            this.touchPanActive = false;
        } else if (this.touches.size === 0) {
            this.touchDown = null;
            this.touchPanGround = null;
            this.touchPanActive = false;
        }
    }

    private pinchState(): { dist: number; midX: number; midY: number; angle: number } | null {
        if (this.touches.size < 2) return null;
        const [a, b] = [...this.touches.values()];
        return {
            dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
            midX: (a!.x + b!.x) / 2,
            midY: (a!.y + b!.y) / 2,
            angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
        };
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
        return this.pickAt(e.clientX, e.clientY);
    }

    private pickAt(clientX: number, clientY: number): Vector3 | null {
        const rect = this.surface.getBoundingClientRect();
        return this.rig.screenToGround(
            clientX - rect.left,
            clientY - rect.top,
            rect.width,
            rect.height,
        );
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
    }
}
