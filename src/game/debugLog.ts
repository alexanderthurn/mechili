/**
 * Cross-client debug event bus, aggregated on the host.
 *
 * Every client (host, guest(s), spectators, star seats) can call
 * `log(category, data)` — it always prints locally (unchanged from today's
 * ad hoc `console.info('[xxx-debug]', ...)` calls), and if this instance
 * isn't the host, the event also queues for the next flush to whichever
 * wire channel this client has (game.ts decides which — see its tick-loop
 * flush). The host ingests its own events directly (never over the wire)
 * plus every remote batch it receives, into one aggregated, capped-size,
 * per-client ring buffer. `dump()` merges everything into one
 * chronological, copy-paste-friendly text blob via a console-exposed
 * function (see game.ts's `window.mechiliDebugDump`).
 *
 * Entirely inert unless `?debug` is in the URL (same flag as the existing
 * performance overlay, `src/ui/debug.ts`) — no wire traffic, no bookkeeping,
 * `log()` degenerates to nothing beyond what was already true before this
 * bus existed.
 */

const CLIENT_STORAGE_KEY = 'mechili-debug-client';
const MAX_EVENTS_PER_CLIENT = 5000;
const FLUSH_THRESHOLD = 50;

export type DebugRole = 'host' | 'guest' | 'spectator' | 'star-guest';

export interface DebugEvent {
    clientId: string;
    role: DebugRole;
    /** short human label — name/seat, for telling multiple star guests or
     *  spectators apart in a dump (role alone isn't enough) */
    label: string;
    /** monotonic per clientId, persisted across a same-tab reload — never resets */
    seq: number;
    /** Date.now() — wall clock, so cross-client dump ordering is only approximate */
    t: number;
    category: string;
    data?: unknown;
}

function loadOrCreateClientIdentity(): { clientId: string; seq: number } {
    try {
        const raw = sessionStorage.getItem(CLIENT_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { clientId: string; seq: number };
            if (typeof parsed.clientId === 'string' && typeof parsed.seq === 'number') return parsed;
        }
    } catch {
        // sessionStorage unavailable (private mode, etc.) — fall through to a fresh identity
    }
    return { clientId: Math.random().toString(36).slice(2, 10), seq: 0 };
}

function saveClientIdentity(clientId: string, seq: number): void {
    try {
        sessionStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify({ clientId, seq }));
    } catch {
        // best-effort only — a lost seq counter just restarts numbering, no correctness issue
    }
}

export class DebugLog {
    readonly enabled: boolean;
    private readonly clientId: string;
    private seq: number;
    private readonly pending: DebugEvent[] = [];
    /** host-only: every client's own capped event history, keyed by clientId */
    private readonly byClient = new Map<string, DebugEvent[]>();
    onThresholdReached: (() => void) | null = null;

    constructor(
        private readonly role: DebugRole,
        private readonly label: string,
        readonly isHost: boolean,
        enabled: boolean,
    ) {
        this.enabled = enabled;
        const identity = loadOrCreateClientIdentity();
        this.clientId = identity.clientId;
        this.seq = identity.seq;
    }

    /** Always logs locally; queues (or ingests, if host) when enabled. */
    log(category: string, data?: unknown): void {
        console.info(`[${category}]`, data !== undefined ? JSON.stringify(data) : '');
        if (!this.enabled) return;
        this.seq++;
        saveClientIdentity(this.clientId, this.seq);
        const event: DebugEvent = {
            clientId: this.clientId,
            role: this.role,
            label: this.label,
            seq: this.seq,
            t: Date.now(),
            category,
            data,
        };
        if (this.isHost) {
            this.ingest([event]);
        } else {
            this.pending.push(event);
            if (this.pending.length >= FLUSH_THRESHOLD) this.onThresholdReached?.();
        }
    }

    /** Non-host only: called by game.ts's flush tick to grab (and clear) whatever's pending. */
    takePending(): DebugEvent[] {
        if (this.pending.length === 0) return [];
        return this.pending.splice(0, this.pending.length);
    }

    /** Host-only: merge a batch (own or a remote client's) into the aggregator. */
    ingest(events: DebugEvent[]): void {
        for (const e of events) {
            let bucket = this.byClient.get(e.clientId);
            if (!bucket) {
                bucket = [];
                this.byClient.set(e.clientId, bucket);
            }
            bucket.push(e);
            if (bucket.length > MAX_EVENTS_PER_CLIENT) bucket.splice(0, bucket.length - MAX_EVENTS_PER_CLIENT);
        }
    }

    /**
     * Host-only: one merged, chronological, copy-paste-friendly text blob.
     * `verbose` defaults to true (console callers get everything, unchanged
     * from before this option existed). The short-dump button explicitly
     * passes `verbose: false`, which summarizes categories known to dump a
     * huge payload (currently just `sim.battleStart`'s full actor array)
     * down to their headline numbers, since that one category dwarfs
     * everything else in a real session.
     */
    dump(opts?: { clientId?: string; category?: string; sinceMs?: number; verbose?: boolean }): string {
        let all: DebugEvent[] = [];
        for (const bucket of this.byClient.values()) all = all.concat(bucket);
        if (opts?.clientId) all = all.filter((e) => e.clientId === opts.clientId);
        if (opts?.category) all = all.filter((e) => e.category === opts.category);
        all.sort((a, b) => a.t - b.t || a.seq - b.seq);
        if (opts?.sinceMs !== undefined) {
            const cutoff = Date.now() - opts.sinceMs;
            all = all.filter((e) => e.t >= cutoff);
        }
        if (all.length === 0) return '(no debug events recorded)';
        const t0 = all[0]!.t;
        const verbose = opts?.verbose ?? true;
        return all
            .map((e) => {
                const rel = ((e.t - t0) / 1000).toFixed(3).padStart(8);
                const who = `${e.role}:${e.label}`.padEnd(16);
                const payload = verbose ? e.data : this.summarize(e);
                const data = payload !== undefined ? JSON.stringify(payload) : '';
                return `+${rel}s ${who} ${e.category.padEnd(14)} ${data}`;
            })
            .join('\n');
    }

    private summarize(e: DebugEvent): unknown {
        if (e.category === 'sim.battleStart' && e.data && typeof e.data === 'object') {
            const d = e.data as { round?: number; hash?: number; unitCount?: number };
            return { round: d.round, hash: d.hash, unitCount: d.unitCount };
        }
        return e.data;
    }

    /** Host-only: reset every client's history (start a fresh capture window). */
    clear(): void {
        this.byClient.clear();
    }

    /** Host-only: which clients have ever reported in (for filtering dump()). */
    clientIds(): string[] {
        return [...this.byClient.keys()];
    }
}
