import {
    Box3,
    Group,
    Mesh,
    Object3D,
    Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { loadSpellTemplate } from './spellMeshes';

const loader = new GLTFLoader();

const URLS = {
    hammer: new URL('../../assets/models/spells/hammer-of-gods.glb', import.meta.url).href,
    'meteor-great': new URL('../../assets/models/spells/meteor-great.glb', import.meta.url).href,
    'meteor-shard': new URL('../../assets/models/spells/meteor-shard.glb', import.meta.url).href,
    storm: new URL('../../assets/models/spells/storm-cloud.glb', import.meta.url).href,
    poison: new URL('../../assets/models/spells/poison-cloud.glb', import.meta.url).href,
    dragon: new URL('../../assets/models/spells/dragon.glb', import.meta.url).href,
} as const;

export type SpellAssetId = keyof typeof URLS;

const templates = new Map<SpellAssetId, Group>();
let preloadPromise: Promise<void> | null = null;

export type SpellProgress = (done: number, total: number, label: string) => void;

/**
 * Upside-down hammer (+Y into ground), normalized longest-axis = 1, base on y=0.
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

async function loadOne(id: SpellAssetId): Promise<Group> {
    const hit = templates.get(id);
    if (hit) return hit;
    let tpl: Group;
    if (id === 'hammer') {
        const gltf = await loader.loadAsync(URLS.hammer);
        tpl = prepareHammerTemplate(gltf.scene);
    } else if (id === 'meteor-great') {
        tpl = await loadSpellTemplate(URLS['meteor-great'], { bakeEuler: { x: 0.3 } });
    } else if (id === 'meteor-shard') {
        tpl = await loadSpellTemplate(URLS['meteor-shard'], { bakeEuler: { x: 0.35 } });
    } else {
        tpl = await loadSpellTemplate(URLS[id]);
    }
    templates.set(id, tpl);
    return tpl;
}

/** Shared prepared template — do not dispose; clones are made per spawn. */
export function getSpellTemplate(id: SpellAssetId): Group | null {
    return templates.get(id) ?? null;
}

export async function ensureSpellTemplate(id: SpellAssetId): Promise<Group | null> {
    try {
        return await loadOne(id);
    } catch (e) {
        console.error(`[spellAssets] '${id}' failed to load`, e);
        return null;
    }
}

/** Load every spell GLB once at boot. Safe to call repeatedly. */
export function preloadSpellAssets(onProgress?: SpellProgress): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const ids = Object.keys(URLS) as SpellAssetId[];
    const total = ids.length;
    let done = 0;
    preloadPromise = (async () => {
        await Promise.all(
            ids.map(async (id) => {
                await ensureSpellTemplate(id);
                done += 1;
                onProgress?.(done, total, 'Spell effects');
            }),
        );
        console.info(`[spellAssets] ready: ${[...templates.keys()].join(', ') || '(none)'}`);
    })();
    return preloadPromise;
}
