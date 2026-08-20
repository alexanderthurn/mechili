import {
    AdditiveBlending,
    InstancedBufferAttribute,
    InstancedMesh,
    Object3D,
    PlaneGeometry,
    ShaderMaterial,
    type Scene,
} from 'three';
import type { HazardField } from './fire';
import { FIRE_TINT_DRAGON } from './fire';
import { groundSupportAt } from './map';
import type { FireVfxQuality } from './prefs';

/** allocate once at the high-tier ceiling so tier switches don't rebuild the mesh */
const POOL_MAX = 2048;
/** max world anchors from dragon breath (× tongues-per-anchor below) */
const BREATH_ANCHOR_MAX = 360;
/** billboards per breath anchor */
const BREATH_TONGUES_PER = 3;
const BREATH_POOL = BREATH_ANCHOR_MAX * BREATH_TONGUES_PER;
/** Breath tongue billboard size vs ground tongues */
const BREATH_SIZE_MUL = 2.1;
/** Breath flicker / noise clock vs ground (1 = same) */
const BREATH_ANIM_SPEED = 0.025;

/** World-space flame anchors along the dragon breath tube (scenery high/ultra). */
export type BreathTongueSample = { x: number; y: number; z: number };

type FlameTier = {
    /** hard cap on active tongue instances this frame */
    maxTongues: number;
    /** fire-cell count at/below which we stack multiple tongues per cell */
    lushCellCap: number;
    /** max tongues per cell while lush (only if budget allows full coverage) */
    lushTongues: number;
    /** max tongues per cell on larger blazes (only if budget allows full coverage) */
    denseTongues: number;
    /** world-scale multiplier for tongue width/height (visual only) */
    sizeScale: number;
};

const TIER: Record<'high' | 'medium', FlameTier> = {
    medium: {
        maxTongues: 1024,
        lushCellCap: 56,
        lushTongues: 3,
        denseTongues: 2,
        sizeScale: 1.35,
    },
    high: {
        maxTongues: 2048,
        lushCellCap: 96,
        lushTongues: 4,
        denseTongues: 2,
        sizeScale: 1.55,
    },
};

const FLAME_VERT = /* glsl */ `
    attribute float aPhase;
    attribute float aTint;
    attribute float aSpeed;
    varying vec2 vUv;
    varying float vPhase;
    varying float vTint;
    varying float vSpeed;
    void main() {
        vUv = uv;
        vPhase = aPhase;
        vTint = aTint;
        vSpeed = aSpeed;
        vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(vec3(instanceMatrix[0]));
        float sy = length(vec3(instanceMatrix[1]));
        // Spherical billboard: always face the camera.
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = origin.xyz + camRight * position.x * sx + camUp * position.y * sy;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`;

const FLAME_FRAG_ADDITIVE = /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying float vPhase;
    varying float vTint;
    varying float vSpeed;
    float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float fNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x),
                   mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    void main() {
        float t = uTime * 2.4 * vSpeed + vPhase * 19.0;
        vec2 nUv = vec2(vUv.x * 2.2 + vPhase * 3.1, vUv.y * 2.8 - t);
        float n = fNoise(nUv) * 0.65 + fNoise(nUv * 2.7 + 13.7) * 0.35;
        float cx = vUv.x - 0.5 + (n - 0.5) * 0.45 * vUv.y;
        float halfW = mix(0.36, 0.06, vUv.y);
        float body = smoothstep(halfW, halfW * 0.25, abs(cx));
        body *= smoothstep(1.1, 0.62, vUv.y + (n - 0.5) * 0.34);
        body *= smoothstep(0.0, 0.18, vUv.y);
        float flick = 0.88 + 0.12 * sin(uTime * 9.0 * vSpeed + vPhase * 41.0);
        float a = body * flick;
        if (a < 0.025) discard;
        float core = smoothstep(halfW * 0.9, 0.0, abs(cx)) * (1.0 - vUv.y * 0.5);
        vec3 orange = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.5, 0.07), body);
        orange = mix(orange, vec3(1.0, 0.9, 0.55), core * core);
        vec3 azure = mix(vec3(0.12, 0.1, 0.45), vec3(1.0, 0.48, 0.1), body);
        azure = mix(azure, vec3(1.0, 0.88, 0.5), core * core);
        azure = mix(azure, vec3(0.15, 0.2, 0.65), (1.0 - body) * 0.55);
        vec3 col = mix(orange, azure, vTint);
        gl_FragColor = vec4(col * 1.65, a);
    }
`;

/**
 * AAA ground fire + dragon-breath tongue pools (additive billboards).
 */
export class FlameRenderer {
    private readonly mesh: InstancedMesh;
    private readonly material: ShaderMaterial;
    private readonly phases: InstancedBufferAttribute;
    private readonly tints: InstancedBufferAttribute;
    private readonly speeds: InstancedBufferAttribute;

    private readonly breathMesh: InstancedMesh;
    private readonly breathMaterial: ShaderMaterial;
    private readonly breathPhases: InstancedBufferAttribute;
    private readonly breathTints: InstancedBufferAttribute;
    private readonly breathSpeeds: InstancedBufferAttribute;

    private readonly dummy = new Object3D();
    private time = 0;
    private tier: FlameTier = TIER.medium;
    private breathCount = 0;
    private readonly breathX = new Float32Array(BREATH_ANCHOR_MAX);
    private readonly breathY = new Float32Array(BREATH_ANCHOR_MAX);
    private readonly breathZ = new Float32Array(BREATH_ANCHOR_MAX);

    constructor(scene: Scene) {
        // slightly larger base quad → softer silhouette when scaled up
        const geometry = new PlaneGeometry(1.25, 1.25, 1, 1).translate(0, 0.55, 0);
        this.phases = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        this.tints = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        this.speeds = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        geometry.setAttribute('aPhase', this.phases);
        geometry.setAttribute('aTint', this.tints);
        geometry.setAttribute('aSpeed', this.speeds);

        this.material = new ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            fog: false,
            vertexShader: FLAME_VERT,
            fragmentShader: FLAME_FRAG_ADDITIVE,
        });

        this.mesh = new InstancedMesh(geometry, this.material, POOL_MAX);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);

        const breathGeo = new PlaneGeometry(1.25, 1.25, 1, 1).translate(0, 0.55, 0);
        this.breathPhases = new InstancedBufferAttribute(new Float32Array(BREATH_POOL), 1);
        this.breathTints = new InstancedBufferAttribute(new Float32Array(BREATH_POOL), 1);
        this.breathSpeeds = new InstancedBufferAttribute(new Float32Array(BREATH_POOL), 1);
        breathGeo.setAttribute('aPhase', this.breathPhases);
        breathGeo.setAttribute('aTint', this.breathTints);
        breathGeo.setAttribute('aSpeed', this.breathSpeeds);

        this.breathMaterial = new ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: AdditiveBlending,
            fog: false,
            vertexShader: FLAME_VERT,
            fragmentShader: FLAME_FRAG_ADDITIVE,
        });

        this.breathMesh = new InstancedMesh(breathGeo, this.breathMaterial, BREATH_POOL);
        this.breathMesh.frustumCulled = false;
        this.breathMesh.count = 0;
        this.breathMesh.renderOrder = 3;
        scene.add(this.breathMesh);
    }

    setQuality(q: FireVfxQuality): void {
        if (q === 'high' || q === 'medium') {
            this.tier = TIER[q];
            this.mesh.visible = true;
            this.breathMesh.visible = true;
        } else {
            this.mesh.visible = false;
            this.mesh.count = 0;
            this.breathMesh.visible = false;
            this.breathMesh.count = 0;
        }
    }

    /** Dragon breath column anchors for this frame (cleared when empty). */
    setBreathTongues(samples: readonly BreathTongueSample[]): void {
        const n = Math.min(samples.length, BREATH_ANCHOR_MAX);
        this.breathCount = n;
        for (let i = 0; i < n; i++) {
            const s = samples[i]!;
            this.breathX[i] = s.x;
            this.breathY[i] = s.y;
            this.breathZ[i] = s.z;
        }
    }

    clearBreathTongues(): void {
        this.breathCount = 0;
    }

    update(dt: number, field: HazardField | null, now: number): void {
        this.time += dt;
        this.material.uniforms.uTime!.value = this.time;
        this.breathMaterial.uniforms.uTime!.value = this.time;
        if (!this.mesh.visible) {
            this.mesh.count = 0;
            this.breathMesh.count = 0;
            return;
        }

        const { maxTongues, lushCellCap, lushTongues, denseTongues, sizeScale } = this.tier;
        let n = 0;

        if (field) {
            let total = 0;
            field.forEachFireCell(now, () => total++);
            if (total > 0) {
                const wantPerCell = total <= lushCellCap ? lushTongues : denseTongues;
                let tonguesPerCell = 1;
                let stride = 1;
                if (total <= maxTongues) {
                    tonguesPerCell = Math.min(wantPerCell, Math.max(1, Math.floor(maxTongues / total)));
                } else {
                    stride = Math.ceil(total / maxTongues);
                }
                const fillBoost = stride > 1 ? stride * 1.15 : 1;
                let i = 0;
                field.forEachFireCell(now, (x, z, dps, until, tint) => {
                    if (n >= maxTongues) return;
                    if (i++ % stride !== 0) return;
                    const dying = Math.min(1, (until - now) / 1.2);
                    const tintF = tint === FIRE_TINT_DRAGON ? 1 : 0;
                    for (let t = 0; t < tonguesPerCell && n < maxTongues; t++) {
                        const h =
                            Math.abs(Math.sin(x * 12.9898 + z * 78.233 + t * 19.19) * 43758.5453) %
                            1;
                        const size =
                            (1.85 + h * 1.35 + Math.min(1, dps / 20) * 0.85) *
                            dying *
                            sizeScale *
                            fillBoost;
                        const width = size * 0.85 * (stride > 1 ? 1.25 : 1);
                        const height = size * 0.3;
                        this.dummy.position.set(
                            x + (h - 0.5) * 1.5,
                            groundSupportAt(x, z) + 0.05,
                            z + ((((h * 7 + t * 3) % 1) - 0.5) * 1.5),
                        );
                        this.dummy.scale.set(width, height, 1);
                        this.dummy.updateMatrix();
                        this.mesh.setMatrixAt(n, this.dummy.matrix);
                        this.phases.setX(n, h * 10 + t);
                        this.tints.setX(n, tintF);
                        this.speeds.setX(n, 1);
                        n++;
                    }
                });
            }
        }

        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.phases.needsUpdate = true;
        this.tints.needsUpdate = true;
        this.speeds.needsUpdate = true;

        this.updateBreathTongues(sizeScale);
    }

    private updateBreathTongues(sizeScale: number): void {
        let n = 0;
        for (let i = 0; i < this.breathCount && n < BREATH_POOL; i++) {
            const x = this.breathX[i]!;
            const y = this.breathY[i]!;
            const z = this.breathZ[i]!;
            for (let t = 0; t < BREATH_TONGUES_PER && n < BREATH_POOL; t++) {
                const h =
                    Math.abs(Math.sin(x * 12.9898 + z * 78.233 + y * 3.1 + t * 19.19) * 43758.5453) %
                    1;
                const size = (1.7 + h * 1.2) * sizeScale * BREATH_SIZE_MUL;
                const width = size * 0.72;
                const height = size * 0.38;
                // Tiny local scatter so stacked billboards don’t form a hard sheet.
                this.dummy.position.set(
                    x + (h - 0.5) * 0.55,
                    y + (h - 0.4) * 0.25,
                    z + ((((h * 7 + t * 3) % 1) - 0.5) * 0.55),
                );
                this.dummy.scale.set(width, height, 1);
                this.dummy.updateMatrix();
                this.breathMesh.setMatrixAt(n, this.dummy.matrix);
                this.breathPhases.setX(n, h * 10 + t + 4);
                this.breathTints.setX(n, 0); // orange / yellow (azure tips read purple on the beam)
                this.breathSpeeds.setX(n, BREATH_ANIM_SPEED);
                n++;
            }
        }
        this.breathMesh.count = n;
        this.breathMesh.instanceMatrix.needsUpdate = true;
        this.breathPhases.needsUpdate = true;
        this.breathTints.needsUpdate = true;
        this.breathSpeeds.needsUpdate = true;
    }

    clear(): void {
        this.mesh.count = 0;
        this.breathMesh.count = 0;
        this.breathCount = 0;
    }

    /**
     * Force one visible tongue so WebGL compiles this ShaderMaterial during
     * boot / match start — otherwise the first mid-battle blaze pays the hitch.
     */
    primeForCompile(): void {
        this.mesh.visible = true;
        this.dummy.position.set(0, 1, 0);
        this.dummy.scale.set(1.2, 0.8, 1);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(0, this.dummy.matrix);
        this.phases.setX(0, 0);
        this.tints.setX(0, 0);
        this.speeds.setX(0, 1);
        this.mesh.count = 1;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.phases.needsUpdate = true;
        this.tints.needsUpdate = true;
        this.speeds.needsUpdate = true;

        this.breathMesh.visible = true;
        this.breathMesh.setMatrixAt(0, this.dummy.matrix);
        this.breathPhases.setX(0, 0);
        this.breathTints.setX(0, 1);
        this.breathSpeeds.setX(0, BREATH_ANIM_SPEED);
        this.breathMesh.count = 1;
        this.breathMesh.instanceMatrix.needsUpdate = true;
        this.breathPhases.needsUpdate = true;
        this.breathTints.needsUpdate = true;
        this.breathSpeeds.needsUpdate = true;
    }

    dispose(): void {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.breathMesh.removeFromParent();
        this.breathMesh.geometry.dispose();
        this.breathMaterial.dispose();
    }
}
