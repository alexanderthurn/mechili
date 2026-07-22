import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { Game } from './game/game';
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
    joinLobby,
    joinStarRoom,
    loadResumeMarker,
    loadSinglePlayer,
    postGlobalChat,
    quickMatch,
    raceReconnectStrategies,
    resumeSession,
    saveResumeMarker,
    saveSinglePlayer,
    type NetSession,
    type Pending,
    type ResumeMarker,
    type SinglePlayerSave,
    type StarRole,
} from './game/net';
import { getPlayerName, setPlayerName, validatePlayerName } from './game/player';
import { getCachedProfile, isProfileLockedOut, probeName, claimName, syncOpenProfile } from './game/account';
import { bootGameAssets } from './game/bootAssets';
import { initInputCapabilities, noteGamepadActivity } from './game/inputCapabilities';
import { effectiveDpr, onPrefsChange, prefs } from './game/prefs';
import { openSettings } from './ui/settings';
import { openSuggest } from './suggest';
import { DEFAULT_HORDE, DEFAULT_SETTINGS, type GameSettings } from './game/settings';
import { duoSeats, localizeRoster, type CanonicalSeatDef } from './game/seats';
import { THEME, menuStyles } from './theme';

// ?horde=1 / the Horde menu button — PvPvE: a neutral pink dwarf horde owns
// a wide forest belt in the map center and spawns a bigger wave every round
function applyHordeMode(settings: GameSettings): void {
    settings.horde = structuredClone(DEFAULT_HORDE);
    settings.map = { ...settings.map, neutralRows: settings.horde.beltRows };
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

// dev override: tweak match settings from the URL, e.g. ?hp=100&build=20
function settingsFromUrl(): GameSettings {
    const params = new URLSearchParams(location.search);
    const settings = structuredClone(DEFAULT_SETTINGS);
    const hp = Number(params.get('hp'));
    if (hp > 0) settings.startingHp = hp;
    const build = Number(params.get('build'));
    if (build > 0) settings.buildTimeSeconds = build;
    const seed = Number(params.get('seed'));
    if (seed > 0) settings.seed = seed;
    if (params.get('horde')) applyHordeMode(settings);
    if (params.get('duo')) applyDuoMode(settings);
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
    threeCanvas.remove();
    threeCanvas = createThreeCanvas();
    wrapper.insertBefore(threeCanvas, app.canvas);
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

function layoutTitle() {
    const cx = app.screen.width / 2;
    const cy = app.screen.height / 2 - 160;
    const scale = Math.min(app.screen.width * 0.62, 600) / logo.texture.width;
    logo.scale.set(scale);
    logo.position.set(cx, cy);
    subtitle.position.set(cx, cy + logo.height / 2 + 2);
}
layoutTitle();
app.renderer.on('resize', layoutTitle);

const menu = document.createElement('div');
menu.className = 'mechili-menu';
menu.style.position = 'relative';
menu.style.zIndex = '30';
menu.style.display = 'none';
menu.innerHTML = `
    <div class="m-main">
        <button class="m-btn m-primary" data-mode="single"><span class="m-ico">▶</span><span class="m-label">Single Player</span></button>
        <button class="m-btn" data-mode="matchmaking"><span class="m-ico">⚔</span><span class="m-label">Matchmaking</span></button>
        <button class="m-btn" data-mode="lobby"><span class="m-ico">◈</span><span class="m-label">Custom Room</span></button>
    </div>
    <div class="m-spmode" style="display:none">
        <div class="m-spmode-title">Single Player</div>
        <div class="m-spmode-row">
            <label><input type="radio" name="spteam" value="1v1" checked> 1v1</label>
            <label><input type="radio" name="spteam" value="2v2"> 2v2</label>
        </div>
        <label class="m-spmode-horde"><input type="checkbox" class="sp-horde"> 🐗 Horde</label>
        <div class="m-room-row">
            <button class="m-btn m-small" data-mode="sp-back">Back</button>
            <button class="m-btn m-primary m-small" data-mode="sp-play">Play</button>
        </div>
    </div>
    <div class="m-matchmaking" style="display:none">
        <div class="m-spmode-title">Matchmaking</div>
        <div class="m-spmode-row">
            <label><input type="radio" name="mmteam" value="1v1" checked> 1v1</label>
            <label><input type="radio" name="mmteam" value="2v2"> 2v2</label>
        </div>
        <label class="m-spmode-horde"><input type="checkbox" class="mm-horde"> 🐗 Horde</label>
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
    <div class="m-lobby" style="display:none">
        <div class="m-room-row">
            <button class="m-btn m-small" data-mode="host">Host Room</button>
            <button class="m-btn m-small" data-mode="host2v2">Host 2v2 Online</button>
            <button class="m-btn m-small" data-mode="refresh">Refresh</button>
        </div>
        <div class="m-room-list empty">No open rooms</div>
    </div>
    <div class="m-status" style="display:none"></div>
    <button class="m-btn m-small" data-mode="startstar" style="display:none">Start 2v2 Match</button>
    <button class="m-btn m-small m-cancel" style="display:none">Cancel</button>
`;
wrapper.appendChild(menu);

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
    applyGlobalChatVisibility();
    if (visible) ensureMenuGamepadCursor();
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

const lobbyEl = menu.querySelector<HTMLDivElement>('.m-lobby')!;
const roomListEl = menu.querySelector<HTMLDivElement>('.m-room-list')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
const cancelEl = menu.querySelector<HTMLButtonElement>('.m-cancel')!;
const spModeEl = menu.querySelector<HTMLDivElement>('.m-spmode')!;
const spHordeEl = menu.querySelector<HTMLInputElement>('.sp-horde')!;
const mainButtonsEl = menu.querySelector<HTMLDivElement>('.m-main')!;
const mmModeEl = menu.querySelector<HTMLDivElement>('.m-matchmaking')!;
const mmHordeEl = menu.querySelector<HTMLInputElement>('.mm-horde')!;
const mmYouNameEl = menu.querySelector<HTMLSpanElement>('.mm-you-name')!;
const mmInviteEl = menu.querySelector<HTMLButtonElement>('.m-seat-invite')!;
const mmLinkEl = menu.querySelector<HTMLDivElement>('.m-mm-link')!;

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

function showResumeOverlay(message: string, sub: string, onCancel: () => void): void {
    hideResumeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'mechili-resume';
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

refreshUsernameLabel();
void refreshOpenProfile();
usernameEl.addEventListener('click', () => showNameEditor());

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
    if (lobbyEl.style.display === 'none') return;
    try {
        const rooms = await fetchLobbyRooms();
        const mine = getPlayerName();
        const others = rooms.filter((r) => r.name.toLowerCase() !== mine.toLowerCase());
        if (others.length === 0) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.innerHTML = 'No open rooms';
            return;
        }
        roomListEl.className = 'm-room-list';
        // room names come from the server — build via DOM, never innerHTML
        roomListEl.replaceChildren(
            ...others.map((r) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'm-room';
                button.dataset.room = r.name;
                button.dataset.roomMode = r.mode;
                button.textContent = r.mode === '2v2' ? `${r.name} (2v2)` : r.name;
                return button;
            }),
        );
    } catch {
        roomListEl.className = 'm-room-list empty';
        roomListEl.innerHTML = 'Could not load rooms';
    }
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
function returnToMenu(): void {
    stopSinglePlayerPersist?.();
    stopSinglePlayerPersist = null;
    clearMatchResumeData();
    activeGame?.destroy();
    activeGame = null;
    replaceThreeCanvas();
    started = false;
    setGameLayerVisible(false);
    title.visible = true;
    layoutTitle();
    app.renderer.on('resize', layoutTitle);
    app.render();
    wrapper.appendChild(menu);
    wrapper.appendChild(usernameEl);
    wrapper.appendChild(versionEl);
    wrapper.appendChild(settingsCornerEl);
    wrapper.appendChild(suggestCornerEl);
    wrapper.appendChild(gchatEl);
    startGlobalChatPoll();
    refreshUsernameLabel();
    void refreshOpenProfile();
    setMenuBusy(false);
    setStatus('');
    setMenuChromeVisible(true);
}

function startGame(
    settings: GameSettings,
    net: NetSession | null = null,
    side: 'a' | 'b' = 'a',
    names: { local: string; opponent: string } = {
        local: getPlayerName(),
        opponent: net ? 'Opponent' : 'AI',
    },
    resume: MatchResume | null = null,
    /** 2v2+ star-topology connection — mutually exclusive with `net` */
    star: StarRole | null = null,
): void {
    if (started) return;
    started = true;
    destroyMenuGamepadCursor();
    stopRoomPoll();
    stopGlobalChatPoll();
    hideResumeOverlay();
    resumeAbort?.abort();
    resumeAbort = null;
    setGameLayerVisible(true);
    title.visible = false;
    app.renderer.off('resize', layoutTitle);
    menu.remove();
    usernameEl.remove();
    versionEl.remove();
    settingsCornerEl.remove();
    suggestCornerEl.remove();
    gchatEl.remove();
    if (net) {
        clearSinglePlayer();
        saveResumeMarker({
            side,
            names,
            remotePeerId: net.remoteId,
            ownPeerId: net.ownId,
        });
    } else {
        clearResumeMarker();
        // star matches have no save/resume story yet (v1 scope) — never
        // persist or resume one via the single-player slot
        if (!resume?.local && !star) clearSinglePlayer();
    }
    const game = new Game(app, threeCanvas, wrapper, settings, net, side, names, resume, star);
    activeGame = game;
    game.onReturnToMenu = returnToMenu;
    if (net) wireReconnect(game, net, side, names);
    else if (!star) stopSinglePlayerPersist = wireSinglePlayerPersist(game);
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
    showResumeOverlay(
        'Reconnecting…',
        'Waiting for your opponent and restoring the match.',
        () => {
            ac.abort();
            clearResumeMarker();
            hideResumeOverlay();
            setMenuChromeVisible(true);
            setMenuBusy(false);
        },
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
        startGame(settings, session, marker.side, marker.names, {
            actions: msg.actions,
            battleElapsed: msg.battleElapsed,
            phaseRemaining: msg.phaseRemaining,
        });
    } catch (e) {
        session?.close();
        hideResumeOverlay();
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
    const settings = save.settings;
    settings.seed = save.seed;
    startGame(settings, null, 'a', { local: save.localName, opponent: 'AI' }, {
        actions: save.actions,
        battleElapsed: save.battleElapsed,
        phaseRemaining: save.phaseRemaining,
        local: true,
    });
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

async function beginStarHost(horde = false): Promise<void> {
    starHordeFlag = horde;
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
        // auto-start the moment anyone joins — no manual "click Start" step;
        // the Start button (still shown) is only for "give up waiting, go
        // vs AI now" while the room is still empty
        if (joined > 1) {
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
    starHosting = null; // ownership passes to the running Game now
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
        .then(async (session) => {
            if (cancelled) return;
            setStatus('Connected — waiting for the host to start…');
            session.onClose = () => {
                if (started) return;
                cancelled = true;
                pending = null;
                setMenuBusy(false);
                setStatus('Host closed the room.');
            };
            const msg = await session.once();
            pending = null;
            setMenuBusy(false);
            if (cancelled) return;
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
        })
        .catch((e: unknown) => {
            pending = null;
            setMenuBusy(false);
            if (cancelled || String(e).includes('cancelled')) setStatus('');
            else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
        });
}

menu.addEventListener('click', (e) => {
    const roomBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-room');
    if (roomBtn?.dataset.room && !started && !pending) {
        if (!bootReady) {
            setStatus('Still loading — one moment…');
            return;
        }
        if (roomBtn.dataset.roomMode === '2v2') beginStarJoin(roomBtn.dataset.room);
        else runPending(joinLobby(roomBtn.dataset.room, setStatus));
        return;
    }

    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-btn');
    if (!button || started) return;

    if (button.classList.contains('m-cancel')) {
        pending?.cancel();
        pending = null;
        cancelStarHost();
        setMenuBusy(false);
        setStatus('');
        return;
    }

    const mode = button.dataset.mode;
    if (
        !bootReady &&
        (mode === 'sp-play' ||
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
        if (opts.horde) applyHordeMode(settings);
        if (opts.duo) applyDuoMode(settings);
        startGame(settings);
    };

    switch (mode) {
        case 'single':
            lobbyEl.style.display = 'none';
            stopRoomPoll();
            mainButtonsEl.style.display = 'none';
            spModeEl.style.display = '';
            break;
        case 'sp-back':
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            break;
        case 'sp-play': {
            const team = spModeEl.querySelector<HTMLInputElement>('input[name="spteam"]:checked')!.value;
            spModeEl.style.display = 'none';
            mainButtonsEl.style.display = '';
            startLocalMatch({ duo: team === '2v2', horde: spHordeEl.checked });
            break;
        }
        case 'matchmaking':
            spModeEl.style.display = 'none';
            lobbyEl.style.display = 'none';
            stopRoomPoll();
            mainButtonsEl.style.display = 'none';
            // reset to a clean state every time the screen opens — covers
            // returning here after an earlier invite/play completed or was
            // cancelled
            mmModeEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = false));
            mmYouNameEl.textContent = getPlayerName();
            mmInviteEl.disabled = false;
            mmInviteEl.textContent = '+ Invite a Friend';
            mmLinkEl.style.display = 'none';
            mmModeEl.style.display = '';
            break;
        case 'mm-back':
            pending?.cancel();
            pending = null;
            cancelStarHost();
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
        case 'lobby': {
            spModeEl.style.display = 'none';
            mmModeEl.style.display = 'none';
            const open = lobbyEl.style.display === 'none';
            lobbyEl.style.display = open ? '' : 'none';
            if (open) startRoomPoll();
            else stopRoomPoll();
            break;
        }
        case 'host':
            runPending(hostLobby(setStatus));
            break;
        case 'host2v2':
            lobbyEl.style.display = 'none';
            stopRoomPoll();
            void beginStarHost();
            break;
        case 'startstar':
            startStarMatch();
            break;
        case 'refresh':
            void refreshRoomList();
            break;
    }
});

// full-screen boot splash (logo + bar + Feuerware) until assets are ready —
// only then does the main menu chrome appear (unless we resume a match)
await bootGameAssets((p) => setBootProgress(p.fraction, p.label));
bootReady = true;
loadingEl.remove();
feuerwareEl.remove();

// reload mid-match: multiplayer reconnects via peer, single-player from local save
setGameLayerVisible(false);
const mpMarker = loadResumeMarker();
const spSave = loadSinglePlayer();
if (mpMarker) {
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
        lobbyEl.style.display = '';
        startRoomPoll();
        void fetchLobbyRooms().then((rooms) => {
            const match = rooms.find((r) => r.name.toLowerCase() === roomParam.toLowerCase());
            if (match?.mode === '2v2') beginStarJoin(roomParam);
            else runPending(joinLobby(roomParam, setStatus));
        });
    }
}

// Keep the main-menu gamepad cursor moving while the menu is visible.
app.ticker.add((ticker) => {
    if (!started && menuChromeVisible && menuGamepad) {
        menuGamepad.update(ticker.deltaMS / 1000);
    }
});
