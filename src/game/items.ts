/**
 * Unit pack items: equipped onto one pack, affecting every mech in it.
 * Applying is an action (undoable during the deployment it happened in);
 * once the deployment ends the item is fused to the pack for good.
 */
export interface ItemDef {
    id: string;
    name: string;
    /** atlas id for HUD (`item-*`); world badges use {@link itemWorldGlyph} */
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
        name: 'Addi',
        icon: 'item-addi',
        mods: { damage: 1.15, hp: 1.15 },
        description: '+15% attack and HP for this pack.',
    },
    power: {
        id: 'power',
        name: 'Power Module',
        icon: 'item-power',
        mods: { damage: 1.75 },
        description: '+75% attack damage for this pack.',
    },
    vigor: {
        id: 'vigor',
        name: 'Vigor Core',
        icon: 'item-vigor',
        mods: { hp: 2 },
        description: '+100% HP for this pack.',
    },
    colossus: {
        id: 'colossus',
        name: 'Colossus Plating',
        icon: 'item-colossus',
        mods: { hp: 3.5 },
        description: '+250% HP for this pack.',
    },
    wrath: {
        id: 'wrath',
        name: 'Wrath Engine',
        icon: 'item-wrath',
        mods: { damage: 4 },
        description: '+300% attack damage for this pack.',
    },
    golden: {
        id: 'golden',
        name: 'Golden Plating',
        icon: 'item-golden',
        mods: {},
        debuffImmune: true,
        description: 'Immune to tower debuffs and takes 30% less damage for this pack.',
    },
};

/** Short glyphs for canvas / world badges (atlas sprites are HUD-only). */
const WORLD_GLYPH: Record<string, string> = {
    addi: '✚',
    power: '⚔',
    vigor: '♥',
    colossus: '⬢',
    wrath: '☠',
    golden: '✦',
};

export function itemWorldGlyph(itemId: string): string {
    return WORLD_GLYPH[itemId] ?? '?';
}
