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
/** Distance along the view ray for the HP-portrait anchor in world space. */
const CORNER_RAY_DIST = 42;
/** Arrive when within this many world units of the moving target. */
const HIT_RADIUS = 1.8;
/** Extra seconds past scheduled hitTime before forcing a hit. */
const HIT_GRACE_SECONDS = 0.45;
/** Hold launch heading briefly before homing toward the HP portrait. */
const BOOST_SECONDS = 0.07;

// --- flight feel (tune these) ---
/** Launch speed — same for every soul (world units / sec). */
const SPEED_START = 50;
/** Constant acceleration — far souls fly longer, so they end up faster. */
const ACCEL = 150;
/** Homing turn rate (rad/s). */
const TURN_RATE = 5;
/** Within this distance, turn ramps up toward CLOSE_TURN_MULT. */
const CLOSE_TURN_DIST = 22;
/** Peak turn multiplier at the HP corner. */
const CLOSE_TURN_MULT = 100;
/**
 * Camera distance used as “normal” sprite size. Closer than this → scale down
 * so sizeAttenuation doesn’t blow the soul across the whole HUD.
 */
const SOUL_REF_CAM_DIST = 36;
/** Below this approach fraction, hide the unit mesh ghost (too chunky near cam). */
const GHOST_HIDE_APPROACH = 0.4;

/**
 * Fallback normalized screen coords if portrait DOM isn’t found.
 * Prefer live `.portrait.main` centers from the fightbar.
 */
const HP_CORNER_SCREEN = {
    player: { x: 0.04, y: 0.055 },
    enemy: { x: 0.96, y: 0.055 },
} as const;

const PORTRAIT_SEL = {
    player: '.mechili-fightbar .fighter-stack.player .portrait.main',
    enemy: '.mechili-fightbar .fighter-stack.enemy .portrait.main',
} as const;

/** Billboard soul height ≈ unit size; tier still bumps medium/high. */
const SOUL_SPRITE_MULT: Record<HpDrawWaveTier, number> = {
    low: 1.05,
    medium: 1.25,
    high: 1.45,
};

const GHOST_TINT = 0xd0f8ff;
/** Ghost mesh opacity — additive, so keep low for a glassy silhouette. */
const GHOST_OPACITY = 0.18;
/** Billboard soul tint (additive; brighter = shinier glow). */
const SOUL_TINT = 0xe8ffff;
/** Sprite opacity while waiting / in flight (additive). */
const SOUL_OPACITY_WAIT = 0.28;
const SOUL_OPACITY_FLY = 0.48;

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
            opacity: GHOST_OPACITY,
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
    /** Current speed magnitude (SPEED_START + ACCEL * age). */
    speed: number;
    flying: boolean;
    hit: boolean;
    /** Camera-facing soul sprite */
    sprite: Sprite;
    /** Optional transparent unit silhouette */
    meshGhost: Group | null;
};

export type HpDrawHitEvent = {
    victim: 'player' | 'enemy';
    damage: number;
    tier: HpDrawWaveTier;
};

/**
 * Dead-Marches souls: translucent spirit sprites racing along the ground
 * toward the camera, then homing into the commander portraits.
 */
export class HpDrawFx {
    private readonly root = new Group();
    private readonly desired = new Vector3();
    private readonly velDir = new Vector3();
    private readonly launchDir = new Vector3();
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
                color: SOUL_TINT,
                transparent: true,
                opacity: tex ? SOUL_OPACITY_FLY : SOUL_OPACITY_WAIT,
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
                mat.opacity = SOUL_OPACITY_FLY;
                mat.needsUpdate = true;
            }
            this.pendingMatBinds.length = 0;
        }

        camera.updateMatrixWorld();

        const playerAim =
            portraitScreenNorm(PORTRAIT_SEL.player, viewW, viewH) ?? HP_CORNER_SCREEN.player;
        const enemyAim =
            portraitScreenNorm(PORTRAIT_SEL.enemy, viewW, viewH) ?? HP_CORNER_SCREEN.enemy;

        this.cornerPlayer.copy(
            screenNormToWorld(
                camera,
                playerAim.x,
                playerAim.y,
                viewW,
                viewH,
                this.raycaster,
                this.ndc,
            ),
        );
        this.cornerEnemy.copy(
            screenNormToWorld(
                camera,
                enemyAim.x,
                enemyAim.y,
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
                    p.speed = SPEED_START;
                    // Ground skitter toward the camera (XZ), not a vertical pop
                    this.launchDir.set(
                        camera.position.x - p.start.x,
                        0,
                        camera.position.z - p.start.z,
                    );
                    if (this.launchDir.lengthSq() < 1e-6) {
                        camera.getWorldDirection(this.launchDir);
                        this.launchDir.y = 0;
                    }
                    if (this.launchDir.lengthSq() < 1e-6) this.launchDir.set(0, 0, 1);
                    else this.launchDir.normalize();
                    p.vel.copy(this.launchDir).multiplyScalar(p.speed);
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
                    p.speed = SPEED_START + ACCEL * flightAge;
                    const closeT = 1 - MathUtils.clamp(dist / CLOSE_TURN_DIST, 0, 1);
                    const turn =
                        TURN_RATE * (1 + closeT * closeT * (CLOSE_TURN_MULT - 1));

                    if (flightAge < BOOST_SECONDS) {
                        // Keep the ground-toward-camera heading for a beat
                        this.velDir.copy(p.vel);
                        if (this.velDir.lengthSq() < 1e-8) this.velDir.copy(this.launchDir);
                        else this.velDir.normalize();
                        p.vel.copy(this.velDir).multiplyScalar(p.speed);
                    } else {
                        this.desired.subVectors(target, p.pos);
                        if (this.desired.lengthSq() < 1e-8) this.desired.set(0, 1, 0);
                        else this.desired.normalize();

                        this.velDir.copy(p.vel);
                        if (this.velDir.lengthSq() < 1e-8) this.velDir.set(0, 1, 0);
                        else this.velDir.normalize();

                        steerDirection(this.velDir, this.desired, turn * dtSeconds);
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

            // Counter sizeAttenuation near the camera + shrink into the portrait
            const distCam = p.pos.distanceTo(camera.position);
            const camScale = MathUtils.clamp(distCam / SOUL_REF_CAM_DIST, 0.08, 1.35);
            const toTarget = p.flying ? p.pos.distanceTo(target) : CLOSE_TURN_DIST;
            const approach = MathUtils.clamp(toTarget / CLOSE_TURN_DIST, 0.1, 1);
            const sizeMul = camScale * (0.35 + 0.65 * approach);
            const base = p.meshScale * SOUL_SPRITE_MULT[p.tier] * appear * sizeMul;
            p.sprite.scale.set(base * 0.65, base, 1);
            // Soft shimmer — additive glow breathes without going opaque.
            const shimmer = 0.85 + 0.15 * Math.sin(this.elapsed * 9 + p.index * 1.3);
            const mat = p.sprite.material as SpriteMaterial;
            mat.opacity =
                (SOUL_OPACITY_WAIT + (SOUL_OPACITY_FLY - SOUL_OPACITY_WAIT) * appear) *
                shimmer;
            // Sprites auto-face camera; slight spin for life
            mat.rotation = Math.sin(this.elapsed * 2.2 + p.index) * 0.12;

            if (p.meshGhost) {
                const showGhost = approach > GHOST_HIDE_APPROACH;
                p.meshGhost.visible = showGhost;
                if (showGhost) {
                    // Mesh origin is at the feet — same pose as the living unit
                    p.meshGhost.position.copy(p.pos);
                    p.meshGhost.rotation.set(0, p.yaw, 0);
                    p.meshGhost.scale.setScalar(p.meshScale * sizeMul);
                }
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

/** Center of a fightbar portrait in 0..1 view coords (origin top-left), or null. */
function portraitScreenNorm(
    selector: string,
    viewW: number,
    viewH: number,
): { x: number; y: number } | null {
    const el = document.querySelector(selector);
    if (!el || viewW <= 0 || viewH <= 0) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    // Match the WebGL canvas when present so NDC lines up with the 3D view
    const canvas = document.querySelector('canvas');
    const wr = canvas?.getBoundingClientRect();
    const originX = wr?.left ?? 0;
    const originY = wr?.top ?? 0;
    const width = wr && wr.width > 1 ? wr.width : viewW;
    const height = wr && wr.height > 1 ? wr.height : viewH;
    const x = (r.left + r.width * 0.5 - originX) / width;
    const y = (r.top + r.height * 0.5 - originY) / height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
        x: MathUtils.clamp(x, 0.01, 0.99),
        y: MathUtils.clamp(y, 0.01, 0.99),
    };
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
