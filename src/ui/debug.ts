import type { Application } from 'pixi.js';
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { THEME } from '../theme';

/** Named CPU timings in milliseconds (one frame or a rolling window). */
export type CpuTimings = Record<string, number>;

export interface DebugPerfStats {
    /** packs on the board */
    units: number;
    /** individual mechs (pack members / battle actors) */
    mechs: number;
    /** living non-structure mechs (soft-crowd counter) */
    mobile?: number;
    /** soft-crowd on/off for the current sim step */
    softCrowd?: boolean;
    /** soft-crowd limit constant (for HUD context) */
    softCrowdLimit?: number;
    /** build | battle | … */
    phase?: string;
    round?: number;
    /** unit-instance pool lines from UnitInstanceRenderer.debugSnapshot() */
    instanceLines?: string[];
    instanceCount?: number;
    instancePools?: number;
    /** frame CPU breakdown (ms), e.g. sim / render / instances */
    cpu?: CpuTimings;
    /** battle-sim internal breakdown when in combat */
    simCpu?: CpuTimings;
    simSteps?: number;
}

/**
 * Accumulates labeled `performance.now()` spans. Used by the debug overlay
 * to show where a frame's CPU time goes.
 */
export class CpuSampler {
    private readonly sums: Record<string, number> = {};
    private mark = 0;

    reset(): void {
        for (const k of Object.keys(this.sums)) delete this.sums[k];
    }

    /** Start a timed span (pairs with {@link end}). */
    begin(): void {
        this.mark = performance.now();
    }

    /** End the current span and add elapsed ms under `label`. */
    end(label: string): void {
        const dt = performance.now() - this.mark;
        this.sums[label] = (this.sums[label] ?? 0) + dt;
        this.mark = performance.now();
    }

    /** Time a synchronous block. */
    time<T>(label: string, fn: () => T): T {
        const t0 = performance.now();
        try {
            return fn();
        } finally {
            this.sums[label] = (this.sums[label] ?? 0) + (performance.now() - t0);
        }
    }

    /** Snapshot of accumulated ms (does not clear). */
    snapshot(): CpuTimings {
        return { ...this.sums };
    }

    /** Total ms across all labels. */
    total(): number {
        let s = 0;
        for (const v of Object.values(this.sums)) s += v;
        return s;
    }
}

/** Format timings as `label 1.2ms 34%` lines, sorted by cost. */
export function formatCpuLines(timings: CpuTimings, indent = ''): string[] {
    const entries = Object.entries(timings).filter(([, ms]) => ms > 0.01);
    if (entries.length === 0) return [];
    entries.sort((a, b) => b[1]! - a[1]!);
    const total = entries.reduce((s, [, ms]) => s + ms, 0) || 1;
    return entries.map(([name, ms]) => {
        const pct = (ms / total) * 100;
        return `${indent}${name.padEnd(14)} ${ms.toFixed(1)}ms  ${pct.toFixed(0)}%`;
    });
}

/** Top-left performance readout — only shown when `?debug` is in the URL. */
export class DebugOverlay {
    readonly el: HTMLDivElement;
    private accumulator = 0;
    private enabled = false;
    /** last full report — what a click copies */
    private lastReport = '';
    private flashTimer = 0;
    /** rolling averages so the HUD doesn't flicker every frame */
    private readonly cpuAvg: Record<string, number> = {};
    private readonly simCpuAvg: Record<string, number> = {};

    constructor(parent: HTMLElement, enabled = false) {
        this.el = document.createElement('div');
        this.el.className = 'mechili-debug';
        this.el.title = 'Click to copy perf report';
        this.el.style.cssText = [
            'position:absolute',
            'left:10px',
            'top:78px', // sits under the player fighter card
            'z-index:50',
            'pointer-events:auto',
            'cursor:pointer',
            'padding:6px 8px',
            'border-radius:6px',
            'background:rgba(8,12,6,0.72)',
            'border:1px solid rgba(168,216,120,0.35)',
            'color:' + THEME.ui.debug,
            'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
            'white-space:pre',
            'text-shadow:0 1px 2px rgba(0,0,0,0.9)',
            'display:none',
            'user-select:none',
        ].join(';');
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            void this.copyReport();
        });
        // don't let the click fall through to the game canvas
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        parent.appendChild(this.el);
        this.setEnabled(enabled);
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.el.style.display = enabled ? 'block' : 'none';
        if (!enabled) this.el.textContent = '';
    }

    destroy(): void {
        this.el.remove();
    }

    update(
        app: Application,
        renderer: WebGLRenderer,
        scene: Scene,
        stats: DebugPerfStats,
        dtSeconds: number,
    ): void {
        if (!this.enabled) return;

        if (this.flashTimer > 0) {
            this.flashTimer -= dtSeconds;
            if (this.flashTimer <= 0) this.el.style.borderColor = 'rgba(168,216,120,0.35)';
        }

        // smooth CPU bars every frame; refresh text on the usual cadence
        if (stats.cpu) blendTimings(this.cpuAvg, stats.cpu);
        if (stats.simCpu) blendTimings(this.simCpuAvg, stats.simCpu);

        this.accumulator += dtSeconds;
        if (this.accumulator < 0.25) return;
        this.accumulator = 0;

        const fps = app.ticker.FPS;
        const ms = fps > 0 ? 1000 / fps : 0;
        const info = renderer.info;
        const sceneStats = countSceneObjects(scene);
        const tris =
            info.render.triangles >= 1000
                ? `${(info.render.triangles / 1000).toFixed(1)}k`
                : String(info.render.triangles);
        const canvas = renderer.domElement;
        const dpr = renderer.getPixelRatio();
        const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
            .memory;

        const cpuLines = formatCpuLines(this.cpuAvg);
        const simLines = formatCpuLines(this.simCpuAvg, '  ');
        const cpuBlock =
            cpuLines.length > 0
                ? `\n-- cpu frame --\n${cpuLines.join('\n')}` +
                  (simLines.length
                      ? `\n-- sim step ×${stats.simSteps ?? '?'} --\n${simLines.join('\n')}`
                      : '')
                : '';

        const hud =
            `fps ${fps.toFixed(0)}  ${ms.toFixed(1)}ms  dpr ${dpr}\n` +
            `units ${stats.units}  mechs ${stats.mechs}` +
            (stats.mobile !== undefined
                ? `  mobile ${stats.mobile}` +
                  (stats.softCrowdLimit !== undefined
                      ? `/${stats.softCrowdLimit}${stats.softCrowd === false ? ' off' : ''}`
                      : '')
                : '') +
            `  objs ${sceneStats.drawables}\n` +
            `calls ${info.render.calls}  tris ${tris}\n` +
            `geo ${info.memory.geometries}  tex ${info.memory.textures}` +
            (stats.instanceCount !== undefined
                ? `\ninst ${stats.instanceCount} in ${stats.instancePools ?? 0} pools`
                : '') +
            cpuBlock +
            `\n(click to copy)`;

        this.el.textContent = hud;

        const lines = [
            '=== mechili perf ===',
            `time  ${new Date().toISOString()}`,
            `ua    ${navigator.userAgent}`,
            `phase ${stats.phase ?? '?'}  round ${stats.round ?? '?'}`,
            `fps   ${fps.toFixed(1)}  frame ${ms.toFixed(2)}ms  dpr ${dpr}`,
            `canvas css ${canvas.clientWidth}x${canvas.clientHeight}  buffer ${canvas.width}x${canvas.height}`,
            `units ${stats.units}  mechs ${stats.mechs}` +
            (stats.mobile !== undefined ? `  mobile ${stats.mobile}` : '') +
            (stats.softCrowdLimit !== undefined
                ? `  softCrowd ${stats.softCrowd ? 'on' : 'off'} (limit ${stats.softCrowdLimit})`
                : ''),
            `draw  calls=${info.render.calls}  tris=${info.render.triangles}  points=${info.render.points}  lines=${info.render.lines}`,
            `mem3  geo=${info.memory.geometries}  tex=${info.memory.textures}`,
            `scene drawables=${sceneStats.drawables}  meshes=${sceneStats.meshes}  instancedMeshes=${sceneStats.instanced}  sprites=${sceneStats.sprites}`,
            `inst  count=${stats.instanceCount ?? 0}  pools=${stats.instancePools ?? 0}`,
            ...(stats.instanceLines ?? []),
            '--- cpu frame (avg) ---',
            ...formatCpuLines(this.cpuAvg),
        ];
        if (Object.keys(this.simCpuAvg).length) {
            lines.push(`--- sim internals (avg, per update / ${stats.simSteps ?? '?'} steps) ---`);
            lines.push(...formatCpuLines(this.simCpuAvg, '  '));
        }
        if (mem) {
            lines.push(
                `heap  used=${(mem.usedJSHeapSize / 1e6).toFixed(1)}MB  limit=${(mem.jsHeapSizeLimit / 1e6).toFixed(0)}MB`,
            );
        }
        this.lastReport = lines.join('\n');
    }

    private async copyReport(): Promise<void> {
        const text = this.lastReport || this.el.textContent || '';
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // fallback for older / restricted contexts
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        this.el.style.borderColor = 'rgba(220,255,160,0.95)';
        this.flashTimer = 1.2;
        const base = this.el.textContent ?? '';
        this.el.textContent = base.replace(/\n\(click to copy\)$/, '\n(copied!)');
    }
}

function blendTimings(avg: Record<string, number>, sample: CpuTimings, alpha = 0.25): void {
    for (const [k, v] of Object.entries(sample)) {
        avg[k] = avg[k] === undefined ? v : avg[k]! * (1 - alpha) + v * alpha;
    }
    // decay labels that disappeared this frame
    for (const k of Object.keys(avg)) {
        if (sample[k] === undefined) avg[k]! *= 1 - alpha;
        if (avg[k]! < 0.005) delete avg[k];
    }
}

interface SceneObjectCounts {
    drawables: number;
    meshes: number;
    instanced: number;
    sprites: number;
}

/** meshes + points + lines + sprites currently in the scene graph */
function countSceneObjects(root: Object3D): SceneObjectCounts {
    const counts: SceneObjectCounts = { drawables: 0, meshes: 0, instanced: 0, sprites: 0 };
    root.traverse((o) => {
        const any = o as Object3D & {
            isMesh?: boolean;
            isPoints?: boolean;
            isLine?: boolean;
            isSprite?: boolean;
            isInstancedMesh?: boolean;
        };
        if (any.isInstancedMesh) {
            counts.instanced++;
            counts.drawables++;
            return;
        }
        if (any.isMesh) {
            counts.meshes++;
            counts.drawables++;
            return;
        }
        if (any.isSprite) {
            counts.sprites++;
            counts.drawables++;
            return;
        }
        if (any.isPoints || any.isLine) counts.drawables++;
    });
    return counts;
}
