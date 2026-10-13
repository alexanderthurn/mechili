import type { Mesh, MeshBasicMaterial, Scene } from 'three';
import { colorForBattleTeam } from './colors';
import { FireCoverage } from './fireCoverage';
import { debugEnabled } from './prefs';
import type { BattleMap } from './map';
import {
    createFovWedge,
    createRangeRing,
    placeFovWedge,
    placeRangeRing,
    pulseAuraRing,
    type PlacementController,
    type RangeShape,
} from './placement';
import { seatIdsOf, type SeatDef, type SeatId } from './seats';
import type { Economy, GameSettings } from './settings';
import { BattleSim, actorTeam, type Actor, type SimConfig } from './sim';
import { TargetLine, type TargetLineSegment } from './targetLine';
import { TargetMarkers, type TargetMarkerView } from './targetMarkers';
import type { Loadout } from './techCatalog';
import { RANGE_ELEV_MAX_BONUS, reachToward } from './terrainCombat';
import type { TypeRegistry } from './content/typeRegistry';
import type { Phase } from '../ui/hud';
import {
    STRONGHOLD_ARCHER_FOV_HALF,
    isTargetMarked,
    wallShiftOffset,
    type BattleTeam,
    type Unit,
} from './units';

/** in battle the fire coverage follows its shooter, worked out again at most this often (ms) */
const FIRE_COVERAGE_BATTLE_MS = 250;

/** what the overlays read of the match — Game hands it out with live getters */
export interface BattleOverlaysHost {
    readonly phase: Phase;
    readonly sim: BattleSim | null;
    readonly selectedActor: Actor | null;
    readonly placement: PlacementController;
    readonly map: BattleMap;
    readonly seats: readonly SeatDef[];
    readonly settings: GameSettings;
    readonly economy: Economy;
    readonly types: TypeRegistry;
    /** tech tile hovered/peeked in the detail panel (drives the aura ring) */
    readonly hoveredTech: string | null;
    /** the enemy's target marks as they stood when his deployment was fogged */
    readonly enemyIntelSnapshot: { targetMarks: { unitId: number; seat: SeatId }[] } | null;
    /** cinema mode: no overlays */
    readonly uiHidden: boolean;
    revealEnemyDeployIntel(): boolean;
    resolvedStats: SimConfig['statsOf'];
    levelScaleOf(unit: Unit, kind: 'damage' | 'range'): number;
    seatRank(seat: SeatId): number;
    unitHasTech(seat: SeatId, typeId: string, techId: string): boolean;
    loadoutOf(seat: SeatId): Loadout | undefined;
}

/**
 * The in-world marks around the selected unit and the walls: its range ring
 * (or field-of-fire wedge), dead-zone and aura rings, where a shooter can hit
 * (FireCoverage), the red arrows at marked walls and, with debug on, the lines
 * to what it goes for. Render only — {@link update} each frame.
 */
export class BattleOverlays {
    /** attack-range ring under the selected battle mech */
    private readonly battleRangeMesh: Mesh;
    /** a pack with a field of fire: the arc it covers instead of the ring */
    private readonly battleFovMesh: Mesh;
    /** inner dead-zone (min-range) ring under the selected battle mech */
    private readonly battleMinRangeMesh: Mesh;
    /** gold aura-range ring under a selected battle mech with a special skill */
    private readonly battleAuraMesh: Mesh;
    /** where the selected ranged unit can actually hit (see FireCoverage) */
    private readonly fireCoverage: FireCoverage;
    /** red arrows at marked walls (setTargetMark, the battle's auto-marks) */
    private readonly targetMarkers: TargetMarkers;
    /** debug: the selected battle unit's line to its target */
    private readonly targetLine: TargetLine;
    /** what the target line last logged (logged again on a change) */
    private targetLineLog = '';

    constructor(
        scene: Scene,
        private readonly host: BattleOverlaysHost,
    ) {
        this.battleRangeMesh = createRangeRing(scene);
        this.fireCoverage = new FireCoverage(scene);
        this.targetMarkers = new TargetMarkers(scene);
        this.targetLine = new TargetLine(scene);
        this.battleFovMesh = createFovWedge(scene);
        this.battleMinRangeMesh = createRangeRing(scene);
        (this.battleMinRangeMesh.material as MeshBasicMaterial).color.setHex(0xff6a44);
        this.battleAuraMesh = createRangeRing(scene);
        (this.battleAuraMesh.material as MeshBasicMaterial).color.setHex(0xffcf5a);
    }

    update(): void {
        this.updateBattleRangeRing();
        this.updateFireCoverage();
        this.updateTargetMarkers();
        this.updateTargetLine();
    }

    /**
     * Red arrows at marked walls: while deploying, mine and my ally's live,
     * the enemy's as they stood at the phase start while his deployment is
     * fogged (revealEnemyDeployIntel); in battle every mark of the battle,
     * auto-marks fainter, until the wall falls. None in cinema mode.
     */
    private updateTargetMarkers(): void {
        const views: TargetMarkerView[] = [];
        if (!this.host.uiHidden) {
            const marks: { unit: Unit; faint: boolean }[] = [];
            if (this.host.phase === 'battle' && this.host.sim) {
                for (const a of this.host.sim.actors) {
                    if (!a.alive || !a.unit.type.wall) continue;
                    const def = a.unit.type.target ?? true;
                    (a.targetBy ?? a.unit.targetBy).forEach((v, seat) => {
                        if (v === undefined || v === def) return;
                        marks.push({ unit: a.unit, faint: a.unit.targetBy[seat] !== v });
                    });
                }
            } else {
                const live = this.host.revealEnemyDeployIntel();
                const enemySeats = new Set(seatIdsOf(this.host.seats, 'enemy'));
                for (const u of this.host.placement.allUnits()) {
                    if (!u.type.wall || u.destroyed) continue;
                    u.targetBy.forEach((_v, seat) => {
                        if (!isTargetMarked(u, seat) || (!live && enemySeats.has(seat))) return;
                        marks.push({ unit: u, faint: false });
                    });
                }
                if (!live) {
                    for (const m of this.host.enemyIntelSnapshot?.targetMarks ?? []) {
                        const u = this.host.placement.unitById(m.unitId);
                        if (u?.type.wall && !u.destroyed) marks.push({ unit: u, faint: false });
                    }
                }
            }
            // above each wall, side by side along it when several seats marked it
            const perWall = new Map<Unit, number>();
            for (const m of marks) perWall.set(m.unit, (perWall.get(m.unit) ?? 0) + 1);
            const placed = new Map<Unit, number>();
            for (const m of marks) {
                const u = m.unit;
                const wall = u.type.wall!;
                const k = placed.get(u) ?? 0;
                placed.set(u, k + 1);
                const along = (k - (perWall.get(u)! - 1) / 2) * 3;
                const off = wallShiftOffset(u.facing, wall.shift ?? 0);
                const x = u.world.x + off.x + (u.rotated ? 0 : along);
                const z = u.world.z + off.z + (u.rotated ? along : 0);
                const top = (wall.height ?? 4) * (u.visualHeightScale() / u.type.meshScale);
                views.push({ x, z, y: this.host.map.heightAt(x, z) + top, faint: m.faint });
            }
        }
        this.targetMarkers.update(views, performance.now() / 1000);
    }

    /**
     * Debug (?debug / the debug overlay): lines from the selected battle unit —
     * yellow to its target; to each wall it may go for (marked by its seat):
     * red blocked shot, orange dead zone, grey out of reach, blue farther.
     * The walls' reasons go to the console when they change.
     */
    private updateTargetLine(): void {
        const a = this.host.selectedActor;
        const sim = this.host.sim;
        if (!debugEnabled() || this.host.uiHidden || this.host.phase !== 'battle' || !sim || !a?.alive) {
            this.targetLine.update(null, []);
            this.targetLineLog = '';
            return;
        }
        const lift = 1.5;
        const at = (x: number, z: number, alt = 0) => ({ x, y: this.host.map.heightAt(x, z) + alt + lift, z });
        const segments: TargetLineSegment[] = [];
        const aim = sim.debugTarget(a);
        if (aim) segments.push({ to: at(aim.x, aim.z, aim.target.altitude), color: 0xffe14a });
        // a beam (the prism's, the wizard's) locks on by itself, apart from where it walks: magenta
        const beamList = a.unit.type.convertRay ? a.convertTargets : a.rampBeamTargets;
        const beams = beamList.filter((t) => t.alive);
        beamList.forEach((t, i) => {
            if (!t.alive) return;
            const wall = t.unit.type.wall && a.beamAims.length >= i * 3 + 3;
            segments.push({ to: wall ? at(a.beamAims[i * 3]!, a.beamAims[i * 3 + 2]!) : at(t.x, t.z, t.altitude), color: 0xff4af0 });
        });
        const walls = sim.debugWalls(a);
        const color: Record<string, number> = { blocked: 0xff3030, deadZone: 0xff9a2e, outOfReach: 0x9a9a9a, farther: 0x4aa8ff };
        for (const w of walls) if (w.status !== 'pick') segments.push({ to: at(w.x, w.z), color: color[w.status] ?? 0xffffff });
        this.targetLine.update(at(a.x, a.z, a.altitude), segments);
        const log =
            `${a.unit.type.id} #${a.unit.id} → ${aim ? `${aim.target.unit.type.id} #${aim.target.unit.id}` : 'nothing'}` +
            (beams.length > 0 ? `; beam → ${beams.map((t) => `${t.unit.type.id} #${t.unit.id}`).join(', ')}` : '') +
            walls.map((w) => `\n  wall #${w.wall.unit.id}: ${w.status} · ${w.why}`).join('');
        // logged when the pick or a wall's status changes, not on every step of a walk
        const key = `${a.unit.id}>${aim?.target.unit.id ?? '-'}|${beams.map((t) => t.unit.id).join()}` + walls.map((w) => `${w.wall.unit.id}:${w.status}`).join();
        if (key !== this.targetLineLog) {
            this.targetLineLog = key;
            console.info(`[target] ${log}`);
        }
    }

    /**
     * Where the selected ranged unit can hit, cell by cell (FireCoverage). In
     * battle for any selected shooter (either side), asked of the live sim and
     * followed as it walks — worked out again at most every
     * {@link FIRE_COVERAGE_BATTLE_MS}; in deployment for the selected ranged
     * pack, asked of a sim holding just it and the board's buildings.
     */
    private updateFireCoverage(): void {
        const battle = this.host.phase === 'battle' && this.host.sim !== null;
        let unit: Unit | null = null;
        let live: Actor | null = null;
        if (battle) {
            const a = this.host.selectedActor;
            if (a?.alive && a.unit.type.projectileSpeed) {
                unit = a.unit;
                live = a;
            }
        } else if (this.host.sim === null && !this.host.placement.repositioning) {
            const u = this.host.placement.selectedUnit;
            if (u && !u.destroyed && u.type.projectileSpeed) unit = u;
        }
        if (!unit) {
            this.fireCoverage.hide();
            return;
        }
        const shooter = unit;
        let key: string;
        if (live && this.host.sim) {
            // battle: where it stands now (half-unit steps) and which buildings still stand
            let standing = 0;
            for (const s of this.host.sim.actors) if (s.alive && s.unit.type.structure) standing++;
            key = `b:${live.index}:${Math.round(live.x * 2)},${Math.round(live.z * 2)}:${standing}`;
        } else {
            const board = this.host.placement
                .allUnits()
                .filter((u) => u.type.structure && !u.destroyed)
                .map((u) => `${u.id}:${u.cell.col},${u.cell.row},${u.rotated ? 1 : 0},${u.flipped ? 1 : 0},${u.level}`)
                .join('|');
            key = `d:${shooter.id}:${shooter.world.x.toFixed(2)},${shooter.world.z.toFixed(2)},${shooter.level}:${board}`;
        }
        const team: BattleTeam = shooter.team === 'horde' ? 'horde' : shooter.team;
        this.fireCoverage.show(key, colorForBattleTeam(team).hex, () => {
            let sim = this.host.sim;
            if (!battle) {
                // just the shooter and what stands on the board: no battle, no side effects
                const units = this.host.placement
                    .allUnits()
                    .filter((u) => u === shooter || (u.type.structure && !u.destroyed && !u.productionHeld));
                sim = new BattleSim(units, this.probeSimConfig());
                sim.prepareProbe();
            }
            const actor = live ?? sim?.actorNear(shooter, shooter.world.x, shooter.world.z) ?? null;
            if (!sim || !actor) return null;
            const probe = sim;
            const range = this.host.resolvedStats(shooter).range * this.host.levelScaleOf(shooter, 'range');
            return {
                x: actor.x,
                z: actor.z,
                radius: range + shooter.type.collisionRadius + RANGE_ELEV_MAX_BONUS,
                covers: (x, z) => probe.shotCovers(actor, x, z),
            };
        },
            live ? { shooter: `b:${live.index}`, everyMs: FIRE_COVERAGE_BATTLE_MS } : undefined,
        );
    }

    /** a sim that never fights: just to ask where a shooter can hit (updateFireCoverage) */
    private probeSimConfig(): SimConfig {
        return {
            terrain: this.host.map.terrain,
            towers: this.host.settings.towers,
            leveling: this.host.settings.leveling,
            battleSeconds: 1,
            seatRank: (seat) => this.host.seatRank(seat),
            costOf: (type) => this.host.economy.costOf(type),
            statsOf: (unit) => this.host.resolvedStats(unit),
            hasTech: (seat, typeId, techId) => this.host.unitHasTech(seat, typeId, techId),
            flankSpawnSeconds: 0,
            flankSpawnMult: () => 1,
            needsFlankSpawn: () => false,
            boardHalfW: this.host.map.halfW,
            boardHalfZ: this.host.map.halfH,
            loadoutOf: (seat: SeatId) => this.host.loadoutOf(seat),
            types: this.host.types,
            strongholdLifeline: false,
        };
    }

    /** the range ring follows the selected battle mech, tinted by its team */
    private updateBattleRangeRing(): void {
        const a = this.host.phase === 'battle' ? this.host.selectedActor : null;
        // a pack with a field of fire shows the arc it actually covers instead
        // of a ring that would promise the whole circle
        const fov = a?.unit.fovYaw ?? null;
        this.battleRangeMesh.visible = a !== null && fov === null;
        this.battleFovMesh.visible = a !== null && fov !== null;
        // gold aura ring for a selected mech with a special-ability radius
        const auraRadius = a ? this.auraRadiusOf(a.unit) : null;
        this.battleAuraMesh.visible = a !== null && auraRadius !== null;
        const minRange = a ? this.host.resolvedStats(a.unit).minRange : 0;
        this.battleMinRangeMesh.visible = a !== null && minRange > 0;
        if (!a) return;
        const range =
            this.host.resolvedStats(a.unit).range * this.host.levelScaleOf(a.unit, 'range');
        const own = a.unit.type.collisionRadius;
        // ranged: the ring bulges down onto low ground and pulls in up a slope, like the sim's reach
        const radius: RangeShape =
            a.unit.type.projectileSpeed && (a.altitude === 0 || a.unit.pinnedY != null)
                ? (dx, dz) => reachToward(a.footY, a.rx, a.rz, dx, dz, range, own)
                : range + own;
        const tint = colorForBattleTeam(actorTeam(a)).hex;
        if (fov !== null) {
            placeFovWedge(this.battleFovMesh, a.rx, a.rz, radius, fov, STRONGHOLD_ARCHER_FOV_HALF);
            (this.battleFovMesh.material as MeshBasicMaterial).color.setHex(tint);
        } else {
            placeRangeRing(this.battleRangeMesh, a.rx, a.rz, radius);
            (this.battleRangeMesh.material as MeshBasicMaterial).color.setHex(tint);
        }
        if (minRange > 0) {
            placeRangeRing(this.battleMinRangeMesh, a.rx, a.rz, minRange + a.unit.type.collisionRadius);
        }
        if (auraRadius !== null) {
            placeRangeRing(this.battleAuraMesh, a.rx, a.rz, auraRadius);
            pulseAuraRing(this.battleAuraMesh, performance.now());
        }
    }

    /**
     * Radius of a unit's special-ability aura, or null when it has none.
     * Currently the ballista Golden Aura (tech `golden`); drives the gold ring.
     */
    auraRadiusOf(unit: Unit): number | null {
        // only while the matching tech tile is hovered/peeked in the panel.
        // The Golden Aura tile only shows on a ballista, so hovering it is
        // enough — preview the radius whether or not the tech is bought yet.
        const aura = unit.type.aura;
        if (!aura || this.host.hoveredTech !== aura.requiresTech) return null;
        return aura.radius;
    }
}
