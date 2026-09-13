/**
 * The unit and building definitions ONE match plays with (plan §17.8).
 *
 * The base game has one registry, `BASE_TYPES` (units.ts). A match gets its
 * own — today always the base one; with scenarios, the base definitions plus a
 * level's replacements and additions. Match code asks its registry
 * (`game.types.byId('stronghold')`) instead of reaching for module constants,
 * so a level's definitions never leak into the menu, another match, or the
 * base game.
 *
 * Only type imports from the game here: units.ts builds `BASE_TYPES` from this
 * module.
 */
import type { UnitType } from '../units';
import type { ModelSpecData } from '../unitModels';
import type { BasePack } from './basePack';

export class TypeRegistry {
    /** shop grid, AI and every roster loop, in pack.jsonc order */
    readonly roster: readonly UnitType[];
    /** addressable by id, never in the roster (e.g. posted from a building panel) */
    readonly offRoster: readonly UnitType[];
    /** base buildings, in construction / preload order */
    readonly buildings: readonly UnitType[];
    /** model specs by model id */
    readonly models: Readonly<Record<string, ModelSpecData>>;
    /**
     * Buyable army types in the deployment shop, in roster order: no board
     * extras, no structures, nothing marked `buyable: false`.
     */
    readonly shopUnitIds: readonly string[];

    private readonly index: ReadonlyMap<string, UnitType>;

    constructor(pack: BasePack) {
        this.roster = pack.roster;
        this.offRoster = pack.offRoster;
        this.buildings = pack.buildings;
        this.models = pack.models;
        this.index = new Map([...pack.roster, ...pack.offRoster, ...pack.buildings].map((t) => [t.id, t]));
        this.shopUnitIds = pack.roster
            .filter((t) => !t.extra && !t.structure && t.buyable !== false)
            .map((t) => t.id);
    }

    /** every type: roster, off-roster and buildings */
    all(): IterableIterator<UnitType> {
        return this.index.values();
    }

    /** lookup by id — actions and replays store unit types as strings */
    byId(id: string): UnitType | null {
        return this.index.get(id) ?? null;
    }

    /** lookup that must succeed (a type the code itself names) */
    require(id: string): UnitType {
        const type = this.index.get(id);
        if (!type) throw new Error(`[types] this match has no unit type "${id}"`);
        return type;
    }

    /** once-per-deployment shop unlock fee; Infinity for types that can't be unlocked */
    unlockCost(typeId: string): number {
        const type = this.index.get(typeId);
        if (!type || type.buyable === false) return Number.POSITIVE_INFINITY;
        return type.unlockCost ?? Number.POSITIVE_INFINITY;
    }

    /**
     * Price of the next post on a garrison building that already has `manned`
     * units posted — the posted type's cost plus one `priceStep` per earlier
     * post. Shared by the action and the panel so they can't quote different prices.
     */
    garrisonPostCost(host: UnitType, manned: number): number {
        const g = host.garrison;
        if (!g) return Number.POSITIVE_INFINITY;
        return (this.byId(g.unitTypeId)?.cost ?? 0) + g.priceStep * manned;
    }
}
