/**
 * Visual-only Stronghold spell forge: while a commander spell bought this round
 * still charges there (ActionDispatcher.chargingSpells), a slow magical plume
 * rises from the keep top — the Stronghold chimney's idea in arcane colours,
 * but few, big, soft clouds instead of many small puffs (cheap to draw).
 * The anchor is the model's `Flag` socket, else the top of its mesh
 * ({@link strongholdFlagAnchorWorld}).
 */
import { AdditiveBlending, NormalBlending, type Scene } from 'three';
import { SoftParticlePool } from './effects';
import { strongholdFlagAnchorWorld } from './strongholdFlags';
import type { Unit } from './units';

/** above the anchor: the plume starts just over the roof */
const PLUME_LIFT = 0.6;
const SPAWN_JITTER = 0.35;
/** seconds between two clouds of one tower */
const WAIT_MIN = 0.7;
const WAIT_MAX = 1.1;
/** the cloud colours, cycled — violet, arcane blue, teal */
const CLOUD_COLORS: readonly [number, number][] = [
    [0x7a3cff, 0xd8b8ff],
    [0x2f6bff, 0xa8d4ff],
    [0x14c8b4, 0xb4fff0],
];

class MagicPlume {
    /** big slow clouds, tinted, fading to pale aloft */
    private readonly clouds: SoftParticlePool;
    /** a soft glow at the mouth and a few sparks riding up */
    private readonly glow: SoftParticlePool;
    private colorIndex = 0;

    constructor(scene: Scene) {
        this.clouds = new SoftParticlePool(scene, {
            blending: NormalBlending,
            size: 4.2,
            depthWrite: false,
            renderOrder: 1,
            opacity: 0.42,
            maxParticles: 48,
            gravity: 0,
            drag: 0.22,
            lateralDrag: 3.5,
            maxLateralSpeed: 0.3,
            fadeStart: 0.1,
            sizeBirthScale: 0.25,
            sizeBirthPhase: 0.15,
            sizeGrowth: 1.6,
            dissolveSpread: 0.7,
        });
        this.glow = new SoftParticlePool(scene, {
            blending: AdditiveBlending,
            size: 2.2,
            depthWrite: false,
            renderOrder: 2,
            opacity: 0.6,
            maxParticles: 48,
            gravity: 0,
            drag: 0.8,
            fadeStart: 0.2,
            sizeGrowth: 0.1,
            dissolveSpread: 0.45,
        });
    }

    puff(x: number, y: number, z: number): void {
        const [color, colorEnd] = CLOUD_COLORS[this.colorIndex++ % CLOUD_COLORS.length]!;
        // one big cloud per puff — the plume reads from its size, not its count
        this.clouds.burst(x, y, z, { count: 1, color, colorEnd, speed: 0.12, life: 6.5, up: 1.8, spread: 0.05 });
        this.glow.burst(x, y, z, { count: 1, color: colorEnd, speed: 0.1, life: 1.2, up: 1.4, spread: 0.1 });
        this.glow.burst(x, y, z, { count: 2, color, speed: 0.45, life: 2.2, up: 2.4, spread: 0.4 });
    }

    update(dt: number): void {
        this.clouds.update(dt);
        this.glow.update(dt);
    }
}

export class GarrisonFx {
    private readonly wait = new Map<number, number>();
    private plume: MagicPlume | null = null;

    /** `forging`: the towers with a spell charging now (already filtered for what the viewer may know) */
    update(dt: number, forging: readonly Unit[], scene: Scene): void {
        if (!this.plume) {
            if (forging.length === 0) return; // nothing ever charged: no pools yet
            this.plume = new MagicPlume(scene);
        }
        const seen = new Set<number>();
        for (const unit of forging) {
            if (unit.destroyed) continue;
            seen.add(unit.id);
            let wait = (this.wait.get(unit.id) ?? 0) - dt;
            if (wait <= 0) {
                const anchor = strongholdFlagAnchorWorld(unit);
                this.plume.puff(
                    anchor.x + (Math.random() - 0.5) * SPAWN_JITTER,
                    anchor.y + PLUME_LIFT,
                    anchor.z + (Math.random() - 0.5) * SPAWN_JITTER,
                );
                wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
            }
            this.wait.set(unit.id, wait);
        }
        for (const id of [...this.wait.keys()]) if (!seen.has(id)) this.wait.delete(id);
        // clouds already up finish rising even once the charge is done
        this.plume.update(dt);
    }
}
