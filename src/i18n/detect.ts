import { isLanguageId, type LanguageId } from './languages';

/**
 * Map a BCP-47 tag to a shipped language.
 * Regional variants (zh-Hant, es-419, pt-BR, nb) are matched before bare primaries.
 * Unknown → null.
 */
export function matchShippedLanguage(tag: string): LanguageId | null {
    const raw = tag.trim().toLowerCase();
    if (!raw) return null;

    // Traditional Chinese — before bare `zh`
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

    // Spanish — LatAm vs Spain
    if (
        raw === 'es-419' ||
        raw.startsWith('es-419') ||
        raw === 'es-mx' ||
        raw.startsWith('es-mx') ||
        raw === 'es-ar' ||
        raw.startsWith('es-ar') ||
        raw === 'es-co' ||
        raw.startsWith('es-co') ||
        raw === 'es-cl' ||
        raw.startsWith('es-cl') ||
        raw === 'es-pe' ||
        raw.startsWith('es-pe') ||
        raw === 'es-ve' ||
        raw.startsWith('es-ve') ||
        raw === 'es-uy' ||
        raw.startsWith('es-uy') ||
        raw === 'es-py' ||
        raw.startsWith('es-py') ||
        raw === 'es-bo' ||
        raw.startsWith('es-bo') ||
        raw === 'es-ec' ||
        raw.startsWith('es-ec') ||
        raw === 'es-cr' ||
        raw.startsWith('es-cr') ||
        raw === 'es-gt' ||
        raw.startsWith('es-gt') ||
        raw === 'es-hn' ||
        raw.startsWith('es-hn') ||
        raw === 'es-ni' ||
        raw.startsWith('es-ni') ||
        raw === 'es-sv' ||
        raw.startsWith('es-sv') ||
        raw === 'es-do' ||
        raw.startsWith('es-do') ||
        raw === 'es-cu' ||
        raw.startsWith('es-cu') ||
        raw === 'es-pa' ||
        raw.startsWith('es-pa') ||
        raw === 'es-pr' ||
        raw.startsWith('es-pr')
    ) {
        return 'es-419';
    }

    // Portuguese — Brazil vs Portugal
    if (raw === 'pt-br' || raw.startsWith('pt-br')) return 'pt-BR';

    // Norwegian
    if (raw === 'nb' || raw.startsWith('nb-') || raw === 'nn' || raw.startsWith('nn-') || raw === 'no' || raw.startsWith('no-')) {
        return 'nb';
    }

    // Exact multi-part ids we ship
    if (raw === 'es-es' || raw.startsWith('es-es')) return 'es';
    if (raw === 'pt-pt' || raw.startsWith('pt-pt')) return 'pt';

    if (isLanguageId(raw)) return raw;

    const primary = raw.split('-')[0]!;
    if (primary === 'zh') return 'zh';
    if (primary === 'es') return 'es'; // bare / unknown region → Spain catalog
    if (primary === 'pt') return 'pt';
    if (isLanguageId(primary)) return primary;
    return null;
}

/**
 * Steamworks `ISteamApps::GetCurrentGameLanguage` API names → shipped Melodan ids.
 * https://partner.steamgames.com/doc/store/localization/languages
 */
const STEAM_GAME_LANGUAGE: Record<string, LanguageId> = {
    english: 'en',
    german: 'de',
    french: 'fr',
    italian: 'it',
    korean: 'ko',
    spanish: 'es',
    latam: 'es-419',
    schinese: 'zh',
    tchinese: 'zh-Hant',
    russian: 'ru',
    thai: 'th',
    japanese: 'ja',
    portuguese: 'pt',
    brazilian: 'pt-BR',
    polish: 'pl',
    danish: 'da',
    dutch: 'nl',
    finnish: 'fi',
    norwegian: 'nb',
    swedish: 'sv',
    hungarian: 'hu',
    czech: 'cs',
    romanian: 'ro',
    turkish: 'tr',
    arabic: 'ar',
    bulgarian: 'bg',
    greek: 'el',
    ukrainian: 'uk',
    vietnamese: 'vi',
    indonesian: 'id',
};

/** Map a Steam API language name to a shipped Melodan language, or null. */
export function matchSteamGameLanguage(steamName: string | null | undefined): LanguageId | null {
    if (!steamName) return null;
    const key = steamName.trim().toLowerCase();
    if (!key) return null;
    return STEAM_GAME_LANGUAGE[key] ?? null;
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
