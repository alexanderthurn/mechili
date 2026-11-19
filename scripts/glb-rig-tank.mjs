// Rig + animate a tank from a segmented model (Tripo "segment" output: many named parts), like
// glb-rig-prism.mjs: every part rides ONE rigid bone, all parts merge into one skinned mesh
// (one primitive per material, so the instanced-skin path can draw it), and the four clips
// are written here. Bones: Root (hull), Turret (on the turret ring), Cannon + MG (under the
// turret), Track_L / Track_R (belts, sprockets) and one bone per road wheel.
//   walk  — the road wheels roll WHEEL_TURNS turns per loop (stride = turns × 2π r), the hull rides bumps
//   idle  — standing still, the turret scans slowly
//   fire  — the barrel recoils deep into the turret, the tank rocks back on its tracks
//   death — the turret blows off: up, tumbling, onto the ground beside the hull; the hull sinks
//
// usage: node scripts/glb-rig-tank.mjs parts.glb out.glb plan.json
// plan.json (misc/model-viewer/raw/teutonic-tank-rig.plan.json):
//   groups.turret / cannon / mg / track_l / track_r: { parts, pivot }, rest → hull,
//   wheels: [part names] (each its own bone, carved out of its track group),
//   muzzle: [x,y,z] (AttackNode), forward: "+z" (turned so the cannon points +X, as the prism),
//   nudge: { part: [dx,dy,dz] } moves a part off a face it shares (z-fighting), singleSided: true.
// Source chain: teutonic-tank-parts.glb (Tripo export) → glb-close-part-holes.mjs (tracks, hull,
// turret) → crosses painted with glb-decal-mask.mjs → teutonic-tank-parts-final.glb → this script.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { load, pose } from './glb-sample.mjs';

const [inFile, outFile, planFile] = process.argv.slice(2);
const plan = JSON.parse((await import('node:fs')).readFileSync(planFile, 'utf8'));
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const scene = root.listScenes()[0];

// source space → rig space: the cannon along +X, wheels along ±Z (left = −Z), ground y = 0
const yaw = { '+x': 0, '+z': Math.PI / 2, '-x': Math.PI, '-z': -Math.PI / 2 }[plan.forward ?? '+x'];
// plan.shift (rig space): move the whole vehicle on its origin, e.g. so the hull — not hull +
// barrel — sits centred on the unit's footprint and the barrel reaches over the row in front
const shift = plan.shift ?? [0, 0, 0];
const turn = new Matrix4().makeTranslation(...shift).multiply(new Matrix4().makeRotationY(yaw));
const T = (p) => new Vector3(...p).applyMatrix4(turn);

const boneOfPart = new Map();
const BONE = { hull: 'Root', turret: 'Turret', cannon: 'Cannon', barrel: 'Barrel', mg: 'MG', track_l: 'Track_L', track_r: 'Track_R' };
for (const [g, spec] of Object.entries(plan.groups)) for (const p of spec.parts) boneOfPart.set(p, BONE[g] ?? g);
const wheelParts = new Set(plan.wheels ?? []);

// 1. gather every part, baked to rig space, onto its bone
const P = [], N = [], UV = [], IDX = [], J = [];
let material = null;
const wheelBox = new Map();
for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const name = n.getName() || mesh.getName();
    const nudge = plan.nudge?.[name] ?? [0, 0, 0];
    const M = new Matrix4().fromArray(n.getWorldMatrix()).premultiply(new Matrix4().makeTranslation(...nudge)).premultiply(turn);
    const Nm = new Matrix4().extractRotation(M);
    for (const prim of mesh.listPrimitives()) {
        if (material && prim.getMaterial() !== material) throw new Error('expects one material');
        material = prim.getMaterial();
        const pos = prim.getAttribute('POSITION').getArray();
        const nrm = prim.getAttribute('NORMAL')?.getArray();
        const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
        const base = P.length / 3;
        const cnt = pos.length / 3;
        const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
        for (let i = 0; i < cnt; i++) {
            const v = new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(M);
            P.push(v.x, v.y, v.z);
            box.min.min(v);
            box.max.max(v);
            const w = nrm ? new Vector3(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix4(Nm).normalize() : new Vector3(0, 1, 0);
            N.push(w.x, w.y, w.z);
            UV.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
        }
        const ind = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: cnt }, (_, i) => i);
        for (const v of ind) IDX.push(v + base);
        const bone = wheelParts.has(name) ? 'Wheel_' + name.replace(/^\D+/, '') : boneOfPart.get(name) ?? 'Root';
        if (wheelParts.has(name)) wheelBox.set(bone, box);
        for (let i = 0; i < cnt; i++) J.push(bone);
    }
}
for (const p of [...boneOfPart.keys(), ...wheelParts]) if (!root.listNodes().some((n) => n.getName() === p)) throw new Error('no part ' + p);
if (plan.singleSided) material.setDoubleSided(false);

// 1b. a rider (plan.rider): another rigged model, frozen in one frame of one of its clips, scaled,
// turned to face +X with the vehicle, its hips put at `hipsAt` (rig space) — e.g. a commander standing
// in the hatch — and welded onto one bone. Triangles wholly below `cutBelow` (hidden in the hull) go.
// The instanced-skin path draws ONE material: both textures go into one atlas, vehicle left, rider right.
if (plan.rider) {
    const R = plan.rider;
    const { doc: rdoc } = await load(R.file);
    const rnode = rdoc.getRoot().listNodes().find((n) => n.getSkin() && n.getMesh());
    const rskin = rnode.getSkin();
    const rjoints = rskin.listJoints();
    const ribm = rskin.getInverseBindMatrices().getArray();
    const anim = rdoc.getRoot().listAnimations().find((a) => a.getName() === R.clip);
    if (!anim) throw new Error('no clip ' + R.clip + ' in ' + R.file);
    const world = pose(rdoc, anim, R.time ?? 0);
    // leanOnRoof: re-aim both arms like leaning on a table — the elbows forward and down from the
    // shoulders, the forearms flat and forward, the hands turned in toward each other. Each bone is
    // turned (with everything below it) so it points at its target; lengths stay the bone's own.
    if (R.leanOnRoof) {
        const byName = new Map(rdoc.getRoot().listNodes().map((n) => [n.getName(), n]));
        const turnSubtree = (name, about, dq) => {
            const visit = (n) => {
                const nm = n.getName();
                const p = new Vector3(...world.get(nm)).sub(about).applyQuaternion(dq).add(about);
                world.set(nm, p.toArray());
                world.rot.set(nm, dq.clone().multiply(new Quaternion(...world.rot.get(nm))).toArray());
                for (const c of n.listChildren()) visit(c);
            };
            visit(byName.get(name));
        };
        const aim = (bone, child, target) => {
            const a = new Vector3(...world.get(bone)), c = new Vector3(...world.get(child));
            const dq = new Quaternion().setFromUnitVectors(c.clone().sub(a).normalize(), target.clone().sub(a).normalize());
            turnSubtree(bone, a, dq);
        };
        const L = R.leanOnRoof;
        for (const side of ['Left', 'Right']) {
            const arm = `mixamorig:${side}Arm`, fore = `mixamorig:${side}ForeArm`, hand = `mixamorig:${side}Hand`;
            const sh = new Vector3(...world.get(arm));
            const L1 = sh.distanceTo(new Vector3(...world.get(fore)));
            const L2 = new Vector3(...world.get(fore)).distanceTo(new Vector3(...world.get(hand)));
            const out = side === 'Left' ? 1 : -1; // the rider's own +X is his left (Mixamo, facing +Z)
            const elbow = sh.clone().add(new Vector3(out * (L.out ?? 0.2), -(L.down ?? 0.55), L.forward ?? 0.8).normalize().multiplyScalar(L1));
            aim(arm, fore, elbow);
            const wrist = elbow.clone().add(new Vector3(-out * (L.inward ?? 0.45), 0, 1).normalize().multiplyScalar(L2));
            aim(fore, hand, wrist);
        }
    }
    const jm = rjoints.map((j, k) => {
        const t = world.get(j.getName()), r = world.rot.get(j.getName());
        return new Matrix4().compose(new Vector3(...t), new Quaternion(...r), new Vector3(1, 1, 1)).multiply(new Matrix4().fromArray(Array.from(ribm.slice(k * 16, k * 16 + 16))));
    });
    const rp = rnode.getMesh().listPrimitives()[0];
    const rpos = rp.getAttribute('POSITION').getArray(), rnrm = rp.getAttribute('NORMAL')?.getArray(), ruv = rp.getAttribute('TEXCOORD_0').getArray();
    const rj = rp.getAttribute('JOINTS_0').getArray(), rw = rp.getAttribute('WEIGHTS_0').getArray();
    const rcnt = rpos.length / 3;
    const posed = [], posedN = [];
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < rcnt; i++) {
        const v = new Vector3(), n = new Vector3();
        for (let k = 0; k < 4; k++) {
            const w = rw[i * 4 + k];
            if (!w) continue;
            v.add(new Vector3(rpos[i * 3], rpos[i * 3 + 1], rpos[i * 3 + 2]).applyMatrix4(jm[rj[i * 4 + k]]).multiplyScalar(w));
            if (rnrm) n.add(new Vector3(rnrm[i * 3], rnrm[i * 3 + 1], rnrm[i * 3 + 2]).transformDirection(jm[rj[i * 4 + k]]).multiplyScalar(w));
        }
        posed.push(v);
        posedN.push(n.normalize());
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
    }
    // sized by the rest pose — a seated or crouched frame would otherwise be blown up
    let bindMin = Infinity, bindMax = -Infinity;
    for (let i = 0; i < rcnt; i++) { bindMin = Math.min(bindMin, rpos[i * 3 + 1]); bindMax = Math.max(bindMax, rpos[i * 3 + 1]); }
    const s = R.height / (bindMax - bindMin);
    console.log(`rider pose: feet ${((minY - world.get(R.hips ?? 'mixamorig:Hips')[1]) * s).toFixed(3)} / head ${((maxY - world.get(R.hips ?? 'mixamorig:Hips')[1]) * s).toFixed(3)} from the hips (rig units)`);
    const hips = new Vector3(...world.get(R.hips ?? 'mixamorig:Hips'));
    // restOn { bones, y }: set the hips' height so the lowest of these bones (forearms, hands)
    // lies at y — the arms resting on the turret roof
    const hipsAt = [...R.hipsAt];
    if (R.restOn) {
        const low = Math.min(...R.restOn.bones.map((b) => {
            if (!world.get(b)) throw new Error('no bone ' + b);
            return (world.get(b)[1] - hips.y) * s;
        }));
        hipsAt[1] = R.restOn.y - low;
        console.log(`rider rests on y ${R.restOn.y}: hips at ${hipsAt[1].toFixed(3)}`);
    }
    const place = new Matrix4().makeTranslation(...hipsAt.map((v, k) => v + shift[k]))
        .multiply(new Matrix4().makeRotationY(((R.yawDeg ?? 90) * Math.PI) / 180))
        .multiply(new Matrix4().makeScale(s, s, s))
        .multiply(new Matrix4().makeTranslation(-hips.x, -hips.y, -hips.z));
    const rot3 = new Matrix4().makeRotationY(((R.yawDeg ?? 90) * Math.PI) / 180);
    // the vehicle's uvs to the left half of the atlas
    for (let i = 0; i < UV.length; i += 2) UV[i] *= 0.5;
    const base = P.length / 3;
    const placed = posed.map((v) => v.clone().applyMatrix4(place));
    for (let i = 0; i < rcnt; i++) {
        P.push(placed[i].x, placed[i].y, placed[i].z);
        const n = posedN[i].clone().applyMatrix4(rot3);
        N.push(n.x, n.y, n.z);
        UV.push(0.5 + 0.5 * ruv[i * 2], ruv[i * 2 + 1]);
        J.push(R.bone ?? 'Turret');
    }
    const rind = rp.getIndices().getArray();
    let kept = 0;
    for (let t = 0; t < rind.length; t += 3) {
        if (R.cutBelow !== undefined && [0, 1, 2].every((k) => placed[rind[t + k]].y < R.cutBelow)) continue;
        IDX.push(rind[t] + base, rind[t + 1] + base, rind[t + 2] + base);
        kept++;
    }
    console.log(`rider: ${R.file.split('/').pop()} "${R.clip}"@${R.time ?? 0}s, height ${R.height}, ${kept}/${rind.length / 3} tris kept (cut below ${R.cutBelow})`);
    // atlas: both base-colour images side by side, each squeezed to half width
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), cp = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    const a = path.join(dir, 'a'), b = path.join(dir, 'b'), out = path.join(dir, 'atlas.png');
    fs.writeFileSync(a, material.getBaseColorTexture().getImage());
    fs.writeFileSync(b, rp.getMaterial().getBaseColorTexture().getImage());
    const size = plan.atlasSize ?? 2048;
    cp.execFileSync('python3', ['-c', `
from PIL import Image
import sys
a,b,o,s=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
A=Image.open(a).convert('RGB').resize((s//2,s),Image.LANCZOS)
B=Image.open(b).convert('RGB').resize((s//2,s),Image.LANCZOS)
C=Image.new('RGB',(s,s)); C.paste(A,(0,0)); C.paste(B,(s//2,0)); C.save(o)`, a, b, out, String(size)]);
    material.getBaseColorTexture().setImage(fs.readFileSync(out)).setMimeType('image/png');
    fs.rmSync(dir, { recursive: true, force: true });
}

// 2. skeleton (rest rotations identity: a world-axis rotation IS the local rotation)
const pivot = (g) => T(plan.groups[g].pivot);
const hullBox = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
J.forEach((b, i) => { if (b === 'Root') { hullBox.min.min(new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); hullBox.max.max(new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); } });
const hullCentre = hullBox.min.clone().add(hullBox.max).multiplyScalar(0.5);
const wheels = [...wheelBox].map(([name, b]) => ({ name, centre: b.min.clone().add(b.max).multiplyScalar(0.5), radius: (b.max.y - b.min.y) / 2 }));
const defs = [
    ['Root', null, hullCentre],
    ['Turret', 'Root', pivot('turret')],
    ['Cannon', 'Turret', pivot('cannon')],
    ['Barrel', 'Cannon', pivot('barrel')], // the tube: slides back into the mantlet on recoil
    ['MG', 'Turret', pivot('mg')],
    ['Track_L', 'Root', pivot('track_l')],
    ['Track_R', 'Root', pivot('track_r')],
    ...wheels.map((w) => [w.name, 'Root', w.centre]),
];
const def = (b) => defs.find((d) => d[0] === b);
const joints = new Map();
const armature = doc.createNode('Armature');
for (const [name, par, p] of defs) {
    const pp = par ? def(par)[2] : new Vector3();
    const node = doc.createNode(name).setTranslation(p.clone().sub(pp).toArray());
    (par ? joints.get(par) : armature).addChild(node);
    joints.set(name, node);
}
if (plan.muzzle) joints.get('Barrel').addChild(doc.createNode('AttackNode').setTranslation(T(plan.muzzle).sub(pivot('barrel')).toArray()));

// 3. one skinned mesh
const names = defs.map((d) => d[0]);
const count = P.length / 3;
const joints4 = new Uint8Array(count * 4), weights4 = new Float32Array(count * 4);
const perBone = {};
J.forEach((b, i) => {
    joints4[i * 4] = names.indexOf(b);
    weights4[i * 4] = 1;
    perBone[b] = (perBone[b] ?? 0) + 1;
});
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(P)))
    .setAttribute('NORMAL', acc('VEC3', Float32Array.from(N)))
    .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(UV)))
    .setAttribute('JOINTS_0', acc('VEC4', joints4))
    .setAttribute('WEIGHTS_0', acc('VEC4', weights4))
    .setIndices(acc('SCALAR', Uint32Array.from(IDX)));
for (const n of root.listNodes()) if (!joints.has(n.getName()) && n !== armature && n.getName() !== 'AttackNode') n.dispose();
for (const m of root.listMeshes()) m.dispose();
const skin = doc.createSkin('TankRig').setSkeleton(joints.get('Root'));
const ibm = new Float32Array(defs.length * 16);
defs.forEach(([name, , p], k) => {
    skin.addJoint(joints.get(name));
    new Matrix4().makeTranslation(-p.x, -p.y, -p.z).toArray(ibm, k * 16);
});
skin.setInverseBindMatrices(acc('MAT4', ibm));
const meshNode = doc.createNode('Tank').setMesh(doc.createMesh('Tank').addPrimitive(prim)).setSkin(skin);
scene.addChild(armature).addChild(meshNode);

// 4. clips
const q = new Quaternion();
const rot = (ax, ang) => q.clone().setFromAxisAngle(ax, ang);
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const local = (bone, offset) => { const d = def(bone); return d[2].clone().sub(def(d[1])[2]).add(offset); };
function clip(name, duration, sample, fps = 30) {
    const frames = Math.max(24, Math.round(duration * fps) + 1);
    const times = new Float32Array(frames).map((_, f) => (f / (frames - 1)) * duration);
    const tracks = new Map();
    for (let f = 0; f < frames; f++) {
        const out = new Map();
        sample(f / (frames - 1), out);
        for (const [b, { r, t }] of out) {
            if (!tracks.has(b)) tracks.set(b, { r: new Float32Array(frames * 4), t: t ? new Float32Array(frames * 3) : null });
            tracks.get(b).r.set((r ?? new Quaternion()).toArray(), f * 4);
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

// walk: WHEEL_TURNS full turns of the road wheels per loop (seamless); the hull rides two bumps
const WHEEL_TURNS = 4;
const r0 = wheels.length ? wheels.reduce((s, w) => s + w.radius, 0) / wheels.length : 0.035;
clip('walk', 1.6, (u, out) => {
    for (const w of wheels) out.set(w.name, { r: rot(Z, (-TAU * WHEEL_TURNS * u * r0) / w.radius) });
    out.set('Root', {
        r: rot(Z, 0.008 * Math.sin(u * TAU * 2)).multiply(rot(X, 0.006 * Math.sin(u * TAU * 2 + 1.3))),
        t: hullCentre.clone().add(new Vector3(0, 0.003 * Math.abs(Math.sin(u * TAU * 2)), 0)),
    });
    const lag = rot(Z, 0.012 * Math.sin(u * TAU * 2 - 0.6)); // the long barrel lags the hull
    out.set('Cannon', { r: lag });
    out.set('MG', { r: lag.clone() }); // the MG keeps the cannon's angle in every clip
});
// idle: standing still — only the turret scans ±10° (cannon and MG ride along)
clip('idle', 6, (u, out) => {
    out.set('Turret', { r: rot(Y, 0.17 * Math.sin(u * TAU)) });
}, 30);
// fire: the cannon kicks back along its axis and runs out again, the tank rocks back on its tracks
clip('fire', 0.7, (u, out) => {
    const kick = smooth(0, 0.05, u) * (1 - smooth(0.12, 0.6, u));
    const rock = Math.sin(smooth(0, 0.9, u) * Math.PI) * (1 - 0.5 * smooth(0.4, 0.9, u));
    out.set('Barrel', { t: local('Barrel', new Vector3(-0.1 * kick, 0, 0)) }); // the tube runs back into the turret
    out.set('Cannon', { r: rot(Z, 0.03 * kick) });
    out.set('MG', { r: rot(Z, 0.03 * kick) });
    out.set('Root', { r: rot(Z, 0.035 * rock), t: hullCentre.clone().add(new Vector3(-0.008 * rock, 0, 0)) });
});
// death: the ammo goes — the turret is thrown up, tumbles and lands upside-down-ish beside the hull;
// the hull sags onto its belly. Symmetric enough that the model config says death.turn false.
const ringY = def('Turret')[2].y;
clip('death', 1.6, (u, out) => {
    const fly = smooth(0, 0.62, u); // airborne 0 → 0.62, then a bounce
    const up = 0.32 * Math.sin(Math.min(1, u / 0.62) * Math.PI); // the arc's height
    const land = -ringY + 0.08; // turned over, the roof on the lawn: the ring ends ~0.08 up
    const bounce = 0.03 * Math.sin(smooth(0.62, 0.85, u) * Math.PI);
    out.set('Turret', {
        r: rot(X, -2.4 * fly - 0.15 * smooth(0.62, 0.9, u)).multiply(rot(Y, 0.9 * fly)),
        t: local('Turret', new Vector3(-0.12 * fly, up + land * smooth(0.3, 0.62, u) + bounce, -0.36 * fly)),
    });
    const droop = rot(Z, -0.35 * smooth(0.15, 0.7, u));
    out.set('Cannon', { r: droop });
    out.set('MG', { r: droop.clone() });
    const sag = smooth(0.05, 0.4, u);
    out.set('Root', { r: rot(X, -0.04 * sag).multiply(rot(Z, -0.03 * sag)), t: hullCentre.clone().add(new Vector3(0, -0.02 * sag, 0)) });
});

await io.write(outFile, doc);
const f3 = (p) => p.toArray().map((x) => x.toFixed(3)).join(' ');
console.log(`rig: ${defs.length} bones, ${count} verts, ${IDX.length / 3} tris; hull (${f3(hullCentre)}) turret (${f3(def('Turret')[2])})`);
console.log('  wheels', wheels.map((w) => `${w.name} r${w.radius.toFixed(3)}`).join(', '));
console.log(`  walk stride (model units) = ${(WHEEL_TURNS * TAU * r0).toFixed(3)}`);
console.log('  verts per bone', perBone);
