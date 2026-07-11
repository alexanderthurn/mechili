import { Application, Container, Text } from 'pixi.js';
import { Game } from './game/game';
import { GAME_VERSION, hostRoom, joinRoom, makeRoomCode, quickMatch, type NetSession, type Pending } from './game/net';
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
    if (seed > 0) settings.seed = seed; // reproducible match (AI plays identically)
    return settings;
}

// layered setup: three.js world canvas below, transparent Pixi UI canvas on top
const wrapper = document.createElement('div');
wrapper.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const threeCanvas = document.createElement('canvas');
threeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
wrapper.appendChild(threeCanvas);

// the wrapper must be in the DOM before init so resizeTo measures its real size
document.body.appendChild(wrapper);

const app = new Application();
await app.init({ backgroundAlpha: 0, resizeTo: wrapper, antialias: true });
// don't touch width/height styles — Pixi's resize handling owns those
app.canvas.style.position = 'absolute';
app.canvas.style.inset = '0';
wrapper.appendChild(app.canvas);

// --- title (pixi) ---
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

// --- main menu (html overlay) ---
const style = document.createElement('style');
style.textContent = menuStyles();
document.head.appendChild(style);

const menu = document.createElement('div');
menu.className = 'mechili-menu';
menu.innerHTML = `
    <button class="m-btn" data-mode="single">Single Player</button>
    <button class="m-btn" data-mode="quick">Matchmaking</button>
    <button class="m-btn" data-mode="custom">Custom Server</button>
    <div class="m-custom" style="display:none">
        <button class="m-btn m-small" data-mode="create">Create Room</button>
        <div class="m-join">
            <input class="m-input" maxlength="12" placeholder="room code" spellcheck="false" />
            <button class="m-btn m-small" data-mode="join">Join</button>
        </div>
    </div>
    <div class="m-status" style="display:none"></div>
    <button class="m-btn m-small m-cancel" style="display:none">Cancel</button>
`;
wrapper.appendChild(menu);

const customEl = menu.querySelector<HTMLDivElement>('.m-custom')!;
const statusEl = menu.querySelector<HTMLDivElement>('.m-status')!;
const cancelEl = menu.querySelector<HTMLButtonElement>('.m-cancel')!;
const inputEl = menu.querySelector<HTMLInputElement>('.m-input')!;

let started = false;
let pending: Pending | null = null;

function setStatus(text: string): void {
    statusEl.style.display = text ? '' : 'none';
    statusEl.textContent = text;
    cancelEl.style.display = text ? '' : 'none';
}

function startGame(settings: GameSettings, net: NetSession | null = null, side: 'a' | 'b' = 'a'): void {
    if (started) return;
    started = true;
    app.renderer.off('resize', layoutTitle);
    title.destroy({ children: true });
    menu.remove();
    new Game(app, threeCanvas, wrapper, settings, net, side);
}

/** the connection is up — the host deals the seed, the guest receives it */
async function beginNetGame(session: NetSession): Promise<void> {
    if (session.role === 'host') {
        const settings = settingsFromUrl();
        settings.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
        session.send({ type: 'setup', version: GAME_VERSION, seed: settings.seed, settings });
        startGame(settings, session, 'a');
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
        startGame(settings, session, 'b');
    }
}

function runPending(p: Pending): void {
    pending = p;
    p.session
        .then((session) => {
            pending = null;
            void beginNetGame(session);
        })
        .catch((e: unknown) => {
            pending = null;
            if (String(e).includes('cancelled')) setStatus('');
            else setStatus(`Connection failed: ${e instanceof Error ? e.message : e}`);
        });
}

menu.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.m-btn');
    if (!button || started) return;
    switch (button.dataset.mode) {
        case 'single':
            startGame(settingsFromUrl());
            break;
        case 'quick':
            customEl.style.display = 'none';
            runPending(quickMatch(setStatus));
            break;
        case 'custom':
            customEl.style.display = customEl.style.display === 'none' ? '' : 'none';
            break;
        case 'create': {
            const code = makeRoomCode();
            runPending(hostRoom(code, setStatus));
            break;
        }
        case 'join': {
            const code = inputEl.value.trim();
            if (code) runPending(joinRoom(code, setStatus));
            break;
        }
    }
    if (button.classList.contains('m-cancel')) {
        pending?.cancel();
        pending = null;
        setStatus('');
    }
});
