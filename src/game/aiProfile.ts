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
    /** levels its base buildings with what is left */
    buildingUpgrades: boolean;
}

export function aiFeatures(difficulty: AiDifficulty): AiFeatures {
    switch (difficulty) {
        case 'easy':
            return { unitChoice: 'poor', spells: false, buildingUpgrades: false };
        case 'medium':
            return { unitChoice: 'poor', spells: true, buildingUpgrades: true };
        case 'hard':
            return { unitChoice: 'counter', spells: true, buildingUpgrades: true };
    }
}
