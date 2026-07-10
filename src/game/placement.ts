import {
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    RingGeometry,
    type Scene,
    type Vector3,
} from 'three';
import type { CameraRig } from '../engine/cameraRig';
import { THEME } from '../theme';
import type { Action } from './actions';
import { CELL, cellKey, type BattleMap, type Cell } from './map';
import type { Economy } from './settings';
import { Unit, type GridExtent, type Team, type UnitType } from './units';

const VALID_COLOR = THEME.valid;
const INVALID_COLOR = THEME.invalid;
const SELECT_COLOR = THEME.select;

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
    mesh.position.y = 0.05;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
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
     * true while a build phase runs: new placements spawn unrevealed — the
     * opponent can't see them (or face them) until the battle starts.
     */
    hiddenPlacements = false;
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

    private nextUnitId = 1;
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
    /** rect-selected movable packs (2+); a single selection uses selectedUnit */
    private selectedGroup: Unit[] = [];
    /** movable packs currently inside the rubber-band, live while dragging */
    private rectPreview: Unit[] = [];
    /** per-member marker plates (own material each — validity color differs per pack) */
    private readonly groupPlates: Mesh[] = [];
    /** pulsing gold rings under packs with a buyable level */
    private readonly readyRings: Mesh[] = [];
    private readonly readyRingMaterial: MeshBasicMaterial;
    private readonly rectEl: HTMLDivElement;
    private rectActive = false;
    private pointer: { x: number; y: number } | null = null;
    private downAt: { x: number; y: number } | null = null;

    constructor(
        private readonly rig: CameraRig,
        private readonly map: BattleMap,
        private readonly economy: Economy,
        private readonly scene: Scene,
        private readonly surface: HTMLElement,
    ) {
        const makeMarker = (color: number, opacity: number) => {
            const geo = new PlaneGeometry(1, 1); // scaled per footprint each frame
            geo.rotateX(-Math.PI / 2);
            const material = new MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                side: DoubleSide,
                depthWrite: false,
            });
            const mesh = new Mesh(geo, material);
            mesh.visible = false;
            scene.add(mesh);
            return mesh;
        };
        this.hoverMesh = makeMarker(VALID_COLOR, 0.3);
        this.hoverMesh.position.y = 0.04;
        this.hoverMaterial = this.hoverMesh.material as MeshBasicMaterial;
        this.selectMesh = makeMarker(SELECT_COLOR, 0.22);
        this.selectMesh.position.y = 0.03;

        // attack range ring for the selected own pack (unit radius, scaled per unit)
        this.rangeMesh = createRangeRing(scene);

        this.readyRingMaterial = new MeshBasicMaterial({
            color: SELECT_COLOR,
            transparent: true,
            opacity: 0.5,
            side: DoubleSide,
            depthWrite: false,
        });

        this.plateGeometry = new PlaneGeometry(1, 1);
        this.plateGeometry.rotateX(-Math.PI / 2);
        this.plateMaterial = new MeshBasicMaterial({
            color: THEME.movable,
            transparent: true,
            opacity: 0.16,
            side: DoubleSide,
            depthWrite: false,
        });

        // rubber-band rectangle, drawn as a plain overlay div on the wrapper
        this.rectEl = document.createElement('div');
        this.rectEl.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:10; border:1.5px solid ${THEME.ui.hover}; background:rgba(255, 208, 64, 0.08);`;
        (surface.parentElement ?? document.body).appendChild(this.rectEl);

        surface.addEventListener('pointermove', (e: PointerEvent) => {
            this.pointer = this.toLocal(e);
            if (!this.downAt || !this.enabled) return;
            const moved = Math.hypot(this.pointer.x - this.downAt.x, this.pointer.y - this.downAt.y);
            if (this.rectActive || moved > 6) this.updateRect(this.downAt, this.pointer);
        });
        surface.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return;
            this.downAt = this.toLocal(e);
            // the rubber-band keeps tracking (and reliably ends) outside the canvas
            surface.setPointerCapture(e.pointerId);
        });
        surface.addEventListener('pointercancel', () => {
            this.downAt = null;
            this.hideRect();
        });
        surface.addEventListener('pointerup', (e: PointerEvent) => {
            if (e.button !== 0) return;
            const down = this.downAt;
            this.downAt = null;
            const wasRect = this.rectActive;
            this.hideRect();
            if (!this.enabled || !down) return;
            const up = this.toLocal(e);
            if (wasRect) {
                this.finishRectSelect(down, up);
                return;
            }
            if (Math.hypot(up.x - down.x, up.y - down.y) > 6) return; // drag, not a click
            this.handleClick(up.x, up.y);
        });
    }

    get unitCount(): number {
        return this.units.length;
    }

    allUnits(): readonly Unit[] {
        return this.units;
    }

    deselect(): void {
        this.restoreSelectedView();
        this.selectedUnit = null;
        this.selectedGroup = [];
    }

    /** carried packs go back to their committed spots */
    private restoreSelectedView(): void {
        this.selectedUnit?.view.position.copy(this.selectedUnit.world);
        for (const u of this.selectedGroup) u.view.position.copy(u.world);
    }

    /** repositioning is allowed only in the round the pack was deployed */
    canReposition(unit: Unit): boolean {
        return !unit.type.structure && unit.deployedRound === this.currentRound;
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
        const centerCol = Math.floor(this.map.cols / 2);
        const centerRow = Math.floor(this.map.size.zoneRows / 2);
        const maxRadius = Math.max(this.map.cols, this.map.rows);
        for (let radius = 0; radius < maxRadius; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                    const anchor = this.centeredAnchor(type, false, {
                        col: centerCol + dc,
                        row: centerRow + dr,
                    });
                    if (this.canPlaceNew(type, false, anchor)) return anchor;
                }
            }
        }
        return null;
    }

    /** Middle click: leaves as a rotate action for the selected movable pack. */
    rotateSelected(): void {
        if (this.selectedGroup.length > 1) return; // formations don't rotate
        const unit = this.selectedUnit;
        if (!unit || !this.enabled || !this.isMovable(unit)) return;
        this.dispatch?.({ kind: 'rotate', team: unit.team, unitId: unit.id });
    }

    /** Rotates a pack in place when its rotated footprint fits (dispatcher-only). */
    rotateUnit(unit: Unit): boolean {
        const rotated = !unit.rotated;
        const fp = this.footprintOf(unit.type, rotated);
        const cells = this.coveredCells(fp, unit.cell);
        if (!cells || !cells.every((c) => this.zoneCell(unit.team, c) && this.freeFor(c, unit))) {
            return false;
        }
        this.release(unit);
        unit.setRotated(rotated);
        unit.moveTo(unit.cell, this.map.areaCenter(unit.cell, fp.cols, fp.rows));
        for (const c of cells) this.occupied.set(cellKey(c), unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
        return true;
    }

    /** a tile a team may deploy on */
    private zoneCell(team: Team, cell: Cell): boolean {
        return team === 'player' ? this.map.isPlayerCell(cell) : this.map.isEnemyCell(cell);
    }

    /**
     * Zone-validated placement for a buy action: the anchor must lie fully
     * in the buyer's territory and be free; spawning charges the cost.
     */
    placeUnit(team: Team, type: UnitType, anchor: Cell, rotated: boolean): Unit | null {
        const cells = this.coveredCells(this.footprintOf(type, rotated), anchor);
        const valid =
            cells !== null &&
            cells.every((c) => this.zoneCell(team, c) && !this.occupied.has(cellKey(c)));
        return valid ? this.spawn(type, anchor, team, rotated) : null;
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(type: UnitType, anchor: Cell, team: Team, rotated = false): Unit | null {
        const fp = this.footprintOf(type, rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells || cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        if (!this.economy.charge(team, type)) return null;
        const unit = new Unit(type, anchor, team, this.map.areaCenter(anchor, fp.cols, fp.rows), rotated);
        unit.id = this.nextUnitId++;
        unit.deployedRound = this.currentRound;
        if (this.hiddenPlacements) {
            unit.revealed = false;
            // your own hidden units are still visible to you; the enemy's are not
            unit.view.visible = team === 'player';
        }
        for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.units.push(unit);
        this.scene.add(unit.view);
        // core rule: every mech faces the closest individual enemy mech it
        // could be aware of — from revealed enemy units, or the enemy's
        // command towers when nothing else is visible
        unit.faceClosestOf(this.opponentMechPositions(team, unit));
        return unit;
    }

    /**
     * A valid spot for an enemy unit in its zones, with a formation
     * instinct: melee prefers the front line (low rows, toward the player),
     * ranged prefers the back. Search only — the AI dispatches a buy action
     * with the result. Randomness comes from the match RNG for determinism.
     */
    findEnemySpot(type: UnitType, rng: () => number): { anchor: Cell; rotated: boolean } | null {
        const preferFront = type.range < 10;
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
            if (!cells.every((c) => this.map.isEnemyCell(c) && !this.occupied.has(cellKey(c)))) continue;
            found++;
            if (
                !best ||
                (preferFront ? anchor.row < best.anchor.row : anchor.row > best.anchor.row)
            ) {
                best = { anchor, rotated };
            }
        }
        return best;
    }

    /** Removes a unit from the board entirely (buy-action undo). */
    removeUnit(unit: Unit): void {
        if (this.selectedUnit === unit) this.selectedUnit = null;
        this.selectedGroup = this.selectedGroup.filter((u) => u !== unit);
        this.release(unit);
        this.scene.remove(unit.view);
        const i = this.units.indexOf(unit);
        if (i >= 0) this.units.splice(i, 1);
    }

    /** Reveals everything (battle is about to start — all placements become visible). */
    revealAll(): void {
        for (const u of this.units) {
            u.revealed = true;
            u.view.visible = true;
        }
    }

    /** Re-runs the facing rule for every unit (used after the board resets between rounds). */
    refaceAll(): void {
        for (const u of this.units) {
            if (u.type.structure) continue;
            u.faceClosestOf(this.opponentMechPositions(u.team, u));
        }
    }

    update(timeSeconds: number): void {
        for (const unit of this.units) unit.update(timeSeconds);
        this.updateMovablePlates();
        this.updateReadyRings(timeSeconds);
        this.updateMarkers();
    }

    /** pulsing gold ring under every own pack whose next level is buyable */
    private updateReadyRings(timeSeconds: number): void {
        let used = 0;
        if (this.enabled && this.levelReady) {
            for (const unit of this.units) {
                if (unit.team !== 'player' || !this.levelReady(unit)) continue;
                let ring = this.readyRings[used];
                if (!ring) {
                    const geo = new RingGeometry(0.94, 1, 48);
                    geo.rotateX(-Math.PI / 2);
                    ring = new Mesh(geo, this.readyRingMaterial);
                    ring.position.y = 0.07;
                    this.scene.add(ring);
                    this.readyRings.push(ring);
                }
                const fp = this.footprintOf(unit.type, unit.rotated);
                const center = this.map.areaCenter(unit.cell, fp.cols, fp.rows);
                const radius = (Math.hypot(fp.cols, fp.rows) * CELL) / 2 + 0.6;
                ring.position.set(center.x, 0.07, center.z);
                ring.scale.set(radius, 1, radius);
                ring.visible = true;
                used++;
            }
            this.readyRingMaterial.opacity = 0.4 + 0.25 * Math.sin(timeSeconds * 4);
        }
        for (let i = used; i < this.readyRings.length; i++) this.readyRings[i]!.visible = false;
    }

    /**
     * Build phase: every pack that may still be repositioned stands on a
     * whitish plate — locked packs (earlier rounds, structures) have none.
     */
    private updateMovablePlates(): void {
        let used = 0;
        if (this.enabled) {
            for (const unit of this.units) {
                if (!this.isMovable(unit)) continue;
                let plate = this.movablePlates[used];
                if (!plate) {
                    plate = new Mesh(this.plateGeometry, this.plateMaterial);
                    this.scene.add(plate);
                    this.movablePlates.push(plate);
                }
                const fp = this.footprintOf(unit.type, unit.rotated);
                const center = this.map.areaCenter(unit.cell, fp.cols, fp.rows);
                plate.position.set(center.x, 0.025, center.z);
                plate.scale.set(fp.cols * CELL * 0.94, 1, fp.rows * CELL * 0.94);
                plate.visible = true;
                used++;
            }
        }
        for (let i = used; i < this.movablePlates.length; i++) this.movablePlates[i]!.visible = false;
    }

    /**
     * Positions of every individual opposing mech (not squad centers) that is
     * revealed — hidden build-phase placements are ignored.
     */
    private opponentMechPositions(team: Team, exclude: Unit): Vector3[] {
        const positions: Vector3[] = [];
        for (const u of this.units) {
            if (u === exclude || u.team === team || !u.revealed || u.destroyed) continue;
            positions.push(...u.memberWorldPositions());
        }
        return positions;
    }

    private handleClick(x: number, y: number): void {
        const cell = this.cellAt(x, y);
        if (!cell) return;
        const clicked = this.occupied.get(cellKey(cell));
        // selecting: any own pack, or a revealed enemy pack (hidden stays hidden)
        if (clicked && !clicked.destroyed && (clicked.team === 'player' || clicked.revealed)) {
            if (clicked !== this.selectedUnit || this.selectedGroup.length > 1) {
                this.restoreSelectedView();
                this.selectedUnit = clicked;
                this.selectedGroup = [];
            }
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
        // empty ground: drop the carried pack there — a successful drop releases it
        if (this.selectedUnit && this.isMovable(this.selectedUnit)) {
            const anchor = this.centeredAnchor(this.selectedUnit.type, this.selectedUnit.rotated, cell);
            const done = this.dispatch?.({
                kind: 'move',
                team: 'player',
                unitId: this.selectedUnit.id,
                anchor,
            });
            if (done) this.deselect();
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
                if (!this.zoneCell(unit.team, c)) return false;
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
            for (const c of this.coveredCells(fp, anchor)!) this.occupied.set(cellKey(c), u);
        });
        for (const u of units) {
            u.faceClosestOf(this.opponentMechPositions(u.team, u));
        }
        return true;
    }

    /** Repositions one pack when the target fits its team's zones (dispatcher-only). */
    moveUnit(unit: Unit, anchor: Cell): boolean {
        const fp = this.footprintOf(unit.type, unit.rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells || !cells.every((c) => this.zoneCell(unit.team, c) && this.freeFor(c, unit))) {
            return false;
        }
        this.release(unit);
        unit.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
        for (const c of cells) this.occupied.set(cellKey(c), unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
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

    private canPlaceNew(type: UnitType, rotated: boolean, anchor: Cell): boolean {
        const cells = this.coveredCells(this.footprintOf(type, rotated), anchor);
        return (
            cells !== null &&
            cells.every((c) => this.map.isPlayerCell(c) && !this.occupied.has(cellKey(c)))
        );
    }

    private updateMarkers(): void {
        const sel = this.selectedUnit;
        this.hoverMesh.visible = false;
        this.selectMesh.visible = false;
        this.rangeMesh.visible = false;

        // while rubber-banding: highlight what the rect would select
        if (this.rectActive) {
            this.showGroupPlates(this.rectPreview, null);
            return;
        }
        // a formation is carried as one rigid shape, each pack showing its own validity
        if (this.selectedGroup.length > 1 && this.enabled) {
            const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
            const center = this.groupCenterCell();
            const delta = cell ? { dc: cell.col - center.col, dr: cell.row - center.row } : null;
            this.showGroupPlates(this.selectedGroup, delta);
            return;
        }
        this.showGroupPlates([], null);
        if (!sel || !this.enabled) return;

        const fp = this.footprintOf(sel.type, sel.rotated);
        const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;

        // a movable pack is CARRIED: it rides the cursor with the preview
        // until a click drops it (or deselecting puts it back)
        let markerCenter: Vector3;
        if (this.isMovable(sel) && cell) {
            const anchor = this.centeredAnchor(sel.type, sel.rotated, cell);
            const cells = this.coveredCells(fp, anchor);
            const valid =
                cells !== null &&
                cells.every((c) => this.map.isPlayerCell(c) && this.freeFor(c, sel));
            const center = this.map.areaCenter(anchor, fp.cols, fp.rows);
            sel.view.position.set(center.x, 0, center.z);
            this.hoverMesh.position.set(center.x, 0.04, center.z);
            this.hoverMesh.scale.set(fp.cols * CELL * 0.98, 1, fp.rows * CELL * 0.98);
            this.hoverMaterial.color.setHex(valid ? VALID_COLOR : INVALID_COLOR);
            this.hoverMesh.visible = true;
            markerCenter = center;
        } else {
            // the pack sits at its committed spot with the selection marker
            sel.view.position.copy(sel.world);
            const center = this.map.areaCenter(sel.cell, fp.cols, fp.rows);
            this.selectMesh.position.set(center.x, 0.03, center.z);
            this.selectMesh.scale.set(fp.cols * CELL * 1.02, 1, fp.rows * CELL * 1.02);
            this.selectMesh.visible = true;
            markerCenter = center;
        }

        // attack range ring for own packs (follows the carried position)
        if (sel.team === 'player' && !sel.type.structure && this.rangeOf) {
            const radius = this.rangeOf(sel) + sel.type.collisionRadius;
            this.rangeMesh.position.set(markerCenter.x, 0.05, markerCenter.z);
            this.rangeMesh.scale.set(radius, 1, radius);
            this.rangeMesh.visible = true;
        }
    }

    /**
     * One plate per group member. Without a delta the packs sit at their
     * committed spots under yellow plates; with a delta (cursor on the map)
     * their views ride the cursor and each plate turns green/red for its own
     * target spot.
     */
    private showGroupPlates(units: readonly Unit[], delta: { dc: number; dr: number } | null): void {
        for (let i = 0; i < units.length; i++) {
            const unit = units[i]!;
            let plate = this.groupPlates[i];
            if (!plate) {
                plate = new Mesh(
                    this.plateGeometry,
                    new MeshBasicMaterial({
                        transparent: true,
                        opacity: 0.24,
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
            unit.view.position.set(center.x, 0, center.z);
            plate.position.set(center.x, 0.035, center.z);
            plate.scale.set(fp.cols * CELL * 0.98, 1, fp.rows * CELL * 0.98);
            (plate.material as MeshBasicMaterial).color.setHex(
                delta
                    ? this.groupSpotValid(unit, anchor, units)
                        ? VALID_COLOR
                        : INVALID_COLOR
                    : SELECT_COLOR,
            );
            plate.visible = true;
        }
        for (let i = units.length; i < this.groupPlates.length; i++) this.groupPlates[i]!.visible = false;
    }
}
