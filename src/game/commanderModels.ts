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

const URLS: Partial<Record<SpecialityId, string>> = {
    giant: new URL('../../assets/models/specs/spec-giant-512.glb', import.meta.url).href,
    speed: new URL('../../assets/models/specs/spec-speed-512.glb', import.meta.url).href,
    tutor: new URL('../../assets/models/specs/spec-tutor-4k.glb', import.meta.url).href,
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
