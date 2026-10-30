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
    'tutorial',
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

type Bundle = Record<Namespace, Record<string, unknown>>;

/** English is built in (the fallback for every missing key); every other language loads when chosen. */
const englishFiles = import.meta.glob('../../locales/en/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, Record<string, unknown>>;
const otherFiles = import.meta.glob(['../../locales/*/*.json', '!../../locales/en/*.json'], {
    import: 'default',
}) as Record<string, () => Promise<Record<string, unknown>>>;

function localePath(lang: LanguageId, ns: Namespace): string {
    return `../../locales/${lang}/${ns}.json`;
}

const resources: Partial<Record<LanguageId, Bundle>> = {
    en: Object.fromEntries(
        NAMESPACES.map((ns) => {
            const data = englishFiles[localePath('en', ns)];
            if (!data) throw new Error(`Missing locale file ${localePath('en', ns)}`);
            return [ns, data];
        }),
    ) as Bundle,
};

/** loads `lang`'s files once (and hands them to i18next once it runs) */
async function ensureLanguage(lang: LanguageId): Promise<void> {
    if (resources[lang]) return;
    const entries = await Promise.all(
        NAMESPACES.map(async (ns) => {
            const load = otherFiles[localePath(lang, ns)];
            if (!load) throw new Error(`Missing locale file ${localePath(lang, ns)}`);
            return [ns, await load()] as const;
        }),
    );
    const bundle = Object.fromEntries(entries) as Bundle;
    resources[lang] = bundle;
    if (ready) for (const ns of NAMESPACES) i18next.addResourceBundle(lang, ns, bundle[ns], true, true);
}

let ready = false;
const languageListeners: Array<() => void> = [];

/**
 * Boot i18n once before menu chrome. Prefer an explicit language (prefs), else
 * the device language if we ship it, else English.
 */
export async function initI18n(language?: LanguageId): Promise<LanguageId> {
    const lng = language ?? detectDeviceLanguage();
    await ensureLanguage(lng);
    if (!ready) {
        await i18next.init({
            lng,
            fallbackLng: 'en',
            supportedLngs: [...LANGUAGE_IDS],
            nonExplicitSupportedLngs: false,
            defaultNS: 'common',
            ns: [...NAMESPACES],
            resources: resources as Record<LanguageId, Bundle>,
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
    await ensureLanguage(language);
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
