/**
 * An AI seat's two lobby settings (AI_PLAN.md): how well it plays
 * (difficulty) and how (personality). One AI; for now every difficulty
 * plays Hard — parts come out of it for the easier ones once it plays well.
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

/** how much of its supply a Defender may put into walls, posts and their levels in a round */
export const DEFENDER_WALL_SHARE = 0.25;
