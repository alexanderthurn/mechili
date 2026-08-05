import {
    AdditiveBlending,
    Color,
    DynamicDrawUsage,
    InstancedMesh,
    MathUtils,
    Matrix4,
    PerspectiveCamera,
    Quaternion,
    Raycaster,
    ShaderMaterial,
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
/** Soft outer glow relative to the core sphere. */
const HALO_SCALE = 2.15;
/** Scale = tierSize × clamp(CAM_SCALE_REF / distanceToCamera, min, max). */
const CAM_SCALE_REF = 62;
const CAM_SCALE_MIN = 0.72;
const CAM_SCALE_MAX = 2.35;

/** Normalized screen coords — top corners where HUD HP cards sit. */
const HP_CORNER_SCREEN = {
    player: { x: 0.13, y: 0.055 },
    enemy: { x: 0.87, y: 0.055 },
} as const;

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
 * Additive fresnel orb — hot white core + gold rim (same look as wizard orbs,
 * retuned for HP-draw). Shared by every tier; size alone marks low/med/high.
 */
function makeCoreMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCore: { value: new Color(0xffffff) },
            uMid: { value: new Color(0xffe8a8) },
            uGlow: { value: new Color(0xffb040) },
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
                float pulse = 1.0 + 0.1 * sin(uTime * 10.0 + position.y * 5.0);
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
                float ndv = max(dot(normalize(vNormal), normalize(vView)), 0.0);
                float fresnel = pow(1.0 - ndv, 2.0);
                float spark = 0.5 + 0.5 * sin(uTime * 14.0 + fresnel * 12.0);
                vec3 col = mix(uCore, uMid, fresnel * 0.55 + spark * 0.15);
                col = mix(col, uGlow, fresnel * 0.85);
                // hot center stays opaque-bright; rim blooms soft
                float alpha = 0.55 + fresnel * 0.55 + 0.12 * spark;
                gl_FragColor = vec4(col * (1.25 + 0.3 * vPulse), alpha);
            }
        `,
    });
}

/** Soft additive halo — cheap bloom without a post-process pass. */
function makeHaloMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new Color(0xffc050) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            uniform float uTime;
            void main() {
                float pulse = 1.0 + 0.06 * sin(uTime * 7.0);
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
            uniform vec3 uColor;
            void main() {
                float ndv = max(dot(normalize(vNormal), normalize(vView)), 0.0);
                // soft shell — brighter at the rim, nearly clear in the center
                float rim = pow(1.0 - ndv, 1.6);
                float alpha = rim * 0.45;
                gl_FragColor = vec4(uColor * (0.7 + rim), alpha);
            }
        `,
    });
}

/**
 * Free-flying shiny 3D orbs from surviving mechs toward the viewport HP-bar
 * corners. Additive fresnel core + soft halo; size alone marks wave tier.
 */
export class HpDrawFx {
    private readonly core: InstancedMesh;
    private readonly halo: InstancedMesh;
    private readonly coreMat: ShaderMaterial;
    private readonly haloMat: ShaderMaterial;
    private readonly matrix = new Matrix4();
    private readonly haloMatrix = new Matrix4();
    private readonly dir = new Vector3();
    private readonly desired = new Vector3();
    private readonly velDir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly scale = new Vector3();
    private readonly haloScale = new Vector3();
    private readonly raycaster = new Raycaster();
    private readonly ndc = new Vector2();
    private readonly cornerPlayer = new Vector3();
    private readonly cornerEnemy = new Vector3();
    private readonly camPos = new Vector3();
    private particles: LiveProjectile[] = [];
    private elapsed = 0;

    constructor(scene: Scene) {
        const geo = new SphereGeometry(BASE_MESH_RADIUS, 14, 12);
        this.coreMat = makeCoreMaterial();
        this.haloMat = makeHaloMaterial();

        this.core = new InstancedMesh(geo, this.coreMat, MAX_HP_DRAW);
        this.core.instanceMatrix.setUsage(DynamicDrawUsage);
        this.core.frustumCulled = false;
        this.core.renderOrder = 13;
        this.core.count = 0;
        scene.add(this.core);

        this.halo = new InstancedMesh(geo, this.haloMat, MAX_HP_DRAW);
        this.halo.instanceMatrix.setUsage(DynamicDrawUsage);
        this.halo.frustumCulled = false;
        this.halo.renderOrder = 12;
        this.halo.count = 0;
        scene.add(this.halo);
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
        this.coreMat.uniforms.uTime!.value = this.elapsed;
        this.haloMat.uniforms.uTime!.value = this.elapsed;
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

        let count = 0;
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
            this.core.setMatrixAt(count, this.matrix);

            const hs = s * HALO_SCALE;
            this.haloScale.set(hs, hs, hs);
            this.haloMatrix.compose(p.pos, this.quat, this.haloScale);
            this.halo.setMatrixAt(count, this.haloMatrix);
            count++;
        }

        this.core.count = count;
        this.halo.count = count;
        this.core.instanceMatrix.needsUpdate = true;
        this.halo.instanceMatrix.needsUpdate = true;

        return hits;
    }

    /** True once every scheduled particle has hit (or there were none). */
    allHit(): boolean {
        return this.particles.length > 0 && this.particles.every((p) => p.hit);
    }

    clear(): void {
        this.particles = [];
        this.elapsed = 0;
        this.core.count = 0;
        this.halo.count = 0;
    }

    destroy(): void {
        this.clear();
        this.core.removeFromParent();
        this.halo.removeFromParent();
        this.core.geometry.dispose();
        // halo shares the same geometry instance — dispose once
        this.coreMat.dispose();
        this.haloMat.dispose();
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
