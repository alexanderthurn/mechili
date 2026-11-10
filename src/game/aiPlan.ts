/**
 * A Learner plan as editable data: the actions of one build phase, in order.
 *
 * An action that names a pack the plan itself buys (a level, a rune, a move)
 * can't use that pack's real id — it only exists once the buy has run, and
 * after an edit (a buy dropped, moved earlier) it would be another number. So
 * such a reference is VIRTUAL: negative, naming the step that made the unit
 * and which of that step's new units it was ({@link virtualId}). The builder
 * ({@link playPlan}) dispatches the steps one by one and resolves those as
 * the units appear. A step the dispatcher refuses (too dear now, a tile
 * taken) is passed over, and every later step that names one of its units is
 * skipped — so any edited plan still plays as far as it is legal.
 *
 * Real ids (>= 0) name what stood on the board before the plan began.
 */

import type { Action } from './actions';

export interface Plan {
    steps: Action[];
}

/** one recorded action and the ids of the units it brought onto the board */
export interface RecordedStep {
    action: Action;
    created: number[];
}

/** room for this many new units per step in a virtual id */
const STRIDE = 64;

/** the virtual id of the `k`-th unit step `step` made */
export function virtualId(step: number, k: number): number {
    return -(step * STRIDE + k + 1);
}

/** the step a virtual id points at */
export function virtualStep(id: number): number {
    return Math.floor((-id - 1) / STRIDE);
}

/**
 * `action` with its unit references passed through `map` (null: that unit is
 * gone). A batch keeps the units it can still name; any other action naming
 * a gone unit is dropped (null).
 */
export function remapUnits(action: Action, map: (id: number) => number | null): Action | null {
    const a = action as Action & { unitId?: number; unitIds?: number[] };
    let out: typeof a = a;
    if (typeof a.unitId === 'number') {
        const id = map(a.unitId);
        if (id === null) return null;
        if (id !== a.unitId) out = { ...out, unitId: id };
    }
    if (Array.isArray(a.unitIds)) {
        const ids = a.unitIds.map(map).filter((id): id is number => id !== null);
        if (ids.length === 0) return null;
        out = { ...out, unitIds: ids };
    }
    return out;
}

/** a recording as a plan: references to units it made become virtual */
export function planFromRecording(steps: readonly RecordedStep[]): Plan {
    const virtual = new Map<number, number>();
    const out: Action[] = [];
    for (const step of steps) {
        const action = remapUnits(step.action, (id) => virtual.get(id) ?? id);
        if (!action) continue;
        const i = out.length;
        out.push(action);
        step.created.forEach((id, k) => virtual.set(id, virtualId(i, k)));
    }
    return { steps: out };
}

export interface PlayResult {
    applied: number;
    /** steps the dispatcher refused */
    refused: number;
    /** steps naming a unit an earlier refused step would have made */
    skipped: number;
}

/** the ids in `after` that weren't in `before`, in board order */
export function newUnitIds(before: ReadonlySet<number>, after: readonly number[]): number[] {
    return after.filter((id) => !before.has(id));
}

/**
 * Plays `plan` step by step. `dispatch` applies an action (true: done);
 * `unitIds` reads the ids on the board, so the builder sees which units a
 * step added.
 */
export function playPlan(plan: Plan, dispatch: (action: Action) => boolean, unitIds: () => readonly number[]): PlayResult {
    const real = new Map<number, number>();
    const result: PlayResult = { applied: 0, refused: 0, skipped: 0 };
    plan.steps.forEach((step, i) => {
        const action = remapUnits(step, (id) => (id < 0 ? (real.get(id) ?? null) : id));
        if (!action) {
            result.skipped++;
            return;
        }
        const before = new Set(unitIds());
        if (!dispatch(action)) {
            result.refused++;
            return;
        }
        result.applied++;
        newUnitIds(before, unitIds()).forEach((id, k) => real.set(virtualId(i, k), id));
    });
    return result;
}

/** a short summary for the log: steps by kind */
export function describePlan(plan: Plan): string {
    const counts = new Map<string, number>();
    for (const s of plan.steps) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    return [...counts].map(([k, n]) => `${n}× ${k}`).join(', ');
}

// ------------------------------------------------------------------ changing a plan

/** a unit the plan search may buy */
export interface PlanUnitOption {
    id: string;
    cost: number;
    /** footprint, unturned */
    cols: number;
    rows: number;
    unlocked: boolean;
    range: number;
    /** the techs it may research */
    techs: readonly string[];
}

/** what a plan change needs to know of the seat */
export interface MutationContext {
    options: readonly PlanUnitOption[];
    zone: { colMin: number; colMax: number; rowMin: number; rowMax: number; frontRow: number; backRow: number };
    /** its packs that stood before the plan (real ids) — the only ones a level can go to: a level needs banked XP */
    ownPacks: readonly number[];
    /** the fields every action of the seat carries */
    actor: { team: Action['team']; seat?: number };
}

/** big: a strategy apart; medium: one pack or step; small: a pack a tile over */
export type MutationSize = 'big' | 'medium' | 'small';

interface Work {
    action: Action;
    /** its index in the plan changed (null: a new step) */
    from: number | null;
}

type BuyStep = Extract<Action, { kind: 'buy' }>;

/**
 * The steps in order again, with virtual references renumbered to where
 * their steps ended up — a step naming a unit of a removed step goes too.
 * New steps' references are in the old plan's numbering.
 */
function compact(work: readonly Work[]): Plan {
    const at = new Map<number, number>();
    const out: Action[] = [];
    for (const w of work) {
        const action = remapUnits(w.action, (id) => {
            if (id >= 0) return id;
            const step = at.get(virtualStep(id));
            return step === undefined ? null : virtualId(step, (-id - 1) % STRIDE);
        });
        if (!action) continue;
        if (w.from !== null) at.set(w.from, out.length);
        out.push(action);
    }
    return { steps: out };
}

const pickOf = <T>(rng: () => number, list: readonly T[]): T | undefined => list[Math.floor(rng() * list.length)];
const intIn = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const sign = (rng: () => number) => (rng() < 0.5 ? -1 : 1);

/**
 * One change to `plan` of `size`, at random — or null when none fits. Buys
 * may land off the zone or on a taken tile: the builder moves them to the
 * nearest free spot when it plays the plan.
 */
export function mutatePlan(plan: Plan, ctx: MutationContext, rng: () => number, size: MutationSize): { plan: Plan; what: string } | null {
    const work: Work[] = plan.steps.map((action, i) => ({ action, from: i }));
    const buys = work.filter((w): w is Work & { action: BuyStep } => w.action.kind === 'buy');
    const optionOf = (id: string) => ctx.options.find((o) => o.id === id);
    const packRefs = [...ctx.ownPacks];
    const { zone } = ctx;
    const replaceBuy = (w: Work & { action: BuyStep }, patch: Partial<BuyStep>) => {
        w.action = { ...w.action, ...patch };
    };
    /** a buy of `type`: unlocked first when it isn't yet */
    const swapIn = (targets: (Work & { action: BuyStep })[], to: PlanUnitOption) => {
        for (const w of targets) replaceBuy(w, { typeId: to.id });
        if (!to.unlocked) {
            const first = work.indexOf(targets[0]!);
            work.splice(first, 0, { action: { kind: 'unlockUnit', typeId: to.id, ...ctx.actor } as Action, from: null });
        }
    };
    const randomBuy = (): Work => {
        const o = pickOf(rng, ctx.options)!;
        const anchor = { col: intIn(rng, zone.colMin, zone.colMax), row: intIn(rng, zone.rowMin, zone.rowMax) };
        return { action: { kind: 'buy', typeId: o.id, anchor, rotated: rng() < 0.5, ...ctx.actor } as Action, from: null };
    };
    const level = (unitId: number): Work => ({ action: { kind: 'buyLevel', unitId, ...ctx.actor } as Action, from: null });

    const ops: Record<MutationSize, (() => string | null)[]> = {
        big: [
            () => {
                const type = pickOf(rng, [...new Set(buys.map((b) => b.action.typeId))]);
                const to = pickOf(rng, ctx.options.filter((o) => o.id !== type));
                if (!type || !to) return null;
                swapIn(buys.filter((b) => b.action.typeId === type), to);
                return `all ${type} → ${to.id}`;
            },
            () => {
                if (buys.length === 0) return null;
                for (const b of buys) {
                    const o = optionOf(b.action.typeId);
                    const w = o ? (b.action.rotated ? o.rows : o.cols) : 1;
                    replaceBuy(b, { anchor: { col: zone.colMin + zone.colMax - b.action.anchor.col - (w - 1), row: b.action.anchor.row } });
                }
                return 'mirrored to the other flank';
            },
            () => {
                if (buys.length === 0) return null;
                const toFront = rng() < 0.5;
                const d = intIn(rng, 3, 6) * Math.sign(zone.frontRow - zone.backRow) * (toFront ? 1 : -1);
                for (const b of buys) replaceBuy(b, { anchor: { col: b.action.anchor.col, row: b.action.anchor.row + d } });
                return toFront ? 'all forward' : 'all back';
            },
            () => {
                const b = pickOf(rng, buys);
                if (!b) return null;
                work.splice(work.indexOf(b), 1);
                const refs = packRefs.filter((r) => r !== virtualId(b.from!, 0));
                for (let i = 0; i < 2 && refs.length > 0; i++) work.push(level(pickOf(rng, refs)!));
                return `${b.action.typeId} traded for levels`;
            },
        ],
        medium: [
            () => {
                const b = pickOf(rng, buys);
                const to = b && pickOf(rng, ctx.options.filter((o) => o.id !== b.action.typeId));
                if (!b || !to) return null;
                const from = b.action.typeId;
                swapIn([b], to);
                return `one ${from} → ${to.id}`;
            },
            () => {
                const b = pickOf(rng, buys);
                if (!b) return null;
                replaceBuy(b, { anchor: { col: b.action.anchor.col + sign(rng) * intIn(rng, 2, 4), row: b.action.anchor.row + sign(rng) * intIn(rng, 0, 3) } });
                return `${b.action.typeId} moved`;
            },
            () => {
                const ref = pickOf(rng, packRefs);
                if (ref === undefined) return null;
                work.push(level(ref));
                return 'a level more';
            },
            () => {
                const extras = work.filter((w) => w.action.kind !== 'buy' && w.action.kind !== 'unlockUnit');
                const w = pickOf(rng, extras);
                if (!w) return null;
                work.splice(work.indexOf(w), 1);
                return `${w.action.kind} dropped`;
            },
            () => {
                // the round's recruits at level 2 (premium paid), or not
                const at = work.findIndex((w) => w.action.kind === 'recruitLevel');
                if (at >= 0) {
                    work.splice(at, 1);
                    return 'no recruit level';
                }
                work.unshift({ action: { kind: 'recruitLevel', ...ctx.actor } as Action, from: null });
                return 'recruits at level 2';
            },
            () => {
                const typeId = pickOf(rng, [...new Set(buys.map((b) => b.action.typeId))]);
                const techs = typeId ? (optionOf(typeId)?.techs ?? []) : [];
                const techId = pickOf(rng, techs);
                if (!typeId || !techId) return null;
                work.push({ action: { kind: 'buyTech', typeId, techId, ...ctx.actor } as Action, from: null });
                return `${typeId}: ${techId}`;
            },
            () => {
                if (ctx.options.length === 0) return null;
                const w = randomBuy();
                work.push(w);
                return `+${(w.action as BuyStep).typeId}`;
            },
        ],
        small: [
            () => {
                const b = pickOf(rng, buys);
                if (!b) return null;
                const horizontal = rng() < 0.5;
                const d = sign(rng);
                replaceBuy(b, { anchor: { col: b.action.anchor.col + (horizontal ? d : 0), row: b.action.anchor.row + (horizontal ? 0 : d) } });
                return `${b.action.typeId} nudged`;
            },
            () => {
                const b = pickOf(rng, buys);
                if (!b) return null;
                replaceBuy(b, { rotated: !b.action.rotated });
                return `${b.action.typeId} turned`;
            },
        ],
    };
    const list = ops[size];
    // a few tries: an operator may not fit this plan (no buys yet, …)
    for (let attempt = 0; attempt < 6; attempt++) {
        const what = pickOf(rng, list)!();
        if (what) return { plan: compact(work), what };
    }
    return null;
}

/** a plan's identity, to skip testing the same plan twice */
export function planKey(plan: Plan): string {
    return JSON.stringify(plan.steps);
}

// ------------------------------------------------------------------ positions

/** a spot to try a pack on, named for the log */
export interface PositionSpot {
    name: string;
    anchor: { col: number; row: number };
}

/** one of the other side's packs, in board tiles (its middle) */
export interface EnemyPack {
    typeId: string;
    col: number;
    row: number;
    /** what it's worth (cost × level): the biggest get a pack opposite them */
    value: number;
}

/** `plan` with buy step `i` standing at `anchor` */
export function withAnchor(plan: Plan, i: number, anchor: { col: number; row: number }): Plan {
    const steps = [...plan.steps];
    const step = steps[i];
    if (step?.kind === 'buy') steps[i] = { ...step, anchor: { col: Math.round(anchor.col), row: Math.round(anchor.row) } };
    return { steps };
}

/** `plan` with buy steps `i` and `j` trading places (and turns) */
export function withSwap(plan: Plan, i: number, j: number): Plan {
    const steps = [...plan.steps];
    const a = steps[i];
    const b = steps[j];
    if (a?.kind !== 'buy' || b?.kind !== 'buy') return plan;
    steps[i] = { ...a, anchor: b.anchor, rotated: b.rotated };
    steps[j] = { ...b, anchor: a.anchor, rotated: a.rotated };
    return { steps };
}

/** the plan's buy steps of packs the search may move (not walls or posts) */
export function movableBuys(plan: Plan, ctx: MutationContext): number[] {
    const ids = new Set(ctx.options.map((o) => o.id));
    return plan.steps.flatMap((s, i) => (s.kind === 'buy' && ids.has(s.typeId) ? [i] : []));
}

/**
 * Where else buy step `i`'s pack could stand — chess-like, from the board:
 * opposite each of the other side's three most valuable packs (melee at the
 * front, ranged further back), either flank and the middle at the front and
 * the back, and behind its own melee (ranged only). Spots within a tile of
 * where it stands now are left out; the builder moves a spot that is taken
 * or off the zone to the nearest free tile.
 */
export function positionSpots(plan: Plan, i: number, ctx: MutationContext, enemies: readonly EnemyPack[]): PositionSpot[] {
    const step = plan.steps[i];
    if (step?.kind !== 'buy') return [];
    const o = ctx.options.find((x) => x.id === step.typeId);
    if (!o) return [];
    const { zone } = ctx;
    const w = step.rotated ? o.rows : o.cols;
    const h = step.rotated ? o.cols : o.rows;
    const ranged = o.range >= 10;
    const depthRow = (d: number) => zone.backRow + (zone.frontRow - zone.backRow) * d - h / 2;
    const colAt = (f: number) => zone.colMin + (zone.colMax - zone.colMin) * f - w / 2;
    const out: PositionSpot[] = [];
    for (const e of [...enemies].sort((a, b) => b.value - a.value).slice(0, 3)) {
        out.push({ name: `opposite their ${e.typeId}`, anchor: { col: e.col - w / 2, row: depthRow(ranged ? 0.45 : 0.95) } });
    }
    out.push({ name: 'low flank, front', anchor: { col: colAt(0.12), row: depthRow(0.9) } });
    out.push({ name: 'high flank, front', anchor: { col: colAt(0.88), row: depthRow(0.9) } });
    out.push({ name: 'middle, front', anchor: { col: colAt(0.5), row: depthRow(0.95) } });
    out.push({ name: 'middle, back', anchor: { col: colAt(0.5), row: depthRow(0.1) } });
    out.push({ name: 'low flank, back', anchor: { col: colAt(0.12), row: depthRow(0.15) } });
    out.push({ name: 'high flank, back', anchor: { col: colAt(0.88), row: depthRow(0.15) } });
    if (ranged) {
        // behind the plan's own melee nearest the middle
        const melee = plan.steps
            .map((s, k) => ({ s, k }))
            .filter(({ s, k }) => k !== i && s.kind === 'buy' && (ctx.options.find((x) => x.id === (s as BuyStep).typeId)?.range ?? 99) < 10)
            .map(({ s }) => s as BuyStep);
        const back = Math.sign(zone.backRow - zone.frontRow) * 4;
        for (const m of melee.slice(0, 2)) out.push({ name: `behind own ${m.typeId}`, anchor: { col: m.anchor.col, row: m.anchor.row + back } });
    }
    const near = (a: { col: number; row: number }) => Math.abs(a.col - step.anchor.col) <= 1 && Math.abs(a.row - step.anchor.row) <= 1;
    return out.filter((spot) => !near(spot.anchor));
}
