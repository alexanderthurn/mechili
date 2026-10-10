import { BufferAttribute, Box3, Mesh, Vector3, type Group } from 'three';

/**
 * Experiment: a walkway behind a wall, for archers to stand on and shoot over
 * the top. For now the wall's own section, made deeper and lower and set
 * against its back (the side away from the enemy). Render-only; the drape
 * lays it over the ground like the sections (its name starts with "center").
 * Tweak live:
 * - height: × the section's height (its top is the walk, below the crown)
 * - depth: × the section's depth
 */
export const WALL_WALK = {
    height: 0.6,
    depth: 2.5,
    /** × the touching distance: below 1 tucks the walkway a little into the wall (no gap shows) */
    flush: 0.9,
    /**
     * how much of the crown's rise per level the walkway follows: 1 = it keeps
     * the same gap below the crown, 0 = it stays at its level-1 height
     * (keep in step with the wall's `posts.rise`)
     */
    rise: 0.8,
} as const;

const SECTION_PREFIX = 'center';
const WALK_PREFIX = 'centerWalk';
/** the towers whose low, deep copies close the walkway's open ends */
const END_TOWERS = ['left', 'right'] as const;
/** the end caps: "<tower>Walk", hidden with their tower at a straight join (wallJoins) */
export const WALK_END_SUFFIX = 'Walk';

const _a = new Vector3();
const _b = new Vector3();
const _box = new Box3();

/**
 * Add (or remove) the walkway pieces in one wall member. `backX/Z` is the
 * world direction away from the enemy.
 */
export function setWallWalkMeshes(member: Group, on: boolean, backX: number, backZ: number): void {
    const existing: Mesh[] = [];
    const sections: Mesh[] = [];
    const towers: Mesh[] = [];
    member.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        if (mesh.name.startsWith(WALK_PREFIX) || mesh.name.endsWith(WALK_END_SUFFIX)) existing.push(mesh);
        else if (mesh.name.startsWith(SECTION_PREFIX)) sections.push(mesh);
        else if ((END_TOWERS as readonly string[]).includes(mesh.name)) towers.push(mesh);
    });
    if (!on) {
        for (const w of existing) {
            w.removeFromParent();
            w.geometry.dispose();
        }
        return;
    }
    if (existing.length > 0) return;
    member.updateMatrixWorld(true);
    /** where the walkway runs (its middle, depth axis) and how deep it is, for the end caps */
    let walkZ: number | null = null;
    let walkHalf = 0;
    sections.forEach((section, i) => {
        const parent = section.parent;
        if (!parent) return;
        const geometry = undrapedGeometry(section);
        const walk = new Mesh(geometry, section.material);
        walk.name = `${WALK_PREFIX}${i}`;
        walk.castShadow = section.castShadow;
        walk.receiveShadow = section.receiveShadow;
        walk.position.copy(section.position);
        walk.quaternion.copy(section.quaternion);
        walk.scale.copy(section.scale);
        geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!);
        // lower, keeping its foot where the section's is
        const sy = section.scale.y;
        const bottom = section.position.y + _box.min.y * sy;
        walk.userData.walkFit = { sy, bottom, minY: _box.min.y };
        fitHeight(walk, 1);
        // deeper, and set back flush against the wall's far-from-enemy face —
        // measured on the flat face (the typical vertex depth), not the coping
        // stones that stick out at the top
        const halfDepth = faceDepth(geometry) * Math.abs(section.scale.z);
        walk.scale.z = section.scale.z * WALL_WALK.depth;
        // which way the parent's +z points in the world, against "back"
        parent.localToWorld(_a.copy(section.position));
        parent.localToWorld(_b.copy(section.position).add(new Vector3(0, 0, 1)));
        const sign = (_b.x - _a.x) * backX + (_b.z - _a.z) * backZ >= 0 ? 1 : -1;
        walk.position.z += sign * halfDepth * (1 + WALL_WALK.depth) * WALL_WALK.flush;
        parent.add(walk);
        walkZ ??= walk.position.z;
        walkHalf = Math.max(walkHalf, halfDepth * WALL_WALK.depth);
    });
    if (walkZ === null) return;
    // close its ends: each tower again, as low as the walkway and as deep
    for (const tower of towers) {
        const parent = tower.parent;
        if (!parent) continue;
        const geometry = undrapedGeometry(tower);
        const cap = new Mesh(geometry, tower.material);
        cap.name = `${tower.name}${WALK_END_SUFFIX}`;
        cap.castShadow = tower.castShadow;
        cap.receiveShadow = tower.receiveShadow;
        cap.position.copy(tower.position);
        cap.quaternion.copy(tower.quaternion);
        cap.scale.copy(tower.scale);
        geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!);
        const sy = tower.scale.y;
        const bottom = tower.position.y + _box.min.y * sy;
        cap.userData.walkFit = { sy, bottom, minY: _box.min.y };
        fitHeight(cap, 1);
        const towerHalf = ((_box.max.z - _box.min.z) / 2) * Math.abs(tower.scale.z) || 1e-3;
        // a touch deeper than the walkway, so no edge of it peeks out
        cap.scale.z = tower.scale.z * ((walkHalf * 1.08) / towerHalf);
        cap.position.z = walkZ - ((_box.min.z + _box.max.z) / 2) * cap.scale.z;
        parent.add(cap);
    }
}

/**
 * The walkway's height for a wall `levelScale` × its level-1 height: it rises
 * with the crown (`rise` of the crown's rise), so an archer on it still sees
 * over a taller wall — its share of the wall's height grows.
 */
export function setWallWalkLevel(member: Group, levelScale: number): void {
    member.traverse((o) => {
        if (o.userData.walkFit) fitHeight(o as Mesh, levelScale);
    });
}

/**
 * The walkway's top for a wall `levelScale` × its level-1 height, as a
 * multiple of the level-1 crown — what two joined walkways meet at the middle of.
 */
export function walkTopScale(levelScale: number): number {
    return WALL_WALK.height + WALL_WALK.rise * (levelScale - 1);
}

/** the walkway's share of the wall's height at this level (see setWallWalkLevel) */
function walkShare(levelScale: number): number {
    const s = Math.max(1e-3, levelScale);
    return walkTopScale(s) / s;
}

function fitHeight(mesh: Mesh, levelScale: number): void {
    const fit = mesh.userData.walkFit as { sy: number; bottom: number; minY: number };
    mesh.scale.y = fit.sy * walkShare(levelScale);
    // its foot stays where the wall's is
    mesh.position.y = fit.bottom - fit.minY * mesh.scale.y;
}

/** the section's flat face: the median distance of its vertices from its middle (depth) */
function faceDepth(geometry: Mesh['geometry']): number {
    const pos = geometry.getAttribute('position');
    const d: number[] = [];
    for (let i = 0; i < pos.count; i++) d.push(Math.abs(pos.getZ(i)));
    d.sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)] ?? 0;
}

/** a copy of the section's geometry as authored (before the drape bent it) */
function undrapedGeometry(section: Mesh) {
    const geometry = section.geometry.clone();
    const base = section.userData.drapeBase as Float32Array | undefined;
    if (base) geometry.setAttribute('position', new BufferAttribute(base.slice(), 3));
    return geometry;
}
