import { OIL_SPILL_RADIUS, type HazardField } from './fire';
import type { BattleMap } from './map';

/**
 * Oil/fire ground look via the map hazard mask (soft blobs like blood).
 * No meshes — gameplay truth stays on HazardField.
 */
export class OilVisuals {
    private draft: { x: number; z: number; radius: number } | null = null;
    private lastKey = '';
    private lastNow = -1;

    constructor(private readonly map: BattleMap) {}

    /**
     * Placement preview — stamps the exact cell silhouette a spill would
     * leave (visual only; does not mutate the field). Pass already-quantized
     * world coords so the ghost matches the click.
     */
    setDraft(x: number | null, z: number | null, radius = OIL_SPILL_RADIUS): void {
        if (x === null || z === null) {
            if (this.draft) {
                this.draft = null;
                this.lastKey = '';
            }
            return;
        }
        if (
            this.draft &&
            this.draft.x === x &&
            this.draft.z === z &&
            this.draft.radius === radius
        ) {
            return;
        }
        this.draft = { x, z, radius };
        this.lastKey = '';
    }

    /**
     * Rebuild oil/fire look from the sim field. Pass battle `now` so fire
     * cells are current; use 0 during build (no fire).
     */
    sync(field: HazardField, now = 0): void {
        const key = hazardKey(field, now, this.draft);
        if (key === this.lastKey && Math.abs(now - this.lastNow) < 0.05) return;
        this.lastKey = key;
        this.lastNow = now;
        this.map.syncHazardFromField(field, now, this.draft);
    }

    dispose(): void {
        this.draft = null;
    }
}

function hazardKey(
    field: HazardField,
    now: number,
    draft: { x: number; z: number; radius: number } | null,
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
        ? `${draft.x.toFixed(2)},${draft.z.toFixed(2)},${draft.radius.toFixed(2)}`
        : '';
    return `${oil}:${fire}:${d}`;
}
