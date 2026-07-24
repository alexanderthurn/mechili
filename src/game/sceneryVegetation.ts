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

/** MeshBasic cards miss sun lift; multiply albedo so they match lit near trees. */
export const BILLBOARD_BRIGHTNESS = 1.55;

const SPECS: Record<
    VegetationKind,
    { url: string; /** target local height in world units */ height: number; billboard: string }
> = {
    oak: {
        url: new URL('../../assets/models/scenery/tree-oak.glb', import.meta.url).href,
        height: 10,
        billboard: new URL('../../assets/textures/scenery/billboard-oak.png', import.meta.url).href,
    },
    pine: {
        url: new URL('../../assets/models/scenery/tree-pine.glb', import.meta.url).href,
        height: 12,
        billboard: new URL('../../assets/textures/scenery/billboard-pine.png', import.meta.url).href,
    },
    bushRound: {
        url: new URL('../../assets/models/scenery/bush-round.glb', import.meta.url).href,
        height: 2.4,
        billboard: new URL('../../assets/textures/scenery/billboard-bush-round.png', import.meta.url)
            .href,
    },
    bushTall: {
        url: new URL('../../assets/models/scenery/bush-tall.glb', import.meta.url).href,
        height: 3.2,
        billboard: new URL('../../assets/textures/scenery/billboard-bush-tall.png', import.meta.url)
            .href,
    },
};

const loader = new GLTFLoader();
const texLoader = new TextureLoader();
const cache = new Map<VegetationKind, VegetationAsset>();
const billboardCache = new Map<VegetationKind, { geometry: BufferGeometry; material: MeshBasicMaterial }>();
let loadPromise: Promise<void> | null = null;
let billboardPromise: Promise<void> | null = null;

/** True when Tripo mid-poly trees replace the procedural forest (ultra only). */
export function sceneryHqVegetation(quality: SceneryQuality): boolean {
    return quality === 'ultra';
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
    const box = new Box3().setFromObject(root);
    return { geometry: merged, material: matOut, height: box.max.y - box.min.y };
}

/** Crossed card: two planes at 90° so it reads from most RTS angles. */
function makeCrossCard(tex: Texture, height: number): { geometry: BufferGeometry; material: MeshBasicMaterial } {
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
    const material = new MeshBasicMaterial({
        map: tex,
        color: new Color().setScalar(BILLBOARD_BRIGHTNESS),
        transparent: true,
        alphaTest: 0.28,
        side: DoubleSide,
        depthWrite: true,
    });
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
                    cache.set(id, bake(root));
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
                    const tex = await texLoader.loadAsync(spec.billboard);
                    billboardCache.set(id, makeCrossCard(tex, spec.height));
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
