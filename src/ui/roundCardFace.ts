/**
 * Shared between-round card face for in-match offers and the homepage catalog.
 */
import { roundCardIcon, type RoundCard } from '../game/cards';
import {
    forgeRecipesForRuneCard,
    type ForgeSpellPool,
    type RuneCardForgeRow,
} from '../game/forgeRecipes';
import { ITEMS } from '../game/items';
import { TACTICS } from '../game/tactics';
import { iconHtml, moneyHtml } from './iconAtlas';

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '&#10;');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type RoundCardFaceOpts = {
    /**
     * Item ids the player already has (bag + oven). Ownership marks assume
     * this card's rune is also held. Homepage / catalog: omit or [].
     */
    ownedItemIds?: readonly string[];
    /** Team forge unlocks; catalog defaults to `'all'`. */
    forgePool?: ForgeSpellPool;
    /**
     * When true, show a subtitle of catalog extras (item/tactic names).
     * In-match offers use `unitsLabel` only when present.
     */
    catalog?: boolean;
    /** supply the Stronghold charges to forge, shown on the recipe hovers */
    forgeFee?: number;
};

function catalogExtras(c: RoundCard): string[] {
    const extras: string[] = [];
    if (c.unitsLabel) extras.push(c.unitsLabel);
    if (c.items?.length) {
        extras.push(c.items.map((id) => ITEMS[id]?.name ?? id).join(', '));
    }
    if (c.tactics?.length) {
        extras.push(c.tactics.map((id) => TACTICS[id]?.name ?? id).join(', '));
    }
    if (c.flankSpawnHalf) extras.push('Flank spawn half-time');
    return extras;
}

function forgeRowsHtml(
    rows: readonly RuneCardForgeRow[],
    cardRuneId: string | null,
    forgeFee: number | undefined,
): string {
    if (rows.length === 0) return '';
    return `<div class="c-forge">${rows
        .map((row) => {
            // omit this card's own rune — assume it's already "in hand"; show
            // only the extras, but keep the old trio layout: empty left slot,
            // first extra under spell center, second on the right (outer up)
            let skippedSelf = false;
            const extras = row.ingredients.filter((ing) => {
                if (!skippedSelf && cardRuneId && ing.itemId === cardRuneId) {
                    skippedSelf = true;
                    return false;
                }
                return true;
            });
            const miss = (ing: (typeof extras)[number] | null) =>
                ing
                    ? iconHtml(ing.icon, `c-forge-miss${ing.owned ? ' owned' : ' need'}`)
                    : `<span class="c-forge-miss ghost" aria-hidden="true"></span>`;
            const under =
                extras.length > 0
                    ? `<div class="c-forge-missing trio">${miss(null)}${miss(extras[0] ?? null)}${miss(extras[1] ?? null)}</div>`
                    : '';
            const kind = row.ready ? 'bake' : 'path';
            // tip still lists every ingredient for the full recipe
            const ingIcons = row.ingredients.map((ing) => ing.icon).join(',');
            return (
                `<div class="c-forge-spell ${kind}" data-spell-tip="1" ` +
                `data-ttitle="${escapeAttr(row.spellName)}" ` +
                `data-tdesc="${escapeAttr(row.spellDesc)}" ` +
                `data-ticon="${escapeAttr(row.spellIcon)}" ` +
                (forgeFee === undefined
                    ? ''
                    : `data-tfee="${forgeFee}" `) +
                `data-forge-ings="${escapeAttr(ingIcons)}">` +
                `${iconHtml(row.spellIcon, 'c-forge-spell-ico')}` +
                under +
                `</div>`
            );
        })
        .join('')}</div>`;
}

/**
 * Inner face HTML for a between-round card (no outer button/wrapper).
 * Same markup in-game and on the homepage.
 */
export function roundCardFaceHtml(c: RoundCard, opts: RoundCardFaceOpts = {}): string {
    const icon = roundCardIcon(c);
    const runeId = c.items?.length === 1 ? c.items[0]! : null;
    const forgeRows = runeId
        ? forgeRecipesForRuneCard(runeId, opts.ownedItemIds ?? [], opts.forgePool ?? 'all')
        : [];
    const subtitle = opts.catalog
        ? catalogExtras(c)
        : c.unitsLabel
          ? [c.unitsLabel]
          : [];
    return (
        (icon ? `<div class="c-portrait">${iconHtml(icon, 'c-portrait-ico')}</div>` : '') +
        `<div class="c-title">${escapeHtml(c.title)}</div>` +
        (subtitle.length ? `<div class="c-units">${escapeHtml(subtitle.join(' · '))}</div>` : '') +
        `<div class="c-desc">${escapeHtml(c.description)}</div>` +
        forgeRowsHtml(forgeRows, runeId, opts.forgeFee) +
        `<div class="c-cost${c.cost > 0 ? '' : ' free'}">${c.cost > 0 ? moneyHtml(c.cost) : 'Free'}</div>`
    );
}
