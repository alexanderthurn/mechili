// Add an empty node (e.g. AttackNode, Flag) under a joint, placed at a model-space
// position in the bind pose — exporters like Tripo drop such empties when rigging.
//   node scripts/glb-add-node.mjs in.glb out.glb AttackNode mixamorig:LeftHand 0.196,0.713,0.267
import { Matrix4, Vector3 } from 'three';
import { load } from './glb-sample.mjs';

const [inFile, outFile, name, parentName, at] = process.argv.slice(2);
const { io, doc } = await load(inFile);
const root = doc.getRoot();
const parent = root.listNodes().find((n) => n.getName() === parentName);
if (!parent) throw new Error(`no joint ${parentName}`);
if (root.listNodes().some((n) => n.getName() === name)) throw new Error(`${name} already exists`);
const world = new Vector3(...at.split(',').map(Number));
const local = world.clone().applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
parent.addChild(doc.createNode(name).setTranslation(local.toArray()));
await io.write(outFile, doc);
console.log(`${name} under ${parentName} at (${world.toArray()}) → local (${local.toArray().map((v) => v.toFixed(4))})`);
