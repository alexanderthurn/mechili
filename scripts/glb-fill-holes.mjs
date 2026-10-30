// Close small holes (open boundary loops) in a GLB by ear-clipping each loop from
// its existing rim vertices — no new vertices, so UVs, skin weights and clips stay
// valid. Big or irregular loops are listed, not filled (MAX_R / MAX_V env vars).
//   node scripts/glb-fill-holes.mjs in.glb            # dry run: what would be filled
//   node scripts/glb-fill-holes.mjs in.glb out.glb    # write the filled model
// Re-encodes Draco on write. Check the result with scripts/glb-holes.mjs.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const [inFile, outFile] = process.argv.slice(2);
const DRY = !outFile;
// loops bigger than this (fraction of the model's diagonal, or vertex count) are reported, not filled
const MAX_R = Number(process.env.MAX_R ?? 0.1), MAX_V = Number(process.env.MAX_V ?? 16);
let filledTotal = 0, skippedTotal = 0;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(inFile);
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idxAcc = prim.getIndices();
  const idx = Array.from(idxAcc.getArray());
  const nv = pos.length / 3;
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i*3+k]); mx[k] = Math.max(mx[k], pos[i*3+k]); }
  const diag = Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]);
  const eps = diag * 1e-5;
  const keyMap = new Map(); const weld = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = [0,1,2].map(c => Math.round(pos[i*3+c] / eps)).join(',');
    if (!keyMap.has(k)) keyMap.set(k, keyMap.size);
    weld[i] = keyMap.get(k);
  }
  // per undirected edge: signed count of a->b vs b->a half-edges. An odd edge
  // (open rim, or a 3-triangle fin edge) leaves |net| unpaired rim half-edges.
  const count = new Map(); const net = new Map(); const corner = new Map();
  for (let f = 0; f < idx.length; f += 3) for (let e = 0; e < 3; e++) {
    const oa = idx[f+e], ob = idx[f+(e+1)%3];
    const a = weld[oa], b = weld[ob];
    if (a === b) continue;
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    count.set(k, (count.get(k) || 0) + 1);
    net.set(k, (net.get(k) || 0) + (a < b ? 1 : -1));
    corner.set(`${a}>${b}`, [oa, ob]);
  }
  // rim = odd edges (open, or 3-triangle fins). Build loops undirected — fin
  // windings disagree — then orient each loop against its rim triangles.
  const adj = new Map(); const orig = new Map();
  for (const [k, n] of count) {
    if (n % 2 === 0) continue;
    const [lo, hi] = k.split('_').map(Number);
    (adj.get(lo) || adj.set(lo, []).get(lo)).push(hi);
    (adj.get(hi) || adj.set(hi, []).get(hi)).push(lo);
    for (const [x, y] of [[lo, hi], [hi, lo]]) {
      const c = corner.get(`${x}>${y}`);
      if (c) { if (!orig.has(x)) orig.set(x, c[0]); if (!orig.has(y)) orig.set(y, c[1]); }
    }
  }
  const take = (u, v) => { const l = adj.get(u); l.splice(l.indexOf(v), 1); const m = adj.get(v); m.splice(m.indexOf(u), 1); };
  const loops = [];
  for (const start of [...adj.keys()]) {
    while (adj.get(start).length) {
      let path = [start]; let v = start;
      while (true) {
        const nx = adj.get(v)[0];
        if (nx === undefined) throw new Error('open chain at ' + v);
        take(v, nx);
        const at = path.indexOf(nx);
        if (at < 0) { path.push(nx); v = nx; continue; }
        loops.push(path.slice(at));
        path = path.slice(0, at + 1); v = nx;
        if (path.length === 1) break;
      }
    }
  }
  for (const loop of loops) {
    // rim triangles run u>v where the fill must run v>u
    let vote = 0;
    for (let i = 0; i < loop.length; i++) {
      const u = loop[i], v = loop[(i + 1) % loop.length];
      if (corner.has(`${u}>${v}`)) vote--; if (corner.has(`${v}>${u}`)) vote++;
    }
    if (vote < 0) loop.reverse();
    if (vote === 0) console.log('  warning: loop orientation tie, kept as walked');
  }
  const added = [];
  for (const loop of loops) {
    // ear clipping in the loop's best-fit plane (Newell normal)
    const P = loop.map(w => { const o = orig.get(w); return [pos[o*3], pos[o*3+1], pos[o*3+2]]; });
    const C = [0,1,2].map(k => P.reduce((s, p) => s + p[k], 0) / P.length);
    const R = Math.max(...P.map(p => Math.hypot(p[0]-C[0], p[1]-C[1], p[2]-C[2]))) / diag;
    const H = (C[1] - mn[1]) / (mx[1] - mn[1]);
    if (R > MAX_R || loop.length > MAX_V) {
      skippedTotal++;
      console.log(`  SKIP loop ${loop.length} verts, size ${(R*100).toFixed(1)}% of model, height ${(H*100).toFixed(0)}%`);
      continue;
    }
    filledTotal++;
    const nrm = [0,0,0];
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i+1)%P.length];
      nrm[0] += (p[1]-q[1])*(p[2]+q[2]); nrm[1] += (p[2]-q[2])*(p[0]+q[0]); nrm[2] += (p[0]-q[0])*(p[1]+q[1]); }
    const ax = nrm.map(Math.abs); const drop = ax.indexOf(Math.max(...ax));
    const [u, w] = [0,1,2].filter(c => c !== drop);
    const sgn = Math.sign(nrm[drop]) || 1;
    const p2 = P.map(p => [p[u], p[w] * sgn * (drop === 1 ? -1 : 1)]);
    const area2 = (a, b, c) => (p2[b][0]-p2[a][0])*(p2[c][1]-p2[a][1]) - (p2[b][1]-p2[a][1])*(p2[c][0]-p2[a][0]);
    let ring = loop.map((_, i) => i); const ccw = ring.reduce((s, i) => s + area2(0, i, (i+1)%ring.length), 0) > 0 ? 1 : -1;
    const tris = [];
    let guard = 0;
    while (ring.length > 3 && guard++ < 1000) {
      let clipped = false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i-1+ring.length)%ring.length], b = ring[i], c = ring[(i+1)%ring.length];
        if (area2(a, b, c) * ccw <= 0) continue;
        const inside = ring.some(d => d!==a && d!==b && d!==c &&
          area2(a,b,d)*ccw >= 0 && area2(b,c,d)*ccw >= 0 && area2(c,a,d)*ccw >= 0);
        if (inside) continue;
        tris.push([a, b, c]); ring.splice(i, 1); clipped = true; break;
      }
      if (!clipped) { // degenerate projection — fall back to a fan
        for (let i = 1; i < ring.length - 1; i++) tris.push([ring[0], ring[i], ring[i+1]]);
        ring = [];
      }
    }
    if (ring.length === 3) tris.push(ring);
    for (const t of tris) added.push(...t.map(i => orig.get(loop[i])));
  }
  const IdxArr = idxAcc.getArray().constructor;
  idxAcc.setArray(new IdxArr([...idx, ...added]));
  console.log(`${mesh.getName() || 'mesh'}: ${idx.length/3} -> ${(idx.length + added.length)/3} tris`);
}
console.log(`  => filled ${filledTotal}, skipped ${skippedTotal}`);
if (!DRY) await io.write(outFile, doc);
