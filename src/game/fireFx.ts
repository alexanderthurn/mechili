import { Color, PointLight, type Scene } from 'three';
import { groundSupportAt } from './map';
import { FIRE_TINT_DRAGON } from './fire';
import type { HazardField } from './fire';
import { prefs, type BloomQuality, type FireVfxQuality } from './prefs';
import type { Particles } from './effects';
import { boltTipWorldOffset } from './effects';
import { FlameRenderer, type BreathTongueSample } from './flameRenderer';
import type { Actor, Projectile, SimEvent } from './sim';

export type { BreathTongueSample };

function usesTongues(q: FireVfxQuality): boolean {
    return q === 'medium' || q === 'high';
}

/** Tongue / fire-light HDR scale when bloom is active (1 = authored look). */
function bloomFireGain(bloom: BloomQuality): number {
    if (bloom === 'high') return 0.4;
    if (bloom === 'ultra') return 0.34;
    return 1;
}

/** True when flame tongues are drawn (medium/high fire VFX). */
export function fireUsesTongues(q: FireVfxQuality = prefs().fireVfx): boolean {
    return usesTongues(q);
}

/** How long a muzzle flame burns (s) — a flash, not a torch. */
const MUZZLE_FLAME_S = 0.09;
/** Flame size on a burning stone, per unit of the stone's own mesh scale. */
const STONE_FLAME_SIZE = 2.6;
/** …never smaller than this, or a small rock's flame reads as a spark. */
const STONE_FLAME_MIN = 1.2;
/** How far behind the rock (× its scale) the flame is anchored. */
const STONE_FLAME_LAG = 0.5;

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
    private bloomGain = 1;
    private emitAcc = 0;
    private smokeAcc = 0;
    private burnAcc = 0;
    private readonly flames: FlameRenderer;
    /** ONE shared flickering light on the biggest blaze (medium/high tiers) */
    private readonly fireLight: PointLight;
    private lightTime = 0;
    private readonly tipScratch: BreathTongueSample[] = [];
    /**
     * Short-lived flame tongues on the projectile-tip pool: muzzle flashes ({@link UnitType.muzzleFlame})
     * and shell detonations ({@link UnitType.impactBlast}). `d` = lean (omit = upright); the size
     * swells over the first `rise` of the life, then shrinks to nothing.
     */
    private readonly flashes: {
        x: number; y: number; z: number;
        d: { x: number; y: number; z: number } | null;
        scale: number; born: number; life: number; rise: number;
    }[] = [];

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

    /** Keep fire readable under selective bloom (tongues + shared point light). */
    setBloomComp(bloom: BloomQuality): void {
        this.bloomGain = bloomFireGain(bloom);
        this.flames.setBloomGain(this.bloomGain);
    }

    /**
     * A gun's muzzle flash: not the arrow's one trailing streak but a short star — a long tongue
     * along the shot and two shorter ones fanned out to the sides, all at full size at once and
     * gone within a blink. Big flashes (a tank's) burn a little longer.
     */
    muzzleFlash(x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number): void {
        if (!usesTongues(this.quality)) return;
        const born = performance.now();
        const life = MUZZLE_FLAME_S * (scale > 1.5 ? 1.8 : 1);
        const out = 0.3 * scale; // the flash's body sits just past the muzzle
        const fx = x + dx * out, fy = y + dy * out, fz = z + dz * out;
        this.flashes.push({ x: fx, y: fy, z: fz, d: { x: dx, y: dy, z: dz }, scale: scale * 1.15, born, life, rise: 0 });
        // the side tongues: the shot's direction turned ±60° about the vertical
        const flat = Math.hypot(dx, dz) || 1;
        for (const sgn of [-1, 1]) {
            const c = Math.cos(1.05), s = Math.sin(1.05) * sgn;
            const sx = (dx * c - dz * s) / flat, sz = (dx * s + dz * c) / flat;
            this.flashes.push({ x: fx, y: fy, z: fz, d: { x: sx, y: 0.2, z: sz }, scale: scale * 0.55, born, life: life * 0.8, rise: 0 });
        }
    }

    /**
     * A shell's detonation: a crown of big upright tongues around the blast and a tall one in the
     * middle, flaring up in the first moment and dying down over about half a second.
     */
    impactFlames(x: number, y: number, z: number, radius: number): void {
        if (!usesTongues(this.quality)) return;
        const born = performance.now();
        const s = Math.max(1, radius / 2);
        this.flashes.push({ x, y: y + 0.3 * s, z, d: null, scale: 4.2 * s, born, life: 0.55, rise: 0.12 });
        const ring = 6;
        for (let i = 0; i < ring; i++) {
            const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4;
            const r = radius * (0.35 + Math.random() * 0.25);
            const ox = Math.cos(a), oz = Math.sin(a);
            // each leans outward, away from the blast
            this.flashes.push({
                x: x + ox * r, y: y + 0.2 * s, z: z + oz * r,
                d: { x: ox, y: 0.6, z: oz },
                scale: (2.2 + Math.random() * 1.2) * s, born: born + Math.random() * 60,
                life: 0.38 + Math.random() * 0.2, rise: 0.15,
            });
        }
    }

    /** drop continuous fire VFX (call when the battle ends — flames are battle-only) */
    clear(): void {
        this.flashes.length = 0;
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
     * One flame per lit projectile: at the tip of a fire arrow / ballista bolt,
     * and wrapped around a burning stone (the mortar's pitch-soaked shot — a
     * rock shows nothing by itself, so the flame is what makes the fire it
     * leaves on the ground believable). Cleared when the projectile hits or
     * expires (TTL ≈ 3s).
     */
    syncProjectileTips(projectiles: readonly Projectile[], alpha: number): void {
        this.tipScratch.length = 0;
        if (!usesTongues(this.quality)) {
            this.flames.setProjectileTips(this.tipScratch);
            return;
        }
        const now = performance.now();
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i]!;
            const t = (now - f.born) / (f.life * 1000);
            if (t >= 1) {
                this.flashes.splice(i, 1);
                continue;
            }
            if (t < 0) continue; // a crown tongue that hasn't lit yet
            const k = f.rise > 0 && t < f.rise ? t / f.rise : Math.sqrt(1 - (t - f.rise) / (1 - f.rise));
            // a tip flame leans along the d it is given (an arrow passes −velocity, a trail); the
            // shot's own direction makes it lick forward, out of the barrel. No d: upright.
            const scale = f.scale * Math.max(0.05, k);
            this.tipScratch.push(f.d ? { x: f.x, y: f.y, z: f.z, scale, dx: f.d.x, dy: f.d.y, dz: f.d.z } : { x: f.x, y: f.y, z: f.z, scale });
        }
        for (const p of projectiles) {
            if (!p.lit) continue;
            const bolt = p.style === 'arrow' || p.style === 'largeArrow';
            // a landed stone has spent its fire on the ground, and the
            // hammerer's swelling blast disc (scaleEnd) is flame already
            const stone =
                p.style === 'stone' && p.scaleEnd == null && !p.stone?.landed;
            if (!bolt && !stone) continue;
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
            const size = typeof p.scale === 'number' ? p.scale : 1;
            // bolts: exact tip of the scaled bolt.glb (+Z local × instance
            // scale). Stones: a touch BEHIND the rock, so the rock stays
            // readable inside the flame instead of being swallowed by it.
            const tip = stone
                ? -size * STONE_FLAME_LAG
                : boltTipWorldOffset(p.style === 'largeArrow' ? 'largeArrow' : 'arrow');
            this.tipScratch.push({
                x: x + vx * tip,
                y: y + vy * tip,
                z: z + vz * tip,
                scale: stone
                    ? Math.max(STONE_FLAME_MIN, size * STONE_FLAME_SIZE)
                    : p.style === 'largeArrow'
                      ? 2
                      : 1,
                // −velocity → tip lean mixes this with world-up (~45° back)
                dx: -vx,
                dy: -vy,
                dz: -vz,
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
        this.fireLight.intensity =
            (this.quality === 'high' ? 260 : 170) * size * flicker * this.bloomGain;
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
