import {
    AdditiveBlending,
    BufferGeometry,
    CylinderGeometry,
    DoubleSide,
    Group,
    Line,
    LineBasicMaterial,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Vector3,
    type MeshStandardMaterial,
    type Scene,
} from 'three';
import { groundHeightAt } from './map';
import { ensureSpellTemplate } from './spellAssets';
import {
    cloneSpellInstance,
    disposeObject,
    setSpellOpacity,
} from './spellMeshes';

const CLOUD_HEIGHT = 18;
/** storm flash-cloud altitude */
const STORM_CLOUD_HEIGHT = 32;
const STORM_SCALE = 28;
const POISON_SCALE = 22;
const FADE_IN = 0.8;
const FADE_OUT = 1.2;
/** flash storm cloud: gather before bolt, linger after */
const FLASH_CLOUD_FADE_IN = 0.28;
const FLASH_CLOUD_HOLD = 0.55;
const FLASH_CLOUD_FADE_OUT = 1.1;
/** bolt fires after the cloud has mostly faded in */
const BOLT_AFTER_CLOUD = 0.32;
const BOLT_LIFE = 0.32;
/** cylinder radius for the main flash column */
const BOLT_RADIUS = 0.42;
const BOLT_GLOW_RADIUS = 0.78;
const FLASH_CLOUD_SCALE = 7.2;
const FLASH_CLOUD_OPACITY = 0.42;

export type CloudCue = {
    kind: 'storm' | 'poison';
    x: number;
    z: number;
    radius: number;
    /** sim.elapsed when the zone starts ticking */
    startAt: number;
    /** sim.elapsed when the zone ends */
    endAt: number;
    /**
     * Absolute mesh scale. When set, skips the radius-based storm/poison sizing
     * (used for many small acid-rain / storm puffs over a huge zone).
     */
    meshScale?: number;
    /** world height above ground for the cloud root (defaults by kind) */
    cloudHeight?: number;
    /** peak opacity (storm flash clouds stay translucent) */
    maxOpacity?: number;
    /** override fade-in seconds */
    fadeIn?: number;
    /** override fade-out seconds */
    fadeOut?: number;
};

type ActiveCloud = {
    cue: CloudCue;
    root: Group;
    materials: MeshStandardMaterial[];
    baseY: number;
};

type Bolt = {
    root: Group;
    mats: Array<MeshBasicMaterial | LineBasicMaterial>;
    until: number;
    baseOpacity: number[];
};

type PendingBolt = {
    at: number;
    cloudX: number;
    cloudY: number;
    cloudZ: number;
    hitX: number;
    hitY: number;
    hitZ: number;
};

/**
 * Hovering poison clouds over acid-rain zones, plus storm flash clouds + lightning
 * that appear per bolt (not persistent storm cover).
 */
export class CloudFx {
    private readonly group = new Group();
    private stormTpl: Group | null = null;
    private poisonTpl: Group | null = null;
    private readonly clouds: ActiveCloud[] = [];
    private readonly bolts: Bolt[] = [];
    private readonly pendingBolts: PendingBolt[] = [];
    private readonly loadPromise: Promise<void>;
    private readonly cylGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);

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

    /**
     * Spawn a translucent storm cloud above the strike, then fire a bolt from
     * that cloud down to the hit after a short gather delay.
     */
    spawnLightning(x: number, z: number, now: number, hitY?: number): void {
        void this.loadPromise.then(() => {
            const gy = groundHeightAt(x, z);
            const tipY = hitY ?? gy + 0.6;
            // cloud sits slightly offset so bolts don't all drop from the same point
            const cloudX = x + (Math.random() - 0.5) * 5;
            const cloudZ = z + (Math.random() - 0.5) * 5;
            const cloudHeight = STORM_CLOUD_HEIGHT + (Math.random() - 0.5) * 4;
            const cloudY = gy + cloudHeight;

            this.spawn({
                kind: 'storm',
                x: cloudX,
                z: cloudZ,
                radius: 28,
                startAt: now + FLASH_CLOUD_FADE_IN,
                endAt: now + FLASH_CLOUD_FADE_IN + FLASH_CLOUD_HOLD,
                meshScale: FLASH_CLOUD_SCALE + Math.random() * 1.8,
                cloudHeight,
                maxOpacity: FLASH_CLOUD_OPACITY,
                fadeIn: FLASH_CLOUD_FADE_IN,
                fadeOut: FLASH_CLOUD_FADE_OUT,
            });

            this.pendingBolts.push({
                at: now + BOLT_AFTER_CLOUD,
                cloudX,
                cloudY: cloudY - 1.5,
                cloudZ,
                hitX: x,
                hitY: tipY,
                hitZ: z,
            });
        });
    }

    clear(): void {
        for (const c of this.clouds) {
            this.group.remove(c.root);
            disposeObject(c.root);
        }
        this.clouds.length = 0;
        for (const b of this.bolts) this.disposeBolt(b);
        this.bolts.length = 0;
        this.pendingBolts.length = 0;
    }

    update(simElapsed: number): void {
        for (let i = this.pendingBolts.length - 1; i >= 0; i--) {
            const p = this.pendingBolts[i]!;
            if (simElapsed < p.at) continue;
            this.pendingBolts.splice(i, 1);
            this.fireBolt(p, simElapsed);
        }

        for (let i = this.clouds.length - 1; i >= 0; i--) {
            const c = this.clouds[i]!;
            const { cue } = c;
            const fadeIn = cue.fadeIn ?? FADE_IN;
            const fadeOut = cue.fadeOut ?? FADE_OUT;
            const maxOp = cue.maxOpacity ?? 0.92;
            if (simElapsed < cue.startAt - fadeIn) {
                c.root.visible = false;
                continue;
            }
            if (simElapsed > cue.endAt + fadeOut) {
                this.group.remove(c.root);
                disposeObject(c.root);
                this.clouds.splice(i, 1);
                continue;
            }
            c.root.visible = true;
            let opacity = 1;
            if (simElapsed < cue.startAt) {
                opacity = MathUtils.clamp((simElapsed - (cue.startAt - fadeIn)) / fadeIn, 0, 1);
            } else if (simElapsed > cue.endAt) {
                opacity = 1 - MathUtils.clamp((simElapsed - cue.endAt) / fadeOut, 0, 1);
            }
            setSpellOpacity(c.materials, opacity * maxOp);
            const bob = Math.sin(simElapsed * 1.4 + cue.x * 0.1) * 1.2;
            const spin = simElapsed * (cue.kind === 'storm' ? 0.15 : 0.08);
            c.root.position.y = c.baseY + bob;
            c.root.rotation.y = spin;
            const breathe = 1 + 0.04 * Math.sin(simElapsed * 2.1);
            if (cue.meshScale != null) {
                c.root.scale.setScalar(cue.meshScale * breathe);
            } else {
                const scale =
                    (cue.kind === 'storm' ? STORM_SCALE : POISON_SCALE) *
                    (cue.radius / 28) *
                    breathe;
                c.root.scale.setScalar(Math.max(scale, cue.kind === 'storm' ? 18 : 14));
            }
        }

        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i]!;
            const left = b.until - simElapsed;
            if (left <= 0) {
                this.disposeBolt(b);
                this.bolts.splice(i, 1);
                continue;
            }
            const fade = MathUtils.clamp(left / BOLT_LIFE, 0, 1);
            for (let mi = 0; mi < b.mats.length; mi++) {
                b.mats[mi]!.opacity = fade * (b.baseOpacity[mi] ?? 1);
            }
        }
    }

    dispose(): void {
        this.clear();
        this.cylGeo.dispose();
        this.group.removeFromParent();
        // shared boot templates — do not dispose
        this.stormTpl = this.poisonTpl = null;
    }

    private fireBolt(p: PendingBolt, now: number): void {
        const pts: Vector3[] = [];
        const segs = 6;
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const jx = (Math.random() - 0.5) * (i === 0 || i === segs ? 1.2 : 7);
            const jz = (Math.random() - 0.5) * (i === 0 || i === segs ? 1.2 : 7);
            pts.push(
                new Vector3(
                    p.cloudX + (p.hitX - p.cloudX) * t + jx,
                    p.cloudY + (p.hitY - p.cloudY) * t,
                    p.cloudZ + (p.hitZ - p.cloudZ) * t + jz,
                ),
            );
        }
        // first point locked to cloud underside so the flash clearly exits it
        pts[0]!.set(p.cloudX, p.cloudY, p.cloudZ);
        pts[pts.length - 1]!.set(p.hitX, p.hitY, p.hitZ);

        const root = new Group();
        const mats: Array<MeshBasicMaterial | LineBasicMaterial> = [];
        const baseOpacity: number[] = [];

        this.addThickPath(root, mats, baseOpacity, pts, BOLT_GLOW_RADIUS, 0x6688ee, 0.45);
        this.addThickPath(root, mats, baseOpacity, pts, BOLT_RADIUS, 0xddeeff, 0.95);
        for (let s = 0; s < 2; s++) {
            const ox = (Math.random() - 0.5) * 3.5;
            const oz = (Math.random() - 0.5) * 3.5;
            const sister = pts.map(
                (pt) =>
                    new Vector3(
                        pt.x + ox + (Math.random() - 0.5) * 2.2,
                        pt.y,
                        pt.z + oz + (Math.random() - 0.5) * 2.2,
                    ),
            );
            sister[0]!.set(p.cloudX, p.cloudY, p.cloudZ);
            sister[sister.length - 1]!.set(p.hitX, p.hitY, p.hitZ);
            this.addThickPath(root, mats, baseOpacity, sister, BOLT_RADIUS * 0.55, 0xaaccff, 0.7);
        }
        const lineMat = new LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: AdditiveBlending,
        });
        mats.push(lineMat);
        baseOpacity.push(1);
        root.add(new Line(new BufferGeometry().setFromPoints(pts), lineMat));

        this.group.add(root);
        this.bolts.push({ root, mats, until: now + BOLT_LIFE, baseOpacity });
    }

    private disposeBolt(b: Bolt): void {
        this.group.remove(b.root);
        // shared cylGeo — do not dispose mesh.geometry; only line geos + mats
        b.root.traverse((o) => {
            const line = o as Line;
            if (line.isLine) line.geometry?.dispose();
        });
        for (const m of b.mats) m.dispose();
        b.root.clear();
    }

    private addThickPath(
        root: Group,
        mats: Array<MeshBasicMaterial | LineBasicMaterial>,
        baseOpacity: number[],
        pts: Vector3[],
        radius: number,
        color: number,
        opacity: number,
    ): void {
        const mat = new MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
        });
        mats.push(mat);
        baseOpacity.push(opacity);
        const up = new Vector3(0, 1, 0);
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i]!;
            const b = pts[i + 1]!;
            const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
            const dir = new Vector3().subVectors(b, a);
            const len = dir.length();
            if (len < 1e-4) continue;
            dir.multiplyScalar(1 / len);
            const mesh = new Mesh(this.cylGeo, mat);
            mesh.position.copy(mid);
            mesh.scale.set(radius, len, radius);
            mesh.quaternion.setFromUnitVectors(up, dir);
            root.add(mesh);
        }
    }

    private spawn(cue: CloudCue): void {
        const tpl = cue.kind === 'storm' ? this.stormTpl : this.poisonTpl;
        if (!tpl) return;
        const { root, materials } = cloneSpellInstance(tpl);
        for (const m of materials) {
            m.transparent = true;
            m.depthWrite = false;
            if (cue.kind === 'poison') {
                m.color.setHex(0x6ec84a);
                m.emissive?.setHex(0x1a3a10);
                m.opacity = 0.85;
            } else {
                // storm flash: soft translucent slate
                m.color.setHex(0x6a7088);
                m.emissive?.setHex(0x1a2030);
                m.opacity = cue.maxOpacity ?? FLASH_CLOUD_OPACITY;
            }
        }
        const gy = groundHeightAt(cue.x, cue.z);
        const height =
            cue.cloudHeight ?? (cue.kind === 'storm' ? STORM_CLOUD_HEIGHT : CLOUD_HEIGHT);
        const baseY = gy + height;
        root.position.set(cue.x, baseY, cue.z);
        root.scale.setScalar(
            cue.meshScale ?? (cue.kind === 'storm' ? STORM_SCALE : POISON_SCALE),
        );
        root.visible = false;
        this.group.add(root);
        this.clouds.push({ cue, root, materials, baseY });
    }

    private async load(): Promise<void> {
        const [storm, poison] = await Promise.all([
            ensureSpellTemplate('storm'),
            ensureSpellTemplate('poison'),
        ]);
        this.stormTpl = storm;
        this.poisonTpl = poison;
        if (storm && poison) console.info('[cloudFx] templates ready');
    }
}
