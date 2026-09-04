import { isLanguageId, type LanguageId } from './languages';

/**
 * Map a BCP-47 tag to a shipped language.
 * Traditional Chinese is matched before Simplified (`zh-Hant` / `zh-TW` / …).
 * Unknown → null.
 */
export function matchShippedLanguage(tag: string): LanguageId | null {
    const raw = tag.trim().toLowerCase();
    if (!raw) return null;

    // Traditional Chinese — check before bare `zh`
    if (
        raw === 'zh-hant' ||
        raw.startsWith('zh-hant') ||
        raw === 'zh-tw' ||
        raw.startsWith('zh-tw') ||
        raw === 'zh-hk' ||
        raw.startsWith('zh-hk') ||
        raw === 'zh-mo' ||
        raw.startsWith('zh-mo')
    ) {
        return 'zh-Hant';
    }

    const primary = raw.split('-')[0]!;
    if (primary === 'zh') return 'zh'; // Hans / CN / SG / bare zh
    if (isLanguageId(primary)) return primary;
    return null;
}

/** Device language if we ship it, otherwise English. */
export function detectDeviceLanguage(): LanguageId {
    if (typeof navigator === 'undefined') return 'en';
    const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
    for (const tag of candidates) {
        const hit = matchShippedLanguage(tag);
        if (hit) return hit;
    }
    return 'en';
}
