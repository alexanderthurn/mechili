import { quantizeWorld, quantizeYaw, type Action } from './actions';
import { detCos, detSin } from './detMath';
import { unlockCostFor } from './cards';
import type { RoundCard, SpecialityId, StartCard } from './cards';
import type { PlacementController } from './placement';
import type { BoostSettings, DeploySettings, Economy } from './settings';
import {
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    MOVE_UNIT_ID,
    TUTOR_ID,
    SELL_UNIT_ID,
    usesSpellPlacement,
} from './tactics';
import type { TechTree } from './tech';
import type { Loadout } from './techCatalog';
import { formationHeadcount, hasAbility, hpWithdrawOf, type BuildingAbilityId, type Team, type Unit, type UnitType } from './units';
import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import { itemSlotLimit } from './items';
import { NO_STANCE, YearBrain, type PackPick, type Stance } from './aiYear';
import { AI_ROLES, readNeeds, readWeakPoints, STRONG_FROM, strongHelpless, THIRD_PACK_FREE_FROM, type LossKind, type Need, type Roster, type WeakPoint } from './aiRoles';
import { CELL } from './map';
import { isChaff } from './aiCounters';
import { AI_WALL_ID, orderedWallPlan, placeWallPlan, sideFrontline, wallInSlot, wallPlanCells, type PlanSlot } from './aiWalls';
import type { LevelingSettings } from './settings';
import { DEFENDER_WALL_SHARE, type AiDifficulty, type AiStyle } from './aiProfile';

/** what a round's defence wants: wall slots, the share of the round's supply it may use, and whether to man the walls */
interface Defence {
    wall: UnitType | null;
    slots: PlanSlot[];
    share: number;
    man: boolean;
}

/** a Rusher's weak tower fell "first" unless it held this many seconds beyond the rush's tower */
const RACE_MARGIN = 5;
/** the share of the enemy on one side that puts the tower there in danger now */
const SIDE_THREAT = 0.5;
/** front walls per stall step: the minimum, and two more per danger level */
const STALL_WALLS = 2;
/** a Rusher's / Wide's defence may use this share of what it holds */
const STALL_SHARE = 0.35;
/** how hard a Rusher's packs are pulled onto its target */
const RUSH_PULL = 0.8;
/** how hard Wide's packs are pulled onto their spread points, and how far forward they stand */
const WIDE_PULL = 0.7;
const WIDE_FORWARD = 3;
/** how far back a Defender's packs stand */
const DEFENDER_BACK = 8;
/** borrow when the enemy's army, all surviving, would take this share of its HP */
const CREDIT_MARGIN = 0.8;
/** range from which a pack counts as ranged, and the ranged share that buys the range boost */
const RANGED_FROM = 10;
const RANGED_SHARE = 0.5;
/** sending supply: keep this much, send only from this much on */
const SEND_KEEP = 100;
const SEND_MIN = 100;
import { laneCols, ownTowers, readThreat, threatLines, towerCol, type BattleRecord, type ThreatMap } from './aiThreat';

/**
 * A side's decision maker. The built-in AI implements it; a future network
 * opponent will too (its "decisions" being actions received from the peer).
 * Everything an opponent does flows through the same dispatcher as the
 * player's input — no other channel exists.
 */
export interface Opponent {
    /** pick one of the offered specialist cards */
    chooseStarter(offer: readonly StartCard[]): void;
    /** act at the start of a build phase: techs, buys, rearranging — then lock in */
    onBuildPhase(round: number): void;
    /** answer the between-round card offer (pick or skip) */
    onRoundCards(offer: readonly RoundCard[]): void;
    /**
     * Re-run deploy actions without locking in again (cheat mid-phase top-up):
     * buys, reposition, items, spells, upgrades.
     */
    rerunBuildActions?(): void;
    /** what it read before its last build, for the debug overlay (`name` = the seat's) */
    debugLines?(name: string): string[];
}

export class AiOpponent implements Opponent {
    constructor(
        private readonly team: Team,
        /** the seat this brain commands — its purse, its lane, its packs */
        private readonly seat: SeatId,
        private readonly ctx: {
            /** the unit and building definitions this match plays with */
            types: TypeRegistry;
            dispatch: (action: Action) => boolean;
            placement: PlacementController;
            economy: Economy;
            techTree: TechTree;
            /** per-SEAT — own card's shop unlocks, never shared */
            unlockedUnits: string[][];
            /** per-SEAT — own once-per-round shop-unlock gate */
            unlockUsedThisRound: boolean[];
            /** per-SEAT — never shared */
            items: string[][];
            /** per-SEAT — never shared */
            tactics: string[][];
            /** per-SEAT chosen commander — prices its own shop unlocks */
            speciality: (SpecialityId | null)[];
            commander: (string | null)[];
            /** the AI's own seeded stream — nothing else may consume it */
            rng: () => number;
            /** per-SEAT talent picks; AI seats normally have none and get
             *  the catalog default (PROGRESSION_PLAN.md §1c) */
            loadoutOf: (seat: SeatId) => Loadout | undefined;
            /** shop deploy prices (extra slot, base rune, …) */
            deploySettings: DeploySettings;
            /** per-SEAT stronghold spells already bought this match */
            forgeSpellOwned: string[][];
            /** this seat's commander forge-spell pool */
            forgeSpellsOf: (seat: SeatId) => readonly string[] | undefined;
            /** 'lockInOnly': skip every purchase and just lock in (scenario opponents) */
            opponents?: 'build' | 'lockInOnly';
            /** leveling rules (the planner reads level multipliers and prices) */
            leveling: LevelingSettings;
            /** The Year: this seat's role — its planner knows who has the base */
            yearRole?: 'attacker' | 'defender';
            /** new packs this seat may deploy in a build phase */
            deployCap: () => number;
            /** planner choice overrides for this seat (arena experiments) */
            plannerOverrides?: Record<string, number>;
            /** Stone Walls this seat may still place this round (0 / unset: none) */
            wallsLeft?: () => number;
            /** how the towers did in the last battle (null before the first) */
            lastBattle?: () => BattleRecord | null;
            /** its side's HP, and whether it carries over (not in a Rounds match) — for the loan */
            sideHp?: () => number;
            hpCarriesOver?: boolean;
            /** the other seat of its side (2v2), for sending supply */
            allySeat?: SeatId | null;
            /** the Command Tower's army boosts: their tiers and the ones it owns */
            armyBoosts?: () => { settings: BoostSettings; attack: number; hp: number };
            /** the level this round's buys arrive at */
            roundRecruitLevel?: () => number;
            /** what one more level of this base building costs it, or null when it can't level it */
            upgradeCostOf?: (building: Unit) => number | null;
            /** the seat's strength, set in the lobby (aiProfile) */
            difficulty: AiDifficulty;
            /** the style it plays (Random has picked one) and a Rusher's side (0 = its lower-column tower) */
            style: AiStyle;
            rushSide: 0 | 1;
        },
    ) {}

    /** the enemy as read at the start of the last build (AI_PLAN.md, "Threat map") */
    private threat: ThreatMap | null = null;

    debugLines(name: string): string[] {
        if (!this.threat) return [];
        const style = this.ctx.style === 'rusher' ? `rusher ${this.ctx.rushSide === 0 ? 'low' : 'high'} side` : this.ctx.style;
        const lines = threatLines(`${name} (${this.ctx.difficulty}, ${style})`, this.threat, this.ctx.lastBattle?.() ?? null, this.team, this.seat);
        if (this.weakPoints.length > 0) {
            const at = (id: number) => this.ctx.placement.allUnits().find((u) => u.id === id)?.type.id ?? '?';
            lines.push('  weak: ' + this.weakPoints.map((w) => `${w.kind} ${w.loss.toFixed(1)} at ${at(w.victimId)}`).join(', '));
        }
        return lines;
    }

    chooseStarter(offer: readonly StartCard[]): void {
        const pick = offer[Math.floor(this.ctx.rng() * offer.length)]!;
        this.ctx.dispatch({ kind: 'chooseCard', team: this.team, seat: this.seat, cardId: pick.id });
    }

    /** the between-round card: any it can afford whose charges it uses (it never sells or moves old packs) */
    onRoundCards(offer: readonly RoundCard[]): void {
        const affordable = offer.filter(
            (c) => this.ctx.economy.balance(this.seat) >= c.cost && !c.tactics?.includes(SELL_UNIT_ID) && !c.tactics?.includes(MOVE_UNIT_ID),
        );
        const pick = affordable.length > 0 ? affordable[Math.floor(this.ctx.rng() * affordable.length)]! : null;
        this.ctx.dispatch({
            kind: 'roundCard',
            team: this.team,
            seat: this.seat,
            cardId: pick?.id ?? null,
        });
    }

    /** the round being built */
    private round = 1;

    onBuildPhase(round: number): void {
        this.round = round;
        // a scenario's authored army fights as placed — lock in, nothing else
        if (this.ctx.opponents !== 'lockInOnly') {
            this.build(this.ctx.rng);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /** cheat mid-deploy: the same round again, without another lock-in */
    rerunBuildActions(): void {
        this.build(this.ctx.rng);
    }

    /**
     * One build phase, every mode (AI_PLAN.md): read the enemy, the defence
     * its personality wants (walls, posts, the weak tower), then the planner's
     * army in the personality's stance (kept and extended; its packs by
     * roles), then runes, spells and building levels.
     * Every difficulty plays this for now (AI_PLAN.md, "Difficulty").
     */
    private build(rng: () => number): void {
        const { economy } = this.ctx;
        // read the enemy first: where its army stands, which posture that is
        this.threat = readThreat(this.ctx.placement, this.team, this.seat);
        const towers = this.ownTowers();
        // how much danger each of its sides is in (0…2): the last battle, and what stands there now
        const danger = towers.map((t) => this.danger(t));
        const weak = this.ctx.style === 'rusher' && towers.length === 2 ? (1 - this.ctx.rushSide) as 0 | 1 : null;
        // nearly dead where HP carries over: borrow, it all goes into the army
        this.borrowIfDying();
        const roundSupply = economy.balance(this.seat);
        // the defence this round wants: its wall slots are kept free of packs from now on
        const defence = this.planDefence(towers, danger, weak);
        // the army's helpers before it buys: tutor charges
        this.useTutorCharges();
        // 1) the army's packs by roles (aiRoles), where the personality wants them; the +1 buy
        //    after its levels, when a pack for it makes sense
        const brain = new YearBrain(
            this.ctx,
            this.team,
            this.seat,
            this.ctx.yearRole ?? 'defender',
            rng,
            // outside a Siege there is no base to huddle round: no pull toward its own Stronghold
            { ...(this.ctx.yearRole ? {} : { keepPull: 0 }), ...this.ctx.plannerOverrides },
            this.stance(towers, danger, weak),
        );
        brain.playRound({ slots: this.ctx.deployCap(), finish: false, pick: this.rolePick(rng), extraSlot: this.extraPackSlot });
        // 2) the defence, out of what the packs left
        this.buildDefence(defence, towers, danger, weak, roundSupply);
        // 3) the rest of the army: talents (and packs, should a slot be left)
        brain.finish(brain.packsBought + this.ctx.deployCap());
        // 4) what the bag holds (cards) onto packs
        this.applyItems(rng);
        // 5) spells: the Stronghold's forge spells, then the strip
        this.buyForgeSpells();
        this.placeTactics(rng);
        // 6) what's left: army boosts where worth more than another pack, range / speed
        this.buyArmyBoosts();
        this.buyRoundBoosts();
        // 7) supply for an ally, then runes with what's left — as many as its packs have room for
        this.sendSpareSupply();
        this.buyRunesForFreeSlots(rng);
    }

    /** its research centre and command tower, by column (index = the side, as the threat map's `sides`) */
    private ownTowers(): Unit[] {
        return ownTowers(this.ctx.placement, this.seat);
    }

    /**
     * How much danger a tower is in, 0…2: +1 when the last battle went badly
     * there — it fell, or lost more than half its HP while the enemy's tower
     * on the other end (the rush target, for a Rusher's weak side) still
     * stood — and +1 when most of the enemy stands on its side right now.
     */
    private danger(tower: Unit): number {
        if (!this.threat) return 0;
        let level = this.hurtLastBattle(tower) ? 1 : 0;
        const side = this.ownTowers().indexOf(tower);
        if (side >= 0 && (this.threat.sides[side] ?? 0) >= SIDE_THREAT) level++;
        return Math.min(2, level);
    }

    /** whether the last battle went badly for this tower: it fell (a Rusher's: not well after the rush took theirs), or lost over half its HP while theirs stood */
    private hurtLastBattle(tower: Unit): boolean {
        const kind = tower.type.baseAnchor;
        const mine = this.ctx.lastBattle?.()?.towers.find((t) => t.seat === this.seat && t.kind === kind);
        const target = this.rushTarget();
        const theirs = target
            ? this.ctx.lastBattle?.()?.towers.find((t) => t.seat === target.seat && t.kind === target.type.baseAnchor)
            : undefined;
        if (!mine) return false;
        const fellFirst = mine.fellAt !== null && (theirs?.fellAt == null || mine.fellAt < theirs.fellAt + RACE_MARGIN);
        const badlyHurt = mine.fellAt === null && mine.hpLeft < 0.5 && theirs?.fellAt == null;
        return fellFirst || badlyHurt;
    }

    /**
     * The enemy tower a Rusher goes for: the one facing its rush-side tower
     * (nearest by column); with no enemy towers (a Siege attacker has a Tent),
     * the nearest enemy building.
     */
    private rushTarget(): Unit | null {
        if (this.ctx.style !== 'rusher') return null;
        const fromX = this.sideX(this.ctx.rushSide);
        const enemies = this.ctx.placement.allUnits().filter((u) => u.team !== this.team && u.team !== 'horde' && !u.destroyed && u.type.structure && !u.type.extra);
        const towersOf = enemies.filter((u) => u.type.baseAnchor === 'research' || u.type.baseAnchor === 'command');
        const pool = towersOf.length > 0 ? towersOf : enemies;
        let best: Unit | null = null;
        for (const u of pool) if (!best || Math.abs(u.world.x - fromX) < Math.abs(best.world.x - fromX)) best = u;
        return best;
    }

    /** world x of one side of its front: its tower there, or (a Siege attacker has none) a quarter into its lane */
    private sideX(side: 0 | 1): number {
        const tower = this.ownTowers()[side];
        if (tower) return tower.world.x;
        const { min, max } = laneCols(this.ctx.placement, this.team, this.seat);
        const col = min + (max - min) * (side === 0 ? 0.25 : 0.75);
        return col * CELL - this.ctx.placement.map.halfW;
    }

    /**
     * Where the personality wants the round's new packs:
     * - Rusher: gathered on the enemy tower it goes for; a guard pack per
     *   danger level at its weak tower.
     * - Wide: spread over its two towers and the centre, standing forward.
     * - Defender: standing back, opposite the enemy.
     */
    private stance(towers: readonly Unit[], danger: readonly number[], weak: 0 | 1 | null): Stance {
        switch (this.ctx.style) {
            case 'rusher': {
                const target = this.rushTarget();
                const guard = weak !== null && (danger[weak] ?? 0) > 0 ? { x: towers[weak]!.world.x, packs: danger[weak]! } : null;
                return { ...NO_STANCE, focusX: target?.world.x ?? null, pull: RUSH_PULL, guard };
            }
            case 'wide': {
                if (towers.length < 2) return NO_STANCE;
                const [a, b] = [towers[0]!.world.x, towers[1]!.world.x];
                return { ...NO_STANCE, spread: [a, (a + b) / 2, b], pull: WIDE_PULL, depthShift: -WIDE_FORWARD };
            }
            case 'defender':
                return { ...NO_STANCE, depthShift: DEFENDER_BACK };
        }
    }

    /**
     * The defence its personality wants this round (AI_PLAN.md, "Walls by
     * personality"), as wall slots and a share of the round's supply:
     * - Defender: the whole fortress plan, posts and levels on it, then
     *   Stronghold archers, within its share.
     * - Every other style: before a tower in danger, the walls
     *   already there and two more per danger level (a Rusher's weak tower two
     *   more, its stall) — front first, then on through the plan, so every
     *   round in danger adds to it without end — archers on them (against
     *   flyers too: the archers shoot them).
     * A tower the last battle hurt is also reinforced (buildDefence). The
     * slots it intends stay free of its own packs from here on.
     */
    private planDefence(towers: readonly Unit[], danger: readonly number[], weak: 0 | 1 | null): Defence {
        const { placement } = this.ctx;
        const wall = this.ctx.types.byId(AI_WALL_ID) ?? null;
        const style = this.ctx.style;
        const plan = wall ? orderedWallPlan(placement, this.team, this.seat, wall) : [];
        // a tower's slots, nearest first — the front before it, then the rest of the plan — up to
        // `more` that don't stand yet: what stands there stays wanted (posts, levels), and every
        // round in danger adds more, never stopping until the whole plan stands
        const slotsBefore = (tower: Unit, more: number) => {
            const near = [...plan].sort(
                (a, b) => Number(a.phase !== 0) - Number(b.phase !== 0) || Math.abs(a.col - towerCol(tower)) - Math.abs(b.col - towerCol(tower)),
            );
            const out: PlanSlot[] = [];
            let missing = 0;
            for (const slot of near) {
                if (missing >= more) break;
                if (wall && !wallInSlot(placement, this.seat, wall, slot)) missing++;
                out.push(slot);
            }
            return out;
        };
        const defence: Defence = { wall, slots: [], share: 0, man: false };
        if (style === 'defender') {
            defence.slots = plan;
            defence.share = DEFENDER_WALL_SHARE;
            defence.man = true;
        } else {
            // a tower in danger — its side hurt last battle, or the enemy there now — gets walls
            // before it with archers on them (against flyers too: the archers shoot them); a Rusher's
            // weak tower two more, its stall
            towers.forEach((t, i) => {
                if (danger[i]! <= 0) return;
                const more = STALL_WALLS * (danger[i]! + (style === 'rusher' && i === weak ? 1 : 0));
                defence.slots.push(...slotsBefore(t, more).filter((s) => !defence.slots.includes(s)));
            });
            defence.man = defence.slots.length > 0;
            defence.share = STALL_SHARE;
        }
        const canWall = !!wall && !!this.ctx.wallsLeft && this.ctx.wallsLeft() > 0;
        placement.setAiAvoid(this.seat, wall && canWall ? wallPlanCells(defence.slots, wall) : new Set());
        return defence;
    }

    /**
     * Builds the planned defence: a tower the last battle hurt reinforced,
     * walls, archers on their posts, a level each, a Defender's Stronghold
     * archers — no more than
     * its share of the round's supply (`roundSupply`), and never more than it
     * still holds.
     */
    private buildDefence(
        defence: Defence,
        towers: readonly Unit[],
        danger: readonly number[],
        weak: 0 | 1 | null,
        roundSupply: number,
    ): void {
        const { placement, economy, dispatch } = this.ctx;
        const { wall, slots } = defence;
        const style = this.ctx.style;
        const start = economy.balance(this.seat);
        const budget = Math.min(start, roundSupply * Math.max(defence.share, STALL_SHARE));
        const left = () => budget - (start - economy.balance(this.seat));
        // a posted archer is one of the round's buys: after its packs, whatever is left is spare
        const spareBuy = () => this.ctx.deployCap() > 0;
        // a tower the last battle hurt: a level up — more HP, a shorter debuff when it falls —
        // and an archer on its top where it has a pad
        for (const t of towers) {
            if (!this.hurtLastBattle(t)) continue;
            const level = this.ctx.upgradeCostOf?.(t) ?? null;
            if (level !== null && left() >= level) dispatch({ kind: 'upgradeTower', team: this.team, seat: this.seat, unitId: t.id });
            if (t.type.garrison) {
                if (spareBuy() && left() >= this.ctx.types.postCost(t.type)) dispatch({ kind: 'buyStrongholdArcher', team: this.team, seat: this.seat, unitId: t.id });
            }
        }
        if (!wall || slots.length === 0 || defence.share <= 0) {
            if (wall) this.makeGates(wall);
            return;
        }
        if (this.ctx.wallsLeft && this.ctx.wallsLeft() > 0) {
            const count = Math.min(this.ctx.wallsLeft(), Math.floor(left() / Math.max(1, economy.costOf(wall))));
            placeWallPlan(placement, this.team, this.seat, wall, slots, count, (slot) =>
                dispatch({ kind: 'buy', team: this.team, seat: this.seat, typeId: wall.id, ...slot }),
            );
        }
        // gates before archers go up (a wall turned into a gate loses its archers)
        this.makeGates(wall);
        // the walls of its slots: archers onto their posts, then a level each — within the share
        const walls = slots.map((s) => wallInSlot(placement, this.seat, wall, s)).filter((w): w is Unit => !!w);
        if (defence.man) {
            for (const w of walls) {
                const posts = w.type.wall?.posts;
                if (!posts) continue;
                while (spareBuy() && left() >= this.ctx.types.postCost(w.type) && dispatch({ kind: 'buyWallPost', team: this.team, seat: this.seat, unitId: w.id }));
            }
            for (const w of walls) {
                if (left() >= (w.type.wall?.upgradeCost ?? Infinity)) dispatch({ kind: 'upgradeTower', team: this.team, seat: this.seat, unitId: w.id });
            }
        }
        // a Defender's last use of its share: archers on the Stronghold's battlements
        if (style === 'defender') {
            const keep = placement.allUnits().find((u) => u.team === this.team && !u.destroyed && u.type.baseAnchor === 'stronghold' && !!u.type.garrison);
            for (let guard = 0; keep && guard < 5; guard++) {
                if (!spareBuy() || left() < this.ctx.types.postCost(keep.type)) break;
                if (!dispatch({ kind: 'buyStrongholdArcher', team: this.team, seat: this.seat })) break;
            }
        }
    }

    /**
     * Gates in its fortress (AI_PLAN.md, "Gates"), per half of the front: the
     * inner front piece next to the hole once it stands, and the front-most
     * flank piece once its own packs stand outside that flank wall, so they
     * move freely. Paid from what it holds, not the defence share.
     */
    private makeGates(wall: UnitType): void {
        const { placement, economy, dispatch } = this.ctx;
        const make = wall.wall?.makeGate;
        if (!make) return;
        const plan = orderedWallPlan(placement, this.team, this.seat, wall);
        const { colMin, colMax } = sideFrontline(placement, this.team);
        const mid = (colMin + colMax + 1) / 2;
        // packs that walk: not the archers posted on its walls and keep
        const packs = this.ownPacks().filter((u) => u.hostUnitId === null);
        for (const half of [-1, 1]) {
            const front = plan.filter((s) => s.phase === 0 && s.half === half).sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid))[0];
            const flank = plan.filter((s) => s.phase === 2 && s.half === half);
            const want: PlanSlot[] = front ? [front] : [];
            const corner = [...flank].sort((a, b) => a.step - b.step)[0];
            if (corner) {
                // the rows the flank wall runs over, and its column: own packs beyond it want a way through
                const rows = flank.flatMap((s) => [s.anchor.row, s.anchor.row + wall.footprint.cols - 1]);
                const top = Math.min(...rows);
                const bottom = Math.max(...rows);
                const outside = packs.some((u) => {
                    const fp = u.rotated ? { cols: u.type.footprint.rows, rows: u.type.footprint.cols } : u.type.footprint;
                    const col = u.cell.col + fp.cols / 2;
                    const row = u.cell.row + fp.rows / 2;
                    return row >= top && row <= bottom + 1 && (half < 0 ? col < corner.anchor.col : col > corner.anchor.col + 1);
                });
                if (outside) want.push(corner);
            }
            for (const slot of want) {
                const piece = wallInSlot(placement, this.seat, wall, slot);
                if (!piece || piece.type.id !== wall.id || economy.balance(this.seat) < make.cost) continue;
                dispatch({ kind: 'makeGate', team: this.team, seat: this.seat, unitId: piece.id });
            }
        }
    }

    /** whether it holds a building that sells this ability (its own, or its side's Stronghold) — the AI never uses one it couldn't click */
    private owns(ability: BuildingAbilityId): boolean {
        return this.ctx.placement
            .allUnits()
            .some(
                (u) =>
                    u.team === this.team &&
                    !u.destroyed &&
                    hasAbility(u.type, ability) &&
                    (u.seat === this.seat || u.type.baseAnchor === 'stronghold'),
            );
    }

    /** its packs' value: cost × level */
    private armyValue(): number {
        let value = 0;
        for (const u of this.ctx.placement.allUnits()) {
            if (u.seat === this.seat && !u.destroyed && !u.type.structure && !u.type.extra) value += u.type.cost * Math.max(1, u.level);
        }
        return value;
    }

    /**
     * The loan: only where HP carries over, and only when a
     * lost battle could end the match — the enemy's army, should it all
     * survive, takes its cost from the loser's HP. Next round's debt matters
     * less than this round.
     */
    private borrowIfDying(): void {
        const { hpCarriesOver, sideHp } = this.ctx;
        if (!hpCarriesOver || !sideHp || !this.owns('credit')) return;
        let reach = 0;
        for (const u of this.ctx.placement.allUnits()) {
            if (u.team === this.team || u.team === 'horde' || u.destroyed || u.summoned || u.type.structure || u.type.extra) continue;
            reach += hpWithdrawOf(u.type) * formationHeadcount(u.type);
        }
        if (reach >= sideHp() * CREDIT_MARGIN) this.ctx.dispatch({ kind: 'buyCredit', team: this.team, seat: this.seat });
    }

    /**
     * The +1 buy, after its first packs and levels: every slot is filled, and supply covers the slot and a pack of
     * its chaff (or its cheapest pack) — the pick then chooses that pack.
     */
    private extraPackSlot = (cost: (t: UnitType) => number): boolean => {
        if (this.ctx.deployCap() > 0 || !this.owns('deploySlot')) return false;
        const chaff = this.roster ? this.ctx.types.byId(this.roster.chaff) : null;
        const pack = chaff && this.ctx.unlockedUnits[this.seat]!.includes(chaff.id) ? chaff : this.cheapestArmyType(cost);
        if (!pack || this.ctx.economy.balance(this.seat) < this.ctx.deploySettings.extraSlotCost + cost(pack)) return false;
        return this.ctx.dispatch({ kind: 'buyDeploySlot', team: this.team, seat: this.seat });
    };

    /**
     * The Command Tower's permanent army boosts, HP before attack, tier by
     * tier: only a tier whose bonus on the army it fields beats its price.
     */
    private buyArmyBoosts(): void {
        const boosts = this.ctx.armyBoosts?.();
        if (!boosts || !this.owns('armyBoosts')) return;
        const { costs, attackTiers, hpTiers } = boosts.settings;
        const army = this.armyValue();
        const tiers = { hp: boosts.hp, attack: boosts.attack };
        for (let guard = 0; guard < 4; guard++) {
            const boost: 'hp' | 'attack' = tiers.hp <= tiers.attack ? 'hp' : 'attack';
            const tier = tiers[boost];
            const cost = costs[tier];
            if (cost === undefined) break;
            const steps = boost === 'hp' ? hpTiers : attackTiers;
            const gain = army * ((steps[tier] ?? 0) - (tier > 0 ? (steps[tier - 1] ?? 0) : 0));
            if (gain < cost) break;
            if (!this.ctx.dispatch({ kind: 'buyBoost', team: this.team, seat: this.seat, boost })) break;
            tiers[boost]++;
        }
    }

    /** the round's range boost with a mostly ranged army, the speed boost for a Rusher's race */
    private buyRoundBoosts(): void {
        let ranged = 0;
        let total = 0;
        for (const u of this.ctx.placement.allUnits()) {
            if (u.seat !== this.seat || u.destroyed || u.type.structure || u.type.extra) continue;
            const value = u.type.cost * Math.max(1, u.level);
            total += value;
            if (u.type.range >= RANGED_FROM) ranged += value;
        }
        if (total > 0 && ranged / total >= RANGED_SHARE && this.owns('rangeBoost')) {
            this.ctx.dispatch({ kind: 'buyRoundRangeBoost', team: this.team, seat: this.seat });
        }
        if (this.ctx.style === 'rusher' && this.owns('speedBoost')) {
            this.ctx.dispatch({ kind: 'buyRoundSpeedBoost', team: this.team, seat: this.seat });
        }
    }

    /** its packs on the board */
    private ownPacks(): Unit[] {
        return this.ctx.placement.allUnits().filter((u) => u.seat === this.seat && !u.destroyed && !u.type.structure && !u.type.extra && !u.summoned);
    }

    /**
     * Tutor charges: each fills
     * the XP bar of its most valuable pack that can still level — the planner
     * then buys the level.
     */
    private useTutorCharges(): void {
        const { dispatch, tactics } = this.ctx;
        for (let guard = 0; guard < 5 && tactics[this.seat]!.includes(TUTOR_ID); guard++) {
            const best = this.ownPacks()
                .filter((u) => u.level < this.ctx.leveling.maxLevel)
                .sort((a, b) => b.type.cost * b.level - a.type.cost * a.level || a.id - b.id);
            if (!best.some((u) => dispatch({ kind: 'tutorUnit', team: this.team, seat: this.seat, unitId: u.id }))) break;
        }
    }

    /**
     * 2v2: supply it can't use this round — every pack slot
     * filled — goes to its ally (arriving with next round's income), keeping
     * a little for its own leftovers.
     */
    private sendSpareSupply(): void {
        const ally = this.ctx.allySeat;
        if (ally === null || ally === undefined || this.ctx.deployCap() > 0 || !this.owns('sendSupply')) return;
        const amount = Math.floor((this.ctx.economy.balance(this.seat) - SEND_KEEP) / 10) * 10;
        if (amount < SEND_MIN) return;
        this.ctx.dispatch({ kind: 'sendSupply', team: this.team, seat: this.seat, toSeat: ally, amount });
    }

    /** its roles this match: its chaff and strong units (aiRoles), set at its first build */
    private roster: Roster | null = null;

    /** the last battle's weak points, as read at the last build (for the debug overlay) */
    private weakPoints: WeakPoint[] = [];

    /**
     * Its packs by roles (AI_PLAN.md, "Chaff and roles"): the round's 1st pack is
     * chaff, and so is the 3rd before round {@link THIRD_PACK_FREE_FROM}. Every
     * other pack answers a weak point of the last battle — what hurt it most
     * that the round hasn't answered yet: air (archers), chaff (hammerers),
     * the rest (its strong unit) — standing by what was hurt; with none left,
     * walls that matter (ballistas), else the strong unit. Round 1 (no battle
     * yet): what of the enemy's army is answered least. An answer only costs
     * what leaves the round's chaff affordable; locked role units are unlocked
     * when the round's unlock is still free.
     */
    private rolePick(rng: () => number): PackPick {
        const roster = this.rosterFor(rng);
        const chaffPack = (i: number) => i === 0 || (i === 2 && this.round < THIRD_PACK_FREE_FROM);
        const last = this.ctx.lastBattle?.() ?? null;
        this.weakPoints = last ? readWeakPoints(last, this.seat, this.ctx.types) : [];
        const answered = new Set<LossKind>();
        return (index, slots, cost) => {
            const chaff = this.ctx.types.byId(roster.chaff);
            let reserve = 0;
            for (let j = index + 1; j < slots; j++) if (chaffPack(j) && chaff) reserve += cost(chaff);
            const fallback = () => {
                const type = this.readyRole(roster.chaff, cost, 0) ?? this.cheapestArmyType(cost);
                return type ? { type } : null;
            };
            if (chaffPack(index)) return fallback();
            // a weak point of the last battle, by what was hurt
            for (const weak of this.weakPoints) {
                if (answered.has(weak.kind)) continue;
                const need: Need = weak.kind === 'other' ? 'strong' : weak.kind;
                for (const id of this.roleUnits(need, roster)) {
                    const type = this.readyRole(id, cost, reserve);
                    if (!type) continue;
                    answered.add(weak.kind);
                    const near = this.ctx.placement.allUnits().find((u) => u.id === weak.victimId && !u.gridless);
                    return { type, near };
                }
            }
            const needs = readNeeds(this.ctx.placement, this.team, this.seat, roster);
            // after a battle only walls still count from the board; before one, all of it
            const order: Need[] = last
                ? needs.walls > 0 ? ['walls', 'strong'] : ['strong']
                : (Object.keys(needs) as Need[]).filter((k) => needs[k] > 0).sort((a, b) => needs[b] - needs[a]);
            // nothing left unanswered: the strong unit
            if (!order.includes('strong')) order.push('strong');
            for (const need of order) {
                for (const id of this.roleUnits(need, roster)) {
                    const type = this.readyRole(id, cost, reserve);
                    if (type) return { type };
                }
            }
            return fallback();
        };
    }

    /** the unit ids that fill `need`, best first (a second strong unit — the first is helpless — before the first) */
    private roleUnits(need: Need, roster: Roster): readonly string[] {
        if (need === 'air') return [AI_ROLES.antiAir];
        if (need === 'chaff') return [AI_ROLES.antiChaff];
        if (need === 'walls') return [AI_ROLES.antiWall];
        return [...roster.strong].reverse();
    }

    /**
     * The roles' chaff and strong unit: the commander's own (its starting
     * army's chaff, its starting unit of {@link STRONG_FROM} or more), else the
     * first role chaff of its shop and a random strong unit. A second strong
     * unit joins once the first can't hit most of the enemy's army.
     */
    private rosterFor(rng: () => number): Roster {
        const { types, placement } = this.ctx;
        const shop = this.shop();
        if (!this.roster) {
            const starting = types.commander(this.ctx.commander[this.seat] ?? '')?.units ?? [];
            const inShop = (id: string) => shop.includes(id) && !!types.byId(id);
            const chaff = starting.find((id) => inShop(id) && isChaff(types.byId(id)!)) ?? AI_ROLES.chaff.find(inShop) ?? AI_ROLES.chaff[0]!;
            const strong = starting.find((id) => inShop(id) && this.strongCandidate(types.byId(id)!)) ?? this.randomStrong(rng, () => true);
            this.roster = { chaff, strong: strong ? [strong] : [] };
        }
        const first = this.roster.strong.length === 1 ? types.byId(this.roster.strong[0]!) : null;
        if (first && strongHelpless(placement, this.team, first)) {
            // one that hits what the first can't
            const second = this.randomStrong(rng, (t) => (first.targets.air ? t.targets.ground : t.targets.air));
            if (second) this.roster.strong.push(second);
        }
        return this.roster;
    }

    /** a unit of {@link STRONG_FROM} or more that fights, and isn't one of the fixed roles */
    private strongCandidate(t: UnitType): boolean {
        const fixed = [AI_ROLES.antiChaff, AI_ROLES.antiAir, AI_ROLES.antiWall, ...AI_ROLES.chaff];
        return t.cost >= STRONG_FROM && !t.structure && !t.extra && !t.wall && t.damage > 0 && t.target !== false && !fixed.includes(t.id);
    }

    /** a random strong unit of its shop that `fits`, or null */
    private randomStrong(rng: () => number, fits: (t: UnitType) => boolean): string | null {
        const { types } = this.ctx;
        const options = this.shop().filter((id) => {
            const t = types.byId(id);
            return !!t && this.strongCandidate(t) && fits(t) && !this.roster?.strong.includes(id);
        });
        return options.length > 0 ? options[Math.floor(rng() * options.length)]! : null;
    }

    /**
     * `id` when it can be bought now with `reserve` left over — unlocking it
     * first if it's still locked and the round's unlock is free.
     */
    private readyRole(id: string, cost: (t: UnitType) => number, reserve: number): UnitType | null {
        const { types, economy, unlockedUnits, unlockUsedThisRound, commander, dispatch } = this.ctx;
        const type = types.byId(id);
        if (!type || !this.shop().includes(id)) return null;
        if (!unlockedUnits[this.seat]!.includes(id)) {
            if (unlockUsedThisRound[this.seat]) return null;
            const unlock = unlockCostFor(id, types.commander(commander[this.seat] ?? ''), types);
            if (unlock + cost(type) + reserve > economy.balance(this.seat)) return null;
            if (!dispatch({ kind: 'unlockUnit', team: this.team, seat: this.seat, typeId: id })) return null;
        }
        return economy.balance(this.seat) - cost(type) >= reserve ? type : null;
    }

    /** the cheapest army type it can buy now, or null */
    private cheapestArmyType(cost: (t: UnitType) => number): UnitType | null {
        let best: UnitType | null = null;
        for (const t of this.affordableArmyTypes()) if (cost(t) <= this.ctx.economy.balance(this.seat) && (!best || cost(t) < cost(best))) best = t;
        return best;
    }

    /** the unit types this seat's shop holds (its commander's own shop, else the normal one) */
    private shop(): readonly string[] {
        return this.ctx.types.shopFor(this.ctx.types.commander(this.ctx.commander[this.seat] ?? ''));
    }

    /** unlocked, buyable army types this seat can afford right now */
    private affordableArmyTypes(pred?: (t: UnitType) => boolean): UnitType[] {
        const { economy, unlockedUnits } = this.ctx;
        const shop = this.shop();
        return this.ctx.types.roster.filter(
            (t) =>
                !t.extra &&
                shop.includes(t.id) &&
                unlockedUnits[this.seat]!.includes(t.id) &&
                economy.canAfford(this.seat, t) &&
                (!pred || pred(t)),
        );
    }

    /**
     * Leftover supply into runes (every level): one shop rune per free item
     * slot its packs still have, each put on right away. Runes don't use pack
     * slots; a rune with nowhere to go isn't bought.
     */
    private buyRunesForFreeSlots(rng: () => number = this.ctx.rng): void {
        const { dispatch, economy, deploySettings, items } = this.ctx;
        let room = 0;
        for (const u of this.ownPacks()) room += Math.max(0, itemSlotLimit(u.type) - u.items.length);
        room -= items[this.seat]!.length;
        for (let guard = 0; guard < room && guard < 20; guard++) {
            // the escalating price is the action's; gate on the base price
            if (economy.balance(this.seat) < deploySettings.baseRuneCost) break;
            const itemId = this.ctx.types.baseRuneIds[Math.floor(rng() * this.ctx.types.baseRuneIds.length)]!;
            if (!dispatch({ kind: 'buyRune', team: this.team, seat: this.seat, itemId })) break;
        }
        this.applyItems(rng);
    }

    private applyItems(rng: () => number = this.ctx.rng): void {
        const { dispatch, placement, items } = this.ctx;
        const team = this.team;
        const bag = [...items[this.seat]!];
        if (bag.length === 0) return;
        // fill emptier packs first so items spread across the army
        while (bag.length > 0) {
            const packs = placement
                .allUnits()
                .filter(
                    (u) =>
                        u.seat === this.seat &&
                        !u.type.structure &&
                        !u.type.extra &&
                        u.items.length < itemSlotLimit(u.type),
                )
                .sort((a, b) => a.items.length - b.items.length);
            if (packs.length === 0) break;
            const unit = packs[0]!;
            const i = Math.floor(rng() * bag.length);
            const itemId = bag.splice(i, 1)[0]!;
            if (!dispatch({ kind: 'applyItem', team, seat: this.seat, unitId: unit.id, itemId })) {
                bag.push(itemId);
                break;
            }
        }
    }

    private placeTactics(rng: () => number = this.ctx.rng): void {
        const { dispatch, placement, tactics } = this.ctx;
        const team = this.team;
        // Nobody worth a charge: the horde marches in from off the board (the
        // spell lands on empty ground), and no spell can hurt a building any
        // more — towers and strongholds fall to armies only.
        const foes = placement
            .allUnits()
            .filter(
                (u) =>
                    u.team !== team &&
                    u.team !== 'horde' &&
                    !u.type.extra &&
                    !u.type.structure,
            );
        const allies = placement
            .allUnits()
            .filter((u) => u.team === team && !u.type.structure && !u.type.extra);
        if (foes.length === 0) return;

        const foePoint = () => {
            const u = foes[Math.floor(rng() * foes.length)]!;
            const jitter = (rng() - 0.5) * 8;
            return {
                x: quantizeWorld(u.world.x + jitter),
                z: quantizeWorld(u.world.z + jitter),
            };
        };
        const allyPoint = () => {
            const u = (allies.length ? allies : foes)[Math.floor(rng() * (allies.length || foes.length))]!;
            return { x: quantizeWorld(u.world.x), z: quantizeWorld(u.world.z) };
        };

        // shuffle held tactics, place at most two so the field stays readable
        const MAX_TACTICS = 2;
        // own-unit tactics have no ground target for the placer to aim at
        const pool = [...new Set(tactics[this.seat])].filter(
            (id) => id !== SELL_UNIT_ID && id !== MOVE_UNIT_ID && id !== TUTOR_ID,
        );
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [pool[i], pool[j]] = [pool[j]!, pool[i]!];
        }

        let placed = 0;
        for (const tacticId of pool) {
            if (placed >= MAX_TACTICS) break;
            const tactic = this.ctx.types.tactic(tacticId);
            if (!tactic) continue;

            let ok = false;
            if (tacticId === RALLY_ROUTE_ID && allies.length > 0) {
                const a = allyPoint();
                const b = foePoint();
                const c = foePoint();
                ok = dispatch({
                    kind: 'placeRallyRoute',
                    team,
                    seat: this.seat,
                    startX: a.x,
                    startZ: a.z,
                    midX: b.x,
                    midZ: b.z,
                    endX: c.x,
                    endZ: c.z,
                });
            } else if (tacticId === OIL_SPILL_ID) {
                const a = foePoint();
                const b = foePoint();
                ok = dispatch({
                    kind: 'placeOilSpill',
                    team,
                    seat: this.seat,
                    startX: a.x,
                    startZ: a.z,
                    endX: b.x,
                    endZ: b.z,
                });
            } else if (usesSpellPlacement(tactic)) {
                let p = foePoint();
                if (tactic.targeting === 'point') {
                    ok = dispatch({ kind: 'placeSpell', team, seat: this.seat, tacticId, x: p.x, z: p.z });
                } else if (tactic.targeting === 'two-point') {
                    let q = foePoint();
                    // a path spell (the dragon) is drawn at its full length:
                    // the line through both foes, centred between them —
                    // two picks close together made a stubby strafe. The
                    // dispatcher keeps it on the board and within maxSpan.
                    if (tactic.maxSpan) {
                        let dx = q.x - p.x;
                        let dz = q.z - p.z;
                        let len = Math.sqrt(dx * dx + dz * dz);
                        if (len < 1) {
                            const yaw = rng() * Math.PI * 2;
                            dx = detCos(yaw);
                            dz = detSin(yaw);
                            len = 1;
                        }
                        const half = tactic.maxSpan / 2 / len;
                        const mx = (p.x + q.x) / 2;
                        const mz = (p.z + q.z) / 2;
                        p = { x: quantizeWorld(mx - dx * half), z: quantizeWorld(mz - dz * half) };
                        q = { x: quantizeWorld(mx + dx * half), z: quantizeWorld(mz + dz * half) };
                    }
                    ok = dispatch({
                        kind: 'placeSpell',
                        team,
                        seat: this.seat,
                        tacticId,
                        x: p.x,
                        z: p.z,
                        endX: q.x,
                        endZ: q.z,
                    });
                } else if (tactic.targeting === 'point-yaw') {
                    ok = dispatch({
                        kind: 'placeSpell',
                        team,
                        seat: this.seat,
                        tacticId,
                        x: p.x,
                        z: p.z,
                        yaw: quantizeYaw(rng() * Math.PI * 2),
                    });
                }
            }
            if (ok) placed++;
        }
    }

    /** every forge spell of its commander's pool it can pay for */
    private buyForgeSpells(): void {
        const { dispatch, economy, forgeSpellOwned, forgeSpellsOf } = this.ctx;
        const owned = forgeSpellOwned[this.seat]!;
        let bought = true;
        while (bought) {
            bought = false;
            for (const tacticId of forgeSpellsOf(this.seat) ?? []) {
                if (owned.includes(tacticId)) continue;
                const cost = this.ctx.types.tactic(tacticId)?.strongholdCost;
                if (cost === undefined || economy.balance(this.seat) < cost) continue;
                if (dispatch({ kind: 'buyForgeSpell', team: this.team, seat: this.seat, tacticId })) bought = true;
            }
        }
    }
}
