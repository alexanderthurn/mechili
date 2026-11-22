// Split one merged mesh into its separate objects: triangles that share a vertex
// position (welded, so UV seams don't cut a part) form an island; islands whose
// boxes overlap or nearly touch (`gap`, in model units) are one object (a rifle's loose
// scope stays with the rifle). Each object becomes its own named node + mesh, centred
// on its own origin, laid out as in the source. Materials and textures are shared.
//
// usage: node scripts/glb-split-parts.mjs in.glb out.glb [gap=0.01] [prefix=part]
//        node scripts/glb-split-parts.mjs in.glb [- gap]    (dry run: list the objects)
import { load } from './glb-sample.mjs';

const [inFile, outFile, gapArg, prefixArg] = process.argv.slice(2);
const GAP = gapArg !== undefined ? Number(gapArg) : 0.01;
const PREFIX = prefixArg ?? 'part';
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

const prims = [];
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) prims.push({ mesh, p });
if (prims.length !== 1) console.warn(`${prims.length} primitives — splitting each on its own`);

const objects = [];
for (const { mesh, p } of prims) {
    const pos = p.getAttribute('POSITION').getArray();
    const idx = p.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const nv = pos.length / 3;

    // weld by position (1e-5 grid) so seams don't split islands
    const key = new Map();
    const weld = new Uint32Array(nv);
    for (let i = 0; i < nv; i++) {
        const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
        let w = key.get(k);
        if (w === undefined) key.set(k, (w = key.size));
        weld[i] = w;
    }
    const parent = new Int32Array(key.size).map((_, i) => i);
    const find = (a) => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]];
        return a;
    };
    const unite = (a, b) => {
        a = find(a);
        b = find(b);
        if (a !== b) parent[a] = b;
    };
    for (let t = 0; t < idx.length; t += 3) {
        unite(weld[idx[t]], weld[idx[t + 1]]);
        unite(weld[idx[t]], weld[idx[t + 2]]);
    }
    // islands: triangles + boxes
    const islands = new Map();
    for (let t = 0; t < idx.length; t += 3) {
        const r = find(weld[idx[t]]);
        let is = islands.get(r);
        if (!is) islands.set(r, (is = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
        is.tris.push(t);
        for (let k = 0; k < 3; k++) {
            const v = idx[t + k];
            for (let a = 0; a < 3; a++) {
                is.min[a] = Math.min(is.min[a], pos[v * 3 + a]);
                is.max[a] = Math.max(is.max[a], pos[v * 3 + a]);
            }
        }
    }
    // group islands whose boxes overlap within GAP
    const list = [...islands.values()];
    const gp = list.map((_, i) => i);
    const gfind = (a) => {
        while (gp[a] !== a) a = gp[a] = gp[gp[a]];
        return a;
    };
    const near = (a, b) => [0, 1, 2].every((k) => a.min[k] <= b.max[k] + GAP && b.min[k] <= a.max[k] + GAP);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (near(list[i], list[j])) gp[gfind(i)] = gfind(j);
    const groups = new Map();
    list.forEach((is, i) => {
        const g = gfind(i);
        if (!groups.has(g)) groups.set(g, { islands: [], tris: [], min: [...is.min], max: [...is.max] });
        const G = groups.get(g);
        G.islands.push(is);
        G.tris.push(...is.tris);
        for (let a = 0; a < 3; a++) {
            G.min[a] = Math.min(G.min[a], is.min[a]);
            G.max[a] = Math.max(G.max[a], is.max[a]);
        }
    });
    console.log(`${mesh.getName() || 'mesh'}: ${idx.length / 3} tris, ${list.length} islands → ${groups.size} objects (gap ${GAP})`);
    for (const G of groups.values()) objects.push({ ...G, p, idx });
}

// sort left → right (x), then name
objects.sort((a, b) => a.min[0] + a.max[0] - (b.min[0] + b.max[0]));
objects.forEach((o, i) => {
    o.name = `${PREFIX}_${String(i + 1).padStart(2, '0')}`;
    const size = o.max.map((v, k) => v - o.min[k]);
    const c = o.min.map((v, k) => (v + o.max[k]) / 2);
    o.center = c;
    console.log(
        `${o.name}  tris ${String(o.tris.length).padStart(5)}  islands ${String(o.islands.length).padStart(3)}  ` +
            `size ${size.map((v) => v.toFixed(3)).join(' × ')}  at ${c.map((v) => v.toFixed(3)).join(', ')}`,
    );
});
if (!outFile || outFile === '-') process.exit(0);

// build: one node + mesh per object, vertices re-indexed, centred on the object
const scene = root.listScenes()[0] ?? doc.createScene();
const oldNodes = root.listNodes().filter((n) => n.getMesh());
for (const o of objects) {
    const src = o.p;
    const map = new Map();
    const order = [];
    for (const t of o.tris) for (let k = 0; k < 3; k++) {
        const v = o.idx[t + k];
        if (!map.has(v)) {
            map.set(v, order.length);
            order.push(v);
        }
    }
    const prim = doc.createPrimitive().setMaterial(src.getMaterial()).setMode(src.getMode());
    for (const sem of src.listSemantics()) {
        const acc = src.getAttribute(sem);
        const n = acc.getElementSize();
        const a = acc.getArray();
        const out = new (a.constructor)(order.length * n);
        order.forEach((v, i) => {
            for (let k = 0; k < n; k++) out[i * n + k] = a[v * n + k];
        });
        if (sem === 'POSITION') for (let i = 0; i < order.length; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] -= o.center[k];
        prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(out).setNormalized(acc.getNormalized()).setBuffer(buffer));
    }
    const ind = new Uint32Array(o.tris.length * 3);
    o.tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) ind[i * 3 + k] = map.get(o.idx[t + k]);
    });
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ind).setBuffer(buffer));
    const mesh = doc.createMesh(o.name).addPrimitive(prim);
    scene.addChild(doc.createNode(o.name).setMesh(mesh).setTranslation(o.center));
}
for (const n of oldNodes) n.dispose();
for (const m of root.listMeshes()) if (!objects.some((o) => o.name === m.getName())) m.dispose();
await io.write(outFile, doc);
console.log('wrote', outFile, objects.length, 'objects');
