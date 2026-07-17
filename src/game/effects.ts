import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
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
    PointsMaterial,
    Quaternion,
    SphereGeometry,
    Vector3,
    type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Projectile, SimEvent } from './sim';
import { THEME } from '../theme';

const MAX_PROJECTILES = 512;
const MAX_PARTICLES = 2048;
const GRAVITY = -14;

type ProjectileStyle = Projectile['style'];

/** shaft + tip along +Z (nose forward); `scale` 1 ≈ archer arrow */
function makeArrowGeometry(scale: number): BufferGeometry {
    const shaft = new CylinderGeometry(0.045 * scale, 0.055 * scale, 1.15 * scale, 5);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, -0.12 * scale);
    const tip = new ConeGeometry(0.14 * scale, 0.42 * scale, 5);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.58 * scale);
    const fletch = new ConeGeometry(0.12 * scale, 0.28 * scale, 4);
    fletch.rotateX(-Math.PI / 2);
    fletch.translate(0, 0, -0.72 * scale);
    return mergeGeometries([shaft, tip, fletch])!;
}

/**
 * Visual-only particles — never part of the deterministic sim.
 * Additive sparks for muzzle/explosions; normal-blended blood so hits stay dark.
 */
export class Particles {
    private readonly sparks: ParticlePool;
    private readonly blood: ParticlePool;

    constructor(scene: Scene) {
        this.sparks = new ParticlePool(scene, AdditiveBlending, 1.4);
        this.blood = new ParticlePool(scene, NormalBlending, 0.8);
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: { count: number; color: number; speed: number; life: number; up?: number; blood?: boolean },
    ): void {
        (opts.blood ? this.blood : this.sparks).burst(x, y, z, opts);
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
                case 'impact':
                    this.burst(e.x, e.y, e.z, {
                        count: 6,
                        color: THEME.impact,
                        speed: 9,
                        life: 0.35,
                        blood: true,
                    });
                    break;
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
                    } else if (e.big) {
                        this.burst(e.x, e.y, e.z, {
                            count: 44,
                            color: THEME.death,
                            speed: 17,
                            life: 0.9,
                            up: 6,
                            blood: true,
                        });
                        this.burst(e.x, e.y + 1, e.z, {
                            count: 20,
                            color: THEME.deathSecondary,
                            speed: 9,
                            life: 0.6,
                            up: 8,
                            blood: true,
                        });
                    } else {
                        this.burst(e.x, e.y, e.z, {
                            count: 12,
                            color: THEME.deathSmall,
                            speed: 11,
                            life: 0.5,
                            up: 4,
                            blood: true,
                        });
                    }
                    break;
                case 'levelup':
                    this.burst(e.x, e.y, e.z, { count: 10, color: THEME.levelup, speed: 4, life: 0.6, up: 9 });
                    break;
            }
        }
    }
}

class ParticlePool {
    private readonly positions = new Float32Array(MAX_PARTICLES * 3);
    private readonly colors = new Float32Array(MAX_PARTICLES * 3);
    private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
    private readonly baseColors = new Float32Array(MAX_PARTICLES * 3);
    private readonly life = new Float32Array(MAX_PARTICLES);
    private readonly maxLife = new Float32Array(MAX_PARTICLES);
    private readonly geometry = new BufferGeometry();
    private cursor = 0;
    private readonly tmpColor = new Color();

    constructor(scene: Scene, blending: typeof AdditiveBlending | typeof NormalBlending, size: number) {
        this.positions.fill(0);
        this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
        const points = new Points(
            this.geometry,
            new PointsMaterial({
                size,
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                blending,
                sizeAttenuation: true,
                opacity: blending === NormalBlending ? 0.92 : 1,
            }),
        );
        points.frustumCulled = false;
        scene.add(points);
        for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -9999;
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: { count: number; color: number; speed: number; life: number; up?: number },
    ): void {
        this.tmpColor.setHex(opts.color);
        for (let n = 0; n < opts.count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;
            const angle = Math.random() * Math.PI * 2;
            const pitch = Math.random() * Math.PI - Math.PI / 2;
            const speed = opts.speed * (0.4 + Math.random() * 0.6);
            this.positions[i * 3] = x;
            this.positions[i * 3 + 1] = y;
            this.positions[i * 3 + 2] = z;
            this.velocities[i * 3] = Math.cos(angle) * Math.cos(pitch) * speed;
            this.velocities[i * 3 + 1] = Math.abs(Math.sin(pitch)) * speed + (opts.up ?? 2);
            this.velocities[i * 3 + 2] = Math.sin(angle) * Math.cos(pitch) * speed;
            this.baseColors[i * 3] = this.tmpColor.r;
            this.baseColors[i * 3 + 1] = this.tmpColor.g;
            this.baseColors[i * 3 + 2] = this.tmpColor.b;
            this.life[i] = opts.life * (0.6 + Math.random() * 0.4);
            this.maxLife[i] = this.life[i]!;
        }
    }

    update(dt: number): void {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i]! <= 0) continue;
            this.life[i]! -= dt;
            if (this.life[i]! <= 0) {
                this.positions[i * 3 + 1] = -9999;
                this.colors[i * 3] = 0;
                this.colors[i * 3 + 1] = 0;
                this.colors[i * 3 + 2] = 0;
                continue;
            }
            this.velocities[i * 3 + 1]! += GRAVITY * dt;
            this.positions[i * 3]! += this.velocities[i * 3]! * dt;
            this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
            this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
            // soft floor only for near-zero spawns — don't yank hill-anchored flames to y≈0
            if (this.positions[i * 3 + 1]! < -50) this.positions[i * 3 + 1] = -50;
            const fade = this.life[i]! / this.maxLife[i]!;
            this.colors[i * 3] = this.baseColors[i * 3]! * fade;
            this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1]! * fade;
            this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2]! * fade;
        }
        this.geometry.attributes.position!.needsUpdate = true;
        this.geometry.attributes.color!.needsUpdate = true;
    }
}

/** Draws the sim's bullets as instanced meshes — one pool per visual style. */
export class ProjectileRenderer {
    private readonly pools: Record<ProjectileStyle, InstancedMesh>;
    private readonly matrix = new Matrix4();
    private readonly pos = new Vector3();
    private readonly dir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly one = new Vector3(1, 1, 1);

    constructor(scene: Scene) {
        const wood = new MeshLambertMaterial({ color: 0x8a6a3c, flatShading: true });
        const rock = new MeshLambertMaterial({ color: THEME.scenery.rock, flatShading: true });
        this.pools = {
            bolt: new InstancedMesh(
                new SphereGeometry(0.28, 6, 5),
                new MeshBasicMaterial({ color: THEME.projectile }),
                MAX_PROJECTILES,
            ),
            arrow: new InstancedMesh(makeArrowGeometry(3), wood, MAX_PROJECTILES),
            // still clearly bigger than the archer's arrow
            largeArrow: new InstancedMesh(makeArrowGeometry(5.5), wood, MAX_PROJECTILES),
            // reserved for catapult
            stone: new InstancedMesh(new IcosahedronGeometry(0.84, 0), rock, MAX_PROJECTILES),
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
        const counts: Record<ProjectileStyle, number> = {
            bolt: 0,
            arrow: 0,
            largeArrow: 0,
            stone: 0,
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
            this.matrix.compose(this.pos, this.quat, this.one);
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
}
