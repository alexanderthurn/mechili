// Rig + animate the static komtur (armoured horse + rider, 51 Tripo parts, one material):
// the parts are merged into one skinned mesh, a skeleton is placed from the geometry
// (body, neck, head, tail, three bones per leg, rider, cape, lance) and walk (heavy walk),
// idle, fire (rear up, slam + lance thrust) and death (collapses onto its side)
// are keyframed — like glb-rig-spider.mjs.
//   node scripts/glb-rig-horse.mjs assets/models/units/komtur.glb out.glb
// Model space: head toward +X, feet at y = 0. The modelled pose is mid-stride with the
// front legs bent, so the legs are posed by ABSOLUTE segment angles (side view, from
// straight down, + = toward the head), not as offsets from that rest pose.
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { load } from './glb-sample.mjs';

const [inFile, outFile] = process.argv.slice(2);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// 1. merge every part (world transform baked) into one primitive; remember each vertex's part
const P = [], Nm = [], UV = [], idx = [], partOf = [];
let material = null;
for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = new Matrix4().fromArray(node.getWorldMatrix());
    const Nx = new Matrix3().getNormalMatrix(M);
    const part = node.getName().replace('tripo_part_', '');
    for (const prim of mesh.listPrimitives()) {
        material ??= prim.getMaterial();
        const base = P.length / 3;
        const pos = prim.getAttribute('POSITION').getArray();
        const nrm = prim.getAttribute('NORMAL').getArray();
        const uv = prim.getAttribute('TEXCOORD_0').getArray();
        const v = new Vector3();
        for (let i = 0; i < pos.length; i += 3) {
            P.push(...v.fromArray(pos, i).applyMatrix4(M).toArray());
            Nm.push(...v.fromArray(nrm, i).applyMatrix3(Nx).normalize().toArray());
            partOf.push(part);
        }
        UV.push(...uv);
        for (const k of prim.getIndices().getArray()) idx.push(base + k);
    }
}
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
let count = P.length / 3;
const at = (i) => new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);

// 2. which part is what (looked up in a colour render of the parts)
// FR is a short raised stub inside the body mesh (part 0) — rebuilt below from FL
const LEG_PARTS = { HL: '3', HR: '13', FL: '19', FR: 'FR' };
const BODY = '0', NECK = '9', HEAD = '5', LANCE = '4', CAPE = ['1', '62'], RIDER_LEGS = ['10', '11'];
const partCentroid = new Map();
for (let i = 0; i < count; i++) {
    const c = partCentroid.get(partOf[i]) ?? { s: new Vector3(), n: 0 };
    c.s.add(at(i)); c.n++;
    partCentroid.set(partOf[i], c);
}
for (const c of partCentroid.values()) c.s.divideScalar(c.n);
const centroidOf = (part) => partCentroid.get(part).s;
// small ornaments: along the neck/head, or on the rider
const neckGroup = (part) => part === NECK || part === HEAD
    || (part !== BODY && part !== LANCE && !Object.values(LEG_PARTS).includes(part) && centroidOf(part).x > 0.12 && centroidOf(part).y > 0.4);
const riderGroup = (part) => !neckGroup(part) && part !== BODY && !Object.values(LEG_PARTS).includes(part)
    && (centroidOf(part).y > 0.45 || RIDER_LEGS.includes(part) || CAPE.includes(part) || part === LANCE);

// geodesic distance over one part's surface from the vertices `src` picks
const weldKey = (i) => [0, 1, 2].map((j) => Math.round(P[i * 3 + j] * 1e4)).join(',');
function geodesic(part, src) {
    const verts = [];
    for (let i = 0; i < count; i++) if (partOf[i] === part) verts.push(i);
    const key = new Map(), weld = new Map();
    for (const i of verts) { const k = weldKey(i); if (!key.has(k)) key.set(k, i); weld.set(i, key.get(k)); }
    const adj = new Map(verts.map((i) => [i, new Set()]));
    for (let t = 0; t < idx.length; t += 3) {
        if (partOf[idx[t]] !== part) continue;
        const tri = [0, 1, 2].map((k) => weld.get(idx[t + k]));
        for (let k = 0; k < 3; k++) { adj.get(tri[k]).add(tri[(k + 1) % 3]); adj.get(tri[(k + 1) % 3]).add(tri[k]); }
    }
    const dist = new Map();
    const queue = [];
    for (const i of verts) if (src(at(i))) { dist.set(weld.get(i), 0); queue.push([0, weld.get(i)]); }
    // small graphs: a sorted-insert queue is plenty
    while (queue.length) {
        const [d, u] = queue.shift();
        if (d > dist.get(u)) continue;
        for (const w of adj.get(u)) {
            const nd = d + at(u).distanceTo(at(w));
            if (nd < (dist.get(w) ?? Infinity)) {
                dist.set(w, nd);
                let k = queue.findIndex((q) => q[0] > nd);
                if (k < 0) k = queue.length;
                queue.splice(k, 0, [nd, w]);
            }
        }
    }
    return (i) => (partOf[i] === part ? dist.get(weld.get(i)) ?? Infinity : Infinity);
}
// The modelled front-right leg is folded up and ~0.07 shorter than the others: cut its
// hoof and cannon off the body mesh and put a mirror image of the front-left leg there.
// The stub's root stays and rides on the new leg's upper bone.
const frStubG = geodesic(BODY, (p) => p.x > 0.1 && p.y < 0.17);
const STUB_CUT_G = 0.12;
{
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        if (!tri.every((i) => frStubG(i) < STUB_CUT_G)) keep.push(...tri);
    }
    idx.length = 0;
    idx.push(...keep);
    let zMid = 0;
    for (const part of [LEG_PARTS.HL, LEG_PARTS.HR]) zMid += centroidOf(part).z / 2;
    const map = new Map();
    for (let i = 0; i < count; i++) {
        if (partOf[i] !== LEG_PARTS.FL) continue;
        map.set(i, P.length / 3);
        P.push(P[i * 3], P[i * 3 + 1], 2 * zMid - P[i * 3 + 2]);
        Nm.push(Nm[i * 3], Nm[i * 3 + 1], -Nm[i * 3 + 2]);
        UV.push(UV[i * 2], UV[i * 2 + 1]);
        partOf.push('FR');
    }
    const n = idx.length;
    for (let t = 0; t < n; t += 3) {
        if (partOf[idx[t]] !== LEG_PARTS.FL) continue;
        idx.push(map.get(idx[t]), map.get(idx[t + 2]), map.get(idx[t + 1])); // mirrored: flip winding
    }
    count = P.length / 3;
}
const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', acc('VEC3', new Float32Array(P)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(Nm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(UV)))
    .setIndices(acc('SCALAR', count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
const meshNode = doc.createNode('Komtur').setMesh(doc.createMesh('Komtur').addPrimitive(prim));
const scene = root.listScenes()[0];
scene.addChild(meshNode);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const centroid = (pred) => {
    const c = new Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) if (pred(i)) { c.add(at(i)); n++; }
    if (!n) throw new Error('empty centroid');
    return c.divideScalar(n);
};

// 3. legs: geodesic from the hoof; hoof < FETLOCK_G < pastern/cannon < KNEE_G < upper < TOP_G
const FETLOCK_G = 0.07, KNEE_G = 0.17, TOP_G = 0.3;
const legs = ['HL', 'HR', 'FL', 'FR'].map((name) => {
    const part = LEG_PARTS[name];
    let ymin = Infinity;
    for (let i = 0; i < count; i++) if (partOf[i] === part) ymin = Math.min(ymin, P[i * 3 + 1]);
    const g = geodesic(part, (p) => p.y < ymin + 0.03);
    const band = (lo, hi) => centroid((i) => g(i) >= lo && g(i) < hi);
    const top = band(TOP_G - 0.06, Infinity);
    return {
        name, part, g, front: name[0] === 'F', side: name[1] === 'L' ? -1 : 1,
        tip: band(0, 0.03), fetlock: band(FETLOCK_G - 0.02, FETLOCK_G + 0.02), knee: band(KNEE_G - 0.03, KNEE_G + 0.03), top,
    };
});
// what is left of the old FR stub rides on the new leg's upper bone, fading into the chest
const stubShare = (i) => (partOf[i] === BODY ? 1 - smooth(0.22, 0.32, frStubG(i)) : 0);

// body landmarks
const bodyOnly = (i) => partOf[i] === BODY && stubShare(i) < 0.01;
const zc = (legs[0].tip.z + legs[1].tip.z) / 2;
const torso = centroid((i) => bodyOnly(i) && P[i * 3] > -0.3 && P[i * 3] < 0.25);
torso.z = zc;
const tailBase = centroid((i) => bodyOnly(i) && P[i * 3] < -0.33 && P[i * 3] > -0.39);
const TAIL_X = -0.34;
const neckBase = new Vector3(0.14, 0.5, zc);
const HEAD_X = 0.33;
const headBase = new Vector3(HEAD_X, centroid((i) => partOf[i] === HEAD && P[i * 3] < HEAD_X + 0.03).y, zc);
const saddle = new Vector3(0.04, 0.56, zc);
const capeBase = centroid((i) => CAPE.includes(partOf[i]) && P[i * 3] > -0.08);
const grip = centroid((i) => partOf[i] === LANCE && P[i * 3] > -0.04 && P[i * 3] < 0.08);

// 4. skeleton
const defs = [
    ['Root', null, torso],
    ['Neck', 'Root', neckBase], ['Head', 'Neck', headBase],
    ['Tail', 'Root', tailBase],
    ['Rider', 'Root', saddle], ['Cape', 'Rider', capeBase], ['Lance', 'Rider', grip],
    ...legs.flatMap((l) => [
        [`${l.name}_Upper`, 'Root', l.top], [`${l.name}_Lower`, `${l.name}_Upper`, l.knee], [`${l.name}_Hoof`, `${l.name}_Lower`, l.fetlock],
    ]),
];
const joints = new Map();
const armature = doc.createNode('Armature');
scene.addChild(armature);
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
    const part = partOf[i];
    const x = P[i * 3];
    const leg = legs.find((l) => l.part === part);
    let rest = 1;
    if (leg) {
        const g = leg.g(i);
        const hoof = 1 - smooth(FETLOCK_G - 0.02, FETLOCK_G + 0.02, g);
        const lower = (1 - smooth(KNEE_G - 0.03, KNEE_G + 0.03, g)) - hoof;
        add(`${leg.name}_Hoof`, hoof);
        add(`${leg.name}_Lower`, lower);
        add(`${leg.name}_Upper`, 1 - hoof - lower);
        rest = 0;
    } else if (stubShare(i) > 0) {
        add('FR_Upper', stubShare(i));
        rest = 1 - stubShare(i);
    }
    if (rest > 0) {
        if (part === LANCE) add('Lance', rest);
        else if (CAPE.includes(part)) add('Cape', rest);
        else if (riderGroup(part)) add('Rider', rest);
        else if (neckGroup(part)) {
            const head = smooth(HEAD_X - 0.03, HEAD_X + 0.03, x);
            add('Head', rest * head);
            add('Neck', rest * (1 - head));
        } else {
            const tail = 1 - smooth(TAIL_X - 0.04, TAIL_X + 0.01, x);
            add('Tail', rest * tail);
            add('Root', rest * (1 - tail));
        }
    }
    const top4 = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top4.reduce((s, e) => s + e[1], 0);
    top4.forEach(([b, e], k) => { J[i * 4 + k] = b; Wt[i * 4 + k] = e / sum; });
}
prim.setAttribute('JOINTS_0', acc('VEC4', J));
prim.setAttribute('WEIGHTS_0', acc('VEC4', Wt));
const skin = doc.createSkin('KomturRig').setSkeleton(joints.get('Root'));
const ibm = new Float32Array(defs.length * 16);
defs.forEach(([name, , p], k) => {
    skin.addJoint(joints.get(name));
    new Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, k * 16);
});
skin.setInverseBindMatrices(acc('MAT4', ibm));
meshNode.setSkin(skin);

// 5. clips — rest rotations are identity, so a world-axis rotation IS the local rotation
const q = new Quaternion();
const rot = (ax, ang) => q.clone().setFromAxisAngle(ax, ang);
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
// side-view angle of a segment, from straight down, + = toward the head (+X)
const angleOf = (a, b) => Math.atan2(b.x - a.x, a.y - b.y);
for (const l of legs) l.rest = [angleOf(l.top, l.knee), angleOf(l.knee, l.fetlock), angleOf(l.fetlock, l.tip)];
// a leg by absolute segment angles in the BODY frame (about Z): upper, lower, hoof
const legPose = (out, leg, a) => {
    const d = a.map((v, k) => v - leg.rest[k]);
    out.set(`${leg.name}_Upper`, { r: rot(Z, d[0]) });
    out.set(`${leg.name}_Lower`, { r: rot(Z, d[1] - d[0]) });
    out.set(`${leg.name}_Hoof`, { r: rot(Z, d[2] - d[1]) });
};
// standing: forelegs plumb, hind tibia sloping back to the hock, cannons plumb, pasterns forward
const STAND = { front: [0, 0, 0.45], hind: [-0.3, 0.05, 0.45] };
const stand = (leg) => (leg.front ? STAND.front : STAND.hind);
const rootPose = (out, R, pivot, offset = new Vector3()) => {
    out.set('Root', { r: R, t: torso.clone().sub(pivot).applyQuaternion(R).add(pivot).add(offset) });
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
    const input = acc('SCALAR', times);
    const channel = (b, path, type, arr) => {
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(acc(type, arr)).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(b)).setTargetPath(path).setSampler(sampler));
    };
    for (const [b, { r, t }] of tracks) {
        channel(b, 'rotation', 'VEC4', r);
        if (t) channel(b, 'translation', 'VEC3', t);
    }
    console.log(`${name}: ${duration}s, ${frames} keys, ${tracks.size} bones`);
}
const TAU = Math.PI * 2;
const wrap = (p) => ((p % 1) + 1) % 1;

// walk: a heavy war-horse walk — four separate beats (hind L, fore L, hind R, fore R), each
// hoof lifted high, carried forward and planted hard; the body jolts down on every
// footfall and the head nods with the forehand. The duration matches the stride to the
// ground speed at the unit's size (≈ 6.8 world units per cycle at speed 8, meshScale 5.6), so the feet
// stay planted at walkAnimRate 1.
const BEAT = { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 };
const STANCE = 0.62;
const landing = (p) => (p < 0.1 ? Math.sin((p / 0.1) * Math.PI) : 0); // impact pulse after touchdown
clip('walk', 0.85, (u, out) => {
    let jolt = 0, pitch = 0;
    for (const leg of legs) {
        const p = wrap(u - BEAT[leg.name]);
        const [s0, s1, s2] = stand(leg);
        const reach = leg.front ? 0.45 : 0.42;
        let upper, fold, flick = 0;
        if (p < STANCE) {
            // planted: the hoof stays put while the body passes over it
            upper = reach * (1 - (2 * p) / STANCE);
            fold = 0;
        } else {
            // lift sharply, carry forward high, then straighten and drive down into the ground
            const s = (p - STANCE) / (1 - STANCE);
            upper = -reach + 2 * reach * smooth(0.05, 0.8, s) + 0.1 * Math.sin(Math.min(1, s / 0.85) * Math.PI);
            fold = Math.sin(Math.min(1, s / 0.8) * Math.PI) ** 0.7;
            flick = smooth(0.6, 0.85, s) * (1 - smooth(0.9, 1, s)); // hoof snaps forward before the plant
        }
        // forelegs fold at the knee; hind legs pick up from the hip with the hock bent hard
        if (leg.front) legPose(out, leg, [s0 + upper + 0.15 * fold, s1 + upper - 1.8 * fold, s2 + upper - 2.0 * fold + 0.4 * flick]);
        else legPose(out, leg, [s0 + upper + 0.6 * fold, s1 + upper - 0.9 * fold, s2 + upper - 1.4 * fold + 0.3 * flick]); // thigh forward, cannon tucked back: the hoof clears the ground
        const hit = landing(p);
        jolt += hit;
        pitch += (leg.front ? -1 : 1) * hit;
    }
    // weight drops onto each hoof and the body rolls toward the planted side
    const roll = Math.sin(u * TAU * 2 - 0.6);
    rootPose(out, rot(Z, 0.035 * pitch).multiply(rot(X, 0.035 * Math.sin(u * TAU))), torso, new Vector3(0, -0.016 * jolt + 0.008 * roll, 0));
    const nod = Math.sin((u - BEAT.FL - 0.05) * TAU * 2); // down as each foreleg lands
    out.set('Neck', { r: rot(Z, -0.14 * nod) });
    out.set('Head', { r: rot(Z, -0.08 * nod) });
    out.set('Tail', { r: rot(Y, 0.12 * Math.sin(u * TAU)).multiply(rot(Z, 0.12)) });
    out.set('Rider', { r: rot(Z, 0.03 * nod).multiply(rot(X, -0.03 * Math.sin(u * TAU))), t: saddle.clone().sub(torso).add(new Vector3(0, -0.008 * jolt, 0)) });
    out.set('Cape', { r: rot(Z, -0.12 + 0.06 * Math.sin(u * TAU * 2)) });
    out.set('Lance', { r: rot(Z, 0.04 * nod) });
});
// idle: stands square, breathes, the head dips and comes back up, the tail swishes
clip('idle', 4, (u, out) => {
    const breathe = Math.sin(u * TAU * 2);
    for (const leg of legs) {
        const rest = leg.name === 'HR' ? Math.max(0, Math.sin(Math.min(1, Math.max(0, (u - 0.55) / 0.35)) * Math.PI)) : 0;
        const [s0, s1, s2] = stand(leg);
        legPose(out, leg, [s0 + 0.12 * rest, s1 + 0.2 * rest, s2 + 0.5 * rest]); // cocks a hind hoof
    }
    rootPose(out, new Quaternion(), torso, new Vector3(0, 0.004 * breathe, 0));
    const dip = Math.max(0, Math.sin(Math.min(1, Math.max(0, (u - 0.15) / 0.3)) * Math.PI));
    out.set('Neck', { r: rot(Z, -0.25 * dip) });
    out.set('Head', { r: rot(Z, -0.15 * dip + 0.04 * Math.sin(u * TAU * 3)) });
    out.set('Tail', { r: rot(Y, 0.3 * Math.sin(u * TAU * 2)).multiply(rot(Z, 0.1)) });
    out.set('Rider', { r: rot(Z, 0.02 * breathe), t: saddle.clone().sub(torso) });
    out.set('Cape', { r: rot(Z, -0.05 + 0.04 * Math.sin(u * TAU)) });
    out.set('Lance', { r: rot(Z, 0.02 * breathe) });
}, 20); // slow — 20 keys/s keeps the file small
// fire: rears up on the hind legs, forelegs pawing, then crashes down onto both front
// hooves as the lance drives forward — the hit lands with the hooves (≈ 0.56 s), inside
// the 0.85 s attack interval
clip('fire', 0.8, (u, out) => {
    const rear = smooth(0, 0.38, u) * (1 - smooth(0.46, 0.56, u));
    const slam = smooth(0.48, 0.56, u) * (1 - smooth(0.62, 0.95, u));
    const pitch = 0.6 * rear - 0.07 * slam;
    const hinds = legs.filter((l) => !l.front);
    const pivot = new Vector3(hinds.reduce((sum, l) => sum + l.tip.x, 0) / 2, 0.02, zc);
    rootPose(out, rot(Z, pitch), pivot, new Vector3(0, -0.02 * slam, 0));
    for (const leg of legs) {
        const [s0, s1, s2] = stand(leg);
        if (!leg.front) {
            // hooves stay planted: undo the body pitch, sit into the haunches
            legPose(out, leg, [s0 - pitch + 0.3 * rear, s1 - pitch - 0.15 * rear, s2 - pitch + 0.25 * rear]);
        } else {
            // paw the air (the legs alternate), then both drive straight down and forward
            const paw = 0.5 + 0.5 * Math.sin((u * 3.2 + (leg.side < 0 ? 0 : 0.5)) * TAU);
            const up = rear * (0.7 + 0.35 * paw);
            const fold = rear * (1.3 + 0.6 * (1 - paw));
            const drive = 0.35 * slam;
            legPose(out, leg, [s0 - pitch + up + drive, s1 - pitch + up - fold + drive, s2 - pitch + up - 1.2 * fold + drive]);
        }
    }
    out.set('Neck', { r: rot(Z, -0.35 * rear + 0.2 * slam) });
    out.set('Head', { r: rot(Z, -0.2 * rear + 0.1 * slam) });
    out.set('Tail', { r: rot(Z, 0.2 - 0.35 * rear + 0.25 * slam) });
    // the rider leans into the rear, then throws his weight over the neck with the thrust
    out.set('Rider', { r: rot(Z, -0.5 * pitch - 0.25 * slam), t: saddle.clone().sub(torso).add(new Vector3(0.03 * slam, 0, 0)) });
    out.set('Cape', { r: rot(Z, -0.35 * rear - 0.25 * slam) });
    // lance raised high, then driven forward and down at the target
    out.set('Lance', { r: rot(Z, 0.35 * rear - 0.25 * slam), t: grip.clone().sub(saddle).add(new Vector3(0.14 * slam - 0.05 * rear, 0, 0)) });
});
// death: the forelegs buckle, then it rolls onto its side toward −Z (fallLocal 0,−1),
// legs stiff out sideways, the rider thrown with it
clip('death', 1.4, (u, out) => {
    const buckle = smooth(0, 0.35, u);
    const roll = smooth(0.25, 0.75, u);
    const sink = 0.12 * buckle * (1 - roll);
    const side = 0.17;
    const pivot = new Vector3(torso.x, 0, zc - side);
    rootPose(out, rot(Z, -0.18 * buckle * (1 - roll)).premultiply(rot(X, -Math.PI / 2 * roll)), pivot, new Vector3(0, -sink + 0.03 * roll, 0));
    for (const leg of legs) {
        const [s0, s1, s2] = stand(leg);
        const fold = leg.front ? buckle * (1 - roll) : 0;
        const kick = roll * (leg.front ? 0.5 : -0.4);
        legPose(out, leg, [s0 + 0.6 * fold + kick, s1 - 1.6 * fold + kick, s2 - 1.2 * fold + kick]);
    }
    out.set('Neck', { r: rot(Z, -0.4 * buckle + 0.3 * roll) });
    out.set('Head', { r: rot(Z, -0.2 * buckle) });
    out.set('Tail', { r: rot(Z, -0.2 * roll) });
    // in the rolled body frame local +Z is world up: the rider lifts clear and props up on the ground
    out.set('Rider', { r: rot(X, 0.35 * roll).multiply(rot(Z, 0.3 * buckle)), t: saddle.clone().sub(torso).add(new Vector3(0.05 * buckle, 0, 0.06 * roll)) });
    out.set('Cape', { r: rot(Z, 0.2 * roll) });
    out.set('Lance', { r: rot(X, 0.4 * roll) });
});
await io.write(outFile, doc);
const f3 = (v) => v.toArray().map((x) => x.toFixed(2)).join(' ');
console.log(`rig: torso (${f3(torso)}), neck (${f3(neckBase)}), head (${f3(headBase)}), tail (${f3(tailBase)}), grip (${f3(grip)}), cape (${f3(capeBase)})`);
for (const l of legs) console.log(`  ${l.name}: top (${f3(l.top)}) knee (${f3(l.knee)}) fetlock (${f3(l.fetlock)}) tip (${f3(l.tip)}) rest° ${l.rest.map((a) => ((a * 180) / Math.PI).toFixed(0)).join('/')}`);
