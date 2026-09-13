/**
 * The scenario editor's draft (plan §8.4): a new board, map presets, the edits
 * the tools make, undo/redo and the autosave. Pure data over
 * {@link ScenarioDef} — the editor UI calls these, the Game rebuilds its board
 * from the result.
 */
import type { TypeRegistry } from '../content/typeRegistry';
import type { LevelRef } from '../level';
import { STANDARD_MAP, type MapSize } from '../map';
import { DEFAULT_SETTINGS } from '../settings';
import { boardCells, HORDE_MARGIN_CELLS } from './normalize';
import { SCENARIO_VERSION, type ScenarioDef, type SceneTeam, type SceneUnit } from './scenarioDef';

export type MapPresetId = 'tiny' | 'compact' | 'standard' | 'wide' | 'deep';

/** plan §7.1 — small boards leave no room for the base buildings */
export const MAP_PRESETS: Record<MapPresetId, MapSize> = {
    tiny: { zoneCols: 16, zoneRows: 10, neutralRows: 4, flankCols: 0, rimCells: 4 },
    compact: { zoneCols: 32, zoneRows: 18, neutralRows: 4, flankCols: 4, rimCells: 4 },
    standard: { ...STANDARD_MAP },
    wide: { zoneCols: 80, zoneRows: 30, neutralRows: 4, flankCols: 10, rimCells: 4 },
    deep: { zoneCols: 60, zoneRows: 44, neutralRows: 8, flankCols: 6, rimCells: 4 },
};

export function mapPresetOf(map: MapSize): MapPresetId | null {
    for (const [id, preset] of Object.entries(MAP_PRESETS) as [MapPresetId, MapSize][]) {
        if ((Object.keys(preset) as (keyof MapSize)[]).every((k) => preset[k] === map[k])) return id;
    }
    return null;
}

/** a fresh board: standard map, base buildings, no units, no commanders, nothing that opens later */
export function newDraft(gameVersion: string): ScenarioDef {
    const stamp = new Date().toISOString();
    return {
        version: SCENARIO_VERSION,
        gameVersion,
        id: `draft-${stamp.slice(0, 19).replace(/[^0-9]/g, '')}`,
        name: 'New scenario',
        createdAt: stamp,
        seed: 1,
        map: { ...STANDARD_MAP },
        rules: {
            income: { round1: DEFAULT_SETTINGS.economy.startingSupply, growth: DEFAULT_SETTINGS.economy.supplyGrowthPerRound },
            deploy: {
                unitsPerRound: DEFAULT_SETTINGS.deploy.unitsPerRound,
                extrasBudgetPerRound: DEFAULT_SETTINGS.deploy.extrasBudgetPerRound,
            },
            sideHp: { player: 6000, enemy: 6000 },
            commander: { mode: 'none' },
            roundCards: 'off',
            hordeWaves: 'off',
            flanksOpenFromRound: 1,
            neutralOpenFromRound: 1,
            atmosphere: { season: 'summer', time: 'day', rotate: false },
            strongholdMode: DEFAULT_SETTINGS.strongholdMode,
            opponents: 'lockInOnly',
            enemyIntel: 'visible',
        },
        scene: {
            units: [],
            techs: { player: {}, enemy: {} },
            buildings: { player: {}, enemy: {} },
        },
    };
}

/** footprint extent of a placed entry (rotation swaps it) */
export function extentOf(types: TypeRegistry, unit: SceneUnit): { cols: number; rows: number } | null {
    const type = types.byId(unit.typeId);
    if (!type) return null;
    return unit.at.rotated ? { cols: type.footprint.rows, rows: type.footprint.cols } : type.footprint;
}

/** Is every tile of the entry on the board? (horde packs: or in the forest ring around it) */
export function onBoard(types: TypeRegistry, map: MapSize, unit: SceneUnit): boolean {
    const fp = extentOf(types, unit);
    if (!fp) return true; // unknown types are reported by normalize, not dropped here
    const { cols, rows } = boardCells(map);
    const m = unit.team === 'horde' ? HORDE_MARGIN_CELLS : 0;
    return unit.at.col >= -m && unit.at.row >= -m && unit.at.col + fp.cols <= cols + m && unit.at.row + fp.rows <= rows + m;
}

/**
 * The draft on another board size: entries that no longer fit are removed
 * (returned, for the toast). Base buildings stay as they are — the Game only
 * places the ones that fit.
 */
export function withMap(types: TypeRegistry, def: ScenarioDef, map: MapSize): { def: ScenarioDef; removed: SceneUnit[] } {
    const next = structuredClone(def);
    next.map = { ...map };
    const removed = next.scene.units.filter((u) => !onBoard(types, map, u));
    next.scene.units = next.scene.units.filter((u) => onBoard(types, map, u));
    return { def: next, removed };
}

/** every base building of a side on or off */
export function withBaseBuildings(types: TypeRegistry, def: ScenarioDef, side: 'player' | 'enemy', on: boolean): ScenarioDef {
    const next = structuredClone(def);
    const buildings = next.scene.buildings[side];
    for (const b of types.baseBuildings) {
        if (on) delete buildings[b.id];
        else buildings[b.id] = false;
    }
    return next;
}

/** does any base building of the side stand? */
export function hasBaseBuildings(types: TypeRegistry, def: ScenarioDef, side: 'player' | 'enemy'): boolean {
    return types.baseBuildings.some((b) => def.scene.buildings[side][b.id] !== false);
}

export function withoutTeam(def: ScenarioDef, team: SceneTeam): ScenarioDef {
    const next = structuredClone(def);
    next.scene.units = next.scene.units.filter((u) => u.team !== team);
    return next;
}

const TEAM_ORDER: Record<SceneTeam, number> = { player: 0, enemy: 1, horde: 2 };

/**
 * One spelling per board, so a board read back from the match compares equal
 * to the draft it was built from: entries in team order, talents sorted and
 * without empty lists, base buildings at level 1 without posts omitted.
 */
export function tidyDraft(def: ScenarioDef): ScenarioDef {
    const next = structuredClone(def);
    next.scene.units = next.scene.units
        .map((u, i) => ({ u, i }))
        .sort((a, b) => TEAM_ORDER[a.u.team] - TEAM_ORDER[b.u.team] || a.i - b.i)
        .map(({ u }) => u);
    for (const side of ['player', 'enemy'] as const) {
        const techs = next.scene.techs[side];
        for (const [typeId, ids] of Object.entries(techs)) {
            if (ids.length === 0) delete techs[typeId];
            else techs[typeId] = [...ids].sort();
        }
        const buildings = next.scene.buildings[side];
        for (const [id, state] of Object.entries(buildings)) {
            if (state && state.level === 1 && !state.garrison && !state.destroyed) delete buildings[id];
        }
    }
    return next;
}

const otherTeam = (team: SceneTeam): SceneTeam => (team === 'player' ? 'enemy' : team === 'enemy' ? 'player' : 'horde');

/** an entry turned 180° around the board's center (the far side's view of it) */
function rotatedEntry(types: TypeRegistry, map: MapSize, unit: SceneUnit): SceneUnit {
    const fp = extentOf(types, unit) ?? { cols: 1, rows: 1 };
    const { cols, rows } = boardCells(map);
    return { ...unit, at: { ...unit.at, col: cols - unit.at.col - fp.cols, row: rows - unit.at.row - fp.rows } };
}

/**
 * The board seen from the other side: every entry turned 180°, player and
 * enemy swapped (placements, talents, base buildings, side HP). Applying it
 * twice gives the same draft back (for a tidy draft). The editor plays the
 * enemy side on this view — the match itself always runs as the player.
 */
export function swapSides(types: TypeRegistry, def: ScenarioDef): ScenarioDef {
    const next = structuredClone(def);
    next.scene.units = def.scene.units.map((u) => ({ ...rotatedEntry(types, def.map, u), team: otherTeam(u.team) }));
    next.scene.techs = { player: structuredClone(def.scene.techs.enemy), enemy: structuredClone(def.scene.techs.player) };
    next.scene.buildings = {
        player: structuredClone(def.scene.buildings.enemy),
        enemy: structuredClone(def.scene.buildings.player),
    };
    if (def.rules.sideHp !== 'commander') next.rules.sideHp = { player: def.rules.sideHp.enemy, enemy: def.rules.sideHp.player };
    return tidyDraft(next);
}

/**
 * One side's army copied onto the other, turned 180° so both face each other
 * the same way: the other side's placements are replaced, talents and base
 * buildings copied. A fair mirror match in one step.
 */
export function mirrorSide(types: TypeRegistry, def: ScenarioDef, from: 'player' | 'enemy'): ScenarioDef {
    const to = otherTeam(from) as 'player' | 'enemy';
    const next = structuredClone(def);
    const copies = def.scene.units.filter((u) => u.team === from).map((u) => ({ ...rotatedEntry(types, def.map, u), team: to }));
    next.scene.units = [...def.scene.units.filter((u) => u.team !== to), ...copies];
    next.scene.techs[to] = structuredClone(def.scene.techs[from]);
    next.scene.buildings[to] = structuredClone(def.scene.buildings[from]);
    return tidyDraft(next);
}

/**
 * What each side's army costs in supply, as a player would pay for it: packs
 * (with their levels and runes) plus talents at their escalating prices. Base
 * buildings and their upgrades are not counted. A quick balance readout.
 */
export function armyValue(
    types: TypeRegistry,
    def: ScenarioDef,
    prices: { levelCostFactor: number; techCostEscalation: number },
): Record<SceneTeam, number> {
    const value: Record<SceneTeam, number> = { player: 0, enemy: 0, horde: 0 };
    for (const u of def.scene.units) {
        const type = types.byId(u.typeId);
        if (!type) continue;
        const levels = Math.max(0, u.level - 1) * Math.round((type.levelBasis ?? type.cost) * prices.levelCostFactor);
        const runes = (u.items ?? []).reduce((sum, id) => sum + (types.rune(id)?.cardCost ?? 0), 0);
        value[u.team] += type.cost + levels + runes;
    }
    for (const side of ['player', 'enemy'] as const) {
        for (const ids of Object.values(def.scene.techs[side])) {
            const costs = ids.map((id) => types.talent(id)?.cost ?? 0);
            // the n-th talent of a type costs n × escalation more — the total doesn't depend on order
            value[side] += costs.reduce((a, b) => a + b, 0) + (prices.techCostEscalation * costs.length * (costs.length - 1)) / 2;
        }
    }
    return value;
}

/** Undo/redo over whole draft snapshots — editor-local, separate from match undo. */
export class DraftHistory {
    private readonly past: string[] = [];
    private readonly future: string[] = [];
    private static readonly LIMIT = 200;

    constructor(private current: ScenarioDef) {}

    get draft(): ScenarioDef {
        return this.current;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    /** record `next` as the new state; a no-op edit records nothing */
    push(next: ScenarioDef): boolean {
        const before = JSON.stringify(this.current);
        if (JSON.stringify(next) === before) return false;
        this.past.push(before);
        if (this.past.length > DraftHistory.LIMIT) this.past.shift();
        this.future.length = 0;
        this.current = next;
        return true;
    }

    undo(): ScenarioDef | null {
        const prev = this.past.pop();
        if (prev === undefined) return null;
        this.future.push(JSON.stringify(this.current));
        this.current = JSON.parse(prev) as ScenarioDef;
        return this.current;
    }

    redo(): ScenarioDef | null {
        const next = this.future.pop();
        if (next === undefined) return null;
        this.past.push(JSON.stringify(this.current));
        this.current = JSON.parse(next) as ScenarioDef;
        return this.current;
    }
}

// ---- autosave (browser storage; best effort)

const DRAFT_KEY = 'melodan-scenario-draft';

export interface StoredDraft {
    def: ScenarioDef;
    /** the level the draft was made on; absent = base game */
    level?: LevelRef;
}

export function loadStoredDraft(): StoredDraft | null {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredDraft;
        return parsed && typeof parsed === 'object' && parsed.def?.version === SCENARIO_VERSION ? parsed : null;
    } catch {
        return null;
    }
}

export function storeDraft(def: ScenarioDef, level: LevelRef | undefined): void {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ def, ...(level ? { level } : {}) } satisfies StoredDraft));
    } catch {
        /* private window / quota: the draft just isn't kept */
    }
}
