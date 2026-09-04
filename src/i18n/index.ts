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

import zhtBuildings from '../../locales/zh-Hant/buildings.json';
import zhtCommanders from '../../locales/zh-Hant/commanders.json';
import zhtCommon from '../../locales/zh-Hant/common.json';
import zhtHomepage from '../../locales/zh-Hant/homepage.json';
import zhtHud from '../../locales/zh-Hant/hud.json';
import zhtItems from '../../locales/zh-Hant/items.json';
import zhtMenu from '../../locales/zh-Hant/menu.json';
import zhtRoundCards from '../../locales/zh-Hant/roundCards.json';
import zhtSettings from '../../locales/zh-Hant/settings.json';
import zhtSuggest from '../../locales/zh-Hant/suggest.json';
import zhtTactics from '../../locales/zh-Hant/tactics.json';
import zhtTech from '../../locales/zh-Hant/tech.json';
import zhtUnits from '../../locales/zh-Hant/units.json';

import koBuildings from '../../locales/ko/buildings.json';
import koCommanders from '../../locales/ko/commanders.json';
import koCommon from '../../locales/ko/common.json';
import koHomepage from '../../locales/ko/homepage.json';
import koHud from '../../locales/ko/hud.json';
import koItems from '../../locales/ko/items.json';
import koMenu from '../../locales/ko/menu.json';
import koRoundCards from '../../locales/ko/roundCards.json';
import koSettings from '../../locales/ko/settings.json';
import koSuggest from '../../locales/ko/suggest.json';
import koTactics from '../../locales/ko/tactics.json';
import koTech from '../../locales/ko/tech.json';
import koUnits from '../../locales/ko/units.json';

import jaBuildings from '../../locales/ja/buildings.json';
import jaCommanders from '../../locales/ja/commanders.json';
import jaCommon from '../../locales/ja/common.json';
import jaHomepage from '../../locales/ja/homepage.json';
import jaHud from '../../locales/ja/hud.json';
import jaItems from '../../locales/ja/items.json';
import jaMenu from '../../locales/ja/menu.json';
import jaRoundCards from '../../locales/ja/roundCards.json';
import jaSettings from '../../locales/ja/settings.json';
import jaSuggest from '../../locales/ja/suggest.json';
import jaTactics from '../../locales/ja/tactics.json';
import jaTech from '../../locales/ja/tech.json';
import jaUnits from '../../locales/ja/units.json';

import thBuildings from '../../locales/th/buildings.json';
import thCommanders from '../../locales/th/commanders.json';
import thCommon from '../../locales/th/common.json';
import thHomepage from '../../locales/th/homepage.json';
import thHud from '../../locales/th/hud.json';
import thItems from '../../locales/th/items.json';
import thMenu from '../../locales/th/menu.json';
import thRoundCards from '../../locales/th/roundCards.json';
import thSettings from '../../locales/th/settings.json';
import thSuggest from '../../locales/th/suggest.json';
import thTactics from '../../locales/th/tactics.json';
import thTech from '../../locales/th/tech.json';
import thUnits from '../../locales/th/units.json';

import arBuildings from '../../locales/ar/buildings.json';
import arCommanders from '../../locales/ar/commanders.json';
import arCommon from '../../locales/ar/common.json';
import arHomepage from '../../locales/ar/homepage.json';
import arHud from '../../locales/ar/hud.json';
import arItems from '../../locales/ar/items.json';
import arMenu from '../../locales/ar/menu.json';
import arRoundCards from '../../locales/ar/roundCards.json';
import arSettings from '../../locales/ar/settings.json';
import arSuggest from '../../locales/ar/suggest.json';
import arTactics from '../../locales/ar/tactics.json';
import arTech from '../../locales/ar/tech.json';
import arUnits from '../../locales/ar/units.json';

import elBuildings from '../../locales/el/buildings.json';
import elCommanders from '../../locales/el/commanders.json';
import elCommon from '../../locales/el/common.json';
import elHomepage from '../../locales/el/homepage.json';
import elHud from '../../locales/el/hud.json';
import elItems from '../../locales/el/items.json';
import elMenu from '../../locales/el/menu.json';
import elRoundCards from '../../locales/el/roundCards.json';
import elSettings from '../../locales/el/settings.json';
import elSuggest from '../../locales/el/suggest.json';
import elTactics from '../../locales/el/tactics.json';
import elTech from '../../locales/el/tech.json';
import elUnits from '../../locales/el/units.json';

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

type LocaleBundle = {
    common: typeof enCommon;
    settings: typeof enSettings;
    menu: typeof enMenu;
    hud: typeof enHud;
    homepage: typeof enHomepage;
    suggest: typeof enSuggest;
    units: typeof enUnits;
    items: typeof enItems;
    tactics: typeof enTactics;
    tech: typeof enTech;
    commanders: typeof enCommanders;
    roundCards: typeof enRoundCards;
    buildings: typeof enBuildings;
};

function bundle(parts: LocaleBundle): LocaleBundle {
    return parts;
}

const resources: Record<LanguageId, LocaleBundle> = {
    en: bundle({
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
    }),
    ru: bundle({
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
    }),
    zh: bundle({
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
    }),
    'zh-Hant': bundle({
        common: zhtCommon,
        settings: zhtSettings,
        menu: zhtMenu,
        hud: zhtHud,
        homepage: zhtHomepage,
        suggest: zhtSuggest,
        units: zhtUnits,
        items: zhtItems,
        tactics: zhtTactics,
        tech: zhtTech,
        commanders: zhtCommanders,
        roundCards: zhtRoundCards,
        buildings: zhtBuildings,
    }),
    ko: bundle({
        common: koCommon,
        settings: koSettings,
        menu: koMenu,
        hud: koHud,
        homepage: koHomepage,
        suggest: koSuggest,
        units: koUnits,
        items: koItems,
        tactics: koTactics,
        tech: koTech,
        commanders: koCommanders,
        roundCards: koRoundCards,
        buildings: koBuildings,
    }),
    ja: bundle({
        common: jaCommon,
        settings: jaSettings,
        menu: jaMenu,
        hud: jaHud,
        homepage: jaHomepage,
        suggest: jaSuggest,
        units: jaUnits,
        items: jaItems,
        tactics: jaTactics,
        tech: jaTech,
        commanders: jaCommanders,
        roundCards: jaRoundCards,
        buildings: jaBuildings,
    }),
    th: bundle({
        common: thCommon,
        settings: thSettings,
        menu: thMenu,
        hud: thHud,
        homepage: thHomepage,
        suggest: thSuggest,
        units: thUnits,
        items: thItems,
        tactics: thTactics,
        tech: thTech,
        commanders: thCommanders,
        roundCards: thRoundCards,
        buildings: thBuildings,
    }),
    ar: bundle({
        common: arCommon,
        settings: arSettings,
        menu: arMenu,
        hud: arHud,
        homepage: arHomepage,
        suggest: arSuggest,
        units: arUnits,
        items: arItems,
        tactics: arTactics,
        tech: arTech,
        commanders: arCommanders,
        roundCards: arRoundCards,
        buildings: arBuildings,
    }),
    el: bundle({
        common: elCommon,
        settings: elSettings,
        menu: elMenu,
        hud: elHud,
        homepage: elHomepage,
        suggest: elSuggest,
        units: elUnits,
        items: elItems,
        tactics: elTactics,
        tech: elTech,
        commanders: elCommanders,
        roundCards: elRoundCards,
        buildings: elBuildings,
    }),
};

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
            nonExplicitSupportedLngs: false,
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
    document.documentElement.dir = getLanguage() === 'ar' ? 'rtl' : 'ltr';
    return getLanguage();
}

export function getLanguage(): LanguageId {
    const lng = i18next.language ?? '';
    if (isLanguageId(lng)) return lng;
    // i18next may return regional tags like zh-Hant-TW
    if (lng.toLowerCase().startsWith('zh-hant')) return 'zh-Hant';
    const primary = lng.split('-')[0];
    return isLanguageId(primary) ? primary : 'en';
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
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
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
