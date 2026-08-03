import { Ray, Vector3, type Object3D, type Raycaster } from 'three';
import type { UnitType } from './units';

const _oc = new Vector3();

/**
 * Nearest positive hit distance along `ray` against a sphere, or null.
 */
export function raySphereT(ray: Ray, cx: number, cy: number, cz: number, r: number): number | null {
    if (r <= 0) return null;
    _oc.set(cx - ray.origin.x, cy - ray.origin.y, cz - ray.origin.z);
    const b = _oc.dot(ray.direction);
    const c = _oc.lengthSq() - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t0 = b - s;
    if (t0 >= 0) return t0;
    const t1 = b + s;
    return t1 >= 0 ? t1 : null;
}

/**
 * World-space pick spheres for a mech standing at `(baseX, baseY, baseZ)`.
 * `baseY` is the feet / support height (collider `y` is relative to that).
 * Types with no combat colliders get a single body-sized fallback sphere so
 * instanced / empty-proxy mechs stay clickable.
 */
export function forEachPickSphere(
    type: UnitType,
    baseX: number,
    baseY: number,
    baseZ: number,
    visit: (x: number, y: number, z: number, r: number) => void,
): void {
    const scale = type.meshScale;
    if (type.colliders.length > 0) {
        for (const c of type.colliders) {
            visit(baseX, baseY + c.y * scale, baseZ, c.r * scale);
        }
        return;
    }
    const r = Math.max(type.collisionRadius, scale * 0.55);
    visit(baseX, baseY + scale * 0.55, baseZ, r);
}

/**
 * Closest mesh intersection along an already-configured raycaster.
 * Used for structures with real geometry (towers) — complements collider spheres.
 */
export function rayMeshT(raycaster: Raycaster, root: Object3D): number | null {
    const hits = raycaster.intersectObject(root, true);
    if (hits.length === 0) return null;
    return hits[0]!.distance;
}
