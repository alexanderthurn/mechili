/**
 * The specialist system: before round 1 each player picks a SPECIALIST card
 * — a starting army (equal total value), a starting HP pool, a permanent
 * speciality, and possibly pack items. Between rounds, {@link ROUND_CARDS}
 * hold the full catalog; the live offer currently draws runes only.
 *
 * Each specialist also unlocks a small set of Stronghold forge spells
 * ({@link StartCard.forgeSpells}); teammates share the union of those lists.
 */

import { DISPLAY } from './displayNames';
import { ADVANCED_RUNE_IDS, BASE_RUNE_IDS, ITEMS } from './items';
import {
    ACID_ID,
    DRAGON_ID,
    FIRE_SPILL_ID,
    HAMMER_ID,
    METEOR_SHOWER_ID,
    OIL_SPILL_ID,
    POISON_CLOUD_ID,
    RALLY_ROUTE_ID,
    BIG_METEOR_ID,
    MOVE_UNIT_ID,
    SELL_UNIT_ID,
    SPAWN_CROWS_ID,
    SPAWN_DWARVES_ID,
    STORM_ID,
    TACTICS,
} from './tactics';
import { forgeIngredientIcons } from './forgeRecipes';

export type SpecialityId =
    | 'air'
    | 'costControl'
    | 'elite'
    | 'archer'
    | 'addi'
    | 'flanky'
    | 'meteor'
    | 'speed';

/** speciality tuning */
export const AIR_BONUS = 0.12; // air units: +12% attack & hp
export const COST_CONTROL_PENALTY = 0.12; // all units: −12% attack & hp ...
export const COST_CONTROL_INCOME = 100; // ... but +100 supply every round
export const FREE_ARCHER_ROUND = 2; // the archer specialist's gift arrives here
/** round a commander's gifted tactic charges (StartCard.tactics) land in */
export const SPECIALITY_TACTIC_ROUND = 2;
/**
 * Speedy Widow: flat movement bonus for every non-structure pack, permanently.
 * Same magnitude as the Vanguard's one-round speed boost
 * ({@link DeploySettings.speedBoost}) and applied the same way — added at the
 * very end, so runes cannot multiply it.
 */
export const SPEED_COMMANDER_BONUS = 3;
export const FREE_ARCHER_LEVEL = 3;
export const ELITE_ROUND1_BONUS = 100; // lets the elite afford two 150-supply level-2 units
/** flank spawn duration multiplier when the Flanky card/speciality is owned */
export const FLANK_SPAWN_HALF_MULT = 0.5;

/** skipping the between-round card pays this instead */
export const SKIP_CARD_REWARD = 50;

/** a between-round card: picked from a random 4 at each round start (round 2+) */
export interface RoundCard {
    id: string;
    title: string;
    /** supply price (0 = free) */
    cost: number;
    /** free units spawned on pick (movable that round) */
    units?: string[];
    unitsLabel?: string;
    /** items granted into the inventory */
    items?: string[];
    /** tactical order charges granted into the tactics strip */
    tactics?: string[];
    /** halves flank spawn time for the rest of the match */
    flankSpawnHalf?: boolean;
    description: string;
}

/** rune ids offered as between-round cards (catalog = base + advanced) */
const RUNE_ROUND_CARD_IDS = [...BASE_RUNE_IDS, ...ADVANCED_RUNE_IDS] as const;

/** supply cost overrides (default 50; base runes are free on round cards) */
const RUNE_ROUND_CARD_COST: Partial<Record<(typeof RUNE_ROUND_CARD_IDS)[number], number>> = {
    earth: 0,
    fire: 0,
    water: 0,
    wind: 0,
    colossus: 100, // Mithril Cuirass
    wrath: 100, // Berserk
};

function runeRoundCard(itemId: (typeof RUNE_ROUND_CARD_IDS)[number]): RoundCard {
    const item = ITEMS[itemId]!;
    return {
        id: itemId,
        title: item.name,
        cost: RUNE_ROUND_CARD_COST[itemId] ?? 50,
        items: [itemId],
        description: item.description,
    };
}

/** Rune cards in the between-round catalog (base + advanced). */
export const ROUND_RUNE_CARDS: RoundCard[] = RUNE_ROUND_CARD_IDS.map(runeRoundCard);

/**
 * Default match offer pool: the four base runes only.
 * Advanced runes come from the forge (and later modes/shop).
 */
export const ROUND_RUNE_ITEM_IDS: string[] = [...BASE_RUNE_IDS];

/**
 * Unit-pack between-round cards (kept for later; not in the live offer).
 */
export const ROUND_UNIT_CARDS: RoundCard[] = [
    {
        id: 'dwarves4',
        title: 'Dwarf Band',
        cost: 150,
        units: ['dwarf', 'dwarf', 'dwarf', 'dwarf'],
        unitsLabel: '4× Dwarves',
        description: 'Four Dwarf packs join your army.',
    },
    {
        id: 'archers4',
        title: 'Archer Company',
        cost: 150,
        units: ['archer', 'archer', 'archer', 'archer'],
        unitsLabel: '4× Archers',
        description: 'Four Archers join your army.',
    },
    {
        id: 'crowRiders2',
        title: 'Crow Wing',
        cost: 150,
        units: ['crowRider', 'crowRider'],
        unitsLabel: '2× Crow Riders',
        description: 'Two Crow Rider flocks join your army.',
    },
    {
        id: 'ballista1',
        title: 'Siege Ballista',
        cost: 150,
        units: ['ballista'],
        unitsLabel: '1× Ballista',
        description: 'A Ballista joins your army.',
    },
];

/**
 * Non-rune between-round cards (Rally, Buyback, Flanky).
 * Kept for later; not in the live offer for now.
 */
export const ROUND_EXTRA_CARDS: RoundCard[] = [
    {
        id: 'flanky',
        title: 'Flanky',
        cost: 50,
        flankSpawnHalf: true,
        description: 'First-time flank spawns take half the time (2.5s).',
    },
    {
        id: 'rallyRoute',
        title: 'Rally Route',
        cost: 50,
        tactics: [RALLY_ROUTE_ID],
        description:
            'Place a march route: units in the start zone head to the end zone, fighting along the way.',
    },
    {
        id: 'sellPack',
        title: 'Buyback',
        cost: 50,
        tactics: [SELL_UNIT_ID],
        description: 'One-shot spell: sell one of your packs for a supply refund.',
    },
    {
        id: 'movePack',
        title: 'Marching Orders',
        cost: 50,
        tactics: [MOVE_UNIT_ID],
        description:
            'One-shot spell: one pack from an earlier round may be repositioned again this round.',
    },
];

/**
 * Full between-round catalog (lookup by id). Live offers use
 * {@link drawRoundCardOffer} via {@link RoundCardAlgorithm} presets.
 */
export const ROUND_CARDS: RoundCard[] = [
    ...ROUND_RUNE_CARDS,
    ...ROUND_UNIT_CARDS,
    ...ROUND_EXTRA_CARDS,
];

/** shuffle in place with the given rng */
function shuffleInPlace<T>(deck: T[], rng: () => number): void {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
}

/** Which catalog slice a between-round offer draws from. */
export type RoundCardDrawPool = 'runes' | 'units' | 'spells';

function cardsForDrawPool(
    pool: RoundCardDrawPool,
    itemIds?: readonly string[],
): RoundCard[] {
    if (pool === 'units') return [...ROUND_UNIT_CARDS];
    if (pool === 'spells') return [...ROUND_EXTRA_CARDS];
    const allowed = itemIds?.length ? new Set(itemIds) : new Set(ROUND_RUNE_ITEM_IDS);
    return ROUND_RUNE_CARDS.filter((c) => allowed.has(c.id));
}

/**
 * Between-round offer: shuffle the configured pool and take up to `offerCount`.
 * Default pool is runes (filtered by `itemIds` / base runes).
 */
export function drawRoundCardOffer(
    rng: () => number,
    opts?: {
        itemIds?: readonly string[];
        offerCount?: number;
        pool?: RoundCardDrawPool;
    },
): RoundCard[] {
    const deck = cardsForDrawPool(opts?.pool ?? 'runes', opts?.itemIds);
    if (deck.length === 0) return [];
    const shuffled = [...deck];
    shuffleInPlace(shuffled, rng);
    const n = Math.max(1, opts?.offerCount ?? shuffled.length);
    return shuffled.slice(0, Math.min(n, shuffled.length));
}

/** Classify a round card for offer-title wording. */
export function roundCardKind(c: RoundCard): 'rune' | 'unit' | 'spell' | 'other' {
    if (c.items?.length) return 'rune';
    if (c.units?.length) return 'unit';
    if (c.tactics?.length) return 'spell';
    return 'other';
}

/**
 * Title for the between-round picker. When every offered card is the same
 * kind: "Choose your rune" / "Choose your unit pack" / "Choose your spell"; mixed
 * offers stay generic.
 */
export function roundOfferTitle(cards: readonly RoundCard[]): string {
    if (cards.length === 0) return 'Choose your card';
    const kinds = new Set(cards.map(roundCardKind));
    if (kinds.size !== 1) return 'Choose your card';
    switch ([...kinds][0]) {
        case 'rune':
            return `Choose your ${DISPLAY.item.toLowerCase()}`;
        case 'unit':
            return 'Choose your unit pack';
        case 'spell':
            return `Choose your ${DISPLAY.tactic.toLowerCase()}`;
        default:
            return 'Choose your card';
    }
}
/** atlas icon for a round-card face (rune / tactic / Flanky) */
export function roundCardIcon(c: RoundCard): string | null {
    const itemId = c.items?.[0];
    if (itemId) return ITEMS[itemId]?.icon ?? null;
    const tacticId = c.tactics?.[0];
    if (tacticId) return TACTICS[tacticId]?.icon ?? null;
    if (c.flankSpawnHalf) return 'spec-flanky';
    return null;
}

/** buyable army types in the deployment shop (not board extras) */
export const SHOP_UNIT_IDS = ['dwarf', 'archer', 'crowRider', 'ballista', 'wizard'] as const;
export type ShopUnitId = (typeof SHOP_UNIT_IDS)[number];

/** the signature unit a specialist can buy even if it is not in the starter army */
export const SPECIALITY_UNLOCK: Record<SpecialityId, ShopUnitId> = {
    air: 'crowRider',
    costControl: 'archer',
    elite: 'ballista',
    archer: 'archer',
    addi: 'crowRider',
    flanky: 'dwarf',
    meteor: 'wizard',
    speed: 'crowRider',
};

export interface StartCard {
    id: string;
    title: string;
    /** atlas portrait for the specialist card face (`spec-*`) */
    portrait: string;
    /** starting army as unit type ids — every card totals 500 supply */
    units: string[];
    /** the army, human-readable, for the card face */
    unitsLabel: string;
    startingHp: number;
    speciality: SpecialityId;
    /** pack items granted into the player's inventory */
    items?: string[];
    /**
     * Tactic charges this commander is gifted — NOT at pick time: they arrive
     * at the start of round {@link SPECIALITY_TACTIC_ROUND}, like the archer's
     * free unit. Round 1 stays clean of commander spells.
     */
    tactics?: string[];
    /**
     * Stronghold forge spells this specialist unlocks (tactic ids).
     * Teammates share the union. One 1-rune, one 2-rune, one 3-rune spell.
     */
    forgeSpells: string[];
    description: string;
}

/** atlas icons for a specialist's forge spell row */
export function startCardForgeIcons(
    card: StartCard,
): { icon: string; name: string; desc: string; ingredientIcons: string[] }[] {
    const out: { icon: string; name: string; desc: string; ingredientIcons: string[] }[] = [];
    for (const id of card.forgeSpells) {
        const t = TACTICS[id];
        if (t) {
            out.push({
                icon: t.icon,
                name: t.name,
                desc: t.description,
                ingredientIcons: forgeIngredientIcons(id),
            });
        }
    }
    return out;
}

/** starter packs + the specialist's signature unit */
export function starterUnlockedUnits(card: StartCard): ShopUnitId[] {
    const ids = new Set<ShopUnitId>();
    for (const id of card.units) {
        if ((SHOP_UNIT_IDS as readonly string[]).includes(id)) ids.add(id as ShopUnitId);
    }
    ids.add(SPECIALITY_UNLOCK[card.speciality]);
    return SHOP_UNIT_IDS.filter((id) => ids.has(id));
}

export const START_CARDS: StartCard[] = [
    {
        id: 'air',
        title: 'Sky Sorcerer',
        portrait: 'spec-air',
        units: ['crowRider', 'crowRider', 'dwarf'],
        unitsLabel: '2× Crow Riders · 1× Dwarves',
        startingHp: 2700,
        speciality: 'air',
        forgeSpells: [FIRE_SPILL_ID, SPAWN_CROWS_ID, DRAGON_ID],
        description: 'Air units get +12% attack and HP.',
    },
    {
        id: 'cost',
        title: 'Greedy Prince',
        portrait: 'spec-cost',
        units: ['archer', 'archer', 'crowRider', 'dwarf'],
        unitsLabel: '2× Archers · 1× Crow Riders · 1× Dwarves',
        startingHp: 2600,
        speciality: 'costControl',
        forgeSpells: [OIL_SPILL_ID, POISON_CLOUD_ID, DRAGON_ID],
        description: 'All units −12% attack and HP, but +100 supply every round.',
    },
    {
        id: 'elite',
        title: 'Elite Prince',
        portrait: 'spec-elite',
        units: ['ballista', 'dwarf'],
        unitsLabel: '1× Ballista · 1× Dwarves',
        startingHp: 3600,
        speciality: 'elite',
        forgeSpells: [FIRE_SPILL_ID, SPAWN_CROWS_ID, HAMMER_ID],
        description:
            'Recruiting at level 2. +100 supply in round 1.',
    },
    {
        id: 'archer',
        title: 'Archer Commander',
        portrait: 'spec-archer',
        units: ['archer', 'archer', 'archer', 'dwarf', 'dwarf'],
        unitsLabel: '3× Archers · 2× Dwarves',
        startingHp: 3000,
        speciality: 'archer',
        forgeSpells: [FIRE_SPILL_ID, STORM_ID, METEOR_SHOWER_ID],
        description: 'A free level-3 Archer arrives in round 2.',
    },
    {
        id: 'addi',
        title: 'Relic Keeper',
        portrait: 'spec-addi',
        units: ['crowRider', 'dwarf', 'dwarf', 'dwarf'],
        unitsLabel: '1× Crow Riders · 3× Dwarves',
        startingHp: 3000,
        speciality: 'addi',
        items: ['addi', 'addi', 'addi'],
        forgeSpells: [OIL_SPILL_ID, ACID_ID, HAMMER_ID],
        description: '3× Valor rune: +15% attack and HP for one pack each.',
    },
    {
        id: 'meteor',
        title: 'Lord Hitzkopf',
        portrait: 'spec-meteor',
        units: ['wizard', 'dwarf'],
        unitsLabel: '1× Wizard · 1× Dwarves',
        startingHp: 2500,
        speciality: 'meteor',
        tactics: [BIG_METEOR_ID, BIG_METEOR_ID],
        forgeSpells: [FIRE_SPILL_ID, BIG_METEOR_ID, METEOR_SHOWER_ID],
        description: 'Gets 2 Meteor charges in round 2.',
    },
    {
        id: 'speed',
        title: 'Speedy Widow',
        portrait: 'spec-speed',
        units: ['crowRider', 'archer', 'dwarf', 'dwarf'],
        unitsLabel: '1× Crow Riders · 1× Archers · 2× Dwarves',
        startingHp: 3000,
        speciality: 'speed',
        forgeSpells: [OIL_SPILL_ID, SPAWN_CROWS_ID, DRAGON_ID],
        description: `All units move +${SPEED_COMMANDER_BONUS} faster.`,
    },
    {
        id: 'flanky',
        title: 'Flanky Shadow',
        portrait: 'spec-flanky',
        units: ['dwarf', 'dwarf', 'archer', 'archer'],
        unitsLabel: '2× Dwarves · 2× Archers',
        startingHp: 3000,
        speciality: 'flanky',
        forgeSpells: [SPAWN_DWARVES_ID, POISON_CLOUD_ID, METEOR_SHOWER_ID],
        description: 'First-time flank spawns take half the time.',
    },
];
