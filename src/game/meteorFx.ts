import { Group, MathUtils, type Mesh, type MeshStandardMaterial, type Scene } from 'three';
import { groundHeightAt } from './map';
import { prefs, type ShadowQuality } from './prefs';
import { ensureSpellTemplate } from './spellAssets';
import {
    cloneSpellInstance,
    disposeObject,
    setSpellOpacity,
} from './spellMeshes';
import { METEOR_SHARD_FALL_SEC } from './tactics';

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
const GREAT_HOLD = 0.35;
const GREAT_EXIT = 0.7;
const GREAT_DROP = 140;
const GREAT_SCALE = 22;

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
    phase: 'fall' | 'hold' | 'exit';
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
 * Great Meteor drop (scheduled) + Meteor Shower shards (from sim events).
 * Shards are pooled — cloning the ~3MB GLB every impact was a major hitch.
 */
export class MeteorFx {
    private readonly group = new Group();
    private greatTpl: Group | null = null;
    private shardTpl: Group | null = null;
    private readonly great: GreatActive[] = [];
    private readonly shards: ShardActive[] = [];
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

    update(simElapsed: number): void {
        this.updateGreat(simElapsed);
        this.updateShards(simElapsed);
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

    private updateGreat(t: number): void {
        for (let i = this.great.length - 1; i >= 0; i--) {
            const s = this.great[i]!;
            const fallStart = s.cue.at - GREAT_METEOR_FALL_SEC;
            if (t < fallStart) {
                s.root.visible = false;
                continue;
            }
            s.root.visible = true;
            if (s.phase === 'fall') {
                const u = MathUtils.clamp((t - fallStart) / GREAT_METEOR_FALL_SEC, 0, 1);
                const e = u * u * u;
                s.root.position.y = s.groundY + GREAT_DROP * (1 - e);
                s.root.rotation.x = 0.55 + u * 0.4;
                if (u >= 1) {
                    s.phase = 'hold';
                    s.root.position.y = s.groundY;
                }
            } else if (s.phase === 'hold') {
                const holdT = MathUtils.clamp((t - s.cue.at) / GREAT_HOLD, 0, 1);
                const squash = 1 - 0.18 * Math.sin(holdT * Math.PI);
                s.root.scale.set(GREAT_SCALE * (2 - squash), GREAT_SCALE * squash, GREAT_SCALE * (2 - squash));
                if (holdT >= 1) s.phase = 'exit';
            } else {
                const exitT = MathUtils.clamp((t - s.cue.at - GREAT_HOLD) / GREAT_EXIT, 0, 1);
                setSpellOpacity(s.materials, 1 - exitT);
                s.root.scale.setScalar(GREAT_SCALE * (1 - 0.4 * exitT));
                if (exitT >= 1) {
                    this.group.remove(s.root);
                    disposeObject(s.root);
                    this.great.splice(i, 1);
                }
            }
        }
    }

    private updateShards(t: number): void {
        for (let i = this.shards.length - 1; i >= 0; i--) {
            const s = this.shards[i]!;
            if (s.phase === 'fall') {
                const fallStart = s.at - METEOR_SHARD_FALL_SEC;
                const u = MathUtils.clamp((t - fallStart) / METEOR_SHARD_FALL_SEC, 0, 1);
                const e = u * u;
                s.root.position.x = s.startX + (s.x - s.startX) * e;
                s.root.position.z = s.startZ + (s.z - s.startZ) * e;
                s.root.position.y = s.groundY + SHARD_DROP * (1 - e);
                s.root.rotation.z += 0.06;
                if (u >= 1) {
                    s.phase = 'exit';
                    s.root.position.set(s.x, s.groundY, s.z);
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
