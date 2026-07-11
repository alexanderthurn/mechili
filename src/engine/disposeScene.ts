import { Material, Mesh, Object3D, Texture } from 'three';

/** Walk a three.js subtree and free GPU buffers (geometries, materials, textures). */
export function disposeScene(root: Object3D): void {
    root.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        obj.geometry?.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
            if (!material) continue;
            for (const value of Object.values(material) as unknown[]) {
                if (value instanceof Texture) value.dispose();
            }
            material.dispose();
        }
    });
    while (root.children.length > 0) {
        root.remove(root.children[0]!);
    }
}
