import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const backendDir = resolve('backend');

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
    },
    plugins: [copyBackend()],
});
