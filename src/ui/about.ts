/**
 * About — a window of its own over the menu (the version link, bottom left):
 * who makes Melodan, the credits, and the studio's Imprint / Data privacy shown
 * inline. Those pages live on feuerware.com (they cover Melodan) and load into
 * a sandboxed frame only when a player opens one — until then the game asks
 * feuerware.com for nothing. The site sends no CORS header (a fetch would be
 * refused) but allows framing. The pages are bare HTML without a background,
 * so the frame stays transparent and they read on the window's own parchment.
 */
import { openUrl } from 'steam-electron-build/native';
import { t } from '../i18n';
import { removeWithDialogFade, withDialogFade } from './dialogFade';

const MECHABELLUM_URL = 'https://www.playmechabellum.com/';
/** the source (GPL-3.0), and the store page — the homepage links the same */
const GITHUB_URL = 'https://github.melodan.com';
const STEAM_URL = 'https://steam.melodan.com';

const LEGAL_DOCS = {
    imprint: 'https://feuerware.com/2025/imprint.html',
    privacy: 'https://feuerware.com/2025/privacy.html',
} as const;
type LegalDoc = keyof typeof LEGAL_DOCS;

/** the team and the community, by the names they go by — names only */
const CREDITS: readonly string[] = ['mangoo', 'Trash Collection', 'TNT', 'hONK'];

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function openAbout(parent: HTMLElement): void {
    if (document.querySelector('.mechili-about')) return;

    const overlay = withDialogFade(document.createElement('div'));
    overlay.classList.add('mechili-about');
    overlay.style.pointerEvents = 'auto';
    overlay.innerHTML =
        `<div class="ab-box m-frame">` +
        `<div class="ab-head">` +
        `<div class="ab-title">${esc(t('settings:about.tab'))}</div>` +
        `<button type="button" class="m-btn-bronze primary" data-act="close">${esc(t('common:close'))}</button>` +
        `</div>` +
        `<div class="ab-body">` +
        `<section class="ab-section">` +
        `<h2>© 2026 Feuerware</h2>` +
        `<p class="ab-text">${esc(t('settings:about.studio'))}</p>` +
        `<ul class="ab-credits">` +
        CREDITS.map((name) => `<li>${esc(name)}</li>`).join('') +
        `</ul>` +
        `</section>` +
        // buying it is how players support it — the store page (the homepage's Steam link).
        // A browser, not the Steam overlay: openStore would show the app we were LAUNCHED
        // as (the Playtest has no store page), and the Electron overlay is off by default
        `<section class="ab-section">` +
        `<h2>Steam</h2>` +
        `<p class="ab-text">${t('settings:about.support', {
            steam: `<a href="${STEAM_URL}" data-external>Steam</a>`,
        })}</p>` +
        `</section>` +
        // the link label is the homepage's own (homepage:about.openSourceLink — translated everywhere)
        `<section class="ab-section">` +
        `<h2>${esc(t('settings:about.openSourceTitle'))}</h2>` +
        `<p class="ab-text">${t('settings:about.openSource', {
            github: `<a href="${GITHUB_URL}" data-external>${esc(t('homepage:about.openSourceLink'))}</a>`,
        })}</p>` +
        `</section>` +
        // the homepage's own thanks to Mechabellum (homepage:about.inspired — translated everywhere)
        `<section class="ab-section">` +
        `<h2>${esc(t('settings:about.thanks'))}</h2>` +
        `<p class="ab-text">${t('homepage:about.inspired', {
            mechabellum: `<a href="${MECHABELLUM_URL}" data-external>Mechabellum</a>`,
        })}</p>` +
        `</section>` +
        `<section class="ab-section">` +
        `<h2>${esc(t('settings:about.ai'))}</h2>` +
        `<p class="ab-text">${esc(t('settings:about.tools'))}</p>` +
        `</section>` +
        `<section class="ab-section ab-legal">` +
        `<h2>${esc(t('settings:about.legal'))}</h2>` +
        `<div class="ab-docs">` +
        (Object.keys(LEGAL_DOCS) as LegalDoc[])
            .map((d) => `<button type="button" class="ab-doc-btn" data-doc="${d}">${esc(t(`settings:about.${d}`))}</button>`)
            .join('') +
        `</div>` +
        // inline when feuerware.com lets the game read the page (CORS), else the framed page
        `<div class="ab-doc" hidden></div>` +
        `<iframe class="ab-frame" hidden sandbox="" referrerpolicy="no-referrer"></iframe>` +
        `</section>` +
        `</div>` +
        `</div>`;

    // Imprint / Data privacy: loads on the first click; the open one's button closes it again.
    // Inline (the window's own text, one scrollbar) when the page can be read; the
    // framed page otherwise — the same content either way
    const docEl = overlay.querySelector<HTMLElement>('.ab-doc')!;
    const frame = overlay.querySelector<HTMLIFrameElement>('.ab-frame')!;
    const legal = overlay.querySelector<HTMLElement>('.ab-legal')!;
    const inline = new Map<LegalDoc, DocumentFragment | null>();
    let shown: LegalDoc | null = null;
    const showFramed = (doc: LegalDoc): void => {
        docEl.hidden = true;
        frame.hidden = false;
        legal.classList.add('is-framed');
        if (frame.src !== LEGAL_DOCS[doc]) {
            frame.title = t(`settings:about.${doc}`);
            frame.src = LEGAL_DOCS[doc];
        }
    };
    const showInline = (content: DocumentFragment): void => {
        frame.hidden = true;
        legal.classList.remove('is-framed');
        docEl.replaceChildren(content.cloneNode(true));
        docEl.hidden = false;
    };
    const showDoc = (doc: LegalDoc | null): void => {
        shown = doc;
        for (const b of overlay.querySelectorAll<HTMLButtonElement>('.ab-doc-btn[data-doc]')) {
            b.classList.toggle('active', b.dataset.doc === doc);
        }
        if (!doc) {
            docEl.hidden = true;
            frame.hidden = true;
            legal.classList.remove('is-framed');
            return;
        }
        const known = inline.get(doc);
        if (known) return showInline(known);
        if (known === null) return showFramed(doc);
        void loadLegalDoc(LEGAL_DOCS[doc]).then((content) => {
            inline.set(doc, content);
            if (shown !== doc) return; // switched away meanwhile
            if (content) showInline(content);
            else showFramed(doc);
        });
    };
    // the page's own "Deutsch | English" jump links, inside the window
    docEl.addEventListener('click', (e) => {
        const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-anchor-link]');
        if (!link) return;
        e.preventDefault();
        docEl.querySelector(`[data-anchor="${CSS.escape(link.dataset.anchorLink ?? '')}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    for (const b of overlay.querySelectorAll<HTMLButtonElement>('.ab-doc-btn[data-doc]')) {
        b.addEventListener('click', () => {
            const doc = b.dataset.doc as LegalDoc;
            showDoc(shown === doc ? null : doc);
        });
    }

    const close = (): void => {
        removeWithDialogFade(overlay, () => overlay.remove());
        window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation();
        close();
    };
    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // a link out (Mechabellum): the system browser on desktop, a new tab on the web —
        // never a second app window
        const external = target.closest<HTMLAnchorElement>('a[data-external]');
        if (external) {
            e.preventDefault();
            openUrl(external.href);
            return;
        }
        if (target === overlay || target.closest('[data-act="close"]')) close();
    });
    window.addEventListener('keydown', onKey, true);
    parent.appendChild(overlay);
}

/** the markup a legal page may keep: structure and text, never anything that runs or styles */
const DOC_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'BR', 'UL', 'OL', 'LI', 'A', 'STRONG', 'B', 'EM', 'I', 'DIV', 'SPAN']);

/**
 * The page's text as safe inline markup, or null when it can't be read — no
 * CORS header on feuerware.com yet (the browser refuses), offline, or an error.
 * Only DOC_TAGS survive, every attribute is dropped: a link keeps a checked
 * http(s)/mailto href (opened outside, see data-external) or becomes an in-page
 * jump (data-anchor-link → data-anchor), so no id of the page lands in the game.
 */
async function loadLegalDoc(url: string): Promise<DocumentFragment | null> {
    let html: string;
    try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) return null;
        html = await res.text();
    } catch {
        return null;
    }
    const src = new DOMParser().parseFromString(html, 'text/html');
    const out = document.createDocumentFragment();
    const copy = (from: Node, to: Node): void => {
        for (const child of Array.from(from.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                to.appendChild(document.createTextNode(child.textContent ?? ''));
                continue;
            }
            if (!(child instanceof Element)) continue;
            if (!DOC_TAGS.has(child.tagName)) {
                // an unknown wrapper keeps its text; script/style/iframe and the like go entirely
                if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG'].includes(child.tagName)) copy(child, to);
                continue;
            }
            const el = document.createElement(child.tagName.toLowerCase());
            const id = child.getAttribute('id');
            if (id) el.setAttribute('data-anchor', id);
            if (child.tagName === 'A') {
                const href = child.getAttribute('href') ?? '';
                if (href.startsWith('#')) {
                    el.setAttribute('href', href);
                    el.setAttribute('data-anchor-link', href.slice(1));
                } else {
                    try {
                        const abs = new URL(href, url);
                        if (abs.protocol === 'https:' || abs.protocol === 'http:' || abs.protocol === 'mailto:') {
                            el.setAttribute('href', abs.href);
                            el.setAttribute('data-external', '');
                        }
                    } catch {
                        /* no usable href: plain text */
                    }
                }
            }
            copy(child, el);
            to.appendChild(el);
        }
    };
    copy(src.body, out);
    return out.childNodes.length > 0 ? out : null;
}
