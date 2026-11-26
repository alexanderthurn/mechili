
/** "Keys 1–6" / "Keys 1–9, 0 = 32×" — built from the steps actually offered. */
export function speedKeyHint(steps: readonly number[]): string {
    const keyed = Math.min(steps.length, 9);
    const base = keyed > 1 ? `Keys 1–${keyed}` : 'Key 1';
    return steps.length > 9 ? `${base}, 0 = ${steps[steps.length - 1]}×` : base;
}
