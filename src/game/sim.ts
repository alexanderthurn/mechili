import type { Group } from 'three';
import {
    ACID_DPS_PERCENT,
    applyBurnStatus,
    FIRE_TINT_NORMAL,
    FIRE_TINT_NOSCAR,
    HAZARD_DRIP_FALL_SEC,
    HazardField,
    OIL_DIRECTED_BACK,
    OIL_DIRECTED_CROSS,
    OIL_DIRECTED_FWD,
    OIL_DIRECTED_LENGTH_MUL,
    OIL_DIRECTED_TAIL_FRAC,
    OIL_SPEED_MULT,
    insideAnyShield,
    livingShieldDisks,
    resolveFireProfile,
    type FireProfile,
    type HazardPour,
} from './fire';
import type { SeatId } from './seats';
import { detAtan2, detCos, detPow2, detSin, hypot, wrapPi } from './detMath';
import { mulberry32, simGroundHeightAt, simGroundSupportAt, worldHeightAt } from './map';
import { GROUND_UNIT_Y } from './groundQuality';
import {
    effectiveWeaponReach,
    RANGE_ELEV_MAX_BONUS,
    resolveSlopeMove,
    SLOPE_STRUGGLE,
    type ElevationMode,
} from './terrainCombat';
import type { TerrainGrid } from './terrainGrid';
import { DEFAULT_SETTINGS, type LevelingSettings, type TowerSettings } from './settings';
import {
    METEOR_SHARD_FALL_SEC,
    RALLY_ROUTE_RADIUS,
    RALLY_ROUTE_REACH,
    RALLY_ROUTE_STUCK_SEC,
    type RallyRoute,
} from './tactics';
import {
    effectiveFlying,
    effectiveTargets,
    levelScaleMultFromTechs,
    TechTree,
    type ResolvedStats,
} from './tech';
import { ownedCleaveTechs, ownedOnKillTechs, ownedProduceTechs, techsForUnit, type Loadout } from './techCatalog';
import {
    DEPLOY_AIR_Y,
    STRONGHOLD_ARCHER_FOV_HALF,
    bloodColorOf,
    resolveDeathWear,
    projectileAimY,
    clearBattleTint,
    syncBattleTint,
    techForUnit,
    type BattleTeam,
    type DeathWear,
    type Team,
    type TechDef,
    type Unit,
    type UnitType,
    levelBasisOf,
} from './units';
import { getUnitInstanceRenderer } from './unitInstances';
import type { TypeRegistry } from './content/typeRegistry';
import { computeCrowWingRate, crowWingDeathSplay, setCrowWingDeathSplay, setCrowWingRateOnProxy, setCrowWingRestOnProxy } from './crowWingFlap';
import { hasUnitDeathAnim, playUnitDeathAnim, playUnitFireAnim, unitDeathFallLocal } from './unitAnimated';
import { attackNodeWorld, getUnitAttackNodeLocal, getUnitVisualHalfWidth, getUnitVisualHeight, usesWingFlapModel } from './unitModels';
import {
    beginDeathClip,
    beginDeathFall,
    beginDeathTip,
    clearDeathClip,
    clearDeathFall,
    clearDeathTip,
    clearCorpsePose,
    crashDriftFromKnock,
    crashLandFromFall,
    deathTipAmount,
    deathTipFromKnock,
    deathYawFromKnock,
    settleCorpsePose,
    alignSettledCorpse,
    snapFlyerForDeathFall,
    tickDeathClip,
    tickDeathFall,
    tickDeathTip,
    type CrashLand,
    type DeathClipState,
    type DeathFallState,
    type DeathTipState,
} from './deathFall';
import {
    beginHammerCrush,
    clearBuildingCollapse,
    groundTipAt,
    hammerCrushSpin,
    HAMMER_CRUSH_SEAT_Y,
    tickBuildingCollapse,
    type BuildingCollapseState,
} from './buildingCollapse';
import type { CpuTimings } from '../ui/debug';

/** golden units take 30% less damage on top of debuff immunity */
export const GOLDEN_DAMAGE_TAKEN_MULT = 0.7;
/** battle clock time when golden auras ({@link UnitType.aura}) are applied once (after other pre-battle effects) */
export const GOLDEN_AURA_APPLY_AT = 0.1;
/** storm bolt: personal tower-like debuff duration (refreshed on each hit) */
export const STORM_DEBUFF_SEC = 5;
/** units stand still for this long at battle start before moving or firing */
export const BATTLE_START_FREEZE = 1.0;

export interface SimConfig {
    /**
     * The board relief grid battle effects deform (a Hammer of the Gods
     * flattens it). The sim changes it inside the step an effect lands in, so
     * every client derives the same ground; the change carries into later
     * battles (healing per TERRAIN_HEAL_PER_ROUND). Omit to leave the ground as it is.
     */
    terrain?: TerrainGrid;
    towers: TowerSettings;
    leveling: LevelingSettings;
    /** the battle's fixed length — the sim refuses to step past it */
    battleSeconds: number;
    /**
     * canonical battle-order rank for a unit's seat (lower sorts first).
     * With per-seat ids (SeatId embedded via id = counter*rosterLength+seat)
     * ordering no longer needs parity math — it's a direct seat lookup, one
     * that stays correct regardless of how many seats a side has.
     */
    seatRank: (seat: SeatId) => number;
    /** effective supply cost of a unit type (drives kill XP values) */
    costOf: (type: UnitType) => number;
    /** a pack's tech-resolved base stats (level scaling happens in the sim) */
    statsOf: (unit: Unit) => ResolvedStats;
    /** per-SEAT now (never shared) — pass the unit's own seat, not its team */
    hasTech: (seat: SeatId, typeId: string, techId: string) => boolean;
    /** the match's unit types and talents */
    types: TypeRegistry;
    /** a seat's talent picks — only fire profiles need the SELECTION itself
     *  (everything else filters through hasTech, which already reflects it) */
    loadoutOf: (seat: SeatId) => Loadout | undefined;
    /** `lifeline` mode: a side's packs drop the moment its Stronghold does */
    strongholdLifeline: boolean;
    /** base flank spawn duration in seconds (before per-seat multiplier) */
    flankSpawnSeconds: number;
    /** per-SEAT now (never shared) — pass the unit's own seat, not its team */
    flankSpawnMult: (seat: SeatId) => number;
    needsFlankSpawn: (unit: Unit) => boolean;
    /** rally routes placed this deployment (player tactics only for now) */
    rallyRoutes?: readonly RallyRoute[];
    /**
     * Match oil layer snapshot at battle start. The sim clones it; fire is
     * battle-local. Remaining oil is read back via {@link BattleSim.hazards}.
     */
    oilField?: HazardField;
    /** round index used when weapons stamp oil mid-battle (expiry inclusive) */
    oilExpiresRound?: number;
    /**
     * Committed spell strikes (both teams): each hits once at
     * BATTLE_START_FREEZE + delaySeconds. Ward domes protect what's under
     * them and absorb the hit (once per dome); everything else in the circle
     * takes environmental damage.
     */
    spellStrikes?: readonly SpellStrike[];
    /** ticking spell zones (storm bolts, meteor shower, acid rain) */
    spellZones?: readonly SpellZone[];
    /** one-shot capsule ignitions (dragon breath along its flight path) */
    spellIgnites?: readonly SpellIgnite[];
    /** oil/acid capsules that pour left→right as drips after the freeze */
    hazardPours?: readonly HazardPour[];
    /** summoned packs materialize this many seconds after the freeze (0 = normal) */
    summonDelayOf?: (unit: Unit) => number;
    /**
     * Half-extents of the playable board (world units) — used only to detect
     * when a `marchIn` horde actor (spawned outside the board, walking
     * straight toward center) crosses into the AABB and should switch to
     * normal combat AI. Actors that never have `marchIn` set don't need this
     * at all; harmless to omit for matches without horde mode.
     */
    boardHalfW?: number;
    boardHalfZ?: number;
    /**
     * Create a summoned pack mid-battle (on-kill spawn). Must be deterministic
     * across peers — same parent, type, xz → same unit id / mesh. Return null
     * to skip (unknown type).
     */
    spawnOnKill?: (parent: Unit, typeId: string, x: number, z: number) => Unit | null;
}

/** one scheduled area strike (meteor, hammer, …) */
export interface SpellStrike {
    x: number;
    z: number;
    radius: number;
    damage: number;
    delaySeconds: number;
    /** which spell it came from (debug / events) */
    tacticId?: string;
    /** rectangular footprint instead of the circle (see TacticDef strike.rect) */
    rect?: { halfWidth: number; halfDepth: number };
    /** impact preset: the hammer crushes, the great meteor burns and shakes, a shower meteor leaves no scorch */
    fx?: 'hammer' | 'meteor' | 'shower';
    /** footprint orientation (radians) */
    yaw?: number;
}

/** a ticking area effect; `seed` drives its private deterministic rng stream */
export interface SpellZone {
    /** which TACTICS entry this came from — drives the ground marker's look */
    tacticId: string;
    x: number;
    z: number;
    radius: number;
    delaySeconds: number;
    duration: number;
    interval: number;
    /** flat damage per tick (storm / meteor); unused for acidRain */
    damage: number;
    mode: 'storm' | 'meteorShower' | 'acidRain';
    impactRadius?: number;
    igniteRadius?: number;
    /** acidRain: drips spawned each tick */
    dropsPerTick?: number;
    /** acidRain: inclusive round expiry for stamped puddles */
    acidExpiresRound?: number;
    seed: number;
}

/** the whole capsule catches fire once at BATTLE_START_FREEZE + delaySeconds */
export interface SpellIgnite {
    x: number;
    z: number;
    x2: number;
    z2: number;
    radius: number;
    delaySeconds: number;
    burnSeconds: number;
    intensity: number;
}

/** corroded (acid) victims take this much extra damage from everything */
export const CORRODE_TAKEN_MULT = 1.25;
/** how long the corroded debuff lingers after the last acid tick */
const CORRODE_LINGER_SECONDS = 2;
/** summoned mechs materialize one by one, this far apart */
const SUMMON_STAGGER_SECONDS = 0.12;
/** render-only entrance: ground summons rise, flyers dive, over this long */
const SUMMON_RISE_SECONDS = 0.6;
const SUMMON_DIVE_SECONDS = 0.9;
/** flying cleave slam: fast drop, plant on the lawn, then rise (fits 0.85s interval) */
const FLYER_STOMP_DOWN = 0.16;
const FLYER_STOMP_HOLD = 0.1;
const FLYER_STOMP_UP = 0.4;
const FLYER_STOMP_TOTAL = FLYER_STOMP_DOWN + FLYER_STOMP_HOLD + FLYER_STOMP_UP;

function flyerStomp(age: number): { drop: number; squash: number } {
    if (age < 0 || age >= FLYER_STOMP_TOTAL) return { drop: 0, squash: 0 };
    if (age < FLYER_STOMP_DOWN) {
        const t = age / FLYER_STOMP_DOWN;
        const drop = 1 - (1 - t) * (1 - t);
        return { drop, squash: t * t };
    }
    if (age < FLYER_STOMP_DOWN + FLYER_STOMP_HOLD) {
        return { drop: 1, squash: 1 };
    }
    const t = (age - FLYER_STOMP_DOWN - FLYER_STOMP_HOLD) / FLYER_STOMP_UP;
    return { drop: 1 - t * t, squash: Math.max(0, 1 - t * 3) };
}

const TAU = Math.PI * 2;
/** Within this of the seek yaw, `pivot` units may start walking. */
const TURN_ALIGN_RAD = 0.4;
/** Fallback when a mobile type forgot {@link UnitType.turnRate}. */
const DEFAULT_TURN_RATE = 8;

/** Shortest signed delta from `from` → `to` in (−π, π]. */
function deltaAngle(from: number, to: number): number {
    let d = ((to - from) % TAU + TAU) % TAU;
    if (d > Math.PI) d -= TAU;
    return d;
}

/** Ease `a.facing` toward `desiredYaw` by this type's turn rate (mesh synced in syncMeshes). */
function faceToward(a: Actor, desiredYaw: number, dt: number): void {
    if (a.unit.type.structure) return;
    const rate = a.unit.type.turnRate ?? DEFAULT_TURN_RATE;
    const d = deltaAngle(a.facing, desiredYaw);
    const maxStep = rate * dt;
    if (Math.abs(d) <= maxStep) a.facing = desiredYaw;
    else a.facing += Math.sign(d) * maxStep;
    // Keep facing in (−π, π] so long battles don't drift the euler.
    if (a.facing > Math.PI || a.facing <= -Math.PI) {
        a.facing = ((a.facing + Math.PI) % TAU + TAU) % TAU - Math.PI;
    }
    // Sim-step consumers (muzzle, convert ray) read mesh yaw before syncMeshes lerps.
    a.mesh.rotation.y = a.facing;
}

function facingAligned(a: Actor, desiredYaw: number, tol = TURN_ALIGN_RAD): boolean {
    return Math.abs(deltaAngle(a.facing, desiredYaw)) <= tol;
}

function lerpAngle(from: number, to: number, t: number): number {
    return from + deltaAngle(from, to) * t;
}

export interface Actor {
    unit: Unit;
    mesh: Group;
    x: number;
    z: number;
    /** position one sim step ago — the render interpolation baseline */
    prevX: number;
    prevZ: number;
    /** interpolated render position (updated in syncMeshes) — use for anything on screen */
    rx: number;
    rz: number;
    hp: number;
    /** leveled max hp (grows on mid-battle level-ups) */
    maxHp: number;
    /**
     * Absorb pool that soaks ranged damage before {@link hp} (Aegis tech /
     * Bulwark rune). 0 = no shield, or spent. A hit that would overkill the
     * shield is fully absorbed — HP is only touched by the NEXT hit.
     */
    shieldHp: number;
    /** full shield pool (equals {@link maxHp} when shielded, else 0) */
    shieldMaxHp: number;
    cooldown: number;
    alive: boolean;
    /** ground collision circle */
    radius: number;
    /** stable index for deterministic tie-breaks */
    index: number;
    /** seconds the unit still counts as "under attack" (shows its HP bar) */
    hurtTimer: number;
    /** flight altitude (0 for ground units) — air collides with nothing on the ground */
    altitude: number;
    /** altitude one sim step ago — Fire Bolt / flyer render lerp */
    prevAltitude: number;
    /**
     * world Y of the actor's feet this step: terrain support for ground units,
     * absolute air altitude for flyers. Projectiles aim at / hit relative to this.
     */
    footY: number;
    /** rocket extras: the enemy being homed onto once launched */
    rocketTarget: Actor | null;
    /** sim time until which this mech ignores tower-destruction debuffs (ballista aura) */
    goldenUntil: number;
    /**
     * Storm-bolt tower-like debuff on this actor (same multipliers as seat tower
     * loss). Golden aura / debuff-immune items ignore it via {@link isGolden}.
     */
    stormDebuffUntil: number;
    /** battle time when flank spawn finishes (0 = already spawned) */
    spawnUntil: number;
    /** took damage during flank spawn — hp no longer auto-ramps */
    spawnDamaged: boolean;
    /** personal rally-route destination (null = default seek-enemy AI) */
    pathDestX: number | null;
    pathDestZ: number | null;
    /** next rally waypoint after {@link pathDestX}/{@link pathDestZ} (end after mid) */
    pathNextX: number | null;
    pathNextZ: number | null;
    /** which {@link RallyRoute.id} this path order came from (null when not on a route) */
    pathRouteId: number | null;
    /** seconds without getting closer to the rally destination */
    pathStuck: number;
    /** closest approach to pathDest so far */
    pathBestDist: number;
    /** last sim-step displacement — used to lead ballistic shots */
    mvX: number;
    mvZ: number;
    /**
     * Sim-owned yaw (rest forward −Z). Eased toward the seek/aim direction at
     * {@link UnitType.turnRate}; mesh.rotation.y mirrors this each step.
     */
    facing: number;
    /** Facing one sim step ago — render-lerped with {@link facing} like xz. */
    prevFacing: number;
    /** sticky attack target — held while in range; closest search when not */
    cachedEnemy: Actor | null;
    /** approach lane: world offset from {@link cachedEnemy} center after a same-target crowd push */
    approachOx: number;
    approachOz: number;
    /** sim time until the approach lane expires (0 = none) */
    approachOffsetUntil: number;
    /** sim time the terrain last bent this unit's walk or blocked its shot */
    terrainHinderedAt: number;
    /** flips which way a steep face is skirted (toggled when stuck) */
    slideFlip: boolean;
    /** progress tracking for {@link BattleSim.trackProgress} */
    progressTarget: Actor | null;
    progressBest: number;
    progressAt: number;
    /** a target this unit got stuck on — passed over until shunUntil */
    shunTarget: Actor | null;
    shunUntil: number;
    /** burn DoT: sim time when it expires (0 = not burning) */
    burnUntil: number;
    /** burn damage per second while burnUntil > elapsed */
    burnDps: number;
    /**
     * Hex / EMP: researched talents stop applying until this sim time.
     * Innate talents and item runes still work. 0 = not hexed.
     */
    empUntil: number;
    /** move-speed multiplier while {@link empUntil} is active (typically 0.6) */
    empSpeedMult: number;
    /** acid debuff: takes CORRODE_TAKEN_MULT damage while this > elapsed */
    corrodedUntil: number;
    /** summons: sim time this mech materializes (0 = was there from the start) */
    appearAt: number;
    /** false while a summon is still dormant (not alive, hidden, untargetable) */
    appeared: boolean;
    /**
     * Battle-only allegiance override (wizard convert). Null = use {@link Unit.team}.
     * Cleared when the BattleSim is discarded — deploy ownership stays unchanged.
     */
    allegiance: BattleTeam | null;
    /** seat that owns this mech while {@link allegiance} is set */
    allegianceSeat: number;
    /** sticky convert-ray victim (wizard second weapon) — primary / FX compat */
    convertTarget: Actor | null;
    /** multi-bind convert channels (Mass Binding); {@link convertTarget} mirrors [0] */
    convertTargets: Actor[];
    /** accumulated convert progress (0..hp); flips when ≥ current hp */
    convertProgress: number;
    /** who is currently channeling a convert ray onto this mech (for the UI bar) */
    convertBy: Actor | null;
    /** seconds left before this caster may start another convert channel */
    convertCooldown: number;
    /**
     * Render tip of an active convert beam (world). When a ward blocks the
     * line of sight this sits on the dome skin; otherwise on the victim.
     * Valid only while {@link convertRayActive}.
     */
    convertRayTipX: number;
    convertRayTipY: number;
    convertRayTipZ: number;
    /** true this sim step while the convert beam is on (incl. shield-blocked) */
    convertRayActive: boolean;
    /**
     * Sticky ramp-beam locks (Mass Binding → multiple). Parallel
     * {@link rampBeamLockTs}; {@link rampBeamTarget} mirrors [0].
     */
    rampBeamTargets: Actor[];
    /** Seconds of unbroken lock per {@link rampBeamTargets} entry. */
    rampBeamLockTs: number[];
    /** Primary sticky ramp-beam victim (null = hunting); mirrors targets[0]. */
    rampBeamTarget: Actor | null;
    /**
     * Attack windup: damage (melee) or volley (ranged) waiting to resolve
     * ({@link UnitType.meleeHitDelay}). 0 = none pending. Anim starts on
     * cooldown bump; the hit / shot resolves later.
     */
    meleePendingDamage: number;
    /** sim {@link elapsed} when {@link meleePendingDamage} should apply */
    meleePendingAt: number;
    /** {@link Actor.index} of the swing's / shot's focus target */
    meleePendingFocus: number;
    /**
     * Center distance to hold while peeling after a ground melee hit
     * ({@link UnitType.meleeRetreat}). 0 = not retreating.
     */
    meleeRetreatGoal: number;
    /**
     * Free-flight pierce loop: 0 chase → 1 pass (locked heading) → 2 coast
     * behind → 3 reorient (det-random yaw) → chase.
     */
    flyPassPhase: number;
    /** sim time when coast ends / turn may finish (phase-dependent) */
    flyPassUntil: number;
    /** locked pass heading (xz unit) while piercing */
    flyPassHx: number;
    flyPassHz: number;
    /** already dealt touch damage on this pass */
    flyPassStruck: boolean;
    /** desired yaw while reorienting */
    flyPassTurnYaw: number;
    /**
     * Free-flight nose pitch (rad, + = climb). Eased toward chase aim; mesh
     * mirrors this. Layer flyers leave at 0.
     */
    flightPitch: number;
    /** {@link flightPitch} one sim step ago — render-lerped */
    prevFlightPitch: number;
    /** render-only: fire recoil 0..1, decays each frame (never read by the sim step) */
    recoil?: number;
    /** render-only: blast shove xz (stones / meteor / hammer), decays each frame */
    impulseX?: number;
    impulseZ?: number;
    /**
     * Render-only: accumulated procedural gait phase (rad). Advanced every
     * render frame from wall time × speed ratio × walkCadence (smooth at display Hz).
     */
    gaitPhase?: number;
    /** render-only: last animateActor timeSeconds used to integrate gaitPhase */
    gaitTime?: number;
    /** render-only: last frame's cooldown, to detect a fresh shot */
    prevCooldown?: number;
    /** render-only: sim elapsed when a flying cleave slam started */
    stompAt?: number;
    /** render-only: ram an air target instead of planting on the lawn */
    stompAir?: boolean;
    /** render-only: flyer he is ramming (mesh follows while alive) */
    stompVictim?: Actor;
    /** render-only: world crash point for an air ram */
    stompTx?: number;
    stompTy?: number;
    stompTz?: number;
}

/** Combat team for targeting / scoring — honors mid-battle converts. */
export function actorTeam(a: Actor): BattleTeam {
    return a.allegiance ?? a.unit.team;
}

/** Combat seat while converted, else deploy seat. */
export function actorSeat(a: Actor): number {
    return a.allegiance !== null ? a.allegianceSeat : a.unit.seat;
}

/**
 * Does this pack get a {@link Actor.shieldHp} pool? Granted by the Bulwark
 * rune or the Aegis tech (which `hasTech` resolves including innate techs).
 *
 * Never to a summoned pack. Summons carry the caster's seat and a real type
 * id, so the Aegis the seat researched for that type used to apply to them —
 * Summon Crow Riders handed two free, battle-only, level-1 flocks a shield
 * worth their whole HP bar. The Bulwark rune already never reached them (no
 * spawn path copies `items`), so this only brings the tech into line.
 */
export function hasShieldHp(
    unit: Unit,
    hasTech: (seat: SeatId, typeId: string, techId: string) => boolean,
    types: TypeRegistry,
): boolean {
    if (unit.summoned) return false;
    for (const id of unit.items) {
        if (types.rune(id)?.grantsShieldHp) return true;
    }
    return types.talentsOf(unit.type).some((t) => t.grantsShieldHp && hasTech(unit.seat, unit.type.id, t.id));
}

/**
 * How a hit interacts with {@link Actor.shieldHp}:
 * - `shielded`: soaked by the shield first (projectiles, splash)
 * - `direct`: ignores the shield entirely (melee contact, convert ray, and any
 *   attack from a {@link UnitType.piercesShield} type). DoT never routes
 *   through applyDamage at all, so burn / acid / poison are direct by nature.
 */
export type DamageChannel = 'shielded' | 'direct';

/** how long a hit keeps the HP bar visible */
export const HURT_BAR_SECONDS = 1.5;

/** a bullet in flight — hits the first enemy hit-volume it crosses */
export interface Projectile {
    x: number;
    y: number;
    z: number;
    /** position one sim step ago, for render interpolation */
    px: number;
    py: number;
    pz: number;
    vx: number;
    vy: number;
    vz: number;
    damage: number;
    team: BattleTeam;
    /** the pack that fired it (kill XP goes there) */
    source: Unit;
    /** render style copied from the shooter — visual only */
    style: 'bolt' | 'arrow' | 'largeArrow' | 'stone' | 'orb';
    /** tip flame while flying (fire arrows / lit ballista); clears on hit or TTL */
    lit?: boolean;
    /** mesh scale vs style default; number = uniform, or length/thickness for shafts */
    scale?: number | { length?: number; thickness?: number };
    /**
     * Grow mesh from {@link scale} → this over the xz path from muzzle to aim
     * (render-only). Requires {@link ox}/{@link oz}/{@link tx}/{@link tz}.
     */
    scaleEnd?: number;
    /** muzzle xz when {@link scaleEnd} is set */
    ox?: number;
    oz?: number;
    /** aim xz when {@link scaleEnd} is set */
    tx?: number;
    tz?: number;
    /** Soft trail ribbon (render-only) — see {@link UnitType.projectileTrail}. */
    trail?: 'cloud';
    /** gravity (world units/s²) for lobbed shots — absent = straight flight */
    gravity?: number;
    /** homing shots chase this actor and hit nothing else */
    target?: Actor;
    ttl: number;
    /** a physical stone (bounces, rolls, keeps striking) — see {@link StoneState} */
    stone?: StoneState;
}

/** visual happenings the renderer turns into particles (drained per frame) */
export type SimEvent =
    | {
          kind: 'muzzle';
          x: number;
          y: number;
          z: number;
          /** {@link UnitType.projectileStyle} of the shooter (render SFX). */
          style?: 'bolt' | 'arrow' | 'largeArrow' | 'stone' | 'orb';
          /** Shooter {@link UnitType.id} — filter archer vs goblin (both use arrows). */
          unitTypeId?: string;
      }
    /** `blood` = victim gore tint when hitting flesh (omit = default red).
     *  `flesh` = the hit target bleeds (else gray debris — towers, ground, shields).
     *  `masonry` = structure facade hit — denser stone/dust than ground/shield chips.
     *  `dx/dy/dz` = normalized hit direction (bullet/strike travel) so spray
     *  exits the far side; omit for undirected (shield / dome) impacts.
     *  `sod` = denser dirt kick for ground-stuck bolts / stones. */
    | {
          kind: 'impact';
          x: number;
          y: number;
          z: number;
          blood?: number;
          flesh?: boolean;
          masonry?: boolean;
          /** Structure center xz — chips eject from the hit along (hit − center). */
          cx?: number;
          cz?: number;
          dx?: number;
          dy?: number;
          dz?: number;
          /** Ground bolt / heavy debris — denser dirt spray (arrow, ballista, stones). */
          sod?: boolean;
          /** Crow-rider (etc.) stone projectile — leave a brief grounded rock. */
          dropStone?: boolean;
          /** Uniform scale for {@link dropStone} (matches flying stone). Omit = 1. */
          dropStoneScale?: number;
          /** Victim {@link UnitType.bloodScale} — scales flesh spray (omit = 1). */
          bloodScale?: number;
          /** Ground wear stamp. Omit/true = stamp; false = VFX only. */
          scar?: boolean;
          /** Ward dome absorb — hull ripple (render-only). */
          ward?: boolean;
          /** Melee contact (vs projectile) — drives melee_hit SFX. */
          melee?: boolean;
          /** Flesh victim {@link UnitType.id} — drives unit hurt VO when set. */
          unitTypeId?: string;
      }
    /** Melee swing windup / instant swing start (render SFX). */
    | { kind: 'meleeSwing'; x: number; y: number; z: number; unitTypeId?: string }
    /** Arrow / ballista shaft planted at a hit (render-only stuck-bolt pool).
     *  `attachIndex` = actor whose mesh the shaft follows (tip/fall/walk). */
    | {
          kind: 'stuckBolt';
          x: number;
          y: number;
          z: number;
          dx: number;
          dy: number;
          dz: number;
          style: 'arrow' | 'largeArrow';
          /** mesh scale vs style default; omit = 1 */
          scale?: number | { length?: number; thickness?: number };
          attachIndex?: number;
      }
    | {
          kind: 'explosion';
          x: number;
          y: number;
          z: number;
          radius: number;
          heavy?: boolean;
          /** hot flash + embers on top of the dust (meteor) */
          fire?: boolean;
          /** rocket pad detonation (vs generic splash) */
          rocket?: boolean;
          /** camera kick strength; omitted/0 = no shake (most explosions) */
          shake?: number;
          /**
           * Oriented rectangle ground scar (Hammer of the Gods). When set,
           * wear stamps this footprint instead of a circle of `radius`.
           */
          rect?: { halfWidth: number; halfDepth: number; yaw: number };
          /** Ground wear/scorch stamp. Omit/true = stamp; false = VFX only. */
          scar?: boolean;
      }
    /** Hammer smash: flatten scenery in the footprint (battle-phase only). */
    | {
          kind: 'hammerCrush';
          x: number;
          z: number;
          halfWidth: number;
          halfDepth: number;
          yaw: number;
          /** Deterministic flatten height for the footprint (board relief). */
          flattenY: number;
      }
    | {
          kind: 'death';
          x: number;
          y: number;
          z: number;
          big: boolean;
          wear: DeathWear;
          blood?: number;
          /** structure ruin — masonry shower + collapse shake (vs unit ash/blood) */
          structure?: boolean;
          /** UnitType.id — audio picks a per-building crush sting when set */
          unitTypeId?: string;
          /** visual height / footprint for collapse stone shower */
          structureHeight?: number;
          structureRadius?: number;
          /** normalized killing-blow direction (from knockback), so gore jets along it */
          dx?: number;
          dz?: number;
          /**
           * Throws the gore down `dx`/`dz` instead of letting it fountain: the
           * omni cloud gets the direction too, faster, flatter and longer-lived.
           * Omit / 1 = the ordinary spurt.
           */
          fling?: number;
          /** Ash death scorch override (from UnitType.deathAshScorch). */
          ashScorch?: { radius: number; strength: number };
          /** Hammer pancake — multiply ground + particle gore (e.g. 1.25). */
          bloodScale?: number;
      }
    /**
     * A Stronghold has come down in `lifeline` and its collapse is rolling
     * outward. The renderer expands its dust front at this same `speed`, so
     * what the player watches reach a pack IS what kills it.
     */
    | {
          kind: 'strongholdCollapse';
          team: BattleTeam;
          x: number;
          y: number;
          z: number;
          /** world units per second the front travels */
          speed: number;
          /** where it stops mattering — the far corner of the board */
          maxRadius: number;
      }
    | { kind: 'levelup'; x: number; y: number; z: number }
    /** ground fire stamped / oil ignited — y is sim terrain height */
    | {
          kind: 'groundFire';
          x: number;
          y: number;
          z: number;
          radius: number;
          oilCells: number;
          /** {@link FIRE_TINT_NORMAL} or {@link FIRE_TINT_DRAGON} */
          tint?: number;
          /** Permanent wear scorch seed. Omit/true = stamp on low fire VFX; false = skip. */
          scar?: boolean;
      }
    | { kind: 'summon'; x: number; y: number; z: number; flying: boolean }
    /** meteor-shower shard cue — visual falls until `at`, then sim resolves hit */
    | { kind: 'spellMeteor'; x: number; z: number; at: number }
    /** oil/acid drip cue — blob falls until `at`, then that disc stamps on the ground */
    | {
          kind: 'hazardDrip';
          hazard: 'oil' | 'acid' | 'fire';
          x: number;
          z: number;
          at: number;
          /** visual-only: smaller/straighter drops (acid rain) */
          dripScale?: number;
          dripLean?: number;
      }
    /** storm lightning bolt cue (render-only) — `y` is hit height when known */
    | { kind: 'spellLightning'; x: number; z: number; y?: number }
    /** wizard convert finished — flash + mesh recolor hook */
    | { kind: 'convert'; index: number; x: number; y: number; z: number; team: BattleTeam }
    /** command tower / research center destroyed — seat debuff starts/extends */
    | {
          kind: 'towerDebuff';
          seat: SeatId;
          team: BattleTeam;
          x: number;
          y: number;
          z: number;
          level: number;
      };

const PROJECTILE_RADIUS = 0.25;
const PROJECTILE_TTL = 3;

/**
 * Where a straight shot aims on its target, above the feet (world units): the
 * middle of the model, moved into the nearest hit volume. A small unit's
 * mid-mesh sits above its collider sphere — a bolt aimed there rises over it
 * and never connects (lobbed shots come down through it instead).
 */
function straightAimY(tt: UnitType): number {
    const want = projectileAimY(tt) * tt.meshScale;
    let best = want;
    let bestGap = Infinity;
    for (const c of tt.colliders) {
        const cy = c.y * tt.meshScale;
        const band = c.r * tt.meshScale * 0.5;
        const y = Math.max(cy - band, Math.min(cy + band, want));
        if (Math.abs(y - want) < bestGap) {
            bestGap = Math.abs(y - want);
            best = y;
        }
    }
    return best;
}

/** Grounded rock after a stone impact — inherits flying uniform scale. */
function stoneDropFields(p: Projectile): { dropStone?: boolean; dropStoneScale?: number } {
    if (p.style !== 'stone' || p.scaleEnd != null) return {};
    return {
        dropStone: true,
        dropStoneScale: typeof p.scale === 'number' ? p.scale : undefined,
    };
}

/** overkill fed to a lifeline death, as a multiple of the victim's own max hp —
 *  drives the tip-over flop and, for flyers, how far the wreck is thrown */
const COLLAPSE_OVERKILL = 4;
/** outward shove on each corpse, decayed per frame like any blast impulse */
const COLLAPSE_SHOVE = 0.55;
/** how hard a lifeline death throws its gore along the blast line */
const COLLAPSE_GORE_FLING = 2.8;
/** how hard a razed building's own stone is thrown down the front's path */
const COLLAPSE_DEBRIS_FLING = 2.4;
/** world units per second the collapse front travels outward */
const COLLAPSE_SPEED = 78;

/** ballista / catapult lob — strong enough to read as an arc at long range */
const BALLISTIC_GRAVITY = 28;

/** a planned shot: muzzle, launch velocity and the point it aims at */
interface ShotPlan {
    mx: number;
    mz: number;
    muzzleY: number;
    vx: number;
    vy: number;
    vz: number;
    gravity: number | undefined;
    expectedFlight: number;
    aimX: number;
    aimZ: number;
}

/**
 * A thrown stone as a body: after its landing blast it bounces off slopes,
 * rolls downhill and keeps striking what it runs into, slowed by each unit's
 * mass. Physics belong to the projectile (style `stone`), not the thrower.
 */
interface StoneState {
    /** touched the ground once (the landing blast is spent) */
    landed: boolean;
    rolling: boolean;
    bounces: number;
    /** damage share of the next bounce blast */
    blastMult: number;
    /** speed at the first landing — strikes scale with speed against it */
    refSpeed: number;
    /** rock radius (render mesh r ≈ 0.84 × scale) */
    radius: number;
    /** roll angle (render-only) */
    spin: number;
    /** actors this stone already struck */
    hit: Set<number>;
}
/** ground flatter than this stops a stone instead of bouncing it (rise / run) */
const STONE_MIN_GRADE = 0.25;
const STONE_MAX_BOUNCES = 3;
/** share of the into-ground speed a bounce gives back */
const STONE_RESTITUTION = 0.35;
/** share of the along-ground speed kept per bounce */
const STONE_BOUNCE_FRICTION = 0.78;
/** a bounce weaker than this (wu/s up) turns into rolling */
const STONE_ROLL_VN = 3;
/** rolling deceleration (wu/s²) */
const STONE_ROLL_FRICTION = 9;
const STONE_STOP_SPEED = 1.2;
/** rolling off a drop deeper than this goes airborne again (wu) */
const STONE_LEDGE_DROP = 0.8;
/** how long a landed stone may keep moving (s) */
const STONE_MAX_MOVE_S = 6;
/** bounce blasts: damage share per bounce, and splash radius share */
const STONE_BOUNCE_DAMAGE = 0.5;
const STONE_BOUNCE_SPLASH = 0.6;
/** a bounce needs this much into-ground speed to blast (wu/s) */
const STONE_BLAST_MIN_IMPACT = 4;
/** stone mass in unit-radius² terms: a dwarf (0.36) barely slows it, an ogre (2.6) mostly stops it */
const STONE_MASS = 1;
const STONE_MIN_STRIKE_DAMAGE = 1;
/** push on a unit a stone runs into, at full speed (the stone's landing blast pushes 0.55) */
const STONE_STRIKE_PUSH = 1.2;
/** stone render mesh radius at scale 1 */
const STONE_MESH_RADIUS = 0.84;

/** classic lobs: flight-time stretch per loft level (slower across = higher arc) */
const CLASSIC_LOFT_TIME = [1, 1.8, 2.6];
/** fixed-angle lobs: the launch angle per loft level */
function loftAngleDeg(base: number, loft: number): number {
    if (loft <= 1) return base;
    if (loft === 2) return Math.min(80, Math.max(base + 15, 55));
    return Math.min(82, Math.max(base + 30, 70));
}
/** how long a line-of-fire verdict holds before it's checked again (s) */
const LOS_RECHECK_S = 0.3;
/** spacing of the terrain samples along a planned shot (wu) */
const LOS_SAMPLE_WU = 1;
/** a shot must pass at least this high over the ground (wu) */
const LOS_CLEARANCE = 0.05;
/** no progress toward the target for this long, with terrain in the way → stuck (s) */
const STUCK_SECONDS = 3;
/** getting this much closer counts as progress (wu) */
const STUCK_PROGRESS_WU = 1;
/** a target a unit got stuck on is passed over for this long (s) */
const STUCK_SHUN_SECONDS = 6;

/** Deterministic 0..1 from an integer seed (lockstep-safe; no Math.sin). */
function detHash01(n: number): number {
    let x = Math.imul(n | 0, 1664525) + 1013904223;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x >>> 0) % 1_000_000) / 1_000_000;
}

/** circle (default) or rectangle footprint.
 *  Rectangle: center must lie in `rect` (no radius pad) so damage matches the scar.
 *  Circles: include actor radius as padding. */
function strikeHits(s: SpellStrike, x: number, z: number, pad: number): boolean {
    if (s.rect) {
        const yaw = s.yaw ?? 0;
        const c = detCos(yaw);
        const sn = detSin(yaw);
        const dx = x - s.x;
        const dz = z - s.z;
        const lx = dx * c + dz * sn;
        const lz = -dx * sn + dz * c;
        // pad ignored — scar ↔ kill must match what you see on the ground
        return Math.abs(lx) <= s.rect.halfWidth && Math.abs(lz) <= s.rect.halfDepth;
    }
    return hypot(x - s.x, z - s.z) <= s.radius + pad;
}

// movement tuning
const AVOID_LOOKAHEAD = 16; // how far ahead a mech watches for big blockers
const AVOID_MARGIN = 0.6; // extra clearance kept around obstacles
const AVOID_STRENGTH = 2.4;
const SEPARATION_GAP = 1.0; // soft personal space between mechs
const SEPARATION_STRENGTH = 1.1;
const BIG_RADIUS = 2.5; // actors at least this wide are steered around (towers, ballistas)
/** seconds a crowd-push lane offset is kept as the approach goal */
const APPROACH_OFFSET_HOLD = 0.85;
/** max world offset from target center while lane-holding */
const APPROACH_OFFSET_MAX = 4.0;
/**
 * Hysteresis for {@link UnitType.meleePress}: start closing this much beyond
 * the press distance, stop at it. Without a band a unit flips between "close"
 * and "hold" every frame at the boundary, which the walk blend reads as a
 * stutter.
 */
const MELEE_PRESS_BAND = 0.07;
/** Free-flight: how far past the target counts as "behind" before coasting. */
const FLY_PASS_CLEAR = 5.2;
/** Free-flight: brief pause behind the foe before a det-random turn. */
const FLY_PASS_COAST_SEC = 0.4;
/** a chasing free-flyer slows at most to this share of its speed to turn onto a close foe */
const FLY_CHASE_MIN_SPEED = 0.15;
/** Free-flight: ±radian jitter when picking the next approach heading. */
const FLY_PASS_TURN_SPREAD = Math.PI * 0.95;
/**
 * Free-flight: longest a locked pass may run. The pass normally ends once the
 * flyer is FLY_PASS_CLEAR behind its target, but a target flying the same way
 * at the same speed (bat vs bat) never falls behind — without a cap the
 * heading stayed locked and the bat left the board.
 */
const FLY_PASS_MAX_SEC = 2.5;
const HASH_CELL = 8; // ≥ biggest mech-pair contact distance
/** expanding-ring cap for closest-enemy search (map diagonal ≪ this × cell) */
const TARGET_MAX_RING = 48;

/** Fixed battle sim tick rate (StarCraft II uses 16; was 30). */
export const SIM_HZ = 16;

/** cadences below are counted in STEPS but tuned in SECONDS — derive them
 *  from {@link SIM_HZ} so the tick rate stays a performance knob instead of
 *  silently retuning the AI (dropping 30 → 16 Hz with the raw step counts
 *  stretched retargeting from 1.0s to 1.875s) */
const perSeconds = (seconds: number) => Math.max(1, Math.round(seconds * SIM_HZ));

/** above this many living mobile mechs, throttle crowd checks to {@link CROWD_OVERLOAD_EVERY_STEPS} */
export const SOFT_CROWD_LIMIT = 2000;
/** soft crowd runs every N steps per mech (staggered by index), like retargeting */
const CROWD_EVERY_STEPS = 1;
/** throttled cadence once {@link SOFT_CROWD_LIMIT} is exceeded — 0.2s of sim time */
const CROWD_OVERLOAD_EVERY_STEPS = perSeconds(0.2);
/** re-run closestEnemy only every 1s of sim time (staggered by actor index) */
const TARGET_REFRESH_STEPS = perSeconds(1);

/**
 * Ground-only vs diving free-flyers (bats): opportunistic contact swat.
 * No chase — target must already be inside {@link GROUND_SWAT_PAD} of the
 * collision circles — and hits only connect some of the time (fast birds).
 */
const GROUND_SWAT_MAX_ALT = 3.25;
const GROUND_SWAT_PAD = 0.85;
const GROUND_SWAT_CATCH = 0.28;

/**
 * The real-time battle: every mech acts individually — it walks toward the
 * closest enemy it can attack and fires once in range. Nothing walks through
 * anything: mechs steer around big blockers (a pack splits left/right around
 * a tower), keep soft spacing among themselves, and a mass-based push-out
 * pass resolves remaining overlaps (a ballista plows through dwarves).
 *
 * Replay groundwork: the sim advances in fixed steps with a stable actor
 * order and no randomness, so re-running it from the same deployment
 * produces the same battle.
 */
export class BattleSim {
    private static readonly STEP = 1 / SIM_HZ;

    readonly actors: Actor[] = [];
    readonly projectiles: Projectile[] = [];
    /**
     * Working oil+fire layer for this battle (cloned from match oil).
     * After the battle, the game adopts remaining oil via {@link hazards}.
     */
    readonly hazards: HazardField;
    /** fixed-step time simulated so far — the deterministic battle clock */
    elapsed = 0;
    private events: SimEvent[] = [];
    private accumulator = 0;
    /**
     * Sim clock time until which each SEAT's own tower-destruction debuff
     * runs — keyed by SeatId (not BattleTeam/side): losing a Command Tower
     * or Research Center only debuffs the seat that owned it, never a
     * teammate's units too (Stronghold loss triggers no debuff at all — see
     * isDebuffBuilding). Flat effect while active (see debuff/
     * damageTakenMult) — it doesn't matter how many of a seat's own
     * buildings are down at once, or how many seats a side has; only
     * duration stacks, one +debuffSecondsForTowerLevel per building lost.
     */
    private readonly debuffUntil = new Map<SeatId, number>();
    private readonly hash = new Map<number, Actor[]>();
    /** spatial hash of every attackable actor (incl. structures) for targeting / bullets */
    private readonly targetHash = new Map<number, Actor[]>();
    /** living immovable structures — rebuilt each step for overlap resolution */
    private readonly structures: Actor[] = [];
    /** scratch buffers to avoid per-call allocations in hot paths */
    private readonly nearbyScratch: Actor[] = [];
    private readonly segmentScratch: Actor[] = [];
    /** tech-resolved base stats per pack, fixed at battle start */
    private readonly resolved = new Map<Unit, ResolvedStats>();
    /** innate-only stats (researched talents stripped) — reused while hexed */
    private readonly empBaseStats = new Map<string, ResolvedStats>();
    /** damage dealt per `${team}:${typeId}` — the post-battle report data */
    readonly damageByType = new Map<string, number>();
    /** golden auras ({@link UnitType.aura}) are a one-shot at {@link GOLDEN_AURA_APPLY_AT}, not continuous */
    private goldenAuraApplied = false;
    /** duration of the previous sim step — converts actor.mv* into velocity for lead aim */
    private prevStepDt = 1 / SIM_HZ;
    /** line-of-fire verdicts per shooter→target pair: the loft that clears (0 = blocked) */
    private readonly losCache = new Map<number, { until: number; loft: number }>();
    /** talents with an opening crowd spread (Loose Rank), per unit type — see crowdRadius */
    private readonly spreadTalents = new Map<UnitType, { list: TechDef[]; seconds: number }>();
    private readonly buildingScratch: Actor[] = [];
    /** when true, step() accumulates timings into {@link lastProfile} */
    profileEnabled = false;
    /** ms spent in the last {@link update} call (summed across catch-up steps) */
    lastProfile: CpuTimings = {};
    /** how many fixed steps the last update() ran */
    lastProfileSteps = 0;
    /** increments every step — used to stagger target refresh */
    private stepIndex = 0;
    /** mobile count exceeded {@link SOFT_CROWD_LIMIT} — crowd checks throttled */
    private softCrowdOverload = false;
    /** living non-structure mechs — last computed in step() / readable for debug */
    lastMobileCount = 0;
    /** true when crowd runs every step; false when throttled to {@link CROWD_OVERLOAD_EVERY_STEPS} */
    lastSoftCrowd = true;
    /** routes passed at battle start — used by {@link activeRallyRoutes} */
    private rallyRoutes: readonly RallyRoute[] = [];
    /** parent → production-tech release lanes (pre-placed children) */
    private readonly productionLanes = new Map<
        Unit,
        {
            techId: string;
            interval: number;
            max: number;
            /** length of the current cycle (delay for the first, then interval) */
            cycleLen: number;
            nextAt: number;
            released: number;
            children: Unit[];
        }[]
    >();
    /** packs that raise a child on each kill — typeId from {@link TechDef.onKill} */
    private readonly onKillByUnit = new Map<Unit, { typeId: string }[]>();
    private readonly pendingOnKillSpawns: { parent: Unit; typeId: string; x: number; z: number }[] =
        [];
    /** golden-angle counter so stacked corpses don't occupy the same xz */
    private onKillSpawnSeq = 0;
    /** bodies that already fired onDeath talents this battle (explode / acid) */
    private readonly deathTalentsApplied = new Set<Actor>();
    /** pack → cleave disk radius; 0 / missing = single-target melee */
    private readonly cleaveRadiusByUnit = new Map<Unit, number>();
    /**
     * Collapse fronts rolling outward from a fallen Stronghold. Each kills the
     * packs of its own side as it reaches them, so the army goes down from the
     * keep outward instead of all at once.
     */
    private readonly collapseFronts: {
        team: BattleTeam;
        x: number;
        z: number;
        startedAt: number;
        maxRadius: number;
    }[] = [];
    /** scheduled spell strikes; each fires exactly once at its `at` time */
    private readonly strikes: (SpellStrike & { at: number; fired: boolean })[];
    /** ticking spell zones with their private rng streams and tick clocks */
    private readonly zones: (SpellZone & {
        rng: () => number;
        nextAt: number;
        endAt: number;
    })[];
    /** scheduled capsule ignitions; each fires exactly once */
    private readonly ignites: (SpellIgnite & { at: number; fired: boolean })[];
    /** meteor-shower impacts delayed until the visual fall completes */
    private readonly pendingMeteors: {
        at: number;
        x: number;
        z: number;
        radius: number;
        damage: number;
        igniteRadius?: number;
        fired: boolean;
    }[] = [];
    /** when true, kills from applyBurnDamage use hammer pancake death */
    private crushingHammer = false;
    /** oil/acid/fire drips along capsule paths — announce fall, then stamp on land */
    private readonly drips: {
        kind: 'oil' | 'acid' | 'fire';
        x: number;
        z: number;
        radius: number;
        expiresRound: number;
            burnSeconds: number;
            intensity: number;
            /** dragon breath: direct disc damage on stamp (0 = paint only) */
            damage: number;
            /** {@link FIRE_TINT_NORMAL} or {@link FIRE_TINT_DRAGON} */
            tint: number;
            fallStart: number;
        landAt: number;
        announced: boolean;
        stamped: boolean;
        silent: boolean;
        /** visual-only drip size (acid rain) */
        dripScale?: number;
        dripLean?: number;
    }[] = [];

    constructor(
        units: readonly Unit[],
        private readonly config: SimConfig,
    ) {
        this.hazards = config.oilField?.cloneForBattle() ?? new HazardField();
        for (const unit of units) {
            if (unit.destroyed) {
                // a razed tower owes nothing here either — see Unit.razed
                if (this.isDebuffBuilding(unit) && !unit.razed) {
                    this.extendSeatDebuff(unit.seat, unit.level);
                }
                continue; // rubble is not a target
            }
            const stats = config.statsOf(unit);
            this.resolved.set(unit, stats);
            // shield pool mirrors the leveled max HP (0 when the pack has none)
            const shieldMax = hasShieldHp(unit, config.hasTech, config.types)
                ? stats.hp * this.levelMult(unit)
                : 0;
            for (const m of unit.members) {
                const x = unit.world.x + m.home.x;
                const z = unit.world.z + m.home.z;
                this.actors.push({
                    unit,
                    mesh: m.mesh,
                    x,
                    z,
                    prevX: x,
                    prevZ: z,
                    rx: x,
                    rz: z,
                    hp: stats.hp * this.levelMult(unit),
                    maxHp: stats.hp * this.levelMult(unit),
                    shieldHp: shieldMax,
                    shieldMaxHp: shieldMax,
                    cooldown: 0, // assigned canonically below
                    alive: true,
                    radius: unit.type.collisionRadius,
                    index: 0,
                    hurtTimer: 0,
                    // a pinned pack (Stronghold archer on his battlement) owns
                    // its own absolute Y — feetY already returns altitude
                    // verbatim whenever it is above zero
                    altitude: unit.pinnedY ?? effectiveFlying(unit.type, unit.seat, this.config.hasTech, this.config.types),
                    prevAltitude:
                        unit.pinnedY ?? effectiveFlying(unit.type, unit.seat, this.config.hasTech, this.config.types),
                    footY: unit.pinnedY ?? effectiveFlying(unit.type, unit.seat, this.config.hasTech, this.config.types),
                    rocketTarget: null,
                    goldenUntil: 0,
                    stormDebuffUntil: 0,
                    spawnUntil: 0,
                    spawnDamaged: false,
                    pathDestX: null,
                    pathDestZ: null,
                    pathNextX: null,
                    pathNextZ: null,
                    pathRouteId: null,
                    pathStuck: 0,
                    pathBestDist: Infinity,
                    mvX: 0,
                    mvZ: 0,
                    facing: m.mesh.rotation.y,
                    prevFacing: m.mesh.rotation.y,
                    cachedEnemy: null,
                    approachOx: 0,
                    approachOz: 0,
                    approachOffsetUntil: 0,
                    terrainHinderedAt: -1e9,
                    slideFlip: false,
                    progressTarget: null,
                    progressBest: Infinity,
                    progressAt: 0,
                    shunTarget: null,
                    shunUntil: 0,
                    burnUntil: 0,
                    burnDps: 0,
                    empUntil: 0,
                    empSpeedMult: 1,
                    corrodedUntil: 0,
                    appearAt: 0,
                    appeared: true,
                    allegiance: null,
                    allegianceSeat: unit.seat,
                    convertTarget: null,
                    convertTargets: [],
                    convertProgress: 0,
                    convertBy: null,
                    convertCooldown: 0,
                    convertRayTipX: 0,
                    convertRayTipY: 0,
                    convertRayTipZ: 0,
                    convertRayActive: false,
                    rampBeamTargets: [],
                    rampBeamLockTs: [],
                    rampBeamTarget: null,
                    meleePendingDamage: 0,
                    meleePendingAt: 0,
                    meleePendingFocus: 0,
                    meleeRetreatGoal: 0,
                    flyPassPhase: 0,
                    flyPassUntil: 0,
                    flyPassHx: 0,
                    flyPassHz: -1,
                    flyPassStruck: false,
                    flyPassTurnYaw: 0,
                    flightPitch: 0,
                    prevFlightPitch: 0,
                });
            }
        }

        // flank tax: packs standing on the flanks spawn slowly this battle —
        // paid exactly once ever (attempting counts, even if the pack dies
        // mid-spawn). Collect units first: the flag must flip only after
        // EVERY member of the pack has been marked.
        const spawningUnits = new Set<Unit>();
        for (const a of this.actors) {
            if (this.config.needsFlankSpawn(a.unit)) spawningUnits.add(a.unit);
        }
        for (const a of this.actors) {
            if (!spawningUnits.has(a.unit)) continue;
            const base = this.config.flankSpawnSeconds ?? DEFAULT_SETTINGS.deploy.flankSpawnSeconds;
            // the ramp starts when the opening freeze ends, so the advertised
            // duration is real vulnerability time
            a.spawnUntil = BATTLE_START_FREEZE + base * this.config.flankSpawnMult(a.unit.seat);
            a.hp = 1;
        }
        for (const unit of spawningUnits) unit.flankSpawnDone = true;

        // summons start DORMANT (not alive → excluded from every system,
        // hidden) and awaken one by one: appearAt is staggered per member so
        // the war band materializes as a drumroll, not a wall. Member order
        // here is creation order — fixed before the canonical sort below.
        const summonMemberIdx = new Map<Unit, number>();
        for (const a of this.actors) {
            const delay = this.config.summonDelayOf?.(a.unit) ?? 0;
            if (delay <= 0) continue;
            const idx = summonMemberIdx.get(a.unit) ?? 0;
            summonMemberIdx.set(a.unit, idx + 1);
            a.appearAt = BATTLE_START_FREEZE + delay + idx * SUMMON_STAGGER_SECONDS;
            a.appeared = false;
            a.alive = false;
            a.mesh.visible = false;
        }

        // production reserves: pre-placed children stay dormant until the
        // parent releases them (appearAt stays 0 so stepSummonAppearances skips them).
        for (const a of this.actors) {
            if (!a.unit.productionHeld) continue;
            a.appeared = false;
            a.alive = false;
            a.mesh.visible = false;
            a.appearAt = 0;
        }
        this.initProductionState();
        this.initOnKillState();
        this.initCleaveState();

        this.strikes = (config.spellStrikes ?? []).map((s) => ({
            ...s,
            at: BATTLE_START_FREEZE + s.delaySeconds,
            fired: false,
        }));
        this.zones = (config.spellZones ?? []).map((z) => ({
            ...z,
            rng: mulberry32(z.seed),
            nextAt: BATTLE_START_FREEZE + z.delaySeconds,
            endAt: BATTLE_START_FREEZE + z.delaySeconds + z.duration,
        }));
        this.ignites = (config.spellIgnites ?? []).map((f) => ({
            ...f,
            at: BATTLE_START_FREEZE + f.delaySeconds,
            fired: false,
        }));
        this.buildHazardDrips(config.hazardPours ?? []);
        // canonical battle order: both peers sort into the SAME sequence
        // (host units first, each side by spawn counter, members in pack
        // order via sort stability), so every order-dependent computation —
        // targeting ties, float accumulation, fire stagger — agrees exactly
        this.actors.sort((a, b) => {
            const r = config.seatRank(a.unit.seat) - config.seatRank(b.unit.seat);
            if (r !== 0) return r;
            return a.unit.id - b.unit.id;
        });
        const perUnit = new Map<Unit, number>();
        this.actors.forEach((a, i) => {
            a.index = i;
            // deterministic per-pack fire stagger, from the canonical order
            const nth = perUnit.get(a.unit) ?? 0;
            perUnit.set(a.unit, nth + 1);
            const stats = this.statsOf(a);
            a.cooldown = (nth % 5) * (stats.attackInterval / 5);
        });

        this.assignRallyRoutes(config.rallyRoutes ?? []);

        let mobile = 0;
        for (const a of this.actors) {
            // marchIn horde actors don't count toward the soft-crowd budget —
            // hundreds of them walking in from the forest shouldn't disable
            // crowd separation for the actual battle
            if (a.alive && !a.unit.type.structure && !a.unit.marchIn) mobile++;
        }
        this.lastMobileCount = mobile;
        this.softCrowdOverload = mobile > SOFT_CROWD_LIMIT;
        this.lastSoftCrowd = !this.softCrowdOverload;
    }

    /** snapshot at battle start: mechs whose collision circle touches a
     *  route's start circle march to a matching offset at mid, then the same
     *  offset at end. Overlapping zones: last-placed route wins. */
    private assignRallyRoutes(routes: readonly RallyRoute[]): void {
        this.rallyRoutes = routes;
        for (const route of routes) {
            for (const a of this.actors) {
                if (!a.alive || a.unit.type.structure || a.unit.team !== route.team) continue;
                if (a.spawnUntil > BATTLE_START_FREEZE + 1e-9) continue;
                const dx = a.x - route.startX;
                const dz = a.z - route.startZ;
                const reach = RALLY_ROUTE_RADIUS + a.radius;
                if (dx * dx + dz * dz > reach * reach) continue;
                a.pathDestX = route.midX + dx;
                a.pathDestZ = route.midZ + dz;
                a.pathNextX = route.endX + dx;
                a.pathNextZ = route.endZ + dz;
                a.pathRouteId = route.id;
                a.pathStuck = 0;
                a.pathBestDist = Infinity;
            }
        }
    }

    private clearPathOrder(a: Actor): void {
        a.pathDestX = null;
        a.pathDestZ = null;
        a.pathNextX = null;
        a.pathNextZ = null;
        a.pathRouteId = null;
        a.pathStuck = 0;
        a.pathBestDist = Infinity;
    }

    /** advance to the next waypoint, or clear when the path is done */
    private advanceOrClearPath(a: Actor): void {
        if (a.pathNextX !== null && a.pathNextZ !== null) {
            a.pathDestX = a.pathNextX;
            a.pathDestZ = a.pathNextZ;
            a.pathNextX = null;
            a.pathNextZ = null;
            a.pathStuck = 0;
            a.pathBestDist = Infinity;
            return;
        }
        this.clearPathOrder(a);
    }

    /** true when the mech has arrived or given up on its rally destination */
    private updatePathProgress(a: Actor, dt: number): boolean {
        if (a.pathDestX === null || a.pathDestZ === null) return false;
        const dist = hypot(a.x - a.pathDestX, a.z - a.pathDestZ);
        if (dist <= RALLY_ROUTE_REACH) {
            this.advanceOrClearPath(a);
            // still on path if we advanced to the next waypoint
            return a.pathDestX !== null;
        }
        if (dist < a.pathBestDist - 0.05) {
            a.pathBestDist = dist;
            a.pathStuck = 0;
        } else {
            a.pathStuck += dt;
            if (a.pathStuck >= RALLY_ROUTE_STUCK_SEC) {
                this.clearPathOrder(a);
                return false;
            }
        }
        return true;
    }

    /** deterministic end: timeout or one side wiped — never step past it */
    get finished(): boolean {
        return this.isOver || this.elapsed >= this.config.battleSeconds - 1e-9;
    }

    /** debug/cheat: stretch the battle timeout mid-fight */
    setBattleSeconds(seconds: number): void {
        this.config.battleSeconds = seconds;
    }

    /** the round ends as soon as one side has no units left besides its towers */
    get isOver(): boolean {
        const playerAny = this.hasMobileMechs('player');
        const enemyAny = this.hasMobileMechs('enemy');
        if (!playerAny || !enemyAny) return true;
        // Both sides only have building-bound troops (wall archers) — nothing can
        // march across the field, so settle the round and score survivors.
        if (!this.hasFieldArmy('player') && !this.hasFieldArmy('enemy')) return true;
        return false;
    }

    /**
     * Living non-structure mechs that can leave their tile — excludes
     * battlement archers (speed 0 / pinned to the keep).
     */
    private hasFieldArmy(team: Team): boolean {
        return this.actors.some(
            (a) =>
                actorTeam(a) === team &&
                !a.unit.type.structure &&
                !a.unit.type.fixture &&
                (a.alive || (a.appearAt > 0 && !a.appeared)),
        );
    }

    private hasMobileMechs(team: Team): boolean {
        // dormant summons count — the battle must not end while reinforcements
        // are still on their way in. Stronghold archers count too: a keep-only
        // defense is still a fighting force (and must keep the round open
        // while enemies march in).
        return this.actors.some(
            (a) =>
                actorTeam(a) === team &&
                !a.unit.type.structure &&
                (a.alive || (a.appearAt > 0 && !a.appeared)),
        );
    }

    /**
     * Ground markers for spell zones CURRENTLY ticking (render-only — the
     * visual layer draws these every battle frame so acid/poison/storm/
     * meteor-shower actually show something on the ground while active,
     * the same way oil's hazard mask stays visible for its own lifetime).
     */
    activeZoneMarkers(): { tacticId: string; x: number; z: number; radius: number }[] {
        const out: ReturnType<BattleSim['activeZoneMarkers']> = [];
        for (const z of this.zones) {
            const startAt = BATTLE_START_FREEZE + z.delaySeconds;
            if (this.elapsed < startAt || this.elapsed > z.endAt) continue;
            out.push({ tacticId: z.tacticId, x: z.x, z: z.z, radius: z.radius });
        }
        return out;
    }

    /**
     * Rally routes that still have at least one living mech marching along
     * them. Render-only — hide a route once every assignee has arrived,
     * given up (stuck), or died.
     */
    activeRallyRoutes(): readonly RallyRoute[] {
        const live = new Set<number>();
        for (const a of this.actors) {
            if (a.alive && a.pathRouteId !== null) live.add(a.pathRouteId);
        }
        if (live.size === 0) return [];
        return this.rallyRoutes.filter((r) => live.has(r.id));
    }

    private recordDamage(attacker: Unit, amount: number): void {
        const key = `${attacker.team}:${attacker.type.id}`;
        this.damageByType.set(key, (this.damageByType.get(key) ?? 0) + amount);
    }

    /**
     * The one place damage lands: hp, the per-type report, the pack's
     * lifetime stats (effective damage — overkill doesn't count), and death.
     * Optional `knockDir` (xz) biases air-death crash drift by blow strength.
     */
    private applyDamage(
        source: Unit,
        target: Actor,
        amount: number,
        knockDir?: { x: number; z: number },
        channel: DamageChannel = 'shielded',
    ): void {
        // Shield soaks the whole hit and breaks — no HP spills over, so the
        // shield always eats exactly one more attack than its pool covers.
        // Hex shuts off talent shields (Aegis); item runes (Bulwark) still soak.
        if (channel === 'shielded' && target.shieldHp > 0 && !this.techShieldSuppressed(target)) {
            const drained = Math.min(amount, target.shieldHp);
            source.damageDealt += drained;
            this.recordDamage(source, amount);
            target.shieldHp = Math.max(0, target.shieldHp - amount);
            target.hurtTimer = HURT_BAR_SECONDS;
            if (target.spawnUntil > this.elapsed + 1e-9) target.spawnDamaged = true;
            const steal = this.lifestealFraction(source);
            if (steal > 0 && drained > 0) this.healPack(source, drained * steal);
            return;
        }
        const drained = Math.min(amount, Math.max(0, target.hp));
        source.damageDealt += drained;
        target.hp -= amount;
        this.recordDamage(source, amount);
        target.hurtTimer = HURT_BAR_SECONDS;
        if (target.spawnUntil > this.elapsed + 1e-9) target.spawnDamaged = true;
        const steal = this.lifestealFraction(source);
        if (steal > 0 && drained > 0) this.healPack(source, drained * steal);
        if (target.hp <= 0) this.kill(target, source, amount, knockDir);
    }

    /** Hex active right now (researched talents off + slow). */
    private isEmpd(a: Actor): boolean {
        return a.empUntil > this.elapsed + 1e-9;
    }

    /**
     * Combat stats for this body: full tech mods, or innate-only while hexed.
     * Current HP / maxHp are not rewritten mid-fight.
     */
    private statsOf(a: Actor): ResolvedStats {
        if (!this.isEmpd(a)) return this.resolved.get(a.unit)!;
        const key = a.unit.type.id;
        let base = this.empBaseStats.get(key);
        if (!base) {
            base = TechTree.statsWithOwned(
                a.unit.type,
                new Set(a.unit.type.innateTechs ?? []),
                this.config.types,
            );
            this.empBaseStats.set(key, base);
        }
        return base;
    }

    /**
     * Does this body still benefit from a researched talent? Innate always;
     * hexed bodies lose everything else.
     */
    private actorHasTech(a: Actor, techId: string): boolean {
        if (a.unit.type.innateTechs?.includes(techId)) return true;
        if (this.isEmpd(a)) return false;
        return this.config.hasTech(a.unit.seat, a.unit.type.id, techId);
    }

    /** Aegis (talent) shield ignored while hexed; Bulwark rune still works. */
    private techShieldSuppressed(a: Actor): boolean {
        if (!this.isEmpd(a)) return false;
        for (const id of a.unit.items) {
            if (this.config.types.rune(id)?.grantsShieldHp) return false;
        }
        return true;
    }

    private moveSpeedFactor(a: Actor, towerSpeedMult: number): number {
        let m = this.debuff(a, towerSpeedMult);
        if (this.isEmpd(a)) m *= a.empSpeedMult;
        return m;
    }

    /** Owned talents that still apply on this body (innate + researched; hex strips researched). */
    private techProfiles(a: Actor): TechDef[] {
        const out: TechDef[] = [];
        for (const tech of this.config.types.talentsOf(a.unit.type)) {
            if (this.actorHasTech(a, tech.id)) out.push(techForUnit(a.unit.type, tech));
        }
        return out;
    }

    /** Product of vsAir / vsGround multipliers for the target's layer. */
    private vsLayerMult(attacker: Actor, target: Actor, kind: 'damage' | 'range'): number {
        let m = 1;
        const air = target.altitude > 0;
        for (const tech of this.techProfiles(attacker)) {
            const layer = air ? tech.vsAir : tech.vsGround;
            if (!layer) continue;
            const v = kind === 'damage' ? layer.damage : layer.range;
            if (v != null) m *= v;
        }
        return m;
    }

    /** 1 + (level − 1) × sum of per-level talent bonuses. */
    private levelScaleMult(a: Actor, kind: 'damage' | 'range'): number {
        return levelScaleMultFromTechs(this.techProfiles(a), a.unit.level, kind);
    }

    /** Weapon reach after levelScale + vsLayer range multipliers. */
    private weaponRange(attacker: Actor, target: Actor, baseRange: number): number {
        return baseRange * this.levelScaleMult(attacker, 'range') * this.vsLayerMult(attacker, target, 'range');
    }

    /**
     * Attack damage roll: base × veterancy × tower attack debuff × levelScale × vsLayer.
     */
    private hitDamage(
        attacker: Actor,
        target: Actor,
        statsDamage: number,
        attackMult: number,
    ): number {
        return (
            statsDamage *
            this.levelMult(attacker.unit) *
            this.debuff(attacker, attackMult) *
            this.levelScaleMult(attacker, 'damage') *
            this.vsLayerMult(attacker, target, 'damage')
        );
    }

    /** Split heal among living non-structure members of a pack. */
    private healPack(unit: Unit, totalHeal: number): void {
        if (totalHeal <= 0 || unit.type.structure) return;
        const members: Actor[] = [];
        for (const a of this.actors) {
            if (a.unit !== unit || !a.alive) continue;
            members.push(a);
        }
        if (members.length === 0) return;
        const each = totalHeal / members.length;
        for (const a of members) {
            a.hp = Math.min(a.maxHp, a.hp + each);
        }
    }

    /**
     * Strongest lifesteal fraction among owned researched talents (seat research —
     * same ownership check as {@link empProfileOf}).
     */
    private lifestealFraction(source: Unit): number {
        let best = 0;
        for (const tech of techsForUnit(source.type, this.config.types, this.config.loadoutOf(source.seat))) {
            if (tech.lifesteal == null) continue;
            if (!this.config.hasTech(source.seat, source.type.id, tech.id)) continue;
            if (tech.lifesteal > best) best = tech.lifesteal;
        }
        return best;
    }

    /** Convert / ramp-beam extras: channel count, intensity scale, full heal on flip. */
    private convertTuning(caster: Actor): {
        maxTargets: number;
        intensityMult: number;
        healFull: boolean;
    } {
        let maxTargets = 1;
        let intensityMult = 1;
        let healFull = false;
        for (const tech of this.techProfiles(caster)) {
            if (tech.convert) {
                if (tech.convert.maxTargets != null) {
                    maxTargets = Math.max(maxTargets, tech.convert.maxTargets);
                }
                if (tech.convert.intensityMult != null) {
                    intensityMult *= tech.convert.intensityMult;
                }
            }
            if (tech.convertHealFull) healFull = true;
        }
        return { maxTargets, intensityMult, healFull };
    }

    /** Death nova / acid puddle from onDeath talents. Once per body. */
    private applyOnDeathTalents(target: Actor): void {
        if (this.deathTalentsApplied.has(target)) return;
        this.deathTalentsApplied.add(target);
        if (target.unit.type.structure || target.unit.type.extra) return;
        let explodeSplash = 0;
        let explodeMult = 1;
        let acidRadius = 0;
        let hasExplode = false;
        for (const tech of this.techProfiles(target)) {
            const od = tech.onDeath;
            if (!od) continue;
            if (od.explode) {
                const mult = od.explode.damageMult ?? 1;
                if (!hasExplode || od.explode.splash > explodeSplash) {
                    explodeSplash = od.explode.splash;
                    explodeMult = mult;
                    hasExplode = true;
                } else if (od.explode.splash === explodeSplash && mult > explodeMult) {
                    explodeMult = mult;
                }
            }
            if (od.acid) {
                // talent radius (already talentMod-scaled) × body size
                acidRadius = Math.max(acidRadius, od.acid.radius * target.radius);
            }
        }
        if (hasExplode && explodeSplash > 0) {
            const damage = target.maxHp * explodeMult;
            this.explode(
                { damage, team: actorTeam(target), source: target.unit },
                target.x,
                target.z,
                explodeSplash,
            );
            this.events.push({
                kind: 'explosion',
                x: target.x,
                y: simGroundHeightAt(target.x, target.z),
                z: target.z,
                radius: explodeSplash,
                heavy: true,
            });
        }
        if (acidRadius > 0) {
            const shields = livingShieldDisks(this.actors.map((a) => a.unit));
            const expires = this.config.oilExpiresRound ?? 9999;
            this.hazards.stampAcid(target.x, target.z, acidRadius, expires, shields);
        }
    }

    /**
     * Strongest emp profile among owned talents on this pack (attacker side).
     * Checked at impact from seat research — not stripped if the shooter is hexed.
     */
    private empProfileOf(source: Unit): { duration: number; speedMult: number } | undefined {
        let best: { duration: number; speedMult: number } | undefined;
        for (const tech of techsForUnit(source.type, this.config.types, this.config.loadoutOf(source.seat))) {
            if (!tech.emp || !this.config.hasTech(source.seat, source.type.id, tech.id)) continue;
            const speedMult = tech.emp.speedMult ?? 0.6;
            if (!best || tech.emp.duration > best.duration) {
                best = { duration: tech.emp.duration, speedMult };
            }
        }
        return best;
    }

    /**
     * Apply hex on hit. Golden / debuff-immune shrug it off. Structures and
     * board extras are never hexed. Refresh timer; keep the strongest slow.
     */
    private applyEmp(source: Unit, target: Actor): void {
        const profile = this.empProfileOf(source);
        if (!profile || !target.alive) return;
        if (target.unit.type.structure || target.unit.type.extra) return;
        if (this.isDebuffImmune(target)) return;
        const already = target.empUntil > this.elapsed + 1e-9;
        target.empUntil = Math.max(target.empUntil, this.elapsed + profile.duration);
        target.empSpeedMult = already
            ? Math.min(target.empSpeedMult, profile.speedMult)
            : profile.speedMult;
    }

    /**
     * Apply burn DoT to a ground actor. Air (`altitude > 0`) is never burned.
     * Friendly fire: no team filter. Refresh timer + keep strongest DPS.
     */
    private applyBurn(target: Actor, profile: FireProfile | undefined): void {
        const burn = profile?.burn;
        if (!burn || !target.alive) return;
        if (target.altitude > 0) return; // air units ignore burn
        if (target.unit.type.extra) return;
        const aff = target.unit.type.burn;
        const taken = aff?.takenMult ?? 1;
        if (taken <= 0) return;
        const durMult = aff?.durationMult ?? 1;
        applyBurnStatus(
            target,
            this.elapsed,
            burn.dps * taken,
            burn.duration * durMult,
        );
    }

    /**
     * Stamp ground fire (optional) and splash burn onto victims in radius.
     * Kinetic HP damage stays separate (enemy-only via explode). Burn hits
     * everyone on the ground — including allies.
     */
    private applyFireAt(
        source: Unit,
        x: number,
        z: number,
        radius: number,
        profile: FireProfile | undefined,
        opts?: { shotDir?: { x: number; z: number } },
    ): void {
        if (!profile) return;
        if (profile.oil) {
            const shields = livingShieldDisks(this.actors.map((a) => a.unit));
            const expires = this.config.oilExpiresRound ?? 9999;
            const dir = opts?.shotDir;
            if (dir && hypot(dir.x, dir.z) > 1e-6) {
                this.hazards.stampOilDirected(
                    x,
                    z,
                    profile.oil.radius,
                    dir.x,
                    dir.z,
                    expires,
                    shields,
                    this.elapsed,
                );
            } else {
                this.hazards.stampOil(
                    x,
                    z,
                    profile.oil.radius,
                    expires,
                    shields,
                    this.elapsed,
                );
            }
        }
        if (profile.ground) {
            const g = profile.ground;
            const shields = livingShieldDisks(this.actors.map((a) => a.unit));
            const oilCells = this.hazards.stampFire(
                x,
                z,
                g.radius,
                this.elapsed,
                g.duration,
                g.intensity,
                shields,
            );
            const y = simGroundHeightAt(x, z);
            this.events.push({
                kind: 'groundFire',
                x,
                y,
                z,
                radius: g.radius,
                oilCells,
            });
        }
        // oil-only hits next to an existing blaze still catch
        if (profile.oil && !profile.ground) {
            this.hazards.igniteOilTouchingFire(this.elapsed);
        }
        if (!profile.burn) return;
        const oilReach = profile.oil
            ? opts?.shotDir && hypot(opts.shotDir.x, opts.shotDir.z) > 1e-6
                ? profile.oil.radius *
                  OIL_DIRECTED_LENGTH_MUL *
                  (OIL_DIRECTED_FWD +
                      (OIL_DIRECTED_BACK + OIL_DIRECTED_FWD) * OIL_DIRECTED_TAIL_FRAC +
                      OIL_DIRECTED_CROSS)
                : profile.oil.radius
            : 0;
        const r = Math.max(radius, profile.ground?.radius ?? oilReach);
        for (const a of this.actors) {
            if (!a.alive) continue;
            if (hypot(a.x - x, a.z - z) > r + a.radius) continue;
            this.applyBurn(a, profile);
        }
    }

    private fireProfileOf(source: Unit): FireProfile | undefined {
        return resolveFireProfile(source.type, source.seat, this.config.hasTech, this.config.types, this.config.loadoutOf(source.seat));
    }

    /**
     * One melee swing: a cleave hits every enemy in the disk,
     * otherwise a single-target poke. Direct damage (shields don't soak).
     */
    private strikeMelee(
        a: Actor,
        target: Actor,
        damage: number,
        dx: number,
        dz: number,
        dist: number,
    ): void {
        if (damage <= 0) return;
        // Ground swat: swing still happens (caller burned cooldown); bird often escapes.
        if (!this.groundSwatConnects(a, target)) return;
        const radius = this.cleaveRadiusOf(a);
        if (radius > 0) {
            this.cleaveStrike(a, radius, damage, target);
            return;
        }
        const dealt = damage * this.damageTakenMult(target);
        this.applyDamage(a.unit, target, dealt, { x: dx, z: dz }, 'direct');
        this.applyEmp(a.unit, target);
        if (!a.unit.type.freeFlight) this.armMeleeRetreat(a, target);
        // Layer flyers plant on the lawn; free-flight bats already dive via altitude.
        if (a.altitude > 0 && target.altitude === 0 && !a.unit.type.freeFlight) {
            a.stompAt = this.elapsed;
            a.stompAir = false;
            a.stompVictim = undefined;
        }
        const nx = dx / dist;
        const nz = dz / dist;
        const hitX = target.x - nx * target.radius;
        const hitZ = target.z - nz * target.radius;
        // Structures: contact at the attacker's height on the near face so chips
        // read as coming from the fight, not mid-tower. Units keep torso aim.
        let hitY = target.footY + target.unit.type.meshScale * 1.1;
        if (target.unit.type.structure) {
            const roof =
                target.footY +
                Math.max(2, getUnitVisualHeight(target.unit.type.modelId ?? target.unit.type.id) *
                    target.unit.visualMeshScale());
            const attackY = a.footY + a.unit.type.meshScale * 0.75;
            hitY = Math.min(roof - 0.35, Math.max(target.footY + 0.45, attackY));
        }
        this.events.push({
            kind: 'impact',
            x: hitX,
            y: hitY,
            z: hitZ,
            blood: bloodColorOf(target.unit.type),
            flesh: resolveDeathWear(target.unit.type) === 'blood',
            masonry: !!target.unit.type.structure,
            unitTypeId: target.unit.type.structure ? undefined : target.unit.type.id,
            cx: target.unit.type.structure ? target.x : undefined,
            cz: target.unit.type.structure ? target.z : undefined,
            dx: nx,
            dy: 0,
            dz: nz,
            bloodScale: target.unit.type.bloodScale,
            melee: true,
        });
    }

    /**
     * Start a melee swing. Instant by default; units with
     * {@link UnitType.meleeHitDelay} queue damage so the fire anim can wind up.
     * Cooldown (and thus the fire anim) still bumps on the caller.
     */
    private beginMelee(
        a: Actor,
        target: Actor,
        damage: number,
        dx: number,
        dz: number,
        dist: number,
    ): void {
        this.events.push({
            kind: 'meleeSwing',
            x: a.x,
            y: a.footY + a.unit.type.meshScale * 0.8,
            z: a.z,
            unitTypeId: a.unit.type.id,
        });
        const delay = a.unit.type.meleeHitDelay ?? 0;
        if (delay <= 0) {
            this.strikeMelee(a, target, damage, dx, dz, dist);
            return;
        }
        // Don't stack windups if attackInterval < delay (Blood Rage, etc.)
        if (a.meleePendingDamage > 0) this.resolveAttackPending(a);
        a.meleePendingDamage = damage;
        a.meleePendingAt = this.elapsed + delay;
        a.meleePendingFocus = target.index;
    }

    /**
     * Start a ranged volley. Instant by default; {@link UnitType.meleeHitDelay}
     * queues the shot so the fire anim can draw (same windup field as melee).
     */
    private beginRangedFire(a: Actor, target: Actor, damage: number, speed: number): void {
        const delay = a.unit.type.meleeHitDelay ?? 0;
        if (delay <= 0) {
            this.fireVolley(a, target, damage, speed);
            return;
        }
        if (a.meleePendingDamage > 0) this.resolveAttackPending(a);
        a.meleePendingDamage = damage;
        a.meleePendingAt = this.elapsed + delay;
        a.meleePendingFocus = target.index;
    }

    /**
     * Melee in contact — or in the {@link UnitType.meleeLunge} commit band.
     * Returns true when this actor's combat AI is done for the step.
     */
    private tryMeleeEngage(
        a: Actor,
        target: Actor,
        stats: ResolvedStats,
        d: { speedMult: number; attackMult: number },
        bigs: Actor[],
        dt: number,
        canAttack: boolean,
        tdx: number,
        tdz: number,
        tDist: number,
    ): boolean {
        if (a.unit.type.projectileSpeed || a.unit.type.convertRay || a.unit.type.rampBeam) return false;
        const reach = this.weaponRange(a, target, stats.range) + a.radius + target.radius;
        const commit = reach + (a.unit.type.meleeLunge ?? 0);
        if (tDist > commit) return false;

        if (canAttack) a.cooldown -= dt;
        if (canAttack && a.cooldown <= 0) {
            a.cooldown += stats.attackInterval;
            const damage = this.hitDamage(a, target, stats.damage, d.attackMult);
            this.beginMelee(a, target, damage, tdx, tdz, tDist);
        }

        // Keep closing through the windup (and while still shy of contact) so
        // a lunging smash reads as a slide instead of a hard stop. Opt-in per
        // unit: `meleePress` omitted (1) means plant at contact and swing.
        const press = a.unit.type.meleePress ?? 1;
        const sliding =
            press < 1 &&
            (a.meleePendingDamage > 0 ||
                tDist > reach * Math.min(1, press + MELEE_PRESS_BAND));
        if (sliding) {
            this.steerToward(
                a,
                tdx / tDist,
                tdz / tDist,
                tDist,
                dt,
                stats,
                d,
                target,
                bigs,
                reach * press,
                { aimYaw: detAtan2(-tdx, -tdz) },
            );
        } else {
            faceToward(a, detAtan2(-tdx, -tdz), dt);
        }
        return true;
    }

    /** Land any queued attack windups whose delay has elapsed. */
    private stepMeleePending(): void {
        for (const a of this.actors) {
            if (!a.alive || a.meleePendingDamage <= 0) continue;
            if (this.elapsed + 1e-9 < a.meleePendingAt) continue;
            this.resolveAttackPending(a);
        }
    }

    /** Apply a pending melee hit or ranged volley at the attacker's current pose. */
    private resolveAttackPending(a: Actor): void {
        const damage = a.meleePendingDamage;
        if (damage <= 0) return;
        a.meleePendingDamage = 0;
        a.meleePendingAt = 0;
        const focus = this.actors[a.meleePendingFocus];
        let target = focus && focus.alive ? focus : this.closestEnemy(a);
        if (!target) return; // whiff — nothing in range

        const speed = a.unit.type.projectileSpeed;
        if (speed) {
            this.fireVolley(a, target, damage, speed);
            return;
        }

        const tdx = target.x - a.x;
        const tdz = target.z - a.z;
        const tDist = hypot(tdx, tdz) || 1e-6;
        const radius = this.cleaveRadiusOf(a);
        if (radius > 0) {
            this.cleaveStrike(a, radius, damage, target);
            return;
        }
        const stats = this.statsOf(a);
        const reach = this.weaponRange(a, target, stats.range) + a.radius + target.radius;
        // slight slack so a foe that edged out mid-swing still takes the hit
        if (tDist > reach * 1.2) return;
        this.strikeMelee(a, target, damage, tdx, tdz, tDist);
    }

    /** After a ground melee bite, peel to {@link UnitType.meleeRetreat} before diving again. */
    private armMeleeRetreat(a: Actor, target: Actor): void {
        const gap = a.unit.type.meleeRetreat ?? 0;
        if (gap <= 0) return;
        if (target.altitude > 0) return;
        a.meleeRetreatGoal = gap + a.radius + target.radius;
    }

    /**
     * Hit-and-run peel: keep backing while facing the foe until the retreat
     * gap clears (or the target is gone / airborne). Returns true when done
     * for this step.
     */
    private tryMeleeRetreat(
        a: Actor,
        target: Actor | null,
        stats: ResolvedStats,
        d: { speedMult: number; attackMult: number },
        bigs: Actor[],
        dt: number,
        canAttack: boolean,
    ): boolean {
        if (a.meleeRetreatGoal <= 0) return false;
        if (!target || !target.alive || target.altitude > 0) {
            a.meleeRetreatGoal = 0;
            return false;
        }
        const tdx = target.x - a.x;
        const tdz = target.z - a.z;
        const tDist = hypot(tdx, tdz) || 1e-6;
        if (tDist >= a.meleeRetreatGoal) {
            a.meleeRetreatGoal = 0;
            return false;
        }
        // Cooldown keeps ticking so the next dive is ready as soon as we turn.
        if (canAttack) a.cooldown -= dt;
        this.steerToward(
            a,
            -tdx / tDist,
            -tdz / tDist,
            a.meleeRetreatGoal - tDist + a.radius,
            dt,
            stats,
            d,
            target,
            bigs,
            0,
            { aimYaw: detAtan2(tdx, tdz), locomotion: 'track' },
        );
        return true;
    }

    /** Torso / hover height a free-flyer aims its path at. */
    private freeFlightAimY(target: Actor): number {
        if (target.altitude > 0) {
            return target.altitude + target.unit.type.meshScale * 0.35;
        }
        return (
            this.feetY(target) +
            projectileAimY(target.unit.type) * target.unit.type.meshScale
        );
    }

    /** Local ground clearance floor so free-flyers stay in the air layer. */
    private freeFlightMinY(a: Actor): number {
        return simGroundSupportAt(a.x, a.z, a.radius * 0.65) + GROUND_UNIT_Y + 1.15;
    }

    /** Low cruise band for free-flight ({@link UnitType.flying}). */
    private freeFlightCruiseY(a: Actor): number {
        return Math.max(a.unit.type.flying ?? 5.5, this.freeFlightMinY(a));
    }

    /**
     * Climb/dive + nose pitch for {@link UnitType.freeFlight}. Chase aims at a
     * world point; retreat / idle levels out toward cruise.
     */
    private updateFreeFlight(
        a: Actor,
        dt: number,
        aim: { x: number; y: number; z: number } | null,
    ): void {
        if (!a.unit.type.freeFlight) return;
        if ((a.unit.type.flying ?? 0) <= 0) return;

        const minY = this.freeFlightMinY(a);
        const cruise = this.freeFlightCruiseY(a);
        let wantY = cruise;
        if (aim) {
            // Dive onto ground torsos; never sink through the clearance floor.
            // Cap climb a bit above cruise so air duels stay readable.
            wantY = Math.max(minY, Math.min(aim.y, cruise + 3.5));
        }

        const stats = this.statsOf(a);
        const climbSpeed = stats.speed * 0.9;
        const dy = wantY - a.altitude;
        a.altitude += Math.sign(dy) * Math.min(Math.abs(dy), climbSpeed * dt);
        a.altitude = Math.max(minY, a.altitude);

        let desiredPitch = 0;
        if (aim) {
            const flat = hypot(aim.x - a.x, aim.z - a.z) || 1e-6;
            desiredPitch = detAtan2(aim.y - a.altitude, flat);
            desiredPitch = Math.max(-0.9, Math.min(0.9, desiredPitch));
        }
        const pitchRate = (a.unit.type.turnRate ?? DEFAULT_TURN_RATE) * 0.85;
        const dp = desiredPitch - a.flightPitch;
        a.flightPitch += Math.sign(dp) * Math.min(Math.abs(dp), pitchRate * dt);
    }

    /**
     * Ghost pierce combat for {@link UnitType.freeFlight}: fly through the
     * target (no unit collision), chip once per pass, coast behind, then a
     * lockstep-safe random bank before the next dive.
     */
    private stepFreeFlightCombat(
        a: Actor,
        target: Actor | null,
        stats: ResolvedStats,
        d: { speedMult: number; attackMult: number },
        dt: number,
        canAttack: boolean,
    ): void {
        if (!target || !target.alive) {
            // Nothing to dive at: hold station and level out. Flying on along
            // `facing` (the old behaviour) carried an idle flock straight off
            // the board with nothing ever turning it back.
            a.flyPassPhase = 0;
            a.flyPassStruck = false;
            this.updateFreeFlight(a, dt, null);
            return;
        }

        const aimY = this.freeFlightAimY(target);
        const tdx = target.x - a.x;
        const tdz = target.z - a.z;
        const tDist = hypot(tdx, tdz) || 1e-6;
        const touch = this.weaponRange(a, target, stats.range) + a.radius + target.radius;
        const commit = touch + (a.unit.type.meleeLunge ?? 3);

        // --- coast: keep sailing past, then pick a det-random turn ---
        if (a.flyPassPhase === 2) {
            this.updateFreeFlight(a, dt, { x: a.x + a.flyPassHx, y: this.freeFlightCruiseY(a), z: a.z + a.flyPassHz });
            this.flyAlongHeading(a, a.flyPassHx, a.flyPassHz, stats, d, dt);
            if (canAttack) a.cooldown -= dt;
            if (this.elapsed >= a.flyPassUntil) {
                const seed = a.index * 100003 + this.stepIndex * 9176 + Math.floor(this.elapsed * 64);
                const jitter = (detHash01(seed) * 2 - 1) * FLY_PASS_TURN_SPREAD;
                a.flyPassTurnYaw = wrapPi(a.facing + jitter);
                a.flyPassPhase = 3;
            }
            return;
        }

        // --- reorient: bank to the random yaw, then chase again ---
        if (a.flyPassPhase === 3) {
            this.updateFreeFlight(a, dt, null);
            faceToward(a, a.flyPassTurnYaw, dt);
            this.flyAlongFacing(a, stats, d, dt, stats.speed * 0.35 * dt);
            if (canAttack) a.cooldown -= dt;
            if (facingAligned(a, a.flyPassTurnYaw, 0.35)) {
                a.flyPassPhase = 0;
                a.flyPassStruck = false;
            }
            return;
        }

        // --- pass: locked heading through the foe ---
        if (a.flyPassPhase === 1) {
            this.updateFreeFlight(a, dt, { x: target.x, y: aimY, z: target.z });
            this.flyAlongHeading(a, a.flyPassHx, a.flyPassHz, stats, d, dt);
            // Touch damage once while overlapping the body volume
            if (!a.flyPassStruck && tDist <= touch * 1.15) {
                if (canAttack) a.cooldown -= dt;
                if (canAttack && a.cooldown <= 0) {
                    a.cooldown += stats.attackInterval;
                    const damage = this.hitDamage(a, target, stats.damage, d.attackMult);
                    this.strikeMelee(a, target, damage, tdx, tdz, tDist);
                    a.flyPassStruck = true;
                }
            } else if (canAttack) {
                a.cooldown -= dt;
            }
            // Past the target along the pass heading → coast
            const behind = (a.x - target.x) * a.flyPassHx + (a.z - target.z) * a.flyPassHz;
            if (
                behind >= FLY_PASS_CLEAR ||
                (a.flyPassStruck && tDist >= FLY_PASS_CLEAR) ||
                this.elapsed >= a.flyPassUntil
            ) {
                a.flyPassPhase = 2;
                a.flyPassUntil = this.elapsed + FLY_PASS_COAST_SEC;
            }
            return;
        }

        // --- chase: point (slowly) at target and commit a pierce ---
        this.updateFreeFlight(a, dt, { x: target.x, y: aimY, z: target.z });
        const aimYaw = detAtan2(-tdx, -tdz);
        const off = Math.abs(deltaAngle(a.facing, aimYaw));
        faceToward(a, aimYaw, dt);
        // A foe inside the tightest circle this flyer can bank (speed / turn
        // rate) would be circled forever, nose never on it — slow to the arc
        // that runs through it instead.
        const fullSpeed = stats.speed * this.moveSpeedFactor(a, d.speedMult);
        const arcSpeed = (tDist * (a.unit.type.turnRate ?? DEFAULT_TURN_RATE)) / (2 * Math.max(detSin(off), 0.05));
        this.flyAlongFacing(a, stats, d, dt, Math.max(fullSpeed * FLY_CHASE_MIN_SPEED, Math.min(fullSpeed, arcSpeed)) * dt);
        if (canAttack) a.cooldown -= dt;
        if (tDist <= commit && facingAligned(a, aimYaw, 0.55)) {
            const flat = hypot(tdx, tdz) || 1e-6;
            a.flyPassHx = tdx / flat;
            a.flyPassHz = tdz / flat;
            a.flyPassStruck = false;
            a.flyPassPhase = 1;
            a.flyPassUntil = this.elapsed + FLY_PASS_MAX_SEC;
        }
    }

    /** Move along current facing (cruise). `cap` 0 = full step speed. */
    private flyAlongFacing(
        a: Actor,
        stats: ResolvedStats,
        d: { speedMult: number },
        dt: number,
        cap: number,
    ): void {
        const speed = stats.speed * this.moveSpeedFactor(a, d.speedMult);
        const move = cap > 0 ? Math.min(speed * dt, cap) : speed * dt;
        a.x += -detSin(a.facing) * move;
        a.z += -detCos(a.facing) * move;
    }

    /** Move along a locked xz heading while easing facing onto it. */
    private flyAlongHeading(
        a: Actor,
        hx: number,
        hz: number,
        stats: ResolvedStats,
        d: { speedMult: number },
        dt: number,
        /** stop short rather than overshoot (route arrival). 0 = no cap. */
        cap = 0,
    ): void {
        const speed = stats.speed * this.moveSpeedFactor(a, d.speedMult);
        const move = cap > 0 ? Math.min(speed * dt, cap) : speed * dt;
        a.x += hx * move;
        a.z += hz * move;
        faceToward(a, detAtan2(-hx, -hz), dt);
    }

    /** XZ disk around the attacker — ground and air, not allies / extras.
     * The locked focus always connects within engagement reach even when the
     * splash disk is smaller (ogre: tight cleave, strong single-target smash). */
    private cleaveStrike(a: Actor, radius: number, damage: number, focus: Actor): void {
        const team = actorTeam(a);
        const hits: Actor[] = [];
        for (const t of this.actors) {
            if (!t.alive || t === a) continue;
            if (t.unit.type.extra) continue;
            if (actorTeam(t) === team) continue;
            const reach = radius + a.radius + t.radius;
            if (hypot(t.x - a.x, t.z - a.z) <= reach) hits.push(t);
        }
        // Focus can sit outside a small cleave (lunge / ranged spacing) — still smash them.
        if (
            focus.alive &&
            focus !== a &&
            !focus.unit.type.extra &&
            actorTeam(focus) !== team &&
            !hits.includes(focus)
        ) {
            const stats = this.statsOf(a);
            const connectAt = (stats.range + a.radius + focus.radius) * 1.35;
            if (hypot(focus.x - a.x, focus.z - a.z) <= connectAt) hits.unshift(focus);
        }
        for (const t of hits) {
            const dx = t.x - a.x;
            const dz = t.z - a.z;
            if (!this.groundSwatConnects(a, t)) continue;
            this.applyDamage(a.unit, t, damage * this.damageTakenMult(t), { x: dx, z: dz }, 'direct');
            this.applyEmp(a.unit, t);
        }
        const anyGround =
            hits.some((t) => t.altitude === 0) || (focus.alive && focus.altitude === 0);
        if (anyGround) {
            const ground =
                focus.alive && focus.altitude === 0
                    ? focus
                    : (hits.find((t) => t.altitude === 0) ?? focus);
            if (!a.unit.type.freeFlight) this.armMeleeRetreat(a, ground);
        }
        if (a.altitude > 0 && !anyGround) {
            const air =
                focus.alive && focus.altitude > 0
                    ? focus
                    : (hits.find((t) => t.altitude > 0) ?? focus);
            a.stompAt = this.elapsed;
            a.stompAir = true;
            a.stompVictim = air;
            a.stompTx = air.x;
            a.stompTz = air.z;
            a.stompTy = air.footY + air.unit.type.meshScale * 0.55;
            const adx = air.x - a.x;
            const adz = air.z - a.z;
            const ad = hypot(adx, adz) || 1;
            this.events.push({
                kind: 'impact',
                x: air.x,
                y: a.stompTy,
                z: air.z,
                blood: bloodColorOf(air.unit.type),
                flesh: resolveDeathWear(air.unit.type) === 'blood',
                masonry: !!air.unit.type.structure,
                unitTypeId: air.unit.type.structure ? undefined : air.unit.type.id,
                dx: adx / ad,
                dy: 0,
                dz: adz / ad,
                melee: true,
            });
            return;
        }
        this.events.push({
            kind: 'explosion',
            x: a.x,
            y: simGroundHeightAt(a.x, a.z),
            z: a.z,
            radius,
            heavy: true,
            shake: a.altitude > 0 ? (a.unit.type.cleaveShake ?? 0) : 0,
            scar: a.unit.type.cleaveScar !== false,
        });
        if (a.altitude > 0) {
            a.stompAt = this.elapsed;
            a.stompAir = false;
            a.stompVictim = undefined;
        }
        this.applyFireAt(a.unit, a.x, a.z, radius, this.fireProfileOf(a.unit));
    }

    /** burn DoT + standing in ground fire (both friendly-fire) */
    private stepHazards(dt: number): void {
        this.hazards.tickFire(this.elapsed);
        // burning cells never leave oil behind when the flames go out
        this.hazards.consumeOilUnderFire(this.elapsed);
        this.hazards.igniteOilTouchingFire(this.elapsed);
        const shields = livingShieldDisks(this.actors.map((u) => u.unit));
        for (const a of this.actors) {
            if (!a.alive) continue;

            const underWard = insideAnyShield(a.x, a.z, shields);

            // acid: toxic column at xz — ground and air both corrode (unlike fire/burn).
            // Living wards protect units standing under them (spell / hazard carve).
            if (!underWard && !a.unit.type.structure && this.hazards.hasAcidAt(a.x, a.z)) {
                const dealt = ((a.maxHp * ACID_DPS_PERCENT) / 100) * dt * this.damageTakenMult(a);
                this.applyBurnDamage(a, dealt);
                a.corrodedUntil = this.elapsed + CORRODE_LINGER_SECONDS;
            }

            if (a.altitude > 0) {
                // air: clear any burn that somehow stuck (e.g. landed then took off)
                continue;
            }
            if (a.unit.type.extra) continue;
            if (underWard) {
                // wards quench standing fire / burn DoT while covered
                a.burnUntil = 0;
                a.burnDps = 0;
                continue;
            }

            // standing in fire refreshes burn from cell intensity
            const cellDps = this.hazards.fireDpsAt(a.x, a.z, this.elapsed);
            if (cellDps > 0) {
                const aff = a.unit.type.burn;
                const taken = aff?.takenMult ?? 1;
                if (taken > 0) {
                    applyBurnStatus(a, this.elapsed, cellDps * taken, 0.4);
                }
            }

            if (a.burnUntil > this.elapsed + 1e-9 && a.burnDps > 0) {
                const dealt = a.burnDps * dt * this.damageTakenMult(a);
                // attribute burn kills to nobody's pack XP cleanly — use a
                // synthetic path: damage without a killer pack for XP purposes
                this.applyBurnDamage(a, dealt);
            } else {
                a.burnUntil = 0;
                a.burnDps = 0;
            }
        }
    }

    /** Passive HP regen from regen talents (friendly, non-structure). */
    private stepRegen(dt: number): void {
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            if (this.isSpawning(a)) continue;
            let rate = 0;
            for (const tech of this.techProfiles(a)) {
                if (!tech.regen) continue;
                if (tech.regen.hpPerSecond) rate += tech.regen.hpPerSecond;
                if (tech.regen.maxHpFractionPerSecond) {
                    rate += a.maxHp * tech.regen.maxHpFractionPerSecond;
                }
            }
            if (rate <= 0) continue;
            a.hp = Math.min(a.maxHp, a.hp + rate * dt);
        }
    }

    /** DoT / environmental damage: no pack XP attribution */
    private applyBurnDamage(
        target: Actor,
        amount: number,
        knockDir?: { x: number; z: number },
    ): void {
        if (amount <= 0 || !target.alive) return;
        target.hp -= amount;
        target.hurtTimer = HURT_BAR_SECONDS;
        if (target.spawnUntil > this.elapsed + 1e-9) target.spawnDamaged = true;
        if (target.hp <= 0) this.kill(target, null, amount, knockDir);
    }

    /**
     * Shared blast shove (render-only): stones, ballista splash, meteor, hammer.
     * Alive units get a decaying mesh kick; wrecks get drift / slide.
     */
    private applyBlastImpulse(
        x: number,
        z: number,
        radius: number,
        strength: number,
        shotDir?: { x: number; z: number },
    ): void {
        if (strength <= 0 || radius <= 0) return;
        const r = Math.max(0.5, radius);
        const shields = livingShieldDisks(this.actors.map((a) => a.unit));
        for (const a of this.actors) {
            if (a.unit.type.structure || a.unit.type.extra) continue;
            if (insideAnyShield(a.x, a.z, shields)) continue;
            const dist = hypot(a.x - x, a.z - z);
            const reach = r + a.radius;
            if (dist > reach) continue;
            const t = 1 - dist / reach;
            const power = strength * t * t;
            let nx: number;
            let nz: number;
            if (shotDir && hypot(shotDir.x, shotDir.z) > 1e-6) {
                const len = hypot(shotDir.x, shotDir.z);
                const sx = shotDir.x / len;
                const sz = shotDir.z / len;
                const rx = dist > 1e-6 ? (a.x - x) / dist : sx;
                const rz = dist > 1e-6 ? (a.z - z) / dist : sz;
                nx = sx * 0.65 + rx * 0.35;
                nz = sz * 0.65 + rz * 0.35;
                const nlen = hypot(nx, nz) || 1;
                nx /= nlen;
                nz /= nlen;
            } else if (dist > 1e-6) {
                nx = (a.x - x) / dist;
                nz = (a.z - z) / dist;
            } else {
                nx = 0;
                nz = 1;
            }
            if (a.alive) {
                a.impulseX = (a.impulseX ?? 0) + nx * power;
                a.impulseZ = (a.impulseZ ?? 0) + nz * power;
            } else {
                this.nudgeWreck(a, nx * power, nz * power);
            }
        }
    }

    /** Slide a corpse with a blast (bumps mid-fall drift or settled mesh). */
    private nudgeWreck(a: Actor, dx: number, dz: number): void {
        const fall = a.mesh.userData.deathFall as DeathFallState | undefined;
        if (fall) {
            fall.driftX += dx * 2.2;
            fall.driftZ += dz * 2.2;
            return;
        }
        a.impulseX = (a.impulseX ?? 0) + dx;
        a.impulseZ = (a.impulseZ ?? 0) + dz;
    }

    private emitStuckBolt(
        style: Projectile['style'],
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        attach?: Actor,
        scale?: Projectile['scale'],
    ): void {
        if (style !== 'arrow' && style !== 'largeArrow') return;
        const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        this.events.push({
            kind: 'stuckBolt',
            x,
            y,
            z,
            dx: sx / slen,
            dy: sy / slen,
            dz: sz / slen,
            style,
            scale,
            attachIndex: attach?.index,
        });
    }

    /**
     * March a ballista/arrow ray down onto the lawn for a world-fixed stake.
     * Keeps shot direction so the shaft still reads the lob angle.
     */
    private groundPlantAlongRay(
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
    ): { x: number; y: number; z: number; sx: number; sy: number; sz: number } {
        const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        let dx = sx / slen;
        let dy = sy / slen;
        let dz = sz / slen;
        let px = x;
        let py = y;
        let pz = z;
        // Flat / rising shots: drop from impact xz so the stake still reads
        if (dy > -0.08) {
            dy = Math.min(dy, -0.35);
            const n = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            dx /= n;
            dy /= n;
            dz /= n;
        }
        for (let i = 0; i < 14; i++) {
            const g = simGroundHeightAt(px, pz);
            if (py <= g + 0.12) {
                return { x: px, y: g + 0.08, z: pz, sx: dx, sy: dy, sz: dz };
            }
            const drop = py - g;
            const step = Math.min(4, Math.max(0.2, drop / Math.max(0.08, -dy)));
            px += dx * step;
            py += dy * step;
            pz += dz * step;
        }
        const g = simGroundHeightAt(px, pz);
        return { x: px, y: g + 0.08, z: pz, sx: dx, sy: dy, sz: dz };
    }

    /**
     * Stuck bolt for an impact.
     * Ballista: stakes masonry (structures, like ground) or the lawn — never rides a mobile unit.
     * Archer: sticks to whatever was hit.
     */
    private emitStuckAtImpact(
        style: Projectile['style'],
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        hit?: Actor,
        scale?: Projectile['scale'],
    ): void {
        if (style === 'largeArrow') {
            if (hit?.unit.type.structure) {
                this.emitStuckBolt(style, x, y, z, sx, sy, sz, hit, scale);
                return;
            }
            const plant = this.groundPlantAlongRay(x, y, z, sx, sy, sz);
            this.emitStuckBolt(style, plant.x, plant.y, plant.z, plant.sx, plant.sy, plant.sz, undefined, scale);
            return;
        }
        this.emitStuckBolt(style, x, y, z, sx, sy, sz, hit, scale);
    }

    /** dormant summons materialize one by one at their appearAt time */
    private stepSummonAppearances(): void {
        for (const a of this.actors) {
            if (a.appeared || a.appearAt <= 0 || this.elapsed < a.appearAt) continue;
            a.appeared = true;
            a.alive = true;
            a.mesh.visible = true;
            this.events.push({
                kind: 'summon',
                x: a.x,
                y: a.altitude > 0 ? a.altitude : simGroundHeightAt(a.x, a.z),
                z: a.z,
                flying: a.altitude > 0,
            });
        }
    }

    /** wire parents to pre-placed production children per produce-tech lane */
    private initProductionState(): void {
        const parentById = new Map<number, Unit>();
        for (const a of this.actors) {
            if (a.unit.productionHeld) continue;
            parentById.set(a.unit.id, a.unit);
        }
        const lanesByParent = new Map<
            Unit,
            Map<string, Unit[]>
        >();
        const seen = new Set<Unit>();
        for (const a of this.actors) {
            const u = a.unit;
            if (!u.productionHeld || u.productionParentId == null || !u.productionTechId) continue;
            if (seen.has(u)) continue;
            seen.add(u);
            const parent = parentById.get(u.productionParentId);
            if (!parent) continue;
            let byTech = lanesByParent.get(parent);
            if (!byTech) {
                byTech = new Map();
                lanesByParent.set(parent, byTech);
            }
            let list = byTech.get(u.productionTechId);
            if (!list) {
                list = [];
                byTech.set(u.productionTechId, list);
            }
            list.push(u);
        }
        for (const [parent, byTech] of lanesByParent) {
            const owned = ownedProduceTechs(parent.type, parent.seat, this.config.hasTech, this.config.types);
            const lanes: {
                techId: string;
                interval: number;
                max: number;
                cycleLen: number;
                nextAt: number;
                released: number;
                children: Unit[];
            }[] = [];
            for (const { tech, produce } of owned) {
                const children = (byTech.get(tech.id) ?? []).sort((a, b) => a.id - b.id);
                const delay = produce.delay ?? produce.interval;
                lanes.push({
                    techId: tech.id,
                    interval: produce.interval,
                    max: produce.max,
                    cycleLen: delay,
                    nextAt: BATTLE_START_FREEZE + delay,
                    released: 0,
                    children,
                });
            }
            this.productionLanes.set(parent, lanes);
        }
        // parents that own produce techs but got no children still track (noop)
        for (const a of this.actors) {
            if (a.unit.productionHeld || this.productionLanes.has(a.unit)) continue;
            const owned = ownedProduceTechs(a.unit.type, a.unit.seat, this.config.hasTech, this.config.types);
            if (owned.length === 0) continue;
            this.productionLanes.set(
                a.unit,
                owned.map(({ tech, produce }) => {
                    const delay = produce.delay ?? produce.interval;
                    return {
                        techId: tech.id,
                        interval: produce.interval,
                        max: produce.max,
                        cycleLen: delay,
                        nextAt: BATTLE_START_FREEZE + delay,
                        released: 0,
                        children: [],
                    };
                }),
            );
        }
    }

    /** Cache on-kill spawn specs per pack (innate + researched). */
    private initOnKillState(): void {
        const seen = new Set<Unit>();
        for (const a of this.actors) {
            const u = a.unit;
            if (seen.has(u) || u.productionHeld) continue;
            seen.add(u);
            this.cacheOnKillFor(u);
        }
    }

    private cacheCleaveFor(unit: Unit): void {
        const owned = ownedCleaveTechs(unit.type, unit.seat, this.config.hasTech, this.config.types);
        const fromType = unit.type.cleave?.radius ?? 0;
        const fromTech = owned.length === 0 ? 0 : Math.max(...owned.map(({ cleave }) => cleave.radius));
        const radius = Math.max(fromType, fromTech);
        if (radius > 0) this.cleaveRadiusByUnit.set(unit, radius);
    }

    /** Cleave disk for this body — hex drops researched cleave (keeps type innate). */
    private cleaveRadiusOf(a: Actor): number {
        if (this.isEmpd(a)) return a.unit.type.cleave?.radius ?? 0;
        return this.cleaveRadiusByUnit.get(a.unit) ?? 0;
    }

    /** Cache cleave radii per pack (innate + researched). */
    private initCleaveState(): void {
        const seen = new Set<Unit>();
        for (const a of this.actors) {
            const u = a.unit;
            if (seen.has(u) || u.productionHeld) continue;
            seen.add(u);
            this.cacheCleaveFor(u);
        }
    }

    private cacheOnKillFor(unit: Unit): void {
        const owned = ownedOnKillTechs(unit.type, unit.seat, this.config.hasTech, this.config.types);
        if (owned.length === 0) return;
        this.onKillByUnit.set(
            unit,
            owned.map(({ onKill }) => ({ typeId: onKill.typeId })),
        );
    }

    /**
     * Raise on-kill children queued during {@link kill}. Runs after combat so
     * we never mutate `actors` while a step is iterating it.
     */
    private flushOnKillSpawns(): void {
        const spawn = this.config.spawnOnKill;
        if (!spawn || this.pendingOnKillSpawns.length === 0) {
            this.pendingOnKillSpawns.length = 0;
            return;
        }
        const queued = this.pendingOnKillSpawns.splice(0);
        for (const q of queued) {
            const child = spawn(q.parent, q.typeId, q.x, q.z);
            if (!child) continue;
            this.adoptOnKillChild(child, q.parent, q.x, q.z);
        }
    }

    /** Wire a mid-battle pack into the sim as living actors (summon VFX). */
    private adoptOnKillChild(child: Unit, parent: Unit, x: number, z: number): void {
        if (child.level !== parent.level) {
            child.level = parent.level;
            child.applyLevelLook(child.level);
        }
        child.world.set(x, 0, z);
        child.view.position.set(x, child.world.y, z);
        const stats = this.config.statsOf(child);
        this.resolved.set(child, stats);
        const levelMult = this.levelMult(child);
        const maxHp = stats.hp * levelMult;
        const shieldMax = hasShieldHp(child, this.config.hasTech, this.config.types) ? maxHp : 0;
        const alt = child.pinnedY ?? effectiveFlying(child.type, child.seat, this.config.hasTech, this.config.types);
        let nth = 0;
        const firstActorIdx = this.actors.length;
        for (const m of child.members) {
            const ax = x + m.home.x;
            const az = z + m.home.z;
            const actor: Actor = {
                unit: child,
                mesh: m.mesh,
                x: ax,
                z: az,
                prevX: ax,
                prevZ: az,
                rx: ax,
                rz: az,
                hp: maxHp,
                maxHp,
                shieldHp: shieldMax,
                shieldMaxHp: shieldMax,
                cooldown: (nth % 5) * (stats.attackInterval / 5),
                alive: true,
                radius: child.type.collisionRadius,
                index: this.actors.length,
                hurtTimer: 0,
                altitude: alt,
                prevAltitude: alt,
                footY: alt,
                rocketTarget: null,
                goldenUntil: 0,
                stormDebuffUntil: 0,
                spawnUntil: 0,
                spawnDamaged: false,
                pathDestX: null,
                pathDestZ: null,
                pathNextX: null,
                pathNextZ: null,
                pathRouteId: null,
                pathStuck: 0,
                pathBestDist: Infinity,
                mvX: 0,
                mvZ: 0,
                facing: m.mesh.rotation.y,
                prevFacing: m.mesh.rotation.y,
                cachedEnemy: null,
                approachOx: 0,
                approachOz: 0,
                approachOffsetUntil: 0,
                terrainHinderedAt: -1e9,
                slideFlip: false,
                progressTarget: null,
                progressBest: Infinity,
                progressAt: 0,
                shunTarget: null,
                shunUntil: 0,
                burnUntil: 0,
                burnDps: 0,
                empUntil: 0,
                empSpeedMult: 1,
                corrodedUntil: 0,
                appearAt: 0,
                appeared: true,
                allegiance: null,
                allegianceSeat: child.seat,
                convertTarget: null,
                convertTargets: [],
                convertProgress: 0,
                convertBy: null,
                convertCooldown: 0,
                convertRayTipX: 0,
                convertRayTipY: 0,
                convertRayTipZ: 0,
                convertRayActive: false,
                rampBeamTargets: [],
                rampBeamLockTs: [],
                rampBeamTarget: null,
                meleePendingDamage: 0,
                meleePendingAt: 0,
                meleePendingFocus: 0,
                meleeRetreatGoal: 0,
                flyPassPhase: 0,
                flyPassUntil: 0,
                flyPassHx: 0,
                flyPassHz: -1,
                flyPassStruck: false,
                flyPassTurnYaw: 0,
                flightPitch: 0,
                prevFlightPitch: 0,
            };
            actor.footY = this.feetY(actor);
            this.actors.push(actor);
            m.mesh.visible = true;
            this.events.push({
                kind: 'summon',
                x: ax,
                y: actor.altitude > 0 ? actor.altitude : simGroundHeightAt(ax, az),
                z: az,
                flying: actor.altitude > 0,
            });
            nth++;
        }
        // Abilities apply as soon as the pack exists: a unit raised mid-battle
        // next to a golden ballista picks the aura up, same as one finishing a
        // flank spawn. (Spawn clones are never ballistas today, but grant too
        // if one ever is, so the rule stays symmetric.)
        if (this.goldenAuraApplied) {
            for (let i = firstActorIdx; i < this.actors.length; i++) {
                const na = this.actors[i]!;
                this.applyGoldenAura(na);
                if (na.unit.type.aura) {
                    this.applyGoldenAura(undefined, na);
                }
            }
        }
        this.cacheOnKillFor(child);
        this.cacheCleaveFor(child);
    }

    /**
     * HUD: progress through the current produce cycle for a pack's tech.
     * `progress` is 0..1 toward the next spawn (1 = done / about to fire).
     */
    productionProgress(
        unit: Unit,
        techId: string,
    ): {
        progress: number;
        released: number;
        max: number;
        done: boolean;
    } | null {
        const lanes = this.productionLanes.get(unit);
        const lane = lanes?.find((l) => l.techId === techId);
        if (!lane) return null;
        if (lane.released >= lane.max) {
            return { progress: 1, released: lane.released, max: lane.max, done: true };
        }
        const remaining = Math.max(0, lane.nextAt - this.elapsed);
        const cycle = Math.max(1e-6, lane.cycleLen);
        const progress = Math.min(1, Math.max(0, 1 - remaining / cycle));
        return {
            progress: Math.round(progress * 100) / 100,
            released: lane.released,
            max: lane.max,
            done: false,
        };
    }

    /**
     * Produce-tech releases: while a parent pack is alive, release one held
     * child per owned produce lane every `interval` (up to `max`), relocated
     * to the parent's current spot. Offspring already carry parent level.
     */
    private stepProductionReleases(): void {
        for (const [parent, lanes] of this.productionLanes) {
            // one scan: the parent must be alive AND done spawning — a parent
            // still riding in on the flank produces nothing yet
            let parentReady = false;
            for (const a of this.actors) {
                if (a.unit !== parent || !a.alive) continue;
                if (this.isSpawning(a)) {
                    parentReady = false;
                    break;
                }
                parentReady = true;
            }
            if (!parentReady) continue;
            for (const lane of lanes) {
                if (lane.released >= lane.max) continue;
                if (this.elapsed < lane.nextAt) continue;
                const child = lane.children[lane.released];
                if (!child || !child.productionHeld) {
                    lane.released++;
                    lane.cycleLen = lane.interval;
                    lane.nextAt += lane.interval;
                    continue;
                }
                // keep level in sync if parent somehow changed
                if (child.level !== parent.level) {
                    child.level = parent.level;
                    child.applyLevelLook(child.level);
                }
                this.releaseProductionChild(parent, child);
                lane.released++;
                lane.cycleLen = lane.interval;
                lane.nextAt += lane.interval;
            }
        }
    }

    private releaseProductionChild(parent: Unit, child: Unit): void {
        const parentActor = this.actors.find((a) => a.unit === parent && a.alive);
        if (!parentActor) return;
        const ang = (((child.id * 2654435761) >>> 0) * (Math.PI * 2)) / 4294967296;
        const radius = 3.2 + (child.id % 5) * 0.55;
        const cx = parentActor.x + detCos(ang) * radius;
        const cz = parentActor.z + detSin(ang) * radius;
        child.productionHeld = false;
        child.marchIn = parent.marchIn;
        child.world.set(cx, 0, cz);
        // view is the scene root — syncMeshes only offsets member meshes from
        // unit.world, so without this the brood pops at the deploy park spot
        child.view.position.set(cx, child.world.y, cz);
        const levelMult = this.levelMult(child);
        const stats = this.resolved.get(child);
        for (const a of this.actors) {
            if (a.unit !== child) continue;
            a.x = cx;
            a.z = cz;
            a.prevX = cx;
            a.prevZ = cz;
            a.rx = cx;
            a.rz = cz;
            // refresh HP for inherited level (stats snapshotted at battle start)
            if (stats) {
                a.maxHp = stats.hp * levelMult;
                a.hp = a.maxHp;
                // shield tracks max HP; a shieldless pack stays at 0
                if (a.shieldMaxHp > 0) {
                    a.shieldMaxHp = a.maxHp;
                    a.shieldHp = a.maxHp;
                }
            }
            a.appeared = true;
            a.alive = true;
            a.mesh.visible = true;
            a.footY = this.feetY(a);
            this.events.push({
                kind: 'summon',
                x: a.x,
                y: a.altitude > 0 ? a.altitude : simGroundHeightAt(a.x, a.z),
                z: a.z,
                flying: a.altitude > 0,
            });
        }
    }

    /** acid debuff from Webweaver / Spinne hits — player armies only */
    private applyCorrodeOnHit(source: Unit, hit: Actor): void {
        const spec = source.type.corrodeOnHit;
        if (!spec) return;
        if (actorTeam(hit) === 'horde') return;
        hit.corrodedUntil = Math.max(hit.corrodedUntil, this.elapsed + spec.seconds);
    }

    /** advances every scheduled spell effect whose time has come: one-shot
     *  strikes/ignites (exactly once each), plus zone ticks */
    private stepSpellStrikes(): void {
        for (const s of this.strikes) {
            if (s.fired || this.elapsed < s.at) continue;
            s.fired = true;
            this.resolveStrike(s);
        }
        for (const z of this.zones) {
            // fixed-step ticks: identical on both peers regardless of frame rate
            while (z.nextAt <= this.elapsed && z.nextAt <= z.endAt) {
                const tickAt = z.nextAt;
                z.nextAt += z.interval;
                this.tickSpellZone(z, tickAt);
            }
        }
        for (const m of this.pendingMeteors) {
            if (m.fired || this.elapsed < m.at) continue;
            m.fired = true;
            this.resolveMeteorImpact(m);
        }
        for (const f of this.ignites) {
            if (f.fired || this.elapsed < f.at) continue;
            f.fired = true;
            this.resolveIgnite(f);
        }
    }

    /** expand each oil/acid capsule into overlapping drip landings along the spine */
    private buildHazardDrips(pours: readonly HazardPour[]): void {
        for (const pour of pours) {
            const dx = pour.x2 - pour.x;
            const dz = pour.z2 - pour.z;
            const len = hypot(dx, dz);
            const step = pour.radius * 0.55;
            const steps = Math.max(1, Math.ceil(len / Math.max(step, 1e-6)));
            const pourStart = BATTLE_START_FREEZE + pour.delaySeconds;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const fallSec = pour.fallSeconds ?? HAZARD_DRIP_FALL_SEC;
                const landAt = pourStart + t * pour.durationSeconds + fallSec;
                this.drips.push({
                    kind: pour.kind,
                    x: pour.x + dx * t,
                    z: pour.z + dz * t,
                    radius: pour.radius,
                    expiresRound: pour.expiresRound,
                    burnSeconds: pour.burnSeconds ?? 0,
                    intensity: pour.intensity ?? 0,
                    damage: pour.damage ?? 0,
                    tint: pour.tint ?? FIRE_TINT_NORMAL,
                    fallStart: landAt - fallSec,
                    landAt,
                    announced: false,
                    stamped: false,
                    /** skip air-drip VFX when fall is instant (dragon ray) */
                    silent: fallSec <= 1e-6,
                });
            }
        }
    }

    /** announce falling drips, then stamp each disc on impact (wards block) */
    private stepHazardDrips(): void {
        const shields = livingShieldDisks(this.actors.map((a) => a.unit));
        for (const d of this.drips) {
            if (!d.announced && this.elapsed >= d.fallStart) {
                d.announced = true;
                if (!d.silent) {
                    this.events.push({
                        kind: 'hazardDrip',
                        hazard: d.kind,
                        x: d.x,
                        z: d.z,
                        at: d.landAt,
                        dripScale: d.dripScale,
                        dripLean: d.dripLean,
                    });
                }
            }
            if (d.stamped || this.elapsed < d.landAt) continue;
            d.stamped = true;
            if (d.kind === 'oil') {
                this.hazards.stampOil(d.x, d.z, d.radius, d.expiresRound, shields, this.elapsed);
            } else if (d.kind === 'acid') {
                this.hazards.stampAcid(d.x, d.z, d.radius, d.expiresRound, shields);
            } else {
                const oilCells = this.hazards.stampFire(
                    d.x,
                    d.z,
                    d.radius,
                    this.elapsed,
                    d.burnSeconds,
                    d.intensity,
                    shields,
                    d.tint,
                );
                this.events.push({
                    kind: 'groundFire',
                    x: d.x,
                    y: simGroundHeightAt(d.x, d.z),
                    z: d.z,
                    radius: d.radius,
                    oilCells,
                    tint: d.tint,
                });
                if (d.damage > 0) {
                    this.applySpellDiscDamage(d.x, d.z, d.radius, d.damage);
                }
            }
        }
    }

    /** dragon breath: stamp overlapping fire circles along the capsule spine */
    private resolveIgnite(f: SpellIgnite): void {
        const dx = f.x2 - f.x;
        const dz = f.z2 - f.z;
        const len = hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(len / (f.radius * 0.7)));
        const shields = livingShieldDisks(this.actors.map((a) => a.unit));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = f.x + dx * t;
            const pz = f.z + dz * t;
            const oilCells = this.hazards.stampFire(
                px,
                pz,
                f.radius,
                this.elapsed,
                f.burnSeconds,
                f.intensity,
                shields,
            );
            // one visual burst per stamp keeps the sweep readable
            this.events.push({
                kind: 'groundFire',
                x: px,
                y: simGroundHeightAt(px, pz),
                z: pz,
                radius: f.radius,
                oilCells,
            });
        }
        this.hazards.igniteOilTouchingFire(this.elapsed);
    }

    /** one tick of a storm / meteor shower / acid-rain zone (all point-targeted) */
    private tickSpellZone(z: (typeof this.zones)[number], tickAt: number): void {
        if (z.mode === 'storm') {
            // aim at a random unit inside; splash debuffs a disc around the strike
            const candidates = this.actors.filter(
                (a) =>
                    a.alive &&
                    !a.unit.type.extra &&
                    hypot(a.x - z.x, a.z - z.z) <= z.radius,
            );
            if (candidates.length === 0) return;
            const target = candidates[Math.floor(z.rng() * candidates.length)]!;
            const dome = this.actors.find(
                (d) =>
                    d.alive &&
                    d.unit.type.shield &&
                    hypot(target.x - d.x, target.z - d.z) <= d.unit.type.shield.radius,
            );
            if (dome) {
                // wards block the strike — no unit debuff
                this.events.push({
                    kind: 'impact',
                    x: dome.x,
                    y: 3,
                    z: dome.z,
                    ward: true,
                    scar: false,
                });
                this.events.push({ kind: 'spellLightning', x: dome.x, y: 3, z: dome.z });
            } else {
                const splash = z.impactRadius ?? 0;
                for (const a of this.actors) {
                    if (!a.alive || a.unit.type.extra || a.unit.type.structure) continue;
                    if (hypot(a.x - target.x, a.z - target.z) > splash + a.radius) continue;
                    // units under a ward at the splash edge are still protected
                    const underWard = this.actors.some(
                        (d) =>
                            d.alive &&
                            d.unit.type.shield &&
                            hypot(a.x - d.x, a.z - d.z) <= d.unit.type.shield.radius,
                    );
                    if (underWard) continue;
                    this.applyStormDebuff(a);
                }
                this.events.push({
                    kind: 'spellLightning',
                    x: target.x,
                    y: target.footY + 0.8,
                    z: target.z,
                });
            }
            return;
        }
        if (z.mode === 'meteorShower') {
            // one small strike at a random spot inside, igniting the ground.
            // Rejection sampling instead of cos/sin: transcendental results
            // differ between engines and this position enters the sim state.
            let ox = 0;
            let oz = 0;
            for (let tries = 0; tries < 16; tries++) {
                const cx = (z.rng() * 2 - 1) * z.radius;
                const cz = (z.rng() * 2 - 1) * z.radius;
                if (cx * cx + cz * cz <= z.radius * z.radius) {
                    ox = cx;
                    oz = cz;
                    break;
                }
            }
            const px = z.x + ox;
            const pz = z.z + oz;
            const impactAt = tickAt + METEOR_SHARD_FALL_SEC;
            // visual starts now; strike + ground fire resolve when the shard lands
            this.events.push({ kind: 'spellMeteor', x: px, z: pz, at: impactAt });
            this.pendingMeteors.push({
                at: impactAt,
                x: px,
                z: pz,
                radius: z.impactRadius ?? 4,
                damage: z.damage,
                igniteRadius: z.igniteRadius,
                fired: false,
            });
            return;
        }
        if (z.mode === 'acidRain') {
            // Several small acid drips per tick — sparse puddles over a huge circle.
            const drops = Math.max(1, z.dropsPerTick ?? 1);
            const puddleR = z.impactRadius ?? 2;
            const expires =
                z.acidExpiresRound ?? this.config.oilExpiresRound ?? 9999;
            const fallSec = HAZARD_DRIP_FALL_SEC;
            for (let d = 0; d < drops; d++) {
                let ox = 0;
                let oz = 0;
                for (let tries = 0; tries < 16; tries++) {
                    const cx = (z.rng() * 2 - 1) * z.radius;
                    const cz = (z.rng() * 2 - 1) * z.radius;
                    if (cx * cx + cz * cz <= z.radius * z.radius) {
                        ox = cx;
                        oz = cz;
                        break;
                    }
                }
                const landAt = tickAt + fallSec;
                this.drips.push({
                    kind: 'acid',
                    x: z.x + ox,
                    z: z.z + oz,
                    radius: puddleR,
                    expiresRound: expires,
                    burnSeconds: 0,
                    intensity: 0,
                    damage: 0,
                    tint: FIRE_TINT_NORMAL,
                    fallStart: tickAt,
                    landAt,
                    announced: false,
                    stamped: false,
                    silent: false,
                    dripScale: 0.48,
                    dripLean: 0.8,
                });
            }
            return;
        }
    }

    /** meteor-shower land: splash damage (wards apply) + ground fire */
    private resolveMeteorImpact(m: {
        x: number;
        z: number;
        radius: number;
        damage: number;
        igniteRadius?: number;
    }): void {
        this.resolveStrike({
            x: m.x,
            z: m.z,
            radius: m.radius,
            damage: m.damage,
            delaySeconds: 0,
            fx: 'shower',
        });
        const shields = livingShieldDisks(this.actors.map((a) => a.unit));
        if (insideAnyShield(m.x, m.z, shields)) return;
        if (m.igniteRadius) {
            const oilCells = this.hazards.stampFire(
                m.x,
                m.z,
                m.igniteRadius,
                this.elapsed,
                3,
                12,
                shields,
                FIRE_TINT_NOSCAR,
            );
            this.events.push({
                kind: 'groundFire',
                x: m.x,
                y: simGroundHeightAt(m.x, m.z),
                z: m.z,
                radius: m.igniteRadius,
                oilCells,
                tint: FIRE_TINT_NOSCAR,
                scar: false,
            });
        }
    }

    /**
     * One area strike: everything in the blast takes environmental damage
     * (both teams, air included) — except targets under a living ward dome.
     * Each dome involved eats the strike damage ONCE and can break.
     * A strike with a `rect` (hammer) uses that rectangle (same as the ground
     * scar) for both ground and air; other strikes use a circle.
     * Strikes whose impact point lies inside a ward disc are absorbed at the
     * roof (meteors / hammers do not pass through).
     */
    private resolveStrike(s: SpellStrike): void {
        const domes = this.actors.filter((a) => a.alive && a.unit.type.shield);
        const intercept = domes.find(
            (d) =>
                hypot(s.x - d.x, s.z - d.z) <= d.unit.type.shield!.radius,
        );
        if (intercept) {
            intercept.hp -= s.damage;
            intercept.hurtTimer = HURT_BAR_SECONDS;
            if (intercept.hp <= 0) this.breakShield(intercept);
            this.events.push({
                kind: 'impact',
                x: intercept.x,
                y: 3,
                z: intercept.z,
                ward: true,
                scar: false,
            });
            return;
        }
        const y = simGroundHeightAt(s.x, s.z);
        const hammer = s.fx === 'hammer';
        const bigMeteor = s.fx === 'meteor';
        const meteorShower = s.fx === 'shower';
        const rect = s.rect;
        // particles: cover a rectangular footprint (approx half-diagonal)
        const visualRadius = rect
            ? Math.sqrt(rect.halfWidth * rect.halfWidth + rect.halfDepth * rect.halfDepth)
            : s.radius;
        this.events.push({
            kind: 'explosion',
            x: s.x,
            y: y + 0.6,
            z: s.z,
            radius: visualRadius,
            // both big stamps throw the heavier dust; only the big meteor burns
            heavy: hammer || bigMeteor,
            fire: bigMeteor,
            shake: bigMeteor ? 1 : 0,
            // Meteors: VFX only — no permanent wear scorch (hammer still scars).
            scar: bigMeteor || meteorShower ? false : undefined,
            rect: rect
                ? {
                      // scar = hit zone — ground + air damage use the same rect
                      halfWidth: rect.halfWidth,
                      halfDepth: rect.halfDepth,
                      yaw: s.yaw ?? 0,
                  }
                : undefined,
        });
        if (hammer) {
            this.crushingHammer = true;
            this.applySpellDiscDamage(s.x, s.z, s.radius, s.damage, s);
            this.crushingHammer = false;
            const halfWidth = rect?.halfWidth ?? s.radius;
            const halfDepth = rect?.halfDepth ?? s.radius;
            const yaw = s.yaw ?? 0;
            const flattenY = this.sampleHammerFlattenY(s.x, s.z, halfWidth, halfDepth, yaw);
            // the ground under the hammer is pressed flat now, in this step —
            // from here on every unit walks and shoots on the flattened board
            this.config.terrain?.flattenRect(s.x, s.z, halfWidth, halfDepth, yaw, flattenY);
            this.events.push({ kind: 'hammerCrush', x: s.x, z: s.z, halfWidth, halfDepth, yaw, flattenY });
            // No blast shove — impulse was sliding pancakes (and their meshes)
            // outside the scar while blood stayed at the kill seat.
        } else {
            this.applySpellDiscDamage(s.x, s.z, s.radius, s.damage, s);
            this.applyBlastImpulse(s.x, s.z, visualRadius, bigMeteor ? 2.6 : 1.5);
        }
    }

    /** Mean board height in the hammer footprint — deterministic flatten target. */
    private sampleHammerFlattenY(
        cx: number,
        cz: number,
        halfW: number,
        halfD: number,
        yaw: number,
    ): number {
        const c = detCos(yaw);
        const s = detSin(yaw);
        let sum = 0;
        let n = 0;
        const stepsW = 6;
        const stepsD = 8;
        for (let iw = 0; iw <= stepsW; iw++) {
            for (let id = 0; id <= stepsD; id++) {
                const lx = -halfW + (halfW * 2 * iw) / stepsW;
                const lz = -halfD + (halfD * 2 * id) / stepsD;
                const x = cx + lx * c - lz * s;
                const z = cz + lx * s + lz * c;
                sum += simGroundHeightAt(x, z);
                n++;
            }
        }
        return n > 0 ? sum / n : simGroundHeightAt(cx, cz);
    }

    /**
     * Direct disc (or strike footprint) damage with Meteor shield rules:
     * units under a living ward are spared; the dome takes the hit instead.
     * Pass `strike` for hammer rectangles / exact strike hit tests; otherwise
     * a plain circle of `radius` around (x, z) is used (dragon breath drips).
     * Hits ground and air — the breath beam is a column, not ground-fire.
     * Lingering ground flame still ignores air via {@link applyBurn}.
     */
    private applySpellDiscDamage(
        x: number,
        z: number,
        radius: number,
        damage: number,
        strike?: SpellStrike,
    ): void {
        if (damage <= 0) return;
        const domes = this.actors.filter((a) => a.alive && a.unit.type.shield);
        const hitDomes = new Set<Actor>();
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.extra) continue;
            const inArea = strike
                ? strikeHits(strike, a.x, a.z, a.radius)
                : hypot(a.x - x, a.z - z) <= radius + a.radius;
            if (!inArea) continue;
            const dome = domes.find(
                (d) => hypot(a.x - d.x, a.z - d.z) <= d.unit.type.shield!.radius,
            );
            if (dome) {
                hitDomes.add(dome);
                continue;
            }
            this.applyBurnDamage(a, damage, { x: a.x - x, z: a.z - z });
        }
        for (const d of domes) {
            const domeHit = strike
                ? strikeHits(strike, d.x, d.z, 0)
                : hypot(d.x - x, d.z - z) <= radius;
            if (domeHit) hitDomes.add(d);
        }
        for (const d of hitDomes) {
            d.hp -= damage;
            d.hurtTimer = HURT_BAR_SECONDS;
            if (d.hp <= 0) this.breakShield(d);
        }
    }

    /**
     * Debug/cheat: kill every living actor a predicate picks, through the same
     * `kill` a real blow uses — so a Stronghold dropped this way still runs the
     * lifeline wipe, the collapse shockwave and every death that follows.
     *
     * Not an action and not logged: single-player only, and calling it in a
     * networked match would desync the moment the peer replayed without it.
     */
    cheatDestroy(pick: (unit: Unit) => boolean): void {
        for (const a of this.actors) {
            if (!a.alive || !pick(a.unit)) continue;
            this.kill(a, null, a.maxHp);
        }
    }

    /** far corner of the board from here — where a front stops mattering */
    private collapseReach(x: number, z: number): number {
        const hw = this.config.boardHalfW ?? 200;
        const hh = this.config.boardHalfZ ?? 200;
        return (
            Math.max(
                hypot(x + hw, z + hh),
                hypot(x - hw, z + hh),
                hypot(x + hw, z - hh),
                hypot(x - hw, z - hh),
            ) * 1.05
        );
    }

    /**
     * Advance every collapse front and kill what it has reached. Radius is read
     * off the sim clock, not accumulated per step, so a client that ran its
     * steps in a different rhythm still kills the same packs at the same tick.
     */
    private stepCollapseFronts(): void {
        for (let i = this.collapseFronts.length - 1; i >= 0; i--) {
            const f = this.collapseFronts[i]!;
            const radius = (this.elapsed - f.startedAt) * COLLAPSE_SPEED;
            if (radius >= f.maxRadius) {
                this.collapseFronts.splice(i, 1);
                continue;
            }
            for (const a of this.actors) {
                if (!a.alive) continue;
                // its own side, and the horde with it: this is a keep's worth of
                // masonry going outward, and the besiegers are standing in it.
                // An enemy army keeps its own Stronghold's fate to itself.
                if (actorTeam(a) !== f.team && actorTeam(a) !== 'horde') continue;
                const dx = a.x - f.x;
                const dz = a.z - f.z;
                if (hypot(dx, dz) > radius) continue; // the front has not arrived
                const len = hypot(dx, dz) || 1;
                const away = { x: dx / len, z: dz / len };
                if (a.unit.type.shield) {
                    // A Ward Stone has no colliders — nothing can shoot it, and
                    // its only end is its pool running out. Take that path
                    // rather than kill(), or the dome is left hanging over a
                    // pylon that has already fallen.
                    this.breakShield(a);
                    continue;
                }
                if (a.unit.type.structure) {
                    // the base goes down with the keep. Towers topple away from
                    // it, but a razed tower is not one an enemy brought down:
                    // razed, so it leaves its side no parting debuff.
                    this.kill(a, null, a.maxHp * COLLAPSE_OVERKILL, away, false, true);
                    continue;
                }
                this.kill(a, null, a.maxHp * COLLAPSE_OVERKILL, away, true);
                // and keeps sliding — the same corpse impulse a blast applies
                a.impulseX = away.x * COLLAPSE_SHOVE;
                a.impulseZ = away.z * COLLAPSE_SHOVE;
            }
        }
    }

    /** hands the accumulated visual events to the renderer and forgets them */
    consumeEvents(): SimEvent[] {
        const drained = this.events;
        this.events = [];
        return drained;
    }

    /** living/total mechs per unit (structures excluded) — the end-of-battle scoring input */
    unitSurvivors(): Map<Unit, { alive: number; total: number }> {
        const map = new Map<Unit, { alive: number; total: number }>();
        for (const a of this.actors) {
            if (a.unit.type.structure) continue;
            let entry = map.get(a.unit);
            if (!entry) {
                entry = { alive: 0, total: 0 };
                map.set(a.unit, entry);
            }
            entry.total++;
            if (a.alive) entry.alive++;
        }
        return map;
    }

    /**
     * Steps processed in a single update() call are capped so a huge
     * backlog (a tab returning from being backgrounded/throttled for a
     * while) can't block the main thread trying to catch up all at once —
     * whatever's left over stays in the accumulator for the NEXT call.
     * ~13s of sim time per real frame is generous headroom over anything
     * a normal frame budget would ever need to actually catch up within.
     */
    private static readonly MAX_STEPS_PER_UPDATE = 400;

    update(dtSeconds: number): void {
        const profiling = this.profileEnabled;
        if (profiling) {
            this.lastProfile = {};
            this.lastProfileSteps = 0;
        }
        // The FULL dt is retained — never discarded. A previous version
        // clamped the INPUT here (Math.min(dtSeconds, 0.25)), which
        // silently and PERMANENTLY dropped any time beyond that per call.
        // That's not just "catching up slowly": a client that hits this
        // (a backgrounded/throttled tab — a passive spectator tab left
        // unfocused is the common case, but any client's tab losing focus
        // or the OS deprioritizing it counts) ends up processing FEWER
        // total fixed steps over the battle's lifetime than one that
        // never dropped frames, since the lost time is never made up —
        // producing a genuinely different, wrong final result instead of
        // just a delayed-but-identical one. See PixiJS ticker's own
        // default minFPS=10 clamp (also disabled, in game.ts) for the
        // other half of this — both layers were discarding time.
        this.accumulator += dtSeconds;
        let steps = 0;
        while (this.accumulator >= BattleSim.STEP && steps < BattleSim.MAX_STEPS_PER_UPDATE) {
            this.accumulator -= BattleSim.STEP;
            steps++;
            // stop EXACTLY at the deciding step — overshooting by a frame's
            // worth of steps would let peers diverge on the survivors
            if (this.finished) break;
            this.step(BattleSim.STEP);
        }
        if (profiling) this.lastProfileSteps = steps;
    }

    /** Command Tower or Research Center specifically — NOT Stronghold, and
     *  NOT any other non-extra structure. Only these two trigger the
     *  tower-destruction debuff; Stronghold loss is a separate, currently
     *  undecided penalty (deliberately no debuff of its own for now). */
    private isDebuffBuilding(unit: Unit): boolean {
        return unit.type.onDestroyed?.seatDebuff === true;
    }

    /** seconds of debuff from losing a command tower at the given level */
    private debuffSecondsForTowerLevel(level: number): number {
        const { baseSeconds, stepSeconds } =
            this.config.towers.debuffDuration ?? DEFAULT_SETTINGS.towers.debuffDuration;
        return Math.max(0, baseSeconds - (level - 1) * stepSeconds);
    }

    /** Extends (or starts) THIS SEAT's own debuff window — never a
     *  teammate's, even though the lost building's fall is visible to the
     *  whole match. Stacks time if already active: each building lost adds
     *  its own full duration on top (unchanged from before — no longer
     *  divided by building count, since the effect no longer scales with
     *  how many are down at once; see {@link debuff}). */
    private extendSeatDebuff(seat: SeatId, towerLevel: number): void {
        const add = this.debuffSecondsForTowerLevel(towerLevel);
        this.debuffUntil.set(seat, Math.max(this.debuffUntil.get(seat) ?? 0, this.elapsed) + add);
    }

    /** tower-destruction or storm-bolt debuff is active for this mech right now.
     *  Seat tower loss affects the whole combat seat ({@link actorSeat} — so a
     *  converted mech follows its new owner, not the deploy seat); storm bolts
     *  are personal. Golden / Sunward shrug both off. */
    private isDebuffed(actor: Actor): boolean {
        // cheap timers first — the immunity check walks talents, and most mechs aren't debuffed at all
        const storm = actor.stormDebuffUntil > this.elapsed + 1e-9;
        if (!storm && this.elapsed >= (this.debuffUntil.get(actorSeat(actor)) ?? 0) - 1e-9) return false;
        return !this.isDebuffImmune(actor);
    }

    /** refresh personal storm debuff (same multipliers as tower loss) */
    private applyStormDebuff(actor: Actor): void {
        if (this.isDebuffImmune(actor) || actor.unit.type.structure || actor.unit.type.extra) return;
        actor.stormDebuffUntil = Math.max(actor.stormDebuffUntil, this.elapsed + STORM_DEBUFF_SEC);
    }

    /** flat tower-destruction multiplier — only while the debuff timer runs.
     *  Doesn't matter how many of this seat's own buildings are down at
     *  once, or simultaneously with the last: the effect is the same fixed
     *  value the whole time the window is open. */
    private debuff(actor: Actor, mult: number): number {
        return this.isDebuffed(actor) ? mult : 1;
    }

    /** incoming damage: golden = −30%; tower debuff only while its timer runs;
     *  the acid corroded debuff stacks on top of everything */
    private damageTakenMult(actor: Actor): number {
        let factor: number;
        if (this.isGolden(actor)) {
            factor = GOLDEN_DAMAGE_TAKEN_MULT;
        } else if (!this.isDebuffed(actor)) {
            factor = 1;
        } else {
            factor = this.config.towers.debuffPerLostTower.damageTakenMult;
        }
        if (actor.corrodedUntil > this.elapsed) factor *= CORRODE_TAKEN_MULT;
        return factor;
    }

    /** Sunstone rune or a recent golden-aura buff (−30% taken, convert→damage, full shrug). */
    isGolden(actor: Actor): boolean {
        for (const id of actor.unit.items) {
            if (this.config.types.rune(id)?.debuffImmune) return true;
        }
        return actor.goldenUntil > this.elapsed + 1e-9;
    }

    /**
     * Hex / tower / storm shrug — golden pack, or a talent with `debuffImmune`
     * (Sunward: immunity only, no damage cut / convert block).
     */
    private isDebuffImmune(actor: Actor): boolean {
        if (this.isGolden(actor)) return true;
        for (const tech of this.config.types.talentsOf(actor.unit.type)) {
            if (!tech.debuffImmune) continue;
            // Seat research, not actorHasTech — hex must never strip this shield.
            if (this.config.hasTech(actor.unit.seat, actor.unit.type.id, tech.id)) return true;
        }
        return false;
    }

    /**
     * one-shot at {@link GOLDEN_AURA_APPLY_AT}: allies within a source's `aura.radius` turn golden for `aura.duration`.
     *
     * `windowOnly` caps the buff at the opening window instead of running a
     * fresh 30s from now. Conversion uses it: a mech that switches sides
     * mid-battle joins a team whose aura is (or soon will be) spent, and a full
     * new window made it the only debuff-immune, −30%-damage unit on the field.
     */
    private applyGoldenAura(recipient?: Actor, caster?: Actor, windowOnly = false): void {
        for (const f of this.actors) {
            if (caster && f !== caster) continue;
            const aura = f.unit.type.aura;
            if (!f.alive || aura?.effect !== 'golden') continue;
            // a source still riding in grants nothing until it has landed
            if (this.isSpawning(f)) continue;
            // the tech of whoever commands the source NOW (a converted one
            // follows its new owner, like the tower debuffs do)
            if (aura.requiresTech && !this.config.hasTech(actorSeat(f), f.unit.type.id, aura.requiresTech)) {
                continue;
            }
            // duration runs from NOW, so a flank unit that arrives late still gets
            // its full buff instead of the remainder of the opening window
            const expires = windowOnly
                ? Math.min(this.elapsed + aura.duration, GOLDEN_AURA_APPLY_AT + aura.duration)
                : this.elapsed + aura.duration;
            if (expires <= this.elapsed) continue;
            const r2 = aura.radius * aura.radius;
            for (const a of this.actors) {
                if (recipient && a !== recipient) continue;
                if (!a.alive || actorTeam(a) !== actorTeam(f) || a.unit.type.structure) continue;
                // and a unit still spawning can't receive it yet — it picks the
                // aura up when its own spawn completes (see updateFlankSpawning)
                if (this.isSpawning(a)) continue;
                const dx = a.x - f.x;
                const dz = a.z - f.z;
                if (dx * dx + dz * dz <= r2) a.goldenUntil = Math.max(a.goldenUntil, expires);
            }
        }
    }

    /** golden tint on golden mechs; wild color shift while tower debuff timer runs.
     *  `debuffTintAt` gates the psychedelic tint only (stats stay immediate) — used
     *  so the shockwave rim can “reveal” the look as it sweeps.
     *  Returns air-crash landings that finished this frame (render-only VFX hooks). */
    syncBattleVisuals(
        timeSeconds: number,
        debuffTintAt?: (seat: SeatId, x: number, z: number) => boolean,
    ): CrashLand[] {
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            // golden > hex > tower debuff > acid (corroded) > burn DoT > spawning
            let tint: 'normal' | 'golden' | 'hex' | 'debuff' | 'acid' | 'burn' | 'spawning' = 'normal';
            let spawnProgress = 0;
            if (this.isGolden(a)) tint = 'golden';
            else if (this.isEmpd(a)) tint = 'hex';
            else if (this.isDebuffed(a) && (debuffTintAt?.(actorSeat(a), a.x, a.z) ?? true)) {
                tint = 'debuff';
            } else if (a.corrodedUntil > this.elapsed) {
                tint = 'acid';
            } else if (a.burnUntil > this.elapsed && a.burnDps > 0) {
                tint = 'burn';
            } else if (this.isSpawning(a)) {
                tint = 'spawning';
                spawnProgress = this.spawnProgress(a);
            }
            syncBattleTint(a.mesh, tint, timeSeconds, 1, spawnProgress);
            this.animateActor(a, timeSeconds);
        }
        // Dead wrecks: air units tumble first; settled corpses stay glued to terrain
        const crashLands: CrashLand[] = [];
        for (const a of this.actors) {
            if (a.alive || a.unit.type.structure) continue;
            const fall = a.mesh.userData.deathFall as DeathFallState | undefined;
            const tip = a.mesh.userData.deathTip as DeathTipState | undefined;
            const deathClip = a.mesh.userData.deathClip as DeathClipState | undefined;
            if (fall) {
                if (!tickDeathFall(a.mesh, fall, timeSeconds, (wx, wz) => worldHeightAt(wx, wz) + GROUND_UNIT_Y)) {
                    crashLands.push(crashLandFromFall(fall));
                    settleCorpsePose(a.mesh);
                    clearDeathFall(a.mesh);
                }
            } else if (tip) {
                if (!tickDeathTip(a.mesh, tip, timeSeconds)) {
                    settleCorpsePose(a.mesh);
                    clearDeathTip(a.mesh);
                }
            } else if (deathClip) {
                const wx = a.unit.world.x + a.mesh.position.x;
                const wz = a.unit.world.z + a.mesh.position.z;
                deathClip.groundY = worldHeightAt(wx, wz) + GROUND_UNIT_Y;
                if (!tickDeathClip(a.mesh, deathClip, timeSeconds)) {
                    // Flat from the clip; hills only via alignSettledCorpse.
                    a.mesh.userData.corpseTipX = 0;
                    a.mesh.userData.corpseTipZ = 0;
                    a.mesh.userData.corpseSettled = true;
                    clearDeathClip(a.mesh);
                }
            } else if (a.mesh.userData.hammerCrushed) {
                // Keep the 4% pancake on the lawn (not sunk like standing feet)
                const wx = a.unit.world.x + a.mesh.position.x;
                const wz = a.unit.world.z + a.mesh.position.z;
                const gy = worldHeightAt(wx, wz) + HAMMER_CRUSH_SEAT_Y;
                a.mesh.position.y = gy;
                const crush = a.mesh.userData.buildingCollapse as BuildingCollapseState | undefined;
                if (crush) crush.startY = gy;
            } else {
                // Settled wreck: hug terrain height + slope
                const wx = a.unit.world.x + a.mesh.position.x;
                const wz = a.unit.world.z + a.mesh.position.z;
                alignSettledCorpse(a.mesh, wx, wz, worldHeightAt(wx, wz) + GROUND_UNIT_Y);
            }
            // Settled / tipping wrecks still slide from later blasts — not hammer pancakes
            if (!fall && !deathClip && !a.mesh.userData.hammerCrushed) {
                const ix = a.impulseX ?? 0;
                const iz = a.impulseZ ?? 0;
                if (Math.hypot(ix, iz) > 0.008) {
                    a.mesh.position.x += ix;
                    a.mesh.position.z += iz;
                    a.impulseX = ix * 0.88;
                    a.impulseZ = iz * 0.88;
                } else {
                    a.impulseX = 0;
                    a.impulseZ = 0;
                }
            }
            if (usesWingFlapModel(a.unit.type.modelId ?? a.unit.type.id) && a.mesh.userData.instanced) {
                setCrowWingDeathSplay(
                    a.mesh,
                    crowWingDeathSplay(timeSeconds, fall, tip),
                );
            }
            if (fall || tip || deathClip) continue;
        }
        // Destroyed structures settle into rubble; hammer-crushed units pancake
        for (const a of this.actors) {
            if (a.alive) continue;
            const collapse = a.mesh.userData.buildingCollapse as BuildingCollapseState | undefined;
            if (a.mesh.userData.hammerCrushed) {
                // structures skip the dead-mech loop above — seat pancakes here too
                const wx = a.unit.world.x + a.mesh.position.x;
                const wz = a.unit.world.z + a.mesh.position.z;
                const gy = worldHeightAt(wx, wz) + HAMMER_CRUSH_SEAT_Y;
                if (collapse) collapse.startY = gy;
                else a.mesh.position.y = gy;
            }
            if (!collapse) continue;
            if (!a.unit.type.structure && !a.mesh.userData.hammerCrushed) continue;
            if (!tickBuildingCollapse(a.mesh, collapse, timeSeconds)) {
                clearBuildingCollapse(a.mesh);
            }
        }
        return crashLands;
    }

    /**
     * Procedural, render-only motion layered on the interpolated mesh: a walk
     * bob/sway while moving and a recoil kick when the unit fires. Never touched
     * by the deterministic step — safe to be frame-rate/wall-clock driven.
     */
    private animateActor(a: Actor, timeSeconds: number): void {
        // fire detection: the sim bumps cooldown UP by attackInterval on a shot,
        // otherwise it counts down — so an increase means "just fired".
        const prevCd = a.prevCooldown ?? a.cooldown;
        if (a.cooldown > prevCd + 1e-4) {
            a.recoil = 1;
            if (a.mesh.userData.animated) playUnitFireAnim(a.mesh);
        }
        a.prevCooldown = a.cooldown;
        const recoil = a.recoil ?? 0;

        // Fraction of UnitType.speed actually traveled this step (0 idle, ~1
        // full, ~0.1 when stunned). Same idea as skinned walk timeScale.
        const stepDist = Math.hypot(a.x - a.prevX, a.z - a.prevZ);
        const stepDt = this.prevStepDt || BattleSim.STEP;
        const nominal = a.unit.type.speed * stepDt;
        const moving = nominal > 1e-6 ? Math.min(1, stepDist / nominal) : 0;
        const yaw = a.mesh.rotation.y;

        // ground units stride, roll, and lean forward as they walk; flyers keep
        // their own altitude handling. Skinned/animated units get their gait
        // from the skeleton, so only apply the procedural bob to the rest.
        if (a.altitude === 0) {
            // sample under the footprint (max of a ring) at the RENDERED xz so
            // walkers clear the uphill side of mounds instead of sinking in.
            // Slight negative seat: strong ground normals make the lawn look
            // higher than the mesh, so a tiny sink kills the hover look.
            // worldHeightAt (board relief + outer world) instead of the board-only
            // groundSupportAt — otherwise a marching horde actor spawned outside
            // the board renders flat against sloped/hilly outer terrain. Purely
            // cosmetic (mesh.position.y only): the sim itself walks the flat
            // plane (see feetY), so this can't affect determinism.
            const groundY = worldHeightAt(a.rx, a.rz) + GROUND_UNIT_Y;
            if (!a.mesh.userData.animated) {
                const lean = a.unit.type.walkLean ?? 1;
                const cadence = a.unit.type.walkCadence ?? 1;
                // Integrate on render frames (not SIM_HZ) — stepping phase only
                // on sim ticks made lean hold then jump (~4 frames at 60fps).
                const last = a.gaitTime ?? timeSeconds;
                const dt = Math.max(0, Math.min(0.1, timeSeconds - last));
                a.gaitTime = timeSeconds;
                a.gaitPhase = (a.gaitPhase ?? 0) + dt * 9 * cadence * moving;
                const gait = Math.sin((a.gaitPhase ?? 0) + a.index);
                a.mesh.position.y =
                    groundY + Math.abs(gait) * 0.16 * lean * moving + recoil * 0.06;
                a.mesh.rotation.z = gait * 0.06 * lean * moving; // side-to-side roll
                // slight lean — walkLean can push dwarves harder; base stays small
                a.mesh.rotation.x = -0.06 * lean * moving;
            } else {
                a.mesh.position.y = groundY;
            }
        } else {
            // climb from deployment hover (ground + DEPLOY_AIR_Y) to the combat
            // air layer via unit.flightLift — battle used to snap to altitude
            // immediately, which read as a teleport especially on hills
            // A pinned pack is already exactly where it belongs — it never
            // climbed out of a deployment hover, so it must not be lerped from
            // one. Without this the Stronghold archer's lift stays 0 (tickFlight
            // only ramps real flyers) and the climb resolves to ground level:
            // he renders inside his own keep and shoots from in there.
            const lift = a.unit.pinnedY != null ? 1 : a.unit.flightLift;
            const fromY = worldHeightAt(a.rx, a.rz) + DEPLOY_AIR_Y;
            // Free-flight altitude changes every sim step — lerp like xz or it
            // stutters at SIM_HZ. Layer flyers keep a fixed ceiling so raw is fine.
            const alt = a.unit.type.freeFlight
                ? a.prevAltitude + (a.altitude - a.prevAltitude) * this.alpha
                : a.altitude;
            const hoverY = fromY + (alt - fromY) * lift;
            const groundY = worldHeightAt(a.rx, a.rz) + GROUND_UNIT_Y;
            // age uses leftover-step alpha so the dive is smooth between sim ticks.
            // Do not treat age≈0 as “done” — that used to clear the slam on the
            // same frame it started, so the mesh never left hover height.
            const stompAge =
                a.stompAt == null ? -1 : this.elapsed - a.stompAt + this.alpha * BattleSim.STEP;
            const stomp = flyerStomp(stompAge);
            let destX = a.stompTx ?? a.rx;
            let destZ = a.stompTz ?? a.rz;
            let destY = a.stompAir ? (a.stompTy ?? hoverY) : groundY;
            if (a.stompAir && a.stompVictim?.alive) {
                destX = a.stompVictim.rx;
                destZ = a.stompVictim.rz;
                destY = a.stompVictim.footY + a.stompVictim.unit.type.meshScale * 0.55;
            }
            // Idle hover sway — for things that actually hover. A pinned pack is
            // standing on stone, and lift is 1 for it by construction, so
            // without this exclusion it drifts a third of a unit up and down
            // on its own battlement.
            const hoverBob =
                a.unit.pinnedY != null || stomp.drop >= 0.02
                    ? 0
                    : Math.sin(timeSeconds * 2 + a.index) *
                      (a.unit.type.freeFlight ? 0.12 : 0.35) *
                      lift;
            a.mesh.position.y = hoverY + (destY - hoverY) * stomp.drop + hoverBob;
            if (a.stompAir && stomp.drop > 0.01) {
                a.mesh.position.x += (destX - a.rx) * stomp.drop;
                a.mesh.position.z += (destZ - a.rz) * stomp.drop;
            }
            if (a.stompAt != null) {
                a.mesh.rotation.x = (a.stompAir ? -0.4 : -0.22) * stomp.drop;
                const baseScale = a.unit.visualMeshScale();
                a.mesh.scale.set(baseScale, baseScale * (1 - 0.12 * stomp.squash), baseScale);
                if (stompAge >= FLYER_STOMP_TOTAL) {
                    a.stompAt = undefined;
                    a.stompAir = false;
                    a.stompVictim = undefined;
                }
            } else if (a.unit.type.freeFlight) {
                const pitch =
                    a.prevFlightPitch + (a.flightPitch - a.prevFlightPitch) * this.alpha;
                a.mesh.rotation.x = pitch;
            }
        }

        // summon entrance (render-only): ground mechs rise out of the soil,
        // flyers dive in from high above — eased over the first moments
        if (a.appearAt > 0 && a.appeared) {
            const dur = a.altitude > 0 ? SUMMON_DIVE_SECONDS : SUMMON_RISE_SECONDS;
            const t = (this.elapsed - a.appearAt) / dur;
            if (t >= 0 && t < 1) {
                const ease = 1 - (1 - t) * (1 - t); // fast start, soft landing
                if (a.altitude === 0) {
                    a.mesh.position.y -= (1 - ease) * 2.6; // still buried below
                    a.mesh.rotation.z = 0; // no walk roll while emerging
                } else {
                    a.mesh.position.y += (1 - ease) * 16; // swooping down
                }
            }
        }

        // recoil kicks the unit backward along its facing, then decays.
        // Skip the shove while a flyer is slamming — the dive is the hit.
        const stomping = (a.stompAt ?? -1e9) > this.elapsed - FLYER_STOMP_TOTAL;
        if (recoil > 0.01 && !stomping) {
            a.mesh.position.x += Math.sin(yaw) * recoil * 0.3;
            a.mesh.position.z += Math.cos(yaw) * recoil * 0.3;
            a.recoil = recoil * 0.8;
        } else if (recoil > 0.01 && stomping) {
            a.recoil = recoil * 0.8;
        } else {
            a.recoil = 0;
        }

        // blast impulse (stones / meteor / hammer) — radial shove, frame-decayed
        const ix = a.impulseX ?? 0;
        const iz = a.impulseZ ?? 0;
        if (Math.hypot(ix, iz) > 0.008) {
            a.mesh.position.x += ix;
            a.mesh.position.z += iz;
            a.impulseX = ix * 0.82;
            a.impulseZ = iz * 0.82;
        } else {
            a.impulseX = 0;
            a.impulseZ = 0;
        }

        if (usesWingFlapModel(a.unit.type.modelId ?? a.unit.type.id) && a.mesh.userData.instanced) {
            setCrowWingRestOnProxy(a.mesh, 0);
            setCrowWingRateOnProxy(
                a.mesh,
                computeCrowWingRate({
                    dead: !a.alive || !!a.mesh.userData.dead,
                    inDeployment: false,
                    flightLift: a.unit.flightLift,
                    altitude: a.altitude,
                    moving,
                }),
            );
        }
    }

    isSpawning(a: Actor): boolean {
        return a.spawnUntil > this.elapsed + 1e-9;
    }

    /** hp ramps 1 → max during flank spawn; finishes with full hp if undamaged */
    /** 0 → 1 across the post-freeze spawn window */
    private spawnProgress(a: Actor): number {
        const duration = a.spawnUntil - BATTLE_START_FREEZE;
        if (duration <= 0) return 1;
        return Math.min(1, Math.max(0, (this.elapsed - BATTLE_START_FREEZE) / duration));
    }

    private updateFlankSpawning(): void {
        for (const a of this.actors) {
            if (a.spawnUntil <= 0) continue;
            if (this.elapsed >= a.spawnUntil) {
                if (!a.spawnDamaged && a.alive) a.hp = a.maxHp;
                a.spawnUntil = 0; // must clear BEFORE the aura pass (isSpawning)
                // Abilities start only now that the unit has actually arrived:
                // it can receive the golden aura, and — if it IS a golden
                // ballista — it starts granting to allies around it.
                if (this.goldenAuraApplied && a.alive) {
                    this.applyGoldenAura(a);
                    this.applyGoldenAura(undefined, a);
                }
                continue;
            }
            const ceiling = 1 + (a.maxHp - 1) * this.spawnProgress(a);
            if (!a.spawnDamaged) a.hp = ceiling;
        }
    }

    /** hp/damage multiplier from a pack's veterancy level (linear: level N = N × base at bonus 1) */
    private levelMult(unit: Unit): number {
        return 1 + (unit.level - 1) * this.config.leveling.statBonusPerLevel;
    }

    /**
     * Kill XP: the victim's supply value goes to the killer's pack. Leveling
     * itself is a deployment-phase PURCHASE, never automatic — banked XP is
     * capped at exactly one pending level.
     */
    private grantXp(killer: Unit, victim: Actor): void {
        const { leveling, costOf } = this.config;
        if (killer.level >= leveling.maxLevel) return;
        const value =
            victim.unit.type.xpValue ?? costOf(victim.unit.type) / victim.unit.members.length;
        if (value <= 0) return;
        // must match actions.ts xpThresholdFor, or a pack banks XP it can never spend
        const threshold = levelBasisOf(killer.type) * leveling.xpThresholdFactor * killer.level;
        killer.xp = Math.min(killer.xp + value, threshold);
    }

    private kill(
        target: Actor,
        killer: Unit | null,
        dealt = 0,
        knockDir?: { x: number; z: number },
        /** force the heavy gore burst a large pack gets — see the `big` event field */
        violent = false,
        /**
         * Flattened by its own keep coming down, rather than destroyed by an
         * enemy. The building still falls, but none of the bookkeeping a real
         * kill carries applies — nobody earned this.
         */
        razed = false,
    ): void {
        if (killer) killer.kills++;
        // no XP for executing a still-spawning pack — it never fully arrived
        if (killer && !target.unit.type.structure && !this.isSpawning(target)) {
            this.grantXp(killer, target);
            if (!target.unit.type.extra) {
                const specs = this.onKillByUnit.get(killer);
                if (specs) {
                    for (const spec of specs) {
                        const n = this.onKillSpawnSeq++;
                        const ang = n * 2.399963229728653;
                        this.pendingOnKillSpawns.push({
                            parent: killer,
                            typeId: spec.typeId,
                            x: target.x + detCos(ang) * 1.15,
                            z: target.z + detSin(ang) * 1.15,
                        });
                    }
                }
                // onKillHeal: fraction of victim max HP, shared across the killer's pack
                for (const tech of techsForUnit(
                    killer.type,
                    this.config.types,
                    this.config.loadoutOf(killer.seat),
                )) {
                    if (!tech.onKillHeal) continue;
                    if (!this.config.hasTech(killer.seat, killer.type.id, tech.id)) continue;
                    this.healPack(killer, target.maxHp * tech.onKillHeal.ofVictimMaxHp);
                }
            }
        }
        target.alive = false;
        this.applyOnDeathTalents(target);
        const t = target.unit.type;
        const wear = resolveDeathWear(t);
        // normalize the killing-blow direction so death gore jets along it
        const klen = knockDir ? hypot(knockDir.x, knockDir.z) : 0;
        const modelKey = t.modelId ?? t.id;
        const structureHeight = t.structure
            ? Math.max(2.5, getUnitVisualHeight(modelKey) * target.unit.visualMeshScale())
            : undefined;
        this.events.push({
            kind: 'death',
            x: target.x,
            // erupt from the torso (footY tracks ground + altitude), not the feet
            y: target.footY + t.meshScale * 1.3,
            z: target.z,
            big: violent || target.radius >= 2 || !!t.structure,
            fling: violent ? COLLAPSE_GORE_FLING : razed ? COLLAPSE_DEBRIS_FLING : undefined,
            wear,
            structure: !!t.structure,
            unitTypeId: t.id,
            structureHeight,
            structureRadius: t.structure ? target.radius : undefined,
            blood: wear === 'blood' ? bloodColorOf(t) : undefined,
            ashScorch: wear === 'ash' ? t.deathAshScorch : undefined,
            dx: klen > 1e-6 ? knockDir!.x / klen : undefined,
            dz: klen > 1e-6 ? knockDir!.z / klen : undefined,
            bloodScale:
                wear === 'blood'
                    ? (t.bloodScale ?? 1) * (this.crushingHammer ? 1.25 : 1)
                    : undefined,
        });
        if (t.structure) {
            if (razed) target.unit.razed = true;
            target.unit.markDestroyed(knockDir ?? undefined, {
                crush: this.crushingHammer,
            });
            // Units mounted on this building go down with it. Killed with no
            // killer: the besieger earned the building, not its garrison. Linked
            // by id, not by seat — an ally's archer on a shared keep falls too.
            for (const a of this.actors) {
                if (!a.alive || !a.unit.type.diesWithHost) continue;
                if (a.unit.hostUnitId !== target.unit.id) continue;
                this.kill(a, null, a.maxHp, undefined, true);
            }
            if (this.isDebuffBuilding(target.unit) && !razed) {
                this.extendSeatDebuff(target.unit.seat, target.unit.level);
                // half tower height — tallest collider × meshScale / 2
                const towerTop =
                    Math.max(1, ...t.colliders.map((c) => c.y)) * t.meshScale;
                this.events.push({
                    kind: 'towerDebuff',
                    seat: target.unit.seat,
                    team: target.unit.team,
                    x: target.x,
                    y: target.altitude + towerTop * 0.5,
                    z: target.z,
                    level: target.unit.level,
                });
            }
        } else if (this.crushingHammer) {
            // Hammer: pancake flat — no tip / crash tumble
            // Seat ON the lawn (HAMMER_CRUSH_SEAT_Y), not GROUND_UNIT_Y — 4% flats vanish if sunk
            const groundY = worldHeightAt(target.x, target.z) + HAMMER_CRUSH_SEAT_Y;
            clearDeathFall(target.mesh);
            clearDeathTip(target.mesh);
            clearDeathClip(target.mesh);
            clearCorpsePose(target.mesh);
            const tip = groundTipAt(target.x, target.z);
            beginHammerCrush(target.mesh, {
                groundY,
                spin: hammerCrushSpin(target.index + 17),
                endTipX: tip.tipX,
                endTipZ: tip.tipZ,
            });
            target.mesh.userData.dead = true;
            clearBattleTint(target.mesh);
            if (usesWingFlapModel(t.modelId ?? t.id)) setCrowWingRateOnProxy(target.mesh, 0);
            // setDead after crush flag so pancakes stay visible even if wrecks are hidden
            getUnitInstanceRenderer()?.setDead(target.mesh);
            target.mesh.visible = true;
        } else {
            // tip over along the killing blow (fallback: slight random lean)
            const amount = dealt > 0 ? deathTipAmount(dealt, target.maxHp) : Math.PI * 0.5;
            const tips =
                knockDir && hypot(knockDir.x, knockDir.z) > 1e-6
                    ? deathTipFromKnock(target.facing, knockDir.x, knockDir.z, amount)
                    : {
                          tipX: amount * 0.28,
                          tipZ: (target.index % 2 ? 1 : -1) * (amount + (target.index % 4) * 0.05),
                      };
            const groundY = worldHeightAt(target.x, target.z) + GROUND_UNIT_Y;
            const dropHeight = target.mesh.position.y - groundY;
            // Any unit currently aloft (crow, rocket, Sky Lift wizard, …) tumbles
            // down — do not key only on UnitType.flying or Sky Lift deaths snap
            // to the lawn via beginDeathTip.
            const isAirFlyer = target.altitude > 0;
            const shouldCrashFall =
                isAirFlyer || (target.unit.flightCeiling() > 0 && dropHeight > 0.45);
            let fallStartY = target.mesh.position.y;
            if (shouldCrashFall) {
                if (isAirFlyer) {
                    const fromY = worldHeightAt(target.x, target.z) + DEPLOY_AIR_Y;
                    const hoverY = fromY + (target.altitude - fromY) * target.unit.flightLift;
                    snapFlyerForDeathFall(target.mesh, hoverY, target.unit.visualMeshScale());
                    fallStartY = hoverY;
                    target.stompAt = undefined;
                    target.stompAir = false;
                    target.stompVictim = undefined;
                }
                // flyers: tumble down; optional knock flings along the killing blow
                let driftX = 0;
                let driftZ = 0;
                if (knockDir && dealt > 0) {
                    const d = crashDriftFromKnock(dealt, target.maxHp, knockDir.x, knockDir.z);
                    driftX = d.driftX;
                    driftZ = d.driftZ;
                }
                beginDeathFall(
                    target.mesh,
                    groundY,
                    tips.tipZ,
                    -1,
                    target.unit.world.x,
                    target.unit.world.z,
                    driftX,
                    driftZ,
                    fallStartY,
                    tips.tipX,
                );
            } else if (target.mesh.userData.animated && hasUnitDeathAnim(target.mesh)) {
                // Skinned fall clip: ease yaw so authored tip-over follows the knock
                const fallLocal = unitDeathFallLocal(target.mesh) ?? { x: 0, z: -1 };
                const endYaw = deathYawFromKnock(
                    knockDir?.x ?? 0,
                    knockDir?.z ?? 0,
                    fallLocal.x,
                    fallLocal.z,
                    target.facing,
                );
                const dur = playUnitDeathAnim(target.mesh);
                beginDeathClip(target.mesh, groundY, dur > 0 ? dur : 0.8, -1, endYaw, 0.4);
            } else {
                beginDeathTip(target.mesh, tips.tipZ, groundY, -1, tips.tipX);
            }
            target.mesh.userData.dead = true;
            clearBattleTint(target.mesh);
            if (usesWingFlapModel(t.modelId ?? t.id)) setCrowWingRateOnProxy(target.mesh, 0);
            getUnitInstanceRenderer()?.setDead(target.mesh);
        }
        // Lifeline: a side's army stands only while its Stronghold does. Killed
        // with no killer, so this grants no XP and triggers no on-kill spawns —
        // the Stronghold's slayer earns the siege, not a dozen extra kills. The
        // round then ends on its own, with nothing mobile left on that side.
        if (this.config.strongholdLifeline && target.unit.type.onDestroyed?.collapseOwnArmy) {
            const towerTop = Math.max(1, ...t.colliders.map((c) => c.y)) * t.meshScale;
            const maxRadius = this.collapseReach(target.x, target.z);
            this.collapseFronts.push({
                team: actorTeam(target),
                x: target.x,
                z: target.z,
                startedAt: this.elapsed,
                maxRadius,
            });
            this.events.push({
                kind: 'strongholdCollapse',
                team: target.unit.team,
                x: target.x,
                y: target.altitude + towerTop * 0.5,
                z: target.z,
                speed: COLLAPSE_SPEED,
                maxRadius,
            });
        }
    }

    private step(dt: number): void {
        const profiling = this.profileEnabled;
        let t0 = 0;
        const mark = (): void => {
            if (profiling) t0 = performance.now();
        };
        const add = (label: string): void => {
            if (!profiling) return;
            this.lastProfile[label] = (this.lastProfile[label] ?? 0) + (performance.now() - t0);
        };

        this.elapsed += dt;
        // remember where everything stood — rendering interpolates prev -> current
        for (const a of this.actors) {
            a.mvX = a.x - a.prevX;
            a.mvZ = a.z - a.prevZ;
            a.prevX = a.x;
            a.prevZ = a.z;
            a.prevAltitude = a.altitude;
            a.prevFacing = a.facing;
            a.prevFlightPitch = a.flightPitch;
        }
        for (const p of this.projectiles) {
            p.px = p.x;
            p.py = p.y;
            p.pz = p.z;
        }

        if (!this.goldenAuraApplied && this.elapsed >= GOLDEN_AURA_APPLY_AT) {
            this.applyGoldenAura();
            this.goldenAuraApplied = true;
        }

        for (const a of this.actors) {
            if (a.hurtTimer > 0) a.hurtTimer -= dt;
        }

        this.updateFlankSpawning();

        // opening beat: no movement, attacks, rockets, or projectiles yet
        if (this.elapsed < BATTLE_START_FREEZE) return;

        this.stepSummonAppearances();
        this.stepProductionReleases();
        this.stepSpellStrikes();
        this.stepHazardDrips();

        this.stepIndex++;
        let mobile = 0;
        for (const a of this.actors) {
            // marchIn horde actors don't count toward the soft-crowd budget —
            // hundreds of them walking in from the forest shouldn't disable
            // crowd separation for the actual battle
            if (a.alive && !a.unit.type.structure && !a.unit.marchIn) mobile++;
        }
        this.lastMobileCount = mobile;
        this.softCrowdOverload = mobile > SOFT_CROWD_LIMIT;
        this.lastSoftCrowd = !this.softCrowdOverload;

        const d = this.config.towers.debuffPerLostTower;
        mark();
        this.rebuildHash();
        this.rebuildTargetHash();
        this.rebuildStructureList();
        if (this.stepIndex % 60 === 0) {
            for (const [key, v] of this.losCache) if (v.until <= this.elapsed) this.losCache.delete(key);
        }
        const bigs = this.actors.filter((a) => a.alive && a.radius >= BIG_RADIUS);
        add('hash');

        mark();
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            if (a.unit.marchIn) {
                this.stepMarchIn(a, dt);
                continue;
            }
            if (this.isSpawning(a)) continue;

            const onPath = this.updatePathProgress(a, dt);
            const stats = this.statsOf(a);

            let canAttack = true;
            let target = this.closestEnemy(a);
            if (!target) {
                canAttack = false;
                target = this.closestEnemy(a, true);
            }

            if (onPath && a.pathDestX !== null && a.pathDestZ !== null) {
                const destX = a.pathDestX;
                const destZ = a.pathDestZ;
                const isMelee = !a.unit.type.projectileSpeed && !a.unit.type.convertRay && !a.unit.type.rampBeam;

                if (a.unit.type.freeFlight) {
                    // A pass already underway finishes — its heading is locked —
                    // and a foe close enough to commit still wins over the route.
                    // Otherwise fly the route like every other unit marching it.
                    const touch = target
                        ? this.weaponRange(a, target, stats.range) + a.radius + target.radius
                        : 0;
                    const commit = touch + (a.unit.type.meleeLunge ?? 3);
                    const engaged =
                        a.flyPassPhase !== 0 ||
                        (target != null && hypot(target.x - a.x, target.z - a.z) <= commit);
                    if (engaged) {
                        this.stepFreeFlightCombat(a, target, stats, d, dt, canAttack);
                        continue;
                    }
                    const rdx = destX - a.x;
                    const rdz = destZ - a.z;
                    const rDist = hypot(rdx, rdz) || 1e-6;
                    this.updateFreeFlight(a, dt, {
                        x: destX,
                        y: this.freeFlightCruiseY(a),
                        z: destZ,
                    });
                    this.flyAlongHeading(a, rdx / rDist, rdz / rDist, stats, d, dt, rDist);
                    // keep the clock running so the next dive is ready on arrival
                    if (canAttack) a.cooldown -= dt;
                    continue;
                }

                if (target) {
                    const tdx = target.x - a.x;
                    const tdz = target.z - a.z;
                    const tDist = hypot(tdx, tdz) || 1e-6;
                    const reach = effectiveWeaponReach(
                        this.weaponRange(a, target, stats.range),
                        a.radius,
                        target.radius,
                        this.feetY(a),
                        this.feetY(target),
                        this.elevationCounts(a, target),
                    );
                    const minReach = stats.minRange > 0 ? stats.minRange + a.radius + target.radius : 0;
                    if (
                        this.tryMeleeRetreat(a, target, stats, d, bigs, dt, canAttack)
                    ) {
                        continue;
                    }
                    if (tDist <= reach && tDist >= minReach) {
                        if (isMelee) {
                            if (
                                this.tryMeleeEngage(
                                    a,
                                    target,
                                    stats,
                                    d,
                                    bigs,
                                    dt,
                                    canAttack,
                                    tdx,
                                    tdz,
                                    tDist,
                                )
                            ) {
                                continue;
                            }
                        }
                        // ranged / convert-ray on a rally route: fire while marching (over a clear line)
                        if (a.unit.type.projectileSpeed && this.shotLoft(a, target) > 0) {
                            if (canAttack) a.cooldown -= dt;
                            if (canAttack && a.cooldown <= 0) {
                                a.cooldown += stats.attackInterval;
                                const damage = this.hitDamage(a, target, stats.damage, d.attackMult);
                                this.beginRangedFire(a, target, damage, a.unit.type.projectileSpeed);
                            }
                        }
                    }
                    // melee lunge: commit while still closing on a rally march
                    if (
                        isMelee &&
                        tDist > reach &&
                        this.tryMeleeEngage(a, target, stats, d, bigs, dt, canAttack, tdx, tdz, tDist)
                    ) {
                        continue;
                    }
                }

                const dx = destX - a.x;
                const dz = destZ - a.z;
                const dist = hypot(dx, dz) || 1e-6;
                this.steerToward(a, dx / dist, dz / dist, dist, dt, stats, d, target, bigs);
                continue;
            }

            if (!target) {
                if (a.unit.type.freeFlight) {
                    this.stepFreeFlightCombat(a, null, stats, d, dt, canAttack);
                }
                continue;
            }

            if (a.unit.type.freeFlight) {
                this.stepFreeFlightCombat(a, target, stats, d, dt, canAttack);
                continue;
            }

            const tdx = target.x - a.x;
            const tdz = target.z - a.z;
            const tDist = hypot(tdx, tdz) || 1e-6;
            // range is surface-to-surface: collision circles must not keep
            // melee mechs from ever "reaching" wide targets like towers
            const reach = effectiveWeaponReach(
                this.weaponRange(a, target, stats.range),
                a.radius,
                target.radius,
                this.feetY(a),
                this.feetY(target),
                this.elevationCounts(a, target),
            );
            const minReach = stats.minRange > 0 ? stats.minRange + a.radius + target.radius : 0;

            // dead zone: no foe outside min range to shoot or walk toward
            // (closestEnemy only hands back a too-close target as last resort) —
            // back away until the ring clears or a better target appears
            if (minReach > 0 && tDist < minReach) {
                // Back away while still aiming at the foe (don't bank into the retreat vector).
                this.steerToward(
                    a,
                    -tdx / tDist,
                    -tdz / tDist,
                    minReach - tDist + a.radius,
                    dt,
                    stats,
                    d,
                    target,
                    bigs,
                    0,
                    { aimYaw: detAtan2(tdx, tdz), locomotion: 'track' },
                );
                continue;
            }

            // a ranged unit only stands and shoots when the shot clears the relief
            const lineBlocked =
                (!!a.unit.type.projectileSpeed || !!a.unit.type.convertRay || !!a.unit.type.rampBeam) &&
                tDist <= reach &&
                !this.attackLineOpen(a, target);
            if (lineBlocked) a.terrainHinderedAt = this.elapsed;
            this.trackProgress(a, target, tDist, tDist <= reach && !lineBlocked);

            if (this.tryMeleeRetreat(a, target, stats, d, bigs, dt, canAttack)) {
                continue;
            }

            if (
                this.tryMeleeEngage(a, target, stats, d, bigs, dt, canAttack, tdx, tdz, tDist)
            ) {
                continue;
            }

            if (tDist <= reach && tDist >= minReach && !lineBlocked) {
                // in range (and outside dead zone): stand and fire
                if (a.unit.type.projectileSpeed) {
                    if (canAttack) a.cooldown -= dt;
                    if (canAttack && a.cooldown <= 0) {
                        a.cooldown += stats.attackInterval;
                        const damage = this.hitDamage(a, target, stats.damage, d.attackMult);
                        this.beginRangedFire(a, target, damage, a.unit.type.projectileSpeed);
                    }
                }
                // convert-ray handled elsewhere; melee already returned above
                faceToward(a, detAtan2(-tdx, -tdz), dt);
                continue;
            }

            // the lane offset steers, but the stop margin is measured against
            // the TARGET, not the lane point — feeding the lane distance here
            // let a mech halt up to APPROACH_OFFSET_MAX short of its own
            // firing range (2.2× the whole engagement range for a dwarf) and
            // stand there dealing no damage
            const goal = this.approachGoal(a, target);
            const dx = goal.x - a.x;
            const dz = goal.z - a.z;
            const dist = hypot(dx, dz) || 1e-6;
            // blocked: keep closing in (over or around the hill) instead of halting at range
            const stopMargin = lineBlocked ? Math.min(reach * 0.95, a.radius + target.radius + 1) : reach * 0.95;
            this.steerToward(a, dx / dist, dz / dist, tDist, dt, stats, d, target, bigs, stopMargin);
        }
        add('ai');

        mark();
        this.stepMeleePending();
        add('meleePending');

        mark();
        this.stepConversionRays(dt);
        this.stepRampBeams(dt);
        add('convert');

        mark();
        this.resolveOverlaps();
        add('overlaps');

        // seat hit volumes on the terrain before bullets fly this step
        for (const a of this.actors) {
            if (a.alive) a.footY = this.feetY(a);
        }
        mark();
        this.stepRockets(dt);
        // refresh target cells after everyone has moved — bullet hits need current seats
        this.rebuildTargetHash();
        this.stepProjectiles(dt);
        this.stepHazards(dt);
        this.stepRegen(dt);
        add('projectiles');
        this.flushOnKillSpawns();
        // after the kills, so a Stronghold felled this step starts its front on
        // the next one rather than reaching halfway across the board instantly
        this.stepCollapseFronts();
        this.prevStepDt = dt;
    }

    /**
     * World Y of an actor's feet — GAMEPLAY value (trajectories, aim): always
     * uses the settings-independent relief so all machines agree. Flyers use
     * the absolute air layer. Optional xz overrides sample a lead/aim point.
     */
    private feetY(a: Actor, x = a.x, z = a.z): number {
        if (a.altitude > 0) return a.altitude;
        return simGroundSupportAt(x, z, a.radius * 0.65) + GROUND_UNIT_Y;
    }

    /** seek toward a direction with obstacle avoidance and crowd separation */
    private steerToward(
        a: Actor,
        seekX: number,
        seekZ: number,
        goalDist: number,
        dt: number,
        stats: ResolvedStats,
        d: { speedMult: number },
        avoid: Actor | null,
        bigs: Actor[],
        stopMargin = 0,
        opts?: { aimYaw?: number; locomotion?: 'track' | 'pivot' | 'cruise' },
    ): void {
        // A pinned pack is standing on something. Whatever the stats say, and
        // whatever route or rally or bonus points elsewhere, it does not walk.
        if (a.unit.pinnedY != null) return;
        let steerX = seekX;
        let steerZ = seekZ;

        let blocker: Actor | null = null;
        let blockerDist = Infinity;
        for (const o of a.altitude > 0 ? [] : bigs) {
            if (o === a || o === avoid || !o.alive || o.altitude > 0) continue;
            const ox = o.x - a.x;
            const oz = o.z - a.z;
            const ahead = ox * seekX + oz * seekZ;
            if (ahead <= 0 || ahead > AVOID_LOOKAHEAD + o.radius) continue;
            const lateral = seekX * oz - seekZ * ox;
            if (Math.abs(lateral) >= o.radius + a.radius + AVOID_MARGIN) continue;
            const oDist = hypot(ox, oz);
            if (oDist < blockerDist) {
                blockerDist = oDist;
                blocker = o;
            }
        }
        if (blocker) {
            const ox = blocker.x - a.x;
            const oz = blocker.z - a.z;
            const oLen = hypot(ox, oz) || 1e-6;
            const lateral = seekX * oz - seekZ * ox;
            const side = lateral >= 0 ? 1 : -1;
            const w = AVOID_STRENGTH * Math.max(0, 1 - oLen / (AVOID_LOOKAHEAD + blocker.radius));
            steerX += (side * (oz / oLen)) * w;
            steerZ += (-side * (ox / oLen)) * w;
        }

        for (const b of this.softCrowdActive(a) ? this.nearby(a) : []) {
            if (b === a || !b.alive || (b.altitude > 0) !== (a.altitude > 0)) continue;
            if (a.unit.type.freeFlight || b.unit.type.freeFlight) continue; // ghost pierce
            const sx = a.x - b.x;
            const sz = a.z - b.z;
            const sd = hypot(sx, sz);
            const minD = this.crowdRadius(a) + this.crowdRadius(b) + SEPARATION_GAP;
            if (sd >= minD || sd < 1e-4) continue;
            const w = ((minD - sd) / minD) * SEPARATION_STRENGTH;
            steerX += (sx / sd) * w;
            steerZ += (sz / sd) * w;
        }

        const steerLen = hypot(steerX, steerZ);
        if (steerLen > 1e-4) {
            steerX /= steerLen;
            steerZ /= steerLen;
            const desiredYaw = opts?.aimYaw ?? detAtan2(-steerX, -steerZ);
            const mode = opts?.locomotion ?? a.unit.type.turnMove ?? 'track';
            faceToward(a, desiredYaw, dt);
            if (mode === 'pivot' && !facingAligned(a, desiredYaw)) return;

            let moveX = steerX;
            let moveZ = steerZ;
            if (mode === 'cruise') {
                // detSin/detCos, not Math.*: this is the movement vector, not a
                // visual offset — it lands in a.x/a.z, which the state hash mixes
                moveX = -detSin(a.facing);
                moveZ = -detCos(a.facing);
            }

            const speed =
                stats.speed *
                this.moveSpeedFactor(a, d.speedMult) *
                (a.altitude === 0 && this.hazards.hasOilAt(a.x, a.z) ? OIL_SPEED_MULT : 1);
            let move = Math.min(speed * dt, Math.max(0, goalDist - stopMargin));
            // Ground units: uphill slows; steep faces slide sideways instead of freezing.
            if (a.altitude === 0 && move > 1e-6) {
                const slope = resolveSlopeMove(
                    a.x,
                    a.z,
                    moveX,
                    moveZ,
                    move,
                    ((a.index & 1) === 1) !== a.slideFlip,
                );
                if (slope.factor <= SLOPE_STRUGGLE + 1e-4 || slope.mx !== moveX || slope.mz !== moveZ) {
                    a.terrainHinderedAt = this.elapsed;
                }
                moveX = slope.mx;
                moveZ = slope.mz;
                move *= slope.factor;
            }
            a.x += moveX * move;
            a.z += moveZ * move;
        }
    }

    /**
     * Horde forest-ring spawn, walking in: no targeting, no crowd/blocker
     * avoidance, no attacks — just a straight seek toward board center at
     * the unit's own normal speed, until it crosses into the playable AABB
     * (checked against `config.boardHalfW`/`boardHalfZ`), at which point
     * `marchIn` clears for good and every other system in `step()` starts
     * treating it as a completely ordinary combat actor from the very next
     * step. One-way and deliberately cheap — see `SimConfig.boardHalfW`.
     */
    private stepMarchIn(a: Actor, dt: number): void {
        const halfW = this.config.boardHalfW;
        const halfZ = this.config.boardHalfZ;
        if (halfW !== undefined && halfZ !== undefined && Math.abs(a.x) <= halfW && Math.abs(a.z) <= halfZ) {
            a.unit.marchIn = false;
            return;
        }
        const dist = hypot(a.x, a.z) || 1e-6;
        const stats = this.statsOf(a);
        const speed = stats.speed;
        const move = speed * dt;
        a.x += (-a.x / dist) * move;
        a.z += (-a.z / dist) * move;
        faceToward(a, detAtan2(a.x / dist, a.z / dist), dt);
    }

    /**
     * Rocket extras: armed on the pad until the first enemy (per the
     * can-attack matrix) comes into range, then the whole rocket lifts off,
     * homes onto it, and detonates — once, then it's spent for good.
     */
    private stepRockets(dt: number): void {
        for (const a of this.actors) {
            const spec = a.unit.type.rocket;
            if (!spec || !a.alive) continue;
            if (this.isSpawning(a)) continue; // arms only once it has arrived
            if (!a.rocketTarget) {
                const target = this.closestEnemy(a);
                if (!target) continue;
                const dist = hypot(target.x - a.x, target.z - a.z);
                if (dist <= spec.range) a.rocketTarget = target;
                continue;
            }
            // homing: retarget if the victim died mid-flight, else chase it
            if (!a.rocketTarget.alive) {
                a.rocketTarget = this.closestEnemy(a);
                if (!a.rocketTarget) {
                    this.detonateRocket(a, spec);
                    continue;
                }
            }
            // dead-straight beeline from the hover spot onto the target
            const t = a.rocketTarget;
            const dx = t.x - a.x;
            const dy = t.altitude + 0.5 - a.altitude;
            const dz = t.z - a.z;
            const dist = hypot(dx, dy, dz) || 1e-6;
            const move = Math.min(spec.speed * dt, dist);
            a.x += (dx / dist) * move;
            a.altitude += (dy / dist) * move;
            a.z += (dz / dist) * move;
            a.mesh.position.set(a.x - a.unit.world.x, a.altitude, a.z - a.unit.world.z);
            // nose along the flight path
            const pitch = Math.atan2(dy, hypot(dx, dz) || 1e-6);
            a.mesh.rotation.set(pitch, Math.atan2(-dx, -dz), 0, 'YXZ');
            if (dist - move < 1.5) this.detonateRocket(a, spec);
        }
    }

    private detonateRocket(a: Actor, spec: { damage: number; splash: number }): void {
        this.explode({ damage: spec.damage, team: actorTeam(a), source: a.unit }, a.x, a.z, spec.splash);
        this.events.push({
            kind: 'explosion',
            x: a.x,
            y: Math.max(0.3, a.altitude),
            z: a.z,
            radius: spec.splash,
            rocket: true,
        });
        a.alive = false;
        a.mesh.visible = false;
        a.unit.consumed = true; // spent — removed at the round reset
    }

    /**
     * Earliest enemy-ward hit on a world segment from (ox,oy,oz) along (sx,sy,sz).
     * Same rules as projectiles: outgoing shots from inside a dome pass;
     * wall / roof entry from outside is absorbed.
     */
    private enemyShieldHitOnSegment(
        ox: number,
        oy: number,
        oz: number,
        sx: number,
        sy: number,
        sz: number,
        team: BattleTeam,
    ): { shield: Actor; t: number; x: number; y: number; z: number } | null {
        let best: { shield: Actor; t: number } | null = null;
        for (const s of this.actors) {
            const spec = s.unit.type.shield;
            if (!spec || !s.alive || actorTeam(s) === team) continue;
            const cx = ox - s.x;
            const cz = oz - s.z;
            const r2 = spec.radius * spec.radius;
            const startInside2d = cx * cx + cz * cz <= r2;
            if (startInside2d && oy <= spec.height) continue; // fired from inside: outgoing passes
            if (!startInside2d) {
                const a2 = sx * sx + sz * sz;
                if (a2 >= 1e-9) {
                    const b = 2 * (cx * sx + cz * sz);
                    const c = cx * cx + cz * cz - r2;
                    const disc = b * b - 4 * a2 * c;
                    if (disc >= 0) {
                        const t = (-b - Math.sqrt(disc)) / (2 * a2);
                        if (t >= 0 && t <= 1 && oy + sy * t <= spec.height && (!best || t < best.t)) {
                            best = { shield: s, t };
                        }
                    }
                }
            }
            if (oy > spec.height && sy < 0) {
                const t = (spec.height - oy) / sy;
                if (t >= 0 && t <= 1) {
                    const qx = ox + sx * t - s.x;
                    const qz = oz + sz * t - s.z;
                    if (qx * qx + qz * qz <= r2 && (!best || t < best.t)) best = { shield: s, t };
                }
            }
        }
        if (!best) return null;
        return {
            shield: best.shield,
            t: best.t,
            x: ox + sx * best.t,
            y: oy + sy * best.t,
            z: oz + sz * best.t,
        };
    }

    /**
     * Shield extras: a projectile crossing an enemy dome's boundary from the
     * OUTSIDE below its height is absorbed into the dome's damage pool.
     * Returns the earliest crossing on this step's flight segment.
     */
    private shieldCrossing(
        p: Projectile,
        sx: number,
        sy: number,
        sz: number,
    ): { shield: Actor; t: number } | null {
        const hit = this.enemyShieldHitOnSegment(p.x, p.y, p.z, sx, sy, sz, p.team);
        return hit ? { shield: hit.shield, t: hit.t } : null;
    }

    private breakShield(s: Actor): void {
        s.alive = false;
        s.mesh.visible = false;
        s.unit.consumed = true; // broken — gone for good at the round reset
        this.events.push({
            kind: 'death',
            x: s.x,
            y: 2,
            z: s.z,
            big: true,
            wear: resolveDeathWear(s.unit.type),
            structure: !!s.unit.type.structure,
            unitTypeId: s.unit.type.id,
        });
    }

    /** spawns one or more bullets from the shooter's muzzle (see resolved {@link ResolvedStats.projectileCount}) */
    private fireVolley(a: Actor, target: Actor, damage: number, speed: number): void {
        // Same whiff rules as melee — cooldown already advanced by the caller.
        if (!this.groundSwatConnects(a, target)) return;
        const n = Math.max(1, Math.floor(this.statsOf(a).projectileCount));
        for (let i = 0; i < n; i++) {
            this.fire(a, target, damage, speed, i);
        }
    }

    /** spawns a bullet from the shooter's muzzle toward the target's primary hit volume */
    private fire(a: Actor, target: Actor, damage: number, speed: number, shotIndex = 0): void {
        const at = a.unit.type;
        // the arc the line-of-fire check found clear (a blocked path still fires the low one)
        const shot = this.planShot(a, target, speed, shotIndex, this.shotLoft(a, target) || 1, true)!;
        const { mx, mz, muzzleY, vx, vy, vz, gravity, expectedFlight, aimX, aimZ } = shot;
        this.projectiles.push({
            x: mx,
            y: muzzleY,
            z: mz,
            px: mx,
            py: muzzleY,
            pz: mz,
            vx,
            vy,
            vz,
            damage,
            team: actorTeam(a),
            source: a.unit,
            style: at.projectileStyle ?? 'bolt',
            scale: at.projectileScale,
            ...(typeof at.projectileScaleEnd === 'number' &&
            typeof at.projectileScale === 'number'
                ? { scaleEnd: at.projectileScaleEnd, ox: mx, oz: mz, tx: aimX, tz: aimZ }
                : {}),
            ...(at.projectileTrail ? { trail: at.projectileTrail } : {}),
            lit: (() => {
                const style = at.projectileStyle ?? 'bolt';
                if (style !== 'arrow' && style !== 'largeArrow') return false;
                const fire = this.fireProfileOf(a.unit);
                return !!(fire?.burn || fire?.ground);
            })(),
            gravity,
            target: at.homing ? target : undefined,
            // a real rock (not the hammerer's swelling blast disc) is a body once it lands
            ...((at.projectileStyle ?? 'bolt') === 'stone' && at.projectileScaleEnd == null && !at.homing
                ? {
                      stone: {
                          landed: false,
                          rolling: false,
                          bounces: 0,
                          blastMult: 1,
                          refSpeed: 1,
                          radius: STONE_MESH_RADIUS * (typeof at.projectileScale === 'number' ? at.projectileScale : 1),
                          spin: 0,
                          hit: new Set<number>(),
                      },
                  }
                : {}),
            // Long hang must outlive the default 3s TTL or stones vanish mid-arc.
            ttl: Math.max(PROJECTILE_TTL, expectedFlight + 1),
        });
        this.events.push({
            kind: 'muzzle',
            x: mx,
            y: muzzleY,
            z: mz,
            style: at.projectileStyle ?? 'bolt',
            unitTypeId: at.id,
        });
    }

    /**
     * Line of fire: the lowest arc (1 normal, 2–3 steeper lobs) whose flight
     * clears the board relief on the way to the target, or 0 when a hill or a
     * cliff eats every one. Read from the sim's terrain grid, so every machine
     * agrees; held for {@link LOS_RECHECK_S}.
     */
    private shotLoft(a: Actor, target: Actor): number {
        const speed = a.unit.type.projectileSpeed;
        if (!speed) return 1;
        const key = a.index * 1048576 + target.index;
        const known = this.losCache.get(key);
        if (known && known.until > this.elapsed) return known.loft;
        let loft = 0;
        for (let level = 1; level <= CLASSIC_LOFT_TIME.length; level++) {
            const plan = this.planShot(a, target, speed, 0, level, false);
            if (!plan) break;
            if (this.shotClears(plan, a, target)) {
                loft = level;
                break;
            }
        }
        this.losCache.set(key, { until: this.elapsed + LOS_RECHECK_S, loft });
        return loft;
    }

    /**
     * Line of fire for a beam (the wizard's convert ray): a straight segment
     * from the caster's staff height to the target's hit point must stay above
     * the board relief. Uses sim positions only; held for {@link LOS_RECHECK_S}.
     */
    private rayLineOpen(a: Actor, target: Actor): boolean {
        const key = a.index * 1048576 + target.index;
        const known = this.losCache.get(key);
        if (known && known.until > this.elapsed) return known.loft > 0;
        const fy = this.feetY(a) + Math.max(1.6, a.unit.type.meshScale * 1.15);
        const tt = target.unit.type;
        const ty = this.feetY(target) + projectileAimY(tt) * tt.meshScale;
        const dx = target.x - a.x;
        const dz = target.z - a.z;
        const total = hypot(dx, dz);
        const skipStart = a.radius + 0.5;
        const skipEnd = target.radius + 0.8;
        const n = Math.min(160, Math.max(2, Math.ceil(total / LOS_SAMPLE_WU)));
        const buildings = this.buildingsNearLine(a, target, a.x, a.z, target.x, target.z);
        let open = true;
        for (let i = 1; i < n && open; i++) {
            const f = i / n;
            const x = a.x + dx * f;
            const y = fy + (ty - fy) * f;
            const z = a.z + dz * f;
            if (buildings.length > 0 && this.insideBuilding(buildings, x, y, z)) open = false;
            const along = total * f;
            if (along < skipStart || total - along < skipEnd) continue;
            if (y < simGroundHeightAt(x, z) + LOS_CLEARANCE) open = false;
        }
        this.losCache.set(key, { until: this.elapsed + LOS_RECHECK_S, loft: open ? 1 : 0 });
        return open;
    }

    /**
     * Buildings (either side) whose hit volumes come near the xz line from
     * the shooter to the target — the ones a line-of-fire check must test.
     * The target itself doesn't block, and neither does the building a
     * garrison stands on: its archers lean over their own battlements.
     */
    private buildingsNearLine(a: Actor, target: Actor, x0: number, z0: number, x1: number, z1: number): Actor[] {
        const result = this.buildingScratch;
        result.length = 0;
        const lx = x1 - x0;
        const lz = z1 - z0;
        const len2 = lx * lx + lz * lz || 1e-9;
        for (const b of this.structures) {
            if (b === target || b === a || b.unit.id === a.unit.hostUnitId) continue;
            const type = b.unit.type;
            if (type.colliders.length === 0) continue;
            let reach = 0;
            for (const c of type.colliders) reach = Math.max(reach, c.r * type.meshScale);
            const t = Math.max(0, Math.min(1, ((b.x - x0) * lx + (b.z - z0) * lz) / len2));
            const qx = x0 + lx * t - b.x;
            const qz = z0 + lz * t - b.z;
            if (qx * qx + qz * qz <= (reach + 0.5) * (reach + 0.5)) result.push(b);
        }
        return result;
    }

    /** whether a point lies inside one of these buildings' hit volumes */
    private insideBuilding(buildings: Actor[], x: number, y: number, z: number): boolean {
        for (const b of buildings) {
            const type = b.unit.type;
            for (const c of type.colliders) {
                const r = c.r * type.meshScale;
                const dy = y - (b.footY + c.y * type.meshScale);
                const dx = x - b.x;
                const dz = z - b.z;
                if (dx * dx + dy * dy + dz * dz < r * r) return true;
            }
        }
        return false;
    }

/**
     * How the high-ground rule counts for this pair. A flyer hovers wherever it
     * likes, so its altitude is never high ground: an airborne shooter gains
     * nothing, and a flyer climbing above a ground shooter costs that shooter
     * nothing — but a hill still helps against a flyer below it.
     */
    private elevationCounts(shooter: Actor, target: Actor): ElevationMode {
        if (!shooter.unit.type.projectileSpeed || shooter.altitude > 0) return 'none';
        return target.altitude > 0 ? 'gainOnly' : 'full';
    }

    /** whether this unit's attack (shot or beam) can reach the target over the terrain */
    private attackLineOpen(a: Actor, target: Actor): boolean {
        if (a.unit.type.projectileSpeed) return this.shotLoft(a, target) > 0;
        if (a.unit.type.convertRay || a.unit.type.rampBeam) return this.rayLineOpen(a, target);
        return true;
    }

    /** whether a planned flight stays above the ground between the shooter and the target */
    private shotClears(p: ShotPlan, a: Actor, target: Actor): boolean {
        const flat = hypot(p.vx, p.vz);
        const flight = p.expectedFlight;
        if (flat < 1e-6 || flight <= 0) return true;
        const g = p.gravity ?? 0;
        // stepProjectiles integrates velocity first, so the bullet sits ½·g·dt·t below the exact parabola
        const dt = this.prevStepDt;
        const total = flat * flight;
        const skipStart = a.radius + 0.5;
        const skipEnd = target.radius + 0.8;
        const n = Math.min(160, Math.max(2, Math.ceil(total / LOS_SAMPLE_WU)));
        const buildings = this.buildingsNearLine(a, target, p.mx, p.mz, p.mx + p.vx * flight, p.mz + p.vz * flight);
        for (let i = 1; i < n; i++) {
            const t = (flight * i) / n;
            const x = p.mx + p.vx * t;
            const z = p.mz + p.vz * t;
            const y = p.muzzleY + p.vy * t - 0.5 * g * t * (t + dt);
            if (buildings.length > 0 && this.insideBuilding(buildings, x, y, z)) return false;
            const along = flat * t;
            if (along < skipStart || total - along < skipEnd) continue;
            if (y < simGroundHeightAt(x, z) + LOS_CLEARANCE) return false;
        }
        return true;
    }

    /**
     * Stuck detection: a unit that hasn't closed on its target (or fought it)
     * for {@link STUCK_SECONDS} while the terrain was in its way passes that
     * target over for a while and tries the other way around the slope.
     * Units held up by crowds or waiting in formation are left alone.
     */
    private trackProgress(a: Actor, target: Actor, dist: number, engaged: boolean): void {
        if (a.progressTarget !== target) {
            a.progressTarget = target;
            a.progressBest = dist;
            a.progressAt = this.elapsed;
            return;
        }
        if (engaged || dist < a.progressBest - STUCK_PROGRESS_WU) {
            if (dist < a.progressBest) a.progressBest = dist;
            a.progressAt = this.elapsed;
            return;
        }
        if (this.elapsed - a.progressAt < STUCK_SECONDS) return;
        a.progressAt = this.elapsed;
        a.progressBest = dist;
        if (this.elapsed - a.terrainHinderedAt > 1) return;
        a.shunTarget = target;
        a.shunUntil = this.elapsed + STUCK_SHUN_SECONDS;
        a.slideFlip = !a.slideFlip;
        a.cachedEnemy = null;
    }

    /**
     * Where a shot leaves the muzzle and how fast — no side effects, so the
     * line-of-fire check can plan shots it never fires. `loft` 1 is the normal
     * arc; 2 and 3 are steeper lobs for ballistic shooters (straight shooters
     * have none: null).
     */
    private planShot(
        a: Actor,
        target: Actor,
        speed: number,
        shotIndex: number,
        loft: number,
        spread: boolean,
    ): ShotPlan | null {
        const at = a.unit.type;
        if (loft > 1 && !at.projectileBallistic) return null;
        const tt = target.unit.type;
        const dirX = target.x - a.x;
        const dirZ = target.z - a.z;
        const flat = hypot(dirX, dirZ) || 1e-6;
        // arrows spawn from the unit center so they don't pop out ahead of the mesh
        const fromCenter = at.projectileStyle === 'arrow' || at.projectileStyle === 'largeArrow';
        const shooterFeet = this.feetY(a);
        const modelKey = at.modelId ?? at.id;
        const attackLocal = getUnitAttackNodeLocal(modelKey);
        let mx: number;
        let mz: number;
        let muzzleY: number;
        if (attackLocal) {
            const muzz = attackNodeWorld(
                attackLocal,
                a.x,
                shooterFeet,
                a.z,
                a.facing,
                a.unit.visualMeshScale(),
            );
            mx = muzz.x;
            mz = muzz.z;
            muzzleY = muzz.y;
        } else {
            mx = fromCenter ? a.x : a.x + (dirX / flat) * (a.radius + 0.5);
            mz = fromCenter ? a.z : a.z + (dirZ / flat) * (a.radius + 0.5);
            if (at.projectileLaunchHeight !== undefined) {
                muzzleY = shooterFeet + at.projectileLaunchHeight;
            } else if (at.projectileLaunchHeightFrac != null) {
                muzzleY =
                    shooterFeet +
                    getUnitVisualHeight(modelKey) * a.unit.visualMeshScale() * at.projectileLaunchHeightFrac;
            } else {
                muzzleY =
                    shooterFeet + (at.colliders[0]?.y ?? 0.5) * at.meshScale + (fromCenter ? 0 : 0.4);
            }
        }
        const aimLocalY = projectileAimY(tt);
        let aimX = target.x;
        let aimZ = target.z;
        let aimYOff = 0;
        let dx = aimX - mx;
        let dz = aimZ - mz;
        let dy = this.feetY(target, aimX, aimZ) + aimLocalY * tt.meshScale - muzzleY;

        const volley = Math.max(1, Math.floor(this.statsOf(a).projectileCount));
        const useSpread =
            spread &&
            !at.homing &&
            (at.projectileStyle === 'arrow' ||
                at.aimSpread != null ||
                volley > 1);

        let vx: number;
        let vy: number;
        let vz: number;
        let gravity: number | undefined;
        /** expected hang time — used to keep TTL above long mortar lobs */
        let expectedFlight = 0;
        if (at.projectileBallistic) {
            // horizontal speed toward a lead point; loft so the bolt lands near aim height
            const dtPrev = this.prevStepDt || 1e-3;
            const tvx = target.mvX / dtPrev;
            const tvz = target.mvZ / dtPrev;
            // Free-flight divers change altitude every step — lead Y too or arrows
            // sail through where the bat was, not where it is.
            const tvy = target.unit.type.freeFlight
                ? (target.altitude - target.prevAltitude) / dtPrev
                : 0;
            const fixedAngleDeg = at.projectileLaunchAngleDeg;
            const useFixedAngle =
                typeof fixedAngleDeg === 'number' &&
                fixedAngleDeg > 1 &&
                fixedAngleDeg < 89;

            let flatDist = hypot(dx, dz) || 1e-6;
            let flightTime = Math.max(1e-3, flatDist / speed);
            let aimAlt = target.altitude;

            const resolveAimHeight = (): void => {
                if (tt.freeFlight || target.altitude > 0) {
                    dy = aimAlt + aimLocalY * tt.meshScale + aimYOff - muzzleY;
                } else {
                    dy = this.feetY(target, aimX, aimZ) + aimLocalY * tt.meshScale + aimYOff - muzzleY;
                }
            };

            if (useFixedAngle) {
                // Fixed elevation: solve muzzle speed from range so near and far
                // shots share the same lob angle (farther ⇒ faster).
                const theta = (loftAngleDeg(fixedAngleDeg!, loft) * Math.PI) / 180;
                // detCos/detSin, never Math.*: this sets the stone's velocity,
                // and ECMAScript lets V8, JavaScriptCore and SpiderMonkey
                // round cos/sin differently — Safari and Chrome would throw
                // the same volley to slightly different spots.
                const cosT = detCos(theta);
                const sinT = detSin(theta);
                const tanT = sinT / cosT;
                gravity = BALLISTIC_GRAVITY;
                const timeScale = Math.max(1e-3, at.projectileBallisticTimeScale ?? 1);
                // Stretched hang: aim where the target is NOW (no lead). Movers
                // close under the lob and the stone lands behind them.
                const aimNow = timeScale !== 1;

                const solveSpeed = (R: number, drop: number): number => {
                    // drop = aimY - muzzleY; need R·tanθ − drop > 0 to land on the ray.
                    const reach = R * tanT - drop;
                    if (reach < 0.15) return -1;
                    return Math.sqrt((gravity! * R * R) / (2 * cosT * cosT * reach));
                };

                let muzzle: number;
                if (aimNow) {
                    aimX = target.x;
                    aimZ = target.z;
                    aimAlt = target.altitude;
                    dx = aimX - mx;
                    dz = aimZ - mz;
                    flatDist = hypot(dx, dz) || 1e-6;
                } else {
                    // Seed flight time from a level-ground guess, then refine lead.
                    muzzle = solveSpeed(flatDist, 0);
                    if (muzzle < 0) muzzle = speed;
                    flightTime = Math.max(1e-3, flatDist / (muzzle * cosT));
                    for (let i = 0; i < 2; i++) {
                        aimX = target.x + tvx * flightTime;
                        aimZ = target.z + tvz * flightTime;
                        aimAlt = target.altitude + tvy * flightTime;
                        dx = aimX - mx;
                        dz = aimZ - mz;
                        flatDist = hypot(dx, dz) || 1e-6;
                        resolveAimHeight();
                        muzzle = solveSpeed(flatDist, dy);
                        if (muzzle < 0) muzzle = Math.max(speed, flatDist * 0.85);
                        flightTime = Math.max(1e-3, flatDist / (muzzle * cosT));
                    }
                }
                if (useSpread) {
                    const spread = this.aimSpread(a, target, flatDist, shotIndex);
                    aimX += spread.ox;
                    aimZ += spread.oz;
                    aimYOff = spread.oy;
                    dx = aimX - mx;
                    dz = aimZ - mz;
                    flatDist = hypot(dx, dz) || 1e-6;
                }
                resolveAimHeight();
                muzzle = solveSpeed(flatDist, dy);
                if (muzzle < 0) muzzle = Math.max(speed, flatDist * 0.85);
                flightTime = Math.max(1e-3, flatDist / (muzzle * cosT));

                const horiz = muzzle * cosT;
                vx = (dx / flatDist) * horiz;
                vz = (dz / flatDist) * horiz;
                vy = muzzle * sinT;
                expectedFlight = flightTime;

                // Same path, slower clock: v' = v/s, g' = g/s² (not g/s — that
                // drops the lob short). Aim stays where the target was at fire.
                if (timeScale !== 1) {
                    vx /= timeScale;
                    vy /= timeScale;
                    vz /= timeScale;
                    gravity /= timeScale * timeScale;
                    expectedFlight *= timeScale;
                }
            } else {
                // Classic: fixed horizontal speed; loft grows with range.
                // A steeper lob flies the same distance slower, so it climbs higher.
                const hSpeed = speed / CLASSIC_LOFT_TIME[loft - 1]!;
                // honest time-to-target (no artificial floor — that lofted short shots past the aim)
                flightTime = Math.max(1e-3, flatDist / hSpeed);
                // one refine so closing enemies still get clipped without homing
                for (let i = 0; i < 2; i++) {
                    aimX = target.x + tvx * flightTime;
                    aimZ = target.z + tvz * flightTime;
                    aimAlt = target.altitude + tvy * flightTime;
                    dx = aimX - mx;
                    dz = aimZ - mz;
                    flatDist = hypot(dx, dz) || 1e-6;
                    flightTime = Math.max(1e-3, flatDist / hSpeed);
                }
                // scatter after lead so successive arrows / mortar stones don't stack
                if (useSpread) {
                    const spread = this.aimSpread(a, target, flatDist, shotIndex);
                    aimX += spread.ox;
                    aimZ += spread.oz;
                    aimYOff = spread.oy;
                    dx = aimX - mx;
                    dz = aimZ - mz;
                    flatDist = hypot(dx, dz) || 1e-6;
                    flightTime = Math.max(1e-3, flatDist / hSpeed);
                }
                resolveAimHeight();
                gravity = BALLISTIC_GRAVITY;
                vx = (dx / flatDist) * hSpeed;
                vz = (dz / flatDist) * hSpeed;
                vy = dy / flightTime + 0.5 * gravity * flightTime;
                expectedFlight = flightTime;

                const timeScale = Math.max(1e-3, at.projectileBallisticTimeScale ?? 1);
                if (timeScale !== 1) {
                    vx /= timeScale;
                    vy /= timeScale;
                    vz /= timeScale;
                    gravity /= timeScale * timeScale;
                    expectedFlight *= timeScale;
                }
            }
        } else {
            if (useSpread) {
                const flatDist = hypot(dx, dz) || 1e-6;
                const spread = this.aimSpread(a, target, flatDist, shotIndex);
                aimX += spread.ox;
                aimZ += spread.oz;
                aimYOff = spread.oy;
                dx = aimX - mx;
                dz = aimZ - mz;
            }
            dy = this.feetY(target, aimX, aimZ) + straightAimY(tt) + aimYOff - muzzleY;
            const len = hypot(dx, dy, dz) || 1e-6;
            vx = (dx / len) * speed;
            vy = (dy / len) * speed;
            vz = (dz / len) * speed;
            expectedFlight = len / speed;
        }

        return { mx, mz, muzzleY, vx, vy, vz, gravity, expectedFlight, aimX, aimZ };
    }

    /**
     * Deterministic archer aim scatter: grows with range and target size so a
     * pack doesn't pin ten shafts on the same tower rivet / chest pixel.
     */
    private aimSpread(
        shooter: Actor,
        target: Actor,
        flatDist: number,
        shotIndex = 0,
    ): { ox: number; oz: number; oy: number } {
        const at = shooter.unit.type;
        const tt = target.unit.type;
        const modelKey = tt.modelId ?? tt.id;
        const visualHalf =
            getUnitVisualHalfWidth(modelKey) * target.unit.visualMeshScale();
        const visualH = getUnitVisualHeight(modelKey) * target.unit.visualMeshScale();
        let colliderR = target.radius;
        for (const c of tt.colliders) {
            colliderR = Math.max(colliderR, c.r * tt.meshScale);
        }
        const sizeR = Math.max(colliderR, visualHalf * 0.85, 0.4);
        const range = Math.max(8, at.range);
        const distF = Math.min(1.5, flatDist / range);
        // towers (big sizeR) fan across the facade; dwarves stay tight
        const sizeF = Math.min(2.4, 0.5 + sizeR / 2.8);
        const aimMul = at.aimSpread ?? 1;
        const spreadLat = (0.28 + distF * 1.15) * sizeF * aimMul;
        const spreadY = (0.2 + distF * 0.85) * Math.min(2.1, 0.35 + visualH / 5) * aimMul;

        const seed = shooter.index * 100003 + this.stepIndex * 97 + shotIndex * 131;
        const r1 = detHash01(seed) * 2 - 1;
        const r2 = detHash01(seed + 17) * 2 - 1;
        const r3 = detHash01(seed + 41) * 2 - 1;

        const flat = hypot(target.x - shooter.x, target.z - shooter.z) || 1e-6;
        const fwdX = (target.x - shooter.x) / flat;
        const fwdZ = (target.z - shooter.z) / flat;
        const rightX = fwdZ;
        const rightZ = -fwdX;

        return {
            ox: rightX * r1 * spreadLat + fwdX * r2 * spreadLat * 0.4,
            oz: rightZ * r1 * spreadLat + fwdZ * r2 * spreadLat * 0.4,
            oy: r3 * spreadY,
        };
    }

    /**
     * Advances bullets and applies damage to whatever they actually hit: the
     * FIRST enemy hit volume crossed by this step's flight segment — which
     * may be a different mech standing in the way — or the ground.
     */
    private stepProjectiles(dt: number): void {
        let write = 0;
        for (const p of this.projectiles) {
            // homing shots re-aim at their victim every step — they can't miss
            if (p.target?.alive) {
                const tt = p.target.unit.type;
                const aimLocalY = projectileAimY(tt);
                const dx = p.target.x - p.x;
                const dy = p.target.footY + aimLocalY * tt.meshScale - p.y;
                const dz = p.target.z - p.z;
                const len = hypot(dx, dy, dz) || 1e-6;
                const speed = hypot(p.vx, p.vy, p.vz);
                p.vx = (dx / len) * speed;
                p.vy = (dy / len) * speed;
                p.vz = (dz / len) * speed;
            }
            let nx: number;
            let ny: number;
            let nz: number;
            if (p.stone?.rolling) {
                const next = this.rollStone(p, dt);
                if (!next) continue; // came to rest
                nx = next.x;
                ny = next.y;
                nz = next.z;
            } else {
                // lobbed shots tip over under gravity (arrow mesh follows velocity)
                if (p.gravity) p.vy -= p.gravity * dt;
                nx = p.x + p.vx * dt;
                ny = p.y + p.vy * dt;
                nz = p.z + p.vz * dt;
            }
            const sx = nx - p.x;
            const sy = ny - p.y;
            const sz = nz - p.z;
            const segLen2 = sx * sx + sy * sy + sz * sz || 1e-9;
            const reach = Math.sqrt(segLen2) + 5; // broadphase: seg length + max collider size

            let hit: Actor | null = null;
            let hitT = Infinity;
            // a live homing shot connects with its victim and nothing else
            const candidates = p.target?.alive
                ? [p.target]
                : this.actorsNearSegment(p.x, p.z, nx, nz, reach, p.team);
            for (const a of candidates) {
                if (!a.alive || actorTeam(a) === p.team) continue;
                if (p.stone?.hit.has(a.index)) continue; // a stone strikes each body once
                const bx = a.x - p.x;
                const bz = a.z - p.z;
                if (bx * bx + bz * bz > reach * reach) continue;
                const mt = a.unit.type;
                for (const c of mt.colliders) {
                    const cy = a.footY + c.y * mt.meshScale;
                    const cr = c.r * mt.meshScale + PROJECTILE_RADIUS;
                    // closest approach of the flight segment to the sphere center
                    let t = (bx * sx + (cy - p.y) * sy + bz * sz) / segLen2;
                    t = Math.max(0, Math.min(1, t));
                    const qx = p.x + sx * t - a.x;
                    const qy = p.y + sy * t - cy;
                    const qz = p.z + sz * t - a.z;
                    if (qx * qx + qy * qy + qz * qz <= cr * cr && t < hitT) {
                        hitT = t;
                        hit = a;
                    }
                }
            }

            // an enemy shield dome eats the projectile if it crosses in first
            const crossing = this.shieldCrossing(p, sx, sy, sz);
            if (crossing && (!hit || crossing.t < hitT)) {
                const shield = crossing.shield;
                shield.hp -= p.damage;
                shield.hurtTimer = HURT_BAR_SECONDS;
                this.events.push({
                    kind: 'impact',
                    x: p.x + sx * crossing.t,
                    y: p.y + sy * crossing.t,
                    z: p.z + sz * crossing.t,
                    ward: true,
                    scar: false,
                });
                if (shield.hp <= 0) this.breakShield(shield);
                continue; // bullet absorbed
            }

            const splash = this.resolved.get(p.source)?.splashRadius ?? p.source.type.splashRadius ?? 0;
            // own buildings are solid too: a shot that reaches one first stops in the stone, harmlessly
            // (homing shots steer to their victim; a garrison shoots over its own walls)
            const wall = p.target ? null : this.ownBuildingOnSegment(p, sx, sy, sz, segLen2);
            if (wall && (!hit || wall.t < hitT)) {
                const ix = p.x + sx * wall.t;
                const iy = p.y + sy * wall.t;
                const iz = p.z + sz * wall.t;
                if (p.stone?.landed) {
                    // its blast went off where it landed — a rolling stone just stops against the wall
                    this.restStone(p, ix, iz);
                    continue;
                }
                const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                if (splash > 0) {
                    this.explode(p, ix, iz, splash, { x: sx, z: sz });
                    this.events.push({
                        kind: 'explosion',
                        x: ix,
                        y: iy,
                        z: iz,
                        radius: splash,
                        scar: p.source.type.splashScar !== false,
                    });
                }
                this.events.push({
                    kind: 'impact',
                    x: ix,
                    y: iy,
                    z: iz,
                    flesh: false,
                    masonry: true,
                    cx: wall.building.x,
                    cz: wall.building.z,
                    dx: sx / slen,
                    dy: sy / slen,
                    dz: sz / slen,
                    ...stoneDropFields(p),
                });
                this.emitStuckAtImpact(p.style, ix, iy, iz, sx, sy, sz, wall.building, p.scale);
                continue; // bullet stopped
            }
            // a landed stone runs into bodies instead of bursting on them
            if (hit && p.stone?.landed) {
                if (!this.stoneStrike(p, hit, p.x + sx * hitT, p.y + sy * hitT, p.z + sz * hitT, sx, sz)) continue;
                hit = null;
            }
            if (hit) {
                const ix = p.x + sx * hitT;
                const iy = p.y + sy * hitT;
                const iz = p.z + sz * hitT;
                if (splash > 0) {
                    this.explode(p, ix, iz, splash, { x: sx, z: sz });
                    this.events.push({
                        kind: 'explosion',
                        x: ix,
                        y: iy,
                        z: iz,
                        radius: splash,
                        scar: p.source.type.splashScar !== false,
                    });
                    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                    if (hit.unit.type.structure || p.style === 'stone') {
                        this.events.push({
                            kind: 'impact',
                            x: ix,
                            y: iy,
                            z: iz,
                            flesh: false,
                            masonry: !!hit.unit.type.structure,
                            cx: hit.unit.type.structure ? hit.x : undefined,
                            cz: hit.unit.type.structure ? hit.z : undefined,
                            dx: sx / slen,
                            dy: sy / slen,
                            dz: sz / slen,
                            ...stoneDropFields(p),
                            scar: p.source.type.splashScar !== false,
                        });
                    }
                    this.emitStuckAtImpact(p.style, ix, iy, iz, sx, sy, sz, hit, p.scale);
                } else {
                    const dealt = p.damage * this.damageTakenMult(hit);
                    this.applyDamage(
                        p.source,
                        hit,
                        dealt,
                        { x: sx, z: sz },
                        p.source.type.piercesShield ? 'direct' : 'shielded',
                    );
                    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                    this.events.push({
                        kind: 'impact',
                        x: ix,
                        y: iy,
                        z: iz,
                        blood: bloodColorOf(hit.unit.type),
                        flesh: resolveDeathWear(hit.unit.type) === 'blood',
                        masonry: !!hit.unit.type.structure,
                        unitTypeId: hit.unit.type.structure ? undefined : hit.unit.type.id,
                        cx: hit.unit.type.structure ? hit.x : undefined,
                        cz: hit.unit.type.structure ? hit.z : undefined,
                        dx: sx / slen,
                        dy: sy / slen,
                        dz: sz / slen,
                        ...stoneDropFields(p),
                        bloodScale: hit.unit.type.bloodScale,
                    });
                    this.emitStuckAtImpact(p.style, ix, iy, iz, sx, sy, sz, hit, p.scale);
                    this.applyFireAt(p.source, ix, iz, hit.radius, this.fireProfileOf(p.source), {
                        shotDir: { x: sx, z: sz },
                    });
                    this.applyCorrodeOnHit(p.source, hit);
                    this.applyEmp(p.source, hit);
                }
                continue; // bullet consumed
            }
            // gameplay collision — must be identical on all machines
            const groundY = simGroundHeightAt(nx, nz);
            if (p.stone && !p.stone.rolling && ny <= groundY + (p.stone.landed ? p.stone.radius : 0)) {
                if (this.landStone(p, nx, nz, groundY, sx, sy, sz, splash)) this.projectiles[write++] = p;
                continue;
            }
            if (ny <= groundY) {
                // splash shells detonate on the ground too — a miss still hurts
                if (splash > 0) {
                    this.explode(p, nx, nz, splash, { x: sx, z: sz });
                    this.events.push({
                        kind: 'explosion',
                        x: nx,
                        y: groundY + 0.15,
                        z: nz,
                        radius: splash,
                        scar: p.source.type.splashScar !== false,
                    });
                    if (p.style === 'stone') {
                        const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                        this.events.push({
                            kind: 'impact',
                            x: nx,
                            y: groundY + 0.15,
                            z: nz,
                            dx: sx / slen,
                            dy: sy / slen,
                            dz: sz / slen,
                            sod: true,
                            ...stoneDropFields(p),
                            scar: p.source.type.splashScar !== false,
                        });
                    }
                    this.emitStuckAtImpact(p.style, nx, groundY + 0.12, nz, sx, sy, sz, undefined, p.scale);
                } else {
                    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                    const bolt =
                        p.style === 'arrow' || p.style === 'largeArrow' || p.style === 'stone';
                    this.events.push({
                        kind: 'impact',
                        x: nx,
                        y: groundY + 0.15,
                        z: nz,
                        dx: sx / slen,
                        dy: sy / slen,
                        dz: sz / slen,
                        sod: bolt,
                        ...stoneDropFields(p),
                    });
                    this.emitStuckAtImpact(p.style, nx, groundY + 0.12, nz, sx, sy, sz, undefined, p.scale);
                    this.applyFireAt(p.source, nx, nz, 0, this.fireProfileOf(p.source), {
                        shotDir: { x: sx, z: sz },
                    });
                }
                continue;
            }
            p.x = nx;
            p.y = ny;
            p.z = nz;
            p.ttl -= dt;
            if (p.ttl <= 0) {
                if (p.stone?.landed) this.restStone(p, p.x, p.z);
                continue;
            }
            this.projectiles[write++] = p;
        }
        this.projectiles.length = write;
    }

    /** the board's slope at a point (rise per run along x and z) */
    private groundGradient(x: number, z: number): { gx: number; gz: number } {
        return {
            gx: (simGroundHeightAt(x + 1, z) - simGroundHeightAt(x - 1, z)) * 0.5,
            gz: (simGroundHeightAt(x, z + 1) - simGroundHeightAt(x, z - 1)) * 0.5,
        };
    }

    /**
     * A stone meets the ground. The first time it bursts like any stone
     * always has (full splash); on a slope it then bounces — each later
     * bounce a smaller blast — and once the bounces are too weak it rolls.
     * Returns whether it is still moving.
     */
    private landStone(
        p: Projectile,
        nx: number,
        nz: number,
        groundY: number,
        sx: number,
        sy: number,
        sz: number,
        splash: number,
    ): boolean {
        const st = p.stone!;
        const { gx, gz } = this.groundGradient(nx, nz);
        const grade = hypot(gx, gz);
        const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
        const nxN = -gx * inv;
        const nyN = inv;
        const nzN = -gz * inv;
        const vn = p.vx * nxN + p.vy * nyN + p.vz * nzN;
        const into = vn < 0 ? -vn : 0;
        const first = !st.landed;
        if (first) {
            st.landed = true;
            st.refSpeed = Math.max(1, hypot(p.vx, p.vy, p.vz));
            // the rest of its life runs on real time and gravity (mortar lobs hang in slow motion)
            p.gravity = BALLISTIC_GRAVITY;
            p.ttl = STONE_MAX_MOVE_S;
            if (splash > 0) {
                this.explode(p, nx, nz, splash, { x: sx, z: sz });
                this.events.push({
                    kind: 'explosion',
                    x: nx,
                    y: groundY + 0.15,
                    z: nz,
                    radius: splash,
                    scar: p.source.type.splashScar !== false,
                });
            }
        } else if (splash > 0 && into >= STONE_BLAST_MIN_IMPACT) {
            st.blastMult *= STONE_BOUNCE_DAMAGE;
            this.explode(
                { damage: p.damage * st.blastMult, team: p.team, source: p.source },
                nx,
                nz,
                splash * STONE_BOUNCE_SPLASH,
                { x: sx, z: sz },
            );
            this.events.push({
                kind: 'explosion',
                x: nx,
                y: groundY + 0.15,
                z: nz,
                radius: splash * STONE_BOUNCE_SPLASH,
                scar: false,
            });
        }
        if (first && splash <= 0) {
            this.applyFireAt(p.source, nx, nz, 0, this.fireProfileOf(p.source), { shotDir: { x: sx, z: sz } });
        }
        if (first && grade < STONE_MIN_GRADE) {
            // flat lawn swallows it, as ever
            this.restStone(p, nx, nz, true);
            return false;
        }
        const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        if (first || into >= STONE_BLAST_MIN_IMPACT) {
            this.events.push({
                kind: 'impact',
                x: nx,
                y: groundY + 0.15,
                z: nz,
                dx: sx / slen,
                dy: sy / slen,
                dz: sz / slen,
                sod: true,
                scar: first && p.source.type.splashScar !== false,
            });
        }
        // reflect: the into-ground part comes back weakened, the along-ground part mostly stays
        const tx = (p.vx - vn * nxN) * STONE_BOUNCE_FRICTION;
        const ty = (p.vy - vn * nyN) * STONE_BOUNCE_FRICTION;
        const tz = (p.vz - vn * nzN) * STONE_BOUNCE_FRICTION;
        const up = into * STONE_RESTITUTION;
        st.bounces++;
        if (up < STONE_ROLL_VN || st.bounces > STONE_MAX_BOUNCES) {
            st.rolling = true;
            p.vx = tx;
            p.vy = ty;
            p.vz = tz;
        } else {
            p.vx = tx + nxN * up;
            p.vy = ty + nyN * up;
            p.vz = tz + nzN * up;
        }
        if (hypot(p.vx, p.vz) < STONE_STOP_SPEED && grade < STONE_MIN_GRADE) {
            this.restStone(p, nx, nz);
            return false;
        }
        p.x = nx;
        p.y = groundY + st.radius;
        p.z = nz;
        p.ttl -= this.prevStepDt;
        if (p.ttl <= 0) {
            this.restStone(p, nx, nz);
            return false;
        }
        return true;
    }

    /** one step of a rolling stone: pulled downhill, slowed by friction; null once it rests */
    private rollStone(p: Projectile, dt: number): { x: number; y: number; z: number } | null {
        const st = p.stone!;
        const { gx, gz } = this.groundGradient(p.x, p.z);
        const grade2 = gx * gx + gz * gz;
        const pull = BALLISTIC_GRAVITY / (1 + grade2);
        p.vx -= gx * pull * dt;
        p.vz -= gz * pull * dt;
        let speed = hypot(p.vx, p.vz);
        const slow = STONE_ROLL_FRICTION * dt;
        if (speed <= slow) {
            p.vx = 0;
            p.vz = 0;
            speed = 0;
        } else {
            const k = (speed - slow) / speed;
            p.vx *= k;
            p.vz *= k;
            speed -= slow;
        }
        if (speed < STONE_STOP_SPEED && grade2 < STONE_MIN_GRADE * STONE_MIN_GRADE) {
            this.restStone(p, p.x, p.z);
            return null;
        }
        const x = p.x + p.vx * dt;
        const z = p.z + p.vz * dt;
        const y = simGroundHeightAt(x, z) + st.radius;
        if (p.y - y > STONE_LEDGE_DROP) {
            // rolled off an edge: airborne until the next landing
            st.rolling = false;
            p.vy = 0;
            return { x, y: p.y, z };
        }
        p.vy = (y - p.y) / dt;
        st.spin += (speed * dt) / st.radius;
        return { x, y, z };
    }

    /**
     * A moving stone runs into a body: damage scales with its speed, and it
     * keeps stoneMass / (stoneMass + unitMass) of that speed. A building
     * stops it. Returns whether it keeps going.
     */
    private stoneStrike(p: Projectile, hit: Actor, ix: number, iy: number, iz: number, sx: number, sz: number): boolean {
        const st = p.stone!;
        st.hit.add(hit.index);
        const speed = hypot(p.vx, p.vy, p.vz);
        const f = Math.min(1, speed / st.refSpeed);
        const dealt = p.damage * f * this.damageTakenMult(hit);
        if (dealt >= STONE_MIN_STRIKE_DAMAGE) {
            this.applyDamage(p.source, hit, dealt, { x: sx, z: sz }, p.source.type.piercesShield ? 'direct' : 'shielded');
            const slen = hypot(p.vx, p.vy, p.vz) || 1;
            this.events.push({
                kind: 'impact',
                x: ix,
                y: iy,
                z: iz,
                blood: bloodColorOf(hit.unit.type),
                flesh: resolveDeathWear(hit.unit.type) === 'blood',
                masonry: !!hit.unit.type.structure,
                unitTypeId: hit.unit.type.structure ? undefined : hit.unit.type.id,
                cx: hit.unit.type.structure ? hit.x : undefined,
                cz: hit.unit.type.structure ? hit.z : undefined,
                dx: p.vx / slen,
                dy: p.vy / slen,
                dz: p.vz / slen,
                bloodScale: hit.unit.type.bloodScale,
            });
        }
        if (hit.unit.type.structure) {
            this.restStone(p, ix, iz);
            return false;
        }
        const keep = STONE_MASS / (STONE_MASS + hit.radius * hit.radius);
        // knocked along the roll: a light unit takes most of the push, a heavy one barely moves
        const flat = hypot(p.vx, p.vz);
        if (flat > 1e-6) {
            const power = STONE_STRIKE_PUSH * f * keep;
            const px = (p.vx / flat) * power;
            const pz = (p.vz / flat) * power;
            if (hit.alive) {
                hit.impulseX = (hit.impulseX ?? 0) + px;
                hit.impulseZ = (hit.impulseZ ?? 0) + pz;
            } else {
                this.nudgeWreck(hit, px, pz);
            }
        }
        p.vx *= keep;
        p.vy *= keep;
        p.vz *= keep;
        if (speed * keep < STONE_STOP_SPEED) {
            this.restStone(p, ix, iz);
            return false;
        }
        return true;
    }

    /** a stone comes to rest: the rock the renderer leaves lying on the lawn */
    private restStone(p: Projectile, x: number, z: number, landing = false): void {
        this.events.push({
            kind: 'impact',
            x,
            y: simGroundHeightAt(x, z) + 0.15,
            z,
            dx: landing ? p.vx : 0,
            dy: landing ? p.vy : -1,
            dz: landing ? p.vz : 0,
            sod: landing,
            ...stoneDropFields(p),
            scar: landing && p.source.type.splashScar !== false,
        });
    }

    /**
     * Splash: full damage to every enemy within the radius of the impact,
     * respecting the shooter's can-attack matrix (a ground-only ballista's
     * blast doesn't reach crow riders overhead).
     * `shotDir` = projectile travel xz (preferred); else radial from blast center.
     */
    private explode(
        p: { damage: number; team: BattleTeam; source: Unit },
        x: number,
        z: number,
        radius: number,
        shotDir?: { x: number; z: number },
    ): void {
        const targets = effectiveTargets(p.source.type, p.source.seat, this.config.hasTech, this.config.types);
        for (const a of this.actors) {
            if (!a.alive || actorTeam(a) === p.team) continue;
            if (a.unit.type.extra) continue; // extras are immune to blasts too
            if (a.altitude > 0) {
                if (!targets.air) {
                    // Ground-only splash can clip diving free-flyers, rarely.
                    if (!a.unit.type.freeFlight || a.altitude > GROUND_SWAT_MAX_ALT) continue;
                    const shooter = this.actors.find((x) => x.unit === p.source);
                    const seed =
                        (shooter?.index ?? 0) * 100003 + a.index * 9176 + this.stepIndex * 131;
                    if (detHash01(seed) >= GROUND_SWAT_CATCH) continue;
                }
            } else if (!targets.ground) {
                continue;
            }
            if (hypot(a.x - x, a.z - z) > radius + a.radius) continue;
            const dealt = p.damage * this.damageTakenMult(a);
            const knock =
                shotDir && hypot(shotDir.x, shotDir.z) > 1e-6
                    ? shotDir
                    : { x: a.x - x, z: a.z - z };
            this.applyDamage(
                p.source,
                a,
                dealt,
                knock,
                p.source.type.piercesShield ? 'direct' : 'shielded',
            );
            this.applyCorrodeOnHit(p.source, a);
            this.applyEmp(p.source, a);
        }
        const blastStrength =
            p.source.type.projectileStyle === 'stone'
                ? 0.55
                : p.source.type.projectileStyle === 'largeArrow'
                  ? 1.85
                  : 1.1;
        this.applyBlastImpulse(x, z, radius, blastStrength, shotDir);
        // burn + ground fire (friendly fire) — after kinetic hits
        this.applyFireAt(p.source, x, z, radius, this.fireProfileOf(p.source), { shotDir });
    }

    /** mass-based push-out: heavy units shove light ones aside, structures never move */
    private resolveOverlaps(): void {
        // soft mech-vs-mech is staggered across steps — one pass per involved mech
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure || a.unit.marchIn) continue;
            if (this.softCrowdActive(a)) {
                for (const b of this.nearby(a)) {
                    if (b.index <= a.index || !b.alive || b.unit.type.structure) continue;
                    if (a.unit.type.freeFlight || b.unit.type.freeFlight) continue; // ghost pierce
                    if ((b.altitude > 0) !== (a.altitude > 0)) continue; // air passes over ground
                    this.pushApart(a, b);
                }
            }
            if (a.altitude > 0) continue; // air units ignore structures entirely
            // towers and rubble-free structures are immovable walls
            // (board extras take no space — everything walks through them)
            for (const s of this.structures) {
                if (!s.alive) continue;
                this.pushApart(a, s);
            }
        }
    }

    /** soft crowd on for this mech this step (cadence + stagger — deterministic). */
    private softCrowdActive(a: Actor): boolean {
        const every = this.softCrowdOverload ? CROWD_OVERLOAD_EVERY_STEPS : CROWD_EVERY_STEPS;
        return (this.stepIndex + a.index) % every === 0;
    }

    /**
     * Soft-separation / overlap radius. Loose Rank temporarily inflates this
     * after the opening freeze so pack members push apart; combat range still
     * uses {@link Actor.radius}.
     */
    private crowdRadius(a: Actor): number {
        const t = this.elapsed - BATTLE_START_FREEZE;
        if (t < 0) return a.radius;
        // hot path (every crowd pair, every step): most types have no spread talent,
        // and after the opening seconds nobody does — skip the talent walk entirely
        let spread = this.spreadTalents.get(a.unit.type);
        if (!spread) {
            const list = this.config.types
                .talentsOf(a.unit.type)
                .filter((tech) => tech.battleSpread && tech.battleSpread.seconds > 0 && tech.battleSpread.radiusMult > 1);
            let seconds = 0;
            for (const tech of list) seconds = Math.max(seconds, tech.battleSpread!.seconds);
            spread = { list, seconds };
            this.spreadTalents.set(a.unit.type, spread);
        }
        if (spread.list.length === 0 || t >= spread.seconds) return a.radius;
        let mult = 1;
        for (const tech of spread.list) {
            const bs = tech.battleSpread!;
            if (t >= bs.seconds || bs.radiusMult <= mult) continue;
            if (!this.actorHasTech(a, tech.id)) continue;
            mult = bs.radiusMult;
        }
        return a.radius * mult;
    }

    private pushApart(a: Actor, b: Actor): void {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const dist = hypot(dx, dz);
        const minD =
            a.unit.type.structure || b.unit.type.structure
                ? a.radius + b.radius
                : this.crowdRadius(a) + this.crowdRadius(b);
        if (dist >= minD || dist < 1e-6) return;
        const overlap = minD - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        if (b.unit.type.structure) {
            a.x += nx * overlap;
            a.z += nz * overlap;
            return;
        }
        // Mass from true collision radius — inflate only the desired spacing.
        const massA = a.radius * a.radius;
        const massB = b.radius * b.radius;
        const shareA = massB / (massA + massB);
        const pushAx = nx * overlap * shareA;
        const pushAz = nz * overlap * shareA;
        const pushBx = -nx * overlap * (1 - shareA);
        const pushBz = -nz * overlap * (1 - shareA);
        a.x += pushAx;
        a.z += pushAz;
        b.x += pushBx;
        b.z += pushBz;
        this.noteCrowdApproachOffset(a, b, pushAx, pushAz, pushBx, pushBz);
    }

    /** both mechs share a live attack target — remember the push as a lane offset */
    private noteCrowdApproachOffset(
        a: Actor,
        b: Actor,
        pushAx: number,
        pushAz: number,
        pushBx: number,
        pushBz: number,
    ): void {
        const target = a.cachedEnemy;
        if (!target || !target.alive || target !== b.cachedEnemy) return;
        this.refreshApproachOffset(a, pushAx, pushAz);
        this.refreshApproachOffset(b, pushBx, pushBz);
    }

    private refreshApproachOffset(a: Actor, pushX: number, pushZ: number): void {
        if (Math.abs(pushX) < 1e-6 && Math.abs(pushZ) < 1e-6) return;
        let ox = a.approachOx + pushX;
        let oz = a.approachOz + pushZ;
        const len = hypot(ox, oz);
        if (len > APPROACH_OFFSET_MAX) {
            ox = (ox / len) * APPROACH_OFFSET_MAX;
            oz = (oz / len) * APPROACH_OFFSET_MAX;
        }
        a.approachOx = ox;
        a.approachOz = oz;
        a.approachOffsetUntil = this.elapsed + APPROACH_OFFSET_HOLD;
    }

    /** seek point while approaching — target center plus any active crowd lane */
    private approachGoal(a: Actor, target: Actor): { x: number; z: number } {
        if (a.cachedEnemy !== target || a.approachOffsetUntil <= this.elapsed) {
            a.approachOx = 0;
            a.approachOz = 0;
            a.approachOffsetUntil = 0;
            return { x: target.x, z: target.z };
        }
        return { x: target.x + a.approachOx, z: target.z + a.approachOz };
    }

    /** leftover fraction of a step not yet simulated — the interpolation weight */
    get alpha(): number {
        return this.accumulator / BattleSim.STEP;
    }

    /**
     * Continuous sim clock for render-only FX (dragon flight, meteors, …).
     * {@link elapsed} jumps per step; this includes the in-progress fraction
     * so motion stays smooth at low {@link SIM_HZ}.
     */
    get renderElapsed(): number {
        return this.elapsed + this.accumulator;
    }

    /**
     * Called once per RENDERED frame (not per step): places meshes at
     * positions interpolated between the last two sim steps, so low sim Hz
     * simulation renders smoothly at any display rate and any game speed.
     */
    syncMeshes(): void {
        const alpha = this.alpha;
        for (const a of this.actors) {
            // Structures stay snap-placed — except Fire Bolt rockets, which fly
            // like mechs and need the same xz lerp or they stutter at low SIM_HZ.
            if (!a.alive) continue;
            if (a.unit.type.structure && !a.unit.type.rocket) continue;
            a.rx = a.prevX + (a.x - a.prevX) * alpha;
            a.rz = a.prevZ + (a.z - a.prevZ) * alpha;
            a.mesh.position.x = a.rx - a.unit.world.x;
            a.mesh.position.z = a.rz - a.unit.world.z;
            if (a.unit.type.rocket) {
                a.mesh.position.y =
                    a.prevAltitude + (a.altitude - a.prevAltitude) * alpha;
            } else {
                a.mesh.rotation.y = lerpAngle(a.prevFacing, a.facing, alpha);
            }
            // Free-flight also varies altitude every step — stash lerped Y so
            // animateActor / instance sync share the same smooth height.
            if (a.unit.type.freeFlight) {
                a.mesh.userData.renderAltitude =
                    a.prevAltitude + (a.altitude - a.prevAltitude) * alpha;
            }
        }
    }

    // --- spatial hash over mobile mechs (cell must cover the largest mech pair) ---

    private hashKey(x: number, z: number): number {
        const cx = Math.floor(x / HASH_CELL) + 2048;
        const cz = Math.floor(z / HASH_CELL) + 2048;
        return cx * 4096 + cz;
    }

    private rebuildHash(): void {
        this.hash.clear();
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure || a.unit.marchIn) continue;
            const key = this.hashKey(a.x, a.z);
            const bucket = this.hash.get(key);
            if (bucket) bucket.push(a);
            else this.hash.set(key, [a]);
        }
    }

    /** attackable actors (mechs + structures) for targeting and projectile hits —
     *  marchIn actors are deliberately untargetable until they cross onto the board */
    private rebuildTargetHash(): void {
        this.targetHash.clear();
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.extra || a.unit.marchIn) continue;
            const key = this.hashKey(a.x, a.z);
            const bucket = this.targetHash.get(key);
            if (bucket) bucket.push(a);
            else this.targetHash.set(key, [a]);
        }
    }

    private rebuildStructureList(): void {
        this.structures.length = 0;
        for (const a of this.actors) {
            if (!a.alive || !a.unit.type.structure || a.unit.type.extra) continue;
            this.structures.push(a);
        }
    }

    /** mobile mechs in the 3x3 cells around an actor.
     *  Buckets are filled in canonical actor-index order; cells are visited in
     *  a fixed (ix,iz) order — deterministic without a per-call sort. */
    private nearby(a: Actor): Actor[] {
        const cx = Math.floor(a.x / HASH_CELL);
        const cz = Math.floor(a.z / HASH_CELL);
        const result = this.nearbyScratch;
        result.length = 0;
        for (let ix = -1; ix <= 1; ix++) {
            for (let iz = -1; iz <= 1; iz++) {
                const bucket = this.hash.get((cx + ix + 2048) * 4096 + (cz + iz + 2048));
                if (bucket) result.push(...bucket);
            }
        }
        return result;
    }

    /**
     * Actors whose cells overlap the xz AABB of a flight segment (plus pad).
     * Sorted by canonical index so hit-ties match a full-array scan.
     */
    /** the first own-side building hit volume this step's flight segment enters (not the shooter's host) */
    private ownBuildingOnSegment(
        p: Projectile,
        sx: number,
        sy: number,
        sz: number,
        segLen2: number,
    ): { building: Actor; t: number } | null {
        let best: { building: Actor; t: number } | null = null;
        for (const b of this.structures) {
            if (actorTeam(b) !== p.team || b.unit === p.source || b.unit.id === p.source.hostUnitId) continue;
            const type = b.unit.type;
            const bx = b.x - p.x;
            const bz = b.z - p.z;
            for (const c of type.colliders) {
                const cy = b.footY + c.y * type.meshScale;
                const cr = c.r * type.meshScale + PROJECTILE_RADIUS;
                let t = (bx * sx + (cy - p.y) * sy + bz * sz) / segLen2;
                t = Math.max(0, Math.min(1, t));
                const qx = p.x + sx * t - b.x;
                const qy = p.y + sy * t - cy;
                const qz = p.z + sz * t - b.z;
                if (qx * qx + qy * qy + qz * qz <= cr * cr && (!best || t < best.t)) best = { building: b, t };
            }
        }
        return best;
    }

    private actorsNearSegment(
        x0: number,
        z0: number,
        x1: number,
        z1: number,
        pad: number,
        team: BattleTeam,
    ): Actor[] {
        const result = this.segmentScratch;
        result.length = 0;
        const minX = Math.min(x0, x1) - pad;
        const maxX = Math.max(x0, x1) + pad;
        const minZ = Math.min(z0, z1) - pad;
        const maxZ = Math.max(z0, z1) + pad;
        const cx0 = Math.floor(minX / HASH_CELL);
        const cx1 = Math.floor(maxX / HASH_CELL);
        const cz0 = Math.floor(minZ / HASH_CELL);
        const cz1 = Math.floor(maxZ / HASH_CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cz = cz0; cz <= cz1; cz++) {
                const bucket = this.targetHash.get((cx + 2048) * 4096 + (cz + 2048));
                if (!bucket) continue;
                for (const a of bucket) {
                    if (!a.alive || actorTeam(a) === team) continue;
                    result.push(a);
                }
            }
        }
        result.sort((p, q) => p.index - q.index);
        return result;
    }

    /**
     * Structures and golden-aura mechs cannot be converted — the ray chews
     * their HP instead (same DPS stack as shield absorb / convert progress).
     */
    private convertRayDealsDamage(target: Actor): boolean {
        return !!target.unit.type.structure || this.isGolden(target);
    }

    /**
     * Wizard convert ray: progress fills at the caster's effective attack
     * (same stack as orb damage — resolved damage × level × tower attack debuff
     * × levelScale × vsLayer × convert intensityMult).
     * Enemy ward domes absorb the beam (damage the shield; no convert through).
     * Buildings and golden-aura units take the same continuous HP damage.
     * Mass Binding can lock multiple sticky channels at once.
     */
    private stepConversionRays(dt: number): void {
        // clear stale convertBy / beam tips (channelers re-assert each step)
        for (const a of this.actors) {
            a.convertBy = null;
            a.convertRayActive = false;
        }

        const d = this.config.towers.debuffPerLostTower;
        for (const caster of this.actors) {
            const ray = caster.unit.type.convertRay;
            if (!ray || !caster.alive || caster.unit.type.structure) continue;
            if (this.isSpawning(caster) || caster.unit.marchIn) continue;

            if (caster.convertCooldown > 0) {
                caster.convertCooldown = Math.max(0, caster.convertCooldown - dt);
                for (const t of caster.convertTargets) {
                    t.convertProgress = 0;
                }
                caster.convertTargets.length = 0;
                caster.convertTarget = null;
                continue;
            }

            const tuning = this.convertTuning(caster);
            const team = actorTeam(caster);
            const targets = effectiveTargets(
                caster.unit.type,
                actorSeat(caster),
                (_s, _t, techId) => this.actorHasTech(caster, techId),
                this.config.types,
            );

            const stillOk = (target: Actor): boolean =>
                target.alive &&
                actorTeam(target) !== team &&
                !target.unit.type.extra &&
                !target.unit.type.notAcquired &&
                (target.unit.type.structure ||
                    (target.altitude > 0 ? targets.air : targets.ground)) &&
                (target.unit.type.structure || target.allegiance === null);

            // validate sticky channels; drop invalid / out of range
            {
                const kept: Actor[] = [];
                for (const target of caster.convertTargets) {
                    if (!stillOk(target)) {
                        target.convertProgress = 0;
                        continue;
                    }
                    const reach =
                        this.weaponRange(caster, target, ray.range) + caster.radius + target.radius;
                    const dx = target.x - caster.x;
                    const dz = target.z - caster.z;
                    // out of reach, or a hill / building now stands between them
                    if (dx * dx + dz * dz > reach * reach || !this.rayLineOpen(caster, target)) {
                        target.convertProgress = 0;
                        continue;
                    }
                    kept.push(target);
                }
                caster.convertTargets = kept;
            }

            // fill up to maxTargets with closest unused foes
            while (caster.convertTargets.length < tuning.maxTargets) {
                const exclude = new Set(caster.convertTargets);
                const next = this.closestConvertTarget(caster, ray.range, targets, exclude);
                if (!next) break;
                next.convertProgress = 0;
                caster.convertTargets.push(next);
            }

            caster.convertTarget = caster.convertTargets[0] ?? null;
            if (caster.convertTargets.length === 0) continue;

            const stats = this.statsOf(caster);
            const from = this.convertRayOrigin(caster);
            let tipSet = false;
            let tipBlocked = false;
            let anyActive = false;

            // snapshot — convertActor may splice the list mid-loop
            const channelList = caster.convertTargets.slice();
            for (const target of channelList) {
                if (!caster.convertTargets.includes(target)) continue;

                const intensity =
                    this.hitDamage(caster, target, stats.damage, d.attackMult) * tuning.intensityMult;

                const tt = target.unit.type;
                const toY = target.footY + projectileAimY(tt) * tt.meshScale;
                const sx = target.x - from.x;
                const sy = toY - from.y;
                const sz = target.z - from.z;
                const block = this.enemyShieldHitOnSegment(from.x, from.y, from.z, sx, sy, sz, team);

                anyActive = true;
                if (block) {
                    if (target.convertProgress > 0) target.convertProgress = 0;
                    if (!tipSet) {
                        caster.convertRayTipX = block.x;
                        caster.convertRayTipY = block.y;
                        caster.convertRayTipZ = block.z;
                        tipSet = true;
                        tipBlocked = true;
                    }
                    block.shield.hp -= intensity * dt;
                    block.shield.hurtTimer = HURT_BAR_SECONDS;
                    if (block.shield.hp <= 0) this.breakShield(block.shield);
                    continue;
                }

                // prefer tip on first unblocked channel (overwrite a blocked primary tip)
                if (!tipSet || tipBlocked) {
                    caster.convertRayTipX = target.x;
                    caster.convertRayTipY = toY;
                    caster.convertRayTipZ = target.z;
                    tipSet = true;
                    tipBlocked = false;
                }

                if (this.convertRayDealsDamage(target)) {
                    if (target.convertProgress > 0) target.convertProgress = 0;
                    const dealt = intensity * dt * this.damageTakenMult(target);
                    if (dealt > 0) {
                        this.applyDamage(caster.unit, target, dealt, { x: sx, z: sz }, 'direct');
                    }
                    continue;
                }

                target.convertBy = caster;
                target.convertProgress += intensity * dt;
                target.hurtTimer = Math.max(target.hurtTimer, 0.4);

                if (target.convertProgress + 1e-9 >= target.hp) {
                    this.convertActor(caster, target);
                }
            }

            if (anyActive) caster.convertRayActive = true;
            caster.convertTarget = caster.convertTargets[0] ?? null;
        }
    }

    /**
     * Prism Cannon / Melting Point beam: sticky lock(s), exponential DPS ramp,
     * soft tip splash. Mass Binding ({@link convertTuning}) adds extra channels.
     * Horizontal fire is gated by {@link UnitType.rampBeam.fireYawHalfDeg} —
     * pitch is free; flankers that outrun turnRate break the lock.
     */
    private stepRampBeams(dt: number): void {
        const d = this.config.towers.debuffPerLostTower;
        for (const caster of this.actors) {
            const beam = caster.unit.type.rampBeam;
            if (!beam || !caster.alive || caster.unit.type.structure) continue;
            if (this.isSpawning(caster) || caster.unit.marchIn) continue;

            const targets = effectiveTargets(
                caster.unit.type,
                actorSeat(caster),
                (_s, _t, techId) => this.actorHasTech(caster, techId),
                this.config.types,
            );
            const team = actorTeam(caster);
            const tuning = this.convertTuning(caster);
            const fireHalf = Math.max(1e-3, ((beam.fireYawHalfDeg ?? 20) * Math.PI) / 180);
            const stats = this.statsOf(caster);

            const stillOk = (target: Actor): boolean =>
                target.alive &&
                actorTeam(target) !== team &&
                !target.unit.type.extra &&
                !target.unit.type.notAcquired &&
                (target.unit.type.structure ||
                    (target.altitude > 0 ? targets.air : targets.ground));

            const inReach = (target: Actor): boolean => {
                const reach =
                    this.weaponRange(caster, target, stats.range) + caster.radius + target.radius;
                const dx = target.x - caster.x;
                const dz = target.z - caster.z;
                return dx * dx + dz * dz <= reach * reach;
            };

            const aimYawOf = (target: Actor): number =>
                detAtan2(-(target.x - caster.x), -(target.z - caster.z));

            const inFireYaw = (target: Actor): boolean =>
                Math.abs(deltaAngle(caster.facing, aimYawOf(target))) <= fireHalf;

            // Turn first so this step's fire cone matches the barrel.
            const faceFocus =
                caster.rampBeamTargets.find((t) => stillOk(t) && inReach(t)) ??
                this.closestConvertTarget(caster, stats.range, targets);
            if (faceFocus) faceToward(caster, aimYawOf(faceFocus), dt);

            // Keep sticky channels that are still valid + in the fire cone.
            const kept: Actor[] = [];
            const keptLock: number[] = [];
            for (let i = 0; i < caster.rampBeamTargets.length; i++) {
                const target = caster.rampBeamTargets[i]!;
                const lockT = caster.rampBeamLockTs[i] ?? 0;
                // a hill or building between them breaks the lock
                if (!stillOk(target) || !inReach(target) || !inFireYaw(target) || !this.rayLineOpen(caster, target)) continue;
                kept.push(target);
                keptLock.push(lockT);
            }
            caster.rampBeamTargets = kept;
            caster.rampBeamLockTs = keptLock;

            // Fill up to Mass Binding maxTargets with in-cone foes.
            while (caster.rampBeamTargets.length < tuning.maxTargets) {
                const exclude = new Set(caster.rampBeamTargets);
                const next = this.closestConvertTarget(
                    caster,
                    stats.range,
                    targets,
                    exclude,
                    fireHalf,
                );
                if (!next) break;
                caster.rampBeamTargets.push(next);
                caster.rampBeamLockTs.push(0);
            }

            caster.rampBeamTarget = caster.rampBeamTargets[0] ?? null;
            if (caster.rampBeamTargets.length === 0) {
                caster.convertRayActive = false;
                continue;
            }

            const from = this.beamRayOrigin(caster);
            const doubleEvery = Math.max(1e-3, beam.doubleEvery);
            const startDps = Math.max(0, stats.damage);
            const maxDps = beam.maxDps != null ? Math.max(startDps, beam.maxDps) : Infinity;
            const splash = beam.splashRadius ?? 0;
            const splashFrac = 0.25;
            let tipSet = false;
            let anyActive = false;

            for (let i = 0; i < caster.rampBeamTargets.length; i++) {
                const target = caster.rampBeamTargets[i]!;
                const tt = target.unit.type;
                const toY = target.footY + projectileAimY(tt) * tt.meshScale;
                // Multi-channel: aim each ray at its victim (all within the fire cone).
                const sx = target.x - from.x;
                const sy = toY - from.y;
                const sz = target.z - from.z;
                const block = this.enemyShieldHitOnSegment(from.x, from.y, from.z, sx, sy, sz, team);

                const rawDps = Math.min(
                    maxDps,
                    startDps * detPow2((caster.rampBeamLockTs[i] ?? 0) / doubleEvery),
                );
                const intensity =
                    this.hitDamage(caster, target, rawDps, d.attackMult) * tuning.intensityMult;

                anyActive = true;
                if (block) {
                    caster.rampBeamLockTs[i] = 0;
                    if (!tipSet) {
                        caster.convertRayTipX = block.x;
                        caster.convertRayTipY = block.y;
                        caster.convertRayTipZ = block.z;
                        tipSet = true;
                    }
                    block.shield.hp -= intensity * dt;
                    block.shield.hurtTimer = HURT_BAR_SECONDS;
                    if (block.shield.hp <= 0) this.breakShield(block.shield);
                    continue;
                }

                caster.rampBeamLockTs[i] = (caster.rampBeamLockTs[i] ?? 0) + dt;
                if (!tipSet) {
                    caster.convertRayTipX = target.x;
                    caster.convertRayTipY = toY;
                    caster.convertRayTipZ = target.z;
                    tipSet = true;
                }

                if (splash > 0) {
                    for (const a of this.actors) {
                        if (!a.alive || actorTeam(a) === team) continue;
                        if (a.unit.type.extra) continue;
                        if (a.altitude > 0 ? !targets.air : !targets.ground) continue;
                        if (hypot(a.x - target.x, a.z - target.z) > splash + a.radius) continue;
                        const frac = a === target ? 1 : splashFrac;
                        const dealt = intensity * dt * frac * this.damageTakenMult(a);
                        if (dealt <= 0) continue;
                        this.applyDamage(
                            caster.unit,
                            a,
                            dealt,
                            { x: a.x - from.x, z: a.z - from.z },
                            'direct',
                        );
                    }
                } else {
                    const dealt = intensity * dt * this.damageTakenMult(target);
                    if (dealt > 0) {
                        this.applyDamage(caster.unit, target, dealt, { x: sx, z: sz }, 'direct');
                    }
                }
            }

            if (anyActive) caster.convertRayActive = true;
        }
    }

    /**
     * Convert-ray / ramp-beam muzzle: unit `muzzleLocal`, else GLB `AttackNode`,
     * else chest-height fallback. Uses sim xz + sim facing (never the render-interpolated mesh yaw).
     */
    private beamRayOrigin(caster: Actor): { x: number; y: number; z: number } {
        const t = caster.unit.type;
        const authored = t.rampBeam?.muzzleLocal;
        if (authored) {
            return attackNodeWorld(authored, caster.x, caster.footY, caster.z, caster.facing, t.meshScale);
        }
        const modelKey = t.modelId ?? t.id;
        const local = getUnitAttackNodeLocal(modelKey);
        if (local) {
            return attackNodeWorld(local, caster.x, caster.footY, caster.z, caster.facing, t.meshScale);
        }
        return {
            x: caster.x,
            y: caster.footY + Math.max(1.6, t.meshScale * 1.15),
            z: caster.z,
        };
    }

    /**
     * Convert-ray muzzle: GLB `AttackNode` when present, else chest-height fallback.
     * Uses sim xz + sim facing (never the render-interpolated mesh yaw).
     */
    private convertRayOrigin(caster: Actor): { x: number; y: number; z: number } {
        return this.beamRayOrigin(caster);
    }

    private closestConvertTarget(
        from: Actor,
        range: number,
        targets: { ground: boolean; air: boolean },
        exclude?: ReadonlySet<Actor> | readonly Actor[],
        /** When set, only return targets inside this yaw half-angle of facing. */
        fireYawHalf?: number,
    ): Actor | null {
        const excluded =
            exclude == null
                ? null
                : exclude instanceof Set
                  ? exclude
                  : new Set(exclude);
        const team = actorTeam(from);
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.actors) {
            if (excluded?.has(a)) continue;
            if (!a.alive || actorTeam(a) === team) continue;
            // board extras (wards) are hit via beam blocking, not as ray targets
            if (a.unit.type.extra) continue;
            if (a.unit.type.notAcquired) continue; // nobody aims a beam at him either
            if (a.unit.type.structure) {
                // buildings: always ground ray victims (damage, not convert)
            } else if (a.altitude > 0 ? !targets.air : !targets.ground) {
                continue;
            } else if (a.allegiance !== null) {
                // already converted this battle — leave alone
                continue;
            }
            const maxR = this.weaponRange(from, a, range) + from.radius + a.radius;
            const dx = a.x - from.x;
            const dz = a.z - from.z;
            const d = dx * dx + dz * dz;
            if (d > maxR * maxR) continue;
            if (fireYawHalf != null) {
                const aimYaw = detAtan2(-dx, -dz);
                if (Math.abs(deltaAngle(from.facing, aimYaw)) > fireYawHalf) continue;
            }
            const closer = d < bestD || (d === bestD && best !== null && a.index < best.index);
            if (!closer) continue;
            if (!this.rayLineOpen(from, a)) continue; // the beam can't bend over a hill
            bestD = d;
            best = a;
        }
        return best;
    }

    private convertActor(caster: Actor, target: Actor): void {
        const team = actorTeam(caster);
        const seat = actorSeat(caster);
        target.allegiance = team;
        target.allegianceSeat = seat;
        target.convertProgress = 0;
        target.convertBy = null;
        target.convertTarget = null;
        target.convertTargets.length = 0;
        // Drop the old seat's golden aura; pick up the new team's if in range.
        // (Tower debuffs already key off {@link actorSeat}, so allegiance alone
        // stops the old seat's loss from crippling this mech.)
        target.goldenUntil = 0;
        if (this.goldenAuraApplied) this.applyGoldenAura(target, undefined, true);
        // Soul Restore: full HP (and shield) after the flip
        if (this.convertTuning(caster).healFull) {
            target.hp = target.maxHp;
            if (target.shieldMaxHp > 0) target.shieldHp = target.shieldMaxHp;
        }
        // brief pause before the next channel
        const recover = caster.unit.type.convertRay?.recover ?? 1.25;
        caster.convertCooldown = recover;
        // drop anyone channeling this victim / this caster's lock
        const dropRef = (a: Actor): void => {
            const idx = a.convertTargets.indexOf(target);
            if (idx >= 0) a.convertTargets.splice(idx, 1);
            if (a.convertTarget === target) {
                a.convertTarget = a.convertTargets[0] ?? null;
            }
        };
        dropRef(caster);
        for (const a of this.actors) {
            if (a === caster) continue;
            dropRef(a);
            // converted mechs stop converting for their old side
            if (a === target) {
                a.convertTarget = null;
                a.convertTargets.length = 0;
            }
        }
        // clear attack stickies that now see a teammate
        for (const a of this.actors) {
            if (a.cachedEnemy === target && actorTeam(a) === team) a.cachedEnemy = null;
            if (target.cachedEnemy && actorTeam(target.cachedEnemy) === team) {
                target.cachedEnemy = null;
            }
        }
        this.events.push({
            kind: 'convert',
            index: target.index,
            x: target.x,
            y: target.footY + 1.2,
            z: target.z,
            team,
        });
    }

    /**
     * Prefer a sticky attack target: while the cached enemy is still alive and
     * in weapon range, keep shooting it (do not hop to a closer foe). Only
     * re-pick closest when the cache is invalid or the target leaves range.
     * Full searches are still staggered via {@link TARGET_REFRESH_STEPS}.
     * With `anyLayer` the matrix is ignored — used to pick something to walk
     * to and wait at when no attackable enemy is left.
     *
     * Min-range (dead zone): prefer any foe outside the ring (shoot or walk
     * toward). Only return a too-close foe when nothing else is left — the
     * caller then flees. Sticky chase never locks onto a dead-zone target.
     *
     * Uses an expanding-ring spatial search over {@link targetHash} (rebuilt
     * at step start) so cost stays near O(k) instead of O(n) per mech.
     */
    /**
     * A pack with a field of fire only sees foes inside it. Everyone else has
     * `fovYaw` null and sees the whole board, so this is free for them.
     */
    private inFieldOfFire(from: Actor, target: Actor): boolean {
        const fov = from.unit.fovYaw;
        if (fov == null) return true;
        const ang = detAtan2(target.x - from.x, target.z - from.z);
        return Math.abs(wrapPi(ang - fov)) <= STRONGHOLD_ARCHER_FOV_HALF;
    }

    /**
     * Ground-only vs a diving free-flyer already in contact. Used for acquire
     * and for hit rolls — never a long-range chase target.
     */
    private isOpportunisticGroundSwat(
        from: Actor,
        target: Actor,
        native: { ground: boolean; air: boolean },
    ): boolean {
        if (native.air || !native.ground) return false;
        if (!target.unit.type.freeFlight) return false;
        if (target.altitude <= 0 || target.altitude > GROUND_SWAT_MAX_ALT) return false;
        const reach = from.radius + target.radius + GROUND_SWAT_PAD;
        const dx = target.x - from.x;
        const dz = target.z - from.z;
        return dx * dx + dz * dz <= reach * reach;
    }

    /**
     * Layer filter for {@link closestEnemy}: real AA uses `wantAir`; ground-only
     * may swat low free-flyers in contact; movement fallback (`anyLayer`) must
     * not path toward bats across the map.
     */
    private allowsEnemyLayer(
        from: Actor,
        target: Actor,
        wantAir: boolean,
        wantGround: boolean,
        native: { ground: boolean; air: boolean },
    ): boolean {
        if (target.altitude > 0) {
            if (native.air && wantAir) return true;
            if (this.isOpportunisticGroundSwat(from, target, native)) return true;
            // anyLayer chase of high air (crows) — never of free-flyers
            if (wantAir && !native.air && !target.unit.type.freeFlight) return true;
            return false;
        }
        return wantGround;
    }

    /** True unless this is a ground swat that misses (deterministic ~28%). */
    private groundSwatConnects(from: Actor, target: Actor): boolean {
        const native = effectiveTargets(
            from.unit.type,
            actorSeat(from),
            (_s, _t, techId) => this.actorHasTech(from, techId),
            this.config.types,
        );
        if (!this.isOpportunisticGroundSwat(from, target, native)) return true;
        const seed = from.index * 100003 + target.index * 9176 + this.stepIndex * 131;
        return detHash01(seed) < GROUND_SWAT_CATCH;
    }

    private closestEnemy(from: Actor, anyLayer = false): Actor | null {
        const native = effectiveTargets(
            from.unit.type,
            actorSeat(from),
            (_s, _t, techId) => this.actorHasTech(from, techId),
            this.config.types,
        );
        const wantAir = anyLayer || native.air;
        const wantGround = anyLayer || native.ground;
        if (!wantAir && !wantGround) return null;

        const cacheOk = (cached: Actor): boolean =>
            cached.alive &&
            actorTeam(cached) !== actorTeam(from) &&
            !cached.unit.type.extra &&
            !cached.unit.type.notAcquired &&
            this.inFieldOfFire(from, cached) &&
            this.allowsEnemyLayer(from, cached, wantAir, wantGround, native);

        const stats = this.statsOf(from);
        const minRange = stats.minRange;
        const inDeadZone = (cached: Actor): boolean => {
            if (minRange <= 0) return false;
            const minReach = minRange + from.radius + cached.radius;
            const dx = cached.x - from.x;
            const dz = cached.z - from.z;
            return dx * dx + dz * dz < minReach * minReach;
        };
        const inWeaponRange = (cached: Actor): boolean => {
            // Swat targets use contact reach only — never full weapon kite-in.
            if (cached.altitude > 0 && !native.air) {
                return this.isOpportunisticGroundSwat(from, cached, native);
            }
            const reach = effectiveWeaponReach(
                this.weaponRange(from, cached, stats.range),
                from.radius,
                cached.radius,
                this.feetY(from),
                this.feetY(cached),
                this.elevationCounts(from, cached),
            );
            const dx = cached.x - from.x;
            const dz = cached.z - from.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > reach * reach) return false;
            if (inDeadZone(cached)) return false;
            if (!this.inFieldOfFire(from, cached)) return false;
            // a hill between us: not a fight we're in — walk, or pick another
            if (!this.attackLineOpen(from, cached)) return false;
            return true;
        };

        if (!anyLayer) {
            const cached = from.cachedEnemy;
            if (cached && cacheOk(cached) && inWeaponRange(cached)) {
                // engaged: never retarget mid-fight, even on a refresh step
                return cached;
            }
            const refresh = ((this.stepIndex + from.index) % TARGET_REFRESH_STEPS) === 0;
            // Chase sticky between refreshes — but never lock onto a dead-zone
            // foe (that would kite instead of walking to a shootable target).
            if (!refresh && cached && cacheOk(cached) && !inDeadZone(cached)) {
                return cached;
            }
        }

        const team = actorTeam(from);
        // `best` = closest foe outside the dead zone (fire at / walk toward).
        // `bestAny` = closest foe including inside min range — flee fallback
        // only when `best` is empty. For minRange 0 they're always identical.
        let best: Actor | null = null;
        let bestD = Infinity;
        let bestAny: Actor | null = null;
        let bestAnyD = Infinity;
        // foes we'd only fall back on: in range but behind terrain, or one we got stuck on
        let bestAside: Actor | null = null;
        let bestAsideD = Infinity;
        const ranged = !!from.unit.type.projectileSpeed || !!from.unit.type.convertRay || !!from.unit.type.rampBeam;
        const cx = Math.floor(from.x / HASH_CELL);
        const cz = Math.floor(from.z / HASH_CELL);

        const consider = (a: Actor): void => {
            if (!a.alive || actorTeam(a) === team) return;
            // in the hash so shots can cross him, but never picked to shoot at
            if (a.unit.type.notAcquired) return;
            if (!this.allowsEnemyLayer(from, a, wantAir, wantGround, native)) return;
            if (!this.inFieldOfFire(from, a)) return;
            const ddx = a.x - from.x;
            const ddz = a.z - from.z;
            const d = ddx * ddx + ddz * ddz;
            if (d < bestAnyD || (d === bestAnyD && bestAny !== null && a.index < bestAny.index)) {
                bestAnyD = d;
                bestAny = a;
            }
            if (minRange > 0) {
                const minReach = minRange + from.radius + a.radius;
                if (d < minReach * minReach) return; // dead zone — not a walk/shoot pick
            }
            const closer = d < bestD || (d === bestD && best !== null && a.index < best.index);
            let aside = from.shunTarget === a && from.shunUntil > this.elapsed;
            // the line-of-fire check only matters for a foe that would become the pick
            if (!aside && ranged && closer) {
                const range = this.weaponRange(from, a, stats.range);
                const outer = range + from.radius + a.radius + RANGE_ELEV_MAX_BONUS;
                if (d <= outer * outer) {
                    const reach = effectiveWeaponReach(
                        range,
                        from.radius,
                        a.radius,
                        this.feetY(from),
                        this.feetY(a),
                        this.elevationCounts(from, a),
                    );
                    aside = d <= reach * reach && !this.attackLineOpen(from, a);
                }
            }
            if (aside) {
                if (d < bestAsideD || (d === bestAsideD && bestAside !== null && a.index < bestAside.index)) {
                    bestAsideD = d;
                    bestAside = a;
                }
                return;
            }
            if (d < bestD || (d === bestD && best !== null && a.index < best.index)) {
                bestD = d;
                best = a;
            }
        };

        const scanCell = (ix: number, iz: number): void => {
            const bucket = this.targetHash.get((ix + 2048) * 4096 + (iz + 2048));
            if (!bucket) return;
            for (const a of bucket) consider(a);
        };

        for (let ring = 0; ring <= TARGET_MAX_RING; ring++) {
            // further chebyshev rings can't beat the current best
            if (best && ring > 0) {
                const minDist = (ring - 1) * HASH_CELL;
                if (minDist * minDist >= bestD) break;
            }
            if (ring === 0) {
                scanCell(cx, cz);
                continue;
            }
            for (let dx = -ring; dx <= ring; dx++) {
                scanCell(cx + dx, cz - ring);
                scanCell(cx + dx, cz + ring);
            }
            for (let dz = -ring + 1; dz <= ring - 1; dz++) {
                scanCell(cx - ring, cz + dz);
                scanCell(cx + ring, cz + dz);
            }
        }
        // Prefer outside-dead-zone (shoot or approach); only then kite the
        // closest too-close foe.
        const result = best ?? bestAside ?? bestAny;
        if (!anyLayer) {
            if (from.cachedEnemy !== result) {
                from.approachOx = 0;
                from.approachOz = 0;
                from.approachOffsetUntil = 0;
            }
            from.cachedEnemy = result;
        }
        return result;
    }
}
