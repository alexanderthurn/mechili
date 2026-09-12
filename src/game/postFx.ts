/**
 * Optional post stack for the match 3D canvas.
 * Off → no composer (direct renderer.render). On → RenderPass → vignette → OutputPass
 * so ACES / sRGB stay correct (tone map only on the final blit).
 */
import type { Camera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import type { VignetteQuality } from './prefs';

/** Eskil vignette: higher offset → stronger corner falloff. */
const VIGNETTE: Record<Exclude<VignetteQuality, 'off'>, { offset: number; darkness: number }> = {
    medium: { offset: 1.08, darkness: 1.0 },
    high: { offset: 1.18, darkness: 1.02 },
    ultra: { offset: 1.28, darkness: 1.05 },
};

export class PostFx {
    private composer: EffectComposer | null = null;
    private vignettePass: ShaderPass | null = null;
    private quality: VignetteQuality = 'off';

    constructor(
        private readonly renderer: WebGLRenderer,
        private readonly scene: Scene,
        private readonly camera: Camera,
    ) {}

    get enabled(): boolean {
        return this.composer !== null;
    }

    setQuality(quality: VignetteQuality): void {
        if (quality === 'off') {
            this.quality = 'off';
            this.teardown();
            return;
        }
        if (!this.composer) this.build();
        this.quality = quality;
        const v = VIGNETTE[quality];
        const offset = this.vignettePass?.uniforms['offset'];
        const darkness = this.vignettePass?.uniforms['darkness'];
        if (offset) offset.value = v.offset;
        if (darkness) darkness.value = v.darkness;
    }

    setSize(width: number, height: number): void {
        if (!this.composer) return;
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(width, height);
    }

    render(): void {
        this.composer?.render();
    }

    dispose(): void {
        this.teardown();
    }

    private build(): void {
        const composer = new EffectComposer(this.renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));
        const vignette = new ShaderPass(VignetteShader);
        composer.addPass(vignette);
        composer.addPass(new OutputPass());
        this.composer = composer;
        this.vignettePass = vignette;
        const el = this.renderer.domElement;
        this.setSize(Math.max(4, el.clientWidth), Math.max(4, el.clientHeight));
    }

    private teardown(): void {
        this.composer?.dispose();
        this.composer = null;
        this.vignettePass = null;
    }
}
