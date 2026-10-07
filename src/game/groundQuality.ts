/**
 * Desktop-first ground material tiers. Geometry stays cheap; texture richness
 * and shader detail scale with the player's graphics preset / scenery + ground
 * prefs so mobile low stays light and ultra gaming PCs get denser grass.
 */

import { ShaderChunk } from 'three';
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
    /** world-UV texture bombing to break wallpaper tiling (high/ultra; superseded by hexTile) */
    textureBomb: boolean;
    /** hex tiling of the lawn ({@link HEX_TILE}) — no visible repeat grid */
    hexTile: boolean;
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
        hexTile: false,
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
        hexTile: true,
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
        macroStrength: 0.72,
        textureBomb: true,
        hexTile: true,
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
        macroStrength: 0.65,
        textureBomb: true,
        hexTile: true,
        ...CLOSE_TILE,
    },
};

/**
 * Ground texture tier = the scenery setting. Every preset sets scenery to its
 * own tier (minimal and low both 'low'), so presets are unchanged; custom mixes
 * used to take the richest of scenery / shadows / ground effects, which made
 * "Ground effects" (footprints, blood, scorch) secretly switch the whole lawn
 * material — and lowering it in a preset did nothing, as scenery or shadows
 * still held the tier up.
 */
export function groundTextureTier(): GroundTextureTier {
    const s = prefs().scenery;
    return s === 'off' ? 'low' : s;
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
        (profile.hexTile ? `h${HEX_TILE.cellScale}-${HEX_TILE.rotation}-${HEX_TILE.contrast}-${HEX_TILE.normalSharpness}` : '') +
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
export function closeTileInjectGlsl(profile: GroundMaterialProfile, hex = false, lawn = 'hexTileRGB( map, '): string {
    if (profile.closeRepeat <= 1.01) return '';
    // `lawn` opens the hex read of the lawn ("fn( " + uv + " )"): lawnSample( where grass variants are on
    const closeSample = hex ? `${lawn}( vMapUv + uHexShift ) * uCloseRepeat )` : 'texture2D( map, closeUv ).rgb';
    const planarSample = hex ? `${lawn}vMapUv + uHexShift )` : 'texture2D( map, vMapUv ).rgb';
    return `
	float closeW = 1.0 - smoothstep( uCloseNear, uCloseFar, distance( cameraPosition, vCloseWorld ) );
	vec3 closeWorldN = normalize( transformDirectionByInverseViewMatrix( normalize( vNormal ), viewMatrix ) );
	float steepT = smoothstep( 0.06, 0.22, 1.0 - abs( closeWorldN.y ) );
	vec2 closeUv = vMapUv * uCloseRepeat;
	vec3 closeAlb = ${closeSample};
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
	vec3 planar = ${planarSample};
	vec3 tri = planar * tw.y + texture2D( map, uvX ).rgb * tw.x + texture2D( map, uvZ ).rgb * tw.z;
	// swap the stretched sample for the side-projected one (keeps any tint already applied)
	diffuseColor.rgb *= mix( vec3( 1.0 ), ( tri + 0.04 ) / ( planar + 0.04 ), steepT );
	vec3 closeTri = closeAlb * tw.y + texture2D( map, uvX * uCloseRepeat ).rgb * tw.x + texture2D( map, uvZ * uCloseRepeat ).rgb * tw.z;
	closeAlb = mix( closeAlb, closeTri, steepT );
	diffuseColor.rgb = mix( diffuseColor.rgb, closeAlb, closeW );
`;
}

/**
 * Hex tiling (stochastic tiling, after Mikkelsen 2022, "Practical Real-Time
 * Hex-Tiling"): the lawn is laid out on a hex grid, every hex cell reads the
 * texture at its own random rotation and offset, and neighbouring cells blend
 * softly — so the 18 wu repeat of the one grass texture never shows as a grid.
 * Blends favour the brighter texel, which keeps blades crisp at the seams
 * instead of a washed-out average.
 *
 * Tweak live while testing (hard-refresh so shaders recompile):
 * - cellScale: hex cells per texture repeat (↑ = smaller patches, ↓ = larger)
 * - rotation: 0..1 of a full turn a cell may rotate (lower it if a baked light
 *   direction in the grass photo starts to read as patches)
 * - contrast: 0..1 — how much the brighter texel wins in a blend (↑ = crisper
 *   seams, ↓ = softer, more averaged)
 * - normalSharpness: blend exponent for the normal map (↑ = narrower seams)
 */
export const HEX_TILE = {
    cellScale: 1,
    rotation: 1,
    contrast: 0.6,
    normalSharpness: 3,
} as const;

/**
 * GLSL (global scope): hexTileRGB / hexTileNormal. Needs `uniform vec2 uHexShift`
 * declared by the material (see {@link HEX_TILE_UNIFORM_DECL}).
 */
export const HEX_TILE_FNS = `
vec2 hexHash( vec2 p ) {
	return fract( sin( vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
}
mat2 hexRot( vec2 id ) {
	float a = ( hexHash( id ).x - 0.5 ) * 6.2831853 * ${HEX_TILE.rotation.toFixed(3)};
	float c = cos( a );
	float s = sin( a );
	return mat2( c, s, -s, c );
}
// barycentric weights of the three hex centres around uv, and their ids
void hexGrid( vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3 ) {
	vec2 st = uv * ${(2 * Math.sqrt(3) * HEX_TILE.cellScale).toFixed(5)};
	vec2 skewed = vec2( st.x, -0.57735027 * st.x + 1.15470054 * st.y );
	vec2 base = floor( skewed );
	vec3 f = vec3( fract( skewed ), 0.0 );
	f.z = 1.0 - f.x - f.y;
	float s = step( 0.0, -f.z );
	float s2 = 2.0 * s - 1.0;
	w = vec3( -f.z * s2, s - f.y * s2, s - f.x * s2 );
	v1 = base + vec2( s );
	v2 = base + vec2( s, 1.0 - s );
	v3 = base + vec2( 1.0 - s, s );
}
// the colour texture at uv, hex-tiled (3 reads; explicit gradients keep the mips right)
// the same with the uv's screen derivatives passed in — safe inside a branch
vec3 hexTileRGBGrad( sampler2D tex, vec2 uv, vec2 dx, vec2 dy ) {
	vec3 w;
	vec2 v1, v2, v3;
	hexGrid( uv, w, v1, v2, v3 );
	mat2 r1 = hexRot( v1 );
	mat2 r2 = hexRot( v2 );
	mat2 r3 = hexRot( v3 );
	vec3 c1 = textureGrad( tex, r1 * uv + hexHash( v1 + 7.31 ), r1 * dx, r1 * dy ).rgb;
	vec3 c2 = textureGrad( tex, r2 * uv + hexHash( v2 + 7.31 ), r2 * dx, r2 * dy ).rgb;
	vec3 c3 = textureGrad( tex, r3 * uv + hexHash( v3 + 7.31 ), r3 * dx, r3 * dy ).rgb;
	vec3 lw = vec3( dot( c1, vec3( 0.299, 0.587, 0.114 ) ), dot( c2, vec3( 0.299, 0.587, 0.114 ) ), dot( c3, vec3( 0.299, 0.587, 0.114 ) ) );
	lw = mix( vec3( 1.0 ), lw, ${HEX_TILE.contrast.toFixed(2)} );
	vec3 ww = max( w, 0.0 ) * pow( lw, vec3( 7.0 ) );
	ww /= max( ww.x + ww.y + ww.z, 1e-6 );
	return c1 * ww.x + c2 * ww.y + c3 * ww.z;
}
vec3 hexTileRGB( sampler2D tex, vec2 uv ) {
	return hexTileRGBGrad( tex, uv, dFdx( uv ), dFdy( uv ) );
}
// a tangent-space normal map at uv, hex-tiled; each cell's xy is turned back
// by its rotation so the bumps still face the light the right way
vec3 hexTileNormal( sampler2D tex, vec2 uv ) {
	vec3 w;
	vec2 v1, v2, v3;
	hexGrid( uv, w, v1, v2, v3 );
	vec2 dx = dFdx( uv );
	vec2 dy = dFdy( uv );
	mat2 r1 = hexRot( v1 );
	mat2 r2 = hexRot( v2 );
	mat2 r3 = hexRot( v3 );
	vec3 n1 = textureGrad( tex, r1 * uv + hexHash( v1 + 7.31 ), r1 * dx, r1 * dy ).xyz * 2.0 - 1.0;
	vec3 n2 = textureGrad( tex, r2 * uv + hexHash( v2 + 7.31 ), r2 * dx, r2 * dy ).xyz * 2.0 - 1.0;
	vec3 n3 = textureGrad( tex, r3 * uv + hexHash( v3 + 7.31 ), r3 * dx, r3 * dy ).xyz * 2.0 - 1.0;
	n1.xy = n1.xy * r1;
	n2.xy = n2.xy * r2;
	n3.xy = n3.xy * r3;
	vec3 ww = pow( max( w, 0.0 ), vec3( ${HEX_TILE.normalSharpness.toFixed(1)} ) );
	ww /= max( ww.x + ww.y + ww.z, 1e-6 );
	return n1 * ww.x + n2 * ww.y + n3 * ww.z;
}
`;

/**
 * Grass variants on the board: lush / dry / sparse lawn textures in the same
 * style as the base lawn, laid in soft zones from the same noise the ground-type
 * tints use (groundZonesGlsl), so the field has places instead of one lawn.
 * They fade out toward the board edge, where the outer meadow takes over.
 * Tweak live (hard refresh):
 * - lush / dry / sparse: [from, to] of the zone value where the variant fades
 *   in / is full, and `amount` 0..1 the most it covers
 */
export const GRASS_VARIANTS = {
    lush: { from: 0.52, to: 0.74, amount: 0.9 },
    dry: { from: 0.46, to: 0.24, amount: 0.7 },
    sparse: { from: 0.6, to: 0.85, amount: 0.85 },
} as const;

/** board: variants fade out toward the board edge (the meadow takes over there) */
export const GRASS_VARIANTS_BOARD_EDGE =
    '1.0 - smoothstep( 0.78, 0.94, max( abs( vBoardXZ.x ) / uBoardHalf.x, abs( vBoardXZ.y ) / uBoardHalf.y ) )';

/**
 * Outer meadow: variants are zero at the board edge (where the board's are too,
 * so the border stays seamless) and grow in over `from`..`to` wu past it.
 */
export function grassVariantsMeadowEdge(halfW: number, halfH: number, from = 25, to = 110): string {
    return `smoothstep( ${from.toFixed(1)}, ${to.toFixed(1)}, length( max( abs( p.xz ) - vec2( ${halfW.toFixed(1)}, ${halfH.toFixed(1)} ), 0.0 ) ) )`;
}

/**
 * GLSL (global, after map_pars_fragment): the variant weights and
 * `lawnSample( uv )` — the hex-tiled lawn with the variants mixed in. Each
 * variant is only read where it shows (explicit gradients keep that branch
 * legal). `edge` is a GLSL float of the world position `p` that scales them all
 * (board: {@link GRASS_VARIANTS_BOARD_EDGE}, needs uBoardHalf / vBoardXZ).
 * Needs HEX_TILE_FNS, SLOPE_GROUND_FNS and samplers uGrassLush / uGrassDry /
 * uGrassSparse.
 */
export function grassVariantsGlsl(edge: string = GRASS_VARIANTS_BOARD_EDGE): string {
    const g = GRASS_VARIANTS;
    const f = (v: number) => v.toFixed(3);
    return `
vec3 gvW;
void grassVariantWeights( vec3 p ) {
	float edge = ${edge};
	// the same zone noise as groundZonesGlsl (lush high, straw low) and its bare-earth noise
	float zoneA = slopeNoise( p.xz / 64.0 + 11.0 ) * 0.7 + slopeNoise( p.xz / 23.0 + 5.3 ) * 0.3;
	float earthN = slopeNoise( p.xz / 27.0 + 47.0 ) * 0.65 + slopeNoise( p.xz / 8.0 + 2.9 ) * 0.35;
	gvW = vec3(
		smoothstep( ${f(g.lush.from)}, ${f(g.lush.to)}, zoneA ) * ${f(g.lush.amount)},
		smoothstep( ${f(g.dry.from)}, ${f(g.dry.to)}, zoneA ) * ${f(g.dry.amount)},
		smoothstep( ${f(g.sparse.from)}, ${f(g.sparse.to)}, earthN ) * ${f(g.sparse.amount)}
	) * edge;
}
vec3 lawnSample( vec2 uv ) {
	vec2 dx = dFdx( uv );
	vec2 dy = dFdy( uv );
	vec3 c = hexTileRGBGrad( map, uv, dx, dy );
	if ( gvW.x > 0.003 ) c = mix( c, hexTileRGBGrad( uGrassLush, uv, dx, dy ), gvW.x );
	if ( gvW.y > 0.003 ) c = mix( c, hexTileRGBGrad( uGrassDry, uv, dx, dy ), gvW.y );
	if ( gvW.z > 0.003 ) c = mix( c, hexTileRGBGrad( uGrassSparse, uv, dx, dy ), gvW.z );
	return c;
}
`;
}

/** `#include <map_fragment>` with grass variants (weights once at `worldPos`, then the mixed lawn). */
export function grassVariantsMapFragment(worldPos: string): string {
    return `
	grassVariantWeights( ${worldPos} );
#ifdef USE_MAP
	diffuseColor.rgb *= lawnSample( vMapUv + uHexShift );
#endif
`;
}

/** the board's: world position from vGroundWorld */
export const GRASS_VARIANTS_MAP_FRAGMENT_GLSL = grassVariantsMapFragment('vGroundWorld');

/**
 * GLSL expression: an RGB texture read, hex-tiled when `hex` is on (the
 * material must then include {@link HEX_TILE_FNS}). Only call it outside
 * branches — hex tiling takes screen-space derivatives of `uv`.
 */
export function texRGB(sampler: string, uv: string, hex: boolean): string {
    return hex ? `hexTileRGB( ${sampler}, ${uv} )` : `texture2D( ${sampler}, ${uv} ).rgb`;
}

/**
 * Hex-grid origin shift, in lawn UV: the board's own UV is the reference
 * (shift 0); the outer meadow passes the offset that maps its UV onto the
 * board's, so the hex cells run on across the border without a seam.
 */
export const HEX_TILE_UNIFORM_DECL = 'uniform vec2 uHexShift;\n';

/** `#include <map_fragment>` with the colour map read hex-tiled. */
export const HEX_MAP_FRAGMENT_GLSL = `
#ifdef USE_MAP
	diffuseColor.rgb *= hexTileRGB( map, vMapUv + uHexShift );
#endif
`;

/** three's normal-map chunk with the tangent-space read hex-tiled. */
export function hexNormalFragmentMapsGlsl(): string {
    return ShaderChunk.normal_fragment_maps
        .split('texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0')
        .join('hexTileNormal( normalMap, vNormalMapUv + uHexShift )');
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

/**
 * GLSL (global scope): smooth value noise for the slope look's ragged edges.
 */
export const SLOPE_GROUND_FNS = `
float slopeNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = fract( sin( dot( i, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
	float b = fract( sin( dot( i + vec2( 1.0, 0.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
	float c = fract( sin( dot( i + vec2( 0.0, 1.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
	float d = fract( sin( dot( i + vec2( 1.0, 1.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;

/** how brown the loose patches on flat grass get at most (0 = none) */
const FLAT_BROWN_PATCHES = 0.6;

/**
 * The board's ground types: big slow zones of lush and of straw-dry cover, patches
 * of bare earth and of moss, and a drier lift on the crests of the mounds. The
 * flat lawn used to be one green with tonal drift; this gives it places.
 *
 * Everything fades out toward the board edge so the field still meets the outer
 * meadow, which does not have these zones. `strength` scales the tier (medium is
 * milder). `earth` is the name of the dirt sampler the slopes already use (no extra
 * texture load), or null for none (no bare-earth patches then).
 */
export function groundZonesGlsl(opts: {
    worldPos: string;
    boardXZ: string;
    boardHalf: string;
    earth: string | null;
    strength: number;
    /** hex-tile the earth read (needs HEX_TILE_FNS) */
    hex?: boolean;
    /** grass variant textures already lay the lush / straw zones: keep only a hint of their tint */
    textured?: boolean;
}): string {
    const { worldPos, boardXZ, boardHalf, earth, strength, hex = false, textured = false } = opts;
    const k = strength.toFixed(2);
    const kz = (strength * (textured ? 0.3 : 1)).toFixed(2);
    let glsl = `
	// ground types (see groundZonesGlsl)
	vec3 zoneP = ${worldPos};
	float zoneEdge = 1.0 - smoothstep( 0.78, 0.94, max( abs( ${boardXZ}.x ) / ${boardHalf}.x, abs( ${boardXZ}.y ) / ${boardHalf}.y ) );
	float zoneA = slopeNoise( zoneP.xz / 64.0 + 11.0 ) * 0.7 + slopeNoise( zoneP.xz / 23.0 + 5.3 ) * 0.3;
	float lushT = smoothstep( 0.54, 0.78, zoneA ) * zoneEdge;
	float strawT = ( 1.0 - smoothstep( 0.24, 0.46, zoneA ) ) * zoneEdge;
	float zoneLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.80, 1.07, 0.78 ), lushT * ${kz} );
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb, vec3( zoneLum ), 0.35 ) * vec3( 1.22, 1.06, 0.62 ), strawT * ${kz} * 0.8 );
	// moss: small, darker, cooler green patches on the low ground
	float mossN = slopeNoise( zoneP.xz / 15.0 + 90.0 ) * 0.7 + slopeNoise( zoneP.xz / 5.5 + 13.0 ) * 0.3;
	float mossT = smoothstep( 0.62, 0.8, mossN ) * ( 1.0 - smoothstep( 0.2, 1.4, zoneP.y ) ) * zoneEdge;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.70, 0.90, 0.68 ), mossT * ${k} * 0.7 );
	// acid pits (ground dug below the board's level): the deeper, the darker and more burnt
	float pitK = smoothstep( 0.02, 1.0, -zoneP.y );
	diffuseColor.rgb *= 1.0 - 0.24 * pitK;
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.19, 0.05 ), pitK * 0.14 );
	// the crests of the mounds run dry and light
	float crestT = smoothstep( 1.2, 3.6, zoneP.y ) * zoneEdge;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.12, 1.04, 0.80 ), crestT * ${k} * 0.55 );
`;
    if (earth) {
        glsl += `	// bare earth: sparse patches of the dirt the hillsides already use, so the
	// lawn breaks up into worn ground instead of one green
	float earthN = slopeNoise( zoneP.xz / 27.0 + 47.0 ) * 0.65 + slopeNoise( zoneP.xz / 8.0 + 2.9 ) * 0.35;
	// a wide, soft ramp so the patch feathers into the lawn instead of ending in an edge
	float earthT = smoothstep( 0.62, 0.92, earthN ) * zoneEdge * ${k} * 0.32;
	vec3 earthTex = ${texRGB(earth, 'zoneP.xz / 9.0', hex)} * vec3( 0.95, 0.90, 0.84 );
	// the earth's colour, but half of the grass's own light and grain, so the lawn shows through
	float earthGl = max( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.05 );
	float earthEl = max( dot( earthTex, vec3( 0.299, 0.587, 0.114 ) ), 0.05 );
	vec3 earthCol = mix( earthTex, earthTex * ( earthGl / earthEl ), 0.55 );
	diffuseColor.rgb = mix( diffuseColor.rgb, earthCol, earthT );
`;
    }
    return glsl;
}

/** rock texture size on board cliffs (wu per repeat) */
const SLOPE_ROCK_TILE = 6;
/** how far the steepest cliffs lean toward rock (the rest stays earth) */
const SLOPE_ROCK_STRENGTH = 0.5;
/** how strongly the rock normal map bends the light on board cliffs (1 = as baked) */
export const SLOPE_ROCK_NORMAL = 1.3;

/**
 * GLSL: hillsides look like hillsides — the steeper the ground, the drier and
 * browner the grass, then bare earth, and around the grade units can't walk
 * up (0.72, see terrainCombat's SLOPE_BLOCK_GRADE) rock. Edges are broken up
 * with noise. Visual only; works on whatever colour the lawn has at that point.
 *
 * - `worldPos` / `worldNormal`: GLSL expressions for the fragment's world
 *   position (vec3) and a smooth world normal (vec3)
 * - `earth`: sampler for a dirt texture (+ its UV), or null for a tint only
 * - `rock`: sampler for the rock texture (triplanar), or null for no rock
 * - `rockNormal`: sampler for the rock's normal map, or null — when set, the
 *   shader also defines `slopeRockN` (world normal) and `slopeRockBump` (0..1,
 *   how much of it to use) for {@link SLOPE_ROCK_NORMAL_APPLY_GLSL}
 * - `fade`: optional GLSL float that scales the whole effect (1 = full)
 */
export function slopeGroundGlsl(opts: {
    worldPos: string;
    worldNormal: string;
    earth: { sampler: string; uv: string } | null;
    rock: string | null;
    rockNormal?: string | null;
    fade?: string;
    /** hex-tile the earth read (needs HEX_TILE_FNS) */
    hex?: boolean;
}): string {
    const { worldPos, worldNormal, earth, rock, rockNormal = null, fade = '1.0', hex = false } = opts;
    let glsl = `
	vec3 slopeN = normalize( ${worldNormal} );
	float slopeUp = max( abs( slopeN.y ), 0.05 );
	float slopeGrade = sqrt( max( 0.0, 1.0 - slopeUp * slopeUp ) ) / slopeUp;
	vec3 slopeP = ${worldPos};
	float slopeVar = slopeNoise( slopeP.xz / 7.0 ) * 0.65 + slopeNoise( slopeP.xz / 2.3 + 17.0 ) * 0.35 - 0.5;
	float slopeFade = ${fade};
	float slopeDryT = smoothstep( 0.16, 0.45, slopeGrade + slopeVar * 0.14 ) * slopeFade;
	// the same brown in loose patches on flat grass: big soft drifts with a smaller breakup
	float slopePatchN = slopeNoise( slopeP.xz / 26.0 + 41.3 ) * 0.7 + slopeNoise( slopeP.xz / 8.5 + 3.7 ) * 0.3;
	float slopePatchT = smoothstep( 0.52, 0.8, slopePatchN ) * ${FLAT_BROWN_PATCHES.toFixed(2)} * slopeFade;
	slopeDryT = max( slopeDryT, slopePatchT );
	float slopeEarthT = smoothstep( 0.45, 0.85, slopeGrade + slopeVar * 0.2 ) * slopeFade;
	vec3 slopeBase = diffuseColor.rgb;
	float slopeLum = max( dot( slopeBase, vec3( 0.299, 0.587, 0.114 ) ), 0.03 );
	vec3 slopeDry = mix( slopeBase, vec3( slopeLum ), 0.6 ) * vec3( 1.3, 0.82, 0.42 );
	vec3 slopeEarth = vec3( 0.34, 0.26, 0.17 ) * clamp( slopeLum / 0.3, 0.7, 1.3 );
`;
    if (earth) {
        glsl += `	slopeEarth = mix( slopeEarth, ${texRGB(earth.sampler, earth.uv, hex)} * vec3( 0.9, 0.82, 0.72 ), 0.55 );
`;
    }
    glsl += `	vec3 slopeCol = mix( slopeBase, slopeDry, slopeDryT * 0.7 );
	slopeCol = mix( slopeCol, slopeEarth, slopeEarthT * 0.9 );
`;
    if (rock) {
        const tile = SLOPE_ROCK_TILE.toFixed(1);
        glsl += `	float slopeRockT = smoothstep( 0.8, 1.15, slopeGrade + slopeVar * 0.24 ) * slopeFade;
	vec3 slopeRw = pow( abs( slopeN ), vec3( 4.0 ) );
	slopeRw /= max( slopeRw.x + slopeRw.y + slopeRw.z, 1e-4 );
	// UVs flip per side so every face gets a right-handed tangent frame (the normal map needs it)
	vec3 slopeRs = step( 0.0, slopeN ) * 2.0 - 1.0;
	vec2 slopeQX = vec2( -slopeP.z * slopeRs.x, slopeP.y ) / ${tile};
	vec2 slopeQY = vec2( -slopeP.x * slopeRs.y, slopeP.z ) / ${tile};
	vec2 slopeQZ = vec2( slopeP.x * slopeRs.z, slopeP.y ) / ${tile};
	vec3 slopeRock =
		texture2D( ${rock}, slopeQY ).rgb * slopeRw.y +
		texture2D( ${rock}, slopeQX ).rgb * slopeRw.x +
		texture2D( ${rock}, slopeQZ ).rgb * slopeRw.z;
	slopeCol = mix( slopeCol, slopeRock * vec3( 0.95, 0.9, 0.85 ), slopeRockT * ${SLOPE_ROCK_STRENGTH.toFixed(2)} );
`;
        if (rockNormal) {
            const k = SLOPE_ROCK_NORMAL.toFixed(2);
            glsl += `	vec2 slopeNX = ( texture2D( ${rockNormal}, slopeQX ).xy * 2.0 - 1.0 ) * ${k};
	vec2 slopeNY = ( texture2D( ${rockNormal}, slopeQY ).xy * 2.0 - 1.0 ) * ${k};
	vec2 slopeNZ = ( texture2D( ${rockNormal}, slopeQZ ).xy * 2.0 - 1.0 ) * ${k};
	vec3 slopeRockN = normalize( slopeN
		+ ( slopeNX.x * vec3( 0.0, 0.0, -slopeRs.x ) + slopeNX.y * vec3( 0.0, 1.0, 0.0 ) ) * slopeRw.x
		+ ( slopeNY.x * vec3( -slopeRs.y, 0.0, 0.0 ) + slopeNY.y * vec3( 0.0, 0.0, 1.0 ) ) * slopeRw.y
		+ ( slopeNZ.x * vec3( slopeRs.z, 0.0, 0.0 ) + slopeNZ.y * vec3( 0.0, 1.0, 0.0 ) ) * slopeRw.z );
	// the bumps follow where the rock shows (a bit ahead of its colour, so the cliff reads as stone)
	float slopeRockBump = clamp( slopeRockT * ${(SLOPE_ROCK_STRENGTH * 1.6).toFixed(2)}, 0.0, 1.0 );
`;
        }
    }
    glsl += `	diffuseColor.rgb = slopeCol;
`;
    return glsl;
}

/**
 * GLSL (main, after the normal maps): the board cliffs' rock bumps from
 * slopeGroundGlsl, replacing the grass bumps where the rock shows.
 */
export const SLOPE_ROCK_NORMAL_APPLY_GLSL = `
	normal = normalize( mix( normal, normalize( ( viewMatrix * vec4( slopeRockN, 0.0 ) ).xyz ), slopeRockBump ) );
`;

/**
 * GLSL: how much weather snow a spot holds (0…1) — steep ground sheds it, so
 * hillsides show their brown earth and rock through the white and the hills
 * stay readable in winter; loose drifts break up the edges. Needs
 * {	link slopeGroundGlsl} earlier in the same shader (slopeGrade, slopeVar, slopeP).
 */
export const SNOW_SLOPE_HOLD_GLSL = `
	float snowSlopeHold = 1.0 - smoothstep( 0.3, 0.85, slopeGrade + slopeVar * 0.3 );
	snowSlopeHold *= mix( 1.0, smoothstep( 0.2, 0.55, slopeNoise( slopeP.xz / 13.0 + 71.9 ) ), 0.3 );
`;

/** weather snow colour on the lawn — a touch below pure white so light and shade still shape the hills */
export const LAWN_SNOW_COLOR_GLSL = 'vec3( 0.86, 0.89, 0.93 )';

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
