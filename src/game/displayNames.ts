/**
 * Player-facing names for systems that keep technical ids in code
 * (`item` / `tech` / …). Prefer these in HUD, homepage, cards, and docs copy.
 */
export const DISPLAY = {
    /** pack equippables (`items.ts`) */
    item: 'Rune',
    items: 'Runes',
    /** researched unit upgrades (`techCatalog.ts` / `tech.ts`) */
    tech: 'Talent',
    techs: 'Talents',
} as const;
