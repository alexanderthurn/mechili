/**
 * Shared forge-spell hover tip used by in-match specialist cards and the
 * homepage (web.html) commander gallery.
 */
import { startCardForgeIcons, type StartCard } from '../game/cards';
import { THEME } from '../theme';
import { iconHtml } from './iconAtlas';

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

/** Shared body for panel action-info and floating card tips. */
export function spellInfoFrameHtml(opts: {
    title: string;
    desc?: string;
    icon?: string;
    ingredientIcons?: readonly string[];
    /** forge fee, printed as "+ N" right after the ingredients it is added to */
    ingredientFee?: number;
    /** a flat price with a place — "Stronghold 300" */
    cost?: number;
    costLabel?: string;
    levelIcon?: boolean;
    /** vertical icon+label(+cost, +desc) list — a unit's talent loadout */
    rows?: readonly { icon: string; label: string; cost?: number; desc?: string }[];
}): string {
    const ings =
        opts.ingredientIcons && opts.ingredientIcons.length > 0
            ? `<div class="ai-forge-ings">${opts.ingredientIcons
                  .map((ico) => iconHtml(ico, 'ai-forge-ing'))
                  .join('')}${
                  opts.ingredientFee === undefined
                      ? ''
                      : `<span class="ai-forge-fee">+ ${opts.ingredientFee}</span>`
              }</div>`
            : '';
    const descHtml = escapeHtml(opts.desc ?? '').replace(/\n/g, '<br>');
    const rowsHtml =
        opts.rows && opts.rows.length > 0
            ? `<div class="ai-rows">${opts.rows
                  .map(
                      (r) =>
                          `<div class="ai-row">${iconHtml(r.icon, 'ai-row-ico mask-ico')}` +
                          `<span class="ai-row-body">` +
                          `<span class="ai-row-label">${escapeHtml(r.label)}</span>` +
                          (r.desc ? `<span class="ai-row-desc">${escapeHtml(r.desc)}</span>` : '') +
                          `</span>` +
                          (r.cost === undefined ? '' : `<span class="ai-row-cost">${r.cost}</span>`) +
                          `</div>`,
                  )
                  .join('')}</div>`
            : '';
    return (
        `<div class="ai-head"${opts.levelIcon ? ` style="color:${THEME.ui.brassLight}"` : ''}>` +
        `${opts.icon ? iconHtml(opts.icon, opts.levelIcon ? 'ai-icon mask-ico' : 'ai-icon') : ''}` +
        `<span class="ai-title">${escapeHtml(opts.title)}</span>` +
        ings +
        `</div>` +
        (descHtml ? `<div class="ai-desc">${descHtml}</div>` : '') +
        (opts.cost === undefined
            ? ''
            : `<div class="ai-cost">${opts.costLabel ? `${escapeHtml(opts.costLabel)} ` : ''}${opts.cost}</div>`) +
        rowsHtml
    );
}

interface TipRow {
    icon: string;
    label: string;
    cost?: number;
    desc?: string;
}

/**
 * Serialize talent rows for a `data-trows` attribute (see CardSpellTips).
 * `icon|cost|label|desc`, one row per line. The description goes LAST so it
 * may contain pipes; icon ids, costs and talent names cannot.
 */
export function encodeTipRows(rows: readonly TipRow[]): string {
    return rows
        .map((r) => `${r.icon}|${r.cost ?? ''}|${r.label}|${r.desc ?? ''}`)
        .join('\n');
}

function decodeTipRows(raw: string): TipRow[] {
    if (!raw) return [];
    const out: TipRow[] = [];
    for (const line of raw.split('\n')) {
        const a = line.indexOf('|');
        if (a < 0) continue;
        const b = line.indexOf('|', a + 1);
        if (b < 0) continue;
        const c = line.indexOf('|', b + 1);
        if (c < 0) continue;
        const rawCost = line.slice(a + 1, b);
        const cost = Number(rawCost);
        const desc = line.slice(c + 1);
        out.push({
            icon: line.slice(0, a),
            label: line.slice(b + 1, c),
            cost: rawCost !== '' && Number.isFinite(cost) ? cost : undefined,
            desc: desc || undefined,
        });
    }
    return out;
}

/** Forge-spell icon row for a commander card face (with tip data attrs). */
export function startCardForgeSpellsHtml(c: StartCard): string {
    const forge = startCardForgeIcons(c);
    if (forge.length === 0) return '';
    return `<div class="c-forge-spells">${forge
        .map(
            (f) =>
                `<span class="c-forge-spell-hit" data-spell-tip="1" ` +
                `data-ttitle="${escapeAttr(f.name)}" ` +
                `data-tdesc="${escapeAttr(f.desc)}" ` +
                `data-ticon="${escapeAttr(f.icon)}" ` +
                (f.cost === undefined
                    ? ''
                    : `data-tcost="${f.cost}" data-tcostlabel="Stronghold" `) +
                `data-forge-ings="${escapeAttr(f.ingredientIcons.join(','))}">` +
                `${iconHtml(f.icon, 'c-forge-spell-ico')}</span>`,
        )
        .join('')}</div>`;
}

/** Commander / specialist card face (static data — safe for innerHTML). */
export function startCardFaceHtml(c: StartCard): string {
    return (
        `<div class="c-portrait">${iconHtml(c.portrait, 'c-portrait-ico')}</div>` +
        `<div class="c-title">${escapeHtml(c.title)}</div>` +
        `<div class="c-units">${escapeHtml(c.unitsLabel)}</div>` +
        `<div class="c-hp">♥ ${c.startingHp} HP</div>` +
        `<div class="c-desc">${escapeHtml(c.description)}</div>` +
        startCardForgeSpellsHtml(c)
    );
}

/** Floating tip for `[data-spell-tip]` hits. One document listener — HUD
 *  `stopPropagation` on pointerdown/move must not eat hover.
 *  Click / tap the tip to dismiss leftovers; recipe tiles inside the forge
 *  cookbook keep their own click handlers. */
export class CardSpellTips {
    private tip: HTMLDivElement | null = null;
    private hoverEl: HTMLElement | null = null;
    private listening = false;
    /** after a click-dismiss, don't immediately reshow this same source */
    private skipEl: HTMLElement | null = null;
    /** e.g. loadout first-tap arm — cleared whenever the tip hides */
    onHide: (() => void) | null = null;

    bind(_root?: HTMLElement): void {
        if (this.listening) return;
        this.listening = true;
        document.addEventListener('pointerover', this.onOver, true);
        document.addEventListener('pointerout', this.onOut, true);
    }

    private onOver = (e: PointerEvent): void => {
        if (e.pointerType === 'touch') return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('.mechili-card-spell-tip')) return;
        const hit = t.closest<HTMLElement>('[data-spell-tip]');
        if (!hit || hit === this.skipEl) return;
        this.show(hit);
    };

    private onOut = (e: PointerEvent): void => {
        if (e.pointerType === 'touch') return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        const from = t.closest<HTMLElement>('[data-spell-tip]');
        if (!from) return;
        const related = e.relatedTarget;
        // Tip insert / reparent often sends pointerout with relatedTarget null.
        // Ignore those — a real leave has a Node we moved onto.
        if (!(related instanceof Element)) return;
        if (from.contains(related) || this.tip?.contains(related)) return;
        if (from === this.skipEl) this.skipEl = null;
        const next = related.closest<HTMLElement>('[data-spell-tip]');
        if (next) {
            this.show(next);
            return;
        }
        this.hide();
    };

    private onTipPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        this.skipEl = this.hoverEl;
        this.hide();
    };

    private onTipLeave = (e: PointerEvent): void => {
        if (e.pointerType === 'touch') return;
        const related = e.relatedTarget;
        if (related instanceof Element) {
            if (this.hoverEl?.contains(related)) return;
            const next = related.closest<HTMLElement>('[data-spell-tip]');
            if (next) {
                this.show(next);
                return;
            }
        }
        this.hide();
    };

    show(el: HTMLElement): void {
        const title = el.dataset.ttitle ?? '';
        const desc = el.dataset.tdesc ?? '';
        const icon = el.dataset.ticon ?? '';
        if (!title && !desc && !el.dataset.trows) return;
        this.hoverEl = el;
        if (el !== this.skipEl) this.skipEl = null;
        if (!this.tip) {
            this.tip = document.createElement('div');
            this.tip.className = 'mechili-card-spell-tip';
            this.tip.addEventListener('pointerdown', this.onTipPointerDown, true);
            this.tip.addEventListener('pointerleave', this.onTipLeave);
            document.body.appendChild(this.tip);
        }
        this.tip.innerHTML = spellInfoFrameHtml({
            title,
            desc,
            icon,
            ingredientIcons: (el.dataset.forgeIngs ?? '').split(',').filter(Boolean),
            ingredientFee: el.dataset.tfee === undefined ? undefined : Number(el.dataset.tfee),
            cost: el.dataset.tcost === undefined ? undefined : Number(el.dataset.tcost),
            costLabel: el.dataset.tcostlabel,
            rows: decodeTipRows(el.dataset.trows ?? ''),
        });
        const rect = el.getBoundingClientRect();
        const pad = 8;
        const tipW = 280;
        this.tip.style.display = 'block';
        this.tip.style.visibility = 'hidden';
        const h = this.tip.offsetHeight;
        let left: number;
        let top: number;
        const shopCol = el.classList.contains('shop-tile')
            ? el.closest<HTMLElement>('.mechili-shop-col')
            : null;
        if (shopCol) {
            // Anchor off the whole shop COLUMN, not the tile: a tile-relative
            // offset still lands inside the shop (the column is wide) and so
            // right next to the cursor. Left of the column and near the top
            // puts it clear of both. Shop tiles OUTSIDE that column — the
            // unlock picker's, in a centred modal — fall through to the
            // default placement, which flips sides as needed.
            const a = shopCol.getBoundingClientRect();
            left = Math.max(pad, a.left - tipW - 28);
            top = Math.max(pad, a.top - 40);
            if (top + h > window.innerHeight - pad) {
                top = Math.max(pad, window.innerHeight - h - pad);
            }
        } else if (el.classList.contains('shop-rune')) {
            // Shop runes sit under the cursor at the top of the HUD — park the
            // window up-left with a wider gap so it does not sit on the mouse.
            left = rect.left - tipW - 18;
            top = rect.top - 110;
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            if (top + h > window.innerHeight - pad) {
                top = Math.max(pad, window.innerHeight - h - pad);
            }
        } else {
            // Elements can opt into a wider gap with data-tip-wide. Needed for
            // anything in a panel pinned to a screen edge: the tip flips to
            // the element's other side, which is exactly where the cursor
            // already is, so the default 14px leaves it under the pointer.
            const gap = el.dataset.tipWide ? 40 : 14;
            left = rect.right + gap;
            if (left + tipW > window.innerWidth - pad) {
                left = Math.max(pad, rect.left - tipW - gap);
            }
            top = Math.max(pad, Math.min(rect.top, window.innerHeight - h - pad));
        }
        this.tip.style.left = `${left}px`;
        this.tip.style.top = `${top}px`;
        this.tip.style.visibility = 'visible';
    }

    hide(): void {
        const shown = !!this.tip && this.tip.style.display !== 'none';
        this.hoverEl = null;
        if (this.tip) this.tip.style.display = 'none';
        if (shown) this.onHide?.();
    }

    destroy(): void {
        if (this.listening) {
            document.removeEventListener('pointerover', this.onOver, true);
            document.removeEventListener('pointerout', this.onOut, true);
            this.listening = false;
        }
        this.hoverEl = null;
        this.skipEl = null;
        this.onHide = null;
        if (this.tip) {
            this.tip.removeEventListener('pointerdown', this.onTipPointerDown, true);
            this.tip.removeEventListener('pointerleave', this.onTipLeave);
        }
        this.tip?.remove();
        this.tip = null;
    }
}
