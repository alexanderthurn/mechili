/**
 * Share codes (plan §9.2): a scenario package without media as one line of
 * text for chat — its scenario files, meta.jsonc and data overrides, deflated
 * and base64url-encoded. Models and textures don't fit in a chat line; a
 * package that needs them is shared as a zip.
 *
 * Format: `MELODAN1:` + base64url(deflate-raw(JSON { id, files: [{ path, text }] })).
 */
import type { OverlayFile } from '../assets';

const PREFIX = 'MELODAN1:';
/** text files that make up a package's rules and data */
const SHAREABLE = /\.(jsonc?|txt)$/i;
/** refuse absurd inputs before inflating them */
const MAX_CODE_CHARS = 400_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export interface ShareCodeResult {
    code: string;
    /** media files left out (the code carries text only) */
    skipped: string[];
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw new Error('share code too large');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.length;
    }
    return out;
}

export async function encodeShareCode(id: string, files: readonly OverlayFile[]): Promise<ShareCodeResult> {
    const decoder = new TextDecoder();
    const shared = files.filter((f) => SHAREABLE.test(f.path));
    const skipped = files.filter((f) => !SHAREABLE.test(f.path)).map((f) => f.path);
    const json = JSON.stringify({ id, files: shared.map((f) => ({ path: f.path, text: decoder.decode(f.bytes) })) });
    const deflated = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
    return { code: PREFIX + toBase64Url(deflated), skipped };
}

/** Whether a pasted text looks like a share code at all. */
export function isShareCode(text: string): boolean {
    return text.trim().startsWith(PREFIX);
}

export async function decodeShareCode(code: string): Promise<{ id: string; files: OverlayFile[] }> {
    const trimmed = code.trim().replace(/\s+/g, '');
    if (!trimmed.startsWith(PREFIX)) throw new Error('not a scenario code');
    if (trimmed.length > MAX_CODE_CHARS) throw new Error('share code too large');
    let bytes: Uint8Array;
    try {
        bytes = await pipe(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
    } catch (e) {
        throw new Error(`the code is damaged (${e instanceof Error ? e.message : String(e)})`);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { id?: unknown; files?: unknown };
    if (typeof parsed.id !== 'string' || !Array.isArray(parsed.files)) throw new Error('the code carries no scenario');
    const encoder = new TextEncoder();
    const files: OverlayFile[] = [];
    for (const f of parsed.files as { path?: unknown; text?: unknown }[]) {
        if (typeof f?.path !== 'string' || typeof f.text !== 'string' || !SHAREABLE.test(f.path) || f.path.includes('..')) continue;
        files.push({ path: f.path, bytes: encoder.encode(f.text) });
    }
    return { id: parsed.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'shared', files };
}
