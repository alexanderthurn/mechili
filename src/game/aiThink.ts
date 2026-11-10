/**
 * The AI's plan simulation — the Learner difficulty.
 *
 * While the humans deploy, a computer seat dry-runs its normal build several
 * times — each try with its own random stream and play style — records what
 * it would do and the board that leaves, and undoes it all. Each recorded
 * board is fought out by the real BattleSim in a Web Worker, against the
 * other side as it stood when the phase began (never the packs the humans
 * place this round). When its time is up it ranks the plans by the battle's
 * HP damage (dealt minus taken) and carries out the best.
 *
 * Time: at least {@link THINK_MIN_SECONDS}, and for as long as a human is
 * still deploying — but done {@link THINK_DEADLINE_MARGIN} s before the
 * deploy clock ends, and at most {@link THINK_MAX_PLANS} plans.
 *
 * The AI only ever runs on the host, so none of this has to be deterministic:
 * only the plan it carries out enters the log, through the normal actions.
 */

import type { Action } from './actions';
import type { ResolvedStats } from './tech';
import type { Loadout } from './techCatalog';
import type { LevelingSettings, TowerSettings } from './settings';
import type { SeatId } from './seats';
import type { Team, Unit } from './units';
import { mulberry32 } from './map';
import { describePlan, movableBuys, mutatePlan, planKey, positionSpots, withAnchor, withSwap, type EnemyPack, type MutationContext, type MutationSize, type Plan } from './aiPlan';
import { CELL } from './map';
import type { AiDifficulty, AiStyle } from './aiProfile';

/** it thinks at least this long, even when every human is ready sooner (s) */
export const THINK_MIN_SECONDS = 5;
/** while it thinks, it says how far it got this often in the chat (s) */
export const THINK_NOTE_SECONDS = 10;
/** it is done this long before the deploy clock runs out (s) */
export const THINK_DEADLINE_MARGIN = 3;
/** no more plans than this per round (a clock that never runs out) */
export const THINK_MAX_PLANS = 400;
/** the careful look and the refining work on this many of the best plans */
export const THINK_BEAM = 4;
/** random changes between two position phases */
export const THINK_REFINES_PER_ROUND = 12;

// ------------------------------------------------------------------ the job

/** one unit of a plan's board, as the worker rebuilds it */
export interface ThinkUnit {
    typeId: string;
    cell: { col: number; row: number };
    team: Team | 'horde';
    world: [number, number, number];
    rotated: boolean;
    /** its members' formation slots, flat xyz */
    homes: number[];
    /** the Unit's own plain fields (id, seat, level, items, …) */
    fields: Record<string, unknown>;
    stats: ResolvedStats;
    /** it spawns in from its flank */
    flank: boolean;
    /** a building or board extra (not a pack) */
    structure: boolean;
}

/**
 * One version of the other side to test a plan against: its packs shifted
 * up to `jitter` tiles each way, and its `reinforce` most valuable packs
 * doubled a little behind themselves (what it might add this round). The
 * plain board is `{ jitter: 0, reinforce: 0 }`.
 */
export interface ThinkVariant {
    seed: number;
    jitter: number;
    reinforce: number;
}

/** the quick look: the board as it stood */
export const FAST_VARIANTS: readonly ThinkVariant[] = [{ seed: 1, jitter: 0, reinforce: 0 }];
/** the careful look: as it stood, shifted twice, and reinforced */
export const ROBUST_VARIANTS: readonly ThinkVariant[] = [
    { seed: 1, jitter: 0, reinforce: 0 },
    { seed: 2, jitter: 2, reinforce: 0 },
    { seed: 3, jitter: 3, reinforce: 0 },
    { seed: 4, jitter: 1, reinforce: 2 },
];

/** one battle for the worker: a plan's board and what the sim needs besides */
export interface ThinkJob {
    id: number;
    /** the thinking seat's side: the other side is the one varied */
    aiTeam: Team;
    variants: readonly ThinkVariant[];
    units: ThinkUnit[];
    /** `${seat}:${typeId}` → the techs that seat owns for it */
    techs: Record<string, string[]>;
    loadouts: (Loadout | undefined)[];
    seatRanks: number[];
    /** type id → its effective supply cost */
    costs: Record<string, number>;
    flankMult: number[];
    flankSpawnSeconds: number;
    towers: TowerSettings;
    leveling: LevelingSettings;
    battleSeconds: number;
    boardHalfW: number;
    boardHalfZ: number;
    strongholdLifeline: boolean;
    terrain: { cols: number; rows: number; halfW: number; halfH: number; heights: Float32Array } | null;
}

/** a board as the job carries it — the rest of a job is the test's own */
export type Board = Omit<ThinkJob, 'id' | 'aiTeam' | 'variants'>;

export interface ThinkResult {
    id: number;
    ok: boolean;
    error?: string;
    /** per variant, in the job's order */
    variants: { damageToPlayer: number; damageToEnemy: number }[];
    /** the variants' mean */
    damageToPlayer: number;
    damageToEnemy: number;
    /** battle seconds it took */
    battleTime: number;
    /** worker wall time (ms) */
    ms: number;
    survivors: { player: number; enemy: number };
}

/** Unit fields never sent: rebuilt by the constructor, or not plain data */
const SKIP_FIELDS = new Set(['type', 'cell', 'world', 'view', 'members', 'rotated', 'team']);

function plain(v: unknown, depth = 0): boolean {
    if (v === null || v === undefined) return true;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return true;
    if (t !== 'object' || depth > 3) return false;
    if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v as Record<string, unknown>).every((x) => plain(x, depth + 1));
}

/** a board unit as the worker needs it */
export function thinkUnitOf(u: Unit, stats: ResolvedStats, flank: boolean): ThinkUnit {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(u)) {
        if (SKIP_FIELDS.has(k) || !plain(v)) continue;
        fields[k] = Array.isArray(v) || (v && typeof v === 'object') ? structuredClone(v) : v;
    }
    const homes: number[] = [];
    for (const m of u.members) homes.push(m.home.x, m.home.y, m.home.z);
    return {
        typeId: u.type.id,
        cell: { col: u.cell.col, row: u.cell.row },
        team: u.team,
        world: [u.world.x, u.world.y, u.world.z],
        rotated: u.rotated,
        homes,
        fields,
        stats: { ...stats },
        flank,
        structure: !!u.type.structure || !!u.type.extra,
    };
}

// ------------------------------------------------------------------ the pool

interface Slot {
    worker: Worker;
    job: ThinkJob | null;
    resolve: ((r: ThinkResult) => void) | null;
}

export const failed = (id: number, error: string): ThinkResult => ({
    id,
    ok: false,
    error,
    variants: [],
    damageToPlayer: 0,
    damageToEnemy: 0,
    battleTime: 0,
    ms: 0,
    survivors: { player: 0, enemy: 0 },
});

/** the plan workers, shared by every thinking seat */
class ThinkPool {
    private readonly slots: Slot[] = [];
    private readonly queue: { job: ThinkJob; resolve: (r: ThinkResult) => void }[] = [];
    broken: string | null = null;
    readonly size: number;

    constructor() {
        const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
        this.size = Math.max(1, Math.min(3, Math.floor(cores / 2) - 1));
        try {
            for (let i = 0; i < this.size; i++) {
                const worker = new Worker(new URL('./aiThinkWorker.ts', import.meta.url), { type: 'module' });
                const slot: Slot = { worker, job: null, resolve: null };
                worker.onmessage = (e: MessageEvent<ThinkResult>) => this.finish(slot, e.data);
                worker.onerror = (e) => {
                    e.preventDefault?.();
                    this.broken = `worker error: ${e.message || 'failed to load'}`;
                    console.error('[aiThink] worker failed', e);
                    if (slot.job) this.finish(slot, failed(slot.job.id, this.broken));
                    for (const q of this.queue.splice(0)) q.resolve(failed(q.job.id, this.broken));
                };
                this.slots.push(slot);
            }
        } catch (err) {
            this.broken = `no worker: ${String(err)}`;
        }
    }

    /** jobs queued or running */
    get load(): number {
        return this.queue.length + this.slots.filter((s) => s.job).length;
    }

    run(job: ThinkJob): Promise<ThinkResult> {
        if (this.broken) return Promise.resolve(failed(job.id, this.broken));
        return new Promise((resolve) => {
            this.queue.push({ job, resolve });
            this.pump();
        });
    }

    private finish(slot: Slot, result: ThinkResult): void {
        const resolve = slot.resolve;
        slot.job = null;
        slot.resolve = null;
        resolve?.(result);
        this.pump();
    }

    private pump(): void {
        for (const slot of this.slots) {
            if (slot.job) continue;
            const next = this.queue.shift();
            if (!next) return;
            slot.job = next.job;
            slot.resolve = next.resolve;
            // the heights go over as a copy: the same board may be sent again (the careful look)
            const job = next.job.terrain ? { ...next.job, terrain: { ...next.job.terrain, heights: next.job.terrain.heights.slice() } } : next.job;
            const transfer = job.terrain ? [job.terrain.heights.buffer] : [];
            try {
                slot.worker.postMessage(job, transfer);
            } catch (err) {
                // a board that can't be sent (not plain data): that plan fails, the rest go on
                console.error('[aiThink] could not send a plan to the worker', err);
                this.finish(slot, failed(next.job.id, `postMessage: ${String(err)}`));
                return;
            }
        }
    }
}

let pool: ThinkPool | null = null;
/** the shared pool, made on first use */
export function thinkPool(): ThinkPool {
    return (pool ??= new ThinkPool());
}

// ------------------------------------------------------------------ the session

/** the match's side of the plan simulation (Game implements it) */
export interface AiThinkHost {
    /** the round's thinking begins: what stands now is what the AI may know of */
    begin(): void;
    /** apply an action without sending it anywhere (the dry run; undone right after) */
    dispatchDry(action: Action): boolean;
    /**
     * Runs `fn` as a dry run for `seat`: the other side's packs of this round
     * hidden, ids and spell counters saved — and afterwards every action the
     * seat logged in it undone and all of that put back. False when the board
     * didn't come back as it was (the session then stops thinking).
     */
    dryRun(seat: SeatId, team: Team, fn: () => void): boolean;
    /** the board as it stands now (inside a dry run: with the plan), as a job */
    board(): Board;
    /** every seat not driven by a local AI has locked in */
    humansReady(): boolean;
    /** deploy clock seconds left (Infinity: none) */
    deployLeft(): number;
    /** still the build phase of `round`, the match on */
    active(round: number): boolean;
    /** a line in the match chat, from this seat: still testing (`count` plans so far), or done */
    say(kind: 'progress' | 'done', count: number): void;
}

/** what a thinking AI offers its session */
export interface ThinkingAi {
    readonly seatId: SeatId;
    readonly teamId: Team;
    readonly difficultyLevel: AiDifficulty;
    readonly ownStyle: { style: AiStyle; rushSide: 0 | 1 };
    /** the styles its plans may try (a Siege role rules some out) */
    readonly styleOptions: readonly AiStyle[];
    /** the archetypes it can build (strategies its rules would not pick) */
    readonly archetypes: readonly string[];
    /** dry-runs one build with `rng` in `style`: its actions and the board it leaves, or null (the board didn't come back) */
    planDry(rng: () => number, style: { style: AiStyle; rushSide: 0 | 1 }): PlanDraft | null;
    /** dry-runs an archetype's army */
    planArchetype(name: string, rng: () => number): PlanDraft | null;
    /** dry-runs a given plan (the builder): what of it applied, and the board — or null */
    planReplay(plan: Plan, memo: unknown, style: { style: AiStyle; rushSide: 0 | 1 }): PlanDraft | null;
    /** what changing a plan needs to know (its shop, zone, packs) */
    mutationContext(): MutationContext;
    /** carries out a recorded plan for real; how many of its actions were refused or skipped */
    executePlan(plan: PlanDraft): number;
    /** the normal build (no plan worked) */
    buildNormally(): void;
    lockIn(): void;
    /** a seeded number from its own stream */
    rng(): number;
}

export interface PlanDraft {
    /** the plan as it applied (own new packs named by virtual ids, see aiPlan) */
    plan: Plan;
    board: Board;
    /** opaque AI state the plan settled on (its roster), restored on execute */
    memo: unknown;
    style: { style: AiStyle; rushSide: 0 | 1 };
    /** its own packs bought, by type id (for the log) */
    bought: string[];
    dryMs: number;
}

interface PlanEntry {
    n: number;
    /** where it came from: a rule style, an archetype, or a change to another plan */
    label: string;
    parent: number | null;
    draft: PlanDraft;
    /** the quick look's score (the board as it stood) */
    fast: number | null;
    /** the careful look's score (every variant), the one that ranks */
    robust: number | null;
    /** the careful look's battles: dealt and taken, mean */
    dealt: number;
    taken: number;
    pending: 'fast' | 'robust' | null;
    failed: boolean;
}

const styleName = (s: { style: AiStyle; rushSide: 0 | 1 }) => (s.style === 'rusher' ? `rusher-${s.rushSide === 0 ? 'low' : 'high'}` : s.style);

/** how big a change the `i`-th refinement makes: big ones first, then mostly small, a big one now and then */
function sizeFor(i: number): MutationSize {
    if (i < 6) return 'big';
    if (i < 18) return 'medium';
    if (i % 12 === 0) return 'big';
    return i % 3 === 0 ? 'medium' : 'small';
}

let nextJobId = 1;

/**
 * One seat's thinking in one build phase; ticked by the match every frame.
 *
 * 1. The rough look: its rules in every style it may play, and the
 *    archetypes — each fought once against the board as it stood.
 * 2. The careful look: the best few fought against every variant (the board
 *    shifted, reinforced) — the score that ranks.
 * 3. Refining: a plan of the best few changed (big changes first, then
 *    smaller ones) and given the careful look; better ones join the best.
 * Until the humans are done (at least {@link THINK_MIN_SECONDS}); then it
 * plays the best plan the careful look scored.
 */
export class AiThinkSession {
    private elapsed = 0;
    private readonly entries: PlanEntry[] = [];
    private inFlight = 0;
    private done = false;
    private stopped = false;
    private humansReadyAt: number | null = null;
    private readonly rng: () => number;
    private readonly tag: string;
    private readonly wallStart = performance.now();
    /** when it next says how far it got */
    private nextNote = THINK_NOTE_SECONDS;
    /** the rough look still to draft */
    private readonly explore: { label: string; make: () => PlanDraft | null }[] = [];
    private readonly seen = new Set<string>();
    private refinements = 0;
    private improvements = 0;
    private mutation: MutationContext | null = null;
    /** after the careful look: positions for the leader's packs, then random changes, in turn */
    private stage: 'start' | 'position' | 'refine' = 'start';
    /** plans to test together (one pack's spots, or swaps); the next waits for all of them */
    private batch: { parent: PlanEntry; todo: { label: string; plan: Plan }[]; entries: PlanEntry[] } | null = null;
    /** the leader's buy steps still to place this pass */
    private posQueue: number[] = [];
    private posPass = 0;
    private posStartScore = 0;
    private swapsDone = false;
    private refineLeft = 0;
    private positionPhases = 0;

    constructor(
        private readonly ai: ThinkingAi,
        private readonly host: AiThinkHost,
        readonly round: number,
    ) {
        this.rng = mulberry32(Math.floor(ai.rng() * 0x7fffffff));
        this.tag = `[aiThink] seat ${ai.seatId} (${ai.difficultyLevel}) round ${round}`;
        host.begin();
        const seeded = () => mulberry32(Math.floor(this.rng() * 0x7fffffff));
        type PlanStyle = { style: AiStyle; rushSide: 0 | 1 };
        const styles = ai.styleOptions.flatMap((st): PlanStyle[] => (st === 'rusher' ? [{ style: st, rushSide: 0 }, { style: st, rushSide: 1 }] : [{ style: st, rushSide: 0 }]));
        this.explore.push({ label: `rules ${styleName(ai.ownStyle)}`, make: () => ai.planDry(seeded(), ai.ownStyle) });
        for (const st of styles) {
            if (st.style === ai.ownStyle.style && st.rushSide === ai.ownStyle.rushSide) continue;
            this.explore.push({ label: `rules ${styleName(st)}`, make: () => ai.planDry(seeded(), st) });
        }
        for (const name of ai.archetypes) this.explore.push({ label: name, make: () => ai.planArchetype(name, seeded()) });
        this.explore.push({ label: `rules ${styleName(ai.ownStyle)} (other seed)`, make: () => ai.planDry(seeded(), ai.ownStyle) });
        const p = thinkPool();
        console.debug(
            `${this.tag}: thinking — ${p.size} worker(s), ${this.explore.length} rough plans first, then refining; at least ${THINK_MIN_SECONDS} s${p.broken ? ` (pool broken: ${p.broken})` : ''}`,
        );
    }

    get finished(): boolean {
        return this.done;
    }

    tick(dt: number): void {
        if (this.done) return;
        if (!this.host.active(this.round)) {
            this.done = true;
            console.info(`${this.tag}: cancelled (phase over)`);
            return;
        }
        this.elapsed += dt;
        if (this.humansReadyAt === null && this.host.humansReady()) this.humansReadyAt = this.elapsed;
        const p = thinkPool();
        // one new plan per frame while a worker would sit idle — dry runs stay spread out
        if (!p.broken && !this.stopped && this.entries.length < THINK_MAX_PLANS && p.load < p.size && !this.timeUp()) this.step();
        if (this.shouldFinish()) {
            this.finish();
        } else if (this.elapsed >= this.nextNote) {
            this.nextNote += THINK_NOTE_SECONDS;
            this.host.say('progress', this.tested());
        }
    }

    private tested(): number {
        return this.entries.filter((e) => e.fast !== null || e.robust !== null).length;
    }

    private timeUp(): boolean {
        if (this.host.deployLeft() <= THINK_DEADLINE_MARGIN) return true;
        return this.elapsed >= THINK_MIN_SECONDS && this.humansReadyAt !== null;
    }

    private shouldFinish(): boolean {
        if ((thinkPool().broken || this.stopped) && this.inFlight === 0) return true;
        if (this.host.deployLeft() <= THINK_DEADLINE_MARGIN) return true;
        // time's up — but with nothing scored yet, the battles under way are worth waiting for
        if (this.timeUp()) return this.inFlight === 0 || this.entries.some((e) => e.fast !== null || e.robust !== null);
        return this.entries.length >= THINK_MAX_PLANS && this.inFlight === 0;
    }

    /** the best few by the careful look */
    private beam(): PlanEntry[] {
        return this.entries
            .filter((e) => e.robust !== null)
            .sort((a, b) => b.robust! - a.robust!)
            .slice(0, THINK_BEAM);
    }

    /** one more plan into the workers: rough, careful, or a change */
    private step(): void {
        // 1. the rough look
        const next = this.explore.shift();
        if (next) {
            const draft = this.draft(next.make, next.label);
            if (!draft) return;
            const entry = this.add(next.label, null, draft);
            if (entry.n === 0) this.checkReplay(draft);
            console.debug(`${this.tag}: plan #${entry.n} ${next.label} — ${describePlan(draft.plan)}; packs [${draft.bought.join(', ')}], dry run ${draft.dryMs.toFixed(1)} ms`);
            this.evaluate(entry, FAST_VARIANTS);
            return;
        }
        // every rough plan scored before the careful look picks from them
        if (this.entries.some((e) => e.pending === 'fast')) return;
        // 2. the careful look for the best rough plans
        const unchecked = this.entries
            .filter((e) => e.fast !== null && e.parent === null)
            .sort((a, b) => b.fast! - a.fast!)
            .slice(0, THINK_BEAM)
            .find((e) => e.robust === null && e.pending === null);
        if (unchecked) {
            this.evaluate(unchecked, ROBUST_VARIANTS);
            return;
        }
        const beam = this.beam();
        if (beam.length === 0) return; // the careful look still under way
        this.mutation ??= this.ai.mutationContext();
        // a batch under way: its plans into the workers one per frame, then wait for all of them
        if (this.batch) {
            const next = this.batch.todo.shift();
            if (next) {
                this.testChange(this.batch.parent, next.label, next.plan, this.batch.entries);
                return;
            }
            if (this.batch.entries.some((e) => e.pending !== null)) return;
            this.batch = null;
        }
        // 3. positions for the leader, then random changes — in turn, until time's up
        if (this.stage === 'start') this.startPositions();
        if (this.stage === 'position') {
            if (this.nextPositionBatch()) return;
            this.stage = 'refine';
            this.refineLeft = THINK_REFINES_PER_ROUND;
        }
        if (this.refineLeft-- <= 0) {
            this.startPositions();
            return;
        }
        this.refine(beam);
    }

    /** the leader's packs, one by one: each tried on spots read off the board */
    private startPositions(): void {
        const leader = this.beam()[0];
        if (!leader) return;
        this.stage = 'position';
        this.posQueue = movableBuys(leader.draft.plan, this.mutation!);
        this.posPass = 0;
        this.posStartScore = leader.robust!;
        this.swapsDone = false;
        this.positionPhases++;
        console.debug(`${this.tag}: position phase ${this.positionPhases} on plan #${leader.n} (${this.posQueue.length} packs)`);
    }

    /** the other side's packs on a board, in tiles */
    private enemiesOf(board: Board): EnemyPack[] {
        return board.units
            .filter((u) => u.team !== this.ai.teamId && u.team !== 'horde' && !u.structure)
            .map((u) => ({
                typeId: u.typeId,
                col: (u.world[0] + board.boardHalfW) / CELL,
                row: (board.boardHalfZ - u.world[2]) / CELL,
                value: (board.costs[u.typeId] ?? 0) * Math.max(1, Number(u.fields.level) || 1),
            }));
    }

    /** the next batch of the position phase, or false when the phase is over */
    private nextPositionBatch(): boolean {
        const leader = this.beam()[0]!;
        const plan = leader.draft.plan;
        const ctx = this.mutation!;
        const fresh = (p: Plan) => !this.seen.has(planKey(p));
        while (this.posQueue.length > 0) {
            const i = this.posQueue.shift()!;
            const step = plan.steps[i];
            if (step?.kind !== 'buy') continue;
            const todo = positionSpots(plan, i, ctx, this.enemiesOf(leader.draft.board))
                .map((spot) => ({ label: `pos: ${step.typeId} → ${spot.name}`, plan: withAnchor(plan, i, spot.anchor) }))
                .filter((t) => fresh(t.plan));
            if (todo.length > 0) {
                this.batch = { parent: leader, todo, entries: [] };
                return true;
            }
        }
        if (!this.swapsDone) {
            this.swapsDone = true;
            const buys = movableBuys(plan, ctx);
            const todo: { label: string; plan: Plan }[] = [];
            for (let a = 0; a < buys.length; a++) {
                for (let b = a + 1; b < buys.length; b++) {
                    const sa = plan.steps[buys[a]!] as Extract<typeof plan.steps[number], { kind: 'buy' }>;
                    const sb = plan.steps[buys[b]!] as typeof sa;
                    if (sa.typeId === sb.typeId) continue;
                    const swapped = withSwap(plan, buys[a]!, buys[b]!);
                    if (fresh(swapped)) todo.push({ label: `pos: ${sa.typeId} ⇄ ${sb.typeId}`, plan: swapped });
                }
            }
            if (todo.length > 0) {
                this.batch = { parent: leader, todo: todo.slice(0, 8), entries: [] };
                return true;
            }
        }
        // a pass that found something gets a second one
        if (this.posPass === 0 && leader.robust! > this.posStartScore) {
            this.posPass = 1;
            this.posStartScore = leader.robust!;
            this.posQueue = movableBuys(plan, ctx);
            return this.nextPositionBatch();
        }
        return false;
    }

    /** dry-runs a changed plan and gives it the careful look (into `into`, when a batch keeps count) */
    private testChange(parent: PlanEntry, label: string, plan: Plan, into?: PlanEntry[]): void {
        this.seen.add(planKey(plan));
        const full = `#${parent.n} ${label}`;
        const draft = this.draft(() => this.ai.planReplay(plan, parent.draft.memo, parent.draft.style), full);
        if (!draft) return;
        // the builder may have moved or dropped what the change asked for — the same plan again is no news
        const key = planKey(draft.plan);
        if (key !== planKey(plan) && this.seen.has(key)) return;
        this.seen.add(key);
        const entry = this.add(full, parent.n, draft);
        into?.push(entry);
        console.debug(`${this.tag}: plan #${entry.n} ${full} — ${describePlan(draft.plan)}`);
        this.evaluate(entry, ROBUST_VARIANTS);
    }

    /** a random change to one of the best (the better, the likelier) */
    private refine(beam: PlanEntry[]): void {
        const parent = beam[Math.floor(this.rng() * this.rng() * beam.length)]!;
        const size = sizeFor(this.refinements++);
        const changed = mutatePlan(parent.draft.plan, this.mutation!, this.rng, size);
        if (!changed || this.seen.has(planKey(changed.plan))) return;
        this.testChange(parent, `${size}: ${changed.what}`, changed.plan);
    }

    private draft(make: () => PlanDraft | null, label: string): PlanDraft | null {
        let draft: PlanDraft | null = null;
        try {
            draft = make();
        } catch (err) {
            console.error(`${this.tag}: dry run "${label}" threw`, err);
        }
        if (!draft) {
            console.warn(`${this.tag}: dry run "${label}" failed — thinking stops, the plans so far still count`);
            this.stopped = true;
        }
        return draft;
    }

    private add(label: string, parent: number | null, draft: PlanDraft): PlanEntry {
        const entry: PlanEntry = { n: this.entries.length, label, parent, draft, fast: null, robust: null, dealt: 0, taken: 0, pending: null, failed: false };
        this.entries.push(entry);
        this.seen.add(planKey(draft.plan));
        return entry;
    }

    /** dealt minus taken, per variant — and the score: mostly the mean, partly the worst */
    private scoreOf(result: ThinkResult): { score: number; dealt: number; taken: number } {
        const mine = this.ai.teamId === 'player';
        const each = result.variants.map((v) => (mine ? v.damageToEnemy - v.damageToPlayer : v.damageToPlayer - v.damageToEnemy));
        const mean = each.reduce((a, b) => a + b, 0) / Math.max(1, each.length);
        const worst = Math.min(...each);
        return {
            score: Math.round(each.length > 1 ? 0.7 * mean + 0.3 * worst : mean),
            dealt: mine ? result.damageToEnemy : result.damageToPlayer,
            taken: mine ? result.damageToPlayer : result.damageToEnemy,
        };
    }

    private evaluate(entry: PlanEntry, variants: readonly ThinkVariant[]): void {
        const careful = variants.length > 1;
        entry.pending = careful ? 'robust' : 'fast';
        this.inFlight++;
        const best = this.beam()[0]?.robust ?? null;
        void thinkPool()
            .run({ ...entry.draft.board, id: nextJobId++, aiTeam: this.ai.teamId, variants })
            .then((result) => {
                this.inFlight--;
                entry.pending = null;
                if (this.done) return;
                if (!result.ok) {
                    entry.failed = true;
                    console.warn(`${this.tag}: plan #${entry.n} battle failed: ${result.error}`);
                    return;
                }
                const { score, dealt, taken } = this.scoreOf(result);
                entry.dealt = dealt;
                entry.taken = taken;
                if (careful) entry.robust = score;
                else entry.fast = score;
                const line = `${this.tag}: plan #${entry.n} ${entry.label} → ${careful ? 'careful' : 'rough'} ${score >= 0 ? '+' : ''}${score} (deals ${dealt}, takes ${taken}${careful ? `, over ${variants.length} variants` : ''}), sim ${result.ms.toFixed(0)} ms`;
                if (entry.parent !== null && best !== null && score > best) {
                    this.improvements++;
                    console.debug(`${line} — new best`);
                } else {
                    console.debug(line);
                }
            });
    }

    /** plays `draft`'s plan back through the builder and compares the boards (log only) */
    private checkReplay(draft: PlanDraft): void {
        let again: PlanDraft | null = null;
        try {
            again = this.ai.planReplay(draft.plan, draft.memo, draft.style);
        } catch (err) {
            console.error(`${this.tag}: plan builder check threw`, err);
            return;
        }
        if (!again) {
            console.warn(`${this.tag}: plan builder check — the replay's dry run failed`);
            return;
        }
        const keys = (board: Board) =>
            board.units
                .filter((u) => u.fields.seat === this.ai.seatId)
                .map((u) => `${u.typeId}@${u.world[0].toFixed(1)},${u.world[2].toFixed(1)} L${String(u.fields.level)} [${((u.fields.items as string[]) ?? []).join('+')}]`)
                .sort();
        const a = keys(draft.board);
        const b = keys(again.board);
        const missing = a.filter((k) => !b.includes(k));
        const extra = b.filter((k) => !a.includes(k));
        if (missing.length === 0 && extra.length === 0 && again.plan.steps.length === draft.plan.steps.length) {
            console.debug(`${this.tag}: plan builder check ok — plan #0 replayed to the same board (${a.length} own units, ${again.plan.steps.length} steps, ${again.dryMs.toFixed(1)} ms)`);
        } else {
            console.warn(`${this.tag}: plan builder check MISMATCH — steps ${draft.plan.steps.length} → ${again.plan.steps.length}`, { missing, extra });
        }
    }

    private finish(): void {
        this.done = true;
        const wall = ((performance.now() - this.wallStart) / 1000).toFixed(1);
        const ready = this.humansReadyAt === null ? 'humans still deploying' : `humans ready at ${this.humansReadyAt.toFixed(1)} s`;
        // the careful look ranks; with none done yet, the rough one
        const careful = this.entries.filter((e) => e.robust !== null).sort((a, b) => b.robust! - a.robust!);
        const rough = this.entries.filter((e) => e.fast !== null).sort((a, b) => b.fast! - a.fast!);
        const ranked = careful.length > 0 ? careful : rough;
        const scoreOf = (e: PlanEntry) => (careful.length > 0 ? e.robust! : e.fast!);
        if (ranked.length === 0) {
            console.warn(`${this.tag}: no plan was simulated (${this.entries.length} drafted, ${thinkPool().broken ?? 'none finished'}) — normal build`);
            this.ai.buildNormally();
            this.ai.lockIn();
            return;
        }
        const chosen = ranked[0]!;
        const refused = this.ai.executePlan(chosen.draft);
        this.host.say('done', this.tested());
        const own = ranked.findIndex((e) => e.n === 0);
        // the strategy it grew from, and how many changes deep
        let root = chosen;
        let depth = 0;
        let moves = 0;
        while (root.parent !== null) {
            if (root.label.includes(' pos: ')) moves++;
            root = this.entries[root.parent]!;
            depth++;
        }
        const sc = scoreOf(chosen);
        console.groupCollapsed(
            `[Learner] seat ${this.ai.seatId} round ${this.round}: plays "${root.label}"${depth > 0 ? ` refined ×${depth}${moves > 0 ? ` (${moves} by position)` : ''}` : ''} — ${sc >= 0 ? '+' : ''}${sc} (deals ${chosen.dealt}, takes ${chosen.taken}) · best of ${this.tested()} plans in ${this.elapsed.toFixed(1)} s · own rules ranked ${own >= 0 ? own + 1 : '—'}`,
        );
        console.info(
            `${this.tag}: ${this.tested()} plans tested (${careful.length} carefully, ${this.positionPhases} position phases, ${this.refinements} random changes, ${this.improvements} new bests) in ${this.elapsed.toFixed(1)} s game time / ${wall} s wall, ${ready} → playing #${chosen.n} "${chosen.label}" (score ${scoreOf(chosen)}, ${careful.length > 0 ? 'careful' : 'rough only'}); its own rules' plan #0 ranked ${own >= 0 ? own + 1 : '—'}${refused > 0 ? `; ${refused} step(s) refused on execute` : ''}`,
        );
        console.table(
            ranked.slice(0, 20).map((e, i) => ({
                rank: i + 1,
                plan: e.n,
                from: e.label,
                rough: e.fast ?? '',
                careful: e.robust ?? '',
                dealt: e.dealt,
                taken: e.taken,
                packs: e.draft.bought.join(', '),
                picked: e === chosen ? '◀' : '',
            })),
        );
        console.groupEnd();
        this.ai.lockIn();
    }
}
