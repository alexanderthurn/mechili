// One skinned mesh with several materials (e.g. a body + a welded-on weapon from glb-attach)
// → one primitive with one material, because the instanced-skin path draws ONE material:
// the base-colour images go side by side into an atlas (each squeezed to 1/N of the width,
// full height) and every primitive's u is remapped into its slot. Base colour only.
//
// usage: node scripts/glb-merge-materials.mjs in.glb out.glb [atlasSize=2048]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './glb-sample.mjs';

const [inFile, outFile, sizeArg] = process.argv.slice(2);
const SIZE = Number(sizeArg ?? 2048);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const node = root.listNodes().find((n) => n.getSkin() && n.getMesh()) ?? root.listNodes().find((n) => n.getMesh());
const mesh = node.getMesh();
const prims = mesh.listPrimitives();
const mats = [...new Set(prims.map((p) => p.getMaterial()))];
if (mats.length < 2) throw new Error('one material already');
const slot = new Map(mats.map((m, i) => [m, i]));
const N = mats.length;

// merged attributes (every semantic the first primitive has; others must match)
const sems = prims[0].listSemantics();
const merged = Object.fromEntries(sems.map((s) => [s, []]));
const idx = [];
for (const p of prims) {
    const base = merged.POSITION.length / 3;
    const k = slot.get(p.getMaterial());
    for (const s of sems) {
        const a = p.getAttribute(s);
        if (!a) throw new Error(`primitive lacks ${s}`);
        const arr = a.getArray();
        if (s === 'TEXCOORD_0') for (let i = 0; i < arr.length; i += 2) merged[s].push((k + arr[i]) / N, arr[i + 1]);
        else for (const v of arr) merged[s].push(v);
    }
    const ind = p.getIndices()?.getArray() ?? Uint32Array.from({ length: p.getAttribute('POSITION').getCount() }, (_, i) => i);
    for (const v of ind) idx.push(v + base);
}
const prim = doc.createPrimitive().setMaterial(mats[0]).setMode(prims[0].getMode());
for (const s of sems) {
    const a = prims[0].getAttribute(s);
    const Arr = a.getArray().constructor;
    prim.setAttribute(s, doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(new Arr(merged[s])).setBuffer(buffer));
}
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(idx)).setBuffer(buffer));
for (const p of prims) mesh.removePrimitive(p);
mesh.addPrimitive(prim);

// atlas
const dir = mkdtempSync(join(tmpdir(), 'atlas-'));
const files = mats.map((m, i) => {
    const f = join(dir, `${i}`);
    writeFileSync(f, m.getBaseColorTexture().getImage());
    return f;
});
const out = join(dir, 'atlas.png');
execFileSync('python3', ['-c', `
from PIL import Image
import sys
s=int(sys.argv[1]); o=sys.argv[2]; fs=sys.argv[3:]; n=len(fs)
C=Image.new('RGB',(s,s))
for i,f in enumerate(fs): C.paste(Image.open(f).convert('RGB').resize((s//n,s),Image.LANCZOS),(i*s//n,0))
C.save(o)`, String(SIZE), out, ...files]);
mats[0].getBaseColorTexture().setImage(readFileSync(out)).setMimeType('image/png');
rmSync(dir, { recursive: true, force: true });
for (const m of mats.slice(1)) m.dispose();
for (const t of root.listTextures()) if (!t.listParents().some((p) => p !== root)) t.dispose();
await io.write(outFile, doc);
console.log(`merged ${prims.length} primitives / ${N} materials into one (atlas ${SIZE}, ${N} slots) → ${outFile}`);
