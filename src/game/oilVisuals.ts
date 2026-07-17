import {
    BufferGeometry,
    CircleGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Vector3,
    type Scene,
} from 'three';
import type { HazardField } from './fire';
import type { BattleMap } from './map';
import type { OilStamp } from './tactics';
import { THEME } from '../theme';

const Y_RELIEF = THEME.terrain.reliefDepth;
const Y_FILL = Y_RELIEF + 0.028;
const Y_LINE = Y_RELIEF + 0.036;

/** dark oil fill / rim during deployment (intent, not yet on the hazard field) */
const OIL_FILL = 0x2a1c0a;
const OIL_LINE = 0x8a6a28;

export type OilDraft = {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    radius: number;
};

/**
 * Oil/fire ground look: hazard mask for committed oil/fire, plus deploy-phase
 * capsule outlines (rally-style) for pending stamps.
 */
export class OilVisuals {
    private draft: OilDraft | null = null;
    private lastKey = '';
    private lastNow = -1;
    private readonly outline = new Group();

    constructor(
        private readonly scene: Scene,
        private readonly map: BattleMap,
    ) {
        scene.add(this.outline);
    }

    setDraft(draft: OilDraft | null): void {
        if (!draft) {
            if (this.draft) {
                this.draft = null;
                this.lastKey = '';
            }
            return;
        }
        if (
            this.draft &&
            this.draft.startX === draft.startX &&
            this.draft.startZ === draft.startZ &&
            this.draft.endX === draft.endX &&
            this.draft.endZ === draft.endZ &&
            this.draft.radius === draft.radius
        ) {
            return;
        }
        this.draft = { ...draft };
        this.lastKey = '';
    }

    /**
     * Sync committed oil/fire mask + deploy outlines for stamps/draft.
     * Pass `stamps` during build; empty during battle (oil is on the field).
     */
    sync(
        field: HazardField,
        now = 0,
        stamps: readonly OilStamp[] = [],
        showOutlines = true,
    ): void {
        const key = hazardKey(field, now, this.draft, stamps, showOutlines);
        if (key === this.lastKey && Math.abs(now - this.lastNow) < 0.05) return;
        this.lastKey = key;
        this.lastNow = now;
        // committed puddles only — no draft soft-stamp (outlines carry intent)
        this.map.syncHazardFromField(field, now, null);
        this.clearOutlines();
        if (!showOutlines) return;
        for (const s of stamps) {
            this.addCapsule(s.startX, s.startZ, s.endX, s.endZ, s.radius, false);
        }
        if (this.draft) {
            this.addCapsule(
                this.draft.startX,
                this.draft.startZ,
                this.draft.endX,
                this.draft.endZ,
                this.draft.radius,
                true,
            );
        }
    }

    dispose(): void {
        this.clearOutlines();
        this.scene.remove(this.outline);
        this.draft = null;
    }

    private clearOutlines(): void {
        for (const child of [...this.outline.children]) {
            child.traverse((o) => {
                const mesh = o as Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat && !Array.isArray(mat)) mat.dispose();
            });
            this.outline.remove(child);
        }
    }

    private addCapsule(
        startX: number,
        startZ: number,
        endX: number,
        endZ: number,
        radius: number,
        draft: boolean,
    ): void {
        addCapsuleOutline(this.outline, startX, startZ, endX, endZ, radius, draft, OIL_FILL, OIL_LINE);
    }
}

/**
 * The oil-style deploy capsule (fill + rim circles + side lines), reusable by
 * other tactics with their own tint (acid, dragon path). Render-only.
 */
export function addCapsuleOutline(
    group: Group,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    radius: number,
    draft: boolean,
    fillColor: number,
    lineColor: number,
): void {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.hypot(dx, dz);
    const fillOpacity = draft ? 0.18 : 0.26;
    const lineOpacity = draft ? 0.55 : 0.85;
    const fillMat = new MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        side: DoubleSide,
        depthWrite: false,
    });
    const lineMat = new LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: lineOpacity,
    });

    if (len < 0.5) {
        const disc = new Mesh(new CircleGeometry(radius, 48), fillMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(startX, Y_FILL, startZ);
        group.add(disc);
        group.add(circleRing(startX, startZ, radius, lineMat));
        return;
    }

    const ux = dx / len;
    const uz = dz / len;
    const px = -uz * radius;
    const pz = ux * radius;
    group.add(new Mesh(buildCapsuleFill(startX, startZ, endX, endZ, px, pz, ux, uz, radius), fillMat));
    for (const [x, z] of [
        [startX, startZ],
        [endX, endZ],
    ] as const) {
        const disc = new Mesh(new CircleGeometry(radius, 48), fillMat.clone());
        (disc.material as MeshBasicMaterial).opacity = fillOpacity + 0.06;
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, Y_FILL + 0.002, z);
        group.add(disc);
        group.add(circleRing(x, z, radius, lineMat));
    }
    for (const [x0, z0, x1, z1] of [
        [startX + px, startZ + pz, endX + px, endZ + pz],
        [startX - px, startZ - pz, endX - px, endZ - pz],
    ] as const) {
        const geo = new BufferGeometry();
        geo.setAttribute(
            'position',
            new Float32BufferAttribute([x0, Y_LINE, z0, x1, Y_LINE, z1], 3),
        );
        group.add(new Line(geo, lineMat));
    }
}

function circleRing(x: number, z: number, radius: number, lineMat: LineBasicMaterial): Line {
    return new Line(
        new BufferGeometry().setFromPoints(
            Array.from({ length: 49 }, (_, i) => {
                const a = (i / 48) * Math.PI * 2;
                return new Vector3(x + Math.cos(a) * radius, Y_LINE, z + Math.sin(a) * radius);
            }),
        ),
        lineMat,
    );
}

function buildCapsuleFill(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    px: number,
    pz: number,
    ux: number,
    uz: number,
    r: number,
): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const push = (x: number, z: number): number => {
        positions.push(x, Y_FILL, z);
        return positions.length / 3 - 1;
    };
    const q0 = push(sx + px, sz + pz);
    const q1 = push(ex + px, ez + pz);
    const q2 = push(ex - px, ez - pz);
    const q3 = push(sx - px, sz - pz);
    indices.push(q0, q1, q2, q0, q2, q3);
    appendSemicircleCap(push, indices, ex, ez, ux, uz, px, pz, r);
    appendSemicircleCap(push, indices, sx, sz, -ux, -uz, px, pz, r);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
}

function appendSemicircleCap(
    push: (x: number, z: number) => number,
    indices: number[],
    cx: number,
    cz: number,
    bulgeX: number,
    bulgeZ: number,
    px: number,
    pz: number,
    r: number,
): void {
    const center = push(cx, cz);
    const aLeft = Math.atan2(pz, px);
    const aBulge = Math.atan2(bulgeZ, bulgeX);
    const ccwToBulge = (((aBulge - aLeft) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const clockwise = ccwToBulge > Math.PI;
    const sweep = clockwise ? -Math.PI : Math.PI;
    const steps = 28;
    let prev = -1;
    for (let i = 0; i <= steps; i++) {
        const a = aLeft + (sweep * i) / steps;
        const idx = push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
        if (prev >= 0) indices.push(center, prev, idx);
        prev = idx;
    }
}

function hazardKey(
    field: HazardField,
    now: number,
    draft: OilDraft | null,
    stamps: readonly OilStamp[],
    showOutlines: boolean,
): string {
    let oil = 0;
    let fire = 0;
    field.forEachOilCell(() => {
        oil++;
    });
    field.forEachFireCell(now, () => {
        fire++;
    });
    const d = draft
        ? `${draft.startX.toFixed(2)},${draft.startZ.toFixed(2)},${draft.endX.toFixed(2)},${draft.endZ.toFixed(2)},${draft.radius.toFixed(2)}`
        : '';
    const s = showOutlines
        ? stamps.map((t) => `${t.id}:${t.startX.toFixed(1)},${t.endX.toFixed(1)}`).join('|')
        : '';
    return `${oil}:${fire}:${d}:${s}`;
}
