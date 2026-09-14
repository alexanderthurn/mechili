/**
 * The scenario rules that GameSettings already expresses, written into the
 * settings a scenario match starts with. Done once, before the Game exists, so
 * the settings saved with resumes and replays already carry them.
 */
import type { LevelRef } from '../level';
import type { GameSettings } from '../settings';
import type { ScenarioDef } from './scenarioDef';

/** what the editor's purse shows (purchases are free there anyway) */
const EDITOR_SUPPLY = 99_999;
const EDITOR_DEPLOY_CAP = 999;

export function applyScenarioToSettings(
    settings: GameSettings,
    def: ScenarioDef,
    level: LevelRef | undefined,
    mode: 'play' | 'author' | 'test',
    /** the scenario's id inside the level package (play) */
    id?: string,
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
    if (mode === 'author') {
        // the editor's sandbox deployment: no caps, a purse that never runs dry
        settings.economy = { ...settings.economy, startingSupply: EDITOR_SUPPLY, supplyGrowthPerRound: 0 };
        settings.deploy = { ...settings.deploy, unitsPerRound: EDITOR_DEPLOY_CAP, extrasBudgetPerRound: EDITOR_SUPPLY };
    }
    settings.roundCardPreset = r.roundCards;
    settings.hordePreset = r.hordeWaves;
    settings.strongholdMode = r.strongholdMode;
    delete settings.climb;
    delete settings.tutorial;
    settings.level = level;
    settings.scenario = mode === 'play' ? { mode, ...(id !== undefined ? { id } : {}) } : { mode, draft: def };
    return settings;
}
