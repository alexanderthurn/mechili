import {
    Box3,
    Group,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    Vector3,
    type Object3D,
    type Scene,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { groundHeightAt } from './map';
import { HAMMER_ZONE } from './tactics';

const HAMMER_URL = new URL('../../assets/models/spells/hammer-of-gods.glb', import.meta.url).href;

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

    update(simElapsed: number): void {
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

            if (s.phase === 'fall') {
                const u = MathUtils.clamp((simElapsed - fallStart) / HAMMER_SWING_SEC, 0, 1);
                const e = u * u * u;
                s.root.position.y = s.groundY + LAND_LIFT + (DROP_HEIGHT - LAND_LIFT) * (1 - e);
                s.root.scale.setScalar(MESH_SCALE);
                if (u >= 1) {
                    s.phase = 'hold';
                    s.root.position.y = s.groundY + LAND_LIFT;
                }
            } else if (s.phase === 'hold') {
                const holdT = MathUtils.clamp((simElapsed - s.cue.at) / HOLD_SEC, 0, 1);
                const squash = 1 - 0.12 * Math.sin(holdT * Math.PI);
                s.root.scale.set(MESH_SCALE * (2 - squash), MESH_SCALE * squash, MESH_SCALE * (2 - squash));
                // squash toward the ground contact — don't let Y-scale pull the head underground
                s.root.position.y = s.groundY + LAND_LIFT * squash;
                if (holdT >= 1) s.phase = 'exit';
            } else {
                const exitT = MathUtils.clamp((simElapsed - s.cue.at - HOLD_SEC) / EXIT_SEC, 0, 1);
                const lift = exitT * exitT;
                s.root.position.y = s.groundY + LAND_LIFT + lift * 28;
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
        if (this.template) disposeObject(this.template);
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
        try {
            const gltf = await new GLTFLoader().loadAsync(HAMMER_URL);
            this.template = prepareHammerTemplate(gltf.scene);
            console.info(`[hammerFx] loaded ${HAMMER_URL}`);
        } catch (e) {
            console.error('[hammerFx] failed to load hammer model', e);
        }
    }
}

/**
 * Upside-down (+Y face into ground), centered on XZ, face on y=0.
 * Flip is baked into geometry so runtime only sets rotation.y = yaw.
 */
function prepareHammerTemplate(scene: Object3D): Group {
    const stage = new Group();
    const model = skeletonClone(scene);
    model.rotation.x = Math.PI;
    stage.add(model);
    stage.updateMatrixWorld(true);

    const holder = new Group();
    model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        const baked = new Mesh(geo, mesh.material);
        baked.castShadow = true;
        baked.receiveShadow = true;
        holder.add(baked);
    });

    let box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z, 1e-3);
    holder.scale.setScalar(1 / longest);

    box = new Box3().setFromObject(holder);
    const center = box.getCenter(new Vector3());
    holder.position.x -= center.x;
    holder.position.z -= center.z;
    holder.position.y -= box.min.y;
    return holder;
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
