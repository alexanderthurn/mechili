import { DEFAULT_SETTINGS } from './settings';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    type UnitType,
} from './units';
import { buildingAbilityDescription, buildingAbilityName } from '../i18n';

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
            icon: 'ability-level',
            name: buildingAbilityName('upgrade_level', 'Upgrade level'),
            cost: baseCost,
            description: buildingAbilityDescription(
                'upgrade_level',
                `Raise this building one level: it gains its base HP. Price starts at ${baseCost} and rises by ${costStep} each level (max level ${maxLevel}).`,
                { baseCost, costStep, maxLevel },
            ),
        });
    }

    if (type.id === COMMAND_TOWER.id) {
        const attackPct = Math.round(s.boosts.attackTiers[0]! * 100);
        const hpPct = Math.round(s.boosts.hpTiers[0]! * 100);
        const costs = s.boosts.costs.join(', ');
        out.push(
            {
                icon: 'ability-selling',
                name: buildingAbilityName('selling', 'Selling'),
                cost: s.sell.abilityCost,
                description: buildingAbilityDescription(
                    'selling',
                    `Permanently unlock selling packs (up to ${s.sell.maxPerRound} per deployment phase). Refund is ${Math.round(s.sell.refundFactor * 100)}% of base cost.`,
                    {
                        maxPerRound: s.sell.maxPerRound,
                        refundPct: Math.round(s.sell.refundFactor * 100),
                    },
                ),
            },
            {
                icon: 'ability-atk-boost',
                name: buildingAbilityName('attack_boost', 'Attack Boost'),
                cost: s.boosts.costs[0],
                description: buildingAbilityDescription(
                    'attack_boost',
                    `Permanent army-wide damage boost. First tier +${attackPct}%; buy tiers in order (costs ${costs}).`,
                    { attackPct, costs },
                ),
            },
            {
                icon: 'ability-hp-boost',
                name: buildingAbilityName('hp_boost', 'HP Boost'),
                cost: s.boosts.costs[0],
                description: buildingAbilityDescription(
                    'hp_boost',
                    `Permanent army-wide HP boost. First tier +${hpPct}%; buy tiers in order (costs ${costs}).`,
                    { hpPct, costs },
                ),
            },
            {
                icon: 'tactic-rally',
                name: buildingAbilityName('rally_route', 'Rally Route'),
                cost: s.rallyRoute.abilityCost,
                description: buildingAbilityDescription(
                    'rally_route',
                    'Add one rally-route charge to your spells strip. Once per match.',
                ),
            },
            {
                icon: 'ui-move',
                name: buildingAbilityName('move_pack', 'Move Pack'),
                cost: s.movePack.abilityCost,
                description: buildingAbilityDescription(
                    'move_pack',
                    'Add one move-pack charge to your spells strip: one pack from an earlier round becomes movable again. Once per match.',
                ),
            },
        );
    }

    if (type.id === RESEARCH_CENTER.id) {
        out.push(
            {
                icon: 'ability-plus-deploy',
                name: buildingAbilityName('1_deployment', '+1 Deployment'),
                cost: s.deploy.extraSlotCost,
                description: buildingAbilityDescription(
                    '1_deployment',
                    'One extra unit purchase this round only.',
                ),
            },
            {
                icon: 'ability-plus-l2',
                name: buildingAbilityName('veteran_training', 'Veteran Training'),
                cost: s.leveling.recruitLevel2Cost,
                description: buildingAbilityDescription(
                    'veteran_training',
                    'For the rest of this round, units you buy arrive at level 2 (they still pay the level premium).',
                ),
            },
            {
                icon: 'ability-range',
                name: buildingAbilityName('range_boost', 'Range Boost'),
                cost: s.deploy.rangedRangeBoostCost,
                description: buildingAbilityDescription(
                    'range_boost',
                    `+${s.deploy.rangeBoost} range for all ranged units, this round only.`,
                    { amount: s.deploy.rangeBoost },
                ),
            },
            {
                icon: 'ability-speed',
                name: buildingAbilityName('speed_boost', 'Speed Boost'),
                cost: s.deploy.armySpeedBoostCost,
                description: buildingAbilityDescription(
                    'speed_boost',
                    `+${s.deploy.speedBoost} speed for all units, this round only.`,
                    { amount: s.deploy.speedBoost },
                ),
            },
            {
                icon: 'ability-credit',
                name: buildingAbilityName('loan', 'Loan'),
                description: buildingAbilityDescription(
                    'loan',
                    `+${s.deploy.creditGain} supply now. Next deployment: −${s.deploy.creditDebt}. Once per round.`,
                    { gain: s.deploy.creditGain, debt: s.deploy.creditDebt },
                ),
            },
        );
    }

    if (type.id === STRONGHOLD.id) {
        out.push({
            icon: 'ability-gift-supply',
            name: buildingAbilityName('send_supply_to_ally', 'Send supply to ally'),
            cost: 100,
            description: buildingAbilityDescription(
                'send_supply_to_ally',
                'Gift 100 supply to your ally — arrives at the start of next round. Duo modes only.',
            ),
        });
    }

    // Board extras: surface their built-in role from UnitType fields
    if (type.shield) {
        out.push({
            icon: 'ability-ward',
            name: buildingAbilityName('ward_dome', 'Ward dome'),
            description: buildingAbilityDescription(
                'ward_dome',
                `Absorbs enemy projectiles that cross into a dome (radius ${type.shield.radius}, height ${type.shield.height}). Pool is this unit’s HP.`,
                { radius: type.shield.radius, height: type.shield.height },
            ),
        });
    }
    if (type.rocket) {
        const r = type.rocket;
        out.push({
            icon: 'ability-firebolt',
            name: buildingAbilityName('homing_fire_bolt', 'Homing Fire Bolt'),
            description: buildingAbilityDescription(
                'homing_fire_bolt',
                `Arms in place, then homes onto the first enemy in range ${r.range} for ${r.damage} damage (splash ${r.splash}).`,
                { range: r.range, damage: r.damage, splash: r.splash },
            ),
        });
    }

    return out;
}
