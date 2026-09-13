import { Cache, SRGBColorSpace, Texture, TextureLoader } from 'three';

import { groundMaterialProfile } from './groundQuality';
import { assetUrl } from './assets';

/** Enable Three's URL cache so map/scenery/weather reloads are free after boot. */
Cache.enabled = true;

// Vite only rewrites `new URL('literal', import.meta.url)` — a helper hides the
// path from static analysis, so production would request /assets/textures/... and 404.
const grassAlbedoUrl = (): string => assetUrl('textures/grass-albedo.webp');
const grassNormalUrl = (): string => assetUrl('textures/grass-normal.webp');
const grassAlbedoHqUrl = (): string => assetUrl('textures/grass-albedo-hq.webp');
const grassNormalHqUrl = (): string => assetUrl('textures/grass-normal-hq.webp');
const sandAlbedoUrl = (): string => assetUrl('textures/sand-albedo.webp');
const sandNormalUrl = (): string => assetUrl('textures/sand-normal.webp');
/** Lake-shore gravel (from misc/photos/water/wsc_s.png) — outer meadow beaches. */
const shoreAlbedoUrl = (): string => assetUrl('textures/shore-albedo.webp');
const shoreNormalUrl = (): string => assetUrl('textures/shore-normal.webp');
/** Board wear / footprints (from misc/photos/grass/IMG_4881.JPG). */
const wearAlbedoUrl = (): string => assetUrl('textures/wear-albedo.webp');
const wearNormalUrl = (): string => assetUrl('textures/wear-normal.webp');
const dirtAlbedoHqUrl = (): string => assetUrl('textures/dirt-albedo-hq.webp');
const dirtNormalHqUrl = (): string => assetUrl('textures/dirt-normal-hq.webp');
const barkUrl = (): string => assetUrl('textures/bark.webp');
const foliageUrl = (): string => assetUrl('textures/foliage.webp');
const rockUrl = (): string => assetUrl('textures/rock.webp');
const moonUrl = (): string => assetUrl('textures/moon.webp');
const iceAlbedoUrl = (): string => assetUrl('textures/ice-albedo.webp');

/** Field-photo tiles (processed from misc/photos/ via process-ground-photos.py). */
const GRASS_PHOTO = [
    {
        get albedo() {
            return assetUrl('textures/grass-photo-0.webp');
        },
        get normal() {
            return assetUrl('textures/grass-photo-0-normal.webp');
        },
    },
    {
        get albedo() {
            return assetUrl('textures/grass-photo-1.webp');
        },
        get normal() {
            return assetUrl('textures/grass-photo-1-normal.webp');
        },
    },
    {
        get albedo() {
            return assetUrl('textures/grass-photo-2.webp');
        },
        get normal() {
            return assetUrl('textures/grass-photo-2-normal.webp');
        },
    },
] as const;

const DIRT_PHOTO = [
    {
        get albedo() {
            return assetUrl('textures/dirt-photo-0.webp');
        },
        get normal() {
            return assetUrl('textures/dirt-photo-0-normal.webp');
        },
    },
    {
        get albedo() {
            return assetUrl('textures/dirt-photo-1.webp');
        },
        get normal() {
            return assetUrl('textures/dirt-photo-1-normal.webp');
        },
    },
    {
        get albedo() {
            return assetUrl('textures/dirt-photo-2.webp');
        },
        get normal() {
            return assetUrl('textures/dirt-photo-2-normal.webp');
        },
    },
] as const;

const ROCK_PHOTO = [
    {
        get albedo() {
            return assetUrl('textures/rock-photo-0.webp');
        },
        get normal() {
            return assetUrl('textures/rock-photo-0-normal.webp');
        },
    },
    {
        get albedo() {
            return assetUrl('textures/rock-photo-1.webp');
        },
        get normal() {
            return assetUrl('textures/rock-photo-1-normal.webp');
        },
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
    grassAlbedoUrl(),
    grassAlbedoHqUrl(),
    sandAlbedoUrl(),
    shoreAlbedoUrl(),
    wearAlbedoUrl(),
    dirtAlbedoHqUrl(),
    barkUrl(),
    foliageUrl(),
    rockUrl(),
    moonUrl(),
    iceAlbedoUrl(),
    ...GRASS_PHOTO.map((p) => p.albedo),
    ...DIRT_PHOTO.map((p) => p.albedo),
    ...ROCK_PHOTO.map((p) => p.albedo),
]);

/** Every world texture the single map needs — warm at boot. */
export const WORLD_TEXTURE_URLS: readonly string[] = [
    grassAlbedoUrl(),
    grassNormalUrl(),
    sandAlbedoUrl(),
    shoreAlbedoUrl(),
    wearAlbedoUrl(),
    barkUrl(),
    foliageUrl(),
    rockUrl(),
    moonUrl(),
    iceAlbedoUrl(),
];

/** HQ + field-photo set — only preloaded when the active tier wants it. */
export function hqGrassUrlsForBoot(): readonly string[] {
    if (!groundMaterialProfile().useHqTextures) return [];
    return [
        grassAlbedoHqUrl(),
        grassNormalHqUrl(),
        dirtAlbedoHqUrl(),
        dirtNormalHqUrl(),
        // Grass photos only as sparse accents (dirt photos kept on disk, unused for now)
        ...GRASS_PHOTO.map((p) => p.albedo),
        ...ROCK_PHOTO.flatMap((p) => [p.albedo, p.normal]),
        sandNormalUrl(),
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
            loadWorldTexture(grassAlbedoHqUrl()),
            loadWorldTexture(grassNormalHqUrl()),
            Promise.all(GRASS_PHOTO.map((p) => loadWorldTexture(p.albedo))),
        ]);
        if (albedo) {
            const variants = grassVars.filter((t): t is Texture => t !== null);
            return { albedo, normal, variants };
        }
    }
    const [albedo, normal] = await Promise.all([
        loadWorldTexture(grassAlbedoUrl()),
        loadWorldTexture(grassNormalUrl()),
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
            loadWorldTexture(dirtAlbedoHqUrl()),
            loadWorldTexture(dirtNormalHqUrl()),
        ]);
        if (albedo) return { albedo, normal, variants: [] };
    }
    const [albedo, normal] = await Promise.all([
        loadWorldTexture(sandAlbedoUrl()),
        loadWorldTexture(sandNormalUrl()),
    ]);
    if (!albedo) return null;
    return { albedo, normal, variants: [] };
}

/** Mountain rock: legacy albedo as base; field photos soft-multiply as accents. */
export async function loadRockTextures(): Promise<PhotoTextureSet | null> {
    const albedo = await loadWorldTexture(rockUrl());
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
