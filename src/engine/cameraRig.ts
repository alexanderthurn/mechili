import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

interface RigState {
    x: number;
    z: number;
    zoom: number;
    heading: number;
    pitch: number;
}

/**
 * RTS camera rig around a real three.js PerspectiveCamera. The camera orbits
 * a target point on the y=0 ground plane, described by:
 *  - pan (target x/z, clamped to the map bounds)
 *  - zoom (orbit distance; a straight dolly, it never changes the angle)
 *  - heading (rotation around the target; 0 looks toward -z, the enemy edge)
 *  - pitch (tilt from horizontal, freely controlled by orbiting)
 *
 * All input mutates a *desired* state; `update()` eases the live state toward
 * it every frame, so pans, zooms and rotations glide instead of snapping.
 */
export class CameraRig {
    readonly camera = new PerspectiveCamera(50, 1, 1, 1100);
    readonly minZoom = 18;
    /** derived from the map dimensions via {@link fitMap} */
    maxZoom = 280;
    readonly minPitch = (20 * Math.PI) / 180;
    readonly maxPitch = (85 * Math.PI) / 180;
    readonly defaultPitch = (55 * Math.PI) / 180;

    private readonly desired: RigState = { x: 0, z: 24, zoom: 75, heading: 0, pitch: this.defaultPitch };
    private readonly state: RigState = { ...this.desired };
    private boundsHalfW = Infinity;
    private boundsHalfH = Infinity;

    private readonly raycaster = new Raycaster();
    private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    private readonly ndc = new Vector2();
    private readonly hit = new Vector3();
    private viewW = 1;
    private viewH = 1;

    constructor() {
        this.applyState(this.state);
    }

    get target(): Vector3 {
        return new Vector3(this.state.x, 0, this.state.z);
    }

    get zoom(): number {
        return this.state.zoom;
    }

    get heading(): number {
        return this.state.heading;
    }

    get pitch(): number {
        return this.state.pitch;
    }

    /** ground-plane forward direction (x, z) for heading-relative movement */
    get groundForward(): { x: number; z: number } {
        return { x: -Math.sin(this.state.heading), z: -Math.cos(this.state.heading) };
    }

    /** ground-plane right direction (x, z) for heading-relative movement */
    get groundRight(): { x: number; z: number } {
        return { x: Math.cos(this.state.heading), z: -Math.sin(this.state.heading) };
    }

    setBounds(halfW: number, halfH: number): void {
        this.boundsHalfW = halfW;
        this.boundsHalfH = halfH;
        this.clampDesired();
    }

    /** allows zooming out just far enough to frame a map of the given size */
    fitMap(width: number, height: number): void {
        this.maxZoom = Math.max(120, width * 0.95, height * 1.1);
        // keep the far plane and fog-friendly range beyond the widest view
        this.camera.far = this.maxZoom * 4;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Pans the desired target. `immediate` also moves the live state — used by
     * drag panning, where easing would make the grabbed point drift.
     */
    pan(dx: number, dz: number, immediate = false): void {
        this.desired.x += dx;
        this.desired.z += dz;
        this.clampDesired();
        if (immediate) {
            this.state.x = this.desired.x;
            this.state.z = this.desired.z;
            this.applyState(this.state);
        }
    }

    /** Zooms by a factor while keeping the ground point under the cursor fixed. */
    zoomAt(factor: number, screenX: number, screenY: number): void {
        const before = this.screenToGround(screenX, screenY, this.viewW, this.viewH);
        this.desired.zoom = MathUtils.clamp(this.desired.zoom * factor, this.minZoom, this.maxZoom);
        if (before) {
            // measure where that point lands once the desired state settles, and pan to compensate
            this.applyState(this.desired);
            const after = this.screenToGround(screenX, screenY, this.viewW, this.viewH);
            this.applyState(this.state);
            if (after) this.pan(before.x - after.x, before.z - after.z);
        }
    }

    rotate(deltaHeading: number): void {
        this.desired.heading += deltaHeading;
    }

    /** Orbits around the target: heading left/right, pitch forward/backward. */
    orbit(deltaHeading: number, deltaPitch: number): void {
        this.desired.heading += deltaHeading;
        this.desired.pitch = MathUtils.clamp(this.desired.pitch + deltaPitch, this.minPitch, this.maxPitch);
    }

    resetView(): void {
        // unwind full turns so the reset takes the short way around
        this.desired.heading = this.desired.heading - Math.round(this.desired.heading / (Math.PI * 2)) * Math.PI * 2;
        this.desired.heading = 0;
        this.desired.zoom = 75;
        this.desired.pitch = this.defaultPitch;
    }

    resize(width: number, height: number): void {
        this.viewW = Math.max(1, width);
        this.viewH = Math.max(1, height);
        this.camera.aspect = this.viewW / this.viewH;
        this.camera.updateProjectionMatrix();
    }

    /** Higher = snappier response, lower = floatier glide. */
    sharpness = 25;

    /** Eases the live state toward the desired state. Call once per frame. */
    update(dtSeconds: number): void {
        const s = this.state;
        const d = this.desired;
        const k = 1 - Math.exp(-dtSeconds * this.sharpness);
        s.x += (d.x - s.x) * k;
        s.z += (d.z - s.z) * k;
        s.zoom += (d.zoom - s.zoom) * k;
        s.heading += (d.heading - s.heading) * k;
        s.pitch += (d.pitch - s.pitch) * k;
        this.applyState(s);
    }

    /** Intersects the pick ray through a screen point with the y=0 ground plane. */
    screenToGround(screenX: number, screenY: number, viewW: number, viewH: number): Vector3 | null {
        this.ndc.set((screenX / viewW) * 2 - 1, 1 - (screenY / viewH) * 2);
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(this.ndc, this.camera);
        const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.hit);
        return hit ? hit.clone() : null;
    }

    /** Projects a world point to canvas pixel coordinates (null when behind the camera). */
    worldToScreen(worldX: number, worldY: number, worldZ: number, viewW: number, viewH: number): { x: number; y: number } | null {
        this.camera.updateMatrixWorld();
        this.hit.set(worldX, worldY, worldZ).project(this.camera);
        if (this.hit.z > 1) return null;
        return {
            x: (this.hit.x * 0.5 + 0.5) * viewW,
            y: (1 - (this.hit.y * 0.5 + 0.5)) * viewH,
        };
    }

    private clampDesired(): void {
        this.desired.x = MathUtils.clamp(this.desired.x, -this.boundsHalfW, this.boundsHalfW);
        this.desired.z = MathUtils.clamp(this.desired.z, -this.boundsHalfH, this.boundsHalfH);
    }

    private applyState(s: RigState): void {
        const horizontal = Math.cos(s.pitch) * s.zoom;
        this.camera.position.set(
            s.x + Math.sin(s.heading) * horizontal,
            Math.sin(s.pitch) * s.zoom,
            s.z + Math.cos(s.heading) * horizontal,
        );
        this.camera.lookAt(s.x, 0, s.z);
    }
}
