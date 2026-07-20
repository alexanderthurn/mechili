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
import { HORDE_COLOR, LEVEL_TINT_COLORS, applyLevelTintColor } from './colors';
import { getUnitInstanceAsset, hasUnitInstanceAsset, type InstancePart } from './unitModels';
import { prefs, type Prefs } from './prefs';
import type { BattleTeam } from './units';

/** Unit type ids that use `structure: true` — kept here to avoid a units↔instances cycle. */
const STRUCTURE_IDS = new Set([
    'command-tower',
    'research-center',
    'stronghold',
    'shield',
    'rocket',
]);

/** Max mechs per (type × team × level × alive|dead) pool — cheat spam still fits. */
const POOL_CAPACITY = 4096;

const HIDE = new Matrix4().makeScale(0, 0, 0);
const _matrix = new Matrix4();
const _color = new Color();
const _base = new Color();

type PoolKey = string; // `${typeId}:${team}:${level}:alive|dead`

interface Pool {
    parts: InstancedMesh[];
    /** dense list of proxy groups currently in this pool */
    owners: Group[];
}

interface PoolMeta {
    key: PoolKey;
    index: number;
    typeId: string;
    team: BattleTeam;
    level: number;
    life: 'alive' | 'dead';
}

/**
 * Alive / dead InstancedMesh pools for static GLB units. Proxies stay as empty
 * Groups so the sim can keep writing transforms; this layer mirrors them into
 * shared draw calls each frame.
 *
 * Level tint is baked into each pool's materials (keyed by level) so textured
 * models read the hue clearly — instanceColor is only used for battle FX.
 */
export class UnitInstanceRenderer {
    private readonly pools = new Map<PoolKey, Pool>();
    private readonly ownerPool = new WeakMap<Group, PoolMeta>();
    private readonly scene: Scene;
    private needsColor = false;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /** True when this mech should render via instances (static GLB, not FBX). */
    static canInstance(typeId: string): boolean {
        return hasUnitInstanceAsset(typeId);
    }

    register(proxy: Group, typeId: string, team: BattleTeam): void {
        if (this.ownerPool.has(proxy)) return;
        proxy.userData.instanced = true;
        proxy.userData.levelTintLevel = 1;
        this.moveTo(proxy, typeId, team, 'alive', 1);
    }

    /** Tip / rubble: leave the alive pool and park the current pose in dead. */
    setDead(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.life === 'dead') return;
        this.removeFromPool(proxy, meta);
        this.moveTo(proxy, meta.typeId, meta.team, 'dead', meta.level);
        proxy.visible = prefs().renderDeadUnits;
        const next = this.ownerPool.get(proxy);
        if (next) this.writeMatrix(proxy, this.pools.get(next.key)!, next.index);
    }

    /** Round reset: wreck → living formation again. */
    setAlive(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.life === 'alive') return;
        this.removeFromPool(proxy, meta);
        proxy.visible = true;
        this.moveTo(proxy, meta.typeId, meta.team, 'alive', meta.level);
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
     * Battle tint via per-instance color (multiplies the level-tinted material).
     * Golden / debuff / spawning override; `normal` restores white multiply.
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

        proxy.userData.battleTintKind = tint;

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
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.needsColor = true;
    }

    /** Move the proxy into the InstancedMesh pool for this pack level (bakes hue). */
    setLevelTint(proxy: Group, level: number): void {
        const clamped = Math.max(1, Math.min(LEVEL_TINT_COLORS.length - 1, level | 0));
        proxy.userData.levelTintLevel = clamped;
        const meta = this.ownerPool.get(proxy);
        if (!meta) return;
        if (meta.level === clamped) return;
        this.removeFromPool(proxy, meta);
        this.moveTo(proxy, meta.typeId, meta.team, meta.life, clamped);
        const next = this.ownerPool.get(proxy);
        if (next) this.writeMatrix(proxy, this.pools.get(next.key)!, next.index);
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

    /** Live-apply the shadows pref to every pool (and new pools pick it up). */
    applyShadowPref(tier: Prefs['shadows'] = prefs().shadows): void {
        for (const [key, pool] of this.pools) {
            const typeId = key.split(':')[0]!;
            const cast = unitShadowCast(typeId, tier);
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

    private moveTo(
        proxy: Group,
        typeId: string,
        team: BattleTeam,
        life: 'alive' | 'dead',
        level: number,
    ): void {
        const pool = this.pool(typeId, team, life, level);
        if (pool.owners.length >= POOL_CAPACITY) {
            console.warn(`[unitInstances] pool full for ${typeId}/${team}/L${level}/${life}`);
            return;
        }
        const index = pool.owners.length;
        pool.owners.push(proxy);
        this.ownerPool.set(proxy, {
            key: poolKey(typeId, team, level, life),
            index,
            typeId,
            team,
            level,
            life,
        });
        for (const mesh of pool.parts) {
            mesh.count = pool.owners.length;
            mesh.setColorAt(index, _color.setRGB(1, 1, 1));
        }
        this.needsColor = true;
    }

    private removeFromPool(proxy: Group, meta: PoolMeta): void {
        const pool = this.pools.get(meta.key);
        if (!pool) return;
        const last = pool.owners.length - 1;
        const lastOwner = pool.owners[last]!;
        if (meta.index !== last) {
            pool.owners[meta.index] = lastOwner;
            const lastMeta = this.ownerPool.get(lastOwner);
            if (lastMeta) {
                lastMeta.index = meta.index;
                this.ownerPool.set(lastOwner, lastMeta);
            }
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

    private pool(typeId: string, team: BattleTeam, life: 'alive' | 'dead', level: number): Pool {
        const key = poolKey(typeId, team, level, life);
        let pool = this.pools.get(key);
        if (pool) return pool;

        const asset = getUnitInstanceAsset(typeId);
        if (!asset) throw new Error(`[unitInstances] no asset for ${typeId}`);

        const parts = asset.parts.map((part) => makeInstanced(part, typeId, level, team));
        for (const mesh of parts) this.scene.add(mesh);
        pool = { parts, owners: [] };
        this.pools.set(key, pool);
        return pool;
    }
}

function poolKey(typeId: string, team: BattleTeam, level: number, life: 'alive' | 'dead'): PoolKey {
    return `${typeId}:${team}:${level}:${life}`;
}

function unitShadowCast(typeId: string, tier: Prefs['shadows']): boolean {
    if (tier === 'off' || tier === 'low') return false;
    if (tier === 'medium') return STRUCTURE_IDS.has(typeId);
    return true;
}

function makeInstanced(part: InstancePart, typeId: string, level: number, team: BattleTeam): InstancedMesh {
    const mat = part.material.clone();
    const hex = level >= 2 && level < LEVEL_TINT_COLORS.length ? LEVEL_TINT_COLORS[level] : null;
    if (hex != null) {
        _base.copy(mat.color);
        applyLevelTintColor(mat, _base, hex);
        mat.emissive.setRGB(0, 0, 0);
        mat.emissiveIntensity = 0;
    }
    // the neutral horde reads as its own faction: dye its pools pink
    if (team === 'horde') {
        _base.copy(mat.color);
        applyLevelTintColor(mat, _base, HORDE_COLOR.hex, 0.55);
    }
    const mesh = new InstancedMesh(part.geometry.clone(), mat, POOL_CAPACITY);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = unitShadowCast(typeId, prefs().shadows);
    mesh.receiveShadow = true;
    mesh.count = 0;
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
