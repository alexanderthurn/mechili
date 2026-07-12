import { Material, Object3D, Texture } from 'three';

/**
 * Walk a three.js subtree and free GPU buffers (geometries, materials,
 * textures). Covers everything renderable — Mesh, Points, Sprite, Line —
 * by duck-typing on geometry/material instead of instanceof Mesh.
 */
export function disposeScene(root: Object3D): void {
    root.traverse((obj) => {
        const renderable = obj as Object3D & {
            geometry?: { dispose(): void };
            material?: Material | Material[];
        };
        renderable.geometry?.dispose();
        if (!renderable.material) return;
        const materials = Array.isArray(renderable.material)
            ? renderable.material
            : [renderable.material];
        for (const material of materials) {
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
