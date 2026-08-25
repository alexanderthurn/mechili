import {
    Color,
    DoubleSide,
    Mesh,
    NormalBlending,
    ShaderMaterial,
    SphereGeometry,
    type Scene,
} from 'three';
import type { Particles } from './effects';
import { groundHeightAt } from './map';
import { screenShake } from './screenShake';
import type { SimEvent } from './sim';

/**
 * A keep coming down, as dust and rubble rather than a status effect.
 *
 * Deliberately not the tower-debuff ring: no team tint, no clean band. The
 * weight of it lives ON THE GROUND — a continuous rolling boil of dust and
 * masonry along the leading edge, following the terrain it crosses. The dome
 * above is only a faint silhouette, so nothing about this reads as a coloured
 * status effect painted over the board.
 *
 * The front expands at the SPEED THE SIM USES, because the sim kills what the
 * front reaches (see `strongholdCollapse` / stepCollapseFronts). What you watch
 * roll over a pack is the thing that killed it, not a decoration timed to look
 * like it.
 */

/** masonry dust — warm grey-brown, nothing like a team colour */
const DUST_COLOR = 0x9c8b70;
const DARK_DUST = 0x4a3f31;
/**
 * Soot, not dust: the shell is dark, so on a lit field it reads as a shadow
 * being cast over the ground rather than a pale glow laid on top of it.
 */
const SHELL_COLOR = 0x4a4239;
/** the near-black the thick clumps fall away to */
const SHELL_SHADE = 0x14110e;
/**
 * Cloud detail on the shell, as noise rather than a texture file: the coarse
 * octave gives billows you can pick out, the fine one gives the wisps at their
 * edges. Both drift, so the dome boils instead of being a scaled-up decal.
 */
const NOISE_COARSE = 3.1;
const NOISE_FINE = 8.5;
const NOISE_DRIFT = 0.42;
/** shell density at birth — a bigger dome is a thinner one */
const SHELL_DENSITY = 1.35;
/** fade the front out over its last stretch rather than cutting it */
const FADE_FROM = 0.82;
/**
 * The leading edge emits CONTINUOUSLY, at a rate that follows its own
 * circumference so a front twenty units out is not thinner than one at five.
 * Both are clamped: a board-wide rim would otherwise bury the particle pools.
 */
const PUFFS_PER_RIM_UNIT = 0.55;
const PUFFS_PER_SEC = { min: 40, max: 190 };
/** the edge is a band, not a hairline — emissions scatter back over this much */
const RIM_BAND = 0.13;
/** seconds between the rolling ground kicks while a front travels */
const SHAKE_EVERY = 0.38;
const MAX_ACTIVE = 4;
/**
 * The front is a DOME, not a disc — the same hemisphere the ward uses, so it
 * reads as a volume of dust swelling out of the keep rather than a decal
 * sliding over the grass. A dome also stops fighting the terrain: it stands
 * well above every hill it crosses instead of slicing through them.
 */
const DOME_FLATTEN = 0.62;
/** the base sits this far up so the rim does not shave the grass it passes */
const GROUND_LIFT = 1.4;

type Front = {
    mesh: Mesh;
    mat: ShaderMaterial;

    x: number;
    z: number;
    y: number;
    age: number;
    speed: number;
    maxRadius: number;
    /** fractional emissions carried between frames — keeps rate framerate-free */
    puffDebt: number;
    shakeIn: number;
};

export class StrongholdCollapseFx {
    private readonly fronts: Front[] = [];
    /** unit hemisphere, open at the bottom — the ward dome's own shape */
    private readonly geo = new SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    private readonly tmp = new Color();

    constructor(
        private readonly scene: Scene,
        private readonly particles: Particles,
    ) {}

    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            if (e.kind === 'strongholdCollapse') this.spawn(e);
        }
    }

    private spawn(e: Extract<SimEvent, { kind: 'strongholdCollapse' }>): void {
        while (this.fronts.length >= MAX_ACTIVE) this.retire(this.fronts[0]!);

        const mat = new ShaderMaterial({
            uniforms: {
                uFade: { value: 1 },
                uColor: { value: this.tmp.setHex(SHELL_COLOR).clone() },
                uWidth: { value: 1 },
                uTime: { value: 0 },
                uShade: { value: this.tmp.setHex(SHELL_SHADE).clone() },
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: NormalBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec3 vLocal;
                varying vec3 vNormalV;
                varying vec3 vViewDir;
                void main() {
                    vLocal = position;
                    vNormalV = normalize(normalMatrix * normal);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vViewDir = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uFade;
                uniform vec3 uColor;
                uniform vec3 uShade;
                uniform float uWidth;
                uniform float uTime;
                varying vec3 vLocal;
                varying vec3 vNormalV;
                varying vec3 vViewDir;

                float hash31(vec3 p) {
                    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float vnoise(vec3 x) {
                    vec3 i = floor(x);
                    vec3 f = fract(x);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                            mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                            mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
                        f.z);
                }
                float fbm(vec3 p) {
                    float a = 0.5;
                    float sum = 0.0;
                    for (int i = 0; i < 4; i++) {
                        sum += a * vnoise(p);
                        p *= 2.03;
                        a *= 0.5;
                    }
                    return sum;
                }

                void main() {
                    // Silhouette first: a dome is read by its edge, so the shell
                    // is nearly clear face-on and thickest where it turns away.
                    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
                    // heaviest around the base where the masonry is actually
                    // travelling, thinning toward the crown
                    float low = 1.0 - smoothstep(0.0, 0.85, vLocal.y);
                    // Cloud structure, sampled on the unit hemisphere so the
                    // billows grow WITH the dome rather than crawling across it.
                    vec3 d = normalize(vLocal);
                    float coarse = fbm(d * ${NOISE_COARSE.toFixed(2)} + vec3(0.0, -uTime * ${NOISE_DRIFT.toFixed(2)}, uTime * 0.18));
                    float fine = fbm(d * ${NOISE_FINE.toFixed(2)} - vec3(uTime * 0.5, uTime * 0.3, 0.0));
                    float clump = clamp(coarse * 1.15 + fine * 0.5 - 0.42, 0.0, 1.0);
                    // holes: real dust is not a closed surface
                    float torn = smoothstep(0.06, 0.34, clump);

                    // Deliberately faint: no flat term, so the shell is glass
                    // face-on and only its turning edge is ever visible.
                    float a = fres * fres * 0.72 * (0.30 + 0.70 * low) * torn * uFade * uWidth;
                    if (a < 0.015) discard;
                    // the thick clumps sit in their own shadow
                    vec3 col = mix(uShade, uColor, clamp(0.35 + fine * 1.1, 0.0, 1.0));
                    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
                }
            `,
        });

        const mesh = new Mesh(this.geo, mat);
        mesh.position.set(e.x, groundHeightAt(e.x, e.z) + GROUND_LIFT, e.z);
        mesh.scale.set(0.01, 0.01 * DOME_FLATTEN, 0.01);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        this.scene.add(mesh);

        this.fronts.push({
            mesh,
            mat,
            x: e.x,
            z: e.z,
            y: e.y,
            age: 0,
            speed: e.speed,
            maxRadius: e.maxRadius,
            puffDebt: 0,
            shakeIn: 0,
        });

        // the keep itself going up: a dark column of dust and stone
        this.particles.burst(e.x, e.y, e.z, {
            count: 160,
            color: DARK_DUST,
            speed: 14,
            life: 2.6,
            up: 34,
        });
        this.particles.burst(e.x, e.y * 0.5, e.z, {
            count: 120,
            color: DUST_COLOR,
            speed: 26,
            life: 2.2,
            up: 8,
        });
        screenShake({ intensity: 4.2, duration: 1.1, frequency: 22 });
    }

    update(dt: number): void {
        for (let i = this.fronts.length - 1; i >= 0; i--) {
            const f = this.fronts[i]!;
            f.age += dt;
            const radius = f.age * f.speed;
            if (radius >= f.maxRadius) {
                this.retire(f);
                continue;
            }
            const r = Math.max(0.01, radius);
            f.mesh.scale.set(r, r * DOME_FLATTEN, r);
            const t = radius / f.maxRadius;
            f.mat.uniforms.uFade!.value = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
            // the shell thins as it swells — the same dust over more surface
            f.mat.uniforms.uWidth!.value = SHELL_DENSITY * (1 - t * 0.6);
            f.mat.uniforms.uTime!.value = f.age;

            this.emitAlongRim(f, radius, t, dt);

            f.shakeIn -= dt;
            if (f.shakeIn <= 0) {
                f.shakeIn = SHAKE_EVERY;
                // eases off as the front outruns the camera
                screenShake({ intensity: 2.4 * (1 - t), duration: 0.3, frequency: 24 });
            }
        }
    }

    /**
     * The rolling edge: dust and masonry laid down wherever the front is at
     * this instant, at the height of the ground under that spot. Rates scale
     * with the rim's own length so density per metre of edge stays put.
     */
    private emitAlongRim(f: Front, radius: number, t: number, dt: number): void {
        const rim = Math.PI * 2 * radius;
        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
        // dies off toward the end so the front peters out instead of stopping
        const falloff = 1 - t * 0.45;
        f.puffDebt +=
            clamp(rim * PUFFS_PER_RIM_UNIT, PUFFS_PER_SEC.min, PUFFS_PER_SEC.max) * falloff * dt;

        const puffs = Math.floor(f.puffDebt);
        f.puffDebt -= puffs;
        for (let i = 0; i < puffs; i++) {
            const ang = Math.random() * Math.PI * 2;
            const rr = radius * (1 - Math.random() * RIM_BAND);
            const px = f.x + Math.cos(ang) * rr;
            const pz = f.z + Math.sin(ang) * rr;
            const gy = groundHeightAt(px, pz);
            const dark = Math.random() < 0.4;
            this.particles.burst(px, gy + 0.2 + Math.random() * GROUND_LIFT, pz, {
                count: 3,
                color: dark ? DARK_DUST : DUST_COLOR,
                speed: 5 + Math.random() * 6,
                life: 0.9 + Math.random() * 1.3,
                up: 3 + Math.random() * 6,
                dir: { x: Math.cos(ang), y: 0.25, z: Math.sin(ang) },
            });
        }
    }

    private retire(f: Front): void {
        const i = this.fronts.indexOf(f);
        if (i >= 0) this.fronts.splice(i, 1);
        this.scene.remove(f.mesh);
        f.mat.dispose();
    }

    clear(): void {
        while (this.fronts.length > 0) this.retire(this.fronts[0]!);
    }

    dispose(): void {
        this.clear();
        this.geo.dispose();
    }
}
