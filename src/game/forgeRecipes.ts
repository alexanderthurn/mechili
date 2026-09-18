/**
 * Stronghold forge: shared oven per side. Each player may fill up to
 * {@link FORGE_SLOTS_PER_PLAYER} (duo → up to 6).
 *
 * Default bake: same-mix inputs add levels first (cap 9), then different
 * mix groups union and take min of those group totals. Forging is free.
 * Any **advanced** rune in the oven returns that advanced unchanged
 * (elementals consumed). Optional exact multiset recipes still override when
 * defined on data.
 */
import type { SeatId } from './seats';
import {
    MOVE_UNIT_ID,
    SELL_UNIT_ID,
    TUTOR_ID,
    RALLY_ROUTE_ID,
} from './tactics';
import type { TypeRegistry } from './content/typeRegistry';
import { DISPLAY } from './displayNames';
import { itemDescription, itemName, t, tacticDescription, tacticName } from '../i18n';
import {
    isElementalRuneId,
    mergeElementalIds,
} from './runeMix';

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

/**
 * The oven slots a seat may use: its own block of {@link FORGE_SLOTS_PER_PLAYER},
 * by its place on the side (the side's first seat 0–2, the next 3–5, …).
 *
 * A shared 2v2 oven is written by two machines' actions that can arrive in
 * either order. If both drew from one pool of slots ("first empty"), each
 * machine would seat the runes differently and a later removal by slot index
 * would point at a different rune. With fixed blocks a seat only ever touches
 * its own slots, which every machine changes in that seat's own order — the
 * tray is identical everywhere, whatever the ally does meanwhile. The bake
 * reads the whole tray, so the product stays combined.
 */
export function forgeSeatSlotRange(
    teamSeats: readonly SeatId[],
    seat: SeatId,
): { start: number; end: number } | null {
    const rank = teamSeats.indexOf(seat);
    if (rank < 0) return null;
    const start = rank * FORGE_SLOTS_PER_PLAYER;
    return { start, end: start + FORGE_SLOTS_PER_PLAYER };
}

/** the seat's first empty slot inside its own block, or -1 */
export function forgeSeatFirstFree(
    oven: readonly (ForgeSlot | null)[],
    range: { start: number; end: number },
): number {
    for (let i = range.start; i < range.end && i < oven.length; i++) {
        if (oven[i] === null) return i;
    }
    return -1;
}

/** True if this seat may insert another rune: a free slot in its own block. */
export function forgeSeatCanInsert(
    oven: readonly (ForgeSlot | null)[],
    seat: SeatId,
    teamSeats: readonly SeatId[],
): boolean {
    const range = forgeSeatSlotRange(teamSeats, seat);
    return !!range && forgeSeatFirstFree(oven, range) >= 0;
}

/** one empty tray sized for the side (default = solo / per-player size) */
export function emptyForgeSlots(capacity = FORGE_SLOTS_PER_PLAYER): (ForgeSlot | null)[] {
    return Array.from({ length: capacity }, () => null);
}

export interface ForgeResolveResult {
    product: ForgeProduct | null;
    /** oven indices consumed by the matched recipe */
    consumed: { index: number; itemId: string; seat: SeatId }[];
    /** runes not used by the recipe — return to inserter bags */
    refunds: { itemId: string; seat: SeatId }[];
}

/** Display icon / name / desc for a forge product. */
export function forgeProductInfo(
    types: TypeRegistry,
    product: ForgeProduct,
): { icon: string; name: string; desc: string } | null {
    if (product.kind === 'tactic') {
        const def = types.tactic(product.id);
        if (!def) return null;
        return {
            icon: def.icon,
            name: tacticName(product.id, def.name),
            desc: tacticDescription(product.id, def.description),
        };
    }
    const it = types.rune(product.id);
    if (!it) return null;
    return {
        icon: it.icon,
        name: itemName(product.id, it.name),
        desc: itemDescription(product.id, it.description, it.mods),
    };
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
export function forgeRecipesForPool(types: TypeRegistry, pool: ForgeSpellPool): ForgeRecipe[] {
    return types.forgeRecipes.filter((r) => isForgeRecipeAllowed(r, pool));
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
function sortedRecipes(types: TypeRegistry, pool: ForgeSpellPool = 'all'): ForgeRecipe[] {
    return forgeRecipesForPool(types, pool).sort((a, b) => {
        if (b.ingredients.length !== a.ingredients.length) {
            return b.ingredients.length - a.ingredients.length;
        }
        return b.priority - a.priority;
    });
}

/**
 * Pick at most one recipe whose ingredients exactly match the oven.
 * Exact data recipes win first (optional specials). Else: any advanced in the
 * oven → that advanced unchanged. Else: 2+ elementals → mix/level merge.
 * No match → refund everything.
 */
export function resolveForge(
    types: TypeRegistry,
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
    for (const recipe of sortedRecipes(types, pool)) {
        const need = countMultiset(recipe.ingredients);
        if (recipeExact(need, have)) {
            return {
                product: recipe.product,
                consumed: filled,
                refunds: [],
            };
        }
    }

    const advancedIds = [
        ...new Set(
            filled
                .map((f) => f.itemId)
                .filter((id) => types.advancedRuneIds.includes(id)),
        ),
    ];
    if (advancedIds.length > 1) {
        return {
            product: null,
            consumed: [],
            refunds: filled.map(({ itemId, seat }) => ({ itemId, seat })),
        };
    }
    if (advancedIds.length === 1) {
        return {
            product: { kind: 'item', id: advancedIds[0]! },
            consumed: filled,
            refunds: [],
        };
    }

    if (filled.length >= 2 && filled.every((f) => isElementalRuneId(f.itemId))) {
        const merged = mergeElementalIds(filled.map((f) => f.itemId));
        if (merged && types.rune(merged)) {
            return {
                product: { kind: 'item', id: merged },
                consumed: filled,
                refunds: [],
            };
        }
    }

    return {
        product: null,
        consumed: [],
        refunds: filled.map(({ itemId, seat }) => ({ itemId, seat })),
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
    types: TypeRegistry,
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
    const bakeProduct = resolveForge(types, slots, pool).product;
    const have = countMultiset(next);
    const paths: ForgeDragPreview['paths'] = [];
    for (const recipe of types.forgeRecipes) {
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
    types: TypeRegistry,
    ovenItemIds: readonly string[],
    addingItemId: string,
    pool: ForgeSpellPool = 'all',
): ForgeDragPreview {
    return forgeOvenPreview(types, ovenItemIds, addingItemId, pool);
}

/** HUD-ready icons for {@link forgeOvenPreview} */
export interface ForgePreviewView {
    bakeIcon: string | null;
    paths: { spellIcon: string; missingIcons: string[] }[];
}

/** Icon view for drag ghost / forge-slot hover. */
export function forgePreviewView(
    types: TypeRegistry,
    ovenItemIds: readonly string[],
    addingItemId?: string | null,
    pool: ForgeSpellPool = 'all',
): ForgePreviewView {
    const preview = forgeOvenPreview(types, ovenItemIds, addingItemId, pool);
    return {
        bakeIcon: preview.bakeProduct
            ? (forgeProductInfo(types, preview.bakeProduct)?.icon ?? null)
            : null,
        paths: preview.paths.map((p) => ({
            spellIcon: forgeProductInfo(types, p.product)?.icon ?? '?',
            missingIcons: p.missingItemIds
                .map((id) => types.rune(id)?.icon)
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
    types: TypeRegistry,
    slots: readonly (ForgeSlot | null)[],
    when: 'next' | 'this' = 'next',
    pool: ForgeSpellPool = 'all',
    lit = true,
): string {
    const filled = slots.filter((s): s is ForgeSlot => !!s);
    if (filled.length === 0) {
        return '';
    }
    if (!resolveForge(types, slots, pool).product) {
        const onlyElementals =
            filled.length > 0 && filled.every((s) => isElementalRuneId(s.itemId));
        if (onlyElementals && filled.length < 2) {
            return when === 'this'
                ? t('hud:forgeNeedTwoThis', {
                      defaultValue: 'Need at least two runes to forge — returned this deploy',
                  })
                : t('hud:forgeNeedTwoNext', {
                      defaultValue: 'Need at least two runes to forge',
                  });
        }
        return when === 'this'
            ? t('hud:forgeNoMatchThis', {
                  defaultValue:
                      'No matching recipe — all runes returned to their owners this deploy',
              })
            : t('hud:forgeNoMatchNext', {
                  defaultValue:
                      'No matching recipe — all runes return to their owners next deploy',
              });
    }
    // A matched recipe promises nothing until the burn is bought — the buy
    // button carries that message, and a line beside it claiming otherwise
    // would be a promise the oven is not making yet.
    if (!lit) return '';
    // Once it IS burning, the recipe is old news: the runes are sitting in the
    // oven and the product is on the square next to them. All that is left to
    // say is when. (No leftovers to mention either — resolveForge only returns
    // a product on an exact match, so `refunds` is empty whenever one exists.)
    return when === 'this'
        ? t('hud:forgeReadyThis', { defaultValue: 'Ready this deploy' })
        : t('hud:forgeReadyNext', { defaultValue: 'Ready next deploy' });
}


/** Supply the oven charges — forging is free (card prices unchanged). */
export function forgeProductCost(_types: TypeRegistry, _product: ForgeProduct): number {
    return 0;
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

function helpRow(types: TypeRegistry, recipe: ForgeRecipe): ForgeHelpRow | null {
    const info = forgeProductInfo(types, recipe.product);
    if (!info) return null;
    const icons = recipe.ingredients
        .map((id) => types.rune(id)?.icon)
        .filter((id): id is string => !!id);
    return {
        ingredients: [...recipe.ingredients],
        ingredientIcons: icons,
        spellIcon: info.icon,
        spellName: info.name,
        spellDesc: info.desc,
        productKind: recipe.product.kind,
        forgeCost: forgeProductCost(types, recipe.product),
    };
}

/** Rune atlas icons required to bake a spell (empty if no recipe). */
export function forgeIngredientIcons(types: TypeRegistry, tacticId: string): string[] {
    const recipe = types.forgeRecipes.find(
        (r) => r.product.kind === 'tactic' && r.product.id === tacticId,
    );
    if (!recipe) return [];
    return recipe.ingredients
        .map((id) => types.rune(id)?.icon)
        .filter((id): id is string => !!id);
}

/**
 * Flat recipe list for the forge help overlay: team-unlocked spells, Rally,
 * and advanced-rune crafts.
 */
export function forgeHelpRows(types: TypeRegistry, pool: ForgeSpellPool = 'all'): ForgeHelpRow[] {
    const rows: ForgeHelpRow[] = [];
    for (const recipe of types.forgeRecipes) {
        if (!isForgeRecipeAllowed(recipe, pool)) continue;
        const row = helpRow(types, recipe);
        if (row) rows.push(row);
    }
    return rows;
}

/** Recipes the bag can fully pay for right now (largest first). */
export function forgeRecipesCraftableFromBag(
    types: TypeRegistry,
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
    for (const recipe of sortedRecipes(types, pool)) {
        if (recipe.ingredients.length > FORGE_SLOTS_PER_PLAYER) continue;
        const need = countMultiset(recipe.ingredients);
        if (!recipeFits(need, have)) continue;
        const info = forgeProductInfo(types, recipe.product);
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
    types: TypeRegistry,
    runeId: string,
    ownedItemIds: readonly string[] = [],
    pool: ForgeSpellPool = 'all',
): RuneCardForgeRow[] {
    if (!types.rune(runeId)) return [];
    const have = countMultiset([...ownedItemIds, runeId]);
    const rows: RuneCardForgeRow[] = [];
    for (const recipe of types.forgeRecipes) {
        if (!recipe.ingredients.includes(runeId)) continue;
        if (!isForgeRecipeAllowed(recipe, pool)) continue;
        const info = forgeProductInfo(types, recipe.product);
        if (!info) continue;
        const poolMap = new Map(have);
        const ingredients = recipe.ingredients.map((id) => {
            const icon = types.rune(id)?.icon ?? '?';
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
            forgeCost: forgeProductCost(types, recipe.product),
        });
    }
    rows.sort((a, b) => a.ingredients.length - b.ingredients.length);
    return rows;
}
