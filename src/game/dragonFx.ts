import {
    CanvasTexture,
    CylinderGeometry,
    DoubleSide,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    RepeatWrapping,
    SRGBColorSpace,
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
import { DRAGON_APPROACH_SEC, DRAGON_POUR_DURATION_SEC } from './tactics';

const DRAGON_URL = new URL('../../assets/models/spells/dragon.glb', import.meta.url).href;

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
const TUBE_RADIUS_GROUND = 1.6;
const TUBE_RADIUS_SKY = 0.55;

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

/**
 * Constant-speed flight along the capsule axis. Fire tube aims forward from
 * the dragon to a ground hit ahead (fire cursor). Shrink stays planted at
 * path end while the dragon keeps going.
 */
export class DragonFx {
    private readonly group = new Group();
    private template: Group | null = null;
    private readonly tubeGeo = makeUnitPipe(TUBE_RADIUS_GROUND, TUBE_RADIUS_SKY);
    private readonly flameTex = makeFlameTexture();
    private readonly tubeMat = new MeshBasicMaterial({
        map: this.flameTex,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: DoubleSide,
    });
    private readonly active: Active[] = [];
    private readonly loadPromise: Promise<void>;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.loadPromise = this.load();
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
    }

    update(simElapsed: number): void {
        this.flameTex.offset.y = (performance.now() * 0.0011) % 1;

        for (let i = this.active.length - 1; i >= 0; i--) {
            const a = this.active[i]!;
            if (a.done) continue;

            const pourDur = Math.max(a.cue.pourDuration || DRAGON_POUR_DURATION_SEC, 1e-3);
            const tPath0 = a.cue.at;
            const tPath1 = a.cue.at + pourDur;
            const speed = a.len / pourDur;
            // fire cursor along the path (matches sim pour progress)
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
            // dragon flies behind the ground hit so the breath shoots forward
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

            // mouth slightly ahead of the mesh center along flight (+X on model)
            _mouth.set(dx + a.ux * MESH_SCALE * 0.35, skyY - height * 0.08, dz + a.uz * MESH_SCALE * 0.35);
            if (mode === 'shrink') {
                _hit.set(a.cue.x2, groundHeightAt(a.cue.x2, a.cue.z2) + 0.3, a.cue.z2);
                // keep a stable mouth above the end while shrinking into the dirt
                _mouth.set(
                    a.cue.x2 - a.ux * aimAhead * 0.35,
                    groundHeightAt(a.cue.x2, a.cue.z2) + HEIGHT_BREATH * 0.85,
                    a.cue.z2 - a.uz * aimAhead * 0.35,
                );
            } else {
                _hit.set(hx, hitGy + 0.3, hz);
            }
            placeBreathTube(a.tube, mode, _mouth, _hit, spitU, shrinkU);

            a.root.visible = true;
            a.root.position.set(dx, skyY, dz);
            a.root.rotation.order = 'YZX';
            a.root.rotation.y = Math.atan2(-a.uz, a.ux);
            a.root.rotation.x = 0;
            const low = MathUtils.clamp(
                1 - (height - HEIGHT_BREATH) / Math.max(HEIGHT_FAR - HEIGHT_BREATH, 1),
                0,
                1,
            );
            // tip nose toward the ground hit ahead
            a.root.rotation.z = -0.12 - low * 0.2;
            a.root.scale.setScalar(MESH_SCALE);

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
            if (fade <= 0.02) a.root.visible = false;
        }
    }

    dispose(): void {
        this.clear();
        this.tubeGeo.dispose();
        this.tubeMat.dispose();
        this.flameTex.dispose();
        this.group.removeFromParent();
        if (this.template) disposeObject(this.template);
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
        } else {
            root = new Group();
            materials = [];
        }
        root.visible = false;

        const tube = new Mesh(this.tubeGeo, this.tubeMat);
        tube.visible = false;
        tube.renderOrder = 2;
        tube.frustumCulled = false;

        this.group.add(root);
        this.group.add(tube);
        this.active.push({ cue, root, materials, tube, len, ux, uz, done: false });
    }

    private async load(): Promise<void> {
        try {
            // asset is authored with +X forward — no bake flip
            this.template = await loadSpellTemplate(DRAGON_URL);
            console.info('[dragonFx] loaded dragon');
            for (const a of this.active) {
                if (a.materials.length > 0) continue;
                const { root, materials } = cloneSpellInstance(this.template);
                root.visible = false;
                this.group.remove(a.root);
                this.group.add(root);
                a.root = root;
                a.materials = materials;
            }
        } catch (e) {
            console.error('[dragonFx] failed to load dragon model', e);
        }
    }
}

/**
 * Unit pipe [0→1] on +Y, oriented mouth → ground hit (forward breath).
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
    const fullLen = Math.max(_dir.length(), 0.05);
    _dir.multiplyScalar(1 / fullLen);

    if (mode === 'spit') {
        const u = 1 - (1 - spitU) * (1 - spitU);
        const len = Math.max(fullLen * u, 0.05);
        tube.position.copy(mouth);
        tube.scale.set(1, len, 1);
        tube.quaternion.setFromUnitVectors(_up, _dir);
        return;
    }

    if (mode === 'full') {
        tube.position.copy(mouth);
        tube.scale.set(1, fullLen, 1);
        tube.quaternion.setFromUnitVectors(_up, _dir);
        return;
    }

    // shrink toward the ground hit — tip falls along the breath line
    const u = shrinkU * shrinkU;
    const remain = Math.max(1 - u, 0);
    const len = fullLen * remain;
    const width = Math.max(0.2, remain);
    if (len < 0.08) {
        tube.visible = false;
        return;
    }
    // base stays on the ground; mouth end retracts toward hit
    tube.position.copy(hit).addScaledVector(_dir, -len);
    tube.scale.set(width, len, width);
    tube.quaternion.setFromUnitVectors(_up, _dir);
}

/**
 * Height from distance along the axis (constant horizontal speed).
 * Smooth linear blends — no holds.
 */
function heightForDist(dist: number, pathLen: number, speed: number, tPath0: number): number {
    const leadIn = speed * tPath0; // distance covered from battle start → path start
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

function makeUnitPipe(radiusTop: number, radiusBottom: number): CylinderGeometry {
    const geo = new CylinderGeometry(radiusTop, radiusBottom, 1, 12, 8, true);
    geo.translate(0, 0.5, 0);
    const uv = geo.attributes.uv;
    if (uv) {
        for (let i = 0; i < uv.count; i++) {
            uv.setY(i, uv.getY(i) * 4);
        }
        uv.needsUpdate = true;
    }
    return geo;
}

function makeFlameTexture(): CanvasTexture {
    const w = 64;
    const h = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255, 240, 160, 0.15)');
    g.addColorStop(0.2, 'rgba(255, 180, 40, 0.85)');
    g.addColorStop(0.45, 'rgba(255, 90, 20, 0.95)');
    g.addColorStop(0.7, 'rgba(220, 30, 10, 0.9)');
    g.addColorStop(1, 'rgba(40, 0, 0, 0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 40; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const ww = 2 + Math.random() * 6;
        const hh = 12 + Math.random() * 40;
        const alpha = 0.15 + Math.random() * 0.35;
        ctx.fillStyle = `rgba(255, ${(180 + Math.random() * 60) | 0}, 60, ${alpha})`;
        ctx.fillRect(x, y, ww, hh);
    }

    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.needsUpdate = true;
    return tex;
}
