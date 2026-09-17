/**
 * Elemental mix identity for forgeable runes: a non-empty subset of the four
 * bases, shown as one pre-made atlas icon (levels are a HUD digit, not art).
 *
 * Atlas ids: `item-earth`, `item-fire`, … and mixes `item-earth-fire`, …
 * (elements sorted earth < fire < water < wind).
 */
export const RUNE_ELEMENTS = ['earth', 'fire', 'water', 'wind'] as const;
export type RuneElement = (typeof RUNE_ELEMENTS)[number];

const ELEMENT_SET = new Set<string>(RUNE_ELEMENTS);

const ELEMENT_LABEL: Record<RuneElement, string> = {
    earth: 'Earth',
    fire: 'Fire',
    water: 'Water',
    wind: 'Wind',
};

export function isRuneElement(id: string): id is RuneElement {
    return ELEMENT_SET.has(id);
}

/** Canonical sorted unique elements for a mix (empty if none valid). */
export function normalizeMix(elements: readonly string[]): RuneElement[] {
    const set = new Set<RuneElement>();
    for (const e of elements) {
        if (isRuneElement(e)) set.add(e);
    }
    return RUNE_ELEMENTS.filter((e) => set.has(e));
}

/** Stable catalog-style id for a mix (`earth`, `earth-fire`, …). */
export function mixId(elements: readonly string[]): string | null {
    const mix = normalizeMix(elements);
    if (mix.length === 0) return null;
    return mix.join('-');
}

/** Atlas icon id for a mix — one plate per combination, no level in the art. */
export function mixIconId(elements: readonly string[]): string | null {
    const id = mixId(elements);
    return id ? `item-${id}` : null;
}

/** Every non-empty elemental mix (15), pure first then by size. */
export function allElementMixes(): RuneElement[][] {
    const out: RuneElement[][] = [];
    const n = RUNE_ELEMENTS.length;
    for (let mask = 1; mask < 1 << n; mask++) {
        const parts: RuneElement[] = [];
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) parts.push(RUNE_ELEMENTS[i]!);
        }
        out.push(parts);
    }
    return out.sort((a, b) => a.length - b.length || a.join('-').localeCompare(b.join('-')));
}

/** Multi-element mixes only (11) — homepage / forge products beyond the shop bases. */
export function mixedElementMixes(): RuneElement[][] {
    return allElementMixes().filter((m) => m.length >= 2);
}

export function mixDisplayName(elements: readonly string[]): string {
    const mix = normalizeMix(elements);
    return mix.map((e) => ELEMENT_LABEL[e]).join(' ');
}

export function mixDescription(elements: readonly string[]): string {
    const mix = normalizeMix(elements);
    if (mix.length < 2) return '';
    return `Forged mix of ${mixDisplayName(mix)}.`;
}

/** All 15 mix atlas ids (4 pure + 11 combinations). */
export function allMixIconIds(): string[] {
    return allElementMixes().map((m) => `item-${m.join('-')}`);
}
