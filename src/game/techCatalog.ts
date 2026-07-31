/**
 * Free tech catalog + per-unit allowlists and slot limits.
 *
 * Techs are defined once here; each unit type lists which ids are allowed and
 * how many slots it has. Pregame, the player will pick up to that unit's slot
 * limit from the allowlist — for now we auto-select the first N allowed ids
 * (no picker UI yet).
 */

import type { TechDef } from './units';

/** Default tech-slot count when a unit has no entry in {@link UNIT_TECH_SLOTS}. */
export const DEFAULT_UNIT_TECH_SLOTS = 4;

/** @deprecated use {@link techSlotLimit} — kept as the default for docs/callers */
export const MAX_UNIT_TECH_SLOTS = DEFAULT_UNIT_TECH_SLOTS;

/** All researchable techs — assignable to any unit via {@link UNIT_TECH_ALLOWLIST}. */
export const TECHS: Record<string, TechDef> = {
    legs: {
        id: 'legs',
        name: 'Fleet Feet',
        cost: 150,
        mods: { speed: 1.35 },
        icon: 'tech-fleet-feet',
    },
    carapace: {
        id: 'carapace',
        name: 'Stone Hide',
        cost: 200,
        mods: { hp: 1.5 },
        icon: 'tech-stone-hide',
    },
    barrel: {
        id: 'barrel',
        name: 'Longbow',
        cost: 200,
        mods: { range: 1.3 },
        icon: 'tech-longbow',
    },
    ap: {
        id: 'ap',
        name: 'Piercing Arrows',
        cost: 250,
        mods: { damage: 1.4 },
        icon: 'tech-piercing-arrows',
    },
    fireArrows: {
        id: 'fireArrows',
        name: 'Fire Arrows',
        cost: 250,
        mods: {},
        icon: 'tech-fire-arrows',
        description: 'Arrows leave a brief ground fire and burn — enough to ignite oil puddles.',
        fire: {
            burn: { dps: 14, duration: 8 },
            ground: { radius: 2.5, duration: 8, intensity: 14 },
        },
    },
    engines: {
        id: 'engines',
        name: 'Gale Wings',
        cost: 150,
        mods: { speed: 1.3 },
        icon: 'tech-gale-wings',
    },
    stingers: {
        id: 'stingers',
        name: 'Crow Talons',
        cost: 200,
        mods: { damage: 1.4 },
        icon: 'tech-crow-talons',
    },
    armor: {
        id: 'armor',
        name: 'Iron Plating',
        cost: 300,
        mods: { hp: 1.5 },
        icon: 'tech-iron-plating',
    },
    autoloader: {
        id: 'autoloader',
        name: 'Quick Winch',
        cost: 300,
        mods: { attackInterval: 0.7 },
        icon: 'tech-quick-winch',
    },
    golden: {
        id: 'golden',
        name: 'Golden Aura',
        cost: 50,
        mods: {},
        icon: 'tech-golden-aura',
        description: 'Nearby allies resist tower debuffs and take 30% less damage for 30s.',
    },
    pitchBolts: {
        id: 'pitchBolts',
        name: 'Pitch Bolts',
        cost: 350,
        mods: {},
        icon: 'tech-pitch-bolts',
        description: 'Bolts splash oil on impact (does not ignite — pair with fire arrows or a Fire Bolt).',
        fire: {
            oil: { radius: 10 },
        },
    },
};

/**
 * Manager allowlist: which catalog techs may appear on each unit type.
 * Order matters — auto-select takes the first {@link techSlotLimit} ids.
 */
export const UNIT_TECH_ALLOWLIST: Record<string, readonly string[]> = {
    dwarf: ['legs', 'carapace'],
    archer: ['barrel', 'ap', 'fireArrows'],
    crowRider: ['engines', 'stingers'],
    ballista: ['armor', 'autoloader', 'golden', 'pitchBolts'],
};

/**
 * Per-unit tech slot caps (how many the player may choose pregame / UI shows).
 * Omit a type to use {@link DEFAULT_UNIT_TECH_SLOTS}. Strong units can go higher.
 */
export const UNIT_TECH_SLOTS: Record<string, number> = {
    dwarf: 4,
    archer: 4,
    crowRider: 4,
    ballista: 4,
};

/** How many tech slots this unit type shows / can select. */
export function techSlotLimit(typeId: string): number {
    const n = UNIT_TECH_SLOTS[typeId] ?? DEFAULT_UNIT_TECH_SLOTS;
    return Math.max(0, Math.floor(n));
}

export function techById(id: string): TechDef | null {
    return TECHS[id] ?? null;
}

/** Full allowlist for a unit type (may be longer than the slot limit). */
export function allowedTechIds(typeId: string): readonly string[] {
    return UNIT_TECH_ALLOWLIST[typeId] ?? [];
}

/**
 * Techs selected for this match for a unit type.
 * Pregame picker will replace this; for now: first N allowed ids (N = slot limit).
 */
export function selectedTechIds(typeId: string, maxSlots = techSlotLimit(typeId)): string[] {
    return allowedTechIds(typeId).slice(0, maxSlots).filter((id) => id in TECHS);
}

/** Resolved TechDefs for the current match selection (≤ that unit's slot limit). */
export function techsForUnit(typeId: string, maxSlots = techSlotLimit(typeId)): TechDef[] {
    return selectedTechIds(typeId, maxSlots)
        .map((id) => TECHS[id])
        .filter((t): t is TechDef => !!t);
}

export function isTechSelectedForUnit(
    typeId: string,
    techId: string,
    maxSlots = techSlotLimit(typeId),
): boolean {
    return selectedTechIds(typeId, maxSlots).includes(techId);
}
