import { DEFAULT_SETTINGS } from './settings';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    type UnitType,
} from './units';

/** Marketing / panel copy for a building action — numbers come from DEFAULT_SETTINGS. */
export interface BuildingAbility {
    icon: string;
    name: string;
    /** supply cost when fixed; omit for tiered / free / descriptive-only */
    cost?: number;
    description: string;
}

/**
 * Abilities shown when selecting a base building in the HUD.
 * Costs and bonuses are read from {@link DEFAULT_SETTINGS} so the homepage
 * stays aligned with match defaults without duplicating magic numbers.
 */
export function buildingAbilities(type: UnitType): BuildingAbility[] {
    const s = DEFAULT_SETTINGS;
    const out: BuildingAbility[] = [];

    // All non-extra structures can be leveled for supply
    if (type.structure && !type.extra) {
        const { baseCost, costStep, maxLevel } = s.towers.upgrade;
        out.push({
            icon: '🔼',
            name: 'Upgrade level',
            cost: baseCost,
            description: `Raise this building one level: it gains its base HP. Price starts at ⬢ ${baseCost} and rises by ⬢ ${costStep} each level (max level ${maxLevel}).`,
        });
    }

    if (type.id === COMMAND_TOWER.id) {
        const attackPct = Math.round(s.boosts.attackTiers[0]! * 100);
        const hpPct = Math.round(s.boosts.hpTiers[0]! * 100);
        out.push(
            {
                icon: '💰',
                name: 'Unlock Selling',
                cost: s.sell.abilityCost,
                description: `Permanently unlock selling packs (up to ${s.sell.maxPerRound} per deployment phase). Refund is ${Math.round(s.sell.refundFactor * 100)}% of base cost.`,
            },
            {
                icon: '⚔️',
                name: 'Army attack boost',
                cost: s.boosts.costs[0],
                description: `Permanent army-wide damage boost. First tier +${attackPct}%; buy tiers in order (costs ⬢ ${s.boosts.costs.join(', ')}).`,
            },
            {
                icon: '🛡️',
                name: 'Army HP boost',
                cost: s.boosts.costs[0],
                description: `Permanent army-wide HP boost. First tier +${hpPct}%; buy tiers in order (costs ⬢ ${s.boosts.costs.join(', ')}).`,
            },
            {
                icon: '⚑',
                name: 'Buy Rally Route',
                cost: s.rallyRoute.abilityCost,
                description:
                    'Add one rally-route charge to your tactics strip. Once per match.',
            },
        );
    }

    if (type.id === RESEARCH_CENTER.id) {
        out.push(
            {
                icon: '2️⃣',
                name: 'Recruit at Level 2',
                cost: s.leveling.recruitLevel2Cost,
                description:
                    'For the rest of this round, units you buy arrive at level 2 (they still pay the level premium).',
            },
            {
                icon: '➕',
                name: '+1 Deployment',
                cost: s.deploy.extraSlotCost,
                description: 'One extra unit purchase this round only.',
            },
            {
                icon: '🎯',
                name: 'Range Boost',
                cost: s.deploy.rangedRangeBoostCost,
                description: `+${s.deploy.rangeBoost} range for all ranged units, this round only.`,
            },
            {
                icon: '💨',
                name: 'Speed Boost',
                cost: s.deploy.armySpeedBoostCost,
                description: `+${s.deploy.speedBoost} speed for all units, this round only.`,
            },
            {
                icon: '💳',
                name: 'Credit',
                description: `+${s.deploy.creditGain} supply now. Next deployment: −${s.deploy.creditDebt}. Once per round.`,
            },
        );
    }

    if (type.id === STRONGHOLD.id) {
        // Stronghold is HP/upgrade only — covered by the shared upgrade entry above.
    }

    // Board extras: surface their built-in role from UnitType fields
    if (type.shield) {
        out.push({
            icon: '🛡',
            name: 'Ward dome',
            description: `Absorbs enemy projectiles that cross into a dome (radius ${type.shield.radius}, height ${type.shield.height}). Pool is this unit’s HP.`,
        });
    }
    if (type.rocket) {
        const r = type.rocket;
        out.push({
            icon: '🚀',
            name: 'Homing Fire Bolt',
            description: `Arms in place, then homes onto the first enemy in range ${r.range} for ${r.damage} damage (splash ${r.splash}).`,
        });
    }

    return out;
}
