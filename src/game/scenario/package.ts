/**
 * Scenarios as a level package (plan §4.1): levels under `scenarios/<id>.jsonc`
 * (or a lone root `scenario.jsonc`), an optional `meta.jsonc`, next to the
 * content overrides (data, models, textures) they play with.
 */
import { isScenarioPackageFile, META_FILE, SCENARIO_FILE, SCENARIOS_DIR, type OverlayFile } from '../assets';
import { parseJsonc } from '../content/jsonc';
import type { PackageMeta } from './packageMeta';
import type { ScenarioDef } from './scenarioDef';

/** `scenario.jsonc` text — readable, with a short header */
export function scenarioFileText(def: ScenarioDef): string {
    const header = [
        `// ${def.name}`,
        ...(def.description ? [`// ${def.description}`] : []),
        '// Scenario format: SANDBOX_LEVEL_EDITOR_PLAN.md §4–§6 (schema: assets/data/schema/scenario.schema.json).',
    ];
    return `${header.join('\n')}\n${JSON.stringify(def, null, 4)}\n`;
}

/**
 * A one-level package: `scenarios/<def.id>.jsonc` plus the content files of
 * the level it was made on — without that level's own scenarios or meta.
 */
export function scenarioPackageFiles(def: ScenarioDef, contentFiles: readonly OverlayFile[] = []): OverlayFile[] {
    return [
        ...contentFiles.filter((f) => !isScenarioPackageFile(f.path)),
        { path: `${SCENARIOS_DIR}${def.id}.jsonc`, bytes: new TextEncoder().encode(scenarioFileText(def)) },
    ];
}

/** a scenario id from a name: lower-case words joined by dashes */
export function scenarioSlug(name: string, fallback: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

/** the scenario ids a package's files hold (a lone root `scenario.jsonc` is `scenario`) */
export function packageScenarioIds(files: readonly OverlayFile[]): string[] {
    const ids: string[] = [];
    for (const f of files) {
        if (f.path === SCENARIO_FILE) ids.push('scenario');
        else if (f.path.startsWith(SCENARIOS_DIR) && f.path.endsWith('.jsonc')) ids.push(f.path.slice(SCENARIOS_DIR.length, -'.jsonc'.length));
    }
    return ids;
}

/**
 * A package with `def` in it: the scenario of the same id is replaced,
 * otherwise it is added under a free id from its name and appended to the
 * package's order. A package that ends up with several scenarios gets (or
 * keeps) a `meta.jsonc` naming them in order; its other fields are kept.
 */
export function withScenarioInPackage(
    files: readonly OverlayFile[],
    def: ScenarioDef,
    packageId: string,
): { files: OverlayFile[]; id: string } {
    const ids = packageScenarioIds(files);
    let id = def.id;
    if (!ids.includes(id)) {
        const base = scenarioSlug(def.name, 'scenario');
        id = base;
        for (let n = 2; ids.includes(id); n++) id = `${base}-${n}`;
    }
    const path = id === 'scenario' && files.some((f) => f.path === SCENARIO_FILE) ? SCENARIO_FILE : `${SCENARIOS_DIR}${id}.jsonc`;
    const encoder = new TextEncoder();
    const out = files.filter((f) => f.path !== path && f.path !== META_FILE);
    out.push({ path, bytes: encoder.encode(scenarioFileText({ ...def, id })) });

    const metaFile = files.find((f) => f.path === META_FILE);
    let meta: Record<string, unknown> | null = null;
    if (metaFile) {
        try {
            const parsed = parseJsonc(new TextDecoder().decode(metaFile.bytes), META_FILE);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
        } catch {
            meta = null;
        }
    }
    const allIds = ids.includes(id) ? ids : [...ids, id];
    if (meta || allIds.length > 1) {
        const levels = Array.isArray(meta?.levels) ? [...(meta.levels as { scenario?: unknown }[])] : allIds.filter((x) => x !== id).map((scenario) => ({ scenario }));
        if (!levels.some((l) => l?.scenario === id)) levels.push({ scenario: id });
        const next: PackageMeta = {
            ...(meta as Partial<PackageMeta> | null),
            version: 1,
            id: typeof meta?.id === 'string' ? meta.id : packageId,
            name: typeof meta?.name === 'string' ? meta.name : packageId,
            levels: levels as PackageMeta['levels'],
        };
        out.push({ path: META_FILE, bytes: encoder.encode(`${JSON.stringify(next, null, 4)}\n`) });
    }
    return { files: out, id };
}
