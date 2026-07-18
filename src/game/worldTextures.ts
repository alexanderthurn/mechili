import { Cache, SRGBColorSpace, Texture, TextureLoader } from 'three';

/** Enable Three's URL cache so map/scenery/weather reloads are free after boot. */
Cache.enabled = true;

const grassAlbedoUrl = new URL('../../assets/textures/grass-albedo.webp', import.meta.url).href;
const grassNormalUrl = new URL('../../assets/textures/grass-normal.webp', import.meta.url).href;
const sandAlbedoUrl = new URL('../../assets/textures/sand-albedo.webp', import.meta.url).href;
const barkUrl = new URL('../../assets/textures/bark.webp', import.meta.url).href;
const foliageUrl = new URL('../../assets/textures/foliage.webp', import.meta.url).href;
const rockUrl = new URL('../../assets/textures/rock.webp', import.meta.url).href;
const moonUrl = new URL('../../assets/textures/moon.webp', import.meta.url).href;

export {
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
};

/** Color (sRGB) maps — normals stay linear. */
const SRGB_URLS = new Set([
    grassAlbedoUrl,
    sandAlbedoUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
]);

/** Every world texture the single map needs — warm at boot. */
export const WORLD_TEXTURE_URLS: readonly string[] = [
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
];

const loader = new TextureLoader();
const textures = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

export type TextureProgress = (done: number, total: number, label: string) => void;

/** Load a texture (warmed at boot). Returns a clone so wrap/repeat stay independent. */
export async function loadWorldTexture(url: string): Promise<Texture | null> {
    let base = textures.get(url);
    if (!base) {
        try {
            base = await loader.loadAsync(url);
            if (SRGB_URLS.has(url)) base.colorSpace = SRGBColorSpace;
            textures.set(url, base);
        } catch {
            return null;
        }
    }
    return base.clone();
}

/** Preload every shared world texture once. Safe to call repeatedly. */
export function preloadWorldTextures(onProgress?: TextureProgress): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const total = WORLD_TEXTURE_URLS.length;
    let done = 0;
    preloadPromise = (async () => {
        await Promise.all(
            WORLD_TEXTURE_URLS.map(async (url) => {
                await loadWorldTexture(url);
                done += 1;
                onProgress?.(done, total, 'World textures');
            }),
        );
    })();
    return preloadPromise;
}
