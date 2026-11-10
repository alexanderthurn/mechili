/**
 * The Learner's archetypes (aiThink's rough look): armies its rules would
 * never buy, and the battle lab's starting mixes (aiLearned) as more of them.
 * AiOpponent builds them (buildArchetype).
 */

import { AI_LEARNED } from './aiLearned';
import { labContentHash, type LabFormation } from './aiLab';
import { isChaff } from './aiCounters';
import { STRONG_FROM } from './aiRoles';
import type { TypeRegistry } from './content/typeRegistry';
import type { UnitType } from './units';

/**
 * A Learner archetype (aiThink's first look): a pool of packs and where they
 * go — `side` −1 / 0 / 1 the lane's low end, middle, high end; `depth` 0 its
 * back row … 1 its front; `spread` how far apart; `recruit` all at level 2.
 */
export interface Archetype {
    name: string;
    pool: (t: UnitType) => boolean;
    side: -1 | 0 | 1;
    depth: number;
    spread: number;
    recruit?: boolean;
    /** how likely each type is picked (all alike when unset) */
    weight?: (t: UnitType) => number;
    /** where the `i`-th pack goes, when not the archetype's own side and depth */
    aim?: (t: UnitType, i: number) => { side: -1 | 0 | 1; depth: number };
}

/** where a battle-lab formation puts a pack (aiLab), in an archetype's terms */
function labAim(formation: LabFormation): Pick<Archetype, 'side' | 'depth' | 'spread' | 'aim'> {
    switch (formation) {
        case 'line':
            return { side: 0, depth: 1, spread: 1 };
        case 'block':
            return { side: 0, depth: 0.75, spread: 0.35 };
        case 'back':
            return { side: 0, depth: 0.1, spread: 1 };
        case 'left':
            return { side: -1, depth: 0.75, spread: 1 };
        case 'flanks':
            return { side: 0, depth: 0.75, spread: 1, aim: (_t, i) => ({ side: i % 2 === 0 ? -1 : 1, depth: 0.75 }) };
        case 'sorted':
            return { side: 0, depth: 0.6, spread: 1, aim: (t) => ({ side: 0, depth: t.range >= 10 ? 0.25 : 1 }) };
    }
}

let learnedStaleWarned = false;

/** one of `list` by `weight` (none when every weight is 0) */
export function weightedPick<T>(list: readonly T[], weight: (t: T) => number, rng: () => number): T | undefined {
    const total = list.reduce((sum, t) => sum + Math.max(0, weight(t)), 0);
    if (total <= 0) return undefined;
    let r = rng() * total;
    for (const t of list) {
        r -= Math.max(0, weight(t));
        if (r <= 0) return t;
    }
    return list[list.length - 1];
}

/** the battle lab's starting mixes (aiLearned) for the budget nearest `supply`, as archetypes */
export function learnedArchetypes(supply: number, types: TypeRegistry): Archetype[] {
    if (!AI_LEARNED) return [];
    if (AI_LEARNED.hash !== labContentHash(types) && !learnedStaleWarned) {
        learnedStaleWarned = true;
        console.warn(`[aiThink] the battle lab's data (${AI_LEARNED.generated}) is from other unit stats — run \`npm run lab\` again; using it anyway`);
    }
    const budgets = [...new Set(AI_LEARNED.mixes.map((m) => m.budget))];
    if (budgets.length === 0) return [];
    const near = budgets.reduce((a, b) => (Math.abs(b - supply) < Math.abs(a - supply) ? b : a));
    return AI_LEARNED.mixes
        .filter((m) => m.budget === near)
        .map((m, k) => ({
            name: `lab mix ${m.budget} #${k + 1} (${m.formation})`,
            pool: (t: UnitType) => (m.shares[t.id] ?? 0) > 0,
            weight: (t: UnitType) => m.shares[t.id] ?? 0,
            ...labAim(m.formation),
        }));
}

export const ARCHETYPES: readonly Archetype[] = [
    { name: 'all air', pool: (t) => !!t.flying, side: 0, depth: 0.6, spread: 0.8 },
    { name: 'all ranged, back', pool: (t) => t.range >= 10, side: 0, depth: 0.1, spread: 0.9 },
    { name: 'melee wall, front', pool: (t) => t.range < 10, side: 0, depth: 1, spread: 1 },
    { name: 'chaff swarm', pool: (t) => isChaff(t), side: 0, depth: 0.9, spread: 1 },
    { name: 'few heavy', pool: (t) => t.cost >= STRONG_FROM, side: 0, depth: 0.5, spread: 0.5 },
    { name: 'splash', pool: (t) => (t.splashRadius ?? 0) > 0, side: 0, depth: 0.3, spread: 0.7 },
    { name: 'low flank', pool: () => true, side: -1, depth: 0.7, spread: 1 },
    { name: 'high flank', pool: () => true, side: 1, depth: 0.7, spread: 1 },
    { name: 'veterans', pool: () => true, side: 0, depth: 0.5, spread: 0.8, recruit: true },
    { name: 'mixed, centre', pool: () => true, side: 0, depth: 0.5, spread: 0.4 },
];

