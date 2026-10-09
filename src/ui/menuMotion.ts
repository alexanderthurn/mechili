import { cssUrl } from './iconAtlas';

/**
 * Main-menu motion: the panel and its buttons arriving, the parchment
 * growing / shrinking between screens, and the painting's slow zoom.
 * Styles in theme.ts (`m-arrive`, `is-arriving`, `m-backdrop-zoom`). Tweak live:
 * - stagger: ms between two buttons arriving; staggerMax caps a long list
 * - resizeMs: the panel's height change between two screens
 */
export const MENU_MOTION = {
    stagger: 40,
    staggerMax: 360,
    resizeMs: 280,
} as const;

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** the screen's rows rise in one after another */
export function staggerMenuView(view: HTMLElement, delayMs = 0): void {
    if (prefersReducedMotion()) return;
    const rows = [...view.children].filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null,
    );
    rows.forEach((row, i) => {
        row.style.animationDelay = `${delayMs + Math.min(i * MENU_MOTION.stagger, MENU_MOTION.staggerMax)}ms`;
        row.classList.remove('m-arrive');
        void row.offsetWidth;
        row.classList.add('m-arrive');
        row.addEventListener(
            'animationend',
            (e) => {
                if (e.target !== row) return;
                row.classList.remove('m-arrive');
                row.style.animationDelay = '';
            },
            { once: true },
        );
    });
}

let resizeAnim: Animation | null = null;
let resizeWatch: ResizeObserver | null = null;

function stopResize(menu: HTMLElement): void {
    resizeWatch?.disconnect();
    resizeWatch = null;
    resizeAnim?.cancel();
    resizeAnim = null;
    menu.classList.remove('is-resizing');
}

/** grow / shrink the panel from `fromHeight` to whatever its content needs now */
function resizeTo(menu: HTMLElement, fromHeight: number, ms: number): void {
    const toHeight = menu.getBoundingClientRect().height;
    if (!(fromHeight > 0 && toHeight > 0 && Math.abs(toHeight - fromHeight) > 2)) return;
    menu.classList.add('is-resizing');
    const anim = menu.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
        duration: ms,
        easing: EASE_OUT,
    });
    resizeAnim = anim;
    anim.onfinish = () => {
        if (resizeAnim === anim) stopResize(menu);
    };
}

/**
 * Another screen in the panel: the parchment grows or shrinks from its old
 * height to the new one, and the new screen's rows rise in. Content that
 * changes size meanwhile (a lobby filling in, settings opening) re-aims the
 * growth from where it is instead of being squeezed until the end.
 */
export function animateMenuSwap(menu: HTMLElement, view: HTMLElement, fromHeight: number): void {
    if (prefersReducedMotion()) return;
    // an earlier swap still running: start from where it is now
    const from = resizeAnim ? menu.getBoundingClientRect().height : fromHeight;
    stopResize(menu);
    resizeTo(menu, from, MENU_MOTION.resizeMs);
    if (resizeAnim) {
        let lastH = view.getBoundingClientRect().height;
        resizeWatch = new ResizeObserver(() => {
            const h = view.getBoundingClientRect().height;
            if (Math.abs(h - lastH) < 1) return;
            lastH = h;
            const current = menu.getBoundingClientRect().height;
            const watch = resizeWatch;
            resizeAnim?.cancel();
            resizeAnim = null;
            resizeTo(menu, current, MENU_MOTION.resizeMs * 0.7);
            if (!resizeAnim) stopResize(menu);
            else resizeWatch = watch;
        });
        resizeWatch.observe(view);
    }
    staggerMenuView(view, 60);
}

/** the whole menu arriving: chips fade in, the panel settles, then its buttons */
export function playMenuArrival(chrome: HTMLElement, view: HTMLElement): void {
    if (prefersReducedMotion()) return;
    chrome.classList.remove('is-arriving');
    void chrome.offsetWidth;
    chrome.classList.add('is-arriving');
    window.setTimeout(() => chrome.classList.remove('is-arriving'), 1400);
    staggerMenuView(view, 220);
}

/**
 * The menu painting on its own layer: a slow zoom into one spot of the
 * painting and back out (theme `m-backdrop-zoom`). Runs only while the menu
 * shows (`setLive`), so a match never pays for it.
 */
export function createMenuBackdrop(url: string): { el: HTMLElement; setLive(live: boolean): void } {
    const el = document.createElement('div');
    el.className = 'mechili-menu-backdrop';
    const img = document.createElement('div');
    img.className = 'm-backdrop-img';
    img.style.backgroundImage = cssUrl(url);
    el.append(img);
    return {
        el,
        setLive(live: boolean) {
            el.classList.toggle('is-live', live);
        },
    };
}
