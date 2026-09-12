import {
    Color,
    DynamicDrawUsage,
    InstancedMesh,
    Matrix4,
    type Group,
    type Object3D,
    type Scene,
} from 'three';
import { HORDE_COLOR, LEVEL_TINT_COLORS, applyLevelTintColor, levelTintMultiplier } from './colors';
import {
    attachWingFlapForModel,
    preserveCrowWingFlap,
    randomWingPhase,
    setCrowWingPhase,
    setCrowWingRate,
    setCrowWingRest,
    setCrowWingBodyRoll,
    setupCrowWingInstanceAttributes,
    swapCrowWingPhase,
    swapCrowWingRate,
    swapCrowWingRest,
    swapCrowWingBodyRoll,
    updateCrowWingFlap,
    usesWingFlapModel,
} from './crowWingFlap';
import { getUnitInstanceAsset, hasUnitInstanceAsset, type InstancePart } from './unitModels';
import { attachBuildingSnow } from './buildingSnow';
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

/** Max mechs per (type × team × alive|dead) pool — cheat spam still fits. */
const POOL_CAPACITY = 4096;

const HIDE = new Matrix4().makeScale(0, 0, 0);
const _matrix = new Matrix4();
const _color = new Color();
const _base = new Color();
const _levelMul = new Color();

type PoolKey = string; // `${typeId}:${team}:alive|dead`

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
    life: 'alive' | 'dead';
}

/**
 * Alive / dead InstancedMesh pools for static GLB units. Proxies stay as empty
 * Groups so the sim can keep writing transforms; this layer mirrors them into
 * shared draw calls each frame.
 *
 * Level tint rides `instanceColor` per mech, NOT a material per level: one
 * pool serves every veterancy, so pools stay at (type × team × alive|dead)
 * instead of multiplying by nine levels. Battle FX tints multiply on top of
 * the level hue in the same channel — see {@link UnitInstanceRenderer.setTint}.
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
        this.moveTo(proxy, typeId, team, 'alive');
    }

    /** Tip / rubble: leave the alive pool and park the current pose in dead. */
    setDead(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.life === 'dead') return;
        this.removeFromPool(proxy, meta);
        this.moveTo(proxy, meta.typeId, meta.team, 'dead');
        // Hammer pancakes stay drawn even when the "render dead units" pref is off
        proxy.visible = prefs().renderDeadUnits || !!proxy.userData.hammerCrushed;
        const next = this.ownerPool.get(proxy);
        if (next) this.writeMatrix(proxy, this.pools.get(next.key)!, next.index);
    }

    /** Round reset: wreck → living formation again. */
    setAlive(proxy: Group): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.life === 'alive') return;
        this.removeFromPool(proxy, meta);
        proxy.visible = true;
        this.moveTo(proxy, meta.typeId, meta.team, 'alive');
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
     * Move an instanced mech into another team's pool (battle convert).
     * No-op when already on that team or not instanced.
     */
    ensureTeam(proxy: Group, team: BattleTeam): void {
        const meta = this.ownerPool.get(proxy);
        if (!meta || meta.team === team) return;
        this.removeFromPool(proxy, meta);
        this.moveTo(proxy, meta.typeId, team, meta.life);
        const next = this.ownerPool.get(proxy);
        if (next) this.writeMatrix(proxy, this.pools.get(next.key)!, next.index);
    }

    /**
     * Battle tint via per-instance color (multiplies the level-tinted material).
     * Golden / debuff / acid / burn / spawning override; `normal` restores white multiply.
     */
    setTint(
        proxy: Group,
        tint: 'normal' | 'golden' | 'debuff' | 'acid' | 'burn' | 'spawning',
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
            // solid gold: multiply hard enough to wash the skin out to bright,
            // saturated gold; the pulse swings the whole body's glow
            const pulse = 1.0 + Math.sin(timeSeconds * 4.5) * 0.45;
            _color.setRGB(pulse * 2.6, pulse * 1.75, 0.0);
        } else if (tint === 'debuff') {
            const t = timeSeconds * 7;
            const amp = Math.min(1, 0.55 + debuffStacks * 0.2);
            _color.setRGB(
                (0.55 + 0.45 * Math.sin(t)) * amp,
                (0.15 + 0.25 * Math.sin(t + 2.4)) * amp,
                (0.45 + 0.4 * Math.sin(t + 4.8)) * amp,
            );
        } else if (tint === 'acid') {
            const t = timeSeconds * 5.5;
            const pulse = 0.5 + 0.5 * Math.sin(t);
            const g = 0.55 + 0.35 * Math.sin(t + 1.2);
            _color.setRGB(0.35 + pulse * 0.25, 1.1 + g * 0.5, 0.2 + pulse * 0.15);
        } else if (tint === 'burn') {
            const t = timeSeconds * 6.2;
            const pulse = 0.5 + 0.5 * Math.sin(t);
            const flicker = 0.5 + 0.5 * Math.sin(t * 2.1 + 0.7);
            _color.setRGB(1.6 + pulse * 0.6, 0.35 + flicker * 0.45, 0.05);
        } else if (tint === 'spawning') {
            const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 6.5);
            const g = 0.45 + spawnProgress * 0.35 + pulse * 0.1;
            _color.setRGB(g, g, g * 1.05);
        } else {
            _color.setRGB(1, 1, 1);
        }

        // Level hue and battle FX share one per-instance colour, so the FX
        // multiplies the veterancy tint rather than erasing it.
        levelTintMultiplier(_levelMul, levelOf(proxy));
        _color.r *= _levelMul.r;
        _color.g *= _levelMul.g;
        _color.b *= _levelMul.b;

        for (const mesh of pool.parts) {
            mesh.setColorAt(meta.index, _color);
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.needsColor = true;
    }

    /** Veterancy hue for one mech — a colour write, no pool move. */
    setLevelTint(proxy: Group, level: number): void {
        const clamped = Math.max(1, Math.min(LEVEL_TINT_COLORS.length - 1, level | 0));
        if (proxy.userData.levelTintLevel === clamped) return;
        proxy.userData.levelTintLevel = clamped;
        const meta = this.ownerPool.get(proxy);
        if (!meta) return;
        const pool = this.pools.get(meta.key);
        if (pool) this.writeLevelColor(proxy, pool, meta.index);
    }

    /**
     * Write the level hue into this instance's colour. Battle FX overwrite it
     * within the frame (setTint runs every frame in combat) and fold it back in.
     */
    private writeLevelColor(proxy: Group, pool: Pool, index: number): void {
        levelTintMultiplier(_color, levelOf(proxy));
        for (const mesh of pool.parts) {
            mesh.setColorAt(index, _color);
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.needsColor = true;
    }

    /** Push proxy world matrices into every alive/dead InstancedMesh. */
    sync(dtSeconds = 0, wingFlapActive = true): void {
        if (dtSeconds > 0 && wingFlapActive) updateCrowWingFlap(dtSeconds);
        const showDead = prefs().renderDeadUnits;
        for (const [key, pool] of this.pools) {
            if (key.endsWith(':dead') && !showDead) {
                // Pref hides normal wrecks; hammer pancakes stay visible via proxy.visible.
                for (let i = 0; i < pool.owners.length; i++) {
                    const proxy = pool.owners[i]!;
                    const meta = this.ownerPool.get(proxy);
                    this.writeMatrix(proxy, pool, i, meta?.typeId);
                }
                for (const mesh of pool.parts) {
                    mesh.count = pool.owners.length;
                    mesh.instanceMatrix.needsUpdate = true;
                    if (this.needsColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                }
                continue;
            }
            for (let i = 0; i < pool.owners.length; i++) {
                const proxy = pool.owners[i]!;
                const meta = this.ownerPool.get(proxy);
                this.writeMatrix(proxy, pool, i, meta?.typeId);
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
            for (const owner of pool.owners) {
                owner.visible = show || !!owner.userData.hammerCrushed;
            }
            for (const mesh of pool.parts) {
                // Always keep pool capacity; writeMatrix HIDEs non-visible wrecks.
                // Zeroing count here used to wipe hammer pancakes entirely.
                mesh.count = pool.owners.length;
                mesh.instanceMatrix.needsUpdate = true;
            }
            for (let i = 0; i < pool.owners.length; i++) {
                const proxy = pool.owners[i]!;
                const meta = this.ownerPool.get(proxy);
                this.writeMatrix(proxy, pool, i, meta?.typeId);
            }
        }
    }

    private moveTo(
        proxy: Group,
        typeId: string,
        team: BattleTeam,
        life: 'alive' | 'dead',
    ): void {
        const pool = this.pool(typeId, team, life);
        if (pool.owners.length >= POOL_CAPACITY) {
            console.warn(`[unitInstances] pool full for ${typeId}/${team}/${life}`);
            return;
        }
        const index = pool.owners.length;
        pool.owners.push(proxy);
        if (usesWingFlapModel(typeId)) {
            const phase =
                typeof proxy.userData.wingPhase === 'number'
                    ? proxy.userData.wingPhase
                    : randomWingPhase();
            proxy.userData.wingPhase = phase;
            proxy.userData.wingFlapRate = 0;
            proxy.userData.wingRest = 0;
            for (const mesh of pool.parts) {
                setCrowWingPhase(mesh, index, phase);
                setCrowWingRate(mesh, index, 0);
                setCrowWingRest(mesh, index, 0);
                setCrowWingBodyRoll(mesh, index, 0);
            }
        }
        this.ownerPool.set(proxy, {
            key: poolKey(typeId, team, life),
            index,
            typeId,
            team,
            life,
        });
        for (const mesh of pool.parts) mesh.count = pool.owners.length;
        this.writeLevelColor(proxy, pool, index);
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
                if (usesWingFlapModel(meta.typeId)) {
                    swapCrowWingPhase(mesh, last, meta.index);
                    swapCrowWingRate(mesh, last, meta.index);
                    swapCrowWingRest(mesh, last, meta.index);
                    swapCrowWingBodyRoll(mesh, last, meta.index);
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

    private writeMatrix(proxy: Group, pool: Pool, index: number, typeId?: string): void {
        if (!isRenderable(proxy)) {
            for (const mesh of pool.parts) mesh.setMatrixAt(index, HIDE);
            return;
        }
        proxy.updateWorldMatrix(true, false);
        for (const mesh of pool.parts) mesh.setMatrixAt(index, proxy.matrixWorld);
        if (typeId && usesWingFlapModel(typeId)) {
            const rate = typeof proxy.userData.wingFlapRate === 'number' ? proxy.userData.wingFlapRate : 0;
            const rest = typeof proxy.userData.wingRest === 'number' ? proxy.userData.wingRest : 0;
            const roll = proxy.rotation.z;
            for (const mesh of pool.parts) {
                setCrowWingRate(mesh, index, rate);
                setCrowWingRest(mesh, index, rest);
                setCrowWingBodyRoll(mesh, index, roll);
            }
        }
    }

    private pool(typeId: string, team: BattleTeam, life: 'alive' | 'dead'): Pool {
        const key = poolKey(typeId, team, life);
        let pool = this.pools.get(key);
        if (pool) return pool;

        const asset = getUnitInstanceAsset(typeId);
        if (!asset) throw new Error(`[unitInstances] no asset for ${typeId}`);

        const parts = asset.parts.map((part) => makeInstanced(part, typeId, team));
        for (const mesh of parts) this.scene.add(mesh);
        pool = { parts, owners: [] };
        this.pools.set(key, pool);
        return pool;
    }
}

function poolKey(typeId: string, team: BattleTeam, life: 'alive' | 'dead'): PoolKey {
    return `${typeId}:${team}:${life}`;
}

/** Veterancy this proxy draws at (1 = untinted). */
function levelOf(proxy: Group): number {
    const v = proxy.userData.levelTintLevel;
    return typeof v === 'number' ? v : 1;
}

function unitShadowCast(typeId: string, tier: Prefs['shadows']): boolean {
    if (tier === 'off' || tier === 'low') return false;
    if (tier === 'medium') return STRUCTURE_IDS.has(typeId);
    return true;
}

function makeInstanced(part: InstancePart, typeId: string, team: BattleTeam): InstancedMesh {
    const mat = part.material.clone();
    if (part.material.userData.wantsBuildingSnow) attachBuildingSnow(mat);
    if (part.material.userData.wantsCrowWingFlap) {
        preserveCrowWingFlap(part.material, mat);
        attachWingFlapForModel(typeId, mat, part.geometry);
    }
    // Level hue is per-instance now (see levelTintMultiplier) — nothing here.
    // the neutral horde reads as its own faction: dye its pools pink
    if (team === 'horde') {
        _base.copy(mat.color);
        applyLevelTintColor(mat, _base, HORDE_COLOR.hex, 0.55);
    }
    const mesh = new InstancedMesh(part.geometry.clone(), mat, POOL_CAPACITY);
    if (usesWingFlapModel(typeId)) setupCrowWingInstanceAttributes(mesh, POOL_CAPACITY);
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
