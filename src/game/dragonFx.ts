import { Group, MathUtils, type MeshStandardMaterial, type Scene } from 'three';
import { groundHeightAt } from './map';
import {
    cloneSpellInstance,
    disposeObject,
    loadSpellTemplate,
    setSpellOpacity,
} from './spellMeshes';

const DRAGON_URL = new URL('../../assets/models/spells/dragon.glb', import.meta.url).href;

/** approach + strafe so breath coincides with ignite */
export const DRAGON_APPROACH_SEC = 1.6;
const EXIT_SEC = 1.4;
const FLY_HEIGHT = 22;
const MESH_SCALE = 18;

export type DragonCue = {
    x: number;
    z: number;
    x2: number;
    z2: number;
    /** sim.elapsed when the corridor ignites */
    at: number;
};

type Active = {
    cue: DragonCue;
    root: Group;
    materials: MeshStandardMaterial[];
    phase: 'approach' | 'exit';
    len: number;
    ux: number;
    uz: number;
};

/**
 * Dragon Attack flyover: glide along the capsule path, exit after the breath.
 */
export class DragonFx {
    private readonly group = new Group();
    private template: Group | null = null;
    private readonly active: Active[] = [];
    private readonly loadPromise: Promise<void>;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.load();
    }

    schedule(cues: readonly DragonCue[]): void {
        this.clear();
        void this.loadPromise.then(() => {
            for (const cue of cues) this.spawn(cue);
        });
    }

    clear(): void {
        for (const a of this.active) {
            this.group.remove(a.root);
            disposeObject(a.root);
        }
        this.active.length = 0;
    }

    update(simElapsed: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const a = this.active[i]!;
            const start = a.cue.at - DRAGON_APPROACH_SEC;
            if (simElapsed < start) {
                a.root.visible = false;
                continue;
            }
            a.root.visible = true;

            if (a.phase === 'approach') {
                const u = MathUtils.clamp((simElapsed - start) / DRAGON_APPROACH_SEC, 0, 1);
                // ease in; arrive at end of path at ignite
                const e = u * u * (3 - 2 * u);
                const px = a.cue.x + (a.cue.x2 - a.cue.x) * e;
                const pz = a.cue.z + (a.cue.z2 - a.cue.z) * e;
                // start a bit before the stamp and slightly high
                const lead = (1 - e) * Math.max(a.len * 0.15, 8);
                const x = px - a.ux * lead;
                const z = pz - a.uz * lead;
                const gy = groundHeightAt(x, z);
                const dive = 1 - Math.abs(e - 0.65) * 0.35;
                a.root.position.set(x, gy + FLY_HEIGHT * dive, z);
                a.root.rotation.y = Math.atan2(a.ux, a.uz);
                a.root.rotation.x = -0.12 + (1 - dive) * 0.2;
                a.root.scale.setScalar(MESH_SCALE);
                if (u >= 1) a.phase = 'exit';
            } else {
                const exitT = MathUtils.clamp((simElapsed - a.cue.at) / EXIT_SEC, 0, 1);
                const e = exitT * exitT;
                const overshoot = a.len * 0.25 + e * Math.max(a.len * 0.5, 40);
                const x = a.cue.x2 + a.ux * overshoot;
                const z = a.cue.z2 + a.uz * overshoot;
                const gy = groundHeightAt(x, z);
                a.root.position.set(x, gy + FLY_HEIGHT + e * 36, z);
                a.root.rotation.y = Math.atan2(a.ux, a.uz);
                a.root.rotation.x = -0.35 * e;
                setSpellOpacity(a.materials, 1 - e);
                if (exitT >= 1) {
                    this.group.remove(a.root);
                    disposeObject(a.root);
                    this.active.splice(i, 1);
                }
            }
        }
    }

    dispose(): void {
        this.clear();
        this.group.removeFromParent();
        if (this.template) disposeObject(this.template);
        this.template = null;
    }

    private spawn(cue: DragonCue): void {
        if (!this.template) return;
        const dx = cue.x2 - cue.x;
        const dz = cue.z2 - cue.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const { root, materials } = cloneSpellInstance(this.template);
        root.visible = false;
        this.group.add(root);
        this.active.push({ cue, root, materials, phase: 'approach', len, ux, uz });
    }

    private async load(): Promise<void> {
        try {
            // nose-forward along +Z after normalize; yaw set at runtime
            this.template = await loadSpellTemplate(DRAGON_URL, {
                bakeEuler: { y: Math.PI },
            });
            console.info('[dragonFx] loaded dragon');
        } catch (e) {
            console.error('[dragonFx] failed to load dragon model', e);
        }
    }
}
