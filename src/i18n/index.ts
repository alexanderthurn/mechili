import i18next, { type TOptions } from 'i18next';

import { detectDeviceLanguage } from './detect';
import { isLanguageId, LANGUAGE_IDS, type LanguageId } from './languages';

export type { LanguageId } from './languages';
export {
    LANGUAGE_IDS,
    LANGUAGE_NATIVE_NAMES,
    EXO2_LANGUAGE_IDS,
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

type Namespace = (typeof NAMESPACES)[number];

/** Eager locale JSON — one entry per `locales/<lang>/<ns>.json`. */
const localeFiles = import.meta.glob('../../locales/*/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, Record<string, unknown>>;

function loadNamespace(lang: LanguageId, ns: Namespace): Record<string, unknown> {
    const path = `../../locales/${lang}/${ns}.json`;
    const data = localeFiles[path];
    if (!data) {
        throw new Error(`Missing locale file ${path}`);
    }
    return data;
}

function loadLanguage(lang: LanguageId): Record<Namespace, Record<string, unknown>> {
    const out = {} as Record<Namespace, Record<string, unknown>>;
    for (const ns of NAMESPACES) {
        out[ns] = loadNamespace(lang, ns);
    }
    return out;
}

const resources = Object.fromEntries(LANGUAGE_IDS.map((id) => [id, loadLanguage(id)])) as Record<
    LanguageId,
    Record<Namespace, Record<string, unknown>>
>;

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
    applyDocumentLang(getLanguage());
    return getLanguage();
}

function applyDocumentLang(language: LanguageId): void {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

export function getLanguage(): LanguageId {
    const lng = i18next.language ?? '';
    if (isLanguageId(lng)) return lng;
    if (lng.toLowerCase().startsWith('zh-hant')) return 'zh-Hant';
    if (lng.toLowerCase().startsWith('es-419')) return 'es-419';
    if (lng.toLowerCase().startsWith('pt-br')) return 'pt-BR';
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
    applyDocumentLang(language);
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
