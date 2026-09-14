/**
 * The Year's AI: plans a whole round against the army it can see.
 *
 * Every round the AI's side is rebuilt from nothing with the same wealth as
 * the player (clearArmy), while the player keeps and levels an army. So the
 * whole round is one decision: which units, which talents, which unlock, and
 * where each pack stands. This module makes it in three parts:
 *
 * 1. **Estimate** — {@link estimateBattle}: a fast battle model over groups of
 *    packs, built only from resolved stats and unit attributes (HP, damage,
 *    interval, range, speed, air/ground layers, splash and cleave against the
 *    target's formation density, overkill, conversion rays, production and
 *    on-kill spawns, shields, the Stronghold lifeline). No unit ids.
 * 2. **Compose** — {@link YearBrain.compose}: greedy spending. Each step adds
 *    the pack or talent that improves the estimate most per supply, scored
 *    against the visible army AND against that army plus the best counter the
 *    player can still buy with the supply they hold — a plan that only beats
 *    what is on the board loses to the player's answer.
 * 3. **Place** — lanes and depth by role: front-liners ahead, artillery at the
 *    back, each pack opposite the enemy group it is best against, spread out
 *    when the enemy splashes, defenders covering their base.
 *
 * The same brain can also play a side that keeps its army (`keep`) — used by
 * the arena's player stand-in, and ready for other modes.
 *
 * Deterministic for the same board and stream: it reads only match state and
 * the stream it is handed.
 */
import type { Action } from './actions';
import { unlockCostFor, type StartCard } from './cards';
import type { TypeRegistry } from './content/typeRegistry';
import { CELL } from './map';
import type { PlacementController } from './placement';
import type { SeatId } from './seats';
import type { DeploySettings, Economy, LevelingSettings } from './settings';
import { effectiveFlying, effectiveTargets, TechTree, type ResolvedStats } from './tech';
import { ownedCleaveTechs, ownedOnKillTechs, ownedProduceTechs, techsForUnit, type Loadout } from './techCatalog';
import { formationHeadcount, hpWithdrawOf, type Team, type Unit, type UnitType } from './units';

/** the match state the brain reads and the one channel it acts through */
export interface YearBrainHost {
    types: TypeRegistry;
    dispatch: (action: Action) => boolean;
    placement: PlacementController;
    economy: Economy;
    techTree: TechTree;
    leveling: LevelingSettings;
    deploySettings: DeploySettings;
    unlockedUnits: string[][];
    unlockUsedThisRound: boolean[];
    commander: (string | null)[];
    loadoutOf: (seat: SeatId) => Loadout | undefined;
}

type HasTech = (seat: SeatId, typeId: string, techId: string) => boolean;

/** one group of identical packs in the battle model */
export interface BattleGroup {
    key: string;
    /** packs × members in the group */
    members: number;
    hpEach: number;
    dmgEach: number;
    interval: number;
    range: number;
    minRange: number;
    speed: number;
    splash: number;
    cleave: number;
    ground: boolean;
    air: boolean;
    flying: boolean;
    /** ranged hits (projectiles) — shields soak these */
    ranged: boolean;
    /** conversion ray: turns targets instead of damaging them */
    convert: boolean;
    /** corroding hits make the target take more */
    corrode: boolean;
    /** second health pool against ranged hits */
    shield: boolean;
    structure: boolean;
    /** the side's army falls with this building */
    lifeline: boolean;
    /** tiles between the group and its side's front edge (engagement distance) */
    depth: number;
    /** how densely members stand (members per square world unit) */
    density: number;
    /** HP value each surviving member takes off the enemy side at the end */
    withdraw: number;
    /** extra fighters this group brings into the battle (production, on-kill spawns) */
    bonusHp: number;
    bonusDps: number;
    /** share of attacks that land (aim spread) */
    accuracy: number;
}

export interface BattleEstimate {
    /** 0..1 of each side's starting HP still standing (mobile units) */
    mine: number;
    theirs: number;
    /** value that would come off each side's HP bar */
    damageToMe: number;
    damageToThem: number;
    /** -1 (clear loss) .. +1 (clear win) */
    margin: number;
}

const DT = 1.5;
const BATTLE_SECONDS = 90;

/**
 * The battle model's free numbers — fitted against the real BattleSim with
 * `node scripts/ai-arena.mjs --tune` (duels and mixed armies). Mutable so the
 * tuner can try values; the game only reads them.
 */
export const MODEL = {
    /** distance between the two sides' front lines before anyone moves (world units) */
    frontGap: 0.943,
    /** world units per depth tile when two groups' depths add to the gap */
    depthScale: 4.586,
    /** structure weight while the enemy still has field units (they are behind the fight) */
    structureExposure: 0.562,
    /** how much tighter packs stand once they fight (member spacing from collision radius) */
    engagedDensity: 2.512,
    /** multiplier on extra members an area hit reaches */
    areaReach: 2.867,
    /** a converted member counts this many times its HP */
    convertValue: 2.105,
    /** ranged damage share a shield lets through */
    shieldPass: 0.326,
    /** fire share artillery keeps against units that close into its dead zone */
    deadZoneKeep: 0.248,
    /** corrosion bonus on hits */
    corrode: 1.543,
    /** how much of a production cap / on-kill spawn stock counts as present */
    spawnShare: 0.214,
    /** the target's own speed toward the attacker (share) when closing the gap */
    closingShare: 0.825,
    /** aim spread → hit share: 1 / (1 + spread × this) */
    spreadMiss: 0.001,
    /** screening: a group this many depth tiles behind another draws e^-(tiles × this) as much fire */
    screen: 0,
    /** overkill: a hit counts up to this many target HPs (spread damage between members) */
    overkill: 2.719,
};

/**
 * The planner's own choices (not the battle model): how much it trusts
 * talents, how hard it plays against the player's answer, … — measured with
 * the arena (`--planner key=value`).
 */
export const PLANNER = {
    /** weight on a talent's estimated gain (packs are 1) */
    techWeight: 1,
    /** share of the score from the plan against the visible army plus the player's best counter */
    counterWeight: 0.4,
    /** small penalty per pack of a type already in the plan (keeps the army flexible) */
    diversityTilt: 0.00002,
    /** credit for an unlock (it widens every later round's shop) */
    unlockBonus: 0.02,
    /** share of the player's liquid supply assumed spent on their counter */
    enemyBudgetShare: 1,
    /** lateral spacing between packs of one lane (tiles × CELL) — more when the enemy splashes */
    laneSpacing: 11,
    laneSpacingSplash: 18,
    /** defenders lean their lanes toward their own Stronghold this much */
    keepPull: 0.3,
    /** pull every pack's lane toward one focus point (local superiority beats a spread line) */
    concentrate: 0,
    /** attackers: the focus is the enemy Stronghold (its fall takes the army with it) rather than their army's center */
    focusKeep: 0,
    /** weight of the HP each side keeps next to the round's outcome */
    hpWeight: 1,
    /** 1 = score plans by The Year's round rule (surviving value, tie to the defender); 0 = by HP margin */
    ruleScore: 0,
};

function levelMult(level: number, leveling: LevelingSettings): number {
    return 1 + (level - 1) * leveling.statBonusPerLevel;
}

/** stats as the battle will use them: talents, runes, commander bonuses */
export function battleStats(
    type: UnitType,
    owned: ReadonlySet<string>,
    items: readonly string[],
    effects: { unitStatsBonus?: number; speedBonus?: number; flyingBonus?: number } | undefined,
    flying: boolean,
    types: TypeRegistry,
): ResolvedStats {
    const stats = TechTree.statsWithOwned(type, owned, types);
    if (effects?.flyingBonus && flying) {
        stats.damage *= 1 + effects.flyingBonus;
        stats.hp *= 1 + effects.flyingBonus;
    }
    if (effects?.unitStatsBonus && !type.structure) {
        stats.damage *= 1 + effects.unitStatsBonus;
        stats.hp *= 1 + effects.unitStatsBonus;
    }
    for (const id of items) {
        const mods = types.rune(id)?.mods;
        if (!mods) continue;
        stats.hp *= mods.hp ?? 1;
        stats.damage *= mods.damage ?? 1;
        stats.range *= mods.range ?? 1;
        stats.minRange *= mods.range ?? 1;
        stats.speed *= mods.speed ?? 1;
        stats.attackInterval *= mods.attackInterval ?? 1;
    }
    if (effects?.speedBonus && !type.structure && type.speed > 0) stats.speed += effects.speedBonus;
    return stats;
}

/** a pack (or a planned one) described for the battle model */
export function groupOf(
    type: UnitType,
    opts: {
        seat: SeatId;
        level: number;
        items: readonly string[];
        count: number;
        depth: number;
        hasTech: HasTech;
        types: TypeRegistry;
        leveling: LevelingSettings;
        effects?: { unitStatsBonus?: number; speedBonus?: number; flyingBonus?: number };
        lifeline: boolean;
    },
): BattleGroup {
    const { types, seat, hasTech } = opts;
    const owned = new Set<string>();
    for (const tech of types.talentsOf(type)) if (hasTech(seat, type.id, tech.id)) owned.add(tech.id);
    const flying = effectiveFlying(type, seat, hasTech, types) > 0;
    const stats = battleStats(type, owned, opts.items, opts.effects, flying, types);
    const mult = levelMult(opts.level, opts.leveling);
    const targets = effectiveTargets(type, seat, hasTech, types);
    const perPack = formationHeadcount(type);
    const area = Math.max(1, type.footprint.cols * type.footprint.rows) * CELL * CELL * (type.formationSpread ?? 1);
    // fighting packs bunch up: members stand about two collision radii apart
    const engaged = 1 / (Math.PI * Math.max(0.3, type.collisionRadius * 2) ** 2);
    const density = Math.max(perPack / area, engaged * MODEL.engagedDensity);
    const cleave = Math.max(type.cleave?.radius ?? 0, ...ownedCleaveTechs(type, seat, hasTech, types).map((c) => c.cleave.radius));
    const shield = !!type.shield || opts.items.some((id) => types.rune(id)?.grantsShieldHp) || [...owned].some((id) => types.talent(id)?.grantsShieldHp);
    let bonusHp = 0;
    let bonusDps = 0;
    for (const { produce } of ownedProduceTechs(type, seat, hasTech, types)) {
        const child = types.byId(produce.typeId);
        if (!child) continue;
        // produced over the battle — count part of the cap as present
        const n = produce.max * MODEL.spawnShare;
        bonusHp += n * child.hp * mult;
        bonusDps += (n * child.damage * mult) / child.attackInterval;
    }
    for (const { onKill } of ownedOnKillTechs(type, seat, hasTech, types)) {
        const child = types.byId(onKill.typeId);
        if (!child) continue;
        // roughly one raised fighter per two members of the pack over a battle
        const n = perPack * MODEL.spawnShare;
        bonusHp += n * child.hp * mult;
        bonusDps += (n * child.damage * mult) / child.attackInterval;
    }
    const withdrawEach = hpWithdrawOf(type);
    return {
        key: `${type.id}:${opts.level}:${[...owned].sort().join(',')}:${[...opts.items].sort().join(',')}`,
        members: perPack * opts.count,
        hpEach: stats.hp * mult,
        dmgEach: stats.damage * mult,
        interval: Math.max(0.05, stats.attackInterval),
        range: stats.range,
        minRange: stats.minRange,
        speed: stats.speed,
        splash: stats.splashRadius,
        cleave,
        ground: targets.ground,
        air: targets.air,
        flying,
        ranged: !!type.projectileSpeed,
        convert: !!type.convertRay,
        corrode: !!type.corrodeOnHit,
        shield,
        structure: !!type.structure,
        lifeline: opts.lifeline && !!type.onDestroyed?.collapseOwnArmy,
        depth: opts.depth,
        density,
        withdraw: withdrawEach,
        bonusHp: bonusHp * opts.count,
        bonusDps: bonusDps * opts.count,
        accuracy: type.projectileSpeed ? 1 / (1 + (type.aimSpread ?? 0) * MODEL.spreadMiss) : 1,
    };
}

/** groups with the same key fold into one */
function mergeGroups(groups: readonly BattleGroup[]): BattleGroup[] {
    const byKey = new Map<string, BattleGroup>();
    for (const g of groups) {
        const k = `${g.key}@${Math.round(g.depth / 4)}`;
        const prev = byKey.get(k);
        if (!prev) byKey.set(k, { ...g });
        else {
            prev.members += g.members;
            prev.bonusHp += g.bonusHp;
            prev.bonusDps += g.bonusDps;
        }
    }
    return [...byKey.values()];
}

/** damage per second one living member of `a` puts into `b`'s pool */
function dpsInto(a: BattleGroup, b: BattleGroup, bAlive: number): number {
    if (a.dmgEach <= 0) return 0;
    if (b.flying ? !a.air : !a.ground) return 0;
    if (a.convert) {
        // continuous ray: damage per second (not per interval) turns a member —
        // that member now fights for the caster, so it counts about double
        return b.structure ? a.dmgEach : Math.min(a.dmgEach, b.hpEach) * MODEL.convertValue;
    }
    const radius = a.ranged ? a.splash : Math.max(a.cleave, a.splash);
    const reached = radius > 0 ? 1 + Math.min(Math.max(0, bAlive - 1), b.density * Math.PI * radius * radius * MODEL.areaReach) : 1;
    let perHit = Math.min(a.dmgEach, b.hpEach * MODEL.overkill) * reached * a.accuracy;
    if (b.shield && a.ranged) perHit *= MODEL.shieldPass;
    if (a.corrode) perHit *= MODEL.corrode;
    // artillery with a dead zone loses much of its fire to anything that closes in
    if (a.minRange > 0 && !b.structure && b.range < a.minRange && b.speed > 0) perHit *= MODEL.deadZoneKeep;
    return perHit / a.interval;
}

/**
 * A battle of two armies, played on groups rather than members. Engagement
 * waits until the gap between two groups has closed to the attacker's reach;
 * fire spreads over what each group can reach (structures only draw fire once
 * the field is clearing); the Stronghold lifeline ends a side outright.
 */
export function estimateBattle(mineIn: readonly BattleGroup[], theirsIn: readonly BattleGroup[]): BattleEstimate {
    const sides = [mergeGroups(mineIn), mergeGroups(theirsIn)] as const;
    const hp = sides.map((groups) => groups.map((g) => g.members * g.hpEach + g.bonusHp));
    const startMobile = sides.map((groups, s) => groups.reduce((sum, g, i) => (g.structure ? sum : sum + hp[s]![i]!), 0));
    const alive = (s: number, i: number) => Math.max(0, hp[s]![i]!) / sides[s]![i]!.hpEach;
    const mobileHp = (s: number) => sides[s]!.reduce((sum, g, i) => (g.structure ? sum : sum + Math.max(0, hp[s]![i]!)), 0);
    const dmg = [sides[0].map(() => 0), sides[1].map(() => 0)];

    for (let t = 0; t < BATTLE_SECONDS; t += DT) {
        if (mobileHp(0) <= 0 || mobileHp(1) <= 0) break;
        for (const s of [0, 1] as const) {
            const o = 1 - s;
            const foes = sides[o]!;
            const foeMobile = mobileHp(o);
            const foeStart = Math.max(1, startMobile[o]!);
            for (let i = 0; i < sides[s]!.length; i++) {
                const a = sides[s]![i]!;
                const livingA = alive(s, i);
                if (livingA <= 0) continue;
                const totalHpA = a.members * a.hpEach + a.bonusHp;
                const bonusShare = totalHpA > 0 ? a.bonusDps * (Math.max(0, hp[s]![i]!) / totalHpA) : 0;
                // weight every reachable, engaged foe
                let weightSum = 0;
                const weights: number[] = [];
                for (let j = 0; j < foes.length; j++) {
                    const b = foes[j]!;
                    const hb = hp[o]![j]!;
                    let w = 0;
                    if (hb > 0 && (b.flying ? a.air : a.ground)) {
                        const gap = MODEL.frontGap + (a.depth + b.depth) * MODEL.depthScale;
                        const reach = a.range + 2;
                        const closing = a.speed + (b.structure ? 0 : b.speed * MODEL.closingShare);
                        const start = gap <= reach ? 0 : closing > 0 ? (gap - reach) / closing : Infinity;
                        if (t >= start) {
                            // the closest foes draw the fire: deeper groups are screened
                            w = hb * Math.exp(-b.depth * MODEL.screen);
                            if (b.structure) w *= foeMobile / foeStart > 0.25 ? MODEL.structureExposure : 1;
                        }
                    }
                    weights.push(w);
                    weightSum += w;
                }
                if (weightSum <= 0) continue;
                for (let j = 0; j < foes.length; j++) {
                    const w = weights[j]!;
                    if (w <= 0) continue;
                    const share = w / weightSum;
                    const b = foes[j]!;
                    const rate = dpsInto(a, b, alive(o, j)) * livingA + bonusShare;
                    dmg[o]![j]! += rate * share * DT;
                }
            }
        }
        for (const s of [0, 1] as const) {
            for (let j = 0; j < sides[s]!.length; j++) {
                hp[s]![j]! -= dmg[s]![j]!;
                dmg[s]![j] = 0;
            }
            // a fallen lifeline Stronghold takes its whole side with it
            if (sides[s]!.some((g, j) => g.lifeline && hp[s]![j]! <= 0)) {
                for (let j = 0; j < sides[s]!.length; j++) if (!sides[s]![j]!.structure) hp[s]![j] = 0;
            }
        }
    }
    const left = (s: number) => mobileHp(s) / Math.max(1, startMobile[s]!);
    const withdrawn = (s: number) =>
        sides[s]!.reduce((sum, g, i) => (g.structure ? sum : sum + Math.ceil(Math.max(0, hp[s]![i]!) / g.hpEach) * g.withdraw), 0);
    const mine = left(0);
    const theirs = left(1);
    const damageToThem = withdrawn(0);
    const damageToMe = withdrawn(1);
    // survivors decide the round; how much each side keeps breaks near-ties
    let margin = mine - theirs;
    if (mine > 0 && theirs <= 0) margin = 0.5 + 0.5 * mine;
    else if (theirs > 0 && mine <= 0) margin = -0.5 - 0.5 * theirs;
    else if (damageToThem !== damageToMe) margin += 0.15 * Math.sign(damageToThem - damageToMe);
    return { mine, theirs, damageToMe, damageToThem, margin: Math.max(-1, Math.min(1, margin)) };
}

/**
 * The commander worth most to a side that is rebuilt every round: income and
 * gift units are wiped or matched away, so only lasting combat effects count —
 * recruiting at a higher level above all (the rebuilt army never levels), then
 * stat and speed bonuses, a wider starting shop, cheaper unlocks.
 */
export function chooseRebuildCommander(offer: readonly StartCard[], types: TypeRegistry): StartCard {
    let best = offer[0]!;
    let bestScore = -Infinity;
    for (const card of offer) {
        const e = card.effects ?? {};
        let score = 0;
        if ((e.recruitLevel ?? 1) > 1) score += 3 * ((e.recruitLevel ?? 1) - 1);
        score += (e.unitStatsBonus ?? 0) * 10;
        score += (e.flyingBonus ?? 0) * 4;
        score += (e.speedBonus ?? 0) * 0.1;
        if (e.unlockDiscount) score += 0.3;
        const shop = types.shopFor(card);
        score += 0.15 * new Set([...card.units, ...(card.unlock ? [card.unlock] : [])].filter((id) => shop.includes(id))).size;
        if (score > bestScore) {
            bestScore = score;
            best = card;
        }
    }
    return best;
}

/** role bands: tiles behind the front edge a pack prefers */
function preferredDepth(type: UnitType, stats: { range: number; minRange: number; flying: boolean; convert: boolean }): number {
    if (stats.flying) return 3;
    if (stats.convert) return 11;
    if (stats.minRange > 0 || stats.range >= 60) return 15;
    if (stats.range >= 30) return 9;
    if (stats.range >= 10) return 5;
    return type.hp >= 500 ? 0 : 1;
}

interface Plan {
    packs: { type: UnitType; depth: number }[];
    techs: { type: UnitType; techId: string; cost: number }[];
    spent: number;
}

export class YearBrain {
    /** packs bought in this build phase (the deploy cap counts these) */
    private bought = 0;
    /** this brain's planner choices ({@link PLANNER} with any overrides) */
    private readonly p: typeof PLANNER;

    constructor(
        private readonly host: YearBrainHost,
        private readonly team: Team,
        private readonly seat: SeatId,
        /** this side's role in The Year (the attacker has no base) */
        private readonly role: 'attacker' | 'defender',
        private readonly rng: () => number,
        overrides: Partial<typeof PLANNER> = {},
    ) {
        this.p = { ...PLANNER, ...overrides };
    }

    private hasTech: HasTech = (seat, typeId, techId) => {
        const type = this.host.types.byId(typeId);
        if (type?.innateTechs?.includes(techId)) return true;
        return seat >= 0 && this.host.techTree.has(seat, typeId, techId);
    };

    private effectsOf(seat: SeatId) {
        return this.host.types.commander(this.host.commander[seat] ?? '')?.effects;
    }

    private shopOf(seat: SeatId): readonly string[] {
        return this.host.types.shopFor(this.host.types.commander(this.host.commander[seat] ?? ''));
    }

    private get enemySeat(): SeatId {
        const foe = this.host.placement.allUnits().find((u) => u.team !== this.team && u.team !== 'horde' && u.seat >= 0);
        if (foe) return foe.seat;
        return this.seat === 0 ? 1 : 0;
    }

    /** my side's front edge row and which way is forward (+1 = higher rows) */
    private frontline(team: Team): { frontRow: number; forward: number; colMin: number; colMax: number } {
        const map = this.host.placement.map;
        const near = team === 'player' ? !map.ownAtFar : map.ownAtFar;
        const rim = map.size.rimCells;
        const ownRows = map.size.zoneRows + (map.neutralUnlocked ? map.size.neutralRows / 2 : 0);
        const frontRow = near ? rim + ownRows - 1 : map.rows - rim - ownRows;
        return {
            frontRow,
            forward: near ? 1 : -1,
            colMin: rim + map.size.flankCols,
            colMax: map.cols - rim - map.size.flankCols - 1,
        };
    }

    /** tiles between a unit and its side's front edge */
    private depthOf(unit: Unit): number {
        const { frontRow, forward } = this.frontline(unit.team === 'player' ? 'player' : 'enemy');
        const centerRow = unit.gridless ? unit.cell.row : unit.cell.row + (unit.rotated ? unit.type.footprint.cols : unit.type.footprint.rows) / 2;
        return Math.max(0, (frontRow - centerRow) * forward);
    }

    /** every pack on the board as battle groups, per side */
    private boardGroups(): { mine: BattleGroup[]; theirs: BattleGroup[] } {
        const { types, leveling } = this.host;
        const mine: BattleGroup[] = [];
        const theirs: BattleGroup[] = [];
        for (const u of this.host.placement.allUnits()) {
            if (u.team === 'horde' || u.type.extra || u.summoned || u.destroyed) continue;
            const g = groupOf(u.type, {
                seat: u.seat,
                level: u.level,
                items: u.items,
                count: 1,
                depth: this.depthOf(u),
                hasTech: this.hasTech,
                types,
                leveling,
                effects: this.effectsOf(u.seat),
                lifeline: true,
            });
            (u.team === this.team ? mine : theirs).push(g);
        }
        return { mine, theirs };
    }

    private plannedGroup(type: UnitType, depth: number, extraTechs: ReadonlySet<string> = new Set()): BattleGroup {
        const hasTech: HasTech = (seat, typeId, techId) =>
            (typeId === type.id && extraTechs.has(techId)) || this.hasTech(seat, typeId, techId);
        return groupOf(type, {
            seat: this.seat,
            level: this.recruitLevel(type),
            items: [],
            count: 1,
            depth,
            hasTech,
            types: this.host.types,
            leveling: this.host.leveling,
            effects: this.effectsOf(this.seat),
            lifeline: false,
        });
    }

    private recruitLevel(_type: UnitType): number {
        return this.effectsOf(this.seat)?.recruitLevel ?? 1;
    }

    private buyCost(type: UnitType): number {
        const level = this.recruitLevel(type);
        const premium = level > 1 ? Math.round((type.levelBasis ?? type.cost) * this.host.leveling.levelCostFactor) * (level - 1) : 0;
        return this.host.economy.costOf(type) + premium;
    }

    /**
     * The best answer the enemy can still buy against `army`: their supply,
     * spent on the single type from their shop that hurts it most.
     */
    private enemyCounter(army: readonly BattleGroup[], theirs: readonly BattleGroup[], budget: number): BattleGroup[] {
        const seat = this.enemySeat;
        const unlocked = this.host.unlockedUnits[seat] ?? [];
        const shop = this.shopOf(seat);
        let best: BattleGroup[] = [];
        let bestScore = -Infinity;
        for (const id of shop) {
            const type = this.host.types.byId(id);
            if (!type || type.cost <= 0 || type.cost > budget) continue;
            // a locked type costs its unlock first (and only one a round)
            const unlockCost = unlocked.includes(id) ? 0 : unlockCostFor(id, this.host.types.commander(this.host.commander[seat] ?? ''), this.host.types);
            if (!Number.isFinite(unlockCost)) continue;
            const count = Math.min(6, Math.floor((budget - unlockCost) / type.cost));
            if (count <= 0) continue;
            const add = groupOf(type, {
                seat,
                level: 1,
                items: [],
                count,
                depth: 4,
                hasTech: this.hasTech,
                types: this.host.types,
                leveling: this.host.leveling,
                effects: this.effectsOf(seat),
                lifeline: false,
            });
            // their best answer: the one that leaves me the worst round
            const score = -this.roundScore(estimateBattle(army, [...theirs, add]));
            if (score > bestScore) {
                bestScore = score;
                best = [add];
            }
        }
        return best;
    }

    /**
     * A round of The Year as the rules decide it: each side's surviving units
     * take their value off the other's HP, higher HP wins, a tie (both wiped
     * included) goes to the defender. Scored -1..1 with the size of the lead.
     */
    private roundScore(est: BattleEstimate): number {
        if (this.p.ruleScore <= 0) return est.margin;
        const lead = est.damageToThem - est.damageToMe;
        const wins = lead > 0 || (lead === 0 && this.role === 'defender');
        const scale = Math.max(20, est.damageToThem + est.damageToMe);
        return (wins ? 0.45 : -0.45) + 0.35 * Math.tanh(lead / scale) + 0.2 * (est.mine - est.theirs) * this.p.hpWeight;
    }

    private score(army: readonly BattleGroup[], theirs: readonly BattleGroup[], counter: readonly BattleGroup[]): number {
        const now = this.roundScore(estimateBattle(army, theirs));
        if (counter.length === 0) return now;
        const answered = this.roundScore(estimateBattle(army, [...theirs, ...counter]));
        return (1 - this.p.counterWeight) * now + this.p.counterWeight * answered;
    }

    /**
     * Greedy spending over packs and talents. `base` is what already fights on
     * my side (buildings, a kept army); `shop` the types I may buy.
     */
    private compose(base: readonly BattleGroup[], theirs: readonly BattleGroup[], shop: readonly UnitType[], budget: number, slots: number): Plan {
        const { economy, types } = this.host;
        const plan: Plan = { packs: [], techs: [], spent: 0 };
        const army: BattleGroup[] = [...base];
        const ownedTechs = new Map<string, Set<string>>();
        const enemyBudget = economy.balance(this.enemySeat) * this.p.enemyBudgetShare;
        let counter = this.enemyCounter(army, theirs, enemyBudget);
        let current = this.score(army, theirs, counter);
        const minCost = Math.min(...shop.map((t) => this.buyCost(t)));

        for (let step = 0; step < 60; step++) {
            const left = budget - plan.spent;
            if (left < Math.min(minCost, 100)) break;
            let bestGain = -Infinity;
            let bestPick: { kind: 'pack'; type: UnitType; group: BattleGroup; cost: number } | { kind: 'tech'; type: UnitType; techId: string; cost: number } | null = null;
            let bestScore = current;

            if (plan.packs.length < slots) {
                for (const type of shop) {
                    const cost = this.buyCost(type);
                    if (cost > left) continue;
                    const flying = effectiveFlying(type, this.seat, this.hasTech, types) > 0;
                    const stats = TechTree.statsWithOwned(type, ownedTechs.get(type.id) ?? new Set(), types);
                    const depth = preferredDepth(type, { range: stats.range, minRange: stats.minRange, flying, convert: !!type.convertRay });
                    const group = this.plannedGroup(type, depth, ownedTechs.get(type.id));
                    const s = this.score([...army, group], theirs, counter);
                    // gain per supply; a small tilt toward packs we have few of keeps the army flexible
                    const have = plan.packs.filter((p) => p.type === type).length;
                    const gain = (s - current) / cost - have * this.p.diversityTilt;
                    if (gain > bestGain) {
                        bestGain = gain;
                        bestPick = { kind: 'pack', type, group, cost };
                        bestScore = s;
                    }
                }
            }
            // talents for types the plan already fields
            const fielded = [...new Set(plan.packs.map((p) => p.type))];
            for (const type of fielded) {
                const owned = ownedTechs.get(type.id) ?? new Set<string>();
                for (const tech of techsForUnit(type, types, this.host.loadoutOf(this.seat))) {
                    if (owned.has(tech.id) || this.hasTech(this.seat, type.id, tech.id)) continue;
                    const cost = economy.techCostOf(tech, owned.size + this.host.techTree.ownedFor(this.seat, type.id).size);
                    if (cost > left) continue;
                    const next = new Set(owned).add(tech.id);
                    const rebuilt = army.map((g, i) => {
                        const pack = i - base.length;
                        if (pack < 0 || plan.packs[pack]?.type !== type) return g;
                        return this.plannedGroup(type, g.depth, next);
                    });
                    const s = this.score(rebuilt, theirs, counter);
                    const gain = ((s - current) / cost) * this.p.techWeight - (this.p.techWeight <= 0 ? Infinity : 0);
                    if (gain > bestGain) {
                        bestGain = gain;
                        bestPick = { kind: 'tech', type, techId: tech.id, cost };
                        bestScore = s;
                    }
                }
            }
            if (!bestPick) break;
            // nothing helps any more: still spend — idle supply is wasted when the army is rebuilt
            if (bestPick.kind === 'pack') {
                army.push(bestPick.group);
                plan.packs.push({ type: bestPick.type, depth: bestPick.group.depth });
            } else {
                const owned = ownedTechs.get(bestPick.type.id) ?? new Set<string>();
                owned.add(bestPick.techId);
                ownedTechs.set(bestPick.type.id, owned);
                plan.techs.push({ type: bestPick.type, techId: bestPick.techId, cost: bestPick.cost });
                for (let i = 0; i < army.length; i++) {
                    const pack = i - base.length;
                    if (pack >= 0 && plan.packs[pack]?.type === bestPick.type) army[i] = this.plannedGroup(bestPick.type, army[i]!.depth, owned);
                }
            }
            plan.spent += bestPick.cost;
            current = bestScore;
            // the enemy's best answer shifts as the plan grows
            if (step % 4 === 3) {
                counter = this.enemyCounter(army, theirs, enemyBudget);
                current = this.score(army, theirs, counter);
            }
        }
        return plan;
    }

    /** my buyable types right now (unlocked, in my shop) */
    private buyableTypes(extra: string | null = null): UnitType[] {
        const unlocked = this.host.unlockedUnits[this.seat] ?? [];
        return this.shopOf(this.seat)
            .filter((id) => unlocked.includes(id) || id === extra)
            .map((id) => this.host.types.byId(id))
            .filter((t): t is UnitType => !!t && !t.extra && !t.structure);
    }

    /**
     * Plan and play one build phase. `keep` = the side keeps its army (levels
     * it first); otherwise the army was just cleared.
     */
    playRound(opts: { keep: boolean; slots: number }): void {
        const { economy, types, dispatch } = this.host;
        if (opts.keep) this.buyLevels();
        const board = this.boardGroups();
        const base = board.mine;
        const theirs = board.theirs;
        let budget = economy.balance(this.seat);

        // the round's unlock: the locked type whose best plan beats the plan without it
        let unlock: string | null = null;
        if (!this.host.unlockUsedThisRound[this.seat]) {
            const commander = types.commander(this.host.commander[this.seat] ?? '');
            const without = this.compose(base, theirs, this.buyableTypes(), budget, opts.slots);
            let bestScore = this.planScore(base, theirs, without);
            for (const id of this.shopOf(this.seat)) {
                if ((this.host.unlockedUnits[this.seat] ?? []).includes(id)) continue;
                const cost = unlockCostFor(id, commander, types);
                if (!Number.isFinite(cost) || cost > budget) continue;
                const withIt = this.compose(base, theirs, this.buyableTypes(id), budget - cost, opts.slots);
                // unlocks stay for later rounds — a little credit for a wider shop
                const score = this.planScore(base, theirs, withIt) + this.p.unlockBonus;
                if (score > bestScore) {
                    bestScore = score;
                    unlock = id;
                }
            }
            if (unlock && dispatch({ kind: 'unlockUnit', team: this.team, seat: this.seat, typeId: unlock })) {
                budget = economy.balance(this.seat);
            } else {
                unlock = null;
            }
        }

        const plan = this.compose(base, theirs, this.buyableTypes(), budget, opts.slots);
        this.placePlan(plan);
        for (const tech of plan.techs) {
            dispatch({ kind: 'buyTech', team: this.team, seat: this.seat, typeId: tech.type.id, techId: tech.techId });
        }
        this.spendLeftover(opts.slots);
    }

    private planScore(base: readonly BattleGroup[], theirs: readonly BattleGroup[], plan: Plan): number {
        const army = [...base, ...plan.packs.map((p) => this.plannedGroup(p.type, p.depth, new Set(plan.techs.filter((t) => t.type === p.type).map((t) => t.techId))))];
        return this.roundScore(estimateBattle(army, theirs));
    }

    /** a kept army levels whatever it can afford first: a level doubles a pack for half its price */
    private buyLevels(): void {
        let bought = true;
        while (bought) {
            bought = false;
            const packs = this.host.placement
                .allUnits()
                .filter((u) => u.seat === this.seat && !u.type.structure && !u.type.extra)
                .sort((a, b) => b.type.cost - a.type.cost);
            for (const unit of packs) {
                if (this.host.dispatch({ kind: 'buyLevel', team: this.team, seat: this.seat, unitId: unit.id })) bought = true;
            }
        }
    }

    /** whatever supply is left: more of the plan's best-value pack, then talents */
    private spendLeftover(slots: number): void {
        const { economy, dispatch } = this.host;
        for (let guard = 0; guard < 30; guard++) {
            const board = this.boardGroups();
            const types = this.buyableTypes().filter((t) => this.buyCost(t) <= economy.balance(this.seat));
            if (types.length === 0) break;
            if (this.bought >= slots) break;
            let best: UnitType | null = null;
            let bestScore = -Infinity;
            for (const type of types) {
                const g = this.plannedGroup(type, 4);
                const s = this.roundScore(estimateBattle([...board.mine, g], board.theirs)) / Math.max(1, this.buyCost(type));
                if (s > bestScore) {
                    bestScore = s;
                    best = type;
                }
            }
            if (!best) break;
            const depth = preferredDepth(best, { range: best.range, minRange: best.minRange ?? 0, flying: (best.flying ?? 0) > 0, convert: !!best.convertRay });
            if (!this.placeOne(best, depth, this.enemyLanes(), [])) break;
        }
        // talents for fielded types, cheapest first
        for (let guard = 0; guard < 20; guard++) {
            let bought = false;
            const fielded = [...new Set(this.host.placement.allUnits().filter((u) => u.seat === this.seat && !u.type.structure && !u.type.extra).map((u) => u.type))];
            for (const type of fielded) {
                const owned = this.host.techTree.ownedFor(this.seat, type.id);
                for (const tech of techsForUnit(type, this.host.types, this.host.loadoutOf(this.seat))) {
                    if (owned.has(tech.id)) continue;
                    if (economy.techCostOf(tech, owned.size) > economy.balance(this.seat)) continue;
                    if (dispatch({ kind: 'buyTech', team: this.team, seat: this.seat, typeId: type.id, techId: tech.id })) bought = true;
                }
            }
            if (!bought) break;
        }
    }

    /** where the enemy stands: world x per enemy group, for lane matching */
    private enemyLanes(): { unit: Unit; group: BattleGroup }[] {
        const out: { unit: Unit; group: BattleGroup }[] = [];
        for (const u of this.host.placement.allUnits()) {
            if (u.team === this.team || u.team === 'horde' || u.type.extra || u.summoned || u.destroyed) continue;
            out.push({
                unit: u,
                group: groupOf(u.type, {
                    seat: u.seat,
                    level: u.level,
                    items: u.items,
                    count: 1,
                    depth: this.depthOf(u),
                    hasTech: this.hasTech,
                    types: this.host.types,
                    leveling: this.host.leveling,
                    effects: this.effectsOf(u.seat),
                    lifeline: true,
                }),
            });
        }
        return out;
    }

    /** where the army concentrates this round (world x) */
    private focusX = 0;

    private placePlan(plan: Plan): void {
        const lanes = this.enemyLanes();
        let sum = 0;
        let weight = 0;
        for (const { unit, group } of lanes) {
            if (group.structure) continue;
            const w = group.members * group.hpEach;
            sum += unit.world.x * w;
            weight += w;
        }
        this.focusX = weight > 0 ? sum / weight : 0;
        if (this.role === 'attacker' && this.p.focusKeep > 0) {
            const keep = lanes.find(({ unit }) => unit.type.onDestroyed?.collapseOwnArmy);
            if (keep) this.focusX = this.focusX * (1 - this.p.focusKeep) + keep.unit.world.x * this.p.focusKeep;
        }
        const placed: { x: number; type: UnitType }[] = [];
        // big and front-line packs first — they claim the front, the rest fills behind
        const order = [...plan.packs].sort((a, b) => a.depth - b.depth || b.type.cost - a.type.cost);
        for (const pack of order) {
            this.placeOne(pack.type, pack.depth, lanes, placed);
        }
    }

    /**
     * Buy one pack at the best spot for it: its depth band, in the lane of the
     * enemy group it hurts most (defenders lean toward their own base), spread
     * from packs already there when the enemy splashes.
     */
    private placeOne(
        type: UnitType,
        depth: number,
        lanes: readonly { unit: Unit; group: BattleGroup }[],
        placed: { x: number; type: UnitType }[],
    ): boolean {
        const { placement, dispatch } = this.host;
        const map = placement.map;
        const me = this.plannedGroup(type, depth);
        // which enemy lane this pack wants
        let targetX = 0;
        let weight = 0;
        let enemySplash = false;
        for (const { unit, group } of lanes) {
            if (group.splash > 1.5 || group.cleave > 3) enemySplash = true;
            if (group.structure && this.role === 'attacker') continue;
            const value = dpsInto(me, group, group.members) * group.members;
            const threat = dpsInto(group, me, me.members);
            const w = Math.max(0, value) + threat * 0.35;
            targetX += unit.world.x * w;
            weight += w;
        }
        let x = weight > 0 ? targetX / weight : 0;
        if (this.p.concentrate > 0) x = x * (1 - this.p.concentrate) + this.focusX * this.p.concentrate;
        if (this.role === 'defender') {
            const keep = placement.allUnits().find((u) => u.team === this.team && u.type.onDestroyed?.collapseOwnArmy);
            if (keep) x = x * (1 - this.p.keepPull) + keep.world.x * this.p.keepPull;
        }
        // spread: step aside from packs of the same kind already in this lane
        const crowd = placed.filter((p) => Math.abs(p.x - x) < 14).length;
        if (crowd > 0) x += (crowd % 2 === 1 ? 1 : -1) * Math.ceil(crowd / 2) * (enemySplash ? this.p.laneSpacingSplash : this.p.laneSpacing) + (this.rng() - 0.5) * 4;
        x = Math.max(-map.halfW + 12, Math.min(map.halfW - 12, x));

        const { frontRow, forward, colMin, colMax } = this.frontline(this.team);
        const fp = type.footprint;
        const wantCol = Math.round((x + map.halfW) / CELL - fp.cols / 2);
        // the pack's center sits `depth` tiles behind the front edge (anchor = its first row)
        const wantRow = Math.round(frontRow - forward * (depth + fp.rows / 2) - fp.rows / 2);
        let best: { col: number; row: number; d: number } | null = null;
        for (let radius = 0; radius < 22 && !best; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                    const col = wantCol + dc * 2;
                    const row = wantRow + dr;
                    if (col < colMin || col + fp.cols - 1 > colMax) continue;
                    if (!placement.canPlaceAt(this.team, this.seat, type, { col, row }, false)) continue;
                    // depth matters more than lane: keep the band
                    const d = Math.abs(dc) * 2 + Math.abs(dr) * 3;
                    if (!best || d < best.d) best = { col, row, d };
                }
            }
        }
        const spot = best ?? placement.findAiSpot(this.team, this.seat, type, this.rng)?.anchor ?? null;
        if (!spot) return false;
        const ok = dispatch({ kind: 'buy', team: this.team, seat: this.seat, typeId: type.id, anchor: { col: spot.col, row: spot.row }, rotated: false });
        if (ok) {
            placed.push({ x, type });
            this.bought++;
        }
        return ok;
    }
}
