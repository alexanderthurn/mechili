/**
 * Scenarios as a level package (plan §4.1): levels under `scenarios/<id>.jsonc`
 * (or a lone root `scenario.jsonc`), an optional `meta.jsonc`, next to the
 * content overrides (data, models, textures) they play with.
 */
import { isScenarioPackageFile, SCENARIOS_DIR, type OverlayFile } from '../assets';
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
