/**
 * Turn the board of a watched replay into a scenario (plan §9.1): every pack
 * with its level and runes, the base buildings with level and manned posts,
 * side talents, side HP, open strips, the weather and the watched side's
 * commander and shop. "That fight was weird" becomes a scenario that can be
 * played again — the captured opponent's army stands as placed and only locks
 * in.
 *
 * Teams are as the viewer sees them: the watched side is `player`.
 */
import type { TypeRegistry } from '../content/typeRegistry';
import { CELL } from '../map';
import type { MatchRules } from '../matchRules';
import type { PlacementController } from '../placement';
import type { SeatId } from '../seats';
import type { GameSettings } from '../settings';
import type { TechTree } from '../tech';
import type { Team, Unit } from '../units';
import type { Atmosphere } from '../weather';
import {
    SCENARIO_VERSION,
    type SceneBuildings,
    type ScenarioDef,
    type ScenarioRules,
    type SceneTeam,
    type SceneUnit,
} from './scenarioDef';

/** the match state a capture reads — nothing else */
export interface CaptureHost {
    readonly types: TypeRegistry;
    readonly settings: GameSettings;
    readonly rules: MatchRules;
    readonly placement: PlacementController;
    readonly techTree: TechTree;
    readonly round: number;
    readonly hp: { player: number; enemy: number };
    readonly flanksOpen: boolean;
    readonly neutralOpen: boolean;
    /** null when weather effects are off */
    readonly atmosphere: Atmosphere | null;
    /** the watched side's commander card id, null before its pick */
    readonly playerCommanderId: string | null;
    readonly playerUnlocks: readonly string[];
    readonly gameVersion: string;
    /**
     * The rules of the scenario the replay itself played, when the watched
     * side is the side those rules were written for — carried into the capture
     * where they aren't board state. Null otherwise.
     */
    readonly baseRules: ScenarioRules | null;
    primarySeat(team: Team): SeatId;
}

/** what reading the board needs */
export type SceneCaptureHost = Pick<CaptureHost, 'types' | 'placement' | 'techTree' | 'primarySeat'>;

/** a board read back: `units[i]` stands for `scene.units[i]`, `buildings` are the base buildings on it */
export interface CapturedScene {
    scene: ScenarioDef['scene'];
    units: Unit[];
    buildings: Unit[];
}

/** a grid anchor for a gridless pack (horde), from its world position */
function anchorOfWorld(host: SceneCaptureHost, unit: Unit): { col: number; row: number } {
    const map = host.placement.map;
    const { cols, rows } = unit.type.footprint;
    return {
        col: Math.round((unit.world.x + map.halfW) / CELL - cols / 2),
        row: Math.round((map.halfH - unit.world.z) / CELL - rows / 2),
    };
}

/**
 * The board as a scene: every pack with level and runes (garrison posts count
 * for their building, wave packs and summons don't), the base buildings, each
 * side's talents.
 */
export function captureScene(
    host: SceneCaptureHost,
    /** the base buildings at their anchors, when known — others of a base type are placed packs */
    baseBuildings: ReadonlySet<Unit> | null = null,
): CapturedScene {
    const { types } = host;
    const baseBuildingIds = new Set(types.buildings.map((b) => b.id));
    const units: SceneUnit[] = [];
    const unitOf: Unit[] = [];
    const baseUnits: Unit[] = [];
    const buildings: { player: SceneBuildings; enemy: SceneBuildings } = { player: {}, enemy: {} };
    const all = host.placement.allUnits();

    for (const team of ['player', 'enemy'] as const) {
        for (const id of baseBuildingIds) buildings[team][id] = false;
    }
    for (const unit of all) {
        // wave packs and one-battle summons leave the board; posted archers are their building's garrison
        if (unit.consumed || unit.summoned || unit.hostUnitId !== null) continue;
        const team = unit.team as SceneTeam;
        const isBase = baseBuildings ? baseBuildings.has(unit) : baseBuildingIds.has(unit.type.id);
        if (team !== 'horde' && isBase) {
            const garrison = all.filter((u) => u.hostUnitId === unit.id).length;
            buildings[team][unit.type.id] = {
                level: unit.level,
                ...(garrison > 0 ? { garrison } : {}),
            };
            baseUnits.push(unit);
            continue;
        }
        const at = unit.gridless ? anchorOfWorld(host, unit) : { col: unit.cell.col, row: unit.cell.row };
        units.push({
            typeId: unit.type.id,
            team,
            at: unit.rotated ? { ...at, rotated: true } : at,
            level: unit.level,
            ...(unit.items.length > 0 ? { items: [...unit.items] } : {}),
        });
        unitOf.push(unit);
    }
    // canonical order the scenario will be applied in (stable within a team)
    const teamOrder: Record<SceneTeam, number> = { player: 0, enemy: 1, horde: 2 };
    const order = units.map((_, i) => i).sort((a, b) => teamOrder[units[a]!.team] - teamOrder[units[b]!.team] || a - b);

    const techs: ScenarioDef['scene']['techs'] = { player: {}, enemy: {} };
    for (const team of ['player', 'enemy'] as const) {
        const seat = host.primarySeat(team);
        for (const type of [...types.roster, ...types.offRoster]) {
            const owned = [...host.techTree.ownedFor(seat, type.id)];
            if (owned.length > 0) techs[team][type.id] = owned.sort();
        }
    }
    return {
        scene: { units: order.map((i) => units[i]!), techs, buildings },
        units: order.map((i) => unitOf[i]!),
        buildings: baseUnits,
    };
}

export function captureScenario(host: CaptureHost, name: string): ScenarioDef {
    const { settings, types, rules, round } = host;
    const { scene } = captureScene(host);

    const commanderId = host.playerCommanderId;
    const commander: ScenarioDef['rules']['commander'] =
        commanderId && types.commanders.some((c) => c.id === commanderId)
            ? { mode: 'fixed', id: commanderId, starterArmy: false }
            : { mode: 'none' };
    const { startingSupply, supplyGrowthPerRound } = settings.economy;
    const atmosphere = host.atmosphere;
    const stamp = new Date().toISOString();

    return {
        version: SCENARIO_VERSION,
        gameVersion: host.gameVersion,
        id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capture'}-${stamp.slice(0, 19).replace(/[^0-9]/g, '')}`,
        name,
        description: `Captured from a replay in round ${round}.`,
        createdAt: stamp,
        seed: settings.seed ?? 1,
        map: { ...settings.map },
        rules: {
            // round 1 of the scenario grants what this round granted
            income: { round1: startingSupply + Math.max(0, round - 1) * supplyGrowthPerRound, growth: supplyGrowthPerRound },
            deploy: {
                unitsPerRound: settings.deploy.unitsPerRound,
                extrasBudgetPerRound: settings.deploy.extrasBudgetPerRound,
            },
            sideHp: { player: Math.max(1, Math.round(host.hp.player)), enemy: Math.max(1, Math.round(host.hp.enemy)) },
            commander,
            roundCards: settings.roundCardPreset,
            hordeWaves: settings.hordePreset,
            flanksOpenFromRound: host.flanksOpen ? 1 : rules.flanksOpenFromRound,
            neutralOpenFromRound: host.neutralOpen ? 1 : rules.neutralOpenFromRound,
            atmosphere: atmosphere
                ? { season: atmosphere.season, weather: atmosphere.weatherKind, time: atmosphere.timeOfDay, rotate: false }
                : { season: 'summer', rotate: true },
            strongholdMode: settings.strongholdMode,
            opponents: 'lockInOnly',
            enemyIntel: rules.enemyIntel,
            unlockedUnits: [...host.playerUnlocks],
            // what the original scenario decided for this side and the board doesn't show
            ...(host.baseRules?.unlockable ? { unlockable: [...host.baseRules.unlockable] } : {}),
            ...(host.baseRules?.loadout ? { loadout: structuredClone(host.baseRules.loadout) } : {}),
        },
        scene,
    };
}
