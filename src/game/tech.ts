import type { Economy } from './settings';
import type { Team, TechDef, UnitType } from './units';

/** a unit type's combat stats after tech multipliers (level scaling is separate) */
export interface ResolvedStats {
    hp: number;
    damage: number;
    range: number;
    speed: number;
    attackInterval: number;
}

/**
 * Which techs each side owns, per unit type. A bought tech applies to every
 * pack of that type the buyer fields — current and future.
 */
export class TechTree {
    private readonly owned: Record<Team, Map<string, Set<string>>> = {
        player: new Map(),
        enemy: new Map(),
    };

    ownedFor(team: Team, typeId: string): Set<string> {
        let set = this.owned[team].get(typeId);
        if (!set) {
            set = new Set();
            this.owned[team].set(typeId, set);
        }
        return set;
    }

    has(team: Team, typeId: string, techId: string): boolean {
        return this.ownedFor(team, typeId).has(techId);
    }

    buy(team: Team, type: UnitType, tech: TechDef, economy: Economy): boolean {
        if (this.has(team, type.id, tech.id)) return false;
        if (!economy.spend(team, tech.cost)) return false;
        this.ownedFor(team, type.id).add(tech.id);
        return true;
    }

    statsFor(team: Team, type: UnitType): ResolvedStats {
        const stats: ResolvedStats = {
            hp: type.hp,
            damage: type.damage,
            range: type.range,
            speed: type.speed,
            attackInterval: type.attackInterval,
        };
        const owned = this.ownedFor(team, type.id);
        for (const tech of type.techs) {
            if (!owned.has(tech.id)) continue;
            stats.hp *= tech.mods.hp ?? 1;
            stats.damage *= tech.mods.damage ?? 1;
            stats.range *= tech.mods.range ?? 1;
            stats.speed *= tech.mods.speed ?? 1;
            stats.attackInterval *= tech.mods.attackInterval ?? 1;
        }
        return stats;
    }

    /** snapshot of a side's owned techs (for build-phase undo) */
    snapshot(team: Team): Map<string, Set<string>> {
        const copy = new Map<string, Set<string>>();
        for (const [typeId, set] of this.owned[team]) copy.set(typeId, new Set(set));
        return copy;
    }

    restore(team: Team, snapshot: Map<string, Set<string>>): void {
        this.owned[team].clear();
        for (const [typeId, set] of snapshot) this.owned[team].set(typeId, new Set(set));
    }
}
