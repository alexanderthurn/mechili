import {
    AnimationMixer,
    Box3,
    BufferAttribute,
    BufferGeometry,
    Group,
    MathUtils,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    SkinnedMesh,
    Vector3,
    type AnimationClip,
    type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { getGltfLoader } from '../engine/gltfLoader';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import { touchFirstDevice } from './inputCapabilities';
import {
    attachBuildingSnow,
    attachBuildingSnowToObject,
    BUILDING_SNOW_IDS,
} from './buildingSnow';
import { markCrowWingFlapMaterial, usesWingFlapModel } from './crowWingFlap';
import type { BattleTeam } from './units';

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
    /**
     * Extra non-uniform scale after height normalize (local axes). Used to
     * stretch bat / crow wings wider without growing body height.
     */
    stretch?: { x?: number; y?: number; z?: number };
    /** Rigged GLB — keep SkinnedMesh; battle anim is {@link unitAnimated}. */
    skinned?: boolean;
    /**
     * Pose a skinned clip then bake to static meshes for InstancedMesh.
     * `clip`: substring of clip name, or `first` / `longest` / `shortest`.
     * Default time `0` = first frame.
     */
    bakePose?: {
        clip?: string | 'first' | 'longest' | 'shortest';
        time?: number;
    };
}

export const MODEL_SPECS: Record<string, ModelSpec> = {
    // fantasy conversion (Melodan): P1 super-low-poly, static + procedural.
    // `scale` multiplies the auto-fitted size (default 1) for art tweaks.
    dwarf: {
        url: new URL('../../assets/models/dwarf.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW+ MathUtils.degToRad(90),
        scale: 3,
        // soles sit a hair above the bbox floor — nudge feet into the lawn
        offset: { y: -0.04 },
    },
    horde: {
        url: new URL('../../assets/models/horde.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW,
        scale: 3,
        offset: { y: -0.04 },
    },
    horde2: {
        url: new URL('../../assets/models/horde2.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW,
        scale: 3,
        offset: { y: -0.04 },
    },
    horde3: {
        url: new URL('../../assets/models/horde3.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW,
        scale: 3,
        offset: { y: -0.04 },
    },
    // Static bind-pose template for icons / fallback. Battle uses mixer via unitAnimated.
    archer: {
        url: new URL('../../assets/models/archera.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        skinned: true,
    },
    hammerer: {
        url: new URL('../../assets/models/hammerer.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        skinned: true,
    },
    ogre: {
        url: new URL('../../assets/models/ogre.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        skinned: true,
    },
    wizard: { url: new URL('../../assets/models/wizard.glb', import.meta.url).href, yaw: MODEL_FWD_YAW },
    ballista: { url: new URL('../../assets/models/ballista.glb', import.meta.url).href, yaw: MODEL_FWD_YAW + MathUtils.degToRad(180) },
    // Mortar — tube siege; static Tripo mesh (cannon toward facing)
    mortar: {
        url: new URL('../../assets/models/mortar.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(180),
    },
    crowRider: { url: new URL('../../assets/models/crow-rider.glb', import.meta.url).href, yaw: MODEL_FWD_YAW  },
    // Air chaff (Wasp-like) — wing flap + stretched span for flock silhouette
    bat: {
        url: new URL('../../assets/models/bat.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW,
        stretch: { x: 1.45, z: 1.1 },
    },
    goblin: {
        url: new URL('../../assets/models/goblin.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        scale: 2.85,
        offset: { y: -0.04 },
        // skinned walk clip → bake frame 0 into InstancedMesh (no runtime mixer)
        bakePose: { clip: 'walk', time: 0 },
    },
    shield: { url: new URL('../../assets/models/shield.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 0.5 }, // ward stone
    rocket: { url: new URL('../../assets/models/rocket.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // fire bolt
    // the two base buildings — distinct castles instead of the shared procedural tower
    'command-tower': { url: new URL('../../assets/models/command-tower.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // stone watchtower
    stronghold: { url: new URL('../../assets/models/stronghold.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // castle keep + Flag empty for the mast
    'research-center': { url: new URL('../../assets/models/research-center.glb', import.meta.url).href, yaw: MODEL_FWD_YAW-70, scale: 1.0 }, // wizard tower
};

type Template = Group;
const templates = new Map<string, Template>();
const loader = getGltfLoader();

/** Shared geometry + material for InstancedMesh pools (one entry per material). */
export interface InstancePart {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
}

export interface InstanceAsset {
    parts: InstancePart[];
}

const instanceAssets = new Map<string, InstanceAsset>();
/**
 * Local (pre-meshScale) visual height per model id — feet near y=0, top ≈ this.
 * Procedural probe first; overwritten with the measured GLB bbox after normalize.
 */
const visualHeights = new Map<string, number>();
/** widest horizontal half-extent per model id (local space, before meshScale) */
const visualHalfWidths = new Map<string, number>();

/**
 * Optional muzzle / ray origins from GLB empties named `AttackNode`, in
 * normalized model space (feet at y=0, rest forward −Z, before meshScale).
 */
const attackNodes = new Map<string, { x: number; y: number; z: number }>();
/**
 * Optional flag-mast sockets from GLB empties named `Flag` (same space as
 * AttackNode). Used by StrongholdFlags.
 */
const flagNodes = new Map<string, { x: number; y: number; z: number }>();
/**
 * `Unit1`, `Unit2`, … empties: standing spots authored into a building (the
 * Stronghold's battlements carry five). Stronghold archers stand and SHOOT from
 * these, so the sim reads them and they ride in {@link
 * modelGeometryFingerprint} — a peer whose stronghold GLB failed would
 * otherwise stand somewhere else and fight a different battle.
 */
const slotNodes = new Map<string, { x: number; y: number; z: number }[]>();

/** Local mesh height for badges / arrows (× meshScale → world). Falls back to 1. */
export function getUnitVisualHeight(id: string): number {
    return visualHeights.get(id) ?? 1;
}

/**
 * Local mesh half-width on the widest horizontal axis (× meshScale → world).
 * Used to size HP bars to the model — a crow rider's wingspan is far wider
 * than its collision circle. 0 = unknown (caller falls back).
 */
export function getUnitVisualHalfWidth(id: string): number {
    return visualHalfWidths.get(id) ?? 0;
}

/** Rest-local AttackNode offset, or null if the GLB has none. */
export function getUnitAttackNodeLocal(id: string): { x: number; y: number; z: number } | null {
    return attackNodes.get(id) ?? null;
}

/** Rest-local Flag empty offset, or null if the GLB has none. */
export function getUnitFlagNodeLocal(id: string): { x: number; y: number; z: number } | null {
    return flagNodes.get(id) ?? null;
}

/** One authored standing spot, 1-based to match the `Unit1`… node names. */
export function getUnitSlotLocal(
    id: string,
    slot: number,
): { x: number; y: number; z: number } | null {
    return slotNodes.get(id)?.[slot - 1] ?? null;
}


/**
 * Fingerprint of the model-derived geometry the SIM reads — {@link
 * getUnitVisualHeight} feeds `projectileAimY`, {@link getUnitAttackNodeLocal}
 * feeds the muzzle in `fire()`, and both plus {@link getUnitVisualHalfWidth}
 * size the archer scatter in `aimSpread` — so they decide where projectiles
 * spawn and fly, i.e. what they hit.
 *
 * Everything the sim reads out of a model belongs in here. Adding a sim read
 * of model data without adding it below re-opens the hole this closes.
 *
 * Model loading is fault-tolerant per model: a failed GLB logs and keeps the
 * procedural probe height with no AttackNode. That is fine for looks and fatal
 * for lockstep — one peer would compute different muzzles from the same action
 * log and desync silently, surfacing a round later as a position mismatch. A
 * deterministic fallback can't fix that on its own (the failure is asymmetric:
 * the healthy peer never takes the fallback), so the values ride in the
 * battle-start state hash instead. A mismatch is then caught on the first
 * check, and the guest's resync reload re-fetches the model it missed.
 */
export function modelGeometryFingerprint(): number {
    let h = 0x811c9dc5;
    const buffer = new DataView(new ArrayBuffer(8));
    const mix = (v: number) => {
        buffer.setFloat64(0, v);
        h = Math.imul(h ^ buffer.getUint32(0), 0x9e3779b1);
        h = Math.imul(h ^ buffer.getUint32(4), 0x9e3779b1);
    };
    const mixStr = (s: string) => {
        for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    };
    // sorted so map insertion order (load completion order) can't shift the hash
    for (const id of [...visualHeights.keys()].sort()) {
        mixStr(id);
        mix(visualHeights.get(id)!);
    }
    for (const id of [...visualHalfWidths.keys()].sort()) {
        mixStr(id);
        mix(visualHalfWidths.get(id)!);
    }
    for (const id of [...slotNodes.keys()].sort()) {
        const slots = slotNodes.get(id)!;
        mixStr(id);
        mix(slots.length);
        for (const s of slots) {
            mix(s.x);
            mix(s.y);
            mix(s.z);
        }
    }
    for (const id of [...attackNodes.keys()].sort()) {
        const n = attackNodes.get(id)!;
        mixStr(id);
        mix(n.x);
        mix(n.y);
        mix(n.z);
    }
    return h >>> 0;
}

/**
 * Transform a rest-local AttackNode into world space.
 * `yaw` is {@link Object3D.rotation.y} (rest forward −Z → yaw 0).
 */
export function attackNodeWorld(
    local: { x: number; y: number; z: number },
    originX: number,
    footY: number,
    originZ: number,
    yaw: number,
    meshScale: number,
): { x: number; y: number; z: number } {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const lx = local.x * meshScale;
    const ly = local.y * meshScale;
    const lz = local.z * meshScale;
    return {
        x: originX + lx * c + lz * s,
        y: footY + ly,
        z: originZ - lx * s + lz * c,
    };
}

/** Record a provisional or measured local height (GLB load overwrites with bbox). */
export function seedUnitVisualHeight(id: string, height: number): void {
    visualHeights.set(id, Math.max(height, 0.05));
}

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
export function cloneUnitModel(id: string, _team?: BattleTeam): Group | null {
    const t = templates.get(id);
    if (!t) return null;
    const clone = skeletonClone(t) as Group;
    uniquifyMaterials(clone);
    // Three.js Material.clone() drops onBeforeCompile — re-attach after uniquify
    if (BUILDING_SNOW_IDS.has(id)) attachBuildingSnowToObject(clone);
    return clone;
}

/** Clone materials so per-pack level tint does not leak across instances. */
function uniquifyMaterials(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => {
            const src = m as MeshStandardMaterial;
            const c = src.clone();
            // clone() resets onBeforeCompile; keep building snow if the template had it
            if (src.userData.wantsBuildingSnow) attachBuildingSnow(c);
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

/** Yaw, scale to `height`, optional wing stretch, center on x/z, sit base at y=0. */
function normalize(
    scene: Object3D,
    height: number,
    yaw: number,
    pitch?: number,
    roll?: number,
    offset?: { x?: number; y?: number; z?: number },
    stretch?: { x?: number; y?: number; z?: number },
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
    if (stretch) {
        if (stretch.x !== undefined) scene.scale.x *= stretch.x;
        if (stretch.y !== undefined) scene.scale.y *= stretch.y;
        if (stretch.z !== undefined) scene.scale.z *= stretch.z;
    }
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
        if ((mesh as SkinnedMesh).isSkinnedMesh) return; // must be posed+baked first
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

function pickBakeClip(
    clips: AnimationClip[],
    pick: NonNullable<ModelSpec['bakePose']>['clip'],
): AnimationClip | null {
    if (clips.length === 0) return null;
    if (pick === undefined || pick === 'first') return clips[0]!;
    if (pick === 'longest') {
        return clips.reduce((a, b) => (b.duration > a.duration ? b : a));
    }
    if (pick === 'shortest') {
        return clips.reduce((a, b) => (b.duration < a.duration ? b : a));
    }
    const lower = pick.toLowerCase();
    return clips.find((c) => c.name.toLowerCase().includes(lower)) ?? clips[0]!;
}

const _skinV = new Vector3();
const _skinAcc = new Vector3();
const _skinTmp = new Vector3();
const _skinN = new Vector3();
const _skinNAcc = new Vector3();
const _skinNTmp = new Vector3();
const _skinBone = new Matrix4();
const _skinBind = new Matrix4();
const _skinBindInv = new Matrix4();

/**
 * Evaluate `clip` at `time` on `root`, then replace every SkinnedMesh with a
 * static Mesh whose vertices match that pose (for InstancedMesh baking).
 */
function bakeSkinnedPose(root: Group, clips: AnimationClip[], pose: NonNullable<ModelSpec['bakePose']>): void {
    const clip = pickBakeClip(clips, pose.clip);
    if (!clip) {
        console.warn('[unitModels] bakePose: no animation clips — leaving bind pose');
        return;
    }
    const time = Math.max(0, Math.min(pose.time ?? 0, Math.max(clip.duration - 1e-4, 0)));
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    action.time = time;
    mixer.update(0);
    root.updateMatrixWorld(true);

    const skinned: SkinnedMesh[] = [];
    root.traverse((o) => {
        const m = o as SkinnedMesh;
        if (m.isSkinnedMesh) skinned.push(m);
    });

    for (const sm of skinned) {
        sm.skeleton.update();
        const geo = dequantizeGeometry(sm.geometry);
        const pos = geo.getAttribute('position');
        const skinIndex = geo.getAttribute('skinIndex');
        const skinWeight = geo.getAttribute('skinWeight');
        if (!pos || !skinIndex || !skinWeight) {
            console.warn(`[unitModels] bakePose: '${sm.name || '?'}' missing skin attrs`);
            continue;
        }
        _skinBind.copy(sm.bindMatrix);
        _skinBindInv.copy(sm.bindMatrixInverse);
        const boneMatrices = sm.skeleton.boneMatrices;
        if (!boneMatrices) {
            console.warn(`[unitModels] bakePose: '${sm.name || '?'}' has no boneMatrices`);
            continue;
        }
        // Normals are skinned with the same bone blend as positions (upper
        // 3x3 via transformDirection), so the model keeps its authored
        // smoothing. computeVertexNormals() would re-derive them from the
        // posed triangles and flatten every seam the GLB had softened.
        const nrm = geo.getAttribute('normal');
        const out = new Float32Array(pos.count * 3);
        const outN = nrm ? new Float32Array(nrm.count * 3) : null;
        for (let i = 0; i < pos.count; i++) {
            _skinV.fromBufferAttribute(pos, i).applyMatrix4(_skinBind);
            _skinAcc.set(0, 0, 0);
            if (nrm) _skinN.fromBufferAttribute(nrm, i).transformDirection(_skinBind);
            _skinNAcc.set(0, 0, 0);
            for (let j = 0; j < 4; j++) {
                const w = skinWeight.getComponent(i, j);
                if (w === 0) continue;
                const idx = skinIndex.getComponent(i, j);
                _skinBone.fromArray(boneMatrices, idx * 16);
                _skinTmp.copy(_skinV).applyMatrix4(_skinBone).multiplyScalar(w);
                _skinAcc.add(_skinTmp);
                if (nrm) {
                    _skinNTmp.copy(_skinN).transformDirection(_skinBone).multiplyScalar(w);
                    _skinNAcc.add(_skinNTmp);
                }
            }
            _skinAcc.applyMatrix4(_skinBindInv);
            out[i * 3] = _skinAcc.x;
            out[i * 3 + 1] = _skinAcc.y;
            out[i * 3 + 2] = _skinAcc.z;
            if (outN) {
                _skinNAcc.transformDirection(_skinBindInv);
                outN[i * 3] = _skinNAcc.x;
                outN[i * 3 + 1] = _skinNAcc.y;
                outN[i * 3 + 2] = _skinNAcc.z;
            }
        }
        geo.setAttribute('position', new BufferAttribute(out, 3));
        geo.deleteAttribute('skinIndex');
        geo.deleteAttribute('skinWeight');
        if (outN) geo.setAttribute('normal', new BufferAttribute(outN, 3));
        else geo.computeVertexNormals();
        geo.computeBoundingSphere();

        const mats = sm.material;
        const staticMesh = new Mesh(geo, mats);
        staticMesh.name = sm.name;
        staticMesh.castShadow = sm.castShadow;
        staticMesh.receiveShadow = sm.receiveShadow;
        staticMesh.position.copy(sm.position);
        staticMesh.quaternion.copy(sm.quaternion);
        staticMesh.scale.copy(sm.scale);
        staticMesh.matrixAutoUpdate = sm.matrixAutoUpdate;
        if (sm.parent) {
            sm.parent.add(staticMesh);
            sm.parent.remove(sm);
        }
        // don't dispose sm.geometry — GLTF clones often share buffers
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);

    // re-sit feet after pose (walk frame can lift the bbox)
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    if (Number.isFinite(box.min.y) && Math.abs(box.min.y) > 1e-4) {
        root.position.y -= box.min.y;
        root.updateMatrixWorld(true);
    }
    console.info(`[unitModels] bakePose '${clip.name}' @ t=${time.toFixed(3)} → ${skinned.length} mesh(es)`);
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
 * Models that failed to load, and how to try them again.
 *
 * A failed GLB is not just a looks problem: its measured height, half-width
 * and AttackNode feed the sim and ride in {@link modelGeometryFingerprint}, so
 * the peer missing one disagrees with everyone at every battle-start barrier.
 * The host resyncs it — and a resync rebuilds the Game in the same page, where
 * the memoized preload never reloads anything, so it disagreed again, every
 * round, for the whole session. Failures now retry: in the background with a
 * backoff, and again whenever a star guest is resynced. The moment a retry
 * lands, the fingerprint matches and the loop ends.
 */
const failedModels = new Set<string>();
let lastHeights: Record<string, number> | null = null;
let retryInFlight: Promise<void> | null = null;
let retryAttempt = 0;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

/** Re-load every model that has failed so far. Joins an in-flight retry. */
export function retryFailedUnitModels(): Promise<void> {
    if (retryInFlight) return retryInFlight;
    if (failedModels.size === 0 || !lastHeights) return Promise.resolve();
    const ids = new Set(failedModels);
    console.warn(`[unitModels] retrying ${[...ids].join(', ')}`);
    retryInFlight = loadUnitModels(lastHeights, undefined, ids).finally(() => {
        retryInFlight = null;
    });
    return retryInFlight;
}

function scheduleModelRetry(): void {
    if (failedModels.size === 0 || retryAttempt >= RETRY_DELAYS_MS.length) return;
    const delay = RETRY_DELAYS_MS[retryAttempt++]!;
    setTimeout(() => void retryFailedUnitModels().then(scheduleModelRetry), delay);
}

/**
 * Load every spec'd model and bake untinted, normalized templates.
 * Level tint is applied live per pack. `heights` gives each unit's procedural
 * local height. Failures fall back to the procedural mesh.
 */
/**
 * Models that failed to load, and how to try them again.
 *
 * A failed GLB is not just a looks problem: its measured height, half-width
 * and AttackNode feed the sim and ride in {@link modelGeometryFingerprint}, so
 * the peer missing one disagrees with everyone at every battle-start barrier.
 * The host resyncs it — and a resync rebuilds the Game in the same page, where
 * the memoized preload never reloads anything, so it disagreed again, every
 * round, for the whole session. Failures now retry: in the background with a
 * backoff, and again whenever a star guest is resynced. The moment a retry
 * lands, the fingerprint matches and the loop ends.
 */
const failedModels = new Set<string>();
let lastHeights: Record<string, number> | null = null;
let retryInFlight: Promise<void> | null = null;
let retryAttempt = 0;
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

/** Re-load every model that has failed so far. Joins an in-flight retry. */
export function retryFailedUnitModels(): Promise<void> {
    if (retryInFlight) return retryInFlight;
    if (failedModels.size === 0 || !lastHeights) return Promise.resolve();
    const ids = new Set(failedModels);
    console.warn(`[unitModels] retrying ${[...ids].join(', ')}`);
    retryInFlight = loadUnitModels(lastHeights, undefined, ids).finally(() => {
        retryInFlight = null;
    });
    return retryInFlight;
}

function scheduleModelRetry(): void {
    if (failedModels.size === 0 || retryAttempt >= RETRY_DELAYS_MS.length) return;
    const delay = RETRY_DELAYS_MS[retryAttempt++]!;
    setTimeout(() => void retryFailedUnitModels().then(scheduleModelRetry), delay);
}

export async function loadUnitModels(
    heights: Record<string, number>,
    onProgress?: (done: number, total: number) => void,
    /** retry pass: load only these ids (default: every spec) */
    only?: ReadonlySet<string>,
): Promise<void> {
    lastHeights = heights;
    const entries = Object.entries(MODEL_SPECS).filter(([id]) => !only || only.has(id));
    const total = entries.length;
    const textureBudget = modelTextureBudget();
    let done = 0;
    const loadEntry = async ([id, spec]: (typeof entries)[number]): Promise<void> => {
        try {
            const gltf = await loader.loadAsync(spec.url);
            // shrink BEFORE cloning: clones share texture instances
            if (textureBudget) applyTextureBudget(gltf.scene, textureBudget);
            const h = (heights[id] || 1) * (spec.scale ?? 1);
            const root = normalize(
                prepareClone(gltf.scene),
                h,
                spec.yaw,
                spec.pitch,
                spec.roll,
                spec.offset,
                spec.stretch,
            );
            if (spec.bakePose && !spec.skinned) {
                bakeSkinnedPose(root, gltf.animations ?? [], spec.bakePose);
            }
            // measure after normalize+offset — real top relative to member origin
            const box = new Box3().setFromObject(root);
            visualHeights.set(id, Math.max(box.max.y, 0.05));
            // widest horizontal half-extent (x or z) — wings, siege frames, etc.
            visualHalfWidths.set(
                id,
                Math.max(
                    Math.abs(box.max.x),
                    Math.abs(box.min.x),
                    Math.abs(box.max.z),
                    Math.abs(box.min.z),
                    0.05,
                ),
            );
            root.updateMatrixWorld(true);
            const attack = root.getObjectByName('AttackNode');
            if (attack) {
                const p = new Vector3();
                attack.getWorldPosition(p);
                attackNodes.set(id, { x: p.x, y: p.y, z: p.z });
                console.info(
                    `[unitModels] AttackNode '${id}' @ (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
                );
            }
            // Unit1, Unit2, … — consecutive from 1, stop at the first gap
            const slots: { x: number; y: number; z: number }[] = [];
            for (let n = 1; ; n++) {
                const node = root.getObjectByName(`Unit${n}`);
                if (!node) break;
                const p = new Vector3();
                node.getWorldPosition(p);
                slots.push({ x: p.x, y: p.y, z: p.z });
            }
            if (slots.length > 0) {
                slotNodes.set(id, slots);
                console.info(`[unitModels] ${slots.length} unit slots on '${id}'`);
            }
            const flag = root.getObjectByName('Flag');
            if (flag) {
                const p = new Vector3();
                flag.getWorldPosition(p);
                flagNodes.set(id, { x: p.x, y: p.y, z: p.z });
                console.info(
                    `[unitModels] Flag '${id}' @ (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
                );
            }
            templates.set(id, root);
            // Rigged units stay on SkinnedMesh + mixer — baking would freeze bind pose.
            // bakePose models are static after bakeSkinnedPose and use InstancedMesh.
            if (!spec.skinned) {
                const baked = bakeInstanceAsset(root);
                if (BUILDING_SNOW_IDS.has(id)) {
                    attachBuildingSnowToObject(root);
                    for (const part of baked.parts) attachBuildingSnow(part.material);
                }
                if (usesWingFlapModel(id)) {
                    for (const part of baked.parts) markCrowWingFlapMaterial(part.material);
                }
                instanceAssets.set(id, baked);
            } else if (BUILDING_SNOW_IDS.has(id)) {
                attachBuildingSnowToObject(root);
            }
            console.info(
                `[unitModels] loaded '${id}' from ${spec.url} (height ${visualHeights.get(id)!.toFixed(2)}` +
                    (spec.skinned ? ', skinned — no InstancedMesh' : spec.bakePose ? ', bakePose → InstancedMesh' : '') +
                    ')',
            );
            failedModels.delete(id);
        } catch (e) {
            failedModels.add(id);
            console.error(`[unitModels] '${id}' FAILED to load from ${spec.url}; using procedural mesh`, e);
        } finally {
            done += 1;
            onProgress?.(done, total);
        }
    };
    if (touchFirstDevice()) {
        // small devices decode one model at a time — 15 parallel 2K–4K
        // texture decodes is exactly the boot spike that kills mobile tabs
        for (const entry of entries) await loadEntry(entry);
    } else {
        await Promise.all(entries.map(loadEntry));
    }
    console.info(`[unitModels] ready: ${[...templates.keys()].join(', ') || '(none)'}`);
    if (!only) scheduleModelRetry();
}
