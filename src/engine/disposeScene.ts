import { Material, Object3D, Texture } from 'three';

/**
 * Walk a three.js subtree and free GPU buffers (geometries, materials,
 * textures). Covers everything renderable — Mesh, Points, Sprite, Line —
 * by duck-typing on geometry/material instead of instanceof Mesh.
 */
export function disposeScene(root: Object3D): void {
    // a shared asset (a cached model template's geometry / material / texture, tagged by
    // markSharedAssets) belongs to the cache, not to this scene — the next match draws it again
    const shared = (x: { userData?: Record<string, unknown> }) => x.userData?.sharedAsset === true;
    root.traverse((obj) => {
        const renderable = obj as Object3D & {
            geometry?: { dispose(): void; userData?: Record<string, unknown> };
            material?: Material | Material[];
        };
        if (renderable.geometry && !shared(renderable.geometry)) renderable.geometry.dispose();
        if (!renderable.material) return;
        const materials = Array.isArray(renderable.material)
            ? renderable.material
            : [renderable.material];
        for (const material of materials) {
            if (shared(material)) continue;
            for (const value of Object.values(material) as unknown[]) {
                if (value instanceof Texture && !shared(value)) value.dispose();
            }
            material.dispose();
        }
    });
    while (root.children.length > 0) {
        root.remove(root.children[0]!);
    }
}
