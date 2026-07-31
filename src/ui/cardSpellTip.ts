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

/** Floating tip for `[data-spell-tip]` hits inside a root. */
export class CardSpellTips {
    private tip: HTMLDivElement | null = null;

    bind(root: HTMLElement): void {
        root.addEventListener('pointerover', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-spell-tip]');
            if (!hit || !root.contains(hit)) return;
            this.show(hit);
        });
        root.addEventListener('pointerout', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const from = (e.target as HTMLElement).closest<HTMLElement>('[data-spell-tip]');
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-spell-tip]');
            if (from && from !== to) this.hide();
        });
    }

    show(el: HTMLElement): void {
        const title = el.dataset.ttitle ?? '';
        const desc = el.dataset.tdesc ?? '';
        const icon = el.dataset.ticon ?? '';
        if (!title && !desc) return;
        if (!this.tip) {
            this.tip = document.createElement('div');
            this.tip.className = 'mechili-card-spell-tip';
            document.body.appendChild(this.tip);
        }
        this.tip.innerHTML = spellInfoFrameHtml({
            title,
            desc,
            icon,
            ingredientIcons: (el.dataset.forgeIngs ?? '').split(',').filter(Boolean),
        });
        this.tip.style.display = 'block';
        const rect = el.getBoundingClientRect();
        const tipW = 280;
        let left = rect.right + 10;
        const top = rect.top;
        if (left + tipW > window.innerWidth - 8) left = Math.max(8, rect.left - tipW - 10);
        this.tip.style.left = `${left}px`;
        this.tip.style.top = `${top}px`;
        requestAnimationFrame(() => {
            if (!this.tip) return;
            const h = this.tip.offsetHeight;
            const maxTop = window.innerHeight - h - 8;
            this.tip.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
        });
    }

    hide(): void {
        if (!this.tip) return;
        this.tip.style.display = 'none';
    }

    destroy(): void {
        this.tip?.remove();
        this.tip = null;
    }
}
