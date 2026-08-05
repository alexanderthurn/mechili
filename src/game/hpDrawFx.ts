import {
    AdditiveBlending,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    Raycaster,
    Sprite,
    SpriteMaterial,
    Texture,
    TextureLoader,
    Vector2,
    Vector3,
    SRGBColorSpace,
    type Material,
    type Object3D,
    type Scene,
} from 'three';
import type { HpDrawScheduledParticle } from './hpDraw';
import type { HpDrawWaveTier } from './units';
import { cloneUnitModel, hasUnitModel } from './unitModels';

const MAX_HP_DRAW = 256;
/** Distance along the view ray for the HP-corner anchor in world space. */
const CORNER_RAY_DIST = 55;
/** Arrive when within this many world units of the moving target. */
const HIT_RADIUS = 2.5;
/** Extra seconds past scheduled hitTime before forcing a hit mid-arc. */
const HIT_GRACE_SECONDS = 0.55;
/** Seconds of mostly-vertical climb before homing kicks in. */
const BOOST_SECONDS = 0.07;
/** Max turn rate (rad/s) while homing — scales with flight speed for the same arc. */
const HOMING_TURN_RAD = 7.44;
/** Extra multiplier on top of scheduled flight duration (higher = faster). */
const FLIGHT_SPEED_MULT = 3.3;
/** Arc paths are longer than a straight line — baked into launch speed. */
const ARC_LENGTH_MULT = 1.15;

/** Normalized screen coords — top corners where HUD HP cards sit. */
const HP_CORNER_SCREEN = {
    player: { x: 0.13, y: 0.055 },
    enemy: { x: 0.87, y: 0.055 },
} as const;

/** Billboard soul height ≈ unit size; tier still bumps medium/high. */
const SOUL_SPRITE_MULT: Record<HpDrawWaveTier, number> = {
    low: 1.05,
    medium: 1.25,
    high: 1.45,
};

const GHOST_TINT = 0xb8f0ff;

let sharedSoulTexture: Texture | null = null;
let soulTextureLoading = false;

function ensureSoulTexture(): Texture | null {
    if (sharedSoulTexture) return sharedSoulTexture;
    if (soulTextureLoading) return null;
    soulTextureLoading = true;
    const url = new URL('../../assets/textures/vfx/soul-ghost.png', import.meta.url).href;
    new TextureLoader().load(
        url,
        (tex) => {
            tex.colorSpace = SRGBColorSpace;
            sharedSoulTexture = tex;
            soulTextureLoading = false;
        },
        undefined,
        () => {
            soulTextureLoading = false;
        },
    );
    return null;
}

/** Turn a unit-model clone into an additive cyan spirit silhouette. */
function ghostifyUnitMesh(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) (m as Material).dispose?.();
        mesh.material = new MeshBasicMaterial({
            color: GHOST_TINT,
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
            fog: false,
        });
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 14;
    });
}

function disposeObject(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) (m as Material).dispose?.();
            // Do NOT dispose geometry — unit clones share template buffers.
        }
        const spr = o as Sprite;
        if (spr.isSprite) {
            // Shared soul texture stays loaded; only dispose this sprite's material.
            (spr.material as SpriteMaterial).dispose();
        }
    });
}

type LiveProjectile = HpDrawScheduledParticle & {
    start: Vector3;
    pos: Vector3;
    vel: Vector3;
    launchTime: number;
    speed: number;
    flying: boolean;
    hit: boolean;
    /** Camera-facing soul sprite */
    sprite: Sprite;
    /** Optional transparent unit silhouette (medium/high) */
    meshGhost: Group | null;
};

export type HpDrawHitEvent = {
    victim: 'player' | 'enemy';
    damage: number;
    tier: HpDrawWaveTier;
};

/**
 * Dead-Marches souls: translucent spirit sprites flying from survivors to the
 * HP bars, plus a transparent shiny clone of each unit's mesh.
 */
export class HpDrawFx {
    private readonly root = new Group();
    private readonly desired = new Vector3();
    private readonly velDir = new Vector3();
    private readonly raycaster = new Raycaster();
    private readonly ndc = new Vector2();
    private readonly cornerPlayer = new Vector3();
    private readonly cornerEnemy = new Vector3();
    private particles: LiveProjectile[] = [];
    private elapsed = 0;
    private readonly pendingMatBinds: SpriteMaterial[] = [];

    constructor(scene: Scene) {
        scene.add(this.root);
        ensureSoulTexture();
    }

    start(scheduled: readonly HpDrawScheduledParticle[]): void {
        this.clear();
        this.elapsed = 0;
        const tex = ensureSoulTexture();
        const n = Math.min(scheduled.length, MAX_HP_DRAW);

        for (let i = 0; i < n; i++) {
            const p = scheduled[i]!;
            const start = new Vector3(p.x, p.y, p.z);

            const mat = new SpriteMaterial({
                map: tex ?? undefined,
                color: 0xffffff,
                transparent: true,
                opacity: tex ? 0.92 : 0.55,
                depthWrite: false,
                blending: AdditiveBlending,
                fog: false,
                sizeAttenuation: true,
            });
            if (!tex) this.pendingMatBinds.push(mat);

            const sprite = new Sprite(mat);
            const sz = p.meshScale * SOUL_SPRITE_MULT[p.tier];
            sprite.scale.set(sz * 0.65, sz, 1);
            sprite.position.copy(start);
            sprite.renderOrder = 15;
            sprite.visible = false;
            this.root.add(sprite);

            let meshGhost: Group | null = null;
            if (hasUnitModel(p.modelId)) {
                const clone = cloneUnitModel(p.modelId);
                if (clone) {
                    ghostifyUnitMesh(clone);
                    // Same scale as the living member mesh (meshScale on the proxy)
                    clone.scale.setScalar(p.meshScale);
                    clone.rotation.set(0, p.yaw, 0);
                    clone.position.copy(start);
                    clone.visible = false;
                    this.root.add(clone);
                    meshGhost = clone;
                }
            }

            this.particles.push({
                ...p,
                start,
                pos: start.clone(),
                vel: new Vector3(),
                launchTime: p.hitTime - p.flightDuration,
                speed: 0,
                flying: false,
                hit: false,
                sprite,
                meshGhost,
            });
        }
    }

    update(
        dtSeconds: number,
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
    ): HpDrawHitEvent[] {
        this.elapsed += dtSeconds;

        // Bind texture once it finishes loading mid-flight.
        if (sharedSoulTexture && this.pendingMatBinds.length > 0) {
            for (const mat of this.pendingMatBinds) {
                mat.map = sharedSoulTexture;
                mat.opacity = 0.92;
                mat.needsUpdate = true;
            }
            this.pendingMatBinds.length = 0;
        }

        camera.updateMatrixWorld();

        this.cornerPlayer.copy(
            screenNormToWorld(
                camera,
                HP_CORNER_SCREEN.player.x,
                HP_CORNER_SCREEN.player.y,
                viewW,
                viewH,
                this.raycaster,
                this.ndc,
            ),
        );
        this.cornerEnemy.copy(
            screenNormToWorld(
                camera,
                HP_CORNER_SCREEN.enemy.x,
                HP_CORNER_SCREEN.enemy.y,
                viewW,
                viewH,
                this.raycaster,
                this.ndc,
            ),
        );

        const hits: HpDrawHitEvent[] = [];

        for (const p of this.particles) {
            const target = p.victim === 'player' ? this.cornerPlayer : this.cornerEnemy;
            let appear = 1;

            if (this.elapsed < p.launchTime) {
                const waitDur = Math.max(p.launchTime, 0.001);
                const waitT = Math.min(1, this.elapsed / waitDur);
                appear = 0.25 + waitT * 0.75;
                p.pos.copy(p.start);
            } else {
                const flightAge = this.elapsed - p.launchTime;

                if (!p.flying) {
                    p.flying = true;
                    p.pos.copy(p.start);
                    const pathLen = Math.max(p.start.distanceTo(target), 0.001);
                    p.speed =
                        (pathLen * ARC_LENGTH_MULT * FLIGHT_SPEED_MULT) /
                        Math.max(p.flightDuration, 1e-3);
                    p.vel.set(0, p.speed, 0);
                }

                appear = 1;
                const dist = p.pos.distanceTo(target);

                if (
                    !p.hit &&
                    (dist <= HIT_RADIUS || this.elapsed >= p.hitTime + HIT_GRACE_SECONDS)
                ) {
                    p.hit = true;
                    hits.push({ victim: p.victim, damage: p.damage, tier: p.tier });
                } else if (!p.hit) {
                    if (flightAge < BOOST_SECONDS) {
                        p.vel.set(0, p.speed, 0);
                    } else {
                        this.desired.subVectors(target, p.pos);
                        if (this.desired.lengthSq() < 1e-8) this.desired.set(0, 1, 0);
                        else this.desired.normalize();

                        this.velDir.copy(p.vel);
                        if (this.velDir.lengthSq() < 1e-8) this.velDir.set(0, 1, 0);
                        else this.velDir.normalize();

                        const tierTurn =
                            p.tier === 'low' ? 0.85 : p.tier === 'medium' ? 1 : 1.15;
                        steerDirection(this.velDir, this.desired, HOMING_TURN_RAD * tierTurn * dtSeconds);
                        p.vel.copy(this.velDir).multiplyScalar(p.speed);
                    }

                    p.pos.addScaledVector(p.vel, dtSeconds);
                }
            }

            if (p.hit) {
                p.sprite.visible = false;
                if (p.meshGhost) p.meshGhost.visible = false;
                continue;
            }

            // Soft float bob — spirit rises from inside the unit body
            const bodyLift = p.meshScale * 0.45;
            const bob = Math.sin(this.elapsed * 6 + p.index * 0.7) * 0.15;
            p.sprite.visible = true;
            p.sprite.position.set(p.pos.x, p.pos.y + bodyLift + bob, p.pos.z);
            const base = p.meshScale * SOUL_SPRITE_MULT[p.tier] * appear;
            p.sprite.scale.set(base * 0.65, base, 1);
            (p.sprite.material as SpriteMaterial).opacity = 0.55 + appear * 0.4;
            // Sprites auto-face camera; slight spin for life
            p.sprite.material.rotation = Math.sin(this.elapsed * 2.2 + p.index) * 0.12;

            if (p.meshGhost) {
                p.meshGhost.visible = true;
                // Mesh origin is at the feet — same pose as the living unit
                p.meshGhost.position.copy(p.pos);
                p.meshGhost.rotation.set(0, p.yaw, 0);
            }
        }

        return hits;
    }

    allHit(): boolean {
        return this.particles.length > 0 && this.particles.every((p) => p.hit);
    }

    clear(): void {
        for (const p of this.particles) {
            this.root.remove(p.sprite);
            disposeObject(p.sprite);
            if (p.meshGhost) {
                this.root.remove(p.meshGhost);
                disposeObject(p.meshGhost);
            }
        }
        this.particles = [];
        this.pendingMatBinds.length = 0;
        this.elapsed = 0;
    }

    destroy(): void {
        this.clear();
        this.root.removeFromParent();
        this.root.clear();
    }
}

function steerDirection(current: Vector3, desired: Vector3, maxRad: number): void {
    const dot = MathUtils.clamp(current.dot(desired), -1, 1);
    const angle = Math.acos(dot);
    if (angle < 1e-6) {
        current.copy(desired);
        return;
    }
    current.lerp(desired, Math.min(1, maxRad / angle)).normalize();
}

function screenNormToWorld(
    camera: PerspectiveCamera,
    normX: number,
    normY: number,
    viewW: number,
    viewH: number,
    raycaster: Raycaster,
    ndc: Vector2,
): Vector3 {
    const sx = normX * viewW;
    const sy = normY * viewH;
    ndc.set((sx / viewW) * 2 - 1, 1 - (sy / viewH) * 2);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.origin
        .clone()
        .add(raycaster.ray.direction.clone().multiplyScalar(CORNER_RAY_DIST));
}
