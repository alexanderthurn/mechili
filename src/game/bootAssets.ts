import { preloadSpellAssets } from './spellAssets';
import { preloadUnitVisuals } from './units';
import { preloadWorldTextures } from './worldTextures';
import { preloadProjectileBolt, preloadDebrisBrick, preloadCrowRock } from './effects';
import {
    loadSceneryBillboards,
    loadSceneryVegetation,
    sceneryHqVegetation,
} from './sceneryVegetation';
import { loadFloorPieces } from './sceneryFloorPieces';
import { prefs } from './prefs';
import { preloadIconAtlas } from '../ui/iconAtlas';

export type BootProgress = {
    /** 0..1 overall */
    fraction: number;
    /** short status for the loading label */
    label: string;
};

type ProgressFn = (p: BootProgress) => void;

/**
 * Load everything the single map needs before the main menu is interactive:
 * unit/building GLBs, spell GLBs, shared world textures.
 */
export async function bootGameAssets(onProgress?: ProgressFn): Promise<void> {
    // Weights: units dominate download size; spells next; textures are light.
    const weights = { units: 0.5, spells: 0.3, textures: 0.1, scenery: 0.1 };
    let unitsFrac = 0;
    let spellsFrac = 0;
    let texturesFrac = 0;
    let sceneryFrac = 0;

    const report = (label: string) => {
        const fraction =
            unitsFrac * weights.units +
            spellsFrac * weights.spells +
            texturesFrac * weights.textures +
            sceneryFrac * weights.scenery;
        onProgress?.({ fraction: Math.min(1, fraction), label });
    };

    report('Loading…');

    const jobs: Promise<void>[] = [
        preloadUnitVisuals((done, total) => {
            unitsFrac = total > 0 ? done / total : 1;
            report(`Units ${done}/${total}`);
        }),
        preloadSpellAssets((done, total) => {
            spellsFrac = total > 0 ? done / total : 1;
            report(`Spells ${done}/${total}`);
        }),
        preloadWorldTextures((done, total) => {
            texturesFrac = total > 0 ? done / total : 1;
            report(`Textures ${done}/${total}`);
        }),
        preloadIconAtlas(),
        preloadProjectileBolt(),
        preloadDebrisBrick(),
        preloadCrowRock(),
    ];

    const sceneryQ = prefs().scenery;
    if (sceneryHqVegetation(sceneryQ) || sceneryQ === 'high') {
        jobs.push(
            Promise.all([
                loadSceneryBillboards(),
                loadSceneryVegetation(),
                loadFloorPieces(),
            ]).then(() => {
                sceneryFrac = 1;
                report('Scenery');
            }),
        );
    } else if (sceneryQ === 'medium') {
        jobs.push(
            loadSceneryBillboards().then(() => {
                sceneryFrac = 1;
                report('Scenery');
            }),
        );
    } else {
        sceneryFrac = 1;
    }

    await Promise.all(jobs);

    onProgress?.({ fraction: 1, label: 'Ready' });
}
