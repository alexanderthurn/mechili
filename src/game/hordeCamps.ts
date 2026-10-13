import { detCos, detSin } from './detMath';
import { outerHeightAt } from './map';

/**
 * Where a horde wave comes out of the woods: two camps past the board edge,
 * swung toward whoever leads, and the packs scattered around them — clear of
 * the lakes. Deterministic (det trig, the caller's seeded rng), so every
 * client spawns the same wave. Game spawns the packs (spawnHordeWave).
 */

/** the board's half extents — all the camp maths needs of the map */
interface BoardExtent {
    halfW: number;
    halfH: number;
}

/** one wave's camps and the maths behind them (mechiliHorde() reads it back) */
export interface HordeWave {
    leaderSign: number;
    ahead: number;
    spread: number;
    base: number;
    out: number;
    camps: { x: number; z: number }[];
}

/**
 * Camps sit this far past the board edge: already inside the tree line (the
 * belt ramps up from 8), and nearer than the closest lake (~66, see
 * scenery.ts), so a wave walks in out of the woods, arrives soon, and has no
 * water to wade through.
 */
const HORDE_CAMP_NEAR = 40;
const HORDE_CAMP_FAR = 55;
/** a pack may scatter around its camp within this band past the edge */
const HORDE_PACK_NEAR = 18;
const HORDE_PACK_FAR = 58; // (scenery.ts LAKE_CLEAR_OUT keeps every lake past this band — change them together)
/**
 * Where the two camps stand, as an angle either side of the direction the
 * leader's half lies in (seen from the middle of the board). Even standing
 * puts them at a right angle — pure left and right, the same walk for both
 * players; a growing lead swings both toward the leader until they come out
 * of the woods behind their keep. They never close past the minimum, or the
 * two camps would be one pile.
 */
const HORDE_CAMP_SPREAD_EVEN = Math.PI / 2;
const HORDE_CAMP_SPREAD_MIN = (20 * Math.PI) / 180;
/** nudges tried when a camp spot would start in (or walk through) water */
const HORDE_CAMP_RETRIES = 12;

/**
 * A point `out` world units past the board's edge, seen from the middle of the
 * board along `angle` (0 = +z, growing toward +x). "Past the edge" is the same
 * metric the forest belt and the lakes use: how far outside the rectangle the
 * point lies, so a camp is as deep in the woods on a diagonal as head-on.
 */
function hordeSpotOnRay(
    angle: number,
    out: number,
    halfW: number,
    halfH: number,
): { x: number; z: number } {
    const dx = detSin(angle);
    const dz = detCos(angle);
    const lx = Math.abs(dx) > 1e-6 ? (halfW + out) / Math.abs(dx) : Infinity;
    const lz = Math.abs(dz) > 1e-6 ? (halfH + out) / Math.abs(dz) : Infinity;
    const len = Math.min(lx, lz);
    return { x: dx * len, z: dz * len };
}

/** ring starts this far past the board edge (world units) — well into the
 *  treeline (medium quality's forest belt already ramps up by 25 past the
 *  edge), so the wave visibly emerges from the woods instead of appearing
 *  right at the board's doorstep */
export const HORDE_RING_NEAR = 45;
/** ring extends this much further past HORDE_RING_NEAR */
export const HORDE_RING_SPAN = 80;
/** bounded, deterministic retries when a candidate spot's straight walk to
 *  center would cross deep water */
const HORDE_SPAWN_ATTEMPTS = 24;
/** points sampled along that straight walk (besides the spawn point itself) */
const HORDE_PATH_SAMPLES = 8;
/** worldHeightAt below this reads as deep water (per HORDE_MODE_NOTES.md) */
const HORDE_LAKE_HEIGHT = -0.5;

/**
 * The two camps of one wave. One angle either side of the leader's
 * direction (see {@link HORDE_CAMP_SPREAD_EVEN}), turned into a point by
 * walking out from the middle until the spot sits `HORDE_CAMP_NEAR..FAR`
 * past the board edge.
 *
 * A spot whose straight walk hits water is pulled nearer first (lakes
 * start further out than any camp) and only then nudged sideways, so the
 * pair stays as symmetric as the ground allows.
 */
export function hordeCampSpots(
    map: BoardExtent,
    rng: () => number,
    leaderSign: number,
    ahead: number,
): HordeWave {
    const lead = Math.min(1, Math.abs(ahead));
    const spread = HORDE_CAMP_SPREAD_MIN + (HORDE_CAMP_SPREAD_EVEN - HORDE_CAMP_SPREAD_MIN) * (1 - lead);
    // 0 points along +z; the leader's half decides which way that is
    const base = leaderSign >= 0 ? 0 : Math.PI;
    const out = HORDE_CAMP_NEAR + rng() * (HORDE_CAMP_FAR - HORDE_CAMP_NEAR);
    const camps = [base - spread, base + spread].map((angle) => hordeCampAt(map, angle, out));
    return { leaderSign, ahead, spread, base, out, camps };
}

/**
 * One camp: the point `out` past the board edge along `angle`. Water is
 * avoided where it can be; a wave that cannot find dry ground still comes
 * (wet boots beat a round with no horde in it).
 */
function hordeCampAt(map: BoardExtent, angle: number, out: number): { x: number; z: number } {
    let fallback: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < HORDE_CAMP_RETRIES; attempt++) {
        // first pull the camp nearer (never past the lakes), then fan out sideways
        const pull = Math.min(attempt, 3) * 6;
        const swing = attempt < 4 ? 0 : (((attempt - 3) >> 1) * (attempt % 2 === 0 ? 1 : -1) * 7 * Math.PI) / 180;
        const spot = hordeSpotOnRay(angle + swing, Math.max(HORDE_PACK_NEAR, out - pull), map.halfW, map.halfH);
        fallback ??= spot;
        if (!hordePathCrossesWater(spot.x, spot.z)) return spot;
    }
    return fallback ?? hordeSpotOnRay(angle, out, map.halfW, map.halfH);
}

/**
 * Scatter a pack near a camp anchor while staying in the forest ring and
 * clear of lakes. Radius grows with how many packs share the camp.
 */
export function findHordeSpotNear(
    map: BoardExtent,
    rng: () => number,
    camp: { x: number; z: number },
    campPacks: number,
): { x: number; z: number } | null {
    // ~12 wu for a lone pack; ~34 for 10; capped so we stay in the annulus
    const scatter = Math.min(48, 10 + Math.max(1, campPacks) * 2.4);
    for (let attempt = 0; attempt < HORDE_SPAWN_ATTEMPTS; attempt++) {
        const ang = rng() * Math.PI * 2;
        const r = rng() * scatter;
        const x = camp.x + detCos(ang) * r;
        const z = camp.z + detSin(ang) * r;
        // stay in the camp's own band: off the board, short of the lakes
        const d = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
        if (d < HORDE_PACK_NEAR || d > HORDE_PACK_FAR) continue;
        if (hordePathCrossesWater(x, z)) continue;
        return { x, z };
    }
    return null;
}

/** deep water at the spawn point itself, or anywhere along the straight
 *  line to board center (0,0) — sampled at a handful of points along it */
function hordePathCrossesWater(x: number, z: number): boolean {
    // outer height only: the lakes are all out there, and a Big Meteor crater on the board
    // (floor -1) is not water — with the board relief added it read as a lake on the way
    if (outerHeightAt(x, z) < HORDE_LAKE_HEIGHT) return true;
    for (let s = 1; s <= HORDE_PATH_SAMPLES; s++) {
        const t = s / (HORDE_PATH_SAMPLES + 1);
        if (outerHeightAt(x * (1 - t), z * (1 - t)) < HORDE_LAKE_HEIGHT) return true;
    }
    return false;
}
