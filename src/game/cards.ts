/**
 * The card system: before round 1 each player picks one of four loadout
 * cards — a starting army (equal total value), a starting HP pool, and a
 * permanent speciality. The same UI will later serve between-round cards
 * with different content.
 */

export type SpecialityId = 'air' | 'costControl' | 'elite' | 'marksman';

/** speciality tuning */
export const AIR_BONUS = 0.12; // air units: +12% attack & hp
export const COST_CONTROL_PENALTY = 0.12; // all units: −12% attack & hp ...
export const COST_CONTROL_INCOME = 100; // ... but +100 supply every round
export const FREE_MARKSMAN_ROUND = 2; // the marksman specialist's gift arrives here
export const FREE_MARKSMAN_LEVEL = 3;

export interface StartCard {
    id: string;
    title: string;
    /** starting army as unit type ids — every card totals 500 supply */
    units: string[];
    /** the army, human-readable, for the card face */
    unitsLabel: string;
    startingHp: number;
    speciality: SpecialityId;
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
        description: 'Every recruit arrives at level 2, free — no switch needed.',
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
];
