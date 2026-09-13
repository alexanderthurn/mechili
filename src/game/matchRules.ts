/**
 * What a match does each round, decided once (plan §5). Core code reads these
 * rules instead of asking which mode it is in. Normal matches, the campaign
 * and tutorials resolve to exactly their existing behaviour; a scenario
 * supplies its own. Rules that a GameSettings field already expresses (map,
 * seed, income, deploy caps, round cards, horde, stronghold mode) are applied
 * to the settings instead — see scenario/scenarioSettings.ts.
 */
import type { LoadoutRule, ScenarioDef, ScenarioRules } from './scenario/scenarioDef';
import type { GameSettings } from './settings';
import { isTutorial } from './tutorial';

export interface MatchRules {
    /** round the flank strips open; null = never */
    flanksOpenFromRound: number | null;
    /** round the middle strip opens; null = never */
    neutralOpenFromRound: number | null;
    /** fixed HP per side instead of the commanders' HP; null = commander HP */
    fixedSideHp: { player: number; enemy: number } | null;
    commander: ScenarioRules['commander'];
    /** a fixed atmosphere for the whole match; null = the normal per-round rotation */
    fixedAtmosphere: ScenarioRules['atmosphere'] | null;
    /** what computer seats do in the build phase (they always lock in) */
    opponents: ScenarioRules['opponents'];
    enemyIntel: ScenarioRules['enemyIntel'];
    /** the player side's shop unlocks, replacing the commander's; null = the commander's */
    playerUnlocks: string[] | null;
    loadout: LoadoutRule;
}

export function resolveMatchRules(settings: GameSettings, scenario: ScenarioDef | null): MatchRules {
    if (scenario) {
        const r = scenario.rules;
        return {
            flanksOpenFromRound: r.flanksOpenFromRound,
            neutralOpenFromRound: r.neutralOpenFromRound,
            fixedSideHp: r.sideHp === 'commander' ? null : { ...r.sideHp },
            commander: r.commander,
            fixedAtmosphere: r.atmosphere.rotate ? null : r.atmosphere,
            opponents: r.opponents,
            enemyIntel: r.enemyIntel,
            playerUnlocks: r.unlockedUnits ?? null,
            loadout: r.loadout ?? { mode: 'player' },
        };
    }
    const tutorial = isTutorial(settings);
    const sharedHp = settings.climb?.sideHp ?? settings.tutorial?.sideHp ?? null;
    return {
        // tutorials never open flanks (Tutorial 1 has no flank strips at all)
        flanksOpenFromRound: tutorial ? null : 2,
        neutralOpenFromRound: 2,
        fixedSideHp: sharedHp === null ? null : { player: sharedHp, enemy: sharedHp },
        commander: { mode: 'pick' },
        fixedAtmosphere: null,
        opponents: 'build',
        enemyIntel: settings.climb || tutorial ? 'visible' : 'fogged',
        playerUnlocks: null,
        loadout: { mode: 'player' },
    };
}

/** Is the strip that opens from `openFrom` open in `round`? */
export function stripOpen(openFrom: number | null, round: number): boolean {
    return openFrom !== null && round >= openFrom;
}
