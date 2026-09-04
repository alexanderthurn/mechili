import i18next, { type TOptions } from 'i18next';

import { detectDeviceLanguage } from './detect';
import { isLanguageId, LANGUAGE_IDS, type LanguageId } from './languages';

import enBuildings from '../../locales/en/buildings.json';
import enCommanders from '../../locales/en/commanders.json';
import enCommon from '../../locales/en/common.json';
import enHomepage from '../../locales/en/homepage.json';
import enHud from '../../locales/en/hud.json';
import enItems from '../../locales/en/items.json';
import enMenu from '../../locales/en/menu.json';
import enRoundCards from '../../locales/en/roundCards.json';
import enSettings from '../../locales/en/settings.json';
import enSuggest from '../../locales/en/suggest.json';
import enTactics from '../../locales/en/tactics.json';
import enTech from '../../locales/en/tech.json';
import enUnits from '../../locales/en/units.json';

import ruBuildings from '../../locales/ru/buildings.json';
import ruCommanders from '../../locales/ru/commanders.json';
import ruCommon from '../../locales/ru/common.json';
import ruHomepage from '../../locales/ru/homepage.json';
import ruHud from '../../locales/ru/hud.json';
import ruItems from '../../locales/ru/items.json';
import ruMenu from '../../locales/ru/menu.json';
import ruRoundCards from '../../locales/ru/roundCards.json';
import ruSettings from '../../locales/ru/settings.json';
import ruSuggest from '../../locales/ru/suggest.json';
import ruTactics from '../../locales/ru/tactics.json';
import ruTech from '../../locales/ru/tech.json';
import ruUnits from '../../locales/ru/units.json';

import zhBuildings from '../../locales/zh/buildings.json';
import zhCommanders from '../../locales/zh/commanders.json';
import zhCommon from '../../locales/zh/common.json';
import zhHomepage from '../../locales/zh/homepage.json';
import zhHud from '../../locales/zh/hud.json';
import zhItems from '../../locales/zh/items.json';
import zhMenu from '../../locales/zh/menu.json';
import zhRoundCards from '../../locales/zh/roundCards.json';
import zhSettings from '../../locales/zh/settings.json';
import zhSuggest from '../../locales/zh/suggest.json';
import zhTactics from '../../locales/zh/tactics.json';
import zhTech from '../../locales/zh/tech.json';
import zhUnits from '../../locales/zh/units.json';

export type { LanguageId } from './languages';
export {
    LANGUAGE_IDS,
    LANGUAGE_NATIVE_NAMES,
    isLanguageId,
} from './languages';
export * from './format';

const NAMESPACES = [
    'common',
    'settings',
    'menu',
    'hud',
    'homepage',
    'suggest',
    'units',
    'items',
    'tactics',
    'tech',
    'commanders',
    'roundCards',
    'buildings',
] as const;

const resources = {
    en: {
        common: enCommon,
        settings: enSettings,
        menu: enMenu,
        hud: enHud,
        homepage: enHomepage,
        suggest: enSuggest,
        units: enUnits,
        items: enItems,
        tactics: enTactics,
        tech: enTech,
        commanders: enCommanders,
        roundCards: enRoundCards,
        buildings: enBuildings,
    },
    ru: {
        common: ruCommon,
        settings: ruSettings,
        menu: ruMenu,
        hud: ruHud,
        homepage: ruHomepage,
        suggest: ruSuggest,
        units: ruUnits,
        items: ruItems,
        tactics: ruTactics,
        tech: ruTech,
        commanders: ruCommanders,
        roundCards: ruRoundCards,
        buildings: ruBuildings,
    },
    zh: {
        common: zhCommon,
        settings: zhSettings,
        menu: zhMenu,
        hud: zhHud,
        homepage: zhHomepage,
        suggest: zhSuggest,
        units: zhUnits,
        items: zhItems,
        tactics: zhTactics,
        tech: zhTech,
        commanders: zhCommanders,
        roundCards: zhRoundCards,
        buildings: zhBuildings,
    },
} as const;

let ready = false;
const languageListeners: Array<() => void> = [];

/**
 * Boot i18n once before menu chrome. Prefer an explicit language (prefs), else
 * the device language if we ship it, else English.
 */
export async function initI18n(language?: LanguageId): Promise<LanguageId> {
    const lng = language ?? detectDeviceLanguage();
    if (!ready) {
        await i18next.init({
            lng,
            fallbackLng: 'en',
            supportedLngs: [...LANGUAGE_IDS],
            defaultNS: 'common',
            ns: [...NAMESPACES],
            resources,
            interpolation: { escapeValue: false },
            returnNull: false,
        });
        ready = true;
    } else {
        await i18next.changeLanguage(lng);
    }
    document.documentElement.lang = i18next.language;
    return getLanguage();
}

export function getLanguage(): LanguageId {
    const lng = i18next.language?.split('-')[0];
    return isLanguageId(lng) ? lng : 'en';
}

function notifyLanguageListeners(): void {
    for (const listener of [...languageListeners]) listener();
}

/** Switch language (Settings). Caller persists prefs + applies the matching font. */
export async function setLanguage(language: LanguageId): Promise<LanguageId> {
    if (!ready) {
        const lng = await initI18n(language);
        notifyLanguageListeners();
        return lng;
    }
    await i18next.changeLanguage(language);
    document.documentElement.lang = language;
    notifyLanguageListeners();
    return language;
}

/** Fired after a successful language switch (and after init via setLanguage). */
export function onLanguageChange(listener: () => void): () => void {
    languageListeners.push(listener);
    return () => {
        const i = languageListeners.indexOf(listener);
        if (i >= 0) languageListeners.splice(i, 1);
    };
}

/**
 * Look up a key. Prefer `ns:key` (`settings:title`) or pass `{ ns: 'settings' }`.
 * Missing keys fall back to English, then to the key itself.
 */
export function t(key: string, options?: TOptions): string {
    if (!ready) return key;
    return i18next.t(key, options);
}
