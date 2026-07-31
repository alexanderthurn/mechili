/**
 * Melodan icon atlas — stamped-relief sprites from TexturePacker CLI.
 *
 * Source PNGs: misc/icons/src/<id>.png (local pipeline; not shipped)
 * Pack:        npm run icons:pack  (TexturePacker → icons.json + icons.webp)
 * Atlas:       assets/icons/icons.webp + icons.json
 *
 * Frame keys in JSON include ".png"; callers use bare ids (e.g. "ui-supply").
 *
 * Icons are served as a data-URL after {@link preloadIconAtlas} so CSS
 * mask/background paints don't depend on a separate network fetch mid-match.
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

/** Prefer data URL so HUD CSS masks/backgrounds paint without a late network fetch. */
let atlasPaintUrl = atlasUrl;
/** Decoded atlas image — used by world sprites that stamp frames onto canvas. */
let atlasImage: HTMLImageElement | null = null;
let preloadPromise: Promise<void> | null = null;

function frameKey(id: string): string {
    return id.endsWith('.png') ? id : `${id}.png`;
}

export function hasIcon(id: string): boolean {
    return frameKey(id) in atlas.frames;
}

/**
 * Load the atlas into a data URL. Call during boot before constructing the HUD.
 */
export function preloadIconAtlas(): Promise<void> {
    if (atlasImage && atlasPaintUrl.startsWith('data:')) return Promise.resolve();
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
        // decode so first HUD paint isn't blank, and keep the Image for
        // world-sprite stamping (tech badges over packs, etc.)
        atlasImage = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('icon atlas decode failed'));
            img.src = atlasPaintUrl;
        });
    })();
    return preloadPromise;
}

/**
 * Stamp one atlas frame onto a canvas context (transparent — no plate/border).
 * Returns false if the atlas isn't ready or the id is missing.
 */
export function drawIcon(
    ctx: CanvasRenderingContext2D,
    id: string,
    dx: number,
    dy: number,
    size: number,
    fallbackId = 'ui-unknown',
): boolean {
    if (!atlasImage) return false;
    const frame = iconFrame(id) ?? iconFrame(fallbackId);
    if (!frame) return false;
    ctx.drawImage(atlasImage, frame.x, frame.y, frame.w, frame.h, dx, dy, size, size);
    return true;
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

/** CSS mask snippet that tints the icon with `currentColor` (white sprite alpha). */
export function iconMaskCss(id: string, fallbackId = 'ui-unknown'): string {
    const key = hasIcon(id) ? frameKey(id) : frameKey(fallbackId);
    const f = atlas.frames[key];
    if (!f) return '';
    const { x, y, w, h } = f.frame;
    const posX = sheetW === w ? 0 : (x / (sheetW - w)) * 100;
    const posY = sheetH === h ? 0 : (y / (sheetH - h)) * 100;
    return [
        `-webkit-mask-image:url(${atlasPaintUrl})`,
        `-webkit-mask-repeat:no-repeat`,
        `-webkit-mask-size:${(sheetW / w) * 100}% ${(sheetH / h) * 100}%`,
        `-webkit-mask-position:${posX}% ${posY}%`,
        `mask-image:url(${atlasPaintUrl})`,
        `mask-repeat:no-repeat`,
        `mask-size:${(sheetW / w) * 100}% ${(sheetH / h) * 100}%`,
        `mask-position:${posX}% ${posY}%`,
        // Use button text color as tint.
        `background-color:currentColor`,
        // icon spans often force `color:transparent`; override so currentColor works.
        `color:inherit`,
        `background-repeat:no-repeat`,
    ].join(';');
}

/** Empty span that shows an atlas icon (pair with `.m-icon` size rules in theme). */
export function iconHtml(id: string, className = 'i', fallbackId = 'ui-unknown'): string {
    const classes = className.includes('m-icon') ? className : `${className} m-icon`;
    const useMask = className.includes('mask-ico');
    const style = useMask ? iconMaskCss(id, fallbackId) : iconCss(id, fallbackId);
    return `<span class="${classes}" style="${style}" role="img" aria-hidden="true"></span>`;
}

/** Apply atlas background to an existing element (keeps its classes/size). */
export function applyIcon(el: HTMLElement, id: string, fallbackId = 'ui-unknown'): void {
    el.classList.add('m-icon');
    el.replaceChildren();
    // Set properties directly — do not split iconCss on ';'. Atlas paint URLs are
    // data:image/webp;base64,... and a naive split truncates background-image.
    const key = hasIcon(id) ? frameKey(id) : frameKey(fallbackId);
    const f = atlas.frames[key];
    if (!f) return;
    const { x, y, w, h } = f.frame;
    const posX = sheetW === w ? 0 : (x / (sheetW - w)) * 100;
    const posY = sheetH === h ? 0 : (y / (sheetH - h)) * 100;
    el.style.backgroundImage = `url(${atlasPaintUrl})`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = `${(sheetW / w) * 100}% ${(sheetH / h) * 100}%`;
    el.style.backgroundPosition = `${posX}% ${posY}%`;
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
