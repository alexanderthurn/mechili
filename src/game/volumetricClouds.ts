/**
 * Ultra scenery: real-time 3D volumetric clouds.
 *
 * Replaces the 2D billboard cloud quads with 3D participating-media volumes rendered
 * via raymarching inside oriented bounding boxes.
 *
 * Density modelling (the remap technique from Guerrilla Games / Horizon Zero Dawn):
 *  - A smooth envelope defines where a cloud *could* form (flat base, dome top, round edges)
 *  - Low-frequency 4-octave FBM sculpts the actual shape: the remap makes noise peaks
 *    survive near the envelope boundary, creating natural billowy cauliflower turrets
 *  - High-frequency 3-octave FBM erodes the edges for wispy, detailed boundaries
 *
 * Lighting:
 *  - Beer-Lambert extinction + powder-darkening for realistic thick-cloud interiors
 *  - 5-step secondary light march for internal self-shadowing
 *  - Dual-lobe Henyey-Greenstein phase function: forward scatter (g=0.76) for silver
 *    linings when backlit + mild back-scatter (g=-0.3) for bright sun-facing edges
 *  - Height-graded ambient: sky light from above, ground-reflected light from below
 *
 * Integration with Melodan's weather system:
 *  - uCloudTint / uCloudOpacity driven from the weather's composed sky target each frame
 *  - uSunDir / uSunColor follow the DirectionalLight (dawn/dusk/noon/storm colours)
 */
import {
    Color,
    BackSide,
    ShaderMaterial,
    Vector2,
    Vector3,
} from 'three';
import { type SceneryQuality } from './prefs';

/** True only on ultra scenery: volumetric 3D clouds instead of 2D billboard quads. */
export function sceneryVolumetricClouds(quality: SceneryQuality): boolean {
    return quality === 'ultra';
}

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vHalfSize;

void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    // the box's half extent in world units (the clouds are never rotated)
    vHalfSize = 0.5 * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------
//
// Everything is marched in WORLD units. The box only shapes the envelope (where the cloud may
// be); the noise, the step lengths and the optical depth are measured in world units, so a
// 200 × 40 cloud has round turrets and is as dense seen from the side as from above. (Marching
// in the box's own 0..1 space stretched every puff with the box's aspect and made the side
// view many times thicker than the top.)

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbientTop;
uniform vec3  uAmbientBottom;
uniform vec3  uCloudTint;
uniform float uCloudOpacity;
uniform float uTime;
/** the board's half size (x, z) and how dense a cloud stays over it (1 = as elsewhere) */
uniform vec2  uBoardHalf;
uniform float uBoardDensity;
uniform float uCloudBoardK;

varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vHalfSize;

// this pixel's density factor: thin where the view through the cloud lands on the board
float gBoardK = 1.0;

// size of the big billows (world units) and of the eroding detail
const float SHAPE_SIZE = 24.0;
const float DETAIL_SIZE = 7.0;
// extinction per world unit at full density: ~12 units of solid cloud is near opaque
const float EXTINCTION = 0.32;
const int   STEPS = 20;
const int   LIGHT_STEPS = 3;
const float LIGHT_STEP = 7.0;

float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i),                 hash3(i + vec3(1, 0, 0)), u.x),
            mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
        mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x),
            mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
        u.z);
}

float fbm3(vec3 p) {
    float f = 0.55 * vnoise(p); p = p * 2.03 + vec3(1.7, 3.2, 0.5);
    f += 0.30 * vnoise(p);      p = p * 2.01 + vec3(2.3, 1.1, 4.1);
    f += 0.15 * vnoise(p);
    return f;
}

float remap01(float x, float lo, float hi) {
    return clamp((x - lo) / max(hi - lo, 1e-4), 0.0, 1.0);
}

float hgPhase(float c, float g) {
    float g2 = g * g;
    float d = 1.0 + g2 - 2.0 * g * c;
    return (1.0 - g2) / (4.0 * 3.14159265 * d * sqrt(d));
}

// the envelope: where this cloud may be — a flat base, a domed top, round sides that pull in
// toward the top (box space, -0.5..0.5)
float envelope(vec3 b, vec3 wp, vec3 seed) {
    float h = b.y + 0.5;
    float r = length(b.xz * 2.0);
    // the underside: flat only in the middle, curving up toward the rim, and undulating with a
    // slow noise so a few bulges hang lower
    // (kept inside the box: the bulges have room below the middle's level, never cut by the floor)
    float baseH = max(0.02, 0.1 + 0.26 * r * r + (vnoise(vec3(wp.x / 45.0, 0.0, wp.z / 45.0) + seed) - 0.5) * 0.2);
    float base = smoothstep(baseH, baseH + 0.14, h);
    float top = 1.0 - smoothstep(0.55, 1.0, h);
    // (the sides pull in only a little toward the top: a broad cloud, not a tower)
    float w = mix(0.95, 0.72, h * h);
    return base * top * smoothstep(w, w * 0.35, r);
}

// density at a world point; 'detail' off for the cheap self-shadow samples
float density(vec3 wp, vec3 seed, bool detail) {
    vec3 b = (wp - vCenter) / (2.0 * vHalfSize);
    float env = envelope(b, wp, seed);
    if (env < 0.01) return 0.0;
    vec3 wind = vec3(uTime * 0.6, 0.0, uTime * 0.2);
    // the noise also drifts slowly through its own depth: the billows roll and change shape
    // instead of only sliding along with the wind
    vec3 churn = vec3(0.0, uTime * 0.012, uTime * 0.007);
    float shape = fbm3((wp + wind) / SHAPE_SIZE + seed + churn);
    // Horizon's remap: deep inside the envelope nearly any noise makes cloud, at its rim only
    // the peaks do — the billowy boundary
    float d = remap01(shape, 1.0 - env, 1.0);
    d *= gBoardK;
    if (d < 0.01 || !detail) return d;
    float ero = fbm3((wp + wind * 1.5) / DETAIL_SIZE + seed * 1.7 + churn * 2.5);
    d -= ero * 0.35 * (1.0 - smoothstep(0.0, 0.5, d) * 0.6);
    return clamp(d, 0.0, 1.0);
}

void main() {
    if (uCloudOpacity <= 0.005) discard;

    // the ray from the camera through this pixel, clipped to the box (drawn from the box's back
    // faces, so it still works when the camera is inside or close to it)
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - ro);
    vec3 inv = 1.0 / (rd + 1e-6);
    vec3 t0 = (vCenter - vHalfSize - ro) * inv;
    vec3 t1 = (vCenter + vHalfSize - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tIn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tOut = min(min(tmax.x, tmax.y), tmax.z);
    if (tOut <= tIn) discard;

    // how dense this cloud is: thinner the more of it covers the board from the camera's view
    // (one value for the whole cloud, set per cloud — see Scenery.updateCloudBoardCover)
    gBoardK = uCloudBoardK;

    vec3 seed = vec3(vCenter.x * 0.013, vCenter.y * 0.029, vCenter.z * 0.017);
    float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
    vec3 sun = normalize(uSunDir);
    float cosT = dot(rd, sun);
    // a gentle silver lining toward the sun: the phase is scaled so an even scatter is 1, and
    // capped — unscaled it multiplied the sun up to ~19x and tone mapping turned it to yellow
    float phase = min(mix(hgPhase(cosT, 0.55), hgPhase(cosT, -0.2), 0.4) * 4.0 * 3.14159265, 2.2);
    // clouds are white: the sun's hue only tints them (warm at dusk, not a yellow wash)
    float sunLum = max(dot(uSunColor, vec3(0.299, 0.587, 0.114)), 1e-3);
    vec3 sunCol = mix(vec3(sunLum), uSunColor, 0.35);

    float len = tOut - tIn;
    float ds = len / float(STEPS);
    vec3 col = vec3(0.0);
    float trans = 1.0;
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (tIn + ds * (float(i) + jitter));
        float d = density(p, seed, true);
        if (d <= 0.004) continue;
        // how much sun reaches here (a short march toward it, without the fine detail)
        float od = 0.0;
        for (int j = 1; j <= LIGHT_STEPS; j++) {
            od += density(p + sun * LIGHT_STEP * float(j), seed, false) * LIGHT_STEP;
        }
        float sunT = exp(-od * EXTINCTION * 0.9);
        // powder: the sun-facing skin of a thick cloud is brighter than its dense core
        float powder = 1.0 - exp(-d * 4.0);
        float h = clamp((p.y - (vCenter.y - vHalfSize.y)) / (2.0 * vHalfSize.y), 0.0, 1.0);
        vec3 ambient = mix(uAmbientBottom, uAmbientTop, h) * 0.8;
        vec3 light = (sunCol * sunT * mix(0.55, 1.0, powder) * phase * 0.55 + ambient) * uCloudTint;
        float a = 1.0 - exp(-d * ds * EXTINCTION);
        col += trans * light * a;
        trans *= 1.0 - a;
        if (trans < 0.02) break;
    }
    float alpha = 1.0 - trans;
    if (alpha < 0.004) discard;
    // soften where the box meets far scenery: a cloud fades out, it never cuts a hard line
    gl_FragColor = vec4(min(col / alpha, vec3(1.25)), alpha * uCloudOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// TypeScript interface and factory
// ---------------------------------------------------------------------------

export interface VolumetricCloudUniforms {
    uSunDir: { value: Vector3 };
    uSunColor: { value: Color };
    uAmbientTop: { value: Color };
    uAmbientBottom: { value: Color };
    uCloudTint: { value: Color };
    uCloudOpacity: { value: number };
    uTime: { value: number };
    uBoardHalf: { value: Vector2 };
    uBoardDensity: { value: number };
    uCloudBoardK: { value: number };
    [key: string]: { value: unknown };
}

export interface VolumetricCloudMaterial extends ShaderMaterial {
    uniforms: VolumetricCloudUniforms;
}

export interface VolumetricCloudMaterialOptions {
    opacity?: number;
    /** the board's half size: clouds thin out over it */
    boardHalfW?: number;
    boardHalfH?: number;
    /** how dense a cloud stays over the board (0..1) */
    boardDensity?: number;
}

export function createVolumetricCloudMaterial(opts: VolumetricCloudMaterialOptions = {}): VolumetricCloudMaterial {
    const uniforms: VolumetricCloudUniforms = {
        uSunDir: { value: new Vector3(0.5, 0.8, 0.3).normalize() },
        uSunColor: { value: new Color(0xfff5e6) },
        uAmbientTop: { value: new Color(0.68, 0.80, 0.98) },
        uAmbientBottom: { value: new Color(0.44, 0.46, 0.42) },
        uCloudTint: { value: new Color(0xffffff) },
        uCloudOpacity: { value: opts.opacity ?? 0.8 },
        uTime: { value: 0 },
        uBoardHalf: { value: new Vector2(opts.boardHalfW ?? 0, opts.boardHalfH ?? 0) },
        uBoardDensity: { value: opts.boardDensity ?? 0.35 },
        uCloudBoardK: { value: 1 },
    };
    return new ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        // back faces: the ray still starts at the camera when it is inside or next to the box
        side: BackSide,
        toneMapped: true,
        fog: false,
    }) as VolumetricCloudMaterial;
}
