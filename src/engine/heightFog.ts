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
#endif
`;

ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldY = ( transpose( mat3( viewMatrix ) ) * mvPosition.xyz + cameraPosition ).y;
#endif
`;

ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogWorldY;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

/**
 * Bakes the mist strength into the fog chunk (0 disables the height fog and
 * costs nothing). After changing it at runtime, every fogged material must be
 * recompiled (`material.needsUpdate = true`) to pick the new chunk up.
 */
export function setHeightFogStrength(scale: number): void {
    ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		${
            scale > 0
                ? `
		// ground mist: hazier scenarios (small fogNear) raise and thicken it
		float mistHaze = clamp( 1.0 - fogNear / 1500.0, 0.0, 1.0 );
		float mistCeil = mix( 4.0, 22.0, mistHaze );
		float mist = 1.0 - smoothstep( mistCeil * 0.15, mistCeil, vFogWorldY );
		// needs some distance before it builds up — keeps nearby units readable
		mist *= smoothstep( 40.0, fogNear * 0.55 + 120.0, vFogDepth );
		fogFactor = max( fogFactor, mist * mix( 0.18, 0.5, mistHaze ) * ${scale.toFixed(2)} );`
                : ''
        }
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

setHeightFogStrength(1);
