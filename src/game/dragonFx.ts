import {
    AdditiveBlending,
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    RepeatWrapping,
    SRGBColorSpace,
    Vector3,
    type MeshStandardMaterial,
    type Scene,
    type Texture,
} from 'three';
import { groundHeightAt, CELL } from './map';
import { ensureSpellTemplate } from './spellAssets';
import {
    cloneSpellInstance,
    disposeObject,
    setSpellOpacity,
} from './spellMeshes';
import {
    attachDragonWingFlap,
} from './crowWingFlap';
import { prefs, type SceneryQuality } from './prefs';
import type { BreathTongueSample } from './flameRenderer';
import { DRAGON_APPROACH_SEC, DRAGON_POUR_DURATION_SEC, DRAGON_ID, TACTICS } from './tactics';

/** authored empty in dragon.glb — fire tube origin in the mouth */
const MOUTH_SPAWN_NAME = 'MouthFireSpawn';

/** re-export — also the spit wind-up (charge clears when spit begins) */
export { DRAGON_APPROACH_SEC };

/** spit duration (= charge lead); ray grows from tip → ground */
const SPIT_SEC = DRAGON_APPROACH_SEC;
/** ray collapses at path end while the dragon keeps flying */
const SHRINK_SEC = 0.42;
/** after path end: keep flying at the same speed */
const EXIT_SEC = 2.6;

/** high when far away (battle start) */
const HEIGHT_FAR = 155;
/** close while spitting / pouring fire */
const HEIGHT_BREATH = 32;
/** climb-out peak */
const HEIGHT_EXIT = 175;
/**
 * Breath aim: ground hit stays on the fire cursor; dragon flies this far
 * behind so the tube shoots forward/down (not straight down).
 * Scaled with altitude so the angle stays readable.
 */
const AIM_AHEAD_MIN = 14;
const AIM_AHEAD_MAX = 36;
const AIM_AHEAD_HEIGHT_FRAC = 0.72;

const MESH_SCALE = 36;
/** Match dragon ground-fire disc (~tactic radius), visually ~75%. */
const DRAGON_FIRE_R = TACTICS[DRAGON_ID]?.radius ?? 5 * CELL;
/** Former outer sheath radius — kept as reference for the inner-core fraction. */
const OUTER_RADIUS_GROUND = DRAGON_FIRE_R * 0.75;
/** Single tube = former bright core (~38% of the outer sheath). */
const TUBE_RADIUS_GROUND = OUTER_RADIUS_GROUND * 0.38;
const TUBE_RADIUS_SKY = Math.max(0.22, TUBE_RADIUS_GROUND * 0.045);
/** Push tube origin along mouth→hit so it reads ahead of the mouth empty. */
const TUBE_MOUTH_BIAS = 5.4;
/** Stretch past the ground hit so the beam sinks into the terrain. */
const TUBE_LENGTH_SCALE = 1.35;
/** Spacing along the beam for flame-tongue anchors (scenery high/ultra). */
const BREATH_TONGUE_STEP = 0.55;
const BREATH_TONGUE_MAX = 280;

function breathTonguesEnabled(quality: SceneryQuality = prefs().scenery): boolean {
    return quality === 'high' || quality === 'ultra';
}

export type DragonCue = {
    x: number;
    z: number;
    x2: number;
    z2: number;
    /** sim.elapsed when ground hit reaches path start (breath / pour begins) */
    at: number;
    /** start→end pour duration (matches sim hazard pour) */
    pourDuration: number;
};

type Active = {
    cue: DragonCue;
    root: Group;
    materials: MeshStandardMaterial[];
    /** MouthFireSpawn marker, or null if the model has none */
    mouthSpawn: Object3D | null;
    /** Single bright breath tube (former “core” look) */
    tube: Mesh;
    len: number;
    ux: number;
    uz: number;
    done: boolean;
};

type TubeMode = 'hidden' | 'spit' | 'full' | 'shrink';

const _mouth = new Vector3();
const _hit = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fallbackMouth = new Vector3();
const _side = new Vector3();

/**
 * Constant-speed flight along the capsule axis. Fire tube aims from
 * MouthFireSpawn (or a forward fallback) to the ground hit ahead.
 */
export class DragonFx {
    private readonly group = new Group();
    private template: Group | null = null;
    private readonly tubeGeo = makeUnitPipe(TUBE_RADIUS_GROUND, TUBE_RADIUS_SKY, 14);
    private readonly flameTex = makeFlameTexture();
    private readonly tubeMat = makeBreathMaterial(this.flameTex, 0.95);
    private readonly active: Active[] = [];
    private readonly loadPromise: Promise<void>;
    /** Flame-tongue anchors for FireFx / FlameRenderer this frame. */
    private readonly breathSamples: BreathTongueSample[] = [];

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.load();
    }

    /** World samples along active breath tubes (empty when none / not HQ). */
    getBreathTongueSamples(): readonly BreathTongueSample[] {
        return this.breathSamples;
    }

    schedule(cues: readonly DragonCue[]): void {
        this.clear();
        for (const cue of cues) this.spawn(cue);
        void this.loadPromise;
    }

    clear(): void {
        for (const a of this.active) {
            this.group.remove(a.root);
            this.group.remove(a.tube);
            disposeObject(a.root);
        }
        this.active.length = 0;
        this.breathSamples.length = 0;
    }

    update(simElapsed: number): void {
        const t = performance.now() * 0.001;
        this.flameTex.offset.y = (t * 2.6) % 1;
        this.breathSamples.length = 0;
        const tonguesOn = breathTonguesEnabled();

        for (let i = this.active.length - 1; i >= 0; i--) {
            const a = this.active[i]!;
            if (a.done) continue;

            const pourDur = Math.max(a.cue.pourDuration || DRAGON_POUR_DURATION_SEC, 1e-3);
            const tPath0 = a.cue.at;
            const tPath1 = a.cue.at + pourDur;
            const speed = a.len / pourDur;
            const hitDist = speed * (simElapsed - tPath0);
            const tDone = tPath1 + SHRINK_SEC + EXIT_SEC;

            if (simElapsed >= tDone) {
                this.group.remove(a.root);
                this.group.remove(a.tube);
                disposeObject(a.root);
                a.done = true;
                this.active.splice(i, 1);
                continue;
            }

            const hitH = heightForDist(hitDist, a.len, speed, tPath0);
            const aimAhead = MathUtils.clamp(
                hitH * AIM_AHEAD_HEIGHT_FRAC,
                AIM_AHEAD_MIN,
                AIM_AHEAD_MAX,
            );
            const dragonDist = hitDist - aimAhead;
            const height = heightForDist(dragonDist, a.len, speed, tPath0);

            const hx = a.cue.x + a.ux * hitDist;
            const hz = a.cue.z + a.uz * hitDist;
            const dx = a.cue.x + a.ux * dragonDist;
            const dz = a.cue.z + a.uz * dragonDist;
            const hitGy = groundHeightAt(hx, hz);
            const dragGy = groundHeightAt(dx, dz);
            const skyY = dragGy + height;

            let mode: TubeMode = 'hidden';
            let spitU = 0;
            let shrinkU = 0;
            const spitDist = speed * SPIT_SEC;

            if (hitDist >= -spitDist && hitDist < 0) {
                mode = 'spit';
                spitU = MathUtils.clamp((hitDist + spitDist) / Math.max(spitDist, 1e-3), 0, 1);
            } else if (hitDist >= 0 && hitDist <= a.len) {
                mode = 'full';
            } else if (hitDist > a.len && hitDist < a.len + speed * SHRINK_SEC) {
                mode = 'shrink';
                shrinkU = MathUtils.clamp(
                    (hitDist - a.len) / Math.max(speed * SHRINK_SEC, 1e-3),
                    0,
                    1,
                );
            }

            a.root.visible = true;
            a.root.position.set(dx, skyY, dz);
            a.root.rotation.order = 'YZX';
            a.root.rotation.y = Math.atan2(-a.ux, -a.uz);
            a.root.rotation.x = 0;
            const low = MathUtils.clamp(
                1 - (height - HEIGHT_BREATH) / Math.max(HEIGHT_FAR - HEIGHT_BREATH, 1),
                0,
                1,
            );
            a.root.rotation.z = -0.12 - low * 0.2;
            a.root.scale.setScalar(MESH_SCALE);
            a.root.updateMatrixWorld(true);

            if (a.mouthSpawn) {
                a.mouthSpawn.getWorldPosition(_mouth);
            } else {
                _fallbackMouth.set(
                    dx + a.ux * MESH_SCALE * 0.28,
                    skyY - height * 0.06,
                    dz + a.uz * MESH_SCALE * 0.28,
                );
                _mouth.copy(_fallbackMouth);
            }

            if (mode === 'shrink') {
                _hit.set(a.cue.x2, groundHeightAt(a.cue.x2, a.cue.z2) + 0.25, a.cue.z2);
            } else {
                _hit.set(hx, hitGy + 0.25, hz);
            }

            placeBreathTube(a.tube, mode, _mouth, _hit, spitU, shrinkU);

            let fade = 1;
            if (hitDist > a.len) {
                const exitU = MathUtils.clamp(
                    (hitDist - a.len) / Math.max(speed * (SHRINK_SEC + EXIT_SEC), 1e-3),
                    0,
                    1,
                );
                fade = 1 - exitU * exitU;
            }
            setSpellOpacity(a.materials, fade);
            if (fade <= 0.02) {
                a.root.visible = false;
                a.tube.visible = false;
            } else if (tonguesOn) {
                // High/ultra: flame tongues only — keep tube geom for sampling, hide the sheet.
                a.tube.visible = false;
                if (mode !== 'hidden') appendBreathTongueSamples(this.breathSamples, a.tube);
            } else {
                (a.tube.material as MeshBasicMaterial).opacity = 0.95 * fade;
            }
        }
    }

    dispose(): void {
        this.clear();
        this.tubeGeo.dispose();
        this.tubeMat.dispose();
        this.flameTex.dispose();
        this.group.removeFromParent();
        this.template = null;
    }

    private spawn(cue: DragonCue): void {
        const dx = cue.x2 - cue.x;
        const dz = cue.z2 - cue.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;

        let root: Group;
        let materials: MeshStandardMaterial[];
        if (this.template) {
            const inst = cloneSpellInstance(this.template);
            root = inst.root;
            materials = inst.materials;
            attachDragonWingFlap(root);
        } else {
            root = new Group();
            materials = [];
        }
        root.visible = false;
        const mouthSpawn = root.getObjectByName(MOUTH_SPAWN_NAME) ?? null;

        const tube = new Mesh(this.tubeGeo, this.tubeMat);
        tube.visible = false;
        tube.renderOrder = 2;
        tube.frustumCulled = false;

        this.group.add(root);
        this.group.add(tube);
        this.active.push({ cue, root, materials, mouthSpawn, tube, len, ux, uz, done: false });
    }

    private async load(): Promise<void> {
        this.template = await ensureSpellTemplate('dragon');
        if (!this.template) return;
        console.info('[dragonFx] template ready');
        for (const a of this.active) {
            if (a.materials.length > 0) continue;
            const { root, materials } = cloneSpellInstance(this.template);
            attachDragonWingFlap(root);
            root.visible = false;
            this.group.remove(a.root);
            this.group.add(root);
            a.root = root;
            a.materials = materials;
            a.mouthSpawn = root.getObjectByName(MOUTH_SPAWN_NAME) ?? null;
        }
    }
}

function makeBreathMaterial(map: Texture, opacity: number): MeshBasicMaterial {
    return new MeshBasicMaterial({
        map,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
}

/**
 * Unit pipe [0→1] on +Y, oriented mouth → ground hit.
 * Spit grows from the mouth; shrink collapses onto the ground hit.
 */
function placeBreathTube(
    tube: Mesh,
    mode: TubeMode,
    mouth: Vector3,
    hit: Vector3,
    spitU: number,
    shrinkU: number,
): void {
    if (mode === 'hidden') {
        tube.visible = false;
        return;
    }
    tube.visible = true;

    _dir.copy(hit).sub(mouth);
    const mouthToHit = Math.max(_dir.length(), 0.05);
    _dir.multiplyScalar(1 / mouthToHit);
    const bias = Math.min(TUBE_MOUTH_BIAS, mouthToHit * 0.35);
    const origin = _fallbackMouth.copy(mouth).addScaledVector(_dir, bias);
    const fullLen = Math.max((mouthToHit - bias) * TUBE_LENGTH_SCALE, 0.05);

    if (mode === 'spit') {
        const u = 1 - (1 - spitU) * (1 - spitU);
        const len = Math.max(fullLen * u, 0.05);
        tube.position.copy(origin);
        tube.scale.set(1, len, 1);
        tube.quaternion.setFromUnitVectors(_up, _dir);
        return;
    }

    if (mode === 'full') {
        tube.position.copy(origin);
        tube.scale.set(1, fullLen, 1);
        tube.quaternion.setFromUnitVectors(_up, _dir);
        return;
    }

    const u = shrinkU * shrinkU;
    const remain = Math.max(1 - u, 0);
    const len = fullLen * remain;
    const width = Math.max(0.15, remain);
    if (len < 0.08) {
        tube.visible = false;
        return;
    }
    tube.position.copy(hit).addScaledVector(_dir, -len);
    tube.scale.set(width, len, width);
    tube.quaternion.setFromUnitVectors(_up, _dir);
}

/** Plant flame-tongue anchors along the beam; random left↔right wash near the ground. */
function appendBreathTongueSamples(out: BreathTongueSample[], tube: Mesh): void {
    if (out.length >= BREATH_TONGUE_MAX) return;
    const len = tube.scale.y;
    if (len < 0.2) return;

    _dir.set(0, 1, 0).applyQuaternion(tube.quaternion).normalize();
    // Horizontal left/right across the flight path (XZ only).
    _side.set(-_dir.z, 0, _dir.x);
    if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
    _side.normalize();

    const steps = Math.max(2, Math.ceil(len / BREATH_TONGUE_STEP));
    const maxSpread = OUTER_RADIUS_GROUND * 1.75;
    for (let s = 0; s <= steps && out.length < BREATH_TONGUE_MAX; s++) {
        const u = s / steps;
        const along = len * u;
        const cx = tube.position.x + _dir.x * along;
        const cy = tube.position.y + _dir.y * along;
        const cz = tube.position.z + _dir.z * along;
        const spread = Math.pow(u, 1.55) * maxSpread;
        // Density grows with width, but never so fast that we run out of slots mid-beam.
        const remainingSteps = steps - s + 1;
        const remainingBudget = BREATH_TONGUE_MAX - out.length;
        const want = spread < 0.4 ? 1 : Math.min(5, 2 + Math.floor(spread * 0.22));
        const count = Math.min(want, Math.max(1, Math.floor(remainingBudget / remainingSteps)));
        for (let k = 0; k < count && out.length < BREATH_TONGUE_MAX; k++) {
            const h1 =
                Math.abs(Math.sin(cx * 12.9898 + cz * 78.233 + along * 5.1 + k * 19.19) * 43758.5453) %
                1;
            const h2 =
                Math.abs(Math.sin(cx * 39.346 + cz * 11.135 + along * 9.7 + k * 47.3) * 24634.6345) %
                1;
            const lateral = spread < 0.4 ? 0 : (h1 * 2 - 1) * spread;
            // Small along-beam jitter breaks the “ladder rung” banding.
            const alongJit = (h2 - 0.5) * BREATH_TONGUE_STEP * 0.85;
            out.push({
                x: cx + _side.x * lateral + _dir.x * alongJit,
                y: cy + _dir.y * alongJit,
                z: cz + _side.z * lateral + _dir.z * alongJit,
            });
        }
    }
}

function heightForDist(dist: number, pathLen: number, speed: number, tPath0: number): number {
    const leadIn = speed * tPath0;
    const exitDist = speed * (SHRINK_SEC + EXIT_SEC);

    if (dist < 0) {
        const u = MathUtils.clamp((dist + leadIn) / Math.max(leadIn, 1e-3), 0, 1);
        return MathUtils.lerp(HEIGHT_FAR, HEIGHT_BREATH, u);
    }
    if (dist <= pathLen) {
        const u = pathLen > 1e-3 ? dist / pathLen : 1;
        return MathUtils.lerp(HEIGHT_BREATH, HEIGHT_BREATH * 1.05, u);
    }
    const u = MathUtils.clamp((dist - pathLen) / Math.max(exitDist, 1e-3), 0, 1);
    return MathUtils.lerp(HEIGHT_BREATH * 1.05, HEIGHT_EXIT, u);
}

/** Open tapered pipe; V=0 at mouth (y=0), V increases toward ground. */
function makeUnitPipe(radiusGround: number, radiusMouth: number, segments: number): CylinderGeometry {
    const geo = new CylinderGeometry(radiusGround, radiusMouth, 1, segments, 10, true);
    geo.translate(0, 0.5, 0);
    const uv = geo.attributes.uv;
    if (uv) {
        for (let i = 0; i < uv.count; i++) {
            uv.setY(i, (1 - uv.getY(i)) * 3.2);
        }
        uv.needsUpdate = true;
    }
    return geo;
}

/** Hot orange / yellow additive sheet — former inner-core look. */
function makeFlameTexture(): CanvasTexture {
    const w = 64;
    const h = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255, 252, 230, 0.95)');
    g.addColorStop(0.2, 'rgba(255, 230, 120, 0.9)');
    g.addColorStop(0.5, 'rgba(255, 160, 40, 0.85)');
    g.addColorStop(0.8, 'rgba(255, 90, 20, 0.55)');
    g.addColorStop(1, 'rgba(180, 40, 10, 0.15)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 32; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const ww = 1.5 + Math.random() * 5;
        const hh = 10 + Math.random() * 48;
        const alpha = 0.1 + Math.random() * 0.35;
        const hot = Math.random() > 0.45;
        ctx.fillStyle = hot
            ? `rgba(255, ${(200 + Math.random() * 55) | 0}, ${(80 + Math.random() * 100) | 0}, ${alpha})`
            : `rgba(255, ${(90 + Math.random() * 80) | 0}, ${(10 + Math.random() * 40) | 0}, ${alpha})`;
        ctx.fillRect(x, y, ww, hh);
    }

    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(2.2, 1);
    tex.needsUpdate = true;
    return tex;
}
