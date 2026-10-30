// Author a clip on top of the rig's rest pose (the modeled pose in Tripo exports):
// every listed joint holds its rest rotation plus keyed offsets, eased between keys;
// joints not listed stay at rest. Written into the GLB beside its other clips.
//   node scripts/glb-pose-clip.mjs in.glb out.glb '{"name":"fire","duration":1,
//     "keys":{"mixamorig:Spine2":[[0,[0,0,0]],[0.25,[5,0,0]],[0.6,[0,0,0]]]}}'
// Offsets are degrees about the WORLD X/Y/Z axes (model space, as the GLB faces),
// applied at the joint in its parent's rest frame — so "+5 about X" means the same
// tilt whatever the bone's own axes are.
import { load, qmul } from './glb-sample.mjs';

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
    const h = (deg * Math.PI) / 360;
    return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
};
const worldRot = (n) => {
    let q = [0, 0, 0, 1];
    for (let p = n; p; p = parentOf.get(p)) q = qmul(p.getRotation(), q);
    return q;
};
if (root.listAnimations().some((a) => a.getName() === spec.name)) throw new Error(`clip ${spec.name} exists`);

const FPS = spec.fps ?? 30;
const frames = Math.round(spec.duration * FPS) + 1;
const times = new Float32Array(frames).map((_, f) => (f / (frames - 1)) * spec.duration);
const anim = doc.createAnimation(spec.name);
const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
const ease = (u) => u * u * (3 - 2 * u);
const offsetAt = (keys, t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
        const [t0, a] = keys[i];
        const [t1, b] = keys[i + 1];
        if (t <= t1) {
            const u = ease((t - t0) / (t1 - t0));
            return a.map((v, k) => v + (b[k] - v) * u);
        }
    }
    return keys[keys.length - 1][1];
};
for (const [name, keys] of Object.entries(spec.keys)) {
    const node = byName.get(name);
    if (!node) throw new Error(`no joint ${name}`);
    const parent = parentOf.get(node);
    const pw = parent ? worldRot(parent) : [0, 0, 0, 1];
    const rest = node.getRotation();
    const out = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
        const [x, y, z] = offsetAt(keys, times[f]);
        const d = qmul(qmul(qaxis([1, 0, 0], x), qaxis([0, 1, 0], y)), qaxis([0, 0, 1], z));
        out.set(qmul(qmul(qmul(qinv(pw), d), pw), rest), f * 4);
    }
    const output = doc.createAccessor().setType('VEC4').setArray(out).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
}
console.log(`${spec.name}: ${spec.duration}s, ${frames} keys, ${Object.keys(spec.keys).length} joints (others hold the rest pose)`);
await io.write(outFile, doc);
