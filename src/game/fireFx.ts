import { Color, PointLight, type Scene } from 'three';
import { groundSupportAt } from './map';
import { FIRE_TINT_DRAGON } from './fire';
import type { HazardField } from './fire';
import { prefs, type FireVfxQuality } from './prefs';
import type { Particles } from './effects';
import { boltTipWorldOffset } from './effects';
import { FlameRenderer, type BreathTongueSample } from './flameRenderer';
import type { Actor, Projectile, SimEvent } from './sim';

export type { BreathTongueSample };

function usesTongues(q: FireVfxQuality): boolean {
    return q === 'medium' || q === 'high';
}

const ORANGE_EMBER = 0xff6a18;
const ORANGE_CORE = 0xffd040;
const ORANGE_HOT = 0xff2200;
const ORANGE_SPARK = 0xff5510;
// dragon: orange + deep blue accents (icea = full icy; see FIRE_TINT_DRAGON)
const AZURE_EMBER = 0xff7030;
const AZURE_CORE = 0xffc878;
const AZURE_HOT = 0x2840a0;
const AZURE_SPARK = 0xff8238;
const LIGHT_ORANGE = new Color(0xff7a28);
const LIGHT_AZURE = new Color(0xe07040);

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
    private readonly tipScratch: BreathTongueSample[] = [];

    constructor(
        private readonly particles: Particles,
        scene: Scene,
    ) {
        this.flames = new FlameRenderer(scene);
        this.flames.setQuality(this.quality);
        // castShadow stays off: a shadow-casting point light re-renders the
        // scene 6× (cube map) — not worth it for a top-down view.
        // Keep visible always (intensity 0 when idle): toggling visibility mid-
        // battle forces every MeshStandardMaterial to recompile for the new
        // point-light count — a multi-hundred-ms hitch on first blaze.
        this.fireLight = new PointLight(0xff7a28, 0, 46, 1.6);
        this.fireLight.visible = true;
        scene.add(this.fireLight);
    }

    setQuality(q: FireVfxQuality): void {
        this.quality = q;
        this.flames.setQuality(q);
        if (!usesTongues(q)) this.fireLight.intensity = 0;
    }

    /** drop continuous fire VFX (call when the battle ends — flames are battle-only) */
    clear(): void {
        this.flames.clear();
        this.emitAcc = 0;
        this.smokeAcc = 0;
        this.fireLight.intensity = 0;
    }

    /** Dragon breath column samples for this frame (scenery high/ultra). */
    setBreathTongues(samples: readonly BreathTongueSample[]): void {
        this.flames.setBreathTongues(samples);
    }

    /** Tip flames on lit arrows / ballista bolts this frame. */
    setProjectileTips(samples: readonly BreathTongueSample[]): void {
        this.flames.setProjectileTips(samples);
    }

    /**
     * One tip flame per fire arrow / lit ballista bolt. Cleared when the
     * projectile hits or expires (TTL ≈ 3s).
     */
    syncProjectileTips(projectiles: readonly Projectile[], alpha: number): void {
        this.tipScratch.length = 0;
        if (!usesTongues(this.quality)) {
            this.flames.setProjectileTips(this.tipScratch);
            return;
        }
        for (const p of projectiles) {
            if (!p.lit) continue;
            if (p.style !== 'arrow' && p.style !== 'largeArrow') continue;
            const x = p.px + (p.x - p.px) * alpha;
            const y = p.py + (p.y - p.py) * alpha;
            const z = p.pz + (p.z - p.pz) * alpha;
            let vx = p.vx;
            let vy = p.vy;
            let vz = p.vz;
            const speed = Math.hypot(vx, vy, vz) || 1;
            vx /= speed;
            vy /= speed;
            vz /= speed;
            // Exact tip of the scaled bolt.glb (+Z local × instance scale).
            const tip = boltTipWorldOffset(p.style);
            this.tipScratch.push({
                x: x + vx * tip,
                y: y + vy * tip,
                z: z + vz * tip,
                scale: p.style === 'largeArrow' ? 2 : 1,
            });
        }
        this.flames.setProjectileTips(this.tipScratch);
    }

    /** Force flame tongues + lit point light into the compile set (boot / match start). */
    primeForCompile(): void {
        this.flames.primeForCompile();
        this.fireLight.intensity = 80;
        this.fireLight.position.set(0, 3, 0);
    }

    /** Places the shared light on the blaze centroid (snapped to a real fire
     *  cell so two separate fires don't light their empty midpoint). */
    private updateFireLight(dt: number, field: HazardField, now: number): void {
        if (!usesTongues(this.quality)) return;
        let total = 0;
        let dragon = 0;
        let cx = 0;
        let cz = 0;
        field.forEachFireCell(now, (x, z, _dps, _until, tint) => {
            total++;
            if (tint === FIRE_TINT_DRAGON) dragon++;
            cx += x;
            cz += z;
        });
        if (total === 0) {
            this.fireLight.intensity = 0;
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
        this.fireLight.color.copy(LIGHT_ORANGE).lerp(LIGHT_AZURE, dragon / total);
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
            const azure = e.tint === FIRE_TINT_DRAGON;
            const count = maxTier ? 40 : rich ? 28 : 10;
            this.particles.burst(e.x, y, e.z, {
                count,
                color: azure ? AZURE_EMBER : ORANGE_EMBER,
                speed: 6,
                life: 0.7,
                up: 8,
            });
            this.particles.burst(e.x, y + 0.4, e.z, {
                count: maxTier ? 22 : rich ? 14 : 5,
                color: azure ? AZURE_CORE : ORANGE_CORE,
                speed: 4,
                life: 0.45,
                up: 10,
            });
            if (e.oilCells > 0) {
                this.particles.burst(e.x, y + 0.2, e.z, {
                    count: maxTier ? 32 : rich ? 20 : 8,
                    color: azure ? AZURE_HOT : ORANGE_HOT,
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
            this.fireLight.intensity = 0;
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
        field.forEachFireCell(now, (x, z, _dps, _until, tint) => {
            if (n >= budget) return;
            if (i++ % stride !== 0) return;
            if (this.quality === 'low' && ((Math.floor(x) + Math.floor(z)) & 1) === 0) return;
            const y = groundSupportAt(x, z) + 0.15;
            this.particles.burst(x, y, z, {
                count: maxTier ? 4 : rich ? 3 : 1,
                color: tint === FIRE_TINT_DRAGON ? AZURE_SPARK : ORANGE_SPARK,
                speed: 2.5,
                life: 0.55,
                up: 6,
            });
            n++;
        });
    }
}
