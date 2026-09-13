/**
 * Switching the files and definitions the game plays with (plan §17.6–17.8).
 *
 * `switchLevel(overlay)` is the one entry point: it validates the level's data
 * before anything changes, points model data, structure flags and procedural
 * heights at the level's types, installs its files and waits until every
 * cache that loaded a replaced file (unit models, rigged units, spells,
 * commanders, scenery, projectiles) has reloaded. `switchLevel(null)` goes back
 * to the base game.
 *
 * Call it between matches, never while one runs: replaced templates are
 * disposed. The Game takes its registry from {@link activeLevel} and checks it
 * against `settings.level`.
 *
 * Where a level comes from is not the player's business: {@link loadLevel}
 * takes a level's files from any source (a zip in web testing today; a
 * scenario list, a campaign or a host sending it later) and remembers it by
 * content hash. A match names the level it plays in its settings
 * ({@link LevelRef}), and {@link prepareLevel} makes exactly that level active
 * before the match is built.
 */
import {
    baseAssetPaths,
    buildAssetOverlay,
    disposeAssetOverlay,
    switchAssetOverlay,
    type AssetOverlay,
    type OverlayFile,
    type OverlayReport,
} from './assets';
import { BASE_PACK, loadPackWithOverlay } from './content/basePack';
import { TypeRegistry } from './content/typeRegistry';
import { BASE_TYPES, proceduralHeightsOf } from './units';
import { setModelSpecData, setModelTypes, setProceduralModelHeights } from './unitModels';

/**
 * The level a match plays, as it travels in `GameSettings`, saves and replays.
 * The hash identifies the exact content; the id is for people.
 */
export interface LevelRef {
    id: string;
    hash: string;
}

export interface ActiveLevel {
    /** null = the base game */
    overlay: AssetOverlay | null;
    types: TypeRegistry;
}

let active: ActiveLevel = { overlay: null, types: BASE_TYPES };
let queue: Promise<unknown> = Promise.resolve();

/** The level whose files and model data are loaded right now. */
export function activeLevel(): ActiveLevel {
    return active;
}

/** The active level as a match setting — undefined for the base game. */
export function activeLevelRef(): LevelRef | undefined {
    const overlay = active.overlay;
    return overlay ? { id: overlay.id, hash: overlay.hash } : undefined;
}

// ------------------------------------------------------------------ known levels

/** top folders a level's files live in: `data` and every folder of the base asset tree */
function levelRootFolders(): Set<string> {
    return new Set(['data', ...baseAssetPaths().map((p) => p.split('/')[0]!)]);
}

/**
 * An archive's files as a level's files. A level may be archived flat
 * (`data/…`, `models/…`) or as its folder (`frost-keep/data/…`): when every
 * file sits under one folder that is not itself a level folder, that wrapper
 * is removed.
 */
export function levelFilesFromArchive(files: readonly OverlayFile[]): OverlayFile[] {
    const tops = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0]! : '')));
    const [only] = tops;
    if (tops.size !== 1 || !only || levelRootFolders().has(only)) return [...files];
    return files.map((f) => ({ path: f.path.slice(only.length + 1), bytes: f.bytes }));
}

/** levels loaded this session, by content hash */
const known = new Map<string, AssetOverlay>();

/**
 * Take a level's files (from any source), validate its data and remember it.
 * Throws on invalid data — nothing is remembered then. Loading the same
 * content twice returns the level already known.
 */
export async function loadLevel(
    id: string,
    files: readonly OverlayFile[],
): Promise<{ ref: LevelRef; report: OverlayReport }> {
    const overlay = await buildAssetOverlay(id, files);
    const existing = known.get(overlay.hash);
    if (existing) {
        disposeAssetOverlay(overlay);
        return { ref: { id: existing.id, hash: existing.hash }, report: existing.report };
    }
    try {
        const { replaced, added } = overlay.report;
        if (replaced.length === 0 && !added.some((p) => p.startsWith('data/'))) {
            throw new Error(
                `[level] "${id}" changes nothing — expected files like data/units/dwarf.jsonc or ` +
                    `models/units/dwarf.glb, got: ${added.slice(0, 5).join(', ') || '(no files)'}`,
            );
        }
        loadPackWithOverlay(overlay.dataFiles, id);
    } catch (e) {
        disposeAssetOverlay(overlay);
        throw e;
    }
    known.set(overlay.hash, overlay);
    return { ref: { id: overlay.id, hash: overlay.hash }, report: overlay.report };
}

/** Every level loaded this session. */
export function knownLevels(): LevelRef[] {
    return [...known.values()].map((o) => ({ id: o.id, hash: o.hash }));
}

/** Can a match naming `ref` start right now (undefined = base game, always)? */
export function isLevelAvailable(ref: LevelRef | undefined): boolean {
    return ref === undefined || known.has(ref.hash);
}

/** Is `ref` exactly the level that is active (undefined = the base game)? */
export function isLevelActive(ref: LevelRef | undefined): boolean {
    return (active.overlay?.hash ?? undefined) === ref?.hash;
}

/**
 * Make the level a match names active (undefined = base game) and wait for
 * its files to load. Throws when that level isn't known this session.
 */
export async function prepareLevel(ref: LevelRef | undefined): Promise<ActiveLevel> {
    if (ref === undefined) return switchLevel(null);
    const overlay = known.get(ref.hash);
    if (!overlay) throw new Error(`[level] scenario "${ref.id}" (${ref.hash.slice(0, 8)}) is not loaded`);
    return switchLevel(overlay);
}

/**
 * Play with `overlay`'s files and data (null = base game). Throws — and
 * changes nothing — when the level's data is invalid. Calls are queued.
 */
export function switchLevel(overlay: AssetOverlay | null): Promise<ActiveLevel> {
    const run = queue.then(async () => {
        if (active.overlay === overlay) return active;
        const pack = overlay ? loadPackWithOverlay(overlay.dataFiles, overlay.id) : BASE_PACK;
        const types = overlay ? new TypeRegistry(pack) : BASE_TYPES;
        setModelSpecData(pack.models);
        setModelTypes(types.all());
        setProceduralModelHeights(proceduralHeightsOf(types));
        await switchAssetOverlay(overlay);
        active = { overlay, types };
        return active;
    });
    queue = run.catch(() => {});
    return run;
}
