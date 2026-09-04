import { isLanguageId, type LanguageId } from './languages';

/**
 * Map a BCP-47 tag to a shipped language. Only the primary subtag is used
 * (`zh-CN` / `zh-Hans` → `zh`, `ru-RU` → `ru`). Unknown → null.
 */
export function matchShippedLanguage(tag: string): LanguageId | null {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!primary) return null;
    return isLanguageId(primary) ? primary : null;
}

/** Device language if we ship it, otherwise English. */
export function detectDeviceLanguage(): LanguageId {
    if (typeof navigator === 'undefined') return 'en';
    const candidates = [
        ...(navigator.languages ?? []),
        navigator.language,
    ].filter(Boolean);
    for (const tag of candidates) {
        const hit = matchShippedLanguage(tag);
        if (hit) return hit;
    }
    return 'en';
}
