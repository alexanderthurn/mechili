import i18next, { type TOptions } from 'i18next';

import { detectDeviceLanguage } from './detect';
import { isLanguageId, LANGUAGE_IDS, type LanguageId } from './languages';

import enCommon from '../../locales/en/common.json';
import enSettings from '../../locales/en/settings.json';
import ruCommon from '../../locales/ru/common.json';
import ruSettings from '../../locales/ru/settings.json';
import zhCommon from '../../locales/zh/common.json';
import zhSettings from '../../locales/zh/settings.json';

export type { LanguageId } from './languages';
export {
    LANGUAGE_IDS,
    LANGUAGE_NATIVE_NAMES,
    isLanguageId,
} from './languages';

const NAMESPACES = ['common', 'settings'] as const;

const resources = {
    en: { common: enCommon, settings: enSettings },
    ru: { common: ruCommon, settings: ruSettings },
    zh: { common: zhCommon, settings: zhSettings },
} as const;

let ready = false;

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

/** Switch language (Settings). Caller persists prefs + applies the matching font. */
export async function setLanguage(language: LanguageId): Promise<LanguageId> {
    if (!ready) return initI18n(language);
    await i18next.changeLanguage(language);
    document.documentElement.lang = language;
    return language;
}

/**
 * Look up a key. Prefer `ns:key` (`settings:title`) or pass `{ ns: 'settings' }`.
 * Missing keys fall back to English, then to the key itself.
 */
export function t(key: string, options?: TOptions): string {
    if (!ready) return key;
    return i18next.t(key, options);
}
