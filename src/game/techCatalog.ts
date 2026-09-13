/**
 * Talent selection helpers (code: tech). The catalog lives in
 * `assets/data/talents/<id>.jsonc`; which talents a unit type may take and how
 * many are fields on the type (`talents`, `talentSlots`). Lookups go through
 * the match's {@link TypeRegistry}, so a level's talents apply to its matches.
 * Player-facing name: "Talents" (`displayNames.ts`).
 */

import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import type { TechDef, UnitType } from './units';

/** Talent slots of a type that doesn't set `talentSlots`. */
export const DEFAULT_UNIT_TECH_SLOTS = 4;

/** How many talents this unit type shows / can select. */
export function techSlotLimit(type: Pick<UnitType, 'talentSlots'>): number {
    return Math.max(0, Math.floor(type.talentSlots ?? DEFAULT_UNIT_TECH_SLOTS));
}

/** The type's pickable talents in auto-pick order (may be longer than the slot limit). */
export function allowedTechIds(type: Pick<UnitType, 'talents'>): readonly string[] {
    return type.talents ?? [];
}

export interface Loadout {
    /** talent picks, keyed by unit type id */
    readonly techs: Readonly<Record<string, readonly string[]>>;
    // Deliberately a CONTAINER rather than the bare techs map, so later
    // pregame choices are additive rather than a migration of everything
    // already saved in user.sav and already crossing the wire:
    //   spells?:     Record<commanderId, tacticId[]>  — per-commander forge
    //                spells, today fixed on the StartCard (`forgeSpells`,
    //                read in exactly one place: Game's forge-spell lookup)
    //   commanders?: string[]  — which commanders (pack.jsonc) the seat's 4-card
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
export function selectedTechIds(type: UnitType, types: TypeRegistry, loadout?: Loadout): readonly string[] {
    const picked = loadout?.techs?.[type.id];
    if (picked) return picked;
    return allowedTechIds(type)
        .slice(0, techSlotLimit(type))
        .filter((id) => types.talent(id) !== null);
}

/** Resolved TechDefs for this seat's selection (≤ that unit's slot limit). */
export function techsForUnit(type: UnitType, types: TypeRegistry, loadout?: Loadout): TechDef[] {
    return selectedTechIds(type, types, loadout)
        .map((id) => types.talent(id))
        .filter((t): t is TechDef => t !== null);
}

export function isTechSelectedForUnit(
    type: UnitType,
    techId: string,
    types: TypeRegistry,
    loadout?: Loadout,
): boolean {
    return selectedTechIds(type, types, loadout).includes(techId);
}

type HasTech = (seat: SeatId, typeId: string, techId: string) => boolean;

/** The talents of `type` (innate + pickable) that the seat owns and that have `key`. */
function ownedWith<K extends 'produce' | 'onKill' | 'cleave'>(
    key: K,
    type: UnitType,
    seat: SeatId,
    hasTech: HasTech,
    types: TypeRegistry,
): ({ tech: TechDef } & { [P in K]: NonNullable<TechDef[K]> })[] {
    const out: ({ tech: TechDef } & { [P in K]: NonNullable<TechDef[K]> })[] = [];
    for (const tech of types.talentsOf(type)) {
        const value = tech[key];
        if (value === undefined || !hasTech(seat, type.id, tech.id)) continue;
        out.push({ tech, [key]: value } as { tech: TechDef } & { [P in K]: NonNullable<TechDef[K]> });
    }
    return out;
}

/**
 * Produce techs this pack currently owns (innate + researched talents).
 * Shared by battle prep and the sim — one place for future dwarf forges etc.
 */
export function ownedProduceTechs(type: UnitType, seat: SeatId, hasTech: HasTech, types: TypeRegistry) {
    return ownedWith('produce', type, seat, hasTech, types);
}

/** On-kill spawn techs this pack currently owns (innate + researched talents). */
export function ownedOnKillTechs(type: UnitType, seat: SeatId, hasTech: HasTech, types: TypeRegistry) {
    return ownedWith('onKill', type, seat, hasTech, types);
}

/** Cleave techs this pack currently owns (innate + researched talents). */
export function ownedCleaveTechs(type: UnitType, seat: SeatId, hasTech: HasTech, types: TypeRegistry) {
    return ownedWith('cleave', type, seat, hasTech, types);
}
