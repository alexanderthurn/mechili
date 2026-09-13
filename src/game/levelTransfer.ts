/**
 * Moving a scenario between peers (plan §17): the host packs a level's files
 * into one byte package and sends it in base64 chunks small enough for every
 * transport; the guest asks for chunks a batch at a time (flow control, so a
 * large level never floods a data channel), reassembles, and loads it with
 * `loadLevel` — which recomputes the content hash, so a corrupted or
 * different package can never pass as the offered scenario.
 */
import type { OverlayFile } from './assets';
import type { LevelRef } from './level';

/** raw bytes per chunk — ~44 KB of base64 on the wire */
export const LEVEL_CHUNK_BYTES = 32 * 1024;
/** chunks the host sends per `levelRequest` */
export const LEVEL_CHUNK_BATCH = 16;
/** a guest refuses packages beyond this (a level is data + a few models) */
export const LEVEL_PACKAGE_MAX_BYTES = 64 * 1024 * 1024;

// ------------------------------------------------------------------ package format
// u32 fileCount, then per file: u16 pathLength, path (utf-8), u32 byteLength, bytes

export function encodeLevelPackage(files: readonly OverlayFile[]): Uint8Array<ArrayBuffer> {
    const enc = new TextEncoder();
    const entries = files.map((f) => ({
        path: enc.encode(f.path),
        bytes: f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes),
    }));
    const size = 4 + entries.reduce((n, e) => n + 2 + e.path.length + 4 + e.bytes.length, 0);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    view.setUint32(at, entries.length, true);
    at += 4;
    for (const e of entries) {
        view.setUint16(at, e.path.length, true);
        out.set(e.path, at + 2);
        at += 2 + e.path.length;
        view.setUint32(at, e.bytes.length, true);
        out.set(e.bytes, at + 4);
        at += 4 + e.bytes.length;
    }
    return out;
}

export function decodeLevelPackage(pkg: Uint8Array): OverlayFile[] {
    const view = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
    const dec = new TextDecoder();
    const files: OverlayFile[] = [];
    let at = 0;
    const need = (n: number) => {
        if (at + n > pkg.length) throw new Error('[level] scenario package is truncated');
    };
    need(4);
    const count = view.getUint32(at, true);
    at += 4;
    for (let i = 0; i < count; i++) {
        need(2);
        const pathLength = view.getUint16(at, true);
        need(2 + pathLength + 4);
        const path = dec.decode(pkg.subarray(at + 2, at + 2 + pathLength));
        at += 2 + pathLength;
        const length = view.getUint32(at, true);
        need(4 + length);
        files.push({ path, bytes: pkg.slice(at + 4, at + 4 + length) });
        at += 4 + length;
    }
    return files;
}

// ------------------------------------------------------------------ base64

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

// ------------------------------------------------------------------ sender

/** A level cut into chunks, ready to answer `levelRequest`s. */
export class LevelSender {
    readonly count: number;
    private readonly pkg: Uint8Array<ArrayBuffer>;

    constructor(files: readonly OverlayFile[]) {
        this.pkg = encodeLevelPackage(files);
        this.count = Math.max(1, Math.ceil(this.pkg.length / LEVEL_CHUNK_BYTES));
    }

    /** base64 of chunk `index` */
    chunk(index: number): string {
        return toBase64(this.pkg.subarray(index * LEVEL_CHUNK_BYTES, (index + 1) * LEVEL_CHUNK_BYTES));
    }

    /** the chunk indices one `levelRequest` from `from` is answered with */
    batch(from: number): number[] {
        const start = Math.max(0, Math.floor(from));
        return Array.from({ length: Math.max(0, Math.min(LEVEL_CHUNK_BATCH, this.count - start)) }, (_, i) => start + i);
    }
}

// ------------------------------------------------------------------ receiver

/** Collects one offered level's chunks on the guest. */
export class LevelReceiver {
    private readonly parts: (Uint8Array<ArrayBuffer> | undefined)[];
    private received = 0;
    private bytes = 0;

    constructor(
        readonly level: LevelRef,
        readonly count: number,
    ) {
        if (!Number.isInteger(count) || count < 1 || count * LEVEL_CHUNK_BYTES > LEVEL_PACKAGE_MAX_BYTES + LEVEL_CHUNK_BYTES) {
            throw new Error(`[level] refusing a scenario of ${count} chunks`);
        }
        this.parts = new Array(count);
    }

    /** store a chunk; returns the next index to request once this batch is complete, else null */
    add(index: number, data: string): number | null {
        if (!Number.isInteger(index) || index < 0 || index >= this.count || this.parts[index]) return null;
        const part = fromBase64(data);
        if (part.length > LEVEL_CHUNK_BYTES) throw new Error('[level] oversized scenario chunk');
        this.bytes += part.length;
        if (this.bytes > LEVEL_PACKAGE_MAX_BYTES) throw new Error('[level] scenario package is too large');
        this.parts[index] = part;
        this.received++;
        const next = this.received;
        return !this.complete() && next % LEVEL_CHUNK_BATCH === 0 ? next : null;
    }

    complete(): boolean {
        return this.received === this.count;
    }

    /** fraction received, 0..1 */
    progress(): number {
        return this.received / this.count;
    }

    files(): OverlayFile[] {
        if (!this.complete()) throw new Error('[level] scenario package is incomplete');
        const pkg = new Uint8Array(this.bytes);
        let at = 0;
        for (const part of this.parts) {
            pkg.set(part!, at);
            at += part!.length;
        }
        return decodeLevelPackage(pkg);
    }
}
