/**
 * Melodan model viewer — a standalone page, apart from the game's code.
 *
 *   npx vite --config misc/model-viewer/vite.config.ts      (from the repo root)
 *
 * Lists every .glb under assets/models/ and misc/ (raw material in misc/model-viewer/raw/),
 * plays their clips, and keeps one "recipe" per model in recipes/ (which clip plays
 * walk / fire / idle / death) — written by the page's role buttons, readable by hand.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const recipesDir = join(here, 'recipes');

/** a repo-relative path, refused when it leaves the repo */
function inRepo(rel: string): string | null {
    const abs = resolve(repo, rel);
    return abs === repo || abs.startsWith(repo + sep) ? abs : null;
}

function walk(dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs, out);
        else if (name.toLowerCase().endsWith('.glb')) out.push(abs);
    }
}

function groupOf(rel: string): string {
    if (rel.startsWith('misc/model-viewer/raw/')) return 'Raw material';
    if (rel.startsWith('misc/model-viewer/out/')) return 'Finished (viewer)';
    if (rel.startsWith('assets/models/units/')) return 'Game units';
    if (rel.startsWith('assets/models/')) return 'Game: ' + (rel.split('/')[2]?.replace(/\.glb$/, '') ?? 'other');
    return 'misc';
}

function recipePath(model: string): string {
    const slug = model.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9]+/g, '_');
    return join(recipesDir, slug + '.json');
}

function api(): Plugin {
    return {
        name: 'model-viewer-api',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://x');
                const send = (code: number, body: unknown) => {
                    res.statusCode = code;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify(body));
                };
                if (url.pathname === '/api/models') {
                    const files: string[] = [];
                    walk(join(repo, 'assets/models'), files);
                    walk(join(repo, 'misc'), files);
                    send(
                        200,
                        files.map((abs) => {
                            const rel = relative(repo, abs).split(sep).join('/');
                            return { path: rel, group: groupOf(rel), size: statSync(abs).size };
                        }),
                    );
                    return;
                }
                if (url.pathname === '/api/file') {
                    const abs = inRepo(url.searchParams.get('path') ?? '');
                    if (!abs || !existsSync(abs)) return send(404, { error: 'not found' });
                    res.setHeader('content-type', 'model/gltf-binary');
                    res.setHeader('content-length', String(statSync(abs).size));
                    createReadStream(abs).pipe(res);
                    return;
                }
                if (url.pathname === '/api/recipe') {
                    const model = url.searchParams.get('model') ?? '';
                    if (!inRepo(model)) return send(400, { error: 'bad model' });
                    const file = recipePath(model);
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', (c) => (body += c));
                        req.on('end', () => {
                            try {
                                const data = JSON.parse(body);
                                mkdirSync(recipesDir, { recursive: true });
                                writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
                                send(200, { ok: true });
                            } catch (e) {
                                send(400, { error: String(e) });
                            }
                        });
                        return;
                    }
                    if (!existsSync(file)) return send(200, null);
                    send(200, JSON.parse(readFileSync(file, 'utf8')));
                    return;
                }
                next();
            });
        },
    };
}

export default defineConfig({
    root: here,
    // the game's Draco decoder (public/draco/) — the game's models are Draco-compressed
    publicDir: join(repo, 'public'),
    server: { port: 5180, strictPort: true, host: true, fs: { allow: [repo] } },
    // the recipes are written by the page itself: no reload loop
    plugins: [api()],
    clearScreen: false,
});
