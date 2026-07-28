/**
 * Melodan icon atlas — stamped-relief sprites from TexturePacker CLI.
 *
 * Source PNGs: misc/icons/src/<id>.png (local pipeline; not shipped)
 * Pack:        npm run icons:pack  (TexturePacker → icons.json + icons.webp)
 * Atlas:       assets/icons/icons.webp + icons.json
 *
 * Frame keys in JSON include ".png"; callers use bare ids (e.g. "ui-supply").
 *
 * IMPORTANT: Pixi HTMLSource (in-game HUD) often skips external CSS
 * background-image URLs. We paint from a data-URL after {@link preloadIconAtlas}.
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

/** Prefer data URL so HTMLSource / canvas mirroring can rasterize icons. */
let atlasPaintUrl = atlasUrl;
let preloadPromise: Promise<void> | null = null;

function frameKey(id: string): string {
    return id.endsWith('.png') ? id : `${id}.png`;
}

export function hasIcon(id: string): boolean {
    return frameKey(id) in atlas.frames;
}

/**
 * Load the atlas into a data URL. Call during boot before constructing the HUD
 * so in-canvas HTMLSource paints see the sheet.
 */
export function preloadIconAtlas(): Promise<void> {
    if (atlasPaintUrl.startsWith('data:')) return Promise.resolve();
    if (preloadPromise) return preloadPromise;
    preloadPromise = (async () => {
        const res = await fetch(atlasUrl);
        if (!res.ok) throw new Error(`icon atlas fetch failed: ${res.status}`);
        const blob = await res.blob();
        atlasPaintUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(fr.error ?? new Error('icon atlas FileReader failed'));
            fr.readAsDataURL(blob);
        });
        // decode so first HTMLSource paint isn't blank
        await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('icon atlas decode failed'));
            img.src = atlasPaintUrl;
        });
    })();
    return preloadPromise;
}

/** CSS background snippet for an HTML icon element (fills the element's box). */
export function iconCss(id: string, fallbackId = 'ui-unknown'): string {
    const key = hasIcon(id) ? frameKey(id) : frameKey(fallbackId);
    const f = atlas.frames[key];
    if (!f) return '';
    const { x, y, w, h } = f.frame;
    // Percentage position uses (area - image) * pct — NOT -x/w. See MDN background-position.
    const posX = sheetW === w ? 0 : (x / (sheetW - w)) * 100;
    const posY = sheetH === h ? 0 : (y / (sheetH - h)) * 100;
    return [
        `background-image:url(${atlasPaintUrl})`,
        `background-repeat:no-repeat`,
        `background-size:${(sheetW / w) * 100}% ${(sheetH / h) * 100}%`,
        `background-position:${posX}% ${posY}%`,
    ].join(';');
}

/** Empty span that shows an atlas icon (pair with `.m-icon` size rules in theme). */
export function iconHtml(id: string, className = 'i', fallbackId = 'ui-unknown'): string {
    const classes = className.includes('m-icon') ? className : `${className} m-icon`;
    return `<span class="${classes}" style="${iconCss(id, fallbackId)}" role="img" aria-hidden="true"></span>`;
}

/** Apply atlas background to an existing element (keeps its classes/size). */
export function applyIcon(el: HTMLElement, id: string, fallbackId = 'ui-unknown'): void {
    el.classList.add('m-icon');
    el.replaceChildren();
    const css = iconCss(id, fallbackId);
    for (const part of css.split(';')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const prop = part.slice(0, i).trim();
        const val = part.slice(i + 1).trim();
        if (prop && val) el.style.setProperty(prop, val);
    }
}

export function iconFrame(id: string): AtlasFrame['frame'] | null {
    const f = atlas.frames[frameKey(id)] ?? atlas.frames[frameKey('ui-unknown')];
    return f?.frame ?? null;
}

export function iconAtlasUrl(): string {
    return atlasPaintUrl;
}

export function iconAtlasSize(): { w: number; h: number } {
    return { w: sheetW, h: sheetH };
}

export function listIconIds(): string[] {
    return Object.keys(atlas.frames).map((k) => k.replace(/\.png$/, ''));
}
