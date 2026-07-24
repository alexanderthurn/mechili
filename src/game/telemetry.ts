/**
 * Fire-and-forget match telemetry. Never throws, never blocks gameplay.
 * Complex analysis lives in clients (backend/stats.html or offline tools).
 */

import { GAME_VERSION, statsUrl } from './net';
import type { LoggedAction } from './actions';
import type { GameSettings } from './settings';
import type { SpecialityId } from './cards';
import type { Team, Unit } from './units';

/** bumped when economy / unit numbers change for balance comparison (independent of GAME_VERSION) */
export const BALANCE_PATCH_ID = '1';

export type MatchMode = 'ai' | 'mp' | '2v2';
export type MatchResult = 'victory' | 'defeat' | 'draw';

export interface UnitPresence {
    count: number;
    /** sum of pack levels (for avg level = levels / count) */
    levels: number;
}

export interface MatchTelemetry {
    schema: 1;
    id?: string;
    ts: number;
    gameVersion: number;
    balancePatchId: string;
    mode: MatchMode;
    side: 'a' | 'b';
    result: MatchResult;
    rounds: number;
    playerHp: number;
    enemyHp: number;
    names: { local: string; opponent: string };
    speciality: { player: SpecialityId | null; enemy: SpecialityId | null };
    units: Record<Team, Record<string, UnitPresence>>;
    unlocked: Record<Team, string[]>;
    replay: {
        version: number;
        seed: number;
        settings: GameSettings;
        actions: LoggedAction[];
    };
}

const SUBMIT_TIMEOUT_MS = 8_000;

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
 * Fetch a previously-submitted match by id — everything needed to replay it
 * is already in `replay` (same seed+settings+action-log shape a watch-mode
 * `Game` plays back at a natural pace). Returns null on any failure (not
 * found, unreachable, bad id) rather than throwing; callers decide how to
 * surface that. `side` disambiguates the rare case where two different
 * sides' records share a content-fingerprint id (see stats.php) — pass it
 * whenever the caller already knows which side's record it wants (e.g. a
 * specific "Watch" link in replays.html).
 */
export async function fetchMatchReplay(id: string, side?: 'a' | 'b'): Promise<MatchTelemetry | null> {
    try {
        const sideParam = side ? `&side=${encodeURIComponent(side)}` : '';
        const res = await fetch(`${statsUrl()}?action=get&id=${encodeURIComponent(id)}${sideParam}`);
        if (!res.ok) return null;
        const data = (await res.json()) as Partial<MatchTelemetry> | null;
        if (!data || !data.replay) return null;
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
