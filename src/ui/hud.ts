import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { UNIT_TYPES, type UnitType } from '../game/units';

export type Phase = 'build' | 'battle';

/** what the stats panel shows for a selected pack or single mech */
export interface SelectionInfo {
    name: string;
    team: string;
    hp: number;
    maxHp: number;
    damage: number;
    range: number;
    speed: number;
    /** living/total mechs of the pack (1/1 for single mechs and towers) */
    alive: number;
    total: number;
}

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
.mechili-hud button:hover { border-color: #35e0ff; }
.mechili-hud button:active { transform: scale(0.94); }
.mechili-hud button.unaffordable { opacity: 0.35; pointer-events: none; }

.mechili-panel {
    position: absolute;
    left: 16px;
    bottom: 16px;
    min-width: 180px;
    padding: 12px 14px;
    background: rgba(16, 22, 26, 0.88);
    border: 1.5px solid #3d4a52;
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    color: #d8e6ea;
    user-select: none;
}
.mechili-panel .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
.mechili-panel .team { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.mechili-panel .team.player { color: #35e0ff; }
.mechili-panel .team.enemy { color: #ff5f45; }
.mechili-panel .row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-panel .row .v { color: #ffd766; font-variant-numeric: tabular-nums; }
.mechili-panel .hpbar { height: 6px; margin: 6px 0 8px; background: #10161a; border-radius: 3px; overflow: hidden; }
.mechili-panel .hpbar div { height: 100%; background: #5ade6c; }

.mechili-gameover {
    position: absolute;
    left: 50%;
    top: 40%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 36px 64px;
    background: rgba(10, 14, 17, 0.92);
    border: 2px solid #3d4a52;
    border-radius: 16px;
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-gameover .go-title { font-size: 44px; font-weight: 900; letter-spacing: 10px; }
.mechili-gameover.victory .go-title { color: #35e0ff; }
.mechili-gameover.defeat .go-title { color: #ff5f45; }
.mechili-gameover.draw .go-title { color: #d8c66a; }
.mechili-gameover .go-restart {
    padding: 10px 26px;
    background: #123a44;
    border: 1.5px solid #35e0ff;
    border-radius: 10px;
    color: #35e0ff;
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-gameover .go-restart:hover { background: #17505e; }
.mechili-hud .name { font-size: 12px; font-weight: bold; letter-spacing: 1px; }
.mechili-hud .icon { width: 24px; height: 24px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #35e0ff, #10161a 70%); }
.mechili-hud .cost { font-size: 12px; color: #d8c66a; }
.mechili-hud .size { font-size: 10px; color: #7d919c; }

.mechili-help {
    position: absolute;
    right: 14px;
    bottom: 12px;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.7;
    color: #7d919c;
    text-align: right;
    user-select: none;
    pointer-events: none;
}
.mechili-help b { color: #a9bcc6; font-weight: 600; }

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
.mechili-topbar .hp { font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums; }
.mechili-topbar .hp.player { color: #35e0ff; }
.mechili-topbar .hp.enemy { color: #ff5f45; }
.mechili-topbar .hp::before { content: '♥ '; opacity: 0.6; }
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
.mechili-topbar .speed {
    display: none;
    min-width: 52px;
    padding: 7px 10px;
    background: #3a2c12;
    border: 1.5px solid #ffd766;
    border-radius: 8px;
    color: #ffd766;
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.mechili-topbar .speed:hover { background: #55401c; }
.mechili-topbar.battle .speed { display: inline-block; }
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
    onToggleSpeed: (() => void) | null = null;

    private readonly unitBar: HTMLDivElement;
    private readonly topBar: HTMLDivElement;
    private readonly panel: HTMLDivElement;
    private readonly roundEl: HTMLSpanElement;
    private readonly phaseEl: HTMLSpanElement;
    private readonly timerEl: HTMLSpanElement;
    private readonly supplyEl: HTMLSpanElement;
    private readonly playerHpEl: HTMLSpanElement;
    private readonly enemyHpEl: HTMLSpanElement;
    private readonly speedEl: HTMLButtonElement;
    private readonly buttons: { el: HTMLButtonElement; cost: number }[] = [];
    private readonly sprites: { el: HTMLElement; sprite: Sprite }[] = [];
    private readonly pixiCanvas: HTMLCanvasElement;
    private readonly app: Application;
    private readonly overlayParent: HTMLElement;

    constructor(
        app: Application,
        overlayParent: HTMLElement,
        costOf: (type: UnitType) => number,
        onBuy: (type: UnitType) => void,
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
            const mechs = type.formation.cols * type.formation.rows;
            button.innerHTML =
                `<span class="name">${type.name}</span>` +
                `<span class="icon"></span>` +
                `<span class="size">${type.footprint.cols}×${type.footprint.rows}${mechs > 1 ? ` · ${mechs}` : ''}</span>` +
                `<span class="cost">${costOf(type)}</span>`;
            button.title =
                `${type.name} — ${costOf(type)} supply\n` +
                `${mechs > 1 ? `${mechs} mechs, ` : ''}${type.hp} HP each\n` +
                `damage ${type.damage} · range ${type.range} · speed ${type.speed}`;
            button.addEventListener('click', () => onBuy(UNIT_TYPES[i]!));
            this.buttons.push({ el: button, cost: costOf(type) });
            this.unitBar.appendChild(button);
        });

        // controls hint (bottom right, non-interactive)
        const help = document.createElement('div');
        help.className = 'mechili-help';
        help.innerHTML =
            '<b>Click</b> buy/select/place · <b>Right</b> deselect / drag pan<br>' +
            '<b>Middle</b> rotate pack / drag orbit · <b>Wheel</b> zoom<br>' +
            '<b>WASD</b> pan · <b>Q/E</b> rotate · <b>Home</b> reset camera';
        this.mount(help);

        // selection stats panel (bottom left)
        this.panel = document.createElement('div');
        this.panel.className = 'mechili-panel';
        this.panel.style.display = 'none';

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
        this.speedEl = document.createElement('button');
        this.speedEl.className = 'speed';
        this.speedEl.textContent = '1×';
        this.speedEl.addEventListener('click', () => this.onToggleSpeed?.());
        this.playerHpEl = document.createElement('span');
        this.playerHpEl.className = 'hp player';
        this.enemyHpEl = document.createElement('span');
        this.enemyHpEl.className = 'hp enemy';
        this.topBar.append(
            this.playerHpEl,
            this.roundEl,
            this.phaseEl,
            this.timerEl,
            this.supplyEl,
            endButton,
            this.speedEl,
            this.enemyHpEl,
        );

        this.mount(this.unitBar);
        this.mount(this.topBar);
        this.mount(this.panel);
    }

    setSelection(info: SelectionInfo | null): void {
        if (!info) {
            this.panel.style.display = 'none';
            return;
        }
        this.panel.style.display = 'block';
        const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span class="v">${v}</span></div>`;
        this.panel.innerHTML =
            `<div class="title">${info.name}</div>` +
            `<div class="team ${info.team}">${info.team}</div>` +
            `<div class="hpbar"><div style="width:${Math.max(0, (info.hp / info.maxHp) * 100)}%"></div></div>` +
            row('HP', `${Math.max(0, Math.round(info.hp))} / ${info.maxHp}`) +
            (info.total > 1 ? row('Pack', `${info.alive} / ${info.total}`) : '') +
            row('Damage', String(info.damage)) +
            row('Range', String(info.range)) +
            row('Speed', String(info.speed));
    }

    setPhase(round: number, phase: Phase, remainingSeconds: number): void {
        this.roundEl.textContent = `Round ${round}`;
        this.phaseEl.textContent = phase === 'build' ? 'Deployment' : 'Battle';
        const s = Math.max(0, Math.ceil(remainingSeconds));
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.topBar.classList.toggle('battle', phase === 'battle');
        this.unitBar.classList.toggle('disabled', phase !== 'build');
    }

    setSpeed(multiplier: number): void {
        this.speedEl.textContent = `${multiplier}×`;
    }

    setHp(player: number, enemy: number): void {
        this.playerHpEl.textContent = String(player);
        this.enemyHpEl.textContent = String(enemy);
    }

    showGameOver(result: 'victory' | 'defeat' | 'draw'): void {
        const el = document.createElement('div');
        el.className = `mechili-gameover ${result}`;
        const title = result === 'victory' ? 'VICTORY' : result === 'defeat' ? 'DEFEAT' : 'DRAW';
        el.innerHTML = `<div class="go-title">${title}</div><button class="go-restart">Play Again</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => location.reload());
        this.mount(el);
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
            sprite.visible = r.width > 0 && r.height > 0; // hidden elements have no box
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
