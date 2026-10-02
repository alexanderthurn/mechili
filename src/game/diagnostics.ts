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

export type DiagnosticKind = 'desync' | 'error' | 'manual';

export interface DiagnosticContext {
    /** the match's seed — the server derives the match key from version + seed */
    seed?: number;
    round?: number;
    role?: string;
    name?: string;
}

/** how many reports one page load may send at most, per kind */
const MAX_REPORTS: Record<DiagnosticKind, number> = { desync: 6, error: 10, manual: 30 };
const sent: Record<DiagnosticKind, number> = { desync: 0, error: 0, manual: 0 };
/** one report per key (e.g. desync + round, error + message) */
const seenKeys = new Set<string>();
/** the server refuses more; trim the event list to stay under it (a manual report may be big) */
const MAX_BODY_CHARS: Record<DiagnosticKind, number> = { desync: 1_800_000, error: 200_000, manual: 7_500_000 };

function platform(): string {
    const electron = /Electron\//.test(navigator.userAgent);
    return `${electron ? 'electron' : 'browser'} · ${navigator.userAgent}`;
}

/**
 * Send one report. `key` dedupes (same desync round, same error message); `data` is anything
 * JSON — for a desync the whole match's debug events. Returns without doing anything when
 * diagnostics are off, the per-kind budget is spent, or the key was already sent.
 */
export function reportDiagnostic(kind: DiagnosticKind, key: string, ctx: DiagnosticContext, data: unknown): Promise<boolean> {
    try {
        if (!diagnosticsEnabled() && kind !== 'manual') return Promise.resolve(false);
        const dedupe = `${kind}:${key}`;
        if (seenKeys.has(dedupe) || sent[kind] >= MAX_REPORTS[kind]) return Promise.resolve(false);
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
            consoleTail: kind === 'error' ? undefined : consoleTail.slice(),
            data,
        };
        let body = JSON.stringify(record);
        // too big: keep the newest events (the desync is at the end)
        const events = (data as { events?: unknown[] } | null)?.events;
        while (body.length > MAX_BODY_CHARS[kind] && Array.isArray(events) && events.length > 1) {
            events.splice(0, Math.ceil(events.length / 4));
            body = JSON.stringify(record);
        }
        return fetch(`${diagUrl()}?action=submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: body.length < 60_000,
        })
            .then((res) => res.ok)
            .catch(() => false);
    } catch {
        /* diagnostics must never break the game */
        return Promise.resolve(false);
    }
}

/** the last console warnings/errors, sent along with desync and manual reports */
const consoleTail: { t: number; level: string; text: string }[] = [];
const CONSOLE_TAIL = 300;

function captureConsole(): void {
    for (const level of ['warn', 'error'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            try {
                const text = args
                    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : safeJson(a)))
                    .join(' ')
                    .slice(0, 4000);
                consoleTail.push({ t: Date.now(), level, text });
                if (consoleTail.length > CONSOLE_TAIL) consoleTail.splice(0, consoleTail.length - CONSOLE_TAIL);
            } catch {
                /* never break logging */
            }
            original(...args);
        };
    }
}

function safeJson(v: unknown): string {
    try {
        return JSON.stringify(v) ?? String(v);
    } catch {
        return String(v);
    }
}

let hooksInstalled = false;

/** uncaught errors and rejections, once per distinct message */
function installErrorHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;
    captureConsole();
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
