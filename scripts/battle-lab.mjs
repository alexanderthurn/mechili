#!/usr/bin/env node
/**
 * The battle lab (`npm run lab`): thousands of headless battles between
 * made-up armies, to see what the units are worth (src/game/aiLab.ts).
 *
 *   1. random    random armies, levels and formations at equal supply → what
 *                spending on each unit is worth (a ridge regression), damage
 *                per supply by level, survival
 *   2. duels     every unit against every other, mono armies at equal supply → counters
 *   3. formation the same army in two formations → which stands better
 *   4. mixes     an evolution of army mixes per budget against a fixed panel → starting mixes
 *
 * Writes src/game/aiLearned.ts (the Learner reads it) and reports/battle-lab.md.
 * Options: --scale 0.5 (fewer battles), --workers 6.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

/** the browser bits the game's modules read at import time */
function installShims() {
    const store = new Map();
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, length: 0 };
    globalThis.sessionStorage = globalThis.localStorage;
    if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'en', languages: ['en'] };
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : any), apply: () => any, construct: () => any, set: () => true });
    globalThis.document = any;
    globalThis.addEventListener = () => {};
}

async function loadGame() {
    installShims();
    const { createServer } = await import(require.resolve('vite'));
    const server = await createServer({ root: ROOT, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' });
    const lab = await server.ssrLoadModule('/src/game/aiLab.ts');
    const units = await server.ssrLoadModule('/src/game/units.ts');
    const settings = await server.ssrLoadModule('/src/game/settings.ts');
    return { server, lab, types: units.BASE_TYPES, settings: settings.DEFAULT_SETTINGS };
}

// ------------------------------------------------------------------ worker

if (!isMainThread) {
    const silence = console.warn;
    console.warn = (...a) => (String(a[0]).includes('THREE') ? undefined : silence(...a));
    const { lab, types, settings } = await loadGame();
    parentPort.on('message', (task) => {
        try {
            const r = lab.labBattle(types, settings, task.a, task.b, task.fa, task.fb);
            parentPort.postMessage({ id: task.id, ok: true, r });
        } catch (err) {
            parentPort.postMessage({ id: task.id, ok: false, error: String(err?.stack ?? err) });
        }
    });
    parentPort.postMessage({ ready: true });
} else {
    await main();
}

// ------------------------------------------------------------------ main

async function main() {
    const arg = (name, def) => {
        const i = process.argv.indexOf(`--${name}`);
        return i >= 0 ? Number(process.argv[i + 1]) : def;
    };
    const scale = arg('scale', 1);
    const workers = arg('workers', Math.max(1, Math.min(10, os.cpus().length - 1)));
    const t0 = Date.now();
    console.warn = ((w) => (...a) => (String(a[0]).includes('THREE') ? undefined : w(...a)))(console.warn);
    const { server, lab, types, settings } = await loadGame();
    const pool = lab.labPool(types);
    const ids = pool.map((t) => t.id);
    const leveling = settings.leveling;
    const rng = lab.labRng(20261110);
    console.log(`battle lab: ${pool.length} units, ${workers} workers, scale ${scale}`);

    // the worker pool
    const slots = [];
    const queue = [];
    const waiting = new Map();
    let nextId = 1;
    let battles = 0;
    await Promise.all(
        Array.from({ length: workers }, () =>
            new Promise((ready) => {
                const w = new Worker(fileURLToPath(import.meta.url));
                const slot = { w, busy: false };
                w.on('message', (m) => {
                    if (m.ready) {
                        slots.push(slot);
                        ready();
                        pump();
                        return;
                    }
                    slot.busy = false;
                    battles++;
                    const done = waiting.get(m.id);
                    waiting.delete(m.id);
                    if (!m.ok) console.error('battle failed:', m.error.split('\n')[0]);
                    done(m.ok ? m.r : null);
                    pump();
                });
                w.on('error', (e) => console.error('worker error', e));
            }),
        ),
    );
    function pump() {
        for (const s of slots) {
            if (s.busy || queue.length === 0) continue;
            const task = queue.shift();
            s.busy = true;
            s.w.postMessage(task);
        }
    }
    const fight = (a, b, fa, fb) =>
        new Promise((resolve) => {
            const id = nextId++;
            waiting.set(id, resolve);
            queue.push({ id, a, b, fa, fb });
            pump();
        });
    const progress = (label, done, total) => {
        if (done === total || (total >= 200 && done % Math.floor(total / 4) === 0)) console.log(`  ${label}: ${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    };
    async function all(label, tasks) {
        let done = 0;
        return Promise.all(
            tasks.map((t) =>
                fight(t.a, t.b, t.fa, t.fb).then((r) => {
                    progress(label, ++done, tasks.length);
                    return { ...t, r };
                }),
            ),
        );
    }
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const BUDGETS = [1000, 2500, 5000];
    const F = lab.LAB_FORMATIONS;

    // 1. random battles
    const randomTasks = [];
    for (let i = 0; i < Math.round(2000 * scale); i++) {
        const budget = BUDGETS[i % BUDGETS.length];
        randomTasks.push({ budget, a: lab.randomLabArmy(pool, budget, rng, leveling), b: lab.randomLabArmy(pool, budget, rng, leveling), fa: pick(F), fb: pick(F) });
    }
    const random = (await all('random', randomTasks)).filter((x) => x.r);

    // unit value: ridge regression of the margin (per 1000 supply) on the share difference
    const n = ids.length;
    const XtX = Array.from({ length: n }, () => new Array(n).fill(0));
    const Xty = new Array(n).fill(0);
    for (const { a, b, r, budget } of random) {
        const sa = lab.labShares(a, types, leveling);
        const sb = lab.labShares(b, types, leveling);
        const x = ids.map((id) => (sa[id] ?? 0) - (sb[id] ?? 0));
        const y = (r.margin / budget) * 1000;
        for (let i = 0; i < n; i++) {
            if (x[i] === 0) continue;
            Xty[i] += x[i] * y;
            for (let j = 0; j < n; j++) XtX[i][j] += x[i] * x[j];
        }
    }
    for (let i = 0; i < n; i++) XtX[i][i] += 0.5;
    const value = solve(XtX, Xty);
    const unitValue = Object.fromEntries(ids.map((id, i) => [id, round(value[i])]));

    // damage per 100 supply and survival, by type and level
    const perLevel = {};
    for (const { r } of random) {
        for (const p of r.packs) {
            const k = `${p.typeId}|${p.level}`;
            const e = (perLevel[k] ??= { spent: 0, dealt: 0, alive: 0, n: 0 });
            e.spent += p.spent;
            e.dealt += p.damageDealt;
            e.alive += p.alive ? 1 : 0;
            e.n++;
        }
    }

    // 2. duels: mono armies at equal supply
    const mono = (type, budget) => {
        const out = [];
        let left = budget;
        while (out.length < 14 && type.cost <= left) {
            out.push({ typeId: type.id, level: 1 });
            left -= type.cost;
        }
        return out;
    };
    const duelTasks = [];
    const DUEL_BUDGET = 2500;
    for (const ta of pool) for (const tb of pool) if (ta !== tb) duelTasks.push({ ta: ta.id, tb: tb.id, a: mono(ta, DUEL_BUDGET), b: mono(tb, DUEL_BUDGET), fa: 'sorted', fb: 'sorted' });
    const duels = (await all('duels', scale < 1 ? duelTasks.filter((_, i) => i % Math.round(1 / scale) === 0) : duelTasks)).filter((x) => x.r && x.a.length && x.b.length);
    const raw = {};
    for (const d of duels) ((raw[d.ta] ??= {})[d.tb] ??= []).push((d.r.margin / DUEL_BUDGET) * 1000);
    const counters = {};
    for (const a of ids) {
        for (const b of ids) {
            if (a === b) continue;
            const ab = raw[a]?.[b];
            const ba = raw[b]?.[a];
            if (!ab && !ba) continue;
            // a as A against b, and a as B against b (its margin is the other way round there)
            const vals = [...(ab ?? []), ...(ba ?? []).map((v) => -v)];
            (counters[a] ??= {})[b] = round(vals.reduce((s, v) => s + v, 0) / vals.length);
        }
    }

    // 3. formations: the same army both sides, two formations
    const formTasks = [];
    for (let k = 0; k < Math.round(20 * scale); k++) {
        const budget = BUDGETS[k % BUDGETS.length];
        const army = lab.randomLabArmy(pool, budget, rng, leveling);
        for (const fa of F) for (const fb of F) if (fa !== fb) formTasks.push({ budget, a: army, b: army, fa, fb });
    }
    const forms = (await all('formations', formTasks)).filter((x) => x.r);
    const formAcc = Object.fromEntries(F.map((f) => [f, { sum: 0, n: 0 }]));
    const formVs = {};
    for (const { fa, fb, r, budget } of forms) {
        const m = (r.margin / budget) * 1000;
        formAcc[fa].sum += m;
        formAcc[fa].n++;
        formAcc[fb].sum -= m;
        formAcc[fb].n++;
        const e = ((formVs[fa] ??= {})[fb] ??= { sum: 0, n: 0 });
        e.sum += m;
        e.n++;
    }
    const formations = Object.fromEntries(F.map((f) => [f, round(formAcc[f].sum / Math.max(1, formAcc[f].n))]));

    // 4. mixes: an evolution of weights over the pool (+ a formation) per budget, against a fixed panel
    const mixes = [];
    const POP = Math.max(6, Math.round(12 * Math.sqrt(scale)));
    const GENS = Math.max(3, Math.round(6 * Math.sqrt(scale)));
    const PANEL = Math.max(5, Math.round(10 * Math.sqrt(scale)));
    for (const budget of BUDGETS) {
        const panel = Array.from({ length: PANEL }, () => ({ army: lab.randomLabArmy(pool, budget, rng, leveling), f: pick(F) }));
        const randomGenome = () => ({ w: Object.fromEntries(ids.map((id) => [id, rng() < 0.4 ? rng() : 0])), f: pick(F) });
        let pop = Array.from({ length: POP }, randomGenome);
        let scored = [];
        for (let g = 0; g < GENS; g++) {
            const evalRng = lab.labRng(budget * 31 + g);
            const tasks = [];
            pop.forEach((genome, gi) => {
                const army = lab.randomLabArmy(pool, budget, evalRng, leveling, (t) => genome.w[t.id] ?? 0);
                genome.army = army.length > 0 ? army : lab.randomLabArmy(pool, budget, evalRng, leveling);
                for (const p of panel) tasks.push({ gi, a: genome.army, b: p.army, fa: genome.f, fb: p.f });
            });
            const res = await all(`mixes ${budget} gen ${g + 1}/${GENS}`, tasks);
            const sum = new Array(pop.length).fill(0);
            const cnt = new Array(pop.length).fill(0);
            for (const t of res) if (t.r) ((sum[t.gi] += (t.r.margin / budget) * 1000), cnt[t.gi]++);
            scored = pop.map((genome, gi) => ({ genome, score: sum[gi] / Math.max(1, cnt[gi]) })).sort((a, b) => b.score - a.score);
            // the best third stays; the rest are its children
            const keep = scored.slice(0, Math.max(2, Math.floor(POP / 3))).map((s) => s.genome);
            pop = [...keep];
            while (pop.length < POP) {
                const parent = pick(keep);
                const w = {};
                for (const id of ids) {
                    let v = parent.w[id] ?? 0;
                    if (rng() < 0.3) v = v > 0 ? v * Math.exp((rng() - 0.5) * 1.6) : rng() < 0.3 ? rng() : 0;
                    if (rng() < 0.08) v = 0;
                    w[id] = v;
                }
                pop.push({ w, f: rng() < 0.2 ? pick(F) : parent.f });
            }
        }
        for (const s of scored.slice(0, 3)) {
            mixes.push({ budget, formation: s.genome.f, shares: roundShares(lab.labShares(s.genome.army, types, leveling)), score: round(s.score) });
        }
    }

    const learned = {
        hash: lab.labContentHash(types),
        generated: new Date().toISOString().slice(0, 10),
        battles,
        unitValue,
        counters,
        formations,
        mixes,
    };
    writeFileSync(
        join(ROOT, 'src/game/aiLearned.ts'),
        `/** written by \`npm run lab\` (scripts/battle-lab.mjs) — don't edit by hand; run it again after balance changes */\n` +
            `import type { LearnedData } from './aiLab';\n\nexport const AI_LEARNED: LearnedData | null = ${JSON.stringify(learned, null, 4)};\n`,
    );
    mkdirSync(join(ROOT, 'reports'), { recursive: true });
    writeFileSync(join(ROOT, 'reports/battle-lab.md'), report({ learned, perLevel, formVs, ids, types, seconds: (Date.now() - t0) / 1000, workers }));
    console.log(`done: ${battles} battles in ${((Date.now() - t0) / 1000).toFixed(0)} s → src/game/aiLearned.ts, reports/battle-lab.md`);
    for (const s of slots) await s.w.terminate();
    await server.close();
}

function round(v) {
    return Math.round(v * 10) / 10;
}

function roundShares(s) {
    return Object.fromEntries(
        Object.entries(s)
            .filter(([, v]) => v >= 0.02)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => [k, Math.round(v * 100) / 100]),
    );
}

/** A x = b, Gaussian elimination with partial pivoting */
function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        [M[c], M[p]] = [M[p], M[c]];
        if (Math.abs(M[c][c]) < 1e-12) continue;
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

function report({ learned, perLevel, formVs, ids, types, seconds, workers }) {
    const name = (id) => id;
    const lines = [];
    lines.push(`# Battle lab — ${learned.generated}`, '');
    lines.push(`${learned.battles} battles in ${seconds.toFixed(0)} s on ${workers} workers. Content hash \`${learned.hash}\`.`, '');
    lines.push('Headless BattleSim, packs only: no buildings, walls, spells, techs or runes. Margins are the game\'s end-of-battle HP damage (dealt − taken), per 1000 supply.', '');

    // unit value with an outlier flag
    const vals = ids.map((id) => learned.unitValue[id]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const dps = (id, lv) => {
        const e = perLevel[`${id}|${lv}`];
        return e && e.spent > 0 ? ((e.dealt / e.spent) * 100).toFixed(0) : '—';
    };
    const surv = (id) => {
        let a = 0;
        let n = 0;
        for (const lv of [1, 2, 3]) {
            const e = perLevel[`${id}|${lv}`];
            if (e) ((a += e.alive), (n += e.n));
        }
        return n ? `${Math.round((a / n) * 100)}%` : '—';
    };
    lines.push('## What spending on a unit is worth', '');
    lines.push('Value: how much the margin moves when an army puts all its supply into this unit instead of the average mix (ridge regression over the random battles). Damage per 100 supply by level. ⚠ = more than 1.5 standard deviations above the mean (a candidate for "overpowered"); ▽ = as far below.', '');
    lines.push('| unit | cost | value | dmg/100 L1 | L2 | L3 | survives | |', '|---|---:|---:|---:|---:|---:|---:|---|');
    for (const id of [...ids].sort((a, b) => learned.unitValue[b] - learned.unitValue[a])) {
        const v = learned.unitValue[id];
        const flag = v > mean + 1.5 * sd ? '⚠' : v < mean - 1.5 * sd ? '▽' : '';
        lines.push(`| ${name(id)} | ${types.require(id).cost} | ${v} | ${dps(id, 1)} | ${dps(id, 2)} | ${dps(id, 3)} | ${surv(id)} | ${flag} |`);
    }
    lines.push('');

    lines.push('## Counters (mono armies, equal supply)', '');
    lines.push('Per unit: what it beats most and what beats it most (margin per 1000 supply, from both sides of the board).', '');
    lines.push('| unit | beats | loses to |', '|---|---|---|');
    for (const id of ids) {
        const row = Object.entries(learned.counters[id] ?? {}).sort((a, b) => b[1] - a[1]);
        const best = row.filter(([, v]) => v > 0).slice(0, 3).map(([k, v]) => `${k} +${v}`).join(', ') || '—';
        const worst = row.filter(([, v]) => v < 0).slice(-3).reverse().map(([k, v]) => `${k} ${v}`).join(', ') || '—';
        lines.push(`| ${id} | ${best} | ${worst} |`);
    }
    lines.push('');

    lines.push('## Formations (same army both sides)', '');
    const F = Object.keys(learned.formations);
    lines.push('Row against column, both sides of the board averaged (the near side has a small edge of its own).', '');
    lines.push(`| row vs column | ${F.join(' | ')} | mean |`, `|---|${F.map(() => '---:').join('|')}|---:|`);
    const m = (a, b) => (formVs[a]?.[b] ? formVs[a][b].sum / formVs[a][b].n : null);
    for (const a of F) {
        const cells = F.map((b) => {
            if (a === b) return '·';
            const ab = m(a, b);
            const ba = m(b, a);
            return ab === null && ba === null ? '—' : round(((ab ?? -ba) - (ba ?? -ab)) / 2);
        });
        lines.push(`| ${a} | ${cells.join(' | ')} | ${learned.formations[a]} |`);
    }
    lines.push('');

    lines.push('## Starting mixes (evolved against a fixed panel)', '');
    lines.push('| budget | formation | score | mix (supply share) |', '|---:|---|---:|---|');
    for (const m of learned.mixes) lines.push(`| ${m.budget} | ${m.formation} | ${m.score} | ${Object.entries(m.shares).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')} |`);
    lines.push('');
    return lines.join('\n');
}
