import type { Scene } from 'three';
import { groundSupportAt } from './map';
import type { HazardField } from './fire';
import { prefs, type FireVfxQuality } from './prefs';
import type { Particles } from './effects';
import { FlameRenderer } from './flameRenderer';
import type { SimEvent } from './sim';

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
    private readonly flames: FlameRenderer;

    constructor(
        private readonly particles: Particles,
        scene: Scene,
    ) {
        this.flames = new FlameRenderer(scene);
        this.flames.setQuality(this.quality);
    }

    setQuality(q: FireVfxQuality): void {
        this.quality = q;
        this.flames.setQuality(q);
    }

    /** drop continuous fire VFX (call when the battle ends — flames are battle-only) */
    clear(): void {
        this.flames.clear();
        this.emitAcc = 0;
        this.smokeAcc = 0;
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

    /** continuous fire visuals on active cells (throttled; visual-only) */
    update(dt: number, field: HazardField | null, now: number): void {
        if (usesTongues(this.quality)) this.flames.update(dt, field, now);
        if (!field || this.quality === 'off') return;

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
