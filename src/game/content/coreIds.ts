/**
 * Spells the game itself names (plan §17): each has its own action and is
 * granted by buildings or the forge rather than being a data-only battle
 * spell, and their ids are stored in action logs, saves and replays. A pack
 * must define them, with the targeting their actions expect — loading checks it.
 */
export const RALLY_ROUTE_ID = 'rallyRoute';
export const OIL_SPILL_ID = 'oilSpill';
/** selling a pack — charges come from the Research Center's sell ability, not cards */
export const SELL_UNIT_ID = 'sellUnit';
/** re-opens ONE older pack for dragging this round (see Placement.canReposition) */
export const MOVE_UNIT_ID = 'moveUnit';
/** tops one pack's XP bar up to its next-level threshold (Lady Lecture) */
export const TUTOR_ID = 'tutor';

/** core spell id → the targeting its action needs */
export const CORE_SPELL_TARGETING: Readonly<Record<string, string>> = {
    [RALLY_ROUTE_ID]: 'three-point',
    [OIL_SPILL_ID]: 'two-point',
    [SELL_UNIT_ID]: 'own-unit',
    [MOVE_UNIT_ID]: 'own-unit',
    [TUTOR_ID]: 'own-unit',
};
