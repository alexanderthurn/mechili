import { CELL } from './map';
import {
    ACID_DPS_PERCENT,
    ACID_SPILL_DURATION_ROUNDS,
    ACID_SPILL_RADIUS,
    FIRE_SPILL_BURN_SEC,
    FIRE_SPILL_INTENSITY,
    FIRE_SPILL_RADIUS,
    OIL_SPEED_MULT,
    OIL_SPILL_DURATION_ROUNDS,
    OIL_SPILL_RADIUS,
} from './fire';
import { UNIT_TYPES } from './units';

/** tactical orders (not pack items) — granted by round cards, consumed per placement */
export const RALLY_ROUTE_ID = 'rallyRoute';
export const OIL_SPILL_ID = 'oilSpill';
/** selling a pack — charges come from the Research Center's sell ability, not cards */
export const SELL_UNIT_ID = 'sellUnit';
/** re-opens ONE older pack for dragging this round (see Placement.canReposition) */
export const MOVE_UNIT_ID = 'moveUnit';
/** tops one pack's XP bar up to its next-level threshold (Lady Lecture) */
export const TUTOR_ID = 'tutor';
/** battle spells: point-targeted stamps that fire seconds into the battle */
export const SPAWN_DWARVES_ID = 'spawnDwarves';
export const BIG_METEOR_ID = 'bigMeteor';
export const SPAWN_CROWS_ID = 'spawnCrows';
export const HAMMER_ID = 'hammerOfGods';
export const STORM_ID = 'storm';
export const METEOR_SHOWER_ID = 'meteorShower';
/** shared by sim (impact timing) and meteorFx (visual fall) — keep in sync */
export const METEOR_SHARD_FALL_SEC = 0.55;
export const POISON_CLOUD_ID = 'poisonCloud';
export const ACID_ID = 'acidSpill';
export const FIRE_SPILL_ID = 'fireSpill';
export const DRAGON_ID = 'dragonAttack';
/**
 * Charge marker clears this many seconds before breath/pour (`at`), when the
 * spit begins. The dragon model itself is visible from battle start.
 */
export const DRAGON_APPROACH_SEC = 0.38;
/** start→end breath / ground-fire pour while strafing */
export const DRAGON_POUR_DURATION_SEC = 1.55;

/**
 * Hammer of the Gods ground footprint (world units), centered on the stamp.
 * Shared by aim marker, mesh facing, and strike damage.
 *  halfWidth → X (across the head) · halfDepth → Z (thickness)
 *  Player yaw is chosen at placement (point-yaw); this default is unused in play.
 */
export const HAMMER_ZONE = {
    halfWidth: 17,
    halfDepth: 34,
};

/**
 * Max center-to-center distance per leg for two-/three-point tactics
 * (rally corridor segments / oil capsule). Keeps placements readable and
 * stops a single charge from covering the whole board.
 */
export const TACTIC_MAX_SPAN = 14 * CELL;

/** capture radius around each rally point (world units; unit collision radius is added at assign) */
export const RALLY_ROUTE_RADIUS = 5 * CELL;

/** extra clearance around enemy base buildings for safe-zone tactics */
export const TACTIC_SAFE_ZONE_MARGIN = 4 * CELL;

/**
 * HOW TO ADD A TACTIC — the whole system in one checklist:
 *  1. Register it here: an id constant + a TACTICS entry. `kind`, `targeting`
 *     and `cooldownRounds` drive the strip, the armed-click flow and the
 *     charge accounting generically — no HUD work needed.
 *  2. Give it an action in actions.ts. Validate + consume charges there:
 *     'placement' kinds count their standing placements against the
 *     inventory total; 'oneShot' kinds call consumeTacticCharge() so
 *     cooldown, undo, save/reload and the greyed-out strip entry all work
 *     automatically. NEW ACTION KINDS THAT CARRY UNIT IDS MUST BE ADDED TO
 *     Game.swapPerspective (peer desync!).
 *  3. Add the action payload to Game.dispatchTacticUse (one switch case) plus
 *     any draft/preview visuals. The targeting flow itself is generic.
 *  4. Grant charges through a round card (`tactics: [id]` in cards.ts) —
 *     cards are logged actions, so replay/reload handles them for free.
 *     For the SP cheat's free-testing top-up, add the id to
 *     CHEAT_TACTIC_GRANTS in game.ts too.
 *
 * `kind` (charge accounting):
 *  - 'placement': the charge stays bound to a standing placement (rally
 *    route, oil stamp) that the player can right-click in the strip to
 *    reset. Available = charges − standing placements; the charge frees up
 *    when the placement expires/clears (that IS its cooldown).
 *  - 'oneShot': the charge stays in the inventory forever; using it in
 *    round R makes it unavailable until round R + 1 + cooldownRounds. The
 *    uses are derived from the ACTION LOG, so undo, reload and multiplayer
 *    replay restore availability with zero extra state.
 *
 * `targeting` (armed-click flow, all generic in Game):
 *  - 'point': one ground click (validated against the safe zone when
 *    `respectsSafeZone`); 'two-point': start + end capsule like oil;
 *  - 'three-point': start → mid → end path (rally); each leg clamps to maxSpan;
 *  - 'point-yaw': first click locks position, move mouse to rotate, second
 *    click commits (hammer footprint);
 *  - 'own-unit': click one of your packs (sell / move / tutor).
 */
export const TACTICS: Record<
    string,
    {
        id: string;
        name: string;
        icon: string;
        description: string;
        kind: 'placement' | 'oneShot';
        targeting: 'point' | 'two-point' | 'three-point' | 'point-yaw' | 'own-unit';
        /** rounds to wait after use before a oneShot charge returns (0 = next round) */
        cooldownRounds: number;
        /** aim radius (point circle / capsule margin); board clamp + previews */
        radius?: number;
        /** two-/three-point: max center distance per leg (default TACTIC_MAX_SPAN) */
        maxSpan?: number;
        /** true = may not land inside the enemy-base safe zone (spawn-likes) */
        respectsSafeZone?: boolean;
        /**
         * Battle-spell payload: the stamp is intent during deploy and fires
         * `delaySeconds` after the opening freeze — the battle runs normally
         * until then (marching out of the marked area IS the counterplay).
         */
        spell?: {
            delaySeconds: number;
            /** one strike: damage to everything in the circle not under a ward */
            strike?: { damage: number; radius: number };
            /** battle-only summons scattered in the circle */
            spawn?: { typeId: string; count: number };
            /**
             * Ticking area effect running `duration` seconds after the delay,
             * point-targeted only: 'storm' zaps one random unit per tick
             * (wards absorb per bolt); 'meteorShower' drops a small strike on
             * a random spot per tick (+ ignites fire); 'acidRain' rains small
             * acid drips that stamp sparse ground acid (same rules as Acid Spill).
             */
            zone?: {
                mode: 'storm' | 'meteorShower' | 'acidRain';
                duration: number;
                interval: number;
                /** flat damage per tick (storm / meteor); unused for acidRain */
                damage: number;
                /** meteorShower / acidRain: splash or puddle radius per impact */
                impactRadius?: number;
                /** meteorShower: ground-fire radius per impact */
                igniteRadius?: number;
                /** acidRain: how many drips spawn each tick */
                dropsPerTick?: number;
            };
            /** two-point: progressive fire pour along the capsule (dragon breath) —
             *  stamped left→right over {@link DRAGON_POUR_DURATION_SEC}, not a one-shot.
             *  `damage` is direct breath hit per pour disc (wards absorb like strikes). */
            igniteCapsule?: { burnSeconds: number; intensity: number; damage?: number };
        };
        /**
         * Acid / Fire Spill: two-point capsules that pour left→right as drips
         * shortly after battle start (same pour timing as oil). Acid persists
         * by ROUND; fire is battle-seconds only.
         */
        acidCapsule?: { durationRounds: number; dpsPercent: number };
        fireCapsule?: { burnSeconds: number; intensity: number };
        /**
         * Price to buy one charge outright at the Stronghold. Per spell, not
         * per tier — a commander is free to carry three expensive ones. Absent
         * = not sold there at all, so a new spell has to opt in on purpose.
         */
        strongholdCost?: number;
        /** oil spill only */
        oilRadius?: number;
        oilDurationRounds?: number;
    }
> = {
    [RALLY_ROUTE_ID]: {
        id: RALLY_ROUTE_ID,
        name: 'Rally Route',
        icon: 'tactic-rally',
        kind: 'placement',
        targeting: 'three-point',
        cooldownRounds: 0,
        radius: RALLY_ROUTE_RADIUS,
        description:
            'Place start, middle, and end zones. Units in the start circle march through matching offsets at the middle, then the end, fighting along the way.',
    },
    [OIL_SPILL_ID]: {
        id: OIL_SPILL_ID,
        strongholdCost: 100,
        name: 'Oil Spill',
        icon: 'tactic-oil',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 1,
        radius: OIL_SPILL_RADIUS,
        description:
            'Place two oil circles — outline during deploy; shortly after battle starts oil drips left-to-right onto the path (ward discs stay clear). Connected oil ignites as one field when fire touches it.',
        oilRadius: OIL_SPILL_RADIUS,
        oilDurationRounds: OIL_SPILL_DURATION_ROUNDS,
    },
    [SELL_UNIT_ID]: {
        id: SELL_UNIT_ID,
        name: 'Sell Pack',
        icon: 'tactic-sell',
        kind: 'oneShot',
        targeting: 'own-unit',
        cooldownRounds: 0,
        description:
            'Click to arm, then click one of your packs to sell it for a supply refund.',
    },
    [MOVE_UNIT_ID]: {
        id: MOVE_UNIT_ID,
        name: 'Move Pack',
        icon: 'ui-move',
        kind: 'oneShot',
        targeting: 'own-unit',
        cooldownRounds: 0,
        description:
            'Click to arm, then click one of your packs from an earlier round — it may be dragged and rotated again for the rest of this round.',
    },
    [TUTOR_ID]: {
        id: TUTOR_ID,
        name: 'Field Lesson',
        icon: 'ability-plus-l2',
        kind: 'oneShot',
        targeting: 'own-unit',
        // used this round -> badge reads cooldownRounds + 1, so 1 here shows "2"
        cooldownRounds: 1,
        description:
            'Click to arm, then click one of your packs — its XP bar fills to the next level. Buying the level still costs supply.',
    },
    [SPAWN_DWARVES_ID]: {
        id: SPAWN_DWARVES_ID,
        strongholdCost: 100,
        name: 'Summon Dwarves',
        icon: 'tactic-summon-dwarves',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 1,
        radius: 4 * CELL,
        respectsSafeZone: true,
        // count = PACKS (a dwarf pack is 24 fighters — 2 packs ≈ 48 dwarves)
        spell: { delaySeconds: 2, spawn: { typeId: 'dwarf', count: 2 } },
        description:
            'Mark a circle anywhere outside the enemy base. Shortly after battle start, a war band of dwarves bursts from the ground there, one by one — they fight this battle only.',
    },
    [BIG_METEOR_ID]: {
        id: BIG_METEOR_ID,
        strongholdCost: 200,
        name: 'Meteor',
        icon: 'tactic-meteor',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 3 * CELL,
        spell: { delaySeconds: 4, strike: { damage: 200, radius: 3 * CELL } },
        description:
            'Mark a small circle anywhere. Seconds into the battle a meteor obliterates everything there — only ward domes protect (and pay for it).',
    },
    [SPAWN_CROWS_ID]: {
        id: SPAWN_CROWS_ID,
        strongholdCost: 200,
        name: 'Summon Crow Riders',
        icon: 'tactic-summon-crows',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 1,
        radius: 4 * CELL,
        respectsSafeZone: true,
        // count = PACKS (a crow-rider flock is 12 riders)
        spell: { delaySeconds: 2, spawn: { typeId: 'crowRider', count: 2 } },
        description:
            'Mark a circle anywhere outside the enemy base. Shortly after battle start, crow riders dive in from the sky, one after another — they fight this battle only.',
    },
    [HAMMER_ID]: {
        id: HAMMER_ID,
        strongholdCost: 300,
        name: 'Hammer of the Gods',
        icon: 'tactic-hammer',
        kind: 'placement',
        targeting: 'point-yaw',
        cooldownRounds: 2,
        // aim clamp approx — visual/damage zone is HAMMER_ZONE
        radius: 18,
        spell: { delaySeconds: 4, strike: { damage: 1000, radius: 6 * CELL } },
        description:
            'Click to place, move to rotate, click again to lock. A divine hammer drops onto the zone seconds into the battle.',
    },
    [STORM_ID]: {
        id: STORM_ID,
        strongholdCost: 200,
        name: 'Storm Call',
        icon: 'tactic-storm',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 7 * CELL,
        spell: {
            delaySeconds: 3,
            zone: { mode: 'storm', duration: 10, interval: 0.7, damage: 150 },
        },
        description:
            'Mark a wide circle anywhere. A storm gathers there and hurls lightning at random units for a while — ward domes absorb the bolts (and suffer).',
    },
    [METEOR_SHOWER_ID]: {
        id: METEOR_SHOWER_ID,
        strongholdCost: 300,
        name: 'Meteor Shower',
        icon: 'tactic-shower',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 10.5 * CELL,
        spell: {
            delaySeconds: 3,
            zone: {
                mode: 'meteorShower',
                // 3× duration; interval scaled so total meteor count stays ~same
                duration: 24,
                interval: 1.8,
                damage: 140,
                impactRadius: 1.5 * CELL,
                igniteRadius: 1 * CELL,
            },
        },
        description:
            'Mark a wide circle anywhere. Meteors rain onto random spots inside for a while, each blast burning the ground it hits.',
    },
    [ACID_ID]: {
        id: ACID_ID,
        strongholdCost: 200,
        name: 'Acid Spill',
        icon: 'tactic-acid',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: ACID_SPILL_DURATION_ROUNDS,
        radius: ACID_SPILL_RADIUS,
        // pours left→right shortly after battle start (same drip timing as oil)
        acidCapsule: { durationRounds: ACID_SPILL_DURATION_ROUNDS, dpsPercent: ACID_DPS_PERCENT },
        description:
            'Pour an acid capsule like an oil spill — it drips left-to-right onto the ground shortly after battle starts. Ground and air units over the puddle sizzle and turn corroded — taking extra damage from everything.',
    },
    [FIRE_SPILL_ID]: {
        id: FIRE_SPILL_ID,
        strongholdCost: 100,
        name: 'Fire Spill',
        icon: 'tactic-fire',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 1,
        radius: FIRE_SPILL_RADIUS,
        fireCapsule: { burnSeconds: FIRE_SPILL_BURN_SEC, intensity: FIRE_SPILL_INTENSITY },
        description:
            'Pour a fire capsule like oil — it drips left-to-right shortly after battle starts and sets the path ablaze (ward discs stay clear). Connected oil ignites with it. Flame lasts this battle only.',
    },
    [DRAGON_ID]: {
        id: DRAGON_ID,
        strongholdCost: 300,
        name: 'Dragon Attack',
        icon: 'tactic-dragon',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 3,
        radius: 5 * CELL,
        maxSpan: 24 * CELL,
        spell: {
            delaySeconds: 5,
            igniteCapsule: { burnSeconds: 4, intensity: 48, damage: 1400 },
        },
        description:
            'Draw the dragon’s strafing path (wider and longer than oil). It dives in and breathes fire along the corridor — the beam scorches units as it passes and paints the ground ablaze. Ward domes absorb the breath (and pay for it).',
    },
    [POISON_CLOUD_ID]: {
        id: POISON_CLOUD_ID,
        strongholdCost: 300,
        name: 'Poison Cloud',
        icon: 'tactic-poison',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        // Same footprint as Meteor Shower — sparse acid rain fills it gradually.
        radius: 10.5 * CELL,
        spell: {
            delaySeconds: 2,
            zone: {
                mode: 'acidRain',
                duration: 14,
                interval: 0.28,
                damage: 0,
                impactRadius: 0.55 * CELL,
                dropsPerTick: 3,
            },
        },
        description:
            'Mark a huge circle. Toxic clouds gather overhead and rain small acid drops across the area — sparse puddles that corrode ground and air units like Acid Spill, but over a much wider field.',
    },
};

/**
 * True for any tactic whose placement/aim/cooldown flows through the generic
 * `placeSpell`/`SpellStamp` system — scheduled battle spells (`spell`) AND
 * ground-hazard pours (`acidCapsule` / `fireCapsule`) alike. Oil and rally have
 * their own dedicated actions and are NOT included.
 */
export function usesSpellPlacement(tactic: (typeof TACTICS)[string]): boolean {
    return !!(tactic.spell || tactic.acidCapsule || tactic.fireCapsule);
}

/** world radius → board cells (CELL-sized tiles) for readable UI */
function cellsLabel(world: number): string {
    const n = Math.round((world / CELL) * 10) / 10;
    return `${n} cell${n === 1 ? '' : 's'}`;
}

function roundsLabel(n: number): string {
    return `${n} round${n === 1 ? '' : 's'}`;
}

/**
 * Numeric / rule stats derived from the tactic payload (single source of truth).
 * Flavor `description` should stay number-free; UIs render these lines instead.
 */
export function formatTacticStats(t: (typeof TACTICS)[string]): string[] {
    const lines: string[] = [];

    // +1, and never hidden: `cooldownRounds` counts rounds to WAIT, so 0 means
    // "back next round" rather than "no cooldown" (see the type's own note, and
    // the in-game badge, which reads cooldownRounds + 1 for exactly this reason).
    // Printing the raw field left every 0 blank and made a once-per-round spell
    // look like it had no limit at all.
    lines.push(`Cooldown ${roundsLabel(t.cooldownRounds + 1)}`);

    if (t.radius != null && (t.spell || t.acidCapsule || t.fireCapsule || t.oilRadius)) {
        lines.push(`Aim ${cellsLabel(t.radius)}`);
    }
    if (t.maxSpan != null) {
        lines.push(`Max path ${cellsLabel(t.maxSpan)}`);
    }

    const spell = t.spell;
    if (spell) {
        lines.push(`Delay ${spell.delaySeconds}s`);
        if (spell.strike) {
            lines.push(`Damage ${spell.strike.damage}`);
            lines.push(`Blast ${cellsLabel(spell.strike.radius)}`);
        }
        if (spell.spawn) {
            const unit = UNIT_TYPES.find((u) => u.id === spell.spawn!.typeId);
            const label = unit?.name ?? spell.spawn.typeId;
            lines.push(`Summon ${spell.spawn.count}× ${label}`);
        }
        if (spell.zone) {
            const z = spell.zone;
            if (z.mode === 'storm') {
                lines.push(`Lightning ${z.damage} every ${z.interval}s`);
            } else if (z.mode === 'acidRain') {
                const n = z.dropsPerTick ?? 1;
                lines.push(`Acid rain ×${n} every ${z.interval}s`);
                if (z.impactRadius != null) lines.push(`Drop ${cellsLabel(z.impactRadius)}`);
            } else if (z.mode === 'meteorShower') {
                lines.push(`Meteor ${z.damage} every ${z.interval}s`);
                if (z.impactRadius != null) lines.push(`Impact ${cellsLabel(z.impactRadius)}`);
                if (z.igniteRadius != null) {
                    lines.push(`Ignite ${cellsLabel(z.igniteRadius)}`);
                }
            }
            lines.push(`Duration ${z.duration}s`);
        }
        if (spell.igniteCapsule) {
            const c = spell.igniteCapsule;
            if (c.damage != null && c.damage > 0) {
                lines.push(`Breath damage ${c.damage}`);
            }
            lines.push(`Ground fire DPS ${c.intensity}`);
            lines.push(`Ground burn ${c.burnSeconds}s`);
        }
    }

    if (t.fireCapsule) {
        lines.push(`Fire DPS ${t.fireCapsule.intensity}`);
        lines.push(`Burn ${t.fireCapsule.burnSeconds}s`);
    }

    if (t.acidCapsule) {
        lines.push(`Acid ${t.acidCapsule.dpsPercent}% max HP / s`);
        lines.push(`Lasts ${roundsLabel(t.acidCapsule.durationRounds)}`);
        lines.push('Applies corroded');
    }

    if (t.oilDurationRounds != null) {
        lines.push(`Oil ${OIL_SPEED_MULT}× move speed`);
        lines.push(`Lasts ${roundsLabel(t.oilDurationRounds)}`);
    }

    return lines;
}

/** how close a mech must get to its personal destination */
export const RALLY_ROUTE_REACH = CELL * 0.5;
/** if a mech cannot get closer for this long, treat the route as complete */
export const RALLY_ROUTE_STUCK_SEC = 3;

export interface RallyRoute {
    id: number;
    team: import('./units').Team;
    /** whose charge this was placed from — tactics are per-seat now */
    seat: import('./seats').SeatId;
    startX: number;
    startZ: number;
    /** waypoint between start and end (offset-preserving march) */
    midX: number;
    midZ: number;
    endX: number;
    endZ: number;
}

/** one placed battle spell: intent during deploy, fires in battle.
 *  Two-point spells (acid) carry an end — the effect covers the capsule.
 *  point-yaw spells (hammer) carry yaw for the footprint orientation. */
export interface SpellStamp {
    id: number;
    tacticId: string;
    team: import('./units').Team;
    /** whose charge this was placed from — tactics are per-seat now */
    seat: import('./seats').SeatId;
    x: number;
    z: number;
    endX?: number;
    endZ?: number;
    /** radians — footprint rotation (hammer); 0 = default local axes */
    yaw?: number;
    placedRound: number;
}

/** Keep-out disk around an enemy base building (same math as {@link pointInSafeZone}). */
export type SafeZoneDisk = { x: number; z: number; radius: number };

/**
 * Keep-out disks around the OPPOSING side's base buildings.
 * `margin` is usually the armed tactic's aim radius so the disk matches the
 * hit-test used by aim preview + dispatcher.
 */
export function safeZoneDisks(
    units: readonly import('./units').Unit[],
    team: import('./units').Team,
    margin = 0,
): SafeZoneDisk[] {
    const out: SafeZoneDisk[] = [];
    for (const u of units) {
        if (u.team === team || !u.type.structure || u.type.extra || u.destroyed) continue;
        const fp = u.type.footprint;
        const buildingRadius = (Math.max(fp.cols, fp.rows) / 2) * CELL;
        out.push({
            x: u.world.x,
            z: u.world.z,
            radius: buildingRadius + TACTIC_SAFE_ZONE_MARGIN + margin,
        });
    }
    return out;
}

/**
 * Safe zone: circles around the OPPOSING side's base buildings. Shared by the
 * UI (aim preview) and the dispatcher (a hostile peer isn't bound by UI checks).
 */
export function pointInSafeZone(
    units: readonly import('./units').Unit[],
    team: import('./units').Team,
    x: number,
    z: number,
    margin = 0,
): boolean {
    for (const d of safeZoneDisks(units, team, margin)) {
        if (det2d(x - d.x, z - d.z) < d.radius) return true;
    }
    return false;
}

/** one oil stamp action record (capsule: two circles + strip between) */
export interface OilStamp {
    id: number;
    team: import('./units').Team;
    /** whose charge this was placed from — tactics are per-seat now */
    seat: import('./seats').SeatId;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    radius: number;
    /** last inclusive round this stamp's oil remains */
    expiresRound: number;
    placedRound: number;
}

/**
 * Deterministic 2D length: sqrt IS correctly rounded per IEEE-754 in every
 * engine, Math.hypot is NOT — this feeds dispatcher-validated state (capsule
 * ends, safe-zone accept/reject), so lockstep peers must agree exactly.
 */
function det2d(dx: number, dz: number): number {
    return Math.sqrt(dx * dx + dz * dz);
}

/** pull `end` toward `start` so center distance ≤ maxSpan */
export function clampTacticEnd(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    maxSpan = TACTIC_MAX_SPAN,
): { x: number; z: number } {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = det2d(dx, dz);
    if (len <= maxSpan || len < 1e-9) return { x: endX, z: endZ };
    const s = maxSpan / len;
    return { x: startX + dx * s, z: startZ + dz * s };
}

/** keep a tactic circle fully on the board (margin = circle radius) */
export function clampTacticPoint(
    x: number,
    z: number,
    halfW: number,
    halfH: number,
    radius: number,
): { x: number; z: number } {
    return {
        x: Math.max(-halfW + radius, Math.min(halfW - radius, x)),
        z: Math.max(-halfH + radius, Math.min(halfH - radius, z)),
    };
}

/** Short glyphs for emoji ground markers (see spellMarkerIcons ATLAS_MARKER_TACTICS). */
const TACTIC_WORLD_GLYPH: Record<string, string> = {
    [RALLY_ROUTE_ID]: '⚑',
    [SELL_UNIT_ID]: '💰',
    [MOVE_UNIT_ID]: '🏃',
    [TUTOR_ID]: '📖',
    [HAMMER_ID]: '🔨',
    [STORM_ID]: '🌩',
    [DRAGON_ID]: '🐉',
};

export function tacticWorldGlyph(tacticId: string): string {
    return TACTIC_WORLD_GLYPH[tacticId] ?? '✦';
}
