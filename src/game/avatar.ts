/**
 * Player avatar — data-URL in localStorage (web / LAN uploads + cached Steam).
 * Target size matches Steam's large avatar (184×184).
 */

export const AVATAR_SIZE = 184;
/** Soft cap so localStorage stays healthy (184² webp/jpeg is usually fine). */
const MAX_DATA_URL_CHARS = 200_000;
const STORAGE_KEY = 'mechili-avatar';

export function getAvatarDataUrl(): string | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && raw.startsWith('data:image/')) return raw;
    } catch {
        /* private browsing */
    }
    return null;
}

export function setAvatarDataUrl(dataUrl: string | null): void {
    try {
        if (!dataUrl) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        if (dataUrl.length > MAX_DATA_URL_CHARS) return;
        localStorage.setItem(STORAGE_KEY, dataUrl);
    } catch {
        /* quota / private browsing */
    }
}

/** Cover-crop + scale to AVATAR_SIZE², prefer WebP then JPEG. */
export async function resizeImageFileToAvatar(file: Blob): Promise<string | null> {
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        ctx.drawImage(bitmap, (AVATAR_SIZE - w) / 2, (AVATAR_SIZE - h) / 2, w, h);
        let out = canvas.toDataURL('image/webp', 0.82);
        if (!out.startsWith('data:image/webp') || out.length > MAX_DATA_URL_CHARS) {
            out = canvas.toDataURL('image/jpeg', 0.85);
        }
        if (out.length > MAX_DATA_URL_CHARS) return null;
        return out;
    } finally {
        bitmap.close();
    }
}
