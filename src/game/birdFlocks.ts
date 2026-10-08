import { InstancedMesh, Matrix4, Quaternion, Vector3, type Scene } from 'three';
import {
    attachInstancedWingFlap,
    preserveCrowWingFlap,
    setCrowWingPhase,
    setCrowWingRate,
    setupCrowWingInstanceAttributes,
} from './crowWingFlap';
import { getUnitInstanceAsset, wingFlapOf } from './unitModels';

/**
 * Birds startled out of the forest by a battle's first noise (the first shot or
 * swing): a few flocks rise from the trees nearest to it and fly off away from
 * the fighting, climbing, then are gone. Drawn with the bat model and its wing
 * flap. Tweak live:
 * - flocks: how many; perFlock: birds in each (min..max)
 * - reach: wu from the noise a flock may start (the nearest trees first)
 * - spacing: wu kept between two flocks' trees
 * - scale: the bat model × this
 * - speed: wu/s; climb: wu/s up at take-off (eases off); seconds: how long they fly
 * - stagger: seconds over which a flock's birds take off one after another
 */
export const BIRDS = {
    flocks: 3,
    perFlock: [5, 9],
    reach: 160,
    spacing: 30,
    scale: 0.55,
    speed: 13,
    climb: 7,
    seconds: 9,
    stagger: 0.7,
} as const;

const MODEL = 'bat';
const CAPACITY = 40;

interface Bird {
    /** seconds since the noise; it takes off at `delay` */
    t: number;
    delay: number;
    pos: Vector3;
    heading: Vector3;
    /** this bird's own drift around the flock heading (radians) */
    wobble: number;
    phase: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _v = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, 0, -1);

export class BirdFlocks {
    private parts: InstancedMesh[] | null = null;
    private readonly birds: Bird[] = [];

    constructor(private readonly scene: Scene) {}

    /** the bat pools, built on first use (null: the model isn't loaded) */
    private pools(): InstancedMesh[] | null {
        if (this.parts) return this.parts;
        const asset = getUnitInstanceAsset(MODEL);
        const wing = wingFlapOf(MODEL);
        if (!asset || !wing) return null;
        this.parts = asset.parts.map((part) => {
            const mat = part.material.clone();
            preserveCrowWingFlap(part.material, mat);
            attachInstancedWingFlap(wing, mat, part.geometry);
            const mesh = new InstancedMesh(part.geometry.clone(), mat, CAPACITY);
            setupCrowWingInstanceAttributes(mesh, CAPACITY);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.count = 0;
            this.scene.add(mesh);
            return mesh;
        });
        return this.parts;
    }

    /**
     * Startle flocks from the perches (treetops) nearest to a noise at (x, z):
     * each flies off away from it.
     */
    startle(x: number, z: number, perches: readonly { x: number; y: number; z: number }[]): void {
        if (!this.pools() || perches.length === 0) return;
        const B = BIRDS;
        const near = perches
            .map((p) => ({ p, d: Math.hypot(p.x - x, p.z - z) }))
            .filter((e) => e.d <= B.reach)
            .sort((a, b) => a.d - b.d);
        const chosen: { x: number; y: number; z: number }[] = [];
        for (const { p } of near) {
            if (chosen.length >= B.flocks) break;
            if (chosen.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < B.spacing)) continue;
            chosen.push(p);
        }
        for (const perch of chosen) {
            const away = new Vector3(perch.x - x, 0, perch.z - z);
            if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
            away.normalize().applyAxisAngle(_up, (Math.random() - 0.5) * 0.8);
            const n = B.perFlock[0] + Math.floor(Math.random() * (B.perFlock[1] - B.perFlock[0] + 1));
            for (let i = 0; i < n && this.birds.length < CAPACITY; i++) {
                this.birds.push({
                    t: 0,
                    delay: Math.random() * B.stagger,
                    pos: new Vector3(perch.x + (Math.random() - 0.5) * 6, perch.y + Math.random() * 2, perch.z + (Math.random() - 0.5) * 6),
                    heading: away.clone(),
                    wobble: (Math.random() - 0.5) * 0.5,
                    phase: Math.random() * Math.PI * 2,
                });
            }
        }
    }

    update(dtSeconds: number): void {
        const parts = this.parts;
        if (!parts) return;
        const B = BIRDS;
        let n = 0;
        for (let i = this.birds.length - 1; i >= 0; i--) {
            const b = this.birds[i]!;
            b.t += dtSeconds;
            if (b.t - b.delay > B.seconds) this.birds.splice(i, 1);
        }
        for (const b of this.birds) {
            const t = b.t - b.delay;
            if (t < 0) continue;
            // up hard off the branch, then away: speed builds, the climb eases off
            const go = Math.min(1, t / 1.2);
            const yaw = b.wobble + Math.sin(t * 1.3 + b.phase) * 0.25;
            _v.copy(b.heading).applyAxisAngle(_up, yaw).multiplyScalar(B.speed * go);
            _v.y = B.climb * Math.exp(-t * 0.35) + Math.sin(t * 2.1 + b.phase) * 0.6;
            b.pos.addScaledVector(_v, dtSeconds);
            // the model faces −Z: turn it along its flight, nose a little up while climbing
            _q.setFromUnitVectors(_fwd, _s.copy(_v).normalize());
            // shrink away at the very end instead of popping out
            const k = B.scale * Math.min(1, (B.seconds - t) / 0.8, t / 0.15);
            _m.compose(b.pos, _q, _s.set(k, k, k));
            for (const mesh of parts) {
                mesh.setMatrixAt(n, _m);
                setCrowWingPhase(mesh, n, b.phase);
                // fast beats at take-off, steadier once up
                setCrowWingRate(mesh, n, t < 1.5 ? 1 : 0.7);
            }
            n++;
        }
        for (const mesh of parts) {
            mesh.count = n;
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /** gone at once (a new round, a reload) */
    clear(): void {
        this.birds.length = 0;
        if (this.parts) for (const mesh of this.parts) mesh.count = 0;
    }

    dispose(): void {
        this.clear();
        for (const mesh of this.parts ?? []) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as { dispose(): void }).dispose();
        }
        this.parts = null;
    }
}
