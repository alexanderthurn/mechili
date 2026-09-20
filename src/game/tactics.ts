import { CELL } from './map';
import { OIL_SPEED_MULT } from './fire';
import { BASE_TYPES } from './units';
import { t, unitName } from '../i18n';

/** the spells the game names itself (own actions, stored in logs) — see content/coreIds.ts */
export { MOVE_UNIT_ID, OIL_SPILL_ID, RALLY_ROUTE_ID, SELL_UNIT_ID, TUTOR_ID } from './content/coreIds';
/** battle spells: point-targeted stamps that fire seconds into the battle */
export const SPAWN_DWARVES_ID = 'spawnDwarves';
export const BIG_METEOR_ID = 'bigMeteor';
export const SPAWN_CROWS_ID = 'spawnCrows';
export const HAMMER_ID = 'hammerOfGods';
export const STORM_ID = 'storm';
export const METEOR_SHOWER_ID = 'meteorShower';
/** shared by sim (impact timing) and meteorFx (visual fall) — keep in sync */
export const METEOR_SHARD_FALL_SEC = 0.55;
/** Great Meteor visual fall before the sim strike — keep in sync with meteorFx. */
export const METEOR_GREAT_FALL_SEC = 1.1;
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
 *  1. Add `assets/data/spells/<id>.jsonc` (a TacticDef) and list it in
 *     pack.jsonc "spells"; code that needs to name it gets an id constant here. `kind`, `targeting`
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
 *    reset. Available = charges − standing placements; for Oil, stamps wipe
 *    each round while cooldown still comes from the action log
 *    (`usedTactic`). Spell stamps keep history for their cooldown window.
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
/** Colours are `#rrggbb`; anything left out uses the team colour. */
export interface TacticMarker {
    /** glow behind the spell's icon decal (css colour, e.g. `rgba(48, 36, 12, 0.55)`) — no glow, no decal */
    glow?: string;
    /** two-point capsules: fill and outline */
    capsule?: { fill: string; line: string };
    /** circle stamps and charges */
    circle?: string;
    /** pulsing ring while its zone runs in battle (fill 0 = outline only) */
    zoneRing?: { color: string; fill: number; line: number };
}

/** `#rrggbb` → 0xrrggbb */
export function markerColor(hex: string): number {
    return Number.parseInt(hex.replace('#', ''), 16);
}

export interface TacticDef {
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
        /**
         * Which effect the battle plays for it (code-side presets): 'hammer'
         * drops the divine hammer and crushes what it hits, 'meteor' drops a
         * great burning meteor, 'dragon' flies the dragon along a two-point
         * path. Omit for the plain blast / pour.
         */
        fx?: 'hammer' | 'meteor' | 'dragon';
        /** one strike: damage to everything in the circle not under a ward */
        strike?: {
            damage: number;
            radius: number;
            /**
             * Rectangular footprint instead of the circle, oriented by the
             * placement's yaw (hammer): hit zone, ground scar and marker. A
             * unit is hit when its center lies inside — no radius padding.
             */
            rect?: { halfWidth: number; halfDepth: number };
        };
        /** battle-only summons scattered in the circle */
        spawn?: { typeId: string; count: number };
        /**
         * Ticking area effect running `duration` seconds after the delay,
         * point-targeted only: 'storm' flashes several bolts at random spots
         * per tick (wards absorb; splash hexes); 'meteorShower' drops a small
         * strike on a random spot per tick (+ ignites fire); 'acidRain' rains
         * small acid drips that stamp sparse ground acid (same rules as Acid Spill).
         */
        zone?: {
            mode: 'storm' | 'meteorShower' | 'acidRain';
            duration: number;
            interval: number;
            /** flat damage per tick (storm / meteor); unused for acidRain */
            damage: number;
            /** meteorShower / acidRain / storm: splash or puddle radius per impact */
            impactRadius?: number;
            /** meteorShower: ground-fire radius per impact */
            igniteRadius?: number;
            /** acidRain / storm: how many drips / bolts spawn each tick */
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
    /** How its ground markers look (deploy stamp, battle charge, running zone). */
    marker?: TacticMarker;
    /** oil spill only */
    oilRadius?: number;
    oilDurationRounds?: number;
}

/**
 * True for any tactic whose placement/aim/cooldown flows through the generic
 * `placeSpell`/`SpellStamp` system — scheduled battle spells (`spell`) AND
 * ground-hazard pours (`acidCapsule` / `fireCapsule`) alike. Oil and rally have
 * their own dedicated actions and are NOT included.
 */
export function usesSpellPlacement(tactic: TacticDef): boolean {
    return !!(tactic.spell || tactic.acidCapsule || tactic.fireCapsule);
}

/** world radius → board cells (CELL-sized tiles) for readable UI */
function cellsLabel(world: number): string {
    const n = Math.round((world / CELL) * 10) / 10;
    return t('hud:cell', { count: n, defaultValue: `${n} cell${n === 1 ? '' : 's'}` });
}

function roundsLabel(n: number): string {
    return t('hud:round', { count: n, defaultValue: `${n} round${n === 1 ? '' : 's'}` });
}

/**
 * Numeric / rule stats derived from the tactic payload (single source of truth).
 * Flavor `description` should stay number-free; UIs render these lines instead.
 */
export function formatTacticStats(tactic: TacticDef): string[] {
    const lines: string[] = [];

    // +1, and never hidden: `cooldownRounds` counts rounds to WAIT, so 0 means
    // "back next round" rather than "no cooldown" (see the type's own note, and
    // the in-game badge, which reads cooldownRounds + 1 for exactly this reason).
    // Printing the raw field left every 0 blank and made a once-per-round spell
    // look like it had no limit at all.
    lines.push(
        t('hud:tacticCooldown', {
            n: roundsLabel(tactic.cooldownRounds + 1),
            defaultValue: `Cooldown ${roundsLabel(tactic.cooldownRounds + 1)}`,
        }),
    );

    if (tactic.radius != null && (tactic.spell || tactic.acidCapsule || tactic.fireCapsule || tactic.oilRadius)) {
        lines.push(
            t('hud:tacticAim', {
                n: cellsLabel(tactic.radius),
                defaultValue: `Aim ${cellsLabel(tactic.radius)}`,
            }),
        );
    }
    if (tactic.maxSpan != null) {
        lines.push(
            t('hud:tacticMaxPath', {
                n: cellsLabel(tactic.maxSpan),
                defaultValue: `Max path ${cellsLabel(tactic.maxSpan)}`,
            }),
        );
    }

    const spell = tactic.spell;
    if (spell) {
        lines.push(
            t('hud:tacticDelay', {
                n: spell.delaySeconds,
                defaultValue: `Delay ${spell.delaySeconds}s`,
            }),
        );
        if (spell.strike) {
            lines.push(
                t('hud:tacticDamage', {
                    n: spell.strike.damage,
                    defaultValue: `Damage ${spell.strike.damage}`,
                }),
            );
            lines.push(
                t('hud:tacticBlast', {
                    n: cellsLabel(spell.strike.radius),
                    defaultValue: `Blast ${cellsLabel(spell.strike.radius)}`,
                }),
            );
        }
        if (spell.spawn) {
            const unit = BASE_TYPES.byId(spell.spawn.typeId);
            const label = unitName(spell.spawn.typeId, unit?.name ?? spell.spawn.typeId);
            lines.push(
                t('hud:tacticSummon', {
                    count: spell.spawn.count,
                    unit: label,
                    defaultValue: `Summon ${spell.spawn.count}× ${label}`,
                }),
            );
        }
        if (spell.zone) {
            const z = spell.zone;
            if (z.mode === 'storm') {
                const n = z.dropsPerTick ?? 1;
                lines.push(
                    t('hud:tacticLightning', {
                        n: z.interval,
                        defaultValue: `Lightning every ${z.interval}s (hex only)`,
                    }),
                );
                if (n > 1) {
                    lines.push(
                        t('hud:tacticStormBolts', {
                            count: n,
                            defaultValue: `${n} bolts per flash`,
                        }),
                    );
                }
                if (z.impactRadius != null) {
                    lines.push(
                        t('hud:tacticSplash', {
                            n: cellsLabel(z.impactRadius),
                            defaultValue: `Splash ${cellsLabel(z.impactRadius)}`,
                        }),
                    );
                }
            } else if (z.mode === 'acidRain') {
                const n = z.dropsPerTick ?? 1;
                lines.push(
                    t('hud:tacticAcidRain', {
                        count: n,
                        n: z.interval,
                        defaultValue: `Acid rain ×${n} every ${z.interval}s`,
                    }),
                );
                if (z.impactRadius != null) {
                    lines.push(
                        t('hud:tacticDrop', {
                            n: cellsLabel(z.impactRadius),
                            defaultValue: `Drop ${cellsLabel(z.impactRadius)}`,
                        }),
                    );
                }
            } else if (z.mode === 'meteorShower') {
                lines.push(
                    t('hud:tacticMeteor', {
                        dmg: z.damage,
                        n: z.interval,
                        defaultValue: `Meteor ${z.damage} every ${z.interval}s`,
                    }),
                );
                if (z.impactRadius != null) {
                    lines.push(
                        t('hud:tacticImpact', {
                            n: cellsLabel(z.impactRadius),
                            defaultValue: `Impact ${cellsLabel(z.impactRadius)}`,
                        }),
                    );
                }
                if (z.igniteRadius != null) {
                    lines.push(
                        t('hud:tacticIgnite', {
                            n: cellsLabel(z.igniteRadius),
                            defaultValue: `Ignite ${cellsLabel(z.igniteRadius)}`,
                        }),
                    );
                }
            }
            lines.push(
                t('hud:tacticDuration', {
                    n: z.duration,
                    defaultValue: `Duration ${z.duration}s`,
                }),
            );
        }
        if (spell.igniteCapsule) {
            const c = spell.igniteCapsule;
            if (c.damage != null && c.damage > 0) {
                lines.push(
                    t('hud:tacticBreath', {
                        n: c.damage,
                        defaultValue: `Breath damage ${c.damage}`,
                    }),
                );
            }
            lines.push(
                t('hud:tacticGroundFire', {
                    n: c.intensity,
                    defaultValue: `Ground fire DPS ${c.intensity}`,
                }),
            );
            lines.push(
                t('hud:tacticGroundBurn', {
                    n: c.burnSeconds,
                    defaultValue: `Ground burn ${c.burnSeconds}s`,
                }),
            );
        }
    }

    if (tactic.fireCapsule) {
        lines.push(
            t('hud:tacticFireDps', {
                n: tactic.fireCapsule.intensity,
                defaultValue: `Fire DPS ${tactic.fireCapsule.intensity}`,
            }),
        );
        lines.push(
            t('hud:tacticBurn', {
                n: tactic.fireCapsule.burnSeconds,
                defaultValue: `Burn ${tactic.fireCapsule.burnSeconds}s`,
            }),
        );
    }

    if (tactic.acidCapsule) {
        lines.push(
            t('hud:tacticAcid', {
                n: tactic.acidCapsule.dpsPercent,
                defaultValue: `Acid ${tactic.acidCapsule.dpsPercent}% max HP / s`,
            }),
        );
        lines.push(
            t('hud:tacticLasts', {
                n: roundsLabel(tactic.acidCapsule.durationRounds),
                defaultValue: `Lasts ${roundsLabel(tactic.acidCapsule.durationRounds)}`,
            }),
        );
        lines.push(t('hud:tacticCorroded', { defaultValue: 'Applies corroded' }));
    }

    if (tactic.oilDurationRounds != null) {
        lines.push(
            t('hud:tacticOil', {
                mult: OIL_SPEED_MULT,
                defaultValue: `Oil ${OIL_SPEED_MULT}× move speed`,
            }),
        );
        lines.push(
            t('hud:tacticLasts', {
                n: roundsLabel(tactic.oilDurationRounds),
                defaultValue: `Lasts ${roundsLabel(tactic.oilDurationRounds)}`,
            }),
        );
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

