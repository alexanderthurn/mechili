import {
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    type Scene,
    type Vector3,
} from 'three';
import type { CameraRig } from '../engine/cameraRig';
import { CELL, cellKey, type BattleMap, type Cell } from './map';
import type { Economy } from './settings';
import { Unit, type GridExtent, type Team, type UnitType } from './units';

const VALID_COLOR = 0x35e0ff;
const INVALID_COLOR = 0xff4040;

/**
 * Hover highlight + click-to-place. A unit's footprint (cols x rows tiles,
 * centered on the hovered cell) must lie entirely on free cells inside the
 * player deployment zones. Input listens on the top-most surface (the UI
 * overlay canvas) so HUD buttons can swallow their own clicks.
 */
export class PlacementController {
    selectedType: UnitType | null = null;
    /** placement orientation, toggled with middle click: swaps footprint cols/rows */
    rotated = false;
    /** false during the battle phase: no hover, no placing */
    enabled = true;
    /**
     * true while a build phase runs: new placements spawn unrevealed — the
     * opponent can't see them (or face them) until the battle starts.
     */
    hiddenPlacements = false;
    /** fired for every successful spawn — the game logs these for the future replay system */
    onSpawn: ((unit: Unit) => void) | null = null;

    private readonly units: Unit[] = [];
    private readonly occupied = new Map<string, Unit>();
    private readonly hoverMesh: Mesh;
    private readonly hoverMaterial: MeshBasicMaterial;
    private pointer: { x: number; y: number } | null = null;
    private downAt: { x: number; y: number } | null = null;

    constructor(
        private readonly rig: CameraRig,
        private readonly map: BattleMap,
        private readonly economy: Economy,
        private readonly scene: Scene,
        private readonly surface: HTMLElement,
    ) {
        this.hoverMaterial = new MeshBasicMaterial({
            color: VALID_COLOR,
            transparent: true,
            opacity: 0.3,
            side: DoubleSide,
            depthWrite: false,
        });
        const geo = new PlaneGeometry(1, 1); // scaled per footprint each frame
        geo.rotateX(-Math.PI / 2);
        this.hoverMesh = new Mesh(geo, this.hoverMaterial);
        this.hoverMesh.position.y = 0.03;
        this.hoverMesh.visible = false;
        scene.add(this.hoverMesh);

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
            const anchor = this.anchorAt(up.x, up.y);
            if (anchor && this.selectedType && this.canPlace(this.selectedType, anchor)) {
                this.spawn(this.selectedType, anchor, 'player', this.rotated);
            }
        });
    }

    get unitCount(): number {
        return this.units.length;
    }

    allUnits(): readonly Unit[] {
        return this.units;
    }

    toggleRotation(): void {
        this.rotated = !this.rotated;
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(type: UnitType, anchor: Cell, team: Team, rotated = false): Unit | null {
        const fp = this.footprintOf(type, rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells || cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        if (!this.economy.charge(team, type)) return null;
        const unit = new Unit(type, anchor, team, this.map.areaCenter(anchor, fp.cols, fp.rows), rotated);
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
        this.onSpawn?.(unit);
        return unit;
    }

    /** Tries a few random anchors to place an enemy unit inside its own zones. */
    spawnEnemyRandom(type: UnitType): Unit | null {
        for (let attempt = 0; attempt < 60; attempt++) {
            const rotated = Math.random() < 0.5;
            const fp = this.footprintOf(type, rotated);
            const anchor = {
                col: Math.floor(Math.random() * (this.map.cols - fp.cols + 1)),
                row: Math.floor(Math.random() * (this.map.rows - fp.rows + 1)),
            };
            const cells = this.coveredCells(fp, anchor);
            if (!cells) continue;
            if (!cells.every((c) => this.map.isEnemyCell(c) && !this.occupied.has(cellKey(c)))) continue;
            return this.spawn(type, anchor, 'enemy', rotated);
        }
        return null;
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

    /**
     * Positions of every individual opposing mech (not squad centers) that is
     * revealed — hidden build-phase placements are ignored.
     */
    private opponentMechPositions(team: Team, exclude: Unit): Vector3[] {
        const positions: Vector3[] = [];
        for (const u of this.units) {
            if (u === exclude || u.team === team || !u.revealed) continue;
            positions.push(...u.memberWorldPositions());
        }
        return positions;
    }

    update(timeSeconds: number): void {
        for (const unit of this.units) unit.update(timeSeconds);
        this.updateHover();
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

    /** anchor cell so the selected type's footprint is centered on the hovered cell */
    private anchorAt(x: number, y: number): Cell | null {
        const rect = this.surface.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        const cell = ground ? this.map.worldToCell(ground) : null;
        if (!cell) return null;
        const fp = this.selectedType
            ? this.footprintOf(this.selectedType, this.rotated)
            : { cols: 1, rows: 1 };
        return {
            col: cell.col - Math.floor((fp.cols - 1) / 2),
            row: cell.row - Math.floor((fp.rows - 1) / 2),
        };
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

    private canPlace(type: UnitType, anchor: Cell): boolean {
        const cells = this.coveredCells(this.footprintOf(type, this.rotated), anchor);
        return (
            cells !== null &&
            this.economy.canAfford('player', type) &&
            cells.every((c) => this.map.isPlayerCell(c) && !this.occupied.has(cellKey(c)))
        );
    }

    private updateHover(): void {
        if (!this.enabled) {
            this.hoverMesh.visible = false;
            return;
        }
        const type = this.selectedType;
        const anchor = this.pointer && type ? this.anchorAt(this.pointer.x, this.pointer.y) : null;
        this.hoverMesh.visible = anchor !== null;
        if (!anchor || !type) return;
        const fp = this.footprintOf(type, this.rotated);
        const center = this.map.areaCenter(anchor, fp.cols, fp.rows);
        this.hoverMesh.position.set(center.x, 0.03, center.z);
        this.hoverMesh.scale.set(fp.cols * CELL * 0.98, 1, fp.rows * CELL * 0.98);
        this.hoverMaterial.color.setHex(this.canPlace(type, anchor) ? VALID_COLOR : INVALID_COLOR);
    }
}
