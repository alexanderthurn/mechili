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
/** short clips (a bat's 0.2 s wingbeat) bake denser: at least this many frames, at most 120 fps */
const MIN_CLIP_FRAMES = 24;
const MAX_BAKE_FPS = 120;
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
    /** frames per authored second in the texture (BAKE_FPS, more for short clips) */
    fps: number;
}

export interface InstancedSkinData {
    texture: DataTexture;
    clips: Partial<Record<SkinRole, BakedClip>>;
    /** where the death clip lays the body, holder XZ (rest forward −Z) — see ModelAnimation.death */
    deathFallLocal: { x: number; z: number };
    /** turn the body so the fall follows the killing blow (ModelAnimation.death.turn, default true) */
    deathTurn: boolean;
    /** game seconds from the fire clip's start to its blow (hitAt / speed); 0 = start on the shot */
    fireLead: number;
    /** bone count (texture width / 4) */
    bones: number;
    /** bind-pose skinned geometry — the CPU picks bones under arrow hits from it */
    geometry: BufferGeometry;
    /** AttackNode riding a bone: which bone, and the point in bind (geometry) space — live beam starts */
    attack?: { bone: number; point: Vector3 };
    /** hoofprint feet: the sole of each named bone's geometry, in bind space (ModelSpec.hoofprints) */
    feet?: { bone: number; point: Vector3 }[];
    /** normalized root units per GLB (bind) unit — converts a foot's height back to GLB units */
    rootPerModel?: number;
    /** ground one walk loop covers, in normalized root units (ModelAnimation.walk.stride) */
    walkStride?: number;
    /**
     * Per vertex: 1 where it belongs to a core (thick) bone — torso, abdomen, a horse's
     * barrel — 0 on legs, arms and tips. Ballista bolts only stick there (see
     * {@link measureCoreVertices}). Absent when the mesh gives no clear body.
     */
    coreVertex?: Uint8Array;
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

/** a core bone is at least this thick, as a share of the thickest bone */
const CORE_THICKNESS = 0.4;
/** bones covering less than this share of the surface don't count (eyes, a claw tip) */
const CORE_MIN_AREA = 0.02;

/**
 * Which vertices make the body — the thick parts the big bolts stick in. Each
 * triangle goes to its vertices' dominant bone, weighted by its area (so a densely
 * modelled face counts no more than a smooth back). Per bone, the spread of that
 * surface along its principal axes gives its shape: a leg is long and thin, a torso
 * thick across. A bone is core when its cross-section (the middle axis) is at least
 * {@link CORE_THICKNESS} of the thickest one's. Bind pose, once at load.
 */
function measureCoreVertices(geometry: BufferGeometry): Uint8Array | undefined {
    const pos = geometry.getAttribute('position');
    const idx = geometry.getAttribute('skinIndex');
    const wts = geometry.getAttribute('skinWeight');
    if (!pos || !idx || !wts) return undefined;
    const top = (i: number): number => {
        let k = 0;
        for (let j = 1; j < 4; j++) if (wts.getComponent(i, j) > wts.getComponent(i, k)) k = j;
        return idx.getComponent(i, k);
    };
    const index = geometry.getIndex();
    const tris = index ? index.count / 3 : pos.count / 3;
    const vert = (t: number, c: number) => (index ? index.getX(t * 3 + c) : t * 3 + c);
    // per bone: area, area-weighted sum and second moments of its triangles' centroids
    type Acc = { w: number; s: number[]; m: number[] };
    const acc = new Map<number, Acc>();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let total = 0;
    for (let t = 0; t < tris; t++) {
        const i0 = vert(t, 0);
        const i1 = vert(t, 1);
        const i2 = vert(t, 2);
        a.fromBufferAttribute(pos, i0);
        b.fromBufferAttribute(pos, i1);
        c.fromBufferAttribute(pos, i2);
        const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
        if (!(area > 0)) continue;
        // the triangle's bone: its vertices' dominant bones, by vote (first one on a tie)
        const t0 = top(i0);
        const t1 = top(i1);
        const t2 = top(i2);
        const bone = t1 === t2 ? t1 : t0;
        const x = (a.x + b.x + c.x) / 3;
        const y = (a.y + b.y + c.y) / 3;
        const z = (a.z + b.z + c.z) / 3;
        let e = acc.get(bone);
        if (!e) acc.set(bone, (e = { w: 0, s: [0, 0, 0], m: [0, 0, 0, 0, 0, 0] }));
        e.w += area;
        e.s[0]! += x * area;
        e.s[1]! += y * area;
        e.s[2]! += z * area;
        e.m[0]! += x * x * area;
        e.m[1]! += y * y * area;
        e.m[2]! += z * z * area;
        e.m[3]! += x * y * area;
        e.m[4]! += x * z * area;
        e.m[5]! += y * z * area;
        total += area;
    }
    if (total <= 0) return undefined;
    const thickness = new Map<number, number>();
    for (const [bone, e] of acc) {
        if (e.w < total * CORE_MIN_AREA) continue;
        const mx = e.s[0]! / e.w;
        const my = e.s[1]! / e.w;
        const mz = e.s[2]! / e.w;
        const cov = [
            e.m[0]! / e.w - mx * mx,
            e.m[3]! / e.w - mx * my,
            e.m[4]! / e.w - mx * mz,
            e.m[1]! / e.w - my * my,
            e.m[5]! / e.w - my * mz,
            e.m[2]! / e.w - mz * mz,
        ];
        const eig = symmetricEigenvalues3(cov).sort((p, q) => q - p);
        thickness.set(bone, Math.sqrt(Math.max(0, eig[1]!)));
    }
    let thickest = 0;
    for (const v of thickness.values()) thickest = Math.max(thickest, v);
    if (thickest <= 0) return undefined;
    const core = new Set<number>();
    for (const [bone, v] of thickness) if (v >= thickest * CORE_THICKNESS) core.add(bone);
    const out = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) out[i] = core.has(top(i)) ? 1 : 0;
    return out;
}

/** the body vertices when the model names its body bones (ModelSpec.stickBones) */
function namedCoreVertices(geometry: BufferGeometry, bones: readonly number[]): Uint8Array | undefined {
    const pos = geometry.getAttribute('position');
    const idx = geometry.getAttribute('skinIndex');
    const wts = geometry.getAttribute('skinWeight');
    const core = new Set(bones.filter((b) => b >= 0));
    if (!pos || !idx || !wts || core.size === 0) return undefined;
    const out = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
        let k = 0;
        for (let j = 1; j < 4; j++) if (wts.getComponent(i, j) > wts.getComponent(i, k)) k = j;
        out[i] = core.has(idx.getComponent(i, k)) ? 1 : 0;
    }
    return out;
}

/**
 * Eigenvalues of a symmetric 3×3 matrix given as [xx, xy, xz, yy, yz, zz]
 * (cyclic Jacobi rotations — a handful of sweeps settle it).
 */
function symmetricEigenvalues3(m: readonly number[]): number[] {
    const A = [
        [m[0]!, m[1]!, m[2]!],
        [m[1]!, m[3]!, m[4]!],
        [m[2]!, m[4]!, m[5]!],
    ];
    for (let sweep = 0; sweep < 12; sweep++) {
        let off = 0;
        for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) off += A[p]![q]! * A[p]![q]!;
        if (off < 1e-18) break;
        for (let p = 0; p < 2; p++) {
            for (let q = p + 1; q < 3; q++) {
                const apq = A[p]![q]!;
                if (Math.abs(apq) < 1e-20) continue;
                const theta = (A[q]![q]! - A[p]![p]!) / (2 * apq);
                const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const cs = 1 / Math.sqrt(t * t + 1);
                const sn = t * cs;
                for (let k = 0; k < 3; k++) {
                    const akp = A[k]![p]!;
                    const akq = A[k]![q]!;
                    A[k]![p] = cs * akp - sn * akq;
                    A[k]![q] = sn * akp + cs * akq;
                }
                for (let k = 0; k < 3; k++) {
                    const apk = A[p]![k]!;
                    const aqk = A[q]![k]!;
                    A[p]![k] = cs * apk - sn * aqk;
                    A[q]![k] = sn * apk + cs * aqk;
                }
            }
        }
    }
    return [A[0]![0]!, A[1]![1]!, A[2]![2]!];
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
    feetSpec?: { bones: readonly string[]; track?: boolean },
    /** the body bones by name (ModelSpec.stickBones); absent = measured */
    stickBones?: readonly string[],
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
        const fps = Math.min(MAX_BAKE_FPS, Math.max(BAKE_FPS, (MIN_CLIP_FRAMES - 1) / Math.max(clip.duration, 1e-3)));
        plan.push({ role, clip, speed: spec.speed ?? 1, frames: Math.max(2, Math.round(clip.duration * fps) + 1) });
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
        deathTurn: anim.death?.turn !== false,
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
            fps: (p.frames - 1) / Math.max(p.clip.duration, 1e-6),
        };
        row += p.frames;
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    mesh.skeleton.pose();
    root.updateMatrixWorld(true);
    // the full rest-pose skin transform (bind vertex → root): the normalize scale can sit in
    // the bind matrix or in the bones, so measure the whole chain
    pre.multiplyMatrices(rootInv, mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    m.multiplyMatrices(pre, mesh.skeleton.bones[0]!.matrixWorld).multiply(mesh.skeleton.boneInverses[0]!).multiply(mesh.bindMatrix);
    out.rootPerModel = new Vector3().setFromMatrixColumn(m, 1).length();
    if (anim.walk?.stride) out.walkStride = anim.walk.stride * out.rootPerModel;

    // an AttackNode under a bone moves with it — keep it for live (render-only) muzzles
    const attackNode = root.getObjectByName('AttackNode');
    const attackBone = attackNode?.parent ? mesh.skeleton.bones.indexOf(attackNode.parent as Bone) : -1;
    if (attackNode && attackBone >= 0) {
        const point = attackNode.getWorldPosition(new Vector3()).applyMatrix4(mesh.matrixWorld.clone().invert());
        out.attack = { bone: attackBone, point };
    }
    // feet: the sole of each named bone's own geometry — the lowest vertices it moves;
    // wheels (track): the bone's own centre, the one point a spin doesn't move
    const feetBones = feetSpec?.bones ?? [];
    if (feetBones.length) {
        const pos = mesh.geometry.getAttribute('position');
        const idx = mesh.geometry.getAttribute('skinIndex');
        const wts = mesh.geometry.getAttribute('skinWeight');
        const meshInv = mesh.matrixWorld.clone().invert();
        out.feet = [];
        for (const name of feetBones) {
            const b = mesh.skeleton.bones.findIndex((bone) => bone.name === name);
            if (b >= 0 && feetSpec?.track) {
                out.feet.push({ bone: b, point: mesh.skeleton.bones[b]!.getWorldPosition(new Vector3()).applyMatrix4(meshInv) });
                continue;
            }
            const own: Vector3[] = [];
            if (b >= 0 && pos && idx && wts) {
                for (let i = 0; i < pos.count; i++) {
                    let top = 0;
                    for (let k = 1; k < 4; k++) if (wts.getComponent(i, k) > wts.getComponent(i, top)) top = k;
                    if (idx.getComponent(i, top) === b) own.push(new Vector3().fromBufferAttribute(pos, i));
                }
            }
            if (!own.length) {
                console.warn(`[instancedSkin] hoofprint bone '${name}' moves no vertices`);
                continue;
            }
            // centre of the bottom fifth of the hoof
            own.sort((p, q) => p.y - q.y);
            const sole = own.slice(0, Math.max(1, Math.ceil(own.length / 5)));
            const point = sole.reduce((c, v) => c.add(v), new Vector3()).divideScalar(sole.length);
            out.feet.push({ bone: b, point });
        }
    }

    out.coreVertex = stickBones?.length
        ? namedCoreVertices(mesh.geometry, stickBones.map((name) => mesh.skeleton.bones.findIndex((b) => b.name === name)))
        : measureCoreVertices(mesh.geometry);

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
 * Walk clip rate at full `speed`: a model with a `stride` rolls/steps exactly with the
 * ground (speed × loop seconds / world stride; `scale` = the proxy's — meshScale and its
 * level growth); otherwise the unit's tuned rate (see walkRateAtFullSpeed).
 */
export function skinWalkRate(skin: InstancedSkinData, speed: number, scale: number, tuned: number): number {
    const clip = skin.clips.walk;
    if (!skin.walkStride || !clip) return tuned;
    return (speed * clip.duration) / (skin.walkStride * scale * clip.speed);
}

/**
 * Ground locomotion: walk as soon as the unit really travels — a slow shuffle in
 * a scrum included, or it glides in its idle pose — idle when it stands.
 * Playback follows the real speed: `speedRatio` is ground speed / UnitType.speed,
 * up to 2× like the mixer path, so feet keep pace with the ground.
 */
export function driveGroundSkin(
    proxy: Object3D,
    input: { dead?: boolean; moving: number; speedRatio?: number; airborne?: boolean; rate?: number },
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
    // a tower-debuffed unit crawls at 10% — it still walks (slowly), not glides in idle
    if (raw > 0.06) {
        s.walking = true;
        s.stillSince = -1;
    } else if (s.walking && raw < 0.03) {
        if (s.stillSince < 0) s.stillSince = t;
        if (t - s.stillSince > STAND_AFTER_SECONDS) s.walking = false;
    }
    // legs follow the real speed all the way down (slows, debuffs); the floor only keeps a
    // near-stopped shuffle from freezing mid-stride
    const ratio = Math.min(2, Math.max(0.05, s.speed)) * (input.rate ?? 1);
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
    // the shader counts frames at BAKE_FPS; a clip baked denser scales its phase and rate
    const k = clip.fps / BAKE_FPS;
    // rounded like the Float32Array will store them, so unchanged state compares equal
    out[0] = clip.loop ? packed : -packed;
    out[1] = Math.fround(p.phase0 * k);
    out[2] = Math.fround(p.anchor);
    out[3] = Math.fround(p.rate * k);
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
    let f = clipSeconds(play, t) * clip.fps;
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
/**
 * The bone under a world point on a GPU-skinned mech, as a follower object the
 * shaft can ride. With `coreSeat`, only the body counts ({@link InstancedSkinData.coreVertex}):
 * the nearest body vertex is picked and its world position written to `coreSeat`,
 * so a big bolt that struck a leg sits in the body instead. Without core data
 * `coreSeat` is left untouched.
 */
export function instancedSkinBoneAt(proxy: Object3D, worldPoint: Vector3, skin: InstancedSkinData, coreSeat?: Vector3): Object3D | null {
    if (!proxy.userData.instancedSkin) return null;
    const s = stateOf(proxy);
    const pos = skin.geometry.getAttribute('position');
    const idx = skin.geometry.getAttribute('skinIndex');
    const wts = skin.geometry.getAttribute('skinWeight');
    if (!pos || !idx || !wts) return null;
    proxy.updateMatrixWorld(true);
    const core = coreSeat ? skin.coreVertex : undefined;
    const step = Math.max(1, Math.floor(pos.count / PICK_SAMPLES));
    let bestD = Infinity;
    let bestI = -1;
    for (let i = 0; i < pos.count; i += step) {
        if (core && !core[i]) continue;
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
            if (core) coreSeat!.copy(_best);
        }
    }
    if (bestI < 0) return core ? instancedSkinBoneAt(proxy, worldPoint, skin) : null;
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

/**
 * Foot `i` (see InstancedSkinData.feet) in its live pose: world position into `out`,
 * returns its height above the model's base in GLB units (so thresholds don't depend on
 * how big the unit is drawn). Null when not GPU-skinned. Render-only.
 */
export function instancedSkinFoot(proxy: Object3D, skin: InstancedSkinData, i: number, out: Vector3): number | null {
    const foot = skin.feet?.[i];
    if (!foot || !proxy.userData.instancedSkin) return null;
    boneNow(skin, stateOf(proxy), foot.bone, _attack);
    out.copy(foot.point).applyMatrix4(_attack);
    const h = out.y / (skin.rootPerModel || 1);
    proxy.updateWorldMatrix(true, false);
    out.applyMatrix4(proxy.matrixWorld);
    return h;
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
