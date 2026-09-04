/**
 * Shipped UI languages. Each language owns its display font — Settings picks
 * a language, not a typeface.
 *
 * Default face is Marcellus. Switch only when Marcellus lacks the script
 * (CJK / Thai / Arabic / Greek → Noto; Cyrillic / Vietnamese → Exo 2).
 * Latin locales keep Marcellus; Exo 2 stays in the stack as glyph fallback
 * (e.g. rare Romanian ș/ț).
 */
export type LanguageId =
    | 'en'
    | 'de'
    | 'fr'
    | 'it'
    | 'ko'
    | 'es'
    | 'es-419'
    | 'zh'
    | 'zh-Hant'
    | 'ru'
    | 'th'
    | 'ja'
    | 'pt'
    | 'pl'
    | 'da'
    | 'nl'
    | 'fi'
    | 'nb'
    | 'sv'
    | 'hu'
    | 'cs'
    | 'ro'
    | 'tr'
    | 'ar'
    | 'pt-BR'
    | 'bg'
    | 'el'
    | 'uk'
    | 'vi'
    | 'id'
    | 'ms';

/** Steam-oriented order (English first, then the common storefront list). */
export const LANGUAGE_IDS: readonly LanguageId[] = [
    'en',
    'de',
    'fr',
    'it',
    'ko',
    'es',
    'es-419',
    'zh',
    'zh-Hant',
    'ru',
    'th',
    'ja',
    'pt',
    'pl',
    'da',
    'nl',
    'fi',
    'nb',
    'sv',
    'hu',
    'cs',
    'ro',
    'tr',
    'ar',
    'pt-BR',
    'bg',
    'el',
    'uk',
    'vi',
    'id',
    'ms',
] as const;

/** Labels always shown in the language itself (picker never needs translating). */
export const LANGUAGE_NATIVE_NAMES: Record<LanguageId, string> = {
    en: 'English',
    de: 'Deutsch',
    fr: 'Français',
    it: 'Italiano',
    ko: '한국어',
    es: 'Español (España)',
    'es-419': 'Español (Latinoamérica)',
    zh: '简体中文',
    'zh-Hant': '繁體中文',
    ru: 'Русский',
    th: 'ไทย',
    ja: '日本語',
    pt: 'Português (Portugal)',
    pl: 'Polski',
    da: 'Dansk',
    nl: 'Nederlands',
    fi: 'Suomi',
    nb: 'Norsk',
    sv: 'Svenska',
    hu: 'Magyar',
    cs: 'Čeština',
    ro: 'Română',
    tr: 'Türkçe',
    ar: 'العربية',
    'pt-BR': 'Português (Brasil)',
    bg: 'Български',
    el: 'Ελληνικά',
    uk: 'Українська',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia',
    ms: 'Bahasa Melayu',
};

const LANGUAGE_ID_SET = new Set<string>(LANGUAGE_IDS);

export function isLanguageId(value: unknown): value is LanguageId {
    return typeof value === 'string' && LANGUAGE_ID_SET.has(value);
}

/**
 * Languages that need Exo 2 as the primary face because Marcellus lacks the
 * script (Cyrillic) or most of the orthography (Vietnamese).
 * Other Latin locales use Marcellus, with Exo 2 only as a glyph fallback.
 */
export const EXO2_LANGUAGE_IDS: readonly LanguageId[] = [
    'ru',
    'bg',
    'uk',
    'vi',
] as const;
