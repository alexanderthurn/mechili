// Paint decals ON THE SURFACE of a model, not in texture space: every texel of the faces near a
// decal is mapped back to its 3D point, and the decal's shape is tested there — so a cross sits
// square on the hull however the UV islands are stretched. Writes a coverage mask (PGM, texture
// size) that a compositing step (python/cv2) multiplies into the base colour.
//
// usage: node scripts/glb-decal-mask.mjs model.glb mask.pgm '<plan json>'
// plan: { "size": 2048, "decals": [ { "shape": "crossPattee", "centre": [x,y,z], "normal": [x,y,z],
//          "up": [x,y,z], "radius": 0.035, "parts": ["tripo_part_2"] } ] }
//   centre/normal/up in model space (node translations applied); `up` = the decal's upright,
//   projected onto the surface plane; faces must face the normal (dot > 0.5) and lie within
//   radius × 0.5 of the plane.
import { writeFileSync } from 'node:fs';
import { load } from './glb-sample.mjs';

const [inFile, outFile, planJson] = process.argv.slice(2);
const plan = JSON.parse(planJson);
const S = plan.size ?? 2048;
const SS = 3; // supersamples per axis
const mask = new Float32Array(S * S);
const { doc } = await load(inFile);

const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// a cross pattée (the Teutonic Order's): four arms, narrow at the centre, flaring to the ends
const shapes = {
    crossPattee: (u, v) => {
        const a = Math.abs(u), b = Math.abs(v);
        const along = Math.max(a, b), across = Math.min(a, b);
        if (along > 1) return false;
        return across <= 0.13 + (0.42 - 0.13) * along;
    },
};

for (const d of plan.decals) {
    const n = norm(d.normal);
    const up0 = d.up ?? [0, 1, 0];
    const vAxis = norm(sub(up0, n.map((x) => x * dot(up0, n)))); // upright, in the plane
    const uAxis = cross(vAxis, n);
    const shape = shapes[d.shape ?? 'crossPattee'];
    let hits = 0;
    for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh || (d.parts && !d.parts.includes(node.getName()))) continue;
        const W = node.getWorldMatrix();
        const tp = (p) => [0, 1, 2].map((r) => W[r] * p[0] + W[4 + r] * p[1] + W[8 + r] * p[2] + W[12 + r]);
        for (const prim of mesh.listPrimitives()) {
            const P = prim.getAttribute('POSITION').getArray();
            const U = prim.getAttribute('TEXCOORD_0').getArray();
            const I = prim.getIndices().getArray();
            for (let t = 0; t < I.length; t += 3) {
                const v = [0, 1, 2].map((j) => tp([P[I[t + j] * 3], P[I[t + j] * 3 + 1], P[I[t + j] * 3 + 2]]));
                const fn = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
                if (dot(fn, n) < 0.5) continue;
                // near the decal at all?
                const local = v.map((p) => { const q = sub(p, d.centre); return [dot(q, uAxis) / d.radius, dot(q, vAxis) / d.radius, dot(q, n)]; });
                if (local.every((q) => q[0] > 1.05) || local.every((q) => q[0] < -1.05) || local.every((q) => q[1] > 1.05) || local.every((q) => q[1] < -1.05)) continue;
                if (local.every((q) => Math.abs(q[2]) > d.radius * 0.5)) continue;
                // rasterise the triangle in texel space, barycentric → local decal coords
                const uv = [0, 1, 2].map((j) => [U[I[t + j] * 2] * S, U[I[t + j] * 2 + 1] * S]);
                const x0 = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[0])))), x1 = Math.min(S - 1, Math.ceil(Math.max(...uv.map((p) => p[0]))));
                const y0 = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[1])))), y1 = Math.min(S - 1, Math.ceil(Math.max(...uv.map((p) => p[1]))));
                const den = (uv[1][1] - uv[2][1]) * (uv[0][0] - uv[2][0]) + (uv[2][0] - uv[1][0]) * (uv[0][1] - uv[2][1]);
                if (Math.abs(den) < 1e-9) continue;
                for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                    let cov = 0, inside = 0;
                    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
                        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
                        const w0 = ((uv[1][1] - uv[2][1]) * (px - uv[2][0]) + (uv[2][0] - uv[1][0]) * (py - uv[2][1])) / den;
                        const w1 = ((uv[2][1] - uv[0][1]) * (px - uv[2][0]) + (uv[0][0] - uv[2][0]) * (py - uv[2][1])) / den;
                        const w2 = 1 - w0 - w1;
                        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue; // a hair over the edge: no seam gaps
                        inside++;
                        const lu = w0 * local[0][0] + w1 * local[1][0] + w2 * local[2][0];
                        const lv = w0 * local[0][1] + w1 * local[1][1] + w2 * local[2][1];
                        if (shape(lu, lv)) cov++;
                    }
                    if (inside) {
                        mask[y * S + x] = Math.max(mask[y * S + x], cov / (SS * SS));
                        if (cov) hits++;
                    }
                }
            }
        }
    }
    console.log(`decal at ${d.centre.map((x) => x.toFixed(3))}: ${hits} texels`);
}
const out = Buffer.alloc(S * S);
for (let i = 0; i < S * S; i++) out[i] = Math.round(Math.min(1, mask[i]) * 255);
writeFileSync(outFile, Buffer.concat([Buffer.from(`P5\n${S} ${S}\n255\n`), out]));
console.log('wrote', outFile);
