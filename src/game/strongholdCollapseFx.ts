import {
    Color,
    DoubleSide,
    Mesh,
    NormalBlending,
    RingGeometry,
    ShaderMaterial,
    type BufferAttribute,
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
 * the keep's own masonry thrown outward — a thick ragged front low to the
 * ground, debris kicked up along its leading edge, dust settling behind it.
 *
 * The front expands at the SPEED THE SIM USES, because the sim kills what the
 * front reaches (see `strongholdCollapse` / stepCollapseFronts). What you watch
 * roll over a pack is the thing that killed it, not a decoration timed to look
 * like it.
 */

/** masonry dust — warm grey-brown, nothing like a team colour */
const DUST_COLOR = 0x9c8b70;
const DARK_DUST = 0x4a3f31;
/** band thickness as a fraction of the current radius */
const BAND_WIDTH = 0.16;
/** fade the front out over its last stretch rather than cutting it */
const FADE_FROM = 0.82;
/** world units of growth between debris emissions along the rim */
const DEBRIS_EVERY = 7;
/** seconds between the rolling ground kicks while a front travels */
const SHAKE_EVERY = 0.38;
const MAX_ACTIVE = 4;
/**
 * The front is a mesh laid over the terrain, not a flat disc: a plane large
 * enough to cross the board cuts straight through every hill it meets. These
 * are the rings and segments its skirt is built from — enough to follow the
 * relief without making the per-frame resample expensive.
 */
const RADIAL_RINGS = 6;
const SEGMENTS = 72;
/** how far the dust floats above the lawn it is following */
const GROUND_LIFT = 1.4;

type Front = {
    mesh: Mesh;
    mat: ShaderMaterial;
    /** cloned per front — each writes its own terrain-following vertex heights */
    geo: RingGeometry;
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
    /** unit disc lying in XZ (rotated once here, so vertex Y is world up and
     *  free to carry terrain height) — cloned per front */
    private readonly baseGeo = new RingGeometry(0, 1, SEGMENTS, RADIAL_RINGS).rotateX(
        -Math.PI / 2,
    ) as RingGeometry;
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
                uWidth: { value: BAND_WIDTH },
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: NormalBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vLocal;
                void main() {
                    vLocal = position.xz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uFade;
                uniform vec3 uColor;
                uniform float uWidth;
                varying vec2 vLocal;
                void main() {
                    float r = length(vLocal);
                    float ang = atan(vLocal.y, vLocal.x);
                    // ragged rim — rubble does not advance in a clean circle
                    float ragged =
                        0.70 +
                        0.30 * sin(ang * 9.0 + sin(ang * 4.0) * 1.7) *
                        (0.6 + 0.4 * sin(ang * 23.0));
                    float inner = 1.0 - uWidth;
                    // the front itself: dense at the rim, falling off inward
                    float band =
                        smoothstep(inner, inner + uWidth * 0.55, r) *
                        (1.0 - smoothstep(0.97, 1.0, r));
                    // dust hanging behind it, thinning toward the origin
                    float trail = pow(clamp(r / max(inner, 0.001), 0.0, 1.0), 2.2) * 0.30;
                    float a = (band * 0.95 * ragged + trail) * uFade;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
                }
            `,
        });

        const geo = this.baseGeo.clone() as RingGeometry;
        const mesh = new Mesh(geo, mat);
        // origin at world zero height: the vertices carry absolute terrain Y,
        // and only X/Z are scaled so that height is never stretched with radius
        mesh.position.set(e.x, 0, e.z);
        mesh.scale.set(0.01, 1, 0.01);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        this.scene.add(mesh);

        this.fronts.push({
            mesh,
            mat,
            geo,
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
            f.mesh.scale.set(Math.max(0.01, radius), 1, Math.max(0.01, radius));
            this.drapeOverTerrain(f, radius);
            const t = radius / f.maxRadius;
            f.mat.uniforms.uFade!.value =
                t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
            // band thins as it spreads, so the rim stays a rim rather than a disc
            f.mat.uniforms.uWidth!.value = BAND_WIDTH * (1 - t * 0.55);

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

    /**
     * Re-seat every vertex on the lawn beneath it. X/Z stay put (the mesh scale
     * spreads them); only Y moves, so the skirt follows the relief instead of
     * slicing through it. Cheap enough to run per frame — a few hundred samples,
     * and only while a keep is actually coming down.
     */
    private drapeOverTerrain(f: Front, radius: number): void {
        const pos = f.geo.attributes.position as BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
            const wx = f.x + arr[i]! * radius;
            const wz = f.z + arr[i + 2]! * radius;
            arr[i + 1] = groundHeightAt(wx, wz) + GROUND_LIFT;
        }
        pos.needsUpdate = true;
    }

    private retire(f: Front): void {
        const i = this.fronts.indexOf(f);
        if (i >= 0) this.fronts.splice(i, 1);
        this.scene.remove(f.mesh);
        f.geo.dispose();
        f.mat.dispose();
    }

    clear(): void {
        while (this.fronts.length > 0) this.retire(this.fronts[0]!);
    }

    dispose(): void {
        this.clear();
        this.baseGeo.dispose();
    }
}
