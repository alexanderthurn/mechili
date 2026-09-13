/**
 * A scenario as a level package (plan §4.1): `scenario.jsonc` at the root, next
 * to the content overrides of the level it was made on (if any).
 */
import { SCENARIO_FILE, type OverlayFile } from '../assets';
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

/** The package files: the scenario plus the content of the level it came from. */
export function scenarioPackageFiles(def: ScenarioDef, contentFiles: readonly OverlayFile[] = []): OverlayFile[] {
    return [
        ...contentFiles.filter((f) => f.path !== SCENARIO_FILE),
        { path: SCENARIO_FILE, bytes: new TextEncoder().encode(scenarioFileText(def)) },
    ];
}
