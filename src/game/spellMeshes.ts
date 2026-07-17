import {
    Box3,
    Group,
    Mesh,
    MeshStandardMaterial,
    Vector3,
    type Material,
    type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/** Load a GLB and normalize to unit longest-axis, optional baked rotation. */
export async function loadSpellTemplate(
    url: string,
    opts: { bakeEuler?: { x?: number; y?: number; z?: number } } = {},
): Promise<Group> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return prepareSpellTemplate(gltf.scene, opts);
}

/**
 * Clone meshes into a holder, bake world transforms, normalize longest axis to 1,
 * sit the bottom on y=0, center XZ.
 */
export function prepareSpellTemplate(
    scene: Object3D,
    opts: { bakeEuler?: { x?: number; y?: number; z?: number } } = {},
): Group {
    const stage = new Group();
    const model = skeletonClone(scene);
    if (opts.bakeEuler) {
        model.rotation.set(
            opts.bakeEuler.x ?? 0,
            opts.bakeEuler.y ?? 0,
            opts.bakeEuler.z ?? 0,
        );
    }
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

/** Deep-clone a template and return opacity-controllable material clones. */
export function cloneSpellInstance(template: Group): {
    root: Group;
    materials: MeshStandardMaterial[];
} {
    const root = skeletonClone(template) as Group;
    const materials: MeshStandardMaterial[] = [];
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => {
            const c = (m as MeshStandardMaterial).clone();
            if (typeof c.metalness === 'number') c.metalness = Math.min(c.metalness, 0.7);
            if (typeof c.envMapIntensity === 'number') c.envMapIntensity = 1.1;
            materials.push(c);
            return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
    });
    return { root, materials };
}

export function setSpellOpacity(materials: MeshStandardMaterial[], opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    for (const m of materials) {
        m.opacity = o;
        m.transparent = o < 0.99;
        m.depthWrite = o > 0.2;
        m.needsUpdate = true;
    }
}

export function disposeObject(root: Object3D): void {
    root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) (m as Material).dispose();
    });
}
