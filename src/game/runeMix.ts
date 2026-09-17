/**
 * Elemental mix identity for forgeable runes: a non-empty subset of the four
 * bases at a shared level 1–9. Shown as one pre-made atlas icon; level is a
 * HUD digit (not art).
 *
 * Catalog ids: pure L1 keeps `earth` / `fire` / …; higher levels use
 * `earth:3`; mixes use `earth-fire` / `earth-fire:2` (elements sorted
 * earth < fire < water < wind). 15 mixes × 9 levels = 135 defs, generated
 * at registry load from the four base ItemDefs.
 *
 * Atlas ids: `item-earth`, `item-fire`, … and mixes `item-earth-fire`, …
 */
import type { ItemDef } from './items';

export const RUNE_ELEMENTS = ['earth', 'fire', 'water', 'wind'] as const;
export type RuneElement = (typeof RUNE_ELEMENTS)[number];

/** Shared level cap for elemental runes. */
export const RUNE_MAX_LEVEL = 9;

/** Flat Stronghold supply to bake — forging is free; card prices stay separate. */
export const ELEMENTAL_FORGE_COST = 0;

const ELEMENT_SET = new Set<string>(RUNE_ELEMENTS);

const ELEMENT_LABEL: Record<RuneElement, string> = {
    earth: 'Earth',
    fire: 'Fire',
    water: 'Water',
    wind: 'Wind',
};

const MOD_KEYS = ['hp', 'damage', 'range', 'speed', 'attackInterval'] as const;
type ModKey = (typeof MOD_KEYS)[number];

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

export interface ElementalRuneRef {
    elements: RuneElement[];
    level: number;
}

/**
 * Parse an elemental catalog id (`earth`, `earth:3`, `earth-fire`,
 * `earth-fire:2`). Returns null for advanced / unknown ids.
 */
export function parseElementalId(id: string): ElementalRuneRef | null {
    const m = /^([a-z]+(?:-[a-z]+)*)(?::([1-9]))?$/.exec(id);
    if (!m) return null;
    const raw = m[1]!;
    const elements = normalizeMix(raw.split('-'));
    if (elements.length === 0 || elements.join('-') !== raw) return null;
    const level = m[2] ? Number(m[2]) : 1;
    if (level < 1 || level > RUNE_MAX_LEVEL) return null;
    return { elements, level };
}

/** Encode mix + level; level 1 omits the `:n` suffix (keeps shop ids `earth`…). */
export function encodeElementalId(elements: readonly string[], level: number): string | null {
    const mix = normalizeMix(elements);
    if (mix.length === 0) return null;
    const lv = Math.max(1, Math.min(RUNE_MAX_LEVEL, Math.floor(level)));
    const base = mix.join('-');
    return lv === 1 ? base : `${base}:${lv}`;
}

/** True when `id` is one of the 135 elemental catalog entries. */
export function isElementalRuneId(id: string): boolean {
    return parseElementalId(id) !== null;
}

/** Shared level for HUD digit; 0 if not elemental. */
export function elementalLevel(id: string): number {
    return parseElementalId(id)?.level ?? 0;
}

/**
 * Merge 2+ elemental oven runes:
 * - same mix → add levels (cap {@link RUNE_MAX_LEVEL})
 * - different mixes → union of elements, level = min
 */
export function mergeElementalIds(ids: readonly string[]): string | null {
    if (ids.length < 2) return null;
    const parts: ElementalRuneRef[] = [];
    for (const id of ids) {
        const p = parseElementalId(id);
        if (!p) return null;
        parts.push(p);
    }
    const key0 = parts[0]!.elements.join('-');
    const sameMix = parts.every((p) => p.elements.join('-') === key0);
    if (sameMix) {
        const sum = Math.min(
            RUNE_MAX_LEVEL,
            parts.reduce((s, p) => s + p.level, 0),
        );
        return encodeElementalId(parts[0]!.elements, sum);
    }
    const union = normalizeMix(parts.flatMap((p) => p.elements));
    const level = Math.min(...parts.map((p) => p.level));
    return encodeElementalId(union, level);
}

function scaleMods(
    mix: readonly RuneElement[],
    level: number,
    bases: ReadonlyMap<RuneElement, ItemDef>,
): ItemDef['mods'] {
    const out: ItemDef['mods'] = {};
    for (const key of MOD_KEYS) {
        let bonus = 0;
        for (const el of mix) {
            const m = bases.get(el)?.mods[key];
            if (m !== undefined) bonus += (m - 1) * level;
        }
        if (Math.abs(bonus) > 1e-9) out[key] = 1 + bonus;
    }
    return out;
}

function formatModDescription(mods: ItemDef['mods']): string {
    const bits: string[] = [];
    const pct = (n: number) => {
        const v = Math.round((n - 1) * 100);
        return `${v >= 0 ? '+' : ''}${v}%`;
    };
    if (mods.damage !== undefined && mods.hp !== undefined && mods.damage === mods.hp) {
        bits.push(`${pct(mods.damage)} attack and HP`);
    } else {
        if (mods.damage !== undefined) bits.push(`${pct(mods.damage)} attack`);
        if (mods.hp !== undefined) bits.push(`${pct(mods.hp)} HP`);
    }
    if (mods.range !== undefined) bits.push(`${pct(mods.range)} range`);
    if (mods.speed !== undefined) bits.push(`${pct(mods.speed)} speed`);
    if (mods.attackInterval !== undefined) {
        bits.push(`${pct(mods.attackInterval)} attack interval`);
    }
    return bits.length === 0 ? '' : `${bits.join('. ')}.`;
}

/**
 * Build all 135 elemental ItemDefs from the four pure L1 bases in `bases`.
 * Pure L1 entries keep their authored id/name/description; everything else
 * is synthesized. Caller should keep shop buyable ids as the original four.
 */
export function generateElementalRunes(bases: readonly ItemDef[]): ItemDef[] {
    const byElement = new Map<RuneElement, ItemDef>();
    for (const b of bases) {
        if (isRuneElement(b.id)) byElement.set(b.id, b);
    }
    for (const el of RUNE_ELEMENTS) {
        if (!byElement.has(el)) {
            throw new Error(`[runeMix] missing base rune "${el}" for elemental catalog`);
        }
    }

    const out: ItemDef[] = [];
    for (const mix of allElementMixes()) {
        for (let level = 1; level <= RUNE_MAX_LEVEL; level++) {
            const id = encodeElementalId(mix, level)!;
            if (mix.length === 1 && level === 1) {
                const base = byElement.get(mix[0]!)!;
                out.push({
                    ...base,
                });
                continue;
            }
            const mods = scaleMods(mix, level, byElement);
            const name =
                level > 1 ? `${mixDisplayName(mix)} ${level}` : mixDisplayName(mix);
            const descParts: string[] = [];
            if (mix.length >= 2) descParts.push(mixDescription(mix));
            const modDesc = formatModDescription(mods);
            if (modDesc) descParts.push(modDesc);
            out.push({
                id,
                name,
                tier: 'base',
                icon: mixIconId(mix)!,
                mods,
                cardCost: 0,
                description: descParts.join(' ') || name,
            });
        }
    }
    return out;
}
