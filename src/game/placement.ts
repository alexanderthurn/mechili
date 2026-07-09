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
import { CELL, cellKey, type BattleMap, type Cell } from './map';
import type { Economy } from './settings';
import { Unit, type GridExtent, type Team, type UnitType } from './units';

const VALID_COLOR = 0x35e0ff;
const INVALID_COLOR = 0xff4040;
const SELECT_COLOR = 0xffe066;

/**
 * Deployment-phase interaction: buying drops a pack at the first free spot
 * near the center of the player zone; the player selects packs (left click)
 * and moves the ones bought THIS round by clicking a destination. Right
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

    private readonly units: Unit[] = [];
    private readonly occupied = new Map<string, Unit>();
    private readonly hoverMesh: Mesh;
    private readonly hoverMaterial: MeshBasicMaterial;
    private readonly selectMesh: Mesh;
    private readonly rangeMesh: Mesh;
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
        const ringGeo = new RingGeometry(0.985, 1, 96);
        ringGeo.rotateX(-Math.PI / 2);
        this.rangeMesh = new Mesh(
            ringGeo,
            new MeshBasicMaterial({
                color: VALID_COLOR,
                transparent: true,
                opacity: 0.4,
                side: DoubleSide,
                depthWrite: false,
            }),
        );
        this.rangeMesh.position.y = 0.05;
        this.rangeMesh.visible = false;
        scene.add(this.rangeMesh);

        surface.addEventListener('pointermove', (e: PointerEvent) => {
            this.pointer = this.toLocal(e);
        });
        surface.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button === 0) this.downAt = this.toLocal(e);
        });
        surface.addEventListener('pointerup', (e: PointerEvent) => {
            if (!this.enabled || e.button !== 0 || !this.downAt) return;
            const up = this.toLocal(e);
            const moved = Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y);
            this.downAt = null;
            if (moved > 6) return; // it was a drag, not a click
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
    }

    /** a carried pack goes back to its committed spot */
    private restoreSelectedView(): void {
        this.selectedUnit?.view.position.copy(this.selectedUnit.world);
    }

    /** a pack may be repositioned only in the round it was bought */
    isMovable(unit: Unit): boolean {
        return (
            unit.team === 'player' &&
            !unit.type.structure &&
            unit.deployedRound === this.currentRound
        );
    }

    /**
     * Buys a unit and drops it at the first free valid spot, searching in
     * rings outward from the center of the player's main zone. It arrives
     * deselected — click it to pick it up and move it.
     */
    buy(type: UnitType): Unit | null {
        if (!this.enabled || !this.economy.canAfford('player', type)) return null;
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
                    if (!this.canPlaceNew(type, false, anchor)) continue;
                    const unit = this.spawn(type, anchor, 'player', false);
                    if (unit) return unit;
                }
            }
        }
        return null;
    }

    /** Rotates the selected (movable) pack in place when its rotated footprint fits. */
    rotateSelected(): void {
        const unit = this.selectedUnit;
        if (!unit || !this.enabled || !this.isMovable(unit)) return;
        const rotated = !unit.rotated;
        const fp = this.footprintOf(unit.type, rotated);
        const cells = this.coveredCells(fp, unit.cell);
        if (!cells || !cells.every((c) => this.map.isPlayerCell(c) && this.freeFor(c, unit))) return;
        this.release(unit);
        unit.setRotated(rotated);
        unit.moveTo(unit.cell, this.map.areaCenter(unit.cell, fp.cols, fp.rows));
        for (const c of cells) this.occupied.set(cellKey(c), unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(type: UnitType, anchor: Cell, team: Team, rotated = false): Unit | null {
        const fp = this.footprintOf(type, rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells || cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        if (!this.economy.charge(team, type)) return null;
        const unit = new Unit(type, anchor, team, this.map.areaCenter(anchor, fp.cols, fp.rows), rotated);
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
     * Places an enemy unit at a random valid spot in its zones, with a
     * formation instinct: melee prefers the front line (low rows, toward the
     * player), ranged prefers the back.
     */
    spawnEnemyRandom(type: UnitType): Unit | null {
        const preferFront = type.range < 10;
        let best: { anchor: Cell; rotated: boolean } | null = null;
        let found = 0;
        for (let attempt = 0; attempt < 80 && found < 4; attempt++) {
            const rotated = Math.random() < 0.5;
            const fp = this.footprintOf(type, rotated);
            const anchor = {
                col: Math.floor(Math.random() * (this.map.cols - fp.cols + 1)),
                row: Math.floor(Math.random() * (this.map.rows - fp.rows + 1)),
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
        return best ? this.spawn(type, best.anchor, 'enemy', best.rotated) : null;
    }

    /** Removes a unit from the board entirely (build-phase undo). */
    removeUnit(unit: Unit): void {
        if (this.selectedUnit === unit) this.selectedUnit = null;
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
        this.updateMarkers();
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
            if (clicked !== this.selectedUnit) {
                this.restoreSelectedView();
                this.selectedUnit = clicked;
            }
            return;
        }
        // empty ground: drop the carried pack there — a successful drop releases it
        if (this.selectedUnit && this.isMovable(this.selectedUnit)) {
            const anchor = this.centeredAnchor(this.selectedUnit.type, this.selectedUnit.rotated, cell);
            if (this.tryMove(this.selectedUnit, anchor)) this.deselect();
        } else {
            this.deselect();
        }
    }

    private tryMove(unit: Unit, anchor: Cell): boolean {
        const fp = this.footprintOf(unit.type, unit.rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells || !cells.every((c) => this.map.isPlayerCell(c) && this.freeFor(c, unit))) return false;
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
}
