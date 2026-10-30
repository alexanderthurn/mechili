/**
 * The AI's army brain, every mode (AI_PLAN.md): plays a round against the
 * army it can see — its army is kept, levelled and extended like a player's.
 * This module makes it in three parts:
 *
 * 1. **Estimate** — {@link estimateBattle}: a fast battle model over groups of
 *    packs, built only from resolved stats and unit attributes (HP, damage,
 *    interval, range, speed, air/ground layers, splash and cleave against the
 *    target's formation density, overkill, conversion rays, production and
 *    on-kill spawns, shields, the Stronghold lifeline). No unit ids.
 * 2. **Choose** — the packs come from the AI's roles (aiRoles.ts, picked in
 *    ai.ts); the brain buys the talents that improve the estimate most.
 * 3. **Place** — lanes and depth by role: front-liners ahead, artillery at the
 *    back, each pack opposite the enemy group it is best against, spread out
 *    when the enemy splashes, defenders covering their base.
 *
 * Every mode and every difficulty plays it for now.
 *
 * Deterministic for the same board and stream: it reads only match state and
 * the stream it is handed.
 */
import type { Action } from './actions';
import { isChaff } from './aiCounters';
import type { TypeRegistry } from './content/typeRegistry';
import { sideFrontline } from './aiWalls';
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
    /** the level this round's buys arrive at (the commander's, or 2 once the round's recruit is bought) */
    roundRecruitLevel?: () => number;
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
        convert: !!type.convertRay || !!type.rampBeam,
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

/** role bands: tiles behind the front edge a pack prefers */
function preferredDepth(type: UnitType, stats: { range: number; minRange: number; flying: boolean; convert: boolean }): number {
    if (stats.flying) return 3;
    if (stats.convert) return 11;
    if (stats.minRange > 0 || stats.range >= 60) return 15;
    if (stats.range >= 30) return 9;
    if (stats.range >= 10) return 5;
    return type.hp >= 500 ? 0 : 1;
}

/** a type's role band from its own stats */
function depthFor(type: UnitType): number {
    return preferredDepth(type, {
        range: type.range,
        minRange: type.minRange ?? 0,
        flying: (type.flying ?? 0) > 0,
        convert: !!type.convertRay || !!type.rampBeam,
    });
}

/**
 * How a personality places the round's new packs on top of the planner's own
 * choice (opposite the enemy group each pack is best against).
 */
export interface Stance {
    /** world x the army gathers on (a Rusher: the enemy tower it goes for); null = none */
    focusX: number | null;
    /** 0…1: how hard every pack is pulled toward focusX */
    pull: number;
    /** world x positions the packs take in turn (Wide); empty = none */
    spread: number[];
    /** extra tiles behind the front for every pack (a Defender stands back) */
    depthShift: number;
    /** the first packs of the round go here instead (a Rusher's weak-side guard) */
    guard: { x: number; packs: number } | null;
}

export const NO_STANCE: Stance = { focusX: null, pull: 0, spread: [], depthShift: 0, guard: null };

/**
 * chooses the round's pack number `index` (0 = its first) of `slots` itself, maybe to stand by `near`
 * or at a flank (`side` 0: the lower columns) level with `row` — null: none
 */
export type PackPick = (
    index: number,
    slots: number,
    cost: (t: UnitType) => number,
) => { type: UnitType; near?: Unit; flank?: { side: 0 | 1; row: number } } | null;
/** buys one more pack slot for the round when a pack for it makes sense — whether it did */
export type ExtraSlot = (cost: (t: UnitType) => number) => boolean;
/** with picked packs, these come before the kept army's levels; the rest after */
const PICKS_BEFORE_LEVELS = 2;

export class YearBrain {
    /** packs bought in this build phase (the deploy cap counts these) */
    private bought = 0;
    /** set: the packs are chosen by this (Hard's roles), the planner only places them */
    private pick: PackPick | null = null;
    get packsBought(): number {
        return this.bought;
    }
    /** this brain's planner choices ({@link PLANNER} with any overrides) */
    private readonly p: typeof PLANNER;

    constructor(
        private readonly host: YearBrainHost,
        private readonly team: Team,
        private readonly seat: SeatId,
        /** this side's role in The Year (the attacker has a Tent, not the full base) */
        private readonly role: 'attacker' | 'defender',
        private readonly rng: () => number,
        overrides: Partial<typeof PLANNER> = {},
        /** where the personality wants the round's new packs (AI_PLAN.md, "Personalities") */
        private readonly stance: Stance = NO_STANCE,
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

    /** my side's front edge row and which way is forward (+1 = higher rows) */
    private frontline(team: Team): { frontRow: number; forward: number; colMin: number; colMax: number } {
        return sideFrontline(this.host.placement, team);
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
        return Math.max(this.effectsOf(this.seat)?.recruitLevel ?? 1, this.host.roundRecruitLevel?.() ?? 1);
    }

    private buyCost(type: UnitType): number {
        const level = this.recruitLevel(type);
        const premium = level > 1 ? Math.round((type.levelBasis ?? type.cost) * this.host.leveling.levelCostFactor) * (level - 1) : 0;
        return this.host.economy.costOf(type) + premium;
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

    /**
     * Play one build phase: the packs `pick` chooses — the first two, then
     * the army's levels, then, with a slot bought if one makes sense, the rest.
     */
    playRound(opts: { slots: number; finish?: boolean; pick: PackPick; extraSlot?: ExtraSlot }): void {
        // what may still move goes where this round's plan wants it (round 1: the starting army)
        this.repositionMovable();
        this.pick = opts.pick;
        this.placePicks(Math.min(opts.slots, PICKS_BEFORE_LEVELS));
        this.buyLevels();
        const slots = opts.slots + (opts.extraSlot?.((t) => this.buyCost(t)) ? 1 : 0);
        this.placePicks(slots);
        if (opts.finish !== false) this.finish(slots);
    }
    /**
     * The rest of the round after its packs: more picked packs while `slots`
     * (the round's pack limit) allows and supply covers them, then the
     * talents that improve the battle estimate. Called by playRound, or later
     * when the AI spends on other things first.
     */
    finish(slots: number): void {
        this.placePicks(slots);
        this.buyTalents();
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

    /**
     * The packs `pick` chooses, one after another while slots are left, each
     * placed as the planner would — a Rusher's first ones as its weak-side guard.
     */
    private placePicks(slots: number): void {
        if (!this.pick) return;
        const lanes = this.enemyLanes();
        this.setFocus(lanes);
        const placed: { x: number; type: UnitType }[] = [];
        const guards = this.stance.guard?.packs ?? 0;
        while (this.bought < slots) {
            const pick = this.pick(this.bought, slots, (t) => this.buyCost(t));
            if (!pick || this.buyCost(pick.type) > this.host.economy.balance(this.seat)) break;
            const { type, near, flank } = pick;
            const guard = this.bought < guards ? this.stance.guard!.x : undefined;
            // a flank's answer stands at that flank; an answer to a weak point just behind what was hurt
            const at = flank ? this.spotAtFlank(type, flank.side, flank.row) : near && guard === undefined ? this.spotBehind(type, near) : null;
            if (at) {
                if (!this.buyAt(type, at)) break;
                placed.push({ x: at.x, type });
            } else if (!this.placeOne(type, depthFor(type), lanes, placed, guard)) break;
        }
    }

    /** whatever supply is left: the talents that improve the battle estimate */
    private buyTalents(): void {
        const { economy, dispatch } = this.host;
        // Talents that improve the battle estimate — never dump leftover into
        // zero-effect picks (Blightburst / Loose Rank aren't modeled yet).
        for (let guard = 0; guard < 20; guard++) {
            const board = this.boardGroups();
            const current = this.roundScore(estimateBattle(board.mine, board.theirs));
            let best: { type: UnitType; techId: string; score: number } | null = null;
            const fielded = [
                ...new Set(
                    this.host.placement
                        .allUnits()
                        .filter((u) => u.seat === this.seat && !u.type.structure && !u.type.extra)
                        .map((u) => u.type),
                ),
            ];
            for (const type of fielded) {
                const owned = this.host.techTree.ownedFor(this.seat, type.id);
                for (const tech of techsForUnit(type, this.host.types, this.host.loadoutOf(this.seat))) {
                    if (owned.has(tech.id)) continue;
                    if (economy.techCostOf(tech, owned.size) > economy.balance(this.seat)) continue;
                    const s = this.roundScore(this.estimateWithExtraTech(type.id, tech.id));
                    if (s <= current) continue;
                    if (!best || s > best.score) best = { type, techId: tech.id, score: s };
                }
            }
            if (!best) break;
            if (
                !dispatch({
                    kind: 'buyTech',
                    team: this.team,
                    seat: this.seat,
                    typeId: best.type.id,
                    techId: best.techId,
                })
            ) {
                break;
            }
        }
    }

    /** Board estimate as if this seat already owned `techId` on `typeId`. */
    private estimateWithExtraTech(typeId: string, techId: string): BattleEstimate {
        const { types, leveling } = this.host;
        const hasTech: HasTech = (seat, tid, id) =>
            (seat === this.seat && tid === typeId && id === techId) || this.hasTech(seat, tid, id);
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
                hasTech: u.seat === this.seat ? hasTech : this.hasTech,
                types,
                leveling,
                effects: this.effectsOf(u.seat),
                lifeline: true,
            });
            (u.team === this.team ? mine : theirs).push(g);
        }
        return estimateBattle(mine, theirs);
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

    /**
     * Its packs that may still move this round (a starting army, packs of an
     * earlier pass): to where the round's plan wants them — the
     * personality's stance, the role's depth — before the new packs join.
     */
    private repositionMovable(): void {
        const { placement, dispatch } = this.host;
        const movable = placement
            .allUnits()
            .filter((u) => u.seat === this.seat && !u.destroyed && !u.summoned && !u.gridless && !u.type.structure && !u.type.extra && !isChaff(u.type) && placement.canReposition(u))
            .sort((a, b) => depthFor(a.type) - depthFor(b.type) || b.type.cost - a.type.cost || a.id - b.id);
        if (movable.length === 0) return;
        const lanes = this.enemyLanes();
        this.setFocus(lanes);
        const placed: { x: number; type: UnitType }[] = [];
        for (const u of movable) {
            const at = this.spotFor(u.type, depthFor(u.type), lanes, placed, undefined, u.rotated);
            if (!at) continue;
            placed.push({ x: at.x, type: u.type });
            if (at.spot.col === u.cell.col && at.spot.row === u.cell.row) continue;
            dispatch({ kind: 'move', team: this.team, seat: this.seat, unitId: u.id, anchor: at.spot });
        }
    }

    /** where the army concentrates (world x): its enemy's centre, an attacker's maybe their keep */
    private setFocus(lanes: readonly { unit: Unit; group: BattleGroup }[]): void {
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
        /** stand here (a guard), whatever the lanes say */
        atX?: number,
    ): boolean {
        // chaff stands anywhere: the enemy comes from many angles, so it screens best spread at random
        const at = isChaff(type) && atX === undefined ? this.randomSpot(type) : this.spotFor(type, depth, lanes, placed, atX, false);
        if (!at || !this.buyAt(type, at)) return false;
        placed.push({ x: at.x, type });
        return true;
    }

    /** any spot of the side's zone a new pack of `type` may stand on, at random */
    private randomSpot(type: UnitType): { spot: { col: number; row: number }; x: number } | null {
        const any = this.host.placement.findAiSpot(this.team, this.seat, type, this.rng, true);
        if (!any || any.rotated) return null;
        return { spot: any.anchor, x: (any.anchor.col + type.footprint.cols / 2) * CELL - this.host.placement.map.halfW };
    }

    /**
     * The spot a pack of `type` wants: its depth band, in the lane of the
     * enemy group it hurts most (defenders lean toward their own base), the
     * personality's stance on top, spread from packs already there when the
     * enemy splashes. Null when nothing fits.
     */
    private spotFor(
        type: UnitType,
        depth: number,
        lanes: readonly { unit: Unit; group: BattleGroup }[],
        placed: readonly { x: number; type: UnitType }[],
        atX: number | undefined,
        rotated: boolean,
    ): { spot: { col: number; row: number }; x: number } | null {
        const { placement } = this.host;
        const map = placement.map;
        depth = Math.max(0, depth + this.stance.depthShift);
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
        if (this.role === 'defender' && this.stance.focusX === null) {
            const keep = placement.allUnits().find((u) => u.team === this.team && u.type.onDestroyed?.collapseOwnArmy);
            if (keep) x = x * (1 - this.p.keepPull) + keep.world.x * this.p.keepPull;
        }
        // the personality: a guard's spot, its turn in the spread, or the pull toward its focus
        const { stance } = this;
        if (atX !== undefined) x = atX;
        else if (stance.spread.length > 0) x = x * (1 - stance.pull) + stance.spread[placed.length % stance.spread.length]! * stance.pull;
        else if (stance.focusX !== null) x = x * (1 - stance.pull) + stance.focusX * stance.pull;
        // spread: step aside from packs of the same kind already in this lane
        const crowd = placed.filter((p) => Math.abs(p.x - x) < 14).length;
        if (crowd > 0) x += (crowd % 2 === 1 ? 1 : -1) * Math.ceil(crowd / 2) * (enemySplash ? this.p.laneSpacingSplash : this.p.laneSpacing) + (this.rng() - 0.5) * 4;
        x = Math.max(-map.halfW + 12, Math.min(map.halfW - 12, x));

        const { frontRow, forward, colMin, colMax } = this.frontline(this.team);
        const fp = rotated ? { cols: type.footprint.rows, rows: type.footprint.cols } : type.footprint;
        const wantCol = Math.round((x + map.halfW) / CELL - fp.cols / 2);
        // the pack's center sits `depth` tiles behind the front edge (anchor = its first row)
        const wantRow = Math.round(frontRow - forward * (depth + fp.rows / 2) - fp.rows / 2);
        const best = this.nearestSpot(type, wantCol, wantRow, rotated, colMin, colMax);
        if (best) return { spot: best, x };
        // nothing near the wanted spot: anywhere it may stand (a new pack only — a moved one keeps its place)
        if (rotated) return null;
        const any = placement.findAiSpot(this.team, this.seat, type, this.rng);
        return any && !any.rotated ? { spot: any.anchor, x } : null;
    }

    /** the free spot for `type` nearest to the wanted anchor, the row kept before the column; null when none is near */
    private nearestSpot(type: UnitType, wantCol: number, wantRow: number, rotated: boolean, colMin: number, colMax: number): { col: number; row: number } | null {
        const { placement } = this.host;
        const fp = rotated ? { cols: type.footprint.rows, rows: type.footprint.cols } : type.footprint;
        let best: { col: number; row: number; d: number } | null = null;
        for (let radius = 0; radius < 22 && !best; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                    const col = wantCol + dc * 2;
                    const row = wantRow + dr;
                    if (col < colMin || col + fp.cols - 1 > colMax) continue;
                    if (!placement.canPlaceAt(this.team, this.seat, type, { col, row }, rotated)) continue;
                    // the wall plan's tiles stay free for its walls (aiWalls)
                    if (placement.aiAvoidsAt(this.seat, type, { col, row }, rotated)) continue;
                    // depth matters more than lane: keep the band
                    const d = Math.abs(dc) * 2 + Math.abs(dr) * 3;
                    if (!best || d < best.d) best = { col, row, d };
                }
            }
        }
        return best ? { col: best.col, row: best.row } : null;
    }

    /** the spot just behind `unit` (toward the own base) for a new pack of `type`, or null when nothing fits near it */
    private spotBehind(type: UnitType, unit: Unit): { spot: { col: number; row: number }; x: number } | null {
        const { forward, colMin, colMax } = this.frontline(this.team);
        const own = unit.rotated ? { cols: unit.type.footprint.rows, rows: unit.type.footprint.cols } : unit.type.footprint;
        const fp = type.footprint;
        const centerCol = unit.cell.col + own.cols / 2;
        const centerRow = unit.cell.row + own.rows / 2 - forward * (own.rows / 2 + fp.rows / 2 + 1);
        const spot = this.nearestSpot(type, Math.round(centerCol - fp.cols / 2), Math.round(centerRow - fp.rows / 2), false, colMin, colMax);
        return spot ? { spot, x: unit.world.x } : null;
    }

    /** the spot in the zone's outer columns on `side` (0: the lower) level with `row`, or null when nothing fits near it */
    private spotAtFlank(type: UnitType, side: 0 | 1, row: number): { spot: { col: number; row: number }; x: number } | null {
        const { colMin, colMax } = this.frontline(this.team);
        const fp = type.footprint;
        const spot = this.nearestSpot(type, side === 0 ? colMin : colMax - fp.cols + 1, Math.round(row - fp.rows / 2), false, colMin, colMax);
        return spot ? { spot, x: (spot.col + fp.cols / 2) * CELL - this.host.placement.map.halfW } : null;
    }

    /** buys a pack of `type` on `at` */
    private buyAt(type: UnitType, at: { spot: { col: number; row: number } }): boolean {
        const ok = this.host.dispatch({ kind: 'buy', team: this.team, seat: this.seat, typeId: type.id, anchor: at.spot, rotated: false });
        if (ok) this.bought++;
        return ok;
    }
}
