// Rig + animate the static six-legged spider: the mesh node's transform is baked into
// the vertices, a skeleton is placed from the geometry (body, abdomen, two fangs, an
// upper + lower bone per leg), vertices are weighted along each leg by geodesic
// distance from its foot (the legs only meet the body at the hip, so weights cannot
// bleed into a neighbour or the abdomen), and walk (tripod gait), idle, fire (rear up +
// strike) and death (rolls onto its back, legs curl) are keyframed — like glb-rig-bat.mjs.
//   node scripts/glb-rig-spider.mjs assets/models/units/spider.glb out.glb
// Model space as baked: head toward +X, legs splayed along ±Z, feet at y = 0.
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

// 2. topology: weld split vertices (uv/normal seams), edge graph, islands
const weld = new Int32Array(count);
{
    const key = new Map();
    for (let i = 0; i < count; i++) {
        const k = [0, 1, 2].map((j) => Math.round(P[i * 3 + j] * 1e4)).join(',');
        if (!key.has(k)) key.set(k, i);
        weld[i] = key.get(k);
    }
}
const idx = prim.getIndices().getArray();
const adj = Array.from({ length: count }, () => new Set());
const island = new Int32Array(count).map((_, i) => i);
const find = (x) => { while (island[x] !== x) x = island[x] = island[island[x]]; return x; };
for (let t = 0; t < idx.length; t += 3) {
    const tri = [weld[idx[t]], weld[idx[t + 1]], weld[idx[t + 2]]];
    for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3];
        adj[a].add(b); adj[b].add(a);
        island[find(a)] = find(b);
    }
}
const islandSize = new Map();
for (let i = 0; i < count; i++) islandSize.set(find(weld[i]), (islandSize.get(find(weld[i])) ?? 0) + 1);
const mainIsland = [...islandSize].sort((a, b) => b[1] - a[1])[0][0];

// 3. feet: vertex clusters on the ground, three per side
let yMin = Infinity;
for (let i = 0; i < count; i++) yMin = Math.min(yMin, P[i * 3 + 1]);
const clusters = [];
for (let i = 0; i < count; i++) {
    if (P[i * 3 + 1] > yMin + 0.06) continue;
    const p = at(i);
    const c = clusters.find((c) => Math.hypot(c.x - p.x, c.z - p.z) < 0.1);
    if (c) c.verts.push(i); else clusters.push({ x: p.x, z: p.z, verts: [i] });
}
if (clusters.length !== 6) throw new Error(`expected 6 feet, found ${clusters.length}`);
// left = −Z when facing +X with +Y up; 1 = back … 3 = front
const legs = ['L', 'R'].flatMap((side) => clusters
    .filter((c) => (side === 'L' ? c.z < 0 : c.z > 0))
    .sort((a, b) => a.x - b.x)
    .map((c, k) => ({ name: `${side}${k + 1}`, side: side === 'L' ? -1 : 1, k: k + 1, feet: c.verts })));

// geodesic distance from each foot over the mesh surface
for (const leg of legs) {
    const dist = new Float64Array(count).fill(Infinity);
    const heap = [];
    const push = (d, u) => { heap.push([d, u]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const f of leg.feet) { dist[weld[f]] = 0; push(0, weld[f]); }
    while (heap.length) {
        const [d, u] = pop();
        if (d > dist[u]) continue;
        for (const w of adj[u]) {
            const nd = d + at(u).distanceTo(at(w));
            if (nd < dist[w]) { dist[w] = nd; push(nd, w); }
        }
    }
    leg.g = (i) => dist[weld[i]];
}
// each vertex belongs to its geodesically nearest leg
const nearest = new Int32Array(count);
const gOf = new Float64Array(count);
for (let i = 0; i < count; i++) {
    let best = 0;
    legs.forEach((l, k) => { if (l.g(i) < legs[best].g(i)) best = k; });
    nearest[i] = best;
    gOf[i] = legs[best].g(i);
}
// joint positions: centroids of a leg's geodesic band (measured: knee ≈ 0.4, hip ≈ 0.56)
const KNEE_G = 0.4, HIP_G = 0.56;
const band = (k, lo, hi) => {
    const c = new Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) if (nearest[i] === k && gOf[i] >= lo && gOf[i] < hi) { c.add(at(i)); n++; }
    if (!n) throw new Error(`leg ${legs[k].name}: empty band ${lo}–${hi}`);
    return c.divideScalar(n);
};
legs.forEach((leg, k) => {
    leg.foot = band(k, 0, 0.08);
    leg.knee = band(k, KNEE_G - 0.05, KNEE_G + 0.05);
    leg.hip = band(k, HIP_G - 0.06, HIP_G + 0.04);
});

// body: cephalothorax (Root) in front of the petiole, abdomen behind it, fangs = the small islands
const legW = (g) => 1 - smooth(HIP_G - 0.04, HIP_G + 0.1, g);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PETIOLE_X = -0.02;
const abdomenW = (x) => 1 - smooth(PETIOLE_X - 0.08, PETIOLE_X + 0.04, x);
const centroid = (pred) => {
    const c = new Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) if (pred(i)) { c.add(at(i)); n++; }
    return c.divideScalar(n);
};
const bodyVert = (i) => find(weld[i]) === mainIsland && legW(gOf[i]) < 0.01;
const thorax = centroid((i) => bodyVert(i) && P[i * 3] > PETIOLE_X);
const abdomenC = centroid((i) => bodyVert(i) && P[i * 3] < PETIOLE_X - 0.1);
const petiole = new Vector3(PETIOLE_X, (thorax.y + abdomenC.y) / 2, 0);
const fangs = [-1, 1].map((side) => {
    const isFang = (i) => find(weld[i]) !== mainIsland && Math.sign(P[i * 3 + 2]) === side;
    let top = -Infinity;
    for (let i = 0; i < count; i++) if (isFang(i)) top = Math.max(top, P[i * 3 + 1]);
    return { side, isFang, pivot: centroid((i) => isFang(i) && P[i * 3 + 1] > top - 0.03) };
});

// 4. skeleton
const defs = [
    ['Root', null, thorax],
    ['Abdomen', 'Root', petiole],
    ['L_Fang', 'Root', fangs[0].pivot], ['R_Fang', 'Root', fangs[1].pivot],
    ...legs.flatMap((l) => [[`${l.name}_Upper`, 'Root', l.hip], [`${l.name}_Lower`, `${l.name}_Upper`, l.knee]]),
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
const names = defs.map((d) => d[0]);
const J = new Uint16Array(count * 4);
const Wt = new Float32Array(count * 4);
for (let i = 0; i < count; i++) {
    const w = new Map();
    const add = (b, x) => { if (x > 1e-4) w.set(names.indexOf(b), (w.get(names.indexOf(b)) ?? 0) + x); };
    const fang = fangs.find((f) => f.isFang(i));
    if (fang) add(fang.side < 0 ? 'L_Fang' : 'R_Fang', 1);
    else {
        const leg = legs[nearest[i]];
        const lw = legW(gOf[i]);
        const lower = 1 - smooth(KNEE_G - 0.06, KNEE_G + 0.06, gOf[i]);
        add(`${leg.name}_Lower`, lw * lower);
        add(`${leg.name}_Upper`, lw * (1 - lower));
        const ab = abdomenW(P[i * 3]);
        add('Abdomen', (1 - lw) * ab);
        add('Root', (1 - lw) * (1 - ab));
    }
    const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0);
    top.forEach(([b, x], k) => { J[i * 4 + k] = b; Wt[i * 4 + k] = x / sum; });
}
prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt).setBuffer(buffer));
const skin = doc.createSkin('SpiderRig').setSkeleton(joints.get('Root'));
const ibm = new Float32Array(defs.length * 16);
defs.forEach(([name, , p], k) => {
    skin.addJoint(joints.get(name));
    new Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, k * 16);
});
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
meshNode.setSkin(skin);

// 5. clips — all rest rotations are identity, so a world-axis rotation IS the local rotation
const q = new Quaternion();
const rot = (ax, ang) => q.clone().setFromAxisAngle(ax, ang);
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
// per leg: the axis that raises it, and the yaw sign that swings its foot forward (+X)
for (const leg of legs) {
    const out = leg.foot.clone().sub(leg.hip).setY(0).normalize();
    leg.liftAxis = new Vector3().crossVectors(out, UP).normalize();
    if (leg.knee.clone().sub(leg.hip).applyQuaternion(rot(leg.liftAxis, 0.1)).y < leg.knee.y - leg.hip.y) leg.liftAxis.negate();
    leg.fwd = leg.foot.clone().sub(leg.hip).applyQuaternion(rot(UP, 0.1)).x > leg.foot.x - leg.hip.x ? 1 : -1;
}
// one leg's pose: `swing` −1…1 (back…forward), `lift` raises at the hip, `reach` opens the knee (− curls)
const legPose = (out, leg, swing, lift, reach = 0) => {
    out.set(`${leg.name}_Upper`, { r: rot(UP, leg.fwd * swing * 0.32).multiply(rot(leg.liftAxis, lift)) });
    out.set(`${leg.name}_Lower`, { r: rot(leg.liftAxis, reach) });
};
// Root about a world pivot: rotation R, translated so `pivot` stays put, plus an offset
const rootPose = (out, R, pivot, offset = new Vector3()) => {
    const t = thorax.clone().sub(pivot).applyQuaternion(R).add(pivot).add(offset);
    out.set('Root', { r: R, t });
};
const FPS = 60;
function clip(name, duration, sample, fps = FPS) {
    const frames = Math.max(24, Math.round(duration * fps) + 1);
    const times = new Float32Array(frames).map((_, f) => (f / (frames - 1)) * duration);
    const tracks = new Map();
    for (let f = 0; f < frames; f++) {
        const out = new Map();
        sample(f / (frames - 1), out);
        for (const [b, { r, t }] of out) {
            if (!tracks.has(b)) tracks.set(b, { r: new Float32Array(frames * 4), t: t ? new Float32Array(frames * 3) : null });
            tracks.get(b).r.set(r.toArray(), f * 4);
            if (t) tracks.get(b).t.set(t.toArray(), f * 3);
        }
    }
    const anim = doc.createAnimation(name);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    const channel = (b, path, type, arr) => {
        const output = doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(b)).setTargetPath(path).setSampler(sampler));
    };
    for (const [b, { r, t }] of tracks) {
        channel(b, 'rotation', 'VEC4', r);
        if (t) channel(b, 'translation', 'VEC3', t);
    }
    console.log(`${name}: ${duration}s, ${frames} keys, ${tracks.size} bones`);
}
const TAU = Math.PI * 2;
const fangPose = (out, open) => {
    // fangs spread sideways (about X) and tip forward (about Z)
    for (const f of fangs) out.set(f.side < 0 ? 'L_Fang' : 'R_Fang', { r: rot(X, -f.side * open * 0.5).multiply(rot(Z, open * 0.4)) });
};
const ground = new Vector3(thorax.x, 0, 0);

// walk: alternating tripod (L1 R2 L3 | R1 L2 R3), half the cycle on the ground sweeping
// back, half in the air swinging forward; the front legs lead slightly (metachronal)
const tripod = (leg) => ((leg.k + (leg.side < 0 ? 0 : 1)) % 2) * 0.5 + (3 - leg.k) * 0.04;
clip('walk', 0.45, (u, out) => {
    for (const leg of legs) {
        const p = (((u + tripod(leg)) % 1) + 1) % 1;
        const stance = p < 0.5;
        const swing = stance ? 1 - 4 * p : -Math.cos(((p - 0.5) / 0.5) * Math.PI);
        const lift = stance ? 0 : Math.sin(((p - 0.5) / 0.5) * Math.PI);
        legPose(out, leg, swing, 0.42 * lift, 0.12 * lift);
    }
    // the body bobs and rocks twice a cycle (each tripod's push)
    rootPose(out, rot(X, 0.035 * Math.sin(u * TAU * 2)), thorax, new Vector3(0, 0.012 * Math.cos(u * TAU * 2), 0));
    out.set('Abdomen', { r: rot(UP, 0.06 * Math.sin(u * TAU)) });
    fangPose(out, 0.1 + 0.1 * Math.sin(u * TAU * 2));
});
// idle: breathing abdomen, fangs working, each front leg taps once
clip('idle', 3, (u, out) => {
    const breathe = Math.sin(u * TAU);
    for (const leg of legs) {
        const tapAt = leg.k === 3 ? (leg.side < 0 ? 0.2 : 0.62) : -1;
        const tap = tapAt < 0 ? 0 : Math.max(0, Math.sin(Math.min(1, Math.max(0, (u - tapAt) / 0.12)) * Math.PI));
        legPose(out, leg, 0.15 * tap, 0.3 * tap, 0.1 * tap);
    }
    rootPose(out, new Quaternion(), thorax, new Vector3(0, 0.008 * breathe, 0));
    out.set('Abdomen', { r: rot(Z, 0.05 * breathe).multiply(rot(UP, 0.04 * Math.sin(u * TAU * 2))) });
    fangPose(out, 0.15 + 0.15 * Math.max(0, Math.sin(u * TAU * 3)));
}, 20); // slow — 20 keys/s keeps the file small
// fire: rears up on the back legs, front legs and fangs raised, then strikes down (hit ≈ 0.48 s)
clip('fire', 0.8, (u, out) => {
    const rear = smooth(0, 0.45, u) * (1 - smooth(0.5, 0.62, u));
    const strike = smooth(0.5, 0.6, u) * (1 - smooth(0.72, 1, u));
    const pitch = 0.42 * rear - 0.12 * strike;
    const back = legs.filter((l) => l.k === 1);
    const pivot = new Vector3(back.reduce((s, l) => s + l.foot.x, 0) / back.length, 0, 0);
    rootPose(out, rot(Z, pitch), pivot);
    for (const leg of legs) {
        // back legs hold the ground (counter-rotate the pitch), front legs claw up then slam
        if (leg.k === 1) legPose(out, leg, -0.3 * rear, -0.15 * rear, 0.25 * rear);
        else if (leg.k === 2) legPose(out, leg, 0.2 * rear, 0.1 * rear, 0.1 * rear);
        else legPose(out, leg, 0.6 * rear + 0.4 * strike, 0.7 * rear - 0.2 * strike, 0.5 * rear);
    }
    out.set('Abdomen', { r: rot(Z, -0.25 * rear + 0.1 * strike) });
    fangPose(out, 1.1 * rear - 0.3 * strike);
});
// death: a twitch, then it rolls onto its back toward −Z (fallLocal 0,−1) and the legs curl in
clip('death', 1.1, (u, out) => {
    const twitch = Math.sin(u * TAU * 4) * (1 - smooth(0.1, 0.4, u));
    const roll = smooth(0.15, 0.6, u);
    const curl = smooth(0.35, 0.95, u);
    // roll about the body axis, lifted so the back (not the head) ends up on the ground
    const pivot = new Vector3(0, 0.39 * roll, 0);
    rootPose(out, rot(X, -Math.PI * roll), pivot, new Vector3(0, 0, -0.25 * roll));
    for (const leg of legs) {
        const jitter = twitch * 0.25 * (leg.k % 2 ? 1 : -1);
        legPose(out, leg, jitter, -0.35 * curl, -1.3 * curl);
    }
    out.set('Abdomen', { r: rot(Z, 0.1 * curl) });
    fangPose(out, -0.2 * curl);
});
await io.write(outFile, doc);
console.log(`rig: thorax (${thorax.toArray().map((x) => x.toFixed(3))}), petiole (${petiole.toArray().map((x) => x.toFixed(3))})`);
for (const l of legs) console.log(`  ${l.name}: hip (${l.hip.toArray().map((x) => x.toFixed(2))}) knee (${l.knee.toArray().map((x) => x.toFixed(2))}) foot (${l.foot.toArray().map((x) => x.toFixed(2))})`);
