import type { HazardField, ShieldDisk } from './fire';
import type { BattleMap } from './map';

export type OilDraft = {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    radius: number;
};

/**
 * Oil/fire ground look via the map hazard mask (soft blobs like blood).
 * No meshes — gameplay truth stays on HazardField.
 */
export class OilVisuals {
    private draft: OilDraft | null = null;
    private blockedBy: ShieldDisk[] = [];
    private lastKey = '';
    private lastNow = -1;

    constructor(private readonly map: BattleMap) {}

    /**
     * Placement preview — stamps the exact capsule silhouette a spill would
     * leave (visual only). Pass already-quantized / span-clamped coords.
     */
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
     * Rebuild oil/fire look from the sim field. Pass battle `now` so fire
     * cells are current; use 0 during build (no fire).
     * `blockedBy` punches ward discs out of the draft ghost (same as stamp).
     */
    sync(field: HazardField, now = 0, blockedBy: readonly ShieldDisk[] = []): void {
        const key = hazardKey(field, now, this.draft, blockedBy);
        if (
            key === this.lastKey &&
            Math.abs(now - this.lastNow) < 0.05 &&
            shieldsKey(blockedBy) === shieldsKey(this.blockedBy)
        ) {
            return;
        }
        this.lastKey = key;
        this.lastNow = now;
        this.blockedBy = blockedBy.map((s) => ({ ...s }));
        this.map.syncHazardFromField(field, now, this.draft, this.blockedBy);
    }

    dispose(): void {
        this.draft = null;
        this.blockedBy = [];
    }
}

function shieldsKey(shields: readonly ShieldDisk[]): string {
    if (shields.length === 0) return '';
    return shields
        .map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)},${s.radius.toFixed(1)}`)
        .join('|');
}

function hazardKey(
    field: HazardField,
    now: number,
    draft: OilDraft | null,
    blockedBy: readonly ShieldDisk[],
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
    return `${oil}:${fire}:${d}:${shieldsKey(blockedBy)}`;
}
