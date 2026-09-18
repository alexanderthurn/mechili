/**
 * Scenario editor, author mode (plan §8): a sandbox deployment. The normal
 * game UI builds the board — shop, placing, moving, talents, runes, tower
 * upgrades, all free — and this window adds what a player can't do: place any
 * type for any team (horde included, out in the forest ring too), move or
 * erase anything, set levels, switch to the enemy side, copy an army across,
 * board size and base buildings, undo, test, save.
 *
 * The draft is the state. Normal-UI actions are read back from the board into
 * the draft; the window's own edits change the draft and the Game rebuilds its
 * board from it. The draft is kept canonical (player = the real player); while
 * the enemy side is edited the board shows it turned around ({@link swapSides}),
 * so the match always runs as the player. Test battles and board-size changes
 * restart the match — the history, tool and side survive that (module carry).
 */
import type { TypeRegistry } from '../game/content/typeRegistry';
import { colorForBattleTeam } from '../game/colors';
import { t } from '../i18n';
import type { PlacementController } from '../game/placement';
import type { AppliedScene } from '../game/scenario/applyScenario';
import type { CapturedScene } from '../game/scenario/capture';
import {
    armyValue,
    DraftHistory,
    hasBaseBuildings,
    MAP_PRESETS,
    mapPresetOf,
    mirrorSide,
    newDraft,
    onBoard,
    swapSides,
    tidyDraft,
    withBaseBuildings,
    withMap,
    withoutTeam,
    type MapPresetId,
} from '../game/scenario/editorDraft';
import type { ScenarioIssue } from '../game/scenario/normalize';
import type { ScenarioDef, SceneTeam, SceneUnit } from '../game/scenario/scenarioDef';
import type { Unit, UnitType } from '../game/units';
import type { MountainEditor, TerrainHistory } from '../game/mountainEditor';
import { draftTerrain, setDraftTerrain } from '../game/scenario/scenarioTerrain';
import { rulesHtml, wireRules } from './scenarioRulesPanel';

export interface ScenarioEditorHost {
    readonly types: TypeRegistry;
    readonly placement: PlacementController;
    /** the pointer surface the board listens on */
    readonly surface: HTMLElement;
    /** the match UI root the window mounts into */
    readonly wrapper: HTMLElement;
    readonly maxUnitLevel: number;
    readonly maxBuildingLevel: number;
    readonly prices: { levelCostFactor: number; techCostEscalation: number };
    /** 'Base game' or the level package's id */
    readonly levelLabel: string;
    readonly gameVersion: string;
    /** whether a zip download is offered (web builds) */
    canDownload(): boolean;
    /** a type's thumbnail (data URL), if rendered */
    unitIcon(typeId: string): string | null;
    /** put a board on the running match */
    rebuild(def: ScenarioDef): AppliedScene;
    /** read the running match's board back */
    capture(baseBuildings: ReadonlySet<Unit>): CapturedScene;
    issues(def: ScenarioDef): ScenarioIssue[];
    autosave(def: ScenarioDef): void;
    /** a new match from the draft (board size changed) */
    restart(def: ScenarioDef): void;
    test(def: ScenarioDef): void;
    /** play the draft as the scenario it is (the player builds, the rules apply); back to the editor after */
    play(def: ScenarioDef): void;
    /** keep the draft as a scenario package; resolves to a status line */
    save(def: ScenarioDef): Promise<string>;
    /** the package this board is made on holds scenarios — saving into it is offered */
    readonly packageName: string | null;
    /**
     * Put the draft into that package (replacing the scenario of its id, or
     * adding it at the end of the order). `id` is the scenario's id in the
     * package; `reopen` restarts the editor on the updated package.
     */
    saveInto(def: ScenarioDef, packageName?: string): Promise<{ status: string; id: string; reopen: ((def: ScenarioDef) => void) | null }>;
    download(def: ScenarioDef): Promise<string>;
    /** copy the draft as a share code; resolves to a status line */
    shareCode(def: ScenarioDef): Promise<string>;
    exit(): void;
    /** the Terrain tool (sculpt, paint, plants) — its panel goes into this window */
    readonly terrain: MountainEditor | null;
}

/** 'play': the normal game UI; the others are the editor's own board tools */
type Tool = 'play' | 'move' | 'place' | 'erase' | 'terrain';
/** which history an undo step belongs to: the draft (army, rules) or the terrain */
type Step = 'draft' | 'terrain';
type Side = 'player' | 'enemy';

type Selection =
    | { kind: 'unit'; index: number }
    | { kind: 'building'; team: Side; typeId: string };

interface Carried {
    history: DraftHistory;
    tool: Tool;
    team: SceneTeam;
    placeTypeId: string | null;
    side: Side;
    collapsed: boolean;
    rulesOpen: boolean;
    /** the order of edits across both histories, so Ctrl+Z always takes back the last one */
    steps: Step[];
    redoSteps: Step[];
    terrainHistory: TerrainHistory | null;
}

/** the editor's state across the restarts it causes (test battle, board size) */
let carried: Carried | null = null;

const DRAG_SLOP_PX = 6;
const WINDOW_POS_KEY = 'melodan-editor-window';

function storedWindowPos(): { x: number; y: number } | null {
    try {
        const raw = JSON.parse(localStorage.getItem(WINDOW_POS_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null;
        return raw && typeof raw.x === 'number' && typeof raw.y === 'number' ? { x: raw.x, y: raw.y } : null;
    } catch {
        return null;
    }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ScenarioEditor {
    private readonly history: DraftHistory;
    /** the board as built — `units[i]` is `view.scene.units[i]` */
    private applied: AppliedScene = { units: [], buildings: [] };
    private tool: Tool = 'play';
    private team: SceneTeam = 'enemy';
    private placeTypeId: string | null = null;
    /** which side the normal game UI builds */
    private side: Side = 'player';
    private collapsed = false;
    private rulesOpen = false;
    private steps: Step[] = [];
    private redoSteps: Step[] = [];
    /** the package name as typed (applied on Save into package) */
    private packageNameDraft: string | null = null;
    private press: { x: number; y: number; unit: Unit | null; index: number | null; dragging: boolean } | null = null;
    private readonly root: HTMLDivElement;
    private readonly selectionEl: HTMLDivElement;
    private readonly bodyEl: HTMLDivElement;
    private readonly disposers: (() => void)[] = [];
    private statusTimer: ReturnType<typeof setTimeout> | null = null;
    private shownSelection: Unit | null = null;
    /** a button in the window is being pressed: redraws wait, or the press would lose its button */
    private pressingWindow = false;
    private renderPending = false;

    constructor(
        private readonly host: ScenarioEditorHost,
        /** canonical draft */
        draft: ScenarioDef,
    ) {
        const tidy = tidyDraft(draft);
        // the same draft coming back from a test battle keeps its history, tool and side
        if (carried && JSON.stringify(tidyDraft(carried.history.draft)) === JSON.stringify(tidy)) {
            this.history = carried.history;
            this.tool = carried.tool;
            this.team = carried.team;
            this.placeTypeId = carried.placeTypeId;
            this.side = carried.side;
            this.collapsed = carried.collapsed;
            this.rulesOpen = carried.rulesOpen;
            this.steps = carried.steps;
            this.redoSteps = carried.redoSteps;
            if (carried.terrainHistory) host.terrain?.importHistory(carried.terrainHistory);
            if (!host.terrain?.canUndo) this.steps = this.steps.filter((s) => s !== 'terrain');
            if (this.tool === 'terrain' && !host.terrain) this.tool = 'play';
        } else {
            this.history = new DraftHistory(tidy);
        }
        carried = null;

        this.root = document.createElement('div');
        this.root.className = 'mechili-scenario-editor';
        this.root.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            this.pressingWindow = true;
        });
        this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'se-body';
        this.selectionEl = document.createElement('div');
        this.selectionEl.className = 'se-section se-selection';
        host.wrapper.appendChild(this.root);
        const pos = storedWindowPos();
        if (pos) this.moveWindowTo(pos.x, pos.y);

        this.listen(host.surface, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
        this.listen(host.surface, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
        // window: a drag released over the editor window or the HUD still lands
        this.listen(window, 'pointerup', (e) => {
            this.onPointerUp(e as PointerEvent);
            if (!this.pressingWindow) return;
            this.pressingWindow = false;
            // after the click that follows
            if (this.renderPending) setTimeout(() => this.renderSoon(), 0);
        });
        this.listen(host.surface, 'pointercancel', () => this.cancelPress());
        this.listen(host.surface, 'pointerleave', () => {
            if (!this.press) host.placement.editorPlate = null;
        });
        // capture: ahead of the game's own shortcuts (R would rotate twice)
        this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent), true);
        // the normal UI selects through the placement controller — follow it
        const poll = setInterval(() => {
            if (host.placement.selectedUnit !== this.shownSelection) this.renderSelection();
        }, 200);
        this.disposers.push(() => clearInterval(poll));

        this.applyTool();
        this.apply();
        // the host finishes wiring (download) right after it constructs us
        queueMicrotask(() => this.render());
    }

    /** place the window, kept on screen */
    private moveWindowTo(x: number, y: number): void {
        const bounds = this.host.wrapper.getBoundingClientRect();
        const w = this.root.offsetWidth || 270;
        const clampedX = Math.max(0, Math.min(x, bounds.width - Math.min(w, 120)));
        const clampedY = Math.max(0, Math.min(y, bounds.height - 40));
        this.root.style.left = `${clampedX}px`;
        this.root.style.top = `${clampedY}px`;
    }

    /** the head drags the window; where it ends up is remembered */
    private wireWindowDrag(head: HTMLElement): void {
        head.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
            const start = { x: e.clientX, y: e.clientY, left: this.root.offsetLeft, top: this.root.offsetTop };
            head.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => this.moveWindowTo(start.left + ev.clientX - start.x, start.top + ev.clientY - start.y);
            const up = () => {
                head.removeEventListener('pointermove', move);
                head.removeEventListener('pointerup', up);
                head.removeEventListener('pointercancel', up);
                try {
                    localStorage.setItem(WINDOW_POS_KEY, JSON.stringify({ x: this.root.offsetLeft, y: this.root.offsetTop }));
                } catch {
                    /* not kept */
                }
            };
            head.addEventListener('pointermove', move);
            head.addEventListener('pointerup', up);
            head.addEventListener('pointercancel', up);
        });
    }

    destroy(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.root.remove();
        this.host.placement.externalInput = false;
        this.host.placement.editorPlate = null;
    }

    get canUndo(): boolean {
        return this.history.canUndo || !!this.host.terrain?.canUndo;
    }

    /** the scenario's name as edited now */
    get draftName(): string {
        return this.draft.name;
    }

    /** a draft edit, recorded in the history (false = nothing changed) */
    private push(next: ScenarioDef): boolean {
        if (!this.history.push(next)) return false;
        this.steps.push('draft');
        this.redoSteps = [];
        return true;
    }

    /**
     * The Terrain tool changed the ground: the host has made it the draft's
     * terrain — keep it. A new edit is one undo step.
     */
    terrainEdited(kind: 'edit' | 'history'): void {
        if (kind === 'edit') {
            this.steps.push('terrain');
            this.redoSteps = [];
        }
        this.host.autosave(this.draft);
        this.renderSoon();
    }

    /** the terrain went back to the generated one: a new board shows it, the terrain history is gone */
    restartForTerrain(): void {
        this.dropTerrainSteps();
        this.restartWith(this.draft);
    }

    private dropTerrainSteps(): void {
        this.steps = this.steps.filter((s) => s !== 'terrain');
        this.redoSteps = this.redoSteps.filter((s) => s !== 'terrain');
    }

    /** canonical draft */
    private get draft(): ScenarioDef {
        return this.history.draft;
    }

    private viewCache: { draft: ScenarioDef; side: Side; view: ScenarioDef } | null = null;

    /** the draft as the board shows it (turned around while editing the enemy) — treat as read-only */
    private get view(): ScenarioDef {
        const draft = this.draft;
        if (this.viewCache?.draft !== draft || this.viewCache.side !== this.side) {
            this.viewCache = { draft, side: this.side, view: this.side === 'enemy' ? swapSides(this.host.types, draft) : draft };
        }
        return this.viewCache.view;
    }

    private toCanonical(view: ScenarioDef): ScenarioDef {
        return this.side === 'enemy' ? swapSides(this.host.types, view) : tidyDraft(view);
    }

    private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
        target.addEventListener(type, handler, capture);
        this.disposers.push(() => target.removeEventListener(type, handler, capture));
    }

    private carry(): void {
        carried = {
            history: this.history,
            tool: this.tool,
            team: this.team,
            placeTypeId: this.placeTypeId,
            side: this.side,
            collapsed: this.collapsed,
            rulesOpen: this.rulesOpen,
            steps: this.steps,
            redoSteps: this.redoSteps,
            terrainHistory: this.host.terrain?.exportHistory() ?? null,
        };
    }

    // ---- draft ⇄ board

    /** record an edit made on the view; the board follows */
    private commitView(nextView: ScenarioDef): void {
        const next = this.toCanonical(nextView);
        if (JSON.stringify(next.map) !== JSON.stringify(this.draft.map)) {
            this.push(next);
            this.changeBoardSize(next);
            return;
        }
        if (this.push(next)) this.apply();
    }

    /** another board size: a sculpted terrain is made for the old one and goes */
    private changeBoardSize(def: ScenarioDef): void {
        if (draftTerrain()) setDraftTerrain(null);
        this.dropTerrainSteps();
        this.restartWith(def);
    }

    private restartWith(def: ScenarioDef): void {
        this.carry();
        this.host.autosave(def);
        this.host.restart(def);
    }

    /** rebuild the board from the draft, autosave, redraw */
    private apply(reselect: Selection | null = this.selectionOf(this.host.placement.selectedUnit)): void {
        this.host.placement.deselect();
        this.applied = this.host.rebuild(this.view);
        this.host.autosave(this.draft);
        const unit = reselect ? this.unitOf(reselect) : null;
        if (unit) this.host.placement.selectUnit(unit);
        this.render();
    }

    /**
     * The normal game UI changed the board (bought, moved, upgraded, taught a
     * talent, socketed a rune): read it back into the draft.
     */
    syncFromBoard(): void {
        const captured = this.host.capture(new Set(this.applied.buildings));
        this.applied = { units: captured.units, buildings: captured.buildings };
        const nextView = structuredClone(this.view);
        nextView.scene = captured.scene;
        if (this.push(this.toCanonical(nextView))) {
            this.host.autosave(this.draft);
            this.render();
        }
    }

    /** take back the last edit — of the draft or of the terrain, whichever came last */
    undo(): void {
        const step = this.steps.pop() ?? (this.history.canUndo ? 'draft' : null);
        if (!step) return;
        this.redoSteps.push(step);
        if (step === 'terrain') {
            if (!this.host.terrain?.undo()) this.dropTerrainSteps();
            this.render();
        } else this.stepHistory(() => this.history.undo());
    }

    private redo(): void {
        const step = this.redoSteps.pop();
        if (!step) return;
        this.steps.push(step);
        if (step === 'terrain') {
            if (!this.host.terrain?.redo()) this.dropTerrainSteps();
            this.render();
        } else this.stepHistory(() => this.history.redo());
    }

    private stepHistory(step: () => ScenarioDef | null): void {
        const before = this.draft.map;
        const def = step();
        if (!def) return;
        if (JSON.stringify(def.map) !== JSON.stringify(before)) this.changeBoardSize(def);
        else this.apply(null);
    }

    startTest(): void {
        this.carry();
        this.host.autosave(this.draft);
        this.host.test(this.draft);
    }

    private switchSide(): void {
        this.side = this.side === 'player' ? 'enemy' : 'player';
        if (this.team !== 'horde') this.team = this.side === 'player' ? 'enemy' : 'player';
        this.apply(null);
        this.flash(
            this.side === 'enemy'
                ? t('editor:nowEnemy', { defaultValue: 'You are building the enemy side now' })
                : t('editor:nowPlayer', { defaultValue: 'You are building the player side now' }),
        );
    }

    // ---- selection

    private selectionOf(unit: Unit | null): Selection | null {
        if (!unit) return null;
        let target = unit;
        if (target.hostUnitId !== null) {
            const hostId = target.hostUnitId;
            target = this.host.placement.allUnits().find((u) => u.id === hostId) ?? target;
        }
        const index = this.applied.units.indexOf(target);
        if (index >= 0) return { kind: 'unit', index };
        if (this.applied.buildings.includes(target) && target.team !== 'horde') {
            return { kind: 'building', team: target.team, typeId: target.type.id };
        }
        return null;
    }

    private unitOf(sel: Selection): Unit | null {
        if (sel.kind === 'unit') return this.applied.units[sel.index] ?? null;
        return this.applied.buildings.find((b) => b.team === sel.team && b.type.id === sel.typeId) ?? null;
    }

    // ---- board input (the editor's own tools; 'play' leaves the board to the game)

    private applyTool(): void {
        this.host.placement.externalInput = this.tool !== 'play';
        this.host.placement.editorPlate = null;
        this.host.terrain?.setEditing(this.tool === 'terrain');
    }

    private local(e: PointerEvent): { x: number; y: number } {
        return this.host.placement.clientToLocal(e.clientX, e.clientY);
    }

    private hit(x: number, y: number): { unit: Unit; selection: Selection } | null {
        const unit = this.host.placement.unitAtPoint(x, y) ?? null;
        const selection = this.selectionOf(unit);
        const target = selection ? this.unitOf(selection) : null;
        return selection && target ? { unit: target, selection } : null;
    }

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0 || this.tool === 'play' || this.tool === 'terrain') return;
        const { x, y } = this.local(e);
        const hit = this.tool === 'move' ? this.hit(x, y) : null;
        this.press = { x, y, unit: hit?.unit ?? null, index: hit?.selection.kind === 'unit' ? hit.selection.index : null, dragging: false };
        if (this.tool === 'move') {
            if (hit) this.host.placement.selectUnit(hit.unit);
            else this.host.placement.deselect();
            this.renderSelection();
        }
    }

    private onPointerMove(e: PointerEvent): void {
        if (this.tool === 'play') return;
        const press = this.press;
        const { x, y } = this.local(e);
        if (this.tool === 'place' && !press) {
            this.showPlacePlate(x, y);
            return;
        }
        if (!press || press.index === null || !press.unit) return;
        if (!press.dragging && Math.hypot(x - press.x, y - press.y) < DRAG_SLOP_PX) return;
        if (!press.dragging) {
            press.dragging = true;
            // the placement marker would pin the pack to its old spot
            this.host.placement.deselect();
        }
        const entry = this.view.scene.units[press.index];
        if (!entry) return;
        const spot = this.anchorAt(press.unit.type, entry.at.rotated ?? false, x, y, entry.team === 'horde');
        if (!spot) return;
        press.unit.view.position.set(spot.center.x, 0, spot.center.z);
        press.unit.seatMembers(spot.center.x, spot.center.z);
        const moved: SceneUnit = { ...entry, at: { ...entry.at, col: spot.at.col, row: spot.at.row } };
        this.host.placement.editorPlate = {
            type: press.unit.type,
            anchor: spot.at,
            rotated: entry.at.rotated ?? false,
            valid: this.fits(press.unit.type, moved, press.unit),
        };
    }

    /** the place tool's footprint under the cursor */
    private showPlacePlate(x: number, y: number): void {
        const type = this.placeTypeId ? this.host.types.byId(this.placeTypeId) : null;
        const spot = type ? this.anchorAt(type, false, x, y, this.team === 'horde') : null;
        if (!type || !spot) {
            this.host.placement.editorPlate = null;
            return;
        }
        const entry: SceneUnit = { typeId: type.id, team: this.team, at: spot.at, level: 1 };
        this.host.placement.editorPlate = { type, anchor: spot.at, rotated: false, valid: this.fits(type, entry, null) };
    }

    private onPointerUp(e: PointerEvent): void {
        if (e.button !== 0 || this.tool === 'play') return;
        const press = this.press;
        this.press = null;
        if (!press) return;
        if (press.dragging) this.host.placement.editorPlate = null;
        const { x, y } = this.local(e);
        if (press.dragging && press.index !== null && press.unit) {
            this.dropMoved(press.index, press.unit, x, y, e.altKey);
            return;
        }
        if (Math.hypot(x - press.x, y - press.y) > DRAG_SLOP_PX) return;
        if (this.tool === 'place') this.placeAt(x, y);
        else if (this.tool === 'erase') {
            const hit = this.hit(x, y);
            if (hit) this.erase(hit.selection);
        }
    }

    private cancelPress(): void {
        const press = this.press;
        this.press = null;
        this.host.placement.editorPlate = null;
        if (press?.dragging) this.apply();
    }

    /** grid anchor + world center for a footprint centered under the pointer */
    private anchorAt(
        type: UnitType,
        rotated: boolean,
        x: number,
        y: number,
        /** horde packs may stand past the board edge */
        offBoard = false,
    ): { at: { col: number; row: number }; center: { x: number; z: number } } | null {
        const placement = this.host.placement;
        const cell = offBoard ? placement.gridCellAtPoint(x, y) : placement.cellAtPoint(x, y);
        if (!cell) return null;
        const at = placement.anchorCenteredOn(type, rotated, cell);
        const fp = rotated ? { cols: type.footprint.rows, rows: type.footprint.cols } : type.footprint;
        const center = placement.map.areaCenter(at, fp.cols, fp.rows);
        return { at, center: { x: center.x, z: center.z } };
    }

    /** can the entry stand where it says? (`moving` may already stand there) */
    private fits(type: UnitType, entry: SceneUnit, moving: Unit | null): boolean {
        if (!onBoard(this.host.types, this.draft.map, entry)) return false;
        // horde packs stand by world position and take no tiles
        if (entry.team === 'horde') return true;
        return this.host.placement.footprintFree(type, entry.at, entry.at.rotated ?? false, moving);
    }

    /** drop a dragged pack; with `copy` (Alt) a copy lands there and the original stays */
    private dropMoved(index: number, unit: Unit, x: number, y: number, copy = false): void {
        const entry = this.view.scene.units[index];
        const spot = entry ? this.anchorAt(unit.type, entry.at.rotated ?? false, x, y, entry.team === 'horde') : null;
        if (!entry || !spot) {
            this.apply();
            return;
        }
        const moved: SceneUnit = structuredClone({ ...entry, at: { ...entry.at, col: spot.at.col, row: spot.at.row } });
        if (!this.fits(unit.type, moved, copy ? null : unit)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            this.apply();
            return;
        }
        const next = structuredClone(this.view);
        if (copy) next.scene.units.push(moved);
        else next.scene.units[index] = moved;
        if (!this.push(this.toCanonical(next))) {
            this.apply();
            return;
        }
        // entries are kept in team order — find the dropped one again to keep it selected
        const landed = this.view.scene.units.findIndex(
            (u) => u.typeId === moved.typeId && u.team === moved.team && u.at.col === moved.at.col && u.at.row === moved.at.row,
        );
        this.apply(landed >= 0 ? { kind: 'unit', index: landed } : null);
    }

    private placeAt(x: number, y: number): void {
        const type = this.placeTypeId ? this.host.types.byId(this.placeTypeId) : null;
        if (!type) {
            this.flash(t('editor:pickType', { defaultValue: 'Pick a unit or building first' }));
            return;
        }
        const spot = this.anchorAt(type, false, x, y, this.team === 'horde');
        if (!spot) return;
        const entry: SceneUnit = { typeId: type.id, team: this.team, at: spot.at, level: 1 };
        if (!this.fits(type, entry, null)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            return;
        }
        const next = structuredClone(this.view);
        next.scene.units.push(entry);
        this.commitView(next);
        this.showPlacePlate(x, y);
    }

    private erase(selection: Selection): void {
        const next = structuredClone(this.view);
        if (selection.kind === 'unit') next.scene.units.splice(selection.index, 1);
        else next.scene.buildings[selection.team][selection.typeId] = false;
        this.host.placement.deselect();
        this.commitView(next);
    }

    private changeLevel(delta: number): void {
        const sel = this.selectionOf(this.host.placement.selectedUnit);
        if (!sel) return;
        const next = structuredClone(this.view);
        if (sel.kind === 'unit') {
            const entry = next.scene.units[sel.index];
            if (!entry) return;
            const type = this.host.types.byId(entry.typeId);
            const max = type?.structure ? this.host.maxBuildingLevel : this.host.maxUnitLevel;
            entry.level = Math.max(1, Math.min(max, entry.level + delta));
        } else {
            const state = next.scene.buildings[sel.team][sel.typeId];
            const level = state === undefined || state === false ? 1 : state.level;
            const wanted = Math.max(1, Math.min(this.host.maxBuildingLevel, level + delta));
            next.scene.buildings[sel.team][sel.typeId] = { ...(state || {}), level: wanted };
        }
        if (this.push(this.toCanonical(next))) this.apply(sel);
    }

    private rotateSelected(): void {
        const sel = this.selectionOf(this.host.placement.selectedUnit);
        if (sel?.kind !== 'unit') return;
        const entry = this.view.scene.units[sel.index];
        const type = entry ? this.host.types.byId(entry.typeId) : null;
        if (!entry || !type || type.footprint.cols === type.footprint.rows) return;
        const rotated: SceneUnit = { ...entry, at: { ...entry.at, rotated: !entry.at.rotated } };
        if (!rotated.at.rotated) delete rotated.at.rotated;
        if (!this.fits(type, rotated, this.applied.units[sel.index] ?? null)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            return;
        }
        const next = structuredClone(this.view);
        next.scene.units[sel.index] = rotated;
        if (this.push(this.toCanonical(next))) this.apply(sel);
    }

    private onKey(e: KeyboardEvent): void {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        let handled = true;
        if (mod && key === 'z' && !e.shiftKey) this.undo();
        else if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) this.redo();
        else if (mod) handled = false;
        else if (key === 'delete' || key === 'backspace') {
            const sel = this.selectionOf(this.host.placement.selectedUnit);
            if (sel) this.erase(sel);
        } else if (key === '[') this.changeLevel(-1);
        else if (key === ']') this.changeLevel(1);
        else if (key === 'r' && this.tool !== 'play' && this.tool !== 'terrain') this.rotateSelected();
        else if (key === 'tab') this.switchSide();
        else handled = false;
        if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    private setTool(tool: Tool): void {
        this.tool = tool;
        this.applyTool();
        if (tool === 'place' || tool === 'erase' || tool === 'terrain') this.host.placement.deselect();
        this.render();
    }

    private flash(text: string): void {
        const el = this.root.querySelector<HTMLElement>('.se-status');
        if (!el) return;
        el.textContent = text;
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => (el.textContent = ''), 2800);
    }

    // ---- window

    private teamName(team: SceneTeam): string {
        return team === 'player'
            ? t('editor:teamPlayer', { defaultValue: 'Player' })
            : team === 'enemy'
              ? t('editor:teamEnemy', { defaultValue: 'Enemy' })
              : t('editor:teamHorde', { defaultValue: 'Horde' });
    }

    /** teams as the board shows them, named as the scenario means them */
    private canonicalTeam(viewTeam: SceneTeam): SceneTeam {
        if (this.side === 'player' || viewTeam === 'horde') return viewTeam;
        return viewTeam === 'player' ? 'enemy' : 'player';
    }

    private renderSelection(): void {
        const unit = this.host.placement.selectedUnit;
        this.shownSelection = unit;
        const sel = this.selectionOf(unit);
        const types = this.host.types;
        const view = this.view;
        if (!sel) {
            this.selectionEl.innerHTML = `<div class="se-muted">${t('editor:nothingSelected', { defaultValue: 'Nothing selected' })}</div>`;
            return;
        }
        let label: string;
        let level: number;
        let canRotate = false;
        if (sel.kind === 'unit') {
            const entry = view.scene.units[sel.index];
            const type = entry ? types.byId(entry.typeId) : null;
            label = `${esc(type?.name ?? entry?.typeId ?? '?')} · ${this.teamName(this.canonicalTeam(entry?.team ?? 'player'))}`;
            level = entry?.level ?? 1;
            canRotate = !!type && type.footprint.cols !== type.footprint.rows;
        } else {
            const type = types.byId(sel.typeId);
            const state = view.scene.buildings[sel.team][sel.typeId];
            label = `${esc(type?.name ?? sel.typeId)} · ${this.teamName(this.canonicalTeam(sel.team))}`;
            level = state ? state.level : 1;
        }
        this.selectionEl.innerHTML =
            `<div class="se-sel-name">${label}</div>` +
            `<div class="se-row">${t('editor:level', { defaultValue: 'Level' })} ` +
            `<button type="button" class="se-level-down" title="[">−</button>` +
            `<span class="se-level">${level}</span>` +
            `<button type="button" class="se-level-up" title="]">+</button>` +
            (canRotate ? `<button type="button" class="se-rotate" title="R">${t('editor:rotate', { defaultValue: 'Rotate' })}</button>` : '') +
            `<button type="button" class="se-delete" title="Del">${t('editor:delete', { defaultValue: 'Delete' })}</button>` +
            `</div>`;
        this.selectionEl.querySelector('.se-level-down')?.addEventListener('click', () => this.changeLevel(-1));
        this.selectionEl.querySelector('.se-level-up')?.addEventListener('click', () => this.changeLevel(1));
        this.selectionEl.querySelector('.se-rotate')?.addEventListener('click', () => this.rotateSelected());
        this.selectionEl.querySelector('.se-delete')?.addEventListener('click', () => {
            const current = this.selectionOf(this.host.placement.selectedUnit);
            if (current) this.erase(current);
        });
    }

    /**
     * Redraw after an input's change: it fires on blur, which a press on a
     * button of this window causes — a redraw right then would swap that
     * button out before its click.
     */
    private renderSoon(): void {
        if (!this.root.isConnected) return;
        this.renderPending = true;
        if (this.pressingWindow) return;
        this.renderPending = false;
        this.render();
    }

    private render(): void {
        this.renderPending = false;
        const types = this.host.types;
        const draft = this.draft;
        const all = [...types.all()];
        const baseIds = new Set(types.baseBuildings.map((b) => b.id));
        const issues = this.host.issues(draft);
        const errors = issues.filter((i) => i.level === 'error');
        const warnings = issues.filter((i) => i.level === 'warning');
        const preset = mapPresetOf(draft.map);
        const btn = (
            cls: string,
            label: string,
            opts: { active?: boolean; disabled?: boolean; data?: string; title?: string; style?: string } = {},
        ) =>
            `<button type="button" class="${cls}${opts.active ? ' active' : ''}"${opts.disabled ? ' disabled' : ''}${opts.data ? ` ${opts.data}` : ''}${opts.title ? ` title="${esc(opts.title)}"` : ''}${opts.style ? ` style="${opts.style}"` : ''}>${label}</button>`;
        const palette = (list: UnitType[]) =>
            list
                .map((ty) => {
                    const icon = this.host.unitIcon(ty.id);
                    const art = icon ? `<span class="se-ico" style="background-image:url('${icon}')"></span>` : '';
                    return btn('se-type', `${art}<span class="se-type-name">${esc(ty.name)}</span>`, {
                        active: this.tool === 'place' && this.placeTypeId === ty.id,
                        data: `data-type="${esc(ty.id)}"`,
                        title: `${ty.name} · ${ty.id}${baseIds.has(ty.id) ? ' · base building' : ''} · ${ty.footprint.cols}×${ty.footprint.rows}`,
                    });
                })
                .join('');
        // counts as the scenario means them (player = the real player)
        const counts = { player: 0, enemy: 0, horde: 0 };
        for (const u of draft.scene.units) counts[u.team]++;
        const sideColor = colorForBattleTeam(this.side).css;
        const value = armyValue(types, draft, this.host.prices);

        this.root.classList.toggle('collapsed', this.collapsed);
        this.root.innerHTML =
            `<div class="se-head">` +
            `<span class="se-title">${t('editor:title', { defaultValue: 'Scenario editor' })}</span>` +
            `<button type="button" class="se-collapse" title="${esc(t('editor:collapse', { defaultValue: 'Fold the window' }))}">${this.collapsed ? '▸' : '▾'}</button>` +
            `</div>`;
        const head = this.root.querySelector<HTMLElement>('.se-head')!;
        this.wireWindowDrag(head);
        head.querySelector('.se-collapse')!.addEventListener('click', () => {
            this.collapsed = !this.collapsed;
            this.render();
        });
        this.root.appendChild(this.bodyEl);
        this.bodyEl.innerHTML =
            `<div class="se-section">` +
            (this.host.packageName
                ? `<label class="se-rule"><span>${t('editor:packageName', { defaultValue: 'Package (saved with Save into package)' })}</span>` +
                  `<input class="se-package-name" type="text" maxlength="60" value="${esc(this.packageNameDraft ?? this.host.packageName)}"></label>`
                : `<div class="se-muted">${esc(this.host.levelLabel)}</div>`) +
            `<label class="se-rule"><span>${t('editor:scenarioName', { defaultValue: 'Scenario name (level title)' })}</span>` +
            `<input class="se-name" type="text" maxlength="60" value="${esc(draft.name)}"></label>` +
            `<div class="se-side" style="--se-team:${sideColor}">` +
            `${t('editor:building', { defaultValue: 'Building' })} <b>${this.teamName(this.side)}</b> ` +
            btn('se-switch', `⇄ ${this.teamName(this.side === 'player' ? 'enemy' : 'player')}`, { title: 'Tab' }) +
            `</div>` +
            `</div>` +
            `<div class="se-section">` +
            `<div class="se-row">` +
            btn('se-tool', t('editor:toolPlay', { defaultValue: 'Game UI' }), {
                active: this.tool === 'play',
                data: 'data-tool="play"',
                title: t('editor:toolPlayTip', { defaultValue: 'Build with the normal game UI: shop, move, talents, runes — all free' }),
            }) +
            btn('se-tool', t('editor:toolMove', { defaultValue: 'Move' }), {
                active: this.tool === 'move',
                data: 'data-tool="move"',
                title: t('editor:toolMoveTip', { defaultValue: 'Drag anything: enemy, horde, earlier placements — hold Alt to drop a copy' }),
            }) +
            btn('se-tool', t('editor:toolPlace', { defaultValue: 'Place' }), { active: this.tool === 'place', data: 'data-tool="place"' }) +
            btn('se-tool', t('editor:toolErase', { defaultValue: 'Erase' }), { active: this.tool === 'erase', data: 'data-tool="erase"' }) +
            (this.host.terrain
                ? btn('se-tool', t('editor:toolTerrain', { defaultValue: 'Terrain' }), {
                      active: this.tool === 'terrain',
                      data: 'data-tool="terrain"',
                      title: t('editor:toolTerrainTip', { defaultValue: 'Sculpt the ground, paint it, plant trees — saved with the scenario' }),
                  })
                : '') +
            `</div>` +
            (this.tool === 'terrain' ? `<div class="se-terrain-slot"></div>` : '') +
            (this.tool === 'place'
                ? `<div class="se-row">` +
                  (['player', 'enemy', 'horde'] as const)
                      .map((team) =>
                          btn('se-team', `${this.teamName(this.canonicalTeam(team))}`, {
                              active: this.team === team,
                              data: `data-team="${team}"`,
                              style: `--se-team:${colorForBattleTeam(team).css}`,
                          }),
                      )
                      .join('') +
                  `</div>` +
                  `<div class="se-palette">` +
                  `<div class="se-label">${t('editor:units', { defaultValue: 'Units' })}</div><div class="se-grid">${palette(all.filter((ty) => !ty.structure))}</div>` +
                  `<div class="se-label">${t('editor:buildings', { defaultValue: 'Buildings' })}</div><div class="se-grid">${palette(all.filter((ty) => ty.structure))}</div>` +
                  `</div>`
                : '') +
            `</div>`;
        // the terrain panel is the terrain editor's own (built once, kept across redraws)
        const terrainSlot = this.bodyEl.querySelector('.se-terrain-slot');
        if (terrainSlot && this.host.terrain) terrainSlot.replaceWith(this.host.terrain.panel);
        if (this.tool !== 'terrain') this.bodyEl.appendChild(this.selectionEl);
        this.renderSelection();
        const rest = document.createElement('div');
        rest.innerHTML =
            `<div class="se-section">` +
            `<div class="se-row">` +
            `<span class="se-muted" title="${esc(t('editor:armyValueTip', { defaultValue: 'Packs · army value in supply (units, levels, runes, talents)' }))}">` +
            (['player', 'enemy', 'horde'] as const)
                .filter((team) => team !== 'horde' || counts.horde > 0)
                .map((team) => `${this.teamName(team)} ${counts[team]} · ${Math.round(value[team])}`)
                .join(' — ') +
            `</span>` +
            `</div>` +
            `<div class="se-row">` +
            btn('se-mirror', t('editor:mirror', { defaultValue: 'Copy army to the other side' }), {
                title: t('editor:mirrorTip', { defaultValue: 'Replaces the other side’s units, talents and buildings with a turned copy of this side' }),
            }) +
            btn('se-clear', t('editor:clearSide', { defaultValue: 'Clear this side' }), { disabled: counts[this.side] === 0 }) +
            (counts.horde > 0 ? btn('se-clear-horde', t('editor:clearHorde', { defaultValue: 'Clear horde' })) : '') +
            `</div>` +
            `<div class="se-row"><label>${t('editor:map', { defaultValue: 'Board' })} <select class="se-map">` +
            (Object.keys(MAP_PRESETS) as MapPresetId[])
                .map((id) => {
                    const m = MAP_PRESETS[id];
                    return `<option value="${id}"${preset === id ? ' selected' : ''}>${id} · ${m.zoneCols}×${m.zoneRows}</option>`;
                })
                .join('') +
            (preset === null ? `<option value="" selected>custom · ${draft.map.zoneCols}×${draft.map.zoneRows}</option>` : '') +
            `</select></label></div>` +
            `<div class="se-row">${t('editor:baseBuildings', { defaultValue: 'Base buildings' })} ` +
            (['player', 'enemy'] as const)
                .map(
                    (side) =>
                        `<label><input type="checkbox" class="se-base" data-side="${side}"${hasBaseBuildings(types, draft, side) ? ' checked' : ''}> ${this.teamName(side)}</label>`,
                )
                .join('') +
            `</div>` +
            `</div>` +
            `<details class="se-section se-rules"${this.rulesOpen ? ' open' : ''}>` +
            `<summary>${t('editor:rules', { defaultValue: 'Rules' })}</summary>` +
            rulesHtml(draft, types) +
            `</details>` +
            `<div class="se-section">` +
            `<div class="se-row">` +
            btn('se-undo', t('editor:undo', { defaultValue: 'Undo' }), { disabled: !this.canUndo, title: 'Ctrl+Z' }) +
            btn('se-redo', t('editor:redo', { defaultValue: 'Redo' }), { disabled: this.redoSteps.length === 0 && !this.history.canRedo, title: 'Ctrl+Shift+Z' }) +
            btn('se-new', t('editor:new', { defaultValue: 'New' })) +
            `</div>` +
            `<div class="se-row se-run">` +
            btn('se-test', `▶ ${t('editor:testBattle', { defaultValue: 'Test battle' })}`, {
                disabled: errors.length > 0,
                title: errors.length > 0 ? errors.map((i) => i.message).join('\n') : t('editor:testTip', { defaultValue: 'Both sides fight as placed — End Deployment does the same' }),
            }) +
            btn('se-play', `⚔ ${t('editor:play', { defaultValue: 'Play' })}`, {
                disabled: errors.length > 0,
                title: t('editor:playTip', { defaultValue: 'Play it as a scenario: you build with its rules, the computer plays its side' }),
            }) +
            `</div>` +
            `<div class="se-row">` +
            btn('se-save', this.host.packageName ? t('editor:saveNew', { defaultValue: 'Save as new' }) : t('editor:save', { defaultValue: 'Save' }), {
                disabled: errors.length > 0,
                title: t('editor:saveTip', { defaultValue: 'Keep it as a scenario (with this level’s content) — one saved under the same name is replaced' }),
            }) +
            (this.host.packageName
                ? btn('se-save-into', t('editor:saveInto', { defaultValue: 'Save into package' }), {
                      disabled: errors.length > 0,
                      title: t('editor:saveIntoTip', {
                          defaultValue: 'Into “{{name}}”: replaces this scenario, or adds it as the next level',
                          name: this.host.packageName,
                      }),
                  })
                : '') +
            btn('se-code', t('editor:shareCode', { defaultValue: 'Copy code' }), {
                disabled: errors.length > 0,
                title: t('editor:shareCodeTip', { defaultValue: 'A text code for chat — import it under Single Player → Editor' }),
            }) +
            (this.host.canDownload() ? btn('se-download', t('editor:downloadZip', { defaultValue: 'Download zip' })) : '') +
            btn('se-exit', t('editor:exit', { defaultValue: 'Exit' })) +
            `</div>` +
            (errors.length + warnings.length > 0
                ? `<div class="se-issues${errors.length ? ' error' : ''}" title="${esc(issues.map((i) => `${i.level}: ${i.message}`).join('\n'))}">` +
                  (errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : '') +
                  (errors.length && warnings.length ? ' · ' : '') +
                  (warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '') +
                  `</div>`
                : '') +
            `<div class="se-status"></div>` +
            `<div class="se-hint">${t('editor:hint', { defaultValue: 'Tab switch side · [ ] level · Del delete · R rotate (Move) · Ctrl+Z undo' })}</div>` +
            `</div>`;
        while (rest.firstChild) this.bodyEl.appendChild(rest.firstChild);
        this.wireWindow();
    }

    private wireWindow(): void {
        const on = (selector: string, handler: (el: HTMLElement) => void) => {
            for (const el of this.bodyEl.querySelectorAll<HTMLElement>(selector)) el.addEventListener('click', () => handler(el));
        };
        on('.se-switch', () => this.switchSide());
        on('.se-tool', (el) => this.setTool(el.dataset.tool as Tool));
        on('.se-team', (el) => {
            this.team = el.dataset.team as SceneTeam;
            this.render();
        });
        on('.se-type', (el) => {
            this.placeTypeId = el.dataset.type ?? null;
            this.render();
        });
        on('.se-mirror', () => {
            const ok = window.confirm(
                t('editor:mirrorConfirm', {
                    defaultValue: 'Replace the {{other}} side with a copy of the {{side}} side?',
                    side: this.teamName(this.side),
                    other: this.teamName(this.side === 'player' ? 'enemy' : 'player'),
                }),
            );
            if (!ok) return;
            const next = mirrorSide(this.host.types, this.draft, this.side);
            if (this.push(next)) this.apply(null);
        });
        on('.se-clear', () => {
            const next = withoutTeam(this.draft, this.side);
            if (this.push(next)) this.apply(null);
        });
        on('.se-clear-horde', () => {
            if (this.push(withoutTeam(this.draft, 'horde'))) this.apply(null);
        });
        on('.se-undo', () => this.undo());
        on('.se-redo', () => this.redo());
        on('.se-new', () => {
            const ok = window.confirm(t('editor:newConfirm', { defaultValue: 'Start a new board? Undo brings the current one back.' }));
            if (!ok) return;
            const next = newDraft(this.host.gameVersion, this.host.types);
            this.side = 'player';
            if (JSON.stringify(next.map) !== JSON.stringify(this.draft.map)) {
                this.push(next);
                this.changeBoardSize(next);
            } else if (this.push(next)) this.apply(null);
        });
        on('.se-test', () => this.startTest());
        on('.se-play', () => {
            this.carry();
            this.host.autosave(this.draft);
            this.host.play(this.draft);
        });
        const busy = (el: HTMLElement, run: () => Promise<string>) => {
            (el as HTMLButtonElement).disabled = true;
            void run()
                .then((status) => this.flash(status))
                .catch((e: unknown) => this.flash(e instanceof Error ? e.message : String(e)))
                .finally(() => ((el as HTMLButtonElement).disabled = false));
        };
        on('.se-save', (el) => busy(el, () => this.host.save(this.draft)));
        on('.se-save-into', (el) =>
            busy(el, async () => {
                const packageName = this.packageNameDraft?.trim();
                const result = await this.host.saveInto(this.draft, packageName && packageName !== this.host.packageName ? packageName : undefined);
                if (result.id !== this.draft.id) {
                    const next = structuredClone(this.draft);
                    next.id = result.id;
                    this.push(next);
                }
                this.host.autosave(this.draft);
                if (result.reopen) {
                    this.carry();
                    result.reopen(this.draft);
                }
                return result.status;
            }),
        );
        on('.se-download', (el) => busy(el, () => this.host.download(this.draft)));
        on('.se-code', (el) => busy(el, () => this.host.shareCode(this.draft)));
        on('.se-exit', () => this.host.exit());
        const rules = this.bodyEl.querySelector<HTMLDetailsElement>('.se-rules');
        if (rules) {
            rules.addEventListener('toggle', () => (this.rulesOpen = rules.open));
            wireRules(rules, () => this.draft, this.host.types, (next) => {
                // rules don't touch the board: record, keep, redraw
                if (this.push(next)) {
                    this.host.autosave(this.draft);
                    this.renderSoon();
                }
            });
        }

        const packageName = this.bodyEl.querySelector<HTMLInputElement>('.se-package-name');
        packageName?.addEventListener('input', () => (this.packageNameDraft = packageName.value));
        const name = this.bodyEl.querySelector<HTMLInputElement>('.se-name');
        name?.addEventListener('change', () => {
            const value = name.value.trim();
            if (!value || value === this.draft.name) return;
            const next = structuredClone(this.draft);
            next.name = value;
            if (this.push(next)) {
                this.host.autosave(this.draft);
                this.renderSoon();
            }
        });
        const map = this.bodyEl.querySelector<HTMLSelectElement>('.se-map');
        map?.addEventListener('change', () => {
            const preset = MAP_PRESETS[map.value as MapPresetId];
            if (!preset) return;
            const { def, removed } = withMap(this.host.types, this.draft, preset);
            if (removed.length > 0) {
                const ok = window.confirm(
                    t('editor:mapRemoves', {
                        defaultValue: '{{n}} placed units do not fit the new board and will be removed (Undo brings them back). Continue?',
                        n: removed.length,
                    }),
                );
                if (!ok) {
                    this.render();
                    return;
                }
            }
            if (draftTerrain()) {
                const ok = window.confirm(
                    t('editor:mapDropsTerrain', {
                        defaultValue: 'The sculpted terrain is made for this board size and will be thrown away. Continue?',
                    }),
                );
                if (!ok) {
                    this.render();
                    return;
                }
            }
            this.push(def);
            this.changeBoardSize(def);
        });
        for (const box of this.bodyEl.querySelectorAll<HTMLInputElement>('.se-base')) {
            box.addEventListener('change', () => {
                const side = box.dataset.side as Side;
                if (this.push(tidyDraft(withBaseBuildings(this.host.types, this.draft, side, box.checked)))) this.apply(null);
            });
        }
    }
}

// ---- test battle

export interface TestBattleSummary {
    /** who has field units left: player, enemy, both (time ran out) or neither */
    outcome: 'player' | 'enemy' | 'draw' | 'timeout';
    seconds: number;
    packs: Record<'player' | 'enemy' | 'horde', { standing: number; total: number }>;
    members: Record<'player' | 'enemy' | 'horde', { alive: number; total: number }>;
    /** damage each side's HP would take */
    damage: { player: number; enemy: number };
}

/** earlier test results this tab, newest first — to compare tweaks of a board */
const testResults: { line: string; board: string }[] = [];
const TEST_RESULTS_KEPT = 6;

/** The strip over a test battle: back to the editor any time, the result at the end. */
export class TestBattleBar {
    private readonly root: HTMLDivElement;

    constructor(
        wrapper: HTMLElement,
        cb: { onBack(): void; onAgain(): void; onSkip(): void },
        /** the board being tested (to mark results of other boards) */
        private readonly board: string = '',
    ) {
        this.root = document.createElement('div');
        this.root.className = 'mechili-test-battle';
        this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.root.innerHTML =
            `<div class="tb-row"><span class="tb-title">${t('editor:testBattle', { defaultValue: 'Test battle' })}</span>` +
            `<button type="button" class="tb-skip">${t('editor:skipToResult', { defaultValue: 'Skip to result' })}</button>` +
            `<button type="button" class="tb-again">${t('editor:runAgain', { defaultValue: 'Run again' })}</button>` +
            `<button type="button" class="tb-back">${t('editor:backToEditor', { defaultValue: 'Back to editor' })}</button></div>` +
            `<div class="tb-result"></div>`;
        this.root.querySelector('.tb-back')!.addEventListener('click', () => cb.onBack());
        this.root.querySelector('.tb-again')!.addEventListener('click', () => cb.onAgain());
        this.root.querySelector('.tb-skip')!.addEventListener('click', () => cb.onSkip());
        wrapper.appendChild(this.root);
    }

    showResult(summary: TestBattleSummary): void {
        const el = this.root.querySelector<HTMLElement>('.tb-result')!;
        const headline =
            summary.outcome === 'player'
                ? t('editor:resultPlayer', { defaultValue: 'Player wins' })
                : summary.outcome === 'enemy'
                  ? t('editor:resultEnemy', { defaultValue: 'Enemy wins' })
                  : summary.outcome === 'timeout'
                    ? t('editor:resultTimeout', { defaultValue: 'Time ran out' })
                    : t('editor:resultDraw', { defaultValue: 'Nobody left standing' });
        const line = (team: 'player' | 'enemy' | 'horde', label: string) => {
            const p = summary.packs[team];
            const m = summary.members[team];
            if (p.total === 0) return '';
            const damage = team === 'horde' ? '' : ` · ${t('editor:damageTaken', { defaultValue: 'takes' })} ${Math.round(summary.damage[team])}`;
            return `<div class="tb-side" style="--se-team:${colorForBattleTeam(team).css}"><b>${label}</b> ${p.standing}/${p.total} packs · ${m.alive}/${m.total} units${damage}</div>`;
        };
        const earlier = testResults
            .map((r) => `<div class="tb-earlier${r.board === this.board ? '' : ' other'}" title="${r.board === this.board ? 'same board' : 'a different board'}">${esc(r.line)}</div>`)
            .join('');
        const short = `${headline} · ${summary.seconds.toFixed(1)}s · ${summary.packs.player.standing}/${summary.packs.player.total} vs ${summary.packs.enemy.standing}/${summary.packs.enemy.total}`;
        testResults.unshift({ line: short, board: this.board });
        testResults.length = Math.min(testResults.length, TEST_RESULTS_KEPT);
        el.innerHTML =
            `<div class="tb-headline">${headline} · ${summary.seconds.toFixed(1)}s</div>` +
            line('player', t('editor:teamPlayer', { defaultValue: 'Player' })) +
            line('enemy', t('editor:teamEnemy', { defaultValue: 'Enemy' })) +
            line('horde', t('editor:teamHorde', { defaultValue: 'Horde' })) +
            (earlier ? `<div class="tb-earlier-head">${t('editor:earlierTests', { defaultValue: 'Earlier tests' })}</div>${earlier}` : '');
        this.root.classList.add('done');
    }

    remove(): void {
        this.root.remove();
    }
}
