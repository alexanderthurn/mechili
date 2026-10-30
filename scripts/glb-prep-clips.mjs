// Example (the goblin, from Tripo's run / volleyball / defeat_03 / idle):
//   node scripts/glb-prep-clips.mjs goblin-skeleton.glb out.glb '{"hips":"mixamorig:Hips",
//     "clips":{"walk":{"from":"run","loopFix":0.3},"fire":{"from":"volleyball","start":1.3,"end":2.8},
//     "death":{"from":"defeat_03","start":1.5,"end":3.8}},"idleLoop":{"from":"idle","min":3,"max":6,"loopFix":0.5}}'
// then: python3 scripts/glb-textures-webp.py --quality 80 out.glb && Draco (see compress-glb-draco.sh)
// Turn a Tripo/Mixamo export into game clips: pick a source clip per role, trim
// it to a window, resample at 30 fps, pin the hips' horizontal drift (the sim
// moves the unit), drop constant tracks, and name the result walk/idle/fire/death.
//
// usage: node prep-clips.mjs in.glb out.glb '<json plan>'
// plan: { "hips": "mixamorig:Hips", "clips": { "walk": { "from": "run" }, "fire": { "from": "volleyball", "start": 1.3, "end": 2.8 }, … },
//         "idleLoop": { "from": "idle", "min": 3, "max": 6 } }   // optional: pick the best-matching loop end
import { load, pose, duration, qmul, qrot } from './glb-sample.mjs';

const [inFile, outFile, planJson] = process.argv.slice(2);
const plan = JSON.parse(planJson);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const FPS = 30;
const byName = (n) => root.listAnimations().find((a) => a.getName() === n);

function sampleTrack(times, vals, n, t) {
    if (t <= times[0]) return Array.from(vals.slice(0, n));
    const last = times.length - 1;
    if (t >= times[last]) return Array.from(vals.slice(last * n, last * n + n));
    let i = 0;
    while (times[i + 1] < t) i++;
    const a = (t - times[i]) / (times[i + 1] - times[i]);
    const o = [];
    if (n === 4) {
        let d = 0;
        for (let k = 0; k < 4; k++) d += vals[i * 4 + k] * vals[(i + 1) * 4 + k];
        const s = d < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) o.push(vals[i * 4 + k] * (1 - a) + s * vals[(i + 1) * 4 + k] * a);
        const l = Math.hypot(...o);
        return o.map((v) => v / l);
    }
    for (let k = 0; k < n; k++) o.push(vals[i * n + k] * (1 - a) + vals[(i + 1) * n + k] * a);
    return o;
}

// best loop end for an idle: the frame in [min, max] whose pose is closest to frame 0
if (plan.idleLoop) {
    const src = byName(plan.idleLoop.from);
    const p0 = pose(doc, src, 0);
    let best = { t: plan.idleLoop.max, d: Infinity };
    for (let t = plan.idleLoop.min; t <= Math.min(plan.idleLoop.max, duration(src)); t += 1 / FPS) {
        const p = pose(doc, src, t);
        let d = 0;
        for (const [k, v] of p0) {
            const w = p.get(k);
            d += Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]);
        }
        if (d < best.d) best = { t, d };
    }
    console.log(`idle loop: 0 → ${best.t.toFixed(2)}s (pose mismatch ${best.d.toFixed(4)})`);
    plan.clips.idle = { from: plan.idleLoop.from, start: 0, end: best.t, loopFix: plan.idleLoop.loopFix };
}

const hips = root.listNodes().find((n) => n.getName() === plan.hips);
// The hips' parent may be rotated (Z-up rigs turn the root −90° about X), so pin in
// world space: hold the hips' world X/Z at rest, keep its world height.
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
let hipsParentRot = [0, 0, 0, 1];
for (let p = parentOf.get(hips); p; p = parentOf.get(p)) hipsParentRot = qmul(p.getRotation(), hipsParentRot);
const toWorld = (v) => qrot(hipsParentRot, v);
const toLocal = (v) => qrot([-hipsParentRot[0], -hipsParentRot[1], -hipsParentRot[2], hipsParentRot[3]], v);
const hipsRestWorld = toWorld(hips.getTranslation());
const made = [];
for (const [role, spec] of Object.entries(plan.clips)) {
    const src = byName(spec.from);
    if (!src) throw new Error(`no clip ${spec.from}`);
    const start = spec.start ?? 0;
    const end = spec.end ?? duration(src);
    const frames = Math.max(2, Math.round((end - start) * FPS) + 1);
    const times = new Float32Array(frames);
    for (let f = 0; f < frames; f++) times[f] = (f / (frames - 1)) * (end - start);
    const anim = doc.createAnimation(role);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    let kept = 0;
    let dropped = 0;
    for (const ch of src.listChannels()) {
        const s = ch.getSampler();
        const path = ch.getTargetPath();
        const n = path === 'rotation' ? 4 : 3;
        const inT = s.getInput().getArray();
        const inV = s.getOutput().getArray();
        const out = new Float32Array(frames * n);
        for (let f = 0; f < frames; f++) out.set(sampleTrack(inT, inV, n, start + times[f]), f * n);
        if (spec.loopFix) {
            // ease the tail into frame 0 so the loop closes without a pop
            const tail = Math.min(frames - 1, Math.round(spec.loopFix * FPS));
            for (let f = frames - 1 - tail; f < frames; f++) {
                const u = (f - (frames - 1 - tail)) / tail;
                const w = u * u * (3 - 2 * u);
                let sign = 1;
                if (n === 4) {
                    let d = 0;
                    for (let k = 0; k < 4; k++) d += out[f * 4 + k] * out[k];
                    sign = d < 0 ? -1 : 1;
                }
                for (let k = 0; k < n; k++) out[f * n + k] = out[f * n + k] * (1 - w) + sign * out[k] * w;
                if (n === 4) {
                    const l = Math.hypot(out[f * 4], out[f * 4 + 1], out[f * 4 + 2], out[f * 4 + 3]);
                    for (let k = 0; k < 4; k++) out[f * 4 + k] /= l;
                }
            }
        }
        if (ch.getTargetNode() === hips && path === 'translation') {
            // the sim owns horizontal travel: hold the hips over the feet, keep the bob/fall
            for (let f = 0; f < frames; f++) {
                const w = toWorld([out[f * 3], out[f * 3 + 1], out[f * 3 + 2]]);
                w[0] = hipsRestWorld[0];
                w[2] = hipsRestWorld[2];
                out.set(toLocal(w), f * 3);
            }
        }
        // a track that never moves off the rest value is dead weight
        const restV = path === 'rotation' ? ch.getTargetNode().getRotation() : path === 'scale' ? ch.getTargetNode().getScale() : ch.getTargetNode().getTranslation();
        let still = true;
        for (let f = 0; f < frames && still; f++) for (let k = 0; k < n; k++) if (Math.abs(out[f * n + k] - restV[k]) > 1e-5) { still = false; break; }
        if (still) { dropped++; continue; }
        const output = doc.createAccessor().setType(n === 4 ? 'VEC4' : 'VEC3').setArray(out).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(path).setSampler(sampler));
        kept++;
    }
    made.push(anim);
    console.log(`${role} ← ${spec.from} [${start.toFixed(2)}–${end.toFixed(2)}s] ${frames} frames, ${kept} tracks (${dropped} constant dropped)`);
}
// drop the source clips (and the accessors only they used)
for (const a of root.listAnimations()) if (!made.includes(a)) {
    for (const s of a.listSamplers()) { const i = s.getInput(), o = s.getOutput(); s.dispose(); if (o.listParents().length <= 1) o.dispose(); if (i.listParents().length <= 1) i.dispose(); }
    a.dispose();
}
await io.write(outFile, doc);
