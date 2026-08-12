import type { Group } from 'three';
import {
    ACID_DPS_PERCENT,
    applyBurnStatus,
    FIRE_TINT_NORMAL,
    HAZARD_DRIP_FALL_SEC,
    HazardField,
    OIL_SPEED_MULT,
    insideAnyShield,
    livingShieldDisks,
    resolveFireProfile,
    type FireProfile,
    type HazardPour,
} from './fire';
import { ITEMS } from './items';
import type { SeatId } from './seats';
import { mulberry32, simGroundHeightAt, simGroundSupportAt, worldHeightAt } from './map';
import { GROUND_UNIT_Y } from './groundQuality';
import { DEFAULT_SETTINGS, type LevelingSettings, type TowerSettings } from './settings';
import {
    HAMMER_ID,
    HAMMER_ZONE,
    METEOR_SHARD_FALL_SEC,
    RALLY_ROUTE_RADIUS,
    RALLY_ROUTE_REACH,
    RALLY_ROUTE_STUCK_SEC,
    type RallyRoute,
} from './tactics';
import { effectiveFlying, effectiveTargets, type ResolvedStats } from './tech';
import { ownedProduceTechs } from './techCatalog';
import {
    COMMAND_TOWER,
    DEPLOY_AIR_Y,
    RESEARCH_CENTER,
    bloodColorOf,
    resolveDeathWear,
    syncBattleTint,
    type BattleTeam,
    type DeathWear,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import { getUnitInstanceRenderer } from './unitInstances';
import { attackNodeWorld, getUnitAttackNodeLocal } from './unitModels';
import type { CpuTimings } from '../ui/debug';

/** how long the ballista Golden Aura keeps allies immune after the one-shot apply */
export const GOLDEN_AURA_DURATION = 30;
/** how far around a golden ballista allies get the buff (world units) */
export const GOLDEN_AURA_RADIUS = 40;
/** golden units take 30% less damage on top of debuff immunity */
export const GOLDEN_DAMAGE_TAKEN_MULT = 0.7;
/** battle clock time when ballista Golden Aura is applied once (after other pre-battle effects) */
export const GOLDEN_AURA_APPLY_AT = 0.1;
/** units stand still for this long at battle start before moving or firing */
export const BATTLE_START_FREEZE = 1.0;

export interface SimConfig {
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
    /** ticking spell zones (storm bolts, meteor shower, poison gas) */
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
}

/** one scheduled area strike (meteor, hammer, …) */
export interface SpellStrike {
    x: number;
    z: number;
    radius: number;
    damage: number;
    delaySeconds: number;
    /** which TACTICS entry — drives strike VFX (hammer ground bloom, …) */
    tacticId?: string;
    /** hammer footprint orientation (radians) */
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
    /** flat damage per tick */
    damage: number;
    mode: 'storm' | 'meteorShower' | 'poison';
    impactRadius?: number;
    igniteRadius?: number;
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
    /**
     * world Y of the actor's feet this step: terrain support for ground units,
     * absolute air altitude for flyers. Projectiles aim at / hit relative to this.
     */
    footY: number;
    /** rocket extras: the enemy being homed onto once launched */
    rocketTarget: Actor | null;
    /** sim time until which this mech ignores tower-destruction debuffs (ballista aura) */
    goldenUntil: number;
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
    /** sticky attack target — held while in range; closest search when not */
    cachedEnemy: Actor | null;
    /** burn DoT: sim time when it expires (0 = not burning) */
    burnUntil: number;
    /** burn damage per second while burnUntil > elapsed */
    burnDps: number;
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
    /** sticky convert-ray victim (wizard second weapon) */
    convertTarget: Actor | null;
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
    /** render-only: fire recoil 0..1, decays each frame (never read by the sim step) */
    recoil?: number;
    /** render-only: last frame's cooldown, to detect a fresh shot */
    prevCooldown?: number;
}

/** Combat team for targeting / scoring — honors mid-battle converts. */
export function actorTeam(a: Actor): BattleTeam {
    return a.allegiance ?? a.unit.team;
}

/** Combat seat while converted, else deploy seat. */
export function actorSeat(a: Actor): number {
    return a.allegiance !== null ? a.allegianceSeat : a.unit.seat;
}

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
    /** gravity (world units/s²) for lobbed shots — absent = straight flight */
    gravity?: number;
    /** homing shots chase this actor and hit nothing else */
    target?: Actor;
    ttl: number;
}

/** visual happenings the renderer turns into particles (drained per frame) */
export type SimEvent =
    | { kind: 'muzzle'; x: number; y: number; z: number }
    /** `blood` = victim gore tint when hitting flesh (omit = default red / debris).
     *  `dx/dy/dz` = normalized hit direction (bullet/strike travel) so blood
     *  sprays out the far side; omit for undirected (ground / shield) impacts. */
    | { kind: 'impact'; x: number; y: number; z: number; blood?: number; dx?: number; dy?: number; dz?: number }
    | { kind: 'explosion'; x: number; y: number; z: number; radius: number; heavy?: boolean }
    | { kind: 'death'; x: number; y: number; z: number; big: boolean; wear: DeathWear; blood?: number }
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
      }
    | { kind: 'summon'; x: number; y: number; z: number; flying: boolean }
    /** meteor-shower shard cue — visual falls until `at`, then sim resolves hit */
    | { kind: 'spellMeteor'; x: number; z: number; at: number }
    /** oil/acid drip cue — blob falls until `at`, then that disc stamps on the ground */
    | { kind: 'hazardDrip'; hazard: 'oil' | 'acid' | 'fire'; x: number; z: number; at: number }
    /** storm lightning bolt cue (render-only) */
    | { kind: 'spellLightning'; x: number; z: number }
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
/** ballista / catapult lob — strong enough to read as an arc at long range */
const BALLISTIC_GRAVITY = 28;

/**
 * Deterministic replacement for Math.hypot: sqrt IS correctly rounded per
 * IEEE-754 in every engine, Math.hypot is NOT — a lockstep-multiplayer
 * hazard across browsers.
 */
function hypot(x: number, y: number, z = 0): number {
    return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Deterministic replacements for Math.sin/cos — same hazard as Math.hypot
 * above (implementation-approximated per spec, not guaranteed bit-identical
 * across engines) but strikeHits' Hammer rectangle test below feeds a real
 * hit/miss decision, not just a visual offset. Range-reduced Taylor series
 * to x^11, built from only +, -, *, / (exactly specified by IEEE-754), so
 * every peer computes identical bits regardless of engine.
 */
function wrapPi(a: number): number {
    const twoPi = Math.PI * 2;
    return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}

/** exported for reuse anywhere else a deterministic angle→offset conversion
 *  feeds a value that must agree across peers (see game.ts's production-
 *  reserve parking and horde camp-scatter spawn points) */
export function detSin(a: number): number {
    let x = wrapPi(a);
    // fold into [-π/2, π/2], where the series below converges tightly
    if (x > Math.PI / 2) x = Math.PI - x;
    else if (x < -Math.PI / 2) x = -Math.PI - x;
    const x2 = x * x;
    return (
        x *
        (1 +
            x2 *
                (-1 / 6 +
                    x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 - x2 / 39916800)))))
    );
}

export function detCos(a: number): number {
    return detSin(a + Math.PI / 2);
}

/** circle (default) or hammer rectangle footprint — includes actor radius as padding */
function strikeHits(s: SpellStrike, x: number, z: number, pad: number): boolean {
    if (s.tacticId === HAMMER_ID) {
        const yaw = s.yaw ?? 0;
        const c = detCos(yaw);
        const sn = detSin(yaw);
        const dx = x - s.x;
        const dz = z - s.z;
        const lx = dx * c + dz * sn;
        const lz = -dx * sn + dz * c;
        return (
            Math.abs(lx) <= HAMMER_ZONE.halfWidth + pad &&
            Math.abs(lz) <= HAMMER_ZONE.halfDepth + pad
        );
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
const HASH_CELL = 8; // ≥ biggest mech-pair contact distance
/** expanding-ring cap for closest-enemy search (map diagonal ≪ this × cell) */
const TARGET_MAX_RING = 48;
/** above this many living mobile mechs, drop soft crowd separation entirely */
export const SOFT_CROWD_LIMIT = 2000;
/** soft crowd runs every N steps per mech (staggered by index), like retargeting */
const CROWD_EVERY_STEPS = 6;
/** re-run closestEnemy only every N steps (staggered by actor index) */
const TARGET_REFRESH_STEPS = 30;

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
    private static readonly STEP = 1 / 30;

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
    /** damage dealt per `${team}:${typeId}` — the post-battle report data */
    readonly damageByType = new Map<string, number>();
    /** ballista Golden Aura is a one-shot at {@link GOLDEN_AURA_APPLY_AT}, not continuous */
    private goldenAuraApplied = false;
    /** duration of the previous sim step — converts actor.mv* into velocity for lead aim */
    private prevStepDt = 1 / 30;
    /** when true, step() accumulates timings into {@link lastProfile} */
    profileEnabled = false;
    /** ms spent in the last {@link update} call (summed across catch-up steps) */
    lastProfile: CpuTimings = {};
    /** how many fixed steps the last update() ran */
    lastProfileSteps = 0;
    /** increments every step — used to stagger target refresh */
    private stepIndex = 0;
    /** soft mech-vs-mech separation enabled this step */
    private softCrowd = true;
    /** living non-structure mechs — last computed in step() / readable for debug */
    lastMobileCount = 0;
    /** whether soft crowd was enabled on the last step */
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
    }[] = [];

    constructor(
        units: readonly Unit[],
        private readonly config: SimConfig,
    ) {
        this.hazards = config.oilField?.cloneForBattle() ?? new HazardField();
        for (const unit of units) {
            if (unit.destroyed) {
                if (this.isDebuffBuilding(unit)) {
                    this.extendSeatDebuff(unit.seat, unit.level);
                }
                continue; // rubble is not a target
            }
            const stats = config.statsOf(unit);
            this.resolved.set(unit, stats);
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
                    cooldown: 0, // assigned canonically below
                    alive: true,
                    radius: unit.type.collisionRadius,
                    index: 0,
                    hurtTimer: 0,
                    altitude: effectiveFlying(unit.type, unit.seat, this.config.hasTech),
                    footY: effectiveFlying(unit.type, unit.seat, this.config.hasTech),
                    rocketTarget: null,
                    goldenUntil: 0,
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
                    cachedEnemy: null,
                    burnUntil: 0,
                    burnDps: 0,
                    corrodedUntil: 0,
                    appearAt: 0,
                    appeared: true,
                    allegiance: null,
                    allegianceSeat: unit.seat,
                    convertTarget: null,
                    convertProgress: 0,
                    convertBy: null,
                    convertCooldown: 0,
                    convertRayTipX: 0,
                    convertRayTipY: 0,
                    convertRayTipZ: 0,
                    convertRayActive: false,
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
            const stats = this.resolved.get(a.unit)!;
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
        this.softCrowd = mobile <= SOFT_CROWD_LIMIT;
        this.lastSoftCrowd = this.softCrowd;
    }

    /** snapshot at battle start: mechs inside a route's start circle march to a
     *  matching offset at mid, then the same offset at end. Overlapping zones:
     *  last-placed route wins. */
    private assignRallyRoutes(routes: readonly RallyRoute[]): void {
        this.rallyRoutes = routes;
        const r2 = RALLY_ROUTE_RADIUS * RALLY_ROUTE_RADIUS;
        for (const route of routes) {
            for (const a of this.actors) {
                if (!a.alive || a.unit.type.structure || a.unit.team !== route.team) continue;
                if (a.spawnUntil > BATTLE_START_FREEZE + 1e-9) continue;
                const dx = a.x - route.startX;
                const dz = a.z - route.startZ;
                if (dx * dx + dz * dz > r2) continue;
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
        return !this.hasMobileMechs('player') || !this.hasMobileMechs('enemy');
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
     */
    private applyDamage(source: Unit, target: Actor, amount: number): void {
        source.damageDealt += Math.min(amount, Math.max(0, target.hp));
        target.hp -= amount;
        this.recordDamage(source, amount);
        target.hurtTimer = HURT_BAR_SECONDS;
        if (target.spawnUntil > this.elapsed + 1e-9) target.spawnDamaged = true;
        if (target.hp <= 0) this.kill(target, source);
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
    ): void {
        if (!profile) return;
        if (profile.oil) {
            const shields = livingShieldDisks(this.actors.map((a) => a.unit));
            const expires = this.config.oilExpiresRound ?? 9999;
            this.hazards.stampOil(
                x,
                z,
                profile.oil.radius,
                expires,
                shields,
                this.elapsed,
            );
        }
        if (profile.ground) {
            const g = profile.ground;
            const oilCells = this.hazards.stampFire(
                x,
                z,
                g.radius,
                this.elapsed,
                g.duration,
                g.intensity,
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
        const r = Math.max(radius, profile.ground?.radius ?? profile.oil?.radius ?? 0);
        for (const a of this.actors) {
            if (!a.alive) continue;
            if (hypot(a.x - x, a.z - z) > r + a.radius) continue;
            this.applyBurn(a, profile);
        }
    }

    private fireProfileOf(source: Unit): FireProfile | undefined {
        return resolveFireProfile(source.type, source.seat, this.config.hasTech);
    }

    /** burn DoT + standing in ground fire (both friendly-fire) */
    private stepHazards(dt: number): void {
        this.hazards.tickFire(this.elapsed);
        // burning cells never leave oil behind when the flames go out
        this.hazards.consumeOilUnderFire(this.elapsed);
        this.hazards.igniteOilTouchingFire(this.elapsed);
        for (const a of this.actors) {
            if (!a.alive) continue;
            if (a.altitude > 0) {
                // air: clear any burn that somehow stuck (e.g. landed then took off)
                continue;
            }
            if (a.unit.type.extra) continue;

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

            // acid: continuous percent-of-max-HP damage while standing in the
            // cell — same technical mechanism as oil's speed-slow (a per-step
            // field read, gone the instant the unit steps off), no lingering
            // DoT of its own. The corroded debuff (extra damage taken from
            // EVERYTHING) is what lingers, via CORRODE_LINGER_SECONDS below.
            // Ground hazard like oil/fire: ward domes do not block it.
            if (!a.unit.type.structure && this.hazards.hasAcidAt(a.x, a.z)) {
                const dealt = ((a.maxHp * ACID_DPS_PERCENT) / 100) * dt * this.damageTakenMult(a);
                this.applyBurnDamage(a, dealt);
                a.corrodedUntil = this.elapsed + CORRODE_LINGER_SECONDS;
            }
        }
    }

    /** DoT damage: no pack XP attribution (environmental) */
    private applyBurnDamage(target: Actor, amount: number): void {
        if (amount <= 0 || !target.alive) return;
        target.hp -= amount;
        target.hurtTimer = HURT_BAR_SECONDS;
        if (target.spawnUntil > this.elapsed + 1e-9) target.spawnDamaged = true;
        if (target.hp <= 0) this.kill(target, null);
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
            const owned = ownedProduceTechs(parent.type, parent.seat, this.config.hasTech);
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
            const owned = ownedProduceTechs(a.unit.type, a.unit.seat, this.config.hasTech);
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
            const parentAlive = this.actors.some((a) => a.unit === parent && a.alive);
            if (!parentAlive) continue;
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

    /** one tick of a storm / meteor shower / poison zone (all point-targeted) */
    private tickSpellZone(z: (typeof this.zones)[number], tickAt: number): void {
        if (z.mode === 'storm') {
            // one lightning bolt at a random unit inside — canonical actor
            // order + the zone's own rng keep the pick deterministic
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
                dome.hp -= z.damage;
                dome.hurtTimer = HURT_BAR_SECONDS;
                if (dome.hp <= 0) this.breakShield(dome);
                this.events.push({ kind: 'impact', x: dome.x, y: 3, z: dome.z });
                this.events.push({ kind: 'spellLightning', x: dome.x, z: dome.z });
            } else {
                this.applyBurnDamage(target, z.damage);
                this.events.push({
                    kind: 'explosion',
                    x: target.x,
                    y: target.footY + 0.8,
                    z: target.z,
                    radius: 2.5,
                });
                this.events.push({ kind: 'spellLightning', x: target.x, z: target.z });
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
        // poison: gas gnaws at EVERY unit inside — seeps under ward domes;
        // only poison-proof unit types ignore it
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.extra || a.unit.type.poisonImmune) continue;
            if (hypot(a.x - z.x, a.z - z.z) > z.radius + a.radius) continue;
            this.applyBurnDamage(a, z.damage);
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
            );
            this.events.push({
                kind: 'groundFire',
                x: m.x,
                y: simGroundHeightAt(m.x, m.z),
                z: m.z,
                radius: m.igniteRadius,
                oilCells,
            });
        }
    }

    /**
     * One area strike: everything in the blast takes environmental damage
     * (both teams, air included) — except targets under a living ward dome.
     * Each dome involved eats the strike damage ONCE and can break.
     * Hammer uses the HAMMER_ZONE rectangle; other strikes use a circle.
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
            this.events.push({ kind: 'impact', x: intercept.x, y: 3, z: intercept.z });
            return;
        }
        const y = simGroundHeightAt(s.x, s.z);
        const hammer = s.tacticId === HAMMER_ID;
        // particles/scorch: cover the hammer footprint (approx half-diagonal)
        const visualRadius = hammer
            ? Math.sqrt(HAMMER_ZONE.halfWidth * HAMMER_ZONE.halfWidth + HAMMER_ZONE.halfDepth * HAMMER_ZONE.halfDepth)
            : s.radius;
        this.events.push({
            kind: 'explosion',
            x: s.x,
            y: y + 0.6,
            z: s.z,
            radius: visualRadius,
            heavy: hammer,
        });
        this.applySpellDiscDamage(s.x, s.z, s.radius, s.damage, s);
    }

    /**
     * Direct disc (or strike footprint) damage with Great Meteor shield rules:
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
            this.applyBurnDamage(a, damage);
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

    private hasMobileMechs(team: Team): boolean {
        // dormant summons count — the battle must not end while reinforcements
        // are still on their way in
        return this.actors.some(
            (a) =>
                actorTeam(a) === team &&
                !a.unit.type.structure &&
                (a.alive || (a.appearAt > 0 && !a.appeared)),
        );
    }

    /** Command Tower or Research Center specifically — NOT Stronghold, and
     *  NOT any other non-extra structure. Only these two trigger the
     *  tower-destruction debuff; Stronghold loss is a separate, currently
     *  undecided penalty (deliberately no debuff of its own for now). */
    private isDebuffBuilding(unit: Unit): boolean {
        return unit.type === COMMAND_TOWER || unit.type === RESEARCH_CENTER;
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

    /** tower-destruction debuff is active for this mech's OWN seat right now
     *  (not its side/team — a teammate's building loss never debuffs it) */
    private isDebuffed(actor: Actor): boolean {
        if (this.isGolden(actor)) return false;
        const until = this.debuffUntil.get(actor.unit.seat) ?? 0;
        return this.elapsed < until - 1e-9;
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

    /** golden item on the pack, or a recent ballista aura buff */
    isGolden(actor: Actor): boolean {
        for (const id of actor.unit.items) {
            if (ITEMS[id]?.debuffImmune) return true;
        }
        return actor.goldenUntil > this.elapsed + 1e-9;
    }

    /** one-shot at {@link GOLDEN_AURA_APPLY_AT}: allies in range of a golden ballista get 30s immunity */
    private applyBallistaGoldenAura(): void {
        const r2 = GOLDEN_AURA_RADIUS * GOLDEN_AURA_RADIUS;
        const expires = GOLDEN_AURA_APPLY_AT + GOLDEN_AURA_DURATION;
        for (const f of this.actors) {
            if (!f.alive || f.unit.type.id !== 'ballista') continue;
            if (!this.config.hasTech(f.unit.seat, 'ballista', 'golden')) continue;
            for (const a of this.actors) {
                if (!a.alive || actorTeam(a) !== actorTeam(f) || a.unit.type.structure) continue;
                const dx = a.x - f.x;
                const dz = a.z - f.z;
                if (dx * dx + dz * dz <= r2) a.goldenUntil = Math.max(a.goldenUntil, expires);
            }
        }
    }

    /** golden tint on golden mechs; wild color shift while tower debuff timer runs.
     *  `debuffTintAt` gates the psychedelic tint only (stats stay immediate) — used
     *  so the shockwave rim can “reveal” the look as it sweeps. */
    syncBattleVisuals(
        timeSeconds: number,
        debuffTintAt?: (seat: SeatId, x: number, z: number) => boolean,
    ): void {
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            // debuff severity is flat now (see debuff/isDebuffed) — no
            // count to reflect, just whether it's active or not
            let tint: 'normal' | 'golden' | 'debuff' | 'spawning' = 'normal';
            let spawnProgress = 0;
            if (this.isGolden(a)) tint = 'golden';
            else if (this.isDebuffed(a) && (debuffTintAt?.(a.unit.seat, a.x, a.z) ?? true)) {
                tint = 'debuff';
            } else if (this.isSpawning(a)) {
                tint = 'spawning';
                spawnProgress = this.spawnProgress(a);
            }
            syncBattleTint(a.mesh, tint, timeSeconds, 1, spawnProgress);
            this.animateActor(a, timeSeconds);
        }
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
        if (a.cooldown > prevCd + 1e-4) a.recoil = 1;
        a.prevCooldown = a.cooldown;
        const recoil = a.recoil ?? 0;

        // walk factor from per-step displacement (0 standing, ~1 at full speed)
        const moving = Math.min(1, Math.hypot(a.x - a.prevX, a.z - a.prevZ) / 0.12);
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
                const gait = Math.sin(timeSeconds * 9 + a.index);
                a.mesh.position.y = groundY + Math.abs(gait) * 0.16 * moving + recoil * 0.06;
                a.mesh.rotation.z = gait * 0.06 * moving; // side-to-side roll
                a.mesh.rotation.x = -0.06 * moving; // slight lean — kept small so noses don't dig in
            } else {
                a.mesh.position.y = groundY;
            }
        } else {
            // climb from deployment hover (ground + DEPLOY_AIR_Y) to the combat
            // air layer via unit.flightLift — battle used to snap to altitude
            // immediately, which read as a teleport especially on hills
            const lift = a.unit.flightLift;
            const fromY = worldHeightAt(a.rx, a.rz) + DEPLOY_AIR_Y;
            const y = fromY + (a.altitude - fromY) * lift;
            a.mesh.position.y = y + Math.sin(timeSeconds * 2 + a.index) * 0.35 * lift;
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

        // recoil kicks the unit backward along its facing, then decays
        if (recoil > 0.01) {
            a.mesh.position.x += Math.sin(yaw) * recoil * 0.3;
            a.mesh.position.z += Math.cos(yaw) * recoil * 0.3;
            a.recoil = recoil * 0.8;
        } else {
            a.recoil = 0;
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
                a.spawnUntil = 0;
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
        const value = costOf(victim.unit.type) / victim.unit.members.length;
        if (value <= 0) return;
        const threshold = costOf(killer.type) * leveling.xpThresholdFactor * killer.level;
        killer.xp = Math.min(killer.xp + value, threshold);
    }

    private kill(target: Actor, killer: Unit | null): void {
        if (killer) killer.kills++;
        // no XP for executing a still-spawning pack — it never fully arrived
        if (killer && !target.unit.type.structure && !this.isSpawning(target)) {
            this.grantXp(killer, target);
        }
        target.alive = false;
        const t = target.unit.type;
        const wear = resolveDeathWear(t);
        this.events.push({
            kind: 'death',
            x: target.x,
            y: target.altitude + t.meshScale * 0.8,
            z: target.z,
            big: target.radius >= 2 || !!t.structure,
            wear,
            blood: wear === 'blood' ? bloodColorOf(t) : undefined,
        });
        if (t.structure) {
            target.unit.markDestroyed();
            if (this.isDebuffBuilding(target.unit)) {
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
        } else {
            // tip over and stay as a battlefield wreck until the round resets
            // (air units crash to the ground)
            target.mesh.rotation.z = (target.index % 2 ? 1 : -1) * (0.75 + (target.index % 4) * 0.08);
            target.mesh.position.y = worldHeightAt(target.x, target.z) + GROUND_UNIT_Y;
            target.mesh.userData.dead = true;
            getUnitInstanceRenderer()?.setDead(target.mesh);
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
        }
        for (const p of this.projectiles) {
            p.px = p.x;
            p.py = p.y;
            p.pz = p.z;
        }

        if (!this.goldenAuraApplied && this.elapsed >= GOLDEN_AURA_APPLY_AT) {
            this.applyBallistaGoldenAura();
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
        this.softCrowd = mobile <= SOFT_CROWD_LIMIT;
        this.lastSoftCrowd = this.softCrowd;

        const d = this.config.towers.debuffPerLostTower;
        mark();
        this.rebuildHash();
        this.rebuildTargetHash();
        this.rebuildStructureList();
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
            const stats = this.resolved.get(a.unit)!;

            let canAttack = true;
            let target = this.closestEnemy(a);
            if (!target) {
                canAttack = false;
                target = this.closestEnemy(a, true);
            }

            if (onPath && a.pathDestX !== null && a.pathDestZ !== null) {
                const destX = a.pathDestX;
                const destZ = a.pathDestZ;
                const isMelee = !a.unit.type.projectileSpeed && !a.unit.type.convertRay;

                if (target) {
                    const tdx = target.x - a.x;
                    const tdz = target.z - a.z;
                    const tDist = hypot(tdx, tdz) || 1e-6;
                    const reach = stats.range + a.radius + target.radius;
                    if (tDist <= reach) {
                        if (isMelee) {
                            if (canAttack) a.cooldown -= dt;
                            if (canAttack && a.cooldown <= 0) {
                                a.cooldown += stats.attackInterval;
                                const damage =
                                    stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                                if (damage > 0) {
                                    const dealt = damage * this.damageTakenMult(target);
                                    this.applyDamage(a.unit, target, dealt);
                                    const mlen = hypot(target.x - a.x, target.z - a.z) || 1;
                                    this.events.push({
                                        kind: 'impact',
                                        x: target.x,
                                        y: 0.6,
                                        z: target.z,
                                        blood: bloodColorOf(target.unit.type),
                                        dx: (target.x - a.x) / mlen,
                                        dy: 0,
                                        dz: (target.z - a.z) / mlen,
                                    });
                                }
                            }
                            a.mesh.rotation.y = Math.atan2(-tdx, -tdz);
                            continue;
                        }
                        // ranged / convert-ray on a rally route: fire while marching
                        if (a.unit.type.projectileSpeed) {
                            if (canAttack) a.cooldown -= dt;
                            if (canAttack && a.cooldown <= 0) {
                                a.cooldown += stats.attackInterval;
                                const damage =
                                    stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                                this.fire(a, target, damage, a.unit.type.projectileSpeed);
                            }
                        }
                    }
                }

                const dx = destX - a.x;
                const dz = destZ - a.z;
                const dist = hypot(dx, dz) || 1e-6;
                this.steerToward(a, dx / dist, dz / dist, dist, dt, stats, d, target, bigs);
                continue;
            }

            if (!target) continue;

            const dx = target.x - a.x;
            const dz = target.z - a.z;
            const dist = hypot(dx, dz) || 1e-6;
            // range is surface-to-surface: collision circles must not keep
            // melee mechs from ever "reaching" wide targets like towers
            const reach = stats.range + a.radius + target.radius;

            if (dist <= reach) {
                // in range: stand and fire (still gets jostled by the crowd)
                if (a.unit.type.projectileSpeed) {
                    if (canAttack) a.cooldown -= dt;
                    if (canAttack && a.cooldown <= 0) {
                        a.cooldown += stats.attackInterval;
                        const damage =
                            stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                        this.fire(a, target, damage, a.unit.type.projectileSpeed);
                    }
                } else if (!a.unit.type.convertRay) {
                    // melee: instant hit (convert-only units skip — ray is their weapon)
                    if (canAttack) a.cooldown -= dt;
                    if (canAttack && a.cooldown <= 0) {
                        a.cooldown += stats.attackInterval;
                        const damage =
                            stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                        if (damage > 0) {
                            const dealt = damage * this.damageTakenMult(target);
                            this.applyDamage(a.unit, target, dealt);
                            this.events.push({
                                kind: 'impact',
                                x: target.x,
                                y: 0.6,
                                z: target.z,
                                blood: bloodColorOf(target.unit.type),
                                dx: dx / dist,
                                dy: 0,
                                dz: dz / dist,
                            });
                        }
                    }
                }
                a.mesh.rotation.y = Math.atan2(-dx, -dz);
                continue;
            }

            this.steerToward(a, dx / dist, dz / dist, dist, dt, stats, d, target, bigs, reach * 0.95);
        }
        add('ai');

        mark();
        this.stepConversionRays(dt);
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
        add('projectiles');
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
    ): void {
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
            const sx = a.x - b.x;
            const sz = a.z - b.z;
            const sd = hypot(sx, sz);
            const minD = a.radius + b.radius + SEPARATION_GAP;
            if (sd >= minD || sd < 1e-4) continue;
            const w = ((minD - sd) / minD) * SEPARATION_STRENGTH;
            steerX += (sx / sd) * w;
            steerZ += (sz / sd) * w;
        }

        const steerLen = hypot(steerX, steerZ);
        if (steerLen > 1e-4) {
            steerX /= steerLen;
            steerZ /= steerLen;
            const speed =
                stats.speed *
                this.debuff(a, d.speedMult) *
                (a.altitude === 0 && this.hazards.hasOilAt(a.x, a.z) ? OIL_SPEED_MULT : 1);
            const move = Math.min(speed * dt, Math.max(0, goalDist - stopMargin));
            a.x += steerX * move;
            a.z += steerZ * move;
            a.mesh.rotation.y = Math.atan2(-steerX, -steerZ);
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
        const stats = this.resolved.get(a.unit);
        const speed = stats?.speed ?? 0;
        const move = speed * dt;
        a.x += (-a.x / dist) * move;
        a.z += (-a.z / dist) * move;
        a.mesh.rotation.y = Math.atan2(a.x / dist, a.z / dist);
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
        this.events.push({ kind: 'death', x: s.x, y: 2, z: s.z, big: true, wear: resolveDeathWear(s.unit.type) });
    }

    /** spawns a bullet from the shooter's muzzle toward the target's primary hit volume */
    private fire(a: Actor, target: Actor, damage: number, speed: number): void {
        const at = a.unit.type;
        const tt = target.unit.type;
        const dirX = target.x - a.x;
        const dirZ = target.z - a.z;
        const flat = hypot(dirX, dirZ) || 1e-6;
        // arrows spawn from the unit center so they don't pop out ahead of the mesh
        const fromCenter = at.projectileStyle === 'arrow' || at.projectileStyle === 'largeArrow';
        const shooterFeet = this.feetY(a);
        const muzzleY =
            at.projectileLaunchHeight !== undefined
                ? shooterFeet + at.projectileLaunchHeight
                : shooterFeet + (at.colliders[0]?.y ?? 0.5) * at.meshScale + (fromCenter ? 0 : 0.4);
        const mx = fromCenter ? a.x : a.x + (dirX / flat) * (a.radius + 0.5);
        const mz = fromCenter ? a.z : a.z + (dirZ / flat) * (a.radius + 0.5);
        const aim = tt.colliders[0] ?? { y: 0.5, r: 0.5 };
        let aimX = target.x;
        let aimZ = target.z;
        let dx = aimX - mx;
        let dz = aimZ - mz;
        let dy = this.feetY(target, aimX, aimZ) + aim.y * tt.meshScale - muzzleY;

        let vx: number;
        let vy: number;
        let vz: number;
        let gravity: number | undefined;
        if (at.projectileBallistic) {
            // horizontal speed toward a lead point; loft so the bolt lands near aim height
            const dtPrev = this.prevStepDt || 1e-3;
            const tvx = target.mvX / dtPrev;
            const tvz = target.mvZ / dtPrev;
            let flatDist = hypot(dx, dz) || 1e-6;
            // honest time-to-target (no artificial floor — that lofted short shots past the aim)
            let flightTime = Math.max(1e-3, flatDist / speed);
            // one refine so closing enemies still get clipped without homing
            for (let i = 0; i < 2; i++) {
                aimX = target.x + tvx * flightTime;
                aimZ = target.z + tvz * flightTime;
                dx = aimX - mx;
                dz = aimZ - mz;
                flatDist = hypot(dx, dz) || 1e-6;
                flightTime = Math.max(1e-3, flatDist / speed);
            }
            dy = this.feetY(target, aimX, aimZ) + aim.y * tt.meshScale - muzzleY;
            gravity = BALLISTIC_GRAVITY;
            vx = (dx / flatDist) * speed;
            vz = (dz / flatDist) * speed;
            vy = dy / flightTime + 0.5 * gravity * flightTime;
        } else {
            const len = hypot(dx, dy, dz) || 1e-6;
            vx = (dx / len) * speed;
            vy = (dy / len) * speed;
            vz = (dz / len) * speed;
        }

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
            gravity,
            target: at.homing ? target : undefined,
            ttl: PROJECTILE_TTL,
        });
        this.events.push({ kind: 'muzzle', x: mx, y: muzzleY, z: mz });
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
                const aim = tt.colliders[0] ?? { y: 0.5, r: 0.5 };
                const dx = p.target.x - p.x;
                const dy = p.target.footY + aim.y * tt.meshScale - p.y;
                const dz = p.target.z - p.z;
                const len = hypot(dx, dy, dz) || 1e-6;
                const speed = hypot(p.vx, p.vy, p.vz);
                p.vx = (dx / len) * speed;
                p.vy = (dy / len) * speed;
                p.vz = (dz / len) * speed;
            }
            // lobbed shots tip over under gravity (arrow mesh follows velocity)
            if (p.gravity) p.vy -= p.gravity * dt;
            const nx = p.x + p.vx * dt;
            const ny = p.y + p.vy * dt;
            const nz = p.z + p.vz * dt;
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
                });
                if (shield.hp <= 0) this.breakShield(shield);
                continue; // bullet absorbed
            }

            const splash = this.resolved.get(p.source)?.splashRadius ?? p.source.type.splashRadius ?? 0;
            if (hit) {
                const ix = p.x + sx * hitT;
                const iy = p.y + sy * hitT;
                const iz = p.z + sz * hitT;
                if (splash > 0) {
                    this.explode(p, ix, iz, splash);
                    this.events.push({ kind: 'explosion', x: ix, y: iy, z: iz, radius: splash });
                } else {
                    const dealt = p.damage * this.damageTakenMult(hit);
                    this.applyDamage(p.source, hit, dealt);
                    const slen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                    this.events.push({
                        kind: 'impact',
                        x: ix,
                        y: iy,
                        z: iz,
                        blood: bloodColorOf(hit.unit.type),
                        dx: sx / slen,
                        dy: sy / slen,
                        dz: sz / slen,
                    });
                    this.applyFireAt(p.source, ix, iz, hit.radius, this.fireProfileOf(p.source));
                    this.applyCorrodeOnHit(p.source, hit);
                }
                continue; // bullet consumed
            }
            // gameplay collision — must be identical on all machines
            const groundY = simGroundHeightAt(nx, nz);
            if (ny <= groundY) {
                // splash shells detonate on the ground too — a miss still hurts
                if (splash > 0) {
                    this.explode(p, nx, nz, splash);
                    this.events.push({ kind: 'explosion', x: nx, y: groundY + 0.15, z: nz, radius: splash });
                } else {
                    this.events.push({ kind: 'impact', x: nx, y: groundY + 0.15, z: nz });
                    this.applyFireAt(p.source, nx, nz, 0, this.fireProfileOf(p.source));
                }
                continue;
            }
            p.x = nx;
            p.y = ny;
            p.z = nz;
            p.ttl -= dt;
            if (p.ttl <= 0) continue;
            this.projectiles[write++] = p;
        }
        this.projectiles.length = write;
    }

    /**
     * Splash: full damage to every enemy within the radius of the impact,
     * respecting the shooter's can-attack matrix (a ground-only ballista's
     * blast doesn't reach crow riders overhead).
     */
    private explode(
        p: { damage: number; team: BattleTeam; source: Unit },
        x: number,
        z: number,
        radius: number,
    ): void {
        const targets = effectiveTargets(
            p.source.type,
            p.source.seat,
            this.config.hasTech,
        );
        for (const a of this.actors) {
            if (!a.alive || actorTeam(a) === p.team) continue;
            if (a.unit.type.extra) continue; // extras are immune to blasts too
            if (a.altitude > 0 ? !targets.air : !targets.ground) continue;
            if (hypot(a.x - x, a.z - z) > radius + a.radius) continue;
            const dealt = p.damage * this.damageTakenMult(a);
            this.applyDamage(p.source, a, dealt);
            this.applyCorrodeOnHit(p.source, a);
        }
        // burn + ground fire (friendly fire) — after kinetic hits
        this.applyFireAt(p.source, x, z, radius, this.fireProfileOf(p.source));
    }

    /** mass-based push-out: heavy units shove light ones aside, structures never move */
    private resolveOverlaps(): void {
        // soft mech-vs-mech is staggered across steps — one pass per involved mech
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure || a.unit.marchIn) continue;
            if (this.softCrowdActive(a)) {
                for (const b of this.nearby(a)) {
                    if (b.index <= a.index || !b.alive || b.unit.type.structure) continue;
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

    /** soft crowd on for this mech this step (limit + stagger — deterministic). */
    private softCrowdActive(a: Actor): boolean {
        return this.softCrowd && (this.stepIndex + a.index) % CROWD_EVERY_STEPS === 0;
    }

    private pushApart(a: Actor, b: Actor): void {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const dist = hypot(dx, dz);
        const minD = a.radius + b.radius;
        if (dist >= minD || dist < 1e-6) return;
        const overlap = minD - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        if (b.unit.type.structure) {
            a.x += nx * overlap;
            a.z += nz * overlap;
            return;
        }
        const massA = a.radius * a.radius;
        const massB = b.radius * b.radius;
        const shareA = massB / (massA + massB);
        a.x += nx * overlap * shareA;
        a.z += nz * overlap * shareA;
        b.x -= nx * overlap * (1 - shareA);
        b.z -= nz * overlap * (1 - shareA);
    }

    /** leftover fraction of a step not yet simulated — the interpolation weight */
    get alpha(): number {
        return this.accumulator / BattleSim.STEP;
    }

    /**
     * Called once per RENDERED frame (not per step): places meshes at
     * positions interpolated between the last two sim steps, so 30 Hz
     * simulation renders smoothly at any display rate and any game speed.
     */
    syncMeshes(): void {
        const alpha = this.alpha;
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            a.rx = a.prevX + (a.x - a.prevX) * alpha;
            a.rz = a.prevZ + (a.z - a.prevZ) * alpha;
            a.mesh.position.x = a.rx - a.unit.world.x;
            a.mesh.position.z = a.rz - a.unit.world.z;
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
     * (same stack as orb damage — resolved damage × level × tower attack debuff).
     * Enemy ward domes absorb the beam (damage the shield; no convert through).
     * Buildings and golden-aura units take the same continuous HP damage.
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
                if (caster.convertTarget) {
                    caster.convertTarget.convertProgress = 0;
                    caster.convertTarget = null;
                }
                continue;
            }

            const team = actorTeam(caster);
            const targets = effectiveTargets(caster.unit.type, actorSeat(caster), this.config.hasTech);
            let target = caster.convertTarget;
            const stillOk =
                target &&
                target.alive &&
                actorTeam(target) !== team &&
                !target.unit.type.extra &&
                // structures are valid ray victims (damage, not convert)
                (target.unit.type.structure ||
                    (target.altitude > 0 ? targets.air : targets.ground)) &&
                // already flipped this battle — leave alone
                (target.unit.type.structure || target.allegiance === null);

            if (stillOk && target) {
                const reach = ray.range + caster.radius + target.radius;
                const dx = target.x - caster.x;
                const dz = target.z - caster.z;
                if (dx * dx + dz * dz > reach * reach) {
                    target.convertProgress = 0;
                    caster.convertTarget = null;
                    target = null;
                }
            } else {
                if (target) target.convertProgress = 0;
                caster.convertTarget = null;
                target = null;
            }

            if (!target) {
                target = this.closestConvertTarget(caster, ray.range, targets);
                caster.convertTarget = target;
                if (target) target.convertProgress = 0;
            }
            if (!target) continue;

            const stats = this.resolved.get(caster.unit)!;
            // same modifiers as a normal attack roll
            const intensity =
                stats.damage * this.levelMult(caster.unit) * this.debuff(caster, d.attackMult);

            const from = this.convertRayOrigin(caster);
            const toY = target.footY + Math.max(1.0, target.unit.type.meshScale * 0.9);
            const sx = target.x - from.x;
            const sy = toY - from.y;
            const sz = target.z - from.z;
            const block = this.enemyShieldHitOnSegment(from.x, from.y, from.z, sx, sy, sz, team);

            caster.convertRayActive = true;
            if (block) {
                // beam stops on the dome — chew the absorb pool instead of converting
                if (target.convertProgress > 0) target.convertProgress = 0;
                caster.convertRayTipX = block.x;
                caster.convertRayTipY = block.y;
                caster.convertRayTipZ = block.z;
                block.shield.hp -= intensity * dt;
                block.shield.hurtTimer = HURT_BAR_SECONDS;
                if (block.shield.hp <= 0) this.breakShield(block.shield);
                continue;
            }

            caster.convertRayTipX = target.x;
            caster.convertRayTipY = toY;
            caster.convertRayTipZ = target.z;

            if (this.convertRayDealsDamage(target)) {
                // buildings + golden aura: same continuous chew as wards, no convert
                if (target.convertProgress > 0) target.convertProgress = 0;
                const dealt = intensity * dt * this.damageTakenMult(target);
                if (dealt > 0) this.applyDamage(caster.unit, target, dealt);
                continue;
            }

            target.convertBy = caster;
            target.convertProgress += intensity * dt;
            // keep the convert bar visible
            target.hurtTimer = Math.max(target.hurtTimer, 0.4);

            if (target.convertProgress + 1e-9 >= target.hp) {
                this.convertActor(caster, target);
            }
        }
    }

    /**
     * Convert-ray muzzle: GLB `AttackNode` when present, else chest-height fallback.
     * Uses sim xz + mesh yaw so the beam tracks facing.
     */
    private convertRayOrigin(caster: Actor): { x: number; y: number; z: number } {
        const t = caster.unit.type;
        const modelKey = t.modelId ?? t.id;
        const local = getUnitAttackNodeLocal(modelKey);
        if (local) {
            return attackNodeWorld(local, caster.x, caster.footY, caster.z, caster.mesh.rotation.y, t.meshScale);
        }
        return {
            x: caster.x,
            y: caster.footY + Math.max(1.6, t.meshScale * 1.15),
            z: caster.z,
        };
    }

    private closestConvertTarget(
        from: Actor,
        range: number,
        targets: { ground: boolean; air: boolean },
    ): Actor | null {
        const team = actorTeam(from);
        let best: Actor | null = null;
        let bestD = Infinity;
        const reach = range + from.radius;
        for (const a of this.actors) {
            if (!a.alive || actorTeam(a) === team) continue;
            // board extras (wards) are hit via beam blocking, not as ray targets
            if (a.unit.type.extra) continue;
            if (a.unit.type.structure) {
                // buildings: always ground ray victims (damage, not convert)
            } else if (a.altitude > 0 ? !targets.air : !targets.ground) {
                continue;
            } else if (a.allegiance !== null) {
                // already converted this battle — leave alone
                continue;
            }
            const dx = a.x - from.x;
            const dz = a.z - from.z;
            const d = dx * dx + dz * dz;
            const maxR = reach + a.radius;
            if (d > maxR * maxR) continue;
            if (d < bestD || (d === bestD && best !== null && a.index < best.index)) {
                bestD = d;
                best = a;
            }
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
        // brief pause before the next channel
        const recover = caster.unit.type.convertRay?.recover ?? 1.25;
        caster.convertCooldown = recover;
        // drop anyone channeling this victim / this caster's lock
        if (caster.convertTarget === target) caster.convertTarget = null;
        for (const a of this.actors) {
            if (a.convertTarget === target) {
                a.convertTarget = null;
            }
            // converted mechs stop converting for their old side
            if (a === target) {
                a.convertTarget = null;
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
     * Uses an expanding-ring spatial search over {@link targetHash} (rebuilt
     * at step start) so cost stays near O(k) instead of O(n) per mech.
     */
    private closestEnemy(from: Actor, anyLayer = false): Actor | null {
        const layer = effectiveTargets(from.unit.type, actorSeat(from), this.config.hasTech);
        const wantAir = anyLayer || layer.air;
        const wantGround = anyLayer || layer.ground;
        if (!wantAir && !wantGround) return null;

        const cacheOk = (cached: Actor): boolean =>
            cached.alive &&
            actorTeam(cached) !== actorTeam(from) &&
            !cached.unit.type.extra &&
            (cached.altitude > 0 ? wantAir : wantGround);

        const inWeaponRange = (cached: Actor): boolean => {
            const stats = this.resolved.get(from.unit)!;
            const reach = stats.range + from.radius + cached.radius;
            const dx = cached.x - from.x;
            const dz = cached.z - from.z;
            return dx * dx + dz * dz <= reach * reach;
        };

        if (!anyLayer) {
            const cached = from.cachedEnemy;
            if (cached && cacheOk(cached) && inWeaponRange(cached)) {
                // engaged: never retarget mid-fight, even on a refresh step
                return cached;
            }
            const refresh = ((this.stepIndex + from.index) % TARGET_REFRESH_STEPS) === 0;
            // out of range (or no cache): keep chasing the same foe between refreshes
            if (!refresh && cached && cacheOk(cached)) {
                return cached;
            }
        }

        const team = actorTeam(from);
        let best: Actor | null = null;
        let bestD = Infinity;
        const cx = Math.floor(from.x / HASH_CELL);
        const cz = Math.floor(from.z / HASH_CELL);

        const consider = (a: Actor): void => {
            if (!a.alive || actorTeam(a) === team) return;
            if (a.altitude > 0 ? !wantAir : !wantGround) return;
            const ddx = a.x - from.x;
            const ddz = a.z - from.z;
            const d = ddx * ddx + ddz * ddz;
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
        if (!anyLayer) from.cachedEnemy = best;
        return best;
    }
}
