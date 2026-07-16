import {
    Box3,
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    PMREMGenerator,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderTarget,
    type Texture,
    type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEME } from '../theme';
import { UNIT_TYPES, buildUnitPreviewMesh, type UnitType } from '../game/units';
import { cloneUnitModel } from '../game/unitModels';

const ICON_SIZE = 128;
/** bright plate behind each thumbnail so dark hulls stay readable on HUD tiles */
const ICON_BG = THEME.light;

function disposePreview(root: ReturnType<typeof buildUnitPreviewMesh>): void {
    root.traverse((obj) => {
        if (obj instanceof Mesh) obj.geometry.dispose();
    });
}

/** Renders a single unit type's mesh into a PNG data URL (opaque bright background). */
function renderUnitIcon(renderer: WebGLRenderer, type: UnitType, envMap: Texture): string {
    const scene = new Scene();
    scene.background = new Color(ICON_BG);
    scene.environment = envMap;
    scene.environmentIntensity = 0.55;

    scene.add(new HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiIntensity * 1.1));
    const key = new DirectionalLight(THEME.sun, THEME.sunIntensity);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new DirectionalLight(THEME.hemiSky, 0.45);
    fill.position.set(-2, 2, -3);
    scene.add(fill);

    const glb = cloneUnitModel(type.id, 'player');
    const mesh = glb ?? buildUnitPreviewMesh(type, 'player');
    if (!glb) mesh.scale.multiplyScalar(2);
    scene.add(mesh);

    const box = new Box3().setFromObject(mesh);
    const center = box.getCenter(new Vector3());
    mesh.position.sub(center);

    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const camera = new PerspectiveCamera(32, 1, 0.05, 500);
    const dist = (maxDim / Math.tan((camera.fov * Math.PI) / 360)) * 0.45;
    camera.position.set(dist * 0.75, dist * 0.5, dist * 0.95);
    camera.lookAt(0, maxDim * 0.08, 0);

    const target = new WebGLRenderTarget(ICON_SIZE, ICON_SIZE);
    const oldTarget = renderer.getRenderTarget();
    const oldClear = renderer.getClearColor(new Color());
    const oldAlpha = renderer.getClearAlpha();

    renderer.setClearColor(ICON_BG, 1);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    const pixels = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, ICON_SIZE, ICON_SIZE, pixels);

    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClear, oldAlpha);
    target.dispose();
    disposePreview(mesh);

    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(ICON_SIZE, ICON_SIZE);
    for (let y = 0; y < ICON_SIZE; y++) {
        for (let x = 0; x < ICON_SIZE; x++) {
            const src = ((ICON_SIZE - 1 - y) * ICON_SIZE + x) * 4;
            const dst = (y * ICON_SIZE + x) * 4;
            imageData.data[dst] = pixels[src]!;
            imageData.data[dst + 1] = pixels[src + 1]!;
            imageData.data[dst + 2] = pixels[src + 2]!;
            imageData.data[dst + 3] = pixels[src + 3]!;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

/** One thumbnail per buyable unit type, keyed by id. */
export function renderAllUnitIcons(renderer: WebGLRenderer): Map<string, string> {
    // PBR environment: metallic models need something to reflect (mirrors game.ts).
    // Generated once and shared across all icon renders.
    const pmrem = new PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const icons = new Map<string, string>();
    for (const type of UNIT_TYPES) icons.set(type.id, renderUnitIcon(renderer, type, envMap));

    envMap.dispose();
    return icons;
}
