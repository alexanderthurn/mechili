// Close the open holes (boundary loops) of named parts — Tripo's segmentation leaves the cut
// faces of a part open, e.g. a slit along a tank's track belt through which the wheels show.
// Each loop is walked against the mesh's own winding and closed with a fan of triangles that
// reuse the rim's vertices (so the cap takes the rim's colours, no new texture lookups).
//
// usage: node scripts/glb-close-part-holes.mjs in.glb out.glb tripo_part_1 tripo_part_7 …
import { load } from './glb-sample.mjs';

const [inFile, outFile, ...parts] = process.argv.slice(2);
const { io, doc } = await load(inFile);
for (const name of parts) {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
    if (!node?.getMesh()) throw new Error('no part ' + name);
    for (const prim of node.getMesh().listPrimitives()) {
        const P = prim.getAttribute('POSITION').getArray();
        const I = Array.from(prim.getIndices().getArray());
        // weld by position: a uv seam is not a hole
        const key = new Map(), weld = [];
        for (let i = 0; i < P.length / 3; i++) {
            const k = [0, 1, 2].map((j) => Math.round(P[i * 3 + j] * 1e5)).join(',');
            if (!key.has(k)) key.set(k, i);
            weld.push(key.get(k));
        }
        const count = new Map();
        const directed = [];
        for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
            const a = weld[I[t + e]], b = weld[I[t + ((e + 1) % 3)]];
            const k = a < b ? `${a}_${b}` : `${b}_${a}`;
            count.set(k, (count.get(k) ?? 0) + 1);
            directed.push([a, b, k]);
        }
        // the hole runs opposite to its rim triangles' edges: next[b] = a
        const next = new Map();
        for (const [a, b, k] of directed) if (count.get(k) === 1) next.set(b, a);
        const done = new Set();
        let caps = 0;
        for (const start of next.keys()) {
            if (done.has(start)) continue;
            const loop = [];
            for (let v = start; v !== undefined && !done.has(v); v = next.get(v)) { done.add(v); loop.push(v); }
            if (loop.length < 3) continue;
            for (let i = 1; i < loop.length - 1; i++) I.push(loop[0], loop[i], loop[i + 1]);
            caps++;
            console.log(`${name}: closed a ${loop.length}-edge hole`);
        }
        if (caps) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(I)).setBuffer(doc.getRoot().listBuffers()[0]));
    }
}
await io.write(outFile, doc);
console.log('wrote', outFile);
