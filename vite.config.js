import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { defineConfig } from 'vite';

const backendDir = resolve('backend');
const { version: appVersion, steamElectronBuild } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
/** The app id this build is *made for* — Steam launches a playtest/demo under a different one. */
const steamAppId = Number(steamElectronBuild?.steamAppId) || 0;

/** Current git branch at `vite` / `vite build` time — empty if unknown. */
function gitBranch() {
    try {
        const name = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
        return name === 'HEAD' ? '' : name;
    } catch {
        return '';
    }
}

/**
 * SHA-256 over every file the game loads (plan §17.6): the asset manifest's
 * files plus all of assets/data. Compared in the multiplayer handshakes next to
 * the version, so two builds with the same version but different content —
 * a replaced texture, an edited unit — cannot play together. Computed once when
 * Vite starts (≈0.1 s); a dev server needs a restart to pick up asset edits.
 */
function contentHash() {
    const walk = (dir) =>
        readdirSync(dir).flatMap((name) => {
            const p = resolve(dir, name);
            return statSync(p).isDirectory() ? walk(p) : [p];
        });
    const manifest = readFileSync(resolve('src/game/assetManifest.ts'), 'utf8');
    const listed = [...manifest.matchAll(/'\.\.\/\.\.\/assets\/([^']+)'/g)].map((m) => m[1]);
    const data = walk(resolve('assets/data')).map((p) => relative(resolve('assets'), p).split('\\').join('/'));
    const hash = createHash('sha256');
    for (const file of [...new Set([...listed, ...data])].sort()) {
        let bytes = readFileSync(resolve('assets', file));
        // text files: CRLF → LF, so a Windows checkout (git autocrlf) and a
        // macOS/Linux checkout of the same commit produce the same hash
        if (/\.(jsonc?|txt|csv|svg)$/i.test(file)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
        hash.update(file).update('\0').update(bytes).update('\0');
    }
    return hash.digest('hex');
}

/** Copy backend/ (PHP matchmaking, etc.) into dist alongside the game bundle. */
function copyBackend() {
    return {
        name: 'copy-backend',
        closeBundle() {
            cpSync(backendDir, resolve('dist/backend'), { recursive: true });
        },
    };
}

export default defineConfig({
    // Relative paths so the build works from file:// inside Electron.
    base: './',
    build: {
        target: 'esnext',
        rollupOptions: {
            input: {
                main: resolve('index.html'),
                web: resolve('web.html'),
            },
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __GIT_BRANCH__: JSON.stringify(gitBranch()),
        __STEAM_APP_ID__: JSON.stringify(steamAppId),
        __CONTENT_HASH__: JSON.stringify(contentHash()),
    },
    plugins: [copyBackend()],
});
