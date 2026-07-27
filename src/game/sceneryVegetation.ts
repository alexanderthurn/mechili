/**
 * Higher-detail Tripo vegetation for ultra scenery + shared billboard cards
 * for far trees (high + ultra).
 */

import {
    Box3,
    BufferGeometry,
    Color,
    DoubleSide,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    SRGBColorSpace,
    TextureLoader,
    Vector3,
    type Object3D as Obj3D,
    type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import type { SceneryQuality } from './prefs';
import { TRANSITION_TAU, type Season } from './weather';

export type VegetationKind = 'oak' | 'pine' | 'bushRound' | 'bushTall';

export interface VegetationAsset {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
    /** local height after normalize (world units at scale 1) */
    height: number;
}

/** World units past the board edge that still get real 3D trees. */
export const NEAR_TREE_DIST = 48;

/** Far cards read thinner than volumetric trees — bump scale so the belt matches. */
export const BILLBOARD_SCALE = 1.55;

/** Sink billboards into the ground a bit (transparent PNG padding reads as floating). */
export const BILLBOARD_Y_SINK = 1.85;

/** MeshBasic cards miss sun lift; multiply albedo so they match lit near trees. */
export const BILLBOARD_BRIGHTNESS = 1.55;

const SPECS: Record<
    VegetationKind,
    {
        url: string;
        /** target local height in world units */
        height: number;
        /** summer / default albedo */
        billboard: string;
        /** snow-laden billboard variant (mixed in by snow-line cover) */
        billboardSnow: string;
        billboardSpring: string;
        billboardAutumn: string;
    }
> = {
    oak: {
        url: new URL('../../assets/models/scenery/tree-oak.glb', import.meta.url).href,
        height: 10,
        billboard: new URL('../../assets/textures/scenery/billboard-oak.png', import.meta.url).href,
        billboardSnow: new URL('../../assets/textures/scenery/billboard-oak-snow.png', import.meta.url)
            .href,
        billboardSpring: new URL(
            '../../assets/textures/scenery/billboard-oak-spring.png',
            import.meta.url,
        ).href,
        billboardAutumn: new URL(
            '../../assets/textures/scenery/billboard-oak-autumn.png',
            import.meta.url,
        ).href,
    },
    pine: {
        url: new URL('../../assets/models/scenery/tree-pine.glb', import.meta.url).href,
        height: 12,
        billboard: new URL('../../assets/textures/scenery/billboard-pine.png', import.meta.url).href,
        billboardSnow: new URL('../../assets/textures/scenery/billboard-pine-snow.png', import.meta.url)
            .href,
        billboardSpring: new URL(
            '../../assets/textures/scenery/billboard-pine-spring.png',
            import.meta.url,
        ).href,
        billboardAutumn: new URL(
            '../../assets/textures/scenery/billboard-pine-autumn.png',
            import.meta.url,
        ).href,
    },
    bushRound: {
        url: new URL('../../assets/models/scenery/bush-round.glb', import.meta.url).href,
        height: 2.4,
        billboard: new URL('../../assets/textures/scenery/billboard-bush-round.png', import.meta.url)
            .href,
        billboardSnow: new URL(
            '../../assets/textures/scenery/billboard-bush-round-snow.png',
            import.meta.url,
        ).href,
        billboardSpring: new URL(
            '../../assets/textures/scenery/billboard-bush-round-spring.png',
            import.meta.url,
        ).href,
        billboardAutumn: new URL(
            '../../assets/textures/scenery/billboard-bush-round-autumn.png',
            import.meta.url,
        ).href,
    },
    bushTall: {
        url: new URL('../../assets/models/scenery/bush-tall.glb', import.meta.url).href,
        height: 3.2,
        billboard: new URL('../../assets/textures/scenery/billboard-bush-tall.png', import.meta.url)
            .href,
        billboardSnow: new URL(
            '../../assets/textures/scenery/billboard-bush-tall-snow.png',
            import.meta.url,
        ).href,
        billboardSpring: new URL(
            '../../assets/textures/scenery/billboard-bush-tall-spring.png',
            import.meta.url,
        ).href,
        billboardAutumn: new URL(
            '../../assets/textures/scenery/billboard-bush-tall-autumn.png',
            import.meta.url,
        ).href,
    },
};

const loader = new GLTFLoader();
const texLoader = new TextureLoader();
const cache = new Map<VegetationKind, VegetationAsset>();
const billboardCache = new Map<VegetationKind, { geometry: BufferGeometry; material: MeshBasicMaterial }>();
let loadPromise: Promise<void> | null = null;
let billboardPromise: Promise<void> | null = null;
type BillboardSeasonMaps = Record<Season, Texture>;

/** Season shown on billboard `map` (fade source). */
let billboardFromSeason: Season = 'spring';
/** Season bound to `uSeasonMapB` (fade target). */
let billboardToSeason: Season = 'spring';
/** Shared 0→1 crossfade; when ≥1 we commit `map` to the target and reset. */
const seasonFadeUniform = { value: 0 };
/** Live leaf tint (lerped) vs target set by {@link setVegetationSeason}. */
const seasonTintCurrent = new Vector3(0.86, 1.12, 0.82); // spring
const seasonTintTarget = new Vector3(0.86, 1.12, 0.82);

/** Materials that receive the shared weather snow-line uniform. */
const snowMaterials: { userData: { snowCoverUniform?: { value: number } } }[] = [];

/**
 * Drive vegetation snow from the same cover value as the ground shaders.
 * Per-tree factor uses instance world Y against the descending snow line.
 */
export function setVegetationSnowCover(v: number): void {
    for (const m of snowMaterials) {
        if (m.userData.snowCoverUniform) m.userData.snowCoverUniform.value = v;
    }
}

/**
 * Mix toward snow when the tree's base sits under the advancing snow line
 * (same math as meadow/board). Optional snowMap swaps billboard albedo.
 */
export function attachVegetationSnow(
    material: MeshStandardMaterial | MeshBasicMaterial,
    opts: { snowMap?: Texture | null; strength?: number } = {},
): void {
    if (material.userData.vegSnowAttached) return;
    material.userData.vegSnowAttached = true;
    snowMaterials.push(material);

    const strength = opts.strength ?? 0.9;
    const snowMap = opts.snowMap ?? null;
    const prevCompile = material.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        const cover = material.userData.snowCoverUniform ?? { value: 0 };
        material.userData.snowCoverUniform = cover;
        shader.uniforms.uSnowCover = cover;
        if (snowMap) shader.uniforms.uSnowMap = { value: snowMap };

        let header = 'uniform float uSnowCover;\n';
        if (snowMap) header += 'uniform sampler2D uSnowMap;\n';

        const inject =
            `
#ifdef USE_INSTANCING
  vec3 treeBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 treeBase = vec3(0.0);
#endif
  float alpineSnow = smoothstep(170.0, 235.0, treeBase.y);
  float snowLine = mix(220.0, -15.0, uSnowCover);
  float weatherSnow = smoothstep(snowLine - 40.0, snowLine + 15.0, treeBase.y);
  float snowF = max(alpineSnow, weatherSnow);
` +
            (snowMap
                ? `
  vec3 snowAlbedo = texture2D(uSnowMap, vMapUv).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, snowF * ${strength.toFixed(3)});
`
                : `
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.98), snowF * ${strength.toFixed(3)});
`);

        shader.fragmentShader =
            header +
            shader.fragmentShader.replace(
                '#include <color_fragment>',
                `#include <color_fragment>\n${inject}`,
            );
    };
    material.needsUpdate = true;
}

/** True when Tripo mid-poly trees replace the procedural forest (ultra only). */
export function sceneryHqVegetation(quality: SceneryQuality): boolean {
    return quality === 'ultra';
}

/** multiply tint per season — 1,1,1 (summer) leaves the baked leaf/bush colors untouched.
 *  Winter keeps an autumn-dormant cast (not green) so First frost → Winter doesn't re-leaf. */
const SEASON_LEAF_TINT: Record<Season, readonly [number, number, number]> = {
    spring: [0.86, 1.12, 0.82],
    summer: [1, 1, 1],
    autumn: [1.35, 0.78, 0.34],
    winter: [1.18, 0.72, 0.4],
};

/** Materials that receive the shared season leaf-tint uniform (oak/bush — pines stay green). */
const seasonMaterials: { userData: { seasonTintUniform?: { value: Vector3 } } }[] = [];

function tintForSeason(season: Season): readonly [number, number, number] {
    return SEASON_LEAF_TINT[season];
}

/**
 * Begin a foliage season transition (tint target + billboard map crossfade).
 * Call {@link updateVegetationSeason} each frame to ease.
 */
export function setVegetationSeason(season: Season): void {
    const [r, g, b] = tintForSeason(season);
    seasonTintTarget.set(r, g, b);
    beginBillboardSeasonFade(season);
}

/** @deprecated use {@link setVegetationSeason} */
export function setVegetationSeasonTint(season: Season): void {
    setVegetationSeason(season);
}

/**
 * Ease leaf tint + billboard crossfade toward the pending season.
 * Uses the same tau as atmosphere so sky and foliage land together.
 */
export function updateVegetationSeason(dtSeconds: number): void {
    const k = Math.min(1, dtSeconds / TRANSITION_TAU);
    seasonTintCurrent.lerp(seasonTintTarget, k);

    if (billboardFromSeason === billboardToSeason) {
        seasonFadeUniform.value = 0;
        return;
    }
    seasonFadeUniform.value = Math.min(1, seasonFadeUniform.value + dtSeconds / TRANSITION_TAU);
    if (seasonFadeUniform.value >= 1 - 1e-4) {
        commitBillboardSeason(billboardToSeason);
    }
}

/**
 * Crossfade far-tree billboard albedo (spring/autumn art; winter = summer map + snow).
 * Mid-fade retargets from the dominant side so rapid N-taps stay coherent.
 */
export function setBillboardSeason(season: Season): void {
    beginBillboardSeasonFade(season);
}

function beginBillboardSeasonFade(season: Season): void {
    if (season === billboardToSeason && seasonFadeUniform.value > 0) return;
    if (season === billboardFromSeason && seasonFadeUniform.value < 1e-4) {
        billboardToSeason = season;
        return;
    }
    // Mid-crossfade: lock in whichever side we're closer to, then fade toward `season`.
    if (seasonFadeUniform.value > 0.5) {
        commitBillboardSeason(billboardToSeason);
    } else if (seasonFadeUniform.value > 1e-4) {
        seasonFadeUniform.value = 0;
        syncBillboardMapB(billboardFromSeason); // reset B; about to set new target
    }
    if (season === billboardFromSeason) {
        billboardToSeason = season;
        seasonFadeUniform.value = 0;
        syncBillboardMapB(season);
        return;
    }
    billboardToSeason = season;
    seasonFadeUniform.value = 0;
    for (const card of billboardCache.values()) {
        const maps = card.material.userData.seasonMaps as BillboardSeasonMaps | undefined;
        if (!maps) continue;
        const fromTex = maps[billboardFromSeason] ?? maps.summer;
        const toTex = maps[season] ?? maps.summer;
        card.material.map = fromTex;
        const mapB = card.material.userData.seasonMapBUniform as { value: Texture } | undefined;
        if (mapB) mapB.value = toTex;
        card.material.needsUpdate = true;
    }
}

function commitBillboardSeason(season: Season): void {
    billboardFromSeason = season;
    billboardToSeason = season;
    seasonFadeUniform.value = 0;
    for (const card of billboardCache.values()) {
        const maps = card.material.userData.seasonMaps as BillboardSeasonMaps | undefined;
        if (!maps) continue;
        const tex = maps[season] ?? maps.summer;
        card.material.map = tex;
        const mapB = card.material.userData.seasonMapBUniform as { value: Texture } | undefined;
        if (mapB) mapB.value = tex;
        card.material.needsUpdate = true;
    }
}

function syncBillboardMapB(season: Season): void {
    for (const card of billboardCache.values()) {
        const maps = card.material.userData.seasonMaps as BillboardSeasonMaps | undefined;
        if (!maps) continue;
        const tex = maps[season] ?? maps.summer;
        const mapB = card.material.userData.seasonMapBUniform as { value: Texture } | undefined;
        if (mapB) mapB.value = tex;
    }
}

/**
 * Mix `map` → `uSeasonMapB` by shared `uSeasonFade` (after map_fragment, before snow).
 */
function attachBillboardSeasonFade(material: MeshBasicMaterial): void {
    if (material.userData.seasonFadeAttached) return;
    material.userData.seasonFadeAttached = true;
    const mapB = { value: material.map as Texture };
    material.userData.seasonMapBUniform = mapB;
    const prevCompile = material.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        shader.uniforms.uSeasonFade = seasonFadeUniform;
        shader.uniforms.uSeasonMapB = mapB;
        shader.fragmentShader =
            'uniform float uSeasonFade;\nuniform sampler2D uSeasonMapB;\n' +
            shader.fragmentShader.replace(
                '#include <map_fragment>',
                `#include <map_fragment>
#ifdef USE_MAP
  if (uSeasonFade > 0.001) {
    vec4 seasonTexA = texture2D(map, vMapUv);
    vec4 seasonTexB = texture2D(uSeasonMapB, vMapUv);
    vec4 seasonMixed = mix(seasonTexA, seasonTexB, uSeasonFade);
    diffuseColor /= max(seasonTexA, vec4(1e-4));
    diffuseColor *= seasonMixed;
  }
#endif
`,
            );
    };
    material.needsUpdate = true;
}

/**
 * Multiplies diffuse color by the shared `uSeasonLeaf` uniform — a live
 * season retint that survives instance-baked colors without a scenery rebuild.
 */
export function attachSeasonTint(material: MeshStandardMaterial | MeshBasicMaterial): void {
    if (material.userData.seasonTintAttached) return;
    material.userData.seasonTintAttached = true;
    seasonMaterials.push(material);
    const prevCompile = material.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        // Shared live vector — updateVegetationSeason lerps it in place.
        const tint = material.userData.seasonTintUniform ?? { value: seasonTintCurrent };
        material.userData.seasonTintUniform = tint;
        tint.value = seasonTintCurrent;
        shader.uniforms.uSeasonLeaf = tint;
        shader.fragmentShader =
            'uniform vec3 uSeasonLeaf;\n' +
            shader.fragmentShader.replace(
                '#include <color_fragment>',
                '#include <color_fragment>\n  diffuseColor.rgb *= uSeasonLeaf;\n',
            );
    };
    material.needsUpdate = true;
}

function normalize(scene: Obj3D, targetHeight: number): Group {
    const holder = new Group();
    holder.add(scene);
    let box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const s = size.y > 0 ? targetHeight / size.y : 1;
    scene.scale.multiplyScalar(s);
    box = new Box3().setFromObject(holder);
    const center = box.getCenter(new Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;
    return holder;
}

function bake(root: Group): VegetationAsset {
    root.updateMatrixWorld(true);
    const rootInv = new Matrix4().copy(root.matrixWorld).invert();
    const scratch = new Matrix4();
    const geos: BufferGeometry[] = [];
    let material: MeshStandardMaterial | null = null;

    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const mat = mats[0];
        if (!(mat instanceof MeshStandardMaterial)) return;
        if (!material) material = mat.clone();
        const geo = mesh.geometry.clone();
        scratch.multiplyMatrices(rootInv, mesh.matrixWorld);
        geo.applyMatrix4(scratch);
        geos.push(geo);
    });

    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    for (const g of geos) {
        if (g !== merged) g.dispose();
    }
    const matOut = material ?? new MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9 });
    if (!merged) {
        return {
            geometry: new BufferGeometry(),
            material: matOut,
            height: 1,
        };
    }
    merged.computeBoundingSphere();
    matOut.envMapIntensity = 1.05;
    if (typeof matOut.metalness === 'number') matOut.metalness = Math.min(matOut.metalness, 0.15);
    attachVegetationSnow(matOut, { strength: 0.88 });
    const box = new Box3().setFromObject(root);
    return { geometry: merged, material: matOut, height: box.max.y - box.min.y };
}

/** Crossed card: two planes at 90° so it reads from most RTS angles. */
function makeCrossCard(
    tex: Texture,
    height: number,
    snowTex: Texture | null,
): { geometry: BufferGeometry; material: MeshBasicMaterial } {
    const width = height * 1.05;
    const a = new PlaneGeometry(width, height);
    a.translate(0, height * 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const geometry = mergeGeometries([a, b], false) ?? a;
    a.dispose();
    // b is a clone with its own data; dispose if merge copied
    if (geometry !== a) b.dispose();

    tex.colorSpace = SRGBColorSpace;
    if (snowTex) snowTex.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({
        map: tex,
        color: new Color().setScalar(BILLBOARD_BRIGHTNESS),
        transparent: true,
        alphaTest: 0.28,
        side: DoubleSide,
        depthWrite: true,
    });
    attachVegetationSnow(material, { snowMap: snowTex, strength: 1 });
    attachBillboardSeasonFade(material);
    return { geometry, material };
}

/** Load HQ meshes (ultra). */
export async function loadSceneryVegetation(): Promise<void> {
    if (cache.size === Object.keys(SPECS).length) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const budget = modelTextureBudget();
        await Promise.all(
            (Object.keys(SPECS) as VegetationKind[]).map(async (id) => {
                if (cache.has(id)) return;
                const spec = SPECS[id]!;
                try {
                    const gltf = await loader.loadAsync(spec.url);
                    if (budget) applyTextureBudget(gltf.scene, budget);
                    const root = normalize(gltf.scene, spec.height);
                    const asset = bake(root);
                    if (id !== 'pine') attachSeasonTint(asset.material); // pines stay green
                    cache.set(id, asset);
                    console.info(`[sceneryVegetation] loaded '${id}'`);
                } catch (e) {
                    console.error(`[sceneryVegetation] '${id}' failed`, e);
                }
            }),
        );
    })();
    return loadPromise;
}

/** Load billboard cards (high + ultra far belt). */
export async function loadSceneryBillboards(): Promise<void> {
    if (billboardCache.size === Object.keys(SPECS).length) return;
    if (billboardPromise) return billboardPromise;
    billboardPromise = (async () => {
        await Promise.all(
            (Object.keys(SPECS) as VegetationKind[]).map(async (id) => {
                if (billboardCache.has(id)) return;
                const spec = SPECS[id]!;
                try {
                    const [tex, snowTex, springTex, autumnTex] = await Promise.all([
                        texLoader.loadAsync(spec.billboard),
                        texLoader.loadAsync(spec.billboardSnow).catch(() => null),
                        texLoader.loadAsync(spec.billboardSpring).catch(() => null),
                        texLoader.loadAsync(spec.billboardAutumn).catch(() => null),
                    ]);
                    for (const t of [tex, snowTex, springTex, autumnTex]) {
                        if (t) t.colorSpace = SRGBColorSpace;
                    }
                    const card = makeCrossCard(tex, spec.height, snowTex);
                    // Seasonal look comes from dedicated maps — skip multiply tint.
                    card.material.userData.seasonMaps = {
                        spring: springTex ?? tex,
                        summer: tex,
                        autumn: autumnTex ?? tex,
                        // keep autumn foliage into winter (snow mix layers on top)
                        winter: autumnTex ?? tex,
                    } satisfies BillboardSeasonMaps;
                    const maps = card.material.userData.seasonMaps as BillboardSeasonMaps;
                    const fromTex = maps[billboardFromSeason] ?? tex;
                    const toTex = maps[billboardToSeason] ?? tex;
                    card.material.map = fromTex;
                    const mapB = card.material.userData.seasonMapBUniform as { value: Texture } | undefined;
                    if (mapB) mapB.value = toTex;
                    billboardCache.set(id, card);
                    console.info(`[sceneryVegetation] billboard '${id}'`);
                } catch (e) {
                    console.error(`[sceneryVegetation] billboard '${id}' failed`, e);
                }
            }),
        );
    })();
    return billboardPromise;
}

export function getVegetationAsset(kind: VegetationKind): VegetationAsset | null {
    return cache.get(kind) ?? null;
}

/** Build an InstancedMesh for a vegetation kind (empty until matrices filled). */
export function createVegetationInstances(kind: VegetationKind, capacity: number): InstancedMesh | null {
    const asset = cache.get(kind);
    if (!asset || capacity < 1) return null;
    const mesh = new InstancedMesh(asset.geometry, asset.material, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
}

export function createBillboardInstances(kind: VegetationKind, capacity: number): InstancedMesh | null {
    const asset = billboardCache.get(kind);
    if (!asset || capacity < 1) return null;
    const mesh = new InstancedMesh(asset.geometry, asset.material, capacity);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.frustumCulled = true;
    return mesh;
}

/** Place one instance; returns false if pool is full. */
export function placeVegetationInstance(
    mesh: InstancedMesh,
    x: number,
    y: number,
    z: number,
    scale: number,
    yaw: number,
    dummy: Object3D = new Object3D(),
): boolean {
    if (mesh.count >= mesh.instanceMatrix.count) return false;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count++, dummy.matrix);
    return true;
}
