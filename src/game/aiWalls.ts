/**
 * The AIs' wall sense — one logic for both brains (the classic builder and
 * The Year's planner):
 *
 * - **Read** the other side's walls ({@link readEnemyWalls}): how many, how
 *   much of the front they cover, how many archers stand on them. Walls that
 *   matter call for siege packs ({@link siegeWanted}) — the units built to
 *   break stone (UnitType.buildingDamageMult).
 * - **Build** walls of its own ({@link wallsWanted}, {@link placeWallPlan}):
 *   one fixed fortress plan per side (see {@link wallPlan}), walls joined at
 *   their end tiles, the half facing more enemy packs first. Its tiles stay
 *   free of the AI's own packs ({@link wallPlanCells}), so it can always be
 *   finished. Never the Gate, never more than the seat may still place
 *   (`wallsLeft`).
 *
 * No marks yet: siege packs break walls the way every shot does — by hitting
 * the stone in their way.
 */
import { CELL, cellKey } from './map';
import type { PlacementController } from './placement';
import type { SeatId } from './seats';
import type { Team, Unit, UnitType } from './units';

/** the wall the AIs build — the plain Stone Wall, never the Gate */
export const AI_WALL_ID = 'wall';

/** first tests: build the whole plan as fast as budget and supply allow, enemy melee or not */
const WALL_MADNESS = true;
/** rows from the side's own zone's front edge (the neutral strip never counts) to its front wall */
const FRONT_DEPTH = 4;
/** joined walls in each half of the front wall */
const FRONT_PIECES = 4;
/** open tiles in the middle of the front wall — one wall's length */
const CENTRE_HOLE = 6;
/** turned pieces running back from the hole's edges: the corridor into the base */
const CORRIDOR_PIECES = 1;
/** turned pieces running back from the front wall's outer ends (a wall's length in from the map's flanks) */
const FLANK_PIECES = 4;
/** at most this share of the supply goes into walls */
const WALL_SUPPLY_SHARE = 0.2;
/** enemy melee (by value) from this share on is worth walling against */
const MELEE_SHARE_FOR_WALLS = 0.35;
/** the other side's walls matter once they cover this share of the front (or carry archers) */
const RELEVANT_COVER = 0.2;
/** siege packs wanted per this many walls that matter (at least one, at most MAX_SIEGE_PACKS) */
const WALLS_PER_SIEGE_PACK = 3;
const MAX_SIEGE_PACKS = 3;
/** whether this type breaks stone better than it fights (stones, bolts, shells) */
export function isSiegeType(type: UnitType): boolean {
    return (type.buildingDamageMult ?? 1) > 1;
}

/** a side's front edge row, which way is forward (+1 = higher rows) and its columns without the flanks */
export function sideFrontline(
    placement: PlacementController,
    team: Team,
): { frontRow: number; forward: number; colMin: number; colMax: number } {
    const map = placement.map;
    const near = team === 'player' ? !map.ownAtFar : map.ownAtFar;
    const rim = map.size.rimCells;
    const ownRows = map.size.zoneRows + (map.neutralUnlocked ? map.size.neutralRows / 2 : 0);
    return {
        frontRow: near ? rim + ownRows - 1 : map.rows - rim - ownRows,
        forward: near ? 1 : -1,
        colMin: rim + map.size.flankCols,
        colMax: map.cols - rim - map.size.flankCols - 1,
    };
}

/** the tiles a placed unit covers */
function cellsOf(u: Unit): { col: number; row: number }[] {
    const fp = u.rotated ? { cols: u.type.footprint.rows, rows: u.type.footprint.cols } : u.type.footprint;
    const out: { col: number; row: number }[] = [];
    for (let c = 0; c < fp.cols; c++) for (let r = 0; r < fp.rows; r++) out.push({ col: u.cell.col + c, row: u.cell.row + r });
    return out;
}

function onBoard(u: Unit): boolean {
    return u.team !== 'horde' && !u.destroyed && !u.summoned && !u.gridless;
}

export interface EnemyWalls {
    /** the other side's standing walls */
    count: number;
    /** archers posted on them */
    posted: number;
    /** share of the front's columns they cover, 0…1 */
    cover: number;
    /** worth bringing siege for */
    relevant: boolean;
}

/** what the other side of `team` has built in stone */
export function readEnemyWalls(placement: PlacementController, team: Team): EnemyWalls {
    const units = placement.allUnits();
    const walls = units.filter((u) => onBoard(u) && u.team !== team && !!u.type.wall);
    const wallIds = new Set(walls.map((w) => w.id));
    const posted = units.filter((u) => onBoard(u) && u.hostUnitId !== null && wallIds.has(u.hostUnitId)).length;
    const cols = new Set<number>();
    for (const w of walls) for (const c of cellsOf(w)) cols.add(c.col);
    const { colMin, colMax } = sideFrontline(placement, team);
    const cover = Math.min(1, cols.size / Math.max(1, colMax - colMin + 1));
    return { count: walls.length, posted, cover, relevant: walls.length > 0 && (cover >= RELEVANT_COVER || posted > 0) };
}

/** siege packs `team` should field against these walls (whatever it already has counts) */
export function siegeWanted(walls: EnemyWalls): number {
    if (!walls.relevant) return 0;
    return Math.min(MAX_SIEGE_PACKS, Math.max(1, Math.ceil(walls.count / WALLS_PER_SIEGE_PACK)));
}

/** the other side's army by value: how much of it is ground melee (what walls stop), how many siege packs */
function enemyMix(placement: PlacementController, team: Team): { meleeShare: number; siegePacks: number } {
    let total = 0;
    let melee = 0;
    let siegePacks = 0;
    for (const u of placement.allUnits()) {
        if (!onBoard(u) || u.team === team || u.type.structure || u.type.extra) continue;
        const t = u.type;
        const value = t.cost * Math.max(1, u.level);
        total += value;
        const ranged = !!t.projectileSpeed || !!t.convertRay || !!t.rampBeam;
        const flies = (t.flying ?? 0) > 0 || !!t.freeFlight;
        if (!ranged && !flies && t.damage > 0 && t.speed > 0) melee += value;
        if (isSiegeType(t)) siegePacks++;
    }
    return { meleeShare: total > 0 ? melee / total : 0, siegePacks };
}

/**
 * How many more walls `seat` builds this round: a line when the other side
 * brings melee (more melee, longer line; a Year defender one more), halved
 * against a siege army — less what it already has standing, within what it
 * may still place and a share of its supply.
 */
export function wallsWanted(
    placement: PlacementController,
    team: Team,
    seat: SeatId,
    opts: { wallsLeft: number; supply: number; wallCost: number; defender: boolean },
): number {
    if (opts.wallsLeft <= 0 || opts.wallCost <= 0) return 0;
    if (WALL_MADNESS) return Math.min(opts.wallsLeft, Math.floor(opts.supply / opts.wallCost));
    const mix = enemyMix(placement, team);
    let line = mix.meleeShare >= MELEE_SHARE_FOR_WALLS ? 2 + Math.round(mix.meleeShare * 4) : 0;
    if (opts.defender) line += 1;
    if (mix.siegePacks >= 2) line = Math.floor(line / 2);
    const standing = placement.allUnits().filter((u) => onBoard(u) && u.seat === seat && u.type.id === AI_WALL_ID).length;
    const affordable = Math.floor((opts.supply * WALL_SUPPLY_SHARE) / opts.wallCost);
    return Math.max(0, Math.min(line - standing, opts.wallsLeft, affordable));
}

/** one fixed wall slot: its anchor (top-left tile), lengthwise or turned, and which way its back is */
export interface WallSlot {
    anchor: { col: number; row: number };
    rotated: boolean;
    flipped: boolean;
}

interface PlanSlot extends WallSlot {
    /** 0 front, 1 corridor, 2 flank — the build order */
    phase: number;
    /** the half of the front it stands in (-1 left, +1 right) */
    half: number;
    /** column of its middle */
    col: number;
    /** its place within its run (front: from the corner; corridor and flank: from the front) */
    step: number;
}

/**
 * The side's fortress (near side shown, enemy above; the far side is the
 * same turned 180°):
 *
 * ```
 *  ------------------------------------------------------------   own zone's front edge
 *  ······●━━━━●━━━━●━━━━●━━━━●······●━━━━●━━━━●━━━━●━━━━●······   front, FRONT_DEPTH rows back
 *  ······┃···················║······║···················┃······
 *  ······●···················●······●···················●······   corridor (CORRIDOR_PIECES)
 *  ······┃·······RRR···························CCC······┃······   towers (R, C) inside
 *  ······●··············································●······   flanks (FLANK_PIECES)
 *  ······┃·····················SSSSS····················┃······   stronghold (S)
 *  ······●··············································●······
 *                         (open at the back)
 * ```
 *
 * FRONT_PIECES joined walls each side of a CENTRE_HOLE-tile hole, centred in
 * the side's columns; turned pieces down from the hole's edges and from the
 * front's outer ends. Joined walls share their end tile (●). Turned pieces
 * face out: the flanks outward, the corridor into the hole. Laid out from the
 * side's own zone, so an unlocked neutral strip doesn't move it. In duo lanes
 * each seat gets the slots inside its own lane (the rest fail placement and
 * are skipped).
 */
function wallPlan(placement: PlacementController, team: Team, len: number): PlanSlot[] {
    const { forward, colMin, colMax } = sideFrontline(placement, team);
    const map = placement.map;
    const rim = map.size.rimCells;
    const zoneFront = forward > 0 ? rim + map.size.zoneRows - 1 : map.rows - rim - map.size.zoneRows;
    const step = len - 1; // joined walls advance one tile less than their length
    const half = FRONT_PIECES * step + 1; // tiles one half of the front covers
    const inset = Math.floor((colMax - colMin + 1 - 2 * half - CENTRE_HOLE) / 2);
    if (inset < 0) return [];
    const outerLeft = colMin + inset;
    const innerLeft = outerLeft + FRONT_PIECES * step;
    const innerRight = innerLeft + CENTRE_HOLE + 1;
    const outerRight = innerRight + FRONT_PIECES * step;
    const frontRowAt = zoneFront - forward * FRONT_DEPTH;
    // a turned piece covering depths t…t+step behind the zone's front edge: its top-left row
    const turnedRow = (t: number) => (forward > 0 ? zoneFront - t - step : zoneFront + t);
    // a turned piece's face looks along `outward` (-1 lower columns, +1 higher); the far side is turned 180°
    const flippedFor = (outward: number) => outward > 0 !== forward < 0;

    const slots: PlanSlot[] = [];
    for (let i = 0; i < FRONT_PIECES; i++) {
        const left = outerLeft + i * step;
        const right = innerRight + i * step;
        slots.push({ anchor: { col: left, row: frontRowAt }, rotated: false, flipped: false, phase: 0, half: -1, col: left + step / 2, step: i });
        slots.push({ anchor: { col: right, row: frontRowAt }, rotated: false, flipped: false, phase: 0, half: 1, col: right + step / 2, step: i });
    }
    for (let k = 0; k < CORRIDOR_PIECES; k++) {
        const row = turnedRow(FRONT_DEPTH + k * step);
        slots.push({ anchor: { col: innerLeft, row }, rotated: true, flipped: flippedFor(1), phase: 1, half: -1, col: innerLeft, step: k });
        slots.push({ anchor: { col: innerRight, row }, rotated: true, flipped: flippedFor(-1), phase: 1, half: 1, col: innerRight, step: k });
    }
    for (let k = 0; k < FLANK_PIECES; k++) {
        const row = turnedRow(FRONT_DEPTH + k * step);
        slots.push({ anchor: { col: outerLeft, row }, rotated: true, flipped: flippedFor(-1), phase: 2, half: -1, col: outerLeft, step: k });
        slots.push({ anchor: { col: outerRight, row }, rotated: true, flipped: flippedFor(1), phase: 2, half: 1, col: outerRight, step: k });
    }
    return slots;
}

/** every tile of the side's wall plan — what the AI keeps its packs off */
export function wallPlanCells(placement: PlacementController, team: Team, wall: UnitType): Set<string> {
    const out = new Set<string>();
    const fp = wall.footprint;
    for (const s of wallPlan(placement, team, fp.cols)) {
        const cols = s.rotated ? fp.rows : fp.cols;
        const rows = s.rotated ? fp.cols : fp.rows;
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.add(cellKey({ col: s.anchor.col + c, row: s.anchor.row + r }));
    }
    return out;
}

/**
 * Builds up to `count` walls of the side's plan ({@link wallPlan}): the front
 * first (the pieces before the seat's towers first, then out to the corners),
 * then the corridor, then the flanks from the front back — at each step the
 * half facing more enemy packs (any packs) first. A slot that holds the
 * seat's wall already is done; one something blocks is skipped and tried
 * again next round. Returns how many it placed.
 */
export function placeWallPlan(
    placement: PlacementController,
    team: Team,
    seat: SeatId,
    wall: UnitType,
    count: number,
    buy: (slot: WallSlot) => boolean,
): number {
    if (count <= 0) return 0;
    const slots = wallPlan(placement, team, wall.footprint.cols);
    const map = placement.map;
    const { colMin, colMax } = sideFrontline(placement, team);
    const mid = (colMin + colMax + 1) / 2;
    let left = 0;
    let right = 0;
    for (const u of placement.allUnits()) {
        if (!onBoard(u) || u.team === team || u.type.structure || u.type.extra) continue;
        if ((u.world.x + map.halfW) / CELL < mid) left++;
        else right++;
    }
    const first = right > left ? 1 : -1;
    const towers = placement
        .allUnits()
        .filter((u) => u.seat === seat && !u.destroyed && (u.type.baseAnchor === 'research' || u.type.baseAnchor === 'command'))
        .map((t) => t.cell.col + t.type.footprint.cols / 2);
    const fromTower = (col: number) => (towers.length > 0 ? Math.min(...towers.map((t) => Math.abs(t - col))) : 0);
    const order = slots.sort(
        (a, b) =>
            a.phase - b.phase ||
            (a.phase === 0 ? fromTower(a.col) - fromTower(b.col) : a.step - b.step) ||
            (a.half === first ? 0 : 1) - (b.half === first ? 0 : 1),
    );

    const built = placement.allUnits().filter((u) => onBoard(u) && u.seat === seat && u.type.id === wall.id);
    let placed = 0;
    for (const slot of order) {
        if (placed >= count) break;
        const standing = built.some(
            (w) => w.cell.col === slot.anchor.col && w.cell.row === slot.anchor.row && w.rotated === slot.rotated,
        );
        if (standing || !placement.canPlaceAt(team, seat, wall, slot.anchor, slot.rotated)) continue;
        if (buy({ anchor: slot.anchor, rotated: slot.rotated, flipped: slot.flipped })) placed++;
    }
    return placed;
}

/**
 * The seat's standing walls in the order it tends them (levels, archers):
 * the front before the turned pieces, nearest the centre hole first — where
 * the enemy comes through.
 */
export function wallsToTend(placement: PlacementController, team: Team, seat: SeatId): Unit[] {
    const { colMin, colMax } = sideFrontline(placement, team);
    const mid = (colMin + colMax + 1) / 2;
    const fromHole = (u: Unit) => Math.abs(u.cell.col + (u.rotated ? 0.5 : u.type.footprint.cols / 2) - mid);
    return placement
        .allUnits()
        .filter((u) => onBoard(u) && u.seat === seat && u.type.id === AI_WALL_ID)
        .sort((a, b) => Number(a.rotated) - Number(b.rotated) || fromHole(a) - fromHole(b) || a.id - b.id);
}
