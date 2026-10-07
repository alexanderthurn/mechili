import { ShaderChunk } from 'three';

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

/** the board's half extents for the haze; huge until a match sets them (= no haze) */
let hazeBoard = { halfW: 1e6, halfH: 1e6 };
let lastMistScale = 1;

/**
 * The current match's board size, baked into the fog chunk like the mist
 * strength (no per-material uniform needed). Recompile fogged materials after.
 */
export function setAerialHazeBoard(halfW: number, halfH: number): void {
    hazeBoard = { halfW, halfH };
    setHeightFogStrength(lastMistScale);
}

/**
 * Bakes the mist strength into the fog chunk (0 disables the height fog and
 * costs nothing). After changing it at runtime, every fogged material must be
 * recompiled (`material.needsUpdate = true`) to pick the new chunk up.
 */
export function setHeightFogStrength(scale: number): void {
    lastMistScale = scale;
    const h = AERIAL_HAZE;
    ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		// aerial perspective (see AERIAL_HAZE): by distance past the board edge
		vec2 aerialPast = max( abs( vFogWorldXZ ) - vec2( ${hazeBoard.halfW.toFixed(1)}, ${hazeBoard.halfH.toFixed(1)} ), 0.0 );
		float aerialT = clamp( ( length( aerialPast ) - ${h.near.toFixed(1)} ) / ${(h.far - h.near).toFixed(1)}, 0.0, 1.0 );
		float aerial = aerialT * ( 2.0 - aerialT ) * ${h.strength.toFixed(3)};
		vec3 aerialCol = mix( vec3( dot( fogColor, vec3( 0.299, 0.587, 0.114 ) ) ), fogColor, ${h.saturation.toFixed(2)} );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, aerialCol, aerial );
		${
            scale > 0
                ? `
		// ground mist: hazier scenarios (small fogNear) raise and thicken it
		float mistHaze = clamp( 1.0 - fogNear / 1500.0, 0.0, 1.0 );
		float mistCeil = mix( 4.0, 22.0, mistHaze );
		float mist = 1.0 - smoothstep( mistCeil * 0.15, mistCeil, vFogWorldY );
		// hold mist off until past typical board depth so close weather fog
		// doesn't stripe the field with a straight view-depth band
		mist *= smoothstep( max( 180.0, fogNear * 0.45 ), fogNear * 0.85 + 160.0, vFogDepth );
		fogFactor = max( fogFactor, mist * mix( 0.18, 0.5, mistHaze ) * ${scale.toFixed(2)} );`
                : ''
        }
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

setHeightFogStrength(1);
