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
import { cloneUnitModel, getUnitVisualHeight, hasUnitModel } from '../game/unitModels';
import {
    attachCrowShowcaseWingFlap,
    attachDragonWingFlap,
    CROW_RIDER_MODEL_ID,
    updateCrowWingFlap,
} from '../game/crowWingFlap';
import {
    cloneAnimatedModel,
    hasAnimatedModel,
    lockAnimatedWalk,
    updateAnimatedUnits,
} from '../game/unitAnimated';
import {
    ensureSpellTemplate,
    type SpellAssetId,
} from '../game/spellAssets';
import { cloneSpellInstance } from '../game/spellMeshes';
import { THEME } from '../theme';

export interface ShowcaseViewer {
    show(unitId: string, meshScale?: number): void;
    showSpell(spellId: SpellAssetId): Promise<void>;
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
/** Spell previews sit this much closer than units → read ~2× larger. */
const SPELL_SHOWCASE_SIZE_MULT = 2;
/**
 * Shared showcase "stage" — frame as if looking at a mid-army unit (Archer).
 * Smaller meshScales (Black Brood vs Webweaver vs Black Spider) read smaller
 * in the canvas; anything bigger than the stage still pulls the camera out to fit.
 */
const STAGE_REF_MODEL = 'archer';
const STAGE_REF_MESH_SCALE = 2.2;

/** Spell GLBs use different rest forwards than army units (−Z). */
function spellShowcaseYaw(id: SpellAssetId): number {
    // Dragon is baked to −Z forward (see spellAssets) — same flip as units.
    if (id === 'dragon') return Math.PI;
    if (id === 'hammer') return 0;
    return -Math.PI / 2;
}

/**
 * One persistent WebGL canvas — swap models with show() / showSpell().
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
    let wingFlapActive = false;
    let animActive = false;
    let lastTickMs = performance.now();
    /** Ignores stale spell loads if the user clicked another pick mid-fetch. */
    let spellLoadGen = 0;
    let framingIsSpell = false;

    /** Frame against a fixed mid-army stage so meshScale differences stay visible. */
    function fitToModel(): void {
        if (!current) return;
        current.updateMatrixWorld(true);
        box.setFromObject(current);
        box.getSize(boxSize);
        box.getCenter(target);
        const sphereRadius = boxSize.length() * 0.5 || 1;
        const stageHeight = getUnitVisualHeight(STAGE_REF_MODEL) * STAGE_REF_MESH_SCALE;
        const stageSphere = Math.max(stageHeight * 0.75, 0.5);
        // Under the stage → leave empty space (small units). Over it → sit closer
        // than a perfect fit so bosses like Black Spider feel massive (mild crop OK).
        const framingRadius =
            sphereRadius <= stageSphere ? stageSphere : sphereRadius * 0.68;
        const vFov = MathUtils.degToRad(camera.fov * 0.5);
        const hFov = Math.atan(Math.tan(vFov) * Math.max(camera.aspect, 0.0001));
        const limitingHalfFov = Math.min(vFov, hFov);
        const sizeMult = framingIsSpell ? SPELL_SHOWCASE_SIZE_MULT : 1;
        baseDistance =
            ((framingRadius / Math.sin(limitingHalfFov)) * FIT_PADDING) / sizeMult;
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

    function clearCurrent(): void {
        if (!current) return;
        scene.remove(current);
        current = null;
    }

    function present(
        next: Group,
        opts: { yaw: number; wingFlap: boolean; meshScale?: number; spell?: boolean; anim?: boolean },
    ): void {
        clearCurrent();
        next.scale.setScalar(opts.meshScale ?? 1);
        next.rotation.y = opts.yaw;
        spherical.theta = 0;
        spherical.phi = DEFAULT_POLAR;
        zoom = 1;
        autoRotate = true;
        wingFlapActive = opts.wingFlap;
        animActive = !!opts.anim;
        framingIsSpell = !!opts.spell;
        current = next;
        scene.add(current);
        layout();
    }

    function tick(): void {
        if (disposed) return;
        const now = performance.now();
        const dt = Math.min(0.05, Math.max(0, (now - lastTickMs) * 0.001));
        lastTickMs = now;
        if (wingFlapActive) updateCrowWingFlap(dt);
        if (animActive) updateAnimatedUnits(dt);
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
    // The canvas can be laid out AFTER this runs — created inside a hidden
    // panel, revealed later — in which case the construction-time layout()
    // measured 0×0 and a window resize was the only thing that would ever
    // fix it. Observing the canvas itself covers reveal, container resize and
    // orientation change alike.
    const sizeObserver = new ResizeObserver(() => layout());
    sizeObserver.observe(canvas);
    layout();
    tick();

    return {
        show(unitId: string, meshScale = 1) {
            if (disposed) return;
            spellLoadGen++;
            const flap = unitId === CROW_RIDER_MODEL_ID;
            if (hasAnimatedModel(unitId)) {
                const next = cloneAnimatedModel(unitId, 'player');
                if (!next) return;
                lockAnimatedWalk(next, 1);
                present(next, { yaw: Math.PI, wingFlap: false, meshScale, anim: true });
                return;
            }
            if (!hasUnitModel(unitId)) return;
            const next = cloneUnitModel(unitId, 'player');
            if (!next) return;
            // Game models face −Z; default camera is on +Z — flip so the face shows first.
            if (flap) attachCrowShowcaseWingFlap(next);
            present(next, { yaw: Math.PI, wingFlap: flap, meshScale });
        },
        async showSpell(spellId: SpellAssetId) {
            if (disposed) return;
            const gen = ++spellLoadGen;
            const tpl = await ensureSpellTemplate(spellId);
            if (disposed || gen !== spellLoadGen || !tpl) return;
            const { root } = cloneSpellInstance(tpl);
            const flap = spellId === 'dragon';
            if (flap) attachDragonWingFlap(root);
            present(root, { yaw: spellShowcaseYaw(spellId), wingFlap: flap, spell: true });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            spellLoadGen++;
            cancelAnimationFrame(raf);
            window.clearTimeout(resumeTimer);
            window.removeEventListener('resize', onResize);
            sizeObserver.disconnect();
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', endDrag);
            canvas.removeEventListener('pointercancel', endDrag);
            canvas.removeEventListener('wheel', onWheel);
            clearCurrent();
            renderer.dispose();
            scene.clear();
        },
    };
}
