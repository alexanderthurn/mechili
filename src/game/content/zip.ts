/**
 * Minimal zip reader and writer for level packages: reads stored and deflated
 * entries (no encryption, no zip64), writes stored entries. Decompression uses the platform's
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
 * forks (`__MACOSX/`) and dotfiles are skipped. Paths are returned as stored —
 * see `levelFilesFromArchive` (level.ts) for a level's folder layout.
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
    return files;
}

// ------------------------------------------------------------------ writing

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip of `files`, uncompressed (stored) — level packages are a few text
 * files plus already-compressed media, and any unzip tool opens it.
 */
export function writeZip(files: readonly OverlayFile[]): Uint8Array<ArrayBuffer> {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.path);
        const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, LOCAL_SIGNATURE, true);
        local.setUint16(4, 20, true); // version needed
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        parts.push(new Uint8Array(local.buffer), name, data);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, CENTRAL_SIGNATURE, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true);
        cd.setUint32(16, crc, true);
        cd.setUint32(20, data.length, true);
        cd.setUint32(24, data.length, true);
        cd.setUint16(28, name.length, true);
        cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, EOCD_SIGNATURE, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
