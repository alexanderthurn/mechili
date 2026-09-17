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
     * Ground near the camera blends in a tighter UV repeat so grass blades
     * don't look human-sized up close. Per pixel, by distance to the camera,
     * so hills that are close get it and distant slopes never do. 1 = off.
     */
    closeRepeat: number;
    /** distance to the camera (wu) within which close tiling is fully on */
    closeNear: number;
    /** distance (wu) beyond which only the normal tiling shows */
    closeFar: number;
}

/** close grass tile, the same on every tier that has one (Low keeps it off) */
const CLOSE_TILE = { closeRepeat: 1.4, closeNear: 30, closeFar: 85 } as const;

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
        closeNear: 30,
        closeFar: 85,
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
        ...CLOSE_TILE,
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
        ...CLOSE_TILE,
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
        ...CLOSE_TILE,
    },
};

/** Infer ground texture tier from the active graphics bundle (or closest mix). */
export function groundTextureTier(): GroundTextureTier {
    const preset = detectGraphicsPreset();
    if (preset === 'minimal') return 'low';
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

/**
 * GLSL: finer grass UVs on the ground near the camera. The weight is per pixel
 * — distance from the camera, softened into a wide blend — so a nearby hilltop
 * gets fine blades, far slopes keep the normal tile, and zooming never flips
 * the whole lawn at once.
 *
 * Steep ground: the lawn UV is a top-down projection, which stretches blades
 * down a slope. There the grass is sampled triplanar — from the side along x
 * and z as well — for both the normal and the fine tile, so a hillside shows
 * the same blade size as flat ground.
 */
export function closeTileInjectGlsl(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat <= 1.01) return '';
    return `
	float closeW = 1.0 - smoothstep( uCloseNear, uCloseFar, distance( cameraPosition, vCloseWorld ) );
	vec3 closeWorldN = normalize( transformDirectionByInverseViewMatrix( normalize( vNormal ), viewMatrix ) );
	float steepT = smoothstep( 0.06, 0.22, 1.0 - abs( closeWorldN.y ) );
	vec2 closeUv = vMapUv * uCloseRepeat;
	vec3 closeAlb = texture2D( map, closeUv ).rgb;
	// derivatives and texture reads stay outside any branch: inside one the GPU's
	// mip level (and dFdx) is undefined and neighbouring pixel blocks disagree
	// lawn UV per world unit along x and z (the UV is a planar xz projection)
	float closeKx = ( abs( dFdx( vMapUv.x ) ) + abs( dFdy( vMapUv.x ) ) ) / max( abs( dFdx( vCloseWorld.x ) ) + abs( dFdy( vCloseWorld.x ) ), 1e-4 );
	float closeKz = ( abs( dFdx( vMapUv.y ) ) + abs( dFdy( vMapUv.y ) ) ) / max( abs( dFdx( vCloseWorld.z ) ) + abs( dFdy( vCloseWorld.z ) ), 1e-4 );
	float closeK = clamp( 0.5 * ( closeKx + closeKz ), 1e-4, 10.0 );
	vec3 tw = pow( abs( closeWorldN ), vec3( 4.0 ) );
	tw /= max( tw.x + tw.y + tw.z, 1e-4 );
	vec2 uvX = vec2( vCloseWorld.z, vCloseWorld.y ) * closeK;
	vec2 uvZ = vec2( vCloseWorld.x, vCloseWorld.y ) * closeK;
	vec3 planar = texture2D( map, vMapUv ).rgb;
	vec3 tri = planar * tw.y + texture2D( map, uvX ).rgb * tw.x + texture2D( map, uvZ ).rgb * tw.z;
	// swap the stretched sample for the side-projected one (keeps any tint already applied)
	diffuseColor.rgb *= mix( vec3( 1.0 ), ( tri + 0.04 ) / ( planar + 0.04 ), steepT );
	vec3 closeTri = closeAlb * tw.y + texture2D( map, uvX * uCloseRepeat ).rgb * tw.x + texture2D( map, uvZ * uCloseRepeat ).rgb * tw.z;
	closeAlb = mix( closeAlb, closeTri, steepT );
	diffuseColor.rgb = mix( diffuseColor.rgb, closeAlb, closeW );
`;
}

/**
 * GLSL expression: the lawn texture at `uv`, at the fine repeat where the
 * close tile is on — for layers drawn after it (texture bombing), so a patch
 * near the camera never brings the coarse blades back.
 */
export function closeTileSampleGlsl(profile: GroundMaterialProfile, uv: string): string {
    if (profile.closeRepeat <= 1.01) return `texture2D( map, ${uv} ).rgb`;
    return `mix( texture2D( map, ${uv} ).rgb, texture2D( map, ( ${uv} ) * uCloseRepeat ).rgb, closeW )`;
}

/**
 * GLSL: texture bombing — a rotated copy of the lawn blended in soft,
 * irregular patches so the tiling doesn't read as wallpaper. Patches come from
 * smoothly interpolated cell noise (no square cell edges) and stay subtle.
 * `sample` is the texture read for a UV (fine near the camera where the close
 * tile is on).
 */
export function textureBombGlsl(sample: (uv: string) => string): string {
    return `
	vec2 bombUv = vMapUv.yx * vec2( -1.0, 1.0 ) + vec2( 0.37, 0.19 );
	vec2 bombCell = vMapUv * 3.0;
	vec2 bombI = floor( bombCell );
	vec2 bombF = fract( bombCell );
	bombF = bombF * bombF * ( 3.0 - 2.0 * bombF );
	float bombH00 = fract( sin( dot( bombI, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float bombH10 = fract( sin( dot( bombI + vec2( 1.0, 0.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float bombH01 = fract( sin( dot( bombI + vec2( 0.0, 1.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float bombH11 = fract( sin( dot( bombI + vec2( 1.0, 1.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float bombW = mix( mix( bombH00, bombH10, bombF.x ), mix( bombH01, bombH11, bombF.x ), bombF.y );
	bombW = smoothstep( 0.35, 0.8, bombW );
	diffuseColor.rgb = mix( diffuseColor.rgb, ${sample('bombUv')}, bombW * ${BOMB_STRENGTH.toFixed(2)} );
`;
}

/** how far a bombing patch leans toward the rotated copy (was 0.55: too patchy) */
const BOMB_STRENGTH = 0.25;

/** Declare closeW=0 when close-tile is off so later GLSL can always reference it. */
export function closeTileWeightFallbackGlsl(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat > 1.01) return '';
    return '\tfloat closeW = 0.0;\n';
}

/** fragment declarations for the close tile */
export function closeTileUniformDecls(profile: GroundMaterialProfile): string {
    if (profile.closeRepeat <= 1.01) return '';
    return 'uniform float uCloseRepeat;\nuniform float uCloseNear;\nuniform float uCloseFar;\nvarying vec3 vCloseWorld;\n';
}

/** vertex side of the close tile: hands each fragment its world position */
export function closeTileVertexShader(vertexShader: string, profile: GroundMaterialProfile): string {
    if (profile.closeRepeat <= 1.01) return vertexShader;
    return (
        'varying vec3 vCloseWorld;\n' +
        vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n\tvCloseWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
        )
    );
}

export function bindCloseTileUniforms(
    uniforms: Record<string, { value: unknown }>,
    profile: GroundMaterialProfile,
): void {
    if (profile.closeRepeat <= 1.01) return;
    uniforms.uCloseRepeat = { value: profile.closeRepeat };
    uniforms.uCloseNear = { value: profile.closeNear };
    uniforms.uCloseFar = { value: profile.closeFar };
}

export function graphicsPresetOrFallback(): GraphicsPreset {
    const preset = detectGraphicsPreset();
    if (preset) return preset;
    // Ground tiers have no Minimal — map the inferred texture tier up.
    return groundTextureTier();
}
