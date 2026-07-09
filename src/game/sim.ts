import type { Group } from 'three';
import type { LevelingSettings, TowerSettings } from './settings';
import type { ResolvedStats } from './tech';
import type { Team, Unit, UnitType } from './units';

export interface SimConfig {
    towers: TowerSettings;
    leveling: LevelingSettings;
    /** effective supply cost of a unit type (drives kill XP values) */
    costOf: (type: UnitType) => number;
    /** a pack's tech-resolved base stats (level scaling happens in the sim) */
    statsOf: (unit: Unit) => ResolvedStats;
}

export interface Actor {
    unit: Unit;
    mesh: Group;
    x: number;
    z: number;
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
}

/** how long a hit keeps the HP bar visible */
export const HURT_BAR_SECONDS = 1.5;

/** a bullet in flight — hits the first enemy hit-volume it crosses */
export interface Projectile {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    damage: number;
    team: Team;
    /** the pack that fired it (kill XP goes there) */
    source: Unit;
    ttl: number;
}

/** visual happenings the renderer turns into particles (drained per frame) */
export type SimEvent =
    | { kind: 'muzzle'; x: number; y: number; z: number }
    | { kind: 'impact'; x: number; y: number; z: number }
    | { kind: 'death'; x: number; y: number; z: number; big: boolean }
    | { kind: 'levelup'; x: number; y: number; z: number };

const PROJECTILE_RADIUS = 0.25;
const PROJECTILE_TTL = 3;

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
    private events: SimEvent[] = [];
    private accumulator = 0;
    /** destroyed towers per side (pre-battle + during battle) drive the debuffs */
    private readonly lostTowers: Record<Team, number> = { player: 0, enemy: 0 };
    private readonly hash = new Map<number, Actor[]>();
    /** tech-resolved base stats per pack, fixed at battle start */
    private readonly resolved = new Map<Unit, ResolvedStats>();
    /** damage dealt per `${team}:${typeId}` — the post-battle report data */
    readonly damageByType = new Map<string, number>();

    constructor(
        units: readonly Unit[],
        private readonly config: SimConfig,
    ) {
        for (const unit of units) {
            if (unit.destroyed) {
                this.lostTowers[unit.team]++;
                continue; // rubble is not a target
            }
            const stats = config.statsOf(unit);
            this.resolved.set(unit, stats);
            unit.members.forEach((m, i) => {
                this.actors.push({
                    unit,
                    mesh: m.mesh,
                    x: unit.world.x + m.home.x,
                    z: unit.world.z + m.home.z,
                    hp: stats.hp * this.levelMult(unit),
                    maxHp: stats.hp * this.levelMult(unit),
                    // deterministic stagger so squads don't fire in one frame
                    cooldown: (i % 5) * (stats.attackInterval / 5),
                    alive: true,
                    radius: unit.type.collisionRadius,
                    index: this.actors.length,
                    hurtTimer: 0,
                    altitude: unit.type.flying ?? 0,
                });
            });
        }
    }

    /** the round ends as soon as one side has no units left besides its towers */
    get isOver(): boolean {
        return !this.hasMobileMechs('player') || !this.hasMobileMechs('enemy');
    }

    private recordDamage(attacker: Unit, amount: number): void {
        const key = `${attacker.team}:${attacker.type.id}`;
        this.damageByType.set(key, (this.damageByType.get(key) ?? 0) + amount);
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
            this.step(BattleSim.STEP);
        }
    }

    private hasMobileMechs(team: Team): boolean {
        return this.actors.some((a) => a.alive && a.unit.team === team && !a.unit.type.structure);
    }

    /** stacking multiplier from a side's lost towers */
    private debuff(team: Team, mult: number): number {
        return mult ** this.lostTowers[team];
    }

    /** hp/damage multiplier from a pack's veterancy level */
    private levelMult(unit: Unit): number {
        return this.config.leveling.statMultiplierPerLevel ** (unit.level - 1);
    }

    /**
     * Kill XP: the victim's supply value goes to the killer's pack. Level-ups
     * apply mid-battle — every living mech of the pack scales up on the spot.
     */
    private grantXp(killer: Unit, victim: Actor): void {
        const { leveling, costOf } = this.config;
        const value = costOf(victim.unit.type) / victim.unit.members.length;
        if (value <= 0) return;
        killer.xp += value;
        const packCost = costOf(killer.type);
        while (
            killer.level < leveling.maxLevel &&
            killer.xp >= packCost * leveling.xpThresholdFactor * killer.level
        ) {
            killer.xp -= packCost * leveling.xpThresholdFactor * killer.level;
            killer.level++;
            for (const a of this.actors) {
                if (a.unit !== killer || !a.alive) continue;
                a.hp *= leveling.statMultiplierPerLevel;
                a.maxHp *= leveling.statMultiplierPerLevel;
                this.events.push({
                    kind: 'levelup',
                    x: a.x,
                    y: a.altitude + killer.type.meshScale,
                    z: a.z,
                });
            }
        }
    }

    private kill(target: Actor, killer: Unit | null): void {
        if (killer && !target.unit.type.structure) this.grantXp(killer, target);
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
            // a fallen tower weakens its side for the REST OF THIS BATTLE;
            // the round reset rebuilds it like any other unit
            target.unit.markDestroyed();
            this.lostTowers[target.unit.team]++;
        } else {
            // tip over and stay as a battlefield wreck until the round resets
            // (air units crash to the ground)
            target.mesh.rotation.z = (target.index % 2 ? 1 : -1) * (0.75 + (target.index % 4) * 0.08);
            target.mesh.position.y = 0.05;
            target.mesh.userData.dead = true;
        }
    }

    private step(dt: number): void {
        const d = this.config.towers.debuffPerLostTower;
        this.rebuildHash();
        const bigs = this.actors.filter((a) => a.alive && a.radius >= BIG_RADIUS);
        for (const a of this.actors) {
            if (a.hurtTimer > 0) a.hurtTimer -= dt;
        }

        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const target = this.closestEnemy(a);
            if (!target) continue;

            const dx = target.x - a.x;
            const dz = target.z - a.z;
            const dist = Math.hypot(dx, dz) || 1e-6;
            const stats = this.resolved.get(a.unit)!;
            // range is surface-to-surface: collision circles must not keep
            // melee mechs from ever "reaching" wide targets like towers
            const reach = stats.range + a.radius + target.radius;

            if (dist <= reach) {
                // in range: stand and fire (still gets jostled by the crowd)
                a.cooldown -= dt;
                if (a.cooldown <= 0) {
                    a.cooldown += stats.attackInterval;
                    const damage =
                        stats.damage * this.levelMult(a.unit) * this.debuff(a.unit.team, d.attackMult);
                    if (a.unit.type.projectileSpeed) {
                        this.fire(a, target, damage, a.unit.type.projectileSpeed);
                    } else {
                        // melee: instant hit
                        const dealt = damage * this.debuff(target.unit.team, d.damageTakenMult);
                        target.hp -= dealt;
                        this.recordDamage(a.unit, dealt);
                        target.hurtTimer = HURT_BAR_SECONDS;
                        this.events.push({ kind: 'impact', x: target.x, y: 0.6, z: target.z });
                        if (target.hp <= 0) this.kill(target, a.unit);
                    }
                }
                a.mesh.rotation.y = Math.atan2(-dx, -dz);
                continue;
            }

            // --- steering: seek + steer around big blockers + soft separation ---
            const seekX = dx / dist;
            const seekZ = dz / dist;
            let steerX = seekX;
            let steerZ = seekZ;

            // nearest big actor blocking the path ahead (never the target
            // itself) — air units fly over everything on the ground
            let blocker: Actor | null = null;
            let blockerDist = Infinity;
            for (const o of a.altitude > 0 ? [] : bigs) {
                if (o === a || o === target || !o.alive || o.altitude > 0) continue;
                const ox = o.x - a.x;
                const oz = o.z - a.z;
                const ahead = ox * seekX + oz * seekZ;
                if (ahead <= 0 || ahead > AVOID_LOOKAHEAD + o.radius) continue;
                const lateral = seekX * oz - seekZ * ox; // signed side offset of the obstacle
                if (Math.abs(lateral) >= o.radius + a.radius + AVOID_MARGIN) continue;
                const oDist = Math.hypot(ox, oz);
                if (oDist < blockerDist) {
                    blockerDist = oDist;
                    blocker = o;
                }
            }
            if (blocker) {
                const ox = blocker.x - a.x;
                const oz = blocker.z - a.z;
                const oLen = Math.hypot(ox, oz) || 1e-6;
                const lateral = seekX * oz - seekZ * ox;
                // steer to the side the mech already favors -> a pack naturally
                // splits: its left half flows left, its right half flows right
                const side = lateral >= 0 ? 1 : -1;
                const w = AVOID_STRENGTH * Math.max(0, 1 - oLen / (AVOID_LOOKAHEAD + blocker.radius));
                steerX += (side * (oz / oLen)) * w;
                steerZ += (-side * (ox / oLen)) * w;
            }

            // soft separation from nearby mechs of any team, same layer only
            for (const b of this.nearby(a)) {
                if (b === a || !b.alive || (b.altitude > 0) !== (a.altitude > 0)) continue;
                const sx = a.x - b.x;
                const sz = a.z - b.z;
                const sd = Math.hypot(sx, sz);
                const minD = a.radius + b.radius + SEPARATION_GAP;
                if (sd >= minD || sd < 1e-4) continue;
                const w = ((minD - sd) / minD) * SEPARATION_STRENGTH;
                steerX += (sx / sd) * w;
                steerZ += (sz / sd) * w;
            }

            const steerLen = Math.hypot(steerX, steerZ);
            if (steerLen > 1e-4) {
                steerX /= steerLen;
                steerZ /= steerLen;
                const speed = stats.speed * this.debuff(a.unit.team, d.speedMult);
                const move = Math.min(speed * dt, Math.max(0, dist - reach * 0.95));
                a.x += steerX * move;
                a.z += steerZ * move;
                a.mesh.rotation.y = Math.atan2(-steerX, -steerZ);
            }
        }

        this.resolveOverlaps();
        this.syncMeshes();
        this.stepProjectiles(dt);
    }

    /** spawns a bullet from the shooter's muzzle toward the target's primary hit volume */
    private fire(a: Actor, target: Actor, damage: number, speed: number): void {
        const at = a.unit.type;
        const tt = target.unit.type;
        const dirX = target.x - a.x;
        const dirZ = target.z - a.z;
        const flat = Math.hypot(dirX, dirZ) || 1e-6;
        const muzzleY = a.altitude + (at.colliders[0]?.y ?? 0.5) * at.meshScale + 0.4;
        const mx = a.x + (dirX / flat) * (a.radius + 0.5);
        const mz = a.z + (dirZ / flat) * (a.radius + 0.5);
        const aim = tt.colliders[0] ?? { y: 0.5, r: 0.5 };
        const dx = target.x - mx;
        const dy = target.altitude + aim.y * tt.meshScale - muzzleY;
        const dz = target.z - mz;
        const len = Math.hypot(dx, dy, dz) || 1e-6;
        this.projectiles.push({
            x: mx,
            y: muzzleY,
            z: mz,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            vz: (dz / len) * speed,
            damage,
            team: a.unit.team,
            source: a.unit,
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
        const d = this.config.towers.debuffPerLostTower;
        let write = 0;
        for (const p of this.projectiles) {
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
            for (const a of this.actors) {
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

            if (hit) {
                const dealt = p.damage * this.debuff(hit.unit.team, d.damageTakenMult);
                hit.hp -= dealt;
                this.recordDamage(p.source, dealt);
                hit.hurtTimer = HURT_BAR_SECONDS;
                this.events.push({
                    kind: 'impact',
                    x: p.x + sx * hitT,
                    y: p.y + sy * hitT,
                    z: p.z + sz * hitT,
                });
                if (hit.hp <= 0) this.kill(hit, p.source);
                continue; // bullet consumed
            }
            if (ny <= 0) {
                this.events.push({ kind: 'impact', x: nx, y: 0.15, z: nz });
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
                for (const s of this.actors) {
                    if (!s.alive || !s.unit.type.structure) continue;
                    this.pushApart(a, s);
                }
            }
        }
    }

    private pushApart(a: Actor, b: Actor): void {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const dist = Math.hypot(dx, dz);
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

    private syncMeshes(): void {
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            a.mesh.position.x = a.x - a.unit.world.x;
            a.mesh.position.z = a.z - a.unit.world.z;
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

    /** mobile mechs in the 3x3 cells around an actor, in deterministic order */
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
        return result;
    }

    /**
     * The closest living enemy THIS unit can attack (towers are units like
     * any other). The can-attack matrix rules: e.g. crawlers can't reach air.
     */
    private closestEnemy(from: Actor): Actor | null {
        const targets = from.unit.type.targets;
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.actors) {
            if (!a.alive || a.unit.team === from.unit.team) continue;
            if (a.altitude > 0 ? !targets.air : !targets.ground) continue;
            const d = (a.x - from.x) ** 2 + (a.z - from.z) ** 2;
            if (d < bestD) {
                bestD = d;
                best = a;
            }
        }
        return best;
    }
}
