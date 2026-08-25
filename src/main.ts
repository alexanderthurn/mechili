import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
import type { LoggedAction } from './game/actions';
import { CHAT_COOLDOWN_MS, CHAT_TEXT_LIMIT, emoteById, type ChatItem } from './game/emotes';
import { ChatBar } from './ui/chatBar';
import { ChatFloat } from './ui/chatFloat';
import { FriendsPanel } from './ui/friendsPanel';
import {
    introRosterEntries,
    mountIntroRoster,
    prefetchIntroRosterMmrs,
} from './ui/introRoster';
import { Game } from './game/game';
import { fetchMatchReplay, type MatchMode, type MatchResult, type MatchTelemetry } from './game/telemetry';
import { ReplayControls } from './ui/replayControls';
import { GamepadCursor } from './engine/gamepadCursor';
import { CameraRig } from './engine/cameraRig';
import {
    clearSinglePlayer,
    clearStarResumeMarker,
    fetchLobbyRooms,
    getPeerServerConfig,
    setPeerServerConfig,
    type RoomAd,
    type RoomRosterEntry,
    GAME_VERSION,
    formatGameVersion,
    hostStarRoom,
    isMelodanPlayHost,
    joinAsSpectator,
    joinStarRoom,
    loadSinglePlayer,
    loadStarResumeMarker,
    lookupSpectateEndpoint,
    saveSinglePlayer,
    STAR_RESUME_AUTO_MS,
    STAR_RESUME_HEARTBEAT_MS,
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
    type SpectatorLink,
    type StarGuestSession,
    type StarRole,
} from './game/net';
import * as sebNative from 'steam-electron-build/native';
import {
    advertiseSteamRoom,
    joinSteamAsSpectator,
    SteamSpectatorTransport,
    hostOrJoinSteamStar,
    hostSteamStarRoom,
    joinSteamLobby,
    onSteamJoinRequested,
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
import { activeLoadout, normalizeLoadout, randomLoadout } from './game/loadouts';
import { createLoadoutPanel } from './ui/loadoutPanel';
import {
    SETTINGS_SAV_EXCLUDE,
    USER_AVATAR_STEAM_KEY,
    USER_STORAGE_PREFIX,
    migrateUserStorage,
} from './game/userStorage';
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
function normalizeCustomGameMode(mode: CustomGameMode | '1v1ai' | undefined): CustomGameMode {
    if (mode === '1v1ai') return '1v1';
    return mode ?? DEFAULT_CUSTOM_GAME.mode;
}

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
            // '1v1ai' was a Custom Game option once; hosting 1v1 and clicking
            // "Start with AI" is the same thing, so a stored one lands on 1v1
            // rather than a mode with no button behind it.
            mode: normalizeCustomGameMode(parsed.mode),
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
/**
 * A stable id for THIS machine, kept in a file Steam never syncs.
 *
 * `machine.json` is deliberately not a `.sav`, so Auto-Cloud's `*.sav` rule
 * skips it — which is the whole point: an id that travelled with the cloud
 * would identify the account, not the device.
 */
async function machineId(): Promise<string> {
    const FILE = 'machine.json';
    try {
        const stored = (await storage.load(FILE)) as { id?: unknown };
        if (typeof stored?.id === 'string' && stored.id) return stored.id;
    } catch {
        /* first run, or unreadable */
    }
    const id = Math.random().toString(36).slice(2, 10);
    try {
        await storage.save({ id }, FILE);
    } catch {
        /* unwritable: a fresh id each launch is still better than colliding */
    }
    return id;
}

// Web uses localStorage directly — mirrorLocalStorage is a no-op without
// window.electronStorage (and may be missing on older steam-electron-build).
//
// settings = prefs / graphics / misc  ·  user.sav = name + avatar
// Auth (mechili-open-auth) stays local-only: a bearer credential, not a setting.
if (isElectron()) {
    // settings-<appid>-<machine>-<branch>.sav — every combination keeps its own
    // file, so switching branches or machines restores what that one had rather
    // than losing it. Scoped this way because Steam Cloud
    // otherwise has several writers fighting over one filename: the playtest
    // and the full app share cloud storage but track changes independently, and
    // a second device adds another. Both discriminators earn their place —
    // the app id keeps a playtest's settings out of the release, and the
    // machine id is what stops a desktop's render scale, a laptop's UI scale
    // and a Steam Deck's fullscreen from overwriting each other. They are
    // per-device settings by nature, so this is also just correct.
    //
    // Still a `.sav`, so each machine's file is still backed up to the cloud —
    // it simply cannot collide with anyone else's.
    //
    // Identity (user.sav) is deliberately NOT scoped: a name and avatar should
    // follow the player to a new machine and from the playtest into the full
    // game. Keep it that way by putting anything experimental in the settings
    // namespace, which is isolated, rather than under mechili-user-.
    // Steam reports 0 when Steamworks did not initialise — the client is not
    // running, or the app was started straight from the folder. Falling back to
    // the id this build was MADE for keeps those launches on the same settings
    // file as a normal one; without it the same install silently swaps to
    // `settings-0-…` whenever Steam is closed, so settings would look reset and
    // then drift apart. A playtest binary started outside Steam lands on the
    // configured id too — the playtest id only ever arrives from Steam, and
    // there is nothing else to tell them apart by.
    const appId = (steam.isAvailable() ? await steam.getAppId() : 0) || __STEAM_APP_ID__;
    // The beta branch is part of the identity too. Prefs now sanitise every key
    // on load, so a value from a build that knows more settings than this one
    // is clamped rather than adopted — but clamping is lossy: `develop` writing
    // a finer render scale comes back as the nearest one the release build has,
    // and then gets written back at that value. Keeping the branches apart lets
    // each keep its own answer. The cost is that a branch starts from defaults
    // the first time it is used, and remembers from then on.
    // sanitised: a branch name is Steam's string, not ours, and it is going
    // into a filename (getSavePath only strips directories, so a slash would
    // silently mangle the name rather than fail)
    const branch = ((steam.isAvailable() ? await steam.getCurrentBetaName() : null) || 'default')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .slice(0, 32);
    await mirrorLocalStorage({
        file: `settings-${appId}-${await machineId()}-${branch}.sav`,
        prefix: 'mechili-',
        // Whole identity namespace, so a new mechili-user-* key cannot land in
        // both files; the exact list stays for legacy names and the auth token.
        excludePrefix: USER_STORAGE_PREFIX,
        exclude: [...SETTINGS_SAV_EXCLUDE],
    });
    // Identity is scoped by app and branch, but NOT by machine: a custom avatar
    // should still follow the player to another PC.
    //
    // The app id is what actually ends the conflicts. Both app ids wrote one
    // user.sav in one folder while Steam tracked change numbers per app, so
    // each app's write looked like tampering to the other — and one conflicted
    // file blocks that app's entire upload, settings included.
    //
    // It costs almost nothing here, because under Steam identity is re-derived
    // every launch anyway: the display name is overwritten from the Steam
    // persona (see below) and the avatar is re-fetched. Only a custom uploaded
    // avatar fails to carry from the playtest into the full game.
    await mirrorLocalStorage({
        file: `user-${appId}-${branch}.sav`,
        prefix: USER_STORAGE_PREFIX,
        // The cached Steam avatar stays local. It is ~120 KB of base64 that
        // Steam hands us again on request, so syncing it bought nothing and
        // cost plenty: user.sav is shared by every app id on purpose, and a
        // quarter-megabyte rewritten whenever the avatar is re-read is exactly
        // the kind of frequent, shared write that produces cloud conflicts. A
        // CUSTOM avatar (USER_AVATAR_KEY) still syncs — that one is the
        // player's own and cannot be recovered from anywhere else.
        exclude: [USER_AVATAR_STEAM_KEY],
    });
}
migrateUserStorage();

// The zoom lives in the main process, so the saved preference has to be pushed
// there on every launch — otherwise it only takes effect when someone changes it.
if (isElectron()) void win.setUiScale(prefs().uiScale);

// Steam keeps presence for the session, so a crash mid-lobby can leave friends
// looking at a Join button for a room that died with it. Start from clean.
updateSteamPresence('menu');

// Closing the window mid-match is giving up, not a dropped connection: say so
// over the wire first, so the others resolve immediately instead of waiting out
// a reconnect grace window for someone who has quit. In a lobby the same click
// means leaving it — as host that takes the room down, as guest it frees the
// seat — which is exactly what Cancel already does.
/** Leave whatever we are in, deliberately, before this client disappears. */
function sayGoodbye(): void {
    if (activeGame) activeGame.voluntaryQuit();
    else if (isSessionBusy()) cancelMenuPending();
}

if (isElectron()) {
    void win.wantsQuitHook();
    win.onBeforeQuit(() => {
        void (async () => {
            try {
                sayGoodbye();
                // Sends are asynchronous (IPC for Steam, a data channel for
                // PeerJS) — give them a moment to actually leave.
                await new Promise((resolve) => setTimeout(resolve, 300));
            } finally {
                void win.confirmQuit();
            }
        })();
    });
}

// A tab going away is NOT necessarily deliberate: `pagehide` fires for a reload
// exactly as it does for a close, so this must not report a quit — see
// Game.leaveForPageHide, which drops a guest's link (fast suspend, seat held)
// instead of forfeiting the match on F5.
// pagehide, not beforeunload: it also fires when a tab is discarded or the page
// is put into the back/forward cache, and it is the one the browser still runs
// work from. Nothing can be awaited here — the send is best-effort.
window.addEventListener('pagehide', () => {
    if (activeGame) activeGame.leaveForPageHide();
    else if (isSessionBusy()) cancelMenuPending();
});

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

/**
 * Every piece of menu chrome lives in here — the menu panel, the corner
 * chips, the lobby chat, the friends panel.
 *
 * It exists so there is ONE thing to show, hide, remove and re-append.
 * These used to be nine siblings on `wrapper`, hand-listed in three
 * different places (visibility, the strip on match start, the re-append on
 * return); the lists had already drifted apart, and adding a tenth element
 * meant remembering all three — which is exactly how the Unit loadout chip
 * ended up hanging over a running match.
 *
 * Full-bleed but `pointer-events: none`, so it never eats clicks meant for
 * the 3D scene behind it; children opt back in via CSS. It sets no
 * z-index, so it creates no stacking context and its children keep
 * competing globally exactly as they did as siblings.
 */
const menuChromeEl = document.createElement('div');
menuChromeEl.className = 'mechili-menu-chrome';
menuChromeEl.style.display = 'none';
wrapper.appendChild(menuChromeEl);

const versionEl = document.createElement(isMelodanPlayHost() ? 'a' : 'div');
versionEl.className = 'mechili-version';
versionEl.style.zIndex = '30';
versionEl.textContent = `v${__APP_VERSION__}`;
if (versionEl instanceof HTMLAnchorElement) {
    versionEl.target = '_blank';
    versionEl.rel = 'noopener noreferrer';
    versionEl.classList.add('link');
}
menuChromeEl.appendChild(versionEl);

/** PLAYTEST wordmark under the logo. HTML rather than a Pixi Text so it can sit
 *  above the menu panel — the menu is an HTML overlay, so canvas always loses. */
const playtestEl = document.createElement('div');
playtestEl.className = 'mechili-playtest';
playtestEl.textContent = 'PLAYTEST';
playtestEl.style.display = 'none';
menuChromeEl.appendChild(playtestEl);

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
/** MMR map prefetched on the intro cover — consumed once by the next Game. */
let pendingIntroRosterMmr: Map<string, number> | null = null;
/** Pause on the filled roster before the menu dive / 3D handoff. */
const INTRO_ROSTER_HOLD_MS = 2000;

function introRosterHold(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, INTRO_ROSTER_HOLD_MS));
}

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

/** menu→match cover — CSS animation on the compositor (survives sync Game boot) */
function showIntroCover(deferDive = false): void {
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
    if (!deferDive) startIntroCoverDive();
}

function startIntroCoverDive(): void {
    introCoverEl?.classList.add('dive');
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
                <!-- settings first: a guest reads what they are agreeing to, THEN
                     confirms. (The host never sees the ready row — see
                     showHostLobbySettings — so this ordering only shows up there.) -->
                <button class="m-lobby-settings-toggle" style="display:none" type="button">Advanced settings ▸</button>
                <label class="m-lobby-ready-row" style="display:none">
                    <input type="checkbox" class="m-lobby-ready-check">
                    I'm ready
                </label>
                <button class="m-btn m-small" data-mode="startstar" style="display:none">Start</button>
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
menuChromeEl.appendChild(menu);
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
const usernameAvatarEl = document.createElement('img');
usernameAvatarEl.className = 'u-avatar';
usernameAvatarEl.alt = '';
usernameAvatarEl.hidden = true;
const usernameTextEl = document.createElement('span');
usernameTextEl.className = 'u-name';
usernameEl.append(usernameAvatarEl, usernameTextEl);
menuChromeEl.appendChild(usernameEl);

// Wide screens only (CSS decides — see .mechili-loadout-btn): a direct route
// to the loadout screen, sitting above the username chip and wearing the
// same chip styling. Under the breakpoint the corner is already crowded, so
// the profile dialog's "Unit loadout" button remains the route there.
const loadoutCornerEl = document.createElement('button');
loadoutCornerEl.className = 'mechili-username mechili-loadout-btn';
loadoutCornerEl.type = 'button';
loadoutCornerEl.style.zIndex = '30';
loadoutCornerEl.innerHTML = `<span class="u-name">Unit loadout</span>`;
loadoutCornerEl.addEventListener('click', () => {
    if (started || pending) return;
    menuChromeEl.style.display = 'none';
    loadoutPanel.open();
});
menuChromeEl.appendChild(loadoutCornerEl);

// Top-right menu chrome: door (Electron quit) + settings gear.
const cornerActionsEl = document.createElement('div');
cornerActionsEl.className = 'mechili-corner-actions';

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
menuChromeEl.appendChild(cornerActionsEl);

// suggest chip, top-left (same language as username button)
const suggestCornerEl = document.createElement('button');
suggestCornerEl.className = 'mechili-suggest-btn';
suggestCornerEl.type = 'button';
suggestCornerEl.textContent = 'Report bug';
suggestCornerEl.title = 'Report bug';
suggestCornerEl.addEventListener('click', () => {
    openSuggest({ parent: wrapper, source: 'game menu' });
});
menuChromeEl.appendChild(suggestCornerEl);

let menuGamepad: GamepadCursor | null = null;
let menuGamepadRig: CameraRig | null = null;

function setMenuChromeVisible(visible: boolean): void {
    menuChromeVisible = visible;
    const display = visible ? '' : 'none';
    // One toggle for the whole set — see menuChromeEl. Only elements that
    // must stay hidden even while the chrome IS up keep their own rule.
    menuChromeEl.style.display = display;
    // still its own: layoutTitle measures the panel by toggling this
    menu.style.display = display;
    playtestEl.style.display = visible && isPlaytest ? '' : 'none';
    // Door only in Electron.
    exitDesktopEl.style.display = visible && isElectron() ? '' : 'none';
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

onPrefsChange(() => {
    if (roomPoll) void refreshRoomList();
});

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
// Loadout screen: a full-screen 3D stage with floating UI, so it is its own
// overlay on the wrapper rather than a view inside the menu frame. Hidden
// until opened from the profile dialog.
const loadoutPanel = createLoadoutPanel(() => {
    menuChromeEl.style.display = '';
});
wrapper.appendChild(loadoutPanel.el);

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
/**
 * The room this client is hosting, if any — cleared when leaving session
 * unexpectedly. One slot for every transport: what differs between them is
 * only how the room was opened and how it is torn down, both captured here,
 * so the lobby wiring below never asks which transport it is running on.
 */
type HostedRoom = {
    hub: HostHub;
    /** room name (web/LAN) or Steam lobby id — for status text and rejoin */
    id: string;
    transport: 'matchmaking' | 'lan' | 'steam';
    /** web/LAN: tell the backend the room is gone. Steam lobbies need nothing. */
    cleanup?: () => void;
    /** LAN: stop the UDP announce. Deliberately separate from cleanup — see cancelHost. */
    stopDiscovery?: () => void;
};
let hosting: HostedRoom | null = null;
/**
 * The room advertisement teardown that has to OUTLIVE `hosting`.
 *
 * `hosting` is cleared the moment a match starts (ownership of the hub passes
 * to the Game), which is deliberately NOT when discovery should stop — a LAN
 * room's local PeerServer must survive that handoff so a dropped guest can
 * redial through it. But nulling `hosting` there also threw away the only
 * reference to `stopDiscovery`, so nothing stopped the UDP announce when the
 * match finally ended: the host kept broadcasting a room that no longer
 * existed, and other LAN players saw a phantom entry they could click but
 * never join. Kept here so returning to the menu can finish the job.
 */
let stopHostDiscovery: (() => void) | null = null;
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
    return !!(pending || hosting);
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

/** Custom Game's mode (1v1/2v2/2v2ai) is now fixed at the moment
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
    // The shape of the match is decided once, before any transport is chosen:
    // which layout, which roster, how many humans to wait for. Deriving these
    // inside each transport branch is what once let Steam open a four-seat
    // 2v2 lobby for a one-seat layout while web/LAN routed it correctly.
    const is1v1 = cfg.mode === '1v1';
    const layout: '1v1' | '2v2' = is1v1 ? '1v1' : '2v2';
    const buildRoster = is1v1 ? initial1v1Roster : initialStarRoster;
    // 2v2ai waits for one human ally; the other two seats become AI at Start.
    const waitForJoined = cfg.mode === '2v2' ? 4 : 2;

    void (async () => {
        const transport = await resolveMultiplayerTransport();
        if (!transport) {
            setStatus(transportUnavailableMessage());
            return;
        }
        if (transport === 'steam') {
            setStatus('Opening Steam lobby…');
            await beginHost({
                transport: 'steam',
                customConfig: cfg,
                waitForJoined,
                isPublic: true,
                offerAiStart: true,
                buildRoster,
                mode: layout,
            });
            return;
        }
        const discovery = transport === 'lan' ? 'lan' : 'matchmaking';
        setStatus(
            discovery === 'lan' ? 'Opening LAN room…' : 'Opening room…',
        );
        await beginHost({ transport: discovery, horde: false, waitForJoined, customConfig: cfg, buildRoster, mode: layout, offerAiStart: true });
    })();
}

let started = false;
/** true after 3D assets finish loading — match starts wait for this */
let bootReady = false;
let roomPoll: ReturnType<typeof setTimeout> | null = null;
let resumeOverlay: HTMLDivElement | null = null;
let activeGame: Game | null = null;
let stopSinglePlayerPersist: (() => void) | null = null;
/** stops the star resume marker's heartbeat (see the guest branch of constructGame) */
let stopStarResumeHeartbeat: (() => void) | null = null;
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
        `<button type="button" class="profile-loadout" data-act="loadout">Unit loadout</button>` +
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
        // every button in the dialog, not just the .actions pair — the Edit
        // Loadout button lives outside that row and saves on its way out, so
        // it must not stay clickable while a save is already in flight
        overlay.querySelectorAll('button').forEach((b) => {
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

    /** @returns true once the edit was accepted and the dialog closed. */
    const save = async (): Promise<boolean> => {
        const next = steamLocked ? getPlayerName() : validatePlayerName(nameInput.value);
        if (!next) {
            nameInput.style.borderColor = '#e83828';
            setError('Name must be 2–16 letters, numbers, _ or -.');
            return false;
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
        return true;
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
        if (act === 'loadout') {
            // save first, then navigate — leaving through this button must not
            // silently discard a name/avatar edit the player already made
            void save().then((saved) => {
                // a rejected name leaves the dialog open — navigating anyway
                // would strand the overlay on top of the loadout screen
                if (!saved) return;
                // the loadout screen takes over the whole viewport, so the
                // whole menu chrome steps aside until it closes
                menuChromeEl.style.display = 'none';
                loadoutPanel.open();
            });
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
        // "Cancel" only makes sense while there is something in flight to
        // cancel. On a terminal message ("Host closed the room.", a version
        // mismatch, a rejection) the room is already gone and the button is
        // just a dismiss — offering to cancel it reads as if leaving were
        // still a choice the player had to make.
        cancelEl.textContent = isSessionBusy() ? 'Cancel' : 'OK';
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

/**
 * Lobby chat — the match chat, one step earlier.
 *
 * Deliberately the SAME `{type:'chat'}` NetMessage the running match uses, over
 * the same host connection, so this needs no backend and behaves identically on
 * every transport (web, LAN, Steam): whoever can play together can talk. It
 * replaces the old php-backed global chat, which sat in this exact spot in the
 * menu while showing messages from strangers rather than the people you were
 * about to play with.
 *
 * Available as soon as there is a room at all — the moment a host opens one, or
 * a guest is admitted — not just once the match starts.
 */
/**
 * Bottom-centered over the menu rather than inside the session panel — the
 * same place the match puts its chat, so it does not move when the lobby's
 * roster grows or its settings panel opens.
 */
/** Steam friends + direct invites, opened from an empty seat (see inviteToHostedRoom) */
const friendsPanel = new FriendsPanel();
menuChromeEl.appendChild(friendsPanel.el);

const lobbyChatEl = document.createElement('div');
lobbyChatEl.className = 'mechili-lobby-chat';
lobbyChatEl.style.display = 'none';
menuChromeEl.appendChild(lobbyChatEl);
// The match's own two pieces, unchanged: lines pop above the bar and fade,
// and the bar itself collapses to a "Chat" strip. Same components, so a
// message looks the same whether it arrives while waiting or mid-battle.
const lobbyChatFloat = new ChatFloat(true);
const lobbyChatBar = new ChatBar({ onSend: (item) => sendLobbyChat(item), inline: true });
lobbyChatEl.append(lobbyChatFloat.el, lobbyChatBar.el);
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

function appendLobbyChat(name: string, item: ChatItem, role: 'player' | 'system' = 'player'): void {
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
function showLobbyChat(send: (item: ChatItem) => void): void {
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
function announceLobbySystem(text: string, hub: HostHub): void {
    const item: ChatItem = { kind: 'text', text };
    appendLobbyChat('', item, 'system');
    hub.broadcast({ type: 'chat', item, from: { name: '', role: 'system' } });
}

/** the pending hand-off, consumed once */
function takeLobbyChatCarry(): LobbyChatEntry[] {
    const carry = lobbyChatCarry;
    lobbyChatCarry = [];
    return carry;
}

/** Incoming rate limit, mirroring the match's own receive-side clamp: the
 *  sender's cooldown is enforced by a client we do not control. */
function acceptLobbyChatFromPeer(): boolean {
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
    // The chat belongs to the room, so it ends exactly where the room does —
    // hooked here rather than at all nine call sites, since this function is
    // already the "a lobby just ended" signal (see the doc comment above).
    clearLobbyChat();
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
    /** host only: pull someone into a still-open seat (see inviteToHostedRoom) */
    onInvite?: () => void,
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
                invite.title = 'Invite a friend';
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
 * Bring someone into the room we are hosting, by whatever means this transport
 * has. Rooms stay public either way — this is an extra door, not a switch to
 * invite-only (the Matchmaking screen's own "+ Invite a Friend" is the flow
 * that deliberately hosts privately).
 */
function inviteToHostedRoom(): void {
    if (!hosting) return;
    if (hosting.transport === 'steam') {
        // Our own friends list rather than Steam's overlay picker: the picker
        // shows only what Steam is willing to list (often nobody, on a
        // playtest) and tells us nothing about whether it opened, so a player
        // was left staring at a panel that never appeared. The overlay is
        // still one click away inside the panel.
        friendsPanel.show();
        return;
    }
    if (hosting.transport === 'lan') {
        setStatus('Your room is on the local network — friends: Settings → Multiplayer → LAN, then Matchmaking.', 6000);
        return;
    }
    // web: the room is found by the host's name, so a link is the invite
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(getPlayerName())}`;
    void navigator.clipboard
        ?.writeText(link)
        .then(() => setStatus('Room link copied — send it to your friend.', 5000))
        .catch(() => setStatus(`Send this to your friend: ${link}`, 8000));
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

/** Ads behind the rendered buttons — the click handler needs the transport
 *  handle (peer server, lobby id) that a dataset attribute cannot carry. */
const roomAdsByKey = new Map<string, RoomAd>();

async function refreshRoomList(): Promise<void> {
    let transport: MultiplayerTransport | null = null;
    let foundRooms = false;
    try {
        transport = await resolveMultiplayerTransport();
        const scope = roomListScopeLabel(transport);
        setRoomsListHeading(scope);
        if (!transport) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.textContent = `No open ${scope} Games`;
            scheduleLayoutTitle();
            return;
        }

        const ads = await listRoomAds(transport);
        foundRooms = ads.length > 0;
        if (!foundRooms) {
            roomListEl.className = 'm-room-list empty';
            roomListEl.textContent = `No open ${scope} Games`;
            scheduleLayoutTitle();
            return;
        }
        roomListEl.className = 'm-room-list';
        // Our own record of the match we dropped out of, trusted ahead of the
        // published seats: right after a restart the host has not yet noticed
        // the drop, and on a transport whose seats never arrive it is the only
        // signal there is.
        const resumeMarker = loadStarResumeMarker();
        const mine = getPlayerName().toLowerCase();
        // names come from other clients — build via DOM, never innerHTML
        roomListEl.replaceChildren(
            ...ads.map((ad) => {
                const button = document.createElement('button');
                button.type = 'button';
                const myDroppedSeat = ad.seats?.find(
                    (seat) => seat.name.toLowerCase() === mine && !seat.connected,
                );
                const markedByUs =
                    !!resumeMarker && resumeMarker.hostName.toLowerCase() === ad.name.toLowerCase();
                const rejoinable = !!myDroppedSeat || markedByUs;
                // Watchable only when the room says so AND we are not the one
                // who belongs in it — a rejoin beats spectating our own match.
                const watch = !!ad.spectate && !rejoinable;
                button.className = watch ? 'm-room m-room-spectate' : 'm-room';
                button.dataset.room = ad.name;
                button.dataset.roomMode = ad.mode;
                button.dataset.roomKind = watch ? 'spectate' : 'join';
                button.dataset.roomKey = ad.key;
                const modeTag = ad.mode === '2v2' ? ' (2v2)' : '';
                const roundTag = ad.round ? ` — round ${ad.round}` : '';
                button.textContent = watch
                    ? `Watch ${ad.name}${modeTag}${roundTag}`
                    : `${ad.name}${modeTag}${rejoinable ? roundTag : ''}`;
                roomAdsByKey.set(ad.key, ad);
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
    stopStarResumeHeartbeat?.();
    clearStarResumeMarker();
    clearSinglePlayer();
    try {
        sessionStorage.removeItem('mechili-desync-guard');
    } catch {
        /* ignore */
    }
}

/** Stop advertising a room we hosted, once and only once (see stopHostDiscovery). */
function runStopHostDiscovery(): void {
    const stop = stopHostDiscovery;
    stopHostDiscovery = null;
    stop?.();
}

/** tear down an active match and bring back the pre-game menu (no page reload) */
function finishReturnToMenu(): void {
    friendsPanel.hide();
    takeLobbyChatCarry();   // nothing pending can belong to a future match
    stopSinglePlayerPersist?.();
    stopSinglePlayerPersist = null;
    updateSteamPresence('menu');
    clearMatchResumeData();
    activeGame?.destroy();
    activeGame = null;
    // The match is over, so the room it was advertising is really gone now —
    // this is the point the LAN announce (and its local PeerServer, needed
    // right up until here for redials) should stop.
    try {
        runStopHostDiscovery();
    } catch (e) {
        console.error('finishReturnToMenu: stopDiscovery() failed', e);
    }
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
    cancelHost();
    // one container, so nothing can be forgotten here (see menuChromeEl)
    wrapper.appendChild(menuChromeEl);
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
        session: SpectatorLink;
        watcherName: string;
        initial: { actions: LoggedAction[]; battleElapsed: number | null; phaseRemaining: number };
    } | null,
    useIntro: boolean,
): Game {
    const preloadedRosterMmr = pendingIntroRosterMmr;
    pendingIntroRosterMmr = null;
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
        preloadedRosterMmr ?? undefined,
    );
    activeGame = game;
    // a conversation that started while waiting continues into the match
    game.seedChatHistory(takeLobbyChatCarry());
    // Steam/LAN have no cloud backend to register with, so the running match
    // advertises itself through the same channel the lobby used — that is what
    // makes a match watchable (and its round visible) on those transports.
    // Captured, not read later: startHostedMatch clears `hosting` as soon as the
    // Game owns the hub, while the spectator hub opens asynchronously — reading
    // the variable at fire time would always find null and publish nothing.
    const adRoom = hosting;
    // Spectating rides the same network the match itself is on. Steam matches
    // must not depend on the PeerJS broker being reachable — that is exactly
    // the reliability the Steam transport exists to avoid.
    game.onCreateSpectatorTransport =
        adRoom?.transport === 'steam' ? () => SteamSpectatorTransport.open() : null;
    game.onLiveRoomAd = (ad) => {
        if (!adRoom) return;
        if (adRoom.transport === 'steam') {
            void advertiseSteamRoom({ seats: ad.roster, round: ad.round, spectate: ad.spectate });
        } else if (adRoom.transport === 'lan') {
            void lan.updateHost({
                data: {
                    mode: ad.roster.length > 2 ? '2v2' : '1v1',
                    seats: ad.roster,
                    round: ad.round,
                    spectate: ad.spectate,
                },
            });
        }
    };
    wireGameMenuReturn(game);
    if (net) wireReconnect(game, net);
    else if (!star && !replay && !spectate) stopSinglePlayerPersist = wireSinglePlayerPersist(game);
    if (replayControlsPanel) {
        game.onSpeedIndexChange = (index) => replayControlsPanel!.setSpeedIndex(index);
    }
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
        session: SpectatorLink;
        watcherName: string;
        initial: { actions: LoggedAction[]; battleElapsed: number | null; phaseRemaining: number };
    } | null = null,
): void {
    if (started) return;
    started = true;
    destroyMenuGamepadCursor();
    // setMenuChromeVisible(false) is never called anywhere
    // (menuChromeEl.remove() below tears the chrome down permanently
    // instead) — without this, the
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
    menuChromeEl.remove();

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
        if (hostName) {
            // Record how we got in, not just who hosted: a fresh process has no
            // LAN signaling server configured and cannot dial a Steam lobby by
            // host name at all.
            const lobbyId = steamLobbyIdOf(star.session);
            const marker = {
                hostName,
                names,
                transport: (lobbyId ? 'steam' : getPeerServerConfig() ? 'lan' : 'matchmaking') as
                    'steam' | 'lan' | 'matchmaking',
                lobbyId: lobbyId ?? undefined,
                peerServer: getPeerServerConfig(),
            };
            saveStarResumeMarker(marker);
            // Re-stamped while the match runs so `savedAt` means "last seen
            // alive". Written once, it recorded when the match STARTED, which
            // says nothing about how long ago the tab went away — a twenty
            // minute match looks twenty minutes stale a second after a reload.
            // A heartbeat makes the age usable for deciding whether an
            // automatic rejoin still makes sense, and it covers a crash, which
            // gets no chance to say goodbye.
            stopStarResumeHeartbeat?.();
            const heartbeat = setInterval(() => saveStarResumeMarker(marker), STAR_RESUME_HEARTBEAT_MS);
            stopStarResumeHeartbeat = () => {
                clearInterval(heartbeat);
                stopStarResumeHeartbeat = null;
            };
        }
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
    // Fresh matches: roster rides the CSS cover and dissolves with it into 3D.
    // Resume/reconnect skips the roster (cover may already be animating).
    const showCoverRoster = !resume;

    if (!coverActive) {
        showIntroCover(showCoverRoster);
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

    const runBootHandoff = (): void => {
        if (coverActive) {
            bootWithHandoff();
        } else {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => bootWithHandoff());
            });
        }
    };

    if (showCoverRoster && introCoverEl) {
        const entries = introRosterEntries(settings, side, names, star);
        mountIntroRoster(introCoverEl, entries, side);
        void prefetchIntroRosterMmrs(introCoverEl, entries).then(async (mmrMap) => {
            if (gen !== introGen || !started) return;
            pendingIntroRosterMmr = mmrMap;
            await introRosterHold();
            if (gen !== introGen || !started) return;
            startIntroCoverDive();
            runBootHandoff();
        });
    } else {
        if (coverActive && introCoverEl && !introCoverEl.classList.contains('dive')) {
            startIntroCoverDive();
        }
        runBootHandoff();
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

// ---- online play (star topology — every mode, 1v1 included) -----------

/** host is always seat 0, side 'a'; the other 3 slots start open for joiners */
function initialStarRoster(hostName: string): CanonicalSeatDef[] {
    const avatar = getAvatarDataUrl() || undefined;
    return [
        { side: 'a', controller: 'human', name: hostName, avatar, loadout: activeLoadout() },
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
        { side: 'a', controller: 'human', name: hostName, avatar, loadout: activeLoadout() },
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

function cancelHost(): void {
    // cleanup() first, in its own try: it is the externally visible "room is
    // gone" signal (web/LAN send ?action=leave), and running hub.close() first
    // meant a throw from peer.destroy() aborted the whole function, leaving the
    // room listed until the backend's 15s TTL lapsed. Steam lobbies have no
    // cleanup — closing the hub leaves the lobby.
    try {
        hosting?.cleanup?.();
    } catch (e) {
        console.error('cancelHost: cleanup() failed', e);
    }
    // LAN's lan.stopHost(): deliberately NOT part of cleanup(), because
    // startHostedMatch reuses cleanup() at the point ownership passes to the
    // running Game, and the LAN signaling server must survive that handoff for
    // guests to redial later. Only an abandoned room stops advertising.
    try {
        runStopHostDiscovery();
    } catch (e) {
        console.error('cancelHost: stopDiscovery() failed', e);
    }
    try {
        hosting?.hub.close();
    } catch (e) {
        console.error('cancelHost: hub.close() failed', e);
    }
    hosting = null;
    updateSteamPresence('menu');
    starCustomConfig = null;
    startStarBtn.style.display = 'none';
    clearRosterTable();
    clearLobbySettings();
    friendsPanel.hide();    // nothing left to invite anyone to
    takeLobbyChatCarry();   // abandoned, not played — drop it
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
/**
 * What the friends list shows. Only meaningful under Steam, and only a Steam
 * lobby id gives friends a working Join Game button — a web/LAN room is not
 * something Steam can launch into, so those advertise presence without one.
 */
function updateSteamPresence(
    state: 'menu' | 'lobby' | 'match',
    opts: { lobbyId?: string | null; players?: number } = {},
): void {
    if (!steam.isAvailable()) return;
    if (state === 'menu') {
        void steam.clearPresence();
        return;
    }
    const status =
        state === 'match'
            ? 'In a match'
            : opts.players
              ? `In a lobby (${opts.players})`
              : 'In a lobby';
    void steam.setPresence({ status, lobbyId: opts.lobbyId ?? null, groupSize: opts.players });
}

/**
 * Publish the room to whichever discovery channel this transport uses, so the
 * list, Watch and rejoin work the same everywhere. The web backend is fed by
 * its own registration/heartbeat; only Steam and LAN need pushing, and both
 * carry the same small record (never avatars).
 */
function advertiseHostedRoom(opts: { round?: number; spectate?: string | null } = {}): void {
    if (!hosting) return;
    const seats = hosting.hub.currentRoster().map((seat, i) => ({
        name: seat.name,
        side: seat.side,
        connected: i === 0 || hosting!.hub.connectedSeats().includes(i),
    }));
    if (hosting.transport === 'steam') {
        void advertiseSteamRoom({ seats, round: opts.round, spectate: opts.spectate });
    } else if (hosting.transport === 'lan') {
        void lan.updateHost({
            data: {
                mode: seats.length > 2 ? '2v2' : '1v1',
                seats,
                round: opts.round,
                spectate: opts.spectate ?? undefined,
            },
        });
    }
}

/**
 * Lobby wiring for a hosted room: roster table, ready state, kick, AI-fill
 * countdown, auto-start and the join acceptor. Transport-agnostic — it only
 * touches HostHub — so quick-match, which creates its own hub, shares exactly
 * the same behaviour as beginHost.
 */
function wireHostedHub(
    hub: HostHub,
    opts: {
        hostName: string;
        waitForJoined?: number;
        offerAiStart?: boolean;
        mode?: '1v1' | '2v2';
        customConfig?: CustomGameConfig | null;
    },
): void {
    const hostName = opts.hostName;
    const waitForJoined = opts.waitForJoined ?? 2;
    const offerAiStart = opts.offerAiStart ?? true;
    const mode = opts.mode ?? '2v2';
    const customConfig = opts.customConfig ?? null;
    if (offerAiStart) {
        // shared with 2v2 (same button) since 1v1 now hosts through the
        // same star path — label it for whichever mode is actually running
        // instead of the old static "Start 2v2 Match" text 1v1 inherited
        // by accident
        // a previous lobby may have left this lit — refresh() below decides
        startStarBtn.classList.remove('is-go');
        startStarBtn.style.display = '';
    }
    // Who was in the room at the last refresh, so joins and leaves can be
    // announced by DIFFING the roster. Deliberately not driven by hub
    // callbacks: onSeatDropped does not fire on the PeerJS host's lobby-phase
    // drop path while it does on Steam's, so a diff here is the only version
    // that reads the same on every transport. Seeded from the starting roster
    // so the first refresh announces nothing.
    let lastPresent = hub
        .currentRoster()
        .map((seat, i) => (i > 0 && seat.name !== OPEN_SEAT_NAME ? seat.name : null));
    const announceRosterChanges = (roster: CanonicalSeatDef[]): void => {
        const present = roster.map((seat, i) => (i > 0 && seat.name !== OPEN_SEAT_NAME ? seat.name : null));
        for (let i = 1; i < Math.max(present.length, lastPresent.length); i++) {
            const before = lastPresent[i] ?? null;
            const now = present[i] ?? null;
            if (before === now) continue;
            // a seat swapping occupants outright reports both halves
            if (before) announceLobbySystem(`${before} left.`, hub);
            if (now) announceLobbySystem(`${now} joined.`, hub);
        }
        lastPresent = present;
    };

    const refresh = () => {
        if (!hosting) return;
        const roster = hub.currentRoster();
        announceRosterChanges(roster);
        const joined = hub.connectedSeats().length + 1;
        const names = roster.map((s, i) => (i === 0 ? `${s.name} (you)` : s.name)).join(', ');
        // only ACTUALLY joined seats (host + currently connected) — the
        // rest of `roster` is still "Waiting…" placeholders, not real names
        const connectedNames = [0, ...hub.connectedSeats()]
            .sort((a, b) => a - b)
            .map((i) => roster[i]?.name ?? '')
            .join(', ');
        renderRosterTable(
            roster,
            0,
            waitForJoined,
            customConfig ? (seat) => hub.kickSeat(seat) : undefined,
            inviteToHostedRoom,
        );
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
        // Label follows the state, not just `disabled`: a greyed-out button
        // still reading "Start" looks like it should work and says nothing
        // about what is missing (reported live: the host could not tell why
        // Start did nothing while a guest had not readied up). The layout is
        // already on screen in the roster table, so naming it here too said
        // nothing — what the player cannot otherwise see is whether pressing
        // this fills the empty seats with bots.
        startStarBtn.disabled = !!customConfig && !allReady;
        startStarBtn.textContent = startStarBtn.disabled
            ? 'Waiting for players to ready up…'
            : joined < roster.length
              ? 'Start with AI'
              : 'Start';
        // Everyone who joined has readied up: light the button so the host can
        // see it is on them now without re-reading the roster. Needs someone to
        // actually be here (joined > 1) — a room the host is alone in trivially
        // satisfies "all ready", and glowing at them to start a solo match
        // against bots would be telling them the wrong thing.
        startStarBtn.classList.toggle('is-go', !!customConfig && allReady && joined > 1);
        // auto-start once `waitForJoined` have joined — EXCEPT for a Custom
        // Game room (customConfig set), which always waits for the host's
        // own explicit Start click instead. Matchmaking/quick-match rooms
        // (customConfig null) keep the original no-manual-step behavior —
        // that queue is specifically "get into a match fast," where a
        // Custom Game host wants a last look at who joined (and the chance
        // to kick someone) before committing.
        if (joined >= waitForJoined && !customConfig) {
            setStatus(`Room "${hostName}" — ${joined}/${roster.length} joined: ${names}. Starting…`);
            startHostedMatch();
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
                `Room "${hostName}" ${modeLabel} - ${namesPart}waiting for ${remaining} more player${remaining === 1 ? '' : 's'}. Click "Start with AI" to play the empty seats as bots`,
            );
        } else {
            setStatus('Waiting for an opponent');
        }
    };
    showLobbyChat((item) =>
        hub.broadcast({ type: 'chat', item, from: { name: getPlayerName(), role: 'player' } }),
    );
    hub.onRosterChange = () => {
        refresh();
        advertiseHostedRoom();   // seats changed — keep the room list honest
    };
    hub.onMessage = (seat, msg) => {
        if (msg.type === 'chat') {
            if (!acceptLobbyChatFromPeer()) return;
            // name comes from the roster entry for the CONNECTION's seat, never
            // from the message — same authority rule the running match applies
            const from = { name: hub.currentRoster()[seat]?.name ?? 'Player', role: 'player' as const };
            appendLobbyChat(from.name, msg.item);
            hub.broadcast({ type: 'chat', item: msg.item, from }, seat);
            return;
        }
        if (msg.type !== 'lobbyReady') return;
        const entry = hub.currentRoster()[seat];
        if (entry) hub.setRosterEntry(seat, { ...entry, ready: msg.ready });
        refresh();
    };
    hub.listen((name, version, avatar, loadout) => {
        if (version !== GAME_VERSION) {
            return {
                reject: `Version mismatch — this room runs ${formatGameVersion(GAME_VERSION)}, you have ${formatGameVersion(version)}.`,
            };
        }
        const seat = hub.nextOpenSeat();
        if (seat === null) return { reject: 'Room is full.' };
        hub.setRosterEntry(seat, {
            side: hub.sideOf(seat),
            controller: 'human',
            name,
            avatar: wireAvatar(avatar) || undefined,
            // normalize HERE — this is the boundary where a peer's picks
            // stop being untrusted input and start feeding combat math
            loadout: normalizeLoadout(loadout),
        });
        return seat;
    });
    refresh();
}

/**
 * Open a room and wire the lobby, for every transport.
 *
 * Only two things here are transport-specific: how the room is opened, and
 * whether there is an invite affordance afterwards. Everything below that —
 * roster table, ready state, AI-fill, auto-start, kick — is one implementation,
 * because keeping two in step is what let Steam miss fixes the web path had.
 */
async function beginHost(opts: {
    transport: 'matchmaking' | 'lan' | 'steam';
    horde?: boolean;
    waitForJoined?: number;
    customConfig?: CustomGameConfig | null;
    buildRoster?: (hostName: string) => CanonicalSeatDef[];
    mode?: '1v1' | '2v2';
    offerAiStart?: boolean;
    /** Steam: public lobbies are discoverable by quick match, private are invite-only */
    isPublic?: boolean;
    /** Steam: pop the overlay invite picker once the lobby is open */
    openInvite?: boolean;
}): Promise<void> {
    const transport = opts.transport;
    const horde = opts.horde ?? false;
    const waitForJoined = opts.waitForJoined ?? 2;
    const customConfig = opts.customConfig ?? null;
    const buildRoster = opts.buildRoster ?? initialStarRoster;
    const mode = opts.mode ?? '2v2';
    const offerAiStart = opts.offerAiStart ?? true;
    const isPublic = opts.isPublic ?? true;
    const openInvite = opts.openInvite ?? false;

    starHordeFlag = horde;
    starCustomConfig = customConfig;
    showMenuView('session');
    setMenuBusy(true);
    setStatus(
        transport === 'steam'
            ? 'Opening Steam lobby…'
            : transport === 'lan'
              ? mode === '1v1'
                  ? 'Opening LAN room…'
                  : 'Opening LAN 2v2 room…'
              : mode === '1v1'
                ? 'Opening room…'
                : 'Opening 2v2 room…',
    );
    const hostName = getPlayerName();
    // Opening a room can't be aborted mid-flight (a real round trip: PeerJS
    // signaling plus an HTTP call, or Steam's lobby create) — this only tracks
    // whether Cancel was clicked WHILE it was pending, so the resolved room is
    // torn down immediately instead of reviving a "ghost" room the user already
    // dismissed (`hosting` is still null then, so cancelHost has nothing to do).
    let cancelled = false;
    pending?.cancel();
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    let hosted: HostedRoom;
    try {
        if (transport === 'steam') {
            const room = await hostSteamStarRoom(buildRoster(hostName), isPublic, mode);
            hosted = { hub: room.hub, id: room.lobbyId, transport };
        } else {
            const room = await hostStarRoom(buildRoster(hostName), setStatus, mode, transport);
            hosted = {
                hub: room.hub,
                id: room.roomId,
                transport,
                cleanup: room.cleanup,
                stopDiscovery: room.stopDiscovery,
            };
            stopHostDiscovery = room.stopDiscovery ?? null;
        }
    } catch (e) {
        pending = null;
        setMenuBusy(false);
        setStatus(`Could not host: ${e instanceof Error ? e.message : e}`);
        return;
    }
    pending = null;
    if (cancelled) {
        hosted.hub.close();
        hosted.cleanup?.();
        return;
    }
    if (openInvite) steamLobby.openInviteDialog();
    setMenuBusy(false);
    hosting = hosted;
    updateSteamPresence('lobby', {
        lobbyId: transport === 'steam' ? hosted.id : null,
        players: waitForJoined,
    });
    wireHostedHub(hosted.hub, { hostName, waitForJoined, offerAiStart, mode, customConfig });
}

/** host clicks Start: AI-fill empty seats, send each guest its own setup, launch locally */
function startHostedMatch(): void {
    if (!hosting) return;
    const { hub, transport } = hosting;
    const connected = new Set(hub.connectedSeats());
    const currentRoster = hub.currentRoster();
    const finalRoster: CanonicalSeatDef[] = currentRoster.map((s, i) => {
        if (i > 0 && s.controller === 'human' && !connected.has(i)) {
            // AI seats get a real loadout here, rolled once and carried on
            // the roster exactly like a human's — starSetup below sends this
            // same array, so every client receives the bot's talents rather
            // than computing its own copy.
            return {
                side: s.side,
                controller: 'ai' as const,
                name: starAiName(i, currentRoster),
                loadout: randomLoadout(),
            };
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
        { role: 'host', hub, mySeat: 0, discovery: transport },
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
    hosting?.cleanup?.();   // web/LAN only: stop the lobby heartbeat, tell the backend
    // Presence keeps advertising the lobby, which is also what every GUEST does
    // for the whole match (see bindGuestSession) — the host clearing it here
    // meant a friend could join through a guest but not through the host, for
    // no reason either of them could see.
    //
    // The Steam lobby itself deliberately stays open too: leaving it would run
    // closeNetworking() and drop every P2P socket mid-game, and a player who
    // drops has to be able to rejoin it. Nothing here decides who gets in — the
    // host does, on the handshake: a returning player reclaims their held seat,
    // and anyone else is refused a seat and falls back to spectating (see
    // acceptSteamInvite). That is the whole point of keeping the door visible.
    updateSteamPresence('match', {
        lobbyId: hosting?.transport === 'steam' ? hosting.id : null,
    });
    hosting = null; // ownership of `hub` passes to the running Game now
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
            bindGuestSession(session);
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

/** The Steam lobby behind a guest session, when there is one. */
function steamLobbyIdOf(session: GuestSession): string | null {
    const lobbyId = (session as GuestSession & { lobbyId?: string }).lobbyId;
    return typeof lobbyId === 'string' ? lobbyId : null;
}

/** Drive an already-connected star guest (optional first message already read via once()). */
function bindGuestSession(session: GuestSession, first?: NetMessage): void {
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
            session.close();
        },
    };
    setMenuBusy(true);
    setStatus('Connected — waiting for the host to start…');
    // A guest advertises the same lobby, so a third friend can join through
    // either player rather than only through the host.
    updateSteamPresence('lobby', { lobbyId: steamLobbyIdOf(session) });
    session.onClose = () => {
        if (started) return;
        cancelled = true;
        pending = null;
        updateSteamPresence('menu');   // the lobby we advertised is gone
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
    /**
     * Our own ready state as WE last set it, until the host echoes it back.
     *
     * The host rebroadcasts `starRoster` on every refresh — including
     * refreshes triggered by something else entirely (another guest joining,
     * a settings edit) — so a broadcast carrying the ready value from BEFORE
     * our toggle can land just after we ticked the box and silently flip it
     * back. The next click then reads false→true and sends "ready" a second
     * time instead of the un-ready the player just asked for, leaving the
     * host convinced they are ready and its Start button live. Holding our
     * own value until it is confirmed keeps the checkbox showing what the
     * player chose.
     */
    let pendingReady: boolean | null = null;
    const handle = (msg: NetMessage): void => {
        if (cancelled) return;
        if (msg.type === 'starRoster') {
            showLobbyChat((item) =>
                // `from` is required by the message, but the host re-stamps the
                // name from our seat's roster entry — a claimed name is never
                // trusted, in the lobby or in the match.
                session.send({ type: 'chat', item, from: { name: getPlayerName(), role: 'player' } }),
            );
            const found = msg.roster.findIndex((s) => s.name === getPlayerName());
            if (found >= 0) mySeat = found;
            renderRosterTable(msg.roster, mySeat ?? 1, msg.waitForJoined);
            if (mySeat !== null) {
                const hostSaysReady = msg.roster[mySeat]?.ready ?? false;
                if (pendingReady === null || pendingReady === hostSaysReady) {
                    pendingReady = null;
                    lobbyReadyCheckEl.checked = hostSaysReady;
                }
            }
            setStatus('Connected — waiting for the host to start…');
            return;
        }
        if (msg.type === 'chat') {
            if (msg.from.role === 'system') appendLobbyChat(msg.from.name, msg.item, 'system');
            else if (acceptLobbyChatFromPeer()) appendLobbyChat(msg.from.name, msg.item);
            return;
        }
        if (msg.type === 'lobbySettings') {
            showGuestLobbySettings(msg.config, (ready) => {
                pendingReady = ready;
                session.send({ type: 'lobbyReady', ready });
            });
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
                setStatus(
                    `Version mismatch — the host runs ${formatGameVersion(msg.version)}, you have ${formatGameVersion(GAME_VERSION)}.`,
                    5000,
                );
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
            setStatus(
                `Version mismatch — the host runs ${formatGameVersion(msg.version)}, you have ${formatGameVersion(GAME_VERSION)}.`,
                5000,
            );
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
        bindGuestSession(session, first);
        return true;
    } catch {
        if (cancelled) return true;
        return false;
    }
}

/** Wait on a guest session that is still connecting, then bind it. */
function runGuestPending(p: Promise<GuestSession>): void {
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
        bindGuestSession(session);
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
        // Layout no longer changes the join: 1v1 is a two-seat star lobby, so
        // every guest waits for the same starSetup/starRejected handshake.
        const result = await joinSteamLobby(lobbyId);
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
        bindGuestSession(result.session, first);
        return true;
    } catch {
        return false;
    }
}

// a Steam overlay/friends-list "Join Game" invite can be accepted from
// anywhere (menu idle, another screen) — not just while mm-invite/mm-play
// is open, mirroring the ?room= deep-link handling further down for the
// web build's invite-link equivalent
/** Join a Steam room picked from the list — same handshake as an invite. */
function joinSteamAd(lobbyId: string): void {
    acceptSteamInvite(lobbyId);
}

/**
 * Accept a Steam invite: take a seat if there is one, otherwise watch.
 *
 * A friend who accepts mid-match used to hit a flat "Could not join: Room is
 * full." — the host holds every seat once play has begun, and an invite is
 * exactly as likely to be accepted during a match as before one. Asking the
 * host and falling back on its answer (rather than second-guessing seat
 * availability from lobby data here) keeps the one seat authority in one
 * place: a returning player whose seat is still held is reclaimed by that
 * same handshake and never reaches the fallback at all.
 */
function acceptSteamInvite(lobbySteamId: string): void {
    if (started || pending || hosting) return;
    showMenuView('session');
    setMenuBusy(true);
    let cancelled = false;
    pending = {
        cancel: () => {
            cancelled = true;
        },
    };
    void (async () => {
        try {
            const result = await joinSteamLobby(lobbySteamId);
            if (cancelled) {
                result.session.close();
                return;
            }
            const first = await Promise.race([
                result.session.once(),
                new Promise<NetMessage>((_, reject) =>
                    setTimeout(() => reject(new Error('Host did not respond')), 12_000),
                ),
            ]);
            if (cancelled) {
                result.session.close();
                return;
            }
            if (first.type === 'starRejected' || first.type === 'starRejoinRejected') {
                // close() leaves the lobby too, freeing the slot we took to
                // ask — a spectator never needs to be in it (see
                // SteamSpectatorTransport).
                result.session.close();
                pending = null;
                if (result.spectate) {
                    startSpectateGame(result.hostName, {
                        endpoint: result.spectate,
                        transport: 'steam',
                    });
                } else {
                    setMenuBusy(false);
                    setStatus(`Could not join: ${first.reason}`);
                }
                return;
            }
            bindGuestSession(result.session, first);
        } catch (e: unknown) {
            if (cancelled) return;
            pending = null;
            setMenuBusy(false);
            setStatus(`Could not join: ${e instanceof Error ? e.message : e}`);
        }
    })();
}

onSteamJoinRequested(({ lobbySteamId }) => acceptSteamInvite(lobbySteamId));

// An invite that LAUNCHED the game arrives before this file has finished
// starting up, so it cannot be caught by the subscription above — the runtime
// holds it for us instead. Claiming it here is what makes "accept invite while
// the game is closed" work, which is the only invite path Steam supports for a
// game that is not already running.
if (steam.isAvailable()) {
    void steamLobby.takePendingJoin?.().then((lobbyId) => {
        if (lobbyId) acceptSteamInvite(lobbyId);
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

/**
 * Every room this transport can see, as RoomAds. One enumeration for the
 * browsable list and for quick match, so the two can never disagree about what
 * exists — and the only per-transport code is reading each discovery channel.
 */
async function listRoomAds(transport: MultiplayerTransport, waitMs = 900): Promise<RoomAd[]> {
    const mine = getPlayerName().toLowerCase();
    if (transport === 'steam') {
        const rooms = await steamLobby.getLobbies();
        return rooms
            .filter((r) => r.data.game === 'melodan' && !!r.data.mode)
            .filter((r) => !r.data.version || r.data.version === String(GAME_VERSION))
            .map((r) => {
                const mode = r.data.mode === '2v2' ? ('2v2' as const) : ('1v1' as const);
                const limit = r.memberLimit ?? (mode === '2v2' ? 4 : 2);
                return {
                    key: r.id,
                    name: r.data.host || 'Steam player',
                    mode,
                    round: r.data.round ? Number(r.data.round) : undefined,
                    seats: parseAdSeats(r.data.seats),
                    spectate: r.data.spectate || undefined,
                    // A round is only ever advertised once the match itself
                    // starts, so this is "still in the lobby AND has room" —
                    // the same rule LAN applies. Membership alone was not
                    // enough: a running match whose player dropped frees a
                    // lobby slot while its SEAT stays held for the reconnect,
                    // so the room offered a Join that the host could only
                    // answer with "Room is full". Watch is unaffected — it
                    // keys off `spectate`, not this.
                    hasOpenSeat: r.memberCount < limit && !r.data.round,
                    join: { transport: 'steam' as const, lobbyId: r.id },
                };
            })
            .filter((ad) => ad.name.toLowerCase() !== mine);
    }
    if (transport === 'lan') {
        const rooms = await lanRoomsExcludingSelf(waitMs);
        return rooms.map((r) => {
            const data = (r.data ?? {}) as Record<string, unknown>;
            return {
                key: `${r.host}:${r.port}:${r.path}:${r.name}`,
                name: r.name,
                mode: data.mode === '2v2' ? ('2v2' as const) : ('1v1' as const),
                round: typeof data.round === 'number' ? data.round : undefined,
                seats: parseAdSeats(data.seats),
                spectate: typeof data.spectate === 'string' ? data.spectate : undefined,
                hasOpenSeat: data.round === undefined,
                join: {
                    transport: 'lan' as const,
                    name: r.name,
                    peerServer: { host: r.host, port: r.port, path: r.path, secure: false },
                },
            };
        });
    }
    const rooms = await fetchLobbyRooms();
    return rooms
        .filter((r) => r.name.toLowerCase() !== mine)
        .map((r) => ({
            key: `${r.kind}:${r.name}`,
            name: r.name,
            mode: r.mode,
            round: r.round,
            seats: r.roster,
            spectate: r.kind === 'spectate' ? r.peer : undefined,
            hasOpenSeat: r.kind === 'lobby',
            join: { transport: 'matchmaking' as const, name: r.name },
        }));
}

/** Seats survive discovery as JSON (Steam data values and the LAN announce are
 *  both strings/plain objects) — tolerate anything malformed. */
function parseAdSeats(raw: unknown): RoomRosterEntry[] | undefined {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) && parsed.length > 0 ? (parsed as RoomRosterEntry[]) : undefined;
    } catch {
        return undefined;
    }
}

async function listMatchCandidates(
    transport: MultiplayerTransport,
    modeFilter?: '1v1' | '2v2',
): Promise<MatchCandidate[]> {
    // Same enumeration the browsable list uses — quick match only differs in
    // wanting rooms with a seat free, and in a shorter LAN wait so an empty
    // network falls through to hosting quickly.
    const ads = await listRoomAds(transport, 400);
    return ads
        .filter((ad) => ad.hasOpenSeat !== false)
        .filter((ad) => !modeFilter || ad.mode === modeFilter)
        .map((ad) =>
            ad.join.transport === 'steam'
                ? { key: ad.key, kind: 'steam' as const, lobbyId: ad.join.lobbyId }
                : {
                      key: ad.key,
                      kind: 'peer' as const,
                      name: ad.name,
                      peerServer: ad.join.transport === 'lan' ? ad.join.peerServer : null,
                  },
        );
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
        await beginHost({
                transport: 'steam',
            horde,
            waitForJoined,
            isPublic: true,
            offerAiStart,
            openInvite: false,
            buildRoster: roster,
            mode,
        });
        return;
    }
    const discovery = transport === 'lan' ? 'lan' : 'matchmaking';
    await beginHost({ transport: discovery, horde, waitForJoined, customConfig: null, buildRoster: roster, mode, offerAiStart });
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
function startSpectateGame(
    hostName: string,
    known?: {
        /** what to dial: a peer id, or a host steamId64 on the Steam transport */
        endpoint: string;
        transport?: MultiplayerTransport;
        peerServer?: PeerServerConfig | null;
    },
): void {
    const name = hostName.trim();
    if (!name) return;
    setMenuBusy(true);
    setStatus(`Looking for "${name}"…`);
    void (async () => {
        try {
            // A room that advertised its own spectate endpoint (Steam lobby
            // data, LAN announce) needs no cloud lookup — and on LAN there is
            // nothing in the cloud to find. Point the peer at the room's own
            // signaling server first, exactly as joining does.
            if (known?.peerServer !== undefined) setPeerServerConfig(known.peerServer);
            // The cloud lookup is the WEB transport's directory — a Steam or
            // LAN room always carries its own endpoint in the ad it was
            // clicked from, and neither is registered in the cloud at all.
            const endpoint = known?.endpoint ?? (await lookupSpectateEndpoint(name));
            if (!endpoint) {
                setMenuBusy(false);
                setStatus(`No live match found for "${name}".`);
                return;
            }
            setStatus('Connecting…');
            // Watch over the same network the match is running on: `endpoint`
            // is the host's steamId64 for a Steam room, a peer id otherwise.
            const result =
                known?.transport === 'steam'
                    ? await joinSteamAsSpectator(endpoint, getPlayerName())
                    : await joinAsSpectator(endpoint, getPlayerName());
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
    cancelHost();
    setMenuBusy(false);
    showMenuView('main');
}

function isMenuBlockingOverlayOpen(): boolean {
    // When a dedicated overlay is open (settings/name editor/resume),
    // let that overlay own Escape instead of closing underneath it.
    return (
        !!wrapper.querySelector('.mechili-settings, .mechili-name-edit, .mechili-resume, .mechili-fatal') ||
        loadoutPanel.isOpen() ||
        resumeOverlay !== null
    );
}

function closeMenuSubPanelOnEscape(): boolean {
    // Session (connecting / lobby / waiting): Escape cancels and returns home.
    if (currentMenuView === 'session' || pending || cancelEl.style.display !== 'none') {
        cancelMenuPending();
        return true;
    }

    // Any non-main submenu: back out to the root menu.
    if (currentMenuView !== 'main') {
        pending = null;
        cancelHost();
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
        const ad = roomAdsByKey.get(roomBtn.dataset.roomKey ?? '');
        if (roomBtn.dataset.roomKind === 'spectate') {
            startSpectateGame(
                roomBtn.dataset.room,
                ad?.spectate
                    ? {
                          endpoint: ad.spectate,
                          transport: ad.join.transport,
                          peerServer: ad.join.transport === 'lan' ? ad.join.peerServer : null,
                      }
                    : undefined,
            );
            return;
        }
        // Every room is star-hosted (1v1 is a 2-seat star room), rejoins
        // included — the join handle carried by the ad is the only difference
        // between transports here.
        if (ad?.join.transport === 'steam') void joinSteamAd(ad.join.lobbyId);
        else if (ad?.join.transport === 'lan') beginStarJoin(ad.join.name, ad.join.peerServer);
        else beginStarJoin(roomBtn.dataset.room, null);
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
            cancelHost();
            setMenuBusy(false);
            showMenuView('main');
            break;
        case 'mm-back':
            pending?.cancel();
            pending = null;
            cancelHost();
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
                    void beginHost({
                        transport: 'steam',
                        horde,
                        waitForJoined: team === '2v2' ? 4 : 2,
                        isPublic: false,
                        offerAiStart: false,
                        openInvite: true,
                        buildRoster: team === '2v2' ? initialStarRoster : initial1v1Roster,
                        mode: team === '2v2' ? '2v2' : '1v1',
                    });
                    return;
                }
                if (transport === 'lan') {
                    mmInviteEl.textContent = 'Waiting for a LAN player…';
                    mmLinkEl.textContent = 'Your room is advertised on the local network. Friends: Settings → Multiplayer → LAN, then Matchmaking.';
                    mmLinkEl.style.display = '';
                    setStatus(transportLookingStatus('lan'));
                    if (team === '2v2') void beginHost({ transport: 'lan', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initialStarRoster, mode: '2v2', offerAiStart: true });
                    else void beginHost({ transport: 'lan', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initial1v1Roster, mode: '1v1', offerAiStart: false });
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
                if (team === '2v2') void beginHost({ transport: 'matchmaking', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initialStarRoster, mode: '2v2', offerAiStart: true });
                else void beginHost({ transport: 'matchmaking', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initial1v1Roster, mode: '1v1', offerAiStart: false });
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
                    {
                        const is2v2 = team === '2v2';
                        const roster = is2v2 ? initialStarRoster : initial1v1Roster;
                        void hostOrJoinSteamStar(roster(getPlayerName()), is2v2 ? '2v2' : '1v1').then((result) => {
                            if (result.role === 'guest') {
                                runGuestPending(Promise.resolve(result.session));
                            } else {
                                starHordeFlag = horde;
                                hosting = { hub: result.hub, id: result.lobbyId, transport: 'steam' };
                                updateSteamPresence('lobby', {
                                    lobbyId: result.lobbyId,
                                    players: is2v2 ? 4 : 2,
                                });
                                wireHostedHub(result.hub, {
                                    hostName: getPlayerName(),
                                    waitForJoined: is2v2 ? 4 : 2,
                                    offerAiStart: false,
                                    mode: is2v2 ? '2v2' : '1v1',
                                });
                            }
                        });
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
                        if (team === '2v2') void beginHost({ transport: 'lan', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initialStarRoster, mode: '2v2', offerAiStart: true });
                        else void beginHost({ transport: 'lan', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initial1v1Roster, mode: '1v1', offerAiStart: false });
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
                    else if (team === '2v2') void beginHost({ transport: 'matchmaking', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initialStarRoster, mode: '2v2', offerAiStart: true });
                    else void beginHost({ transport: 'matchmaking', horde: horde, waitForJoined: 2, customConfig: null, buildRoster: initial1v1Roster, mode: '1v1', offerAiStart: false });
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
        case 'cg-host-2v2':
            hostCustomGame('2v2');
            break;
        case 'cg-host-2v2ai':
            hostCustomGame('2v2ai');
            break;
        case 'startstar':
            startHostedMatch();
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
} else if (starMpMarker && Date.now() - (starMpMarker.savedAt ?? 0) <= STAR_RESUME_AUTO_MS) {
    // Fresh enough that the host may still be holding the seat. Reopening the
    // tab minutes later and watching it announce "Reconnecting…" before failing
    // is worse than staying quiet — the marker is left in place either way, so
    // the room list still offers the room, and a seat already handed to AI can
    // still be taken back by name for as long as the match runs.
    // `savedAt` is refreshed on a heartbeat while playing, so this is time
    // since the tab stopped running, not time since the match began.
    // joinStarRoom always dials the room code fresh and the host's own
    // name-matched
    // implicit reclaim (StarHub.findDroppedSeatByName) does the rest, so
    // this is just an automatic version of clicking a "resume" row in the
    // room list (beginStarJoin/runStarPending already handle busy state,
    // status text, and every failure case the same way a manual click
    // would — no separate dedicated overlay needed here).
    setMenuChromeVisible(true);
    setStatus(`Reconnecting to "${starMpMarker.hostName}"…`);
    // Same automatic version of clicking the room, per transport: Steam rejoins
    // the lobby it recorded, LAN dials the signaling server the room lives on
    // (a fresh process has none configured), matchmaking dials the room code.
    if (starMpMarker.transport === 'steam' && starMpMarker.lobbyId) {
        acceptSteamInvite(starMpMarker.lobbyId);
    } else if (starMpMarker.transport === 'lan' && starMpMarker.peerServer) {
        beginStarJoin(starMpMarker.hostName, starMpMarker.peerServer);
    } else {
        beginStarJoin(starMpMarker.hostName);
    }
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
