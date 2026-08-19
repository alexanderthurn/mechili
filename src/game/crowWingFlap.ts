import {
    BufferGeometry,
    DynamicDrawUsage,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshStandardMaterial,
} from 'three';

export const CROW_RIDER_MODEL_ID = 'crowRider';

/** Shared clock for all crow-rider wing pools. */
const wingTimeUniform = { value: 0 };

interface WingUniforms {
    uWingTime: { value: number };
    uWingPivotR: { value: number };
    uWingPivotY: { value: number };
    uWingInnerR: { value: number };
    uWingOuterR: { value: number };
    uWingMinY: { value: number };
    uWingMaxY: { value: number };
    uFlapAmp: { value: number };
    uFlapSpeed: { value: number };
    /** Shoulder motion as a fraction of tip motion (small, not zero). */
    uTipFloor: { value: number };
    /** Curve exponent — lower = mid-wing moves more; higher = tip-only whip. */
    uTipPower: { value: number };
}

const materialUniforms = new WeakMap<MeshStandardMaterial, WingUniforms>();
const attached = new WeakSet<MeshStandardMaterial>();

/** Per-pool instanced wing attributes (phase + speed). */
const phaseAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();
const rateAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();

const WING_PHASE = 'aWingPhase';
const WING_RATE = 'aWingRate';

/** Hovering in air — fraction of full {@link CROW_WING_FLY_RATE}. */
export const CROW_WING_HOVER_RATE = 0.42;
/** Full flap while moving in air. */
export const CROW_WING_FLY_RATE = 1;
/** Ground / not airborne below this flight-lift fraction. */
export const CROW_WING_AIR_MIN = 0.06;

export interface CrowWingRateInput {
    dead?: boolean;
    inDeployment?: boolean;
    /** 0 on ground (deployment), 0→1 climb at battle start. */
    flightLift: number;
    /** Sim combat altitude (>0 = flyer in air layer). */
    altitude?: number;
    /** 0 still, ~1 at cruise speed (per-frame xz delta). */
    moving: number;
}

/** Per-instance flap speed multiplier (0 = rest pose, 1 = full cruise flap). */
export function computeCrowWingRate(input: CrowWingRateInput): number {
    if (input.dead) return 0;

    let airborne = input.flightLift;
    if (!input.inDeployment && (input.altitude ?? 0) > 0) {
        // Once the sim has the rider in the air layer, keep wings alive through the visual climb.
        airborne = Math.max(airborne, 0.28);
    }
    if (airborne < CROW_WING_AIR_MIN) return 0;

    const move = Math.min(1, Math.max(0, input.moving));
    const base = CROW_WING_HOVER_RATE + (CROW_WING_FLY_RATE - CROW_WING_HOVER_RATE) * move;
    return base * Math.min(1, airborne);
}

/** Store rate on the instanced proxy — picked up by {@link UnitInstanceRenderer.sync}. */
export function setCrowWingRateOnProxy(proxy: { userData: Record<string, unknown> }, rate: number): void {
    proxy.userData.wingFlapRate = rate;
}

/** Stop all crow-rider wing motion (battle end, souls phase — like deployment). */
export function freezeAllCrowWingRates(
    units: Iterable<{ members: { mesh: Group }[]; type: { modelId?: string; id: string } }>,
): void {
    for (const unit of units) {
        if ((unit.type.modelId ?? unit.type.id) !== CROW_RIDER_MODEL_ID) continue;
        for (const m of unit.members) setCrowWingRateOnProxy(m.mesh, 0);
    }
}

/** Advance the global wing clock — pass sim-scaled dt (gameDt), not raw frame dt. */
export function updateCrowWingFlap(dtSeconds: number): void {
    wingTimeUniform.value += dtSeconds;
}

export function markCrowWingFlapMaterial(material: MeshStandardMaterial): void {
    material.userData.wantsCrowWingFlap = true;
}

/** Re-hook after `material.clone()` — Three drops onBeforeCompile on clone. */
export function preserveCrowWingFlap(src: MeshStandardMaterial, dst: MeshStandardMaterial): void {
    if (src.userData.wantsCrowWingFlap || attached.has(src)) {
        dst.userData.wantsCrowWingFlap = true;
    }
}

/**
 * Inject a vertex-shader wing flap into MeshStandardMaterial. Uses radial
 * distance + height to mask wing verts in baked model space.
 */
export function attachCrowWingFlap(material: MeshStandardMaterial, geometry: BufferGeometry): void {
    if (attached.has(material)) return;
    attached.add(material);
    material.userData.wantsCrowWingFlap = true;

    const params = measureWingParams(geometry);
    const uniforms: WingUniforms = {
        uWingTime: wingTimeUniform,
        uWingPivotR: { value: params.pivotR },
        uWingPivotY: { value: params.pivotY },
        uWingInnerR: { value: params.innerR },
        uWingOuterR: { value: params.outerR },
        uWingMinY: { value: params.minY },
        uWingMaxY: { value: params.maxY },
        uFlapAmp: { value: params.flapAmp },
        uFlapSpeed: { value: params.flapSpeed },
        uTipFloor: { value: params.tipFloor },
        uTipPower: { value: params.tipPower },
    };
    materialUniforms.set(material, uniforms);

    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader =
            `attribute float ${WING_PHASE};
attribute float ${WING_RATE};
uniform float uWingTime;
uniform float uWingPivotR;
uniform float uWingPivotY;
uniform float uWingInnerR;
uniform float uWingOuterR;
uniform float uWingMinY;
uniform float uWingMaxY;
uniform float uFlapAmp;
uniform float uFlapSpeed;
uniform float uTipFloor;
uniform float uTipPower;
` +
            shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec2 xz = transformed.xz;
  float dist = length(xz);
  float wingMask =
    smoothstep(uWingInnerR, uWingInnerR + 0.025, dist) *
    smoothstep(uWingMinY, uWingMinY + 0.04, transformed.y) *
    (1.0 - smoothstep(uWingMaxY - 0.04, uWingMaxY, transformed.y));
  // Pivot at body center — flap amplitude ramps up toward the tips.
  vec3 pivot = vec3(0.0, uWingPivotY, 0.0);
  float tipT = smoothstep(uWingInnerR, uWingOuterR, dist);
  float tipWeight = mix(uTipFloor, 1.0, pow(tipT, uTipPower));
  // Mirror flap sign so both wings move up/down together (Z-rot is mirrored on −X).
  float wingSide = transformed.x >= 0.0 ? 1.0 : -1.0;
  float flap = sin(uWingTime * uFlapSpeed + ${WING_PHASE}) * uFlapAmp * tipWeight * wingSide * ${WING_RATE};
  vec3 rel = transformed - pivot;
  float cz = cos(flap);
  float sz = sin(flap);
  vec3 bent = pivot + vec3(cz * rel.x - sz * rel.y, sz * rel.x + cz * rel.y, rel.z);
  transformed = mix(transformed, bent, wingMask);
}
#endif
`,
        );
    };

    material.customProgramCacheKey = function () {
        return (prevKey ? prevKey.call(this) : '') + '|crow-wing-flap-v9';
    };
    material.needsUpdate = true;
}

/** Add per-instance wing phase + rate attributes to a crow-rider InstancedMesh. */
export function setupCrowWingInstanceAttributes(mesh: InstancedMesh, capacity: number): void {
    const phases = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    phases.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute(WING_PHASE, phases);
    phaseAttributes.set(mesh, phases);

    const rates = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    rates.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute(WING_RATE, rates);
    rateAttributes.set(mesh, rates);
}

/** @deprecated use {@link setupCrowWingInstanceAttributes} */
export function setupCrowWingPhaseAttribute(mesh: InstancedMesh, capacity: number): void {
    setupCrowWingInstanceAttributes(mesh, capacity);
}

export function setCrowWingPhase(mesh: InstancedMesh, index: number, phase: number): void {
    const attr = phaseAttributes.get(mesh);
    if (!attr) return;
    attr.setX(index, phase);
    attr.needsUpdate = true;
}

export function setCrowWingRate(mesh: InstancedMesh, index: number, rate: number): void {
    const attr = rateAttributes.get(mesh);
    if (!attr) return;
    attr.setX(index, rate);
    attr.needsUpdate = true;
}

export function swapCrowWingRate(mesh: InstancedMesh, from: number, to: number): void {
    const attr = rateAttributes.get(mesh);
    if (!attr) return;
    attr.setX(to, attr.getX(from));
    attr.needsUpdate = true;
}

export function swapCrowWingPhase(mesh: InstancedMesh, from: number, to: number): void {
    const attr = phaseAttributes.get(mesh);
    if (!attr) return;
    attr.setX(to, attr.getX(from));
    attr.needsUpdate = true;
}

export function randomWingPhase(): number {
    return Math.random() * Math.PI * 2;
}

interface WingParams {
    pivotR: number;
    pivotY: number;
    innerR: number;
    outerR: number;
    minY: number;
    maxY: number;
    flapAmp: number;
    flapSpeed: number;
    tipFloor: number;
    tipPower: number;
}

/** Derive wing-mask radii from baked geometry (feet at y≈0, forward −Z). */
function measureWingParams(geometry: BufferGeometry): WingParams {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const b = geometry.boundingBox!;
    const pos = geometry.getAttribute('position');
    const cx = (b.min.x + b.max.x) * 0.5;
    const cz = (b.min.z + b.max.z) * 0.5;
    const height = Math.max(b.max.y - b.min.y, 0.05);
    const minY = b.min.y + height * 0.22;
    const maxY = b.max.y - height * 0.04;

    let outerR = 0;
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < minY || y > maxY) continue;
        const dx = pos.getX(i) - cx;
        const dz = pos.getZ(i) - cz;
        outerR = Math.max(outerR, Math.hypot(dx, dz));
    }
    if (outerR < 0.05) outerR = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.45;

    // Hinge at body center — animate from ~6% of wingspan outward (excludes torso).
    const innerR = outerR * 0.22;
    const pivotR = 0;
    const pivotY = b.min.y + height * 0.44;

    return {
        pivotR,
        pivotY,
        innerR,
        outerR: outerR * 0.98,
        minY,
        maxY,
        flapAmp: 0.58,
        flapSpeed: 10.5,
        // mix(floor, 1, pow(t, power)) — more mid-wing, softer tips (lower amp + gentler power).
        tipFloor: 0.16,
        tipPower: 1.32,
    };
}
