import {
    AnimationMixer,
    Box3,
    Bone,
    Group,
    LoopOnce,
    LoopRepeat,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    SkinnedMesh,
    Vector3,
    type AnimationAction,
    type AnimationClip,
    type Object3D,
} from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { getGltfLoader } from '../engine/gltfLoader';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import type { BattleTeam } from './units';

/** Same rest-forward bake as Tripo models in unitModels ( +X → −Z ). */
const MODEL_FWD_YAW = Math.PI / 2;

/**
 * Pick a clip when the exporter names them uselessly (NlaTrack / NlaTrack.001).
 * `longest` / `shortest` by duration; or a substring of the clip name; or index.
 */
export type ClipPick = 'longest' | 'shortest' | number | string;

/** Units driven by a rigged GLB (walk/swagger + optional fire) instead of InstancedMesh. */
export interface AnimSpec {
    url: string;
    /** Orient model to facing=0 (−Z). Same convention as {@link MODEL_SPECS}. */
    yaw: number;
    pitch?: number;
    roll?: number;
    offset?: { x?: number; y?: number; z?: number };
    scale?: number;
    /** Locomotion loop (swagger / walk). */
    walk: ClipPick;
    /** Playback rate for the walk clip (default 1). Higher = less slide/surf. */
    walkSpeed?: number;
    /** One-shot attack; omit if the asset has none. */
    fire?: ClipPick;
}

/**
 * Melodan rigged units. Clip picks tolerate Tripo/Cascadeur-style `NlaTrack` names.
 * Walk = longer swagger loop; fire = shorter shoot (see archera.glb).
 */
export const ANIM_SPECS: Record<string, AnimSpec> = {
    archer: {
        url: new URL('../../assets/models/archera.glb', import.meta.url).href,
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        walk: 'longest',
        walkSpeed: 1.5assa,
        fire: 'shortest',
    },
};

export function isAnimatedUnitId(id: string): boolean {
    return id in ANIM_SPECS;
}

interface Template {
    root: Object3D;
    walk: AnimationClip;
    fire: AnimationClip | null;
    walkSpeed: number;
}

const templates = new Map<string, Template>();
const loader = getGltfLoader();

interface Instance {
    mixer: AnimationMixer;
    walk: AnimationAction;
    fire: AnimationAction | null;
    /** Animated root (child of the unit proxy Group). */
    root: Object3D;
    lastX: number;
    lastZ: number;
    firing: boolean;
    /** When set (homepage showcase), ignore motion and keep this walk weight. */
    walkLock: number | null;
}

const instances: Instance[] = [];
const instanceByRoot = new WeakMap<Object3D, Instance>();
const _worldPos = new Vector3();

export function hasAnimatedModel(id: string): boolean {
    return templates.has(id);
}

/** Yaw, scale to `height`, center x/z, sit base at y=0 (mirrors the static path). */
function normalize(
    root: Object3D,
    height: number,
    yaw: number,
    pitch?: number,
    roll?: number,
    offset?: { x?: number; y?: number; z?: number },
): Group {
    const holder = new Group();
    root.rotation.y = yaw;
    if (pitch !== undefined) root.rotation.x = pitch;
    if (roll !== undefined) root.rotation.z = roll;
    holder.add(root);
    let box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const s = size.y > 0 ? height / size.y : 1;
    root.scale.multiplyScalar(s);
    box = new Box3().setFromObject(holder);
    const c = box.getCenter(new Vector3());
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= box.min.y;
    if (offset) {
        if (offset.x !== undefined) root.position.x += offset.x;
        if (offset.y !== undefined) root.position.y += offset.y;
        if (offset.z !== undefined) root.position.z += offset.z;
    }
    return holder;
}

function prepareMaterials(scene: Object3D): void {
    scene.traverse((o) => {
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
}

/** Zero horizontal root-bone translation so walk/fire play in place (sim owns xz). */
function stripRootMotion(clip: AnimationClip, rootName: string): void {
    for (const tr of clip.tracks) {
        if (tr.name !== `${rootName}.position`) continue;
        const v = tr.values;
        const x0 = v[0]!;
        const z0 = v[2]!;
        for (let i = 0; i < v.length; i += 3) {
            v[i] = x0;
            v[i + 2] = z0;
        }
    }
}

function rootBoneName(root: Object3D): string {
    let skinned: SkinnedMesh | undefined;
    root.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
    });
    const bones = skinned?.skeleton.bones ?? [];
    const root0 = bones.find((b: Bone) => !(b.parent instanceof Bone)) ?? bones[0];
    return root0?.name ?? 'Root';
}

function pickClip(clips: AnimationClip[], pick: ClipPick, role: string): AnimationClip {
    if (clips.length === 0) throw new Error(`no animation clips for ${role}`);
    if (typeof pick === 'number') {
        const c = clips[pick];
        if (!c) throw new Error(`clip index ${pick} missing for ${role}`);
        return c;
    }
    if (pick === 'longest') {
        return clips.reduce((a, b) => (b.duration >= a.duration ? b : a));
    }
    if (pick === 'shortest') {
        return clips.reduce((a, b) => (b.duration <= a.duration ? b : a));
    }
    const lower = pick.toLowerCase();
    const byName = clips.find((c) => c.name.toLowerCase().includes(lower));
    if (!byName) {
        throw new Error(`no clip matching "${pick}" for ${role} (have: ${clips.map((c) => c.name).join(', ')})`);
    }
    return byName;
}

export async function loadAnimatedModels(heights: Record<string, number>): Promise<void> {
    const textureBudget = modelTextureBudget();
    await Promise.all(
        Object.entries(ANIM_SPECS).map(async ([id, spec]) => {
            try {
                const gltf = await loader.loadAsync(spec.url);
                if (textureBudget) applyTextureBudget(gltf.scene, textureBudget);
                const clips = gltf.animations.slice();
                if (clips.length === 0) {
                    throw new Error('GLB has no animations');
                }
                const walkSrc = pickClip(clips, spec.walk, 'walk');
                const fireSrc = spec.fire != null ? pickClip(clips, spec.fire, 'fire') : null;
                // Clone clips so stripRootMotion doesn't mutate the loader cache.
                const walk = walkSrc.clone();
                walk.name = 'walk';
                const fire = fireSrc ? fireSrc.clone() : null;
                if (fire) fire.name = 'fire';

                const prepared = skeletonClone(gltf.scene);
                prepareMaterials(prepared);
                const bone = rootBoneName(prepared);
                stripRootMotion(walk, bone);
                if (fire) stripRootMotion(fire, bone);

                const h = (heights[id] || 1) * (spec.scale ?? 1);
                const root = normalize(prepared, h, spec.yaw, spec.pitch, spec.roll, spec.offset);
                templates.set(id, { root, walk, fire, walkSpeed: spec.walkSpeed ?? 1 });
                console.info(
                    `[unitAnimated] '${id}' ready (root='${bone}', walk=${walk.duration.toFixed(2)}s` +
                        `@${(spec.walkSpeed ?? 1).toFixed(2)}x` +
                        (fire ? `, fire=${fire.duration.toFixed(2)}s` : '') +
                        `; clips: ${clips.map((c) => `${c.name}:${c.duration.toFixed(2)}`).join(', ')})`,
                );
            } catch (e) {
                console.error(`[unitAnimated] '${id}' FAILED; will fall back to static/procedural`, e);
            }
        }),
    );
}

/**
 * Fresh skinned clone with its own mixer. Walk loops; fire is one-shot on demand.
 * Returns null if no template loaded.
 */
export function cloneAnimatedModel(id: string, _team?: BattleTeam): Group | null {
    const t = templates.get(id);
    if (!t) return null;
    const root = skeletonClone(t.root) as Group;
    // Materials were prepared on the template; clone materials so level tint is per-pack.
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => (m as MeshStandardMaterial).clone());
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    });

    const mixer = new AnimationMixer(root);
    const walk = mixer.clipAction(t.walk);
    walk.setLoop(LoopRepeat, Infinity);
    walk.timeScale = t.walkSpeed;
    walk.play();
    walk.setEffectiveWeight(0);

    let fire: AnimationAction | null = null;
    if (t.fire) {
        fire = mixer.clipAction(t.fire);
        fire.setLoop(LoopOnce, 1);
        fire.clampWhenFinished = true;
        fire.setEffectiveWeight(0);
    }

    const inst: Instance = {
        mixer,
        walk,
        fire,
        root,
        lastX: 0,
        lastZ: 0,
        firing: false,
        walkLock: null,
    };
    mixer.addEventListener('finished', (e) => {
        if (e.action !== inst.fire) return;
        inst.firing = false;
        inst.fire?.setEffectiveWeight(0);
    });
    instances.push(inst);
    instanceByRoot.set(root, inst);
    return root;
}

/** Homepage / preview: force swagger on (1) or idle bind (0). */
export function lockAnimatedWalk(root: Object3D, weight: number): void {
    const inst = instanceByRoot.get(root);
    if (!inst) return;
    inst.walkLock = weight;
    if (!inst.firing) inst.walk.setEffectiveWeight(weight);
}

/** Play the shoot clip on an animated unit proxy (the Group the sim owns). */
export function playUnitFireAnim(proxy: Object3D): void {
    for (const child of proxy.children) {
        const inst = instanceByRoot.get(child);
        if (inst?.fire) {
            beginFire(inst);
            return;
        }
    }
}

function beginFire(inst: Instance): void {
    if (!inst.fire) return;
    inst.firing = true;
    inst.walk.setEffectiveWeight(0);
    inst.fire.reset();
    inst.fire.setEffectiveWeight(1);
    inst.fire.play();
}

/**
 * Advance every animated instance: walk weight from motion; fire one-shots
 * finish back into walk/idle. Drop instances whose root left the scene.
 */
export function updateAnimatedUnits(dt: number): void {
    for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i]!;
        if (!inst.root.parent) {
            instanceByRoot.delete(inst.root);
            instances.splice(i, 1);
            continue;
        }

        if (!inst.firing) {
            if (inst.walkLock != null) {
                inst.walk.setEffectiveWeight(inst.walkLock);
            } else {
                // Pack view + formation offset — world xz so swagger tracks real motion.
                inst.root.parent!.getWorldPosition(_worldPos);
                const moved = Math.hypot(_worldPos.x - inst.lastX, _worldPos.z - inst.lastZ);
                inst.lastX = _worldPos.x;
                inst.lastZ = _worldPos.z;
                const wantWalk = moved > 0.002;
                const target = wantWalk ? 1 : 0;
                const w = inst.walk.getEffectiveWeight();
                const next = w + (target - w) * Math.min(1, 8 * dt);
                inst.walk.setEffectiveWeight(next);
            }
        }

        inst.mixer.update(dt);
    }
}
