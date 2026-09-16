/**
 * Authored outer/board vegetation for the mountain editor.
 * XZ + scale/yaw only — height comes from worldHeightAt on seat/reseat.
 */

import type { VegetationKind } from './sceneryVegetation';

export interface AuthoredPlant {
    kind: VegetationKind;
    x: number;
    z: number;
    sc: number;
    yaw: number;
}

export interface PlantClearDisk {
    x: number;
    z: number;
    r: number;
}

export type PlantBrushKind = VegetationKind | 'erase';

export function defaultPlantScale(kind: VegetationKind): number {
    switch (kind) {
        case 'oak':
            return 0.95;
        case 'pine':
            return 0.9;
        case 'bushRound':
            return 0.85;
        case 'bushTall':
            return 0.8;
    }
}

export function plantMinSpacing(kind: VegetationKind): number {
    switch (kind) {
        case 'oak':
        case 'pine':
            return 4.5;
        case 'bushRound':
        case 'bushTall':
            return 2.8;
    }
}

export function pointInPlantClear(
    clears: readonly PlantClearDisk[],
    x: number,
    z: number,
): boolean {
    for (const c of clears) {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz <= c.r * c.r) return true;
    }
    return false;
}
