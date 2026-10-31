// Rig + animate the static prism cannon (a wheeled gun carriage): the mesh node's
// transform is baked into the vertices, and every mesh island is given to one rigid
// bone — each of the four wheels (rim, spokes, hub: whatever lies inside its disc),
// the barrel, or the carriage. No blended weights: a wheel spins without dragging
// anything along. walk rolls the wheels one full turn (so the loop is seamless),
// idle sits still, fire recoils the barrel and holds, death collapses it where it
// stands (wheels buckle outward, carriage flat on the ground). Like glb-rig-spider.mjs.
//   node scripts/glb-rig-prism.mjs assets/models/units/prismcannon.glb out.glb
// Model space as baked: barrel toward +X, wheels along ±Z, ground at y = 0.
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { load } from './glb-sample.mjs';

const [inFile, outFile] = process.argv.slice(2);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];
const attackNode = root.listNodes().find((n) => n.getName() === 'AttackNode');

// 1. bake the node transform into the geometry (the AttackNode keeps its world spot)
const M = new Matrix4().fromArray(meshNode.getWorldMatrix());
const attackWorld = attackNode ? new Vector3().fromArray(attackNode.getWorldMatrix(), 12) : null;
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

// 2. islands (welded across uv/normal seams)
const idx = prim.getIndices().getArray();
const parent = new Int32Array(count).map((_, i) => i);
const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
{
    const key = new Map();
    for (let i = 0; i < count; i++) {
        const k = [0, 1, 2].map((j) => Math.round(P[i * 3 + j] * 1e4)).join(',');
        if (key.has(k)) parent[find(i)] = find(key.get(k)); else key.set(k, i);
    }
    for (let t = 0; t < idx.length; t += 3) {
        parent[find(idx[t + 1])] = find(idx[t]);
        parent[find(idx[t + 2])] = find(idx[t]);
    }
}
const islands = new Map();
for (let i = 0; i < count; i++) {
    const r = find(i);
    if (!islands.has(r)) islands.set(r, { verts: [], min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) });
    const isl = islands.get(r);
    isl.verts.push(i);
    isl.min.min(at(i));
    isl.max.max(at(i));
}
const all = [...islands.values()];

// 3. wheels: the big rims that touch the ground; centre and radius from their box
const rims = all.filter((s) => s.min.y < 0.03 && s.verts.length > 100 && s.max.y - s.min.y > 0.2);
if (rims.length !== 4) throw new Error(`expected 4 wheel rims, found ${rims.length}`);
const wheels = rims.map((s) => {
    const centre = s.min.clone().add(s.max).multiplyScalar(0.5);
    const radius = Math.max(s.max.x - s.min.x, s.max.y - s.min.y) / 2;
    const front = centre.x > 0.12;
    const side = centre.z < 0 ? 'L' : 'R'; // left = −Z when facing +X with +Y up
    return { name: `Wheel_${front ? 'F' : 'B'}${side}`, centre, radius, zMin: s.min.z, zMax: s.max.z };
});
// an island belongs to a wheel when it lies inside that wheel's disc and slab
const wheelOf = (s) => wheels.find((w) => {
    if (s.min.z < w.zMin - 0.03 || s.max.z > w.zMax + 0.03) return false;
    for (const c of [s.min, s.max]) {
        if (Math.hypot(c.x - w.centre.x, c.y - w.centre.y) > w.radius * Math.SQRT2 + 0.01) return false;
    }
    const mid = s.min.clone().add(s.max).multiplyScalar(0.5);
    return Math.hypot(mid.x - w.centre.x, mid.y - w.centre.y) < w.radius + 0.01;
});

// 4. the barrel: the islands that rise above the carriage (the body island stops at ~0.56)
const body = all.reduce((a, b) => (b.verts.length > a.verts.length ? b : a));
const isBarrel = (s) => s !== body && !wheelOf(s) && (s.max.y > 0.62 || (s.min.y + s.max.y) / 2 > 0.55);
const barrelVerts = all.filter(isBarrel).flatMap((s) => s.verts);
const barrelMin = new Vector3(Infinity, Infinity, Infinity), barrelMax = new Vector3(-Infinity, -Infinity, -Infinity);
for (const i of barrelVerts) { barrelMin.min(at(i)); barrelMax.max(at(i)); }
// the barrel's axis, breech (low, back) to muzzle (high, front): along its long diagonal in the side view
const barrelAxis = new Vector3(barrelMax.x - barrelMin.x, barrelMax.y - barrelMin.y, 0).normalize();
const trunnion = new Vector3((barrelMin.x + barrelMax.x) / 2 - 0.1, barrelMin.y + 0.15, 0);

// 5. skeleton
const bodyCentre = body.min.clone().add(body.max).multiplyScalar(0.5);
const defs = [
    ['Root', null, bodyCentre],
    ['Barrel', 'Root', trunnion],
    ...wheels.map((w) => [w.name, 'Root', w.centre]),
];
const joints = new Map();
const armature = doc.createNode('Armature');
root.listScenes()[0].addChild(armature);
for (const [name, par, p] of defs) {
    const pp = par ? defs.find((d) => d[0] === par)[2] : new Vector3();
    const node = doc.createNode(name).setTranslation(p.clone().sub(pp).toArray());
    (par ? joints.get(par) : armature).addChild(node);
    joints.set(name, node);
}
// the beam starts at the AttackNode: it rides the barrel's recoil now
if (attackNode && attackWorld) {
    for (const n of root.listNodes()) if (n.listChildren().includes(attackNode)) n.removeChild(attackNode);
    attackNode.setTranslation(attackWorld.clone().sub(trunnion).toArray()).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    joints.get('Barrel').addChild(attackNode);
}
const names = defs.map((d) => d[0]);
const J = new Uint16Array(count * 4);
const Wt = new Float32Array(count * 4);
const counts = new Map();
for (const s of all) {
    const w = wheelOf(s);
    const bone = w ? w.name : isBarrel(s) ? 'Barrel' : 'Root';
    counts.set(bone, (counts.get(bone) ?? 0) + s.verts.length);
    for (const i of s.verts) { J[i * 4] = names.indexOf(bone); Wt[i * 4] = 1; }
}
prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(Wt).setBuffer(buffer));
const skin = doc.createSkin('PrismRig').setSkeleton(joints.get('Root'));
const ibm = new Float32Array(defs.length * 16);
defs.forEach(([name, , p], k) => {
    skin.addJoint(joints.get(name));
    new Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, k * 16);
});
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
meshNode.setSkin(skin);

// 6. clips — rest rotations are identity, so a world-axis rotation IS the local rotation
const q = new Quaternion();
const rot = (ax, ang) => q.clone().setFromAxisAngle(ax, ang);
const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
const FPS = 30;
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
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const local = (bone, offset) => {
    const d = defs.find((x) => x[0] === bone);
    const pp = defs.find((x) => x[0] === d[1])[2];
    return d[2].clone().sub(pp).add(offset);
};
const ROLL_SECONDS = 1;
// rolling toward +X turns a wheel clockwise seen from +Z (−Z rotation); one full turn per loop
clip('walk', ROLL_SECONDS, (u, out) => {
    for (const w of wheels) out.set(w.name, { r: rot(Z, -TAU * u) });
    // the carriage rides the bumps a little: two per wheel turn
    out.set('Root', { r: rot(X, 0.012 * Math.sin(u * TAU * 2)).multiply(rot(Z, 0.01 * Math.sin(u * TAU * 2 + 1))), t: bodyCentre.clone().add(new Vector3(0, 0.004 * Math.sin(u * TAU * 4), 0)) });
    out.set('Barrel', { r: rot(Z, 0.015 * Math.sin(u * TAU * 2 + 0.5)) });
});
// idle: parked — the barrel settles a hair, nothing rolls
clip('idle', 4, (u, out) => {
    out.set('Barrel', { r: rot(Z, 0.006 * Math.sin(u * TAU)) });
}, 10);
// fire: the beam's kick — the barrel slides back along its axis and the carriage rocks
// back on its wheels, then both settle into the held firing pose (the beam holds this clip)
clip('fire', 0.5, (u, out) => {
    const kick = smooth(0, 0.08, u) * (1 - 0.6 * smooth(0.12, 0.5, u));
    out.set('Barrel', { r: rot(Z, 0.04 * kick), t: local('Barrel', barrelAxis.clone().multiplyScalar(-0.05 * kick)) });
    out.set('Root', { r: rot(Z, 0.03 * kick), t: bodyCentre.clone().add(new Vector3(-0.02 * kick, 0, 0)) });
    for (const w of wheels) out.set(w.name, { r: rot(Z, (0.02 * kick) / w.radius) }); // a short roll back
});
// death: a wreck where it stands — the wheels buckle and fall outward about their
// ground contact, the carriage drops flat onto the lawn nose-first, the barrel slumps.
// Symmetric, so no knock-aligned turn is needed (model config: death.turn false).
const BODY_DROP = Math.min(...all.filter((s) => s === body).map((s) => s.min.y)) + 0.01; // carriage underside to the ground
clip('death', 1.1, (u, out) => {
    const give = smooth(0.05, 0.5, u) ** 1.5; // the wheels go, accelerating
    const settle = 1 - 0.15 * Math.sin(smooth(0.5, 0.8, u) * Math.PI); // a small bounce as it lands
    const drop = BODY_DROP * give * settle;
    out.set('Root', { r: rot(Z, -0.07 * give), t: bodyCentre.clone().add(new Vector3(0, -drop, 0)) });
    out.set('Barrel', { r: rot(Z, -0.3 * smooth(0.25, 0.85, u)) });
    for (const w of wheels) {
        const out_ = w.centre.z > 0 ? 1 : -1; // outward along Z
        const lean = 1.15 * give * (w.name.includes('F') ? 1 : 0.9);
        // about the contact under the hub: the centre swings out and down; the root's drop is given back
        out.set(w.name, {
            r: rot(X, out_ * lean),
            t: local(w.name, new Vector3(0, -w.radius * (1 - Math.cos(lean)) + drop, out_ * w.radius * Math.sin(lean))),
        });
    }
});
await io.write(outFile, doc);
const f3 = (p) => p.toArray().map((x) => x.toFixed(3)).join(' ');
console.log(`rig: body (${f3(bodyCentre)}), barrel pivot (${f3(trunnion)}) axis (${f3(barrelAxis)})`);
for (const w of wheels) console.log(`  ${w.name}: centre (${f3(w.centre)}) radius ${w.radius.toFixed(3)}`);
console.log('  verts per bone', Object.fromEntries(counts));
