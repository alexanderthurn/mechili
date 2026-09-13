// Validates assets/data with the same loader the game runs — JSONC syntax, the
// generated JSON Schemas (fields and value types at every depth), ids vs file
// names, pack.jsonc listings — checks the schemas aren't stale against the
// TypeScript types, and that units.ts / unitModels.ts accept the result.
//
//   npm run check:content
//
// Runs the game modules through Vite's SSR loader, so TypeScript and
// import.meta.glob work exactly as in the build. A few browser globals are
// stubbed because some modules read them at import time.
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: () => null,
    length: 0,
};
globalThis.sessionStorage = globalThis.localStorage;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'en', languages: ['en'] };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {} }),
    documentElement: { style: {} },
    addEventListener() {},
};
globalThis.addEventListener = () => {};

const { createServer } = await import('vite');
const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
});

let failed = false;
try {
    const { readFileSync } = await import('node:fs');
    const { generateContentSchemas } = await import('./gen-content-schema.mjs');
    const stale = generateContentSchemas().filter(({ file, text }) => {
        try {
            return readFileSync(file, 'utf8') !== text;
        } catch {
            return true;
        }
    });
    if (stale.length) {
        failed = true;
        console.error(`FAIL stale schema(s): ${stale.map((s) => s.file).join(', ')} — run: npm run content:schema`);
    } else {
        console.log('ok   content schemas match the TypeScript types');
    }

    const { BASE_PACK } = await server.ssrLoadModule('/src/game/content/basePack.ts');
    console.log(
        `ok   assets/data loads: ${BASE_PACK.roster.length} roster, ${BASE_PACK.offRoster.length} off-roster, ` +
            `${BASE_PACK.buildings.length} buildings, ${Object.keys(BASE_PACK.models).length} models`,
    );

    // the game's own consumers accept it: lookups resolve, procedural models exist
    const units = await server.ssrLoadModule('/src/game/units.ts');
    const models = await server.ssrLoadModule('/src/game/unitModels.ts');
    console.log(
        `ok   units.ts resolves ${units.UNIT_TYPES.length} roster types; ` +
            `unitModels.ts resolves ${Object.keys(models.MODEL_SPECS).length} model specs`,
    );
} catch (e) {
    failed = true;
    console.error(`FAIL ${e instanceof Error ? e.message : e}`);
}
await server.close();
process.exit(failed ? 1 : 0);
