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
import { groundSupportAt } from './map';
import type { FireVfxQuality } from './prefs';

/** allocate once at the high-tier ceiling so tier switches don't rebuild the mesh */
const POOL_MAX = 2048;

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

/**
 * AAA ground fire: camera-facing flame tongues rendered as ONE instanced
 * draw call with a procedural noise shader. Purely visual — sim fire cells
 * / oil hitboxes are unchanged by quality tier.
 */
export class FlameRenderer {
    private readonly mesh: InstancedMesh;
    private readonly material: ShaderMaterial;
    private readonly phases: InstancedBufferAttribute;
    private readonly dummy = new Object3D();
    private time = 0;
    private tier: FlameTier = TIER.medium;

    constructor(scene: Scene) {
        // slightly larger base quad → softer silhouette when scaled up
        const geometry = new PlaneGeometry(1.25, 1.25, 1, 1).translate(0, 0.55, 0);
        this.phases = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        geometry.setAttribute('aPhase', this.phases);

        this.material = new ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                attribute float aPhase;
                varying vec2 vUv;
                varying float vPhase;
                void main() {
                    vUv = uv;
                    vPhase = aPhase;
                    vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    float sx = length(vec3(instanceMatrix[0]));
                    float sy = length(vec3(instanceMatrix[1]));
                    // Spherical billboard: always face the camera.
                    // Cylindrical (upright-only) looked great from the side but
                    // collapsed to thin lines when the camera looked top-down.
                    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                    vec3 world = origin.xyz + camRight * position.x * sx + camUp * position.y * sy;
                    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                varying vec2 vUv;
                varying float vPhase;
                float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float fNoise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x),
                               mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                void main() {
                    float t = uTime * 2.4 + vPhase * 19.0;
                    vec2 nUv = vec2(vUv.x * 2.2 + vPhase * 3.1, vUv.y * 2.8 - t);
                    float n = fNoise(nUv) * 0.65 + fNoise(nUv * 2.7 + 13.7) * 0.35;
                    float cx = vUv.x - 0.5 + (n - 0.5) * 0.45 * vUv.y;
                    float halfW = mix(0.36, 0.06, vUv.y);
                    float body = smoothstep(halfW, halfW * 0.25, abs(cx));
                    body *= smoothstep(1.1, 0.62, vUv.y + (n - 0.5) * 0.34);
                    body *= smoothstep(0.0, 0.18, vUv.y);
                    // gentler flicker — was reading as hitchy next to cell popping
                    float flick = 0.88 + 0.12 * sin(uTime * 9.0 + vPhase * 41.0);
                    float a = body * flick;
                    if (a < 0.025) discard;
                    float core = smoothstep(halfW * 0.9, 0.0, abs(cx)) * (1.0 - vUv.y * 0.5);
                    vec3 col = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.5, 0.07), body);
                    col = mix(col, vec3(1.0, 0.9, 0.55), core * core);
                    gl_FragColor = vec4(col * 1.65, a);
                }
            `,
        });

        this.mesh = new InstancedMesh(geometry, this.material, POOL_MAX);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    setQuality(q: FireVfxQuality): void {
        if (q === 'high' || q === 'medium') {
            this.tier = TIER[q];
            this.mesh.visible = true;
        } else {
            this.mesh.visible = false;
            this.mesh.count = 0;
        }
    }

    update(dt: number, field: HazardField | null, now: number): void {
        this.time += dt;
        this.material.uniforms.uTime!.value = this.time;
        if (!field || !this.mesh.visible) {
            this.mesh.count = 0;
            return;
        }
        let total = 0;
        field.forEachFireCell(now, () => total++);
        if (total === 0) {
            this.mesh.count = 0;
            return;
        }

        const { maxTongues, lushCellCap, lushTongues, denseTongues, sizeScale } = this.tier;
        // Priority: every fire cell gets ≥1 tongue so the puddle is fully filled.
        // Extra tongues per cell only when the budget still covers the whole blaze.
        const wantPerCell = total <= lushCellCap ? lushTongues : denseTongues;
        let tonguesPerCell = 1;
        let stride = 1;
        if (total <= maxTongues) {
            tonguesPerCell = Math.min(wantPerCell, Math.max(1, Math.floor(maxTongues / total)));
        } else {
            // Extremely large blaze: thin cells, but grow tongues to bridge gaps
            // (hazard cells are 2wu — scale width ~with stride so neighbors overlap).
            stride = Math.ceil(total / maxTongues);
        }
        const fillBoost = stride > 1 ? stride * 1.15 : 1;
        let i = 0;
        let n = 0;
        field.forEachFireCell(now, (x, z, dps, until) => {
            if (n >= maxTongues) return;
            if (i++ % stride !== 0) return;
            const dying = Math.min(1, (until - now) / 1.2);
            for (let t = 0; t < tonguesPerCell && n < maxTongues; t++) {
                const h =
                    Math.abs(Math.sin(x * 12.9898 + z * 78.233 + t * 19.19) * 43758.5453) % 1;
                const size =
                    (1.85 + h * 1.35 + Math.min(1, dps / 20) * 0.85) * dying * sizeScale * fillBoost;
                // Keep height short; widen more when fillBoost grows so the sheet closes gaps
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
                n++;
            }
        });
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.phases.needsUpdate = true;
    }

    clear(): void {
        this.mesh.count = 0;
    }

    dispose(): void {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
