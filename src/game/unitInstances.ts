import {
    Color,
    DynamicDrawUsage,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    type Group,
    type Object3D,
    type Scene,
} from 'three';
import { getUnitInstanceAsset, hasUnitInstanceAsset, type InstancePart } from './unitModels';
import { prefs, type Prefs } from './prefs';
import type { Team } from './units';

/** Unit type ids that use `structure: true` — kept here to avoid a units↔instances cycle. */
const STRUCTURE_IDS = new Set([
    'command-tower',
    'research-center',
    'stronghold',
    'shield',
    'rocket',
]);

/** Max mechs per (type × team × alive|dead) pool — cheat spam still fits. */
const POOL_CAPACITY = 4096;

const HIDE = new Matrix4().makeScale(0, 0, 0);
const _matrix = new Matrix4();
const _color = new Color();

type PoolKey = string; // `${typeId}:${team}:alive|dead`

interface Pool {
    parts: InstancedMesh[];
    /** dense list of proxy groups currently in this pool */
    owners: Group[];
}

/**
 * Alive / dead InstancedMesh pools for static GLB units. Proxies stay as empty
 * Groups so the sim can keep writing transforms; this layer mirrors them into
 * shared draw calls each frame.
 */
export class UnitInstanceRenderer {
    private readonly pools = new Map<PoolKey, Pool>();
    private readonly ownerPool = new WeakMap<Group, { key: PoolKey; index: number }>();
    private readonly scene: Scene;
    private needsColor = false;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /** True when this mech should render via instances (static GLB, not FBX). */
    static canInstance(typeId: string): boolean {
        return hasUnitInstanceAsset(typeId);
    }

    register(proxy: Group, typeId: string, team: Team): void {
        if (this.ownerPool.has(proxy)) return;
        proxy.userData.instanced = true;
        this.moveTo(proxy, typeId, team, 'alive');
    }

    /** Tip / rubble: leave the alive pool and park the current pose in dead. */
    setDead(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.key.endsWith(':dead')) return;
        const [typeId, team] = meta.key.split(':') as [string, Team];
        this.removeFromPool(proxy, meta);
        this.moveTo(proxy, typeId, team, 'dead');
        // hide proxy (level badges etc.) when wrecks are not drawn
        proxy.visible = prefs().renderDeadUnits;
        // dead pose is written once here; sync still refreshes if the view moves
        this.writeMatrix(proxy, this.pool(typeId, team, 'dead'), this.ownerPool.get(proxy)!.index);
    }

    /** Round reset: wreck → living formation again. */
    setAlive(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.key.endsWith(':alive')) return;
        const [typeId, team] = meta.key.split(':') as [string, Team];
        this.removeFromPool(proxy, meta);
        proxy.visible = true;
        this.moveTo(proxy, typeId, team, 'alive');
    }

    unregister(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta) return;
        this.removeFromPool(proxy, meta);
        this.ownerPool.delete(proxy);
        delete proxy.userData.instanced;
    }

    unregisterUnit(unit: { members: { mesh: Group }[] }): void {
        for (const m of unit.members) this.unregister(m.mesh);
    }

    /**
     * Battle tint via per-instance color (multiplies the team-tinted material).
     * Golden / debuff / spawning are approximations of the old material swaps.
     */
    setTint(
        proxy: Group,
        tint: 'normal' | 'golden' | 'debuff' | 'spawning',
        timeSeconds: number,
        debuffStacks = 1,
        spawnProgress = 0,
    ): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta) return;
        const pool = this.pools.get(meta.key);
        if (!pool) return;

        if (tint === 'golden') {
            const pulse = 0.55 + Math.sin(timeSeconds * 4.5) * 0.2;
            _color.setRGB(pulse, pulse * 0.85, 0.25);
        } else if (tint === 'debuff') {
            const t = timeSeconds * 7;
            const amp = Math.min(1, 0.55 + debuffStacks * 0.2);
            _color.setRGB(
                (0.55 + 0.45 * Math.sin(t)) * amp,
                (0.15 + 0.25 * Math.sin(t + 2.4)) * amp,
                (0.45 + 0.4 * Math.sin(t + 4.8)) * amp,
            );
        } else if (tint === 'spawning') {
            const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 6.5);
            const g = 0.45 + spawnProgress * 0.35 + pulse * 0.1;
            _color.setRGB(g, g, g * 1.05);
        } else {
            _color.setRGB(1, 1, 1);
        }

        for (const mesh of pool.parts) {
            mesh.setColorAt(meta.index, _color);
        }
        this.needsColor = true;
    }

    /** Push proxy world matrices into every alive/dead InstancedMesh. */
    sync(): void {
        const showDead = prefs().renderDeadUnits;
        for (const [key, pool] of this.pools) {
            if (key.endsWith(':dead') && !showDead) {
                for (const mesh of pool.parts) {
                    if (mesh.count !== 0) {
                        mesh.count = 0;
                        mesh.instanceMatrix.needsUpdate = true;
                    }
                }
                continue;
            }
            for (let i = 0; i < pool.owners.length; i++) {
                this.writeMatrix(pool.owners[i]!, pool, i);
            }
            for (const mesh of pool.parts) {
                mesh.count = pool.owners.length;
                mesh.instanceMatrix.needsUpdate = true;
                if (this.needsColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            }
        }
        this.needsColor = false;
    }

    dispose(): void {
        for (const pool of this.pools.values()) {
            for (const mesh of pool.parts) {
                this.scene.remove(mesh);
                mesh.dispose();
            }
        }
        this.pools.clear();
    }

    /** Compact pool breakdown for the debug overlay / clipboard dump. */
    debugSnapshot(): { pools: number; instances: number; lines: string[] } {
        const showDead = prefs().renderDeadUnits;
        const lines: string[] = [];
        let instances = 0;
        for (const [key, pool] of [...this.pools.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const n = pool.owners.length;
            if (n === 0) continue;
            const drawn = key.endsWith(':dead') && !showDead ? 0 : n;
            instances += drawn;
            lines.push(
                `  ${key}  n=${n}` +
                    (drawn !== n ? `  drawn=0` : '') +
                    `  parts=${pool.parts.length}`,
            );
        }
        return { pools: lines.length, instances, lines };
    }

    /** Live-apply the unit-shadows pref to every pool (and new pools pick it up). */
    applyShadowPref(mode: Prefs['unitShadows'] = prefs().unitShadows): void {
        for (const [key, pool] of this.pools) {
            const typeId = key.split(':')[0]!;
            const cast = unitShadowCast(typeId, mode);
            for (const mesh of pool.parts) mesh.castShadow = cast;
        }
    }

    /** Show/hide wreck proxies when the render-dead pref flips mid-match. */
    applyDeadPref(show: boolean = prefs().renderDeadUnits): void {
        for (const [key, pool] of this.pools) {
            if (!key.endsWith(':dead')) continue;
            for (const owner of pool.owners) owner.visible = show;
            for (const mesh of pool.parts) {
                mesh.count = show ? pool.owners.length : 0;
                mesh.instanceMatrix.needsUpdate = true;
            }
        }
    }

    private moveTo(proxy: Group, typeId: string, team: Team, life: 'alive' | 'dead'): void {
        const pool = this.pool(typeId, team, life);
        if (pool.owners.length >= POOL_CAPACITY) {
            console.warn(`[unitInstances] pool full for ${typeId}/${team}/${life}`);
            return;
        }
        const index = pool.owners.length;
        pool.owners.push(proxy);
        this.ownerPool.set(proxy, { key: poolKey(typeId, team, life), index });
        for (const mesh of pool.parts) {
            mesh.count = pool.owners.length;
            mesh.setColorAt(index, _color.setRGB(1, 1, 1));
        }
        this.needsColor = true;
    }

    private removeFromPool(proxy: Group, meta: { key: PoolKey; index: number }): void {
        const pool = this.pools.get(meta.key);
        if (!pool) return;
        const last = pool.owners.length - 1;
        const lastOwner = pool.owners[last]!;
        if (meta.index !== last) {
            pool.owners[meta.index] = lastOwner;
            this.ownerPool.set(lastOwner, { key: meta.key, index: meta.index });
            // copy last instance matrix/color into the hole
            for (const mesh of pool.parts) {
                mesh.getMatrixAt(last, _matrix);
                mesh.setMatrixAt(meta.index, _matrix);
                if (mesh.instanceColor) {
                    mesh.getColorAt(last, _color);
                    mesh.setColorAt(meta.index, _color);
                }
            }
        }
        pool.owners.pop();
        for (const mesh of pool.parts) {
            mesh.count = pool.owners.length;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    }

    private writeMatrix(proxy: Group, pool: Pool, index: number): void {
        if (!isRenderable(proxy)) {
            for (const mesh of pool.parts) mesh.setMatrixAt(index, HIDE);
            return;
        }
        proxy.updateWorldMatrix(true, false);
        for (const mesh of pool.parts) mesh.setMatrixAt(index, proxy.matrixWorld);
    }

    private pool(typeId: string, team: Team, life: 'alive' | 'dead'): Pool {
        const key = poolKey(typeId, team, life);
        let pool = this.pools.get(key);
        if (pool) return pool;

        const asset = getUnitInstanceAsset(typeId, team);
        if (!asset) throw new Error(`[unitInstances] no asset for ${typeId}/${team}`);

        const parts = asset.parts.map((part) => makeInstanced(part, typeId));
        for (const mesh of parts) this.scene.add(mesh);
        pool = { parts, owners: [] };
        this.pools.set(key, pool);
        return pool;
    }
}

function poolKey(typeId: string, team: Team, life: 'alive' | 'dead'): PoolKey {
    return `${typeId}:${team}:${life}`;
}

function unitShadowCast(typeId: string, mode: Prefs['unitShadows']): boolean {
    if (mode === 'off') return false;
    if (mode === 'all') return true;
    return STRUCTURE_IDS.has(typeId);
}

function makeInstanced(part: InstancePart, typeId: string): InstancedMesh {
    const mat = part.material.clone();
    // clone geo so pool dispose() can free it without breaking sibling pools
    const mesh = new InstancedMesh(part.geometry.clone(), mat, POOL_CAPACITY);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = unitShadowCast(typeId, prefs().unitShadows);
    mesh.receiveShadow = true;
    mesh.count = 0;
    // allocate instanceColor buffer up front
    mesh.setColorAt(0, _color.setRGB(1, 1, 1));
    return mesh;
}

/** Attached to a Scene and visible all the way up. */
function isRenderable(obj: Object3D): boolean {
    let o: Object3D | null = obj;
    while (o) {
        if (!o.visible) return false;
        if ((o as { isScene?: boolean }).isScene) return true;
        o = o.parent;
    }
    return false;
}

// ── module singleton (Units construct before Game finishes wiring) ──────────

let renderer: UnitInstanceRenderer | null = null;

export function setUnitInstanceRenderer(r: UnitInstanceRenderer | null): void {
    renderer = r;
}

export function getUnitInstanceRenderer(): UnitInstanceRenderer | null {
    return renderer;
}
