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
    /** Negative = center the stroke below the baked rest pose (more downstroke). */
    uFlapBias: { value: number };
    /** Shoulder motion as a fraction of tip motion (small, not zero). */
    uTipFloor: { value: number };
    /** Curve exponent — lower = mid-wing moves more; higher = tip-only whip. */
    uTipPower: { value: number };
}

const materialUniforms = new WeakMap<MeshStandardMaterial, WingUniforms>();
const attached = new WeakSet<MeshStandardMaterial>();

/** Per-pool instanced wing attributes (phase + speed + rest pose). */
const phaseAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();
const rateAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();
const restAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();
const rollAttributes = new WeakMap<InstancedMesh, InstancedBufferAttribute>();

const WING_PHASE = 'aWingPhase';
const WING_RATE = 'aWingRate';
const WING_REST = 'aWingRest';
const WING_BODY_ROLL = 'aWingBodyRoll';

/** Hovering in air — fraction of full {@link CROW_WING_FLY_RATE}. */
export const CROW_WING_HOVER_RATE = 0.25;
/** Full flap while moving in air. */
export const CROW_WING_FLY_RATE = 0.5;
/** Ground / not airborne below this flight-lift fraction. */
export const CROW_WING_AIR_MIN = 0.06;
/** Extra fold after span reorient — main lay is the ±90° span twist keyed to body roll. */
export const CROW_WING_LAY_REST = 0.85;

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

/** Fixed wing angle offset (0 = model rest; {@link CROW_WING_LAY_REST} = splayed on ground). */
export function setCrowWingRestOnProxy(proxy: { userData: Record<string, unknown> }, rest: number): void {
    proxy.userData.wingRest = rest;
}

/** 0→1 splay progress for an in-flight crash or ground tip. */
export function crowWingDeathSplay(
    renderTime: number,
    fall?: { startAt: number; dur: number },
    tip?: { startAt: number; dur: number },
): number {
    const state = fall ?? tip;
    if (!state) return 1;
    if (state.startAt < 0) return 0;
    return Math.min(1, (renderTime - state.startAt) / state.dur);
}

/** Stop flapping and splay wings for a corpse (splay 0..1). */
export function setCrowWingDeathSplay(proxy: { userData: Record<string, unknown> }, splay: number): void {
    setCrowWingRateOnProxy(proxy, 0);
    setCrowWingRestOnProxy(proxy, CROW_WING_LAY_REST * Math.min(1, Math.max(0, splay)));
}

/** Stop all crow-rider wing motion (battle end, souls phase — like deployment). */
export function freezeAllCrowWingRates(
    units: Iterable<{ members: { mesh: Group }[]; type: { modelId?: string; id: string } }>,
): void {
    for (const unit of units) {
        if ((unit.type.modelId ?? unit.type.id) !== CROW_RIDER_MODEL_ID) continue;
        for (const m of unit.members) {
            if (m.mesh.userData.dead) continue;
            setCrowWingRateOnProxy(m.mesh, 0);
            setCrowWingRestOnProxy(m.mesh, 0);
        }
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
        uFlapBias: { value: params.flapBias },
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
attribute float ${WING_REST};
attribute float ${WING_BODY_ROLL};
uniform float uWingTime;
uniform float uWingPivotR;
uniform float uWingPivotY;
uniform float uWingInnerR;
uniform float uWingOuterR;
uniform float uWingMinY;
uniform float uWingMaxY;
uniform float uFlapAmp;
uniform float uFlapSpeed;
uniform float uFlapBias;
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
  vec3 rel = transformed - pivot;
  float dead = step(0.001, ${WING_REST});
  float rest = ${WING_REST} * tipWeight;
  // Bias shifts the stroke center below the baked rest pose so tips dip more than they rise.
  float flapAnim =
    (sin(uWingTime * uFlapSpeed + ${WING_PHASE}) * uFlapAmp + uFlapBias) *
    tipWeight * wingSide * ${WING_RATE};
  // Living: flap in XY (local Z rot).
  float cz0 = cos(flapAnim);
  float sz0 = sin(flapAnim);
  vec3 bentAlive = vec3(cz0 * rel.x - sz0 * rel.y, sz0 * rel.x + cz0 * rel.y, rel.z);
  // Dead: wingspan is ±X — body death roll (local Z) swings X toward world up.
  // Pre-rotate span toward local −Y (±90° scaled by roll) so tips land on the lawn.
  float rollN = clamp(-${WING_BODY_ROLL} / 1.2, -1.0, 1.0);
  float spanZ = rollN * 1.5707963;
  float cz1 = cos(spanZ);
  float sz1 = sin(spanZ);
  vec3 r1 = vec3(cz1 * rel.x - sz1 * rel.y, sz1 * rel.x + cz1 * rel.y, rel.z);
  float foldX = -rest * abs(rollN);
  float cx = cos(foldX);
  float sx = sin(foldX);
  vec3 bentDead = vec3(r1.x, cx * r1.y - sx * r1.z, sx * r1.y + cx * r1.z);
  vec3 bent = mix(bentAlive, bentDead, dead);
  transformed = mix(transformed, pivot + bent, wingMask);
}
#endif
`,
        );
    };

    material.customProgramCacheKey = function () {
        return (prevKey ? prevKey.call(this) : '') + '|crow-wing-flap-v14';
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

    const rests = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    rests.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute(WING_REST, rests);
    restAttributes.set(mesh, rests);

    const rolls = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    rolls.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute(WING_BODY_ROLL, rolls);
    rollAttributes.set(mesh, rolls);
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

export function setCrowWingRest(mesh: InstancedMesh, index: number, rest: number): void {
    const attr = restAttributes.get(mesh);
    if (!attr) return;
    attr.setX(index, rest);
    attr.needsUpdate = true;
}

export function setCrowWingBodyRoll(mesh: InstancedMesh, index: number, roll: number): void {
    const attr = rollAttributes.get(mesh);
    if (!attr) return;
    attr.setX(index, roll);
    attr.needsUpdate = true;
}

export function swapCrowWingRate(mesh: InstancedMesh, from: number, to: number): void {
    const attr = rateAttributes.get(mesh);
    if (!attr) return;
    attr.setX(to, attr.getX(from));
    attr.needsUpdate = true;
}

export function swapCrowWingRest(mesh: InstancedMesh, from: number, to: number): void {
    const attr = restAttributes.get(mesh);
    if (!attr) return;
    attr.setX(to, attr.getX(from));
    attr.needsUpdate = true;
}

export function swapCrowWingBodyRoll(mesh: InstancedMesh, from: number, to: number): void {
    const attr = rollAttributes.get(mesh);
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
    flapBias: number;
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
        flapAmp: 0.88,
        flapSpeed: 10.5,
        // Model rest is already fairly high — bias down so the outer wing dips ~as far as it rises.
        flapBias: -0.28,
        // mix(floor, 1, pow(t, power)) — more mid-wing, softer tips (lower amp + gentler power).
        tipFloor: 0.36,
        tipPower: 1.32,
    };
}
