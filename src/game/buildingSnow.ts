import { Mesh, MeshStandardMaterial, type Object3D } from 'three';

/** Base buildings that get upward-face snow (not shield/rocket extras). */
export const BUILDING_SNOW_IDS = new Set(['command-tower', 'research-center', 'stronghold']);

/** Shared 0..1 cover for building roof snow (lags ground on the way up, clears fast). */
const buildingSnowUniform = { value: 0 };
let buildingCover = 0;

/** Roofs wait until the field is already whitening, then ease in. */
const BUILDING_SNOW_GROUND_START = 0.4;
const BUILDING_SNOW_GROUND_FULL = 0.92;
/** Slower than ground wash so grass reads first. */
const BUILDING_SNOW_GROW_TAU = 12;
/** Drop roof snow almost immediately when the storm ends. */
const BUILDING_SNOW_MELT_TAU = 0.4;

/**
 * Per-material attach set. Do NOT use userData alone as a guard: Three.js
 * `Material.clone()` copies userData but resets `onBeforeCompile` to a no-op.
 */
const attached = new WeakSet<MeshStandardMaterial>();

/** Direct set (tests / forced snaps). Prefer {@link updateBuildingSnowCover}. */
export function setBuildingSnowCover(v: number): void {
    buildingCover = Math.min(1, Math.max(0, v));
    buildingSnowUniform.value = buildingCover;
}

/**
 * Building snow lags the ground while accumulating, and clears quickly when
 * it stops snowing — opposite of the lingering ground melt.
 */
export function updateBuildingSnowCover(dtSeconds: number, groundSnow: number, snowing: boolean): void {
    let target = 0;
    if (snowing) {
        const t =
            (groundSnow - BUILDING_SNOW_GROUND_START) /
            (BUILDING_SNOW_GROUND_FULL - BUILDING_SNOW_GROUND_START);
        target = Math.min(1, Math.max(0, t));
        // ease-in so roofs don't jump at the threshold
        target = target * target;
    }
    const tau = target > buildingCover ? BUILDING_SNOW_GROW_TAU : BUILDING_SNOW_MELT_TAU;
    buildingCover += (target - buildingCover) * Math.min(1, dtSeconds / tau);
    if (!snowing && buildingCover < 0.015) buildingCover = 0;
    buildingSnowUniform.value = buildingCover;
}

/**
 * Procedural snow on upward-facing surfaces. World-normal Y so tipped wrecks
 * keep snow on what was the roof. Driven by {@link updateBuildingSnowCover}.
 *
 * Call again after every `material.clone()` — clones drop shader hooks.
 */
export function attachBuildingSnow(material: MeshStandardMaterial): void {
    if (attached.has(material)) return;
    attached.add(material);
    material.userData.wantsBuildingSnow = true;

    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        shader.uniforms.uBuildingSnow = buildingSnowUniform;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vBuildingSnowUp = normalize(
#ifdef USE_INSTANCING
  mat3(modelMatrix * instanceMatrix) * objectNormal
#else
  mat3(modelMatrix) * objectNormal
#endif
).y;
vBuildingSnowXZ = (
#ifdef USE_INSTANCING
  (modelMatrix * instanceMatrix * vec4(transformed, 1.0))
#else
  (modelMatrix * vec4(transformed, 1.0))
#endif
).xz;`,
        );
        shader.vertexShader = `varying float vBuildingSnowUp;\nvarying vec2 vBuildingSnowXZ;\n` + shader.vertexShader;

        shader.fragmentShader =
            `uniform float uBuildingSnow;\nvarying float vBuildingSnowUp;\nvarying vec2 vBuildingSnowXZ;\n` +
            shader.fragmentShader.replace(
                '#include <color_fragment>',
                `#include <color_fragment>
  // pitched roofs (Garrison etc.) still catch snow — only near-vertical walls stay bare
  float upSnow = smoothstep(0.12, 0.55, max(vBuildingSnowUp, 0.0));
  float flake = fract(sin(dot(floor(vBuildingSnowXZ * 0.55), vec2(12.9898, 78.233))) * 43758.5453);
  upSnow *= mix(0.72, 1.0, flake);
  float snowF = upSnow * uBuildingSnow;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.98), snowF * 0.94);
`,
            );
    };

    material.customProgramCacheKey = function () {
        return (prevKey ? prevKey.call(this) : '') + '|building-snow-v2';
    };
    material.needsUpdate = true;
}

/** Re-hook snow after `src.clone()` — Three drops onBeforeCompile on clone. */
export function preserveBuildingSnow(src: MeshStandardMaterial, dst: MeshStandardMaterial): void {
    if (src.userData.wantsBuildingSnow || attached.has(src)) attachBuildingSnow(dst);
}

/** Attach snow to every standard material under a building template / clone. */
export function attachBuildingSnowToObject(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
            if (m instanceof MeshStandardMaterial) attachBuildingSnow(m);
        }
    });
}
