import {
    BoxGeometry,
    CanvasTexture,
    ConeGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    RingGeometry,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3,
    type Scene,
} from 'three';
import type { CameraRig } from '../engine/cameraRig';
import { THEME } from '../theme';
import type { Action } from './actions';
import { ITEMS } from './items';
import { CELL, cellKey, groundHeightAt, type BattleMap, type Cell } from './map';
import type { Economy } from './settings';
import {
    TargetPreviewVisuals,
    type TargetPreviewRoute,
} from './targetPreviewVisuals';
import { Unit, unitTypeById, type BattleTeam, type GridExtent, type Team, type UnitType } from './units';
import { classicSeats, primarySeatOf, seatLane, type SeatDef, type SeatId } from './seats';

/** horde unit ids start here — far above anything the parity counters reach */
const HORDE_ID_BASE = 1_000_000;
import { getUnitInstanceRenderer } from './unitInstances';

/** frozen enemy intel captured at deployment-phase start */
interface IntelEntry {
    unitId: number;
    typeId: string;
    team: BattleTeam;
    cell: Cell;
    rotated: boolean;
    facing: number;
    world: Vector3;
    level: number;
    xp: number;
    /** pack was ready to buy a level at snapshot time (stale upgrade arrow) */
    upgradeReady: boolean;
    items: string[];
}

const VALID_COLOR = THEME.valid;
const INVALID_COLOR = THEME.invalid;
const SELECT_COLOR = THEME.select;
/** how far packs lift off the ground while being moved (carried) */
const SELECT_LIFT = 2.8;
/** green tint for movable packs that are not currently selected */
const MOVABLE_PLATE_OPACITY = 0.52;

/**
 * The attack-range ring visual, shared by deployment selection and the
 * battle-phase mech selection. Unit scale = range in world units.
 */
export function createRangeRing(scene: Scene): Mesh {
    const ringGeo = new RingGeometry(0.985, 1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const mesh = new Mesh(
        ringGeo,
        new MeshBasicMaterial({
            color: VALID_COLOR,
            transparent: true,
            opacity: 0.4,
            side: DoubleSide,
            depthWrite: false,
        }),
    );
    mesh.frustumCulled = false; // draped vertices outgrow the static bounding sphere
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
}

/**
 * Position + size a range ring, draping its band over the ground relief so
 * it hugs the terrain (and units occlude it) instead of floating.
 */
export function placeRangeRing(mesh: Mesh, x: number, z: number, radius: number): void {
    const pos = mesh.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
        pos.setY(i, groundHeightAt(x + pos.getX(i) * radius, z + pos.getZ(i) * radius));
    }
    pos.needsUpdate = true;
    mesh.position.set(x, 0.12, z);
    mesh.scale.set(radius, 1, radius);
    mesh.visible = true;
}

/**
 * Deployment-phase interaction: buying drops a pack at the first free spot
 * near the center of the player zone; the player selects packs (left click)
 * and moves the ones bought THIS round by clicking a destination. A left
 * DRAG on the ground rubber-bands a rectangle that selects every movable
 * pack inside it — the group then rides the cursor as a rigid formation and
 * a click drops all of it (all packs must fit, or nothing moves). Right
 * click (handled by the camera controls) deselects via {@link deselect}.
 */
export class PlacementController {
    /** false during the battle phase: no hover, no placing, no moving */
    enabled = true;
    /**
     * true while a build phase runs: enemy intel is frozen to the phase-start
     * snapshot until the local player locks in or the battle starts.
     */
    hiddenPlacements = false;
    /** when true, enemy packs render at {@link intelSnapshot} poses instead of live */
    private intelFog = false;
    /** unit poses at deployment-phase start — the opponent's stale intel view */
    private readonly intelSnapshot = new Map<number, IntelEntry>();
    /** sold snapshotted enemy packs kept visible at their intel pose */
    private readonly intelGhosts = new Map<number, Unit>();
    /** the running round; units deployed in earlier rounds are locked in place */
    currentRound = 0;
    selectedUnit: Unit | null = null;
    /** effective attack range of a pack (tech-resolved), for the range circle */
    rangeOf: ((unit: Unit) => number) | null = null;
    /**
     * every user commit (move, group move, rotate) leaves as an action here —
     * the controller itself never mutates the board directly
     */
    dispatch: ((action: Action) => boolean) | null = null;
    /** set by the game: which packs can buy their next level right now */
    levelReady: ((unit: Unit) => boolean) | null = null;
    /** set by the game: whether a pack should keep a stale upgrade arrow in the intel snapshot */
    upgradeReadyAtCapture: ((unit: Unit) => boolean) | null = null;
    /** fires on every click that lands on a unit (used for item application) */
    onSelect: ((unit: Unit) => void) | null = null;
    /** when set, left clicks are offered here first; return true to swallow */
    groundClickInterceptor: ((x: number, y: number) => boolean) | null = null;
    /** blocks normal placement interaction (tactic placement mode) */
    inputLocked = false;

    /**
     * per-team id counters: a side's ids depend only on its OWN spawn
     * sequence, so peers applying each other's actions in any interleaving
     * still agree (player ids even, enemy ids odd)
     */
    private readonly nextUnitId: Record<BattleTeam, number> = { player: 0, enemy: 0, horde: 0 };
    /** the match roster — drives default seats and (duo modes) lane splits */
    roster: SeatDef[] = classicSeats('You', 'Enemy');
    /** the local human's seat — the placement/preview UI acts for this seat */
    localSeat: SeatId = 0;
    private readonly units: Unit[] = [];
    private readonly occupied = new Map<string, Unit>();
    private readonly hoverMesh: Mesh;
    private readonly hoverMaterial: MeshBasicMaterial;
    private readonly selectMesh: Mesh;
    private readonly rangeMesh: Mesh;
    /** whitish ground plates marking the packs that may still be repositioned */
    private readonly movablePlates: Mesh[] = [];
    private readonly plateGeometry: PlaneGeometry;
    private readonly plateMaterial: MeshBasicMaterial;
    /** a board extra being click-placed: rides the cursor, bought on click */
    private pendingType: UnitType | null = null;
    private pendingUnit: Unit | null = null;
    /**
     * First click on a movable pack only SELECTS it (info, range). A second
     * click on it (or middle-click rotate) picks it up so it rides the cursor.
     * Empty-ground clicks only move while carrying — after a drop the pack
     * stays selected in details mode until picked up again.
     */
    private carryingSelected = false;
    /** rect-selected movable packs (2+); a single selection uses selectedUnit */
    private selectedGroup: Unit[] = [];
    /** movable packs currently inside the rubber-band, live while dragging */
    private rectPreview: Unit[] = [];
    /** per-member marker plates (own material each — validity color differs per pack) */
    private readonly groupPlates: Mesh[] = [];
    /** small gold up-arrows over packs with a buyable level */
    private readonly levelArrows: Group[] = [];
    private readonly levelArrowMaterial: MeshBasicMaterial;
    /** floating item symbols over equipped packs (build phase only) */
    private readonly itemBadges: Sprite[] = [];
    private readonly itemBadgeMaterials = new Map<string, SpriteMaterial>();
    private readonly rectEl: HTMLDivElement;
    private rectActive = false;
    private pointer: { x: number; y: number } | null = null;
    private downAt: { x: number; y: number } | null = null;
    private readonly disposers: (() => void)[] = [];
    /** animated arrows: selected pack → packs its mechs would open on */
    private readonly targetPreview: TargetPreviewVisuals;

    constructor(
        private readonly rig: CameraRig,
        private readonly map: BattleMap,
        private readonly economy: Economy,
        private readonly scene: Scene,
        private readonly surface: HTMLElement,
    ) {
        const makeMarker = (color: number, opacity: number) => {
            const geo = new PlaneGeometry(1, 1); // rebuilt per footprint by placeFootprintPlate
            geo.rotateX(-Math.PI / 2);
            const material = new MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                side: DoubleSide,
                depthWrite: false,
            });
            const mesh = new Mesh(geo, material);
            mesh.renderOrder = 10; // after the other transparent ground overlays
            mesh.visible = false;
            scene.add(mesh);
            return mesh;
        };
        this.hoverMesh = makeMarker(VALID_COLOR, 0.72);
        this.hoverMesh.position.y = 0.04;
        this.hoverMaterial = this.hoverMesh.material as MeshBasicMaterial;
        this.selectMesh = makeMarker(SELECT_COLOR, 0.22);
        this.selectMesh.position.y = 0.03;

        // attack range ring for the selected own pack (unit radius, scaled per unit)
        this.rangeMesh = createRangeRing(scene);
        this.targetPreview = new TargetPreviewVisuals(scene);

        this.levelArrowMaterial = new MeshBasicMaterial({ color: SELECT_COLOR });

        this.plateGeometry = new PlaneGeometry(1, 1);
        this.plateGeometry.rotateX(-Math.PI / 2);
        this.plateMaterial = new MeshBasicMaterial({
            color: VALID_COLOR,
            transparent: true,
            opacity: MOVABLE_PLATE_OPACITY,
            side: DoubleSide,
            depthWrite: false,
        });

        // rubber-band rectangle, drawn as a plain overlay div on the wrapper
        this.rectEl = document.createElement('div');
        this.rectEl.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:10; border:1.5px solid ${THEME.ui.hover}; background:rgba(255, 208, 64, 0.08);`;
        (surface.parentElement ?? document.body).appendChild(this.rectEl);

        const listen = (
            type: string,
            handler: EventListener,
            options?: AddEventListenerOptions,
        ) => {
            surface.addEventListener(type, handler, options);
            this.disposers.push(() => surface.removeEventListener(type, handler, options));
        };

        listen('pointermove', ((e: PointerEvent) => {
            // 2+ fingers = camera gesture: the carried ghost must not chase
            // either finger around
            if (e.pointerType === 'touch' && (this.activeTouches.size > 1 || this.multiTouch)) {
                return;
            }
            this.pointer = this.toLocal(e);
            // touch: one-finger drags pan the camera — no rubber-band select
            if (e.pointerType === 'touch') return;
            if (!this.downAt || !this.enabled || this.pendingType || this.inputLocked) return;
            const moved = Math.hypot(this.pointer.x - this.downAt.x, this.pointer.y - this.downAt.y);
            if (this.rectActive || moved > 6) this.updateRect(this.downAt, this.pointer);
        }) as EventListener);
        listen('pointerdown', ((e: PointerEvent) => {
            if (e.button !== 0) return;
            if (e.pointerType === 'touch') {
                this.activeTouches.add(e.pointerId);
                if (this.activeTouches.size > 1) {
                    this.multiTouch = true; // second finger: camera, not aiming
                    return;
                }
            }
            this.downAt = this.toLocal(e);
            // touch has no hover: without this, a carried ghost would sit at
            // the LAST drag position (e.g. where the previous pack was dropped)
            this.pointer = this.downAt;
            try {
                if (!this.inputLocked) surface.setPointerCapture(e.pointerId);
            } catch {
                /* synthetic pointers (gamepad cursor) cannot be captured */
            }
        }) as EventListener);
        listen('pointercancel', ((e: PointerEvent) => {
            this.releaseTouch(e);
            this.downAt = null;
            this.hideRect();
        }) as EventListener);
        listen('pointerup', ((e: PointerEvent) => {
            if (e.button !== 0) return;
            // during/after a multi-finger gesture no tap may become a click
            if (e.pointerType === 'touch' && this.releaseTouch(e)) {
                this.downAt = null;
                this.hideRect();
                return;
            }
            const down = this.downAt;
            this.downAt = null;
            const wasRect = this.rectActive;
            this.hideRect();
            const up = this.toLocal(e);
            this.pointer = up;
            // tactic placement: single clicks only, no drag-select
            if (this.inputLocked) {
                if (this.enabled && !wasRect) this.handleClick(up.x, up.y);
                return;
            }
            if (!this.enabled || !down) return;
            if (wasRect) {
                this.finishRectSelect(down, up);
                return;
            }
            // fingers jitter more than mice — allow a wider tap slop on touch
            const slop = e.pointerType === 'touch' ? 12 : 6;
            if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return;
            this.handleClick(up.x, up.y);
        }) as EventListener);
    }

    /** fingers currently down (touch only) — 2+ means a camera gesture owns them */
    private readonly activeTouches = new Set<number>();
    private multiTouch = false;

    /** untracks a lifted finger; true while the contact belongs to a camera gesture */
    private releaseTouch(e: PointerEvent): boolean {
        if (e.pointerType !== 'touch') return false;
        this.activeTouches.delete(e.pointerId);
        if (!this.multiTouch) return false;
        if (this.activeTouches.size === 0) this.multiTouch = false;
        return true;
    }

    /** detach input listeners and DOM helpers */
    dispose(): void {
        this.enabled = false;
        this.clearIntelGhosts();
        this.deselect();
        this.targetPreview.dispose();
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.rectEl.remove();
    }

    get unitCount(): number {
        return this.units.length;
    }

    /**
     * True while something follows the pointer — a bought ghost, a carried
     * pack/formation, or an armed tactic. Touch camera-pan defers to it so a
     * one-finger drag aims instead of moving the map.
     */
    get pointerCarries(): boolean {
        return (
            this.pendingUnit !== null ||
            this.carryingSelected ||
            this.selectedGroup.length > 0 ||
            this.inputLocked
        );
    }

    allUnits(): readonly Unit[] {
        return this.units;
    }

    /** Records every pack's pose at deployment-phase start for stale enemy intel. */
    captureIntelSnapshot(): void {
        this.intelSnapshot.clear();
        this.clearIntelGhosts();
        for (const u of this.units) {
            this.rememberIntelPose(u);
        }
    }

    /**
     * Freeze a pack into the intel snapshot at its current pose. Used at phase
     * start for everyone, and mid-deploy when a cheat grants new enemy packs so
     * they appear at land position while later moves stay fogged.
     */
    rememberIntelPose(unit: Unit): void {
        this.intelSnapshot.set(unit.id, {
            unitId: unit.id,
            typeId: unit.type.id,
            team: unit.team,
            cell: { col: unit.cell.col, row: unit.cell.row },
            rotated: unit.rotated,
            facing: unit.facing,
            world: unit.world.clone(),
            level: unit.level,
            xp: unit.xp,
            upgradeReady: this.upgradeReadyAtCapture?.(unit) ?? false,
            items: [...unit.items],
        });
    }

    /** Turns enemy intel fog on or off (off = live board). */
    setIntelFog(on: boolean): void {
        const was = this.intelFog;
        this.intelFog = on;
        if (was && !on) {
            for (const u of this.units) u.refreshLevelBadge();
        }
    }

    /** true while enemy packs render from the phase-start snapshot */
    get intelFogOn(): boolean {
        return this.intelFog;
    }

    /** true when the opponent may see this enemy pack (snapshot or live reveal). */
    enemyIntelVisible(unit: Unit): boolean {
        if (unit.team !== 'enemy') return true;
        if (!this.intelFog) return true;
        return this.intelSnapshot.has(unit.id);
    }

    /**
     * Member ground positions as currently shown on screen.
     * Empty when the pack is hidden by intel fog; fogged enemies use snapshot poses.
     */
    visibleMemberWorldPositions(unit: Unit): Vector3[] {
        if (unit.destroyed || unit.consumed || !this.enemyIntelVisible(unit)) return [];
        return this.memberPositionsAt(this.intelWorldOf(unit), unit);
    }

    /**
     * Stale enemy veterancy/items while intel fog is on.
     * null = use the live unit (own packs, or fog off / not yet snapshotted).
     */
    intelOf(unit: Unit): { level: number; xp: number; items: readonly string[] } | null {
        if (!this.intelFog || unit.team !== 'enemy') return null;
        const snap = this.intelSnapshot.get(unit.id);
        if (!snap) return null;
        return { level: snap.level, xp: snap.xp, items: snap.items };
    }

    deselect(): void {
        this.cancelPlacing();
        this.restoreSelectedView();
        this.selectedUnit = null;
        this.selectedGroup = [];
        this.carryingSelected = false;
    }

    /**
     * Board extras are click-placed: the buy button puts a ghost on the
     * cursor, a left click buys AND places it there, deselect (right click /
     * Esc) aborts without spending anything.
     */
    beginPlacing(type: UnitType): void {
        this.deselect();
        this.pendingType = type;
        this.pendingUnit = new Unit(type, { col: 0, row: 0 }, 'player', new Vector3(0, -9999, 0));
        // the ghost previews the facing rule (matters for far-side owners)
        this.pendingUnit.faceClosestOf(this.opponentMechPositions('player', this.pendingUnit));
        this.scene.add(this.pendingUnit.view);
    }

    private cancelPlacing(): void {
        if (this.pendingUnit) {
            getUnitInstanceRenderer()?.unregisterUnit(this.pendingUnit);
            this.scene.remove(this.pendingUnit.view);
        }
        this.pendingType = null;
        this.pendingUnit = null;
    }

    /** carried / selected packs ride above the grid; everything else sits on world */
    private applyViewHeight(unit: Unit, x: number, z: number, lifted: boolean): void {
        unit.view.position.set(x, lifted ? SELECT_LIFT : unit.world.y, z);
        // structures skip Unit.update — reseat here so drag follows the hills
        if (unit.type.structure) unit.seatMembers(x, z);
    }

    private isHighlighted(unit: Unit): boolean {
        if (this.selectedGroup.includes(unit)) return true;
        return unit === this.selectedUnit && this.selectedGroup.length <= 1;
    }

    /** carried packs go back to their committed spots */
    private restoreSelectedView(): void {
        const restore = (u: Unit) => {
            u.view.position.copy(u.world);
            u.seatMembers(u.world.x, u.world.z);
        };
        if (this.selectedUnit) restore(this.selectedUnit);
        for (const u of this.selectedGroup) restore(u);
    }

    /** repositioning is allowed only in the round the pack was deployed (extras included) */
    canReposition(unit: Unit): boolean {
        return (
            (!unit.type.structure || !!unit.type.extra) &&
            unit.deployedRound === this.currentRound
        );
    }

    /** what the local player may pick up and carry */
    isMovable(unit: Unit): boolean {
        return unit.team === 'player' && this.canReposition(unit);
    }

    unitById(id: number): Unit | null {
        return this.units.find((u) => u.id === id) ?? null;
    }

    /**
     * First free valid spot for a new player pack, searching in rings
     * outward from the center of the player's main zone — resolved BEFORE
     * the buy action is created, so the action carries a concrete anchor.
     */
    findBuySpot(type: UnitType): Cell | null {
        return this.findStartSpot('player', type, this.localSeat);
    }

    /**
     * The same ring search from either side's zone center (deterministic,
     * rng-free). Both lockstep peers hold the identical board, so this is
     * trivially identical for either team on both clients.
     */
    findStartSpot(team: Team, type: UnitType, seat?: SeatId): Cell | null {
        // duo lanes: start the ring search from the seat's lane center so the
        // found spot lies inside the lane the zone check enforces
        const lane = seat !== undefined && seat >= 0 ? seatLane(this.roster, seat) : 'full';
        const centerCol =
            lane === 'full'
                ? Math.floor(this.map.cols / 2)
                : lane === 'left'
                  ? Math.floor(this.map.cols / 4)
                  : Math.floor((3 * this.map.cols) / 4);
        const near = team === 'player' ? !this.map.ownAtFar : this.map.ownAtFar;
        return this.searchSpotFrom(team, type, centerCol, this.map.zoneCenterRow(near), seat);
    }

    /**
     * Nearest zone-valid free anchor around a world point — touch buys drop
     * the pack near the current camera view instead of the zone center. The
     * anchor travels inside the dispatched action, so this stays lockstep-safe.
     */
    findBuySpotNear(type: UnitType, worldX: number, worldZ: number): Cell | null {
        const x = Math.max(-this.map.halfW + 1, Math.min(this.map.halfW - 1, worldX));
        const z = Math.max(-this.map.halfH + 1, Math.min(this.map.halfH - 1, worldZ));
        const center = this.map.worldToCell(new Vector3(x, 0, z));
        if (!center) return this.findStartSpot('player', type, this.localSeat);
        return this.searchSpotFrom('player', type, center.col, center.row, this.localSeat);
    }

    /** the shared ring search: nearest valid free anchor around a start cell */
    private searchSpotFrom(
        team: Team,
        type: UnitType,
        centerCol: number,
        centerRow: number,
        seat?: SeatId,
    ): Cell | null {
        const fp = this.footprintOf(type, false);
        const maxRadius = Math.max(this.map.cols, this.map.rows);
        for (let radius = 0; radius < maxRadius; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                    const anchor = this.centeredAnchor(type, false, {
                        col: centerCol + dc,
                        row: centerRow + dr,
                    });
                    const cells = this.coveredCells(fp, anchor);
                    const ok =
                        cells !== null &&
                        cells.every((c) => this.deployCellOk(team, c, type, seat) && !this.occupied.has(cellKey(c)));
                    if (ok) return anchor;
                }
            }
        }
        return null;
    }


    /**
     * Nearest free anchor for `type` around a world point — deterministic
     * ring search like {@link findStartSpot}, but ZONE-FREE: battle summons
     * may materialize anywhere on the board (safe zone is validated at
     * placement time, not here).
     */
    findSpotNearWorld(type: UnitType, x: number, z: number): Cell | null {
        const fp = this.footprintOf(type, false);
        const centerCol = Math.floor((x + this.map.halfW) / CELL);
        const centerRow = Math.floor((this.map.halfH - z) / CELL);
        const maxRadius = Math.max(this.map.cols, this.map.rows);
        for (let radius = 0; radius < maxRadius; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                    const anchor = this.centeredAnchor(type, false, {
                        col: centerCol + dc,
                        row: centerRow + dr,
                    });
                    const cells = this.coveredCells(fp, anchor);
                    if (cells && cells.every((c) => !this.occupied.has(cellKey(c)))) {
                        return anchor;
                    }
                }
            }
        }
        return null;
    }

    /** Middle click: pick up if needed, then rotate the selected movable pack. */
    /** true when {@link rotateSelected} would act: one own still-movable pack selected */
    get selectedRepositionable(): boolean {
        return (
            this.selectedGroup.length <= 1 &&
            this.selectedUnit !== null &&
            this.isMovable(this.selectedUnit)
        );
    }

    /** picks up the selected pack so it rides the pointer (the touch Move button) */
    pickUpSelected(): void {
        if (!this.enabled || !this.selectedRepositionable) return;
        this.carryingSelected = true;
    }

    rotateSelected(): void {
        if (this.selectedGroup.length > 1) return; // formations don't rotate
        const unit = this.selectedUnit;
        if (!unit || unit.team === 'horde' || !this.enabled || !this.isMovable(unit)) return;
        if (!this.carryingSelected) this.carryingSelected = true;
        this.dispatch?.({ kind: 'rotate', team: unit.team, unitId: unit.id });
    }

    /** Rotates a pack in place (dispatcher-only). While carrying, rotation is
     *  visual-only — drop validity is checked separately on move. */
    rotateUnit(unit: Unit, anchor: Cell = unit.cell): boolean {
        const rotated = !unit.rotated;

        if (this.carryingSelected && unit === this.selectedUnit) {
            unit.setRotated(rotated);
            unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
            return true;
        }

        const fp = this.footprintOf(unit.type, rotated);
        const cells = this.coveredCells(fp, anchor);
        const fits = (c: Cell) =>
            this.deployCellOk(unit.team, c, unit.type, unit.seat) &&
            (unit.type.extra || this.freeFor(c, unit));
        if (!cells || !cells.every(fits)) return false;
        this.release(unit);
        unit.setRotated(rotated);
        unit.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
        if (!unit.type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
        this.stampSandUnder(unit);
        return true;
    }

    /** true when any tile under the pack sits in the flank strips (mechs only) */
    isOnFlank(unit: Unit): boolean {
        const team = unit.team;
        if (team === 'horde' || unit.type.structure || unit.type.extra) return false;
        const cells = this.coveredCells(this.footprintOf(unit.type, unit.rotated), unit.cell);
        if (!cells) return false;
        return cells.some((c) => this.map.isFlankDeployCell(c, team));
    }

    /** a tile a team may deploy on */
    private zoneCell(team: Team, cell: Cell): boolean {
        return team === 'player' ? this.map.isPlayerCell(cell) : this.map.isEnemyCell(cell);
    }

    /** zone check plus type rules — shield and rocket may not sit on flank strips */
    private deployCellOk(team: BattleTeam, cell: Cell, type: UnitType, seat?: SeatId): boolean {
        if (team === 'horde') return false; // the horde never deploys — it spawns free at battle start
        if (!this.zoneCell(team, cell)) return false;
        if (type.extra && this.map.isFlankDeployCell(cell, team)) return false;
        return this.laneOk(seat, cell);
    }

    /**
     * Duo modes: a seat that shares its side owns one vertical lane of the
     * zone (left/right half in canonical columns). Solo seats own it all.
     */
    private laneOk(seat: SeatId | undefined, cell: Cell): boolean {
        if (seat === undefined || seat < 0) return true;
        const lane = seatLane(this.roster, seat);
        if (lane === 'full') return true;
        const midCol = Math.floor(this.map.cols / 2);
        return lane === 'left' ? cell.col < midCol : cell.col >= midCol;
    }

    /**
     * Zone-validated placement for a buy action: the anchor must lie fully
     * in the buyer's territory and be free; spawning charges the cost.
     * Board extras take no space, so only the zone matters for them.
     */
    placeUnit(team: Team, type: UnitType, anchor: Cell, rotated: boolean, seat?: SeatId): Unit | null {
        const cells = this.coveredCells(this.footprintOf(type, rotated), anchor);
        const valid =
            cells !== null &&
            cells.every(
                (c) =>
                    this.deployCellOk(team, c, type, seat) &&
                    (type.extra || !this.occupied.has(cellKey(c))),
            );
        return valid ? this.spawn(type, anchor, team, rotated, false, seat) : null;
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(
        type: UnitType,
        anchor: Cell,
        team: BattleTeam,
        rotated = false,
        free = false,
        seat?: SeatId,
    ): Unit | null {
        const fp = this.footprintOf(type, rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells) return null;
        if (!type.extra && cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        const actorSeat = team === 'horde' ? -1 : (seat ?? primarySeatOf(this.roster, team));
        // horde units are always free — they have no economy to charge
        if (!free && (team === 'horde' || !this.economy.charge(actorSeat, type))) return null;
        const unit = new Unit(type, anchor, team, this.map.areaCenter(anchor, fp.cols, fp.rows), rotated);
        unit.seat = actorSeat;
        // horde ids live far above the player/enemy parity space (id % 2 only
        // ever orders actors; horde ids are identical on every client, so
        // ordering stays deterministic)
        unit.id = team === 'horde' ? HORDE_ID_BASE + ++this.nextUnitId.horde : ++this.nextUnitId[team] * 2 + (team === 'player' ? 0 : 1);
        unit.deployedRound = this.currentRound;
        // board extras take no space on the grid
        if (!type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.units.push(unit);
        this.scene.add(unit.view);
        // core rule: every mech faces the closest individual enemy mech it
        // could be aware of — from snapshotted enemy intel, or the enemy's
        // command towers when nothing else is visible
        unit.faceClosestOf(this.opponentMechPositions(team, unit));
        this.stampSandUnder(unit);
        return unit;
    }

    /** Soft sand under base buildings only (packs leave no courtyard wear). */
    private stampSandUnder(unit: Unit): void {
        const t = unit.type;
        if (!t.structure || t.extra || t.flying) return;
        const fp = this.footprintOf(t, unit.rotated);
        const w = this.map.sandStampWeight(t);
        this.map.stampSand(
            unit.world.x,
            unit.world.z,
            this.map.packSandRadius(fp.cols, fp.rows) * Math.sqrt(w),
            0.22 * w,
        );
    }

    /** Re-stamp every ground pack (after clearing sand wear at round start). */
    restampGroundSand(): void {
        for (const u of this.units) this.stampSandUnder(u);
        this.map.flushSandMask(performance.now(), true);
    }

    /**
     * A valid spot for an enemy unit in its zones, with a formation
     * instinct: melee prefers the front line (low rows, toward the player),
     * ranged prefers the back. Search only — the AI dispatches a buy action
     * with the result. Randomness comes from the match RNG for determinism.
     */
    findEnemySpot(type: UnitType, rng: () => number): { anchor: Cell; rotated: boolean } | null {
        return this.findAiSpot('enemy', this.roster.findIndex((s) => s.team === 'enemy'), type, rng);
    }

    /**
     * A valid AI spot for any seat: random scan of that seat's zone (lane-
     * restricted in duo modes), melee toward the front, ranged toward the
     * back, flanks avoided (the AI doesn't understand the spawn tax).
     */
    findAiSpot(
        team: Team,
        seat: SeatId,
        type: UnitType,
        rng: () => number,
    ): { anchor: Cell; rotated: boolean } | null {
        const preferFront = type.range < 10;
        // "front" (toward the middle) is a higher row for the near-edge side,
        // a lower row for the far-edge side
        const frontIsHigherRow = (team === 'player') !== this.map.ownAtFar;
        let best: { anchor: Cell; rotated: boolean } | null = null;
        let found = 0;
        for (let attempt = 0; attempt < 80 && found < 4; attempt++) {
            const rotated = rng() < 0.5;
            const fp = this.footprintOf(type, rotated);
            const anchor = {
                col: Math.floor(rng() * (this.map.cols - fp.cols + 1)),
                row: Math.floor(rng() * (this.map.rows - fp.rows + 1)),
            };
            const cells = this.coveredCells(fp, anchor);
            if (!cells) continue;
            if (!cells.every((c) => this.deployCellOk(team, c, type, seat) && !this.occupied.has(cellKey(c)))) continue;
            // the AI doesn't understand the flank-spawn tax yet — keep it off
            // the flanks so its units don't arrive at 1 hp unaware
            if (cells.some((c) => this.map.isFlankDeployCell(c, team))) continue;
            found++;
            const frontward = (a: Cell, b: Cell) =>
                frontIsHigherRow ? a.row > b.row : a.row < b.row;
            if (
                !best ||
                (preferFront ? frontward(anchor, best.anchor) : frontward(best.anchor, anchor))
            ) {
                best = { anchor, rotated };
            }
        }
        return best;
    }

    /** Puts a removed pack back on its committed spot (sell-action undo). */
    restoreUnit(unit: Unit): void {
        const ghost = this.intelGhosts.get(unit.id);
        if (ghost) {
            getUnitInstanceRenderer()?.unregisterUnit(ghost);
            this.scene.remove(ghost.view);
            this.intelGhosts.delete(unit.id);
        }
        this.units.push(unit);
        if (!unit.type.extra) {
            // extras never occupy tiles — writing them here would corrupt the grid
            const fp = this.footprintOf(unit.type, unit.rotated);
            for (const c of this.coveredCells(fp, unit.cell)!) this.occupied.set(cellKey(c), unit);
        }
        this.scene.add(unit.view);
        this.stampSandUnder(unit);
    }

    /** Removes a unit from the board entirely (buy-action undo). */
    removeUnit(unit: Unit): void {
        if (
            this.intelFog &&
            unit.team === 'enemy' &&
            this.intelSnapshot.has(unit.id) &&
            !this.intelGhosts.has(unit.id)
        ) {
            this.ensureSoldGhost(this.intelSnapshot.get(unit.id)!);
        }
        if (this.selectedUnit === unit) this.selectedUnit = null;
        this.selectedGroup = this.selectedGroup.filter((u) => u !== unit);
        this.release(unit);
        this.scene.remove(unit.view);
        const i = this.units.indexOf(unit);
        if (i >= 0) this.units.splice(i, 1);
    }

    /** Reveals everything (battle is about to start — all placements become visible). */
    revealAll(): void {
        this.intelFog = false;
        this.intelSnapshot.clear();
        this.clearIntelGhosts();
        for (const u of this.units) {
            u.revealed = true;
            this.setPackVisible(u, true);
            u.view.position.copy(u.world);
            this.restoreUnitFacing(u);
            u.refreshLevelBadge();
        }
    }

    /** Re-runs the facing rule for every unit (used after the board resets between rounds). */
    refaceAll(): void {
        for (const u of this.units) {
            if (u.type.structure) continue;
            u.faceClosestOf(this.opponentMechPositions(u.team, u));
        }
    }

    /** Flyers sit near the ground; packs may be repositioned. */
    beginDeployment(): void {
        for (const u of this.units) {
            u.setDeployment(true);
            u.seatMembers();
        }
    }

    /** Flyers climb to combat altitude. Rockets are already there — reseat so they stay. */
    beginBattle(): void {
        for (const u of this.units) {
            u.setDeployment(false);
            if (u.type.rocket) u.seatMembers();
        }
    }

    update(timeSeconds: number, dtSeconds: number): void {
        for (const unit of this.units) {
            unit.tickFlight(dtSeconds);
            unit.update(timeSeconds);
        }
        this.updateMovablePlates(timeSeconds);
        this.updateItemBadges();
        // intel fog snaps views to committed/snapshot poses — must run BEFORE
        // markers so a carried pack's cursor ride is not overwritten
        this.applyIntelFog();
        this.updateMarkers(timeSeconds);
        this.updateLevelArrows(timeSeconds);
    }

    private pulse(t: number): number {
        return 0.5 + 0.5 * Math.sin(t * 5.5);
    }

    private placeFootprintPlate(
        mesh: Mesh,
        material: MeshBasicMaterial,
        center: { x: number; z: number },
        fp: GridExtent,
        color: number,
        timeSeconds: number,
        animated: boolean,
        y = 0.04,
    ): void {
        const pulse = this.pulse(timeSeconds);
        const edge = animated ? 0.96 + 0.04 * pulse : 0.94;
        // tessellated per tile on the same lattice as the ground mesh, then
        // draped over the relief — so it hugs the terrain and units occlude it
        const fpKey = `${fp.cols}x${fp.rows}`;
        if (mesh.userData.fpKey !== fpKey) {
            mesh.geometry.dispose();
            const geo = new PlaneGeometry(fp.cols * CELL, fp.rows * CELL, fp.cols * 2, fp.rows * 2);
            geo.rotateX(-Math.PI / 2);
            mesh.geometry = geo;
            mesh.userData.fpKey = fpKey;
        }
        const pos = mesh.geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
            pos.setY(
                i,
                this.map.heightAt(center.x + pos.getX(i) * edge, center.z + pos.getZ(i) * edge),
            );
        }
        pos.needsUpdate = true;
        mesh.position.set(center.x, y + 0.04, center.z);
        mesh.scale.set(edge, 1, edge);
        material.color.setHex(color);
        material.opacity = animated ? 0.58 + 0.22 * pulse : MOVABLE_PLATE_OPACITY;
        mesh.visible = true;
    }

    /** small floating icon over every pack that carries an item */
    private updateItemBadges(): void {
        let used = 0;
        if (this.enabled) {
            for (const unit of this.units) {
                const icon = this.intelItemIcon(unit);
                if (!icon) continue;
                const world = this.intelWorldOf(unit);
                let sprite = this.itemBadges[used];
                if (!sprite) {
                    sprite = new Sprite();
                    sprite.scale.set(2.6, 2.6, 1);
                    this.scene.add(sprite);
                    this.itemBadges.push(sprite);
                }
                sprite.material = this.itemBadgeMaterial(icon);
                // memberBaseY tracks deploy hug vs combat climb (not type.flying)
                sprite.position.set(
                    world.x,
                    world.y + unit.memberBaseY() + unit.type.meshScale * 2.6 + 2.2,
                    world.z,
                );
                sprite.visible = true;
                used++;
            }
            if (this.intelFog) {
                for (const [id, snap] of this.intelSnapshot) {
                    if (snap.team !== 'enemy' || snap.items.length === 0) continue;
                    if (this.units.some((u) => u.id === id)) continue;
                    const ghost = this.intelGhosts.get(id);
                    if (!ghost) continue;
                    const icon = ITEMS[snap.items[0]!]?.icon ?? '?';
                    let sprite = this.itemBadges[used];
                    if (!sprite) {
                        sprite = new Sprite();
                        sprite.scale.set(2.6, 2.6, 1);
                        this.scene.add(sprite);
                        this.itemBadges.push(sprite);
                    }
                    sprite.material = this.itemBadgeMaterial(icon);
                    sprite.position.set(
                        snap.world.x,
                        snap.world.y +
                            ghost.memberBaseY() +
                            ghost.type.meshScale * 2.6 +
                            2.2,
                        snap.world.z,
                    );
                    sprite.visible = true;
                    used++;
                }
            }
        }
        for (let i = used; i < this.itemBadges.length; i++) this.itemBadges[i]!.visible = false;
    }

    private itemBadgeMaterial(icon: string): SpriteMaterial {
        let material = this.itemBadgeMaterials.get(icon);
        if (!material) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = 'rgba(24, 36, 20, 0.9)';
            ctx.beginPath();
            ctx.roundRect(4, 4, 56, 56, 12);
            ctx.fill();
            ctx.strokeStyle = '#b89020';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = '#ffe878';
            ctx.font = '36px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, 32, 34);
            const texture = new CanvasTexture(canvas);
            texture.colorSpace = SRGBColorSpace;
            material = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
            this.itemBadgeMaterials.set(icon, material);
        }
        return material;
    }

    /**
     * A small solid gold up-arrow bobbing over packs ready to level —
     * own packs use live readiness; enemies use phase-start intel while fogged
     * (including sold ghosts), then live readiness after reveal.
     */
    private updateLevelArrows(timeSeconds: number): void {
        let used = 0;
        if (this.enabled) {
            const place = (unit: Unit, seed: number) => {
                let arrow = this.levelArrows[used];
                if (!arrow) {
                    arrow = new Group();
                    arrow.scale.setScalar(3);
                    // square shaft + pyramid head — a solid "upgrade" arrow
                    const shaft = new Mesh(new BoxGeometry(0.34, 0.6, 0.34), this.levelArrowMaterial);
                    shaft.position.y = 0;
                    const head = new Mesh(new ConeGeometry(0.46, 0.7, 4), this.levelArrowMaterial);
                    head.rotation.y = Math.PI / 4; // pyramid faces align with the shaft
                    head.position.y = 0.65;
                    arrow.add(shaft, head);
                    this.scene.add(arrow);
                    this.levelArrows.push(arrow);
                }
                const bob = Math.sin(timeSeconds * 3 + seed) * 0.2;
                const top =
                    unit.view.position.y +
                    unit.memberBaseY() +
                    unit.type.meshScale * 2.4 +
                    0.9;
                arrow.position.set(unit.view.position.x, top + bob, unit.view.position.z);
                arrow.visible = true;
                used++;
            };

            for (const unit of this.units) {
                if (unit.team === 'enemy' && this.intelFog) {
                    const snap = this.intelSnapshot.get(unit.id);
                    if (!snap?.upgradeReady) continue;
                    place(unit, unit.id);
                    continue;
                }
                if (!this.levelReady?.(unit)) continue;
                place(unit, unit.id);
            }

            // sold snapshotted enemies keep their stale upgrade arrow on the ghost
            if (this.intelFog) {
                for (const [id, snap] of this.intelSnapshot) {
                    if (snap.team !== 'enemy' || !snap.upgradeReady) continue;
                    if (this.units.some((u) => u.id === id)) continue;
                    const ghost = this.intelGhosts.get(id);
                    if (!ghost) continue;
                    place(ghost, id);
                }
            }
        }
        for (let i = used; i < this.levelArrows.length; i++) this.levelArrows[i]!.visible = false;
    }

    /**
     * Build phase: movable packs that are not selected show a static green plate.
     */
    private updateMovablePlates(_timeSeconds: number): void {
        let used = 0;
        if (this.enabled) {
            for (const unit of this.units) {
                if (!this.isMovable(unit)) continue;
                if (this.isHighlighted(unit)) continue;
                let plate = this.movablePlates[used];
                if (!plate) {
                    plate = new Mesh(this.plateGeometry.clone(), this.plateMaterial);
                    this.scene.add(plate);
                    this.movablePlates.push(plate);
                }
                const fp = this.footprintOf(unit.type, unit.rotated);
                const center = this.map.areaCenter(unit.cell, fp.cols, fp.rows);
                this.placeFootprintPlate(plate, this.plateMaterial, center, fp, VALID_COLOR, 0, false, 0.025);
                used++;
            }
        }
        for (let i = used; i < this.movablePlates.length; i++) this.movablePlates[i]!.visible = false;
    }

    /**
     * Positions of every individual opposing mech (not squad centers) that is
     * visible in enemy intel — snapshotted placements and sold ghosts count.
     */
    private opponentMechPositions(team: BattleTeam, exclude: Unit): Vector3[] {
        const positions: Vector3[] = [];
        for (const u of this.units) {
            if (u === exclude || u.team === team || u.destroyed) continue;
            if (this.intelFog && u.team !== team) {
                const snap = this.intelSnapshot.get(u.id);
                if (!snap) continue;
                positions.push(...this.memberPositionsAt(snap.world, u));
                continue;
            }
            if (!u.revealed) continue;
            positions.push(...u.memberWorldPositions());
        }
        if (this.intelFog) {
            for (const [id, snap] of this.intelSnapshot) {
                if (snap.team === team || id === exclude.id) continue;
                if (this.units.some((u) => u.id === id)) continue;
                const ghost = this.intelGhosts.get(id);
                if (!ghost) continue;
                positions.push(...this.memberPositionsAt(snap.world, ghost));
            }
        }
        return positions;
    }

    private clearIntelGhosts(): void {
        const instances = getUnitInstanceRenderer();
        for (const ghost of this.intelGhosts.values()) {
            instances?.unregisterUnit(ghost);
            this.scene.remove(ghost.view);
        }
        this.intelGhosts.clear();
    }

    private ensureSoldGhost(entry: IntelEntry): Unit {
        let ghost = this.intelGhosts.get(entry.unitId);
        if (ghost) return ghost;
        const type = unitTypeById(entry.typeId)!;
        ghost = new Unit(type, entry.cell, entry.team, entry.world.clone(), entry.rotated);
        ghost.id = entry.unitId;
        ghost.facing = entry.facing;
        ghost.level = entry.level;
        ghost.refreshLevelBadge();
        for (const id of entry.items) ghost.items.push(id);
        if (!type.structure || type.rocket) {
            for (const m of ghost.members) m.mesh.rotation.y = entry.facing;
        }
        this.intelGhosts.set(entry.unitId, ghost);
        this.scene.add(ghost.view);
        return ghost;
    }

    private restoreUnitFacing(unit: Unit): void {
        if ((unit.type.structure && !unit.type.rocket) || unit.members.length === 0) return;
        for (const m of unit.members) m.mesh.rotation.y = unit.facing;
    }

    private applySnapshotPose(unit: Unit, snap: IntelEntry): void {
        unit.view.position.copy(snap.world);
        if (!unit.type.structure || unit.type.rocket) {
            for (const m of unit.members) m.mesh.rotation.y = snap.facing;
        }
    }

    private intelWorldOf(unit: Unit): Vector3 {
        if (this.intelFog && unit.team === 'enemy') {
            const snap = this.intelSnapshot.get(unit.id);
            if (snap) return snap.world;
        }
        return unit.world;
    }

    private intelItemIcon(unit: Unit): string | null {
        if (unit.team === 'player') {
            return unit.items[0] ? (ITEMS[unit.items[0]]?.icon ?? '?') : null;
        }
        if (!this.enemyIntelVisible(unit)) return null;
        if (this.intelFog) {
            const snap = this.intelSnapshot.get(unit.id);
            if (!snap || snap.items.length === 0) return null;
            return ITEMS[snap.items[0]!]?.icon ?? '?';
        }
        return unit.items[0] ? (ITEMS[unit.items[0]]?.icon ?? '?') : null;
    }

    private memberPositionsAt(world: Vector3, unit: Unit): Vector3[] {
        return unit.members.map((m) => new Vector3(world.x + m.home.x, 0, world.z + m.home.z));
    }

    private applyIntelFog(): void {
        if (!this.enabled) return;
        if (!this.intelFog) {
            for (const ghost of this.intelGhosts.values()) this.setPackVisible(ghost, false);
            for (const u of this.units) {
                this.setPackVisible(u, true);
                u.view.position.copy(u.world);
                this.restoreUnitFacing(u);
            }
            return;
        }

        const liveEnemy = new Set(this.units.filter((u) => u.team === 'enemy').map((u) => u.id));

        for (const u of this.units) {
            if (u.team === 'player') {
                this.setPackVisible(u, true);
                u.view.position.copy(u.world);
                continue;
            }
            const snap = this.intelSnapshot.get(u.id);
            if (snap) {
                this.setPackVisible(u, true);
                this.applySnapshotPose(u, snap);
                u.refreshLevelBadge(snap.level);
            } else {
                // newly placed enemy packs — hide mesh AND shadows until reveal
                this.setPackVisible(u, false);
            }
        }

        for (const [id, snap] of this.intelSnapshot) {
            if (snap.team !== 'enemy' || liveEnemy.has(id)) continue;
            const ghost = this.ensureSoldGhost(snap);
            this.setPackVisible(ghost, true);
            this.applySnapshotPose(ghost, snap);
        }
        for (const [id, ghost] of this.intelGhosts) {
            if (!liveEnemy.has(id) && this.intelSnapshot.has(id)) continue;
            this.setPackVisible(ghost, false);
        }
    }

    /** Show/hide a pack's view and member proxies (instances honor parent visibility). */
    private setPackVisible(unit: Unit, visible: boolean): void {
        unit.view.visible = visible;
        for (const m of unit.members) m.mesh.visible = visible;
    }

    /** extras aren't in the occupancy map — hit-test their footprints directly */
    private extraAt(cell: Cell): Unit | undefined {
        return this.units.find((u) => {
            if (!u.type.extra) return false;
            const fp = this.footprintOf(u.type, u.rotated);
            return (
                cell.col >= u.cell.col &&
                cell.col < u.cell.col + fp.cols &&
                cell.row >= u.cell.row &&
                cell.row < u.cell.row + fp.rows
            );
        });
    }

    /** the pack under a surface point — for tactics that target units (e.g. sell) */
    unitAtPoint(x: number, y: number): Unit | undefined {
        return this.pickUnitAt(x, y);
    }

    /**
     * Resolve the pack under a screen point. During intel fog, enemy packs
     * (and sold ghosts) are hit-tested at their visible snapshot pose, not
     * the live occupied grid — otherwise AI moves make them unclickable.
     */
    private pickUnitAt(x: number, y: number, opts?: { skipExtras?: boolean }): Unit | undefined {
        const cell = this.cellAt(x, y);
        if (!cell) return undefined;

        if (this.intelFog) {
            const fogged = this.enemyAtIntelCell(cell);
            if (fogged && !fogged.destroyed) return fogged;
        }

        const unit = this.occupied.get(cellKey(cell)) ?? (opts?.skipExtras ? undefined : this.extraAt(cell));
        if (!unit || unit.destroyed) return undefined;
        // live enemy cell under fog may be a hidden post-move position — ignore
        if (this.intelFog && unit.team === 'enemy') return undefined;
        return unit;
    }

    /** enemy pack or sold ghost whose snapshot footprint covers `cell` */
    private enemyAtIntelCell(cell: Cell): Unit | undefined {
        for (const [id, snap] of this.intelSnapshot) {
            if (snap.team !== 'enemy') continue;
            const type = unitTypeById(snap.typeId);
            if (!type) continue;
            const fp = this.footprintOf(type, snap.rotated);
            if (
                cell.col < snap.cell.col ||
                cell.col >= snap.cell.col + fp.cols ||
                cell.row < snap.cell.row ||
                cell.row >= snap.cell.row + fp.rows
            ) {
                continue;
            }
            const live = this.units.find((u) => u.id === id);
            if (live && !live.destroyed) return live;
            const ghost = this.intelGhosts.get(id);
            if (ghost && !ghost.destroyed) return ghost;
        }
        return undefined;
    }

    private handleClick(x: number, y: number): void {
        if (this.groundClickInterceptor?.(x, y)) return;
        const cell = this.cellAt(x, y);
        if (!cell) return;
        // click-placing an extra: buy it right here (stays pending if invalid)
        if (this.pendingType) {
            const anchor = this.centeredAnchor(this.pendingType, false, cell);
            const done = this.dispatch?.({
                kind: 'buy',
                team: 'player',
                typeId: this.pendingType.id,
                anchor,
                rotated: false,
            });
            if (done) this.cancelPlacing();
            return;
        }
        // while carrying, a click on an extra's tiles means "drop here", not "select it"
        const carrying =
            this.selectedGroup.length > 1 ||
            (this.selectedUnit !== null &&
                this.carryingSelected &&
                this.isMovable(this.selectedUnit));
        const clicked = this.pickUnitAt(x, y, { skipExtras: carrying });
        // selecting: any own pack, or an enemy pack visible in intel
        if (clicked && !clicked.destroyed && (clicked.team === 'player' || this.enemyIntelVisible(clicked))) {
            if (clicked === this.selectedUnit && this.selectedGroup.length <= 1) {
                if (this.isMovable(clicked)) {
                    if (!this.carryingSelected) {
                        this.carryingSelected = true; // second click picks it up
                    } else {
                        // carrying and clicked its own tiles: drop it right here
                        const anchor = this.centeredAnchor(clicked.type, clicked.rotated, cell);
                        const done = this.dispatch?.({
                            kind: 'move',
                            team: 'player',
                            unitId: clicked.id,
                            anchor,
                        });
                        if (done) this.carryingSelected = false; // dropped, still selected
                    }
                }
            } else {
                this.restoreSelectedView();
                this.selectedUnit = clicked;
                this.selectedGroup = [];
                this.carryingSelected = false; // first click only selects
            }
            this.onSelect?.(clicked);
            return;
        }
        // empty ground: drop the carried formation there — all packs or none
        if (this.selectedGroup.length > 1) {
            const center = this.groupCenterCell();
            const done = this.dispatch?.({
                kind: 'moveGroup',
                team: 'player',
                unitIds: this.selectedGroup.map((u) => u.id),
                dc: cell.col - center.col,
                dr: cell.row - center.row,
            });
            if (done) this.deselect();
            return;
        }
        // empty ground: drop only while carrying; mere selection clears
        if (this.selectedUnit && this.isMovable(this.selectedUnit) && this.carryingSelected) {
            const anchor = this.centeredAnchor(this.selectedUnit.type, this.selectedUnit.rotated, cell);
            const done = this.dispatch?.({
                kind: 'move',
                team: 'player',
                unitId: this.selectedUnit.id,
                anchor,
            });
            if (done) this.carryingSelected = false; // placed — stay selected, details only
        } else {
            this.deselect();
        }
    }

    // --- rectangle multi-select ---

    private updateRect(a: { x: number; y: number }, b: { x: number; y: number }): void {
        this.rectActive = true;
        this.rectEl.style.display = 'block';
        this.rectEl.style.left = `${Math.min(a.x, b.x)}px`;
        this.rectEl.style.top = `${Math.min(a.y, b.y)}px`;
        this.rectEl.style.width = `${Math.abs(a.x - b.x)}px`;
        this.rectEl.style.height = `${Math.abs(a.y - b.y)}px`;
        this.rectPreview = this.movableUnitsInRect(a, b);
    }

    private hideRect(): void {
        this.rectActive = false;
        this.rectEl.style.display = 'none';
        this.rectPreview = [];
    }

    private finishRectSelect(a: { x: number; y: number }, b: { x: number; y: number }): void {
        const units = this.movableUnitsInRect(a, b);
        this.restoreSelectedView();
        if (units.length === 0) {
            this.deselect();
            return;
        }
        this.selectedUnit = units[0]!;
        this.selectedGroup = units.length > 1 ? units : [];
        this.carryingSelected = false; // rect select never picks up directly
    }

    /** only packs that can actually be repositioned are rect-selectable */
    private movableUnitsInRect(
        a: { x: number; y: number },
        b: { x: number; y: number },
    ): Unit[] {
        const rect = this.surface.getBoundingClientRect();
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        const result: Unit[] = [];
        for (const u of this.units) {
            if (!this.isMovable(u)) continue;
            const s = this.rig.worldToScreen(u.world.x, 0, u.world.z, rect.width, rect.height);
            if (!s) continue;
            if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) result.push(u);
        }
        return result;
    }

    /** cell at the center of the group's committed bounding box — the drag handle */
    private groupCenterCell(): Cell {
        let minCol = Infinity;
        let maxCol = -Infinity;
        let minRow = Infinity;
        let maxRow = -Infinity;
        for (const u of this.selectedGroup) {
            const fp = this.footprintOf(u.type, u.rotated);
            minCol = Math.min(minCol, u.cell.col);
            maxCol = Math.max(maxCol, u.cell.col + fp.cols - 1);
            minRow = Math.min(minRow, u.cell.row);
            maxRow = Math.max(maxRow, u.cell.row + fp.rows - 1);
        }
        return { col: Math.round((minCol + maxCol) / 2), row: Math.round((minRow + maxRow) / 2) };
    }

    /** a group target spot may reuse cells the group itself is vacating */
    private groupSpotValid(unit: Unit, anchor: Cell, group: readonly Unit[]): boolean {
        const cells = this.coveredCells(this.footprintOf(unit.type, unit.rotated), anchor);
        return (
            cells !== null &&
            cells.every((c) => {
                if (!this.deployCellOk(unit.team, c, unit.type, unit.seat)) return false;
                if (unit.type.extra) return true; // extras overlap anything (but not flanks)
                const holder = this.occupied.get(cellKey(c));
                return holder === undefined || holder === unit || group.includes(holder);
            })
        );
    }

    /**
     * Translates a formation by one cell delta (shape preserved, so members
     * can't collide with each other). All spots must be valid, or nothing
     * moves (dispatcher-only).
     */
    moveUnits(units: readonly Unit[], dc: number, dr: number): boolean {
        const anchors = units.map((u) => ({ col: u.cell.col + dc, row: u.cell.row + dr }));
        if (!units.every((u, i) => this.groupSpotValid(u, anchors[i]!, units))) return false;
        for (const u of units) this.release(u);
        units.forEach((u, i) => {
            const fp = this.footprintOf(u.type, u.rotated);
            const anchor = anchors[i]!;
            u.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
            if (u.type.extra) return;
            for (const c of this.coveredCells(fp, anchor)!) this.occupied.set(cellKey(c), u);
        });
        for (const u of units) {
            u.faceClosestOf(this.opponentMechPositions(u.team, u));
            this.stampSandUnder(u);
        }
        return true;
    }

    /** Repositions one pack when the target fits its team's zones (dispatcher-only). */
    moveUnit(unit: Unit, anchor: Cell): boolean {
        const fp = this.footprintOf(unit.type, unit.rotated);
        const cells = this.coveredCells(fp, anchor);
        const fits = (c: Cell) =>
            this.deployCellOk(unit.team, c, unit.type, unit.seat) &&
            (unit.type.extra || this.freeFor(c, unit));
        if (!cells || !cells.every(fits)) return false;
        this.release(unit);
        unit.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
        if (!unit.type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
        this.stampSandUnder(unit);
        return true;
    }

    private release(unit: Unit): void {
        for (const [key, u] of this.occupied) {
            if (u === unit) this.occupied.delete(key);
        }
    }

    private freeFor(cell: Cell, unit: Unit): boolean {
        const holder = this.occupied.get(cellKey(cell));
        return holder === undefined || holder === unit;
    }

    private toLocal(e: PointerEvent): { x: number; y: number } {
        const rect = this.surface.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private footprintOf(type: UnitType, rotated: boolean): GridExtent {
        return rotated
            ? { cols: type.footprint.rows, rows: type.footprint.cols }
            : type.footprint;
    }

    /** anchor cell so the footprint is centered on the given cell */
    private centeredAnchor(type: UnitType, rotated: boolean, center: Cell): Cell {
        const fp = this.footprintOf(type, rotated);
        return {
            col: center.col - Math.floor((fp.cols - 1) / 2),
            row: center.row - Math.floor((fp.rows - 1) / 2),
        };
    }

    private cellAt(x: number, y: number): Cell | null {
        const rect = this.surface.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        return ground ? this.map.worldToCell(ground) : null;
    }

    /** latest pointer position in canvas-local pixels (for tactic previews) */
    get lastPointer(): { x: number; y: number } | null {
        return this.pointer;
    }

    /** all tiles under the footprint, or null when part of it is off the map */
    private coveredCells(fp: GridExtent, anchor: Cell): Cell[] | null {
        const cells: Cell[] = [];
        for (let c = 0; c < fp.cols; c++) {
            for (let r = 0; r < fp.rows; r++) {
                const cell = { col: anchor.col + c, row: anchor.row + r };
                if (!this.map.inBounds(cell)) return null;
                cells.push(cell);
            }
        }
        return cells;
    }

    private updateMarkers(timeSeconds: number): void {
        const sel = this.selectedUnit;
        this.hoverMesh.visible = false;
        this.selectMesh.visible = false;
        this.rangeMesh.visible = false;

        // an extra riding the cursor: ghost mesh + footprint plate + effect ring
        if (this.pendingType && this.pendingUnit && this.enabled) {
            this.showGroupPlates([], null, false, timeSeconds);
            this.targetPreview.clear();
            const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
            if (!cell) {
                this.pendingUnit.view.position.set(0, -9999, 0);
                return;
            }
            const type = this.pendingType;
            const fp = this.footprintOf(type, false);
            const anchor = this.centeredAnchor(type, false, cell);
            const cells = this.coveredCells(fp, anchor);
            const valid = cells !== null && cells.every((c) => this.deployCellOk('player', c, type, this.localSeat));
            const center = this.map.areaCenter(anchor, fp.cols, fp.rows);
            this.pendingUnit.view.position.set(center.x, 0, center.z);
            this.pendingUnit.seatMembers(center.x, center.z);
            this.placeFootprintPlate(
                this.hoverMesh,
                this.hoverMaterial,
                center,
                fp,
                valid ? VALID_COLOR : INVALID_COLOR,
                timeSeconds,
                true,
            );
            // show what it will cover: dome radius, or the rocket's trigger range
            const radius = type.shield?.radius ?? type.rocket?.range;
            if (radius) {
                placeRangeRing(this.rangeMesh, center.x, center.z, radius);
            }
            return;
        }

        // while rubber-banding: highlight what the rect would select
        if (this.rectActive) {
            this.showGroupPlates(this.rectPreview, null, false, timeSeconds);
            this.targetPreview.clear();
            return;
        }
        // a formation is carried as one rigid shape, each pack showing its own validity
        if (this.selectedGroup.length > 1 && this.enabled) {
            const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
            const center = this.groupCenterCell();
            const delta = cell ? { dc: cell.col - center.col, dr: cell.row - center.row } : null;
            this.showGroupPlates(this.selectedGroup, delta, true, timeSeconds);
            this.targetPreview.clear();
            return;
        }
        this.showGroupPlates([], null, false, timeSeconds);
        if (!sel || !this.enabled) {
            this.targetPreview.clear();
            return;
        }

        const fp = this.footprintOf(sel.type, sel.rotated);
        const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;

        // a PICKED-UP movable pack rides the cursor; mere selection only pulses the plate
        let markerCenter: Vector3;
        if (this.carryingSelected && this.isMovable(sel)) {
            const center = cell
                ? this.map.areaCenter(
                      this.centeredAnchor(sel.type, sel.rotated, cell),
                      fp.cols,
                      fp.rows,
                  )
                : this.map.areaCenter(sel.cell, fp.cols, fp.rows);
            if (cell) {
                const anchor = this.centeredAnchor(sel.type, sel.rotated, cell);
                const cells = this.coveredCells(fp, anchor);
                const valid =
                    cells !== null &&
                    cells.every((c) => this.deployCellOk('player', c, sel.type, sel.seat) && this.freeFor(c, sel));
                this.hoverMaterial.color.setHex(valid ? VALID_COLOR : INVALID_COLOR);
            } else {
                this.hoverMaterial.color.setHex(VALID_COLOR);
            }
            this.applyViewHeight(sel, center.x, center.z, true);
            this.placeFootprintPlate(
                this.hoverMesh,
                this.hoverMaterial,
                center,
                fp,
                this.hoverMaterial.color.getHex(),
                timeSeconds,
                true,
            );
            markerCenter = center;
        } else {
            sel.view.position.copy(sel.world);
            sel.seatMembers(sel.world.x, sel.world.z);
            const center = this.map.areaCenter(sel.cell, fp.cols, fp.rows);
            this.placeFootprintPlate(
                this.hoverMesh,
                this.hoverMaterial,
                center,
                fp,
                VALID_COLOR,
                timeSeconds,
                true,
            );
            markerCenter = center;
        }

        // attack range ring for own packs (follows the carried position)
        if (sel.team === 'player' && !sel.type.structure && this.rangeOf) {
            const radius = this.rangeOf(sel) + sel.type.collisionRadius;
            placeRangeRing(this.rangeMesh, markerCenter.x, markerCenter.z, radius);
        }

        const origin =
            this.carryingSelected && this.isMovable(sel) ? markerCenter : this.intelWorldOf(sel);
        this.syncTargetPreview(sel, origin, timeSeconds);
    }

    /**
     * Marching arrows from the selected pack to every opposing pack / building
     * its mechs would open on. Always from the local player's knowledge: own
     * packs are live (so a newly bought pack next to an enemy is counted),
     * fogged enemies stay at their phase-start poses.
     */
    private syncTargetPreview(
        sel: Unit,
        fromCenter: { x: number; z: number },
        timeSeconds: number,
    ): void {
        const wantAir = sel.type.targets.air;
        const wantGround = sel.type.targets.ground;
        if (!wantAir && !wantGround) {
            this.targetPreview.clear();
            return;
        }

        const foes = this.playerVisibleFoes(sel);
        if (foes.length === 0) {
            this.targetPreview.clear();
            return;
        }

        const rocketRange = sel.type.rocket?.range;
        /** pack id → destination center as the player sees it */
        const targeted = new Map<number, { toX: number; toZ: number }>();
        for (const m of sel.members) {
            const mx = fromCenter.x + m.home.x;
            const mz = fromCenter.z + m.home.z;
            let best: (typeof foes)[number] | null = null;
            let bestD = Infinity;
            for (const foe of foes) {
                if (foe.isAir ? !wantAir : !wantGround) continue;
                const d = (foe.x - mx) ** 2 + (foe.z - mz) ** 2;
                if (d < bestD || (d === bestD && best !== null && foe.packId < best.packId)) {
                    bestD = d;
                    best = foe;
                }
            }
            if (!best) continue;
            // rockets only lock once something is in trigger range
            if (rocketRange != null && bestD > rocketRange * rocketRange) continue;
            targeted.set(best.packId, { toX: best.packX, toZ: best.packZ });
        }

        const routes: TargetPreviewRoute[] = [];
        for (const dest of targeted.values()) {
            routes.push({
                fromX: fromCenter.x,
                fromZ: fromCenter.z,
                toX: dest.toX,
                toZ: dest.toZ,
            });
        }
        this.targetPreview.sync(routes, timeSeconds, SELECT_COLOR);
    }

    /**
     * Opposing mechs as the local player sees them right now.
     * - Player packs (when inspecting an enemy): always live — new buys/moves count.
     * - Enemy packs (when inspecting own): intel-fog poses while fogged.
     */
    private playerVisibleFoes(sel: Unit): {
        packId: number;
        x: number;
        z: number;
        packX: number;
        packZ: number;
        isAir: boolean;
    }[] {
        const out: {
            packId: number;
            x: number;
            z: number;
            packX: number;
            packZ: number;
            isAir: boolean;
        }[] = [];
        const opponent: Team = sel.team === 'player' ? 'enemy' : 'player';

        for (const u of this.units) {
            if (u.team !== opponent || u.destroyed || u.consumed || u.type.extra) continue;

            let world: Vector3;
            if (opponent === 'player') {
                // own army is always known live
                world = u.world;
            } else if (this.intelFog) {
                const snap = this.intelSnapshot.get(u.id);
                if (!snap) continue; // enemy pack not in phase-start intel
                world = snap.world;
            } else {
                if (!u.revealed) continue;
                world = u.world;
            }

            const isAir = (u.type.flying ?? 0) > 0;
            for (const m of u.members) {
                out.push({
                    packId: u.id,
                    x: world.x + m.home.x,
                    z: world.z + m.home.z,
                    packX: world.x,
                    packZ: world.z,
                    isAir,
                });
            }
        }

        // sold enemies still visible as intel ghosts
        if (opponent === 'enemy' && this.intelFog) {
            for (const [id, snap] of this.intelSnapshot) {
                if (snap.team !== 'enemy') continue;
                if (this.units.some((u) => u.id === id)) continue;
                const ghost = this.intelGhosts.get(id);
                if (!ghost || ghost.type.extra) continue;
                const world = snap.world;
                const isAir = (ghost.type.flying ?? 0) > 0;
                for (const m of ghost.members) {
                    out.push({
                        packId: id,
                        x: world.x + m.home.x,
                        z: world.z + m.home.z,
                        packX: world.x,
                        packZ: world.z,
                        isAir,
                    });
                }
            }
        }

        return out;
    }

    /**
     * One plate per group member. Without a delta the packs sit at their
     * committed spots under yellow plates; with a delta (cursor on the map)
     * their views ride the cursor and each plate turns green/red for its own
     * target spot.
     */
    private showGroupPlates(
        units: readonly Unit[],
        delta: { dc: number; dr: number } | null,
        lift: boolean,
        timeSeconds: number,
    ): void {
        for (let i = 0; i < units.length; i++) {
            const unit = units[i]!;
            let plate = this.groupPlates[i];
            if (!plate) {
                plate = new Mesh(
                    this.plateGeometry.clone(),
                    new MeshBasicMaterial({
                        transparent: true,
                        opacity: 0.68,
                        side: DoubleSide,
                        depthWrite: false,
                    }),
                );
                this.scene.add(plate);
                this.groupPlates.push(plate);
            }
            const fp = this.footprintOf(unit.type, unit.rotated);
            const anchor = delta
                ? { col: unit.cell.col + delta.dc, row: unit.cell.row + delta.dr }
                : unit.cell;
            const center = this.map.areaCenter(anchor, fp.cols, fp.rows);
            const moving = lift && delta !== null;
            if (moving) this.applyViewHeight(unit, center.x, center.z, true);
            else {
                unit.view.position.set(center.x, unit.world.y, center.z);
                if (unit.type.structure) unit.seatMembers(center.x, center.z);
            }
            const color = !delta
                ? VALID_COLOR
                : this.groupSpotValid(unit, anchor, units)
                  ? VALID_COLOR
                  : INVALID_COLOR;
            this.placeFootprintPlate(
                plate,
                plate.material as MeshBasicMaterial,
                center,
                fp,
                color,
                timeSeconds,
                true,
                0.035,
            );
        }
        for (let i = units.length; i < this.groupPlates.length; i++) this.groupPlates[i]!.visible = false;
    }
}
