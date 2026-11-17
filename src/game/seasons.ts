/**
 * The Seasons game setting: which year-tour scenes a match's rounds run
 * through (weather.ts sceneIndexForRound turns it into a scene per round).
 * Its own small module so the settings and the lobby don't pull in the
 * weather renderer.
 *
 * - `year`         — the whole year from early spring, one scene a round (wraps)
 * - `randomYear`   — the whole year, from a random scene
 * - `randomSeason` — one season picked at random, kept the whole match
 * - `spring` … `winter` — that season's one scene every round: Spring morning,
 *                    Summer golden, Autumn storm, Deep winter
 *
 * The random ones draw from the match seed, so every player (and the replay)
 * sees the same.
 */
export type SeasonsMode = 'randomYear' | 'year' | 'randomSeason' | 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS_MODES: readonly SeasonsMode[] = ['randomYear', 'year', 'randomSeason', 'spring', 'summer', 'autumn', 'winter'];
export const DEFAULT_SEASONS_MODE: SeasonsMode = 'randomSeason';

export function seasonsModeOption(raw: unknown): SeasonsMode {
    return SEASONS_MODES.includes(raw as SeasonsMode) ? (raw as SeasonsMode) : DEFAULT_SEASONS_MODE;
}
