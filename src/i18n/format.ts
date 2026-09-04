/**
 * Content display helpers. English on defs remains the fallback when a key is missing.
 */
import { t } from './index';

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

export function itemName(id: string, fallback?: string): string {
    return t(`items:${id}.name`, { defaultValue: fallback ?? id });
}

export function itemDescription(id: string, fallback?: string): string {
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
export function techBlurb(id: string, fallback?: string): string {
    if (fallback === undefined) {
        const v = t(`tech:${id}.description`, { defaultValue: '' });
        return v;
    }
    return t(`tech:${id}.description`, { defaultValue: fallback });
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
