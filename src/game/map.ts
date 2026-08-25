import {
    CanvasTexture,
    Color,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    RepeatWrapping,
    SRGBColorSpace,
    Vector2,
    Vector3,
} from 'three';

import { hypot } from './detMath';
import { groundDetailCacheKey, groundMaterialProfile, PHOTO_BLEND, WEAR_BLEND, bindCloseTileUniforms, closeTileInjectGlsl, closeTileUniformDecls, closeTileWeightFallbackGlsl } from './groundQuality';
import {
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    loadGrassTextures,
    loadWearGroundTextures,
    loadWorldTexture,
} from './worldTextures';

/**
 * Default world units per grass tile (medium/low). High/ultra use a tighter
 * tile from {@link groundMaterialProfile} so HQ 2K maps get more texels/wu.
 */
export const DETAIL_TILE = 20;
export { grassAlbedoUrl, grassNormalUrl, sandAlbedoUrl };

/**
 * Shared 0–1 summer-dry grass amount (board + outer meadow + tufts).
 * Driven by scenery season changes; shaders bind this same object.
 */
export const summerDryUniform = { value: 0 };

/**
 * 1 = live fire ground is charcoal (fire VFX medium/high with tongues).
 * 0 = orange puddle (low fire VFX). Shared — one write updates all ground shaders.
 */
export const fireCharcoalGroundUniform = { value: 0 };

/** Shared battle time for fire flicker — ground + high/ultra vegetation hazard tint. */
export const hazardTimeShared = { value: 0 };

/** world units per grid tile */
export const CELL = 4;

import { THEME } from '../theme';
import { teamColors } from './colors';
import { prefs, type GroundEffectsQuality } from './prefs';

export interface Cell {
    col: number;
    row: number;
}

export function cellKey(cell: Cell): string {
    return `${cell.col}:${cell.row}`;
}

/** The composable dimensions of a battlefield, all in tiles. */
export interface MapSize {
    /** each player's main territory width */
    zoneCols: number;
    /** each player's main territory depth */
    zoneRows: number;
    /** no-placement strip between the two territories (split evenly) */
    neutralRows: number;
    /** width of the flank strips beside the opponent's half */
    flankCols: number;
    /** always-neutral band around the whole board (never deployable) */
    rimCells: number;
}

export const STANDARD_MAP: MapSize = {
    zoneCols: 60,
    zoneRows: 30,
    neutralRows: 4,
    flankCols: 6,
    rimCells: 4,
};

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Where each side's base buildings sit: `xFrac` across the zone width,
 * `rowFrac` into the zone depth (0 = own edge, 1 = toward the neutral strip),
 * `r` the flat-relief radius around the building. Shared by game.ts
 * (spawning) and BattleMap (keeping the ground flat underneath).
 */
export const BASE_ANCHORS = {
    research: { xFrac: 0.25, rowFrac: 0.62, r: 9 },
    command: { xFrac: 0.75, rowFrac: 0.62, r: 9 },
    stronghold: { xFrac: 0.5, rowFrac: 0.22, r: 14 },
    outerTowerRowFrac: 0.36,
    outerTowerXFrac: 0.17,
} as const;

let groundHeightFn: (x: number, z: number) => number = () => 0;

/**
 * Visual terrain height under a world position. Unit MESHES ride this so they
 * stand on the relief; the sim itself keeps walking on the flat y=0 plane.
 * Wired to the active BattleMap when it is constructed.
 */
export function groundHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z);
}

let outerHeightFn: (x: number, z: number) => number = () => 0;

/** the scenery registers its outer-terrain height here (0 inside the board) */
export function registerOuterHeight(fn: (x: number, z: number) => number): void {
    outerHeightFn = fn;
}

/** total visual terrain height anywhere: board relief + outer world */
export function worldHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z) + outerHeightFn(x, z);
}

/**
 * Height that keeps a footprint clear of the relief. Uses a single center
 * sample (cheap enough for per-frame battle seating); steep mounds may clip
 * the uphill edge slightly.
 */
export function groundSupportAt(x: number, z: number, _radius = 0.7): number {
    return groundHeightFn(x, z);
}

/**
 * SIM-side alias of {@link groundHeightAt}. The board height is never gated
 * by graphics settings, so both names return the same value — the sim code
 * uses this name to make its determinism requirement explicit.
 */
export function simGroundHeightAt(x: number, z: number): number {
    return groundHeightFn(x, z);
}

/** sim-side alias of {@link groundSupportAt} */
export function simGroundSupportAt(x: number, z: number, _radius = 0.7): number {
    return groundHeightFn(x, z);
}

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/** Deterministic 0..1 from an int (scorch patchiness, etc.). */
function fractHash(n: number): number {
    let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** seeded smooth 2D value noise in [0, 1] — cheap terrain-shaping building block */
export function makeValueNoise(seed: number): (x: number, y: number) => number {
    const lattice = (ix: number, iy: number): number => {
        let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 69069)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const sx = smooth01(x - ix);
        const sy = smooth01(y - iy);
        const a = lattice(ix, iy);
        const b = lattice(ix + 1, iy);
        const c = lattice(ix, iy + 1);
        const d = lattice(ix + 1, iy + 1);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
}

/** Cheap hash/fbm for high/ultra ground hazards (declared once at shader top). */
const HAZARD_NOISE_GLSL =
    'float hazHash( vec2 p ) {\n' +
    '\treturn fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
    '}\n' +
    'float hazNoise( vec2 p ) {\n' +
    '\tvec2 i = floor( p );\n' +
    '\tvec2 f = fract( p );\n' +
    '\tf = f * f * ( 3.0 - 2.0 * f );\n' +
    '\treturn mix(\n' +
    '\t\tmix( hazHash( i ), hazHash( i + vec2( 1.0, 0.0 ) ), f.x ),\n' +
    '\t\tmix( hazHash( i + vec2( 0.0, 1.0 ) ), hazHash( i + vec2( 1.0, 1.0 ) ), f.x ),\n' +
    '\t\tf.y );\n' +
    '}\n' +
    'float hazFbm( vec2 p ) {\n' +
    '\treturn hazNoise( p ) * 0.55 + hazNoise( p * 2.17 ) * 0.3 + hazNoise( p * 4.31 ) * 0.15;\n' +
    '}\n';

/**
 * Oil / fire / acid albedo. High/ultra: sluggish tar, active embers, bubbling acid.
 * Lower tiers keep a readable flat puddle.
 */
function groundHazardColorGlsl(rich: boolean): string {
    const masks =
        '\tvec3 haz = texture2D(uHazardMask, vMacroUv).rgb;\n' +
        (rich
            ? '\tfloat oilM = 0.0;\n'
            : '\tfloat oilM = smoothstep(0.04, 0.28, haz.r);\n') +
        '\tfloat fireG = smoothstep(0.14, 0.5, haz.g);\n' +
        '\tfloat fireB = smoothstep(0.12, 0.48, haz.b);\n' +
        '\tfloat orangeM = fireG * (1.0 - fireB * 0.85);\n' +
        '\tfloat azureM = min(fireG, fireB);\n' +
        '\tfloat acidM = fireB * (1.0 - fireG * 0.85);\n';
    if (!rich) {
        return (
            masks +
            '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.002, 0.002, 0.002), oilM * 0.995);\n' +
            '\tfloat flicker = 0.55 + 0.45 * sin(uHazardTime * 9.0 + vMacroUv.x * 40.0 + vMacroUv.y * 28.0);\n' +
            '\tvec3 orangeCol = mix(vec3(0.18, 0.03, 0.0), vec3(1.0, 0.32, 0.04), flicker);\n' +
            '\tvec3 tongueGround = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.5, 0.07), flicker);\n' +
            '\tvec3 liveFireCol = mix( orangeCol, tongueGround, uFireCharcoalGround );\n' +
            '\tfloat liveFireAmt = orangeM * mix( 0.72, 0.94, uFireCharcoalGround );\n' +
            '\tliveFireAmt *= mix( orangeM, 1.0, uFireCharcoalGround );\n' +
            '\tdiffuseColor.rgb = mix( diffuseColor.rgb, liveFireCol, liveFireAmt );\n' +
            '\tvec3 azureCol = mix(vec3(0.12, 0.02, 0.02), vec3(1.0, 0.32, 0.05), flicker);\n' +
            '\tazureCol = mix(azureCol, vec3(0.12, 0.14, 0.55), 0.22);\n' +
            '\tvec3 azureTongue = mix(vec3(0.12, 0.1, 0.45), vec3(1.0, 0.48, 0.1), flicker);\n' +
            '\tazureCol = mix( azureCol, azureTongue, uFireCharcoalGround * 0.85 );\n' +
            '\tdiffuseColor.rgb = mix(diffuseColor.rgb, azureCol, azureM * mix( 0.7, 0.9, uFireCharcoalGround ));\n' +
            '\tfloat bubble = 0.7 + 0.3 * sin(uHazardTime * 3.0 + vMacroUv.x * 60.0 - vMacroUv.y * 50.0);\n' +
            '\tvec3 acidCol = mix(vec3(0.04, 0.14, 0.02), vec3(0.38, 0.92, 0.12), bubble);\n' +
            '\tdiffuseColor.rgb = mix(diffuseColor.rgb, acidCol, acidM * 0.88);\n'
        );
    }
    return (
        masks +
        // Oil: photo-like black tar — solid core, frayed rim, mild center fretting.
        '\tfloat oilBase = smoothstep( 0.04, 0.28, haz.r );\n' +
        '\tfloat oilEdge = smoothstep( 0.02, 0.18, oilBase ) * ( 1.0 - smoothstep( 0.28, 0.62, oilBase ) );\n' +
        '\tfloat oilChew = hazFbm( vBoardXZ * 1.55 + vec2( 3.1, 7.7 ) );\n' +
        '\tfloat oilChew2 = hazNoise( vBoardXZ * 3.2 + 11.0 );\n' +
        '\tfloat oilFray = oilChew * 0.55 + oilChew2 * 0.45;\n' +
        '\toilM = oilBase * ( 1.0 - oilEdge * ( 1.0 - smoothstep( 0.32, 0.78, oilFray ) ) * 0.9 );\n' +
        // Sparse thin spots inside the puddle — larger than before, milder cut.
        '\tfloat oilCenter = smoothstep( 0.3, 0.6, oilBase );\n' +
        '\tfloat oilFret = hazNoise( vBoardXZ * 0.67 + 4.2 );\n' +
        '\tfloat oilFret2 = hazNoise( vBoardXZ * 1.2 + 13.0 );\n' +
        '\tfloat oilFretMask = smoothstep( 0.74, 0.93, oilFret ) * smoothstep( 0.5, 0.82, oilFret2 );\n' +
        '\toilM *= 1.0 - oilCenter * oilFretMask * 0.11;\n' +
        '\tfloat oilFlow = hazFbm( vBoardXZ * 0.14 + vec2( uHazardTime * 0.032, uHazardTime * 0.019 ) );\n' +
        // Sparse cool grey specular film (like wet pool reflection), rest stays black.
        '\tfloat oilFilmN = hazNoise( vBoardXZ * 0.42 + vec2( uHazardTime * 0.02, -uHazardTime * 0.015 ) );\n' +
        '\tfloat oilFilm = smoothstep( 0.7, 0.92, oilFlow ) * smoothstep( 0.62, 0.88, oilFilmN );\n' +
        '\tvec3 oilCol = mix( vec3( 0.0012, 0.0012, 0.0012 ), vec3( 0.28, 0.29, 0.3 ), oilFilm * 0.35 );\n' +
        '\tdiffuseColor.rgb = mix( diffuseColor.rgb, oilCol, oilM * 0.995 );\n' +
        // Fire: upward ember flow + hot sparks (more active than a sine puddle).
        '\tfloat fireFlow = hazFbm( vBoardXZ * 0.48 + vec2( uHazardTime * 0.22, -uHazardTime * 1.35 ) );\n' +
        '\tfloat firePop = hazNoise( vBoardXZ * 1.55 + vec2( -uHazardTime * 1.1, uHazardTime * 2.4 ) );\n' +
        '\tfloat embers = pow( clamp( fireFlow, 0.0, 1.0 ), 1.75 );\n' +
        '\tfloat sparks = smoothstep( 0.78, 0.94, firePop );\n' +
        '\tfloat flicker = 0.38 + 0.62 * embers;\n' +
        '\tvec3 orangeCol = mix( vec3( 0.12, 0.02, 0.0 ), vec3( 1.0, 0.38, 0.05 ), flicker );\n' +
        '\torangeCol = mix( orangeCol, vec3( 1.0, 0.84, 0.3 ), sparks * 0.7 );\n' +
        '\tvec3 tongueGround = mix( vec3( 0.48, 0.07, 0.012 ), vec3( 1.0, 0.52, 0.08 ), embers );\n' +
        '\ttongueGround = mix( tongueGround, vec3( 1.0, 0.9, 0.42 ), sparks * 0.55 );\n' +
        '\tvec3 liveFireCol = mix( orangeCol, tongueGround, uFireCharcoalGround );\n' +
        '\tfloat liveFireAmt = orangeM * mix( 0.72, 0.94, uFireCharcoalGround );\n' +
        '\tliveFireAmt *= mix( orangeM, 1.0, uFireCharcoalGround );\n' +
        '\tdiffuseColor.rgb = mix( diffuseColor.rgb, liveFireCol, liveFireAmt );\n' +
        '\tvec3 azureCol = mix( vec3( 0.1, 0.02, 0.02 ), vec3( 1.0, 0.36, 0.06 ), flicker );\n' +
        '\tazureCol = mix( azureCol, vec3( 0.14, 0.16, 0.58 ), 0.28 * ( 1.0 - embers ) );\n' +
        '\tvec3 azureTongue = mix( vec3( 0.1, 0.08, 0.42 ), vec3( 1.0, 0.5, 0.12 ), embers );\n' +
        '\tazureCol = mix( azureCol, azureTongue, uFireCharcoalGround * 0.85 );\n' +
        '\tazureCol = mix( azureCol, vec3( 0.85, 0.9, 1.0 ), sparks * 0.35 );\n' +
        '\tdiffuseColor.rgb = mix( diffuseColor.rgb, azureCol, azureM * mix( 0.7, 0.9, uFireCharcoalGround ) );\n' +
        // Acid: pulsing cells + lime rings (not oil-slow, not fire-flicker).
        '\tvec2 acidCell = floor( vBoardXZ * 0.52 );\n' +
        '\tvec2 acidF = fract( vBoardXZ * 0.52 );\n' +
        '\tfloat acidBest = 8.0;\n' +
        '\tfor ( int j = -1; j <= 1; j ++ ) {\n' +
        '\t\tfor ( int i = -1; i <= 1; i ++ ) {\n' +
        '\t\t\tvec2 g = vec2( float( i ), float( j ) );\n' +
        '\t\t\tfloat id = hazHash( acidCell + g );\n' +
        '\t\t\tvec2 o = vec2( id, hazHash( acidCell + g + 17.3 ) );\n' +
        '\t\t\tfloat pulse = 0.55 + 0.45 * sin( uHazardTime * 1.7 + id * 31.0 );\n' +
        '\t\t\tacidBest = min( acidBest, length( g + o - acidF ) / pulse );\n' +
        '\t\t}\n' +
        '\t}\n' +
        '\tfloat acidCaustic = hazFbm( vBoardXZ * 0.62 + vec2( uHazardTime * 0.19, -uHazardTime * 0.14 ) );\n' +
        '\tfloat acidRing = smoothstep( 0.48, 0.32, acidBest ) * smoothstep( 0.14, 0.26, acidBest );\n' +
        '\tfloat acidCore = smoothstep( 0.30, 0.06, acidBest );\n' +
        '\tvec3 acidCol = mix( vec3( 0.03, 0.12, 0.02 ), vec3( 0.2, 0.82, 0.1 ), acidCaustic );\n' +
        '\tacidCol = mix( acidCol, vec3( 0.48, 0.98, 0.18 ), acidCore * 0.75 );\n' +
        '\tacidCol = mix( acidCol, vec3( 0.85, 1.0, 0.38 ), acidRing * 0.85 );\n' +
        '\tdiffuseColor.rgb = mix( diffuseColor.rgb, acidCol, acidM * 0.88 );\n'
    );
}

const HAZARD_ROUGHNESS_GLSL =
    // Wet only where the grey film sits; edges stay a touch duller (coated grass).
    '\troughnessFactor = mix( roughnessFactor, 0.1, oilM * 0.55 );\n' +
    '\troughnessFactor = mix( roughnessFactor, 0.08, oilM * oilFilm * 0.4 );\n' +
    '\troughnessFactor = mix( roughnessFactor, 0.76, ( orangeM + azureM ) * 0.4 );\n' +
    '\troughnessFactor = mix( roughnessFactor, 0.22, acidM * 0.75 );\n';

/**
 * A battlefield built from a {@link MapSize}. Owns the grid math
 * (world x: -halfW..+halfW with +x screen-right; world z: -halfH at the enemy
 * edge (far) to +halfH at the player edge (near); rows counted from the
 * player edge) and generates the ground mesh.
 */
export class BattleMap {
    readonly cols: number;
    readonly rows: number;
    readonly width: number;
    readonly height: number;
    readonly halfW: number;
    readonly halfH: number;

    /** round 1 restricts deployment to the main zones; the game unlocks these from round 2 */
    flanksUnlocked = false;
    /** when unlocked, the neutral strip is split between the players (half each) */
    neutralUnlocked = false;
    /**
     * Network guests own the FAR half: both peers hold the IDENTICAL board
     * and only the camera differs — no coordinates are ever mirrored.
     */
    ownAtFar = false;

    /** live sand-wear mask is ready for stamping */
    get sandReady(): boolean {
        return this.sandMask !== null;
    }

    /** the field's macro tone canvas — the outer meadow samples its clamped edge */
    groundMacro: CanvasTexture | null = null;

    /** live sand-wear mask (null until ground textures finish loading) */
    private sandMask: CanvasTexture | null = null;
    /** static match-start mud patches — drawn under snow; not stamped by units */
    private baseSandMask: CanvasTexture | null = null;
    /**
     * Optional gore hue under blood stains (wear.g). Black = default dark red;
     * non-black RGB = darkened unit bloodColor (e.g. zombie acid green).
     */
    private bloodTintMask: CanvasTexture | null = null;
    private bloodTintCtx: CanvasRenderingContext2D | null = null;
    private sandCtx: CanvasRenderingContext2D | null = null;
    private sandW = 0;
    private sandH = 0;
    private sandSeed = 0;
    private sandDirty = false;
    private sandFlushAt = 0;
    /**
     * Hazard cells charcoal growth: step count (0..max) while fire is live.
     * Last sim-time we grew each cell (parallel array).
     */
    private fireScorchCells: Uint8Array | null = null;
    private fireScorchAt: Float32Array | null = null;

    /**
     * Oil / active-fire mask (separate from wear RGB): R = oil, G = fire.
     * Driven by HazardField for look only — never gameplay truth.
     */
    private hazardMask: CanvasTexture | null = null;
    private hazardCtx: CanvasRenderingContext2D | null = null;
    private hazardW = 0;
    private hazardH = 0;
    private hazardDirty = false;
    private hazardFlushAt = 0;
    /** updated each frame for fire flicker in the ground shader */
    private hazardTimeUniform: { value: number } | null = null;
    /** mirrors {@link fireCharcoalGroundUniform} for CPU-side stamp decisions */
    private fireCharcoalGround = false;
    /** 0..1 weather-driven snow dusting on the board (see `setSnowCover`) */
    private snowCoverUniform: { value: number } | null = null;

    /** ground texture + wear quality (the board's SHAPE is never gated) */
    private groundEffects: GroundEffectsQuality = prefs().groundEffects;

    setGroundEffects(quality: GroundEffectsQuality): void {
        this.groundEffects = quality;
    }

    /** wear stamping runs on high/medium; 'low' keeps the texture only */
    private wearEnabled(): boolean {
        return this.groundEffects === 'high' || this.groundEffects === 'medium';
    }

    constructor(readonly size: MapSize = STANDARD_MAP) {
        this.cols = size.zoneCols + 2 * size.flankCols + 2 * size.rimCells;
        this.rows = 2 * size.zoneRows + size.neutralRows + 2 * size.rimCells;
        this.width = this.cols * CELL;
        this.height = this.rows * CELL;
        this.halfW = this.width / 2;
        this.halfH = this.height / 2;
        groundHeightFn = (x, z) => this.heightAt(x, z);
    }

    cellCenter(col: number, row: number): Vector3 {
        return new Vector3(-this.halfW + (col + 0.5) * CELL, 0, this.halfH - (row + 0.5) * CELL);
    }

    /** center of a cols x rows tile rectangle anchored at `cell` (its top-left, enemy-most tile) */
    areaCenter(cell: Cell, cols: number, rows: number): Vector3 {
        return new Vector3(
            -this.halfW + (cell.col + cols / 2) * CELL,
            0,
            this.halfH - (cell.row + rows / 2) * CELL,
        );
    }

    inBounds(cell: Cell): boolean {
        return cell.col >= 0 && cell.col < this.cols && cell.row >= 0 && cell.row < this.rows;
    }

    worldToCell(p: Vector3): Cell | null {
        const col = Math.floor((p.x + this.halfW) / CELL);
        const row = Math.floor((this.halfH - p.z) / CELL);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        return { col, row };
    }

    private inRim(cell: Cell): boolean {
        const r = this.size.rimCells;
        return cell.col < r || cell.col >= this.cols - r || cell.row < r || cell.row >= this.rows - r;
    }

    /** flank strips sit inside the outer rim, beside the main zone */
    private inFlankCols(col: number): boolean {
        const r = this.size.rimCells;
        const f = this.size.flankCols;
        return (col >= r && col < r + f) || (col >= this.cols - r - f && col < this.cols - r);
    }

    /** rows of a side's territory, measured from its own playable edge (grows into the middle strip once unlocked) */
    private ownRows(): number {
        return this.size.zoneRows + (this.neutralUnlocked ? this.size.neutralRows / 2 : 0);
    }

    /** own half minus the opponent's flanks, plus (once unlocked) own flanks beside the opponent's half */
    private zoneHalf(cell: Cell, near: boolean): boolean {
        if (this.inRim(cell)) return false;
        const rim = this.size.rimCells;
        const zr = this.ownRows();
        const inNear = cell.row >= rim && cell.row < rim + zr;
        const inFar = cell.row >= this.rows - rim - zr && cell.row < this.rows - rim;
        const ownHalf = near ? inNear : inFar;
        const oppHalf = near ? inFar : inNear;
        if (!this.inFlankCols(cell.col)) return ownHalf;
        return this.flanksUnlocked && oppHalf;
    }

    isPlayerCell(cell: Cell): boolean {
        return this.zoneHalf(cell, !this.ownAtFar);
    }

    isEnemyCell(cell: Cell): boolean {
        return this.zoneHalf(cell, this.ownAtFar);
    }

    /** flank strips beside the opponent's half — deployable from round 2 once unlocked */
    isFlankDeployCell(cell: Cell, team: 'player' | 'enemy'): boolean {
        if (!this.flanksUnlocked || this.inRim(cell) || !this.inFlankCols(cell.col)) return false;
        const near = team === 'player' ? !this.ownAtFar : this.ownAtFar;
        const rim = this.size.rimCells;
        const zr = this.ownRows();
        const oppHalf = near
            ? cell.row >= this.rows - rim - zr && cell.row < this.rows - rim
            : cell.row >= rim && cell.row < rim + zr;
        return oppHalf;
    }

    /** center row of a team's main zone (near = row 0 side, the +z edge) */
    zoneCenterRow(near: boolean): number {
        const rim = this.size.rimCells;
        const half = Math.floor(this.size.zoneRows / 2);
        return near ? rim + half : this.rows - 1 - rim - half;
    }

    private readonly reliefNoise = makeValueNoise(9241);

    /**
     * Visual-only relief: gentle mounds rising up to `reliefDepth`, never
     * below 0. The sim keeps walking on the flat y=0 plane — feet wade a bit
     * into a mound, which the grass hides (better than hovering over dips).
     * Flat across the outer rim (to meet the outer meadow at y=0) and under
     * the base buildings (so the castles sit cleanly).
     */
    /**
     * The board's relief. ALWAYS on — never gated by graphics settings: the
     * sim's ballistics read it, so it must be identical on every machine in a
     * match, and the visuals simply show the same truth.
     */
    heightAt(x: number, z: number): number {
        const WAVE = 46;
        const n =
            this.reliefNoise(x / WAVE + 37.2, z / WAVE + 11.7) * 0.72 +
            this.reliefNoise(x / (WAVE * 0.41) + 5.1, z / (WAVE * 0.41) + 91.3) * 0.28;
        const hill = smooth01((n - 0.44) / 0.42); // the higher part of the noise mounds up
        // entire outer rim stays at y=0 so the field meets the meadow cleanly;
        // mounds only ease in once past the rim into the playable band
        const rimW = this.size.rimCells * CELL;
        const edge = Math.min(this.halfW - Math.abs(x), this.halfH - Math.abs(z));
        let fade = smooth01((edge - rimW) / 14);
        for (const a of this.baseAnchors()) {
            const d = hypot(x - a.x, z - a.z);
            fade = Math.min(fade, smooth01((d - a.r) / 10));
        }
        return THEME.terrain.reliefDepth * hill * fade;
    }

    /** approximate centers of the base buildings on both sides (see game.ts spawnTowers) */
    baseAnchors(): { x: number; z: number; r: number }[] {
        const { rimCells, flankCols, zoneCols, zoneRows } = this.size;
        const anchors: { x: number; z: number; r: number }[] = [];
        const specs = [
            BASE_ANCHORS.stronghold,
            BASE_ANCHORS.research,
            BASE_ANCHORS.command,
            { xFrac: 0.375, rowFrac: 0.62, r: 9 },
            { xFrac: 0.625, rowFrac: 0.62, r: 9 },
            { xFrac: BASE_ANCHORS.outerTowerXFrac, rowFrac: BASE_ANCHORS.outerTowerRowFrac, r: 9 },
            { xFrac: 1 - BASE_ANCHORS.outerTowerXFrac, rowFrac: BASE_ANCHORS.outerTowerRowFrac, r: 9 },
        ];
        for (const a of specs) {
            const x = -this.halfW + (rimCells + flankCols + zoneCols * a.xFrac) * CELL;
            const z = this.halfH - (rimCells + zoneRows * a.rowFrac) * CELL;
            anchors.push({ x, z, r: a.r }, { x: -x, z: -z, r: a.r });
        }
        return anchors;
    }

    /** displace a ground-aligned plane's vertices by the relief height */
    private applyRelief(geometry: PlaneGeometry): void {
        const pos = geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
            pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
        }
        pos.needsUpdate = true;
    }

    /** The ground plane: a code-generated texture on a real 3D plane mesh. */
    createMesh(seed = 1337): Mesh {
        const geometry = new PlaneGeometry(this.width, this.height, this.cols * 2, this.rows * 2);
        geometry.rotateX(-Math.PI / 2); // lie flat; texture top edge faces -z (enemy side)
        this.applyRelief(geometry);
        geometry.computeVertexNormals();
        const macro = this.createGroundTexture(seed);
        this.groundMacro = macro; // scenery continues this tone past the border
        // Oil/fire is gameplay-visible: always on, fixed mask res — independent of
        // the cosmetic ground-effects pref (sand/blood/scorch).
        const hazardMask = this.ensureHazardMask();
        const material = new MeshStandardMaterial({
            map: macro,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        this.attachGroundShader(material, macro, { hazardMask });
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        // ground effects 'off' keeps the plain macro canvas — no detail textures /
        // wear, but oil+fire still show via the hazard inject above
        if (this.groundEffects !== 'off') {
            void this.upgradeGroundMaterial(mesh, macro, seed);
        }
        return mesh;
    }

    /**
     * Ground wear mask (RGB): R = sand, G = blood, B = scorch.
     * Dynamic only — unit footprints / combat. Match-start mud lives in
     * {@link baseSandMask} so weather snow can cover it.
     */
    private createSandMask(seed: number): CanvasTexture {
        const w = this.groundEffects === 'medium' ? 256 : 512;
        const h = Math.round((w * this.height) / this.width);
        this.sandW = w;
        this.sandH = h;
        this.sandSeed = seed;

        // static base mud (under snow)
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = w;
        baseCanvas.height = h;
        const baseCtx = baseCanvas.getContext('2d')!;
        this.paintBaseSand(baseCtx, w, h, seed);
        this.baseSandMask = new CanvasTexture(baseCanvas);

        // live stamp mask starts empty
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        this.sandCtx = ctx;
        const tex = new CanvasTexture(canvas);
        this.sandMask = tex;

        // matching tint layer for non-red gore (same UV / resolution)
        const tintCanvas = document.createElement('canvas');
        tintCanvas.width = w;
        tintCanvas.height = h;
        const tintCtx = tintCanvas.getContext('2d')!;
        tintCtx.fillStyle = '#000';
        tintCtx.fillRect(0, 0, w, h);
        this.bloodTintCtx = tintCtx;
        this.bloodTintMask = new CanvasTexture(tintCanvas);

        return tex;
    }

    /** Match-start mud disabled — wear is footprints / combat only. */
    private paintBaseSand(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        _seed: number,
    ): void {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
    }

    /**
     * Soft radial stamp into one mask channel. Source-over with a pure R/G/B
     * color fades the other channels — so sand (R) walking over blood (G)
     * gradually restores a sandy look.
     */
    private drawWearBlob(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        r: number,
        alpha: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const a = Math.min(1, Math.max(0.02, alpha));
        const rgb =
            channel === 'r' ? `255,0,0` : channel === 'g' ? `0,255,0` : `0,0,255`;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${rgb},${a})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    /** Soft irregular courtyard pad (organic blotches, not a clean shape). */
    private drawWearRect(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        halfW: number,
        halfH: number,
        alpha: number,
        channel: 'r' | 'g' | 'b',
        seed = 1,
    ): void {
        const a = Math.min(1, Math.max(0.02, alpha));
        // Deterministic jitter from pad center so restamps match
        let s = (Math.imul(Math.floor(x * 17 + y * 31 + seed), 0x9e3779b1) >>> 0) || 1;
        const rnd = () => {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            return (s >>> 0) / 4294967296;
        };

        // Soft core — slightly stretched, not a perfect disc
        const coreR = Math.hypot(halfW, halfH) * (0.72 + rnd() * 0.12);
        this.drawWearBlob(ctx, x + (rnd() - 0.5) * halfW * 0.2, y + (rnd() - 0.5) * halfH * 0.2, coreR, a * 0.55, channel);

        // Irregular blotches around / inside the footprint
        const blobs = 7 + Math.floor(rnd() * 5);
        for (let i = 0; i < blobs; i++) {
            const ang = rnd() * Math.PI * 2;
            const dist = rnd() * Math.max(halfW, halfH) * 0.95;
            const bx = x + Math.cos(ang) * dist * (0.55 + rnd() * 0.7);
            const by = y + Math.sin(ang) * dist * (0.55 + rnd() * 0.7);
            // Keep mostly inside a soft ellipse of the footprint
            const nx = (bx - x) / Math.max(halfW, 1);
            const ny = (by - y) / Math.max(halfH, 1);
            if (nx * nx + ny * ny > 1.35) continue;
            const br = Math.min(halfW, halfH) * (0.28 + rnd() * 0.55);
            this.drawWearBlob(ctx, bx, by, br, a * (0.35 + rnd() * 0.5), channel);
        }

        // A few edge nicks so the silhouette isn't a clean oval
        const nicks = 3 + Math.floor(rnd() * 3);
        for (let i = 0; i < nicks; i++) {
            const ang = rnd() * Math.PI * 2;
            const bx = x + Math.cos(ang) * halfW * (0.85 + rnd() * 0.35);
            const by = y + Math.sin(ang) * halfH * (0.85 + rnd() * 0.35);
            this.drawWearBlob(ctx, bx, by, Math.min(halfW, halfH) * (0.18 + rnd() * 0.28), a * 0.3, channel);
        }
    }

    private stampWearChannel(
        x: number,
        z: number,
        radius: number,
        strength: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const r = Math.max(0.5, radius) * (this.sandW / this.width);
        this.drawWearBlob(ctx, cx, cy, r, strength, channel);
        this.sandDirty = true;
    }

    /** Stamp sandy wear (R). Also scrubs blood/scorch underfoot. */
    stampSand(x: number, z: number, radius: number, strength = 0.09): void {
        if (!this.wearEnabled()) return;
        const s =
            (this.groundEffects === 'medium' ? strength * 0.55 : strength) * WEAR_BLEND.stampStrength;
        this.stampWearChannel(x, z, radius * WEAR_BLEND.stampRadius, s, 'r');
        this.scrubBloodTint(x, z, radius * WEAR_BLEND.stampRadius, s);
    }

    /**
     * Soft rounded courtyard wear under a structure footprint (cols × rows).
     * Prefer this over {@link stampSand} for buildings.
     * @param scale — pad size vs footprint (Stronghold uses >1).
     */
    stampSandFootprint(
        x: number,
        z: number,
        cols: number,
        rows: number,
        strength = 0.14,
        scale = 1,
    ): void {
        if (!this.wearEnabled()) return;
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const s =
            (this.groundEffects === 'medium' ? strength * 0.55 : strength) * WEAR_BLEND.stampStrength;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const halfWu = (cols * CELL * 0.46 * scale) * WEAR_BLEND.stampRadius;
        const halfHu = (rows * CELL * 0.46 * scale) * WEAR_BLEND.stampRadius;
        const hx = Math.max(1, halfWu * (this.sandW / this.width));
        const hy = Math.max(1, halfHu * (this.sandH / this.height));
        this.drawWearRect(ctx, cx, cy, hx, hy, s, 'r');
        this.sandDirty = true;
        // courtyard pads also scrub gore tint under the footprint
        this.scrubBloodTint(x, z, Math.hypot(halfWu, halfHu), s);
    }

    /** Stamp blood under a hit/kill (G) — tight stain, short soft edge. */
    stampBlood(x: number, z: number, radius: number, strength = 0.14, color?: number): void {
        if (this.groundEffects !== 'high') return; // medium: sand + scorch only
        this.stampWearChannel(x, z, radius, strength, 'g');
        this.stampWearChannel(x, z, radius * 1.35, strength * 0.35, 'g');
        if (color != null) {
            this.stampBloodTint(x, z, radius, strength, color);
            this.stampBloodTint(x, z, radius * 1.35, strength * 0.35, color);
        }
    }

    /** Dark puddle tint matching particle bloodColor (keeps hue, crushes value). */
    private stampBloodTint(
        x: number,
        z: number,
        radius: number,
        strength: number,
        color: number,
    ): void {
        const ctx = this.bloodTintCtx;
        if (!ctx || !this.bloodTintMask) return;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const r = Math.max(0.5, radius) * (this.sandW / this.width);
        const a = Math.min(1, Math.max(0.02, strength));
        // crush to a wet-stain value while keeping the unit's gore hue
        const k = 0.14;
        const rr = Math.round(((color >> 16) & 255) * k);
        const gg = Math.round(((color >> 8) & 255) * k);
        const bb = Math.round((color & 255) * k);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`);
        grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        this.sandDirty = true;
    }

    /** Footsteps wash custom gore tint along with wear.g blood. */
    private scrubBloodTint(x: number, z: number, radius: number, strength: number): void {
        const ctx = this.bloodTintCtx;
        if (!ctx || !this.bloodTintMask) return;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const r = Math.max(0.5, radius) * (this.sandW / this.width);
        const a = Math.min(1, Math.max(0.02, strength * 1.2));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(0,0,0,${a})`);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        this.sandDirty = true;
    }

    /** Stamp scorched earth (B) — same soft double disc as blood. */
    stampScorch(x: number, z: number, radius: number, strength = 0.16): void {
        if (!this.wearEnabled()) return;
        const s = this.groundEffects === 'medium' ? strength * 0.65 : strength;
        this.stampWearChannel(x, z, radius, s, 'b');
        this.stampWearChannel(x, z, radius * 1.35, s * 0.35, 'b');
    }

    /**
     * Oriented soft rectangle wear (Hammer of the Gods footprint).
     * Matches HAMMER_ZONE + placement yaw — not a circumscribed disc.
     */
    stampWearOrientedRect(
        x: number,
        z: number,
        halfWidth: number,
        halfDepth: number,
        yaw: number,
        opts?: { sand?: number; scorch?: number },
    ): void {
        if (!this.wearEnabled()) return;
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const med = this.groundEffects === 'medium' ? 0.65 : 1;
        const sandA = (opts?.sand ?? 0.22) * med * WEAR_BLEND.stampStrength;
        const scorchA = (opts?.scorch ?? 0.5) * med * WEAR_BLEND.stampStrength;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const sx = this.sandW / this.width;
        const sy = this.sandH / this.height;
        const hx = Math.max(1, halfWidth * sx);
        const hy = Math.max(1, halfDepth * sy);
        if (sandA > 0.01) this.drawWearOrientedRect(ctx, cx, cy, hx, hy, yaw, sandA, 'r');
        if (scorchA > 0.01) {
            this.drawWearOrientedRect(ctx, cx, cy, hx * 0.96, hy * 0.96, yaw, scorchA, 'b');
            this.drawWearOrientedRect(ctx, cx, cy, hx * 1.04, hy * 1.04, yaw, scorchA * 0.22, 'b');
        }
        this.sandDirty = true;
    }

    /** Soft axis-aligned fill after rotate(yaw) — short feather, clear rectangle. */
    private drawWearOrientedRect(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        halfW: number,
        halfH: number,
        yaw: number,
        alpha: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const a = Math.min(1, Math.max(0.02, alpha));
        const rgb =
            channel === 'r' ? `255,0,0` : channel === 'g' ? `0,255,0` : `0,0,255`;
        const corner = Math.min(halfW, halfH) * 0.06;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(yaw);
        const shells = 4;
        for (let i = 0; i < shells; i++) {
            const t = i / (shells - 1);
            const grow = 1 + (1 - t) * 0.08;
            const layerA = a * (0.35 + t * 0.65);
            const w = halfW * grow;
            const h = halfH * grow;
            ctx.fillStyle = `rgba(${rgb},${layerA})`;
            this.fillRoundedRect(ctx, -w, -h, w * 2, h * 2, corner * grow);
        }
        ctx.restore();
    }

    private fillRoundedRect(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        r: number,
    ): void {
        const rr = Math.min(r, w * 0.5, h * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Irregular tower-ruin scorch — blotchy organic shape (not a clean disc).
     * `seed` keeps the silhouette stable for a given world position.
     */
    stampScorchIrregular(
        x: number,
        z: number,
        radius: number,
        strength = 0.16,
        seed = Math.imul(Math.floor(x * 1000) ^ Math.floor(z * 1000), 0x9e3779b1),
    ): void {
        if (!this.wearEnabled()) return;
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const s =
            (this.groundEffects === 'medium' ? strength * 0.65 : strength) * WEAR_BLEND.stampStrength;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const halfU = Math.max(1, radius * WEAR_BLEND.stampRadius * (this.sandW / this.width));
        let h = (Math.imul(seed, 0x9e3779b1) >>> 0) || 1;
        const rnd = () => {
            h ^= h << 13;
            h ^= h >>> 17;
            h ^= h << 5;
            return (h >>> 0) / 4294967296;
        };
        const stretch = 0.82 + rnd() * 0.36;
        this.drawWearRect(ctx, cx, cy, halfU, halfU * stretch, s, 'b', seed);
        this.sandDirty = true;
    }

    /**
     * Irregular burn blotches — core + satellites, with gaps (not oil-solid).
     */
    private stampScorchPatchy(x: number, z: number, radius: number, strength: number, seed: number): void {
        if (!this.wearEnabled()) return;
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const s = this.groundEffects === 'medium' ? strength * 0.65 : strength;
        const cx = ((x + this.halfW) / this.width) * this.sandW;
        const cy = ((z + this.halfH) / this.height) * this.sandH;
        const r = Math.max(0.5, radius) * (this.sandW / this.width);
        let h = (Math.imul(seed ^ Math.floor(cx * 13 + cy * 29), 0x9e3779b1) >>> 0) || 1;
        const rnd = () => {
            h ^= h << 13;
            h ^= h >>> 17;
            h ^= h << 5;
            return (h >>> 0) / 4294967296;
        };
        // Readable core, then blotches that leave irregular holes.
        this.drawWearBlob(ctx, cx + (rnd() - 0.5) * r * 0.2, cy + (rnd() - 0.5) * r * 0.2, r * 0.7, s * 0.75, 'b');
        const blobs = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < blobs; i++) {
            const ang = rnd() * Math.PI * 2;
            const dist = rnd() * r * 0.9;
            const bx = cx + Math.cos(ang) * dist;
            const by = cy + Math.sin(ang) * dist;
            const br = r * (0.28 + rnd() * 0.4);
            this.drawWearBlob(ctx, bx, by, br, s * (0.45 + rnd() * 0.45), 'b');
        }
        this.sandDirty = true;
    }

    /**
     * Charcoal under live ground fire — grows while burning, patchy (not a
     * solid oil-like fill). Stops when the flame dies; scar stays.
     */
    stampScorchUnderFire(
        field: {
            cellCols: number;
            cellRows: number;
            cellSize: number;
            worldToCell: (x: number, z: number) => { cx: number; cz: number };
            index: (cx: number, cz: number) => number;
            forEachFireCell: (
                now: number,
                fn: (x: number, z: number, dps: number, until: number, tint: number) => void,
            ) => void;
        },
        now: number,
    ): void {
        // Tongues tier: live ember tint comes from the hazard mask and clears with
        // the fire — don't also bake permanent wear scars under it.
        if (this.fireCharcoalGround) return;
        if (!this.wearEnabled()) return;
        const n = field.cellCols * field.cellRows;
        if (!this.fireScorchCells || this.fireScorchCells.length !== n) {
            this.fireScorchCells = new Uint8Array(n);
            this.fireScorchAt = new Float32Array(n);
            this.fireScorchAt.fill(-1e6);
        }
        const steps = this.fireScorchCells;
        const lastAt = this.fireScorchAt!;
        const GROW_DT = 0.32;
        const MAX_STEPS = 12;
        const STEP = 0.18;
        const r = field.cellSize * 1.2; // only slightly larger than the orange fire glow
        field.forEachFireCell(now, (x, z) => {
            const { cx, cz } = field.worldToCell(x, z);
            if (cx < 0 || cz < 0 || cx >= field.cellCols || cz >= field.cellRows) return;
            const i = field.index(cx, cz);
            if (steps[i]! >= MAX_STEPS) return;
            if (now - lastAt[i]! < GROW_DT) return;
            // ~15% green pockets — still irregular, but the burn reads.
            const cellRoll = fractHash(i * 7919 + 104729);
            if (cellRoll > 0.85) {
                lastAt[i] = now;
                steps[i] = MAX_STEPS;
                return;
            }
            const layerRoll = fractHash(i * 7919 + (steps[i]! + 1) * 104729);
            if (layerRoll > 0.88) {
                lastAt[i] = now;
                return;
            }
            lastAt[i] = now;
            steps[i]!++;
            const jx = (fractHash(i * 1103515245 + 12345) - 0.5) * field.cellSize * 0.45;
            const jz = (fractHash(i * 1664525 + 1013904223) - 0.5) * field.cellSize * 0.45;
            const layer = steps[i]!;
            const strength = STEP * (0.45 + 0.55 * (layer / MAX_STEPS));
            this.stampScorchPatchy(
                x + jx,
                z + jz,
                r * (0.85 + cellRoll * 0.25),
                strength,
                i + layer * 97,
            );
        });
    }

    /** Push pending canvas stamps to the GPU (throttled unless `force`). */
    flushSandMask(now = performance.now(), force = false): void {
        if (!this.sandDirty || !this.sandMask) return;
        const minMs = this.groundEffects === 'medium' ? 160 : 80;
        if (!force && now - this.sandFlushAt < minMs) return;
        this.sandMask.needsUpdate = true;
        if (this.bloodTintMask) this.bloodTintMask.needsUpdate = true;
        this.sandDirty = false;
        this.sandFlushAt = now;
    }

    /** Oil/fire mask: R = oil, G = active fire. Fixed size so every machine matches. */
    private ensureHazardMask(): CanvasTexture {
        if (this.hazardMask && this.hazardCtx) return this.hazardMask;
        // fixed — not tied to groundEffects quality (gameplay silhouette must match)
        const w = 256;
        const h = Math.round((w * this.height) / this.width);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        this.hazardW = w;
        this.hazardH = h;
        this.hazardCtx = ctx;
        const tex = new CanvasTexture(canvas);
        this.hazardMask = tex;
        return tex;
    }

    private stampHazardChannel(
        x: number,
        z: number,
        radius: number,
        strength: number,
        channel: 'r' | 'g' | 'b',
    ): void {
        const ctx = this.hazardCtx;
        if (!ctx || !this.hazardMask) return;
        const cx = ((x + this.halfW) / this.width) * this.hazardW;
        const cy = ((z + this.halfH) / this.height) * this.hazardH;
        const r = Math.max(0.5, radius) * (this.hazardW / this.width);
        this.drawWearBlob(ctx, cx, cy, r, strength, channel);
        this.hazardDirty = true;
    }

    /**
     * Rebuild oil (R) + fire (G) from the sim hazard field. Optional draft
     * stamps the same capsule silhouette as a real oil spill (visual only),
     * skipping cells inside ward-stone discs.
     */
    syncHazardFromField(
        field: {
            forEachOilCell: (fn: (x: number, z: number) => void) => void;
            forEachFireCell: (
                now: number,
                fn: (x: number, z: number, dps: number, until: number, tint: number) => void,
            ) => void;
            forEachAcidCell: (fn: (x: number, z: number, expiresRound: number) => void) => void;
            forEachCapsuleCells: (
                ax: number,
                az: number,
                bx: number,
                bz: number,
                radius: number,
                fn: (wx: number, wz: number) => void,
            ) => void;
            cellSize: number;
        },
        now = 0,
        draft: {
            startX: number;
            startZ: number;
            endX: number;
            endZ: number;
            radius: number;
        } | null = null,
        blockedBy: readonly { x: number; z: number; radius: number }[] = [],
    ): void {
        this.ensureHazardMask();
        const ctx = this.hazardCtx;
        if (!ctx || !this.hazardMask) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.hazardW, this.hazardH);
        // Soft discs larger than a cell so puddles melt together (blood-style),
        // instead of a visible square lattice of tiny stamps.
        const puddleR = field.cellSize * 1.55;
        // Orange (low VFX): tight under sparks. Tongues: slightly fuller ember pool.
        const fireR = field.cellSize * (this.fireCharcoalGround ? 1.05 : 0.72);
        const stampPuddle = (
            x: number,
            z: number,
            channel: 'r' | 'g' | 'b',
            core: number,
            radius = puddleR,
        ) => {
            this.stampHazardChannel(x, z, radius, core, channel);
            this.stampHazardChannel(x, z, radius * 1.2, core * 0.28, channel);
        };
        field.forEachOilCell((x, z) => stampPuddle(x, z, 'r', 0.92));
        field.forEachFireCell(now, (x, z, _dps, _until, tint) => {
            stampPuddle(x, z, 'g', 0.78, fireR);
            // dragon azure: G+B together (acid alone is B-only — see ground shader)
            // tint === 1 is FIRE_TINT_DRAGON (avoid importing fire.ts — circular with map)
            if (tint === 1) stampPuddle(x, z, 'b', 0.55, fireR);
        });
        field.forEachAcidCell((x, z) => stampPuddle(x, z, 'b', 0.65));
        if (draft) {
            field.forEachCapsuleCells(
                draft.startX,
                draft.startZ,
                draft.endX,
                draft.endZ,
                draft.radius,
                (x, z) => {
                    if (blockedBy.length > 0) {
                        for (const s of blockedBy) {
                            const dx = x - s.x;
                            const dz = z - s.z;
                            if (dx * dx + dz * dz <= s.radius * s.radius) return;
                        }
                    }
                    stampPuddle(x, z, 'r', 0.92);
                },
            );
        }
        this.hazardDirty = true;
        this.flushHazardMask(performance.now(), true);
    }

    /** Soft fire bloom at an impact (extra visual punch; field sync still owns shape). */
    stampHazardFire(x: number, z: number, radius: number, strength = 0.45): void {
        this.ensureHazardMask();
        this.stampHazardChannel(x, z, radius, strength, 'g');
        this.stampHazardChannel(x, z, radius * 1.3, strength * 0.4, 'g');
    }

    flushHazardMask(now = performance.now(), force = false): void {
        if (!this.hazardDirty || !this.hazardMask) return;
        // always flush reasonably fast — oil/fire is gameplay-readable
        const minMs = 80;
        if (!force && now - this.hazardFlushAt < minMs) return;
        this.hazardMask.needsUpdate = true;
        this.hazardDirty = false;
        this.hazardFlushAt = now;
    }

    /**
     * Shared oil/acid/fire mask (board UV). Used by the ground shader and
     * high+ scenery flower tint. Creating it is cheap; the canvas is filled
     * on first oil/acid stamp.
     */
    getHazardMask(): CanvasTexture {
        return this.ensureHazardMask();
    }

    /** Drive fire flicker in the ground shader (visual only). */
    setHazardTime(t: number): void {
        if (this.hazardTimeUniform) this.hazardTimeUniform.value = t;
        hazardTimeShared.value = t;
    }

    /**
     * When true (fire VFX medium/high with flame tongues), live fire ground is
     * charcoal that clears with the blaze — no orange puddle. Low fire VFX keeps orange.
     */
    setFireCharcoalGround(on: boolean): void {
        this.fireCharcoalGround = on;
        fireCharcoalGroundUniform.value = on ? 1 : 0;
    }

    /** Weather-driven snow wash on the board (visual only, melts under fire/oil/acid). */
    setSnowCover(v: number): void {
        if (this.snowCoverUniform) this.snowCoverUniform.value = v;
    }

    /**
     * Shared ground fragment inject: optional wear (sand/blood/scorch) + always
     * oil/fire hazard. High/ultra dual-scale / texture-bomb the grass, ease off
     * the soft macro canvas, and derive micro roughness from albedo luminance.
     */
    private attachGroundShader(
        material: MeshStandardMaterial,
        macro: CanvasTexture,
        opts: {
            hazardMask: CanvasTexture;
            sand?: import('three').Texture | null;
            sandMask?: CanvasTexture | null;
            baseSandMask?: CanvasTexture | null;
            bloodTintMask?: CanvasTexture | null;
            // Soft circular field-photo accents (texture bombing + multiply).
            photoGrass?: readonly [import('three').Texture, import('three').Texture] | null;
            detail?: boolean;
        },
    ): void {
        const {
            hazardMask,
            sand = null,
            sandMask = null,
            baseSandMask = null,
            bloodTintMask = null,
            photoGrass = null,
            detail = false,
        } = opts;
        const profile = groundMaterialProfile();
        const useDetail = detail && profile.detailStrength > 0;
        const bomb = useDetail && profile.textureBomb;
        const useCloseTile = detail && profile.closeRepeat > 1.01;
        const richHazards = profile.tier === 'high' || profile.tier === 'ultra';
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uMacro = { value: macro };
            shader.uniforms.uMacroBase = { value: new Color(THEME.terrain.base) };
            shader.uniforms.uMacroStrength = { value: detail ? profile.macroStrength : 1 };
            shader.uniforms.uHazardTime = { value: 0 };
            shader.uniforms.uHazardMask = { value: hazardMask };
            this.hazardTimeUniform = shader.uniforms.uHazardTime as { value: number };
            shader.uniforms.uSnowCover = { value: 0 };
            this.snowCoverUniform = shader.uniforms.uSnowCover as { value: number };
            shader.uniforms.uDryGrass = summerDryUniform;
            shader.uniforms.uFireCharcoalGround = fireCharcoalGroundUniform;
            shader.uniforms.uBoardHalf = { value: new Vector2(this.halfW, this.halfH) };
            if (useDetail) {
                shader.uniforms.uDetailScale = { value: profile.detailScale };
                shader.uniforms.uDetailStrength = { value: profile.detailStrength };
            }
            bindCloseTileUniforms(shader.uniforms as Record<string, { value: unknown }>, profile);
            shader.vertexShader =
                'varying vec2 vMacroUv;\nvarying vec2 vBoardXZ;\n' +
                shader.vertexShader.replace(
                    '#include <uv_vertex>',
                    '#include <uv_vertex>\n\tvMacroUv = uv;\n\tvBoardXZ = position.xz;',
                );
            let inject = '';
            let extraUniforms =
                'uniform sampler2D uHazardMask;\nuniform float uHazardTime;\nuniform float uFireCharcoalGround;\nuniform float uMacroStrength;\nuniform float uSnowCover;\nuniform float uDryGrass;\nuniform vec2 uBoardHalf;\nvarying vec2 vBoardXZ;\n' +
                closeTileUniformDecls(profile);
            if (richHazards) extraUniforms += HAZARD_NOISE_GLSL;
            // Shared: soft round patches via jittered-grid texture bombing (no square tiles).
            const softBlobFn =
                'float softBlobMask( vec2 uv, float cellScale, float density, float radius ) {\n' +
                '\tvec2 cell = floor( uv * cellScale );\n' +
                '\tfloat acc = 0.0;\n' +
                '\tfor ( int j = -1; j <= 1; j ++ ) {\n' +
                '\t\tfor ( int i = -1; i <= 1; i ++ ) {\n' +
                '\t\t\tvec2 c = cell + vec2( float( i ), float( j ) );\n' +
                '\t\t\tfloat h = fract( sin( dot( c, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
                '\t\t\tif ( h <= density ) {\n' +
                '\t\t\t\tvec2 jitter = vec2(\n' +
                '\t\t\t\t\tfract( sin( dot( c, vec2( 269.5, 183.3 ) ) ) * 43758.5453 ),\n' +
                '\t\t\t\t\tfract( sin( dot( c + 19.2, vec2( 113.5, 271.9 ) ) ) * 43758.5453 )\n' +
                '\t\t\t\t);\n' +
                '\t\t\t\tvec2 center = ( c + 0.5 + ( jitter - 0.5 ) * 0.9 ) / cellScale;\n' +
                '\t\t\t\tfloat d = length( uv - center ) * cellScale;\n' +
                '\t\t\t\tfloat r = radius * ( 0.5 + 0.5 * fract( h * 7.13 ) );\n' +
                '\t\t\t\tacc = max( acc, 1.0 - smoothstep( r * 0.25, r, d ) );\n' +
                '\t\t\t}\n' +
                '\t\t}\n' +
                '\t}\n' +
                '\treturn clamp( acc, 0.0, 1.0 );\n' +
                '}\n';
            // Closer camera → finer grass tile (blades stop looking human-sized).
            if (useCloseTile) {
                inject += closeTileInjectGlsl(profile);
            } else {
                inject += closeTileWeightFallbackGlsl(profile);
            }
            if (useDetail) {
                extraUniforms += 'uniform float uDetailScale;\nuniform float uDetailStrength;\n';
                if (bomb) {
                    // Keep bomb on the base lawn UV — uniform close tile, no extra breakup.
                    inject +=
                        '\tvec2 bombUv = vMapUv.yx * vec2( -1.0, 1.0 ) + vec2( 0.37, 0.19 );\n' +
                        '\tfloat bombW = fract( sin( dot( floor( vMapUv * 4.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n' +
                        '\tbombW = smoothstep( 0.28, 0.72, bombW );\n' +
                        '\tvec3 bombAlb = texture2D( map, bombUv ).rgb;\n' +
                        '\tdiffuseColor.rgb = mix( diffuseColor.rgb, bombAlb, bombW * 0.55 );\n';
                }
                if (useCloseTile) {
                    inject +=
                        '\tvec3 detailAlb = texture2D(map, mix( vMapUv, closeUv, closeW ) * uDetailScale).rgb;\n' +
                        '\tdiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);\n';
                } else {
                    inject +=
                        '\tvec3 detailAlb = texture2D(map, vMapUv * uDetailScale).rgb;\n' +
                        '\tdiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);\n';
                }
            }
            // Field photos at far/mid; fade out when close so the lawn stays uniform.
            if (photoGrass) {
                const g = PHOTO_BLEND.grass;
                shader.uniforms.uPhotoGrass1 = { value: photoGrass[0] };
                shader.uniforms.uPhotoGrass2 = { value: photoGrass[1] };
                extraUniforms += 'uniform sampler2D uPhotoGrass1;\nuniform sampler2D uPhotoGrass2;\n';
                const pgCloseFade = useCloseTile
                    ? `\tpgVeil *= mix( 1.0, 0.08, closeW );\n`
                    : '';
                inject +=
                    `\tfloat pgSoft = softBlobMask( vMapUv, ${g.cellScale.toFixed(2)}, ${g.density.toFixed(2)}, ${g.radius.toFixed(2)} );\n` +
                    `\tvec2 pgUv = vMapUv * ${g.uvScale.toFixed(2)};\n` +
                    '\tvec2 pgUvB = pgUv.yx * vec2( -0.91, 1.07 ) + vec2( 0.27, 0.41 );\n' +
                    '\tfloat pgBomb = fract( sin( dot( floor( vMapUv * 2.4 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n' +
                    '\tpgBomb = smoothstep( 0.22, 0.78, pgBomb );\n' +
                    '\tvec3 pgA = texture2D( uPhotoGrass1, pgUv ).rgb;\n' +
                    '\tvec3 pgDark = mix(\n' +
                    '\t\ttexture2D( uPhotoGrass2, pgUv * 0.72 ).rgb,\n' +
                    '\t\ttexture2D( uPhotoGrass2, pgUvB * 0.64 ).rgb,\n' +
                    '\t\tpgBomb );\n' +
                    '\tfloat pgDarkLum = max( dot( pgDark, vec3( 0.299, 0.587, 0.114 ) ), 0.06 );\n' +
                    '\tvec3 pgCombo = pgA * ( pgDark / pgDarkLum );\n' +
                    '\tpgCombo = mix( pgCombo, pgA * pgDark * 2.2, 0.35 );\n' +
                    '\tfloat pgComboLum = max( dot( pgCombo, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );\n' +
                    '\tvec3 pgDetail = pgCombo / pgComboLum;\n' +
                    `\tfloat pgVeil = 0.45 + 0.55 * pgSoft;\n` +
                    '\tvec2 pgN = abs( vBoardXZ ) / max( uBoardHalf, vec2( 1.0 ) );\n' +
                    '\tfloat pgInner = 1.0 - smoothstep( 0.80, 0.92, max( pgN.x, pgN.y ) );\n' +
                    '\tfloat pgPatch = softBlobMask( vMapUv, 0.55, 0.45, 0.7 );\n' +
                    '\tpgVeil *= pgInner * mix( 0.25, 0.55, pgPatch ) * 0.45;\n' +
                    pgCloseFade +
                    `\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pgDetail, pgVeil * ${g.strength.toFixed(2)} );\n` +
                    `\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * mix( vec3( 1.0 ), pgDark * 1.8, 0.6 ), pgVeil * ${(g.strength * 0.65).toFixed(2)} );\n`;
            }
            // Soft macro before snow so the white wash matches the outer meadow
            // (macro after snow was tinting the board frost green again).
            inject +=
                '\tvec3 macroTex = texture2D(uMacro, vMacroUv).rgb / max(uMacroBase, vec3(1e-3));\n' +
                '\tdiffuseColor.rgb *= mix( vec3( 1.0 ), macroTex, uMacroStrength );\n' +
                // Summer drought: keep lawn texture, pull chroma toward straw (before mud/snow).
                '\tfloat dryPatch = 0.52 + 0.48 * fract( sin( dot( vBoardXZ * 0.072, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n' +
                '\tvec3 dryCol = mix( diffuseColor.rgb * vec3( 1.18, 1.05, 0.55 ), vec3( 0.72, 0.64, 0.28 ), 0.16 );\n' +
                '\tdiffuseColor.rgb = mix( diffuseColor.rgb, dryCol, uDryGrass * dryPatch );\n';
            if (sand && (baseSandMask || sandMask)) {
                shader.uniforms.uSand = { value: sand };
                extraUniforms += 'uniform sampler2D uSand;\n';
            }
            inject +=
                '\tfloat preSnowLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );\n';
            // Match-start mud UNDER snow (shows again when frost melts).
            if (sand && baseSandMask) {
                shader.uniforms.uBaseSandMask = { value: baseSandMask };
                extraUniforms += 'uniform sampler2D uBaseSandMask;\n';
                inject +=
                    '\tfloat baseWearR = texture2D(uBaseSandMask, vMacroUv).r;\n' +
                    '\tfloat baseSandM = smoothstep(0.06, 0.38, baseWearR - (preSnowLum - 0.25) * 0.35);\n' +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uSand, vMapUv).rgb, baseSandM);\n';
            }
            // Soft weather frost. Unit footprints / blood / scorch paint after.
            inject +=
                '\tfloat snowLine = mix( 220.0, -15.0, uSnowCover );\n' +
                '\tfloat snowMask = smoothstep( snowLine - 40.0, snowLine + 15.0, 0.0 );\n' +
                '\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.95, 0.98 ), snowMask * 0.82 );\n';
            if (sand && sandMask) {
                shader.uniforms.uSandMask = { value: sandMask };
                extraUniforms += 'uniform sampler2D uSandMask;\n';
                if (bloodTintMask) {
                    shader.uniforms.uBloodTint = { value: bloodTintMask };
                    extraUniforms += 'uniform sampler2D uBloodTint;\n';
                }
                inject +=
                    '\tvec3 wear = texture2D(uSandMask, vMacroUv).rgb;\n' +
                    '\tfloat sandLum = preSnowLum;\n' +
                    '\tvec3 sandTexel = texture2D(uSand, vMapUv).rgb;\n' +
                    '\tfloat scorchM = smoothstep(0.03, 0.22, wear.b);\n' +
                    '\tfloat bloodM = smoothstep(0.08, 0.35, wear.g);\n' +
                    '\tfloat sandM = smoothstep(0.06, 0.38, wear.r - (sandLum - 0.25) * 0.35);\n' +
                    // Soft organic ash (no floor-grid — that read as pixels).
                    '\tfloat ashA = fract( sin( dot( vMapUv * 11.0, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
                    '\tfloat ashB = fract( sin( dot( vMapUv * 29.0, vec2( 269.5, 183.3 ) ) ) * 43758.5453 );\n' +
                    '\tfloat ashC = fract( sin( dot( vMapUv * 7.3 + ashA, vec2( 91.7, 53.1 ) ) ) * 43758.5453 );\n' +
                    '\tfloat ashBreak = clamp( ashA * 0.35 + ashB * 0.4 + ashC * 0.25, 0.0, 1.0 );\n' +
                    '\tfloat scorchFill = scorchM * mix( 0.72, 1.0, ashBreak ) * 0.97;\n' +
                    '\tvec3 charCol = vec3( 0.008, 0.006, 0.005 );\n' +
                    '\tvec3 ashDirt = sandTexel * vec3( 0.18, 0.15, 0.12 );\n' +
                    '\tvec3 burnCol = mix( ashDirt, charCol, smoothstep( 0.12, 0.65, ashBreak ) );\n' +
                    '\tdiffuseColor.rgb = mix( diffuseColor.rgb, burnCol, scorchFill );\n' +
                    (bloodTintMask
                        ? '\tvec3 goreTint = texture2D(uBloodTint, vMacroUv).rgb;\n' +
                          '\tfloat hasGore = step(0.004, max(goreTint.r, max(goreTint.g, goreTint.b)));\n' +
                          '\tvec3 bloodCol = mix(vec3(0.06, 0.005, 0.008), goreTint, hasGore);\n' +
                          '\tdiffuseColor.rgb = mix(diffuseColor.rgb, bloodCol, bloodM);\n'
                        : '\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.005, 0.008), bloodM);\n') +
                    // In snow: footprints = pressed pack (darker frost), not bare mud.
                    // snowMask 0 → dirt trails; snowMask 1 → compacted snow with a hint of grit.
                    // grassStampShow softens mud on lawn only — snow keeps full sandM.
                    '\tvec3 packedSnow = diffuseColor.rgb * vec3( 0.52, 0.58, 0.68 );\n' +
                    '\tvec3 trailCol = mix( sandTexel, mix( packedSnow, sandTexel, 0.22 ), snowMask );\n' +
                    `\tfloat sandShow = sandM * mix( ${WEAR_BLEND.grassStampShow.toFixed(2)}, 1.0, snowMask );\n` +
                    '\tdiffuseColor.rgb = mix(diffuseColor.rgb, trailCol, sandShow);\n';
            }
            // oil / fire / acid — always readable; high/ultra add motion
            inject += groundHazardColorGlsl(richHazards);
            let frag =
                'uniform sampler2D uMacro;\nuniform vec3 uMacroBase;\nvarying vec2 vMacroUv;\n' +
                extraUniforms +
                (photoGrass ? softBlobFn : '') +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${inject}`);
            if (useDetail && material.normalMap) {
                // Micro normals in the same space as the already-perturbed map
                // (cheap UDN-style). Avoids perturbNormalArb — removed/changed in r185.
                let normalInject = `#include <normal_fragment_maps>
\tvec3 detailN = texture2D( normalMap, vMapUv * uDetailScale ).xyz * 2.0 - 1.0;
\tdetailN.xy *= uDetailStrength;
\tnormal = normalize( vec3( normal.xy + detailN.xy, normal.z ) );`;
                if (useCloseTile) {
                    normalInject += `
\tvec3 closeN = texture2D( normalMap, vMapUv * uCloseRepeat ).xyz * 2.0 - 1.0;
\tnormal = normalize( mix( normal, closeN, closeW ) );`;
                }
                frag = frag.replace('#include <normal_fragment_maps>', normalInject);
            }
            if (profile.roughnessFromAlbedo && detail) {
                frag = frag.replace(
                    '#include <roughnessmap_fragment>',
                    `#include <roughnessmap_fragment>
\tfloat grassLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
\t// darker soil pockets slightly rougher; bright blades a touch less flat-matte
\troughnessFactor = clamp( roughnessFactor + ( 0.42 - grassLum ) * 0.22, 0.62, 0.98 );
${richHazards ? HAZARD_ROUGHNESS_GLSL : ''}`,
                );
            } else if (richHazards) {
                frag = frag.replace(
                    '#include <roughnessmap_fragment>',
                    `#include <roughnessmap_fragment>\n${HAZARD_ROUGHNESS_GLSL}`,
                );
            }
            shader.fragmentShader = frag;
        };
        material.customProgramCacheKey = () =>
            `ground-hazard-v62${richHazards ? '-dyn' : ''}${sand && sandMask ? '-wear-rgb' : ''}${bloodTintMask ? '-gore' : ''}${baseSandMask ? '-base' : ''}${photoGrass ? '-pginner' : ''}${useCloseTile ? '-closey' : ''}-gs${
                WEAR_BLEND.grassStampShow.toFixed(2)
            }-${useDetail ? groundDetailCacheKey(profile) : 'plain'}-fcg`;
    }

    /**
     * Softly fade all wear toward clean grass. `keep` is how much remains
     * (0.7 ≈ 30% fade). Call once per new round so scars heal over time.
     */
    fadeWear(keep = 0.7): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        const k = Math.min(1, Math.max(0, keep));
        const v = Math.round(k * 255);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, 0, this.sandW, this.sandH);
        ctx.restore();
        this.sandMask.needsUpdate = true;
        const tint = this.bloodTintCtx;
        if (tint && this.bloodTintMask) {
            tint.save();
            tint.globalCompositeOperation = 'multiply';
            tint.fillStyle = `rgb(${v},${v},${v})`;
            tint.fillRect(0, 0, this.sandW, this.sandH);
            tint.restore();
            this.bloodTintMask.needsUpdate = true;
        }
        this.sandDirty = false;
        this.sandFlushAt = performance.now();
        this.fireScorchCells = null;
        this.fireScorchAt = null;
    }

    /** Wipe unit wear (new match). Base mud patches stay on their own layer. */
    clearSandWear(): void {
        const ctx = this.sandCtx;
        if (!ctx || !this.sandMask) return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.sandW, this.sandH);
        this.sandMask.needsUpdate = true;
        const tint = this.bloodTintCtx;
        if (tint && this.bloodTintMask) {
            tint.fillStyle = '#000';
            tint.fillRect(0, 0, this.sandW, this.sandH);
            this.bloodTintMask.needsUpdate = true;
        }
        this.sandDirty = false;
        this.sandFlushAt = performance.now();
        this.fireScorchCells = null;
        this.fireScorchAt = null;
    }

    /** Radius for a pack courtyard stamp from its tile footprint. */
    packSandRadius(cols: number, rows: number): number {
        return Math.max(cols, rows) * CELL * 0.38;
    }

    /**
     * How hard a ground unit presses into the sand (1 ≈ archer/dwarf).
     * Uses `type.sandWeight` when set; otherwise derives from cost + bulk.
     */
    sandStampWeight(type: {
        sandWeight?: number;
        cost: number;
        collisionRadius: number;
        meshScale: number;
    }): number {
        if (type.sandWeight !== undefined) return type.sandWeight;
        const costW = type.cost / 100;
        const bulkW = (type.collisionRadius * type.meshScale) / 2.5;
        return Math.max(0.55, Math.min(4.5, 0.5 * costW + 0.5 * bulkW));
    }

    /**
     * Swaps the macro-only ground material for the detailed one once the
     * generated grass textures arrive: a high-frequency tiled albedo+normal
     * carries the blade detail, while the macro canvas (meadow drift,
     * dirt, flowers, sun wash, vignette, border) modulates it — divided by the
     * base tone so it acts as pure relative variation. Until then (or if the
     * files are missing) the ground keeps the plain macro look.
     */
    private async upgradeGroundMaterial(mesh: Mesh, macro: CanvasTexture, seed: number): Promise<void> {
        const grass = await loadGrassTextures();
        if (!grass?.albedo) return;
        const { albedo, normal } = grass;
        const profile = groundMaterialProfile();
        // Wear surface: HQ dirt on high/ultra, sand on lower tiers
        const wear = await loadWearGroundTextures();
        const sand = wear?.albedo ?? (await loadWorldTexture(sandAlbedoUrl));
        const tileSize = profile.detailTile;
        const repeat = new Vector2(this.width / tileSize, this.height / tileSize);
        const tile = (t: typeof albedo) => {
            t.wrapS = t.wrapT = RepeatWrapping;
            t.repeat.copy(repeat);
            t.anisotropy = profile.anisotropy;
        };
        tile(albedo);
        // boot preload may already have set this; keep local path correct too
        albedo.colorSpace = SRGBColorSpace;
        if (normal) tile(normal);
        if (sand) {
            tile(sand);
            sand.colorSpace = SRGBColorSpace;
        }
        if (wear?.normal) tile(wear.normal);
        for (const v of grass.variants) tile(v);
        const wearOn = this.wearEnabled();
        const sandMask = sand && wearOn ? this.createSandMask(seed) : null;
        if (!sandMask) {
            this.sandMask = null;
            this.baseSandMask = null;
            this.sandCtx = null;
            this.bloodTintMask = null;
            this.bloodTintCtx = null;
            this.fireScorchCells = null;
            this.fireScorchAt = null;
        }
        const hazardMask = this.ensureHazardMask();

        const n = profile.normalScale;
        const material = new MeshStandardMaterial({
            map: albedo,
            normalMap: normal ?? undefined,
            normalScale: new Vector2(n, n),
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
        });
        // variants = grass photos; prefer photo-2 (dark seamless) in the blob mix
        const photoGrass =
            grass.variants[0] && grass.variants[2]
                ? ([grass.variants[0], grass.variants[2]] as const)
                : grass.variants[0] && grass.variants[1]
                  ? ([grass.variants[0], grass.variants[1]] as const)
                  : null;
        this.attachGroundShader(material, macro, {
            hazardMask,
            sand: sandMask ? sand : null,
            sandMask,
            baseSandMask: this.baseSandMask,
            bloodTintMask: this.bloodTintMask,
            photoGrass,
            detail: true,
        });

        const previous = mesh.material as MeshStandardMaterial;
        mesh.material = material;
        previous.dispose(); // keeps `macro` alive — dispose() frees the program, not textures
    }

    /**
     * Battlefield ground drawn entirely in code: a well-kept lawn. Big soft
     * shapes carry the variation; fine detail stays low-contrast so unit
     * silhouettes read clearly against it.
     */
    private createGroundTexture(seed: number): CanvasTexture {
        const TEX_SCALE = 8; // texture pixels per world unit
        const w = this.width * TEX_SCALE;
        const h = this.height * TEX_SCALE;
        const rng = mulberry32(seed);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        const t = THEME.terrain;
        ctx.fillStyle = t.base;
        ctx.fillRect(0, 0, w, h);

        const circle = (x: number, y: number, r: number) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
        };

        // decoration counts scale with the field area
        const density = (this.width * this.height) / 9000;

        // very large soft meadow patches — low-frequency color drift
        for (let i = 0; i < 140 * density; i++) {
            const tone = t.meadow[Math.floor(rng() * t.meadow.length)]!;
            const r = 60 + rng() * 220;
            const cx = rng() * w;
            const cy = rng() * h;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, tone);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.08 + rng() * 0.1;
            ctx.fillStyle = grad;
            circle(cx, cy, r);
            ctx.fill();
        }

        // faint worn-earth patches — a lived-on field, kept very subtle
        for (let i = 0; i < 6 * density; i++) {
            const cx = rng() * w;
            const cy = rng() * h;
            const r = 24 + rng() * 60;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, t.dirt);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = grad;
            circle(cx, cy, r);
            ctx.fill();
        }

        // grass blades: short strokes instead of dot noise — dark first, bright on top
        const blades = (color: string, count: number, alpha: number) => {
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const x = rng() * w;
                const y = rng() * h;
                const len = 3 + rng() * 6;
                const lean = (rng() - 0.5) * 4;
                ctx.moveTo(x, y);
                ctx.lineTo(x + lean, y - len);
            }
            ctx.stroke();
        };
        blades(t.bladeDark, 700 * density, 0.14);
        blades(t.bladeBright, 900 * density, 0.16);

        // rare wildflowers, growing in small clusters
        for (let i = 0; i < 14 * density; i++) {
            const cx = rng() * w;
            const cy = rng() * h;
            const color = t.flowers[Math.floor(rng() * t.flowers.length)]!;
            const dots = 3 + Math.floor(rng() * 5);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.75;
            for (let d = 0; d < dots; d++) {
                circle(cx + (rng() - 0.5) * 30, cy + (rng() - 0.5) * 30, 1.2 + rng() * 1.2);
                ctx.fill();
            }
        }

        // warm sunny wash toward the far (enemy) edge
        const sunGrad = ctx.createLinearGradient(0, 0, 0, h);
        sunGrad.addColorStop(0, t.sunWashTop);
        sunGrad.addColorStop(1, t.sunWashBottom);
        ctx.globalAlpha = 1;
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, w, h);

        // soft vignette — darker rim frames the battlefield
        const vin = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
        vin.addColorStop(0, 'rgba(0,0,0,0)');
        vin.addColorStop(1, t.vignette);
        ctx.fillStyle = vin;
        ctx.fillRect(0, 0, w, h);

        // wash unique lawn paint out near the border so the field edge meets
        // the outer grass instead of a hard painted cut
        {
            const rim = 16 * TEX_SCALE;
            ctx.fillStyle = t.base;
            for (let i = 0; i < rim; i++) {
                ctx.globalAlpha = (1 - i / rim) * 0.7;
                ctx.fillRect(i, 0, 1, h);
                ctx.fillRect(w - 1 - i, 0, 1, h);
                ctx.fillRect(0, i, w, 1);
                ctx.fillRect(0, h - 1 - i, w, 1);
            }
            ctx.globalAlpha = 1;
        }

        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
    }

    /**
     * The placement helper overlay: tile grid + deployment zone tints. Only
     * shown during the build phase — the war phase plays on clean terrain.
     * `lane` is the LOCAL seat's own half of the zone in team modes ('full'
     * for a solo seat) — when it isn't 'full', a divider marks where the
     * seat's own placeable half ends, since {@link laneOk} enforces this
     * strictly but nothing used to show it.
     */
    createOverlayMesh(lane: 'full' | 'left' | 'right' = 'full'): Mesh {
        const TEX_SCALE = 8;
        const w = this.width * TEX_SCALE;
        const h = this.height * TEX_SCALE;
        const cellPx = CELL * TEX_SCALE;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        const t = THEME.terrain;

        // deployment zone tints: each half has the owner's color in the
        // center; the flank strips belong to the opponent once unlocked.
        // the zones grow into the middle strip once that is unlocked.
        // the outer rim stays clear of overlay paint/grid so it reads as terrain.
        const rimPx = this.size.rimCells * cellPx;
        const zonePx = (this.size.zoneRows + (this.neutralUnlocked ? this.size.neutralRows / 2 : 0)) * cellPx;
        const flankPx = this.size.flankCols * cellPx;
        const playH = h - 2 * rimPx;
        const paintZone = (x: number, y: number, zw: number, zh: number, tint: string, dim = false) => {
            ctx.fillStyle = `${tint} ${dim ? 0.04 : 0.12})`;
            ctx.fillRect(x, y, zw, zh);
            ctx.strokeStyle = `${tint} ${dim ? 0.22 : 0.55})`;
            ctx.lineWidth = dim ? 2 : 3;
            ctx.strokeRect(x + 1.5, y + 1.5, zw - 3, zh - 3);
        };
        // texture top = far (-z) half; whose that is depends on ownAtFar
        const nearTint = this.ownAtFar ? teamColors.enemy.tint : teamColors.player.tint;
        const farTint = this.ownAtFar ? teamColors.player.tint : teamColors.enemy.tint;
        const midCol = Math.floor(this.cols / 2);
        const midX = midCol * cellPx;
        // which on-texture rect (top or bottom) is actually MY OWN zone —
        // near/far tint naming is about texture position, not ownership, so
        // this must be derived the same way the dashed divider below does
        const myZoneIsTop = this.ownAtFar;
        // duo/2v2: laneOk only lets a seat place in its OWN half of the
        // zone — paint that half at full strength and the ally's half
        // (still your team's territory, just not yours to click) dimmed,
        // instead of one uniform tint across ground you can't actually use.
        // Only MY OWN zone is ever split like this — the opponent's stays a
        // single uniform tint regardless of my lane.
        const mainLeft = rimPx + flankPx;
        const mainRight = w - rimPx - flankPx;
        const paintMainZone = (y: number, tint: string, mine: boolean) => {
            if (lane === 'full' || !mine) {
                paintZone(mainLeft, y, mainRight - mainLeft, zonePx, tint);
                return;
            }
            const leftW = midX - mainLeft;
            const rightW = mainRight - midX;
            paintZone(mainLeft, y, leftW, zonePx, tint, lane !== 'left');
            paintZone(midX, y, rightW, zonePx, tint, lane !== 'right');
        };
        paintMainZone(rimPx, farTint, myZoneIsTop);
        paintMainZone(h - rimPx - zonePx, nearTint, !myZoneIsTop);
        if (this.flanksUnlocked) {
            // flanks beside the OPPONENT's half belong to you — the crossed
            // rule means flank ownership is the OPPOSITE of that row-band's
            // main-zone ownership: top flanks are mine exactly when my own
            // zone is at the BOTTOM (!myZoneIsTop), and vice versa. Each
            // flank strip sits entirely in one lane (it's at the map edge),
            // so it's either fully mine or fully dimmed, no split needed.
            const dimFlank = (isMine: boolean, laneMatch: boolean) =>
                isMine && lane !== 'full' && !laneMatch;
            const farY = rimPx;
            const nearY = h - rimPx - zonePx;
            paintZone(rimPx, farY, flankPx, zonePx, nearTint, dimFlank(!myZoneIsTop, lane === 'left'));
            paintZone(w - rimPx - flankPx, farY, flankPx, zonePx, nearTint, dimFlank(!myZoneIsTop, lane === 'right'));
            paintZone(rimPx, nearY, flankPx, zonePx, farTint, dimFlank(myZoneIsTop, lane === 'left'));
            paintZone(w - rimPx - flankPx, nearY, flankPx, zonePx, farTint, dimFlank(myZoneIsTop, lane === 'right'));
        } else {
            // locked in round 1: neutral grey on flank strips (inside the rim)
            ctx.fillStyle = t.flankLocked;
            ctx.fillRect(rimPx, rimPx, flankPx, playH);
            ctx.fillRect(w - rimPx - flankPx, rimPx, flankPx, playH);
        }

        // tile grid — playable band only; outer rim stays clear so it reads as terrain
        const rim = this.size.rimCells;
        ctx.strokeStyle = t.grid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let c = rim; c <= this.cols - rim; c++) {
            const x = c * cellPx;
            ctx.moveTo(x, rimPx);
            ctx.lineTo(x, h - rimPx);
        }
        for (let r = rim; r <= this.rows - rim; r++) {
            const y = r * cellPx;
            ctx.moveTo(rimPx, y);
            ctx.lineTo(w - rimPx, y);
        }
        ctx.stroke();

        // center line through the middle strip
        ctx.strokeStyle = t.centerLine;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rimPx, h / 2);
        ctx.lineTo(w - rimPx, h / 2);
        ctx.stroke();

        // duo/2v2: a dashed line marking where MY OWN lane ends within my
        // own zone — laneOk enforces this strictly (a click past it is
        // rejected), so without this there's no visual cue at all for where
        // a seat may actually place
        if (lane !== 'full') {
            const myZoneTop = this.ownAtFar ? rimPx : h - rimPx - zonePx;
            const myZoneBottom = this.ownAtFar ? rimPx + zonePx : h - rimPx;
            ctx.save();
            ctx.strokeStyle = t.laneLine;
            ctx.lineWidth = 3;
            ctx.setLineDash([14, 10]);
            ctx.beginPath();
            ctx.moveTo(midX, myZoneTop);
            ctx.lineTo(midX, myZoneBottom);
            ctx.stroke();
            ctx.restore();
        }

        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;

        // follows the ground relief so grid lines hug the terrain
        const geometry = new PlaneGeometry(this.width, this.height, this.cols * 2, this.rows * 2);
        geometry.rotateX(-Math.PI / 2);
        this.applyRelief(geometry);
        const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
        );
        mesh.position.y = 0.02;
        return mesh;
    }
}
