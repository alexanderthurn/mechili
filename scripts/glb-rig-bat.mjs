// Rig + animate the static bat: the mesh node's transform is baked into the vertices,
// a small skeleton is placed from the geometry (body, head, three bones per wing),
// vertices are weighted by distance to the bones (soft envelope), and walk (flight
// beat), idle (hover), fire (bite) and death (wings fold) are keyframed — the same
// approach as glb-animate-crow.mjs, for a model nobody rigged.
//   node scripts/glb-rig-bat.mjs assets/models/units/bat.glb out.glb
// Model space as baked: head toward +X, wings spread along ±Z around the body.
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { load } from './glb-sample.mjs';

const [inFile, outFile] = process.argv.slice(2);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];

// 1. bake the node transform into the geometry
const M = new Matrix4().fromArray(meshNode.getWorldMatrix());
const N = new Matrix3().getNormalMatrix(M);
const posAcc = prim.getAttribute('POSITION');
const nrmAcc = prim.getAttribute('NORMAL');
const P = Float32Array.from(posAcc.getArray());
const Nm = nrmAcc ? Float32Array.from(nrmAcc.getArray()) : null;
const v = new Vector3();
for (let i = 0; i < P.length; i += 3) {
    v.fromArray(P, i).applyMatrix4(M).toArray(P, i);
    if (Nm) v.fromArray(Nm, i).applyMatrix3(N).normalize().toArray(Nm, i);
}
posAcc.setArray(P);
if (Nm) nrmAcc.setArray(Nm);
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const count = P.length / 3;
const at = (i) => new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);

// 2. skeleton from the geometry
let zMin = Infinity, zMax = -Infinity, xMin = Infinity, xMax = -Infinity;
for (let i = 0; i < count; i++) {
    zMin = Math.min(zMin, P[i * 3 + 2]); zMax = Math.max(zMax, P[i * 3 + 2]);
    xMin = Math.min(xMin, P[i * 3]); xMax = Math.max(xMax, P[i * 3]);
}
const zc = (zMin + zMax) / 2;
const half = (zMax - zMin) / 2;
// centroid of the vertices in a z-slab (a slice across the wing / body)
const slab = (z0, z1) => {
    const c = new Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) {
        const z = P[i * 3 + 2];
        if (z >= Math.min(z0, z1) && z <= Math.max(z0, z1)) { c.add(at(i)); n++; }
    }
    return n ? c.divideScalar(n) : null;
};
const body = slab(zc - half * 0.12, zc + half * 0.12);
// the body axis: head end (+X) minus tail end, from the central slab's x-extremes
let headP = null, tailP = null;
for (let i = 0; i < count; i++) {
    if (Math.abs(P[i * 3 + 2] - zc) > half * 0.12) continue;
    const p = at(i);
    if (!headP || p.x > headP.x) headP = p;
    if (!tailP || p.x < tailP.x) tailP = p;
}
const axis = headP.clone().sub(tailP).normalize(); // tail → head
const head = body.clone().lerp(headP, 0.6);
const wing = (side) => [0.18, 0.5, 0.82].map((f) => {
    const z = zc + side * half * f;
    return slab(z - half * 0.08, z + half * 0.08) ?? new Vector3(body.x, body.y, z);
});
// left = −Z when facing +X with +Y up
const L = wing(-1), R = wing(1);
const tipL = new Vector3(body.x, body.y, zMin), tipR = new Vector3(body.x, body.y, zMax);
{ const a = slab(zMin, zMin + half * 0.05); if (a) tipL.copy(a); const b = slab(zMax - half * 0.05, zMax); if (b) tipR.copy(b); }

const defs = [
    ['Root', null, body],
    ['Head', 'Root', head],
    ['L_Wing1', 'Root', L[0]], ['L_Wing2', 'L_Wing1', L[1]], ['L_Wing3', 'L_Wing2', L[2]],
    ['R_Wing1', 'Root', R[0]], ['R_Wing2', 'R_Wing1', R[1]], ['R_Wing3', 'R_Wing2', R[2]],
];
const joints = new Map();
const armature = doc.createNode('Armature');
root.listScenes()[0].addChild(armature);
for (const [name, parent, p] of defs) {
    const pp = parent ? defs.find((d) => d[0] === parent)[2] : new Vector3();
    const node = doc.createNode(name).setTranslation(p.clone().sub(pp).toArray());
    (parent ? joints.get(parent) : armature).addChild(node);
    joints.set(name, node);
}
// segments a vertex can belong to (envelope): [bone, from, to, radius]
const segs = [
    ['Root', tailP, head, 0.045], // narrow: the inner membrane belongs to the shoulders
    ['Head', head, headP, 0.05],
    ['L_Wing1', L[0], L[1], 0.07], ['L_Wing2', L[1], L[2], 0.06], ['L_Wing3', L[2], tipL, 0.06],
    ['R_Wing1', R[0], R[1], 0.07], ['R_Wing2', R[1], R[2], 0.06], ['R_Wing3', R[2], tipR, 0.06],
];
const names = defs.map((d) => d[0]);
const segDist = (p, a, b) => {
    const ab = b.clone().sub(a);
    const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    return p.distanceTo(a.clone().addScaledVector(ab, t));
};
const J = new Uint16Array(count * 4);
const Wt = new Float32Array(count * 4);
for (let i = 0; i < count; i++) {
    const p = at(i);
    const scored = segs.map(([b, a, c, r]) => [names.indexOf(b), segDist(p, a, c) / r]);
    const best = Math.min(...scored.map((s) => s[1]));
    const w = scored.map(([b, d]) => [b, Math.exp(-5 * (d - best))]).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = w.reduce((s, x) => s + x[1], 0);
    w.forEach(([b, x], k) => { J[i * 4 + k] = b; Wt[i * 4 + k] = x / sum; });
}
prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt).setBuffer(buffer));
const skin = doc.createSkin('BatRig').setSkeleton(joints.get('Root'));
const ibm = new Float32Array(defs.length * 16);
defs.forEach(([name, , p], k) => {
    skin.addJoint(joints.get(name));
    new Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, k * 16);
});
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
meshNode.setSkin(skin);
// keep the mesh node beside the armature at the scene root (skinned meshes ignore their own transform)

// 3. clips — all rest rotations are identity, so a world-axis rotation IS the local rotation
const q = new Quaternion();
const rot = (ax, ang) => q.clone().setFromAxisAngle(ax, ang);
// which way round `axis` lifts each wing
const lift = (side) => {
    const out = new Vector3(0, 0, side).applyQuaternion(rot(axis, 0.1));
    return out.y > 0 ? 1 : -1;
};
const upL = lift(-1), upR = lift(1);
const lateral = new Vector3(0, 0, 1); // pitch axis (nose up/down)
const FPS = 120; // the 0.2 s beat still gets 24 keys
function clip(name, duration, sample) {
    const frames = Math.round(duration * FPS) + 1;
    const times = new Float32Array(frames).map((_, f) => (f / (frames - 1)) * duration);
    const tracks = new Map();
    for (let f = 0; f < frames; f++) {
        const out = new Map();
        sample(f / (frames - 1), out);
        for (const [b, quat] of out) {
            if (!tracks.has(b)) tracks.set(b, new Float32Array(frames * 4));
            tracks.get(b).set(quat.toArray(), f * 4);
        }
    }
    const anim = doc.createAnimation(name);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    for (const [b, arr] of tracks) {
        const output = doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(b)).setTargetPath('rotation').setSampler(sampler));
    }
    console.log(`${name}: ${duration}s, ${frames} keys, ${tracks.size} bones`);
}
const TAU = Math.PI * 2;
const warp = (p) => p - 0.28 * Math.sin(p); // quick downstroke, slower recovery
// one wing chain: shoulder leads, outer bones lag (whip); `fold` sweeps toward the tail
function beat(out, phi, amp, fold = 0) {
    for (const [side, up] of [[-1, upL], [1, upR]]) {
        const pre = side < 0 ? 'L' : 'R';
        [[1, 0.6, 0], [2, 0.3, 0.5], [3, 0.2, 1.0]].forEach(([k, a, lag]) => {
            const ang = amp * a * Math.sin(warp(phi - lag)) - 0.04 * amp;
            out.set(`${pre}_Wing${k}`, rot(axis, up * ang).multiply(rot(new Vector3(0, 1, 0), -side * fold * (k === 1 ? 1 : 0.5))));
        });
    }
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// walk: the old shader's tempo (31.5 rad/s ≈ 0.2 s), a deep stroke — ~±80° at the tips
clip('walk', 0.2, (u, out) => { beat(out, u * TAU, 1.3); out.set('Head', rot(lateral, 0.06 * Math.sin(u * TAU - 1))); });
// idle: hover — slower, shallower
clip('idle', 0.32, (u, out) => { beat(out, u * TAU, 0.85); out.set('Head', rot(lateral, 0.04 * Math.sin(u * TAU - 1))); });
// fire: head snaps forward-down in a bite while two strong beats hold altitude
clip('fire', 0.4, (u, out) => {
    beat(out, u * TAU * 2, 1.45);
    const bite = smooth(0.25, 0.4, u) * (1 - smooth(0.55, 0.9, u)) - 0.4 * smooth(0, 0.2, u) * (1 - smooth(0.25, 0.35, u));
    out.set('Head', rot(lateral, -0.5 * bite));
});
// death: a twitch, then the wings fold down and back against the body
clip('death', 0.8, (u, out) => {
    const twitch = Math.sin(u * TAU * 3) * 0.3 * (1 - smooth(0.1, 0.5, u));
    const limp = smooth(0.1, 0.7, u);
    for (const [side, up] of [[-1, upL], [1, upR]]) {
        const pre = side < 0 ? 'L' : 'R';
        [[1, 0.9, 0.5], [2, 0.7, 0.4], [3, 0.5, 0.3]].forEach(([k, droop, fold]) => {
            out.set(`${pre}_Wing${k}`, rot(axis, up * (twitch - droop * limp)).multiply(rot(new Vector3(0, 1, 0), -side * fold * limp)));
        });
    }
    out.set('Head', rot(lateral, 0.5 * limp));
});
await io.write(outFile, doc);
console.log(`rig: body (${body.toArray().map((x) => x.toFixed(3))}), axis (${axis.toArray().map((x) => x.toFixed(2))}), half-span ${half.toFixed(3)}`);
