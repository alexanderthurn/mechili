import type { Application } from 'pixi.js';
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { THEME } from '../theme';

export interface DebugPerfStats {
    /** packs on the board */
    units: number;
    /** individual mechs (pack members / battle actors) */
    mechs: number;
    /** build | battle | … */
    phase?: string;
    round?: number;
    /** unit-instance pool lines from UnitInstanceRenderer.debugSnapshot() */
    instanceLines?: string[];
    instanceCount?: number;
    instancePools?: number;
}

/** Top-left performance readout — only shown when `?debug` is in the URL. */
export class DebugOverlay {
    readonly el: HTMLDivElement;
    private accumulator = 0;
    private enabled = false;
    /** last full report — what a click copies */
    private lastReport = '';
    private flashTimer = 0;

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

        const hud =
            `fps ${fps.toFixed(0)}  ${ms.toFixed(1)}ms  dpr ${dpr}\n` +
            `units ${stats.units}  mechs ${stats.mechs}  objs ${sceneStats.drawables}\n` +
            `calls ${info.render.calls}  tris ${tris}\n` +
            `geo ${info.memory.geometries}  tex ${info.memory.textures}` +
            (stats.instanceCount !== undefined
                ? `\ninst ${stats.instanceCount} in ${stats.instancePools ?? 0} pools`
                : '') +
            `\n(click to copy)`;

        this.el.textContent = hud;

        const lines = [
            '=== mechili perf ===',
            `time  ${new Date().toISOString()}`,
            `ua    ${navigator.userAgent}`,
            `phase ${stats.phase ?? '?'}  round ${stats.round ?? '?'}`,
            `fps   ${fps.toFixed(1)}  frame ${ms.toFixed(2)}ms  dpr ${dpr}`,
            `canvas css ${canvas.clientWidth}x${canvas.clientHeight}  buffer ${canvas.width}x${canvas.height}`,
            `units ${stats.units}  mechs ${stats.mechs}`,
            `draw  calls=${info.render.calls}  tris=${info.render.triangles}  points=${info.render.points}  lines=${info.render.lines}`,
            `mem3  geo=${info.memory.geometries}  tex=${info.memory.textures}`,
            `scene drawables=${sceneStats.drawables}  meshes=${sceneStats.meshes}  instancedMeshes=${sceneStats.instanced}  sprites=${sceneStats.sprites}`,
            `inst  count=${stats.instanceCount ?? 0}  pools=${stats.instancePools ?? 0}`,
            ...(stats.instanceLines ?? []),
        ];
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
