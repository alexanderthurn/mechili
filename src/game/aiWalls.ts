/**
 * The AIs' wall sense — one logic for both brains (the classic builder and
 * The Year's planner):
 *
 * - **Read** the other side's walls ({@link readEnemyWalls}): how many, how
 *   much of the front they cover, how many archers stand on them. Walls that
 *   matter call for siege (aiRoles: Hard's ballistas).
 * - **Build** walls of its own ({@link orderedWallPlan}, {@link placeWallPlan}):
 *   one fixed fortress plan per side (see {@link wallPlan}), walls joined at
 *   their end tiles. Which slots, and how many, the personality decides
 *   (AiOpponent.defend). The slots it intends stay free of its own packs
 *   ({@link wallPlanCells}). Never the Gate, never more than the seat may
 *   still place (`wallsLeft`).
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

/** rows from the side's own zone's front edge (the neutral strip never counts) to its front wall */
const FRONT_DEPTH = 4;
/** joined walls in each half of the front wall */
const FRONT_PIECES = 4;
/** turned pieces running back from the hole's edges: the corridor into the base */
const CORRIDOR_PIECES = 1;
/** turned pieces running back from the front wall's outer ends (a wall's length in from the map's flanks) */
const FLANK_PIECES = 4;
/** the other side's walls matter once they cover this share of the front (or carry archers) */
const RELEVANT_COVER = 0.2;

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

/** one fixed wall slot: its anchor (top-left tile), lengthwise or turned, and which way its back is */
export interface WallSlot {
    anchor: { col: number; row: number };
    rotated: boolean;
    flipped: boolean;
}

export interface PlanSlot extends WallSlot {
    /** 0 front, 1 corridor, 2 flank — the build order */
    phase: number;
    /** the half of the front it stands in (-1 left, +1 right; 0 the corridor's back piece) */
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
 *  ······●━━━━●━━━━●━━━━●━━━━●····●━━━━●━━━━●━━━━●━━━━●······   front, FRONT_DEPTH rows back
 *  ······┃···················║····║···················┃······
 *  ······●···················●════●···················●······   corridor (CORRIDOR_PIECES), closed at its back
 *  ······┃·······RRR···························CCC······┃······   towers (R, C) inside
 *  ······●··············································●······   flanks (FLANK_PIECES)
 *  ······┃·····················SSSSS····················┃······   stronghold (S)
 *  ······●··············································●······
 *                         (open at the back)
 * ```
 *
 * FRONT_PIECES joined walls each side of a hole two tiles shorter than a wall, centred in
 * the side's columns; turned pieces down from the hole's edges and from the
 * front's outer ends; one straight piece across the corridor's back, joined to
 * both corridor walls (the hole is a wall less its two end tiles). Joined walls
 * share their end tile (●). Turned pieces face out: the flanks outward, the
 * corridor into the hole. Laid out from the
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
    // open tiles in the middle of the front: a wall less its end tiles, so the piece across
    // the corridor's back shares an end tile with each corridor wall
    const hole = len - 2;
    const inset = Math.floor((colMax - colMin + 1 - 2 * half - hole) / 2);
    if (inset < 0) return [];
    const outerLeft = colMin + inset;
    const innerLeft = outerLeft + FRONT_PIECES * step;
    const innerRight = innerLeft + hole + 1;
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
    if (CORRIDOR_PIECES > 0) {
        // across the corridor's back, joined to both its walls (half 0: the middle)
        const row = zoneFront - forward * (FRONT_DEPTH + CORRIDOR_PIECES * step);
        const col = innerLeft;
        slots.push({ anchor: { col, row }, rotated: false, flipped: false, phase: 1, half: 0, col: col + step / 2, step: CORRIDOR_PIECES });
    }
    for (let k = 0; k < FLANK_PIECES; k++) {
        const row = turnedRow(FRONT_DEPTH + k * step);
        slots.push({ anchor: { col: outerLeft, row }, rotated: true, flipped: flippedFor(-1), phase: 2, half: -1, col: outerLeft, step: k });
        slots.push({ anchor: { col: outerRight, row }, rotated: true, flipped: flippedFor(1), phase: 2, half: 1, col: outerRight, step: k });
    }
    return slots;
}

/** the tiles a slot's wall covers */
function slotCells(slot: WallSlot, wall: UnitType): string[] {
    const fp = wall.footprint;
    const cols = slot.rotated ? fp.rows : fp.cols;
    const rows = slot.rotated ? fp.cols : fp.rows;
    const out: string[] = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push(cellKey({ col: slot.anchor.col + c, row: slot.anchor.row + r }));
    return out;
}

/** every tile of these slots — what the AI keeps its packs off */
export function wallPlanCells(slots: readonly WallSlot[], wall: UnitType): Set<string> {
    return new Set(slots.flatMap((s) => slotCells(s, wall)));
}

/**
 * The side's wall plan ({@link wallPlan}) in build order: the front first
 * (the pieces before the seat's towers first, then out to the corners), then
 * the corridor, then the flanks from the front back — at each step the half
 * facing more enemy packs (any packs) first.
 */
export function orderedWallPlan(placement: PlacementController, team: Team, seat: SeatId, wall: UnitType): PlanSlot[] {
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
    return slots.sort(
        (a, b) =>
            a.phase - b.phase ||
            (a.phase === 0 ? fromTower(a.col) - fromTower(b.col) : a.step - b.step) ||
            (a.half === first ? 0 : 1) - (b.half === first ? 0 : 1),
    );
}

/** the seat's wall standing in this slot, if it stands — a gate made of it too */
export function wallInSlot(placement: PlacementController, seat: SeatId, wall: UnitType, slot: WallSlot): Unit | null {
    return (
        placement
            .allUnits()
            .find(
                (w) =>
                    onBoard(w) &&
                    w.seat === seat &&
                    (w.type.id === wall.id || w.type.id === wall.wall?.makeGate?.typeId) &&
                    w.cell.col === slot.anchor.col &&
                    w.cell.row === slot.anchor.row &&
                    w.rotated === slot.rotated,
            ) ?? null
    );
}

/**
 * Builds up to `count` of these slots that don't stand yet, in their order.
 * One something blocks is skipped and tried again next round. Returns how
 * many it placed.
 */
export function placeWallPlan(
    placement: PlacementController,
    team: Team,
    seat: SeatId,
    wall: UnitType,
    slots: readonly WallSlot[],
    count: number,
    buy: (slot: WallSlot) => boolean,
): number {
    let placed = 0;
    for (const slot of slots) {
        if (placed >= count) break;
        if (wallInSlot(placement, seat, wall, slot) || !placement.canPlaceAt(team, seat, wall, slot.anchor, slot.rotated)) continue;
        if (buy({ anchor: slot.anchor, rotated: slot.rotated, flipped: slot.flipped })) placed++;
    }
    return placed;
}
