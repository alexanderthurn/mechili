/**
 * The AI's counter table (AI_PLAN.md, "Counter table"): for each unit, the
 * units that are good against it — worked out by rules from the unit data,
 * so new units are covered without a list. Hard uses it next to its battle
 * model: a unit that answers what the enemy fields, and that its own army
 * doesn't answer yet, scores higher.
 */
import type { TypeRegistry } from './content/typeRegistry';
import type { UnitType } from './units';

/** unit id → the unit ids that are good against it */
export type CounterTable = ReadonlyMap<string, readonly string[]>;

/** 10+ models per pack: a swarm */
const SWARM_FROM = 10;
/** a splash (or cleave, or beam splash) this wide answers swarms */
const SPLASH_FROM = 3;
/** this much HP per model: a tank */
const TANK_FROM = 1000;
/** this much damage per hit: a big hitter (as are ramping beams and convert rays) */
const BIG_HIT_FROM = 300;

interface Traits {
    flies: boolean;
    hitsAir: boolean;
    hitsGround: boolean;
    swarm: boolean;
    single: boolean;
    /** big hits: wasted on swarms, the answer to tanks */
    bigHitter: boolean;
    /** wide splash without big hits: the answer to swarms */
    splash: boolean;
    tank: boolean;
    range: number;
}

function traitsOf(t: UnitType): Traits {
    const models = t.formation.cols * t.formation.rows;
    const splashR = Math.max(t.splashRadius ?? 0, t.cleave?.radius ?? 0, t.rampBeam?.splashRadius ?? 0);
    const bigHitter = t.damage >= BIG_HIT_FROM || !!t.rampBeam || !!t.convertRay;
    return {
        flies: !!t.flying,
        hitsAir: t.targets.air,
        hitsGround: t.targets.ground,
        swarm: models >= SWARM_FROM,
        single: models === 1,
        bigHitter,
        splash: splashR >= SPLASH_FROM && !bigHitter,
        tank: t.hp >= TANK_FROM,
        range: t.range,
    };
}

/**
 * How strongly `y` counters `x` (0 = not): 2 for the air rules, 1 for the rest.
 * - A: x can't hit air, y flies.
 * - B: x flies, y hits air — against a flying swarm only a splash or a swarm.
 * - C: x is a swarm, y has splash.
 * - D: x is a single model without splash, and not a tank without big hits; y is a swarm.
 * - E: x has splash; y is a single model that outranges it or is a tank.
 * - F: x is a tank; y is a big hitter.
 * y must be able to hit x at all.
 */
function counterStrength(x: Traits, y: Traits): number {
    if (!(x.flies ? y.hitsAir : y.hitsGround)) return 0;
    if (!x.hitsAir && y.flies) return 2;
    if (x.flies && (!x.swarm || y.splash || y.swarm)) return 2;
    if (x.swarm && y.splash) return 1;
    if (x.single && !x.splash && (!x.tank || x.bigHitter) && y.swarm) return 1;
    if (x.splash && y.single && (y.range > x.range || y.tank)) return 1;
    if (x.tank && y.bigHitter) return 1;
    return 0;
}

/** the units that fight in battle: no buildings, walls, extras or harmless units */
function fighter(t: UnitType): boolean {
    return !t.structure && !t.extra && !t.wall && !t.fixture && t.target !== false && t.damage > 0;
}

const tables = new WeakMap<TypeRegistry, CounterTable>();

/**
 * The counter table for a match's unit types. Where two units would counter
 * each other, the stronger rule wins; on a tie neither counts.
 */
export function counterTable(types: TypeRegistry): CounterTable {
    const known = tables.get(types);
    if (known) return known;
    const units = [...types.all()].filter(fighter).map((t) => ({ id: t.id, traits: traitsOf(t) }));
    const table = new Map<string, string[]>();
    for (const x of units) {
        const ids: string[] = [];
        for (const y of units) {
            if (y.id === x.id) continue;
            const s = counterStrength(x.traits, y.traits);
            if (s > 0 && s > counterStrength(y.traits, x.traits)) ids.push(y.id);
        }
        table.set(x.id, ids);
    }
    tables.set(types, table);
    return table;
}

/** an army by unit id: value (cost × level) per type */
export type ArmyValue = ReadonlyMap<string, number>;

/**
 * How much of the enemy's army a unit of `typeId` answers that its own army
 * doesn't answer yet, 0…1 of the enemy's value: for every enemy unit type
 * that `typeId` counters, its value less what the own army already fields of
 * that type's counters.
 */
export function missingCounterShare(typeId: string, enemy: ArmyValue, own: ArmyValue, table: CounterTable): number {
    let total = 0;
    for (const v of enemy.values()) total += v;
    if (total <= 0) return 0;
    let missing = 0;
    for (const [enemyType, value] of enemy) {
        const counters = table.get(enemyType);
        if (!counters?.includes(typeId)) continue;
        let answered = 0;
        for (const c of counters) answered += own.get(c) ?? 0;
        missing += Math.max(0, value - answered);
    }
    return missing / total;
}
