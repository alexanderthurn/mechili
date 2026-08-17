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
 * Economy: four weak base runes (earth/fire/water/wind) are offered on round
 * cards and always buyable in the unit shop (sharing the per-round buy limit);
 * advanced runes are forged from them at the Stronghold.
 */

/** Default item slots when a unit has no entry in {@link UNIT_ITEM_SLOTS}. */
export const DEFAULT_PACK_ITEM_SLOTS = 2;

/** @deprecated use {@link itemSlotLimit} — default slot count */
export const MAX_PACK_ITEMS = DEFAULT_PACK_ITEM_SLOTS;

/**
 * Per-unit item slot caps. Omit a type to use {@link DEFAULT_PACK_ITEM_SLOTS}.
 * Strong packs can go higher (e.g. 4).
 */
export const UNIT_ITEM_SLOTS: Record<string, number> = {
    dwarf: 2,
    archer: 2,
    crowRider: 2,
    ballista: 4, // UI stress-test: extra item circles
};

/** How many item slots this unit type has. */
export function itemSlotLimit(typeId: string): number {
    const n = UNIT_ITEM_SLOTS[typeId] ?? DEFAULT_PACK_ITEM_SLOTS;
    return Math.max(0, Math.floor(n));
}

export interface ItemDef {
    id: string;
    name: string;
    /** atlas id for HUD and world badges (`item-*`) */
    icon: string;
    /** stat multipliers for every mech of the equipped pack */
    mods: Partial<{ hp: number; damage: number; range: number; speed: number; attackInterval: number }>;
    /** pack-wide immunity to tower-destruction debuffs for the battle */
    debuffImmune?: boolean;
    /** grants every mech in the pack a shield pool equal to its max HP */
    grantsShieldHp?: boolean;
    description: string;
}

/** Weak elemental runes — round-card pool + always-on shop; forge fuel for advanced runes + spells. */
export const BASE_RUNE_IDS = ['earth', 'fire', 'water', 'wind'] as const;
export type BaseRuneId = (typeof BASE_RUNE_IDS)[number];

/** Stronger runes — forged from base runes (not offered on cards by default). */
export const ADVANCED_RUNE_IDS = [
    'addi',
    'power',
    'vigor',
    'colossus',
    'wrath',
    'golden',
    'bulwark',
] as const;

export const ITEMS: Record<string, ItemDef> = {
    // --- base (minor) ---
    earth: {
        id: 'earth',
        name: 'Earth',
        icon: 'item-earth',
        mods: { hp: 1.1 },
        description: '+10% HP.',
    },
    fire: {
        id: 'fire',
        name: 'Fire',
        icon: 'item-fire',
        mods: { damage: 1.1 },
        description: '+10% attack.',
    },
    water: {
        id: 'water',
        name: 'Water',
        icon: 'item-water',
        mods: { hp: 1.05, damage: 1.05 },
        description: '+5% attack and HP.',
    },
    wind: {
        id: 'wind',
        name: 'Wind',
        icon: 'item-wind',
        mods: { range: 1.1 },
        description: '+10% range.',
    },

    // --- advanced (forged / specialist starts) ---
    addi: {
        id: 'addi',
        name: 'Valor',
        icon: 'item-addi',
        mods: { damage: 1.15, hp: 1.15 },
        description: '+15% attack and HP.',
    },
    power: {
        id: 'power',
        name: 'Carnage',
        icon: 'item-power',
        mods: { damage: 1.75 },
        description: '+75% attack.',
    },
    vigor: {
        id: 'vigor',
        name: 'Giant Blood',
        icon: 'item-vigor',
        mods: { hp: 2 },
        description: '+100% HP.',
    },
    colossus: {
        id: 'colossus',
        name: 'Mithril Cuirass',
        icon: 'item-colossus',
        mods: { hp: 3.5 },
        description: '+250% HP.',
    },
    wrath: {
        id: 'wrath',
        name: 'Berserk',
        icon: 'item-wrath',
        mods: { damage: 4 },
        description: '+300% attack.',
    },
    golden: {
        id: 'golden',
        name: 'Sunstone',
        icon: 'item-golden',
        mods: {},
        debuffImmune: true,
        description:
            'Immune to tower debuffs and takes 30% less damage. Wizards cannot convert — the ray deals damage instead.',
    },
    bulwark: {
        id: 'bulwark',
        name: 'Bulwark',
        // TODO: placeholder art — wants its own carved shield rune icon
        icon: 'ability-ward',
        mods: {},
        grantsShieldHp: true,
        description:
            'Shield: every unit gains a second health pool equal to its HP. Ranged hits drain the shield first; melee, fire and acid ignore it.',
    },
};

/** Short glyphs for canvas / world badges (atlas sprites are HUD-only). */
const WORLD_GLYPH: Record<string, string> = {
    earth: '?',
    fire: '?',
    water: '?',
    wind: '?',
    addi: '?',
    power: '?',
    vigor: '?',
    colossus: '?',
    wrath: '?',
    golden: '?',
};

export function itemIcon(itemId: string): string | null {
    return ITEMS[itemId]?.icon ?? null;
}

/** @deprecated Unicode fallback — world badges use {@link itemIcon} + atlas. */
export function itemWorldGlyph(itemId: string): string {
    return WORLD_GLYPH[itemId] ?? '?';
}
