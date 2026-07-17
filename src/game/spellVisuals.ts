import {
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    DoubleSide,
    Group,
    Line,
    LineBasicMaterial,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { teamColors } from './colors';
import { groundHeightAt } from './map';
import { addCapsuleOutline } from './oilVisuals';
import {
    ACID_ID,
    DRAGON_ID,
    HAMMER_ID,
    HAMMER_ZONE,
    METEOR_SHOWER_ID,
    POISON_CLOUD_ID,
    STORM_ID,
    TACTICS,
    type SpellStamp,
} from './tactics';
import { THEME } from '../theme';

// flat overlays (circles / capsules) sit above the tallest relief mound
const Y_RELIEF = THEME.terrain.reliefDepth;
const Y_FILL = Y_RELIEF + 0.03;
const Y_LINE = Y_RELIEF + 0.038;
/** small lift on draped hammer plates (same idea as unit footprint plates) */
const DRAPE_LIFT = 0.08;

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

/** pending point-strike charge marker (hammer, …) during battle */
export type SpellChargeMarker = {
    tacticId: string;
    x: number;
    z: number;
    radius: number;
    /** sim.elapsed when the strike resolves */
    at: number;
    /** sim.elapsed when the charge rect hits 100% and the FX begins */
    readyAt: number;
    yaw?: number;
};

const BLOCKED_COLOR = 0xff3b30;
const HAMMER_MARK_COLOR = 0xc9a227;

/** capsule tints per tactic — the oil deploy look, recolored */
const CAPSULE_TINTS: Record<string, { fill: number; line: number }> = {
    [ACID_ID]: { fill: 0x2e3a08, line: 0xc9e34a }, // sludgy acid green
    [DRAGON_ID]: { fill: 0x3a140a, line: 0xe07a2e }, // scorched fire path
};

/** Ground markers for placed battle spells + the aim preview. */
export class SpellVisuals {
    readonly group = new Group();
    private hammerTex: Texture | null = null;

    constructor(private readonly scene: Scene) {
        scene.add(this.group);
        this.hammerTex = makeHammerFlatTexture();
    }

    dispose(): void {
        this.clear();
        this.hammerTex?.dispose();
        this.hammerTex = null;
        this.scene.remove(this.group);
    }

    clear(): void {
        for (const child of [...this.group.children]) {
            child.traverse((o) => {
                const mesh = o as Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat && !Array.isArray(mat)) {
                    // shared hammer texture — don't dispose the map here
                    if ((mat as MeshBasicMaterial).map === this.hammerTex) {
                        (mat as MeshBasicMaterial).map = null;
                    }
                    mat.dispose();
                }
            });
            this.group.remove(child);
        }
    }

    sync(stamps: readonly SpellStamp[], draft: SpellDraft | null): void {
        this.clear();
        for (const s of stamps) {
            const radius = TACTICS[s.tacticId]?.radius ?? 8;
            if (s.endX !== undefined && s.endZ !== undefined) {
                const tint = CAPSULE_TINTS[s.tacticId] ?? {
                    fill: s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
                    line: s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
                };
                addCapsuleOutline(
                    this.group, s.x, s.z, s.endX, s.endZ, radius, false, tint.fill, tint.line,
                );
                continue;
            }
            if (s.tacticId === HAMMER_ID) {
                // deploy: outer rect from HAMMER_ZONE (not the old circle)
                this.addHammerMarker(s.x, s.z, null, s.yaw ?? 0);
                continue;
            }
            const color =
                s.tacticId === POISON_CLOUD_ID
                    ? 0x7ec850
                    : s.team === 'player'
                      ? teamColors.player.hex
                      : teamColors.enemy.hex;
            this.addCircle(s.x, s.z, radius, color, 0.24, 0.9);
        }
        if (!draft) return;
        if (draft.startX !== undefined && draft.startZ !== undefined) {
            const tint = draft.blocked
                ? { fill: BLOCKED_COLOR, line: BLOCKED_COLOR }
                : (CAPSULE_TINTS[draft.tacticId] ?? {
                      fill: teamColors.player.hex,
                      line: teamColors.player.hex,
                  });
            addCapsuleOutline(
                this.group, draft.startX, draft.startZ, draft.x, draft.z,
                draft.radius, true, tint.fill, tint.line,
            );
        } else if (draft.tacticId === HAMMER_ID) {
            const yaw = draft.yaw ?? 0;
            if (draft.blocked) {
                this.addRect(
                    draft.x, draft.z,
                    HAMMER_ZONE.halfWidth, HAMMER_ZONE.halfDepth, yaw,
                    BLOCKED_COLOR, 0.18, 0.75,
                );
            } else {
                this.addHammerMarker(draft.x, draft.z, 0.5, yaw);
            }
        } else {
            const color = draft.blocked ? BLOCKED_COLOR : teamColors.player.hex;
            this.addCircle(draft.x, draft.z, draft.radius, color, 0.18, 0.75);
        }
    }

    /**
     * Battle-time markers: ticking zones + hammer charge rect.
     * TEMP: hammer rect STAYS after the smash so we can finetune HAMMER_ZONE.
     */
    syncBattleMarkers(
        zones: readonly { tacticId: string; x: number; z: number; radius: number }[],
        charges: readonly SpellChargeMarker[],
        now: number,
    ): void {
        this.clear();
        const pulse = 0.75 + 0.25 * Math.sin(now * 3.2);
        for (const m of zones) {
            if (m.tacticId === POISON_CLOUD_ID) {
                this.addCircle(m.x, m.z, m.radius, 0x7ec850, 0.26 * pulse, 0.9);
                continue;
            }
            if (m.tacticId === STORM_ID) {
                this.addCircle(m.x, m.z, m.radius, 0x6a6ab0, 0, 0.55 * pulse);
                continue;
            }
            if (m.tacticId === METEOR_SHOWER_ID) {
                this.addCircle(m.x, m.z, m.radius, 0xe0762e, 0, 0.55 * pulse);
                continue;
            }
        }
        for (const c of charges) {
            if (c.tacticId !== HAMMER_ID) continue;
            // gone once the hammer drop begins (charge rect has filled)
            if (now >= c.readyAt) continue;
            const progress = MathUtils.clamp(c.readyAt > 0 ? now / c.readyAt : 1, 0, 1);
            this.addHammerMarker(c.x, c.z, 0.5 + 0.5 * progress, c.yaw ?? 0);
        }
    }

    /**
     * Hammer target = rectangle from HAMMER_ZONE (+ decal + optional inner charge).
     * Tune halfWidth / halfDepth in tactics.ts → HAMMER_ZONE; yaw comes from placement.
     */
    private addHammerMarker(x: number, z: number, innerFrac: number | null, yaw: number): void {
        const { halfWidth: hw, halfDepth: hd } = HAMMER_ZONE;
        this.addRect(x, z, hw, hd, yaw, HAMMER_MARK_COLOR, 0.16, 0.95);
        this.addHammerDecal(x, z, Math.max(hw, hd), yaw);
        if (innerFrac !== null) {
            const f = MathUtils.clamp(innerFrac, 0.5, 1);
            this.addRect(x, z, hw * f, hd * f, yaw, 0xffe08a, 0.12, 1);
        }
    }

    private addHammerDecal(x: number, z: number, size: number, yaw: number): void {
        if (!this.hammerTex) return;
        const half = size * 0.5;
        const mesh = new Mesh(
            drapeRectGeometry(half, half, yaw, x, z),
            new MeshBasicMaterial({
                map: this.hammerTex,
                transparent: true,
                opacity: 0.72,
                side: DoubleSide,
                depthWrite: false,
            }),
        );
        mesh.position.set(x, DRAPE_LIFT + 0.02, z);
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    private addRect(
        x: number,
        z: number,
        halfW: number,
        halfD: number,
        yaw: number,
        color: number,
        fillOpacity: number,
        lineOpacity: number,
    ): void {
        if (fillOpacity > 0) {
            const fill = new Mesh(
                drapeRectGeometry(halfW, halfD, yaw, x, z),
                new MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: fillOpacity,
                    side: DoubleSide,
                    depthWrite: false,
                }),
            );
            fill.position.set(x, DRAPE_LIFT, z);
            fill.frustumCulled = false;
            this.group.add(fill);
        }
        this.group.add(
            new Line(
                drapeRectOutline(x, z, halfW, halfD, yaw),
                new LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
            ),
        );
    }

    private addCircle(
        x: number,
        z: number,
        radius: number,
        color: number,
        fillOpacity: number,
        lineOpacity: number,
    ): void {
        if (fillOpacity > 0) {
            const disc = new Mesh(
                new CircleGeometry(radius, 48),
                new MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: fillOpacity,
                    side: DoubleSide,
                    depthWrite: false,
                }),
            );
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(x, Y_FILL, z);
            this.group.add(disc);
        }
        this.group.add(
            new Line(
                new BufferGeometry().setFromPoints(
                    Array.from({ length: 49 }, (_, i) => {
                        const a = (i / 48) * Math.PI * 2;
                        return new Vector3(
                            x + Math.cos(a) * radius,
                            Y_LINE,
                            z + Math.sin(a) * radius,
                        );
                    }),
                ),
                new LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
            ),
        );
    }
}

/**
 * Tessellated ground-aligned rect, yawed in XZ, draped over board relief
 * (same approach as unit footprint plates in placement.ts).
 * Vertices are local to the stamp center — caller sets mesh.position to (x, lift, z).
 */
function drapeRectGeometry(
    halfW: number,
    halfD: number,
    yaw: number,
    cx: number,
    cz: number,
): PlaneGeometry {
    const segsW = Math.max(2, Math.ceil((halfW * 2) / 2));
    const segsD = Math.max(2, Math.ceil((halfD * 2) / 2));
    const geo = new PlaneGeometry(halfW * 2, halfD * 2, segsW, segsD);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = lx * c - lz * s;
        const wz = lx * s + lz * c;
        pos.setXYZ(i, wx, groundHeightAt(cx + wx, cz + wz), wz);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

/** Closed outline of a yawed rect, sampled densely and draped on the relief. */
function drapeRectOutline(
    cx: number,
    cz: number,
    halfW: number,
    halfD: number,
    yaw: number,
): BufferGeometry {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const edge = (ax: number, az: number, bx: number, bz: number, steps: number) => {
        const out: Vector3[] = [];
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const lx = ax + (bx - ax) * t;
            const lz = az + (bz - az) * t;
            const wx = cx + lx * c - lz * s;
            const wz = cz + lx * s + lz * c;
            out.push(new Vector3(wx, groundHeightAt(wx, wz) + DRAPE_LIFT + 0.01, wz));
        }
        return out;
    };
    const steps = Math.max(4, Math.ceil(Math.max(halfW, halfD)));
    const pts = [
        ...edge(-halfW, -halfD, halfW, -halfD, steps),
        ...edge(halfW, -halfD, halfW, halfD, steps),
        ...edge(halfW, halfD, -halfW, halfD, steps),
        ...edge(-halfW, halfD, -halfW, -halfD, steps),
    ];
    // close the loop
    pts.push(pts[0]!.clone());
    return new BufferGeometry().setFromPoints(pts);
}

/** Flat golden warhammer silhouette for the ground charge marker. */
function makeHammerFlatTexture(): Texture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.scale(size / 256, size / 256);

    const glow = ctx.createRadialGradient(0, 0, 20, 0, 0, 110);
    glow.addColorStop(0, 'rgba(40, 28, 8, 0.55)');
    glow.addColorStop(1, 'rgba(40, 28, 8, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d4b24a';
    ctx.strokeStyle = '#5a4010';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(-70, -78);
    ctx.lineTo(70, -78);
    ctx.lineTo(62, -28);
    ctx.lineTo(-62, -28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f0d47a';
    ctx.fillRect(-18, -72, 36, 38);

    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.moveTo(-12, -28);
    ctx.lineTo(12, -28);
    ctx.lineTo(10, 88);
    ctx.lineTo(-10, 88);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 96, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const tex = new CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
}
