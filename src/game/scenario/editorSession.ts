/**
 * The scenario editor inside a match — everything the Game would otherwise
 * have to know about editing: the editor window (author mode), the Terrain
 * tool (its brushes and panel), the test-battle strip (test mode), the
 * draft's terrain and its autosave, and the links back to the menu (save,
 * play, share…).
 *
 * The Game creates one for an editor match and hands it what only the match
 * has ({@link EditorSessionHost}): the board, the meshes, the scenery plants.
 * It forwards a handful of calls (undo, End Deployment, a test result, a
 * graphics rebuild) and otherwise doesn't know editing exists.
 *
 * Terrain and the enemy view: while the enemy side is edited the window shows
 * the board turned around (that army at the near edge), so the ground is shown
 * turned too — the draft's terrain itself always stays the right way round.
 */
import type { Camera, Mesh, PerspectiveCamera, Scene } from 'three';
import { t } from '../../i18n';
import type { LevelRef } from '../level';
import { rotateLandscape180, type LandscapeData } from '../landscape';
import type { AuthoredPlant, PlantClearDisk } from '../landscapePlants';
import { CELL, type BattleMap } from '../map';
import { SLOPE_BLOCK_GRADE } from '../terrainCombat';
import { TerrainBrushes, type TerrainHistory } from '../terrainBrushes';
import type { VegetationKind } from '../sceneryVegetation';
import type { Unit } from '../units';
import { ScenarioEditor, TestBattleBar, type EditorTerrain, type ScenarioEditorHost, type TestBattleSummary } from '../../ui/scenarioEditor';
import { TerrainPanel } from '../../ui/terrainPanel';
import { storeDraft } from './editorDraft';
import type { ScenarioIssue } from './normalize';
import type { ScenarioDef } from './scenarioDef';
import { draftTerrain, draftTerrainSnapshot, setDraftTerrain } from './scenarioTerrain';

/** What the menu does with a draft — main wires these to its save / play flows. */
export interface EditorLinks {
    /** a new match: the editor again ('author'), or a test battle of the draft */
    open(mode: 'author' | 'test', draft: ScenarioDef): void;
    save(draft: ScenarioDef): Promise<string>;
    saveInto(
        draft: ScenarioDef,
        packageName?: string,
    ): Promise<{ status: string; id: string; reopen: ((def: ScenarioDef) => void) | null }>;
    play(draft: ScenarioDef): void;
    shareCode(draft: ScenarioDef): Promise<string>;
    /** web builds: the draft as a zip; null where there is no download */
    download: ((draft: ScenarioDef) => Promise<string>) | null;
}

/** the board parts of the editor window that only the match can do */
export type EditorBoard = Pick<
    ScenarioEditorHost,
    | 'types'
    | 'placement'
    | 'surface'
    | 'wrapper'
    | 'maxUnitLevel'
    | 'maxBuildingLevel'
    | 'prices'
    | 'levelLabel'
    | 'gameVersion'
    | 'unitIcon'
    | 'rebuild'
    | 'capture'
    | 'issues'
    | 'packageName'
>;

export interface EditorSessionHost {
    readonly mode: 'author' | 'test';
    /** the draft this match was started with */
    readonly draft: ScenarioDef;
    /** the level the draft is made on (autosaved with it) */
    readonly level: LevelRef | undefined;
    readonly board: EditorBoard;
    /** the menu's side of things — read when used (main wires them after the match exists) */
    links(): EditorLinks | null;
    quit(): void;
    /** a test battle straight to its result */
    skipTest(): void;
    // ---- the Terrain tool (author mode)
    readonly scene: Scene;
    readonly camera: PerspectiveCamera & Camera;
    readonly map: BattleMap;
    /** the outer ground and the board mesh (null outer: no Terrain tool) */
    meshes(): { outer: Mesh | null; ground: Mesh };
    readonly plants: {
        getPlants: () => AuthoredPlant[];
        getClears: () => PlantClearDisk[];
        paint: (kind: VegetationKind, x: number, z: number, sc: number, yaw: number) => void;
        erase: (x: number, z: number, radius: number) => void;
        setAll: (plants: AuthoredPlant[], clears: PlantClearDisk[]) => void;
    };
    /** the ground changed: rebind sim heights, the deploy grid, what stands on it */
    landscapeChanged(): void;
    /** the board height at a world point, as the sim reads it */
    heightAt(x: number, z: number): number;
}

export class EditorSession {
    private readonly editor: ScenarioEditor | null = null;
    private readonly testBar: TestBattleBar | null = null;
    private readonly brushes: TerrainBrushes | null = null;
    private readonly panel: TerrainPanel | null = null;
    /** which side the meshes show near: 'enemy' = the ground is turned (the window builds the enemy) */
    private view: 'player' | 'enemy' = 'player';

    constructor(private readonly host: EditorSessionHost) {
        const draft = host.draft;
        if (host.mode === 'test') {
            this.testBar = new TestBattleBar(
                host.board.wrapper,
                {
                    onBack: () => host.links()?.open('author', draft),
                    onAgain: () => host.links()?.open('test', draft),
                    onSkip: () => host.skipTest(),
                },
                JSON.stringify(draft.scene) + JSON.stringify(draft.rules),
            );
            return;
        }
        const { outer, ground } = host.meshes();
        if (outer) {
            this.brushes = new TerrainBrushes({
                mesh: outer,
                boardMesh: ground,
                scene: host.scene,
                camera: host.camera,
                domElement: host.board.surface,
                map: host.map,
                name: () => this.editor?.draftName ?? draft.name,
                fromGenerated: draftTerrain() === null,
                onLandscapeChanged: () => host.landscapeChanged(),
                onEdited: (kind) => this.terrainEdited(kind),
                onHistoryCleared: () => this.editor?.terrainHistoryCleared(),
                onSettingsChanged: () => this.panel?.sync(),
                // sculpting takes the board's clicks: drop whatever the match's controls were carrying
                onActiveChange: (active) => {
                    if (active) host.board.placement.deselect();
                },
                plants: host.plants,
            });
            this.panel = new TerrainPanel(
                this.brushes,
                {
                    generated: () => this.resetGenerated(),
                    capture: () => this.canonicalTerrain(),
                    load: (data) => this.loadTerrain(data),
                },
                () => this.editor?.draftName ?? draft.name,
            );
        }
        const links = () => host.links();
        this.editor = new ScenarioEditor(
            {
                ...host.board,
                issues: (def) => [...host.board.issues(def), ...this.steepIssues()],
                canDownload: () => !!links()?.download,
                save: (def) => links()?.save(def) ?? Promise.resolve(''),
                saveInto: (def, packageName) => links()?.saveInto(def, packageName) ?? Promise.resolve({ status: '', id: def.id, reopen: null }),
                shareCode: (def) => links()?.shareCode(def) ?? Promise.resolve(''),
                download: (def) => links()?.download?.(def) ?? Promise.resolve(''),
                autosave: (def) => storeDraft(def, host.level, draftTerrainSnapshot()),
                restart: (def) => links()?.open('author', def),
                test: (def) => links()?.open('test', def),
                play: (def) => links()?.play(def),
                exit: () => host.quit(),
                terrain: this.brushes ? this.terrainTool() : null,
            },
            draft,
        );
    }

    dispose(): void {
        this.editor?.destroy();
        this.testBar?.remove();
        this.brushes?.dispose();
        this.panel?.el.remove();
    }

    // ---- what the Game forwards

    /** the Terrain tool owns the board's clicks right now */
    get terrainActive(): boolean {
        return !!this.brushes?.active;
    }

    /** author mode: End Deployment runs the test battle */
    startTest(): boolean {
        if (!this.editor) return false;
        this.editor.startTest();
        return true;
    }

    /** author mode: the HUD's Undo */
    undo(): boolean {
        if (!this.editor) return false;
        this.editor.undo();
        return true;
    }

    get canUndo(): boolean {
        return this.editor?.canUndo ?? false;
    }

    /** the normal game UI changed the board: read it back into the draft */
    syncFromBoard(): void {
        this.editor?.syncFromBoard();
    }

    /** test mode: the battle ended */
    showTestResult(summary: TestBattleSummary): void {
        this.testBar?.showResult(summary);
    }

    /** the ground as the meshes show it now — a graphics rebuild builds the new meshes from it */
    shownTerrain(): LandscapeData | null {
        return this.brushes?.capture() ?? null;
    }

    /** a graphics rebuild made new meshes */
    reattach(outer: Mesh, ground: Mesh): void {
        this.brushes?.reattach(outer, ground);
    }

    // ---- terrain

    /** the terrain as the draft means it: the meshes' ground, turned back when the enemy view shows it turned */
    private canonicalTerrain(): LandscapeData | null {
        const shown = this.brushes?.capture() ?? null;
        return shown && this.view === 'enemy' ? rotateLandscape180(shown) : shown;
    }

    /** a stroke, a loaded file or an undo changed the ground: that is the draft's terrain now */
    private terrainEdited(kind: 'edit' | 'history'): void {
        const brushes = this.brushes!;
        // undone all the way back to the generated terrain: no sculpted terrain again
        if (brushes.atGenerated) setDraftTerrain(null);
        else {
            const data = this.canonicalTerrain();
            if (data) setDraftTerrain(data);
        }
        this.editor?.terrainEdited(kind);
    }

    private loadTerrain(data: LandscapeData): string | null {
        const shown = this.view === 'enemy' ? rotateLandscape180(data) : data;
        if (this.brushes?.show(shown, true)) return null;
        return t('editor:terrainWrongSize', {
            defaultValue: 'This terrain is made for a {{cols}}×{{rows}} board — this one is {{boardCols}}×{{boardRows}}',
            cols: data.map.cols,
            rows: data.map.rows,
            boardCols: this.host.map.cols,
            boardRows: this.host.map.rows,
        });
    }

    /** "Generated terrain": the draft goes back to the board's own terrain (a restart builds it) */
    private resetGenerated(): void {
        if (!draftTerrain() && !this.brushes?.canUndo) return;
        const ok = window.confirm(t('editor:terrainGeneratedConfirm', { defaultValue: 'Throw the sculpted terrain away? This can’t be undone.' }));
        if (!ok) return;
        setDraftTerrain(null);
        // the strokes were made on the terrain that is gone — none of them carries over
        this.brushes?.clearHistory(true);
        this.editor?.restartForTerrain();
    }

    /**
     * Show the ground with `side` at the near edge, as the window shows the
     * armies. Turning the meshes starts a new terrain history: the old strokes
     * were recorded the other way round.
     */
    private setView(side: 'player' | 'enemy'): void {
        const brushes = this.brushes;
        if (!brushes || side === this.view) return;
        const shown = brushes.capture();
        if (!shown) return;
        brushes.show(rotateLandscape180(shown), false);
        brushes.clearHistory(draftTerrain() === null);
        this.view = side;
    }

    /** the window's narrow handle on the Terrain tool */
    private terrainTool(): EditorTerrain {
        const brushes = this.brushes!;
        const panel = this.panel!;
        return {
            panel: panel.el,
            setEditing: (on) => brushes.setEditing(on),
            get busy() {
                return brushes.busy;
            },
            get canUndo() {
                return brushes.canUndo;
            },
            undo: () => brushes.undo(),
            redo: () => brushes.redo(),
            exportHistory: () => brushes.exportHistory(),
            importHistory: (history) => brushes.importHistory(history as TerrainHistory),
            setView: (side) => this.setView(side),
            get sculpted() {
                return draftTerrain() !== null;
            },
            drop: () => {
                setDraftTerrain(null);
                brushes.clearHistory(true);
            },
        };
    }

    // ---- steep ground

    /**
     * Packs and buildings standing on ground too steep to walk up — after
     * sculpting, a unit can end up on a cliff. Warnings, not errors: it may be
     * meant (a keep on a crag).
     */
    private steepIssues(): ScenarioIssue[] {
        const steep: string[] = [];
        for (const unit of this.host.board.placement.allUnits()) {
            if (unit.team === 'horde' || unit.gridless || unit.pinnedY !== null || unit.type.fixture) continue;
            if (this.onSteepGround(unit)) steep.push(unit.type.name);
        }
        if (steep.length === 0) return [];
        const names = [...new Set(steep)].join(', ');
        return [
            {
                level: 'warning',
                message: t('editor:steepUnits', {
                    defaultValue: '{{n}} on ground too steep to walk up: {{names}}',
                    n: steep.length,
                    names,
                }),
            } as ScenarioIssue,
        ];
    }

    /** the ground under a unit's footprint rises more than a walkable grade anywhere */
    private onSteepGround(unit: Unit): boolean {
        const fp = unit.rotated ? { cols: unit.type.footprint.rows, rows: unit.type.footprint.cols } : unit.type.footprint;
        const x0 = unit.world.x - (fp.cols * CELL) / 2;
        const z0 = unit.world.z - (fp.rows * CELL) / 2;
        const h = (i: number, j: number) => this.host.heightAt(x0 + i * CELL, z0 + j * CELL);
        for (let j = 0; j <= fp.rows; j++) {
            for (let i = 0; i <= fp.cols; i++) {
                const here = h(i, j);
                if (i < fp.cols && Math.abs(h(i + 1, j) - here) / CELL >= SLOPE_BLOCK_GRADE) return true;
                if (j < fp.rows && Math.abs(h(i, j + 1) - here) / CELL >= SLOPE_BLOCK_GRADE) return true;
            }
        }
        return false;
    }
}
