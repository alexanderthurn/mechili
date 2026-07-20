import type { CameraRig } from './cameraRig';

const DEADZONE = 0.18;
const CURSOR_SPEED = 950; // px/s at full stick deflection (quadratic response)
const ORBIT_SPEED = 2.4; // rad/s at full right-stick deflection
const PITCH_SPEED = 1.7;
const ZOOM_SPEED = 1.6; // exp factor/s at full trigger
const HEADING_SPEED = Math.PI / 2; // shoulders, rad/s — matches Q/E
const HIDE_AFTER_MS = 3500;
/** synthetic events carry this id — never a real pointer, cannot be captured */
const FAKE_POINTER_ID = 0x7fff;

/**
 * Console-RTS style virtual cursor for gamepads (Halo Wars pattern).
 *
 * The left stick moves a crosshair; A "clicks" wherever it points. Over HUD
 * elements that is a plain DOM click; over the battlefield a synthetic
 * PointerEvent (pointerType 'gamepad') is dispatched on the input surface, so
 * the whole existing camera/placement/tactic pipeline handles it exactly like
 * a mouse click — including ghost previews, which follow the synthetic
 * pointermove stream. Right stick orbits, triggers zoom toward the cursor,
 * LB/RB turn the right stick into camera pan, B cancels, X rotates,
 * Start opens the menu.
 */
export class GamepadCursor {
    onCancel: (() => void) | null = null;
    onRotate: (() => void) | null = null;
    onMenu: (() => void) | null = null;
    /** real stick/button activity (drives the live input-mode switch) */
    onActivity: (() => void) | null = null;

    private readonly el: HTMLDivElement;
    private x = 0;
    private y = 0;
    private visible = false;
    private lastActivity = 0;
    private prev: boolean[] = [];

    constructor(
        private readonly surface: HTMLElement,
        private readonly rig: CameraRig,
    ) {
        this.el = document.createElement('div');
        this.el.className = 'mechili-gpcursor';
        (surface.parentElement ?? document.body).appendChild(this.el);
    }

    update(dtSeconds: number): void {
        const pads = navigator.getGamepads?.() ?? [];
        let pad: Gamepad | null = null;
        for (const p of pads) {
            if (p?.connected) {
                pad = p;
                break;
            }
        }
        if (!pad) {
            if (this.visible) this.hide();
            return;
        }

        const dz = (v: number | undefined) => {
            const n = v ?? 0;
            return Math.abs(n) < DEADZONE ? 0 : n;
        };
        const lx = dz(pad.axes[0]);
        const ly = dz(pad.axes[1]);
        const rx = dz(pad.axes[2]);
        const ry = dz(pad.axes[3]);
        const lt = pad.buttons[6]?.value ?? 0;
        const rt = pad.buttons[7]?.value ?? 0;
        const pressed = pad.buttons.map((b) => b.pressed);

        const active =
            lx !== 0 ||
            ly !== 0 ||
            rx !== 0 ||
            ry !== 0 ||
            lt > 0.05 ||
            rt > 0.05 ||
            pressed.some(Boolean);
        const now = performance.now();
        if (active) {
            this.lastActivity = now;
            this.onActivity?.();
            if (!this.visible) this.show();
        } else if (this.visible && now - this.lastActivity > HIDE_AFTER_MS) {
            this.hide();
        }
        if (!this.visible) {
            this.prev = pressed;
            return;
        }

        const rect = this.surface.getBoundingClientRect();
        // quadratic response: precise when nudged, fast when slammed
        const nx = this.x + lx * Math.abs(lx) * CURSOR_SPEED * dtSeconds;
        const ny = this.y + ly * Math.abs(ly) * CURSOR_SPEED * dtSeconds;
        const cx = Math.min(Math.max(nx, 0), rect.width);
        const cy = Math.min(Math.max(ny, 0), rect.height);
        if (cx !== this.x || cy !== this.y) {
            this.x = cx;
            this.y = cy;
            this.el.style.left = `${cx}px`;
            this.el.style.top = `${cy}px`;
            // ghost/tactic previews track this exactly like a mouse hover
            this.surface.dispatchEvent(this.pointerEvent('pointermove', rect, 0));
        }

        const lb = pressed[4] === true;
        const rb = pressed[5] === true;
        // Gamepad stick "up" is usually -Y, but we want intuitive camera control:
        // stick up should move the view in the opposite direction of stick down.
        const invRy = -ry;
        if (rx !== 0 || ry !== 0) {
            if (lb || rb) {
                // pan is heading-relative (like keyboard WASD/edge scroll)
                const dx = rx;
                const dz = invRy;
                const len = Math.hypot(dx, dz);
                if (len > 0) {
                    const speed = this.rig.zoom * 0.9 * dtSeconds;
                    const invLen = 1 / len;
                    const fwd = this.rig.groundForward;
                    const right = this.rig.groundRight;
                    this.rig.pan(
                        (right.x * dx + fwd.x * dz) * speed * invLen,
                        (right.z * dx + fwd.z * dz) * speed * invLen,
                    );
                }
            } else {
                // orbit: heading left/right, pitch forward/backward
                this.rig.orbit(-rx * ORBIT_SPEED * dtSeconds, invRy * PITCH_SPEED * dtSeconds);
            }
        }
        if (lt > 0.02 || rt > 0.02) {
            this.rig.zoomAt(Math.exp((lt - rt) * ZOOM_SPEED * dtSeconds), this.x, this.y);
        }

        const edge = (i: number) => pressed[i] === true && this.prev[i] !== true;
        if (edge(0)) this.press(rect); // A: click at the cursor
        if (edge(1)) this.onCancel?.(); // B
        if (edge(2)) this.onRotate?.(); // X
        if (edge(9)) this.onMenu?.(); // Start
        if (edge(8)) this.rig.resetView(); // Select/Back
        this.prev = pressed;
    }

    private press(rect: DOMRect): void {
        const target = document.elementFromPoint(rect.left + this.x, rect.top + this.y);
        // HUD chrome: an ordinary DOM click on the button under the crosshair
        if (target && target !== this.surface && !(target instanceof HTMLCanvasElement)) {
            const clickable = target.closest<HTMLElement>(
                'button, a, input, select, [data-act]',
            );
            (clickable ?? (target as HTMLElement)).click();
            return;
        }
        // battlefield: run the normal pointer pipeline
        this.surface.dispatchEvent(this.pointerEvent('pointerdown', rect, 1));
        this.surface.dispatchEvent(this.pointerEvent('pointerup', rect, 0));
    }

    private pointerEvent(type: string, rect: DOMRect, buttons: number): PointerEvent {
        return new PointerEvent(type, {
            bubbles: true,
            clientX: rect.left + this.x,
            clientY: rect.top + this.y,
            button: 0,
            buttons,
            pointerId: FAKE_POINTER_ID,
            pointerType: 'gamepad',
            isPrimary: true,
        });
    }

    private show(): void {
        this.visible = true;
        const rect = this.surface.getBoundingClientRect();
        if (this.x === 0 && this.y === 0) {
            this.x = rect.width / 2;
            this.y = rect.height / 2;
            this.el.style.left = `${this.x}px`;
            this.el.style.top = `${this.y}px`;
        }
        this.el.classList.add('visible');
    }

    private hide(): void {
        this.visible = false;
        this.el.classList.remove('visible');
    }

    dispose(): void {
        this.el.remove();
    }
}
