/**
 * Validate a scenario against its schema and the match's registry (plan §4.3).
 *
 * One rule for every problem: record an issue. Structural problems (the file
 * isn't a scenario) leave no `def`. Everything else yields a normalized `def`
 * the editor can open; talents and runes that can't apply are dropped with a
 * warning, while unknown units, buildings off the board and similar are
 * errors — Play refuses a scenario with any error.
 */
import type { TypeRegistry } from '../content/typeRegistry';
import { parseJsonc } from '../content/jsonc';
import { validateSchema, type JsonSchema } from '../content/schema';
import scenarioSchemaJson from '../../../assets/data/schema/scenario.schema.json';
import metaSchemaJson from '../../../assets/data/schema/meta.schema.json';
import type { PackageMeta } from './packageMeta';
import { SCENARIO_VERSION, type ScenarioDef, type SceneBuildings } from './scenarioDef';

const SCENARIO_SCHEMA = scenarioSchemaJson as unknown as JsonSchema;
const META_SCHEMA = metaSchemaJson as unknown as JsonSchema;

export interface NormalizedMeta {
    def: PackageMeta | null;
    issues: ScenarioIssue[];
}

/**
 * Parse `meta.jsonc` against its schema and the package's scenario ids.
 * A level naming a missing scenario is an error; reserved progression fields
 * are accepted but not applied yet.
 */
export function parseMeta(text: string, scenarioIds: ReadonlySet<string>, types: TypeRegistry): NormalizedMeta {
    const issues: ScenarioIssue[] = [];
    let raw: unknown;
    try {
        raw = parseJsonc(text, 'meta.jsonc');
    } catch (e) {
        return { def: null, issues: [{ level: 'error', message: e instanceof Error ? e.message : String(e) }] };
    }
    const schemaErrors = validateSchema(META_SCHEMA, raw);
    if (schemaErrors.length > 0) {
        return { def: null, issues: schemaErrors.map((message) => ({ level: 'error' as const, message: `meta.jsonc: ${message}` })) };
    }
    const def = raw as PackageMeta;
    const seen = new Set<string>();
    def.levels.forEach((level, i) => {
        const where = `meta.jsonc levels[${i}]`;
        if (!scenarioIds.has(level.scenario)) {
            issues.push({ level: 'error', message: `${where}: no scenarios/${level.scenario}.jsonc in this package` });
        }
        if (seen.has(level.scenario)) issues.push({ level: 'warning', message: `${where}: "${level.scenario}" appears twice` });
        seen.add(level.scenario);
        for (const id of level.unlocks ?? []) {
            if (!types.shopUnitIds.includes(id)) issues.push({ level: 'warning', message: `${where}: unlocks "${id}", which is not a buyable unit` });
        }
    });
    if (def.levels.length === 0) issues.push({ level: 'warning', message: 'meta.jsonc: no levels' });
    return { def, issues };
}

export interface ScenarioIssue {
    level: 'error' | 'warning';
    message: string;
}

export interface NormalizedScenario {
    /** null when the input isn't a scenario at all */
    def: ScenarioDef | null;
    issues: ScenarioIssue[];
}

/**
 * How far past the board (in tiles) horde packs may stand — the forest ring
 * the horde waves come out of. Player and enemy entries stay on the board.
 */
export const HORDE_MARGIN_CELLS = 32;

/** Grid size of a board, same arithmetic as BattleMap. */
export function boardCells(map: ScenarioDef['map']): { cols: number; rows: number } {
    return {
        cols: map.zoneCols + 2 * map.flankCols + 2 * map.rimCells,
        rows: 2 * map.zoneRows + map.neutralRows + 2 * map.rimCells,
    };
}

export function hasErrors(issues: readonly ScenarioIssue[]): boolean {
    return issues.some((i) => i.level === 'error');
}

/** Parse `scenario.jsonc` text and normalize it. */
export function parseScenario(text: string, types: TypeRegistry, label = 'scenario.jsonc'): NormalizedScenario {
    let raw: unknown;
    try {
        raw = parseJsonc(text, label);
    } catch (e) {
        return { def: null, issues: [{ level: 'error', message: e instanceof Error ? e.message : String(e) }] };
    }
    return normalizeScenario(raw, types);
}

export function normalizeScenario(raw: unknown, types: TypeRegistry): NormalizedScenario {
    const issues: ScenarioIssue[] = [];
    const error = (message: string) => issues.push({ level: 'error', message });
    const warn = (message: string) => issues.push({ level: 'warning', message });

    if (typeof raw === 'object' && raw !== null && (raw as { version?: unknown }).version !== SCENARIO_VERSION) {
        return { def: null, issues: [{ level: 'error', message: `unsupported scenario version ${JSON.stringify((raw as { version?: unknown }).version)} (this game reads ${SCENARIO_VERSION})` }] };
    }
    const schemaErrors = validateSchema(SCENARIO_SCHEMA, raw);
    if (schemaErrors.length > 0) {
        return { def: null, issues: schemaErrors.map((message) => ({ level: 'error' as const, message })) };
    }
    const def = structuredClone(raw) as ScenarioDef;
    const { rules, scene } = def;
    const { cols, rows } = boardCells(def.map);

    // ---- rules
    if (rules.sideHp !== 'commander' && (rules.sideHp.player < 1 || rules.sideHp.enemy < 1)) {
        error('rules.sideHp: each side needs at least 1 HP');
    }
    if (rules.commander.mode === 'fixed' && !types.commander(rules.commander.id)) {
        error(`rules.commander: no commander "${rules.commander.id}"`);
    }
    if (rules.commander.mode === 'none' && rules.sideHp === 'commander') {
        error('rules.sideHp: without commanders the sides need fixed HP');
    }
    if (rules.commander.mode === 'none' && !types.commander('none')) {
        error('rules.commander: this pack has no hidden "none" commander');
    }
    if (rules.loadout && rules.loadout.mode !== 'player') {
        warn(`rules.loadout: "${rules.loadout.mode}" is not applied yet — the player's own loadout is used`);
    }
    if (rules.unlockable) {
        const known = rules.unlockable.filter((id) => types.shopUnitIds.includes(id));
        for (const id of rules.unlockable) {
            if (!known.includes(id)) warn(`rules.unlockable: "${id}" is not a buyable unit — dropped`);
        }
        rules.unlockable = known;
    }
    if (rules.unlockedUnits) {
        const known = rules.unlockedUnits.filter((id) => types.shopUnitIds.includes(id));
        for (const id of rules.unlockedUnits) {
            if (!known.includes(id)) warn(`rules.unlockedUnits: "${id}" is not a buyable unit — dropped`);
        }
        rules.unlockedUnits = known;
        if (known.length === 0) warn('rules.unlockedUnits: the player can buy nothing');
    }

    // ---- units
    scene.units = scene.units.filter((u, i) => {
        const where = `scene.units[${i}] (${u.typeId})`;
        const type = types.byId(u.typeId);
        if (!type) {
            error(`${where}: no unit or building type "${u.typeId}"`);
            return true;
        }
        const w = u.at.rotated ? type.footprint.rows : type.footprint.cols;
        const h = u.at.rotated ? type.footprint.cols : type.footprint.rows;
        const margin = u.team === 'horde' ? HORDE_MARGIN_CELLS : 0;
        if (u.at.col < -margin || u.at.row < -margin || u.at.col + w > cols + margin || u.at.row + h > rows + margin) {
            error(u.team === 'horde' ? `${where}: too far outside the board` : `${where}: outside the ${cols}×${rows} board`);
        }
        if (u.level < 1) error(`${where}: level must be at least 1`);
        if (u.items) {
            const kept = u.items.filter((id) => types.rune(id) !== null);
            for (const id of u.items) if (!kept.includes(id)) warn(`${where}: no rune "${id}" — dropped`);
            u.items = kept;
        }
        return true;
    });
    if (!scene.units.some((u) => u.team === 'enemy')) warn('scene: the enemy side has no units');

    // ---- talents (side-level per type)
    for (const side of ['player', 'enemy'] as const) {
        for (const [typeId, ids] of Object.entries(scene.techs[side])) {
            const type = types.byId(typeId);
            if (!type) {
                warn(`scene.techs.${side}: no unit type "${typeId}" — dropped`);
                delete scene.techs[side][typeId];
                continue;
            }
            const allowed = new Set([...(type.talents ?? []), ...(type.innateTechs ?? [])]);
            const kept = ids.filter((id) => allowed.has(id));
            for (const id of ids) if (!kept.includes(id)) warn(`scene.techs.${side}.${typeId}: "${id}" is not one of its talents — dropped`);
            scene.techs[side][typeId] = kept;
        }
    }

    // ---- base buildings
    const buildingIds = new Set(types.buildings.map((b) => b.id));
    for (const side of ['player', 'enemy'] as const) {
        const buildings: SceneBuildings = scene.buildings[side];
        for (const [id, state] of Object.entries(buildings)) {
            if (!buildingIds.has(id)) {
                error(`scene.buildings.${side}: "${id}" is not a base building of this pack`);
                continue;
            }
            if (state === false) continue;
            if (state.level < 1) error(`scene.buildings.${side}.${id}: level must be at least 1`);
            if (state.destroyed) {
                warn(`scene.buildings.${side}.${id}: "destroyed" is ignored — buildings stand again every round`);
            }
            if (state.garrison !== undefined) {
                const slots = types.byId(id)?.garrison?.slots.length ?? 0;
                if (state.garrison < 0 || state.garrison > slots) {
                    error(`scene.buildings.${side}.${id}: garrison ${state.garrison} but it has ${slots} posts`);
                }
            }
        }
    }

    return { def, issues };
}
