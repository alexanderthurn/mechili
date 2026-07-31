/**
 * Unit pack items: equipped onto a pack, affecting every mech in it.
 * Applying is an action (undoable during the deployment it happened in);
 * once the deployment ends the item is fused to the pack for good.
 * A pack holds up to {@link MAX_PACK_ITEMS} at once.
 */

/** Max equipped items on one pack (inventory applies up to this). */
export const MAX_PACK_ITEMS = 2;

export interface ItemDef {
    id: string;
    name: string;
    /** atlas id for HUD and world badges (`item-*`) */
    icon: string;
    /** stat multipliers for every mech of the equipped pack */
    mods: Partial<{ hp: number; damage: number; range: number; speed: number; attackInterval: number }>;
    /** pack-wide immunity to tower-destruction debuffs for the battle */
    debuffImmune?: boolean;
    description: string;
}

export const ITEMS: Record<string, ItemDef> = {
    addi: {
        id: 'addi',
        name: 'Valor',
        icon: 'item-addi',
        mods: { damage: 1.15, hp: 1.15 },
        description: '+15% attack and HP for this pack.',
    },
    power: {
        id: 'power',
        name: 'Carnage',
        icon: 'item-power',
        mods: { damage: 1.75 },
        description: '+75% attack damage for this pack.',
    },
    vigor: {
        id: 'vigor',
        name: 'Giant Blood',
        icon: 'item-vigor',
        mods: { hp: 2 },
        description: '+100% HP for this pack.',
    },
    colossus: {
        id: 'colossus',
        name: 'Mithril Cuirass',
        icon: 'item-colossus',
        mods: { hp: 3.5 },
        description: '+250% HP for this pack.',
    },
    wrath: {
        id: 'wrath',
        name: 'Berserk',
        icon: 'item-wrath',
        mods: { damage: 4 },
        description: '+300% attack damage for this pack.',
    },
    golden: {
        id: 'golden',
        name: 'Sunstone',
        icon: 'item-golden',
        mods: {},
        debuffImmune: true,
        description: 'Immune to tower debuffs and takes 30% less damage for this pack.',
    },
};

/** Short glyphs for canvas / world badges (atlas sprites are HUD-only). */
const WORLD_GLYPH: Record<string, string> = {
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
