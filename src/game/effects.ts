import { screenShake } from './screenShake';
import {
    AdditiveBlending,
    Box3,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    DynamicDrawUsage,
    Euler,
    Group,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshStandardMaterial,
    NormalBlending,
    Points,
    Quaternion,
    Ray,
    Raycaster,
    ShaderMaterial,
    SphereGeometry,
    Vector2,
    Vector3,
    type Intersection,
    type Material,
    type Object3D,
    type Scene,
    type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGltfLoader } from '../engine/gltfLoader';
import type { Projectile, SimEvent } from './sim';
import { bloodParticleScale, bloodIntensityScale, stuckProjectileCap, prefs } from './prefs';
import type { SceneryQuality } from './prefs';
import { applyTextureBudget, modelTextureBudget } from './textureBudget';
import {
    getUnitInstanceAsset,
    getUnitVisualHalfWidth,
    getUnitVisualHeight,
} from './unitModels';
import { THEME } from '../theme';

/** Per-style flight pool — plenty for rapid-fire archers later. */
const MAX_PROJECTILES = 1024;
const MAX_PARTICLES = 6144;
const GRAVITY = -14;
/** wizard orb visual scale vs unit sphere (sim hit radius unchanged) */
const ORB_SCALE = 2.4;
/** Unit-length bolt.glb → world length for archer / ballista. */
const ARROW_SCALE = 3.2;
const LARGE_ARROW_SCALE = 9.5; // between prior 8.5 and the too-small 5.95

/** Crow-rider thrown rock — flight pool and ground debris share this geometry. */
const CROW_STONE_GEO_R = 0.84;
let crowStoneGeometry: IcosahedronGeometry | null = null;
function getCrowStoneGeometry(): IcosahedronGeometry {
    if (!crowStoneGeometry) crowStoneGeometry = new IcosahedronGeometry(CROW_STONE_GEO_R, 0);
    return crowStoneGeometry;
}

const BOLT_URL = new URL('../../assets/models/bolt.glb', import.meta.url).href;

interface BoltAsset {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
    /** Local +Z of the tip after unit-length bake (center at 0). */
    tipZ: number;
}

let boltAsset: BoltAsset | null = null;
let boltLoad: Promise<BoltAsset | null> | null = null;

/** Brighter sibling burst for oversized death gore. */
function lightenBlood(hex: number): number {
    const c = new Color(hex);
    c.offsetHSL(0.02, 0.08, 0.14);
    return c.getHex();
}

type ProjectileStyle = Projectile['style'];

/**
 * Shaft + tip + flat fletching along +Z (nose forward).
 * Fletching is thin vanes — not a rear cone (that read as a second tip).
 * Kept as fallback if {@link preloadProjectileBolt} fails.
 */
function makeArrowGeometry(scale: number): BufferGeometry {
    const shaft = new CylinderGeometry(0.032 * scale, 0.038 * scale, 1.35 * scale, 6);
    shaft.rotateX(Math.PI / 2);

    const tip = new ConeGeometry(0.095 * scale, 0.4 * scale, 6);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.72 * scale);

    // three feather vanes around the nock
    const vanes: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
        const vane = new BoxGeometry(0.018 * scale, 0.2 * scale, 0.34 * scale);
        vane.translate(0, 0.09 * scale, -0.72 * scale);
        vane.rotateZ((i * Math.PI * 2) / 3);
        vanes.push(vane);
    }

    // small nock block at the very back
    const nock = new BoxGeometry(0.05 * scale, 0.05 * scale, 0.06 * scale);
    nock.translate(0, 0, -0.92 * scale);

    return mergeGeometries([shaft, tip, nock, ...vanes])!;
}

const _dq = new Vector3();

function dequantizeGeometry(source: BufferGeometry): BufferGeometry {
    const geo = source.clone();
    for (const name of Object.keys(geo.attributes)) {
        const attr = geo.getAttribute(name);
        if (!attr) continue;
        if (attr.array instanceof Float32Array && !attr.normalized) continue;
        const itemSize = attr.itemSize;
        const count = attr.count;
        const out = new Float32Array(count * itemSize);
        for (let i = 0; i < count; i++) {
            if (itemSize === 3) {
                _dq.fromBufferAttribute(attr, i);
                out[i * 3] = _dq.x;
                out[i * 3 + 1] = _dq.y;
                out[i * 3 + 2] = _dq.z;
            } else if (itemSize === 2) {
                out[i * 2] = attr.getX(i);
                out[i * 2 + 1] = attr.getY(i);
            } else {
                for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attr.getComponent(i, k);
            }
        }
        geo.setAttribute(name, new BufferAttribute(out, itemSize));
    }
    return geo;
}

/**
 * Align shaft so the tip points along +Z (ProjectileRenderer flight axis).
 * Tripo bolts are often diagonal in XY with sparse mid-shaft verts — PCA finds
 * the real long axis; the narrower end is treated as the tip.
 */
function alignShaftToPlusZ(geo: BufferGeometry): void {
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) return;

    const c = new Vector3();
    for (let i = 0; i < pos.count; i++) c.add(_dq.fromBufferAttribute(pos, i));
    c.multiplyScalar(1 / pos.count);

    let cxx = 0;
    let cxy = 0;
    let cxz = 0;
    let cyy = 0;
    let cyz = 0;
    let czz = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) - c.x;
        const y = pos.getY(i) - c.y;
        const z = pos.getZ(i) - c.z;
        cxx += x * x;
        cxy += x * y;
        cxz += x * z;
        cyy += y * y;
        cyz += y * z;
        czz += z * z;
    }

    // Power iteration → principal axis
    let ax = 1;
    let ay = 0;
    let az = 0;
    for (let it = 0; it < 32; it++) {
        const nx = cxx * ax + cxy * ay + cxz * az;
        const ny = cxy * ax + cyy * ay + cyz * az;
        const nz = cxz * ax + cyz * ay + czz * az;
        const len = Math.hypot(nx, ny, nz) || 1;
        ax = nx / len;
        ay = ny / len;
        az = nz / len;
    }

    let tMin = Infinity;
    let tMax = -Infinity;
    let rLo = 0;
    let rHi = 0;
    const ts: { t: number; r: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) - c.x;
        const y = pos.getY(i) - c.y;
        const z = pos.getZ(i) - c.z;
        const t = x * ax + y * ay + z * az;
        const r = Math.hypot(x - t * ax, y - t * ay, z - t * az);
        tMin = Math.min(tMin, t);
        tMax = Math.max(tMax, t);
        ts.push({ t, r });
    }
    const span = Math.max(tMax - tMin, 1e-6);
    for (const s of ts) {
        const u = (s.t - tMin) / span;
        if (u < 0.28) rLo = Math.max(rLo, s.r);
        else if (u > 0.72) rHi = Math.max(rHi, s.r);
    }
    // Tip = narrower end; tipDir points from center toward the tip.
    const tipDir = new Vector3(ax, ay, az);
    if (rLo <= rHi) tipDir.negate();

    const rot = new Matrix4().makeRotationFromQuaternion(
        new Quaternion().setFromUnitVectors(tipDir.normalize(), new Vector3(0, 0, 1)),
    );
    geo.applyMatrix4(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    geo.applyMatrix4(rot);
}

/**
 * Bake bolt.glb into unit-length +Z-forward geometry (matches projectile flight
 * orientation). Shaft axis is detected via PCA — Tripo often exports it askew.
 */
function prepareBoltFromScene(scene: Group): BoltAsset | null {
    const budget = modelTextureBudget();
    if (budget) applyTextureBudget(scene, budget);

    scene.updateMatrixWorld(true);
    const geos: BufferGeometry[] = [];
    let material: MeshStandardMaterial | null = null;
    const scratch = new Matrix4();

    scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
        if (mat instanceof MeshStandardMaterial && !material) {
            material = mat.clone();
            if (typeof material.metalness === 'number') material.metalness = Math.min(material.metalness, 0.55);
            material.envMapIntensity = 1.05;
            material.flatShading = false;
        }
        const geo = dequantizeGeometry(mesh.geometry);
        scratch.copy(mesh.matrixWorld);
        geo.applyMatrix4(scratch);
        geos.push(geo);
    });

    if (geos.length === 0) return null;
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!;
    for (let i = 1; i < geos.length; i++) geos[i]!.dispose();

    alignShaftToPlusZ(merged);

    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);
    merged.translate(-center.x, -center.y, -center.z);
    // Prefer Z length after alignment; fall back to longest axis.
    const longest = Math.max(size.z, size.x, size.y, 1e-3);
    merged.scale(1 / longest, 1 / longest, 1 / longest);
    // Re-center after scale (floating error) and ensure tip stays on +Z.
    merged.computeBoundingBox();
    const box2 = merged.boundingBox!;
    merged.translate(
        -(box2.min.x + box2.max.x) * 0.5,
        -(box2.min.y + box2.max.y) * 0.5,
        -(box2.min.z + box2.max.z) * 0.5,
    );
    merged.computeBoundingBox();
    merged.computeVertexNormals();
    const tipZ = Math.max(merged.boundingBox!.max.z, 0.35);

    if (!material) {
        material = new MeshStandardMaterial({
            color: 0x8a6a3c,
            roughness: 0.75,
            metalness: 0.15,
        });
    }

    return { geometry: merged, material, tipZ };
}

/** Load shared bolt mesh for archer / ballista InstancedMesh pools. Safe to call repeatedly. */
export async function preloadProjectileBolt(): Promise<void> {
    if (boltAsset) return;
    if (!boltLoad) {
        boltLoad = (async () => {
            try {
                const gltf = await getGltfLoader().loadAsync(BOLT_URL);
                const prepared = prepareBoltFromScene(gltf.scene);
                if (!prepared) throw new Error('no meshes in bolt.glb');
                boltAsset = prepared;
                console.info(
                    `[effects] bolt.glb ready (${prepared.geometry.getAttribute('position')?.count ?? 0} verts)`,
                );
                return prepared;
            } catch (e) {
                console.error('[effects] bolt.glb failed — procedural arrows', e);
                return null;
            }
        })();
    }
    await boltLoad;
}

export function getProjectileBoltAsset(): BoltAsset | null {
    return boltAsset;
}

/** World-space tip offset along flight dir for a bolt instance (matches 3D mesh tip). */
export function boltTipWorldOffset(style: 'arrow' | 'largeArrow'): number {
    const tipZ = boltAsset?.tipZ ?? 0.5;
    const scale = style === 'largeArrow' ? LARGE_ARROW_SCALE : ARROW_SCALE;
    return tipZ * scale;
}

const BRICK_URL = new URL('../../assets/models/brick.glb', import.meta.url).href;

interface BrickAsset {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
    /** Local Y size after normalize (unit longest axis) — for ground rest. */
    height: number;
}

let brickAsset: BrickAsset | null = null;
let brickLoad: Promise<BrickAsset | null> | null = null;
/** Half-height used by {@link chipRestY}; updated when brick.glb loads. */
let brickHalfExtentY = 0.24;

/** Bake brick.glb into a centered unit-size chip with its own albedo. */
function prepareBrickFromScene(scene: Group): BrickAsset | null {
    const budget = modelTextureBudget();
    if (budget) applyTextureBudget(scene, budget);

    scene.updateMatrixWorld(true);
    const geos: BufferGeometry[] = [];
    let material: MeshStandardMaterial | null = null;
    const scratch = new Matrix4();

    scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
        if (mat instanceof MeshStandardMaterial && !material) {
            material = mat.clone();
            if (typeof material.metalness === 'number') material.metalness = Math.min(material.metalness, 0.35);
            material.envMapIntensity = 1.0;
            material.flatShading = false;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -2;
            material.polygonOffsetUnits = -2;
        }
        const geo = dequantizeGeometry(mesh.geometry);
        scratch.copy(mesh.matrixWorld);
        geo.applyMatrix4(scratch);
        geos.push(geo);
    });

    if (geos.length === 0) return null;
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!;
    for (let i = 1; i < geos.length; i++) geos[i]!.dispose();

    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);
    merged.translate(-center.x, -center.y, -center.z);
    const longest = Math.max(size.x, size.y, size.z, 1e-3);
    merged.scale(1 / longest, 1 / longest, 1 / longest);
    merged.computeBoundingBox();
    const box2 = merged.boundingBox!;
    merged.translate(
        -(box2.min.x + box2.max.x) * 0.5,
        -(box2.min.y + box2.max.y) * 0.5,
        -(box2.min.z + box2.max.z) * 0.5,
    );
    merged.computeBoundingBox();
    merged.computeVertexNormals();

    if (!material) {
        material = new MeshStandardMaterial({
            color: 0xa09c92,
            roughness: 0.9,
            metalness: 0.05,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
    }

    const height = Math.max(merged.boundingBox!.max.y - merged.boundingBox!.min.y, 0.05);
    return { geometry: merged, material, height };
}

/** Load shared masonry chip mesh. Safe to call repeatedly. */
export async function preloadDebrisBrick(): Promise<void> {
    if (brickAsset) return;
    if (!brickLoad) {
        brickLoad = (async () => {
            try {
                const gltf = await getGltfLoader().loadAsync(BRICK_URL);
                const prepared = prepareBrickFromScene(gltf.scene);
                if (!prepared) throw new Error('no meshes in brick.glb');
                brickAsset = prepared;
                brickHalfExtentY = prepared.height * 0.5;
                console.info(
                    `[effects] brick.glb ready (${prepared.geometry.getAttribute('position')?.count ?? 0} verts, h=${prepared.height.toFixed(3)})`,
                );
                return prepared;
            } catch (e) {
                console.error('[effects] brick.glb failed — box debris fallback', e);
                return null;
            }
        })();
    }
    await brickLoad;
}

export function getDebrisBrickAsset(): BrickAsset | null {
    return brickAsset;
}

const ROCK_URL = new URL('../../assets/models/rock.glb', import.meta.url).href;

interface RockAsset {
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
    height: number;
}

let rockAsset: RockAsset | null = null;
let rockLoad: Promise<RockAsset | null> | null = null;
/** Half-extent for grounded crow stones; icosahedron radius until rock.glb loads. */
let crowStoneHalfExtentY = CROW_STONE_GEO_R;

/** High/ultra scenery gets rock.glb; medium/low/off keep the cheap icosahedron. */
export function crowRockGlbEnabled(quality: SceneryQuality = prefs().scenery): boolean {
    return quality === 'high' || quality === 'ultra';
}

/** Bake rock.glb to crow-stone size (longest axis ≈ 2× icosahedron radius). */
function prepareRockFromScene(scene: Group): RockAsset | null {
    const budget = modelTextureBudget();
    if (budget) applyTextureBudget(scene, budget);

    scene.updateMatrixWorld(true);
    const geos: BufferGeometry[] = [];
    let material: MeshStandardMaterial | null = null;
    const scratch = new Matrix4();

    scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
        if (mat instanceof MeshStandardMaterial && !material) {
            material = mat.clone();
            if (typeof material.metalness === 'number') material.metalness = Math.min(material.metalness, 0.35);
            material.envMapIntensity = 1.0;
            material.flatShading = false;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -2;
            material.polygonOffsetUnits = -2;
        }
        const geo = dequantizeGeometry(mesh.geometry);
        scratch.copy(mesh.matrixWorld);
        geo.applyMatrix4(scratch);
        geos.push(geo);
    });

    if (geos.length === 0) return null;
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!;
    for (let i = 1; i < geos.length; i++) geos[i]!.dispose();

    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);
    merged.translate(-center.x, -center.y, -center.z);
    const longest = Math.max(size.x, size.y, size.z, 1e-3);
    const target = CROW_STONE_GEO_R * 2;
    const s = target / longest;
    merged.scale(s, s, s);
    merged.computeBoundingBox();
    const box2 = merged.boundingBox!;
    merged.translate(
        -(box2.min.x + box2.max.x) * 0.5,
        -(box2.min.y + box2.max.y) * 0.5,
        -(box2.min.z + box2.max.z) * 0.5,
    );
    merged.computeBoundingBox();
    merged.computeVertexNormals();

    if (!material) {
        material = new MeshStandardMaterial({
            color: THEME.scenery.rock,
            roughness: 0.92,
            metalness: 0.05,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
    }

    const height = Math.max(merged.boundingBox!.max.y - merged.boundingBox!.min.y, 0.05);
    return { geometry: merged, material, height };
}

/** Load crow-rider rock.glb when scenery is high/ultra. Safe to call repeatedly. */
export async function preloadCrowRock(): Promise<void> {
    if (!crowRockGlbEnabled()) return;
    if (rockAsset) return;
    if (!rockLoad) {
        rockLoad = (async () => {
            try {
                const gltf = await getGltfLoader().loadAsync(ROCK_URL);
                const prepared = prepareRockFromScene(gltf.scene);
                if (!prepared) throw new Error('no meshes in rock.glb');
                rockAsset = prepared;
                crowStoneHalfExtentY = prepared.height * 0.5;
                console.info(
                    `[effects] rock.glb ready (${prepared.geometry.getAttribute('position')?.count ?? 0} verts, h=${prepared.height.toFixed(3)})`,
                );
                return prepared;
            } catch (e) {
                console.error('[effects] rock.glb failed — icosahedron crow stones', e);
                return null;
            }
        })();
    }
    await rockLoad;
}

export function getCrowRockAsset(): RockAsset | null {
    return rockAsset;
}

/** pulsing additive magic orb — hot core + cyan rim (visual only) */
function makeOrbMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCore: { value: new Color(0xffffff) },
            uMid: { value: new Color(0xa8f7ff) },
            uGlow: { value: new Color(THEME.projectileOrb) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vPulse;
            uniform float uTime;
            void main() {
                float pulse = 1.0 + 0.12 * sin(uTime * 8.0 + position.x * 4.0);
                vPulse = pulse;
                vec3 pos = position * pulse;
                #ifdef USE_INSTANCING
                mat4 im = instanceMatrix;
                #else
                mat4 im = mat4(1.0);
                #endif
                vec4 world = im * vec4(pos, 1.0);
                vec4 mv = modelViewMatrix * world;
                vNormal = normalize(normalMatrix * mat3(im) * normal);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            varying float vPulse;
            uniform vec3 uCore;
            uniform vec3 uMid;
            uniform vec3 uGlow;
            uniform float uTime;
            void main() {
                float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
                float swirl = 0.5 + 0.5 * sin(uTime * 6.0 + fresnel * 9.0);
                vec3 col = mix(uCore, uMid, fresnel * 0.65 + swirl * 0.2);
                col = mix(col, uGlow, fresnel);
                float alpha = 0.35 + fresnel * 0.75 + 0.1 * swirl;
                gl_FragColor = vec4(col * (1.1 + 0.25 * vPulse), alpha);
            }
        `,
    });
}

/**
 * Visual-only particles — never part of the deterministic sim.
 * Additive sparks for muzzle/explosions; normal-blended blood so hits stay dark.
 */
export class Particles {
    private readonly sparks: ParticlePool;
    private readonly blood: ParticlePool;
    private readonly darkBlood = new Color();

    constructor(scene: Scene) {
        this.sparks = new ParticlePool(scene, AdditiveBlending, 1.4);
        this.blood = new ParticlePool(scene, NormalBlending, 1.2);
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: {
            count: number;
            color: number;
            speed: number;
            life: number;
            up?: number;
            blood?: boolean;
            dir?: { x: number; y: number; z: number };
        },
    ): void {
        if (!opts.blood) {
            this.sparks.burst(x, y, z, opts);
            return;
        }
        // blood volume + energy follow the bloodFx graphics setting (0 = off)
        const scale = bloodParticleScale();
        if (scale <= 0) return;
        const count = Math.max(1, Math.round(opts.count * scale));
        // lower tiers keep blood low, slow and tight; high/ultra fountain
        const energy = bloodIntensityScale();
        // deep, dark gore — the raw hit colors read too bright/pink airborne
        this.darkBlood.setHex(opts.color).multiplyScalar(0.3);
        this.blood.burst(x, y, z, {
            ...opts,
            count,
            color: this.darkBlood.getHex(),
            speed: opts.speed * energy,
            up: (opts.up ?? 2) * energy,
            spread: energy,
        });
    }

    update(dt: number): void {
        this.sparks.update(dt);
        this.blood.update(dt);
    }

    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            switch (e.kind) {
                case 'muzzle':
                    this.burst(e.x, e.y, e.z, { count: 3, color: THEME.muzzle, speed: 5, life: 0.15, up: 1 });
                    break;
                case 'impact': {
                    // spray exits the far side, along the bullet/strike direction
                    const dir = e.dx !== undefined ? { x: e.dx, y: e.dy ?? 0, z: e.dz ?? 0 } : undefined;
                    if (!e.flesh) {
                        if (e.masonry) {
                            // tower-stone dust at the contact — outward from facade, then down
                            let ox = e.cx !== undefined ? e.x - e.cx : -(e.dx ?? 0);
                            let oz = e.cz !== undefined ? e.z - (e.cz ?? 0) : -(e.dz ?? 0);
                            const olen = Math.hypot(ox, oz) || 1;
                            ox /= olen;
                            oz /= olen;
                            const out = { x: ox, y: -0.5, z: oz };
                            this.burst(e.x + ox * 0.2, e.y, e.z + oz * 0.2, {
                                count: 10,
                                color: THEME.scenery.masonry,
                                speed: 5,
                                life: 0.55,
                                up: 0.8,
                                dir: out,
                                blood: true,
                            });
                            this.burst(e.x + ox * 0.2, e.y, e.z + oz * 0.2, {
                                count: 7,
                                color: 0x6a705c,
                                speed: 3,
                                life: 0.7,
                                up: 0.3,
                                dir: out,
                                blood: true,
                            });
                            break;
                        }
                        // towers / ground / shields: gray stone-and-metal debris, not blood
                        const sod = !!e.sod;
                        this.burst(e.x, e.y, e.z, {
                            count: sod ? 16 : 9,
                            color: sod ? 0x8a6a42 : 0x9a938a,
                            speed: sod ? 14 : 11,
                            life: sod ? 0.45 : 0.35,
                            up: sod ? 3.5 : 2,
                            dir,
                        });
                        if (sod) {
                            // pale grit + a few heavier clods kicked along the shot
                            this.burst(e.x, e.y + 0.05, e.z, {
                                count: 10,
                                color: 0xc4b89a,
                                speed: 8,
                                life: 0.55,
                                up: 4,
                                dir,
                                blood: true,
                            });
                            this.burst(e.x, e.y, e.z, {
                                count: 5,
                                color: 0x5c4a30,
                                speed: 6,
                                life: 0.7,
                                up: 2.5,
                                dir,
                                blood: true,
                            });
                        }
                        break;
                    }
                    this.burst(e.x, e.y, e.z, {
                        count: 12,
                        color: e.blood ?? THEME.impact,
                        speed: 11,
                        life: 0.5,
                        up: 2,
                        blood: true,
                        dir,
                    });
                    // a couple of fast gouts that shoot out ahead of the hit
                    this.burst(e.x, e.y, e.z, {
                        count: 4,
                        color: e.blood ?? THEME.impact,
                        speed: 18,
                        life: 0.65,
                        up: 3,
                        blood: true,
                        dir,
                    });
                    break;
                }
                case 'explosion': {
                    // dusty debris / scorched soil — not fire-yellow
                    const s = e.radius / 3;
                    const heavy = e.heavy ? 1.6 : 1;
                    this.burst(e.x, e.y, e.z, {
                        count: Math.round(32 * s * heavy),
                        color: 0x6e6558,
                        speed: 15 * s * heavy,
                        life: 0.5 + (e.heavy ? 0.25 : 0),
                        up: 5 * heavy,
                    });
                    this.burst(e.x, e.y + 0.6, e.z, {
                        count: Math.round(18 * s * heavy),
                        color: 0x4a4338,
                        speed: 9 * s * heavy,
                        life: 0.7 + (e.heavy ? 0.3 : 0),
                        up: 7 * heavy,
                    });
                    this.burst(e.x, e.y, e.z, {
                        count: Math.round(10 * heavy),
                        color: 0x9a8f7a,
                        speed: 4 * heavy,
                        life: 0.4,
                        up: 3,
                    });
                    if (e.heavy) {
                        // extra dust ring for divine stamps
                        this.burst(e.x, e.y + 0.2, e.z, {
                            count: 40,
                            color: 0xb8a888,
                            speed: 22,
                            life: 0.85,
                            up: 3,
                        });
                    }
                    if (e.fire) {
                        // the dust above is deliberately cold; a burning rock
                        // needs a hot core FIRST (short + bright, additive
                        // sparks pool), then embers riding the dust up
                        this.burst(e.x, e.y + 0.4, e.z, {
                            count: Math.round(26 * s),
                            color: 0xfff0c0,
                            speed: 26 * s,
                            life: 0.16,
                            up: 4,
                        });
                        this.burst(e.x, e.y + 0.5, e.z, {
                            count: Math.round(34 * s),
                            color: 0xff9a3c,
                            speed: 19 * s,
                            life: 0.4,
                            up: 9,
                        });
                        this.burst(e.x, e.y + 0.8, e.z, {
                            count: Math.round(20 * s),
                            color: 0xd8431a,
                            speed: 11 * s,
                            life: 0.85,
                            up: 14,
                        });
                    }
                    if (e.shake) {
                        // heavier + longer than a unit hit, but well under the
                        // post-battle HP-draw kicks (see tickHpDraw)
                        screenShake({
                            intensity: 0.5 * e.shake,
                            duration: 0.5,
                            frequency: 46,
                        });
                    }
                    break;
                }
                case 'summon':
                    if (e.flying) {
                        // wind gust + feathers as the rider dives in
                        this.burst(e.x, e.y + 1.5, e.z, { count: 8, color: 0xd8dde6, speed: 4, life: 0.5, up: 1 });
                        this.burst(e.x, e.y, e.z, { count: 5, color: 0xf2f0e8, speed: 2.5, life: 0.6, up: 2 });
                    } else {
                        // soil bursting open as the mech climbs out
                        this.burst(e.x, e.y + 0.3, e.z, { count: 12, color: 0x8a6a42, speed: 5, life: 0.55, up: 7 });
                        this.burst(e.x, e.y + 0.1, e.z, { count: 8, color: 0x5c4a30, speed: 3, life: 0.7, up: 5, blood: true });
                    }
                    break;
                case 'death':
                    if (e.wear === 'ash') {
                        if (e.structure) {
                            // tower-stone dust — solid masonry rain is StoneChipRenderer
                            this.burst(e.x, e.y, e.z, {
                                count: 40,
                                color: THEME.scenery.masonry,
                                speed: 12,
                                life: 1.1,
                                up: 6,
                                blood: true,
                            });
                            this.burst(e.x, e.y + 1.0, e.z, {
                                count: 28,
                                color: 0x6a705c,
                                speed: 7,
                                life: 1.3,
                                up: 8,
                                blood: true,
                            });
                            screenShake({
                                intensity: 0.85,
                                duration: 0.55,
                                frequency: 36,
                            });
                        } else {
                            // dark ash / debris — not blood
                            this.burst(e.x, e.y, e.z, {
                                count: e.big ? 36 : 18,
                                color: THEME.scenery.masonry,
                                speed: e.big ? 14 : 10,
                                life: 0.8,
                                up: 5,
                                blood: true,
                            });
                            this.burst(e.x, e.y + 0.8, e.z, {
                                count: e.big ? 16 : 8,
                                color: 0x6a705c,
                                speed: 7,
                                life: 0.55,
                                up: 6,
                                blood: true,
                            });
                        }
                    } else if (e.wear === 'none') {
                        break;
                    } else {
                        // gore jets along the killing-blow direction (from knockback)
                        const kill = e.dx !== undefined ? { x: e.dx, y: 0.15, z: e.dz ?? 0 } : undefined;
                        // A flung death (a keep's collapse) throws the omni cloud
                        // down the blow as well, so nothing fountains straight up:
                        // faster, flatter and living longer, so it travels.
                        const fling = e.fling ?? 1;
                        const thrown = fling > 1;
                        const omniDir = thrown ? kill : undefined;
                        const rise = (base: number) => (thrown ? base * 0.35 : base);
                        const far = (base: number) => (thrown ? base * fling : base);
                        const linger = (base: number) => (thrown ? base * 1.7 : base);
                        if (e.big) {
                            // massive gib burst — an omni cloud + a jet down the blow
                            this.burst(e.x, e.y, e.z, {
                                count: 56,
                                color: e.blood ?? THEME.death,
                                speed: far(22),
                                life: linger(1.2),
                                up: rise(5),
                                blood: true,
                                dir: omniDir,
                            });
                            this.burst(e.x, e.y + 1, e.z, {
                                count: 40,
                                color: e.blood != null ? lightenBlood(e.blood) : THEME.deathSecondary,
                                speed: far(16),
                                life: linger(0.95),
                                up: rise(5),
                                blood: true,
                                dir: kill,
                            });
                        } else {
                            // omni spurt + a directional gout down the blow
                            this.burst(e.x, e.y, e.z, {
                                count: 18,
                                color: e.blood ?? THEME.deathSmall,
                                speed: far(15),
                                life: linger(0.75),
                                up: rise(3),
                                blood: true,
                                dir: omniDir,
                            });
                            this.burst(e.x, e.y + 0.4, e.z, {
                                count: 14,
                                color: e.blood ?? THEME.deathSmall,
                                speed: far(14),
                                life: linger(0.85),
                                up: rise(3),
                                blood: true,
                                dir: kill,
                            });
                        }
                    }
                    break;
                case 'levelup':
                    this.burst(e.x, e.y, e.z, { count: 10, color: THEME.levelup, speed: 4, life: 0.6, up: 9 });
                    break;
            }
        }
    }
}

/**
 * Soft round sprite for point particles — a radial alpha falloff so blood /
 * sparks render as droplets and glows instead of hard GL-point squares.
 * Built once, shared across pools.
 */
let particleSprite: Texture | null = null;
export function particleTexture(): Texture {
    if (particleSprite) return particleSprite;
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    // soft, mist-like falloff — no hard rim
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    particleSprite = new CanvasTexture(canvas);
    return particleSprite;
}

export type SoftParticlePoolOptions = {
    blending: typeof AdditiveBlending | typeof NormalBlending;
    size: number;
    /** default false — forge chimney sparks opt in so tree billboards don't overpaint */
    depthWrite?: boolean;
    depthTest?: boolean;
    renderOrder?: number;
    /** fragment alpha multiplier (normal-blended smoke) */
    opacity?: number;
    maxParticles?: number;
    /** default {@link GRAVITY} — forge chimney uses 0 so sparks don't rain down */
    gravity?: number;
    /** how much particles grow while fading (0 = constant size) */
    sizeGrowth?: number;
    /** spawn at this fraction of base size, ramp to full over {@link sizeBirthPhase} (default 1) */
    sizeBirthScale?: number;
    /** fraction of lifetime spent growing from {@link sizeBirthScale} → full base size (default 0) */
    sizeBirthPhase?: number;
    /** opacity stays 1 until life ratio drops below this, then fades out (default 0.35) */
    fadeStart?: number;
    /** horizontal + vertical velocity damping per second (default 2.2) */
    drag?: number;
    /** widen horizontal drift as particles age — chimney smoke billows outward (default 0) */
    billow?: number;
    /** extra horizontal velocity damping per second — keeps chimney plumes vertical (default 0) */
    lateralDrag?: number;
    /** clamp horizontal speed — prevents runaway sideways drift (default: no cap) */
    maxLateralSpeed?: number;
    /** gentle left/right push while fading out (default 0) */
    dissolveSpread?: number;
};

/** Soft-sprite point pool — shared by battle particles and forge chimney FX. */
export class SoftParticlePool {
    private readonly maxParticles: number;
    private readonly positions: Float32Array;
    /** per-particle tint (lerps start → end over lifetime) */
    private readonly aColor: Float32Array;
    private readonly startColors: Float32Array;
    private readonly endColors: Float32Array;
    /** per-particle current point size (grows as it dissipates) */
    private readonly aSize: Float32Array;
    /** per-particle current alpha (fades over life) */
    private readonly aOpacity: Float32Array;
    private readonly velocities: Float32Array;
    /** per-particle spawn size, before the over-life growth */
    private readonly baseSizes: Float32Array;
    private readonly life: Float32Array;
    private readonly maxLife: Float32Array;
    private readonly geometry = new BufferGeometry();
    private cursor = 0;
    private readonly tmpColor = new Color();
    /** pool-wide size scalar (blood is smaller/wetter, sparks larger/glowy) */
    private readonly size: number;
    private readonly gravity: number;
    private readonly sizeGrowth: number;
    private readonly sizeBirthScale: number;
    private readonly sizeBirthPhase: number;
    private readonly fadeStart: number;
    private readonly drag: number;
    private readonly billow: number;
    private readonly lateralDrag: number;
    private readonly maxLateralSpeed: number;
    private readonly dissolveSpread: number;
    private readonly spreadDirX: Float32Array | null;
    private readonly spreadDirZ: Float32Array | null;

    constructor(scene: Scene, opts: SoftParticlePoolOptions) {
        this.maxParticles = opts.maxParticles ?? MAX_PARTICLES;
        this.size = opts.size;
        this.gravity = opts.gravity ?? GRAVITY;
        this.sizeGrowth = opts.sizeGrowth ?? 0.4;
        this.sizeBirthScale = opts.sizeBirthScale ?? 1;
        this.sizeBirthPhase = opts.sizeBirthPhase ?? 0;
        this.fadeStart = opts.fadeStart ?? 0.35;
        this.drag = opts.drag ?? 2.2;
        this.billow = opts.billow ?? 0;
        this.lateralDrag = opts.lateralDrag ?? 0;
        this.maxLateralSpeed = opts.maxLateralSpeed ?? 0;
        this.dissolveSpread = opts.dissolveSpread ?? 0;
        if (this.dissolveSpread > 0) {
            this.spreadDirX = new Float32Array(this.maxParticles);
            this.spreadDirZ = new Float32Array(this.maxParticles);
        } else {
            this.spreadDirX = null;
            this.spreadDirZ = null;
        }
        this.positions = new Float32Array(this.maxParticles * 3);
        this.aColor = new Float32Array(this.maxParticles * 3);
        this.startColors = new Float32Array(this.maxParticles * 3);
        this.endColors = new Float32Array(this.maxParticles * 3);
        this.aSize = new Float32Array(this.maxParticles);
        this.aOpacity = new Float32Array(this.maxParticles);
        this.velocities = new Float32Array(this.maxParticles * 3);
        this.baseSizes = new Float32Array(this.maxParticles);
        this.life = new Float32Array(this.maxParticles);
        this.maxLife = new Float32Array(this.maxParticles);
        this.positions.fill(0);
        this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aColor', new BufferAttribute(this.aColor, 3).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aSize', new BufferAttribute(this.aSize, 1).setUsage(DynamicDrawUsage));
        this.geometry.setAttribute('aOpacity', new BufferAttribute(this.aOpacity, 1).setUsage(DynamicDrawUsage));
        const depthWrite = opts.depthWrite ?? false;
        const depthTest = opts.depthTest ?? true;
        const renderOrder = opts.renderOrder ?? 0;
        const poolOpacity = opts.opacity ?? (opts.blending === NormalBlending ? 0.95 : 1);
        // per-particle size + opacity need a custom shader (PointsMaterial has
        // one global size only). Soft sprite → round mist; sizeAttenuation via
        // uScale = drawing-buffer height * 0.5 (matches three's point scaling).
        const material = new ShaderMaterial({
            uniforms: {
                uMap: { value: particleTexture() },
                uScale: { value: 400 },
                uOpacity: { value: poolOpacity },
            },
            transparent: true,
            depthWrite,
            depthTest,
            blending: opts.blending,
            fog: false,
            vertexShader: /* glsl */ `
                attribute vec3 aColor;
                attribute float aSize;
                attribute float aOpacity;
                uniform float uScale;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    vColor = aColor;
                    vOpacity = aOpacity;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * (uScale / -mv.z);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uOpacity;
                varying vec3 vColor;
                varying float vOpacity;
                void main() {
                    float a = texture2D(uMap, gl_PointCoord).a;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(vColor, a * vOpacity * uOpacity);
                }
            `,
        });
        const points = new Points(this.geometry, material);
        points.frustumCulled = false;
        points.renderOrder = renderOrder;
        const bufSize = new Vector2();
        points.onBeforeRender = (renderer) => {
            renderer.getDrawingBufferSize(bufSize);
            material.uniforms.uScale!.value = bufSize.y * 0.5;
        };
        scene.add(points);
        for (let i = 0; i < this.maxParticles; i++) this.positions[i * 3 + 1] = -9999;
    }

    burst(
        x: number,
        y: number,
        z: number,
        opts: {
            count: number;
            color: number;
            speed: number;
            life: number;
            up?: number;
            /** normalized jet direction — spray forms a cone around it (e.g. bullet exit) */
            dir?: { x: number; y: number; z: number };
            /** 0..1 multiplier on the random (perpendicular) spread; default 1 */
            spread?: number;
            /** tint at end of life — smoke darkens → lightens as it cools (default: same as color) */
            colorEnd?: number;
        },
    ): void {
        this.tmpColor.setHex(opts.color);
        const endHex = opts.colorEnd ?? opts.color;
        const endColor = this.tmpColor.clone().setHex(endHex);
        const dir = opts.dir;
        const spread = opts.spread ?? 1;
        for (let n = 0; n < opts.count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % this.maxParticles;
            const angle = Math.random() * Math.PI * 2;
            const pitch = Math.random() * Math.PI - Math.PI / 2;
            const speed = opts.speed * (0.4 + Math.random() * 0.6);
            const rx = Math.cos(angle) * Math.cos(pitch);
            const ry = Math.abs(Math.sin(pitch));
            const rz = Math.sin(angle) * Math.cos(pitch);
            this.positions[i * 3] = x;
            this.positions[i * 3 + 1] = y;
            this.positions[i * 3 + 2] = z;
            if (dir) {
                // jet along the hit direction (dominant) with a tight random cone
                this.velocities[i * 3] = (dir.x * 1.5 + rx * 0.32 * spread) * speed;
                this.velocities[i * 3 + 1] = (dir.y * 1.5 + ry * 0.32 * spread) * speed + (opts.up ?? 1);
                this.velocities[i * 3 + 2] = (dir.z * 1.5 + rz * 0.32 * spread) * speed;
            } else {
                this.velocities[i * 3] = rx * speed * spread;
                this.velocities[i * 3 + 1] = ry * speed + (opts.up ?? 2);
                this.velocities[i * 3 + 2] = rz * speed * spread;
            }
            this.startColors[i * 3] = this.tmpColor.r;
            this.startColors[i * 3 + 1] = this.tmpColor.g;
            this.startColors[i * 3 + 2] = this.tmpColor.b;
            this.endColors[i * 3] = endColor.r;
            this.endColors[i * 3 + 1] = endColor.g;
            this.endColors[i * 3 + 2] = endColor.b;
            this.aColor[i * 3] = this.tmpColor.r;
            this.aColor[i * 3 + 1] = this.tmpColor.g;
            this.aColor[i * 3 + 2] = this.tmpColor.b;
            // mixed droplet sizes — a few fat splats, many fine mist specks
            this.baseSizes[i] = this.size * (0.4 + Math.random() * Math.random() * 1.5);
            const birthMul = this.sizeBirthPhase > 0 ? this.sizeBirthScale : 1;
            this.aSize[i] = this.baseSizes[i]! * birthMul;
            this.aOpacity[i] = 1;
            this.life[i] = opts.life * (0.6 + Math.random() * 0.4);
            this.maxLife[i] = this.life[i]!;
            if (this.spreadDirX && this.spreadDirZ) {
                const a = Math.random() * Math.PI * 2;
                this.spreadDirX[i] = Math.cos(a);
                this.spreadDirZ[i] = Math.sin(a);
            }
        }
    }

    update(dt: number): void {
        const vDrag = Math.max(0, 1 - dt * this.drag);
        const hDrag = Math.max(0, 1 - dt * (this.drag + this.lateralDrag));
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.life[i]! <= 0) continue;
            this.life[i]! -= dt;
            if (this.life[i]! <= 0) {
                this.positions[i * 3 + 1] = -9999;
                this.aOpacity[i] = 0;
                continue;
            }
            this.velocities[i * 3]! *= hDrag;
            this.velocities[i * 3 + 2]! *= hDrag;
            this.velocities[i * 3 + 1]! *= vDrag;
            const fade = this.life[i]! / this.maxLife[i]!;
            const age = 1 - fade;
            /** cap growth/spread before dissolve — fade is opacity-only at the end */
            const growAge = Math.min(age, 1 - this.fadeStart);
            if (this.billow > 0) {
                const expand = 1 + dt * this.billow * growAge;
                this.velocities[i * 3]! *= expand;
                this.velocities[i * 3 + 2]! *= expand;
            }
            this.velocities[i * 3 + 1]! += this.gravity * dt;
            if (this.gravity >= 0 && this.velocities[i * 3 + 1]! < 0) {
                this.velocities[i * 3 + 1] = 0;
            }
            const dissolving = fade < this.fadeStart;
            if (dissolving && this.dissolveSpread > 0 && this.spreadDirX && this.spreadDirZ) {
                const t = 1 - fade / this.fadeStart;
                const push = dt * this.dissolveSpread * t;
                this.velocities[i * 3]! += this.spreadDirX[i]! * push;
                this.velocities[i * 3 + 2]! += this.spreadDirZ[i]! * push;
            } else if (dissolving) {
                const settle = Math.max(0, 1 - dt * 6);
                this.velocities[i * 3]! *= settle;
                this.velocities[i * 3 + 2]! *= settle;
            }
            if (this.maxLateralSpeed > 0) {
                const vx = this.velocities[i * 3]!;
                const vz = this.velocities[i * 3 + 2]!;
                const hSpeed = Math.hypot(vx, vz);
                const cap =
                    dissolving && this.dissolveSpread > 0
                        ? this.maxLateralSpeed * 1.75
                        : this.maxLateralSpeed;
                if (hSpeed > cap) {
                    const s = cap / hSpeed;
                    this.velocities[i * 3] = vx * s;
                    this.velocities[i * 3 + 2] = vz * s;
                }
            }
            this.positions[i * 3]! += this.velocities[i * 3]! * dt;
            this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
            this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
            // soft floor only for near-zero spawns — don't yank hill-anchored flames to y≈0
            if (this.positions[i * 3 + 1]! < -50) this.positions[i * 3 + 1] = -50;
            // stay fully opaque through most of life, fade out only near the end
            this.aOpacity[i] = Math.min(1, fade / this.fadeStart);
            let sizeMul: number;
            if (this.sizeBirthPhase > 0 && growAge < this.sizeBirthPhase) {
                const t = growAge / this.sizeBirthPhase;
                sizeMul = this.sizeBirthScale + (1 - this.sizeBirthScale) * t;
            } else {
                const billowT =
                    this.sizeBirthPhase > 0
                        ? (growAge - this.sizeBirthPhase) / (1 - this.sizeBirthPhase)
                        : growAge;
                sizeMul = 1 + billowT * this.sizeGrowth;
            }
            this.aSize[i] = this.baseSizes[i]! * sizeMul;
            this.aColor[i * 3] =
                this.startColors[i * 3]! +
                (this.endColors[i * 3]! - this.startColors[i * 3]!) * age;
            this.aColor[i * 3 + 1] =
                this.startColors[i * 3 + 1]! +
                (this.endColors[i * 3 + 1]! - this.startColors[i * 3 + 1]!) * age;
            this.aColor[i * 3 + 2] =
                this.startColors[i * 3 + 2]! +
                (this.endColors[i * 3 + 2]! - this.startColors[i * 3 + 2]!) * age;
        }
        this.geometry.attributes.position!.needsUpdate = true;
        this.geometry.attributes.aColor!.needsUpdate = true;
        this.geometry.attributes.aSize!.needsUpdate = true;
        this.geometry.attributes.aOpacity!.needsUpdate = true;
    }
}

/** @deprecated internal alias */
class ParticlePool extends SoftParticlePool {
    constructor(scene: Scene, blending: typeof AdditiveBlending | typeof NormalBlending, size: number) {
        super(scene, { blending, size });
    }
}

const MAX_STUCK_BOLTS = 128;
/** How far before the hitbox contact we start the visual-seat ray. */
const STUCK_SEAT_BACK = 10;
/** Max travel past the backtracked origin when hunting for mesh. */
const STUCK_SEAT_FAR = 28;

type StuckSlot = {
    /** Local to {@link attach}, or world matrix when unattached (dirt). */
    local: Matrix4;
    attach: Object3D | null;
};

export type StuckAttachRef = {
    mesh: Object3D;
    /** model id for shared instance geo / visual bbox */
    modelId: string;
    /** Buildings: seat on facade (no torso pull). Units: prefer body over wings. */
    structure?: boolean;
};

const _seatRay = new Raycaster();
const _seatProbe = new Mesh(
    undefined,
    new MeshBasicMaterial({ side: DoubleSide }),
);
const _seatHits: Intersection[] = [];
const _seatOrigin = new Vector3();
const _seatDir = new Vector3();
const _seatLocalO = new Vector3();
const _seatLocalD = new Vector3();
const _seatInv = new Matrix4();
const _seatBox = new Box3();
const _seatBoxHit = new Vector3();
const _seatRayLocal = new Ray();
const _seatCenter = new Vector3();
const _seatPull = new Vector3();

/** Torso-ish radius in world units — ignores wingspan so crow bolts don't sit on wing AABB. */
function stuckBodyRadius(modelId: string, attach: Object3D): number {
    const h = getUnitVisualHeight(modelId);
    const hw = getUnitVisualHalfWidth(modelId) || h * 0.35;
    // Local visual extents × mesh scale (proxy scale is usually uniform meshScale)
    const sx = Math.abs(attach.scale.x) || 1;
    const worldH = h * sx;
    const worldHw = hw * sx;
    // Prefer height-based torso; cap so wide flyers don't use full wingspan
    return Math.max(0.45, Math.min(worldH * 0.38, worldHw * 0.38, worldH * 0.55));
}

/**
 * First useful visual surface along the shot.
 * - Units (`torso`): prefer hits near body center so wing tips lose.
 * - Structures (`facade`): first surface wins — walls/towers need full footprint.
 */
function visualSeatDistance(
    attach: Object3D,
    modelId: string,
    origin: Vector3,
    dir: Vector3,
    far: number,
    bodyR: number,
    center: Vector3,
    mode: 'torso' | 'facade',
): number | null {
    _seatRay.ray.origin.copy(origin);
    _seatRay.ray.direction.copy(dir);
    _seatRay.near = 0;
    _seatRay.far = far;

    let bestDist = Infinity;
    let bestScore = Infinity;

    const consider = (distance: number, point: Vector3) => {
        if (distance <= 1e-4 || distance > far) return;
        if (mode === 'facade') {
            if (distance < bestDist) bestDist = distance;
            return;
        }
        const dCenter = point.distanceTo(center);
        // In-body hits ranked by ray distance; outside body heavily penalized
        const score = dCenter <= bodyR * 1.05 ? distance : distance + (dCenter - bodyR) * 8;
        if (score < bestScore) {
            bestScore = score;
            bestDist = distance;
        }
    };

    const asset = getUnitInstanceAsset(modelId);
    if (asset) {
        attach.updateMatrixWorld(true);
        for (const part of asset.parts) {
            _seatHits.length = 0;
            _seatProbe.geometry = part.geometry;
            _seatProbe.matrixWorld.copy(attach.matrixWorld);
            _seatProbe.raycast(_seatRay, _seatHits);
            for (const h of _seatHits) {
                if (h.point) consider(h.distance, h.point);
            }
        }
        if (bestDist < Infinity) return bestDist;
    } else if (attach.children.length > 0) {
        const hits = _seatRay.intersectObject(attach, true);
        for (const h of hits) {
            if (h.point) consider(h.distance, h.point);
        }
        if (bestDist < Infinity) return bestDist;
    }

    // AABB fallback — full visual box for buildings; tight torso for units
    const h = getUnitVisualHeight(modelId);
    if (h <= 0.05) return null;
    const hw = getUnitVisualHalfWidth(modelId) || h * 0.35;
    if (mode === 'facade') {
        _seatBox.min.set(-hw, 0, -hw);
        _seatBox.max.set(hw, h, hw);
    } else {
        const bodyHw = Math.min(h * 0.4, hw * 0.4);
        _seatBox.min.set(-bodyHw, h * 0.12, -bodyHw);
        _seatBox.max.set(bodyHw, h * 0.88, bodyHw);
    }
    _seatInv.copy(attach.matrixWorld).invert();
    _seatLocalO.copy(origin).applyMatrix4(_seatInv);
    _seatLocalD.copy(dir).transformDirection(_seatInv).normalize();
    _seatRayLocal.origin.copy(_seatLocalO);
    _seatRayLocal.direction.copy(_seatLocalD);
    if (!_seatRayLocal.intersectBox(_seatBox, _seatBoxHit)) return null;
    _seatBoxHit.applyMatrix4(attach.matrixWorld);
    const dist = origin.distanceTo(_seatBoxHit);
    return dist > 1e-4 && dist <= far ? dist : null;
}

/**
 * World point for the bolt *center*: follow the shot from before the hitbox
 * contact until a visual intersection (then a tiny dig-in).
 * Units pull wingtip seats onto the torso; structures keep facade hits as-is.
 */
function seatStuckBoltCenter(
    hitX: number,
    hitY: number,
    hitZ: number,
    dir: Vector3,
    attach: Object3D | null,
    modelId: string | undefined,
    dig: number,
    structure = false,
): void {
    // Result written to `_seatOrigin` for the caller to copy.
    if (!attach || !modelId) {
        _seatOrigin.set(hitX, hitY, hitZ).addScaledVector(dir, dig);
        return;
    }
    attach.updateMatrixWorld(true);
    const h = getUnitVisualHeight(modelId);
    _seatDir.copy(dir);
    _seatOrigin.set(hitX, hitY, hitZ).addScaledVector(_seatDir, -STUCK_SEAT_BACK);

    if (structure) {
        // Buildings: first facade / full AABB along the shot (pre-crow torso logic).
        const t = visualSeatDistance(
            attach,
            modelId,
            _seatOrigin,
            _seatDir,
            STUCK_SEAT_FAR,
            0,
            _seatCenter,
            'facade',
        );
        if (t != null) {
            _seatOrigin.addScaledVector(_seatDir, t + dig);
        } else {
            _seatOrigin.set(0, Math.max(0.2, h * 0.5), 0).applyMatrix4(attach.matrixWorld);
        }
        return;
    }

    _seatCenter.set(0, Math.max(0.25, h * 0.48), 0).applyMatrix4(attach.matrixWorld);
    const bodyR = stuckBodyRadius(modelId, attach);
    const t = visualSeatDistance(
        attach,
        modelId,
        _seatOrigin,
        _seatDir,
        STUCK_SEAT_FAR,
        bodyR,
        _seatCenter,
        'torso',
    );
    if (t != null) {
        _seatOrigin.addScaledVector(_seatDir, t + dig);
    } else {
        // No surface along the shot — plant on the near side of the torso
        _seatOrigin.copy(_seatCenter).addScaledVector(_seatDir, -(bodyR * 0.72));
    }

    // Pull wingtip / oversized-hitbox seats onto the torso shell
    _seatPull.copy(_seatOrigin).sub(_seatCenter);
    const dist = _seatPull.length();
    if (dist > bodyR * 1.05) {
        if (dist < 1e-6) _seatPull.copy(_seatDir).multiplyScalar(-1);
        else _seatPull.multiplyScalar(1 / dist);
        _seatOrigin.copy(_seatCenter).addScaledVector(_seatPull, bodyR * 0.78);
    }
}

/**
 * Tiny crow-rider-style rock chips kicked off masonry hits.
 * Same icosahedron + rock material language as thrown stones, just smaller.
 */
const MAX_STONE_CHIPS = 640;
const CHIP_GRAVITY = 38;
/** How long hit chips sit after landing (~5× prior brief rest). */
const HIT_GROUND_LINGER = 1.35 * 5;
/** Crow-rider thrown stone resting on the lawn after impact. */
const CROW_STONE_LINGER = 2.4;
/** Base collapse masonry rest on medium (~10s after landing). */
const COLLAPSE_GROUND_LINGER = 2.1 * 5;

/** Lift so the stone rests on the lawn instead of intersecting it (z-fight). */
const BRICK_GEO_H = 0.48; // BoxGeometry fallback height — used for rest offset
function chipRestY(terrainY: number, scaleY: number, shape: 'round' | 'brick'): number {
    const half = shape === 'brick' ? brickHalfExtentY : crowStoneHalfExtentY;
    return terrainY + half * scaleY * 0.85;
}

/**
 * Medium: timed rest. High: linger forever until {@link StoneChipRenderer.clear}
 * (called at round start). Low: shorter timed rest.
 */
function collapseGroundLinger(): number {
    const q = prefs().groundEffects;
    if (q === 'high') return Number.POSITIVE_INFINITY;
    if (q === 'medium') return COLLAPSE_GROUND_LINGER;
    return COLLAPSE_GROUND_LINGER * 0.55;
}

type StoneChip = {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    /** Counts down only after landing; Infinity = keep until round clear. */
    life: number;
    landed: boolean;
    /** Fully at rest — skip motion so matrices stay stable (no ground z-fight flicker). */
    settled: boolean;
    shape: 'round' | 'brick';
    /** Uniform (round) or brick axis scales. */
    sx: number;
    sy: number;
    sz: number;
    rx: number;
    ry: number;
    rz: number;
    spinX: number;
    spinY: number;
    spinZ: number;
    groundY: number;
    groundLinger: number;
    /** Stable tint 0..1 — not derived from array index (avoids color pop on evict). */
    shade: number;
};

/** Untinted white — brick.glb albedo carries color; instance shade adds variety. */
const BRICK_COLOR = 0xffffff;

export class StoneChipRenderer {
    private readonly roundMesh: InstancedMesh;
    private readonly brickMesh: InstancedMesh;
    private readonly sharedBrickGeo: BufferGeometry | null;
    private readonly sharedBrickMat: MeshStandardMaterial | null;
    private readonly sharedRockGeo: BufferGeometry | null;
    private readonly sharedRockMat: MeshStandardMaterial | null;
    private readonly matrix = new Matrix4();
    private readonly pos = new Vector3();
    private readonly quat = new Quaternion();
    private readonly scale = new Vector3();
    private readonly euler = new Euler();
    private readonly chips: StoneChip[] = [];
    private readonly tmpColor = new Color();
    private readonly roundBaseColor: number;

    constructor(scene: Scene) {
        const mkMat = (hex: number, flat: boolean) =>
            new MeshLambertMaterial({
                color: hex,
                flatShading: flat,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
            });
        const rock = rockAsset;
        this.sharedRockGeo = rock?.geometry ?? null;
        this.sharedRockMat = rock?.material ?? null;
        if (rock) crowStoneHalfExtentY = rock.height * 0.5;
        this.roundBaseColor = rock ? 0xffffff : THEME.scenery.rock;
        const roundGeo = rock?.geometry ?? getCrowStoneGeometry();
        const roundMat = rock?.material ?? mkMat(THEME.scenery.rock, false);
        this.roundMesh = new InstancedMesh(roundGeo, roundMat, MAX_STONE_CHIPS);
        const brick = brickAsset;
        this.sharedBrickGeo = brick?.geometry ?? null;
        this.sharedBrickMat = brick?.material ?? null;
        if (brick) brickHalfExtentY = brick.height * 0.5;
        const brickGeo = brick?.geometry ?? new BoxGeometry(1.15, BRICK_GEO_H, 0.7);
        const brickMat =
            brick?.material ??
            new MeshLambertMaterial({
                color: 0xa09c92,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
            });
        this.brickMesh = new InstancedMesh(brickGeo, brickMat, MAX_STONE_CHIPS);
        for (const mesh of [this.roundMesh, this.brickMesh]) {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.count = 0;
            mesh.renderOrder = 1;
            scene.add(mesh);
        }
    }

    spawnFromEvents(
        events: readonly SimEvent[],
        groundHeightAt: (x: number, z: number) => number,
    ): void {
        for (const e of events) {
            if (e.kind !== 'impact' && !(e.kind === 'death' && e.structure)) continue;
            if (e.kind === 'impact' && e.masonry) this.spawnHitChips(e, groundHeightAt);
            if (e.kind === 'impact' && e.dropStone) this.spawnCrowStone(e, groundHeightAt);
            if (e.kind === 'death' && e.structure) this.spawnCollapseChips(e, groundHeightAt);
        }
    }

    /** Facade chips kicked off a single hit — small gray bricks. */
    private spawnHitChips(
        e: Extract<SimEvent, { kind: 'impact' }>,
        groundHeightAt: (x: number, z: number) => number,
    ): void {
        let ox = e.cx !== undefined ? e.x - e.cx : -(e.dx ?? 0);
        let oz = e.cz !== undefined ? e.z - (e.cz ?? 0) : -(e.dz ?? 0);
        const olen = Math.hypot(ox, oz);
        if (olen < 1e-4) {
            const hx = -(e.dx ?? 0);
            const hz = -(e.dz ?? 0);
            const hlen = Math.hypot(hx, hz);
            if (hlen > 1e-4) {
                ox = hx / hlen;
                oz = hz / hlen;
            } else {
                ox = 1;
                oz = 0;
            }
        } else {
            ox /= olen;
            oz /= olen;
        }
        const sx0 = e.x + ox * 0.35;
        const sy0 = e.y;
        const sz0 = e.z + oz * 0.35;
        const n = 3 + ((Math.abs(Math.sin(e.x * 12.9898 + e.z * 78.233)) * 2) | 0);
        for (let i = 0; i < n; i++) {
            const side = (Math.random() * 2 - 1) * 0.55;
            const tx = -oz * side + ox * (0.4 + Math.random() * 0.7);
            const tz = ox * side + oz * (0.4 + Math.random() * 0.7);
            const outSpeed = 2.2 + Math.random() * 3.5;
            const px = sx0 + (Math.random() * 2 - 1) * 0.2;
            const pz = sz0 + (Math.random() * 2 - 1) * 0.2;
            const s = 0.28 + Math.random() * 0.4;
            this.pushChip({
                shape: 'brick',
                x: px,
                y: sy0 + (Math.random() * 2 - 1) * 0.15,
                z: pz,
                vx: tx * outSpeed,
                vy: 0.2 + Math.random() * 1.4,
                vz: tz * outSpeed,
                sx: s * (0.9 + Math.random() * 0.5),
                sy: s * (0.75 + Math.random() * 0.4),
                sz: s * (0.85 + Math.random() * 0.45),
                groundY: groundHeightAt(px, pz),
                groundLinger: HIT_GROUND_LINGER * (0.85 + Math.random() * 0.3),
            });
        }
    }

    /** Crow-rider projectile — same round rock, short rest on the lawn. */
    private spawnCrowStone(
        e: Extract<SimEvent, { kind: 'impact' }>,
        groundHeightAt: (x: number, z: number) => number,
    ): void {
        const terrain = groundHeightAt(e.x, e.z);
        const s = 0.92 + Math.random() * 0.16;
        const dx = e.dx ?? 0;
        const dz = e.dz ?? 0;
        const hlen = Math.hypot(dx, dz) || 1;
        this.pushChip({
            shape: 'round',
            x: e.x,
            y: Math.max(e.y, chipRestY(terrain, s, 'round') + 0.4),
            z: e.z,
            vx: (dx / hlen) * (1.2 + Math.random() * 2) + (Math.random() * 2 - 1) * 0.8,
            vy: 1.5 + Math.random() * 2.5,
            vz: (dz / hlen) * (1.2 + Math.random() * 2) + (Math.random() * 2 - 1) * 0.8,
            sx: s,
            sy: s,
            sz: s,
            groundY: terrain,
            groundLinger: CROW_STONE_LINGER * (0.85 + Math.random() * 0.35),
        });
    }

    /** Collapse rubble — gray rectangular masonry blocks. */
    private spawnCollapseChips(
        e: Extract<SimEvent, { kind: 'death' }>,
        groundHeightAt: (x: number, z: number) => number,
    ): void {
        const terrain0 = groundHeightAt(e.x, e.z);
        const height = Math.max(3, e.structureHeight ?? e.y - terrain0 + 1.5);
        const radius = Math.max(1.4, e.structureRadius ?? 2.2);
        const n = 52 + Math.min(28, Math.round(height * 2.5));
        for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius * 0.95;
            const px = e.x + Math.cos(ang) * r;
            const pz = e.z + Math.sin(ang) * r;
            const terrain = groundHeightAt(px, pz);
            const py = terrain + height * (0.2 + Math.random() * 0.85);
            const out = 1.5 + Math.random() * 5.5;
            const s = 0.7 + Math.random() * 1.1;
            this.pushChip({
                shape: 'brick',
                x: px,
                y: py,
                z: pz,
                vx: Math.cos(ang) * out * (0.35 + Math.random()),
                vy: -1 + Math.random() * 3.5,
                vz: Math.sin(ang) * out * (0.35 + Math.random()),
                sx: s * (0.95 + Math.random() * 0.55),
                sy: s * (0.65 + Math.random() * 0.45),
                sz: s * (0.8 + Math.random() * 0.5),
                groundY: terrain,
                groundLinger: collapseGroundLinger() * (0.85 + Math.random() * 0.3),
            });
        }
    }

    private pushChip(partial: {
        shape: 'round' | 'brick';
        x: number;
        y: number;
        z: number;
        vx: number;
        vy: number;
        vz: number;
        sx: number;
        sy: number;
        sz: number;
        groundY: number;
        groundLinger: number;
    }): void {
        if (this.chips.length >= MAX_STONE_CHIPS) this.evictOneChip();
        this.chips.push({
            ...partial,
            life: partial.groundLinger,
            landed: false,
            settled: false,
            shade: partial.shape === 'brick' ? 0.78 + Math.random() * 0.22 : 0.42 + Math.random() * 0.38,
            rx: Math.random() * Math.PI,
            ry: Math.random() * Math.PI,
            rz: Math.random() * Math.PI,
            spinX: (Math.random() * 2 - 1) * 10,
            spinY: (Math.random() * 2 - 1) * 7,
            spinZ: (Math.random() * 2 - 1) * 10,
        });
    }

    /** Prefer dropping timed chips so high-setting rubble piles survive. */
    private evictOneChip(): void {
        for (let i = 0; i < this.chips.length; i++) {
            if (Number.isFinite(this.chips[i]!.groundLinger)) {
                this.chips.splice(i, 1);
                return;
            }
        }
        this.chips.shift();
    }

    update(dt: number): void {
        for (let i = this.chips.length - 1; i >= 0; i--) {
            const c = this.chips[i]!;
            if (c.landed) {
                if (Number.isFinite(c.life)) {
                    c.life -= dt;
                    if (c.life <= 0) {
                        this.chips.splice(i, 1);
                        continue;
                    }
                }
            }
            if (c.settled) continue;
            if (!c.landed) {
                c.vy -= CHIP_GRAVITY * dt;
                c.x += c.vx * dt;
                c.y += c.vy * dt;
                c.z += c.vz * dt;
                c.rx += c.spinX * dt;
                c.ry += c.spinY * dt;
                c.rz += c.spinZ * dt;
                const rest = chipRestY(c.groundY, c.sy, c.shape);
                if (c.y < rest) {
                    c.y = rest;
                    c.landed = true;
                    c.life = c.groundLinger;
                    c.vy = 0;
                    c.vx *= 0.35;
                    c.vz *= 0.35;
                    c.spinX *= 0.2;
                    c.spinY *= 0.2;
                    c.spinZ *= 0.2;
                }
            } else {
                c.x += c.vx * dt;
                c.z += c.vz * dt;
                c.vx *= 0.88;
                c.vz *= 0.88;
                c.rx += c.spinX * dt;
                c.rz += c.spinZ * dt;
                c.spinX *= 0.9;
                c.spinZ *= 0.9;
                c.y = chipRestY(c.groundY, c.sy, c.shape);
                if (c.vx * c.vx + c.vz * c.vz < 0.04 && c.spinX * c.spinX + c.spinZ * c.spinZ < 0.15) {
                    c.vx = 0;
                    c.vz = 0;
                    c.spinX = 0;
                    c.spinY = 0;
                    c.spinZ = 0;
                    c.settled = true;
                }
            }
        }
        this.writeMeshes();
    }

    private writeMeshes(): void {
        let ri = 0;
        let bi = 0;
        for (const c of this.chips) {
            const fade = c.landed && Number.isFinite(c.life) ? Math.min(1, c.life / 0.45) : 1;
            const f = 0.85 + 0.15 * fade;
            const sy = c.sy * f;
            this.pos.set(c.x, c.landed ? chipRestY(c.groundY, sy, c.shape) : c.y, c.z);
            this.euler.set(c.rx, c.ry, c.rz);
            this.quat.setFromEuler(this.euler);
            this.scale.set(c.sx * f, sy, c.sz * f);
            this.matrix.compose(this.pos, this.quat, this.scale);
            if (c.shape === 'brick') {
                this.brickMesh.setMatrixAt(bi, this.matrix);
                this.tmpColor.setHex(BRICK_COLOR).multiplyScalar(c.shade);
                this.brickMesh.setColorAt(bi, this.tmpColor);
                bi++;
            } else {
                this.roundMesh.setMatrixAt(ri, this.matrix);
                this.tmpColor.setHex(this.roundBaseColor).multiplyScalar(c.shade);
                this.roundMesh.setColorAt(ri, this.tmpColor);
                ri++;
            }
        }
        this.roundMesh.count = ri;
        this.brickMesh.count = bi;
        this.roundMesh.instanceMatrix.needsUpdate = true;
        this.brickMesh.instanceMatrix.needsUpdate = true;
        if (this.roundMesh.instanceColor) this.roundMesh.instanceColor.needsUpdate = true;
        if (this.brickMesh.instanceColor) this.brickMesh.instanceColor.needsUpdate = true;
    }

    clear(): void {
        this.chips.length = 0;
        this.roundMesh.count = 0;
        this.brickMesh.count = 0;
    }

    /** Drop timed chips (hits + medium/low collapse); keep high-setting rubble. */
    clearTimed(): void {
        for (let i = this.chips.length - 1; i >= 0; i--) {
            if (Number.isFinite(this.chips[i]!.groundLinger)) this.chips.splice(i, 1);
        }
        this.writeMeshes();
    }

    dispose(): void {
        this.roundMesh.removeFromParent();
        this.brickMesh.removeFromParent();
        if (this.roundMesh.geometry !== this.sharedRockGeo && this.roundMesh.geometry !== getCrowStoneGeometry()) {
            this.roundMesh.geometry.dispose();
        }
        const roundMat = this.roundMesh.material;
        if (roundMat !== this.sharedRockMat) {
            if (Array.isArray(roundMat)) for (const m of roundMat) m.dispose();
            else roundMat.dispose();
        }
        if (this.brickMesh.geometry !== this.sharedBrickGeo) this.brickMesh.geometry.dispose();
        const brickMat = this.brickMesh.material;
        if (brickMat !== this.sharedBrickMat) {
            if (Array.isArray(brickMat)) for (const m of brickMat) m.dispose();
            else brickMat.dispose();
        }
    }
}

/**
 * Arrows / ballista shafts left in flesh or dirt after a hit.
 * Pref-capped ring buffer; shafts on units stay parented in local space so
 * walk / tip-over / crash-fall carry them. Cleared each battle.
 */
export class StuckBoltRenderer {
    private readonly mesh: InstancedMesh;
    private readonly matrix = new Matrix4();
    private readonly inv = new Matrix4();
    private readonly pos = new Vector3();
    private readonly dir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly arrowScale = new Vector3(ARROW_SCALE, ARROW_SCALE, ARROW_SCALE);
    private readonly largeScale = new Vector3(LARGE_ARROW_SCALE, LARGE_ARROW_SCALE, LARGE_ARROW_SCALE);
    private readonly sharedBoltGeo: BufferGeometry | null;
    private readonly sharedBoltMat: MeshStandardMaterial | null;
    private readonly slots: StuckSlot[] = [];
    private write = 0;
    private filled = 0;

    constructor(scene: Scene) {
        const bolt = boltAsset;
        this.sharedBoltGeo = bolt?.geometry ?? null;
        this.sharedBoltMat = bolt?.material ?? null;
        const geo = bolt?.geometry ?? makeArrowGeometry(2);
        const mat = bolt?.material ?? new MeshLambertMaterial({ color: 0x8a6a3c, flatShading: true });
        this.mesh = new InstancedMesh(geo, mat, MAX_STUCK_BOLTS);
        this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true;
        this.mesh.count = 0;
        scene.add(this.mesh);
        for (let i = 0; i < MAX_STUCK_BOLTS; i++) {
            this.slots.push({ local: new Matrix4(), attach: null });
        }
    }

    /**
     * Plant new shafts from sim events. Pass `resolveAttach` so flesh hits can
     * bind to the victim mesh (follows tip / fall). Seats the shaft center on
     * the first visual surface along the shot (past oversized hitboxes).
     */
    spawnFromEvents(
        events: readonly SimEvent[],
        resolveAttach?: (actorIndex: number) => StuckAttachRef | null | undefined,
    ): void {
        const cap = Math.min(MAX_STUCK_BOLTS, stuckProjectileCap());
        if (cap <= 0) {
            if (this.mesh.count !== 0) {
                this.mesh.count = 0;
                this.filled = 0;
                this.write = 0;
            }
            return;
        }
        if (this.filled > cap) this.filled = cap;
        if (this.write >= cap) this.write %= cap;
        for (const e of events) {
            if (e.kind !== 'stuckBolt') continue;
            this.dir.set(e.dx, e.dy, e.dz);
            if (this.dir.lengthSq() < 1e-8) this.dir.set(0, -0.2, -1).normalize();
            else this.dir.normalize();

            const ref =
                e.attachIndex !== undefined ? (resolveAttach?.(e.attachIndex) ?? null) : null;
            const dig = e.style === 'largeArrow' ? 0.22 : 0.1;
            seatStuckBoltCenter(
                e.x,
                e.y,
                e.z,
                this.dir,
                ref?.mesh ?? null,
                ref?.modelId,
                dig,
                !!ref?.structure,
            );
            this.pos.copy(_seatOrigin);

            this.quat.setFromUnitVectors(this.fwd, this.dir);
            const scale = e.style === 'largeArrow' ? this.largeScale : this.arrowScale;
            this.matrix.compose(this.pos, this.quat, scale);

            const slot = this.slots[this.write]!;
            const attach = ref?.mesh ?? null;
            if (attach) {
                attach.updateMatrixWorld(true);
                this.inv.copy(attach.matrixWorld).invert();
                slot.local.multiplyMatrices(this.inv, this.matrix);
                slot.attach = attach;
            } else {
                slot.local.copy(this.matrix);
                slot.attach = null;
            }
            this.write = (this.write + 1) % cap;
            if (this.filled < cap) this.filled++;
        }
        this.sync();
    }

    /** Recompute instance matrices so attached shafts follow tip / fall / walk. */
    sync(): void {
        const cap = Math.min(MAX_STUCK_BOLTS, stuckProjectileCap());
        if (cap <= 0 || this.filled <= 0) {
            this.mesh.count = 0;
            return;
        }
        const n = Math.min(this.filled, cap);
        const start = this.filled < cap ? 0 : this.write;
        for (let i = 0; i < n; i++) {
            const slot = this.slots[(start + i) % cap]!;
            if (slot.attach) {
                slot.attach.updateMatrixWorld(true);
                this.matrix.multiplyMatrices(slot.attach.matrixWorld, slot.local);
                this.mesh.setMatrixAt(i, this.matrix);
            } else {
                this.mesh.setMatrixAt(i, slot.local);
            }
        }
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    clear(): void {
        this.filled = 0;
        this.write = 0;
        this.mesh.count = 0;
        for (const slot of this.slots) slot.attach = null;
    }

    dispose(): void {
        this.mesh.removeFromParent();
        if (this.mesh.geometry !== this.sharedBoltGeo) this.mesh.geometry.dispose();
        const mat = this.mesh.material;
        if (mat !== this.sharedBoltMat) {
            if (Array.isArray(mat)) for (const m of mat) m.dispose();
            else mat.dispose();
        }
    }
}

/** Draws the sim's bullets as instanced meshes — one pool per visual style. */
export class ProjectileRenderer {
    private readonly pools: Record<ProjectileStyle, InstancedMesh>;
    private readonly orbMaterial: ShaderMaterial;
    private readonly matrix = new Matrix4();
    private readonly pos = new Vector3();
    private readonly dir = new Vector3();
    private readonly quat = new Quaternion();
    private readonly fwd = new Vector3(0, 0, 1);
    private readonly one = new Vector3(1, 1, 1);
    private readonly orbScale = new Vector3(ORB_SCALE, ORB_SCALE, ORB_SCALE);
    private readonly arrowScale = new Vector3(ARROW_SCALE, ARROW_SCALE, ARROW_SCALE);
    private readonly largeArrowScale = new Vector3(LARGE_ARROW_SCALE, LARGE_ARROW_SCALE, LARGE_ARROW_SCALE);
    private readonly t0 = performance.now();
    /** Shared bolt.glb geo — dispose once even if used by two pools. */
    private readonly sharedBoltGeo: BufferGeometry | null;
    private readonly sharedBoltMat: MeshStandardMaterial | null;
    private readonly sharedRockGeo: BufferGeometry | null;
    private readonly sharedRockMat: MeshStandardMaterial | null;

    constructor(scene: Scene) {
        const wood = new MeshLambertMaterial({ color: 0x8a6a3c, flatShading: true });
        const rockFallback = new MeshLambertMaterial({ color: THEME.scenery.rock, flatShading: true });
        this.orbMaterial = makeOrbMaterial();

        const bolt = boltAsset;
        this.sharedBoltGeo = bolt?.geometry ?? null;
        this.sharedBoltMat = bolt?.material ?? null;
        const arrowGeo = bolt?.geometry ?? makeArrowGeometry(2);
        const largeGeo = bolt?.geometry ?? makeArrowGeometry(5.5);
        const arrowMat = bolt?.material ?? wood;
        const largeMat = bolt?.material ?? wood;

        const rock = rockAsset;
        this.sharedRockGeo = rock?.geometry ?? null;
        this.sharedRockMat = rock?.material ?? null;
        if (rock) crowStoneHalfExtentY = rock.height * 0.5;
        const stoneGeo = rock?.geometry ?? getCrowStoneGeometry();
        const stoneMat = rock?.material ?? rockFallback;

        this.pools = {
            bolt: new InstancedMesh(
                new SphereGeometry(0.28, 6, 5),
                new MeshBasicMaterial({ color: THEME.projectile }),
                MAX_PROJECTILES,
            ),
            arrow: new InstancedMesh(arrowGeo, arrowMat, MAX_PROJECTILES),
            largeArrow: new InstancedMesh(largeGeo, largeMat, MAX_PROJECTILES),
            stone: new InstancedMesh(stoneGeo, stoneMat, MAX_PROJECTILES),
            orb: new InstancedMesh(new IcosahedronGeometry(0.85, 2), this.orbMaterial, MAX_PROJECTILES),
        };
        for (const mesh of Object.values(this.pools)) {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.count = 0;
            scene.add(mesh);
        }
        if (bolt) {
            console.info(
                `[effects] projectile pools using bolt.glb (arrow×${ARROW_SCALE}, ballista×${LARGE_ARROW_SCALE}, cap ${MAX_PROJECTILES})`,
            );
        }
        if (rock) {
            console.info('[effects] crow stones using rock.glb');
        }
    }

    /** `alpha` interpolates between the last two sim steps for smooth flight */
    update(projectiles: readonly Projectile[], alpha = 1): void {
        this.orbMaterial.uniforms.uTime!.value = (performance.now() - this.t0) * 0.001;
        const counts: Record<ProjectileStyle, number> = {
            bolt: 0,
            arrow: 0,
            largeArrow: 0,
            stone: 0,
            orb: 0,
        };
        const n = Math.min(projectiles.length, MAX_PROJECTILES);
        for (let i = 0; i < n; i++) {
            const p = projectiles[i]!;
            this.pos.set(
                p.px + (p.x - p.px) * alpha,
                p.py + (p.y - p.py) * alpha,
                p.pz + (p.z - p.pz) * alpha,
            );
            this.dir.set(p.vx, p.vy, p.vz);
            if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 0, -1);
            else this.dir.normalize();
            this.quat.setFromUnitVectors(this.fwd, this.dir);
            const scale =
                p.style === 'orb'
                    ? this.orbScale
                    : p.style === 'arrow'
                      ? this.arrowScale
                      : p.style === 'largeArrow'
                        ? this.largeArrowScale
                        : this.one;
            this.matrix.compose(this.pos, this.quat, scale);
            const style = p.style;
            this.pools[style].setMatrixAt(counts[style]++, this.matrix);
        }
        for (const style of Object.keys(this.pools) as ProjectileStyle[]) {
            const mesh = this.pools[style];
            mesh.count = counts[style];
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    clear(): void {
        for (const mesh of Object.values(this.pools)) mesh.count = 0;
    }

    /** One instance per style so bolt/arrow/stone materials compile before combat. */
    primeForCompile(): void {
        this.matrix.identity();
        for (const mesh of Object.values(this.pools)) {
            mesh.setMatrixAt(0, this.matrix);
            mesh.count = 1;
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose(): void {
        const sharedGeo = this.sharedBoltGeo;
        const sharedMat = this.sharedBoltMat;
        const rockGeo = this.sharedRockGeo;
        const rockMat = this.sharedRockMat;
        const crowGeo = getCrowStoneGeometry();
        for (const mesh of Object.values(this.pools)) {
            mesh.removeFromParent();
            // Shared bolt/rock geo/mat live in the module cache — don't dispose those.
            if (mesh.geometry !== sharedGeo && mesh.geometry !== rockGeo && mesh.geometry !== crowGeo) {
                mesh.geometry.dispose();
            }
            const mat = mesh.material;
            if (mat !== sharedMat && mat !== rockMat) {
                if (Array.isArray(mat)) for (const m of mat) m.dispose();
                else mat.dispose();
            }
        }
    }
}
