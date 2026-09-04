/**
 * Shipped UI languages. Each language owns its display font — Settings picks
 * a language, not a typeface.
 */
export type LanguageId = 'en' | 'ru' | 'zh';

export const LANGUAGE_IDS: readonly LanguageId[] = ['en', 'ru', 'zh'] as const;

/** Labels always shown in the language itself (picker never needs translating). */
export const LANGUAGE_NATIVE_NAMES: Record<LanguageId, string> = {
    en: 'English',
    ru: 'Русский',
    zh: '中文',
};

export function isLanguageId(value: unknown): value is LanguageId {
    return value === 'en' || value === 'ru' || value === 'zh';
}
