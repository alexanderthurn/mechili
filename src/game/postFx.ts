/**
 * Optional post stack for the match 3D canvas.
 * Off → no composer (direct renderer.render).
 * On → RenderPass → [AO] → [bloom] → [vignette] → OutputPass
 * so ACES / sRGB stay correct (tone map only on the final blit).
 */
import { Vector2, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import type { AoQuality, BloomQuality, VignetteQuality } from './prefs';

/**
 * Objects that look wrong in GTAO's opaque G-buffer (cutout/sprite quads →
 * dark slabs). Points/Lines are already stripped by GTAOPass itself.
 */
function shouldSkipGtaoObject(object: Object3D): boolean {
    const o = object as Object3D & {
        isSprite?: boolean;
        material?: Material | Material[];
        userData?: { wardDome?: boolean; gtaoSkip?: boolean };
    };
    if (o.userData?.wardDome || o.userData?.gtaoSkip) return true;
    if (o.isSprite) return true;
    const mat = o.material;
    if (!mat) return false;
    const mats = Array.isArray(mat) ? mat : [mat];
    // alpha-tested billboards / foliage cards (trees, bushes, grass tufts, …)
    return mats.some((m) => (m.alphaTest ?? 0) > 0);
}

/** Eskil vignette: higher offset → stronger corner falloff. */
const VIGNETTE: Record<Exclude<VignetteQuality, 'off'>, { offset: number; darkness: number }> = {
    high: { offset: 1.18, darkness: 1.02 },
    ultra: { offset: 1.28, darkness: 1.05 },
};

/**
 * Selective bloom — high threshold so grass/sky stay clean; strength/radius
 * lift magic beams / sun / (compensated) fire.
 *
 * Winter snow albedo (~0.92–1.0) sits on top of these floors once lit, so
 * {@link PostFx.setSnowCover} raises threshold / eases strength with cover.
 */
const BLOOM: Record<Exclude<BloomQuality, 'off'>, { threshold: number; strength: number; radius: number }> =
    {
        high: { threshold: 0.9, strength: 0.4, radius: 0.42 },
        ultra: { threshold: 0.85, strength: 0.55, radius: 0.52 },
    };

/** At full snow cover: add to threshold / multiply strength (keeps fire/magic above). */
const BLOOM_SNOW_THRESHOLD_LIFT = 0.38;
const BLOOM_SNOW_STRENGTH_SCALE = 0.7;

/**
 * Mild GTAO — small radius so grass stays clean; scale/blend lift unit contact.
 *
 * `resScale` sizes the AO buffers as a fraction of the frame. AO is
 * low-frequency, so half resolution is close to invisible while cutting the AO
 * pixels to a quarter — that is what makes `medium` cheap enough to be the high
 * preset's tier. It does NOT reduce GTAOPass's normal pre-pass, which re-renders
 * the scene every frame and is the bigger cost; fixing that needs a shared
 * depth/normal prepass.
 *
 * `high` and `ultra` keep their original full-resolution params so the cheaper
 * tier can be compared against them directly (Shift+O).
 */
const AO: Record<
    Exclude<AoQuality, 'off'>,
    {
        radius: number;
        scale: number;
        samples: number;
        blendIntensity: number;
        thickness: number;
        /** AO buffer size as a fraction of the effective frame (1 = full) */
        resScale: number;
        /** poisson-denoise radius / sample count */
        pdRadius: number;
        pdSamples: number;
    }
> = {
    medium: {
        radius: 0.2,
        scale: 0.75,
        samples: 8,
        blendIntensity: 0.7,
        thickness: 1.0,
        resScale: 0.5,
        pdRadius: 6,
        pdSamples: 8,
    },
    high: {
        radius: 0.2,
        scale: 0.75,
        samples: 12,
        blendIntensity: 0.7,
        thickness: 1.0,
        resScale: 1,
        pdRadius: 6,
        pdSamples: 10,
    },
    ultra: {
        radius: 0.26,
        scale: 0.95,
        samples: 16,
        blendIntensity: 0.85,
        thickness: 1.1,
        resScale: 1,
        pdRadius: 8,
        pdSamples: 12,
    },
};

export class PostFx {
    private composer: EffectComposer | null = null;
    private aoPass: GTAOPass | null = null;
    private bloomPass: UnrealBloomPass | null = null;
    private vignettePass: ShaderPass | null = null;
    private vignette: VignetteQuality = 'off';
    private bloom: BloomQuality = 'off';
    private ao: AoQuality = 'off';
    /** 0..1 visual ground snow (same source as the board / outer meadow). */
    private snowCover = 0;
    private readonly resolution = new Vector2(4, 4);

    constructor(
        private readonly renderer: WebGLRenderer,
        private readonly scene: Scene,
        private readonly camera: Camera,
    ) {}

    get enabled(): boolean {
        return this.composer !== null;
    }

    setEffects(vignette: VignetteQuality, bloom: BloomQuality, ao: AoQuality): void {
        if (vignette === this.vignette && bloom === this.bloom && ao === this.ao) {
            this.applyParams();
            return;
        }
        const wasOn = this.composer !== null;
        const wantOn = vignette !== 'off' || bloom !== 'off' || ao !== 'off';
        const passSetChanged =
            (this.vignette === 'off') !== (vignette === 'off') ||
            (this.bloom === 'off') !== (bloom === 'off') ||
            (this.ao === 'off') !== (ao === 'off');

        this.vignette = vignette;
        this.bloom = bloom;
        this.ao = ao;

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

    /**
     * Bias bloom away from lit snow. Same 0..1 cover the board uses; cheap to
     * call every frame while cover eases in/out.
     */
    setSnowCover(cover: number): void {
        const next = Math.min(1, Math.max(0, cover));
        if (Math.abs(next - this.snowCover) < 1e-4) return;
        this.snowCover = next;
        // bloom only: this runs every frame while cover eases, and the full
        // applyParams() would re-flag the GTAO material (needsUpdate) and
        // resize the AO pass each time for nothing
        this.applyBloomParams();
    }

    setSize(width: number, height: number): void {
        if (!this.composer) return;
        this.resolution.set(Math.max(4, width), Math.max(4, height));
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(this.resolution.x, this.resolution.y);
        // composer.setSize resizes EVERY pass to the full effective frame, so a
        // fractional AO buffer has to be re-applied after it, never before.
        this.applyAoResolution();
    }

    /** Size the AO pass to its tier's fraction of the effective frame. */
    private applyAoResolution(): void {
        if (!this.aoPass || this.ao === 'off') return;
        const s = AO[this.ao].resScale;
        const pr = this.renderer.getPixelRatio();
        this.aoPass.setSize(
            Math.max(4, Math.floor(this.resolution.x * pr * s)),
            Math.max(4, Math.floor(this.resolution.y * pr * s)),
        );
    }

    render(): void {
        this.composer?.render();
    }

    dispose(): void {
        this.teardown();
    }

    private applyParams(): void {
        if (this.ao !== 'off' && this.aoPass) {
            const a = AO[this.ao];
            this.aoPass.blendIntensity = a.blendIntensity;
            this.aoPass.updateGtaoMaterial({
                radius: a.radius,
                scale: a.scale,
                samples: a.samples,
                thickness: a.thickness,
                distanceExponent: 1,
                distanceFallOff: 1,
                screenSpaceRadius: false,
            });
            this.aoPass.updatePdMaterial({
                lumaPhi: 10,
                depthPhi: 2,
                normalPhi: 3,
                radius: a.pdRadius,
                radiusExponent: 1,
                rings: 2,
                samples: a.pdSamples,
            });
            // tier switch without a pass rebuild (Shift+O) changes resScale too
            this.applyAoResolution();
        }
        this.applyBloomParams();
        if (this.vignette !== 'off' && this.vignettePass) {
            const v = VIGNETTE[this.vignette];
            const offset = this.vignettePass.uniforms['offset'];
            const darkness = this.vignettePass.uniforms['darkness'];
            if (offset) offset.value = v.offset;
            if (darkness) darkness.value = v.darkness;
        }
    }

    /** Bloom threshold / strength / radius, including the snow-cover bias. */
    private applyBloomParams(): void {
        if (this.bloom === 'off' || !this.bloomPass) return;
        const b = BLOOM[this.bloom];
        const snow = this.snowCover;
        this.bloomPass.threshold = b.threshold + snow * BLOOM_SNOW_THRESHOLD_LIFT;
        this.bloomPass.strength = b.strength * (1 - snow * (1 - BLOOM_SNOW_STRENGTH_SCALE));
        this.bloomPass.radius = b.radius;
    }

    private build(): void {
        const el = this.renderer.domElement;
        this.resolution.set(Math.max(4, el.clientWidth), Math.max(4, el.clientHeight));
        const pr = this.renderer.getPixelRatio();
        const bw = Math.max(4, Math.floor(this.resolution.x * pr));
        const bh = Math.max(4, Math.floor(this.resolution.y * pr));

        const composer = new EffectComposer(this.renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));

        if (this.ao !== 'off') {
            const s = AO[this.ao].resScale;
            const ao = new GTAOPass(
                this.scene,
                this.camera,
                Math.max(4, Math.floor(bw * s)),
                Math.max(4, Math.floor(bh * s)),
            );
            ao.output = GTAOPass.OUTPUT.Default;
            // GTAO's normal/depth pass uses an opaque override — alpha cutouts
            // and sprites become solid quads (dark slabs on trees, HUD badges,
            // sun glow, …). Hide those for the G-buffer only; Points/Lines are
            // already stripped by GTAOPass._overrideVisibility.
            // Runtime fields are underscored; @types/three names differ.
            type GtaoVis = {
                _overrideVisibility: () => void;
                _visibilityCache: { visible: boolean }[];
            };
            const gtao = ao as unknown as GtaoVis;
            const hideDefault = gtao._overrideVisibility.bind(ao);
            gtao._overrideVisibility = () => {
                hideDefault();
                const cache = gtao._visibilityCache;
                this.scene.traverse((object) => {
                    if (!object.visible) return;
                    if (shouldSkipGtaoObject(object)) {
                        object.visible = false;
                        cache.push(object as { visible: boolean });
                    }
                });
            };
            composer.addPass(ao);
            this.aoPass = ao;
        } else {
            this.aoPass = null;
        }

        if (this.bloom !== 'off') {
            const bloom = new UnrealBloomPass(this.resolution.clone(), 0.5, 0.4, 0.85);
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
        this.aoPass = null;
        this.bloomPass = null;
        this.vignettePass = null;
    }
}
