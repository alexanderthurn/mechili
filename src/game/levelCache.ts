/**
 * Scenarios kept across sessions, by content hash, in IndexedDB (browser and
 * Electron alike). A level loaded once — from a zip, or received from a host —
 * is still there after a reload, so a saved match, a replay or the next room
 * with the same scenario doesn't need it again. Best effort: without
 * IndexedDB (private windows, Node) nothing is kept and nothing fails.
 */
import type { OverlayFile } from './assets';
import type { LevelRef } from './level';
import { decodeLevelPackage, encodeLevelPackage } from './levelTransfer';

const DB_NAME = 'melodan-levels';
const STORE = 'levels';
/** newest levels kept; older ones are dropped */
const MAX_LEVELS = 12;

interface CachedLevel {
    hash: string;
    id: string;
    usedAt: number;
    pkg: Uint8Array;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') return resolve(null);
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'hash' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Keep a level's files for later sessions, dropping the least recently used beyond the limit. */
export async function cacheLevel(ref: LevelRef, files: readonly OverlayFile[]): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const entry: CachedLevel = { hash: ref.hash, id: ref.id, usedAt: Date.now(), pkg: encodeLevelPackage(files) };
        await request(store.put(entry));
        const all = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as CachedLevel[];
        const stale = all.sort((a, b) => b.usedAt - a.usedAt).slice(MAX_LEVELS);
        if (stale.length > 0) {
            const prune = db.transaction(STORE, 'readwrite').objectStore(STORE);
            for (const old of stale) prune.delete(old.hash);
        }
    } catch (e) {
        console.warn('[levelCache] could not keep scenario', e);
    }
}

/** A kept level's id and files, or null. */
export async function cachedLevel(hash: string): Promise<{ id: string; files: OverlayFile[] } | null> {
    try {
        const db = await openDb();
        if (!db) return null;
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const entry = (await request(store.get(hash))) as CachedLevel | undefined;
        if (!entry) return null;
        entry.usedAt = Date.now();
        store.put(entry);
        return { id: entry.id, files: decodeLevelPackage(entry.pkg) };
    } catch (e) {
        console.warn('[levelCache] could not read scenario', e);
        return null;
    }
}
