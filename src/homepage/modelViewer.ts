import {
    AmbientLight,
    Box3,
    DirectionalLight,
    Group,
    HemisphereLight,
    MathUtils,
    PerspectiveCamera,
    Scene,
    Spherical,
    Vector3,
    WebGLRenderer,
} from 'three';
import { cloneUnitModel, hasUnitModel } from '../game/unitModels';
import { THEME } from '../theme';

export interface ShowcaseViewer {
    show(unitId: string, meshScale?: number): void;
    dispose(): void;
}

const DEFAULT_POLAR = 1.3; // ~74.5°, a touch above eye level — matches the old fixed camera look
const MIN_POLAR = 0.47; // ~27°, stops short of a flipped top-down view
const MAX_POLAR = 2.67; // ~153°, stops short of a flipped bottom-up view
const DRAG_YAW_SPEED = 0.012; // radians per pixel
const DRAG_PITCH_SPEED = 0.012; // radians per pixel
const AUTO_ROTATE_SPEED = 0.008; // radians per frame
const AUTO_RESUME_MS = 2400;
const MIN_ZOOM = 0.55; // closer
const MAX_ZOOM = 2.5; // further
const ZOOM_SPEED = 0.0015;
const FIT_PADDING = 1.2; // headroom so the model doesn't touch the canvas edge

/**
 * One persistent WebGL canvas — swap models with show().
 * Uses cloneUnitModel + theme lights (same look as in-game).
 * The camera orbits a static model (drag to rotate, wheel to zoom); distance
 * is derived from the model's real bounding sphere so oversized meshes still
 * fit the frame instead of overflowing it.
 */
export function createShowcaseViewer(canvas: HTMLCanvasElement): ShowcaseViewer {
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.1, 200);
    const hemi = new HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiIntensity);
    const sun = new DirectionalLight(THEME.sun, THEME.sunIntensity);
    sun.position.set(40, 80, 30);
    scene.add(hemi, sun, new AmbientLight(0xffffff, 0.22));

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const boxSize = new Vector3();
    const target = new Vector3();
    const box = new Box3();
    const offset = new Vector3();
    const spherical = new Spherical(1, DEFAULT_POLAR, 0);

    let current: Group | null = null;
    let disposed = false;
    let raf = 0;
    let baseDistance = 4;
    let zoom = 1;
    let autoRotate = true;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let resumeTimer = 0;

    /** Recomputes target/baseDistance from the model's true bounding sphere so it always fits the frustum. */
    function fitToModel(): void {
        if (!current) return;
        current.updateMatrixWorld(true);
        box.setFromObject(current);
        box.getSize(boxSize);
        box.getCenter(target);
        const sphereRadius = boxSize.length() * 0.5 || 1;
        const vFov = MathUtils.degToRad(camera.fov * 0.5);
        const hFov = Math.atan(Math.tan(vFov) * Math.max(camera.aspect, 0.0001));
        const limitingHalfFov = Math.min(vFov, hFov);
        baseDistance = (sphereRadius / Math.sin(limitingHalfFov)) * FIT_PADDING;
        target.y += boxSize.y * 0.08;
    }

    function updateCamera(): void {
        spherical.radius = Math.max(baseDistance * zoom, 0.1);
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
    }

    function layout(): void {
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        fitToModel();
        updateCamera();
    }

    function tick(): void {
        if (disposed) return;
        if (current && autoRotate) {
            spherical.theta += AUTO_ROTATE_SPEED;
            updateCamera();
        }
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
    }

    function pauseAutoRotate(): void {
        autoRotate = false;
        window.clearTimeout(resumeTimer);
    }

    function scheduleAutoRotateResume(): void {
        window.clearTimeout(resumeTimer);
        resumeTimer = window.setTimeout(() => {
            autoRotate = true;
        }, AUTO_RESUME_MS);
    }

    function onPointerDown(e: PointerEvent): void {
        if (!current) return;
        dragging = true;
        pauseAutoRotate();
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('dragging');
    }

    function onPointerMove(e: PointerEvent): void {
        if (!dragging || !current) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        spherical.theta -= dx * DRAG_YAW_SPEED;
        spherical.phi = MathUtils.clamp(spherical.phi - dy * DRAG_PITCH_SPEED, MIN_POLAR, MAX_POLAR);
        updateCamera();
    }

    function endDrag(e: PointerEvent): void {
        if (!dragging) return;
        dragging = false;
        canvas.classList.remove('dragging');
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        scheduleAutoRotateResume();
    }

    function onWheel(e: WheelEvent): void {
        if (!current) return;
        e.preventDefault();
        zoom = MathUtils.clamp(zoom * (1 + e.deltaY * ZOOM_SPEED), MIN_ZOOM, MAX_ZOOM);
        updateCamera();
    }

    canvas.classList.add('mh-draggable');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    layout();
    tick();

    return {
        show(unitId: string, meshScale = 1) {
            if (disposed || !hasUnitModel(unitId)) return;
            const next = cloneUnitModel(unitId, 'player');
            if (!next) return;
            if (current) {
                scene.remove(current);
                current = null;
            }
            next.scale.setScalar(meshScale);
            spherical.theta = 0;
            spherical.phi = DEFAULT_POLAR;
            zoom = 1;
            autoRotate = true;
            current = next;
            scene.add(current);
            layout();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(raf);
            window.clearTimeout(resumeTimer);
            window.removeEventListener('resize', onResize);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', endDrag);
            canvas.removeEventListener('pointercancel', endDrag);
            canvas.removeEventListener('wheel', onWheel);
            if (current) scene.remove(current);
            current = null;
            renderer.dispose();
            scene.clear();
        },
    };
}
