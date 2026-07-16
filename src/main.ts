import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { Game } from './game/game';
import {
    clearResumeMarker,
    clearSinglePlayer,
    fetchGlobalChat,
    fetchLobbyRooms,
    GAME_VERSION,
    handshake,
    hostLobby,
    joinLobby,
    loadResumeMarker,
    loadSinglePlayer,
    postGlobalChat,
    quickMatch,
    resumeSession,
    saveResumeMarker,
    saveSinglePlayer,
    type NetSession,
    type Pending,
    type ResumeMarker,
    type SinglePlayerSave,
} from './game/net';
import { getPlayerName, setPlayerName, validatePlayerName } from './game/player';
import { getCachedProfile, isProfileLockedOut, probeName, claimName, syncOpenProfile } from './game/account';
import { preloadUnitVisuals } from './game/units';
import { onPrefsChange, prefs } from './game/prefs';
import { openSettings } from './ui/settings';
import { DEFAULT_SETTINGS, type GameSettings } from './game/settings';
import { THEME, menuStyles } from './theme';

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
    return settings;
}

const wrapper = document.createElement('div');
const menuBgUrl = new URL('../assets/ui/menu-bg.webp', import.meta.url).href;
wrapper.style.cssText =
    `position:fixed;inset:0;overflow:hidden;` +
    `background:#b8d4c8 url(${menuBgUrl}) center/cover no-repeat;`;

function createThreeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
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

const app = new Application();
await app.init({ backgroundAlpha: 0, resizeTo: wrapper, antialias: true });
app.canvas.style.position = 'absolute';
app.canvas.style.inset = '0';
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

const style = document.createElement('style');
style.textContent = menuStyles();
document.head.appendChild(style);

const menu = document.createElement('div');
menu.className = 'mechili-menu';
menu.style.position = 'relative';
menu.style.zIndex = '30';
menu.innerHTML = `
    <button class="m-btn m-primary" data-mode="single"><span class="m-ico">▶</span><span class="m-label">Single Player</span></button>
    <button class="m-btn" data-mode="quick"><span class="m-ico">⚔</span><span class="m-label">Matchmaking</span></button>
    <button class="m-btn" data-mode="lobby"><span class="m-ico">◈</span><span class="m-label">Custom Room</span></button>
    <div class="m-lobby" style="display:none">
        <div class="m-room-row">
            <button class="m-btn m-small" data-mode="host">Host Room</button>
            <button class="m-btn m-small" data-mode="refresh">Refresh</button>
        </div>
        <div class="m-room-list empty">No open rooms</div>
    </div>
    <div class="m-status" style="display:none"></div>
    <button class="m-btn m-small m-cancel" style="display:none">Cancel</button>
`;
wrapper.appendChild(menu);

const usernameEl = document.createElement('button');
usernameEl.className = 'mechili-username';
usernameEl.type = 'button';
usernameEl.style.zIndex = '30';
wrapper.appendChild(usernameEl);

const versionEl = document.createElement('div');
versionEl.className = 'mechili-version';
versionEl.style.zIndex = '30';
versionEl.textContent = `v${__APP_VERSION__} · protocol ${GAME_VERSION}`;
wrapper.appendChild(versionEl);

// big gear in the top-right corner of the main menu
const settingsCornerEl = document.createElement('button');
settingsCornerEl.className = 'mechili-settings-btn';
settingsCornerEl.type = 'button';
settingsCornerEl.textContent = '⚙';
settingsCornerEl.title = 'Settings';
settingsCornerEl.addEventListener('click', () => openSettings(wrapper));
wrapper.appendChild(settingsCornerEl);

// --- global menu chat (php-backed: last 10 messages + admin sticky) ---
const gchatEl = document.createElement('div');
gchatEl.className = 'mechili-gchat';
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

// starts collapsed as a small "Chat" button; clicking anywhere outside
// collapses it again (the input keeps whatever was typed)
gchatEl.querySelector('.g-strip')!.addEventListener('click', () => {
    gchatEl.classList.add('open');
    void refreshGlobalChat();
    gchatInput.focus();
});
document.addEventListener('pointerdown', (e) => {
    if (gchatEl.classList.contains('open') && !gchatEl.contains(e.target as Node)) {
        gchatEl.classList.remove('open');
    }
});

// the "show global chat" setting hides the panel, live; the poll keeps
// ticking but refreshGlobalChat skips fetching while hidden or in-game
function applyGlobalChatVisibility(): void {
    gchatEl.style.display = prefs().globalChat ? '' : 'none';
    if (prefs().globalChat) void refreshGlobalChat();
}
applyGlobalChatVisibility();
onPrefsChange(applyGlobalChatVisibility);
startGlobalChatPoll();

const lobbyEl = menu.querySelector<HTMLDivElement>('.m-lobby')!;
const roomListEl = menu.querySelector<HTMLDivElement>('.m-room-list')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
const cancelEl = menu.querySelector<HTMLButtonElement>('.m-cancel')!;

let started = false;
let pending: Pending | null = null;
let roomPoll: ReturnType<typeof setInterval> | null = null;
let resumeOverlay: HTMLDivElement | null = null;
let resumeAbort: AbortController | null = null;
let activeGame: Game | null = null;
let stopSinglePlayerPersist: (() => void) | null = null;

type MatchResume = { actions: LoggedAction[]; battleElapsed: number | null; local?: boolean };

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
                button.textContent = r.name;
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
    wrapper.appendChild(gchatEl);
    startGlobalChatPoll();
    refreshUsernameLabel();
    void refreshOpenProfile();
    setMenuBusy(false);
    setStatus('');
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
): void {
    if (started) return;
    started = true;
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
    gchatEl.remove();
    if (net) {
        clearSinglePlayer();
        saveResumeMarker({
            side,
            names,
            remotePeerId: net.remoteId,
            ownRoomId: net.ownId.startsWith('mechili-room-') ? net.ownId : null,
        });
    } else {
        clearResumeMarker();
        if (!resume?.local) clearSinglePlayer();
    }
    const game = new Game(app, threeCanvas, wrapper, settings, net, side, names, resume);
    activeGame = game;
    game.onReturnToMenu = returnToMenu;
    if (net) wireReconnect(game, net);
    else stopSinglePlayerPersist = wireSinglePlayerPersist(game);
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

/**
 * Survivor side of a dropped connection: pause the game, wait for the peer
 * to come back (re-hosting our room, or redialing theirs), answer their
 * resume request with the full match state, then continue.
 */
function wireReconnect(game: Game, initial: NetSession): void {
    let session = initial;
    game.onConnectionLost = () => {
        game.suspend('Connection lost — waiting for the opponent to reconnect…');
        void (async () => {
            try {
                // if the dropped peer owned a room id it will RE-HOST it (we
                // redial); otherwise it knows our id and dials us (we wait)
                const next = session.remoteId.startsWith('mechili-room-')
                    ? await session.redial()
                    : await session.awaitReconnect();
                if (activeGame !== game) return;
                const first = await next.once();
                if (activeGame !== game) return;
                if (first.type === 'resume') {
                    next.send({ type: 'state', version: GAME_VERSION, ...game.exportResume() });
                }
                session = next;
                game.resumeWith(next);
            } catch {
                if (activeGame !== game) return;
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
    menu.style.display = 'none';
    usernameEl.style.display = 'none';
    versionEl.style.display = 'none';
    showResumeOverlay(
        'Reconnecting…',
        'Waiting for your opponent and restoring the match.',
        () => {
            ac.abort();
            clearResumeMarker();
            hideResumeOverlay();
            menu.style.display = '';
            usernameEl.style.display = '';
            versionEl.style.display = '';
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
        });
    } catch (e) {
        session?.close();
        hideResumeOverlay();
        menu.style.display = '';
        usernameEl.style.display = '';
        versionEl.style.display = '';
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
        local: true,
    });
}

async function beginNetGame(session: NetSession): Promise<void> {
    await handshake(session);
    const localName = session.localName;

    if (session.role === 'host') {
        const settings = settingsFromUrl();
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

function runPending(p: Pending): void {
    pending?.cancel();
    pending = p;
    setMenuBusy(true);
    p.session
        .then((session) => {
            pending = null;
            setMenuBusy(false);
            void beginNetGame(session);
        })
        .catch((e: unknown) => {
            pending = null;
            setMenuBusy(false);
            if (String(e).includes('cancelled')) setStatus('');
            else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
        });
}

menu.addEventListener('click', (e) => {
    const roomBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-room');
    if (roomBtn?.dataset.room && !started && !pending) {
        runPending(joinLobby(roomBtn.dataset.room, setStatus));
        return;
    }

    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-btn');
    if (!button || started) return;

    if (button.classList.contains('m-cancel')) {
        pending?.cancel();
        pending = null;
        setMenuBusy(false);
        setStatus('');
        return;
    }

    switch (button.dataset.mode) {
        case 'single':
            startGame(settingsFromUrl());
            break;
        case 'quick':
            lobbyEl.style.display = 'none';
            stopRoomPoll();
            runPending(quickMatch(setStatus));
            break;
        case 'lobby': {
            const open = lobbyEl.style.display === 'none';
            lobbyEl.style.display = open ? '' : 'none';
            if (open) startRoomPoll();
            else stopRoomPoll();
            break;
        }
        case 'host':
            runPending(hostLobby(setStatus));
            break;
        case 'refresh':
            void refreshRoomList();
            break;
    }
});

// load generated unit models (Ballista GLB, etc.) before any match can start
await preloadUnitVisuals();

// reload mid-match: multiplayer reconnects via peer, single-player from local save
setGameLayerVisible(false);
const mpMarker = loadResumeMarker();
const spSave = loadSinglePlayer();
if (mpMarker) {
    void attemptResume(mpMarker);
} else if (spSave) {
    if (spSave.version !== GAME_VERSION) clearSinglePlayer();
    else resumeSinglePlayer(spSave);
} else {
    // ?room=mangoo — join that host's room directly
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) {
        lobbyEl.style.display = '';
        startRoomPoll();
        runPending(joinLobby(roomParam, setStatus));
    }
}
