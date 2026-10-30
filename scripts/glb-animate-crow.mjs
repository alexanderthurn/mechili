// How the crow rider's clips were authored (keyframed by script on Tripo's rig).
// Kept as the reference for scripting clips on a rig nobody can animate by hand.
//   node scripts/glb-animate-crow.mjs crow-rider-skeleton.glb out.glb

// Author walk / idle / fire clips (engine role names) on the Tripo crow-rider skeleton.
// Model space: +X = crow's right wing, +Y up, +Z forward (beak).
// Every bone keeps its rest rotation; clips add rotations about WORLD axes,
// expressed in the parent's rest frame: local' = Pw⁻¹ · R_world · Pw · local.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const [inFile, outFile] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// --- quaternion helpers [x, y, z, w] ---
const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, ang) => {
    const s = Math.sin(ang / 2);
    return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)];
};
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const worldRot = (n) => {
    let q = [0, 0, 0, 1];
    for (let p = n; p; p = parentOf.get(p)) q = qmul(p.getRotation(), q);
    return q;
};
const bone = (name) => {
    const n = byName.get(name);
    if (!n) throw new Error('missing bone ' + name);
    const p = parentOf.get(n);
    return { node: n, rest: n.getRotation().slice(), restT: n.getTranslation().slice(), pw: p ? worldRot(p) : [0, 0, 0, 1] };
};
const qrot = (q, v) => {
    const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
    return [p[0], p[1], p[2]];
};
/** Local translation for a bone shifted by a world-space offset (parent rest frame). */
const shift = (b, worldOffset) => {
    const d = qrot(qinv(b.pw), worldOffset);
    return [b.restT[0] + d[0], b.restT[1] + d[1], b.restT[2] + d[2]];
};

// --- rig map (see bone survey: wing chains, crow neck, rider, tail, legs) ---
const R = {
    shoulder: bone('tripo::Spine_3'), elbow: bone('bone_14'), wrist: bone('bone_15'), hand: bone('bone_16'), tip: bone('bone_17'),
};
const L = {
    shoulder: bone('bone_22'), elbow: bone('bone_23'), wrist: bone('bone_24'), hand: bone('bone_25'), tip: bone('bone_26'),
};
const neck = bone('bone_9'), head = bone('bone_10'), beak = bone('bone_11');
const rider = bone('bone_30'), riderUpper = bone('tripo::Head_0');
const tail = [bone('bone_34'), bone('bone_35'), bone('bone_36')];
const legs = ['tripo::0_Right_Limb_0', 'tripo::0_Left_Limb_0', 'tripo::0_Right_Limb_1', 'tripo::0_Left_Limb_1'].map(bone);

/** Local rotation for a bone given a world-space delta rotation. */
const pose = (b, worldDelta) => qmul(qmul(qmul(qinv(b.pw), worldDelta), b.pw), b.rest);

/**
 * One wing at stroke phase φ (0..2π, sin > 0 = up). Shoulder leads, each
 * outer joint lags a little more so the tips whip. `sideSign` +1 right, −1 left:
 * raising the right wing is +Z, the left −Z; sweeping back is +Y right, −Y left.
 */
function wing(chain, sideSign, phi, amp, out) {
    // fast downstroke, slower upstroke
    const warp = (p) => p - 0.28 * Math.sin(p);
    const joints = [
        ['shoulder', 0.5, 0.0, 0.16],
        ['elbow', 0.24, 0.45, 0.08],
        ['wrist', 0.2, 0.9, 0.05],
        ['hand', 0.16, 1.3, 0.0],
        ['tip', 0.1, 1.6, 0.0],
    ];
    for (const [name, a, lag, sweep] of joints) {
        const p = warp(phi - lag);
        const lift = amp * a * Math.sin(p) - 0.04 * amp; // dip a hair below the rest line
        const back = amp * sweep * Math.max(0, Math.cos(p)); // fold back on the way up
        const d = qmul(qaxis(Z, sideSign * lift), qaxis(Y, sideSign * back));
        out.set(chain[name], pose(chain[name], d));
    }
}

/** Shared body motion following the wingbeat (tail counter-pitch, dangling legs, rider sway). */
function body(phi, amp, out) {
    tail.forEach((b, i) => out.set(b, pose(b, qaxis(X, -0.05 * amp * Math.sin(phi - 0.6 - i * 0.4)))));
    legs.forEach((b, i) => out.set(b, pose(b, qaxis(X, 0.06 * amp * Math.sin(phi - 1.2 - (i >> 1) * 0.5)))));
    out.set(rider, pose(rider, qaxis(X, 0.025 * amp * Math.sin(phi - 1.0))));
    out.set(neck, pose(neck, qaxis(X, 0.04 * amp * Math.sin(phi - 0.8))));
}

const FPS = 30;
function makeClip(name, duration, sample) {
    const frames = Math.round(duration * FPS);
    const times = new Float32Array(frames + 1);
    const tracks = new Map();
    const ttracks = new Map();
    for (let f = 0; f <= frames; f++) {
        const t = (f / frames) * duration;
        times[f] = t;
        const out = new Map();
        const moves = new Map();
        sample(t / duration, out, moves);
        for (const [b, q] of out) {
            if (!tracks.has(b)) tracks.set(b, new Float32Array((frames + 1) * 4));
            tracks.get(b).set(q, f * 4);
        }
        for (const [b, v] of moves) {
            if (!ttracks.has(b)) ttracks.set(b, new Float32Array((frames + 1) * 3));
            ttracks.get(b).set(v, f * 3);
        }
    }
    const anim = doc.createAnimation(name);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    const add = (b, arr, type, path) => {
        const output = doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        const channel = doc.createAnimationChannel().setTargetNode(b.node).setTargetPath(path).setSampler(sampler);
        anim.addSampler(sampler).addChannel(channel);
    };
    for (const [b, arr] of tracks) add(b, arr, 'VEC4', 'rotation');
    for (const [b, arr] of ttracks) add(b, arr, 'VEC3', 'translation');
    console.log(`${name}: ${duration}s, ${frames + 1} keys, ${tracks.size} bones`);
}

const TAU = Math.PI * 2;
// walk (flight loop): matches the old shader beat (10.5 rad/s ≈ 0.6 s) and ~50° at the tips
makeClip('walk', 0.6, (u, out) => {
    const phi = u * TAU;
    wing(R, 1, phi, 1, out);
    wing(L, -1, phi, 1, out);
    body(phi, 1, out);
});
// idle: lazy hover — a third the beat rate of fly, shallow strokes
makeClip('idle', 1.8, (u, out) => {
    const phi = u * TAU;
    wing(R, 1, phi, 0.6, out);
    wing(L, -1, phi, 0.6, out);
    body(phi, 0.6, out);
});
// fire: rear back, then a hard forward-down peck; one strong beat holds altitude
makeClip('fire', 0.8, (u, out, moves) => {
    const phi = u * TAU;
    wing(R, 1, phi, 1.25, out);
    wing(L, -1, phi, 1.25, out);
    body(phi, 1, out);
    // neck curve: wind-up (head up/back) → strike (down/forward) → settle
    const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const windup = s(0.0, 0.3, u) * (1 - s(0.3, 0.42, u));
    const strike = s(0.32, 0.45, u) * (1 - s(0.6, 1.0, u));
    const pitch = -0.5 * windup + 0.55 * strike; // +X pitch = beak down
    out.set(neck, pose(neck, qaxis(X, pitch * 0.45)));
    out.set(head, pose(head, qaxis(X, pitch * 0.35)));
    out.set(beak, pose(beak, qaxis(X, pitch * 0.25)));
    // pitching alone arcs the beak back toward the body — thrust the neck out
    // so the strike lunges forward (and draws in on the wind-up)
    moves.set(neck, shift(neck, [0, 0.012 * windup - 0.012 * strike, -0.025 * windup + 0.07 * strike]));
    // rider leans into the strike
    out.set(rider, pose(rider, qaxis(X, 0.18 * strike - 0.06 * windup)));
    out.set(riderUpper, pose(riderUpper, qaxis(X, 0.1 * strike)));
});
// death: one convulsive beat up, then the wings go limp — droop and fold back
// at the elbows — head and neck sag, rider slumps, legs and tail hang. The
// last key is a held pose (clampWhenFinished); the game's crash fall owns the descent.
makeClip('death', 1.2, (u, out) => {
    const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const jerk = s(0.0, 0.1, u) * (1 - s(0.12, 0.35, u)); // brief spasm up
    const limp = s(0.15, 0.75, u); // settle into the dead pose
    const flutter = Math.sin(u * TAU * 3) * 0.08 * (1 - s(0.3, 0.8, u)); // dying twitch
    for (const [chain, side] of [[R, 1], [L, -1]]) {
        const joints = [
            // droop curls down joint by joint so the wings roll under the body
            ['shoulder', 0.55, -0.75, 0.15],
            ['elbow', 0.2, -0.6, 0.3],
            ['wrist', 0.1, -0.5, 0.2],
            ['hand', 0.05, -0.4, 0.1],
            ['tip', 0.0, -0.3, 0.0],
        ];
        for (const [name, up, droop, fold] of joints) {
            const lift = up * jerk + droop * limp + flutter * (name === 'shoulder' ? 1 : 0.5);
            const back = fold * limp;
            out.set(chain[name], pose(chain[name], qmul(qaxis(Z, side * lift), qaxis(Y, side * back))));
        }
    }
    out.set(neck, pose(neck, qaxis(X, -0.15 * jerk + 0.45 * limp)));
    out.set(head, pose(head, qaxis(X, -0.1 * jerk + 0.35 * limp)));
    out.set(beak, pose(beak, qaxis(X, 0.15 * limp)));
    out.set(rider, pose(rider, qaxis(X, -0.12 * jerk + 0.45 * limp)));
    out.set(riderUpper, pose(riderUpper, qaxis(X, 0.3 * limp)));
    tail.forEach((b, i) => out.set(b, pose(b, qaxis(X, 0.12 * jerk - 0.1 * limp * (i + 1) * 0.6))));
    legs.forEach((b, i) => out.set(b, pose(b, qaxis(X, 0.35 * limp * (i < 2 ? 1 : 0.6)))));
});

await io.write(outFile, doc);
