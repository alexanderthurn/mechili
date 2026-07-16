import type { Application } from 'pixi.js';
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { THEME } from '../theme';

export interface DebugPerfStats {
    /** packs on the board */
    units: number;
    /** individual mechs (pack members / battle actors) */
    mechs: number;
}

/** Top-left performance readout — only shown when `?debug` is in the URL. */
export class DebugOverlay {
    readonly el: HTMLDivElement;
    private accumulator = 0;
    private enabled = false;

    constructor(parent: HTMLElement, enabled = false) {
        this.el = document.createElement('div');
        this.el.className = 'mechili-debug';
        this.el.style.cssText = [
            'position:absolute',
            'left:10px',
            'top:78px', // sits under the player fighter card
            'z-index:50',
            'pointer-events:none',
            'padding:6px 8px',
            'border-radius:6px',
            'background:rgba(8,12,6,0.72)',
            'border:1px solid rgba(168,216,120,0.35)',
            'color:' + THEME.ui.debug,
            'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
            'white-space:pre',
            'text-shadow:0 1px 2px rgba(0,0,0,0.9)',
            'display:none',
        ].join(';');
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
        this.accumulator += dtSeconds;
        if (this.accumulator < 0.25) return;
        this.accumulator = 0;

        const fps = app.ticker.FPS;
        const ms = fps > 0 ? 1000 / fps : 0;
        const info = renderer.info;
        const objs = countSceneObjects(scene);
        const tris =
            info.render.triangles >= 1000
                ? `${(info.render.triangles / 1000).toFixed(1)}k`
                : String(info.render.triangles);

        this.el.textContent =
            `fps ${fps.toFixed(0)}  ${ms.toFixed(1)}ms  dpr ${renderer.getPixelRatio()}\n` +
            `units ${stats.units}  mechs ${stats.mechs}  objs ${objs}\n` +
            `calls ${info.render.calls}  tris ${tris}\n` +
            `geo ${info.memory.geometries}  tex ${info.memory.textures}`;
    }
}

/** meshes + points + lines + sprites currently in the scene graph */
function countSceneObjects(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
        const any = o as Object3D & {
            isMesh?: boolean;
            isPoints?: boolean;
            isLine?: boolean;
            isSprite?: boolean;
            isInstancedMesh?: boolean;
        };
        if (any.isMesh || any.isPoints || any.isLine || any.isSprite || any.isInstancedMesh) n++;
    });
    return n;
}
