import {
    AmbientLight,
    Box3,
    DirectionalLight,
    Group,
    HemisphereLight,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
} from 'three';
import { cloneUnitModel, hasUnitModel } from '../game/unitModels';
import { THEME } from '../theme';

export interface ShowcaseViewer {
    show(unitId: string, meshScale?: number): void;
    dispose(): void;
}

/**
 * One persistent WebGL canvas — swap models with show().
 * Uses cloneUnitModel + theme lights (same look as in-game).
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

    const size = new Vector3();
    const center = new Vector3();
    const box = new Box3();
    let current: Group | null = null;
    let disposed = false;
    let raf = 0;
    let yaw = 0;

    function layout(): void {
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (!current) return;

        current.updateMatrixWorld(true);
        box.setFromObject(current);
        box.getSize(size);
        box.getCenter(center);
        const radius = Math.max(size.x, size.y, size.z) * 0.55 || 2;
        camera.position.set(center.x + radius * 1.55, center.y + radius * 0.5, center.z + radius * 1.85);
        camera.lookAt(center.x, center.y + size.y * 0.08, center.z);
    }

    function tick(): void {
        if (disposed) return;
        if (current) {
            yaw += 0.008;
            current.rotation.y = yaw;
        }
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
    }

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
            yaw = 0;
            next.rotation.y = 0;
            current = next;
            scene.add(current);
            layout();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
            if (current) scene.remove(current);
            current = null;
            renderer.dispose();
            scene.clear();
        },
    };
}
