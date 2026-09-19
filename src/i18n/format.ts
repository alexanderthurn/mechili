/**
 * Content display helpers. English on defs remains the fallback when a key is missing.
 */
import { getLanguage, t } from './index';
import { parseElementalId } from '../game/runeMix';

/**
 * Casing for vocabulary terms interpolated mid-sentence.
 * English lowercases ("a commander"); German keeps noun capitals ("einen Kommandant").
 */
export function midTerm(value: string): string {
    return getLanguage() === 'en' ? value.toLowerCase() : value;
}

export function term(
    id:
        | 'rune'
        | 'runes'
        | 'talent'
        | 'talents'
        | 'spell'
        | 'spells'
        | 'commander'
        | 'commanders'
        | 'horde',
): string {
    const fallback: Record<typeof id, string> = {
        rune: 'Rune',
        runes: 'Runes',
        talent: 'Talent',
        talents: 'Talents',
        spell: 'Spell',
        spells: 'Spells',
        commander: 'Commander',
        commanders: 'Commanders',
        horde: 'The Komtur',
    };
    return t(`common:term.${id}`, { defaultValue: fallback[id] });
}

export function unitName(id: string, fallback?: string): string {
    return t(`units:${id}.name`, { defaultValue: fallback ?? id });
}

/**
 * A generated elemental rune (a mix, or level 2+) — its name and description are
 * built in code, so they are composed from translated pieces here instead.
 * Pure level-1 runes keep their authored, translated entry.
 */
function elementalRune(id: string): { elements: string[]; level: number } | null {
    return parseElementalId(id);
}

/** pure level-1 runes (earth / fire / water / wind) keep their authored, translated name */
function authoredElementalName(mix: { elements: string[]; level: number }): boolean {
    return mix.elements.length === 1 && mix.level === 1;
}

export function itemName(id: string, fallback?: string): string {
    const mix = elementalRune(id);
    if (mix && !authoredElementalName(mix)) {
        const names = mix.elements.map((e) => t(`items:${e}.name`, { defaultValue: e })).join(' ');
        return mix.level > 1 ? `${names} ${mix.level}` : names;
    }
    return t(`items:${id}.name`, { defaultValue: fallback ?? id });
}

/** "+30%" / "−10%" from a multiplier */
function modPercent(value: number): string {
    const v = Math.round((value - 1) * 100);
    return `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;
}

function elementalModText(mods: RuneMods): string {
    const bits: string[] = [];
    const line = (key: string, pct: string, fallback: string): string =>
        t(`items:mix.${key}`, { pct, defaultValue: fallback });
    if (mods.damage !== undefined && mods.hp !== undefined && mods.damage === mods.hp) {
        bits.push(line('attackHp', modPercent(mods.damage), `${modPercent(mods.damage)} attack and HP`));
    } else {
        if (mods.damage !== undefined) bits.push(line('attack', modPercent(mods.damage), `${modPercent(mods.damage)} attack`));
        if (mods.hp !== undefined) bits.push(line('hp', modPercent(mods.hp), `${modPercent(mods.hp)} HP`));
    }
    if (mods.range !== undefined) bits.push(line('range', modPercent(mods.range), `${modPercent(mods.range)} range`));
    if (mods.speed !== undefined) bits.push(line('speed', modPercent(mods.speed), `${modPercent(mods.speed)} speed`));
    if (mods.attackInterval !== undefined) {
        bits.push(line('interval', modPercent(mods.attackInterval), `${modPercent(mods.attackInterval)} attack interval`));
    }
    return bits.length === 0 ? '' : `${bits.join('. ')}.`;
}

export type RuneMods = Partial<{
    hp: number;
    damage: number;
    range: number;
    speed: number;
    attackInterval: number;
}>;

export function itemDescription(id: string, fallback?: string, mods?: RuneMods): string {
    const mix = elementalRune(id);
    if (mix) {
        const parts: string[] = [];
        if (mix.elements.length > 1) {
            const names = mix.elements.map((e) => t(`items:${e}.name`, { defaultValue: e })).join(' ');
            parts.push(t('items:mix.forged', { elements: names, defaultValue: `Forged mix of ${names}.` }));
        }
        if (mods) {
            const stats = elementalModText(mods);
            if (stats) parts.push(stats);
        }
        if (parts.length > 0) return parts.join(' ');
    }
    return t(`items:${id}.description`, { defaultValue: fallback ?? '' });
}

export function tacticName(id: string, fallback?: string): string {
    return t(`tactics:${id}.name`, { defaultValue: fallback ?? id });
}

export function tacticDescription(id: string, fallback?: string): string {
    return t(`tactics:${id}.description`, { defaultValue: fallback ?? '' });
}

export function techName(id: string, fallback?: string): string {
    return t(`tech:${id}.name`, { defaultValue: fallback ?? id });
}

/** Hand-written talent blurbs — empty string if none (caller may build from mods). */
export function techBlurb(
    id: string,
    fallback?: string,
    vars?: Record<string, string | number>,
): string {
    if (fallback === undefined) {
        return t(`tech:${id}.description`, { defaultValue: '', ...vars });
    }
    return t(`tech:${id}.description`, { defaultValue: fallback, ...vars });
}

export function commanderTitle(id: string, fallback?: string): string {
    return t(`commanders:${id}.title`, { defaultValue: fallback ?? id });
}

export function commanderDescription(id: string, fallback?: string): string {
    return t(`commanders:${id}.description`, { defaultValue: fallback ?? '' });
}

export function commanderUnitsLabel(id: string, fallback?: string): string {
    return t(`commanders:${id}.unitsLabel`, { defaultValue: fallback ?? '' });
}

/**
 * Spoken VO line for a commander event. English lives in commander jsonc
 * (`voice.lines`); locales may override via `commanders:<id>.voice.<event>`.
 * Provider bindings live in `voice.externalIds`. Returns '' when neither is set.
 */
export function commanderVoiceLine(
    id: string,
    event: string,
    fallbacks?: readonly string[] | null,
): string {
    const fallback = fallbacks?.[0] ?? '';
    return t(`commanders:${id}.voice.${event}`, { defaultValue: fallback });
}

export function roundCardTitle(id: string, fallback?: string): string {
    const fromItem = t(`items:${id}.name`, { defaultValue: '' });
    if (fromItem) return fromItem;
    return t(`roundCards:${id}.title`, { defaultValue: fallback ?? id });
}

export function roundCardDescription(id: string, fallback?: string): string {
    const fromItem = t(`items:${id}.description`, { defaultValue: '' });
    if (fromItem) return fromItem;
    return t(`roundCards:${id}.description`, { defaultValue: fallback ?? '' });
}

export function roundCardUnitsLabel(id: string, fallback?: string): string {
    return t(`roundCards:${id}.unitsLabel`, { defaultValue: fallback ?? '' });
}

export function buildingAbilityName(key: string, fallback?: string): string {
    return t(`buildings:${key}.name`, { defaultValue: fallback ?? key });
}

export function buildingAbilityDescription(
    key: string,
    fallback: string,
    vars?: Record<string, string | number>,
): string {
    return t(`buildings:${key}.description`, {
        defaultValue: fallback,
        ...vars,
    });
}
