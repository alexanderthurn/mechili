/**
 * The base content pack: unit, building and model definitions loaded from
 * `content/base/**.jsonc` (plan §17). Bundled by Vite — read once, synchronously,
 * when this module loads.
 *
 * Every file is validated against a JSON Schema generated from the TypeScript
 * type it becomes (`content/schema/`): unknown fields at any depth, wrong value
 * types, bad enum values and missing required fields are errors — a typo in a
 * data file must never silently do nothing. All problems are reported together.
 *
 * Only type imports from the game here: `units.ts` builds its tables from this
 * module, so a runtime import back into it would be a cycle.
 */
import type { UnitType } from '../units';
import type { ModelSpecData } from '../unitModels';
import { parseJsonc } from './jsonc';
import { validateSchema, type JsonSchema } from './schema';

// ------------------------------------------------------------------ schemas

// Generated from the TypeScript types by `npm run content:schema`
// (npm run check:content fails when they are stale).
import unitSchemaJson from '../../../content/schema/unit.schema.json';
import modelSchemaJson from '../../../content/schema/model.schema.json';
import packSchemaJson from '../../../content/schema/pack.schema.json';

const UNIT_SCHEMA = unitSchemaJson as unknown as JsonSchema;
const MODEL_SCHEMA = modelSchemaJson as unknown as JsonSchema;
const PACK_SCHEMA = packSchemaJson as unknown as JsonSchema;

// ------------------------------------------------------------------ files

const RAW_FILES = import.meta.glob('../../../content/base/**/*.jsonc', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

export interface PackManifest {
    id: string;
    version: number;
    roster: string[];
    offRoster: string[];
    buildings: string[];
}

export interface BasePack {
    /** UNIT_TYPES, in roster order */
    roster: UnitType[];
    /** addressable by id, never part of the roster */
    offRoster: UnitType[];
    buildings: UnitType[];
    /** keyed by model id (the file name) */
    models: Record<string, ModelSpecData>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse and validate a whole pack from `path → raw text`. Throws one error listing every problem. */
export function loadPack(files: Record<string, string>, label: string): BasePack {
    const errors: string[] = [];
    const byFolder = { units: new Map<string, unknown>(), buildings: new Map<string, unknown>(), models: new Map<string, unknown>() };
    let manifest: PackManifest | null = null;

    for (const [path, text] of Object.entries(files)) {
        const rel = path.slice(path.indexOf('/content/') + 1);
        const parts = rel.split('/'); // content, <pack>, <folder>, <file>
        let data: unknown;
        try {
            data = parseJsonc(text, rel);
        } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
            continue;
        }
        if (parts.length === 3 && parts[2] === 'pack.jsonc') {
            manifest = data as PackManifest;
            continue;
        }
        const folder = parts[2] as keyof typeof byFolder;
        const name = parts[3]?.replace(/\.jsonc$/, '');
        if (parts.length !== 4 || !(folder in byFolder) || !name) {
            errors.push(`${rel}: unexpected file (expected units/, buildings/ or models/<id>.jsonc)`);
            continue;
        }
        byFolder[folder].set(name, data);
    }

    if (!manifest) throw new Error(`[content:${label}] pack.jsonc is missing`);
    for (const e of validateSchema(PACK_SCHEMA, manifest)) errors.push(`content/${label}/pack.jsonc: ${e}`);

    const checkType = (folder: string, id: string, data: unknown): UnitType | null => {
        const where = `content/${label}/${folder}/${id}.jsonc`;
        if (!isRecord(data)) {
            errors.push(`${where}: must be an object`);
            return null;
        }
        for (const e of validateSchema(UNIT_SCHEMA, data)) errors.push(`${where}: ${e}`);
        if (data.id !== id) errors.push(`${where}: "id" is ${JSON.stringify(data.id)} but the file is named "${id}"`);
        return data as unknown as UnitType;
    };

    const take = (folder: 'units' | 'buildings', ids: string[], listName: string): UnitType[] => {
        const out: UnitType[] = [];
        for (const id of ids) {
            const data = byFolder[folder].get(id);
            if (data === undefined) {
                errors.push(`content/${label}/pack.jsonc: "${listName}" lists "${id}" but ${folder}/${id}.jsonc does not exist`);
                continue;
            }
            const type = checkType(folder, id, data);
            if (type) out.push(type);
        }
        return out;
    };

    const listed = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : []);
    const rosterIds = listed(manifest.roster);
    const offRosterIds = listed(manifest.offRoster);
    const buildingIds = listed(manifest.buildings);

    const seen = new Set<string>();
    for (const id of [...rosterIds, ...offRosterIds, ...buildingIds]) {
        if (seen.has(id)) errors.push(`content/${label}/pack.jsonc: "${id}" is listed more than once`);
        seen.add(id);
    }
    for (const id of byFolder.units.keys()) {
        if (!rosterIds.includes(id) && !offRosterIds.includes(id)) {
            errors.push(`content/${label}/units/${id}.jsonc: not listed in pack.jsonc "roster" or "offRoster"`);
        }
    }
    for (const id of byFolder.buildings.keys()) {
        if (!buildingIds.includes(id)) {
            errors.push(`content/${label}/buildings/${id}.jsonc: not listed in pack.jsonc "buildings"`);
        }
    }

    const roster = take('units', rosterIds, 'roster');
    const offRoster = take('units', offRosterIds, 'offRoster');
    const buildings = take('buildings', buildingIds, 'buildings');

    const models: Record<string, ModelSpecData> = {};
    for (const [id, data] of byFolder.models) {
        const where = `content/${label}/models/${id}.jsonc`;
        if (!isRecord(data)) {
            errors.push(`${where}: must be an object`);
            continue;
        }
        for (const e of validateSchema(MODEL_SCHEMA, data)) errors.push(`${where}: ${e}`);
        models[id] = data as unknown as ModelSpecData;
    }

    if (errors.length > 0) {
        throw new Error(`[content:${label}] ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
    }
    return { roster, offRoster, buildings, models };
}

/** The bundled base game. */
export const BASE_PACK: BasePack = loadPack(RAW_FILES, 'base');
