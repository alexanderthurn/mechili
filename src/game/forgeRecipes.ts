/**
 * Stronghold forge: shared 3-slot oven per side. Multiset recipes → one spell
 * next deploy (best / largest match); unused runes refund to their inserters.
 *
 * One recipe per spell. Singles are weak experiments; stronger spells use
 * mixed rune pairs / a triple — not stacks of the same rune.
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
    SPAWN_CROWS_ID,
    SPAWN_DWARVES_ID,
    STORM_ID,
    TACTICS,
} from './tactics';
import { ITEMS } from './items';
import { DISPLAY } from './displayNames';

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
 * One recipe per spell. Size dominates match (3 > 2 > 1); leftovers refund.
 * Sell / Rally are not forgeable (come from buildings / cards).
 *
 * Runes: addi=Valor, power=Carnage, vigor=Giant Blood, colossus=Mithril,
 * wrath=Berserk, golden=Sunstone.
 */
export const FORGE_RECIPES: ForgeRecipe[] = [
    // --- singles (weak) ---
    { ingredients: ['addi'], tacticId: OIL_SPILL_ID, priority: 1 },
    { ingredients: ['power'], tacticId: SPAWN_DWARVES_ID, priority: 1 },
    { ingredients: ['vigor'], tacticId: POISON_CLOUD_ID, priority: 1 },
    { ingredients: ['colossus'], tacticId: SPAWN_CROWS_ID, priority: 1 },
    { ingredients: ['wrath'], tacticId: ACID_ID, priority: 1 },
    { ingredients: ['golden'], tacticId: FIRE_SPILL_ID, priority: 1 },

    // --- mixed pairs ---
    { ingredients: ['vigor', 'colossus'], tacticId: STORM_ID, priority: 1 }, // Giant Blood + Mithril
    { ingredients: ['addi', 'colossus'], tacticId: BIG_METEOR_ID, priority: 1 }, // Valor + Mithril
    { ingredients: ['wrath', 'golden'], tacticId: METEOR_SHOWER_ID, priority: 1 }, // Berserk + Sunstone

    // --- mixed triples ---
    { ingredients: ['addi', 'colossus', 'golden'], tacticId: HAMMER_ID, priority: 1 }, // Valor + Mithril + Sunstone
    { ingredients: ['wrath', 'power', 'golden'], tacticId: DRAGON_ID, priority: 1 }, // Berserk + Carnage + Sunstone
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

/** true when every count in `have` is ≤ the corresponding count in `need` */
function isMultisetSubset(have: Map<string, number>, need: Map<string, number>): boolean {
    for (const [id, n] of have) {
        if ((need.get(id) ?? 0) < n) return false;
    }
    return true;
}

export interface ForgeDragPreview {
    /** spell that would bake if the oven burned now (with optional add) */
    bakeTacticId: string | null;
    /** larger recipes still reachable — each with runes still needed */
    paths: { tacticId: string; missingItemIds: string[] }[];
}

/** HUD-ready icons for {@link forgeOvenPreview} */
export interface ForgePreviewView {
    bakeIcon: string | null;
    paths: { spellIcon: string; missingIcons: string[] }[];
}

/** item ids still required to complete `need` given `have` (one entry per missing copy) */
function missingIngredients(
    have: Map<string, number>,
    need: Map<string, number>,
): string[] {
    const missing: string[] = [];
    for (const [id, n] of need) {
        const short = n - (have.get(id) ?? 0);
        for (let i = 0; i < short; i++) missing.push(id);
    }
    return missing;
}

/**
 * Bake + reachable paths for the current oven, optionally as if `addingItemId`
 * were inserted (drag-over preview).
 */
export function forgeOvenPreview(
    ovenItemIds: readonly string[],
    addingItemId?: string | null,
): ForgeDragPreview {
    let next = [...ovenItemIds];
    if (addingItemId) {
        if (next.length >= FORGE_SLOT_COUNT) {
            return { bakeTacticId: null, paths: [] };
        }
        next.push(addingItemId);
    }
    if (next.length === 0) {
        return { bakeTacticId: null, paths: [] };
    }
    const slots: ForgeSlot[] = next.map((itemId) => ({
        itemId,
        seat: 0 as SeatId,
        round: 0,
    }));
    const bakeTacticId = resolveForge(slots).tacticId;
    const have = countMultiset(next);
    const paths: ForgeDragPreview['paths'] = [];
    for (const recipe of FORGE_RECIPES) {
        if (recipe.ingredients.length <= next.length) continue;
        if (recipe.tacticId === bakeTacticId) continue;
        const need = countMultiset(recipe.ingredients);
        if (!isMultisetSubset(have, need)) continue;
        paths.push({
            tacticId: recipe.tacticId,
            missingItemIds: missingIngredients(have, need),
        });
    }
    return { bakeTacticId, paths };
}

/** Preview while dragging a rune onto the forge. */
export function forgeDragPreview(
    ovenItemIds: readonly string[],
    addingItemId: string,
): ForgeDragPreview {
    return forgeOvenPreview(ovenItemIds, addingItemId);
}

/** Icon view for drag ghost / forge-slot hover. */
export function forgePreviewView(
    ovenItemIds: readonly string[],
    addingItemId?: string | null,
): ForgePreviewView {
    const preview = forgeOvenPreview(ovenItemIds, addingItemId);
    return {
        bakeIcon: preview.bakeTacticId
            ? (TACTICS[preview.bakeTacticId]?.icon ?? null)
            : null,
        paths: preview.paths.map((p) => ({
            spellIcon: TACTICS[p.tacticId]?.icon ?? '?',
            missingIcons: p.missingItemIds
                .map((id) => ITEMS[id]?.icon)
                .filter((id): id is string => !!id),
        })),
    };
}

/**
 * Short HUD blurb for the Stronghold details pane.
 * @param when `next` = oven still cooking for the following deploy;
 *   `this` = fogged/intel view of what already burned at this deploy's start.
 */
export function forgeHintText(
    slots: readonly (ForgeSlot | null)[],
    when: 'next' | 'this' = 'next',
): string {
    const filled = slots.filter((s): s is ForgeSlot => !!s);
    const whenLabel = when === 'this' ? 'This deploy' : 'Next deploy';
    if (filled.length === 0) {
        return (
            `Slot up to ${FORGE_SLOT_COUNT} runes. Next deploy they burn into one spell ` +
            `(best match); unused runes return to their owners' bags.`
        );
    }
    const result = resolveForge(slots);
    const tactic = result.tacticId ? TACTICS[result.tacticId] : null;
    if (!tactic) {
        return when === 'this'
            ? 'No matching recipe — all runes returned to their owners this deploy.'
            : 'No matching recipe — all runes return to their owners next deploy.';
    }
    const parts = result.consumed.map((c) => ITEMS[c.itemId]?.name ?? c.itemId);
    const recipeLabel = summarizeMultiset(parts);
    let text = `${whenLabel}: ${tactic.name} (${recipeLabel}).`;
    if (result.refunds.length > 0) {
        const back = summarizeMultiset(result.refunds.map((r) => ITEMS[r.itemId]?.name ?? r.itemId));
        text +=
            when === 'this'
                ? ` Leftover ${back} returned to bag.`
                : ` Leftover ${back} return to bag.`;
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

export interface ForgeHelpRow {
    /** rune item ids (for matching against the oven) */
    ingredients: string[];
    ingredientIcons: string[];
    spellIcon: string;
    spellName: string;
    spellDesc: string;
}

function helpRow(recipe: ForgeRecipe): ForgeHelpRow | null {
    const tactic = TACTICS[recipe.tacticId];
    if (!tactic) return null;
    const icons = recipe.ingredients
        .map((id) => ITEMS[id]?.icon)
        .filter((id): id is string => !!id);
    return {
        ingredients: [...recipe.ingredients],
        ingredientIcons: icons,
        spellIcon: tactic.icon,
        spellName: tactic.name,
        spellDesc: tactic.description,
    };
}

/** Flat recipe list for the forge help overlay (one row per spell). */
export function forgeHelpRows(): ForgeHelpRow[] {
    const rows: ForgeHelpRow[] = [];
    for (const recipe of FORGE_RECIPES) {
        const row = helpRow(recipe);
        if (row) rows.push(row);
    }
    return rows;
}

export function forgeHowItWorksNote(): string {
    return (
        `Slot up to ${FORGE_SLOT_COUNT} ${DISPLAY.items.toLowerCase()} in the shared Stronghold forge. ` +
        `Next deploy they burn into one ${DISPLAY.tactic.toLowerCase()} (largest match); ` +
        `leftovers return to their owners. Only you can remove what you inserted this deploy.`
    );
}

/**
 * How well the current oven lines up with a recipe:
 * - ready: oven has every ingredient (could bake this)
 * - partial: oven shares at least one needed rune
 * - none: no overlap
 */
export function forgeRecipeMatch(
    ingredients: readonly string[],
    ovenItemIds: readonly string[],
): 'ready' | 'partial' | 'none' {
    if (ovenItemIds.length === 0) return 'none';
    const have = countMultiset([...ovenItemIds]);
    const need = countMultiset([...ingredients]);
    if (recipeFits(need, have)) return 'ready';
    for (const [id] of need) {
        if ((have.get(id) ?? 0) > 0) return 'partial';
    }
    return 'none';
}

/** One forge path shown on a between-round rune card. */
export interface RuneCardForgeRow {
    spellIcon: string;
    spellName: string;
    /** every ingredient owned once this card is taken */
    ready: boolean;
    ingredients: { itemId: string; icon: string; owned: boolean }[];
}

/**
 * Forge recipes that use `runeId`, with ownership marks as if the player
 * already held `ownedItemIds` plus this rune (the card being offered).
 */
export function forgeRecipesForRuneCard(
    runeId: string,
    ownedItemIds: readonly string[] = [],
): RuneCardForgeRow[] {
    if (!ITEMS[runeId]) return [];
    const have = countMultiset([...ownedItemIds, runeId]);
    const rows: RuneCardForgeRow[] = [];
    for (const recipe of FORGE_RECIPES) {
        if (!recipe.ingredients.includes(runeId)) continue;
        const tactic = TACTICS[recipe.tacticId];
        if (!tactic) continue;
        const pool = new Map(have);
        const ingredients = recipe.ingredients.map((id) => {
            const icon = ITEMS[id]?.icon ?? '?';
            const n = pool.get(id) ?? 0;
            const owned = n > 0;
            if (owned) pool.set(id, n - 1);
            return { itemId: id, icon, owned };
        });
        rows.push({
            spellIcon: tactic.icon,
            spellName: tactic.name,
            ready: ingredients.every((ing) => ing.owned),
            ingredients,
        });
    }
    rows.sort((a, b) => a.ingredients.length - b.ingredients.length);
    return rows;
}
