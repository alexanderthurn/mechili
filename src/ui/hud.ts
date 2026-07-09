import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { UNIT_TYPES, type UnitType } from '../game/units';
import { THEME, hudStyles } from '../theme';

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
    /** veterancy of the pack; xpNext < 0 means max level */
    level: number;
    xp: number;
    xpNext: number;
    /** buyable techs (own packs, build phase only) */
    techs?: { id: string; name: string; cost: number; owned: boolean; affordable: boolean }[];
}

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
    onBuyTech: ((techId: string) => void) | null = null;
    onUndo: (() => void) | null = null;
    private lastPanelKey = '';
    private report: HTMLDivElement | null = null;

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
        style.textContent = hudStyles();
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
            const hits = [type.targets.ground && 'ground', type.targets.air && 'air']
                .filter(Boolean)
                .join(' + ');
            button.title =
                `${type.name} — ${costOf(type)} supply${type.flying ? ' · FLYING' : ''}\n` +
                `${mechs > 1 ? `${mechs} mechs, ` : ''}${type.hp} HP each · hits ${hits}\n` +
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

        // selection stats panel (bottom left); tech buys via delegation so
        // the per-frame innerHTML refresh can't eat clicks
        this.panel = document.createElement('div');
        this.panel.className = 'mechili-panel';
        this.panel.style.display = 'none';
        this.panel.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.tech-buy');
            if (button?.dataset.tech) this.onBuyTech?.(button.dataset.tech);
        });

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
        const undoButton = document.createElement('button');
        undoButton.className = 'undo';
        undoButton.textContent = '↩ Undo';
        undoButton.title = 'Revert everything placed and bought this round';
        undoButton.addEventListener('click', () => this.onUndo?.());
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
            undoButton,
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
            this.lastPanelKey = '';
            return;
        }
        this.panel.style.display = 'block';
        const key = JSON.stringify(info);
        if (key === this.lastPanelKey) return; // unchanged: keep the DOM stable
        this.lastPanelKey = key;
        const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span class="v">${v}</span></div>`;
        const stars = info.level > 1 ? ` <span style="color:${THEME.ui.veteranStar}">${'★'.repeat(info.level - 1)}</span>` : '';
        const techs = info.techs?.length
            ? `<div class="techs">` +
              info.techs
                  .map((t) =>
                      t.owned
                          ? `<div class="tech-owned"><span>✓ ${t.name}</span></div>`
                          : `<button class="tech-buy" data-tech="${t.id}" ${t.affordable ? '' : 'disabled'}><span>${t.name}</span><span class="c">${t.cost}</span></button>`,
                  )
                  .join('') +
              `</div>`
            : '';
        this.panel.innerHTML =
            `<div class="title">${info.name}${stars}</div>` +
            `<div class="team ${info.team}">${info.team}</div>` +
            `<div class="hpbar"><div style="width:${Math.max(0, (info.hp / info.maxHp) * 100)}%"></div></div>` +
            row('HP', `${Math.max(0, Math.round(info.hp))} / ${Math.round(info.maxHp)}`) +
            (info.total > 1 ? row('Pack', `${info.alive} / ${info.total}`) : '') +
            row('Level', info.xpNext < 0 ? `${info.level} (max)` : `${info.level} · ${Math.round(info.xp)}/${Math.round(info.xpNext)} XP`) +
            row('Damage', String(Math.round(info.damage))) +
            row('Range', String(info.range)) +
            row('Speed', String(info.speed)) +
            techs;
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

    /** post-battle damage report; replaces the previous one, dismissible */
    showBattleReport(round: number, rows: { name: string; team: string; damage: number }[]): void {
        this.report?.remove();
        const el = document.createElement('div');
        el.className = 'mechili-report';
        el.innerHTML =
            `<div class="r-title"><span>Round ${round} — damage</span><button class="r-close">✕</button></div>` +
            rows
                .map(
                    (r) =>
                        `<div class="r-row"><span class="n ${r.team}">${r.name}</span><span class="d">${Math.round(r.damage)}</span></div>`,
                )
                .join('');
        el.querySelector('.r-close')!.addEventListener('click', () => {
            el.remove();
            if (this.report === el) this.report = null;
        });
        this.report = el;
        this.mount(el);
    }

    hideBattleReport(): void {
        this.report?.remove();
        this.report = null;
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
