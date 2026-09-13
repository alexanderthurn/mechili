import {
    Group,
    LineBasicMaterial,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three';
import { teamColors } from './colors';
import {
    addDrapedCapsule,
    addDrapedCircle,
    addDrapedCircleFill,
    addDrapedIconDecal,
    addDrapedRect,
    addDrapedRectFill,
    drapeYawToward,
    rebuildDrapedCircleFill,
    rebuildDrapedRectFill,
} from './groundMarkers';
import { addCapsuleOutline } from './oilVisuals';
import { SpellIconTextures } from './spellMarkerIcons';
import type { TypeRegistry } from './content/typeRegistry';
import { markerColor, type SafeZoneDisk, type SpellStamp } from './tactics';

/** the aim preview riding the cursor while a spell is armed; two-point drafts
 *  additionally carry the already-placed start */
export type SpellDraft = {
    tacticId: string;
    x: number;
    z: number;
    radius: number;
    blocked: boolean;
    /** footprint orientation (hammer point-yaw) */
    yaw?: number;
    startX?: number;
    startZ?: number;
};

/** pending charge marker during battle (fills until readyAt, then clears) */
export type SpellChargeMarker = {
    tacticId: string;
    x: number;
    z: number;
    radius: number;
    /** sim.elapsed when the effect resolves / zone starts */
    at: number;
    /** sim.elapsed when the charge hits 100% and the marker clears */
    readyAt: number;
    yaw?: number;
    /** dragon / capsule charges */
    endX?: number;
    endZ?: number;
};

const BLOCKED_COLOR = 0xff3b30;
const RECT_MARK_COLOR = 0xc9a227;

type ZonePulse = {
    fill?: MeshBasicMaterial;
    line: LineBasicMaterial;
    fillBase: number;
    lineBase: number;
};

/** inner charge fill — geometry rebuilt each frame from 50% → 100% radius */
type ChargeInner =
    | { mesh: Mesh; readyAt: number; kind: 'circle'; x: number; z: number; radius: number }
    | {
          mesh: Mesh;
          readyAt: number;
          kind: 'rect';
          x: number;
          z: number;
          halfW: number;
          halfD: number;
          yaw: number;
      };

/** Ground markers for placed battle spells + the aim preview. */
export class SpellVisuals {
    readonly group = new Group();
    /** long-lived zone rings — rebuilt only when the active-zone set changes */
    private readonly zoneGroup = new Group();
    /** charge outer+icon — rebuilt when the active charge set changes */
    private readonly chargeGroup = new Group();
    /** keep-out disks while a respectsSafeZone tactic is armed */
    private readonly safeZoneGroup = new Group();
    private readonly icons: SpellIconTextures;
    private zoneKey = '';
    private zonePulse: ZonePulse[] = [];
    private chargeKey = '';
    private chargeInners: ChargeInner[] = [];
    private safeZoneKey = '';

    constructor(
        private readonly scene: Scene,
        private readonly types: TypeRegistry,
    ) {
        this.icons = new SpellIconTextures(types);
        scene.add(this.group);
        this.group.add(this.zoneGroup);
        this.group.add(this.chargeGroup);
        this.group.add(this.safeZoneGroup);
    }

    /** the spell's capsule colours from its marker data, else the team colour */
    private capsuleTint(tacticId: string, fallback: number): { fill: number; line: number } {
        const capsule = this.types.tactic(tacticId)?.marker?.capsule;
        return capsule ? { fill: markerColor(capsule.fill), line: markerColor(capsule.line) } : { fill: fallback, line: fallback };
    }

    /** the spell's circle colour from its marker data, else the team colour */
    private circleColor(tacticId: string, fallback: number): number {
        const circle = this.types.tactic(tacticId)?.marker?.circle;
        return circle ? markerColor(circle) : fallback;
    }

    /** rectangular strike footprint (hammer), if the spell has one */
    private strikeRect(tacticId: string): { halfWidth: number; halfDepth: number } | null {
        return this.types.tactic(tacticId)?.spell?.strike?.rect ?? null;
    }

    dispose(): void {
        this.clear();
        this.icons.dispose();
        this.scene.remove(this.group);
    }

    clear(): void {
        this.clearGroup(this.zoneGroup);
        this.clearGroup(this.chargeGroup);
        this.clearGroup(this.safeZoneGroup);
        this.clearDeployMarkers();
        this.zoneKey = '';
        this.chargeKey = '';
        this.safeZoneKey = '';
        this.zonePulse = [];
        this.chargeInners = [];
    }

    /**
     * Enemy-base keep-out disks for an armed respectsSafeZone tactic.
     * Rebuilds only when the disk set changes; clear with an empty list.
     */
    syncSafeZones(disks: readonly SafeZoneDisk[]): void {
        const key = disks
            .map((d) => `${d.x.toFixed(1)},${d.z.toFixed(1)},${d.radius.toFixed(1)}`)
            .join('|');
        if (key === this.safeZoneKey) return;
        this.safeZoneKey = key;
        this.clearGroup(this.safeZoneGroup);
        for (const d of disks) {
            addDrapedCircle(
                this.safeZoneGroup,
                d.x,
                d.z,
                d.radius,
                BLOCKED_COLOR,
                0.16,
                0.65,
            );
        }
    }

    sync(stamps: readonly SpellStamp[], draft: SpellDraft | null): void {
        // deploy markers only — safe-zone disks are owned by syncSafeZones
        this.clearDeployMarkers();
        for (const s of stamps) {
            const radius = this.types.tactic(s.tacticId)?.radius ?? 8;
            if (s.endX !== undefined && s.endZ !== undefined) {
                const tint = this.capsuleTint(
                    s.tacticId,
                    s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
                );
                this.addCapsuleSpellMarker(
                    s.tacticId, s.x, s.z, s.endX, s.endZ, radius, tint.fill, tint.line, false,
                );
                continue;
            }
            const rect = this.strikeRect(s.tacticId);
            if (rect) {
                this.addRectMarker(s.tacticId, rect, s.x, s.z, null, s.yaw ?? 0);
                continue;
            }
            const color = this.circleColor(
                s.tacticId,
                s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
            );
            this.addCircleSpellMarker(s.tacticId, s.x, s.z, radius, color, 0.24, 0.9);
        }
        if (!draft) return;
        if (draft.startX !== undefined && draft.startZ !== undefined) {
            const tint = draft.blocked
                ? { fill: BLOCKED_COLOR, line: BLOCKED_COLOR }
                : this.capsuleTint(draft.tacticId, teamColors.player.hex);
            const dx = draft.x - draft.startX;
            const dz = draft.z - draft.startZ;
            if (dx * dx + dz * dz > 0.25) {
                addDrapedCircle(
                    this.group,
                    draft.startX,
                    draft.startZ,
                    draft.radius * 0.32,
                    tint.fill,
                    0.28,
                    0.75,
                );
            }
            this.addCapsuleSpellMarker(
                draft.tacticId, draft.startX, draft.startZ, draft.x, draft.z,
                draft.radius, tint.fill, tint.line, true,
            );
        } else if (this.strikeRect(draft.tacticId)) {
            const rect = this.strikeRect(draft.tacticId)!;
            const yaw = draft.yaw ?? 0;
            if (draft.blocked) {
                addDrapedRect(
                    this.group, draft.x, draft.z,
                    rect.halfWidth, rect.halfDepth, yaw,
                    BLOCKED_COLOR, 0.18, 0.75,
                );
            } else {
                this.addRectMarker(draft.tacticId, rect, draft.x, draft.z, 0.5, yaw);
            }
        } else {
            const color = draft.blocked
                ? BLOCKED_COLOR
                : this.circleColor(draft.tacticId, teamColors.player.hex);
            this.addCircleSpellMarker(
                draft.tacticId, draft.x, draft.z, draft.radius, color,
                draft.blocked ? 0.18 : 0.18, draft.blocked ? 0.55 : 0.75,
            );
        }
    }

    /**
     * Battle-time markers: ticking zones (cached) + charge fills.
     * Outer shape + icon are static; inner fill scales 50%→100% smoothly.
     * At readyAt (scale hits 1.0) the whole charge marker is removed.
     */
    syncBattleMarkers(
        zones: readonly { tacticId: string; x: number; z: number; radius: number }[],
        charges: readonly SpellChargeMarker[],
        now: number,
    ): void {
        // never leave deploy/draft stamps under the battle markers
        this.clearDeployMarkers();

        const zKey = zones
            .map((m) => `${m.tacticId}:${m.x.toFixed(1)},${m.z.toFixed(1)},${m.radius.toFixed(1)}`)
            .join('|');
        if (zKey !== this.zoneKey) {
            this.clearGroup(this.zoneGroup);
            this.zonePulse = [];
            this.zoneKey = zKey;
            for (const m of zones) {
                const ring = this.types.tactic(m.tacticId)?.marker?.zoneRing;
                if (ring) {
                    this.zonePulse.push(this.addZoneRing(m.x, m.z, m.radius, markerColor(ring.color), ring.fill, ring.line));
                }
            }
        }
        const pulse = 0.75 + 0.25 * Math.sin(now * 3.2);
        for (const p of this.zonePulse) {
            if (p.fill) p.fill.opacity = p.fillBase * pulse;
            p.line.opacity = p.lineBase * (p.fillBase > 0 ? 1 : pulse);
        }

        const active = charges.filter((c) => now < c.readyAt);
        const cKey = active
            .map(
                (c) =>
                    `${c.tacticId}:${c.x.toFixed(1)},${c.z.toFixed(1)},${c.radius.toFixed(1)},${c.yaw ?? 0},${c.endX ?? ''},${c.endZ ?? ''},${c.readyAt.toFixed(2)}`,
            )
            .join('|');
        if (cKey !== this.chargeKey) {
            this.chargeKey = cKey;
            this.clearGroup(this.chargeGroup);
            this.chargeInners = [];
            for (const c of active) {
                this.spawnChargeMarker(c);
            }
        }

        for (const inner of this.chargeInners) {
            const progress = MathUtils.clamp(
                inner.readyAt > 0 ? now / inner.readyAt : 1,
                0,
                1,
            );
            const s = 0.5 + 0.5 * progress;
            if (inner.kind === 'circle') {
                rebuildDrapedCircleFill(inner.mesh, inner.x, inner.z, inner.radius * s);
            } else {
                rebuildDrapedRectFill(
                    inner.mesh, inner.x, inner.z, inner.halfW * s, inner.halfD * s, inner.yaw,
                );
            }
        }
    }

    /** remove leftover build-phase stamps sitting as siblings of zone/charge groups */
    private clearDeployMarkers(): void {
        for (const child of [...this.group.children]) {
            if (
                child === this.zoneGroup ||
                child === this.chargeGroup ||
                child === this.safeZoneGroup
            ) {
                continue;
            }
            child.traverse((o) => {
                const mesh = o as Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat && !Array.isArray(mat)) {
                    const map = (mat as MeshBasicMaterial).map;
                    if (this.icons.owns(map)) {
                        (mat as MeshBasicMaterial).map = null;
                    }
                    mat.dispose();
                }
            });
            this.group.remove(child);
        }
    }

    private spawnChargeMarker(c: SpellChargeMarker): void {
        const chargeRect = this.strikeRect(c.tacticId);
        if (chargeRect) {
            const yaw = c.yaw ?? 0;
            const { halfWidth: hw, halfDepth: hd } = chargeRect;
            addDrapedRect(this.chargeGroup, c.x, c.z, hw, hd, yaw, RECT_MARK_COLOR, 0.16, 0.95);
            this.addRectDecal(c.tacticId, c.x, c.z, Math.max(hw, hd), yaw, this.chargeGroup);
            const fill = addDrapedRectFill(
                this.chargeGroup, c.x, c.z, hw, hd, yaw, 0xffe08a, 0.12,
            );
            this.chargeInners.push({
                mesh: fill,
                readyAt: c.readyAt,
                kind: 'rect',
                x: c.x,
                z: c.z,
                halfW: hw,
                halfD: hd,
                yaw,
            });
            return;
        }
        if (c.endX !== undefined && c.endZ !== undefined) {
            const tint = this.capsuleTint(c.tacticId, teamColors.player.hex);
            addDrapedCapsule(
                this.chargeGroup, c.x, c.z, c.endX, c.endZ, c.radius,
                tint.fill, tint.line, 0.16, 0.9,
            );
            this.addCapsuleIcon(c.tacticId, c.x, c.z, c.endX, c.endZ, c.radius, this.chargeGroup);
            // growing disc at path midpoint (capsule verts aren't locally centered)
            const mx = (c.x + c.endX) * 0.5;
            const mz = (c.z + c.endZ) * 0.5;
            const fill = addDrapedCircleFill(this.chargeGroup, mx, mz, c.radius, 0xffa060, 0.14);
            this.chargeInners.push({
                mesh: fill,
                readyAt: c.readyAt,
                kind: 'circle',
                x: mx,
                z: mz,
                radius: c.radius,
            });
            return;
        }
        const color = this.circleColor(c.tacticId, teamColors.player.hex);
        addDrapedCircle(this.chargeGroup, c.x, c.z, c.radius, color, 0.16, 0.9);
        this.addCircleIcon(c.tacticId, c.x, c.z, c.radius, this.chargeGroup);
        const fill = addDrapedCircleFill(this.chargeGroup, c.x, c.z, c.radius, 0xffe08a, 0.12);
        this.chargeInners.push({
            mesh: fill,
            readyAt: c.readyAt,
            kind: 'circle',
            x: c.x,
            z: c.z,
            radius: c.radius,
        });
    }

    private addZoneRing(
        x: number,
        z: number,
        radius: number,
        color: number,
        fillBase: number,
        lineBase: number,
    ): ZonePulse {
        const { fill, line } = addDrapedCircle(
            this.zoneGroup, x, z, radius, color, fillBase, lineBase,
        );
        return {
            fill: fillBase > 0 ? (fill?.material as MeshBasicMaterial) : undefined,
            line: line.material as LineBasicMaterial,
            fillBase,
            lineBase,
        };
    }

    private clearGroup(group: Group): void {
        for (const child of [...group.children]) {
            child.traverse((o) => {
                const mesh = o as Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat && !Array.isArray(mat)) {
                    const map = (mat as MeshBasicMaterial).map;
                    if (this.icons.owns(map)) {
                        (mat as MeshBasicMaterial).map = null;
                    }
                    mat.dispose();
                }
            });
            group.remove(child);
        }
    }

    private addCircleSpellMarker(
        tacticId: string,
        x: number,
        z: number,
        radius: number,
        color: number,
        fillOpacity: number,
        lineOpacity: number,
        innerFrac?: number,
        target: Group = this.group,
    ): void {
        addDrapedCircle(target, x, z, radius, color, fillOpacity, lineOpacity);
        this.addCircleIcon(tacticId, x, z, radius, target);
        if (innerFrac !== undefined) {
            const f = MathUtils.clamp(innerFrac, 0.5, 1);
            addDrapedCircle(target, x, z, radius * f, 0xffe08a, 0.12, 1);
        }
    }

    private addCapsuleSpellMarker(
        tacticId: string,
        startX: number,
        startZ: number,
        endX: number,
        endZ: number,
        radius: number,
        fillColor: number,
        lineColor: number,
        draft: boolean,
    ): void {
        addCapsuleOutline(
            this.group, startX, startZ, endX, endZ, radius, draft, fillColor, lineColor,
        );
        this.addCapsuleIcon(tacticId, startX, startZ, endX, endZ, radius);
    }

    private addCircleIcon(
        tacticId: string,
        x: number,
        z: number,
        radius: number,
        target: Group = this.group,
    ): void {
        const tex = this.icons.textureFor(tacticId);
        if (!tex) return;
        addDrapedIconDecal(target, tex, x, z, radius * 0.72);
    }

    private addCapsuleIcon(
        tacticId: string,
        startX: number,
        startZ: number,
        endX: number,
        endZ: number,
        radius: number,
        target: Group = this.group,
    ): void {
        const tex = this.icons.textureFor(tacticId);
        if (!tex) return;
        const mx = (startX + endX) * 0.5;
        const mz = (startZ + endZ) * 0.5;
        const yaw = drapeYawToward(startX, startZ, endX, endZ);
        addDrapedIconDecal(target, tex, mx, mz, radius * 0.85, yaw);
    }

    /**
     * Rectangular strike target (hammer): the spell's `strike.rect` (+ decal +
     * optional inner charge); yaw comes from placement.
     */
    private addRectMarker(
        tacticId: string,
        rect: { halfWidth: number; halfDepth: number },
        x: number,
        z: number,
        innerFrac: number | null,
        yaw: number,
        target: Group = this.group,
    ): void {
        const { halfWidth: hw, halfDepth: hd } = rect;
        addDrapedRect(target, x, z, hw, hd, yaw, RECT_MARK_COLOR, 0.16, 0.95);
        this.addRectDecal(tacticId, x, z, Math.max(hw, hd), yaw, target);
        if (innerFrac !== null) {
            const f = MathUtils.clamp(innerFrac, 0.5, 1);
            addDrapedRect(target, x, z, hw * f, hd * f, yaw, 0xffe08a, 0.12, 1);
        }
    }

    private addRectDecal(
        tacticId: string,
        x: number,
        z: number,
        size: number,
        yaw: number,
        target: Group = this.group,
    ): void {
        const tex = this.icons.textureFor(tacticId);
        if (!tex) return;
        addDrapedIconDecal(target, tex, x, z, size * 0.5, yaw);
    }
}
