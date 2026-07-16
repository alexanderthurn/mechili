/**
 * Open-track account client: username = identity, optional password.
 * No email reset — forgotten password means that name is gone.
 * All calls are best-effort — unreachable PHP never blocks play.
 */

import { BUILD_CHANNEL, isOpenBuild } from './channel';
import { playerUrl } from './net';
import { roomCodeFromName } from './player';

export interface PlayerProfile {
    track: string;
    id: string;
    name: string;
    mmr: number;
    peakMmr: number;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    mpGames: number;
    hasPassword?: boolean;
}

export type ProbeResult = { exists: boolean; hasPassword: boolean; name?: string };

export type ClaimResult =
    | { ok: true; player: PlayerProfile; token: string; created?: boolean }
    | { ok: false; needsPassword?: boolean; wrongPassword?: boolean; error?: string; hint?: string };

const TIMEOUT_MS = 8_000;
const AUTH_KEY = 'mechili-open-auth';

let cached: PlayerProfile | null = null;
/** true when local name is password-locked and we have no valid session */
let lockedOut = false;

export function getCachedProfile(): PlayerProfile | null {
    return cached;
}

export function isProfileLockedOut(): boolean {
    return lockedOut;
}

interface StoredAuth {
    nameKey: string;
    token: string;
}

function loadAuth(): StoredAuth | null {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw) as Partial<StoredAuth>;
        if (!data.nameKey || !data.token) return null;
        return { nameKey: data.nameKey, token: data.token };
    } catch {
        return null;
    }
}

function saveAuth(name: string, token: string): void {
    try {
        localStorage.setItem(
            AUTH_KEY,
            JSON.stringify({ nameKey: roomCodeFromName(name), token }),
        );
    } catch {
        /* private browsing */
    }
}

export function clearAuth(): void {
    try {
        localStorage.removeItem(AUTH_KEY);
    } catch {
        /* ignore */
    }
}

export function getSessionTokenFor(name: string): string | null {
    const auth = loadAuth();
    if (!auth) return null;
    if (auth.nameKey !== roomCodeFromName(name)) return null;
    return auth.token;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
    try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            // claim may return 200 with ok:false — still parse body
            const data = await res.json().catch(() => null);
            if (!res.ok && !data) return null;
            return data;
        } finally {
            window.clearTimeout(timer);
        }
    } catch {
        return null;
    }
}

export async function probeName(name: string): Promise<ProbeResult | null> {
    if (!isOpenBuild()) return null;
    const data = (await fetchJson(
        `${playerUrl()}?action=probe&name=${encodeURIComponent(name)}`,
    )) as ProbeResult | null;
    if (!data || typeof data.exists !== 'boolean') return null;
    return {
        exists: data.exists,
        hasPassword: !!data.hasPassword,
        name: data.name,
    };
}

export async function claimName(input: {
    name: string;
    password?: string;
    setPassword?: string;
    token?: string;
}): Promise<ClaimResult> {
    if (!isOpenBuild()) {
        return { ok: false, error: 'steam' };
    }
    const body: Record<string, string> = { name: input.name };
    if (input.password !== undefined) body.password = input.password;
    if (input.setPassword !== undefined) body.setPassword = input.setPassword;
    const token = input.token ?? getSessionTokenFor(input.name) ?? undefined;
    if (token) body.token = token;

    const data = (await fetchJson(`${playerUrl()}?action=claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })) as ClaimResult & { player?: PlayerProfile; token?: string } | null;

    if (!data) return { ok: false, error: 'unreachable' };
    if (data.ok === true && data.player && data.token) {
        cached = data.player;
        lockedOut = false;
        saveAuth(input.name, data.token);
        return { ok: true, player: data.player, token: data.token, created: data.created };
    }
    const fail = data as {
        needsPassword?: boolean;
        wrongPassword?: boolean;
        error?: string;
        hint?: string;
    };
    return {
        ok: false,
        needsPassword: !!fail.needsPassword,
        wrongPassword: !!fail.wrongPassword,
        error: fail.error,
        hint: fail.hint,
    };
}

/** resume session for current username (boot / return to menu) */
export async function syncOpenProfile(name: string): Promise<PlayerProfile | null> {
    if (!isOpenBuild()) return null;
    const token = getSessionTokenFor(name) ?? '';
    const q =
        `${playerUrl()}?action=hello&name=${encodeURIComponent(name)}` +
        (token ? `&token=${encodeURIComponent(token)}` : '');
    const data = (await fetchJson(q)) as {
        ok?: boolean;
        needsPassword?: boolean;
        player?: PlayerProfile;
        token?: string;
    } | null;

    if (!data) return cached;
    if (data.needsPassword) {
        cached = null;
        lockedOut = true;
        return null;
    }
    if (data.player) {
        cached = data.player;
        lockedOut = false;
        if (data.token) saveAuth(name, data.token);
        return cached;
    }
    return null;
}

export async function submitMatchResult(input: {
    matchId: string;
    mode: 'ai' | 'mp';
    result: 'victory' | 'defeat' | 'draw';
    names: { local: string; opponent: string };
}): Promise<PlayerProfile | null> {
    if (!isOpenBuild() || BUILD_CHANNEL !== 'open') return null;
    const token = getSessionTokenFor(input.names.local);
    const data = (await fetchJson(`${playerUrl()}?action=result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, token: token ?? undefined }),
        keepalive: true,
    })) as { player?: PlayerProfile } | null;
    if (data?.player) {
        cached = data.player;
        lockedOut = false;
        return cached;
    }
    return null;
}

export function reportMatchResult(input: {
    matchId: string;
    mode: 'ai' | 'mp';
    result: 'victory' | 'defeat' | 'draw';
    names: { local: string; opponent: string };
}): void {
    void submitMatchResult(input).catch(() => undefined);
}

export async function fetchLadder(limit = 50): Promise<PlayerProfile[]> {
    if (!isOpenBuild()) return [];
    const data = (await fetchJson(
        `${playerUrl()}?action=ladder&limit=${limit}`,
    )) as { ladder?: Array<Partial<PlayerProfile> & { name: string; mmr: number }> } | null;
    return (data?.ladder ?? []).map((row) => ({
        track: 'open',
        id: `open:${row.name}`,
        name: row.name,
        mmr: row.mmr,
        peakMmr: row.mmr,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        draws: row.draws ?? 0,
        games: row.games ?? 0,
        mpGames: row.games ?? 0,
    }));
}

export function matchResultId(seed: number, local: string, opponent: string, rounds: number): string {
    const raw = `v1:${seed}:${local.toLowerCase()}:${opponent.toLowerCase()}:${rounds}`;
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const a = (h >>> 0).toString(16).padStart(8, '0');
    let h2 = 0;
    for (let i = 0; i < raw.length; i++) h2 = (Math.imul(31, h2) + raw.charCodeAt(i)) | 0;
    const b = (h2 >>> 0).toString(16).padStart(8, '0');
    return (a + b + a + b).slice(0, 32);
}
