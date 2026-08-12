import {
    Box3,
    Color,
    DirectionalLight,
    HemisphereLight,
    MathUtils,
    Mesh,
    PMREMGenerator,
    PerspectiveCamera,
    Scene,
    Spherical,
    Vector3,
    WebGLRenderTarget,
    type Texture,
    type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEME } from '../theme';
import { UNIT_TYPES, buildUnitPreviewMesh, type UnitType } from '../game/units';
import { cloneUnitModel } from '../game/unitModels';

/** Final PNG edge length (shop tiles are ~80 CSS px; 256 covers 3× retina). */
const ICON_SIZE = 256;
/** Render larger then downscale for cheap edge AA (offscreen RTs have no MSAA blit). */
const BAKE_SIZE = ICON_SIZE * 2;
/** bright plate behind each thumbnail so dark hulls stay readable on HUD tiles */
const ICON_BG = THEME.light;
/** Margin so the silhouette clears the tile edge + title/cost overlays. */
const FIT_PADDING = 1.12;
/** 3/4 front view: slightly elevated, facing the unit. */
const VIEW_POLAR = 1.22; // ~70° from +Y
const VIEW_AZIMUTH = 0.35; // slight yaw off dead-front
/**
 * How much wider than tall a unit may be before we start cropping extremities.
 * Crow wings / ballista arms inflate the AABB; dwarves are compact — height-first
 * framing keeps body size consistent across both.
 */
const MAX_XZ_TO_HEIGHT = 1.0;

function disposePreview(root: ReturnType<typeof buildUnitPreviewMesh>): void {
    root.traverse((obj) => {
        if (obj instanceof Mesh) obj.geometry.dispose();
    });
}

/** Place camera so `radius` fits the square frame. */
function frameUnitCamera(camera: PerspectiveCamera, radius: number, lookAt: Vector3): void {
    const halfFov = MathUtils.degToRad(camera.fov * 0.5);
    const dist = (Math.max(radius, 0.01) / Math.sin(halfFov)) * FIT_PADDING;
    const offset = new Vector3().setFromSpherical(new Spherical(dist, VIEW_POLAR, VIEW_AZIMUTH));
    camera.position.copy(lookAt).add(offset);
    camera.near = Math.max(dist / 100, 0.01);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(lookAt);
}

/** Height-biased radius: wide appendages may clip a little instead of shrinking the body. */
function portraitRadius(size: Vector3): number {
    const h = Math.max(size.y, 0.01);
    const xz = Math.max(size.x, size.z, 0.01);
    const extent = Math.max(h, Math.min(xz, h * MAX_XZ_TO_HEIGHT));
    return extent * 0.5;
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

    mesh.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mesh);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    mesh.position.sub(center);
    mesh.updateMatrixWorld(true);

    // Height-first fit (not full AABB diagonal) so winged/mounted units don't look tiny.
    const radius = portraitRadius(size);
    const camera = new PerspectiveCamera(32, 1, 0.05, 500);
    frameUnitCamera(camera, radius, new Vector3(0, 0, 0));

    const bake = new WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE);
    const oldTarget = renderer.getRenderTarget();
    const oldClear = renderer.getClearColor(new Color());
    const oldAlpha = renderer.getClearAlpha();

    renderer.setClearColor(ICON_BG, 1);
    renderer.setRenderTarget(bake);
    renderer.render(scene, camera);

    const pixels = new Uint8Array(BAKE_SIZE * BAKE_SIZE * 4);
    renderer.readRenderTargetPixels(bake, 0, 0, BAKE_SIZE, BAKE_SIZE, pixels);

    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClear, oldAlpha);
    bake.dispose();
    disposePreview(mesh);

    // Flip Y (GL → canvas) into a hi-res canvas, then downscale for AA.
    const hi = document.createElement('canvas');
    hi.width = BAKE_SIZE;
    hi.height = BAKE_SIZE;
    const hiCtx = hi.getContext('2d')!;
    const imageData = hiCtx.createImageData(BAKE_SIZE, BAKE_SIZE);
    for (let y = 0; y < BAKE_SIZE; y++) {
        for (let x = 0; x < BAKE_SIZE; x++) {
            const src = ((BAKE_SIZE - 1 - y) * BAKE_SIZE + x) * 4;
            const dst = (y * BAKE_SIZE + x) * 4;
            imageData.data[dst] = pixels[src]!;
            imageData.data[dst + 1] = pixels[src + 1]!;
            imageData.data[dst + 2] = pixels[src + 2]!;
            imageData.data[dst + 3] = pixels[src + 3]!;
        }
    }
    hiCtx.putImageData(imageData, 0, 0);

    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hi, 0, 0, ICON_SIZE, ICON_SIZE);
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
