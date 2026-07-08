import { STANDARD_MAP, type MapSize } from './map';
import type { Team, UnitType } from './units';

/**
 * Everything that defines a match, as one plain JSON-serializable object —
 * so different game modes are just different settings, and multiplayer can
 * pass them around (lobby, server list, replay header).
 */
export interface GameSettings {
    map: MapSize;
    /** phase lengths in seconds */
    buildTimeSeconds: number;
    battleTimeSeconds: number;
    economy: EconomySettings;
}

export interface EconomySettings {
    /** supply each player has in round 1 */
    startingSupply: number;
    /** supply granted at the start of every following round */
    supplyPerRound: number;
    /** cost per unit type id; a type missing here falls back to its built-in cost */
    unitCosts: Record<string, number>;
}

export const DEFAULT_SETTINGS: GameSettings = {
    map: STANDARD_MAP,
    buildTimeSeconds: 90,
    battleTimeSeconds: 90,
    economy: {
        startingSupply: 200,
        supplyPerRound: 200,
        unitCosts: {
            crawler: 100,
            marksman: 100,
            fortress: 400,
        },
    },
};

/** Both players' supply balances, driven by an {@link EconomySettings}. */
export class Economy {
    private readonly balances: Record<Team, number> = { player: 0, enemy: 0 };

    constructor(private readonly settings: EconomySettings) {}

    costOf(type: UnitType): number {
        return this.settings.unitCosts[type.id] ?? type.cost;
    }

    balance(team: Team): number {
        return this.balances[team];
    }

    /** round 1 grants the starting supply, every later round the per-round income */
    grantRoundIncome(round: number): void {
        const income = round === 1 ? this.settings.startingSupply : this.settings.supplyPerRound;
        this.balances.player += income;
        this.balances.enemy += income;
    }

    canAfford(team: Team, type: UnitType): boolean {
        return this.balances[team] >= this.costOf(type);
    }

    /** deducts the cost; returns false (and deducts nothing) when unaffordable */
    charge(team: Team, type: UnitType): boolean {
        const cost = this.costOf(type);
        if (this.balances[team] < cost) return false;
        this.balances[team] -= cost;
        return true;
    }
}
