import {
    BufferGeometry,
    DynamicDrawUsage,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Mesh,
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
    /** Mesh-mode only (non-instanced). */
    uWingPhase?: { value: number };
    uWingRate?: { value: number };
    uWingRest?: { value: number };
    uWingBodyRoll?: { value: number };
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

/** Wings along ±X → flap with local Z rotation (crow). Wings along ±Z → X rotation (dragon, +X forward). */
export type WingFlapAxis = 'z' | 'x';

export interface WingParams {
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
    /** Fraction of outerR used as hinge (default 0.22). */
    innerRFrac?: number;
}

export interface WingFlapAttachOpts {
    /** Instanced units vs a single Mesh (spell FX). Default `instanced`. */
    mode?: 'instanced' | 'mesh';
    flapAxis?: WingFlapAxis;
    /** Override measured / default stroke params. */
    params?: Partial<WingParams>;
}

/** Dragon spell: +X forward, wings along ±Z. */
export const DRAGON_WING_FLAP: WingFlapAttachOpts = {
    mode: 'mesh',
    flapAxis: 'x',
    params: {
        flapAmp: 0.72,
        flapSpeed: 7.5,
        flapBias: -0.32,
        tipFloor: 0.28,
        tipPower: 1.2,
        innerRFrac: 0.18,
    },
};

/** Homepage / non-instanced crow preview — same stroke as battle crow defaults. */
export const CROW_SHOWCASE_WING_FLAP: WingFlapAttachOpts = {
    mode: 'mesh',
    flapAxis: 'z',
};

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
 * Crow riders: {@link attachCrowWingFlap}. Dragon spell: {@link DRAGON_WING_FLAP}.
 */
export function attachWingFlap(
    material: MeshStandardMaterial,
    geometry: BufferGeometry,
    opts: WingFlapAttachOpts = {},
): void {
    if (attached.has(material)) return;
    attached.add(material);
    material.userData.wantsCrowWingFlap = true;

    const mode = opts.mode ?? 'instanced';
    const flapAxis = opts.flapAxis ?? 'z';
    const params = measureWingParams(geometry, opts.params);
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
    if (mode === 'mesh') {
        uniforms.uWingPhase = { value: 0 };
        uniforms.uWingRate = { value: 1 };
        uniforms.uWingRest = { value: 0 };
        uniforms.uWingBodyRoll = { value: 0 };
    }
    materialUniforms.set(material, uniforms);

    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    const phaseExpr = mode === 'mesh' ? 'uWingPhase' : WING_PHASE;
    const rateExpr = mode === 'mesh' ? 'uWingRate' : WING_RATE;
    const restExpr = mode === 'mesh' ? 'uWingRest' : WING_REST;
    const rollExpr = mode === 'mesh' ? 'uWingBodyRoll' : WING_BODY_ROLL;
    const sideAxis = flapAxis === 'x' ? 'transformed.z' : 'transformed.x';
    // Z-axis flap: bend in XY (wings ±X). X-axis flap: bend in YZ (wings ±Z).
    const aliveBend =
        flapAxis === 'x'
            ? `vec3 bentAlive = vec3(rel.x, cz0 * rel.y - sz0 * rel.z, sz0 * rel.y + cz0 * rel.z);`
            : `vec3 bentAlive = vec3(cz0 * rel.x - sz0 * rel.y, sz0 * rel.x + cz0 * rel.y, rel.z);`;
    const deadBend =
        flapAxis === 'x'
            ? `// Mesh dragons don't tip-over; keep living flap pose when rest is set.
  vec3 bentDead = bentAlive;`
            : `float rollN = clamp(-${rollExpr} / 1.2, -1.0, 1.0);
  float spanZ = rollN * 1.5707963;
  float cz1 = cos(spanZ);
  float sz1 = sin(spanZ);
  vec3 r1 = vec3(cz1 * rel.x - sz1 * rel.y, sz1 * rel.x + cz1 * rel.y, rel.z);
  float foldX = -rest * abs(rollN);
  float cx = cos(foldX);
  float sx = sin(foldX);
  vec3 bentDead = vec3(r1.x, cx * r1.y - sx * r1.z, sx * r1.y + cx * r1.z);`;

    const attrOrUniformDecl =
        mode === 'mesh'
            ? `uniform float uWingPhase;
uniform float uWingRate;
uniform float uWingRest;
uniform float uWingBodyRoll;
`
            : `attribute float ${WING_PHASE};
attribute float ${WING_RATE};
attribute float ${WING_REST};
attribute float ${WING_BODY_ROLL};
`;

    const wrapBegin =
        mode === 'instanced'
            ? `#ifdef USE_INSTANCING
{
`
            : `{
`;
    const wrapEnd = mode === 'instanced' ? `}
#endif
` : `}
`;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader =
            attrOrUniformDecl +
            `uniform float uWingTime;
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
${wrapBegin}  vec2 xz = transformed.xz;
  float dist = length(xz);
  float wingMask =
    smoothstep(uWingInnerR, uWingInnerR + 0.025, dist) *
    smoothstep(uWingMinY, uWingMinY + 0.04, transformed.y) *
    (1.0 - smoothstep(uWingMaxY - 0.04, uWingMaxY, transformed.y));
  vec3 pivot = vec3(0.0, uWingPivotY, 0.0);
  float tipT = smoothstep(uWingInnerR, uWingOuterR, dist);
  float tipWeight = mix(uTipFloor, 1.0, pow(tipT, uTipPower));
  float wingSide = ${sideAxis} >= 0.0 ? 1.0 : -1.0;
  vec3 rel = transformed - pivot;
  float dead = step(0.001, ${restExpr});
  float rest = ${restExpr} * tipWeight;
  float flapAnim =
    (sin(uWingTime * uFlapSpeed + ${phaseExpr}) * uFlapAmp + uFlapBias) *
    tipWeight * wingSide * ${rateExpr};
  float cz0 = cos(flapAnim);
  float sz0 = sin(flapAnim);
  ${aliveBend}
  ${deadBend}
  vec3 bent = mix(bentAlive, bentDead, dead);
  transformed = mix(transformed, pivot + bent, wingMask);
${wrapEnd}`,
        );
    };

    material.customProgramCacheKey = function () {
        return (
            (prevKey ? prevKey.call(this) : '') +
            `|wing-flap-v15|${mode}|${flapAxis}`
        );
    };
    material.needsUpdate = true;
}

/** Crow-rider instanced path (unchanged call sites). */
export function attachCrowWingFlap(material: MeshStandardMaterial, geometry: BufferGeometry): void {
    attachWingFlap(material, geometry, { mode: 'instanced', flapAxis: 'z' });
}

/** Drive non-instanced flap (dragon). No-op if material was not attached in mesh mode. */
export function setMeshWingFlap(
    material: MeshStandardMaterial,
    opts: { phase?: number; rate?: number; rest?: number; bodyRoll?: number },
): void {
    const u = materialUniforms.get(material);
    if (!u?.uWingRate) return;
    if (opts.phase != null && u.uWingPhase) u.uWingPhase.value = opts.phase;
    if (opts.rate != null) u.uWingRate.value = opts.rate;
    if (opts.rest != null && u.uWingRest) u.uWingRest.value = opts.rest;
    if (opts.bodyRoll != null && u.uWingBodyRoll) u.uWingBodyRoll.value = opts.bodyRoll;
}

/** Attach dragon-style wing flap to every mesh under a spell root. */
export function attachDragonWingFlap(root: Group, phase = randomWingPhase()): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
            if (!(m instanceof MeshStandardMaterial)) continue;
            attachWingFlap(m, mesh.geometry, DRAGON_WING_FLAP);
            setMeshWingFlap(m, { phase, rate: 1, rest: 0 });
        }
    });
}

/** Non-instanced crow (homepage showcase) — flaps at full fly rate. */
export function attachCrowShowcaseWingFlap(
    root: Group,
    rate = CROW_WING_FLY_RATE,
    phase = randomWingPhase(),
): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
            if (!(m instanceof MeshStandardMaterial)) continue;
            attachWingFlap(m, mesh.geometry, CROW_SHOWCASE_WING_FLAP);
            setMeshWingFlap(m, { phase, rate, rest: 0 });
        }
    });
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

/** Derive wing-mask radii from baked geometry (feet at y≈0). */
function measureWingParams(
    geometry: BufferGeometry,
    overrides: Partial<WingParams> = {},
): WingParams {
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

    const innerRFrac = overrides.innerRFrac ?? 0.22;
    const innerR = outerR * innerRFrac;
    const pivotR = 0;
    const pivotY = b.min.y + height * 0.44;

    return {
        pivotR: overrides.pivotR ?? pivotR,
        pivotY: overrides.pivotY ?? pivotY,
        innerR: overrides.innerR ?? innerR,
        outerR: overrides.outerR ?? outerR * 0.98,
        minY: overrides.minY ?? minY,
        maxY: overrides.maxY ?? maxY,
        flapAmp: overrides.flapAmp ?? 0.88,
        flapSpeed: overrides.flapSpeed ?? 10.5,
        // Model rest is already fairly high — bias down so the outer wing dips ~as far as it rises.
        flapBias: overrides.flapBias ?? -0.28,
        // mix(floor, 1, pow(t, power)) — more mid-wing, softer tips (lower amp + gentler power).
        tipFloor: overrides.tipFloor ?? 0.36,
        tipPower: overrides.tipPower ?? 1.32,
        innerRFrac,
    };
}
