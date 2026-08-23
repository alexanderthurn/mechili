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
    levelIcon?: boolean;
}): string {
    const ings =
        opts.ingredientIcons && opts.ingredientIcons.length > 0
            ? `<div class="ai-forge-ings">${opts.ingredientIcons
                  .map((ico) => iconHtml(ico, 'ai-forge-ing'))
                  .join('')}</div>`
            : '';
    const descHtml = escapeHtml(opts.desc ?? '').replace(/\n/g, '<br>');
    return (
        `<div class="ai-head"${opts.levelIcon ? ` style="color:${THEME.ui.brassLight}"` : ''}>` +
        `${opts.icon ? iconHtml(opts.icon, opts.levelIcon ? 'ai-icon mask-ico' : 'ai-icon') : ''}` +
        `<span class="ai-title">${escapeHtml(opts.title)}</span>` +
        ings +
        `</div>` +
        (descHtml ? `<div class="ai-desc">${descHtml}</div>` : '')
    );
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
 *  `stopPropagation` on pointerdown/move must not eat hover. */
export class CardSpellTips {
    private tip: HTMLDivElement | null = null;
    private hoverEl: HTMLElement | null = null;
    private listening = false;

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
        const hit = t.closest<HTMLElement>('[data-spell-tip]');
        if (!hit) return;
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
        const next = related.closest<HTMLElement>('[data-spell-tip]');
        if (next) {
            this.show(next);
            return;
        }
        this.hide();
    };

    show(el: HTMLElement): void {
        const title = el.dataset.ttitle ?? '';
        const desc = el.dataset.tdesc ?? '';
        const icon = el.dataset.ticon ?? '';
        if (!title && !desc) return;
        this.hoverEl = el;
        if (!this.tip) {
            this.tip = document.createElement('div');
            this.tip.className = 'mechili-card-spell-tip';
            this.tip.style.pointerEvents = 'none';
            document.body.appendChild(this.tip);
        }
        this.tip.innerHTML = spellInfoFrameHtml({
            title,
            desc,
            icon,
            ingredientIcons: (el.dataset.forgeIngs ?? '').split(',').filter(Boolean),
        });
        const rect = el.getBoundingClientRect();
        const pad = 8;
        const tipW = 280;
        this.tip.style.display = 'block';
        this.tip.style.visibility = 'hidden';
        const h = this.tip.offsetHeight;
        let left: number;
        let top: number;
        if (el.classList.contains('shop-rune')) {
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
        this.hoverEl = null;
        if (!this.tip) return;
        this.tip.style.display = 'none';
    }

    destroy(): void {
        if (this.listening) {
            document.removeEventListener('pointerover', this.onOver, true);
            document.removeEventListener('pointerout', this.onOut, true);
            this.listening = false;
        }
        this.hoverEl = null;
        this.tip?.remove();
        this.tip = null;
    }
}
