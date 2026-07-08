import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { UNIT_TYPES, type UnitType } from '../game/units';

export type Phase = 'build' | 'battle';

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
.mechili-hud.disabled { opacity: 0.35; pointer-events: none; }
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
.mechili-hud button.unaffordable { opacity: 0.35; }
.mechili-hud .name { font-size: 12px; font-weight: bold; letter-spacing: 1px; }
.mechili-hud .icon { width: 26px; height: 26px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #35e0ff, #10161a 70%); }
.mechili-hud .cost { font-size: 12px; color: #d8c66a; }

.mechili-topbar {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 18px;
    background: rgba(16, 22, 26, 0.85);
    border: 1.5px solid #3d4a52;
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    color: #d8e6ea;
    user-select: none;
}
.mechili-topbar .round { font-size: 15px; font-weight: bold; letter-spacing: 1px; }
.mechili-topbar .phase { font-size: 13px; color: #9db4c8; letter-spacing: 1px; text-transform: uppercase; }
.mechili-topbar .timer { font-size: 18px; font-weight: bold; font-variant-numeric: tabular-nums; color: #d8c66a; }
.mechili-topbar .supply { font-size: 16px; font-weight: bold; font-variant-numeric: tabular-nums; color: #ffd766; }
.mechili-topbar .supply::before { content: '⬢ '; color: #8a7635; }
.mechili-topbar .end-deploy {
    padding: 7px 14px;
    background: #123a44;
    border: 1.5px solid #35e0ff;
    border-radius: 8px;
    color: #35e0ff;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-topbar .end-deploy:hover { background: #17505e; }
.mechili-topbar.battle .end-deploy { display: none; }
.mechili-topbar.battle .timer { color: #ff5f45; }
`;

/**
 * HUD built from real HTML: the unit selector bar and the round/phase top
 * bar. When the browser supports the experimental HTML-in-Canvas API, the
 * elements live inside the Pixi canvas and are mirrored to the GPU via
 * HTMLSource (staying natively interactive). Otherwise they fall back to a
 * plain DOM overlay above the canvases.
 */
export class Hud {
    /** 'html-in-canvas' when mirrored via HTMLSource, 'dom-overlay' otherwise */
    readonly mode: 'html-in-canvas' | 'dom-overlay';
    onEndDeployment: (() => void) | null = null;

    private readonly unitBar: HTMLDivElement;
    private readonly topBar: HTMLDivElement;
    private readonly roundEl: HTMLSpanElement;
    private readonly phaseEl: HTMLSpanElement;
    private readonly timerEl: HTMLSpanElement;
    private readonly supplyEl: HTMLSpanElement;
    private readonly buttons: { el: HTMLButtonElement; cost: number }[] = [];
    private readonly sprites: { el: HTMLElement; sprite: Sprite }[] = [];
    private readonly pixiCanvas: HTMLCanvasElement;
    private readonly app: Application;
    private readonly overlayParent: HTMLElement;

    constructor(
        app: Application,
        overlayParent: HTMLElement,
        costOf: (type: UnitType) => number,
        onSelect: (type: UnitType) => void,
    ) {
        this.app = app;
        this.pixiCanvas = app.canvas;
        this.overlayParent = overlayParent;
        this.mode =
            typeof (app.canvas as any).requestPaint === 'function' ? 'html-in-canvas' : 'dom-overlay';

        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        // unit selector (bottom center)
        this.unitBar = document.createElement('div');
        this.unitBar.className = 'mechili-hud';
        UNIT_TYPES.forEach((type, i) => {
            const button = document.createElement('button');
            button.innerHTML =
                `<span class="name">${type.name}</span>` +
                `<span class="icon"></span>` +
                `<span class="cost">${costOf(type)}</span>`;
            button.addEventListener('click', () => {
                this.buttons.forEach((b) => b.el.classList.remove('selected'));
                button.classList.add('selected');
                onSelect(UNIT_TYPES[i]!);
            });
            this.buttons.push({ el: button, cost: costOf(type) });
            this.unitBar.appendChild(button);
        });
        this.buttons[0]!.el.classList.add('selected');
        onSelect(UNIT_TYPES[0]!);

        // round / phase / timer (top center)
        this.topBar = document.createElement('div');
        this.topBar.className = 'mechili-topbar';
        this.roundEl = document.createElement('span');
        this.roundEl.className = 'round';
        this.phaseEl = document.createElement('span');
        this.phaseEl.className = 'phase';
        this.timerEl = document.createElement('span');
        this.timerEl.className = 'timer';
        this.supplyEl = document.createElement('span');
        this.supplyEl.className = 'supply';
        const endButton = document.createElement('button');
        endButton.className = 'end-deploy';
        endButton.textContent = 'End Deployment';
        endButton.addEventListener('click', () => this.onEndDeployment?.());
        this.topBar.append(this.roundEl, this.phaseEl, this.timerEl, this.supplyEl, endButton);

        this.mount(this.unitBar);
        this.mount(this.topBar);
    }

    setPhase(round: number, phase: Phase, remainingSeconds: number): void {
        this.roundEl.textContent = `Round ${round}`;
        this.phaseEl.textContent = phase === 'build' ? 'Deployment' : 'Battle';
        const s = Math.max(0, Math.ceil(remainingSeconds));
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.topBar.classList.toggle('battle', phase === 'battle');
        this.unitBar.classList.toggle('disabled', phase !== 'build');
    }

    setSupply(amount: number): void {
        this.supplyEl.textContent = String(amount);
        for (const { el, cost } of this.buttons) {
            el.classList.toggle('unaffordable', cost > amount);
        }
    }

    /** Keeps the mirrored sprites aligned with each element's layout box. */
    layout(): void {
        if (this.sprites.length === 0) return;
        const canvasRect = this.pixiCanvas.getBoundingClientRect();
        for (const { el, sprite } of this.sprites) {
            const r = el.getBoundingClientRect();
            sprite.position.set(r.left - canvasRect.left, r.top - canvasRect.top);
        }
    }

    private mount(el: HTMLElement): void {
        // don't let HUD interactions fall through to camera/placement handlers
        for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) {
            el.addEventListener(type, (e) => e.stopPropagation());
        }
        if (this.mode === 'html-in-canvas') {
            // must be a direct child of the Pixi canvas; mirrored to the GPU each repaint
            this.pixiCanvas.appendChild(el);
            const sprite = Sprite.from(new HTMLSource({ resource: el, autoUpdate: true }));
            this.app.stage.addChild(sprite);
            this.sprites.push({ el, sprite });
        } else {
            this.overlayParent.appendChild(el);
        }
    }
}
