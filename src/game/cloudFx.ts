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
import { prefs, type FireVfxQuality } from './prefs';
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
const FLASH_CLOUD_FADE_IN = 0.22;
const FLASH_CLOUD_HOLD = 0.4;
const FLASH_CLOUD_FADE_OUT = 0.85;
/** bolt fires after the cloud has mostly faded in */
const BOLT_AFTER_CLOUD = 0.26;
const BOLT_LIFE = 0.28;
/**
 * Bolts alive or waiting at once. A storm zone drops several strikes per tick;
 * past this the extras (thunderhead, flickers) are dropped so a long storm
 * can't pile geometry up — the strikes themselves still land.
 */
const BOLT_BUDGET = 24;
/** sky-flicker bolts (no ground hit) — short additive flashes in the cloud */
const SKY_FLASH_LIFE = 0.14;
/** cylinder radius for the main flash column */
const BOLT_RADIUS = 0.42;
const BOLT_GLOW_RADIUS = 0.78;
const FLASH_CLOUD_SCALE = 7.2;
const FLASH_CLOUD_OPACITY = 0.48;

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
    life: number;
};

type PendingBolt = {
    at: number;
    cloudX: number;
    cloudY: number;
    cloudZ: number;
    hitX: number;
    hitY: number;
    hitZ: number;
    /** brief in-cloud flicker — no ground strike */
    skyFlash?: boolean;
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
     * What a strike is allowed to draw, by spell-VFX quality: the bolt always
     * lands, the thunderhead and its flicker bolts are the part that adds up
     * when a storm drops several bolts a tick.
     */
    private stormBudget(quality: FireVfxQuality = prefs().fireVfx): {
        cloud: boolean;
        flickers: number;
        secondCloudChance: number;
    } {
        switch (quality) {
            case 'off':
            case 'low':
                // weak machines: the strike itself, nothing around it
                return { cloud: false, flickers: 0, secondCloudChance: 0 };
            case 'medium':
                return { cloud: true, flickers: 1, secondCloudChance: 0 };
            case 'high':
                return { cloud: true, flickers: 1 + Math.floor(Math.random() * 2), secondCloudChance: 0.35 };
        }
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
            const cloudX = x + (Math.random() - 0.5) * 6;
            const cloudZ = z + (Math.random() - 0.5) * 6;
            const cloudHeight = STORM_CLOUD_HEIGHT + (Math.random() - 0.5) * 5;
            const cloudY = gy + cloudHeight;
            const meshScale = FLASH_CLOUD_SCALE + Math.random() * 1.8;
            // busy storm: strikes keep landing, the decoration around them stops
            const crowded = this.bolts.length + this.pendingBolts.length >= BOLT_BUDGET;
            const budget = crowded
                ? { cloud: false, flickers: 0, secondCloudChance: 0 }
                : this.stormBudget();

            if (budget.cloud) {
                this.spawn({
                    kind: 'storm',
                    x: cloudX,
                    z: cloudZ,
                    radius: 28,
                    startAt: now + FLASH_CLOUD_FADE_IN,
                    endAt: now + FLASH_CLOUD_FADE_IN + FLASH_CLOUD_HOLD,
                    meshScale,
                    cloudHeight,
                    maxOpacity: FLASH_CLOUD_OPACITY,
                    fadeIn: FLASH_CLOUD_FADE_IN,
                    fadeOut: FLASH_CLOUD_FADE_OUT,
                });
            }

            // Main ground strike
            this.pendingBolts.push({
                at: now + BOLT_AFTER_CLOUD,
                cloudX,
                cloudY: cloudY - 1.2,
                cloudZ,
                hitX: x,
                hitY: tipY,
                hitZ: z,
            });

            // Extra in-cloud / near-cloud flashes so the storm feels busier
            for (let i = 0; i < budget.flickers; i++) {
                const fx = cloudX + (Math.random() - 0.5) * meshScale * 0.8;
                const fz = cloudZ + (Math.random() - 0.5) * meshScale * 0.8;
                const fy = cloudY - 0.5 - Math.random() * 4;
                this.pendingBolts.push({
                    at: now + BOLT_AFTER_CLOUD + 0.04 + i * (0.05 + Math.random() * 0.06),
                    cloudX: fx + (Math.random() - 0.5) * 3,
                    cloudY: cloudY + (Math.random() - 0.5) * 2,
                    cloudZ: fz + (Math.random() - 0.5) * 3,
                    hitX: fx,
                    hitY: fy,
                    hitZ: fz,
                    skyFlash: true,
                });
            }

            // Occasional second cloud nearby (extra thunderhead flash)
            if (Math.random() < budget.secondCloudChance) {
                const sx = cloudX + (Math.random() - 0.5) * 10;
                const sz = cloudZ + (Math.random() - 0.5) * 10;
                const sh = cloudHeight + (Math.random() - 0.5) * 3;
                this.spawn({
                    kind: 'storm',
                    x: sx,
                    z: sz,
                    radius: 20,
                    startAt: now + FLASH_CLOUD_FADE_IN + 0.08,
                    endAt: now + FLASH_CLOUD_FADE_IN + FLASH_CLOUD_HOLD * 0.7,
                    meshScale: meshScale * (0.55 + Math.random() * 0.25),
                    cloudHeight: sh,
                    maxOpacity: FLASH_CLOUD_OPACITY * 0.75,
                    fadeIn: FLASH_CLOUD_FADE_IN * 0.8,
                    fadeOut: FLASH_CLOUD_FADE_OUT * 0.75,
                });
            }
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
            const spin = simElapsed * (cue.kind === 'storm' ? 0.12 : 0.08);
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
            const fade = MathUtils.clamp(left / b.life, 0, 1);
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
        const segs = p.skyFlash ? 4 : 6;
        const jitter = p.skyFlash ? 3.5 : 7;
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const jx = (Math.random() - 0.5) * (i === 0 || i === segs ? 0.8 : jitter);
            const jz = (Math.random() - 0.5) * (i === 0 || i === segs ? 0.8 : jitter);
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

        const coreR = p.skyFlash ? BOLT_RADIUS * 0.45 : BOLT_RADIUS;
        const glowR = p.skyFlash ? BOLT_GLOW_RADIUS * 0.5 : BOLT_GLOW_RADIUS;
        this.addThickPath(root, mats, baseOpacity, pts, glowR, 0x6688ee, p.skyFlash ? 0.35 : 0.45);
        this.addThickPath(root, mats, baseOpacity, pts, coreR, 0xddeeff, p.skyFlash ? 0.75 : 0.95);
        const sisters = p.skyFlash ? 1 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 2);
        for (let s = 0; s < sisters; s++) {
            const ox = (Math.random() - 0.5) * (p.skyFlash ? 2.2 : 4);
            const oz = (Math.random() - 0.5) * (p.skyFlash ? 2.2 : 4);
            const sister = pts.map(
                (pt) =>
                    new Vector3(
                        pt.x + ox + (Math.random() - 0.5) * 2.2,
                        pt.y + (p.skyFlash ? (Math.random() - 0.5) * 1.5 : 0),
                        pt.z + oz + (Math.random() - 0.5) * 2.2,
                    ),
            );
            sister[0]!.set(p.cloudX, p.cloudY, p.cloudZ);
            sister[sister.length - 1]!.set(p.hitX, p.hitY, p.hitZ);
            this.addThickPath(
                root,
                mats,
                baseOpacity,
                sister,
                coreR * 0.5,
                0xaaccff,
                p.skyFlash ? 0.55 : 0.7,
            );
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

        const life = p.skyFlash ? SKY_FLASH_LIFE : BOLT_LIFE;
        this.group.add(root);
        this.bolts.push({ root, mats, until: now + life, baseOpacity, life });
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
