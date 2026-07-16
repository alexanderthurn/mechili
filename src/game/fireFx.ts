import { groundSupportAt } from './map';
import type { HazardField } from './fire';
import { prefs, type FireVfxQuality } from './prefs';
import type { Particles } from './effects';
import type { SimEvent } from './sim';

/**
 * Fire VFX — visual only (may use Math.random). Anchors flames at terrain height.
 * high = denser continuous embers; low = sparse bursts on spawn only.
 */
export class FireFx {
    private quality: FireVfxQuality = prefs().fireVfx;
    private emitAcc = 0;

    constructor(private readonly particles: Particles) {}

    setQuality(q: FireVfxQuality): void {
        this.quality = q;
    }

    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            if (e.kind !== 'groundFire') continue;
            const y = e.y + 0.2;
            const count = this.quality === 'high' ? 28 : 10;
            this.particles.burst(e.x, y, e.z, {
                count,
                color: 0xff6a18,
                speed: 6,
                life: 0.7,
                up: 8,
            });
            this.particles.burst(e.x, y + 0.4, e.z, {
                count: this.quality === 'high' ? 14 : 5,
                color: 0xffd040,
                speed: 4,
                life: 0.45,
                up: 10,
            });
            if (e.oilCells > 0) {
                this.particles.burst(e.x, y + 0.2, e.z, {
                    count: this.quality === 'high' ? 20 : 8,
                    color: 0xff2200,
                    speed: 9,
                    life: 0.9,
                    up: 12,
                });
            }
        }
    }

    /** continuous flame tips on active fire cells (throttled; visual-only) */
    update(dt: number, field: HazardField | null, now: number): void {
        if (!field || this.quality === 'off') return;
        this.emitAcc += dt;
        const period = this.quality === 'high' ? 0.12 : 0.35;
        if (this.emitAcc < period) return;
        this.emitAcc = 0;

        let n = 0;
        const budget = this.quality === 'high' ? 48 : 12;
        field.forEachFireCell(now, (x, z) => {
            if (n >= budget) return;
            if (this.quality === 'low' && ((Math.floor(x) + Math.floor(z)) & 1) === 0) return;
            const y = groundSupportAt(x, z) + 0.15;
            this.particles.burst(x, y, z, {
                count: this.quality === 'high' ? 3 : 1,
                color: 0xff5510,
                speed: 2.5,
                life: 0.55,
                up: 6,
            });
            n++;
        });
    }
}
