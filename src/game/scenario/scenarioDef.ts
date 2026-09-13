/**
 * The scenario format (SANDBOX_LEVEL_EDITOR_PLAN.md §4–§6): a board setup plus
 * match rules, stored as `scenario.jsonc` at the root of a level package.
 * One format for the editor, testing, playing and later the campaign.
 *
 * Types only — `npm run content:schema` generates `scenario.schema.json` from
 * {@link ScenarioDef}, and `normalizeScenario` checks everything the schema
 * can't (ids against the match's registry, board bounds).
 */
import type { MapSize } from '../map';
import type { StrongholdMode } from '../settings';
import type { Season, TimeOfDay, WeatherKind } from '../weather';

export const SCENARIO_VERSION = 1;

export type SceneTeam = 'player' | 'enemy' | 'horde';

/** Reserved for the campaign; parsed, not evaluated yet. */
export type ScenarioObjective =
    | { kind: 'destroySide' }
    | { kind: 'surviveRounds'; rounds: number }
    | { kind: 'killTagged'; tag: string }
    | { kind: 'protectTagged'; tag: string };

/** A pack or building placed on the board at the start. */
export interface SceneUnit {
    /** any unit or building type the match has (base game + package) */
    typeId: string;
    team: SceneTeam;
    /** grid anchor (placement convention: top-left cell of the footprint) */
    at: { col: number; row: number; rotated?: boolean };
    /** 1 = recruit level */
    level: number;
    /** runes on this pack */
    items?: string[];
    /** hooks for objectives */
    tags?: string[];
}

/**
 * A base building at its anchor: omitted = normal level 1; `false` = not on the
 * board. `garrison` = manned posts for a type with a `garrison` attribute.
 */
export type SceneBuilding = { level: number; destroyed?: boolean; garrison?: number } | false;

/** base building type id → state */
export type SceneBuildings = Record<string, SceneBuilding>;

/**
 * The player's own loadout is the default; a scenario may be stricter or looser.
 */
export type LoadoutRule =
    | { mode: 'player' }
    /** own picks, but only these talents per type count */
    | { mode: 'restrict'; allow: Record<string, string[]> }
    /** the scenario sets the picks */
    | { mode: 'fixed'; techs: Record<string, string[]> }
    /** every talent in the type's list, no slot limit */
    | { mode: 'open' };

export interface ScenarioRules {
    /** round N grants round1 + (N-1) × growth (× the moneyFactor setting) */
    income: { round1: number; growth: number };
    deploy: { unitsPerRound: number; extrasBudgetPerRound: number };
    /** 'commander' = normal card HP; numbers = fixed per side, card HP ignored */
    sideHp: 'commander' | { player: number; enemy: number };
    /**
     * 'pick': the normal commander offer. 'fixed': the player gets this
     * commander (the opponent none); `starterArmy` decides whether its army
     * spawns. 'none': no commander anywhere — no army, no effects.
     */
    commander: { mode: 'pick' } | { mode: 'fixed'; id: string; starterArmy: boolean } | { mode: 'none' };
    /** round-card preset id, or 'off' */
    roundCards: string;
    /** horde preset id, or 'off' (placed horde units fight either way) */
    hordeWaves: string;
    /** round the flank strips open (normal: 2); null = never */
    flanksOpenFromRound: number | null;
    /** round the middle strip opens (normal: 2); null = never */
    neutralOpenFromRound: number | null;
    atmosphere: { season: Season; weather?: WeatherKind; time?: TimeOfDay; rotate: boolean };
    strongholdMode: StrongholdMode;
    /** what computer seats do in the build phase — they always lock in */
    opponents: 'build' | 'lockInOnly';
    /** fog on enemy deployment intel */
    enemyIntel: 'fogged' | 'visible';
    /** the player's shop unlocks (omit = what the commander gives) */
    unlockedUnits?: string[];
    /**
     * What the player's once-per-round unlock may add: omit = any buyable
     * unit (normal), `[]` = no unlocking, a list = only these.
     */
    unlockable?: string[];
    /** how the player's talent loadout applies (omit = the player's own) */
    loadout?: LoadoutRule;
}

export interface ScenarioDef {
    version: 1;
    /** game version at save time (for migrations) */
    gameVersion: string;
    id: string;
    name: string;
    description?: string;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    seed: number;
    map: MapSize;
    rules: ScenarioRules;
    scene: {
        units: SceneUnit[];
        /** talents owned per side, per unit type (innate talents are implicit) */
        techs: { player: Record<string, string[]>; enemy: Record<string, string[]> };
        buildings: { player: SceneBuildings; enemy: SceneBuildings };
    };
    objectives?: ScenarioObjective[];
}
