/**
 * Browser stand-ins for the AI's plan worker (aiThinkWorker): the sim's
 * module graph reads prefs and makes canvases at import time. Imported FIRST
 * by the worker so these exist before any of that evaluates. Nothing here
 * draws or stores anything.
 */

const g = globalThis as Record<string, unknown>;

if (typeof g.window === 'undefined') g.window = globalThis;
if (typeof g.localStorage === 'undefined') {
    const store = new Map<string, string>();
    const storage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        get length() {
            return store.size;
        },
    };
    g.localStorage = storage;
    g.sessionStorage = storage;
}
if (typeof g.matchMedia === 'undefined') {
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
if (typeof g.document === 'undefined') {
    // anything asked of it answers with itself: canvases, contexts, styles, …
    const any: unknown = new Proxy(function () {}, {
        get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : any),
        apply: () => any,
        construct: () => any as object,
        set: () => true,
    });
    g.document = any;
}
if (typeof g.requestAnimationFrame === 'undefined') {
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

export {};
