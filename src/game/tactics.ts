import { CELL } from './map';
import {
    ACID_DPS_PERCENT,
    ACID_SPILL_DURATION_ROUNDS,
    ACID_SPILL_RADIUS,
    OIL_SPILL_DURATION_ROUNDS,
    OIL_SPILL_RADIUS,
} from './fire';

/** tactical orders (not pack items) — granted by round cards, consumed per placement */
export const RALLY_ROUTE_ID = 'rallyRoute';
export const OIL_SPILL_ID = 'oilSpill';
/** selling a pack — charges come from the Command Tower's sell ability, not cards */
export const SELL_UNIT_ID = 'sellUnit';
/** battle spells: point-targeted stamps that fire seconds into the battle */
export const SPAWN_DWARVES_ID = 'spawnDwarves';
export const BIG_METEOR_ID = 'bigMeteor';
export const SPAWN_CROWS_ID = 'spawnCrows';
export const HAMMER_ID = 'hammerOfGods';
export const STORM_ID = 'storm';
export const METEOR_SHOWER_ID = 'meteorShower';
export const POISON_CLOUD_ID = 'poisonCloud';
export const ACID_ID = 'acidSpill';
export const DRAGON_ID = 'dragonAttack';

/**
 * Max center-to-center distance for two-point tactics (rally corridor / oil capsule).
 * Keeps placements readable and stops a single charge from covering the whole board.
 */
export const TACTIC_MAX_SPAN = 14 * CELL;

/** capture radius around each rally point (world units) */
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
 *     Grants OUTSIDE the action log (dev freebies) must exist before a
 *     reload's replay: add the id to TEST_TACTIC_GRANTS in game.ts, done.
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
 *    `respectsSafeZone`); 'two-point': start + end capsule like oil/rally;
 *  - 'own-unit': click one of your packs (sell).
 */
export const TACTICS: Record<
    string,
    {
        id: string;
        name: string;
        icon: string;
        description: string;
        kind: 'placement' | 'oneShot';
        targeting: 'point' | 'two-point' | 'own-unit';
        /** rounds to wait after use before a oneShot charge returns (0 = next round) */
        cooldownRounds: number;
        /** aim radius (point circle / capsule margin); board clamp + previews */
        radius?: number;
        /** two-point: max start→end distance (default TACTIC_MAX_SPAN) */
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
             * a random spot per tick (+ ignites fire); 'poison' damages every
             * unit inside per tick — gas ignores wards, unit types with
             * `poisonImmune` shrug it off.
             */
            zone?: {
                mode: 'storm' | 'meteorShower' | 'poison';
                duration: number;
                interval: number;
                /** flat damage per tick */
                damage: number;
                /** meteorShower: splash radius per impact */
                impactRadius?: number;
                /** meteorShower: ground-fire radius per impact */
                igniteRadius?: number;
            };
            /** two-point: set the whole capsule ablaze once at the delay
             *  (dragon breath — the capsule is the flight path) */
            igniteCapsule?: { burnSeconds: number; intensity: number };
        };
        /**
         * Acid: NOT a scheduled battle spell — committed straight into the
         * persistent hazard field (HazardField.acidExpires) the instant
         * battle starts, same moment and same mechanism as oil, no delay.
         * Expires by ROUND like oil, not by battle-seconds.
         */
        acidCapsule?: { durationRounds: number };
        /** oil spill only */
        oilRadius?: number;
        oilDurationRounds?: number;
    }
> = {
    [RALLY_ROUTE_ID]: {
        id: RALLY_ROUTE_ID,
        name: 'Rally Route',
        icon: '⚑',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 0,
        radius: RALLY_ROUTE_RADIUS,
        description:
            'Place a start and end zone. Units in the start circle march to matching positions at the end, fighting along the way.',
    },
    [OIL_SPILL_ID]: {
        id: OIL_SPILL_ID,
        name: 'Oil Spill',
        icon: '🛢',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 1,
        radius: OIL_SPILL_RADIUS,
        description:
            'Place two oil circles — outline during deploy; oil lands at battle start (ward discs stay clear). Connected oil ignites as one field when fire touches it.',
        oilRadius: OIL_SPILL_RADIUS,
        oilDurationRounds: OIL_SPILL_DURATION_ROUNDS,
    },
    [SELL_UNIT_ID]: {
        id: SELL_UNIT_ID,
        name: 'Sell Pack',
        icon: '💰',
        kind: 'oneShot',
        targeting: 'own-unit',
        cooldownRounds: 0,
        description:
            'Click to arm, then click one of your packs to sell it for a supply refund.',
    },
    [SPAWN_DWARVES_ID]: {
        id: SPAWN_DWARVES_ID,
        name: 'Summon Dwarves',
        icon: '⚒',
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
        name: 'Great Meteor',
        icon: '☄',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 3,
        radius: 3 * CELL,
        spell: { delaySeconds: 4, strike: { damage: 3000, radius: 3 * CELL } },
        description:
            'Mark a small circle anywhere. Seconds into the battle a meteor obliterates everything there — only ward domes protect (and pay for it).',
    },
    [SPAWN_CROWS_ID]: {
        id: SPAWN_CROWS_ID,
        name: 'Summon Crow Riders',
        icon: '🐦',
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
        name: 'Hammer of the Gods',
        icon: '🔨',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 6 * CELL,
        spell: { delaySeconds: 4, strike: { damage: 1000, radius: 6 * CELL } },
        description:
            'Mark a HUGE circle anywhere. A divine hammer stamps it flat seconds into the battle — everything not under a ward dome takes severe damage.',
    },
    [STORM_ID]: {
        id: STORM_ID,
        name: 'Storm Call',
        icon: '🌩',
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
        name: 'Meteor Shower',
        icon: '🌠',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 7 * CELL,
        spell: {
            delaySeconds: 3,
            zone: {
                mode: 'meteorShower',
                duration: 8,
                interval: 0.6,
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
        name: 'Acid Spill',
        icon: '🧪',
        kind: 'placement',
        targeting: 'two-point',
        // charge cooldown mirrors oil's (both currently 1 round: the charge
        // is available again as soon as the puddle itself has expired)
        cooldownRounds: ACID_SPILL_DURATION_ROUNDS,
        radius: ACID_SPILL_RADIUS,
        // lands on the ground the instant battle starts, expires by ROUND —
        // technically identical to oil, just a different per-step effect
        // (percent-of-max-HP damage + corroded, instead of a speed penalty)
        acidCapsule: { durationRounds: ACID_SPILL_DURATION_ROUNDS },
        description: `Pour an acid capsule like an oil spill — it lands on the ground exactly like oil, no delay. Units standing in it sizzle for ${ACID_DPS_PERCENT}% of their max HP every second and turn corroded — taking extra damage from everything. Gone after ${ACID_SPILL_DURATION_ROUNDS} round.`,
    },
    [DRAGON_ID]: {
        id: DRAGON_ID,
        name: 'Dragon Attack',
        icon: '🐉',
        kind: 'placement',
        targeting: 'two-point',
        cooldownRounds: 3,
        radius: 5 * CELL,
        maxSpan: 24 * CELL,
        spell: {
            delaySeconds: 5,
            igniteCapsule: { burnSeconds: 4, intensity: 14 },
        },
        description:
            'Draw the dragon’s strafing path (wider and longer than oil). Seconds into the battle it sweeps over and sets the whole corridor ablaze.',
    },
    [POISON_CLOUD_ID]: {
        id: POISON_CLOUD_ID,
        name: 'Poison Cloud',
        icon: '☠',
        kind: 'placement',
        targeting: 'point',
        cooldownRounds: 2,
        radius: 5 * CELL,
        spell: {
            delaySeconds: 2,
            zone: { mode: 'poison', duration: 12, interval: 0.5, damage: 12 },
        },
        description:
            'Mark a circle anywhere. A toxic cloud settles there and gnaws at every unit inside — gas seeps under ward domes; only poison-proof creatures ignore it.',
    },
};

/**
 * True for any tactic whose placement/aim/cooldown flows through the generic
 * `placeSpell`/`SpellStamp` system — scheduled battle spells (`spell`) AND
 * instant ground-hazard commits (`acidCapsule`) alike. Oil and rally have
 * their own dedicated actions and are NOT included.
 */
export function usesSpellPlacement(tactic: (typeof TACTICS)[string]): boolean {
    return !!(tactic.spell || tactic.acidCapsule);
}

/** how close a mech must get to its personal destination */
export const RALLY_ROUTE_REACH = CELL * 0.5;
/** if a mech cannot get closer for this long, treat the route as complete */
export const RALLY_ROUTE_STUCK_SEC = 3;

export interface RallyRoute {
    id: number;
    team: import('./units').Team;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
}

/** one placed battle spell: intent during deploy, fires in battle.
 *  Two-point spells (acid) carry an end — the effect covers the capsule. */
export interface SpellStamp {
    id: number;
    tacticId: string;
    team: import('./units').Team;
    x: number;
    z: number;
    endX?: number;
    endZ?: number;
    placedRound: number;
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
    for (const u of units) {
        if (u.team === team || !u.type.structure || u.type.extra || u.destroyed) continue;
        const fp = u.type.footprint;
        const buildingRadius = (Math.max(fp.cols, fp.rows) / 2) * CELL;
        const keepOut = buildingRadius + TACTIC_SAFE_ZONE_MARGIN + margin;
        if (det2d(x - u.world.x, z - u.world.z) < keepOut) return true;
    }
    return false;
}

/** one oil stamp action record (capsule: two circles + strip between) */
export interface OilStamp {
    id: number;
    team: import('./units').Team;
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
