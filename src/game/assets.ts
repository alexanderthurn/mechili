/**
 * The one way the game finds a file (plan §17.4).
 *
 * Every model, texture, font and UI image is requested by its path under
 * `assets/` — `assetUrl('models/scenery/tree-oak.glb')` — instead of a
 * hard-coded `new URL(…)`. The base game's files come from the generated
 * manifest (`assetManifest.ts`, exactly the files that ship). A level can
 * later install an overlay that replaces any of them by path; lookups happen
 * when a file is loaded, so an overlay set before a match applies to it.
 */
import { BASE_ASSET_URLS } from './assetManifest';

/** Built URL of a base-game asset, or of its overlay replacement when one is active. */
export function assetUrl(path: string): string {
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

/** Every base asset path, sorted. */
export function baseAssetPaths(): string[] {
    return [...BASE_ASSET_URLS.keys()].sort();
}
