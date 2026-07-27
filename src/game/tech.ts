import type { SeatId } from './seats';
import type { UnitType } from './units';

/** a unit type's combat stats after tech multipliers (level scaling is separate) */
export interface ResolvedStats {
    hp: number;
    damage: number;
    range: number;
    speed: number;
    attackInterval: number;
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

    constructor(seatCount: number) {
        this.owned = Array.from({ length: seatCount }, () => new Map());
    }

    ownedFor(seat: SeatId, typeId: string): Set<string> {
        const bySeat = this.owned[seat]!;
        let set = bySeat.get(typeId);
        if (!set) {
            set = new Set();
            bySeat.set(typeId, set);
        }
        return set;
    }

    has(seat: SeatId, typeId: string, techId: string): boolean {
        return this.ownedFor(seat, typeId).has(techId);
    }

    /** the actual purchase (charging, price escalation) lives in the action dispatcher */
    add(seat: SeatId, typeId: string, techId: string): void {
        this.ownedFor(seat, typeId).add(techId);
    }

    statsFor(seat: SeatId, type: UnitType): ResolvedStats {
        const stats: ResolvedStats = {
            hp: type.hp,
            damage: type.damage,
            range: type.range,
            speed: type.speed,
            attackInterval: type.attackInterval,
        };
        // horde units carry seat -1 (no economy, no tech) — never look them up
        const owned = seat >= 0 ? this.ownedFor(seat, type.id) : null;
        for (const tech of type.techs) {
            if (!owned?.has(tech.id)) continue;
            stats.hp *= tech.mods.hp ?? 1;
            stats.damage *= tech.mods.damage ?? 1;
            stats.range *= tech.mods.range ?? 1;
            stats.speed *= tech.mods.speed ?? 1;
            stats.attackInterval *= tech.mods.attackInterval ?? 1;
        }
        return stats;
    }

    /** forgets an owned tech (action undo) — refunding is the caller's job */
    remove(seat: SeatId, typeId: string, techId: string): void {
        this.ownedFor(seat, typeId).delete(techId);
    }
}
