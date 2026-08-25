/**
 * Ephemeral hover UI (spell tips, shop action-info, lobby tips, …).
 * Register a clearer per surface; {@link clearAllHoverTips} dismisses them all —
 * used when the pointer leaves the browser window so tips never stick.
 */

const clearers = new Set<() => void>();
let windowClearWired = false;

/** Register a tip/popover clearer. Returns an unregister function. */
export function registerHoverTipClearer(clear: () => void): () => void {
    clearers.add(clear);
    ensureHoverTipWindowClear();
    return () => {
        clearers.delete(clear);
    };
}

/** Hide every registered hover tip / peek frame. */
export function clearAllHoverTips(): void {
    for (const clear of [...clearers]) clear();
}

/**
 * Wire once: leaving the page viewport, blurring the window, or hiding the
 * tab clears tips. Per-element `pointerout` often gets `relatedTarget === null`
 * when the cursor leaves the window, so tips would otherwise stick.
 */
export function ensureHoverTipWindowClear(): void {
    if (windowClearWired) return;
    windowClearWired = true;
    document.documentElement.addEventListener('mouseleave', () => clearAllHoverTips());
    window.addEventListener('blur', () => clearAllHoverTips());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') clearAllHoverTips();
    });
}
