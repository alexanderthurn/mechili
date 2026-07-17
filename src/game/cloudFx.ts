import {
    BufferGeometry,
    Group,
    Line,
    LineBasicMaterial,
    MathUtils,
    Vector3,
    type MeshStandardMaterial,
    type Scene,
} from 'three';
import { groundHeightAt } from './map';
import {
    cloneSpellInstance,
    disposeObject,
    loadSpellTemplate,
    setSpellOpacity,
} from './spellMeshes';

const STORM_URL = new URL('../../assets/models/spells/storm-cloud.glb', import.meta.url).href;
const POISON_URL = new URL('../../assets/models/spells/poison-cloud.glb', import.meta.url).href;

const CLOUD_HEIGHT = 18;
const STORM_SCALE = 28;
const POISON_SCALE = 22;
const FADE_IN = 0.8;
const FADE_OUT = 1.2;

export type CloudCue = {
    kind: 'storm' | 'poison';
    x: number;
    z: number;
    radius: number;
    /** sim.elapsed when the zone starts ticking */
    startAt: number;
    /** sim.elapsed when the zone ends */
    endAt: number;
};

type ActiveCloud = {
    cue: CloudCue;
    root: Group;
    materials: MeshStandardMaterial[];
    baseY: number;
};

type Bolt = {
    line: Line;
    mat: LineBasicMaterial;
    until: number;
};

/**
 * Hovering storm/poison cloud meshes over active zones, plus brief lightning bolts.
 */
export class CloudFx {
    private readonly group = new Group();
    private stormTpl: Group | null = null;
    private poisonTpl: Group | null = null;
    private readonly clouds: ActiveCloud[] = [];
    private readonly bolts: Bolt[] = [];
    private readonly loadPromise: Promise<void>;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.load();
    }

    schedule(cues: readonly CloudCue[]): void {
        this.clear();
        void this.loadPromise.then(() => {
            for (const cue of cues) this.spawn(cue);
        });
    }

    /** flash a bolt from above the strike point down to the target */
    spawnLightning(x: number, z: number, now: number): void {
        const gy = groundHeightAt(x, z);
        const top = gy + CLOUD_HEIGHT + 6;
        const midX = x + (Math.random() - 0.5) * 4;
        const midZ = z + (Math.random() - 0.5) * 4;
        const pts = [
            new Vector3(x + (Math.random() - 0.5) * 3, top, z + (Math.random() - 0.5) * 3),
            new Vector3(midX, gy + CLOUD_HEIGHT * 0.45, midZ),
            new Vector3(x, gy + 0.5, z),
        ];
        const mat = new LineBasicMaterial({
            color: 0xc8d8ff,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
        });
        const line = new Line(new BufferGeometry().setFromPoints(pts), mat);
        this.group.add(line);
        this.bolts.push({ line, mat, until: now + 0.18 });
    }

    clear(): void {
        for (const c of this.clouds) {
            this.group.remove(c.root);
            disposeObject(c.root);
        }
        this.clouds.length = 0;
        for (const b of this.bolts) {
            this.group.remove(b.line);
            b.line.geometry.dispose();
            b.mat.dispose();
        }
        this.bolts.length = 0;
    }

    update(simElapsed: number): void {
        for (let i = this.clouds.length - 1; i >= 0; i--) {
            const c = this.clouds[i]!;
            const { cue } = c;
            if (simElapsed < cue.startAt - FADE_IN) {
                c.root.visible = false;
                continue;
            }
            if (simElapsed > cue.endAt + FADE_OUT) {
                this.group.remove(c.root);
                disposeObject(c.root);
                this.clouds.splice(i, 1);
                continue;
            }
            c.root.visible = true;
            let opacity = 1;
            if (simElapsed < cue.startAt) {
                opacity = MathUtils.clamp((simElapsed - (cue.startAt - FADE_IN)) / FADE_IN, 0, 1);
            } else if (simElapsed > cue.endAt) {
                opacity = 1 - MathUtils.clamp((simElapsed - cue.endAt) / FADE_OUT, 0, 1);
            }
            setSpellOpacity(c.materials, opacity * 0.92);
            const bob = Math.sin(simElapsed * 1.4 + cue.x * 0.1) * 1.2;
            const spin = simElapsed * (cue.kind === 'storm' ? 0.15 : 0.08);
            c.root.position.y = c.baseY + bob;
            c.root.rotation.y = spin;
            const breathe = 1 + 0.04 * Math.sin(simElapsed * 2.1);
            const scale =
                (cue.kind === 'storm' ? STORM_SCALE : POISON_SCALE) *
                (cue.radius / 28) *
                breathe;
            c.root.scale.setScalar(Math.max(scale, cue.kind === 'storm' ? 18 : 14));
        }

        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i]!;
            const left = b.until - simElapsed;
            if (left <= 0) {
                this.group.remove(b.line);
                b.line.geometry.dispose();
                b.mat.dispose();
                this.bolts.splice(i, 1);
                continue;
            }
            b.mat.opacity = MathUtils.clamp(left / 0.18, 0, 1);
        }
    }

    dispose(): void {
        this.clear();
        this.group.removeFromParent();
        if (this.stormTpl) disposeObject(this.stormTpl);
        if (this.poisonTpl) disposeObject(this.poisonTpl);
        this.stormTpl = this.poisonTpl = null;
    }

    private spawn(cue: CloudCue): void {
        const tpl = cue.kind === 'storm' ? this.stormTpl : this.poisonTpl;
        if (!tpl) return;
        const { root, materials } = cloneSpellInstance(tpl);
        if (cue.kind === 'poison') {
            for (const m of materials) {
                m.color.setHex(0x6ec84a);
                m.emissive?.setHex(0x1a3a10);
                m.transparent = true;
                m.opacity = 0.85;
            }
        }
        const gy = groundHeightAt(cue.x, cue.z);
        const baseY = gy + CLOUD_HEIGHT;
        root.position.set(cue.x, baseY, cue.z);
        root.scale.setScalar(cue.kind === 'storm' ? STORM_SCALE : POISON_SCALE);
        root.visible = false;
        this.group.add(root);
        this.clouds.push({ cue, root, materials, baseY });
    }

    private async load(): Promise<void> {
        try {
            const [storm, poison] = await Promise.all([
                loadSpellTemplate(STORM_URL),
                loadSpellTemplate(POISON_URL),
            ]);
            this.stormTpl = storm;
            this.poisonTpl = poison;
            console.info('[cloudFx] loaded storm + poison clouds');
        } catch (e) {
            console.error('[cloudFx] failed to load cloud models', e);
        }
    }
}
