import {
    DynamicDrawUsage,
    IcosahedronGeometry,
    InstancedMesh,
    MathUtils,
    Matrix4,
    MeshBasicMaterial,
    PerspectiveCamera,
    Quaternion,
    Raycaster,
    SphereGeometry,
    Vector2,
    Vector3,
    type Scene,
} from 'three';
import type { HpDrawScheduledParticle } from './hpDraw';
import type { HpDrawWaveTier } from './units';

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
/** Base mesh radius; tier scale applies 1× / 2× / 4× on top. */
const BASE_MESH_RADIUS = 0.34;
/** Scale = tierSize × clamp(CAM_SCALE_REF / distanceToCamera, min, max). */
const CAM_SCALE_REF = 62;
const CAM_SCALE_MIN = 0.72;
const CAM_SCALE_MAX = 2.35;

/** Normalized screen coords — top corners where HUD HP cards sit. */
const HP_CORNER_SCREEN = {
    player: { x: 0.13, y: 0.055 },
    enemy: { x: 0.87, y: 0.055 },
} as const;

const PARTICLE_COLOR = 0xffe08a;

const TIER_SCALE: Record<HpDrawWaveTier, number> = {
    low: 1,
    medium: 2,
    high: 4,
};

type LiveProjectile = HpDrawScheduledParticle & {
    start: Vector3;
    /** Current world position — advanced along velocity, never snapped. */
    pos: Vector3;
    /** Current flight velocity (direction × speed). */
    vel: Vector3;
    launchTime: number;
    /** World units per second — set once at launch. */
    speed: number;
    flying: boolean;
    hit: boolean;
};

export type HpDrawHitEvent = {
    victim: 'player' | 'enemy';
    damage: number;
    tier: HpDrawWaveTier;
};

/**
 * Free-flying 3D orbs from surviving mechs toward the viewport HP-bar corners.
 * The corner target tracks the camera each frame; particle positions move
 * incrementally and never jump when the camera pans.
 */
export class HpDrawFx {
    private readonly pools: Record<HpDrawWaveTier, InstancedMesh>;
    private readonly matrix = new Matrix4();
    private readonly dir = new Vector3();
    private readonly desired = new Vector3();
    private readonly velDir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly scale = new Vector3();
    private readonly raycaster = new Raycaster();
    private readonly ndc = new Vector2();
    private readonly cornerPlayer = new Vector3();
    private readonly cornerEnemy = new Vector3();
    private readonly camPos = new Vector3();
    private particles: LiveProjectile[] = [];
    private elapsed = 0;

    constructor(scene: Scene) {
        const makePool = (color: number) => {
            const mesh = new InstancedMesh(
                new SphereGeometry(BASE_MESH_RADIUS, 7, 6),
                new MeshBasicMaterial({ color }),
                MAX_HP_DRAW,
            );
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.renderOrder = 12;
            mesh.count = 0;
            scene.add(mesh);
            return mesh;
        };
        this.pools = {
            low: makePool(PARTICLE_COLOR),
            medium: makePool(PARTICLE_COLOR),
            high: new InstancedMesh(
                new IcosahedronGeometry(BASE_MESH_RADIUS, 1),
                new MeshBasicMaterial({ color: PARTICLE_COLOR }),
                MAX_HP_DRAW,
            ),
        };
        this.pools.high.instanceMatrix.setUsage(DynamicDrawUsage);
        this.pools.high.frustumCulled = false;
        this.pools.high.renderOrder = 12;
        this.pools.high.count = 0;
        scene.add(this.pools.high);
    }

    start(scheduled: readonly HpDrawScheduledParticle[]): void {
        this.clear();
        this.elapsed = 0;
        for (const p of scheduled) {
            const start = new Vector3(p.x, p.y, p.z);
            this.particles.push({
                ...p,
                start,
                pos: start.clone(),
                vel: new Vector3(),
                launchTime: p.hitTime - p.flightDuration,
                speed: 0,
                flying: false,
                hit: false,
            });
        }
    }

    /**
     * Advance flight. Corner targets refresh every frame; each particle climbs
     * vertically then homes in with limited turn rate (missile-style).
     */
    update(
        dtSeconds: number,
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
    ): HpDrawHitEvent[] {
        this.elapsed += dtSeconds;
        camera.updateMatrixWorld();
        camera.getWorldPosition(this.camPos);

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

        const counts: Record<HpDrawWaveTier, number> = { low: 0, medium: 0, high: 0 };
        const hits: HpDrawHitEvent[] = [];

        for (const p of this.particles) {
            const size = TIER_SCALE[p.tier];
            let alphaScale = 1;
            const target = p.victim === 'player' ? this.cornerPlayer : this.cornerEnemy;

            if (this.elapsed < p.launchTime) {
                const waitDur = Math.max(p.launchTime, 0.001);
                const waitT = Math.min(1, this.elapsed / waitDur);
                alphaScale = 0.4 + waitT * 0.6;
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

                alphaScale = 1;
                const dist = p.pos.distanceTo(target);

                if (
                    !p.hit &&
                    (dist <= HIT_RADIUS || this.elapsed >= p.hitTime + HIT_GRACE_SECONDS)
                ) {
                    p.hit = true;
                    hits.push({ victim: p.victim, damage: p.damage, tier: p.tier });
                } else if (!p.hit) {
                    if (flightAge < BOOST_SECONDS) {
                        // Launch boost — climb before turning toward the HP bar.
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

            if (p.hit) continue;

            if (p.flying && p.vel.lengthSq() > 1e-8) this.dir.copy(p.vel).normalize();
            else this.dir.set(0, 1, 0);
            this.quat.setFromUnitVectors(this.fwd, this.dir);

            const camDist = Math.max(p.pos.distanceTo(this.camPos), 1);
            const distScale = MathUtils.clamp(CAM_SCALE_REF / camDist, CAM_SCALE_MIN, CAM_SCALE_MAX);
            const s = size * alphaScale * distScale;
            this.scale.set(s, s, s);
            this.matrix.compose(p.pos, this.quat, this.scale);

            const tier = p.tier;
            const idx = counts[tier]++;
            this.pools[tier].setMatrixAt(idx, this.matrix);
        }

        for (const tier of Object.keys(this.pools) as HpDrawWaveTier[]) {
            const mesh = this.pools[tier];
            mesh.count = counts[tier];
            mesh.instanceMatrix.needsUpdate = true;
        }

        return hits;
    }

    clear(): void {
        this.particles = [];
        this.elapsed = 0;
        for (const mesh of Object.values(this.pools)) mesh.count = 0;
    }

    destroy(): void {
        this.clear();
        for (const mesh of Object.values(this.pools)) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) for (const m of mat) m.dispose();
            else mat.dispose();
        }
    }
}

/** Rotate `current` toward `desired` by at most `maxRad` radians (in-place). */
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
