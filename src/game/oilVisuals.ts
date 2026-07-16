import {
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three';
import { OIL_SPILL_RADIUS, type HazardField } from './fire';
import type { BattleMap } from './map';

const Y_LIFT = 0.055;
/** radial segments for draft / stamp-style circles */
const CIRCLE_SEGMENTS = 48;
/** concentric rings so the disc can bend over hills (not a flat fan) */
const CIRCLE_RINGS = 10;

/**
 * Visual oil puddles — cosmetic only. Tessellated and draped on terrain
 * height like placement footprint plates. Sim never reads this.
 */
export class OilVisuals {
    private readonly fieldMesh: Mesh;
    private readonly draft: Mesh;
    private readonly fieldMat: MeshBasicMaterial;
    private readonly draftMat: MeshBasicMaterial;
    /** rebuild field mesh only when oil cells change */
    private lastOilKey = '';

    constructor(
        private readonly scene: Scene,
        private readonly map: BattleMap,
    ) {
        this.fieldMat = new MeshBasicMaterial({
            color: 0x1a1408,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
            side: DoubleSide,
        });
        this.draftMat = new MeshBasicMaterial({
            color: 0x2a2010,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            side: DoubleSide,
        });
        this.fieldMesh = new Mesh(new BufferGeometry(), this.fieldMat);
        this.fieldMesh.frustumCulled = false;
        this.fieldMesh.visible = false;
        this.scene.add(this.fieldMesh);

        this.draft = new Mesh(new BufferGeometry(), this.draftMat);
        this.draft.frustumCulled = false;
        this.draft.visible = false;
        this.scene.add(this.draft);
    }

    /** show placement preview disc under the cursor — draped on relief */
    setDraft(x: number | null, z: number | null, radius = OIL_SPILL_RADIUS): void {
        if (x === null || z === null) {
            this.draft.visible = false;
            return;
        }
        this.draft.geometry.dispose();
        this.draft.geometry = drapedCircleGeometry(this.map, x, z, radius, CIRCLE_SEGMENTS, CIRCLE_RINGS);
        this.draft.position.set(x, Y_LIFT, z);
        this.draft.visible = true;
    }

    sync(field: HazardField): void {
        const key = oilFieldKey(field);
        if (key === this.lastOilKey) {
            this.fieldMesh.visible = key.length > 0;
            return;
        }
        this.lastOilKey = key;
        this.fieldMesh.geometry.dispose();
        if (!key) {
            this.fieldMesh.geometry = new BufferGeometry();
            this.fieldMesh.visible = false;
            return;
        }
        this.fieldMesh.geometry = drapedOilCellsGeometry(this.map, field);
        this.fieldMesh.position.set(0, Y_LIFT, 0);
        this.fieldMesh.visible = true;
    }

    dispose(): void {
        this.scene.remove(this.draft);
        this.scene.remove(this.fieldMesh);
        this.draft.geometry.dispose();
        this.fieldMesh.geometry.dispose();
        this.draftMat.dispose();
        this.fieldMat.dispose();
    }
}

/** cheap content hash so we don't rebuild every frame */
function oilFieldKey(field: HazardField): string {
    const parts: number[] = [];
    for (let i = 0; i < field.oilExpires.length; i++) {
        if (field.oilExpires[i]!) parts.push(i);
    }
    return parts.join(',');
}

/**
 * Concentric-ring circle in XZ, vertex Y = map.heightAt(center + local).
 * Same drape idea as {@link PlacementController}'s footprint plates.
 */
function drapedCircleGeometry(
    map: BattleMap,
    cx: number,
    cz: number,
    radius: number,
    segments: number,
    rings: number,
): BufferGeometry {
    // CircleGeometry is a fan (flat). Build a ring grid instead so hills bend.
    const verts: number[] = [];
    const indices: number[] = [];
    // center
    verts.push(0, map.heightAt(cx, cz), 0);
    for (let r = 1; r <= rings; r++) {
        const t = r / rings;
        const rad = radius * t;
        for (let s = 0; s < segments; s++) {
            const a = (s / segments) * Math.PI * 2;
            const lx = Math.cos(a) * rad;
            const lz = Math.sin(a) * rad;
            verts.push(lx, map.heightAt(cx + lx, cz + lz), lz);
        }
    }
    // inner fan: center → ring 1
    for (let s = 0; s < segments; s++) {
        const a = 1 + s;
        const b = 1 + ((s + 1) % segments);
        indices.push(0, a, b);
    }
    // rings
    for (let r = 1; r < rings; r++) {
        const row = 1 + (r - 1) * segments;
        const next = 1 + r * segments;
        for (let s = 0; s < segments; s++) {
            const s1 = (s + 1) % segments;
            const i0 = row + s;
            const i1 = row + s1;
            const i2 = next + s1;
            const i3 = next + s;
            indices.push(i0, i3, i1);
            indices.push(i1, i3, i2);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(indices);
    return geo;
}

/**
 * One draped quad per oil cell (cell corners follow terrain) — handles
 * irregular merged/burned oil shapes, not only perfect circles.
 */
function drapedOilCellsGeometry(map: BattleMap, field: HazardField): BufferGeometry {
    const verts: number[] = [];
    const indices: number[] = [];
    let base = 0;
    const hs = field.cellSize * 0.5;

    field.forEachOilCell((x, z) => {
        const x0 = x - hs;
        const x1 = x + hs;
        const z0 = z - hs;
        const z1 = z + hs;
        // slight overlap so adjacent cells don't show grass seams
        const pad = 0.08;
        const xa = x0 - pad;
        const xb = x1 + pad;
        const za = z0 - pad;
        const zb = z1 + pad;
        verts.push(
            xa, map.heightAt(xa, za), za,
            xb, map.heightAt(xb, za), za,
            xb, map.heightAt(xb, zb), zb,
            xa, map.heightAt(xa, zb), zb,
        );
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
    });

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(indices);
    return geo;
}
