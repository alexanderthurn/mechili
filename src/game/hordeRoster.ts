/**
 * Horde wave composition — the Komtur's forest as a third player with an
 * income. Round N pays `income × N` (the preset's step, see
 * {@link HordeAlgorithm.income}); what it buys stays for good and marches in
 * again every round, so the wave only ever grows. A pure function of the round
 * and the preset: every peer replays the same purchases from round 1.
 */

import type { TypeRegistry } from './content/typeRegistry';
import type { LevelingSettings } from './settings';
import { levelBasisOf, type UnitType } from './units';

export interface HordeWaveEntry {
    type: UnitType;
    level: number;
}

/**
 * Who joins when (weak → strong). A type is never bought before its round —
 * price alone would bring an 800 boss on round 2 at the top presets.
 */
const FODDER: readonly { id: string; from: number }[] = [
    { id: 'hordeZombie', from: 1 }, // Black Brood (legacy id)
    { id: 'bat', from: 2 },
    { id: 'hordeWebweaver', from: 4 },
    { id: 'hordeFarmer', from: 5 },
];
const SPIDER = { id: 'hordeSpinne', from: 6 }; // Black Spider
const KOMTUR = { id: 'hordeKomtur', from: 12 }; // Hans von Stoffeln

/** packs per fodder type — past it, the money levels the packs up instead */
const FODDER_CAP = 6;
/** packs per boss type — likewise */
const BOSS_CAP = 4;
/** share of a round's income saved for bosses once the Black Spider has joined */
const BOSS_SHARE = 0.5;

interface Pack {
    type: UnitType;
    level: number;
}

/**
 * The horde's army for this match round. `income` is the preset's step (0 = no
 * horde). Each round: the boss purse buys the next boss (a Black Spider, then
 * Hans, then a spider again …) when it holds the price, the rest buys fodder —
 * the type it holds least of by value. A type at its cap is levelled up instead,
 * lowest level first, at the players' level price.
 */
export function hordeWavePlan(
    round: number,
    income: number,
    types: TypeRegistry,
    leveling: Pick<LevelingSettings, 'levelCostFactor' | 'maxLevel'>,
): HordeWaveEntry[] {
    if (income <= 0) return [];
    const fodder = FODDER.map((f) => ({ ...f, type: types.require(f.id), packs: [] as Pack[] }));
    const spider = { ...SPIDER, type: types.require(SPIDER.id), packs: [] as Pack[] };
    const komtur = { ...KOMTUR, type: types.require(KOMTUR.id), packs: [] as Pack[] };
    const levelPrice = (type: UnitType) => Math.round(levelBasisOf(type) * leveling.levelCostFactor);
    /** level the lowest pack of `packs` up; false when none can or the purse can't pay */
    const levelUp = (packs: Pack[], purse: { v: number }): boolean => {
        let best: Pack | null = null;
        for (const p of packs) {
            if (p.level >= leveling.maxLevel) continue;
            if (!best || p.level < best.level || (p.level === best.level && p.type.cost < best.type.cost)) best = p;
        }
        if (!best || purse.v < levelPrice(best.type)) return false;
        purse.v -= levelPrice(best.type);
        best.level++;
        return true;
    };

    const fodderPurse = { v: 0 };
    const bossPurse = { v: 0 };
    for (let r = 1; r <= Math.max(1, round); r++) {
        const pay = income * r;
        const toBoss = r >= spider.from ? Math.floor(pay * BOSS_SHARE) : 0;
        bossPurse.v += toBoss;
        fodderPurse.v += pay - toBoss;

        // bosses: the spider first, Hans catches up to her, then turn about
        for (;;) {
            const next =
                r >= komtur.from && komtur.packs.length < spider.packs.length && komtur.packs.length < BOSS_CAP
                    ? komtur
                    : spider.packs.length < BOSS_CAP
                      ? spider
                      : null;
            if (next) {
                if (bossPurse.v < next.type.cost) break;
                bossPurse.v -= next.type.cost;
                next.packs.push({ type: next.type, level: 1 });
                continue;
            }
            if (!levelUp([...spider.packs, ...komtur.packs], bossPurse)) break;
        }

        // fodder: the type held least of (by value), until every open type is full
        for (;;) {
            const open = fodder.filter((f) => r >= f.from && f.packs.length < FODDER_CAP);
            if (open.length > 0) {
                let pick = open[0]!;
                for (const f of open) {
                    if (f.packs.length * f.type.cost < pick.packs.length * pick.type.cost) pick = f;
                }
                if (fodderPurse.v < pick.type.cost) break;
                fodderPurse.v -= pick.type.cost;
                pick.packs.push({ type: pick.type, level: 1 });
                continue;
            }
            if (!levelUp(fodder.flatMap((f) => f.packs), fodderPurse)) break;
        }
    }

    const out: HordeWaveEntry[] = [];
    for (const group of [...fodder, spider, komtur]) {
        for (const p of group.packs) out.push({ type: p.type, level: p.level });
    }
    return out;
}
