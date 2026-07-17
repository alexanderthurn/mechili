import {
    Group,
    Mesh,
    type Scene,
} from 'three';
import type { HazardField } from './fire';
import { addDrapedCapsule } from './groundMarkers';
import type { BattleMap } from './map';
import type { OilStamp } from './tactics';

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
 * Draped over board relief so hills don't clip flat markers.
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
    const fillOpacity = draft ? 0.18 : 0.26;
    const lineOpacity = draft ? 0.55 : 0.85;
    addDrapedCapsule(
        group,
        startX,
        startZ,
        endX,
        endZ,
        radius,
        fillColor,
        lineColor,
        fillOpacity,
        lineOpacity,
    );
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
