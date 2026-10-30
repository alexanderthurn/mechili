// Move a misplaced skeleton joint to a new bind position without moving the mesh,
// keeping the rig's convention that every child sits on its parent bone's +Y axis
// (Mixamo / Tripo humanoids — auto-riggers and retargeters check this):
//   - the parent bone turns so its +Y points at the new position
//   - the joint goes to (0, length, 0) and keeps its world rotation
//   - inverse bind matrices of the parent's subtree are rebuilt
//   - every clip is corrected so it still moves the parent bone the same way
// The file is patched in place (JSON + binary), so the generator tag, ordering
// and every untouched value stay exactly as the exporter wrote them.
//   node scripts/glb-move-joint.mjs in.glb out.glb mixamorig:RightHand -0.29,0.413,-0.018
// The target is a model-space position.
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const [inFile, outFile, jointName, target] = process.argv.slice(2);
const glb = readFileSync(inFile);
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = Buffer.from(glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen)));

const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || bv.byteStride) throw new Error(`accessor ${i}: expected tightly packed float32`);
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const offset = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(bin.buffer, bin.byteOffset + offset, a.count * size); // a view: writes patch the file
};
const users = (acc) => json.animations.flatMap((a) => a.channels.filter((c) => a.samplers[c.sampler].output === acc)).length;

const parentOf = new Map();
json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const local = (i) => {
    const n = json.nodes[i];
    return new Matrix4().compose(
        new Vector3(...(n.translation ?? [0, 0, 0])),
        new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new Vector3(...(n.scale ?? [1, 1, 1])),
    );
};
const world = (i) => {
    const m = local(i);
    for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) m.premultiply(local(p));
    return m;
};
const decompose = (m) => {
    const t = new Vector3(), q = new Quaternion(), s = new Vector3();
    m.decompose(t, q, s);
    return { t, q, s };
};

const H = json.nodes.findIndex((n) => n.name === jointName);
if (H < 0) throw new Error(`no joint ${jointName}`);
const F = parentOf.get(H);
const goal = new Vector3(...target.split(',').map(Number));
const fw = decompose(world(F));
const hw = decompose(world(H));
const pq = F !== undefined && parentOf.get(F) !== undefined ? decompose(world(parentOf.get(F))).q : new Quaternion();

// turn the parent bone so its +Y aims at the goal
const dir = goal.clone().sub(fw.t);
const length = dir.length() / fw.s.y;
const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0).applyQuaternion(fw.q), dir.normalize());
const fqNew = turn.multiply(fw.q.clone());
const qF = new Quaternion(...(json.nodes[F].rotation ?? [0, 0, 0, 1]));
const qFNew = pq.clone().invert().multiply(fqNew);
const delta = qF.clone().invert().multiply(qFNew); // local: qFNew = qF · delta
const deltaInv = delta.clone().invert();
const qH = new Quaternion(...(json.nodes[H].rotation ?? [0, 0, 0, 1]));
const qHNew = deltaInv.clone().multiply(qH); // the joint keeps its world rotation
const oldT = new Vector3(...(json.nodes[H].translation ?? [0, 0, 0]));
const newT = new Vector3(0, length, 0);

json.nodes[F].rotation = qFNew.toArray();
json.nodes[H].rotation = qHNew.toArray();
json.nodes[H].translation = newT.toArray();

// clips: parent keys absorb delta, the joint's keys undo it, translation follows the new length
let keys = 0;
const q = new Quaternion();
for (const anim of json.animations ?? []) {
    for (const ch of anim.channels) {
        const node = ch.target.node;
        const path = ch.target.path;
        if (!((node === F && path === 'rotation') || (node === H && (path === 'rotation' || path === 'translation')))) continue;
        const out = anim.samplers[ch.sampler].output;
        if (users(out) !== 1) throw new Error(`${anim.name}: keys of ${json.nodes[node].name}.${path} are shared — refusing to patch`);
        const v = accessor(out);
        for (let i = 0; i < v.length; i += path === 'rotation' ? 4 : 3) {
            if (path === 'rotation') {
                q.fromArray(v, i);
                (node === F ? q.multiply(delta) : q.premultiply(deltaInv)).toArray(v, i);
            } else {
                new Vector3().fromArray(v, i).sub(oldT).add(newT).toArray(v, i);
            }
            keys++;
        }
    }
}

// inverse bind matrices for the parent's subtree, from the new rest pose
const subtree = [];
const walk = (i) => {
    subtree.push(i);
    (json.nodes[i].children ?? []).forEach(walk);
};
walk(F);
let rebuilt = 0;
for (const skin of json.skins ?? []) {
    const ibm = accessor(skin.inverseBindMatrices);
    skin.joints.forEach((j, k) => {
        if (!subtree.includes(j)) return;
        world(j).invert().toArray(ibm, k * 16);
        rebuilt++;
    });
}

const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const js = pad(Buffer.from(JSON.stringify(json)), 0x20);
const out = Buffer.alloc(12);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
};
const file = Buffer.concat([out, chunk(0x4e4f534a, js), chunk(0x004e4942, pad(bin, 0))]);
file.writeUInt32LE(file.length, 8);
writeFileSync(outFile, file);
const at = decompose(world(H)).t;
console.log(
    `${jointName}: (${hw.t.toArray().map((v) => v.toFixed(3))}) → (${at.toArray().map((v) => v.toFixed(3))}), ` +
        `on ${json.nodes[F].name}'s +Y at ${length.toFixed(4)}; ${rebuilt} bind matrices rebuilt, ${keys} keys corrected`,
);
