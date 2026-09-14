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
    META_FILE,
    SCENARIO_FILE,
    SCENARIOS_DIR,
    switchAssetOverlay,
    type AssetOverlay,
    type OverlayFile,
    type OverlayReport,
} from './assets';
import { BASE_PACK, loadPackWithOverlay } from './content/basePack';
import { cacheLevel, cachedLevel, deleteCachedLevel, listCachedLevels } from './levelCache';
import { parseJsonc } from './content/jsonc';
import { parseMeta, parseScenario, type NormalizedMeta, type NormalizedScenario } from './scenario/normalize';
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
    /** the package's scenarios by id, each normalized against `types` (empty for plain content) */
    scenarios: ReadonlyMap<string, NormalizedScenario>;
    /** the package's `meta.jsonc`, if any */
    meta: NormalizedMeta | null;
}

let active: ActiveLevel = { overlay: null, types: BASE_TYPES, scenarios: new Map(), meta: null };
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
    return new Set(['data', 'scenarios', ...baseAssetPaths().map((p) => p.split('/')[0]!)]);
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

/** levels loaded this session, by content hash — with their files, to hand to peers */
const known = new Map<string, AssetOverlay>();
const knownFiles = new Map<string, readonly OverlayFile[]>();
/** packages the player deleted or replaced — still loadable while in use, no longer listed */
const forgotten = new Set<string>();

/** The files of a level loaded this session (for sending it to a peer), or null. */
export function levelFiles(hash: string): readonly OverlayFile[] | null {
    return knownFiles.get(hash) ?? null;
}

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
    const wasForgotten = forgotten.delete(overlay.hash);
    const existing = known.get(overlay.hash);
    if (existing) {
        disposeAssetOverlay(overlay);
        // saved again after being deleted: keep it again
        if (wasForgotten) void cacheLevel({ id: existing.id, hash: existing.hash }, files);
        return { ref: { id: existing.id, hash: existing.hash }, report: existing.report };
    }
    try {
        const { replaced, added } = overlay.report;
        const definesPlay = overlay.scenarioTexts.size > 0 || overlay.metaText !== null;
        if (replaced.length === 0 && !definesPlay && !added.some((p) => p.startsWith('data/'))) {
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
    knownFiles.set(overlay.hash, [...files]);
    void cacheLevel({ id: overlay.id, hash: overlay.hash }, files);
    return { ref: { id: overlay.id, hash: overlay.hash }, report: overlay.report };
}

/** Every level loaded this session. */
export function knownLevels(): LevelRef[] {
    return [...known.values()].map((o) => ({ id: o.id, hash: o.hash }));
}

/**
 * Make sure `ref` is known this session: already loaded, or restored from the
 * scenario cache (a previous session loaded or received it). False when this
 * client has never had that content.
 */
export async function ensureLevel(ref: LevelRef | undefined): Promise<boolean> {
    if (ref === undefined || known.has(ref.hash)) return true;
    const cached = await cachedLevel(ref.hash);
    if (!cached) return false;
    try {
        const { ref: loaded } = await loadLevel(cached.id, cached.files);
        return loaded.hash === ref.hash;
    } catch (e) {
        console.warn(`[level] cached scenario "${ref.id}" no longer loads`, e);
        return false;
    }
}

/** Can a match naming `ref` start right now without loading anything (undefined = base game, always)? */
export function isLevelAvailable(ref: LevelRef | undefined): boolean {
    return ref === undefined || known.has(ref.hash);
}

/** Is `ref` exactly the level that is active (undefined = the base game)? */
export function isLevelActive(ref: LevelRef | undefined): boolean {
    return (active.overlay?.hash ?? undefined) === ref?.hash;
}

/**
 * Make the level a match names active (undefined = base game) and wait for
 * its files to load — from the scenario cache if this session hasn't loaded
 * it. Throws when this client doesn't have that content.
 */
export async function prepareLevel(ref: LevelRef | undefined): Promise<ActiveLevel> {
    if (ref === undefined) return switchLevel(null);
    await ensureLevel(ref);
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
        const scenarios = new Map(
            [...(overlay?.scenarioTexts ?? [])].map(([id, text]) => [id, parseScenario(text, types, `scenarios/${id}.jsonc`)] as const),
        );
        const meta = overlay?.metaText != null ? parseMeta(overlay.metaText, new Set(scenarios.keys()), types) : null;
        setModelSpecData(pack.models);
        setModelTypes(types.all());
        setProceduralModelHeights(proceduralHeightsOf(types));
        await switchAssetOverlay(overlay);
        active = { overlay, types, scenarios, meta };
        return active;
    });
    queue = run.catch(() => {});
    return run;
}

/** A level package as a list shows it — names only, nothing validated or loaded. */
export interface LevelSummary {
    ref: LevelRef;
    /** meta.jsonc's name, else the package id */
    name: string;
    /** in meta.jsonc's order when it has one */
    scenarios: { id: string; name: string }[];
}

function nameIn(text: string, file: string): string | null {
    try {
        const raw = parseJsonc(text, file) as { name?: unknown };
        return typeof raw?.name === 'string' ? raw.name : null;
    } catch {
        return null;
    }
}

/** What a package's files say about its scenarios (no registry, no validation). */
export function summarizeLevel(ref: LevelRef, files: readonly OverlayFile[]): LevelSummary {
    const decoder = new TextDecoder();
    const scenarios: { id: string; name: string }[] = [];
    let name = ref.id;
    let order: string[] = [];
    for (const f of files) {
        const text = () => decoder.decode(f.bytes);
        if (f.path === META_FILE) {
            const t = text();
            name = nameIn(t, f.path) ?? name;
            try {
                const levels = (parseJsonc(t, f.path) as { levels?: { scenario?: unknown }[] })?.levels;
                order = Array.isArray(levels) ? levels.map((l) => String(l?.scenario)) : [];
            } catch {
                order = [];
            }
        } else if (f.path === SCENARIO_FILE) {
            scenarios.push({ id: 'scenario', name: nameIn(text(), f.path) ?? ref.id });
        } else if (f.path.startsWith(SCENARIOS_DIR) && f.path.endsWith('.jsonc')) {
            const id = f.path.slice(SCENARIOS_DIR.length, -'.jsonc'.length);
            scenarios.push({ id, name: nameIn(text(), f.path) ?? id });
        }
    }
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    scenarios.sort((a, b) => rank(a.id) - rank(b.id));
    return { ref, name, scenarios };
}

/** Every package with scenarios this client has — loaded this session or kept from earlier ones. */
export async function scenarioLevels(): Promise<LevelSummary[]> {
    const out = new Map<string, LevelSummary>();
    for (const ref of knownLevels()) {
        if (forgotten.has(ref.hash)) continue;
        const summary = summarizeLevel(ref, knownFiles.get(ref.hash) ?? []);
        if (summary.scenarios.length > 0) out.set(ref.hash, summary);
    }
    for (const { ref, scenario } of await listCachedLevels()) {
        if (out.has(ref.hash) || !scenario || forgotten.has(ref.hash)) continue;
        const cached = await cachedLevel(ref.hash, false);
        if (!cached) continue;
        const summary = summarizeLevel(ref, cached.files);
        if (summary.scenarios.length > 0) out.set(ref.hash, summary);
    }
    return [...out.values()];
}

/**
 * A newly saved package replaces the earlier saves under its id: other
 * packages of that id with at most `maxScenarios` scenarios are forgotten (by
 * default one — a campaign of the same id stays).
 */
export async function supersedeLevel(ref: LevelRef, maxScenarios = 1): Promise<number> {
    let replaced = 0;
    for (const level of await scenarioLevels()) {
        if (level.ref.id !== ref.id || level.ref.hash === ref.hash || level.scenarios.length > maxScenarios) continue;
        await forgetLevel(level.ref);
        replaced++;
    }
    return replaced;
}

/**
 * Forget a package: out of the scenario cache, and out of this session unless
 * it is the level being played.
 */
export async function forgetLevel(ref: LevelRef): Promise<void> {
    await deleteCachedLevel(ref.hash);
    forgotten.add(ref.hash);
    const overlay = known.get(ref.hash);
    if (overlay && active.overlay !== overlay) {
        known.delete(ref.hash);
        knownFiles.delete(ref.hash);
        disposeAssetOverlay(overlay);
    }
}
