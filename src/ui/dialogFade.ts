/** Shared dialog enter/exit motion — pair with `.mechili-dialog-fade` in theme. */

export const DIALOG_FADE_CLASS = 'mechili-dialog-fade';
export const DIALOG_OUT_CLASS = 'mechili-dialog-out';
/** Keep in sync with `dialogFadeStyles()` animation duration. */
export const DIALOG_FADE_MS = 200;

function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mark an overlay so it fades in on mount. */
export function withDialogFade<T extends HTMLElement>(el: T): T {
    el.classList.add(DIALOG_FADE_CLASS);
    return el;
}

/**
 * Fade an overlay out, then run `remove` (typically DOM removal).
 * Instant when reduced-motion is on, or the node is already gone/out.
 */
export function removeWithDialogFade(el: HTMLElement, remove: () => void): void {
    if (!el.isConnected || prefersReducedMotion() || el.classList.contains(DIALOG_OUT_CLASS)) {
        remove();
        return;
    }
    el.classList.add(DIALOG_OUT_CLASS);
    el.style.pointerEvents = 'none';
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        remove();
    };
    el.addEventListener(
        'animationend',
        (e) => {
            if (e.target === el) finish();
        },
        { once: true },
    );
    window.setTimeout(finish, DIALOG_FADE_MS + 80);
}
