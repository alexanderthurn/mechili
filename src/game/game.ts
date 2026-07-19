import type { Application } from 'pixi.js';
import {
    BasicShadowMap,
    Color,
    DirectionalLight,
    Fog,
    HemisphereLight,
    PCFSoftShadowMap,
    PMREMGenerator,
    Scene,
    WebGLRenderer,
    type Mesh,
    type Object3D,
    type ShadowMapType,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setHeightFogStrength } from '../engine/heightFog'; // patches three's fog chunks on import
import { THEME } from '../theme';
import { CameraRig } from '../engine/cameraRig';
import { CameraControls } from '../engine/cameraControls';
import { GamepadCursor } from '../engine/gamepadCursor';
import { disposeScene } from '../engine/disposeScene';
import { ActionDispatcher, prepareHazardPours, levelCost, quantizeWorld, quantizeYaw, towerUpgradeCost, xpThresholdFor, type Action, type LoggedAction } from './actions';
import { AiOpponent, type Opponent } from './ai';
import {
    clearResumeMarker,
    clearSinglePlayer,
    GAME_VERSION,
    NetworkOpponent,
    registerSpectateEndpoint,
    SpectatorHub,
    type NetMessage,
    type NetSession,
    type RosterEntry,
} from './net';
import { BALANCE_PATCH_ID, submitMatchTelemetry, summarizeUnits } from './telemetry';
import { matchResultId, reportMatchResult } from './account';
import {
    AIR_BONUS,
    COST_CONTROL_INCOME,
    COST_CONTROL_PENALTY,
    ELITE_ROUND1_BONUS,
    FREE_ARCHER_LEVEL,
    FREE_ARCHER_ROUND,
    ROUND_CARDS,
    SKIP_CARD_REWARD,
    START_CARDS,
    type RoundCard,
    type SpecialityId,
    type StartCard,
} from './cards';
import { assignTeamColors, teamColors } from './colors';
import { CHAT_COOLDOWN_MS, CHAT_TEXT_LIMIT, type ChatItem } from './emotes';
import { HazardField, HAZARD_POUR_DELAY_SEC, OIL_SPILL_DURATION_ROUNDS, OIL_SPILL_RADIUS } from './fire';
import { OilDripFx } from './oilDripFx';
import { BlobShadows, type BlobShadowSource } from './blobShadows';
import { FireFx } from './fireFx';
import { CloudFx } from './cloudFx';
import { DragonFx } from './dragonFx';
import { HammerFx, HAMMER_SWING_SEC } from './hammerFx';
import { MeteorFx, GREAT_METEOR_FALL_SEC } from './meteorFx';
import { ITEMS } from './items';
import { BASE_ANCHORS, BattleMap, CELL, groundHeightAt, mulberry32, worldHeightAt, type Cell } from './map';
import { OilVisuals } from './oilVisuals';
import { inputMode, noteGamepadActivity, onInputModeChange, touchFirstDevice } from './inputCapabilities';
import {
    onPrefsChange,
    prefs,
    effectiveDpr,
    sceneryDetailed,
    sceneryCameraFar,
    sceneryHeightFog,
    sceneryWeatherFx,
    shadowMapSize,
    shadowSoftRadius,
    shadowUpdateStride,
    shadowUsesBlobs,
    shadowUsesMap,
    type FireVfxQuality,
    type GroundEffectsQuality,
    type SceneryQuality,
    type ShadowQuality,
} from './prefs';
import { Particles, ProjectileRenderer } from './effects';
import { Scenery } from './scenery';
import type { Weather } from './weather';
import { createRangeRing, placeRangeRing, PlacementController } from './placement';
import { RallyVisuals, type RallyDraft } from './rallyVisuals';
import { SpellVisuals, type SpellChargeMarker, type SpellDraft } from './spellVisuals';
import { DEFAULT_SETTINGS, Economy, normalizeGameSettings, type GameSettings } from './settings';
import { BattleSim, BATTLE_START_FREEZE, type Actor, type SimEvent, SOFT_CROWD_LIMIT } from './sim';
import {
    BIG_METEOR_ID,
    DRAGON_APPROACH_SEC,
    DRAGON_ID,
    DRAGON_POUR_DURATION_SEC,
    HAMMER_ID,
    OIL_SPILL_ID,
    RALLY_ROUTE_ID,
    RALLY_ROUTE_RADIUS,
    SELL_UNIT_ID,
    TACTICS,
    clampTacticEnd,
    clampTacticPoint,
    pointInSafeZone,
    usesSpellPlacement,
    type OilStamp,
    type RallyRoute,
    type SpellStamp,
} from './tactics';
import { TechTree } from './tech';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    UNIT_TYPES,
    techDescription,
    techIcon,
    unitTypeById,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import { DebugOverlay, CpuSampler } from '../ui/debug';
import { HpBars } from '../ui/hpBars';
import { Hud, type Phase, type SelectionInfo } from '../ui/hud';
import { renderAllUnitIcons } from '../ui/unitIcons';
import { updateAnimatedUnits } from './unitAnimated';
import { setUnitInstanceRenderer, UnitInstanceRenderer } from './unitInstances';

/** how long the both-specialists reveal stays up before deployment takes over */
const SPECIALIST_REVEAL_MS = 2000;

/** SP cheat (U): tactic ids topped up for free testing (see cheatGrantAllTactics) */
const CHEAT_TACTIC_GRANTS = [
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    SELL_UNIT_ID,
    'spawnDwarves',
    'bigMeteor',
    'spawnCrows',
    'hammerOfGods',
    'storm',
    'meteorShower',
    'poisonCloud',
    'acidSpill',
    'fireSpill',
    'dragonAttack',
];

/** derives an independent, label-specific seed for a named rng stream */
function seedFrom(seed: number, label: string): number {
    let h = seed >>> 0;
    for (let i = 0; i < label.length; i++) {
        h = Math.imul(h ^ label.charCodeAt(i), 0x9e3779b1);
    }
    return h >>> 0;
}

/**
 * The battlefield scene: a real three.js world (ground, lights, shadows,
 * unit meshes) rendered below the transparent Pixi UI overlay.
 */
export class Game {
    private readonly map: BattleMap;
    private readonly economy: Economy;
    private readonly techTree = new TechTree();
    private readonly scene = new Scene();
    private readonly renderer: WebGLRenderer;
    private readonly rig = new CameraRig();
    private readonly controls: CameraControls;
    private readonly gamepad: GamepadCursor;
    private readonly placement: PlacementController;
    private readonly hud: Hud;
    private readonly debug: DebugOverlay;
    private readonly cpuSampler = new CpuSampler();
    private readonly hpBars = new HpBars();
    private readonly projectileRenderer: ProjectileRenderer;
    private readonly particles: Particles;
    private readonly fireFx: FireFx;
    private readonly hammerFx: HammerFx;
    private readonly meteorFx: MeteorFx;
    private readonly cloudFx: CloudFx;
    private readonly dragonFx: DragonFx;
    private readonly oilDripFx: OilDripFx;
    private readonly oilVisuals: OilVisuals;
    private readonly oilField = new HazardField();
    private readonly oilBaseline = new HazardField();
    private readonly oilStamps: OilStamp[] = [];
    private readonly oilStampIds = { next: 1 };
    /** battle-spell stamps — NEVER cleared per round: old ones drive cooldowns */
    private readonly spellStamps: SpellStamp[] = [];
    private readonly spellStampIds = { next: 1 };
    private appliedFireVfx: FireVfxQuality = prefs().fireVfx;
    private readonly unitInstances: UnitInstanceRenderer;
    private scenery: Scenery;
    private weather: Weather | null;
    private groundMesh: Mesh;
    private readonly sun: DirectionalLight;
    private readonly hemi: HemisphereLight;
    /** currently APPLIED scenery / ground-effects prefs (may differ until rebuild) */
    private appliedScenery: SceneryQuality = prefs().scenery;
    private appliedGroundEffects: GroundEffectsQuality = prefs().groundEffects;
    private appliedShadows: ShadowQuality = prefs().shadows;
    private readonly blobShadows: BlobShadows;
    private shadowMapFrame = 0;
    private readonly rallyVisuals: RallyVisuals;
    private readonly spellVisuals: SpellVisuals;
    /** hammer charge rings for the current battle (visual countdown) */
    private spellChargeMarkers: SpellChargeMarker[] = [];
    private gridOverlay;
    private time = 0;
    /** battle-phase selection: one individual mech (own or enemy) */
    private selectedActor: Actor | null = null;
    /** attack-range ring under the selected battle mech */
    private readonly battleRangeMesh;

    /** ascending — the speed button steps up (click) or down (right click), wrapping */
    private static readonly SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8];

    private phase: Phase = 'build';
    private round = 0;
    private phaseRemaining = 0;
    private speedIndex = Game.SPEED_STEPS.indexOf(1);
    private playerHp: number;
    private enemyHp: number;
    private matchOver = false;
    private disposed = false;
    private sim: BattleSim | null = null;
    /** everything the player and the AI do goes through here — undo & replay source */
    private readonly dispatcher: ActionDispatcher;
    /** seeds all match randomness; part of the replay header */
    private readonly seed: number;
    /**
     * independent named rng streams — consumption of one can never desync
     * another, so peers can compute card offers regardless of code order
     */
    private readonly rngAi: () => number;
    /** per-side streams for the specialist pick (each fighter gets a different draw) */
    private readonly rngCards: Record<Team, () => number>;
    /** shared stream for between-round card offers (both sides see the same 4) */
    private readonly rngRoundCards: () => number;
    /** the other side's decision maker (built-in AI or the network peer) */
    private readonly opponent: Opponent;
    /** which sides locked in the current deployment — battle starts at both */
    private readonly deployReady: Record<Team, boolean> = { player: false, enemy: false };
    /** which sides finished watching this round's battle — the next build
     *  phase starts once both have (fast-forward speed is per-client) */
    private readonly battleReady: Record<Team, boolean> = { player: false, enemy: false };
    /** streamed peer events, applied in order once our game reaches their round */
    private readonly remoteQueue: { round: number; action?: Action; undo?: boolean }[] = [];
    /** host-only: dedicated broadcast connection point for spectators, opened
     *  once a multiplayer match starts (side 'a' only — see startSpectatorHub) */
    private spectatorHub: SpectatorHub | null = null;
    /** stops the spectate-endpoint discovery heartbeat (see startSpectatorHub) */
    private stopSpectateRegistration: (() => void) | null = null;
    /** per-team recruit level for the running round (the once-per-round level-2 switch) */
    private readonly recruitLevel: Record<Team, number> = { player: 1, enemy: 1 };
    /** the sell ability: `owned` is a permanent match unlock, `used` resets per round */
    private readonly sellState: { owned: Record<Team, boolean>; used: Record<Team, number> } = {
        owned: { player: false, enemy: false },
        used: { player: 0, enemy: 0 },
    };
    /** Research Center: one-time rally-route purchase (permanent match flag) */
    private readonly rallyRouteOwned: Record<Team, boolean> = { player: false, enemy: false };
    /** per-round buy limits: `limit` is permanent (specials may raise it), rest resets per round */
    private readonly deployState: {
        limit: Record<Team, number>;
        extra: Record<Team, number>;
        used: Record<Team, number>;
        extrasSpent: Record<Team, number>;
    };
    /** permanent army-wide boost tiers (0 = none), bought at the Research Center */
    private readonly boostState: Record<'attack' | 'hp', Record<Team, number>> = {
        attack: { player: 0, enemy: 0 },
        hp: { player: 0, enemy: 0 },
    };
    /** round-only stat boosts from the Command Tower (reset each deployment) */
    private readonly roundBoosts: { range: Record<Team, boolean>; speed: Record<Team, boolean> } = {
        range: { player: false, enemy: false },
        speed: { player: false, enemy: false },
    };
    /** Command Tower Credit: used this round (reset each deployment) */
    private readonly creditUsed: Record<Team, boolean> = { player: false, enemy: false };
    /** Command Tower Credit: debt owed at the next deployment start */
    private readonly creditDebt: Record<Team, boolean> = { player: false, enemy: false };
    /** each side's chosen starting-card speciality (null until picked) */
    private readonly speciality: Record<Team, SpecialityId | null> = { player: null, enemy: null };
    /** per-team multiplier on flank spawn duration (Flanky card/specialist → 0.5) */
    private readonly flankSpawnMult: Record<Team, number> = { player: 1, enemy: 1 };
    /** each side's unequipped pack items */
    private readonly itemInventory: Record<Team, string[]> = { player: [], enemy: [] };
    /** tactical order charges (rally routes, etc.) — separate from pack items */
    private readonly tacticInventory: Record<Team, string[]> = { player: [], enemy: [] };
    /** rally routes placed this deployment round */
    private readonly rallyRoutes: RallyRoute[] = [];
    private readonly rallyRouteIds = { next: 1 };
    /** unit types buyable in the shop this match */
    private readonly unlockedUnits: Record<Team, string[]> = { player: [], enemy: [] };
    /** at most one shop unlock per deployment round */
    private readonly unlockUsedThisRound: Record<Team, boolean> = { player: false, enemy: false };
    /** frozen enemy inventory intel captured at deployment-phase start */
    private enemyIntelSnapshot: {
        items: string[];
        tactics: string[];
        sellAbilityOwned: boolean;
    } | null = null;
    /** the inventory item currently armed for placement onto a pack */
    private armedItem: string | null = null;
    /** which inventory slot is armed — duplicates share an id, the highlight must not */
    private armedItemIndex: number | null = null;
    /** the tactic currently being placed on the map */
    private armedTactic: string | null = null;
    /** first click of an in-progress two-point tactic (rally or oil) */
    private tacticDraftStart: { x: number; z: number } | null = null;
    /** whether each side already took/skipped this round's card */
    private readonly roundCardTaken: Record<Team, boolean> = { player: false, enemy: false };
    /** the game idles behind the card overlay until the loadout is picked */
    private awaitingCards = true;
    /** rebuilding from a recorded log: no UI, no net sends, battles fast-forward */
    private hydrating = false;
    /** connection lost: everything pauses until the peer is back */
    private suspended = false;
    /** seconds left before an unreturned opponent forfeits (null = no active grace window) */
    private reconnectGraceRemaining: number | null = null;
    /** set by main: fired the instant the grace window elapses, to cancel the in-flight redial */
    onReconnectTimeout: (() => void) | null = null;
    /** post-reconnect readiness handshake — see awaitPeerReady() */
    private localReady = false;
    private peerReady = false;
    /** the round-card offer drawn during hydration, shown once it finishes */
    private pendingOffer: RoundCard[] | null = null;
    /** the four specialist cards currently offered to the player (for auto-pick) */
    private playerStarterOffer: StartCard[] | null = null;
    /** state checksums per round (battle start), ours and the peer's */
    private readonly sentChecks = new Map<number, number>();
    private readonly peerChecks = new Map<number, number>();
    /** chat rate limiting, both directions */
    private lastChatSent = -Infinity;
    private lastChatReceived = -Infinity;
    /** set by main: the connection dropped mid-match (reconnect orchestration) */
    onConnectionLost: (() => void) | null = null;
    /** set by main: tear down the match and restore the pre-game menu */
    onReturnToMenu: (() => void) | null = null;
    /** throttled hook for persisting single-player state to session storage */
    onStateCheckpoint: (() => void) | null = null;
    private persistTimer = 0;
    /** last stamped battle positions for wear trails (visual only) */
    private readonly sandLastPos = new WeakMap<object, { x: number; z: number }>();
    /** restamp once when the async sand mask finishes loading */
    private sandBootstrapped = false;
    private readonly boundTick = (ticker: { deltaMS: number }) => this.tick(ticker.deltaMS / 1000);
    private readonly onEscapeKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

        // cheats / debug hotkeys (visual or single-player only)
        if (e.code === 'KeyN') {
            // cycle weather: sunny → rain → night → …
            this.weather?.next();
            return;
        }
        if (e.code === 'KeyU' && !this.net) {
            // single-player: one of every unit type on both sides + huge HP
            this.cheatSpawnAllUnits();
            return;
        }

        if (e.code !== 'Escape') return;
        this.togglePauseMenu();
    };

    /** Escape / the topbar ☰ button: open or close the pause menu */
    private togglePauseMenu(): void {
        if (this.matchOver || this.suspended) return;
        this.hud.togglePauseMenu();
        if (this.hud.isPauseMenuOpen()) {
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
            this.cancelTacticPlacement();
        }
    }
    private readonly onWindowResize = () => this.resize(this.wrapper.clientWidth, this.wrapper.clientHeight);
    private readonly wrapper: HTMLElement;
    private readonly threeCanvas: HTMLCanvasElement;
    private readonly inputDisposers: (() => void)[] = [];
    private battleDown: { x: number; y: number } | null = null;

    private readonly settings: GameSettings;

    constructor(
        private readonly pixiApp: Application,
        threeCanvas: HTMLCanvasElement,
        wrapper: HTMLElement,
        settingsInput: GameSettings = DEFAULT_SETTINGS,
        /** the peer connection in multiplayer, null against the AI (swappable on reconnect) */
        private net: NetSession | null = null,
        /** canonical side: the host is 'a', the guest 'b' — keys card streams & sim ordering */
        private readonly side: 'a' | 'b' = 'a',
        private readonly playerNames: { local: string; opponent: string } = {
            local: 'You',
            opponent: 'AI',
        },
        /** recorded state to rebuild from — reconnect/resync/reload */
        resume: {
            actions: LoggedAction[];
            battleElapsed: number | null;
            local?: boolean;
            /** the exporting side's live build-phase clock — replay always
             *  resets it to a fresh full timer, so it's restored separately */
            phaseRemaining?: number;
        } | null = null,
    ) {
        this.settings = normalizeGameSettings(settingsInput);
        const settings = this.settings;
        this.wrapper = wrapper;
        this.threeCanvas = threeCanvas;
        // canonical colors first — units, overlays and HUD CSS all read them
        assignTeamColors(side);
        this.map = new BattleMap(settings.map);
        // one SHARED board for both peers: the guest owns the far half and
        // only its camera differs — no coordinates are ever mirrored
        this.map.ownAtFar = side === 'b';
        this.economy = new Economy(settings.economy);
        this.playerHp = settings.startingHp;
        this.enemyHp = settings.startingHp;
        this.renderer = new WebGLRenderer({
            canvas: threeCanvas,
            antialias: prefs().antialias,
            // mobile Safari kills tabs that push the GPU too hard — prefer the
            // efficient tier there; desktops ignore or barely notice this hint
            powerPreference: touchFirstDevice() ? 'low-power' : 'default',
        });
        this.renderer.setPixelRatio(effectiveDpr());

        this.scene.background = new Color(THEME.sky);
        // scenery 'off' plays without any fog or weather
        this.scene.fog = sceneryWeatherFx() ? new Fog(THEME.sky, THEME.fogNear, THEME.fogFar) : null;
        // ground-mist strength for the current scenery tier (baked into the
        // fog shader chunk before the first material compiles)
        setHeightFogStrength(sceneryHeightFog());

        // PBR environment: metallic (Tripo) models render near-black with nothing
        // to reflect, so give the scene a neutral image-based light. Kept subtle so
        // it lifts the metals without washing out the tuned direct-light look.
        const pmrem = new PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.55;
        pmrem.dispose();

        const hemi = new HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiIntensity);
        this.scene.add(hemi);
        const sun = new DirectionalLight(THEME.sun, THEME.sunIntensity);
        sun.position.set(120, 160, 80);
        // a bit stronger than the Three default (1) so packs/towers read clearly on the grass
        sun.shadow.intensity = 1.55;
        // frustum reaches past the field so the tree ring casts onto its edges
        sun.shadow.camera.left = -this.map.halfW - 40;
        sun.shadow.camera.right = this.map.halfW + 40;
        sun.shadow.camera.top = this.map.halfH + 40;
        sun.shadow.camera.bottom = -this.map.halfH - 40;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 500;
        this.scene.add(sun);

        this.sun = sun;
        this.hemi = hemi;
        this.blobShadows = new BlobShadows(this.scene);
        this.groundMesh = this.map.createMesh();
        this.scene.add(this.groundMesh);
        this.scenery = new Scenery(this.map);
        this.scene.add(this.scenery.group);
        this.inputDisposers.push(onPrefsChange(() => this.applyPrefs()));
        this.rallyVisuals = new RallyVisuals(this.scene, this.map);
        this.spellVisuals = new SpellVisuals(this.scene);
        this.gridOverlay = this.map.createOverlayMesh();
        this.scene.add(this.gridOverlay);
        this.projectileRenderer = new ProjectileRenderer(this.scene);
        this.particles = new Particles(this.scene);
        this.fireFx = new FireFx(this.particles, this.scene);
        this.hammerFx = new HammerFx(this.scene);
        this.meteorFx = new MeteorFx(this.scene);
        this.cloudFx = new CloudFx(this.scene);
        this.dragonFx = new DragonFx(this.scene);
        this.oilDripFx = new OilDripFx(this.scene);
        this.oilVisuals = new OilVisuals(this.scene, this.map);
        this.unitInstances = new UnitInstanceRenderer(this.scene);
        setUnitInstanceRenderer(this.unitInstances);
        this.applyShadowQuality();
        this.battleRangeMesh = createRangeRing(this.scene);

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map
        this.rig.setBounds(this.map.halfW - 8, this.map.halfH - 16);
        this.rig.fitMap(this.map.width, this.map.height, sceneryCameraFar());
        // open centered on the player's own zone (where the starting army
        // stands) — the far-side owner looks at the shared board rotated 180°
        const nearSide = side === 'a';
        this.rig.setBaseHeading(nearSide ? 0 : Math.PI);
        const ownZoneZ =
            (this.map.halfH - (this.map.size.zoneRows * CELL) / 2) * (nearSide ? 1 : -1);
        this.rig.startAt(0, ownZoneZ, 110);
        this.controls = new CameraControls(this.rig, surface);
        // edge scrolling is hover-based and has no touch equivalent
        const syncEdgeScroll = () => {
            this.controls.edgeScroll = inputMode() !== 'touch';
        };
        syncEdgeScroll();
        this.inputDisposers.push(onInputModeChange(syncEdgeScroll));
        this.rig.floorAt = worldHeightAt; // camera never dives into terrain
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        // one-finger drags aim the carried ghost/tactic instead of panning
        this.controls.suppressTouchPan = () => this.placement.pointerCarries;
        // gamepad: virtual cursor over the same click pipeline (Halo Wars style)
        this.gamepad = new GamepadCursor(surface, this.rig);
        this.gamepad.onActivity = () => noteGamepadActivity();
        this.gamepad.onRotate = () => this.placement.rotateSelected();
        this.gamepad.onMenu = () => this.togglePauseMenu();
        this.gamepad.onCancel = () => {
            if (this.cancelTacticPlacement()) return;
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
        };
        this.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
        this.weather = sceneryWeatherFx()
            ? this.scenery.createWeather(this.scene, sun, hemi, seedFrom(this.seed, 'weather'))
            : null;
        this.rngAi = mulberry32(seedFrom(this.seed, 'ai'));
        // specialist streams are keyed by canonical side (different draws);
        // round-card offers share one stream so both fighters see the same 4
        this.rngCards = {
            player: mulberry32(seedFrom(this.seed, `cards-${side}`)),
            enemy: mulberry32(seedFrom(this.seed, `cards-${side === 'a' ? 'b' : 'a'}`)),
        };
        this.rngRoundCards = mulberry32(seedFrom(this.seed, 'round-cards'));
        this.deployState = {
            limit: { player: settings.deploy.unitsPerRound, enemy: settings.deploy.unitsPerRound },
            extra: { player: 0, enemy: 0 },
            used: { player: 0, enemy: 0 },
            extrasSpent: { player: 0, enemy: 0 },
        };
        this.dispatcher = new ActionDispatcher({
            placement: this.placement,
            economy: this.economy,
            techTree: this.techTree,
            leveling: settings.leveling,
            towers: settings.towers,
            sellSettings: settings.sell,
            rallyRouteSettings: settings.rallyRoute,
            deploySettings: settings.deploy,
            boostSettings: settings.boosts,
            recruitLevel: this.recruitLevel,
            sellState: this.sellState,
            rallyRouteOwned: this.rallyRouteOwned,
            deployState: this.deployState,
            boostState: this.boostState,
            roundBoosts: this.roundBoosts,
            creditUsed: this.creditUsed,
            creditDebt: this.creditDebt,
            speciality: this.speciality,
            flankSpawnMult: this.flankSpawnMult,
            items: this.itemInventory,
            tactics: this.tacticInventory,
            rallyRoutes: this.rallyRoutes,
            rallyRouteIds: this.rallyRouteIds,
            oilField: this.oilField,
            oilBaseline: this.oilBaseline,
            oilStamps: this.oilStamps,
            oilStampIds: this.oilStampIds,
            spellStamps: this.spellStamps,
            spellStampIds: this.spellStampIds,
            roundCardTaken: this.roundCardTaken,
            deployReady: this.deployReady,
            unlockedUnits: this.unlockedUnits,
            unlockUsedThisRound: this.unlockUsedThisRound,
            hp: {
                get: (team) => (team === 'player' ? this.playerHp : this.enemyHp),
                set: (team, hp) => {
                    if (team === 'player') this.playerHp = hp;
                    else this.enemyHp = hp;
                },
            },
            clock: () => ({
                round: this.round,
                t: Math.max(0, this.settings.buildTimeSeconds - this.phaseRemaining),
            }),
            onEndDeployment: (team) => {
                if (this.phase !== 'build' || this.matchOver) return;
                if (team === 'player') {
                    // freeze local input; from here on the opponent's live
                    // (already-streamed) deployment becomes visible
                    this.placement.deselect();
                    this.placement.enabled = false;
                    this.armedItem = null;
                    this.cancelTacticPlacement();
                    this.placement.hiddenPlacements = false;
                    this.placement.revealAll();
                    this.enemyIntelSnapshot = null;
                }
                // the battle waits until BOTH sides have locked in
                if (this.deployReady.player && this.deployReady.enemy) this.startBattlePhase();
            },
        });
        this.opponent = this.net
            ? new NetworkOpponent()
            : new AiOpponent('enemy', {
                  dispatch: (action) => this.dispatcher.dispatch(action),
                  placement: this.placement,
                  economy: this.economy,
                  techTree: this.techTree,
                  unlockedUnits: this.unlockedUnits,
                  unlockUsedThisRound: this.unlockUsedThisRound,
                  items: this.itemInventory,
                  tactics: this.tacticInventory,
                  rng: this.rngAi,
              });
        this.placement.dispatch = (action) => this.dispatchPlayer(action);
        // gold pulse under packs whose next level is buyable right now
        this.placement.levelReady = (unit) => this.canLevel(unit);
        // freeze upgrade-arrow intel at phase start (survives enemy leveling mid-deploy)
        this.placement.upgradeReadyAtCapture = (unit) => this.packUpgradeReady(unit, unit.level, unit.xp);
        // an armed inventory item lands on the next own pack that gets clicked
        this.placement.onSelect = (unit) => {
            if (this.armedItem) {
                if (this.applyItemTo(unit, this.armedItem)) {
                    this.armedItem = null;
                    // equipping is not selecting — leave the pack unselected
                    this.placement.deselect();
                }
                return;
            }
            // buildings act through their details — auto-open the sheet (phone-only visual)
            if (unit.type.structure) this.hud.openUnitDetails();
        };
        this.placement.groundClickInterceptor = (x, y) => this.handleTacticGroundClick(x, y);
        this.controls.onMiddleClick = () => {
            if (this.armedTactic) return;
            this.placement.rotateSelected();
        };
        this.placement.rangeOf = (unit) => this.resolvedStats(unit).range;
        this.controls.onRightClick = () => {
            if (this.cancelTacticPlacement()) return;
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
        };
        this.hud = new Hud(
            pixiApp,
            wrapper,
            (type) => this.effectiveCost(type),
            (type) => this.buyUnit(type),
        );
        this.hud.setUnitIcons(renderAllUnitIcons(this.renderer));
        this.hud.onMenuToggle = () => this.togglePauseMenu();
        // touch stand-in for middle-click (rotate)
        this.hud.onTouchRotate = () => this.placement.rotateSelected();
        this.hud.onTouchPickUp = () => this.placement.pickUpSelected();
        this.hud.onUnlockPick = (typeId) => this.unlockUnit(typeId);
        this.hud.onQuitToMenu = () => this.quitToMenu();
        this.hud.setPlayers(this.playerNames.local, this.playerNames.opponent, settings.startingHp);
        this.hud.onEndDeployment = () => {
            if (this.phase === 'build') {
                this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
            }
        };
        this.hud.onSpeedUp = () => this.cycleSpeed(1);
        this.hud.onSpeedDown = () => this.cycleSpeed(-1);
        this.hud.onUndo = () => this.undoLast();
        this.hud.onSendChat = (item) => {
            const now = performance.now();
            if (now - this.lastChatSent < CHAT_COOLDOWN_MS) return;
            this.lastChatSent = now;
            this.hud.addChat(this.playerNames.local, item, 'local');
            this.broadcast({ type: 'chat', item, from: { name: this.playerNames.local, role: 'player' } });
        };
        this.hud.onArmItem = (itemId, index) => {
            if (!this.playerCanAct || this.armedTactic) return;
            // click the armed slot again to disarm; another slot re-arms there
            if (this.armedItem === itemId && this.armedItemIndex === index) {
                this.armedItem = null;
                this.armedItemIndex = null;
            } else {
                this.armedItem = itemId;
                this.armedItemIndex = index;
            }
        };
        this.hud.onArmTactic = (tacticId) => {
            if (!this.playerCanAct) return;
            if (this.armedTactic === tacticId) {
                this.cancelTacticPlacement();
                return;
            }
            this.armedItem = null;
            this.placement.deselect();
            this.armedTactic = tacticId;
            this.tacticDraftStart = null;
            this.placement.inputLocked = true;
            this.syncTacticVisuals();
        };
        this.hud.onCancelTactic = () => {
            this.cancelTacticPlacement();
        };
        this.hud.onResetPlacedTactic = (tacticId, routeId) => {
            // ids come from per-tactic counters — the tactic id disambiguates
            const tactic = TACTICS[tacticId];
            if (tactic && usesSpellPlacement(tactic)) this.resetPlacedSpell(routeId);
            else if (tacticId === OIL_SPILL_ID) this.resetPlacedOilSpill(routeId);
            else this.resetPlacedRallyRoute(routeId);
        };
        this.hud.onRecruitLevel = () => {
            // offered in the Command Tower's menu
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== RESEARCH_CENTER || unit.team !== 'player') return;
            if (this.dispatchPlayer({ kind: 'recruitLevel', team: 'player' })) {
                this.hud.refreshCosts(); // unit buttons now show the level-2 price
            }
        };
        this.hud.onUpgradeTower = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player' || !unit.type.structure) return;
            this.dispatchPlayer({ kind: 'upgradeTower', team: 'player', unitId: unit.id });
        };
        this.hud.onBuyBoost = (boost) => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== COMMAND_TOWER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyBoost', team: 'player', boost });
        };
        this.hud.onBuySellAbility = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== COMMAND_TOWER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buySellAbility', team: 'player' });
        };
        this.hud.onBuyRallyRouteAbility = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== COMMAND_TOWER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyRallyRouteAbility', team: 'player' });
        };
        this.hud.onBuyDeploySlot = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== RESEARCH_CENTER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyDeploySlot', team: 'player' });
        };
        this.hud.onBuyRoundRangeBoost = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== RESEARCH_CENTER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyRoundRangeBoost', team: 'player' });
        };
        this.hud.onBuyRoundSpeedBoost = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== RESEARCH_CENTER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyRoundSpeedBoost', team: 'player' });
        };
        this.hud.onBuyCredit = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== RESEARCH_CENTER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyCredit', team: 'player' });
        };
        this.hud.onBuyLevel = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            this.buyLevelFor(unit);
        };
        this.hud.onLevelAll = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            // every ready pack of the same kind, oldest first
            for (const u of this.levelablePacksOf(unit.type)) this.buyLevelFor(u);
        };
        this.hud.onLevelAllGlobal = () => {
            if (!this.playerCanAct) return;
            for (const u of this.allLevelablePacks()) {
                if (!this.buyLevelFor(u)) break;
            }
        };
        this.hud.onBuyTech = (techId) => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            this.dispatchPlayer({
                kind: 'buyTech',
                team: 'player',
                typeId: unit.type.id,
                techId,
            });
        };
        this.debug = new DebugOverlay(
            wrapper,
            new URLSearchParams(location.search).has('debug'),
        );
        pixiApp.stage.addChild(this.hpBars.view);

        // battle phase: left click selects a single mech, own or enemy
        const listen = (type: string, handler: EventListener) => {
            surface.addEventListener(type, handler);
            this.inputDisposers.push(() => surface.removeEventListener(type, handler));
        };
        listen('pointerdown', ((e: PointerEvent) => {
            if (e.button === 0) this.battleDown = { x: e.clientX, y: e.clientY };
        }) as EventListener);
        listen('pointerup', ((e: PointerEvent) => {
            if (e.button !== 0 || this.phase !== 'battle' || !this.battleDown) return;
            const moved = Math.hypot(e.clientX - this.battleDown.x, e.clientY - this.battleDown.y);
            this.battleDown = null;
            if (moved > 6) return;
            this.selectedActor = this.pickActor(e);
        }) as EventListener);

        // round 0: towers stand, then the loadout cards decide the starting
        // armies — the first build phase begins once BOTH sides picked
        this.spawnTowers();
        this.placement.enabled = false;
        if (resume) {
            this.hydrate(resume.actions, resume.battleElapsed, !resume.local);
            // replay always resets the round's clock to a fresh full timer
            // (it isn't logged as an action) — restore the true remaining
            // time from whoever exported, so a rebuild can't hand either
            // side extra deployment time
            if (resume.phaseRemaining !== undefined && this.phase === 'build') {
                this.phaseRemaining = resume.phaseRemaining;
            }
        } else {
            this.showStarterPick(this.draw(START_CARDS, 4, this.rngCards.player));
        }
        // only now may peer messages flow — everything they touch exists
        if (this.net) this.wireSession(this.net);
        if (resume && this.net && !resume.local) {
            // rebuilt from a peer reconnect (not a solo save) — hold ticking
            // until the peer confirms it's ready too; see awaitPeerReady()
            this.awaitPeerReady();
        }
        if (this.net && this.side === 'a') this.startSpectatorHub();

        // Escape toggles the in-game menu (the match keeps running underneath)
        window.addEventListener('keydown', this.onEscapeKey);

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', this.onWindowResize);
        pixiApp.ticker.add(this.boundTick);
    }

    /** stop the loop, release GPU/DOM resources — main restores the menu */
    /**
     * Live-applies prefs from the settings menu: scenery rebuild, DPR cap,
     * and unit shadow casting.
     */
    private applyPrefs(): void {
        if (this.disposed) return;
        this.applyRenderPrefs();
        this.applySceneryQuality();
    }

    private applyRenderPrefs(): void {
        const dpr = effectiveDpr();
        if (this.renderer.getPixelRatio() !== dpr) {
            this.renderer.setPixelRatio(dpr);
            this.resize(this.wrapper.clientWidth, this.wrapper.clientHeight);
        }
        this.unitInstances.applyShadowPref(prefs().shadows);
        this.meteorFx.applyShadowPref(prefs().shadows);
        this.unitInstances.applyDeadPref(prefs().renderDeadUnits);
        this.applyShadowQuality();
        const fireVfx = prefs().fireVfx;
        if (fireVfx !== this.appliedFireVfx) {
            this.appliedFireVfx = fireVfx;
            this.fireFx.setQuality(fireVfx);
        }
    }

    /** Live-applies sun shadow map type, resolution, blob discs, and unit casters. */
    private applyShadowQuality(): void {
        const tier = prefs().shadows;
        const scenery = prefs().scenery;
        const useMap = shadowUsesMap(tier);
        const useBlobs = shadowUsesBlobs(tier);
        const wasMap = this.renderer.shadowMap.enabled;
        const prevType = this.renderer.shadowMap.type;

        this.renderer.shadowMap.enabled = useMap;
        this.sun.castShadow = useMap;
        this.blobShadows.setEnabled(useBlobs);
        this.shadowMapFrame = 0;

        if (useMap) {
            const type: ShadowMapType =
                tier === 'medium' ? BasicShadowMap : PCFSoftShadowMap;
            this.renderer.shadowMap.type = type;

            const res = shadowMapSize(tier, scenery);
            if (this.sun.shadow.mapSize.x !== res) {
                this.sun.shadow.mapSize.set(res, res);
                this.sun.shadow.map?.dispose();
                this.sun.shadow.map = null;
            }

            this.sun.shadow.radius =
                tier === 'high' || tier === 'ultra' ? shadowSoftRadius(tier) : 1;
            // stronger than the constructor default so unit shadows read
            // clearly on the bright grass (blob discs set the reference look)
            this.sun.shadow.intensity = 1.85;
            this.sun.shadow.autoUpdate = shadowUpdateStride(tier) === 1;
            this.sun.shadow.needsUpdate = true;
        }

        // three bakes shadow receiving/filtering into compiled shaders — a
        // pass on/off toggle or filter change needs a material recompile
        if (wasMap !== useMap || (useMap && prevType !== this.renderer.shadowMap.type)) {
            this.scene.traverse((o) => {
                const m = (o as Mesh).material as
                    | import('three').Material
                    | import('three').Material[]
                    | undefined;
                if (!m) return;
                for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
            });
        }

        this.unitInstances.applyShadowPref(tier);
        this.meteorFx.applyShadowPref(tier);
        this.appliedShadows = tier;
    }

    private updateBlobShadows(): void {
        if (!shadowUsesBlobs()) {
            return;
        }
        const sources: BlobShadowSource[] = [];
        if (this.sim && this.phase === 'battle') {
            for (const a of this.sim.actors) {
                if (!a.alive) continue;
                const t = a.unit.type;
                if (t.structure || t.extra) continue;
                // flyers keep a (smaller) disc projected onto the ground below them
                const flying = a.altitude > 0;
                sources.push({
                    x: a.rx,
                    z: a.rz,
                    radius: Math.max(0.7, a.radius * (flying ? 0.9 : 1.15)),
                });
            }
        } else {
            for (const unit of this.placement.allUnits()) {
                if (unit.consumed || unit.destroyed) continue;
                if (!this.placement.enemyIntelVisible(unit)) continue;
                const t = unit.type;
                if (t.structure || t.extra) continue;
                // packs are several mechs — one disc per member, not per pack
                for (const p of this.placement.visibleMemberWorldPositions(unit)) {
                    sources.push({
                        x: p.x,
                        z: p.z,
                        radius: Math.max(0.7, t.collisionRadius * 1.15),
                    });
                }
            }
        }
        this.blobShadows.sync(sources);
    }

    /** Throttled shadow-map refresh for the Medium tier. */
    private tickShadowMapUpdate(): void {
        if (!shadowUsesMap()) return;
        const stride = shadowUpdateStride();
        if (stride === 1) {
            this.sun.shadow.autoUpdate = true;
            return;
        }
        this.sun.shadow.autoUpdate = false;
        this.shadowMapFrame = (this.shadowMapFrame + 1) % stride;
        if (this.shadowMapFrame === 0) {
            this.sun.shadow.needsUpdate = true;
        }
    }

    /**
     * Live-applies the scenery / ground-effects prefs from the settings menu:
     * rebuilds the ground, the outer world (incl. weather hooks) and the shadow map.
     */
    private applySceneryQuality(): void {
        const scenery = prefs().scenery;
        const groundEffects = prefs().groundEffects;
        if (
            scenery === this.appliedScenery &&
            groundEffects === this.appliedGroundEffects
        ) {
            return;
        }
        if (this.disposed) return;
        this.appliedScenery = scenery;
        this.appliedGroundEffects = groundEffects;
        this.map.setGroundEffects(groundEffects);
        this.sandBootstrapped = false;

        const disposeTree = (root: Object3D) =>
            root.traverse((o) => {
                const m = o as Mesh;
                if (!m.isMesh) return;
                m.geometry.dispose();
                for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
            });

        // battlefield ground + grid overlay (keep its current visibility)
        this.scene.remove(this.groundMesh);
        disposeTree(this.groundMesh);
        this.groundMesh = this.map.createMesh();
        this.scene.add(this.groundMesh);
        const gridVisible = this.gridOverlay.visible;
        this.scene.remove(this.gridOverlay);
        disposeTree(this.gridOverlay);
        this.gridOverlay = this.map.createOverlayMesh();
        this.gridOverlay.visible = gridVisible;
        this.scene.add(this.gridOverlay);

        // outer world + weather (restore the current scenario)
        const currentWeather = this.weather?.currentId ?? 'sunny';
        this.scene.remove(this.scenery.group);
        disposeTree(this.scenery.group);
        this.scenery = new Scenery(this.map);
        this.scene.add(this.scenery.group);
        if (sceneryWeatherFx(scenery)) {
            if (!this.scene.fog) this.scene.fog = new Fog(THEME.sky, THEME.fogNear, THEME.fogFar);
            this.weather = this.scenery.createWeather(this.scene, this.sun, this.hemi, seedFrom(this.seed, 'weather'));
            this.weather.setTarget(currentWeather);
        } else {
            // weather off: no fog and the default calm daylight
            this.weather = null;
            this.scene.fog = null;
            (this.scene.background as Color).setHex(THEME.sky);
            this.sun.color.setHex(THEME.sun);
            this.sun.intensity = THEME.sunIntensity;
            this.sun.position.set(120, 160, 80);
            this.hemi.color.setHex(THEME.hemiSky);
            this.hemi.groundColor.setHex(THEME.hemiGround);
            this.hemi.intensity = THEME.hemiIntensity;
        }

        // shadow resolution (force the render target to reallocate)
        this.applyShadowQuality();

        this.rig.setWorldFar(sceneryCameraFar(scenery));

        // ground-mist strength is baked into the fog shader chunk — re-bake
        // for the new tier and recompile every fogged material still alive
        // (the rebuilt ground/scenery materials compile fresh anyway)
        setHeightFogStrength(sceneryHeightFog(scenery));
        this.scene.traverse((o) => {
            const m = (o as Mesh).material as import('three').Material | import('three').Material[] | undefined;
            if (!m) return;
            for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
        });
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.onStateCheckpoint = null;
        this.onReturnToMenu = null;
        this.onConnectionLost = null;
        this.pixiApp.ticker.remove(this.boundTick);
        window.removeEventListener('keydown', this.onEscapeKey);
        window.removeEventListener('resize', this.onWindowResize);
        for (const dispose of this.inputDisposers) dispose();
        this.inputDisposers.length = 0;
        this.placement.dispose();
        this.blobShadows.dispose();
        this.unitInstances.dispose();
        setUnitInstanceRenderer(null);
        this.rallyVisuals.dispose();
        this.spellVisuals.dispose();
        this.hammerFx.dispose();
        this.meteorFx.dispose();
        this.cloudFx.dispose();
        this.dragonFx.dispose();
        this.oilDripFx.dispose();
        this.controls.dispose();
        this.gamepad.dispose();
        this.hud.destroy();
        this.pixiApp.stage.removeChild(this.hpBars.view);
        this.hpBars.view.destroy({ children: true });
        this.debug.destroy();
        // drop any HTML HUD nodes still attached to the pixi canvas (html-in-canvas mode)
        for (const node of [...this.pixiApp.canvas.children]) {
            if (node instanceof HTMLElement) node.remove();
        }
        disposeScene(this.scene);
        this.renderer.dispose();
        this.net?.close();
        this.net = null;
        this.spectatorHub?.close();
        this.spectatorHub = null;
        this.stopSpectateRegistration?.();
        this.stopSpectateRegistration = null;
    }

    /**
     * Each side's three base buildings (anchors shared with BattleMap so the
     * ground relief stays flat underneath): the Command Tower left and the
     * Research Center right, both pushed toward the enemy, plus the big
     * Stronghold at the back center.
     */
    private spawnTowers(): void {
        const { flankCols, zoneCols, zoneRows } = this.map.size;
        const buildings = [
            { anchor: BASE_ANCHORS.research, type: RESEARCH_CENTER },
            { anchor: BASE_ANCHORS.command, type: COMMAND_TOWER },
            { anchor: BASE_ANCHORS.stronghold, type: STRONGHOLD },
        ];
        for (const { anchor, type } of buildings) {
            const fp = type.footprint;
            const centerRow = Math.round(zoneRows * anchor.rowFrac - fp.rows / 2);
            const col = flankCols + Math.round(zoneCols * anchor.xFrac) - Math.floor(fp.cols / 2);
            // the far side's base is the near layout rotated 180°, so each
            // player sees their own command tower left, research center right
            const near = { col, row: centerRow };
            const far = {
                col: this.map.cols - col - fp.cols,
                row: this.map.rows - centerRow - fp.rows,
            };
            const ownFar = this.map.ownAtFar;
            this.placement.spawn(type, ownFar ? far : near, 'player');
            this.placement.spawn(type, ownFar ? near : far, 'enemy');
        }
    }

    /**
     * SP cheat (U): free-spawn every unit type on both sides during
     * deployment (3 dwarf packs, 1 of each other type), bump HP sky-high,
     * top up tactics, grant +5000 supply and one of each item to both sides,
     * scramble levels, then let the AI re-spend — enemy moves stay behind
     * intel fog; newly granted enemy packs are snapshotted at land pose.
     */
    private cheatSpawnAllUnits(): void {
        if (this.phase !== 'build' || this.matchOver) return;

        const CHEAT_HP = 999_999;
        this.playerHp = CHEAT_HP;
        this.enemyHp = CHEAT_HP;
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.cheatGrantSupply(5000);
        this.cheatGrantAllTactics();
        this.cheatGrantAllItems();
        // sidebar intel: show the freshly granted bag without lifting pack fog
        this.captureEnemyIntelSnapshot();

        const knownEnemy = new Set(
            this.placement.allUnits().filter((u) => u.team === 'enemy').map((u) => u.id),
        );

        for (const team of ['player', 'enemy'] as const) {
            for (const type of UNIT_TYPES) {
                if (type.id === 'shield' || type.id === 'rocket') continue; // extras clutter the test field
                const copies = type.id === 'dwarf' ? 3 : 1;
                for (let i = 0; i < copies; i++) {
                    const spot = this.placement.findStartSpot(team, type);
                    if (!spot) break;
                    this.placement.spawn(type, spot, team, false, true);
                }
            }
        }

        // scramble veterancy on every pack so level badges / panel LVL differ
        const unitMax = this.settings.leveling.maxLevel;
        const towerMax = this.settings.towers.upgrade.maxLevel;
        for (const unit of this.placement.allUnits()) {
            if (unit.type.structure && !unit.type.extra) {
                unit.level = 1 + Math.floor(Math.random() * towerMax);
            } else if (!unit.type.structure) {
                unit.level = 1 + Math.floor(Math.random() * unitMax);
                if (unit.level < unitMax) {
                    const need = xpThresholdFor(
                        unit.type,
                        unit.level,
                        this.economy,
                        this.settings.leveling,
                    );
                    // some packs bank enough XP to show the upgrade arrow
                    unit.xp = Math.random() < 0.45 ? need : Math.floor(Math.random() * need);
                } else {
                    unit.xp = 0;
                }
            }
            unit.refreshLevelBadge();
        }

        // newly granted enemy packs: visible at land pose; later AI moves stay fogged
        for (const unit of this.placement.allUnits()) {
            if (unit.team !== 'enemy' || knownEnemy.has(unit.id)) continue;
            this.placement.rememberIntelPose(unit);
        }

        // AI already locked in at phase start — re-run buys/moves/items/spells/upgrades
        // behind fog (existing packs stay at phase-start pose)
        this.opponent.rerunBuildActions?.();
    }

    /** A new round: place freely, hidden from the opponent, until timer or button. */
    private startBuildPhase(): void {
        this.resetSpeed();
        this.round++;
        this.weather?.onRound(this.round);
        this.phase = 'build';
        this.phaseRemaining = this.settings.buildTimeSeconds;
        // scars fade each round so the field heals over a few battles
        if (this.round > 1) this.map.fadeWear(0.68);
        this.placement.beginDeployment();
        this.placement.enabled = true;
        this.placement.hiddenPlacements = true;
        this.placement.currentRound = this.round; // earlier deployments are locked now
        this.selectedActor = null;
        this.hpBars.clear();
        this.rallyRoutes.length = 0;
        this.cancelTacticPlacement();
        // oil + acid: expire old cells, snapshot baseline for this deployment's
        // undo, clear stamps (this round's oil is outline-only until battle;
        // acid's spellStamps persist across rounds already — only its expiry
        // and baseline snapshot need to run here)
        this.oilField.expireOilBefore(this.round);
        this.oilField.expireAcidBefore(this.round);
        this.oilBaseline.oilExpires.set(this.oilField.oilExpires);
        this.oilBaseline.acidExpires.set(this.oilField.acidExpires);
        this.oilStamps.length = 0;
        this.oilVisuals.setDraft(null);
        this.oilVisuals.sync(this.oilField, 0, [], true);
        this.syncTacticVisuals();
        // flanks and the neutral strip open up after the first round
        const unlocked = this.round >= 2;
        if (unlocked !== this.map.flanksUnlocked) {
            this.map.flanksUnlocked = unlocked;
            this.map.neutralUnlocked = unlocked;
            this.refreshOverlay();
        }
        this.gridOverlay.visible = true;
        // elite specialists recruit at level 2 permanently (and free of premium)
        this.recruitLevel.player = this.speciality.player === 'elite' ? 2 : 1;
        this.recruitLevel.enemy = this.speciality.enemy === 'elite' ? 2 : 1;
        this.sellState.used.player = 0;
        this.sellState.used.enemy = 0;
        this.deployState.extra.player = 0;
        this.deployState.extra.enemy = 0;
        this.roundBoosts.range.player = false;
        this.roundBoosts.range.enemy = false;
        this.roundBoosts.speed.player = false;
        this.roundBoosts.speed.enemy = false;
        this.creditUsed.player = false;
        this.creditUsed.enemy = false;
        this.deployState.used.player = 0;
        this.deployState.used.enemy = 0;
        this.deployState.extrasSpent.player = 0;
        this.deployState.extrasSpent.enemy = 0;
        this.deployReady.player = false;
        this.deployReady.enemy = false;
        this.battleReady.player = false;
        this.battleReady.enemy = false;
        this.unlockUsedThisRound.player = false;
        this.unlockUsedThisRound.enemy = false;
        this.hud.refreshCosts();
        this.refreshShopHud();
        this.economy.grantRoundIncome(this.round);
        // Command Tower Credit debt from last round — after income so it always covers
        // NOTE: must also run while hydrating (debt is never in the action log)
        const creditDebtAmount = this.settings.deploy.creditDebt;
        for (const team of ['player', 'enemy'] as const) {
            if (this.creditDebt[team]) {
                this.economy.debit(team, creditDebtAmount);
                this.creditDebt[team] = false;
            }
        }
        // card speciality income and gifts
        for (const team of ['player', 'enemy'] as const) {
            if (this.speciality[team] === 'costControl') {
                this.economy.credit(team, COST_CONTROL_INCOME);
            }
            // the elite's round-1 top-up: exactly two level-2 units at 150
            if (this.speciality[team] === 'elite' && this.round === 1) {
                this.economy.credit(team, ELITE_ROUND1_BONUS);
            }
            // NOTE: must also run while hydrating — the gift is never in the
            // action log, so a rebuild that skipped it would produce a
            // different board (and shifted unit ids → guaranteed desync)
            if (this.speciality[team] === 'archer' && this.round === FREE_ARCHER_ROUND) {
                const type = unitTypeById('archer')!;
                const anchor = this.placement.findStartSpot(team, type);
                const unit = anchor ? this.placement.spawn(type, anchor, team, false, true) : null;
                if (unit) {
                    unit.level = FREE_ARCHER_LEVEL;
                    unit.refreshLevelBadge();
                }
            }
        }
        this.placement.captureIntelSnapshot();
        this.placement.setIntelFog(true);
        this.captureEnemyIntelSnapshot();
        // replay applies every action from the log — only run live AI when not rebuilding
        if (!this.hydrating) {
            this.opponent.onBuildPhase(this.round);
        }

        // from round 2 on, both sides get a card offer at the round's start
        if (this.round >= 2) this.offerRoundCards();
    }

    /**
     * SP cheat (U): top up every tactic's charge count so the whole strip is
     * immediately usable with no cooldown wait — call again each round to
     * keep testing a spell (e.g. dragon breath) back to back. NOT logged as
     * an action, so it does not survive a reload/replay — press it again
     * after one.
     */
    private cheatGrantAllTactics(): void {
        // comfortably above the highest cooldownRounds (3) so cooling charges
        // never eat into the pool
        const CHEAT_CHARGE_COUNT = 6;
        for (const team of ['player', 'enemy'] as const) {
            for (const id of CHEAT_TACTIC_GRANTS) {
                const have = this.tacticInventory[team].filter((t) => t === id).length;
                for (let i = have; i < CHEAT_CHARGE_COUNT; i++) {
                    this.tacticInventory[team].push(id);
                }
            }
        }
    }

    /** SP cheat (U): +supply to both sides (same amount each press). */
    private cheatGrantSupply(amount = 5000): void {
        this.economy.credit('player', amount);
        this.economy.credit('enemy', amount);
    }

    /** SP cheat (U): ensure both inventories have one of every pack item. */
    private cheatGrantAllItems(): void {
        for (const team of ['player', 'enemy'] as const) {
            for (const id of Object.keys(ITEMS)) {
                if (!this.itemInventory[team].includes(id)) {
                    this.itemInventory[team].push(id);
                }
            }
        }
    }

    /** local player input — refused once this deployment is locked in; every
     *  accepted action streams to the peer immediately */
    private dispatchPlayer(action: Action): boolean {
        if (this.deployReady.player || this.suspended) return false;
        if (!this.dispatcher.dispatch(action)) return false;
        if (this.round >= 1) this.broadcast({ type: 'action', round: this.round, action });
        return true;
    }

    /** the chosen specialist card of a side (null until picked) */
    private starterCardOf(team: Team): StartCard | null {
        const spec = this.speciality[team];
        return spec ? (START_CARDS.find((c) => c.speciality === spec) ?? null) : null;
    }

    /** speciality names under the commander names — the opponent's pick stays
     *  hidden until BOTH have chosen (no counter-picking) */
    private syncSpecialities(): void {
        const own = this.starterCardOf('player');
        const opp = this.starterCardOf('enemy');
        this.hud.setSpecialities(own, own && opp ? opp : null);
    }

    /** local specialist is locked in — if the peer is still picking, show ours centered */
    private afterStarterPick(): void {
        this.refreshShopHud();
        this.maybeStartMatch();
        this.syncSpecialities();
        if (this.awaitingCards && this.round === 0) {
            const own = this.starterCardOf('player');
            if (own) this.hud.showWaitingCard(own);
        }
    }

    /** the specialist overlay (also re-shown after a resume that predates the pick) */
    private showStarterPick(offer: StartCard[]): void {
        this.playerStarterOffer = [...offer];
        // the pick has its own short clock — expiry auto-picks at random
        this.phaseRemaining = this.settings.specialistTimeSeconds;
        this.hud.showStartCards(offer, (cardId) => {
            this.playerStarterOffer = null;
            this.dispatchPlayer({ kind: 'chooseCard', team: 'player', cardId });
            this.broadcast({ type: 'starter', cardId });
            this.opponent.chooseStarter(this.draw(START_CARDS, 4, this.rngCards.enemy));
            this.afterStarterPick();
        });
    }

    /** timer ran out before the player picked a specialist — choose one at random.
     *  Plain Math.random is correct here: the pick is broadcast/logged as an
     *  action, and consuming the seeded card stream for a timing-dependent
     *  event would desync future offers from what a rebuild computes. */
    private autoPickSpecialist(): void {
        if (this.speciality.player !== null || !this.playerStarterOffer?.length) return;
        const pick =
            this.playerStarterOffer[
                Math.floor(Math.random() * this.playerStarterOffer.length)
            ]!;
        this.hud.hideCardOverlay();
        this.playerStarterOffer = null;
        this.dispatchPlayer({ kind: 'chooseCard', team: 'player', cardId: pick.id });
        this.broadcast({ type: 'starter', cardId: pick.id });
        this.opponent.chooseStarter(this.draw(START_CARDS, 4, this.rngCards.enemy));
        this.afterStarterPick();
    }

    /** timer ran out during deployment with the round-card overlay still open — skip */
    private autoSkipRoundCard(): void {
        if (this.round < 2 || this.roundCardTaken.player || !this.awaitingCards) return;
        this.hud.hideCardOverlay();
        this.dispatchPlayer({ kind: 'roundCard', team: 'player', cardId: null });
        this.awaitingCards = false;
    }

    /** build-phase clock hit zero — resolve any open card pick, then lock in */
    private onDeployTimerExpired(): void {
        if (this.round === 0 && this.speciality.player === null) {
            this.autoPickSpecialist();
            return;
        }
        if (this.phase !== 'build' || this.deployReady.player) return;
        this.autoSkipRoundCard();
        this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
    }

    // --- spectators (hub is host-only; roster is readable from either side) -

    /** the guest has no hub of its own — it just tracks whatever the host broadcasts */
    private receivedRoster: RosterEntry[] = [];

    /** everyone currently seated at the match, for future UI use — the host
     *  always has the live answer, the guest has whatever it was last told */
    roster(): RosterEntry[] {
        return this.side === 'a' ? this.buildRoster() : this.receivedRoster;
    }

    /** everyone currently seated at the match, for roster display */
    private buildRoster(): RosterEntry[] {
        return [
            { name: this.playerNames.local, role: 'player', team: 'player' },
            { name: this.playerNames.opponent, role: 'player', team: 'enemy' },
            ...(this.spectatorHub?.names().map((name) => ({ name, role: 'spectator' as const })) ?? []),
        ];
    }

    private broadcastRoster(): void {
        this.broadcast({ type: 'roster', entries: this.buildRoster() });
    }

    /** sends to the opponent AND mirrors to any connected spectators */
    private broadcast(msg: NetMessage): void {
        this.net?.send(msg);
        this.mirrorToSpectators(msg);
    }

    /** relays something we already handled (sent OR just received from the
     *  opponent) out to spectators — never echoed back onto `this.net`,
     *  that's the peer who either sent it to us or already has it */
    private mirrorToSpectators(msg: NetMessage): void {
        this.spectatorHub?.broadcast(msg);
    }

    /**
     * Host-only: opens the dedicated spectator broadcast Peer for this
     * match's lifetime. Best-effort — if it fails to open (e.g. offline),
     * spectating just isn't available this match; it never blocks or
     * disrupts play, which only ever depends on `this.net`.
     */
    private startSpectatorHub(): void {
        void (async () => {
            let hub: SpectatorHub;
            try {
                hub = await SpectatorHub.open();
            } catch {
                return;
            }
            if (this.disposed || this.matchOver) {
                hub.close();
                return;
            }
            this.spectatorHub = hub;
            // discoverable under the same room name a "Host Room" match
            // already uses — spectators look it up the same way a joining
            // player would find the room
            this.stopSpectateRegistration = registerSpectateEndpoint(hub.peerId, this.playerNames.local);
            hub.onRosterChange = () => this.broadcastRoster();
            hub.onSpectatorChat = (name, item) => {
                const relayed: NetMessage = { type: 'chat', item, from: { name, role: 'spectator' } };
                this.net?.send(relayed);
                hub.broadcast(relayed);
            };
            hub.listen((name, version, conn) => {
                if (version !== GAME_VERSION) {
                    conn.send({ type: 'spectateRejected', reason: 'Version mismatch' });
                    conn.close();
                    return;
                }
                conn.send({
                    type: 'spectateAccepted',
                    version: GAME_VERSION,
                    ...this.exportResume(),
                    roster: this.buildRoster(),
                });
                hub.admit(name, conn);
            });
        })();
    }

    /** connects (or re-connects) a peer session to this game */
    private wireSession(session: NetSession): void {
        this.net = session;
        session.attach((msg) => this.onNetMessage(msg));
        session.onClose = () => {
            if (this.matchOver) return;
            if (this.onConnectionLost) this.onConnectionLost();
            else {
                this.matchOver = true;
                this.hud.showDisconnect();
            }
        };
    }

    // --- reconnect / resync ------------------------------------------------

    /** pause everything (connection lost / desync) behind a blocking notice */
    suspend(message: string): void {
        if (this.disposed) return;
        this.suspended = true;
        this.hud.hidePauseMenu();
        this.placement.deselect();
        this.armedItem = null;
        this.hud.showNotice(message, 'Give up — back to menu', () => this.quitToMenu());
    }

    /** leave the match — main tears down the session and restores the menu */
    quitToMenu(): void {
        this.onStateCheckpoint = null;
        this.net?.close();
        this.net = null;
        this.onReturnToMenu?.();
    }

    /** connection lost: pause behind a live countdown; forfeitWin() fires if
     *  the peer hasn't reconnected by the time it hits zero */
    beginReconnectGrace(seconds: number): void {
        if (this.disposed || this.matchOver) return;
        // a second onConnectionLost for the same drop (belt-and-suspenders
        // alongside NetSession's own single-fire guard) shouldn't restart
        // an already-running countdown
        if (this.reconnectGraceRemaining !== null) return;
        this.suspended = true;
        this.localReady = false;
        this.peerReady = false;
        this.hud.hidePauseMenu();
        this.placement.deselect();
        this.armedItem = null;
        this.reconnectGraceRemaining = seconds;
        this.hud.showReconnectWait(() => this.quitToMenu());
        this.hud.updateReconnectWait(seconds);
    }

    /** the connection is back on a fresh session — but stay paused until the
     *  peer confirms it's actually ready too (see awaitPeerReady) */
    resumeWith(session: NetSession): void {
        if (this.disposed || this.matchOver) {
            session.close();
            return;
        }
        this.reconnectGraceRemaining = null;
        this.onReconnectTimeout = null;
        this.wireSession(session);
        this.awaitPeerReady();
    }

    /**
     * Reconnect handshake, phase 2: the transport is back, but a peer that
     * had to reload pays several real seconds loading 3D assets before its
     * own clock can start. If a survivor (never reloaded) resumed ticking
     * immediately, that entire load gap would drain out of ONLY its own
     * deployment timer. Both sides hold suspended here until each has told
     * the other "ready" — a survivor sends it right away (nothing to load);
     * a rebuilt peer sends it once construction/hydrate is fully done.
     */
    private awaitPeerReady(): void {
        this.localReady = true;
        this.suspended = true;
        this.hud.hideReconnectWait();
        this.hud.showNotice(
            'Reconnected — waiting for the opponent to finish loading…',
            'Give up',
            () => this.quitToMenu(),
        );
        this.net?.send({ type: 'ready' });
        if (this.peerReady) this.confirmBothReady();
    }

    /** both sides confirmed — resume together, then resend anything the peer
     *  might have missed at disconnect time */
    private confirmBothReady(): void {
        this.suspended = false;
        this.hud.hideNotice();
        this.resendGateSignals();
    }

    /**
     * After ANY reconnect (not just a page reload): resend whichever "gate"
     * signal we've already locally committed to but the peer may be missing
     * — a message dropped exactly at the moment the connection died is
     * otherwise gone for good, and if it's one of these, the peer can get
     * stuck waiting forever (deployReady/battleReady never flips, and it
     * never reaches the point where the existing battle-start desync check
     * would even run). Resending is safe: dispatch() rejects an
     * already-applied gate action as a harmless no-op.
     *
     * A blind state-hash comparison here (instead of a targeted resend) was
     * tried and reverted — during round 0 (before both sides have picked) or
     * mid-deployment (before both lock in), the two sides' state is
     * legitimately, momentarily asymmetric while ordinary in-flight messages
     * are still catching up, which isn't a desync. Hashing at that point
     * produces false mismatches; the original check only ever ran at battle
     * start, a point structurally guaranteed to be fully converged (reliable
     * ordered delivery + the deployReady gate), which is why it never had
     * this problem.
     */
    private resendGateSignals(): void {
        if (!this.net) return;
        if (this.round === 0) {
            const own = this.starterCardOf('player');
            if (own) this.net.send({ type: 'starter', cardId: own.id });
            return;
        }
        if (this.phase === 'build' && this.deployReady.player) {
            this.net.send({
                type: 'action',
                round: this.round,
                action: { kind: 'endDeployment', team: 'player' },
            });
        }
        if (this.battleReady.player) {
            this.net.send({ type: 'battleEnd', round: this.round });
        }
    }

    /** everything a rejoining peer needs to rebuild the match (our perspective) */
    exportResume(): {
        seed: number;
        settings: GameSettings;
        actions: LoggedAction[];
        battleElapsed: number | null;
        phaseRemaining: number;
    } {
        return {
            seed: this.seed,
            settings: this.settings,
            actions: this.dispatcher.serializable(),
            battleElapsed: this.phase === 'battle' && this.sim ? this.sim.elapsed : null,
            phaseRemaining: this.phaseRemaining,
        };
    }

    /**
     * Rebuilds the whole match from a recorded log: actions re-apply in
     * order, battles fast-forward headlessly to their exact deterministic
     * end. Used for reconnects, desync recovery — and replays later.
     */
    private hydrate(
        sourceLog: LoggedAction[],
        liveBattleElapsed: number | null = null,
        swapTeams = true,
    ): void {
        this.hydrating = true;
        // foreign logs (peer export) flip teams; our own single-player save does not
        const log = swapTeams
            ? sourceLog.map((e) => ({ ...e, action: this.swapPerspective(e.action) }))
            : sourceLog;
        const starterOffer = this.draw(START_CARDS, 4, this.rngCards.player);
        this.draw(START_CARDS, 4, this.rngCards.enemy);

        let i = 0;
        while (i < log.length && !this.matchOver) {
            const entry = log[i]!;
            if (entry.round === 0) {
                this.dispatcher.dispatch(entry.action);
                i++;
                this.maybeStartMatch();
                continue;
            }
            if (this.awaitingCards || entry.round !== this.round || this.phase !== 'build') break;
            this.dispatcher.dispatch(entry.action);
            i++;
            if ((this.phase as Phase) === 'battle') {
                // historical battles run to their exact end; the battle the
                // peer is WATCHING right now only catches up to their clock
                const isLiveBattle = i >= log.length && liveBattleElapsed !== null;
                this.fastForwardBattle(isLiveBattle ? liveBattleElapsed : undefined);
            }
        }
        this.hydrating = false;

        // reopen whatever decision was pending when the state was captured
        if (this.speciality.player === null) {
            this.showStarterPick(starterOffer);
        } else if (this.pendingOffer && !this.roundCardTaken.player && this.phase === 'build') {
            this.awaitingCards = true;
            this.showRoundOffer(this.pendingOffer);
        }
        this.pendingOffer = null;
        this.hud.refreshCosts();
        this.refreshShopHud();
        this.syncSpecialities(); // restore the fighter-card labels after a rebuild
    }

    /** runs the current battle headlessly — fully, or just up to `toElapsed`
     *  (rejoining a battle the peer is still watching) */
    private fastForwardBattle(toElapsed?: number): void {
        const target = toElapsed ?? Infinity;
        while (this.sim && !this.sim.finished && this.sim.elapsed < target) {
            this.sim.update(0.25);
            this.sim.consumeEvents(); // discard visuals
        }
        if (!this.sim) return;
        this.phaseRemaining = this.settings.battleTimeSeconds - this.sim.elapsed;
        if (toElapsed === undefined) {
            this.endBattlePhase();
        } else {
            // stay in the battle: normal playback continues from here
            this.sim.syncMeshes();
        }
    }

    /**
     * Flips team and unit-id parity — translates actions between the two
     * perspectives (the peer's 'player' is our 'enemy'; coordinates pass
     * through untouched because both peers hold the identical board).
     * NEW ACTION KINDS THAT CARRY UNIT IDS MUST BE ADDED HERE — a missed
     * case desyncs peers silently.
     */
    private swapPerspective(action: Action): Action {
        const team: Team = action.team === 'player' ? 'enemy' : 'player';
        const flipId = (id: number) => (id % 2 === 0 ? id + 1 : id - 1);
        switch (action.kind) {
            case 'move':
            case 'rotate':
            case 'buyLevel':
            case 'sellUnit':
            case 'upgradeTower':
            case 'applyItem':
                return { ...action, team, unitId: flipId(action.unitId) };
            case 'moveGroup':
                return { ...action, team, unitIds: action.unitIds.map(flipId) };
            default:
                return { ...action, team };
        }
    }

    /** canonical state fingerprint, exchanged at battle start to catch desyncs */
    private stateHash(): number {
        const buffer = new DataView(new ArrayBuffer(8));
        let h = 0x811c9dc5;
        const mix = (v: number) => {
            buffer.setFloat64(0, v);
            h = Math.imul(h ^ buffer.getUint32(0), 0x9e3779b1);
            h = Math.imul(h ^ buffer.getUint32(4), 0x9e3779b1);
        };
        const hostParity = this.side === 'a' ? 0 : 1;
        const hostFirst = (player: number, enemy: number) =>
            this.side === 'a' ? [player, enemy] : [enemy, player];
        mix(this.round);
        for (const v of hostFirst(this.playerHp, this.enemyHp)) mix(v);
        for (const v of hostFirst(this.economy.balance('player'), this.economy.balance('enemy'))) mix(v);
        for (const a of this.sim?.actors ?? []) {
            const id = a.unit.id;
            mix((id >> 1) * 2 + (id % 2 === hostParity ? 0 : 1));
            mix(a.x);
            mix(a.z);
            mix(a.hp);
            mix(a.unit.level);
        }
        // shared oil layer — must match on both peers before battle
        const oil = this.oilField.oilExpires;
        for (let i = 0; i < oil.length; i++) {
            const v = oil[i]!;
            if (v !== 0) {
                mix(i);
                mix(v);
            }
        }
        return h >>> 0;
    }

    private verifyCheck(round: number): void {
        const mine = this.sentChecks.get(round);
        const theirs = this.peerChecks.get(round);
        if (mine === undefined || theirs === undefined || mine === theirs) return;
        // desync: the guest rebuilds from the host's log (reload + resume);
        // the host just waits — the guest's reload drops the connection,
        // which flows into the normal reconnect path
        if (this.side === 'b') {
            // guard against a reload loop if the divergence is persistent
            const guard = sessionStorage.getItem('mechili-desync-guard');
            if (guard === String(round)) {
                this.suspend('Persistent desync — this match cannot continue.');
                return;
            }
            sessionStorage.setItem('mechili-desync-guard', String(round));
            location.reload();
        } else {
            this.suspend('Desync detected — the opponent is resyncing…');
        }
    }

    /** the player may act: build phase, not locked in, match running, peer present */
    private get playerCanAct(): boolean {
        return (
            this.phase === 'build' && !this.deployReady.player && !this.matchOver && !this.suspended
        );
    }

    /** round 1 begins once BOTH specialists are chosen (the peer's may lag) */
    private maybeStartMatch(): void {
        if (!this.awaitingCards || this.round > 0) return;
        if (!this.speciality.player || !this.speciality.enemy) return;
        this.awaitingCards = false;
        this.hud.hideCardOverlay(); // the waiting card, if one is up
        this.syncSpecialities();
        this.startBuildPhase();
        // reveal both picks for a beat, then it auto-dismisses into deployment
        if (!this.hydrating) {
            const own = this.starterCardOf('player');
            const opp = this.starterCardOf('enemy');
            if (own && opp) {
                this.hud.showSpecialistReveal(own, opp, this.playerNames);
                window.setTimeout(() => {
                    if (!this.disposed) this.hud.dismissReveal();
                }, SPECIALIST_REVEAL_MS);
            }
        }
    }

    private onNetMessage(msg: NetMessage): void {
        if (this.disposed || this.matchOver) return;
        if (msg.type === 'starter') {
            this.mirrorToSpectators(msg);
            this.dispatcher.dispatch({ kind: 'chooseCard', team: 'enemy', cardId: msg.cardId });
            this.refreshShopHud();
            this.syncSpecialities();
            this.maybeStartMatch();
        } else if (msg.type === 'action') {
            this.mirrorToSpectators(msg);
            this.remoteQueue.push({ round: msg.round, action: msg.action });
            this.drainRemoteQueue();
        } else if (msg.type === 'undo') {
            this.mirrorToSpectators(msg);
            this.remoteQueue.push({ round: msg.round, undo: true });
            this.drainRemoteQueue();
        } else if (msg.type === 'check') {
            this.peerChecks.set(msg.round, msg.hash);
            this.verifyCheck(msg.round);
        } else if (msg.type === 'chat') {
            // clamp the peer's rate too (P2P — never trust the sender) and
            // re-truncate text before it reaches the DOM
            const now = performance.now();
            if (now - this.lastChatReceived < CHAT_COOLDOWN_MS * 0.5) return;
            this.lastChatReceived = now;
            const item: ChatItem =
                msg.item.kind === 'text'
                    ? { kind: 'text', text: String(msg.item.text).slice(0, CHAT_TEXT_LIMIT) }
                    : msg.item;
            if (msg.from.role === 'player') {
                // this.net's only possible player-role sender is the opponent —
                // use our own trusted record rather than their (unverified) claim
                this.hud.addChat(this.playerNames.opponent, item, 'remote');
                this.mirrorToSpectators({
                    type: 'chat',
                    item,
                    from: { name: this.playerNames.opponent, role: 'player' },
                });
            } else {
                // a spectator's chat, relayed to us by the host — no UI surface
                // for this yet (spectator chat renders separately from player
                // chat, per design; that view doesn't exist yet). Never
                // attribute it to the opponent.
            }
        } else if (msg.type === 'speed') {
            this.mirrorToSpectators(msg);
            const index = Game.SPEED_STEPS.indexOf(msg.multiplier);
            if (index >= 0) {
                this.speedIndex = index;
                this.hud.setSpeed(msg.multiplier);
            }
        } else if (msg.type === 'resume') {
            // the peer reloaded and rebuilt mid-session (rare direct path)
            this.net?.send({ type: 'state', version: GAME_VERSION, ...this.exportResume() });
        } else if (msg.type === 'battleEnd') {
            this.mirrorToSpectators(msg);
            if (msg.round === this.round) {
                this.battleReady.enemy = true;
                this.maybeStartNextRound();
            }
        } else if (msg.type === 'ready') {
            this.peerReady = true;
            if (this.localReady && this.suspended) this.confirmBothReady();
        } else if (msg.type === 'roster') {
            // only the host actually tracks spectators (see buildRoster());
            // the guest just holds onto whatever it's told for display
            this.receivedRoster = msg.entries;
        }
    }

    /**
     * Applies streamed peer events strictly in order, holding at the head
     * until our game reaches the event's round (our battle may lag theirs).
     * NOT gated on our own `awaitingCards`: that's purely "is my own round-
     * card overlay still open" — it has no bearing on whether the peer's
     * independent, already-completed actions are safe to log. Gating on it
     * used to leave the peer's actions stuck in the queue (never reaching
     * `dispatcher`'s log, so never part of `exportResume()`) for as long as
     * our own overlay stayed open — if the peer reloaded during that window,
     * their own already-submitted pick/buys would silently vanish from the
     * rebuild.
     */
    private drainRemoteQueue(): void {
        while (this.remoteQueue.length > 0) {
            const head = this.remoteQueue[0]!;
            if (head.round !== this.round || this.phase !== 'build') return;
            this.remoteQueue.shift();
            if (head.undo) {
                this.dispatcher.undoLast(head.round, 'enemy');
            } else if (head.action) {
                const translated = this.translateRemote(head.action);
                if (translated) this.dispatcher.dispatch(translated);
            }
            this.syncRallyVisuals();
        }
    }

    /** a streamed peer action, validated and flipped into our perspective */
    private translateRemote(action: Action): Action | null {
        if (action.team !== 'player') return null; // peers only send their own side
        return this.swapPerspective(action);
    }

    /** draws n distinct cards from a pool with the given seeded stream */
    private draw<T>(pool: readonly T[], n: number, rng: () => number): T[] {
        const deck = [...pool];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [deck[i], deck[j]] = [deck[j]!, deck[i]!];
        }
        return deck.slice(0, n);
    }

    /**
     * The between-round card offer: both sides get the same 4 cards from a
     * shared stream. The enemy quietly picks; the player gets the overlay
     * (the round clock waits). Skipping pays a small consolation instead.
     */
    private offerRoundCards(): void {
        this.roundCardTaken.player = false;
        this.roundCardTaken.enemy = false;

        // one shared draw — reproducible on any peer, identical for both sides
        const offer = this.draw(ROUND_CARDS, 4, this.rngRoundCards);
        if (this.hydrating) {
            // no UI, no opponent hook — the recorded actions carry the picks;
            // the stream was consumed above so future offers stay aligned
            this.pendingOffer = offer;
            return;
        }
        this.opponent.onRoundCards(offer);
        this.awaitingCards = true;
        this.showRoundOffer(offer);
    }

    private showRoundOffer(offer: RoundCard[]): void {
        this.hud.showRoundCards(
            offer.map((c) => this.roundCardView(c)),
            SKIP_CARD_REWARD,
            (cardId) => {
                this.dispatchPlayer({ kind: 'roundCard', team: 'player', cardId });
                this.awaitingCards = false;
            },
        );
    }

    private roundCardView(c: RoundCard): {
        id: string;
        title: string;
        body: string;
        cost: number;
        affordable: boolean;
    } {
        return {
            id: c.id,
            title: c.title,
            body: (c.unitsLabel ? `${c.unitsLabel} — ` : '') + c.description,
            cost: c.cost,
            affordable: this.economy.balance('player') >= c.cost,
        };
    }

    /** tech-resolved stats plus army boosts, card speciality, and the pack's items */
    private resolvedStats(unit: Unit) {
        const { team, type } = unit;
        const stats = this.techTree.statsFor(team, type);
        const b = this.settings.boosts;
        const attackTier = this.boostState.attack[team];
        const hpTier = this.boostState.hp[team];
        if (attackTier > 0) stats.damage *= 1 + b.attackTiers[attackTier - 1]!;
        if (hpTier > 0) stats.hp *= 1 + b.hpTiers[hpTier - 1]!;
        const spec = this.speciality[team];
        if (spec === 'air' && type.flying) {
            stats.damage *= 1 + AIR_BONUS;
            stats.hp *= 1 + AIR_BONUS;
        }
        if (spec === 'costControl' && !type.structure) {
            stats.damage *= 1 - COST_CONTROL_PENALTY;
            stats.hp *= 1 - COST_CONTROL_PENALTY;
        }
        for (const id of unit.items) {
            const mods = ITEMS[id]?.mods;
            if (!mods) continue;
            stats.hp *= mods.hp ?? 1;
            stats.damage *= mods.damage ?? 1;
            stats.range *= mods.range ?? 1;
            stats.speed *= mods.speed ?? 1;
            stats.attackInterval *= mods.attackInterval ?? 1;
        }
        const rb = this.settings.deploy;
        if (this.roundBoosts.speed[team]) stats.speed += rb.speedBoost;
        if (this.roundBoosts.range[team] && type.projectileSpeed) stats.range += rb.rangeBoost;
        return stats;
    }

    /** the left-side item strip: one square per item instance, hidden outside build */
    private inventoryView(): { id: string; icon: string; name: string; armed: boolean }[] {
        if (!this.playerCanAct) return [];
        return this.itemInventory.player.map((id, index) => {
            const item = ITEMS[id];
            return {
                id,
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
                // duplicates share an id: highlight exactly the clicked slot
                armed: this.armedItem === id && this.armedItemIndex === index,
            };
        });
    }

    /** the left-side tactics strip: placed routes/oil + remaining slots */
    private tacticsView(): {
        id: string;
        icon: string;
        name: string;
        armed: boolean;
        placed?: boolean;
        routeId?: number;
        hint?: string;
    }[] {
        if (!this.playerCanAct) return [];
        const out: {
            id: string;
            icon: string;
            name: string;
            armed: boolean;
            placed?: boolean;
            routeId?: number;
            cooldown?: number;
            hint?: string;
        }[] = [];

        // where each 'placement' tactic keeps its resettable placements
        const placementsOf: Record<string, () => readonly { id: number }[]> = {
            [RALLY_ROUTE_ID]: () => this.rallyRoutes.filter((r) => r.team === 'player'),
            [OIL_SPILL_ID]: () => this.oilStamps.filter((s) => s.team === 'player'),
        };
        // per-round ability charges layered on top of the inventory (sell only)
        const abilityChargesOf = (tacticId: string): { max: number; used: number } => {
            if (tacticId !== SELL_UNIT_ID || !this.sellState.owned.player) {
                return { max: 0, used: 0 };
            }
            const max = this.settings.sell.maxPerRound;
            return { max, used: Math.min(this.sellState.used.player, max) };
        };

        for (const tactic of Object.values(TACTICS)) {
            const inventory = this.tacticInventory.player.filter(
                (id) => id === tactic.id,
            ).length;
            const ability = abilityChargesOf(tactic.id);
            // greyed and available entries are counted from separate sources,
            // so using a charge turns an entry grey instead of removing it
            let placedEntries: { routeId?: number; hint?: string }[];
            let avail: number;
            if (tactic.kind === 'placement') {
                // charge stays in the inventory; placements are right-click resettable
                const placements = usesSpellPlacement(tactic)
                    ? this.spellStamps.filter(
                          (s) =>
                              s.team === 'player' &&
                              s.tacticId === tactic.id &&
                              s.placedRound === this.round,
                      )
                    : (placementsOf[tactic.id]?.() ?? []);
                // spells fired in past rounds still cool their charge down
                const cooling = usesSpellPlacement(tactic)
                    ? this.spellStamps.filter(
                          (s) =>
                              s.team === 'player' &&
                              s.tacticId === tactic.id &&
                              s.placedRound < this.round &&
                              s.placedRound >= this.round - tactic.cooldownRounds,
                      )
                    : [];
                placedEntries = [
                    ...placements.map((p) => ({
                        routeId: p.id,
                    })),
                    ...cooling.map((s) => {
                        const readyIn = s.placedRound + tactic.cooldownRounds + 1 - this.round;
                        return {
                            hint: `${tactic.name} — cooling down.\nReady again in ${readyIn} round${readyIn === 1 ? '' : 's'}.`,
                        };
                    }),
                ];
                avail =
                    inventory +
                    ability.max -
                    ability.used -
                    placements.length -
                    cooling.length;
            } else {
                // one-shot: the charge stays in the inventory but cools down
                // after use — both derived from the action log (undo restores)
                const useRounds = this.dispatcher.tacticUseRounds(
                    'player',
                    tactic.id,
                    this.round - tactic.cooldownRounds,
                );
                const coolingHint = (usedRound: number): string => {
                    const readyIn = usedRound + tactic.cooldownRounds + 1 - this.round;
                    const ready = `Ready again in ${readyIn} round${readyIn === 1 ? '' : 's'}.`;
                    return usedRound === this.round
                        ? `${tactic.name} — used this round.\nUndo gives it back. ${ready}`
                        : `${tactic.name} — cooling down.\n${ready}`;
                };
                placedEntries = [
                    ...Array.from({ length: ability.used }, () => ({
                        hint: `${tactic.name} — used this round.\nUndo gives it back.`,
                    })),
                    ...useRounds.map((r) => ({ hint: coolingHint(r) })),
                ];
                avail = ability.max - ability.used + Math.max(0, inventory - useRounds.length);
            }
            for (const p of placedEntries) {
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: `${tactic.name} — ${tactic.kind === 'placement' ? 'placed' : 'used'}`,
                    armed: false,
                    placed: true,
                    cooldown: tactic.cooldownRounds,
                    ...p,
                });
            }
            for (let i = 0; i < avail; i++) {
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: `${tactic.name} — ${tactic.description}`,
                    // only ONE entry lights up — a click arms a single charge
                    armed: this.armedTactic === tactic.id && i === 0,
                    cooldown: tactic.cooldownRounds,
                    // one-shots aren't "placed on the map" — override the default hint
                    hint:
                        tactic.kind === 'oneShot'
                            ? `${tactic.name}\n${tactic.description}\nRight-click to cancel.`
                            : undefined,
                });
            }
        }

        return out;
    }

    /** Records the enemy's unequipped items/tactics at deployment-phase start. */
    private captureEnemyIntelSnapshot(): void {
        this.enemyIntelSnapshot = {
            items: [...this.itemInventory.enemy],
            tactics: [...this.tacticInventory.enemy],
            sellAbilityOwned: this.sellState.owned.enemy,
        };
    }

    private enemyInventoryView(): {
        items: { icon: string; name: string }[];
        tactics: { icon: string; name: string }[];
        sellAbility: boolean;
    } {
        if (this.phase !== 'build') {
            return { items: [], tactics: [], sellAbility: false };
        }
        const live = this.deployReady.player;
        const items = live ? [...this.itemInventory.enemy] : (this.enemyIntelSnapshot?.items ?? []);
        const tactics = live ? [...this.tacticInventory.enemy] : (this.enemyIntelSnapshot?.tactics ?? []);
        const sellAbility = live
            ? this.sellState.owned.enemy
            : (this.enemyIntelSnapshot?.sellAbilityOwned ?? false);
        const mapItem = (id: string) => {
            const item = ITEMS[id];
            return {
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
            };
        };
        const mapTactic = (id: string) => {
            const tactic = TACTICS[id];
            return {
                icon: tactic?.icon ?? '?',
                name: tactic ? `${tactic.name} — ${tactic.description}` : id,
            };
        };
        return {
            items: items.map(mapItem),
            tactics: tactics.map(mapTactic),
            sellAbility,
        };
    }

    private resetPlacedRallyRoute(routeId: number): void {
        if (!this.playerCanAct) return;
        this.cancelTacticPlacement();
        if (
            this.dispatchPlayer({
                kind: 'removeRallyRoute',
                team: 'player',
                routeId,
            })
        ) {
            this.syncRallyVisuals();
        }
    }

    private resetPlacedOilSpill(stampId: number): void {
        if (!this.playerCanAct) return;
        this.cancelTacticPlacement();
        if (
            this.dispatchPlayer({
                kind: 'removeOilSpill',
                team: 'player',
                stampId,
            })
        ) {
            this.syncTacticVisuals();
        }
    }

    private resetPlacedSpell(stampId: number): void {
        if (!this.playerCanAct) return;
        this.cancelTacticPlacement();
        if (this.dispatchPlayer({ kind: 'removeSpell', team: 'player', stampId })) {
            this.syncTacticVisuals();
        }
    }

    private groundAtLocal(
        x: number,
        y: number,
        margin = RALLY_ROUTE_RADIUS,
    ): { x: number; z: number } | null {
        const rect = this.pixiApp.canvas.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        if (!ground) return null;
        return clampTacticPoint(ground.x, ground.z, this.map.halfW, this.map.halfH, margin);
    }

    private syncTacticVisuals(): void {
        // any armed tactic reads as a targeting cursor over the whole board
        this.pixiApp.canvas.style.cursor = this.armedTactic ? 'crosshair' : '';
        this.syncRallyVisuals();
        this.syncSpellVisuals();
        const pointer = this.placement.lastPointer;
        if (this.armedTactic === OIL_SPILL_ID && pointer) {
            const pos = this.groundAtLocal(pointer.x, pointer.y, OIL_SPILL_RADIUS);
            if (pos) {
                const start = this.tacticDraftStart ?? pos;
                const end = this.tacticDraftStart
                    ? clampTacticEnd(start.x, start.z, pos.x, pos.z)
                    : pos;
                this.oilVisuals.setDraft({
                    startX: quantizeWorld(start.x),
                    startZ: quantizeWorld(start.z),
                    endX: quantizeWorld(end.x),
                    endZ: quantizeWorld(end.z),
                    radius: OIL_SPILL_RADIUS,
                });
            } else {
                this.oilVisuals.setDraft(null);
            }
        } else {
            this.oilVisuals.setDraft(null);
        }
        this.oilVisuals.sync(this.oilField, 0, this.visibleOilStamps(), true);
    }

    private syncRallyVisuals(): void {
        const pointer = this.placement.lastPointer;
        let draft: RallyDraft | null = null;
        if (this.armedTactic === RALLY_ROUTE_ID && pointer) {
            const pos = this.groundAtLocal(pointer.x, pointer.y, RALLY_ROUTE_RADIUS);
            if (pos) {
                if (this.tacticDraftStart) {
                    const end = clampTacticEnd(
                        this.tacticDraftStart.x,
                        this.tacticDraftStart.z,
                        pos.x,
                        pos.z,
                    );
                    draft = {
                        startX: this.tacticDraftStart.x,
                        startZ: this.tacticDraftStart.z,
                        endX: end.x,
                        endZ: end.z,
                        mode: 'full',
                    };
                } else {
                    draft = {
                        startX: pos.x,
                        startZ: pos.z,
                        endX: pos.x,
                        endZ: pos.z,
                        mode: 'start-only',
                    };
                }
            }
        }
        this.rallyVisuals.sync(this.visibleRallyRoutes(), draft);
    }

    /** the aim preview while a spell is armed + this round's placed markers */
    private syncSpellVisuals(): void {
        const pointer = this.placement.lastPointer;
        const armed = this.armedTactic ? TACTICS[this.armedTactic] : null;
        let draft: SpellDraft | null = null;
        if (
            armed &&
            usesSpellPlacement(armed) &&
            (armed.targeting === 'point' ||
                armed.targeting === 'two-point' ||
                armed.targeting === 'point-yaw') &&
            pointer &&
            this.playerCanAct
        ) {
            const radius = armed.radius ?? 0;
            const pos = this.groundAtLocal(pointer.x, pointer.y, radius);
            if (pos) {
                if (armed.targeting === 'point-yaw' && this.tacticDraftStart) {
                    // position locked — mouse aims yaw
                    const yaw = yawToward(
                        this.tacticDraftStart.x,
                        this.tacticDraftStart.z,
                        pos.x,
                        pos.z,
                    );
                    draft = {
                        tacticId: armed.id,
                        x: this.tacticDraftStart.x,
                        z: this.tacticDraftStart.z,
                        radius,
                        yaw,
                        blocked:
                            !!armed.respectsSafeZone &&
                            this.inSafeZone(
                                this.tacticDraftStart.x,
                                this.tacticDraftStart.z,
                                radius,
                            ),
                    };
                } else {
                    const hover =
                        armed.targeting === 'two-point' && this.tacticDraftStart
                            ? clampTacticEnd(
                                  this.tacticDraftStart.x,
                                  this.tacticDraftStart.z,
                                  pos.x,
                                  pos.z,
                                  armed.maxSpan,
                              )
                            : pos;
                    draft = {
                        tacticId: armed.id,
                        x: hover.x,
                        z: hover.z,
                        radius,
                        yaw: 0,
                        blocked:
                            !!armed.respectsSafeZone &&
                            this.inSafeZone(hover.x, hover.z, radius),
                        ...(armed.targeting === 'two-point' && this.tacticDraftStart
                            ? {
                                  startX: this.tacticDraftStart.x,
                                  startZ: this.tacticDraftStart.z,
                              }
                            : {}),
                    };
                }
            }
        }
        this.spellVisuals.sync(this.visibleSpellStamps(), draft);
    }

    /** this round's spell markers: own always; enemy only after we lock in */
    private visibleSpellStamps(): readonly SpellStamp[] {
        const revealEnemy =
            this.phase === 'battle' || this.deployReady.player;
        return this.spellStamps.filter(
            (s) => s.placedRound === this.round && (s.team === 'player' || revealEnemy),
        );
    }

    /** own oil stamps always; opponent stamps only after we lock in (like rally) */
    private visibleOilStamps(): readonly OilStamp[] {
        const revealEnemy =
            this.phase === 'battle' ||
            this.deployReady.player;
        return this.oilStamps.filter((s) => s.team === 'player' || revealEnemy);
    }

    /** own routes always; opponent routes only after we lock in (multiplayer fog) */
    private visibleRallyRoutes(): readonly RallyRoute[] {
        const revealEnemy =
            this.phase === 'battle' ||
            this.deployReady.player;
        return this.rallyRoutes.filter(
            (r) => r.team === 'player' || revealEnemy,
        );
    }

    /** aborts in-progress tactic placement; returns true when something was cancelled */
    private cancelTacticPlacement(): boolean {
        const had = this.armedTactic !== null || this.tacticDraftStart !== null;
        this.armedTactic = null;
        this.tacticDraftStart = null;
        this.placement.inputLocked = false;
        this.syncTacticVisuals();
        return had;
    }

    /** true inside the safe zone: circles around the ENEMY's base buildings */
    private inSafeZone(x: number, z: number, margin = 0): boolean {
        return pointInSafeZone(this.placement.allUnits(), 'player', x, z, margin);
    }

    /**
     * Builds the tactic's action from a resolved target. THE only per-tactic
     * part of the click flow — targeting, safe zone, drafts and disarming are
     * generic in {@link handleTacticGroundClick}.
     */
    private dispatchTacticUse(
        tacticId: string,
        target: {
            unit?: Unit;
            point?: { x: number; z: number };
            start?: { x: number; z: number };
            end?: { x: number; z: number };
            yaw?: number;
        },
    ): boolean {
        switch (tacticId) {
            case SELL_UNIT_ID:
                return this.dispatchPlayer({
                    kind: 'sellUnit',
                    team: 'player',
                    unitId: target.unit!.id,
                });
            case RALLY_ROUTE_ID:
                return this.dispatchPlayer({
                    kind: 'placeRallyRoute',
                    team: 'player',
                    startX: target.start!.x,
                    startZ: target.start!.z,
                    endX: target.end!.x,
                    endZ: target.end!.z,
                });
            case OIL_SPILL_ID:
                return this.dispatchPlayer({
                    kind: 'placeOilSpill',
                    team: 'player',
                    startX: quantizeWorld(target.start!.x),
                    startZ: quantizeWorld(target.start!.z),
                    endX: quantizeWorld(target.end!.x),
                    endZ: quantizeWorld(target.end!.z),
                });
            default: {
                // every battle spell AND acid (ground-hazard commit) share
                // the placeSpell action for placement/aim/cooldown tracking
                const tactic = TACTICS[tacticId];
                if (!tactic || !usesSpellPlacement(tactic)) return false;
                if (target.point) {
                    return this.dispatchPlayer({
                        kind: 'placeSpell',
                        team: 'player',
                        tacticId,
                        x: quantizeWorld(target.point.x),
                        z: quantizeWorld(target.point.z),
                        ...(target.yaw !== undefined ? { yaw: quantizeYaw(target.yaw) } : {}),
                    });
                }
                if (target.start && target.end) {
                    return this.dispatchPlayer({
                        kind: 'placeSpell',
                        team: 'player',
                        tacticId,
                        x: quantizeWorld(target.start.x),
                        z: quantizeWorld(target.start.z),
                        endX: quantizeWorld(target.end.x),
                        endZ: quantizeWorld(target.end.z),
                    });
                }
                return false;
            }
        }
    }

    /** swallows map clicks while a tactic is armed; targeting is data-driven */
    private handleTacticGroundClick(x: number, y: number): boolean {
        if (!this.playerCanAct || !this.armedTactic) return false;
        const tactic = TACTICS[this.armedTactic];
        if (!tactic) return false;

        if (tactic.targeting === 'own-unit') {
            const unit = this.placement.unitAtPoint(x, y);
            if (unit && unit.team === 'player' && !unit.type.structure) {
                if (this.dispatchTacticUse(tactic.id, { unit })) this.cancelTacticPlacement();
            }
            // anything else (enemy, structure, ground): stay armed, swallow the click
            return true;
        }

        const radius = tactic.radius ?? 0;
        const ground = this.groundAtLocal(x, y, radius);
        if (!ground) return true;

        if (tactic.targeting === 'point') {
            if (tactic.respectsSafeZone && this.inSafeZone(ground.x, ground.z, radius)) {
                return true; // blocked spot — stay armed so the player can re-aim
            }
            if (this.dispatchTacticUse(tactic.id, { point: ground })) {
                this.cancelTacticPlacement();
            }
            return true;
        }

        if (tactic.targeting === 'point-yaw') {
            // first click locks position; second click commits with mouse yaw
            if (!this.tacticDraftStart) {
                if (tactic.respectsSafeZone && this.inSafeZone(ground.x, ground.z, radius)) {
                    return true;
                }
                this.tacticDraftStart = ground;
                this.syncTacticVisuals();
                return true;
            }
            const yaw = yawToward(
                this.tacticDraftStart.x,
                this.tacticDraftStart.z,
                ground.x,
                ground.z,
            );
            if (
                this.dispatchTacticUse(tactic.id, {
                    point: this.tacticDraftStart,
                    yaw,
                })
            ) {
                this.cancelTacticPlacement();
            }
            return true;
        }

        // two-point: first click drafts the start, second commits the capsule
        if (tactic.respectsSafeZone && this.inSafeZone(ground.x, ground.z, radius)) {
            return true; // blocked spot — stay armed so the player can re-aim
        }
        if (!this.tacticDraftStart) {
            this.tacticDraftStart = ground;
            this.syncTacticVisuals();
            return true;
        }
        const end = clampTacticEnd(
            this.tacticDraftStart.x,
            this.tacticDraftStart.z,
            ground.x,
            ground.z,
            tactic.maxSpan,
        );
        if (this.dispatchTacticUse(tactic.id, { start: this.tacticDraftStart, end })) {
            this.cancelTacticPlacement();
        }
        return true;
    }

    /** equips an inventory item onto a pack (dispatch + feedback burst) */
    private applyItemTo(unit: Unit, itemId: string): boolean {
        if (!this.playerCanAct || unit.team !== 'player' || unit.type.structure) return false;
        if (!this.dispatchPlayer({ kind: 'applyItem', team: 'player', unitId: unit.id, itemId })) {
            return false;
        }
        const bursts: SimEvent[] = unit.members.map((m) => ({
            kind: 'levelup',
            x: unit.world.x + m.home.x,
            y: unit.type.meshScale * 1.5,
            z: unit.world.z + m.home.z,
        }));
        this.particles.spawnFromEvents(bursts);
        return true;
    }

    /** a pack whose next level can be bought (XP banked, below max, build phase) */
    private canLevel(unit: Unit): boolean {
        return this.playerCanAct && this.packUpgradeReady(unit, unit.level, unit.xp);
    }

    /** XP banked for the next level at a given veterancy (no phase / team gates) */
    private packUpgradeReady(unit: Unit, level: number, xp: number): boolean {
        return (
            !unit.type.structure &&
            level < this.settings.leveling.maxLevel &&
            xp >= xpThresholdFor(unit.type, level, this.economy, this.settings.leveling)
        );
    }

    /** the player's ready-to-level packs of one kind, in deterministic id order */
    private levelablePacksOf(type: UnitType): Unit[] {
        return this.placement
            .allUnits()
            .filter((u) => u.team === 'player' && u.type === type && this.canLevel(u))
            .sort((a, b) => a.id - b.id);
    }

    /** every ready-to-level pack on the field, any unit type */
    private allLevelablePacks(): Unit[] {
        return this.placement
            .allUnits()
            .filter((u) => u.team === 'player' && this.canLevel(u))
            .sort((a, b) => a.id - b.id);
    }

    /** the bottom-right shortcut: total cost/count for all ready packs */
    private globalLevelUpInfo(): { count: number; cost: number; affordable: boolean } | null {
        const packs = this.allLevelablePacks();
        if (packs.length === 0) return null;
        const cost = packs.reduce(
            (sum, u) => sum + levelCost(u.type, this.economy, this.settings.leveling),
            0,
        );
        return {
            count: packs.length,
            cost,
            affordable: this.economy.balance('player') >= cost,
        };
    }

    /** the panel's level-up offer, with a "level all" when several packs of the kind are ready */
    private levelUpInfo(
        u: Unit,
        lv: { xp: number; xpNext: number },
    ): SelectionInfo['levelUp'] {
        if (u.team !== 'player' || !this.playerCanAct || u.type.structure || lv.xpNext < 0) {
            return undefined;
        }
        const cost = levelCost(u.type, this.economy, this.settings.leveling);
        const readyPacks = this.levelablePacksOf(u.type);
        return {
            cost,
            ready: lv.xp >= lv.xpNext,
            affordable: this.economy.balance('player') >= cost,
            all:
                readyPacks.length >= 2
                    ? {
                          count: readyPacks.length,
                          cost: cost * readyPacks.length,
                          affordable: this.economy.balance('player') >= cost * readyPacks.length,
                      }
                    : undefined,
        };
    }

    private buyLevelFor(unit: Unit): boolean {
        if (!this.dispatchPlayer({ kind: 'buyLevel', team: 'player', unitId: unit.id })) {
            return false;
        }
        const bursts: SimEvent[] = unit.members.map((m) => ({
            kind: 'levelup',
            x: unit.world.x + m.home.x,
            y: unit.type.meshScale * 1.5,
            z: unit.world.z + m.home.z,
        }));
        this.particles.spawnFromEvents(bursts);
        return true;
    }

    private cycleSpeed(direction: number): void {
        const n = Game.SPEED_STEPS.length;
        this.speedIndex = (this.speedIndex + direction + n) % n;
        const multiplier = Game.SPEED_STEPS[this.speedIndex]!;
        this.hud.setSpeed(multiplier);
        // both players (and spectators) watch at the same pace and finish together
        this.broadcast({ type: 'speed', multiplier });
    }

    /** battle speed returns to 1× at the start of every deployment phase */
    private resetSpeed(): void {
        const index = Game.SPEED_STEPS.indexOf(1);
        if (index < 0) return;
        this.speedIndex = index;
        this.hud.setSpeed(1);
        // during hydration this runs once per replayed round — don't spam the peer
        if (!this.hydrating) this.broadcast({ type: 'speed', multiplier: 1 });
    }

    /** what the player pays right now, including an active recruit-level premium */
    private effectiveCost(type: UnitType): number {
        if (type.extra) return this.economy.costOf(type); // extras never recruit levels
        const extra = this.recruitLevel.player - 1;
        return (
            this.economy.costOf(type) +
            extra * levelCost(type, this.economy, this.settings.leveling)
        );
    }

    /** HUD buy button: resolve a spawn spot, then run it through the action system */
    private buyUnit(type: UnitType): void {
        if (!this.playerCanAct) return;
        if (!type.extra && !this.unlockedUnits.player.includes(type.id)) return;
        if (this.economy.balance('player') < this.effectiveCost(type)) return;
        // extras are click-placed: nothing is bought until the placement click
        if (type.extra) {
            const left =
                this.settings.deploy.extrasBudgetPerRound - this.deployState.extrasSpent.player;
            if (this.economy.costOf(type) > left) return; // extras budget exhausted
            this.placement.beginPlacing(type);
            return;
        }
        // touch: the shop sheet hides the field, so drop the pack where the
        // camera looks and highlight it — desktop keeps the zone-center spawn
        const nearView = inputMode() === 'touch';
        const view = this.rig.target;
        const anchor = nearView
            ? this.placement.findBuySpotNear(type, view.x, view.z)
            : this.placement.findBuySpot(type);
        if (!anchor) return;
        this.dispatchPlayer({
            kind: 'buy',
            team: 'player',
            typeId: type.id,
            anchor,
            rotated: false,
        });
    }

    /**
     * The undo button: reverts the player's most recent action of the
     * running build phase — click repeatedly to peel back further. Enemy
     * actions and earlier rounds are never touched.
     */
    private undoLast(): void {
        if (!this.canUndo()) return;
        this.placement.deselect();
        if (this.dispatcher.undoLast(this.round, 'player')) {
            this.broadcast({ type: 'undo', round: this.round }); // the peer mirrors it
        }
        this.hud.refreshCosts(); // the undone action may have been the recruit switch
        this.refreshShopHud();
        this.syncTacticVisuals();
    }

    private unlockUnit(typeId: string): void {
        if (!this.playerCanAct) return;
        if (this.dispatchPlayer({ kind: 'unlockUnit', team: 'player', typeId })) {
            this.refreshShopHud();
        }
    }

    private refreshShopHud(): void {
        this.hud.updateShop(
            this.unlockedUnits.player,
            !this.unlockUsedThisRound.player,
            this.economy.balance('player'),
        );
    }

    private canUndo(): boolean {
        return (
            this.phase === 'build' &&
            !this.matchOver &&
            !this.deployReady.player && // locked in: the batch is already with the peer
            this.dispatcher.canUndo(this.round, 'player')
        );
    }

    /** the whole match as data: the same seed + actions reproduce it exactly */
    exportReplay(): { version: number; seed: number; settings: GameSettings; actions: LoggedAction[] } {
        return {
            version: 1,
            seed: this.seed,
            settings: this.settings,
            actions: this.dispatcher.serializable(),
        };
    }

    /** Everything is revealed and the sim takes over; the player can only watch. */
    private startBattlePhase(): void {
        this.placement.beginBattle();
        this.phase = 'battle';
        this.phaseRemaining = this.settings.battleTimeSeconds;
        this.placement.enabled = false;
        this.placement.hiddenPlacements = false;
        this.placement.deselect();
        this.armedItem = null;
        this.cancelTacticPlacement();
        this.gridOverlay.visible = false;
        this.enemyIntelSnapshot = null;
        this.placement.revealAll();
        // oil/acid pour later as drips — baseline only for now (wards carve carry-over)
        const hazardPours = prepareHazardPours(
            {
                oilStamps: this.oilStamps,
                spellStamps: this.spellStamps,
                oilField: this.oilField,
                oilBaseline: this.oilBaseline,
                placement: this.placement,
            },
            this.round,
        );
        this.oilVisuals.setDraft(null);
        this.oilVisuals.sync(this.oilField, 0, [], false);
        // drop deploy-phase stamps — battle uses charge/zone markers instead
        this.spellVisuals.clear();
        // battle spells: summons join the board BEFORE the sim snapshots units;
        // strikes go into the sim's schedule. Sorted by stamp id so both peers
        // spawn in the same order (unit ids must match exactly).
        const pendingSpells = this.spellStamps
            .filter((s) => s.placedRound === this.round)
            .sort((a, b) => a.id - b.id);
        for (const stamp of pendingSpells) {
            const spawn = TACTICS[stamp.tacticId]?.spell?.spawn;
            if (spawn) this.spawnSummons(stamp, spawn);
        }
        const spellStrikes = pendingSpells.flatMap((s) => {
            const spell = TACTICS[s.tacticId]?.spell;
            return spell?.strike
                ? [
                      {
                          tacticId: s.tacticId,
                          x: s.x,
                          z: s.z,
                          radius: spell.strike.radius,
                          damage: spell.strike.damage,
                          delaySeconds: spell.delaySeconds,
                          yaw: s.yaw,
                      },
                  ]
                : [];
        });
        // visual-only: hammer drop anticipates the sim strike so impact coincides
        const hammerCues = pendingSpells
            .filter((s) => s.tacticId === HAMMER_ID)
            .map((s) => {
                const spell = TACTICS[HAMMER_ID]!.spell!;
                const at = BATTLE_START_FREEZE + spell.delaySeconds;
                return { x: s.x, z: s.z, at, yaw: s.yaw ?? 0 };
            });
        this.hammerFx.schedule(hammerCues);
        // Great Meteor drop
        this.meteorFx.scheduleGreat(
            pendingSpells
                .filter((s) => s.tacticId === BIG_METEOR_ID)
                .map((s) => {
                    const spell = TACTICS[BIG_METEOR_ID]!.spell!;
                    return {
                        x: s.x,
                        z: s.z,
                        at: BATTLE_START_FREEZE + spell.delaySeconds,
                    };
                }),
        );
        // Storm / poison hovering clouds for the zone lifetime
        this.cloudFx.schedule(
            pendingSpells.flatMap((s) => {
                const spell = TACTICS[s.tacticId]?.spell;
                const zone = spell?.zone;
                if (!zone || (zone.mode !== 'storm' && zone.mode !== 'poison')) return [];
                const startAt = BATTLE_START_FREEZE + spell.delaySeconds;
                return [
                    {
                        kind: zone.mode,
                        x: s.x,
                        z: s.z,
                        radius: TACTICS[s.tacticId]?.radius ?? 28,
                        startAt,
                        endAt: startAt + zone.duration,
                    },
                ];
            }),
        );
        // Dragon flyover: breath starts at delay; pour paints start→end with the strafe
        this.dragonFx.schedule(
            pendingSpells.flatMap((s) => {
                if (s.tacticId !== DRAGON_ID || s.endX === undefined || s.endZ === undefined) {
                    return [];
                }
                const spell = TACTICS[DRAGON_ID]!.spell!;
                return [
                    {
                        x: s.x,
                        z: s.z,
                        x2: s.endX,
                        z2: s.endZ,
                        at: BATTLE_START_FREEZE + spell.delaySeconds,
                        pourDuration: DRAGON_POUR_DURATION_SEC,
                    },
                ];
            }),
        );
        // charge markers: outer + growing inner until readyAt, then gone
        // (zones keep a pulsing ring via activeZoneMarkers after readyAt)
        const pourReadyAt = BATTLE_START_FREEZE + HAZARD_POUR_DELAY_SEC;
        this.spellChargeMarkers = [
            ...this.oilStamps.map((s) => ({
                tacticId: OIL_SPILL_ID,
                x: s.startX,
                z: s.startZ,
                radius: s.radius,
                at: pourReadyAt,
                readyAt: pourReadyAt,
                endX: s.endX,
                endZ: s.endZ,
            })),
            ...pendingSpells.flatMap((s) => {
                const tactic = TACTICS[s.tacticId];
                const spell = tactic?.spell;
                if (
                    (tactic?.acidCapsule || tactic?.fireCapsule) &&
                    s.endX !== undefined &&
                    s.endZ !== undefined
                ) {
                    return [
                        {
                            tacticId: s.tacticId,
                            x: s.x,
                            z: s.z,
                            radius: tactic.radius ?? 8,
                            at: pourReadyAt,
                            readyAt: pourReadyAt,
                            endX: s.endX,
                            endZ: s.endZ,
                        },
                    ];
                }
                if (!spell) return [];
                const at = BATTLE_START_FREEZE + spell.delaySeconds;
                const radius = tactic!.radius ?? 8;
                if (s.tacticId === HAMMER_ID) {
                    return [
                        {
                            tacticId: HAMMER_ID,
                            x: s.x,
                            z: s.z,
                            radius,
                            at,
                            readyAt: at - HAMMER_SWING_SEC,
                            yaw: s.yaw ?? 0,
                        },
                    ];
                }
                if (s.tacticId === BIG_METEOR_ID) {
                    return [
                        {
                            tacticId: BIG_METEOR_ID,
                            x: s.x,
                            z: s.z,
                            radius,
                            at,
                            readyAt: at - GREAT_METEOR_FALL_SEC,
                        },
                    ];
                }
                if (s.tacticId === DRAGON_ID && s.endX !== undefined && s.endZ !== undefined) {
                    return [
                        {
                            tacticId: DRAGON_ID,
                            x: s.x,
                            z: s.z,
                            radius,
                            at,
                            readyAt: at - DRAGON_APPROACH_SEC,
                            endX: s.endX,
                            endZ: s.endZ,
                        },
                    ];
                }
                // igniteCapsule (dragon) uses progressive pour — charge handled above
                if (
                    spell.igniteCapsule &&
                    s.tacticId !== DRAGON_ID &&
                    s.endX !== undefined &&
                    s.endZ !== undefined
                ) {
                    return [
                        {
                            tacticId: s.tacticId,
                            x: s.x,
                            z: s.z,
                            radius,
                            at,
                            readyAt: at,
                            endX: s.endX,
                            endZ: s.endZ,
                        },
                    ];
                }
                // strikes, spawns, and zones all charge until the effect begins
                if (spell.strike || spell.spawn || spell.zone) {
                    return [
                        {
                            tacticId: s.tacticId,
                            x: s.x,
                            z: s.z,
                            radius,
                            at,
                            readyAt: at,
                        },
                    ];
                }
                return [];
            }),
        ];
        const spellZones = pendingSpells.flatMap((s) => {
            const spell = TACTICS[s.tacticId]?.spell;
            const zone = spell?.zone;
            return zone
                ? [
                      {
                          tacticId: s.tacticId,
                          x: s.x,
                          z: s.z,
                          x2: s.endX,
                          z2: s.endZ,
                          radius: TACTICS[s.tacticId]?.radius ?? 4 * CELL,
                          delaySeconds: spell.delaySeconds,
                          duration: zone.duration,
                          interval: zone.interval,
                          damage: zone.damage,
                          mode: zone.mode,
                          impactRadius: zone.impactRadius,
                          igniteRadius: zone.igniteRadius,
                          seed: seedFrom(this.seed, `spell:${s.id}`),
                      },
                  ]
                : [];
        });
        const spellIgnites: {
            x: number;
            z: number;
            x2: number;
            z2: number;
            radius: number;
            delaySeconds: number;
            burnSeconds: number;
            intensity: number;
        }[] = [];
        // dragon breath is a progressive fire pour (hazardPours), not a one-shot ignite
        this.sim = new BattleSim(this.placement.allUnits(), {
            towers: this.settings.towers,
            leveling: this.settings.leveling,
            battleSeconds: this.settings.battleTimeSeconds,
            hostParity: this.side === 'a' ? 0 : 1,
            costOf: (type) => this.economy.costOf(type),
            statsOf: (unit) => this.resolvedStats(unit),
            hasTech: (team, typeId, techId) => this.techTree.has(team, typeId, techId),
            flankSpawnSeconds: this.settings.deploy.flankSpawnSeconds ?? 5,
            flankSpawnMult: (team) => this.flankSpawnMult[team],
            needsFlankSpawn: (unit) =>
                // mechs on flank at battle start — not tied to a specific round, only to flank tiles
                !unit.flankSpawnDone &&
                !unit.summoned &&
                !unit.type.structure &&
                !unit.type.extra &&
                this.placement.isOnFlank(unit),
            rallyRoutes: this.rallyRoutes.filter((r) => r.team === 'player' || r.team === 'enemy'),
            oilField: this.oilField,
            oilExpiresRound: this.round + OIL_SPILL_DURATION_ROUNDS - 1,
            spellStrikes,
            spellZones,
            spellIgnites,
            hazardPours,
            summonDelayOf: (unit) => (unit.summoned ? unit.summonDelay : 0),
        });
        // the sync point: both peers hash the identical battle-start state
        if (this.net && !this.hydrating) {
            const hash = this.stateHash();
            this.sentChecks.set(this.round, hash);
            this.net.send({ type: 'check', round: this.round, hash });
            this.verifyCheck(this.round);
        }
    }

    /**
     * Materializes one spawn-spell stamp as battle-only packs, scattered in
     * the stamp's circle. Seeded per stamp id — identical on both peers.
     */
    private spawnSummons(
        stamp: SpellStamp,
        spawn: { typeId: string; count: number },
    ): void {
        const type = unitTypeById(spawn.typeId);
        if (!type) return;
        const tactic = TACTICS[stamp.tacticId]!;
        const scatter = tactic.radius ?? 4 * CELL;
        const rng = mulberry32(seedFrom(this.seed, `spell:${stamp.id}`));
        for (let i = 0; i < spawn.count; i++) {
            // rejection sampling instead of cos/sin — these positions become
            // sim state, and transcendental results differ between engines
            let ox = 0;
            let oz = 0;
            for (let tries = 0; tries < 16; tries++) {
                const cx = (rng() * 2 - 1) * scatter;
                const cz = (rng() * 2 - 1) * scatter;
                if (cx * cx + cz * cz <= scatter * scatter) {
                    ox = cx;
                    oz = cz;
                    break;
                }
            }
            const anchor = this.placement.findSpotNearWorld(
                type,
                stamp.x + ox,
                stamp.z + oz,
            );
            if (!anchor) continue;
            const unit = this.placement.spawn(type, anchor, stamp.team, false, true);
            if (!unit) continue;
            unit.summoned = true;
            unit.summonDelay = tactic.spell?.delaySeconds ?? 0;
            unit.deployedRound = this.round;
            // summons arrive AFTER placement.beginBattle() ran — give them the
            // same battle prep, or they stay in deployment mode: flyers ramp
            // their lift toward the ground and Unit.update() re-seats member
            // meshes at the pack origin every frame, fighting the sim's Y
            unit.setDeployment(false);
        }
    }

    /** Battle is over: survivors bite into the opponent's HP, then the board resets. */
    private endBattlePhase(): void {
        if (this.sim) {
            // flames die with the battle; remaining oil (unburned) carries over
            this.oilField.adoptOilFrom(this.sim.hazards);
            this.applyBattleResult(this.sim);
        }
        this.sim = null;
        this.selectedActor = null;
        this.projectileRenderer.clear();
        this.fireFx.clear(); // instanced flame tongues are battle-only
        this.hammerFx.clear();
        this.meteorFx.clear();
        this.cloudFx.clear();
        this.dragonFx.clear();
        this.oilDripFx.clear();
        this.spellChargeMarkers = [];
        this.oilVisuals.setDraft(null);
        this.oilVisuals.sync(this.oilField, 0, [], false);
        this.spellVisuals.clear(); // active zone markers are battle-only
        if (this.playerHp <= 0 || this.enemyHp <= 0) {
            this.finishMatch();
            return;
        }
        // spent extras (broken shields, fired rockets) and battle-only summons
        // leave the board for good
        for (const unit of [...this.placement.allUnits()]) {
            if (unit.consumed || unit.summoned) this.placement.removeUnit(unit);
            else unit.resetFormation();
        }
        this.placement.refaceAll();
        this.announceBattleEnd();
    }

    /** local battle sim finished — tell the peer, then wait for theirs too
     *  before starting the next build phase (fast-forward speed is per-client,
     *  so the two sides don't necessarily finish watching at the same time) */
    private announceBattleEnd(): void {
        this.battleReady.player = true;
        if (this.net && !this.hydrating) {
            this.broadcast({ type: 'battleEnd', round: this.round });
        }
        this.maybeStartNextRound();
    }

    /** starts the next build phase once both sides are ready — no peer (AI
     *  match) or a replay rebuild (hydrate already knows the true history)
     *  skip the wait entirely */
    private maybeStartNextRound(): void {
        if (!this.net || this.hydrating) {
            this.startBuildPhase();
            return;
        }
        if (this.battleReady.player && this.battleReady.enemy) this.startBuildPhase();
    }

    /** someone hit 0 HP — freeze the game and show the result */
    private finishMatch(): void {
        this.matchOver = true;
        clearResumeMarker();
        clearSinglePlayer();
        this.hud.hidePauseMenu();
        this.placement.enabled = false;
        this.placement.deselect();
        this.gridOverlay.visible = false;
        this.hpBars.clear();
        const result =
            this.playerHp <= 0 && this.enemyHp <= 0
                ? 'draw'
                : this.enemyHp <= 0
                  ? 'victory'
                  : 'defeat';
        // resuming a finished save replays to defeat/victory — go to menu, not game over
        if (this.hydrating) {
            queueMicrotask(() => this.quitToMenu());
            return;
        }
        this.reportMatchTelemetry(result);
        this.reportOpenRating(result);
        this.hud.showGameOver(result);
    }

    /** the opponent never reconnected within the grace window — win by forfeit */
    private forfeitWin(): void {
        if (this.matchOver) return;
        this.matchOver = true;
        this.suspended = false;
        clearResumeMarker();
        clearSinglePlayer();
        // report before tearing down net — mode/side derive from it still being set
        this.reportOpenRating('victory', true);
        this.net?.close();
        this.net = null;
        this.hud.hidePauseMenu();
        this.placement.enabled = false;
        this.placement.deselect();
        this.gridOverlay.visible = false;
        this.hpBars.clear();
        this.hud.showForfeitWin();
    }

    /**
     * Soft open-ladder Elo (honor system). Host-only in MP; AI games count
     * W/L but do not change MMR. `forceReport` bypasses the host-only gate for
     * a forfeit win, since the reporting side may be either host or guest —
     * whichever one is still connected. Failures are ignored.
     */
    private reportOpenRating(result: 'victory' | 'defeat' | 'draw', forceReport = false): void {
        if (this.net && this.side !== 'a' && !forceReport) return;
        try {
            const mode = this.net ? 'mp' : 'ai';
            reportMatchResult({
                matchId: matchResultId(
                    this.seed,
                    this.playerNames.local,
                    this.playerNames.opponent,
                    this.round,
                ),
                mode,
                result,
                names: { ...this.playerNames },
            });
        } catch {
            // rating must never affect the game-over flow
        }
    }

    /**
     * Best-effort upload for balance stats. Host-only in multiplayer (one
     * record per match); never blocks or throws if the PHP backend is down.
     */
    private reportMatchTelemetry(result: 'victory' | 'defeat' | 'draw'): void {
        if (this.net && this.side !== 'a') return;
        try {
            const replay = this.exportReplay();
            submitMatchTelemetry({
                schema: 1,
                ts: Math.floor(Date.now() / 1000),
                gameVersion: GAME_VERSION,
                balancePatchId: BALANCE_PATCH_ID,
                mode: this.net ? 'mp' : 'ai',
                side: this.side,
                result,
                rounds: this.round,
                playerHp: this.playerHp,
                enemyHp: this.enemyHp,
                names: { ...this.playerNames },
                speciality: { player: this.speciality.player, enemy: this.speciality.enemy },
                units: summarizeUnits(this.placement.allUnits()),
                unlocked: {
                    player: [...this.unlockedUnits.player],
                    enemy: [...this.unlockedUnits.enemy],
                },
                replay,
            });
        } catch {
            // telemetry must never affect the game-over flow
        }
    }

    /**
     * Every surviving unit deals its value as player damage: the unit's base
     * price scaled by how much of it survived (half the dwarf pack alive =
     * half its cost), always a whole number. A wiped side has no survivors,
     * so only the losing player takes damage; on a timeout both usually do.
     */
    private applyBattleResult(sim: BattleSim): void {
        let damageToPlayer = 0;
        let damageToEnemy = 0;
        for (const [unit, s] of sim.unitSurvivors()) {
            const value = Math.round(this.economy.costOf(unit.type) * (s.alive / s.total));
            if (unit.team === 'player') damageToEnemy += value;
            else damageToPlayer += value;
        }
        this.playerHp = Math.max(0, this.playerHp - damageToPlayer);
        this.enemyHp = Math.max(0, this.enemyHp - damageToEnemy);
    }

    /** swaps the build-phase overlay for one matching the current zone rules */
    private refreshOverlay(): void {
        this.scene.remove(this.gridOverlay);
        const material = this.gridOverlay.material as import('three').MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
        this.gridOverlay.geometry.dispose();
        this.gridOverlay = this.map.createOverlayMesh();
        this.scene.add(this.gridOverlay);
    }

    private resize(width: number, height: number): void {
        this.renderer.setSize(width, height, false);
        this.rig.resize(width, height);
    }

    private tick(dtSeconds: number): void {
        if (this.disposed) return;
        // reconnect grace ticks in real time, independent of phase/suspend —
        // an unreturned opponent forfeits once it hits zero
        if (this.reconnectGraceRemaining !== null) {
            this.reconnectGraceRemaining -= dtSeconds;
            if (this.reconnectGraceRemaining <= 0) {
                this.reconnectGraceRemaining = null;
                const onTimeout = this.onReconnectTimeout;
                this.onReconnectTimeout = null;
                onTimeout?.();
                this.forfeitWin();
            } else {
                this.hud.updateReconnectWait(this.reconnectGraceRemaining);
            }
        }
        const profile = this.debug.isEnabled;
        const cpu = this.cpuSampler;
        if (profile) cpu.reset();

        // battle can be fast-forwarded (or slowed); build always runs at 1x
        const gameDt =
            this.phase === 'battle' ? dtSeconds * Game.SPEED_STEPS[this.speedIndex]! : dtSeconds;
        this.time += gameDt;

        let simSteps = 0;
        let simCpu: Record<string, number> | undefined;

        if (!this.matchOver && !this.suspended) {
            const waitingForStarterPeer =
                this.round === 0 &&
                this.speciality.player !== null &&
                this.speciality.enemy === null;
            if (!waitingForStarterPeer) {
                this.phaseRemaining -= gameDt;
            }
            if (this.phase === 'build') {
                if (this.phaseRemaining <= 0) this.onDeployTimerExpired();
            } else if (this.sim) {
                if (profile) {
                    this.sim.profileEnabled = true;
                    cpu.begin();
                }
                this.sim.update(gameDt);
                if (profile) {
                    cpu.end('sim');
                    simSteps = this.sim.lastProfileSteps;
                    simCpu = this.sim.lastProfile;
                    this.sim.profileEnabled = false;
                }
                const battleEvents = this.sim.consumeEvents();
                this.particles.spawnFromEvents(battleEvents);
                this.fireFx.spawnFromEvents(battleEvents);
                this.stampWearFromEvents(battleEvents);
                for (const ev of battleEvents) {
                    if (ev.kind === 'spellMeteor') {
                        this.meteorFx.spawnShardImpact(ev.x, ev.z, ev.at);
                    } else if (ev.kind === 'spellLightning') {
                        this.cloudFx.spawnLightning(ev.x, ev.z, this.sim.elapsed);
                    } else if (ev.kind === 'hazardDrip') {
                        this.oilDripFx.spawnDrip(ev.hazard, ev.x, ev.z, ev.at);
                    }
                }
                this.oilVisuals.sync(this.sim.hazards, this.sim.elapsed, [], false);
                this.map.setHazardTime(this.time);
                this.map.flushHazardMask();
                if (profile) cpu.begin();
                this.sim.syncMeshes(); // per-frame interpolated positions
                if (profile) cpu.end('syncMeshes');
                if (profile) cpu.begin();
                this.sim.syncBattleVisuals(this.time);
                if (profile) cpu.end('battleVisuals');
                this.projectileRenderer.update(this.sim.projectiles, this.sim.alpha);
                this.fireFx.update(gameDt, this.sim.hazards, this.sim.elapsed);
                this.fireFx.updateBurningActors(gameDt, this.sim.actors, this.sim.elapsed);
                this.hammerFx.update(this.sim.elapsed);
                this.meteorFx.update(this.sim.elapsed);
                this.cloudFx.update(this.sim.elapsed);
                this.dragonFx.update(this.sim.elapsed);
                this.oilDripFx.update(this.sim.elapsed);
                // acid/poison/storm/meteor-shower zones + hammer charge rings
                this.spellVisuals.syncBattleMarkers(
                    this.sim.activeZoneMarkers(),
                    this.spellChargeMarkers,
                    this.sim.elapsed,
                );
                // the battle clock is the sim's own fixed-step time; the sim
                // itself stops at the deciding step, identically on any peer
                this.phaseRemaining = this.settings.battleTimeSeconds - this.sim.elapsed;
                if (this.sim.finished) this.endBattlePhase();
            }
        }
        if (profile) cpu.begin();
        this.particles.update(gameDt);

        this.controls.update(dtSeconds);
        this.gamepad.update(dtSeconds);
        this.rig.update(dtSeconds);
        // ambient motion runs on real time, unaffected by battle fast-forward
        this.scenery.update(dtSeconds, this.rig.camera.position);
        updateAnimatedUnits(dtSeconds); // advance rigged unit walk/idle mixers
        this.placement.update(this.time, gameDt);
        if (this.phase === 'build') this.syncTacticVisuals();
        if (profile) cpu.end('world/ui');
        if (profile) cpu.begin();
        this.unitInstances.sync();
        if (profile) cpu.end('instances');
        if (profile) cpu.begin();
        this.updateBlobShadows();
        this.tickShadowMapUpdate();
        this.updateSandWear();
        this.updateSelectionUi();
        this.drainRemoteQueue();
        const waitingForPeer =
            this.net !== null &&
            !this.matchOver &&
            ((this.phase === 'build' && this.deployReady.player && !this.deployReady.enemy) ||
                (this.awaitingCards && this.round === 0 && this.speciality.player !== null) ||
                (this.battleReady.player && !this.battleReady.enemy));
        this.hud.setPhase(this.round, this.phase, this.phaseRemaining, waitingForPeer);
        this.hud.setUndoVisible(this.canUndo());
        this.hud.setDeploys(
            this.deployState.used.player,
            this.deployState.limit.player + this.deployState.extra.player,
            this.settings.deploy.extrasBudgetPerRound - this.deployState.extrasSpent.player,
        );
        this.hud.setInventory(this.inventoryView(), this.tacticsView());
        const enemyInv = this.enemyInventoryView();
        this.hud.setEnemyInventory(enemyInv.items, enemyInv.tactics, {
            sellAbility: enemyInv.sellAbility,
        });
        // rally sync is folded into syncTacticVisuals during build; battle needs routes gone
        if (this.phase === 'battle') this.rallyVisuals.sync([], null);
        this.hud.setSupply(this.economy.balance('player'));
        this.hud.setLevelAllGlobal(this.playerCanAct ? this.globalLevelUpInfo() : null);
        this.refreshShopHud();
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.hud.layout();
        if (profile) cpu.end('hud');
        if (profile) cpu.begin();
        this.renderer.render(this.scene, this.rig.camera);
        if (profile) cpu.end('render');
        let mechs = 0;
        let mobile: number | undefined;
        let softCrowd: boolean | undefined;
        if (this.sim) {
            mechs = this.sim.actors.length;
            mobile = this.sim.lastMobileCount;
            softCrowd = this.sim.lastSoftCrowd;
        } else {
            for (const u of this.placement.allUnits()) {
                mechs += u.members.length;
                if (!u.type.structure) {
                    for (const m of u.members) {
                        if (!m.mesh.userData.dead) mobile = (mobile ?? 0) + 1;
                    }
                }
            }
            if (mobile === undefined) mobile = 0;
            softCrowd = mobile <= SOFT_CROWD_LIMIT;
        }
        const instSnap = this.unitInstances.debugSnapshot();
        this.debug.update(this.pixiApp, this.renderer, this.scene, {
            units: this.placement.unitCount,
            mechs,
            mobile,
            softCrowd,
            softCrowdLimit: SOFT_CROWD_LIMIT,
            phase: this.phase,
            round: this.round,
            instanceCount: instSnap.instances,
            instancePools: instSnap.pools,
            instanceLines: instSnap.lines,
            cpu: profile ? cpu.snapshot() : undefined,
            simCpu: simCpu,
            simSteps: simSteps || undefined,
        }, dtSeconds);

        if (this.onStateCheckpoint && !this.net && !this.matchOver && !this.hydrating) {
            this.persistTimer += dtSeconds;
            const interval = this.phase === 'battle' ? 0.25 : 1;
            if (this.persistTimer >= interval) {
                this.persistTimer = 0;
                this.onStateCheckpoint();
            }
        }
    }

    /**
     * Visual-only: ground mechs stamp sandy wear as they walk. Throttled via
     * the map's mask flush; flyers/structures/extras leave no trail.
     * Sand (R) washes blood/scorch back when units walk over gore.
     */
    private updateSandWear(): void {
        if (prefs().groundEffects === 'off') {
            this.map.flushSandMask();
            return;
        }
        if (!this.sandBootstrapped && this.map.sandReady) {
            this.placement.restampGroundSand();
            this.sandBootstrapped = true;
        }
        if (this.phase === 'battle' && this.sim) {
            const stepMin = prefs().groundEffects === 'medium' ? 1.4 : 0.75;
            for (const a of this.sim.actors) {
                if (!a.alive || a.altitude > 0) continue;
                const t = a.unit.type;
                if (t.structure || t.extra || t.flying) continue;
                const prev = this.sandLastPos.get(a);
                if (!prev) {
                    this.sandLastPos.set(a, { x: a.x, z: a.z });
                    continue;
                }
                const dist = Math.hypot(a.x - prev.x, a.z - prev.z);
                if (dist < stepMin) continue;
                const w = this.map.sandStampWeight(t);
                // slightly stronger than pure wear so footsteps reclaim bloody/scorched ground
                this.map.stampSand(a.x, a.z, Math.max(a.radius * 1.35, 0.9) * Math.sqrt(w), 0.08 * w);
                prev.x = a.x;
                prev.z = a.z;
            }
        }
        this.map.flushSandMask();
    }

    /** Blood under hits/kills, scorch under blasts — same wear mask as sand. */
    private stampWearFromEvents(events: readonly SimEvent[]): void {
        if (prefs().groundEffects === 'off') return;
        for (const e of events) {
            if (e.kind === 'impact' && e.y > 0.25) {
                this.map.stampBlood(e.x, e.z, 1.1, 0.55);
            } else if (e.kind === 'death') {
                if (e.wear === 'ash') {
                    this.map.stampScorch(e.x, e.z, e.big ? 10 : 7, e.big ? 0.85 : 0.7);
                } else if (e.wear === 'blood') {
                    this.map.stampBlood(e.x, e.z, e.big ? 2.4 : 1.35, e.big ? 0.75 : 0.65);
                }
            } else if (e.kind === 'explosion') {
                const scorchR = Math.max(e.radius * (e.heavy ? 1.15 : 0.9), 2);
                this.map.stampScorch(e.x, e.z, scorchR, e.heavy ? 0.55 : 0.16);
                if (e.heavy) {
                    // second wider bloom so the divine stamp scars the board
                    this.map.stampScorch(e.x, e.z, scorchR * 1.35, 0.28);
                }
            } else if (e.kind === 'groundFire') {
                this.map.stampScorch(e.x, e.z, Math.max(e.radius * 0.85, 2), e.oilCells > 0 ? 0.35 : 0.22);
            }
        }
    }

    /** the living mech whose on-screen position is closest to the click */
    private pickActor(e: PointerEvent): Actor | null {
        if (!this.sim) return null;
        const rect = this.pixiApp.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.sim.actors) {
            if (!a.alive) continue;
            const t = a.unit.type;
            const groundY = a.altitude > 0 ? 0 : groundHeightAt(a.rx, a.rz);
            const screen = this.rig.worldToScreen(a.rx, groundY + a.altitude + t.meshScale * 0.55, a.rz, w, h);
            if (!screen) continue;
            const d = Math.hypot(screen.x - sx, screen.y - sy);
            const pickRadius = Math.max(20, t.meshScale * 16);
            if (d < pickRadius && d < bestD) {
                bestD = d;
                best = a;
            }
        }
        return best;
    }

    /** the range ring follows the selected battle mech, tinted by its team */
    private updateBattleRangeRing(): void {
        const a = this.phase === 'battle' ? this.selectedActor : null;
        this.battleRangeMesh.visible = a !== null;
        if (!a) return;
        const radius =
            this.resolvedStats(a.unit).range + a.unit.type.collisionRadius;
        placeRangeRing(this.battleRangeMesh, a.rx, a.rz, radius);
        const material = this.battleRangeMesh.material as import('three').MeshBasicMaterial;
        material.color.setHex(a.unit.team === 'player' ? THEME.valid : teamColors.enemy.hex);
    }

    private updateSelectionUi(): void {
        this.updateBattleRangeRing();
        if (this.phase === 'battle' && this.sim) {
            if (this.selectedActor && !this.selectedActor.alive) this.selectedActor = null;
            this.hpBars.update(
                this.sim.actors,
                this.rig.camera,
                this.pixiApp.screen.width,
                this.pixiApp.screen.height,
                this.selectedActor,
                this.sim.elapsed,
            );
            this.hud.setSelection(this.selectedActor ? this.actorInfo(this.selectedActor) : null);
        }
        let buildInfo: SelectionInfo | null = null;
        if (this.phase !== 'battle' || !this.sim) {
            const unit = this.placement.selectedUnit;
            buildInfo = unit ? this.unitInfo(unit) : null;
            this.hud.setSelection(buildInfo);
        }
        const build = this.phase !== 'battle';
        const lvl = build ? buildInfo?.levelUp : undefined;
        const repositionable =
            build && this.placement.selectedRepositionable && !this.armedTactic;
        this.hud.setTouchActions({
            carrying: this.placement.pointerCarries,
            // Move enters carry mode explicitly; Rotate only makes sense once
            // the pack actually rides the finger
            move: repositionable && !this.placement.pointerCarries,
            rotate: repositionable && this.placement.pointerCarries,
            levelUp: lvl?.ready ? { cost: lvl.cost, affordable: lvl.affordable } : null,
            levelAll: lvl?.ready && lvl.all ? lvl.all : null,
            upgrade:
                build && buildInfo?.towerUpgrade && !buildInfo.towerUpgrade.maxed
                    ? {
                          cost: buildInfo.towerUpgrade.cost,
                          affordable: buildInfo.towerUpgrade.affordable,
                      }
                    : null,
        });
    }

    /** display name for the side that owns a pack */
    private ownerName(team: Team): string {
        return team === 'player' ? this.playerNames.local : this.playerNames.opponent;
    }

    /** veterancy display values for a pack (enemy uses phase-start intel while fogged) */
    private levelInfo(u: Unit): { level: number; xp: number; xpNext: number; statMult: number } {
        const intel = this.placement.intelOf(u);
        const level = intel?.level ?? u.level;
        const xp = intel?.xp ?? u.xp;
        const { statBonusPerLevel, maxLevel } = this.settings.leveling;
        const xpNext =
            level >= maxLevel
                ? -1
                : xpThresholdFor(u.type, level, this.economy, this.settings.leveling);
        return { level, xp, xpNext, statMult: 1 + (level - 1) * statBonusPerLevel };
    }

    private actorInfo(a: Actor): SelectionInfo {
        const u = a.unit;
        const rs = this.resolvedStats(u);
        const lv = this.levelInfo(u);
        return {
            name: u.type.name,
            team: u.team,
            owner: this.ownerName(u.team),
            hp: a.hp,
            maxHp: a.maxHp,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: u.type.splashRadius,
            structure: !!u.type.structure,
            items: u.items.length
                ? u.items.map((id) => ({
                      icon: ITEMS[id]?.icon ?? '?',
                      name: ITEMS[id]?.name ?? id,
                      desc: ITEMS[id]?.description ?? '',
                  }))
                : undefined,
            record: u.type.structure
                ? undefined
                : { damageDealt: u.damageDealt, kills: u.kills },
            alive: 1,
            total: 1,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            techs: this.techSelection(u),
            ...this.researchCenterSelection(u),
            ...this.commandTowerSelection(u),
        };
    }

    private unitInfo(u: Unit): SelectionInfo {
        const rs = this.resolvedStats(u);
        const lv = this.levelInfo(u);
        const itemIds = this.placement.intelOf(u)?.items ?? u.items;
        const ownInteractive = u.team === 'player' && this.playerCanAct;
        return {
            name: u.type.name,
            team: u.team,
            owner: this.ownerName(u.team),
            hp: rs.hp * lv.statMult,
            maxHp: rs.hp * lv.statMult,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: u.type.splashRadius,
            alive: u.members.length,
            total: u.members.length,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            structure: !!u.type.structure,
            items: itemIds.length
                ? itemIds.map((id) => ({
                      icon: ITEMS[id]?.icon ?? '?',
                      name: ITEMS[id]?.name ?? id,
                      desc: ITEMS[id]?.description ?? '',
                  }))
                : undefined,
            record: u.type.structure ? undefined : { damageDealt: u.damageDealt, kills: u.kills },
            // base buildings level for supply alone, on a rising price ladder
            towerUpgrade:
                ownInteractive && u.type.structure && !u.type.extra
                    ? {
                          cost: towerUpgradeCost(u.level, this.settings.towers),
                          affordable:
                              this.economy.balance('player') >=
                              towerUpgradeCost(u.level, this.settings.towers),
                          maxed: u.level >= this.settings.towers.upgrade.maxLevel,
                          maxLevel: this.settings.towers.upgrade.maxLevel,
                      }
                    : undefined,
            // the next level is a purchase: needs banked XP and supply
            levelUp: this.levelUpInfo(u, lv),
            techs: this.techSelection(u),
            ...this.researchCenterSelection(u),
            ...this.commandTowerSelection(u),
        };
    }

    /**
     * True when the opponent's purchases are visible: after we lock in, or in
     * battle — same fog as spells / inventory / Command Tower tiles.
     */
    private enemyActionIntelVisible(): boolean {
        // live board (fog off / battle / after we lock in) — same window as
        // when enemy packs are selectable with full details
        return (
            this.phase === 'battle' ||
            this.deployReady.player ||
            !this.placement.intelFogOn
        );
    }

    /** pack/unit techs for the action row (buyable for self in deploy; inspect otherwise) */
    private techSelection(u: Unit): SelectionInfo['techs'] {
        if (u.type.structure || u.type.techs.length === 0) return undefined;
        const canBuy = u.team === 'player' && this.playerCanAct;
        const canInspect =
            u.team === 'player' || (u.team === 'enemy' && this.enemyActionIntelVisible());
        if (!canBuy && !canInspect) return undefined;

        const team = u.team;
        const ownedCount = this.techTree.ownedFor(team, u.type.id).size;
        const bal = this.economy.balance('player');
        return u.type.techs.map((t) => {
            const owned = this.techTree.has(team, u.type.id, t.id);
            const cost = this.economy.techCostOf(t, ownedCount);
            return {
                id: t.id,
                name: t.name,
                desc: techDescription(t),
                icon: techIcon(t),
                cost,
                owned,
                affordable: canBuy && !owned && bal >= cost,
            };
        });
    }

    /**
     * Command Tower ability tiles for the selection panel.
     * Own building: buyable while acting, read-only in battle. Enemy: read-only
     * once intel is live (locked in / battle) — same fog as spells & inventory.
     */
    private researchCenterSelection(u: Unit): Pick<
        SelectionInfo,
        'recruit' | 'deploySlot' | 'rangeBoost' | 'speedBoost' | 'credit'
    > {
        if (u.type !== RESEARCH_CENTER) return {};
        const canBuy = u.team === 'player' && this.playerCanAct;
        const canInspect =
            u.team === 'player' || (u.team === 'enemy' && this.enemyActionIntelVisible());
        if (!canBuy && !canInspect) return {};

        const team = u.team;
        const bal = this.economy.balance('player');
        return {
            recruit: {
                cost: this.settings.leveling.recruitLevel2Cost,
                active: this.recruitLevel[team] > 1,
                affordable: canBuy && bal >= this.settings.leveling.recruitLevel2Cost,
            },
            deploySlot: {
                cost: this.settings.deploy.extraSlotCost,
                active: this.deployState.extra[team] > 0,
                affordable: canBuy && bal >= this.settings.deploy.extraSlotCost,
            },
            rangeBoost: {
                cost: this.settings.deploy.rangedRangeBoostCost,
                bonus: this.settings.deploy.rangeBoost,
                active: this.roundBoosts.range[team],
                affordable: canBuy && bal >= this.settings.deploy.rangedRangeBoostCost,
            },
            speedBoost: {
                cost: this.settings.deploy.armySpeedBoostCost,
                bonus: this.settings.deploy.speedBoost,
                active: this.roundBoosts.speed[team],
                affordable: canBuy && bal >= this.settings.deploy.armySpeedBoostCost,
            },
            credit: {
                gain: this.settings.deploy.creditGain,
                debt: this.settings.deploy.creditDebt,
                active: this.creditUsed[team],
                affordable: canBuy,
            },
        };
    }

    /** Research Center permanent tracks — buyable for self in deploy; inspect with fog */
    private commandTowerSelection(
        u: Unit,
    ): Pick<SelectionInfo, 'boosts' | 'sellAbility' | 'rallyRouteAbility'> {
        if (u.type !== COMMAND_TOWER) return {};
        const canBuy = u.team === 'player' && this.playerCanAct;
        const canInspect =
            u.team === 'player' || (u.team === 'enemy' && this.enemyActionIntelVisible());
        if (!canBuy && !canInspect) return {};

        const team = u.team;
        const bal = this.economy.balance('player');
        return {
            boosts: (['attack', 'hp'] as const).map((id) => {
                const tiers =
                    id === 'attack' ? this.settings.boosts.attackTiers : this.settings.boosts.hpTiers;
                const tier = this.boostState[id][team];
                const maxed = tier >= tiers.length;
                const pct = Math.round(tiers[maxed ? tier - 1 : tier]! * 100);
                const cost = maxed ? 0 : this.settings.boosts.costs[tier]!;
                return {
                    id,
                    label: `Army ${id === 'attack' ? 'attack' : 'HP'} +${pct}%`,
                    cost,
                    affordable: canBuy && !maxed && bal >= cost,
                    maxed,
                };
            }),
            sellAbility: {
                cost: this.settings.sell.abilityCost,
                owned: this.sellState.owned[team],
                affordable: canBuy && bal >= this.settings.sell.abilityCost,
            },
            rallyRouteAbility: {
                cost: this.settings.rallyRoute.abilityCost,
                owned: this.rallyRouteOwned[team],
                affordable: canBuy && bal >= this.settings.rallyRoute.abilityCost,
            },
        };
    }
}

/** yaw so local +Z points from (ax,az) toward (bx,bz); 0 if the points coincide */
function yawToward(ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    if (dx * dx + dz * dz < 1e-8) return 0;
    // matches drapeRectGeometry: local +Z → (-sin(yaw), cos(yaw))
    return Math.atan2(-dx, dz);
}
