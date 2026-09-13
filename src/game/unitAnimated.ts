import {
    AnimationMixer,
    AnimationUtils,
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
import { assetUrl } from './assets';

/** Same rest-forward bake as Tripo models in unitModels ( +X → −Z ). */
const MODEL_FWD_YAW = Math.PI / 2;

/**
 * Pick a clip when the exporter names them uselessly (NlaTrack / NlaTrack.001).
 * `longest` / `shortest` by duration; or a substring of the clip name; or index.
 */
export type ClipPick = 'longest' | 'shortest' | number | string;

/** Seconds window inside an authored clip (inclusive start, exclusive-ish end via subclip). */
export type ClipTimeRange = { start: number; end: number };

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
    /** Keep only this time window of the walk clip (seconds). */
    walkRange?: ClipTimeRange;
    /** Playback rate for the walk clip (default 1). Higher = less slide/surf. */
    walkSpeed?: number;
    /** One-shot attack; omit if the asset has none. */
    fire?: ClipPick;
    /** Keep only this time window of the fire clip (seconds). */
    fireRange?: ClipTimeRange;
    /** Playback rate for the fire clip (default 1). Speed up long authored swings. */
    fireSpeed?: number;
    /**
     * Keep the fire one-shot playing even if the mesh moves (crowd jostle /
     * turn). Melee windups need this — default aborts fire as soon as they
     * relocate so long attack poses don't stick after the swing.
     */
    fireHold?: boolean;
    /** One-shot death / tip-over clip; omit to keep procedural death tip. */
    death?: ClipPick;
    /** Playback rate for the death clip (default 1). */
    deathSpeed?: number;
    /**
     * Where the authored death clip lays the body in holder XZ (rest forward −Z).
     * Used to yaw the proxy so the fall lines up with the killing blow.
     * Ogre `fall`: head travels ≈ local −X (character's left).
     */
    deathFallLocal?: { x: number; z: number };
}

/**
 * Melodan rigged units. Clip picks tolerate Tripo/Cascadeur-style `NlaTrack` names.
 * Walk = longer swagger loop; fire = shorter shoot (see archer.glb).
 */
export const ANIM_SPECS: Record<string, AnimSpec> = {
    archer: {
        get url() {
            return assetUrl('models/units/archer.glb');
        },
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        walk: 'longest',
        walkSpeed: 1.5,
        fire: 'shortest',
    },
    hammerer: {
        get url() {
            return assetUrl('models/units/hammerer.glb');
        },
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        // named clips: preset:biped:walk / preset:biped:fire
        walk: 'walk',
        walkSpeed: 1.35,
        fire: 'fire',
        // authored 2s — speed up so the swing fits attackInterval 0.7
        fireSpeed: 2.85,
        // ranged march-and-shoot / crowd nudge must not cancel the throw
        fireHold: true,
    },
    ogre: {
        get url() {
            return assetUrl('models/units/ogre.glb');
        },
        yaw: MODEL_FWD_YAW + MathUtils.degToRad(90),
        // Foot align is measured from the walk clip (see footAlign on template) —
        // blended by anim weight so T-pose deploy and run both sit on the marker.
        walk: 'run',
        walkSpeed: 0.5,
        fire: 'pitch_baseball',
        // authored ~3.8s — speed up so the swing fits combat cadence
        fireSpeed: 3,
        // melee stands in a scrum; micro-pushes must not cancel the pitch
        fireHold: true,
        death: 'fall',
        deathSpeed: 2.2, // ~3.0s authored → ~1.4s tip
        deathFallLocal: { x: -1, z: 0 },
    },
};

export function isAnimatedUnitId(id: string): boolean {
    return id in ANIM_SPECS;
}

interface Template {
    root: Object3D;
    walk: AnimationClip;
    fire: AnimationClip | null;
    death: AnimationClip | null;
    walkSpeed: number;
    fireSpeed: number;
    deathSpeed: number;
    fireHold: boolean;
    deathFallLocalX: number;
    deathFallLocalZ: number;
    /**
     * Holder-local shift applied to the inner model while anims are weighted,
     * so walk/fire feet sit on the sim origin. Bind/T-pose uses weight 0 (no shift).
     */
    footAlignX: number;
    footAlignZ: number;
}

const templates = new Map<string, Template>();
const loader = getGltfLoader();

/** Seconds to blend walk ↔ fire / death (hard cuts read as pops on big rigs). */
const ANIM_FADE = 0.22;

interface Instance {
    mixer: AnimationMixer;
    walk: AnimationAction;
    fire: AnimationAction | null;
    death: AnimationAction | null;
    /** Animated root (child of the unit proxy Group). */
    root: Object3D;
    /** Authored walk clip rate at full unit speed. */
    baseWalkSpeed: number;
    /** Authored fire clip rate (long slash clips need >1). */
    baseFireSpeed: number;
    baseDeathSpeed: number;
    /** When true, crowd jostle does not cancel an in-progress fire clip. */
    fireHold: boolean;
    deathFallLocalX: number;
    deathFallLocalZ: number;
    /** UnitType.speed — walk timeScale scales with groundSpeed / this. */
    nominalSpeed: number;
    /** Smoothed groundSpeed / nominalSpeed. */
    speedRatio: number;
    /** False until we have a valid last xz (avoids a spawn-frame speed spike). */
    hasLastPos: boolean;
    lastX: number;
    lastZ: number;
    firing: boolean;
    /** Playing the death one-shot — freezes locomotion until the mixer is gone. */
    dying: boolean;
    /** When set (homepage showcase), ignore motion and keep this walk weight. */
    walkLock: number | null;
    /** Inner model rest translation (bind / T-pose seat). */
    baseInnerX: number;
    baseInnerZ: number;
    footAlignX: number;
    footAlignZ: number;
}

const instances: Instance[] = [];
const instanceByRoot = new WeakMap<Object3D, Instance>();
const _worldPos = new Vector3();
const _footA = new Vector3();
const _footB = new Vector3();

export function hasAnimatedModel(id: string): boolean {
    return templates.has(id);
}

/** Midpoint of L/R foot in holder space (holder assumed unmoved). */
function midFootInHolder(holder: Object3D): { x: number; z: number } | null {
    let skinned: SkinnedMesh | undefined;
    let lFoot: Bone | undefined;
    let rFoot: Bone | undefined;
    holder.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
        if (o instanceof Bone) {
            if (o.name === 'L_Foot') lFoot = o;
            if (o.name === 'R_Foot') rFoot = o;
        }
    });
    if (!skinned || !lFoot || !rFoot) return null;
    holder.updateMatrixWorld(true);
    skinned.skeleton.update();
    lFoot.getWorldPosition(_footA);
    rFoot.getWorldPosition(_footB);
    return { x: (_footA.x + _footB.x) * 0.5, z: (_footA.z + _footB.z) * 0.5 };
}

/**
 * How far to shift the inner model while the walk clip plays so feet sit on
 * the holder origin. Restores bind pose afterward so the template stays T-pose.
 */
function measureFootAlign(holder: Group, walk: AnimationClip): { x: number; z: number } {
    const mixer = new AnimationMixer(holder);
    const act = mixer.clipAction(walk);
    act.setEffectiveWeight(1);
    act.play();
    mixer.setTime(0);
    const mid = midFootInHolder(holder);
    mixer.stopAllAction();
    // Put bones back to bind so deploy / idle still shows T-pose.
    holder.traverse((o) => {
        const sk = o as SkinnedMesh;
        if (sk.isSkinnedMesh) sk.skeleton.pose();
    });
    holder.updateMatrixWorld(true);
    if (!mid) return { x: 0, z: 0 };
    return { x: -mid.x, z: -mid.z };
}

function innerModel(holder: Object3D): Object3D | null {
    return holder.children[0] ?? null;
}

/**
 * Object stuck arrows should parent to. For animated units this is the anim
 * holder that receives foot-align — the empty proxy alone leaves shafts floating.
 */
export function stuckBoltAttachOf(proxy: Object3D): Object3D {
    const inst = instanceForProxy(proxy);
    return inst?.root ?? proxy;
}

/** Blend foot align with current anim weights (0 = T-pose seat, 1 = walk seat). */
function applyFootAlign(inst: Instance): void {
    // Shift the anim holder (not its inner child) so world scale / AABB seating
    // stay correct and stuck bolts parented here ride the stance.
    const w = Math.min(
        1,
        Math.max(
            inst.walk.getEffectiveWeight(),
            inst.fire?.getEffectiveWeight() ?? 0,
            inst.death?.getEffectiveWeight() ?? 0,
        ),
    );
    inst.root.position.x = inst.baseInnerX + inst.footAlignX * w;
    inst.root.position.z = inst.baseInnerZ + inst.footAlignZ * w;
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

/**
 * Pin Root/Hip position tracks to one shared seat (walk's first frame) so
 * clip swaps don't teleport the mesh. Horizontal locomotion is owned by the sim.
 * `preserveY` keeps each clip's vertical hip motion (needed for death falls).
 */
function pinSharedRootPositions(
    clips: AnimationClip[],
    boneNames: string[],
    opts?: { preserveY?: boolean },
): void {
    const names = boneNames.filter(Boolean);
    if (clips.length === 0 || names.length === 0) return;
    const ref = new Map<string, [number, number, number]>();
    for (const bone of names) {
        const track = clips[0]!.tracks.find((t) => t.name === `${bone}.position`);
        if (!track || track.values.length < 3) continue;
        ref.set(bone, [track.values[0]!, track.values[1]!, track.values[2]!]);
    }
    const preserveY = !!opts?.preserveY;
    for (const clip of clips) {
        for (const track of clip.tracks) {
            const bone = names.find((n) => track.name === `${n}.position`);
            if (!bone) continue;
            const seat = ref.get(bone);
            if (!seat) continue;
            const [sx, sy, sz] = seat;
            const y0 = track.values[1] ?? sy;
            for (let i = 0; i < track.values.length; i += 3) {
                track.values[i] = sx;
                track.values[i + 2] = sz;
                track.values[i + 1] = preserveY ? sy + (track.values[i + 1]! - y0) : sy;
            }
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

/** Hip (or similar) usually carries authored locomotion under Root. */
function locomotionBoneNames(root: Object3D): string[] {
    const rootName = rootBoneName(root);
    const names = [rootName];
    let skinned: SkinnedMesh | undefined;
    root.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
    });
    for (const b of skinned?.skeleton.bones ?? []) {
        const n = b.name;
        if (/^(hip|hips|pelvis)$/i.test(n) && !names.includes(n)) names.push(n);
    }
    return names;
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

/** Trim a clip to [start, end] seconds via {@link AnimationUtils.subclip} (30 fps). */
function trimClipRange(clip: AnimationClip, name: string, range?: ClipTimeRange): AnimationClip {
    if (!range) {
        const c = clip.clone();
        c.name = name;
        return c;
    }
    const fps = 30;
    const start = Math.max(0, range.start) * fps;
    const end = Math.max(start + 1e-3, Math.min(clip.duration, range.end)) * fps;
    const trimmed = AnimationUtils.subclip(clip, name, start, end, fps);
    trimmed.name = name;
    return trimmed;
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
                const deathSrc = spec.death != null ? pickClip(clips, spec.death, 'death') : null;
                // Clone/trim so pinSharedRootPositions doesn't mutate the loader cache.
                const walk = trimClipRange(walkSrc, 'walk', spec.walkRange);
                const fire = fireSrc ? trimClipRange(fireSrc, 'fire', spec.fireRange) : null;
                const death = deathSrc ? trimClipRange(deathSrc, 'death') : null;

                const prepared = skeletonClone(gltf.scene);
                prepareMaterials(prepared);
                const bone = rootBoneName(prepared);
                const locoBones = locomotionBoneNames(prepared);
                const clipsToPin = fire ? [walk, fire] : [walk];
                pinSharedRootPositions(clipsToPin, locoBones);
                // Death keeps Hip Y collapse so the body settles onto the lawn.
                if (death) pinSharedRootPositions([walk, death], locoBones, { preserveY: true });

                const h = (heights[id] || 1) * (spec.scale ?? 1);
                // No static offset — footAlign blends bind vs walk seats at runtime.
                const root = normalize(prepared, h, spec.yaw, spec.pitch, spec.roll, spec.offset);
                const footAlign = measureFootAlign(root, walk);
                const fallLocal = spec.deathFallLocal ?? { x: 0, z: -1 };
                templates.set(id, {
                    root,
                    walk,
                    fire,
                    death,
                    walkSpeed: spec.walkSpeed ?? 1,
                    fireSpeed: spec.fireSpeed ?? 1,
                    deathSpeed: spec.deathSpeed ?? 1,
                    fireHold: !!spec.fireHold,
                    deathFallLocalX: fallLocal.x,
                    deathFallLocalZ: fallLocal.z,
                    footAlignX: footAlign.x,
                    footAlignZ: footAlign.z,
                });
                console.info(
                    `[unitAnimated] '${id}' ready (root='${bone}', pin=[${locoBones.join(',')}],` +
                        ` footAlign=(${footAlign.x.toFixed(2)},${footAlign.z.toFixed(2)}), walk=${walk.duration.toFixed(2)}s` +
                        `@${(spec.walkSpeed ?? 1).toFixed(2)}x` +
                        (spec.walkRange
                            ? ` trim=${spec.walkRange.start.toFixed(2)}-${spec.walkRange.end.toFixed(2)}`
                            : '') +
                        (fire
                            ? `, fire=${fire.duration.toFixed(2)}s@${(spec.fireSpeed ?? 1).toFixed(2)}x` +
                              (spec.fireRange
                                  ? ` trim=${spec.fireRange.start.toFixed(2)}-${spec.fireRange.end.toFixed(2)}`
                                  : '')
                            : '') +
                        (death
                            ? `, death=${death.duration.toFixed(2)}s@${(spec.deathSpeed ?? 1).toFixed(2)}x`
                            : '') +
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
 * @param nominalSpeed UnitType.speed — walk playback scales with ground speed / this.
 */
export function cloneAnimatedModel(
    id: string,
    _team?: BattleTeam,
    nominalSpeed = 0,
): Group | null {
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
        fire.timeScale = t.fireSpeed;
        fire.setEffectiveWeight(0);
    }

    let death: AnimationAction | null = null;
    if (t.death) {
        death = mixer.clipAction(t.death);
        death.setLoop(LoopOnce, 1);
        death.clampWhenFinished = true;
        death.timeScale = t.deathSpeed;
        death.setEffectiveWeight(0);
        death.enabled = false; // only enable when playUnitDeathAnim runs
    }

    const inst: Instance = {
        mixer,
        walk,
        fire,
        death,
        root,
        baseWalkSpeed: t.walkSpeed,
        baseFireSpeed: t.fireSpeed,
        baseDeathSpeed: t.deathSpeed,
        fireHold: t.fireHold,
        deathFallLocalX: t.deathFallLocalX,
        deathFallLocalZ: t.deathFallLocalZ,
        nominalSpeed: Math.max(0, nominalSpeed),
        speedRatio: 1,
        hasLastPos: false,
        lastX: 0,
        lastZ: 0,
        firing: false,
        dying: false,
        walkLock: null,
        // Foot-align shifts the holder; keep the authored inner centering intact.
        baseInnerX: root.position.x,
        baseInnerZ: root.position.z,
        footAlignX: t.footAlignX,
        footAlignZ: t.footAlignZ,
    };
    mixer.addEventListener('finished', (e) => {
        if (e.action === inst.fire) {
            inst.firing = false;
            // Ease back toward idle/walk instead of a hard cut off the pitch.
            inst.fire?.fadeOut(ANIM_FADE);
            if (!inst.dying && !inst.walk.isRunning()) {
                inst.walk.reset();
                inst.walk.play();
            }
            if (!inst.dying) inst.walk.fadeIn(ANIM_FADE);
        }
    });
    instances.push(inst);
    instanceByRoot.set(root, inst);
    return root;
}

function instanceForProxy(proxy: Object3D): Instance | null {
    for (const child of proxy.children) {
        const inst = instanceByRoot.get(child);
        if (inst) return inst;
    }
    return null;
}

/**
 * Clear a death pose so a recycled mesh can walk again (placement / next round).
 * Meshes outlive the battle; without this the fall clip stays clamped on forever.
 */
export function resetAnimatedUnit(proxy: Object3D): void {
    const inst = instanceForProxy(proxy);
    if (!inst) return;
    inst.dying = false;
    inst.firing = false;
    inst.hasLastPos = false;
    inst.speedRatio = 1;
    if (inst.death) {
        inst.death.stop();
        inst.death.setEffectiveWeight(0);
        inst.death.enabled = false;
        inst.death.time = 0;
    }
    if (inst.fire) {
        inst.fire.stop();
        inst.fire.setEffectiveWeight(0);
    }
    inst.walk.reset();
    inst.walk.setLoop(LoopRepeat, Infinity);
    inst.walk.timeScale = inst.baseWalkSpeed;
    inst.walk.setEffectiveWeight(0);
    inst.walk.play();
    inst.root.position.x = inst.baseInnerX;
    inst.root.position.z = inst.baseInnerZ;
    // Sample one bind frame so the skinned mesh leaves the clamped fall pose.
    inst.mixer.update(0);
}

/** Homepage / preview: force swagger on (1) or idle bind (0). */
export function lockAnimatedWalk(root: Object3D, weight: number): void {
    const inst = instanceByRoot.get(root);
    if (!inst) return;
    inst.walkLock = weight;
    if (!inst.firing && !inst.dying) inst.walk.setEffectiveWeight(weight);
}

/** Play the shoot clip on an animated unit proxy (the Group the sim owns). */
export function playUnitFireAnim(proxy: Object3D): void {
    const inst = instanceForProxy(proxy);
    if (inst?.fire && !inst.dying) beginFire(inst);
}

/** True when this animated proxy has a death / fall clip. */
export function hasUnitDeathAnim(proxy: Object3D): boolean {
    return !!instanceForProxy(proxy)?.death;
}

/**
 * Authored fall direction in holder XZ (rest forward −Z), or null if no death clip.
 */
export function unitDeathFallLocal(proxy: Object3D): { x: number; z: number } | null {
    const inst = instanceForProxy(proxy);
    if (!inst?.death) return null;
    return { x: inst.deathFallLocalX, z: inst.deathFallLocalZ };
}

/**
 * Play the death one-shot. Returns wall-clock duration (clip / speed), or 0 if none.
 */
export function playUnitDeathAnim(proxy: Object3D): number {
    const inst = instanceForProxy(proxy);
    if (!inst?.death) return 0;
    inst.dying = true;
    inst.firing = false;
    inst.death.enabled = true;
    inst.death.reset();
    inst.death.timeScale = inst.baseDeathSpeed;
    inst.death.setEffectiveWeight(1);
    inst.death.play();
    const from = inst.fire && inst.fire.getEffectiveWeight() > 0.05 ? inst.fire : inst.walk;
    from.crossFadeTo(inst.death, ANIM_FADE, false);
    const speed = Math.max(1e-4, inst.baseDeathSpeed);
    return inst.death.getClip().duration / speed;
}

function beginFire(inst: Instance): void {
    if (!inst.fire || inst.dying) return;
    inst.firing = true;
    inst.fire.reset();
    inst.fire.timeScale = inst.baseFireSpeed;
    inst.fire.setEffectiveWeight(1);
    inst.fire.play();
    inst.walk.crossFadeTo(inst.fire, ANIM_FADE, false);
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

        // Always sample motion — needed to interrupt fire when the pack starts walking.
        inst.root.parent!.getWorldPosition(_worldPos);
        let moved = 0;
        if (!inst.hasLastPos) {
            inst.lastX = _worldPos.x;
            inst.lastZ = _worldPos.z;
            inst.hasLastPos = true;
        } else {
            moved = Math.hypot(_worldPos.x - inst.lastX, _worldPos.z - inst.lastZ);
            inst.lastX = _worldPos.x;
            inst.lastZ = _worldPos.z;
        }

        // Attack pose held the whole clip; break out as soon as they actually
        // move — unless fireHold (melee windups in a scrum get micro-pushed).
        if (inst.firing && !inst.dying && !inst.fireHold && moved > 0.008) {
            inst.firing = false;
            if (inst.fire) {
                inst.fire.fadeOut(ANIM_FADE * 0.6);
            }
            if (!inst.walk.isRunning()) inst.walk.play();
            inst.walk.reset();
            inst.walk.fadeIn(ANIM_FADE * 0.6);
        }

        if (inst.dying) {
            // Death crossfade owns weights; don't yank walk mid-blend.
        } else {
            // Safety: a recycled corpse must not keep the fall clip weighted in.
            if (inst.death && inst.death.enabled && inst.death.getEffectiveWeight() > 0) {
                inst.death.stop();
                inst.death.setEffectiveWeight(0);
                inst.death.enabled = false;
            }
            if (inst.firing) {
                // Fire action weight driven by crossFade / finished handler.
            } else if (inst.walkLock != null) {
                inst.walk.timeScale = inst.baseWalkSpeed;
                inst.walk.setEffectiveWeight(inst.walkLock);
            } else {
                const wantWalk = moved > 0.002;
                const target = wantWalk ? 1 : 0;
                const w = inst.walk.getEffectiveWeight();
                // Gentler than the old 28/12 snap — big units read better easing in/out.
                const rate = target > w ? 10 : 6;
                const next = w + (target - w) * Math.min(1, rate * dt);
                if (!inst.walk.isRunning() && next > 0.02) inst.walk.play();
                inst.walk.setEffectiveWeight(next);

                // Match foot cadence to actual ground speed (debuff / oil / etc.).
                if (inst.nominalSpeed > 1e-6 && dt > 1e-8) {
                    const groundSpeed = moved / dt;
                    const ratio = MathUtils.clamp(groundSpeed / inst.nominalSpeed, 0, 2);
                    // Faster speedRatio catch-up when accelerating from a standstill.
                    const catchUp = ratio > inst.speedRatio ? 14 : 8;
                    inst.speedRatio += (ratio - inst.speedRatio) * Math.min(1, catchUp * dt);
                    inst.walk.timeScale =
                        inst.baseWalkSpeed * (wantWalk ? Math.max(inst.speedRatio, 0.35) : 0);
                }
            }
        }

        applyFootAlign(inst);
        inst.mixer.update(dt);
    }
}
