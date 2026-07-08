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
}

/**
 * The real-time battle: every mech acts individually — it walks toward the
 * closest enemy mech it can attack and fires once in range. Enemy command
 * towers are targeted only when no enemy mechs are left.
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
        for (const a of this.actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const target = this.closestEnemy(a);
            if (!target) continue;

            const dx = target.x - a.x;
            const dz = target.z - a.z;
            const dist = Math.hypot(dx, dz) || 1e-6;
            const stats = a.unit.type;

            if (dist > stats.range) {
                const move = Math.min(stats.speed * this.debuff(a.unit.team, d.speedMult) * dt, dist - stats.range);
                a.x += (dx / dist) * move;
                a.z += (dz / dist) * move;
            } else {
                a.cooldown -= dt;
                if (a.cooldown <= 0) {
                    a.cooldown += stats.attackInterval;
                    target.hp -=
                        stats.damage *
                        this.debuff(a.unit.team, d.attackMult) *
                        this.debuff(target.unit.team, d.damageTakenMult);
                    if (target.hp <= 0) this.kill(target);
                }
            }

            a.mesh.rotation.y = Math.atan2(-dx, -dz);
            a.mesh.position.x = a.x - a.unit.world.x;
            a.mesh.position.z = a.z - a.unit.world.z;
        }
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
