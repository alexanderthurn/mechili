import {
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
    type Scene,
} from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { shieldAtPoint, type ShieldDisk } from './fire';
import { ensureSpellTemplate } from './spellAssets';
import { groundHeightAt } from './map';
import { HAMMER_ZONE } from './tactics';
import { SHIELD_HEIGHT } from './units';

/** @deprecated import from tactics — re-exported for existing tweak notes */
export { HAMMER_ZONE };

/** drop duration before the sim strike — also drives the charge-rect fill */
export const HAMMER_SWING_SEC = 0.85;
const HOLD_SEC = 0.45;
const EXIT_SEC = 0.9;
/** start height above ground */
const DROP_HEIGHT = 128;
/** visual size of the mesh (independent of the zone rect — tune separately) */
const MESH_SCALE = 96;
/** rest height above terrain — keeps the head from burying (local y=0 is bbox bottom) */
const LAND_LIFT = MESH_SCALE * 0.42;

type Phase = 'fall' | 'hold' | 'exit';

interface HammerCue {
    x: number;
    z: number;
    /** sim.elapsed when the strike resolves (impact) */
    at: number;
    yaw: number;
}

interface ActiveStamp {
    cue: HammerCue;
    root: Group;
    materials: MeshStandardMaterial[];
    phase: Phase;
    groundY: number;
}

/**
 * Visual-only Hammer of the Gods: upside-down drop centered on the stamp.
 * Yaw matches the placed footprint (point-yaw).
 */
export class HammerFx {
    private readonly group = new Group();
    private template: Group | null = null;
    private readonly active: ActiveStamp[] = [];
    private readonly loadPromise: Promise<void>;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.loadTemplate();
    }

    schedule(cues: readonly HammerCue[]): void {
        this.clear();
        void this.loadPromise.then(() => {
            for (const cue of cues) this.spawn(cue);
        });
    }

    clear(): void {
        for (const s of this.active) {
            this.group.remove(s.root);
            disposeObject(s.root);
        }
        this.active.length = 0;
    }

    update(simElapsed: number, shields: readonly ShieldDisk[] = []): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const s = this.active[i]!;
            const fallStart = s.cue.at - HAMMER_SWING_SEC;
            if (simElapsed < fallStart) {
                s.root.visible = false;
                continue;
            }
            s.root.visible = true;
            // keep yaw locked every frame (matches the footprint orientation)
            s.root.rotation.y = -s.cue.yaw;
            const onShield = shieldAtPoint(s.cue.x, s.cue.z, shields) !== null;
            const baseY = onShield ? s.groundY + SHIELD_HEIGHT : s.groundY;
            const landY = baseY + LAND_LIFT;

            if (s.phase === 'fall') {
                const u = MathUtils.clamp((simElapsed - fallStart) / HAMMER_SWING_SEC, 0, 1);
                const e = u * u * u;
                s.root.position.y = landY + (DROP_HEIGHT - LAND_LIFT) * (1 - e);
                s.root.scale.setScalar(MESH_SCALE);
                if (u >= 1) {
                    s.phase = 'hold';
                    s.root.position.y = landY;
                }
            } else if (s.phase === 'hold') {
                const holdT = MathUtils.clamp((simElapsed - s.cue.at) / HOLD_SEC, 0, 1);
                const squash = 1 - 0.12 * Math.sin(holdT * Math.PI);
                s.root.scale.set(MESH_SCALE * (2 - squash), MESH_SCALE * squash, MESH_SCALE * (2 - squash));
                // squash toward the ground contact — don't let Y-scale pull the head underground
                s.root.position.y = baseY + LAND_LIFT * squash;
                if (holdT >= 1) s.phase = 'exit';
            } else {
                const exitT = MathUtils.clamp((simElapsed - s.cue.at - HOLD_SEC) / EXIT_SEC, 0, 1);
                const lift = exitT * exitT;
                s.root.position.y = landY + lift * 28;
                s.root.scale.setScalar(MESH_SCALE * (1 - 0.35 * exitT));
                const opacity = 1 - exitT;
                for (const m of s.materials) {
                    m.opacity = opacity;
                    m.transparent = true;
                    m.depthWrite = opacity > 0.2;
                }
                if (exitT >= 1) {
                    this.group.remove(s.root);
                    disposeObject(s.root);
                    this.active.splice(i, 1);
                }
            }
        }
    }

    dispose(): void {
        this.clear();
        this.group.removeFromParent();
        // shared boot template — do not dispose
        this.template = null;
    }

    private spawn(cue: HammerCue): void {
        if (!this.template) return;
        const root = skeletonClone(this.template) as Group;
        const materials: MeshStandardMaterial[] = [];
        root.traverse((o) => {
            const mesh = o as Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const cloned = mats.map((m) => {
                const c = (m as MeshStandardMaterial).clone();
                if (typeof c.metalness === 'number') c.metalness = Math.min(c.metalness, 0.65);
                c.envMapIntensity = 1.15;
                materials.push(c);
                return c;
            });
            mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        });

        const groundY = groundHeightAt(cue.x, cue.z);
        root.position.set(cue.x, groundY + DROP_HEIGHT, cue.z);
        // drapeRect uses +yaw as XZ vertex rotate; Three.js object Ry is the
        // opposite sense for the same footprint — negate so mesh matches zone
        root.rotation.set(0, -cue.yaw, 0);
        root.scale.setScalar(MESH_SCALE);
        root.visible = false;
        this.group.add(root);
        this.active.push({ cue, root, materials, phase: 'fall', groundY });
        console.info(`[hammerFx] spawn at yaw=${((cue.yaw * 180) / Math.PI).toFixed(1)}°`);
    }

    private async loadTemplate(): Promise<void> {
        this.template = await ensureSpellTemplate('hammer');
        if (this.template) console.info('[hammerFx] template ready');
    }
}

function disposeObject(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
    });
}
