// Build an `idle` clip for a rigged biped that has none: the upper body is held
// in a calm frame of another clip (arms down), the legs stay in the rest pose,
// and a slow breathing cycle is layered on top. Written into the GLB beside its
// other clips (then cut/renamed with glb-prep-clips.mjs).
//   node scripts/glb-make-idle.mjs in.glb out.glb '{"from":"walk","upper":["Waist","Spine01",…],
//     "breath":{"Spine01":[1.5,0,0],…},"period":3}'
// `breath` maps a bone to [x, y, z, phase]: peak rotation in degrees about the
// world X/Y/Z axes, and a phase lag in radians (give left/right the same lag).
import { load, pose, duration, qmul } from './glb-sample.mjs';

const [inFile, outFile, specJson] = process.argv.slice(2);
const spec = JSON.parse(specJson);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, deg) => {
    const a = (deg * Math.PI) / 360;
    return [ax[0] * Math.sin(a), ax[1] * Math.sin(a), ax[2] * Math.sin(a), Math.cos(a)];
};

const src = root.listAnimations().find((a) => a.getName().toLowerCase().includes(spec.from));
if (!src) throw new Error(`no clip ${spec.from}`);

// the calm frame: hands level with each other and close to the body
const D = duration(src);
let best = { t: 0, score: Infinity };
for (let t = 0; t <= D; t += 1 / 30) {
    const w = pose(doc, src, t);
    const L = w.get(spec.hands[0]), R = w.get(spec.hands[1]);
    const score = Math.abs(L[2] - R[2]) + Math.abs(L[1] - R[1]);
    if (score < best.score) best = { t, score };
}
console.log(`idle base: ${src.getName()} @ ${best.t.toFixed(2)}s (hand mismatch ${best.score.toFixed(3)})`);

// local rotations of the upper-body bones at that frame
function sampleRot(node, t) {
    for (const ch of src.listChannels()) {
        if (ch.getTargetNode() !== node || ch.getTargetPath() !== 'rotation') continue;
        const s = ch.getSampler();
        const times = s.getInput().getArray(), v = s.getOutput().getArray();
        let i = 0;
        while (i < times.length - 2 && times[i + 1] < t) i++;
        const a = Math.min(1, Math.max(0, (t - times[i]) / (times[i + 1] - times[i])));
        let d = 0;
        for (let k = 0; k < 4; k++) d += v[i * 4 + k] * v[(i + 1) * 4 + k];
        const sg = d < 0 ? -1 : 1;
        const q = [0, 1, 2, 3].map((k) => v[i * 4 + k] * (1 - a) + sg * v[(i + 1) * 4 + k] * a);
        const l = Math.hypot(...q);
        return q.map((x) => x / l);
    }
    return node.getRotation();
}
const worldRot = (n) => {
    let q = [0, 0, 0, 1];
    for (let p = n; p; p = parentOf.get(p)) q = qmul(p.getRotation(), q);
    return q;
};

const FPS = 30;
const frames = Math.round(spec.period * FPS) + 1;
const times = new Float32Array(frames).map((_, f) => (f / (frames - 1)) * spec.period);
const anim = doc.createAnimation('idle');
const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
const bones = new Set([...spec.upper, ...Object.keys(spec.breath)]);
for (const name of bones) {
    const node = byName.get(name);
    if (!node) throw new Error(`no bone ${name}`);
    const base = spec.upper.includes(name) ? sampleRot(node, best.t) : node.getRotation();
    const parent = parentOf.get(node);
    const pw = parent ? worldRot(parent) : [0, 0, 0, 1];
    const peak = spec.breath[name] ?? [0, 0, 0, 0];
    const lag = peak[3] ?? 0;
    const out = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
        const b = Math.sin((f / (frames - 1)) * Math.PI * 2 - lag);
        // world-axis delta expressed in the parent's rest frame, then applied to the base pose
        let d = [0, 0, 0, 1];
        for (const [k, ax] of [[0, [1, 0, 0]], [1, [0, 1, 0]], [2, [0, 0, 1]]]) if (peak[k]) d = qmul(d, qaxis(ax, peak[k] * b));
        out.set(qmul(qmul(qmul(qinv(pw), d), pw), base), f * 4);
    }
    const output = doc.createAccessor().setType('VEC4').setArray(out).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
}
console.log(`idle: ${spec.period}s, ${frames} keys, ${bones.size} bones`);
await io.write(outFile, doc);
