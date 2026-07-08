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
 * Hover highlight + click-to-place. Placement is only valid on free cells
 * inside the player deployment zone. Input listens on the top-most surface
 * (the UI overlay canvas) so HUD buttons can swallow their own clicks.
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
        const geo = new PlaneGeometry(CELL * 0.96, CELL * 0.96);
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
            const cell = this.cellAt(up.x, up.y);
            if (cell && this.canPlace(cell)) {
                this.spawn(this.selectedType!, cell, 'player');
            }
        });
    }

    get unitCount(): number {
        return this.units.length;
    }

    spawn(type: UnitType, cell: Cell, team: Team): Unit | null {
        if (this.occupied.has(cellKey(cell))) return null;
        const unit = new Unit(type, cell, team, this.map.cellCenter(cell.col, cell.row));
        this.occupied.set(cellKey(cell), unit);
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

    private cellAt(x: number, y: number): Cell | null {
        const rect = this.surface.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        return ground ? this.map.worldToCell(ground) : null;
    }

    private canPlace(cell: Cell): boolean {
        return (
            this.selectedType !== null &&
            this.map.isPlayerCell(cell) &&
            !this.occupied.has(cellKey(cell))
        );
    }

    private updateHover(): void {
        const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
        this.hoverMesh.visible = cell !== null;
        if (!cell) return;
        const center = this.map.cellCenter(cell.col, cell.row);
        this.hoverMesh.position.set(center.x, 0.03, center.z);
        this.hoverMaterial.color.setHex(this.canPlace(cell) ? VALID_COLOR : INVALID_COLOR);
    }
}
