import type { Application } from 'pixi.js';
import { SHOP_UNIT_IDS, type RoundCard, type StartCard } from '../game/cards';
import { DISPLAY } from '../game/displayNames';
import {
    forgeHelpRows,
    forgeIngredientIcons,
    forgeRecipeMatch,
    type ForgeSpellPool,
} from '../game/forgeRecipes';
import { BASE_RUNE_IDS, ITEMS } from '../game/items';
import { CHAT_TEXT_LIMIT, EMOTES, emoteById, type ChatItem } from '../game/emotes';
import { inputMode } from '../game/inputCapabilities';
import { onPrefsChange, prefs } from '../game/prefs';
import type { SettingGroup } from '../game/settings';
import { TACTICS } from '../game/tactics';
import { UNIT_TYPES, isPlayerBuyable, unitUnlockCost, type UnitType } from '../game/units';
import { closeSettings, openSettings } from './settings';
import { ChatBar } from './chatBar';
import { ChatFloat } from './chatFloat';
import { iconHtml, applyIcon, cssUrl, iconCss, iconMaskCss, moneyHtml, moneyIconHtml } from './iconAtlas';
import { CardSpellTips, spellInfoFrameHtml, startCardFaceHtml } from './cardSpellTip';
import { roundCardFaceHtml } from './roundCardFace';
import { speedKeyHint } from './speedKeys';
import { THEME, hudStyles } from '../theme';

export type Phase = 'build' | 'battle' | 'hpDraw';

type CommanderChip = {
    seat: number;
    team: 'player' | 'enemy';
    cardEl: HTMLDivElement;
    portraitEl: HTMLDivElement;
    name: string;
    card: StartCard | null;
    /** custom player face — preferred over specialist atlas icon when set */
    avatar: string | null;
};

/** Compact / phone chrome — MUST match the size media query in theme.ts */
const PHONE_MQ =
    typeof matchMedia === 'function'
        ? matchMedia('(max-width: 599px), (max-height: 540px)')
        : null;

export function isCompactChrome(): boolean {
    return PHONE_MQ?.matches ?? false;
}

/** Shared permanent HUD stylesheet — refreshed per match for team colors, never removed. */
let sharedHudStyle: HTMLStyleElement | null = null;

function ensureHudStyleSheet(): void {
    if (!sharedHudStyle) {
        sharedHudStyle = document.createElement('style');
        document.head.appendChild(sharedHudStyle);
    }
    sharedHudStyle.textContent = hudStyles();
}

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
    /** what layers this unit can attack — shown as the first stat row */
    hits: string;
    hp: number;
    maxHp: number;
    damage: number;
    range: number;
    /** minimum engagement range (dead zone); shown as "min - max". Absent = none. */
    minRange?: number;
    speed: number;
    /** seconds between shots (tech-resolved) */
    attackInterval: number;
    /** area-damage radius; absent = single target */
    splash?: number;
    /** living/total mechs of the pack (1/1 for single mechs and towers) */
    alive: number;
    total: number;
    /** equipped pack items, as squares in the panel */
    items?: {
        icon: string;
        name: string;
        desc: string;
        id?: string;
        /** this-deploy only — drag off to return to bag */
        removable?: boolean;
    }[];
    /** live pack id — needed to unequip a rune from the details panel */
    unitId?: number;
    /** empty item slots accept an armed inventory item (own pack, build phase) */
    itemDropReady?: boolean;
    /** how many item circles to show (per unit type; empty pads unused) */
    itemSlotCount?: number;
    /**
     * Shared Stronghold forge oven. Present only when a Stronghold is selected —
     * runes forge into a spell or advanced rune next deploy.
     */
    forge?: {
        slotCount: number;
        dropReady: boolean;
        /** predicted burn outcome for the current tray */
        hint: string;
        /**
         * When the oven is empty: spells craftable from the player's bag,
         * shown in the empty slot circles — click fills all needed runes.
         */
        suggestions?: {
            tacticId: string;
            icon: string;
            name: string;
            desc: string;
            itemIds: string[];
        }[];
        /** spell that would bake from the current tray (if any) */
        bake?: {
            icon: string;
            name: string;
            desc: string;
            ingredientIcons?: string[];
        };
        /** tactic ids this side's specialists unlock */
        spellPool?: string[];
        /** parallel to slotCount; null = empty */
        slots: ({
            icon: string;
            name: string;
            desc: string;
            id: string;
            removable?: boolean;
        } | null)[];
    };
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
    /** buyable / inspectable tech slots (length = that unit's slot limit; empty = unused) */
    techs?: (
        | { empty: true }
        | {
              empty?: false;
              id: string;
              name: string;
              desc: string;
              icon: string;
              cost: number;
              owned: boolean;
              affordable: boolean;
              /**
               * Live produce-tech cycle (battle). `progress` is 0..1 toward the
               * next spawn; shown as a circular ring on the tech icon.
               */
              produce?: {
                  progress: number;
                  released: number;
                  max: number;
                  done: boolean;
              };
          }
    )[];
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
    movePackAbility?: { cost: number; owned: boolean; affordable: boolean };
    /** permanent army-wide boost tracks (Research Center only); label shows the NEXT tier */
    boosts?: { id: 'attack' | 'hp'; label: string; cost: number; affordable: boolean; maxed: boolean }[];
    /** gift supply to your ally (Stronghold only, team modes) */
    /** ally supply gift (Stronghold, duo+); shown whenever the building is selected */
    sendSupply?: { amount: number; affordable: boolean };
}

/**
 * HUD built from real HTML: deployment shop (bottom-right), unit inspector
 * (bottom-left), item sidebars, and the round/phase top bar — mounted as a
 * DOM overlay above the three.js / Pixi canvases.
 */
export class Hud {
    onEndDeployment: (() => void) | null = null;
    onSpeedUp: (() => void) | null = null;
    onSpeedDown: (() => void) | null = null;
    onBuyTech: ((techId: string) => void) | null = null;
    /** a tech tile gained/lost hover (or touch-peek) focus — id, or null on leave */
    onTechHover: ((techId: string | null) => void) | null = null;
    onBuyLevel: (() => void) | null = null;
    onLevelAll: (() => void) | null = null;
    onLevelAllGlobal: (() => void) | null = null;
    onRecruitLevel: (() => void) | null = null;
    onUpgradeTower: (() => void) | null = null;
    onBuySellAbility: (() => void) | null = null;
    onBuyRallyRouteAbility: (() => void) | null = null;
    onBuyMovePackAbility: (() => void) | null = null;
    /**
     * Shop unlock fee as THIS seat pays it (Countess Chonk discounts giants).
     * Game overwrites it with a seat-aware pricer; the raw fee is the fallback
     * so the picker never shows a price the dispatcher would reject.
     */
    unlockCostOf: (typeId: string) => number = (typeId) => unitUnlockCost(typeId);
    onBuyDeploySlot: (() => void) | null = null;
    onBuyRoundRangeBoost: (() => void) | null = null;
    onBuyRoundSpeedBoost: (() => void) | null = null;
    onBuyCredit: (() => void) | null = null;
    onBuyBoost: ((boost: 'attack' | 'hp') => void) | null = null;
    /** team modes only: gift supply to your ally, delivered at the start of next round */
    onSendSupply: ((amount: number) => void) | null = null;
    /** pick up a pack item for placement onto a unit (press / drag) */
    onArmItem: ((itemId: string, index: number) => void) | null = null;
    /** drop the armed inventory item onto the selected pack (panel empty slots) */
    onApplyArmedItem: (() => void) | null = null;
    /** clear armed rune/spell (e.g. when starting a pack unequip drag) */
    onCancelInventoryArm: (() => void) | null = null;
    /** drag a this-deploy rune off the pack details slot back into the bag */
    onRemoveItem: ((unitId: number, itemId: string, slot: number) => void) | null = null;
    /** drag/click a this-deploy forge rune back to the inserter's bag */
    onRemoveForge: ((slot: number, itemId: string) => void) | null = null;
    /** empty-forge spell suggestion: place all recipe runes at once */
    onForgeFill: ((itemIds: string[]) => void) | null = null;
    /** while dragging a rune/spell from the strip — keep world hover in sync */
    onInventoryDragMove: ((clientX: number, clientY: number) => void) | null = null;
    /**
     * End of a strip press-drag. `moved` is true when the pointer left the
     * click-slop — then a miss cancels the arm; a short click stays armed.
     */
    onInventoryDragEnd:
        | ((info: {
              clientX: number;
              clientY: number;
              moved: boolean;
              target: Element | null;
          }) => void)
        | null = null;
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
    /** shop: buy a always-available base rune (shares the unit buy limit) */
    onBuyRune: ((itemId: string) => boolean) | null = null;
    onQuitToMenu: (() => void) | null = null;
    /** grant/revoke live deploy vision for a spectator (own seat). Left null
     *  by a spectating client itself — it has no seat to grant from, so the
     *  badge list below renders plain names with no checkboxes. */
    onGrantSpectatorLive: ((name: string, grant: boolean) => void) | null = null;
    private readonly spectatorBadgeEl: HTMLButtonElement;
    private spectatorListEl: HTMLDivElement | null = null;
    private lastSpectatorNames: string[] = [];
    private pauseMenu: HTMLDivElement | null = null;
    private cardOverlay: HTMLDivElement | null = null;
    private cardIntroFading = false;
    private introChromeHidden = false;
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
    private readonly playerStackEl: HTMLDivElement;
    private readonly enemyStackEl: HTMLDivElement;
    private commanderChips: CommanderChip[] = [];
    private playerSpecEl: HTMLSpanElement | null = null;
    private enemySpecEl: HTMLSpanElement | null = null;
    private humanSeat = 0;
    private readonly topBar: HTMLDivElement;
    private readonly panel: HTMLDivElement;
    private readonly roundEl: HTMLSpanElement;
    private readonly timerEl: HTMLSpanElement;
    private readonly endButton: HTMLButtonElement;
    private readonly supplyEl: HTMLSpanElement;
    private readonly supplyAmtEl: HTMLSpanElement;
    private phoneSupplyAmtEl!: HTMLSpanElement;
    /** last painted balance — setSupply runs every frame; avoid rewriting the chip DOM */
    private supplyAmountShown: number | null = null;
    /** between-round picks known for each side (enemy empty until intel reveals) */
    private playerRoundPicks: { round: number; title: string; body: string }[] = [];
    private enemyRoundPicks: { round: number; title: string; body: string }[] = [];
    private specDetailOverlay: HTMLDivElement | null = null;
    /** which commander's detail is open (so live pick updates can refresh it) */
    private specDetailSeat: number | null = null;
    private specDetailViaHover = false;
    /** this match's settings, described for the click-to-open panel — set once via setSettingsGroups */
    private settingsGroups: SettingGroup[] = [];
    private settingsDetailOverlay: HTMLDivElement | null = null;
    /** hover tip for forge spells on specialist / round cards */
    private readonly cardSpellTips = new CardSpellTips();
    /** item ids currently in the selected Stronghold forge (for slot hover preview) */
    private lastForgeOvenIds: string[] = [];
    private lastForgeSpellPool: string[] = [];
    /** bag rune/item ids (human) — with oven, drives owned-ingredient marks */
    private lastBagItemIds: string[] = [];
    private lastForgeOvenKey = '';
    /** enemy bag + forge (intel / live) for opponent specialist recipe panel */
    private lastEnemyBagItemIds: string[] = [];
    private lastEnemyForgeOvenIds: string[] = [];
    private lastEnemyForgeKey = '';
    private playerHpFill!: HTMLDivElement;
    private enemyHpFill!: HTMLDivElement;
    private playerHpVal!: HTMLSpanElement;
    private enemyHpVal!: HTMLSpanElement;
    private playerMaxHp = 0;
    private enemyMaxHp = 0;
    /** last painted fill ratios / labels — setHp runs every tick */
    private lastHpFillP = Number.NaN;
    private lastHpFillE = Number.NaN;
    private lastHpValP = Number.NaN;
    private lastHpValE = Number.NaN;
    /** skip remounting specialist peek when content is unchanged */
    private lastSpecDetailKey = '';
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
    private readonly shopRuneRow: HTMLDivElement;
    private readonly shopRuneButtons: { el: HTMLButtonElement; itemId: string }[] = [];
    private shopRuneCost = 50;
    private shopRuneBalance = 0;
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
    /**
     * Selection key we already auto-opened (or the user dismissed) for the
     * unit sheet — prevents reopening every frame / after a manual close.
     */
    private unitSheetAutoKey: string | null = null;
    /** the tile whose info frame is open — touch taps that tile again to act */
    private actionInfoFor: HTMLElement | null = null;
    private itemGhost: HTMLDivElement | null = null;
    /** press-drag from the left inventory strip (runes / spells) */
    private invDrag: {
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
    } | null = null;
    /** press-drag a this-deploy rune off a pack details slot */
    private unequipDrag: {
        pointerId: number;
        startX: number;
        startY: number;
        moved: boolean;
        unitId: number;
        itemId: string;
        slot: number;
        icon: string;
        /** pack rune vs Stronghold forge oven */
        kind: 'pack' | 'forge';
    } | null = null;

    private readonly onInvDragMove = (e: PointerEvent) => {
        if (!this.invDrag || e.pointerId !== this.invDrag.pointerId) return;
        if (
            !this.invDrag.moved &&
            Math.hypot(e.clientX - this.invDrag.startX, e.clientY - this.invDrag.startY) > 6
        ) {
            this.invDrag.moved = true;
        }
        this.onInventoryDragMove?.(e.clientX, e.clientY);
        // panel empty slots light up while hovering during a press-drag
        const under = this.elementUnderDrag(e.clientX, e.clientY);
        this.setPanelItemDropReady(!!under?.closest?.('.item-sq.empty'));
    };

    private readonly onInvDragEnd = (e: PointerEvent) => {
        if (!this.invDrag || e.pointerId !== this.invDrag.pointerId) return;
        if (e.type === 'pointerup' && e.button !== 0) return;
        const drag = this.invDrag;
        this.clearInvDragListeners();
        this.invDrag = null;
        const target = this.elementUnderDrag(e.clientX, e.clientY);
        this.setPanelItemDropReady(false);
        this.onInventoryDragEnd?.({
            clientX: e.clientX,
            clientY: e.clientY,
            moved: drag.moved,
            target,
        });
    };

    private readonly onUnequipDragMove = (e: PointerEvent) => {
        if (!this.unequipDrag || e.pointerId !== this.unequipDrag.pointerId) return;
        if (
            !this.unequipDrag.moved &&
            Math.hypot(e.clientX - this.unequipDrag.startX, e.clientY - this.unequipDrag.startY) > 6
        ) {
            this.unequipDrag.moved = true;
            this.ensureUnequipGhost(this.unequipDrag.icon, e.clientX, e.clientY);
        }
        if (this.itemGhost && this.unequipDrag.moved) {
            this.itemGhost.style.left = `${e.clientX - 20}px`;
            this.itemGhost.style.top = `${e.clientY - 20}px`;
        }
    };

    private readonly onUnequipDragEnd = (e: PointerEvent) => {
        if (!this.unequipDrag || e.pointerId !== this.unequipDrag.pointerId) return;
        if (e.type === 'pointerup' && e.button !== 0) return;
        const drag = this.unequipDrag;
        this.clearUnequipDragListeners();
        this.unequipDrag = null;
        this.clearUnequipGhost();
        // touch: short tap only peeks the tooltip — remove via drag-off
        // desktop: click or drag-off removes (release on same slot after a drag cancels)
        if (!drag.moved) {
            if (e.pointerType === 'touch' || inputMode() === 'touch') return;
        } else {
            const under = this.elementUnderDrag(e.clientX, e.clientY);
            const backOnSame =
                under?.closest?.<HTMLElement>('.item-sq.removable')?.dataset.itemSlot ===
                String(drag.slot);
            if (backOnSame) return;
        }
        if (drag.kind === 'forge') this.onRemoveForge?.(drag.slot, drag.itemId);
        else this.onRemoveItem?.(drag.unitId, drag.itemId, drag.slot);
    };

    /** hit-test under the cursor, ignoring the floating rune/spell ghost */
    private elementUnderDrag(clientX: number, clientY: number): Element | null {
        const ghost = this.itemGhost;
        const prev = ghost?.style.pointerEvents;
        if (ghost) ghost.style.pointerEvents = 'none';
        const el = document.elementFromPoint(clientX, clientY);
        if (ghost) ghost.style.pointerEvents = prev || '';
        return el;
    }

    private clearInvDragListeners(): void {
        window.removeEventListener('pointermove', this.onInvDragMove, true);
        window.removeEventListener('pointerup', this.onInvDragEnd, true);
        window.removeEventListener('pointercancel', this.onInvDragEnd, true);
    }

    private clearUnequipDragListeners(): void {
        window.removeEventListener('pointermove', this.onUnequipDragMove, true);
        window.removeEventListener('pointerup', this.onUnequipDragEnd, true);
        window.removeEventListener('pointercancel', this.onUnequipDragEnd, true);
    }

    private ensureUnequipGhost(icon: string, clientX: number, clientY: number): void {
        if (!this.itemGhost) {
            this.itemGhost = document.createElement('div');
            this.itemGhost.className = 'inv-drag m-icon';
            document.body.appendChild(this.itemGhost);
        }
        this.itemGhost.className = 'inv-drag m-icon unequipping';
        applyIcon(this.itemGhost, icon);
        this.itemGhost.style.left = `${clientX - 20}px`;
        this.itemGhost.style.top = `${clientY - 20}px`;
    }

    private clearUnequipGhost(): void {
        if (!this.itemGhost?.classList.contains('unequipping')) return;
        this.itemGhost.remove();
        this.itemGhost = null;
    }
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
    /** every HUD root passed through mount() — needed for teardown */
    private readonly mountedRoots: HTMLElement[] = [];
    /** cinema / screenshot mode — all chrome hidden except the exit hint */
    private uiHidden = false;
    private cinemaHint: HTMLDivElement | null = null;
    private cinemaHintTimer: number | null = null;
    private readonly overlayParent: HTMLElement;
    private readonly onItemGhostMove = (e: PointerEvent) => {
        if (!this.itemGhost) return;
        this.itemGhost.style.left = `${e.clientX - 20}px`;
        this.itemGhost.style.top = `${e.clientY - 20}px`;
        if (this.forgeSlotPreviewAnchor === this.itemGhost) {
            this.positionForgeSlotHoverPreview();
        }
    };

    private beginInvDrag(_btn: HTMLElement, e: PointerEvent): void {
        this.clearUnequipDragListeners();
        this.unequipDrag = null;
        this.clearUnequipGhost();
        this.clearInvDragListeners();
        this.invDrag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
        };
        // window capture — survives inventory strip re-render when the item arms
        window.addEventListener('pointermove', this.onInvDragMove, true);
        window.addEventListener('pointerup', this.onInvDragEnd, true);
        window.addEventListener('pointercancel', this.onInvDragEnd, true);
        this.onInventoryDragMove?.(e.clientX, e.clientY);
    }

    private beginUnequipDrag(
        e: PointerEvent,
        info: {
            unitId: number;
            itemId: string;
            slot: number;
            icon: string;
            kind: 'pack' | 'forge';
        },
    ): void {
        this.clearInvDragListeners();
        this.invDrag = null;
        this.onCancelInventoryArm?.();
        this.clearUnequipDragListeners();
        this.unequipDrag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            ...info,
        };
        window.addEventListener('pointermove', this.onUnequipDragMove, true);
        window.addEventListener('pointerup', this.onUnequipDragEnd, true);
        window.addEventListener('pointercancel', this.onUnequipDragEnd, true);
    }

    constructor(
        _app: Application,
        overlayParent: HTMLElement,
        costOf: (type: UnitType) => number,
        onBuy: (type: UnitType) => boolean,
    ) {
        this.overlayParent = overlayParent;
        this.costOf = costOf;

        // Permanent shared sheet (also seeded from menu boot) — refresh team
        // colors for this match, never tear down so orphans stay laid out.
        ensureHudStyleSheet();

        const shopUnits = UNIT_TYPES.filter((t) => !t.extra && isPlayerBuyable(t));
        const extraTypes = UNIT_TYPES.filter((t) => t.extra && isPlayerBuyable(t));

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
                `${mechs > 1 ? `${mechs} units, ` : ''}${type.hp} HP each · hits ${hits}\n` +
                `damage ${type.damage}${type.splashRadius ? ` (splash ${type.splashRadius})` : ''}` +
                ` every ${type.attackInterval}s · range ${type.range} · speed ${type.speed}`;
            button.addEventListener('click', () => {
                const bought = UNIT_TYPES[index]!;
                // extras need the field for the place-ghost; regular packs only
                // dismiss the sheet when this buy fills the last deploy slot
                const lastSlot = !bought.extra && this.deploysLeft <= 1;
                if (onBuy(bought) && (bought.extra || lastSlot)) this.setPhoneTab(null);
            });
            this.buttons.push({ el: button, type });
            return button;
        };

        // deployment shop column (bottom-right): undo on top, extras+level row, unit shop
        this.shopColumn = document.createElement('div');
        this.shopColumn.className = 'mechili-shop-col';

        this.undoEl = document.createElement('button');
        this.undoEl.className = 'undo';
        this.undoEl.innerHTML = `${iconHtml('ui-undo', 'btn-ico mask-ico')} Undo`;
        this.undoEl.title = 'Revert your last action this round — click again for the one before';
        this.undoEl.addEventListener('click', () => this.onUndo?.());

        this.supplyFrame = document.createElement('div');
        this.supplyFrame.className = 'mechili-supply clickable';
        this.supplyFrame.title = 'Match settings';
        this.supplyEl = document.createElement('span');
        this.supplyEl.className = 'supply';
        this.supplyEl.insertAdjacentHTML('afterbegin', moneyIconHtml('supply-ico'));
        this.supplyAmtEl = document.createElement('span');
        this.supplyAmtEl.className = 'supply-amt';
        this.supplyEl.append(this.supplyAmtEl);
        this.supplyFrame.append(this.supplyEl);
        this.supplyFrame.addEventListener('click', () => this.showSettingsDetail());

        const shopToolbar = document.createElement('div');
        shopToolbar.className = 'shop-toolbar';
        shopToolbar.append(this.undoEl, this.supplyFrame);

        this.levelAllGlobalBtn = document.createElement('button');
        this.levelAllGlobalBtn.className = 'level-all-global';
        this.levelAllGlobalBtn.style.display = 'none';
        this.levelAllGlobalBtn.title = 'Level up every ready pack on the field';
        this.levelAllGlobalBtn.addEventListener('click', () => this.onLevelAllGlobal?.());

        this.extrasRow = document.createElement('div');
        this.extrasRow.className = 'mechili-extras';
        // LTR: level-all, then board extras (any count) toward the shop edge
        this.extrasRow.append(this.levelAllGlobalBtn);
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
        this.deploysEl.title = 'Purchases this round / your limit (units + base runes)';
        this.deploysEl.innerHTML =
            `${iconHtml('ui-settings', 'btn-ico mask-ico')}<span class="unit-cap-label"></span>`;
        this.shopRuneRow = document.createElement('div');
        this.shopRuneRow.className = 'shop-runes';
        for (const itemId of BASE_RUNE_IDS) {
            const def = ITEMS[itemId]!;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'shop-rune';
            btn.dataset.itemId = itemId;
            btn.innerHTML =
                `${iconHtml(def.icon, 'shop-rune-ico')}` +
                `<span class="cost">${this.shopRuneCost}</span>`;
            this.writeRuneTip(btn, itemId);
            btn.addEventListener('click', () => {
                if (btn.classList.contains('unaffordable')) return;
                const lastSlot = this.deploysLeft <= 1;
                if (this.onBuyRune?.(itemId) && lastSlot) this.setPhoneTab(null);
            });
            this.shopRuneButtons.push({ el: btn, itemId });
            this.shopRuneRow.appendChild(btn);
        }
        this.bindCardSpellTips(this.shopRuneRow);
        shopHeader.append(this.deploysEl, this.shopRuneRow);

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
        this.panel.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const rem = (e.target as HTMLElement).closest<HTMLElement>('.item-sq.removable');
            if (!rem?.dataset.itemId || rem.dataset.itemSlot === undefined) {
                return;
            }
            const kind = rem.dataset.forge !== undefined ? 'forge' : 'pack';
            if (kind === 'pack' && !rem.dataset.unitId) return;
            e.preventDefault();
            this.beginUnequipDrag(e, {
                unitId: Number(rem.dataset.unitId ?? 0),
                itemId: rem.dataset.itemId,
                slot: Number(rem.dataset.itemSlot),
                icon: rem.dataset.ticon ?? '',
                kind,
            });
        });
        this.panel.addEventListener('click', (e) => {
            // touch has no hover: first tap peeks at the info, second tap acts
            if (inputMode() === 'touch') {
                const peek = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
                if (peek) {
                    if (this.actionInfoFor !== peek) {
                        this.showActionInfo(peek);
                        if (this.isForgePreviewSlot(peek) && peek.classList.contains('empty')) {
                            this.pinForgeRecipes(peek);
                        }
                        return;
                    }
                    // second tap on the same tile — drop sticky recipe peek
                    this.hideForgeSlotHoverPreview();
                } else {
                    this.hideActionInfo();
                }
            }
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.action-tile');
            if (!button) {
                const emptySlot = (e.target as HTMLElement).closest<HTMLElement>(
                    '.item-sq.empty.drop-target',
                );
                if (emptySlot) this.onApplyArmedItem?.();
                const fill = (e.target as HTMLElement).closest<HTMLElement>('.forge-suggest');
                if (fill?.dataset.forgeFill) {
                    const itemIds = fill.dataset.forgeFill.split(',').filter(Boolean);
                    if (itemIds.length > 0) this.onForgeFill?.(itemIds);
                }
                const emptyForge = (e.target as HTMLElement).closest<HTMLElement>(
                    '.forge-row .item-sq.empty',
                );
                if (
                    emptyForge &&
                    !emptyForge.classList.contains('drop-target') &&
                    !emptyForge.classList.contains('forge-suggest')
                ) {
                    this.pinForgeRecipes(emptyForge);
                }
                return;
            }
            // locked (unaffordable / not ready) and owned tiles stay hoverable
            // for their info frame, but do nothing on click
            if (button.classList.contains('locked') || button.classList.contains('owned')) return;
            if (button.dataset.levelall) this.onLevelAll?.();
            else if (button.dataset.levelup) this.onBuyLevel?.();
            else if (button.dataset.recruit) this.onRecruitLevel?.();
            else if (button.dataset.towerupgrade) this.onUpgradeTower?.();
            else if (button.dataset.sellability) this.onBuySellAbility?.();
            else if (button.dataset.rallyroute) this.onBuyRallyRouteAbility?.();
            else if (button.dataset.movepack) this.onBuyMovePackAbility?.();
            else if (button.dataset.deployslot) this.onBuyDeploySlot?.();
            else if (button.dataset.rangeboost) this.onBuyRoundRangeBoost?.();
            else if (button.dataset.speedboost) this.onBuyRoundSpeedBoost?.();
            else if (button.dataset.credit) this.onBuyCredit?.();
            else if (button.dataset.sendsupply) this.onSendSupply?.(100);
            else if (button.dataset.boost) this.onBuyBoost?.(button.dataset.boost as 'attack' | 'hp');
            else if (button.dataset.tech) this.onBuyTech?.(button.dataset.tech);
        });
        // hovering a tile or equipped item pops the big info frame (mouse only —
        // touch would open it mid-tap and turn the first tap into a blind buy)
        this.panel.addEventListener('pointerover', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const tile = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            if (tile) {
                // forge-bake / spell tips use commander-style floating tip
                if (!tile.dataset.spellTip) this.showActionInfo(tile);
                else this.hideActionInfo();
                if (tile.classList.contains('drop-target')) this.setPanelItemDropReady(true);
            }
        });
        this.panel.addEventListener('pointerout', (e) => {
            if ((e as PointerEvent).pointerType === 'touch') return;
            const from = (e.target as HTMLElement).closest<HTMLElement>(infoSel);
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.(infoSel);
            if (from && from !== to) {
                if (!from.dataset.spellTip) {
                    const related = e.relatedTarget as Node | null;
                    const keepRecipes =
                        this.forgeRecipesPinned ||
                        (!!related && !!this.forgeSlotPreviewEl?.contains(related));
                    this.hideActionInfo({ keepRecipes });
                }
                if (from.classList.contains('drop-target') && !to?.classList.contains('drop-target')) {
                    this.setPanelItemDropReady(false);
                }
            }
        });
        this.bindCardSpellTips(this.panel);

        // unequipped pack items / spells (left edge): press to attach, release to drop
        this.inventoryEl = document.createElement('div');
        this.inventoryEl.className = 'mechili-sidebar left';
        this.inventoryEl.style.display = 'none';
        this.bindCardSpellTips(this.inventoryEl);
        this.inventoryEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (this.toggleSidebarCollapse(this.inventoryEl, 'player', e)) return;
            const itemBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                '.inv-item[data-item]',
            );
            if (itemBtn?.dataset.item) {
                e.preventDefault();
                this.beginInvDrag(itemBtn, e);
                this.onArmItem?.(itemBtn.dataset.item, Number(itemBtn.dataset.index ?? -1));
                this.setPhoneTab(null);
                return;
            }
            // placed / cancel badge: left-click clears (same as right-click)
            const cancelBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                '.inv-item[data-tactic].cancelable, .inv-item[data-tactic].placed',
            );
            if (cancelBtn?.dataset.tactic) {
                e.preventDefault();
                const routeId = cancelBtn.dataset.routeId;
                if (routeId) {
                    this.onResetPlacedTactic?.(cancelBtn.dataset.tactic, Number(routeId));
                } else {
                    this.onCancelTactic?.();
                }
                this.setPhoneTab(null);
                return;
            }
            const tacticBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
                '.inv-item[data-tactic]:not(.placed)',
            );
            if (tacticBtn?.dataset.tactic) {
                e.preventDefault();
                this.beginInvDrag(tacticBtn, e);
                this.onArmTactic?.(
                    tacticBtn.dataset.tactic,
                    Number(tacticBtn.dataset.index ?? -1),
                );
                this.setPhoneTab(null);
            }
        });
        this.inventoryEl.addEventListener('click', (e) => {
            // arming / cancel is pointerdown — only handle collapse here
            this.toggleSidebarCollapse(this.inventoryEl, 'player', e);
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
        this.attachLongPress(this.shopColumn, '.shop-rune', (btn) =>
            this.showRuneHoverTip(btn),
        );
        this.attachLongPress(this.inventoryEl, '.inv-item', (btn) => {
            const routeId = btn.dataset.routeId;
            if (routeId && btn.dataset.tactic) {
                this.onResetPlacedTactic?.(btn.dataset.tactic, Number(routeId));
            } else if (btn.dataset.spellTip) {
                this.showRuneHoverTip(btn);
            } else {
                this.showTouchTooltip((btn as HTMLButtonElement).title);
            }
        });

        // the picked-up item rides the cursor (capture phase: HUD elements
        // stop pointer events from bubbling to window)
        window.addEventListener('pointermove', this.onItemGhostMove, true);
        this.mount(this.inventoryEl);
        this.mount(this.enemyInventoryEl);

        // fighting-game style top bar: one commander chip per seat, stacked per side
        this.fightBar = document.createElement('div');
        this.fightBar.className = 'mechili-fightbar';
        this.playerStackEl = document.createElement('div');
        this.playerStackEl.className = 'fighter-stack player';
        this.enemyStackEl = document.createElement('div');
        this.enemyStackEl.className = 'fighter-stack enemy';

        this.topBar = document.createElement('div');
        this.topBar.className = 'mechili-topbar';
        const topMeta = document.createElement('div');
        topMeta.className = 'top-meta';
        this.roundEl = document.createElement('span');
        this.roundEl.className = 'round';
        this.spectatorBadgeEl = document.createElement('button');
        this.spectatorBadgeEl.type = 'button';
        this.spectatorBadgeEl.className = 'spectator-badge';
        this.spectatorBadgeEl.style.display = 'none';
        this.spectatorBadgeEl.title = 'Spectators watching this match';
        this.spectatorBadgeEl.addEventListener('click', () => this.toggleSpectatorList());
        topMeta.append(this.roundEl, this.spectatorBadgeEl);
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
        // filled in by setSpeedSteps once Game hands over its step list
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

        this.fightBar.append(this.playerStackEl, this.topBar, this.enemyStackEl);

        // one contextual bottom bar: sheet tabs (Shop/Spells — phone only)
        // while nothing is selected, unit actions once something is
        this.phoneBar = document.createElement('div');
        this.phoneBar.className = 'mechili-phonebar';
        const phoneTabs: ['shop' | 'unit' | 'tactics' | 'chat', string, string][] = [
            ['shop', 'ui-shop', 'Shop'],
            ['unit', 'ui-unit', 'Unit'],
            ['tactics', 'ui-tactics', DISPLAY.tactics],
            ['chat', 'ui-chat', 'Chat'],
        ];
        for (const [tab, icon, label] of phoneTabs) {
            const button = document.createElement('button');
            button.className = `pb-tab pb-${tab}`;
            button.innerHTML = `${iconHtml(icon, 'pb-ico')}<span class="pb-label">${label}</span>`;
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
        this.touchMoveBtn.innerHTML = `${iconHtml('ui-move', 'pb-ico')}<span class="pb-label">Move</span>`;
        this.touchMoveBtn.addEventListener('click', () => this.onTouchPickUp?.());
        this.touchRotateBtn = document.createElement('button');
        this.touchRotateBtn.className = 'ta-btn ta-rotate';
        this.touchRotateBtn.innerHTML = `${iconHtml('ui-rotate', 'pb-ico')}<span class="pb-label">Rotate</span>`;
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
        this.phoneUndoEl.innerHTML = `${iconHtml('ui-undo', 'btn-ico mask-ico')} Undo`;
        this.phoneUndoEl.addEventListener('click', () => this.onUndo?.());
        const phoneSupplyFrame = document.createElement('div');
        phoneSupplyFrame.className = 'mechili-supply clickable';
        phoneSupplyFrame.title = 'Match settings';
        this.phoneSupplyEl = document.createElement('span');
        this.phoneSupplyEl.className = 'supply';
        this.phoneSupplyEl.insertAdjacentHTML('afterbegin', moneyIconHtml('supply-ico'));
        this.phoneSupplyAmtEl = document.createElement('span');
        this.phoneSupplyAmtEl.className = 'supply-amt';
        this.phoneSupplyEl.append(this.phoneSupplyAmtEl);
        phoneSupplyFrame.append(this.phoneSupplyEl);
        phoneSupplyFrame.addEventListener('click', () => this.showSettingsDetail());
        this.phoneLevelAllEl = document.createElement('button');
        this.phoneLevelAllEl.className = 'level-all-global';
        this.phoneLevelAllEl.style.display = 'none';
        this.phoneLevelAllEl.title = 'Level up every ready pack on the field';
        this.phoneLevelAllEl.addEventListener('click', () => this.onLevelAllGlobal?.());
        // menu sits at the top of the strip, directly under the enemy card —
        // far away from End Deployment (the topbar twin hides on phone)
        this.phoneMenuEl = document.createElement('button');
        this.phoneMenuEl.className = 'mechili-phone-menu';
        this.phoneMenuEl.innerHTML = iconHtml('ui-menu', 'btn-ico');
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

    /** framed rune/spell tip (same window as commander spell hover) */
    private writeRuneTip(el: HTMLElement, itemId: string, extra?: string): void {
        const def = ITEMS[itemId];
        if (!def) return;
        el.dataset.spellTip = '1';
        el.dataset.ttitle = def.name;
        el.dataset.tdesc = extra ? `${def.description}\n${extra}` : def.description;
        el.dataset.ticon = def.icon;
        el.removeAttribute('title');
    }

    private showRuneHoverTip(el: HTMLElement): void {
        this.cardSpellTips.show(el);
        const dismiss = () => {
            this.cardSpellTips.hide();
            window.removeEventListener('pointerdown', dismiss, true);
        };
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
        /** base-building upgrade (compact bar; sheet hides the duplicate tile) */
        upgrade?: { cost: number; affordable: boolean } | null;
    }): void {
        const { rotate, move, carrying } = opts;
        // compact: Level / Upgrade on the bar; sheet skips those same tiles.
        // Wider windows keep them on the panel; tablets only get move/rotate.
        const phone = PHONE_MQ?.matches ?? false;
        const levelUp = phone ? opts.levelUp : null;
        const levelAll = phone ? opts.levelAll : null;
        const upgrade = phone ? opts.upgrade : null;
        const hasFieldActions = rotate || !!move || !!levelUp || !!levelAll || !!upgrade;
        const key = `${phone}|${JSON.stringify(opts)}`;
        if (key !== this.lastTouchActKey) {
            this.lastTouchActKey = key;
            // 'acting' lets tablets (no tab UI) show the bar just for these buttons
            this.phoneBar.classList.toggle('acting', hasFieldActions);
            const wasCarrying = this.phoneBar.classList.contains('carrying');
            this.phoneBar.classList.toggle('carrying', !!carrying);
            // details make way while something rides the finger
            if (carrying && !wasCarrying && this.phoneTab === 'unit') this.setPhoneTab(null);
            this.touchRotateBtn.style.display = rotate ? 'flex' : 'none';
            this.touchMoveBtn.style.display = move ? 'flex' : 'none';
            this.touchLevelBtn.style.display = levelUp ? 'flex' : 'none';
            if (levelUp) {
                this.touchLevelBtn.innerHTML =
                    `${iconHtml('ability-level', 'pb-ico mask-ico')}` +
                    `<span class="pb-label">Level ${moneyHtml(levelUp.cost)}</span>`;
                this.touchLevelBtn.classList.toggle('disabled', !levelUp.affordable);
            }
            this.touchLevelAllBtn.style.display = levelAll ? 'flex' : 'none';
            if (levelAll) {
                this.touchLevelAllBtn.innerHTML =
                    `${iconHtml('ability-level-type', 'pb-ico mask-ico')}` +
                    `<span class="pb-label">All ×${levelAll.count} ${moneyHtml(levelAll.cost)}</span>`;
                this.touchLevelAllBtn.classList.toggle('disabled', !levelAll.affordable);
            }
            this.touchUpgradeBtn.style.display = upgrade ? 'flex' : 'none';
            if (upgrade) {
                this.touchUpgradeBtn.innerHTML =
                    `${iconHtml('ability-level', 'pb-ico mask-ico')}` +
                    `<span class="pb-label">Upgrade ${moneyHtml(upgrade.cost)}</span>`;
                this.touchUpgradeBtn.classList.toggle('disabled', !upgrade.affordable);
            }
        }
        this.maybeAutoOpenUnitSheet(hasFieldActions);
    }

    /**
     * Compact chrome: if a selection only exposes the Unit tab (no Move /
     * Level / Upgrade), open the details sheet immediately.
     * Skip while carrying — formations and pickups are aim-only.
     */
    private maybeAutoOpenUnitSheet(hasFieldActions: boolean): void {
        if (!isCompactChrome() || !this.phoneBar.classList.contains('has-unit')) {
            this.unitSheetAutoKey = null;
            return;
        }
        if (hasFieldActions || this.phoneBar.classList.contains('carrying')) return;
        const key = this.lastPanelKey;
        if (!key || this.unitSheetAutoKey === key) return;
        this.unitSheetAutoKey = key;
        this.setPhoneTab('unit');
    }

    /**
     * Rect-selected formation (1+ packs via rubber-band): shop stays closed,
     * no unit sheet — packs may differ, so there are no shared details to show.
     */
    setFormationSelection(): void {
        this.phoneBar.classList.add('has-unit');
        this.panel.style.display = 'none';
        this.lastPanelKey = '';
        this.unitSheetAutoKey = null;
        if (this.phoneTab === 'unit') this.setPhoneTab(null);
    }

    /** opens the Unit details sheet (auto-shown for buildings); phone-only visual */
    openUnitDetails(): void {
        this.setPhoneTab('unit');
    }

    /** opens one phone bottom sheet (or none); a no-op visually on desktop */
    private setPhoneTab(tab: 'shop' | 'unit' | 'tactics' | 'chat' | null): void {
        // user closed the unit sheet while still selected — don't auto-reopen
        if (
            tab === null &&
            this.phoneTab === 'unit' &&
            this.phoneBar.classList.contains('has-unit') &&
            this.lastPanelKey
        ) {
            this.unitSheetAutoKey = this.lastPanelKey;
        }
        // the chat's expanded state is shared with desktop hover — only touch
        // the 'open' flag on actual chat-tab transitions (phone-only states)
        if (tab === 'chat') this.chatBarWidget.open(false);
        else if (this.phoneTab === 'chat') this.chatBarWidget.close();
        this.phoneTab = tab;
        this.shopColumn.classList.toggle('phone-open', tab === 'shop');
        this.panel.classList.toggle('phone-open', tab === 'unit');
        this.inventoryEl.classList.toggle('phone-open', tab === 'tactics');
        this.chatBarWidget.el.classList.toggle('phone-open', tab === 'chat');
        this.phoneBar.querySelector('.pb-shop')?.classList.toggle('active', tab === 'shop');
        this.phoneBar.querySelector('.pb-unit')?.classList.toggle('active', tab === 'unit');
        this.phoneBar.querySelector('.pb-tactics')?.classList.toggle('active', tab === 'tactics');
        this.phoneBar.querySelector('.pb-chat')?.classList.toggle('active', tab === 'chat');
    }

    // --- in-match chat -----------------------------------------------------

    private readonly chatFloat = new ChatFloat();
    private chatBarWidget!: ChatBar;

    private buildChatBar(): void {
        this.mount(this.chatFloat.el);

        // the composer itself is shared with the lobby's chat — see ChatBar
        const bar = new ChatBar({ onSend: (item) => this.onSendChat?.(item) });
        this.chatBarWidget = bar;
        this.mount(bar.el);

        // phone: closing the chat by tapping away also releases its bar tab.
        // ChatBar's own outside-click listener is registered first (in its
        // constructor), so the bar has already closed by the time this runs.
        // Self-detaches once this HUD is torn down, like the pref listener.
        const onDocPointer = (): void => {
            if (!bar.el.isConnected) {
                document.removeEventListener('pointerdown', onDocPointer);
                return;
            }
            if (!bar.isOpen && this.phoneTab === 'chat') this.setPhoneTab(null);
        };
        document.addEventListener('pointerdown', onDocPointer);

        // "show combat chat" hides the whole thing, live; the listener
        // detaches itself once this HUD is torn down
        const applyVisibility = () => {
            const show = prefs().combatChat;
            bar.el.style.display = show ? '' : 'none';
            this.chatFloat.el.style.display = show ? '' : 'none';
            // the phone bar's Chat tab mirrors the pref
            this.phoneBar.classList.toggle('has-chat', show);
        };
        applyVisibility();
        const off = onPrefsChange(() => {
            if (!bar.el.isConnected) {
                off();
                return;
            }
            applyVisibility();
        });
    }

    /** shows a chat item: bubble at the sender's fighter card + floating line */
    addChat(name: string, item: ChatItem, from: 'local' | 'remote'): void {
        if (!prefs().combatChat) return; // combat chat fully hidden
        const iconId = item.kind === 'emote' ? (emoteById(item.id)?.icon ?? null) : null;
        const text = item.kind === 'text' ? item.text : (emoteById(item.id)?.label ?? '');

        // bubble under the sender's commander chip (one at a time per side)
        const chip =
            this.commanderChips.find((c) => c.name === name) ??
            this.commanderChips.find((c) => c.team === (from === 'local' ? 'player' : 'enemy'));
        if (!chip) return;
        const fighter = chip.cardEl;
        fighter.querySelector('.chat-bubble')?.remove();
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${item.kind}`;
        if (iconId) bubble.innerHTML = iconHtml(iconId, 'chat-emote-ico');
        else bubble.textContent = text;
        fighter.appendChild(bubble);
        setTimeout(() => bubble.remove(), 4500);

        // Colored by the sender's actual TEAM (chip.team), not just
        // local/remote: a teammate's message is still "player" green, only
        // a genuine opponent's should read as "enemy" red (previously any
        // non-self sender, ally included, rendered in the enemy color).
        this.chatFloat.addMessage(name, item, chip.team);
    }

    /** a system-level line in the same floating chat list — a spectator
     *  joining/leaving, etc. Deliberately NOT addChat: those events have no
     *  commander chip to attach a portrait bubble to (a spectator isn't a
     *  seat), so this skips the bubble/chip lookup entirely and just shows
     *  plain, neutral-colored text. */
    addSystemMessage(text: string): void {
        if (!prefs().combatChat) return;
        this.chatFloat.addSystem(text);
    }

    /** one combined team card per side — built once at match start.
     *  HP bar max is not seeded here: setHp grows each side to its own
     *  peak (first pick → full; 2v2 second pick raises peak to the sum).
     *  Peaks are preserved across rebuilds (refreshCommanders). */
    setCommanders(
        entries: {
            seat: number;
            team: 'player' | 'enemy';
            name: string;
            primary: boolean;
            avatar?: string | null;
        }[],
        humanSeat: number,
    ): void {
        this.humanSeat = humanSeat;
        this.commanderChips = [];
        this.playerStackEl.replaceChildren();
        this.enemyStackEl.replaceChildren();
        // new fill nodes — force setHp to repaint
        this.lastHpFillP = Number.NaN;
        this.lastHpFillE = Number.NaN;
        this.lastHpValP = Number.NaN;
        this.lastHpValE = Number.NaN;

        const playerEntries = entries.filter((e) => e.team === 'player');
        const enemyEntries = entries.filter((e) => e.team === 'enemy');

        // Determine local player's index in team
        const playerFeaturedIndex = Math.max(
            0,
            playerEntries.findIndex((e) => e.seat === humanSeat),
        );
        const featuredPlayerEntry = playerEntries[playerFeaturedIndex] ?? playerEntries[0];
        const secondaryPlayerEntries = playerEntries.filter((_, idx) => idx !== playerFeaturedIndex);

        // Determine enemy on same side of board (matching index relative to team line)
        const enemyFeaturedIndex = Math.min(playerFeaturedIndex, Math.max(0, enemyEntries.length - 1));
        const featuredEnemyEntry = enemyEntries[enemyFeaturedIndex] ?? enemyEntries[0];
        const secondaryEnemyEntries = enemyEntries.filter((_, idx) => idx !== enemyFeaturedIndex);

        if (playerEntries.length > 0 && featuredPlayerEntry) {
            const res = this.buildTeamCard('player', featuredPlayerEntry, secondaryPlayerEntries, playerEntries);
            this.playerStackEl.append(res.cardEl);
            this.playerHpFill = res.hpFill;
            this.playerHpVal = res.hpVal;
            this.playerSpecEl = res.specEl;
        }

        if (enemyEntries.length > 0 && featuredEnemyEntry) {
            const res = this.buildTeamCard('enemy', featuredEnemyEntry, secondaryEnemyEntries, enemyEntries);
            this.enemyStackEl.append(res.cardEl);
            this.enemyHpFill = res.hpFill;
            this.enemyHpVal = res.hpVal;
            this.enemySpecEl = res.specEl;
        }

        this.playerStackEl.classList.toggle('multi', playerEntries.length > 1);
        this.enemyStackEl.classList.toggle('multi', enemyEntries.length > 1);
    }

    private attachPortraitEvents(el: HTMLElement, seat: number): void {
        el.addEventListener('click', () => this.showSpecialistDetail(seat));
        el.addEventListener('mouseenter', () => {
            if (inputMode() !== 'touch') this.showSpecialistDetail(seat, true);
        });
        el.addEventListener('mouseleave', () => {
            if (inputMode() === 'touch') return;
            if (this.specDetailSeat === seat && this.specDetailViaHover) this.hideSpecialistDetail();
        });
    }

    private buildTeamCard(
        team: 'player' | 'enemy',
        featuredEntry: { seat: number; name: string; avatar?: string | null },
        secondaryEntries: { seat: number; name: string; avatar?: string | null }[],
        allEntries: { seat: number; name: string; avatar?: string | null }[],
    ): { cardEl: HTMLDivElement; hpFill: HTMLDivElement; hpVal: HTMLSpanElement; specEl: HTMLSpanElement } {
        const cardEl = document.createElement('div');
        cardEl.className = `fighter ${team}`;
        this.attachPortraitEvents(cardEl, featuredEntry.seat);

        const combinedName = allEntries.map((e) => e.name).join(' & ');

        const portraitGroup = document.createElement('div');
        portraitGroup.className = 'portrait-group';

        // Featured main portrait sits against the HP tube (bar grows out of it).
        // Secondary teammates stack outward, away from the bar.
        const mainPortrait = document.createElement('div');
        mainPortrait.className = 'portrait main';
        mainPortrait.dataset.seat = String(featuredEntry.seat);
        const mainAvatar = featuredEntry.avatar || null;
        this.commanderChips.push({
            seat: featuredEntry.seat,
            team,
            cardEl,
            portraitEl: mainPortrait,
            name: featuredEntry.name,
            card: null,
            avatar: mainAvatar,
        });
        this.applyPortrait(mainPortrait, mainAvatar, null);

        if (secondaryEntries.length > 0) {
            const subStack = document.createElement('div');
            subStack.className = 'portrait-sub-stack';
            for (const sec of secondaryEntries) {
                const subPortrait = document.createElement('div');
                subPortrait.className = 'portrait sub';
                subPortrait.dataset.seat = String(sec.seat);
                const secAvatar = sec.avatar || null;

                this.commanderChips.push({
                    seat: sec.seat,
                    team,
                    cardEl,
                    portraitEl: subPortrait,
                    name: sec.name,
                    card: null,
                    avatar: secAvatar,
                });
                this.applyPortrait(subPortrait, secAvatar, null);

                subStack.appendChild(subPortrait);
            }
            // DOM: subs first, main last → main is adjacent to the HP bar
            // (enemy portrait-group is row-reversed, so the same DOM keeps main inward)
            portraitGroup.append(subStack, mainPortrait);
        } else {
            portraitGroup.appendChild(mainPortrait);
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'fname';
        nameEl.textContent = combinedName;
        // Caps / tall glyphs need a bit more air under the tube; short
        // lowercase names can sit tighter without overlapping the bar.
        if (/\p{Lu}/u.test(combinedName)) nameEl.classList.add('tall');

        const specEl = document.createElement('span');
        specEl.className = 'fspec';

        const hpFill = document.createElement('div');
        hpFill.className = 'hp-fill';
        const hpVal = document.createElement('span');
        hpVal.className = 'hp-val';
        const hpTrack = document.createElement('div');
        hpTrack.className = 'hp-track';
        hpTrack.append(hpFill, hpVal);

        const info = document.createElement('div');
        info.className = 'fighter-info';
        info.append(hpTrack, nameEl, specEl);

        cardEl.append(portraitGroup, info);
        return { cardEl, hpFill, hpVal, specEl };
    }

    /** Player avatar wins over specialist atlas icon when both exist. */
    private applyPortrait(
        el: HTMLElement,
        avatar: string | null | undefined,
        card: StartCard | null,
    ): void {
        el.replaceChildren();
        el.classList.remove('empty');
        if (avatar) {
            const img = document.createElement('img');
            img.className = 'fighter-portrait-img';
            img.alt = '';
            img.draggable = false;
            img.src = avatar;
            el.appendChild(img);
            return;
        }
        if (card?.portrait) {
            el.innerHTML = iconHtml(card.portrait, 'fighter-portrait-ico');
            return;
        }
        el.classList.add('empty');
        const mark = document.createElement('span');
        mark.className = 'portrait-placeholder';
        mark.setAttribute('aria-hidden', 'true');
        el.appendChild(mark);
    }

    /** @deprecated use setCommanders — kept for any external callers */
    setPlayers(local: string, opponent: string): void {
        this.setCommanders(
            [
                { seat: 0, team: 'player', name: local, primary: true },
                { seat: 1, team: 'enemy', name: opponent, primary: true },
            ],
            0,
        );
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
        items: readonly { id: string; icon: string; name: string; armed: boolean; index: number }[],
        tactics: readonly {
            id: string;
            icon: string;
            name: string;
            armed: boolean;
            placed?: boolean;
            routeId?: number;
            /**
             * Corner badge: omit when ready; `'cancel'` (only ever honoured
             * together with a `routeId` — see the render rule) while placed this
             * deploy; a positive number = rounds until ready again.
             */
            badge?: 'cancel' | number;
            /** overrides the default click/right-click tooltip line */
            hint?: string;
            index: number;
        }[] = [],
    ): void {
        const key = JSON.stringify({ items, tactics });
        if (key === this.lastInventoryKey) return;
        this.lastInventoryKey = key;
        this.lastBagItemIds = items.map((i) => i.id);
        this.refreshForgeRecipesHover();
        const visible = items.length > 0 || tactics.length > 0;
        this.inventoryEl.style.display = visible ? '' : 'none';
        this.phoneBar.classList.toggle('has-tactics', visible);
        if (!visible && this.phoneTab === 'tactics') this.setPhoneTab(null);
        const total = items.length + tactics.length;
        const itemHtml = items.length
            ? this.invSectionTitle(DISPLAY.items, items.length, total) +
              items
                  .map((i) => {
                      const def = ITEMS[i.id];
                      const extra =
                          `Press and drag onto a pack (or click to pick up, then click a pack). ` +
                          `Free ${DISPLAY.item.toLowerCase()} slot required.`;
                      const tip =
                          def
                              ? ` data-spell-tip="1" data-ttitle="${escapeAttr(def.name)}" ` +
                                `data-tdesc="${escapeAttr(`${def.description}\n${extra}`)}" ` +
                                `data-ticon="${escapeAttr(def.icon)}"`
                              : ` title="${escapeAttr(`${i.name}\n${extra}`)}"`;
                      return (
                          `<button class="inv-item${i.armed ? ' armed' : ''}" data-item="${i.id}" data-index="${i.index}"${tip}>` +
                          `${iconHtml(i.icon)}</button>`
                      );
                  })
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? this.invSectionTitle(DISPLAY.tactics, tactics.length, total) +
              tactics
                  .map((t) => {
                      const routeAttr = t.routeId !== undefined ? ` data-route-id="${t.routeId}"` : '';
                      // Generic rule: the cancel affordance requires something
                      // this strip can actually clear, i.e. a routeId. A spent
                      // one-shot has no per-entry revert (only the global undo),
                      // so it must never advertise a button that does nothing.
                      const cancel = t.badge === 'cancel' && t.routeId !== undefined;
                      const waitRounds = typeof t.badge === 'number' ? t.badge : null;
                      const cls =
                          `inv-item tactic` +
                          (t.placed ? ' placed' : '') +
                          (t.armed ? ' armed' : '') +
                          (cancel ? ' cancelable' : '') +
                          (waitRounds !== null ? ' cooling' : '');
                      const def = TACTICS[t.id];
                      const usage =
                          t.placed || cancel
                              ? 'Click or right-click to clear and place again.'
                              : 'Click to place on the map. Right-click to cancel.';
                      const tip =
                          def
                              ? ` data-spell-tip="1" data-ttitle="${escapeAttr(def.name)}" ` +
                                `data-tdesc="${escapeAttr(t.hint ?? `${def.description}\n${usage}`)}" ` +
                                `data-ticon="${escapeAttr(t.icon)}"`
                              : ` title="${escapeAttr(
                                    t.hint ??
                                        (t.placed
                                            ? `${t.name}\nClick or right-click to clear and place again.`
                                            : `${t.name}\nClick to place on the map. Right-click to cancel.`),
                                )}"`;
                      const badge =
                          cancel
                              ? `<span class="inv-cd cancel" title="Click to cancel">cancel</span>`
                              : waitRounds !== null
                                ? `<span class="inv-cd wait" title="Ready again in ${waitRounds} round${waitRounds === 1 ? '' : 's'}">${waitRounds}</span>`
                                : '';
                      return (
                          `<button class="${cls}" data-tactic="${t.id}" data-index="${t.index}"${routeAttr}${tip}>` +
                          `${iconHtml(t.icon)}${badge}</button>`
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
            this.itemGhost.innerHTML = `<span class="inv-drag-rune m-icon"></span>`;
            document.body.appendChild(this.itemGhost);
        }
        if (this.itemGhost) {
            if (!picked) {
                this.itemGhost.remove();
                this.itemGhost = null;
                this.worldItemDropReady = false;
                this.panelItemDropReady = false;
                if (this.forgeSlotPreviewAnchor === this.itemGhost) {
                    this.hideForgeSlotHoverPreview();
                }
            } else {
                this.itemGhost.classList.add('inv-drag');
                this.itemGhost.classList.remove('unequipping');
                const rune = this.itemGhost.querySelector<HTMLElement>('.inv-drag-rune');
                if (rune) applyIcon(rune, picked.icon);
                else {
                    this.itemGhost.innerHTML = `<span class="inv-drag-rune m-icon"></span>`;
                    applyIcon(this.itemGhost.querySelector<HTMLElement>('.inv-drag-rune')!, picked.icon);
                }
                this.syncItemGhostDropReady();
            }
        }
    }

    /** ring the carried item ghost when the cursor is over a pack that can take it */
    setItemGhostDropReady(ready: boolean): void {
        this.worldItemDropReady = ready;
        this.syncItemGhostDropReady();
    }

    /** true when an empty forge/pack slot in the details panel is lit as a drop target */
    isPanelItemDropReady(): boolean {
        return this.panelItemDropReady;
    }

    private forgeSlotPreviewEl: HTMLDivElement | null = null;
    private forgeSlotPreviewAnchor: HTMLElement | null = null;
    /** rune id used while recipes hover is open (forge slot / drag-over-forge) */
    private forgeRecipesHoverRuneId: string | null = null;
    /** recipe HTML currently written into the popup — skip rewrites when unchanged */
    private forgeRecipesShownHtml: string | null = null;
    private forgeRecipesDismissArmed = false;
    /** click-open cookbook — stays until click outside, even if the pointer leaves */
    private forgeRecipesPinned = false;

    /** click outside dismisses sticky recipe peeks; clicks inside the cookbook stay */
    private readonly onForgeRecipesPointerDown = (e: PointerEvent) => {
        const el = this.forgeSlotPreviewEl;
        if (!el || el.hidden || !el.classList.contains('recipes')) return;
        const t = e.target as Node | null;
        if (!t) return;
        if (this.forgeSlotPreviewAnchor?.contains(t)) return;
        if (el.contains(t)) return;
        this.dismissForgeRecipesPreview();
    };

    private isForgePreviewSlot(el: HTMLElement): boolean {
        return (
            el.classList.contains('item-sq') &&
            !el.classList.contains('forge-suggest') &&
            !el.classList.contains('forge-bake') &&
            !!el.closest('.forge-row')
        );
    }

    /**
     * Recipe grid beside empty / filled forge runes (not forge-bake — that uses
     * spell tip). World-drag onto the Stronghold does not open this.
     */
    private syncForgeSlotHoverPreview(anchor: HTMLElement | null): void {
        if (!anchor || !this.isForgePreviewSlot(anchor)) {
            this.hideForgeSlotHoverPreview();
            return;
        }

        if (anchor.classList.contains('empty') || anchor.dataset.itemId) {
            this.showForgeRecipesHover(anchor);
            return;
        }

        this.hideForgeSlotHoverPreview();
    }

    /**
     * Full unlocked-spell recipe grid.
     * @param highlightRuneId when set (drag-over-forge), spells that use
     *   that rune get ready pulse; otherwise tiles use oven ready/partial.
     */
    private showForgeRecipesHover(
        anchor: HTMLElement,
        highlightRuneId: string | null = null,
    ): void {
        const recipes = this.forgeRecipesBlockHtml(
            this.lastForgeSpellPool,
            this.lastBagItemIds,
            this.lastForgeOvenIds,
            highlightRuneId,
        );
        if (!recipes) {
            this.hideForgeSlotHoverPreview();
            return;
        }
        const el = this.ensureForgeSlotPreviewEl();
        // Already showing this exact popup for this anchor? Skip the innerHTML
        // rewrite + tip rebind + reposition (a forced reflow). This kills the
        // duplicate rebuild when a buy fires setInventory AND setForgeRecipeContext
        // in the same frame, and makes no-op refreshes free.
        const unchanged =
            !el.hidden &&
            el.classList.contains('recipes') &&
            this.forgeSlotPreviewAnchor === anchor &&
            this.forgeRecipesHoverRuneId === highlightRuneId &&
            this.forgeRecipesShownHtml === recipes;
        if (unchanged) return;
        this.forgeSlotPreviewAnchor = anchor;
        this.forgeRecipesHoverRuneId = highlightRuneId;
        this.forgeRecipesShownHtml = recipes;
        el.classList.add('recipes');
        el.innerHTML =
            `<div class="forge-recipes-hint">${
                this.forgeRecipesPinned
                    ? 'Hover a recipe for details'
                    : 'Drag onto a Stronghold to forge'
            }</div>` + recipes;
        el.hidden = false;
        this.positionForgeSlotHoverPreview();
        this.armForgeRecipesDismiss();
    }

    /** click an empty forge slot: cookbook stays until click outside */
    private pinForgeRecipes(anchor: HTMLElement): void {
        this.forgeRecipesPinned = true;
        this.forgeRecipesShownHtml = null;
        this.showForgeRecipesHover(anchor);
    }

    /** outside / popup click dismiss — deferred so the opening tap doesn't close it */
    private armForgeRecipesDismiss(): void {
        if (this.forgeRecipesDismissArmed) return;
        this.forgeRecipesDismissArmed = true;
        setTimeout(() => {
            if (!this.forgeRecipesDismissArmed) return;
            window.addEventListener('pointerdown', this.onForgeRecipesPointerDown, true);
        }, 0);
    }

    private disarmForgeRecipesDismiss(): void {
        if (!this.forgeRecipesDismissArmed) return;
        this.forgeRecipesDismissArmed = false;
        window.removeEventListener('pointerdown', this.onForgeRecipesPointerDown, true);
    }

    /** hide recipes (+ action-info peek when it opened them via touch/click) */
    private dismissForgeRecipesPreview(): void {
        this.forgeRecipesPinned = false;
        this.hideActionInfo();
    }

    /** rebuild open recipe hover after bag / oven changes (e.g. shop buy while hovering) */
    private refreshForgeRecipesHover(): void {
        const anchor = this.forgeSlotPreviewAnchor;
        const el = this.forgeSlotPreviewEl;
        if (!anchor || !el || el.hidden || !el.classList.contains('recipes')) return;
        if (!anchor.isConnected) {
            this.hideForgeSlotHoverPreview();
            return;
        }
        this.showForgeRecipesHover(anchor, this.forgeRecipesHoverRuneId);
    }

    private ensureForgeSlotPreviewEl(): HTMLDivElement {
        if (!this.forgeSlotPreviewEl) {
            this.forgeSlotPreviewEl = document.createElement('div');
            this.forgeSlotPreviewEl.className = 'forge-slot-preview';
            this.forgeSlotPreviewEl.setAttribute('aria-hidden', 'true');
            this.forgeSlotPreviewEl.addEventListener('pointerleave', (e) => {
                if (this.forgeRecipesPinned) return;
                if (e.pointerType === 'touch') return;
                const to = e.relatedTarget as Node | null;
                if (this.forgeSlotPreviewAnchor?.contains(to)) return;
                this.hideForgeSlotHoverPreview();
            });
            this.forgeSlotPreviewEl.addEventListener('click', (e) => {
                if (!this.forgeSlotPreviewEl?.classList.contains('recipes')) return;
                const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-spell-tip]');
                if (hit) {
                    e.stopPropagation();
                    this.cardSpellTips.show(hit);
                    return;
                }
            });
            this.bindCardSpellTips(this.forgeSlotPreviewEl);
            document.body.appendChild(this.forgeSlotPreviewEl);
        }
        return this.forgeSlotPreviewEl;
    }

    private positionForgeSlotHoverPreview(): void {
        const el = this.forgeSlotPreviewEl;
        const anchor = this.forgeSlotPreviewAnchor;
        if (!el || !anchor || el.hidden) return;
        const rect = anchor.getBoundingClientRect();
        const pad = 8;
        const gap = 6;

        if (!el.classList.contains('recipes')) {
            el.style.left = `${Math.round(rect.right + gap)}px`;
            el.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
            return;
        }

        el.style.maxHeight = `${Math.round(window.innerHeight - pad * 2)}px`;
        const w = el.offsetWidth;
        const h = el.offsetHeight;

        let left = rect.right + gap;
        if (left + w > window.innerWidth - pad) left = rect.left - gap - w;
        left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

        // shift up so the full recipe list stays on screen
        let top = rect.top;
        if (top + h > window.innerHeight - pad) top = window.innerHeight - pad - h;
        top = Math.max(pad, top);

        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
    }

    private hideForgeSlotHoverPreview(): void {
        this.disarmForgeRecipesDismiss();
        this.forgeRecipesPinned = false;
        this.forgeSlotPreviewAnchor = null;
        this.forgeRecipesHoverRuneId = null;
        this.forgeRecipesShownHtml = null; // popup emptied: next show must rebuild
        this.hideCardSpellTip();
        if (this.forgeSlotPreviewEl) {
            this.forgeSlotPreviewEl.hidden = true;
            this.forgeSlotPreviewEl.classList.remove('recipes');
            this.forgeSlotPreviewEl.replaceChildren();
        }
    }

    /** drop forge hover only when its anchor lived in the selection panel */
    private hidePanelForgeHoverPreview(): void {
        const anchor = this.forgeSlotPreviewAnchor;
        if (anchor && this.panel.contains(anchor)) this.hideForgeSlotHoverPreview();
    }

    private worldItemDropReady = false;
    private panelItemDropReady = false;

    private setPanelItemDropReady(ready: boolean): void {
        this.panelItemDropReady = ready;
        this.syncItemGhostDropReady();
    }

    private syncItemGhostDropReady(): void {
        this.itemGhost?.classList.toggle(
            'drop-ready',
            this.worldItemDropReady || this.panelItemDropReady,
        );
    }

    /** opponent items/tactics at phase-start intel (right sidebar, read-only) */
    setEnemyInventory(
        items: readonly { id?: string; icon: string; name: string }[],
        tactics: readonly { icon: string; name: string }[] = [],
        options: { sellAbility?: boolean } = {},
    ): void {
        const key = JSON.stringify({ items, tactics, options });
        if (key === this.lastEnemyInventoryKey) return;
        this.lastEnemyInventoryKey = key;
        this.lastEnemyBagItemIds = items.map((i) => i.id).filter((id): id is string => !!id);
        const visible = items.length > 0 || tactics.length > 0 || !!options.sellAbility;
        this.enemyInventoryEl.style.display = visible ? '' : 'none';
        const total = items.length + tactics.length + (options.sellAbility ? 1 : 0);
        const itemHtml = items.length
            ? this.invSectionTitle(`Enemy ${DISPLAY.items.toLowerCase()}`, items.length, total) +
              items
                  .map(
                      (i) =>
                          `<span class="inv-item readonly" title="${i.name}">` +
                          `${iconHtml(i.icon)}</span>`,
                  )
                  .join('')
            : '';
        const tacticHtml = tactics.length
            ? this.invSectionTitle(`Enemy ${DISPLAY.tactics.toLowerCase()}`, tactics.length, total) +
              tactics
                  .map(
                      (t) =>
                          `<span class="inv-item readonly tactic" title="${t.name}">` +
                          `${iconHtml(t.icon)}</span>`,
                  )
                  .join('')
            : '';
        const abilityHtml = options.sellAbility
            ? this.invSectionTitle('Enemy abilities', 1, total) +
              `<span class="inv-item readonly" title="Sell packs (unlocked)">` +
              `${iconHtml('ability-selling')}</span>`
            : '';
        this.enemyInventoryEl.innerHTML = itemHtml + tacticHtml + abilityHtml;
        this.enemyInventoryEl.classList.toggle('folded', this.enemyInventoryCollapsed);
        this.scheduleSidebarCollapseUi(this.enemyInventoryEl, 'enemy');
        this.refreshEnemySpecialistDetail();
    }

    /** enemy forge oven ids (live or intel snapshot) for opponent recipe panel */
    setEnemyForgeOven(ovenItemIds: readonly string[]): void {
        const key = ovenItemIds.join('\0');
        if (key === this.lastEnemyForgeKey) return;
        this.lastEnemyForgeKey = key;
        this.lastEnemyForgeOvenIds = [...ovenItemIds];
        this.refreshEnemySpecialistDetail();
    }

    private refreshEnemySpecialistDetail(): void {
        if (this.specDetailSeat === null) return;
        const chip = this.commanderChips.find((c) => c.seat === this.specDetailSeat);
        if (chip?.team === 'enemy') {
            this.showSpecialistDetail(this.specDetailSeat, this.specDetailViaHover);
        }
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
     *  `extrasBudgetLeft` is the separate supply cap for shields/rockets.
     *  Unit buys and base-rune buys share the same counter. */
    setDeploys(used: number, limit: number, extrasBudgetLeft: number): void {
        this.deploysLeft = limit - used;
        this.extrasBudgetLeft = extrasBudgetLeft;
        const label = `${used}/${limit}`;
        const labelEl = this.deploysEl.querySelector<HTMLSpanElement>('.unit-cap-label');
        if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
        this.deploysEl.title =
            `Purchases this round / your limit (units + base runes) · ◇ ${extrasBudgetLeft} left for shields & rockets`;
        this.refreshShopRuneAffordability();
    }

    /** supply price of each always-available base rune in the shop header */
    setShopRuneCost(cost: number, balance: number): void {
        this.shopRuneCost = cost;
        this.shopRuneBalance = balance;
        for (const { el, itemId } of this.shopRuneButtons) {
            const costEl = el.querySelector('.cost');
            if (costEl) costEl.textContent = String(cost);
            this.writeRuneTip(el, itemId);
        }
        this.refreshShopRuneAffordability();
    }

    private refreshShopRuneAffordability(): void {
        const blocked = this.deploysLeft <= 0;
        for (const { el } of this.shopRuneButtons) {
            el.classList.toggle(
                'unaffordable',
                blocked || this.shopRuneCost > this.shopRuneBalance,
            );
        }
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
            info.count >= 2 ? `Level up all (${info.count})` : 'Level up all';
        const html =
            `${iconHtml('ability-level-all', 'lag-ico mask-ico')}` +
            `<span class="lag-copy"><span class="title">${label}</span><span class="cost">${info.cost}</span></span>`;
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
            art.style.backgroundImage = cssUrl(url);
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
            const unlockCost = this.unlockCostOf(id);
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
        return moneyHtml(unlockCost);
    }

    private renderUnlockPickTile(
        o: { id: string; name: string; deployCost: number; affordable: boolean },
    ): string {
        const art = this.unitIcons.get(o.id);
        const artStyle = art ? ` style="background-image:${cssUrl(art)}"` : '';
        return (
            `<button type="button" class="shop-tile${o.affordable ? '' : ' unaffordable'}" data-unit="${o.id}">` +
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
                    `<div class="shop-grid">` +
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
            const button = target.closest<HTMLButtonElement>('.unlock-picker .shop-tile');
            if (!button?.dataset.unit || button.classList.contains('unaffordable')) return;
            this.hideCardOverlay();
            this.onUnlockPick?.(button.dataset.unit);
        });
        this.showCardOverlay(overlay);
    }

    /**
     * Unlocked forge spells + current oven contents — keeps shop-rune / empty-slot
     * recipe hover correct even when Stronghold is not selected.
     */
    setForgeRecipeContext(pool: readonly string[], ovenItemIds: readonly string[]): void {
        this.lastForgeSpellPool = [...pool];
        this.lastForgeOvenIds = [...ovenItemIds];
        const ovenKey = ovenItemIds.join('\0');
        if (ovenKey !== this.lastForgeOvenKey) {
            this.lastForgeOvenKey = ovenKey;
            this.refreshForgeRecipesHover();
        }
    }

    setSelection(info: SelectionInfo | null): void {
        this.phoneBar.classList.toggle('has-unit', !!info);
        if (!info) {
            this.panel.style.display = 'none';
            this.lastPanelKey = '';
            this.unitSheetAutoKey = null;
            this.onTechHover?.(null);
            if (this.phoneTab === 'unit') this.setPhoneTab(null);
            // only clear forge hover tied to the details panel — shop / bag
            // recipe hover must survive Stronghold being deselected every frame
            this.hidePanelForgeHoverPreview();
            return;
        }
        // oven/pool come from setForgeRecipeContext each tick — do not clear
        // them when a non-Stronghold unit is selected
        this.panel.style.display = 'block';
        // HP / total-damage / kills tick every frame while a mech is selected in
        // battle. Keep them OUT of the rebuild key so the whole panel DOM isn't
        // torn down each frame — patch those few values in place instead. Without
        // this, a battle selection reflowed the entire details panel per frame
        // (the "HUD at 95%" spike).
        const key = JSON.stringify({
            ...info,
            hp: 0,
            record: info.record ? { damageDealt: 0, kills: 0 } : undefined,
        });
        if (key === this.lastPanelKey) {
            this.patchLiveStats(info); // structure unchanged: just refresh live numbers
            return;
        }
        this.lastPanelKey = key;
        this.actionInfoFor = null; // rebuilt DOM: stale peek references would misfire
        this.onTechHover?.(null); // rebuilt tiles: drop any lingering tech-hover preview
        this.hidePanelForgeHoverPreview();
        this.setPanelItemDropReady(false);
        const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span class="v">${v}</span></div>`;
        // like row(), but tags the value so patchLiveStats can refresh it in place
        const liveRow = (k: string, v: string, id: string) =>
            `<div class="row"><span>${k}</span><span class="v" data-live="${id}">${v}</span></div>`;

        // leveling sits at the top-right of the frame (next to the name);
        // everything else is a square tile in the bottom action row.
        // Compact: Level / Upgrade live on the phone bar — skip those tiles here.
        const levelTiles: ActionTile[] = [];
        const tiles: ActionTile[] = [];
        const levelOnBar = isCompactChrome();
        // a unit's Level Up shows only when a level is actually available
        // (XP banked); the level itself is always shown big in the header
        if (!levelOnBar && info.levelUp?.ready) {
            levelTiles.push({
                data: 'data-levelup="1"',
                icon: 'ability-level',
                title: 'Level Up',
                desc: 'Raise this pack one level — it gains its base HP and damage again. Costs banked XP plus supply.',
                cost: info.levelUp.cost,
                state: info.levelUp.affordable ? 'buy' : 'locked',
            });
            if (info.levelUp.all) {
                levelTiles.push({
                    data: 'data-levelall="1"',
                    icon: 'ability-level-type',
                    title: `Level All (${info.levelUp.all.count})`,
                    desc: 'Level every ready pack of this type at once.',
                    cost: info.levelUp.all.cost,
                    state: info.levelUp.all.affordable ? 'buy' : 'locked',
                });
            }
        }
        // a tower's upgrade is its leveling — same spot, same icon as a unit's
        if (!levelOnBar && info.towerUpgrade) {
            const tu = info.towerUpgrade;
            levelTiles.push({
                data: 'data-towerupgrade="1"',
                icon: 'ability-level',
                title: tu.maxed ? `Max level (${info.level})` : `Upgrade — level ${info.level + 1}`,
                desc: 'Raise this building one level: it gains its base HP. No XP needed, price rises each level.',
                cost: tu.maxed ? undefined : tu.cost,
                state: tu.maxed ? 'owned' : tu.affordable ? 'buy' : 'locked',
            });
        }
        for (const b of info.boosts ?? []) {
            tiles.push({
                data: `data-boost="${b.id}"`,
                icon: b.id === 'attack' ? 'ability-atk-boost' : 'ability-hp-boost',
                title: b.label,
                desc:
                    b.id === 'attack'
                        ? 'Permanent army-wide damage boost. Buy one tier after the other.'
                        : 'Permanent army-wide HP boost. Buy one tier after the other.',
                cost: b.cost,
                state: b.maxed ? 'owned' : b.affordable ? 'buy' : 'locked',
            });
        }
        if (info.deploySlot) {
            tiles.push({
                data: 'data-deployslot="1"',
                icon: 'ability-plus-deploy',
                title: '+1 Deployment',
                desc: 'One extra unit purchase this round only.',
                cost: info.deploySlot.cost,
                state: info.deploySlot.active ? 'owned' : info.deploySlot.affordable ? 'buy' : 'locked',
            });
        }
        if (info.recruit) {
            tiles.push({
                data: 'data-recruit="1"',
                icon: 'ability-plus-l2',
                title: 'Recruit at Level 2',
                desc: 'For the rest of this round, units you buy arrive at level 2 (they still pay the level premium).',
                cost: info.recruit.cost,
                state: info.recruit.active ? 'owned' : info.recruit.affordable ? 'buy' : 'locked',
            });
        }
        if (info.rangeBoost) {
            tiles.push({
                data: 'data-rangeboost="1"',
                icon: 'ability-range',
                title: 'Range Boost',
                desc: `+${info.rangeBoost.bonus} range for all ranged units, this round only.`,
                cost: info.rangeBoost.cost,
                state: info.rangeBoost.active ? 'owned' : info.rangeBoost.affordable ? 'buy' : 'locked',
            });
        }
        if (info.speedBoost) {
            tiles.push({
                data: 'data-speedboost="1"',
                icon: 'ability-speed',
                title: 'Speed Boost',
                desc: `+${info.speedBoost.bonus} speed for all units, this round only.`,
                cost: info.speedBoost.cost,
                state: info.speedBoost.active ? 'owned' : info.speedBoost.affordable ? 'buy' : 'locked',
            });
        }
        if (info.credit) {
            tiles.push({
                data: 'data-credit="1"',
                icon: 'ability-credit',
                title: 'Credit',
                desc: `+${info.credit.gain} supply now. Next deployment: −${info.credit.debt}. Once per round.`,
                cost: info.credit.active ? undefined : -info.credit.gain,
                state: info.credit.active ? 'owned' : info.credit.affordable ? 'buy' : 'locked',
            });
        }
        if (info.sellAbility) {
            tiles.push({
                data: 'data-sellability="1"',
                icon: 'ability-selling',
                title: 'Unlock Selling',
                desc: 'Permanently unlock selling packs (up to one per deployment phase).',
                cost: info.sellAbility.cost,
                state: info.sellAbility.owned ? 'owned' : info.sellAbility.affordable ? 'buy' : 'locked',
            });
        }
        if (info.sendSupply) {
            tiles.push({
                data: 'data-sendsupply="1"',
                icon: 'ability-gift-supply',
                title: `Send ${info.sendSupply.amount} to Ally`,
                desc: `Gift ${info.sendSupply.amount} supply to your ally — arrives at the start of next round.`,
                state: info.sendSupply.affordable ? 'buy' : 'locked',
            });
        }
        if (info.rallyRouteAbility) {
            tiles.push({
                data: 'data-rallyroute="1"',
                icon: 'tactic-rally',
                title: 'Buy Rally Route',
                desc: `Add one rally-route charge to your ${DISPLAY.tactics.toLowerCase()}. Once per match.`,
                cost: info.rallyRouteAbility.cost,
                state: info.rallyRouteAbility.owned
                    ? 'owned'
                    : info.rallyRouteAbility.affordable
                      ? 'buy'
                      : 'locked',
            });
        }
        if (info.movePackAbility) {
            tiles.push({
                data: 'data-movepack="1"',
                icon: 'ui-move',
                title: 'Buy Move Pack',
                desc: `Add one move-pack charge to your ${DISPLAY.tactics.toLowerCase()}: re-open one pack from an earlier round for repositioning. Once per match.`,
                cost: info.movePackAbility.cost,
                state: info.movePackAbility.owned
                    ? 'owned'
                    : info.movePackAbility.affordable
                      ? 'buy'
                      : 'locked',
            });
        }
        // unit techs render in their own slotted row (see techSlotsHtml below)
        const actions = this.renderActionTiles(tiles);
        const levelActions = this.renderActionTiles(levelTiles, 'level-actions');
        const techSlots = this.renderTechSlots(info.techs);
        // packs show that type's item slots (empty = dark circle); structures hide them
        const itemSlotCount = info.itemSlotCount ?? 0;
        const itemSquares =
            info.structure || itemSlotCount <= 0
                ? ''
                : `<div class="item-row">${Array.from({ length: itemSlotCount }, (_, i) => {
                      const item = info.items?.[i];
                      if (!item) {
                          const slot = i + 1;
                          const drop = info.itemDropReady ? ' drop-target' : '';
                          return (
                              `<span class="item-sq empty${drop}" data-ttitle="${DISPLAY.item} slot ${slot}" data-tdesc="${
                                  info.itemDropReady
                                      ? `Drop your armed ${DISPLAY.item.toLowerCase()} here to equip it on this pack.`
                                      : `Empty — equip a ${DISPLAY.item.toLowerCase()} from your inventory onto this pack.`
                              }"></span>`
                          );
                      }
                          const removeHint =
                              inputMode() === 'touch'
                                  ? `Drag off to return this ${DISPLAY.item.toLowerCase()} to your bag (this deploy only).`
                                  : `Click or drag off to return this ${DISPLAY.item.toLowerCase()} to your bag (this deploy only).`;
                          return (
                          `<span class="item-sq m-icon${item.removable ? ' removable' : ''}" style="${iconCss(item.icon)}" data-ttitle="${escapeAttr(item.name)}" data-tdesc="${escapeAttr(
                              item.removable
                                  ? `${item.desc ?? item.name}\n${removeHint}`
                                  : (item.desc ?? item.name),
                          )}" data-ticon="${escapeAttr(item.icon)}"${
                              item.removable && info.unitId !== undefined && item.id
                                  ? ` data-item-id="${escapeAttr(item.id)}" data-item-slot="${i}" data-unit-id="${info.unitId}"`
                                  : ''
                          }></span>`
                      );
                  }).join('')}</div>`;
        const forge = info.forge;
        const forgeSquares = !forge
            ? ''
            : `<div class="forge-block${forge.bake ? ' ready' : ''}">` +
              `<div class="forge-label">Forge${forge.bake ? ' · ready' : ''}</div>` +
              `<div class="item-row forge-row">${Array.from({ length: forge.slotCount }, (_, i) => {
                  const item = forge.slots[i];
                  if (!item) {
                      const suggest = forge.suggestions?.[i];
                      if (suggest) {
                          const ingIcons = suggest.itemIds
                              .map((id) => ITEMS[id]?.icon)
                              .filter((id): id is string => !!id);
                          return (
                              `<span class="item-sq m-icon forge-suggest" style="${iconCss(suggest.icon)}" ` +
                              `data-forge-fill="${escapeAttr(suggest.itemIds.join(','))}" ` +
                              `data-forge-ings="${escapeAttr(ingIcons.join(','))}" ` +
                              `data-ttitle="${escapeAttr(suggest.name)}" ` +
                              `data-tdesc="${escapeAttr(`${suggest.desc}\nClick to place these ${DISPLAY.items.toLowerCase()} in the forge.`)}" ` +
                              `data-ticon="${escapeAttr(suggest.icon)}"></span>`
                          );
                      }
                      const slot = i + 1;
                      const drop = forge.dropReady ? ' drop-target' : '';
                      return (
                          `<span class="item-sq empty${drop}" data-ttitle="Forge slot ${slot}" data-tdesc="${
                              forge.dropReady
                                  ? `Drop a ${DISPLAY.item.toLowerCase()} here — it forges next deploy.`
                                  : `Empty forge slot — equip a ${DISPLAY.item.toLowerCase()} from your bag.`
                          }"></span>`
                      );
                  }
                  const removeHint =
                      inputMode() === 'touch'
                          ? `Drag off to return this ${DISPLAY.item.toLowerCase()} to your bag (this deploy only).`
                          : `Click or drag off to return this ${DISPLAY.item.toLowerCase()} to your bag (this deploy only).`;
                  return (
                      `<span class="item-sq m-icon${item.removable ? ' removable' : ''}" style="${iconCss(item.icon)}" data-ttitle="${escapeAttr(item.name)}" data-tdesc="${escapeAttr(
                          item.removable
                              ? `${item.desc}\n${removeHint}`
                              : item.desc,
                      )}" data-ticon="${escapeAttr(item.icon)}" data-item-id="${escapeAttr(item.id)}"${
                          item.removable
                              ? ` data-forge="1" data-item-slot="${i}"`
                              : ''
                      }></span>`
                  );
              }).join('')}` +
              (forge.bake
                  ? `<span class="forge-bake-arrow" aria-hidden="true">→</span>` +
                    `<span class="item-sq m-icon forge-bake" style="${iconCss(forge.bake.icon)}" ` +
                    `data-spell-tip="1" ` +
                    `data-ttitle="${escapeAttr(forge.bake.name)}" ` +
                    `data-tdesc="${escapeAttr(`${forge.bake.desc}\nBurns into this ${DISPLAY.tactic.toLowerCase()} next deploy.`)}" ` +
                    `data-ticon="${escapeAttr(forge.bake.icon)}" ` +
                    `data-forge-ings="${escapeAttr((forge.bake.ingredientIcons ?? []).join(','))}"></span>`
                  : '') +
              `</div>` +
              (forge.hint
                  ? `<div class="forge-hint">${escapeHtml(forge.hint)}</div>`
                  : '') +
              `</div>`;
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
            forgeSquares +
            row('Hits', info.hits) +
            liveRow('HP', `${Math.max(0, Math.round(info.hp))} / ${Math.round(info.maxHp)}`, 'hp') +
            (info.total > 1 ? row('Pack', `${info.alive} / ${info.total}`) : '') +
            row('Level', levelLabel) +
            row('Damage', String(Math.round(info.damage))) +
            row('Reload', `${Math.round(info.attackInterval * 10) / 10}s`) +
            (info.splash ? row('Splash', String(info.splash)) : '') +
            row('Range', info.minRange ? `${info.minRange} - ${info.range}` : String(info.range)) +
            row('Speed', String(info.speed)) +
            (info.record
                ? liveRow('Total dmg', String(Math.round(info.record.damageDealt)), 'dmg') +
                  liveRow('Kills', String(info.record.kills), 'kills')
                : '') +
            techSlots +
            actions +
            `<div class="action-info" style="display:none"></div>`;
    }

    /**
     * Refresh only the live-ticking stat values (HP, total damage, kills) in the
     * already-built details panel, without rebuilding its DOM. Called every frame
     * a mech stays selected in battle so the panel stays cheap.
     */
    private patchLiveStats(info: SelectionInfo): void {
        const set = (id: string, text: string) => {
            const el = this.panel.querySelector<HTMLElement>(`.v[data-live="${id}"]`);
            if (el && el.textContent !== text) el.textContent = text;
        };
        set('hp', `${Math.max(0, Math.round(info.hp))} / ${Math.round(info.maxHp)}`);
        if (info.record) {
            set('dmg', String(Math.round(info.record.damageDealt)));
            set('kills', String(info.record.kills));
        }
    }

    /**
     * One tile per tech slot for this pack — filled slots are buyable action
     * tiles; unused slots are dark empty plates. Produce techs show a circular
     * progress ring toward the next spawn.
     */
    private renderTechSlots(
        techs: SelectionInfo['techs'],
    ): string {
        if (!techs?.length) return '';
        const cells = techs
            .map((t, i) => {
                if (t.empty) {
                    const slot = i + 1;
                    return (
                        `<span class="action-tile empty" data-ttitle="${DISPLAY.tech} slot ${slot}" data-tdesc="Empty — no ${DISPLAY.tech.toLowerCase()} selected for this slot."></span>`
                    );
                }
                const produce = t.produce;
                const produceNote = produce
                    ? produce.done
                        ? `Production complete (${produce.released}/${produce.max}).`
                        : `Producing… ${produce.released}/${produce.max} · ${Math.round(produce.progress * 100)}% to next.`
                    : '';
                const badge = produce
                    ? `<span class="at-badge produce-count">${produce.released}/${produce.max}</span>`
                    : t.owned
                      ? `<span class="at-badge">✓</span>`
                      : t.cost !== undefined
                        ? `<span class="at-cost">${t.cost}</span>`
                        : '';
                const state = t.owned ? 'owned' : t.affordable ? 'buy' : 'locked';
                const ring = produce
                    ? `<span class="at-produce${produce.done ? ' done' : ''}" style="--p:${produce.progress}">` +
                      `<span class="at-produce-ring" aria-hidden="true"></span>` +
                      `<span class="at-icon m-icon" style="${iconCss(t.icon)}"></span></span>`
                    : `<span class="at-icon m-icon" style="${iconCss(t.icon)}"></span>`;
                return (
                    `<button class="action-tile ${state}${produce ? ' producing' : ''}" data-tech="${t.id}"` +
                    ` data-ttitle="${escapeAttr(t.name)}" data-tdesc="${escapeAttr(t.desc)}"` +
                    ` data-ticon="${escapeAttr(t.icon)}" data-tcost="${t.cost}"` +
                    ` data-tstate="${state}" data-tnote="${escapeAttr(produceNote)}">` +
                    `${ring}${badge}</button>`
                );
            })
            .join('');
        return `<div class="action-row tech-slots">${cells}</div>`;
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
                    const levelIcon = t.icon.startsWith('ability-level');
                    const icoClass = levelIcon ? 'at-icon m-icon mask-ico' : 'at-icon m-icon';
                    const icoStyle = levelIcon ? iconMaskCss(t.icon) : iconCss(t.icon);
                    return (
                        `<button class="action-tile ${t.state}" ${t.data}` +
                        ` data-ttitle="${escapeAttr(t.title)}" data-tdesc="${escapeAttr(t.desc)}"` +
                        ` data-ticon="${escapeAttr(t.icon)}" data-tcost="${t.cost ?? ''}"` +
                        ` data-tstate="${t.state}" data-tnote="${escapeAttr(t.note ?? '')}">` +
                        `<span class="${icoClass}" style="${icoStyle}"></span>${badge}</button>`
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
                  ? `<span class="ai-cost${Number(cost) < 0 ? ' refund' : ''}">${Number(cost) < 0 ? moneyHtml(`+${-Number(cost)}`) : moneyHtml(cost)}</span>`
                  : '';
        const note = d.tnote ? `<div class="ai-note">${d.tnote}</div>` : '';
        const touchBuy =
            inputMode() === 'touch' && state === 'buy'
                ? `<button type="button" class="ai-buy">Buy${cost ? ` · ${moneyHtml(cost)}` : ''}</button>`
                : '';
        const levelIcon = !!d.ticon?.startsWith('ability-level');
        frame.innerHTML =
            spellInfoFrameHtml({
                title: d.ttitle ?? '',
                desc: d.tdesc ?? '',
                icon: d.ticon,
                ingredientIcons: (d.forgeIngs ?? '').split(',').filter(Boolean),
                levelIcon,
            }) +
            note +
            costLine +
            touchBuy;
        frame.style.display = 'block';
        this.actionInfoFor = tile;
        // let the world react to a focused tech tile (e.g. Golden Aura ring)
        this.onTechHover?.(d.tech ?? null);
        this.syncForgeSlotHoverPreview(tile);
        frame.querySelector<HTMLButtonElement>('.ai-buy')?.addEventListener('click', (e) => {
            e.stopPropagation();
            // while actionInfoFor === tile, the delegated handler treats this
            // as the confirming second tap and performs the buy
            tile.click();
            this.hideActionInfo();
        });
    }

    private hideActionInfo(opts?: { keepRecipes?: boolean }): void {
        const frame = this.panel.querySelector<HTMLDivElement>('.action-info');
        if (frame) frame.style.display = 'none';
        this.actionInfoFor = null;
        this.onTechHover?.(null);
        if (!opts?.keepRecipes && !this.forgeRecipesPinned) this.hideForgeSlotHoverPreview();
    }

    setPhase(
        round: number,
        phase: Phase,
        remainingSeconds: number,
        waitingForPeer = false,
        allyLockedIn = false,
        // a spectator is ALWAYS `waitingForPeer` (nothing here is ever
        // theirs to act on, so the whole build UI hides the same way a
        // locked-in player's does) but that's not an actual "waiting on
        // someone" state worth announcing — they should just see the real
        // round/phase like anyone else watching. Only suppress the round
        // label for a genuine player-side wait.
        watching = false,
    ): void {
        this.roundEl.textContent =
            waitingForPeer && !watching
                ? 'Waiting for opponent'
                : round === 0
                  ? DISPLAY.commanders
                  : `Round ${round}`;
        const s = Math.max(0, Math.ceil(remainingSeconds));
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.topBar.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        // last 5s of deployment — pulse so the player knows to hurry
        this.timerEl.classList.toggle(
            'urgent',
            phase === 'build' && !waitingForPeer && s > 0 && s <= 5,
        );
        // locked in: only spectating remains — no buying, no ending twice
        this.topBar.classList.toggle('waiting', waitingForPeer);
        // teammate (same side, team modes) has already locked in but I
        // haven't yet — a visible cue on the button itself, since I still
        // see the normal button (my side isn't "waiting" until I click too).
        // Once I click myself, waitingForPeer covers it — full hide, same
        // as classic 1v1's "locked in" treatment (see game.ts's waitingForPeer).
        this.endButton.classList.toggle('ally-ready', allyLockedIn && !waitingForPeer);
        this.endButton.title = allyLockedIn && !waitingForPeer ? 'Your ally is ready — waiting on you' : '';
        this.fightBar.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        this.fightBar.classList.toggle('waiting', waitingForPeer);
        this.shopColumn.classList.toggle('disabled', phase !== 'build' || waitingForPeer);
        this.shopColumn.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        // locked in: nothing left to buy/use/undo — hide our own action UI
        // entirely (not just dim it). The enemy's sidebar stays up (its
        // items are already `readonly` display, not action buttons) since
        // we can still watch what they're doing.
        this.inventoryEl.classList.toggle('waiting', waitingForPeer);
        this.inventoryEl.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        this.enemyInventoryEl.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        this.phoneBar.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        this.phoneStatusEl.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        // battle: the chat leaves the bar and becomes the normal floating bar
        this.chatBarWidget.el.classList.toggle('battle', phase === 'battle' || phase === 'hpDraw');
        if ((phase === 'battle' || phase === 'hpDraw') && (this.phoneTab === 'shop' || this.phoneTab === 'chat')) {
            this.setPhoneTab(null);
        }
    }

    /** Game's live speed steps — drives the button tooltip's key hint. */
    setSpeedSteps(steps: readonly number[]): void {
        const pause = steps[0] === 0 ? ' (1 = Pause)' : '';
        this.speedEl.title =
            `Battle speed — click: faster, right click: slower; ` +
            `${speedKeyHint(steps).toLowerCase()}${pause}`;
    }

    setSpeed(multiplier: number): void {
        this.speedEl.textContent = multiplier === 0 ? 'Pause' : `${multiplier}×`;
    }

    /** watch mode replaces this with its own wider-range speed control
     *  (replayControls.ts) — set once, never toggled back (a Game instance's
     *  watching-ness never changes for its lifetime) */
    setSpeedButtonVisible(visible: boolean): void {
        this.speedEl.style.display = visible ? '' : 'none';
    }

    setHp(player: number, enemy: number, playerMax?: number, enemyMax?: number): void {
        // Prefer authoritative match peaks (reconnect/hydrate). Fall back to
        // grow-from-current only when the caller didn't pass a max yet.
        if (playerMax !== undefined && playerMax > this.playerMaxHp) this.playerMaxHp = playerMax;
        else if (playerMax === undefined && player > this.playerMaxHp) this.playerMaxHp = player;
        if (enemyMax !== undefined && enemyMax > this.enemyMaxHp) this.enemyMaxHp = enemyMax;
        else if (enemyMax === undefined && enemy > this.enemyMaxHp) this.enemyMaxHp = enemy;
        // 0/0 before any pick: empty fill (not NaN). After a grant, peak equals
        // current so the bar reads full — including mid-pick in 2v2 when only
        // one teammate has chosen yet.
        const p = this.playerMaxHp > 0 ? Math.max(0, Math.min(1, player / this.playerMaxHp)) : 0;
        const e = this.enemyMaxHp > 0 ? Math.max(0, Math.min(1, enemy / this.enemyMaxHp)) : 0;
        // Allow negative labels on the killing blow — overkill is interesting
        const pRound = Math.round(player);
        const eRound = Math.round(enemy);
        // Avoid rewriting transform every frame — CSS transition + per-tick
        // style assignment makes the fightbar HP look like it flickers on hover.
        if (
            p === this.lastHpFillP &&
            e === this.lastHpFillE &&
            pRound === this.lastHpValP &&
            eRound === this.lastHpValE
        ) {
            return;
        }
        this.lastHpFillP = p;
        this.lastHpFillE = e;
        this.lastHpValP = pRound;
        this.lastHpValE = eRound;
        this.playerHpFill.style.transform = `scaleX(${p})`;
        this.enemyHpFill.style.transform = `scaleX(${e})`;
        this.playerHpVal.style.setProperty('--hp', String(p));
        this.enemyHpVal.style.setProperty('--hp', String(e));
        // Full / nearly-full: keep the label inside the fill. Once there's a
        // clear empty stretch, park it just past the tip in the empty track.
        const labelOutside = (ratio: number) => ratio < 0.9;
        this.playerHpVal.classList.toggle('outside', labelOutside(p));
        this.enemyHpVal.classList.toggle('outside', labelOutside(e));
        this.playerHpVal.textContent = String(pRound);
        this.enemyHpVal.textContent = String(eRound);
    }

    /** Screen center of a team's HP bar track (for post-battle damage particles). */
    getHpBarScreenCenter(team: 'player' | 'enemy'): { x: number; y: number } | null {
        const fill = team === 'player' ? this.playerHpFill : this.enemyHpFill;
        if (!fill?.isConnected) return null;
        const r = fill.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) return null;
        return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
    }

    /** post-battle damage report; replaces the previous one, dismissible */
    showBattleReport(round: number, rows: { name: string; team: string; damage: number }[]): void {
        this.hideBattleReport();
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
            this.unmount(el);
            if (this.report === el) this.report = null;
        });
        this.report = el;
        this.mount(el);
    }

    hideBattleReport(): void {
        if (this.report) this.unmount(this.report);
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
     * Full-screen overlays (card picks, pause, match settings) own the
     * screen: the phone tab bar and field-action buttons step aside. The
     * topbar keeps its original cards-only rule (a card pick or the
     * settings panel blocks End Deployment and speed controls; pause does
     * not — pause already stops everything itself). Commander HP strips
     * hide for the same overlays — they sit above `.mechili-cards` so
     * specialist peek still works, but during an actual pick they only
     * steal taps / clutter the screen. Specialist-detail peek does NOT
     * set `cardOverlay`, so the strips stay for that.
     */
    private syncOverlayOpen(): void {
        const blocksTopBar =
            this.cardOverlay !== null || this.settingsDetailOverlay !== null;
        const open = blocksTopBar || this.pauseMenu !== null;
        this.topBar.classList.toggle('overlay-open', blocksTopBar);
        this.phoneBar.classList.toggle('overlay-open', open);
        this.phoneStatusEl.classList.toggle('overlay-open', open);
        this.fightBar.classList.toggle('overlay-open', open);
    }

    hidePauseMenu(): void {
        if (this.pauseMenu) this.unmount(this.pauseMenu);
        this.pauseMenu = null;
        this.syncOverlayOpen();
    }

    /** dismisses the specialist or round-card picker if it is still open */
    hideCardOverlay(): void {
        if (!this.cardOverlay) return;
        this.hideCardSpellTip();
        this.removeCardOverlayElement(this.cardOverlay);
        this.cardOverlay = null;
        this.cardIntroFading = false;
        this.syncOverlayOpen();
    }

    private removeCardOverlayElement(el: HTMLElement): void {
        this.unmount(el);
    }

    /** specialist pick — collapse to own card, wobble, fly to commander frame */
    confirmSpecialistPick(chosen: HTMLElement, onDone: () => void): void {
        const overlay = this.cardOverlay;
        if (!overlay) {
            onDone();
            return;
        }
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('picking');
        chosen.classList.add('chosen');

        window.setTimeout(() => {
            overlay.classList.remove('picking');
            overlay.classList.add('locked');
            overlay.querySelector('.cards-title')?.remove();
            overlay.querySelector('.cards-note')?.remove();
            const row = overlay.querySelector<HTMLElement>('.cards-row');
            if (!row) {
                onDone();
                return;
            }
            let cardEl: HTMLElement = chosen;
            for (const el of [...row.querySelectorAll<HTMLElement>('.card')]) {
                if (el !== chosen) el.classList.add('faded');
            }
            if (chosen instanceof HTMLButtonElement) {
                chosen.disabled = true;
                chosen.classList.remove('chosen');
                chosen.classList.add('static', 'locked-card');
                cardEl = chosen;
            } else {
                chosen.classList.remove('chosen');
                chosen.classList.add('static', 'locked-card');
            }

            window.setTimeout(() => {
                cardEl.classList.add('wobble');
                window.setTimeout(() => {
                    cardEl.classList.remove('wobble');
                    this.flyCardToCommander(cardEl, overlay, () => {
                        this.cardOverlay = null;
                        this.cardIntroFading = false;
                        this.syncOverlayOpen();
                        this.removeCardOverlayElement(overlay);
                        onDone();
                    });
                }, 480);
            }, 60);
        }, 280);
    }

    private flyCardToCommander(
        card: HTMLElement,
        overlay: HTMLElement,
        onDone: () => void,
    ): void {
        // stacks were hidden for the pick (overlay-open); bring them back so
        // the fly target / land pulse have a real rect to aim at
        this.fightBar.classList.remove('overlay-open');
        overlay.classList.add('flying');
        const from = card.getBoundingClientRect();
        const chip = this.commanderChips.find((c) => c.seat === this.humanSeat);
        if (!chip) {
            onDone();
            return;
        }
        const to = chip.cardEl.getBoundingClientRect();
        const tx = to.left + to.width * 0.5 - (from.left + from.width * 0.5);
        const ty = to.top + to.height * 0.5 - (from.top + from.height * 0.5);
        const scale = Math.min(0.18, (to.width * 0.92) / from.width);
        card.style.transition =
            'transform 0.55s cubic-bezier(0.5, 0, 0.75, 0.4), opacity 0.5s ease-in';
        requestAnimationFrame(() => {
            card.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            card.style.opacity = '0';
        });
        window.setTimeout(() => this.pulseCommanderFrame(this.humanSeat), 420);
        window.setTimeout(onDone, 580);
    }

    /** pick confirmed — dim others, lift chosen in place, then fade before callback */
    private dismissPickOverlay(
        chosen: HTMLElement | null,
        style: 'lift' | 'fade',
        onDone: () => void,
    ): void {
        const overlay = this.cardOverlay;
        if (!overlay) {
            onDone();
            return;
        }
        overlay.style.pointerEvents = 'none';
        this.cardOverlay = null;
        this.cardIntroFading = false;
        this.syncOverlayOpen();

        if (style === 'lift' && chosen) {
            overlay.classList.add('picking');
            chosen.classList.add('chosen');
            window.setTimeout(() => {
                overlay.classList.add('dismissing');
                window.setTimeout(() => {
                    this.removeCardOverlayElement(overlay);
                    onDone();
                }, 280);
            }, 380);
            return;
        }

        overlay.classList.add('dismissing');
        window.setTimeout(() => {
            this.removeCardOverlayElement(overlay);
            onDone();
        }, 280);
    }

    /** fade out a picker overlay */
    fadeOutCardOverlay(onDone?: () => void): void {
        this.dismissPickOverlay(null, 'fade', () => onDone?.());
    }

    private pulseCommanderFrame(seat: number): void {
        const chip = this.commanderChips.find((c) => c.seat === seat);
        if (!chip) return;
        const el = chip.cardEl;
        el.classList.remove('landed-pulse');
        void el.offsetWidth;
        el.classList.add('landed-pulse');
        el.addEventListener(
            'animationend',
            () => el.classList.remove('landed-pulse'),
            { once: true },
        );
    }

    /** dismiss game-over, pause, notices, reconnect, and card pickers before the menu outro */
    hideMatchOverlays(): void {
        this.hidePauseMenu();
        this.hideCardOverlay();
        this.hideNotice();
        this.hideReconnectWait();
        this.hideBattleReport();
        this.hideSpecialistDetail();
        this.hideSettingsDetail();
        this.hideForgeSlotHoverPreview();
        document.querySelector('.mechili-touchtip')?.remove();
        closeSettings();
        for (let i = this.mountedRoots.length - 1; i >= 0; i--) {
            const el = this.mountedRoots[i]!;
            if (!el.classList.contains('mechili-gameover')) continue;
            this.unmount(el);
        }
        this.syncOverlayOpen();
    }

    private showCardOverlay(overlay: HTMLDivElement): void {
        this.hideCardOverlay();
        // phone: an open sheet (e.g. the shop behind the unlock picker) would
        // show through the overlay's dim layer — close it first
        this.setPhoneTab(null);
        this.bindCardSpellTips(overlay);
        this.cardOverlay = overlay;
        this.syncOverlayOpen();
        this.mount(overlay);
        if (this.introChromeHidden) {
            // mount() hides everything during the fly-in — card picks fade in
            // on their own schedule instead of popping after the camera lands
            overlay.classList.remove('mechili-intro-hide');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            this.cardIntroFading = true;
        }
    }

    /** driven each intro tick while a card overlay is fading in */
    setCardOverlayIntroOpacity(opacity: number): void {
        if (!this.cardOverlay || !this.cardIntroFading) return;
        this.cardOverlay.style.opacity = String(opacity);
    }

    /** intro finished — card overlay is fully visible and clickable */
    finishCardOverlayIntro(): void {
        if (!this.cardOverlay) return;
        this.cardIntroFading = false;
        this.cardOverlay.style.opacity = '';
        // keep auto — match-ui-root is pointer-events:none, so '' alone is not enough
        // on some engines once an inline none was set during the fade-in
        this.cardOverlay.style.pointerEvents = 'auto';
    }

    private showPauseMenu(): void {
        this.hidePauseMenu();
        const el = document.createElement('div');
        el.className = 'mechili-pause';
        el.innerHTML =
            `<div class="pause-box">` +
            `<div class="pause-title">Menu</div>` +
            `<button type="button" class="pause-resume">Continue</button>` +
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
        this.syncOverlayOpen();
        this.mount(el);
    }

    /** persistent topbar indicator: eye + count, hidden while nobody's
     *  watching. Click expands the full name list (with live-grant
     *  checkboxes, when `onGrantSpectatorLive` is wired — a spectating
     *  client itself never wires that, so its own badge lists plain names). */
    setSpectators(names: string[]): void {
        this.lastSpectatorNames = names;
        this.spectatorBadgeEl.style.display = names.length === 0 ? 'none' : '';
        this.spectatorBadgeEl.textContent = `\u{1F441} ${names.length}`;
        if (names.length === 0) {
            this.spectatorListEl?.remove();
            this.spectatorListEl = null;
            return;
        }
        if (this.spectatorListEl) this.renderSpectatorList();
    }

    private toggleSpectatorList(): void {
        if (this.spectatorListEl) {
            this.spectatorListEl.remove();
            this.spectatorListEl = null;
            return;
        }
        this.renderSpectatorList();
    }

    private renderSpectatorList(): void {
        this.spectatorListEl?.remove();
        const el = document.createElement('div');
        el.className = 'spectator-list';
        const canGrant = this.onGrantSpectatorLive !== null;
        el.innerHTML = this.lastSpectatorNames
            .map((name) =>
                canGrant
                    ? `<label class="spectator-row">` +
                      `<input type="checkbox" data-spectate-name="${escapeAttr(name)}" />` +
                      `<span>${escapeHtml(name)}</span>` +
                      `</label>`
                    : `<div class="spectator-row"><span>${escapeHtml(name)}</span></div>`,
            )
            .join('');
        for (const input of el.querySelectorAll<HTMLInputElement>('input[data-spectate-name]')) {
            input.addEventListener('change', () => {
                const name = input.dataset.spectateName;
                if (name) this.onGrantSpectatorLive?.(name, input.checked);
            });
        }
        this.spectatorListEl = el;
        this.topBar.append(el);
    }

    /** the face of a specialist card (static data only — safe for innerHTML) */
    private startCardFace(c: StartCard): string {
        return startCardFaceHtml(c);
    }

    /** the pre-round-1 loadout pick: four cards, click one, the game begins.
     *  `note` (team modes only) clarifies who decides the shared speciality —
     *  set via textContent, never innerHTML, since it can embed a player name. */
    showStartCards(
        cards: readonly StartCard[],
        note: string | undefined,
        onPick: (cardId: string) => void,
    ): void {
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">Choose your ${DISPLAY.commander.toLowerCase()}</div>` +
            (note ? `<div class="cards-note"></div>` : '') +
            `<div class="cards-row">` +
            cards
                .map((c) => `<button class="card" data-card="${c.id}">${this.startCardFace(c)}</button>`)
                .join('') +
            `</div>`;
        if (note) overlay.querySelector('.cards-note')!.textContent = note;
        overlay.addEventListener('click', (e) => {
            const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card) return;
            const cardId = button.dataset.card;
            this.confirmSpecialistPick(button, () => onPick(cardId));
        });
        this.showCardOverlay(overlay);
    }

    /** per-seat specialist labels — null card hides that commander's pick */
    setSeatSpecialists(entries: { seat: number; card: StartCard | null }[]): void {
        for (const { seat, card } of entries) {
            const chip = this.commanderChips.find((c) => c.seat === seat);
            if (!chip) continue;
            const same = chip.card === card;
            chip.card = card;
            chip.cardEl.classList.toggle('has-spec', card !== null);
            // replaceChildren flashes the portrait — skip when nothing changed
            if (!same) this.applyPortrait(chip.portraitEl, chip.avatar, card);
        }
        this.updateTeamSpecTitles();
        if (this.specDetailSeat !== null) {
            this.showSpecialistDetail(this.specDetailSeat, this.specDetailViaHover);
        }
    }

    private updateTeamSpecTitles(): void {
        if (this.playerSpecEl) {
            const playerSeats = this.commanderChips.filter((c) => c.team === 'player');
            const titles = playerSeats.map((c) => c.card?.title).filter((t): t is string => Boolean(t));
            this.playerSpecEl.textContent = titles.join(' & ');
        }
        if (this.enemySpecEl) {
            const enemySeats = this.commanderChips.filter((c) => c.team === 'enemy');
            const titles = enemySeats.map((c) => c.card?.title).filter((t): t is string => Boolean(t));
            this.enemySpecEl.textContent = titles.join(' & ');
        }
    }

    /** @deprecated use setSeatSpecialists */
    setSpecialities(own: StartCard | null, opponent: StartCard | null): void {
        this.setSeatSpecialists([
            { seat: 0, card: own },
            { seat: 1, card: opponent },
        ]);
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
        if (this.specDetailSeat !== null) {
            this.showSpecialistDetail(this.specDetailSeat, this.specDetailViaHover);
        }
    }

    /** a dismissible popup showing all team members' specialist cards on one screen (frame click or hover) */
    private showSpecialistDetail(seat: number, viaHover = false): void {
        const targetChip = this.commanderChips.find((c) => c.seat === seat);
        if (!targetChip) return;
        const team = targetChip.team;
        const teamChips = this.commanderChips.filter((c) => c.team === team);

        const picks = team === 'player' ? this.playerRoundPicks : this.enemyRoundPicks;
        const hasContent = teamChips.some((c) => c.card !== null) || picks.length > 0;
        if (!hasContent) return;

        const contentKey =
            `${seat}|${viaHover ? 1 : 0}|` +
            teamChips.map((c) => `${c.seat}:${c.card?.id ?? ''}:${c.name}`).join(',') +
            `|${picks.map((p) => `${p.round}:${p.title}:${p.body}`).join(';')}`;
        // Remounting every refresh flashes the full-screen dim over the HP bars.
        if (this.specDetailOverlay && this.lastSpecDetailKey === contentKey) return;
        this.lastSpecDetailKey = contentKey;

        // avoid stacking duplicate overlays
        if (this.specDetailOverlay) this.unmount(this.specDetailOverlay);

        const overlay = document.createElement('div');
        overlay.className = `mechili-cards detail${viaHover ? ' peek' : ''}`;

        const colsHtml = teamChips
            .map((chip) => {
                const card = chip.card;
                const specHtml = card
                    ? `<div class="spec-card-row">` +
                      `<div class="card static">${this.startCardFace(card)}</div>` +
                      `</div>`
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
                return (
                    `<div class="card-col ${chip.team}">` +
                    `<div class="c-owner ${chip.team}">${escapeHtml(chip.name)}</div>` +
                    specHtml +
                    picksHtml +
                    `</div>`
                );
            })
            .join('');

        overlay.innerHTML = `<div class="cards-row">${colsHtml}</div>`;
        overlay.addEventListener('click', () => this.hideSpecialistDetail());
        this.bindCardSpellTips(overlay);
        this.specDetailOverlay = overlay;
        this.specDetailSeat = seat;
        this.specDetailViaHover = viaHover;
        // the enemy's unplaced items are intel that belongs to this screen
        this.enemyInventoryEl.classList.toggle('reveal', team === 'enemy');
        this.mount(overlay);
    }

    /** forge recipe list — bagIds/forgeIds are that side's runes for ownership marks */
    /**
     * Memoized wrapper: the recipe grid HTML is pure over its inputs, so cache
     * the last result. Buying a rune re-fires the panel refresh (sometimes twice
     * in one frame, via setInventory + setForgeRecipeContext) — this makes the
     * repeat builds free instead of recomputing/sorting every recipe each time.
     */
    private forgeRecipesMemoKey = '';
    private forgeRecipesMemoHtml = '';
    private forgeRecipesBlockHtml(
        pool: readonly string[],
        bagIds: readonly string[],
        forgeIds: readonly string[],
        highlightRuneId: string | null = null,
    ): string {
        const memoKey =
            `${pool.join(',')}${bagIds.join(',')}` +
            `${forgeIds.join(',')}${highlightRuneId ?? ''}`;
        if (memoKey === this.forgeRecipesMemoKey) return this.forgeRecipesMemoHtml;
        const html = this.buildForgeRecipesBlockHtml(pool, bagIds, forgeIds, highlightRuneId);
        this.forgeRecipesMemoKey = memoKey;
        this.forgeRecipesMemoHtml = html;
        return html;
    }

    private buildForgeRecipesBlockHtml(
        pool: readonly string[],
        bagIds: readonly string[],
        forgeIds: readonly string[],
        highlightRuneId: string | null = null,
    ): string {
        const rows = forgeHelpRows(pool);
        if (rows.length === 0) return '';
        const bagCounts = this.countIds(bagIds);
        const forgeCounts = this.countIds(forgeIds);
        // green wobble = every ingredient in bag + forge
        const availableIds = [...bagIds, ...forgeIds];
        const rankRow = (r: (typeof rows)[number]) => {
            const m = forgeRecipeMatch(r.ingredients, availableIds);
            return m === 'ready' ? 0 : m === 'partial' ? 1 : 2;
        };
        const sortGroup = (list: typeof rows) =>
            [...list].sort((a, b) => {
                if (highlightRuneId) {
                    const aHit = a.ingredients.includes(highlightRuneId) ? 0 : 1;
                    const bHit = b.ingredients.includes(highlightRuneId) ? 0 : 1;
                    if (aHit !== bHit) return aHit - bHit;
                }
                const byMatch = rankRow(a) - rankRow(b);
                if (byMatch !== 0) return byMatch;
                if (a.productKind !== b.productKind) {
                    return a.productKind === 'item' ? -1 : 1;
                }
                return a.spellName.localeCompare(b.spellName);
            });
        const tileHtml = (r: (typeof rows)[number]) => {
            const match = forgeRecipeMatch(r.ingredients, availableIds);
            const matchClass = match === 'ready' ? ' forge-tile-ready' : '';
            const markOwned = match === 'ready' || match === 'partial';
            const bagLeft = markOwned ? new Map(bagCounts) : null;
            const forgeLeft = markOwned ? new Map(forgeCounts) : null;
            const ings = r.ingredients
                .map((id, i) => {
                    const ico = r.ingredientIcons[i] ?? ITEMS[id]?.icon ?? '?';
                    let cls = 'forge-ing';
                    if (forgeLeft && (forgeLeft.get(id) ?? 0) > 0) {
                        cls += ' in-forge';
                        forgeLeft.set(id, (forgeLeft.get(id) ?? 0) - 1);
                    } else if (bagLeft && (bagLeft.get(id) ?? 0) > 0) {
                        cls += ' owned';
                        bagLeft.set(id, (bagLeft.get(id) ?? 0) - 1);
                    }
                    return iconHtml(ico, cls);
                })
                .join('');
            return (
                `<div class="forge-tile${matchClass}" data-spell-tip="1" ` +
                `data-ttitle="${escapeAttr(r.spellName)}" ` +
                `data-tdesc="${escapeAttr(r.spellDesc)}" ` +
                `data-ticon="${escapeAttr(r.spellIcon)}" ` +
                `data-forge-ings="${escapeAttr(r.ingredientIcons.join(','))}">` +
                `<div class="forge-tile-ings">${ings}</div>` +
                `<span class="forge-arrow">→</span>` +
                `${iconHtml(r.spellIcon, 'forge-spell')}` +
                `<div class="forge-tile-name">${escapeHtml(r.spellName)}</div>` +
                `</div>`
            );
        };
        const groups = [
            { n: 1, title: `1 ${DISPLAY.item}` },
            { n: 2, title: `2 ${DISPLAY.items}` },
            { n: 3, title: `3 ${DISPLAY.items}` },
        ]
            .map(({ n, title }) => {
                const list = sortGroup(rows.filter((r) => r.ingredients.length === n));
                if (list.length === 0) return '';
                return (
                    `<div class="forge-recipe-group">` +
                    `<div class="forge-recipe-group-title">${escapeHtml(title)}</div>` +
                    `<div class="forge-tile-grid">${list.map(tileHtml).join('')}</div>` +
                    `</div>`
                );
            })
            .filter(Boolean)
            .join('');
        return `<div class="forge-recipes-block"><div class="forge-recipe-groups">${groups}</div></div>`;
    }

    /** multiset counts for bag / forge ingredient marks */
    private countIds(ids: readonly string[]): Map<string, number> {
        const m = new Map<string, number>();
        for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
        return m;
    }

    /** dismiss the specialist detail popup (hover-out or click) */
    private hideSpecialistDetail(): void {
        if (this.specDetailOverlay) {
            this.unmount(this.specDetailOverlay);
            this.specDetailOverlay = null;
        }
        this.specDetailSeat = null;
        this.specDetailViaHover = false;
        this.lastSpecDetailKey = '';
        this.hideCardSpellTip();
        this.enemyInventoryEl.classList.remove('reveal');
    }

    /** mouse hover details for forge spells on specialist cards / recipe tiles */
    private bindCardSpellTips(root: HTMLElement): void {
        this.cardSpellTips.bind(root);
    }

    private hideCardSpellTip(): void {
        this.cardSpellTips.hide();
    }

    /** this match's settings, described once at match start (see game/settings.ts's
     *  describeGameSettings) — reflects the REAL settings for this match, including
     *  any ?hordeFactor= override, not just the defaults */
    setSettingsGroups(groups: SettingGroup[]): void {
        this.settingsGroups = groups;
    }

    /** a dismissible popup listing this match's settings (click the supply counter) */
    private showSettingsDetail(): void {
        if (this.settingsDetailOverlay) this.unmount(this.settingsDetailOverlay);
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards detail settings-detail';
        overlay.innerHTML =
            `<div class="settings-panel">` +
            `<button type="button" class="settings-close" aria-label="Close">&times;</button>` +
            `<div class="settings-panel-title">Match Settings</div>` +
            `<div class="settings-grid">` +
            this.settingsGroups
                .map(
                    (g) =>
                        `<div class="settings-card"><h3>${escapeHtml(g.title)}</h3><table class="settings-table"><tbody>` +
                        g.rows
                            .map(
                                (r) =>
                                    `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}${
                                        r.note ? `<span class="settings-desc">${escapeHtml(r.note)}</span>` : ''
                                    }</td></tr>`,
                            )
                            .join('') +
                        `</tbody></table></div>`,
                )
                .join('') +
            `</div></div>`;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || (e.target as HTMLElement).closest('.settings-close')) {
                this.hideSettingsDetail();
            }
        });
        this.settingsDetailOverlay = overlay;
        this.mount(overlay);
        this.syncOverlayOpen();
    }

    /** dismiss the match-settings popup */
    private hideSettingsDetail(): void {
        if (this.settingsDetailOverlay) {
            this.unmount(this.settingsDetailOverlay);
            this.settingsDetailOverlay = null;
        }
        this.syncOverlayOpen();
    }

    /** the between-round card offer: pick one (paying its cost) or skip for supply */
    showRoundCards(
        cards: readonly RoundCard[],
        skipReward: number,
        onPick: (cardId: string | null) => void,
        title = 'Choose your card',
        opts?: {
            ownedItemIds?: readonly string[];
            forgePool?: ForgeSpellPool;
            canAfford?: (card: RoundCard) => boolean;
        },
    ): void {
        const canAfford = opts?.canAfford ?? (() => true);
        const faceOpts = {
            ownedItemIds: opts?.ownedItemIds,
            forgePool: opts?.forgePool,
        };
        const overlay = document.createElement('div');
        overlay.className = 'mechili-cards';
        overlay.innerHTML =
            `<div class="cards-title">${escapeHtml(title)}</div><div class="cards-row">` +
            cards
                .map((c) => {
                    const affordable = canAfford(c);
                    return (
                        `<button class="card" data-card="${escapeAttr(c.id)}" ${affordable ? '' : 'disabled'}>` +
                        roundCardFaceHtml(c, faceOpts) +
                        `</button>`
                    );
                })
                .join('') +
            `</div>` +
            `<button class="cards-skip">Skip — take ${moneyHtml(skipReward)}</button>`;
        overlay.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.cards-skip')) {
                this.dismissPickOverlay(null, 'fade', () => onPick(null));
                return;
            }
            const button = target.closest<HTMLButtonElement>('.card');
            if (!button?.dataset.card || button.disabled) return;
            const cardId = button.dataset.card;
            this.dismissPickOverlay(button, 'lift', () => onPick(cardId));
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
        if (this.notice) this.unmount(this.notice);
        this.notice = null;
    }

    private reconnectWait: HTMLDivElement | null = null;

    /** connection lost: blocking notice with a live countdown to forfeit */
    showReconnectWait(onGiveUp: () => void): void {
        this.hideNotice();
        this.hideReconnectWait();
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
        if (this.reconnectWait) this.unmount(this.reconnectWait);
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

    showGameOver(
        result: 'victory' | 'defeat' | 'draw',
        options?: { note?: string; backLabel?: string; title?: string },
    ): void {
        const el = document.createElement('div');
        el.className = `mechili-gameover ${result}`;
        // `options.title` overrides the perspective-relative default — a
        // spectator has no side of their own, so "VICTORY"/"DEFEAT" (which
        // side THEY happen to be arbitrarily anchored to) is meaningless;
        // see finishMatch's watching branch for the neutral "X wins" label.
        const title = options?.title ?? (result === 'victory' ? 'VICTORY' : result === 'defeat' ? 'DEFEAT' : 'DRAW');
        const note = options?.note ? `<div class="go-note">${escapeHtml(options.note)}</div>` : '';
        const backLabel = options?.backLabel ?? 'Back to main menu';
        el.innerHTML =
            `<div class="go-title">${title}</div>${note}` +
            `<button class="go-restart">${escapeHtml(backLabel)}</button>`;
        el.querySelector('.go-restart')!.addEventListener('click', () => this.onQuitToMenu?.());
        this.mount(el);
    }

    setSupply(amount: number): void {
        if (this.supplyAmountShown !== amount) {
            this.supplyAmountShown = amount;
            const label = String(amount);
            this.supplyAmtEl.textContent = label;
            this.phoneSupplyAmtEl.textContent = label;
        }
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

    /** No-op — kept so the match tick can call it unconditionally. */
    layout(): void {}

    private mount(el: HTMLElement): void {
        // don't let HUD interactions fall through to camera/placement handlers
        for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) {
            el.addEventListener(type, (e) => e.stopPropagation());
        }
        // match-ui-root uses pointer-events:none so an empty root never blocks the menu
        el.style.pointerEvents = 'auto';
        this.mountedRoots.push(el);
        if (this.uiHidden) el.classList.add('mechili-cinema-hide');
        if (this.introChromeHidden) el.classList.add('mechili-intro-hide');
        this.overlayParent.appendChild(el);
    }

    /** remove from DOM and drop from mountedRoots (idempotent) */
    private unmount(el: HTMLElement): void {
        const idx = this.mountedRoots.indexOf(el);
        if (idx >= 0) this.mountedRoots.splice(idx, 1);
        el.remove();
    }

    get isUiHidden(): boolean {
        return this.uiHidden;
    }

    /**
     * True when client coords sit in the left inventory strip's layout box.
     * Prefer this over elementFromPoint while a tactic is armed — pick-up
     * removes that strip entry, so the board canvas shows through the hole.
     */
    clientOverPlayerInventory(clientX: number, clientY: number): boolean {
        if (this.inventoryEl.style.display === 'none') return false;
        const r = this.inventoryEl.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    /**
     * Soft-hide match chrome for the menu→match cinematic (opacity fade).
     * Unlike {@link setUiHidden}, this does not show the cinema keyboard hint.
     */
    setMatchChromeVisible(visible: boolean): void {
        this.introChromeHidden = !visible;
        for (const el of this.mountedRoots) {
            el.style.transition = 'opacity 0.35s ease';
            el.classList.toggle('mechili-intro-hide', !visible);
        }
        if (this.cardOverlay) {
            if (!this.cardIntroFading) {
                this.cardOverlay.style.transition = 'opacity 0.35s ease';
                this.cardOverlay.classList.toggle('mechili-intro-hide', !visible);
            }
        }
        if (this.itemGhost) this.itemGhost.classList.toggle('mechili-intro-hide', !visible);
    }

    /**
     * Hide every HUD chrome element (shop, topbar, panels, overlays) for
     * clean screenshots / atmosphere viewing. Leaves a tiny keyboard hint.
     */
    setUiHidden(hidden: boolean): void {
        if (this.uiHidden === hidden) return;
        this.uiHidden = hidden;
        for (const el of this.mountedRoots) {
            el.classList.toggle('mechili-cinema-hide', hidden);
        }
        if (this.itemGhost) this.itemGhost.classList.toggle('mechili-cinema-hide', hidden);
        if (hidden) {
            if (!this.cinemaHint) {
                const hint = document.createElement('div');
                hint.className = 'mechili-cinema-hint';
                this.overlayParent.appendChild(hint);
                this.cinemaHint = hint;
            }
            this.cinemaHint.style.display = '';
        } else if (this.cinemaHint) {
            if (this.cinemaHintTimer !== null) {
                window.clearTimeout(this.cinemaHintTimer);
                this.cinemaHintTimer = null;
            }
            this.cinemaHint.classList.remove('is-visible');
            this.cinemaHint.style.display = 'none';
        }
    }

    /**
     * Briefly show the cinema footer (e.g. `Shift+C — 1/11 Spring morning`),
     * then fade it back out. Called on cinema enter and on each season change,
     * so the scene label doesn't linger over the clean view.
     */
    flashCinemaHint(text: string, durationMs = 2600): void {
        if (!this.cinemaHint) return;
        this.cinemaHint.textContent = text;
        this.cinemaHint.classList.add('is-visible');
        if (this.cinemaHintTimer !== null) window.clearTimeout(this.cinemaHintTimer);
        this.cinemaHintTimer = window.setTimeout(() => {
            this.cinemaHint?.classList.remove('is-visible');
            this.cinemaHintTimer = null;
        }, durationMs);
    }

    /** removes every HUD element from the page */
    destroy(): void {
        this.hideMatchOverlays();
        this.clearInvDragListeners();
        this.invDrag = null;
        this.clearUnequipDragListeners();
        this.unequipDrag = null;
        this.itemGhost?.remove();
        this.itemGhost = null;
        if (this.cinemaHintTimer !== null) {
            window.clearTimeout(this.cinemaHintTimer);
            this.cinemaHintTimer = null;
        }
        this.cinemaHint?.remove();
        this.cinemaHint = null;
        this.forgeSlotPreviewEl?.remove();
        this.forgeSlotPreviewEl = null;
        this.forgeSlotPreviewAnchor = null;
        this.cardSpellTips.destroy();
        for (const el of this.mountedRoots) {
            el.remove();
        }
        this.mountedRoots.length = 0;
        window.removeEventListener('pointermove', this.onItemGhostMove, true);
        // HUD stylesheet stays permanent (see ensureHudStyleSheet)
    }
}
