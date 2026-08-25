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
 * Deliberately not the tower-debuff ring: no team tint, no clean band. This is
 * the keep's own masonry thrown outward — a swelling dome of dust with a
 * ragged silhouette, debris kicked up along its leading edge as it goes.
 *
 * The front expands at the SPEED THE SIM USES, because the sim kills what the
 * front reaches (see `strongholdCollapse` / stepCollapseFronts). What you watch
 * roll over a pack is the thing that killed it, not a decoration timed to look
 * like it.
 */

/** masonry dust — warm grey-brown, nothing like a team colour */
const DUST_COLOR = 0x9c8b70;
const DARK_DUST = 0x4a3f31;
/** shell density at birth — a bigger dome is a thinner one */
const SHELL_DENSITY = 1.35;
/** fade the front out over its last stretch rather than cutting it */
const FADE_FROM = 0.82;
/** world units of growth between debris emissions along the rim */
const DEBRIS_EVERY = 7;
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
    /** rim radius already used for debris — keeps emission even, not per-frame */
    emittedTo: number;
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
                uColor: { value: this.tmp.setHex(DUST_COLOR).clone() },
                uWidth: { value: 1 },
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
                uniform float uWidth;
                varying vec3 vLocal;
                varying vec3 vNormalV;
                varying vec3 vViewDir;
                void main() {
                    // Silhouette first: a dome is read by its edge, so the shell
                    // is nearly clear face-on and thickest where it turns away.
                    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
                    // heaviest around the base where the masonry is actually
                    // travelling, thinning toward the crown
                    float low = 1.0 - smoothstep(0.0, 0.85, vLocal.y);
                    // ragged in both axes — rubble does not swell in a clean shell
                    float ang = atan(vLocal.z, vLocal.x);
                    float ragged =
                        0.68 +
                        0.32 * sin(ang * 8.0 + sin(ang * 3.0) * 1.6) *
                        (0.55 + 0.45 * sin(vLocal.y * 11.0 + ang * 5.0));
                    float a = (fres * 0.85 + 0.10) * (0.35 + 0.65 * low) * ragged * uFade * uWidth;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
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
            emittedTo: 0,
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
            f.mat.uniforms.uFade!.value =
                t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
            // the shell thins as it swells — the same dust over more surface
            f.mat.uniforms.uWidth!.value = SHELL_DENSITY * (1 - t * 0.6);

            // debris along the rim, spaced by DISTANCE so speed does not change density
            while (radius - f.emittedTo >= DEBRIS_EVERY && f.emittedTo < f.maxRadius) {
                f.emittedTo += DEBRIS_EVERY;
                const spokes = 7;
                for (let k = 0; k < spokes; k++) {
                    const ang = (k / spokes) * Math.PI * 2 + f.emittedTo * 0.31;
                    const px = f.x + Math.cos(ang) * f.emittedTo;
                    const pz = f.z + Math.sin(ang) * f.emittedTo;
                    this.particles.burst(px, groundHeightAt(px, pz) + GROUND_LIFT, pz, {
                        count: 7,
                        color: k % 2 === 0 ? DUST_COLOR : DARK_DUST,
                        speed: 9,
                        life: 1.1,
                        up: 7,
                    });
                }
            }

            f.shakeIn -= dt;
            if (f.shakeIn <= 0) {
                f.shakeIn = SHAKE_EVERY;
                // eases off as the front outruns the camera
                screenShake({ intensity: 2.4 * (1 - t), duration: 0.3, frequency: 24 });
            }
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
