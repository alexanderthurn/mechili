import { Box3, Color, Group, MathUtils, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { teamColors } from './colors';
import type { Team } from './units';

/**
 * Units backed by a generated GLB model instead of procedural primitives.
 * `yaw` orients the model to the facing=0 convention (front toward -z, the
 * enemy edge); flip by Math.PI if a model ends up facing backwards.
 */
/**
 * Tripo models are exported facing +X. The game aims a unit's front along its
 * move/attack direction (built around a −Z rest forward), so baking +π/2 rotates
 * the model's +X onto that forward. Default yaw for every Tripo/P1 model.
 */
export const MODEL_FWD_YAW = Math.PI / 2;

export interface ModelSpec {
    url: string;
    yaw: number;
    pitch?: number;
    roll?: number;
    offset?: { x?: number; y?: number; z?: number };
    scale?: number;
}

export const MODEL_SPECS: Record<string, ModelSpec> = {
    // fantasy conversion (Melodan): P1 super-low-poly, static + procedural.
    // `scale` multiplies the auto-fitted size (default 1) for art tweaks.
    crawler: { url: new URL('../../assets/models/dwarf.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 3,offset: { x: 0, y: -0.1, z: 0 }  },
    marksman: { url: new URL('../../assets/models/archer.glb', import.meta.url).href, yaw: MODEL_FWD_YAW,offset: { x: 0, y: -0.1, z: 0 }  },
    fortress: { url: new URL('../../assets/models/fortress-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // ballista
    wasp: { url: new URL('../../assets/models/wasp-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // crow rider
    shield: { url: new URL('../../assets/models/shield-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // ward stone
    rocket: { url: new URL('../../assets/models/rocket-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // fire bolt
    // the two base buildings — distinct castles instead of the shared procedural tower
    'command-tower': { url: new URL('../../assets/models/command-tower-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // stone watchtower
    stronghold: { url: new URL('../../assets/models/command-tower-keep.glb', import.meta.url).href, yaw: MODEL_FWD_YAW }, // castle keep (Tripo v3.1, gltf-transform-optimized)
    'research-center': { url: new URL('../../assets/models/research-center-fantasy.glb', import.meta.url).href, yaw: MODEL_FWD_YAW, scale: 1.25 }, // wizard tower
};

/** how strongly the neutral gunmetal model is tinted toward its team color (0..1) */
const TEAM_TINT = 0.32;

type Template = { player: Group; enemy: Group };
const templates = new Map<string, Template>();
const loader = new GLTFLoader();

export function hasUnitModel(id: string): boolean {
    return templates.has(id);
}

/**
 * A fresh, team-tinted, normalized clone of the model — or null if none loaded.
 * Sized to the unit's procedural LOCAL height, so the caller applying
 * `meshScale` yields the same world size the game already expects.
 */
export function cloneUnitModel(id: string, team: Team): Group | null {
    const t = templates.get(id);
    return t ? (skeletonClone(t[team]) as Group) : null;
}

/** Deep-clone the scene and tint each material toward the team color. */
function tintedClone(scene: Object3D, team: Team): Object3D {
    const clone = skeletonClone(scene);
    const col = new Color(teamColors[team].hex);
    clone.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const tinted = mats.map((m) => {
            const c = (m as MeshStandardMaterial).clone();
            if (c.color) c.color.lerp(col, TEAM_TINT);
            // Tripo often bakes metalness near 1; combined with a subtle env map
            // that reads too dark. Cap it so the diffuse light carries the form.
            if (typeof c.metalness === 'number') c.metalness = Math.min(c.metalness, 0.6);
            c.envMapIntensity = 1.1;
            return c;
        });
        mesh.material = Array.isArray(mesh.material) ? tinted : tinted[0]!;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
    });
    return clone;
}

/** Yaw, scale to `height`, center on x/z, and sit the base at y=0. */
function normalize(
    scene: Object3D,
    height: number,
    yaw: number,
    pitch?: number,
    roll?: number,
    offset?: { x?: number; y?: number; z?: number },
): Group {
    const holder = new Group();
    scene.rotation.y = yaw;
    if (pitch !== undefined) scene.rotation.x = pitch;
    if (roll !== undefined) scene.rotation.z = roll;
    holder.add(scene);
    let box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const s = size.y > 0 ? height / size.y : 1;
    scene.scale.multiplyScalar(s);
    box = new Box3().setFromObject(holder);
    const center = box.getCenter(new Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;

    if (offset) {
        if (offset.x !== undefined) scene.position.x += offset.x;
        if (offset.y !== undefined) scene.position.y += offset.y;
        if (offset.z !== undefined) scene.position.z += offset.z;
    }
    return holder;
}

/**
 * Load every spec'd model and bake team-tinted, normalized templates.
 * `heights` gives each unit's procedural local height. Failures fall back to
 * the procedural mesh (the unit id simply stays absent from the template map).
 */
export async function loadUnitModels(heights: Record<string, number>): Promise<void> {
    await Promise.all(
        Object.entries(MODEL_SPECS).map(async ([id, spec]) => {
            try {
                const gltf = await loader.loadAsync(spec.url);
                const h = (heights[id] || 1) * (spec.scale ?? 1);
                templates.set(id, {
                    player: normalize(tintedClone(gltf.scene, 'player'), h, spec.yaw, spec.pitch, spec.roll, spec.offset),
                    enemy: normalize(tintedClone(gltf.scene, 'enemy'), h, spec.yaw, spec.pitch, spec.roll, spec.offset),
                });
                console.info(`[unitModels] loaded '${id}' from ${spec.url} (height ${h.toFixed(2)})`);
            } catch (e) {
                console.error(`[unitModels] '${id}' FAILED to load from ${spec.url}; using procedural mesh`, e);
            }
        }),
    );
    console.info(`[unitModels] ready: ${[...templates.keys()].join(', ') || '(none)'}`);
}
