/**
 * Digit shortcuts for the battle / replay speed steps, shared by the HUD
 * button tooltip and the watch-mode speed <select> so neither can drift from
 * the arrays in Game. Mirrors Game.speedShortcutIndex: 1–9 map to the first
 * nine steps, and 0 only exists when there is a tenth.
 */

/** Digit label for a step, or null when the step has no shortcut. */
export function speedKeyFor(index: number, stepCount: number): string | null {
    if (index === 9 && stepCount > 9) return '0';
    return index < 9 ? String(index + 1) : null;
}

/** "Keys 1–6" / "Keys 1–9, 0 = 32×" — built from the steps actually offered. */
export function speedKeyHint(steps: readonly number[]): string {
    const keyed = Math.min(steps.length, 9);
    const base = keyed > 1 ? `Keys 1–${keyed}` : 'Key 1';
    return steps.length > 9 ? `${base}, 0 = ${steps[steps.length - 1]}×` : base;
}
