/**
 * Unit pack items: equipped onto one pack, affecting every mech in it.
 * Applying is an action (undoable during the deployment it happened in);
 * once the deployment ends the item is fused to the pack for good.
 */
export interface ItemDef {
    id: string;
    name: string;
    /** the glyph on the item square */
    icon: string;
    /** stat multipliers for every mech of the equipped pack */
    mods: Partial<{ hp: number; damage: number; range: number; speed: number; attackInterval: number }>;
    description: string;
}

export const ITEMS: Record<string, ItemDef> = {
    addi: {
        id: 'addi',
        name: 'Addi',
        icon: '✚',
        mods: { damage: 1.15, hp: 1.15 },
        description: '+15% attack and HP for this pack.',
    },
    power: {
        id: 'power',
        name: 'Power Module',
        icon: '⚔',
        mods: { damage: 1.75 },
        description: '+75% attack damage for this pack.',
    },
    vigor: {
        id: 'vigor',
        name: 'Vigor Core',
        icon: '♥',
        mods: { hp: 2 },
        description: '+100% HP for this pack.',
    },
    colossus: {
        id: 'colossus',
        name: 'Colossus Plating',
        icon: '⬢',
        mods: { hp: 3.5 },
        description: '+250% HP for this pack.',
    },
    wrath: {
        id: 'wrath',
        name: 'Wrath Engine',
        icon: '☠',
        mods: { damage: 4 },
        description: '+300% attack damage for this pack.',
    },
};
