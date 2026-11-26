/**
 * The room screen of the main menu: the room-settings form (basic and
 * advanced, presets, tooltips), the roster table and the lobby chat. main.ts
 * builds the menu's HTML, then hands it over once ({@link initLobby}) and
 * mounts the chat where it belongs ({@link mountLobbyChat}).
 */
import { fetchPlayerPublic, getCachedProfile } from '../game/account';
import { AI_DIFFICULTIES, type AiDifficulty, type AiPersonality, DEFAULT_AI_DIFFICULTY } from '../game/aiProfile';
import { CHAT_COOLDOWN_MS, CHAT_TEXT_LIMIT, type ChatItem, emoteById } from '../game/emotes';
import type { CustomGameConfig, CustomGameMode, HostHub } from '../game/net';
import { getPlayerName } from '../game/player';
import { ROUND_CARD_ALGORITHMS, roundCardAlgorithmById } from '../game/roundCardAlgorithms';
import { SEASONS_MODES, seasonsModeOption } from '../game/seasons';
import type { CanonicalSeatDef, SeatId } from '../game/seats';
import { BUYS_PER_ROUND_OPTIONS, buysPerRoundOption, CLIMB_ROUNDS, COMMANDER_HP_FACTOR_OPTIONS, commanderHpOptionById, commanderHpSelectId, CUSTOM_GAME_PACE_PRESETS, customGamePaceById, customGamePaceName, formatCommanderHpFactorOption, formatCustomGamePaceOption, formatStrongholdModeOption, HORDE_ALGORITHMS, hordeAlgorithmById, MONEY_FACTOR_OPTIONS, moneyFactorOption, POSTED_UNITS_MODES, postedUnitsModeName, postedUnitsModeOption, seasonsModeName, START_MONEY_OPTIONS, startMoneyOption, STRONGHOLD_MODE_OPTIONS, strongholdModeName, strongholdModeOption, WALLS_MODES, wallsModeName, wallsModeOption } from '../game/settings';
import { DEFAULT_TERRAIN_SHAPE, TERRAIN_SHAPES, type TerrainShape, terrainShapeOption } from '../game/terrainShapes';
import { BASE_TYPES } from '../game/units';
import { onLanguageChange, t } from '../i18n';
import { ChatBar } from '../ui/chatBar';
import { ChatFloat } from '../ui/chatFloat';
import { registerHoverTipClearer } from '../ui/hoverTips';
import { iconHtml } from '../ui/iconAtlas';
import { OPEN_SEAT_NAME } from './lobbyRoster';
import { boardSizeOption, MapChoice, mapValue } from './mapChoice';
import { defaultLobbySettings, defaultPracticeSettings, isNonDefaultLobbySettings, saveCustomGameConfig } from './matchSettings';
import { DEFAULT_ROOM_PRESET, matchingRoomPreset, ROOM_PRESETS } from './roomPresets';

/** what the room screen needs from the rest of the menu */
export interface LobbyDeps {
    /** the game layer root — the settings tooltip mounts here */
    wrapper: HTMLElement;
    scheduleLayoutTitle: () => void;
    /** the Practice lobby is on screen */
    inPracticeLobby: () => boolean;
    openPracticeLobby: (mode: CustomGameMode) => void;
    /** this client hosts a room nobody has joined yet (a player-count change re-opens it) */
    canReopenHostedRoom: () => boolean;
    /** close the hosted room and open it again as `mode` */
    reopenHostedRoom: (mode: CustomGameMode) => void;
}

let deps!: LobbyDeps;
let menu!: HTMLElement;

let rosterTableEl!: HTMLDivElement;
export let sessionEl!: HTMLDivElement;
let cgPaceEl!: HTMLSelectElement;
let cgHordeEl!: HTMLSelectElement;
let cgRoundCardsEl!: HTMLSelectElement;
let cgCommanderHpEl!: HTMLSelectElement;
let cgMoneyEl!: HTMLSelectElement;
let cgStartMoneyEl!: HTMLSelectElement;
let cgBuysEl!: HTMLSelectElement;
let cgWallsEl!: HTMLSelectElement;
let cgPostedEl!: HTMLSelectElement;
let cgSeasonsEl!: HTMLSelectElement;
let cgStrongholdEl!: HTMLSelectElement;
let cgLandscapeEl!: HTMLSelectElement;
let cgTerrainEl!: HTMLSelectElement;
let cgSiegeEl!: HTMLSelectElement;
let cgVictoryEl!: HTMLSelectElement;
export let cgPlayersEl!: HTMLSelectElement;
let cgFogEl!: HTMLSelectElement;
let cgPresetButtons!: HTMLButtonElement[];
let cgResetEl!: HTMLButtonElement;
let lobbySettingsEl!: HTMLDivElement;
let lobbyBasicEl!: HTMLDivElement;
let lobbySettingsToggleEl!: HTMLButtonElement;
let lobbyReadyRowEl!: HTMLLabelElement;
export let lobbyReadyCheckEl!: HTMLInputElement;
/** the advanced selects whose options carry a short label and a full blurb */
let LOBBY_BLURB_SELECTS!: HTMLSelectElement[];
/** the lobby's Map setting (a saved scenario's terrain, or generated) */
let mapChoice!: MapChoice;
let lobbyChatEl!: HTMLDivElement;
// The match's own two pieces, unchanged: lines pop above the bar and fade,
// and the bar itself collapses to a "Chat" strip. Same components, so a
// message looks the same whether it arrives while waiting or mid-battle.
let lobbyChatFloat!: ChatFloat;
let lobbyChatBar!: ChatBar;

/** Room state the host/join code sets and the roster reads (one object: imports are read-only). */
export interface LobbyRoom {
    /**
     * The room on screen (host or guest) is a Siege: the team headers name the
     * attacking and the defending side (the host swaps them with a click).
     */
    siege: boolean;
    /** a Siege: the canonical side that attacks (0 = Team 1) — the team headers say who is who */
    attackerSide: 0 | 1;
    /**
     * Who may change which seat's army in the room on screen, and how a change
     * travels: Practice sets every seat, a host its own and the AI / open ones,
     * a guest its own (asking the host). null outside a room.
     */
    army: {
        canEdit: (seat: SeatId) => boolean;
        pick: (seat: SeatId, army: string) => void;
        /** the seat's role in a Siege (null = any) */
        pickRole: (seat: SeatId, role: 'attacker' | 'defender' | null) => void;
        /** who may change a seat's role (omit = as for the army) — a host, every seat's */
        canEditRole?: (seat: SeatId) => boolean;
        /** an AI seat's strength / style (omit = this client can't change them) */
        pickAi?: (seat: SeatId, chips: { aiDifficulty?: AiDifficulty; aiPersonality?: AiPersonality }) => void;
    } | null;
}
export const lobbyRoom: LobbyRoom = { siege: false, attackerSide: 0, army: null };

/** the room's Mode / Victory / Players / Fog choices, in the current language */
function fillRoomShapeOptions(): void {
    const fill = (select: HTMLSelectElement, options: readonly [string, string][]) => {
        const value = select.value;
        select.replaceChildren(
            ...options.map(([id, label]) => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = label;
                return opt;
            }),
        );
        if (value) select.value = value;
    };
    fill(cgSiegeEl, [
        ['standard', t('menu:modeStandard')],
        ['siege', t('menu:modeSiege')],
    ]);
    fill(cgVictoryEl, [
        ['hp', t('menu:victoryHp')],
        ['rounds', t('menu:victoryRounds', { n: CLIMB_ROUNDS })],
    ]);
    fill(cgPlayersEl, [
        ['1v1', '1v1'],
        ['2v2', '2v2'],
    ]);
    fill(cgFogEl, [
        ['on', t('menu:fogOn')],
        ['off', t('menu:fogOff')],
    ]);
}

/** a setting behind the advanced toggle is off what the room's preset says (or off the defaults, without one) */
function isNonDefaultAdvanced(cfg: CustomGameConfig, defaults = defaultLobbySettings()): boolean {
    return isNonDefaultLobbySettings(cfg, { ...defaults, ...(matchingRoomPreset(cfg)?.values ?? {}) });
}

/** the preset bar shows the preset the room's settings match (none lit: a custom mix) */
function syncPresetButtons(cfg: CustomGameConfig): void {
    const active = matchingRoomPreset(cfg)?.id ?? null;
    for (const b of cgPresetButtons) {
        const on = b.dataset.preset === active;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
}

function fillPresetButtons(): void {
    for (const b of cgPresetButtons) {
        b.textContent = t(`menu:presets.${b.dataset.preset}`);
    }
}

/** collapsed by default every time a lobby is (re)entered — see
 *  clearLobbySettings(). Persists across refresh() calls within the
 *  same lobby so re-rendering the roster doesn't fight the user's own
 *  expand/collapse click. Auto-opens only on first show when the saved
 *  pace/horde/cards differ from defaults. Desktop keeps the toggle and
 *  parks the panel beside the roster when open. */
let lobbySettingsExpanded = false;

let lobbySettingsAvailable = false;

export function applyLobbySettingsExpanded(): void {
    sessionEl.classList.toggle('m-has-lobby-settings', lobbySettingsAvailable);
    sessionEl.classList.toggle('m-lobby-settings-open', lobbySettingsAvailable && lobbySettingsExpanded);
    lobbySettingsToggleEl.style.display = lobbySettingsAvailable ? '' : 'none';
    lobbySettingsToggleEl.textContent = lobbySettingsExpanded
        ? t('menu:advancedSettingsOpen')
        : t('menu:advancedSettingsClosed');
    deps.scheduleLayoutTitle();
}

/** Short closed-select label — full blurb lives after " — ". */
function shortSelectLabel(full: string): string {
    // CJK locales close up the space before the dash ("（稀疏）— …")
    const m = /\s*— /.exec(full);
    return m ? full.slice(0, m.index) : full;
}

/** Closed state shows a short name; opening the list reveals the full blurb. */
function fillSelectOption(opt: HTMLOptionElement, short: string, full: string): void {
    opt.dataset.short = short;
    opt.dataset.full = full;
    opt.textContent = short;
}

function syncSelectOptionLabels(select: HTMLSelectElement, full: boolean): void {
    for (const opt of Array.from(select.options)) {
        const short = opt.dataset.short ?? opt.textContent ?? '';
        const long = opt.dataset.full ?? short;
        opt.textContent = full ? long : short;
    }
}

function wireSelectShortLabels(select: HTMLSelectElement): void {
    select.addEventListener('focus', () => syncSelectOptionLabels(select, true));
    select.addEventListener('mousedown', () => syncSelectOptionLabels(select, true));
    select.addEventListener('blur', () => syncSelectOptionLabels(select, false));
    select.addEventListener('change', () => syncSelectOptionLabels(select, false));
}

/** the room's preset options in the current language (rebuilt on a language change) */
function fillLobbySettingOptions(): void {
    const fill = (select: HTMLSelectElement, options: readonly [string, string, string][]) => {
        const value = select.value;
        select.replaceChildren(
            ...options.map(([id, short, full]) => {
                const opt = document.createElement('option');
                opt.value = id;
                fillSelectOption(opt, short, full);
                return opt;
            }),
        );
        if (value) select.value = value;
    };
    const fromBlurb = (full: string): [string, string] => [shortSelectLabel(full), full];
    fill(cgPaceEl, CUSTOM_GAME_PACE_PRESETS.map((p) => [p.id, customGamePaceName(p), formatCustomGamePaceOption(p)]));
    // the Komtur's strength by name alone — the income behind it stays out of the list
    fill(cgHordeEl, HORDE_ALGORITHMS.map((a) => {
        const name = shortSelectLabel(a.describe());
        return [a.id, name, name];
    }));
    fill(cgRoundCardsEl, ROUND_CARD_ALGORITHMS.map((a) => [a.id, ...fromBlurb(a.describe())]));
    fill(cgCommanderHpEl, COMMANDER_HP_FACTOR_OPTIONS.map((o) => [o.id, o.label, formatCommanderHpFactorOption(o)]));
    fill(cgMoneyEl, MONEY_FACTOR_OPTIONS.map((o) => [String(o.factor), o.label, o.label]));
    // the amount alone says it: the row's own label names the setting
    fill(cgStartMoneyEl, START_MONEY_OPTIONS.map((o) => [String(o.amount), o.label, o.label]));
    fill(cgBuysEl, BUYS_PER_ROUND_OPTIONS.map((n) => {
        const label = n === 0 ? '∞' : String(n);
        return [String(n), label, label];
    }));
    fill(cgWallsEl, WALLS_MODES.map((m) => [m, wallsModeName(m), wallsModeName(m)]));
    fill(cgPostedEl, POSTED_UNITS_MODES.map((m) => [m, postedUnitsModeName(m), postedUnitsModeName(m)]));
    fill(cgSeasonsEl, SEASONS_MODES.map((m) => [m, seasonsModeName(m), seasonsModeName(m)]));
    fill(cgStrongholdEl, STRONGHOLD_MODE_OPTIONS.map((o) => [o.mode, strongholdModeName(o), formatStrongholdModeOption(o)]));
}

const TERRAIN_SHAPE_TEXT: Record<TerrainShape, { name: [string, string]; desc: [string, string] }> = {
    standard: { name: ['terrainStandard', 'Standard'], desc: ['terrainStandardDesc', 'a few low mounds'] },
    hills: { name: ['terrainHills', 'Rolling hills'], desc: ['terrainHillsDesc', 'many taller, steeper hills'] },
    highlands: { name: ['terrainHighlands', 'Highlands'], desc: ['terrainHighlandsDesc', 'each Stronghold on a high plateau with one ramp up'] },
    wall: { name: ['terrainWall', 'Wall'], desc: ['terrainWallDesc', 'a hilly wall with gaps across the middle, the rest flat'] },
};

/** the lobby's terrain choice — labels follow the language */
function refreshTerrainOptions(): void {
    const value = cgTerrainEl.value;
    cgTerrainEl.replaceChildren(
        ...TERRAIN_SHAPES.map((shape) => {
            const text = TERRAIN_SHAPE_TEXT[shape];
            const name = t(`menu:${text.name[0]}`, { defaultValue: text.name[1] });
            const desc = t(`menu:${text.desc[0]}`, { defaultValue: text.desc[1] });
            const opt = document.createElement('option');
            opt.value = shape;
            fillSelectOption(opt, name, `${name} — ${desc}`);
            return opt;
        }),
    );
    cgTerrainEl.value = value ? terrainShapeOption(value) : DEFAULT_TERRAIN_SHAPE;
}

/** shows `cfg` in every room-settings box (basic and advanced), marks the
 *  changed ones gold and syncs Reset — host and guest alike */
function populateLobbySettingsForm(cfg: CustomGameConfig): void {
    syncSilentLobbySettings(cfg);
    syncPresetButtons(cfg);
    cgSiegeEl.value = cfg.siege ? 'siege' : 'standard';
    cgVictoryEl.value = cfg.victory === 'rounds' ? 'rounds' : 'hp';
    cgPlayersEl.value = cfg.mode === '2v2' ? '2v2' : '1v1';
    cgFogEl.value = cfg.fog === false ? 'off' : 'on';
    cgPaceEl.value = customGamePaceById(cfg.pace).id;
    cgHordeEl.value = hordeAlgorithmById(cfg.hordePreset).id;
    cgRoundCardsEl.value = roundCardAlgorithmById(cfg.roundCardPreset).id;
    cgCommanderHpEl.value = commanderHpSelectId(cfg.commanderHpFactor, cfg.fixedSideHp);
    cgMoneyEl.value = String(moneyFactorOption(cfg.moneyFactor));
    cgStartMoneyEl.value = String(startMoneyOption(cfg.startMoney));
    cgBuysEl.value = String(buysPerRoundOption(cfg.buysPerRound));
    cgWallsEl.value = wallsModeOption(cfg.walls);
    cgPostedEl.value = postedUnitsModeOption(cfg.postedUnits);
    cgSeasonsEl.value = seasonsModeOption(cfg.seasons);
    cgStrongholdEl.value = strongholdModeOption(cfg.strongholdMode);
    mapChoice.refresh(cfg.map, boardSizeOption(cfg.boardSize));
    refreshTerrainOptions();
    cgTerrainEl.value = terrainShapeOption(cfg.terrainShape);
    syncSelectOptionLabels(cgTerrainEl, false);
    // Always short in the closed box — hosts open the list for details;
    // guests get a hover/tap tip (see wireLobbySettingTips).
    for (const sel of LOBBY_BLURB_SELECTS) syncSelectOptionLabels(sel, false);
    syncLobbySettingsResetVisibility(cfg);
    markChangedLobbySettings(cfg);
}

/**
 * Settings that do nothing in this combination are hidden: Commander HP with
 * Victory = Rounds (each side has one life a round), Terrain once a Map is
 * picked (the map brings its own ground).
 */
function syncSilentLobbySettings(cfg: CustomGameConfig): void {
    cgCommanderHpEl.closest('label')!.hidden = cfg.victory === 'rounds';
    cgTerrainEl.closest('label')!.hidden = mapValue(cfg.map) !== '';
}

/**
 * Every setting that isn't the room's default gets a highlighted box, so a
 * changed match reads at a glance (host and guests alike).
 */
function markChangedLobbySettings(cfg: CustomGameConfig): void {
    for (const [select, on] of changedLobbySettings(cfg)) select.classList.toggle('is-changed', on);
}

/** each room setting's box and whether it is off the room's default (the gold ones) */
function changedLobbySettings(cfg: CustomGameConfig): [HTMLSelectElement, boolean][] {
    const preset = matchingRoomPreset(cfg)?.values ?? DEFAULT_ROOM_PRESET.values;
    const d = { ...(activeLobbyHost?.save ? defaultPracticeSettings() : defaultLobbySettings()), ...preset };
    return [
        [cgPlayersEl, cfg.mode === '2v2'],
        [cgSiegeEl, !!cfg.siege !== preset.siege],
        [cgVictoryEl, (cfg.victory === 'rounds' ? 'rounds' : 'hp') !== preset.victory],
        [cgFogEl, cfg.fog === false],
        [cgPaceEl, cfg.pace !== d.pace],
        [cgHordeEl, cfg.hordePreset !== d.hordePreset],
        [cgRoundCardsEl, cfg.roundCardPreset !== d.roundCardPreset],
        [cgCommanderHpEl, cfg.commanderHpFactor !== d.commanderHpFactor || (cfg.fixedSideHp ?? null) !== (d.fixedSideHp ?? null)],
        [cgMoneyEl, cfg.moneyFactor !== d.moneyFactor],
        [cgStartMoneyEl, cfg.startMoney !== d.startMoney],
        [cgBuysEl, buysPerRoundOption(cfg.buysPerRound) !== d.buysPerRound],
        [cgWallsEl, wallsModeOption(cfg.walls) !== d.walls],
        [cgPostedEl, postedUnitsModeOption(cfg.postedUnits) !== d.postedUnits],
        [cgSeasonsEl, seasonsModeOption(cfg.seasons) !== d.seasons],
        [cgStrongholdEl, cfg.strongholdMode !== d.strongholdMode],
        [cgTerrainEl, terrainShapeOption(cfg.terrainShape) !== d.terrainShape],
        [cgLandscapeEl, mapValue(cfg.map) !== mapValue(d.map) || (!cfg.map && boardSizeOption(cfg.boardSize) !== d.boardSize)],
    ];
}

/** Host-only: "Reset to defaults" shows whenever any setting is gold (off its default) */
export function syncLobbySettingsResetVisibility(cfg: CustomGameConfig): void {
    // a locked box (the player count, once someone joined) is nothing Reset can undo
    // nor is a hidden one (see syncSilentLobbySettings)
    cgResetEl.hidden =
        !activeLobbyHost ||
        !changedLobbySettings(cfg).some(([select, on]) => on && !select.disabled && !select.closest('label')!.hidden);
}

function selectedLobbyOptionFull(select: HTMLSelectElement): string {
    const opt = select.selectedOptions[0];
    return opt?.dataset.full ?? opt?.textContent ?? '';
}

let lobbySettingTipEl: HTMLDivElement | null = null;

let lobbySettingTipSticky = false;

let lobbySettingTipAnchor: HTMLElement | null = null;

function hideLobbySettingTip(): void {
    lobbySettingTipEl?.remove();
    lobbySettingTipEl = null;
    lobbySettingTipSticky = false;
    lobbySettingTipAnchor = null;
}

function positionLobbySettingTip(anchor: HTMLElement): void {
    if (!lobbySettingTipEl) return;
    const r = anchor.getBoundingClientRect();
    const tip = lobbySettingTipEl;
    tip.style.left = '0';
    tip.style.top = '0';
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const pad = 8;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + tw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - tw - pad);
    if (top + th > window.innerHeight - pad) top = Math.max(pad, r.top - th - 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = '';
}

function showLobbySettingTip(anchor: HTMLElement, text: string, sticky: boolean): void {
    if (!text) {
        hideLobbySettingTip();
        return;
    }
    if (!lobbySettingTipEl) {
        lobbySettingTipEl = document.createElement('div');
        lobbySettingTipEl.className = 'm-lobby-setting-tip';
        deps.wrapper.appendChild(lobbySettingTipEl);
    }
    lobbySettingTipEl.textContent = text;
    lobbySettingTipEl.classList.toggle('sticky', sticky);
    lobbySettingTipSticky = sticky;
    lobbySettingTipAnchor = anchor;
    positionLobbySettingTip(anchor);
}

/** Guest (disabled) fields: short labels in the box, full blurb on hover /
 *  tap — disabled <select>s don't receive pointer events, so the parent
 *  .m-field owns the interaction. */
function wireLobbySettingTips(): void {
    for (const sel of [...LOBBY_BLURB_SELECTS, cgTerrainEl]) {
        const field = sel.closest<HTMLElement>('.m-field');
        if (!field) continue;
        field.addEventListener('pointerenter', (e) => {
            if (!sel.disabled) return;
            if (e.pointerType === 'touch') return;
            showLobbySettingTip(field, selectedLobbyOptionFull(sel), false);
        });
        field.addEventListener('pointerleave', () => {
            if (!lobbySettingTipSticky) hideLobbySettingTip();
        });
        field.addEventListener('click', (e) => {
            if (!sel.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            const text = selectedLobbyOptionFull(sel);
            if (lobbySettingTipSticky && lobbySettingTipAnchor === field) hideLobbySettingTip();
            else showLobbySettingTip(field, text, true);
        });
    }
    document.addEventListener('pointerdown', (e) => {
        if (!lobbySettingTipSticky || !lobbySettingTipEl) return;
        const t = e.target as Node;
        if (lobbySettingTipEl.contains(t)) return;
        if ((e.target as HTMLElement | null)?.closest?.('.m-lobby-settings .m-field')) return;
        if ((e.target as HTMLElement | null)?.closest?.('.m-roster-seat')) return;
        hideLobbySettingTip();
    });
}

function readLobbySettingsForm(): Pick<
    CustomGameConfig,
    | 'pace' | 'hordePreset' | 'roundCardPreset' | 'commanderHpFactor' | 'fixedSideHp' | 'moneyFactor' | 'startMoney' | 'buysPerRound' | 'walls' | 'postedUnits' | 'seasons' | 'strongholdMode'
    | 'map' | 'boardSize' | 'terrainShape' | 'siege' | 'victory' | 'fog'
> {
    const hpOpt = commanderHpOptionById(cgCommanderHpEl.value);
    return {
        siege: cgSiegeEl.value === 'siege',
        victory: cgVictoryEl.value === 'rounds' ? 'rounds' : 'hp',
        fog: cgFogEl.value !== 'off',
        map: mapChoice.value,
        boardSize: mapChoice.boardSize,
        terrainShape: terrainShapeOption(cgTerrainEl.value),
        pace: customGamePaceById(cgPaceEl.value).id,
        hordePreset: hordeAlgorithmById(cgHordeEl.value).id,
        roundCardPreset: roundCardAlgorithmById(cgRoundCardsEl.value).id,
        commanderHpFactor: hpOpt.factor,
        fixedSideHp: hpOpt.fixedHp ?? null,
        moneyFactor: moneyFactorOption(Number(cgMoneyEl.value)),
        startMoney: startMoneyOption(Number(cgStartMoneyEl.value)),
        buysPerRound: buysPerRoundOption(Number(cgBuysEl.value)),
        walls: wallsModeOption(cgWallsEl.value),
        postedUnits: postedUnitsModeOption(cgPostedEl.value),
        seasons: seasonsModeOption(cgSeasonsEl.value),
        strongholdMode: strongholdModeOption(cgStrongholdEl.value),
    };
}

/** set while a room exists; sends one item over whichever link we hold */
let lobbyChatSend: ((item: ChatItem) => void) | null = null;

let lobbyChatLastSent = -Infinity;

let lobbyChatLastReceived = -Infinity;

type LobbyChatEntry = { name: string; item: ChatItem; role: 'player' | 'system' };

/** what has been said in the room so far */
let lobbyChatLog: LobbyChatEntry[] = [];

/**
 * The room's conversation, handed off when the lobby closes so a match
 * starting next can seed its own chat panel with it (Game.seedChatHistory).
 * Cleared without being used when a lobby is abandoned rather than played, so
 * one room's chat can never surface in an unrelated later match.
 */
let lobbyChatCarry: LobbyChatEntry[] = [];

export function appendLobbyChat(name: string, item: ChatItem, role: 'player' | 'system' = 'player'): void {
    // logged as well as shown: the lines themselves fade, but the match that
    // starts next is seeded with the whole conversation (see takeLobbyChatCarry)
    lobbyChatLog.push({ name, item, role });
    lobbyChatBar.markUnread();
    if (role === 'system') lobbyChatFloat.addSystem(chatItemText(item));
    // no teams exist yet in a lobby, so every sender reads the same
    else lobbyChatFloat.addMessage(name, item, 'neutral');
}

/** plain text of an item — system lines carry no emotes, but clamp anyway */
function chatItemText(item: ChatItem): string {
    if (item.kind === 'text') return String(item.text).slice(0, CHAT_TEXT_LIMIT);
    return emoteById(item.id)?.label ?? '…';
}

/** Opens the panel for a room we are now part of. `send` is the only
 *  role-specific part: a host broadcasts, a guest tells the host. */
export function showLobbyChat(send: (item: ChatItem) => void): void {
    lobbyChatSend = send;
    lobbyChatEl.style.display = '';
}

function clearLobbyChat(): void {
    lobbyChatSend = null;
    lobbyChatLastSent = -Infinity;
    lobbyChatEl.style.display = 'none';
    lobbyChatFloat.clear();
    lobbyChatBar.reset();
    // handed to whatever match starts next, not thrown away — this runs on the
    // way INTO a match as well as on cancel (see takeLobbyChatCarry)
    lobbyChatCarry = lobbyChatLog;
    lobbyChatLog = [];
}

/** A host-side lobby announcement: shown locally and pushed to every guest as
 *  a `role: 'system'` chat line, the same shape the running match uses for
 *  "X disconnected" / "X reconnected". */
export function announceLobbySystem(text: string, hub: HostHub): void {
    const item: ChatItem = { kind: 'text', text };
    appendLobbyChat('', item, 'system');
    hub.broadcast({ type: 'chat', item, from: { name: '', role: 'system' } });
}

/** the pending hand-off, consumed once */
export function takeLobbyChatCarry(): LobbyChatEntry[] {
    const carry = lobbyChatCarry;
    lobbyChatCarry = [];
    return carry;
}

/** Incoming rate limit, mirroring the match's own receive-side clamp: the
 *  sender's cooldown is enforced by a client we do not control. */
export function acceptLobbyChatFromPeer(): boolean {
    const now = performance.now();
    if (now - lobbyChatLastReceived < CHAT_COOLDOWN_MS * 0.5) return false;
    lobbyChatLastReceived = now;
    return true;
}

function sendLobbyChat(item: ChatItem): void {
    if (!lobbyChatSend) return;
    // same cooldown the match enforces, so the habit carries over
    const now = performance.now();
    if (now - lobbyChatLastSent < CHAT_COOLDOWN_MS) return;
    lobbyChatLastSent = now;
    // shown locally on send: the host excludes the sender when relaying, so
    // nothing echoes back to whoever typed it
    appendLobbyChat(getPlayerName(), item);
    lobbyChatSend(item);
}

/** hides the host-waiting-room seat table (see renderRosterTable) — call
 *  whenever hosting stops, whether cancelled or a match actually starts */
export function clearRosterTable(): void {
    hideLobbySettingTip();
    rosterTableEl.style.display = 'none';
    rosterTableEl.innerHTML = '';
}

/** Custom Game lobby: the host's own pace/horde/round-card selects mutate
 *  through this indirection rather than getting a fresh listener wired
 *  per hostCustomGame() call, which would otherwise stack duplicate
 *  listeners across repeated hosts (cancel, host again, ...). null
 *  whenever the local client isn't hosting a Custom Game room right now. */
let activeLobbyHost: { config: CustomGameConfig; onChange: () => void; save?: (cfg: CustomGameConfig) => void } | null = null;

/** host-side only: show + populate the editable lobby-settings panel for
 *  a Custom Game room. `onSettingsChanged` is the host's own refresh() —
 *  called after every edit, so the roster/ready-reset/broadcast/Start-
 *  button-gating all happen through the exact same path a roster change
 *  already goes through. Idempotent — safe to call on every refresh(). */
export function showHostLobbySettings(
    config: CustomGameConfig,
    onSettingsChanged: () => void,
    /** where edits are kept (Practice keeps its own settings); default: the Custom Game config */
    save?: (cfg: CustomGameConfig) => void,
): void {
    const firstShow = !lobbySettingsAvailable;
    activeLobbyHost = { config, onChange: onSettingsChanged, ...(save ? { save } : {}) };
    lobbySettingsAvailable = true;
    // the advanced part opens by itself when one of its settings is off its default
    if (firstShow) lobbySettingsExpanded = config.fog === false || isNonDefaultAdvanced(config, save ? defaultPracticeSettings() : defaultLobbySettings());
    lobbySettingsEl.classList.remove('m-readonly');
    lobbyBasicEl.classList.remove('m-readonly');
    hideLobbySettingTip();
    applyLobbySettingsExpanded();
    // the host doesn't ready up — clicking Start IS their commitment
    lobbyReadyRowEl.style.display = 'none';
    fillRoomShapeOptions();
    cgSiegeEl.disabled = false;
    cgVictoryEl.disabled = false;
    cgPlayersEl.disabled = false;
    cgFogEl.disabled = false;
    cgPaceEl.disabled = false;
    cgHordeEl.disabled = false;
    cgRoundCardsEl.disabled = false;
    cgCommanderHpEl.disabled = false;
    cgMoneyEl.disabled = false;
    cgStartMoneyEl.disabled = false;
    cgBuysEl.disabled = false;
    cgWallsEl.disabled = false;
    cgPostedEl.disabled = false;
    for (const b of cgPresetButtons) b.disabled = false;
    cgSeasonsEl.disabled = false;
    cgStrongholdEl.disabled = false;
    cgLandscapeEl.disabled = false;
    cgTerrainEl.disabled = false;
    cgResetEl.disabled = false;
    populateLobbySettingsForm(config);
}

/** guest-side only: show the READ-ONLY lobby-settings preview + this
 *  client's own interactive ready checkbox. `onReady` sends 'lobbyReady'
 *  to the host; the checkbox's own checked state is re-synced from the
 *  next starRoster (see bindStarGuestSession) rather than trusted
 *  locally, since the host can reset it server-side (a settings change)
 *  without this client doing anything. */
export function showGuestLobbySettings(config: CustomGameConfig, onReady: (ready: boolean) => void): void {
    const firstShow = !lobbySettingsAvailable;
    activeLobbyHost = null;
    lobbySettingsAvailable = true;
    if (firstShow) lobbySettingsExpanded = config.fog === false || isNonDefaultAdvanced(config);
    lobbySettingsEl.classList.add('m-readonly');
    lobbyBasicEl.classList.add('m-readonly');
    applyLobbySettingsExpanded();
    lobbyReadyRowEl.style.display = '';
    fillRoomShapeOptions();
    cgSiegeEl.disabled = true;
    cgVictoryEl.disabled = true;
    cgPlayersEl.disabled = true;
    cgFogEl.disabled = true;
    cgPaceEl.disabled = true;
    cgHordeEl.disabled = true;
    cgRoundCardsEl.disabled = true;
    cgCommanderHpEl.disabled = true;
    cgMoneyEl.disabled = true;
    cgStartMoneyEl.disabled = true;
    cgBuysEl.disabled = true;
    cgWallsEl.disabled = true;
    cgPostedEl.disabled = true;
    for (const b of cgPresetButtons) b.disabled = true;
    cgSeasonsEl.disabled = true;
    cgStrongholdEl.disabled = true;
    cgLandscapeEl.disabled = true;
    cgTerrainEl.disabled = true;
    cgResetEl.disabled = true;
    populateLobbySettingsForm(config);
    lobbyReadyCheckEl.onchange = () => onReady(lobbyReadyCheckEl.checked);
}

/** hides/resets the lobby-settings panel — call alongside clearRosterTable
 *  wherever hosting/joining a lobby ends (cancelled, match actually
 *  starts, connection lost). Collapses the "Advanced settings" toggle
 *  back to its default closed state for the NEXT lobby too. */
export function clearLobbySettings(): void {
    // The chat belongs to the room, so it ends exactly where the room does —
    // hooked here rather than at all nine call sites, since this function is
    // already the "a lobby just ended" signal (see the doc comment above).
    clearLobbyChat();
    activeLobbyHost = null;
    lobbySettingsAvailable = false;
    lobbySettingsExpanded = false;
    lobbySettingsEl.classList.remove('m-readonly');
    lobbyBasicEl.classList.remove('m-readonly');
    hideLobbySettingTip();
    applyLobbySettingsExpanded();
    lobbyReadyRowEl.style.display = 'none';
    lobbyReadyCheckEl.checked = false;
    lobbyReadyCheckEl.onchange = null;
    lobbyRoom.siege = false;
    lobbyRoom.army = null;
    lastRosterRender = null;
}

/** host-side: the settings just changed, so every other seat's previous
 *  "I'm ready" was for the OLD settings — clear it. Called from the
 *  onChange passed to showHostLobbySettings, BEFORE refresh() re-renders
 *  and re-broadcasts, so guests see the reset in the same roster update
 *  that carries the new config. */
export function resetReadyOnSettingsChange(hub: HostHub): void {
    for (const [i, s] of hub.currentRoster().entries()) {
        if (i !== 0 && s.ready) hub.setRosterEntry(i, { ...s, ready: false });
    }
}

/** every joined, non-host human seat is ready — a still-open seat (no one
 *  connected, destined to become AI at Start) never blocks it. */
export function allSeatsReady(roster: CanonicalSeatDef[]): boolean {
    return roster.every((s, i) => i === 0 || s.name === OPEN_SEAT_NAME || s.ready === true);
}

/** the roster table as last drawn — redrawn when the room's Siege setting arrives */
let lastRosterRender: Parameters<typeof renderRosterTable> | null = null;

export function setLobbySiege(siege: boolean, attackerSide: 0 | 1 = 0): void {
    if (siege === lobbyRoom.siege && attackerSide === lobbyRoom.attackerSide) return;
    lobbyRoom.siege = siege;
    lobbyRoom.attackerSide = attackerSide;
    if (lastRosterRender) renderRosterTable(...lastRosterRender);
}

function roleName(role: 'attacker' | 'defender' | undefined): string {
    return role === 'attacker'
        ? t('hud:yearAttacker')
        : role === 'defender'
          ? t('hud:yearDefender')
          : t('menu:yearAnyRole', { defaultValue: 'Any' });
}

/** the armies a player can lead: Standard, and every army a commander names (see StartCard.army) */
export function roomArmies(): string[] {
    const armies = ['standard'];
    for (const c of BASE_TYPES.commanders) if (c.army && !armies.includes(c.army)) armies.push(c.army);
    return armies;
}

/** room seats' MMR by name, loaded once each (null = none / not found) — redraws the seats when it arrives */
const roomMmr = new Map<string, number | null>();

function roomMmrOf(name: string): number | null | undefined {
    if (roomMmr.has(name)) return roomMmr.get(name);
    roomMmr.set(name, null);
    void fetchPlayerPublic(name).then((p) => {
        const own = getCachedProfile();
        roomMmr.set(name, p?.mmr ?? (own?.name === name ? own.mmr : null));
        if (lastRosterRender) renderRosterTable(...lastRosterRender);
    });
    return undefined;
}

/**
 * A visible "who's actually here" table, usable from EITHER the host's
 * or a guest's own perspective (`mySeat` — always 0 for the host, the
 * guest's own seat index otherwise, found by name-matching the roster —
 * see bindStarGuestSession's 'starRoster' handling). Columns = canonical
 * teams (Team 1 / side a, then Team 2 / side b) with a centered "vs",
 * rows = one per seat on that side. Your own seat is still marked "(you)".
 * Every seat always renders (roster entries carry a "Waiting…"
 * placeholder name until filled), so an empty seat is never just...
 * missing — it's a dashed, muted box, visually distinct from a filled
 * one. Built to directly address the "I saw a Start button and assumed
 * someone had joined" confusion: the seat count and names are front and
 * center instead of buried in a status sentence.
 *
 * `waitForJoined` (total participants, host included, before auto-start —
 * see beginStarHost's own doc comment) also tells us which still-open
 * seats can NEVER be claimed by a human this game: nextOpenSeat() always
 * fills seats in ascending index order, so once `waitForJoined - 1` more
 * humans have joined, every seat after that point is guaranteed to be
 * AI-filled at start — e.g. 2v2ai's waitForJoined=2 only ever waits for
 * one more human (your ally), so both opponent seats are certain AI from
 * the moment hosting begins, not just "waiting." Renders those as a
 * distinct "AI" box instead of the misleading "Waiting…" a real host hit
 * live (2v2ai's opponent side can never actually be joined).
 *
 * A filled, non-host seat also shows a small ready indicator (see
 * CanonicalSeatDef.ready) — read-only here regardless of whose seat it
 * is; the interactive checkbox is the separate .m-lobby-ready-check,
 * always about the LOCAL viewer's own seat.
 */
export function renderRosterTable(
    roster: CanonicalSeatDef[],
    mySeat: SeatId,
    waitForJoined: number,
    onKick?: (seat: SeatId) => void,
    /** host only: pull someone into a still-open seat (see inviteToHostedRoom) */
    onInvite?: () => void,
): void {
    lastRosterRender = [roster, mySeat, waitForJoined, onKick, onInvite];
    rosterTableEl.innerHTML = '';
    rosterTableEl.style.display = '';
    const cols = document.createElement('div');
    cols.className = 'm-roster-cols';
    const bySide = new Map<string, SeatId[]>();
    roster.forEach((s, i) => {
        const arr = bySide.get(s.side) ?? [];
        arr.push(i);
        bySide.set(s.side, arr);
    });
    // Canonical team order (a = Team 1, b = Team 2) — same on every client.
    const sides = [...bySide.keys()].sort((a, b) => a.localeCompare(b));
    const guaranteedAiFrom = waitForJoined - 1; // join-rank (0-based, excludes host) beyond which a seat can't be human
    let openRank = 0;
    sides.forEach((side, sideIndex) => {
        if (sideIndex > 0) {
            const vs = document.createElement('div');
            vs.className = 'm-roster-vs';
            vs.textContent = t('hud:vs');
            vs.setAttribute('aria-hidden', 'true');
            cols.appendChild(vs);
        }
        const col = document.createElement('div');
        const teamNum = side === 'a' ? 1 : side === 'b' ? 2 : sideIndex + 1;
        col.className = `m-roster-col m-roster-col-${side}`;
        // a Siege: the side's role instead of its number — the host swaps the two with a click
        const siegeRole: 'attacker' | 'defender' | null = lobbyRoom.siege ? (teamNum - 1 === lobbyRoom.attackerSide ? 'attacker' : 'defender') : null;
        const swappable = !!siegeRole && !!activeLobbyHost;
        const header = document.createElement(swappable ? 'button' : 'div');
        header.className = `m-roster-col-header${siegeRole ? ` is-${siegeRole}` : ''}${swappable ? ' is-editable' : ''}`;
        header.textContent = siegeRole ? roleName(siegeRole) : t('menu:rosterTeam', { n: teamNum });
        if (swappable) {
            (header as HTMLButtonElement).type = 'button';
            header.title = t('menu:siegeSwapSides', { defaultValue: 'Swap attacker and defender' });
            header.addEventListener('click', () => {
                const host = activeLobbyHost;
                if (!host) return;
                host.config.siegeAttackerSide = lobbyRoom.attackerSide === 0 ? 1 : 0;
                (host.save ?? saveCustomGameConfig)(host.config);
                setLobbySiege(lobbyRoom.siege, host.config.siegeAttackerSide);
                host.onChange();
            });
        }
        col.appendChild(header);
        for (const seat of bySide.get(side)!) {
            const filled = roster[seat]!.name !== OPEN_SEAT_NAME;
            const rank = seat === 0 ? -1 : openRank++;
            const guaranteedAi = !filled && rank >= guaranteedAiFrom;
            const cell = document.createElement('div');
            cell.className = `m-roster-seat ${filled ? 'filled' : guaranteedAi ? 'ai' : 'empty'}${seat === mySeat ? ' you' : ''}`;
            const label = document.createElement('span');
            label.className = 'm-roster-seat-name';
            const displayName = filled
                ? `${roster[seat]!.name}${seat === mySeat ? t('menu:rosterYou') : ''}`
                : guaranteedAi
                  ? t('menu:rosterAi')
                  : t('menu:rosterWaiting');
            label.textContent = displayName;
            if (filled) {
                // Truncated seats still expose the full name on hover / tap.
                cell.addEventListener('pointerenter', (e) => {
                    if (e.pointerType === 'touch') return;
                    if (label.scrollWidth <= label.clientWidth + 1) return;
                    showLobbySettingTip(cell, displayName, false);
                });
                cell.addEventListener('pointerleave', () => {
                    if (!lobbySettingTipSticky) hideLobbySettingTip();
                });
                cell.addEventListener('click', (e) => {
                    if ((e.target as HTMLElement).closest('.m-roster-kick')) return;
                    if (label.scrollWidth <= label.clientWidth + 1) return;
                    e.stopPropagation();
                    if (lobbySettingTipSticky && lobbySettingTipAnchor === cell) hideLobbySettingTip();
                    else showLobbySettingTip(cell, displayName, true);
                });
            }
            // the player's face (an AI seat its symbol, no avatar an empty disc), and its MMR
            const entry = roster[seat]!;
            if (filled || guaranteedAi) {
                const face = document.createElement('span');
                face.className = 'm-roster-avatar';
                if (filled && entry.controller === 'human' && entry.avatar) {
                    const img = document.createElement('img');
                    img.alt = '';
                    img.draggable = false;
                    img.src = entry.avatar;
                    face.appendChild(img);
                } else if (!filled || entry.controller === 'ai') {
                    face.classList.add('is-ai');
                    face.innerHTML = iconHtml('ui-unit', 'm-roster-avatar-ico mask-ico');
                } else {
                    face.classList.add('is-empty');
                }
                cell.appendChild(face);
            }
            cell.appendChild(label);
            if (filled && entry.controller === 'human') {
                const mmr = roomMmrOf(entry.name);
                if (typeof mmr === 'number') {
                    const tag = document.createElement('span');
                    tag.className = 'm-roster-mmr';
                    tag.textContent = String(mmr);
                    cell.appendChild(tag);
                }
            }
            // the seat's tags (army, role) on a line of their own under the name
            const tags = document.createElement('div');
            tags.className = 'm-roster-tags';
            // No army or AI-style chip, debug or not — like Single Player, a seat
            // shows only an AI's strength (the army stays standard, the style Random).
            // an AI seat (or an open one a bot will fill, where this client sets the bots): its strength
            if (lobbyRoom.army && seat !== mySeat && (entry.controller === 'ai' || guaranteedAi || (!filled && !!lobbyRoom.army.pickAi))) {
                const editable = !!lobbyRoom.army.pickAi && lobbyRoom.army.canEdit(seat);
                const chip = (cls: string, text: string, title: string, next: () => void) => {
                    const el = document.createElement(editable ? 'button' : 'span');
                    el.className = `m-roster-ai ${cls}${editable ? ' is-editable' : ''}`;
                    el.textContent = text;
                    if (editable) {
                        (el as HTMLButtonElement).type = 'button';
                        el.title = title;
                        el.addEventListener('click', (e) => {
                            e.stopPropagation();
                            next();
                        });
                    }
                    tags.appendChild(el);
                };
                const difficulty = entry.aiDifficulty ?? DEFAULT_AI_DIFFICULTY;
                chip(`is-${difficulty}`, t(`menu:aiDifficulty.${difficulty}`), t('menu:aiDifficultyPick'), () =>
                    lobbyRoom.army?.pickAi?.(seat, { aiDifficulty: AI_DIFFICULTIES[(AI_DIFFICULTIES.indexOf(difficulty) + 1) % AI_DIFFICULTIES.length]! }),
                );
            }
            // always: an empty line keeps a seat without chips as tall as one with them
            cell.appendChild(tags);
            if (filled && seat !== 0 && roster[seat]!.ready) {
                const ready = document.createElement('span');
                ready.className = 'm-roster-ready';
                ready.title = t('menu:rosterReady');
                ready.textContent = '✓';
                cell.appendChild(ready);
            }
            // An empty seat is the obvious place to ask "who goes here?", so it
            // is the invite affordance — the Matchmaking screen already uses a
            // seat-shaped button for exactly this. Skipped once a seat is
            // destined for AI: those are the ones Start is about to fill, so
            // inviting into them promises something the room will not keep.
            if (!filled && !guaranteedAi && onInvite) {
                cell.classList.add('invitable');
                // the whole cell is the target, not just the glyph — the "+"
                // is the affordance, the seat is the hit area
                cell.addEventListener('click', () => onInvite());
                const invite = document.createElement('button');
                invite.type = 'button';
                invite.className = 'm-roster-invite';
                // not "to this seat": an invite reaches the ROOM, and the host
                // seats whoever accepts in the next opening
                invite.title = t('menu:rosterInvite');
                invite.textContent = '+';
                invite.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onInvite();
                });
                cell.appendChild(invite);
            }
            if (filled && seat !== 0 && onKick) {
                const kick = document.createElement('button');
                kick.type = 'button';
                kick.className = 'm-roster-kick';
                kick.title = t('menu:rosterKick', { name: roster[seat]!.name });
                kick.textContent = '×';
                kick.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onKick(seat);
                });
                cell.appendChild(kick);
            }
            col.appendChild(cell);
        }
        cols.appendChild(col);
    });
    rosterTableEl.appendChild(cols);
}

/** Look up the room screen's elements in `menuEl` and wire them — once, at boot. */
export function initLobby(menuEl: HTMLElement, lobbyDeps: LobbyDeps): void {
    menu = menuEl;
    deps = lobbyDeps;
    rosterTableEl = menu.querySelector<HTMLDivElement>('.m-roster-table')!;
    sessionEl = menu.querySelector<HTMLDivElement>('.m-session')!;
    cgPaceEl = menu.querySelector<HTMLSelectElement>('.cg-pace')!;
    cgHordeEl = menu.querySelector<HTMLSelectElement>('.cg-horde')!;
    cgRoundCardsEl = menu.querySelector<HTMLSelectElement>('.cg-roundcards')!;
    cgCommanderHpEl = menu.querySelector<HTMLSelectElement>('.cg-commander-hp')!;
    cgMoneyEl = menu.querySelector<HTMLSelectElement>('.cg-money')!;
    cgStartMoneyEl = menu.querySelector<HTMLSelectElement>('.cg-start-money')!;
    cgBuysEl = menu.querySelector<HTMLSelectElement>('.cg-buys')!;
    cgWallsEl = menu.querySelector<HTMLSelectElement>('.cg-walls')!;
    cgPostedEl = menu.querySelector<HTMLSelectElement>('.cg-posted')!;
    cgSeasonsEl = menu.querySelector<HTMLSelectElement>('.cg-seasons')!;
    cgStrongholdEl = menu.querySelector<HTMLSelectElement>('.cg-stronghold')!;
    cgLandscapeEl = menu.querySelector<HTMLSelectElement>('.cg-landscape')!;
    cgTerrainEl = menu.querySelector<HTMLSelectElement>('.cg-terrain')!;
    cgSiegeEl = menu.querySelector<HTMLSelectElement>('.cg-siege')!;
    cgVictoryEl = menu.querySelector<HTMLSelectElement>('.cg-victory')!;
    cgPlayersEl = menu.querySelector<HTMLSelectElement>('.cg-players')!;
    cgFogEl = menu.querySelector<HTMLSelectElement>('.cg-fog')!;
    cgPresetButtons = [...menu.querySelectorAll<HTMLButtonElement>('.cg-preset [data-preset]')];
    cgResetEl = menu.querySelector<HTMLButtonElement>('.m-lobby-settings-reset')!;
    lobbySettingsEl = menu.querySelector<HTMLDivElement>('.m-lobby-advanced')!;
    lobbyBasicEl = menu.querySelector<HTMLDivElement>('.m-lobby-basic')!;
    lobbySettingsToggleEl = menu.querySelector<HTMLButtonElement>('.m-lobby-settings-toggle')!;
    lobbyReadyRowEl = menu.querySelector<HTMLLabelElement>('.m-lobby-ready-row')!;
    lobbyReadyCheckEl = menu.querySelector<HTMLInputElement>('.m-lobby-ready-check')!;
    lobbySettingsToggleEl.addEventListener('click', () => {
        lobbySettingsExpanded = !lobbySettingsExpanded;
        applyLobbySettingsExpanded();
    });
    LOBBY_BLURB_SELECTS = [cgPaceEl, cgHordeEl, cgRoundCardsEl, cgCommanderHpEl, cgMoneyEl, cgStartMoneyEl, cgBuysEl, cgWallsEl, cgPostedEl, cgSeasonsEl, cgStrongholdEl];
    fillLobbySettingOptions();
    onLanguageChange(fillLobbySettingOptions);
    fillPresetButtons();
    onLanguageChange(fillPresetButtons);
    for (const sel of LOBBY_BLURB_SELECTS) wireSelectShortLabels(sel);
    refreshTerrainOptions();
    wireSelectShortLabels(cgTerrainEl);
    mapChoice = new MapChoice(cgLandscapeEl);
    wireLobbySettingTips();
    registerHoverTipClearer(() => hideLobbySettingTip());
    (function wireLobbySettingsInputsOnce(): void {
        const onChange = () => {
            if (!activeLobbyHost) return;
            Object.assign(activeLobbyHost.config, readLobbySettingsForm());
            (activeLobbyHost.save ?? saveCustomGameConfig)(activeLobbyHost.config);
            syncSilentLobbySettings(activeLobbyHost.config);
            syncLobbySettingsResetVisibility(activeLobbyHost.config);
            markChangedLobbySettings(activeLobbyHost.config);
            activeLobbyHost.onChange();
        };
        cgPaceEl.addEventListener('change', onChange);
        cgHordeEl.addEventListener('change', onChange);
        cgRoundCardsEl.addEventListener('change', onChange);
        cgCommanderHpEl.addEventListener('change', onChange);
        cgMoneyEl.addEventListener('change', onChange);
        cgStartMoneyEl.addEventListener('change', onChange);
        cgBuysEl.addEventListener('change', onChange);
        cgWallsEl.addEventListener('change', onChange);
        cgPostedEl.addEventListener('change', onChange);
        // a preset writes its values over the room's settings, then goes the way of any change
        for (const b of cgPresetButtons) {
            b.addEventListener('click', () => {
                if (!activeLobbyHost) return;
                const preset = ROOM_PRESETS.find((p) => p.id === b.dataset.preset);
                if (!preset) return;
                Object.assign(activeLobbyHost.config, preset.values);
                populateLobbySettingsForm(activeLobbyHost.config);
                onChange();
            });
        }
        cgSeasonsEl.addEventListener('change', onChange);
        cgStrongholdEl.addEventListener('change', onChange);
        cgLandscapeEl.addEventListener('change', onChange);
        cgTerrainEl.addEventListener('change', onChange);
        // Mode / Victory / Fog are settings like the rest (a Siege's role chips redraw with the roster)
        cgSiegeEl.addEventListener('change', onChange);
        cgVictoryEl.addEventListener('change', onChange);
        cgFogEl.addEventListener('change', onChange);
        // other players is a new room: Practice lays its seats out again; a hosted
        // room is closed and opened afresh (only while nobody has joined it)
        cgPlayersEl.addEventListener('change', () => {
            if (!activeLobbyHost) return;
            const mode = cgPlayersEl.value === '2v2' ? '2v2' : '1v1';
            if (mode === activeLobbyHost.config.mode) return;
            if (deps.inPracticeLobby()) {
                deps.openPracticeLobby(mode);
                return;
            }
            if (!deps.canReopenHostedRoom()) {
                cgPlayersEl.value = activeLobbyHost.config.mode === '2v2' ? '2v2' : '1v1';
                return;
            }
            deps.reopenHostedRoom(mode);
        });
        // every setting back to the room's default — the basics too; a different
        // player count is a new room, so that one goes last (it rebuilds the room)
        cgResetEl.addEventListener('click', () => {
            if (!activeLobbyHost) return;
            Object.assign(activeLobbyHost.config, activeLobbyHost.save ? defaultPracticeSettings() : defaultLobbySettings(), {
                fog: true,
            }, DEFAULT_ROOM_PRESET.values);
            populateLobbySettingsForm(activeLobbyHost.config);
            (activeLobbyHost.save ?? saveCustomGameConfig)(activeLobbyHost.config);
            activeLobbyHost.onChange();
            if (activeLobbyHost.config.mode !== '1v1') {
                cgPlayersEl.value = '1v1';
                cgPlayersEl.dispatchEvent(new Event('change'));
            }
        });
    })();
}

/** The lobby chat's element, appended to `parent` (the menu chrome) — once, at boot. */
export function mountLobbyChat(parent: HTMLElement): void {
    lobbyChatEl = document.createElement('div');
    lobbyChatEl.className = 'mechili-lobby-chat';
    lobbyChatEl.style.display = 'none';
    parent.appendChild(lobbyChatEl);
    lobbyChatFloat = new ChatFloat(true);
    lobbyChatBar = new ChatBar({ onSend: (item) => sendLobbyChat(item), inline: true });
    lobbyChatEl.append(lobbyChatFloat.el, lobbyChatBar.el);
}
