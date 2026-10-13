/** A lobby room's roster: open seats, the bots that fill them, names shown for them. */
import { wireAvatar } from '../game/avatar';
import { randomLoadout } from '../game/loadouts';
import type { CanonicalSeatDef, SeatId } from '../game/seats';
import { t } from '../i18n';

/** a seat's roster entry starts (and stays, until joined) at this exact
 *  placeholder — see initialStarRoster/initial1v1Roster — so "does this
 *  seat have a real name" is a reliable, host-and-guest-alike way to
 *  tell a filled seat from an open one without needing a separate
 *  connectedSeats list (which only the host can compute directly). */
export const OPEN_SEAT_NAME = 'Waiting…';

/** Drop untrusted avatar payloads from wire/roster copies. */
export function rosterWithWiredAvatars(roster: CanonicalSeatDef[]): CanonicalSeatDef[] {
    return roster.map((s) => {
        const avatar = wireAvatar(s.avatar);
        return avatar ? { ...s, avatar } : { ...s, avatar: undefined };
    });
}

/** fallback name for a still-empty seat when the host clicks Start —
 *  derived from side (host's own side = 'Ally', the other = 'Foe'), so
 *  this works for any roster size, not just the hardcoded 4-seat layout */
export function starAiName(seat: SeatId, roster: CanonicalSeatDef[]): string {
    const mySide = roster[0]!.side;
    if (roster[seat]!.side === mySide) return t('menu:aiNameAlly');
    const foeSeats = roster.map((_, i) => i).filter((i) => roster[i]!.side !== mySide);
    if (foeSeats.length <= 1) return t('menu:aiNameFoe');
    return foeSeats.indexOf(seat) === 0 ? t('menu:aiNameFoeWest') : t('menu:aiNameFoeEast');
}

/** the HUD's "opponent" name field only ever makes sense for a genuine
 *  2-seat (1v1-via-star) roster — a real 2v2+ has no single opponent to
 *  name, so it keeps the generic '2v2' label the HUD already expects. */
export function opponentDisplayName(roster: CanonicalSeatDef[], mySeat: SeatId): string {
    if (roster.length !== 2) return '2v2';
    return roster[mySeat === 0 ? 1 : 0]?.name ?? '2v2';
}

/** empty seats of a lobby roster become bots, each with its own rolled loadout */
export function rosterWithBots(roster: readonly CanonicalSeatDef[]): CanonicalSeatDef[] {
    return roster.map((s, i) =>
        i > 0 && s.controller === 'human' && s.name === OPEN_SEAT_NAME
            ? { side: s.side, controller: 'ai' as const, name: starAiName(i, [...roster]), loadout: randomLoadout(), ...(s.army ? { army: s.army } : {}) }
            : s,
    );
}
