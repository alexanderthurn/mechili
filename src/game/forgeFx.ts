/**
 * Visual-only Stronghold forge chimney — layered white heat, yellow embers,
 * and charcoal smoke from the GLB `Flag` socket ({@link strongholdFlagAnchorWorld}).
 */
import { AdditiveBlending, NormalBlending, type Scene } from 'three';
import { SoftParticlePool } from './effects';
import { resolveForge, type ForgeSlot, type ForgeSpellPool } from './forgeRecipes';
import { strongholdFlagAnchorWorld } from './strongholdFlags';
import { STRONGHOLD, type Unit } from './units';

export type ForgeGlowMode = 'off' | 'cooking' | 'ready';

const CHIMNEY_LIFT = 0.5;
const SPAWN_JITTER = 0.28;

/** Derive spark intensity from oven contents + unlocked spell pool. */
export function forgeGlowMode(
    oven: readonly (ForgeSlot | null)[],
    pool: ForgeSpellPool,
): ForgeGlowMode {
    let filled = false;
    for (const s of oven) {
        if (s) {
            filled = true;
            break;
        }
    }
    if (!filled) return 'off';
    return resolveForge(oven, pool).product ? 'ready' : 'cooking';
}

type ChimneyPreset = {
    up: number;
    heatCount: number;
    emberCount: number;
    waitMin: number;
    waitMax: number;
};

const COOKING: ChimneyPreset = {
    up: 2.1,
    heatCount: 2,
    emberCount: 2,
    waitMin: 0.48,
    waitMax: 0.72,
};

const READY: ChimneyPreset = {
    up: 2.5,
    heatCount: 3,
    emberCount: 4,
    waitMin: 0.28,
    waitMax: 0.48,
};

/** Three-layer chimney plume — no gravity, soft sprites only. */
class ForgeChimney {
    /** pale hot air at the mouth */
    private readonly heat: SoftParticlePool;
    /** gold ember flecks */
    private readonly embers: SoftParticlePool;
    /** charcoal + gray smoke billows */
    private readonly smoke: SoftParticlePool;

    constructor(scene: Scene) {
        this.heat = new SoftParticlePool(scene, {
            blending: AdditiveBlending,
            size: 2.6,
            depthWrite: false,
            renderOrder: 2,
            opacity: 0.72,
            maxParticles: 64,
            gravity: 0,
            drag: 0.75,
            fadeStart: 0.22,
            sizeGrowth: 0.12,
        });
        this.embers = new SoftParticlePool(scene, {
            blending: AdditiveBlending,
            size: 1.5,
            depthWrite: false,
            renderOrder: 3,
            maxParticles: 96,
            gravity: 0,
            drag: 0.9,
            fadeStart: 0.18,
            sizeGrowth: 0.06,
        });
        this.smoke = new SoftParticlePool(scene, {
            blending: NormalBlending,
            size: 2.4,
            depthWrite: false,
            renderOrder: 1,
            opacity: 0.48,
            maxParticles: 128,
            gravity: 0,
            drag: 0.28,
            lateralDrag: 4.5,
            maxLateralSpeed: 0.22,
            fadeStart: 0.07,
            sizeBirthScale: 0.12,
            sizeBirthPhase: 0.1,
            sizeGrowth: 2.2,
        });
    }

    puff(x: number, y: number, z: number, ready: boolean): void {
        const p = ready ? READY : COOKING;
        const up = p.up;

        // white / cream heat column — tight, short-lived
        this.heat.burst(x, y, z, {
            count: p.heatCount,
            color: 0xfff6ea,
            speed: 0.28,
            life: 1.6,
            up: up * 1.05,
            spread: 0.2,
        });
        this.heat.burst(x, y, z, {
            count: 1,
            color: 0xffffff,
            speed: 0.18,
            life: 1.1,
            up: up * 0.95,
            spread: 0.12,
        });

        // yellow-orange embers — a little faster & brighter when recipe is ready
        this.embers.burst(x, y, z, {
            count: p.emberCount,
            color: ready ? 0xffd040 : 0xffb020,
            speed: ready ? 0.55 : 0.42,
            life: ready ? 2.4 : 2.8,
            up: up * 1.15,
            spread: 0.38,
        });
        if (ready) {
            this.embers.burst(x, y, z, {
                count: 2,
                color: 0xffee88,
                speed: 0.35,
                life: 1.8,
                up: up * 1.25,
                spread: 0.28,
            });
        }

        // smoke — pinhole at mouth → full column → wide gray billow → dissolve aloft
        this.smoke.burst(x, y, z, {
            count: ready ? 5 : 3,
            color: 0x080604,
            colorEnd: 0xd4d0c8,
            speed: 0.14,
            life: 8.5,
            up,
            spread: 0.04,
        });
        if (ready) {
            this.smoke.burst(x, y, z, {
                count: 2,
                color: 0x141210,
                colorEnd: 0xe8e4dc,
                speed: 0.1,
                life: 7.0,
                up: up * 0.92,
                spread: 0.03,
            });
        }
    }

    update(dt: number): void {
        this.smoke.update(dt);
        this.heat.update(dt);
        this.embers.update(dt);
    }
}

export class ForgeFx {
    private readonly puffWait = new Map<number, number>();
    private chimney: ForgeChimney | null = null;

    ensure(scene: Scene): void {
        if (!this.chimney) this.chimney = new ForgeChimney(scene);
    }

    update(
        dt: number,
        _timeSeconds: number,
        targets: readonly { unit: Unit; mode: ForgeGlowMode }[],
        scene: Scene,
    ): void {
        this.ensure(scene);
        const chimney = this.chimney!;

        const seen = new Set<number>();
        for (const { unit, mode } of targets) {
            if (unit.type !== STRONGHOLD || unit.destroyed) continue;
            seen.add(unit.id);

            if (mode === 'off') {
                this.puffWait.delete(unit.id);
                continue;
            }

            const preset = mode === 'ready' ? READY : COOKING;
            let wait = this.puffWait.get(unit.id) ?? 0;
            wait -= dt;
            if (wait <= 0) {
                const anchor = strongholdFlagAnchorWorld(unit);
                chimney.puff(
                    anchor.x + (Math.random() - 0.5) * SPAWN_JITTER,
                    anchor.y + CHIMNEY_LIFT,
                    anchor.z + (Math.random() - 0.5) * SPAWN_JITTER,
                    mode === 'ready',
                );
                wait = preset.waitMin + Math.random() * (preset.waitMax - preset.waitMin);
            }
            this.puffWait.set(unit.id, wait);
        }

        for (const id of [...this.puffWait.keys()]) {
            if (!seen.has(id)) this.puffWait.delete(id);
        }

        chimney.update(dt);
    }
}
