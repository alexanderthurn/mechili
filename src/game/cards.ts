/**
 * The specialist system: before round 1 each player picks a SPECIALIST card
 * — a starting army (equal total value), a starting HP pool, a permanent
 * speciality, and possibly pack items. The same card UI will later serve
 * between-round cards with different content.
 */

export type SpecialityId = 'air' | 'costControl' | 'elite' | 'marksman' | 'addi' | 'flanky';

/** speciality tuning */
export const AIR_BONUS = 0.12; // air units: +12% attack & hp
export const COST_CONTROL_PENALTY = 0.12; // all units: −12% attack & hp ...
export const COST_CONTROL_INCOME = 100; // ... but +100 supply every round
export const FREE_MARKSMAN_ROUND = 2; // the marksman specialist's gift arrives here
export const FREE_MARKSMAN_LEVEL = 3;
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

export const ROUND_CARDS: RoundCard[] = [
    {
        id: 'crawlers4',
        title: 'Crawler Swarm',
        cost: 150,
        units: ['crawler', 'crawler', 'crawler', 'crawler'],
        unitsLabel: '4× Crawlers',
        description: 'Four Crawler packs join your army.',
    },
    {
        id: 'marksmen4',
        title: 'Sniper Company',
        cost: 150,
        units: ['marksman', 'marksman', 'marksman', 'marksman'],
        unitsLabel: '4× Marksman',
        description: 'Four Marksmen join your army.',
    },
    {
        id: 'wasps2',
        title: 'Air Wing',
        cost: 150,
        units: ['wasp', 'wasp'],
        unitsLabel: '2× Wasps',
        description: 'Two Wasp swarms join your army.',
    },
    {
        id: 'fortress1',
        title: 'Heavy Armor',
        cost: 150,
        units: ['fortress'],
        unitsLabel: '1× Fortress',
        description: 'A Fortress joins your army.',
    },
    {
        id: 'power',
        title: 'Power Module',
        cost: 0,
        items: ['power'],
        description: 'Item: +75% attack damage for one pack.',
    },
    {
        id: 'vigor',
        title: 'Vigor Core',
        cost: 50,
        items: ['vigor'],
        description: 'Item: +100% HP for one pack.',
    },
    {
        id: 'colossus',
        title: 'Colossus Plating',
        cost: 250,
        items: ['colossus'],
        description: 'Item: +250% HP for one pack.',
    },
    {
        id: 'wrath',
        title: 'Wrath Engine',
        cost: 300,
        items: ['wrath'],
        description: 'Item: +300% attack damage for one pack.',
    },
    {
        id: 'flanky',
        title: 'Flanky',
        cost: 100,
        flankSpawnHalf: true,
        description: 'First-time flank spawns take half the time (2.5s).',
    },
    {
        id: 'rallyRoute',
        title: 'Rally Route',
        cost: 50,
        tactics: ['rallyRoute'],
        description: 'Place a march route: units in the start zone head to the end zone, fighting along the way.',
    },
];

/** buyable army types in the deployment shop (not board extras) */
export const SHOP_UNIT_IDS = ['crawler', 'marksman', 'wasp', 'fortress'] as const;
export type ShopUnitId = (typeof SHOP_UNIT_IDS)[number];

/** once-per-round unlock fee by unit type */
export const UNIT_UNLOCK_COST: Record<ShopUnitId, number> = {
    crawler: 0,
    marksman: 0,
    wasp: 50,
    fortress: 200,
};

/** the signature unit a specialist can buy even if it is not in the starter army */
export const SPECIALITY_UNLOCK: Record<SpecialityId, ShopUnitId> = {
    air: 'wasp',
    costControl: 'marksman',
    elite: 'fortress',
    marksman: 'marksman',
    addi: 'wasp',
    flanky: 'crawler',
};

export interface StartCard {
    id: string;
    title: string;
    /** starting army as unit type ids — every card totals 500 supply */
    units: string[];
    /** the army, human-readable, for the card face */
    unitsLabel: string;
    startingHp: number;
    speciality: SpecialityId;
    /** pack items granted into the player's inventory */
    items?: string[];
    description: string;
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

export function unitUnlockCost(typeId: string): number {
    return UNIT_UNLOCK_COST[typeId as ShopUnitId] ?? Number.POSITIVE_INFINITY;
}

export const START_CARDS: StartCard[] = [
    {
        id: 'air',
        title: 'Air Specialist',
        units: ['wasp', 'wasp', 'crawler'],
        unitsLabel: '2× Wasps · 1× Crawlers',
        startingHp: 1800,
        speciality: 'air',
        description: 'Air units get +12% attack and HP.',
    },
    {
        id: 'cost',
        title: 'Cost Control Specialist',
        units: ['marksman', 'marksman', 'wasp', 'crawler'],
        unitsLabel: '2× Marksman · 1× Wasps · 1× Crawlers',
        startingHp: 2400,
        speciality: 'costControl',
        description: 'All units −12% attack and HP, but +100 supply every round.',
    },
    {
        id: 'elite',
        title: 'Elite Specialist',
        units: ['fortress', 'crawler'],
        unitsLabel: '1× Fortress · 1× Crawlers',
        startingHp: 1700,
        speciality: 'elite',
        description:
            'Recruiting at level 2 is permanently on, free of the switch fee (units still pay their level premium). +100 supply in round 1.',
    },
    {
        id: 'marksman',
        title: 'Marksman Specialist',
        units: ['marksman', 'marksman', 'marksman', 'crawler', 'crawler'],
        unitsLabel: '3× Marksman · 2× Crawlers',
        startingHp: 2000,
        speciality: 'marksman',
        description: 'A free level-3 Marksman arrives in round 2.',
    },
    {
        id: 'addi',
        title: 'Addi Specialist',
        units: ['wasp', 'crawler', 'crawler', 'crawler'],
        unitsLabel: '1× Wasps · 3× Crawlers',
        startingHp: 2000,
        speciality: 'addi',
        items: ['addi', 'addi', 'addi'],
        description: '3× Addi item: +15% attack and HP for one pack each.',
    },
    {
        id: 'flanky',
        title: 'Flanky Specialist',
        units: ['crawler', 'crawler', 'marksman', 'marksman'],
        unitsLabel: '2× Crawlers · 2× Marksman',
        startingHp: 2000,
        speciality: 'flanky',
        description: 'First-time flank spawns take half the time (2.5s).',
    },
];
