/**
 * Planar reflection for the lake surface (ultra scenery only).
 *
 * The world is drawn once more from a camera mirrored in the water plane, into
 * a half-resolution render target, and the water shader samples that image by
 * projective coordinates. The mirrored render therefore carries everything the
 * ordinary render does — sky dome, clouds, mountains, trees, the board — with
 * no special casing.
 *
 * The mirrored-camera and oblique-clip maths is three's own `Reflector`
 * (examples/jsm/objects/Reflector.js), fixed to a horizontal plane. It is not
 * used as a mesh because the water is one shared material with its own ice and
 * ripple shader, and because this needs to run only when a lake is on screen.
 *
 * Render-only: nothing here reads or writes the sim.
 */
import {
    Frustum,
    HalfFloatType,
    Matrix4,
    PerspectiveCamera,
    Plane,
    Vector3,
    Vector4,
    WebGLRenderTarget,
    type Box3,
    type Object3D,
    type Scene,
    type WebGLRenderer,
} from 'three';

/** reflection buffer size as a fraction of the drawing buffer */
const RESOLUTION = 0.5;
/** render the mirrored view every Nth frame (the image is reused in between) */
const EVERY_NTH_FRAME = 2;
/** clip bias, as in three's Reflector — keeps the waterline from z-fighting */
const CLIP_BIAS = 0.003;

export interface WaterReflectionUniforms {
    uReflTex: { value: WebGLRenderTarget['texture'] };
    /** world position → projective texture coordinates of the mirrored view */
    uReflMatrix: { value: Matrix4 };
    /** 0 until the first mirrored render exists */
    uReflOn: { value: number };
}

export class WaterReflection {
    readonly uniforms: WaterReflectionUniforms;

    private readonly target: WebGLRenderTarget;
    private readonly camera: PerspectiveCamera;
    private readonly frustum = new Frustum();
    private readonly viewProj = new Matrix4();
    private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
    private readonly clip = new Vector4();
    private readonly q = new Vector4();
    private readonly camPos = new Vector3();
    private readonly look = new Vector3();
    private readonly rotation = new Matrix4();
    private frame = 0;
    private valid = false;
    private enabled = true;

    constructor(
        /** world height of the water plane */
        private readonly waterY: number,
    ) {
        this.target = new WebGLRenderTarget(4, 4, { type: HalfFloatType, samples: 0 });
        // Its own camera: the projection matrix is copied from the real one and
        // rewritten (oblique clip) every time, so its own fov/aspect never matter.
        this.camera = new PerspectiveCamera();
        this.plane.set(new Vector3(0, 1, 0), -waterY);
        this.uniforms = {
            uReflTex: { value: this.target.texture },
            uReflMatrix: { value: new Matrix4() },
            uReflOn: { value: 0 },
        };
    }

    /** true when `camera` currently sees any of the given boxes */
    static anyVisible(camera: PerspectiveCamera, boxes: readonly Box3[], frustum: Frustum, m: Matrix4): boolean {
        m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(m);
        for (const box of boxes) if (frustum.intersectsBox(box)) return true;
        return false;
    }

    /**
     * Draw the mirrored view if a lake is on screen (and it is this frame's
     * turn). `hide` are objects left out of the picture — the water itself.
     * Call before the frame's own render.
     */
    update(
        renderer: WebGLRenderer,
        scene: Scene,
        camera: PerspectiveCamera,
        lakeBoxes: readonly Box3[],
        hide: readonly Object3D[],
    ): void {
        if (!this.enabled || lakeBoxes.length === 0) return;
        camera.updateMatrixWorld();
        if (!WaterReflection.anyVisible(camera, lakeBoxes, this.frustum, this.viewProj)) {
            // nothing to show: keep the last picture, spend nothing
            this.frame = 0;
            return;
        }
        // a lake just came into view (or none was drawn yet) → draw right away
        const due = !this.valid || this.frame % EVERY_NTH_FRAME === 0;
        this.frame++;
        if (!due) return;

        this.sizeTo(renderer);
        this.aim(camera);

        const restoreVisible = hide.map((o) => o.visible);
        for (const o of hide) o.visible = false;

        const prevTarget = renderer.getRenderTarget();
        const prevShadowAuto = renderer.shadowMap.autoUpdate;
        const prevXr = renderer.xr.enabled;
        try {
            renderer.xr.enabled = false;
            renderer.shadowMap.autoUpdate = false; // reuse the shadow map, don't redraw it
            renderer.setRenderTarget(this.target);
            renderer.state.buffers.depth.setMask(true);
            if (renderer.autoClear === false) renderer.clear();
            renderer.render(scene, this.camera);
        } finally {
            // whatever happened, the frame's own render must find the renderer as it was
            renderer.setRenderTarget(prevTarget);
            renderer.shadowMap.autoUpdate = prevShadowAuto;
            renderer.xr.enabled = prevXr;
            hide.forEach((o, i) => (o.visible = restoreVisible[i]!));
        }
        this.valid = true;
        this.uniforms.uReflOn.value = 1;
    }

    /** off = no mirrored render at all and the water shows its plain look */
    setEnabled(on: boolean): void {
        this.enabled = on;
        if (!on) {
            this.uniforms.uReflOn.value = 0;
            this.valid = false;
            this.frame = 0;
        }
    }

    dispose(): void {
        this.target.dispose();
    }

    private sizeTo(renderer: WebGLRenderer): void {
        const w = Math.max(64, Math.round(renderer.domElement.width * RESOLUTION));
        const h = Math.max(64, Math.round(renderer.domElement.height * RESOLUTION));
        if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    }

    /** mirror `camera` in the water plane and fit the oblique clip plane */
    private aim(camera: PerspectiveCamera): void {
        const c = this.camera;
        const wy = this.waterY;
        this.camPos.setFromMatrixPosition(camera.matrixWorld);

        // position and look-at point, mirrored in y about the water plane
        this.rotation.extractRotation(camera.matrixWorld);
        this.look.set(0, 0, -1).applyMatrix4(this.rotation).add(this.camPos);
        c.position.set(this.camPos.x, 2 * wy - this.camPos.y, this.camPos.z);
        const lookY = 2 * wy - this.look.y;
        c.up.set(0, 1, 0).applyMatrix4(this.rotation);
        c.up.y = -c.up.y;
        c.lookAt(this.look.x, lookY, this.look.z);
        c.far = camera.far;
        c.updateMatrixWorld();
        c.projectionMatrix.copy(camera.projectionMatrix);

        // world → projective texture coordinates of this mirrored view
        const tm = this.uniforms.uReflMatrix.value;
        tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        tm.multiply(c.projectionMatrix);
        tm.multiply(c.matrixWorldInverse);

        // oblique near plane (Lengyel): everything below the water is clipped
        const p = this.plane.clone().applyMatrix4(c.matrixWorldInverse);
        this.clip.set(p.normal.x, p.normal.y, p.normal.z, p.constant);
        const proj = c.projectionMatrix.elements;
        this.q.x = (Math.sign(this.clip.x) + proj[8]!) / proj[0]!;
        this.q.y = (Math.sign(this.clip.y) + proj[9]!) / proj[5]!;
        this.q.z = -1;
        this.q.w = (1 + proj[10]!) / proj[14]!;
        this.clip.multiplyScalar(2 / this.clip.dot(this.q));
        proj[2] = this.clip.x;
        proj[6] = this.clip.y;
        proj[10] = this.clip.z + 1 - CLIP_BIAS;
        proj[14] = this.clip.w;
    }
}
