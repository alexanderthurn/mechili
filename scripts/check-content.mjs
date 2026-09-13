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
// a 2D context that accepts every call — procedural unit meshes paint canvas textures
const canvas2d = new Proxy(function () {}, { get: () => canvas2d, apply: () => canvas2d, set: () => true });
globalThis.document = {
    createElement: () => ({ getContext: () => canvas2d, style: {}, width: 0, height: 0 }),
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
            `unitAnimated.ts rigs ${Object.keys(anim.ANIM_SPECS).sort().join(', ')}; ` +
            `wings flap on ${Object.keys(models.MODEL_SPECS).filter(models.usesWingFlapModel).sort().join(', ')}`,
    );

    // ---- talents: behaviour comes from attributes, lookups go through the registry
    {
        const tech = await server.ssrLoadModule('/src/game/tech.ts');
        const sim = await server.ssrLoadModule('/src/game/sim.ts');
        const T = units.BASE_TYPES;
        const owns = (...ids) => (seat, typeId, techId) => ids.includes(techId);
        const wizard = T.require('wizard');
        const crow = T.require('crowRider');
        let ok = true;
        const expect = (cond, what) => {
            if (!cond) {
                ok = false;
                failed = true;
                console.error(`FAIL talents: ${what}`);
            }
        };
        const wizardTargets = tech.effectiveTargets(wizard, 0, owns('skyBind'), T);
        expect(wizardTargets.ground && wizardTargets.air, 'Sky Bind does not add both attack layers');
        expect(tech.effectiveTargets(wizard, 0, owns(), T) === wizard.targets, 'no talent changed the attack layers');
        expect(tech.effectiveFlying(wizard, 0, owns('skyLift'), T) === tech.SKY_LIFT_ALTITUDE, 'Sky Lift does not lift');
        expect(tech.effectiveFlying(wizard, -1, owns('skyLift'), T) === (wizard.flying ?? 0), 'a seatless pack got lifted');
        const unit = { summoned: false, items: [], seat: 0, type: crow };
        expect(sim.hasShieldHp(unit, owns('aegis'), T), 'Aegis grants no shield');
        expect(!sim.hasShieldHp(unit, owns('engines'), T), 'a shield without Aegis');
        expect(T.talent('nope') === null && T.talentsOf(T.require('hordeSpinne')).some((t) => t.id === 'spiderMother'), 'talent lookups');
        if (ok) console.log(`ok   talents: ${T.talents.size} from data; Sky Bind / Sky Lift / Aegis act through attributes`);
    }

    // ---- commanders & round cards: spell ids name real tactics (tactics are still code)
    {
        const { TACTICS } = await server.ssrLoadModule('/src/game/tactics.ts');
        const cards = await server.ssrLoadModule('/src/game/cards.ts');
        const T = units.BASE_TYPES;
        let ok = true;
        const hidden = ['tutorial', 'tutorial2', 'tutorial3'].map((id) => T.commander(id));
        for (const card of [...T.commanders, ...hidden, ...T.roundCards]) {
            if (!card) {
                ok = false;
                continue;
            }
            for (const id of [...(card.forgeSpells ?? []), ...(card.tactics ?? [])]) {
                if (!TACTICS[id]) {
                    ok = false;
                    console.error(`FAIL ${card.id}: spell "${id}" is not a tactic`);
                }
            }
        }
        if (hidden.includes(null)) console.error('FAIL a tutorial commander is missing (tutorial, tutorial2, tutorial3)');
        const air = T.commander('air');
        if (!air || !cards.starterUnlockedUnits(air, T).includes('crowRider') || cards.starterUnlockedUnits(hidden[0], T).length !== 0) {
            ok = false;
            console.error('FAIL commander unlocks: signature unit missing or a tutorial commander unlocks units');
        }
        if (!ok) failed = true;
        else console.log(`ok   commanders: ${T.commanders.length} offered + ${hidden.length} tutorial; ${T.roundCards.length} round cards; spell ids exist`);
    }

    // ---- tutorials: the units, footprints, talent and commanders the lessons are scripted around
    {
        const tutorial = await server.ssrLoadModule('/src/game/tutorial.ts');
        const basePackModule = await server.ssrLoadModule('/src/game/content/basePack.ts');
        const registry = await server.ssrLoadModule('/src/game/content/typeRegistry.ts');
        const problems = tutorial.tutorialContentProblems(units.BASE_TYPES);
        const dwarfText = readFileSync('assets/data/units/dwarf.jsonc', 'utf8').replace('"cols": 5, "rows": 2', '"cols": 4, "rows": 2');
        const wider = new registry.TypeRegistry(basePackModule.loadPackWithOverlay(new Map([['data/units/dwarf.jsonc', dwarfText]]), 'tutorial-check'));
        const caught = tutorial.tutorialContentProblems(wider).some((p) => p.includes('"dwarf" to be 5×2'));
        if (problems.length > 0 || !caught) {
            failed = true;
            for (const p of problems) console.error(`FAIL ${p}`);
            if (!caught) console.error('FAIL tutorial guard missed a changed dwarf footprint');
        } else {
            console.log('ok   tutorials: lesson units, footprints, talent and commanders present');
        }
    }

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
    let talentError = '';
    try {
        pack.loadPackWithOverlay(new Map([['data/units/dwarf.jsonc', readBase('data/units/dwarf.jsonc').replace('"legs"', '"legz"')]]), 'typo');
    } catch (e) {
        talentError = String(e.message);
    }
    ok = expect(talentError.includes('"talents" names "legz"'), `unknown talent id not reported (${talentError.split('\n')[0]})`) && ok;
    const runeErrorOf = (files) => {
        try {
            pack.loadPackWithOverlay(new Map(files), 'runes');
        } catch (e) {
            return String(e.message);
        }
        return '';
    };
    const addi = readBase('data/runes/addi.jsonc');
    const dupRecipe = runeErrorOf([['data/runes/addi.jsonc', addi.replace('["earth", "earth"]', '["fire", "fire"]')]]);
    ok = expect(dupRecipe.includes('already make "'), `duplicate forge recipe not reported (${dupRecipe.split('\n')[0]})`) && ok;
    const badIngredient = runeErrorOf([['data/runes/addi.jsonc', addi.replace('["earth", "earth"]', '["earth", "eart"]')]]);
    ok = expect(badIngredient.includes('forge ingredient "eart" is no rune'), `unknown forge ingredient not reported (${badIngredient.split('\n')[0]})`) && ok;
    const badArmy = runeErrorOf([['data/commanders/air.jsonc', readBase('data/commanders/air.jsonc').replace('"goblin", "goblin", "goblin"', '"goblin", "gobiln", "goblin"')]]);
    ok = expect(badArmy.includes('names unit "gobiln"'), `unknown commander unit not reported (${badArmy.split('\n')[0]})`) && ok;
    const unlistedRune = runeErrorOf([['data/runes/ice.jsonc', addi.replace('"id": "addi"', '"id": "ice"').replace(/"forge": \{[^}]*\},/, '')]]);
    ok = expect(unlistedRune.includes('ice.jsonc: not listed in pack.jsonc "runes"'), `unlisted rune not reported (${unlistedRune.split('\n')[0]})`) && ok;
    if (ok) console.log('ok   level overlays: replace/add by path, report, hash, data validation (talents, runes, recipes, commanders), multiplayer hash');

    // ---- switching levels: caches told after the files switch, model data follows, bad data changes nothing
    const levels = await server.ssrLoadModule('/src/game/level.ts');
    const ogreText = readFileSync('assets/data/models/ogre.jsonc', 'utf8');
    const baseOgreUrl = models.MODEL_SPECS.ogre.url;
    let hookSaw = '';
    resolver.onAssetOverlaySwitch('check', () => {
        hookSaw = models.MODEL_SPECS.ogre.url;
    });
    const ogreMod = await resolver.buildAssetOverlay('ogre-mod', [
        { path: 'models/units/ogre.glb', bytes: enc('glb bytes') },
        { path: 'data/models/ogre.jsonc', bytes: enc(ogreText.replace('"speed": 0.5', '"speed": 0.75')) },
        { path: 'data/models/ice-wall.jsonc', bytes: enc('{ "file": "models/units/ogre.glb" }') },
        { path: 'data/buildings/ice-wall.jsonc', bytes: enc(iceWall) },
        { path: 'data/pack.jsonc', bytes: enc(packWithWall) },
    ]);
    let sw = true;
    sw = expect(models.isStructureModel('stronghold') && models.isStructureModel('shield') && !models.isStructureModel('archer'), 'structure models not taken from the structure flag') && sw;
    const on = await levels.switchLevel(ogreMod);
    sw = expect(on === levels.activeLevel() && on.overlay === ogreMod, 'switchLevel does not report the active level') && sw;
    sw = expect(hookSaw !== '' && hookSaw !== baseOgreUrl, 'reload hooks did not run with the level installed') && sw;
    sw = expect(anim.ANIM_SPECS.ogre?.animation.walk.speed === 0.75, "rigged model data does not follow the level") && sw;
    sw = expect('ice-wall' in models.MODEL_SPECS, "level's added model missing from MODEL_SPECS") && sw;
    sw = expect(models.isStructureModel('ice-wall') && on.types.byId('ice-wall')?.structure === true, "level's building is not a structure model") && sw;
    const off = await levels.switchLevel(null);
    sw = expect(off.overlay === null && off.types === units.BASE_TYPES, 'switching back does not restore the base registry') && sw;
    sw = expect(models.MODEL_SPECS.ogre.url === baseOgreUrl && hookSaw === baseOgreUrl, 'switching back does not restore base files') && sw;
    sw = expect(anim.ANIM_SPECS.ogre?.animation.walk.speed === 0.5, 'switching back does not restore rigged model data') && sw;
    sw = expect(!('ice-wall' in models.MODEL_SPECS), "level's model stays after switching back") && sw;
    sw = expect(!models.isStructureModel('ice-wall'), "level's building stays a structure model after switching back") && sw;
    const broken = await resolver.buildAssetOverlay('broken', [
        { path: 'data/models/ogre.jsonc', bytes: enc(ogreText.replace('"skinned": true,', '')) },
    ]);
    let brokenError = '';
    await levels.switchLevel(broken).catch((e) => (brokenError = String(e.message)));
    sw = expect(brokenError.includes('"animation" needs "skinned": true'), `invalid level not rejected (${brokenError.split('\n')[0]})`) && sw;
    sw = expect(levels.activeLevel().overlay === null && resolver.activeAssetOverlay() === null, 'a rejected level changed the active files') && sw;
    sw = expect(models.MODEL_SPECS.ogre.skinned === true, 'a rejected level changed model data') && sw;
    if (sw) console.log('ok   level switch: reload hooks after install, model + animation data and structure flags follow, base restored, invalid level rejected');

    // ---- scenario packages: zip → files → known level → the one a match names
    {
        const zipMod = await server.ssrLoadModule('/src/game/content/zip.ts');
        // a tiny zip writer: stored and deflated entries (the reader ignores CRCs)
        const makeZip = async (entries) => {
            const parts = [];
            const central = [];
            let offset = 0;
            for (const { path, text, deflate } of entries) {
                const name = enc(path);
                const raw = enc(text);
                const data = deflate
                    ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
                    : raw;
                const local = new DataView(new ArrayBuffer(30));
                local.setUint32(0, 0x04034b50, true);
                local.setUint16(8, deflate ? 8 : 0, true);
                local.setUint32(18, data.length, true);
                local.setUint32(22, raw.length, true);
                local.setUint16(26, name.length, true);
                parts.push(new Uint8Array(local.buffer), name, data);
                const cd = new DataView(new ArrayBuffer(46));
                cd.setUint32(0, 0x02014b50, true);
                cd.setUint16(10, deflate ? 8 : 0, true);
                cd.setUint32(20, data.length, true);
                cd.setUint32(24, raw.length, true);
                cd.setUint16(28, name.length, true);
                cd.setUint32(42, offset, true);
                central.push(new Uint8Array(cd.buffer), name);
                offset += 30 + name.length + data.length;
            }
            const cdSize = central.reduce((n, p) => n + p.length, 0);
            const eocd = new DataView(new ArrayBuffer(22));
            eocd.setUint32(0, 0x06054b50, true);
            eocd.setUint16(10, entries.length, true);
            eocd.setUint32(12, cdSize, true);
            eocd.setUint32(16, offset, true);
            return new Uint8Array(await new Blob([...parts, ...central, new Uint8Array(eocd.buffer)]).arrayBuffer());
        };
        const archerText = readBase('data/units/archer.jsonc').replace('"hp": 130', '"hp": 999');
        let zk = true;
        const zexpect = (cond, what) => {
            if (!cond) {
                zk = false;
                failed = true;
                console.error(`FAIL scenario: ${what}`);
            }
        };
        const zipped = await makeZip([
            { path: 'frost-keep/data/units/archer.jsonc', text: archerText, deflate: true },
            { path: 'frost-keep/textures/moon.webp', text: 'moon', deflate: false },
            { path: 'frost-keep/.DS_Store', text: 'junk', deflate: false },
            { path: '__MACOSX/frost-keep/._moon.webp', text: 'junk', deflate: false },
        ]);
        const files = levels.levelFilesFromArchive(await zipMod.readZip(zipped));
        // a flat archive whose only folder is data/ keeps its paths (the wrapper rule must not eat it)
        const flatDataOnly = levels.levelFilesFromArchive(
            await zipMod.readZip(await makeZip([{ path: 'data/units/archer.jsonc', text: archerText, deflate: true }])),
        );
        zexpect(flatDataOnly.map((f) => f.path).join() === 'data/units/archer.jsonc', `flat data-only zip lost its data folder: ${flatDataOnly.map((f) => f.path)}`);
        let nothingError = '';
        await levels
            .loadLevel('misplaced', [{ path: 'units/archer.jsonc', bytes: enc(archerText) }])
            .catch((e) => (nothingError = String(e.message)));
        zexpect(nothingError.includes('changes nothing'), 'a level that changes nothing was accepted');
        zexpect(files.map((f) => f.path).sort().join() === 'data/units/archer.jsonc,textures/moon.webp', `zip paths ${files.map((f) => f.path)}`);
        zexpect(new TextDecoder().decode(files.find((f) => f.path.endsWith('archer.jsonc'))?.bytes) === archerText, 'deflated entry does not round-trip');
        const { ref } = await levels.loadLevel('frost-keep', files);
        const again = await levels.loadLevel('other-name', files);
        zexpect(again.ref.hash === ref.hash && levels.knownLevels().filter((l) => l.hash === ref.hash).length === 1, 'same content loaded twice is not one level');
        zexpect(levels.isLevelAvailable(ref) && levels.isLevelAvailable(undefined), 'loaded level not available');
        zexpect(levels.isLevelActive(undefined) && !levels.isLevelActive(ref), 'base game should be active before prepareLevel');
        const prepared = await levels.prepareLevel(ref);
        zexpect(levels.isLevelActive(ref) && prepared.types.require('archer').hp === 999, "prepareLevel does not play the level's archer");
        zexpect(levels.activeLevelRef()?.hash === ref.hash, 'activeLevelRef does not name the active level');
        await levels.prepareLevel(undefined);
        zexpect(levels.isLevelActive(undefined) && units.BASE_TYPES.require('archer').hp === 130, 'back to base game failed');
        let unknownError = '';
        await levels.prepareLevel({ id: 'ghost', hash: 'f'.repeat(64) }).catch((e) => (unknownError = String(e.message)));
        zexpect(unknownError.includes('is not loaded'), 'unknown scenario did not fail');
        let badError = '';
        await levels
            .loadLevel('bad', [{ path: 'data/units/archer.jsonc', bytes: enc(archerText.replace('"hp": 999', '"hp": "lots"')) }])
            .catch((e) => (badError = String(e.message)));
        zexpect(badError.includes('hp') && !levels.knownLevels().some((l) => l.id === 'bad'), 'invalid scenario was accepted');
        // ---- transfer: host packs + chunks, guest requests batches, reassembles, same hash
        {
            const transfer = await server.ssrLoadModule('/src/game/levelTransfer.ts');
            const big = new Uint8Array(3 * 1024 * 1024 + 123);
            for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
            const hostFiles = [...files, { path: 'textures/moon.webp', bytes: big }];
            const { ref: hostRef } = await levels.loadLevel('frost-keep-big', hostFiles);
            const sender = new transfer.LevelSender(levels.levelFiles(hostRef.hash));
            const receiver = new transfer.LevelReceiver(hostRef, sender.count);
            let requests = 0;
            let from = 0;
            while (from !== null && !receiver.complete()) {
                requests++;
                let next = null;
                for (const index of sender.batch(from)) next = receiver.add(index, sender.chunk(index)) ?? next;
                from = next;
                if (requests > sender.count + 2) break;
            }
            zexpect(receiver.complete(), `transfer incomplete after ${requests} requests (${sender.count} chunks)`);
            zexpect(requests === Math.ceil(sender.count / transfer.LEVEL_CHUNK_BATCH), `expected one request per batch, got ${requests}`);
            const received = receiver.complete() ? receiver.files() : [];
            const rebuilt = await server.ssrLoadModule('/src/game/assets.ts').then((a) => a.buildAssetOverlay('guest', received));
            zexpect(rebuilt.hash === hostRef.hash, 'received scenario hashes differently than the offer');
            let tamperError = '';
            try {
                const tiny = new transfer.LevelReceiver(hostRef, 1);
                tiny.add(0, btoa('x'.repeat(10)));
                tiny.files();
            } catch (e) {
                tamperError = String(e.message);
            }
            zexpect(tamperError.includes('truncated'), `a garbage package was not rejected (${tamperError})`);
            let hugeError = '';
            try {
                new transfer.LevelReceiver(hostRef, 100000);
            } catch (e) {
                hugeError = String(e.message);
            }
            zexpect(hugeError.includes('refusing'), 'an oversized scenario offer was accepted');
            const net = await server.ssrLoadModule('/src/game/net.ts');
            zexpect(
                net.isSameBaseBuild({ version: net.ourBuild().version, contentHash: `${net.BASE_CONTENT_HASH}+${hostRef.hash}` }) &&
                    !net.isSameBaseBuild({ version: net.ourBuild().version, contentHash: 'other+x' }),
                'base-build check for joining scenario rooms',
            );
            zexpect(net.contentHashFor(hostRef) === `${net.BASE_CONTENT_HASH}+${hostRef.hash}` && net.contentHashFor(undefined) === net.BASE_CONTENT_HASH, 'contentHashFor');
            // ---- a spectator of a scenario match: gated offer → chunks → resent handshake → admitted
            {
                await levels.prepareLevel(hostRef);
                const sync = await server.ssrLoadModule('/src/game/levelSync.ts');
                let handlers = null;
                const hub = net.SpectatorHub.openWith({ managesLiveness: true, listen: (h) => (handlers = h) }, () => {});
                const joins = [];
                hub.listen((name, build, link) => joins.push({ name, build, link }));
                const outbox = [];
                const link = { send: (m) => outbox.push(m), close: () => {} };
                handlers.onSpectate('watcher', { version: net.ourBuild().version, contentHash: net.BASE_CONTENT_HASH }, link);
                const offer = outbox.find((m) => m.type === 'levelOffer');
                zexpect(joins.length === 0 && offer?.gate === true && offer.level?.hash === hostRef.hash, 'a spectator without the scenario was not gated');
                handlers.onData(link, { type: 'levelRequest', hash: hostRef.hash, from: 0 });
                const chunks = outbox.filter((m) => m.type === 'levelChunk');
                zexpect(chunks.length === Math.min(transfer.LEVEL_CHUNK_BATCH, offer.chunks), `gated spectator got ${chunks.length} chunks`);
                // the joining side (same process here, so it already has the level): LevelDownload resolves at once
                const download = new sync.LevelDownload(offer.level, offer.chunks, () => {});
                const got = await download.done;
                zexpect(got?.hash === hostRef.hash, 'LevelDownload did not activate the offered level');
                handlers.onData(link, { type: 'spectate', name: 'watcher', version: net.ourBuild().version, contentHash: net.currentContentHash() });
                zexpect(joins.length === 1 && joins[0].name === 'watcher', 'the resent spectate handshake was not admitted');
                const otherBase = { version: net.ourBuild().version, contentHash: 'deadbeef' };
                handlers.onSpectate('stranger', otherBase, { send: (m) => outbox.push({ stranger: m }), close: () => {} });
                zexpect(joins.length === 2, 'a different base build must go to the version check, not the scenario gate');
                await levels.prepareLevel(undefined);
            }
            if (zk) console.log(`ok   scenario transfer: ${sender.count} chunks in ${requests} batched requests, same hash on arrival, garbage/oversized refused; spectators gated, served, admitted on resend`);
        }
        if (zk) console.log('ok   scenarios: zip (stored, deflated, wrapper folder vs flat data/, junk skipped, no-op level rejected) → known level → prepareLevel plays it, base restored, invalid/unknown rejected');
    }
} catch (e) {
    failed = true;
    console.error(`FAIL ${e instanceof Error ? e.message : e}`);
}
await server.close();
process.exit(failed ? 1 : 0);
