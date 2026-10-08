import { ShaderChunk, type Material } from 'three';

/**
 * The wind every swaying thing shares (board grass blades, meadow tufts): a
 * gentle steady breeze, gusts that roll across the land as soft bands in the
 * wind's direction, and a quick flutter on top that is stronger inside a gust.
 * One field for all, so a gust visibly travels from the meadow over the board.
 *
 * Tweak live (hard refresh):
 * - dir: the wind's heading (x, z) — the sky clouds drift along +x
 * - breeze: the steady lean, as a share of a blade's height
 * - gust: the extra lean inside a gust; gustSize: wu between gust bands;
 *   gustSpeed: wu/s they travel; gustShare: 0..1 how much of the land is in one
 * - flutter: the quick wobble; flutterSpeed: its rate (rad/s)
 * - treeSway: trees and bushes sway far less than grass (top movement per unit of lean,
 *   as a share of the tree's height; the trunk stays firm, the crown moves)
 * - season: the whole wind × this per season; storm: × this in the heaviest rain
 */
export const WIND = {
    dir: [1, 0.25],
    breeze: 0.1,
    gust: 0.5,
    gustSize: 45,
    gustSpeed: 11,
    gustShare: 0.4,
    flutter: 0.07,
    flutterSpeed: 3.2,
    /** trees and bushes: how far the top moves, as a share of its height per unit of lean */
    treeSway: 0.06,
    /** the whole wind × this per season (0 = still) */
    season: { spring: 1, summer: 1, autumn: 1.3, winter: 0 },
    /** × this in the worst rain (scaled by the rain's intensity; 1 = no change) — TEST value */
    storm: 5,
    /** seconds to ease to a new strength (season or weather change) */
    easeSeconds: 3,
} as const;

const f = (v: number) => v.toFixed(3);
const len = Math.hypot(WIND.dir[0], WIND.dir[1]);
const DIR = `vec2( ${f(WIND.dir[0] / len)}, ${f(WIND.dir[1] / len)} )`;

/** the clock the trees sway on (seconds; the scenery advances it) */
export const windTimeUniform = { value: 0 };

/** the whole wind's strength (× every lean): season and weather, eased — see updateWindStrength */
export const windStrengthUniform = { value: 1 };

/** ease the wind toward its strength for this season and weather (`rain` 0..1: intensity, 0 = none) */
export function updateWindStrength(dtSeconds: number, season: keyof typeof WIND.season, rain: number): void {
    const target = WIND.season[season] * (1 + (WIND.storm - 1) * Math.min(1, Math.max(0, rain)));
    const k = 1 - Math.exp(-dtSeconds / WIND.easeSeconds);
    windStrengthUniform.value += (target - windStrengthUniform.value) * k;
}

/** cache-key fragment for materials that include {@link WIND_GLSL} */
export const WIND_CACHE_KEY = `wind-${JSON.stringify(WIND).replace(/[^0-9.,]/g, '')}`;

/**
 * GLSL (global scope, vertex shader): `windDir()` and `windLean( worldXZ, time )`,
 * the lean at a point as a share of the swaying thing's height. The material binds
 * `uWindStrength` to {@link windStrengthUniform}.
 */
export const WIND_GLSL = /* glsl */ `
uniform float uWindStrength;
vec2 windDir() { return ${DIR}; }
float windHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float windNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( windHash( i ), windHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( windHash( i + vec2( 0.0, 1.0 ) ), windHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float windLean( vec2 p, float time ) {
	vec2 d = windDir();
	float along = dot( p, d );
	float across = dot( p, vec2( -d.y, d.x ) );
	// gust bands: noise stretched across the wind, travelling with it
	float g = windNoise( vec2( ( along - time * ${f(WIND.gustSpeed)} ) / ${f(WIND.gustSize)}, across / ${f(WIND.gustSize * 2.2)} ) );
	float gust = smoothstep( ${f(1 - WIND.gustShare)}, ${f(1 - WIND.gustShare + 0.3)}, g );
	float flutter = sin( time * ${f(WIND.flutterSpeed)} + along * 0.37 + across * 0.23 ) * 0.5 + 0.5;
	return ( ${f(WIND.breeze)} + gust * ${f(WIND.gust)} + flutter * ${f(WIND.flutter)} * ( 0.4 + gust ) ) * uWindStrength;
}
`;

/**
 * Make an (instanced) tree or bush material sway in the wind: its top leans with
 * {@link windLean}, growing with the square of the height above its base, so the
 * trunk stays put. `height` is the model's own height (local units, base at y = 0).
 * Values travel as uniforms, so every tree kind can share one program.
 */
export function attachWindSway(material: Material, height: number): void {
    if (material.userData.windSwayAttached) return;
    material.userData.windSwayAttached = true;
    const sway = { value: WIND.treeSway / Math.max(height, 0.01) };
    const prevCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        shader.uniforms.uWindTime = windTimeUniform;
        shader.uniforms.uWindSway = sway;
        shader.uniforms.uWindStrength = windStrengthUniform;
        shader.vertexShader =
            'uniform float uWindTime;\nuniform float uWindSway;\n' +
            WIND_GLSL +
            shader.vertexShader.replace(
                '#include <project_vertex>',
                ShaderChunk.project_vertex.replace(
                    'mvPosition = modelViewMatrix * mvPosition;',
                    `#ifdef USE_INSTANCING
	vec3 windBase = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	float windScale = length( instanceMatrix[ 1 ].xyz );
#else
	vec3 windBase = vec3( 0.0 );
	float windScale = 1.0;
#endif
	float windY = max( transformed.y, 0.0 );
	float windSwayK = windLean( windBase.xz, uWindTime ) * windY * windY * uWindSway * windScale;
	mvPosition.xz += windDir() * windSwayK;
	mvPosition = modelViewMatrix * mvPosition;`,
                ),
            );
    };
    material.needsUpdate = true;
}
