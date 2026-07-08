import type { Group } from 'three';
import type { TowerSettings } from './settings';
import type { Team, Unit } from './units';

export interface Actor {
    unit: Unit;
    mesh: Group;
    x: number;
    z: number;
    hp: number;
    cooldown: number;
    alive: boolean;
    /** ground collision circle */
    radius: number;
    /** stable index for deterministic tie-breaks */
    index: number;
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
    private accumulator = 0;
    /** destroyed towers per side (pre-battle + during battle) drive the debuffs */
    private readonly lostTowers: Record<Team, number> = { player: 0, enemy: 0 };
    private readonly hash = new Map<number, Actor[]>();

    constructor(
        units: readonly Unit[],
        private readonly towers: TowerSettings,
    ) {
        for (const unit of units) {
            if (unit.destroyed) {
                this.lostTowers[unit.team]++;
                continue; // rubble is not a target
            }
            unit.members.forEach((m, i) => {
                this.actors.push({
                    unit,
                    mesh: m.mesh,
                    x: unit.world.x + m.home.x,
                    z: unit.world.z + m.home.z,
                    hp: unit.type.hp,
                    // deterministic stagger so squads don't fire in one frame
                    cooldown: (i % 5) * (unit.type.attackInterval / 5),
                    alive: true,
                    radius: unit.type.collisionRadius,
                    index: this.actors.length,
                });
            });
        }
    }

    /** the round ends as soon as one side has no units left besides its towers */
    get isOver(): boolean {
        return !this.hasMobileMechs('player') || !this.hasMobileMechs('enemy');
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

    private kill(target: Actor): void {
        target.alive = false;
        if (target.unit.type.structure) {
            // a fallen tower stays fallen for the whole match and weakens its side
            target.unit.markDestroyed();
            this.lostTowers[target.unit.team]++;
        } else {
            target.mesh.visible = false;
        }
    }

    private step(dt: number): void {
        const d = this.towers.debuffPerLostTower;
        this.rebuildHash();
        const bigs = this.actors.filter((a) => a.alive && a.radius >= BIG_RADIUS);

        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const target = this.closestEnemy(a);
            if (!target) continue;

            const dx = target.x - a.x;
            const dz = target.z - a.z;
            const dist = Math.hypot(dx, dz) || 1e-6;
            const stats = a.unit.type;

            if (dist <= stats.range) {
                // in range: stand and fire (still gets jostled by the crowd)
                a.cooldown -= dt;
                if (a.cooldown <= 0) {
                    a.cooldown += stats.attackInterval;
                    target.hp -=
                        stats.damage *
                        this.debuff(a.unit.team, d.attackMult) *
                        this.debuff(target.unit.team, d.damageTakenMult);
                    if (target.hp <= 0) this.kill(target);
                }
                a.mesh.rotation.y = Math.atan2(-dx, -dz);
                continue;
            }

            // --- steering: seek + steer around big blockers + soft separation ---
            const seekX = dx / dist;
            const seekZ = dz / dist;
            let steerX = seekX;
            let steerZ = seekZ;

            // nearest big actor blocking the path ahead (never the target itself)
            let blocker: Actor | null = null;
            let blockerDist = Infinity;
            for (const o of bigs) {
                if (o === a || o === target || !o.alive) continue;
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

            // soft separation from nearby mechs of any team
            for (const b of this.nearby(a)) {
                if (b === a || !b.alive) continue;
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
                const move = Math.min(speed * dt, Math.max(0, dist - stats.range * 0.9));
                a.x += steerX * move;
                a.z += steerZ * move;
                a.mesh.rotation.y = Math.atan2(-steerX, -steerZ);
            }
        }

        this.resolveOverlaps();
        this.syncMeshes();
    }

    /** mass-based push-out: heavy units shove light ones aside, structures never move */
    private resolveOverlaps(): void {
        for (let iter = 0; iter < 2; iter++) {
            for (const a of this.actors) {
                if (!a.alive || a.unit.type.structure) continue;
                for (const b of this.nearby(a)) {
                    if (b.index <= a.index || !b.alive || b.unit.type.structure) continue;
                    this.pushApart(a, b);
                }
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

    /** the closest living enemy, tower or mech — towers are units like any other */
    private closestEnemy(from: Actor): Actor | null {
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.actors) {
            if (!a.alive || a.unit.team === from.unit.team) continue;
            const d = (a.x - from.x) ** 2 + (a.z - from.z) ** 2;
            if (d < bestD) {
                bestD = d;
                best = a;
            }
        }
        return best;
    }
}
