/**
 * The commander figures — one sculpted model per starting-card speciality.
 *
 * Only a few are authored so far; every other speciality borrows {@link
 * FALLBACK_COMMANDER}. Loaded lazily rather than at boot: at most two of these
 * are ever on screen in a match (one keep per side), so making every player
 * download all of them before the main menu would be several megabytes spent
 * on figures they will not see.
 */
import type { Group } from 'three';
import type { SpecialityId } from './cards';
import { loadSpellTemplate } from './spellMeshes';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import { assetUrl, onAssetOverlaySwitch } from './assets';
import { disposeScene } from '../engine/disposeScene';

const URLS: Partial<Record<SpecialityId, string>> = {
    get giant() {
        return assetUrl('models/specs/spec-giant-512.glb');
    },
    get speed() {
        return assetUrl('models/specs/spec-speed-512.glb');
    },
    get tutor() {
        return assetUrl('models/specs/spec-tutor-4k.glb');
    },
};

/**
 * Stands in for every speciality without its own figure — nine of twelve
 * today, so this is the one most players will actually see. `speed` because
 * it is neither of the two extremes: `giant` is authored half again as broad
 * (a body-type statement that would read wrong on a money or cursed
 * commander), and `tutor` ships a 4K texture, nine times the download.
 */
const FALLBACK_COMMANDER: SpecialityId = 'speed';

const templates = new Map<SpecialityId, Group>();
/** file URL each template was loaded from */
const loadedFrom = new Map<SpecialityId, string>();
const inFlight = new Map<SpecialityId, Promise<Group | null>>();

/** Which figure actually represents this speciality (its own, or the stand-in). */
export function commanderModelFor(speciality: SpecialityId | null): SpecialityId {
    return speciality && URLS[speciality] ? speciality : FALLBACK_COMMANDER;
}

/**
 * Shared prepared template — normalized to height 1 standing on y=0, so the
 * caller scales it to whatever the scene wants. Do not dispose: clone per use.
 */
export function getCommanderTemplate(id: SpecialityId): Group | null {
    return templates.get(id) ?? null;
}

/** Loads once; repeat calls join the same request. Never throws. */
export function ensureCommanderTemplate(id: SpecialityId): Promise<Group | null> {
    const ready = templates.get(id);
    if (ready) return Promise.resolve(ready);
    const pending = inFlight.get(id);
    if (pending) return pending;

    const url = URLS[id];
    if (!url) return Promise.resolve(null);

    const load = (async () => {
        try {
            const tpl = await loadSpellTemplate(url);
            const budget = modelTextureBudget();
            if (budget) applyTextureBudget(tpl, budget);
            loadedFrom.set(id, url);
            templates.set(id, tpl);
            console.info(`[commanderModels] '${id}' ready`);
            return tpl;
        } catch (e) {
            console.error(`[commanderModels] '${id}' failed to load`, e);
            return null;
        } finally {
            inFlight.delete(id);
        }
    })();
    inFlight.set(id, load);
    return load;
}

// A level replaced a commander figure: reload the ones loaded from another file.
onAssetOverlaySwitch('commander models', async () => {
    await Promise.allSettled([...inFlight.values()]);
    const stale = [...templates.keys()].filter((id) => loadedFrom.get(id) !== URLS[id]);
    for (const id of stale) {
        const tpl = templates.get(id)!;
        templates.delete(id);
        loadedFrom.delete(id);
        disposeScene(tpl);
    }
    await Promise.all(stale.map((id) => ensureCommanderTemplate(id)));
});
