import { screenShake } from './screenShake';
import {
    AdditiveBlending,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DynamicDrawUsage,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    MeshLambertMaterial,
    NormalBlending,
    Points,
    Quaternion,
    ShaderMaterial,
    SphereGeometry,
    Vector2,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Projectile, SimEvent } from './sim';
import { bloodParticleScale, bloodIntensityScale } from './prefs';
import { THEME } from '../theme';

const MAX_PROJECTILES = 512;
const MAX_PARTICLES = 6144;
const GRAVITY = -14;
/** wizard orb visual scale vs unit sphere (sim hit radius unchanged) */
const ORB_SCALE = 2.4;

/** Brighter sibling burst for oversized death gore. */
function lightenBlood(hex: number): number {
    const c = new Color(hex);
    c.offsetHSL(0.02, 0.08, 0.14);
    return c.getHex();
}

type ProjectileStyle = Projectile['style'];

/**
 * Shaft + tip + flat fletching along +Z (nose forward).
 * Fletching is thin vanes — not a rear cone (that read as a second tip).
 */
function makeArrowGeometry(scale: number): BufferGeometry {
    const shaft = new CylinderGeometry(0.032 * scale, 0.038 * scale, 1.35 * scale, 6);
    shaft.rotateX(Math.PI / 2);

    const tip = new ConeGeometry(0.095 * scale, 0.4 * scale, 6);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.72 * scale);

    // three feather vanes around the nock
    const vanes: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
        const vane = new BoxGeometry(0.018 * scale, 0.2 * scale, 0.34 * scale);
        vane.translate(0, 0.09 * scale, -0.72 * scale);
        vane.rotateZ((i * Math.PI * 2) / 3);
        vanes.push(vane);
    }

    // small nock block at the very back
    const nock = new BoxGeometry(0.05 * scale, 0.05 * scale, 0.06 * scale);
    nock.translate(0, 0, -0.92 * scale);

    return mergeGeometries([shaft, tip, nock, ...vanes])!;
}

/** pulsing additive magic orb — hot core + cyan rim (visual only) */
function makeOrbMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCore: { value: new Color(0xffffff) },
            uMid: { value: new Color(0xa8f7ff) },
            uGlow: { value: new Color(THEME.projectileOrb) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vPulse;
            uniform float uTime;
            void main() {
                float pulse = 1.0 + 0.12 * sin(uTime * 8.0 + position.x * 4.0);
                vPulse = pulse;
                vec3 pos = position * pulse;
                #ifdef USE_INSTANCING
                mat4 im = instanceMatrix;
                #else
                mat4 im = mat4(1.0);
                #endif
                vec4 world = im * vec4(pos, 1.0);
                vec4 mv = modelViewMatrix * world;
                vNormal = normalize(normalMatrix * mat3(im) * normal);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vPulse;
            uniform vec3 uCore;
            uniform vec3 uMid;
            uniform vec3 uGlow;
            uniform float uTime;
            void main() {
                float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
                float swirl = 0.5 + 0.5 * sin(uTime * 6.0 + fresnel * 9.0);
                vec3 col = mix(uCore, uMid, fresnel * 0.65 + swirl * 0.2);
                col = mix(col, uGlow, fresnel);
                float alpha = 0.35 + fresnel * 0.75 + 0.1 * swirl;
                gl_FragColor = vec4(col * (1.1 + 0.25 * vPulse), alpha);
            }
        `,
    });
}

/**
 * Visual-only particles — never part of the deterministic sim.
 * Additive sparks for muzzle/explosions; normal-blended blood so hits stay dark.
 */
export class Particles {
    private readonly sparks: ParticlePool;
    private readonly blood: ParticlePool;
    private readonly darkBlood = new Color();

    constructor(scene: Scene) {
        this.sparks = new ParticlePool(scene, AdditiveBlending, 1.4);
        this.blood = new ParticlePool(scene, NormalBlending, 1.2);
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: {
            count: number;
            color: number;
            speed: number;
            life: number;
            up?: number;
            blood?: boolean;
            dir?: { x: number; y: number; z: number };
        },
    ): void {
        if (!opts.blood) {
            this.sparks.burst(x, y, z, opts);
            return;
        }
        // blood volume + energy follow the bloodFx graphics setting (0 = off)
        const scale = bloodParticleScale();
        if (scale <= 0) return;
        const count = Math.max(1, Math.round(opts.count * scale));
        // lower tiers keep blood low, slow and tight; high/ultra fountain
        const energy = bloodIntensityScale();
        // deep, dark gore — the raw hit colors read too bright/pink airborne
        this.darkBlood.setHex(opts.color).multiplyScalar(0.3);
        this.blood.burst(x, y, z, {
            ...opts,
            count,
            color: this.darkBlood.getHex(),
            speed: opts.speed * energy,
            up: (opts.up ?? 2) * energy,
            spread: energy,
        });
    }

    update(dt: number): void {
        this.sparks.update(dt);
        this.blood.update(dt);
    }

    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            switch (e.kind) {
                case 'muzzle':
                    this.burst(e.x, e.y, e.z, { count: 3, color: THEME.muzzle, speed: 5, life: 0.15, up: 1 });
                    break;
                case 'impact': {
                    // spray exits the far side, along the bullet/strike direction
                    const dir = e.dx !== undefined ? { x: e.dx, y: e.dy ?? 0, z: e.dz ?? 0 } : undefined;
                    if (!e.flesh) {
                        // towers / ground / shields: gray stone-and-metal debris, not blood
                        this.burst(e.x, e.y, e.z, {
                            count: 9,
                            color: 0x9a938a,
                            speed: 11,
                            life: 0.35,
                            up: 2,
                            dir,
                        });
                        break;
                    }
                    this.burst(e.x, e.y, e.z, {
                        count: 12,
                        color: e.blood ?? THEME.impact,
                        speed: 11,
                        life: 0.5,
                        up: 2,
                        blood: true,
                        dir,
                    });
                    // a couple of fast gouts that shoot out ahead of the hit
                    this.burst(e.x, e.y, e.z, {
                        count: 4,
                        color: e.blood ?? THEME.impact,
                        speed: 18,
                        life: 0.65,
                        up: 3,
                        blood: true,
                        dir,
                    });
                    break;
                }
                case 'explosion': {
                    // dusty debris / scorched soil — not fire-yellow
                    const s = e.radius / 3;
                    const heavy = e.heavy ? 1.6 : 1;
                    this.burst(e.x, e.y, e.z, {
                        count: Math.round(32 * s * heavy),
                        color: 0x6e6558,
                        speed: 15 * s * heavy,
                        life: 0.5 + (e.heavy ? 0.25 : 0),
                        up: 5 * heavy,
                    });
                    this.burst(e.x, e.y + 0.6, e.z, {
                        count: Math.round(18 * s * heavy),
                        color: 0x4a4338,
                        speed: 9 * s * heavy,
                        life: 0.7 + (e.heavy ? 0.3 : 0),
                        up: 7 * heavy,
                    });
                    this.burst(e.x, e.y, e.z, {
                        count: Math.round(10 * heavy),
                        color: 0x9a8f7a,
                        speed: 4 * heavy,
                        life: 0.4,
                        up: 3,
                    });
                    if (e.heavy) {
                        // extra dust ring for divine stamps
                        this.burst(e.x, e.y + 0.2, e.z, {
                            count: 40,
                            color: 0xb8a888,
                            speed: 22,
                            life: 0.85,
                            up: 3,
                        });
                    }
                    if (e.fire) {
                        // the dust above is deliberately cold; a burning rock
                        // needs a hot core FIRST (short + bright, additive
                        // sparks pool), then embers riding the dust up
                        this.burst(e.x, e.y + 0.4, e.z, {
                            count: Math.round(26 * s),
                            color: 0xfff0c0,
                            speed: 26 * s,
                            life: 0.16,
                            up: 4,
                        });
                        this.burst(e.x, e.y + 0.5, e.z, {
                            count: Math.round(34 * s),
                            color: 0xff9a3c,
                            speed: 19 * s,
                            life: 0.4,
                            up: 9,
                        });
                        this.burst(e.x, e.y + 0.8, e.z, {
                            count: Math.round(20 * s),
                            color: 0xd8431a,
                            speed: 11 * s,
                            life: 0.85,
                            up: 14,
                        });
                    }
                    if (e.shake) {
                        // heavier + longer than a unit hit, but well under the
                        // post-battle HP-draw kicks (see tickHpDraw)
                        screenShake({
                            intensity: 0.5 * e.shake,
                            duration: 0.5,
                            frequency: 46,
                        });
                    }
                    break;
                }
                case 'summon':
                    if (e.flying) {
                        // wind gust + feathers as the rider dives in
                        this.burst(e.x, e.y + 1.5, e.z, { count: 8, color: 0xd8dde6, speed: 4, life: 0.5, up: 1 });
                        this.burst(e.x, e.y, e.z, { count: 5, color: 0xf2f0e8, speed: 2.5, life: 0.6, up: 2 });
                    } else {
                        // soil bursting open as the mech climbs out
                        this.burst(e.x, e.y + 0.3, e.z, { count: 12, color: 0x8a6a42, speed: 5, life: 0.55, up: 7 });
                        this.burst(e.x, e.y + 0.1, e.z, { count: 8, color: 0x5c4a30, speed: 3, life: 0.7, up: 5, blood: true });
                    }
                    break;
                case 'death':
                    if (e.wear === 'ash') {
                        // dark ash / debris — not blood
                        this.burst(e.x, e.y, e.z, {
                            count: e.big ? 36 : 18,
                            color: 0x1a1814,
                            speed: e.big ? 14 : 10,
                            life: 0.8,
                            up: 5,
                            blood: true,
                        });
                        this.burst(e.x, e.y + 0.8, e.z, {
                            count: e.big ? 16 : 8,
                            color: 0x2e2a24,
                            speed: 7,
                            life: 0.55,
                            up: 6,
                            blood: true,
                        });
                    } else if (e.wear === 'none') {
                        break;
                    } else {
                        // gore jets along the killing-blow direction (from knockback)
                        const kill = e.dx !== undefined ? { x: e.dx, y: 0.15, z: e.dz ?? 0 } : undefined;
                        if (e.big) {
                            // massive gib burst — an omni cloud + a jet down the blow
                            this.burst(e.x, e.y, e.z, {
                                count: 56,
                                color: e.blood ?? THEME.death,
                                speed: 22,
                                life: 1.2,
                                up: 5,
                                blood: true,
                            });
                            this.burst(e.x, e.y + 1, e.z, {
                                count: 40,
                                color: e.blood != null ? lightenBlood(e.blood) : THEME.deathSecondary,
                                speed: 16,
                                life: 0.95,
                                up: 5,
                                blood: true,
                                dir: kill,
                            });
                        } else {
                            // omni spurt + a directional gout down the blow
                            this.burst(e.x, e.y, e.z, {
                                count: 18,
                                color: e.blood ?? THEME.deathSmall,
                                speed: 15,
                                life: 0.75,
                                up: 3,
                                blood: true,
                            });
                            this.burst(e.x, e.y + 0.4, e.z, {
                                count: 14,
                                color: e.blood ?? THEME.deathSmall,
                                speed: 14,
                                life: 0.85,
                                up: 3,
                                blood: true,
                                dir: kill,
                            });
                        }
                    }
                    break;
                case 'levelup':
                    this.burst(e.x, e.y, e.z, { count: 10, color: THEME.levelup, speed: 4, life: 0.6, up: 9 });
                    break;
            }
        }
    }
}

/**
 * Soft round sprite for point particles — a radial alpha falloff so blood /
 * sparks render as droplets and glows instead of hard GL-point squares.
 * Built once, shared across pools.
 */
let particleSprite: Texture | null = null;
function particleTexture(): Texture {
    if (particleSprite) return particleSprite;
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    // soft, mist-like falloff — no hard rim
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    particleSprite = new CanvasTexture(canvas);
    return particleSprite;
}

class ParticlePool {
    private readonly positions = new Float32Array(MAX_PARTICLES * 3);
    /** per-particle base tint (uploaded on burst) */
    private readonly aColor = new Float32Array(MAX_PARTICLES * 3);
    /** per-particle current point size (grows as it dissipates) */
    private readonly aSize = new Float32Array(MAX_PARTICLES);
    /** per-particle current alpha (fades over life) */
    private readonly aOpacity = new Float32Array(MAX_PARTICLES);
    private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
    /** per-particle spawn size, before the over-life growth */
    private readonly baseSizes = new Float32Array(MAX_PARTICLES);
    private readonly life = new Float32Array(MAX_PARTICLES);
    private readonly maxLife = new Float32Array(MAX_PARTICLES);
    private readonly geometry = new BufferGeometry();
    private cursor = 0;
    private readonly tmpColor = new Color();
    /** pool-wide size scalar (blood is smaller/wetter, sparks larger/glowy) */
    private readonly size: number;

    constructor(scene: Scene, blending: typeof AdditiveBlending | typeof NormalBlending, size: number) {
        this.size = size;
        this.positions.fill(0);
        this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aColor', new BufferAttribute(this.aColor, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aSize', new BufferAttribute(this.aSize, 1).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aOpacity', new BufferAttribute(this.aOpacity, 1).setUsage(DynamicDrawUsage));
        // per-particle size + opacity need a custom shader (PointsMaterial has
        // one global size only). Soft sprite → round mist; sizeAttenuation via
        // uScale = drawing-buffer height * 0.5 (matches three's point scaling).
        const material = new ShaderMaterial({
            uniforms: {
                uMap: { value: particleTexture() },
                uScale: { value: 400 },
                uOpacity: { value: blending === NormalBlending ? 0.95 : 1 },
            },
            transparent: true,
            depthWrite: false,
            blending,
            fog: false,
            vertexShader: /* glsl */ `
                attribute vec3 aColor;
                attribute float aSize;
                attribute float aOpacity;
                uniform float uScale;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    vColor = aColor;
                    vOpacity = aOpacity;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * (uScale / -mv.z);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uOpacity;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    float a = texture2D(uMap, gl_PointCoord).a;
                    gl_FragColor = vec4(vColor, a * vOpacity * uOpacity);
                }
            `,
        });
        const points = new Points(this.geometry, material);
        points.frustumCulled = false;
        const bufSize = new Vector2();
        points.onBeforeRender = (renderer) => {
            renderer.getDrawingBufferSize(bufSize);
            material.uniforms.uScale!.value = bufSize.y * 0.5;
        };
        scene.add(points);
        for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -9999;
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: {
            count: number;
            color: number;
            speed: number;
            life: number;
            up?: number;
            /** normalized jet direction — spray forms a cone around it (e.g. bullet exit) */
            dir?: { x: number; y: number; z: number };
            /** 0..1 multiplier on the random (perpendicular) spread; default 1 */
            spread?: number;
        },
    ): void {
        this.tmpColor.setHex(opts.color);
        const dir = opts.dir;
        const spread = opts.spread ?? 1;
        for (let n = 0; n < opts.count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;
            const angle = Math.random() * Math.PI * 2;
            const pitch = Math.random() * Math.PI - Math.PI / 2;
            const speed = opts.speed * (0.4 + Math.random() * 0.6);
            const rx = Math.cos(angle) * Math.cos(pitch);
            const ry = Math.abs(Math.sin(pitch));
            const rz = Math.sin(angle) * Math.cos(pitch);
            this.positions[i * 3] = x;
            this.positions[i * 3 + 1] = y;
            this.positions[i * 3 + 2] = z;
            if (dir) {
                // jet along the hit direction (dominant) with a tight random cone
                this.velocities[i * 3] = (dir.x * 1.5 + rx * 0.32 * spread) * speed;
                this.velocities[i * 3 + 1] = (dir.y * 1.5 + ry * 0.32 * spread) * speed + (opts.up ?? 1);
                this.velocities[i * 3 + 2] = (dir.z * 1.5 + rz * 0.32 * spread) * speed;
            } else {
                this.velocities[i * 3] = rx * speed * spread;
                this.velocities[i * 3 + 1] = ry * speed + (opts.up ?? 2);
                this.velocities[i * 3 + 2] = rz * speed * spread;
            }
            this.aColor[i * 3] = this.tmpColor.r;
            this.aColor[i * 3 + 1] = this.tmpColor.g;
            this.aColor[i * 3 + 2] = this.tmpColor.b;
            // mixed droplet sizes — a few fat splats, many fine mist specks
            this.baseSizes[i] = this.size * (0.4 + Math.random() * Math.random() * 1.5);
            this.aSize[i] = this.baseSizes[i]!;
            this.aOpacity[i] = 1;
            this.life[i] = opts.life * (0.6 + Math.random() * 0.4);
            this.maxLife[i] = this.life[i]!;
        }
    }

    update(dt: number): void {
        const drag = Math.max(0, 1 - dt * 2.2); // air resistance → spray settles into mist
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i]! <= 0) continue;
            this.life[i]! -= dt;
            if (this.life[i]! <= 0) {
                this.positions[i * 3 + 1] = -9999;
                this.aOpacity[i] = 0;
                continue;
            }
            this.velocities[i * 3]! *= drag;
            this.velocities[i * 3 + 2]! *= drag;
            this.velocities[i * 3 + 1]! += GRAVITY * dt;
            this.positions[i * 3]! += this.velocities[i * 3]! * dt;
            this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
            this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
            // soft floor only for near-zero spawns — don't yank hill-anchored flames to y≈0
            if (this.positions[i * 3 + 1]! < -50) this.positions[i * 3 + 1] = -50;
            const fade = this.life[i]! / this.maxLife[i]!;
            // stay fully opaque through most of the life, fade out only in the
            // last ~35% — keeps droplets solid instead of ghosting immediately
            this.aOpacity[i] = Math.min(1, fade / 0.35);
            this.aSize[i] = this.baseSizes[i]! * (1 + (1 - fade) * 0.4);
        }
        this.geometry.attributes.position!.needsUpdate = true;
        this.geometry.attributes.aColor!.needsUpdate = true;
        this.geometry.attributes.aSize!.needsUpdate = true;
        this.geometry.attributes.aOpacity!.needsUpdate = true;
    }
}

/** Draws the sim's bullets as instanced meshes — one pool per visual style. */
export class ProjectileRenderer {
    private readonly pools: Record<ProjectileStyle, InstancedMesh>;
    private readonly orbMaterial: ShaderMaterial;
    private readonly matrix = new Matrix4();
    private readonly pos = new Vector3();
    private readonly dir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly one = new Vector3(1, 1, 1);
    private readonly orbScale = new Vector3(ORB_SCALE, ORB_SCALE, ORB_SCALE);
    private readonly t0 = performance.now();

    constructor(scene: Scene) {
        const wood = new MeshLambertMaterial({ color: 0x8a6a3c, flatShading: true });
        const rock = new MeshLambertMaterial({ color: THEME.scenery.rock, flatShading: true });
        this.orbMaterial = makeOrbMaterial();
        this.pools = {
            bolt: new InstancedMesh(
                new SphereGeometry(0.28, 6, 5),
                new MeshBasicMaterial({ color: THEME.projectile }),
                MAX_PROJECTILES,
            ),
            arrow: new InstancedMesh(makeArrowGeometry(2), wood, MAX_PROJECTILES),
            // still clearly bigger than the archer's arrow
            largeArrow: new InstancedMesh(makeArrowGeometry(5.5), wood, MAX_PROJECTILES),
            // reserved for catapult
            stone: new InstancedMesh(new IcosahedronGeometry(0.84, 0), rock, MAX_PROJECTILES),
            // wizard magic orb — large additive shader sphere
            orb: new InstancedMesh(new IcosahedronGeometry(0.85, 2), this.orbMaterial, MAX_PROJECTILES),
        };
        for (const mesh of Object.values(this.pools)) {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.count = 0;
            scene.add(mesh);
        }
    }

    /** `alpha` interpolates between the last two sim steps for smooth flight */
    update(projectiles: readonly Projectile[], alpha = 1): void {
        this.orbMaterial.uniforms.uTime!.value = (performance.now() - this.t0) * 0.001;
        const counts: Record<ProjectileStyle, number> = {
            bolt: 0,
            arrow: 0,
            largeArrow: 0,
            stone: 0,
            orb: 0,
        };
        const n = Math.min(projectiles.length, MAX_PROJECTILES);
        for (let i = 0; i < n; i++) {
            const p = projectiles[i]!;
            this.pos.set(
                p.px + (p.x - p.px) * alpha,
                p.py + (p.y - p.py) * alpha,
                p.pz + (p.z - p.pz) * alpha,
            );
            this.dir.set(p.vx, p.vy, p.vz);
            if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 0, -1);
            else this.dir.normalize();
            this.quat.setFromUnitVectors(this.fwd, this.dir);
            const scale = p.style === 'orb' ? this.orbScale : this.one;
            this.matrix.compose(this.pos, this.quat, scale);
            const style = p.style;
            this.pools[style].setMatrixAt(counts[style]++, this.matrix);
        }
        for (const style of Object.keys(this.pools) as ProjectileStyle[]) {
            const mesh = this.pools[style];
            mesh.count = counts[style];
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    clear(): void {
        for (const mesh of Object.values(this.pools)) mesh.count = 0;
    }

    /** One instance per style so bolt/arrow/stone materials compile before combat. */
    primeForCompile(): void {
        this.matrix.identity();
        for (const mesh of Object.values(this.pools)) {
            mesh.setMatrixAt(0, this.matrix);
            mesh.count = 1;
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose(): void {
        for (const mesh of Object.values(this.pools)) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) for (const m of mat) m.dispose();
            else mat.dispose();
        }
    }
}
