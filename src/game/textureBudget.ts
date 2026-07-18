/**
 * Texture memory budget for model loading. Tripo GLBs ship 2K–4K PBR texture
 * sets; decoded that is hundreds of MB — mobile Safari kills the tab for it
 * (during boot, or on first render when three.js lazily uploads textures).
 * Downscaling at load time caps the peak before it can hurt.
 */

import type { Material, Mesh, Object3D, Texture } from 'three';
import { touchFirstDevice } from './inputCapabilities';

/** Longest texture edge allowed on this device (null = keep originals). */
export function modelTextureBudget(): number | null {
    return touchFirstDevice() ? 1024 : null;
}

const TEXTURE_SLOTS = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'emissiveMap',
] as const;

function downscale(tex: Texture, maxSize: number): void {
    const img = tex.image as
        | { width?: number; height?: number; close?: () => void }
        | undefined;
    if (!img?.width || !img.height) return;
    if (Math.max(img.width, img.height) <= maxSize) return;
    const scale = maxSize / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, w, h);
    tex.image = canvas;
    tex.needsUpdate = true;
    // ImageBitmap: release the full-size decode immediately instead of
    // waiting for GC — the whole point is capping the peak
    img.close?.();
}

/** Shrinks every texture under `root` to the budget. Call before cloning. */
export function applyTextureBudget(root: Object3D, maxSize: number): void {
    const seen = new Set<Texture>();
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats: (Material | null)[] = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
        for (const m of mats) {
            if (!m) continue;
            for (const slot of TEXTURE_SLOTS) {
                const tex = (m as unknown as Record<string, Texture | undefined>)[slot];
                if (!tex || (tex as { isCompressedTexture?: boolean }).isCompressedTexture) continue;
                if (seen.has(tex)) continue;
                seen.add(tex);
                downscale(tex, maxSize);
            }
        }
    });
}
