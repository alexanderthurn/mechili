/**
 * The one way the game finds a file (plan §17.4–17.5).
 *
 * Every model, texture, font and UI image is requested by its path under
 * `assets/` — `assetUrl('models/scenery/tree-oak.glb')` — instead of a
 * hard-coded `new URL(…)`. The base game's files come from the generated
 * manifest (`assetManifest.ts`, exactly the files that ship).
 *
 * A level can install an **overlay**: a set of files keyed by the same paths.
 * A file at a base path replaces the base file; a new path adds one. Lookups
 * happen when a file is loaded — but much is loaded once at boot and kept
 * (unit models, spells, scenery), so switch overlays with
 * {@link switchAssetOverlay}: it tells every such cache to reload what now
 * resolves to a different file.
 */
import { Cache } from 'three';
import { BASE_ASSET_URLS } from './assetManifest';
import { BASE_DATA_PATHS } from './content/basePack';

// ------------------------------------------------------------------ lookup

let overlay: AssetOverlay | null = null;

/** Built URL of an asset: the active overlay's file when it has one, else the base game's. */
export function assetUrl(path: string): string {
    const replaced = overlay?.urls.get(path);
    if (replaced !== undefined) return replaced;
    const url = BASE_ASSET_URLS.get(path);
    if (url === undefined) {
        throw new Error(
            `[assets] "${path}" is not in the asset manifest — add the file under assets/ and run npm run assets:manifest`,
        );
    }
    return url;
}

/** Is `path` a file the base game ships? */
export function isBaseAsset(path: string): boolean {
    return BASE_ASSET_URLS.has(path);
}

/** Can `path` be loaded right now (base file or overlay file)? */
export function hasAsset(path: string): boolean {
    return BASE_ASSET_URLS.has(path) || (overlay?.urls.has(path) ?? false);
}

/** Every base asset path, sorted. */
export function baseAssetPaths(): string[] {
    return [...BASE_ASSET_URLS.keys()].sort();
}

// ------------------------------------------------------------------ overlays

/** One file of a level folder, by its path relative to that folder. */
export interface OverlayFile {
    /** e.g. `models/scenery/tree-oak.glb` or `data/buildings/stronghold.jsonc` */
    path: string;
    bytes: ArrayBuffer | Uint8Array;
}

export interface OverlayReport {
    /** base files (media or data) this overlay replaces */
    replaced: string[];
    /** files that exist only in the overlay */
    added: string[];
    /**
     * Added media files nothing refers to: not a base path, and not named by any
     * data file's `"file"` — usually a typo or a base file that was renamed.
     */
    unreferenced: string[];
    /** paths that can't be files of a level (absolute, `..`, backslashes) */
    invalid: string[];
}

export interface AssetOverlay {
    id: string;
    /** SHA-256 over the overlay's files (text normalized to LF) */
    hash: string;
    urls: ReadonlyMap<string, string>;
    /** data files (`data/**.jsonc`) as text, for the level's definition loader */
    dataFiles: ReadonlyMap<string, string>;
    report: OverlayReport;
}

const TEXT_FILE = /\.(jsonc?|txt|csv|svg)$/i;

/** a copy on a plain ArrayBuffer — Blob and digest won't take SharedArrayBuffer views */
function toBytes(b: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
    return b instanceof Uint8Array ? new Uint8Array(b) : new Uint8Array(b);
}

function normalizedBytes(path: string, bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    if (!TEXT_FILE.test(path)) return bytes;
    const text = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
    return new TextEncoder().encode(text);
}

function hex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build an overlay from a level's files: validate paths, report what it
 * replaces and adds, hash it, and create URLs for its files. Does not install
 * it — see {@link installAssetOverlay}.
 */
export async function buildAssetOverlay(id: string, files: readonly OverlayFile[]): Promise<AssetOverlay> {
    const report: OverlayReport = { replaced: [], added: [], unreferenced: [], invalid: [] };
    const valid = files
        .filter((f) => {
            const ok =
                f.path.length > 0 &&
                !f.path.startsWith('/') &&
                !f.path.includes('\\') &&
                !f.path.split('/').includes('..');
            if (!ok) report.invalid.push(f.path);
            return ok;
        })
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const dataFiles = new Map<string, string>();
    const referenced = new Set<string>();
    for (const f of valid) {
        if (!f.path.startsWith('data/') || !TEXT_FILE.test(f.path)) continue;
        const text = new TextDecoder().decode(toBytes(f.bytes));
        dataFiles.set(f.path, text);
        for (const m of text.matchAll(/"file"\s*:\s*"([^"]+)"/g)) referenced.add(m[1]!);
    }

    const parts: Uint8Array<ArrayBuffer>[] = [];
    const enc = new TextEncoder();
    const urls = new Map<string, string>();
    for (const f of valid) {
        const bytes = toBytes(f.bytes);
        if (BASE_ASSET_URLS.has(f.path) || BASE_DATA_PATHS.has(f.path)) report.replaced.push(f.path);
        else {
            report.added.push(f.path);
            if (!f.path.startsWith('data/') && !referenced.has(f.path)) report.unreferenced.push(f.path);
        }
        parts.push(enc.encode(f.path), new Uint8Array([0]), normalizedBytes(f.path, bytes), new Uint8Array([0]));
        if (!f.path.startsWith('data/')) {
            urls.set(f.path, URL.createObjectURL(new Blob([bytes])));
        }
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        joined.set(p, at);
        at += p.length;
    }
    const hash = hex(await crypto.subtle.digest('SHA-256', joined));
    return { id, hash, urls, dataFiles, report };
}

/**
 * Make `next` the active overlay (replacing and releasing any previous one).
 * Only swaps the lookup — caches keep what they loaded; use
 * {@link switchAssetOverlay} outside of tests.
 */
export function installAssetOverlay(next: AssetOverlay): void {
    if (overlay === next) return;
    clearAssetOverlay();
    overlay = next;
}

/**
 * Back to the base game's files only (lookup only, like {@link installAssetOverlay}).
 * The overlay's file URLs stay valid, so it can be installed again later;
 * {@link disposeAssetOverlay} releases them for good.
 */
export function clearAssetOverlay(): void {
    if (overlay) {
        // three's file cache is keyed by URL — drop the bytes, the blob can be read again
        for (const url of overlay.urls.values()) Cache.remove(url);
    }
    overlay = null;
}

/** Release an overlay that will never be installed again (it must not be the active one). */
export function disposeAssetOverlay(dead: AssetOverlay): void {
    if (dead === overlay) throw new Error('[assets] cannot dispose the active overlay');
    for (const url of dead.urls.values()) {
        Cache.remove(url);
        URL.revokeObjectURL(url);
    }
}

// ------------------------------------------------------------------ reloading

/**
 * Called after the overlay switched. A cache that keeps loaded files compares
 * the URL (or data) it loaded from with what resolves now and reloads the
 * entries that differ — and waits for its own in-flight loads first, so a load
 * that started before the switch is checked too.
 */
export type AssetReloadHook = () => void | Promise<void>;

const reloadHooks: { name: string; hook: AssetReloadHook }[] = [];
let switching: Promise<void> = Promise.resolve();

/** Register a cache's reload hook (module scope, once). */
export function onAssetOverlaySwitch(name: string, hook: AssetReloadHook): void {
    reloadHooks.push({ name, hook });
}

/**
 * Switch to `next` (null = base game) and bring every registered cache up to
 * date. Resolves when the reloads are done — call it before building a match.
 * Calls are queued, so two quick switches can't interleave.
 */
export function switchAssetOverlay(next: AssetOverlay | null): Promise<void> {
    const run = switching.then(async () => {
        if (overlay === next) return;
        if (next) installAssetOverlay(next);
        else clearAssetOverlay();
        await runAssetReloadHooks();
    });
    switching = run.catch(() => {});
    return run;
}

/** Run every reload hook; a failing cache logs and keeps its fallback. */
async function runAssetReloadHooks(): Promise<void> {
    await Promise.all(
        reloadHooks.map(async ({ name, hook }) => {
            try {
                await hook();
            } catch (e) {
                console.error(`[assets] reloading ${name} after an overlay switch failed`, e);
            }
        }),
    );
}

/** The active overlay, or null for the base game. */
export function activeAssetOverlay(): AssetOverlay | null {
    return overlay;
}
