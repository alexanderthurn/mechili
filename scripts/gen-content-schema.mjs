// Generates the JSON Schemas for content files straight from the TypeScript
// types, so the data format can never drift from what the game reads.
//
//   npm run content:schema          write assets/data/schema/*.schema.json
//   node scripts/gen-content-schema.mjs --check   exit 1 if they are stale
//
// The schemas drive VS Code autocomplete / hover docs for every .jsonc file
// (see .vscode/settings.json) and the game's own validation
// (src/game/content/basePack.ts).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createGenerator } from 'ts-json-schema-generator';

const SCHEMAS = [
    { file: 'assets/data/schema/unit.schema.json', path: 'src/game/units.ts', type: 'UnitType' },
    { file: 'assets/data/schema/model.schema.json', path: 'src/game/unitModels.ts', type: 'ModelSpecData' },
    { file: 'assets/data/schema/pack.schema.json', path: 'src/game/content/basePack.ts', type: 'PackManifest' },
];

/** `{@link Foo}` / `{@link Foo.bar}` → `Foo` / `Foo.bar` — readable hover text */
function tidyDescriptions(node) {
    if (Array.isArray(node)) {
        node.forEach(tidyDescriptions);
    } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (k === 'description' && typeof v === 'string') {
                node[k] = v
                    .replace(/\(\s*\{@link\s+([^}\s]+)\s*\}\s*\)/g, '($1)')
                    .replace(/\{@link\s+([^}\s]+)\s*\}/g, '$1')
                    .replace(/[ \t]{2,}/g, ' ')
                    .replace(/\(\s+/g, '(')
                    .replace(/\s+\)/g, ')');
            } else {
                tidyDescriptions(v);
            }
        }
    }
}

export function generateContentSchemas() {
    return SCHEMAS.map(({ file, path, type }) => {
        const schema = createGenerator({
            path,
            type,
            tsconfig: 'tsconfig.json',
            skipTypeCheck: true,
            expose: 'export',
            topRef: true,
            additionalProperties: false,
        }).createSchema(type);
        tidyDescriptions(schema);
        // VS Code keywords: the files are JSONC (comments + trailing commas allowed)
        schema.allowComments = true;
        schema.allowTrailingCommas = true;
        return { file, text: JSON.stringify(schema, null, 2) + '\n' };
    });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
    const check = process.argv.includes('--check');
    let stale = 0;
    for (const { file, text } of generateContentSchemas()) {
        if (check) {
            let current = '';
            try {
                current = readFileSync(file, 'utf8');
            } catch {
                /* missing counts as stale */
            }
            if (current !== text) {
                stale++;
                console.error(`FAIL ${file} is stale — run: npm run content:schema`);
            }
        } else {
            mkdirSync('assets/data/schema', { recursive: true });
            writeFileSync(file, text);
            console.log(`wrote ${file}`);
        }
    }
    if (check && stale === 0) console.log('ok   content schemas match the TypeScript types');
    process.exit(stale ? 1 : 0);
}
