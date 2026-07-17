import { PointLight, type Scene } from 'three';
import { groundSupportAt } from './map';
import type { HazardField } from './fire';
import { prefs, type FireVfxQuality } from './prefs';
import type { Particles } from './effects';
import { FlameRenderer } from './flameRenderer';
import type { Actor, SimEvent } from './sim';

function usesTongues(q: FireVfxQuality): boolean {
    return q === 'medium' || q === 'high';
}

/**
 * Fire VFX — visual only (may use Math.random). Anchors flames at terrain height.
 * high/medium = instanced tongues + embers + smoke; low = particle bursts only.
 */
export class FireFx {
    private quality: FireVfxQuality = prefs().fireVfx;
    private emitAcc = 0;
    private smokeAcc = 0;
    private burnAcc = 0;
    private readonly flames: FlameRenderer;
    /** ONE shared flickering light on the biggest blaze (medium/high tiers) */
    private readonly fireLight: PointLight;
    private lightTime = 0;

    constructor(
        private readonly particles: Particles,
        scene: Scene,
    ) {
        this.flames = new FlameRenderer(scene);
        this.flames.setQuality(this.quality);
        // castShadow stays off: a shadow-casting point light re-renders the
        // scene 6× (cube map) — not worth it for a top-down view
        this.fireLight = new PointLight(0xff7a28, 0, 46, 1.6);
        this.fireLight.visible = false;
        scene.add(this.fireLight);
    }

    setQuality(q: FireVfxQuality): void {
        this.quality = q;
        this.flames.setQuality(q);
        if (!usesTongues(q)) this.fireLight.visible = false;
    }

    /** drop continuous fire VFX (call when the battle ends — flames are battle-only) */
    clear(): void {
        this.flames.clear();
        this.emitAcc = 0;
        this.smokeAcc = 0;
        this.fireLight.visible = false;
    }

    /** Places the shared light on the blaze centroid (snapped to a real fire
     *  cell so two separate fires don't light their empty midpoint). */
    private updateFireLight(dt: number, field: HazardField, now: number): void {
        if (!usesTongues(this.quality)) return;
        let total = 0;
        let cx = 0;
        let cz = 0;
        field.forEachFireCell(now, (x, z) => {
            total++;
            cx += x;
            cz += z;
        });
        if (total === 0) {
            this.fireLight.visible = false;
            return;
        }
        cx /= total;
        cz /= total;
        let bestX = cx;
        let bestZ = cz;
        let bestD = Infinity;
        field.forEachFireCell(now, (x, z) => {
            const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
            if (d < bestD) {
                bestD = d;
                bestX = x;
                bestZ = z;
            }
        });
        this.lightTime += dt;
        const t = this.lightTime;
        // two incommensurate sine waves ≈ organic flicker without randomness
        const flicker = 0.82 + 0.12 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 27.7);
        const size = Math.min(1, total / 24); // small fires glow less
        this.fireLight.visible = true;
        this.fireLight.position.set(bestX, groundSupportAt(bestX, bestZ) + 2.4, bestZ);
        this.fireLight.intensity = (this.quality === 'high' ? 260 : 170) * size * flicker;
        this.fireLight.distance = 30 + 26 * size;
    }

    spawnFromEvents(events: readonly SimEvent[]): void {
        if (this.quality === 'off') return;
        const maxTier = this.quality === 'high';
        const rich = usesTongues(this.quality);
        for (const e of events) {
            if (e.kind !== 'groundFire') continue;
            const y = e.y + 0.2;
            const count = maxTier ? 40 : rich ? 28 : 10;
            this.particles.burst(e.x, y, e.z, {
                count,
                color: 0xff6a18,
                speed: 6,
                life: 0.7,
                up: 8,
            });
            this.particles.burst(e.x, y + 0.4, e.z, {
                count: maxTier ? 22 : rich ? 14 : 5,
                color: 0xffd040,
                speed: 4,
                life: 0.45,
                up: 10,
            });
            if (e.oilCells > 0) {
                this.particles.burst(e.x, y + 0.2, e.z, {
                    count: maxTier ? 32 : rich ? 20 : 8,
                    color: 0xff2200,
                    speed: 9,
                    life: 0.9,
                    up: 12,
                });
            }
        }
    }

    /**
     * Flame licks on mechs whose burn DoT is running — the sim already tracks
     * `burnUntil`/`burnDps`, this just makes it visible. Budgeted per tier.
     */
    updateBurningActors(dt: number, actors: readonly Actor[], now: number): void {
        if (this.quality === 'off') return;
        this.burnAcc += dt;
        const maxTier = this.quality === 'high';
        const period = maxTier ? 0.12 : 0.2;
        if (this.burnAcc < period) return;
        this.burnAcc = 0;
        const burning: Actor[] = [];
        for (const a of actors) {
            if (a.alive && a.burnDps > 0 && a.burnUntil > now) burning.push(a);
        }
        if (burning.length === 0) return;
        const budget = maxTier ? 14 : 8;
        const stride = Math.max(1, Math.ceil(burning.length / budget));
        for (let i = 0; i < burning.length; i += stride) {
            const a = burning[i]!;
            this.particles.burst(a.rx, a.footY + 0.9, a.rz, {
                count: maxTier ? 3 : 2,
                color: 0xff6a18,
                speed: 1.6,
                life: 0.45,
                up: 5,
            });
            if (maxTier) {
                this.particles.burst(a.rx, a.footY + 1.7, a.rz, {
                    count: 1,
                    color: 0x2c2824,
                    speed: 0.6,
                    life: 1.1,
                    up: 2.2,
                    blood: true,
                });
            }
        }
    }

    /** continuous fire visuals on active cells (throttled; visual-only) */
    update(dt: number, field: HazardField | null, now: number): void {
        if (usesTongues(this.quality)) this.flames.update(dt, field, now);
        if (!field || this.quality === 'off') {
            this.fireLight.visible = false;
            return;
        }
        this.updateFireLight(dt, field, now);

        const maxTier = this.quality === 'high';
        const rich = usesTongues(this.quality);

        if (rich) {
            this.smokeAcc += dt;
            const smokePeriod = maxTier ? 0.16 : 0.28;
            if (this.smokeAcc >= smokePeriod) {
                this.smokeAcc = 0;
                let total = 0;
                field.forEachFireCell(now, () => total++);
                if (total > 0) {
                    const picks = maxTier ? Math.min(3, total) : 1;
                    for (let p = 0; p < picks; p++) {
                        const pick = Math.floor(Math.random() * total);
                        let i = 0;
                        field.forEachFireCell(now, (x, z) => {
                            if (i++ !== pick) return;
                            this.particles.burst(x, groundSupportAt(x, z) + 2.6, z, {
                                count: maxTier ? 3 : 2,
                                color: 0x2c2824,
                                speed: 0.9,
                                life: 1.7,
                                up: 2.6,
                                blood: true,
                            });
                        });
                    }
                }
            }
        }

        this.emitAcc += dt;
        const period = maxTier ? 0.14 : rich ? 0.22 : 0.35;
        if (this.emitAcc < period) return;
        this.emitAcc = 0;

        const budget = maxTier ? 48 : rich ? 20 : 12;
        let total = 0;
        field.forEachFireCell(now, () => {
            total++;
        });
        if (total === 0) return;

        const stride = Math.max(1, Math.ceil(total / budget));
        // stable subset — rotating phase made sparks hop and felt laggy
        let i = 0;
        let n = 0;
        field.forEachFireCell(now, (x, z) => {
            if (n >= budget) return;
            if (i++ % stride !== 0) return;
            if (this.quality === 'low' && ((Math.floor(x) + Math.floor(z)) & 1) === 0) return;
            const y = groundSupportAt(x, z) + 0.15;
            this.particles.burst(x, y, z, {
                count: maxTier ? 4 : rich ? 3 : 1,
                color: 0xff5510,
                speed: 2.5,
                life: 0.55,
                up: 6,
            });
            n++;
        });
    }
}
