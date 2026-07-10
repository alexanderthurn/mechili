/**
 * The specialist system: before round 1 each player picks a SPECIALIST card
 * — a starting army (equal total value), a starting HP pool, a permanent
 * speciality, and possibly pack items. The same card UI will later serve
 * between-round cards with different content.
 */

export type SpecialityId = 'air' | 'costControl' | 'elite' | 'marksman' | 'addi';

/** speciality tuning */
export const AIR_BONUS = 0.12; // air units: +12% attack & hp
export const COST_CONTROL_PENALTY = 0.12; // all units: −12% attack & hp ...
export const COST_CONTROL_INCOME = 100; // ... but +100 supply every round
export const FREE_MARKSMAN_ROUND = 2; // the marksman specialist's gift arrives here
export const FREE_MARKSMAN_LEVEL = 3;
export const ELITE_ROUND1_BONUS = 100; // lets the elite afford two 150-supply level-2 units

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
];
