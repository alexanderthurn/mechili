import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { UNIT_TYPES, type UnitType } from '../game/units';

const STYLES = `
.mechili-hud {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-hud button {
    width: 86px;
    height: 86px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px;
    background: rgba(16, 22, 26, 0.85);
    border: 1.5px solid #3d4a52;
    border-radius: 10px;
    color: #d8e6ea;
    cursor: pointer;
}
.mechili-hud button.selected {
    border: 3px solid #35e0ff;
    padding: 6.5px 2.5px;
}
.mechili-hud .name { font-size: 12px; font-weight: bold; letter-spacing: 1px; }
.mechili-hud .icon { width: 26px; height: 26px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #35e0ff, #10161a 70%); }
.mechili-hud .cost { font-size: 12px; color: #d8c66a; }
`;

/**
 * Unit selector bar built from real HTML. When the browser supports the
 * experimental HTML-in-Canvas API, the element lives inside the Pixi canvas
 * and is mirrored to the GPU via HTMLSource (staying natively interactive).
 * Otherwise it falls back to a plain DOM overlay above the canvases.
 */
export class Hud {
    /** 'html-in-canvas' when mirrored via HTMLSource, 'dom-overlay' otherwise */
    readonly mode: 'html-in-canvas' | 'dom-overlay';

    private readonly element: HTMLDivElement;
    private readonly buttons: HTMLButtonElement[] = [];
    private sprite: Sprite | null = null;
    private readonly pixiCanvas: HTMLCanvasElement;

    constructor(app: Application, overlayParent: HTMLElement, onSelect: (type: UnitType) => void) {
        this.pixiCanvas = app.canvas;

        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        this.element = document.createElement('div');
        this.element.className = 'mechili-hud';
        UNIT_TYPES.forEach((type, i) => {
            const button = document.createElement('button');
            button.innerHTML =
                `<span class="name">${type.name}</span>` +
                `<span class="icon"></span>` +
                `<span class="cost">${type.cost}</span>`;
            button.addEventListener('click', () => {
                this.buttons.forEach((b) => b.classList.remove('selected'));
                button.classList.add('selected');
                onSelect(UNIT_TYPES[i]!);
            });
            this.buttons.push(button);
            this.element.appendChild(button);
        });
        this.buttons[0]!.classList.add('selected');
        onSelect(UNIT_TYPES[0]!);

        // don't let HUD interactions fall through to camera/placement handlers
        for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) {
            this.element.addEventListener(type, (e) => e.stopPropagation());
        }

        const supportsHtmlInCanvas = typeof (app.canvas as any).requestPaint === 'function';
        if (supportsHtmlInCanvas) {
            this.mode = 'html-in-canvas';
            // must be a direct child of the Pixi canvas; mirrored to the GPU each repaint
            app.canvas.appendChild(this.element);
            this.sprite = Sprite.from(new HTMLSource({ resource: this.element, autoUpdate: true }));
            app.stage.addChild(this.sprite);
        } else {
            this.mode = 'dom-overlay';
            overlayParent.appendChild(this.element);
        }
    }

    /** Keeps the mirrored sprite aligned with the element's layout box. */
    layout(): void {
        if (!this.sprite) return;
        const canvasRect = this.pixiCanvas.getBoundingClientRect();
        const elRect = this.element.getBoundingClientRect();
        this.sprite.position.set(elRect.left - canvasRect.left, elRect.top - canvasRect.top);
    }
}
