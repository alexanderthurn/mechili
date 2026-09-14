// AI arena: plays The Year headless — real placement, real action dispatcher,
// real AI code, real BattleSim — no renderer, no HUD. Measures how an AI does
// round after round against a stand-in for the human.
//
//   node scripts/ai-arena.mjs [--games 6] [--rounds 9] [--variant attack|defend|komtur-attack|komtur-defend|all]
//                             [--ai year|classic] [--human classic|year] [--seed 1] [--verbose]
//
// The AI side rebuilds its army every round (as in the game); the human side
// keeps its army, levels it with the XP it earns and buys more — driven by one
// of the AI brains, which is only a stand-in for a player. A round's result
// follows The Year: the attacker must outscore, a tie goes to the defender.
// What the arena leaves out: the horde waves (third party), round cards,
// spells cast from the tactics strip, commander gift units.
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
globalThis.requestAnimationFrame = () => 0;
const canvas2d = new Proxy(function () {}, { get: () => canvas2d, apply: () => canvas2d, set: () => true });
const element = () => ({
    getContext: () => canvas2d,
    style: {},
    width: 0,
    height: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    parentElement: null,
});
globalThis.document = { createElement: element, documentElement: { style: {} }, body: element(), addEventListener() {} };
globalThis.addEventListener = () => {};

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const { createServer } = await import('vite');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const load = (p) => server.ssrLoadModule(p);

const three = await import('three');
const units = await load('/src/game/units.ts');
const { BattleMap, STANDARD_MAP, BASE_ANCHORS, mulberry32 } = await load('/src/game/map.ts');
const { PlacementController } = await load('/src/game/placement.ts');
const { BattleSim } = await load('/src/game/sim.ts');
const { TechTree } = await load('/src/game/tech.ts');
const settingsMod = await load('/src/game/settings.ts');
const { ActionDispatcher } = await load('/src/game/actions.ts');
const { AiOpponent } = await load('/src/game/ai.ts');
const { CameraRig } = await load('/src/engine/cameraRig.ts');
const { buildHpDrawSources } = await load('/src/game/hpDraw.ts');
const { ownedProduceTechs } = await load('/src/game/techCatalog.ts');
const { detCos, detSin } = await load('/src/game/detMath.ts');
const { HazardField } = await load('/src/game/fire.ts');

const { DEFAULT_SETTINGS, Economy, CLIMB_AI_DEPLOY_LIMIT, CLIMB_PLAYER_SUPPLY_GROWTH_PER_ROUND } = settingsMod;
const T = units.BASE_TYPES;
const VARIANTS = {
    attack: { humanRole: 'attacker' },
    defend: { humanRole: 'defender' },
    'komtur-attack': { humanRole: 'attacker', attackerCommander: 'komtur' },
    'komtur-defend': { humanRole: 'defender', attackerCommander: 'komtur' },
};

function seedFrom(seed, label) {
    let h = seed >>> 0;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619) >>> 0;
    return h;
}

/** one Year match: human stand-in (seat 0, player) vs the AI (seat 1, enemy) */
function newMatch(variantName, seed, brains) {
    const variant = VARIANTS[variantName];
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.climb = { roundsToWin: 9, sideHp: 1, playerSupplyGrowthPerRound: CLIMB_PLAYER_SUPPLY_GROWTH_PER_ROUND, ...variant };
    const attackerTeam = variant.humanRole === 'defender' ? 'enemy' : 'player';
    const map = new BattleMap({ ...STANDARD_MAP });
    const seats = [
        { team: 'player', side: 0, controller: 'ai', name: 'Human' },
        { team: 'enemy', side: 1, controller: 'ai', name: 'AI' },
    ];
    const economy = new Economy(settings.economy, 2, 1);
    const surface = element();
    surface.parentElement = element();
    const placement = new PlacementController(new CameraRig(), map, economy, new three.Scene(), surface, T);
    placement.roster = seats;
    const techTree = new TechTree(2, T);
    const state = {
        round: 0,
        hp: { player: 1, enemy: 1 },
        unlockedUnits: [[], []],
        unlockUsedThisRound: [false, false],
        items: [[], []],
        tactics: [[], []],
        speciality: [null, null],
        commander: [null, null],
        starterPicked: [false, false],
        seatReady: [false, false],
        deployReady: { player: false, enemy: false },
        deployState: {
            limit: [settings.deploy.unitsPerRound, settings.deploy.unitsPerRound],
            extra: [0, 0],
            used: [0, 0],
            extrasSpent: [0, 0],
            runesBought: [0, 0],
        },
    };
    const hazards = new HazardField(settings.map);
    const ctx = {
        types: T,
        placement,
        economy,
        seats,
        techTree,
        leveling: settings.leveling,
        towers: settings.towers,
        sellSettings: settings.sell,
        rallyRouteSettings: settings.rallyRoute,
        movePackSettings: settings.movePack,
        deploySettings: settings.deploy,
        boostSettings: settings.boosts,
        recruitLevel: [1, 1],
        sellState: { owned: [false, false], used: [0, 0] },
        rallyRouteOwned: [false, false],
        forgeSpellOwned: [[], []],
        forgeSpellsOf: () => [],
        movePackOwned: [false, false],
        deployState: state.deployState,
        boostState: { attack: [0, 0], hp: [0, 0] },
        roundBoosts: { range: [false, false], speed: [false, false] },
        creditUsed: [false, false],
        creditDebt: [false, false],
        speciality: state.speciality,
        commander: state.commander,
        flankSpawnMult: [1, 1],
        items: state.items,
        tactics: state.tactics,
        forgeSlots: { player: [], enemy: [] },
        forgeLitBy: { player: null, enemy: null },
        forgePoolOf: () => [],
        rallyRoutes: [],
        rallyRouteIds: { next: 1 },
        oilField: hazards,
        oilBaseline: new HazardField(settings.map),
        oilStamps: [],
        oilStampIds: { next: 1 },
        spellStamps: [],
        spellStampIds: { next: 1 },
        roundCardTaken: [false, false],
        deployReady: state.deployReady,
        seatReady: state.seatReady,
        starterPicked: state.starterPicked,
        unlockedUnits: state.unlockedUnits,
        unlockUsedThisRound: state.unlockUsedThisRound,
        hp: { get: (team) => state.hp[team], set: (team, hp) => (state.hp[team] = hp) },
        commanderHpFactor: 1,
        fixedSideHp: { player: 1, enemy: 1 },
        starterArmy: true,
        playerUnlocks: null,
        playerUnlockable: null,
        climbMode: true,
        climbAttacker: attackerTeam,
        clock: () => ({ round: state.round, t: 0 }),
        onEndDeployment: () => {},
        onForfeit: () => {},
        debugLog: () => {},
    };
    const dispatcher = new ActionDispatcher(ctx);
    const aiCtx = (seat, climb, brain) => ({
        types: T,
        dispatch: (action) => dispatcher.dispatch({ ...action, seat }),
        placement,
        economy,
        techTree,
        unlockedUnits: state.unlockedUnits,
        unlockUsedThisRound: state.unlockUsedThisRound,
        items: state.items,
        tactics: state.tactics,
        speciality: state.speciality,
        commander: state.commander,
        rng: mulberry32(seedFrom(seed, `ai-${seat}`)),
        loadoutOf: () => undefined,
        deploySettings: settings.deploy,
        forgeSpellOwned: ctx.forgeSpellOwned,
        forgeSpellsOf: () => [],
        climb,
        opponents: 'build',
        rngForRound: (round) => mulberry32(seedFrom(seed, `ai-climb-${seat}-${round}`)),
        brain,
        plannerOverrides: seat === 1 ? aiPlanner : {},
        leveling: settings.leveling,
        yearRole: seat === 1 ? (variant.humanRole === 'defender' ? 'attacker' : 'defender') : variant.humanRole,
        deployCap: () => state.deployState.limit[seat] + state.deployState.extra[seat] - state.deployState.used[seat],
    });
    const human = new AiOpponent('player', 0, aiCtx(0, false, brains.human));
    const ai = new AiOpponent('enemy', 1, aiCtx(1, true, brains.ai));
    return { settings, map, placement, techTree, economy, state, dispatcher, human, ai, attackerTeam, seed, variantName, hazards };
}

/** base buildings for the defending side (the Game's layout for a 1v1) */
function spawnBase(m) {
    const { map, placement, settings, attackerTeam } = m;
    const { rimCells, flankCols, zoneCols, zoneRows } = map.size;
    const place = (xFrac, rowFrac, type, team, seat) => {
        if (!type || team === attackerTeam) return;
        const fp = type.footprint;
        const centerRow = Math.round(rimCells + zoneRows * rowFrac - fp.rows / 2);
        const col = rimCells + flankCols + Math.round(zoneCols * xFrac) - Math.floor(fp.cols / 2);
        const near = { col, row: centerRow };
        const far = { col: map.cols - col - fp.cols, row: map.rows - centerRow - fp.rows };
        placement.spawn(type, team === 'enemy' ? far : near, team, false, false, seat);
    };
    if (settings.strongholdMode !== 'none') {
        place(BASE_ANCHORS.stronghold.xFrac, BASE_ANCHORS.stronghold.rowFrac, T.baseBuilding('stronghold'), 'player', 0);
        place(BASE_ANCHORS.stronghold.xFrac, BASE_ANCHORS.stronghold.rowFrac, T.baseBuilding('stronghold'), 'enemy', 1);
    }
    for (const [team, seat] of [['player', 0], ['enemy', 1]]) {
        place(BASE_ANCHORS.research.xFrac, BASE_ANCHORS.research.rowFrac, T.baseBuilding('research'), team, seat);
        place(BASE_ANCHORS.command.xFrac, BASE_ANCHORS.command.rowFrac, T.baseBuilding('command'), team, seat);
    }
}

function pickCommanders(m) {
    const rng = mulberry32(seedFrom(m.seed, 'cards'));
    const offer = (team) => {
        const forced = m.settings.climb.attackerCommander && m.attackerTeam === team ? T.commander(m.settings.climb.attackerCommander) : null;
        if (forced) return [forced];
        const pool = [...T.commanders];
        const out = [];
        while (out.length < 4 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        return out;
    };
    m.state.round = 0;
    m.human.chooseStarter(offer('player'));
    m.ai.chooseStarter(offer('enemy'));
}

function resolvedStats(m, unit) {
    const stats = TechTree.statsWithOwned(unit.type, m.techTree.ownedFor(unit.seat, unit.type.id), T);
    const effects = T.commander(m.state.commander[unit.seat] ?? '')?.effects;
    if (effects?.unitStatsBonus && !unit.type.structure) {
        stats.damage *= 1 + effects.unitStatsBonus;
        stats.hp *= 1 + effects.unitStatsBonus;
    }
    for (const id of unit.items) {
        const mods = T.rune(id)?.mods;
        if (!mods) continue;
        stats.hp *= mods.hp ?? 1;
        stats.damage *= mods.damage ?? 1;
        stats.range *= mods.range ?? 1;
        stats.minRange *= mods.range ?? 1;
        stats.speed *= mods.speed ?? 1;
        stats.attackInterval *= mods.attackInterval ?? 1;
    }
    if (effects?.speedBonus && !unit.type.structure && unit.type.speed > 0) stats.speed += effects.speedBonus;
    return stats;
}

const hasTech = (m) => (seat, typeId, techId) => T.byId(typeId)?.innateTechs?.includes(techId) || (seat >= 0 && m.techTree.has(seat, typeId, techId));

function startRound(m) {
    const { state, economy, placement, map, settings } = m;
    state.round++;
    placement.currentRound = state.round;
    placement.beginDeployment();
    map.flanksUnlocked = state.round >= 2;
    map.neutralUnlocked = state.round >= 2;
    state.deployState.used.fill(0);
    state.deployState.extra.fill(0);
    state.deployState.extrasSpent.fill(0);
    state.deployState.limit[1] = CLIMB_AI_DEPLOY_LIMIT;
    state.unlockUsedThisRound.fill(false);
    state.seatReady.fill(false);
    state.deployReady.player = false;
    state.deployReady.enemy = false;
    const eco = settings.economy;
    economy.creditRoundIncome(0, eco.startingSupply + (state.round - 1) * settings.climb.playerSupplyGrowthPerRound);
    economy.creditRoundIncome(1, eco.startingSupply + (state.round - 1) * eco.supplyGrowthPerRound);
    for (const seat of [0, 1]) {
        const effects = T.commander(state.commander[seat] ?? '')?.effects;
        if (effects?.incomePerRound) economy.credit(seat, effects.incomePerRound);
        if (effects?.roundOneSupply && state.round === 1) economy.credit(seat, effects.roundOneSupply);
    }
    placement.captureIntelSnapshot();
    placement.setIntelFog(false);
}

function prepareReserves(m) {
    const parents = m.placement.allUnits().filter((u) => !u.destroyed && !u.productionHeld).sort((a, b) => a.id - b.id);
    for (const parent of parents) {
        for (const { tech, produce } of ownedProduceTechs(parent.type, parent.seat, hasTech(m), T)) {
            const childType = T.byId(produce.typeId);
            if (!childType) continue;
            for (let i = 0; i < produce.max; i++) {
                const ang = ((i * 2654435761) >>> 0) * ((Math.PI * 2) / 4294967296);
                const r = 2 + (i % 7) * 0.4;
                const child = m.placement.spawnAtWorld(childType, parent.world.x + detCos(ang) * r, parent.world.z + detSin(ang) * r, parent.team, parent.seat);
                child.summoned = true;
                child.productionHeld = true;
                child.productionParentId = parent.id;
                child.productionTechId = tech.id;
                child.deployedRound = m.state.round;
                child.level = parent.level;
                child.setDeployment(false);
            }
        }
    }
}

function battle(m, observe) {
    const { placement, map, settings, state } = m;
    placement.beginBattle();
    placement.revealAll();
    placement.refaceAll();
    prepareReserves(m);
    const sim = new BattleSim(placement.allUnits(), {
        towers: settings.towers,
        leveling: settings.leveling,
        battleSeconds: 90,
        seatRank: (s) => s,
        costOf: (t) => t.cost,
        statsOf: (u) => resolvedStats(m, u),
        hasTech: hasTech(m),
        flankSpawnSeconds: settings.deploy.flankSpawnSeconds ?? 5,
        flankSpawnMult: () => 1,
        needsFlankSpawn: (u) => !u.flankSpawnDone && !u.summoned && !u.type.structure && !u.type.extra && placement.isOnFlank(u),
        rallyRoutes: [],
        oilField: m.hazards,
        oilExpiresRound: state.round,
        spellStrikes: [],
        spellZones: [],
        spellIgnites: [],
        hazardPours: [],
        summonDelayOf: (u) => (u.summoned ? u.summonDelay ?? 0 : 0),
        spawnOnKill: (parent, typeId, x, z) => {
            const type = T.byId(typeId);
            if (!type) return null;
            const child = placement.spawnAtWorld(type, x, z, parent.team, parent.seat);
            child.summoned = true;
            child.deployedRound = state.round;
            child.level = parent.level;
            child.setDeployment(false);
            return child;
        },
        boardHalfW: map.halfW,
        boardHalfZ: map.halfH,
        loadoutOf: () => undefined,
        types: T,
        strongholdLifeline: settings.strongholdMode === 'lifeline',
    });
    let guard = 0;
    while (!sim.finished && guard++ < 1000) {
        sim.update(0.25);
        sim.consumeEvents();
    }
    observe?.(sim);
    const hp = buildHpDrawSources(sim);
    const survivors = { player: 0, enemy: 0 };
    for (const [unit, count] of sim.unitSurvivors()) if (count.alive > 0 && unit.team !== 'horde') survivors[unit.team]++;
    const playerHp = 1 - hp.damageToPlayer;
    const enemyHp = 1 - hp.damageToEnemy;
    // The Year's round rule, from the human's side
    const humanDefends = m.settings.climb.humanRole === 'defender';
    const humanWins = humanDefends ? playerHp >= enemyHp : playerHp > enemyHp;
    // after the battle: summons leave, everyone else stands again
    for (const unit of [...placement.allUnits()]) {
        if (unit.consumed || unit.summoned) placement.removeUnit(unit);
        else unit.resetFormation();
    }
    placement.refaceAll();
    return { humanWins, seconds: sim.elapsed, survivors, damage: { toPlayer: hp.damageToPlayer, toEnemy: hp.damageToEnemy } };
}

function armyValue(m, seat) {
    let v = 0;
    for (const u of m.placement.allUnits()) {
        if (u.seat !== seat || u.type.structure || u.type.extra) continue;
        v += u.type.cost * (1 + (u.level - 1) * 0.5);
    }
    return Math.round(v);
}

function playYear(variantName, seed, brains, rounds, verbose) {
    const m = newMatch(variantName, seed, brains);
    spawnBase(m);
    pickCommanders(m);
    const results = [];
    for (let r = 1; r <= rounds; r++) {
        startRound(m);
        // as in the game: the AI builds at the start of the build phase, the player after
        const tPlan = performance.now();
        m.ai.onBuildPhase(m.state.round);
        planTimes.push(performance.now() - tPlan);
        const aiLeft = m.economy.balance(1);
        m.human.onBuildPhase(m.state.round);
        if (verbose) {
            const list = (seat) => {
                const counts = new Map();
                for (const u of m.placement.allUnits()) {
                    if (u.seat !== seat || u.type.structure || u.type.extra) continue;
                    const k = `${u.type.id}${u.level > 1 ? `@${u.level}` : ''}`;
                    counts.set(k, (counts.get(k) ?? 0) + 1);
                }
                return [...counts].map(([k, n]) => `${n}×${k}`).join(' ');
            };
            const techs = (seat) => [...m.techTree.snapshotOwned()[seat] ?? []].map(([t, set]) => `${t}:${[...set].join('+')}`).join(' ');
            console.log(`    AI (left ${aiLeft}): ${list(1)} | ${techs(1)}`);
            console.log(`    human (left ${m.economy.balance(0)}): ${list(0)} | ${techs(0)}`);
        }
        const aiValue = armyValue(m, 1);
        const humanValue = armyValue(m, 0);
        const out = battle(m);
        m.state.hp.player = 1;
        m.state.hp.enemy = 1;
        results.push(out.humanWins);
        if (verbose) {
            console.log(
                `  r${r} ${out.humanWins ? 'human' : 'AI   '} ${out.seconds.toFixed(0)}s  army human ${humanValue} (${out.survivors.player} left) vs AI ${aiValue} (${out.survivors.enemy} left)`,
            );
        }
    }
    return results;
}

/**
 * Duels: every pair of army types at equal supply, no bases, front lines
 * facing — the real battle next to the planner's estimate, to calibrate it.
 */
async function duels(budget) {
    const yearMod = await load('/src/game/aiYear.ts');
    const ids = [...new Set([...T.shopUnitIds, ...T.allShopUnitIds])].filter((id) => T.byId(id).cost > 0);
    let agree = 0;
    let total = 0;
    const rows = [];
    for (const a of ids) {
        const cells = [];
        for (const b of ids) {
            const m = newMatch('attack', 7, { ai: 'classic', human: 'classic' });
            m.map.flanksUnlocked = false;
            m.map.neutralUnlocked = false;
            m.state.round = 1;
            m.placement.currentRound = 1;
            const place = (id, team, seat) => {
                const type = T.require(id);
                const count = Math.max(1, Math.floor(budget / type.cost));
                const placed = [];
                for (let i = 0; i < count; i++) {
                    const spot = m.placement.findAiSpot(team, seat, type, mulberry32(1000 + i * 7 + seat));
                    if (!spot) break;
                    const u = m.placement.spawn(type, spot.anchor, team, spot.rotated, true, seat);
                    if (u) placed.push(u);
                }
                return placed;
            };
            place(a, 'player', 0);
            place(b, 'enemy', 1);
            const groups = (team) =>
                m.placement
                    .allUnits()
                    .filter((u) => u.team === team)
                    .map((u) =>
                        yearMod.groupOf(u.type, {
                            seat: u.seat,
                            level: 1,
                            items: [],
                            count: 1,
                            depth: 4,
                            hasTech: hasTech(m),
                            types: T,
                            leveling: m.settings.leveling,
                            lifeline: false,
                        }),
                    );
            const est = yearMod.estimateBattle(groups('player'), groups('enemy'));
            const out = battle(m);
            const real = out.survivors.player > 0 && out.survivors.enemy === 0 ? 1 : out.survivors.enemy > 0 && out.survivors.player === 0 ? -1 : 0;
            const guess = est.margin > 0.05 ? 1 : est.margin < -0.05 ? -1 : 0;
            if (real === guess) agree++;
            total++;
            cells.push(`${real === 1 ? 'A' : real === -1 ? 'B' : '='}${guess === real ? ' ' : guess === 1 ? '!a' : guess === -1 ? '!b' : '!='}`);
        }
        rows.push(`${a.padEnd(15)} ${cells.map((c) => c.padEnd(4)).join('')}`);
    }
    console.log(`duels at ${budget} supply — row type (A) vs column type (B); real winner, "!x" = model said x`);
    console.log(`${''.padEnd(15)} ${ids.map((id) => id.slice(0, 3).padEnd(4)).join('')}`);
    for (const r of rows) console.log(r);
    console.log(`model agrees with the real battle in ${agree}/${total}`);
}

/** tiles between a unit and its side's front edge (as the planner measures it) */
function depthOf(m, unit) {
    const map = m.map;
    const near = unit.team === 'player' ? !map.ownAtFar : map.ownAtFar;
    const rim = map.size.rimCells;
    const ownRows = map.size.zoneRows + (map.neutralUnlocked ? map.size.neutralRows / 2 : 0);
    const frontRow = near ? rim + ownRows - 1 : map.rows - rim - ownRows;
    const forward = near ? 1 : -1;
    const centerRow = unit.cell.row + (unit.rotated ? unit.type.footprint.cols : unit.type.footprint.rows) / 2;
    return Math.max(0, (frontRow - centerRow) * forward);
}

/** the board as the model's inputs (recomputed per parameter set while tuning) */
function snapshotUnits(m) {
    return m.placement
        .allUnits()
        .filter((u) => u.team !== 'horde' && !u.type.extra && !u.summoned)
        .map((u) => ({
            typeId: u.type.id,
            team: u.team,
            seat: u.seat,
            level: u.level,
            items: [...u.items],
            techs: [...m.techTree.ownedFor(u.seat, u.type.id)],
            depth: depthOf(m, u),
        }));
}

/** a real battle's result as the model's margin: standing HP share, mine minus theirs */
function realMargin(sim) {
    const hp = { player: [0, 0], enemy: [0, 0] };
    for (const [unit, c] of sim.unitSurvivors()) {
        if (unit.team === 'horde') continue;
        const each = unit.type.hp * (1 + (unit.level - 1));
        hp[unit.team][0] += c.alive * each;
        hp[unit.team][1] += c.total * each;
    }
    const mine = hp.player[1] ? hp.player[0] / hp.player[1] : 0;
    const theirs = hp.enemy[1] ? hp.enemy[0] / hp.enemy[1] : 0;
    return { mine, theirs };
}

/** build a dataset of real battles: duels at several budgets plus random mixed armies */
async function collect(cachePath) {
    const { writeFileSync } = await import('node:fs');
    const ids = [...new Set([...T.shopUnitIds, ...T.allShopUnitIds])].filter((id) => T.byId(id).cost > 0);
    const cases = [];
    const run = (setup, base) => {
        const m = newMatch(base ? 'attack' : 'attack', 11, { ai: 'classic', human: 'classic' });
        m.map.flanksUnlocked = false;
        m.map.neutralUnlocked = false;
        m.state.round = 1;
        m.placement.currentRound = 1;
        if (base) spawnBase(m);
        setup(m);
        const units = snapshotUnits(m);
        let simRef = null;
        const out = battle(m, (sim) => (simRef = sim));
        const r = realMargin(simRef);
        cases.push({ units, real: r.mine - r.theirs, winner: out.survivors.player > 0 && out.survivors.enemy === 0 ? 1 : out.survivors.enemy > 0 && out.survivors.player === 0 ? -1 : 0, humanWins: out.humanWins });
    };
    const put = (m, id, team, seat, count, rng, level = 1, techs = []) => {
        const type = T.require(id);
        for (let i = 0; i < count; i++) {
            const spot = m.placement.findAiSpot(team, seat, type, rng);
            if (!spot) break;
            const u = m.placement.spawn(type, spot.anchor, team, spot.rotated, true, seat);
            if (u) u.level = level;
        }
        for (const t of techs) m.techTree.add(seat, id, t);
    };
    for (const budget of [400, 900, 1800]) {
        for (const a of ids) {
            for (const b of ids) {
                run((m) => {
                    put(m, a, 'player', 0, Math.max(1, Math.floor(budget / T.byId(a).cost)), mulberry32(3));
                    put(m, b, 'enemy', 1, Math.max(1, Math.floor(budget / T.byId(b).cost)), mulberry32(5));
                }, false);
            }
        }
        process.stdout.write(`duels ${budget} done (${cases.length})\n`);
    }
    const rng = mulberry32(99);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const normal = T.shopUnitIds.filter((id) => T.byId(id).cost > 0);
    const komtur = T.shopFor(T.commander('komtur'));
    for (let n = 0; n < 500; n++) {
        const withBase = rng() < 0.5;
        run((m) => {
            for (const [team, seat] of [['player', 0], ['enemy', 1]]) {
                const pool = rng() < 0.25 ? komtur : normal;
                const budget = 500 + Math.floor(rng() * 2500);
                let left = budget;
                const kinds = 1 + Math.floor(rng() * 4);
                const chosen = Array.from({ length: kinds }, () => pick(pool));
                for (let guard = 0; guard < 40 && left > 0; guard++) {
                    const id = pick(chosen);
                    const type = T.byId(id);
                    if (type.cost > left) continue;
                    const level = team === 'player' && rng() < 0.4 ? 2 + Math.floor(rng() * 2) : 1;
                    const techs = rng() < 0.3 ? (type.talents ?? []).slice(0, 1 + Math.floor(rng() * 2)) : [];
                    put(m, id, team, seat, 1, rng, level, techs);
                    left -= type.cost * (1 + (level - 1) * 0.5);
                }
            }
        }, withBase);
        if (n % 100 === 99) process.stdout.write(`mixed ${n + 1} (${cases.length})\n`);
    }
    writeFileSync(cachePath, JSON.stringify(cases));
    console.log(`wrote ${cases.length} cases to ${cachePath}`);
}

/** fit the model's free numbers to the recorded battles */
async function tune(cachePath, iterations) {
    const { readFileSync } = await import('node:fs');
    const yearMod = await load('/src/game/aiYear.ts');
    const { MODEL } = yearMod;
    const cases = JSON.parse(readFileSync(cachePath, 'utf8'));
    const leveling = DEFAULT_SETTINGS.leveling;
    const evaluate = () => {
        let agree = 0;
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        let sx = 0;
        let sy = 0;
        for (const c of cases) {
            const g = (team) =>
                c.units
                    .filter((u) => u.team === team)
                    .map((u) =>
                        yearMod.groupOf(T.require(u.typeId), {
                            seat: u.seat,
                            level: u.level,
                            items: u.items,
                            count: 1,
                            depth: u.depth,
                            hasTech: (s, t, id) => T.byId(t)?.innateTechs?.includes(id) || (s === u.seat && u.typeId === t && u.techs.includes(id)) || c.units.some((o) => o.seat === s && o.typeId === t && o.techs.includes(id)),
                            types: T,
                            leveling,
                            lifeline: true,
                        }),
                    );
            const est = yearMod.estimateBattle(g('player'), g('enemy'));
            const guess = est.mine > 0 && est.theirs <= 0 ? 1 : est.theirs > 0 && est.mine <= 0 ? -1 : est.margin > 0.03 ? 1 : est.margin < -0.03 ? -1 : 0;
            const realSign = c.winner !== 0 ? c.winner : Math.sign(Math.round(c.real * 30));
            if (guess === realSign) agree++;
            const x = est.margin;
            const y = c.real;
            sx += x;
            sy += y;
            sxy += x * y;
            sxx += x * x;
            syy += y * y;
        }
        const n = cases.length;
        const corr = (n * sxy - sx * sy) / Math.sqrt(Math.max(1e-9, (n * sxx - sx * sx) * (n * syy - sy * sy)));
        return { agree: agree / n, corr, score: agree / n + 0.25 * corr };
    };
    const ranges = {
        frontGap: [0, 80],
        depthScale: [0, 8],
        structureExposure: [0, 1],
        engagedDensity: [0, 3],
        areaReach: [0.2, 3],
        convertValue: [0.5, 4],
        shieldPass: [0.2, 1],
        deadZoneKeep: [0.1, 1],
        corrode: [1, 1.6],
        spawnShare: [0, 1.5],
        closingShare: [0, 1],
        spreadMiss: [0, 0.4],
        overkill: [1, 3],
    };
    let best = { ...MODEL };
    let bestEval = evaluate();
    console.log(`start: agree ${(bestEval.agree * 100).toFixed(1)}% corr ${bestEval.corr.toFixed(3)}`);
    const rng = mulberry32(12345);
    for (let i = 0; i < iterations; i++) {
        const trial = { ...best };
        const keys = Object.keys(ranges);
        const changes = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < changes; k++) {
            const key = keys[Math.floor(rng() * keys.length)];
            const [lo, hi] = ranges[key];
            const span = (hi - lo) * (i < iterations / 3 ? 0.5 : 0.12);
            trial[key] = Math.max(lo, Math.min(hi, best[key] + (rng() * 2 - 1) * span));
        }
        Object.assign(MODEL, trial);
        const e = evaluate();
        if (e.score > bestEval.score) {
            best = trial;
            bestEval = e;
            console.log(`  #${i} agree ${(e.agree * 100).toFixed(1)}% corr ${e.corr.toFixed(3)}`);
        }
    }
    Object.assign(MODEL, best);
    console.log('best', JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))));
}

const planTimes = [];
const aiPlanner = {};
{
    // --planner techWeight=0,counterWeight=0.5 — try planner choices without editing code
    // planner keys go to the AI seat only; model keys change the shared battle model
    const overrides = arg('planner', '');
    if (overrides) {
        const { PLANNER, MODEL } = await load('/src/game/aiYear.ts');
        for (const pair of overrides.split(',')) {
            const [k, v] = pair.split('=');
            if (k in PLANNER) aiPlanner[k] = Number(v);
            else if (k in MODEL) MODEL[k] = Number(v);
            else throw new Error(`unknown planner/model key ${k}`);
        }
    }
}
const games = Number(arg('games', '6'));
const rounds = Number(arg('rounds', '9'));
const baseSeed = Number(arg('seed', '1'));
const variantArg = arg('variant', 'all');
const brains = { ai: arg('ai', 'year'), human: arg('human', 'classic') };
const verbose = flag('verbose');
const variants = variantArg === 'all' ? Object.keys(VARIANTS) : [variantArg];
const t0 = Date.now();
try {
    if (flag('collect')) {
        await collect(arg('cache', 'arena-cases.json'));
        process.exit(0);
    }
    if (flag('tune')) {
        await tune(arg('cache', 'arena-cases.json'), Number(arg('iterations', '1500')));
        process.exit(0);
    }
    if (flag('duels')) {
        await duels(Number(arg('budget', '800')));
        process.exit(0);
    }
    for (const variant of variants) {
        let aiRounds = 0;
        let total = 0;
        const perRound = Array(rounds).fill(0);
        for (let g = 0; g < games; g++) {
            if (verbose) console.log(`${variant} game ${g + 1}`);
            const res = playYear(variant, baseSeed * 1000 + g, brains, rounds, verbose);
            res.forEach((humanWins, i) => {
                if (!humanWins) {
                    aiRounds++;
                    perRound[i]++;
                }
                total++;
            });
        }
        console.log(
            `${variant.padEnd(14)} ai=${brains.ai} human=${brains.human}: AI won ${aiRounds}/${total} rounds (${Math.round((100 * aiRounds) / total)}%) · per round ${perRound.join(' ')}`,
        );
    }
    if (planTimes.length) {
        const sorted = [...planTimes].sort((a, b) => a - b);
        console.log(`AI build phase: median ${sorted[Math.floor(sorted.length / 2)].toFixed(0)}ms, max ${sorted[sorted.length - 1].toFixed(0)}ms`);
    }
    console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} catch (e) {
    console.error(e);
    process.exitCode = 1;
} finally {
    await server.close();
}
