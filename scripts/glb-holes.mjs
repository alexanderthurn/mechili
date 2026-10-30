// Find holes in GLB meshes: edges used by one triangle (after welding by
// position, so UV seams don't count), grouped into open loops with their size
// and height. Also counts edges shared by 3+ triangles (non-manifold).
//   node scripts/glb-holes.mjs assets/models/units/*.glb
import { load } from './glb-sample.mjs';

for (const file of process.argv.slice(2)) {
    const { doc } = await load(file);
    let loopsTotal = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION').getArray();
        const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        const nv = pos.length / 3;
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
        const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
        const eps = diag * 1e-5;
        const key = new Map(); const weld = new Uint32Array(nv); const upos = [];
        for (let i = 0; i < nv; i++) {
            const k = [0, 1, 2].map((c) => Math.round(pos[i * 3 + c] / eps)).join(',');
            if (!key.has(k)) { key.set(k, key.size); upos.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); }
            weld[i] = key.get(k);
        }
        const edges = new Map();
        for (let f = 0; f < idx.length; f += 3) {
            const t = [weld[idx[f]], weld[idx[f + 1]], weld[idx[f + 2]]];
            if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
            for (let e = 0; e < 3; e++) {
                const a = t[e], c = t[(e + 1) % 3];
                const k = a < c ? `${a}_${c}` : `${c}_${a}`;
                edges.set(k, (edges.get(k) || 0) + 1);
            }
        }
        const adj = new Map(); let open = 0, nonManifold = 0;
        for (const [k, n] of edges) {
            if (n > 2) nonManifold++;
            if (n !== 1) continue;
            open++;
            const [a, c] = k.split('_').map(Number);
            (adj.get(a) || adj.set(a, []).get(a)).push(c);
            (adj.get(c) || adj.set(c, []).get(c)).push(a);
        }
        const seen = new Set(); const loops = [];
        for (const v of adj.keys()) {
            if (seen.has(v)) continue;
            const stack = [v], comp = []; seen.add(v);
            while (stack.length) { const x = stack.pop(); comp.push(x); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
            loops.push(comp);
        }
        loopsTotal += loops.length;
        console.log(`${file.split('/').pop()} ${mesh.getName() || 'mesh'}: ${idx.length / 3} tris, open edges ${open}, loops ${loops.length}, non-manifold edges ${nonManifold}`);
        for (const comp of loops.sort((a, b) => b.length - a.length)) {
            const c = [0, 1, 2].map((k) => comp.reduce((s, v) => s + upos[v][k], 0) / comp.length);
            const r = Math.max(...comp.map((v) => Math.hypot(upos[v][0] - c[0], upos[v][1] - c[1], upos[v][2] - c[2])));
            console.log(`  loop ${comp.length} verts at (${c.map((v) => v.toFixed(3)).join(', ')}), size ${((r / diag) * 100).toFixed(1)}% of model, height ${(((c[1] - mn[1]) / (mx[1] - mn[1])) * 100).toFixed(0)}%`);
        }
    }
    if (loopsTotal === 0) console.log(`${file.split('/').pop()}: closed`);
}
