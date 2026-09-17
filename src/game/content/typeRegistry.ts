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
import type { RoundCard, RoundCardDrawPool, StartCard } from '../cards';
import type { ForgeRecipe } from '../forgeRecipes';
import type { ItemDef } from '../items';
import { generateElementalRunes, isRuneElement } from '../runeMix';
import type { TacticDef } from '../tactics';
import type { TechDef, UnitType } from '../units';
import type { ModelSpecData } from '../unitModels';
import type { BasePack } from './basePack';

export class TypeRegistry {
    /** shop grid, AI and every roster loop, in pack.jsonc order */
    readonly roster: readonly UnitType[];
    /** addressable by id, never in the roster (e.g. posted from a building panel) */
    readonly offRoster: readonly UnitType[];
    /** every building type the pack lists, in construction / preload order */
    readonly buildings: readonly UnitType[];
    /** the buildings every side starts with (those with a `baseAnchor`), in the same order */
    readonly baseBuildings: readonly UnitType[];
    /** model specs by model id */
    readonly models: Readonly<Record<string, ModelSpecData>>;
    /**
     * Buyable army types in the deployment shop, in roster order: no board
     * extras, no structures, nothing marked `buyable: false`.
     */
    readonly shopUnitIds: readonly string[];
    /** every unit type any shop can hold: the normal shop plus each commander's own */
    readonly allShopUnitIds: readonly string[];
    /** talent catalog by id */
    readonly talents: ReadonlyMap<string, TechDef>;
    /** rune catalog by id, in catalog order */
    readonly runes: ReadonlyMap<string, ItemDef>;
    /**
     * Shop-buyable pure L1 elementals (`earth` / `fire` / `water` / `wind`).
     * Mixes and higher levels come from the forge, not the shop.
     */
    readonly baseRuneIds: readonly string[];
    /** Card / commander specials, in catalog order */
    readonly advancedRuneIds: readonly string[];
    /** Optional exact oven recipes (overrides); elemental merge is the default */
    readonly forgeRecipes: readonly ForgeRecipe[];
    /** commanders offered to players, in draw order */
    readonly commanders: readonly StartCard[];
    /**
     * Every between-round card: advanced runes (at `cardCost`), then unit and
     * spell cards from data/roundCards. Shop bases are not dealt as cards.
     */
    readonly roundCards: readonly RoundCard[];

    /** spells (tactics), in catalog order */
    readonly tactics: readonly TacticDef[];

    private readonly commanderIndex: ReadonlyMap<string, StartCard>;
    private readonly tacticIndex: ReadonlyMap<string, TacticDef>;

    private readonly index: ReadonlyMap<string, UnitType>;
    private readonly talentsByType = new Map<string, readonly TechDef[]>();

    constructor(pack: BasePack) {
        this.roster = pack.roster;
        this.offRoster = pack.offRoster;
        this.buildings = pack.buildings;
        this.baseBuildings = pack.buildings.filter((b) => b.baseAnchor !== undefined);
        this.models = pack.models;
        this.index = new Map([...pack.roster, ...pack.offRoster, ...pack.buildings].map((t) => [t.id, t]));
        this.shopUnitIds = pack.roster
            .filter((t) => !t.extra && !t.structure && t.buyable !== false)
            .map((t) => t.id);
        this.talents = new Map(Object.entries(pack.talents));
        const authoredBase = pack.runes.filter((r) => r.tier === 'base');
        const advanced = pack.runes.filter((r) => r.tier === 'advanced');
        const elemental = generateElementalRunes(authoredBase);
        const allRunes = [...elemental, ...advanced];
        this.runes = new Map(allRunes.map((r) => [r.id, r]));
        // Shop sells only the four pure L1s authored in data — not mixes / L2+.
        this.baseRuneIds = authoredBase.filter((r) => isRuneElement(r.id)).map((r) => r.id);
        this.advancedRuneIds = advanced.map((r) => r.id);
        this.forgeRecipes = allRunes
            .filter((r) => r.forge)
            .map((r) => ({
                ingredients: [...r.forge!.ingredients],
                product: { kind: 'item' as const, id: r.id },
                priority: r.forge!.priority ?? 1,
            }))
            .sort((a, b) => a.ingredients.length - b.ingredients.length);
        this.commanders = pack.commanders;
        this.commanderIndex = new Map([...pack.commanders, ...pack.hiddenCommanders].map((c) => [c.id, c]));
        const factionUnits = [...pack.commanders, ...pack.hiddenCommanders].flatMap((c) => c.shop ?? []);
        this.allShopUnitIds = [...new Set([...this.shopUnitIds, ...factionUnits])];
        const runeCards: RoundCard[] = advanced.map((rune) => ({
            id: rune.id,
            title: rune.name,
            cost: rune.cardCost ?? 50,
            items: [rune.id],
            pool: 'runes',
            description: rune.description,
        }));
        this.roundCards = [...runeCards, ...pack.roundCards];
        this.tactics = pack.spells;
        this.tacticIndex = new Map(pack.spells.map((s) => [s.id, s]));
    }

    /** a spell by id — null for an unknown id */
    tactic(id: string): TacticDef | null {
        return this.tacticIndex.get(id) ?? null;
    }

    /** the unit types a side under this commander can buy or unlock (its own shop, else the normal one) */
    shopFor(commander: StartCard | null | undefined): readonly string[] {
        return commander?.shop ?? this.shopUnitIds;
    }

    /** a commander by id, including hidden tutorial ones */
    commander(id: string): StartCard | null {
        return this.commanderIndex.get(id) ?? null;
    }

    /** a between-round card by id */
    roundCard(id: string): RoundCard | null {
        return this.roundCards.find((c) => c.id === id) ?? null;
    }

    /** the cards an offer from `pool` deals from, in draw order */
    roundCardsInPool(pool: RoundCardDrawPool): RoundCard[] {
        return this.roundCards.filter((c) => c.pool === pool);
    }

    /** a rune by id — null for an unknown id */
    rune(id: string): ItemDef | null {
        return this.runes.get(id) ?? null;
    }

    /** a talent by id — null for an unknown id (a stale loadout, a peer's typo) */
    talent(id: string): TechDef | null {
        return this.talents.get(id) ?? null;
    }

    /**
     * Every talent this type can ever own: innate first, then its pickable
     * `talents`, deduplicated. Combat effects scan this list and ask the seat
     * which of them it owns.
     */
    talentsOf(type: UnitType): readonly TechDef[] {
        let list = this.talentsByType.get(type.id);
        if (!list) {
            const ids = new Set([...(type.innateTechs ?? []), ...(type.talents ?? [])]);
            list = [...ids].map((id) => this.talents.get(id)).filter((t): t is TechDef => t !== undefined);
            this.talentsByType.set(type.id, list);
        }
        return list;
    }

    /** the base building standing at an anchor, if the pack has one */
    baseBuilding(anchor: NonNullable<UnitType['baseAnchor']>): UnitType | null {
        return this.baseBuildings.find((b) => b.baseAnchor === anchor) ?? null;
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
        if (!type) return Number.POSITIVE_INFINITY;
        // a unit outside the normal shop has a price only for the commanders whose shop holds it
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
