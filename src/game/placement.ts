import {
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    type Scene,
} from 'three';
import type { CameraRig } from '../engine/cameraRig';
import { CELL, cellKey, type BattleMap, type Cell } from './map';
import { Unit, type Team, type UnitType } from './units';

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

    private readonly units: Unit[] = [];
    private readonly occupied = new Map<string, Unit>();
    private readonly hoverMesh: Mesh;
    private readonly hoverMaterial: MeshBasicMaterial;
    private pointer: { x: number; y: number } | null = null;
    private downAt: { x: number; y: number } | null = null;

    constructor(
        private readonly rig: CameraRig,
        private readonly map: BattleMap,
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
            if (e.button !== 0 || !this.downAt) return;
            const up = this.toLocal(e);
            const moved = Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y);
            this.downAt = null;
            if (moved > 6) return; // it was a drag, not a click
            const anchor = this.anchorAt(up.x, up.y);
            if (anchor && this.selectedType && this.canPlace(this.selectedType, anchor)) {
                this.spawn(this.selectedType, anchor, 'player');
            }
        });
    }

    get unitCount(): number {
        return this.units.length;
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(type: UnitType, anchor: Cell, team: Team): Unit | null {
        const cells = this.coveredCells(type, anchor);
        if (!cells || cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        const unit = new Unit(
            type,
            anchor,
            team,
            this.map.areaCenter(anchor, type.footprint.cols, type.footprint.rows),
        );
        for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.units.push(unit);
        this.scene.add(unit.view);
        return unit;
    }

    update(timeSeconds: number): void {
        for (const unit of this.units) unit.update(timeSeconds);
        this.updateHover();
    }

    private toLocal(e: PointerEvent): { x: number; y: number } {
        const rect = this.surface.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /** anchor cell so the selected type's footprint is centered on the hovered cell */
    private anchorAt(x: number, y: number): Cell | null {
        const rect = this.surface.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        const cell = ground ? this.map.worldToCell(ground) : null;
        if (!cell) return null;
        const fp = this.selectedType?.footprint ?? { cols: 1, rows: 1 };
        return {
            col: cell.col - Math.floor((fp.cols - 1) / 2),
            row: cell.row - Math.floor((fp.rows - 1) / 2),
        };
    }

    /** all tiles under the footprint, or null when part of it is off the map */
    private coveredCells(type: UnitType, anchor: Cell): Cell[] | null {
        const cells: Cell[] = [];
        for (let c = 0; c < type.footprint.cols; c++) {
            for (let r = 0; r < type.footprint.rows; r++) {
                const cell = { col: anchor.col + c, row: anchor.row + r };
                if (!this.map.inBounds(cell)) return null;
                cells.push(cell);
            }
        }
        return cells;
    }

    private canPlace(type: UnitType, anchor: Cell): boolean {
        const cells = this.coveredCells(type, anchor);
        return (
            cells !== null &&
            cells.every((c) => this.map.isPlayerCell(c) && !this.occupied.has(cellKey(c)))
        );
    }

    private updateHover(): void {
        const type = this.selectedType;
        const anchor = this.pointer && type ? this.anchorAt(this.pointer.x, this.pointer.y) : null;
        this.hoverMesh.visible = anchor !== null;
        if (!anchor || !type) return;
        const center = this.map.areaCenter(anchor, type.footprint.cols, type.footprint.rows);
        this.hoverMesh.position.set(center.x, 0.03, center.z);
        this.hoverMesh.scale.set(type.footprint.cols * CELL * 0.98, 1, type.footprint.rows * CELL * 0.98);
        this.hoverMaterial.color.setHex(this.canPlace(type, anchor) ? VALID_COLOR : INVALID_COLOR);
    }
}
