/**
 * A scenario's terrain: the landscape (board relief, outer world, paint,
 * plants) it is played on. Packaged next to the scenario as
 * `scenarios/<id>.terrain.json`; while the editor works on a draft it lives
 * here in memory (the draft's autosave keeps it across reloads).
 */
import { activeLevel } from '../level';
import { decodeLandscape, encodeLandscape, type LandscapeData } from '../landscape';

let draft: LandscapeData | null = null;

/** the terrain the editor's draft is sculpted to (null = the generated terrain) */
export function draftTerrain(): LandscapeData | null {
    return draft;
}

export function setDraftTerrain(data: LandscapeData | null): void {
    draft = data;
}

/** a terrain as the text of its package file */
export function terrainFileText(data: LandscapeData): string {
    return JSON.stringify(encodeLandscape(data));
}

const decoded = new Map<string, LandscapeData>();

/** a terrain file's text, decoded (once per text — the same package decodes once) */
export function decodeTerrainText(text: string): LandscapeData {
    let data = decoded.get(text);
    if (!data) {
        data = decodeLandscape(JSON.parse(text));
        // a handful of packages per session at most — keep it from growing without bound
        if (decoded.size > 8) decoded.clear();
        decoded.set(text, data);
    }
    return data;
}

/** the packaged terrain of scenario `id` in the active level, or null */
export function packagedTerrain(id: string | undefined): LandscapeData | null {
    if (id === undefined) return null;
    const text = activeLevel().terrains.get(id);
    if (!text) return null;
    try {
        return decodeTerrainText(text);
    } catch (e) {
        console.warn(`[scenario] terrain of "${id}" does not load — playing the generated terrain`, e);
        return null;
    }
}
