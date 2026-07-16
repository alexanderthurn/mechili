import {
    AnimationMixer,
    Box3,
    Bone,
    Color,
    Group,
    Mesh,
    MeshStandardMaterial,
    SkinnedMesh,
    Vector3,
    type AnimationAction,
    type AnimationClip,
    type Object3D,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { teamColors } from './colors';
import type { Team } from './units';

/** Units driven by a rigged FBX (walk + idle clips) instead of a static GLB. */
interface AnimSpec {
    walkUrl: string;
    idleUrl: string;
    /** yaw to face -z (facing=0), flip by ±π/2 or π if it ends up wrong */
    yaw: number;
}
// Disabled for the Melodan fantasy pass — units are static GLB + procedural
// movement (no rigging). Kept for a later rigged-animation pass.
const ANIM_SPECS: Record<string, AnimSpec> = {};

const TEAM_TINT = 0.32;

interface Template {
    player: Object3D;
    enemy: Object3D;
    walk: AnimationClip;
    idle: AnimationClip;
}
const templates = new Map<string, Template>();

interface Instance {
    mixer: AnimationMixer;
    walk: AnimationAction;
    idle: AnimationAction;
    mesh: Object3D;
    lastX: number;
    lastZ: number;
    walking: boolean;
}
const instances: Instance[] = [];
const fbx = new FBXLoader();

export function hasAnimatedModel(id: string): boolean {
    return templates.has(id);
}

/** Convert to matte RA2-style standard material tinted toward the team color. */
function retint(obj: Object3D, team: Team): void {
    const col = new Color(teamColors[team].hex);
    obj.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
        const std = new MeshStandardMaterial({
            map: src?.map ?? null,
            color: (src?.color ? src.color.clone() : new Color(0x9a9478)).lerp(col, TEAM_TINT),
            metalness: 0.1,
            roughness: 0.85,
        });
        mesh.material = std;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
    });
}

/** Yaw, scale to `height`, center x/z, sit base at y=0 (mirrors the static path). */
function normalize(root: Object3D, height: number, yaw: number): Group {
    const holder = new Group();
    root.rotation.y = yaw;
    holder.add(root);
    let box = new Box3().setFromObject(holder);
    const s = box.getSize(new Vector3()).y > 0 ? height / box.getSize(new Vector3()).y : 1;
    root.scale.multiplyScalar(s);
    box = new Box3().setFromObject(holder);
    const c = box.getCenter(new Vector3());
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= box.min.y;
    return holder;
}

/** Zero the horizontal root-bone translation so the walk plays in place. */
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
    let skinned: SkinnedMesh | null = null;
    root.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
    });
    const bones = skinned ? (skinned as SkinnedMesh).skeleton.bones : [];
    const root0 = bones.find((b) => !(b.parent instanceof Bone)) ?? bones[0];
    return root0?.name ?? 'Root';
}

export async function loadAnimatedModels(heights: Record<string, number>): Promise<void> {
    await Promise.all(
        Object.entries(ANIM_SPECS).map(async ([id, spec]) => {
            try {
                const [walkFbx, idleFbx] = await Promise.all([fbx.loadAsync(spec.walkUrl), fbx.loadAsync(spec.idleUrl)]);
                const walk = walkFbx.animations[0]!;
                const idle = idleFbx.animations[0]!;
                walk.name = 'walk';
                idle.name = 'idle';
                const rootName = rootBoneName(walkFbx);
                stripRootMotion(walk, rootName);
                stripRootMotion(idle, rootName);

                const h = heights[id] || 1;
                const player = skeletonClone(walkFbx);
                const enemy = skeletonClone(walkFbx);
                retint(player, 'player');
                retint(enemy, 'enemy');
                templates.set(id, {
                    player: normalize(player, h, spec.yaw),
                    enemy: normalize(enemy, h, spec.yaw),
                    walk,
                    idle,
                });
                console.info(`[unitAnimated] '${id}' ready (root='${rootName}', clips: walk+idle)`);
            } catch (e) {
                console.error(`[unitAnimated] '${id}' FAILED; will fall back to static/procedural`, e);
            }
        }),
    );
}

/**
 * A fresh animated clone: a skinned mesh with its own mixer, walk+idle actions,
 * registered for per-frame updates. Returns null if no template loaded.
 */
export function cloneAnimatedModel(id: string, team: Team): Group | null {
    const t = templates.get(id);
    if (!t) return null;
    const root = skeletonClone(t[team]) as Group;
    const mixer = new AnimationMixer(root);
    const walk = mixer.clipAction(t.walk);
    const idle = mixer.clipAction(t.idle);
    idle.play();
    walk.play();
    walk.setEffectiveWeight(0);
    idle.setEffectiveWeight(1);
    instances.push({ mixer, walk, idle, mesh: root, lastX: 0, lastZ: 0, walking: false });
    return root;
}

/**
 * Advance every animated instance: crossfade walk/idle by whether the mesh
 * moved this frame, and drop instances whose mesh has left the scene.
 */
export function updateAnimatedUnits(dt: number): void {
    for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i]!;
        if (!inst.mesh.parent) {
            instances.splice(i, 1);
            continue;
        }
        // the wrapper's world x/z is set by the sim each frame; movement ⇒ walk
        const wx = inst.mesh.parent.position.x;
        const wz = inst.mesh.parent.position.z;
        const moved = Math.hypot(wx - inst.lastX, wz - inst.lastZ);
        inst.lastX = wx;
        inst.lastZ = wz;
        const wantWalk = moved > 0.002;
        // ease the walk/idle blend so transitions aren't a hard pop
        const target = wantWalk ? 1 : 0;
        const w = inst.walk.getEffectiveWeight();
        const next = w + (target - w) * Math.min(1, 8 * dt);
        inst.walk.setEffectiveWeight(next);
        inst.idle.setEffectiveWeight(1 - next);
        inst.walking = wantWalk;
        inst.mixer.update(dt);
    }
}
