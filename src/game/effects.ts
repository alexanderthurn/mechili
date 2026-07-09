import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DynamicDrawUsage,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Points,
    PointsMaterial,
    SphereGeometry,
    type Scene,
} from 'three';
import type { Projectile, SimEvent } from './sim';
import { THEME } from '../theme';

const MAX_PROJECTILES = 512;
const MAX_PARTICLES = 2048;
const GRAVITY = -14;

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

/** Draws the sim's bullets as one instanced mesh (a single draw call). */
export class ProjectileRenderer {
    private readonly mesh: InstancedMesh;
    private readonly matrix = new Matrix4();

    constructor(scene: Scene) {
        this.mesh = new InstancedMesh(
            new SphereGeometry(0.28, 6, 5),
            new MeshBasicMaterial({ color: THEME.projectile }),
            MAX_PROJECTILES,
        );
        this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    update(projectiles: readonly Projectile[]): void {
        const count = Math.min(projectiles.length, MAX_PROJECTILES);
        for (let i = 0; i < count; i++) {
            const p = projectiles[i]!;
            this.matrix.makeTranslation(p.x, p.y, p.z);
            this.mesh.setMatrixAt(i, this.matrix);
        }
        this.mesh.count = count;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    clear(): void {
        this.mesh.count = 0;
    }
}
