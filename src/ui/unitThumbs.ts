// Concept-art shop thumbnails (optimized square webp), keyed by unit id.
// These replace the live 3D-mesh renders for the shop tiles / placement ghosts.
// Vite resolves each `import.meta.url` asset at build time.
const thumbs: Record<string, string> = {
    dwarf: new URL('../../assets/ui/units/dwarf.webp', import.meta.url).href,
    archer: new URL('../../assets/ui/units/archer.webp', import.meta.url).href,
    crowRider: new URL('../../assets/ui/units/crowRider.webp', import.meta.url).href,
    ballista: new URL('../../assets/ui/units/ballista.webp', import.meta.url).href,
    shield: new URL('../../assets/ui/units/shield.webp', import.meta.url).href,
    rocket: new URL('../../assets/ui/units/rocket.webp', import.meta.url).href,
};

/** Map of unit id → concept-art thumbnail URL for the shop HUD. */
export function unitThumbnails(): Map<string, string> {
    return new Map(Object.entries(thumbs));
}
