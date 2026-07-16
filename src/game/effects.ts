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
 * A pooled point-sprite particle system: one Points object, one draw call.
 * Visual only — never part of the deterministic sim (randomness is fine here).
 */
export class Particles {
    private readonly positions = new Float32Array(MAX_PARTICLES * 3);
    private readonly colors = new Float32Array(MAX_PARTICLES * 3);
    private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
    private readonly baseColors = new Float32Array(MAX_PARTICLES * 3);
    private readonly life = new Float32Array(MAX_PARTICLES);
    private readonly maxLife = new Float32Array(MAX_PARTICLES);
    private readonly geometry = new BufferGeometry();
    private cursor = 0;
    private readonly tmpColor = new Color();

    constructor(scene: Scene) {
        this.positions.fill(0);
        this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
        const points = new Points(
            this.geometry,
            new PointsMaterial({
                size: 1.4,
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
                sizeAttenuation: true,
            }),
        );
        points.frustumCulled = false;
        scene.add(points);
        // park everything far underground until used
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
            if (this.positions[i * 3 + 1]! < 0.05) this.positions[i * 3 + 1] = 0.05; // rest on the ground
            const fade = this.life[i]! / this.maxLife[i]!;
            this.colors[i * 3] = this.baseColors[i * 3]! * fade;
            this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1]! * fade;
            this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2]! * fade;
        }
        this.geometry.attributes.position!.needsUpdate = true;
        this.geometry.attributes.color!.needsUpdate = true;
    }

    /** turns a batch of sim events into bursts */
    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            switch (e.kind) {
                case 'muzzle':
                    this.burst(e.x, e.y, e.z, { count: 3, color: THEME.muzzle, speed: 5, life: 0.15, up: 1 });
                    break;
                case 'impact':
                    this.burst(e.x, e.y, e.z, { count: 6, color: THEME.impact, speed: 9, life: 0.35 });
                    break;
                case 'explosion': {
                    // artillery blast, scaled to the splash radius (tuned at r = 3)
                    const s = e.radius / 3;
                    this.burst(e.x, e.y, e.z, { count: Math.round(32 * s), color: THEME.impact, speed: 15 * s, life: 0.5, up: 5 });
                    this.burst(e.x, e.y + 0.6, e.z, { count: Math.round(18 * s), color: THEME.death, speed: 9 * s, life: 0.7, up: 7 });
                    this.burst(e.x, e.y, e.z, { count: 10, color: THEME.deathSecondary, speed: 4, life: 0.4, up: 3 });
                    break;
                }
                case 'death':
                    if (e.big) {
                        this.burst(e.x, e.y, e.z, { count: 44, color: THEME.death, speed: 17, life: 0.9, up: 6 });
                        this.burst(e.x, e.y + 1, e.z, { count: 20, color: THEME.deathSecondary, speed: 9, life: 0.6, up: 8 });
                    } else {
                        this.burst(e.x, e.y, e.z, { count: 12, color: THEME.deathSmall, speed: 11, life: 0.5, up: 4 });
                    }
                    break;
                case 'levelup':
                    this.burst(e.x, e.y, e.z, { count: 10, color: THEME.levelup, speed: 4, life: 0.6, up: 9 });
                    break;
            }
        }
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
