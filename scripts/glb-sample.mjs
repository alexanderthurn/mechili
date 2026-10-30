// Shared by the glb-* scripts: load a GLB (Draco-aware) and sample clip poses.
// Forward-kinematics sampler for glTF clips (shared by the goblin analysis + prep).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
export const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]); return [p[0], p[1], p[2]]; };
export async function load(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
  const doc = await io.read(file);
  return { io, doc };
}
function sampleTrack(times, vals, n, t) {
  if (t <= times[0]) return Array.from(vals.slice(0, n));
  const last = times.length - 1;
  if (t >= times[last]) return Array.from(vals.slice(last * n, last * n + n));
  let i = 0; while (times[i + 1] < t) i++;
  const a = (t - times[i]) / (times[i + 1] - times[i]);
  const o = [];
  if (n === 4) { // nlerp, shortest arc
    let d = 0; for (let k = 0; k < 4; k++) d += vals[i*4+k] * vals[(i+1)*4+k];
    const s = d < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) o.push(vals[i*4+k] * (1 - a) + s * vals[(i+1)*4+k] * a);
    const l = Math.hypot(...o); return o.map((v) => v / l);
  }
  for (let k = 0; k < n; k++) o.push(vals[i*n+k] * (1 - a) + vals[(i+1)*n+k] * a);
  return o;
}
/** world positions of every node at time t of `anim` (null = rest pose) */
export function pose(doc, anim, t) {
  const root = doc.getRoot();
  const local = new Map();
  for (const n of root.listNodes()) local.set(n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() });
  if (anim) for (const c of anim.listChannels()) {
    const s = c.getSampler(); const path = c.getTargetPath(); const n = path === 'rotation' ? 4 : 3;
    local.get(c.getTargetNode())[path[0]] = sampleTrack(s.getInput().getArray(), s.getOutput().getArray(), n, t);
  }
  const world = new Map();
  const visit = (node, pq, pt, ps) => {
    const l = local.get(node);
    const st = [l.t[0]*ps[0], l.t[1]*ps[1], l.t[2]*ps[2]];
    const wt = qrot(pq, st).map((v, k) => v + pt[k]);
    const wq = qmul(pq, l.r); const ws = [ps[0]*l.s[0], ps[1]*l.s[1], ps[2]*l.s[2]];
    world.set(node.getName(), wt);
    for (const c of node.listChildren()) visit(c, wq, wt, ws);
  };
  for (const scene of root.listScenes()) for (const n of scene.listChildren()) visit(n, [0,0,0,1], [0,0,0], [1,1,1]);
  return world;
}
export const duration = (anim) => Math.max(...anim.listSamplers().map((s) => { const a = s.getInput().getArray(); return a[a.length - 1]; }));
