import { Group, MathUtils, type Mesh, type MeshStandardMaterial, type Scene } from 'three';
import { shieldAtPoint, type ShieldDisk } from './fire';
import { groundHeightAt } from './map';
import { prefs, type ShadowQuality } from './prefs';
import { ensureSpellTemplate } from './spellAssets';
import {
    cloneSpellInstance,
    disposeObject,
    setSpellOpacity,
} from './spellMeshes';
import { METEOR_SHARD_FALL_SEC } from './tactics';
import { SHIELD_HEIGHT } from './units';

/** Shards only cast on high/ultra — many concurrent casters are costly on the shadow map. */
function shardCastsShadow(tier: ShadowQuality = prefs().shadows): boolean {
    return tier === 'high' || tier === 'ultra';
}

function setRootCastShadow(root: Group, cast: boolean): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
            mesh.castShadow = cast;
            mesh.receiveShadow = cast;
        }
    });
}

/** fall time so impact lines up with the sim strike */
export const GREAT_METEOR_FALL_SEC = 1.1;
const GREAT_DROP = 140;
/**
 * The rock does not survive the landing: it is removed on the frame it lands
 * and replaced by fragments. (It used to squash on the ground for 0.35s and
 * then fade out over 0.7s, which read as the meteor deflating rather than
 * breaking.)
 */
const FRAG_COUNT = 9;
const FRAG_LIFE = 0.95;
/** last slice of the life spent fading out */
const FRAG_FADE = 0.35;
/** world units / s^2 — tuned for a readable arc, not real gravity */
const FRAG_GRAVITY = 260;
const FRAG_SPEED_MIN = 26;
const FRAG_SPEED_MAX = 54;
const FRAG_UP_MIN = 28;
const FRAG_UP_MAX = 62;
const FRAG_SCALE_MIN = 1.6;
const FRAG_SCALE_MAX = 3.4;
const FRAG_SPIN = 7;
const GREAT_SCALE = 19.8; // 10% smaller than the original 22 (visual only)

const SHARD_DROP = 90;
const SHARD_SCALE = 8;
/** snap-fade after impact — long shrink on the ground looks fake */
const SHARD_EXIT = 0.12;
/** approach angle from vertical — horizontal travel = DROP * tan(angle) */
const SHARD_TILT_RAD = MathUtils.degToRad(20);
const SHARD_HORIZ = SHARD_DROP * Math.tan(SHARD_TILT_RAD);
/** fixed approach bearing (from +X toward −Z-ish) — same for every shard */
const SHARD_BEARING = Math.PI * 0.25;

export type GreatMeteorCue = { x: number; z: number; at: number };

type GreatActive = {
    cue: GreatMeteorCue;
    root: Group;
    materials: MeshStandardMaterial[];
    groundY: number;
    phase: 'fall';
};

/** one piece of a shattered meteor — closed-form ballistic, visual only */
type FragActive = {
    root: Group;
    materials: MeshStandardMaterial[];
    bornAt: number;
    x: number;
    z: number;
    groundY: number;
    vx: number;
    vy: number;
    vz: number;
    scale: number;
    /** tumble is closed-form too: rot = rot0 + spin * age */
    rot0x: number;
    rot0y: number;
    rot0z: number;
    spinX: number;
    spinZ: number;
    /** true once it has settled on the ground (stops integrating) */
    landed: boolean;
};

type ShardActive = {
    x: number;
    z: number;
    /** start XZ (high) → land at (x,z) */
    startX: number;
    startZ: number;
    /** sim time when the shard hits */
    at: number;
    root: Group;
    materials: MeshStandardMaterial[];
    groundY: number;
    phase: 'fall' | 'exit';
};

/**
 * Meteor drop (scheduled) + Meteor Shower shards (from sim events).
 * Shards are pooled — cloning the ~3MB GLB every impact was a major hitch.
 */
export class MeteorFx {
    private readonly group = new Group();
    private greatTpl: Group | null = null;
    private shardTpl: Group | null = null;
    private readonly great: GreatActive[] = [];
    private readonly shards: ShardActive[] = [];
    private readonly frags: FragActive[] = [];
    private readonly shardPool: { root: Group; materials: MeshStandardMaterial[] }[] = [];
    private readonly loadPromise: Promise<void>;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.load();
    }

    scheduleGreat(cues: readonly GreatMeteorCue[]): void {
        this.clearGreat();
        void this.loadPromise.then(() => {
            for (const cue of cues) this.spawnGreat(cue);
        });
    }

    /** Live-apply shadow pref to active + pooled shards. */
    applyShadowPref(tier: ShadowQuality = prefs().shadows): void {
        const cast = shardCastsShadow(tier);
        for (const s of this.shards) setRootCastShadow(s.root, cast);
        for (const p of this.shardPool) setRootCastShadow(p.root, cast);
    }

    /** spawn a falling shard that impacts at (x,z) at sim time `at` */
    spawnShardImpact(x: number, z: number, at: number): void {
        void this.loadPromise.then(() => {
            if (!this.shardTpl) return;
            const inst = this.shardPool.pop() ?? cloneSpellInstance(this.shardTpl);
            setRootCastShadow(inst.root, shardCastsShadow());
            const { root, materials } = inst;
            setSpellOpacity(materials, 1);
            const groundY = groundHeightAt(x, z);
            const startX = x - Math.cos(SHARD_BEARING) * SHARD_HORIZ;
            const startZ = z - Math.sin(SHARD_BEARING) * SHARD_HORIZ;
            root.position.set(startX, groundY + SHARD_DROP, startZ);
            root.rotation.set(SHARD_TILT_RAD, SHARD_BEARING, 0.15);
            root.scale.setScalar(SHARD_SCALE);
            root.visible = true;
            this.group.add(root);
            this.shards.push({
                x,
                z,
                startX,
                startZ,
                at,
                root,
                materials,
                groundY,
                phase: 'fall',
            });
        });
    }

    clear(): void {
        this.clearGreat();
        this.clearShards();
    }

    update(simElapsed: number, shields: readonly ShieldDisk[] = []): void {
        this.updateGreat(simElapsed, shields);
        this.updateFrags(simElapsed);
        this.updateShards(simElapsed, shields);
    }

    dispose(): void {
        this.clear();
        for (const p of this.shardPool) disposeObject(p.root);
        this.shardPool.length = 0;
        this.group.removeFromParent();
        // shared boot templates — do not dispose
        this.greatTpl = this.shardTpl = null;
    }

    private clearGreat(): void {
        for (const s of this.great) {
            this.group.remove(s.root);
            disposeObject(s.root);
        }
        this.great.length = 0;
        for (const f of this.frags) {
            this.group.remove(f.root);
            this.shardPool.push({ root: f.root, materials: f.materials });
        }
        this.frags.length = 0;
    }

    private clearShards(): void {
        for (const s of this.shards) {
            this.group.remove(s.root);
            this.shardPool.push({ root: s.root, materials: s.materials });
        }
        this.shards.length = 0;
    }

    private spawnGreat(cue: GreatMeteorCue): void {
        if (!this.greatTpl) return;
        const { root, materials } = cloneSpellInstance(this.greatTpl);
        const groundY = groundHeightAt(cue.x, cue.z);
        root.position.set(cue.x, groundY + GREAT_DROP, cue.z);
        root.rotation.set(0.55, Math.random() * Math.PI * 2, 0.2);
        root.scale.setScalar(GREAT_SCALE);
        root.visible = false;
        this.group.add(root);
        this.great.push({ cue, root, materials, groundY, phase: 'fall' });
    }

    private updateGreat(t: number, shields: readonly ShieldDisk[]): void {
        for (let i = this.great.length - 1; i >= 0; i--) {
            const s = this.great[i]!;
            const fallStart = s.cue.at - GREAT_METEOR_FALL_SEC;
            if (t < fallStart) {
                s.root.visible = false;
                continue;
            }
            s.root.visible = true;
            const landY =
                shieldAtPoint(s.cue.x, s.cue.z, shields) !== null
                    ? s.groundY + SHIELD_HEIGHT
                    : s.groundY;
            const u = MathUtils.clamp((t - fallStart) / GREAT_METEOR_FALL_SEC, 0, 1);
            const e = u * u * u;
            s.root.position.y = landY + GREAT_DROP * (1 - e);
            s.root.rotation.x = 0.55 + u * 0.4;
            if (u >= 1) {
                // shatter: the rock is gone on this frame, the pieces carry
                // the moment (no ground squash, no fade-out)
                this.spawnFragments(s.cue.x, landY, s.cue.z, t);
                this.group.remove(s.root);
                disposeObject(s.root);
                this.great.splice(i, 1);
            }
        }
    }

    /**
     * Burst the impact point into rock pieces. Reuses the pooled Meteor Shower
     * shard mesh (already a chunk of rock) so no new asset is loaded, and runs
     * closed-form off sim time — `update` only gets an absolute clock, and
     * these are cosmetic, so there is no dt to integrate.
     */
    private spawnFragments(x: number, groundY: number, z: number, now: number): void {
        if (!this.shardTpl) return;
        for (let n = 0; n < FRAG_COUNT; n++) {
            const inst = this.shardPool.pop() ?? cloneSpellInstance(this.shardTpl);
            const { root, materials } = inst;
            setRootCastShadow(root, shardCastsShadow());
            setSpellOpacity(materials, 1);
            const scale = MathUtils.lerp(FRAG_SCALE_MIN, FRAG_SCALE_MAX, Math.random());
            const bearing = (n / FRAG_COUNT) * Math.PI * 2 + Math.random() * 0.6;
            const speed = MathUtils.lerp(FRAG_SPEED_MIN, FRAG_SPEED_MAX, Math.random());
            const rot0x = Math.random() * Math.PI;
            const rot0y = Math.random() * Math.PI;
            const rot0z = Math.random() * Math.PI;
            root.scale.setScalar(scale);
            root.position.set(x, groundY + 1.5, z);
            root.rotation.set(rot0x, rot0y, rot0z);
            root.visible = true;
            this.group.add(root);
            this.frags.push({
                root,
                materials,
                bornAt: now,
                x,
                z,
                groundY,
                vx: Math.cos(bearing) * speed,
                vz: Math.sin(bearing) * speed,
                vy: MathUtils.lerp(FRAG_UP_MIN, FRAG_UP_MAX, Math.random()),
                scale,
                rot0x,
                rot0y,
                rot0z,
                spinX: (Math.random() * 2 - 1) * FRAG_SPIN,
                spinZ: (Math.random() * 2 - 1) * FRAG_SPIN,
                landed: false,
            });
        }
    }

    private updateFrags(t: number): void {
        for (let i = this.frags.length - 1; i >= 0; i--) {
            const f = this.frags[i]!;
            const age = t - f.bornAt;
            // scrubbing backwards (replay/seek) must not strand pieces
            if (age < 0 || age >= FRAG_LIFE) {
                this.group.remove(f.root);
                this.shardPool.push({ root: f.root, materials: f.materials });
                this.frags.splice(i, 1);
                continue;
            }
            if (!f.landed) {
                const y = f.groundY + 1.5 + f.vy * age - 0.5 * FRAG_GRAVITY * age * age;
                if (y <= f.groundY + 0.4 * f.scale) {
                    // settle where it fell and stop tumbling
                    f.landed = true;
                    f.root.position.y = f.groundY + 0.4 * f.scale;
                } else {
                    f.root.position.set(f.x + f.vx * age, y, f.z + f.vz * age);
                    f.root.rotation.set(
                        f.rot0x + f.spinX * age,
                        f.rot0y,
                        f.rot0z + f.spinZ * age,
                    );
                }
            }
            const fadeT = (age - (FRAG_LIFE - FRAG_FADE)) / FRAG_FADE;
            setSpellOpacity(f.materials, fadeT <= 0 ? 1 : 1 - fadeT);
        }
    }

    private updateShards(t: number, shields: readonly ShieldDisk[]): void {
        for (let i = this.shards.length - 1; i >= 0; i--) {
            const s = this.shards[i]!;
            if (s.phase === 'fall') {
                const fallStart = s.at - METEOR_SHARD_FALL_SEC;
                const u = MathUtils.clamp((t - fallStart) / METEOR_SHARD_FALL_SEC, 0, 1);
                const e = u * u;
                const cx = s.startX + (s.x - s.startX) * e;
                const cz = s.startZ + (s.z - s.startZ) * e;
                let cy = s.groundY + SHARD_DROP * (1 - e);
                if (shieldAtPoint(cx, cz, shields)) {
                    cy = Math.max(cy, s.groundY + SHIELD_HEIGHT);
                }
                s.root.position.x = cx;
                s.root.position.z = cz;
                s.root.position.y = cy;
                s.root.rotation.z += 0.06;
                if (u >= 1) {
                    s.phase = 'exit';
                    const landY =
                        shieldAtPoint(s.x, s.z, shields) !== null
                            ? s.groundY + SHIELD_HEIGHT
                            : s.groundY;
                    s.root.position.set(s.x, landY, s.z);
                }
            } else {
                const exitT = MathUtils.clamp((t - s.at) / SHARD_EXIT, 0, 1);
                // fade only — keep full size until gone
                setSpellOpacity(s.materials, 1 - exitT);
                if (exitT >= 1) {
                    this.group.remove(s.root);
                    this.shardPool.push({ root: s.root, materials: s.materials });
                    this.shards.splice(i, 1);
                }
            }
        }
    }

    private async load(): Promise<void> {
        const [great, shard] = await Promise.all([
            ensureSpellTemplate('meteor-great'),
            ensureSpellTemplate('meteor-shard'),
        ]);
        this.greatTpl = great;
        this.shardTpl = shard;
        if (!shard) return;
        // warm a few pooled shards so the first impacts don't hitch
        const cast = shardCastsShadow();
        for (let i = 0; i < 4; i++) {
            const inst = cloneSpellInstance(shard);
            setRootCastShadow(inst.root, cast);
            this.shardPool.push(inst);
        }
        console.info('[meteorFx] templates ready');
    }
}
