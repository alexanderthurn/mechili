import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Group,
    MathUtils,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Vector3,
    type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { Team } from './units';

/**
 * Units backed by a generated GLB model instead of procedural primitives.
 * `yaw` orients the model to the facing=0 convention (front toward -z, the
 * enemy edge); flip by Math.PI if a model ends up facing backwards.
 */
/**
 * Tripo models are exported facing +X. The game aims a unit's front along its
 * move/attack direction (built around a −Z rest forward), so baking +π/2 rotates
 * the model's +X onto that forward. Default yaw for every Tripo/P1 model.
 */
export const MODEL_FWD_YAW = Math.PI / 2;

export interface ModelSpec {
    url: string;
    yaw: number;
    pitch?: number;
    roll?: number;
    offset?: { x?: number; y?: number; z?: number };
    scale?: number;
}

export const MODEL_SPECS: Record<string, ModelSpec> = {
    // fantasy conversion (Melodan): P1 super-low-poly, static + procedural.
    // `scale` multiplies the auto-fitted size (default 1) for art tweaks.
    dwarf: { url: new URL('../../assets/models/dwarf.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 3 },
    archer: { url: new URL('../../assets/models/archer.glb', import.meta.url).href, yaw: MODEL_FWD_YAW },
    ballista: { url: new URL('../../assets/models/ballista-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW + MathUtils.degToRad(180) },
    crowRider: { url: new URL('../../assets/models/crow-rider-fantasy-low.glb', import.meta.url).href, yaw: MODEL_FWD_YAW + MathUtils.degToRad(100) },
    shield: { url: new URL('../../assets/models/shield-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 0.5 }, // ward stone
    rocket: { url: new URL('../../assets/models/rocket-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // fire bolt
    // the two base buildings — distinct castles instead of the shared procedural tower
    'command-tower': { url: new URL('../../assets/models/command-tower-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // stone watchtower
    stronghold: { url: new URL('../../assets/models/command-tower-keep.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // castle keep (Tripo v3.1, gltf-transform-optimized)
    'research-center': { url: new URL('../../assets/models/research-center-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 1.25 }, // wizard tower
};

type Template = Group;
const templates = new Map<string, Template>();
const loader = new GLTFLoader();

/** Shared geometry + material for InstancedMesh pools (one entry per material). */
export interface InstancePart {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
}

export interface InstanceAsset {
    parts: InstancePart[];
}

const instanceAssets = new Map<string, InstanceAsset>();

export function hasUnitModel(id: string): boolean {
    return templates.has(id);
}

export function hasUnitInstanceAsset(id: string): boolean {
    return instanceAssets.has(id);
}

export function getUnitInstanceAsset(id: string): InstanceAsset | null {
    return instanceAssets.get(id) ?? null;
}

/**
 * A fresh, untinted, normalized clone of the model — or null if none loaded.
 * Materials are unique per clone so level tinting can change them safely.
 * Sized to the unit's procedural LOCAL height, so the caller applying
 * `meshScale` yields the same world size the game already expects.
 * `@deprecated team` kept optional for call sites that still pass it.
 */
export function cloneUnitModel(id: string, _team?: Team): Group | null {
    const t = templates.get(id);
    if (!t) return null;
    const clone = skeletonClone(t) as Group;
    uniquifyMaterials(clone);
    return clone;
}

/** Clone materials so per-pack level tint does not leak across instances. */
function uniquifyMaterials(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => {
            const c = (m as MeshStandardMaterial).clone();
            return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    });
}

/** Prep a GLB scene: metalness caps, shadows — no team tint (level tint is live). */
function prepareClone(scene: Object3D): Object3D {
    const clone = skeletonClone(scene);
    clone.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const prepared = mats.map((m) => {
            const c = (m as MeshStandardMaterial).clone();
            if (typeof c.metalness === 'number') c.metalness = Math.min(c.metalness, 0.6);
            c.envMapIntensity = 1.1;
            return c;
        });
        mesh.material = Array.isArray(mesh.material) ? prepared : prepared[0]!;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
    });
    return clone;
}

/** Yaw, scale to `height`, center on x/z, and sit the base at y=0. */
function normalize(
    scene: Object3D,
    height: number,
    yaw: number,
    pitch?: number,
    roll?: number,
    offset?: { x?: number; y?: number; z?: number },
): Group {
    const holder = new Group();
    scene.rotation.y = yaw;
    if (pitch !== undefined) scene.rotation.x = pitch;
    if (roll !== undefined) scene.rotation.z = roll;
    holder.add(scene);
    let box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const s = size.y > 0 ? height / size.y : 1;
    scene.scale.multiplyScalar(s);
    box = new Box3().setFromObject(holder);
    const center = box.getCenter(new Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;

    if (offset) {
        if (offset.x !== undefined) scene.position.x += offset.x;
        if (offset.y !== undefined) scene.position.y += offset.y;
        if (offset.z !== undefined) scene.position.z += offset.z;
    }
    return holder;
}

/**
 * Bake meshes from a normalized template into root-local geometries, merged
 * per unique material — ready for InstancedMesh (instance matrix = proxy world).
 */
function bakeInstanceAsset(root: Group): InstanceAsset {
    root.updateMatrixWorld(true);
    const rootInv = new Matrix4().copy(root.matrixWorld).invert();
    const scratch = new Matrix4();
    const byMat = new Map<MeshStandardMaterial, BufferGeometry[]>();

    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        // multi-material meshes are rare on these assets; use the first slot
        const mat = mats[0];
        if (!(mat instanceof MeshStandardMaterial)) return;
        // Quantized GLBs (gltf-transform) store i16/u16 normalized attrs —
        // applyMatrix4 on those corrupts the mesh. Dequantize to float first.
        const geo = dequantizeGeometry(mesh.geometry);
        scratch.multiplyMatrices(rootInv, mesh.matrixWorld);
        geo.applyMatrix4(scratch);
        let list = byMat.get(mat);
        if (!list) {
            list = [];
            byMat.set(mat, list);
        }
        list.push(geo);
    });

    const parts: InstancePart[] = [];
    for (const [material, geos] of byMat) {
        const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
        for (const g of geos) {
            if (g !== merged) g.dispose();
        }
        if (!merged) continue;
        merged.computeBoundingSphere();
        parts.push({ geometry: merged, material });
    }
    if (parts.length === 0) {
        // empty fallback so pools can still be created without crashing
        parts.push({
            geometry: new BufferGeometry(),
            material: new MeshStandardMaterial({ color: 0x888888 }),
        });
    }
    return { parts };
}

const _dq = new Vector3();

/** Clone geometry with float32 (non-normalized) position/normal/uv for safe baking. */
function dequantizeGeometry(source: BufferGeometry): BufferGeometry {
    const geo = source.clone();
    for (const name of Object.keys(geo.attributes)) {
        const attr = geo.getAttribute(name);
        if (!attr) continue;
        if (attr.array instanceof Float32Array && !attr.normalized) continue;
        const itemSize = attr.itemSize;
        const count = attr.count;
        const out = new Float32Array(count * itemSize);
        if (itemSize === 3 || itemSize === 2) {
            for (let i = 0; i < count; i++) {
                if (itemSize === 3) {
                    _dq.fromBufferAttribute(attr, i);
                    out[i * 3] = _dq.x;
                    out[i * 3 + 1] = _dq.y;
                    out[i * 3 + 2] = _dq.z;
                } else {
                    out[i * 2] = attr.getX(i);
                    out[i * 2 + 1] = attr.getY(i);
                }
            }
        } else {
            for (let i = 0; i < count; i++) {
                for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attr.getComponent(i, k);
            }
        }
        geo.setAttribute(name, new BufferAttribute(out, itemSize));
    }
    return geo;
}

/**
 * Load every spec'd model and bake untinted, normalized templates.
 * Level tint is applied live per pack. `heights` gives each unit's procedural
 * local height. Failures fall back to the procedural mesh.
 */
export async function loadUnitModels(
    heights: Record<string, number>,
    onProgress?: (done: number, total: number) => void,
): Promise<void> {
    const entries = Object.entries(MODEL_SPECS);
    const total = entries.length;
    let done = 0;
    await Promise.all(
        entries.map(async ([id, spec]) => {
            try {
                const gltf = await loader.loadAsync(spec.url);
                const h = (heights[id] || 1) * (spec.scale ?? 1);
                const root = normalize(
                    prepareClone(gltf.scene),
                    h,
                    spec.yaw,
                    spec.pitch,
                    spec.roll,
                    spec.offset,
                );
                templates.set(id, root);
                instanceAssets.set(id, bakeInstanceAsset(root));
                console.info(`[unitModels] loaded '${id}' from ${spec.url} (height ${h.toFixed(2)})`);
            } catch (e) {
                console.error(`[unitModels] '${id}' FAILED to load from ${spec.url}; using procedural mesh`, e);
            } finally {
                done += 1;
                onProgress?.(done, total);
            }
        }),
    );
    console.info(`[unitModels] ready: ${[...templates.keys()].join(', ') || '(none)'}`);
}
