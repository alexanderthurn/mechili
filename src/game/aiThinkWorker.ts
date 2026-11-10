/**
 * The AI's plan worker (aiThink): rebuilds a plan's board from plain data
 * and fights it out with the real BattleSim — no rendering, no GLB models
 * (the procedural stand-ins), no spells. Answers with the battle's HP damage.
 */

import './aiThinkShims';
import { Vector3 } from 'three';
import { BattleSim } from './sim';
import { BASE_TYPES, Unit } from './units';
import { buildHpDrawSources } from './hpDraw';
import { CELL, mulberry32, registerSimGroundHeight } from './map';
import { TerrainGrid } from './terrainGrid';
import type { ResolvedStats } from './tech';
import { failed, type ThinkJob, type ThinkResult, type ThinkUnit, type ThinkVariant } from './aiThink';

/** the battle steps it takes at a time */
const STEP = 0.25;

function rebuild(t: ThinkUnit): Unit | null {
    const type = BASE_TYPES.byId(t.typeId);
    if (!type) return null;
    const u = new Unit(type, { ...t.cell }, t.team, new Vector3(...t.world), t.rotated);
    Object.assign(u, t.fields);
    for (let i = 0; i < u.members.length && i * 3 + 2 < t.homes.length; i++) {
        u.members[i]!.home.set(t.homes[i * 3]!, t.homes[i * 3 + 1]!, t.homes[i * 3 + 2]!);
    }
    u.revealed = true;
    u.setDeployment(false);
    u.seatMembers();
    return u;
}

/** the other side's packs that walk: shifted and doubled in a variant */
function movable(t: ThinkUnit, aiTeam: string): boolean {
    return t.team !== aiTeam && t.team !== 'horde' && t.fields.hostUnitId == null && !t.fields.gridless && !BASE_TYPES.byId(t.typeId)?.structure && !BASE_TYPES.byId(t.typeId)?.extra;
}

/** the job's board as `variant` has it */
function varied(job: ThinkJob, variant: ThinkVariant): ThinkUnit[] {
    if (variant.jitter === 0 && variant.reinforce === 0) return job.units;
    const rng = mulberry32(variant.seed * 0x9e3779b1 + job.units.length);
    const out = job.units.map((t) => {
        if (!movable(t, job.aiTeam) || variant.jitter === 0) return t;
        const dx = (rng() * 2 - 1) * variant.jitter * CELL;
        const dz = (rng() * 2 - 1) * variant.jitter * CELL;
        return { ...t, world: [t.world[0] + dx, t.world[1], t.world[2] + dz] as [number, number, number] };
    });
    // its most valuable packs doubled, two tiles further back
    const value = (t: ThinkUnit) => (BASE_TYPES.byId(t.typeId)?.cost ?? 0) * Math.max(1, Number(t.fields.level) || 1);
    const best = out.filter((t) => movable(t, job.aiTeam)).sort((a, b) => value(b) - value(a)).slice(0, variant.reinforce);
    let id = (1 << 28) + variant.seed * 1000;
    for (const t of best) {
        const back = Math.sign(t.world[2] || 1) * 2 * CELL;
        out.push({ ...t, world: [t.world[0], t.world[1], t.world[2] + back], fields: { ...t.fields, id: id++ } });
    }
    return out;
}

/** one battle: the job's sim setup on `units` */
function fight(job: ThinkJob, list: readonly ThinkUnit[], terrain: TerrainGrid | undefined): { damageToPlayer: number; damageToEnemy: number; elapsed: number; player: number; enemy: number } {
    const stats = new Map<number, ResolvedStats>();
    /** a spawned child's stats: those of a pack of its type and seat on the board */
    const bySeatType = new Map<string, ResolvedStats>();
    const flank = new Set<number>();
    const units: Unit[] = [];
    for (const t of list) {
        const u = rebuild(t);
        if (!u) continue;
        units.push(u);
        stats.set(u.id, t.stats);
        if (!(u.items.length > 0)) bySeatType.set(`${u.seat}:${u.type.id}`, t.stats);
        if (t.flank) flank.add(u.id);
    }
    let childId = 1 << 29;
    const sim = new BattleSim(units, {
        terrain,
        towers: job.towers,
        leveling: job.leveling,
        battleSeconds: job.battleSeconds,
        seatRank: (seat) => job.seatRanks[seat] ?? seat,
        costOf: (type) => job.costs[type.id] ?? type.cost,
        statsOf: (u) =>
            stats.get(u.id) ??
            bySeatType.get(`${u.seat}:${u.type.id}`) ?? {
                hp: u.type.hp,
                damage: u.type.damage,
                range: u.type.range,
                minRange: u.type.minRange ?? 0,
                speed: u.type.speed,
                attackInterval: u.type.attackInterval,
                projectileCount: u.type.projectileCount ?? 1,
                splashRadius: u.type.splashRadius ?? 0,
            },
        hasTech: (seat, typeId, techId) =>
            !!BASE_TYPES.byId(typeId)?.innateTechs?.includes(techId) || (seat >= 0 && !!job.techs[`${seat}:${typeId}`]?.includes(techId)),
        types: BASE_TYPES,
        loadoutOf: (seat) => (seat >= 0 ? job.loadouts[seat] : undefined),
        strongholdLifeline: job.strongholdLifeline,
        flankSpawnSeconds: job.flankSpawnSeconds,
        flankSpawnMult: (seat) => (seat < 0 ? 1 : (job.flankMult[seat] ?? 1)),
        needsFlankSpawn: (u) => flank.has(u.id) && !u.flankSpawnDone,
        boardHalfW: job.boardHalfW,
        boardHalfZ: job.boardHalfZ,
        spawnOnKill: (parent, typeId, x, z) => {
            const type = BASE_TYPES.byId(typeId);
            if (!type) return null;
            const child = new Unit(type, { col: 0, row: 0 }, parent.team, new Vector3(x, 0, z), false);
            child.gridless = true;
            child.seat = parent.seat;
            child.id = childId++;
            child.summoned = true;
            child.level = parent.level;
            child.setDeployment(false);
            return child;
        },
    });
    let guard = Math.ceil(job.battleSeconds / STEP) + 400;
    while (!sim.finished && guard-- > 0) {
        sim.update(STEP);
        sim.consumeEvents();
    }
    const hp = buildHpDrawSources(sim);
    const alive = (team: string) => sim.actors.filter((a) => a.alive && a.unit.team === team && !a.unit.type.structure).length;
    return { damageToPlayer: hp.damageToPlayer, damageToEnemy: hp.damageToEnemy, elapsed: sim.elapsed, player: alive('player'), enemy: alive('enemy') };
}

function run(job: ThinkJob): ThinkResult {
    const t0 = performance.now();
    let terrain: TerrainGrid | undefined;
    if (job.terrain) {
        terrain = new TerrainGrid(job.terrain);
        terrain.heights.set(job.terrain.heights);
        const grid = terrain;
        registerSimGroundHeight((x, z) => grid.sample(x, z));
    } else {
        registerSimGroundHeight(() => 0);
    }
    const base = terrain ? terrain.heights.slice() : null;
    const results = job.variants.map((v) => {
        // every battle on the ground as it stood (a battle's craters stay in its own)
        if (terrain && base) terrain.heights.set(base);
        return fight(job, varied(job, v), terrain);
    });
    const mean = (f: (r: (typeof results)[number]) => number) => results.reduce((sum, r) => sum + f(r), 0) / Math.max(1, results.length);
    return {
        id: job.id,
        ok: true,
        variants: results.map((r) => ({ damageToPlayer: r.damageToPlayer, damageToEnemy: r.damageToEnemy })),
        damageToPlayer: Math.round(mean((r) => r.damageToPlayer)),
        damageToEnemy: Math.round(mean((r) => r.damageToEnemy)),
        battleTime: mean((r) => r.elapsed),
        ms: performance.now() - t0,
        survivors: { player: Math.round(mean((r) => r.player)), enemy: Math.round(mean((r) => r.enemy)) },
    };
}

self.onmessage = (e: MessageEvent<ThinkJob>) => {
    let result: ThinkResult;
    try {
        result = run(e.data);
    } catch (err) {
        result = failed(e.data.id, err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
    }
    (self as unknown as Worker).postMessage(result);
};
