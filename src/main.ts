import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { Game } from './game/game';
import { fetchMatchReplay, type MatchMode, type MatchResult, type MatchTelemetry } from './game/telemetry';
import { ReplayControls } from './ui/replayControls';
import { GamepadCursor } from './engine/gamepadCursor';
import { CameraRig } from './engine/cameraRig';
import {
    clearResumeMarker,
    clearSinglePlayer,
    fetchGlobalChat,
    fetchLobbyRooms,
    GAME_VERSION,
    handshake,
    hostLobby,
    hostStarRoom,
    isMelodanPlayHost,
    joinAsSpectator,
    joinLobby,
    joinStarRoom,
    loadResumeMarker,
    loadSinglePlayer,
    lookupSpectateEndpoint,
    NetSession,
    postGlobalChat,
    quickMatch,
    raceReconnectStrategies,
    resumeSession,
    saveResumeMarker,
    saveSinglePlayer,
    type NetMessage,
    type Pending,
    type ResumeMarker,
    type Session,
    type SinglePlayerSave,
    type SpectatorSession,
    type StarRole,
} from './game/net';
import { isElectron, lobby as steamLobby, steam, win } from 'steam-electron-build/native';
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
import { getPlayerName, setPlayerName, validatePlayerName } from './game/player';
import { getCachedProfile, isProfileLockedOut, probeName, claimName, syncOpenProfile } from './game/account';
import { bootGameAssets } from './game/bootAssets';
import { discardPrewarmedRenderer, prewarmGpu } from './game/gpuWarmup';
import { initInputCapabilities, noteGamepadActivity } from './game/inputCapabilities';
import { effectiveDpr, onPrefsChange, prefs } from './game/prefs';
import { openSettings } from './ui/settings';
import { openSuggest } from './suggest';
import { DEFAULT_HORDE, DEFAULT_SETTINGS, type GameSettings, type HordeFactor } from './game/settings';
import { duoSeats, localizeRoster, type CanonicalSeatDef } from './game/seats';
import { THEME, menuStyles } from './theme';

// the only mode right now (Single Player / Matchmaking both force this) —
// PvPvE: a neutral dwarf horde spawns from the forest ring outside the
// normal board and marches in, hostile to both players. The normal map's
// own dimensions apply (see the rim widen in map.ts/scenery.ts for horde
// mode specifically) — no more widened center belt. Horde is always on;
// `?hordeFactor=` is the one lever, including `off` (see hordeEnabled) —
// no separate opt-out param, to keep this down to a single URL knob.
// Accepts a preset (low/medium/high/ultra/off) or an explicit round list
// (`?hordeFactor=2,4,9`) without an in-menu picker yet.
function applyHordeMode(settings: GameSettings): void {
    settings.horde = structuredClone(DEFAULT_HORDE);
    const factorParam = new URLSearchParams(location.search).get('hordeFactor');
    if (!factorParam) return;
    if (
        factorParam === 'off' ||
        factorParam === 'low' ||
        factorParam === 'medium' ||
        factorParam === 'high' ||
        factorParam === 'ultra'
    ) {
        settings.horde.factor = factorParam;
    } else {
        const rounds = factorParam
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (rounds.length > 0) settings.horde.factor = rounds;
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

type CustomHordeFactor = 'off' | 'low' | 'medium' | 'high' | 'ultra';

/** `2v2` waits for all 4 real seats before auto-starting; `2v2ai` starts
 *  the moment one guest joins, AI-filling the rest (see beginStarHost's
 *  waitForJoined param) — same underlying mechanism, just a different
 *  threshold, so this isn't a separate wire-level mode. */
type CustomGameMode = '1v1' | '2v2' | '2v2ai';

interface CustomGameConfig {
    mode: CustomGameMode;
    buildSeconds: number;
    battleSeconds: number;
    specialistSeconds: number;
    cardSeconds: number;
    horde: CustomHordeFactor;
    roundCards: boolean;
}

const DEFAULT_CUSTOM_GAME: CustomGameConfig = {
    mode: '1v1',
    buildSeconds: DEFAULT_SETTINGS.buildTimeSeconds as number,
    battleSeconds: DEFAULT_SETTINGS.battleTimeSeconds as number,
    specialistSeconds: DEFAULT_SETTINGS.specialistTimeSeconds as number,
    cardSeconds: DEFAULT_SETTINGS.cardTimeSeconds as number,
    horde: 'off',
    roundCards: false,
};

const CUSTOM_GAME_KEY = 'mechili-custom-game';

/** localStorage only (never the URL — this is testing-tool state, not a
 *  shareable link) — matches getPlayerName's own storage pattern. */
function loadCustomGameConfig(): CustomGameConfig {
    try {
        const raw = localStorage.getItem(CUSTOM_GAME_KEY);
        if (!raw) return { ...DEFAULT_CUSTOM_GAME };
        return { ...DEFAULT_CUSTOM_GAME, ...(JSON.parse(raw) as Partial<CustomGameConfig>) };
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
    settings.buildTimeSeconds = cfg.buildSeconds;
    settings.battleTimeSeconds = cfg.battleSeconds;
    settings.specialistTimeSeconds = cfg.specialistSeconds;
    settings.cardTimeSeconds = cfg.cardSeconds;
    settings.roundCards = cfg.roundCards;
    settings.horde = structuredClone(DEFAULT_HORDE);
    settings.horde.factor = cfg.horde as HordeFactor;
}

// dev override: tweak match settings from the URL, e.g. ?hp=100&build=20&nocards
function settingsFromUrl(): GameSettings {
    const params = new URLSearchParams(location.search);
    const settings = structuredClone(DEFAULT_SETTINGS);
    // NOTE: no longer shortens real matches for testing — actual match HP is
    // additive per seat from a zero baseline (chooseCard), so this only
    // affects the pre-pick placeholder shown before any card is chosen
    const hp = Number(params.get('hp'));
    if (hp > 0) settings.startingHp = hp;
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

    // between-round cards: ?nocards | ?roundCards=off | ?roundCards=3,6,9
    if (params.has('nocards') || params.get('roundCards') === 'off') {
        settings.roundCards = false;
    } else {
        const raw = params.get('roundCards');
        if (raw) {
            const rounds = raw
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
            if (rounds.length > 0) settings.roundCards = rounds;
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

const wrapper = document.createElement('div');
const menuBgUrl = new URL('../assets/ui/menu-bg.webp', import.meta.url).href;
wrapper.style.cssText =
    `position:fixed;inset:0;overflow:hidden;` +
    `background:#b8d4c8 url(${menuBgUrl}) center/cover no-repeat;`;

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
const style = document.createElement('style');
style.textContent = menuStyles();
document.head.appendChild(style);

const versionEl = document.createElement(isMelodanPlayHost() ? 'a' : 'div');
versionEl.className = 'mechili-version';
versionEl.style.zIndex = '30';
versionEl.style.display = 'none';
versionEl.textContent = `v${__APP_VERSION__} · ${GAME_VERSION}`;
if (versionEl instanceof HTMLAnchorElement) {
    versionEl.href = 'https://melodan.com/';
    versionEl.target = '_blank';
    versionEl.rel = 'noopener noreferrer';
    versionEl.title = 'melodan.com';
    versionEl.classList.add('link');
}
wrapper.appendChild(versionEl);

const feuerwareLogoUrl = new URL('../assets/marketing/feuerware.webp', import.meta.url).href;
const feuerwareEl = document.createElement('img');
feuerwareEl.className = 'mechili-feuerware';
feuerwareEl.src = feuerwareLogoUrl;
feuerwareEl.alt = 'Feuerware';
feuerwareEl.width = 82;
feuerwareEl.height = 16;
wrapper.appendChild(feuerwareEl);

const loadingEl = document.createElement('div');
loadingEl.className = 'mechili-loading';
loadingEl.innerHTML =
    `<div class="load-bar"><div class="hp-track">` +
    `<div class="hp-fill" style="width:0%"></div>` +
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
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    loadFill.style.width = `${pct}%`;
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
/** last menu-dive origin (0–1), shared with the 3D fly-in so both aim the same way */
let pendingMenuZoom: { originX: number; originY: number } | null = null;
let introGen = 0;

function clearIntroCover(): void {
    introGen++;
    introCoverEl?.remove();
    introCoverEl = null;
}

function applyRandomMenuZoomOrigin(bg: HTMLElement): { originX: number; originY: number } {
    // Mostly top + near-horizontal-center: matches the 3D intro (wide overlook
    // diving into the board). Tiny X/Y jitter so starts aren't identical.
    const originX = (44 + Math.random() * 12) / 100; // 0.44–0.56
    const originY = (6 + Math.random() * 14) / 100; // 0.06–0.20 (top of the plate)
    bg.style.setProperty('--zoom-ox', `${(originX * 100).toFixed(1)}%`);
    bg.style.setProperty('--zoom-oy', `${(originY * 100).toFixed(1)}%`);
    pendingMenuZoom = { originX, originY };
    return pendingMenuZoom;
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
const subtitle = new Text({
    text: 'FANTASY AUTO·BATTLER',
    style: {
        fill: THEME.subtitle,
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: 6,
        dropShadow: { color: 0x000000, alpha: 0.6, blur: 6, distance: 2, angle: Math.PI / 2 },
    },
});
subtitle.anchor.set(0.5);
title.addChild(logo);
app.stage.addChild(title);

const MENU_TOP_CHROME = 52;

function estimateMenuTop(): number {
    const h = app.screen.height;
    if (menu.style.display === 'none' || menu.offsetHeight === 0) {
        const estHalf = Math.min(190, h * 0.26);
        return h * 0.5 - estHalf;
    }
    return menu.getBoundingClientRect().top;
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
    <div class="m-main">
        <button class="m-btn m-primary" data-mode="single"><span class="m-ico">▶</span><span class="m-label">Single Player</span></button>
        <button class="m-btn" data-mode="matchmaking"><span class="m-ico">⚔</span><span class="m-label">Matchmaking</span></button>
        <button class="m-btn" data-mode="custom"><span class="m-ico">◈</span><span class="m-label">Custom Game</span></button>
        <div class="m-room-list empty">No open games</div>
    </div>
    <div class="m-spmode" style="display:none">
        <div class="m-spmode-title">Single Player</div>
        <div class="m-toggle-row">
            <button class="m-btn m-toggle-card" data-mode="sp-1v1"><span class="m-ico">🧍</span><span class="m-label">1v1</span></button>
            <button class="m-btn m-toggle-card" data-mode="sp-2v2"><span class="m-ico">🧍🧍</span><span class="m-label">2v2</span></button>
            <button class="m-btn m-toggle-card" data-mode="sp-horde"><span class="m-ico">🐗</span><span class="m-label">Horde</span></button>
        </div>
        <button class="m-btn m-small" data-mode="sp-back">Back</button>
    </div>
    <div class="m-matchmaking" style="display:none">
        <div class="m-spmode-title">Matchmaking</div>
        <!-- mode/Horde choice hidden for now (focus: 1v1 Horde only) — not
             removed, just forced+hidden, so it's a one-line revert later -->
        <div class="m-toggle-row" style="display:none">
            <label class="m-toggle-card">
                <input type="radio" name="mmteam" value="1v1" checked>
                <span class="m-ico">🧍</span><span class="m-label">1v1</span>
            </label>
            <label class="m-toggle-card">
                <input type="radio" name="mmteam" value="2v2">
                <span class="m-ico">🧍🧍</span><span class="m-label">2v2</span>
            </label>
        </div>
        <label class="m-toggle-pill" style="display:none">
            <input type="checkbox" class="mm-horde" checked>
            <span class="m-ico">🐗</span><span class="m-label">Horde Mode</span>
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
    <div class="m-mm-simple" style="display:none">
        <div class="m-spmode-title">Matchmaking</div>
        <div class="m-toggle-row">
            <button class="m-btn m-toggle-card" data-mode="mms-1v1"><span class="m-ico">🧍</span><span class="m-label">1v1</span></button>
            <button class="m-btn m-toggle-card" data-mode="mms-2v2"><span class="m-ico">🧍🧍</span><span class="m-label">2v2</span></button>
            <button class="m-btn m-toggle-card" data-mode="mms-horde"><span class="m-ico">🐗</span><span class="m-label">Horde</span></button>
        </div>
        <button class="m-btn m-small" data-mode="mms-back">Back</button>
    </div>
    <div class="m-custom" style="display:none">
        <div class="m-spmode-title">Custom Game</div>
        <div class="m-toggle-row">
            <label class="m-toggle-card">
                <input type="radio" name="cgmode" value="1v1">
                <span class="m-ico">🧍</span><span class="m-label">1v1</span>
            </label>
            <label class="m-toggle-card">
                <input type="radio" name="cgmode" value="2v2">
                <span class="m-ico">🧍🧍</span><span class="m-label">2v2</span>
            </label>
            <label class="m-toggle-card">
                <input type="radio" name="cgmode" value="2v2ai">
                <span class="m-ico">🤖</span><span class="m-label">2vAI</span>
            </label>
        </div>
        <div class="m-field-grid">
            <label class="m-field">Deployment (s)<input type="number" class="cg-build" min="5" max="600" step="5"></label>
            <label class="m-field">Battle (s)<input type="number" class="cg-battle" min="5" max="600" step="5"></label>
            <label class="m-field">Specialist (s)<input type="number" class="cg-specialist" min="3" max="120" step="1"></label>
            <label class="m-field">Round card (s)<input type="number" class="cg-card" min="3" max="120" step="1"></label>
        </div>
        <label class="m-field">Horde
            <select class="cg-horde">
                <option value="off">Off</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
            </select>
        </label>
        <label class="m-spmode-horde"><input type="checkbox" class="cg-roundcards"><span class="m-label">Between-round cards</span></label>
        <div class="m-room-row">
            <button class="m-btn m-small" data-mode="cg-reset">Reset Defaults</button>
            <button class="m-btn m-primary m-small" data-mode="cg-host">Host Game</button>
        </div>
        <button class="m-btn m-small" data-mode="cg-back">Back</button>
    </div>
    <div class="m-status" style="display:none"></div>
    <button class="m-btn m-small" data-mode="startstar" style="display:none">Start 2v2 Match</button>
    <button class="m-btn m-small m-cancel" style="display:none">Cancel</button>
`;
wrapper.appendChild(menu);
layoutTitle();
app.renderer.on('resize', layoutTitle);
new ResizeObserver(() => layoutTitle()).observe(menu);

function scheduleLayoutTitle(): void {
    requestAnimationFrame(() => layoutTitle());
}

const usernameEl = document.createElement('button');
usernameEl.className = 'mechili-username';
usernameEl.type = 'button';
usernameEl.style.zIndex = '30';
usernameEl.style.display = 'none';
wrapper.appendChild(usernameEl);

// big gear in the top-right corner of the main menu
const settingsCornerEl = document.createElement('button');
settingsCornerEl.className = 'mechili-settings-btn';
settingsCornerEl.type = 'button';
settingsCornerEl.textContent = '⚙';
settingsCornerEl.title = 'Settings';
settingsCornerEl.style.display = 'none';
settingsCornerEl.addEventListener('click', () => openSettings(wrapper));
wrapper.appendChild(settingsCornerEl);

// Electron only — a browser tab has its own close affordance, but a
// borderless/fullscreen Electron window doesn't; stacked just above the
// username pill. Visibility is gated on isElectron() inside
// setMenuChromeVisible, not just here, since it must also hide during play.
const exitDesktopEl = document.createElement('button');
exitDesktopEl.className = 'mechili-exit-btn';
exitDesktopEl.type = 'button';
exitDesktopEl.textContent = 'Exit to Desktop';
exitDesktopEl.title = 'Quit the game';
exitDesktopEl.style.display = 'none';
exitDesktopEl.addEventListener('click', () => void win.close());
wrapper.appendChild(exitDesktopEl);

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
/** false while the boot splash owns the screen (logo + bar + Feuerware only) */
let menuChromeVisible = false;

let menuGamepad: GamepadCursor | null = null;
let menuGamepadRig: CameraRig | null = null;

function setMenuChromeVisible(visible: boolean): void {
    menuChromeVisible = visible;
    const display = visible ? '' : 'none';
    menu.style.display = display;
    usernameEl.style.display = display;
    versionEl.style.display = display;
    settingsCornerEl.style.display = display;
    suggestCornerEl.style.display = display;
    exitDesktopEl.style.display = visible && isElectron() ? '' : 'none';
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
startGlobalChatPoll();

const roomListEl = menu.querySelector<HTMLDivElement>('.m-room-list')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
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
const cgBuildEl = menu.querySelector<HTMLInputElement>('.cg-build')!;
const cgBattleEl = menu.querySelector<HTMLInputElement>('.cg-battle')!;
const cgSpecialistEl = menu.querySelector<HTMLInputElement>('.cg-specialist')!;
const cgCardEl = menu.querySelector<HTMLInputElement>('.cg-card')!;
const cgHordeEl = menu.querySelector<HTMLSelectElement>('.cg-horde')!;
const cgRoundCardsEl = menu.querySelector<HTMLInputElement>('.cg-roundcards')!;

function populateCustomGameForm(cfg: CustomGameConfig): void {
    const radio = customEl.querySelector<HTMLInputElement>(`input[name="cgmode"][value="${cfg.mode}"]`);
    if (radio) radio.checked = true;
    cgBuildEl.value = String(cfg.buildSeconds);
    cgBattleEl.value = String(cfg.battleSeconds);
    cgSpecialistEl.value = String(cfg.specialistSeconds);
    cgCardEl.value = String(cfg.cardSeconds);
    cgHordeEl.value = cfg.horde;
    cgRoundCardsEl.checked = cfg.roundCards;
}

function readCustomGameForm(): CustomGameConfig {
    const modeInput = customEl.querySelector<HTMLInputElement>('input[name="cgmode"]:checked');
    return {
        mode: (modeInput?.value as CustomGameMode | undefined) ?? '1v1',
        buildSeconds: Number(cgBuildEl.value) || DEFAULT_CUSTOM_GAME.buildSeconds,
        battleSeconds: Number(cgBattleEl.value) || DEFAULT_CUSTOM_GAME.battleSeconds,
        specialistSeconds: Number(cgSpecialistEl.value) || DEFAULT_CUSTOM_GAME.specialistSeconds,
        cardSeconds: Number(cgCardEl.value) || DEFAULT_CUSTOM_GAME.cardSeconds,
        horde: (cgHordeEl.value as CustomHordeFactor) || 'off',
        roundCards: cgRoundCardsEl.checked,
    };
}

/** undoes 'custom' case's wide-layout/no-logo treatment — shared by both
 *  Back (return to the normal-width main menu) and actually hosting
 *  (the shared waiting-for-connection status screen is normal-width too) */
function closeCustomGameScreen(): void {
    customEl.style.display = 'none';
    menu.classList.remove('m-wide');
    title.visible = true;
    scheduleLayoutTitle();
}

/** host a game with the Custom Game screen's current settings — 1v1 reuses
 *  the plain lobby host flow (settings applied via runPending's applyMode
 *  hook, same shape as the horde-only quickMatch case), 2v2/2v2ai reuse
 *  beginStarHost with the mode-appropriate join threshold (see its own
 *  doc comment: 2v2ai isn't a different wire mode, just waitFor=2). */
function hostCustomGame(): void {
    const cfg = readCustomGameForm();
    saveCustomGameConfig(cfg);
    closeCustomGameScreen();
    mainButtonsEl.style.display = 'none';
    if (cfg.mode === '1v1') {
        runPending(hostLobby(setStatus), (settings) => applyCustomGameConfig(settings, cfg));
        return;
    }
    void beginStarHost(false, cfg.mode === '2v2' ? 4 : 2, cfg);
}

let started = false;
let pending: Pending | null = null;
/** true after 3D assets finish loading — match starts wait for this */
let bootReady = false;
let roomPoll: ReturnType<typeof setInterval> | null = null;
let resumeOverlay: HTMLDivElement | null = null;
let resumeAbort: AbortController | null = null;
let activeGame: Game | null = null;
let stopSinglePlayerPersist: (() => void) | null = null;

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

function showResumeOverlay(message: string, sub: string, onCancel: () => void, overIntro = false): void {
    hideResumeOverlay();
    const overlay = document.createElement('div');
    overlay.className = overIntro ? 'mechili-resume mechili-resume-over-intro' : 'mechili-resume';
    overlay.innerHTML =
        `<div class="resume-box">` +
        `<div class="resume-msg">${message}</div>` +
        (sub ? `<div class="resume-sub">${sub}</div>` : '') +
        `<button type="button" class="resume-cancel">Cancel</button>` +
        `</div>`;
    overlay.querySelector('.resume-cancel')!.addEventListener('click', onCancel);
    wrapper.appendChild(overlay);
    resumeOverlay = overlay;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
        );
    });
}

function refreshUsernameLabel(): void {
    const name = getPlayerName();
    const profile = getCachedProfile();
    if (isProfileLockedOut()) {
        usernameEl.textContent = `${name} · 🔒`;
        return;
    }
    usernameEl.textContent = profile ? `${name} · ${profile.mmr}` : name;
}

async function refreshOpenProfile(): Promise<void> {
    await syncOpenProfile(getPlayerName());
    refreshUsernameLabel();
}

function showNameEditor(): void {
    if (started || pending) return;
    const overlay = document.createElement('div');
    overlay.className = 'mechili-name-edit';
    overlay.innerHTML =
        `<div class="box">` +
        `<div class="title">Username</div>` +
        `<input class="name-input" maxlength="16" spellcheck="false" value="${getPlayerName()}" />` +
        `<label class="field">Password` +
        `<input class="pw-input" type="password" maxlength="64" autocomplete="current-password" /></label>` +
        `<div class="hint">Password is optional if not yet set, no recovery</div>` +
        `<div class="error" hidden></div>` +
        `<div class="actions">` +
        `<button type="button" data-act="cancel">Cancel</button>` +
        `<button type="button" class="primary" data-act="save">Save</button>` +
        `</div></div>`;

    const nameInput = overlay.querySelector<HTMLInputElement>('.name-input')!;
    const pwInput = overlay.querySelector<HTMLInputElement>('.pw-input')!;
    const errorEl = overlay.querySelector<HTMLDivElement>('.error')!;
    const actions = overlay.querySelector<HTMLDivElement>('.actions')!;
    nameInput.select();

    const setError = (msg: string) => {
        errorEl.hidden = !msg;
        errorEl.textContent = msg;
    };

    const close = () => overlay.remove();

    const setBusy = (busy: boolean) => {
        actions.querySelectorAll('button').forEach((b) => {
            b.disabled = busy;
        });
        nameInput.disabled = busy;
        pwInput.disabled = busy;
    };

    const save = async () => {
        const next = validatePlayerName(nameInput.value);
        if (!next) {
            nameInput.style.borderColor = '#e83828';
            setError('Name must be 2–16 letters, numbers, _ or -.');
            return;
        }
        nameInput.style.borderColor = '';
        setError('');
        setBusy(true);

        const pw = pwInput.value;
        const probe = await probeName(next);

        if (!probe) {
            // offline — switch locally
            setPlayerName(next);
            refreshUsernameLabel();
            void refreshOpenProfile();
            close();
            return;
        }

        if (probe.exists && probe.hasPassword) {
            if (pw.length < 4) {
                setBusy(false);
                setError('This name is locked — enter the password.');
                pwInput.focus();
                return;
            }
            const result = await claimName({ name: next, password: pw });
            setBusy(false);
            if (result.ok) {
                setPlayerName(next);
                refreshUsernameLabel();
                close();
                return;
            }
            if (result.wrongPassword) {
                setError('Wrong password.');
                return;
            }
            setError(result.hint ?? result.error ?? 'Could not unlock name.');
            return;
        }

        // new or unprotected — optional setPassword
        if (pw !== '' && pw.length < 4) {
            setBusy(false);
            setError('Password must be at least 4 characters.');
            return;
        }
        const result = await claimName({
            name: next,
            ...(pw ? { setPassword: pw } : {}),
        });
        setBusy(false);
        if (result.ok) {
            setPlayerName(next);
            refreshUsernameLabel();
            close();
            return;
        }
        setError(result.hint ?? result.error ?? 'Could not claim name.');
    };

    overlay.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
        if (act === 'cancel' || e.target === overlay) {
            close();
            return;
        }
        if (act === 'save') void save();
    });

    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'Enter') void save();
    });

    // locked-out: focus password
    if (isProfileLockedOut()) pwInput.focus();
    else nameInput.focus();

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
}
refreshUsernameLabel();
void refreshOpenProfile();
// under Steam the name is seeded from your Steam identity (above) — the
// web version's login/rename/password editor doesn't apply yet, so the
// corner button is inert for now rather than opening it (revisit once
// there's an actual Steam-side account/identity story)
usernameEl.addEventListener('click', () => {
    if (!steam.isAvailable()) showNameEditor();
});

function setStatus(text: string): void {
    statusEl.style.display = text ? '' : 'none';
    statusEl.textContent = text;
    cancelEl.style.display = text ? '' : 'none';
}

function setMenuBusy(busy: boolean): void {
    menu.querySelectorAll<HTMLButtonElement>('.m-btn:not(.m-cancel)').forEach((b) => {
        b.disabled = busy;
    });
    roomListEl.querySelectorAll<HTMLButtonElement>('.m-room').forEach((b) => {
        b.disabled = busy;
    });
}

async function refreshRoomList(): Promise<void> {
    try {
        const rooms = await fetchLobbyRooms();
        const mine = getPlayerName();
        const others = rooms.filter((r) => r.name.toLowerCase() !== mine.toLowerCase());
        if (others.length === 0) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.innerHTML = 'No open games';
            return;
        }
        roomListEl.className = 'm-room-list';
        // room names come from the server — build via DOM, never innerHTML
        roomListEl.replaceChildren(
            ...others.map((r) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = r.kind === 'spectate' ? 'm-room m-room-spectate' : 'm-room';
                button.dataset.room = r.name;
                button.dataset.roomMode = r.mode;
                button.dataset.roomKind = r.kind;
                const modeTag = r.mode === '2v2' ? ' (2v2)' : '';
                button.textContent =
                    r.kind === 'spectate' ? `Watch ${r.name}${modeTag}` : `${r.name}${modeTag}`;
                return button;
            }),
        );
    } catch {
        roomListEl.className = 'm-room-list empty';
        roomListEl.innerHTML = 'Could not load rooms';
    }
    scheduleLayoutTitle();
}

function startRoomPoll(): void {
    stopRoomPoll();
    void refreshRoomList();
    roomPoll = setInterval(() => void refreshRoomList(), 5000);
}

function stopRoomPoll(): void {
    if (roomPoll) clearInterval(roomPoll);
    roomPoll = null;
}

function clearMatchResumeData(): void {
    clearResumeMarker();
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
    replayControlsPanel?.remove();
    replayControlsPanel = null;
    currentReplayRecord = null;
    replaceThreeCanvas();
    started = false;
    setGameLayerVisible(false);
    title.visible = true;
    // Fade the Pixi menu logo back in after the outro cover is removed.
    // This avoids an abrupt "bam" when the HTML outro cover disappears.
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
    // showing when the match started (Matchmaking/Single Player/Rooms all
    // hide mainButtonsEl and show their own panel, but nothing was ever
    // resetting that back on return — the menu container itself became
    // visible again via setMenuChromeVisible below, but with every child
    // still hidden from mid-flow, rendering as an empty, collapsed frame;
    // a spectator reaches the game through a different button entirely
    // and never touches these, which is why only real players hit this).
    spModeEl.style.display = 'none';
    mmModeEl.style.display = 'none';
    mmSimpleEl.style.display = 'none';
    closeCustomGameScreen();
    mainButtonsEl.style.display = '';
    pending?.cancel();
    pending = null;
    cancelStarHost();
    wrapper.appendChild(menu);
    wrapper.appendChild(usernameEl);
    wrapper.appendChild(versionEl);
    wrapper.appendChild(settingsCornerEl);
    wrapper.appendChild(suggestCornerEl);
    wrapper.appendChild(exitDesktopEl);
    wrapper.appendChild(gchatEl);
    startGlobalChatPoll();
    refreshUsernameLabel();
    void refreshOpenProfile();
    setMenuBusy(false);
    setStatus('');
    setMenuChromeVisible(true);
}

function wireGameMenuReturn(game: Game): void {
    game.onMatchOutroProgress = (t) => {
        if (!introCoverEl) showOutroCover();
        if (introCoverEl) introCoverEl.style.opacity = String(t);
    };
    game.onReturnToMenu = finishReturnToMenu;
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
    hideResumeOverlay();
    resumeAbort?.abort();
    resumeAbort = null;
    // Cinematic handoff for any live match entry (fresh, resume, lobby join).
    // Skip for replay/spectate — those jump straight into playback/viewing.
    const useIntro = !replay && !spectate;

    // Strip menu chrome immediately. For the intro path we MUST yield a paint
    // with logo-only before `new Game()` — otherwise the main thread freezes
    // on the last menu frame and the cinematic never covers the hitch.
    menu.remove();
    usernameEl.remove();
    versionEl.remove();
    settingsCornerEl.remove();
    suggestCornerEl.remove();
    exitDesktopEl.remove();
    gchatEl.remove();

    if (net) {
        clearSinglePlayer();
        // resume/redial is PeerJS-specific (peer ids) — a Steam session has
        // no equivalent yet (v1 scope, see net-steam.ts), so it just skips
        // the marker rather than saving one it could never actually resume
        if (net instanceof NetSession) {
            saveResumeMarker({
                side,
                names,
                remotePeerId: net.remoteId,
                ownPeerId: net.ownId,
            });
        }
    } else if (!replay && !spectate) {
        // watching a replay/spectating a live match touches neither marker —
        // it isn't a new match of ours, and clearing either here would wipe
        // out the player's real, unrelated saved game just because they
        // clicked Watch
        clearResumeMarker();
        // star matches have no save/resume story yet (v1 scope) — never
        // persist or resume one via the single-player slot
        if (!resume?.local && !star) clearSinglePlayer();
    }

    const bootGame = (): Game => {
        const game = new Game(
            app,
            threeCanvas,
            wrapper,
            settings,
            net,
            side,
            names,
            resume,
            star,
            replay,
            spectate,
            useIntro ? (pendingMenuZoom ?? true) : false,
        );
        activeGame = game;
        wireGameMenuReturn(game);
        if (net instanceof NetSession) wireReconnect(game, net, side, names);
        else if (!net && !star && !replay && !spectate) stopSinglePlayerPersist = wireSinglePlayerPersist(game);
        return game;
    };

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
 */
function wireReconnect(
    game: Game,
    initial: NetSession,
    side: 'a' | 'b',
    names: { local: string; opponent: string },
): void {
    let session = initial;
    game.onConnectionLost = () => {
        const ac = new AbortController();
        game.onReconnectTimeout = () => ac.abort();
        game.beginReconnectGrace(RECONNECT_GRACE_SECONDS);
        void (async () => {
            try {
                // race both strategies instead of guessing who should dial
                // vs listen: our own Peer object is still alive either way
                // (we never reloaded), so waiting on it costs nothing, and
                // redialing the peer's last-known id costs nothing either —
                // whichever one actually connects first wins. This also
                // means it doesn't matter whether the OTHER side is doing a
                // live reconnect or a full reload (attemptResume races the
                // same two strategies on its end).
                const next = await raceReconnectStrategies(
                    (s) => session.awaitReconnect(s),
                    (s) => session.redial(s),
                    ac.signal,
                );
                if (activeGame !== game) return;
                const first = await next.once();
                if (activeGame !== game) return;
                if (first.type === 'resume') {
                    next.send({ type: 'state', version: GAME_VERSION, ...game.exportResume() });
                }
                session = next;
                game.resumeWith(next);
                // the peer's id may have just changed (it reloaded and got a
                // fresh PeerJS id) — refresh our own marker so that IF we
                // reload next, we redial its CURRENT id, not the one from
                // match start (that staleness is what broke host's reload
                // after guest's earlier one: guest's id had already moved on)
                saveResumeMarker({
                    side,
                    names,
                    remotePeerId: next.remoteId,
                    ownPeerId: next.ownId,
                });
            } catch (e) {
                if (activeGame !== game) return;
                // grace window already elapsed — forfeitWin() has the result,
                // nothing more to show here
                if (e instanceof DOMException && e.name === 'AbortError') return;
                clearResumeMarker();
                game.suspend('The opponent did not come back.');
            }
        })();
    };
}

/** After a reload mid-match: rejoin the room and rebuild from the peer's log. */
async function attemptResume(marker: ResumeMarker): Promise<void> {
    const ac = new AbortController();
    resumeAbort = ac;
    setMenuBusy(true);
    setMenuChromeVisible(false);
    primeIntroCover();
    showResumeOverlay(
        'Reconnecting…',
        'Waiting for your opponent and restoring the match.',
        () => {
            ac.abort();
            clearResumeMarker();
            hideResumeOverlay();
            clearIntroCover();
            setMenuChromeVisible(true);
            setMenuBusy(false);
        },
        true,
    );
    let session: NetSession | null = null;
    try {
        session = await resumeSession(marker, ac.signal);
        session.send({ type: 'resume' });
        const msg = await Promise.race([
            session.once(),
            abortableDelay(30_000, ac.signal).then(() => {
                throw new Error('No answer from the opponent');
            }),
        ]);
        if (msg.type !== 'state' || msg.version !== GAME_VERSION) {
            throw new Error('Resume rejected (version mismatch?)');
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
        hideResumeOverlay();
        setMenuBusy(false);
        startGame(settings, session, marker.side, marker.names, {
            actions: msg.actions,
            battleElapsed: msg.battleElapsed,
            phaseRemaining: msg.phaseRemaining,
        });
    } catch (e) {
        session?.close();
        hideResumeOverlay();
        clearIntroCover();
        setMenuChromeVisible(true);
        if (e instanceof DOMException && e.name === 'AbortError') {
            setMenuBusy(false);
            return;
        }
        clearResumeMarker();
        setMenuBusy(false);
        setStatus(`Could not rejoin: ${e instanceof Error ? e.message : e}`);
    } finally {
        resumeAbort = null;
    }
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

async function beginNetGame(
    session: NetSession,
    applyMode?: (settings: GameSettings) => void,
): Promise<void> {
    await handshake(session);
    const localName = session.localName;

    if (session.role === 'host') {
        const settings = settingsFromUrl();
        applyMode?.(settings);
        // networked matches are classic 1v1 — local-mode rosters never travel
        delete settings.seats;
        settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
        session.send({
            type: 'setup',
            version: GAME_VERSION,
            seed: settings.seed,
            settings,
            hostName: localName,
            guestName: session.remoteName,
        });
        startGame(settings, session, 'a', { local: localName, opponent: session.remoteName });
    } else {
        setStatus('Receiving match setup…');
        const msg = await session.once();
        if (msg.type !== 'setup' || msg.version !== GAME_VERSION) {
            setStatus('Version mismatch — both players need the same game version.');
            session.close();
            return;
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
        startGame(settings, session, 'b', { local: localName, opponent: msg.hostName });
    }
}

function runPending(p: Pending, applyMode?: (settings: GameSettings) => void): void {
    pending?.cancel();
    pending = p;
    setMenuBusy(true);
    p.session
        .then((session) => {
            pending = null;
            setMenuBusy(false);
            void beginNetGame(session, applyMode);
        })
        .catch((e: unknown) => {
            pending = null;
            setMenuBusy(false);
            if (String(e).includes('cancelled')) setStatus('');
            else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
        });
}

// ---- Steam 1v1 (parallel to beginNetGame/runPending above; PeerJS's
// NetSession has no equivalent on Steam, so this is its own small
// orchestration rather than a shared function — see net-steam.ts) ----------

const STEAM_HANDSHAKE_TIMEOUT_MS = 20_000;

async function beginSteamNetGame(
    session: SteamSession,
    role: 'host' | 'guest',
    applyMode?: (settings: GameSettings) => void,
): Promise<void> {
    const localName = getPlayerName();
    if (role === 'guest') {
        session.send({ type: 'hello', name: localName });
        setStatus('Receiving match setup…');
        const msg = await session.once();
        if (msg.type !== 'setup' || msg.version !== GAME_VERSION) {
            setStatus('Version mismatch — both players need the same game version.');
            session.close();
            return;
        }
        const settings = msg.settings;
        settings.seed = msg.seed;
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
    const settings = settingsFromUrl();
    applyMode?.(settings);
    delete settings.seats;
    settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
    session.send({ type: 'setup', version: GAME_VERSION, seed: settings.seed, settings, hostName: localName, guestName });
    startGame(settings, session, 'a', { local: localName, opponent: guestName });
}

function runSteamPending(
    p: Promise<SteamSession>,
    role: 'host' | 'guest',
    applyMode?: (settings: GameSettings) => void,
): void {
    setMenuBusy(true);
    p.then((session) => {
        setMenuBusy(false);
        void beginSteamNetGame(session, role, applyMode);
    }).catch((e: unknown) => {
        setMenuBusy(false);
        setStatus(`Could not connect: ${e instanceof Error ? e.message : e}`);
    });
}

// ---- 2v2 online (star topology) ----------------------------------------

/** host is always seat 0, side 'a'; the other 3 slots start open for joiners */
function initialStarRoster(hostName: string): CanonicalSeatDef[] {
    return [
        { side: 'a', controller: 'human', name: hostName },
        { side: 'a', controller: 'human', name: 'Waiting…' },
        { side: 'b', controller: 'human', name: 'Waiting…' },
        { side: 'b', controller: 'human', name: 'Waiting…' },
    ];
}
/** fallback names for seats still empty when the host clicks Start */
const STAR_AI_NAMES: Record<number, string> = { 1: 'Ally', 2: 'Foe West', 3: 'Foe East' };

const startStarBtn = menu.querySelector<HTMLButtonElement>('[data-mode="startstar"]')!;
let starHosting: Awaited<ReturnType<typeof hostStarRoom>> | null = null;

function cancelStarHost(): void {
    starHosting?.cleanup();
    starHosting = null;
    startStarBtn.style.display = 'none';
}

/** set by beginStarHost's caller right before hosting; read by startStarMatch */
let starHordeFlag = false;
/** set only by the Custom Game host flow — when present, startStarMatch
 *  applies ALL of it (timers, roundCards, horde), overriding starHordeFlag */
let starCustomConfig: CustomGameConfig | null = null;

/**
 * `waitForJoined`: total participants (host included) to wait for before
 * auto-starting — default 2 (today's normal behavior: start the moment
 * one guest joins, AI-filling whatever's left). The `?test2v2=<n>` param
 * (see its own comment near the URL-param block) raises this to 3 or 4 so
 * a real multi-tab test can actually gather everyone before the match
 * begins, instead of racing the very first join.
 */
async function beginStarHost(
    horde = false,
    waitForJoined = 2,
    customConfig: CustomGameConfig | null = null,
): Promise<void> {
    starHordeFlag = horde;
    starCustomConfig = customConfig;
    setMenuBusy(true);
    setStatus('Opening 2v2 room…');
    const hostName = getPlayerName();
    let hosted: Awaited<ReturnType<typeof hostStarRoom>>;
    try {
        hosted = await hostStarRoom(initialStarRoster(hostName), setStatus);
    } catch (e) {
        setMenuBusy(false);
        setStatus(`Could not host: ${e instanceof Error ? e.message : e}`);
        return;
    }
    setMenuBusy(false);
    starHosting = hosted;
    const { hub } = hosted;
    startStarBtn.style.display = '';
    const refresh = () => {
        if (!starHosting) return;
        const roster = hub.currentRoster();
        const joined = hub.connectedSeats().length + 1;
        const names = roster.map((s, i) => (i === 0 ? `${s.name} (you)` : s.name)).join(', ');
        // let every currently-connected guest see the same live roster
        // preview instead of just a static "waiting for the host" — see
        // runStarPending's 'starRoster' handling
        hub.broadcast({ type: 'starRoster', roster });
        // auto-start once `waitForJoined` have joined — no manual "click
        // Start" step; the Start button (still shown) is only for "give up
        // waiting, go vs AI now" while the room hasn't reached that yet
        if (joined >= waitForJoined) {
            setStatus(`Room "${hostName}" — ${joined}/4 joined: ${names}. Starting…`);
            startStarMatch();
            return;
        }
        setStatus(
            `Room "${hostName}" — waiting for a friend to join (share your name: "${hostName}"). Click Start to play vs AI now instead.`,
        );
    };
    hub.onRosterChange = refresh;
    hub.listen((name, version, conn) => {
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
        hub.setRosterEntry(seat, { side: hub.sideOf(seat), controller: 'human', name });
        return seat;
    });
    refresh();
}

/** host clicks Start: AI-fill empty seats, send each guest its own setup, launch locally */
function startStarMatch(): void {
    if (!starHosting) return;
    const { hub } = starHosting;
    const connected = new Set(hub.connectedSeats());
    const finalRoster: CanonicalSeatDef[] = hub.currentRoster().map((s, i) => {
        if (i > 0 && s.controller === 'human' && !connected.has(i)) {
            return { side: s.side, controller: 'ai', name: STAR_AI_NAMES[i] ?? 'AI' };
        }
        return s;
    });
    const settings = settingsFromUrl();
    delete settings.seats; // canonical roster travels separately, localized per recipient
    if (starCustomConfig) applyCustomGameConfig(settings, starCustomConfig);
    else if (starHordeFlag) applyHordeMode(settings);
    widenMapForDuo(settings);
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
    const hostSettings = { ...settings, seats: localizeRoster(finalRoster, 'a') };
    startGame(hostSettings, null, 'a', { local: getPlayerName(), opponent: '2v2' }, null, {
        role: 'host',
        hub,
        mySeat: 0,
    });
    starHosting = null; // ownership passes to the running Game now
    starCustomConfig = null;
}

/** join a 2v2 room by the host's room name — waits for the host to Start */
function beginStarJoin(hostName: string): void {
    runStarPending(joinStarRoom(hostName, setStatus));
}

function runStarPending(p: ReturnType<typeof joinStarRoom>): void {
    pending?.cancel();
    let cancelled = false;
    pending = {
        // never actually read back — `pending` only needs `.cancel()` here;
        // this satisfies the shared Pending<NetSession> shape without
        // touching it (star join has no NetSession at all)
        session: Promise.resolve() as unknown as Promise<NetSession>,
        cancel: () => {
            cancelled = true;
            p.cancel();
        },
    };
    setMenuBusy(true);
    p.session
        .then((session) => {
            if (cancelled) return;
            setStatus('Connected — waiting for the host to start…');
            session.onClose = () => {
                if (started) return;
                cancelled = true;
                pending = null;
                setMenuBusy(false);
                setStatus('Host closed the room.');
            };
            // attach() (not once()): the host may send several 'starRoster'
            // previews as others join before the eventual starSetup/
            // starRejected arrives — see beginStarHost's refresh().
            session.attach((msg) => {
                if (cancelled) return;
                if (msg.type === 'starRoster') {
                    const names = msg.roster
                        .map((s, i) => (i === 0 ? `${s.name} (host)` : s.name))
                        .join(', ');
                    setStatus(`Connected — waiting for the host to start… (${names})`);
                    return;
                }
                pending = null;
                setMenuBusy(false);
                if (msg.type === 'starRejected') {
                    setStatus(msg.reason);
                    session.close();
                    return;
                }
                if (msg.type !== 'starSetup' || msg.version !== GAME_VERSION) {
                    setStatus('Version mismatch — both players need the same game version.');
                    session.close();
                    return;
                }
                const settings = msg.settings;
                settings.seed = msg.seed;
                settings.seats = localizeRoster(msg.roster, msg.yourSide);
                const myName = msg.roster[msg.yourSeat]?.name ?? getPlayerName();
                startGame(settings, null, msg.yourSide, { local: myName, opponent: '2v2' }, null, {
                    role: 'guest',
                    session,
                    mySeat: msg.yourSeat,
                });
            });
        })
        .catch((e: unknown) => {
            pending = null;
            setMenuBusy(false);
            if (cancelled || String(e).includes('cancelled')) setStatus('');
            else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
        });
}

// ---- Steam 2v2 (parallel to beginStarHost/startStarMatch/beginStarJoin/
// runStarPending above; own state (steamStarHosting) since a PeerJS StarHub
// and a SteamStarHub are never both active at once) -------------------------

let steamStarHosting: { hub: SteamStarHub; lobbyId: string } | null = null;

function cancelSteamStarHost(): void {
    steamStarHosting?.hub.close();
    steamStarHosting = null;
    startStarBtn.style.display = 'none';
}

/** shared setup for a freshly-created SteamStarHub, whichever call site created it */
function wireSteamStarHub(hub: SteamStarHub): void {
    startStarBtn.style.display = '';
    const refresh = () => {
        if (!steamStarHosting) return;
        const roster = hub.currentRoster();
        const joined = hub.connectedSeats().length + 1;
        const names = roster.map((s, i) => (i === 0 ? `${s.name} (you)` : s.name)).join(', ');
        // let every currently-connected guest see the same live roster
        // preview instead of just a static "waiting for the host" — see
        // runSteamStarPending's 'starRoster' handling
        hub.broadcast({ type: 'starRoster', roster });
        if (joined > 1) {
            setStatus(`Steam lobby — ${joined}/4 joined: ${names}. Starting…`);
            startSteamStarMatch();
            return;
        }
        setStatus('Steam lobby open — invite a friend from the overlay, or click Start to play vs AI now instead.');
    };
    hub.onRosterChange = refresh;
    hub.listen((name, version, _steamId64) => {
        if (version !== GAME_VERSION) {
            return { reject: 'Version mismatch — both players need the same game version.' };
        }
        const seat = hub.nextOpenSeat();
        if (seat === null) return { reject: 'Room is full.' };
        hub.setRosterEntry(seat, { side: hub.sideOf(seat), controller: 'human', name });
        return seat;
    });
    refresh();
}

/** host a private 2v2 Steam lobby for a direct friend invite (Steam overlay) */
async function beginSteamStarHost(horde = false): Promise<void> {
    starHordeFlag = horde;
    setMenuBusy(true);
    setStatus('Opening Steam lobby…');
    let hosted: { hub: SteamStarHub; lobbyId: string };
    try {
        hosted = await hostSteamStarRoom(initialStarRoster(getPlayerName()), false);
    } catch (e) {
        setMenuBusy(false);
        setStatus(`Could not host: ${e instanceof Error ? e.message : e}`);
        return;
    }
    setMenuBusy(false);
    steamStarHosting = hosted;
    wireSteamStarHub(hosted.hub);
    steamLobby.openInviteDialog();
}

/** host clicks Start: AI-fill empty seats, send each guest its own setup,
 *  launch locally — mirrors startStarMatch */
function startSteamStarMatch(): void {
    if (!steamStarHosting) return;
    const { hub } = steamStarHosting;
    const connected = new Set(hub.connectedSeats());
    const finalRoster: CanonicalSeatDef[] = hub.currentRoster().map((s, i) => {
        if (i > 0 && s.controller === 'human' && !connected.has(i)) {
            return { side: s.side, controller: 'ai', name: STAR_AI_NAMES[i] ?? 'AI' };
        }
        return s;
    });
    const settings = settingsFromUrl();
    delete settings.seats;
    if (starHordeFlag) applyHordeMode(settings);
    widenMapForDuo(settings);
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
    const hostSettings = { ...settings, seats: localizeRoster(finalRoster, 'a') };
    startGame(hostSettings, null, 'a', { local: getPlayerName(), opponent: '2v2' }, null, {
        role: 'host',
        hub,
        mySeat: 0,
    });
    steamStarHosting = null; // ownership passes to the running Game now
}

function runSteamStarPending(p: Promise<SteamGuestSession>): void {
    pending?.cancel();
    let cancelled = false;
    pending = {
        // never actually read back — `pending` only needs `.cancel()` here;
        // this satisfies the shared Pending<NetSession> shape without
        // touching it (star join has no NetSession at all — same trick as
        // the PeerJS runStarPending above)
        session: Promise.resolve() as unknown as Promise<NetSession>,
        cancel: () => {
            cancelled = true;
        },
    };
    setMenuBusy(true);
    p.then((session) => {
        if (cancelled) return;
        setStatus('Connected — waiting for the host to start…');
        session.onClose = () => {
            if (started) return;
            cancelled = true;
            pending = null;
            setMenuBusy(false);
            setStatus('Host closed the room.');
        };
        // attach() (not once()): the host may send several 'starRoster'
        // previews as others join before the eventual starSetup/
        // starRejected arrives — see wireSteamStarHub's refresh().
        session.attach((msg) => {
            if (cancelled) return;
            if (msg.type === 'starRoster') {
                const names = msg.roster.map((s, i) => (i === 0 ? `${s.name} (host)` : s.name)).join(', ');
                setStatus(`Connected — waiting for the host to start… (${names})`);
                return;
            }
            pending = null;
            setMenuBusy(false);
            if (msg.type === 'starRejected') {
                setStatus(msg.reason);
                session.close();
                return;
            }
            if (msg.type !== 'starSetup' || msg.version !== GAME_VERSION) {
                setStatus('Version mismatch — both players need the same game version.');
                session.close();
                return;
            }
            const settings = msg.settings;
            settings.seed = msg.seed;
            settings.seats = localizeRoster(msg.roster, msg.yourSide);
            const myName = msg.roster[msg.yourSeat]?.name ?? getPlayerName();
            startGame(settings, null, msg.yourSide, { local: myName, opponent: '2v2' }, null, {
                role: 'guest',
                session,
                mySeat: msg.yourSeat,
            });
        });
    }).catch((e: unknown) => {
        pending = null;
        setMenuBusy(false);
        if (cancelled || String(e).includes('cancelled')) setStatus('');
        else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
    });
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

/** resets and reveals the Matchmaking picker (team size / Horde / Invite /
 *  Play) — shown up front for Steam (see the 'matchmaking' case below for
 *  why), and as the fallback for the plain PeerJS path once a quick probe
 *  finds nobody already waiting to join. */
function showMatchmakingPicker(): void {
    mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = false));
    mmYouNameEl.textContent = getPlayerName();
    mmInviteEl.disabled = false;
    mmInviteEl.textContent = '+ Invite a Friend';
    mmLinkEl.style.display = 'none';
    mmModeEl.style.display = '';
}

/**
 * Plain (non-Steam) 1v1 quick match, probe-first.
 *
 * `committed=false` (the default): used for the initial "just clicked
 * Matchmaking" attempt, before the player has chosen a mode. Finds someone
 * already waiting → connects immediately. Finds no one → gives up on this
 * probe and reveals the simplified picker (mmSimpleEl) so the player can
 * choose a mode.
 *
 * `committed=true`: used by the picker's OWN mode buttons (mms-1v1/
 * mms-horde) — the player already chose, so "nobody's waiting" here means
 * actually queue and wait (status + Cancel button), not bounce back to the
 * same picker. Bug fix: this used to call the same not-committed path, so
 * picking a mode from the picker re-ran the exact same probe-and-bail
 * behavior that got them there, cancelling the wait instead of starting it —
 * looked like the click did nothing (a quick flicker back to the picker).
 */
function tryQuickMatch(horde: boolean, committed = false): void {
    mmSimpleEl.style.display = 'none';
    setStatus('Looking for a match…');
    setMenuBusy(true);
    const probe = quickMatch(
        (s) => setStatus(s),
        committed
            ? undefined
            : () => {
                  pending = null;
                  probe.cancel();
                  setMenuBusy(false);
                  setStatus('');
                  mmSimpleEl.style.display = '';
              },
    );
    pending = probe;
    probe.session
        .then((session) => {
            pending = null;
            setMenuBusy(false);
            setStatus('');
            void beginNetGame(session, horde ? applyHordeMode : undefined);
        })
        .catch(() => {
            // either the deliberate cancel-and-reveal above, or the
            // player's own Cancel click — both handled where they happened
        });
}

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
    mmSimpleEl.style.display = 'none';
    setStatus('Looking for an open 2v2 room…');
    void fetchLobbyRooms().then((rooms) => {
        const mine = getPlayerName().toLowerCase();
        const open = rooms.find((r) => r.mode === '2v2' && r.name.toLowerCase() !== mine);
        if (open) beginStarJoin(open.name);
        else void beginStarHost(horde, waitForJoined);
    });
}

/**
 * Plain Matchmaking click, no `?test2v2=` of its own: the host defines
 * the game (via its own `?test2v2=` value, or the normal 1v1 flow), and a
 * client should just connect to whatever's next — it never needs to know
 * in advance whether that's a 2v2 test room or an ordinary 1v1. Checks
 * for an already-open 2v2 room first; only falls back to the normal 1v1
 * quick match if none is found, so a client tab needs no param at all to
 * join a `?test2v2=` host's room.
 */
function tryMatchmaking(): void {
    setStatus('Looking for a match…');
    void fetchLobbyRooms().then((rooms) => {
        const mine = getPlayerName().toLowerCase();
        // any OPEN room (not a spectate-only entry for an already-running
        // match) — 1v1 or 2v2 alike, so a plain "Matchmaking" click on one
        // tab always finds what another tab's "Matchmaking" click just
        // hosted, the same way both used to only work for 2v2
        const open = rooms.find((r) => r.kind === 'lobby' && r.name.toLowerCase() !== mine);
        if (open?.mode === '2v2') {
            beginStarJoin(open.name);
        } else if (open) {
            runPending(joinLobby(open.name, setStatus));
        } else {
            // nothing open — host a discoverable room (not the old
            // anonymous quickMatch queue, which never showed up in the
            // room list at all) so the very next "Matchmaking" click,
            // from any tab, finds this one instead of also hosting blind
            runPending(hostLobby(setStatus), applyHordeMode);
        }
    });
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
            const players = result.roster.filter((r) => r.role === 'player');
            const names = {
                local: players[0]?.name ?? 'Player',
                opponent: players[1]?.name ?? 'Opponent',
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

menu.addEventListener('click', (e) => {
    const roomBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-room');
    if (roomBtn?.dataset.room && !started && !pending) {
        if (!bootReady) {
            setStatus('Still loading — one moment…');
            return;
        }
        if (roomBtn.dataset.roomKind === 'spectate') startSpectateGame(roomBtn.dataset.room);
        else if (roomBtn.dataset.roomMode === '2v2') beginStarJoin(roomBtn.dataset.room);
        else runPending(joinLobby(roomBtn.dataset.room, setStatus));
        return;
    }

    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-btn');
    if (!button || started) return;

    if (button.classList.contains('m-cancel')) {
        pending?.cancel();
        pending = null;
        cancelStarHost();
        cancelSteamStarHost();
        setMenuBusy(false);
        setStatus('');
        // a quick-match probe/wait hides every panel including mainButtonsEl
        // (see tryQuickMatch/try2v2Match) — restore a sane menu state rather
        // than leaving the player at a blank screen with nothing clickable
        mmModeEl.style.display = 'none';
        mmSimpleEl.style.display = 'none';
        mainButtonsEl.style.display = '';
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
            mode === 'mms-1v1' ||
            mode === 'mms-2v2' ||
            mode === 'mms-horde' ||
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
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            break;
        case 'sp-1v1':
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            startLocalMatch();
            break;
        case 'sp-2v2':
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            startLocalMatch({ duo: true });
            break;
        case 'sp-horde':
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            startLocalMatch({ horde: true });
            break;
        case 'matchmaking': {
            spModeEl.style.display = 'none';
            customEl.style.display = 'none';
            mmSimpleEl.style.display = 'none';
            mainButtonsEl.style.display = 'none';
            const test2v2 = test2v2Param();
            if (test2v2 !== null) {
                try2v2Match(true, test2v2);
                break;
            }
            if (steam.isAvailable()) {
                // unchanged for Steam: quickSteamMatch's "host" branch
                // creates a real public Steam lobby the instant it starts
                // waiting, and safely abandoning that lobby if the player
                // changes their mind first needs its own pass before the
                // probe-first shortcut below is safe to extend there too.
                // Mode/Horde choice is forced+hidden in the HTML for now
                // (1v1 Horde only) — Invite/Play still work as before.
                showMatchmakingPicker();
                break;
            }
            // simplified to 1v1 Horde only for now — always committed (no
            // picker to fall back to, there's nothing left to choose). Still
            // checks for an open 2v2 room first (see tryMatchmaking's doc
            // comment) so a `?test2v2=` host's other tabs need no param of
            // their own at all — clicking plain Matchmaking already finds
            // whatever's open.
            tryMatchmaking();
            break;
        }
        case 'mms-1v1':
            tryQuickMatch(false, true);
            break;
        case 'mms-horde':
            tryQuickMatch(true, true);
            break;
        case 'mms-2v2':
            try2v2Match(false);
            break;
        case 'mms-back':
            pending?.cancel();
            pending = null;
            cancelStarHost();
            setMenuBusy(false);
            setStatus('');
            mmSimpleEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            break;
        case 'mm-back':
            pending?.cancel();
            pending = null;
            cancelStarHost();
            cancelSteamStarHost();
            setMenuBusy(false);
            setStatus('');
            mmModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            break;
        case 'mm-invite': {
            const team = mmModeEl.querySelector<HTMLInputElement>('input[name="mmteam"]:checked')!.value;
            const horde = mmHordeEl.checked;
            mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = true));
            mmInviteEl.disabled = true;
            if (steam.isAvailable()) {
                // Steam's own overlay invite picker replaces the copy-paste
                // link — no room code to show, just open it once the lobby exists
                mmInviteEl.textContent = 'Waiting for your friend…';
                mmLinkEl.textContent = 'Invite a friend from the Steam overlay that just opened.';
                mmLinkEl.style.display = '';
                if (team === '2v2') void beginSteamStarHost(horde);
                else {
                    const hosted = hostSteamRoom(false, () => steamLobby.openInviteDialog());
                    runSteamPending(hosted.session, 'host', horde ? applyHordeMode : undefined);
                }
                break;
            }
            mmInviteEl.textContent = 'Waiting for your friend…';
            const hostName = getPlayerName();
            const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(hostName)}`;
            mmLinkEl.textContent = `Send this to your friend: ${link}`;
            mmLinkEl.style.display = '';
            if (team === '2v2') void beginStarHost(horde);
            else runPending(hostLobby(setStatus), horde ? applyHordeMode : undefined);
            break;
        }
        case 'mm-play': {
            const team = mmModeEl.querySelector<HTMLInputElement>('input[name="mmteam"]:checked')!.value;
            const horde = mmHordeEl.checked;
            mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = true));
            mmInviteEl.disabled = true;
            if (steam.isAvailable()) {
                setStatus('Looking for an open Steam lobby…');
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
                break;
            }
            if (team === '2v2') {
                setStatus('Looking for an open 2v2 room…');
                void fetchLobbyRooms().then((rooms) => {
                    const mine = getPlayerName().toLowerCase();
                    const open = rooms.find((r) => r.mode === '2v2' && r.name.toLowerCase() !== mine);
                    if (open) beginStarJoin(open.name);
                    else void beginStarHost(horde);
                });
            } else {
                runPending(quickMatch(setStatus), horde ? applyHordeMode : undefined);
            }
            break;
        }
        case 'custom': {
            spModeEl.style.display = 'none';
            mmModeEl.style.display = 'none';
            mmSimpleEl.style.display = 'none';
            mainButtonsEl.style.display = 'none';
            populateCustomGameForm(loadCustomGameConfig());
            customEl.style.display = '';
            menu.classList.add('m-wide');
            title.visible = false;
            break;
        }
        case 'cg-back':
            closeCustomGameScreen();
            mainButtonsEl.style.display = '';
            break;
        case 'cg-reset':
            populateCustomGameForm(DEFAULT_CUSTOM_GAME);
            break;
        case 'cg-host':
            hostCustomGame();
            break;
        case 'startstar':
            startStarMatch();
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
const mpMarker = loadResumeMarker();
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
} else if (mpMarker) {
    void attemptResume(mpMarker);
} else if (spSave) {
    if (spSave.version !== GAME_VERSION) {
        clearSinglePlayer();
        setMenuChromeVisible(true);
    } else resumeSinglePlayer(spSave);
} else {
    setMenuChromeVisible(true);
    // ?room=mangoo — join that host's room directly. Unlike the room-list
    // buttons, a deep link carries no mode — look it up first so a 2v2
    // room routes to the star join flow instead of hanging forever on
    // the classic one (a star host never answers a classic 'hello').
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) {
        void fetchLobbyRooms().then((rooms) => {
            const match = rooms.find((r) => r.name.toLowerCase() === roomParam.toLowerCase());
            if (match?.mode === '2v2') beginStarJoin(roomParam);
            else runPending(joinLobby(roomParam, setStatus));
        });
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
