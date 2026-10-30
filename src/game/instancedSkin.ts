import {
    AnimationMixer,
    DataTexture,
    DynamicDrawUsage,
    FloatType,
    InstancedBufferAttribute,
    Matrix4,
    MeshDepthMaterial,
    MeshStandardMaterial,
    NearestFilter,
    RGBADepthPacking,
    RGBAFormat,
    type AnimationClip,
    type BufferGeometry,
    type Group,
    type InstancedMesh,
    type Material,
    type Object3D,
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

export type SkinRole = 'walk' | 'idle' | 'fire' | 'death';
const ROLES: readonly SkinRole[] = ['walk', 'idle', 'fire', 'death'];

/** Bake resolution — clips are linearly interpolated between frames. */
const BAKE_FPS = 30;
/** Seconds to cross-fade from the previous clip into the next. */
const FADE_SECONDS = 0.2;
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
}

/** One shared clock for every skinned pool — advanced with sim-scaled dt. */
const skinTime = { value: 0 };

export function updateInstancedSkinClock(dtSeconds: number): void {
    skinTime.value += dtSeconds;
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
    const out: InstancedSkinData = { texture: null!, clips: {} };
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
            loop: p.role === 'walk' || p.role === 'idle',
            speed: p.speed,
            clip: p.clip,
        };
        row += p.frames;
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    mesh.skeleton.pose();
    root.updateMatrixWorld(true);

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
}

function stateOf(proxy: Object3D): SkinAnimState {
    let s = proxy.userData.skinAnim as SkinAnimState | undefined;
    if (!s) {
        const seed = Math.random();
        s = {
            a: { role: 'idle', phase0: 0, anchor: skinTime.value, rate: 0 },
            b: null,
            fadeStart: -1e9,
            dying: false,
            seed,
            walking: false,
        };
        proxy.userData.skinAnim = s;
    }
    return s;
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
export function playInstancedSkinLoop(proxy: Object3D, role: 'walk' | 'idle', rate: number, skin: InstancedSkinData): void {
    const s = stateOf(proxy);
    if (s.dying) return;
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

/** Play `fire` or `death` once from its start (death holds its last frame). */
export function playInstancedSkinOnce(proxy: Object3D, role: 'fire' | 'death', skin: InstancedSkinData): void {
    if (!proxy.userData.instancedSkin) return;
    const s = stateOf(proxy);
    if (s.dying) return;
    const clip = skin.clips[role];
    if (!clip) return;
    if (role === 'death') s.dying = true;
    crossTo(s, role, 0, clip.speed);
}

/** Round reset / revive: back to a still hover pose, no fade. */
export function resetInstancedSkin(proxy: Object3D): void {
    if (!proxy.userData.instancedSkin) return;
    const s = stateOf(proxy);
    s.dying = false;
    s.walking = false;
    s.a = { role: 'idle', phase0: 0, anchor: skinTime.value, rate: 0 };
    s.b = null;
    s.fadeStart = -1e9;
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
