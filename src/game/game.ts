import type { Application } from 'pixi.js';
import {
    Color,
    DirectionalLight,
    Fog,
    HemisphereLight,
    PCFSoftShadowMap,
    PMREMGenerator,
    Scene,
    WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEME } from '../theme';
import { CameraRig } from '../engine/cameraRig';
import { CameraControls } from '../engine/cameraControls';
import { disposeScene } from '../engine/disposeScene';
import { ActionDispatcher, levelCost, towerUpgradeCost, xpForNextLevel, type Action, type LoggedAction } from './actions';
import { AiOpponent, type Opponent } from './ai';
import { clearResumeMarker, clearSinglePlayer, GAME_VERSION, NetworkOpponent, type NetMessage, type NetSession } from './net';
import {
    AIR_BONUS,
    COST_CONTROL_INCOME,
    COST_CONTROL_PENALTY,
    ELITE_ROUND1_BONUS,
    FREE_MARKSMAN_LEVEL,
    FREE_MARKSMAN_ROUND,
    ROUND_CARDS,
    SKIP_CARD_REWARD,
    START_CARDS,
    type RoundCard,
    type SpecialityId,
    type StartCard,
} from './cards';
import { assignTeamColors, teamColors } from './colors';
import { CHAT_COOLDOWN_MS, CHAT_TEXT_LIMIT, type ChatItem } from './emotes';
import { ITEMS } from './items';
import { BASE_ANCHORS, BattleMap, CELL, groundHeightAt, mulberry32, type Cell } from './map';
import { Particles, ProjectileRenderer } from './effects';
import { Scenery } from './scenery';
import { createRangeRing, PlacementController } from './placement';
import { RallyVisuals, type RallyDraft } from './rallyVisuals';
import { DEFAULT_SETTINGS, Economy, normalizeGameSettings, type GameSettings } from './settings';
import { BattleSim, type Actor, type SimEvent } from './sim';
import { RALLY_ROUTE_ID, TACTICS, type RallyRoute } from './tactics';
import { TechTree } from './tech';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    techDescription,
    techIcon,
    unitTypeById,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import { DebugOverlay } from '../ui/debug';
import { HpBars } from '../ui/hpBars';
import { Hud, type Phase, type SelectionInfo } from '../ui/hud';
import { renderAllUnitIcons } from '../ui/unitIcons';
import { updateAnimatedUnits } from './unitAnimated';

/** how long the both-specialists reveal stays up before deployment takes over */
const SPECIALIST_REVEAL_MS = 2000;

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
    private readonly placement: PlacementController;
    private readonly hud: Hud;
    private readonly debug: DebugOverlay;
    private readonly hpBars = new HpBars();
    private readonly projectileRenderer: ProjectileRenderer;
    private readonly particles: Particles;
    private readonly scenery: Scenery;
    private readonly rallyVisuals: RallyVisuals;
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
    private readonly rngCards: Record<Team, () => number>;
    /** the other side's decision maker (built-in AI or the network peer) */
    private readonly opponent: Opponent;
    /** which sides locked in the current deployment — battle starts at both */
    private readonly deployReady: Record<Team, boolean> = { player: false, enemy: false };
    /** streamed peer events, applied in order once our game reaches their round */
    private readonly remoteQueue: { round: number; action?: Action; undo?: boolean }[] = [];
    /** per-team recruit level for the running round (the once-per-round level-2 switch) */
    private readonly recruitLevel: Record<Team, number> = { player: 1, enemy: 1 };
    /** the sell ability: `owned` is a permanent match unlock, `used` resets per round */
    private readonly sellState: { owned: Record<Team, boolean>; used: Record<Team, number> } = {
        owned: { player: false, enemy: false },
        used: { player: 0, enemy: 0 },
    };
    /** per-round buy limits: `limit` is permanent (specials may raise it), rest resets per round */
    private readonly deployState: {
        limit: Record<Team, number>;
        extra: Record<Team, number>;
        used: Record<Team, number>;
        extrasSpent: Record<Team, number>;
    };
    /** permanent army-wide boost tiers (0 = none), bought at the Command Tower */
    private readonly boostState: Record<'attack' | 'hp', Record<Team, number>> = {
        attack: { player: 0, enemy: 0 },
        hp: { player: 0, enemy: 0 },
    };
    /** round-only stat boosts from the Research Center (reset each deployment) */
    private readonly roundBoosts: { range: Record<Team, boolean>; speed: Record<Team, boolean> } = {
        range: { player: false, enemy: false },
        speed: { player: false, enemy: false },
    };
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
    /** true once the test rally-route charge has been granted */
    private testRallyRouteGranted = false;
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
    /** the tactic currently being placed on the map */
    private armedTactic: string | null = null;
    /** first click of an in-progress rally route */
    private rallyDraftStart: { x: number; z: number } | null = null;
    /** whether each side already took/skipped this round's card */
    private readonly roundCardTaken: Record<Team, boolean> = { player: false, enemy: false };
    /** the game idles behind the card overlay until the loadout is picked */
    private awaitingCards = true;
    /** rebuilding from a recorded log: no UI, no net sends, battles fast-forward */
    private hydrating = false;
    /** connection lost: everything pauses until the peer is back */
    private suspended = false;
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
    private readonly boundTick = (ticker: { deltaMS: number }) => this.tick(ticker.deltaMS / 1000);
    private readonly onEscapeKey = (e: KeyboardEvent) => {
        if (e.code !== 'Escape') return;
        if (this.matchOver || this.suspended) return;
        this.hud.togglePauseMenu();
        if (this.hud.isPauseMenuOpen()) {
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
            this.cancelRallyPlacement();
        }
    };
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
        resume: { actions: LoggedAction[]; battleElapsed: number | null; local?: boolean } | null = null,
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
        this.renderer = new WebGLRenderer({ canvas: threeCanvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;

        this.scene.background = new Color(THEME.sky);
        this.scene.fog = new Fog(THEME.sky, THEME.fogNear, THEME.fogFar);

        // PBR environment: metallic (Tripo) models render near-black with nothing
        // to reflect, so give the scene a neutral image-based light. Kept subtle so
        // it lifts the metals without washing out the tuned direct-light look.
        const pmrem = new PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.55;
        pmrem.dispose();

        this.scene.add(new HemisphereLight(THEME.hemiSky, THEME.hemiGround, THEME.hemiIntensity));
        const sun = new DirectionalLight(THEME.sun, THEME.sunIntensity);
        sun.position.set(120, 160, 80);
        sun.castShadow = true;
        sun.shadow.mapSize.set(4096, 4096);
        // frustum reaches past the field so the tree ring casts onto its edges
        sun.shadow.camera.left = -this.map.halfW - 40;
        sun.shadow.camera.right = this.map.halfW + 40;
        sun.shadow.camera.top = this.map.halfH + 40;
        sun.shadow.camera.bottom = -this.map.halfH - 40;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 500;
        this.scene.add(sun);

        this.scene.add(this.map.createMesh());
        this.scenery = new Scenery(this.map);
        this.scene.add(this.scenery.group);
        this.rallyVisuals = new RallyVisuals(this.scene, this.map);
        this.gridOverlay = this.map.createOverlayMesh();
        this.scene.add(this.gridOverlay);
        this.projectileRenderer = new ProjectileRenderer(this.scene);
        this.particles = new Particles(this.scene);
        this.battleRangeMesh = createRangeRing(this.scene);

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map
        this.rig.setBounds(this.map.halfW - 8, this.map.halfH - 16);
        this.rig.fitMap(this.map.width, this.map.height);
        // open centered on the player's own zone (where the starting army
        // stands) — the far-side owner looks at the shared board rotated 180°
        const nearSide = side === 'a';
        this.rig.setBaseHeading(nearSide ? 0 : Math.PI);
        const ownZoneZ =
            (this.map.halfH - (this.map.size.zoneRows * CELL) / 2) * (nearSide ? 1 : -1);
        this.rig.startAt(0, ownZoneZ, 110);
        this.controls = new CameraControls(this.rig, surface);
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        this.seed = settings.seed ?? (Math.random() * 0x7fffffff) | 0;
        this.rngAi = mulberry32(seedFrom(this.seed, 'ai'));
        // card streams are keyed by canonical side, so both peers compute the
        // same offers for the same player regardless of local perspective
        this.rngCards = {
            player: mulberry32(seedFrom(this.seed, `cards-${side}`)),
            enemy: mulberry32(seedFrom(this.seed, `cards-${side === 'a' ? 'b' : 'a'}`)),
        };
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
            deploySettings: settings.deploy,
            boostSettings: settings.boosts,
            recruitLevel: this.recruitLevel,
            sellState: this.sellState,
            deployState: this.deployState,
            boostState: this.boostState,
            roundBoosts: this.roundBoosts,
            speciality: this.speciality,
            flankSpawnMult: this.flankSpawnMult,
            items: this.itemInventory,
            tactics: this.tacticInventory,
            rallyRoutes: this.rallyRoutes,
            rallyRouteIds: this.rallyRouteIds,
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
                    this.cancelRallyPlacement();
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
                  rng: this.rngAi,
              });
        this.placement.dispatch = (action) => this.dispatchPlayer(action);
        // gold pulse under packs whose next level is buyable right now
        this.placement.levelReady = (unit) => this.canLevel(unit);
        // an armed inventory item lands on the next own pack that gets clicked
        this.placement.onSelect = (unit) => {
            if (!this.armedItem) return;
            if (this.applyItemTo(unit, this.armedItem)) this.armedItem = null;
        };
        this.placement.groundClickInterceptor = (x, y) => this.handleRallyGroundClick(x, y);
        this.controls.onMiddleClick = () => {
            if (this.armedTactic) return;
            this.placement.rotateSelected();
        };
        this.placement.rangeOf = (unit) => this.resolvedStats(unit).range;
        this.controls.onRightClick = () => {
            if (this.cancelRallyPlacement()) return;
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
            this.net?.send({ type: 'chat', item });
        };
        this.hud.onArmItem = (itemId) => {
            if (!this.playerCanAct || this.armedTactic) return;
            this.armedItem = this.armedItem === itemId ? null : itemId; // click again to disarm
        };
        this.hud.onArmTactic = (tacticId) => {
            if (!this.playerCanAct) return;
            if (this.armedTactic === tacticId) {
                this.cancelRallyPlacement();
                return;
            }
            this.armedItem = null;
            this.placement.deselect();
            this.armedTactic = tacticId;
            this.rallyDraftStart = null;
            this.placement.inputLocked = true;
            this.syncRallyVisuals();
        };
        this.hud.onCancelTactic = () => {
            this.cancelRallyPlacement();
        };
        this.hud.onResetPlacedTactic = (routeId) => {
            this.resetPlacedRallyRoute(routeId);
        };
        this.hud.onRecruitLevel = () => {
            // offered in the Research Center's menu
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
        this.hud.onSellUnit = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player' || unit.type.structure) return;
            this.dispatchPlayer({ kind: 'sellUnit', team: 'player', unitId: unit.id });
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
            this.hud.mode,
            new URLSearchParams(location.search).has('debug'),
        );
        pixiApp.stage.addChild(this.hpBars.view, this.debug.view);

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
        } else {
            this.showStarterPick(this.draw(START_CARDS, 4, this.rngCards.player));
        }
        // only now may peer messages flow — everything they touch exists
        if (this.net) this.wireSession(this.net);

        // Escape toggles the in-game menu (the match keeps running underneath)
        window.addEventListener('keydown', this.onEscapeKey);

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', this.onWindowResize);
        pixiApp.ticker.add(this.boundTick);
    }

    /** stop the loop, release GPU/DOM resources — main restores the menu */
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
        this.rallyVisuals.dispose();
        this.controls.dispose();
        this.hud.destroy();
        this.pixiApp.stage.removeChild(this.hpBars.view);
        this.pixiApp.stage.removeChild(this.debug.view);
        this.hpBars.view.destroy({ children: true });
        this.debug.view.destroy({ children: true });
        // drop any HTML HUD nodes still attached to the pixi canvas (html-in-canvas mode)
        for (const node of [...this.pixiApp.canvas.children]) {
            if (node instanceof HTMLElement) node.remove();
        }
        disposeScene(this.scene);
        this.renderer.dispose();
        this.net?.close();
        this.net = null;
    }

    /**
     * Each side's three base buildings (anchors shared with BattleMap so the
     * ground relief stays flat underneath): the Research Center left and the
     * Command Tower right, both pushed toward the enemy, plus the big
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
            // player sees their own research center left, command tower right
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

    /** A new round: place freely, hidden from the opponent, until timer or button. */
    private startBuildPhase(): void {
        this.resetSpeed();
        this.round++;
        this.phase = 'build';
        this.phaseRemaining = this.settings.buildTimeSeconds;
        this.placement.beginDeployment();
        this.placement.enabled = true;
        this.placement.hiddenPlacements = true;
        this.placement.currentRound = this.round; // earlier deployments are locked now
        this.selectedActor = null;
        this.hpBars.clear();
        this.rallyRoutes.length = 0;
        this.cancelRallyPlacement();
        this.syncRallyVisuals();
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
        this.deployState.used.player = 0;
        this.deployState.used.enemy = 0;
        this.deployState.extrasSpent.player = 0;
        this.deployState.extrasSpent.enemy = 0;
        this.deployReady.player = false;
        this.deployReady.enemy = false;
        this.unlockUsedThisRound.player = false;
        this.unlockUsedThisRound.enemy = false;
        this.hud.refreshCosts();
        this.refreshShopHud();
        this.economy.grantRoundIncome(this.round);
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
            if (this.speciality[team] === 'marksman' && this.round === FREE_MARKSMAN_ROUND) {
                const type = unitTypeById('marksman')!;
                const anchor = this.placement.findStartSpot(team, type);
                const unit = anchor ? this.placement.spawn(type, anchor, team, false, true) : null;
                if (unit) {
                    unit.level = FREE_MARKSMAN_LEVEL;
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

        if (this.round === 1 && !this.hydrating) this.ensureTestRallyRoute();
    }

    /**
     * Dev/testing: one free rally-route charge for the match. Not in the action
     * log, so this also runs after hydrate/reload to restore the test grant.
     * In multiplayer both sides get the test charge so peer validation stays aligned.
     */
    private ensureTestRallyRoute(): void {
        if (this.testRallyRouteGranted) return;
        this.testRallyRouteGranted = true;
        const teams: Team[] = this.net ? ['player', 'enemy'] : ['player'];
        for (const team of teams) {
            if (!this.tacticInventory[team].includes(RALLY_ROUTE_ID)) {
                this.tacticInventory[team].push(RALLY_ROUTE_ID);
            }
        }
    }

    /** local player input — refused once this deployment is locked in; every
     *  accepted action streams to the peer immediately */
    private dispatchPlayer(action: Action): boolean {
        if (this.deployReady.player || this.suspended) return false;
        if (!this.dispatcher.dispatch(action)) return false;
        if (this.round >= 1) this.net?.send({ type: 'action', round: this.round, action });
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
            this.net?.send({ type: 'starter', cardId });
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
        this.net?.send({ type: 'starter', cardId: pick.id });
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

    /** the peer is back on a fresh session — continue exactly where we were */
    resumeWith(session: NetSession): void {
        if (this.disposed) return;
        this.wireSession(session);
        this.suspended = false;
        this.hud.hideNotice();
    }

    /** everything a rejoining peer needs to rebuild the match (our perspective) */
    exportResume(): {
        seed: number;
        settings: GameSettings;
        actions: LoggedAction[];
        battleElapsed: number | null;
    } {
        return {
            seed: this.seed,
            settings: this.settings,
            actions: this.dispatcher.serializable(),
            battleElapsed: this.phase === 'battle' && this.sim ? this.sim.elapsed : null,
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

        if (!this.matchOver) this.ensureTestRallyRoute();

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
            this.dispatcher.dispatch({ kind: 'chooseCard', team: 'enemy', cardId: msg.cardId });
            this.refreshShopHud();
            this.syncSpecialities();
            this.maybeStartMatch();
        } else if (msg.type === 'action') {
            this.remoteQueue.push({ round: msg.round, action: msg.action });
            this.drainRemoteQueue();
        } else if (msg.type === 'undo') {
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
            this.hud.addChat(this.playerNames.opponent, item, 'remote');
        } else if (msg.type === 'speed') {
            const index = Game.SPEED_STEPS.indexOf(msg.multiplier);
            if (index >= 0) {
                this.speedIndex = index;
                this.hud.setSpeed(msg.multiplier);
            }
        } else if (msg.type === 'resume') {
            // the peer reloaded and rebuilt mid-session (rare direct path)
            this.net?.send({ type: 'state', version: GAME_VERSION, ...this.exportResume() });
        }
    }

    /**
     * Applies streamed peer events strictly in order, holding at the head
     * until our game reaches the event's round (our battle may lag theirs).
     */
    private drainRemoteQueue(): void {
        while (this.remoteQueue.length > 0) {
            const head = this.remoteQueue[0]!;
            if (head.round !== this.round || this.phase !== 'build' || this.awaitingCards) return;
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
     * The between-round card offer: the enemy quietly picks from its own
     * draw, the player gets the overlay (the round clock waits). Skipping
     * pays a small consolation instead.
     */
    private offerRoundCards(): void {
        this.roundCardTaken.player = false;
        this.roundCardTaken.enemy = false;

        // each side's offer comes from its OWN card stream — reproducible on
        // any peer regardless of when either client computes it
        const enemyOffer = this.draw(ROUND_CARDS, 4, this.rngCards.enemy);
        const offer = this.draw(ROUND_CARDS, 4, this.rngCards.player);
        if (this.hydrating) {
            // no UI, no opponent hook — the recorded actions carry the picks;
            // the streams were consumed above so future offers stay aligned
            this.pendingOffer = offer;
            return;
        }
        this.opponent.onRoundCards(enemyOffer);
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
        return this.itemInventory.player.map((id) => {
            const item = ITEMS[id];
            return {
                id,
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
                armed: this.armedItem === id,
            };
        });
    }

    /** the left-side tactics strip: placed routes + remaining slots this round */
    private tacticsView(): {
        id: string;
        icon: string;
        name: string;
        armed: boolean;
        placed?: boolean;
        routeId?: number;
    }[] {
        if (!this.playerCanAct) return [];
        const tactic = TACTICS[RALLY_ROUTE_ID];
        const maxCharges = this.tacticInventory.player.filter((id) => id === RALLY_ROUTE_ID).length;
        if (maxCharges === 0) return [];

        const placed = this.rallyRoutes
            .filter((r) => r.team === 'player')
            .map((r) => ({
                id: RALLY_ROUTE_ID,
                icon: tactic?.icon ?? '⚑',
                name: tactic ? `${tactic.name} — placed` : 'Rally Route — placed',
                armed: false,
                placed: true as const,
                routeId: r.id,
            }));

        const availableCount = maxCharges - placed.length;
        const available = Array.from({ length: availableCount }, () => ({
            id: RALLY_ROUTE_ID,
            icon: tactic?.icon ?? '⚑',
            name: tactic ? `${tactic.name} — ${tactic.description}` : RALLY_ROUTE_ID,
            armed: this.armedTactic === RALLY_ROUTE_ID,
        }));

        return [...placed, ...available];
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
        this.cancelRallyPlacement();
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

    private groundAtLocal(x: number, y: number): { x: number; z: number } | null {
        const rect = this.pixiApp.canvas.getBoundingClientRect();
        const ground = this.rig.screenToGround(x, y, rect.width, rect.height);
        if (!ground) return null;
        return this.rallyVisuals.clamp(ground.x, ground.z);
    }

    private syncRallyVisuals(): void {
        const pointer = this.placement.lastPointer;
        let draft: RallyDraft | null = null;
        if (this.armedTactic === RALLY_ROUTE_ID && pointer) {
            const pos = this.groundAtLocal(pointer.x, pointer.y);
            if (pos) {
                if (this.rallyDraftStart) {
                    draft = {
                        startX: this.rallyDraftStart.x,
                        startZ: this.rallyDraftStart.z,
                        endX: pos.x,
                        endZ: pos.z,
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

    /** own routes always; opponent routes only after we lock in (multiplayer fog) */
    private visibleRallyRoutes(): readonly RallyRoute[] {
        const revealEnemy =
            this.phase === 'battle' ||
            this.deployReady.player ||
            this.net === null;
        return this.rallyRoutes.filter(
            (r) => r.team === 'player' || revealEnemy,
        );
    }

    /** aborts in-progress rally placement; returns true when something was cancelled */
    private cancelRallyPlacement(): boolean {
        const had = this.armedTactic !== null || this.rallyDraftStart !== null;
        this.armedTactic = null;
        this.rallyDraftStart = null;
        this.placement.inputLocked = false;
        this.syncRallyVisuals();
        return had;
    }

    /** swallows map clicks while a tactic is being placed */
    private handleRallyGroundClick(x: number, y: number): boolean {
        if (!this.playerCanAct || this.armedTactic !== RALLY_ROUTE_ID) return false;
        const ground = this.groundAtLocal(x, y);
        if (!ground) return true;
        if (!this.rallyDraftStart) {
            this.rallyDraftStart = ground;
            this.syncRallyVisuals();
            return true;
        }
        if (
            this.dispatchPlayer({
                kind: 'placeRallyRoute',
                team: 'player',
                startX: this.rallyDraftStart.x,
                startZ: this.rallyDraftStart.z,
                endX: ground.x,
                endZ: ground.z,
            })
        ) {
            this.armedTactic = null;
            this.rallyDraftStart = null;
            this.placement.inputLocked = false;
            this.syncRallyVisuals();
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
        return (
            this.playerCanAct &&
            !unit.type.structure &&
            unit.level < this.settings.leveling.maxLevel &&
            unit.xp >= xpForNextLevel(unit, this.economy, this.settings.leveling)
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
        // both players watch at the same pace and finish together
        this.net?.send({ type: 'speed', multiplier });
    }

    /** battle speed returns to 1× at the start of every deployment phase */
    private resetSpeed(): void {
        const index = Game.SPEED_STEPS.indexOf(1);
        if (index < 0) return;
        this.speedIndex = index;
        this.hud.setSpeed(1);
        // during hydration this runs once per replayed round — don't spam the peer
        if (!this.hydrating) this.net?.send({ type: 'speed', multiplier: 1 });
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
        const anchor = this.placement.findBuySpot(type);
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
            this.net?.send({ type: 'undo', round: this.round }); // the peer mirrors it
        }
        this.hud.refreshCosts(); // the undone action may have been the recruit switch
        this.refreshShopHud();
        this.syncRallyVisuals();
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
        this.cancelRallyPlacement();
        this.gridOverlay.visible = false;
        this.enemyIntelSnapshot = null;
        this.placement.revealAll();
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
                !unit.type.structure &&
                !unit.type.extra &&
                this.placement.isOnFlank(unit),
            rallyRoutes: this.rallyRoutes.filter((r) => r.team === 'player' || r.team === 'enemy'),
        });
        // the sync point: both peers hash the identical battle-start state
        if (this.net && !this.hydrating) {
            const hash = this.stateHash();
            this.sentChecks.set(this.round, hash);
            this.net.send({ type: 'check', round: this.round, hash });
            this.verifyCheck(this.round);
        }
    }

    /** Battle is over: survivors bite into the opponent's HP, then the board resets. */
    private endBattlePhase(): void {
        if (this.sim) this.applyBattleResult(this.sim);
        this.sim = null;
        this.selectedActor = null;
        this.projectileRenderer.clear();
        if (this.playerHp <= 0 || this.enemyHp <= 0) {
            this.finishMatch();
            return;
        }
        // spent extras (broken shields, fired rockets) leave the board for good
        for (const unit of [...this.placement.allUnits()]) {
            if (unit.consumed) this.placement.removeUnit(unit);
            else unit.resetFormation();
        }
        this.placement.refaceAll();
        this.startBuildPhase();
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
        this.hud.showGameOver(result);
    }

    /**
     * Every surviving unit deals its value as player damage: the unit's base
     * price scaled by how much of it survived (half the crawler pack alive =
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
        // battle can be fast-forwarded (or slowed); build always runs at 1x
        const gameDt =
            this.phase === 'battle' ? dtSeconds * Game.SPEED_STEPS[this.speedIndex]! : dtSeconds;
        this.time += gameDt;

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
                this.sim.update(gameDt);
                this.particles.spawnFromEvents(this.sim.consumeEvents());
                this.sim.syncMeshes(); // per-frame interpolated positions
                this.sim.syncBattleVisuals(this.time);
                this.projectileRenderer.update(this.sim.projectiles, this.sim.alpha);
                // the battle clock is the sim's own fixed-step time; the sim
                // itself stops at the deciding step, identically on any peer
                this.phaseRemaining = this.settings.battleTimeSeconds - this.sim.elapsed;
                if (this.sim.finished) this.endBattlePhase();
            }
        }
        this.particles.update(gameDt);

        this.controls.update(dtSeconds);
        this.rig.update(dtSeconds);
        // ambient motion runs on real time, unaffected by battle fast-forward
        this.scenery.update(dtSeconds, this.rig.camera.position);
        updateAnimatedUnits(dtSeconds); // advance rigged unit walk/idle mixers
        this.placement.update(this.time, gameDt);
        this.updateSelectionUi();
        this.drainRemoteQueue();
        const waitingForPeer =
            this.net !== null &&
            !this.matchOver &&
            ((this.phase === 'build' && this.deployReady.player && !this.deployReady.enemy) ||
                (this.awaitingCards && this.round === 0 && this.speciality.player !== null));
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
        this.syncRallyVisuals();
        this.hud.setSupply(this.economy.balance('player'));
        this.hud.setLevelAllGlobal(this.playerCanAct ? this.globalLevelUpInfo() : null);
        this.refreshShopHud();
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.hud.layout();
        this.debug.update(this.pixiApp, this.rig, this.placement.unitCount, dtSeconds);
        this.renderer.render(this.scene, this.rig.camera);

        if (this.onStateCheckpoint && !this.net && !this.matchOver && !this.hydrating) {
            this.persistTimer += dtSeconds;
            const interval = this.phase === 'battle' ? 0.25 : 1;
            if (this.persistTimer >= interval) {
                this.persistTimer = 0;
                this.onStateCheckpoint();
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
        this.battleRangeMesh.position.set(a.rx, 0.05, a.rz);
        this.battleRangeMesh.scale.set(radius, 1, radius);
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
        } else {
            const unit = this.placement.selectedUnit;
            this.hud.setSelection(unit ? this.unitInfo(unit) : null);
        }
    }

    /** veterancy display values for a pack, from the leveling settings */
    private levelInfo(u: Unit): { level: number; xp: number; xpNext: number; statMult: number } {
        const { statBonusPerLevel, maxLevel } = this.settings.leveling;
        const xpNext =
            u.level >= maxLevel ? -1 : xpForNextLevel(u, this.economy, this.settings.leveling);
        return { level: u.level, xp: u.xp, xpNext, statMult: 1 + (u.level - 1) * statBonusPerLevel };
    }

    private actorInfo(a: Actor): SelectionInfo {
        const rs = this.resolvedStats(a.unit);
        const lv = this.levelInfo(a.unit);
        return {
            name: a.unit.type.name,
            team: a.unit.team,
            hp: a.hp,
            maxHp: a.maxHp,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: a.unit.type.splashRadius,
            structure: !!a.unit.type.structure,
            items: a.unit.items.length
                ? a.unit.items.map((id) => ({ icon: ITEMS[id]?.icon ?? '?', name: ITEMS[id]?.name ?? id, desc: ITEMS[id]?.description ?? '' }))
                : undefined,
            record: a.unit.type.structure
                ? undefined
                : { damageDealt: a.unit.damageDealt, kills: a.unit.kills },
            alive: 1,
            total: 1,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
        };
    }

    private unitInfo(u: Unit): SelectionInfo {
        const rs = this.resolvedStats(u);
        const lv = this.levelInfo(u);
        return {
            name: u.type.name,
            team: u.team,
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
            items: u.items.length
                ? u.items.map((id) => ({ icon: ITEMS[id]?.icon ?? '?', name: ITEMS[id]?.name ?? id, desc: ITEMS[id]?.description ?? '' }))
                : undefined,
            record: u.type.structure ? undefined : { damageDealt: u.damageDealt, kills: u.kills },
            // base buildings level for supply alone, on a rising price ladder
            towerUpgrade:
                u.team === 'player' && this.playerCanAct && u.type.structure && !u.type.extra
                    ? {
                          cost: towerUpgradeCost(u.level, this.settings.towers),
                          affordable:
                              this.economy.balance('player') >=
                              towerUpgradeCost(u.level, this.settings.towers),
                          maxed: u.level >= this.settings.towers.upgrade.maxLevel,
                          maxLevel: this.settings.towers.upgrade.maxLevel,
                      }
                    : undefined,
            // the once-per-round level-2 recruit switch lives in the Research Center
            recruit:
                u.team === 'player' && this.playerCanAct && u.type === RESEARCH_CENTER
                    ? {
                          cost: this.settings.leveling.recruitLevel2Cost,
                          active: this.recruitLevel.player > 1,
                          affordable:
                              this.economy.balance('player') >=
                              this.settings.leveling.recruitLevel2Cost,
                      }
                    : undefined,
            // the Research Center sells +1 deployment for the running round
            deploySlot:
                u.team === 'player' && this.playerCanAct && u.type === RESEARCH_CENTER
                    ? {
                          cost: this.settings.deploy.extraSlotCost,
                          active: this.deployState.extra.player > 0,
                          affordable:
                              this.economy.balance('player') >= this.settings.deploy.extraSlotCost,
                      }
                    : undefined,
            rangeBoost:
                u.team === 'player' && this.playerCanAct && u.type === RESEARCH_CENTER
                    ? {
                          cost: this.settings.deploy.rangedRangeBoostCost,
                          bonus: this.settings.deploy.rangeBoost,
                          active: this.roundBoosts.range.player,
                          affordable:
                              this.economy.balance('player') >=
                              this.settings.deploy.rangedRangeBoostCost,
                      }
                    : undefined,
            speedBoost:
                u.team === 'player' && this.playerCanAct && u.type === RESEARCH_CENTER
                    ? {
                          cost: this.settings.deploy.armySpeedBoostCost,
                          bonus: this.settings.deploy.speedBoost,
                          active: this.roundBoosts.speed.player,
                          affordable:
                              this.economy.balance('player') >=
                              this.settings.deploy.armySpeedBoostCost,
                      }
                    : undefined,
            // Command Tower: the two permanent army-wide boost tracks
            boosts:
                u.team === 'player' && this.playerCanAct && u.type === COMMAND_TOWER
                    ? (['attack', 'hp'] as const).map((id) => {
                          const tiers =
                              id === 'attack'
                                  ? this.settings.boosts.attackTiers
                                  : this.settings.boosts.hpTiers;
                          const tier = this.boostState[id].player;
                          const maxed = tier >= tiers.length;
                          const pct = Math.round(tiers[maxed ? tier - 1 : tier]! * 100);
                          const cost = maxed ? 0 : this.settings.boosts.costs[tier]!;
                          return {
                              id,
                              label: `Army ${id === 'attack' ? 'attack' : 'HP'} +${pct}%`,
                              cost,
                              affordable: !maxed && this.economy.balance('player') >= cost,
                              maxed,
                          };
                      })
                    : undefined,
            // so does the permanent sell-ability unlock
            sellAbility:
                u.team === 'player' && this.playerCanAct && u.type === COMMAND_TOWER
                    ? {
                          cost: this.settings.sell.abilityCost,
                          owned: this.sellState.owned.player,
                          affordable:
                              this.economy.balance('player') >= this.settings.sell.abilityCost,
                      }
                    : undefined,
            // once unlocked, own packs can be sold (limited per round)
            sell:
                u.team === 'player' &&
                this.phase === 'build' &&
                !u.type.structure &&
                this.sellState.owned.player
                    ? {
                          refund: Math.round(
                              this.economy.costOf(u.type) * this.settings.sell.refundFactor,
                          ),
                          available: this.sellState.used.player < this.settings.sell.maxPerRound,
                      }
                    : undefined,
            // the next level is a purchase: needs banked XP and supply
            levelUp: this.levelUpInfo(u, lv),
            // techs are buyable on your own packs during deployment
            techs:
                u.team === 'player' && this.playerCanAct && !u.type.structure
                    ? u.type.techs.map((t) => {
                          // each owned tech of the type raises the others' prices
                          const owned = this.techTree.ownedFor('player', u.type.id).size;
                          const cost = this.economy.techCostOf(t, owned);
                          return {
                              id: t.id,
                              name: t.name,
                              desc: techDescription(t),
                              icon: techIcon(t),
                              cost,
                              owned: this.techTree.has('player', u.type.id, t.id),
                              affordable: this.economy.balance('player') >= cost,
                          };
                      })
                    : undefined,
        };
    }
}
