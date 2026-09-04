/**
 * Shipped UI languages. Each language owns its display font — Settings picks
 * a language, not a typeface.
 *
 * Script-heavy locales (CJK / Thai / Arabic / Greek) lazy-load their faces in
 * `applyLanguageFont`. Copy may still fall back to English until translated.
 */
export type LanguageId =
    | 'en'
    | 'ru'
    | 'zh'
    | 'zh-Hant'
    | 'ko'
    | 'ja'
    | 'th'
    | 'ar'
    | 'el';

export const LANGUAGE_IDS: readonly LanguageId[] = [
    'en',
    'ru',
    'zh',
    'zh-Hant',
    'ko',
    'ja',
    'th',
    'ar',
    'el',
] as const;

/** Labels always shown in the language itself (picker never needs translating). */
export const LANGUAGE_NATIVE_NAMES: Record<LanguageId, string> = {
    en: 'English',
    ru: 'Русский',
    zh: '简体中文',
    'zh-Hant': '繁體中文',
    ko: '한국어',
    ja: '日本語',
    th: 'ไทย',
    ar: 'العربية',
    el: 'Ελληνικά',
};

export function isLanguageId(value: unknown): value is LanguageId {
    return (
        value === 'en' ||
        value === 'ru' ||
        value === 'zh' ||
        value === 'zh-Hant' ||
        value === 'ko' ||
        value === 'ja' ||
        value === 'th' ||
        value === 'ar' ||
        value === 'el'
    );
}
