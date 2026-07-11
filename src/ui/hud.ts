import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import type { StartCard } from '../game/cards';
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
    /** seconds between shots (tech-resolved) */
    attackInterval: number;
    /** area-damage radius; absent = single target */
    splash?: number;
    /** living/total mechs of the pack (1/1 for single mechs and towers) */
    alive: number;
    total: number;
    /** equipped pack items, as squares in the panel */
    items?: { icon: string; name: string }[];
    /** lifetime combat record (absent for structures/extras) */
    record?: { damageDealt: number; kills: number };
    /** veterancy of the pack; xpNext < 0 means max level */
    level: number;
    xp: number;
    xpNext: number;
    /** the buyable next level (own packs, build phase, below max level);
     *  `all` appears when several packs of the kind are ready at once */
    levelUp?: {
        cost: number;
        ready: boolean;
        affordable: boolean;
        all?: { count: number; cost: number; affordable: boolean };
    };
    /** buyable techs (own packs, build phase only) */
    techs?: { id: string; name: string; cost: number; owned: boolean; affordable: boolean }[];
    /** base buildings render their level as N / maxLevel and hide XP */
    structure?: boolean;
    /** a base building's supply-only level upgrade (own, build phase) */
    towerUpgrade?: { cost: number; affordable: boolean; maxed: boolean; maxLevel: number };
    /** the once-per-round level-2 recruit switch (Command Tower only) */
    recruit?: { cost: number; active: boolean; affordable: boolean };
    /** +1 deployment for the running round (Research Center only) */
    deploySlot?: { cost: number; active: boolean; affordable: boolean };
    /** the permanent sell-ability unlock (Command Tower only) */
    sellAbility?: { cost: number; owned: boolean; affordable: boolean };
    /** permanent army-wide boost tracks (Command Tower only); label shows the NEXT tier */
    boosts?: { id: 'attack' | 'hp'; label: string; cost: number; affordable: boolean; maxed: boolean }[];
    /** selling this pack (once the ability is owned; limited per round) */
    sell?: { refund: number; available: boolean };
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
    onSpeedUp: (() => void) | null = null;
    onSpeedDown: (() => void) | null = null;
    onBuyTech: ((techId: string) => void) | null = null;
    onBuyLevel: (() => void) | null = null;
    onLevelAll: (() => void) | null = null;
    onRecruitLevel: (() => void) | null = null;
    onUpgradeTower: (() => void) | null = null;
    onBuySellAbility: (() => void) | null = null;
    onSellUnit: (() => void) | null = null;
    onBuyDeploySlot: (() => void) | null = null;
    onBuyBoost: ((boost: 'attack' | 'hp') => void) | null = null;
    onArmItem: ((itemId: string) => void) | null = null;
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
    private readonly undoEl: HTMLButtonElement;
    private readonly deploysEl: HTMLSpanElement;
    private readonly inventoryEl: HTMLDivElement;
    private itemGhost: HTMLDivElement | null = null;
    private lastInventoryKey = '';
    private deploysLeft = Infinity;
    private extrasBudgetLeft = Infinity;
    private readonly costOf: (type: UnitType) => number;
    private readonly buttons: { el: HTMLButtonElement; type: UnitType }[] = [];
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
        this.costOf = costOf;
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
                `damage ${type.damage}${type.splashRadius ? ` (splash ${type.splashRadius})` : ''}` +
                ` every ${type.attackInterval}s · range ${type.range} · speed ${type.speed}`;
            button.addEventListener('click', () => onBuy(UNIT_TYPES[i]!));
            this.buttons.push({ el: button, type });
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
            if (!button) return;
            if (button.dataset.levelall) this.onLevelAll?.();
            else if (button.dataset.levelup) this.onBuyLevel?.();
            else if (button.dataset.recruit) this.onRecruitLevel?.();
            else if (button.dataset.towerupgrade) this.onUpgradeTower?.();
            else if (button.dataset.sellability) this.onBuySellAbility?.();
            else if (button.dataset.deployslot) this.onBuyDeploySlot?.();
            else if (button.dataset.boost) this.onBuyBoost?.(button.dataset.boost as 'attack' | 'hp');
            else if (button.dataset.sell) this.onSellUnit?.();
            else if (button.dataset.tech) this.onBuyTech?.(button.dataset.tech);
        });

        // unequipped pack items (left edge): click to pick up, click a pack to place
        this.inventoryEl = document.createElement('div');
        this.inventoryEl.className = 'mechili-inv';
        this.inventoryEl.style.display = 'none';
        this.inventoryEl.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.inv-item');
            if (button?.dataset.item) this.onArmItem?.(button.dataset.item);
        });
        // the picked-up item rides the cursor (capture phase: HUD elements
        // stop pointer events from bubbling to window)
        window.addEventListener(
            'pointermove',
            (e) => {
                if (!this.itemGhost) return;
                this.itemGhost.style.left = `${e.clientX - 20}px`;
                this.itemGhost.style.top = `${e.clientY - 20}px`;
            },
            true,
        );
        this.mount(this.inventoryEl);

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
        this.deploysEl = document.createElement('span');
        this.deploysEl.className = 'deploys';
        this.deploysEl.title =
            'Units bought this round / your limit · remaining supply budget for shields & rockets';
        const endButton = document.createElement('button');
        endButton.className = 'end-deploy';
        endButton.textContent = 'End Deployment';
        endButton.addEventListener('click', () => this.onEndDeployment?.());
        this.undoEl = document.createElement('button');
        this.undoEl.className = 'undo';
        this.undoEl.textContent = '↩ Undo';
        this.undoEl.title = 'Revert your last action this round — click again for the one before';
        this.undoEl.addEventListener('click', () => this.onUndo?.());
        this.speedEl = document.createElement('button');
        this.speedEl.className = 'speed';
        this.speedEl.textContent = '1×';
        this.speedEl.title = 'Battle speed — click: faster, right click: slower';
        this.speedEl.addEventListener('click', () => this.onSpeedUp?.());
        this.speedEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.onSpeedDown?.();
        });
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
            this.deploysEl,
            this.undoEl,
            endButton,
            this.speedEl,
            this.enemyHpEl,
        );

        this.mount(this.unitBar);
        this.mount(this.topBar);
        this.mount(this.panel);
    }

    /** the undo button only shows while there is something to undo */
    setUndoVisible(visible: boolean): void {
        // '' lets the battle-phase CSS rule keep hiding it during battles
        this.undoEl.style.display = visible ? '' : 'none';
    }

    /** the left-edge strip of unequipped items (one square each); empty list hides it */
    setInventory(
        items: readonly { id: string; icon: string; name: string; armed: boolean }[],
    ): void {
        const key = JSON.stringify(items);
        if (key === this.lastInventoryKey) return;
        this.lastInventoryKey = key;
        this.inventoryEl.style.display = items.length ? '' : 'none';
        this.inventoryEl.innerHTML =
            `<div class="inv-title">Items</div>` +
            items
                .map(
                    (i) =>
                        `<button class="inv-item${i.armed ? ' armed' : ''}" data-item="${i.id}" title="${i.name}\nClick to pick up, then click one of your packs.">` +
                        `<span class="i">${i.icon}</span></button>`,
                )
                .join('');
        // the picked-up item's ghost rides the cursor until placed or cancelled
        const picked = items.find((i) => i.armed);
        if (picked && !this.itemGhost) {
            this.itemGhost = document.createElement('div');
            this.itemGhost.className = 'inv-drag';
            this.itemGhost.style.left = '-100px';
            document.body.appendChild(this.itemGhost);
        }
        if (this.itemGhost) {
            if (!picked) {
                this.itemGhost.remove();
                this.itemGhost = null;
            } else {
                this.itemGhost.textContent = picked.icon;
            }
        }
    }

    /** purchases used / allowed this round; buy buttons grey out at the limit.
     *  `extrasBudgetLeft` is the separate supply cap for shields/rockets. */
    setDeploys(used: number, limit: number, extrasBudgetLeft: number): void {
        this.deploysLeft = limit - used;
        this.extrasBudgetLeft = extrasBudgetLeft;
        const label = `⚙ ${used}/${limit} · ◇ ${extrasBudgetLeft}`;
        if (this.deploysEl.textContent !== label) this.deploysEl.textContent = label;
    }

    /** re-reads unit prices (they change while the recruit switch is active) */
    refreshCosts(): void {
        for (const { el, type } of this.buttons) {
            el.querySelector('.cost')!.textContent = String(this.costOf(type));
        }
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
        const unitButtons =
            (info.levelUp
                ? `<button class="tech-buy" data-levelup="1" ${
                      info.levelUp.ready && info.levelUp.affordable ? '' : 'disabled'
                  }><span>★ Level up${info.levelUp.ready ? '' : ' — needs XP'}</span><span class="c">${info.levelUp.cost}</span></button>`
                : '') +
            (info.levelUp?.all
                ? `<button class="tech-buy" data-levelall="1" ${
                      info.levelUp.all.affordable ? '' : 'disabled'
                  }><span>★ Level all (${info.levelUp.all.count})</span><span class="c">${info.levelUp.all.cost}</span></button>`
                : '') +
            (info.sell
                ? `<button class="tech-buy" data-sell="1" ${
                      info.sell.available ? '' : 'disabled'
                  }><span>Sell${info.sell.available ? '' : ' — used this round'}</span><span class="c">+${info.sell.refund}</span></button>`
                : '');
        const levelUp = unitButtons ? `<div class="techs">${unitButtons}</div>` : '';
        // base building actions: the supply-only upgrade, and (Command Tower) the recruit switch
        const boosts = (info.boosts ?? [])
            .map((b) =>
                b.maxed
                    ? `<div class="tech-owned"><span>✓ ${b.label}</span></div>`
                    : `<button class="tech-buy" data-boost="${b.id}" ${
                          b.affordable ? '' : 'disabled'
                      }><span>${b.label}</span><span class="c">${b.cost}</span></button>`,
            )
            .join('');
        const building =
            info.towerUpgrade || info.recruit || info.sellAbility || boosts
                ? `<div class="techs">` +
                  boosts +
                  (info.towerUpgrade && !info.towerUpgrade.maxed
                      ? `<button class="tech-buy" data-towerupgrade="1" ${
                            info.towerUpgrade.affordable ? '' : 'disabled'
                        }><span>⬆ Upgrade to level ${info.level + 1}</span><span class="c">${info.towerUpgrade.cost}</span></button>`
                      : '') +
                  (info.recruit
                      ? info.recruit.active
                          ? `<div class="tech-owned"><span>✓ Recruiting at level 2</span></div>`
                          : `<button class="tech-buy" data-recruit="1" ${
                                info.recruit.affordable ? '' : 'disabled'
                            }><span>★★ Recruits at level 2</span><span class="c">${info.recruit.cost}</span></button>`
                      : '') +
                  (info.deploySlot
                      ? info.deploySlot.active
                          ? `<div class="tech-owned"><span>✓ +1 deployment this round</span></div>`
                          : `<button class="tech-buy" data-deployslot="1" ${
                                info.deploySlot.affordable ? '' : 'disabled'
                            }><span>+1 deployment this round</span><span class="c">${info.deploySlot.cost}</span></button>`
                      : '') +
                  (info.sellAbility
                      ? info.sellAbility.owned
                          ? `<div class="tech-owned"><span>✓ Sell ability</span></div>`
                          : `<button class="tech-buy" data-sellability="1" ${
                                info.sellAbility.affordable ? '' : 'disabled'
                            }><span>Unlock selling (1/round)</span><span class="c">${info.sellAbility.cost}</span></button>`
                      : '') +
                  `</div>`
                : '';
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
        const itemSquares = info.items?.length
            ? `<div class="item-row">${info.items
                  .map((i) => `<span class="item-sq" title="${i.name}">${i.icon}</span>`)
                  .join('')}</div>`
            : '';
        this.panel.innerHTML =
            `<div class="title">${info.name}${stars}</div>` +
            `<div class="team ${info.team}">${info.team}</div>` +
            itemSquares +
            `<div class="hpbar"><div style="width:${Math.max(0, (info.hp / info.maxHp) * 100)}%"></div></div>` +
            row('HP', `${Math.max(0, Math.round(info.hp))} / ${Math.round(info.maxHp)}`) +
            (info.total > 1 ? row('Pack', `${info.alive} / ${info.total}`) : '') +
            row(
                'Level',
                info.structure
                    ? `${info.level}${info.towerUpgrade ? ` / ${info.towerUpgrade.maxLevel}` : ''}`
                    : info.xpNext < 0
                      ? `${info.level} (max)`
                      : `${info.level} · ${Math.round(info.xp)}/${Math.round(info.xpNext)} XP`,
            ) +
            row('Damage', String(Math.round(info.damage))) +
            row('Reload', `${Math.round(info.attackInterval * 10) / 10}s`) +
            (info.splash ? row('Splash', String(info.splash)) : '') +
            row('Range', String(info.range)) +
            row('Speed', String(info.speed)) +
            (info.record
                ? row('Total dmg', String(Math.round(info.record.damageDealt))) +
                  row('Kills', String(info.record.kills))
                : '') +
            levelUp +
            building +
            techs;
    }

    setPhase(round: number, phase: Phase, remainingSeconds: number, waitingForPeer = false): void {
        this.roundEl.textContent = `Round ${round}`;
        this.phaseEl.textContent = waitingForPeer
            ? 'Waiting for opponent…'
            : phase === 'build'
              ? 'Deployment'
              : 'Battle';
        const s = Math.max(0, Math.ceil(remainingSeconds));
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.topBar.classList.toggle('battle', phase === 'battle');
        // locked in: only spectating remains — no buying, no ending twice
        this.topBar.classList.toggle('waiting', waitingForPeer);
        this.unitBar.classList.toggle('disabled', phase !== 'build' || waitingForPeer);
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

    /** the pre-round-1 loadout pick: four cards, click one, the game begins */
    showStartCards(cards: readonly StartCard[], onPick: (cardId: string) => void): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Choose your specialist</div><div class="cards-row">` +
            cards
                .map(
                    (c) =>
                        `<button class="card" data-card="${c.id}">` +
                        `<div class="c-title">${c.title}</div>` +
                        `<div class="c-units">${c.unitsLabel}</div>` +
                        `<div class="c-hp">♥ ${c.startingHp} HP</div>` +
                        `<div class="c-desc">${c.description}</div>` +
                        `</button>`,
                )
                .join('') +
            `</div>`;
        overlay.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card) return;
            overlay.remove();
            onPick(button.dataset.card);
        });
        this.mount(overlay);
    }

    /** the between-round card offer: pick one (paying its cost) or skip for supply */
    showRoundCards(
        cards: readonly { id: string; title: string; body: string; cost: number; affordable: boolean }[],
        skipReward: number,
        onPick: (cardId: string | null) => void,
    ): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Choose a card</div><div class="cards-row">` +
            cards
                .map(
                    (c) =>
                        `<button class="card" data-card="${c.id}" ${c.affordable ? '' : 'disabled'}>` +
                        `<div class="c-title">${c.title}</div>` +
                        `<div class="c-desc">${c.body}</div>` +
                        `<div class="c-cost">${c.cost > 0 ? `⬢ ${c.cost}` : 'Free'}</div>` +
                        `</button>`,
                )
                .join('') +
            `</div>` +
            `<button class="cards-skip">Skip — take ⬢ ${skipReward}</button>`;
        overlay.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.cards-skip')) {
                overlay.remove();
                onPick(null);
                return;
            }
            const button = target.closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card || button.disabled) return;
            overlay.remove();
            onPick(button.dataset.card);
        });
        this.mount(overlay);
    }

    /** the peer connection died — nothing to do but return to the menu */
    showDisconnect(): void {
        const el = document.createElement('div');
        el.className = 'mechili-gameover draw';
        el.innerHTML = `<div class="go-title">DISCONNECTED</div><button class="go-restart">Main Menu</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => location.reload());
        this.mount(el);
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
        for (const { el, type } of this.buttons) {
            const cost = this.costOf(type);
            const blocked = type.extra ? cost > this.extrasBudgetLeft : this.deploysLeft <= 0;
            el.classList.toggle('unaffordable', cost > amount || blocked);
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
