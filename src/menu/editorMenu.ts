/**
 * The scenario editor from the menu's side: opening it (a new board, the
 * autosaved draft, a saved scenario), and what happens to a draft — saved as
 * a package, put into one, played, downloaded, shared as a code. The match
 * side of editing is game/scenario/editorSession.ts; this is its
 * {@link EditorLinks}.
 *
 * main.ts owns the match lifecycle; it hands that in once ({@link initEditorMenu}).
 */
import { isScenarioTerrainFile, type OverlayFile } from '../game/assets';
import { writeZip } from '../game/content/zip';
import {
    activeLevel,
    activeLevelRef,
    ensureLevel,
    forgetLevel,
    levelFiles,
    loadLevel,
    prepareLevel,
    scenarioLevels,
    supersedeLevel,
    type LevelRef,
} from '../game/level';
import { loadStoredDraft, newDraft } from '../game/scenario/editorDraft';
import type { EditorLinks } from '../game/scenario/editorSession';
import { packageScenarioIds, scenarioPackageFiles, scenarioSlug, withScenarioInPackage } from '../game/scenario/package';
import type { ScenarioDef } from '../game/scenario/scenarioDef';
import { applyScenarioToSettings } from '../game/scenario/scenarioSettings';
import { decodeTerrainText, draftTerrainText, packagedTerrain, setDraftTerrain } from '../game/scenario/scenarioTerrain';
import { encodeShareCode } from '../game/scenario/shareCode';
import type { GameSettings } from '../game/settings';

export interface EditorMenuDeps {
    /** start a match from these settings */
    startGame(settings: GameSettings): void;
    /** a match is running (it is torn down before the next starts) */
    hasActiveGame(): boolean;
    teardown(): Promise<void>;
    /** the settings a local match starts from */
    localMatchSettings(): GameSettings;
    /** when the match that starts next ends, land in the editor again (Play from the editor) */
    returnToEditorAfterMatch(): void;
    /** the menu's top level (before a match starts from a sub-panel) */
    showMainMenu(): void;
    /** zip downloads are offered (web builds) */
    readonly zipDownloads: boolean;
}

let deps: EditorMenuDeps | null = null;

export function initEditorMenu(d: EditorMenuDeps): void {
    deps = d;
}

function need(): EditorMenuDeps {
    if (!deps) throw new Error('[editor] initEditorMenu was not called');
    return deps;
}

/** What an editor match does with its draft — made on `level`. */
export function editorLinks(level: LevelRef | undefined): EditorLinks {
    return {
        open: (mode, draft) => void openScenarioEditor(mode, draft, level),
        save: (draft) => saveScenarioDraft(draft, level),
        saveInto: (draft, packageName) => saveScenarioIntoLevel(draft, level, packageName),
        play: (draft) => void playScenarioDraft(draft, level),
        shareCode: (draft) => {
            const { id, files } = scenarioDraftPackage(draft, level);
            return copyShareCode(id, files);
        },
        download: need().zipDownloads ? (draft) => downloadScenarioDraft(draft, level) : null,
    };
}

// ---- opening the editor

/**
 * Start editing a draft, or its test battle — from the menu, or from the
 * editor / test match that is running (which is torn down first). The draft
 * terrain is whatever the caller set.
 */
export async function openScenarioEditor(mode: 'author' | 'test', draft: ScenarioDef, level: LevelRef | undefined): Promise<void> {
    const d = need();
    if (d.hasActiveGame()) await d.teardown();
    d.startGame(applyScenarioToSettings(d.localMatchSettings(), draft, level, mode));
}

/** a new board: the generated terrain, the base game */
export function openNewScenarioEditor(gameVersion: string, types: Parameters<typeof newDraft>[1]): void {
    setDraftTerrain(null);
    void openScenarioEditor('author', newDraft(gameVersion, types), undefined);
}

/**
 * Single Player → Editor: the last draft (autosaved) on the level it was made
 * on when that level is still here, else on the active one (web testing may
 * have a zip level selected), else the base game.
 */
export function openStoredScenarioEditor(gameVersion: string): void {
    const stored = loadStoredDraft();
    const draft = stored?.def ?? newDraft(gameVersion, activeLevel().types);
    let terrain = null;
    try {
        terrain = stored?.terrain ? decodeTerrainText(stored.terrain) : null;
    } catch (e) {
        console.warn('[editor] the autosaved terrain does not load — starting from the generated terrain', e);
    }
    setDraftTerrain(terrain, terrain ? stored!.terrain! : null);
    const wanted = stored?.level;
    void (async () => {
        // a package saved again since has a new hash under the same id
        const newer = async (ref: LevelRef) => (await scenarioLevels()).find((l) => l.ref.id === ref.id)?.ref;
        const level = !stored
            ? activeLevelRef()
            : wanted && (await ensureLevel(wanted).catch(() => false))
              ? wanted
              : wanted
                ? ((await newer(wanted)) ?? activeLevelRef())
                : undefined;
        await openScenarioEditor('author', draft, level);
    })();
}

/** a saved package's scenario, made active and checked — null (and said why) when it can't be played */
export async function savedScenarioDef(ref: LevelRef, id: string): Promise<ScenarioDef | null> {
    await prepareLevel(ref);
    const scenario = activeLevel().scenarios.get(id);
    const errors = scenario?.issues.filter((i) => i.level === 'error') ?? [];
    if (!scenario?.def || errors.length > 0) {
        window.alert(`This scenario can't be played:\n${errors.map((i) => `• ${i.message}`).join('\n') || 'not found'}`);
        return null;
    }
    return scenario.def;
}

/** edit a saved scenario — its terrain comes along */
export async function editSavedScenario(ref: LevelRef, id: string): Promise<void> {
    const def = await savedScenarioDef(ref, id).catch(() => null);
    if (!def) return;
    need().showMainMenu();
    // savedScenarioDef made the package active
    setDraftTerrain(packagedTerrain(id));
    // the scenario keeps its id in the package, so "Save into package" replaces it
    await openScenarioEditor('author', { ...def, id }, ref);
}

// ---- a draft as a package

/** the draft as a one-level package: named after the draft, with the content of the level it was made on and its terrain */
function scenarioDraftPackage(draft: ScenarioDef, level: LevelRef | undefined): { id: string; files: OverlayFile[] } {
    const id = scenarioSlug(draft.name, draft.id);
    const def = { ...draft, id, updatedAt: new Date().toISOString() };
    return { id, files: scenarioPackageFiles(def, level ? (levelFiles(level.hash) ?? []) : [], draftTerrainText()) };
}

/**
 * "Save into package": the draft goes into the package the board is made on.
 * The updated package replaces the old one (cache and list), and the editor
 * reopens on it so the next save builds on this one.
 */
async function saveScenarioIntoLevel(
    draft: ScenarioDef,
    level: LevelRef | undefined,
    packageName?: string,
): Promise<{ status: string; id: string; reopen: ((def: ScenarioDef) => void) | null }> {
    if (!level || !(await ensureLevel(level))) throw new Error('the package this board is made on is not available');
    const files = levelFiles(level.hash);
    if (!files) throw new Error('the package this board is made on is not available');
    const { files: merged, id } = withScenarioInPackage(
        files,
        { ...draft, updatedAt: new Date().toISOString() },
        level.id,
        packageName,
        draftTerrainText(),
    );
    const { ref } = await loadLevel(level.id, merged);
    if (ref.hash === level.hash) return { status: 'Nothing changed', id, reopen: null };
    await forgetLevel(level);
    const replaced = packageScenarioIds(files).includes(id);
    return {
        status: replaced ? `Saved into “${level.id}”` : `Added to “${level.id}” as the next level`,
        id,
        reopen: (def) => void openScenarioEditor('author', def, ref),
    };
}

/** a package as a share code on the clipboard; resolves to a status line */
export async function copyShareCode(id: string, files: readonly OverlayFile[]): Promise<string> {
    const { code, skipped } = await encodeShareCode(id, files);
    try {
        await navigator.clipboard.writeText(code);
    } catch {
        console.info('[scenario] share code:', code);
        return 'Could not reach the clipboard — the code is in the console';
    }
    const terrain = skipped.some((p) => isScenarioTerrainFile(p));
    const media = skipped.filter((p) => !isScenarioTerrainFile(p)).length;
    const note =
        (terrain ? ' (without the terrain — too big for a code, share a zip for it)' : '') +
        (media > 0 ? ` (without ${media} model/texture files)` : '');
    return `Code copied — ${Math.ceil(code.length / 1024)} KB${note}`;
}

/** keep the draft as a scenario package (scenario cache, like a saved replay situation) */
async function saveScenarioDraft(draft: ScenarioDef, level: LevelRef | undefined): Promise<string> {
    const { id, files } = scenarioDraftPackage(draft, level);
    const { ref } = await loadLevel(id, files);
    const replaced = await supersedeLevel(ref);
    console.info(`[scenario] saved "${ref.id}" (${ref.hash.slice(0, 12)})`);
    return `${replaced > 0 ? 'Replaced' : 'Saved'} “${ref.id}” — find it under Single Player → Editor`;
}

/** the editor's Play: keep the draft as a package, then play it as a single-player scenario */
async function playScenarioDraft(draft: ScenarioDef, level: LevelRef | undefined): Promise<void> {
    const d = need();
    const { id, files } = scenarioDraftPackage(draft, level);
    const { ref } = await loadLevel(id, files);
    await supersedeLevel(ref);
    const def = { ...draft, id };
    d.returnToEditorAfterMatch();
    if (d.hasActiveGame()) await d.teardown();
    d.startGame(applyScenarioToSettings(d.localMatchSettings(), def, ref, 'play', id));
}

/** web: the draft as a one-level package zip */
async function downloadScenarioDraft(draft: ScenarioDef, level: LevelRef | undefined): Promise<string> {
    const { id, files } = scenarioDraftPackage(draft, level);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([writeZip(files)], { type: 'application/zip' }));
    link.download = `${id}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    return `Downloaded ${id}.zip`;
}
