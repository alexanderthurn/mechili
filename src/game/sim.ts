import type { Group } from 'three';
import { ITEMS } from './items';
import { groundSupportAt } from './map';
import { DEFAULT_SETTINGS, type LevelingSettings, type TowerSettings } from './settings';
import {
    RALLY_ROUTE_RADIUS,
    RALLY_ROUTE_REACH,
    RALLY_ROUTE_STUCK_SEC,
    type RallyRoute,
} from './tactics';
import type { ResolvedStats } from './tech';
import { syncBattleTint, type Team, type Unit, type UnitType } from './units';

/** how long the fortress Golden Aura keeps allies immune after the one-shot apply */
export const GOLDEN_AURA_DURATION = 30;
/** how far around a golden fortress allies get the buff (world units) */
export const GOLDEN_AURA_RADIUS = 20;
/** golden units take 30% less damage on top of debuff immunity */
export const GOLDEN_DAMAGE_TAKEN_MULT = 0.7;
/** battle clock time when fortress Golden Aura is applied once (after other pre-battle effects) */
export const GOLDEN_AURA_APPLY_AT = 0.1;
/** units stand still for this long at battle start before moving or firing */
export const BATTLE_START_FREEZE = 1.0;

export interface SimConfig {
    towers: TowerSettings;
    leveling: LevelingSettings;
    /** the battle's fixed length — the sim refuses to step past it */
    battleSeconds: number;
    /**
     * which unit-id parity belongs to the HOST side (0 on the host client,
     * 1 on the guest) — peers hold the identical board but label teams from
     * their own perspective, so ordering must key off canonical sides
     */
    hostParity: 0 | 1;
    /** effective supply cost of a unit type (drives kill XP values) */
    costOf: (type: UnitType) => number;
    /** a pack's tech-resolved base stats (level scaling happens in the sim) */
    statsOf: (unit: Unit) => ResolvedStats;
    hasTech: (team: Team, typeId: string, techId: string) => boolean;
    /** base flank spawn duration in seconds (before team multiplier) */
    flankSpawnSeconds: number;
    flankSpawnMult: (team: Team) => number;
    needsFlankSpawn: (unit: Unit) => boolean;
    /** rally routes placed this deployment (player tactics only for now) */
    rallyRoutes?: readonly RallyRoute[];
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
    /** rocket extras: the enemy being homed onto once launched */
    rocketTarget: Actor | null;
    /** sim time until which this mech ignores tower-destruction debuffs (fortress aura) */
    goldenUntil: number;
    /** battle time when flank spawn finishes (0 = already spawned) */
    spawnUntil: number;
    /** took damage during flank spawn — hp no longer auto-ramps */
    spawnDamaged: boolean;
    /** personal rally-route destination (null = default seek-enemy AI) */
    pathDestX: number | null;
    pathDestZ: number | null;
    /** seconds without getting closer to the rally destination */
    pathStuck: number;
    /** closest approach to pathDest so far */
    pathBestDist: number;
    /** render-only: fire recoil 0..1, decays each frame (never read by the sim step) */
    recoil?: number;
    /** render-only: last frame's cooldown, to detect a fresh shot */
    prevCooldown?: number;
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
    team: Team;
    /** the pack that fired it (kill XP goes there) */
    source: Unit;
    /** homing shots chase this actor and hit nothing else */
    target?: Actor;
    ttl: number;
}

/** visual happenings the renderer turns into particles (drained per frame) */
export type SimEvent =
    | { kind: 'muzzle'; x: number; y: number; z: number }
    | { kind: 'impact'; x: number; y: number; z: number }
    | { kind: 'explosion'; x: number; y: number; z: number; radius: number }
    | { kind: 'death'; x: number; y: number; z: number; big: boolean }
    | { kind: 'levelup'; x: number; y: number; z: number };

const PROJECTILE_RADIUS = 0.25;
const PROJECTILE_TTL = 3;

/**
 * Deterministic replacement for Math.hypot: sqrt IS correctly rounded per
 * IEEE-754 in every engine, Math.hypot is NOT — a lockstep-multiplayer
 * hazard across browsers.
 */
function hypot(x: number, y: number, z = 0): number {
    return Math.sqrt(x * x + y * y + z * z);
}

// movement tuning
const AVOID_LOOKAHEAD = 16; // how far ahead a mech watches for big blockers
const AVOID_MARGIN = 0.6; // extra clearance kept around obstacles
const AVOID_STRENGTH = 2.4;
const SEPARATION_GAP = 1.0; // soft personal space between mechs
const SEPARATION_STRENGTH = 1.1;
const BIG_RADIUS = 2.5; // actors at least this wide are steered around (towers, fortresses)
const HASH_CELL = 8; // ≥ biggest mech-pair contact distance

/**
 * The real-time battle: every mech acts individually — it walks toward the
 * closest enemy it can attack and fires once in range. Nothing walks through
 * anything: mechs steer around big blockers (a pack splits left/right around
 * a tower), keep soft spacing among themselves, and a mass-based push-out
 * pass resolves remaining overlaps (a fortress plows through crawlers).
 *
 * Replay groundwork: the sim advances in fixed steps with a stable actor
 * order and no randomness, so re-running it from the same deployment
 * produces the same battle.
 */
export class BattleSim {
    private static readonly STEP = 1 / 30;

    readonly actors: Actor[] = [];
    readonly projectiles: Projectile[] = [];
    /** fixed-step time simulated so far — the deterministic battle clock */
    elapsed = 0;
    private events: SimEvent[] = [];
    private accumulator = 0;
    /** how many command towers each side has lost this battle (stack strength) */
    private readonly lostTowers: Record<Team, number> = { player: 0, enemy: 0 };
    /** sim clock time until which each side's tower-destruction debuff runs */
    private readonly debuffUntil: Record<Team, number> = { player: 0, enemy: 0 };
    private readonly hash = new Map<number, Actor[]>();
    /** tech-resolved base stats per pack, fixed at battle start */
    private readonly resolved = new Map<Unit, ResolvedStats>();
    /** damage dealt per `${team}:${typeId}` — the post-battle report data */
    readonly damageByType = new Map<string, number>();
    /** fortress Golden Aura is a one-shot at {@link GOLDEN_AURA_APPLY_AT}, not continuous */
    private goldenAuraApplied = false;

    constructor(
        units: readonly Unit[],
        private readonly config: SimConfig,
    ) {
        for (const unit of units) {
            if (unit.destroyed) {
                if (this.isCommandTower(unit)) {
                    this.lostTowers[unit.team]++;
                    this.extendTeamDebuff(unit.team, unit.level);
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
                    altitude: unit.type.flying ?? 0,
                    rocketTarget: null,
                    goldenUntil: 0,
                    spawnUntil: 0,
                    spawnDamaged: false,
                    pathDestX: null,
                    pathDestZ: null,
                    pathStuck: 0,
                    pathBestDist: Infinity,
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
            a.spawnUntil = BATTLE_START_FREEZE + base * this.config.flankSpawnMult(a.unit.team);
            a.hp = 1;
        }
        for (const unit of spawningUnits) unit.flankSpawnDone = true;

        // canonical battle order: both peers sort into the SAME sequence
        // (host units first, each side by spawn counter, members in pack
        // order via sort stability), so every order-dependent computation —
        // targeting ties, float accumulation, fire stagger — agrees exactly
        const rank = (id: number) => (id % 2 === config.hostParity ? 0 : 1);
        this.actors.sort((a, b) => {
            const r = rank(a.unit.id) - rank(b.unit.id);
            if (r !== 0) return r;
            return (a.unit.id >> 1) - (b.unit.id >> 1);
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
    }

    /** snapshot at battle start: mechs inside a route's start circle march to a
     *  matching offset at the end. Overlapping zones: last-placed route wins. */
    private assignRallyRoutes(routes: readonly RallyRoute[]): void {
        const r2 = RALLY_ROUTE_RADIUS * RALLY_ROUTE_RADIUS;
        for (const route of routes) {
            for (const a of this.actors) {
                if (!a.alive || a.unit.type.structure || a.unit.team !== route.team) continue;
                if (a.spawnUntil > BATTLE_START_FREEZE + 1e-9) continue;
                const dx = a.x - route.startX;
                const dz = a.z - route.startZ;
                if (dx * dx + dz * dz > r2) continue;
                a.pathDestX = route.endX + dx;
                a.pathDestZ = route.endZ + dz;
                a.pathStuck = 0;
                a.pathBestDist = Infinity;
            }
        }
    }

    private clearPathOrder(a: Actor): void {
        a.pathDestX = null;
        a.pathDestZ = null;
        a.pathStuck = 0;
        a.pathBestDist = Infinity;
    }

    /** true when the mech has arrived or given up on its rally destination */
    private updatePathProgress(a: Actor, dt: number): boolean {
        if (a.pathDestX === null || a.pathDestZ === null) return false;
        const dist = hypot(a.x - a.pathDestX, a.z - a.pathDestZ);
        if (dist <= RALLY_ROUTE_REACH) {
            this.clearPathOrder(a);
            return false;
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

    /** the round ends as soon as one side has no units left besides its towers */
    get isOver(): boolean {
        return !this.hasMobileMechs('player') || !this.hasMobileMechs('enemy');
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

    update(dtSeconds: number): void {
        this.accumulator += Math.min(dtSeconds, 0.25);
        while (this.accumulator >= BattleSim.STEP) {
            this.accumulator -= BattleSim.STEP;
            // stop EXACTLY at the deciding step — overshooting by a frame's
            // worth of steps would let peers diverge on the survivors
            if (this.finished) break;
            this.step(BattleSim.STEP);
        }
    }

    private hasMobileMechs(team: Team): boolean {
        return this.actors.some((a) => a.alive && a.unit.team === team && !a.unit.type.structure);
    }

    private isCommandTower(unit: Unit): boolean {
        return unit.type.structure === true && !unit.type.extra;
    }

    /** seconds of debuff from losing a command tower at the given level */
    private debuffSecondsForTowerLevel(level: number): number {
        const { baseSeconds, stepSeconds } =
            this.config.towers.debuffDuration ?? DEFAULT_SETTINGS.towers.debuffDuration;
        return Math.max(0, baseSeconds - (level - 1) * stepSeconds);
    }

    /** extends (or starts) a side's debuff window — stacks time if already active */
    private extendTeamDebuff(team: Team, towerLevel: number): void {
        const add = this.debuffSecondsForTowerLevel(towerLevel);
        this.debuffUntil[team] = Math.max(this.debuffUntil[team], this.elapsed) + add;
    }

    /** tower-destruction debuff is active for this mech right now */
    private isDebuffed(actor: Actor): boolean {
        if (this.isGolden(actor)) return false;
        return this.elapsed < this.debuffUntil[actor.unit.team] - 1e-9;
    }

    /** stacking tower-destruction multiplier — only while the debuff timer runs */
    private debuff(actor: Actor, mult: number): number {
        if (!this.isDebuffed(actor)) return 1;
        let factor = 1;
        for (let i = 0; i < this.lostTowers[actor.unit.team]; i++) factor *= mult;
        return factor;
    }

    /** incoming damage: golden = −30%; tower debuff only while its timer runs */
    private damageTakenMult(actor: Actor): number {
        if (this.isGolden(actor)) return GOLDEN_DAMAGE_TAKEN_MULT;
        if (!this.isDebuffed(actor)) return 1;
        const mult = this.config.towers.debuffPerLostTower.damageTakenMult;
        let factor = 1;
        for (let i = 0; i < this.lostTowers[actor.unit.team]; i++) factor *= mult;
        return factor;
    }

    /** golden item on the pack, or a recent fortress aura buff */
    isGolden(actor: Actor): boolean {
        for (const id of actor.unit.items) {
            if (ITEMS[id]?.debuffImmune) return true;
        }
        return actor.goldenUntil > this.elapsed + 1e-9;
    }

    /** one-shot at {@link GOLDEN_AURA_APPLY_AT}: allies in range of a golden fortress get 30s immunity */
    private applyFortressGoldenAura(): void {
        const r2 = GOLDEN_AURA_RADIUS * GOLDEN_AURA_RADIUS;
        const expires = GOLDEN_AURA_APPLY_AT + GOLDEN_AURA_DURATION;
        for (const f of this.actors) {
            if (!f.alive || f.unit.type.id !== 'fortress') continue;
            if (!this.config.hasTech(f.unit.team, 'fortress', 'golden')) continue;
            for (const a of this.actors) {
                if (!a.alive || a.unit.team !== f.unit.team || a.unit.type.structure) continue;
                const dx = a.x - f.x;
                const dz = a.z - f.z;
                if (dx * dx + dz * dz <= r2) a.goldenUntil = Math.max(a.goldenUntil, expires);
            }
        }
    }

    /** golden tint on golden mechs; wild color shift while tower debuff timer runs */
    syncBattleVisuals(timeSeconds: number): void {
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const stacks = this.lostTowers[a.unit.team];
            let tint: 'normal' | 'golden' | 'debuff' | 'spawning' = 'normal';
            let spawnProgress = 0;
            if (this.isGolden(a)) tint = 'golden';
            else if (this.isDebuffed(a)) tint = 'debuff';
            else if (this.isSpawning(a)) {
                tint = 'spawning';
                spawnProgress = this.spawnProgress(a);
            }
            syncBattleTint(a.mesh, tint, timeSeconds, stacks, spawnProgress);
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
            // walkers clear the uphill side of mounds instead of sinking in
            const groundY = groundSupportAt(a.rx, a.rz, a.radius * 0.65) + 0.08;
            if (!a.mesh.userData.animated) {
                const gait = Math.sin(timeSeconds * 9 + a.index);
                a.mesh.position.y = groundY + Math.abs(gait) * 0.16 * moving + recoil * 0.06;
                a.mesh.rotation.z = gait * 0.06 * moving; // side-to-side roll
                a.mesh.rotation.x = -0.06 * moving; // slight lean — kept small so noses don't dig in
            } else {
                a.mesh.position.y = groundY;
            }
        } else {
            // air layer is absolute world Y; soft hover bob
            a.mesh.position.y = a.altitude + Math.sin(timeSeconds * 2 + a.index) * 0.35;
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
        this.events.push({
            kind: 'death',
            x: target.x,
            y: target.altitude + t.meshScale * 0.8,
            z: target.z,
            big: target.radius >= 2 || !!t.structure,
        });
        if (t.structure) {
            target.unit.markDestroyed();
            if (this.isCommandTower(target.unit)) {
                this.lostTowers[target.unit.team]++;
                this.extendTeamDebuff(target.unit.team, target.unit.level);
            }
        } else {
            // tip over and stay as a battlefield wreck until the round resets
            // (air units crash to the ground)
            target.mesh.rotation.z = (target.index % 2 ? 1 : -1) * (0.75 + (target.index % 4) * 0.08);
            target.mesh.position.y = groundSupportAt(target.x, target.z, target.radius * 0.65) + 0.08;
            target.mesh.userData.dead = true;
        }
    }

    private step(dt: number): void {
        this.elapsed += dt;
        // remember where everything stood — rendering interpolates prev -> current
        for (const a of this.actors) {
            a.prevX = a.x;
            a.prevZ = a.z;
        }
        for (const p of this.projectiles) {
            p.px = p.x;
            p.py = p.y;
            p.pz = p.z;
        }

        if (!this.goldenAuraApplied && this.elapsed >= GOLDEN_AURA_APPLY_AT) {
            this.applyFortressGoldenAura();
            this.goldenAuraApplied = true;
        }

        for (const a of this.actors) {
            if (a.hurtTimer > 0) a.hurtTimer -= dt;
        }

        this.updateFlankSpawning();

        // opening beat: no movement, attacks, rockets, or projectiles yet
        if (this.elapsed < BATTLE_START_FREEZE) return;

        const d = this.config.towers.debuffPerLostTower;
        this.rebuildHash();
        const bigs = this.actors.filter((a) => a.alive && a.radius >= BIG_RADIUS);

        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
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
                const isMelee = !a.unit.type.projectileSpeed;

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
                                const dealt = damage * this.damageTakenMult(target);
                                this.applyDamage(a.unit, target, dealt);
                                this.events.push({ kind: 'impact', x: target.x, y: 0.6, z: target.z });
                            }
                            a.mesh.rotation.y = Math.atan2(-tdx, -tdz);
                            continue;
                        }
                        // ranged on a rally route: fire while marching
                        if (canAttack) a.cooldown -= dt;
                        if (canAttack && a.cooldown <= 0) {
                            a.cooldown += stats.attackInterval;
                            const damage =
                                stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                            this.fire(a, target, damage, a.unit.type.projectileSpeed!);
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
                if (canAttack) a.cooldown -= dt;
                if (canAttack && a.cooldown <= 0) {
                    a.cooldown += stats.attackInterval;
                    const damage =
                        stats.damage * this.levelMult(a.unit) * this.debuff(a, d.attackMult);
                    if (a.unit.type.projectileSpeed) {
                        this.fire(a, target, damage, a.unit.type.projectileSpeed);
                    } else {
                        // melee: instant hit
                        const dealt = damage * this.damageTakenMult(target);
                        this.applyDamage(a.unit, target, dealt);
                        this.events.push({ kind: 'impact', x: target.x, y: 0.6, z: target.z });
                    }
                }
                a.mesh.rotation.y = Math.atan2(-dx, -dz);
                continue;
            }

            this.steerToward(a, dx / dist, dz / dist, dist, dt, stats, d, target, bigs, reach * 0.95);
        }

        this.resolveOverlaps();
        this.stepRockets(dt);
        this.stepProjectiles(dt);
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

        for (const b of this.nearby(a)) {
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
            const speed = stats.speed * this.debuff(a, d.speedMult);
            const move = Math.min(speed * dt, Math.max(0, goalDist - stopMargin));
            a.x += steerX * move;
            a.z += steerZ * move;
            a.mesh.rotation.y = Math.atan2(-steerX, -steerZ);
        }
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
        this.explode({ damage: spec.damage, team: a.unit.team, source: a.unit }, a.x, a.z, spec.splash);
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
        let best: { shield: Actor; t: number } | null = null;
        for (const s of this.actors) {
            const spec = s.unit.type.shield;
            if (!spec || !s.alive || s.unit.team === p.team) continue;
            const cx = p.x - s.x;
            const cz = p.z - s.z;
            const r2 = spec.radius * spec.radius;
            const startInside2d = cx * cx + cz * cz <= r2;
            if (startInside2d && p.y <= spec.height) continue; // fired from inside: outgoing shots pass
            // wall entry: first intersection of the 2D segment with the circle
            if (!startInside2d) {
                const a2 = sx * sx + sz * sz;
                if (a2 >= 1e-9) {
                    const b = 2 * (cx * sx + cz * sz);
                    const c = cx * cx + cz * cz - r2;
                    const disc = b * b - 4 * a2 * c;
                    if (disc >= 0) {
                        const t = (-b - Math.sqrt(disc)) / (2 * a2);
                        if (t >= 0 && t <= 1 && p.y + sy * t <= spec.height && (!best || t < best.t)) {
                            best = { shield: s, t };
                        }
                    }
                }
            }
            // roof entry: descending through the dome top from above (air fire)
            if (p.y > spec.height && sy < 0) {
                const t = (spec.height - p.y) / sy;
                if (t >= 0 && t <= 1) {
                    const qx = p.x + sx * t - s.x;
                    const qz = p.z + sz * t - s.z;
                    if (qx * qx + qz * qz <= r2 && (!best || t < best.t)) best = { shield: s, t };
                }
            }
        }
        return best;
    }

    private breakShield(s: Actor): void {
        s.alive = false;
        s.mesh.visible = false;
        s.unit.consumed = true; // broken — gone for good at the round reset
        this.events.push({ kind: 'death', x: s.x, y: 2, z: s.z, big: true });
    }

    /** spawns a bullet from the shooter's muzzle toward the target's primary hit volume */
    private fire(a: Actor, target: Actor, damage: number, speed: number): void {
        const at = a.unit.type;
        const tt = target.unit.type;
        const dirX = target.x - a.x;
        const dirZ = target.z - a.z;
        const flat = hypot(dirX, dirZ) || 1e-6;
        const muzzleY = a.altitude + (at.colliders[0]?.y ?? 0.5) * at.meshScale + 0.4;
        const mx = a.x + (dirX / flat) * (a.radius + 0.5);
        const mz = a.z + (dirZ / flat) * (a.radius + 0.5);
        const aim = tt.colliders[0] ?? { y: 0.5, r: 0.5 };
        const dx = target.x - mx;
        const dy = target.altitude + aim.y * tt.meshScale - muzzleY;
        const dz = target.z - mz;
        const len = hypot(dx, dy, dz) || 1e-6;
        this.projectiles.push({
            x: mx,
            y: muzzleY,
            z: mz,
            px: mx,
            py: muzzleY,
            pz: mz,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            vz: (dz / len) * speed,
            damage,
            team: a.unit.team,
            source: a.unit,
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
                const dy = p.target.altitude + aim.y * tt.meshScale - p.y;
                const dz = p.target.z - p.z;
                const len = hypot(dx, dy, dz) || 1e-6;
                const speed = hypot(p.vx, p.vy, p.vz);
                p.vx = (dx / len) * speed;
                p.vy = (dy / len) * speed;
                p.vz = (dz / len) * speed;
            }
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
            const candidates = p.target?.alive ? [p.target] : this.actors;
            for (const a of candidates) {
                if (!a.alive || a.unit.team === p.team) continue;
                const bx = a.x - p.x;
                const bz = a.z - p.z;
                if (bx * bx + bz * bz > reach * reach) continue;
                const mt = a.unit.type;
                for (const c of mt.colliders) {
                    const cy = a.altitude + c.y * mt.meshScale;
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

            const splash = p.source.type.splashRadius ?? 0;
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
                    this.events.push({ kind: 'impact', x: ix, y: iy, z: iz });
                }
                continue; // bullet consumed
            }
            if (ny <= 0) {
                // splash shells detonate on the ground too — a miss still hurts
                if (splash > 0) {
                    this.explode(p, nx, nz, splash);
                    this.events.push({ kind: 'explosion', x: nx, y: 0.15, z: nz, radius: splash });
                } else {
                    this.events.push({ kind: 'impact', x: nx, y: 0.15, z: nz });
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
     * respecting the shooter's can-attack matrix (a ground-only cannon's
     * blast doesn't reach wasps overhead).
     */
    private explode(
        p: { damage: number; team: Team; source: Unit },
        x: number,
        z: number,
        radius: number,
    ): void {
        const targets = p.source.type.targets;
        for (const a of this.actors) {
            if (!a.alive || a.unit.team === p.team) continue;
            if (a.unit.type.extra) continue; // extras are immune to blasts too
            if (a.altitude > 0 ? !targets.air : !targets.ground) continue;
            if (hypot(a.x - x, a.z - z) > radius + a.radius) continue;
            const dealt = p.damage * this.damageTakenMult(a);
            this.applyDamage(p.source, a, dealt);
        }
    }

    /** mass-based push-out: heavy units shove light ones aside, structures never move */
    private resolveOverlaps(): void {
        for (let iter = 0; iter < 2; iter++) {
            for (const a of this.actors) {
                if (!a.alive || a.unit.type.structure) continue;
                for (const b of this.nearby(a)) {
                    if (b.index <= a.index || !b.alive || b.unit.type.structure) continue;
                    if ((b.altitude > 0) !== (a.altitude > 0)) continue; // air passes over ground
                    this.pushApart(a, b);
                }
                if (a.altitude > 0) continue; // air units ignore structures entirely
                // towers and rubble-free structures are immovable walls
                // (board extras take no space — everything walks through them)
                for (const s of this.actors) {
                    if (!s.alive || !s.unit.type.structure || s.unit.type.extra) continue;
                    this.pushApart(a, s);
                }
            }
        }
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
            if (!a.alive || a.unit.type.structure) continue;
            const key = this.hashKey(a.x, a.z);
            const bucket = this.hash.get(key);
            if (bucket) bucket.push(a);
            else this.hash.set(key, [a]);
        }
    }

    /** mobile mechs in the 3x3 cells around an actor, in CANONICAL order —
     *  bucket enumeration order differs on mirrored boards, so sort */
    private nearby(a: Actor): Actor[] {
        const cx = Math.floor(a.x / HASH_CELL);
        const cz = Math.floor(a.z / HASH_CELL);
        const result: Actor[] = [];
        for (let ix = -1; ix <= 1; ix++) {
            for (let iz = -1; iz <= 1; iz++) {
                const bucket = this.hash.get((cx + ix + 2048) * 4096 + (cz + iz + 2048));
                if (bucket) result.push(...bucket);
            }
        }
        result.sort((p, q) => p.index - q.index);
        return result;
    }

    /**
     * The closest living enemy THIS unit can attack (towers are units like
     * any other). The can-attack matrix rules: e.g. crawlers can't reach air.
     * With `anyLayer` the matrix is ignored — used to pick something to walk
     * to and wait at when no attackable enemy is left.
     */
    private closestEnemy(from: Actor, anyLayer = false): Actor | null {
        const targets = from.unit.type.targets;
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.actors) {
            if (!a.alive || a.unit.team === from.unit.team) continue;
            if (a.unit.type.extra) continue; // shields/rockets are never targets
            if (!anyLayer && (a.altitude > 0 ? !targets.air : !targets.ground)) continue;
            const ddx = a.x - from.x;
            const ddz = a.z - from.z;
            const d = ddx * ddx + ddz * ddz;
            if (d < bestD) {
                bestD = d;
                best = a;
            }
        }
        return best;
    }
}
