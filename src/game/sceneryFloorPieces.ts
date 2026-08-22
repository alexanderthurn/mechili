/**
 * Ground clutter from floorpieces.glb — instanced scatter on the playable
 * board (high / ultra).
 */

import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Vector3,
} from 'three';
import { getGltfLoader } from '../engine/gltfLoader';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import { attachVegetationSnow } from './sceneryVegetation';
import type { SceneryQuality } from './prefs';
import { prefs } from './prefs';

const FLOOR_PIECES_URL = new URL('../../assets/models/floorpieces.glb', import.meta.url).href;

/** Authored palette pieces that read as props, not Easter eggs. */
const EXCLUDED = new Set(['coin', 'nail', 'rank1']);

export type FloorPieceId = string;

export interface FloorPieceAsset {
    geometry: BufferGeometry;
    /** max(x, z) footprint after normalize — placement jitter scale */
    footprint: number;
}

export interface FloorPiecePlacement {
    id: FloorPieceId;
    x: number;
    y: number;
    z: number;
    scale: number;
    yaw: number;
    tiltX: number;
    tiltZ: number;
}

const loader = getGltfLoader();
const assets = new Map<FloorPieceId, FloorPieceAsset>();
let sharedMaterial: MeshStandardMaterial | null = null;
let loadPromise: Promise<void> | null = null;
let pickIds: FloorPieceId[] = [];
let pickWeights: number[] = [];
let pickTotal = 0;

const _dq = new Vector3();
const scratch = new Matrix4();

function dequantizeGeometry(source: BufferGeometry): BufferGeometry {
    const geo = source.clone();
    for (const name of Object.keys(geo.attributes)) {
        const attr = geo.getAttribute(name);
        if (!attr) continue;
        if (attr.array instanceof Float32Array && !attr.normalized) continue;
        const itemSize = attr.itemSize;
        const count = attr.count;
        const out = new Float32Array(count * itemSize);
        for (let i = 0; i < count; i++) {
            if (itemSize === 3) {
                _dq.fromBufferAttribute(attr, i);
                out[i * 3] = _dq.x;
                out[i * 3 + 1] = _dq.y;
                out[i * 3 + 2] = _dq.z;
            } else if (itemSize === 2) {
                out[i * 2] = attr.getX(i);
                out[i * 2 + 1] = attr.getY(i);
            } else {
                for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attr.getComponent(i, k);
            }
        }
        geo.setAttribute(name, new BufferAttribute(out, itemSize));
    }
    return geo;
}

function pieceWeight(id: FloorPieceId): number {
    if (EXCLUDED.has(id)) return 0;
    if (id.startsWith('leaf')) return 4;
    if (id.startsWith('stone')) return 2.6;
    if (id.startsWith('mushroom')) return 2.2;
    if (id.startsWith('stick') || id.startsWith('wood')) return 1.6;
    if (id.startsWith('nut') || id.startsWith('berry')) return 2;
    if (id.startsWith('beetle')) return 0.35;
    return 1;
}

/** Target max dimension in world units before per-instance scale jitter. */
function pieceBaseScale(id: FloorPieceId): number {
    if (id.startsWith('leaf')) return 0.38;
    if (id.startsWith('stone')) return 0.52;
    if (id.startsWith('mushroom')) return 0.48;
    if (id.startsWith('stick') || id.startsWith('wood')) return 0.58;
    if (id.startsWith('nut') || id.startsWith('berry')) return 0.3;
    if (id.startsWith('beetle')) return 0.26;
    return 0.42;
}

function rebuildPickTable(): void {
    pickIds = [];
    pickWeights = [];
    pickTotal = 0;
    for (const [id] of assets) {
        const w = pieceWeight(id);
        if (w <= 0) continue;
        pickIds.push(id);
        pickWeights.push(w);
        pickTotal += w;
    }
}

function bakePiece(mesh: Mesh, paletteInv: Matrix4): FloorPieceAsset | null {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mat = mats[0];
    if (mat instanceof MeshStandardMaterial && !sharedMaterial) {
        sharedMaterial = mat.clone();
        sharedMaterial.envMapIntensity = 0.42;
        if (typeof sharedMaterial.roughness === 'number') {
            sharedMaterial.roughness = Math.min(1, Math.max(0.78, sharedMaterial.roughness));
        } else {
            sharedMaterial.roughness = 0.86;
        }
        if (typeof sharedMaterial.metalness === 'number') {
            sharedMaterial.metalness = Math.min(sharedMaterial.metalness, 0.08);
        }
        attachVegetationSnow(sharedMaterial, { strength: 0.55 });
    }

    const geo = dequantizeGeometry(mesh.geometry);
    scratch.multiplyMatrices(paletteInv, mesh.matrixWorld);
    geo.applyMatrix4(scratch);
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return null;

    geo.translate(-(box.min.x + box.max.x) * 0.5, -box.min.y, -(box.min.z + box.max.z) * 0.5);
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const norm = 1 / maxDim;
    geo.scale(norm, norm, norm);
    geo.computeBoundingBox();
    geo.computeVertexNormals();

    const box2 = geo.boundingBox!;
    const footprint = Math.max(box2.max.x - box2.min.x, box2.max.z - box2.min.z) * 0.5;
    return { geometry: geo, footprint };
}

/** High / ultra get the GLB scatter on the board; medium and below keep procedural meadow clutter. */
export function floorPiecesEnabled(quality: SceneryQuality = prefs().scenery): boolean {
    return quality === 'high' || quality === 'ultra';
}

export async function loadFloorPieces(): Promise<void> {
    if (assets.size > 0) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            const gltf = await loader.loadAsync(FLOOR_PIECES_URL);
            const budget = modelTextureBudget();
            if (budget) applyTextureBudget(gltf.scene, budget);

            gltf.scene.updateMatrixWorld(true);
            const paletteInv = new Matrix4().copy(gltf.scene.matrixWorld).invert();
            let loaded = 0;

            gltf.scene.traverse((o) => {
                const mesh = o as Mesh;
                if (!mesh.isMesh || !mesh.geometry || !o.name || o.name === 'ParentNode') return;
                if (EXCLUDED.has(o.name) || assets.has(o.name)) return;
                const asset = bakePiece(mesh, paletteInv);
                if (!asset) return;
                assets.set(o.name, asset);
                loaded++;
            });

            if (!sharedMaterial) {
                sharedMaterial = new MeshStandardMaterial({
                    color: 0xd8d0c4,
                    roughness: 0.88,
                    metalness: 0.04,
                });
                attachVegetationSnow(sharedMaterial, { strength: 0.55 });
            }

            rebuildPickTable();
            console.info(`[sceneryFloorPieces] loaded ${loaded} pieces`);
        } catch (e) {
            console.error('[sceneryFloorPieces] load failed', e);
        }
    })();
    return loadPromise;
}

export function pickFloorPiece(rng: () => number): FloorPieceId | null {
    if (pickTotal <= 0 || pickIds.length === 0) return null;
    let roll = rng() * pickTotal;
    for (let i = 0; i < pickIds.length; i++) {
        roll -= pickWeights[i]!;
        if (roll <= 0) return pickIds[i]!;
    }
    return pickIds[pickIds.length - 1] ?? null;
}

export function floorPieceScale(id: FloorPieceId, rng: () => number): number {
    return pieceBaseScale(id) * (0.72 + rng() * 0.56);
}

export function createFloorPieceInstances(id: FloorPieceId, capacity: number): InstancedMesh | null {
    const asset = assets.get(id);
    if (!asset || !sharedMaterial || capacity < 1) return null;
    const mesh = new InstancedMesh(asset.geometry, sharedMaterial, capacity);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
}

export function placeFloorPieceInstance(
    mesh: InstancedMesh,
    x: number,
    y: number,
    z: number,
    scale: number,
    yaw: number,
    tiltX: number,
    tiltZ: number,
    dummy: Object3D = new Object3D(),
): boolean {
    if (mesh.count >= mesh.instanceMatrix.count) return false;
    dummy.position.set(x, y, z);
    dummy.rotation.set(tiltX, yaw, tiltZ);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count++, dummy.matrix);
    return true;
}

/** Build instanced meshes from precomputed placements (grouped by piece id). */
export function buildFloorPieceMeshes(placements: FloorPiecePlacement[]): InstancedMesh[] {
    const byId = new Map<FloorPieceId, FloorPiecePlacement[]>();
    for (const p of placements) {
        const list = byId.get(p.id) ?? [];
        list.push(p);
        byId.set(p.id, list);
    }

    const meshes: InstancedMesh[] = [];
    const dummy = new Object3D();
    for (const [id, list] of byId) {
        const mesh = createFloorPieceInstances(id, list.length);
        if (!mesh) continue;
        for (const p of list) {
            placeFloorPieceInstance(mesh, p.x, p.y, p.z, p.scale, p.yaw, p.tiltX, p.tiltZ, dummy);
        }
        mesh.instanceMatrix.needsUpdate = true;
        meshes.push(mesh);
    }
    return meshes;
}
