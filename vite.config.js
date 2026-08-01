import { execSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const backendDir = resolve('backend');
const { version: appVersion } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));

/** Current git branch at `vite` / `vite build` time — empty if unknown. */
function gitBranch() {
    try {
        const name = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
        return name === 'HEAD' ? '' : name;
    } catch {
        return '';
    }
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
    },
    plugins: [copyBackend()],
});
