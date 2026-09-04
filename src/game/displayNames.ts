/**
 * Player-facing names for systems that keep technical ids in code
 * (`item` / `tech` / `tactic` / …). Prefer these in HUD, homepage, cards, and docs copy.
 *
 * Values resolve through i18n (`common:term.*`) so language switches update live.
 * English strings below are the fallback before i18n boots / for missing keys.
 */
import { term } from '../i18n/format';

const FALLBACK = {
    item: 'Rune',
    items: 'Runes',
    tech: 'Talent',
    techs: 'Talents',
    tactic: 'Spell',
    tactics: 'Spells',
    commander: 'Commander',
    commanders: 'Commanders',
    horde: 'The Komtur',
} as const;

export const DISPLAY = {
    get item() {
        return term('rune') || FALLBACK.item;
    },
    get items() {
        return term('runes') || FALLBACK.items;
    },
    get tech() {
        return term('talent') || FALLBACK.tech;
    },
    get techs() {
        return term('talents') || FALLBACK.techs;
    },
    get tactic() {
        return term('spell') || FALLBACK.tactic;
    },
    get tactics() {
        return term('spells') || FALLBACK.tactics;
    },
    get commander() {
        return term('commander') || FALLBACK.commander;
    },
    get commanders() {
        return term('commanders') || FALLBACK.commanders;
    },
    /**
     * Neutral forest-wave faction (`team === 'horde'`, presets, menu).
     * Keep `horde` in code / unit ids; this string is what players see.
     */
    get horde() {
        return term('horde') || FALLBACK.horde;
    },
} as const;
