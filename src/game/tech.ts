import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import type { UnitType } from './units';

/** a unit type's combat stats after tech multipliers (level scaling is separate) */
export interface ResolvedStats {
    hp: number;
    damage: number;
    range: number;
    /** minimum engagement range / dead zone (0 = none); scales with range mods */
    minRange: number;
    speed: number;
    attackInterval: number;
    /** projectile splash radius (0 = single-target); tech can multiply the type base */
    splashRadius: number;
}

/**
 * Attack layers after talents: an owned talent with `targets` (Sky Bind)
 * replaces the type's own. Several such talents combine (either layer counts).
 */
export function effectiveTargets(
    type: UnitType,
    seat: SeatId,
    hasTech: (seat: SeatId, typeId: string, techId: string) => boolean,
    types: TypeRegistry,
): { ground: boolean; air: boolean } {
    if (seat < 0) return type.targets;
    let granted: { ground: boolean; air: boolean } | null = null;
    for (const tech of types.talentsOf(type)) {
        if (!tech.targets || !hasTech(seat, type.id, tech.id)) continue;
        granted = granted
            ? { ground: granted.ground || tech.targets.ground, air: granted.air || tech.targets.air }
            : tech.targets;
    }
    return granted ?? type.targets;
}

/** Combat altitude granted by Sky Lift when the unit isn't already a flyer. */
export const SKY_LIFT_ALTITUDE = 18;

/**
 * Flight altitude after talents with `flight`: `ground` wins over `lift`
 * (Sky Lift) and natural flight. Structures and board extras are unchanged.
 */
export function effectiveFlying(
    type: UnitType,
    seat: SeatId,
    hasTech: (seat: SeatId, typeId: string, techId: string) => boolean,
    types: TypeRegistry,
): number {
    const base = type.flying ?? 0;
    if (type.structure || type.extra || seat < 0) return base;
    let lift = false;
    for (const tech of types.talentsOf(type)) {
        if (!tech.flight || !hasTech(seat, type.id, tech.id)) continue;
        if (tech.flight === 'ground') return 0;
        lift = true;
    }
    return lift && base <= 0 ? SKY_LIFT_ALTITUDE : base;
}

/**
 * True if this type owns the tech via {@link UnitType.innateTechs} or the
 * seat's research tree. Prefer this (or a hasTech callback that includes
 * innate) over raw {@link TechTree.has} for combat effects.
 */
export function typeOwnsTech(
    type: Pick<UnitType, 'id' | 'innateTechs'>,
    seat: SeatId,
    techId: string,
    hasTech: (seat: SeatId, typeId: string, techId: string) => boolean,
): boolean {
    if (type.innateTechs?.includes(techId)) return true;
    return hasTech(seat, type.id, techId);
}

/**
 * Which techs each SEAT owns, per unit type — per-seat, never shared, same
 * as items/economy/buildings: a bought tech applies only to the buyer's own
 * packs of that type (current and future), not a teammate's. This also
 * removes a real race that existed when this was per-side: tiered pricing
 * (`ownedFor(...).size`) read from a shared count meant two teammates
 * researching techs for the same unit type near-simultaneously could each
 * pass the check locally before hearing about the other's purchase, getting
 * mispriced (or, for the exact same tech, silently losing one side's charge)
 * once relayed — the same shape as the Command Tower boost bug.
 */
export class TechTree {
    private readonly owned: Map<string, Set<string>>[];

    constructor(
        seatCount: number,
        private readonly types: TypeRegistry,
    ) {
        this.owned = Array.from({ length: seatCount }, () => new Map());
    }

    ownedFor(seat: SeatId, typeId: string): Set<string> {
        // horde packs use seat -1 (no tech); out-of-range seats are equally empty
        const bySeat = this.owned[seat];
        if (!bySeat) return new Set();
        let set = bySeat.get(typeId);
        if (!set) {
            set = new Set();
            bySeat.set(typeId, set);
        }
        return set;
    }

    has(seat: SeatId, typeId: string, techId: string): boolean {
        if (seat < 0 || seat >= this.owned.length) return false;
        return this.ownedFor(seat, typeId).has(techId);
    }

    /** forget every owned talent (the scenario editor rebuilds its board) */
    clear(): void {
        for (const bySeat of this.owned) bySeat.clear();
    }

    /** the actual purchase (charging, price escalation) lives in the action dispatcher */
    add(seat: SeatId, typeId: string, techId: string): void {
        if (seat < 0 || seat >= this.owned.length) return;
        this.ownedFor(seat, typeId).add(techId);
    }

    statsFor(seat: SeatId, type: UnitType): ResolvedStats {
        const owned =
            seat >= 0 && seat < this.owned.length ? this.ownedFor(seat, type.id) : TechTree.EMPTY;
        return TechTree.statsWithOwned(type, owned, this.types);
    }

    /** Resolve base + tech mods from an explicit owned set (deploy intel fog). */
    static statsWithOwned(type: UnitType, owned: ReadonlySet<string>, types: TypeRegistry): ResolvedStats {
        const stats: ResolvedStats = {
            hp: type.hp,
            damage: type.damage,
            range: type.range,
            minRange: type.minRange ?? 0,
            speed: type.speed,
            attackInterval: type.attackInterval,
            splashRadius: type.splashRadius ?? 0,
        };
        const techIds = new Set<string>(type.innateTechs ?? []);
        for (const id of owned) techIds.add(id);
        // Flat bonuses are summed and applied once, after the loop. Adding
        // them inside it made the result depend on iteration order — a range
        // multiplier on a tech that happened to come later would scale the
        // flat bonus too — and anything order-dependent in stats is one
        // refactor away from two peers disagreeing.
        let rangeAdd = 0;
        for (const techId of techIds) {
            const tech = types.talent(techId);
            if (!tech) continue;
            stats.hp *= tech.mods.hp ?? 1;
            stats.damage *= tech.mods.damage ?? 1;
            stats.range *= tech.mods.range ?? 1;
            stats.minRange *= tech.mods.range ?? 1;
            stats.speed *= tech.mods.speed ?? 1;
            stats.attackInterval *= tech.mods.attackInterval ?? 1;
            const splashMod = tech.mods.splashRadius ?? 1;
            if (splashMod !== 1) {
                // units with no splash get a baseline equal to the mod (e.g. Wide Blast → radius 3)
                if (stats.splashRadius <= 0) stats.splashRadius = splashMod;
                else stats.splashRadius *= splashMod;
            }
            rangeAdd += tech.mods.rangeAdd ?? 0;
        }
        // flat after ALL multipliers — same idea as Command Tower range boost
        stats.range += rangeAdd;
        return stats;
    }

    /** forgets an owned tech (action undo) — refunding is the caller's job */
    remove(seat: SeatId, typeId: string, techId: string): void {
        if (seat < 0 || seat >= this.owned.length) return;
        this.ownedFor(seat, typeId).delete(techId);
    }

    /**
     * Deep copy of current ownership — used as deploy-phase intel fog so the
     * opponent still sees last-round research until lock-in / battle.
     */
    snapshotOwned(): Map<string, Set<string>>[] {
        return this.owned.map((byType) => {
            const copy = new Map<string, Set<string>>();
            for (const [typeId, set] of byType) copy.set(typeId, new Set(set));
            return copy;
        });
    }

    /** read ownership from a {@link snapshotOwned} capture (empty if missing) */
    static ownedIn(
        snap: readonly Map<string, Set<string>>[] | null | undefined,
        seat: SeatId,
        typeId: string,
    ): ReadonlySet<string> {
        return snap?.[seat]?.get(typeId) ?? TechTree.EMPTY;
    }

    static readonly EMPTY: ReadonlySet<string> = new Set();
}
