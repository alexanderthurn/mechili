/**
 * The lobby remembers its seats' chips (army, Siege role, AI strength and
 * style) between visits, next to the room's own settings (AI_PLAN.md):
 * Practice every seat's, a hosted room only its AI seats' (who sits in a
 * human seat changes with who joins). Kept per lobby kind and seat count —
 * a 1v1 and a 2v2 roster don't share seats.
 */
import { isAiDifficulty, isAiPersonality } from '../game/aiProfile';
import type { CanonicalSeatDef } from '../game/seats';
import { seatChipsOf } from './lobbyRoster';

type SeatChips = ReturnType<typeof seatChipsOf>;
export type ChipLobby = 'practice' | 'hosted';

const KEY = 'melodan-seat-chips';

function storageKey(lobby: ChipLobby, seats: number): string {
    return `${lobby}-${seats}`;
}

function readAll(): Record<string, SeatChips[]> {
    try {
        const raw = localStorage.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, SeatChips[]>) : {};
    } catch {
        return {};
    }
}

/** a stored entry, keeping only values that still mean something */
function clean(raw: unknown): SeatChips {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
        ...(typeof r.army === 'string' ? { army: r.army } : {}),
        ...(r.yearRole === 'attacker' || r.yearRole === 'defender' ? { yearRole: r.yearRole } : {}),
        ...(isAiDifficulty(r.aiDifficulty) ? { aiDifficulty: r.aiDifficulty } : {}),
        ...(isAiPersonality(r.aiPersonality) ? { aiPersonality: r.aiPersonality } : {}),
    };
}

/**
 * `roster` with the remembered chips put back on its seats — every seat in
 * Practice, in a hosted room only the open ones (a bot's to be).
 * `armies` = the armies that still exist (a stored one that doesn't is dropped).
 */
export function withRememberedChips(
    lobby: ChipLobby,
    roster: readonly CanonicalSeatDef[],
    isOpen: (seat: number) => boolean,
    armies: readonly string[],
): CanonicalSeatDef[] {
    const stored = readAll()[storageKey(lobby, roster.length)] ?? [];
    return roster.map((entry, seat) => {
        if (lobby === 'hosted' && !isOpen(seat)) return entry;
        const chips = clean(stored[seat]);
        if (chips.army && !armies.includes(chips.army)) delete chips.army;
        return { ...entry, ...chips };
    });
}

/** remembers the roster's chips (in a hosted room only the open / AI seats', the rest keeps what was stored) */
export function rememberChips(lobby: ChipLobby, roster: readonly CanonicalSeatDef[], isOpen: (seat: number) => boolean): void {
    try {
        const all = readAll();
        const key = storageKey(lobby, roster.length);
        const before = all[key] ?? [];
        all[key] = roster.map((entry, seat) => (lobby === 'hosted' && !isOpen(seat) ? clean(before[seat]) : seatChipsOf(entry)));
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        /* private browsing */
    }
}
