import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { SHOP_UNIT_IDS, unitUnlockCost, type StartCard } from '../game/cards';
import { CHAT_TEXT_LIMIT, EMOTES, emoteById, type ChatItem } from '../game/emotes';
import { onPrefsChange, prefs } from '../game/prefs';
import { UNIT_TYPES, type UnitType } from '../game/units';
import { openSettings } from './settings';
import { THEME, hudStyles } from '../theme';

export type Phase = 'build' | 'battle';

/** escapes a string for safe use inside a double-quoted HTML attribute */
function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** one buyable/owned action in the detail panel, rendered as a square tile */
interface ActionTile {
    /** the data-* attribute string the click handler dispatches on, e.g. `data-tech="ap"` */
    data: string;
    icon: string;
    title: string;
    desc: string;
    /** supply price; negative = a refund. Omitted when there's nothing to pay. */
    cost?: number;
    /** buy = affordable, locked = can't act (unaffordable / needs XP), owned = already have it */
    state: 'buy' | 'locked' | 'owned';
    /** small extra line in the hover frame (e.g. why it's locked) */
    note?: string;
}

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
    items?: { icon: string; name: string; desc: string }[];
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
    techs?: { id: string; name: string; desc: string; icon: string; cost: number; owned: boolean; affordable: boolean }[];
    /** base buildings render their level as N / maxLevel and hide XP */
    structure?: boolean;
    /** a base building's supply-only level upgrade (own, build phase) */
    towerUpgrade?: { cost: number; affordable: boolean; maxed: boolean; maxLevel: number };
    /** the once-per-round level-2 recruit switch (Command Tower only) */
    recruit?: { cost: number; active: boolean; affordable: boolean };
    /** +1 deployment for the running round (Research Center only) */
    deploySlot?: { cost: number; active: boolean; affordable: boolean };
    /** +range for all ranged units this round (Research Center only) */
    rangeBoost?: { cost: number; bonus: number; active: boolean; affordable: boolean };
    /** +speed for all units this round (Research Center only) */
    speedBoost?: { cost: number; bonus: number; active: boolean; affordable: boolean };
    /** the permanent sell-ability unlock (Command Tower only) */
    sellAbility?: { cost: number; owned: boolean; affordable: boolean };
    /** permanent army-wide boost tracks (Command Tower only); label shows the NEXT tier */
    boosts?: { id: 'attack' | 'hp'; label: string; cost: number; affordable: boolean; maxed: boolean }[];
    /** selling this pack (once the ability is owned; limited per round) */
    sell?: { refund: number; available: boolean };
}

/**
 * HUD built from real HTML: deployment shop (bottom-right), unit inspector
 * (bottom-left), item sidebars, and the round/phase top bar. When the browser
 * supports the experimental HTML-in-Canvas API, the elements live inside the
 * Pixi canvas and are mirrored to the GPU via HTMLSource (staying natively
 * interactive). Otherwise they fall back to a plain DOM overlay above the canvases.
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
    onLevelAllGlobal: (() => void) | null = null;
    onRecruitLevel: (() => void) | null = null;
    onUpgradeTower: (() => void) | null = null;
    onBuySellAbility: (() => void) | null = null;
    onSellUnit: (() => void) | null = null;
    onBuyDeploySlot: (() => void) | null = null;
    onBuyRoundRangeBoost: (() => void) | null = null;
    onBuyRoundSpeedBoost: (() => void) | null = null;
    onBuyBoost: ((boost: 'attack' | 'hp') => void) | null = null;
    onArmItem: ((itemId: string) => void) | null = null;
    onArmTactic: ((tacticId: string) => void) | null = null;
    onCancelTactic: (() => void) | null = null;
    onResetPlacedTactic: ((routeId: number) => void) | null = null;
    onUndo: (() => void) | null = null;
    /** the player sent a chat item (emote or text) */
    onSendChat: ((item: ChatItem) => void) | null = null;
    onUnlockPick: ((typeId: string) => void) | null = null;
    onQuitToMenu: (() => void) | null = null;
    private pauseMenu: HTMLDivElement | null = null;
    private cardOverlay: HTMLDivElement | null = null;
    private lastPanelKey = '';
    private report: HTMLDivElement | null = null;

    private readonly supplyFrame: HTMLDivElement;
    private readonly shopColumn: HTMLDivElement;
    private readonly extrasRow: HTMLDivElement;
    private readonly shopPanel: HTMLDivElement;
    private readonly shopGrid: HTMLDivElement;
    private readonly unlockTile: HTMLButtonElement;
    private readonly shopUnitTiles = new Map<string, HTMLButtonElement>();
    private shopUnlocked: string[] = [];
    private shopUnlockAvailable = false;
    private shopBalance = 0;
    private unitIcons = new Map<string, string>();
    private lastShopKey = '';
    private lastShopOrderKey = '';
    private lastLevelAllKey = '';
    private readonly fightBar: HTMLDivElement;
    private playerFighterEl!: HTMLDivElement;
    private enemyFighterEl!: HTMLDivElement;
    private readonly topBar: HTMLDivElement;
    private readonly panel: HTMLDivElement;
    private readonly roundEl: HTMLSpanElement;
    private readonly phaseEl: HTMLSpanElement;
    private readonly timerEl: HTMLSpanElement;
    private readonly supplyEl: HTMLSpanElement;
    private readonly playerNameEl: HTMLSpanElement;
    private readonly enemyNameEl: HTMLSpanElement;
    private playerSpecEl!: HTMLSpanElement;
    private enemySpecEl!: HTMLSpanElement;
    /** the chosen specialist card per side — drives the clickable frame detail */
    private playerCard: StartCard | null = null;
    private enemyCard: StartCard | null = null;
    private specDetailOverlay: HTMLDivElement | null = null;
    private readonly playerHpFill: HTMLDivElement;
    private readonly enemyHpFill: HTMLDivElement;
    private readonly playerHpVal: HTMLSpanElement;
    private readonly enemyHpVal: HTMLSpanElement;
    private playerMaxHp = 1000;
    private enemyMaxHp = 1000;
    private readonly speedEl: HTMLButtonElement;
    private readonly undoEl: HTMLButtonElement;
    private readonly levelAllGlobalBtn: HTMLButtonElement;
    private readonly deploysEl: HTMLSpanElement;
    private readonly inventoryEl: HTMLDivElement;
    private readonly enemyInventoryEl: HTMLDivElement;
    private itemGhost: HTMLDivElement | null = null;
    private lastInventoryKey = '';
    private lastEnemyInventoryKey = '';
    private deploysLeft = Infinity;
    private extrasBudgetLeft = Infinity;
    private readonly costOf: (type: UnitType) => number;
    private readonly buttons: { el: HTMLButtonElement; type: UnitType }[] = [];
    private readonly sprites: { el: HTMLElement; sprite: Sprite }[] = [];
    /** every HUD root passed through mount() — needed for dom-overlay teardown */
    private readonly mountedRoots: HTMLElement[] = [];
    private readonly pixiCanvas: HTMLCanvasElement;
    private readonly app: Application;
    private readonly overlayParent: HTMLElement;
    private readonly hudStyle: HTMLStyleElement;
    private readonly onItemGhostMove = (e: PointerEvent) => {
        if (!this.itemGhost) return;
        this.itemGhost.style.left = `${e.clientX - 20}px`;
        this.itemGhost.style.top = `${e.clientY - 20}px`;
    };

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
        this.hudStyle = style;

        const shopUnits = UNIT_TYPES.filter((t) => !t.extra);
        const extraTypes = UNIT_TYPES.filter((t) => t.extra);

        const makeShopTile = (type: UnitType, index: number): HTMLButtonElement => {
            const button = document.createElement('button');
            button.className = 'shop-tile';
            const mechs = type.formation.cols * type.formation.rows;
            button.innerHTML =
                `<span class="title">${type.name}</span>` +
                `<span class="art"></span>` +
                `<span class="cost">${costOf(type)}</span>`;
            const hits = [type.targets.ground && 'ground', type.targets.air && 'air']
                .filter(Boolean)
                .join(' + ');
            button.title =
                `${type.name} — ${costOf(type)} supply${type.flying ? ' · FLYING' : ''}\n` +
                `${mechs > 1 ? `${mechs} mechs, ` : ''}${type.hp} HP each · hits ${hits}\n` +
                `damage ${type.damage}${type.splashRadius ? ` (splash ${type.splashRadius})` : ''}` +
                ` every ${type.attackInterval}s · range ${type.range} · speed ${type.speed}`;
            button.addEventListener('click', () => onBuy(UNIT_TYPES[index]!));
            this.buttons.push({ el: button, type });
            return button;
        };

        // deployment shop column (bottom-right): toolbar, extras row, unit shop
        this.shopColumn = document.createElement('div');
        this.shopColumn.className = 'mechili-shop-col';

        const shopToolbar = document.createElement('div');
        shopToolbar.className = 'shop-toolbar';
        this.undoEl = document.createElement('button');
        this.undoEl.className = 'undo';
        this.undoEl.textContent = '↩ Undo';
        this.undoEl.title = 'Revert your last action this round — click again for the one before';
        this.undoEl.addEventListener('click', () => this.onUndo?.());
        shopToolbar.append(this.undoEl);

        const toolbarRight = document.createElement('div');
        toolbarRight.className = 'shop-toolbar-right';
        this.levelAllGlobalBtn = document.createElement('button');
        this.levelAllGlobalBtn.className = 'level-all-global';
        this.levelAllGlobalBtn.style.display = 'none';
        this.levelAllGlobalBtn.title = 'Level up every ready pack on the field';
        this.levelAllGlobalBtn.addEventListener('click', () => this.onLevelAllGlobal?.());
        toolbarRight.append(this.levelAllGlobalBtn);

        this.supplyFrame = document.createElement('div');
        this.supplyFrame.className = 'mechili-supply';
        this.supplyEl = document.createElement('span');
        this.supplyEl.className = 'supply';
        this.supplyFrame.append(this.supplyEl);
        toolbarRight.append(this.supplyFrame);
        shopToolbar.append(toolbarRight);

        this.extrasRow = document.createElement('div');
        this.extrasRow.className = 'mechili-extras';
        for (const type of extraTypes) {
            const i = UNIT_TYPES.indexOf(type);
            this.extrasRow.appendChild(makeShopTile(type, i));
        }

        this.shopPanel = document.createElement('div');
        this.shopPanel.className = 'mechili-shop';

        const shopHeader = document.createElement('div');
        shopHeader.className = 'shop-header';
        this.deploysEl = document.createElement('span');
        this.deploysEl.className = 'unit-cap';
        this.deploysEl.title = 'Units bought this round / your limit';
        shopHeader.append(this.deploysEl);

        const shopGrid = document.createElement('div');
        shopGrid.className = 'shop-grid';
        this.shopGrid = shopGrid;
        for (const type of shopUnits) {
            const i = UNIT_TYPES.indexOf(type);
            const tile = makeShopTile(type, i);
            tile.style.display = 'none';
            this.shopUnitTiles.set(type.id, tile);
            shopGrid.appendChild(tile);
        }
        this.unlockTile = document.createElement('button');
        this.unlockTile.className = 'shop-tile unlock';
        this.unlockTile.title = 'Unlock one new unit type this round';
        this.unlockTile.innerHTML =
            '<span class="title">Unlock</span>' +
            '<span class="unlock-icon">+</span>' +
            '<span class="unlock-label">Unit</span>';
        this.unlockTile.style.display = 'none';
        this.unlockTile.addEventListener('click', () => this.openUnlockPicker());
        shopGrid.appendChild(this.unlockTile);

        this.shopPanel.append(shopHeader, shopGrid);
        this.shopColumn.append(shopToolbar, this.extrasRow, this.shopPanel);

        // selection stats panel (bottom left); tech buys via delegation so
        // the per-frame innerHTML refresh can't eat clicks
        this.panel = document.createElement('div');
        this.panel.className = 'mechili-panel';
        this.panel.style.display = 'none';
        this.panel.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.action-tile');
            if (!button) return;
            // locked (unaffordable / not ready) and owned tiles stay hoverable
            // for their info frame, but do nothing on click
            if (button.classList.contains('locked') || button.classList.contains('owned')) return;
            if (button.dataset.levelall) this.onLevelAll?.();
            else if (button.dataset.levelup) this.onBuyLevel?.();
            else if (button.dataset.recruit) this.onRecruitLevel?.();
            else if (button.dataset.towerupgrade) this.onUpgradeTower?.();
            else if (button.dataset.sellability) this.onBuySellAbility?.();
            else if (button.dataset.deployslot) this.onBuyDeploySlot?.();
            else if (button.dataset.rangeboost) this.onBuyRoundRangeBoost?.();
            else if (button.dataset.speedboost) this.onBuyRoundSpeedBoost?.();
            else if (button.dataset.boost) this.onBuyBoost?.(button.dataset.boost as 'attack' | 'hp');
            else if (button.dataset.sell) this.onSellUnit?.();
            else if (button.dataset.tech) this.onBuyTech?.(button.dataset.tech);
        });
        // hovering a tile or equipped item pops the big info frame
        const infoSel = '.action-tile, .item-sq';
        this.panel.addEventListener('pointerover', (e) => {
            const tile = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            if (tile) this.showActionInfo(tile);
        });
        this.panel.addEventListener('pointerout', (e) => {
            const from = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.(infoSel);
            if (from && from !== to) this.hideActionInfo();
        });

        // unequipped pack items (left edge sidebar): click to pick up, click a pack to place
        this.inventoryEl = document.createElement('div');
        this.inventoryEl.className = 'mechili-sidebar left';
        this.inventoryEl.style.display = 'none';
        this.inventoryEl.addEventListener('click', (e) => {
            const itemBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.inv-item[data-item]');
            if (itemBtn?.dataset.item) {
                this.onArmItem?.(itemBtn.dataset.item);
                return;
            }
            const tacticBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                '.inv-item[data-tactic]:not(.placed)',
            );
            if (tacticBtn?.dataset.tactic) this.onArmTactic?.(tacticBtn.dataset.tactic);
        });
        this.inventoryEl.addEventListener('contextmenu', (e) => {
            const tacticBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.inv-item[data-tactic]');
            if (!tacticBtn) return;
            e.preventDefault();
            const routeId = tacticBtn.dataset.routeId;
            if (routeId) this.onResetPlacedTactic?.(Number(routeId));
            else this.onCancelTactic?.();
        });

        // opponent items not yet placed (right edge; frozen to phase-start intel)
        this.enemyInventoryEl = document.createElement('div');
        this.enemyInventoryEl.className = 'mechili-sidebar right';
        this.enemyInventoryEl.style.display = 'none';
        // the picked-up item rides the cursor (capture phase: HUD elements
        // stop pointer events from bubbling to window)
        window.addEventListener('pointermove', this.onItemGhostMove, true);
        this.mount(this.inventoryEl);
        this.mount(this.enemyInventoryEl);

        // fighting-game style top bar: fighters on the edges, controls in the center
        this.fightBar = document.createElement('div');
        this.fightBar.className = 'mechili-fightbar';

        const playerFighter = document.createElement('div');
        this.playerFighterEl = playerFighter;
        playerFighter.className = 'fighter player';
        const playerPortrait = document.createElement('div');
        playerPortrait.className = 'portrait';
        playerPortrait.textContent = '◆';
        this.playerNameEl = document.createElement('span');
        this.playerNameEl.className = 'fname';
        this.playerSpecEl = document.createElement('span');
        this.playerSpecEl.className = 'fspec';
        this.playerHpFill = document.createElement('div');
        this.playerHpFill.className = 'hp-fill';
        this.playerHpVal = document.createElement('span');
        this.playerHpVal.className = 'hp-val';
        const playerHpTrack = document.createElement('div');
        playerHpTrack.className = 'hp-track';
        playerHpTrack.append(this.playerHpFill, this.playerHpVal);
        const playerInfo = document.createElement('div');
        playerInfo.className = 'fighter-info';
        playerInfo.append(playerHpTrack, this.playerNameEl, this.playerSpecEl);
        playerFighter.append(playerPortrait, playerInfo);

        const enemyFighter = document.createElement('div');
        this.enemyFighterEl = enemyFighter;
        enemyFighter.className = 'fighter enemy';
        this.enemyHpVal = document.createElement('span');
        this.enemyHpVal.className = 'hp-val';
        const enemyInfo = document.createElement('div');
        enemyInfo.className = 'fighter-info';
        this.enemyNameEl = document.createElement('span');
        this.enemyNameEl.className = 'fname';
        this.enemySpecEl = document.createElement('span');
        this.enemySpecEl.className = 'fspec';
        this.enemyHpFill = document.createElement('div');
        this.enemyHpFill.className = 'hp-fill';
        const enemyHpTrack = document.createElement('div');
        enemyHpTrack.className = 'hp-track';
        enemyHpTrack.append(this.enemyHpFill, this.enemyHpVal);
        enemyInfo.append(enemyHpTrack, this.enemyNameEl, this.enemySpecEl);
        const enemyPortrait = document.createElement('div');
        enemyPortrait.className = 'portrait';
        enemyPortrait.textContent = '◆';
        enemyFighter.append(enemyPortrait, enemyInfo);

        // clicking or hovering a commander frame opens its specialist card (once known)
        playerFighter.addEventListener('click', () => this.showSpecialistDetail('player'));
        enemyFighter.addEventListener('click', () => this.showSpecialistDetail('enemy'));
        playerFighter.addEventListener('mouseenter', () => this.showSpecialistDetail('player'));
        enemyFighter.addEventListener('mouseenter', () => this.showSpecialistDetail('enemy'));
        playerFighter.addEventListener('mouseleave', () => this.hideSpecialistDetail());
        enemyFighter.addEventListener('mouseleave', () => this.hideSpecialistDetail());

        this.topBar = document.createElement('div');
        this.topBar.className = 'mechili-topbar';
        const topMeta = document.createElement('div');
        topMeta.className = 'top-meta';
        this.roundEl = document.createElement('span');
        this.roundEl.className = 'round';
        this.phaseEl = document.createElement('span');
        this.phaseEl.className = 'phase';
        topMeta.append(this.roundEl, this.phaseEl);
        this.timerEl = document.createElement('span');
        this.timerEl.className = 'timer';
        const endButton = document.createElement('button');
        endButton.className = 'end-deploy';
        endButton.textContent = 'End Deployment';
        endButton.addEventListener('click', () => this.onEndDeployment?.());
        this.speedEl = document.createElement('button');
        this.speedEl.className = 'speed';
        this.speedEl.textContent = '1×';
        this.speedEl.title = 'Battle speed — click: faster, right click: slower';
        this.speedEl.addEventListener('click', () => this.onSpeedUp?.());
        this.speedEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.onSpeedDown?.();
        });
        this.topBar.append(
            topMeta,
            this.timerEl,
            endButton,
            this.speedEl,
        );

        this.fightBar.append(playerFighter, this.topBar, enemyFighter);

        this.mount(this.shopColumn);
        this.mount(this.fightBar);
        this.mount(this.panel);
        this.buildChatBar();
    }

    // --- in-match chat -----------------------------------------------------

    private readonly chatFloat = document.createElement('div');
    private chatBar!: HTMLDivElement;
    private chatInput!: HTMLInputElement;

    private buildChatBar(): void {
        this.chatFloat.className = 'mechili-chat-float';
        this.mount(this.chatFloat);

        const bar = document.createElement('div');
        this.chatBar = bar;
        bar.className = 'mechili-chat';
        const emoteButtons = EMOTES.map(
            (e) => `<button type="button" class="c-emote" data-emote="${e.id}" title="${e.label}">${e.icon}</button>`,
        ).join('');
        bar.innerHTML =
            `<div class="c-strip">Chat</div>` +
            `<div class="c-panel">` +
            `<div class="c-emotes">${emoteButtons}</div>` +
            `<div class="c-row">` +
            `<input class="c-input" maxlength="${CHAT_TEXT_LIMIT}" placeholder="message…" spellcheck="false" />` +
            `<button type="button" class="c-send">Send</button>` +
            `</div></div>`;
        this.chatInput = bar.querySelector('.c-input')!;

        const submit = () => {
            const text = this.chatInput.value.trim().slice(0, CHAT_TEXT_LIMIT);
            if (text) this.onSendChat?.({ kind: 'text', text });
            this.chatInput.value = '';
            this.chatInput.focus();
        };
        bar.querySelector('.c-strip')!.addEventListener('click', () => {
            bar.classList.toggle('open');
            if (bar.classList.contains('open')) this.chatInput.focus();
        });
        bar.addEventListener('click', (e) => {
            const emote = (e.target as HTMLElement).closest<HTMLButtonElement>('.c-emote');
            if (emote?.dataset.emote) this.onSendChat?.({ kind: 'emote', id: emote.dataset.emote });
        });
        bar.querySelector('.c-send')!.addEventListener('click', submit);
        this.chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // don't trigger game hotkeys while typing
            if (e.key === 'Escape') {
                bar.classList.remove('open');
                this.chatInput.blur();
            }
            if (e.key === 'Enter') submit();
        });
        this.mount(bar);

        // clicking anywhere outside collapses the panel; the input keeps its
        // text so a half-typed message survives. Self-detaches after teardown.
        const onDocPointer = (e: PointerEvent) => {
            if (!bar.isConnected) {
                document.removeEventListener('pointerdown', onDocPointer);
                return;
            }
            if (bar.classList.contains('open') && !bar.contains(e.target as Node)) {
                bar.classList.remove('open');
            }
        };
        document.addEventListener('pointerdown', onDocPointer);

        // "show combat chat" hides the whole thing, live; the listener
        // detaches itself once this HUD is torn down
        const applyVisibility = () => {
            const show = prefs().combatChat;
            bar.style.display = show ? '' : 'none';
            this.chatFloat.style.display = show ? '' : 'none';
        };
        applyVisibility();
        const off = onPrefsChange(() => {
            if (!bar.isConnected) {
                off();
                return;
            }
            applyVisibility();
        });
    }

    /** shows a chat item: bubble at the sender's fighter card + floating line */
    addChat(name: string, item: ChatItem, from: 'local' | 'remote'): void {
        if (!prefs().combatChat) return; // combat chat fully hidden
        const icon = item.kind === 'emote' ? (emoteById(item.id)?.icon ?? '❓') : null;
        const text = item.kind === 'text' ? item.text : (emoteById(item.id)?.label ?? '');

        // bubble under the sender's fighter card (one at a time per side)
        const fighter = from === 'local' ? this.playerFighterEl : this.enemyFighterEl;
        fighter.querySelector('.chat-bubble')?.remove();
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${item.kind}`;
        bubble.textContent = icon ?? text;
        fighter.appendChild(bubble);
        setTimeout(() => bubble.remove(), 4500);

        // floating line above the chat bar (XSS-safe: textContent only)
        const line = document.createElement('div');
        line.className = `cf-msg ${from}`;
        const who = document.createElement('span');
        who.className = 'cf-name';
        who.textContent = name;
        const what = document.createElement('span');
        what.textContent = icon ? ` ${icon} ${text}` : ` ${text}`;
        line.append(who, what);
        this.chatFloat.appendChild(line);
        while (this.chatFloat.children.length > 4) this.chatFloat.firstChild?.remove();
        setTimeout(() => line.remove(), 7000);
    }

    /** Commander names shown in the top fight bar. */
    setPlayers(local: string, opponent: string, maxHp: number): void {
        this.playerNameEl.textContent = local;
        this.enemyNameEl.textContent = opponent;
        this.playerMaxHp = maxHp;
        this.enemyMaxHp = maxHp;
    }

    /** the undo button only shows while there is something to undo */
    setUndoVisible(visible: boolean): void {
        // '' lets the battle-phase CSS rule keep hiding it during battles
        this.undoEl.style.display = visible ? '' : 'none';
    }

    /** the left-edge strip of unequipped items (one square each); empty list hides it */
    setInventory(
        items: readonly { id: string; icon: string; name: string; armed: boolean }[],
        tactics: readonly {
            id: string;
            icon: string;
            name: string;
            armed: boolean;
            placed?: boolean;
            routeId?: number;
        }[] = [],
    ): void {
        const key = JSON.stringify({ items, tactics });
        if (key === this.lastInventoryKey) return;
        this.lastInventoryKey = key;
        const visible = items.length > 0 || tactics.length > 0;
        this.inventoryEl.style.display = visible ? '' : 'none';
        const itemHtml = items.length
            ? `<div class="inv-title">Items</div>` +
              items
                  .map(
                      (i) =>
                          `<button class="inv-item${i.armed ? ' armed' : ''}" data-item="${i.id}" title="${i.name}\nClick to pick up, then click one of your packs.">` +
                          `<span class="i">${i.icon}</span></button>`,
                  )
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? `<div class="inv-title">Tactics</div>` +
              tactics
                  .map((t) => {
                      const routeAttr = t.routeId !== undefined ? ` data-route-id="${t.routeId}"` : '';
                      const cls =
                          `inv-item tactic` +
                          (t.placed ? ' placed' : '') +
                          (t.armed ? ' armed' : '');
                      const hint = t.placed
                          ? `${t.name}\nRight-click to clear and place again.`
                          : `${t.name}\nClick to place on the map. Right-click to cancel.`;
                      return (
                          `<button class="${cls}" data-tactic="${t.id}"${routeAttr} title="${hint}">` +
                          `<span class="i">${t.icon}</span></button>`
                      );
                  })
                  .join('')
            : '';
        this.inventoryEl.innerHTML = itemHtml + tacticHtml;
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

    /** opponent items/tactics at phase-start intel (right sidebar, read-only) */
    setEnemyInventory(
        items: readonly { icon: string; name: string }[],
        tactics: readonly { icon: string; name: string }[] = [],
        options: { sellAbility?: boolean } = {},
    ): void {
        const key = JSON.stringify({ items, tactics, options });
        if (key === this.lastEnemyInventoryKey) return;
        this.lastEnemyInventoryKey = key;
        const visible = items.length > 0 || tactics.length > 0 || !!options.sellAbility;
        this.enemyInventoryEl.style.display = visible ? '' : 'none';
        const itemHtml = items.length
            ? `<div class="inv-title">Enemy items</div>` +
              items
                  .map(
                      (i) =>
                          `<span class="inv-item readonly" title="${i.name}">` +
                          `<span class="i">${i.icon}</span></span>`,
                  )
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? `<div class="inv-title">Enemy tactics</div>` +
              tactics
                  .map(
                      (t) =>
                          `<span class="inv-item readonly tactic" title="${t.name}">` +
                          `<span class="i">${t.icon}</span></span>`,
                  )
                  .join('')
            : '';
        const abilityHtml = options.sellAbility
            ? `<div class="inv-title">Enemy abilities</div>` +
              `<span class="inv-item readonly" title="Sell packs (unlocked)">` +
              `<span class="i">↩</span></span>`
            : '';
        this.enemyInventoryEl.innerHTML = itemHtml + tacticHtml + abilityHtml;
    }

    /** purchases used / allowed this round; buy buttons grey out at the limit.
     *  `extrasBudgetLeft` is the separate supply cap for shields/rockets. */
    setDeploys(used: number, limit: number, extrasBudgetLeft: number): void {
        this.deploysLeft = limit - used;
        this.extrasBudgetLeft = extrasBudgetLeft;
        const label = `${used}/${limit}`;
        if (this.deploysEl.textContent !== label) this.deploysEl.textContent = label;
        this.deploysEl.title =
            `Units bought this round / your limit · ◇ ${extrasBudgetLeft} left for shields & rockets`;
    }

    /** re-reads unit prices (they change while the recruit switch is active) */
    refreshCosts(): void {
        for (const { el, type } of this.buttons) {
            el.querySelector('.cost')!.textContent = String(this.costOf(type));
            if (type.extra) continue;
            const cost = this.costOf(type);
            const blocked = this.deploysLeft <= 0;
            const locked = !this.shopUnlocked.includes(type.id);
            el.classList.toggle(
                'unaffordable',
                cost > this.shopBalance || blocked || locked,
            );
        }
    }

    /** global level-up shortcut beside the extras row; hidden when nothing is ready */
    setLevelAllGlobal(info: { count: number; cost: number; affordable: boolean } | null): void {
        const key = info ? `${info.count}|${info.cost}|${info.affordable}` : '';
        if (key === this.lastLevelAllKey) return;
        this.lastLevelAllKey = key;
        if (!info) {
            this.levelAllGlobalBtn.style.display = 'none';
            return;
        }
        this.levelAllGlobalBtn.style.display = '';
        const label =
            info.count >= 2 ? `★ Level all (${info.count})` : '★ Level up';
        this.levelAllGlobalBtn.innerHTML =
            `<span class="title">${label}</span><span class="cost">${info.cost}</span>`;
        this.levelAllGlobalBtn.disabled = !info.affordable;
        this.levelAllGlobalBtn.classList.toggle('unaffordable', !info.affordable);
    }

    /** 3D-rendered thumbnails for shop tiles (generated once at match start). */
    setUnitIcons(icons: ReadonlyMap<string, string>): void {
        this.unitIcons = new Map(icons);
        for (const { el, type } of this.buttons) {
            const url = icons.get(type.id);
            const art = el.querySelector<HTMLElement>('.art');
            if (!url || !art) continue;
            art.style.backgroundImage = `url(${url})`;
        }
    }

    /** shows only unlocked units; the unlock slot appears when a pick is still available */
    updateShop(unlocked: readonly string[], unlockAvailable: boolean, balance: number): void {
        const key = `${unlocked.join(',')}|${unlockAvailable}|${balance}`;
        if (key === this.lastShopKey) return;
        this.lastShopKey = key;
        this.shopUnlocked = [...unlocked];
        this.shopUnlockAvailable = unlockAvailable;
        this.shopBalance = balance;

        // only reshuffle the grid when unlock order changes — appending every
        // frame (setSupply clears the cache) cancels in-flight unlock clicks
        const orderKey = unlocked.join(',');
        if (orderKey !== this.lastShopOrderKey) {
            this.lastShopOrderKey = orderKey;
            for (const id of unlocked) {
                const tile = this.shopUnitTiles.get(id);
                if (!tile) continue;
                tile.style.display = '';
                this.shopGrid.appendChild(tile);
            }
            for (const id of SHOP_UNIT_IDS) {
                if (unlocked.includes(id)) continue;
                const tile = this.shopUnitTiles.get(id);
                if (tile) tile.style.display = 'none';
            }
            this.shopGrid.appendChild(this.unlockTile);
        } else {
            for (const id of SHOP_UNIT_IDS) {
                const tile = this.shopUnitTiles.get(id);
                if (tile) tile.style.display = unlocked.includes(id) ? '' : 'none';
            }
        }
        const specialistChosen = unlocked.length > 0;
        const hasLocked = SHOP_UNIT_IDS.some((id) => !unlocked.includes(id));
        const showUnlock = specialistChosen && unlockAvailable && hasLocked;
        this.unlockTile.style.display = showUnlock ? '' : 'none';
        this.unlockTile.classList.toggle('available', showUnlock);
        this.refreshCosts();
        for (const { el, type } of this.buttons) {
            if (type.extra) continue;
            const cost = this.costOf(type);
            const blocked = this.deploysLeft <= 0;
            const locked = !unlocked.includes(type.id);
            el.classList.toggle('unaffordable', cost > balance || blocked || locked);
        }
    }

    private openUnlockPicker(): void {
        if (!this.shopUnlockAvailable || this.shopUnlocked.length === 0) return;
        const locked = SHOP_UNIT_IDS.filter((id) => !this.shopUnlocked.includes(id)).map((id) => {
            const type = UNIT_TYPES.find((t) => t.id === id)!;
            const cost = unitUnlockCost(id);
            return {
                id,
                name: type.name,
                cost,
                affordable: cost <= this.shopBalance,
            };
        });
        if (locked.length === 0) return;
        this.showUnlockPicker(locked);
    }

    /** pick which locked unit type to add to the shop this round */
    showUnlockPicker(
        options: readonly { id: string; name: string; cost: number; affordable: boolean }[],
    ): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Unlock a unit</div>` +
            `<div class="cards-row unlock-row">` +
            options
                .map((o) => {
                    const art = this.unitIcons.get(o.id);
                    const artStyle = art ? ` style="background-image:url(${art})"` : '';
                    const costLabel = o.cost > 0 ? String(o.cost) : 'Free';
                    return (
                        `<button class="shop-tile unlock-pick" data-unit="${o.id}"` +
                        `${o.affordable ? '' : ' disabled'}>` +
                        `<span class="title">${o.name}</span>` +
                        `<span class="art"${artStyle}></span>` +
                        `<span class="cost">${costLabel}</span>` +
                        `</button>`
                    );
                })
                .join('') +
            `</div>` +
            `<button class="cards-skip">Cancel</button>`;
        overlay.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.cards-skip')) {
                this.hideCardOverlay();
                return;
            }
            const button = target.closest<HTMLButtonElement>('.unlock-pick');
            if (!button?.dataset.unit || button.disabled) return;
            this.hideCardOverlay();
            this.onUnlockPick?.(button.dataset.unit);
        });
        this.showCardOverlay(overlay);
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

        // leveling sits at the top-right of the frame (next to the name);
        // everything else is a square tile in the bottom action row
        const levelTiles: ActionTile[] = [];
        const tiles: ActionTile[] = [];
        // a unit's Level Up shows only when a level is actually available
        // (XP banked); the level itself is always shown big in the header
        if (info.levelUp?.ready) {
            levelTiles.push({
                data: 'data-levelup="1"',
                icon: '🔼',
                title: 'Level Up',
                desc: 'Raise this pack one level — it gains its base HP and damage again. Costs banked XP plus supply.',
                cost: info.levelUp.cost,
                state: info.levelUp.affordable ? 'buy' : 'locked',
            });
            if (info.levelUp.all) {
                levelTiles.push({
                    data: 'data-levelall="1"',
                    icon: '⏫',
                    title: `Level All (${info.levelUp.all.count})`,
                    desc: 'Level every ready pack of this type at once.',
                    cost: info.levelUp.all.cost,
                    state: info.levelUp.all.affordable ? 'buy' : 'locked',
                });
            }
        }
        // a tower's upgrade is its leveling — same spot, same icon as a unit's
        if (info.towerUpgrade) {
            const tu = info.towerUpgrade;
            levelTiles.push({
                data: 'data-towerupgrade="1"',
                icon: '🔼',
                title: tu.maxed ? `Max level (${info.level})` : `Upgrade — level ${info.level + 1}`,
                desc: 'Raise this building one level: it gains its base HP. No XP needed, price rises each level.',
                cost: tu.maxed ? undefined : tu.cost,
                state: tu.maxed ? 'owned' : tu.affordable ? 'buy' : 'locked',
            });
        }
        if (info.sell) {
            tiles.push({
                data: 'data-sell="1"',
                icon: '💰',
                title: 'Sell Pack',
                desc: 'Sell this pack for a supply refund. Once per deployment phase.',
                cost: -info.sell.refund,
                state: info.sell.available ? 'buy' : 'locked',
                note: info.sell.available ? undefined : 'Already sold this round',
            });
        }
        for (const b of info.boosts ?? []) {
            tiles.push({
                data: `data-boost="${b.id}"`,
                icon: b.id === 'attack' ? '⚔️' : '🛡️',
                title: b.label,
                desc:
                    b.id === 'attack'
                        ? 'Permanent army-wide damage boost. Buy one tier after the other.'
                        : 'Permanent army-wide HP boost. Buy one tier after the other.',
                cost: b.cost,
                state: b.maxed ? 'owned' : b.affordable ? 'buy' : 'locked',
            });
        }
        if (info.recruit) {
            tiles.push({
                data: 'data-recruit="1"',
                icon: '2️⃣',
                title: 'Recruit at Level 2',
                desc: 'For the rest of this round, units you buy arrive at level 2 (they still pay the level premium).',
                cost: info.recruit.cost,
                state: info.recruit.active ? 'owned' : info.recruit.affordable ? 'buy' : 'locked',
            });
        }
        if (info.deploySlot) {
            tiles.push({
                data: 'data-deployslot="1"',
                icon: '➕',
                title: '+1 Deployment',
                desc: 'One extra unit purchase this round only.',
                cost: info.deploySlot.cost,
                state: info.deploySlot.active ? 'owned' : info.deploySlot.affordable ? 'buy' : 'locked',
            });
        }
        if (info.rangeBoost) {
            tiles.push({
                data: 'data-rangeboost="1"',
                icon: '🎯',
                title: 'Range Boost',
                desc: `+${info.rangeBoost.bonus} range for all ranged units, this round only.`,
                cost: info.rangeBoost.cost,
                state: info.rangeBoost.active ? 'owned' : info.rangeBoost.affordable ? 'buy' : 'locked',
            });
        }
        if (info.speedBoost) {
            tiles.push({
                data: 'data-speedboost="1"',
                icon: '💨',
                title: 'Speed Boost',
                desc: `+${info.speedBoost.bonus} speed for all units, this round only.`,
                cost: info.speedBoost.cost,
                state: info.speedBoost.active ? 'owned' : info.speedBoost.affordable ? 'buy' : 'locked',
            });
        }
        if (info.sellAbility) {
            tiles.push({
                data: 'data-sellability="1"',
                icon: '💰',
                title: 'Unlock Selling',
                desc: 'Permanently unlock selling packs (up to one per deployment phase).',
                cost: info.sellAbility.cost,
                state: info.sellAbility.owned ? 'owned' : info.sellAbility.affordable ? 'buy' : 'locked',
            });
        }
        for (const t of info.techs ?? []) {
            tiles.push({
                data: `data-tech="${t.id}"`,
                icon: t.icon,
                title: t.name,
                desc: t.desc,
                cost: t.cost,
                state: t.owned ? 'owned' : t.affordable ? 'buy' : 'locked',
            });
        }
        const actions = this.renderActionTiles(tiles);
        const levelActions = this.renderActionTiles(levelTiles, 'level-actions');
        const itemSquares = info.items?.length
            ? `<div class="item-row">${info.items
                  .map(
                      (i) =>
                          `<span class="item-sq" data-ttitle="${escapeAttr(i.name)}" data-tdesc="${escapeAttr(i.desc ?? i.name)}" data-ticon="${escapeAttr(i.icon)}">${i.icon}</span>`,
                  )
                  .join('')}</div>`
            : '';
        this.panel.innerHTML =
            `<div class="panel-head">` +
            `<div class="lvl-big"><span class="lvl-cap">LVL</span><span class="lvl-num">${info.level}</span></div>` +
            `<div class="head-main"><div class="title">${info.name}</div><div class="team ${info.team}">${info.team}</div></div>` +
            levelActions +
            `</div>` +
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
            actions +
            `<div class="action-info" style="display:none"></div>`;
    }

    /** one horizontal row of square action tiles (icons); hover shows details */
    private renderActionTiles(tiles: ActionTile[], containerClass = 'action-row'): string {
        if (tiles.length === 0) return '';
        return (
            `<div class="${containerClass}">` +
            tiles
                .map((t) => {
                    const badge =
                        t.state === 'owned'
                            ? `<span class="at-badge">✓</span>`
                            : t.cost !== undefined
                              ? `<span class="at-cost${t.cost < 0 ? ' refund' : ''}">${t.cost < 0 ? `+${-t.cost}` : t.cost}</span>`
                              : '';
                    return (
                        `<button class="action-tile ${t.state}" ${t.data}` +
                        ` data-ttitle="${escapeAttr(t.title)}" data-tdesc="${escapeAttr(t.desc)}"` +
                        ` data-ticon="${escapeAttr(t.icon)}" data-tcost="${t.cost ?? ''}"` +
                        ` data-tstate="${t.state}" data-tnote="${escapeAttr(t.note ?? '')}">` +
                        `<span class="at-icon">${t.icon}</span>${badge}</button>`
                    );
                })
                .join('') +
            `</div>`
        );
    }

    /** fills and positions the big hover frame from a focused tile's data */
    private showActionInfo(tile: HTMLElement): void {
        const frame = this.panel.querySelector<HTMLDivElement>('.action-info');
        if (!frame) return;
        const d = tile.dataset;
        const state = d.tstate;
        const cost = d.tcost;
        const costLine =
            state === 'owned'
                ? `<span class="ai-cost owned">✓ Owned</span>`
                : cost
                  ? `<span class="ai-cost${Number(cost) < 0 ? ' refund' : ''}">${Number(cost) < 0 ? `Refund +${-Number(cost)}` : `⬢ ${cost}`}</span>`
                  : '';
        const note = d.tnote ? `<div class="ai-note">${d.tnote}</div>` : '';
        frame.innerHTML =
            `<div class="ai-head"><span class="ai-icon">${d.ticon ?? ''}</span>` +
            `<span class="ai-title">${d.ttitle ?? ''}</span></div>` +
            `<div class="ai-desc">${d.tdesc ?? ''}</div>` +
            note +
            costLine;
        frame.style.display = 'block';
    }

    private hideActionInfo(): void {
        const frame = this.panel.querySelector<HTMLDivElement>('.action-info');
        if (frame) frame.style.display = 'none';
    }

    setPhase(round: number, phase: Phase, remainingSeconds: number, waitingForPeer = false): void {
        // round 0 is the specialist pick, not a numbered round
        this.roundEl.textContent = round === 0 ? 'Specialists' : `Round ${round}`;
        this.phaseEl.textContent = waitingForPeer
            ? 'Waiting for opponent…'
            : round === 0
              ? 'Pick a card'
              : phase === 'build'
                ? 'Deployment'
                : 'Battle';
        const s = Math.max(0, Math.ceil(remainingSeconds));
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.topBar.classList.toggle('battle', phase === 'battle');
        // last 5s of deployment — pulse so the player knows to hurry
        this.timerEl.classList.toggle(
            'urgent',
            phase === 'build' && !waitingForPeer && s > 0 && s <= 5,
        );
        // locked in: only spectating remains — no buying, no ending twice
        this.topBar.classList.toggle('waiting', waitingForPeer);
        this.fightBar.classList.toggle('battle', phase === 'battle');
        this.fightBar.classList.toggle('waiting', waitingForPeer);
        this.shopColumn.classList.toggle('disabled', phase !== 'build' || waitingForPeer);
        this.shopColumn.classList.toggle('battle', phase === 'battle');
        this.inventoryEl.classList.toggle('battle', phase === 'battle');
        this.enemyInventoryEl.classList.toggle('battle', phase === 'battle');
    }

    setSpeed(multiplier: number): void {
        this.speedEl.textContent = `${multiplier}×`;
    }

    setHp(player: number, enemy: number): void {
        if (player > this.playerMaxHp) this.playerMaxHp = player;
        if (enemy > this.enemyMaxHp) this.enemyMaxHp = enemy;
        const pPct = Math.max(0, (player / this.playerMaxHp) * 100);
        const ePct = Math.max(0, (enemy / this.enemyMaxHp) * 100);
        this.playerHpFill.style.width = `${pPct}%`;
        this.enemyHpFill.style.width = `${ePct}%`;
        this.playerHpVal.textContent = String(Math.max(0, Math.round(player)));
        this.enemyHpVal.textContent = String(Math.max(0, Math.round(enemy)));
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

    isPauseMenuOpen(): boolean {
        return this.pauseMenu !== null;
    }

    togglePauseMenu(): void {
        if (this.pauseMenu) this.hidePauseMenu();
        else this.showPauseMenu();
    }

    hidePauseMenu(): void {
        this.pauseMenu?.remove();
        this.pauseMenu = null;
    }

    /** dismisses the specialist or round-card picker if it is still open */
    hideCardOverlay(): void {
        this.cardOverlay?.remove();
        this.cardOverlay = null;
        // a card overlay (specialist pick, round card, reveal) blocks
        // deployment: no ending the round while one is up
        this.topBar.classList.remove('overlay-open');
    }

    /** dismisses the specialist reveal only: the two cards fly out to the
     *  commander frames (top corners), then the overlay is removed */
    dismissReveal(): void {
        const overlay = this.cardOverlay;
        if (!overlay?.classList.contains('reveal')) return;
        this.cardOverlay = null;
        this.topBar.classList.remove('overlay-open'); // deployment controls return
        overlay.classList.add('exiting');
        setTimeout(() => overlay.remove(), 600); // matches the exit transition
    }

    private showCardOverlay(overlay: HTMLDivElement): void {
        this.hideCardOverlay();
        this.cardOverlay = overlay;
        this.topBar.classList.add('overlay-open');
        this.mount(overlay);
    }

    private showPauseMenu(): void {
        this.hidePauseMenu();
        const el = document.createElement('div');
        el.className = 'mechili-pause';
        el.innerHTML =
            `<div class="pause-box">` +
            `<div class="pause-title">Menu</div>` +
            `<button type="button" class="pause-resume">Close</button>` +
            `<button type="button" class="pause-settings">Settings</button>` +
            `<button type="button" class="pause-quit">Quit to menu</button>` +
            `</div>`;
        el.querySelector('.pause-resume')!.addEventListener('click', () => this.hidePauseMenu());
        el.querySelector('.pause-settings')!.addEventListener('click', () => openSettings(this.overlayParent));
        el.querySelector('.pause-quit')!.addEventListener('click', () => {
            this.hidePauseMenu();
            this.onQuitToMenu?.();
        });
        this.pauseMenu = el;
        this.mount(el);
    }

    /** the face of a specialist card (static data only — safe for innerHTML) */
    private startCardFace(c: StartCard): string {
        return (
            `<div class="c-title">${c.title}</div>` +
            `<div class="c-units">${c.unitsLabel}</div>` +
            `<div class="c-hp">♥ ${c.startingHp} HP</div>` +
            `<div class="c-desc">${c.description}</div>`
        );
    }

    /** the pre-round-1 loadout pick: four cards, click one, the game begins */
    showStartCards(cards: readonly StartCard[], onPick: (cardId: string) => void): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Choose your specialist</div><div class="cards-row">` +
            cards
                .map((c) => `<button class="card" data-card="${c.id}">${this.startCardFace(c)}</button>`)
                .join('') +
            `</div>`;
        overlay.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card) return;
            this.hideCardOverlay();
            onPick(button.dataset.card);
        });
        this.showCardOverlay(overlay);
    }

    /** own specialist locked in, the peer still choosing: show the pick, wait */
    showWaitingCard(card: StartCard): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Waiting for opponent…</div>` +
            `<div class="cards-row"><div class="card static">${this.startCardFace(card)}</div></div>`;
        this.showCardOverlay(overlay);
    }

    /** both specialists picked: show them side by side for a moment, then the
     *  game auto-dismisses via {@link dismissReveal} and deployment takes over */
    showSpecialistReveal(
        own: StartCard,
        opponent: StartCard,
        names: { local: string; opponent: string },
    ): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards reveal';
        overlay.innerHTML =
            `<div class="cards-title">Specialists</div>` +
            `<div class="cards-row">` +
            `<div class="card-col player"><div class="c-owner player"></div><div class="card static">${this.startCardFace(own)}</div></div>` +
            `<div class="card-col enemy"><div class="c-owner enemy"></div><div class="card static">${this.startCardFace(opponent)}</div></div>` +
            `</div>`;
        // player names are user input — textContent only, never innerHTML
        const owners = overlay.querySelectorAll<HTMLDivElement>('.c-owner');
        owners[0]!.textContent = names.local;
        owners[1]!.textContent = names.opponent;
        this.showCardOverlay(overlay);
    }

    /** the chosen specialist cards (opponent's stays null until both picked) —
     *  sets the fighter-card labels and makes the frames clickable for detail */
    setSpecialities(own: StartCard | null, opponent: StartCard | null): void {
        this.playerCard = own;
        this.enemyCard = opponent;
        this.playerSpecEl.textContent = own?.title ?? '';
        this.enemySpecEl.textContent = opponent?.title ?? '';
        this.playerFighterEl.classList.toggle('has-spec', own !== null);
        this.enemyFighterEl.classList.toggle('has-spec', opponent !== null);
    }

    /** a dismissible popup of one side's specialist card (frame click or hover) */
    private showSpecialistDetail(team: 'player' | 'enemy'): void {
        const card = team === 'player' ? this.playerCard : this.enemyCard;
        if (!card) return;
        // avoid stacking duplicate overlays
        if (this.specDetailOverlay) this.specDetailOverlay.remove();
        const name = (team === 'player' ? this.playerNameEl : this.enemyNameEl).textContent ?? '';
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards detail';
        overlay.innerHTML =
            `<div class="cards-row"><div class="card-col ${team}">` +
            `<div class="c-owner ${team}"></div>` +
            `<div class="card static">${this.startCardFace(card)}</div>` +
            `</div></div>`;
        overlay.querySelector('.c-owner')!.textContent = name;
        overlay.addEventListener('click', () => this.hideSpecialistDetail());
        this.specDetailOverlay = overlay;
        this.mount(overlay);
    }

    /** dismiss the specialist detail popup (hover-out or click) */
    private hideSpecialistDetail(): void {
        if (this.specDetailOverlay) {
            this.specDetailOverlay.remove();
            this.specDetailOverlay = null;
        }
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
                this.hideCardOverlay();
                onPick(null);
                return;
            }
            const button = target.closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card || button.disabled) return;
            this.hideCardOverlay();
            onPick(button.dataset.card);
        });
        this.showCardOverlay(overlay);
    }

    private notice: HTMLDivElement | null = null;

    /** full-screen blocking notice (reconnect wait, resync); replaces any previous one */
    showNotice(text: string, buttonLabel?: string, onButton?: () => void): void {
        this.hideNotice();
        const el = document.createElement('div');
        el.className = 'mechili-cards'; // reuses the dimmed overlay styling
        el.innerHTML =
            `<div class="cards-title" style="font-size:20px; letter-spacing:2px;">${text}</div>` +
            (buttonLabel ? `<button class="cards-skip">${buttonLabel}</button>` : '');
        if (buttonLabel && onButton) {
            el.querySelector('.cards-skip')!.addEventListener('click', onButton);
        }
        this.notice = el;
        this.mount(el);
    }

    hideNotice(): void {
        this.notice?.remove();
        this.notice = null;
    }

    /** the peer connection died — nothing to do but return to the menu */
    showDisconnect(): void {
        const el = document.createElement('div');
        el.className = 'mechili-gameover draw';
        el.innerHTML = `<div class="go-title">DISCONNECTED</div><button class="go-restart">Back to main menu</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => this.onQuitToMenu?.());
        this.mount(el);
    }

    showGameOver(result: 'victory' | 'defeat' | 'draw'): void {
        const el = document.createElement('div');
        el.className = `mechili-gameover ${result}`;
        const title = result === 'victory' ? 'VICTORY' : result === 'defeat' ? 'DEFEAT' : 'DRAW';
        el.innerHTML = `<div class="go-title">${title}</div><button class="go-restart">Back to main menu</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => this.onQuitToMenu?.());
        this.mount(el);
    }

    setSupply(amount: number): void {
        this.supplyEl.textContent = String(amount);
        this.shopBalance = amount;
        this.lastShopKey = '';
        for (const { el, type } of this.buttons) {
            const cost = this.costOf(type);
            const blocked = type.extra ? cost > this.extrasBudgetLeft : this.deploysLeft <= 0;
            const locked = !type.extra && !this.shopUnlocked.includes(type.id);
            el.classList.toggle('unaffordable', cost > amount || blocked || locked);
        }
        if (this.shopUnlocked.length > 0 || this.shopUnlockAvailable) this.updateShop(
            this.shopUnlocked,
            this.shopUnlockAvailable,
            amount,
        );
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
        this.mountedRoots.push(el);
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

    /** removes every HUD element from the page / canvas mirror */
    destroy(): void {
        this.hidePauseMenu();
        this.hideCardOverlay();
        this.hideNotice();
        this.hideBattleReport();
        this.itemGhost?.remove();
        this.itemGhost = null;
        for (const { sprite } of this.sprites) {
            sprite.destroy();
        }
        this.sprites.length = 0;
        for (const el of this.mountedRoots) {
            el.remove();
        }
        this.mountedRoots.length = 0;
        window.removeEventListener('pointermove', this.onItemGhostMove, true);
        this.hudStyle.remove();
    }
}
