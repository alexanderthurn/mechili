import { Cache, SRGBColorSpace, Texture, TextureLoader } from 'three';

import { groundMaterialProfile } from './groundQuality';

/** Enable Three's URL cache so map/scenery/weather reloads are free after boot. */
Cache.enabled = true;

// Vite only rewrites `new URL('literal', import.meta.url)` — a helper hides the
// path from static analysis, so production would request /assets/textures/... and 404.
const grassAlbedoUrl = new URL('../../assets/textures/grass-albedo.webp', import.meta.url).href;
const grassNormalUrl = new URL('../../assets/textures/grass-normal.webp', import.meta.url).href;
const grassAlbedoHqUrl = new URL('../../assets/textures/grass-albedo-hq.webp', import.meta.url).href;
const grassNormalHqUrl = new URL('../../assets/textures/grass-normal-hq.webp', import.meta.url).href;
const sandAlbedoUrl = new URL('../../assets/textures/sand-albedo.webp', import.meta.url).href;
const sandNormalUrl = new URL('../../assets/textures/sand-normal.webp', import.meta.url).href;
/** Lake-shore gravel (from misc/photos/water/wsc_s.png) — outer meadow beaches. */
const shoreAlbedoUrl = new URL('../../assets/textures/shore-albedo.webp', import.meta.url).href;
const shoreNormalUrl = new URL('../../assets/textures/shore-normal.webp', import.meta.url).href;
/** Board wear / footprints (from misc/photos/grass/IMG_4881.JPG). */
const wearAlbedoUrl = new URL('../../assets/textures/wear-albedo.webp', import.meta.url).href;
const wearNormalUrl = new URL('../../assets/textures/wear-normal.webp', import.meta.url).href;
const dirtAlbedoHqUrl = new URL('../../assets/textures/dirt-albedo-hq.webp', import.meta.url).href;
const dirtNormalHqUrl = new URL('../../assets/textures/dirt-normal-hq.webp', import.meta.url).href;
const barkUrl = new URL('../../assets/textures/bark.webp', import.meta.url).href;
const foliageUrl = new URL('../../assets/textures/foliage.webp', import.meta.url).href;
const rockUrl = new URL('../../assets/textures/rock.webp', import.meta.url).href;
const moonUrl = new URL('../../assets/textures/moon.webp', import.meta.url).href;
const iceAlbedoUrl = new URL('../../assets/textures/ice-albedo.webp', import.meta.url).href;

/** Field-photo tiles (processed from misc/photos/ via process-ground-photos.py). */
const GRASS_PHOTO = [
    {
        albedo: new URL('../../assets/textures/grass-photo-0.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/grass-photo-0-normal.webp', import.meta.url).href,
    },
    {
        albedo: new URL('../../assets/textures/grass-photo-1.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/grass-photo-1-normal.webp', import.meta.url).href,
    },
    {
        albedo: new URL('../../assets/textures/grass-photo-2.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/grass-photo-2-normal.webp', import.meta.url).href,
    },
] as const;

const DIRT_PHOTO = [
    {
        albedo: new URL('../../assets/textures/dirt-photo-0.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/dirt-photo-0-normal.webp', import.meta.url).href,
    },
    {
        albedo: new URL('../../assets/textures/dirt-photo-1.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/dirt-photo-1-normal.webp', import.meta.url).href,
    },
    {
        albedo: new URL('../../assets/textures/dirt-photo-2.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/dirt-photo-2-normal.webp', import.meta.url).href,
    },
] as const;

const ROCK_PHOTO = [
    {
        albedo: new URL('../../assets/textures/rock-photo-0.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/rock-photo-0-normal.webp', import.meta.url).href,
    },
    {
        albedo: new URL('../../assets/textures/rock-photo-1.webp', import.meta.url).href,
        normal: new URL('../../assets/textures/rock-photo-1-normal.webp', import.meta.url).href,
    },
] as const;

export {
    grassAlbedoUrl,
    grassNormalUrl,
    grassAlbedoHqUrl,
    grassNormalHqUrl,
    sandAlbedoUrl,
    sandNormalUrl,
    shoreAlbedoUrl,
    shoreNormalUrl,
    wearAlbedoUrl,
    wearNormalUrl,
    dirtAlbedoHqUrl,
    dirtNormalHqUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
    iceAlbedoUrl,
};

export interface PhotoTextureSet {
    albedo: Texture;
    normal: Texture | null;
    /** Extra albedo tiles blended stochastically to break repetition. */
    variants: Texture[];
}

/** Color (sRGB) maps — normals stay linear. */
const SRGB_URLS = new Set<string>([
    grassAlbedoUrl,
    grassAlbedoHqUrl,
    sandAlbedoUrl,
    shoreAlbedoUrl,
    wearAlbedoUrl,
    dirtAlbedoHqUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
    iceAlbedoUrl,
    ...GRASS_PHOTO.map((p) => p.albedo),
    ...DIRT_PHOTO.map((p) => p.albedo),
    ...ROCK_PHOTO.map((p) => p.albedo),
]);

/** Every world texture the single map needs — warm at boot. */
export const WORLD_TEXTURE_URLS: readonly string[] = [
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    shoreAlbedoUrl,
    wearAlbedoUrl,
    barkUrl,
    foliageUrl,
    rockUrl,
    moonUrl,
    iceAlbedoUrl,
];

/** HQ + field-photo set — only preloaded when the active tier wants it. */
export function hqGrassUrlsForBoot(): readonly string[] {
    if (!groundMaterialProfile().useHqTextures) return [];
    return [
        grassAlbedoHqUrl,
        grassNormalHqUrl,
        dirtAlbedoHqUrl,
        dirtNormalHqUrl,
        // Grass photos only as sparse accents (dirt photos kept on disk, unused for now)
        ...GRASS_PHOTO.map((p) => p.albedo),
        ...ROCK_PHOTO.flatMap((p) => [p.albedo, p.normal]),
        sandNormalUrl,
    ];
}

const loader = new TextureLoader();
const textures = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

export type TextureProgress = (done: number, total: number, label: string) => void;

/** Load a texture (warmed at boot). Returns a clone so wrap/repeat stay independent. */
export async function loadWorldTexture(texUrl: string): Promise<Texture | null> {
    let base = textures.get(texUrl);
    if (!base) {
        try {
            base = await loader.loadAsync(texUrl);
            if (SRGB_URLS.has(texUrl)) base.colorSpace = SRGBColorSpace;
            textures.set(texUrl, base);
        } catch {
            return null;
        }
    }
    return base.clone();
}

async function loadPhotoSet(
    specs: readonly { albedo: string; normal: string }[],
): Promise<PhotoTextureSet | null> {
    const loaded = await Promise.all(
        specs.map(async (spec) => ({
            albedo: await loadWorldTexture(spec.albedo),
            normal: await loadWorldTexture(spec.normal),
        })),
    );
    if (!loaded[0]?.albedo) return null;
    const variants = loaded
        .slice(1)
        .map((l) => l.albedo)
        .filter((t): t is Texture => t !== null);
    return {
        albedo: loaded[0].albedo,
        normal: loaded[0].normal,
        variants,
    };
}

/**
 * Grass base is the authored HQ lawn. Field grass photos are soft, sparse
 * accents to break tiling — not a full replacement (they're too close-up).
 */
export async function loadGrassTextures(): Promise<PhotoTextureSet | null> {
    if (groundMaterialProfile().useHqTextures) {
        const [albedo, normal, grassVars] = await Promise.all([
            loadWorldTexture(grassAlbedoHqUrl),
            loadWorldTexture(grassNormalHqUrl),
            Promise.all(GRASS_PHOTO.map((p) => loadWorldTexture(p.albedo))),
        ]);
        if (albedo) {
            const variants = grassVars.filter((t): t is Texture => t !== null);
            return { albedo, normal, variants };
        }
    }
    const [albedo, normal] = await Promise.all([
        loadWorldTexture(grassAlbedoUrl),
        loadWorldTexture(grassNormalUrl),
    ]);
    if (!albedo) return null;
    return { albedo, normal, variants: [] };
}

/**
 * Wear / footprint surface:
 * - high/ultra: packed HQ dirt (original HQ wear)
 * - low/medium: sand
 */
export async function loadWearGroundTextures(): Promise<PhotoTextureSet | null> {
    if (groundMaterialProfile().useHqTextures) {
        const [albedo, normal] = await Promise.all([
            loadWorldTexture(dirtAlbedoHqUrl),
            loadWorldTexture(dirtNormalHqUrl),
        ]);
        if (albedo) return { albedo, normal, variants: [] };
    }
    const [albedo, normal] = await Promise.all([
        loadWorldTexture(sandAlbedoUrl),
        loadWorldTexture(sandNormalUrl),
    ]);
    if (!albedo) return null;
    return { albedo, normal, variants: [] };
}

/** Mountain rock: legacy albedo as base; field photos soft-multiply as accents. */
export async function loadRockTextures(): Promise<PhotoTextureSet | null> {
    const albedo = await loadWorldTexture(rockUrl);
    if (!albedo) return null;
    if (groundMaterialProfile().useHqTextures) {
        const photos = await Promise.all(ROCK_PHOTO.map((p) => loadWorldTexture(p.albedo)));
        const variants = photos.filter((t): t is Texture => t !== null);
        return { albedo, normal: null, variants };
    }
    return { albedo, normal: null, variants: [] };
}

/** Preload every shared world texture once. Safe to call repeatedly. */
export function preloadWorldTextures(onProgress?: TextureProgress): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const urls = [...WORLD_TEXTURE_URLS, ...hqGrassUrlsForBoot()];
    const total = urls.length;
    let done = 0;
    preloadPromise = (async () => {
        await Promise.all(
            urls.map(async (u) => {
                await loadWorldTexture(u);
                done += 1;
                onProgress?.(done, total, 'World textures');
            }),
        );
    })();
    return preloadPromise;
}
