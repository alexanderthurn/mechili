import { Application, Container, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { Game } from './game/game';
import {
    clearResumeMarker,
    clearSinglePlayer,
    fetchLobbyRooms,
    GAME_VERSION,
    handshake,
    hostLobby,
    joinLobby,
    loadResumeMarker,
    loadSinglePlayer,
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
wrapper.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const threeCanvas = document.createElement('canvas');
threeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
wrapper.appendChild(threeCanvas);

document.body.appendChild(wrapper);

const app = new Application();
await app.init({ backgroundAlpha: 0, resizeTo: wrapper, antialias: true });
app.canvas.style.position = 'absolute';
app.canvas.style.inset = '0';
wrapper.appendChild(app.canvas);

const title = new Container();
const heading = new Text({
    text: 'MECHILI',
    style: { fill: THEME.title, fontSize: 96, fontWeight: 'bold', letterSpacing: 12 },
});
heading.anchor.set(0.5);
title.addChild(heading);
app.stage.addChild(title);

function layoutTitle() {
    heading.position.set(app.screen.width / 2, app.screen.height / 2 - 140);
}
layoutTitle();
app.renderer.on('resize', layoutTitle);

const style = document.createElement('style');
style.textContent = menuStyles();
document.head.appendChild(style);

const menu = document.createElement('div');
menu.className = 'mechili-menu';
menu.innerHTML = `
    <button class="m-btn" data-mode="single">Single Player</button>
    <button class="m-btn" data-mode="quick">Matchmaking</button>
    <button class="m-btn" data-mode="lobby">Custom Room</button>
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
wrapper.appendChild(usernameEl);

const lobbyEl = menu.querySelector<HTMLDivElement>('.m-lobby')!;
const roomListEl = menu.querySelector<HTMLDivElement>('.m-room-list')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
const cancelEl = menu.querySelector<HTMLButtonElement>('.m-cancel')!;

let started = false;
let pending: Pending | null = null;
let roomPoll: ReturnType<typeof setInterval> | null = null;
let resumeOverlay: HTMLDivElement | null = null;
let resumeAbort: AbortController | null = null;

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
    usernameEl.textContent = getPlayerName();
}

function showNameEditor(): void {
    if (started || pending) return;
    const overlay = document.createElement('div');
    overlay.className = 'mechili-name-edit';
    overlay.innerHTML =
        `<div class="box">` +
        `<div>Choose your username</div>` +
        `<input maxlength="16" spellcheck="false" value="${getPlayerName()}" />` +
        `<div class="hint">Your username is your room code when hosting.</div>` +
        `<div class="actions">` +
        `<button type="button" data-act="cancel">Cancel</button>` +
        `<button type="button" class="primary" data-act="save">Save</button>` +
        `</div></div>`;
    const input = overlay.querySelector('input')!;
    input.select();
    overlay.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
        if (act === 'cancel' || e.target === overlay) {
            overlay.remove();
            return;
        }
        if (act === 'save') {
            const next = validatePlayerName(input.value);
            if (!next) {
                input.style.borderColor = '#e83828';
                return;
            }
            setPlayerName(next);
            refreshUsernameLabel();
            overlay.remove();
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector<HTMLButtonElement>('[data-act="save"]')!.click();
        if (e.key === 'Escape') overlay.remove();
    });
    wrapper.appendChild(overlay);
    input.focus();
}

refreshUsernameLabel();
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
        roomListEl.innerHTML = others
            .map((r) => `<button type="button" class="m-room" data-room="${r.name}">${r.name}</button>`)
            .join('');
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
    hideResumeOverlay();
    resumeAbort?.abort();
    resumeAbort = null;
    app.renderer.off('resize', layoutTitle);
    title.destroy({ children: true });
    menu.remove();
    usernameEl.remove();
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
    if (net) wireReconnect(game, net);
    else wireSinglePlayerPersist(game);
}

/** checkpoints the action log so a browser reload can resume solo play */
function wireSinglePlayerPersist(game: Game): void {
    const persist = () => {
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
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', persist);
    persist();
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
                const first = await next.once();
                if (first.type === 'resume') {
                    next.send({ type: 'state', version: GAME_VERSION, ...game.exportResume() });
                }
                session = next;
                game.resumeWith(next);
            } catch {
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
    showResumeOverlay(
        'Reconnecting…',
        'Waiting for your opponent and restoring the match.',
        () => {
            ac.abort();
            hideResumeOverlay();
            menu.style.display = '';
            usernameEl.style.display = '';
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

// reload mid-match: multiplayer reconnects via peer, single-player from local save
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
