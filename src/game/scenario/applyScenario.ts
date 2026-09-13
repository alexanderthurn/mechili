/**
 * Put a scenario's board onto a fresh match (plan §6.1): base buildings (which
 * stand, their level, manned garrison posts), side talents, then the placed
 * units in canonical order — player, enemy, horde, each in list order — so unit
 * ids come out the same on every client and on every resume or replay. Runs in
 * the Game constructor before any logged action is applied.
 */
import { spawnGarrisonPost } from '../actions';
import type { TypeRegistry } from '../content/typeRegistry';
import type { PlacementController } from '../placement';
import type { SeatId } from '../seats';
import type { TechTree } from '../tech';
import type { Team, Unit } from '../units';
import type { ScenarioDef, SceneTeam } from './scenarioDef';

/** the only surface of the match a scenario touches */
export interface ScenarioHost {
    readonly types: TypeRegistry;
    readonly placement: PlacementController;
    readonly techTree: TechTree;
    primarySeat(team: Team): SeatId;
    /** base buildings at their anchors, for those `want` accepts; returns what was placed */
    spawnBaseBuildings(want: (team: Team, typeId: string) => boolean): Unit[];
}

function setLevel(unit: Unit, level: number): void {
    unit.level = level;
    unit.applyLevelLook(level);
    unit.refreshLevelBadge();
}

export function applyScenario(host: ScenarioHost, def: ScenarioDef): void {
    const { scene } = def;

    // 1. base buildings: omitted = normal, false = not on the board
    const buildings = host.spawnBaseBuildings((team, typeId) => scene.buildings[team][typeId] !== false);
    for (const building of buildings) {
        if (building.team === 'horde') continue;
        const state = scene.buildings[building.team][building.type.id];
        if (!state) continue;
        if (state.level > 1) setLevel(building, state.level);
        const posted = building.type.garrison ? host.types.byId(building.type.garrison.unitTypeId) : null;
        for (let i = 0; posted && i < (state.garrison ?? 0); i++) {
            if (!spawnGarrisonPost(host.placement, posted, building, building.team, building.seat)) break;
        }
    }

    // 2. talents: side-wide per unit type, owned by the side's primary seat
    for (const team of ['player', 'enemy'] as const) {
        const seat = host.primarySeat(team);
        for (const [typeId, techIds] of Object.entries(scene.techs[team])) {
            for (const techId of techIds) host.techTree.add(seat, typeId, techId);
        }
    }

    // 3. units, canonical order
    const order: SceneTeam[] = ['player', 'enemy', 'horde'];
    for (const team of order) {
        for (const placed of scene.units) {
            if (placed.team !== team) continue;
            const type = host.types.byId(placed.typeId);
            if (!type) continue;
            let unit: Unit | null;
            if (team === 'horde') {
                const fp = placed.at.rotated
                    ? { cols: type.footprint.rows, rows: type.footprint.cols }
                    : type.footprint;
                // the pack's center, from its grid anchor (gridless horde packs stand by world position)
                const center = host.placement.map.areaCenter({ col: placed.at.col, row: placed.at.row }, fp.cols, fp.rows);
                unit = host.placement.spawnAtWorld(type, center.x, center.z, 'horde');
            } else {
                unit = host.placement.spawn(
                    type,
                    { col: placed.at.col, row: placed.at.row },
                    team,
                    placed.at.rotated ?? false,
                    true,
                    host.primarySeat(team),
                );
            }
            if (!unit) continue;
            // authored packs count as deployed before round 1 — placed, not this round's buys
            unit.deployedRound = 0;
            if (placed.level > 1) setLevel(unit, placed.level);
            if (!type.structure) {
                for (const itemId of placed.items ?? []) {
                    unit.items.push(itemId);
                    unit.itemAppliedRound.push(0);
                }
            }
        }
    }
}
