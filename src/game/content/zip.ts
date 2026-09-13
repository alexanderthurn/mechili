/**
 * Minimal zip reader for level packages: stored and deflated entries, no
 * encryption, no zip64. Decompression uses the platform's
 * `DecompressionStream('deflate-raw')` (browsers, Electron, Node 18+), so the
 * game needs no zip library.
 */
import type { OverlayFile } from '../assets';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Every file in the archive, by its path inside it. Folders, macOS resource
 * forks (`__MACOSX/`) and dotfiles are skipped. When everything sits in one
 * top folder (zipping the level folder itself), that folder is stripped, so
 * both `data/…` and `frost-keep/data/…` layouts work.
 */
export async function readZip(bytes: ArrayBuffer | Uint8Array): Promise<OverlayFile[]> {
    const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
    const view = new DataView(buf.buffer);

    // end of central directory: the last 22 bytes, or earlier if there's a comment
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (view.getUint32(i, true) === EOCD_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('[zip] not a zip file');
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);

    const decoder = new TextDecoder();
    const files: OverlayFile[] = [];
    for (let n = 0; n < count; n++) {
        if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error('[zip] broken central directory');
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const compressedSize = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localAt = view.getUint32(at + 42, true);
        const path = decoder.decode(buf.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extraLength + commentLength;

        const skipped =
            path.endsWith('/') || path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
        if (skipped) continue;
        if (flags & 1) throw new Error(`[zip] ${path}: encrypted entries are not supported`);
        if (view.getUint32(localAt, true) !== LOCAL_SIGNATURE) throw new Error(`[zip] ${path}: broken local header`);
        const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
        const raw = buf.slice(dataAt, dataAt + compressedSize);
        if (method === 0) files.push({ path, bytes: raw });
        else if (method === 8) files.push({ path, bytes: await inflateRaw(raw) });
        else throw new Error(`[zip] ${path}: compression method ${method} is not supported`);
    }

    // one shared top folder and nothing at the root → strip it
    const tops = new Set(files.map((f) => f.path.split('/')[0]));
    if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
        const top = `${[...tops][0]}/`;
        return files.map((f) => ({ path: f.path.slice(top.length), bytes: f.bytes }));
    }
    return files;
}
