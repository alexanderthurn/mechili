import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { Game } from './game/game';
import { fetchMatchReplay, type MatchMode, type MatchResult, type MatchTelemetry } from './game/telemetry';
import { ReplayControls } from './ui/replayControls';
import { GamepadCursor } from './engine/gamepadCursor';
import { CameraRig } from './engine/cameraRig';
import {
    clearSinglePlayer,
    clearStarResumeMarker,
    fetchGlobalChat,
    fetchLobbyRooms,
    GAME_VERSION,
    hostStarRoom,
    isMelodanPlayHost,
    joinAsSpectator,
    joinStarRoom,
    loadSinglePlayer,
    loadStarResumeMarker,
    lookupSpectateEndpoint,
    postGlobalChat,
    saveSinglePlayer,
    saveStarResumeMarker,
    branchSiteUrl,
    type CustomGameConfig,
    type CustomGameMode,
    type GuestSession,
    type HostHub,
    type NetMessage,
    type PeerServerConfig,
    type Session,
    type SinglePlayerSave,
    type SpectatorSession,
    type StarGuestSession,
    type StarRole,
} from './game/net';
import * as sebNative from 'steam-electron-build/native';
import {
    hostOrJoinSteamStar,
    hostSteamRoom,
    hostSteamStarRoom,
    joinSteamLobby,
    onSteamJoinRequested,
    quickSteamMatch,
    type SteamGuestSession,
    type SteamSession,
    type SteamStarHub,
} from './game/net-steam';
import {
    resolveMultiplayerTransport,
    resolveStartupTransport,
    steamReady,
    transportLookingStatus,
    transportUnavailableMessage,
    type MultiplayerTransport,
} from './game/multiplayerTransport';
import { getPlayerName, setPlayerName, validatePlayerName } from './game/player';
import { getCachedProfile, claimName, syncOpenProfile, uploadAvatar, shouldPersistAvatarToPhp } from './game/account';
import { getAvatarDataUrl, resizeImageFileToAvatar, setAvatarDataUrl, setSteamAvatarDataUrl, wireAvatar } from './game/avatar';
import { SETTINGS_SAV_EXCLUDE, USER_STORAGE_PREFIX, migrateUserStorage } from './game/userStorage';
import { bootGameAssets } from './game/bootAssets';
import { discardPrewarmedRenderer, prewarmGpu } from './game/gpuWarmup';
import { initInputCapabilities, noteGamepadActivity } from './game/inputCapabilities';
import { effectiveDpr, onPrefsChange, prefs, updatePrefs } from './game/prefs';
import { openSettings } from './ui/settings';
import { openSuggest } from './suggest';
import { cssUrl, iconHtml } from './ui/iconAtlas';
import {
    COMMANDER_HP_FACTOR_OPTIONS,
    CUSTOM_GAME_PACE_PRESETS,
    DEFAULT_COMMANDER_HP_FACTOR,
    DEFAULT_CUSTOM_GAME_PACE_ID,
    DEFAULT_HORDE_PRESET_ID,
    DEFAULT_SETTINGS,
    HORDE_ALGORITHMS,
    commanderHpFactorOption,
    customGamePaceById,
    formatCommanderHpFactorOption,
    formatCustomGamePaceOption,
    hordeAlgorithmById,
    resolveCommanderHpFactor,
    type GameSettings,
} from './game/settings';
import { DISPLAY } from './game/displayNames';
import {
    DEFAULT_ROUND_CARD_PRESET_ID,
    ROUND_CARD_ALGORITHMS,
    roundCardAlgorithmById,
} from './game/roundCardAlgorithms';
import { duoSeats, localizeRoster, canonicalClassicSeats, type CanonicalSeatDef, type SeatId } from './game/seats';
import { THEME, applyUiFont, menuStyles } from './theme';

const { isElectron, lan, lobby: steamLobby, steam, storage, win } = sebNative;
/**
 * Electron/Steam Cloud only. Older steam-electron-build builds omit this export;
 * web never needs it. Use bracket access so Vite does not rewrite this into a
 * named import (which crashes when the export is missing).
 */
type MirrorLocalStorage = (options?: {
    file?: string;
    prefix?: string;
    excludePrefix?: string;
    exclude?: string[];
    debounceMs?: number;
}) => Promise<boolean>;
const mirrorLocalStorage: MirrorLocalStorage = (() => {
    const fn = (sebNative as Record<string, unknown>)['mirrorLocalStorage'];
    return typeof fn === 'function' ? (fn as MirrorLocalStorage) : async () => false;
})();

// the only mode right now (Single Player / Matchmaking both force this) —
// PvPvE: a neutral dwarf horde spawns from the forest ring outside the
// normal board and marches in, hostile to both players. The normal map's
// own dimensions apply (see the rim widen in map.ts/scenery.ts for horde
// mode specifically). `?hordePreset=` / `?hordeFactor=` selects an algorithm id.
function applyHordeMode(settings: GameSettings): void {
    // Normal single-player / forced-horde modes: Low (mid + Mother night).
    // `?hordePreset=` / `?hordeFactor=` still overrides.
    settings.hordePreset = 'low';
    const params = new URLSearchParams(location.search);
    const presetParam = params.get('hordePreset') ?? params.get('hordeFactor');
    if (!presetParam) return;
    if (HORDE_ALGORITHMS.some((a) => a.id === presetParam)) {
        settings.hordePreset = presetParam;
    }
}

// shared by local duo-vs-AI and online 2v2 — 4 armies need more elbow room
// (kept modest — each seat now gets its own pair of towers within its own
// half-lane, so this doesn't need to be as wide as when towers were shared)
function widenMapForDuo(settings: GameSettings): void {
    settings.map = { ...settings.map, zoneCols: Math.round(settings.map.zoneCols * 1.3) };
}

// ?duo=1 / the 2v2 Skirmish menu button — you + an AI ally against two AI
// commanders, split lanes, wider board. Combines with horde mode.
function applyDuoMode(settings: GameSettings): void {
    settings.seats = duoSeats('You');
    widenMapForDuo(settings);
}

// ---- Custom Game screen: config, persistence, and the actual hosting -----
// CustomGameMode/CustomGameConfig now live in game/net.ts — the config
// travels over the wire now (see the 'lobbySettings' NetMessage), so the
// single source of truth moved to where NetMessage itself is defined.

const DEFAULT_CUSTOM_GAME: CustomGameConfig = {
    mode: '1v1',
    pace: DEFAULT_CUSTOM_GAME_PACE_ID,
    hordePreset: DEFAULT_HORDE_PRESET_ID,
    roundCardPreset: DEFAULT_ROUND_CARD_PRESET_ID,
    commanderHpFactor: DEFAULT_COMMANDER_HP_FACTOR,
};

const CUSTOM_GAME_KEY = 'mechili-custom-game';

/** localStorage only (never the URL — this is testing-tool state, not a
 *  shareable link) — matches getPlayerName's own storage pattern. */
function loadCustomGameConfig(): CustomGameConfig {
    try {
        const raw = localStorage.getItem(CUSTOM_GAME_KEY);
        if (!raw) return { ...DEFAULT_CUSTOM_GAME };
        const parsed = JSON.parse(raw) as Partial<CustomGameConfig> & {
            buildSeconds?: number;
            battleSeconds?: number;
            specialistSeconds?: number;
            cardSeconds?: number;
            roundCards?: boolean;
            horde?: string;
        };
        let pace = parsed.pace;
        // migrate legacy free-form second fields → nearest / matching preset
        if (!pace && typeof parsed.buildSeconds === 'number') {
            pace = CUSTOM_GAME_PACE_PRESETS.find(
                (p) =>
                    p.buildSeconds === parsed.buildSeconds &&
                    p.battleSeconds === parsed.battleSeconds &&
                    p.specialistSeconds === parsed.specialistSeconds &&
                    p.cardSeconds === parsed.cardSeconds,
            )?.id;
        }
        let roundCardPreset = parsed.roundCardPreset;
        if (!roundCardPreset && typeof parsed.roundCards === 'boolean') {
            roundCardPreset = parsed.roundCards ? 'runes-every' : 'off';
        }
        let hordePreset = parsed.hordePreset ?? parsed.horde;
        return {
            ...DEFAULT_CUSTOM_GAME,
            mode: parsed.mode ?? DEFAULT_CUSTOM_GAME.mode,
            pace: customGamePaceById(pace).id,
            hordePreset: hordeAlgorithmById(hordePreset).id,
            roundCardPreset: roundCardAlgorithmById(roundCardPreset).id,
            commanderHpFactor: commanderHpFactorOption(parsed.commanderHpFactor),
        };
    } catch {
        return { ...DEFAULT_CUSTOM_GAME };
    }
}

function saveCustomGameConfig(cfg: CustomGameConfig): void {
    try {
        localStorage.setItem(CUSTOM_GAME_KEY, JSON.stringify(cfg));
    } catch {
        /* private browsing */
    }
}

function applyCustomGameConfig(settings: GameSettings, cfg: CustomGameConfig): void {
    const pace = customGamePaceById(cfg.pace);
    settings.buildTimeSeconds = pace.buildSeconds;
    settings.battleTimeSeconds = pace.battleSeconds;
    settings.specialistTimeSeconds = pace.specialistSeconds;
    settings.cardTimeSeconds = pace.cardSeconds;
    settings.roundCardPreset = roundCardAlgorithmById(cfg.roundCardPreset).id;
    settings.hordePreset = hordeAlgorithmById(cfg.hordePreset).id;
    settings.commanderHpFactor = resolveCommanderHpFactor(cfg.commanderHpFactor);
}

// dev override: tweak match settings from the URL, e.g. ?build=20&nocards
function settingsFromUrl(): GameSettings {
    const params = new URLSearchParams(location.search);
    const settings = structuredClone(DEFAULT_SETTINGS);
    const hpFactor = Number(params.get('commanderHpFactor') ?? params.get('hpFactor'));
    if (hpFactor > 0) settings.commanderHpFactor = hpFactor;
    const seed = Number(params.get('seed'));
    if (seed > 0) settings.seed = seed;
    // no ?horde=1 opt-in anymore — the menu forces applyHordeMode itself
    // now that Horde is the only mode; ?hordeFactor= (including `off`)
    // overrides the level — see applyHordeMode
    if (params.get('duo')) applyDuoMode(settings);

    const parseTimer = (raw: string | null): number | number[] | null => {
        if (!raw) return null;
        const parts = raw
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (parts.length === 0) return null;
        return parts.length === 1 ? parts[0]! : parts;
    };
    const build = parseTimer(params.get('build'));
    if (build !== null) settings.buildTimeSeconds = build;
    const battle = parseTimer(params.get('battle'));
    if (battle !== null) settings.battleTimeSeconds = battle;
    const specialist = parseTimer(params.get('specialist'));
    if (specialist !== null) settings.specialistTimeSeconds = specialist;
    const card = parseTimer(params.get('card'));
    if (card !== null) settings.cardTimeSeconds = card;

    // between-round cards: ?nocards | ?roundCardPreset=full | legacy ?roundCards=
    if (params.has('nocards') || params.get('roundCards') === 'off' || params.get('roundCardPreset') === 'off') {
        settings.roundCardPreset = 'off';
    } else {
        const presetRaw = params.get('roundCardPreset');
        if (presetRaw) {
            settings.roundCardPreset = roundCardAlgorithmById(presetRaw).id;
        } else if (params.get('roundCards') === 'true' || params.get('roundCards') === '1') {
            settings.roundCardPreset = 'runes-every';
        } else {
            const raw = params.get('roundCards');
            if (raw && raw.includes(',')) {
                // legacy sparse list → spare if even rounds, else every
                settings.roundCardPreset = 'runes-spare';
            }
        }
    }
    return settings;
}

// ---- page-zoom guard + crash visibility --------------------------------
// iOS pinch-zooms the PAGE unless the gesture events are cancelled — scaling
// two full-screen WebGL canvases in the compositor kills the tab ("Diese
// Seite kann nicht geöffnet werden"). Pointer events keep firing, so the
// in-game pinch gesture is unaffected.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
    'touchmove',
    (e) => {
        if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
);

/** phones have no devtools — surface fatal errors in a tap-to-dismiss overlay */
function showFatal(title: string, detail: string): void {
    let el = document.querySelector<HTMLDivElement>('.mechili-fatal');
    if (!el) {
        el = document.createElement('div');
        el.className = 'mechili-fatal';
        el.style.cssText =
            'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;max-height:40vh;overflow:auto;' +
            'background:rgba(40,12,8,0.95);color:#ffd8c8;border:2px solid #a03828;border-radius:10px;' +
            'padding:10px 12px;font:12px/1.45 monospace;white-space:pre-wrap;user-select:text;';
        el.addEventListener('click', () => el?.remove());
        document.body.appendChild(el);
    }
    el.textContent = `${title}\n${detail}\n\n(tap to dismiss)`;
}
window.addEventListener('error', (e) => {
    showFatal(`Error: ${e.message}`, `${e.filename ?? ''}:${e.lineno ?? ''}\n${e.error?.stack ?? ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; stack?: string } | undefined;
    showFatal(`Unhandled rejection: ${reason?.message ?? String(e.reason)}`, reason?.stack ?? '');
});

// Electron/Steam only: mirror localStorage ↔ cloud .sav files.
// Web uses localStorage directly — mirrorLocalStorage is a no-op without
// window.electronStorage (and may be missing on older steam-electron-build).
//
// settings.sav = prefs / graphics / misc  ·  user.sav = name + avatar (+ later)
// Auth (mechili-open-auth) stays local-only: a bearer credential, not a setting.
if (isElectron()) {
    // One-shot: older builds stored name/avatar inside settings.sav. Pull those
    // legacy keys into memory before the settings mirror (which excludes them),
    // then migrateUserStorage renames them onto the mechili-user-* keys.
    try {
        const stored = await storage.load('settings.sav');
        const mirrored = (stored as { localStorage?: Record<string, unknown> })?.localStorage ?? {};
        for (const key of ['mechili-username', 'mechili-avatar', 'mechili-avatar-steam'] as const) {
            const value = mirrored[key];
            if (typeof value === 'string' && localStorage.getItem(key) == null) {
                localStorage.setItem(key, value);
            }
        }
    } catch {
        /* missing / corrupt save */
    }
    await mirrorLocalStorage({
        file: 'settings.sav',
        prefix: 'mechili-',
        // Whole identity namespace, so a new mechili-user-* key cannot land in
        // both files; the exact list stays for legacy names and the auth token.
        excludePrefix: USER_STORAGE_PREFIX,
        exclude: [...SETTINGS_SAV_EXCLUDE],
    });
    await mirrorLocalStorage({
        file: 'user.sav',
        prefix: USER_STORAGE_PREFIX,
    });
}
migrateUserStorage();

// The zoom lives in the main process, so the saved preference has to be pushed
// there on every launch — otherwise it only takes effect when someone changes it.
if (isElectron()) void win.setUiScale(prefs().uiScale);

// A default nobody picked must not strand the player: launching without Steam
// leaves the Steam default unusable for the whole session (steam.init runs once
// at process start), and the web build has neither Steam nor LAN. An explicit
// choice is left alone — the transport never switches silently under someone
// who selected it.
void resolveStartupTransport(prefs().multiplayerTransport, prefs().transportChosen)
    .then((next) => {
        if (next) updatePrefs({ multiplayerTransport: next });
    });

const wrapper = document.createElement('div');
const menuBgUrl = new URL('../assets/ui/menu-bg.webp', import.meta.url).href;
wrapper.style.cssText =
    `position:fixed;inset:0;overflow:hidden;` +
    `background:#b8d4c8 ${cssUrl(menuBgUrl)} center/cover no-repeat;`;

function createThreeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        showFatal(
            'WebGL context lost (3D canvas)',
            'The graphics driver dropped the game view — usually out of GPU memory. Reload the page; lowering the graphics preset in Settings helps.',
        );
    });
    return canvas;
}

/** replaced after each match — WebGL contexts cannot be recreated on a lost canvas */
let threeCanvas = createThreeCanvas();
wrapper.appendChild(threeCanvas);

/** Match-only HUD/overlays — wiped on return-to-menu so leftovers can't survive.
 *  Must sit above the 3D/Pixi canvases (appended later) or those steal all clicks.
 *  pointer-events:none on the root so an empty shell never blocks the menu;
 *  Hud.mount sets auto on each child. z-index below menu chrome (30). */
const matchUiRoot = document.createElement('div');
matchUiRoot.id = 'match-ui-root';
matchUiRoot.style.cssText =
    'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10;';
wrapper.appendChild(matchUiRoot);

function replaceThreeCanvas(): void {
    discardPrewarmedRenderer();
    threeCanvas.remove();
    threeCanvas = createThreeCanvas();
    wrapper.insertBefore(threeCanvas, app.canvas);
    // next match would otherwise pay a cold renderer + shader-compile hitch
    void prewarmGpu(threeCanvas);
}

document.body.appendChild(wrapper);

// Loading chrome first — Feuerware + bar show before Pixi / Melodan logo finish.
// Match HUD CSS is owned by Hud (permanent shared sheet — never torn down).
const style = document.createElement('style');
style.textContent = menuStyles();
document.head.appendChild(style);
applyUiFont(prefs().uiFont);
onPrefsChange(() => applyUiFont(prefs().uiFont));

const versionEl = document.createElement(isMelodanPlayHost() ? 'a' : 'div');
versionEl.className = 'mechili-version';
versionEl.style.zIndex = '30';
versionEl.style.display = 'none';
versionEl.textContent = `v${__APP_VERSION__}`;
if (versionEl instanceof HTMLAnchorElement) {
    versionEl.target = '_blank';
    versionEl.rel = 'noopener noreferrer';
    versionEl.classList.add('link');
}
wrapper.appendChild(versionEl);

/** PLAYTEST wordmark under the logo. HTML rather than a Pixi Text so it can sit
 *  above the menu panel — the menu is an HTML overlay, so canvas always loses. */
const playtestEl = document.createElement('div');
playtestEl.className = 'mechili-playtest';
playtestEl.textContent = 'PLAYTEST';
playtestEl.style.display = 'none';
wrapper.appendChild(playtestEl);

/** True when Steam launched us as a child appID (playtest/demo) rather than the main game. */
let isPlaytest = false;
/** True once `menu` exists, i.e. once layoutTitle() is safe to call. */
let titleReady = false;
/** false while the boot splash owns the screen (logo + bar + Feuerware only).
 *  Declared up here because showPlaytestBadge reads it, and that can run during
 *  this module's top-level await — anything declared below would still be in TDZ. */
let menuChromeVisible = false;

/** Menu label: semver · branch · Steam|PeerJS · Online|Offline (transport fixed at launch). */
async function refreshVersionLabel(): Promise<void> {
    const onSteam = await steamReady();
    let branch = '';
    if (onSteam) {
        try {
            branch = (await steam.getCurrentBetaName())?.trim() ?? '';
        } catch {
            /* ignore */
        }
    }
    if (!branch) {
        const fromUrl = new URLSearchParams(location.search).get('branch')?.trim();
        branch = fromUrl || (typeof __GIT_BRANCH__ === 'string' ? __GIT_BRANCH__.trim() : '');
    }
    // A playtest/demo is its own child appID sharing the same depots, so the
    // binary is identical — only the id Steam launched us as tells them apart.
    if (onSteam) {
        try {
            const launchedAs = await steam.getAppId();
            isPlaytest = !!launchedAs && !!__STEAM_APP_ID__ && launchedAs !== __STEAM_APP_ID__;
        } catch {
            /* ignore */
        }
    }
    // ?playtest=1 forces the badge on without a Steam playtest install — the
    // only way to eyeball the layout from `npm run dev`.
    if (new URLSearchParams(location.search).get('playtest') === '1') isPlaytest = true;
    showPlaytestBadge();
    const transport = onSteam ? 'Steam' : 'PeerJS';
    const net = navigator.onLine ? 'Online' : 'Offline';
    const parts = [`v${__APP_VERSION__}`];
    if (branch) parts.push(branch);
    if (isPlaytest) parts.push('Playtest');
    parts.push(transport, net);
    versionEl.textContent = parts.join(' · ');
    if (versionEl instanceof HTMLAnchorElement) {
        const href = branchSiteUrl(branch);
        versionEl.href = href;
        try {
            versionEl.title = new URL(href).hostname;
        } catch {
            versionEl.title = href;
        }
    }
}

void refreshVersionLabel();
window.addEventListener('online', () => void refreshVersionLabel());
window.addEventListener('offline', () => void refreshVersionLabel());

const feuerwareLogoUrl = new URL('../assets/marketing/feuerware_melodan.webp', import.meta.url).href;
const feuerwareEl = document.createElement('img');
feuerwareEl.className = 'mechili-feuerware';
feuerwareEl.src = feuerwareLogoUrl;
feuerwareEl.alt = 'Feuerware';
feuerwareEl.width = 82;
feuerwareEl.height = 82;
wrapper.appendChild(feuerwareEl);

const loadingEl = document.createElement('div');
loadingEl.className = 'mechili-loading';
loadingEl.innerHTML =
    `<div class="load-bar"><div class="hp-track">` +
    `<div class="hp-fill" style="transform:scaleX(0)"></div>` +
    `<span class="hp-val">0%</span>` +
    `</div></div>` +
    `<div class="load-status">Loading…</div>`;
wrapper.appendChild(loadingEl);
const loadFill = loadingEl.querySelector<HTMLDivElement>('.hp-fill')!;
const loadVal = loadingEl.querySelector<HTMLSpanElement>('.hp-val')!;
const loadStatus = loadingEl.querySelector<HTMLDivElement>('.load-status')!;

// track mouse/touch/gamepad for the whole session, independent of asset loading
initInputCapabilities();

function setBootProgress(fraction: number, label: string): void {
    const t = Math.max(0, Math.min(1, fraction));
    const pct = Math.round(t * 100);
    loadFill.style.transform = `scaleX(${t})`;
    loadVal.textContent = `${pct}%`;
    loadStatus.textContent = label;
}

const app = new Application();
// resolution: uncapped DPR (3× on phones) triples the UI canvas memory — cap
// it like the 3D canvas so low-end devices don't run out of GPU memory
await app.init({
    backgroundAlpha: 0,
    resizeTo: wrapper,
    antialias: prefs().antialias,
    resolution: effectiveDpr(),
    autoDensity: true,
    powerPreference: 'low-power',
});
app.canvas.style.position = 'absolute';
app.canvas.style.inset = '0';
app.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFatal(
        'WebGL context lost (UI canvas)',
        'The graphics driver dropped the UI layer — usually out of GPU memory. Reload the page.',
    );
});
wrapper.appendChild(app.canvas);

/** hide the 3D/HUD input layer behind the main menu; pixi keeps the title visible */
function setGameLayerVisible(visible: boolean): void {
    threeCanvas.style.display = visible ? '' : 'none';
    app.canvas.style.pointerEvents = visible ? 'auto' : 'none';
}

/** menu→match cover — CSS animation on the compositor (survives sync Game boot) */
let introCoverEl: HTMLDivElement | null = null;
let introGen = 0;

function clearIntroCover(): void {
    introGen++;
    introCoverEl?.remove();
    introCoverEl = null;
}

/** Pixi Melodan wordmark back on the menu (after intro cover / resume cancel) */
function restoreMenuTitle(): void {
    title.visible = true;
    title.alpha = 1;
    logo.alpha = 1;
    layoutTitle();
    app.render();
}

function applyRandomMenuZoomOrigin(bg: HTMLElement): void {
    // Full plate — any XY on the menu bg (slight inset so edges don't pin).
    const originX = 0.08 + Math.random() * 0.84; // 0.08–0.92
    const originY = 0.08 + Math.random() * 0.84; // 0.08–0.92
    bg.style.setProperty('--zoom-ox', `${(originX * 100).toFixed(1)}%`);
    bg.style.setProperty('--zoom-oy', `${(originY * 100).toFixed(1)}%`);
}

function showIntroCover(): void {
    introCoverEl?.remove();
    const cover = document.createElement('div');
    cover.className = 'mechili-intro-cover';
    const bg = document.createElement('div');
    bg.className = 'mechili-intro-menu-bg';
    bg.style.background = wrapper.style.background;
    applyRandomMenuZoomOrigin(bg);
    const logoImg = document.createElement('img');
    logoImg.className = 'mechili-intro-logo';
    logoImg.src = logoUrl;
    logoImg.alt = 'MELODAN';
    logoImg.width = 600;
    logoImg.height = 327;
    layoutIntroLogo(logoImg);
    cover.append(bg, logoImg);
    wrapper.appendChild(cover);
    introCoverEl = cover;
    void bg.offsetWidth;
    cover.classList.add('active');
}

/** menu-zoom cover for reload resume / reconnect — keeps animating through async work */
function primeIntroCover(): void {
    title.visible = false;
    logo.alpha = 0;
    if (!introCoverEl?.classList.contains('active')) showIntroCover();
    app.render();
}

function showOutroCover(): void {
    introCoverEl?.remove();
    const cover = document.createElement('div');
    cover.className = 'mechili-intro-cover outro';
    const bg = document.createElement('div');
    bg.className = 'mechili-intro-menu-bg';
    bg.style.background = wrapper.style.background;
    applyRandomMenuZoomOrigin(bg);
    bg.style.transform = 'translate3d(0, 0, 0) scale3d(3.5, 3.5, 1)';
    const logoImg = document.createElement('img');
    logoImg.className = 'mechili-intro-logo';
    logoImg.src = logoUrl;
    logoImg.alt = 'MELODAN';
    logoImg.width = 600;
    logoImg.height = 327;
    cover.append(bg, logoImg);
    cover.style.opacity = '0';
    wrapper.appendChild(cover);
    introCoverEl = cover;
    void bg.offsetWidth;
    cover.classList.add('active');
}

const title = new Container();
const logoUrl = new URL('../assets/ui/logo.webp', import.meta.url).href;
const logoTex = await Assets.load(logoUrl);
const logo = new Sprite(logoTex);
logo.anchor.set(0.5);
// the logo art is on a black background (alpha isn't supported in this pipeline);
// additive blending drops the black and lets the wordmark glow over the scene
logo.blendMode = 'add';
void document.fonts.load('700 18px Cinzel').catch(() => {});
const subtitle = new Text({
    text: 'FANTASY AUTO·BATTLER',
    style: {
        fill: THEME.subtitle,
        fontFamily: 'Cinzel',
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 6,
        dropShadow: { color: 0x000000, alpha: 0.6, blur: 6, distance: 2, angle: Math.PI / 2 },
    },
});
subtitle.anchor.set(0.5);
title.addChild(logo);
app.stage.addChild(title);

const MENU_TOP_CHROME = 52;
let measuringMenuTop = false;

/** top edge of the menu panel — measures the real panel even while chrome is hidden
 *  (boot splash), so the logo height matches the post-load main menu. */
function estimateMenuTop(): number {
    const h = app.screen.height;
    if (menu.style.display !== 'none' && menu.offsetHeight > 0) {
        return menu.getBoundingClientRect().top;
    }
    if (measuringMenuTop) return h * 0.5 - 150;
    // Boot / hidden chrome: lay the panel out invisibly, measure, restore.
    measuringMenuTop = true;
    const prevDisplay = menu.style.display;
    const prevVisibility = menu.style.visibility;
    const prevPointer = menu.style.pointerEvents;
    menu.style.visibility = 'hidden';
    menu.style.pointerEvents = 'none';
    menu.style.display = '';
    const top = menu.offsetHeight > 0 ? menu.getBoundingClientRect().top : h * 0.5 - 150;
    menu.style.display = prevDisplay;
    menu.style.visibility = prevVisibility;
    menu.style.pointerEvents = prevPointer;
    measuringMenuTop = false;
    return top;
}

function layoutTitle() {
    const w = app.screen.width;
    const h = app.screen.height;
    const cx = w / 2;
    const menuTop = estimateMenuTop();
    const spaceAbove = Math.max(56, menuTop - MENU_TOP_CHROME);

    const byWidth = Math.min(w * 0.62, 600);
    const byHeight = spaceAbove * 0.84;
    const aspect = logo.texture.width / logo.texture.height;
    const logoDisplayW = Math.min(byWidth, byHeight * aspect);
    const scale = logoDisplayW / logo.texture.width;
    const logoHalfH = (logo.texture.height * scale) / 2;

    const gap = Math.min(18, Math.max(8, h * 0.014));
    let cy = menuTop - gap - logoHalfH;
    cy = Math.max(MENU_TOP_CHROME + logoHalfH, cy);

    logo.scale.set(scale);
    logo.position.set(cx, cy);
    subtitle.position.set(cx, cy + logoHalfH + 2);
    // Same canvas-pixel coordinates the HTML intro logo uses, so it tracks the
    // wordmark; scaled with the logo so it never dwarfs a shrunken one.
    const badgeFont = Math.max(20, Math.round(logoDisplayW * 0.075));
    playtestEl.style.left = `${cx}px`;
    playtestEl.style.fontSize = `${badgeFont}px`;
    // Tucked into the logo's lower edge rather than under it: the menu panel
    // starts just `gap` px below the logo, so anything there lands on the panel.
    playtestEl.style.top = `${cy + logoHalfH - badgeFont}px`;
}

/** Reveal (or hide) the PLAYTEST wordmark once detection has resolved. */
function showPlaytestBadge(): void {
    playtestEl.style.display = isPlaytest && menuChromeVisible ? '' : 'none';
    // layoutTitle reads `menu`, which stays uninitialized until after this
    // module's top-level await — detection can resolve before that.
    if (isPlaytest && titleReady) layoutTitle();
}

/** place the HTML intro-cover logo exactly where the Pixi menu logo sits */
function layoutIntroLogo(logoImg: HTMLImageElement): void {
    const w = app.screen.width;
    const h = app.screen.height;
    const cx = w / 2;
    const menuTop = estimateMenuTop();
    const spaceAbove = Math.max(56, menuTop - MENU_TOP_CHROME);

    const byWidth = Math.min(w * 0.62, 600);
    const byHeight = spaceAbove * 0.84;
    const aspect = (logoImg.naturalWidth > 0 && logoImg.naturalHeight > 0)
        ? logoImg.naturalWidth / logoImg.naturalHeight
        : logo.texture.width / logo.texture.height;
    const logoDisplayW = Math.min(byWidth, byHeight * aspect);
    const logoHalfH = logoDisplayW / aspect / 2;

    const gap = Math.min(18, Math.max(8, h * 0.014));
    let cy = menuTop - gap - logoHalfH;
    cy = Math.max(MENU_TOP_CHROME + logoHalfH, cy);

    logoImg.style.left = `${cx}px`;
    logoImg.style.top = `${cy}px`;
    logoImg.style.width = `${logoDisplayW}px`;
    logoImg.style.opacity = '1';
}
const menu = document.createElement('div');
menu.className = 'mechili-menu';
menu.style.display = 'none';
menu.innerHTML = `
    <div class="m-view m-main is-active" data-view="main">
        <button class="m-btn m-primary" data-mode="single">${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">Single Player</span></button>
        <button class="m-btn" data-mode="matchmaking">${iconHtml('ui-invite', 'm-ico mask-ico')}<span class="m-label">Matchmaking (WEB)</span></button>
        <button class="m-btn" data-mode="custom">${iconHtml('ui-menu', 'm-ico mask-ico')}<span class="m-label">Custom Game (WEB)</span></button>
        <div class="m-rooms">
            <div class="m-rooms-head">
                <span class="m-rooms-label">Open Web Games</span>
                <button type="button" class="m-rooms-refresh" title="Refresh room list" aria-label="Refresh room list">↻</button>
            </div>
            <div class="m-room-list empty">No open Web Games</div>
        </div>
    </div>
    <div class="m-view m-spmode" data-view="sp">
        <div class="m-spmode-title">Single Player</div>
        <div class="m-toggle-row">
            <button class="m-btn m-toggle-card" data-mode="sp-1v1">${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">1v1</span></button>
            <button class="m-btn m-toggle-card" data-mode="sp-2v2">${iconHtml('ui-deploy-cap', 'm-ico mask-ico')}<span class="m-label">2v2</span></button>
            <button class="m-btn m-toggle-card" data-mode="sp-horde">${iconHtml('ui-supply', 'm-ico mask-ico')}<span class="m-label">${DISPLAY.horde}</span></button>
        </div>
        <button class="m-btn m-small" data-mode="sp-back">Back</button>
    </div>
    <div class="m-view m-matchmaking" data-view="matchmaking">
        <div class="m-spmode-title">Matchmaking</div>
        <!-- mode/Horde choice hidden for now (focus: 1v1 Horde only) — not
             removed, just forced+hidden, so it's a one-line revert later -->
        <div class="m-toggle-row" style="display:none">
            <label class="m-toggle-card">
                <input type="radio" name="mmteam" value="1v1" checked>
                ${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">1v1</span>
            </label>
            <label class="m-toggle-card">
                <input type="radio" name="mmteam" value="2v2">
                ${iconHtml('ui-deploy-cap', 'm-ico mask-ico')}<span class="m-label">2v2</span>
            </label>
        </div>
        <label class="m-toggle-pill" style="display:none">
            <input type="checkbox" class="mm-horde" checked>
            ${iconHtml('ui-supply', 'm-ico mask-ico')}<span class="m-label">${DISPLAY.horde}</span>
        </label>
        <div class="m-seats">
            <div class="m-seat m-seat-you"><span class="mm-you-name"></span></div>
            <button class="m-seat m-seat-invite" data-mode="mm-invite">+ Invite a Friend</button>
        </div>
        <div class="m-mm-link" style="display:none"></div>
        <div class="m-room-row">
            <button class="m-btn m-small" data-mode="mm-back">Back</button>
            <button class="m-btn m-primary m-small" data-mode="mm-play">Play</button>
        </div>
    </div>
    <div class="m-view m-mm-simple" data-view="mm-simple">
        <div class="m-spmode-title">Matchmaking</div>
        <div class="m-toggle-row">
            <button class="m-btn m-toggle-card" data-mode="mms-1v1">${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">1v1</span></button>
            <button class="m-btn m-toggle-card" data-mode="mms-2v2">${iconHtml('ui-deploy-cap', 'm-ico mask-ico')}<span class="m-label">2v2</span></button>
            <button class="m-btn m-toggle-card" data-mode="mms-horde">${iconHtml('ui-supply', 'm-ico mask-ico')}<span class="m-label">${DISPLAY.horde}</span></button>
        </div>
        <button class="m-btn m-small" data-mode="mms-back">Back</button>
    </div>
    <div class="m-view m-custom" data-view="custom">
        <div class="m-spmode-title">Custom Game</div>
        <div class="m-toggle-row">
            <button class="m-btn m-toggle-card" data-mode="cg-host-1v1">
                ${iconHtml('ui-invite', 'm-ico mask-ico')}<span class="m-label">1v1</span>
            </button>
            <button class="m-btn m-toggle-card" data-mode="cg-host-1v1ai">
                ${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">1vAI</span>
            </button>
            <button class="m-btn m-toggle-card" data-mode="cg-host-2v2">
                ${iconHtml('ui-invite', 'm-ico mask-ico')}<span class="m-label">2v2</span>
            </button>
            <button class="m-btn m-toggle-card" data-mode="cg-host-2v2ai">
                ${iconHtml('ui-unit', 'm-ico mask-ico')}<span class="m-label">2vAI</span>
            </button>
        </div>
        <button class="m-btn m-small" data-mode="cg-back">Back</button>
    </div>
    <div class="m-view m-session" data-view="session">
        <div class="m-status" style="display:none"></div>
        <div class="m-session-layout">
            <div class="m-session-primary">
                <div class="m-roster-table" style="display:none"></div>
                <label class="m-lobby-ready-row" style="display:none">
                    <input type="checkbox" class="m-lobby-ready-check">
                    I'm ready
                </label>
                <button class="m-lobby-settings-toggle" style="display:none" type="button">Advanced settings ▸</button>
                <button class="m-btn m-small" data-mode="startstar" style="display:none">Start Match</button>
                <button class="m-btn m-small m-cancel" style="display:none">Cancel</button>
            </div>
            <div class="m-lobby-settings">
                <label class="m-field">Pace
                    <select class="cg-pace"></select>
                </label>
                <label class="m-field">${DISPLAY.horde}
                    <select class="cg-horde"></select>
                </label>
                <label class="m-field">Round cards
                    <select class="cg-roundcards"></select>
                </label>
                <label class="m-field">HP
                    <select class="cg-commander-hp"></select>
                </label>
                <button type="button" class="m-lobby-settings-reset" hidden>Reset to defaults</button>
            </div>
        </div>
    </div>
`;
wrapper.appendChild(menu);
titleReady = true;
layoutTitle();
app.renderer.on('resize', layoutTitle);
new ResizeObserver(() => {
    if (!measuringMenuTop) layoutTitle();
}).observe(menu);

function scheduleLayoutTitle(): void {
    requestAnimationFrame(() => layoutTitle());
}

const usernameEl = document.createElement('button');
usernameEl.className = 'mechili-username';
usernameEl.type = 'button';
usernameEl.style.zIndex = '30';
usernameEl.style.display = 'none';
const usernameAvatarEl = document.createElement('img');
usernameAvatarEl.className = 'u-avatar';
usernameAvatarEl.alt = '';
usernameAvatarEl.hidden = true;
const usernameTextEl = document.createElement('span');
usernameTextEl.className = 'u-name';
usernameEl.append(usernameAvatarEl, usernameTextEl);
wrapper.appendChild(usernameEl);

// Top-right menu chrome: door (Electron quit) + settings gear.
const cornerActionsEl = document.createElement('div');
cornerActionsEl.className = 'mechili-corner-actions';
cornerActionsEl.style.display = 'none';

const exitDesktopEl = document.createElement('button');
exitDesktopEl.className = 'mechili-exit-btn';
exitDesktopEl.type = 'button';
exitDesktopEl.innerHTML = iconHtml('ui-room', 'm-ico');
exitDesktopEl.title = 'Exit to Desktop';
exitDesktopEl.setAttribute('aria-label', 'Exit to Desktop');
exitDesktopEl.addEventListener('click', () => void win.close());

const settingsCornerEl = document.createElement('button');
settingsCornerEl.className = 'mechili-settings-btn';
settingsCornerEl.type = 'button';
settingsCornerEl.innerHTML = iconHtml('ui-settings', 'm-ico');
settingsCornerEl.title = 'Settings';
settingsCornerEl.addEventListener('click', () => openSettings(wrapper));

cornerActionsEl.append(settingsCornerEl, exitDesktopEl);
wrapper.appendChild(cornerActionsEl);

// suggest chip, top-left (same language as username button)
const suggestCornerEl = document.createElement('button');
suggestCornerEl.className = 'mechili-suggest-btn';
suggestCornerEl.type = 'button';
suggestCornerEl.textContent = 'Report bug';
suggestCornerEl.title = 'Report bug';
suggestCornerEl.style.display = 'none';
suggestCornerEl.addEventListener('click', () => {
    openSuggest({ parent: wrapper, source: 'game menu' });
});
wrapper.appendChild(suggestCornerEl);

// --- global menu chat (php-backed: last 10 messages + admin sticky) ---
const gchatEl = document.createElement('div');
gchatEl.className = 'mechili-gchat';
gchatEl.style.display = 'none';
gchatEl.innerHTML =
    `<button type="button" class="g-strip">Chat</button>` +
    `<div class="g-panel">` +
    `<div class="g-title">Global chat</div>` +
    `<div class="g-sticky" style="display:none"></div>` +
    `<div class="g-list"><div class="g-empty">…</div></div>` +
    `<div class="g-row"><input class="g-input" maxlength="200" placeholder="say something…" spellcheck="false" /><button type="button" class="g-send">Send</button></div>` +
    `</div>`;
wrapper.appendChild(gchatEl);
const gchatSticky = gchatEl.querySelector<HTMLDivElement>('.g-sticky')!;
const gchatList = gchatEl.querySelector<HTMLDivElement>('.g-list')!;
const gchatInput = gchatEl.querySelector<HTMLInputElement>('.g-input')!;
let gchatPoll: ReturnType<typeof setInterval> | null = null;

let menuGamepad: GamepadCursor | null = null;
let menuGamepadRig: CameraRig | null = null;

function setMenuChromeVisible(visible: boolean): void {
    menuChromeVisible = visible;
    const display = visible ? '' : 'none';
    menu.style.display = display;
    usernameEl.style.display = display;
    versionEl.style.display = display;
    playtestEl.style.display = visible && isPlaytest ? '' : 'none';
    suggestCornerEl.style.display = display;
    cornerActionsEl.style.display = display;
    // Door only in Electron; settings always when chrome is up.
    exitDesktopEl.style.display = visible && isElectron() ? '' : 'none';
    settingsCornerEl.style.display = display;
    applyGlobalChatVisibility();
    if (visible) {
        ensureMenuGamepadCursor();
        scheduleLayoutTitle();
        // the room/game list lives on the main menu view now (not a
        // separate toggled panel) — keep it fresh any time menu chrome is
        // showing at all, including while a sub-panel is open, so it's
        // never stale by the time the player gets back to the top level
        startRoomPoll();
    } else {
        stopRoomPoll();
    }
}

function ensureMenuGamepadCursor(): void {
    if (menuGamepad || started) return;
    // The menu has no visible 3D camera; the rig is only needed because the
    // cursor reuses pan/orbit math from the in-match cursor.
    menuGamepadRig = new CameraRig();
    // Same surface as in-match: the Pixi canvas inside the wrapper.
    menuGamepad = new GamepadCursor(app.canvas, menuGamepadRig);
    menuGamepad.onActivity = () => noteGamepadActivity();
}

function destroyMenuGamepadCursor(): void {
    if (!menuGamepad) return;
    menuGamepad.dispose();
    menuGamepad = null;
    menuGamepadRig = null;
}

function applyGlobalChatVisibility(): void {
    gchatEl.style.display = menuChromeVisible && prefs().globalChat ? '' : 'none';
    if (menuChromeVisible && prefs().globalChat) void refreshGlobalChat();
}

async function refreshGlobalChat(): Promise<void> {
    if (!gchatEl.isConnected || !prefs().globalChat) return;
    try {
        const state = await fetchGlobalChat();
        gchatSticky.style.display = state.sticky ? '' : 'none';
        gchatSticky.textContent = state.sticky ? `📌 ${state.sticky}` : '';
        gchatList.replaceChildren();
        if (state.messages.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'g-empty';
            empty.textContent = 'No messages yet — say hello!';
            gchatList.appendChild(empty);
        }
        for (const m of state.messages) {
            // built via textContent — server data never reaches innerHTML
            const line = document.createElement('div');
            line.className = 'g-msg';
            const who = document.createElement('span');
            who.className = 'g-name';
            who.textContent = m.name;
            line.append(who, document.createTextNode(`: ${m.text}`));
            gchatList.appendChild(line);
        }
        gchatList.scrollTop = gchatList.scrollHeight;
    } catch {
        /* endpoint missing — leave the panel quiet */
    }
}

function startGlobalChatPoll(): void {
    stopGlobalChatPoll();
    void refreshGlobalChat();
    gchatPoll = setInterval(() => void refreshGlobalChat(), 5000);
}

function stopGlobalChatPoll(): void {
    if (gchatPoll) clearInterval(gchatPoll);
    gchatPoll = null;
}

async function sendGlobalChat(): Promise<void> {
    const text = gchatInput.value.trim().slice(0, 200);
    if (!text) return;
    gchatInput.value = '';
    await postGlobalChat(getPlayerName(), text);
    void refreshGlobalChat();
}

gchatEl.querySelector('.g-send')!.addEventListener('click', () => void sendGlobalChat());
gchatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void sendGlobalChat();
});

// starts collapsed as a small "Chat" button; click or hover opens it and
// it stays open until a click outside (the input keeps whatever was typed)
function openGlobalChat(): void {
    if (gchatEl.classList.contains('open')) return;
    gchatEl.classList.add('open');
    void refreshGlobalChat();
    gchatInput.focus();
}
const gchatStrip = gchatEl.querySelector('.g-strip')!;
gchatStrip.addEventListener('click', openGlobalChat);
gchatStrip.addEventListener('pointerenter', openGlobalChat);
document.addEventListener('pointerdown', (e) => {
    if (gchatEl.classList.contains('open') && !gchatEl.contains(e.target as Node)) {
        gchatEl.classList.remove('open');
    }
});

// the "show global chat" setting hides the panel, live; the poll keeps
// ticking but refreshGlobalChat skips fetching while hidden or in-game
applyGlobalChatVisibility();
onPrefsChange(applyGlobalChatVisibility);
onPrefsChange(() => {
    if (roomPoll) void refreshRoomList();
});
startGlobalChatPoll();

const roomListEl = menu.querySelector<HTMLDivElement>('.m-room-list')!;
const roomsLabelEl = menu.querySelector<HTMLSpanElement>('.m-rooms-label')!;
const matchmakingLabelEl = menu.querySelector<HTMLSpanElement>('.m-btn[data-mode="matchmaking"] .m-label')!;
const customGameLabelEl = menu.querySelector<HTMLSpanElement>('.m-btn[data-mode="custom"] .m-label')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
const rosterTableEl = menu.querySelector<HTMLDivElement>('.m-roster-table')!;
const cancelEl = menu.querySelector<HTMLButtonElement>('.m-cancel')!;
const spModeEl = menu.querySelector<HTMLDivElement>('.m-spmode')!;
const mainButtonsEl = menu.querySelector<HTMLDivElement>('.m-main')!;
const mmModeEl = menu.querySelector<HTMLDivElement>('.m-matchmaking')!;
const mmHordeEl = menu.querySelector<HTMLInputElement>('.mm-horde')!;
const mmYouNameEl = menu.querySelector<HTMLSpanElement>('.mm-you-name')!;
const mmInviteEl = menu.querySelector<HTMLButtonElement>('.m-seat-invite')!;
const mmLinkEl = menu.querySelector<HTMLDivElement>('.m-mm-link')!;
const mmSimpleEl = menu.querySelector<HTMLDivElement>('.m-mm-simple')!;
const customEl = menu.querySelector<HTMLDivElement>('.m-custom')!;
const sessionEl = menu.querySelector<HTMLDivElement>('.m-session')!;
const cgPaceEl = menu.querySelector<HTMLSelectElement>('.cg-pace')!;
const cgHordeEl = menu.querySelector<HTMLSelectElement>('.cg-horde')!;
const cgRoundCardsEl = menu.querySelector<HTMLSelectElement>('.cg-roundcards')!;
const cgCommanderHpEl = menu.querySelector<HTMLSelectElement>('.cg-commander-hp')!;
const cgResetEl = menu.querySelector<HTMLButtonElement>('.m-lobby-settings-reset')!;
const lobbySettingsEl = menu.querySelector<HTMLDivElement>('.m-lobby-settings')!;
const lobbySettingsToggleEl = menu.querySelector<HTMLButtonElement>('.m-lobby-settings-toggle')!;
const lobbyReadyRowEl = menu.querySelector<HTMLLabelElement>('.m-lobby-ready-row')!;
const lobbyReadyCheckEl = menu.querySelector<HTMLInputElement>('.m-lobby-ready-check')!;
const startStarBtn = menu.querySelector<HTMLButtonElement>('[data-mode="startstar"]')!;

/** Exclusive menu screens — only one is active at a time. Session owns
 *  connecting / lobby / waiting UI so main never stacks under it. */
type MenuViewId = 'main' | 'sp' | 'custom' | 'matchmaking' | 'mm-simple' | 'session';
const menuViews: Record<MenuViewId, HTMLElement> = {
    main: mainButtonsEl,
    sp: spModeEl,
    custom: customEl,
    matchmaking: mmModeEl,
    'mm-simple': mmSimpleEl,
    session: sessionEl,
};
let currentMenuView: MenuViewId = 'main';
let statusClearTimer: ReturnType<typeof setTimeout> | null = null;
/** Hosting handles — cleared when leaving session unexpectedly. */
let starHosting: Awaited<ReturnType<typeof hostStarRoom>> | null = null;
let steamStarHosting: { hub: SteamStarHub; lobbyId: string } | null = null;
/** a cancellable in-flight connection attempt (matchmaking probe, star
 *  join/host, Steam join) — only ever cancelled or checked for busyness,
 *  never awaited on directly here */
let pending: { cancel: () => void } | null = null;

/** Wipe session chrome so a drop / cancel / return never leaves roster
 *  leftovers visible the next time session opens. */
function resetSessionChrome(): void {
    if (statusClearTimer) {
        clearTimeout(statusClearTimer);
        statusClearTimer = null;
    }
    statusEl.style.display = 'none';
    statusEl.textContent = '';
    cancelEl.style.display = 'none';
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
}

/**
 * Switch to exactly one menu screen. Leaving `session` always clears its
 * chrome so connection drops / cancel / Escape can't leave mixed UI.
 */
function showMenuView(view: MenuViewId): void {
    if (currentMenuView === 'session' && view !== 'session') {
        resetSessionChrome();
    }
    currentMenuView = view;
    for (const [id, el] of Object.entries(menuViews) as [MenuViewId, HTMLElement][]) {
        el.classList.toggle('is-active', id === view);
    }
    scheduleLayoutTitle();
}

/** True while a live host/join wait is still owned by menu chrome. */
function isSessionBusy(): boolean {
    return !!(pending || starHosting || steamStarHosting);
}
/** collapsed by default every time a lobby is (re)entered — see
 *  clearLobbySettings(). Persists across refresh() calls within the
 *  same lobby so re-rendering the roster doesn't fight the user's own
 *  expand/collapse click. Auto-opens only on first show when the saved
 *  pace/horde/cards differ from defaults. Desktop keeps the toggle and
 *  parks the panel beside the roster when open. */
let lobbySettingsExpanded = false;
let lobbySettingsAvailable = false;
lobbySettingsToggleEl.addEventListener('click', () => {
    lobbySettingsExpanded = !lobbySettingsExpanded;
    applyLobbySettingsExpanded();
});
function applyLobbySettingsExpanded(): void {
    sessionEl.classList.toggle('m-has-lobby-settings', lobbySettingsAvailable);
    sessionEl.classList.toggle('m-lobby-settings-open', lobbySettingsAvailable && lobbySettingsExpanded);
    lobbySettingsToggleEl.style.display = lobbySettingsAvailable ? '' : 'none';
    lobbySettingsToggleEl.textContent = lobbySettingsExpanded ? 'Advanced settings ▾' : 'Advanced settings ▸';
    scheduleLayoutTitle();
}

/** Short closed-select label — full blurb lives after " — ". */
function shortSelectLabel(full: string): string {
    const i = full.indexOf(' — ');
    return i >= 0 ? full.slice(0, i) : full;
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

for (const pace of CUSTOM_GAME_PACE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = pace.id;
    fillSelectOption(opt, pace.label, formatCustomGamePaceOption(pace));
    cgPaceEl.appendChild(opt);
}
wireSelectShortLabels(cgPaceEl);

for (const algo of HORDE_ALGORITHMS) {
    const opt = document.createElement('option');
    opt.value = algo.id;
    const full = algo.describe();
    fillSelectOption(opt, shortSelectLabel(full), full);
    cgHordeEl.appendChild(opt);
}
wireSelectShortLabels(cgHordeEl);

for (const algo of ROUND_CARD_ALGORITHMS) {
    const opt = document.createElement('option');
    opt.value = algo.id;
    const full = algo.describe();
    fillSelectOption(opt, shortSelectLabel(full), full);
    cgRoundCardsEl.appendChild(opt);
}
wireSelectShortLabels(cgRoundCardsEl);

for (const optHp of COMMANDER_HP_FACTOR_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(optHp.factor);
    fillSelectOption(opt, optHp.label, formatCommanderHpFactorOption(optHp));
    cgCommanderHpEl.appendChild(opt);
}
wireSelectShortLabels(cgCommanderHpEl);

function defaultLobbySettings(): Pick<
    CustomGameConfig,
    'pace' | 'hordePreset' | 'roundCardPreset' | 'commanderHpFactor'
> {
    return {
        pace: DEFAULT_CUSTOM_GAME_PACE_ID,
        hordePreset: DEFAULT_HORDE_PRESET_ID,
        roundCardPreset: DEFAULT_ROUND_CARD_PRESET_ID,
        commanderHpFactor: DEFAULT_COMMANDER_HP_FACTOR,
    };
}

function isNonDefaultLobbySettings(cfg: CustomGameConfig): boolean {
    return (
        cfg.pace !== DEFAULT_CUSTOM_GAME_PACE_ID ||
        cfg.hordePreset !== DEFAULT_HORDE_PRESET_ID ||
        cfg.roundCardPreset !== DEFAULT_ROUND_CARD_PRESET_ID ||
        cfg.commanderHpFactor !== DEFAULT_COMMANDER_HP_FACTOR
    );
}

/** Custom Game's mode (1v1/1v1ai/2v2/2v2ai) is now fixed at the moment
 *  one of the 4 host buttons is clicked — pace/horde/round-cards are the
 *  only pieces still read from/written to a <select> form, and they now
 *  live in the waiting-room's .m-lobby-settings panel instead of the
 *  pre-host screen (see hostCustomGame's own doc comment). */
function populateLobbySettingsForm(cfg: CustomGameConfig): void {
    cgPaceEl.value = customGamePaceById(cfg.pace).id;
    cgHordeEl.value = hordeAlgorithmById(cfg.hordePreset).id;
    cgRoundCardsEl.value = roundCardAlgorithmById(cfg.roundCardPreset).id;
    cgCommanderHpEl.value = String(commanderHpFactorOption(cfg.commanderHpFactor));
    // Always short in the closed box — hosts open the list for details;
    // guests get a hover/tap tip (see wireLobbySettingTips).
    for (const sel of [cgPaceEl, cgHordeEl, cgRoundCardsEl, cgCommanderHpEl]) {
        syncSelectOptionLabels(sel, false);
    }
    syncLobbySettingsResetVisibility(cfg);
}

/** Host-only: show "Reset to defaults" only when pace/horde/cards/HP differ. */
function syncLobbySettingsResetVisibility(cfg: CustomGameConfig): void {
    cgResetEl.hidden = !activeLobbyHost || !isNonDefaultLobbySettings(cfg);
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
        wrapper.appendChild(lobbySettingTipEl);
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
    for (const sel of [cgPaceEl, cgHordeEl, cgRoundCardsEl, cgCommanderHpEl]) {
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
wireLobbySettingTips();

function readLobbySettingsForm(): Pick<
    CustomGameConfig,
    'pace' | 'hordePreset' | 'roundCardPreset' | 'commanderHpFactor'
> {
    return {
        pace: customGamePaceById(cgPaceEl.value).id,
        hordePreset: hordeAlgorithmById(cgHordeEl.value).id,
        roundCardPreset: roundCardAlgorithmById(cgRoundCardsEl.value).id,
        commanderHpFactor: commanderHpFactorOption(Number(cgCommanderHpEl.value)),
    };
}

/** Custom Game mode is fixed when a host button is clicked — pace/horde/
 *  round-cards stay live-tunable in the waiting-room settings panel. */
function hostCustomGame(mode: CustomGameMode): void {
    const cfg: CustomGameConfig = { ...loadCustomGameConfig(), mode };
    saveCustomGameConfig(cfg);
    showMenuView('session');
    void (async () => {
        const transport = await resolveMultiplayerTransport();
        if (!transport) {
            setStatus(transportUnavailableMessage());
            return;
        }
        if (transport === 'steam') {
            setStatus('Opening Steam lobby…');
            if (cfg.mode === '1v1') {
                // Steam 1v1 uses the peer session (same wire as Matchmaking host),
                // with Custom Game pace/horde/round-card options applied on setup.
                const hosted = hostSteamRoom(true);
                pending = hosted;
                setStatus('Steam lobby open — waiting for a player…');
                runSteamPending(hosted.session, 'host', (s) => applyCustomGameConfig(s, cfg));
                return;
            }
            await beginSteamStarHost({
                customConfig: cfg,
                waitForJoined: cfg.mode === '2v2' ? 4 : cfg.mode === '2v2ai' ? 2 : 1,
                isPublic: true,
                offerAiStart: true,
            });
            return;
        }
        const discovery = transport === 'lan' ? 'lan' : 'matchmaking';
        setStatus(
            discovery === 'lan' ? 'Opening LAN room…' : 'Opening room…',
        );
        if (cfg.mode === '1v1' || cfg.mode === '1v1ai') {
            await beginStarHost(false, cfg.mode === '1v1' ? 2 : 1, cfg, initial1v1Roster, '1v1', true, discovery);
            return;
        }
        await beginStarHost(
            false,
            cfg.mode === '2v2' ? 4 : 2,
            cfg,
            initialStarRoster,
            '2v2',
            true,
            discovery,
        );
    })();
}

let started = false;
/** true after 3D assets finish loading — match starts wait for this */
let bootReady = false;
let roomPoll: ReturnType<typeof setTimeout> | null = null;
let resumeOverlay: HTMLDivElement | null = null;
let activeGame: Game | null = null;
let stopSinglePlayerPersist: (() => void) | null = null;
/** guards `rebuildStarGuestGame` against firing twice before the
 *  replacement Game exists and `activeGame` is reassigned — see that
 *  function's own doc comment. */
let starResyncInFlight = false;

type MatchResume = {
    actions: LoggedAction[];
    battleElapsed: number | null;
    local?: boolean;
    phaseRemaining?: number;
};

function hideResumeOverlay(): void {
    resumeOverlay?.remove();
    resumeOverlay = null;
}


function refreshUsernameLabel(): void {
    const name = getPlayerName();
    const profile = getCachedProfile();
    // Password UI is inactive — never show a lock badge. If the backend still
    // has a password on this name (legacy), we simply omit MMR until a session
    // exists; the local display name still works for lobbies / matches.
    usernameTextEl.textContent = profile ? `${name} · ${profile.mmr}` : name;
    const avatar = getAvatarDataUrl();
    if (avatar) {
        usernameAvatarEl.src = avatar;
        usernameAvatarEl.hidden = false;
        usernameEl.classList.add('has-avatar');
    } else {
        usernameAvatarEl.removeAttribute('src');
        usernameAvatarEl.hidden = true;
        usernameEl.classList.remove('has-avatar');
    }
}

async function refreshOpenProfile(): Promise<void> {
    const profile = await syncOpenProfile(getPlayerName());
    // Restore avatar from PHP when online PeerJS (not LAN / Steam transport).
    if (shouldPersistAvatarToPhp() && !steam.isAvailable() && profile && 'avatar' in profile) {
        if (typeof profile.avatar === 'string' && profile.avatar.startsWith('data:image/')) {
            setAvatarDataUrl(profile.avatar);
        } else if (profile.avatar === null && profile.hasAvatar === false) {
            // Server explicitly has no avatar — keep local (may not have synced yet).
        }
    }
    refreshUsernameLabel();
}

function showNameEditor(): void {
    if (started || pending) return;
    const steamLocked = steam.isAvailable();
    const overlay = document.createElement('div');
    overlay.className = 'mechili-name-edit';
    const currentAvatar = getAvatarDataUrl();
    const syncHint = steamLocked
        ? 'Name comes from Steam. Avatar is custom for Melodan (184×184) and sent to peers when you join.'
        : shouldPersistAvatarToPhp()
          ? 'Avatar is saved on this device and to your online profile (184×184).'
          : 'Avatar is saved on this device (184×184). Shown to peers when you join.';
    overlay.innerHTML =
        `<div class="box">` +
        `<div class="title">${steamLocked ? 'Avatar' : 'Username'}</div>` +
        `<div class="avatar-row">` +
        `<img class="avatar-preview" alt="" hidden />` +
        `<label class="avatar-pick">Upload image<input class="avatar-file" type="file" accept="image/*" hidden /></label>` +
        `<button type="button" data-act="clear-avatar">Clear</button>` +
        `</div>` +
        `<input class="name-input" maxlength="16" spellcheck="false" value="${getPlayerName()}" ${steamLocked ? 'readonly' : ''} />` +
        `<div class="hint">${syncHint}</div>` +
        `<div class="error" hidden></div>` +
        `<div class="actions">` +
        `<button type="button" data-act="cancel">Cancel</button>` +
        `<button type="button" class="primary" data-act="save">Save</button>` +
        `</div></div>`;

    const nameInput = overlay.querySelector<HTMLInputElement>('.name-input')!;
    const fileInput = overlay.querySelector<HTMLInputElement>('.avatar-file')!;
    const previewEl = overlay.querySelector<HTMLImageElement>('.avatar-preview')!;
    if (currentAvatar) {
        previewEl.src = currentAvatar;
        previewEl.hidden = false;
    }
    const errorEl = overlay.querySelector<HTMLDivElement>('.error')!;
    const actions = overlay.querySelector<HTMLDivElement>('.actions')!;
    if (!steamLocked) nameInput.select();

    let pendingAvatar: string | null | undefined = undefined; // undefined = unchanged

    const setError = (msg: string) => {
        errorEl.hidden = !msg;
        errorEl.textContent = msg;
    };

    const showPreview = (url: string | null) => {
        if (url) {
            previewEl.src = url;
            previewEl.hidden = false;
        } else {
            previewEl.removeAttribute('src');
            previewEl.hidden = true;
        }
    };

    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    const close = () => {
        if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
        overlay.remove();
    };

    const setBusy = (busy: boolean) => {
        actions.querySelectorAll('button').forEach((b) => {
            b.disabled = busy;
        });
        if (!steamLocked) nameInput.disabled = busy;
        fileInput.disabled = busy;
    };

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        void (async () => {
            setError('');
            const dataUrl = await resizeImageFileToAvatar(file);
            if (!dataUrl) {
                setError('Could not use that image — try a smaller PNG or JPEG.');
                return;
            }
            pendingAvatar = dataUrl;
            showPreview(dataUrl);
        })();
    });

    const save = async () => {
        const next = steamLocked ? getPlayerName() : validatePlayerName(nameInput.value);
        if (!next) {
            nameInput.style.borderColor = '#e83828';
            setError('Name must be 2–16 letters, numbers, _ or -.');
            return;
        }
        nameInput.style.borderColor = '';
        setError('');
        setBusy(true);

        if (!steamLocked) setPlayerName(next);
        if (pendingAvatar !== undefined) setAvatarDataUrl(pendingAvatar);
        refreshUsernameLabel();
        if (!steamLocked) {
            const result = await claimName({ name: next });
            if (pendingAvatar !== undefined && shouldPersistAvatarToPhp()) {
                await uploadAvatar({ name: next, avatar: pendingAvatar });
            } else if (result.ok) {
                void refreshOpenProfile();
            }
        }
        setBusy(false);
        close();
    };

    overlay.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
        if (act === 'cancel' || e.target === overlay) {
            close();
            return;
        }
        if (act === 'clear-avatar') {
            pendingAvatar = null;
            showPreview(null);
            return;
        }
        if (act === 'save') void save();
    });

    onKeyDown = (e) => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') close();
        if (e.key === 'Enter') void save();
    };
    window.addEventListener('keydown', onKeyDown);

    nameInput.focus();
    wrapper.appendChild(overlay);
}

// under Steam, always sync the display name from the Steam identity — not
// just a one-time seed: the click-to-edit/rename path below is disabled
// under Steam (no account story there yet), so there's no way for a name to
// have been legitimately customized while running under Steam, and a stale
// pre-Steam localStorage name (from earlier testing, or the plain web
// build) should not keep winning forever. Must be awaited before the very
// first getPlayerName() call below, otherwise that call's own "no saved
// name yet" fallback wins the race and persists a random Player#### name
// first.
if (steam.isAvailable()) {
    const steamName = await steam.getUserName();
    if (steamName) setPlayerName(steamName);
    try {
        // Cached under its own key: overwriting the shared one every launch
        // silently threw away whatever avatar the player had picked.
        const avatar = await steam.getAvatarDataUrl();
        if (avatar) setSteamAvatarDataUrl(avatar);
    } catch {
        /* keep cached local avatar if Steam fetch fails (offline) */
    }
}
refreshUsernameLabel();
void refreshOpenProfile();
// under Steam the display name stays locked to Steam identity; avatar is still editable.
usernameEl.addEventListener('click', () => {
    showNameEditor();
});

/**
 * `autoDismissMs`: for a TERMINAL message (host closed the room, rejected,
 * version mismatch) — there's no pending operation left for the Cancel
 * button (tied to this same text) to actually cancel, so without this the
 * message+button just sat there forever once the player moved on to
 * browsing the room list (live-reported: still showing minutes later).
 * Omit for an in-progress status, where the text disappearing on its own
 * while still connecting/hosting would be actively misleading.
 *
 * Non-empty status always owns the exclusive `session` view so it can never
 * stack under the main menu. Clearing a dismissed terminal message returns
 * to main when nothing else is holding the session open.
 */
function setStatus(text: string, autoDismissMs?: number): void {
    if (statusClearTimer) {
        clearTimeout(statusClearTimer);
        statusClearTimer = null;
    }
    if (text) {
        if (currentMenuView !== 'session') showMenuView('session');
        statusEl.style.display = '';
        statusEl.textContent = text;
        cancelEl.style.display = '';
        if (autoDismissMs) {
            statusClearTimer = setTimeout(() => {
                setStatus('');
                if (currentMenuView === 'session' && !isSessionBusy()) {
                    showMenuView('main');
                }
            }, autoDismissMs);
        }
    } else {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        cancelEl.style.display = 'none';
    }
}

/** hides the host-waiting-room seat table (see renderRosterTable) — call
 *  whenever hosting stops, whether cancelled or a match actually starts */
function clearRosterTable(): void {
    hideLobbySettingTip();
    rosterTableEl.style.display = 'none';
    rosterTableEl.innerHTML = '';
}

/** Custom Game lobby: the host's own pace/horde/round-card selects mutate
 *  through this indirection rather than getting a fresh listener wired
 *  per hostCustomGame() call, which would otherwise stack duplicate
 *  listeners across repeated hosts (cancel, host again, ...). null
 *  whenever the local client isn't hosting a Custom Game room right now. */
let activeLobbyHost: { config: CustomGameConfig; onChange: () => void } | null = null;

(function wireLobbySettingsInputsOnce(): void {
    const onChange = () => {
        if (!activeLobbyHost) return;
        Object.assign(activeLobbyHost.config, readLobbySettingsForm());
        saveCustomGameConfig(activeLobbyHost.config);
        syncLobbySettingsResetVisibility(activeLobbyHost.config);
        activeLobbyHost.onChange();
    };
    cgPaceEl.addEventListener('change', onChange);
    cgHordeEl.addEventListener('change', onChange);
    cgRoundCardsEl.addEventListener('change', onChange);
    cgCommanderHpEl.addEventListener('change', onChange);
    cgResetEl.addEventListener('click', () => {
        if (!activeLobbyHost) return;
        Object.assign(activeLobbyHost.config, defaultLobbySettings());
        populateLobbySettingsForm(activeLobbyHost.config);
        saveCustomGameConfig(activeLobbyHost.config);
        activeLobbyHost.onChange();
    });
})();

/** host-side only: show + populate the editable lobby-settings panel for
 *  a Custom Game room. `onSettingsChanged` is the host's own refresh() —
 *  called after every edit, so the roster/ready-reset/broadcast/Start-
 *  button-gating all happen through the exact same path a roster change
 *  already goes through. Idempotent — safe to call on every refresh(). */
function showHostLobbySettings(config: CustomGameConfig, onSettingsChanged: () => void): void {
    const firstShow = !lobbySettingsAvailable;
    activeLobbyHost = { config, onChange: onSettingsChanged };
    lobbySettingsAvailable = true;
    if (firstShow) lobbySettingsExpanded = isNonDefaultLobbySettings(config);
    lobbySettingsEl.classList.remove('m-readonly');
    hideLobbySettingTip();
    applyLobbySettingsExpanded();
    // the host doesn't ready up — clicking Start IS their commitment
    lobbyReadyRowEl.style.display = 'none';
    cgPaceEl.disabled = false;
    cgHordeEl.disabled = false;
    cgRoundCardsEl.disabled = false;
    cgCommanderHpEl.disabled = false;
    cgResetEl.disabled = false;
    populateLobbySettingsForm(config);
}

/** guest-side only: show the READ-ONLY lobby-settings preview + this
 *  client's own interactive ready checkbox. `onReady` sends 'lobbyReady'
 *  to the host; the checkbox's own checked state is re-synced from the
 *  next starRoster (see bindStarGuestSession) rather than trusted
 *  locally, since the host can reset it server-side (a settings change)
 *  without this client doing anything. */
function showGuestLobbySettings(config: CustomGameConfig, onReady: (ready: boolean) => void): void {
    const firstShow = !lobbySettingsAvailable;
    activeLobbyHost = null;
    lobbySettingsAvailable = true;
    if (firstShow) lobbySettingsExpanded = isNonDefaultLobbySettings(config);
    lobbySettingsEl.classList.add('m-readonly');
    applyLobbySettingsExpanded();
    lobbyReadyRowEl.style.display = '';
    cgPaceEl.disabled = true;
    cgHordeEl.disabled = true;
    cgRoundCardsEl.disabled = true;
    cgCommanderHpEl.disabled = true;
    cgResetEl.disabled = true;
    populateLobbySettingsForm(config);
    lobbyReadyCheckEl.onchange = () => onReady(lobbyReadyCheckEl.checked);
}

/** hides/resets the lobby-settings panel — call alongside clearRosterTable
 *  wherever hosting/joining a lobby ends (cancelled, match actually
 *  starts, connection lost). Collapses the "Advanced settings" toggle
 *  back to its default closed state for the NEXT lobby too. */
function clearLobbySettings(): void {
    activeLobbyHost = null;
    lobbySettingsAvailable = false;
    lobbySettingsExpanded = false;
    lobbySettingsEl.classList.remove('m-readonly');
    hideLobbySettingTip();
    applyLobbySettingsExpanded();
    lobbyReadyRowEl.style.display = 'none';
    lobbyReadyCheckEl.checked = false;
    lobbyReadyCheckEl.onchange = null;
}

/** host-side: the settings just changed, so every other seat's previous
 *  "I'm ready" was for the OLD settings — clear it. Called from the
 *  onChange passed to showHostLobbySettings, BEFORE refresh() re-renders
 *  and re-broadcasts, so guests see the reset in the same roster update
 *  that carries the new config. */
function resetReadyOnSettingsChange(hub: HostHub): void {
    for (const [i, s] of hub.currentRoster().entries()) {
        if (i !== 0 && s.ready) hub.setRosterEntry(i, { ...s, ready: false });
    }
}

/** every joined, non-host human seat is ready — a still-open seat (no one
 *  connected, destined to become AI at Start) never blocks it. */
function allSeatsReady(roster: CanonicalSeatDef[]): boolean {
    return roster.every((s, i) => i === 0 || s.name === OPEN_SEAT_NAME || s.ready === true);
}

/** a seat's roster entry starts (and stays, until joined) at this exact
 *  placeholder — see initialStarRoster/initial1v1Roster — so "does this
 *  seat have a real name" is a reliable, host-and-guest-alike way to
 *  tell a filled seat from an open one without needing a separate
 *  connectedSeats list (which only the host can compute directly). */
const OPEN_SEAT_NAME = 'Waiting…';

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
function renderRosterTable(
    roster: CanonicalSeatDef[],
    mySeat: SeatId,
    waitForJoined: number,
    onKick?: (seat: SeatId) => void,
): void {
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
            vs.textContent = 'vs';
            vs.setAttribute('aria-hidden', 'true');
            cols.appendChild(vs);
        }
        const col = document.createElement('div');
        const teamNum = side === 'a' ? 1 : side === 'b' ? 2 : sideIndex + 1;
        col.className = `m-roster-col m-roster-col-${side}`;
        const header = document.createElement('div');
        header.className = 'm-roster-col-header';
        header.textContent = `Team ${teamNum}`;
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
                ? `${roster[seat]!.name}${seat === mySeat ? ' (you)' : ''}`
                : guaranteedAi
                  ? 'AI'
                  : OPEN_SEAT_NAME;
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
            cell.appendChild(label);
            if (filled && seat !== 0 && roster[seat]!.ready) {
                const ready = document.createElement('span');
                ready.className = 'm-roster-ready';
                ready.title = 'Ready';
                ready.textContent = '✓';
                cell.appendChild(ready);
            }
            if (filled && seat !== 0 && onKick) {
                const kick = document.createElement('button');
                kick.type = 'button';
                kick.className = 'm-roster-kick';
                kick.title = `Kick ${roster[seat]!.name}`;
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

/**
 * Disable interactive menu buttons during a long-running connect/host/join.
 * Visibility is owned exclusively by showMenuView — this must NOT re-show
 * the main menu when busy clears (that was stacking main under lobby UI).
 */
function setMenuBusy(busy: boolean): void {
    menu.querySelectorAll<HTMLButtonElement>('.m-btn:not(.m-cancel)').forEach((b) => {
        b.disabled = busy;
    });
    roomListEl.querySelectorAll<HTMLButtonElement>('.m-room').forEach((b) => {
        b.disabled = busy;
    });
}

/**
 * Drop only the room THIS process is hosting — not every room with our
 * username. Two Electron windows share Steam/localStorage name, so filtering
 * by name hid the other instance's LAN lobby.
 */
async function lanRoomsExcludingSelf(timeoutMs = 2000): Promise<Awaited<ReturnType<typeof lan.listRooms>>> {
    const [rooms, self] = await Promise.all([
        lan.listRooms({ timeoutMs }),
        lan.getHostInfo(),
    ]);
    if (!self) return rooms;
    return rooms.filter((r) => !(r.peerId === self.peerId && r.port === self.port));
}

/** Next room-list poll delay — LAN empty scans are cheap UDP; PHP stays slow. */
function roomPollDelayMs(transport: string | null, foundRooms: boolean): number {
    if (transport === 'lan') return foundRooms ? 2500 : 1000;
    if (transport === 'steam') return 8000;
    return 5000; // matchmaking / online PHP
}

/** Room-list wording: LAN / Steam / Web (PeerJS matchmaking). */
function roomListScopeLabel(
    transport: Awaited<ReturnType<typeof resolveMultiplayerTransport>>,
): 'LAN' | 'Steam' | 'Web' {
    if (transport === 'lan') return 'LAN';
    if (transport === 'steam') return 'Steam';
    if (transport === 'matchmaking') return 'Web';
    const pref = prefs().multiplayerTransport;
    if (pref === 'lan') return 'LAN';
    if (pref === 'steam') return 'Steam';
    return 'Web';
}

function setRoomsListHeading(scope: 'LAN' | 'Steam' | 'Web'): void {
    roomsLabelEl.textContent = `Open ${scope} Games`;
    const tag = scope === 'Web' ? 'WEB' : scope === 'Steam' ? 'STEAM' : 'LAN';
    matchmakingLabelEl.textContent = `Matchmaking (${tag})`;
    customGameLabelEl.textContent = `Custom Game (${tag})`;
}

async function refreshRoomList(): Promise<void> {
    let transport: MultiplayerTransport | null = null;
    let foundRooms = false;
    try {
        transport = await resolveMultiplayerTransport();
        const scope = roomListScopeLabel(transport);
        setRoomsListHeading(scope);
        const mine = getPlayerName();

        if (transport === 'lan') {
            // Short UDP wait so 1s empty polling stays snappy
            const others = await lanRoomsExcludingSelf(900);
            foundRooms = others.length > 0;
            if (others.length === 0) {
                roomListEl.className = 'm-room-list empty';
                roomListEl.textContent = `No open ${scope} Games`;
                scheduleLayoutTitle();
                return;
            }
            roomListEl.className = 'm-room-list';
            roomListEl.replaceChildren(
                ...others.map((r) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'm-room';
                    button.dataset.room = r.name;
                    button.dataset.roomMode = '1v1';
                    button.dataset.roomKind = 'lobby';
                    button.dataset.lanHost = r.host;
                    button.dataset.lanPort = String(r.port);
                    button.dataset.lanPath = r.path;
                    button.textContent = `${r.name} (LAN)`;
                    return button;
                }),
            );
            scheduleLayoutTitle();
            return;
        }

        if (transport === 'steam') {
            roomListEl.className = 'm-room-list empty';
            roomListEl.textContent = `No open ${scope} Games`;
            scheduleLayoutTitle();
            return;
        }

        if (transport === null) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.textContent = `No open ${scope} Games`;
            scheduleLayoutTitle();
            return;
        }

        const rooms = await fetchLobbyRooms();
        const others = rooms.filter((r) => r.name.toLowerCase() !== mine.toLowerCase());
        foundRooms = others.length > 0;
        if (others.length === 0) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.textContent = `No open ${scope} Games`;
            scheduleLayoutTitle();
            return;
        }
        roomListEl.className = 'm-room-list';
        // room names come from the server — build via DOM, never innerHTML
        roomListEl.replaceChildren(
            ...others.map((r) => {
                const button = document.createElement('button');
                button.type = 'button';
                // a running match where MY OWN seat is currently
                // disconnected offers "resume" instead of "spectate" — same
                // beginStarJoin() flow as any other join, since the host
                // recognizes our name and reclaims us instead of handing out
                // a fresh seat (see StarHub.findDroppedSeatByName)
                const myDroppedSeat = r.roster?.find(
                    (s) => s.name.toLowerCase() === mine.toLowerCase() && !s.connected,
                );
                const resumable = r.kind === 'spectate' && !!myDroppedSeat;
                const roomKind = resumable ? 'resume' : r.kind;
                button.className =
                    roomKind === 'resume'
                        ? 'm-room m-room-resume'
                        : roomKind === 'spectate'
                          ? 'm-room m-room-spectate'
                          : 'm-room';
                button.dataset.room = r.name;
                button.dataset.roomMode = r.mode;
                button.dataset.roomKind = roomKind;
                const modeTag = r.mode === '2v2' ? ' (2v2)' : '';
                const roundTag = r.round ? ` — round ${r.round}` : '';
                button.textContent =
                    roomKind === 'resume'
                        ? `Resume your match — ${r.name}${modeTag}${roundTag}`
                        : roomKind === 'spectate'
                          ? `Watch ${r.name}${modeTag}${roundTag}`
                          : `${r.name}${modeTag}`;
                return button;
            }),
        );
    } catch {
        const scope = roomListScopeLabel(transport);
        setRoomsListHeading(scope);
        roomListEl.className = 'm-room-list empty';
        roomListEl.textContent = 'Could not load rooms';
    } finally {
        scheduleLayoutTitle();
        if (roomPollActive) {
            roomPoll = setTimeout(() => {
                void refreshRoomList();
            }, roomPollDelayMs(transport, foundRooms));
        }
    }
}

let roomPollActive = false;

function startRoomPoll(): void {
    stopRoomPoll();
    roomPollActive = true;
    void refreshRoomList();
}

function stopRoomPoll(): void {
    roomPollActive = false;
    if (roomPoll) {
        clearTimeout(roomPoll);
        roomPoll = null;
    }
}

function clearMatchResumeData(): void {
    clearStarResumeMarker();
    clearSinglePlayer();
    try {
        sessionStorage.removeItem('mechili-desync-guard');
    } catch {
        /* ignore */
    }
}

/** tear down an active match and bring back the pre-game menu (no page reload) */
function finishReturnToMenu(): void {
    stopSinglePlayerPersist?.();
    stopSinglePlayerPersist = null;
    clearMatchResumeData();
    activeGame?.destroy();
    activeGame = null;
    // Belt-and-suspenders: Hud.destroy should already clear this, but any
    // orphan (reconnect cards, settings, pause leftovers) must not outlive
    // the match — wipe the dedicated match root before the menu returns.
    matchUiRoot.replaceChildren();
    document.querySelector('.mechili-settings')?.remove();
    document.querySelector('.mechili-touchtip')?.remove();
    document.querySelector('.forge-slot-preview')?.remove();
    replayControlsPanel?.remove();
    replayControlsPanel = null;
    currentReplayRecord = null;
    replaceThreeCanvas();
    started = false;
    setGameLayerVisible(false);
    // Fade the Pixi menu logo back in after the outro cover is removed.
    // This avoids an abrupt "bam" when the HTML outro cover disappears.
    title.visible = true;
    title.alpha = 0;
    logo.alpha = 1;
    layoutTitle();
    clearIntroCover();
    app.renderer.on('resize', layoutTitle);
    app.render();
    const fadeMs = 220;
    const fadeStart = performance.now();
    const step = (now: number): void => {
        const t = Math.min(1, (now - fadeStart) / fadeMs);
        title.alpha = t;
        app.render();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Reset to the top-level panel regardless of which sub-panel was
    // showing when the match started — exclusive views make this one call.
    showMenuView('main');
    pending?.cancel();
    pending = null;
    cancelStarHost();
    wrapper.appendChild(menu);
    wrapper.appendChild(usernameEl);
    wrapper.appendChild(versionEl);
    wrapper.appendChild(playtestEl);
    wrapper.appendChild(cornerActionsEl);
    wrapper.appendChild(suggestCornerEl);
    wrapper.appendChild(gchatEl);
    startGlobalChatPoll();
    refreshUsernameLabel();
    void refreshOpenProfile();
    setMenuBusy(false);
    // status already cleared by showMenuView('main') above
    setMenuChromeVisible(true);
}

function wireGameMenuReturn(game: Game): void {
    game.onMatchOutroProgress = (t) => {
        if (!introCoverEl) showOutroCover();
        if (introCoverEl) introCoverEl.style.opacity = String(t);
    };
    game.onReturnToMenu = finishReturnToMenu;
    // no-op for every mode except a star (2v2+) guest — see rebuildStarGuestGame
    game.onNeedsFullResync = rebuildStarGuestGame;
}

/**
 * The actual `new Game(...)` construction + post-construction wiring,
 * factored out of `startGame`'s `bootGame` closure so a star (2v2+) guest
 * resync rebuild (`rebuildStarGuestGame`) can call it directly — bypassing
 * `startGame`'s menu-entry-only setup (chrome teardown, resume-marker
 * bookkeeping, the intro-cinematic branch) entirely, since none of that
 * applies mid-match. `startGame`'s own `bootGame` is now a thin wrapper
 * around this — behavior for every existing caller is unchanged.
 */
function constructGame(
    settings: GameSettings,
    net: Session | null,
    side: 'a' | 'b',
    names: { local: string; opponent: string },
    resume: MatchResume | null,
    star: StarRole | null,
    replay: {
        actions: LoggedAction[];
        jumpToRound?: number;
        verify?: boolean;
        mode?: MatchMode;
        expected?: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number };
    } | null,
    spectate: {
        session: SpectatorSession;
        watcherName: string;
        initial: { actions: LoggedAction[]; battleElapsed: number | null; phaseRemaining: number };
    } | null,
    useIntro: boolean,
): Game {
    const game = new Game(
        app,
        threeCanvas,
        matchUiRoot,
        settings,
        net,
        side,
        names,
        resume,
        star,
        replay,
        spectate,
        useIntro,
    );
    activeGame = game;
    wireGameMenuReturn(game);
    if (net) wireReconnect(game, net);
    else if (!star && !replay && !spectate) stopSinglePlayerPersist = wireSinglePlayerPersist(game);
    return game;
}

function startGame(
    settings: GameSettings,
    net: Session | null = null,
    side: 'a' | 'b' = 'a',
    names: { local: string; opponent: string } = {
        local: getPlayerName(),
        opponent: net ? 'Opponent' : 'AI',
    },
    resume: MatchResume | null = null,
    /** 2v2+ star-topology connection — mutually exclusive with `net` */
    star: StarRole | null = null,
    /** watching a finished match play back — mutually exclusive with
     *  everything above; never persists/resumes/reports (see game.ts).
     *  `jumpToRound` fast-forwards past everything before that round.
     *  `verify` re-submits telemetry at the end despite watching;
     *  `expected` is the originally-recorded outcome, shown alongside the
     *  recomputed one on the game-over screen. */
    replay: {
        actions: LoggedAction[];
        jumpToRound?: number;
        verify?: boolean;
        mode?: MatchMode;
        expected?: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number };
    } | null = null,
    /** spectate mode: a read-only live view of someone else's running match —
     *  mutually exclusive with everything above; never persists/resumes/reports
     *  (see game.ts). `watcherName` is the spectator's own name, distinct from
     *  `names` (which holds the two PLAYERS' names, for display). */
    spectate: {
        session: SpectatorSession;
        watcherName: string;
        initial: { actions: LoggedAction[]; battleElapsed: number | null; phaseRemaining: number };
    } | null = null,
): void {
    if (started) return;
    started = true;
    destroyMenuGamepadCursor();
    stopGlobalChatPoll();
    // setMenuChromeVisible(false) is never called anywhere (menu.remove()
    // below tears the chrome down permanently instead) — without this, the
    // room-list poll it would otherwise stop just keeps firing every few
    // seconds in the background for the rest of the session, including
    // during an active match where the room list is entirely irrelevant.
    stopRoomPoll();
    hideResumeOverlay();
    // Cinematic handoff for any live match entry (fresh, resume, lobby join).
    // Skip for replay/spectate — those jump straight into playback/viewing.
    const useIntro = !replay && !spectate;

    // Strip menu chrome immediately. For the intro path we MUST yield a paint
    // with logo-only before `new Game()` — otherwise the main thread freezes
    // on the last menu frame and the cinematic never covers the hitch.
    menu.remove();
    usernameEl.remove();
    versionEl.remove();
    playtestEl.remove();
    cornerActionsEl.remove();
    suggestCornerEl.remove();
    gchatEl.remove();

    if (net) {
        // Steam is the only live user of `net` now (classic PeerJS 1v1 runs
        // over star — see initial1v1Roster). Steam sessions have no cold-
        // reload-resume feature yet (net-steam.ts), so there's no marker to
        // save here, just the single-player save to clear.
        clearSinglePlayer();
    } else if (star?.role === 'guest' && !resume?.local) {
        // Only a GUEST ever saves one — if the HOST's own tab reloads, its
        // StarHub (and the whole match) is gone with it, nothing to resume
        // into. joinStarRoom always dials the room code fresh, so all that
        // needs to survive a reload is the host's name (seat 0 is always
        // the host, canonically, regardless of which side we are).
        const hostName = settings.seats?.[0]?.name;
        if (hostName) saveStarResumeMarker({ hostName, names });
    } else if (!replay && !spectate) {
        // watching a replay/spectating a live match touches neither marker —
        // it isn't a new match of ours, and clearing either here would wipe
        // out the player's real, unrelated saved game just because they
        // clicked Watch
        clearStarResumeMarker();
        if (!resume?.local && !star) clearSinglePlayer();
    }

    const bootGame = (): Game =>
        constructGame(settings, net, side, names, resume, star, replay, spectate, useIntro);

    if (!useIntro) {
        setGameLayerVisible(true);
        title.visible = false;
        app.renderer.off('resize', layoutTitle);
        bootGame();
        return;
    }

    // Compositor-driven menu zoom (CSS) while Game boots, then crossfade into 3D.
    const coverActive = introCoverEl?.classList.contains('active') ?? false;
    if (!coverActive) clearIntroCover();
    const gen = coverActive ? introGen : ++introGen;
    setGameLayerVisible(false);
    title.visible = false;
    logo.alpha = 0;
    app.renderer.off('resize', layoutTitle);
    if (!coverActive) {
        showIntroCover();
        app.render();
    }

    const beginHandoff = (game: Game): void => {
        if (gen !== introGen || !started || !introCoverEl) return;
        game.onMatchIntroProgress = (t) => {
            if (gen !== introGen || !introCoverEl) return;
            introCoverEl.style.opacity = String(1 - t);
        };
        game.onMatchIntroDone = () => {
            if (gen !== introGen) return;
            title.visible = false;
            logo.alpha = 1;
            layoutTitle();
            app.renderer.on('resize', layoutTitle);
            clearIntroCover();
        };
    };

    const bootWithHandoff = (): void => {
        if (gen !== introGen || !started) return;
        setGameLayerVisible(true);
        const game = bootGame();
        beginHandoff(game);
    };

    if (coverActive) {
        bootWithHandoff();
    } else {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => bootWithHandoff());
        });
    }
}

/** checkpoints the action log so a browser reload can resume solo play */
function wireSinglePlayerPersist(game: Game): () => void {
    let enabled = true;
    const persist = () => {
        if (!enabled) return;
        const data = game.exportResume();
        saveSinglePlayer({
            seed: data.seed,
            settings: data.settings,
            actions: data.actions,
            battleElapsed: data.battleElapsed,
            phaseRemaining: data.phaseRemaining,
            localName: getPlayerName(),
        });
    };
    game.onStateCheckpoint = persist;
    const onHide = () => persist();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    persist();
    return () => {
        enabled = false;
        game.onStateCheckpoint = null;
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('beforeunload', onHide);
    };
}

/** how long the still-connected player waits before winning by forfeit */
const RECONNECT_GRACE_SECONDS = 30;

/**
 * Survivor side of a dropped connection: pause behind a live countdown, wait
 * for the peer to come back, answer their resume request with the full
 * match state, then continue. If the peer hasn't returned within the grace
 * window, we win by forfeit.
 *
 * Transport-agnostic on purpose — `session` is the `Session` interface,
 * and every step here (`attemptRecovery`, `once`, `send`) is a `Session`-
 * level capability. This function never checks which transport it's
 * talking to; a transport with nothing to retry (see `attemptRecovery`'s
 * own doc comment — Steam's P2P self-heals a brief drop before its
 * watchdog-driven `onClose` ever fires, so there's nothing left worth
 * attempting by the time we're here) just omits the method, handled once,
 * uniformly, right below. The only live caller today is Steam 1v1 —
 * classic PeerJS 1v1 now runs over the star transport (initial1v1Roster),
 * which has its own, separate reconnect path.
 */
function wireReconnect(game: Game, initial: Session): void {
    let session = initial;
    game.onConnectionLost = () => {
        if (!session.attemptRecovery) {
            // Nothing to wait for — treat the grace window as already
            // elapsed and let the existing, already-correct grace-timeout
            // path (tick()'s own internal handling) take it from here.
            game.beginReconnectGrace(0);
            return;
        }
        const ac = new AbortController();
        game.onReconnectTimeout = () => ac.abort();
        game.beginReconnectGrace(RECONNECT_GRACE_SECONDS);
        void (async () => {
            try {
                const next = await session.attemptRecovery!(ac.signal);
                if (activeGame !== game) return;
                const first = await next.once();
                if (activeGame !== game) return;
                if (first.type === 'resume') {
                    next.send({ type: 'state', version: GAME_VERSION, ...game.exportResume() });
                }
                session = next;
                game.resumeWith(next);
            } catch (e) {
                if (activeGame !== game) return;
                // grace window already elapsed — forfeitWin() has the result,
                // nothing more to show here
                if (e instanceof DOMException && e.name === 'AbortError') return;
                game.suspend('The opponent did not come back.');
            }
        })();
    };
}

function resumeSinglePlayer(save: SinglePlayerSave): void {
    primeIntroCover();
    const settings = save.settings;
    settings.seed = save.seed;
    startGame(settings, null, 'a', { local: save.localName, opponent: 'AI' }, {
        actions: save.actions,
        battleElapsed: save.battleElapsed,
        phaseRemaining: save.phaseRemaining,
        local: true,
    });
}

/** kept around so rebuildReplayAt (round jump / skip to end) can
 *  reconstruct without re-fetching; cleared on return to menu */
let currentReplayRecord: MatchTelemetry | null = null;
/** survives across rebuildReplayAt's Game reconstructions — owned here,
 *  not by Game, for exactly that reason */
let replayControlsPanel: ReplayControls | null = null;

/** ?watch=<id>&side=<a|b> from replays.html — plays a stored match back at
 *  a natural pace instead of starting a new one. Checked ahead of any
 *  resume marker/single-player save so a replay link is never preempted. */
async function startReplayWatch(id: string, side: 'a' | 'b'): Promise<void> {
    setMenuChromeVisible(true);
    setStatus('Loading replay…');
    const record = await fetchMatchReplay(id, side);
    if (!record) {
        setStatus('Replay not found.');
        return;
    }
    setStatus('');
    currentReplayRecord = record;
    const settings = record.replay.settings;
    settings.seed = record.replay.seed;
    startGame(
        settings,
        null,
        record.side,
        { local: record.names.local, opponent: record.names.opponent },
        null,
        null,
        { actions: record.replay.actions, mode: record.mode },
    );
    const maxRound = Math.max(1, ...record.replay.actions.map((a) => a.round));
    replayControlsPanel = new ReplayControls(
        wrapper,
        maxRound,
        Game.REPLAY_SPEED_STEPS,
        Game.REPLAY_SPEED_STEPS.indexOf(1),
        {
            onJump: (round) => void rebuildReplayAt(round),
            onSkipToEnd: () => void rebuildReplayAt('end'),
            onSkipDeployment: () => activeGame?.skipReplayDeployment(),
            onSkipBattle: () => activeGame?.skipReplayBattle(),
            onSpeedChange: (index) => activeGame?.setReplaySpeedIndex(index),
        },
    );
}

/** round-jump / skip-to-end: tear down the current replay Game and
 *  reconstruct fresh, fast-forwarded to the target — state is always fully
 *  reconstructible from {seed, settings, actions}, so this is simpler and
 *  safer than trying to rewind a live instance in place. */
async function rebuildReplayAt(target: number | 'end'): Promise<void> {
    if (!currentReplayRecord) return;
    activeGame?.destroy();
    activeGame = null;
    started = false;
    const settings = currentReplayRecord.replay.settings;
    settings.seed = currentReplayRecord.replay.seed;
    startGame(
        settings,
        null,
        currentReplayRecord.side,
        { local: currentReplayRecord.names.local, opponent: currentReplayRecord.names.opponent },
        null,
        null,
        {
            actions: currentReplayRecord.replay.actions,
            jumpToRound: target === 'end' ? Infinity : target,
            mode: currentReplayRecord.mode,
        },
    );
    // a fresh Game always starts at 1x — reapply whatever the panel (which
    // survives the reconstruction) has selected. Explicit type restatement:
    // TS over-narrows activeGame to `never` here otherwise, not accounting
    // for startGame() (above) reassigning the module-level variable.
    const game = activeGame as Game | null;
    if (replayControlsPanel) {
        game?.setReplaySpeedIndex(replayControlsPanel.getSpeedIndex());
        const landedRound =
            target === 'end' ? Math.max(1, ...currentReplayRecord.replay.actions.map((a) => a.round)) : target;
        replayControlsPanel.setCurrentRound(landedRound);
    }
}

/**
 * Phase 7: a star (2v2+) guest's full teardown-and-reconstruct resync —
 * replaces the old in-place `applyStarResumeState` patch of an already-live
 * `Game` object. Fired via `Game.onNeedsFullResync` from two triggers: a
 * real reconnect just succeeded (`session` is a freshly-redialed
 * `GuestSession`, still unused by anything), or a battle-checkpoint hash
 * mismatch was detected on an otherwise still-healthy connection (`session`
 * is the CURRENT `Game`'s own `star.session`, about to be reused as-is).
 *
 * Deliberately does NOT go through the public `startGame()` — for a live
 * in-match resync that would (a) defer actual construction by two
 * `requestAnimationFrame`s and (b) hold the constructor's own `'ready'` ack
 * — and therefore the WHOLE match, every seat, via the host's
 * `pendingStarSeats`/`pendingSyncSeats` bookkeeping — behind a multi-second
 * camera fly-in cinematic that has no business replaying mid-match anyway.
 * Instead mirrors `rebuildReplayAt`'s pattern: `destroy()` the old `Game`,
 * construct a fresh one directly via `constructGame(..., useIntro=false)`,
 * synchronously, reusing the existing renderer/canvas (no
 * `replaceThreeCanvas()`).
 */
function rebuildStarGuestGame(
    session: GuestSession,
    msg: Extract<NetMessage, { type: 'matchCatchUp' }>,
): void {
    if (msg.viewer.kind !== 'seat') return; // defensive only, see the constructor's own guard
    // reject a second trigger landing before the replacement Game exists —
    // construction below is synchronous, so this only guards a genuinely
    // reentrant call (e.g. two checkpoints resolving back to back), not a
    // real race across ticks
    if (starResyncInFlight) return;
    starResyncInFlight = true;
    try {
        activeGame?.destroy({ keepStarSession: true });
        activeGame = null;
        started = false;
        const mySeat = msg.viewer.seat;
        const yourSide = msg.roster[mySeat]?.side ?? 'a';
        const settings = msg.settings;
        settings.seed = msg.seed;
        settings.seats = localizeRoster(rosterWithWiredAvatars(msg.roster), yourSide);
        const myName = msg.roster[mySeat]?.name ?? getPlayerName();
        constructGame(
            settings,
            null,
            yourSide,
            { local: myName, opponent: opponentDisplayName(msg.roster, mySeat) },
            {
                actions: msg.actions,
                battleElapsed: msg.battleElapsed,
                phaseRemaining: msg.phaseRemaining,
                local: false,
            },
            { role: 'guest', session, mySeat },
            null,
            null,
            false,
        );
        started = true;
    } finally {
        starResyncInFlight = false;
    }
}

/**
 * ?verify=<id>&side=<a|b> — a fast, no-watching way to re-check a stored
 * replay: instantly fast-forwards the whole match headlessly (same as
 * "skip to end", jumpToRound: Infinity), which re-submits the recomputed
 * result through the normal telemetry pipeline (verify: true — see
 * game.ts's finishMatch/reportMatchTelemetry). stats.php's per-side dedupe
 * means an exact match stores nothing new; any divergence creates a second
 * file for that side, visible in replays.html as a mismatch.
 *
 * Shows the normal game-over screen (with an added match/mismatch note —
 * see `expected` below) instead of redirecting immediately: the whole
 * point of Verify is to see whether it matched, so silently bouncing back
 * to the list defeats that. The screen's "Back to replays" button (its
 * label repointed here) sends you back when you're ready for the next
 * one — still fast to click through a batch, just not literally invisible.
 */
async function verifyReplayAndReturn(id: string, side: 'a' | 'b'): Promise<void> {
    setMenuChromeVisible(true);
    setStatus('Verifying…');
    const record = await fetchMatchReplay(id, side);
    if (!record) {
        setStatus('Replay not found.');
        return;
    }
    const settings = record.replay.settings;
    settings.seed = record.replay.seed;
    startGame(
        settings,
        null,
        record.side,
        { local: record.names.local, opponent: record.names.opponent },
        null,
        null,
        {
            actions: record.replay.actions,
            jumpToRound: Infinity,
            verify: true,
            mode: record.mode,
            expected: {
                result: record.result,
                rounds: record.rounds,
                playerHp: record.playerHp,
                enemyHp: record.enemyHp,
            },
        },
    );
    // repoints the game-over screen's button (labeled "Back to replays" by
    // finishMatch's verify branch) instead of the normal in-game menu —
    // explicit type restatement for the same reason as rebuildReplayAt above
    const game = activeGame as Game | null;
    if (game) {
        game.onReturnToMenu = () => {
            location.href = new URL('backend/replays.html', location.href).href;
        };
    }
}

interface BulkVerifyResult {
    id: string;
    side: 'a' | 'b';
    ok: boolean;
    matches: boolean;
    names: { local: string; opponent: string };
    expected?: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number };
    actual?: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number };
    error?: string;
}

/**
 * ?bulkverify=1 — chains verifyReplayAndReturn's headless re-check across a
 * whole queue without a click per item (replays.html's Bulk Verify button
 * seeds the queue into sessionStorage before navigating here). Each item's
 * Game is fast-forwarded synchronously in its constructor (jumpToRound:
 * Infinity), so no waiting on the interactive game-over screen is needed —
 * just read getFinalResult() the instant `startGame` returns and move on.
 * Writes a summary to sessionStorage and navigates back to replays.html,
 * which renders it as a dialog on load.
 */
async function runBulkVerify(queue: { id: string; side: 'a' | 'b' }[]): Promise<void> {
    setMenuChromeVisible(true);
    const results: BulkVerifyResult[] = [];
    for (let i = 0; i < queue.length; i++) {
        const { id, side } = queue[i]!;
        setStatus(`Bulk verifying ${i + 1}/${queue.length}…`);
        const record = await fetchMatchReplay(id, side);
        if (!record) {
            results.push({
                id,
                side,
                ok: false,
                matches: false,
                names: { local: '(unknown)', opponent: '(unknown)' },
                error: 'replay not found',
            });
            continue;
        }
        activeGame?.destroy();
        activeGame = null;
        started = false;
        const settings = record.replay.settings;
        settings.seed = record.replay.seed;
        startGame(
            settings,
            null,
            record.side,
            { local: record.names.local, opponent: record.names.opponent },
            null,
            null,
            {
                actions: record.replay.actions,
                jumpToRound: Infinity,
                verify: true,
                mode: record.mode,
                expected: {
                    result: record.result,
                    rounds: record.rounds,
                    playerHp: record.playerHp,
                    enemyHp: record.enemyHp,
                },
            },
        );
        // explicit type restatement — see rebuildReplayAt above
        const game = activeGame as Game | null;
        const actual = game?.getFinalResult() ?? undefined;
        const expected = {
            result: record.result,
            rounds: record.rounds,
            playerHp: record.playerHp,
            enemyHp: record.enemyHp,
        };
        const matches =
            !!actual &&
            actual.result === expected.result &&
            actual.rounds === expected.rounds &&
            actual.playerHp === expected.playerHp &&
            actual.enemyHp === expected.enemyHp;
        results.push({ id, side, ok: true, matches, names: record.names, expected, actual });
    }
    activeGame?.destroy();
    activeGame = null;
    started = false;
    sessionStorage.setItem('mechili-bulk-verify-results', JSON.stringify(results));
    location.href = new URL('backend/replays.html', location.href).href;
}

// ---- Steam 1v1 (PeerJS's NetSession has no equivalent on Steam, so this
// is its own small orchestration rather than a shared function — see
// net-steam.ts) --------------------------------------------------------

const STEAM_HANDSHAKE_TIMEOUT_MS = 20_000;

async function beginSteamNetGame(
    session: SteamSession,
    role: 'host' | 'guest',
    applyMode?: (settings: GameSettings) => void,
): Promise<void> {
    const localName = getPlayerName();
    const localAvatar = getAvatarDataUrl();
    if (role === 'guest') {
        session.send({ type: 'hello', name: localName, avatar: localAvatar });
        setStatus('Receiving match setup…');
        const msg = await Promise.race([
            session.once(),
            new Promise<NetMessage>((_, reject) =>
                setTimeout(
                    () => reject(new Error('Host did not start the match')),
                    STEAM_HANDSHAKE_TIMEOUT_MS,
                ),
            ),
        ]);
        if (msg.type !== 'setup' || msg.version !== GAME_VERSION) {
            setStatus('Version mismatch — both players need the same game version.');
            session.close();
            return;
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
        settings.seats = localizeRoster(
            canonicalClassicSeats(
                msg.hostName,
                localName,
                wireAvatar(msg.hostAvatar),
                wireAvatar(msg.guestAvatar) ?? localAvatar,
            ),
            'b',
        );
        startGame(settings, session, 'b', { local: localName, opponent: msg.hostName });
        return;
    }
    const helloMsg = await Promise.race([
        session.once(),
        new Promise<NetMessage>((_, reject) =>
            setTimeout(() => reject(new Error('Opponent did not respond')), STEAM_HANDSHAKE_TIMEOUT_MS),
        ),
    ]);
    if (helloMsg.type !== 'hello') throw new Error('Unexpected handshake');
    const guestName = helloMsg.name;
    const guestAvatar = wireAvatar(helloMsg.avatar);
    const settings = settingsFromUrl();
    applyMode?.(settings);
    delete settings.seats;
    settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
    settings.seats = localizeRoster(
        canonicalClassicSeats(localName, guestName, localAvatar, guestAvatar),
        'a',
    );
    session.send({
        type: 'setup',
        version: GAME_VERSION,
        seed: settings.seed,
        settings: { ...settings, seats: undefined },
        hostName: localName,
        guestName,
        hostAvatar: localAvatar,
        guestAvatar,
    });
    startGame(settings, session, 'a', { local: localName, opponent: guestName });
}

function runSteamPending(
    p: Promise<SteamSession>,
    role: 'host' | 'guest',
    applyMode?: (settings: GameSettings) => void,
): void {
    showMenuView('session');
    setMenuBusy(true);
    if (role === 'host') setStatus('Waiting for an opponent…');
    p.then((session) => {
        setMenuBusy(false);
        void beginSteamNetGame(session, role, applyMode);
    }).catch((e: unknown) => {
        setMenuBusy(false);
        setStatus(`Could not connect: ${e instanceof Error ? e.message : e}`);
    });
}

// ---- online play (star topology — every mode, 1v1 included) -----------

/** host is always seat 0, side 'a'; the other 3 slots start open for joiners */
function initialStarRoster(hostName: string): CanonicalSeatDef[] {
    const avatar = getAvatarDataUrl() || undefined;
    return [
        { side: 'a', controller: 'human', name: hostName, avatar },
        { side: 'a', controller: 'human', name: 'Waiting…' },
        { side: 'b', controller: 'human', name: 'Waiting…' },
        { side: 'b', controller: 'human', name: 'Waiting…' },
    ];
}
/** 1v1 is just a 2-seat star room — one seat per side, no AI-fill slots
 *  besides the guest's own (see beginStarHost's roster param). */
function initial1v1Roster(hostName: string): CanonicalSeatDef[] {
    const avatar = getAvatarDataUrl() || undefined;
    return [
        { side: 'a', controller: 'human', name: hostName, avatar },
        { side: 'b', controller: 'human', name: 'Waiting…' },
    ];
}

/** Drop untrusted avatar payloads from wire/roster copies. */
function rosterWithWiredAvatars(roster: CanonicalSeatDef[]): CanonicalSeatDef[] {
    return roster.map((s) => {
        const avatar = wireAvatar(s.avatar);
        return avatar ? { ...s, avatar } : { ...s, avatar: undefined };
    });
}
/** fallback name for a still-empty seat when the host clicks Start —
 *  derived from side (host's own side = 'Ally', the other = 'Foe'), so
 *  this works for any roster size, not just the hardcoded 4-seat layout */
function starAiName(seat: SeatId, roster: CanonicalSeatDef[]): string {
    const mySide = roster[0]!.side;
    if (roster[seat]!.side === mySide) return 'Ally';
    const foeSeats = roster.map((_, i) => i).filter((i) => roster[i]!.side !== mySide);
    if (foeSeats.length <= 1) return 'Foe';
    return foeSeats.indexOf(seat) === 0 ? 'Foe West' : 'Foe East';
}
/** the HUD's "opponent" name field only ever makes sense for a genuine
 *  2-seat (1v1-via-star) roster — a real 2v2+ has no single opponent to
 *  name, so it keeps the generic '2v2' label the HUD already expects. */
function opponentDisplayName(roster: CanonicalSeatDef[], mySeat: SeatId): string {
    if (roster.length !== 2) return '2v2';
    return roster[mySeat === 0 ? 1 : 0]?.name ?? '2v2';
}

function cancelStarHost(): void {
    // .cleanup() alone only does lobby/heartbeat bookkeeping — deliberately
    // NOT the hub's own Peer connection, since startStarMatch's identical
    // cleanup() call needs the hub to survive the handoff to the running
    // Game. Here, though, nobody is ever going to use this hub — abandoning
    // without closing it left the peer id registered with the PeerJS
    // broker indefinitely, so hosting again under the same username failed
    // with "already hosting" until the whole tab was reloaded.
    //
    // cleanup() (sends ?action=leave, the externally-visible "room is gone"
    // signal) runs FIRST and in its own try — previously hub.close() ran
    // first and unguarded, so if peer.destroy() ever threw (e.g. a
    // connection mid-negotiation), the whole function aborted right there
    // and lobbyLeave() never fired; the room then only vanished once the
    // backend's own 15s TTL lapsed (live-observed: host clicked Cancel,
    // guest still saw the room in the list for ~10s, even after reload).
    try {
        starHosting?.cleanup();
    } catch (e) {
        console.error('cancelStarHost: cleanup() failed', e);
    }
    // the real, final teardown (LAN's lan.stopHost() — deliberately NOT
    // part of cleanup() above, see hostStarRoom's own doc comment on why:
    // startStarMatch() reuses that same cleanup() at the point ownership
    // passes to the running Game, and the LAN signaling server must
    // survive that handoff for guests to be able to redial later)
    try {
        starHosting?.stopDiscovery();
    } catch (e) {
        console.error('cancelStarHost: stopDiscovery() failed', e);
    }
    try {
        starHosting?.hub.close();
    } catch (e) {
        console.error('cancelStarHost: hub.close() failed', e);
    }
    starHosting = null;
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
}

/** set by beginStarHost's caller right before hosting; read by startStarMatch */
let starHordeFlag = false;
/** set only by the Custom Game host flow — when present, startStarMatch
 *  applies ALL of it (timers, roundCards, horde), overriding starHordeFlag */
let starCustomConfig: CustomGameConfig | null = null;
/** set by beginStarHost right before hosting; read by startStarMatch to tag
 *  the running Game's StarRole so it can skip registering a LAN match's
 *  spectate endpoint with the public cloud backend (see StarRole.isLan) */
let starDiscovery: 'matchmaking' | 'lan' = 'matchmaking';

/**
 * `waitForJoined`: total participants (host included) to wait for before
 * auto-starting — default 2 (today's normal behavior: start the moment
 * one guest joins, AI-filling whatever's left). The `?test2v2=<n>` param
 * (see its own comment near the URL-param block) raises this to 3 or 4 so
 * a real multi-tab test can actually gather everyone before the match
 * begins, instead of racing the very first join.
 *
 * `offerAiStart`: shows the "give up waiting, start now" button/copy while
 * the room is short of `waitForJoined`. Plain 1v1 Matchmaking deliberately
 * passes `false` — Single Player already covers "vs AI", so open 1v1
 * matchmaking should only ever end in a real opponent or a cancel, never
 * silently duplicate Single Player. 2v2 keeps it (AI-filling the *other*
 * seats is a real, intentional feature there, not a vs-AI escape hatch),
 * and Custom Game keeps it for both — that screen is exactly where "start
 * now, AI takes whatever's left" belongs.
 */
async function beginStarHost(
    horde = false,
    waitForJoined = 2,
    customConfig: CustomGameConfig | null = null,
    buildRoster: (hostName: string) => CanonicalSeatDef[] = initialStarRoster,
    mode: '1v1' | '2v2' = '2v2',
    offerAiStart = true,
    discovery: 'matchmaking' | 'lan' = 'matchmaking',
): Promise<void> {
    starHordeFlag = horde;
    starCustomConfig = customConfig;
    starDiscovery = discovery;
    showMenuView('session');
    setMenuBusy(true);
    setStatus(
        discovery === 'lan'
            ? mode === '1v1'
                ? 'Opening LAN room…'
                : 'Opening LAN 2v2 room…'
            : mode === '1v1'
              ? 'Opening room…'
              : 'Opening 2v2 room…',
    );
    const hostName = getPlayerName();
    // hostStarRoom() itself can't be aborted mid-flight (a real network
    // round trip: PeerJS signaling plus an HTTP call to the matchmaking
    // backend) — this only tracks whether Cancel was clicked WHILE it was
    // pending, so the resolved room can be torn down immediately instead
    // of reviving a "ghost" room the user already dismissed (starHosting
    // was still null when cancelStarHost() ran, so it had nothing to do).
    let cancelled = false;
    pending?.cancel();
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    let hosted: Awaited<ReturnType<typeof hostStarRoom>>;
    try {
        hosted = await hostStarRoom(buildRoster(hostName), setStatus, mode, discovery);
    } catch (e) {
        pending = null;
        setMenuBusy(false);
        setStatus(`Could not host: ${e instanceof Error ? e.message : e}`);
        return;
    }
    pending = null;
    if (cancelled) {
        hosted.hub.close();
        hosted.cleanup();
        return;
    }
    setMenuBusy(false);
    starHosting = hosted;
    const { hub } = hosted;
    if (offerAiStart) {
        // shared with 2v2 (same button) since 1v1 now hosts through the
        // same star path — label it for whichever mode is actually running
        // instead of the old static "Start 2v2 Match" text 1v1 inherited
        // by accident
        startStarBtn.textContent = mode === '1v1' ? 'Start 1v1 Match' : 'Start 2v2 Match';
        startStarBtn.style.display = '';
    }
    const refresh = () => {
        if (!starHosting) return;
        const roster = hub.currentRoster();
        const joined = hub.connectedSeats().length + 1;
        const names = roster.map((s, i) => (i === 0 ? `${s.name} (you)` : s.name)).join(', ');
        // only ACTUALLY joined seats (host + currently connected) — the
        // rest of `roster` is still "Waiting…" placeholders, not real names
        const connectedNames = [0, ...hub.connectedSeats()]
            .sort((a, b) => a - b)
            .map((i) => roster[i]?.name ?? '')
            .join(', ');
        renderRosterTable(roster, 0, waitForJoined, customConfig ? (seat) => hub.kickSeat(seat) : undefined);
        // let every currently-connected guest see the same live roster
        // preview instead of just a static "waiting for the host" — see
        // runStarPending's 'starRoster' handling
        hub.broadcast({ type: 'starRoster', roster, waitForJoined });
        let allReady = true;
        if (customConfig) {
            showHostLobbySettings(customConfig, () => {
                resetReadyOnSettingsChange(hub);
                refresh();
            });
            // re-sent on every refresh (not just on an actual edit) so a
            // freshly-joined guest sees the current settings immediately,
            // without waiting for the host to change something first
            hub.broadcast({ type: 'lobbySettings', config: customConfig });
            allReady = allSeatsReady(roster);
        }
        startStarBtn.disabled = !!customConfig && !allReady;
        // auto-start once `waitForJoined` have joined — EXCEPT for a Custom
        // Game room (customConfig set), which always waits for the host's
        // own explicit Start click instead. Matchmaking/quick-match rooms
        // (customConfig null) keep the original no-manual-step behavior —
        // that queue is specifically "get into a match fast," where a
        // Custom Game host wants a last look at who joined (and the chance
        // to kick someone) before committing.
        if (joined >= waitForJoined && !customConfig) {
            setStatus(`Room "${hostName}" — ${joined}/${roster.length} joined: ${names}. Starting…`);
            startStarMatch();
            return;
        }
        if (joined >= waitForJoined && customConfig && !allReady) {
            setStatus(`Room "${hostName}" — ${joined}/${roster.length} joined. Waiting for everyone to ready up.`);
        } else if (joined >= waitForJoined) {
            setStatus(`Room "${hostName}" — ${joined}/${roster.length} joined: ${names}. Ready — click Start.`);
        } else if (offerAiStart) {
            const modeLabel = mode === '1v1' ? '1vs1' : '2vs2';
            const remaining = waitForJoined - joined;
            const namesPart = joined > 1 ? `${connectedNames} - ` : '';
            setStatus(
                `Room "${hostName}" ${modeLabel} - ${namesPart}waiting for ${remaining} more player${remaining === 1 ? '' : 's'}. Click Start to play vs AI`,
            );
        } else {
            setStatus('Waiting for an opponent');
        }
    };
    hub.onRosterChange = refresh;
    hub.onMessage = (seat, msg) => {
        if (msg.type !== 'lobbyReady') return;
        const entry = hub.currentRoster()[seat];
        if (entry) hub.setRosterEntry(seat, { ...entry, ready: msg.ready });
        refresh();
    };
    hub.listen((name, version, conn, avatar) => {
        if (version !== GAME_VERSION) {
            conn.send({
                type: 'starRejected',
                reason: 'Version mismatch — both players need the same game version.',
            });
            conn.close();
            return null;
        }
        const seat = hub.nextOpenSeat();
        if (seat === null) {
            conn.send({ type: 'starRejected', reason: 'Room is full.' });
            conn.close();
            return null;
        }
        hub.setRosterEntry(seat, {
            side: hub.sideOf(seat),
            controller: 'human',
            name,
            avatar: wireAvatar(avatar) || undefined,
        });
        return seat;
    });
    refresh();
}

/** host clicks Start: AI-fill empty seats, send each guest its own setup, launch locally */
function startStarMatch(): void {
    if (!starHosting) return;
    const { hub } = starHosting;
    const connected = new Set(hub.connectedSeats());
    const currentRoster = hub.currentRoster();
    const finalRoster: CanonicalSeatDef[] = currentRoster.map((s, i) => {
        if (i > 0 && s.controller === 'human' && !connected.has(i)) {
            return { side: s.side, controller: 'ai' as const, name: starAiName(i, currentRoster) };
        }
        return s;
    });
    // Sync the AI-fill back into StarHub's OWN roster (not just the local
    // `finalRoster` sent out over the wire) — StarHub.nextOpenSeat() reads
    // its own `this.roster`, which otherwise still says `controller:
    // 'human'` for a seat that was never actually joined. Left unsynced, a
    // never-filled seat would look "open" to the lobby's join-acceptor (it
    // stays wired for the whole match — see StarHub.listen()) forever,
    // letting a brand-new stranger claim it mid-match and receive the full
    // matchCatchUp as if they'd been playing since round 0.
    finalRoster.forEach((entry, seat) => hub.setRosterEntry(seat, entry));
    const settings = settingsFromUrl();
    delete settings.seats; // canonical roster travels separately, localized per recipient
    if (starCustomConfig) applyCustomGameConfig(settings, starCustomConfig);
    else if (starHordeFlag) applyHordeMode(settings);
    // 2v2 / duo only — 1v1 must keep the standard map width
    if (finalRoster.length > 2) widenMapForDuo(settings);
    settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
    for (const seat of connected) {
        hub.send(seat, {
            type: 'starSetup',
            version: GAME_VERSION,
            seed: settings.seed,
            settings,
            roster: finalRoster,
            yourSeat: seat,
            yourSide: hub.sideOf(seat),
        });
    }
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
    const hostSettings = { ...settings, seats: localizeRoster(finalRoster, 'a') };
    startGame(
        hostSettings,
        null,
        'a',
        { local: getPlayerName(), opponent: opponentDisplayName(finalRoster, 0) },
        null,
        { role: 'host', hub, mySeat: 0, isLan: starDiscovery === 'lan' },
    );
    // the room is no longer "waiting to join" — stop the lobby heartbeat
    // and tell the backend it's gone (does NOT touch `hub`/its Peer
    // connection, which the running Game now owns and keeps alive; only
    // clears the interval + sends ?action=leave for the OLD kind=lobby
    // registration). Previously skipped here, so the lobby heartbeat kept
    // re-registering `kind=lobby` forever in the background for as long as
    // the tab stayed open — showing a stale, still-"joinable" room in the
    // list alongside the real kind=spectate entry the running match
    // registers separately (repro: "mangoo" AND "mangoo (2v2)" AND "Watch
    // mangoo (2v2)" all listed for the same host at once).
    hub.leaveLobby(); // from here, a drop gets the reconnect grace window instead of an immediate reset
    starHosting?.cleanup();
    starHosting = null; // ownership of `hub` passes to the running Game now
    starCustomConfig = null;
}

/** join a 2v2 room by the host's room name — waits for the host to Start */
function beginStarJoin(hostName: string, peerServer?: PeerServerConfig | null): void {
    const p = joinStarRoom(hostName, setStatus, peerServer);
    pending?.cancel();
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
            p.cancel();
        },
    };
    showMenuView('session');
    setMenuBusy(true);
    p.session
        .then((session) => {
            if (cancelled) {
                session.close();
                return;
            }
            bindStarGuestSession(session);
        })
        .catch((e: unknown) => {
            pending = null;
            setMenuBusy(false);
            if (cancelled || String(e).includes('cancelled')) {
                showMenuView('main');
            } else {
                // without this, a permanently-dead host (room gone for good)
                // leaves the StarResumeMarker in place, and the next page
                // load's auto-reconnect block reads it and repeats this
                // exact same doomed connect attempt forever — same clear
                // bindStarGuestSession's starRejected/starRejoinRejected
                // handling already does for the "connected, then rejected"
                // case; this is its "never even connected" counterpart.
                clearStarResumeMarker();
                setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
            }
        });
}

/** Drive an already-connected star guest (optional first message already read via once()). */
function bindStarGuestSession(session: StarGuestSession, first?: NetMessage): void {
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
            session.close();
        },
    };
    setMenuBusy(true);
    setStatus('Connected — waiting for the host to start…');
    session.onClose = () => {
        if (started) return;
        cancelled = true;
        pending = null;
        setMenuBusy(false);
        clearRosterTable();
        clearLobbySettings();
        setStatus('Host closed the room.', 5000);
    };
    // this client's OWN seat number, once known — needed both for
    // renderRosterTable's "you" highlighting and to interpret 'ready'
    // clicks. Found by matching the roster's name against our own,
    // same pattern the host-reclaim path already relies on — a genuine
    // ambiguity only if two players share a name, an accepted edge case.
    let mySeat: SeatId | null = null;
    const handle = (msg: NetMessage): void => {
        if (cancelled) return;
        if (msg.type === 'starRoster') {
            const found = msg.roster.findIndex((s) => s.name === getPlayerName());
            if (found >= 0) mySeat = found;
            renderRosterTable(msg.roster, mySeat ?? 1, msg.waitForJoined);
            if (mySeat !== null) lobbyReadyCheckEl.checked = msg.roster[mySeat]?.ready ?? false;
            setStatus('Connected — waiting for the host to start…');
            return;
        }
        if (msg.type === 'lobbySettings') {
            showGuestLobbySettings(msg.config, (ready) => session.send({ type: 'lobbyReady', ready }));
            return;
        }
        // Anything besides the handshake message types below is only ever
        // meaningful once a Game object exists to receive it — a broadcast
        // (chat, etc.) that reaches this connection before its own join
        // handshake finishes is not a protocol error, just an ordering
        // artifact of being one of several recipients on the host's send
        // list. Checked BEFORE clearing pending/busy state below, so a
        // stray early broadcast doesn't prematurely flip the UI out of its
        // "connecting…" state while still genuinely waiting on the real
        // handshake message. Confirmed live: reclaimSeatFromAi's chat
        // announcement raced ahead of its own matchCatchUp and got
        // misread here as a version mismatch, closing a connection the
        // host had just accepted.
        if (
            msg.type !== 'starRejected' &&
            msg.type !== 'starRejoinRejected' &&
            msg.type !== 'matchCatchUp' &&
            msg.type !== 'starSetup'
        ) {
            return;
        }
        pending = null;
        setMenuBusy(false);
        if (msg.type === 'starRejected' || msg.type === 'starRejoinRejected') {
            // a stale StarResumeMarker for this same match would otherwise
            // keep silently re-firing this exact rejected starJoin on every
            // future page load (see the auto-reconnect block near the
            // bottom of this file) — most commonly a version mismatch after
            // a bundle update, which no amount of retrying ever resolves
            clearStarResumeMarker();
            clearRosterTable();
            clearLobbySettings();
            setStatus(msg.reason, 5000);
            session.close();
            return;
        }
        if (msg.type === 'matchCatchUp') {
            // a guest connection only ever receives the {kind:'seat'}
            // flavor (the {kind:'spectator'} flavor goes over the separate
            // SpectatorHub connection, see joinAsSpectator) — defensive
            // only, should never actually fire
            if (msg.viewer.kind !== 'seat') return;
            if (msg.version !== GAME_VERSION) {
                clearStarResumeMarker();
                clearRosterTable();
                clearLobbySettings();
                setStatus('Version mismatch — both players need the same game version.', 5000);
                session.close();
                return;
            }
            const mySeat = msg.viewer.seat;
            const yourSide = msg.roster[mySeat]?.side ?? 'a';
            const settings = msg.settings;
            settings.seed = msg.seed;
            settings.seats = localizeRoster(rosterWithWiredAvatars(msg.roster), yourSide);
            const myName = msg.roster[mySeat]?.name ?? getPlayerName();
            clearRosterTable();
            clearLobbySettings();
            startGame(
                settings,
                null,
                yourSide,
                { local: myName, opponent: opponentDisplayName(msg.roster, mySeat) },
                {
                    actions: msg.actions,
                    battleElapsed: msg.battleElapsed,
                    phaseRemaining: msg.phaseRemaining,
                    local: false,
                },
                { role: 'guest', session, mySeat },
            );
            return;
        }
        // only 'starSetup' can reach here (see the guard above)
        if (msg.version !== GAME_VERSION) {
            clearStarResumeMarker();
            clearRosterTable();
            clearLobbySettings();
            setStatus('Version mismatch — both players need the same game version.', 5000);
            session.close();
            return;
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
        settings.seats = localizeRoster(rosterWithWiredAvatars(msg.roster), msg.yourSide);
        const myName = msg.roster[msg.yourSeat]?.name ?? getPlayerName();
        clearRosterTable();
        clearLobbySettings();
        startGame(
            settings,
            null,
            msg.yourSide,
            { local: myName, opponent: opponentDisplayName(msg.roster, msg.yourSeat) },
            null,
            {
                role: 'guest',
                session,
                mySeat: msg.yourSeat,
            },
        );
    };
    if (first) handle(first);
    session.attach(handle);
}

/**
 * Connect to a star room; return false if full/rejected/unreachable so matchmaking
 * can try the next candidate. On success, owns the guest session (returns true).
 */
async function tryAdmitStarGuest(
    hostName: string,
    peerServer?: PeerServerConfig | null,
): Promise<boolean> {
    const p = joinStarRoom(hostName, setStatus, peerServer);
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
            p.cancel();
        },
    };
    try {
        const session = await p.session;
        if (cancelled) {
            session.close();
            return true; // stop outer loop
        }
        const first = await Promise.race([
            session.once(),
            new Promise<NetMessage>((_, reject) =>
                setTimeout(() => reject(new Error('Host did not respond')), 12_000),
            ),
        ]);
        if (cancelled) {
            session.close();
            return true;
        }
        if (first.type === 'starRejected' || first.type === 'starRejoinRejected') {
            session.close();
            return false;
        }
        bindStarGuestSession(session, first);
        return true;
    } catch {
        if (cancelled) return true;
        return false;
    }
}

// ---- Steam 2v2 (parallel to beginStarHost/startStarMatch/beginStarJoin/
// runStarPending above; own state (steamStarHosting) since a PeerJS StarHub
// and a SteamStarHub are never both active at once) -------------------------

function cancelSteamStarHost(): void {
    steamStarHosting?.hub.close();
    steamStarHosting = null;
    starCustomConfig = null;
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
}

/** shared setup for a freshly-created SteamStarHub, whichever call site created it */
function wireSteamStarHub(
    hub: SteamStarHub,
    opts: {
        waitForJoined?: number;
        offerAiStart?: boolean;
        mode?: '1v1' | '2v2';
    } = {},
): void {
    const waitForJoined = opts.waitForJoined ?? 2;
    const offerAiStart = opts.offerAiStart ?? true;
    const mode = opts.mode ?? '2v2';
    if (offerAiStart) {
        startStarBtn.textContent = mode === '1v1' ? 'Start 1v1 Match' : 'Start 2v2 Match';
        startStarBtn.style.display = '';
    }
    const refresh = () => {
        if (!steamStarHosting) return;
        const roster = hub.currentRoster();
        const joined = hub.connectedSeats().length + 1;
        const names = roster.map((s, i) => (i === 0 ? `${s.name} (you)` : s.name)).join(', ');
        const connectedNames = [0, ...hub.connectedSeats()]
            .sort((a, b) => a - b)
            .map((i) => roster[i]?.name ?? '')
            .join(', ');
        renderRosterTable(
            roster,
            0,
            waitForJoined,
            starCustomConfig ? (seat) => hub.kickSeat(seat) : undefined,
        );
        hub.broadcast({ type: 'starRoster', roster, waitForJoined });
        let allReady = true;
        if (starCustomConfig) {
            showHostLobbySettings(starCustomConfig, () => {
                resetReadyOnSettingsChange(hub);
                refresh();
            });
            hub.broadcast({ type: 'lobbySettings', config: starCustomConfig });
            allReady = allSeatsReady(roster);
        }
        startStarBtn.disabled = !!starCustomConfig && !allReady;
        // same Custom-Game-never-auto-starts rule as beginStarHost's refresh
        // — starCustomConfig is set by beginSteamStarHost right before this
        // hub was wired, so it's already correct by the time this runs
        if (joined >= waitForJoined && !starCustomConfig) {
            setStatus(`Steam lobby — ${joined}/${roster.length} joined: ${names}. Starting…`);
            startSteamStarMatch();
            return;
        }
        if (joined >= waitForJoined && starCustomConfig && !allReady) {
            setStatus(`Steam lobby — ${joined}/${roster.length} joined. Waiting for everyone to ready up.`);
        } else if (joined >= waitForJoined) {
            setStatus(`Steam lobby — ${joined}/${roster.length} joined: ${names}. Ready — click Start.`);
        } else if (offerAiStart) {
            const modeLabel = mode === '1v1' ? '1vs1' : '2vs2';
            const remaining = waitForJoined - joined;
            const namesPart = joined > 1 ? `${connectedNames} - ` : '';
            setStatus(
                `Steam lobby ${modeLabel} - ${namesPart}waiting for ${remaining} more player${remaining === 1 ? '' : 's'}. Click Start to play vs AI`,
            );
        } else {
            setStatus('Waiting for an opponent');
        }
    };
    hub.onRosterChange = refresh;
    hub.onMessage = (seat, msg) => {
        if (msg.type !== 'lobbyReady') return;
        const entry = hub.currentRoster()[seat];
        if (entry) hub.setRosterEntry(seat, { ...entry, ready: msg.ready });
        refresh();
    };
    hub.listen((name, version, _steamId64, avatar) => {
        if (version !== GAME_VERSION) {
            return { reject: 'Version mismatch — both players need the same game version.' };
        }
        const seat = hub.nextOpenSeat();
        if (seat === null) return { reject: 'Room is full.' };
        hub.setRosterEntry(seat, {
            side: hub.sideOf(seat),
            controller: 'human',
            name,
            avatar: wireAvatar(avatar) || undefined,
        });
        return seat;
    });
    refresh();
}

/** Host a Steam 2v2+ star lobby (Custom Game, or legacy Invite 2v2). */
async function beginSteamStarHost(
    opts:
        | boolean
        | {
              horde?: boolean;
              customConfig?: CustomGameConfig | null;
              waitForJoined?: number;
              isPublic?: boolean;
              offerAiStart?: boolean;
              openInvite?: boolean;
              buildRoster?: (hostName: string) => CanonicalSeatDef[];
          } = {},
): Promise<void> {
    // Legacy call site: beginSteamStarHost(horde)
    const o = typeof opts === 'boolean' ? { horde: opts } : opts;
    starHordeFlag = !!o.horde;
    starCustomConfig = o.customConfig ?? null;
    const waitForJoined = o.waitForJoined ?? 2;
    const isPublic = o.isPublic ?? false;
    const offerAiStart = o.offerAiStart ?? true;
    const openInvite = o.openInvite ?? !isPublic;
    const buildRoster = o.buildRoster ?? initialStarRoster;

    showMenuView('session');
    setMenuBusy(true);
    setStatus('Opening Steam lobby…');
    // same missing-cancellation-check bug as beginStarHost, same fix: track
    // whether Cancel was clicked while hostSteamStarRoom() was still
    // pending (steamStarHosting is still null then, so cancelSteamStarHost
    // has nothing to close), and tear the lobby down immediately once it
    // resolves instead of reviving a dismissed "ghost" lobby.
    let cancelled = false;
    pending?.cancel();
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    let hosted: { hub: SteamStarHub; lobbyId: string };
    try {
        hosted = await hostSteamStarRoom(buildRoster(getPlayerName()), isPublic);
    } catch (e) {
        pending = null;
        setMenuBusy(false);
        starCustomConfig = null;
        setStatus(`Could not host: ${e instanceof Error ? e.message : e}`);
        return;
    }
    pending = null;
    if (cancelled) {
        hosted.hub.close();
        return;
    }
    setMenuBusy(false);
    steamStarHosting = hosted;
    wireSteamStarHub(hosted.hub, { waitForJoined, offerAiStart, mode: '2v2' });
    if (openInvite) steamLobby.openInviteDialog();
}

/** host clicks Start: AI-fill empty seats, send each guest its own setup,
 *  launch locally — mirrors startStarMatch */
function startSteamStarMatch(): void {
    if (!steamStarHosting) return;
    const { hub } = steamStarHosting;
    const connected = new Set(hub.connectedSeats());
    const currentRoster = hub.currentRoster();
    const finalRoster: CanonicalSeatDef[] = currentRoster.map((s, i) => {
        if (i > 0 && s.controller === 'human' && !connected.has(i)) {
            return { side: s.side, controller: 'ai' as const, name: starAiName(i, currentRoster) };
        }
        return s;
    });
    // see startStarMatch's identical fix — StarHub/SteamStarHub.nextOpenSeat()
    // reads this hub's own roster, which must reflect the AI-fill too.
    finalRoster.forEach((entry, seat) => hub.setRosterEntry(seat, entry));
    const settings = settingsFromUrl();
    delete settings.seats;
    if (starCustomConfig) applyCustomGameConfig(settings, starCustomConfig);
    else if (starHordeFlag) applyHordeMode(settings);
    // 2v2 / duo only — 1v1 must keep the standard map width
    if (finalRoster.length > 2) widenMapForDuo(settings);
    settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
    for (const seat of connected) {
        hub.send(seat, {
            type: 'starSetup',
            version: GAME_VERSION,
            seed: settings.seed,
            settings,
            roster: finalRoster,
            yourSeat: seat,
            yourSide: hub.sideOf(seat),
        });
    }
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
    const hostSettings = { ...settings, seats: localizeRoster(finalRoster, 'a') };
    startGame(
        hostSettings,
        null,
        'a',
        { local: getPlayerName(), opponent: opponentDisplayName(finalRoster, 0) },
        null,
        {
            role: 'host',
            hub,
            mySeat: 0,
        },
    );
    hub.leaveLobby(); // from here, a drop gets the reconnect grace window instead of an immediate reset
    steamStarHosting = null; // ownership passes to the running Game now
    starCustomConfig = null;
}

function bindSteamStarGuestSession(session: SteamGuestSession, first?: NetMessage): void {
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
            session.close();
        },
    };
    setMenuBusy(true);
    setStatus('Connected — waiting for the host to start…');
    session.onClose = () => {
        if (started) return;
        cancelled = true;
        pending = null;
        setMenuBusy(false);
        clearRosterTable();
        clearLobbySettings();
        setStatus('Host closed the room.', 5000);
    };
    let mySeat: SeatId | null = null;
    const handle = (msg: NetMessage): void => {
        if (cancelled) return;
        if (msg.type === 'starRoster') {
            const found = msg.roster.findIndex((s) => s.name === getPlayerName());
            if (found >= 0) mySeat = found;
            renderRosterTable(msg.roster, mySeat ?? 1, msg.waitForJoined);
            if (mySeat !== null) lobbyReadyCheckEl.checked = msg.roster[mySeat]?.ready ?? false;
            setStatus('Connected — waiting for the host to start…');
            return;
        }
        if (msg.type === 'lobbySettings') {
            showGuestLobbySettings(msg.config, (ready) => session.send({ type: 'lobbyReady', ready }));
            return;
        }
        pending = null;
        setMenuBusy(false);
        if (msg.type === 'starRejected') {
            clearRosterTable();
            clearLobbySettings();
            setStatus(msg.reason, 5000);
            session.close();
            return;
        }
        if (msg.type !== 'starSetup' || msg.version !== GAME_VERSION) {
            clearRosterTable();
            clearLobbySettings();
            setStatus('Version mismatch — both players need the same game version.', 5000);
            session.close();
            return;
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
        settings.seats = localizeRoster(rosterWithWiredAvatars(msg.roster), msg.yourSide);
        const myName = msg.roster[msg.yourSeat]?.name ?? getPlayerName();
        clearRosterTable();
        clearLobbySettings();
        startGame(settings, null, msg.yourSide, { local: myName, opponent: '2v2' }, null, {
            role: 'guest',
            session,
            mySeat: msg.yourSeat,
        });
    };
    if (first) handle(first);
    session.attach(handle);
}

function runSteamStarPending(p: Promise<SteamGuestSession>): void {
    pending?.cancel();
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    showMenuView('session');
    setMenuBusy(true);
    p.then((session) => {
        if (cancelled) {
            session.close();
            return;
        }
        bindSteamStarGuestSession(session);
    }).catch((e: unknown) => {
        pending = null;
        setMenuBusy(false);
        if (cancelled || String(e).includes('cancelled')) showMenuView('main');
        else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
    });
}

/** Steam lobby join + handshake; false = full / dead host / reject (try next). */
async function tryAdmitSteamLobby(lobbyId: string): Promise<boolean> {
    try {
        const result = await joinSteamLobby(lobbyId);
        if (result.mode === '1v1') {
            // Await handshake so a stale lobby (no host answering) falls through
            // to the next candidate / host path instead of hanging on "Receiving…".
            try {
                await beginSteamNetGame(result.session, 'guest', applyHordeMode);
                return true;
            } catch {
                result.session.close();
                return false;
            }
        }
        const first = await Promise.race([
            result.session.once(),
            new Promise<NetMessage>((_, reject) =>
                setTimeout(() => reject(new Error('Host did not respond')), 12_000),
            ),
        ]);
        if (first.type === 'starRejected' || first.type === 'starRejoinRejected') {
            result.session.close();
            return false;
        }
        bindSteamStarGuestSession(result.session, first);
        return true;
    } catch {
        return false;
    }
}

// a Steam overlay/friends-list "Join Game" invite can be accepted from
// anywhere (menu idle, another screen) — not just while mm-invite/mm-play
// is open, mirroring the ?room= deep-link handling further down for the
// web build's invite-link equivalent
onSteamJoinRequested(({ lobbySteamId }) => {
    if (started || pending || steamStarHosting) return;
    void joinSteamLobby(lobbySteamId)
        .then((result) => {
            if (result.mode === '2v2') runSteamStarPending(Promise.resolve(result.session));
            else runSteamPending(Promise.resolve(result.session), 'guest');
        })
        .catch((e: unknown) => setStatus(`Could not join: ${e instanceof Error ? e.message : e}`));
});

/**
 * `?test2v2=4` (4 real players) or `?test2v2=2` (2 real players, AI fills
 * the other 2 — today's normal 2v2-vs-AI default, just explicit) lets the
 * Matchmaking button skip straight to the star (2v2) flow instead of the
 * simplified 1v1-only default, for testing without a lobby/mode picker.
 * Every test tab — host or client — can carry the exact same param and
 * just click Matchmaking: `try2v2Match` below already finds-and-joins an
 * open room if one exists, so only whichever tab runs first ends up
 * hosting (and is the only one for whom the wait-count matters).
 */
function test2v2Param(): number | null {
    const raw = new URLSearchParams(location.search).get('test2v2');
    const n = Number(raw);
    return Number.isFinite(n) && n >= 2 && n <= 4 ? n : null;
}

/**
 * Plain (non-Steam) 2v2: join an open room if one exists, else host and
 * wait. `waitForJoined` only matters for whichever tab ends up hosting —
 * a tab that finds and joins an existing room ignores it entirely, so
 * every test tab can carry the same value and just "take what comes"
 * (see `?test2v2=` above): whichever one runs first hosts and waits for
 * the rest, everyone else finds that room and joins it.
 */
function try2v2Match(horde: boolean, waitForJoined = 2): void {
    void runQuickMatchmaking('matchmaking', {
        modeFilter: '2v2',
        hostHorde: horde,
        hostWaitForJoined: waitForJoined,
        hostRoster: initialStarRoster,
        hostMode: '2v2',
        hostOfferAiStart: true,
    });
}

/** Extra list passes only after join failures (full/stale) — not when empty. */
const QUICK_MATCH_RETRY_ROUNDS = 2;

type MatchCandidate =
    | { key: string; kind: 'peer'; name: string; peerServer?: PeerServerConfig | null }
    | { key: string; kind: 'steam'; lobbyId: string };

type QuickMatchHostOpts = {
    /** When set, only join candidates of this mode (Web rooms / Steam lobby data). */
    modeFilter?: '1v1' | '2v2';
    hostHorde?: boolean;
    hostWaitForJoined?: number;
    hostRoster?: (hostName: string) => CanonicalSeatDef[];
    hostMode?: '1v1' | '2v2';
    hostOfferAiStart?: boolean;
};

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listMatchCandidates(
    transport: MultiplayerTransport,
    modeFilter?: '1v1' | '2v2',
): Promise<MatchCandidate[]> {
    if (transport === 'steam') {
        const rooms = await steamLobby.getLobbies();
        return rooms
            .filter((r) => {
                // Only Melodan lobbies we tagged (skips abandoned / other junk).
                if (r.data.game !== 'melodan') return false;
                if (r.data.version && r.data.version !== String(GAME_VERSION)) return false;
                if (modeFilter && r.data.mode && r.data.mode !== modeFilter) return false;
                if (!r.data.mode) return false;
                const limit = r.memberLimit ?? (r.data.mode === '2v2' ? 4 : 2);
                return r.memberCount < limit;
            })
            .map((r) => ({ key: r.id, kind: 'steam' as const, lobbyId: r.id }));
    }
    if (transport === 'lan') {
        // Short UDP window — empty → host immediately; room poll uses longer waits.
        const rooms = await lanRoomsExcludingSelf(400);
        return rooms.map((r) => ({
            key: `${r.host}:${r.port}:${r.path}:${r.name}`,
            kind: 'peer' as const,
            name: r.name,
            peerServer: {
                host: r.host,
                port: r.port,
                path: r.path,
                secure: false,
            },
        }));
    }
    const mine = getPlayerName().toLowerCase();
    const rooms = await fetchLobbyRooms();
    return rooms
        .filter((r) => {
            if (r.kind !== 'lobby') return false;
            if (r.name.toLowerCase() === mine) return false;
            if (modeFilter && r.mode !== modeFilter) return false;
            return true;
        })
        .map((r) => ({
            key: r.name,
            kind: 'peer' as const,
            name: r.name,
            peerServer: null,
        }));
}

async function tryJoinMatchCandidate(c: MatchCandidate): Promise<boolean> {
    if (c.kind === 'steam') return tryAdmitSteamLobby(c.lobbyId);
    return tryAdmitStarGuest(c.name, c.peerServer);
}

async function hostQuickMatch(
    transport: MultiplayerTransport,
    opts: QuickMatchHostOpts = {},
): Promise<void> {
    const horde = opts.hostHorde ?? true;
    const waitForJoined = opts.hostWaitForJoined ?? 2;
    const roster = opts.hostRoster ?? initial1v1Roster;
    const mode = opts.hostMode ?? '1v1';
    const offerAiStart = opts.hostOfferAiStart ?? false;

    if (transport === 'steam') {
        if (mode === '2v2') {
            await beginSteamStarHost({
                horde,
                waitForJoined,
                isPublic: true,
                offerAiStart,
                openInvite: false,
                buildRoster: roster,
            });
            return;
        }
        const hosted = hostSteamRoom(true);
        pending = hosted;
        runSteamPending(hosted.session, 'host', horde ? applyHordeMode : undefined);
        return;
    }
    const discovery = transport === 'lan' ? 'lan' : 'matchmaking';
    await beginStarHost(horde, waitForJoined, null, roster, mode, offerAiStart, discovery);
}

/**
 * Shared Matchmaking for Steam / Web / LAN:
 * list once → if empty, host immediately; if rooms exist, try join each;
 * on full/fail re-list a couple times; never one-shot "lobby full" dead end.
 */
async function runQuickMatchmaking(
    transport: MultiplayerTransport,
    opts: QuickMatchHostOpts = {},
): Promise<void> {
    let cancelled = false;
    pending?.cancel();
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    setMenuBusy(true);
    setStatus(transportLookingStatus(transport));
    const tried = new Set<string>();
    try {
        for (let round = 0; round <= QUICK_MATCH_RETRY_ROUNDS; round++) {
            if (cancelled) return;
            const candidates = (await listMatchCandidates(transport, opts.modeFilter)).filter(
                (c) => !tried.has(c.key),
            );
            // Nothing open → host now (Web/Steam/LAN). Don't burn empty re-scans.
            if (candidates.length === 0) break;

            let anyAttempt = false;
            for (const c of candidates) {
                if (cancelled) return;
                tried.add(c.key);
                anyAttempt = true;
                setStatus(
                    transport === 'lan'
                        ? `Found LAN room — connecting…`
                        : transport === 'steam'
                          ? 'Found Steam lobby — connecting…'
                          : 'Found room — connecting…',
                );
                const joined = await tryJoinMatchCandidate(c);
                if (cancelled) return;
                if (joined) return;
                setStatus(transportLookingStatus(transport));
            }
            // Only pause/re-list when joins failed (full/stale), not when empty.
            if (!anyAttempt || round >= QUICK_MATCH_RETRY_ROUNDS) break;
            await sleepMs(400);
        }
        if (cancelled) return;
        await hostQuickMatch(transport, opts);
    } catch (e: unknown) {
        if (cancelled || String(e).includes('cancelled')) {
            setMenuBusy(false);
            showMenuView('main');
            return;
        }
        setMenuBusy(false);
        setStatus(`Matchmaking failed: ${e instanceof Error ? e.message : e}`);
    }
}

/** Pick transport from Settings and start Matchmaking (simple 1v1 Horde path). */
async function startMatchmakingForTransport(): Promise<void> {
    const transport = await resolveMultiplayerTransport();
    if (!transport) {
        setStatus(transportUnavailableMessage());
        return;
    }
    void runQuickMatchmaking(transport);
}

/**
 * Joins a live match as a read-only spectator, by the host's discoverable
 * room name (same identifier a "Host Room"/2v2 star host already registers
 * under — see registerSpectateEndpoint in net.ts). Reached by clicking a
 * "👁 Watch <name>" row in the Custom Room list (populated from running,
 * spectatable matches alongside open joinable rooms — see refreshRoomList).
 */
function startSpectateGame(hostName: string): void {
    const name = hostName.trim();
    if (!name) return;
    setMenuBusy(true);
    setStatus(`Looking for "${name}"…`);
    void (async () => {
        try {
            const peerId = await lookupSpectateEndpoint(name);
            if (!peerId) {
                setMenuBusy(false);
                setStatus(`No live match found for "${name}".`);
                return;
            }
            setStatus('Connecting…');
            const result = await joinAsSpectator(peerId, getPlayerName());
            setMenuBusy(false);
            setStatus('');
            // result.roster is the match's actual seat roster now (see
            // matchCatchUp's doc comment) — every entry is inherently a
            // player, already in seat order, no role filter needed
            const names = {
                local: result.roster[0]?.name ?? 'Player',
                opponent: result.roster[1]?.name ?? 'Opponent',
            };
            const settings = result.settings;
            settings.seed = result.seed;
            startGame(settings, null, 'a', names, null, null, null, {
                session: result.session,
                watcherName: getPlayerName(),
                initial: {
                    actions: result.actions,
                    battleElapsed: result.battleElapsed,
                    phaseRemaining: result.phaseRemaining,
                },
            });
        } catch (e) {
            setMenuBusy(false);
            setStatus(`Could not watch: ${e instanceof Error ? e.message : e}`);
        }
    })();
}

function cancelMenuPending(): void {
    pending?.cancel();
    pending = null;
    cancelStarHost();
    cancelSteamStarHost();
    setMenuBusy(false);
    showMenuView('main');
}

function isMenuBlockingOverlayOpen(): boolean {
    // When a dedicated overlay is open (settings/name editor/resume),
    // let that overlay own Escape instead of closing underneath it.
    return (
        !!wrapper.querySelector('.mechili-settings, .mechili-name-edit, .mechili-resume, .mechili-fatal') ||
        resumeOverlay !== null
    );
}

function closeMenuSubPanelOnEscape(): boolean {
    // Session (connecting / lobby / waiting): Escape cancels and returns home.
    if (currentMenuView === 'session' || pending || cancelEl.style.display !== 'none') {
        cancelMenuPending();
        return true;
    }

    // Global chat is also a "sub-panel" inside the main menu.
    if (gchatEl.classList.contains('open')) {
        gchatEl.classList.remove('open');
        return true;
    }

    // Any non-main submenu: back out to the root menu.
    if (currentMenuView !== 'main') {
        pending = null;
        cancelStarHost();
        cancelSteamStarHost();
        setMenuBusy(false);
        showMenuView('main');
        return true;
    }

    return false;
}

window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!menuChromeVisible || started) return;
    // An open overlay owns Escape and closes itself. This must return, not fall
    // through: "nothing to close in the menu" is otherwise read as "we are at
    // the root menu" and quits the app out from under the dialog.
    if (isMenuBlockingOverlayOpen()) return;
    if (closeMenuSubPanelOnEscape()) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    // Root main menu: Escape quits the Electron app (browser tabs keep Escape no-op).
    if (isElectron()) {
        e.preventDefault();
        e.stopPropagation();
        void win.close();
    }
});

menu.addEventListener('click', (e) => {
    const refreshBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-rooms-refresh');
    if (refreshBtn && !started) {
        e.preventDefault();
        refreshBtn.disabled = true;
        if (roomPoll) {
            clearTimeout(roomPoll);
            roomPoll = null;
        }
        void refreshRoomList().finally(() => {
            refreshBtn.disabled = false;
        });
        return;
    }

    const roomBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-room');
    if (roomBtn?.dataset.room && !started && !pending) {
        if (!bootReady) {
            setStatus('Still loading — one moment…');
            return;
        }
        if (roomBtn.dataset.roomKind === 'spectate') startSpectateGame(roomBtn.dataset.room);
        // every room is star-hosted now (1v1 is just a 2-seat star room),
        // including 'resume' rows — always beginStarJoin regardless of
        // roomMode, which is a display label only.
        else if (roomBtn.dataset.lanHost && roomBtn.dataset.lanPort && roomBtn.dataset.lanPath) {
            beginStarJoin(roomBtn.dataset.room, {
                host: roomBtn.dataset.lanHost,
                port: Number(roomBtn.dataset.lanPort),
                path: roomBtn.dataset.lanPath,
                secure: false,
            });
        } else beginStarJoin(roomBtn.dataset.room, null);
        return;
    }

    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-btn');
    if (!button || started) return;

    if (button.classList.contains('m-cancel')) {
        cancelMenuPending();
        return;
    }

    const mode = button.dataset.mode;
    if (
        !bootReady &&
        (mode === 'single' ||
            mode === 'sp-1v1' ||
            mode === 'sp-2v2' ||
            mode === 'sp-horde' ||
            mode === 'matchmaking' ||
            mode === 'mms-2v2' ||
            mode === 'mm-play' ||
            mode === 'mm-invite' ||
            mode === 'host' ||
            mode === 'host2v2')
    ) {
        setStatus('Still loading — one moment…');
        return;
    }

    /** local-vs-AI modes share the relaxed-timer, same-fog-rules setup as Single Player */
    const startLocalMatch = (opts: { duo?: boolean; horde?: boolean } = {}): void => {
        const settings = settingsFromUrl();
        settings.buildTimeSeconds = 60 * 60;
        settings.specialistTimeSeconds = 60 * 60;
        settings.cardTimeSeconds = 60 * 60;
        if (opts.horde) applyHordeMode(settings);
        if (opts.duo) applyDuoMode(settings);
        startGame(settings);
    };

    switch (mode) {
        case 'single':
            // simplified to 1v1 Horde only for now (see sp-1v1/sp-2v2 below,
            // kept but unreachable from this button — not removed, so the
            // full picker is a one-line revert away)
            startLocalMatch({ horde: true });
            break;
        case 'sp-back':
            showMenuView('main');
            break;
        case 'sp-1v1':
            showMenuView('main');
            startLocalMatch();
            break;
        case 'sp-2v2':
            showMenuView('main');
            startLocalMatch({ duo: true });
            break;
        case 'sp-horde':
            showMenuView('main');
            startLocalMatch({ horde: true });
            break;
        case 'matchmaking': {
            const test2v2 = test2v2Param();
            if (test2v2 !== null) {
                try2v2Match(true, test2v2);
                break;
            }
            void startMatchmakingForTransport();
            break;
        }
        case 'mms-2v2':
            try2v2Match(false);
            break;
        case 'mms-back':
            pending?.cancel();
            pending = null;
            cancelStarHost();
            setMenuBusy(false);
            showMenuView('main');
            break;
        case 'mm-back':
            pending?.cancel();
            pending = null;
            cancelStarHost();
            cancelSteamStarHost();
            setMenuBusy(false);
            showMenuView('main');
            break;
        case 'mm-invite': {
            const team = mmModeEl.querySelector<HTMLInputElement>('input[name="mmteam"]:checked')!.value;
            const horde = mmHordeEl.checked;
            mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = true));
            mmInviteEl.disabled = true;
            void (async () => {
                const transport = await resolveMultiplayerTransport();
                if (transport === 'steam') {
                    mmInviteEl.textContent = 'Waiting for your friend…';
                    mmLinkEl.textContent = 'Invite a friend from the Steam overlay that just opened.';
                    mmLinkEl.style.display = '';
                    setStatus(transportLookingStatus('steam'));
                    if (team === '2v2') void beginSteamStarHost(horde);
                    else {
                        const hosted = hostSteamRoom(false, () => steamLobby.openInviteDialog());
                        pending = hosted;
                        runSteamPending(hosted.session, 'host', horde ? applyHordeMode : undefined);
                    }
                    return;
                }
                if (transport === 'lan') {
                    mmInviteEl.textContent = 'Waiting for a LAN player…';
                    mmLinkEl.textContent = 'Your room is advertised on the local network. Friends: Settings → Multiplayer → LAN, then Matchmaking.';
                    mmLinkEl.style.display = '';
                    setStatus(transportLookingStatus('lan'));
                    if (team === '2v2') void beginStarHost(horde, 2, null, initialStarRoster, '2v2', true, 'lan');
                    else void beginStarHost(horde, 2, null, initial1v1Roster, '1v1', false, 'lan');
                    return;
                }
                if (transport !== 'matchmaking') {
                    setStatus(transportUnavailableMessage());
                    mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = false));
                    mmInviteEl.disabled = false;
                    return;
                }
                mmInviteEl.textContent = 'Waiting for your friend…';
                const hostName = getPlayerName();
                const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(hostName)}`;
                mmLinkEl.textContent = `Send this to your friend: ${link}`;
                mmLinkEl.style.display = '';
                setStatus(transportLookingStatus('matchmaking'));
                if (team === '2v2') void beginStarHost(horde, 2, null, initialStarRoster, '2v2', true, 'matchmaking');
                else void beginStarHost(horde, 2, null, initial1v1Roster, '1v1', false, 'matchmaking');
            })();
            break;
        }
        case 'mm-play': {
            const team = mmModeEl.querySelector<HTMLInputElement>('input[name="mmteam"]:checked')!.value;
            const horde = mmHordeEl.checked;
            mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = true));
            mmInviteEl.disabled = true;
            void (async () => {
                const transport = await resolveMultiplayerTransport();
                if (transport === 'steam') {
                    setStatus(transportLookingStatus('steam'));
                    if (team === '2v2') {
                        void hostOrJoinSteamStar(initialStarRoster(getPlayerName())).then((result) => {
                            if (result.role === 'guest') {
                                runSteamStarPending(Promise.resolve(result.session));
                            } else {
                                starHordeFlag = horde;
                                steamStarHosting = { hub: result.hub, lobbyId: result.lobbyId };
                                wireSteamStarHub(result.hub);
                            }
                        });
                    } else {
                        void quickSteamMatch().then(({ session, role }) =>
                            runSteamPending(Promise.resolve(session), role, horde ? applyHordeMode : undefined),
                        );
                    }
                    return;
                }
                if (transport === 'lan') {
                    setStatus(transportLookingStatus('lan'));
                    try {
                        let rooms = await lanRoomsExcludingSelf(2000);
                        if (!rooms.length) rooms = await lanRoomsExcludingSelf(2000);
                        const open = rooms[0];
                        if (open) {
                            setStatus(`Found LAN room "${open.name}" — connecting…`);
                            beginStarJoin(open.name, {
                                host: open.host,
                                port: open.port,
                                path: open.path,
                                secure: false,
                            });
                            return;
                        }
                        if (team === '2v2') void beginStarHost(horde, 2, null, initialStarRoster, '2v2', true, 'lan');
                        else void beginStarHost(horde, 2, null, initial1v1Roster, '1v1', false, 'lan');
                    } catch (e) {
                        setStatus(`LAN failed: ${e instanceof Error ? e.message : e}`);
                        mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = false));
                        mmInviteEl.disabled = false;
                    }
                    return;
                }
                if (transport !== 'matchmaking') {
                    setStatus(transportUnavailableMessage());
                    mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = false));
                    mmInviteEl.disabled = false;
                    return;
                }
                setStatus(
                    team === '2v2'
                        ? `${transportLookingStatus('matchmaking')} (2v2)`
                        : transportLookingStatus('matchmaking'),
                );
                void fetchLobbyRooms().then((rooms) => {
                    const mine = getPlayerName().toLowerCase();
                    const open = rooms.find((r) => r.mode === team && r.name.toLowerCase() !== mine);
                    if (open) beginStarJoin(open.name, null);
                    else if (team === '2v2') void beginStarHost(horde, 2, null, initialStarRoster, '2v2', true, 'matchmaking');
                    else void beginStarHost(horde, 2, null, initial1v1Roster, '1v1', false, 'matchmaking');
                });
            })();
            break;
        }
        case 'custom':
            showMenuView('custom');
            break;
        case 'cg-back':
            showMenuView('main');
            break;
        case 'cg-host-1v1':
            hostCustomGame('1v1');
            break;
        case 'cg-host-1v1ai':
            hostCustomGame('1v1ai');
            break;
        case 'cg-host-2v2':
            hostCustomGame('2v2');
            break;
        case 'cg-host-2v2ai':
            hostCustomGame('2v2ai');
            break;
        case 'startstar':
            if (steamStarHosting) startSteamStarMatch();
            else startStarMatch();
            break;
    }
});

// full-screen boot splash (logo + bar + Feuerware) until assets are ready —
// only then does the main menu chrome appear (unless we resume a match)
await bootGameAssets((p) => setBootProgress(p.fraction, p.label));
// Compile cold VFX programs on the 3D canvas while the loader is still up.
// The warmed WebGLRenderer is handed to the first Game (programs are per-context).
await prewarmGpu(threeCanvas, (label) => setBootProgress(1, label));
bootReady = true;
loadingEl.remove();
feuerwareEl.remove();

// reload mid-match: multiplayer reconnects via peer, single-player from local save
setGameLayerVisible(false);
const watchParams = new URLSearchParams(location.search);
const watchId = watchParams.get('watch');
const watchSide = watchParams.get('side');
const verifyId = watchParams.get('verify');
const bulkVerify = watchParams.get('bulkverify');
const starMpMarker = loadStarResumeMarker();
const spSave = loadSinglePlayer();
if (bulkVerify) {
    // seeded by replays.html's Bulk Verify button just before navigating
    // here — outranks stale local state for the same reason ?verify=/
    // ?watch= do below
    const raw = sessionStorage.getItem('mechili-bulk-verify-queue');
    sessionStorage.removeItem('mechili-bulk-verify-queue');
    const queue: { id: string; side: 'a' | 'b' }[] = raw ? JSON.parse(raw) : [];
    void runBulkVerify(queue);
} else if (verifyId && (watchSide === 'a' || watchSide === 'b')) {
    // same "outranks stale local state" reasoning as ?watch= below
    void verifyReplayAndReturn(verifyId, watchSide);
} else if (watchId && (watchSide === 'a' || watchSide === 'b')) {
    // outranks any resume marker/single-player save — a replay link should
    // never be silently preempted by stale local state
    void startReplayWatch(watchId, watchSide);
} else if (starMpMarker) {
    // joinStarRoom always dials the room code fresh and the host's own
    // name-matched
    // implicit reclaim (StarHub.findDroppedSeatByName) does the rest, so
    // this is just an automatic version of clicking a "resume" row in the
    // room list (beginStarJoin/runStarPending already handle busy state,
    // status text, and every failure case the same way a manual click
    // would — no separate dedicated overlay needed here).
    setMenuChromeVisible(true);
    setStatus(`Reconnecting to "${starMpMarker.hostName}"…`);
    beginStarJoin(starMpMarker.hostName);
} else if (spSave) {
    if (spSave.version !== GAME_VERSION) {
        clearSinglePlayer();
        setMenuChromeVisible(true);
    } else resumeSinglePlayer(spSave);
} else {
    setMenuChromeVisible(true);
    // ?room=mangoo — join that host's room directly. Every room is
    // star-hosted now (1v1 is just a 2-seat star room), so this is
    // always beginStarJoin regardless of mode.
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) {
        beginStarJoin(roomParam);
    }
    // ?spectate=mangoo — deep link straight into watching that host's match.
    // Doesn't depend on the Rooms list showing it (spectate-register/-lookup
    // predate today's list change) — the fastest way to test/share watching
    // a specific match without waiting on a backend redeploy.
    const spectateParam = new URLSearchParams(location.search).get('spectate');
    if (spectateParam) startSpectateGame(spectateParam);
}

// Keep the main-menu gamepad cursor moving while the menu is visible.
app.ticker.add((ticker) => {
    if (!started && menuChromeVisible && menuGamepad) {
        menuGamepad.update(ticker.deltaMS / 1000);
    }
});
