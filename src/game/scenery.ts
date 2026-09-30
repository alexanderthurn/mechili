import {
    AdditiveBlending,
    BackSide,
    Box3,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    ConeGeometry,
    CylinderGeometry,
    DataTexture,
    DoubleSide,
    Group,
    IcosahedronGeometry,
    InstancedMesh,
    LinearFilter,
    InstancedBufferAttribute,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    Quaternion,
    RGFormat,
    RepeatWrapping,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    UnsignedByteType,
    Color,
    Vector2,
    Vector3,
    type DirectionalLight,
    type HemisphereLight,
    type PerspectiveCamera,
    type Scene,
    type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Weather, TRANSITION_TAU, type Season } from './weather';
import { WaterReflection } from './waterReflection';
import { THEME } from '../theme';
import type { EffectToggles } from './effectToggles';
import { prefs, sceneryDetailed, sceneryHeightFog, type SceneryQuality } from './prefs';
import {
    CELL,
    makeValueNoise,
    mulberry32,
    registerOuterHeight,
    summerDryUniform,
    hazardTimeShared,
    fireCharcoalGroundUniform,
    worldHeightAt,
    type BattleMap,
} from './map';
import { groundDetailCacheKey, groundMaterialProfile, PHOTO_BLEND, bindCloseTileUniforms, closeTileInjectGlsl, closeTileSampleGlsl, closeTileUniformDecls, closeTileVertexShader, closeTileWeightFallbackGlsl, LAWN_SNOW_COLOR_GLSL, SLOPE_GROUND_FNS, slopeGroundGlsl, SNOW_SLOPE_HOLD_GLSL, textureBombGlsl } from './groundQuality';
import {
    barkUrl,
    foliageUrl,
    grassClumpsUrl,
    iceAlbedoUrl,
    sandAlbedoUrl,
    shoreAlbedoUrl,
    loadGrassTextures,
    loadRockTextures,
    loadWorldTexture,
} from './worldTextures';
import {
    BILLBOARD_SCALE,
    BILLBOARD_Y_SINK,
    attachSeasonTint,
    attachVegetationSnow,
    billboardShadowRadius,
    createBillboardInstances,
    createVegetationInstances,
    loadSceneryBillboards,
    loadSceneryVegetation,
    placeBillboardInstance,
    placeVegetationInstance,
    sceneryBoardTrees3d,
    sceneryHqVegetation,
    snapVegetationSeason,
    setVegetationSeason,
    setVegetationSnowCover,
    updateVegetationSeason,
    type VegetationKind,
} from './sceneryVegetation';
import {
    buildFloorPieceMeshes,
    floorPieceGroundSink,
    floorPieceScale,
    floorPiecesEnabled,
    listFloorPieces,
    loadFloorPieces,
    type FloorPiecePlacement,
} from './sceneryFloorPieces';
import { GrassField } from './grassField';
import { createOuterGroundGeometry, MOUNTAIN_DENSE_FROM, OUTER_SCALE } from './outerGroundGrid';
import { sculptUltraMountainPositions } from './mountainSculpt';
import { ensureOuterMaterialAttrs } from './landscapeMaterials';
import { applyLandscapeToOuterGeometry, landscapeOuterSampler, type HeightSampler, type LandscapeData } from './landscape';
import {
    pointInPlantClear,
    type AuthoredPlant,
    type PlantClearDisk,
} from './landscapePlants';
import { updateBuildingSnowCover, snapBuildingSnowCover } from './buildingSnow';
import { BillboardTreeShadows, type BlobShadowSource } from './blobShadows';

/** Instance / mesh density for scenery tiers (trees stay InstancedMesh). */
function sceneryDensity(quality: SceneryQuality): {
    outer: number;
    field: number;
    meadow: number;
    lake: number;
    segs: number;
    margin: number;
    acceptBase: number;
    /** distance past board where forest belt starts ramping */
    beltNear: number;
    /** how quickly density rises after beltNear */
    beltRamp: number;
    /** distance where far taper begins */
    beltFar: number;
    forestFogCards: number;
    /** summit wisps parked on snowy peaks */
    peakClouds: number;
} {
    if (quality === 'ultra') {
        return {
            outer: 10,
            field: 1.6,
            meadow: 2.2,
            lake: 1.8,
            segs: 400,
            margin: 480,
            acceptBase: 0.85,
            // thick immediately past keep-out — peak density almost at the edge
            beltNear: 8,
            beltRamp: 18,
            // hard-capped at crest (MOUNTAIN_PEAK_END); no soft spill past 500
            beltFar: 480,
            forestFogCards: 22,
            peakClouds: 22,
        };
    }
    if (quality === 'high') {
        // Same dense forest belt as ultra, but low-poly cones/blobs (no Tripo GLBs).
        return {
            outer: 10,
            field: 1.6,
            meadow: 2.2,
            lake: 1.8,
            segs: 380,
            margin: 480,
            acceptBase: 0.85,
            beltNear: 8,
            beltRamp: 18,
            beltFar: 480,
            forestFogCards: 18,
            peakClouds: 18,
        };
    }
    // medium — billboard forest (cheaper than high; no blob shadows / Tripo)
    return {
        // ~3.5× former medium tree counts; still well under high/ultra (outer: 10)
        outer: 3.5,
        field: 1.2,
        meadow: 1,
        lake: 1,
        segs: 300,
        margin: 400,
        acceptBase: 0.42,
        beltNear: 14,
        beltRamp: 40,
        beltFar: 360,
        forestFogCards: 12,
        peakClouds: 12,
    };
}

function scaleCount(n: number, mult: number): number {
    return Math.max(1, Math.round(n * mult));
}

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/**
 * Deterministic replacements for `Math.pow(x, exponent)` on `x` clamped to
 * [0, 1] — used only by {@link terrainHeight} below, which feeds
 * `worldHeightAt` → `hordePathCrossesWater` for real GAMEPLAY decisions
 * (horde-wave spawn-point rejection near lakes, see registerOuterHeight's
 * call site further down). `Math.pow` with a fractional exponent is
 * implementation-approximated per spec, not guaranteed bit-identical across
 * engines — the same lockstep hazard `sim.ts`'s local `hypot()` exists to
 * avoid for `Math.hypot`. Each is a degree-7, zero-constant-term least-
 * squares fit of x^exponent on [0,1] (max abs error ~8e-4), evaluated with
 * only +, -, * (exactly specified by IEEE-754) so every peer gets the
 * identical bits — the tiny fit error vs. the "true" curve is invisible in
 * a hand-authored terrain shape and doesn't matter for determinism, only
 * consistency does.
 */
function detPow01(x: number, c: readonly [number, number, number, number, number, number, number]): number {
    const v = Math.min(1, Math.max(0, x));
    // Horner's method
    return v * (c[0] + v * (c[1] + v * (c[2] + v * (c[3] + v * (c[4] + v * (c[5] + v * c[6]))))));
}

const POW_1_45 = [
    0.15304741, 2.50136129, -6.09467962, 11.84031086, -13.80380794, 8.60550388, -2.20198833,
] as const;
const POW_1_3 = [
    0.3007198, 2.57445524, -7.27909887, 14.64816629, -17.34878685, 10.91272683, -2.8085132,
] as const;
const POW_1_35 = [
    0.2418669, 2.60154548, -7.03726829, 14.0043433, -16.50211579, 10.34998924, -2.65867118,
] as const;

/** Deterministic replacement for `Math.hypot` — sqrt IS correctly rounded
 *  per IEEE-754 in every engine, `Math.hypot` is NOT (see detPow01's doc
 *  comment for why that matters here). */
function detHypot(x: number, z: number): number {
    return Math.sqrt(x * x + z * z);
}

/**
 * How far past the board AABB the outer ground covers.
 * Mountains rise from ~d=110 and stop at the crest (d=500). Outer rim verts
 * stay at peak height (no drop to y=0). Decorations past the crest are culled.
 */
const MOUNTAIN_RISE_START = 110;
/** Same climb as before — full strength at start+360 (~470). */
const MOUNTAIN_RISE_SPAN = 360;
/**
 * Crest / world cut — hold peak height from ~470 out to 500. These distances (and every other
 * one out from the board edge in here) are NOMINAL: the procedural world scales them all by
 * OUTER_SCALE (see outerGroundGrid.ts); a static map keeps them as authored.
 */
export const MOUNTAIN_PEAK_END = 500;

/** the super mountain: footprint radius, the summit height it is lifted to (the ordinary range tops out near 370) and the least it adds */
const SUPER_RADIUS_NOMINAL = 190;
const SUPER_TOP = 380;
const SUPER_MIN_ADD = 10;

/** the board shader's value noise (groundQuality.ts SLOPE_GROUND_FNS), on the CPU */
function slopeNoiseJs(px: number, py: number): number {
    const h = (x: number, y: number): number => {
        const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return v - Math.floor(v);
    };
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    let fx = px - ix;
    let fy = py - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy);
    const b = h(ix + 1, iy);
    const c = h(ix, iy + 1);
    const d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function smoothstepJs(e0: number, e1: number, x: number): number {
    return smooth01((x - e0) / (e1 - e0));
}

/**
 * 0..1 how much of the board's ground at (x, z) is drawn as grass: the same slope and patch
 * terms the board shader uses (slopeGroundGlsl / groundZonesGlsl) — bare earth and rock on the
 * steep hillsides, straw on the gentler ones, bare-earth patches on the flat. Render-only.
 */
function boardGrassAt(map: BattleMap, x: number, z: number): number {
    const e = 1;
    const gx = (map.heightAt(x + e, z) - map.heightAt(x - e, z)) / (2 * e);
    const gz = (map.heightAt(x, z + e) - map.heightAt(x, z - e)) / (2 * e);
    const grade = Math.sqrt(gx * gx + gz * gz);
    const v = slopeNoiseJs(x / 7, z / 7) * 0.65 + slopeNoiseJs(x / 2.3 + 17, z / 2.3 + 17) * 0.35 - 0.5;
    // (earlier than the shader's own ramp: where earth starts to show, the grass is already gone)
    const earth = smoothstepJs(0.4, 0.6, grade + v * 0.2);
    const rock = smoothstepJs(0.8, 1.15, grade + v * 0.24);
    const dry = smoothstepJs(0.16, 0.45, grade + v * 0.14);
    const earthN = slopeNoiseJs(x / 27 + 47, z / 27 + 47) * 0.65 + slopeNoiseJs(x / 8 + 2.9, z / 8 + 2.9) * 0.35;
    const patch = smoothstepJs(0.58, 0.72, earthN);
    // a blade needs grass under it: none on bare earth (hillside or patch) or rock, thinner on
    // the dry slopes
    return Math.max(0, 1 - Math.max(earth, rock, patch)) * (1 - dry * 0.45);
}

/** alm: flat meadow radius, the ease into the mountainside, and the height it is sought at (half the range) */
const ALM_RADIUS = 65;
const ALM_EASE = 55;
const ALM_PEAK = 370;
/** how steeply the meadow falls toward the board (rise over run) */
const ALM_TILT = 0.26;

/**
 * How many trees and bushes the forest gets, as a share of the tier's count: the solid ultra
 * billboards read much denser than the old see-through ones, and the outer ring shrank
 * (OUTER_SCALE), so fewer carry the same forest — and cost less.
 */
const FOREST_TREES = 0.65;

/** the range's one wind, blowing snow off the crests */
const SNOW_WIND = { x: 0.82, z: 0.57 };

/** a drifting forest fog card (see createForestFog / drapeFogCard) */
interface FogCard {
    mesh: Mesh;
    baseX: number;
    phase: number;
    speed: number;
    /** how high above the ground it floats */
    lift: number;
    /** the ground height where it formed — it thins as it climbs above that */
    homeY: number;
    /** how far it may climb before it starts to thin, and over how much it fades (default 3, 10) */
    thinFrom?: number;
    thinOver?: number;
}
/** grid of a fog card (per side), and how many frames it takes to re-drape them all */
const FOG_CARD_SEGS = 8;
const FOG_DRAPE_EVERY = 8;

/** what the mountain cloud banks bleach toward under snow */
const MIST_SNOW_WHITE = new Color(0xf4f7fb);

/** World height of the water table: one flat plane, hidden wherever the ground is above it. */
const WATER_LEVEL_Y = -1.1;
// ---- ultra water: mirrored world + ripples (tune here) ----
/** low water: one flat colour, and what it eases to when the lake freezes */
const FLAT_WATER_COLOR = new Color(0x3f86bd);
const FLAT_WATER_ICE = new Color(0xdde8ee);
/** what the lake reeds fade toward under snow */
const REED_FROST = new Color(0xe6ebe8);
// ---- high water: analytic sky reflection (tune here) ----
const WATER_SKY_F0 = '0.22';
const WATER_SKY_POWER = '3.0';
/** how much of the fresnel-weighted sky replaces the water colour (1 = fully) */
const WATER_SKY_STRENGTH = '0.85';
/** high keeps a denser surface than ultra: its sky reflection is flat colour, not a picture */
const WATER_HIGH_OPACITY = 0.3;
/** ultra gloss: tighter than the other tiers, so the sun path breaks into sparkle */
const WATER_ULTRA_ROUGHNESS = 0.12;
/** surface opacity before fresnel: lower = more of the lake bed shows through */
const WATER_ULTRA_OPACITY = 0.6;
/** lake-bed sand tile edge in world units (high, ultra) */
const LAKE_SAND_TILE = 13;
/** water depth (metres) where the silt takes over from the stones; lower = more silt */
const LAKE_SILT_FROM = 0.9;
/** how ragged that edge is: noise shifts the threshold by up to about half of this (metres) */
const LAKE_SILT_RAG = 1.6;
/**
 * Lake size as the water shader / ground shader read it: the share of water
 * within ~20 m (G of the depth image). Below SMALL the shore effects (foam, surge,
 * ripples) are at their calmest, above BIG at full strength.
 */
const LAKE_SIZE_SMALL = 0.16;
const LAKE_SIZE_BIG = 0.45;
/** how much of the foam / ripple strength a tiny lake keeps (1 = all of it) */
const LAKE_SMALL_FOAM = 0.3;
const LAKE_SMALL_SURGE = 0.35;
const LAKE_SMALL_RIPPLE = 0.4;
/** the gravel again at a second, larger size, so the floor does not visibly repeat */
const LAKE_GRAVEL_BIG_TILE = 29;
/** ripple size: 1 = the first version, higher = finer waves */
const WATER_WAVE_SCALE = '1.6';
/** overall steepness of the ripples (after scaling) */
const WATER_WAVE_SLOPE = '0.85';
/** how strongly a ripple tilts the surface normal (sun sparkle) */
const WATER_NORMAL_TILT = '1.0';
/** mirror share looking straight down; fresnel raises it toward the horizon */
const WATER_REFLECT_F0 = '0.32';
const WATER_REFLECT_POWER = '2.6';
/** how far a ripple bends the mirrored image (texture-coordinate units) */
const WATER_REFLECT_DISTORT = '0.028';
/**
 * Shore foam for the ultra lake beds (meadow ground shader). Value noise gives
 * each stretch of coast its own rhythm; the foam line sits where the ground
 * meets the water table, moves up and down the bank with a slow surge, and
 * breaks up into flecks that drift. `depth` is water-table height minus ground
 * height (positive = under water).
 */
const LAKE_FOAM_FNS_GLSL = `
float lfHash(vec2 p) {
	p = fract(p * vec2(233.34, 851.73));
	p += dot(p, p + 23.45);
	return fract(p.x * p.y);
}
float lfNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(lfHash(i), lfHash(i + vec2(1.0, 0.0)), u.x),
		mix(lfHash(i + vec2(0.0, 1.0)), lfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// how far ABOVE the static waterline the swash reaches right now (metres of
// height): about -0.09 (drawn back into the water) .. +0.25 (up the bank)
float lakeShoreSurge(vec2 p, float t) {
	float phase = lfNoise(p * 0.09) * 6.2831;
	return 0.08 + 0.17 * sin(t * 0.85 + phase);
}
// Caustics on the shallow bed: bright lines where two drifting noise fields
// cross (their difference is zero), at two scales — a moving net of light with
// no axis to line up on.
float lakeCaustics(vec2 p, float t) {
	float a = lfNoise(p * 0.85 + vec2(t * 0.16, t * 0.11));
	float b = lfNoise(p * 0.85 + vec2(17.3, 5.1) + vec2(-t * 0.13, t * 0.17));
	float r1 = 1.0 - smoothstep(0.0, 0.07, abs(a - b));
	float c = lfNoise(p * 1.7 + vec2(9.1, 9.1) + vec2(-t * 0.22, t * 0.15));
	float d = lfNoise(p * 1.7 + vec2(3.7, 21.9) + vec2(t * 0.19, t * 0.21));
	float r2 = 1.0 - smoothstep(0.0, 0.06, abs(c - d));
	return max(r1, r2 * 0.7);
}
float lakeFoam(vec2 p, float t, float depth, float surge) {
	// distance below the swash tip: 0 at the tip, positive on the water side
	float d = depth + surge;
	// the foam sits from the tip down a little way into the water
	float line = smoothstep(-0.02, 0.05, d) * (1.0 - smoothstep(0.10, 0.36, d));
	// flecks: two drifting noise layers, thresholded so the line reads as broken foam
	float n = 0.6 * lfNoise(p * 2.6 + vec2(t * 0.20, -t * 0.13)) + 0.4 * lfNoise(p * 6.4 + vec2(-t * 0.35, t * 0.22));
	float flecks = smoothstep(0.34, 0.62, n);
	// a thin bright edge right at the swash tip, unbroken
	float edge = (1.0 - smoothstep(0.0, 0.05, abs(d))) * 0.6;
	return clamp(line * flecks + edge, 0.0, 1.0);
}
`;

/**
 * Declarations for the high/ultra water shader: the ripple field, returned as
 * the slope of the surface in world xz. Analytic, so the ripples move in place
 * instead of sliding a texture along.
 */
const WATER_MIRROR_UNIFORMS = `
uniform sampler2D uReflTex;
uniform mat4 uReflMatrix;
uniform float uReflOn;
`;
/** High: the sky's three colours, painted on the dome and reflected here */
const WATER_SKY_UNIFORMS = `
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
`;
/** the water depth image and the world position it is read at (medium, high, ultra) */
const WATER_DEPTH_DECLS = `
uniform sampler2D uLakeDepthTex;
uniform float uLakeDepthSpan;
varying vec3 vWaterWorld;
`;
/**
 * Colour and clarity follow the water depth: pale green and clear over the
 * shallows, deep blue and dense in the middle, melting into nothing at the
 * shore (the foam lives there). One texture read.
 */
const WATER_DEPTH_SNIPPET = `
	{
		float wDepth = texture2D(uLakeDepthTex, (vWaterWorld.xz + uLakeDepthSpan) / (2.0 * uLakeDepthSpan)).r * 8.0;
		float wDeepK = smoothstep(0.25, 5.0, wDepth);
		float wThaw = 1.0 - smoothstep(0.0, 0.6, uFreeze);
		vec3 wCol = mix(vec3(0.30, 0.58, 0.52), vec3(0.03, 0.16, 0.30), wDeepK);
		diffuseColor.rgb = mix(diffuseColor.rgb, wCol, 0.78 * wThaw);
		float wAlpha = mix(0.62, 1.35, wDeepK) * smoothstep(0.0, 0.30, wDepth);
		diffuseColor.a *= mix(1.0, wAlpha, wThaw);
	}`;
const WATER_RIPPLE_DECLS = `
uniform float uWaterTime;
float wHash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
// smooth value noise: (value, d/dx, d/dy) — quintic, so the slope has no cell seams
vec3 wNoiseD(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
	float a = wHash(i);
	float b = wHash(i + vec2(1.0, 0.0));
	float c = wHash(i + vec2(0.0, 1.0));
	float d = wHash(i + vec2(1.0, 1.0));
	float k1 = b - a;
	float k2 = c - a;
	float k4 = a - b - c + d;
	return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
// Surface slope in world xz: three noise octaves, each turned to its own angle
// and drifting its own way, over a slowly wandering warp — no axis, no lattice.
vec2 waterWaveGrad(vec2 p, float t) {
	vec2 warp = vec2(wNoiseD(p * 0.045 + vec2(t * 0.020, 0.0)).x, wNoiseD(p * 0.045 + vec2(-7.3, t * 0.017)).x) - 0.5;
	// finer ripples: everything below runs on a scaled plane (and a matching
	// clock, so the world-space drift speed stays what it was)
	p = (p + warp * 4.5) * ${WATER_WAVE_SCALE};
	t *= ${WATER_WAVE_SCALE};
	mat2 r1 = mat2(0.814, 0.581, -0.581, 0.814);
	mat2 r2 = mat2(-0.323, 0.946, -0.946, -0.323);
	mat2 r3 = mat2(-0.904, 0.427, -0.427, -0.904);
	vec2 g = vec2(0.0);
	g += (wNoiseD(r1 * p * 0.22 + vec2(t * 0.10, t * 0.06)).yz * r1) * 0.22 * 0.35;
	g += (wNoiseD(r2 * p * 0.50 + vec2(-t * 0.16, t * 0.11)).yz * r2) * 0.50 * 0.20;
	g += (wNoiseD(r3 * p * 1.10 + vec2(t * 0.24, -t * 0.19)).yz * r3) * 1.10 * 0.09;
	// slope is set by taste, not by the chain rule: finer waves, a touch flatter
	return g * ${WATER_WAVE_SLOPE};
}
`;
const OUTER_PAST_BOARD = MOUNTAIN_PEAK_END;

/**
 * Former outer extent — used only to keep the same segment budget after the
 * world was shortened, so those verts go into the mountain climb instead.
 */
const OUTER_PAST_BOARD_BUDGET = 780;

function outerWorldSize(halfW: number, halfH: number, scale: number): number {
    return 2 * (Math.max(halfW, halfH) + OUTER_PAST_BOARD * scale);
}

/** World size as if the old long skirt still existed — drives SEGS only. */
function outerWorldBudgetSize(halfW: number, halfH: number, scale: number): number {
    return 2 * (Math.max(halfW, halfH) + OUTER_PAST_BOARD_BUDGET * scale);
}

/**
 * Distance past the board used for the mountain ring / crest cull.
 * Not a circle around the origin — it's hypot of how far past each board edge
 * (rounded rectangle → nearly circular outside the corners). Same base metric
 * as {@link Scenery}'s terrainHeight (without the noise wobble).
 */
function pastBoard(halfW: number, halfH: number, x: number, z: number): number {
    const ox = Math.max(0, Math.abs(x) - halfW);
    const oz = Math.max(0, Math.abs(z) - halfH);
    return detHypot(ox, oz);
}

/**
 * Everything around and above the battlefield, generated in code: sky dome,
 * sun glow, the outer world (ground, trees), horizon clouds, forest fog, rain/snow.
 */
export class Scenery {
    readonly group = new Group();

    /** dome + sun glow follow the camera so the horizon never hits the far plane */
    private readonly skyGroup = new Group();
    private readonly clouds: { mesh: Mesh; speed: number }[] = [];
    /** wisps clinging to the snowy summits — they sway in place, never leave */
    private readonly peakClouds: { mesh: Mesh; baseX: number; phase: number; speed: number }[] = [];
    /** low fog cards drifting between the forest trees */
    private readonly fogCards: FogCard[] = [];
    /** which fog card is re-draped this frame (one in FOG_DRAPE_EVERY per frame) */
    private fogDrapeTick = 0;
    private forestFogMaterial: MeshBasicMaterial | null = null;
    /** ultra: cloud banks lying on the mountain shelves (see createMountainMist) */
    private readonly mistBanks: FogCard[] = [];
    private mountainMistMaterial: MeshBasicMaterial | null = null;
    /** ultra: snow blown off the tallest crests (see createSnowPlumes) */
    private readonly snowPlumes: {
        crest: Vector3;
        /** the cap sits a little toward the board, in front of the summit */
        center: Vector3;
        length: number;
        phase: number;
        /** the banner streaming off the crest downwind */
        puffs: { sprite: Sprite; material: SpriteMaterial; offset: number; size: number }[];
        /** the cloud wrapped round the summit; more of it shows the worse the weather */
        cap: { sprite: Sprite; material: SpriteMaterial; angle: number; radius: number; height: number; spin: number; size: number; rank: number }[];
    }[] = [];
    /** the two alms (flat mountain meadows) this match's seed found; empty on a static map */
    /** the outer ring's scale (OUTER_SCALE on the procedural world, 1 on a static map) */
    private readonly os: number;
    /** how far past the board the outer world reaches (MOUNTAIN_PEAK_END × os) */
    private readonly reach: number;
    /** how far past the board the outer world reaches — the camera's bounds */
    get outerReach(): number {
        return this.reach;
    }
    /** where the super mountain stands (null on a static map) */
    private superPeak: { x: number; z: number; add: number } | null = null;
    private readonly almSites: { x: number; z: number; y: number; ux: number; uz: number }[] = [];
    private time = 0;
    private readonly cloudBoundsX: number;
    /** Square outer-ground size (world units) — mountain ring plus a short skirt. */
    private readonly worldSize: number;
    private readonly map: BattleMap;
    private weather: Weather | null = null;
    /** far-card contact shadows (sun-aligned); built when billboards are placed */
    private readonly treeShadows = new BillboardTreeShadows(this.group);
    private sunLight: DirectionalLight | null = null;
    /** Outer meadow/mountain ground — used by the mountain editor. */
    private outerGroundMesh: Mesh | null = null;
    /** Hand-placed trees/bushes from the landscape editor / bake. */
    private authoredPlants: AuthoredPlant[] = [];
    private plantClears: PlantClearDisk[] = [];
    private readonly authoredMeshes = new Map<VegetationKind, InstancedMesh>();
    private readonly plantDummy = new Object3D();
    /**
     * Per InstancedMesh: last ground Y used when seating decorations, so we can
     * preserve trunk/canopy lifts across landscape sculpt updates.
     */
    private readonly instanceGroundY = new WeakMap<InstancedMesh, Float32Array>();
    private readonly reseatMat = new Matrix4();
    private readonly reseatPos = new Vector3();
    private readonly reseatQuat = new Quaternion();
    private readonly reseatScale = new Vector3();

    private waterTexture: CanvasTexture | null = null;
    private waterMaterial: MeshStandardMaterial | MeshLambertMaterial | null = null;
    private waterFreezeUniform: { value: number } | null = null;
    /** drives the ripple normals of the ultra water (seconds) */
    private waterTimeUniform: { value: number } | null = null;
    private waterMesh: Mesh | null = null;
    /** low: the one-colour water; its colour eases toward ice with the snow */
    private flatWaterMaterial: MeshLambertMaterial | null = null;
    /** gloss of the unfrozen surface (ultra is tighter, so the sun path sparkles) */
    private waterRoughness = 0.18;
    /**
     * Ultra: how deep the water is (world xz -> depth below the water table, 0..8
     * in 8 bits) over the lake area — read by the water shader for colour and
     * shore transparency. Built lazily, rebuilt (throttled) when the ground moves.
     */
    private readonly lakeDepthTexUniform: { value: DataTexture | null } = { value: null };
    private readonly lakeDepthSpanUniform = { value: 1 };
    private lakeDepthDirty = true;
    /** the water shader reads the depth image (high and ultra) */
    private lakeDepthUsed = false;
    /** the dome's three colours, as the high water's sky reflection reads them */
    private readonly waterSky = {
        zenith: { value: new Color() },
        mid: { value: new Color() },
        horizon: { value: new Color() },
    };
    private lakeDepthBuiltAt = 0;
    private reeds: InstancedMesh | null = null;
    private reedBaseColors: Color[] = [];
    private reedSnowApplied = -1;
    /** lily pads and blossoms on the lakes — they fade out as the water freezes */
    private lakeSurfacePlants: InstancedMesh[] = [];
    /** ultra lake-bed layers on (1) / off (0) — the Shift+9 A/B switch */
    private readonly lakeBedUniform = { value: 1 };
    /** seconds, for the lapping foam on the ultra lake shores */
    private readonly lakeTimeUniform = { value: 0 };
    /** the unfrozen surface opacity of this tier (ice fades toward opaque) */
    private waterOpacity = 0.86;
    /** ultra only: the mirrored view the lake surface shows */
    private waterReflection: WaterReflection | null = null;
    /** boxes around the wet ground, for "is a lake on screen" — null = not sampled yet */
    private lakeBoxes: Box3[] | null = null;
    /** drives the outer meadow's weather-driven snow blend (see `applyMeadowTexture`) */
    private outerGroundSnowUniform: { value: number } | null = null;
    /** 1 = alpine cap on, 0 = summer — peaks go to bare rock */
    private readonly outerGroundAlpineUniform: { value: number } = { value: 1 };
    private alpineCapTarget = 1;
    /** 0 = lush grass, ~0.72 = summer-dry straw (shared `summerDryUniform`) */
    private summerDryTarget = 0;

    /** wildflower materials (meadow clumps + lake blossoms) — opacity-boosted in spring */
    private readonly flowerMaterials: MeshStandardMaterial[] = [];
    /** target opacity for wildflower / lily blossom materials (lerped in update) */
    private flowerOpacityTarget = 1;
    /** fallen-leaf litter on the meadow — built once, opacity eased in autumn */
    private leafLitter: InstancedMesh | null = null;
    private litterOpacityTarget = 0;

    /**
     * Hammer crush: original instance matrices so trees/bushes can stand back
     * up when the battle phase ends.
     */
    private readonly crushRestore: {
        mesh: InstancedMesh;
        index: number;
        matrix: Matrix4;
    }[] = [];

    // weather hooks, wired up by the create* builders below
    private repaintSky!: (zenith: string, mid: string, horizon: string) => void;
    private sunGlow!: Sprite;
    private cloudMaterial!: MeshBasicMaterial;
    private cloudTexture!: CanvasTexture;

    /** outer-world height: meadow band with soft relief, then slopes into a mountain ring */
    private readonly terrainHeight: (x: number, z: number) => number;
    /** 0..1 — how much a spot belongs to a lake basin (drives depth + beaches) */
    private readonly lakeAt: (x: number, z: number) => number;
    /** shared value noise for height + vertex color variation */
    private readonly noise: (x: number, z: number) => number;

    /** false with the 'low' scenery pref: flat green world, no decoration */
    private readonly quality: SceneryQuality = prefs().scenery;
    private readonly detailed = sceneryDetailed(this.quality);
    private readonly density = sceneryDensity(this.quality);
    /** scenery RNG seed — ultra mountain overhang sites stay stable */
    private readonly seed: number;
    /** the static map this world shows, or null for the procedural terrain */
    private readonly landscape: LandscapeData | null;
    /**
     * Ground height (board + outer) as the decorations were placed on it —
     * a sculpt later moves them by how much the ground under them changed.
     */
    private buildGround: HeightSampler = () => 0;
    /** bumps whenever authored plant meshes are rebuilt — an older, still-loading rebuild then gives up */
    private authoredRebuildGen = 0;

    constructor(map: BattleMap, seed = 20260709, landscape: LandscapeData | null = null) {
        const rng = mulberry32(seed);
        this.seed = seed;
        this.landscape = landscape;
        this.map = map;
        // the procedural ring is scaled as a whole; a static map keeps its authored reach
        this.os = landscape ? 1 : OUTER_SCALE;
        this.reach = MOUNTAIN_PEAK_END * this.os;
        const S = this.os;
        this.worldSize = outerWorldSize(map.halfW, map.halfH, S);
        this.cloudBoundsX = map.halfW + this.reach;

        // the match seed picks this match's mountains and lakes (heights are gameplay-visible, so
        // every peer gets the same range from the same seed)
        const noise = makeValueNoise(31337 ^ seed);
        this.noise = noise;
        // Lakes are placed, not thresholded out of noise, so their size is under control: either
        // one big lake (radius 80–100) with a pond or two, or three to five smaller ones
        // (radius 30–62) — about the same water in total either way, never a lake bigger than a
        // third of the board. Each sits 40+ wu off the board edge and no farther than ~210 out.
        // The seed decides (same on every peer); the edges are wobbled with noise so they are not discs.
        const lakeRng = mulberry32((seed ^ 0x1a4e5b) >>> 0);
        const lakeSites: { x: number; z: number; r: number; phase: number }[] = [];
        {
            const radii: number[] = [];
            if (lakeRng() < 0.35) {
                radii.push((80 + lakeRng() * 20) * S);
                const ponds = 1 + Math.floor(lakeRng() * 2);
                for (let i = 0; i < ponds; i++) radii.push((22 + lakeRng() * 16) * S);
            } else {
                const count = 3 + Math.floor(lakeRng() * 3);
                for (let i = 0; i < count; i++) radii.push((30 + lakeRng() * 32) * S);
            }
            for (const r of radii) {
                for (let attempt = 0; attempt < 200; attempt++) {
                    const x = (lakeRng() * 2 - 1) * (map.halfW + 250 * S);
                    const z = (lakeRng() * 2 - 1) * (map.halfH + 250 * S);
                    const dOut = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
                    if (dOut < r + 40 * S || dOut > 210 * S) continue;
                    // (sqrt, not hypot: this height is gameplay-visible and must match on every machine)
                    if (lakeSites.some((o) => {
                        const gap = Math.sqrt((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z)) - o.r - r;
                        return gap < 40 * S;
                    })) continue;
                    lakeSites.push({ x, z, r, phase: lakeRng() * 100 });
                    break;
                }
            }
        }
        this.lakeAt = (x, z) => {
            let best = 0;
            for (const site of lakeSites) {
                const dx = x - site.x;
                const dz = z - site.z;
                const reach = site.r * 1.4;
                if (dx * dx + dz * dz >= reach * reach) continue;
                const wobble = 1 + (noise(x / 38 + site.phase, z / 38 + site.phase * 0.7) - 0.5) * 0.5;
                const u = 1 - Math.sqrt(dx * dx + dz * dz) / (site.r * wobble);
                best = Math.max(best, smooth01(u / 0.3));
            }
            return best;
        };
        const baseHeight: HeightSampler = (x, z) => {
            // keep the playable AABB flat — field mesh owns that surface
            if (Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH) return 0;

            // rounded distance past the board + mild noise (not a square cliff line)
            const ox = Math.max(0, Math.abs(x) - map.halfW);
            const oz = Math.max(0, Math.abs(z) - map.halfH);
            // (nominal distance: the whole profile below is laid out for OUTER_SCALE 1)
            let d = detHypot(ox, oz) / S;
            d += (noise(x / 95 + 2.4, z / 95 + 6.1) - 0.5) * 28;
            d += (noise(x / 40 + 9.0, z / 40 + 1.7) - 0.5) * 12;
            d = Math.max(0, d);

            // ~6 tiles stay nearly flat; then hills ease in (some spots earlier
            // via the noise on d, but never the old "wall at 5 tiles")
            const nearFlat = 24; // CELL=4 → 6 tiles
            const ramp = 90;
            const edgeIn = detPow01(smooth01((d - nearFlat) / ramp), POW_1_45);

            const hN =
                noise(x / 110 + 1.2, z / 110 + 4.8) * 0.5 +
                noise(x / 48 + 22.1, z / 48 + 9.3) * 0.32 +
                noise(x / 22 + 8.8, z / 22 + 55.5) * 0.18;
            const knoll = detPow01(Math.max(0, hN - 0.45) / 0.55, POW_1_3);
            // Ascend to the crest, then hold — outer verts stay at peak height
            // (no drop to y=0, which read as a fake vertical outer wall).
            const dClimb = Math.min(d, MOUNTAIN_PEAK_END);

            const rise = smooth01((dClimb - MOUNTAIN_RISE_START) / MOUNTAIN_RISE_SPAN);
            const n =
                noise(x / 170 + 3.7, z / 170 + 8.1) * 0.55 +
                noise(x / 62 + 51.2, z / 62 + 17.9) * 0.3 +
                noise(x / 24 + 9.4, z / 24 + 63.7) * 0.15;
            const ridge = detPow01(Math.max(0, n - 0.32) / 0.68, POW_1_35);
            // Ridged noise: 1 - |2n - 1| peaks along the noise's mid contour, giving a crest line
            // instead of a lump. The |.| is rounded with a sqrt so the tip is a ridge the coarser
            // meshes (low/medium) can hold, not a one-triangle spike. Only patches of the range get
            // it (~a third); the rest keeps the softer shape. Plain arithmetic — this height is
            // gameplay-visible (worldHeightAt), so it must be identical on every machine.
            const crestN =
                noise(x / 96 + 40.3, z / 96 + 12.9) * 0.62 + noise(x / 41 + 7.7, z / 41 + 33.1) * 0.38;
            const crestT = crestN * 2 - 1;
            const crestLine = 1 - (Math.sqrt(crestT * crestT + 0.04) - 0.2) / 0.8;
            const sharp = crestLine * crestLine;
            const sharpZone = smooth01((noise(x / 230 + 63.1, z / 230 + 18.4) - 0.56) / 0.12);
            // a few hero peaks: a slow noise picks where the range towers over its neighbours
            const hero = smooth01((noise(x / 260 + 5.5, z / 260 + 91.2) - 0.6) / 0.14);
            // The valley is ringed by real mountains: where the noise says "gap" (ridge = 0) the
            // range still stands at ~40% of its height instead of sinking to the foothills.
            const massif = 0.4 + 0.6 * ridge;
            const rawMountain = rise * (55 + 217 * massif * (0.72 + 0.43 * sharp * sharpZone) + 65 * hero * ridge);
            const mountain = rawMountain;
            // Foothills die as the high range takes over — don't resume a
            // second meadow behind the mountain ring.
            const foothill = 1 - smooth01((dClimb - 400) / 280);
            const rolling = (1.2 + 18 * hN + 14 * knoll) * edgeIn * foothill;
            const base = rolling + mountain;
            // Surface wrinkles on the original big shapes — stronger the higher
            // you climb, not extra summits. ~15wu / ~8wu so the mesh can hold them.
            const climb = smooth01((base - 12) / 90);
            const wrinkles =
                (noise(x / 22 + 14.2, z / 22 + 3.6) - 0.5) * 6 * climb +
                (noise(x / 12 + 27.1, z / 12 + 41.8) - 0.5) * 2.2 * climb;

            // lakes win over everything: where the basin noise runs high the
            // ground is pressed to -7, well below the water table at -1.1
            const lake = this.lakeAt(x, z);
            const depth = -7 * smooth01((dClimb - 25) / 45);
            return (base + wrinkles) * (1 - lake) + depth * lake;
        };
        // The one super mountain: a massif standing on the far side of the valley, well above the
        // rest of the range (which stays as it is). It is added on top of the ordinary height, so
        // the seed only decides where it stands: on the highest ground it finds there, off any lake.
        // Only this peak wears the big summit cloud (see createSnowPlumes).
        if (!landscape) {
            const superRng = mulberry32((seed ^ 0x77ab13) >>> 0);
            let bestH = -Infinity;
            for (let i = 0; i < 400; i++) {
                const x = (superRng() * 2 - 1) * (map.halfW + 120 * S);
                const z = -(map.halfH + (240 + superRng() * 140) * S);
                if (this.lakeAt(x, z) > 0.01) continue;
                const h = baseHeight(x, z);
                if (h > bestH) {
                    bestH = h;
                    this.superPeak = { x, z, add: 0 };
                }
            }
            // lift the summit to a fixed height a little above the range's own maximum (~370),
            // whatever the ground under it is, and never less than a real rise
            if (this.superPeak) this.superPeak.add = Math.max(SUPER_MIN_ADD, SUPER_TOP - bestH);
        }
        const superPeak = this.superPeak;
        const SUPER_RADIUS = SUPER_RADIUS_NOMINAL * S;
        const rawHeight: HeightSampler = (x, z) => {
            let h = baseHeight(x, z);
            if (superPeak) {
                const dx = x - superPeak.x;
                const dz = z - superPeak.z;
                const w = 1 - Math.sqrt(dx * dx + dz * dz) / SUPER_RADIUS;
                if (w > 0) {
                    // a cusp-tipped cone (w^1.5 from sqrt, so it is exact everywhere), roughened by
                    // a crest noise so it is craggy and not a funnel
                    const crag = 0.92 + 0.16 * noise(x / 34 + 3.3, z / 34 + 8.1);
                    h += superPeak.add * w * Math.sqrt(w) * crag;
                }
            }
            return h;
        };
        // Two alms: broad level meadows high on the range, where a few trees stand. Where they
        // sit comes from the match seed (same for every peer), and each is a flat disc pressed
        // into the mountainside at the height it was found — cut into the slope like a real bench.
        if (!landscape) {
            const almRng = mulberry32((seed ^ 0x5a17c3) >>> 0);
            const found: { x: number; z: number; y: number; score: number }[] = [];
            for (let i = 0; i < 900; i++) {
                const x = (almRng() * 2 - 1) * (map.halfW + 420 * S);
                const z = (almRng() * 2 - 1) * (map.halfH + 420 * S);
                const dOut = pastBoard(map.halfW, map.halfH, x, z);
                if (dOut < 180 * S || dOut > 400 * S || this.lakeAt(x, z) > 0.02) continue;
                if (superPeak && (x - superPeak.x) ** 2 + (z - superPeak.z) ** 2 < (SUPER_RADIUS + 60 * S) ** 2) continue;
                const y = rawHeight(x, z);
                // half of the range's height, on ground that is not already a cliff
                const grade =
                    Math.max(
                        Math.abs(rawHeight(x + 30, z) - y),
                        Math.abs(rawHeight(x - 30, z) - y),
                        Math.abs(rawHeight(x, z + 30) - y),
                        Math.abs(rawHeight(x, z - 30) - y),
                    ) / 30;
                found.push({ x, z, y, score: grade * 90 });
            }
            // each alm has its own height: one high (0.4–0.5 of the range's peak, 0.5 is the most),
            // one lower (0.28–0.38)
            const fractions = [0.4 + almRng() * 0.1, 0.28 + almRng() * 0.1];
            if (almRng() < 0.5) fractions.reverse();
            for (const fraction of fractions) {
                const want = fraction * ALM_PEAK;
                let best: (typeof found)[number] | null = null;
                let bestScore = Infinity;
                for (const f of found) {
                    if (!this.almSites.every((o) => (o.x - f.x) ** 2 + (o.z - f.z) ** 2 > (260 * S) ** 2)) continue;
                    const sc = f.score + Math.abs(f.y - want);
                    if (sc < bestScore) {
                        bestScore = sc;
                        best = f;
                    }
                }
                if (best) {
                    // (sqrt, not hypot: this height is gameplay-visible and must match on every machine)
                    const len = Math.sqrt(best.x * best.x + best.z * best.z) || 1;
                    this.almSites.push({ x: best.x, z: best.z, y: best.y, ux: best.x / len, uz: best.z / len });
                }
            }
        }
        const almSites = this.almSites;
        const proceduralHeight: HeightSampler = (x, z) => {
            let h = rawHeight(x, z);
            for (const site of almSites) {
                const dx = x - site.x;
                const dz = z - site.z;
                const reach = ALM_RADIUS + ALM_EASE;
                const d2 = dx * dx + dz * dz;
                if (d2 >= reach * reach) continue;
                // tilted toward the board (lower on the valley side) and not quite flat, so the
                // grass shows from the camera; a tenth of the mountain's own relief stays
                const target = site.y + ALM_TILT * (dx * site.ux + dz * site.uz);
                h += (target - h) * (1 - smooth01((Math.sqrt(d2) - ALM_RADIUS) / ALM_EASE)) * 0.92;
            }
            return h;
        };
        // a static map replaces the procedural ring outright — placement,
        // paint and the gameplay height below all read the same surface
        this.terrainHeight = landscape ? landscapeOuterSampler(landscape) : proceduralHeight;
        const boardAtBuild = map.reliefSampler();
        this.buildGround = (x, z) => boardAtBuild(x, z) + this.terrainHeight(x, z);

        // NOTE: terrainHeight/lakeAt stay real at every quality tier (including
        // 'low'/'off') — this feeds registerOuterHeight below, which in turn
        // feeds worldHeightAt, which horde mode uses for GAMEPLAY decisions
        // (lake avoidance when picking a spawn point, see hordePathCrossesWater
        // in game.ts). Quality is a per-client preference, not synced over the
        // wire — if this height data were quality-gated, a 'low'-quality
        // client and a 'high'-quality client could compute different horde
        // spawn points from the identical seed and desync. Only the DECORATION
        // (trees, lake props, meadow texture, forest fog) stays gated by
        // `detailed` below; the outer ground mesh itself now follows the real
        // heights at every tier too (see createOuterGround's SEGS), just
        // without decoration on 'low'/'off'.
        // the camera rig uses this to stay above the mountains
        registerOuterHeight((x, z) => this.terrainHeight(x, z));

        this.skyGroup.add(this.createSkyDome(), this.createSunGlow());
        this.group.add(this.skyGroup);
        this.group.add(this.createOuterGround(map));
        if (landscape) {
            this.authoredPlants = landscape.plants.map((p) => ({ ...p }));
            this.plantClears = landscape.plantClears.map((c) => ({ ...c }));
        }
        if (this.detailed) {
            this.group.add(this.createWater());
            this.createLakeDetails(rng);
            this.createForest(map, rng);
            this.createMeadowDetails(map, rng);
            if (this.quality === 'ultra') this.createGrassField(map, seed);
        } else if (this.quality === 'low') {
            // no decoration, but the lake basins are real ground: fill them
            this.group.add(this.createFlatWater());
        }
        this.createCloudAssets(rng);
        if (this.detailed) this.createHorizonCloudMeshes(map, rng);
        if (this.detailed) this.createForestFog(map, rng);
        if (this.quality === 'ultra') {
            this.createMountainMist(map, rng);
            this.createSnowPlumes(map, rng);
        }
        if (this.quality === 'off') {
            for (const c of this.clouds) c.mesh.visible = false;
        }
    }

    /**
     * Volumetric-looking forest fog: soft translucent cards hovering low
     * between the trees, swaying in place. One shared material — the weather
     * system drives its opacity and tint (thick grey in rain, faint at noon).
     */
    private createForestFog(map: BattleMap, rng: () => number): void {
        const material = new MeshBasicMaterial({
            map: this.cloudTexture,
            transparent: true,
            depthWrite: false,
            opacity: 0,
            // per-vertex alpha: the fog thins where it creeps up a slope (see drapeFogCard)
            vertexColors: true,
        });
        this.forestFogMaterial = material;

        const count = Math.round(14 + this.density.forestFogCards);
        const beltMax = Math.min(this.density.beltFar * this.os, this.reach - 20 * this.os);
        let placed = 0;
        for (let attempt = 0; attempt < 4000 && placed < count; attempt++) {
            const x = (rng() * 2 - 1) * (map.halfW + beltMax);
            const z = (rng() * 2 - 1) * (map.halfH + beltMax);
            const d = pastBoard(map.halfW, map.halfH, x, z);
            if (d >= this.reach) continue;
            if (d < this.density.beltNear + 6 || d > beltMax) continue;
            const h = this.terrainHeight(x, z);
            if (h < -0.5 || h > 60 || !this.isGrassy(x, z)) continue;
            // each card its own small grid, draped over the ground as it drifts
            const geometry = new PlaneGeometry(1, 0.55, FOG_CARD_SEGS, FOG_CARD_SEGS);
            geometry.rotateX(-Math.PI / 2);
            geometry.setAttribute(
                'color',
                new BufferAttribute(new Float32Array(geometry.attributes.position!.count * 4).fill(1), 4),
            );
            const mesh = new Mesh(geometry, material);
            const lift = 2 + rng() * 2.5;
            mesh.position.set(x, h + lift, z);
            const s = 35 + rng() * 45;
            mesh.scale.set(s, 1, s * (0.5 + rng() * 0.3));
            mesh.rotation.y = rng() * Math.PI * 2;
            const card = {
                mesh,
                baseX: x,
                phase: rng() * Math.PI * 2,
                speed: 0.03 + rng() * 0.05,
                lift,
                homeY: h,
            };
            this.fogCards.push(card);
            this.drapeFogCard(card);
            this.group.add(mesh);
            placed++;
        }
    }

    /**
     * Lay a fog card over the ground under it: every vertex stays `lift` above the terrain, so
     * the fog hugs the ground and flows up the foot of a slope instead of the rising ground
     * cutting through a flat card. It thins as it climbs above where it formed, so it never
     * turns into a wall up a mountainside.
     */
    private drapeFogCard(card: FogCard): void {
        const { mesh } = card;
        const pos = mesh.geometry.attributes.position as BufferAttribute;
        const col = mesh.geometry.attributes.color as BufferAttribute;
        const c = Math.cos(mesh.rotation.y);
        const sn = Math.sin(mesh.rotation.y);
        const sx = mesh.scale.x;
        const sz = mesh.scale.z;
        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i) * sx;
            const lz = pos.getZ(i) * sz;
            const wx = mesh.position.x + lx * c + lz * sn;
            const wz = mesh.position.z - lx * sn + lz * c;
            const ground = this.terrainHeight(wx, wz);
            pos.setY(i, ground + card.lift - mesh.position.y);
            const climb = ground - card.homeY;
            col.setW(i, 1 - smooth01((climb - (card.thinFrom ?? 3)) / (card.thinOver ?? 10)));
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
    }

    /**
     * Ultra: banks of cloud lying on the mountain shelves, so the range sits in
     * the air instead of standing on the meadow. Big flat cards, drifting a little,
     * placed only on gentle ground (a flat card meeting a steep slope shows a hard
     * seam) and lifted well clear of it. Opacity and tint follow the forest fog:
     * thick in rain and haze, a thin veil on a clear day, pale over snow.
     */
    private createMountainMist(map: BattleMap, rng: () => number): void {
        const material = new MeshBasicMaterial({
            map: this.cloudTexture,
            transparent: true,
            depthWrite: false,
            opacity: 0,
            // per-vertex alpha: the bank thins where it would climb a face (see drapeFogCard)
            vertexColors: true,
        });
        this.mountainMistMaterial = material;
        const COUNT = 30;
        const S = 10;
        let placed = 0;
        for (let attempt = 0; attempt < 6000 && placed < COUNT; attempt++) {
            const x = (rng() * 2 - 1) * (map.halfW + this.reach);
            const z = (rng() * 2 - 1) * (map.halfH + this.reach);
            const d = pastBoard(map.halfW, map.halfH, x, z);
            if (d < 120 * this.os || d > this.reach - 30 * this.os) continue;
            const h = this.terrainHeight(x, z);
            if (h < 35 || h > 260) continue;
            if (this.lakeAt(x, z) > 0.05) continue;
            const slope = Math.max(
                Math.abs(this.terrainHeight(x + S, z) - h),
                Math.abs(this.terrainHeight(x, z + S) - h),
                Math.abs(this.terrainHeight(x - S, z) - h),
                Math.abs(this.terrainHeight(x, z - S) - h),
            ) / S;
            if (slope > 0.4) continue;
            // a grid draped over the shelf like the forest fog, so a bank drifting toward a slope
            // flows over it instead of the mountain cutting a hard line through a flat card
            const geometry = new PlaneGeometry(1, 0.6, FOG_CARD_SEGS, FOG_CARD_SEGS);
            geometry.rotateX(-Math.PI / 2);
            geometry.setAttribute(
                'color',
                new BufferAttribute(new Float32Array(geometry.attributes.position!.count * 4).fill(1), 4),
            );
            const mesh = new Mesh(geometry, material);
            const lift = 9 + rng() * 9;
            mesh.position.set(x, h + lift, z);
            const sc = 70 + rng() * 80;
            mesh.scale.set(sc, 1, sc * (0.5 + rng() * 0.3));
            mesh.rotation.y = rng() * Math.PI * 2;
            mesh.renderOrder = 2;
            const bank: FogCard = {
                mesh,
                baseX: x,
                phase: rng() * Math.PI * 2,
                speed: 0.02 + rng() * 0.03,
                lift,
                homeY: h,
                // a bank may climb further before it thins: it lies on a mountain
                thinFrom: 10,
                thinOver: 25,
            };
            this.mistBanks.push(bank);
            this.drapeFogCard(bank);
            this.group.add(mesh);
            placed++;
        }
    }

    /**
     * Ultra: the super mountain's summit wears cloud. On a peak this high the top is rarely clear —
     * moisture condenses on it even in fine weather — so each carries a cap of large soft puffs
     * wrapped round and a little in front of the summit, plus a banner of snow streaming off
     * downwind. Fine weather leaves a small cap that comes and goes; fog, rain and snow bury the
     * peak in it. Camera-facing sprites: no card edges or crossings from any side.
     */
    private createSnowPlumes(map: BattleMap, rng: () => number): void {
        // one peak only: the super mountain
        const chosen: { x: number; z: number; h: number }[] = [];
        if (this.superPeak) {
            // (the summit is the highest point on the cone: search the top of it)
            let top = { x: this.superPeak.x, z: this.superPeak.z, h: -Infinity };
            for (let i = 0; i < 400; i++) {
                const x = this.superPeak.x + (rng() * 2 - 1) * 20;
                const z = this.superPeak.z + (rng() * 2 - 1) * 20;
                const h = this.terrainHeight(x, z);
                if (h > top.h) top = { x, z, h };
            }
            chosen.push(top);
        }
        const makePuff = (): { sprite: Sprite; material: SpriteMaterial } => {
            const material = new SpriteMaterial({
                map: this.cloudTexture,
                color: 0xffffff,
                transparent: true,
                depthWrite: false,
                opacity: 0,
            });
            const sprite = new Sprite(material);
            sprite.renderOrder = 4;
            sprite.visible = false;
            this.group.add(sprite);
            return { sprite, material };
        };
        const BANNER = 7;
        const CAP_MAX = 18;
        for (const c of chosen) {
            // the super mountain carries the full cloud, and a little more than the cap once had
            const k = 1.25;
            const CAP = CAP_MAX + 6;
            const len = Math.sqrt(c.x * c.x + c.z * c.z) || 1;
            const plume: (typeof this.snowPlumes)[number] = {
                crest: new Vector3(c.x, c.h - 2, c.z),
                center: new Vector3(c.x - (c.x / len) * 24 * k, c.h - 2, c.z - (c.z / len) * 24 * k),
                length: (100 + rng() * 60) * (0.6 + 0.4 * k),
                phase: rng() * Math.PI * 2,
                puffs: [],
                cap: [],
            };
            for (let i = 0; i < BANNER; i++) {
                plume.puffs.push({ ...makePuff(), offset: (i + rng() * 0.6) / BANNER, size: (0.8 + rng() * 0.5) * (0.6 + 0.4 * k) });
            }
            for (let i = 0; i < CAP; i++) {
                plume.cap.push({
                    ...makePuff(),
                    angle: rng() * Math.PI * 2,
                    radius: Math.sqrt(rng()) * 42 * k,
                    height: (-10 + rng() * 30) * k,
                    spin: (rng() < 0.5 ? -1 : 1) * (0.02 + rng() * 0.04),
                    size: (55 + rng() * 45) * k,
                    rank: (i + rng() * 0.8) / CAP,
                });
            }
            this.snowPlumes.push(plume);
        }
    }

    /** per frame: how much of each summit is under cloud (0.25 in perfect weather, up to 1) */
    private updateSummitClouds(): void {
        if (this.snowPlumes.length === 0) return;
        const ultra = this.quality === 'ultra';
        const w = this.weather;
        const bad = w && w.weatherKind !== 'clear' ? 0.45 + 0.55 * w.weatherIntensity : 0;
        const fog = this.forestFogMaterial?.opacity ?? 0;
        const cover = Math.min(1, 0.25 + bad * 0.75 + fog * 0.7);
        // grey under rain and snow, bright white in the sun
        const grey = 1 - bad * 0.22;
        for (const plume of this.snowPlumes) {
            // even in fine weather the cap swells and thins over minutes
            const breath = 0.72 + 0.28 * Math.sin(this.time * 0.045 + plume.phase);
            const shown = cover * breath;
            for (const puff of plume.cap) {
                const weight = smooth01((shown * 1.2 - puff.rank) / 0.22);
                puff.sprite.visible = ultra && weight > 0.01;
                if (!puff.sprite.visible) continue;
                const a = puff.angle + this.time * puff.spin;
                puff.sprite.position.set(
                    plume.center.x + Math.cos(a) * puff.radius,
                    plume.center.y + puff.height + Math.sin(this.time * 0.13 + puff.angle * 3) * 2.5,
                    plume.center.z + Math.sin(a) * puff.radius,
                );
                const size = puff.size * (0.9 + 0.1 * Math.sin(this.time * 0.09 + puff.angle));
                puff.sprite.scale.set(size * 1.5, size, 1);
                puff.material.opacity = 0.55 * weight;
                puff.material.color.setScalar(grey);
            }
            // the banner: snow leaving the crest, only when the air is clear enough to see it
            const clearAir = ultra ? 1 - Math.min(1, cover * 0.9) : 0;
            for (const puff of plume.puffs) {
                // age 0 = just left the crest, 1 = gone; the opacity is zero at both ends
                const age = (this.time * 0.04 + puff.offset) % 1;
                const fade = Math.sin(age * Math.PI);
                puff.sprite.visible = clearAir > 0.02;
                puff.material.opacity = (0.3 + this.groundSnowCover * 0.2) * fade * fade * clearAir;
                puff.sprite.position.set(
                    plume.crest.x + SNOW_WIND.x * plume.length * age,
                    plume.crest.y + 4 + age * 14,
                    plume.crest.z + SNOW_WIND.z * plume.length * age,
                );
                const size = (16 + age * 34) * puff.size;
                puff.sprite.scale.set(size * 1.6, size, 1);
            }
        }
    }

    /**
     * Matches the outer-ground shader's rock mix (height + slope).
     * 0 = full grass, 1 = full stone — trees only belong on low values.
     */
    private rockFactorAt(x: number, z: number): number {
        const h = this.terrainHeight(x, z);
        const snowF = smooth01((h - 170) / 65);
        const heightRock = smooth01((h - 16) / 39); // smoothstep(16, 55)
        const eps = 2;
        const dhdx = (this.terrainHeight(x + eps, z) - this.terrainHeight(x - eps, z)) / (2 * eps);
        const dhdz = (this.terrainHeight(x, z + eps) - this.terrainHeight(x, z - eps)) / (2 * eps);
        const ny = 1 / Math.hypot(dhdx, 1, dhdz);
        const slope = 1 - ny;
        const slopeRock = smooth01((slope - 0.32) / 0.26) * smooth01((h - 3) / 6);
        return Math.max(heightRock, slopeRock) * (1 - snowF) * (1 - this.alpineMeadowAt(x, z, h));
    }

    /** 0..1 how well this spot holds snow — slope sheds it, altitude adds it back on peaks. */
    private snowRetentionAt(x: number, z: number, h = this.terrainHeight(x, z)): number {
        const eps = 2;
        const dhdx = (this.terrainHeight(x + eps, z) - this.terrainHeight(x - eps, z)) / (2 * eps);
        const dhdz = (this.terrainHeight(x, z + eps) - this.terrainHeight(x, z - eps)) / (2 * eps);
        const ny = 1 / Math.hypot(dhdx, 1, dhdz);
        const slope = 1 - ny;
        const slopeHold = 1 - smooth01((slope - 0.24) / 0.5) * 0.72;
        const peakBoost = smooth01((h - 120) / 100);
        return Math.min(1, slopeHold + peakBoost * 0.75);
    }

    /**
     * Ultra: rock layers and distance haze baked into a mountain vertex's tint.
     * Steep faces get warm/cool sedimentary bands (tilted, noise-warped so they
     * are not rulers); the far ring cools toward blue like distant ridges do.
     */
    private tintMountainVertex(rock: Color, x: number, z: number, h: number): void {
        const S = 8;
        const slope = Math.max(
            Math.abs(this.terrainHeight(x + S, z) - h),
            Math.abs(this.terrainHeight(x, z + S) - h),
        ) / S;
        // (fades out above ~110 wu, where snow lies: a band pattern in the vertex tint is what
        // showed as horizontal lines through thin snow)
        const face = smooth01((slope - 0.35) / 0.9) * (1 - smooth01((h - 90) / 50));
        if (face > 0) {
            // layer coordinate: height, tilted, warped hard by noise so no layer runs like a ruler
            const warp = (this.noise(x / 45 + 12.4, z / 45 + 5.9) - 0.5) * 34;
            const layer = (h + x * 0.09 + z * 0.05 + warp) / 13;
            const band = Math.sin(layer * 6.2832) * 0.5 + 0.5;
            const k = 1 + (band - 0.5) * 0.14 * face;
            rock.multiplyScalar(k);
        }
        // aerial perspective: far ring lighter and bluer
        const dOut = Math.max(Math.abs(x) - this.map.halfW, Math.abs(z) - this.map.halfH, 0);
        const far = smooth01((dOut - 140 * this.os) / (300 * this.os));
        if (far > 0) {
            rock.r = rock.r * (1 - far * 0.22) + 0.62 * far * 0.22;
            rock.g = rock.g * (1 - far * 0.16) + 0.72 * far * 0.16;
            rock.b = rock.b * (1 - far * 0.08) + 0.90 * far * 0.08;
        }
    }

    /** 0..1 alm: the two flat mountain meadows (grass holds on, a few trees stand) */
    private alpineMeadowAt(x: number, z: number, _h?: number): number {
        let best = 0;
        for (const site of this.almSites) {
            const d = Math.hypot(x - site.x, z - site.z);
            best = Math.max(best, 1 - smooth01((d - ALM_RADIUS * 0.9) / 24));
        }
        return best;
    }

    /** True where the meadow texture still reads green (not mountain stone). */
    private isGrassy(x: number, z: number): boolean {
        return this.rockFactorAt(x, z) < 0.32;
    }

    /**
     * 0..1 scree pockets on mountains — concave gullies/corners and talus
     * piled at cliff bases (stones fall and stock up), not open slopes.
     */
    private screeAccumAt(x: number, z: number, h: number): number {
        if (h < 14) return 0;
        const hAt = (dx: number, dz: number) => this.terrainHeight(x + dx, z + dz);
        // sample at mountain scale — gullies/corners are tens of wu wide, not mesh-sized
        const near = 18;
        const far = 48;
        const ring8 =
            (hAt(-near, 0) +
                hAt(near, 0) +
                hAt(0, -near) +
                hAt(0, near) +
                hAt(-near, -near) +
                hAt(near, -near) +
                hAt(-near, near) +
                hAt(near, near)) /
            8;
        const pocket = smooth01((ring8 - h) / 5.5);
        const lapFar =
            (hAt(-far, 0) + hAt(far, 0) + hAt(0, -far) + hAt(0, far) - 4 * h) / far;
        const concave = smooth01(Math.max(0, lapFar) * 0.45);
        const cliffR = 24;
        const cliffSlopes = [
            Math.abs(hAt(cliffR, 0) - h) / cliffR,
            Math.abs(hAt(-cliffR, 0) - h) / cliffR,
            Math.abs(hAt(0, cliffR) - h) / cliffR,
            Math.abs(hAt(0, -cliffR) - h) / cliffR,
            Math.abs(hAt(cliffR, cliffR) - h) / (cliffR * 1.414),
            Math.abs(hAt(-cliffR, cliffR) - h) / (cliffR * 1.414),
        ];
        const cliffNearby = smooth01((Math.max(...cliffSlopes) - 0.22) / 0.32);
        const fine = 5;
        const dhdx = (hAt(fine, 0) - hAt(-fine, 0)) / (2 * fine);
        const dhdz = (hAt(0, fine) - hAt(0, -fine)) / (2 * fine);
        const localSlope = Math.hypot(dhdx, dhdz);
        const talusBed = (1 - smooth01((localSlope - 0.28) / 0.42)) * cliffNearby;
        let scree = Math.max(pocket, concave * 0.88, talusBed * 0.72);
        scree *= smooth01((h - 14) / 22) * (1 - smooth01((h - 200) / 85));
        scree *= 0.78 + 0.22 * this.noise(x / 23 + 61.3, z / 23 + 14.8);
        return Math.min(1, scree);
    }

    /** 0..1 — moss only on mid-elevation mountains (not foothills or high peaks). */
    private mediumAltBand(h: number): number {
        return smooth01((h - 40) / 22) * (1 - smooth01((h - 100) / 24));
    }

    /**
     * 0..1 moss/lichen on cliff walls — shaded vertical faces and crevices,
     * not scree beds (those stay gravel).
     */
    private mossAccumAt(
        x: number,
        z: number,
        h: number,
        nx: number,
        ny: number,
        nz: number,
        screeLocal: number,
    ): number {
        const midAlt = this.mediumAltBand(h);
        if (midAlt <= 0) return 0;
        const hAt = (dx: number, dz: number) => this.terrainHeight(x + dx, z + dz);
        const sunLen = Math.hypot(0.4, 0.82, 0.25);
        const facing = (nx * 0.4 + ny * 0.82 + nz * 0.25) / sunLen;
        const shadeBoost = 0.72 + 0.28 * smooth01((0.25 - facing) / 0.55);
        const wall = 1 - smooth01((ny - 0.58) / 0.34);
        const near = 16;
        const ring = (hAt(-near, 0) + hAt(near, 0) + hAt(0, -near) + hAt(0, near)) * 0.25;
        const crevice = smooth01((ring - h) / 4.8) * (0.35 + 0.65 * wall);
        const fine = 5;
        const localSlope = Math.hypot(
            (hAt(fine, 0) - hAt(-fine, 0)) / (2 * fine),
            (hAt(0, fine) - hAt(0, -fine)) / (2 * fine),
        );
        const cliffFace = smooth01((localSlope - 0.24) / 0.48) * (0.45 + 0.55 * wall);
        let moss = Math.max(crevice, cliffFace, wall * 0.58);
        moss *= shadeBoost * midAlt;
        moss *= 1 - screeLocal * 0.7;
        moss *= 0.68 + 0.32 * this.noise(x / 13 + 22.7, z / 13 + 8.4);
        return Math.min(1, moss);
    }

    /** builds the scenario system driving sky, fog, lights, clouds, rain/snow, stars */
    createWeather(
        scene: Scene,
        sun: DirectionalLight,
        hemi: HemisphereLight,
        renderer: WebGLRenderer,
        seed: number,
        effectToggles?: EffectToggles,
    ): Weather {
        this.weather = new Weather(
            {
                scene,
                sun,
                hemi,
                renderer,
                repaintSky: this.repaintSky,
                glow: this.sunGlow,
                cloudMaterial: this.cloudMaterial,
                cloudTexture: this.cloudTexture,
                forestFogMaterial: this.forestFogMaterial,
                forestFogScale: Math.min(1.2, sceneryHeightFog(this.quality)),
                skyGroup: this.skyGroup,
                worldGroup: this.group,
                map: this.map,
                onSeasonChange: (season, immediate) => this.setSeason(season, immediate),
                effectToggles,
                suppressVisualWeatherFx: !this.detailed,
            },
            seed,
        );
        this.sunLight = sun;
        return this.weather;
    }

    /** Drive billboard ground blobs when weather is off (createWeather also sets this). */
    attachSun(sun: DirectionalLight): void {
        this.sunLight = sun;
    }

    /**
     * Hammer of the Gods: squash trees/bushes/floor props inside the oriented
     * rect into the dirt. Restored by {@link clearHammerCrush} when battle ends.
     * Instances whose XZ sits under a living ward disc are skipped.
     */
    crushInRect(
        x: number,
        z: number,
        halfWidth: number,
        halfDepth: number,
        yaw: number,
        shields: readonly { x: number; z: number; radius: number }[] = [],
    ): void {
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const mat = new Matrix4();
        const pos = new Vector3();
        const quat = new Quaternion();
        const scl = new Vector3();
        const touched = new Set<InstancedMesh>();

        const inside = (px: number, pz: number): boolean => {
            const dx = px - x;
            const dz = pz - z;
            const lx = dx * c + dz * sn;
            const lz = -dx * sn + dz * c;
            return Math.abs(lx) <= halfWidth && Math.abs(lz) <= halfDepth;
        };
        const underWard = (px: number, pz: number): boolean => {
            for (const s of shields) {
                const dx = px - s.x;
                const dz = pz - s.z;
                if (dx * dx + dz * dz <= s.radius * s.radius) return true;
            }
            return false;
        };

        this.group.traverse((o) => {
            const mesh = o as InstancedMesh;
            if (!mesh.isInstancedMesh || mesh.count <= 0) return;
            if (mesh.parent === this.skyGroup) return;
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, mat);
                mat.decompose(pos, quat, scl);
                if (!inside(pos.x, pos.z)) continue;
                if (underWard(pos.x, pos.z)) continue;
                if (this.crushRestore.some((r) => r.mesh === mesh && r.index === i)) continue;
                this.crushRestore.push({ mesh, index: i, matrix: mat.clone() });
                scl.x *= 1.2;
                scl.z *= 1.2;
                scl.y *= 0.04;
                pos.y -= Math.max(0.05, Math.abs(scl.y) * 0.35);
                mat.compose(pos, quat, scl);
                mesh.setMatrixAt(i, mat);
                touched.add(mesh);
            }
        });
        for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
    }

    /** Undo hammer scenery crush (call when leaving battle phase). */
    clearHammerCrush(): void {
        const touched = new Set<InstancedMesh>();
        for (const r of this.crushRestore) {
            r.mesh.setMatrixAt(r.index, r.matrix);
            touched.add(r.mesh);
        }
        for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
        this.crushRestore.length = 0;
    }

    /** 0..1 how much snow currently lies on the ground (drives the board's own snow blend too) */
    get groundSnowCover(): number {
        return this.weather?.groundSnow ?? 0;
    }

    /**
     * Begin easing foliage toward a season (tint, billboard maps, flowers, litter).
     * Atmosphere already lerps on its own clock; foliage uses the same {@link TRANSITION_TAU}.
     */
    setSeason(season: Season, immediate = false): void {
        if (immediate) snapVegetationSeason(season);
        else setVegetationSeason(season);
        this.flowerOpacityTarget =
            season === 'spring' ? 1 : season === 'summer' ? 0.85 : season === 'autumn' ? 0.45 : 0.15;
        this.litterOpacityTarget = season === 'autumn' ? 1 : 0;
        this.alpineCapTarget = season === 'summer' ? 0 : 1;
        this.summerDryTarget = season === 'summer' ? 0.72 : 0;
        if (immediate) {
            this.outerGroundAlpineUniform.value = this.alpineCapTarget;
            summerDryUniform.value = this.summerDryTarget;
        }
        if (!immediate) return;
        for (const m of this.flowerMaterials) m.opacity = this.flowerOpacityTarget;
        if (this.leafLitter) {
            const mat = this.leafLitter.material as MeshStandardMaterial;
            mat.opacity = this.litterOpacityTarget;
            this.leafLitter.visible = mat.opacity > 0.02;
        }
        setVegetationSnowCover(this.groundSnowCover);
        snapBuildingSnowCover(this.groundSnowCover, this.weather?.weatherKind === 'snow');
    }

    update(dtSeconds: number, cameraPos: Vector3): void {
        this.skyGroup.position.set(cameraPos.x, 0, cameraPos.z);
        this.weather?.update(dtSeconds, cameraPos);
        updateVegetationSeason(dtSeconds);
        const seasonK = Math.min(1, dtSeconds / TRANSITION_TAU);
        for (const m of this.flowerMaterials) {
            m.opacity += (this.flowerOpacityTarget - m.opacity) * seasonK;
        }
        if (this.leafLitter) {
            const mat = this.leafLitter.material as MeshStandardMaterial;
            mat.opacity += (this.litterOpacityTarget - mat.opacity) * seasonK;
            this.leafLitter.visible = mat.opacity > 0.02;
        }
        this.outerGroundAlpineUniform.value +=
            (this.alpineCapTarget - this.outerGroundAlpineUniform.value) * seasonK;
        summerDryUniform.value += (this.summerDryTarget - summerDryUniform.value) * seasonK;
        if (this.outerGroundSnowUniform) this.outerGroundSnowUniform.value = this.groundSnowCover;
        setVegetationSnowCover(this.groundSnowCover);
        this.updateReedFrost(this.groundSnowCover);
        updateBuildingSnowCover(
            dtSeconds,
            this.groundSnowCover,
            this.weather?.weatherKind === 'snow',
        );
        // lakes freeze once snow reaches meadow/board level (same snow-line gate)
        if (this.waterFreezeUniform && this.waterMaterial?.userData.iceReady) {
            const cover = this.groundSnowCover;
            const snowLine = 220 - (220 - -15) * cover;
            const freeze = Math.min(1, Math.max(0, (0 - (snowLine - 40)) / 55));
            this.waterFreezeUniform.value = freeze;
            // the matte (medium) water has no gloss to lose
            if (this.waterMaterial instanceof MeshStandardMaterial) {
                this.waterMaterial.roughness = this.waterRoughness + freeze * 0.55;
            }
            this.waterMaterial.opacity = this.waterOpacity + freeze * (0.98 - this.waterOpacity);
            // nothing green floats on ice: pads and blossoms fade out as it forms
            const plantK = 1 - Math.min(1, Math.max(0, (freeze - 0.05) / 0.5));
            for (const mesh of this.lakeSurfacePlants) {
                (mesh.material as MeshStandardMaterial).opacity = plantK;
                mesh.visible = plantK > 0.02;
            }
        }
        this.time += dtSeconds;
        if (this.waterTimeUniform) this.waterTimeUniform.value = this.time;
        if (this.lakeDepthUsed) this.ensureLakeDepth();
        this.lakeTimeUniform.value = this.time;
        for (const c of this.clouds) {
            c.mesh.position.x += c.speed * dtSeconds;
            if (c.mesh.position.x > this.cloudBoundsX) c.mesh.position.x = -this.cloudBoundsX;
        }
        for (const p of this.peakClouds) {
            p.mesh.position.x = p.baseX + Math.sin(this.time * p.speed + p.phase) * 12;
        }
        const fogOn = (this.forestFogMaterial?.opacity ?? 0) > 0.02;
        this.fogDrapeTick = (this.fogDrapeTick + 1) % FOG_DRAPE_EVERY;
        for (let i = 0; i < this.fogCards.length; i++) {
            const f = this.fogCards[i]!;
            f.mesh.position.x = f.baseX + Math.sin(this.time * f.speed + f.phase) * 8;
            f.mesh.visible = fogOn;
            // the drift is slow (under a unit a second): each card follows the ground a few
            // times a second, a share of the cards per frame
            if (fogOn && i % FOG_DRAPE_EVERY === this.fogDrapeTick) this.drapeFogCard(f);
        }
        const mistMat = this.mountainMistMaterial;
        if (mistMat) {
            const fog = this.forestFogMaterial;
            // a thin veil always, the weather's fog on top; snow bleaches it
            const op = Math.min(0.5, 0.13 + (fog?.opacity ?? 0) * 0.9);
            mistMat.opacity = this.quality === 'ultra' ? op : 0;
            if (fog) mistMat.color.copy(fog.color).lerp(MIST_SNOW_WHITE, this.groundSnowCover * 0.6);
            for (let i = 0; i < this.mistBanks.length; i++) {
                const b = this.mistBanks[i]!;
                b.mesh.position.x = b.baseX + Math.sin(this.time * b.speed + b.phase) * 22;
                b.mesh.visible = op > 0.02;
                if (b.mesh.visible && i % FOG_DRAPE_EVERY === this.fogDrapeTick) this.drapeFogCard(b);
            }
        }
        this.updateSummitClouds();
        // low: the flat water freezes by colour alone (there is no ice texture)
        if (this.flatWaterMaterial) {
            const cover = this.groundSnowCover;
            const snowLine = 220 - (220 - -15) * cover;
            const freeze = Math.min(1, Math.max(0, (0 - (snowLine - 40)) / 55));
            this.flatWaterMaterial.color.copy(FLAT_WATER_COLOR).lerp(FLAT_WATER_ICE, freeze);
            this.flatWaterMaterial.opacity = 0.9 + freeze * 0.08;
        }
        // slow ripple drift on the lakes — stops once mostly frozen
        if (this.waterTexture && (this.waterFreezeUniform?.value ?? 0) < 0.85) {
            const thaw = 1 - (this.waterFreezeUniform?.value ?? 0);
            this.waterTexture.offset.x += dtSeconds * 0.006 * thaw;
            this.waterTexture.offset.y += dtSeconds * 0.0035 * thaw;
        }
        if (this.grassField) {
            this.grassField.snowCover.value = this.groundSnowCover;
            const rev = this.map.terrain.revision;
            this.grassField.update(this.time, this.map.wearMask, this.map.stainTintMask, rev !== this.grassTerrainRev);
            this.grassField.updateView(cameraPos);
            this.grassTerrainRev = rev;
        }
        if (this.tuftMaterial?.userData.shader) {
            this.tuftMaterial.userData.shader.uniforms.uTime!.value = this.time;
            this.tuftMaterial.userData.shader.uniforms.uSnowCover!.value = this.groundSnowCover;
        }
        if (this.sunLight) {
            this.treeShadows.update(this.sunLight.position, this.sunLight.intensity);
        }
    }

    /**
     * The water table: one flat translucent plane at y = -1.1. It is hidden
     * under the terrain everywhere, EXCEPT where a lake basin dips below it.
     * A painted ripple texture drifts slowly to make it read as water; under
     * snow cover it crossfades to a frozen ice albedo.
     */
    private createWater(): Mesh {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#3d7fb4';
        ctx.fillRect(0, 0, 256, 256);
        const rng = mulberry32(1234);
        // light wavy ripple strokes, drawn twice with an offset so they tile
        ctx.strokeStyle = 'rgba(210, 235, 255, 0.16)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 26; i++) {
            const y0 = rng() * 256;
            const amp = 2 + rng() * 3;
            const len = 40 + rng() * 80;
            const x0 = rng() * 256;
            for (const [ox, oy] of [
                [0, 0],
                [-256, 0],
                [0, -256],
            ] as const) {
                ctx.beginPath();
                for (let x = 0; x <= len; x += 6) {
                    const px = x0 + x + ox;
                    const py = y0 + Math.sin(x * 0.15) * amp + oy;
                    if (x === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
        }
        this.waterTexture = new CanvasTexture(canvas);
        this.waterTexture.colorSpace = SRGBColorSpace;
        this.waterTexture.wrapS = this.waterTexture.wrapT = RepeatWrapping;
        this.waterTexture.repeat.set(this.worldSize / 14, this.worldSize / 14);

        const geometry = new PlaneGeometry(this.worldSize, this.worldSize);
        geometry.rotateX(-Math.PI / 2);
        const freezeUniform = { value: 0 };
        const iceUniform: { value: import('three').Texture | null } = { value: null };
        this.waterFreezeUniform = freezeUniform;
        // Medium water is matte: a Lambert has no specular term at all, so the
        // sun leaves no glint on it (and it is the cheaper shader for that
        // tier). High and up keep the glossy standard material.
        const baseOpacity = this.waterBaseOpacity();
        const material =
            this.quality === 'medium'
                ? new MeshLambertMaterial({
                    map: this.waterTexture,
                    transparent: true,
                    opacity: baseOpacity,
                })
                : new MeshStandardMaterial({
                    map: this.waterTexture,
                    transparent: true,
                    opacity: baseOpacity,
                    roughness: this.quality === 'ultra' ? WATER_ULTRA_ROUGHNESS : 0.18,
                    metalness: 0,
                });
        this.waterMaterial = material;
        this.waterOpacity = baseOpacity;
        this.waterRoughness = this.quality === 'ultra' ? WATER_ULTRA_ROUGHNESS : 0.18;
        // High and ultra: ripples, depth colour and a reflection. Ultra mirrors the
        // world itself (see waterReflection.ts); high reflects the sky gradient
        // only, analytically, with no second render. The other tiers keep the
        // plain shader.
        const rich = this.quality === 'ultra' || this.quality === 'high';
        // Medium: still matte and still, but it knows its depth — the colour and
        // the soft shore, for one texture read
        const lite = this.quality === 'medium';
        const reflection = this.quality === 'ultra' ? new WaterReflection(WATER_LEVEL_Y) : null;
        this.waterReflection = reflection;
        this.lakeDepthUsed = rich || lite;
        const timeUniform = { value: 0 };
        this.waterTimeUniform = rich ? timeUniform : null;
        // one program per variant: the source differs, the function text does not
        material.customProgramCacheKey = () =>
            reflection ? 'water-mirror2' : rich ? 'water-sky2' : lite ? 'water-depth' : 'water';
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uFreeze = freezeUniform;
            shader.uniforms.uIce = iceUniform;
            let frag = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `#include <map_fragment>
	if (uFreeze > 0.001) {
		vec3 iceCol = texture2D(uIce, vMapUv).rgb;
		diffuseColor.rgb = mix(diffuseColor.rgb, iceCol, uFreeze);
	}`,
            );
            if (rich) {
                shader.uniforms.uWaterTime = timeUniform;
                shader.uniforms.uLakeDepthTex = this.lakeDepthTexUniform;
                shader.uniforms.uLakeDepthSpan = this.lakeDepthSpanUniform;
                shader.vertexShader =
                    'varying vec3 vWaterWorld;\n' +
                    shader.vertexShader.replace(
                        '#include <project_vertex>',
                        `#include <project_vertex>
	vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
                    );
                let reflectBlock: string;
                let reflectDecls: string;
                if (reflection) {
                    shader.uniforms.uReflTex = reflection.uniforms.uReflTex;
                    shader.uniforms.uReflMatrix = reflection.uniforms.uReflMatrix;
                    shader.uniforms.uReflOn = reflection.uniforms.uReflOn;
                    reflectDecls = WATER_MIRROR_UNIFORMS;
                    // blend the mirrored world in by fresnel
                    reflectBlock = `if (uReflOn > 0.5) {
		vec3 wView = normalize(cameraPosition - vWaterWorld);
		vec3 wNormal = normalize(vec3(-wGrad.x, 1.0, -wGrad.y));
		float nv = clamp(dot(wNormal, wView), 0.0, 1.0);
		float fres = ${WATER_REFLECT_F0} + (1.0 - ${WATER_REFLECT_F0}) * pow(1.0 - nv, ${WATER_REFLECT_POWER});
		// ice does not mirror
		fres *= 1.0 - smoothstep(0.0, 0.6, uFreeze);
		vec4 rc = uReflMatrix * vec4(vWaterWorld, 1.0);
		rc.xy += wGrad * ${WATER_REFLECT_DISTORT} * rc.w;
		vec3 mirrored = texture2DProj(uReflTex, rc).rgb;
		outgoingLight = mix(outgoingLight, mirrored, fres);
		diffuseColor.a = mix(diffuseColor.a, 1.0, fres);
	}`;
                } else {
                    shader.uniforms.uSkyZenith = this.waterSky.zenith;
                    shader.uniforms.uSkyMid = this.waterSky.mid;
                    shader.uniforms.uSkyHorizon = this.waterSky.horizon;
                    reflectDecls = WATER_SKY_UNIFORMS;
                    // the sky itself, read off the reflected ray: the same three colours
                    // the dome is painted with (horizon at 0°, mid at ~32°, zenith at 90°)
                    reflectBlock = `{
		vec3 wView = normalize(cameraPosition - vWaterWorld);
		vec3 wNormal = normalize(vec3(-wGrad.x, 1.0, -wGrad.y));
		float nv = clamp(dot(wNormal, wView), 0.0, 1.0);
		float fres = ${WATER_SKY_F0} + (1.0 - ${WATER_SKY_F0}) * pow(1.0 - nv, ${WATER_SKY_POWER});
		fres *= (1.0 - smoothstep(0.0, 0.6, uFreeze)) * ${WATER_SKY_STRENGTH};
		vec3 wRefl = reflect(-wView, wNormal);
		float elev = asin(clamp(wRefl.y, 0.0, 1.0)) / 1.5707963;
		vec3 wSky = elev < 0.36
			? mix(uSkyHorizon, uSkyMid, elev / 0.36)
			: mix(uSkyMid, uSkyZenith, (elev - 0.36) / 0.64);
		outgoingLight = mix(outgoingLight, wSky, fres);
		diffuseColor.a = mix(diffuseColor.a, 1.0, fres);
	}`;
                }
                frag =
                    WATER_DEPTH_DECLS +
                    WATER_RIPPLE_DECLS +
                    reflectDecls +
                    frag
                        .replace(
                            '#include <map_fragment>',
                            `#include <map_fragment>${WATER_DEPTH_SNIPPET}`,
                        )
                        // ripple the normal so the sun breaks into sparkle
                        .replace(
                            '#include <normal_fragment_maps>',
                            `#include <normal_fragment_maps>
	// small water is calmer: less fetch, so the ripples ease off on ponds and narrow lakes
	float wSize = smoothstep(${LAKE_SIZE_SMALL.toFixed(2)}, ${LAKE_SIZE_BIG.toFixed(2)}, texture2D(uLakeDepthTex, (vWaterWorld.xz + uLakeDepthSpan) / (2.0 * uLakeDepthSpan)).g);
	vec2 wGrad = waterWaveGrad(vWaterWorld.xz, uWaterTime) * mix(${LAKE_SMALL_RIPPLE.toFixed(2)}, 1.0, wSize);
	normal = normalize(normal + (viewMatrix * vec4(-wGrad.x, 0.0, -wGrad.y, 0.0)).xyz * ${WATER_NORMAL_TILT});`,
                        )
                        .replace(
                            '#include <opaque_fragment>',
                            `${reflectBlock}
	#include <opaque_fragment>`,
                        );
            }
            else if (lite) {
                shader.uniforms.uLakeDepthTex = this.lakeDepthTexUniform;
                shader.uniforms.uLakeDepthSpan = this.lakeDepthSpanUniform;
                shader.vertexShader =
                    'varying vec3 vWaterWorld;\n' +
                    shader.vertexShader.replace(
                        '#include <project_vertex>',
                        `#include <project_vertex>
	vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
                    );
                frag =
                    WATER_DEPTH_DECLS +
                    frag.replace(
                        '#include <map_fragment>',
                        `#include <map_fragment>${WATER_DEPTH_SNIPPET}`,
                    );
            }
            shader.fragmentShader = 'uniform float uFreeze;\nuniform sampler2D uIce;\n' + frag;
        };
        void loadWorldTexture(iceAlbedoUrl()).then((ice) => {
            if (!ice) return;
            ice.wrapS = ice.wrapT = RepeatWrapping;
            ice.repeat.set(90, 90);
            ice.colorSpace = SRGBColorSpace;
            iceUniform.value = ice;
            material.userData.iceReady = true;
            material.needsUpdate = true;
        });

        const mesh = new Mesh(geometry, material);
        mesh.position.y = WATER_LEVEL_Y;
        mesh.receiveShadow = true;
        this.waterMesh = mesh;
        return mesh;
    }

    /** how see-through the unfrozen water is: ultra shows the lake bed most, medium stays dense */
    private waterBaseOpacity(): number {
        if (this.quality === 'ultra') return WATER_ULTRA_OPACITY;
        if (this.quality === 'high') return WATER_HIGH_OPACITY;
        return this.quality === 'medium' ? 0.8 : 0.86;
    }

    /**
     * Low: water as one flat, lit plane. No texture, no shader patch, no drift —
     * just enough that the lake basins in the ground read as lakes and not as
     * dry pits. It still follows the scene light (day, night) and the fog.
     */
    private createFlatWater(): Mesh {
        const geometry = new PlaneGeometry(this.worldSize, this.worldSize);
        geometry.rotateX(-Math.PI / 2);
        const material = new MeshLambertMaterial({
            color: FLAT_WATER_COLOR.clone(),
            transparent: true,
            opacity: 0.9,
        });
        this.flatWaterMaterial = material;
        const mesh = new Mesh(geometry, material);
        mesh.position.y = WATER_LEVEL_Y;
        return mesh;
    }

    /**
     * Ultra: draw the mirrored view the lakes show. Call before the frame's own
     * render. No-op on every other tier, and while no lake is on screen.
     */
    renderWaterReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
        const reflection = this.waterReflection;
        if (!reflection || !this.waterMesh) return;
        // The mirrored pass reuses the sun's shadow map instead of redrawing it
        // — but three only creates that map inside a shadow pass, so on a cold
        // load (or right after a shadow-size change) there is none yet, and
        // every lit draw of the mirrored view would sample a texture that
        // doesn't exist. Let the frame's own render make it first.
        const sun = this.sunLight;
        if (renderer.shadowMap.enabled && sun?.castShadow && !sun.shadow.map) return;
        this.lakeBoxes ??= this.sampleLakeBoxes();
        reflection.update(renderer, scene, camera, this.lakeBoxes, [this.waterMesh]);
    }

    /** half the side of the square around the board that can hold a lake */
    private lakeSpan(): number {
        return Math.min(this.worldSize * 0.5, this.map.halfW + this.reach);
    }

    /**
     * (Re)build the water-depth image when it is missing or the ground moved —
     * at most twice a second while a sculpt keeps moving it. Only the wet
     * cells are sampled, so it is a few thousand height lookups, not a full grid.
     */
    private ensureLakeDepth(): void {
        const now = performance.now();
        if (!this.lakeDepthDirty || now - this.lakeDepthBuiltAt < 500) return;
        this.lakeDepthDirty = false;
        this.lakeDepthBuiltAt = now;
        this.lakeBoxes ??= this.sampleLakeBoxes();
        const TEXEL = 2;
        const n = Math.ceil((2 * this.lakeSpan()) / TEXEL);
        // the image covers exactly n texels: map with THAT half-width everywhere
        const span = (n * TEXEL) / 2;
        let tex = this.lakeDepthTexUniform.value;
        if (!tex || tex.image.width !== n) {
            tex?.dispose();
            tex = new DataTexture(new Uint8Array(n * n * 2), n, n, RGFormat, UnsignedByteType);
            tex.minFilter = tex.magFilter = LinearFilter;
            tex.generateMipmaps = false;
            tex.unpackAlignment = 1;
            this.lakeDepthTexUniform.value = tex;
        }
        const data = tex.image.data as Uint8Array;
        data.fill(0);
        // R: how deep the water is here (0..8 m). Wet cells only are sampled.
        const depth = new Uint8Array(n * n);
        const wet: [number, number, number, number][] = [];
        for (const box of this.lakeBoxes) {
            const x0 = Math.max(0, Math.floor((box.min.x + span) / TEXEL));
            const z0 = Math.max(0, Math.floor((box.min.z + span) / TEXEL));
            const x1 = Math.min(n - 1, Math.ceil((box.max.x + span) / TEXEL));
            const z1 = Math.min(n - 1, Math.ceil((box.max.z + span) / TEXEL));
            wet.push([x0, z0, x1, z1]);
            for (let zi = z0; zi <= z1; zi++) {
                for (let xi = x0; xi <= x1; xi++) {
                    const x = -span + (xi + 0.5) * TEXEL;
                    const z = -span + (zi + 0.5) * TEXEL;
                    const d = WATER_LEVEL_Y - worldHeightAt(x, z);
                    depth[zi * n + xi] = Math.round(Math.min(1, Math.max(0, d / 8)) * 255);
                }
            }
        }
        // G: how much lake is around (the share of water within ~20 m, 0..1). A big
        // lake's shoreline sees about half; a narrow lake or a pond much less. The
        // shore effects use it to stay calm on small water.
        const W = n + 1;
        const integral = new Int32Array(W * W);
        for (let zi = 0; zi < n; zi++) {
            let row = 0;
            for (let xi = 0; xi < n; xi++) {
                row += depth[zi * n + xi]! > 12 ? 1 : 0;
                integral[(zi + 1) * W + xi + 1] = integral[zi * W + xi + 1]! + row;
            }
        }
        const R = 10;
        const margin = 6; // texels past each wet cell, so the shore on the dry side has it too
        for (const [x0, z0, x1, z1] of wet) {
            for (let zi = Math.max(0, z0 - margin); zi <= Math.min(n - 1, z1 + margin); zi++) {
                for (let xi = Math.max(0, x0 - margin); xi <= Math.min(n - 1, x1 + margin); xi++) {
                    const xa = Math.max(0, xi - R);
                    const xb = Math.min(n, xi + R + 1);
                    const za = Math.max(0, zi - R);
                    const zb = Math.min(n, zi + R + 1);
                    const count =
                        integral[zb * W + xb]! - integral[za * W + xb]! - integral[zb * W + xa]! + integral[za * W + xa]!;
                    const share = count / ((2 * R + 1) * (2 * R + 1));
                    data[(zi * n + xi) * 2 + 1] = Math.round(Math.min(1, share) * 255);
                }
            }
        }
        for (let i = 0; i < n * n; i++) data[i * 2] = depth[i]!;
        tex.needsUpdate = true;
        this.lakeDepthSpanUniform.value = span;
    }

    /**
     * The shoreline reeds go pale and frosted with the ground snow instead of
     * standing green through winter. Instance colours, rewritten only when the
     * cover has moved a little (it eases slowly).
     */
    private updateReedFrost(cover: number): void {
        const reeds = this.reeds;
        if (!reeds || !reeds.instanceColor) return;
        const k = Math.min(1, Math.max(0, cover));
        if (Math.abs(k - this.reedSnowApplied) < 0.02) return;
        this.reedSnowApplied = k;
        const frost = REED_FROST;
        const c = new Color();
        for (let i = 0; i < reeds.count; i++) {
            c.copy(this.reedBaseColors[i]!).lerp(frost, k * 0.85);
            reeds.setColorAt(i, c);
        }
        reeds.instanceColor.needsUpdate = true;
    }

    /** dev toggle (Shift+9): the ultra lake-bed sand and depth shading on or off */
    setLakeBed(on: boolean): void {
        this.lakeBedUniform.value = on ? 1 : 0;
    }

    /** dev toggle (Shift+8): the ultra water's mirrored view on or off */
    setWaterMirror(on: boolean): void {
        this.waterReflection?.setEnabled(on);
    }

    /** free the mirrored view's render target (the scenery is being replaced) */
    disposeWaterReflection(): void {
        this.waterReflection?.dispose();
        this.waterReflection = null;
        this.lakeDepthTexUniform.value?.dispose();
        this.lakeDepthTexUniform.value = null;
    }

    /**
     * Coarse boxes around every patch of ground that dips below the water
     * table, from the real world height (board relief + outer world). The
     * mirrored view is only drawn while one of them is in the camera's frustum.
     */
    private sampleLakeBoxes(): Box3[] {
        const CELL_SIZE = 24;
        const span = this.lakeSpan();
        const boxes: Box3[] = [];
        for (let x0 = -span; x0 < span; x0 += CELL_SIZE) {
            for (let z0 = -span; z0 < span; z0 += CELL_SIZE) {
                let wet = false;
                for (let i = 0; i < 3 && !wet; i++) {
                    for (let j = 0; j < 3 && !wet; j++) {
                        const x = x0 + ((i + 0.5) * CELL_SIZE) / 3;
                        const z = z0 + ((j + 0.5) * CELL_SIZE) / 3;
                        wet = worldHeightAt(x, z) < WATER_LEVEL_Y;
                    }
                }
                if (!wet) continue;
                boxes.push(
                    new Box3(
                        new Vector3(x0, WATER_LEVEL_Y - 1, z0),
                        new Vector3(x0 + CELL_SIZE, WATER_LEVEL_Y + 2, z0 + CELL_SIZE),
                    ),
                );
            }
        }
        return boxes;
    }

    private tuftMaterial: MeshStandardMaterial | null = null;
    /** ultra: the lawn of real blades around the board */
    private grassField: GrassField | null = null;
    private grassTerrainRev = 0;

    /** the footprint plates on the board this frame: the grass lies down under them */
    setGrassClearRects(rects: readonly { x: number; z: number; halfX: number; halfZ: number }[]): void {
        this.grassField?.setClearRects(rects);
    }

    /** Ultra: real grass blades in a band around the board (see grassField.ts). */
    private createGrassField(map: BattleMap, seed: number): void {
        const anchors = map.baseAnchors();
        const field = new GrassField(
            {
                halfW: map.halfW,
                halfH: map.halfH,
                // the meadow in front of the mountains
                band: Math.min(60, 90 * this.os),
                // (dense: only the chunks near the camera are drawn in full — see GrassField.updateView)
                density: 8,
                seed,
                // (a look test: the board is covered too — its relief at build time; blades do not
                // follow later craters and ridges yet)
                board: true,
                height: (x, z) => worldHeightAt(x, z),
                grassAt: (x, z) => {
                    if (Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH) {
                        // the board: not on the building pads, and only where its shader draws grass
                        for (const a of anchors) if ((x - a.x) ** 2 + (z - a.z) ** 2 < (a.r + 2) ** 2) return 0;
                        return boardGrassAt(map, x, z);
                    }
                    const h = this.terrainHeight(x, z);
                    if (h < -0.3) return 0;
                    if (this.lakeAt(x, z) > 0.08 && h < 1.6) return 0;
                    if (this.onDryPatch(x, z)) return 0;
                    if (!this.isGrassy(x, z)) return 0;
                    if (this.plantClearedAt(x, z)) return 0;
                    return 1;
                },
            },
            summerDryUniform,
        );
        const t = map.terrain;
        field.bindBoard({
            halfW: map.halfW,
            halfH: map.halfH,
            nx: t.nx,
            nz: t.nz,
            cellX: t.cellX,
            cellZ: t.cellZ,
            heights: t.heights,
            hazard: map.getHazardMask(),
        });
        this.grassTerrainRev = t.revision;
        this.grassField = field;
        this.group.add(field.group);
        console.info(`[scenery] grass field: ${field.count} blades`);
    }

    /**
     * Small-scale life on the outer meadow: wind-swaying grass tufts, small
     * stones, fallen logs and mushrooms. Four instanced draw calls.
     */
    private createMeadowDetails(map: BattleMap, rng: () => number): void {
        const dummy = new Object3D();
        const color = new Color();

        /** random meadow-band point (outside board, on grass, not in water) */
        const meadowSpot = (maxH: number, grassOnly = false): { x: number; z: number; h: number } | null => {
            const band = Math.min(320 * this.os, this.reach - 10 * this.os);
            for (let attempt = 0; attempt < 60; attempt++) {
                const x = (rng() * 2 - 1) * (map.halfW + band);
                const z = (rng() * 2 - 1) * (map.halfH + band);
                if (Math.abs(x) <= map.halfW + 6 && Math.abs(z) <= map.halfH + 6) continue;
                if (pastBoard(map.halfW, map.halfH, x, z) >= this.reach) continue;
                const h = this.terrainHeight(x, z);
                if (h < -0.3 || h > maxH) continue;
                // grass stands on grass: not on the sandy dry patches, the gravel/sand shore of a
                // lake, or where the ground has turned to stone
                if (grassOnly) {
                    if (this.onDryPatch(x, z)) continue;
                    if (this.lakeAt(x, z) > 0.08 && h < 1.6) continue;
                    if (!this.isGrassy(x, z)) continue;
                }
                return { x, z, h };
            }
            return null;
        };

        // --- grass tufts: crossed alpha-tested quads, swaying in the wind
        // grass tufts: ultra only (below it the meadow is the ground texture alone)
        const TUFTS = this.quality === 'ultra' ? scaleCount(4200, this.density.meadow) : 0;
        // Painted grass clumps (a 2x2 atlas, one clump picked per instance), lit from above like
        // the ground: three cards crossed at 60° on ultra and high, two crossed cards on medium
        // (low places no tufts at all). The procedural blade texture only shows if the atlas
        // fails to load.
        const clumps = true;
        const cards = this.quality === 'medium' ? 2 : 3;
        let tuftGeo: BufferGeometry;
        if (clumps) {
            const quad = new PlaneGeometry(1.35, 1.35).translate(0, 0.675, 0);
            tuftGeo = mergeGeometries(
                Array.from({ length: cards }, (_, k) => quad.clone().rotateY((k * Math.PI) / cards)),
            )!;
            // normals straight up: the cards take the light the ground under them gets, so no
            // card turns dark just because it faces away from the sun
            const n = tuftGeo.attributes.normal!;
            for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
            const pick = new Float32Array(TUFTS);
            for (let i = 0; i < TUFTS; i++) pick[i] = Math.floor(rng() * 4);
            tuftGeo.setAttribute('aClump', new InstancedBufferAttribute(pick, 1));
        } else {
            const quadA = new PlaneGeometry(1.3, 1).translate(0, 0.5, 0);
            const quadB = quadA.clone().rotateY(Math.PI / 2);
            tuftGeo = mergeGeometries([quadA, quadB])!;
        }
        this.tuftMaterial = new MeshStandardMaterial({
            map: makeTuftTexture(),
            transparent: true,
            alphaTest: clumps ? 0.42 : 0.35,
            side: DoubleSide,
            roughness: 1,
        });
        if (clumps && TUFTS > 0) {
            const mat = this.tuftMaterial;
            // hidden until the atlas is in, so the old blades never flash in first
            mat.visible = false;
            void loadWorldTexture(grassClumpsUrl()).then((tex) => {
                if (!tex) {
                    mat.visible = true;
                    return;
                }
                tex.anisotropy = 4;
                mat.map = tex;
                mat.defines = { ...(mat.defines ?? {}), GRASS_CLUMPS: '' };
                mat.needsUpdate = true;
                mat.visible = true;
            });
        }
        this.tuftMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uSnowCover = { value: 0 };
            shader.uniforms.uDryGrass = summerDryUniform;
            this.tuftMaterial!.userData.shader = shader;
            shader.vertexShader =
                'uniform float uTime;\n#ifdef GRASS_CLUMPS\nattribute float aClump;\n#endif\n' +
                shader.vertexShader
                    .replace(
                        '#include <uv_vertex>',
                        `#include <uv_vertex>
    #if defined(GRASS_CLUMPS) && defined(USE_MAP)
    // one quarter of the atlas per instance (row 0 is the top of the image)
    vMapUv = vMapUv * 0.5 + vec2(mod(aClump, 2.0), 1.0 - floor(aClump / 2.0)) * 0.5;
    #endif`,
                    );
            shader.fragmentShader =
                'uniform float uSnowCover;\nuniform float uDryGrass;\n' +
                shader.fragmentShader
                    // Every card is lit as if it faced straight up, like the ground under it. A
                    // double-sided card otherwise flips its normal on the back face, so of two
                    // crossed cards one side caught the sun and the other went dark.
                    .replace(
                        '#include <normal_fragment_begin>',
                        `#include <normal_fragment_begin>
    normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    nonPerturbedNormal = normal;`,
                    )
                    .replace(
                    '#include <color_fragment>',
                    `#include <color_fragment>
#ifdef USE_INSTANCING
    vec3 tuftBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
    vec3 tuftBase = vec3(0.0);
#endif
    vec3 tuftDry = mix(diffuseColor.rgb * vec3(1.22, 1.08, 0.50), vec3(0.78, 0.68, 0.28), 0.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, tuftDry, uDryGrass);
    float alpineSnow = smoothstep(170.0, 235.0, tuftBase.y);
    float snowLine = mix(220.0, -15.0, uSnowCover);
    float weatherSnow = smoothstep(snowLine - 40.0, snowLine + 15.0, tuftBase.y);
    float snowF = max(alpineSnow, weatherSnow) * 0.9;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.98), snowF);`,
                );
        };
        this.tuftMaterial.customProgramCacheKey = () => `meadow-tuft-still-upnormal-v4${clumps ? '-clumps' : ''}`;
        const tufts = new InstancedMesh(tuftGeo, this.tuftMaterial, TUFTS);
        let tuftI = 0;
        for (let i = 0; i < TUFTS; i++) {
            const spot = meadowSpot(20, true);
            if (!spot) break;
            const sc = clumps ? 0.6 + rng() * 0.9 : 0.7 + rng() * 1.1;
            dummy.position.set(spot.x, spot.h - (clumps ? 0.05 : 0), spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            tufts.setMatrixAt(tuftI, dummy.matrix);
            if (clumps) {
                // the paint carries the colour; the tint only varies it a little
                color.set(0xffffff).lerp(new Color(0xd6e6a4), rng() * 0.7).multiplyScalar(0.92 + rng() * 0.12);
            } else {
                color.set(0x55a244).lerp(new Color(0x7cc44e), rng()).lerp(new Color(0xffffff), 0.15);
            }
            tufts.setColorAt(tuftI++, color);
        }
        tufts.count = tuftI;

        // --- small stones / logs / mushrooms: GLB floor pieces own these on high/ultra
        if (!floorPiecesEnabled(this.quality)) {
            const STONES = scaleCount(240, this.density.meadow);
            const stones = new InstancedMesh(
                new IcosahedronGeometry(0.3, 0),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
                STONES,
            );
            attachVegetationSnow(stones.material as MeshStandardMaterial, { strength: 0.45 });
            let stoneI = 0;
            for (let i = 0; i < STONES; i++) {
                const spot = meadowSpot(40);
                if (!spot) break;
                const sc = 0.5 + rng() * 1.1;
                dummy.position.set(spot.x, spot.h + 0.12 * sc, spot.z);
                dummy.scale.set(sc, sc * 0.6, sc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                stones.setMatrixAt(stoneI, dummy.matrix);
                color.set(THEME.scenery.rock).lerp(new Color(0x6a6d64), rng() * 0.6);
                stones.setColorAt(stoneI++, color);
            }
            stones.count = stoneI;

            const LOGS = scaleCount(26, this.density.meadow);
            const logs = new InstancedMesh(
                new CylinderGeometry(0.28, 0.36, 3.2, 6),
                new MeshStandardMaterial({ color: THEME.scenery.trunk, roughness: 0.9 }),
                LOGS,
            );
            attachVegetationSnow(logs.material as MeshStandardMaterial, { strength: 0.4 });
            let logI = 0;
            for (let i = 0; i < LOGS; i++) {
                const spot = meadowSpot(24);
                if (!spot) break;
                const sc = 0.7 + rng() * 0.8;
                dummy.position.set(spot.x, spot.h + 0.3 * sc, spot.z);
                dummy.scale.setScalar(sc);
                dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, Math.PI / 2);
                dummy.updateMatrix();
                logs.setMatrixAt(logI++, dummy.matrix);
            }
            logs.count = logI;
            logs.castShadow = true;

            const MUSHROOMS = scaleCount(90, this.density.meadow);
            const stem = new CylinderGeometry(0.09, 0.13, 0.5, 5).translate(0, 0.25, 0);
            const cap = new ConeGeometry(0.32, 0.34, 6).translate(0, 0.62, 0);
            const mushrooms = new InstancedMesh(
                mergeGeometries([stem, cap])!,
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
                MUSHROOMS,
            );
            attachVegetationSnow(mushrooms.material as MeshStandardMaterial, { strength: 0.82 });
            let mushI = 0;
            while (mushI < MUSHROOMS) {
                const spot = meadowSpot(36);
                if (!spot) break;
                const group = 1 + Math.floor(rng() * 3);
                for (let g = 0; g < group && mushI < MUSHROOMS; g++) {
                    const x = spot.x + (rng() - 0.5) * 2.5;
                    const z = spot.z + (rng() - 0.5) * 2.5;
                    const sc = 0.6 + rng() * 0.9;
                    dummy.position.set(x, this.terrainHeight(x, z), z);
                    dummy.scale.setScalar(sc);
                    dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.15);
                    dummy.updateMatrix();
                    mushrooms.setMatrixAt(mushI, dummy.matrix);
                    color.set(rng() < 0.4 ? 0xb84a34 : 0xc8a878).lerp(new Color(0xffffff), rng() * 0.25);
                    mushrooms.setColorAt(mushI++, color);
                }
            }
            mushrooms.count = mushI;

            this.group.add(stones, logs, mushrooms);
        }

        // --- fallen leaf litter (ultra, high): little drifts of leaves, built now, opacity eased in for
        // autumn (see setSeason). Each card is a scatter of cut-out leaves, tinted per card.
        if (this.quality !== 'ultra' && this.quality !== 'high') {
            this.group.add(tufts);
            return;
        }
        // (high: half as much)
        const LITTER = scaleCount(this.quality === 'ultra' ? 1200 : 600, this.density.meadow);
        const litterGeo = new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
        const litterMaterial = new MeshStandardMaterial({
            color: 0xffffff,
            map: makeLeafLitterTexture(),
            alphaTest: 0.45,
            roughness: 1,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        attachVegetationSnow(litterMaterial, { strength: 0.65 });
        const litter = new InstancedMesh(litterGeo, litterMaterial, LITTER);
        litter.visible = false;
        const litterTones = [0xc86a2c, 0xd8902c, 0xb84824, 0xe0b840];
        let litterI = 0;
        for (let i = 0; i < LITTER; i++) {
            const spot = meadowSpot(30);
            if (!spot) break;
            const sc = 0.7 + rng() * 0.9;
            dummy.position.set(spot.x, spot.h + 0.03, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
            dummy.updateMatrix();
            litter.setMatrixAt(litterI, dummy.matrix);
            color.set(litterTones[Math.floor(rng() * litterTones.length)]!).lerp(new Color(0xffffff), rng() * 0.15);
            litter.setColorAt(litterI++, color);
        }
        litter.count = litterI;
        this.leafLitter = litter;

        this.group.add(tufts, litter);
    }

    /**
     * Life on and around the lakes: reeds along the shores, lily pads on the
     * water, and blossoms on some of the pads. Three instanced draw calls.
     */
    private createLakeDetails(rng: () => number): void {
        const WATER_Y = -1.1;
        const dummy = new Object3D();
        const color = new Color();

        /** random point where the lake factor and height match the given band */
        const lakeSpot = (minLake: number, hMin: number, hMax: number) => {
            for (let attempt = 0; attempt < 400; attempt++) {
                const span = Math.min(this.worldSize * 0.5, this.map.halfW + this.reach);
                const x = (rng() * 2 - 1) * span;
                const z = (rng() * 2 - 1) * span;
                if (pastBoard(this.map.halfW, this.map.halfH, x, z) >= this.reach) continue;
                if (this.lakeAt(x, z) < minLake) continue;
                const h = this.terrainHeight(x, z);
                if (h < hMin || h > hMax) continue;
                return { x, z, h };
            }
            return null;
        };

        const REEDS = scaleCount(160, this.density.lake);
        const reeds = new InstancedMesh(
            new CylinderGeometry(0.05, 0.09, 2.4, 4),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
            REEDS,
        );
        let reedI = 0;
        for (let i = 0; i < REEDS; i++) {
            const spot = lakeSpot(0.2, -1.5, -0.1); // shoreline band
            if (!spot) break;
            const sc = 0.7 + rng() * 0.6;
            dummy.position.set(spot.x, spot.h + 1.2 * sc, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
            dummy.updateMatrix();
            reeds.setMatrixAt(reedI, dummy.matrix);
            color.set(0x6a8a3e).lerp(new Color(0x9a8a52), rng());
            this.reedBaseColors.push(color.clone());
            reeds.setColorAt(reedI++, color);
        }
        reeds.count = reedI;
        this.reeds = reeds;
        reeds.castShadow = true;

        const PADS = scaleCount(70, this.density.lake);
        const padGeo = new CircleGeometry(0.6, 8);
        padGeo.rotateX(-Math.PI / 2);
        const pads = new InstancedMesh(
            padGeo,
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, transparent: true }),
            PADS,
        );
        const blossoms = new InstancedMesh(
            new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
            new MeshStandardMaterial({
                map: makeFlowerTexture(),
                transparent: true,
                alphaTest: 0.4,
                roughness: 1,
            }),
            PADS,
        );
        this.flowerMaterials.push(blossoms.material as MeshStandardMaterial);
        const flowerTones = THEME.terrain.flowers;
        let padI = 0;
        let blossomI = 0;
        for (let i = 0; i < PADS; i++) {
            const spot = lakeSpot(0.7, -8, -2); // clearly inside a lake
            if (!spot) break;
            const sc = 0.7 + rng() * 0.9;
            dummy.position.set(spot.x, WATER_Y + 0.04, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            pads.setMatrixAt(padI, dummy.matrix);
            color.set(0x3e7a34).lerp(new Color(0x5a9a48), rng());
            pads.setColorAt(padI++, color);
            if (rng() < 0.35) {
                dummy.position.y = WATER_Y + 0.09;
                dummy.scale.setScalar(sc * 0.6);
                dummy.updateMatrix();
                blossoms.setMatrixAt(blossomI, dummy.matrix);
                color.set(flowerTones[Math.floor(rng() * flowerTones.length)]!);
                blossoms.setColorAt(blossomI++, color);
            }
        }
        pads.count = padI;
        blossoms.count = blossomI;

        this.lakeSurfacePlants = [pads, blossoms];
        this.group.add(reeds, pads, blossoms);
    }

    /** big back-side sphere with a painted zenith-to-horizon gradient */
    private createSkyDome(): Mesh {
        const s = THEME.scenery;
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        this.repaintSky = (zenith, mid, horizon) => {
            const grad = ctx.createLinearGradient(0, 0, 0, 256);
            grad.addColorStop(0, zenith);
            grad.addColorStop(0.32, mid);
            grad.addColorStop(0.5, horizon); // equator = horizon = fog color
            grad.addColorStop(1, horizon);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 4, 256);
            texture.needsUpdate = true;
            // the high water reflects these same three colours
            this.waterSky.zenith.value.set(zenith);
            this.waterSky.mid.value.set(mid);
            this.waterSky.horizon.value.set(horizon);
        };
        this.repaintSky(s.skyZenith, s.skyMid, s.skyHorizon);

        const mesh = new Mesh(
            new SphereGeometry(850, 32, 16),
            new MeshBasicMaterial({ map: texture, side: BackSide, fog: false, depthWrite: false }),
        );
        mesh.renderOrder = -2; // very first: the stars (order -1) draw right on top of it
        return mesh;
    }

    /** soft additive glow billboard sitting where the directional sun points from */
    private createSunGlow(): Sprite {
        // white gradient — the weather system tints it (warm sun / pale moon)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.5)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;

        const sprite = new Sprite(
            new SpriteMaterial({
                map: texture,
                color: 0xfff2cc,
                blending: AdditiveBlending,
                fog: false,
                depthWrite: false,
                transparent: true,
            }),
        );
        // same direction the DirectionalLight shines from, pushed near the dome shell
        sprite.position.copy(new Vector3(120, 160, 80).normalize().multiplyScalar(760));
        sprite.scale.setScalar(340);
        this.sunGlow = sprite;
        return sprite;
    }

    /**
     * The world beyond the field: the SAME grass as the battlefield (same
     * texture, same tiling, one constant to match the board's macro-darkened
     * tone), with rock and snow taking over on the mountains. Vertex colors
     * carry the rock/snow tint; the grass area stays plain white.
     */
    private createOuterGround(map: BattleMap): Mesh {
        const s = THEME.scenery;
        const SIZE = this.worldSize;
        // 'low'/'off' skip decoration (trees, lake props, meadow texture) but
        // still get a real, if coarse, heightmapped ground — terrainHeight is
        // no longer flattened at these tiers (see the constructor), so a flat
        // 1-segment quad would visibly float/sink units against the relief
        // they and the deterministic horde spawn logic both see.
        // High/medium: scale SEGS with the real (shorter) world → fewer verts.
        // Ultra: keep the old board+780 budget so those verts densify the climb,
        // plus the adaptive mountain lattice in createOuterGroundGeometry.
        const REF_WORLD = 3000;
        const segsBasis =
            this.quality === 'ultra'
                ? outerWorldBudgetSize(map.halfW, map.halfH, this.os)
                : SIZE;
        const SEGS = Math.max(
            24,
            Math.round((this.detailed ? this.density.segs : 96) * (segsBasis / REF_WORLD)),
        );
        const geometry = createOuterGroundGeometry(SIZE, SEGS, {
            dense: this.quality === 'ultra',
            // High/medium: keep near-board step, sparsify the mountain rim (optics).
            mountainSparse: this.quality === 'high' || this.quality === 'medium',
            halfW: map.halfW,
            halfH: map.halfH,
            denseFrom: MOUNTAIN_DENSE_FROM * this.os,
        });

        const pos = geometry.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        /** 0..1 per vertex: how sandy/gravelly this spot is (lake shores + rare patches) */
        const beach = new Float32Array(pos.count);
        /**
         * 0..1 per vertex: the lake-shore part of the gravel/sand weight, WITHOUT
         * its fade up the bank. That fade is done per pixel from the real height
         * (see the outer-meadow fragment shader): sampled per vertex it flipped
         * from 1 to 0 across a single triangle on steep coasts and showed up as
         * triangles along the waterline.
         */
        const shoreLake = new Float32Array(pos.count);
        /** 0..1 scree pockets on mountains (concave corners + talus at cliff bases) */
        const scree = new Float32Array(pos.count);
        /** 0..1 alpine meadow on high shelves (procedural terrain only) */
        const alpine = new Float32Array(pos.count);
        const meadow = new Color(0xffffff); // grass texture shows as-is
        // near-white: the tiled rock texture carries the stone color, the
        // vertex tint only adds large-scale light/dark variation
        const rock = new Color(0xf2efe9);
        const rockDark = new Color(0xf2efe9).multiplyScalar(0.75);
        const c = new Color();
        const rockVar = new Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const h = this.terrainHeight(x, z);
            pos.setY(i, h);

            // gravel shore around (and under) the lakes: a solid basin is needed.
            // The cut-off uphill (1 - smooth01((h - 0.1) / 1.1)) is per pixel.
            const shoreW = smooth01((this.lakeAt(x, z) - 0.12) / 0.45);
            // …plus rare small dry patches scattered over the meadow
            // (see dryPatchWeight for the noise: smaller and fainter than they were, since
            // on high and ultra they read as sand against the forest floor)
            const patch = this.dryPatchWeight(x, z, h);
            // never right next to the board — it would break the transition
            const dOut = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            const boardFade = smooth01((dOut - 15) / 25);
            beach[i] = Math.min(1, patch) * boardFade;
            // a static map paints its own beach; only the procedural lakes get this
            shoreLake[i] = this.landscape ? 0 : shoreW * boardFade;
            scree[i] = this.screeAccumAt(x, z, h);
            alpine[i] = this.alpineMeadowAt(x, z, h);

            rockVar.copy(rock).lerp(rockDark, this.noise(x / 55 + 3, z / 55 + 9));
            if (h > 35) rockVar.multiplyScalar(0.68 + 0.32 * (1 - smooth01((h - 35) / 130)));
            if (this.quality === 'ultra' && !this.landscape && h > 30) this.tintMountainVertex(rockVar, x, z, h);
            c.copy(meadow).lerp(rockVar, smooth01((h - 12) / 45) * (1 - alpine[i]!));

            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        // Ultra procedural folds on the procedural terrain; a static map brings
        // its own overhangs (lean) and paint, the same on every tier.
        if (this.quality === 'ultra' && !this.landscape) {
            sculptUltraMountainPositions(pos, {
                halfW: map.halfW,
                halfH: map.halfH,
                noise: this.noise,
                seed: this.seed,
                scale: this.os,
                keepOut: this.almSites.map((site) => ({ x: site.x, z: site.z, r: ALM_RADIUS + ALM_EASE })),
            });
        }
        pos.needsUpdate = true;
        geometry.setAttribute('color', new BufferAttribute(colors, 3));
        geometry.setAttribute('aBeach', new BufferAttribute(beach, 1));
        geometry.setAttribute('aShore', new BufferAttribute(shoreLake, 1));
        geometry.setAttribute('aScree', new BufferAttribute(scree, 1));
        if (!this.landscape) geometry.setAttribute('aGrass', new BufferAttribute(alpine, 1));
        ensureOuterMaterialAttrs(geometry);
        if (this.landscape) applyLandscapeToOuterGeometry(geometry, this.landscape, { heights: false });
        geometry.computeVertexNormals();
        const normalAttr = geometry.attributes.normal!;
        const mossArr = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
            mossArr[i] = this.mossAccumAt(
                pos.getX(i),
                pos.getZ(i),
                pos.getY(i),
                normalAttr.getX(i),
                normalAttr.getY(i),
                normalAttr.getZ(i),
                scree[i]!,
            );
        }
        geometry.setAttribute('aMoss', new BufferAttribute(mossArr, 1));

        const material = new MeshStandardMaterial({
            color: s.outerGround,
            vertexColors: true,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
            flatShading: false,
        });
        const mesh = new Mesh(geometry, material);
        mesh.position.y = -0.05;
        mesh.receiveShadow = true;
        mesh.name = 'outer-ground';
        this.outerGroundMesh = mesh;
        if (this.detailed) void this.applyMeadowTexture(material, map, SIZE);
        else this.applyOuterGroundSnowOnly(material);
        return mesh;
    }

    /** Outer heightfield mesh (meadow + mountains) for the mountain editor. */
    getOuterGroundMesh(): Mesh | null {
        return this.outerGroundMesh;
    }

    getAuthoredPlants(): AuthoredPlant[] {
        return this.authoredPlants.map((p) => ({ ...p }));
    }

    getPlantClears(): PlantClearDisk[] {
        return this.plantClears.map((c) => ({ ...c }));
    }

    /** Replace authored plant list + clears (Load / Reset). */
    setAuthoredPlants(plants: AuthoredPlant[], clears: PlantClearDisk[] = []): void {
        this.authoredPlants = plants.map((p) => ({ ...p }));
        this.plantClears = [];
        for (const c of clears) this.addPlantClear(c);
        void this.rebuildAuthoredPlantMeshes();
        // Live-remove procedural instances that fall inside clear disks.
        for (const c of this.plantClears) this.removeDecorationInstancesInRadius(c.x, c.z, c.r);
    }

    paintAuthoredPlant(kind: VegetationKind, x: number, z: number, sc: number, yaw: number): void {
        if (!this.detailed) return;
        this.authoredPlants.push({ kind, x, z, sc, yaw });
        const mesh = this.authoredMeshes.get(kind);
        if (!mesh || mesh.count >= mesh.instanceMatrix.count) {
            void this.rebuildAuthoredPlantMeshes();
            return;
        }
        // instance i of an authored mesh is the i-th plant of its kind (see reseatAuthoredPlants)
        placeVegetationInstance(mesh, x, worldHeightAt(x, z) - BILLBOARD_Y_SINK, z, sc * BILLBOARD_SCALE, yaw, this.plantDummy);
        mesh.instanceMatrix.needsUpdate = true;
    }

    erasePlantsAt(cx: number, cz: number, radius: number): void {
        const r2 = radius * radius;
        this.authoredPlants = this.authoredPlants.filter((p) => {
            const dx = p.x - cx;
            const dz = p.z - cz;
            return dx * dx + dz * dz > r2;
        });
        this.addPlantClear({ x: cx, z: cz, r: radius });
        void this.rebuildAuthoredPlantMeshes();
        this.removeDecorationInstancesInRadius(cx, cz, radius);
    }

    /**
     * Remember a cleared disk. A drag stamps many overlapping disks — one
     * already inside another adds nothing, so the list (checked for every tree
     * the scenery places) stays short.
     */
    private addPlantClear(disk: PlantClearDisk): void {
        const inside = (a: PlantClearDisk, b: PlantClearDisk) => Math.hypot(a.x - b.x, a.z - b.z) + a.r <= b.r + 1e-6;
        if (this.plantClears.some((c) => inside(disk, c))) return;
        this.plantClears = this.plantClears.filter((c) => !inside(c, disk));
        this.plantClears.push({ ...disk });
    }

    private plantClearedAt(x: number, z: number): boolean {
        return pointInPlantClear(this.plantClears, x, z);
    }

    /**
     * How dry/bare the meadow is at a point: the rare gravel / sand patches on
     * the outer ground (0 = grass). Shared by the ground build and the plant
     * placement, so trees can stay off exactly what is drawn.
     */
    private dryPatchWeight(x: number, z: number, h: number): number {
        const patchN = this.noise(x / 24 + 5.1, z / 24 + 50.4);
        // a second, finer noise eats into the blobs, so the big ones break up into
        // smaller pieces instead of one broad patch
        const breakUp = smooth01((this.noise(x / 9 + 71.3, z / 9 + 12.9) - 0.34) / 0.26);
        return smooth01((patchN - 0.77) / 0.08) * 0.45 * breakUp * (h < 10 ? 1 : 0);
    }

    /** true on a visible dry patch — nothing grows there (a static map paints its own beach) */
    private onDryPatch(x: number, z: number): boolean {
        if (this.landscape) return false;
        const dOut = Math.max(Math.abs(x) - this.map.halfW, Math.abs(z) - this.map.halfH, 0);
        const seen = this.dryPatchWeight(x, z, this.terrainHeight(x, z)) * smooth01((dOut - 15) / 25);
        return seen > 0.04;
    }

    private async rebuildAuthoredPlantMeshes(): Promise<void> {
        if (!this.detailed) return;
        // a newer rebuild supersedes this one — only the latest may add meshes
        const gen = ++this.authoredRebuildGen;
        for (const mesh of this.authoredMeshes.values()) {
            this.group.remove(mesh);
            mesh.dispose(); // instance buffers only; geometry + material are the shared billboard asset
        }
        this.authoredMeshes.clear();
        if (this.authoredPlants.length === 0) return;

        await loadSceneryBillboards();
        if (gen !== this.authoredRebuildGen) return;
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        for (const kind of kinds) {
            const list = this.authoredPlants.filter((p) => p.kind === kind);
            if (list.length === 0) continue;
            const capacity = Math.max(list.length + 96, 128);
            const mesh = createBillboardInstances(kind, capacity);
            if (!mesh) continue;
            mesh.userData.authoredPlants = true;
            mesh.name = `authored-${kind}`;
            for (const p of list) {
                placeBillboardInstance(
                    mesh,
                    p.x,
                    worldHeightAt(p.x, p.z) - BILLBOARD_Y_SINK,
                    p.z,
                    p.sc * BILLBOARD_SCALE,
                    p.yaw,
                    this.plantDummy,
                );
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            this.authoredMeshes.set(kind, mesh);
        }
    }

    /** decoration meshes a sculpt or erase may touch: not the sky, not the tree shadow layout, not authored plants */
    private forEachDecorationMesh(visit: (mesh: InstancedMesh) => void): void {
        this.group.traverse((o) => {
            const mesh = o as InstancedMesh;
            if (!mesh.isInstancedMesh || mesh.count <= 0) return;
            if (mesh.userData.authoredPlants || mesh.userData.treeShadows) return;
            for (let p: Object3D | null = mesh; p; p = p.parent) {
                if (p === this.skyGroup) return;
            }
            visit(mesh);
        });
    }

    /** Drop decoration instances inside a disk (procedural trees/props) and their shadows. */
    private removeDecorationInstancesInRadius(cx: number, cz: number, radius: number): void {
        const r2 = radius * radius;
        const scratch = this.reseatMat;
        this.forEachDecorationMesh((mesh) => {
            const cache = this.instanceGroundY.get(mesh);
            let i = 0;
            while (i < mesh.count) {
                mesh.getMatrixAt(i, scratch);
                scratch.decompose(this.reseatPos, this.reseatQuat, this.reseatScale);
                const dx = this.reseatPos.x - cx;
                const dz = this.reseatPos.z - cz;
                if (dx * dx + dz * dz <= r2) {
                    // swap-remove: the last instance takes this slot, with everything it carries
                    const last = mesh.count - 1;
                    if (i < last) {
                        mesh.getMatrixAt(last, scratch);
                        mesh.setMatrixAt(i, scratch);
                        if (mesh.instanceColor) {
                            mesh.instanceColor.setXYZ(i, mesh.instanceColor.getX(last), mesh.instanceColor.getY(last), mesh.instanceColor.getZ(last));
                        }
                        for (const attr of Object.values(mesh.geometry.attributes)) {
                            const inst = attr as InstancedBufferAttribute;
                            // per-instance data sized for this mesh (a geometry shared by other pools is left alone)
                            if (!inst.isInstancedBufferAttribute || inst.count !== mesh.instanceMatrix.count) continue;
                            for (let k = 0; k < inst.itemSize; k++) inst.setComponent(i, k, inst.getComponent(last, k));
                            inst.needsUpdate = true;
                        }
                        if (cache && last < cache.length) cache[i] = cache[last]!;
                    }
                    mesh.count--;
                } else {
                    i++;
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        });
        this.treeShadows.removeWithin(cx, cz, radius);
        if (this.sunLight) this.treeShadows.update(this.sunLight.position, this.sunLight.intensity);
    }

    /** the outer ground height this world was built with (static map or procedural) */
    outerHeightAt(x: number, z: number): number {
        return this.terrainHeight(x, z);
    }

    /**
     * After the ground changed (a sculpt, a hammer's flattening): move trees,
     * bushes and meadow props onto the current {@link worldHeightAt} while
     * keeping how far each sat above or below its ground. `area` limits it to
     * the decorations standing in that world rectangle.
     */
    reseatGroundedDecorations(area?: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
        // the ground may have moved under the lakes (sculpt) — resample on next use.
        // A change that stays on the board (a hammer, an acid pit) cannot touch a lake.
        const beyondBoard =
            !area ||
            area.minX < -this.map.halfW ||
            area.maxX > this.map.halfW ||
            area.minZ < -this.map.halfH ||
            area.maxZ > this.map.halfH;
        if (beyondBoard) {
            this.lakeBoxes = null;
            this.lakeDepthDirty = true;
        }
        const WATER_Y = -1.1;
        let anyMoved = false;
        this.forEachDecorationMesh((mesh) => {
            let cache = this.instanceGroundY.get(mesh);
            const known = cache?.length ?? 0;
            if (!cache || known < mesh.count) {
                // first sight of these instances (or more of them): the ground they were placed on
                const grown = new Float32Array(mesh.count);
                if (cache) grown.set(cache);
                for (let i = known; i < mesh.count; i++) {
                    mesh.getMatrixAt(i, this.reseatMat);
                    this.reseatPos.setFromMatrixPosition(this.reseatMat);
                    grown[i] = this.buildGround(this.reseatPos.x, this.reseatPos.z);
                }
                cache = grown;
                this.instanceGroundY.set(mesh, cache);
            }

            let moved = false;
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, this.reseatMat);
                if (area) {
                    this.reseatPos.setFromMatrixPosition(this.reseatMat);
                    const { x, z } = this.reseatPos;
                    if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
                }
                moved = true;
                this.reseatMat.decompose(this.reseatPos, this.reseatQuat, this.reseatScale);
                // Lily pads / blossoms sit on the water plane, not terrain.
                if (Math.abs(this.reseatPos.y - WATER_Y) < 0.35) continue;
                const lift = this.reseatPos.y - cache[i]!;
                const ground = worldHeightAt(this.reseatPos.x, this.reseatPos.z);
                this.reseatPos.y = ground + lift;
                cache[i] = ground;
                this.reseatMat.compose(this.reseatPos, this.reseatQuat, this.reseatScale);
                mesh.setMatrixAt(i, this.reseatMat);
            }
            if (moved) {
                mesh.instanceMatrix.needsUpdate = true;
                anyMoved = true;
            }
        });
        this.reseatAuthoredPlants();
        // the tree shadows only need rebuilding if a tree actually moved (a change on the
        // board's bare ground moves none of the forest)
        if (!anyMoved && area) return;
        // (the footprints are the billboard trees outside the board: a change on the board
        // almost never reaches them, and a relayout samples the ground thousands of times)
        if (area && !this.treeShadows.touches(area)) return;
        this.treeShadows.invalidate();
        if (this.sunLight) this.treeShadows.update(this.sunLight.position, this.sunLight.intensity);
    }

    /** authored plants stand on worldHeightAt by construction — put them there again */
    private reseatAuthoredPlants(): void {
        for (const [kind, mesh] of this.authoredMeshes) {
            const list = this.authoredPlants.filter((p) => p.kind === kind);
            const n = Math.min(list.length, mesh.count);
            for (let i = 0; i < n; i++) {
                const p = list[i]!;
                mesh.getMatrixAt(i, this.reseatMat);
                this.reseatMat.decompose(this.reseatPos, this.reseatQuat, this.reseatScale);
                this.reseatPos.set(p.x, worldHeightAt(p.x, p.z) - BILLBOARD_Y_SINK, p.z);
                this.reseatMat.compose(this.reseatPos, this.reseatQuat, this.reseatScale);
                mesh.setMatrixAt(i, this.reseatMat);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * Low/medium quality: keep the coarse (vertex-tinted) outer ground mesh,
     * but still apply weather-driven snow whitening.
     *
     * This intentionally avoids loading the HQ meadow textures; we only need
     * the same `uSnowCover` mix that `applyMeadowTexture` injects.
     */
    private applyOuterGroundSnowOnly(material: MeshStandardMaterial): void {
        material.onBeforeCompile = (shader) => {
            // Drive this uniform from the weather system (see update loop).
            shader.uniforms.uSnowCover = { value: 0 };
            this.outerGroundSnowUniform = shader.uniforms.uSnowCover as { value: number };
            shader.uniforms.uAlpineCap = this.outerGroundAlpineUniform;
            shader.uniforms.uDryGrass = summerDryUniform;

            shader.vertexShader =
                'attribute float aBeach;\nattribute float aGrass;\nattribute float aRock;\nattribute float aSnow;\nvarying float vBeach;\nvarying float vGrass;\nvarying float vRock;\nvarying float vSnow;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;\n\tvWorldXZ = position.xz;\n\tvSlope = 1.0 - normal.y;\n\tvBeach = aBeach;\n\tvGrass = aGrass;\n\tvRock = aRock;\n\tvSnow = aSnow;\n\tvWorldN = normalize( mat3( modelMatrix ) * objectNormal );',
                );

            const inject = `
    float meadowSnowHold = 1.0;
${OUTER_MOUNTAIN_SNOW_GLSL}
    snowF = clamp( mix( snowF, 1.0, vSnow ) * ( 1.0 - vGrass * ( 1.0 - smoothstep( 0.25, 0.7, uSnowCover ) ) ) * ( 1.0 - vRock * 0.85 ), 0.0, 1.0 );
    float rockTint = clamp( vRock * ( 1.0 - vGrass ) * ( 1.0 - snowF ), 0.0, 1.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.6, 0.56 ), rockTint );
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
${OUTER_MOUNTAIN_LIGHTING_GLSL}
            `;

            let frag =
                'varying float vBeach;\nvarying float vGrass;\nvarying float vRock;\nvarying float vSnow;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                'uniform float uSnowCover;\nuniform float uAlpineCap;\nuniform float uDryGrass;\n' +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>${inject}`);

            // Keep Three's chunk boundaries stable; only assign once so the compiler
            // sees a single coherent shader.
            shader.fragmentShader = frag;
        };

        material.customProgramCacheKey = () => `outer-meadow-snowonly-v18-${groundDetailCacheKey(
            groundMaterialProfile(),
        )}`;
        material.needsUpdate = true;
    }

    /**
     * The outer world's grass = the battlefield's grass: same texture, same
     * tile size, phase-aligned so the pattern continues across the border.
     * BOARD_TONE matches the board's average brightness (its painted macro
     * layer darkens it slightly). On the mountains the rock texture takes
     * over (by height and slope), with plain white snow above.
     */
    private async applyMeadowTexture(
        material: MeshStandardMaterial,
        map: BattleMap,
        size: number,
    ): Promise<void> {
        const BOARD_TONE = 0.93;
        const profile = groundMaterialProfile();
        const tileSize = profile.detailTile;
        // Gravel shore tile — smaller than lawn so pebbles stay pebble-sized
        const shoreTile = 11;
        /** Coarser shore on mountain scree pockets (same texture as lake gravel) */
        const shoreMountainTile = 38;
        const rockTile = 34; // legacy rock tile scale
        const rockPhotoTile = PHOTO_BLEND.rock.worldScale;
        // High and ultra: sand in the shallows, gravel below it, darker with depth,
        // wet bank and shore foam. Ultra adds the caustics on the bed.
        const lakeBedLayers = this.quality === 'ultra' || this.quality === 'high';
        const lakeCaustics = this.quality === 'ultra';
        // Medium: the same floor and bank shading with no texture and no noise
        const lakeLite = this.quality === 'medium';
        const [grass, rockPack, shore, sand] = await Promise.all([
            loadGrassTextures(),
            loadRockTextures(),
            loadWorldTexture(shoreAlbedoUrl()),
            lakeBedLayers ? loadWorldTexture(sandAlbedoUrl()) : Promise.resolve(null),
        ]);
        if (!grass?.albedo) return;
        const { albedo, normal } = grass;
        const rock = rockPack?.albedo ?? null;
        const rockPhoto1 = rockPack?.variants[0] ?? null;
        const rockPhoto2 = rockPack?.variants[1] ?? null;
        // Outer meadow: lighter photo accents only (no dark seamless photo-2)
        const photoGrass =
            grass.variants[0] && grass.variants[1]
                ? ([grass.variants[0], grass.variants[1]] as const)
                : null;
        const frac = (v: number) => ((v % 1) + 1) % 1;
        const configure = (tex: NonNullable<typeof albedo>) => {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(size / tileSize, size / tileSize);
            tex.offset.set(frac(map.halfW / tileSize), frac(map.halfH / tileSize));
            tex.anisotropy = profile.anisotropy;
        };
        configure(albedo);
        albedo.colorSpace = SRGBColorSpace;
        material.map = albedo;
        if (normal) {
            configure(normal);
            material.normalMap = normal;
            const n = profile.normalScale;
            material.normalScale = new Vector2(n, n);
        }
        if (rock) {
            rock.wrapS = rock.wrapT = RepeatWrapping;
            rock.colorSpace = SRGBColorSpace;
            rock.anisotropy = profile.anisotropy;
        }
        for (const rp of [rockPhoto1, rockPhoto2]) {
            if (!rp) continue;
            rp.wrapS = rp.wrapT = RepeatWrapping;
            rp.colorSpace = SRGBColorSpace;
            rp.anisotropy = profile.anisotropy;
        }
        if (shore) {
            shore.wrapS = shore.wrapT = RepeatWrapping;
            shore.colorSpace = SRGBColorSpace;
            shore.anisotropy = profile.anisotropy;
        }
        if (sand) {
            sand.wrapS = sand.wrapT = RepeatWrapping;
            sand.colorSpace = SRGBColorSpace;
            sand.anisotropy = profile.anisotropy;
        }
        for (const v of grass.variants) {
            v.wrapS = v.wrapT = RepeatWrapping;
            v.colorSpace = SRGBColorSpace;
            v.anisotropy = profile.anisotropy;
            v.repeat.set(size / tileSize, size / tileSize);
            v.offset.set(frac(map.halfW / tileSize), frac(map.halfH / tileSize));
        }
        material.color.set(0xffffff);
        const useDetail = profile.detailStrength > 0;
        const bomb = useDetail && profile.textureBomb;
        // Soften the flat BOARD_TONE dim on HQ so meadow grass pops with the board.
        const toneMix = 0.35 + 0.65 * profile.macroStrength;
        material.onBeforeCompile = (shader) => {
            if (rock) shader.uniforms.uRock = { value: rock };
            if (rockPhoto1) shader.uniforms.uRockPhoto1 = { value: rockPhoto1 };
            if (rockPhoto2) shader.uniforms.uRockPhoto2 = { value: rockPhoto2 };
            if (photoGrass) {
                shader.uniforms.uPhotoGrass1 = { value: photoGrass[0] };
                shader.uniforms.uPhotoGrass2 = { value: photoGrass[1] };
            }
            if (shore) shader.uniforms.uShore = { value: shore };
            if (sand) shader.uniforms.uSand = { value: sand };
            shader.uniforms.uLakeBed = this.lakeBedUniform;
            shader.uniforms.uLakeDepthTex = this.lakeDepthTexUniform;
            shader.uniforms.uLakeDepthSpan = this.lakeDepthSpanUniform;
            shader.uniforms.uLakeTime = this.lakeTimeUniform;
            shader.uniforms.uLakeFreeze = this.waterFreezeUniform ?? { value: 0 };
            shader.uniforms.uSnowCover = { value: 0 };
            this.outerGroundSnowUniform = shader.uniforms.uSnowCover as { value: number };
            shader.uniforms.uAlpineCap = this.outerGroundAlpineUniform;
            shader.uniforms.uDryGrass = summerDryUniform;
            if (useDetail) {
                shader.uniforms.uDetailScale = { value: profile.detailScale };
                shader.uniforms.uDetailStrength = { value: profile.detailStrength };
            }
            bindCloseTileUniforms(shader.uniforms as Record<string, { value: unknown }>, profile);
            const softBlobFn =
                'float softBlobMask( vec2 uv, float cellScale, float density, float radius ) {\n' +
                '\tvec2 cell = floor( uv * cellScale );\n' +
                '\tfloat acc = 0.0;\n' +
                '\tfor ( int j = -1; j <= 1; j ++ ) {\n' +
                '\t\tfor ( int i = -1; i <= 1; i ++ ) {\n' +
                '\t\t\tvec2 c = cell + vec2( float( i ), float( j ) );\n' +
                '\t\t\tfloat h = fract( sin( dot( c, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
                '\t\t\tif ( h <= density ) {\n' +
                '\t\t\t\tvec2 jitter = vec2(\n' +
                '\t\t\t\t\tfract( sin( dot( c, vec2( 269.5, 183.3 ) ) ) * 43758.5453 ),\n' +
                '\t\t\t\t\tfract( sin( dot( c + 19.2, vec2( 113.5, 271.9 ) ) ) * 43758.5453 )\n' +
                '\t\t\t\t);\n' +
                '\t\t\t\tvec2 center = ( c + 0.5 + ( jitter - 0.5 ) * 0.9 ) / cellScale;\n' +
                '\t\t\t\tfloat d = length( uv - center ) * cellScale;\n' +
                '\t\t\t\tfloat r = radius * ( 0.5 + 0.5 * fract( h * 7.13 ) );\n' +
                '\t\t\t\tacc = max( acc, 1.0 - smoothstep( r * 0.25, r, d ) );\n' +
                '\t\t\t}\n' +
                '\t\t}\n' +
                '\t}\n' +
                '\treturn clamp( acc, 0.0, 1.0 );\n' +
                '}\n';
            shader.vertexShader =
                'attribute float aBeach;\nattribute float aShore;\nattribute float aScree;\nattribute float aMoss;\nattribute float aGrass;\nattribute float aRock;\nattribute float aSnow;\nvarying float vBeachV;\nvarying float vShore;\nvarying float vScree;\nvarying float vMoss;\nvarying float vGrass;\nvarying float vRock;\nvarying float vSnow;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;\n\tvWorldXZ = position.xz;\n\tvSlope = 1.0 - normal.y;\n\tvBeachV = aBeach;\n\tvShore = aShore;\n\tvScree = aScree;\n\tvMoss = aMoss;\n\tvGrass = aGrass;\n\tvRock = aRock;\n\tvSnow = aSnow;\n\tvWorldN = normalize( mat3( modelMatrix ) * objectNormal );',
                );
            shader.vertexShader = closeTileVertexShader(shader.vertexShader, profile);
            let inject = `
    diffuseColor.rgb *= mix( 1.0, ${BOARD_TONE.toFixed(2)}, ${toneMix.toFixed(2)} );`;
            if (profile.closeRepeat > 1.01) {
                inject += closeTileInjectGlsl(profile);
            } else {
                inject += closeTileWeightFallbackGlsl(profile);
            }
            if (bomb) {
                inject += textureBombGlsl((uv) => closeTileSampleGlsl(profile, uv));
            }
            if (useDetail) {
                if (profile.closeRepeat > 1.01) {
                    inject += `
    vec3 detailAlb = texture2D(map, mix( vMapUv, closeUv, closeW ) * uDetailScale).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);`;
                } else {
                    inject += `
    vec3 detailAlb = texture2D(map, vMapUv * uDetailScale).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);`;
                }
            }
            if (photoGrass) {
                const pgClose =
                    profile.closeRepeat > 1.01
                        ? `
    float pgSoft = softBlobMask( vMapUv, 1.15, 0.28, 0.12 );
    vec2 pgUv = vMapUv * 3.4;
    float pgWhich = fract( sin( dot( floor( vMapUv * 1.15 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 pgTex = mix(
        texture2D( uPhotoGrass1, pgUv ).rgb,
        texture2D( uPhotoGrass2, pgUv.yx * 1.07 + 0.21 ).rgb,
        step( 0.5, pgWhich ) );
    float pgLum = max( dot( pgTex, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 pgDetail = pgTex / pgLum;
    float pgAmt = pgSoft * 0.55 * mix( 1.0, 0.08, closeW );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pgDetail, pgAmt );`
                        : `
    float pgSoft = softBlobMask( vMapUv, 1.15, 0.28, 0.12 );
    vec2 pgUv = vMapUv * 3.4;
    float pgWhich = fract( sin( dot( floor( vMapUv * 1.15 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 pgTex = mix(
        texture2D( uPhotoGrass1, pgUv ).rgb,
        texture2D( uPhotoGrass2, pgUv.yx * 1.07 + 0.21 ).rgb,
        step( 0.5, pgWhich ) );
    float pgLum = max( dot( pgTex, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 pgDetail = pgTex / pgLum;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pgDetail, pgSoft * 0.55 );`;
                inject += `
    // Photo accents fade when zoomed in — keep close lawn uniform
${pgClose}`;
            }
            if (shore) {
                inject += `
    // gravel shore where the geometry says so: lake banks + rare dry patches
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uShore, vWorldXZ / ${shoreTile.toFixed(1)}).rgb, vBeach);`;
                if (sand) {
                    inject += `
    // lake beds: sand on the bank and in the shallows, gravel through the middle,
    // everything under the water darker and cooler with depth, a wet bank and
    // lapping foam${lakeCaustics ? ', caustics on the shallow bed' : ''}
    float lbDepth = ${WATER_LEVEL_Y.toFixed(2)} - vTerrainH;
    // sampled outside the branch below: a mip-mapped fetch needs uniform control flow
    vec3 lbSandTex = texture2D(uSand, vWorldXZ / ${LAKE_SAND_TILE.toFixed(1)}).rgb;
    vec3 lbGravelBig = texture2D(uShore, vWorldXZ / ${LAKE_GRAVEL_BIG_TILE.toFixed(1)} + vec2(0.37, 0.61)).rgb;
    // how big the lake here is (0 pond .. 1 big lake): small water gets calmer shores
    float lbLakeSize = smoothstep(${LAKE_SIZE_SMALL.toFixed(2)}, ${LAKE_SIZE_BIG.toFixed(2)}, texture2D(uLakeDepthTex, (vWorldXZ + uLakeDepthSpan) / (2.0 * uLakeDepthSpan)).g);
    // only near water (or on a gravel patch) does any of this change the colour
    if (vBeach > 0.001 || lbDepth > -0.7) {
        float lbSand = vBeach * (1.0 - smoothstep(0.3, 2.4, lbDepth)) * uLakeBed;
        diffuseColor.rgb = mix(diffuseColor.rgb, lbSandTex, lbSand);
        // the floor itself: not one gravel. Three noise scales pick where the stones
        // repeat at a second size, where brown silt settles in the deeper parts, and
        // which stones run blue-grey, rusty or algae green (the silt is the sand tile, darkened and browned)
        float lbUnder = smoothstep(0.1, 0.5, lbDepth) * uLakeBed;
        float lbA = lfNoise(vWorldXZ * 0.045 + 3.1);
        float lbB = lfNoise(vWorldXZ * 0.13 + 17.7);
        float lbC = lfNoise(vWorldXZ * 0.37 + 41.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, lbGravelBig, lbUnder * (1.0 - lbSand) * 0.55 * smoothstep(0.3, 0.7, lbB));
        // silt follows the depth: it fills the floor below about a metre and a half, so
        // the stones stay up by the coast. Noise only roughens where the edge runs.
        float lbRag = (lfNoise(vWorldXZ * 0.16 + 5.7) * 0.6 + lfNoise(vWorldXZ * 0.45 + 23.3) * 0.4 - 0.5) * ${LAKE_SILT_RAG.toFixed(2)};
        float lbSilt = smoothstep(${LAKE_SILT_FROM.toFixed(2)}, ${(LAKE_SILT_FROM + 0.9).toFixed(2)}, lbDepth + lbRag) * lbUnder;
        vec3 lbSiltCol = lbSandTex * vec3(0.66, 0.52, 0.38) * (0.84 + 0.32 * lbC);
        diffuseColor.rgb = mix(diffuseColor.rgb, lbSiltCol, lbSilt * 0.92);
        // the coloured stones live in the gravel, so they thin out where silt takes over
        vec3 lbTint = mix(vec3(1.0), vec3(0.74, 0.88, 1.10), smoothstep(0.55, 0.80, lbB));
        lbTint = mix(lbTint, vec3(1.10, 0.90, 0.68), smoothstep(0.55, 0.82, lbC) * 0.85);
        lbTint = mix(lbTint, vec3(0.82, 1.04, 0.76), smoothstep(0.62, 0.85, lfNoise(vWorldXZ * 0.09 + 91.0)) * smoothstep(0.3, 1.5, lbDepth));
        diffuseColor.rgb *= mix(vec3(1.0), lbTint, lbUnder * (1.0 - lbSilt));
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.34, 0.5, 0.56), smoothstep(0.3, 6.5, lbDepth) * uLakeBed);
        // wet bank: just above the waterline the sand is darker, drying out upward
        float lbWet = (1.0 - smoothstep(0.0, 0.55, -lbDepth)) * step(-0.55, lbDepth) * lbSand;
        diffuseColor.rgb *= 1.0 - 0.28 * lbWet;
        // lapping foam: a broken white line that surges up and back along the shore
        float lbSurge = lakeShoreSurge(vWorldXZ, uLakeTime) * mix(${LAKE_SMALL_SURGE.toFixed(2)}, 1.0, lbLakeSize);
        float lbFoam = lakeFoam(vWorldXZ, uLakeTime, lbDepth, lbSurge) * mix(${LAKE_SMALL_FOAM.toFixed(2)}, 1.0, lbLakeSize) * uLakeBed * (1.0 - smoothstep(0.0, 0.5, uLakeFreeze));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 0.98), lbFoam * 0.9);${lakeCaustics
                            ? `
        // caustics: sunlit net on the bed where the water is shallow, gone with depth and under ice
        float lbCaus = lakeCaustics(vWorldXZ, uLakeTime)
            * smoothstep(0.05, 0.45, lbDepth) * (1.0 - smoothstep(1.6, 4.5, lbDepth))
            * uLakeBed * (1.0 - smoothstep(0.0, 0.5, uLakeFreeze));
        diffuseColor.rgb += lbCaus * vec3(0.50, 0.48, 0.34);`
                            : ''
                        }
    }`;
                } else if (lakeLite) {
                    inject += `
    // lake beds (medium): the floor goes cool and dark with depth, the bank is wet
    // just above the waterline, and a thin static white line marks the edge —
    // no texture and no noise
    float lbDepth = ${WATER_LEVEL_Y.toFixed(2)} - vTerrainH;
    if (lbDepth > -0.7) {
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.34, 0.5, 0.56), smoothstep(0.3, 6.5, lbDepth) * uLakeBed);
        float lbWet = (1.0 - smoothstep(0.0, 0.55, -lbDepth)) * step(-0.55, lbDepth) * vBeach;
        diffuseColor.rgb *= 1.0 - 0.28 * lbWet * uLakeBed;
        float lbLine = (1.0 - smoothstep(0.0, 0.12, abs(lbDepth + 0.04))) * uLakeBed * (1.0 - smoothstep(0.0, 0.5, uLakeFreeze));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 0.98), lbLine * 0.7);
    }`;
                }
            }
            // meadow hills get the same drier / browner hillsides as the board; the mountains keep their own rock
            inject += slopeGroundGlsl({
                worldPos: 'vec3( vWorldXZ.x, vTerrainH, vWorldXZ.y )',
                worldNormal: 'vWorldN',
                earth: null,
                rock: null,
                fade: '1.0 - smoothstep( 10.0, 30.0, vTerrainH )',
            });
            inject += `${SNOW_SLOPE_HOLD_GLSL}
    float meadowSnowHold = snowSlopeHold;
${OUTER_MOUNTAIN_SNOW_GLSL}
    float rockF = 0.0;`;
            if (rock) {
                inject += `
    rockF = max(smoothstep(16.0, 55.0, vTerrainH), smoothstep(0.32, 0.58, vSlope) * smoothstep(3.0, 9.0, vTerrainH));
    rockF = max(rockF * (1.0 - snowF), cliffStrip * (0.14 + breakup * 0.4) * mix(0.1, 0.65, deepWinter));
    // Authored paint: force rock / suppress rock for grass shelves
    rockF = clamp( mix( rockF, 1.0, vRock ) * ( 1.0 - vGrass ), 0.0, 1.0 );
    snowF = clamp( mix( snowF, 1.0, vSnow ) * ( 1.0 - vGrass * ( 1.0 - smoothstep( 0.25, 0.7, uSnowCover ) ) ) * ( 1.0 - vRock * 0.85 ), 0.0, 1.0 );
    vec3 rockTop = texture2D(uRock, vWorldXZ / ${rockTile.toFixed(1)}).rgb;
    vec3 rockSide = texture2D(uRock, vec2(length(vWorldXZ), vTerrainH) / ${rockTile.toFixed(1)}).rgb;
    vec3 rockCol = mix(rockTop, rockSide, smoothstep(0.3, 0.72, vSlope));
    rockCol *= mix(vec3(1.0), vec3(0.42, 0.4, 0.38), deepWinter * mountainZone);`;
                if (rockPhoto1) {
                    const rk = PHOTO_BLEND.rock;
                    inject += `
    vec2 rockUv = vWorldXZ / ${rockPhotoTile.toFixed(1)};
    float rockSoft = softBlobMask( rockUv, ${rk.cellScale.toFixed(2)}, ${rk.density.toFixed(2)}, ${rk.radius.toFixed(2)} );
    float rWhich = fract( sin( dot( floor( rockUv * 0.85 ), vec2( 91.7, 53.1 ) ) ) * 43758.5453 );
    vec3 rockPhoto = texture2D( uRockPhoto1, rockUv * ${rk.uvScale.toFixed(2)} ).rgb;`;
                    if (rockPhoto2) {
                        inject += `
    rockPhoto = mix( rockPhoto, texture2D( uRockPhoto2, rockUv.yx * 1.25 + 0.17 ).rgb, step( 0.5, rWhich ) );`;
                    }
                    inject += `
    float rpLum = max( dot( rockPhoto, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    rockCol = mix( rockCol, rockCol * ( rockPhoto / rpLum ), rockSoft * ${rk.strength.toFixed(2)} );`;
                }
                inject += `
    diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockF);`;
                if (shore) {
                    inject += `
    // scree pockets: shore gravel (small stones piled in concave gullies)
    float screeShow = clamp( vScree * mountainZone * ( 1.0 - snowF ), 0.0, 1.0 );
    vec3 gravelCol = texture2D( uShore, vWorldXZ / ${shoreMountainTile.toFixed(1)} ).rgb;
    diffuseColor.rgb = mix( diffuseColor.rgb, gravelCol, screeShow * max( rockF, 0.3 ) );`;
                }
                inject += `
    // moss: mid-elevation cliffs/crevices only (~40–100 wu), baked in aMoss
    float midAlt = smoothstep( 40.0, 62.0, vTerrainH ) * ( 1.0 - smoothstep( 100.0, 124.0, vTerrainH ) );
    float mossShow = clamp( vMoss * ( 0.38 + 0.22 * breakup ) * midAlt, 0.0, 1.0 );
    // same snow tint as the board (see map.ts) so the field edge matches
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
    diffuseColor.rgb = mix( diffuseColor.rgb, mossDetail( vMapUv * vec2( 1.18, 0.92 ) ), mossShow * ( 1.0 - snowF ) * 0.82 );
${OUTER_MOUNTAIN_LIGHTING_GLSL}`;
            } else {
                inject += `
    snowF = clamp( mix( snowF, 1.0, vSnow ) * ( 1.0 - vGrass * ( 1.0 - smoothstep( 0.25, 0.7, uSnowCover ) ) ) * ( 1.0 - vRock * 0.85 ), 0.0, 1.0 );
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
${OUTER_MOUNTAIN_LIGHTING_GLSL}`;
            }
            const needBlob = !!(photoGrass || rockPhoto1);
            let frag =
                'varying float vBeachV;\nvarying float vShore;\nfloat vBeach;\nvarying float vScree;\nvarying float vMoss;\nvarying float vGrass;\nvarying float vRock;\nvarying float vSnow;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                (rock ? 'uniform sampler2D uRock;\n' : '') +
                (rockPhoto1 ? 'uniform sampler2D uRockPhoto1;\n' : '') +
                (rockPhoto2 ? 'uniform sampler2D uRockPhoto2;\n' : '') +
                (photoGrass ? 'uniform sampler2D uPhotoGrass1;\nuniform sampler2D uPhotoGrass2;\n' : '') +
                (shore ? 'uniform sampler2D uShore;\n' : '') +
                (sand ? 'uniform sampler2D uSand;\n' : '') +
                (sand || lakeLite ? 'uniform float uLakeBed;\n' : '') +
                (lakeLite ? 'uniform float uLakeFreeze;\n' : '') +
                (sand ? 'uniform float uLakeTime;\nuniform float uLakeFreeze;\nuniform sampler2D uLakeDepthTex;\nuniform float uLakeDepthSpan;\n' + LAKE_FOAM_FNS_GLSL : '') +
                (useDetail ? 'uniform float uDetailScale;\nuniform float uDetailStrength;\n' : '') +
                closeTileUniformDecls(profile) +
                SLOPE_GROUND_FNS +
                'uniform float uSnowCover;\nuniform float uAlpineCap;\nuniform float uDryGrass;\n' +
                (needBlob ? softBlobFn : '') +
                shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    // gravel/sand weight: the lake part fades up the bank by the
                    // pixel's own height, so the edge follows the ground's contour
                    // instead of the triangles the per-vertex value was sampled on
                    `#include <map_fragment>
    vBeach = max(vShore * (1.0 - smoothstep(0.1, 1.2, vTerrainH)), vBeachV);${inject}`,
                );
            if (rock) {
                frag = frag.replace(
                    '#include <map_pars_fragment>',
                    `#include <map_pars_fragment>\n${MOSS_DETAIL_FN_GLSL}`,
                );
            }
            if (useDetail && normal) {
                let normalInject = `#include <normal_fragment_maps>
\tvec3 detailN = texture2D( normalMap, vMapUv * uDetailScale ).xyz * 2.0 - 1.0;
\tdetailN.xy *= uDetailStrength;
\tnormal = normalize( vec3( normal.xy + detailN.xy, normal.z ) );`;
                if (profile.closeRepeat > 1.01) {
                    normalInject += `
\tvec3 closeN = texture2D( normalMap, vMapUv * uCloseRepeat ).xyz * 2.0 - 1.0;
\tnormal = normalize( mix( normal, closeN, closeW ) );`;
                }
                frag = frag.replace('#include <normal_fragment_maps>', normalInject);
            }
            if (profile.roughnessFromAlbedo) {
                frag = frag.replace(
                    '#include <roughnessmap_fragment>',
                    `#include <roughnessmap_fragment>
\tfloat grassLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
\troughnessFactor = clamp( roughnessFactor + ( 0.42 - grassLum ) * 0.22, 0.62, 0.98 );`,
                );
            }
            shader.fragmentShader = frag;
        };
        material.customProgramCacheKey = () =>
            `outer-meadow-v57-slope-snowhold${rock ? '-rock' : ''}${rockPhoto1 ? '-rp' : ''}${photoGrass ? '-pgmild' : ''}${shore ? '-scree-moss' : ''}${sand ? (lakeCaustics ? '-lakebed3-caus' : '-lakebed3') : lakeLite ? '-lakelite' : ''}-shorepx-matpaint-t${shoreTile}-m${shoreMountainTile}-${groundDetailCacheKey(profile)}`;
        material.needsUpdate = true;
    }

    /**
     * Trees, bushes — forest belt + a few on the battlefield.
     * High: dense low-poly forest. Ultra: same density with Tripo mid-poly GLBs.
     */
    private createForest(map: BattleMap, rng: () => number): void {
        const s = THEME.scenery;
        const dens = this.density;
        const hq = sceneryHqVegetation(this.quality);
        // Forest / props only inside the crest — past d=500 is culled (unseen).
        const margin = Math.min(dens.margin * this.os, this.reach - 10 * this.os);
        const acceptBase = dens.acceptBase;
        // forest measured from the playable edge so trees sit on the rim;
        // keepOut matches the pre-rim clearance (~2 tiles) so the wall isn't
        // tighter than the old board-edge forest
        const rimW = map.size.rimCells * CELL;
        const forestHalfW = map.halfW - rimW;
        const forestHalfH = map.halfH - rimW;
        const keepOut = 8;
        const beltFar = Math.min(dens.beltFar * this.os, this.reach - 20 * this.os);

        const distOut = (x: number, z: number) =>
            Math.max(Math.abs(x) - forestHalfW, Math.abs(z) - forestHalfH, 0);

        /** random grassy point outside the field (never on mountain stone / past crest) */
        const forestSpot = (maxHeight: number): { x: number; z: number } => {
            // now and then a spot on one of the alms, so they are not bare
            if (this.almSites.length > 0 && rng() < 0.04) {
                const site = this.almSites[Math.floor(rng() * this.almSites.length)]!;
                const a = rng() * Math.PI * 2;
                const r = Math.sqrt(rng()) * ALM_RADIUS * 0.85;
                return { x: site.x + Math.cos(a) * r, z: site.z + Math.sin(a) * r };
            }
            const tries = dens.outer >= 5 ? 80 : 24;
            for (let attempt = 0; attempt < tries; attempt++) {
                // ultra: near wall + mid meadow + far green foothills
                let sampleMargin = margin;
                if (dens.outer >= 5) {
                    const roll = rng();
                    if (roll < 0.34) sampleMargin = 140 * this.os; // board-edge wall
                    else if (roll < 0.55) sampleMargin = 280 * this.os; // mid meadow
                    else sampleMargin = margin; // green pockets toward mountains
                }
                sampleMargin = Math.min(sampleMargin, this.reach - 10 * this.os);
                const x = (rng() * 2 - 1) * (forestHalfW + sampleMargin);
                const z = (rng() * 2 - 1) * (forestHalfH + sampleMargin);
                if (pastBoard(map.halfW, map.halfH, x, z) >= this.reach) continue;
                const d = distOut(x, z);
                if (d < keepOut) continue;
                const h = this.terrainHeight(x, z);
                if (h > maxHeight) continue;
                if (h < -0.4) continue; // no trees in the lakes
                if (!this.isGrassy(x, z)) continue; // no trees on rock/snow
                if (this.plantClearedAt(x, z)) continue;
                // thin near the field, dense toward foothills, easing out past
                // beltFar (the crest cut above stops it for good)
                const belt =
                    smooth01((d - dens.beltNear * this.os) / (dens.beltRamp * this.os)) *
                    (1 - smooth01((d - beltFar) / (80 * this.os)));
                if (rng() > acceptBase + belt * (1 - acceptBase)) continue;
                return { x, z };
            }
            // fallback: any grassy outer point inside the crest
            for (let attempt = 0; attempt < 80; attempt++) {
                const x = (rng() * 2 - 1) * (forestHalfW + margin);
                const z = (rng() * 2 - 1) * (forestHalfH + margin);
                if (pastBoard(map.halfW, map.halfH, x, z) >= this.reach) continue;
                if (distOut(x, z) < keepOut) continue;
                if (this.terrainHeight(x, z) < -0.4) continue;
                if (!this.isGrassy(x, z)) continue;
                if (this.plantClearedAt(x, z)) continue;
                return { x, z };
            }
            // last resort (should be rare) — still inside crest
            for (let attempt = 0; attempt < 200; attempt++) {
                const x = (rng() * 2 - 1) * (forestHalfW + margin);
                const z = (rng() * 2 - 1) * (forestHalfH + margin);
                if (pastBoard(map.halfW, map.halfH, x, z) >= this.reach) continue;
                if (distOut(x, z) >= keepOut) return { x, z };
            }
            // spread out, so repeated fallbacks don't stack trees on one spot
            return { x: (rng() < 0.5 ? -1 : 1) * (forestHalfW + keepOut + 4 + rng() * 40), z: (rng() * 2 - 1) * forestHalfH };
        };
        // on the battlefield, but never in a base's courtyard
        const anchors = map.baseAnchors();
        const playHalfW = forestHalfW;
        const playHalfH = forestHalfH;
        const fieldSpot = (clearance: number): { x: number; z: number } => {
            for (; ;) {
                const x = (rng() * 2 - 1) * playHalfW;
                const z = (rng() * 2 - 1) * playHalfH;
                if (anchors.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + clearance)) {
                    return { x, z };
                }
            }
        };
        // field relief inside, mountain terrain outside (each is 0 elsewhere)
        // (the undeformed relief: reseatGroundedDecorations measures every instance against it,
        // so placing on ground a spell already reshaped would count that change twice)
        const boardRelief = map.reliefSampler();
        const groundY = (x: number, z: number) => this.terrainHeight(x, z) + boardRelief(x, z);

        const dummy = new Object3D();
        const color = new Color();
        const white = new Color(0xffffff);
        const lighten = (c: Color) => c.lerp(white, 0.45);
        // Ultra: Tripo on the board, billboards outside (via addHqVegetation).
        // High: Tripo on the board, billboards outside (with blob shadows).
        // Medium: billboards everywhere (no low-poly cones, no blob shadows).
        const billboardMix = this.quality === 'high' || this.quality === 'medium';
        const PINES = hq ? 0 : scaleCount(200, dens.outer * FOREST_TREES);
        const LEAFY = hq ? 0 : scaleCount(120, dens.outer * FOREST_TREES);
        const FIELD_PINES = hq ? 0 : scaleCount(3, dens.field);
        const FIELD_LEAFY = hq ? 0 : scaleCount(3, dens.field);
        const BUSHES = hq ? 0 : scaleCount(90, dens.outer * FOREST_TREES);
        const FIELD_BUSHES = hq ? 0 : scaleCount(22, dens.field);
        // horde mode widens the neutral strip into a real belt — grow a
        // forest in it so the horde has somewhere to live (pure scenery, no
        // collision; packs standing between trunks is the point). Treated
        // as on-field vegetation like FIELD_* above: zeroed on Ultra,
        // billboard/Tripo-routed on High/Medium.
        const beltHalf = (map.size.neutralRows * CELL) / 2;
        const beltWide = map.size.neutralRows > 8;
        const BELT_PINES = hq || !beltWide ? 0 : scaleCount(26, dens.field);
        const BELT_LEAFY = hq || !beltWide ? 0 : scaleCount(30, dens.field);
        const BELT_BUSHES = hq || !beltWide ? 0 : scaleCount(28, dens.field);
        const beltSpot = (): { x: number; z: number } => ({
            x: (rng() * 2 - 1) * (map.halfW - 8),
            z: (rng() * 2 - 1) * Math.max(0, beltHalf - 4),
        });

        const treeCapacity = PINES + LEAFY + FIELD_PINES + FIELD_LEAFY + BELT_PINES + BELT_LEAFY;
        const bushCapacity = BUSHES + FIELD_BUSHES + BELT_BUSHES;
        const placeProceduralTrees = treeCapacity > 0 && !billboardMix;

        let trunks: InstancedMesh | null = null;
        let cones: InstancedMesh | null = null;
        let blobs: InstancedMesh | null = null;
        let bushes: InstancedMesh | null = null;

        if (placeProceduralTrees) {
            trunks = new InstancedMesh(
                new CylinderGeometry(0.35, 0.55, 3.4, 6),
                new MeshStandardMaterial({ color: s.trunk, roughness: 0.9 }),
                treeCapacity,
            );
            cones = new InstancedMesh(
                new ConeGeometry(2.6, 6, 7),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
                (PINES + FIELD_PINES + BELT_PINES) * 2,
            );
            blobs = new InstancedMesh(
                new IcosahedronGeometry(2.4, 1),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
                (LEAFY + FIELD_LEAFY + BELT_LEAFY) * 2,
            );
            attachVegetationSnow(trunks.material as MeshStandardMaterial, { strength: 0.55 });
            attachVegetationSnow(cones.material as MeshStandardMaterial, { strength: 0.92 });
            attachVegetationSnow(blobs.material as MeshStandardMaterial, { strength: 0.92 });
            // pines stay green year-round — only the leafy (oak) canopy retints
            attachSeasonTint(blobs.material as MeshStandardMaterial);
        }
        if (bushCapacity > 0 && !billboardMix) {
            bushes = new InstancedMesh(
                new IcosahedronGeometry(1, 1),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
                bushCapacity,
            );
            attachVegetationSnow(bushes.material as MeshStandardMaterial, { strength: 0.92 });
            attachSeasonTint(bushes.material as MeshStandardMaterial);
        }

        let trunkI = 0;
        let coneI = 0;
        let blobI = 0;
        type PlantSpot = { kind: VegetationKind; x: number; z: number; sc: number };
        const farPlants: PlantSpot[] = [];
        const fieldHqPlants: PlantSpot[] = [];
        /** High: board → Tripo, outside → billboard. Medium: everything → billboard. */
        const routeBillboard = (
            onField: boolean,
            kind: VegetationKind,
            x: number,
            z: number,
            sc: number,
        ) => {
            if (this.plantClearedAt(x, z) || this.onDryPatch(x, z)) return true; // consume slot, skip place
            if (!billboardMix) return false;
            if (this.quality === 'high' && onField) fieldHqPlants.push({ kind, x, z, sc });
            else farPlants.push({ kind, x, z, sc });
            return true;
        };

        const placeTrunk = (x: number, z: number, sc: number, h: number) => {
            if (!trunks) return;
            dummy.position.set(x, h + 1.7 * sc, z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            trunks.setMatrixAt(trunkI++, dummy.matrix);
        };

        // Always walk the counts on high (for billboard/Tripo routing) even with no procedural meshes.
        for (let i = 0; i < PINES + FIELD_PINES + BELT_PINES; i++) {
            const onField = i >= PINES;
            const { x, z } = onField
                ? i < PINES + FIELD_PINES
                    ? fieldSpot(10)
                    : beltSpot()
                : forestSpot(84);
            const sc = onField ? 0.7 + rng() * 0.5 : 0.8 + rng() * 1.1;
            if (routeBillboard(onField, 'pine', x, z, sc)) continue;
            if (!trunks || !cones) continue;
            const h = groundY(x, z);
            placeTrunk(x, z, sc, h);
            lighten(color.set(s.pine).lerp(new Color(s.pineLight), rng()));
            for (const [ty, tsc] of [
                [3.2, 1],
                [6.2, 0.62],
            ] as const) {
                dummy.position.set(x, h + (3.4 * 0.5 + ty) * sc, z);
                dummy.scale.setScalar(sc * tsc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                cones.setMatrixAt(coneI, dummy.matrix);
                cones.setColorAt(coneI++, color);
            }
        }

        for (let i = 0; i < LEAFY + FIELD_LEAFY + BELT_LEAFY; i++) {
            const onField = i >= LEAFY;
            const { x, z } = onField
                ? i < LEAFY + FIELD_LEAFY
                    ? fieldSpot(10)
                    : beltSpot()
                : forestSpot(72);
            const sc = onField ? 0.75 + rng() * 0.55 : 0.9 + rng() * 1.2;
            if (routeBillboard(onField, 'oak', x, z, sc)) continue;
            if (!trunks || !blobs) continue;
            const h = groundY(x, z);
            placeTrunk(x, z, sc, h);
            lighten(color.set(s.leaf).lerp(new Color(s.leafLight), rng()));
            for (const [ox, oy, oz, bsc] of [
                [0, 4.6, 0, 1.15],
                [1.4, 3.6, 0.9, 0.7],
            ] as const) {
                dummy.position.set(x + ox * sc, h + oy * sc, z + oz * sc);
                dummy.scale.set(sc * bsc, sc * bsc * 0.85, sc * bsc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                blobs.setMatrixAt(blobI, dummy.matrix);
                blobs.setColorAt(blobI++, color);
            }
        }

        if (bushes || billboardMix) {
            let bushI = 0;
            for (let i = 0; i < BUSHES + FIELD_BUSHES + BELT_BUSHES; i++) {
                const onField = i >= BUSHES;
                const { x, z } = onField
                    ? i < BUSHES + FIELD_BUSHES
                        ? fieldSpot(5)
                        : beltSpot()
                    : forestSpot(56);
                const sc = 0.6 + rng() * 0.8;
                const kind: VegetationKind = rng() < 0.55 ? 'bushRound' : 'bushTall';
                if (routeBillboard(onField, kind, x, z, sc)) continue;
                if (!bushes) continue;
                dummy.position.set(x, groundY(x, z) + 0.45 * sc, z);
                dummy.scale.set(sc * (0.9 + rng() * 0.4), sc * 0.7, sc * (0.9 + rng() * 0.4));
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                bushes.setMatrixAt(bushI, dummy.matrix);
                lighten(color.set(s.leaf).lerp(new Color(s.leafLight), rng() * 0.8));
                bushes.setColorAt(bushI++, color);
            }
            if (bushes) bushes.count = bushI;
        }

        if (trunks) trunks.count = trunkI;
        if (cones) cones.count = coneI;
        if (blobs) blobs.count = blobI;

        for (const m of [trunks, cones, blobs, bushes]) {
            if (!m) continue;
            m.castShadow = true;
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            this.group.add(m);
            if (
                (this.quality === 'high' || this.quality === 'ultra') &&
                m.material instanceof MeshStandardMaterial
            ) {
                attachHazardTint(m.material, map, { strength: 'tree' });
            }
        }

        if (farPlants.length > 0) {
            void this.placeFarBillboards(farPlants, groundY, rng, {
                shadows: this.quality !== 'medium',
            });
        }
        if (fieldHqPlants.length > 0) {
            void this.placeTripoVegetation(fieldHqPlants, groundY, rng);
        }

        // wildflowers: 3/4 outer meadow, 1/4 playable board
        const FLOWERS_TOTAL = scaleCount(280, dens.outer); // half of former 560
        const MEADOW_FLOWERS = Math.round(FLOWERS_TOTAL * 0.75);
        const FIELD_FLOWERS = FLOWERS_TOTAL - MEADOW_FLOWERS;
        const FLOWERS = MEADOW_FLOWERS + FIELD_FLOWERS;
        const flowerGeo = new PlaneGeometry(1.1, 1.1);
        flowerGeo.rotateX(-Math.PI / 2);
        const flowers = new InstancedMesh(
            flowerGeo,
            new MeshStandardMaterial({
                map: makeFlowerTexture(),
                transparent: true,
                alphaTest: 0.4,
                roughness: 1,
                metalness: 0,
            }),
            FLOWERS,
        );
        this.flowerMaterials.push(flowers.material as MeshStandardMaterial);
        const flowerTones = THEME.terrain.flowers;
        const clearOfBases = (x: number, z: number) =>
            anchors.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + 3);
        // Board flowers: 1/6 edge strip, 1/3 midfield, 1/2 anywhere.
        const EDGE_BAND = 30;
        const midHalf = Math.max((map.size.neutralRows * CELL) / 2, map.halfH * 0.22, 18);
        const boardEdgeSpot = (): { x: number; z: number } => {
            for (; ;) {
                const side = Math.floor(rng() * 4);
                let x: number;
                let z: number;
                if (side === 0) {
                    x = (rng() * 2 - 1) * (map.halfW - 2);
                    z = map.halfH - 2 - rng() * EDGE_BAND;
                } else if (side === 1) {
                    x = (rng() * 2 - 1) * (map.halfW - 2);
                    z = -map.halfH + 2 + rng() * EDGE_BAND;
                } else if (side === 2) {
                    x = map.halfW - 2 - rng() * EDGE_BAND;
                    z = (rng() * 2 - 1) * (map.halfH - 2);
                } else {
                    x = -map.halfW + 2 + rng() * EDGE_BAND;
                    z = (rng() * 2 - 1) * (map.halfH - 2);
                }
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const boardMidSpot = (): { x: number; z: number } => {
            for (; ;) {
                const x = (rng() * 2 - 1) * (map.halfW - 2);
                const z = (rng() * 2 - 1) * Math.min(midHalf, map.halfH - EDGE_BAND - 2);
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const boardRandomSpot = (): { x: number; z: number } => {
            for (; ;) {
                const x = (rng() * 2 - 1) * (map.halfW - 2);
                const z = (rng() * 2 - 1) * (map.halfH - 2);
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const meadowSpot = (): { x: number; z: number } => {
            for (; ;) {
                const x = (rng() * 2 - 1) * (forestHalfW + 260);
                const z = (rng() * 2 - 1) * (forestHalfH + 260);
                if (distOut(x, z) < 1) continue; // just outside the forest edge
                const h = this.terrainHeight(x, z);
                if (h > -0.4 && h < 5) return { x, z }; // meadow only, not in lakes
            }
        };
        // Small color-matched clumps — not large patches
        let flowerI = 0;
        const plantFlowerClump = (cx: number, cz: number, spread: number) => {
            const clumpTone = flowerTones[Math.floor(rng() * flowerTones.length)]!;
            const clump = 3 + Math.floor(rng() * 5);
            for (let f = 0; f < clump && flowerI < FLOWERS; f++) {
                const x = cx + (rng() - 0.5) * spread;
                const z = cz + (rng() - 0.5) * spread;
                const sc = 0.7 + rng() * 0.9;
                dummy.position.set(x, groundY(x, z) + 0.08, z);
                dummy.scale.setScalar(sc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                flowers.setMatrixAt(flowerI, dummy.matrix);
                color.set(rng() < 0.75 ? clumpTone : flowerTones[Math.floor(rng() * flowerTones.length)]!);
                flowers.setColorAt(flowerI++, color);
            }
        };
        while (flowerI < MEADOW_FLOWERS) {
            const center = meadowSpot();
            plantFlowerClump(center.x, center.z, 9);
        }
        const fieldEdgeEnd = MEADOW_FLOWERS + Math.round(FIELD_FLOWERS / 6);
        const fieldMidEnd = MEADOW_FLOWERS + Math.round(FIELD_FLOWERS / 2); // edge 1/6 + mid 1/3
        while (flowerI < fieldEdgeEnd) {
            const center = boardEdgeSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        while (flowerI < fieldMidEnd) {
            const center = boardMidSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        while (flowerI < FLOWERS) {
            const center = boardRandomSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        flowers.count = flowerI;
        flowers.instanceMatrix.needsUpdate = true;
        if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
        this.group.add(flowers);
        // High+: tint petals sitting in oil/acid (medium skips — one less sample).
        if (this.quality === 'high' || this.quality === 'ultra') {
            for (const m of this.flowerMaterials) {
                attachHazardTint(m, map, { fadeAlpha: true });
            }
        }

        if (trunks && cones && blobs && bushes) {
            void this.applyForestTextures(
                trunks.material as MeshStandardMaterial,
                cones.material as MeshStandardMaterial,
                [blobs.material as MeshStandardMaterial, bushes.material as MeshStandardMaterial],
            );
        }

        if (hq) {
            void this.addHqVegetation(map, rng, {
                forestSpot,
                fieldSpot,
                groundY,
            }).then(() => {
                void this.rebuildAuthoredPlantMeshes();
            });
        } else {
            void this.rebuildAuthoredPlantMeshes();
        }

        if (floorPiecesEnabled(this.quality)) {
            void this.placeFloorPieces(map, rng, { fieldSpot, forestSpot, groundY });
        }
    }

    /** Ground clutter from floorpieces.glb — board props + a few special placements. */
    private async placeFloorPieces(
        map: BattleMap,
        rng: () => number,
        helpers: {
            fieldSpot: (clearance: number) => { x: number; z: number };
            forestSpot: (maxHeight: number) => { x: number; z: number };
            groundY: (x: number, z: number) => number;
        },
    ): Promise<void> {
        await loadFloorPieces();
        const { fieldSpot, forestSpot, groundY } = helpers;

        // One of each authored piece — shuffle so positions aren't fixed by load order.
        const ids = listFloorPieces();
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = ids[i]!;
            ids[i] = ids[j]!;
            ids[j] = tmp;
        }

        const placements: FloorPiecePlacement[] = [];
        const pushPiece = (id: string, x: number, z: number, tilt = 0.22) => {
            const scale = floorPieceScale(id, rng);
            placements.push({
                id,
                x,
                y: groundY(x, z) - floorPieceGroundSink(scale),
                z,
                scale,
                yaw: rng() * Math.PI * 2,
                tiltX: (rng() - 0.5) * tilt,
                tiltZ: (rng() - 0.5) * tilt,
            });
        };

        for (const id of ids) {
            const { x, z } = fieldSpot(3);
            pushPiece(id, x, z);
        }

        // Same GLB set in the outer forest/meadow (replaces procedural stones/logs/mushrooms).
        const forestPool = listFloorPieces();
        const FOREST = scaleCount(this.quality === 'ultra' ? 160 : 90, this.density.meadow);
        for (let i = 0; i < FOREST && forestPool.length > 0; i++) {
            const id = forestPool[Math.floor(rng() * forestPool.length)]!;
            const { x, z } = forestSpot(40);
            pushPiece(id, x, z);
        }

        // `stone` ×4, evenly along the mid line between the two sides (z ≈ 0).
        const STONE_COUNT = 4;
        const margin = 10;
        const span = map.halfW * 2 - margin * 2;
        for (let i = 0; i < STONE_COUNT; i++) {
            const x = -map.halfW + margin + ((i + 0.5) / STONE_COUNT) * span;
            pushPiece('stone', x, 0, 0.12);
        }

        // Easter-egg coin — once, in the outer woods, well clear of the board.
        {
            const rimW = map.size.rimCells * CELL;
            const forestHalfW = map.halfW - rimW;
            const forestHalfH = map.halfH - rimW;
            const distOut = (x: number, z: number) =>
                Math.max(Math.abs(x) - forestHalfW, Math.abs(z) - forestHalfH, 0);
            const COIN_MIN_DIST = 120;
            let x = 0;
            let z = 0;
            let found = false;
            for (let attempt = 0; attempt < 80; attempt++) {
                const spot = forestSpot(56);
                if (distOut(spot.x, spot.z) < COIN_MIN_DIST) continue;
                x = spot.x;
                z = spot.z;
                found = true;
                break;
            }
            if (!found) {
                // Fallback: push a forest sample outward along its ray from the board.
                const spot = forestSpot(56);
                const d = Math.max(distOut(spot.x, spot.z), 1);
                const scaleOut = COIN_MIN_DIST / d;
                x = spot.x * scaleOut;
                z = spot.z * scaleOut;
            }
            pushPiece('coin', x, z, 0.18);
        }

        const meshes = buildFloorPieceMeshes(placements);
        for (const mesh of meshes) {
            this.group.add(mesh);
            if (mesh.material instanceof MeshStandardMaterial) {
                attachHazardTint(mesh.material, map, { strength: 'tree' });
            }
        }
        console.info(
            `[scenery] floor pieces: ${placements.length} (board + ${FOREST} forest + specials)`,
        );
        // they load late: the ground may already have moved under them
        this.reseatGroundedDecorations();
    }

    /** Far belt as crossed billboard cards; optional sun-aligned blob shadows. */
    private async placeFarBillboards(
        plants: { kind: VegetationKind; x: number; z: number; sc: number }[],
        groundY: (x: number, z: number) => number,
        rng: () => number,
        opts: { shadows?: boolean } = {},
    ): Promise<void> {
        const withShadows = opts.shadows !== false;
        await loadSceneryBillboards();
        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        const shadows: BlobShadowSource[] = [];
        let total = 0;
        for (const kind of kinds) {
            const list = plants.filter((p) => p.kind === kind);
            if (list.length === 0) continue;
            const mesh = createBillboardInstances(kind, list.length);
            if (!mesh) {
                console.warn(`[scenery] billboard '${kind}' missing`);
                continue;
            }
            for (const p of list) {
                const sc = p.sc * BILLBOARD_SCALE;
                placeBillboardInstance(
                    mesh,
                    p.x,
                    groundY(p.x, p.z) - BILLBOARD_Y_SINK,
                    p.z,
                    sc,
                    rng() * Math.PI * 2,
                    dummy,
                );
                if (withShadows) {
                    shadows.push({ x: p.x, z: p.z, radius: billboardShadowRadius(kind, sc) });
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            total += mesh.count;
        }
        if (withShadows) this.treeShadows.setSources(shadows);
        else this.treeShadows.setSources([]);
        console.info(`[scenery] far billboards: ${total}${withShadows ? ' +shadows' : ''}`);
    }

    /** On-board Tripo GLBs (high) — matches billboard art direction. */
    private async placeTripoVegetation(
        plants: { kind: VegetationKind; x: number; z: number; sc: number }[],
        groundY: (x: number, z: number) => number,
        rng: () => number,
    ): Promise<void> {
        await loadSceneryVegetation();
        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        let total = 0;
        for (const kind of kinds) {
            const list = plants.filter((p) => p.kind === kind);
            if (list.length === 0) continue;
            const mesh = createVegetationInstances(kind, list.length);
            if (!mesh) {
                console.warn(`[scenery] Tripo '${kind}' missing`);
                continue;
            }
            for (const p of list) {
                placeVegetationInstance(
                    mesh,
                    p.x,
                    groundY(p.x, p.z),
                    p.z,
                    p.sc,
                    rng() * Math.PI * 2,
                    dummy,
                );
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            if (mesh.material instanceof MeshStandardMaterial) {
                attachHazardTint(mesh.material, this.map, { strength: 'tree' });
            }
            total += mesh.count;
        }
        console.info(`[scenery] field Tripo: ${total}`);
    }

    /**
     * Ultra: Tripo mid-poly on the board only; outer forest = billboards
     * (same color language as high — no lit-PBR vs unlit-card seam outside).
     */
    private async addHqVegetation(
        map: BattleMap,
        rng: () => number,
        helpers: {
            forestSpot: (maxHeight: number) => { x: number; z: number };
            fieldSpot: (clearance: number) => { x: number; z: number };
            groundY: (x: number, z: number) => number;
        },
    ): Promise<void> {
        const boardTrees3d = sceneryBoardTrees3d(this.quality);
        await Promise.all([boardTrees3d ? loadSceneryVegetation() : Promise.resolve(), loadSceneryBillboards()]);
        const dens = this.density;
        const { forestSpot, fieldSpot, groundY } = helpers;

        const trees = dens.outer * FOREST_TREES;
        const OAK = scaleCount(120, trees);
        const PINE = scaleCount(200, trees);
        const BUSH_R = scaleCount(50, trees);
        const BUSH_T = scaleCount(40, trees);
        const FIELD_OAK = scaleCount(3, dens.field);
        const FIELD_PINE = scaleCount(3, dens.field);
        const FIELD_BUSH = scaleCount(22, dens.field);

        type Plant = { kind: VegetationKind; x: number; z: number; sc: number; near: boolean };
        const plants: Plant[] = [];

        for (let i = 0; i < OAK + FIELD_OAK; i++) {
            const onField = i >= OAK;
            const { x, z } = onField ? fieldSpot(10) : forestSpot(72);
            const sc = onField ? 0.7 + rng() * 0.35 : 0.85 + rng() * 0.55;
            plants.push({
                kind: 'oak',
                x,
                z,
                sc,
                near: onField,
            });
        }
        for (let i = 0; i < PINE + FIELD_PINE; i++) {
            const onField = i >= PINE;
            const { x, z } = onField ? fieldSpot(10) : forestSpot(84);
            const sc = onField ? 0.65 + rng() * 0.3 : 0.8 + rng() * 0.5;
            plants.push({
                kind: 'pine',
                x,
                z,
                sc,
                near: onField,
            });
        }
        const bushRTotal = BUSH_R + Math.ceil(FIELD_BUSH / 2);
        for (let i = 0; i < bushRTotal; i++) {
            const onField = i >= BUSH_R;
            const { x, z } = onField ? fieldSpot(5) : forestSpot(56);
            plants.push({
                kind: 'bushRound',
                x,
                z,
                sc: 0.75 + rng() * 0.55,
                near: onField,
            });
        }
        const bushTTotal = BUSH_T + Math.floor(FIELD_BUSH / 2);
        for (let i = 0; i < bushTTotal; i++) {
            const onField = i >= BUSH_T;
            const { x, z } = onField ? fieldSpot(5) : forestSpot(56);
            plants.push({
                kind: 'bushTall',
                x,
                z,
                sc: 0.7 + rng() * 0.5,
                near: onField,
            });
        }

        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        let nearN = 0;
        let farN = 0;
        const shadows: BlobShadowSource[] = [];

        for (const kind of kinds) {
            // (without 3D board trees, the board's trees are billboards like the forest's)
            const nearList = plants.filter((p) => p.kind === kind && p.near && boardTrees3d && !this.plantClearedAt(p.x, p.z) && !this.onDryPatch(p.x, p.z));
            const farList = plants.filter((p) => p.kind === kind && (!p.near || !boardTrees3d) && !this.plantClearedAt(p.x, p.z) && !this.onDryPatch(p.x, p.z));

            if (nearList.length > 0) {
                const mesh = createVegetationInstances(kind, nearList.length);
                if (!mesh) {
                    console.warn(`[scenery] HQ '${kind}' missing`);
                } else {
                    for (const p of nearList) {
                        placeVegetationInstance(
                            mesh,
                            p.x,
                            groundY(p.x, p.z),
                            p.z,
                            p.sc,
                            rng() * Math.PI * 2,
                            dummy,
                        );
                    }
                    mesh.instanceMatrix.needsUpdate = true;
                    this.group.add(mesh);
                    if (mesh.material instanceof MeshStandardMaterial) {
                        attachHazardTint(mesh.material, map, { strength: 'tree' });
                    }
                    nearN += mesh.count;
                }
            }

            if (farList.length > 0) {
                const mesh = createBillboardInstances(kind, farList.length);
                if (!mesh) {
                    console.warn(`[scenery] billboard '${kind}' missing`);
                } else {
                    for (const p of farList) {
                        const sc = p.sc * BILLBOARD_SCALE;
                        placeBillboardInstance(
                            mesh,
                            p.x,
                            groundY(p.x, p.z) - BILLBOARD_Y_SINK,
                            p.z,
                            sc,
                            rng() * Math.PI * 2,
                            dummy,
                        );
                        shadows.push({ x: p.x, z: p.z, radius: billboardShadowRadius(kind, sc) });
                    }
                    mesh.instanceMatrix.needsUpdate = true;
                    this.group.add(mesh);
                    farN += mesh.count;
                }
            }
        }

        // medium draws no tree shadows (as before)
        this.treeShadows.setSources(this.quality === 'medium' ? [] : shadows);
        console.info(`[scenery] HQ vegetation: board3D=${nearN} outerBillboards=${farN}`);
    }

    /**
     * Swaps the flat forest colors for generated bark/foliage textures once
     * they load; instance colors keep providing the per-tree hue variation.
     */
    private async applyForestTextures(
        trunkMat: MeshStandardMaterial,
        coneMat: MeshStandardMaterial,
        leafMats: MeshStandardMaterial[],
    ): Promise<void> {
        const [bark, foliage] = await Promise.all([
            loadWorldTexture(barkUrl()),
            loadWorldTexture(foliageUrl()),
        ]);
        console.info(`[scenery] forest textures: bark=${!!bark} foliage=${!!foliage}`);
        if (bark) {
            bark.colorSpace = SRGBColorSpace;
            bark.wrapS = bark.wrapT = RepeatWrapping;
            bark.repeat.set(1.5, 1);
            trunkMat.map = bark;
            trunkMat.color.set(0xffffff); // the texture carries the brown now
            trunkMat.needsUpdate = true;
        }
        if (foliage) {
            foliage.colorSpace = SRGBColorSpace;
            foliage.wrapS = foliage.wrapT = RepeatWrapping;
            const coneFoliage = foliage.clone();
            coneFoliage.repeat.set(1.5, 1);
            coneMat.map = coneFoliage;
            coneMat.needsUpdate = true;
            for (const m of leafMats) {
                m.map = foliage;
                m.needsUpdate = true;
            }
        }
    }

    /** Shared cloud puff texture — always built so Weather can wire near-cloud FX. */
    private createCloudAssets(rng: () => number): void {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        for (let b = 0; b < 9; b++) {
            const x = 50 + rng() * 156;
            const y = 45 + rng() * 38;
            const r = 22 + rng() * 26;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        this.cloudTexture = texture;
        this.cloudMaterial = new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: THEME.scenery.cloudOpacity,
            depthWrite: false,
        });
    }

    /** flat puffs on the horizon + summit wisps — tinted by the weather system */
    private createHorizonCloudMeshes(map: BattleMap, rng: () => number): void {
        const material = this.cloudMaterial;
        const geometry = new PlaneGeometry(1, 0.5);
        geometry.rotateX(-Math.PI / 2);

        for (let i = 0; i < 12; i++) {
            const mesh = new Mesh(geometry, material);
            const farSide = rng() < 0.7;
            // Keep sky cards inside the crest ring — nothing useful past d=500
            const lane = map.halfH + 80 * this.os + rng() * Math.min(280 * this.os, this.reach - 80 * this.os);
            mesh.position.set(
                (rng() * 2 - 1) * this.cloudBoundsX,
                110 + rng() * 60,
                farSide ? -lane : lane,
            );
            const scale = 90 + rng() * 130;
            mesh.scale.set(scale, 1, scale * (0.4 + rng() * 0.3));
            this.clouds.push({ mesh, speed: 2 + rng() * 3 });
            this.group.add(mesh);
        }

        if (!this.detailed) return;
        const peakCap = this.density.peakClouds;
        let placed = 0;
        for (let attempt = 0; attempt < 6000 && placed < peakCap; attempt++) {
            const span = Math.min(this.worldSize * 0.5, map.halfW + this.reach);
            const x = (rng() * 2 - 1) * span;
            const z = (rng() * 2 - 1) * span;
            if (pastBoard(map.halfW, map.halfH, x, z) >= this.reach) continue;
            const h = this.terrainHeight(x, z);
            if (h < 165) continue;
            if (this.peakClouds.some((p) => Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z) < 90)) {
                continue;
            }
            const mesh = new Mesh(geometry, material);
            mesh.position.set(x, h - 4 + rng() * 16, z);
            const scale = 55 + rng() * 70;
            mesh.scale.set(scale, 1, scale * (0.35 + rng() * 0.3));
            this.peakClouds.push({
                mesh,
                baseX: x,
                phase: rng() * Math.PI * 2,
                speed: 0.05 + rng() * 0.06,
            });
            this.group.add(mesh);
            placed++;
        }
    }
}

/**
 * Moss/lichen on rock — re-tints the meadow grass map yellow/brown (no extra texture).
 * Kept darker/subtle so it reads as damp growth on stone, not bright straw.
 */
const MOSS_DETAIL_FN_GLSL = `
vec3 mossDetail( vec2 uv ) {
    vec3 g = texture2D( map, uv ).rgb;
    float lum = max( dot( g, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 straw = ( g / lum ) * vec3( 0.78, 0.48, 0.06 );
    vec3 darkOrange = vec3( 0.48, 0.28, 0.04 );
    vec3 moss = mix( g * vec3( 0.82, 0.5, 0.06 ), mix( straw, darkOrange, 0.72 ), 0.94 );
    return moss * 0.78;
}
`;

/**
 * Shared outer snow. Meadow (low) matches the board (`map.ts`: snowMask * 0.82
 * toward 0.92/0.95/0.98). Mountains keep extra winter density + rock ribs.
 */
const OUTER_MOUNTAIN_SNOW_GLSL = `
    float mountainZone = smoothstep(16.0, 55.0, vTerrainH);
    float dryPatch = 0.52 + 0.48 * fract(sin(dot(vWorldXZ * 0.068, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 dryCol = mix(diffuseColor.rgb * vec3(1.18, 1.05, 0.55), vec3(0.72, 0.64, 0.28), 0.16);
    diffuseColor.rgb = mix(diffuseColor.rgb, dryCol, uDryGrass * (1.0 - mountainZone) * (1.0 - vBeach) * dryPatch);
    // Snow settles on shelves and crests and slides off steep faces, so the rock strata read
    // against white instead of drowning in it. Altitude only wins some of that back, and never
    // on a near-vertical wall.
    float slopeHold = 1.0 - smoothstep(0.2, 0.6, vSlope) * 0.9;
    float peakBoost = smoothstep(120.0, 240.0, vTerrainH) * (1.0 - smoothstep(0.45, 0.8, vSlope));
    float snowHold = min(1.0, slopeHold + peakBoost * 0.4);
    float deepWinter = smoothstep(0.82, 1.0, uSnowCover);
    float alpineSnow = smoothstep(148.0, 215.0, vTerrainH) * snowHold * uAlpineCap;
    float snowLine = mix(220.0, -15.0, uSnowCover);
    float weatherSnow = smoothstep(snowLine - 40.0, snowLine + 15.0, vTerrainH);
    float meadowSnow = weatherSnow * 0.82 * meadowSnowHold;
    float winterAmp = mix(1.05, 1.68, smoothstep(0.72, 1.0, uSnowCover));
    float mountainLift = smoothstep(40.0, 170.0, vTerrainH) * deepWinter * 0.48 * (0.25 + 0.75 * slopeHold);
    float mountainSnow = min(1.0, max(alpineSnow, weatherSnow * snowHold * 0.92) * winterAmp + mountainLift);
    float macroN = fract(sin(dot(floor(vWorldXZ * 0.04), vec2(127.1, 311.7))) * 43758.5453);
    float mesoN = fract(sin(dot(vWorldXZ * 0.13, vec2(269.5, 183.3))) * 43758.5453);
    float breakup = macroN * 0.62 + mesoN * 0.38;
    float cliffStrip = smoothstep(0.36, 0.8, vSlope) * smoothstep(40.0, 170.0, vTerrainH);
    mountainSnow = clamp(mountainSnow - cliffStrip * (0.35 + breakup * 0.45), 0.0, 1.0);
    float snowF = mix(meadowSnow, mountainSnow, mountainZone);
    // deep winter buries everything: no bare steep face, no cliff rock showing through
    float burial = smoothstep(0.6, 0.9, uSnowCover);
    snowF = mix(snowF, 1.0, burial * mountainZone);
    cliffStrip *= 1.0 - burial;
    vec3 meadowCol = ${LAWN_SNOW_COLOR_GLSL};
    vec3 snowHi = mix(meadowCol, vec3(1.0, 1.0, 1.0), deepWinter);
    vec3 snowLo = mix(meadowCol, vec3(0.86, 0.9, 0.96), deepWinter);
    float sunLit = clamp(dot(normalize(vWorldN), normalize(vec3(0.4, 0.82, 0.25))) * 0.5 + 0.5, 0.0, 1.0);
    vec3 snowCol = mix(meadowCol, mix(snowLo, snowHi, sunLit), mountainZone);`;

/** Directional contrast on mountain relief only — leave the meadow/board edge alone. */
const OUTER_MOUNTAIN_LIGHTING_GLSL = `
    float contrast = mix(0.18, 0.36, deepWinter);
    diffuseColor.rgb *= mix(1.0, mix(0.62, 1.22, sunLit), mountainZone * contrast);`;

/** a handful of tapered grass blades, white — tinted green per instance */
/**
 * A drift of fallen leaves on a transparent square: a dozen pointed leaves at random angles,
 * each with a darker midrib and a little shading, in near-white so the per-card tint colours
 * them (orange, amber, rust, yellow).
 */
function makeLeafLitterTexture(): CanvasTexture {
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(4711);
    const leaves = 14;
    for (let i = 0; i < leaves; i++) {
        // keep them inside a disc, so the card has no square outline
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * S * 0.33;
        const x = S / 2 + Math.cos(a) * r;
        const y = S / 2 + Math.sin(a) * r;
        const len = S * (0.1 + rng() * 0.08);
        const wid = len * (0.38 + rng() * 0.2);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rng() * Math.PI * 2);
        const v = Math.round(200 + rng() * 55);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        // a leaf: two arcs meeting in points at base and tip
        ctx.beginPath();
        ctx.moveTo(-len / 2, 0);
        ctx.quadraticCurveTo(0, -wid, len / 2, 0);
        ctx.quadraticCurveTo(0, wid, -len / 2, 0);
        ctx.fill();
        // one side a shade darker (the leaf's fold) and the midrib
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        ctx.beginPath();
        ctx.moveTo(-len / 2, 0);
        ctx.quadraticCurveTo(0, wid, len / 2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = Math.max(1, len * 0.04);
        ctx.beginPath();
        ctx.moveTo(-len * 0.55, 0);
        ctx.lineTo(len / 2, 0);
        ctx.stroke();
        ctx.restore();
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function makeTuftTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(777);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    for (let b = 0; b < 7; b++) {
        const baseX = 8 + rng() * 48;
        const tipX = baseX + (rng() - 0.5) * 18;
        const topY = 4 + rng() * 20;
        const w = 2 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(baseX - w, 64);
        ctx.lineTo(tipX, topY);
        ctx.lineTo(baseX + w, 64);
        ctx.closePath();
        ctx.fill();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** a little cluster of petal flowers on transparent ground — tinted per instance */
function makeFlowerTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(424242);
    const flower = (cx: number, cy: number, r: number) => {
        // Soft cream, not pure white — pure white petals trip selective bloom
        // under the sun (same luminance gate as fire/magic).
        ctx.fillStyle = 'rgba(200, 190, 175, 0.9)';
        for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + rng();
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(220, 170, 40, 1)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
    };
    flower(22, 24, 5.5);
    flower(43, 40, 4.5);
    flower(36, 14, 3.5);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/**
 * High/ultra: sample the board hazard mask at each instance's world XZ and
 * tint over oil/acid/fire. Trees & floor props use ground-matching slick +
 * live fire glow (clears when the blaze dies). Flowers keep a softer soak.
 * Outside the board UV clamps to black (no tint). Shared materials attach once
 * but always rebind to the live map mask (asset cache outlives scenery rebuilds).
 */
function attachHazardTint(
    material: MeshStandardMaterial,
    map: BattleMap,
    opts: { fadeAlpha?: boolean; strength?: 'flower' | 'tree' } = {},
): void {
    const fadeAlpha = opts.fadeAlpha === true;
    const tree = opts.strength === 'tree';
    const hazardMask = map.getHazardMask();
    const boardHalf = new Vector2(map.halfW, map.halfH);

    // Shared materials live in the Tripo/billboard cache across map rebuilds —
    // always point uniforms at the current mask even if already attached.
    let maskRef = material.userData.hazardMaskRef as { value: CanvasTexture } | undefined;
    let halfRef = material.userData.hazardBoardHalfRef as { value: Vector2 } | undefined;
    if (!maskRef) {
        maskRef = { value: hazardMask };
        material.userData.hazardMaskRef = maskRef;
    } else {
        maskRef.value = hazardMask;
    }
    if (!halfRef) {
        halfRef = { value: boardHalf };
        material.userData.hazardBoardHalfRef = halfRef;
    } else {
        halfRef.value.copy(boardHalf);
    }

    if (material.userData.hazardTintAttached) return;
    material.userData.hazardTintAttached = true;
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey.bind(material);
    // Trees: photo-black oil (match ground). Flowers: softer readable brown.
    const oilTint = tree ? 'vec3(0.0012, 0.0012, 0.0012)' : 'vec3(0.22, 0.12, 0.05)';
    const acidTint = tree ? 'vec3(0.06, 0.20, 0.03)' : 'vec3(0.14, 0.34, 0.06)';
    const oilMix = tree ? '0.995' : '0.92';
    const acidMix = tree ? '0.94' : '0.88';
    const fireMix = tree ? '0.96' : '0.55';
    const alphaLine = fadeAlpha
        ? `\n  diffuseColor.a *= 1.0 - oilM * 0.5 - acidM * 0.45 - orangeM * 0.35;`
        : '';
    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        shader.uniforms.uFlowerHazardMask = maskRef!;
        shader.uniforms.uFlowerBoardHalf = halfRef!;
        shader.uniforms.uHazardTime = hazardTimeShared;
        shader.uniforms.uFireCharcoalGround = fireCharcoalGroundUniform;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
uniform vec2 uFlowerBoardHalf;
varying vec2 vFlowerHazUv;`,
        );
        // instance origin → board UV (matches ground macro / CanvasTexture flipY)
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
{
  vec3 flowerBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFlowerHazUv = vec2(
    (flowerBase.x + uFlowerBoardHalf.x) / max(2.0 * uFlowerBoardHalf.x, 1e-3),
    (uFlowerBoardHalf.y - flowerBase.z) / max(2.0 * uFlowerBoardHalf.y, 1e-3)
  );
}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform sampler2D uFlowerHazardMask;
uniform float uHazardTime;
uniform float uFireCharcoalGround;
varying vec2 vFlowerHazUv;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  vec3 haz = texture2D(uFlowerHazardMask, vFlowerHazUv).rgb;
  float oilM = smoothstep(0.04, 0.28, haz.r);
  float fireG = smoothstep(0.14, 0.5, haz.g);
  float fireB = smoothstep(0.12, 0.48, haz.b);
  float acidM = fireB * (1.0 - fireG * 0.85);
  float orangeM = fireG * (1.0 - fireB * 0.85);
  vec3 oilTint = ${oilTint};
  vec3 acidTint = ${acidTint};
  diffuseColor.rgb = mix(diffuseColor.rgb, oilTint, oilM * ${oilMix});
  diffuseColor.rgb = mix(diffuseColor.rgb, acidTint, acidM * ${acidMix});
  // Live ground fire (oil blaze or direct fire) — clears when haz.g dies
  float flicker = 0.55 + 0.45 * sin(uHazardTime * 9.0 + vFlowerHazUv.x * 40.0 + vFlowerHazUv.y * 28.0);
  vec3 fireCol = mix(vec3(0.18, 0.03, 0.0), vec3(1.0, 0.38, 0.05), flicker);
  diffuseColor.rgb = mix(diffuseColor.rgb, fireCol, orangeM * ${fireMix});${alphaLine}
}`,
        );
    };
    material.customProgramCacheKey = () =>
        `${prevKey()}|hazard-tint-v11-${tree ? 'tree' : 'flower'}${fadeAlpha ? '-fade' : ''}`;
    material.needsUpdate = true;
}
