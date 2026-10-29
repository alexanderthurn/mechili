/**
 * An AI seat's two lobby settings (AI_PLAN.md): how well it plays
 * (difficulty) and how (personality). One AI; difficulty only switches
 * features off and makes choices poorer.
 */

export type AiDifficulty = 'easy' | 'medium' | 'hard';
export type AiPersonality = 'random' | 'rusher' | 'wide' | 'defender';

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'medium', 'hard'];
export const AI_PERSONALITIES: readonly AiPersonality[] = ['random', 'rusher', 'wide', 'defender'];

/** what a seat plays until someone picks otherwise (also a seat an AI takes over) */
export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'easy';
export const DEFAULT_AI_PERSONALITY: AiPersonality = 'random';

export function isAiDifficulty(v: unknown): v is AiDifficulty {
    return typeof v === 'string' && (AI_DIFFICULTIES as readonly string[]).includes(v);
}

export function isAiPersonality(v: unknown): v is AiPersonality {
    return typeof v === 'string' && (AI_PERSONALITIES as readonly string[]).includes(v);
}

/**
 * The personalities that fit a seat: all of them outside a Siege; a Siege
 * attacker can't sit behind walls (no Defender), a defender has no reason to
 * spread out (no Wide). `role` null = no Siege, or a role still open.
 */
export function personalitiesFor(role: 'attacker' | 'defender' | null): readonly AiPersonality[] {
    if (role === 'attacker') return ['random', 'rusher', 'wide'];
    if (role === 'defender') return ['random', 'rusher', 'defender'];
    return AI_PERSONALITIES;
}

/** what a difficulty switches */
export interface AiFeatures {
    /** 'poor': random among affordable types; 'counter': the planner's scored choice */
    unitChoice: 'poor' | 'counter';
    /** buys forge spells and casts its tactics */
    spells: boolean;
    /** reinforces a tower the last battle hurt: a level up, an archer on its top */
    buildingUpgrades: boolean;
    /** reacts to threats on its towers: 'none' (Easy), 'late' (last battle only), 'now' (also the threat map) */
    reaction: 'none' | 'late' | 'now';
    /** brings siege packs against the enemy's walls */
    antiWall: boolean;
    /** buys the +1 pack of the round, borrows when nearly dead, uses its card charges, sends spare supply to an ally */
    extras: boolean;
    /** army boosts: 'leftover' after the army, 'worth' as soon as one beats another pack */
    armyBoosts: 'none' | 'leftover' | 'worth';
    /** recruit level 2 and the round's range / speed boosts, where they fit */
    roundAbilities: boolean;
}

export function aiFeatures(difficulty: AiDifficulty): AiFeatures {
    switch (difficulty) {
        case 'easy':
            return { unitChoice: 'poor', spells: false, buildingUpgrades: false, reaction: 'none', antiWall: false, extras: false, armyBoosts: 'none', roundAbilities: false };
        case 'medium':
            return { unitChoice: 'poor', spells: true, buildingUpgrades: true, reaction: 'late', antiWall: false, extras: true, armyBoosts: 'leftover', roundAbilities: false };
        case 'hard':
            return { unitChoice: 'counter', spells: true, buildingUpgrades: true, reaction: 'now', antiWall: true, extras: true, armyBoosts: 'worth', roundAbilities: true };
    }
}

/** a personality as it plays: Random has picked one */
export type AiStyle = Exclude<AiPersonality, 'random'>;

/**
 * The style a seat plays and, for a Rusher, its side (0 = the side of its
 * lane's lower columns, 1 = the higher): Random picks among the styles that
 * fit the role, a picked style that doesn't fit plays as Random. `rnd` must
 * come from the match seed and the seat, so a resumed match plays the same.
 */
export function resolvePersonality(
    chosen: AiPersonality,
    role: 'attacker' | 'defender' | null,
    rnd: () => number,
): { style: AiStyle; rushSide: 0 | 1 } {
    const fits = personalitiesFor(role).filter((p): p is AiStyle => p !== 'random');
    const style = chosen !== 'random' && (fits as readonly AiPersonality[]).includes(chosen) ? (chosen as AiStyle) : fits[Math.floor(rnd() * fits.length)]!;
    return { style, rushSide: rnd() < 0.5 ? 0 : 1 };
}

/** how much of its supply a Defender may put into walls, posts and their levels in a round — the easier, the more */
export const DEFENDER_WALL_SHARE: Readonly<Record<AiDifficulty, number>> = { easy: 0.6, medium: 0.35, hard: 0.25 };
