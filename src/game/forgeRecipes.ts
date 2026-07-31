/**
 * Stronghold forge: shared 3-slot oven per side. Multiset recipes → one spell
 * next deploy (best / largest match); unused runes refund to their inserters.
 *
 * Recipes are arbitrary multisets — 1×, 2× same, 3× same, or mixes like
 * 2× A + 1× B. Singles cover weak spells; larger recipes cover the rest.
 * Tweak {@link FORGE_RECIPES} freely; the matcher does not care about shape.
 */
import type { SeatId } from './seats';
import {
    ACID_ID,
    BIG_METEOR_ID,
    DRAGON_ID,
    FIRE_SPILL_ID,
    HAMMER_ID,
    METEOR_SHOWER_ID,
    OIL_SPILL_ID,
    POISON_CLOUD_ID,
    RALLY_ROUTE_ID,
    SELL_UNIT_ID,
    SPAWN_CROWS_ID,
    SPAWN_DWARVES_ID,
    STORM_ID,
    TACTICS,
} from './tactics';
import { ITEMS } from './items';

export const FORGE_SLOT_COUNT = 3;

export interface ForgeSlot {
    itemId: string;
    /** who inserted — only they may remove / receive refunds */
    seat: SeatId;
    /** deploy round of insert — removable only while this is the current round */
    round: number;
}

export interface ForgeRecipe {
    /** multiset of rune ids (order irrelevant) */
    ingredients: string[];
    tacticId: string;
    /** tie-break among same-size matches (higher wins) */
    priority: number;
}

/** one empty tray */
export function emptyForgeSlots(): (ForgeSlot | null)[] {
    return Array.from({ length: FORGE_SLOT_COUNT }, () => null);
}

/**
 * Experimental v1 table — tweak freely.
 * Any multiset works (order irrelevant). Size dominates match order (3 > 2 > 1);
 * same size → higher {@link ForgeRecipe.priority}; leftovers refund.
 */
export const FORGE_RECIPES: ForgeRecipe[] = [
    // --- singles (weak) — every rune yields something ---
    { ingredients: ['addi'], tacticId: OIL_SPILL_ID, priority: 1 },
    { ingredients: ['power'], tacticId: SELL_UNIT_ID, priority: 1 },
    { ingredients: ['vigor'], tacticId: RALLY_ROUTE_ID, priority: 1 },
    { ingredients: ['colossus'], tacticId: SPAWN_CROWS_ID, priority: 1 },
    { ingredients: ['wrath'], tacticId: ACID_ID, priority: 1 },
    { ingredients: ['golden'], tacticId: FIRE_SPILL_ID, priority: 1 },

    // --- doubles (same rune) ---
    { ingredients: ['addi', 'addi'], tacticId: SPAWN_DWARVES_ID, priority: 1 },
    { ingredients: ['power', 'power'], tacticId: POISON_CLOUD_ID, priority: 1 },
    { ingredients: ['vigor', 'vigor'], tacticId: STORM_ID, priority: 1 },
    { ingredients: ['colossus', 'colossus'], tacticId: BIG_METEOR_ID, priority: 1 },
    { ingredients: ['wrath', 'wrath'], tacticId: METEOR_SHOWER_ID, priority: 1 },
    { ingredients: ['golden', 'golden'], tacticId: HAMMER_ID, priority: 1 },

    // --- triples: 3× same OR mixed 2+1 — all craft dragon for now ---
    { ingredients: ['addi', 'addi', 'addi'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['power', 'power', 'power'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['vigor', 'vigor', 'vigor'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['colossus', 'colossus', 'colossus'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['wrath', 'wrath', 'wrath'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['golden', 'golden', 'golden'], tacticId: DRAGON_ID, priority: 1 },
    // mixed examples (2× + 1×) — same matcher, just different ingredients
    { ingredients: ['wrath', 'wrath', 'golden'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['power', 'power', 'addi'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['colossus', 'colossus', 'vigor'], tacticId: DRAGON_ID, priority: 1 },
    { ingredients: ['golden', 'golden', 'wrath'], tacticId: DRAGON_ID, priority: 1 },
];

export interface ForgeResolveResult {
    tacticId: string | null;
    /** oven indices consumed by the matched recipe */
    consumed: { index: number; itemId: string; seat: SeatId }[];
    /** runes not used by the recipe — return to inserter bags */
    refunds: { itemId: string; seat: SeatId }[];
}

function countMultiset(ids: string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
}

function recipeFits(need: Map<string, number>, have: Map<string, number>): boolean {
    for (const [id, n] of need) {
        if ((have.get(id) ?? 0) < n) return false;
    }
    return true;
}

/** recipes sorted for best-match: larger first, then higher priority */
function sortedRecipes(): ForgeRecipe[] {
    return [...FORGE_RECIPES].sort((a, b) => {
        if (b.ingredients.length !== a.ingredients.length) {
            return b.ingredients.length - a.ingredients.length;
        }
        return b.priority - a.priority;
    });
}

/**
 * Pick at most one recipe that is a multiset-subset of the oven; leftovers refund.
 */
export function resolveForge(slots: readonly (ForgeSlot | null)[]): ForgeResolveResult {
    const filled: { index: number; itemId: string; seat: SeatId }[] = [];
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s) filled.push({ index: i, itemId: s.itemId, seat: s.seat });
    }
    if (filled.length === 0) {
        return { tacticId: null, consumed: [], refunds: [] };
    }

    const have = countMultiset(filled.map((f) => f.itemId));
    let matched: ForgeRecipe | null = null;
    for (const recipe of sortedRecipes()) {
        const need = countMultiset(recipe.ingredients);
        if (recipeFits(need, have)) {
            matched = recipe;
            break;
        }
    }

    if (!matched) {
        return {
            tacticId: null,
            consumed: [],
            refunds: filled.map(({ itemId, seat }) => ({ itemId, seat })),
        };
    }

    const needLeft = countMultiset(matched.ingredients);
    const consumed: ForgeResolveResult['consumed'] = [];
    const refunds: ForgeResolveResult['refunds'] = [];
    for (const f of filled) {
        const left = needLeft.get(f.itemId) ?? 0;
        if (left > 0) {
            needLeft.set(f.itemId, left - 1);
            consumed.push(f);
        } else {
            refunds.push({ itemId: f.itemId, seat: f.seat });
        }
    }
    return { tacticId: matched.tacticId, consumed, refunds };
}

/** short HUD blurb for the Stronghold details pane */
export function forgeHintText(slots: readonly (ForgeSlot | null)[]): string {
    const filled = slots.filter((s): s is ForgeSlot => !!s);
    if (filled.length === 0) {
        return (
            `Slot up to ${FORGE_SLOT_COUNT} runes. Next deploy they burn into one spell ` +
            `(best match); unused runes return to their owners' bags.`
        );
    }
    const result = resolveForge(slots);
    const tactic = result.tacticId ? TACTICS[result.tacticId] : null;
    if (!tactic) {
        return 'No matching recipe — all runes return to their owners next deploy.';
    }
    const parts = result.consumed.map((c) => ITEMS[c.itemId]?.name ?? c.itemId);
    const recipeLabel = summarizeMultiset(parts);
    let text = `Next deploy: ${tactic.name} (${recipeLabel}).`;
    if (result.refunds.length > 0) {
        const back = summarizeMultiset(result.refunds.map((r) => ITEMS[r.itemId]?.name ?? r.itemId));
        text += ` Leftover ${back} return to bag.`;
    }
    return text;
}

function summarizeMultiset(names: string[]): string {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    return [...counts.entries()]
        .map(([n, c]) => (c > 1 ? `${c}× ${n}` : n))
        .join(' + ');
}
