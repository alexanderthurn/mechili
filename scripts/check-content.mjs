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
    const { collectAssetPaths, renderManifest } = await import('./gen-asset-manifest.mjs');
    const assets = collectAssetPaths();
    for (const p of assets.problems) {
        failed = true;
        console.error(`FAIL ${p}`);
    }
    if (readFileSync('src/game/assetManifest.ts', 'utf8') !== renderManifest(assets.paths)) {
        failed = true;
        console.error('FAIL src/game/assetManifest.ts is stale — run: npm run assets:manifest');
    } else if (!assets.problems.length) {
        console.log(`ok   asset manifest is current (${assets.paths.length} files, no hard-coded asset URLs)`);
    }
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
    const anim = await server.ssrLoadModule('/src/game/unitAnimated.ts');
    console.log(
        `ok   units.ts resolves ${units.BASE_TYPES.roster.length} roster types; ` +
            `unitModels.ts resolves ${Object.keys(models.MODEL_SPECS).length} model specs; ` +
            `unitAnimated.ts rigs ${Object.keys(anim.ANIM_SPECS).sort().join(', ')}`,
    );

    // ---- level overlays: replacement by path, report, hash, data validation
    const resolver = await server.ssrLoadModule('/src/game/assets.ts');
    const pack = await server.ssrLoadModule('/src/game/content/basePack.ts');
    const enc = (text) => new TextEncoder().encode(text);
    const readBase = (rel) => readFileSync(`assets/${rel}`, 'utf8');
    const stronghold = readBase('data/buildings/stronghold.jsonc').replace('"hp": 3000', '"hp": 5000');
    const iceWall = readBase('data/buildings/command-tower.jsonc')
        .replace('"id": "command-tower"', '"id": "ice-wall"')
        .replace('"name": "Vanguard"', '"name": "Ice Wall"');
    const packWithWall = readBase('data/pack.jsonc').replace('"buildings": [', '"buildings": ["ice-wall", ');
    const levelFiles = (strongholdText) => [
        { path: 'textures/moon.webp', bytes: enc('a different moon') },
        { path: 'data/models/ice-wall.jsonc', bytes: enc('{ "file": "models/units/ice-wall.glb" }') },
        { path: 'models/units/ice-wall.glb', bytes: enc('glb bytes') },
        { path: 'textures/tpyo.webp', bytes: enc('nobody references me') },
        { path: '../escape.txt', bytes: enc('no') },
        { path: 'data/buildings/stronghold.jsonc', bytes: enc(strongholdText) },
    ];
    const expect = (cond, what) => {
        if (!cond) {
            failed = true;
            console.error(`FAIL overlay: ${what}`);
        }
        return cond;
    };
    const baseMoon = resolver.assetUrl('textures/moon.webp');
    const level = await resolver.buildAssetOverlay('frost-keep', levelFiles(stronghold));
    const again = await resolver.buildAssetOverlay('frost-keep', levelFiles(stronghold));
    const crlf = await resolver.buildAssetOverlay('frost-keep', levelFiles(stronghold.replace(/\n/g, '\r\n')));
    const changed = await resolver.buildAssetOverlay('frost-keep', levelFiles(stronghold.replace('5000', '5001')));
    let ok = true;
    ok = expect(JSON.stringify(level.report.replaced) === JSON.stringify(['data/buildings/stronghold.jsonc', 'textures/moon.webp']), `replaced = ${level.report.replaced}`) && ok;
    ok = expect(level.report.unreferenced.join() === 'textures/tpyo.webp', `unreferenced = ${level.report.unreferenced}`) && ok;
    ok = expect(level.report.invalid.join() === '../escape.txt', `invalid = ${level.report.invalid}`) && ok;
    ok = expect(level.hash === again.hash, 'hash is not stable') && ok;
    ok = expect(level.hash === crlf.hash, 'hash depends on line endings') && ok;
    ok = expect(level.hash !== changed.hash, 'hash ignores a changed value') && ok;
    resolver.installAssetOverlay(level);
    const net = await server.ssrLoadModule('/src/game/net.ts');
    ok = expect(resolver.assetUrl('textures/moon.webp') !== baseMoon, 'installed overlay does not replace the file') && ok;
    ok = expect(resolver.assetUrl('models/units/ogre.glb').length > 0, 'base files stop resolving under an overlay') && ok;
    ok = expect(net.currentContentHash() === `${net.BASE_CONTENT_HASH}+${level.hash}`, 'multiplayer hash ignores the overlay') && ok;
    resolver.clearAssetOverlay();
    ok = expect(resolver.assetUrl('textures/moon.webp') === baseMoon, 'clearing the overlay does not restore the base file') && ok;
    ok = expect(net.currentContentHash() === net.BASE_CONTENT_HASH, 'multiplayer hash keeps the cleared overlay') && ok;
    // data: an unlisted new building is an error; listing it in the level's pack.jsonc makes it valid
    let unlistedError = '';
    try {
        pack.loadPackWithOverlay(new Map([...level.dataFiles, ['data/buildings/ice-wall.jsonc', iceWall]]), 'frost-keep');
    } catch (e) {
        unlistedError = String(e.message);
    }
    ok = expect(unlistedError.includes('ice-wall.jsonc: not listed in pack.jsonc'), `unlisted building not reported (${unlistedError.split('\n')[0]})`) && ok;
    const levelPack = pack.loadPackWithOverlay(
        new Map([...level.dataFiles, ['data/buildings/ice-wall.jsonc', iceWall], ['data/pack.jsonc', packWithWall]]),
        'frost-keep',
    );
    ok = expect(levelPack.buildings.find((b) => b.id === 'stronghold')?.hp === 5000, "level's stronghold replacement not applied") && ok;
    ok = expect(levelPack.buildings.some((b) => b.id === 'ice-wall'), 'added building missing') && ok;
    ok = expect(BASE_PACK.buildings.find((b) => b.id === 'stronghold')?.hp === 3000, 'overlay validation changed the base game') && ok;
    if (ok) console.log('ok   level overlays: replace/add by path, report, hash, data validation, multiplayer hash');
} catch (e) {
    failed = true;
    console.error(`FAIL ${e instanceof Error ? e.message : e}`);
}
await server.close();
process.exit(failed ? 1 : 0);
