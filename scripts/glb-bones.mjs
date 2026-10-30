// Bone survey for a rigged GLB: each joint, its parent, its bind position and the
// vertices it moves (count, centroid, extent) — tells wings from tail from rider
// when the rig uses generic names (bone_14 …).
//   node scripts/glb-bones.mjs model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]);
const skin = doc.getRoot().listSkins()[0];
const joints = skin.listJoints();
const parentOf = new Map();
for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0').getArray();
let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9]; for(let i=0;i<P.length;i+=3)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],P[i+k]);mx[k]=Math.max(mx[k],P[i+k]);}
console.log('mesh bbox', mn.map(v=>v.toFixed(3)), mx.map(v=>v.toFixed(3)), 'tris', prim.getIndices().getCount()/3);
const stats = joints.map(() => ({ n: 0, s: [0,0,0], mn: [1e9,1e9,1e9], mx: [-1e9,-1e9,-1e9] }));
for (let v = 0; v < P.length/3; v++) for (let k = 0; k < 4; k++) {
  const w = W[v*4+k]; if (w < 0.5) continue; const st = stats[J[v*4+k]]; st.n++;
  for (let c = 0; c < 3; c++) { const p = P[v*3+c]; st.s[c] += p; st.mn[c] = Math.min(st.mn[c], p); st.mx[c] = Math.max(st.mx[c], p); }
}
// bind-pose world position = inverse of inverseBindMatrix translation
const ibm = skin.getInverseBindMatrices().getArray();
const inv = (m) => { // invert affine 4x4 column-major, return translation
  const r = [[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]]; const t=[m[12],m[13],m[14]];
  // inverse rotation (assume orthonormal * uniform scale)
  const s2 = r[0][0]**2+r[1][0]**2+r[2][0]**2;
  return [0,1,2].map(i => -(r[0][i]*t[0]+r[1][i]*t[1]+r[2][i]*t[2])/s2);
};
joints.forEach((j, i) => {
  const st = stats[i]; const pos = inv(ibm.slice(i*16, i*16+16));
  const c = st.n ? st.s.map(v => (v/st.n).toFixed(3)) : '-';
  console.log(`${String(i).padStart(2)} ${j.getName().padEnd(22)} parent ${(parentOf.get(j)?.getName()||'-').padEnd(22)} joint@ ${pos.map(v=>v.toFixed(3)).join(',').padEnd(22)} verts ${String(st.n).padStart(5)} centroid ${c} ${st.n?'x '+st.mn[0].toFixed(2)+'..'+st.mx[0].toFixed(2)+' y '+st.mn[1].toFixed(2)+'..'+st.mx[1].toFixed(2)+' z '+st.mn[2].toFixed(2)+'..'+st.mx[2].toFixed(2):''}`);
});
