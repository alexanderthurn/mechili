/**
 * Tech loadouts — the player's pregame talent picks, per unit type.
 *
 * See PROGRESSION_PLAN.md §1. A unit type's data says which talents it MAY
 * take (`talents`) and how many (`talentSlots`); a Loadout is one player's
 * choice within that. Loadouts are built against the base game's types.
 *
 * Three rules hold everywhere:
 *
 * 1. **A loadout is a choice, never an unlock.** Every talent is available
 *    to every player from the first match — nothing here is earned, bought
 *    or gated. (PROGRESSION_PLAN.md §0.1: rewards never grant combat power.)
 * 2. **Normalize at the boundary.** A loadout crosses the wire and then
 *    feeds combat math, so an unvalidated one is a desync or an exploit,
 *    not a cosmetic problem.
 * 3. **Absent means default.** No loadout resolves to the historical
 *    "first N allowed ids", so pre-loadout replays and the showcase page
 *    keep working untouched.
 */

import { allowedTechIds, techSlotLimit, type Loadout } from './techCatalog';
import type { TypeRegistry } from './content/typeRegistry';
import { BASE_TYPES, isPlayerBuyable, type UnitType } from './units';
import { USER_STORAGE_PREFIX } from './userStorage';

export type { Loadout };

/**
 * The one stored loadout, in the user-storage namespace — so it syncs via
 * Steam Auto-Cloud `user.sav` and follows the player between machines.
 *
 * It belongs there rather than in the progression file (PROGRESSION_PLAN.md
 * §2c) precisely because it is written RARELY, only when edited. The
 * per-match progression writes are the ones that need their own file to
 * stay clear of the Cloud conflict problem.
 */
export const LOADOUT_KEY = `${USER_STORAGE_PREFIX}loadout`;

/** Unit types a player picks talents for — no structures, extras or horde. */
export function loadoutUnitTypes() {
    return BASE_TYPES.roster.filter(
        (t) => !t.structure && !t.extra && isPlayerBuyable(t) && allowedTechIds(t).length > 0,
    );
}

/** The first N allowed ids — what `selectedTechIds` returned before loadouts. */
function defaultTechIdsFor(type: UnitType): string[] {
    return allowedTechIds(type)
        .slice(0, techSlotLimit(type))
        .filter((id) => BASE_TYPES.talent(id) !== null);
}

/** A full default loadout — a fresh profile plays exactly as before. */
export function defaultLoadout(): Loadout {
    const techs: Record<string, string[]> = {};
    for (const type of loadoutUnitTypes()) techs[type.id] = defaultTechIdsFor(type);
    return { techs };
}

/**
 * Every talent each type may take, no slot limit — the scenario editor's
 * sandbox, never a player's match loadout (rule 1 still holds: nothing is
 * unlocked, it only lifts the pick limit while building a board).
 */
export function openLoadout(types: TypeRegistry): Loadout {
    const techs: Record<string, string[]> = {};
    for (const type of types.all()) {
        const ids = allowedTechIds(type).filter((id) => types.talent(id) !== null);
        if (ids.length > 0) techs[type.id] = [...ids];
    }
    return { techs };
}

/**
 * Coerce anything into a loadout safe to feed the sim: drops unknown type
 * ids, unknown talent ids and ids off that type's allowlist, dedupes, and
 * truncates to the slot limit. Never throws — bad input degrades to the
 * default for that type, because refusing to start a match is worse than
 * playing the default build.
 */
export function normalizeLoadout(raw: unknown): Loadout {
    const root =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const nested = root.techs;
    const src =
        nested && typeof nested === 'object' && !Array.isArray(nested)
            ? (nested as Record<string, unknown>)
            : {};
    const techs: Record<string, string[]> = {};
    for (const type of loadoutUnitTypes()) {
        const picked = src[type.id];
        if (!Array.isArray(picked)) {
            techs[type.id] = defaultTechIdsFor(type);
            continue;
        }
        const allowed = allowedTechIds(type);
        const ids: string[] = [];
        for (const id of picked) {
            if (typeof id !== 'string' || ids.includes(id)) continue;
            if (!allowed.includes(id) || BASE_TYPES.talent(id) === null) continue;
            ids.push(id);
            if (ids.length >= techSlotLimit(type)) break;
        }
        techs[type.id] = ids;
    }
    return { techs };
}

/**
 * A randomized loadout for an AI seat — bots would otherwise all play the
 * catalog default, which is array order, not a build anyone designed.
 *
 * Rolled ONCE, where the seat is created, then carried on the roster
 * exactly like a human's, never re-derived per client. That is what keeps
 * every client agreeing: the value is transferred data, not a computation
 * that has to reproduce identically everywhere. Math.random is fine here
 * (match SETUP, same as the seed itself), and the result lands in
 * `this.seats`, so the roster snapshot and `exportReplay` both capture it.
 *
 * Slots are filled to the limit — a bot has no reason to hold one back.
 */
export function randomLoadout(rand: () => number = Math.random): Loadout {
    const techs: Record<string, string[]> = {};
    for (const type of loadoutUnitTypes()) {
        const picks = allowedTechIds(type).filter((id) => BASE_TYPES.talent(id) !== null);
        for (let i = picks.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = picks[i]!;
            picks[i] = picks[j]!;
            picks[j] = tmp;
        }
        techs[type.id] = picks.slice(0, techSlotLimit(type));
    }
    return { techs };
}

/**
 * Toggle one talent, respecting the slot limit. Selecting past a full bar
 * drops the oldest pick, so a click always does something visible instead
 * of silently refusing.
 */
export function toggleTech(loadout: Loadout, typeId: string, techId: string): Loadout {
    const type = BASE_TYPES.byId(typeId);
    if (!type || !allowedTechIds(type).includes(techId)) return loadout;
    const current = [...(loadout.techs[typeId] ?? defaultTechIdsFor(type))];
    const at = current.indexOf(techId);
    if (at >= 0) current.splice(at, 1);
    else {
        current.push(techId);
        while (current.length > techSlotLimit(type)) current.shift();
    }
    return { ...loadout, techs: { ...loadout.techs, [typeId]: current } };
}

/**
 * The loadout this client plays with — what gets sent to peers on join.
 * Always normalized, so a corrupted save can never reach the wire.
 */
export function activeLoadout(): Loadout {
    try {
        const raw = localStorage.getItem(LOADOUT_KEY);
        return normalizeLoadout(raw ? JSON.parse(raw) : null);
    } catch {
        return defaultLoadout();
    }
}

export function saveLoadout(loadout: Loadout): void {
    try {
        localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
    } catch {
        /* private browsing / quota */
    }
}
