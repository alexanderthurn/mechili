/**
 * Free talent catalog + per-unit allowlists and slot limits (code: tech).
 *
 * Talents are defined once here; each unit type lists which ids are allowed and
 * how many slots it has. Pregame, the player will pick up to that unit's slot
 * limit from the allowlist — for now we auto-select the first N allowed ids
 * (no picker UI yet). Player-facing name: "Talents" (`displayNames.ts`).
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
            burn: { dps: 21, duration: 8 },
            ground: { radius: 2.5, duration: 8, intensity: 21 },
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
    aegis: {
        id: 'aegis',
        name: 'Aegis',
        cost: 400,
        mods: {},
        // TODO: placeholder art — wants its own tech icon
        icon: 'ability-ward',
        description:
            'Shield: every unit gains a second health pool equal to its HP. Ranged hits drain the shield first; melee, fire and acid ignore it.',
    },
    golden: {
        id: 'golden',
        name: 'Golden Aura',
        cost: 50,
        mods: {},
        icon: 'tech-golden-aura',
        description: 'Nearby allies resist tower debuffs and take 30% less damage for 30s. Wizards cannot convert them — the ray deals damage instead.',
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
    /** Catalog-only for now — assign via {@link UNIT_TECH_ALLOWLIST} when a unit should use it. */
    wideBlast: {
        id: 'wideBlast',
        name: 'Wide Blast',
        cost: 250,
        mods: { splashRadius: 3 },
        icon: 'tech-wide-blast',
        description: 'Triples splash radius (grants splash to units without it).',
    },
    skyBind: {
        id: 'skyBind',
        name: 'Sky Bind',
        cost: 400,
        mods: {},
        icon: 'tech-sky-bind',
        description: 'Can attack ground and air units.',
    },
    skyLift: {
        id: 'skyLift',
        name: 'Sky Lift',
        cost: 350,
        mods: {},
        icon: 'tech-sky-lift',
        description: 'Lifts this unit into the air (combat flyer).',
    },
    /** Catalog-only for now — assign via {@link UNIT_TECH_ALLOWLIST} when a unit should use it. */
    earthbound: {
        id: 'earthbound',
        name: 'Earthbound',
        cost: 300,
        mods: {},
        icon: 'tech-earthbound',
        description: 'Keeps this unit on the ground (overrides Sky Lift / natural flight).',
    },
    /**
     * Schwarze Spinne innate (also a template for future produce techs —
     * dwarven forges, etc.). Spawns match the parent's level.
     */
    spiderMother: {
        id: 'spiderMother',
        name: 'Mother of Spiders',
        cost: 0,
        mods: {},
        icon: 'tech-default',
        produce: { typeId: 'hordeBrutSpawn', interval: 0.4, max: 70 },
    },
    /**
     * Dead Farmer innate — spawn type is the only per-unit knob.
     * Child packs should not own this tech (no chain).
     */
    darkHarvest: {
        id: 'darkHarvest',
        name: 'Dark Harvest',
        cost: 0,
        mods: {},
        icon: 'tech-default',
        onKill: { typeId: 'hordeFarmerSpawn' },
    },
};

/**
 * Manager allowlist: which catalog techs may appear on each unit type.
 * Order matters — auto-select takes the first {@link techSlotLimit} ids.
 */
export const UNIT_TECH_ALLOWLIST: Record<string, readonly string[]> = {
    dwarf: ['legs', 'carapace'],
    archer: ['barrel', 'ap', 'fireArrows'],
    wizard: ['skyBind', 'skyLift'],
    crowRider: ['engines', 'stingers', 'aegis'],
    // ballista: fat allowlist for UI testing — siege-fitting first, then other useful mods
    ballista: [
        'skyBind',
        'armor',
        'autoloader',
        'golden',
        'pitchBolts',
        'barrel', // range
        'ap', // damage
        'fireArrows', // burn/ground fire on bolts
        'carapace', // HP
        'legs', // move speed
        'stingers', // damage
        'engines', // move speed
    ],
    // horde — innate on the type; listed so tooling / future research UI can see it
    hordeSpinne: ['spiderMother'],
    hordeFarmer: ['darkHarvest'],
};

/**
 * Per-unit tech slot caps (how many the player may choose pregame / UI shows).
 * Omit a type to use {@link DEFAULT_UNIT_TECH_SLOTS}. Strong units can go higher.
 */
export const UNIT_TECH_SLOTS: Record<string, number> = {
    dwarf: 2,
    archer: 3,
    wizard: 2,
    crowRider: 3, // engines + stingers + aegis (slots must cover the allowlist)
    // 4 of 12 — the widest allowlist in the game, and now a real choice:
    // pick a siege, anti-air or fire build rather than taking everything.
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
 * A player's talent picks, keyed by unit type id. Structural on purpose —
 * `loadouts.ts` owns building / normalizing / persisting one, but this
 * module has to read it without importing that (it would be a cycle).
 *
 * A Loadout reaching here is assumed NORMALIZED (see `normalizeLoadout`):
 * every id allowed for its own type, deduped, within the slot limit. It
 * crosses the wire, so normalizing on receipt is what stops a peer's picks
 * from feeding the sim something the allowlist forbids.
 */
export interface Loadout {
    /** talent picks, keyed by unit type id */
    readonly techs: Readonly<Record<string, readonly string[]>>;
    // Deliberately a CONTAINER rather than the bare techs map, so later
    // pregame choices are additive rather than a migration of everything
    // already saved in user.sav and already crossing the wire:
    //   spells?:     Record<commanderId, tacticId[]>  — per-commander forge
    //                spells, today fixed on the StartCard (`forgeSpells`,
    //                read in exactly one place: Game's forge-spell lookup)
    //   commanders?: string[]  — which of START_CARDS the seat's 4-card
    //                offer may draw from (a BAN list, not a pick list — see
    //                PROGRESSION_PLAN.md §1h for why)
    // Neither is implemented. Adding one means a new optional field here, a
    // branch in normalizeLoadout, and nothing else — the seat/wire/replay
    // plumbing already carries whatever this object holds.
}

/**
 * Techs selected for this match for a unit type, by the owning seat.
 *
 * With no loadout — AI seats, the showcase page, replays recorded before
 * the picker existed — this stays the historical default (the first N
 * allowed ids, N = slot limit), so every seatless caller behaves exactly
 * as it did before loadouts.
 */
export function selectedTechIds(typeId: string, loadout?: Loadout): readonly string[] {
    const picked = loadout?.techs?.[typeId];
    if (picked) return picked;
    return allowedTechIds(typeId).slice(0, techSlotLimit(typeId)).filter((id) => id in TECHS);
}

/** Resolved TechDefs for this seat's selection (≤ that unit's slot limit). */
export function techsForUnit(typeId: string, loadout?: Loadout): TechDef[] {
    return selectedTechIds(typeId, loadout)
        .map((id) => TECHS[id])
        .filter((t): t is TechDef => !!t);
}

export function isTechSelectedForUnit(typeId: string, techId: string, loadout?: Loadout): boolean {
    return selectedTechIds(typeId, loadout).includes(techId);
}

/**
 * Produce techs this pack currently owns (innate + researched allowlist).
 * Shared by battle prep and the sim — one place for future dwarf forges etc.
 */
export function ownedProduceTechs(
    type: import('./units').UnitType,
    seat: import('./seats').SeatId,
    hasTech: (seat: import('./seats').SeatId, typeId: string, techId: string) => boolean,
): { tech: TechDef; produce: NonNullable<TechDef['produce']> }[] {
    const ids = new Set<string>([...(type.innateTechs ?? []), ...allowedTechIds(type.id)]);
    const out: { tech: TechDef; produce: NonNullable<TechDef['produce']> }[] = [];
    for (const id of ids) {
        if (!hasTech(seat, type.id, id)) continue;
        const tech = TECHS[id];
        if (!tech?.produce) continue;
        out.push({ tech, produce: tech.produce });
    }
    return out;
}

/**
 * On-kill spawn techs this pack currently owns (innate + researched allowlist).
 */
export function ownedOnKillTechs(
    type: import('./units').UnitType,
    seat: import('./seats').SeatId,
    hasTech: (seat: import('./seats').SeatId, typeId: string, techId: string) => boolean,
): { tech: TechDef; onKill: NonNullable<TechDef['onKill']> }[] {
    const ids = new Set<string>([...(type.innateTechs ?? []), ...allowedTechIds(type.id)]);
    const out: { tech: TechDef; onKill: NonNullable<TechDef['onKill']> }[] = [];
    for (const id of ids) {
        if (!hasTech(seat, type.id, id)) continue;
        const tech = TECHS[id];
        if (!tech?.onKill) continue;
        out.push({ tech, onKill: tech.onKill });
    }
    return out;
}

/**
 * Cleave techs this pack currently owns (innate + researched allowlist).
 */
export function ownedCleaveTechs(
    type: import('./units').UnitType,
    seat: import('./seats').SeatId,
    hasTech: (seat: import('./seats').SeatId, typeId: string, techId: string) => boolean,
): { tech: TechDef; cleave: NonNullable<TechDef['cleave']> }[] {
    const ids = new Set<string>([...(type.innateTechs ?? []), ...allowedTechIds(type.id)]);
    const out: { tech: TechDef; cleave: NonNullable<TechDef['cleave']> }[] = [];
    for (const id of ids) {
        if (!hasTech(seat, type.id, id)) continue;
        const tech = TECHS[id];
        if (!tech?.cleave) continue;
        out.push({ tech, cleave: tech.cleave });
    }
    return out;
}
