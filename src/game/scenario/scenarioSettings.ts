/**
 * The scenario rules that GameSettings already expresses, written into the
 * settings a scenario match starts with. Done once, before the Game exists, so
 * the settings saved with resumes and replays already carry them.
 */
import type { LevelRef } from '../level';
import type { GameSettings } from '../settings';
import type { ScenarioDef } from './scenarioDef';

export function applyScenarioToSettings(
    settings: GameSettings,
    def: ScenarioDef,
    level: LevelRef | undefined,
    mode: 'play' | 'author' | 'test',
): GameSettings {
    const r = def.rules;
    settings.map = { ...def.map };
    settings.seed = def.seed;
    settings.economy = { ...settings.economy, startingSupply: r.income.round1, supplyGrowthPerRound: r.income.growth };
    settings.deploy = {
        ...settings.deploy,
        unitsPerRound: r.deploy.unitsPerRound,
        extrasBudgetPerRound: r.deploy.extrasBudgetPerRound,
    };
    settings.roundCardPreset = r.roundCards;
    settings.hordePreset = r.hordeWaves;
    settings.strongholdMode = r.strongholdMode;
    delete settings.climb;
    delete settings.tutorial;
    settings.level = level;
    settings.scenario = mode === 'play' ? { mode } : { mode, draft: def };
    return settings;
}
