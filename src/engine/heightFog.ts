import { ShaderChunk, ShaderLib, UniformsLib } from 'three';

/**
 * The fog chunk's live inputs, one shared vec4 for EVERY fogged material:
 * x = deployment focus shade 0..1, y/z = the board's half extents (the aerial
 * haze and the focus shade start at its edge), w = ground-mist strength.
 *
 * They are uniforms, not values baked into the chunk text: three keys built-in
 * programs by material type, not by source, so a program compiled before a bake
 * (boot warm-up, an earlier match) kept the old text — objects then flickered
 * between programs with and without the current board as light counts changed.
 * A typed array passes three's per-material uniform cloning by reference
 * (cloneUniforms copies only three objects and plain arrays), so writing it
 * reaches every material at once.
 */
const FOG_PARAMS = new Float32Array([0, 1e6, 1e6, 1]);
(UniformsLib.fog as Record<string, { value: unknown }>).fogParams = { value: FOG_PARAMS };
for (const lib of Object.values(ShaderLib)) {
    const u = lib.uniforms as Record<string, { value: unknown }>;
    if (u.fogColor) u.fogParams = { value: FOG_PARAMS };
}

/**
 * Height-aware fog, patched into EVERY fogged material by replacing three's
 * built-in fog shader chunks. Import this module before the first render.
 *
 * On top of the normal distance fog, a ground-hugging mist layer tints
 * fragments that sit low in the world. Its ceiling and strength ride the
 * scene fog's `near` value, so the weather system drives it for free:
 * a hazier scenario (small fogNear) means taller, denser mist.
 *
 * The world height is reconstructed from the view-space position
 * (mvPosition + transposed view rotation + camera position), which exists in
 * every three.js vertex shader — mesh, points and sprites alike.
 */
ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogWorldY;
	varying vec2 vFogWorldXZ;
#endif
`;

ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vec3 fogWorldPos = transpose( mat3( viewMatrix ) ) * mvPosition.xyz + cameraPosition;
	vFogWorldY = fogWorldPos.y;
	vFogWorldXZ = fogWorldPos.xz;
#endif
`;

ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec4 fogParams;
	varying float vFogDepth;
	varying float vFogWorldY;
	varying vec2 vFogWorldXZ;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

/**
 * Aerial perspective: the land beyond the board fades part of the way toward a
 * muted sky-horizon colour, so the mountain ring reads as far away. Measured by
 * how far a point lies PAST THE BOARD EDGE (not by camera distance, which put
 * haze on the board itself when zoomed out), so the battlefield never hazes.
 * The colour is the weather's fog colour, desaturated, so a yellow or deep blue
 * horizon doesn't tint the mountains yellow or blue. Tweak live (hard refresh):
 * - near / far: wu past the board edge where it starts / reaches full strength
 *   (ease-out: most of it comes early)
 * - strength: 0..1 the most it mixes in (0 = off)
 * - saturation: 0..1 how much of the horizon's colour it keeps (0 = grey)
 */
export const AERIAL_HAZE = {
    // the mountain ring starts ~110 wu past the board and peaks by ~500
    near: 80,
    far: 700,
    strength: 0.32,
    saturation: 0.35,
} as const;

/**
 * How much of the weather's distance fog is applied (1 = full). Scales the fog
 * amount, not its distances, so every weather keeps its own near/far character.
 * The ground mist and the aerial haze are separate and unaffected.
 */
export const DISTANCE_FOG_STRENGTH = 0.75;

/**
 * Deployment focus: 0..1 how strongly everything outside the board (ground,
 * mountains, trees, water — every fogged material; the sky isn't) is shaded like
 * the board overlay's ground you can't place on (PLACE_BLOCKED_SHADE in map.ts).
 */
export function setDeployShade(k: number): void {
    FOG_PARAMS[0] = k;
}

/**
 * The focus shade's colour (LINEAR — PLACE_BLOCKED_SHADE's sRGB 6,10,14 decoded) and
 * amount. The chunk runs after the colour conversion, so the colour goes through
 * linearToOutputTexel: with post-processing on, the frame is linear until the
 * output pass, and an sRGB constant there came out much lighter than the overlay.
 */
const DEPLOY_SHADE_RGB = '0.0018, 0.0030, 0.0044';
const DEPLOY_SHADE_ALPHA = 0.45;

/** The current match's board size (the aerial haze and the focus shade start at its edge). */
export function setAerialHazeBoard(halfW: number, halfH: number): void {
    FOG_PARAMS[1] = halfW;
    FOG_PARAMS[2] = halfH;
}

/** Ground-mist strength (0 = none). Live — no recompile needed. */
export function setHeightFogStrength(scale: number): void {
    FOG_PARAMS[3] = scale;
}

{
    const h = AERIAL_HAZE;
    ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	vec2 fogPastBoard = max( abs( vFogWorldXZ ) - fogParams.yz, 0.0 );
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ) * ${DISTANCE_FOG_STRENGTH.toFixed(3)};
		// aerial perspective (see AERIAL_HAZE): by distance past the board edge
		float aerialT = clamp( ( length( fogPastBoard ) - ${h.near.toFixed(1)} ) / ${(h.far - h.near).toFixed(1)}, 0.0, 1.0 );
		float aerial = aerialT * ( 2.0 - aerialT ) * ${h.strength.toFixed(3)};
		vec3 aerialCol = mix( vec3( dot( fogColor, vec3( 0.299, 0.587, 0.114 ) ) ), fogColor, ${h.saturation.toFixed(2)} );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, aerialCol, aerial );
		// ground mist: hazier scenarios (small fogNear) raise and thicken it
		float mistHaze = clamp( 1.0 - fogNear / 1500.0, 0.0, 1.0 );
		float mistCeil = mix( 4.0, 22.0, mistHaze );
		float mist = 1.0 - smoothstep( mistCeil * 0.15, mistCeil, vFogWorldY );
		// hold mist off until past typical board depth so close weather fog
		// doesn't stripe the field with a straight view-depth band
		mist *= smoothstep( max( 180.0, fogNear * 0.45 ), fogNear * 0.85 + 160.0, vFogDepth );
		fogFactor = max( fogFactor, mist * mix( 0.18, 0.5, mistHaze ) * fogParams.w );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	// deployment focus (fogParams.x, see setDeployShade)
	// signed distance to the board edge (negative inside): a near-hard edge right on it, so
	// no sliver of unshaded ground (or the board's edge faces) shows between this and the
	// board overlay, which shades the same colour and amount up to the edge
	float deployEdge = max( abs( vFogWorldXZ.x ) - fogParams.y, abs( vFogWorldXZ.y ) - fogParams.z );
	#ifdef DEPLOY_SHADE_ALL
		// the outer ground is outside the board everywhere: where its coarse triangles
		// rise through the board's edge (a hill just past it), they would show unshaded
		float deployK = fogParams.x;
	#else
		float deployK = fogParams.x * smoothstep( -0.05, 0.05, deployEdge );
	#endif
	vec3 deployCol = linearToOutputTexel( vec4( ${DEPLOY_SHADE_RGB}, 1.0 ) ).rgb;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, deployCol, deployK * ${DEPLOY_SHADE_ALPHA.toFixed(2)} );
#endif
`;
}
