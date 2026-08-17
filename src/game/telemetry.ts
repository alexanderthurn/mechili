/**
 * Fire-and-forget match telemetry. Never throws, never blocks gameplay.
 * Complex analysis lives in clients (backend/stats.html or offline tools).
 *
 * Schema 2 adds channel / techs / damage. Full action-log replays are opt-in
 * (`?telemetryReplay=1` or localStorage `mechili-telemetry-replay=1`); the
 * default submit keeps a seed+settings stub with empty actions so matchKey
 * grouping still works without the bulk.
 */

import { BUILD_CHANNEL, type BuildChannel } from './channel';
import { GAME_VERSION, statsUrl } from './net';
import type { LoggedAction } from './actions';
import type { SeatDef } from './seats';
import type { GameSettings } from './settings';
import type { SpecialityId } from './cards';
import type { TechTree } from './tech';
import type { Team, Unit } from './units';

/** current submit schema — old files stay at 1; analysis treats new fields as optional */
export const TELEMETRY_SCHEMA = 2 as const;

export type MatchMode = 'ai' | 'mp' | '2v2';
export type MatchResult = 'victory' | 'defeat' | 'draw';

export interface UnitPresence {
    count: number;
    /** sum of pack levels (for avg level = levels / count) */
    levels: number;
}

export interface MatchReplayPayload {
    version: number;
    seed: number;
    settings: GameSettings;
    actions: LoggedAction[];
}

export interface MatchTelemetry {
    schema: 1 | 2;
    id?: string;
    ts: number;
    /**
     * `encodeGameVersion(package.json version)` — 0.7.1 is 7001. Still a
     * number, and still increasing: records written before this was derived
     * from the release version carry a hand-counted value that topped out at
     * 28, well below the smallest this can produce (1000 = v0.1.0), so the
     * whole series remains ordered and no schema bump was needed.
     * `formatGameVersion` turns it back into '0.7.1'.
     */
    gameVersion: number;
    mode: MatchMode;
    side: 'a' | 'b';
    /** open web vs Steam Electron — balance analysis can filter by channel */
    channel?: BuildChannel;
    /** 'player': the match's own end-of-game report (default, omitted =
     *  'player' for records predating this field). 'verify': a later
     *  headless re-check (Game's `replay.verify`, main.ts's
     *  verifyReplayAndReturn) re-submitting the recomputed result —
     *  stats.php's per-side dedupe means a matching one never creates a
     *  new file; a mismatching one does, which is the point. */
    source?: 'player' | 'verify';
    result: MatchResult;
    rounds: number;
    playerHp: number;
    enemyHp: number;
    names: { local: string; opponent: string };
    speciality: { player: SpecialityId | null; enemy: SpecialityId | null };
    units: Record<Team, Record<string, UnitPresence>>;
    unlocked: Record<Team, string[]>;
    /**
     * Final talent loadout per unit type (union across seats on that side).
     * Optional on schema-1 records.
     */
    techs?: Record<Team, Record<string, string[]>>;
    /**
     * Match-total combat damage dealt per unit type (summed across battles).
     * Optional on schema-1 records.
     */
    damage?: Record<Team, Record<string, number>>;
    /**
     * Every seat in the match, canonical (side 'a'/'b' — same on every
     * submitter, unlike `names`/`speciality`/`units` above which are all
     * reduced to "mine vs the other side" from the SUBMITTER's own
     * perspective). `names` predates team modes and stays a 2-name
     * reduction for existing consumers (replays.html); this is the only
     * place a 2v2+ match's full participant list — including which seats
     * are AI — is actually recorded. Optional so old records without it
     * still parse.
     */
    roster?: { seat: number; side: 'a' | 'b'; controller: 'human' | 'ai'; name: string }[];
    /**
     * Always present for matchKey (seed). `actions` is empty unless the
     * client opted into full replay storage — see {@link telemetryIncludeReplay}.
     */
    replay: MatchReplayPayload;
}

const SUBMIT_TIMEOUT_MS = 8_000;
const REPLAY_PREF_KEY = 'mechili-telemetry-replay';

/**
 * Whether to embed the full action log. Default off (balance summary only).
 * Enable with `?telemetryReplay=1` or localStorage `mechili-telemetry-replay=1`.
 */
export function telemetryIncludeReplay(): boolean {
    try {
        if (typeof location !== 'undefined') {
            const q = new URLSearchParams(location.search);
            if (q.get('telemetryReplay') === '1') return true;
        }
        if (typeof localStorage !== 'undefined' && localStorage.getItem(REPLAY_PREF_KEY) === '1') {
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

/** summarize final board packs (skips structures) */
export function summarizeUnits(units: readonly Unit[]): Record<Team, Record<string, UnitPresence>> {
    const out: Record<Team, Record<string, UnitPresence>> = { player: {}, enemy: {} };
    for (const u of units) {
        if (u.type.structure || u.team === 'horde') continue; // horde stays out of balance data
        const bag = out[u.team];
        const cur = bag[u.type.id] ?? { count: 0, levels: 0 };
        cur.count += 1;
        cur.levels += u.level;
        bag[u.type.id] = cur;
    }
    return out;
}

/**
 * Final talent ownership per unit type, bucketed by local team (union of
 * seats on that side). Uses {@link TechTree.snapshotOwned} so empty seats
 * don't invent phantom type entries.
 */
export function summarizeTechs(
    tech: TechTree,
    seats: readonly SeatDef[],
): Record<Team, Record<string, string[]>> {
    const out: Record<Team, Record<string, string[]>> = { player: {}, enemy: {} };
    const snap = tech.snapshotOwned();
    for (let seat = 0; seat < seats.length; seat++) {
        const team = seats[seat]?.team;
        if (team !== 'player' && team !== 'enemy') continue;
        const byType = snap[seat];
        if (!byType) continue;
        const bag = out[team];
        for (const [typeId, set] of byType) {
            if (set.size === 0) continue;
            const merged = new Set(bag[typeId] ?? []);
            for (const id of set) merged.add(id);
            bag[typeId] = [...merged].sort();
        }
    }
    return out;
}

/**
 * Convert sim / match-accumulated `${team}:${typeId}` damage keys into the
 * telemetry shape. Horde keys are dropped (same as unit presence).
 */
export function summarizeDamage(
    damageByType: ReadonlyMap<string, number>,
): Record<Team, Record<string, number>> {
    const out: Record<Team, Record<string, number>> = { player: {}, enemy: {} };
    for (const [key, amount] of damageByType) {
        if (amount <= 0) continue;
        const colon = key.indexOf(':');
        if (colon < 0) continue;
        const team = key.slice(0, colon);
        const typeId = key.slice(colon + 1);
        if (team !== 'player' && team !== 'enemy') continue;
        out[team][typeId] = (out[team][typeId] ?? 0) + amount;
    }
    return out;
}

/** merge one battle's damageByType into a running match total (mutates `into`) */
export function accumulateBattleDamage(
    into: Map<string, number>,
    battle: ReadonlyMap<string, number>,
): void {
    for (const [key, amount] of battle) {
        if (amount <= 0) continue;
        into.set(key, (into.get(key) ?? 0) + amount);
    }
}

/**
 * Fetch a previously-submitted match by id — everything needed to replay it
 * is already in `replay` (same seed+settings+action-log shape a watch-mode
 * `Game` plays back at a natural pace). Returns null on any failure (not
 * found, unreachable, bad id) rather than throwing; callers decide how to
 * surface that. `side` disambiguates the rare case where two different
 * sides' records share a content-fingerprint id (see stats.php) — pass it
 * whenever the caller already knows which side's record it wants (e.g. a
 * specific "Watch" link in replays.html).
 *
 * Summary-only records (empty `actions`) return null — they can't be watched.
 */
export async function fetchMatchReplay(id: string, side?: 'a' | 'b'): Promise<MatchTelemetry | null> {
    try {
        const sideParam = side ? `&side=${encodeURIComponent(side)}` : '';
        const res = await fetch(`${statsUrl()}?action=get&id=${encodeURIComponent(id)}${sideParam}`);
        if (!res.ok) return null;
        const data = (await res.json()) as Partial<MatchTelemetry> | null;
        if (!data || !data.replay) return null;
        if (!Array.isArray(data.replay.actions) || data.replay.actions.length === 0) return null;
        return data as MatchTelemetry;
    } catch {
        return null;
    }
}

/**
 * Upload a finished match. Swallows every failure — unreachable PHP, CORS,
 * timeouts, bad JSON — so the game over screen never depends on this.
 */
export function submitMatchTelemetry(record: MatchTelemetry): void {
    try {
        const url = `${statsUrl()}?action=submit`;
        const body = JSON.stringify(record);
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
        void fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: ctrl.signal,
            keepalive: true,
        })
            .catch(() => undefined)
            .finally(() => window.clearTimeout(timer));
    } catch {
        // ignore — telemetry must never affect play
    }
}

/** build-channel tag for every submit (open vs steam) */
export function telemetryChannel(): BuildChannel {
    return BUILD_CHANNEL;
}
