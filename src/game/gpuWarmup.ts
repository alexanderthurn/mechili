/**
 * Pre-compile WebGL programs that would otherwise hitch on first use mid-match
 * (flame tongues, projectiles, particles, blob shadows, MeshStandard + PointLight).
 *
 * Shader programs are per GL context, so the warmed renderer must be the one
 * Game uses — stash it here and {@link takePrewarmedRenderer} during construction.
 */
import {
    ACESFilmicToneMapping,
    BoxGeometry,
    Color,
    DirectionalLight,
    HemisphereLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PointLight,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from 'three';
import { BlobShadows } from './blobShadows';
import { Particles, ProjectileRenderer } from './effects';
import { FlameRenderer } from './flameRenderer';
import { touchFirstDevice } from './inputCapabilities';
import { effectiveDpr, prefs } from './prefs';
import { THEME } from '../theme';

let prewarmed: WebGLRenderer | null = null;

/** Hand the boot-warmed renderer to Game (once). Null if none / already taken. */
export function takePrewarmedRenderer(): WebGLRenderer | null {
    const r = prewarmed;
    prewarmed = null;
    return r;
}

/** Drop a stashed renderer (e.g. canvas replaced after return-to-menu). */
export function discardPrewarmedRenderer(): void {
    if (!prewarmed) return;
    prewarmed.dispose();
    prewarmed = null;
}

function createMatchRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
    const renderer = new WebGLRenderer({
        canvas,
        antialias: prefs().antialias,
        powerPreference: touchFirstDevice() ? 'low-power' : 'default',
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = touchFirstDevice() ? 1.0 : 1.08;
    renderer.setPixelRatio(effectiveDpr());
    const w = Math.max(4, canvas.clientWidth || 4);
    const h = Math.max(4, canvas.clientHeight || 4);
    renderer.setSize(w, h, false);
    return renderer;
}

/**
 * Build a tiny stand-in scene, force cold draw paths, compile, then dispose the
 * stand-ins — keeping the renderer (and its compiled programs) for Game.
 */
export async function prewarmGpu(
    canvas: HTMLCanvasElement,
    onProgress?: (label: string) => void,
): Promise<void> {
    discardPrewarmedRenderer();
    onProgress?.('Warming graphics…');

    // Let the loader paint the new label before we block on compile.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const renderer = createMatchRenderer(canvas);
    const scene = new Scene();
    scene.background = new Color(THEME.sky);

    const hemi = new HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiIntensity);
    scene.add(hemi);
    const sun = new DirectionalLight(THEME.sun, THEME.sunIntensity);
    sun.position.set(40, 60, 20);
    scene.add(sun);

    // Keep a point light in the light list so MeshStandard variants that include
    // NUM_POINT_LIGHTS compile now — same hitch as the first mid-battle blaze.
    const fireLight = new PointLight(0xff7a28, 120, 46, 1.6);
    fireLight.position.set(0, 3, 0);
    scene.add(fireLight);

    const probe = new Mesh(
        new BoxGeometry(2, 2, 2),
        new MeshStandardMaterial({ color: 0x886644, roughness: 0.8, metalness: 0.1 }),
    );
    probe.position.set(0, 1, 0);
    probe.castShadow = true;
    probe.receiveShadow = true;
    scene.add(probe);

    const particles = new Particles(scene);
    particles.burst(0, 1, 0, { count: 8, color: 0xff6a18, speed: 2, life: 0.5, up: 4 });
    particles.burst(0, 1, 0, {
        count: 8,
        color: 0x2c2824,
        speed: 1,
        life: 0.5,
        up: 2,
        blood: true,
    });
    particles.update(1 / 60);

    const flames = new FlameRenderer(scene);
    const fireQ = prefs().fireVfx;
    flames.setQuality(fireQ === 'off' || fireQ === 'low' ? 'medium' : fireQ);
    flames.primeForCompile();

    const projectiles = new ProjectileRenderer(scene);
    projectiles.primeForCompile();

    const blobs = new BlobShadows(scene);
    blobs.setEnabled(true);
    blobs.sync([{ x: 0, z: 0, radius: 1.5 }]);

    const camera = new PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(12, 18, 16);
    camera.lookAt(0, 0, 0);

    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);

    flames.dispose();
    blobs.dispose();
    projectiles.dispose();
    // Particles has no dispose — drop with the scene graph
    scene.clear();
    probe.geometry.dispose();
    (probe.material as MeshStandardMaterial).dispose();

    prewarmed = renderer;
    onProgress?.('Ready');
}
