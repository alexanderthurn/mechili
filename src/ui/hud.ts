import { Sprite, type Application } from 'pixi.js';
import { HTMLSource } from 'pixi.js/html-source';
import { SHOP_UNIT_IDS, unitUnlockCost, type StartCard } from '../game/cards';
import { CHAT_TEXT_LIMIT, EMOTES, emoteById, type ChatItem } from '../game/emotes';
import { inputMode } from '../game/inputCapabilities';
import { onPrefsChange, prefs } from '../game/prefs';
import { UNIT_TYPES, type UnitType } from '../game/units';
import { openSettings } from './settings';
import { THEME, hudStyles } from '../theme';

export type Phase = 'build' | 'battle';

/** phone-size screens — MUST match the phone media query in theme.ts */
const PHONE_MQ =
    typeof matchMedia === 'function'
        ? matchMedia(
              '(pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 540px)',
          )
        : null;

/** escapes a string for safe use inside a double-quoted HTML attribute */
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '&#10;');
}

/** escapes a string for safe use as HTML text content */
function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function picksEqual(
    a: { round: number; title: string; body: string }[],
    b: { round: number; title: string; body: string }[],
): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        if (x.round !== y.round || x.title !== y.title || x.body !== y.body) return false;
    }
    return true;
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
    /** local perspective: drives team-color CSS */
    team: 'player' | 'enemy' | 'horde';
    /** display name of the owning player (e.g. "mangoo", "AI") */
    owner: string;
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
    /** buyable / inspectable techs (own packs always; enemy after intel fog lifts) */
    techs?: { id: string; name: string; desc: string; icon: string; cost: number; owned: boolean; affordable: boolean }[];
    /** base buildings render their level as N / maxLevel and hide XP */
    structure?: boolean;
    /** a base building's supply-only level upgrade (own, build phase) */
    towerUpgrade?: { cost: number; affordable: boolean; maxed: boolean; maxLevel: number };
    /** the once-per-round level-2 recruit switch (Research Center only) */
    recruit?: { cost: number; active: boolean; affordable: boolean };
    /** +1 deployment for the running round (Command Tower only) */
    deploySlot?: { cost: number; active: boolean; affordable: boolean };
    /** +range for all ranged units this round (Command Tower only) */
    rangeBoost?: { cost: number; bonus: number; active: boolean; affordable: boolean };
    /** +speed for all units this round (Command Tower only) */
    speedBoost?: { cost: number; bonus: number; active: boolean; affordable: boolean };
    /** Credit: +gain now, −debt next deployment (Command Tower only) */
    credit?: { gain: number; debt: number; active: boolean; affordable: boolean };
    /** the permanent sell-ability unlock (Research Center only) */
    sellAbility?: { cost: number; owned: boolean; affordable: boolean };
    /** one-time rally-route charge purchase (Research Center only) */
    rallyRouteAbility?: { cost: number; owned: boolean; affordable: boolean };
    /** permanent army-wide boost tracks (Research Center only); label shows the NEXT tier */
    boosts?: { id: 'attack' | 'hp'; label: string; cost: number; affordable: boolean; maxed: boolean }[];
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
    onBuyRallyRouteAbility: (() => void) | null = null;
    onBuyDeploySlot: (() => void) | null = null;
    onBuyRoundRangeBoost: (() => void) | null = null;
    onBuyRoundSpeedBoost: (() => void) | null = null;
    onBuyCredit: (() => void) | null = null;
    onBuyBoost: ((boost: 'attack' | 'hp') => void) | null = null;
    onArmItem: ((itemId: string, index: number) => void) | null = null;
    onArmTactic: ((tacticId: string, index: number) => void) | null = null;
    onCancelTactic: (() => void) | null = null;
    onResetPlacedTactic: ((tacticId: string, routeId: number) => void) | null = null;
    onUndo: (() => void) | null = null;
    /** opens/closes the pause menu (the ☰ button — Escape has no touch equivalent) */
    onMenuToggle: (() => void) | null = null;
    /** touch stand-in for middle-click: rotate the selected pack */
    onTouchRotate: (() => void) | null = null;
    /** the Move button: pick the selected pack up without moving it yet */
    onTouchPickUp: (() => void) | null = null;
    /** the player sent a chat item (emote or text) */
    onSendChat: ((item: ChatItem) => void) | null = null;
    onUnlockPick: ((typeId: string) => void) | null = null;
    onQuitToMenu: (() => void) | null = null;
    /** grant/revoke live deploy vision for a spectator (own seat) */
    onGrantSpectatorLive: ((name: string, grant: boolean) => void) | null = null;
    /** names of current spectators for the pause-menu grant toggles */
    spectatorNamesForMenu: (() => string[]) | null = null;
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
    private readonly endButton: HTMLButtonElement;
    private readonly supplyEl: HTMLSpanElement;
    private readonly playerNameEl: HTMLSpanElement;
    private readonly enemyNameEl: HTMLSpanElement;
    private playerSpecEl!: HTMLSpanElement;
    private enemySpecEl!: HTMLSpanElement;
    /** the chosen specialist card per side — drives the clickable frame detail */
    private playerCard: StartCard | null = null;
    private enemyCard: StartCard | null = null;
    /** between-round picks known for each side (enemy empty until intel reveals) */
    private playerRoundPicks: { round: number; title: string; body: string }[] = [];
    private enemyRoundPicks: { round: number; title: string; body: string }[] = [];
    private specDetailOverlay: HTMLDivElement | null = null;
    /** which commander's detail is open (so live pick updates can refresh it) */
    private specDetailTeam: 'player' | 'enemy' | null = null;
    private specDetailViaHover = false;
    private readonly playerHpFill: HTMLDivElement;
    private readonly enemyHpFill: HTMLDivElement;
    private readonly playerHpVal: HTMLSpanElement;
    private readonly enemyHpVal: HTMLSpanElement;
    private playerMaxHp = 1000;
    private enemyMaxHp = 1000;
    private readonly speedEl: HTMLButtonElement;
    private readonly undoEl: HTMLButtonElement;
    /** phone: always-visible undo + supply strip (top right, below the enemy card) */
    private phoneStatusEl!: HTMLDivElement;
    private phoneUndoEl!: HTMLButtonElement;
    private phoneSupplyEl!: HTMLSpanElement;
    private phoneMenuEl!: HTMLButtonElement;
    private phoneLevelAllEl!: HTMLButtonElement;
    private readonly levelAllGlobalBtn: HTMLButtonElement;
    private readonly deploysEl: HTMLSpanElement;
    private readonly inventoryEl: HTMLDivElement;
    private readonly enemyInventoryEl: HTMLDivElement;
    /** phone-size bottom tab bar; CSS hides it on larger screens */
    private readonly phoneBar: HTMLDivElement;
    private phoneTab: 'shop' | 'unit' | 'tactics' | 'chat' | null = null;
    /** contextual action buttons living inside the bottom bar (touch only) */
    private readonly touchRotateBtn: HTMLButtonElement;
    private readonly touchMoveBtn: HTMLButtonElement;
    private readonly touchLevelBtn: HTMLButtonElement;
    private readonly touchLevelAllBtn: HTMLButtonElement;
    private readonly touchUpgradeBtn: HTMLButtonElement;
    private lastTouchActKey = '';
    /** the tile whose info frame is open — touch taps that tile again to act */
    private actionInfoFor: HTMLElement | null = null;
    private itemGhost: HTMLDivElement | null = null;
    private lastInventoryKey = '';
    private lastEnemyInventoryKey = '';
    /** player inventory strip folded flat (titles only) when it wraps past one column */
    private inventoryCollapsed = false;
    /** enemy strip starts folded — usually crowded after cheats / long games */
    private enemyInventoryCollapsed = true;
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
            button.addEventListener('click', () => {
                onBuy(UNIT_TYPES[index]!);
                // phone sheet covers the field — close it so the ghost is placeable
                this.setPhoneTab(null);
            });
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
        const infoSel = '.action-tile, .item-sq';
        this.panel.addEventListener('click', (e) => {
            // touch has no hover: first tap peeks at the info, second tap acts
            if (inputMode() === 'touch') {
                const peek = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
                if (peek) {
                    if (this.actionInfoFor !== peek) {
                        this.showActionInfo(peek);
                        return;
                    }
                } else {
                    this.hideActionInfo();
                }
            }
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
            else if (button.dataset.rallyroute) this.onBuyRallyRouteAbility?.();
            else if (button.dataset.deployslot) this.onBuyDeploySlot?.();
            else if (button.dataset.rangeboost) this.onBuyRoundRangeBoost?.();
            else if (button.dataset.speedboost) this.onBuyRoundSpeedBoost?.();
            else if (button.dataset.credit) this.onBuyCredit?.();
            else if (button.dataset.boost) this.onBuyBoost?.(button.dataset.boost as 'attack' | 'hp');
            else if (button.dataset.tech) this.onBuyTech?.(button.dataset.tech);
        });
        // hovering a tile or equipped item pops the big info frame (mouse only —
        // touch would open it mid-tap and turn the first tap into a blind buy)
        this.panel.addEventListener('pointerover', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const tile = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            if (tile) this.showActionInfo(tile);
        });
        this.panel.addEventListener('pointerout', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const from = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.(infoSel);
            if (from && from !== to) this.hideActionInfo();
        });

        // unequipped pack items (left edge sidebar): click to pick up, click a pack to place
        this.inventoryEl = document.createElement('div');
        this.inventoryEl.className = 'mechili-sidebar left';
        this.inventoryEl.style.display = 'none';
        this.inventoryEl.addEventListener('click', (e) => {
            if (this.toggleSidebarCollapse(this.inventoryEl, 'player', e)) return;
            const itemBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.inv-item[data-item]');
            if (itemBtn?.dataset.item) {
                this.onArmItem?.(itemBtn.dataset.item, Number(itemBtn.dataset.index ?? -1));
                this.setPhoneTab(null); // aiming happens on the field
                return;
            }
            // touch: tapping a PLACED tactic frees it again (desktop right-clicks)
            if (inputMode() === 'touch') {
                const placedBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                    '.inv-item[data-tactic].placed',
                );
                if (placedBtn?.dataset.tactic && placedBtn.dataset.routeId) {
                    this.onResetPlacedTactic?.(
                        placedBtn.dataset.tactic,
                        Number(placedBtn.dataset.routeId),
                    );
                    return;
                }
            }
            const tacticBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                '.inv-item[data-tactic]:not(.placed)',
            );
            if (tacticBtn?.dataset.tactic) {
                this.onArmTactic?.(tacticBtn.dataset.tactic, Number(tacticBtn.dataset.index ?? -1));
                this.setPhoneTab(null);
            }
        });
        this.inventoryEl.addEventListener('contextmenu', (e) => {
            const tacticBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.inv-item[data-tactic]');
            if (!tacticBtn) return;
            e.preventDefault();
            const routeId = tacticBtn.dataset.routeId;
            if (routeId && tacticBtn.dataset.tactic) {
                this.onResetPlacedTactic?.(tacticBtn.dataset.tactic, Number(routeId));
            } else this.onCancelTactic?.();
        });

        // opponent items not yet placed (right edge; frozen to phase-start intel)
        this.enemyInventoryEl = document.createElement('div');
        this.enemyInventoryEl.className = 'mechili-sidebar right';
        this.enemyInventoryEl.style.display = 'none';
        this.enemyInventoryEl.addEventListener('click', (e) => {
            this.toggleSidebarCollapse(this.enemyInventoryEl, 'enemy', e);
        });
        // touch tooltip stand-ins: long-press a shop tile for its stats, a
        // tactic/item for its hint — and a PLACED tactic long-press resets it
        // (the touch version of the contextmenu handler above)
        this.attachLongPress(this.shopColumn, '.shop-tile', (tile) =>
            this.showTouchTooltip((tile as HTMLButtonElement).title),
        );
        this.attachLongPress(this.inventoryEl, '.inv-item', (btn) => {
            const routeId = btn.dataset.routeId;
            if (routeId && btn.dataset.tactic) {
                this.onResetPlacedTactic?.(btn.dataset.tactic, Number(routeId));
            } else {
                this.showTouchTooltip((btn as HTMLButtonElement).title);
            }
        });

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
        // hover only for real mice: on touch the emulated mouseenter mounts the
        // overlay mid-tap and the tap's click then instantly dismisses it
        playerFighter.addEventListener('click', () => this.showSpecialistDetail('player'));
        enemyFighter.addEventListener('click', () => this.showSpecialistDetail('enemy'));
        playerFighter.addEventListener('mouseenter', () => {
            if (inputMode() !== 'touch') this.showSpecialistDetail('player', true);
        });
        enemyFighter.addEventListener('mouseenter', () => {
            if (inputMode() !== 'touch') this.showSpecialistDetail('enemy', true);
        });
        // leave only closes hover peeks — a click-pinned detail stays put
        const closePeek = () => {
            if (inputMode() === 'touch') return;
            if (this.specDetailOverlay?.classList.contains('peek')) this.hideSpecialistDetail();
        };
        playerFighter.addEventListener('mouseleave', closePeek);
        enemyFighter.addEventListener('mouseleave', closePeek);

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
        this.endButton = endButton;
        this.speedEl = document.createElement('button');
        this.speedEl.className = 'speed';
        this.speedEl.textContent = '1×';
        this.speedEl.title = 'Battle speed — click: faster, right click: slower';
        this.speedEl.addEventListener('click', () => this.onSpeedUp?.());
        this.speedEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.onSpeedDown?.();
        });
        const controlsRow = document.createElement('div');
        controlsRow.className = 'top-controls';
        controlsRow.append(endButton, this.speedEl);
        this.topBar.append(topMeta, this.timerEl, controlsRow);

        this.fightBar.append(playerFighter, this.topBar, enemyFighter);

        // one contextual bottom bar: sheet tabs (Shop/Tactics — phone only)
        // while nothing is selected, unit actions once something is
        this.phoneBar = document.createElement('div');
        this.phoneBar.className = 'mechili-phonebar';
        const phoneTabs: ['shop' | 'unit' | 'tactics' | 'chat', string, string][] = [
            ['shop', '⬢', 'Shop'],
            ['unit', '⚔', 'Unit'],
            ['tactics', '✨', 'Tactics'],
            ['chat', '💬', 'Chat'],
        ];
        for (const [tab, icon, label] of phoneTabs) {
            const button = document.createElement('button');
            button.className = `pb-tab pb-${tab}`;
            button.innerHTML = `<span class="pb-ico">${icon}</span><span class="pb-label">${label}</span>`;
            button.addEventListener('click', () =>
                this.setPhoneTab(this.phoneTab === tab ? null : tab),
            );
            this.phoneBar.append(button);
        }
        // contextual field actions, shown only when they would work — same
        // icon-over-label structure as the tabs
        this.touchLevelBtn = document.createElement('button');
        this.touchLevelBtn.className = 'ta-btn ta-level';
        this.touchLevelBtn.addEventListener('click', () => this.onBuyLevel?.());
        this.touchLevelAllBtn = document.createElement('button');
        this.touchLevelAllBtn.className = 'ta-btn ta-levelall';
        this.touchLevelAllBtn.addEventListener('click', () => this.onLevelAll?.());
        this.touchUpgradeBtn = document.createElement('button');
        this.touchUpgradeBtn.className = 'ta-btn ta-upgrade';
        this.touchUpgradeBtn.addEventListener('click', () => this.onUpgradeTower?.());
        this.touchMoveBtn = document.createElement('button');
        this.touchMoveBtn.className = 'ta-btn ta-move';
        this.touchMoveBtn.innerHTML = `<span class="pb-ico">✥</span><span class="pb-label">Move</span>`;
        this.touchMoveBtn.addEventListener('click', () => this.onTouchPickUp?.());
        this.touchRotateBtn = document.createElement('button');
        this.touchRotateBtn.className = 'ta-btn ta-rotate';
        this.touchRotateBtn.innerHTML = `<span class="pb-ico">⟳</span><span class="pb-label">Rotate</span>`;
        this.touchRotateBtn.addEventListener('click', () => this.onTouchRotate?.());
        for (const btn of [
            this.touchLevelBtn,
            this.touchLevelAllBtn,
            this.touchUpgradeBtn,
            this.touchMoveBtn,
            this.touchRotateBtn,
        ]) {
            btn.style.display = 'none';
            this.phoneBar.append(btn);
        }

        // top-right stack under the enemy card: the ☰ menu on every device,
        // plus money/undo/level-all on phone (their shop toolbar is in a sheet)
        this.phoneStatusEl = document.createElement('div');
        this.phoneStatusEl.className = 'mechili-phone-status';
        this.phoneUndoEl = document.createElement('button');
        this.phoneUndoEl.className = 'undo';
        this.phoneUndoEl.textContent = '↩ Undo';
        this.phoneUndoEl.addEventListener('click', () => this.onUndo?.());
        const phoneSupplyFrame = document.createElement('div');
        phoneSupplyFrame.className = 'mechili-supply';
        this.phoneSupplyEl = document.createElement('span');
        this.phoneSupplyEl.className = 'supply';
        phoneSupplyFrame.append(this.phoneSupplyEl);
        this.phoneLevelAllEl = document.createElement('button');
        this.phoneLevelAllEl.className = 'level-all-global';
        this.phoneLevelAllEl.style.display = 'none';
        this.phoneLevelAllEl.title = 'Level up every ready pack on the field';
        this.phoneLevelAllEl.addEventListener('click', () => this.onLevelAllGlobal?.());
        // menu sits at the top of the strip, directly under the enemy card —
        // far away from End Deployment (the topbar twin hides on phone)
        this.phoneMenuEl = document.createElement('button');
        this.phoneMenuEl.className = 'mechili-phone-menu';
        this.phoneMenuEl.textContent = '☰';
        this.phoneMenuEl.title = 'Menu (Esc)';
        this.phoneMenuEl.addEventListener('click', () => this.onMenuToggle?.());
        this.phoneStatusEl.append(
            this.phoneMenuEl,
            phoneSupplyFrame,
            this.phoneUndoEl,
            this.phoneLevelAllEl,
        );

        this.mount(this.shopColumn);
        this.mount(this.fightBar);
        this.mount(this.panel);
        this.mount(this.phoneBar);
        this.mount(this.phoneStatusEl);
        this.buildChatBar();
    }

    /**
     * Delegated long-press for touch (≈450ms still press). Fires `cb` with the
     * matched descendant and swallows the click that would follow, so a
     * long-press never also buys/arms.
     */
    private attachLongPress(
        root: HTMLElement,
        selector: string,
        cb: (target: HTMLElement) => void,
    ): void {
        let timer = 0;
        let fired = false;
        let sx = 0;
        let sy = 0;
        root.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            const target = (e.target as HTMLElement).closest<HTMLElement>(selector);
            if (!target) return;
            fired = false;
            sx = e.clientX;
            sy = e.clientY;
            timer = window.setTimeout(() => {
                fired = true;
                cb(target);
            }, 450);
        });
        const cancel = () => window.clearTimeout(timer);
        root.addEventListener('pointermove', (e) => {
            if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
        });
        root.addEventListener('pointerup', cancel);
        root.addEventListener('pointercancel', cancel);
        root.addEventListener(
            'click',
            (e) => {
                if (!fired) return;
                fired = false;
                e.stopPropagation();
                e.preventDefault();
            },
            true, // capture: swallow before the tile's own click handler
        );
    }

    /** floating text card for touch (tooltip stand-in); tap anywhere dismisses */
    private showTouchTooltip(text: string): void {
        document.querySelector('.mechili-touchtip')?.remove();
        if (!text) return;
        const el = document.createElement('div');
        el.className = 'mechili-touchtip';
        el.textContent = text;
        document.body.appendChild(el);
        const dismiss = () => {
            el.remove();
            window.removeEventListener('pointerdown', dismiss, true);
        };
        // defer: the long-press finger lift must not instantly dismiss it
        setTimeout(() => window.addEventListener('pointerdown', dismiss, true), 50);
    }

    /** contextual touch field-action buttons in the bottom bar (coarse pointers only, via CSS) */
    setTouchActions(opts: {
        rotate: boolean;
        /** shows the Move button (enter carry mode without moving yet) */
        move?: boolean;
        /** something rides the finger — the Unit-details tab makes way */
        carrying?: boolean;
        levelUp?: { cost: number; affordable: boolean } | null;
        levelAll?: { count: number; cost: number; affordable: boolean } | null;
        /** base-building upgrade (Research Center etc.) */
        upgrade?: { cost: number; affordable: boolean } | null;
    }): void {
        const { rotate, move, carrying } = opts;
        // tablet (coarse but not phone-size): the details panel is visible and
        // already offers level/upgrade tiles — the bar only covers what touch
        // cannot do otherwise (move/rotate), as a compact pill
        const phone = PHONE_MQ?.matches ?? false;
        const levelUp = phone ? opts.levelUp : null;
        const levelAll = phone ? opts.levelAll : null;
        const upgrade = phone ? opts.upgrade : null;
        const key = `${phone}|${JSON.stringify(opts)}`;
        if (key === this.lastTouchActKey) return;
        this.lastTouchActKey = key;
        // 'acting' lets tablets (no tab UI) show the bar just for these buttons
        this.phoneBar.classList.toggle(
            'acting',
            rotate || !!move || !!levelUp || !!levelAll || !!upgrade,
        );
        this.phoneBar.classList.toggle('carrying', !!carrying);
        this.touchRotateBtn.style.display = rotate ? 'flex' : 'none';
        this.touchMoveBtn.style.display = move ? 'flex' : 'none';
        this.touchLevelBtn.style.display = levelUp ? 'flex' : 'none';
        if (levelUp) {
            this.touchLevelBtn.innerHTML =
                `<span class="pb-ico">🔼</span>` +
                `<span class="pb-label">Level ⬢ ${levelUp.cost}</span>`;
            this.touchLevelBtn.classList.toggle('disabled', !levelUp.affordable);
        }
        this.touchLevelAllBtn.style.display = levelAll ? 'flex' : 'none';
        if (levelAll) {
            this.touchLevelAllBtn.innerHTML =
                `<span class="pb-ico">⏫</span>` +
                `<span class="pb-label">All ×${levelAll.count} ⬢ ${levelAll.cost}</span>`;
            this.touchLevelAllBtn.classList.toggle('disabled', !levelAll.affordable);
        }
        this.touchUpgradeBtn.style.display = upgrade ? 'flex' : 'none';
        if (upgrade) {
            this.touchUpgradeBtn.innerHTML =
                `<span class="pb-ico">🏰</span>` +
                `<span class="pb-label">Upgrade ⬢ ${upgrade.cost}</span>`;
            this.touchUpgradeBtn.classList.toggle('disabled', !upgrade.affordable);
        }
    }

    /** opens the Unit details sheet (auto-shown for buildings); phone-only visual */
    openUnitDetails(): void {
        this.setPhoneTab('unit');
    }

    /** opens one phone bottom sheet (or none); a no-op visually on desktop */
    private setPhoneTab(tab: 'shop' | 'unit' | 'tactics' | 'chat' | null): void {
        // the chat's expanded state is shared with desktop hover — only touch
        // the 'open' flag on actual chat-tab transitions (phone-only states)
        if (tab === 'chat') this.chatBar.classList.add('open');
        else if (this.phoneTab === 'chat') this.chatBar.classList.remove('open');
        this.phoneTab = tab;
        this.shopColumn.classList.toggle('phone-open', tab === 'shop');
        this.panel.classList.toggle('phone-open', tab === 'unit');
        this.inventoryEl.classList.toggle('phone-open', tab === 'tactics');
        this.chatBar.classList.toggle('phone-open', tab === 'chat');
        this.phoneBar.querySelector('.pb-shop')?.classList.toggle('active', tab === 'shop');
        this.phoneBar.querySelector('.pb-unit')?.classList.toggle('active', tab === 'unit');
        this.phoneBar.querySelector('.pb-tactics')?.classList.toggle('active', tab === 'tactics');
        this.phoneBar.querySelector('.pb-chat')?.classList.toggle('active', tab === 'chat');
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
        const openChat = (focus: boolean) => {
            if (bar.classList.contains('open')) return;
            bar.classList.add('open');
            if (focus) this.chatInput.focus();
        };
        const strip = bar.querySelector('.c-strip')!;
        strip.addEventListener('click', () => openChat(true));
        strip.addEventListener('pointerenter', () => openChat(false));
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
                // phone: closing the chat also releases its bar tab
                if (this.phoneTab === 'chat') this.setPhoneTab(null);
            }
        };
        document.addEventListener('pointerdown', onDocPointer);

        // "show combat chat" hides the whole thing, live; the listener
        // detaches itself once this HUD is torn down
        const applyVisibility = () => {
            const show = prefs().combatChat;
            bar.style.display = show ? '' : 'none';
            this.chatFloat.style.display = show ? '' : 'none';
            // the phone bar's Chat tab mirrors the pref
            this.phoneBar.classList.toggle('has-chat', show);
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

    /** the undo buttons only show while there is something to undo */
    setUndoVisible(visible: boolean): void {
        // '' lets the battle-phase CSS rule keep hiding it during battles
        this.undoEl.style.display = visible ? '' : 'none';
        // same for the phone twin: '' falls back to the phone-only CSS rules
        this.phoneUndoEl.style.display = visible ? '' : 'none';
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
            /** rounds of cooldown (shown as a corner badge) */
            cooldown?: number;
            /** overrides the default click/right-click tooltip line */
            hint?: string;
            index: number;
        }[] = [],
    ): void {
        const key = JSON.stringify({ items, tactics });
        if (key === this.lastInventoryKey) return;
        this.lastInventoryKey = key;
        const visible = items.length > 0 || tactics.length > 0;
        this.inventoryEl.style.display = visible ? '' : 'none';
        this.phoneBar.classList.toggle('has-tactics', visible);
        if (!visible && this.phoneTab === 'tactics') this.setPhoneTab(null);
        const total = items.length + tactics.length;
        const itemHtml = items.length
            ? this.invSectionTitle('Items', items.length, total) +
              items
                  .map(
                      (i, index) =>
                          `<button class="inv-item${i.armed ? ' armed' : ''}" data-item="${i.id}" data-index="${index}" title="${i.name}\nClick to pick up, then click one of your packs.">` +
                          `<span class="i">${i.icon}</span></button>`,
                  )
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? this.invSectionTitle('Tactics', tactics.length, total) +
              tactics
                  .map((t) => {
                      const routeAttr = t.routeId !== undefined ? ` data-route-id="${t.routeId}"` : '';
                      const cls =
                          `inv-item tactic` +
                          (t.placed ? ' placed' : '') +
                          (t.armed ? ' armed' : '');
                      const baseHint =
                          t.hint ??
                          (t.placed
                              ? `${t.name}\nRight-click to clear and place again.`
                              : `${t.name}\nClick to place on the map. Right-click to cancel.`);
                      const cdLine =
                          t.cooldown === undefined
                              ? ''
                              : t.cooldown <= 0
                                ? '\nNo cooldown.'
                                : `\n${t.cooldown} round${t.cooldown === 1 ? '' : 's'} cooldown.`;
                      const hint = baseHint + cdLine;
                      const cd =
                          t.cooldown !== undefined
                              ? `<span class="inv-cd" title="${
                                    t.cooldown <= 0
                                        ? 'No cooldown'
                                        : `${t.cooldown} round${t.cooldown === 1 ? '' : 's'} cooldown`
                                }">${t.cooldown}</span>`
                              : '';
                      return (
                          `<button class="${cls}" data-tactic="${t.id}" data-index="${t.index}"${routeAttr} title="${escapeAttr(hint)}">` +
                          `<span class="i">${t.icon}</span>${cd}</button>`
                      );
                  })
                  .join('')
            : '';
        this.inventoryEl.innerHTML = itemHtml + tacticHtml;
        this.inventoryEl.classList.toggle('folded', this.inventoryCollapsed);
        this.scheduleSidebarCollapseUi(this.inventoryEl, 'player');
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
        const total = items.length + tactics.length + (options.sellAbility ? 1 : 0);
        const itemHtml = items.length
            ? this.invSectionTitle('Enemy items', items.length, total) +
              items
                  .map(
                      (i) =>
                          `<span class="inv-item readonly" title="${i.name}">` +
                          `<span class="i">${i.icon}</span></span>`,
                  )
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? this.invSectionTitle('Enemy tactics', tactics.length, total) +
              tactics
                  .map(
                      (t) =>
                          `<span class="inv-item readonly tactic" title="${t.name}">` +
                          `<span class="i">${t.icon}</span></span>`,
                  )
                  .join('')
            : '';
        const abilityHtml = options.sellAbility
            ? this.invSectionTitle('Enemy abilities', 1, total) +
              `<span class="inv-item readonly" title="Sell packs (unlocked)">` +
              `<span class="i">↩</span></span>`
            : '';
        this.enemyInventoryEl.innerHTML = itemHtml + tacticHtml + abilityHtml;
        this.enemyInventoryEl.classList.toggle('folded', this.enemyInventoryCollapsed);
        this.scheduleSidebarCollapseUi(this.enemyInventoryEl, 'enemy');
    }

    private invSectionTitle(label: string, count: number, total: number): string {
        return (
            `<button type="button" class="inv-title" data-inv-toggle="1"` +
            ` title="Collapse inventory (${total})">` +
            `<span class="inv-title-label">${escapeHtml(label)}</span>` +
            `<span class="inv-title-meta"><span class="inv-count">${count}</span>` +
            `<span class="inv-chevron" aria-hidden="true"></span></span></button>`
        );
    }

    /** click any section header to fold or expand that sidebar strip */
    private toggleSidebarCollapse(
        el: HTMLElement,
        side: 'player' | 'enemy',
        e: MouseEvent,
    ): boolean {
        const title = (e.target as HTMLElement).closest<HTMLElement>('.inv-title[data-inv-toggle]');
        if (!title || !el.contains(title)) return false;
        const collapsed =
            side === 'player' ? this.inventoryCollapsed : this.enemyInventoryCollapsed;
        if (!el.classList.contains('can-collapse') && !collapsed) return false;
        e.preventDefault();
        if (side === 'player') {
            this.inventoryCollapsed = !this.inventoryCollapsed;
            el.classList.toggle('folded', this.inventoryCollapsed);
        } else {
            this.enemyInventoryCollapsed = !this.enemyInventoryCollapsed;
            el.classList.toggle('folded', this.enemyInventoryCollapsed);
        }
        this.refreshSidebarCollapseUi(el, side);
        return true;
    }

    private scheduleSidebarCollapseUi(el: HTMLElement, side: 'player' | 'enemy'): void {
        requestAnimationFrame(() => this.refreshSidebarCollapseUi(el, side));
    }

    /**
     * Collapse affordance when tiles wrap past one column/row — or when already
     * folded so it can reopen. Enemy defaults folded, so it stays clickable.
     */
    private refreshSidebarCollapseUi(el: HTMLElement, side: 'player' | 'enemy'): void {
        if (el.style.display === 'none') {
            el.classList.remove('can-collapse');
            return;
        }
        const collapsed =
            side === 'player' ? this.inventoryCollapsed : this.enemyInventoryCollapsed;
        const can = collapsed || this.inventoryStripWrapped(el);
        el.classList.toggle('can-collapse', can);
        const tip = collapsed ? 'Expand inventory' : 'Collapse inventory';
        for (const title of el.querySelectorAll<HTMLButtonElement>('.inv-title[data-inv-toggle]')) {
            title.tabIndex = can ? 0 : -1;
            title.title = tip;
        }
    }

    private inventoryStripWrapped(el: HTMLElement): boolean {
        const tiles = [...el.querySelectorAll<HTMLElement>('.inv-item')];
        if (tiles.length < 2) return false;
        // while folded, tiles are hidden — treat as still wrappable so expand stays available
        if (el.classList.contains('folded')) return true;
        const rowDir = getComputedStyle(el).flexDirection.startsWith('row');
        const first = tiles[0]!;
        return tiles.some((t) =>
            rowDir
                ? Math.abs(t.offsetTop - first.offsetTop) > 2
                : Math.abs(t.offsetLeft - first.offsetLeft) > 2,
        );
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
            this.phoneLevelAllEl.style.display = 'none';
            return;
        }
        const label =
            info.count >= 2 ? `★ Level all (${info.count})` : '★ Level up';
        const html = `<span class="title">${label}</span><span class="cost">${info.cost}</span>`;
        // the shop-toolbar button and its phone twin (top-right strip) mirror each other
        for (const btn of [this.levelAllGlobalBtn, this.phoneLevelAllEl]) {
            btn.style.display = '';
            btn.innerHTML = html;
            btn.disabled = !info.affordable;
            btn.classList.toggle('unaffordable', !info.affordable);
        }
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
            const unlockCost = unitUnlockCost(id);
            return {
                id,
                name: type.name,
                unlockCost,
                deployCost: this.costOf(type),
                affordable: unlockCost <= this.shopBalance,
            };
        });
        if (locked.length === 0) return;
        this.showUnlockPicker(locked);
    }

    private unlockTierLabel(unlockCost: number): string {
        return String(unlockCost);
    }

    private renderUnlockPickTile(
        o: { id: string; name: string; deployCost: number; affordable: boolean },
    ): string {
        const art = this.unitIcons.get(o.id);
        const artStyle = art ? ` style="background-image:url(${art})"` : '';
        return (
            `<button class="shop-tile unlock-pick" data-unit="${o.id}"` +
            `${o.affordable ? '' : ' disabled'}>` +
            `<span class="title">${escapeAttr(o.name)}</span>` +
            `<span class="art"${artStyle}></span>` +
            `<span class="cost">${o.deployCost}</span>` +
            `</button>`
        );
    }

    /** pick which locked unit type to add to the shop this round */
    showUnlockPicker(
        options: readonly {
            id: string;
            name: string;
            unlockCost: number;
            deployCost: number;
            affordable: boolean;
        }[],
    ): void {
        const tiers = new Map<number, typeof options[number][]>();
        for (const option of options) {
            const group = tiers.get(option.unlockCost) ?? [];
            group.push(option);
            tiers.set(option.unlockCost, group);
        }
        const tierCosts = [...tiers.keys()].sort((a, b) => a - b);
        const tierHtml = tierCosts
            .map((unlockCost) => {
                const units = tiers.get(unlockCost)!;
                return (
                    `<section class="unlock-tier">` +
                    `<div class="unlock-tier-head">${this.unlockTierLabel(unlockCost)}</div>` +
                    `<div class="cards-row unlock-row">` +
                    units.map((o) => this.renderUnlockPickTile(o)).join('') +
                    `</div></section>`
                );
            })
            .join('');

        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards unlock-dialog';
        overlay.innerHTML =
            `<div class="cards-title">Unlock a unit</div>` +
            `<div class="unlock-picker">` +
            tierHtml +
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
        this.phoneBar.classList.toggle('has-unit', !!info);
        if (!info) {
            this.panel.style.display = 'none';
            this.lastPanelKey = '';
            if (this.phoneTab === 'unit') this.setPhoneTab(null);
            return;
        }
        this.panel.style.display = 'block';
        const key = JSON.stringify(info);
        if (key === this.lastPanelKey) return; // unchanged: keep the DOM stable
        this.lastPanelKey = key;
        this.actionInfoFor = null; // rebuilt DOM: stale peek references would misfire
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
        if (info.credit) {
            tiles.push({
                data: 'data-credit="1"',
                icon: '💳',
                title: 'Credit',
                desc: `+${info.credit.gain} supply now. Next deployment: −${info.credit.debt}. Once per round.`,
                state: info.credit.active ? 'owned' : info.credit.affordable ? 'buy' : 'locked',
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
        if (info.rallyRouteAbility) {
            tiles.push({
                data: 'data-rallyroute="1"',
                icon: '⚑',
                title: 'Buy Rally Route',
                desc: 'Add one rally-route charge to your tactics. Once per match.',
                cost: info.rallyRouteAbility.cost,
                state: info.rallyRouteAbility.owned
                    ? 'owned'
                    : info.rallyRouteAbility.affordable
                      ? 'buy'
                      : 'locked',
            });
        }
        for (const t of info.techs ?? []) {
            tiles.push({
                data: `data-tech="${t.id}"`,
                icon: t.icon,
                title: t.name,
                desc: t.desc,
                cost: t.owned || info.team === 'player' ? t.cost : undefined,
                note: !t.owned && info.team === 'enemy' ? 'Not purchased' : undefined,
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
        // XP (or tower level) progress toward the next rank
        const xpBarPct = info.structure
            ? info.towerUpgrade
                ? (info.level / info.towerUpgrade.maxLevel) * 100
                : 100
            : info.xpNext < 0
              ? 100
              : Math.max(0, Math.min(100, (info.xp / info.xpNext) * 100));
        const levelLabel = info.structure
            ? `${info.level}${info.towerUpgrade ? ` / ${info.towerUpgrade.maxLevel}` : ''}`
            : info.xpNext < 0
              ? 'max'
              : `${Math.round(info.xp)}/${Math.round(info.xpNext)} XP`;
        this.panel.innerHTML =
            `<div class="panel-head">` +
            `<div class="lvl-big"><span class="lvl-cap">LVL</span><span class="lvl-num">${info.level}</span></div>` +
            `<div class="head-main">` +
            `<div class="xpbar ${info.team}"><div style="width:${xpBarPct}%"></div></div>` +
            `<div class="head-names"><span class="title">${escapeHtml(info.name)}</span><span class="team ${info.team}">${escapeHtml(info.owner)}</span></div>` +
            `</div>` +
            levelActions +
            `</div>` +
            itemSquares +
            row('HP', `${Math.max(0, Math.round(info.hp))} / ${Math.round(info.maxHp)}`) +
            (info.total > 1 ? row('Pack', `${info.alive} / ${info.total}`) : '') +
            row('Level', levelLabel) +
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
        const touchBuy =
            inputMode() === 'touch' && state === 'buy'
                ? `<button type="button" class="ai-buy">Buy${cost ? ` · ⬢ ${cost}` : ''}</button>`
                : '';
        frame.innerHTML =
            `<div class="ai-head"><span class="ai-icon">${d.ticon ?? ''}</span>` +
            `<span class="ai-title">${d.ttitle ?? ''}</span></div>` +
            `<div class="ai-desc">${d.tdesc ?? ''}</div>` +
            note +
            costLine +
            touchBuy;
        frame.style.display = 'block';
        this.actionInfoFor = tile;
        frame.querySelector<HTMLButtonElement>('.ai-buy')?.addEventListener('click', (e) => {
            e.stopPropagation();
            // while actionInfoFor === tile, the delegated handler treats this
            // as the confirming second tap and performs the buy
            tile.click();
            this.hideActionInfo();
        });
    }

    private hideActionInfo(): void {
        const frame = this.panel.querySelector<HTMLDivElement>('.action-info');
        if (frame) frame.style.display = 'none';
        this.actionInfoFor = null;
    }

    setPhase(
        round: number,
        phase: Phase,
        remainingSeconds: number,
        waitingForPeer = false,
        allyLockedIn = false,
        selfLockedIn = false,
    ): void {
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
        // teammate (same side, team modes) has already locked in but I
        // haven't yet — a visible cue on the button itself, since I still
        // see the normal button (my side isn't "waiting" until I click too)
        this.endButton.classList.toggle('ally-ready', allyLockedIn && !waitingForPeer);
        // the mirror case: I've locked in but my side isn't ready yet (ally
        // hasn't) — waitingForPeer only fires once the WHOLE side is ready,
        // so without this I'd see no feedback between my click and theirs
        this.endButton.classList.toggle('self-ready', selfLockedIn && !waitingForPeer);
        this.endButton.disabled = selfLockedIn && !waitingForPeer;
        this.endButton.textContent =
            selfLockedIn && !waitingForPeer ? 'Waiting for Ally…' : 'End Deployment';
        this.endButton.title =
            allyLockedIn && !waitingForPeer
                ? 'Your ally is ready — waiting on you'
                : selfLockedIn && !waitingForPeer
                  ? "You're locked in — waiting on your ally"
                  : '';
        this.fightBar.classList.toggle('battle', phase === 'battle');
        this.fightBar.classList.toggle('waiting', waitingForPeer);
        this.shopColumn.classList.toggle('disabled', phase !== 'build' || waitingForPeer);
        this.shopColumn.classList.toggle('battle', phase === 'battle');
        this.inventoryEl.classList.toggle('battle', phase === 'battle');
        this.enemyInventoryEl.classList.toggle('battle', phase === 'battle');
        this.phoneBar.classList.toggle('battle', phase === 'battle');
        this.phoneStatusEl.classList.toggle('battle', phase === 'battle');
        // battle: the chat leaves the bar and becomes the normal floating bar
        this.chatBar.classList.toggle('battle', phase === 'battle');
        if (phase === 'battle' && (this.phoneTab === 'shop' || this.phoneTab === 'chat')) {
            this.setPhoneTab(null);
        }
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

    /**
     * Full-screen overlays (card picks, pause) own the screen: the phone tab
     * bar and field-action buttons step aside. The topbar keeps its original
     * cards-only rule (a card pick blocks End Deployment; pause does not).
     */
    private syncOverlayOpen(): void {
        const open = this.cardOverlay !== null || this.pauseMenu !== null;
        this.topBar.classList.toggle('overlay-open', this.cardOverlay !== null);
        this.phoneBar.classList.toggle('overlay-open', open);
        this.phoneStatusEl.classList.toggle('overlay-open', open);
    }

    hidePauseMenu(): void {
        this.pauseMenu?.remove();
        this.pauseMenu = null;
        this.syncOverlayOpen();
    }

    /** dismisses the specialist or round-card picker if it is still open */
    hideCardOverlay(): void {
        this.cardOverlay?.remove();
        this.cardOverlay = null;
        // a card overlay (specialist pick, round card, reveal) blocks
        // deployment: no ending the round while one is up
        this.syncOverlayOpen();
    }

    /** dismisses the specialist reveal only: the two cards fly out to the
     *  commander frames (top corners), then the overlay is removed */
    dismissReveal(): void {
        const overlay = this.cardOverlay;
        if (!overlay?.classList.contains('reveal')) return;
        this.cardOverlay = null;
        this.syncOverlayOpen(); // deployment controls return
        overlay.classList.add('exiting');
        setTimeout(() => overlay.remove(), 600); // matches the exit transition
    }

    private showCardOverlay(overlay: HTMLDivElement): void {
        this.hideCardOverlay();
        // phone: an open sheet (e.g. the shop behind the unlock picker) would
        // show through the overlay's dim layer — close it first
        this.setPhoneTab(null);
        this.cardOverlay = overlay;
        this.syncOverlayOpen();
        this.mount(overlay);
    }

    private showPauseMenu(): void {
        this.hidePauseMenu();
        const el = document.createElement('div');
        el.className = 'mechili-pause';
        const spectators = this.spectatorNamesForMenu?.() ?? [];
        const spectateHtml =
            spectators.length === 0
                ? ''
                : `<div class="pause-spectators">` +
                  `<div class="pause-subtitle">Spectators — share my deploy live</div>` +
                  spectators
                      .map(
                          (name) =>
                              `<label class="pause-spectate-row">` +
                              `<input type="checkbox" data-spectate-name="${escapeAttr(name)}" />` +
                              `<span>${escapeHtml(name)}</span>` +
                              `</label>`,
                      )
                      .join('') +
                  `</div>`;
        el.innerHTML =
            `<div class="pause-box">` +
            `<div class="pause-title">Menu</div>` +
            `<button type="button" class="pause-resume">Continue</button>` +
            `<button type="button" class="pause-settings">Settings</button>` +
            spectateHtml +
            `<button type="button" class="pause-quit">Quit to menu</button>` +
            `</div>`;
        el.querySelector('.pause-resume')!.addEventListener('click', () => this.hidePauseMenu());
        el.querySelector('.pause-settings')!.addEventListener('click', () => openSettings(this.overlayParent));
        el.querySelector('.pause-quit')!.addEventListener('click', () => {
            this.hidePauseMenu();
            this.onQuitToMenu?.();
        });
        for (const input of el.querySelectorAll<HTMLInputElement>('input[data-spectate-name]')) {
            input.addEventListener('change', () => {
                const name = input.dataset.spectateName;
                if (name) this.onGrantSpectatorLive?.(name, input.checked);
            });
        }
        this.pauseMenu = el;
        this.syncOverlayOpen();
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

    /**
     * Between-round card history for the commander detail popup.
     * Pass an empty enemy list while deploy fog still hides their picks.
     */
    setRoundCardPicks(
        own: { round: number; title: string; body: string }[],
        enemy: { round: number; title: string; body: string }[],
    ): void {
        const same =
            picksEqual(this.playerRoundPicks, own) && picksEqual(this.enemyRoundPicks, enemy);
        if (same) return;
        this.playerRoundPicks = own;
        this.enemyRoundPicks = enemy;
        if (this.specDetailTeam) {
            this.showSpecialistDetail(this.specDetailTeam, this.specDetailViaHover);
        }
    }

    /** a dismissible popup of one side's specialist card (frame click or hover) */
    private showSpecialistDetail(team: 'player' | 'enemy', viaHover = false): void {
        const card = team === 'player' ? this.playerCard : this.enemyCard;
        const picks = team === 'player' ? this.playerRoundPicks : this.enemyRoundPicks;
        if (!card && picks.length === 0) return;
        // avoid stacking duplicate overlays
        if (this.specDetailOverlay) this.specDetailOverlay.remove();
        const name = (team === 'player' ? this.playerNameEl : this.enemyNameEl).textContent ?? '';
        const overlay = document.createElement('div');
        // hover peeks are pointer-transparent: a full-screen overlay under the
        // cursor would instantly fire mouseleave on the fighter card and the
        // detail would flicker open/closed forever
        overlay.className = `mechili-cards detail${viaHover ? ' peek' : ''}`;
        const specHtml = card
            ? `<div class="card static">${this.startCardFace(card)}</div>`
            : '';
        const picksHtml =
            picks.length === 0
                ? ''
                : `<div class="round-picks">` +
                  `<div class="round-picks-title">Round cards</div>` +
                  picks
                      .map(
                          (p) =>
                              `<div class="round-pick">` +
                              `<span class="rp-round">R${p.round}</span>` +
                              `<span class="rp-title">${escapeHtml(p.title)}</span>` +
                              (p.body
                                  ? `<span class="rp-body">${escapeHtml(p.body)}</span>`
                                  : '') +
                              `</div>`,
                      )
                      .join('') +
                  `</div>`;
        overlay.innerHTML =
            `<div class="cards-row"><div class="card-col ${team}">` +
            `<div class="c-owner ${team}"></div>` +
            specHtml +
            picksHtml +
            `</div></div>`;
        overlay.querySelector('.c-owner')!.textContent = name;
        overlay.addEventListener('click', () => this.hideSpecialistDetail());
        this.specDetailOverlay = overlay;
        this.specDetailTeam = team;
        this.specDetailViaHover = viaHover;
        // the enemy's unplaced items are intel that belongs to this screen
        this.enemyInventoryEl.classList.toggle('reveal', team === 'enemy');
        this.mount(overlay);
    }

    /** dismiss the specialist detail popup (hover-out or click) */
    private hideSpecialistDetail(): void {
        if (this.specDetailOverlay) {
            this.specDetailOverlay.remove();
            this.specDetailOverlay = null;
        }
        this.specDetailTeam = null;
        this.specDetailViaHover = false;
        this.enemyInventoryEl.classList.remove('reveal');
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

    private reconnectWait: HTMLDivElement | null = null;

    /** connection lost: blocking notice with a live countdown to forfeit */
    showReconnectWait(onGiveUp: () => void): void {
        this.hideNotice();
        this.reconnectWait?.remove();
        const el = document.createElement('div');
        el.className = 'mechili-cards';
        el.innerHTML =
            `<div class="cards-title" style="font-size:20px; letter-spacing:2px;">Connection lost — reconnecting…</div>` +
            `<div class="cards-title reconnect-timer"></div>` +
            `<button class="cards-skip">Give up</button>`;
        el.querySelector('.cards-skip')!.addEventListener('click', onGiveUp);
        this.reconnectWait = el;
        this.mount(el);
    }

    /** ticks the reconnect countdown — pulses in the last 5s, same as the round timer */
    updateReconnectWait(secondsRemaining: number): void {
        const el = this.reconnectWait?.querySelector<HTMLDivElement>('.reconnect-timer');
        if (!el) return;
        const s = Math.max(0, Math.ceil(secondsRemaining));
        el.textContent = `Opponent has ${s}s to return`;
        el.classList.toggle('urgent', s <= 5);
    }

    hideReconnectWait(): void {
        this.reconnectWait?.remove();
        this.reconnectWait = null;
    }

    /** the grace window elapsed with no reconnect — we win by forfeit */
    showForfeitWin(): void {
        this.hideReconnectWait();
        const el = document.createElement('div');
        el.className = 'mechili-gameover victory';
        el.innerHTML =
            `<div class="go-title">VICTORY</div>` +
            `<div class="go-sub">Opponent disconnected</div>` +
            `<button class="go-restart">Back to main menu</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => this.onQuitToMenu?.());
        this.mount(el);
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
        this.phoneSupplyEl.textContent = String(amount);
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
