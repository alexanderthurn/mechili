// Weld a prop (one named object of another GLB, e.g. a weapon from glb-split-parts) into
// a rigged model: the prop is turned, scaled and moved so its grip point lands at a
// point of the model's bind pose, then added to the skinned mesh as its own primitive
// (own material + texture), weighted 100% to one bone — it rides that bone in every clip,
// and the instanced-skin path draws it like the body (one skinned mesh).
//
// usage: node scripts/glb-attach.mjs model.glb out.glb '<json plan>'
// plan: { "props": [ {
//     "file": "misc/model-viewer/raw/teutonic-weapons-split.glb", "part": "weapon_01",
//     "bone": "mixamorig:RightHand",
//     "grip": [0, 0.31, 0],          // the point of the prop that goes into the hand (the part's own space, centred)
//     "at": [-0.40, 0.725, 0],       // where it goes (model bind space)
//     "basis": { "x": [1,0,0], "y": [0,0,-1], "z": [0,1,0] },  // where the prop's x / y / z axes point
//     "scale": 0.6 } ] }
import { load } from './glb-sample.mjs';

const [inFile, outFile, planJson] = process.argv.slice(2);
const plan = JSON.parse(planJson);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const skinNode = root.listNodes().find((n) => n.getSkin() && n.getMesh());
if (!skinNode) throw new Error('no skinned mesh in ' + inFile);
const skin = skinNode.getSkin();
const mesh = skinNode.getMesh();
const bodyPrim = mesh.listPrimitives()[0];
const jointsType = bodyPrim.getAttribute('JOINTS_0').getArray().constructor;
const cache = new Map();

for (const prop of plan.props) {
    const boneIndex = skin.listJoints().findIndex((j) => j.getName() === prop.bone);
    if (boneIndex < 0) throw new Error('no bone ' + prop.bone);
    if (!cache.has(prop.file)) cache.set(prop.file, await load(prop.file));
    const src = cache.get(prop.file).doc;
    const node = src.getRoot().listNodes().find((n) => n.getName() === prop.part || n.getMesh()?.getName() === prop.part);
    if (!node) throw new Error('no part ' + prop.part + ' in ' + prop.file);
    const sp = node.getMesh().listPrimitives()[0];
    const s = prop.scale ?? 1;
    const B = [prop.basis.x, prop.basis.y, prop.basis.z];
    const turn = (v) => [0, 1, 2].map((k) => B[0][k] * v[0] + B[1][k] * v[1] + B[2][k] * v[2]);
    const g = prop.grip;
    const at = prop.at;

    const pos = sp.getAttribute('POSITION').getArray();
    const n = pos.length / 3;
    const outPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const p = [pos[i * 3] - g[0], pos[i * 3 + 1] - g[1], pos[i * 3 + 2] - g[2]].map((v) => v * s);
        const q = turn(p);
        for (let k = 0; k < 3; k++) outPos[i * 3 + k] = q[k] + at[k];
    }
    const prim = doc.createPrimitive().setMode(sp.getMode());
    const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    prim.setAttribute('POSITION', acc('VEC3', outPos));
    const nrm = sp.getAttribute('NORMAL')?.getArray();
    if (nrm) {
        const out = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const q = turn([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]);
            const l = Math.hypot(...q) || 1;
            for (let k = 0; k < 3; k++) out[i * 3 + k] = q[k] / l;
        }
        prim.setAttribute('NORMAL', acc('VEC3', out));
    }
    const uv = sp.getAttribute('TEXCOORD_0');
    if (uv) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv.getArray())));
    const joints = new jointsType(n * 4);
    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        joints[i * 4] = boneIndex;
        weights[i * 4] = 1;
    }
    prim.setAttribute('JOINTS_0', acc('VEC4', joints));
    prim.setAttribute('WEIGHTS_0', acc('VEC4', weights));
    const ind = sp.getIndices()?.getArray();
    if (ind) prim.setIndices(acc('SCALAR', new Uint32Array(ind)));

    // the prop's material and texture, copied over (once per source material)
    const sm = sp.getMaterial();
    const key = prop.file + '#' + (sm?.getName() ?? '');
    let mat = cache.get(key);
    if (!mat && sm) {
        mat = doc
            .createMaterial(sm.getName() || 'prop')
            .setBaseColorFactor(sm.getBaseColorFactor())
            .setMetallicFactor(sm.getMetallicFactor())
            .setRoughnessFactor(sm.getRoughnessFactor())
            .setDoubleSided(sm.getDoubleSided());
        const tex = sm.getBaseColorTexture();
        if (tex) mat.setBaseColorTexture(doc.createTexture(tex.getName() || 'prop').setImage(tex.getImage()).setMimeType(tex.getMimeType()));
        cache.set(key, mat);
    }
    if (mat) prim.setMaterial(mat);
    mesh.addPrimitive(prim);
    console.log(`${prop.part} → ${prop.bone} (joint ${boneIndex}), ${n} verts, scale ${s}`);
}
await io.write(outFile, doc);
console.log('wrote', outFile);
