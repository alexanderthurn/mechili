/**
 * In-game graphics benchmark — callable from the dev console:
 *
 *     mechiliBenchmark()          // default 5 s per step
 *     mechiliBenchmark({ stepMs: 3000 })   // faster 3 s steps
 *     mechiliBenchmark({ stepMs: 8000, warmupMs: 2000 })
 *
 * The benchmark:
 *   0. Freezes the match (solo pause without the menu: no sim, no camera).
 *   1. Saves the player's current settings.
 *   2. Applies a BASELINE (everything off / minimal).
 *   3. Toggles individual features one at a time (to their low + max tier)
 *      against that baseline so each row isolates ONE setting's cost.
 *   4. Runs the five presets (minimal → ultra) as full-stack tests.
 *   5. Restores the player's original settings and unfreezes.
 *
 * For each step it measures frames via `requestAnimationFrame`, discards a
 * warmup window (GPU shader compile / pass rebuild), then reports avg / min /
 * P1 FPS.
 *
 * Results are `console.table`'d and returned as an array for scripting.
 */

import {
    type Prefs,
    type GraphicsPreset,
    GRAPHICS_PRESETS,
    GRAPHICS_PRESET_IDS,
    prefs,
    updatePrefs,
} from './prefs';

// ── types ────────────────────────────────────────────────────────────────

export interface BenchmarkOptions {
    /** Duration per step in ms (default 5 000). */
    stepMs?: number;
    /** Warmup window at the start of each step, excluded from stats (default 1 000 ms). */
    warmupMs?: number;
    /**
     * Breakdown mode: from the Medium preset, switch off ONE part of the scenery
     * per step (shadows of the scenery, ground shaders, decoration, …) to find
     * which part costs the frame. Given by Game (it owns the scene).
     */
    breakdown?: BenchmarkKnockout[];
    /** Freezes / resumes the match around the run so every step draws the
     *  same frame (wired by Game; solo only). */
    hold?: (on: boolean) => void;
}

/** one part switched off for a breakdown step; `apply` returns how to put it back */
export interface BenchmarkKnockout {
    label: string;
    apply(): () => void;
}

export interface BenchmarkResult {
    /** Human-readable label for this step. */
    label: string;
    /** Which settings were patched from the baseline (summary). */
    settings: string;
    /** Average FPS during the measurement window. */
    avgFps: number;
    /** Minimum per-second FPS bucket observed. */
    minFps: number;
    /** 1st-percentile frame time converted to FPS. */
    p1Fps: number;
    /** Raw per-frame times in ms (measurement window only). */
    frameTimes: number[];
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Wait `ms` while the game keeps rendering, then resolve with per-frame times. */
function measureFrames(totalMs: number, warmupMs: number): Promise<{ frameTimes: number[] }> {
    return new Promise((resolve) => {
        const frameTimes: number[] = [];
        let prev = performance.now();
        const started = prev;
        let warmedUp = false;

        function frame() {
            const now = performance.now();
            const elapsed = now - started;

            if (!warmedUp) {
                // the warmup→measure boundary frame is not counted either
                warmedUp = elapsed >= warmupMs;
                prev = now;
                requestAnimationFrame(frame);
                return;
            }

            frameTimes.push(now - prev);
            prev = now;

            if (elapsed < totalMs) {
                requestAnimationFrame(frame);
            } else {
                resolve({ frameTimes });
            }
        }

        requestAnimationFrame(frame);
    });
}

function stats(frameTimes: number[]): { avgFps: number; minFps: number; p1Fps: number } {
    if (frameTimes.length < 2) return { avgFps: 0, minFps: 0, p1Fps: 0 };

    // avg FPS from total elapsed / frame count
    const totalMs = frameTimes.reduce((a, b) => a + b, 0);
    const avgFps = (frameTimes.length / totalMs) * 1000;

    // min-FPS: bucket into 1-second windows (chronological order)
    let bucketMs = 0;
    let bucketFrames = 0;
    let minFps = Infinity;
    for (const ft of frameTimes) {
        bucketMs += ft;
        bucketFrames++;
        if (bucketMs >= 1000) {
            const fps = (bucketFrames / bucketMs) * 1000;
            if (fps < minFps) minFps = fps;
            bucketMs = 0;
            bucketFrames = 0;
        }
    }
    // leftover partial bucket (< 1 s) — still counts
    if (bucketFrames > 0) {
        const fps = (bucketFrames / bucketMs) * 1000;
        if (fps < minFps) minFps = fps;
    }

    // P1 FPS: 99th-percentile frame time → FPS
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const p99Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
    const p1Fps = 1000 / sorted[p99Idx]!;

    return { avgFps, minFps: minFps === Infinity ? avgFps : minFps, p1Fps };
}

function settingsLabel(patch: Partial<Prefs>): string {
    return Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
}

// ── benchmark steps ──────────────────────────────────────────────────────

/**
 * The minimal baseline: everything off / cheapest — except render scale, which
 * stays native so fill-rate features (AO, bloom, vignette) are costed at the
 * real pixel count.
 */
const BASELINE: Partial<Prefs> = {
    scenery: 'off',
    groundEffects: 'off',
    fireVfx: 'off',
    bloodFx: 'off',
    stuckProjectiles: 'off',
    renderScale: 1,
    shadows: 'off',
    renderDeadUnits: false,
    antialias: false,
    vignette: 'off',
    bloom: 'off',
    ao: 'off',
};

/**
 * Each isolate tests ONE setting against the baseline. The baseline is always
 * applied first, then the patch on top. This way the cost of each feature is
 * isolated from every other.
 */
interface IsolateStep {
    label: string;
    patch: Partial<Prefs>;
}

const ISOLATE_STEPS: IsolateStep[] = [
    // ── render scale ────────────────────────────────────────────────
    { label: 'renderScale 0.75',       patch: { renderScale: 0.75 } },
    { label: 'renderScale 0.5',        patch: { renderScale: 0.5 } },

    // ── scenery ─────────────────────────────────────────────────────
    { label: 'scenery low',            patch: { scenery: 'low' } },
    { label: 'scenery medium',         patch: { scenery: 'medium' } },
    { label: 'scenery high',           patch: { scenery: 'high' } },
    { label: 'scenery ultra',          patch: { scenery: 'ultra' } },

    // ── shadows ─────────────────────────────────────────────────────
    { label: 'shadows low (blobs)',    patch: { shadows: 'low' } },
    { label: 'shadows medium',         patch: { shadows: 'medium' } },
    { label: 'shadows high',           patch: { shadows: 'high' } },
    { label: 'shadows ultra',          patch: { shadows: 'ultra' } },

    // ── ground effects ──────────────────────────────────────────────
    { label: 'groundEffects medium',   patch: { groundEffects: 'medium' } },
    { label: 'groundEffects high',     patch: { groundEffects: 'high' } },

    // ── AO tiers (the focus of this benchmark) ──────────────────────
    { label: 'AO low (0.25× res)',     patch: { ao: 'low' } },
    { label: 'AO medium (0.5× res)',   patch: { ao: 'medium' } },
    { label: 'AO high (full res)',     patch: { ao: 'high' } },
    { label: 'AO ultra',              patch: { ao: 'ultra' } },

    // ── bloom ───────────────────────────────────────────────────────
    { label: 'bloom high',             patch: { bloom: 'high' } },
    { label: 'bloom ultra',            patch: { bloom: 'ultra' } },

    // ── vignette ────────────────────────────────────────────────────
    { label: 'vignette high',          patch: { vignette: 'high' } },
    { label: 'vignette ultra',         patch: { vignette: 'ultra' } },

    // antialias is not benchmarked: it is a WebGL context attribute, read
    // only when the renderer is created, so toggling it live changes nothing

    // ── combined post (like "high" preset's post stack) ─────────────
    { label: 'post combo (AO low + bloom + vignette)',
      patch: { ao: 'low', bloom: 'high', vignette: 'high' } },
    { label: 'post combo (AO medium + bloom + vignette)',
      patch: { ao: 'medium', bloom: 'high', vignette: 'high' } },
];

// ── main entry point ─────────────────────────────────────────────────────

export async function runBenchmark(opts: BenchmarkOptions = {}): Promise<BenchmarkResult[]> {
    const stepMs = opts.stepMs ?? 5000;
    const warmupMs = opts.warmupMs ?? 1000;
    const totalMs = stepMs + warmupMs;

    const saved = { ...prefs() };
    const results: BenchmarkResult[] = [];

    const steps = ISOLATE_STEPS.length + GRAPHICS_PRESET_IDS.length + 1;
    console.info(
        `mechili graphics benchmark — ${steps} steps, ` +
            `${(stepMs / 1000).toFixed(1)} s each + ${(warmupMs / 1000).toFixed(1)} s warmup`,
    );

    async function runStep(label: string, patch: Partial<Prefs>, settingsStr?: string): Promise<BenchmarkResult> {
        updatePrefs(patch);

        // let one frame pass so the compositor rebuilds
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        console.info(`  ▸ ${label}…`);
        const { frameTimes } = await measureFrames(totalMs, warmupMs);
        const s = stats(frameTimes);

        const result: BenchmarkResult = {
            label,
            settings: settingsStr ?? settingsLabel(patch),
            avgFps: Math.round(s.avgFps * 10) / 10,
            minFps: Math.round(s.minFps * 10) / 10,
            p1Fps: Math.round(s.p1Fps * 10) / 10,
            frameTimes,
        };
        results.push(result);
        console.info(`    avg ${result.avgFps}  min ${result.minFps}  P1 ${result.p1Fps}`);
        return result;
    }

    opts.hold?.(true);
    if (opts.breakdown) {
        try {
            // everything from the Medium preset; each step takes one part away
            await runStep('MEDIUM preset (reference)', GRAPHICS_PRESETS.medium as Partial<Prefs>, 'preset medium');
            for (const k of opts.breakdown) {
                const undo = k.apply();
                try {
                    await runStep(`medium − ${k.label}`, {}, k.label);
                } finally {
                    undo();
                }
            }
        } finally {
            updatePrefs(saved);
            opts.hold?.(false);
            console.info('  ✓ original settings restored');
        }
        console.table(results.map(({ label, avgFps, minFps, p1Fps }) => ({ label, avgFps, minFps, p1Fps, ms: Math.round((1000 / avgFps) * 10) / 10 })));
        return results;
    }

    try {
        // ── 1. Baseline ────────────────────────────────────────────
        await runStep('BASELINE (all off)', BASELINE, 'everything off');

        // ── 2. Isolate each feature ────────────────────────────────
        for (const step of ISOLATE_STEPS) {
            // always reset to baseline first, then overlay the isolate patch
            await runStep(step.label, { ...BASELINE, ...step.patch }, settingsLabel(step.patch));
        }

        // ── 3. Full presets ────────────────────────────────────────
        for (const id of GRAPHICS_PRESET_IDS) {
            await runStep(`PRESET: ${id}`, GRAPHICS_PRESETS[id] as Partial<Prefs>, `preset ${id}`);
        }
    } finally {
        // ── 4. Restore original settings ───────────────────────────
        updatePrefs(saved);
        opts.hold?.(false);
        console.info('  ✓ original settings restored');
    }

    // ── summary table ──────────────────────────────────────────────
    const table = results.map(({ label, settings, avgFps, minFps, p1Fps }) => ({
        label,
        settings,
        avgFps,
        minFps,
        p1Fps,
    }));
    console.table(table);

    return results;
}
