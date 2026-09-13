import { BASE_TYPES } from './units';
import type { TypeRegistry } from './content/typeRegistry';
import { TUTORIAL_2_START_CARD_ID, TUTORIAL_3_START_CARD_ID, TUTORIAL_START_CARD_ID } from './cards';
import type { GameSettings, TutorialSettings } from './settings';
import type { BattleMap, Cell } from './map';
import { CELL } from './map';
import { OIL_SPILL_ID, DRAGON_ID, SPAWN_DWARVES_ID, TACTIC_MAX_SPAN, TACTIC_SAFE_ZONE_MARGIN, clampTacticPoint } from './tactics';

/** Tutorial 1: empty board, auto commander, soft UI lesson, 4 enemy archers. */
export const TUTORIAL_1_ID = 1;
/** Tutorial 2: Stronghold-only lesson across three rounds (archers, spells, lifeline). */
export const TUTORIAL_2_ID = 2;

export const TUTORIAL_2_ROUNDS = 3;
/** Tutorial 3: Tower lesson across four rounds (debuff, Vanguard boosts, runes, Longbow). */
export const TUTORIAL_3_ID = 3;

export const TUTORIAL_3_ROUNDS = 4;

/** Lesson order, as the Tutorial menu lists them. */
export const TUTORIAL_LESSON_IDS = [TUTORIAL_1_ID, TUTORIAL_2_ID, TUTORIAL_3_ID] as const;

/** The lesson that follows this one, or null when it was the last. */
export function nextTutorialId(id: number | null): number | null {
    if (id === null) return null;
    const i = (TUTORIAL_LESSON_IDS as readonly number[]).indexOf(id);
    return i >= 0 && i < TUTORIAL_LESSON_IDS.length - 1 ? TUTORIAL_LESSON_IDS[i + 1]! : null;
}

/** Round 3 gate: base runes the player must buy before End Deployment opens. */
export const TUTORIAL_3_MIN_RUNES = 5;

/** Round 2 gate: Vanguard boost tiers to buy (mirrors `settings.boosts.costs.length`). */
export const TUTORIAL_3_BOOST_MAX_TIERS = 2;

/** Round 4: Longbow talent id on archers (`techCatalog` barrel). */
export const TUTORIAL_3_ARCHER_RANGE_TECH = 'barrel';

/** Round 4: archers lined up in each half's center. */
export const TUTORIAL_3_R4_ARCHERS = 5;

/** Round-2/3 forge spells: oil + dragon in R2, summon unlocked in R3. */
export const TUTORIAL_2_SPELL_IDS = [OIL_SPILL_ID, DRAGON_ID, SPAWN_DWARVES_ID] as const;

/** Tutorial 2 fills every battlement pad. */
export const TUTORIAL_2_ARCHER_COUNT = 5;

export function isTutorial(settings: GameSettings): boolean {
    return settings.tutorial != null;
}

export function tutorialId(settings: GameSettings): number | null {
    return settings.tutorial?.id ?? null;
}

/** A forced dwarf pad: exact anchor + rotation the player must match. */
export interface TutorialPlaceSlot {
    anchor: Cell;
    /** false = 5×2 footprint; true = 2×5 */
    rotated: boolean;
}

/** World-space glowing target (spell circle or pack pad). */
export interface TutorialWorldZone {
    x: number;
    z: number;
    /** footprint width in world units (circle diameter ≈ radius×2). */
    radius: number;
    filled?: boolean;
}

/** Two-point spell corridor (oil / dragon). */
export interface TutorialCorridorZone {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    radius: number;
    filled?: boolean;
}

/** Apply match knobs shared by every tutorial lesson entry. */
export function applyTutorialMode(settings: GameSettings, id: number): void {
    const lesson: TutorialSettings = { id, sideHp: 1 };
    settings.tutorial = lesson;
    settings.roundCardPreset = 'off';
    if (id === TUTORIAL_1_ID) {
        settings.strongholdMode = 'none';
        settings.deploy = { ...settings.deploy, unitsPerRound: 2 };
        settings.economy = {
            ...settings.economy,
            startingSupply: 200,
        };
    } else if (id === TUTORIAL_2_ID) {
        settings.strongholdMode = 'lifeline';
        lesson.roundsToWin = TUTORIAL_2_ROUNDS;
        settings.deploy = { ...settings.deploy, unitsPerRound: 0 };
        settings.economy = {
            ...settings.economy,
            startingSupply: 2500,
        };
    } else if (id === TUTORIAL_3_ID) {
        settings.strongholdMode = 'none';
        lesson.roundsToWin = TUTORIAL_3_ROUNDS;
        // Round 1 buys one dwarf + one ballista; later rounds re-cap per round.
        settings.deploy = { ...settings.deploy, unitsPerRound: 2 };
        settings.economy = {
            ...settings.economy,
            startingSupply: 3000,
        };
    } else {
        settings.strongholdMode = 'none';
        settings.deploy = { ...settings.deploy, unitsPerRound: 4 };
        settings.economy = {
            ...settings.economy,
            startingSupply: 500,
        };
    }
}

/**
 * Grid cell for a base building at (`xFrac`, `rowFrac`) of a side's own zone,
 * mirrored into the far half when that side plays from there — the same
 * near/far math a normal match's `spawnTowers` uses.
 */
export function tutorialBaseCell(
    map: BattleMap,
    xFrac: number,
    rowFrac: number,
    fp: { cols: number; rows: number },
    side: 'player' | 'enemy',
): Cell {
    const { rimCells, flankCols, zoneCols, zoneRows } = map.size;
    const centerRow = Math.round(rimCells + zoneRows * rowFrac - fp.rows / 2);
    const col = rimCells + flankCols + Math.round(zoneCols * xFrac) - Math.floor(fp.cols / 2);
    const useFar = (side === 'enemy') !== map.ownAtFar;
    return useFar
        ? { col: map.cols - col - fp.cols, row: map.rows - centerRow - fp.rows }
        : { col, row: centerRow };
}

/**
 * The units the three lessons are scripted around. Their steps, pads and
 * line-ups assume exactly these ids and footprints, so they are named here
 * once and checked when a lesson starts ({@link tutorialContentProblems}) —
 * renaming a unit or changing its footprint must fail loudly, not leave a
 * lesson waiting for a unit that never comes. Tutorials run on base content.
 */
export const TUTORIAL_DWARF_ID = 'dwarf';
export const TUTORIAL_ARCHER_ID = 'archer';
export const TUTORIAL_BALLISTA_ID = 'ballista';

const TUTORIAL_FOOTPRINTS: Readonly<Record<string, { cols: number; rows: number }>> = {
    [TUTORIAL_DWARF_ID]: { cols: 5, rows: 2 },
    [TUTORIAL_ARCHER_ID]: { cols: 2, rows: 2 },
    [TUTORIAL_BALLISTA_ID]: { cols: 4, rows: 4 },
};

/** What would break a lesson in `types`: a missing unit or an unexpected footprint. Empty = fine. */
export function tutorialContentProblems(types: TypeRegistry): string[] {
    const problems: string[] = [];
    for (const [id, fp] of Object.entries(TUTORIAL_FOOTPRINTS)) {
        const type = types.byId(id);
        if (!type) {
            problems.push(`tutorials need unit "${id}"`);
        } else if (type.footprint.cols !== fp.cols || type.footprint.rows !== fp.rows) {
            problems.push(
                `tutorial pads expect "${id}" to be ${fp.cols}×${fp.rows}, it is ${type.footprint.cols}×${type.footprint.rows}`,
            );
        }
    }
    for (const id of ['stronghold', 'command-tower', 'research-center']) {
        if (!types.byId(id)) problems.push(`tutorials need building "${id}"`);
    }
    if (!types.byId(TUTORIAL_ARCHER_ID)?.talents?.includes(TUTORIAL_3_ARCHER_RANGE_TECH)) {
        problems.push(`tutorial 3 needs talent "${TUTORIAL_3_ARCHER_RANGE_TECH}" on "${TUTORIAL_ARCHER_ID}"`);
    }
    for (const id of [TUTORIAL_START_CARD_ID, TUTORIAL_2_START_CARD_ID, TUTORIAL_3_START_CARD_ID]) {
        if (!types.commander(id)) problems.push(`tutorials need hidden commander "${id}"`);
    }
    // tutorial 2 walks through these three spells step by step
    const dragon = types.tactic(DRAGON_ID);
    if (dragon?.targeting !== 'two-point' || dragon.spell?.fx !== 'dragon') {
        problems.push(`tutorial 2 needs "${DRAGON_ID}" as a two-point dragon spell`);
    }
    if (types.tactic(SPAWN_DWARVES_ID)?.spell?.spawn?.typeId !== TUTORIAL_DWARF_ID) {
        problems.push(`tutorial 2 needs "${SPAWN_DWARVES_ID}" to summon "${TUTORIAL_DWARF_ID}"`);
    }
    if (!types.tactic(OIL_SPILL_ID)) problems.push(`tutorial 2 needs "${OIL_SPILL_ID}"`);
    return problems;
}

/** Dwarf footprint for a tutorial pad (matches Unit footprint + rotation). */
export function tutorialDwarfFootprint(rotated: boolean): { cols: number; rows: number } {
    const fp = TUTORIAL_FOOTPRINTS[TUTORIAL_DWARF_ID]!;
    return rotated ? { cols: fp.rows, rows: fp.cols } : { ...fp };
}

/** Siege ballista footprint (rotation-symmetric). */
export function tutorialBallistaFootprint(): { cols: number; rows: number } {
    return { ...TUTORIAL_FOOTPRINTS[TUTORIAL_BALLISTA_ID]! };
}

/** Row of a side's forward rank for a footprint that deep (own zone, facing mid-field). */
function tutorialFrontRow(map: BattleMap, fpRows: number, near: boolean): number {
    const { rimCells, zoneRows } = map.size;
    return near ? rimCells + zoneRows - fpRows - 2 : map.rows - rimCells - zoneRows + 2;
}

/**
 * Tutorial 3 round 1: dwarf pad on the player's LEFT front — the lane the
 * enemy packs march down (see {@link TutorialAi}'s left-border placement).
 */
export function tutorial3DwarfSlot(map: BattleMap): TutorialPlaceSlot {
    const { rimCells, flankCols, zoneCols } = map.size;
    const fp = tutorialDwarfFootprint(false);
    return {
        anchor: {
            col: rimCells + flankCols + Math.round(zoneCols * 0.18),
            row: tutorialFrontRow(map, fp.rows, !map.ownAtFar),
        },
        rotated: false,
    };
}

/**
 * Tutorial 3 round 1: ballista pad on the player's RIGHT front — the flank the
 * enemy left unguarded, so the siege bolt reaches that tower unopposed.
 */
export function tutorial3BallistaSlot(map: BattleMap): TutorialPlaceSlot {
    const { rimCells, flankCols, zoneCols } = map.size;
    const fp = tutorialBallistaFootprint();
    return {
        anchor: {
            col: rimCells + flankCols + Math.round(zoneCols * 0.8) - fp.cols,
            row: tutorialFrontRow(map, fp.rows, !map.ownAtFar),
        },
        rotated: false,
    };
}

/**
 * Tutorial 3 round 2: the player's center-front dwarf cell. Mirrors the
 * enemy AI's own center-front anchor, so the two packs stare each other down.
 */
export function tutorial3CenterDwarfCell(map: BattleMap): Cell {
    const fp = tutorialDwarfFootprint(false);
    return {
        col: Math.floor((map.cols - fp.cols) / 2),
        row: tutorialFrontRow(map, fp.rows, !map.ownAtFar),
    };
}

/** One pack in Tutorial 3's mirrored border line-up (round 3). */
export interface Tutorial3ArmyPack {
    typeId: typeof TUTORIAL_DWARF_ID | typeof TUTORIAL_ARCHER_ID;
    cell: Cell;
}

/**
 * Forward row pressed against the shared border (as close as packs can stand
 * without spilling into the neutral strip).
 */
function tutorial3BorderRow(map: BattleMap, fpRows: number, near: boolean): number {
    const { rimCells, zoneRows } = map.size;
    return near ? rimCells + zoneRows - fpRows : map.rows - rimCells - zoneRows;
}

/**
 * Tutorial 3 round 3: 2 dwarves + 3 archers, L→R, mirrored across the border
 * so both armies stare at each other at point-blank range.
 */
export function tutorial3MirroredArmy(
    map: BattleMap,
    team: 'player' | 'enemy',
): Tutorial3ArmyPack[] {
    const composition: readonly Tutorial3ArmyPack['typeId'][] = [
        TUTORIAL_DWARF_ID,
        TUTORIAL_ARCHER_ID,
        TUTORIAL_DWARF_ID,
        TUTORIAL_ARCHER_ID,
        TUTORIAL_ARCHER_ID,
    ];
    const near = team === 'player' ? !map.ownAtFar : map.ownAtFar;
    // leave one empty cell between packs
    const widths = composition.map((id) => TUTORIAL_FOOTPRINTS[id]!.cols);
    const gaps = composition.length - 1;
    const totalW = widths.reduce((a, b) => a + b, 0) + gaps;
    let col = Math.floor((map.cols - totalW) / 2);
    const packs: Tutorial3ArmyPack[] = [];
    for (let i = 0; i < composition.length; i++) {
        const typeId = composition[i]!;
        const cols = widths[i]!;
        const rows = TUTORIAL_FOOTPRINTS[typeId]!.rows;
        packs.push({
            typeId,
            cell: { col, row: tutorial3BorderRow(map, rows, near) },
        });
        col += cols + 1;
    }
    return packs;
}

/**
 * Tutorial 3 round 4: five archers across the middle of a side's zone so both
 * lines must march before they can shoot (Longbow decides who fires first).
 */
export function tutorial3CenterArcherCells(
    map: BattleMap,
    team: 'player' | 'enemy',
    count = TUTORIAL_3_R4_ARCHERS,
): Cell[] {
    const fpCols = 2;
    const fpRows = 2;
    const near = team === 'player' ? !map.ownAtFar : map.ownAtFar;
    const { rimCells, zoneRows } = map.size;
    // Mid-depth of the playable zone — not the border.
    const row = near
        ? rimCells + Math.floor(zoneRows / 2) - Math.floor(fpRows / 2)
        : map.rows - rimCells - Math.floor(zoneRows / 2) - Math.ceil(fpRows / 2);
    const step = fpCols + 1;
    const totalW = count * fpCols + (count - 1);
    let col = Math.floor((map.cols - totalW) / 2);
    const cells: Cell[] = [];
    for (let i = 0; i < count; i++) {
        cells.push({ col, row });
        col += step;
    }
    return cells;
}

/**
 * Two pads in the player's forward zone: left unrotated, right rotated.
 * Computed from the live map so ownAtFar / flanks stay correct.
 */
export function tutorial1PlaceSlots(map: BattleMap): TutorialPlaceSlot[] {
    const { rimCells, flankCols, zoneCols, zoneRows } = map.size;
    const zoneLeft = rimCells + flankCols;
    const midCol = zoneLeft + Math.floor(zoneCols / 2);
    const playerNear = !map.ownAtFar;

    const frontRow = playerNear
        ? rimCells + zoneRows - 5
        : map.rows - rimCells - zoneRows + 3;

    const slot0: TutorialPlaceSlot = {
        anchor: { col: midCol - 9, row: frontRow },
        rotated: false,
    };
    const slot1: TutorialPlaceSlot = {
        anchor: {
            col: midCol + 3,
            row: playerNear ? frontRow - 2 : frontRow,
        },
        rotated: true,
    };
    return [slot0, slot1];
}

function tutorial2MidField(map: BattleMap): { midCol: number; midRow: number } {
    const { rimCells, zoneCols, zoneRows, flankCols, neutralRows } = map.size;
    return {
        midCol: rimCells + flankCols + Math.floor(zoneCols / 2),
        midRow: rimCells + zoneRows + Math.floor(neutralRows / 2),
    };
}

/**
 * Oil: left → center across mid-field (horizontal, full oil max span).
 * Crosses the approach lane without aiming at the keep or enemy spawn.
 */
export function tutorial2OilCorridor(map: BattleMap): TutorialCorridorZone {
    const { midCol, midRow } = tutorial2MidField(map);
    const spanCells = Math.floor(TACTIC_MAX_SPAN / CELL);
    const start = map.cellCenter(midCol - spanCells, midRow);
    const end = map.cellCenter(midCol, midRow);
    return {
        startX: start.x,
        startZ: start.z,
        endX: end.x,
        endZ: end.z,
        radius: 3 * CELL,
    };
}

/**
 * Dragon: right → left across mid-field at the spell’s max path length.
 * Overlaps the oil on the left/center so the breath can ignite it.
 */
export function tutorial2DragonCorridor(map: BattleMap): TutorialCorridorZone {
    const { midCol, midRow } = tutorial2MidField(map);
    const maxSpan = BASE_TYPES.tactic(DRAGON_ID)?.maxSpan ?? 24 * CELL;
    const halfCells = Math.floor(maxSpan / (2 * CELL));
    const start = map.cellCenter(midCol + halfCells, midRow);
    const end = map.cellCenter(midCol - halfCells, midRow);
    return {
        startX: start.x,
        startZ: start.z,
        endX: end.x,
        endZ: end.z,
        radius: 3 * CELL,
    };
}

/**
 * Summon Dwarves on the right-back of the enemy keep (player’s right = +X),
 * just outside the safe zone and clamped on-board. Never falls back toward midfield.
 */
export function tutorial2SummonNearKeep(
    map: BattleMap,
    keepX: number,
    keepZ: number,
    midX: number,
    midZ: number,
): TutorialWorldZone {
    const spellRadius = 4 * CELL;
    const buildingRadius = 2.5 * CELL; // stronghold 5×5
    const safeR = buildingRadius + TACTIC_SAFE_ZONE_MARGIN + spellRadius;
    // Away from midfield along Z = deeper into the enemy’s half (“back”).
    const awayZ = Math.sign(keepZ - midZ) || (keepZ >= 0 ? 1 : -1);

    const tryPoint = (x: number, z: number): { x: number; z: number } | null => {
        const c = clampTacticPoint(x, z, map.halfW, map.halfH, spellRadius);
        const d = Math.hypot(c.x - keepX, c.z - keepZ);
        // Must clear the safe disk and stay clearly on the keep’s right.
        if (d < safeR + 0.25 * CELL) return null;
        if (c.x < keepX + safeR * 0.55) return null;
        return c;
    };

    // Prefer right + back; shorten “back” if the rim would reject it.
    for (const back of [3 * CELL, 2 * CELL, CELL, 0]) {
        const hit = tryPoint(keepX + safeR + CELL, keepZ + awayZ * back);
        if (hit) return { x: hit.x, z: hit.z, radius: spellRadius };
    }
    // Last resort: pure right of the keep at the same depth.
    const fallback = clampTacticPoint(
        keepX + safeR + CELL,
        keepZ,
        map.halfW,
        map.halfH,
        spellRadius,
    );
    return { x: fallback.x, z: fallback.z, radius: spellRadius };
}

/** Stronghold rowFrac for Tutorial 2 — pushed forward toward mid-field. */
export const TUTORIAL_2_STRONGHOLD_ROW_FRAC = 0.48;

export function cellEq(a: Cell, b: Cell): boolean {
    return a.col === b.col && a.row === b.row;
}

/** Whether a pack sits exactly on a tutorial pad (cell + rotation). */
export function unitMatchesTutorialSlot(
    unit: { cell: Cell; rotated: boolean },
    slot: TutorialPlaceSlot,
): boolean {
    return cellEq(unit.cell, slot.anchor) && unit.rotated === slot.rotated;
}

const ZONE_TOL = 10;

export function pointNear(x: number, z: number, tx: number, tz: number, tol = ZONE_TOL): boolean {
    const dx = x - tx;
    const dz = z - tz;
    return dx * dx + dz * dz <= tol * tol;
}

/** Click acceptance radius for a glowing tutorial circle. */
export function zoneClickTol(radius: number): number {
    return Math.max(radius * 0.95, ZONE_TOL);
}

/** Whether a two-point stamp sits on the tutorial corridor (oriented start→end). */
export function stampMatchesCorridor(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    zone: TutorialCorridorZone,
): boolean {
    const tol = zoneClickTol(zone.radius);
    return (
        pointNear(startX, startZ, zone.startX, zone.startZ, tol) &&
        pointNear(endX, endZ, zone.endX, zone.endZ, tol)
    );
}

export function stampMatchesPoint(x: number, z: number, zone: TutorialWorldZone): boolean {
    return pointNear(x, z, zone.x, zone.z, zoneClickTol(zone.radius));
}
