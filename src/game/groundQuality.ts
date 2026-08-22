/**
 * Desktop-first ground material tiers. Geometry stays cheap; texture richness
 * and shader detail scale with the player's graphics preset / scenery + ground
 * prefs so mobile low stays light and ultra gaming PCs get denser grass.
 */

import { detectGraphicsPreset, prefs, type GraphicsPreset } from './prefs';
import { touchFirstDevice } from './inputCapabilities';

export type GroundTextureTier = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Tweak these live while testing photo accents (High/Ultra).
 * Soft-reload / hard-refresh after edits so shaders recompile.
 *
 * Grass photos (soft round multiply blobs on HQ lawn):
 * - density: 0..1 — chance a blob appears (↑ = more accents)
 * - cellScale: ↑ = more/smaller blobs, ↓ = fewer/larger blobs
 * - radius: blob size in cell units (↑ = bigger soft circles)
 * - strength: 0..1 — how hard the photo multiplies into the lawn
 * - uvScale: ↑ = photo features look smaller (good for close-ups)
 *
 * Rock photos (same idea on legacy mountain rock):
 * - same knobs; worldScale = world units per photo tile (↑ = larger features)
 */
export const PHOTO_BLEND = {
    grass: {
        // Broad soft coverage; photo-2 is UV-bombed + multiplied with photo-0
        density: 0.7,
        cellScale: 0.38,
        radius: 0.95,
        strength: 0.7,
        uvScale: 2.2,
    },
    rock: {
        density: 1,
        cellScale: 0.85,
        radius: 1.05,
        strength: 1,
        /** world units covered by one rock-photo tile */
        worldScale: 55,
        uvScale: 1.4,
    },
} as const;

/**
 * How far ground units sit relative to terrain height. Negative sinks feet
 * into the grass (kills the hover look when normals make the lawn read high).
 * Try -0.05 … -0.15 if dwarfs still float or clip.
 */
export const GROUND_UNIT_Y = -0.08;

/**
 * Footprint / wear dirt (`dirt-albedo-hq` on high/ultra, sand otherwise).
 * Live stamps only — no match-start mud under bases.
 *
 * - stampStrength: multiplies every footprint stamp (0.5–2)
 * - stampRadius: multiplies footprint size (0.7–1.5)
 * - grassStampShow: how hard dirt trails read on green grass (0.3–1).
 *   Snow tracks stay full strength (shader mixes this → 1 with snowMask).
 */
export const WEAR_BLEND = {
    stampStrength: 1,
    stampRadius: 1,
    grassStampShow: 0.45,
} as const;

export interface GroundMaterialProfile {
    tier: GroundTextureTier;
    /** max anisotropy on tiled ground maps */
    anisotropy: number;
    /** MeshStandardMaterial.normalScale magnitude */
    normalScale: number;
    /** second UV scale multiplier for micro-detail (1 = off) */
    detailScale: number;
    /** 0..1 blend of micro albedo/normal into base */
    detailStrength: number;
    /** vary roughness from albedo luminance in the ground shader */
    roughnessFromAlbedo: boolean;
    /** prefer HQ grass files when present */
    useHqTextures: boolean;
    /** slightly smaller tile → more texels/wu on HQ sets */
    detailTile: number;
    /**
     * How hard the soft macro canvas remaps the tiled grass (1 = full legacy
     * look). Lower on high/ultra so HQ albedo/normals actually show.
     */
    macroStrength: number;
    /** world-UV texture bombing to break wallpaper tiling (high/ultra) */
    textureBomb: boolean;
    /**
     * When the camera is low (zoomed in), blend in a tighter UV repeat so grass
     * blades don't look human-sized. Driven by camera world-Y (whole lawn),
     * not per-fragment distance. 1 = off.
     */
    closeRepeat: number;
    /** camera Y at/below which close tiling is fully on */
    closeNear: number;
    /** camera Y at/above which far tiling takes over */
    closeFar: number;
}

const PROFILES: Record<GroundTextureTier, GroundMaterialProfile> = {
    low: {
        tier: 'low',
        anisotropy: 4,
        normalScale: 0.28,
        detailScale: 1,
        detailStrength: 0,
        roughnessFromAlbedo: false,
        useHqTextures: false,
        detailTile: 20,
        macroStrength: 1,
        textureBomb: false,
        closeRepeat: 1,
        closeNear: 26,
        closeFar: 64,
    },
    medium: {
        tier: 'medium',
        anisotropy: 8,
        normalScale: 0.48,
        detailScale: 5.2,
        detailStrength: 0.38,
        roughnessFromAlbedo: true,
        useHqTextures: false,
        detailTile: 18,
        macroStrength: 0.82,
        textureBomb: false,
        // Mild close refine — enough to shrink blades, not wallpaper density.
        closeRepeat: 1.85,
        closeNear: 28,
        closeFar: 62,
    },
    high: {
        tier: 'high',
        anisotropy: 16,
        normalScale: 0.85,
        detailScale: 6.5,
        detailStrength: 0.58,
        roughnessFromAlbedo: true,
        useHqTextures: true,
        // Field photos are close-ups — larger tile = less "macro" look
        detailTile: 18,
        macroStrength: 0.48,
        textureBomb: true,
        closeRepeat: 3.8,
        closeNear: 26,
        closeFar: 64,
    },
    ultra: {
        tier: 'ultra',
        anisotropy: 16,
        normalScale: 1.05,
        detailScale: 7.2,
        detailStrength: 0.68,
        roughnessFromAlbedo: true,
        useHqTextures: true,
        detailTile: 16,
        macroStrength: 0.35,
        textureBomb: true,
        closeRepeat: 4.8,
        closeNear: 26,
        closeFar: 68,
    },
};

/** Infer ground texture tier from the active graphics bundle (or closest mix). */
export function groundTextureTier(): GroundTextureTier {
    const preset = detectGraphicsPreset();
    if (preset) return preset;

    const p = prefs();
    // Custom mixes: prefer the richer of scenery / shadows as a desktop signal.
    const rank = (v: string): number =>
        ({ off: 0, low: 1, medium: 2, high: 3, ultra: 4 }[v] ?? 2);
    const score = Math.max(rank(p.scenery), rank(p.shadows), rank(p.groundEffects));
    if (score >= 4) return 'ultra';
    if (score >= 3) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
}

export function groundMaterialProfile(): GroundMaterialProfile {
    let tier = groundTextureTier();
    // Touch devices keep the light path even if the user bumps presets — HQ
    // 2K grass + dual-scale is aimed at the "gaming PC looks boring" complaint.
    if (touchFirstDevice() && (tier === 'high' || tier === 'ultra')) {
        tier = 'medium';
    }
    return PROFILES[tier];
}

/** Stable cache key fragment for materials that inject ground-detail GLSL. */
export function groundDetailCacheKey(profile: GroundMaterialProfile): string {
    if (profile.detailStrength <= 0 && !profile.roughnessFromAlbedo && profile.macroStrength >= 0.99) {
        return 'plain';
    }
    const g = PHOTO_BLEND.grass;
    const r = PHOTO_BLEND.rock;
    return `d${profile.detailScale.toFixed(1)}s${profile.detailStrength.toFixed(2)}r${
        profile.roughnessFromAlbedo ? 1 : 0
    }m${profile.macroStrength.toFixed(2)}b${profile.textureBomb ? 1 : 0}` +
        `c${profile.closeRepeat.toFixed(1)}-${profile.closeNear}-${profile.closeFar}` +
        `pg${g.density}-${g.strength}-${g.uvScale}` +
        `rk${r.density}-${r.strength}-${r.worldScale}`;
}

/** GLSL: finer grass UVs when the camera is low (zoomed in) — whole lawn. */
export function closeTileInjectGlsl(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat <= 1.01) return '';
    return `
\t// Camera world-Y: low orbit → fine tile on the whole lawn.
\tfloat closeW = 1.0 - smoothstep( uCloseNear, uCloseFar, uCameraWorldY );
\tcloseW = closeW * closeW;
\tvec2 closeUv = vMapUv * uCloseRepeat;
\tvec3 closeAlb = texture2D( map, closeUv ).rgb;
\tdiffuseColor.rgb = mix( diffuseColor.rgb, closeAlb, closeW );
`;
}

/** Declare closeW=0 when close-tile is off so later GLSL can always reference it. */
export function closeTileWeightFallbackGlsl(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat > 1.01) return '';
    return '\tfloat closeW = 0.0;\n';
}

export function closeTileUniformDecls(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat <= 1.01) return '';
    return (
        'uniform float uCloseRepeat;\nuniform float uCloseNear;\nuniform float uCloseFar;\n' +
        'uniform float uCameraWorldY;\n'
    );
}

/** Shared live camera-Y for board + meadow close-tile (updated each frame). */
export const closeCameraYUniform = { value: 80 };

export function bindCloseTileUniforms(
    uniforms: Record<string, { value: unknown }>,
    profile: GroundMaterialProfile,
): void {
    if (profile.closeRepeat <= 1.01) return;
    uniforms.uCloseRepeat = { value: profile.closeRepeat };
    uniforms.uCloseNear = { value: profile.closeNear };
    uniforms.uCloseFar = { value: profile.closeFar };
    // Same object everywhere — one write updates all grass shaders.
    uniforms.uCameraWorldY = closeCameraYUniform;
}

export function setCloseCameraY(y: number): void {
    closeCameraYUniform.value = y;
}

export function graphicsPresetOrFallback(): GraphicsPreset {
    return detectGraphicsPreset() ?? (groundTextureTier() as GraphicsPreset);
}
