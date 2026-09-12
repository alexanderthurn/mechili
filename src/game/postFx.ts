/**
 * Optional post stack for the match 3D canvas.
 * Off → no composer (direct renderer.render).
 * On → RenderPass → [bloom] → [vignette] → OutputPass
 * so ACES / sRGB stay correct (tone map only on the final blit).
 */
import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import type { BloomQuality, VignetteQuality } from './prefs';

/** Eskil vignette: higher offset → stronger corner falloff. */
const VIGNETTE: Record<Exclude<VignetteQuality, 'off'>, { offset: number; darkness: number }> = {
    high: { offset: 1.18, darkness: 1.02 },
    ultra: { offset: 1.28, darkness: 1.05 },
};

/**
 * Selective bloom — high threshold so grass/sky stay clean; strength/radius
 * lift magic beams / sun / (compensated) fire. Fire tongues pull HDR gain down
 * when bloom is on, so these strengths can stay punchy for wizard rays.
 */
const BLOOM: Record<Exclude<BloomQuality, 'off'>, { threshold: number; strength: number; radius: number }> =
    {
        high: { threshold: 0.8, strength: 0.45, radius: 0.48 },
        ultra: { threshold: 0.74, strength: 0.62, radius: 0.58 },
    };

export class PostFx {
    private composer: EffectComposer | null = null;
    private bloomPass: UnrealBloomPass | null = null;
    private vignettePass: ShaderPass | null = null;
    private vignette: VignetteQuality = 'off';
    private bloom: BloomQuality = 'off';
    private readonly resolution = new Vector2(4, 4);

    constructor(
        private readonly renderer: WebGLRenderer,
        private readonly scene: Scene,
        private readonly camera: Camera,
    ) {}

    get enabled(): boolean {
        return this.composer !== null;
    }

    setEffects(vignette: VignetteQuality, bloom: BloomQuality): void {
        if (vignette === this.vignette && bloom === this.bloom) {
            this.applyParams();
            return;
        }
        const wasOn = this.composer !== null;
        const wantOn = vignette !== 'off' || bloom !== 'off';
        const passSetChanged =
            (this.vignette === 'off') !== (vignette === 'off') ||
            (this.bloom === 'off') !== (bloom === 'off');

        this.vignette = vignette;
        this.bloom = bloom;

        if (!wantOn) {
            this.teardown();
            return;
        }
        if (!wasOn || passSetChanged) {
            this.teardown();
            this.build();
        }
        this.applyParams();
    }

    setSize(width: number, height: number): void {
        if (!this.composer) return;
        this.resolution.set(Math.max(4, width), Math.max(4, height));
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(this.resolution.x, this.resolution.y);
        this.bloomPass?.setSize(this.resolution.x, this.resolution.y);
    }

    render(): void {
        this.composer?.render();
    }

    dispose(): void {
        this.teardown();
    }

    private applyParams(): void {
        if (this.bloom !== 'off' && this.bloomPass) {
            const b = BLOOM[this.bloom];
            this.bloomPass.threshold = b.threshold;
            this.bloomPass.strength = b.strength;
            this.bloomPass.radius = b.radius;
        }
        if (this.vignette !== 'off' && this.vignettePass) {
            const v = VIGNETTE[this.vignette];
            const offset = this.vignettePass.uniforms['offset'];
            const darkness = this.vignettePass.uniforms['darkness'];
            if (offset) offset.value = v.offset;
            if (darkness) darkness.value = v.darkness;
        }
    }

    private build(): void {
        const el = this.renderer.domElement;
        this.resolution.set(Math.max(4, el.clientWidth), Math.max(4, el.clientHeight));

        const composer = new EffectComposer(this.renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));

        if (this.bloom !== 'off') {
            const bloom = new UnrealBloomPass(
                this.resolution.clone(),
                0.5,
                0.4,
                0.85,
            );
            composer.addPass(bloom);
            this.bloomPass = bloom;
        } else {
            this.bloomPass = null;
        }

        if (this.vignette !== 'off') {
            const vignette = new ShaderPass(VignetteShader);
            composer.addPass(vignette);
            this.vignettePass = vignette;
        } else {
            this.vignettePass = null;
        }

        composer.addPass(new OutputPass());
        this.composer = composer;
        this.setSize(this.resolution.x, this.resolution.y);
    }

    private teardown(): void {
        this.composer?.dispose();
        this.composer = null;
        this.bloomPass = null;
        this.vignettePass = null;
    }
}
