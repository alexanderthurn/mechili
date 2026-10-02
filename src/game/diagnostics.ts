/**
 * Diagnostics: when something goes wrong in a match (a desync, an uncaught error), every
 * client sends what it saw to backend/diag.php, so a report no longer depends on someone
 * having the console open at the right moment.
 *
 * On while {@link diagnosticsEnabled}: a Steam playtest build (main.ts sets the mode) or the
 * debug overlay. Fire-and-forget, never throws, never blocks gameplay; throttled so a resync
 * loop cannot flood the server.
 */

import { debugEnabled } from './prefs';
import { BASE_CONTENT_HASH, GAME_VERSION, matchUrl } from './net';

let diagnosticsMode = false;

/** main.ts: turn diagnostics on for a whole session (e.g. a playtest build) */
export function setDiagnosticsMode(on: boolean): void {
    diagnosticsMode = on;
    // installed either way: the debug overlay can switch diagnostics on later (each send checks)
    installErrorHooks();
}

export function diagnosticsEnabled(): boolean {
    return diagnosticsMode || debugEnabled();
}

export function diagUrl(): string {
    return new URL('diag.php', matchUrl()).href;
}

export type DiagnosticKind = 'desync' | 'error';

export interface DiagnosticContext {
    /** the match's seed — the server derives the match key from version + seed */
    seed?: number;
    round?: number;
    role?: string;
    name?: string;
}

/** how many reports one page load may send at most, per kind */
const MAX_REPORTS: Record<DiagnosticKind, number> = { desync: 6, error: 10 };
const sent: Record<DiagnosticKind, number> = { desync: 0, error: 0 };
/** one report per key (e.g. desync + round, error + message) */
const seenKeys = new Set<string>();
/** the server refuses more; trim the event list to stay under it */
const MAX_BODY_CHARS = 1_800_000;

function platform(): string {
    const electron = /Electron\//.test(navigator.userAgent);
    return `${electron ? 'electron' : 'browser'} · ${navigator.userAgent}`;
}

/**
 * Send one report. `key` dedupes (same desync round, same error message); `data` is anything
 * JSON — for a desync the whole match's debug events. Returns without doing anything when
 * diagnostics are off, the per-kind budget is spent, or the key was already sent.
 */
export function reportDiagnostic(kind: DiagnosticKind, key: string, ctx: DiagnosticContext, data: unknown): void {
    try {
        if (!diagnosticsEnabled()) return;
        const dedupe = `${kind}:${key}`;
        if (seenKeys.has(dedupe) || sent[kind] >= MAX_REPORTS[kind]) return;
        seenKeys.add(dedupe);
        sent[kind]++;
        const record = {
            kind,
            key,
            gameVersion: GAME_VERSION,
            appVersion: __APP_VERSION__,
            contentHash: BASE_CONTENT_HASH,
            platform: platform(),
            ts: Date.now(),
            ...ctx,
            data,
        };
        let body = JSON.stringify(record);
        // too big: keep the newest events (the desync is at the end)
        const events = (data as { events?: unknown[] } | null)?.events;
        while (body.length > MAX_BODY_CHARS && Array.isArray(events) && events.length > 1) {
            events.splice(0, Math.ceil(events.length / 4));
            body = JSON.stringify(record);
        }
        void fetch(`${diagUrl()}?action=submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: body.length < 60_000,
        }).catch(() => {
            /* unreachable backend: nothing to do */
        });
    } catch {
        /* diagnostics must never break the game */
    }
}

let hooksInstalled = false;

/** uncaught errors and rejections, once per distinct message */
function installErrorHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;
    const send = (message: string, stack: string | undefined) =>
        reportDiagnostic('error', message.slice(0, 200), {}, { message, stack: stack?.slice(0, 8000) });
    window.addEventListener('error', (e) => {
        const err = e.error as Error | undefined;
        send(err?.message ?? e.message ?? 'error', err?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason as Error | string | undefined;
        send(typeof r === 'string' ? r : (r?.message ?? 'unhandled rejection'), typeof r === 'string' ? undefined : r?.stack);
    });
}
