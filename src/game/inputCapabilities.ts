/**
 * Detects and tracks which input method the player is currently using —
 * mouse, touch, or gamepad — so camera/placement/HUD code can branch on one
 * value instead of checking `e.button`/`pointerType` ad hoc in every file.
 *
 * `inputMode()` is a "last input used" signal (updates live as the player
 * switches devices, e.g. a touchscreen laptop with a mouse plugged in).
 * `hasTouchSupport()`/`hasGamepadConnected()` are separate device-trait
 * queries for "is this available at all", since gamepad presence is
 * orthogonal to mouse/touch (a phone + Bluetooth controller is valid).
 */

export type InputMode = 'mouse' | 'touch' | 'gamepad';

let mode: InputMode = initialGuess();
const listeners: ((mode: InputMode) => void)[] = [];
let disposers: (() => void)[] | null = null;

function initialGuess(): InputMode {
    return touchFirstDevice() ? 'touch' : 'mouse';
}

function matchMediaCoarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** True when the primary pointer is coarse (phone/tablet) — device trait for first-run defaults. */
export function touchFirstDevice(): boolean {
    return hasTouchSupport() && matchMediaCoarsePointer();
}

function setMode(next: InputMode): void {
    if (next === mode) return;
    mode = next;
    for (const listener of [...listeners]) listener(mode);
}

/** The input method most recently used, best guess before any input yet. */
export function inputMode(): InputMode {
    return mode;
}

/** Notified whenever the active input method changes; returns the unsubscribe function. */
export function onInputModeChange(listener: (mode: InputMode) => void): () => void {
    listeners.push(listener);
    return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
    };
}

/** True when the device reports any touch capability at all (trait, not "currently active"). */
export function hasTouchSupport(): boolean {
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

/** True when at least one gamepad is currently connected. */
export function hasGamepadConnected(): boolean {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    for (const pad of navigator.getGamepads()) {
        if (pad) return true;
    }
    return false;
}

/**
 * Starts observing real input events to keep `inputMode()` current as the
 * player switches devices mid-session. Call once at boot; returns a disposer.
 * Idempotent — a second call disposes the previous listeners first.
 *
 * Gamepad detection here is a coarse "connected → assume active" heuristic;
 * the real per-frame stick-driven virtual cursor lands in a later phase.
 */
export function initInputCapabilities(): () => void {
    disposers?.forEach((d) => d());

    const onPointerEvent = (e: PointerEvent) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') setMode('touch');
        else if (e.pointerType === 'mouse') setMode('mouse');
    };
    const onGamepadConnected = () => setMode('gamepad');

    window.addEventListener('pointerdown', onPointerEvent, { capture: true, passive: true });
    window.addEventListener('pointermove', onPointerEvent, { capture: true, passive: true });
    window.addEventListener('gamepadconnected', onGamepadConnected);

    disposers = [
        () => window.removeEventListener('pointerdown', onPointerEvent, true),
        () => window.removeEventListener('pointermove', onPointerEvent, true),
        () => window.removeEventListener('gamepadconnected', onGamepadConnected),
    ];
    return () => {
        disposers?.forEach((d) => d());
        disposers = null;
    };
}
