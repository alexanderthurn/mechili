/**
 * Stronghold forge: shared oven per side. Each player may fill up to
 * {@link FORGE_SLOTS_PER_PLAYER} (duo → up to 6). Exact multiset recipes → one
 * product next deploy; if nothing matches, every rune is refunded.
 *
 * Currently only advanced-rune recipes are active. Ingredient multisets must
 * be unique across the whole table — never the same oven → two different
 * products.
 *
 * Fuel is the four base runes (earth / fire / water / wind).
 * Same-element stacks craft advanced runes (anyone).
 */
import type { SeatId } from './seats';
import {
    MOVE_UNIT_ID,
    SELL_UNIT_ID,
    TUTOR_ID,
    RALLY_ROUTE_ID,
    TACTICS,
} from './tactics';
import { ITEMS } from './items';
import { DISPLAY } from './displayNames';

/** Max runes one player may insert into the shared forge */
export const FORGE_SLOTS_PER_PLAYER = 3;
/** @deprecated alias of {@link FORGE_SLOTS_PER_PLAYER} */
export const FORGE_SLOT_COUNT = FORGE_SLOTS_PER_PLAYER;

export interface ForgeSlot {
    itemId: string;
    /** who inserted — only they may remove / receive refunds */
    seat: SeatId;
    /** deploy round of insert — removable only while this is the current round */
    round: number;
}

/** What the oven yields when a recipe matches. */
export type ForgeProduct =
    | { kind: 'tactic'; id: string }
    | { kind: 'item'; id: string };

export interface ForgeRecipe {
    /** multiset of rune ids (order irrelevant) */
    ingredients: string[];
    product: ForgeProduct;
    /** tie-break among same-size matches (higher wins) */
    priority: number;
}

/** Shared oven size for a side: each seat may fill {@link FORGE_SLOTS_PER_PLAYER}. */
export function forgeTeamCapacity(teamSeatCount: number): number {
    return Math.max(1, teamSeatCount) * FORGE_SLOTS_PER_PLAYER;
}

/** How many oven runes this seat currently owns. */
export function forgeSeatFilledCount(
    oven: readonly (ForgeSlot | null)[],
    seat: SeatId,
): number {
    let n = 0;
    for (const s of oven) {
        if (s && s.seat === seat) n++;
    }
    return n;
}

/** True if this seat may insert another rune (empty tray slot + under personal cap). */
export function forgeSeatCanInsert(
    oven: readonly (ForgeSlot | null)[],
    seat: SeatId,
): boolean {
    if (forgeSeatFilledCount(oven, seat) >= FORGE_SLOTS_PER_PLAYER) return false;
    return oven.some((s) => s === null);
}

/** one empty tray sized for the side (default = solo / per-player size) */
export function emptyForgeSlots(capacity = FORGE_SLOTS_PER_PLAYER): (ForgeSlot | null)[] {
    return Array.from({ length: capacity }, () => null);
}

function item(id: string): ForgeProduct {
    return { kind: 'item', id };
}

/**
 * Rune recipe table — unique ingredient multisets only.
 * Spell recipes removed for now; only advanced runes remain.
 */
export const FORGE_RECIPES: ForgeRecipe[] = [
    // --- advanced runes (anyone) ---
    { ingredients: ['earth', 'earth'], product: item('addi'), priority: 1 }, // Valor
    { ingredients: ['fire', 'fire'], product: item('power'), priority: 1 }, // Carnage
    { ingredients: ['water', 'water'], product: item('vigor'), priority: 1 }, // Giant Blood
    { ingredients: ['wind', 'wind'], product: item('golden'), priority: 1 }, // Sunstone
    { ingredients: ['earth', 'earth', 'earth'], product: item('colossus'), priority: 1 }, // Mithril
    { ingredients: ['fire', 'fire', 'fire'], product: item('wrath'), priority: 1 }, // Berserk
    { ingredients: ['water', 'water', 'water'], product: item('bulwark'), priority: 1 }, // Bulwark
];

function ingredientKey(ingredients: readonly string[]): string {
    const m = countMultiset([...ingredients]);
    return [...m.entries()]
        .sort((a, b) => a[0]!.localeCompare(b[0]!))
        .map(([id, n]) => `${id}:${n}`)
        .join('|');
}

(function assertUniqueIngredientMultisets(): void {
    const seen = new Map<string, ForgeProduct>();
    for (const r of FORGE_RECIPES) {
        const key = ingredientKey(r.ingredients);
        const prev = seen.get(key);
        if (prev) {
            console.error(
                `[forge] duplicate ingredient multiset ${key}:`,
                prev,
                'vs',
                r.product,
            );
        }
        seen.set(key, r.product);
    }
})();

export interface ForgeResolveResult {
    product: ForgeProduct | null;
    /** oven indices consumed by the matched recipe */
    consumed: { index: number; itemId: string; seat: SeatId }[];
    /** runes not used by the recipe — return to inserter bags */
    refunds: { itemId: string; seat: SeatId }[];
}

/** Display icon / name / desc for a forge product. */
export function forgeProductInfo(
    product: ForgeProduct,
): { icon: string; name: string; desc: string } | null {
    if (product.kind === 'tactic') {
        const t = TACTICS[product.id];
        if (!t) return null;
        return { icon: t.icon, name: t.name, desc: t.description };
    }
    const it = ITEMS[product.id];
    if (!it) return null;
    return { icon: it.icon, name: it.name, desc: it.description };
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

/** true when `have` and `need` are the same multiset (exact recipe match). */
function recipeExact(need: Map<string, number>, have: Map<string, number>): boolean {
    if (need.size !== have.size) return false;
    for (const [id, n] of need) {
        if ((have.get(id) ?? 0) !== n) return false;
    }
    return true;
}

/** Specialist / team forge unlock list, or `'all'` (debug / unlimited). */
export type ForgeSpellPool = readonly string[] | 'all';

export function isForgeSpellAllowed(tacticId: string, pool: ForgeSpellPool): boolean {
    return pool === 'all' || pool.includes(tacticId);
}

/** Rune products + pack-utility spells are always allowed; other spells respect the specialist pool. */
export function isForgeRecipeAllowed(recipe: ForgeRecipe, pool: ForgeSpellPool): boolean {
    if (recipe.product.kind === 'item') return true;
    if (
        recipe.product.id === RALLY_ROUTE_ID ||
        recipe.product.id === MOVE_UNIT_ID ||
        recipe.product.id === TUTOR_ID ||
        recipe.product.id === SELL_UNIT_ID
    ) {
        return true;
    }
    return isForgeSpellAllowed(recipe.product.id, pool);
}

/** Recipes available under a spell pool (rune crafts always included). */
export function forgeRecipesForPool(pool: ForgeSpellPool): ForgeRecipe[] {
    return FORGE_RECIPES.filter((r) => isForgeRecipeAllowed(r, pool));
}

/** Unique union of specialist forge spell lists. */
export function unionForgeSpellPools(
    ...lists: readonly (readonly string[] | undefined | null)[]
): string[] {
    const s = new Set<string>();
    for (const list of lists) {
        if (!list) continue;
        for (const id of list) s.add(id);
    }
    return [...s];
}

/** recipes sorted for best-match: larger first, then higher priority */
function sortedRecipes(pool: ForgeSpellPool = 'all'): ForgeRecipe[] {
    return forgeRecipesForPool(pool).sort((a, b) => {
        if (b.ingredients.length !== a.ingredients.length) {
            return b.ingredients.length - a.ingredients.length;
        }
        return b.priority - a.priority;
    });
}

/**
 * Pick at most one recipe whose ingredients exactly match the oven.
 * No subset crafts — extras or missing pieces → no product, all runes refunded.
 * Spell recipes outside `pool` are skipped; rune recipes always compete.
 */
export function resolveForge(
    slots: readonly (ForgeSlot | null)[],
    pool: ForgeSpellPool = 'all',
): ForgeResolveResult {
    const filled: { index: number; itemId: string; seat: SeatId }[] = [];
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s) filled.push({ index: i, itemId: s.itemId, seat: s.seat });
    }
    if (filled.length === 0) {
        return { product: null, consumed: [], refunds: [] };
    }

    const have = countMultiset(filled.map((f) => f.itemId));
    let matched: ForgeRecipe | null = null;
    for (const recipe of sortedRecipes(pool)) {
        const need = countMultiset(recipe.ingredients);
        if (recipeExact(need, have)) {
            matched = recipe;
            break;
        }
    }

    if (!matched) {
        return {
            product: null,
            consumed: [],
            refunds: filled.map(({ itemId, seat }) => ({ itemId, seat })),
        };
    }

    return {
        product: matched.product,
        consumed: filled,
        refunds: [],
    };
}

/** true when every count in `have` is ≤ the corresponding count in `need` */
function isMultisetSubset(have: Map<string, number>, need: Map<string, number>): boolean {
    for (const [id, n] of have) {
        if ((need.get(id) ?? 0) < n) return false;
    }
    return true;
}

export interface ForgeDragPreview {
    /** product that would bake if the oven burned now (with optional add) */
    bakeProduct: ForgeProduct | null;
    /** larger recipes still reachable — each with runes still needed */
    paths: { product: ForgeProduct; missingItemIds: string[] }[];
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

function sameProduct(a: ForgeProduct | null, b: ForgeProduct): boolean {
    return !!a && a.kind === b.kind && a.id === b.id;
}

/**
 * Bake + reachable paths for the current oven, optionally as if `addingItemId`
 * were inserted (drag-over preview). Locked (non-pool) spell recipes are omitted.
 */
export function forgeOvenPreview(
    ovenItemIds: readonly string[],
    addingItemId?: string | null,
    pool: ForgeSpellPool = 'all',
): ForgeDragPreview {
    let next = [...ovenItemIds];
    if (addingItemId) {
        next.push(addingItemId);
    }
    if (next.length === 0) {
        return { bakeProduct: null, paths: [] };
    }
    const slots: ForgeSlot[] = next.map((itemId) => ({
        itemId,
        seat: 0 as SeatId,
        round: 0,
    }));
    const bakeProduct = resolveForge(slots, pool).product;
    const have = countMultiset(next);
    const paths: ForgeDragPreview['paths'] = [];
    for (const recipe of FORGE_RECIPES) {
        if (!isForgeRecipeAllowed(recipe, pool)) continue;
        if (recipe.ingredients.length <= next.length) continue;
        if (sameProduct(bakeProduct, recipe.product)) continue;
        const need = countMultiset(recipe.ingredients);
        if (!isMultisetSubset(have, need)) continue;
        paths.push({
            product: recipe.product,
            missingItemIds: missingIngredients(have, need),
        });
    }
    return { bakeProduct, paths };
}

/** Preview while dragging a rune onto the forge. */
export function forgeDragPreview(
    ovenItemIds: readonly string[],
    addingItemId: string,
    pool: ForgeSpellPool = 'all',
): ForgeDragPreview {
    return forgeOvenPreview(ovenItemIds, addingItemId, pool);
}

/** HUD-ready icons for {@link forgeOvenPreview} */
export interface ForgePreviewView {
    bakeIcon: string | null;
    paths: { spellIcon: string; missingIcons: string[] }[];
}

/** Icon view for drag ghost / forge-slot hover. */
export function forgePreviewView(
    ovenItemIds: readonly string[],
    addingItemId?: string | null,
    pool: ForgeSpellPool = 'all',
): ForgePreviewView {
    const preview = forgeOvenPreview(ovenItemIds, addingItemId, pool);
    return {
        bakeIcon: preview.bakeProduct
            ? (forgeProductInfo(preview.bakeProduct)?.icon ?? null)
            : null,
        paths: preview.paths.map((p) => ({
            spellIcon: forgeProductInfo(p.product)?.icon ?? '?',
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
    pool: ForgeSpellPool = 'all',
    lit = true,
): string {
    const filled = slots.filter((s): s is ForgeSlot => !!s);
    if (filled.length === 0) {
        return '';
    }
    if (!resolveForge(slots, pool).product) {
        return when === 'this'
            ? 'No matching recipe — all runes returned to their owners this deploy'
            : 'No matching recipe — all runes return to their owners next deploy';
    }
    // A matched recipe promises nothing until the burn is bought — the buy
    // button carries that message, and a line beside it claiming otherwise
    // would be a promise the oven is not making yet.
    if (!lit) return '';
    // Once it IS burning, the recipe is old news: the runes are sitting in the
    // oven and the product is on the square next to them. All that is left to
    // say is when. (No leftovers to mention either — resolveForge only returns
    // a product on an exact match, so `refunds` is empty whenever one exists.)
    return when === 'this' ? 'Ready this deploy' : 'Ready next deploy';
}


/** Supply the oven charges to produce this — per product, 0 when it is free. */
export function forgeProductCost(product: ForgeProduct): number {
    return product.kind === 'item' ? (ITEMS[product.id]?.forgeCost ?? 0) : 0;
}

export interface ForgeHelpRow {
    /** rune item ids (for matching against the oven) */
    ingredients: string[];
    ingredientIcons: string[];
    spellIcon: string;
    spellName: string;
    spellDesc: string;
    /** 'item' = advanced rune; 'tactic' = spell */
    productKind: ForgeProduct['kind'];
    /** supply to fire the oven for this one, on top of the ingredients */
    forgeCost: number;
}

function helpRow(recipe: ForgeRecipe): ForgeHelpRow | null {
    const info = forgeProductInfo(recipe.product);
    if (!info) return null;
    const icons = recipe.ingredients
        .map((id) => ITEMS[id]?.icon)
        .filter((id): id is string => !!id);
    return {
        ingredients: [...recipe.ingredients],
        ingredientIcons: icons,
        spellIcon: info.icon,
        spellName: info.name,
        spellDesc: info.desc,
        productKind: recipe.product.kind,
        forgeCost: forgeProductCost(recipe.product),
    };
}

/** Rune atlas icons required to bake a spell (empty if no recipe). */
export function forgeIngredientIcons(tacticId: string): string[] {
    const recipe = FORGE_RECIPES.find(
        (r) => r.product.kind === 'tactic' && r.product.id === tacticId,
    );
    if (!recipe) return [];
    return recipe.ingredients
        .map((id) => ITEMS[id]?.icon)
        .filter((id): id is string => !!id);
}

/**
 * Flat recipe list for the forge help overlay: team-unlocked spells, Rally,
 * and advanced-rune crafts.
 */
export function forgeHelpRows(pool: ForgeSpellPool = 'all'): ForgeHelpRow[] {
    const rows: ForgeHelpRow[] = [];
    for (const recipe of FORGE_RECIPES) {
        if (!isForgeRecipeAllowed(recipe, pool)) continue;
        const row = helpRow(recipe);
        if (row) rows.push(row);
    }
    return rows;
}

/** Recipes the bag can fully pay for right now (largest first). */
export function forgeRecipesCraftableFromBag(
    bagItemIds: readonly string[],
    pool: ForgeSpellPool = 'all',
): {
    productId: string;
    ingredients: string[];
    spellIcon: string;
    spellName: string;
    spellDesc: string;
}[] {
    const have = countMultiset([...bagItemIds]);
    const out: {
        productId: string;
        ingredients: string[];
        spellIcon: string;
        spellName: string;
        spellDesc: string;
    }[] = [];
    for (const recipe of sortedRecipes(pool)) {
        if (recipe.ingredients.length > FORGE_SLOTS_PER_PLAYER) continue;
        const need = countMultiset(recipe.ingredients);
        if (!recipeFits(need, have)) continue;
        const info = forgeProductInfo(recipe.product);
        if (!info) continue;
        out.push({
            productId: recipe.product.id,
            ingredients: [...recipe.ingredients],
            spellIcon: info.icon,
            spellName: info.name,
            spellDesc: info.desc,
        });
    }
    return out;
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
    spellDesc: string;
    /** every ingredient owned once this card is taken */
    ready: boolean;
    ingredients: { itemId: string; icon: string; owned: boolean }[];
    /** supply to fire the oven for this one, on top of the ingredients */
    forgeCost: number;
}

/**
 * Forge recipes that use `runeId`, with ownership marks as if the player
 * already held `ownedItemIds` plus this rune (the card being offered).
 * Locked spell recipes omitted; rune→rune crafts always included.
 */
export function forgeRecipesForRuneCard(
    runeId: string,
    ownedItemIds: readonly string[] = [],
    pool: ForgeSpellPool = 'all',
): RuneCardForgeRow[] {
    if (!ITEMS[runeId]) return [];
    const have = countMultiset([...ownedItemIds, runeId]);
    const rows: RuneCardForgeRow[] = [];
    for (const recipe of FORGE_RECIPES) {
        if (!recipe.ingredients.includes(runeId)) continue;
        if (!isForgeRecipeAllowed(recipe, pool)) continue;
        const info = forgeProductInfo(recipe.product);
        if (!info) continue;
        const poolMap = new Map(have);
        const ingredients = recipe.ingredients.map((id) => {
            const icon = ITEMS[id]?.icon ?? '?';
            const n = poolMap.get(id) ?? 0;
            const owned = n > 0;
            if (owned) poolMap.set(id, n - 1);
            return { itemId: id, icon, owned };
        });
        rows.push({
            spellIcon: info.icon,
            spellName: info.name,
            spellDesc: info.desc,
            ready: ingredients.every((ing) => ing.owned),
            ingredients,
            forgeCost: forgeProductCost(recipe.product),
        });
    }
    rows.sort((a, b) => a.ingredients.length - b.ingredients.length);
    return rows;
}
