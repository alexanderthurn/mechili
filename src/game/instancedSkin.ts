import {
    AnimationMixer,
    DataTexture,
    DynamicDrawUsage,
    FloatType,
    InstancedBufferAttribute,
    Matrix4,
    Object3D,
    Vector3,
    MeshDepthMaterial,
    MeshStandardMaterial,
    NearestFilter,
    RGBADepthPacking,
    RGBAFormat,
    type AnimationClip,
    type Bone,
    type BufferGeometry,
    type Group,
    type InstancedMesh,
    type Material,
    type SkinnedMesh,
} from 'three';
import { computeCrowWingRate, type CrowWingRateInput } from './crowWingFlap';
import type { ModelAnimation } from './unitAnimated';

/**
 * GPU skinning for instanced packs. Every clip of a rigged GLB is sampled at
 * load into one float texture of bone matrices (rows = frames, 4 texels per
 * bone), already folded into the normalized model space. Each instance carries
 * which clip it plays and from when; the vertex shader blends the frames, so a
 * whole pack of crows animates in one draw call and the CPU only writes a few
 * floats when a unit changes what it is doing.
 *
 * Render-only: nothing here feeds the deterministic sim.
 */

export type SkinRole = 'walk' | 'idle' | 'fly' | 'fire' | 'death';
const ROLES: readonly SkinRole[] = ['walk', 'idle', 'fly', 'fire', 'death'];
type LoopRole = 'walk' | 'idle' | 'fly';

/** Bake resolution — clips are linearly interpolated between frames. */
const BAKE_FPS = 30;
/** Seconds to cross-fade from the previous clip into the next. */
const FADE_SECONDS = 0.2;
/** Ground units drop from walk to idle only after standing this long. */
const STAND_AFTER_SECONDS = 0.25;
/** `row * ROW_PACK + frames` packs a clip's texture row and length into one float. */
const ROW_PACK = 1024;

interface BakedClip {
    row: number;
    frames: number;
    /** authored seconds */
    duration: number;
    loop: boolean;
    /** authored playback speed from the model data */
    speed: number;
    /** the source clip — the showcase viewer plays it on a plain mixer */
    clip: AnimationClip;
}

export interface InstancedSkinData {
    texture: DataTexture;
    clips: Partial<Record<SkinRole, BakedClip>>;
    /** where the death clip lays the body, holder XZ (rest forward −Z) — see ModelAnimation.death */
    deathFallLocal: { x: number; z: number };
    /** game seconds from the fire clip's start to its blow (hitAt / speed); 0 = start on the shot */
    fireLead: number;
    /** bone count (texture width / 4) */
    bones: number;
    /** bind-pose skinned geometry — the CPU picks bones under arrow hits from it */
    geometry: BufferGeometry;
    /** AttackNode riding a bone: which bone, and the point in bind (geometry) space — live beam starts */
    attack?: { bone: number; point: Vector3 };
}

/** One shared clock for every skinned pool — advanced with sim-scaled dt. */
const skinTime = { value: 0 };

/**
 * Advance the skin clock and re-pose stuck-arrow bone followers. Runs every
 * phase (packs idle in deployment too) — before stuck bolts sync, like mixers.
 */
export function updateInstancedSkins(dtSeconds: number): void {
    if (dtSeconds > 0) skinTime.value += dtSeconds;
    updateInstancedSkinBones();
}

function pickClip(clips: readonly AnimationClip[], name: string | number): AnimationClip | null {
    if (typeof name === 'number') return clips[name] ?? null;
    const lower = name.toLowerCase();
    return clips.find((c) => c.name.toLowerCase() === lower) ?? clips.find((c) => c.name.toLowerCase().includes(lower)) ?? null;
}

/**
 * Sample every clip role of `anim` on the normalized template `root` into a
 * bone-matrix texture. Returns the skinned mesh's geometry + material for the
 * instance pools, or null when the GLB has no skinned mesh.
 */
export function bakeInstancedSkin(
    root: Group,
    clips: readonly AnimationClip[],
    anim: ModelAnimation,
): { geometry: BufferGeometry; material: MeshStandardMaterial; skin: InstancedSkinData } | null {
    let sm: SkinnedMesh | undefined;
    root.traverse((o) => {
        if (!sm && (o as SkinnedMesh).isSkinnedMesh) sm = o as SkinnedMesh;
    });
    if (!sm) return null;
    const mesh = sm;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
    const bones = mesh.skeleton.bones.length;

    const plan: { role: SkinRole; clip: AnimationClip; speed: number; frames: number }[] = [];
    for (const role of ROLES) {
        const spec = anim[role];
        if (!spec) continue;
        const clip = typeof spec.clip === 'number' || typeof spec.clip === 'string' ? pickClip(clips, spec.clip) : null;
        if (!clip) {
            console.warn(`[instancedSkin] no clip '${String(spec.clip)}' for ${role}`);
            continue;
        }
        plan.push({ role, clip, speed: spec.speed ?? 1, frames: Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1) });
    }
    const rows = plan.reduce((n, p) => n + p.frames, 0);
    const width = bones * 4;
    const data = new Float32Array(width * Math.max(rows, 1) * 4);

    root.updateMatrixWorld(true);
    const rootInv = new Matrix4().copy(root.matrixWorld).invert();
    // bind-space vertex → normalized root space, per bone:
    // rootInv · meshWorld · bindMatrixInverse · boneWorld · boneInverse · bindMatrix
    const pre = new Matrix4();
    const m = new Matrix4();
    const mixer = new AnimationMixer(root);
    const out: InstancedSkinData = {
        texture: null!,
        clips: {},
        deathFallLocal: anim.death?.fallLocal ?? { x: 0, z: -1 },
        fireLead: anim.fire?.hitAt ? anim.fire.hitAt / (anim.fire.speed ?? 1) : 0,
        bones,
        geometry: mesh.geometry,
    };
    let row = 0;
    for (const p of plan) {
        const action = mixer.clipAction(p.clip);
        action.play();
        action.paused = true;
        for (let f = 0; f < p.frames; f++) {
            action.time = Math.min((f / (p.frames - 1)) * p.clip.duration, p.clip.duration);
            mixer.update(0);
            root.updateMatrixWorld(true);
            pre.multiplyMatrices(rootInv, mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
            for (let b = 0; b < bones; b++) {
                const bone = mesh.skeleton.bones[b]!;
                m.multiplyMatrices(pre, bone.matrixWorld)
                    .multiply(mesh.skeleton.boneInverses[b]!)
                    .multiply(mesh.bindMatrix);
                data.set(m.elements, ((row + f) * width + b * 4) * 4);
            }
        }
        action.stop();
        out.clips[p.role] = {
            row,
            frames: p.frames,
            duration: p.clip.duration,
            loop: p.role === 'walk' || p.role === 'idle' || p.role === 'fly',
            speed: p.speed,
            clip: p.clip,
        };
        row += p.frames;
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    mesh.skeleton.pose();
    root.updateMatrixWorld(true);

    // an AttackNode under a bone moves with it — keep it for live (render-only) muzzles
    const attackNode = root.getObjectByName('AttackNode');
    const attackBone = attackNode?.parent ? mesh.skeleton.bones.indexOf(attackNode.parent as Bone) : -1;
    if (attackNode && attackBone >= 0) {
        const point = attackNode.getWorldPosition(new Vector3()).applyMatrix4(mesh.matrixWorld.clone().invert());
        out.attack = { bone: attackBone, point };
    }

    const texture = new DataTexture(data, width, Math.max(rows, 1), RGBAFormat, FloatType);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    out.texture = texture;
    console.info(
        `[instancedSkin] baked ${plan.map((p) => `${p.role}=${p.clip.name}(${p.frames}f)`).join(' ')} · ${bones} bones · ${width}×${rows} texels`,
    );
    return { geometry: mesh.geometry, material, skin: out };
}

/**
 * Hold the template in the first idle (else walk) frame so the size the game
 * measures — HP bars, effects, aim spread — is a standing unit, not a T-pose.
 * Call the returned release() after measuring: stopping the mixer restores the bind pose.
 */
export function poseInstancedSkinRest(root: Group, clips: readonly AnimationClip[], anim: ModelAnimation): () => void {
    const spec = anim.idle ?? anim.walk;
    const clip = typeof spec.clip === 'number' || typeof spec.clip === 'string' ? pickClip(clips, spec.clip) : null;
    if (!clip) return () => {};
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    action.time = 0;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const remeasure = () =>
        root.traverse((o) => {
            if ((o as SkinnedMesh).isSkinnedMesh) (o as SkinnedMesh).computeBoundingBox(); // in the current pose
        });
    remeasure();
    return () => {
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
        root.updateMatrixWorld(true);
        remeasure();
    };
}

// ── shader ────────────────────────────────────────────────────────────────────

const SKIN_DECL = /* glsl */ `
uniform sampler2D uSkinTex;
uniform vec2 uSkinTexSize;
uniform float uSkinTime;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
// (row * ${ROW_PACK} + frames, ±: loop / once), phase0 seconds, anchor time, rate
attribute vec4 aSkinA;
attribute vec4 aSkinB;
attribute float aSkinFade;
mat4 iskinBone(float row, float bone) {
  float x = bone * 4.0;
  float v = (row + 0.5) / uSkinTexSize.y;
  float iw = 1.0 / uSkinTexSize.x;
  return mat4(
    texture2D(uSkinTex, vec2((x + 0.5) * iw, v)),
    texture2D(uSkinTex, vec2((x + 1.5) * iw, v)),
    texture2D(uSkinTex, vec2((x + 2.5) * iw, v)),
    texture2D(uSkinTex, vec2((x + 3.5) * iw, v)));
}
mat4 iskinClip(vec4 c) {
  float packed = abs(c.x);
  float frames = mod(packed, ${ROW_PACK}.0);
  float row = floor(packed / ${ROW_PACK}.0);
  float f = (c.y + (uSkinTime - c.z) * c.w) * ${BAKE_FPS}.0;
  f = c.x > 0.0 ? mod(f, frames - 1.0) : clamp(f, 0.0, frames - 1.0);
  float f0 = floor(f);
  float f1 = min(f0 + 1.0, frames - 1.0);
  float a = f - f0;
  mat4 s0 = skinWeight.x * iskinBone(row + f0, skinIndex.x) + skinWeight.y * iskinBone(row + f0, skinIndex.y)
          + skinWeight.z * iskinBone(row + f0, skinIndex.z) + skinWeight.w * iskinBone(row + f0, skinIndex.w);
  if (a < 0.001) return s0;
  mat4 s1 = skinWeight.x * iskinBone(row + f1, skinIndex.x) + skinWeight.y * iskinBone(row + f1, skinIndex.y)
          + skinWeight.z * iskinBone(row + f1, skinIndex.z) + skinWeight.w * iskinBone(row + f1, skinIndex.w);
  return s0 * (1.0 - a) + s1 * a;
}
mat4 iskinMatrix() {
  mat4 s = iskinClip(aSkinA);
  float k = clamp((uSkinTime - aSkinFade) / ${FADE_SECONDS.toFixed(3)}, 0.0, 1.0);
  if (k < 1.0 && aSkinB.x != 0.0) s = s * k + iskinClip(aSkinB) * (1.0 - k);
  return s;
}
`;

function uniformsFor(skin: InstancedSkinData) {
    return {
        uSkinTex: { value: skin.texture },
        uSkinTexSize: { value: [skin.texture.image.width, skin.texture.image.height] },
        uSkinTime: skinTime,
    };
}

function patch(material: Material, skin: InstancedSkinData, normals: boolean): void {
    const uniforms = uniformsFor(skin);
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = SKIN_DECL + shader.vertexShader;
        if (normals) {
            // the lit pass needs the matrix for normals, which come before positions
            shader.vertexShader = shader.vertexShader
                .replace('#include <beginnormal_vertex>', `mat4 iskinM = iskinMatrix();\n#include <beginnormal_vertex>\nobjectNormal = normalize(mat3(iskinM) * objectNormal);`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = (iskinM * vec4(transformed, 1.0)).xyz;`);
        } else {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>\ntransformed = (iskinMatrix() * vec4(transformed, 1.0)).xyz;`,
            );
        }
    };
    material.customProgramCacheKey = function () {
        return (prevKey ? prevKey.call(this) : '') + `|iskin-v1|${normals ? 'n' : 'd'}`;
    };
    material.needsUpdate = true;
}

/** Hook a pool's (cloned) lit material and give the mesh a matching shadow material. */
export function attachInstancedSkin(mesh: InstancedMesh, material: MeshStandardMaterial, skin: InstancedSkinData): void {
    patch(material, skin, true);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    patch(depth, skin, false);
    mesh.customDepthMaterial = depth;
}

// ── per-instance state ────────────────────────────────────────────────────────

interface ClipPlay {
    role: SkinRole;
    /** clip seconds at `anchor` */
    phase0: number;
    anchor: number;
    rate: number;
}

interface SkinAnimState {
    a: ClipPlay;
    b: ClipPlay | null;
    fadeStart: number;
    dying: boolean;
    /** per-mech offset so a pack doesn't beat in lockstep (0..1 of a loop) */
    seed: number;
    /** walk vs idle hysteresis */
    walking: boolean;
    /** channelling a beam: the fire pose holds, loops don't take over */
    holding: boolean;
    /** ground units: smoothed speed ratio, and since when it has been near zero */
    speed: number;
    stillSince: number;
    lastDrive: number;
}

function stateOf(proxy: Object3D): SkinAnimState {
    let s = proxy.userData.skinAnim as SkinAnimState | undefined;
    if (!s) {
        const seed = Math.random();
        s = {
            a: idlePlay(seed),
            b: null,
            fadeStart: -1e9,
            dying: false,
            seed,
            walking: false,
            holding: false,
            speed: 0,
            stillSince: -1,
            lastDrive: skinTime.value,
        };
        proxy.userData.skinAnim = s;
    }
    return s;
}

/** A fresh idle loop at a per-mech offset (the shader wraps the phase into the clip). */
function idlePlay(seed: number): ClipPlay {
    return { role: 'idle', phase0: seed * 16, anchor: skinTime.value, rate: 1 };
}

function clipSeconds(p: ClipPlay, t: number): number {
    return p.phase0 + (t - p.anchor) * p.rate;
}

/** Start `role` now, cross-fading from whatever played before. */
function crossTo(s: SkinAnimState, role: SkinRole, phase0: number, rate: number): void {
    const t = skinTime.value;
    s.b = s.a;
    s.a = { role, phase0, anchor: t, rate };
    s.fadeStart = t;
}

/** Mark a proxy as GPU-skinned (instance pools read its clip state each frame). */
export function registerInstancedSkinProxy(proxy: Object3D): void {
    proxy.userData.instancedSkin = true;
    stateOf(proxy);
}

/**
 * Loop `walk` or `idle` at `rate` × the clip's authored speed. Changing only the
 * rate keeps the current phase, so a wingbeat never jumps. A one-shot (fire)
 * finishes first; a dead mech ignores loops.
 */
export function playInstancedSkinLoop(proxy: Object3D, role: LoopRole, rate: number, skin: InstancedSkinData): void {
    const s = stateOf(proxy);
    if (s.dying || s.holding) return;
    const clip = skin.clips[role];
    if (!clip) return;
    const t = skinTime.value;
    const r = rate * clip.speed;
    const cur = skin.clips[s.a.role];
    if (cur && !cur.loop && clipSeconds(s.a, t) < cur.duration) return; // let the one-shot land
    if (s.a.role === role) {
        if (Math.abs(s.a.rate - r) > 1e-4) {
            s.a.phase0 = clipSeconds(s.a, t);
            s.a.anchor = t;
            s.a.rate = r;
        }
        return;
    }
    crossTo(s, role, s.seed * clip.duration, r);
}

/**
 * Play `fire` or `death` once (death holds its last frame). `phase`: clip seconds to
 * start at — negative holds the first frame that long (the shader clamps one-shots).
 */
export function playInstancedSkinOnce(proxy: Object3D, role: 'fire' | 'death', skin: InstancedSkinData, phase = 0): void {
    if (!proxy.userData.instancedSkin) return;
    const s = stateOf(proxy);
    if (s.dying) return;
    const clip = skin.clips[role];
    if (!clip) return;
    if (role === 'death') s.dying = true;
    crossTo(s, role, phase, clip.speed);
}

/**
 * Dead without a death clip (crushed flat, or a model that has none): hold the
 * current pose. No-op when a death clip is already playing.
 */
export function freezeInstancedSkin(proxy: Object3D): void {
    if (!proxy.userData.instancedSkin) return;
    const s = stateOf(proxy);
    if (s.dying) return;
    s.dying = true;
    const t = skinTime.value;
    s.a = { ...s.a, phase0: clipSeconds(s.a, t), anchor: t, rate: 0 };
    s.b = null;
    s.fadeStart = -1e9;
}

/**
 * Start the fire clip so its blow (`hitAt`) lands `secondsUntilHit` from now: begun
 * partway in when there is less time than the wind-up, held on its first frame when
 * there is more. Without a hitAt it just starts from the top, as before.
 */
export function playInstancedSkinFire(proxy: Object3D, skin: InstancedSkinData, secondsUntilHit: number): void {
    const clip = skin.clips.fire;
    const phase = clip && skin.fireLead > 0 ? (skin.fireLead - Math.max(0, secondsUntilHit)) * clip.speed : 0;
    playInstancedSkinOnce(proxy, 'fire', skin, phase);
}

/**
 * A held beam (conversion ray, prism beam): when it switches on, play the fire clip from
 * its cast moment and keep its last pose for as long as the beam lasts; when it ends,
 * walk / idle take over again. No-op without a fire clip.
 */
export function holdInstancedSkinBeam(proxy: Object3D, skin: InstancedSkinData, active: boolean): void {
    if (!proxy.userData.instancedSkin || !skin.clips.fire) return;
    const s = stateOf(proxy);
    if (active === s.holding) return;
    if (active) {
        playInstancedSkinFire(proxy, skin, 0);
        s.holding = true;
    } else {
        s.holding = false;
    }
}

/** Round reset / revive: straight back to idle, no fade (flyers' drivers then ground it). */
export function resetInstancedSkin(proxy: Object3D): void {
    if (!proxy.userData.instancedSkin) return;
    const s = stateOf(proxy);
    s.dying = false;
    s.walking = false;
    s.holding = false;
    s.a = idlePlay(s.seed);
    s.b = null;
    s.fadeStart = -1e9;
}

/**
 * Ground locomotion: walk as soon as the unit really travels — a slow shuffle in
 * a scrum included, or it glides in its idle pose — idle when it stands.
 * Playback follows the real speed: `speedRatio` is ground speed / UnitType.speed,
 * up to 2× like the mixer path, so feet keep pace with the ground.
 */
export function driveGroundSkin(
    proxy: Object3D,
    input: { dead?: boolean; moving: number; speedRatio?: number; airborne?: boolean },
    skin: InstancedSkinData,
): void {
    if (!proxy.userData.instancedSkin || input.dead) return;
    const s = stateOf(proxy);
    // The sim steps at 16 Hz and a unit in a crowd often holds still for a single
    // step: ease the speed (fast up, slower down) and only stand after a real
    // pause, or the run drops to idle and restarts every time it is jostled.
    const t = skinTime.value;
    const dt = Math.min(0.1, Math.max(0, t - s.lastDrive));
    s.lastDrive = t;
    const raw = Math.min(2, input.speedRatio ?? input.moving);
    s.speed += (raw - s.speed) * Math.min(1, (raw > s.speed ? 14 : 6) * dt);
    if (raw > 0.1) {
        s.walking = true;
        s.stillSince = -1;
    } else if (s.walking && raw < 0.05) {
        if (s.stillSince < 0) s.stillSince = t;
        if (t - s.stillSince > STAND_AFTER_SECONDS) s.walking = false;
    }
    const ratio = Math.min(2, Math.max(0.35, s.speed));
    // lifted into the air (Sky Lift) with a fly clip: run on air instead of walking
    if (s.walking) playInstancedSkinLoop(proxy, input.airborne && skin.clips.fly ? 'fly' : 'walk', ratio, skin);
    else playInstancedSkinLoop(proxy, 'idle', 1, skin);
}

/**
 * Flyer locomotion from the same inputs the wing-flap shader used: grounded →
 * still idle pose, hovering → idle loop, moving → walk (flight) loop.
 */
export function driveFlyerSkin(proxy: Object3D, input: CrowWingRateInput, skin: InstancedSkinData): void {
    if (!proxy.userData.instancedSkin || input.dead) return;
    const s = stateOf(proxy);
    if (computeCrowWingRate(input) <= 0) {
        s.walking = false;
        playInstancedSkinLoop(proxy, 'idle', 0, skin);
        return;
    }
    const lift = Math.min(1, Math.max(input.flightLift, (input.altitude ?? 0) > 0 ? 1 : 0));
    s.walking = s.walking ? input.moving > 0.2 : input.moving > 0.4;
    playInstancedSkinLoop(proxy, s.walking ? 'walk' : 'idle', Math.max(0.35, lift), skin);
}

// ── instance attributes ───────────────────────────────────────────────────────

const A_ATTR = 'aSkinA';
const B_ATTR = 'aSkinB';
const FADE_ATTR = 'aSkinFade';

export function setupInstancedSkinAttributes(mesh: InstancedMesh, capacity: number): void {
    for (const [name, size] of [[A_ATTR, 4], [B_ATTR, 4], [FADE_ATTR, 1]] as const) {
        const attr = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
        attr.setUsage(DynamicDrawUsage);
        mesh.geometry.setAttribute(name, attr);
    }
}

function packClip(p: ClipPlay | null, skin: InstancedSkinData, out: number[]): void {
    const clip = p ? skin.clips[p.role] : undefined;
    if (!p || !clip) {
        out[0] = out[1] = out[2] = out[3] = 0;
        return;
    }
    const packed = clip.row * ROW_PACK + clip.frames;
    // rounded like the Float32Array will store them, so unchanged state compares equal
    out[0] = clip.loop ? packed : -packed;
    out[1] = Math.fround(p.phase0);
    out[2] = Math.fround(p.anchor);
    out[3] = Math.fround(p.rate);
}

const _a = [0, 0, 0, 0];
const _b = [0, 0, 0, 0];

/**
 * Write one proxy's clip state into instance slot `index`. Returns true when
 * anything changed (the caller flags the attributes for upload).
 */
export function writeInstancedSkin(mesh: InstancedMesh, index: number, proxy: Object3D, skin: InstancedSkinData): boolean {
    const s = stateOf(proxy);
    packClip(s.a, skin, _a);
    packClip(s.b, skin, _b);
    const a = mesh.geometry.getAttribute(A_ATTR) as InstancedBufferAttribute;
    const b = mesh.geometry.getAttribute(B_ATTR) as InstancedBufferAttribute;
    const fade = mesh.geometry.getAttribute(FADE_ATTR) as InstancedBufferAttribute;
    const av = a.array as Float32Array;
    const bv = b.array as Float32Array;
    const fv = fade.array as Float32Array;
    const o = index * 4;
    const fadeStart = Math.fround(s.fadeStart);
    let changed = fv[index] !== fadeStart;
    for (let k = 0; k < 4; k++) {
        if (av[o + k] !== _a[k] || bv[o + k] !== _b[k]) changed = true;
    }
    if (!changed) return false;
    av.set(_a, o);
    bv.set(_b, o);
    fv[index] = fadeStart;
    return true;
}

export function flagInstancedSkinUpload(mesh: InstancedMesh): void {
    for (const name of [A_ATTR, B_ATTR, FADE_ATTR]) mesh.geometry.getAttribute(name).needsUpdate = true;
}

// ── CPU side: stuck arrows ride a bone ───────────────────────────────────────

const _m0 = new Matrix4();
const _m1 = new Matrix4();
const _mB = new Matrix4();

/** One baked bone matrix of `play` at time `t`, frames lerped like the shader does. */
function clipBone(skin: InstancedSkinData, play: ClipPlay, bone: number, t: number, out: Matrix4): Matrix4 {
    const clip = skin.clips[play.role];
    if (!clip) return out.identity();
    let f = clipSeconds(play, t) * BAKE_FPS;
    f = clip.loop ? ((f % (clip.frames - 1)) + (clip.frames - 1)) % (clip.frames - 1) : Math.min(Math.max(f, 0), clip.frames - 1);
    const f0 = Math.floor(f);
    const f1 = Math.min(f0 + 1, clip.frames - 1);
    const a = f - f0;
    const data = skin.texture.image.data as Float32Array;
    const width = skin.bones * 4;
    _m0.fromArray(data, ((clip.row + f0) * width + bone * 4) * 4);
    _m1.fromArray(data, ((clip.row + f1) * width + bone * 4) * 4);
    for (let k = 0; k < 16; k++) out.elements[k] = _m0.elements[k]! * (1 - a) + _m1.elements[k]! * a;
    return out;
}

/** The bone's current skinning matrix for one mech (cross-fade included), proxy-local. */
function boneNow(skin: InstancedSkinData, s: SkinAnimState, bone: number, out: Matrix4): Matrix4 {
    const t = skinTime.value;
    clipBone(skin, s.a, bone, t, out);
    const k = Math.min(1, Math.max(0, (t - s.fadeStart) / FADE_SECONDS));
    if (k < 1 && s.b) {
        clipBone(skin, s.b, bone, t, _mB);
        for (let i = 0; i < 16; i++) out.elements[i] = out.elements[i]! * k + _mB.elements[i]! * (1 - k);
    }
    return out;
}

/** Live bone followers (proxy children) that {@link updateInstancedSkinBones} keeps posed. */
const followers = new Set<Object3D>();
const _v = new Vector3();
const _best = new Vector3();
const _skin = new Matrix4();
/** at most this many vertices are tested per hit */
const PICK_SAMPLES = 1500;

/**
 * The bone a stuck arrow should ride on a GPU-skinned mech: the dominant bone of
 * the posed vertex nearest `worldPoint`, as a child of the proxy that follows that
 * bone every frame — so shafts fall with a death clip instead of hanging where
 * the unit stood. Null when the proxy isn't GPU-skinned.
 */
export function instancedSkinBoneAt(proxy: Object3D, worldPoint: Vector3, skin: InstancedSkinData): Object3D | null {
    if (!proxy.userData.instancedSkin) return null;
    const s = stateOf(proxy);
    const pos = skin.geometry.getAttribute('position');
    const idx = skin.geometry.getAttribute('skinIndex');
    const wts = skin.geometry.getAttribute('skinWeight');
    if (!pos || !idx || !wts) return null;
    proxy.updateMatrixWorld(true);
    const step = Math.max(1, Math.floor(pos.count / PICK_SAMPLES));
    let bestD = Infinity;
    let bestI = -1;
    for (let i = 0; i < pos.count; i += step) {
        _best.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
            const w = wts.getComponent(i, k);
            if (w <= 0) continue;
            boneNow(skin, s, idx.getComponent(i, k), _skin);
            _v.fromBufferAttribute(pos, i).applyMatrix4(_skin).multiplyScalar(w);
            _best.add(_v);
        }
        const d = _best.applyMatrix4(proxy.matrixWorld).distanceToSquared(worldPoint);
        if (d < bestD) {
            bestD = d;
            bestI = i;
        }
    }
    if (bestI < 0) return null;
    let bone = 0;
    let top = -1;
    for (let k = 0; k < 4; k++) {
        const w = wts.getComponent(bestI, k);
        if (w > top) {
            top = w;
            bone = idx.getComponent(bestI, k);
        }
    }
    const byBone = (proxy.userData.skinBones ??= {}) as Record<number, Object3D>;
    let f = byBone[bone];
    if (!f) {
        f = new Object3D();
        f.name = `skinBone${bone}`;
        f.matrixAutoUpdate = false;
        f.userData.skinBone = { bone, skin };
        proxy.add(f);
        byBone[bone] = f;
        followers.add(f);
    }
    boneNow(skin, s, bone, f.matrix);
    f.updateMatrixWorld(true);
    return f;
}

const _attack = new Matrix4();

/**
 * Where a GPU-skinned mech's AttackNode is right now (world) — follows the bone
 * through its clips, e.g. the wizard's staff tip while he twirls. Render-only:
 * the sim keeps its fixed, measured muzzle. Null when the model has none.
 */
export function instancedSkinAttackWorld(proxy: Object3D, skin: InstancedSkinData, out: Vector3): Vector3 | null {
    if (!skin.attack || !proxy.userData.instancedSkin) return null;
    boneNow(skin, stateOf(proxy), skin.attack.bone, _attack);
    proxy.updateWorldMatrix(true, false);
    return out.copy(skin.attack.point).applyMatrix4(_attack).applyMatrix4(proxy.matrixWorld);
}

/** Pose every bone follower for this frame (after the skin clock advanced). */
function updateInstancedSkinBones(): void {
    for (const f of followers) {
        const proxy = f.parent;
        if (!proxy) {
            followers.delete(f);
            continue;
        }
        const { bone, skin } = f.userData.skinBone as { bone: number; skin: InstancedSkinData };
        boneNow(skin, stateOf(proxy), bone, f.matrix);
        f.matrixWorldNeedsUpdate = true;
    }
}
