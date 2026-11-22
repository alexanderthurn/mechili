// Turn one clip of a rig about the vertical axis: the root bone's rotation (and translation)
// keys get a yaw in front. For a clip whose action points off the unit's facing — e.g. a
// shooting stance that aims 50° to the side — so it points where the game fires.
//
// usage: node scripts/glb-clip-yaw.mjs in.glb out.glb <clip> <degrees> [rootBone=mixamorig:Hips]
//   + degrees turn +Z toward +X (right-handed, Y up)
import { load, qmul, qrot } from './glb-sample.mjs';

const [inFile, outFile, clipName, degArg, boneArg] = process.argv.slice(2);
const bone = boneArg ?? 'mixamorig:Hips';
const a = (Number(degArg) * Math.PI) / 180;
const yaw = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const { io, doc } = await load(inFile);
const anim = doc.getRoot().listAnimations().find((x) => x.getName() === clipName);
if (!anim) throw new Error('no clip ' + clipName);
const node = doc.getRoot().listNodes().find((n) => n.getName() === bone);
if (!node) throw new Error('no bone ' + bone);
let touched = 0;
const has = new Set();
for (const ch of anim.listChannels()) {
    if (ch.getTargetNode() !== node) continue;
    const path = ch.getTargetPath();
    const out = ch.getSampler().getOutput();
    const v = Float32Array.from(out.getArray());
    if (path === 'rotation') {
        for (let i = 0; i < v.length; i += 4) v.set(qmul(yaw, [v[i], v[i + 1], v[i + 2], v[i + 3]]), i);
    } else if (path === 'translation') {
        for (let i = 0; i < v.length; i += 3) v.set(qrot(yaw, [v[i], v[i + 1], v[i + 2]]), i);
    } else continue;
    // a fresh accessor: the output may be shared with another clip
    ch.getSampler().setOutput(doc.createAccessor().setType(out.getType()).setArray(v).setBuffer(doc.getRoot().listBuffers()[0]));
    has.add(path);
    touched++;
}
if (!has.has('rotation')) throw new Error(`clip ${clipName} has no rotation keys on ${bone} — add a constant track first`);
await io.write(outFile, doc);
console.log(`${clipName}: ${bone} turned ${degArg}° (${touched} channels) → ${outFile}`);
