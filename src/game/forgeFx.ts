/**
 * Visual-only forge feedback on the Stronghold: soft chimney sparks while the
 * oven holds runes (denser when a recipe will bake).
 *
 * Uses a dedicated Points pool (not the shared battle Particles) so embers can
 * depth-write like status badges — otherwise transparent tree billboards that
 * are farther away still paint over sparks when transparent sort order loses.
 */
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DynamicDrawUsage,
    Points,
    PointsMaterial,
    Sphere,
    Vector3,
    type Scene,
} from 'three';
import { resolveForge, type ForgeSlot, type ForgeSpellPool } from './forgeRecipes';
import { worldHeightAt } from './map';
import { getUnitVisualHeight } from './unitModels';
import { STRONGHOLD, type Unit } from './units';

export type ForgeGlowMode = 'off' | 'cooking' | 'ready';

const COOK_COLOR = 0xff8a30;
const READY_COLOR = 0xffd060;
const MAX_EMBERS = 128;
const GRAVITY = -14;

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
    return resolveForge(oven, pool).tacticId ? 'ready' : 'cooking';
}

/** Small depth-writing ember pool — same transparency trap as the old rune sprites. */
class ForgeEmbers {
    private readonly positions = new Float32Array(MAX_EMBERS * 3);
    private readonly colors = new Float32Array(MAX_EMBERS * 3);
    private readonly velocities = new Float32Array(MAX_EMBERS * 3);
    private readonly baseColors = new Float32Array(MAX_EMBERS * 3);
    private readonly life = new Float32Array(MAX_EMBERS);
    private readonly maxLife = new Float32Array(MAX_EMBERS);
    private readonly geometry = new BufferGeometry();
    private readonly tmpColor = new Color();
    private cursor = 0;

    constructor(scene: Scene) {
        this.positions.fill(0);
        for (let i = 0; i < MAX_EMBERS; i++) this.positions[i * 3 + 1] = -9999;
        this.geometry.setAttribute(
            'position',
            new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage),
        );
        this.geometry.setAttribute(
            'color',
            new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage),
        );
        // stable bounds so transparent sort isn't yanked by parked (-9999) points
        this.geometry.boundingSphere = new Sphere(new Vector3(0, 8, 0), 400);
        this.geometry.boundingBox = null;

        const points = new Points(
            this.geometry,
            new PointsMaterial({
                size: 1.6,
                vertexColors: true,
                transparent: true,
                // write depth so farther tree billboards can't overpaint us
                depthWrite: true,
                depthTest: true,
                blending: AdditiveBlending,
                sizeAttenuation: true,
            }),
        );
        points.frustumCulled = false;
        points.renderOrder = 1;
        scene.add(points);
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: { count: number; color: number; speed: number; life: number; up: number },
    ): void {
        this.tmpColor.setHex(opts.color);
        for (let n = 0; n < opts.count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_EMBERS;
            const angle = Math.random() * Math.PI * 2;
            const pitch = Math.random() * Math.PI - Math.PI / 2;
            const speed = opts.speed * (0.4 + Math.random() * 0.6);
            this.positions[i * 3] = x;
            this.positions[i * 3 + 1] = y;
            this.positions[i * 3 + 2] = z;
            this.velocities[i * 3] = Math.cos(angle) * Math.cos(pitch) * speed;
            this.velocities[i * 3 + 1] = Math.abs(Math.sin(pitch)) * speed + opts.up;
            this.velocities[i * 3 + 2] = Math.sin(angle) * Math.cos(pitch) * speed;
            this.baseColors[i * 3] = this.tmpColor.r;
            this.baseColors[i * 3 + 1] = this.tmpColor.g;
            this.baseColors[i * 3 + 2] = this.tmpColor.b;
            this.life[i] = opts.life * (0.6 + Math.random() * 0.4);
            this.maxLife[i] = this.life[i]!;
        }
    }

    update(dt: number): void {
        for (let i = 0; i < MAX_EMBERS; i++) {
            if (this.life[i]! <= 0) continue;
            this.life[i]! -= dt;
            if (this.life[i]! <= 0) {
                this.positions[i * 3 + 1] = -9999;
                this.colors[i * 3] = 0;
                this.colors[i * 3 + 1] = 0;
                this.colors[i * 3 + 2] = 0;
                continue;
            }
            this.velocities[i * 3 + 1]! += GRAVITY * dt;
            this.positions[i * 3]! += this.velocities[i * 3]! * dt;
            this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
            this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
            if (this.positions[i * 3 + 1]! < -50) this.positions[i * 3 + 1] = -50;
            const fade = this.life[i]! / this.maxLife[i]!;
            this.colors[i * 3] = this.baseColors[i * 3]! * fade;
            this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1]! * fade;
            this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2]! * fade;
        }
        this.geometry.attributes.position!.needsUpdate = true;
        this.geometry.attributes.color!.needsUpdate = true;
    }
}

export class ForgeFx {
    private readonly sparkWait = new Map<number, number>();
    private embers: ForgeEmbers | null = null;

    /** Lazy-bind to the scene on first update (Game constructs ForgeFx before scene FX). */
    ensure(scene: Scene): void {
        if (!this.embers) this.embers = new ForgeEmbers(scene);
    }

    update(
        dt: number,
        _timeSeconds: number,
        targets: readonly { unit: Unit; mode: ForgeGlowMode }[],
        scene: Scene,
    ): void {
        this.ensure(scene);
        const embers = this.embers!;

        const seen = new Set<number>();
        for (const { unit, mode } of targets) {
            if (unit.type !== STRONGHOLD || unit.destroyed) continue;
            seen.add(unit.id);

            if (mode === 'off') {
                this.sparkWait.delete(unit.id);
                continue;
            }

            let wait = this.sparkWait.get(unit.id) ?? 0;
            wait -= dt;
            if (wait <= 0) {
                const ready = mode === 'ready';
                const x = unit.world.x;
                const z = unit.world.z;
                const meshTop = getUnitVisualHeight(STRONGHOLD.id) * unit.visualMeshScale();
                const y = worldHeightAt(x, z) + unit.memberBaseY() + meshTop + 0.6;
                const jitter = 0.5;
                embers.burst(
                    x + (Math.random() - 0.5) * jitter,
                    y,
                    z + (Math.random() - 0.5) * jitter,
                    {
                        count: ready ? 8 : 4,
                        color: ready ? READY_COLOR : COOK_COLOR,
                        speed: ready ? 1.8 : 1.2,
                        life: ready ? 0.9 : 1.1,
                        up: ready ? 9 : 7,
                    },
                );
                wait = ready ? 0.32 + Math.random() * 0.2 : 0.55 + Math.random() * 0.35;
            }
            this.sparkWait.set(unit.id, wait);
        }

        for (const id of [...this.sparkWait.keys()]) {
            if (!seen.has(id)) this.sparkWait.delete(id);
        }

        embers.update(dt);
    }
}
