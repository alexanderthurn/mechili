/**
 * Switching the files and definitions the game plays with (plan §17.6–17.8).
 *
 * `switchLevel(overlay)` is the one entry point: it validates the level's data
 * before anything changes, points model data and procedural heights at the
 * level's types, installs its files and waits until every cache that loaded a
 * replaced file (unit models, rigged units, spells, commanders, scenery,
 * projectiles) has reloaded. `switchLevel(null)` goes back to the base game.
 *
 * Call it between matches, never while one runs: replaced templates are
 * disposed. The returned registry is what a match built for the level plays
 * with — handing it to the Game is the scenario boot's job (plan §17.7 step 8).
 */
import { switchAssetOverlay, type AssetOverlay } from './assets';
import { BASE_PACK, loadPackWithOverlay } from './content/basePack';
import { TypeRegistry } from './content/typeRegistry';
import { BASE_TYPES, proceduralHeightsOf } from './units';
import { setModelSpecData, setProceduralModelHeights } from './unitModels';

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
        setProceduralModelHeights(proceduralHeightsOf(types));
        await switchAssetOverlay(overlay);
        active = { overlay, types };
        return active;
    });
    queue = run.catch(() => {});
    return run;
}
