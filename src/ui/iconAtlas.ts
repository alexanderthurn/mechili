/**
 * Melodan icon atlas — stamped-relief sprites from TexturePacker.
 *
 * Source PNGs: misc/icons/src/<id>.png (local pipeline; not shipped)
 * Pack:        npm run icons:pack
 * Atlas:       assets/icons/icons.webp + icons.json
 *
 * Frame keys in JSON include ".png"; callers use bare ids (e.g. "ui-supply").
 */

import atlasJson from '../../assets/icons/icons.json';

type AtlasFrame = {
    frame: { x: number; y: number; w: number; h: number };
};

type AtlasJson = {
    frames: Record<string, AtlasFrame>;
    meta: { size: { w: number; h: number } };
};

const atlas = atlasJson as AtlasJson;
const atlasUrl = new URL('../../assets/icons/icons.webp', import.meta.url).href;
const sheetW = atlas.meta.size.w;
const sheetH = atlas.meta.size.h;

function frameKey(id: string): string {
    return id.endsWith('.png') ? id : `${id}.png`;
}

export function hasIcon(id: string): boolean {
    return frameKey(id) in atlas.frames;
}

/** CSS background snippet for an HTML icon element (fills the element's box). */
export function iconCss(id: string, fallbackId = 'ui-unknown'): string {
    const key = hasIcon(id) ? frameKey(id) : frameKey(fallbackId);
    const f = atlas.frames[key];
    if (!f) return '';
    const { x, y, w, h } = f.frame;
    return [
        `background-image:url(${atlasUrl})`,
        `background-repeat:no-repeat`,
        `background-size:${(sheetW / w) * 100}% ${(sheetH / h) * 100}%`,
        `background-position:${(-x / w) * 100}% ${(-y / h) * 100}%`,
    ].join(';');
}

export function iconFrame(id: string): AtlasFrame['frame'] | null {
    const f = atlas.frames[frameKey(id)] ?? atlas.frames[frameKey('ui-unknown')];
    return f?.frame ?? null;
}

export function iconAtlasUrl(): string {
    return atlasUrl;
}

export function iconAtlasSize(): { w: number; h: number } {
    return { w: sheetW, h: sheetH };
}

export function listIconIds(): string[] {
    return Object.keys(atlas.frames).map((k) => k.replace(/\.png$/, ''));
}
