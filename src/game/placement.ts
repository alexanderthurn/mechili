import {
    CanvasTexture,
    ConeGeometry,
    CylinderGeometry,
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
import { CELL, cellKey, type BattleMap, type Cell } from './map';
import type { Economy } from './settings';
import { Unit, type GridExtent, type Team, type UnitType } from './units';

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
    /** fires on every click that lands on a unit (used for item application) */
    onSelect: ((unit: Unit) => void) | null = null;

    /**
     * per-team id counters: a side's ids depend only on its OWN spawn
     * sequence, so peers applying each other's actions in any interleaving
     * still agree (player ids even, enemy ids odd)
     */
    private readonly nextUnitId: Record<Team, number> = { player: 0, enemy: 0 };
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
     * Mechabellum-style pickup: the first click on a movable pack only
     * SELECTS it (info, range); a second click on it picks it up so it rides
     * the cursor. Clicking ground moves the selection either way.
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
        this.hoverMesh = makeMarker(VALID_COLOR, 0.72);
        this.hoverMesh.position.y = 0.04;
        this.hoverMaterial = this.hoverMesh.material as MeshBasicMaterial;
        this.selectMesh = makeMarker(SELECT_COLOR, 0.22);
        this.selectMesh.position.y = 0.03;

        // attack range ring for the selected own pack (unit radius, scaled per unit)
        this.rangeMesh = createRangeRing(scene);

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
            this.pointer = this.toLocal(e);
            if (!this.downAt || !this.enabled || this.pendingType) return;
            const moved = Math.hypot(this.pointer.x - this.downAt.x, this.pointer.y - this.downAt.y);
            if (this.rectActive || moved > 6) this.updateRect(this.downAt, this.pointer);
        }) as EventListener);
        listen('pointerdown', ((e: PointerEvent) => {
            if (e.button !== 0) return;
            this.downAt = this.toLocal(e);
            surface.setPointerCapture(e.pointerId);
        }) as EventListener);
        listen('pointercancel', (() => {
            this.downAt = null;
            this.hideRect();
        }) as EventListener);
        listen('pointerup', ((e: PointerEvent) => {
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
            if (Math.hypot(up.x - down.x, up.y - down.y) > 6) return;
            this.handleClick(up.x, up.y);
        }) as EventListener);
    }

    /** detach input listeners and DOM helpers */
    dispose(): void {
        this.enabled = false;
        this.deselect();
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.rectEl.remove();
    }

    get unitCount(): number {
        return this.units.length;
    }

    allUnits(): readonly Unit[] {
        return this.units;
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
        if (this.pendingUnit) this.scene.remove(this.pendingUnit.view);
        this.pendingType = null;
        this.pendingUnit = null;
    }

    /** carried / selected packs ride above the grid; everything else sits on world */
    private applyViewHeight(unit: Unit, x: number, z: number, lifted: boolean): void {
        unit.view.position.set(x, lifted ? SELECT_LIFT : unit.world.y, z);
    }

    private isHighlighted(unit: Unit): boolean {
        if (this.selectedGroup.includes(unit)) return true;
        return unit === this.selectedUnit && this.selectedGroup.length <= 1;
    }

    /** carried packs go back to their committed spots */
    private restoreSelectedView(): void {
        this.selectedUnit?.view.position.copy(this.selectedUnit.world);
        for (const u of this.selectedGroup) u.view.position.copy(u.world);
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
        return this.findStartSpot('player', type);
    }

    /**
     * The same ring search from either side's zone center (deterministic,
     * rng-free). Both lockstep peers hold the identical board, so this is
     * trivially identical for either team on both clients.
     */
    findStartSpot(team: Team, type: UnitType): Cell | null {
        const fp = this.footprintOf(type, false);
        const centerCol = Math.floor(this.map.cols / 2);
        const near = team === 'player' ? !this.map.ownAtFar : this.map.ownAtFar;
        const centerRow = this.map.zoneCenterRow(near);
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
                        cells.every((c) => this.deployCellOk(team, c, type) && !this.occupied.has(cellKey(c)));
                    if (ok) return anchor;
                }
            }
        }
        return null;
    }

    /** Middle click: pick up if needed, then rotate the selected movable pack. */
    rotateSelected(): void {
        if (this.selectedGroup.length > 1) return; // formations don't rotate
        const unit = this.selectedUnit;
        if (!unit || !this.enabled || !this.isMovable(unit)) return;
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
            this.deployCellOk(unit.team, c, unit.type) && (unit.type.extra || this.freeFor(c, unit));
        if (!cells || !cells.every(fits)) return false;
        this.release(unit);
        unit.setRotated(rotated);
        unit.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
        if (!unit.type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.concealAfterMove(unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
        this.refreshFlankSpawn(unit);
        return true;
    }

    /** true when any tile under the pack sits in the flank strips (mechs only) */
    isOnFlank(unit: Unit): boolean {
        if (unit.type.structure || unit.type.extra) return false;
        const cells = this.coveredCells(this.footprintOf(unit.type, unit.rotated), unit.cell);
        if (!cells) return false;
        return cells.some((c) => this.map.isFlankDeployCell(c, unit.team));
    }

    /** first flank placement marks the pack for a one-time spawn phase at battle start */
    refreshFlankSpawn(unit: Unit): void {
        if (unit.type.structure || unit.type.extra || unit.flankSpawnDone) return;
        if (this.isOnFlank(unit)) unit.flankSpawnEligible = true;
    }

    /** a tile a team may deploy on */
    private zoneCell(team: Team, cell: Cell): boolean {
        return team === 'player' ? this.map.isPlayerCell(cell) : this.map.isEnemyCell(cell);
    }

    /** zone check plus type rules — shield and rocket may not sit on flank strips */
    private deployCellOk(team: Team, cell: Cell, type: UnitType): boolean {
        if (!this.zoneCell(team, cell)) return false;
        if (type.extra && this.map.isFlankDeployCell(cell, team)) return false;
        return true;
    }

    /**
     * Build-phase intel rule: the opponent may see WHICH units you start
     * with (their spawn spots), but not where you move them — repositioning
     * a revealed unit conceals it until the battle reveals everything.
     */
    private concealAfterMove(unit: Unit): void {
        if (!this.hiddenPlacements || !unit.revealed) return;
        unit.revealed = false;
        unit.view.visible = unit.team === 'player'; // own units stay visible to yourself
    }

    /**
     * Zone-validated placement for a buy action: the anchor must lie fully
     * in the buyer's territory and be free; spawning charges the cost.
     * Board extras take no space, so only the zone matters for them.
     */
    placeUnit(team: Team, type: UnitType, anchor: Cell, rotated: boolean): Unit | null {
        const cells = this.coveredCells(this.footprintOf(type, rotated), anchor);
        const valid =
            cells !== null &&
            cells.every(
                (c) => this.deployCellOk(team, c, type) && (type.extra || !this.occupied.has(cellKey(c))),
            );
        return valid ? this.spawn(type, anchor, team, rotated) : null;
    }

    /** Places a unit with its footprint anchored at `anchor` (no zone validation — callers validate). */
    spawn(type: UnitType, anchor: Cell, team: Team, rotated = false, free = false): Unit | null {
        const fp = this.footprintOf(type, rotated);
        const cells = this.coveredCells(fp, anchor);
        if (!cells) return null;
        if (!type.extra && cells.some((c) => this.occupied.has(cellKey(c)))) return null;
        if (!free && !this.economy.charge(team, type)) return null;
        const unit = new Unit(type, anchor, team, this.map.areaCenter(anchor, fp.cols, fp.rows), rotated);
        unit.id = ++this.nextUnitId[team] * 2 + (team === 'player' ? 0 : 1);
        unit.deployedRound = this.currentRound;
        if (this.hiddenPlacements) {
            unit.revealed = false;
            // your own hidden units are still visible to you; the enemy's are not
            unit.view.visible = team === 'player';
        }
        // board extras take no space on the grid
        if (!type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.units.push(unit);
        this.scene.add(unit.view);
        // core rule: every mech faces the closest individual enemy mech it
        // could be aware of — from revealed enemy units, or the enemy's
        // command towers when nothing else is visible
        unit.faceClosestOf(this.opponentMechPositions(team, unit));
        this.refreshFlankSpawn(unit);
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
            if (!cells.every((c) => this.deployCellOk('enemy', c, type) && !this.occupied.has(cellKey(c)))) continue;
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

    /** Puts a removed pack back on its committed spot (sell-action undo). */
    restoreUnit(unit: Unit): void {
        this.units.push(unit);
        const fp = this.footprintOf(unit.type, unit.rotated);
        for (const c of this.coveredCells(fp, unit.cell)!) this.occupied.set(cellKey(c), unit);
        this.scene.add(unit.view);
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

    /** Flyers sit near the ground; packs may be repositioned. */
    beginDeployment(): void {
        for (const u of this.units) {
            u.setDeployment(true);
            if (u.type.flying) {
                for (const m of u.members) m.mesh.position.y = u.memberBaseY();
            }
        }
    }

    /** Flyers climb to combat altitude. */
    beginBattle(): void {
        for (const u of this.units) u.setDeployment(false);
    }

    update(timeSeconds: number, dtSeconds: number): void {
        for (const unit of this.units) {
            unit.tickFlight(dtSeconds);
            unit.update(timeSeconds);
        }
        this.updateMovablePlates(timeSeconds);
        this.updateItemBadges();
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
        mesh.position.set(center.x, y, center.z);
        mesh.scale.set(fp.cols * CELL * edge, 1, fp.rows * CELL * edge);
        material.color.setHex(color);
        material.opacity = animated ? 0.58 + 0.22 * pulse : MOVABLE_PLATE_OPACITY;
        mesh.visible = true;
    }

    /** small floating icon over every pack that carries an item */
    private updateItemBadges(): void {
        let used = 0;
        if (this.enabled) {
            for (const unit of this.units) {
                if (unit.items.length === 0) continue;
                if (unit.team !== 'player' && !unit.revealed) continue;
                const icon = ITEMS[unit.items[0]!]?.icon ?? '?';
                let sprite = this.itemBadges[used];
                if (!sprite) {
                    sprite = new Sprite();
                    sprite.scale.set(2.6, 2.6, 1);
                    this.scene.add(sprite);
                    this.itemBadges.push(sprite);
                }
                sprite.material = this.itemBadgeMaterial(icon);
                sprite.position.set(
                    unit.world.x,
                    unit.type.meshScale * 2.6 + 2.2 + (unit.type.flying ?? 0),
                    unit.world.z,
                );
                sprite.visible = true;
                used++;
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
     * A small solid gold up-arrow bobbing over the center of every pack —
     * own OR revealed enemy — whose next level is banked and buyable.
     */
    private updateLevelArrows(timeSeconds: number): void {
        let used = 0;
        if (this.enabled && this.levelReady) {
            for (const unit of this.units) {
                if (!this.levelReady(unit)) continue;
                if (unit.team !== 'player' && !unit.revealed) continue;
                let arrow = this.levelArrows[used];
                if (!arrow) {
                    arrow = new Group();
                    arrow.scale.setScalar(3);
                    const shaft = new Mesh(new CylinderGeometry(0.16, 0.16, 0.6, 8), this.levelArrowMaterial);
                    shaft.position.y = 0;
                    const head = new Mesh(new ConeGeometry(0.42, 0.7, 10), this.levelArrowMaterial);
                    head.position.y = 0.65;
                    arrow.add(shaft, head);
                    this.scene.add(arrow);
                    this.levelArrows.push(arrow);
                }
                const bob = Math.sin(timeSeconds * 3 + unit.id) * 0.2;
                const top =
                    unit.view.position.y +
                    unit.memberBaseY() +
                    unit.type.meshScale * 2.4 +
                    0.9;
                arrow.position.set(unit.view.position.x, top + bob, unit.view.position.z);
                arrow.visible = true;
                used++;
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

    private handleClick(x: number, y: number): void {
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
        const clicked = this.occupied.get(cellKey(cell)) ?? (carrying ? undefined : this.extraAt(cell));
        // selecting: any own pack, or a revealed enemy pack (hidden stays hidden)
        if (clicked && !clicked.destroyed && (clicked.team === 'player' || clicked.revealed)) {
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
        // empty ground, selection stays either way:
        //  - merely selected: move there AND pick it up (rides the cursor from here)
        //  - carrying: drop it there
        if (this.selectedUnit && this.isMovable(this.selectedUnit)) {
            const anchor = this.centeredAnchor(this.selectedUnit.type, this.selectedUnit.rotated, cell);
            const done = this.dispatch?.({
                kind: 'move',
                team: 'player',
                unitId: this.selectedUnit.id,
                anchor,
            });
            if (done) this.carryingSelected = false; // placed — stay selected, back on the ground
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
                if (!this.deployCellOk(unit.team, c, unit.type)) return false;
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
            this.concealAfterMove(u);
            if (u.type.extra) return;
            for (const c of this.coveredCells(fp, anchor)!) this.occupied.set(cellKey(c), u);
        });
        for (const u of units) {
            u.faceClosestOf(this.opponentMechPositions(u.team, u));
            this.refreshFlankSpawn(u);
        }
        return true;
    }

    /** Repositions one pack when the target fits its team's zones (dispatcher-only). */
    moveUnit(unit: Unit, anchor: Cell): boolean {
        const fp = this.footprintOf(unit.type, unit.rotated);
        const cells = this.coveredCells(fp, anchor);
        const fits = (c: Cell) =>
            this.deployCellOk(unit.team, c, unit.type) && (unit.type.extra || this.freeFor(c, unit));
        if (!cells || !cells.every(fits)) return false;
        this.release(unit);
        unit.moveTo(anchor, this.map.areaCenter(anchor, fp.cols, fp.rows));
        if (!unit.type.extra) for (const c of cells) this.occupied.set(cellKey(c), unit);
        this.concealAfterMove(unit);
        unit.faceClosestOf(this.opponentMechPositions(unit.team, unit));
        this.refreshFlankSpawn(unit);
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

    private updateMarkers(timeSeconds: number): void {
        const sel = this.selectedUnit;
        this.hoverMesh.visible = false;
        this.selectMesh.visible = false;
        this.rangeMesh.visible = false;

        // an extra riding the cursor: ghost mesh + footprint plate + effect ring
        if (this.pendingType && this.pendingUnit && this.enabled) {
            this.showGroupPlates([], null, false, timeSeconds);
            const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
            if (!cell) {
                this.pendingUnit.view.position.set(0, -9999, 0);
                return;
            }
            const type = this.pendingType;
            const fp = this.footprintOf(type, false);
            const anchor = this.centeredAnchor(type, false, cell);
            const cells = this.coveredCells(fp, anchor);
            const valid = cells !== null && cells.every((c) => this.deployCellOk('player', c, type));
            const center = this.map.areaCenter(anchor, fp.cols, fp.rows);
            this.pendingUnit.view.position.set(center.x, 0, center.z);
            this.hoverMesh.position.set(center.x, 0.04, center.z);
            this.hoverMesh.scale.set(fp.cols * CELL * 0.98, 1, fp.rows * CELL * 0.98);
            this.hoverMaterial.color.setHex(valid ? VALID_COLOR : INVALID_COLOR);
            this.hoverMesh.visible = true;
            // show what it will cover: dome radius, or the rocket's trigger range
            const radius = type.shield?.radius ?? type.rocket?.range;
            if (radius) {
                this.rangeMesh.position.set(center.x, 0.05, center.z);
                this.rangeMesh.scale.set(radius, 1, radius);
                this.rangeMesh.visible = true;
            }
            return;
        }

        // while rubber-banding: highlight what the rect would select
        if (this.rectActive) {
            this.showGroupPlates(this.rectPreview, null, false, timeSeconds);
            return;
        }
        // a formation is carried as one rigid shape, each pack showing its own validity
        if (this.selectedGroup.length > 1 && this.enabled) {
            const cell = this.pointer ? this.cellAt(this.pointer.x, this.pointer.y) : null;
            const center = this.groupCenterCell();
            const delta = cell ? { dc: cell.col - center.col, dr: cell.row - center.row } : null;
            this.showGroupPlates(this.selectedGroup, delta, true, timeSeconds);
            return;
        }
        this.showGroupPlates([], null, false, timeSeconds);
        if (!sel || !this.enabled) return;

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
                    cells.every((c) => this.deployCellOk('player', c, sel.type) && this.freeFor(c, sel));
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
            const edge = 0.96 + 0.04 * this.pulse(timeSeconds);
            this.hoverMesh.scale.set(fp.cols * CELL * edge, 1, fp.rows * CELL * edge);
            markerCenter = center;
        } else {
            sel.view.position.copy(sel.world);
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
                    this.plateGeometry,
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
            else unit.view.position.set(center.x, unit.world.y, center.z);
            plate.position.set(center.x, 0.035, center.z);
            const mat = plate.material as MeshBasicMaterial;
            const pulse = this.pulse(timeSeconds);
            const edge = 0.96 + 0.04 * pulse;
            plate.scale.set(fp.cols * CELL * edge, 1, fp.rows * CELL * edge);
            if (!delta) {
                mat.color.setHex(VALID_COLOR);
                mat.opacity = 0.58 + 0.22 * pulse;
                plate.visible = true;
            } else {
                mat.color.setHex(
                    this.groupSpotValid(unit, anchor, units) ? VALID_COLOR : INVALID_COLOR,
                );
                mat.opacity = 0.58 + 0.22 * pulse;
                plate.visible = true;
            }
        }
        for (let i = units.length; i < this.groupPlates.length; i++) this.groupPlates[i]!.visible = false;
    }
}
