/**
 * The specialist system: before round 1 each player picks a SPECIALIST card
 * — a starting army (equal total value), a starting HP pool, a permanent
 * speciality, and possibly pack items. The same card UI will later serve
 * between-round cards with different content.
 */

export type SpecialityId = 'air' | 'costControl' | 'elite' | 'archer' | 'addi' | 'flanky';

/** speciality tuning */
export const AIR_BONUS = 0.12; // air units: +12% attack & hp
export const COST_CONTROL_PENALTY = 0.12; // all units: −12% attack & hp ...
export const COST_CONTROL_INCOME = 100; // ... but +100 supply every round
export const FREE_ARCHER_ROUND = 2; // the archer specialist's gift arrives here
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

export const ROUND_CARDS: RoundCard[] = [
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
    {
        id: 'oilSpill',
        title: 'Oil Spill',
        cost: 50,
        tactics: ['oilSpill'],
        description:
            'Stamp oil on the shared ground layer. Connected oil ignites together when fire touches it (lasts 2 rounds).',
    },
    {
        id: 'sellPack',
        title: 'Buyback Deal',
        cost: 25,
        tactics: ['sellUnit'],
        description: 'One-shot tactic: sell one of your packs for a supply refund.',
    },
    {
        id: 'spawnDwarves',
        title: 'Summon Dwarves',
        cost: 100,
        tactics: ['spawnDwarves'],
        description:
            'Battle spell: mark a spot — a dwarf war band bursts from the ground there shortly after battle start (this battle only).',
    },
    {
        id: 'bigMeteor',
        title: 'Great Meteor',
        cost: 150,
        tactics: ['bigMeteor'],
        description:
            'Battle spell: mark a small area — seconds into the battle a meteor obliterates everything there (ward domes protect).',
    },
    {
        id: 'spawnCrows',
        title: 'Summon Crow Riders',
        cost: 125,
        tactics: ['spawnCrows'],
        description:
            'Battle spell: mark a spot — crow riders swoop in there shortly after battle start (this battle only).',
    },
    {
        id: 'hammerOfGods',
        title: 'Hammer of the Gods',
        cost: 200,
        tactics: ['hammerOfGods'],
        description:
            'Battle spell: a divine hammer stamps a HUGE area flat — severe damage to everything not under a ward dome.',
    },
    {
        id: 'storm',
        title: 'Storm Call',
        cost: 125,
        tactics: ['storm'],
        description:
            'Battle spell: a storm hurls lightning at random units in a wide area for a while (ward domes absorb the bolts).',
    },
    {
        id: 'meteorShower',
        title: 'Meteor Shower',
        cost: 125,
        tactics: ['meteorShower'],
        description:
            'Battle spell: meteors rain onto random spots in a wide area, each blast burning the ground it hits.',
    },
    {
        id: 'poisonCloud',
        title: 'Poison Cloud',
        cost: 100,
        tactics: ['poisonCloud'],
        description:
            'Battle spell: a toxic cloud gnaws at every unit inside for a while — gas seeps under ward domes.',
    },
    {
        id: 'acidSpill',
        title: 'Acid Spill',
        cost: 100,
        tactics: ['acidSpill'],
        description:
            'Battle spell: pour an acid capsule (placed like oil) — units inside lose max-HP percent per second and take extra damage while corroded.',
    },
    {
        id: 'fireSpill',
        title: 'Fire Spill',
        cost: 100,
        tactics: ['fireSpill'],
        description:
            'Battle spell: pour a fire capsule (placed like oil) — drips left-to-right shortly after battle start and sets the path ablaze (ward discs stay clear).',
    },
    {
        id: 'dragonAttack',
        title: 'Dragon Attack',
        cost: 200,
        tactics: ['dragonAttack'],
        description:
            'Battle spell: draw the dragon’s strafing path — it dives in and scorches units along the corridor under the beam, then leaves the ground ablaze. Ward domes absorb the breath (and pay for it).',
    },
];

/** buyable army types in the deployment shop (not board extras) */
export const SHOP_UNIT_IDS = ['dwarf', 'archer', 'crowRider', 'ballista'] as const;
export type ShopUnitId = (typeof SHOP_UNIT_IDS)[number];

/** once-per-round unlock fee by unit type */
export const UNIT_UNLOCK_COST: Record<ShopUnitId, number> = {
    dwarf: 0,
    archer: 0,
    crowRider: 50,
    ballista: 200,
};

/** the signature unit a specialist can buy even if it is not in the starter army */
export const SPECIALITY_UNLOCK: Record<SpecialityId, ShopUnitId> = {
    air: 'crowRider',
    costControl: 'archer',
    elite: 'ballista',
    archer: 'archer',
    addi: 'crowRider',
    flanky: 'dwarf',
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
        units: ['crowRider', 'crowRider', 'dwarf'],
        unitsLabel: '2× Crow Riders · 1× Dwarves',
        startingHp: 1800,
        speciality: 'air',
        description: 'Air units get +12% attack and HP.',
    },
    {
        id: 'cost',
        title: 'Cost Control Specialist',
        units: ['archer', 'archer', 'crowRider', 'dwarf'],
        unitsLabel: '2× Archers · 1× Crow Riders · 1× Dwarves',
        startingHp: 2400,
        speciality: 'costControl',
        description: 'All units −12% attack and HP, but +100 supply every round.',
    },
    {
        id: 'elite',
        title: 'Elite Specialist',
        units: ['ballista', 'dwarf'],
        unitsLabel: '1× Ballista · 1× Dwarves',
        startingHp: 1700,
        speciality: 'elite',
        description:
            'Recruiting at level 2 is permanently on, free of the switch fee (units still pay their level premium). +100 supply in round 1.',
    },
    {
        id: 'archer',
        title: 'Archer Specialist',
        units: ['archer', 'archer', 'archer', 'dwarf', 'dwarf'],
        unitsLabel: '3× Archers · 2× Dwarves',
        startingHp: 2000,
        speciality: 'archer',
        description: 'A free level-3 Archer arrives in round 2.',
    },
    {
        id: 'addi',
        title: 'Addi Specialist',
        units: ['crowRider', 'dwarf', 'dwarf', 'dwarf'],
        unitsLabel: '1× Crow Riders · 3× Dwarves',
        startingHp: 2000,
        speciality: 'addi',
        items: ['addi', 'addi', 'addi'],
        description: '3× Addi item: +15% attack and HP for one pack each.',
    },
    {
        id: 'flanky',
        title: 'Flanky Specialist',
        units: ['dwarf', 'dwarf', 'archer', 'archer'],
        unitsLabel: '2× Dwarves · 2× Archers',
        startingHp: 2000,
        speciality: 'flanky',
        description: 'First-time flank spawns take half the time (2.5s).',
    },
];
