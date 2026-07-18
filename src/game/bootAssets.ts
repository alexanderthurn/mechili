import { preloadSpellAssets } from './spellAssets';
import { preloadUnitVisuals } from './units';
import { preloadWorldTextures } from './worldTextures';

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
    const weights = { units: 0.55, spells: 0.35, textures: 0.1 };
    let unitsFrac = 0;
    let spellsFrac = 0;
    let texturesFrac = 0;

    const report = (label: string) => {
        const fraction =
            unitsFrac * weights.units + spellsFrac * weights.spells + texturesFrac * weights.textures;
        onProgress?.({ fraction: Math.min(1, fraction), label });
    };

    report('Loading…');

    await Promise.all([
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
    ]);

    onProgress?.({ fraction: 1, label: 'Ready' });
}
