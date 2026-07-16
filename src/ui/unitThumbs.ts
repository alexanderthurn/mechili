// Concept-art shop thumbnails (optimized square webp), keyed by unit id.
// These replace the live 3D-mesh renders for the shop tiles / placement ghosts.
// Vite resolves each `import.meta.url` asset at build time.
const thumbs: Record<string, string> = {
    crawler: new URL('../../assets/ui/units/crawler.webp', import.meta.url).href,
    marksman: new URL('../../assets/ui/units/marksman.webp', import.meta.url).href,
    wasp: new URL('../../assets/ui/units/wasp.webp', import.meta.url).href,
    fortress: new URL('../../assets/ui/units/fortress.webp', import.meta.url).href,
    shield: new URL('../../assets/ui/units/shield.webp', import.meta.url).href,
    rocket: new URL('../../assets/ui/units/rocket.webp', import.meta.url).href,
};

/** Map of unit id → concept-art thumbnail URL for the shop HUD. */
export function unitThumbnails(): Map<string, string> {
    return new Map(Object.entries(thumbs));
}
