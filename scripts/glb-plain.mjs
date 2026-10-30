// Plain copies of game GLBs for tools that can't read our compression (Tripo
// Studio, many viewers): Draco geometry decoded, WebP textures re-encoded as PNG.
//   node scripts/glb-plain.mjs <out-dir> assets/models/units/*.glb
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './glb-sample.mjs';

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || files.length === 0) throw new Error('usage: node scripts/glb-plain.mjs <out-dir> <file.glb>…');
mkdirSync(outDir, { recursive: true });
const written = [];
for (const file of files) {
    const { io, doc } = await load(file);
    for (const ext of doc.getRoot().listExtensionsUsed()) {
        if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
    }
    const out = join(outDir, basename(file));
    await io.write(out, doc);
    written.push(out);
}
const here = dirname(fileURLToPath(import.meta.url));
execFileSync('python3', [join(here, 'glb-textures-png.py'), ...written], { stdio: 'inherit' });
