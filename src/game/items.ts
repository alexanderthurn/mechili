/**
 * Pack runes (code: items): equipped onto a pack, affecting every mech in it.
 * Applying is an action (undoable during the deployment it happened in);
 * once the deployment ends the rune is fused to the pack for good.
 * Slot count is per unit type via {@link itemSlotLimit} (default 2).
 *
 * Player-facing name: "Runes" (`displayNames.ts`).
 * Icon craft (carved medallion + internal glow): `misc/icons/STYLE.md`,
 * `misc/concepts/runes/README.md`. Atlas ids: `item-*`.
 *
 * Economy: four weak base runes (earth/fire/water/wind) are always buyable in
 * the unit shop (no per-round buy-slot limit); advanced runes come from round
 * cards or commander grants — not the forge.
 *
 * The catalog is data: `assets/data/runes/<id>.jsonc`, in the order
 * `pack.jsonc` lists them. Look runes up through the match's
 * {@link TypeRegistry} (`types.rune(id)`, `types.baseRuneIds`).
 */
import type { UnitType } from './units';

/** Item slots of a type that doesn't set `itemSlots`. */
export const DEFAULT_PACK_ITEM_SLOTS = 2;

/** How many item slots this unit type has. */
export function itemSlotLimit(type: Pick<UnitType, 'itemSlots'>): number {
    return Math.max(0, Math.floor(type.itemSlots ?? DEFAULT_PACK_ITEM_SLOTS));
}

export interface ItemDef {
    id: string;
    name: string;
    /**
     * `base`: weak elemental rune — always in the shop.
     * `advanced`: between-round cards or commander grants (not shop).
     */
    tier: 'base' | 'advanced';
    /** atlas id for HUD and world badges (`item-*`) */
    icon: string;
    /** stat multipliers for every mech of the equipped pack */
    mods: Partial<{ hp: number; damage: number; range: number; speed: number; attackInterval: number }>;
    /** pack-wide immunity to tower-destruction debuffs for the battle */
    debuffImmune?: boolean;
    /** grants every mech in the pack a shield pool equal to its max HP */
    grantsShieldHp?: boolean;
    /**
     * Optional forge recipe producing this rune (exact multiset of oven
     * ingredients). Unused for advanced runes — they come from cards.
     */
    forge?: {
        ingredients: string[];
        /** tie-break among same-size matches, higher wins (default 1) */
        priority?: number;
    };
    /**
     * Supply the Stronghold charges to fire the oven for this rune, on top of
     * the ingredients. Omit = free.
     */
    forgeCost?: number;
    /** supply price as a between-round card (default 50) */
    cardCost?: number;
    description: string;
}
