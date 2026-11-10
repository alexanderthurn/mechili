/**
 * The battle lab: armies and formations made up from the shop, fought out
 * by the real BattleSim with nothing else on the board (no buildings, walls,
 * spells or techs — the packs, their mix, their levels and where they stand).
 * `npm run lab` (scripts/battle-lab.mjs) fights thousands of them and
 * writes what it learned to aiLearned.ts; the Learner (aiThink) starts its
 * rough look from those mixes.
 */

import { Vector3 } from 'three';
import { BattleSim } from './sim';
import { buildHpDrawSources } from './hpDraw';
import { levelBasisOf, Unit, type UnitType } from './units';
import { CELL, mulberry32 } from './map';
import type { TypeRegistry } from './content/typeRegistry';
import type { LevelingSettings, TowerSettings } from './settings';

/** one pack of a lab army */
export interface LabPack {
    typeId: string;
    level: number;
}

/** how a lab army stands */
export type LabFormation = 'line' | 'block' | 'flanks' | 'back' | 'sorted' | 'left';
export const LAB_FORMATIONS: readonly LabFormation[] = ['line', 'block', 'flanks', 'back', 'sorted', 'left'];

/** a learned army mix: shares of the supply by unit type, and how it stands */
export interface LearnedMix {
    budget: number;
    formation: LabFormation;
    shares: Record<string, number>;
    /** its mean margin against the lab's panel (share of the budget) */
    score: number;
}

/** what the lab writes for the Learner */
export interface LearnedData {
    /** the unit stats it learned from (see {@link labContentHash}) */
    hash: string;
    generated: string;
    battles: number;
    /** per unit type: what spending on it is worth against the average spend (+ better) */
    unitValue: Record<string, number>;
    /** attacker type → defender type: mean margin of a mono army of one against the other (equal supply) */
    counters: Record<string, Record<string, number>>;
    /** formation → mean margin against the others, same army */
    formations: Record<string, number>;
    mixes: LearnedMix[];
}

/** the packs the lab buys: the normal shop's fighting units */
export function labPool(types: TypeRegistry): UnitType[] {
    const shop = types.shopFor(null);
    return types.roster.filter((t) => shop.includes(t.id) && !t.extra && !t.structure && !t.wall && t.damage > 0 && t.target !== false);
}

/** a fingerprint of the numbers the lab's results stand on: change a unit and it no longer matches */
export function labContentHash(types: TypeRegistry): string {
    const parts = labPool(types).map((t) =>
        [t.id, t.cost, t.hp, t.damage, t.range, t.speed, t.attackInterval, t.splashRadius ?? 0, t.projectileCount ?? 1, t.flying ?? 0, t.formation.cols * t.formation.rows].join(':'),
    );
    let h = 2166136261;
    for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h.toString(16).padStart(8, '0');
}

/** what a pack of `type` at `level` costs: its price and a level's price per level above 1 */
export function labPackCost(type: UnitType, level: number, leveling: Pick<LevelingSettings, 'levelCostFactor'>): number {
    return type.cost + Math.round(levelBasisOf(type) * leveling.levelCostFactor) * (level - 1);
}

/**
 * A random army for `budget`: packs picked by `weight` (all alike when
 * omitted), now and then a level or two up, until no more fits (at most 14 packs).
 */
export function randomLabArmy(
    pool: readonly UnitType[],
    budget: number,
    rng: () => number,
    leveling: Pick<LevelingSettings, 'levelCostFactor'>,
    weight?: (t: UnitType) => number,
): LabPack[] {
    const out: LabPack[] = [];
    let left = budget;
    const w = (t: UnitType) => (weight ? Math.max(0, weight(t)) : 1);
    for (let guard = 0; guard < 40 && out.length < 14; guard++) {
        const fits = pool.filter((t) => t.cost <= left && w(t) > 0);
        if (fits.length === 0) break;
        let r = rng() * fits.reduce((s, t) => s + w(t), 0);
        let type = fits[0]!;
        for (const t of fits) {
            r -= w(t);
            if (r <= 0) {
                type = t;
                break;
            }
        }
        let level = 1;
        while (level < 3 && rng() < 0.25 && labPackCost(type, level + 1, leveling) <= left) level++;
        left -= labPackCost(type, level, leveling);
        out.push({ typeId: type.id, level });
    }
    return out;
}

/** supply share per type of an army */
export function labShares(army: readonly LabPack[], types: TypeRegistry, leveling: Pick<LevelingSettings, 'levelCostFactor'>): Record<string, number> {
    const spend: Record<string, number> = {};
    let total = 0;
    for (const p of army) {
        const c = labPackCost(types.require(p.typeId), p.level, leveling);
        spend[p.typeId] = (spend[p.typeId] ?? 0) + c;
        total += c;
    }
    for (const k of Object.keys(spend)) spend[k] = spend[k]! / Math.max(1, total);
    return spend;
}

/** the lab board: half-width of the field the packs stand on, and the front / back rows of a side (world z, from the middle) */
const FIELD_HALF_W = 100;
const FRONT_Z = 30;
const BACK_Z = 110;

/** where each pack of `army` stands for `formation`, on the side whose z is `sign` × positive */
function positions(army: readonly LabPack[], types: TypeRegistry, formation: LabFormation, sign: 1 | -1): { x: number; z: number }[] {
    const size = (p: LabPack) => {
        const t = types.require(p.typeId);
        return Math.max(t.footprint.cols, t.footprint.rows) * CELL + 2;
    };
    const step = Math.max(12, ...army.map(size));
    const row = (packs: number[], z: number, x0: number, x1: number, out: { x: number; z: number }[]) => {
        const perRow = Math.max(1, Math.floor((x1 - x0) / step) + 1);
        packs.forEach((i, k) => {
            const r = Math.floor(k / perRow);
            const inRow = Math.min(perRow, packs.length - r * perRow);
            const c = k % perRow;
            const span = (inRow - 1) * step;
            const mid = (x0 + x1) / 2;
            out[i] = { x: mid - span / 2 + c * step, z: z + r * step };
        });
    };
    const out: { x: number; z: number }[] = [];
    const all = army.map((_, i) => i);
    const ranged = (i: number) => types.require(army[i]!.typeId).range >= 10;
    switch (formation) {
        case 'line':
            row(all, FRONT_Z, -FIELD_HALF_W, FIELD_HALF_W, out);
            break;
        case 'back':
            row(all, BACK_Z - step * Math.ceil(army.length / 8), -FIELD_HALF_W, FIELD_HALF_W, out);
            break;
        case 'block':
            row(all, FRONT_Z + 10, -2 * step, 2 * step, out);
            break;
        case 'left':
            row(all, FRONT_Z + 10, -FIELD_HALF_W, -FIELD_HALF_W + 3 * step, out);
            break;
        case 'flanks':
            row(all.filter((i) => i % 2 === 0), FRONT_Z + 10, -FIELD_HALF_W, -FIELD_HALF_W + 2 * step, out);
            row(all.filter((i) => i % 2 === 1), FRONT_Z + 10, FIELD_HALF_W - 2 * step, FIELD_HALF_W, out);
            break;
        case 'sorted':
            row(all.filter((i) => !ranged(i)), FRONT_Z, -FIELD_HALF_W, FIELD_HALF_W, out);
            row(all.filter(ranged), FRONT_Z + 3 * step, -FIELD_HALF_W, FIELD_HALF_W, out);
            break;
    }
    return out.map((p) => ({ x: p.x, z: sign * Math.min(BACK_Z + 40, p.z) }));
}

/** one pack's part in a lab battle */
export interface LabPackResult {
    typeId: string;
    level: number;
    /** 'a' or 'b' */
    side: 'a' | 'b';
    spent: number;
    damageDealt: number;
    alive: boolean;
}

export interface LabResult {
    /** HP damage A dealt minus what it took, as a share of the budget-ish scale (raw) */
    margin: number;
    damageToA: number;
    damageToB: number;
    seconds: number;
    packs: LabPackResult[];
}

/**
 * A against B: A stands on the near side (the player's), B on the far side.
 * The margin is the HP damage A dealt minus what it took (the game's own
 * end-of-battle count).
 */
export function labBattle(
    types: TypeRegistry,
    settings: { towers: TowerSettings; leveling: LevelingSettings },
    a: readonly LabPack[],
    b: readonly LabPack[],
    formationA: LabFormation,
    formationB: LabFormation,
    battleSeconds = 90,
): LabResult {
    let id = 1;
    const units: Unit[] = [];
    const sides: { unit: Unit; pack: LabPack; side: 'a' | 'b' }[] = [];
    const place = (army: readonly LabPack[], formation: LabFormation, side: 'a' | 'b') => {
        const sign = side === 'a' ? -1 : 1;
        const spots = positions(army, types, formation, sign);
        army.forEach((pack, i) => {
            const type = types.require(pack.typeId);
            const at = spots[i]!;
            const u = new Unit(type, { col: 0, row: 0 }, side === 'a' ? 'player' : 'enemy', new Vector3(at.x, 0, at.z));
            u.id = id++;
            u.seat = side === 'a' ? 0 : 1;
            u.level = pack.level;
            u.facing = side === 'a' ? 0 : Math.PI;
            u.setDeployment(false);
            units.push(u);
            sides.push({ unit: u, pack, side });
        });
    };
    place(a, formationA, 'a');
    place(b, formationB, 'b');
    const sim = new BattleSim(units, {
        towers: settings.towers,
        leveling: settings.leveling,
        battleSeconds,
        seatRank: (seat) => seat,
        costOf: (type) => type.cost,
        statsOf: (u) => ({
            hp: u.type.hp,
            damage: u.type.damage,
            range: u.type.range,
            minRange: u.type.minRange ?? 0,
            speed: u.type.speed,
            attackInterval: u.type.attackInterval,
            projectileCount: u.type.projectileCount ?? 1,
            splashRadius: u.type.splashRadius ?? 0,
        }),
        hasTech: (_seat, typeId, techId) => !!types.byId(typeId)?.innateTechs?.includes(techId),
        flankSpawnSeconds: 0,
        flankSpawnMult: () => 1,
        needsFlankSpawn: () => false,
        boardHalfW: 160,
        boardHalfZ: 156,
        loadoutOf: () => undefined,
        types,
        strongholdLifeline: false,
    });
    for (let guard = Math.ceil(battleSeconds / 0.25) + 400; !sim.finished && guard > 0; guard--) {
        sim.update(0.25);
        sim.consumeEvents();
    }
    const hp = buildHpDrawSources(sim);
    const aliveIds = new Set(sim.actors.filter((x) => x.alive).map((x) => x.unit.id));
    return {
        margin: hp.damageToEnemy - hp.damageToPlayer,
        damageToA: hp.damageToPlayer,
        damageToB: hp.damageToEnemy,
        seconds: sim.elapsed,
        packs: sides.map(({ unit, pack, side }) => ({
            typeId: pack.typeId,
            level: pack.level,
            side,
            spent: labPackCost(unit.type, pack.level, settings.leveling),
            damageDealt: unit.damageDealt,
            alive: aliveIds.has(unit.id),
        })),
    };
}

/** a seeded stream for the lab's script */
export const labRng = (seed: number) => mulberry32(seed >>> 0);
