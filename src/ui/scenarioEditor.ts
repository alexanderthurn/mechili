/**
 * Scenario editor, author mode (plan §8): the tools panel and the board input.
 * Left click selects, left drag moves, the place tool drops the palette's type
 * for the brush team, the erase tool removes. Right drag still pans the camera.
 *
 * The draft is the only state: every edit becomes a new draft, the Game
 * rebuilds its board from it and the draft is autosaved. Undo/redo are draft
 * snapshots. The test battle and map changes restart the match from the draft;
 * the history survives that restart (module-level carry).
 */
import type { TypeRegistry } from '../game/content/typeRegistry';
import { colorForBattleTeam } from '../game/colors';
import { t } from '../i18n';
import type { PlacementController } from '../game/placement';
import type { AppliedScene } from '../game/scenario/applyScenario';
import {
    DraftHistory,
    hasBaseBuildings,
    MAP_PRESETS,
    mapPresetOf,
    newDraft,
    onBoard,
    withBaseBuildings,
    withMap,
    withoutTeam,
    type MapPresetId,
} from '../game/scenario/editorDraft';
import type { ScenarioIssue } from '../game/scenario/normalize';
import type { ScenarioDef, SceneTeam, SceneUnit } from '../game/scenario/scenarioDef';
import type { Unit, UnitType } from '../game/units';

export interface ScenarioEditorHost {
    readonly types: TypeRegistry;
    readonly placement: PlacementController;
    /** the pointer surface the board listens on */
    readonly surface: HTMLElement;
    /** the match UI root the panel mounts into */
    readonly wrapper: HTMLElement;
    readonly maxUnitLevel: number;
    readonly maxBuildingLevel: number;
    /** 'Base game' or the level package's id */
    readonly levelLabel: string;
    readonly gameVersion: string;
    /** whether a zip download is offered (web builds) */
    canDownload(): boolean;
    /** put the draft's board on the running match */
    rebuild(def: ScenarioDef): AppliedScene;
    issues(def: ScenarioDef): ScenarioIssue[];
    autosave(def: ScenarioDef): void;
    /** a new match from the draft (map size changed) */
    restart(def: ScenarioDef): void;
    test(def: ScenarioDef): void;
    download(def: ScenarioDef): Promise<string>;
    exit(): void;
}

type Tool = 'select' | 'place' | 'erase';

type Selection =
    | { kind: 'unit'; index: number }
    | { kind: 'building'; team: 'player' | 'enemy'; typeId: string };

/** the editor's history across the restarts it causes (test battle, map size) */
let carried: { history: DraftHistory; tool: Tool; team: SceneTeam; placeTypeId: string | null } | null = null;

const DRAG_SLOP_PX = 6;

export class ScenarioEditor {
    private readonly history: DraftHistory;
    private applied: AppliedScene = { units: [], buildings: [] };
    private tool: Tool = 'select';
    private team: SceneTeam = 'player';
    private placeTypeId: string | null = null;
    private selection: Selection | null = null;
    private press: { x: number; y: number; unit: Unit | null; index: number | null; dragging: boolean } | null = null;
    private readonly root: HTMLDivElement;
    private readonly disposers: (() => void)[] = [];
    private statusTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly host: ScenarioEditorHost, draft: ScenarioDef) {
        // the same draft coming back from a test battle keeps its undo history
        if (carried && JSON.stringify(carried.history.draft) === JSON.stringify(draft)) {
            this.history = carried.history;
            this.tool = carried.tool;
            this.team = carried.team;
            this.placeTypeId = carried.placeTypeId;
        } else {
            this.history = new DraftHistory(draft);
        }
        carried = null;
        host.placement.externalInput = true;
        host.placement.repositioningEnabled = false;

        this.root = document.createElement('div');
        this.root.className = 'mechili-scenario-editor';
        this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.root.addEventListener('wheel', (e) => e.stopPropagation());
        host.wrapper.appendChild(this.root);

        this.listen(host.surface, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
        this.listen(host.surface, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
        this.listen(host.surface, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
        this.listen(host.surface, 'pointercancel', () => this.cancelPress());
        this.listen(host.surface, 'pointerleave', () => {
            if (!this.press) host.placement.editorPlate = null;
        });
        this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));

        this.apply();
        // the host finishes wiring (download) right after it constructs us
        queueMicrotask(() => this.render());
    }

    destroy(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.root.remove();
        this.host.placement.externalInput = false;
        this.host.placement.editorPlate = null;
    }

    private get draft(): ScenarioDef {
        return this.history.draft;
    }

    private listen(target: EventTarget, type: string, handler: EventListener): void {
        target.addEventListener(type, handler);
        this.disposers.push(() => target.removeEventListener(type, handler));
    }

    // ---- draft → board

    /** record an edit; the board follows */
    private commit(next: ScenarioDef): void {
        if (next.map && JSON.stringify(next.map) !== JSON.stringify(this.draft.map)) {
            this.history.push(next);
            this.restartWith(next);
            return;
        }
        if (this.history.push(next)) this.apply();
    }

    private restartWith(def: ScenarioDef): void {
        carried = { history: this.history, tool: this.tool, team: this.team, placeTypeId: this.placeTypeId };
        this.host.autosave(def);
        this.host.restart(def);
    }

    /** rebuild the board from the draft, autosave, restore the selection, redraw the panel */
    private apply(): void {
        this.host.placement.deselect();
        this.applied = this.host.rebuild(this.draft);
        this.host.autosave(this.draft);
        const unit = this.selectedUnit();
        if (unit) this.host.placement.selectUnit(unit);
        else this.selection = null;
        this.render();
    }

    private selectedUnit(): Unit | null {
        const sel = this.selection;
        if (!sel) return null;
        if (sel.kind === 'unit') return this.applied.units[sel.index] ?? null;
        return this.applied.buildings.find((b) => b.team === sel.team && b.type.id === sel.typeId) ?? null;
    }

    private undo(): void {
        const before = this.draft.map;
        const def = this.history.undo();
        if (!def) return;
        if (JSON.stringify(def.map) !== JSON.stringify(before)) this.restartWith(def);
        else this.apply();
    }

    private redo(): void {
        const before = this.draft.map;
        const def = this.history.redo();
        if (!def) return;
        if (JSON.stringify(def.map) !== JSON.stringify(before)) this.restartWith(def);
        else this.apply();
    }

    // ---- board input

    private local(e: PointerEvent): { x: number; y: number } {
        return this.host.placement.clientToLocal(e.clientX, e.clientY);
    }

    /** what a click on the board hit: a placed entry, a base building (or its post), or nothing */
    private hit(x: number, y: number): { unit: Unit; selection: Selection } | null {
        let unit = this.host.placement.unitAtPoint(x, y) ?? null;
        if (!unit) return null;
        if (unit.hostUnitId !== null) {
            const hostId = unit.hostUnitId;
            unit = this.host.placement.allUnits().find((u) => u.id === hostId) ?? unit;
        }
        const index = this.applied.units.indexOf(unit);
        if (index >= 0) return { unit, selection: { kind: 'unit', index } };
        if (this.applied.buildings.includes(unit) && unit.team !== 'horde') {
            return { unit, selection: { kind: 'building', team: unit.team, typeId: unit.type.id } };
        }
        return null;
    }

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0) return;
        const { x, y } = this.local(e);
        const hit = this.tool === 'select' ? this.hit(x, y) : null;
        this.press = { x, y, unit: hit?.unit ?? null, index: hit?.selection.kind === 'unit' ? hit.selection.index : null, dragging: false };
        if (this.tool === 'select') {
            this.selection = hit?.selection ?? null;
            if (hit) this.host.placement.selectUnit(hit.unit);
            else this.host.placement.deselect();
            this.render();
        }
    }

    private onPointerMove(e: PointerEvent): void {
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
        const spot = this.anchorAt(press.unit.type, this.draft.scene.units[press.index]?.at.rotated ?? false, x, y);
        if (!spot) return;
        press.unit.view.position.set(spot.center.x, 0, spot.center.z);
        press.unit.seatMembers(spot.center.x, spot.center.z);
        const entry = this.draft.scene.units[press.index];
        if (entry) {
            const moved: SceneUnit = { ...entry, at: { ...entry.at, col: spot.at.col, row: spot.at.row } };
            this.host.placement.editorPlate = {
                type: press.unit.type,
                anchor: spot.at,
                rotated: entry.at.rotated ?? false,
                valid: this.fits(press.unit.type, moved, press.unit),
            };
        }
    }

    /** the place tool's footprint under the cursor */
    private showPlacePlate(x: number, y: number): void {
        const type = this.placeTypeId ? this.host.types.byId(this.placeTypeId) : null;
        const spot = type ? this.anchorAt(type, false, x, y) : null;
        if (!type || !spot) {
            this.host.placement.editorPlate = null;
            return;
        }
        const entry: SceneUnit = { typeId: type.id, team: this.team, at: spot.at, level: 1 };
        this.host.placement.editorPlate = { type, anchor: spot.at, rotated: false, valid: this.fits(type, entry, null) };
    }

    private onPointerUp(e: PointerEvent): void {
        if (e.button !== 0) return;
        const press = this.press;
        this.press = null;
        if (!press) return;
        if (press.dragging) this.host.placement.editorPlate = null;
        const { x, y } = this.local(e);
        if (press.dragging && press.index !== null && press.unit) {
            this.dropMoved(press.index, press.unit, x, y);
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
    ): { at: { col: number; row: number }; center: { x: number; z: number } } | null {
        const placement = this.host.placement;
        const cell = placement.cellAtPoint(x, y);
        if (!cell) return null;
        const at = placement.anchorCenteredOn(type, rotated, cell);
        const fp = rotated ? { cols: type.footprint.rows, rows: type.footprint.cols } : type.footprint;
        const center = placement.map.areaCenter(at, fp.cols, fp.rows);
        return { at, center: { x: center.x, z: center.z } };
    }

    /** can an entry of `team` stand at `unit.at`? (`moving` may already stand there) */
    private fits(type: UnitType, entry: SceneUnit, moving: Unit | null): boolean {
        if (!onBoard(this.host.types, this.draft.map, entry)) return false;
        // horde packs stand by world position and take no tiles
        if (entry.team === 'horde') return true;
        return this.host.placement.footprintFree(type, entry.at, entry.at.rotated ?? false, moving);
    }

    private dropMoved(index: number, unit: Unit, x: number, y: number): void {
        const entry = this.draft.scene.units[index];
        const spot = entry ? this.anchorAt(unit.type, entry.at.rotated ?? false, x, y) : null;
        if (!entry || !spot) {
            this.apply();
            return;
        }
        const moved: SceneUnit = { ...entry, at: { ...entry.at, col: spot.at.col, row: spot.at.row } };
        if (!this.fits(unit.type, moved, unit)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            this.apply();
            return;
        }
        const next = structuredClone(this.draft);
        next.scene.units[index] = moved;
        this.selection = { kind: 'unit', index };
        this.history.push(next);
        this.apply();
    }

    private placeAt(x: number, y: number): void {
        const type = this.placeTypeId ? this.host.types.byId(this.placeTypeId) : null;
        if (!type) {
            this.flash(t('editor:pickType', { defaultValue: 'Pick a unit or building first' }));
            return;
        }
        const spot = this.anchorAt(type, false, x, y);
        if (!spot) return;
        const entry: SceneUnit = { typeId: type.id, team: this.team, at: spot.at, level: 1 };
        if (!this.fits(type, entry, null)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            return;
        }
        const next = structuredClone(this.draft);
        next.scene.units.push(entry);
        this.commit(next);
        this.showPlacePlate(x, y);
    }

    private erase(selection: Selection): void {
        const next = structuredClone(this.draft);
        if (selection.kind === 'unit') {
            next.scene.units.splice(selection.index, 1);
            // later entries shift down; a selection past the removed one follows
            const sel = this.selection;
            if (sel?.kind === 'unit') {
                if (sel.index === selection.index) this.selection = null;
                else if (sel.index > selection.index) this.selection = { kind: 'unit', index: sel.index - 1 };
            }
        } else {
            next.scene.buildings[selection.team][selection.typeId] = false;
            if (this.selection?.kind === 'building' && this.selection.typeId === selection.typeId && this.selection.team === selection.team) {
                this.selection = null;
            }
        }
        this.commit(next);
    }

    private changeLevel(delta: number): void {
        const sel = this.selection;
        if (!sel) return;
        const next = structuredClone(this.draft);
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
        this.commit(next);
    }

    private rotateSelected(): void {
        const sel = this.selection;
        if (sel?.kind !== 'unit') return;
        const entry = this.draft.scene.units[sel.index];
        const type = entry ? this.host.types.byId(entry.typeId) : null;
        if (!entry || !type || type.footprint.cols === type.footprint.rows) return;
        const rotated: SceneUnit = { ...entry, at: { ...entry.at, rotated: !entry.at.rotated } };
        if (!rotated.at.rotated) delete rotated.at.rotated;
        if (!this.fits(type, rotated, this.applied.units[sel.index] ?? null)) {
            this.flash(t('editor:noRoom', { defaultValue: 'No room there' }));
            return;
        }
        const next = structuredClone(this.draft);
        next.scene.units[sel.index] = rotated;
        this.commit(next);
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
            if (this.selection) this.erase(this.selection);
        } else if (key === 'r') this.rotateSelected();
        else if (key === '[' || key === '-') this.changeLevel(-1);
        else if (key === ']' || key === '+' || key === '=') this.changeLevel(1);
        else if (key === 'v') this.setTool('select');
        else if (key === 'b') this.setTool('place');
        else if (key === 'x') this.setTool('erase');
        else handled = false;
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private setTool(tool: Tool): void {
        this.tool = tool;
        this.host.placement.editorPlate = null;
        if (tool !== 'select') {
            this.selection = null;
            this.host.placement.deselect();
        }
        this.render();
    }

    private flash(text: string): void {
        const el = this.root.querySelector<HTMLElement>('.se-status');
        if (!el) return;
        el.textContent = text;
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => (el.textContent = ''), 2500);
    }

    // ---- panel

    private render(): void {
        const types = this.host.types;
        const draft = this.draft;
        const all = [...types.all()];
        const baseIds = new Set(types.buildings.map((b) => b.id));
        const unitTypes = all.filter((ty) => !ty.structure);
        const buildingTypes = all.filter((ty) => ty.structure);
        const issues = this.host.issues(draft);
        const errors = issues.filter((i) => i.level === 'error');
        const warnings = issues.filter((i) => i.level === 'warning');
        const preset = mapPresetOf(draft.map);
        const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
        const teamName = (team: SceneTeam) =>
            team === 'player'
                ? t('editor:teamPlayer', { defaultValue: 'Player' })
                : team === 'enemy'
                  ? t('editor:teamEnemy', { defaultValue: 'Enemy' })
                  : t('editor:teamHorde', { defaultValue: 'Horde' });
        const btn = (cls: string, label: string, opts: { active?: boolean; disabled?: boolean; data?: string; title?: string; style?: string } = {}) =>
            `<button type="button" class="${cls}${opts.active ? ' active' : ''}"${opts.disabled ? ' disabled' : ''}${opts.data ? ` ${opts.data}` : ''}${opts.title ? ` title="${esc(opts.title)}"` : ''}${opts.style ? ` style="${opts.style}"` : ''}>${label}</button>`;
        const palette = (list: UnitType[]) =>
            list
                .map((ty) =>
                    btn('se-type', esc(ty.name), {
                        active: this.tool === 'place' && this.placeTypeId === ty.id,
                        data: `data-type="${esc(ty.id)}"`,
                        title: `${ty.id}${baseIds.has(ty.id) ? ' · base building' : ''} · ${ty.footprint.cols}×${ty.footprint.rows}`,
                    }),
                )
                .join('');

        let selectionHtml = `<div class="se-muted">${t('editor:nothingSelected', { defaultValue: 'Nothing selected' })}</div>`;
        const sel = this.selection;
        if (sel) {
            let label = '';
            let level = 1;
            let canRotate = false;
            if (sel.kind === 'unit') {
                const entry = draft.scene.units[sel.index];
                const type = entry ? types.byId(entry.typeId) : null;
                label = `${esc(type?.name ?? entry?.typeId ?? '?')} · ${teamName(entry?.team ?? 'player')}`;
                level = entry?.level ?? 1;
                canRotate = !!type && type.footprint.cols !== type.footprint.rows;
            } else {
                const type = types.byId(sel.typeId);
                const state = draft.scene.buildings[sel.team][sel.typeId];
                label = `${esc(type?.name ?? sel.typeId)} · ${teamName(sel.team)} · ${t('editor:baseBuilding', { defaultValue: 'base' })}`;
                level = state ? state.level : 1;
            }
            selectionHtml =
                `<div class="se-sel-name">${label}</div>` +
                `<div class="se-row">${t('editor:level', { defaultValue: 'Level' })} ` +
                btn('se-level-down', '−', { title: '[' }) +
                `<span class="se-level">${level}</span>` +
                btn('se-level-up', '+', { title: ']' }) +
                (canRotate ? btn('se-rotate', t('editor:rotate', { defaultValue: 'Rotate' }), { title: 'R' }) : '') +
                btn('se-delete', t('editor:delete', { defaultValue: 'Delete' }), { title: 'Del' }) +
                `</div>`;
        }

        const counts = (['player', 'enemy', 'horde'] as const).map((team) => draft.scene.units.filter((u) => u.team === team).length);

        this.root.innerHTML =
            `<div class="se-head">` +
            `<div class="se-title">${t('editor:title', { defaultValue: 'Scenario editor' })}</div>` +
            `<div class="se-muted">${esc(this.host.levelLabel)}</div>` +
            `<input class="se-name" type="text" maxlength="60" value="${esc(draft.name)}">` +
            `</div>` +
            `<div class="se-section">` +
            `<div class="se-row">` +
            btn('se-tool', t('editor:toolSelect', { defaultValue: 'Select' }), { active: this.tool === 'select', data: 'data-tool="select"', title: 'V — click to select, drag to move' }) +
            btn('se-tool', t('editor:toolPlace', { defaultValue: 'Place' }), { active: this.tool === 'place', data: 'data-tool="place"', title: 'B' }) +
            btn('se-tool', t('editor:toolErase', { defaultValue: 'Erase' }), { active: this.tool === 'erase', data: 'data-tool="erase"', title: 'X' }) +
            `</div>` +
            `<div class="se-row">` +
            (['player', 'enemy', 'horde'] as const)
                .map((team, i) =>
                    btn('se-team', `${teamName(team)} <span class="se-count">${counts[i]}</span>`, {
                        active: this.team === team,
                        data: `data-team="${team}"`,
                        style: `--se-team:${colorForBattleTeam(team).css}`,
                    }),
                )
                .join('') +
            `</div>` +
            `</div>` +
            `<div class="se-section se-palette">` +
            `<div class="se-label">${t('editor:units', { defaultValue: 'Units' })}</div><div class="se-grid">${palette(unitTypes)}</div>` +
            `<div class="se-label">${t('editor:buildings', { defaultValue: 'Buildings' })}</div><div class="se-grid">${palette(buildingTypes)}</div>` +
            `</div>` +
            `<div class="se-section">${selectionHtml}</div>` +
            `<div class="se-section">` +
            `<div class="se-row"><label>${t('editor:map', { defaultValue: 'Map' })} <select class="se-map">` +
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
                        `<label><input type="checkbox" class="se-base" data-side="${side}"${hasBaseBuildings(types, draft, side) ? ' checked' : ''}> ${teamName(side)}</label>`,
                )
                .join('') +
            `</div>` +
            `<div class="se-row">` +
            btn('se-clear', t('editor:clearTeam', { defaultValue: 'Clear {{team}} units', team: teamName(this.team) }), { disabled: counts[['player', 'enemy', 'horde'].indexOf(this.team)] === 0 }) +
            `</div>` +
            `</div>` +
            `<div class="se-section">` +
            `<div class="se-row">` +
            btn('se-undo', t('editor:undo', { defaultValue: 'Undo' }), { disabled: !this.history.canUndo, title: 'Ctrl+Z' }) +
            btn('se-redo', t('editor:redo', { defaultValue: 'Redo' }), { disabled: !this.history.canRedo, title: 'Ctrl+Shift+Z' }) +
            btn('se-new', t('editor:new', { defaultValue: 'New' })) +
            `</div>` +
            btn('se-test', `▶ ${t('editor:testBattle', { defaultValue: 'Test battle' })}`, { disabled: errors.length > 0, title: errors.map((i) => i.message).join('\n') }) +
            `<div class="se-row">` +
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
            `<div class="se-hint">${t('editor:hint', { defaultValue: 'Left: select · drag to move · Right drag: pan · R rotate · [ ] level · Del delete · Ctrl+Z undo' })}</div>` +
            `</div>`;

        this.wirePanel();
    }

    private wirePanel(): void {
        const on = (selector: string, handler: (el: HTMLElement) => void) => {
            for (const el of this.root.querySelectorAll<HTMLElement>(selector)) el.addEventListener('click', () => handler(el));
        };
        on('.se-tool', (el) => this.setTool(el.dataset.tool as Tool));
        on('.se-team', (el) => {
            this.team = el.dataset.team as SceneTeam;
            if (this.tool === 'erase') this.tool = 'place';
            this.render();
        });
        on('.se-type', (el) => {
            this.placeTypeId = el.dataset.type ?? null;
            this.setTool('place');
        });
        on('.se-level-down', () => this.changeLevel(-1));
        on('.se-level-up', () => this.changeLevel(1));
        on('.se-rotate', () => this.rotateSelected());
        on('.se-delete', () => this.selection && this.erase(this.selection));
        on('.se-clear', () => this.commit(withoutTeam(this.draft, this.team)));
        on('.se-undo', () => this.undo());
        on('.se-redo', () => this.redo());
        on('.se-new', () => {
            const ok = window.confirm(
                t('editor:newConfirm', { defaultValue: 'Start a new board? Undo brings the current one back.' }),
            );
            if (ok) this.commit(newDraft(this.host.gameVersion));
        });
        on('.se-test', () => {
            carried = { history: this.history, tool: this.tool, team: this.team, placeTypeId: this.placeTypeId };
            this.host.autosave(this.draft);
            this.host.test(this.draft);
        });
        on('.se-download', (el) => {
            (el as HTMLButtonElement).disabled = true;
            void this.host
                .download(this.draft)
                .then((status) => this.flash(status))
                .catch((e: unknown) => this.flash(e instanceof Error ? e.message : String(e)))
                .finally(() => ((el as HTMLButtonElement).disabled = false));
        });
        on('.se-exit', () => this.host.exit());

        const name = this.root.querySelector<HTMLInputElement>('.se-name');
        name?.addEventListener('change', () => {
            const value = name.value.trim();
            if (!value || value === this.draft.name) return;
            const next = structuredClone(this.draft);
            next.name = value;
            this.commit(next);
        });
        const map = this.root.querySelector<HTMLSelectElement>('.se-map');
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
            this.commit(def);
        });
        for (const box of this.root.querySelectorAll<HTMLInputElement>('.se-base')) {
            box.addEventListener('change', () => {
                const side = box.dataset.side as 'player' | 'enemy';
                this.commit(withBaseBuildings(this.host.types, this.draft, side, box.checked));
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
}

/** The strip over a test battle: back to the editor any time, the result at the end. */
export class TestBattleBar {
    private readonly root: HTMLDivElement;

    constructor(
        wrapper: HTMLElement,
        private readonly cb: { onBack(): void; onAgain(): void },
    ) {
        this.root = document.createElement('div');
        this.root.className = 'mechili-test-battle';
        this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.root.innerHTML =
            `<div class="tb-row"><span class="tb-title">${t('editor:testBattle', { defaultValue: 'Test battle' })}</span>` +
            `<button type="button" class="tb-again">${t('editor:runAgain', { defaultValue: 'Run again' })}</button>` +
            `<button type="button" class="tb-back">${t('editor:backToEditor', { defaultValue: 'Back to editor' })}</button></div>` +
            `<div class="tb-result"></div>`;
        this.root.querySelector('.tb-back')!.addEventListener('click', () => cb.onBack());
        this.root.querySelector('.tb-again')!.addEventListener('click', () => cb.onAgain());
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
            return `<div class="tb-side" style="--se-team:${colorForBattleTeam(team).css}"><b>${label}</b> ${p.standing}/${p.total} packs · ${m.alive}/${m.total} units</div>`;
        };
        el.innerHTML =
            `<div class="tb-headline">${headline} · ${summary.seconds.toFixed(1)}s</div>` +
            line('player', t('editor:teamPlayer', { defaultValue: 'Player' })) +
            line('enemy', t('editor:teamEnemy', { defaultValue: 'Enemy' })) +
            line('horde', t('editor:teamHorde', { defaultValue: 'Horde' }));
        this.root.classList.add('done');
    }

    remove(): void {
        this.root.remove();
    }
}
