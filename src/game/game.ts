import type { Application } from 'pixi.js';
import {
    Color,
    DirectionalLight,
    Fog,
    HemisphereLight,
    PCFSoftShadowMap,
    Scene,
    WebGLRenderer,
} from 'three';
import { THEME } from '../theme';
import { CameraRig } from '../engine/cameraRig';
import { CameraControls } from '../engine/cameraControls';
import { ActionDispatcher, levelCost, towerUpgradeCost, xpForNextLevel, type Action, type LoggedAction } from './actions';
import { AiOpponent, type Opponent } from './ai';
import { NetworkOpponent, type NetMessage, type NetSession } from './net';
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
} from './cards';
import { assignTeamColors, teamColors } from './colors';
import { ITEMS } from './items';
import { BattleMap, CELL, mulberry32, type Cell } from './map';
import { Particles, ProjectileRenderer } from './effects';
import { Scenery } from './scenery';
import { createRangeRing, PlacementController } from './placement';
import { DEFAULT_SETTINGS, Economy, type GameSettings } from './settings';
import { BattleSim, type Actor, type SimEvent } from './sim';
import { TechTree } from './tech';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    unitTypeById,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import { DebugOverlay } from '../ui/debug';
import { HpBars } from '../ui/hpBars';
import { Hud, type Phase, type SelectionInfo } from '../ui/hud';

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
    /** each side's chosen starting-card speciality (null until picked) */
    private readonly speciality: Record<Team, SpecialityId | null> = { player: null, enemy: null };
    /** each side's unequipped pack items */
    private readonly itemInventory: Record<Team, string[]> = { player: [], enemy: [] };
    /** the inventory item currently armed for placement onto a pack */
    private armedItem: string | null = null;
    /** whether each side already took/skipped this round's card */
    private readonly roundCardTaken: Record<Team, boolean> = { player: false, enemy: false };
    /** the game idles behind the card overlay until the loadout is picked */
    private awaitingCards = true;

    constructor(
        private readonly pixiApp: Application,
        threeCanvas: HTMLCanvasElement,
        wrapper: HTMLElement,
        private readonly settings: GameSettings = DEFAULT_SETTINGS,
        /** the peer connection in multiplayer, null against the AI */
        private readonly net: NetSession | null = null,
        /** canonical side: the host is 'a', the guest 'b' — keys the card streams */
        side: 'a' | 'b' = 'a',
    ) {
        // canonical colors first — units, overlays and HUD CSS all read them
        assignTeamColors(side);
        this.map = new BattleMap(settings.map);
        this.economy = new Economy(settings.economy);
        this.playerHp = settings.startingHp;
        this.enemyHp = settings.startingHp;
        this.renderer = new WebGLRenderer({ canvas: threeCanvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;

        this.scene.background = new Color(THEME.sky);
        this.scene.fog = new Fog(THEME.sky, THEME.fogNear, THEME.fogFar);

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
        // stands), zoomed out enough to see the whole deployment area
        const ownZoneZ = this.map.halfH - (this.map.size.zoneRows * CELL) / 2;
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
            speciality: this.speciality,
            items: this.itemInventory,
            roundCardTaken: this.roundCardTaken,
            deployReady: this.deployReady,
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
                    this.placement.hiddenPlacements = false;
                    this.placement.revealAll();
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
        this.controls.onMiddleClick = () => this.placement.rotateSelected();
        this.placement.rangeOf = (unit) => this.resolvedStats(unit).range;
        this.controls.onRightClick = () => {
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
        };
        // Escape deselects, exactly like a right click
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.code !== 'Escape') return;
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
        });
        this.hud = new Hud(
            pixiApp,
            wrapper,
            (type) => this.effectiveCost(type),
            (type) => this.buyUnit(type),
        );
        this.hud.onEndDeployment = () => {
            if (this.phase === 'build') {
                this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
            }
        };
        this.hud.onSpeedUp = () => this.cycleSpeed(1);
        this.hud.onSpeedDown = () => this.cycleSpeed(-1);
        this.hud.onUndo = () => this.undoLast();
        this.hud.onArmItem = (itemId) => {
            if (!this.playerCanAct) return;
            this.armedItem = this.armedItem === itemId ? null : itemId; // click again to disarm
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
        this.debug = new DebugOverlay(this.hud.mode);
        pixiApp.stage.addChild(this.hpBars.view, this.debug.view);

        // battle phase: left click selects a single mech, own or enemy
        let battleDown: { x: number; y: number } | null = null;
        surface.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button === 0) battleDown = { x: e.clientX, y: e.clientY };
        });
        surface.addEventListener('pointerup', (e: PointerEvent) => {
            if (e.button !== 0 || this.phase !== 'battle' || !battleDown) return;
            const moved = Math.hypot(e.clientX - battleDown.x, e.clientY - battleDown.y);
            battleDown = null;
            if (moved > 6) return;
            this.selectedActor = this.pickActor(e);
        });

        // round 0: towers stand, then the loadout cards decide the starting
        // armies — the first build phase begins once BOTH sides picked
        this.spawnTowers();
        this.placement.enabled = false;
        // the specialist pick is always 4 cards, drawn from each side's own stream
        this.hud.showStartCards(this.draw(START_CARDS, 4, this.rngCards.player), (cardId) => {
            this.dispatchPlayer({ kind: 'chooseCard', team: 'player', cardId });
            this.net?.send({ type: 'starter', cardId });
            this.opponent.chooseStarter(this.draw(START_CARDS, 4, this.rngCards.enemy));
            this.maybeStartMatch();
        });
        // only now may peer messages flow — everything they touch exists
        if (this.net) {
            this.net.attach((msg) => this.onNetMessage(msg));
            this.net.onClose = () => {
                this.matchOver = true;
                this.hud.showDisconnect();
            };
        }

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', () => this.resize(wrapper.clientWidth, wrapper.clientHeight));
        pixiApp.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));
    }

    /**
     * Each side's two base buildings, centered in its territory's depth:
     * the Research Center on the left, the Command Tower on the right.
     */
    private spawnTowers(): void {
        const { flankCols, zoneCols, zoneRows } = this.map.size;
        const buildings = [
            { frac: 0.25, type: RESEARCH_CENTER },
            { frac: 0.75, type: COMMAND_TOWER },
        ];
        for (const { frac, type } of buildings) {
            const fp = type.footprint;
            const centerRow = Math.round((zoneRows - fp.rows) / 2);
            const col = flankCols + Math.round(zoneCols * frac) - Math.floor(fp.cols / 2);
            this.placement.spawn(type, { col, row: centerRow }, 'player');
            this.placement.spawn(type, { col, row: this.map.rows - centerRow - fp.rows }, 'enemy');
        }
    }

    /** A new round: place freely, hidden from the opponent, until timer or button. */
    private startBuildPhase(): void {
        this.round++;
        this.phase = 'build';
        this.phaseRemaining = this.settings.buildTimeSeconds;
        this.placement.enabled = true;
        this.placement.hiddenPlacements = true;
        this.placement.currentRound = this.round; // earlier deployments are locked now
        this.selectedActor = null;
        this.hpBars.clear();
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
        this.deployState.used.player = 0;
        this.deployState.used.enemy = 0;
        this.deployState.extrasSpent.player = 0;
        this.deployState.extrasSpent.enemy = 0;
        this.deployReady.player = false;
        this.deployReady.enemy = false;
        this.hud.refreshCosts();
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
        // the opponent (AI today, network peer later) plays its whole round
        // through the same action system, then locks in
        this.opponent.onBuildPhase(this.round);

        // from round 2 on, both sides get a card offer at the round's start
        if (this.round >= 2) this.offerRoundCards();
    }

    /** local player input — refused once this deployment is locked in; every
     *  accepted action streams to the peer immediately */
    private dispatchPlayer(action: Action): boolean {
        if (this.deployReady.player) return false;
        if (!this.dispatcher.dispatch(action)) return false;
        if (this.round >= 1) this.net?.send({ type: 'action', round: this.round, action });
        return true;
    }

    /** the player may act: build phase, not locked in, match running */
    private get playerCanAct(): boolean {
        return this.phase === 'build' && !this.deployReady.player && !this.matchOver;
    }

    /** round 1 begins once BOTH specialists are chosen (the peer's may lag) */
    private maybeStartMatch(): void {
        if (!this.awaitingCards || this.round > 0) return;
        if (!this.speciality.player || !this.speciality.enemy) return;
        this.awaitingCards = false;
        this.startBuildPhase();
    }

    private onNetMessage(msg: NetMessage): void {
        if (this.matchOver) return;
        if (msg.type === 'starter') {
            this.dispatcher.dispatch({ kind: 'chooseCard', team: 'enemy', cardId: msg.cardId });
            this.maybeStartMatch();
        } else if (msg.type === 'action') {
            this.remoteQueue.push({ round: msg.round, action: msg.action });
            this.drainRemoteQueue();
        } else if (msg.type === 'undo') {
            this.remoteQueue.push({ round: msg.round, undo: true });
            this.drainRemoteQueue();
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
        }
    }

    /**
     * A peer's action arrives in the sender's perspective: their 'player' is
     * our 'enemy', their unit ids flip parity, and their board is ours
     * rotated 180° — anchors mirror by footprint rectangle.
     */
    private translateRemote(action: Action): Action | null {
        if (action.team !== 'player') return null; // peers only send their own side
        const flipId = (id: number) => (id % 2 === 0 ? id + 1 : id - 1);
        const mirror = (anchor: Cell, cols: number, rows: number): Cell => ({
            col: this.map.cols - cols - anchor.col,
            row: this.map.rows - rows - anchor.row,
        });
        switch (action.kind) {
            case 'buy': {
                const type = unitTypeById(action.typeId);
                if (!type) return null;
                const fp = action.rotated
                    ? { cols: type.footprint.rows, rows: type.footprint.cols }
                    : type.footprint;
                return { ...action, team: 'enemy', anchor: mirror(action.anchor, fp.cols, fp.rows) };
            }
            case 'move': {
                const unit = this.placement.unitById(flipId(action.unitId));
                if (!unit) return null;
                const fp = unit.rotated
                    ? { cols: unit.type.footprint.rows, rows: unit.type.footprint.cols }
                    : unit.type.footprint;
                return {
                    ...action,
                    team: 'enemy',
                    unitId: flipId(action.unitId),
                    anchor: mirror(action.anchor, fp.cols, fp.rows),
                };
            }
            case 'rotate': {
                const unit = this.placement.unitById(flipId(action.unitId));
                if (!unit) return null;
                // the footprint swaps on rotation, so mirror the POST-rotate rect
                const fpCur = unit.rotated
                    ? { cols: unit.type.footprint.rows, rows: unit.type.footprint.cols }
                    : unit.type.footprint;
                const fpAfter = { cols: fpCur.rows, rows: fpCur.cols };
                const theirAnchor = action.anchor ?? mirror(unit.cell, fpCur.cols, fpCur.rows);
                return {
                    kind: 'rotate',
                    team: 'enemy',
                    unitId: flipId(action.unitId),
                    anchor: mirror(theirAnchor, fpAfter.cols, fpAfter.rows),
                };
            }
            case 'moveGroup':
                return {
                    ...action,
                    team: 'enemy',
                    unitIds: action.unitIds.map(flipId),
                    dc: -action.dc,
                    dr: -action.dr,
                };
            case 'buyLevel':
            case 'sellUnit':
            case 'upgradeTower':
            case 'applyItem':
                return { ...action, team: 'enemy', unitId: flipId(action.unitId) };
            default:
                return { ...action, team: 'enemy' };
        }
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
        this.opponent.onRoundCards(this.draw(ROUND_CARDS, 4, this.rngCards.enemy));

        const offer = this.draw(ROUND_CARDS, 4, this.rngCards.player);
        this.awaitingCards = true;
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
        this.hud.setSpeed(Game.SPEED_STEPS[this.speedIndex]!);
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
        this.phase = 'battle';
        this.phaseRemaining = this.settings.battleTimeSeconds;
        this.placement.enabled = false;
        this.placement.hiddenPlacements = false;
        this.placement.deselect();
        this.armedItem = null;
        this.gridOverlay.visible = false;
        this.placement.revealAll();
        this.sim = new BattleSim(this.placement.allUnits(), {
            towers: this.settings.towers,
            leveling: this.settings.leveling,
            costOf: (type) => this.economy.costOf(type),
            statsOf: (unit) => this.resolvedStats(unit),
        });
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
        // battle can be fast-forwarded (or slowed); build always runs at 1x
        const gameDt =
            this.phase === 'battle' ? dtSeconds * Game.SPEED_STEPS[this.speedIndex]! : dtSeconds;
        this.time += gameDt;

        if (!this.matchOver && !this.awaitingCards) {
            this.phaseRemaining -= gameDt;
            if (this.phase === 'build') {
                // the timer ends the round like the button would — as an action
                if (this.phaseRemaining <= 0) {
                    this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
                }
            } else if (this.sim) {
                this.sim.update(gameDt);
                this.particles.spawnFromEvents(this.sim.consumeEvents());
                this.sim.syncMeshes(); // per-frame interpolated positions
                this.projectileRenderer.update(this.sim.projectiles, this.sim.alpha);
                // the battle clock is the sim's own fixed-step time, so the
                // timeout cutoff is deterministic and replay-exact
                this.phaseRemaining = this.settings.battleTimeSeconds - this.sim.elapsed;
                if (this.phaseRemaining <= 0 || this.sim.isOver) this.endBattlePhase();
            }
        }
        this.particles.update(gameDt);

        this.controls.update(dtSeconds);
        this.rig.update(dtSeconds);
        // ambient motion runs on real time, unaffected by battle fast-forward
        this.scenery.update(dtSeconds, this.rig.camera.position);
        this.placement.update(this.time);
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
        this.hud.setInventory(this.inventoryView());
        this.hud.setSupply(this.economy.balance('player'));
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.hud.layout();
        this.debug.update(this.pixiApp, this.rig, this.placement.unitCount, dtSeconds);
        this.renderer.render(this.scene, this.rig.camera);
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
            const screen = this.rig.worldToScreen(a.rx, a.altitude + t.meshScale * 0.55, a.rz, w, h);
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
                ? a.unit.items.map((id) => ({ icon: ITEMS[id]?.icon ?? '?', name: ITEMS[id]?.name ?? id }))
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
                ? u.items.map((id) => ({ icon: ITEMS[id]?.icon ?? '?', name: ITEMS[id]?.name ?? id }))
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
                              cost,
                              owned: this.techTree.has('player', u.type.id, t.id),
                              affordable: this.economy.balance('player') >= cost,
                          };
                      })
                    : undefined,
        };
    }
}
