import type { Application } from 'pixi.js';
import {
    ACESFilmicToneMapping,
    Color,
    DirectionalLight,
    Fog,
    HemisphereLight,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshNormalMaterial,
    PCFShadowMap,
    PCFSoftShadowMap,
    PMREMGenerator,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
    type Mesh,
    type Object3D,
    type ShadowMapType,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setHeightFogStrength } from '../engine/heightFog'; // patches three's fog chunks on import
import { EffectToggles } from './effectToggles';
import { DISPLAY } from './displayNames';
import { THEME } from '../theme';
import { CameraRig } from '../engine/cameraRig';
import { CameraControls } from '../engine/cameraControls';
import { GamepadCursor } from '../engine/gamepadCursor';
import { disposeScene } from '../engine/disposeScene';
import { ActionDispatcher, prepareHazardPours, resetOilFieldToBaseline, levelCost, quantizeWorld, quantizeYaw, towerUpgradeCost, xpThresholdFor, type Action, type LoggedAction } from './actions';
import {
    emptyForgeSlots,
    forgeHintText,
    forgeIngredientIcons,
    forgeProductInfo,
    forgeRecipesCraftableFromBag,
    forgeSeatCanInsert,
    forgeTeamCapacity,
    resolveForge,
    unionForgeSpellPools,
    type ForgeSlot,
} from './forgeRecipes';
import { AiOpponent, type Opponent } from './ai';
import {
    clearSinglePlayer,
    clearStarResumeMarker,
    GAME_VERSION,
    formatGameVersion,
    isRevealable,
    NetworkOpponent,
    registerSpectateEndpoint,
    seatVisionPolicy,
    spectatorVisionPolicy,
    SpectatorHub,
    STAR_RECONNECT_GRACE_MS,
    type GuestSession,
    type NetMessage,
    type RoomRosterEntry,
    type RosterEntry,
    type Session,
    type SpectateRegistration,
    type SpectatorLink,
    type SpectatorTransport,
    type SpectatorVision,
    type StarRole,
    type VisionPolicy,
} from './net';
import {
    TELEMETRY_SCHEMA,
    accumulateBattleDamage,
    submitMatchTelemetry,
    summarizeDamage,
    summarizeTechs,
    summarizeUnits,
    telemetryChannel,
    telemetryIncludeReplay,
    type MatchMode,
    type MatchResult,
} from './telemetry';
import { matchResultId, reportMatchResult } from './account';
import {
    AIR_BONUS,
    COST_CONTROL_INCOME,
    COST_CONTROL_PENALTY,
    ELITE_ROUND1_BONUS,
    MONEY_ROUND1_BONUS,
    CURSED_BROOD_TYPE_ID,
    FREE_ARCHER_LEVEL,
    FREE_ARCHER_ROUND,
    SPECIALITY_TACTIC_ROUND,
    SPEED_COMMANDER_BONUS,
    unlockCostForSpeciality,
    ROUND_CARDS,
    SKIP_CARD_REWARD,
    START_CARDS,
    roundOfferTitle,
    type RoundCard,
    type SpecialityId,
    type StartCard,
} from './cards';
import { iconCursorCss } from '../ui/iconAtlas';
import { roundCardAlgorithmById } from './roundCardAlgorithms';
import { assignTeamColors, colorForBattleTeam, teamColors } from './colors';
import { CHAT_COOLDOWN_MS, CHAT_TEXT_LIMIT, type ChatItem } from './emotes';
import { HazardField, HAZARD_POUR_DELAY_SEC, livingShieldDisks, OIL_SPILL_DURATION_ROUNDS, OIL_SPILL_RADIUS } from './fire';
import { OilDripFx } from './oilDripFx';
import { BlobShadows, type BlobShadowSource } from './blobShadows';
import { FireFx } from './fireFx';
import { ForgeFx, forgeGlowMode } from './forgeFx';
import { StrongholdFlags } from './strongholdFlags';
import { HordeMarkers, type HordeMarkerSpot } from './hordeMarkers';
import { takePrewarmedRenderer } from './gpuWarmup';
import { CloudFx } from './cloudFx';
import { ConversionFx } from './conversionFx';
import { DragonFx } from './dragonFx';
import { HammerFx, HAMMER_SWING_SEC } from './hammerFx';
import { MeteorFx, GREAT_METEOR_FALL_SEC } from './meteorFx';
import { TowerDebuffFx } from './towerDebuffFx';
import { BASE_RUNE_IDS, ITEMS, itemSlotLimit } from './items';
import { BASE_ANCHORS, BattleMap, CELL, groundHeightAt, mulberry32, worldHeightAt, type Cell } from './map';
import { OilVisuals } from './oilVisuals';
import { inputMode, noteGamepadActivity, onInputModeChange, touchFirstDevice } from './inputCapabilities';
import {
    onPrefsChange,
    prefs,
    debugEnabled,
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
import { Particles, ProjectileRenderer, StuckBoltRenderer, StoneChipRenderer } from './effects';
import {
    buildHpDrawSources,
    hpDrawShakeIntensity,
    scheduleHpDrawParticles,
    type HpDrawPlan,
} from './hpDraw';
import { HpDrawFx } from './hpDrawFx';
import {
    clearDeathFall,
    clearDeathTip,
    tickDeathFall,
    tickDeathTip,
    type DeathFallState,
    type DeathTipState,
} from './deathFall';
import {
    clearBuildingCollapse,
    tickBuildingCollapse,
    type BuildingCollapseState,
} from './buildingCollapse';
import { freezeAllCrowWingRates, crowWingDeathSplay, setCrowWingDeathSplay, CROW_RIDER_MODEL_ID } from './crowWingFlap';
import { GROUND_UNIT_Y } from './groundQuality';
import { modelGeometryFingerprint } from './unitModels';
import { clearScreenShake, installScreenShake, screenShake, updateScreenShake } from './screenShake';
import { Scenery } from './scenery';
import type { Weather } from './weather';
import { createRangeRing, placeRangeRing, pulseAuraRing, PlacementController } from './placement';
import { RallyVisuals, type RallyDraft } from './rallyVisuals';
import { SpellVisuals, type SpellChargeMarker, type SpellDraft } from './spellVisuals';
import {
    DEFAULT_SETTINGS,
    describeGameSettings,
    Economy,
    hordeCountMult,
    hordeEnabled,
    hordeLeaderShare,
    isHordeRoundActive,
    normalizeGameSettings,
    secondsForRound,
    shouldOfferRoundCards,
    type GameSettings,
} from './settings';
import { hordeWavePlan } from './hordeRoster';
import {
    BattleSim,
    BATTLE_START_FREEZE,
    GOLDEN_AURA_RADIUS,
    actorSeat,
    actorTeam,
    detCos,
    detSin,
    type Actor,
    type SimEvent,
    SOFT_CROWD_LIMIT,
} from './sim';
import {
    BIG_METEOR_ID,
    DRAGON_APPROACH_SEC,
    DRAGON_ID,
    DRAGON_POUR_DURATION_SEC,
    HAMMER_ID,
    OIL_SPILL_ID,
    RALLY_ROUTE_ID,
    RALLY_ROUTE_RADIUS,
    MOVE_UNIT_ID,
    TUTOR_ID,
    SELL_UNIT_ID,
    TACTICS,
    clampTacticEnd,
    clampTacticPoint,
    pointInSafeZone,
    safeZoneDisks,
    usesSpellPlacement,
    type OilStamp,
    type RallyRoute,
    type SpellStamp,
} from './tactics';
import { TechTree, effectiveTargets, effectiveFlying } from './tech';
import { ownedProduceTechs, techSlotLimit, techsForUnit, allowedTechIds, techById } from './techCatalog';
import { forEachPickSphere, rayMeshT, raySphereT } from './pick';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    UNIT_TYPES,
    isPlayerBuyable,
    techDescription,
    techIcon,
    unitTypeById,
    type BattleTeam,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import { DebugOverlay, DebugDumpButton, CpuSampler } from '../ui/debug';
import { DebugLog, type DebugEvent } from './debugLog';
import {
    canonicalClassicSeats,
    localizeRoster,
    primarySeatOf,
    seatIdsOf,
    seatLane,
    sideCount,
    sideIdsOf,
    type CanonicalSeatDef,
    type SeatDef,
    type SeatId,
    type SideId,
} from './seats';
import { getAvatarDataUrl } from './avatar';
import { HpBars } from '../ui/hpBars';
import { Hud, isCompactChrome, type Phase, type SelectionInfo } from '../ui/hud';
import { renderAllUnitIcons } from '../ui/unitIcons';
import { updateAnimatedUnits } from './unitAnimated';
import { setUnitInstanceRenderer, UnitInstanceRenderer } from './unitInstances';

/** menu→match camera fly-in (fresh starts only) */
const MATCH_INTRO_SEC = 1.0;
/** card overlays begin fading in during the tail of the fly-in (t = 0..1) */
const MATCH_INTRO_CARDS_START = 0.55;
const MATCH_INTRO_CARDS_END = 0.88;
/** match→menu fly-out — mirror of the intro camera */
const MATCH_OUTRO_SEC = 0.8;
const MATCH_INTRO_ZOOM = 200;
const MATCH_INTRO_PITCH = (48 * Math.PI) / 180;
const PLAY_START_ZOOM = 110;
/** post-battle HP damage VFX — hard cap even with huge survivor counts */
const HP_DRAW_MAX_SECONDS = 8;
/** Let the last death tip / air crash finish before souls launch. */
const HP_DRAW_BATTLE_SETTLE = 0.52;

// --- horde forest-ring spawn (see spawnHordeWave/findHordeRingSpot) ---
/** ring starts this far past the board edge (world units) — well into the
 *  treeline (medium quality's forest belt already ramps up by 25 past the
 *  edge), so the wave visibly emerges from the woods instead of appearing
 *  right at the board's doorstep */
const HORDE_RING_NEAR = 45;
/** ring extends this much further past HORDE_RING_NEAR */
const HORDE_RING_SPAN = 80;
/** bounded, deterministic retries when a candidate spot's straight walk to
 *  center would cross deep water */
const HORDE_SPAWN_ATTEMPTS = 24;
/** points sampled along that straight walk (besides the spawn point itself) */
const HORDE_PATH_SAMPLES = 8;
/** worldHeightAt below this reads as deep water (per HORDE_MODE_NOTES.md) */
const HORDE_LAKE_HEIGHT = -0.5;

/** SP cheat (Shift+U): tactic ids topped up for free testing (see cheatGrantAllTactics) */
const CHEAT_TACTIC_GRANTS = [
    RALLY_ROUTE_ID,
    OIL_SPILL_ID,
    MOVE_UNIT_ID,
    TUTOR_ID,
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
] as const;
/** max charges of each {@link CHEAT_TACTIC_GRANTS} id after a Shift+U press */
const CHEAT_TACTIC_COPIES = 1;
/** Shift+U: max free base runes of each id in the left bag strip */
const CHEAT_BASE_RUNE_COPIES = 2;
/** Shift+U: max free advanced (and other) runes of each id in the left bag strip */
const CHEAT_ADVANCED_RUNE_COPIES = 1;

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
    private readonly techTree: TechTree;
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
    private readonly hpDrawFx: HpDrawFx;
    private readonly projectileRenderer: ProjectileRenderer;
    private readonly stuckBolts: StuckBoltRenderer;
    private readonly stoneChips: StoneChipRenderer;
    private readonly particles: Particles;
    private readonly fireFx: FireFx;
    private readonly forgeFx = new ForgeFx();
    private readonly strongholdFlags = new StrongholdFlags();
    private readonly hordeMarkers: HordeMarkers;
    private readonly towerDebuffFx: TowerDebuffFx;
    private readonly hammerFx: HammerFx;
    private readonly meteorFx: MeteorFx;
    private readonly cloudFx: CloudFx;
    private readonly dragonFx: DragonFx;
    private readonly conversionFx: ConversionFx;
    private readonly oilDripFx: OilDripFx;
    private readonly oilVisuals: OilVisuals;
    private readonly oilField: HazardField;
    private readonly oilBaseline: HazardField;
    private readonly oilStamps: OilStamp[] = [];
    private readonly oilStampIds = { next: 1 };
    /** battle-spell stamps — NEVER cleared per round: old ones drive cooldowns */
    private readonly spellStamps: SpellStamp[] = [];
    private readonly spellStampIds = { next: 1 };
    private appliedFireVfx: FireVfxQuality = prefs().fireVfx;
    private readonly unitInstances: UnitInstanceRenderer;
    private scenery: Scenery;
    private weather: Weather | null;
    /** last season the cinema hint flashed for — drives auto-flash on season change */
    private lastHintSeason: string | null = null;
    private groundMesh: Mesh;
    private readonly sun: DirectionalLight;
    private readonly hemi: HemisphereLight;
    /** currently APPLIED scenery / ground-effects prefs (may differ until rebuild) */
    private appliedScenery: SceneryQuality = prefs().scenery;
    private appliedGroundEffects: GroundEffectsQuality = prefs().groundEffects;
    private appliedShadows: ShadowQuality = prefs().shadows;
    /** dev hotkeys Shift+1…9 — per-layer weather / fog toggles */
    private readonly effectToggles = new EffectToggles();
    /** scenery-tier height-mist scale (see applyHeightMistStrength) */
    private heightMistBase = sceneryHeightFog();
    private readonly blobShadows: BlobShadows;
    private shadowMapFrame = 0;
    /** debug: scene.overrideMaterial — off | clay | wireframe | normals */
    private materialDebug: 'off' | 'clay' | 'wire' | 'normals' = 'off';
    private readonly clayOverride = new MeshLambertMaterial({ color: 0xc8c2b4 });
    private readonly wireOverride = new MeshBasicMaterial({ color: 0x1a1a1a, wireframe: true });
    private readonly normalsOverride = new MeshNormalMaterial();
    private readonly rallyVisuals: RallyVisuals;
    private readonly spellVisuals: SpellVisuals;
    /** hammer charge rings for the current battle (visual countdown) */
    private spellChargeMarkers: SpellChargeMarker[] = [];
    private gridOverlay;
    private time = 0;
    /** battle-phase selection: one individual mech (own or enemy) */
    private selectedActor: Actor | null = null;
    /** post-battle HP draw VFX (visual only; HP already applied in sim) */
    private pendingHpDrawPlan: HpDrawPlan | null = null;
    private pendingHpDrawPreHp: { player: number; enemy: number } | null = null;
    private hpDrawPlan: HpDrawPlan | null = null;
    private hpDrawElapsed = 0;
    private hpDrawDisplayPlayer = 0;
    private hpDrawDisplayEnemy = 0;
    private hpDrawPrePlayer = 0;
    private hpDrawPreEnemy = 0;
    private hpDrawAfterMatchOver = false;
    /** Seconds left before HP-draw souls launch (death settle beat). */
    private hpDrawSettleRemaining = 0;
    /** Sim elapsed when battle ended — keeps death anims on the same clock. */
    private postBattleDeathElapsed = 0;
    private postBattleDeathTimeBase = 0;
    /** attack-range ring under the selected battle mech */
    private readonly battleRangeMesh;
    /** inner dead-zone (min-range) ring under the selected battle mech */
    private readonly battleMinRangeMesh;
    /** gold aura-range ring under a selected battle mech with a special skill */
    private readonly battleAuraMesh;
    /** tech tile currently hovered/peeked in the detail panel (drives aura ring) */
    private hoveredTech: string | null = null;

    /** ascending — click: faster, right click: slower; clamps at each end */
    private static readonly SPEED_STEPS = [0, 0.25, 1, 2, 8];
    /** replay-only — much wider range since nothing live needs to stay near
     *  real-time; a separate array so the live-match button/range is
     *  untouched */
    static readonly REPLAY_SPEED_STEPS = [0, 0.125, 0.25, 1, 2, 8, 32];

    private phase: Phase = 'build';
    private round = 0;
    private phaseRemaining = 0;
    private speedIndex = Game.SPEED_STEPS.indexOf(1);
    // Real storage is per-SIDE (canonical index — see SideId's doc comment
    // in seats.ts), sized to however many sides this roster actually has
    // (today: always 2). `playerHp`/`enemyHp` below are a transparent 2-
    // bucket VIEW over it ("mine" vs "everyone else, combined") — every
    // existing consumer (HUD, telemetry, match-end, cheats, replay-verify)
    // keeps reading/writing them completely unchanged; only genuinely
    // N-side-aware code (stateHash) touches `hp` directly.
    private hp: number[] = [];
    /**
     * Per-side peak HP (commander grants). Survives damage and reconnect
     * hydrate — the HUD bar max must NOT collapse to current HP when a
     * new Hud is built mid-match (first setHp would otherwise lock max
     * to the damaged value).
     */
    private hpPeak: number[] = [];
    private matchOver = false;
    /** match-total combat damage by `${team}:${typeId}` — fed into telemetry */
    private readonly matchDamageByType = new Map<string, number>();
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
    /** per-SEAT stream for between-round card offers — each seat gets its own
     *  independent draw now that round cards are a per-seat pick, same as
     *  the starter pick already does for extra AI seats (own seed by
     *  canonical seat index, so it's identical on every client) */
    private readonly rngRoundCards: (() => number)[];
    /** the other side's decision maker (built-in AI or the network peer) */
    private readonly opponent: Opponent;
    /** which sides locked in the current deployment — battle starts at both */
    private readonly deployReady: Record<Team, boolean> = { player: false, enemy: false };
    /** per-seat lock-in flags (aggregated into deployReady per side) */
    private readonly seatReady: boolean[] = [];
    /** per-seat one-time starter-card pick flags */
    private readonly starterPicked: boolean[];
    /** extra AI brains beyond the classic opponent (duo modes: ally + 2nd foe) */
    private readonly extraAis: { ai: AiOpponent; rng: () => number; team: Team; seat: SeatId }[] = [];
    /** which sides finished watching this round's battle — the next build
     *  phase starts once both have (fast-forward speed is per-client) */
    private readonly battleReady: Record<Team, boolean> = { player: false, enemy: false };
    /** streamed peer events, applied in order once our game reaches their round */
    private readonly remoteQueue: { round: number; action?: Action; undo?: boolean; seat?: SeatId }[] = [];
    /** star mode's own incoming queue — parallel to remoteQueue */
    private readonly starRemoteQueue: {
        round: number;
        seat: SeatId;
        action?: Action;
        undo?: boolean;
        seq: number;
    }[] = [];
    /** spectator-only incoming queue — see drainSpectateQueue for why this
     *  can't reuse starRemoteQueue/drainStarRemoteQueue despite the
     *  identical shape */
    private readonly spectateQueue: { round: number; seat: SeatId; action?: Action; undo?: boolean }[] = [];
    /** temporary debug-log dedup key so drainSpectateQueue's BLOCKED log doesn't spam every frame */
    private lastSpectateBlockLog = '';
    /** star host only: which (human) seats have finished watching this round's battle */
    private readonly starBattleReadySeats = new Set<SeatId>();
    /** star host only: this round's battle-start hash per seat (sync-barrier check) */
    private readonly starChecks = new Map<SeatId, number>();
    /** star host only: this round's battle-END hash per seat — a SEPARATE
     *  tally from `starChecks` (which is battle-start only), for the
     *  battle-end/pre-match-end sync-barrier checkpoint (see
     *  endBattlePhase/markStarBattleReady/verifyStarSyncBarrier). */
    private readonly starBattleEndChecks = new Map<SeatId, number>();
    /** star host only: has this round's battle-start / battle-end hash
     *  tally already been compared once? A recheck (e.g. triggered by a
     *  seat dropping mid-collection, shrinking the expected set) must only
     *  ever re-run resumeIfAllClear(), never redo the comparison/
     *  announcement/pendingSyncSeats.add — see verifyStarSyncBarrier. */
    private starChecksCompared = false;
    private starBattleEndChecksCompared = false;
    /** star host only: the seats a barrier is actually waiting on, FROZEN at
     *  the moment its collection started (`[0, ...connectedSeats()]` taken
     *  once, not recomputed live) — filtered against CURRENT connectedSeats()
     *  on every check so a seat dropping mid-collection still correctly
     *  shrinks it, but a DIFFERENT seat joining/reclaiming mid-collection
     *  can never grow it. Without this, a seat that reclaims while a barrier
     *  is already mid-flight would get pulled into `expected` immediately
     *  (its connection is live the instant the join is accepted, well before
     *  it's replayed/hydrated far enough to ever submit a hash for the round
     *  already in progress) and stall the barrier forever waiting for a hash
     *  that round can never receive. */
    private starChecksExpectedSeats: SeatId[] = [];
    private starBattleEndChecksExpectedSeats: SeatId[] = [];
    /** star host only: seats currently dropped (mid-grace-window) or reconnected-
     *  but-not-yet-confirmed-ready — the host stays `suspended` while this is
     *  non-empty, same as classic 1v1 stays suspended until the one peer is
     *  both back AND ready (see beginStarSeatSuspend/starSeatReady) */
    private readonly pendingStarSeats = new Set<SeatId>();
    /** star host only: seats being resynced because a sync-barrier hash
     *  comparison found them disagreeing (see verifyStarSyncBarrier) — kept
     *  SEPARATE from `pendingStarSeats` (real disconnects): different
     *  chat-announcement wording ("resyncing", never "reconnected"), and a
     *  seat can legitimately be in both sets at once (a real drop happening
     *  while a barrier-triggered resync for it is already in flight). */
    private readonly pendingSyncSeats = new Set<SeatId>();
    /** star host only: continuation to run once every pending seat (both
     *  `pendingStarSeats` and `pendingSyncSeats`) has cleared — set by a
     *  sync-barrier checkpoint that has follow-up work gated on "everyone
     *  agrees" (currently only the battle-end checkpoint, which must defer
     *  finishMatch()/announceBattleEnd() until resolved); null for the
     *  battle-start checkpoint, which has nothing further to do once
     *  unsuspended — simulation just resumes ticking on its own. Run and
     *  cleared inside resumeIfAllClear(). */
    private afterSyncResolved: (() => void) | null = null;
    /** wall-clock deadline (performance.now()) the current star seat-drop
     *  suspend resolves by, one way or another: either the seat reconnects,
     *  or the grace window elapses and the host auto-resolves (forfeit-win
     *  for the last human on a side, or an AI takeover if a teammate
     *  remains). Drives the live countdown in the "Waiting…" notice, on
     *  every connected seat, not just the host. Null whenever not suspended
     *  for this reason (also unset — no countdown shown — for
     *  requestStarResync's own notice, which has no fixed grace deadline). */
    private suspendDeadline: number | null = null;
    /** last whole second rendered in the countdown notice — re-render only
     *  on change, not every frame */
    private lastSuspendNoticeSecond = -1;
    /** name(s) of the currently-pending (dropped) seat(s), for the "Waiting…"
     *  notice — the host derives this straight from `pendingStarSeats`; a
     *  non-host seat has no such set of its own, so it's told via
     *  `starSync`'s `names` field instead. */
    private pendingDropNames: string[] = [];
    /** per-seat "next seq I'll stamp when I originate a message for this
     *  seat" — only load-bearing for humanSeat, and for any host-driven AI
     *  seat via aiCtxFor. Seeded (never persisted) from the log's own
     *  per-seat action counts — see seedSeqTracking — then purely
     *  incremented per send, immune to undo removing entries from the log. */
    private seatSendSeq: number[] = [];
    /** per-seat "last seq I've seen originate from this seat" — checked on
     *  every incoming action/undo (onStarMessage) to detect a dropped or
     *  skipped message. Seeded the same way as seatSendSeq, so both sides
     *  agree on the resume point after any hydrate without needing to
     *  reconstruct or persist anything explicitly. */
    private lastSeqSeen: number[] = [];
    /** star guest only: aborts an in-flight redial loop if we give up first
     *  (quitToMenu) — mirrors classic 1v1's onReconnectTimeout callback */
    private starRedialAbort: AbortController | null = null;
    /** star host only: seats that explicitly quit (see handleSeatQuit) — the
     *  connection dropping moments later (the quitting client's own
     *  quitToMenu tears it down) must NOT also run the ordinary reconnect-
     *  grace flow for a seat that is deliberately, permanently gone */
    private readonly quitSeats = new Set<SeatId>();
    /** host-only: dedicated broadcast connection point for spectators, opened
     *  once a multiplayer match starts (classic 1v1 host, or a star host —
     *  see startSpectatorHub) */
    private spectatorHub: SpectatorHub | null = null;
    /** dev-only (`?debug`) cross-client debug event bus — see debugLog.ts */
    private readonly debugLog: DebugLog;
    /** seconds accumulated since the last debug-event flush to the host (non-host clients only) */
    private debugFlushAccum = 0;
    /**
     * host-only: publish this running match to the transport's own discovery
     * channel (Steam lobby data, LAN announce). The web backend has its own
     * registration; this is what gives the other two the same "a match is
     * running here, watch it at this peer id" advertisement.
     */
    onLiveRoomAd: ((ad: { spectate: string; round: number; roster: RoomRosterEntry[] }) => void) | null = null;
    /**
     * host-only, set by main: build the spectator transport for THIS match's
     * network. Null (or a null result) means the web/PeerJS default. Exists so
     * game.ts never has to import a transport module directly — the same
     * inversion `onLiveRoomAd` uses for discovery.
     */
    onCreateSpectatorTransport: (() => Promise<SpectatorTransport | null>) | null = null;

    /** host-only: click/dblclick-to-copy button for debugLog's aggregated dump */
    private debugDumpButton: DebugDumpButton | null = null;
    /** stops the spectate-endpoint discovery heartbeat (see startSpectatorHub) */
    private spectateRegistration: SpectateRegistration | null = null;
    /** our open SpectatorHub's peer id, kept so the transport-level room ad
     *  can be republished with fresh round/roster (see refreshRoomAd) */
    private spectatePeerId: string | null = null;
    /** set only for a spectating client — its one connection to the host's
     *  SpectatorHub (mutually exclusive with net/star) */
    private spectateSession: SpectatorLink | null = null;
    /** spectate mode only: the watcher's own name (see the `spectate` ctor param) */
    private readonly watcherName: string | null;
    /** per-team recruit level for the running round (the once-per-round level-2 switch) */
    private readonly recruitLevel: number[]; // per seat
    /** per-SEAT sell ability: `owned` is a permanent unlock, `used` resets per round */
    private readonly sellState: { owned: boolean[]; used: number[] };
    /** per-SEAT: one-time rally-route purchase (permanent flag) */
    private readonly rallyRouteOwned: boolean[];
    private readonly movePackOwned: boolean[];
    /** per-SEAT buy limits: `limit` + `runesBought` are permanent; rest resets per round */
    private readonly deployState: {
        limit: number[];
        extra: number[];
        used: number[];
        extrasSpent: number[];
        /** shop base-rune buys this match (escalating price) */
        runesBought: number[];
    };
    /** per-SEAT permanent army-wide boost tiers (0 = none) */
    private readonly boostState: Record<'attack' | 'hp', number[]>;
    /** per-SEAT round-only stat boosts (reset each deployment) */
    private readonly roundBoosts: { range: boolean[]; speed: boolean[] };
    /** Command Tower Credit (per seat): used this round (reset each deployment) */
    private readonly creditUsed: boolean[];
    /** Command Tower Credit (per seat): debt owed at the next deployment start */
    private readonly creditDebt: boolean[];
    /** each SEAT's own chosen starting-card speciality (null until picked) */
    private readonly speciality: (SpecialityId | null)[];
    /** per-SEAT multiplier on flank spawn duration (Flanky card/specialist → 0.5) */
    private readonly flankSpawnMult: number[];
    /** each SEAT's own unequipped pack items — per seat, never shared (sized in the constructor, once `seats` is known) */
    private readonly itemInventory: string[][];
    /** per-SEAT tactical order charges (rally routes, etc.) — separate from pack items, never shared */
    private readonly tacticInventory: string[][];
    /** shared Stronghold forge oven per side (3 slots; burn at next deploy start) */
    private readonly forgeSlots: Record<Team, (ForgeSlot | null)[]> = {
        player: emptyForgeSlots(),
        enemy: emptyForgeSlots(),
    };
    /** rally routes placed this deployment round */
    private readonly rallyRoutes: RallyRoute[] = [];
    private readonly rallyRouteIds = { next: 1 };
    /** per-SEAT unit types buyable in the shop this match (own card + own unlocks) */
    private readonly unlockedUnits: string[][];
    /** per-SEAT: at most one shop unlock per deployment round */
    private readonly unlockUsedThisRound: boolean[];
    /** frozen enemy inventory intel captured at deployment-phase start */
    private enemyIntelSnapshot: {
        items: string[];
        tactics: string[];
        sellAbilityOwned: boolean;
    } | null = null;
    /**
     * Owned techs at deployment-phase start (all seats). Fogged packs show
     * this view; live techTree applies once that pack's fog lifts.
     */
    private techIntelSnapshot: Map<string, Set<string>>[] | null = null;
    /**
     * Building action state at deployment-phase start (all seats) — temporary
     * round boosts + permanent tracks. Fogged buildings use this; live after
     * that building's fog lifts (same window as pack techs/items).
     */
    private buildingIntelSnapshot: BuildingIntelSnapshot | null = null;
    /** the inventory item currently armed for placement onto a pack */
    private armedItem: string | null = null;
    /** which inventory slot is armed — duplicates share an id, the highlight must not */
    private armedItemIndex: number | null = null;
    /** the tactic currently being placed on the map */
    private armedTactic: string | null = null;
    private armedTacticIndex: number | null = null;
    /** first click of an in-progress multi-point tactic (rally / oil / hammer) */
    private tacticDraftStart: { x: number; z: number } | null = null;
    /** second click of a three-point tactic (rally mid waypoint) */
    private tacticDraftMid: { x: number; z: number } | null = null;
    /** whether each SEAT already took/skipped this round's card */
    private readonly roundCardTaken: boolean[];
    /** the game idles behind the card overlay until the loadout is picked */
    private awaitingCards = true;
    /** rebuilding from a recorded log: no UI, no net sends, battles fast-forward */
    private hydrating = false;
    /** watching someone else's finished match play back at a natural pace —
     *  no input, no AI, no persistence/telemetry re-submission */
    private watching = false;
    private replayLog: LoggedAction[] | null = null;
    /** index into replayLog of the next not-yet-dispatched entry */
    private replayCursor = 0;
    /** verify mode: re-submits telemetry at match end despite watching
     *  (see finishMatch) — everything else about watching stays the same */
    private replayVerify = false;
    /** the ORIGINAL match's mode, threaded through so reportMatchTelemetry
     *  can tag a verify submission correctly — net/star are always null
     *  while watching, so they can't tell a replayed 2v2 from solo */
    private replayOriginalMode: MatchMode | null = null;
    /** verify mode only: the originally-recorded outcome, shown alongside
     *  the recomputed one on the game-over screen (see finishMatch) */
    private replayExpected: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number } | null = null;
    /** the recomputed outcome once finishMatch runs — lets main.ts compare
     *  against `expected` itself (bulk verify: no per-item UI, just tallies) */
    private replayFinalResult: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number } | null =
        null;
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
    /**
     * Set by main: a star (2v2+) guest needs a full teardown-and-reconstruct
     * resync (Phase 7 — replaces the old in-place `applyStarResumeState`
     * patch) — either a real reconnect just succeeded (`session` is a
     * freshly-redialed `GuestSession`) or a battle-checkpoint hash mismatch
     * was detected on an otherwise still-healthy connection (`session` is
     * THIS `Game`'s own, unchanged `star.session`). Either way `msg` is the
     * full `matchCatchUp` to rebuild from. main.ts owns the actual
     * `destroy()`/`new Game(...)` swap — see `rebuildStarGuestGame`.
     */
    onNeedsFullResync:
        | ((session: GuestSession, msg: Extract<NetMessage, { type: 'matchCatchUp' }>) => void)
        | null = null;
    /** throttled hook for persisting single-player state to session storage */
    onStateCheckpoint: (() => void) | null = null;
    /** replay panel keeps its speed <select> in sync with keyboard shortcuts */
    onSpeedIndexChange: ((index: number) => void) | null = null;
    /** 0..1 while the 3D camera fly-in runs (main fades the brightness flash) */
    onMatchIntroProgress: ((t: number) => void) | null = null;
    /** fired once when the fly-in finishes (main clears the flash overlay) */
    onMatchIntroDone: (() => void) | null = null;
    /** 0..1 while the match→menu fly-out runs (main fades the menu cover in) */
    onMatchOutroProgress: ((t: number) => void) | null = null;
    private introActive = false;
    /**
     * A reconnecting peer's fairness handshake ('ready'/awaitPeerReady) —
     * deferred until the fly-in cinematic actually finishes, not fired
     * synchronously during construction. Sending it immediately (as this
     * game.ts once did) tells the SURVIVING side "go ahead, resume" the
     * moment hydrate() finishes, but this reconnecting side still has a
     * real, multi-second matchIntro fly-in left to play through (gated by
     * `introActive`/`simTimingActive`, so it can't tick yet) — the
     * survivor, having no intro of its own to wait through, would resume
     * ticking immediately, racing ahead for exactly that fly-in's
     * duration. At normal speed a second or two goes unnoticed; at battle
     * fast-forward (8x) it becomes a very real, reproducible gap between
     * what the two sides show (confirmed live: reconnecting during an 8x
     * battle left the two sides' clocks about 20 in-game seconds apart).
     */
    private pendingReadyOnIntroFinish: (() => void) | null = null;
    private introElapsed = 0;
    private introFrom: ReturnType<CameraRig['getPose']> | null = null;
    private introTo: ReturnType<CameraRig['getPose']> | null = null;
    private outroActive = false;
    private outroElapsed = 0;
    private outroFrom: ReturnType<CameraRig['getPose']> | null = null;
    private outroTo: ReturnType<CameraRig['getPose']> | null = null;
    private outroDone: (() => void) | null = null;
    /** specialist offer held until the intro finishes */
    private deferredStarterOffer: StartCard[] | null = null;
    /** round-card offer held until the intro finishes (resume before pick) */
    private deferredRoundOffer = false;
    private introCardsRevealed = false;
    private persistTimer = 0;
    /** last stamped battle positions for wear trails (visual only) */
    private readonly sandLastPos = new WeakMap<object, { x: number; z: number }>();
    /** restamp once when the async sand mask finishes loading */
    private sandBootstrapped = false;
    /** wall-clock timestamp (performance.now()) of the last tick — used to
     *  compute the sim's own TRUE, unclamped elapsed time (see tick()'s
     *  trueGameDt); null until the first tick has a prior sample to diff
     *  against */
    private lastSimRealTimeMs: number | null = null;
    private readonly boundTick = (ticker: { deltaMS: number }) => this.tick(ticker.deltaMS / 1000);
    private readonly onEscapeKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

        // cheats / debug hotkeys (visual or single-player only) — all Shift+
        if (e.code === 'KeyN' && e.shiftKey) {
            // year-tour atmosphere scenes + supply/HP/time cheats
            this.weather?.nextScene();
            this.refreshCinemaHint();
            this.economy.credit(this.humanSeat, 1000);
            this.playerHp += 5000;
            this.enemyHp += 5000;
            this.settings.battleTimeSeconds = 500;
            if (this.phase === 'battle' && this.sim) {
                this.sim.setBattleSeconds(500);
                this.phaseRemaining = 500 - this.sim.elapsed;
            }
            return;
        }
        if (e.code === 'KeyX' && e.shiftKey) {
            // season only (weather + time unchanged) — left of C on DE
            this.weather?.nextSeason();
            return;
        }
        if (e.code === 'KeyV' && e.shiftKey) {
            // weather only — right of C on DE
            this.weather?.nextWeather();
            return;
        }
        if (e.code === 'KeyY' && e.shiftKey) {
            // time of day only — next to X on DE (was B)
            this.weather?.nextTime();
            return;
        }
        if (e.code === 'KeyU' && e.shiftKey && !this.net && !this.star) {
            // Shift+U = SP deploy cheat (shop units only); Ctrl+Shift+U adds horde + level scramble
            this.cheatSpawnAllUnits({ scrambleLevels: e.ctrlKey, includeHorde: e.ctrlKey });
            return;
        }
        if (e.code === 'KeyH' && e.shiftKey && !this.net && !this.star) {
            // single-player: extra horde packs right now — stress-test
            // marchIn perf and eyeball the ring spawn/lake-avoidance logic
            // independent of the round's normal budget. Press repeatedly to
            // keep piling more on.
            this.cheatSpawnHordePacks();
            return;
        }
        if (e.code === 'KeyI' && e.shiftKey && !this.net && !this.star) {
            // Shift+I = SP skip to next round (lock deploy → resolve battle)
            this.cheatSkipRound();
            return;
        }
        if (e.code === 'KeyT' && e.shiftKey) {
            // Shift+T cycles material debug: clay → wireframe → normals → off
            this.cycleMaterialDebug();
            return;
        }
        if (e.shiftKey && e.code.startsWith('Digit')) {
            const digit = parseInt(e.code.slice(5), 10);
            if (digit === 0) {
                this.effectToggles.resetAll();
                this.applyHeightMistStrength();
                console.info('[fx] all effects on (Shift+0)');
                return;
            }
            const def = this.effectToggles.defForKey(digit);
            if (def) {
                const on = this.effectToggles.toggle(def.id);
                if (def.id === 'heightMist') this.applyHeightMistStrength();
                console.info(`[fx] Shift+${digit} ${def.label}: ${on ? 'on' : 'off'}`);
                return;
            }
        }
        if (e.code === 'KeyC' && e.shiftKey) {
            this.toggleUiHidden();
            return;
        }

        // battle / replay speed: 1 = Pause, then each step up; replay's top
        // speed (32×) is key 0 when it doesn't fit in 1–9
        if (
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            e.code.startsWith('Digit')
        ) {
            const digit = parseInt(e.code.slice(5), 10);
            const index = this.speedShortcutIndex(digit);
            if (index !== null && this.speedShortcutsActive()) {
                this.applySpeedIndex(index);
                return;
            }
        }

        // R: rotate selected pack (same as middle-click / touch Rotate)
        if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (!this.armedTactic) this.placement.rotateSelected();
            return;
        }

        if (e.code !== 'Escape') return;
        if (this.introActive || this.outroActive) return;
        if (this.hud.isUiHidden) {
            this.toggleUiHidden();
            return;
        }
        this.togglePauseMenu();
    };

    /** Hide all match UI (HUD, debug, HP bars) for clean viewing / screenshots.
     *  Also switches the world to battle presentation (no grid / deploy markers). */
    private toggleUiHidden(): void {
        const hide = !this.hud.isUiHidden;
        this.hud.setUiHidden(hide);
        this.hpBars.view.visible = !hide;
        this.hordeMarkers.edgeView.visible = !hide;
        this.debug.el.style.visibility = hide ? 'hidden' : '';
        this.syncDebugDumpButton();
        this.applyCinemaWorld(hide);
        if (hide) this.refreshCinemaHint(500);
    }

    /**
     * The dump button belongs to the debug overlay, so it has to follow every
     * input that hides it: the setting, the collapsed state and cinema mode.
     * Each of those used to be wired separately, and two of them forgot it.
     */
    private syncDebugDumpButton(): void {
        this.debugDumpButton?.setVisible(
            debugEnabled() && !this.debug.isCollapsed && !this.hud.isUiHidden,
        );
    }

    /** Cinema footer: `Shift+C — 1/11 Spring morning` (same scene text as the debug overlay). */
    private refreshCinemaHint(durationMs?: number): void {
        if (!this.hud.isUiHidden) return;
        this.hud.flashCinemaHint(this.weather?.sceneStatus() ?? '—', durationMs);
    }

    /** Shift+T debug: cycle clay → wireframe → normals → off for every mesh. */
    private cycleMaterialDebug(): void {
        const order = ['clay', 'wire', 'normals', 'off'] as const;
        const i = order.indexOf(this.materialDebug);
        const next = order[(i + 1) % order.length]!;
        this.materialDebug = next;
        this.scene.overrideMaterial =
            next === 'clay' ? this.clayOverride
            : next === 'wire' ? this.wireOverride
            : next === 'normals' ? this.normalsOverride
            : null;
    }

    /** Re-bake height-mist shader strength and recompile fogged materials (Shift+3). */
    private applyHeightMistStrength(): void {
        const strength = this.effectToggles.isEnabled('heightMist') ? this.heightMistBase : 0;
        setHeightFogStrength(strength);
        this.scene.traverse((o) => {
            const m = (o as import('three').Mesh).material as
                | import('three').Material
                | import('three').Material[]
                | undefined;
            if (!m) return;
            for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
        });
    }

    /**
     * World-side half of cinema mode: same look as attack phase — grid off,
     * placement chrome off, flyers at combat height, no deploy tactic outlines.
     * Call with `true` again after any phase transition that might re-show deploy chrome.
     */
    private applyCinemaWorld(hide: boolean): void {
        this.placement.forgeStatusVisible = !hide;
        if (hide) {
            this.placement.deselect();
            this.selectedActor = null;
            this.armedItem = null;
            this.cancelTacticPlacement();
            this.placement.enabled = false;
            this.gridOverlay.visible = false;
            // same flyer climb as startBattlePhase
            this.placement.beginBattle();
            this.oilVisuals.setDraft(null);
            this.oilVisuals.sync(this.oilField, 0, [], false);
            this.spellVisuals.clear();
            this.rallyVisuals.sync([], null);
            return;
        }
        // Exit cinema: restore deploy chrome only while freely placing
        if (this.phase === 'build' && !this.deployReady.player && !this.matchOver) {
            this.placement.enabled = true;
            this.gridOverlay.visible = true;
            this.placement.beginDeployment();
            this.syncTacticVisuals();
        }
    }

    /** Keep cinema world look after phase code that re-enables the grid / placement. */
    private enforceCinemaWorld(): void {
        if (this.hud.isUiHidden) this.applyCinemaWorld(true);
    }

    /** Escape / the topbar ☰ button: open or close the pause menu */
    private togglePauseMenu(): void {
        if (this.matchOver || this.suspended || this.outroActive) return;
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
    /** the match roster; localized so MY side always reads 'player' locally */
    private readonly seats: SeatDef[];
    /** the local human's seat id — 0 for every local/classic-net mode; a star
     *  guest's assigned canonical seat can be any index */
    private readonly humanSeat: SeatId;

    constructor(
        private readonly pixiApp: Application,
        threeCanvas: HTMLCanvasElement,
        wrapper: HTMLElement, // #match-ui-root — HUD mount + resize size source
        settingsInput: GameSettings = DEFAULT_SETTINGS,
        /** the peer connection in multiplayer, null against the AI (swappable on reconnect) */
        private net: Session | null = null,
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
        /** 2v2+ star-topology connection — mutually exclusive with `net`.
         *  `settings.seats` must already be the LOCALIZED roster (via
         *  localizeRoster) by the time this reaches the constructor. */
        private readonly star: StarRole | null = null,
        /** watch mode: replaces the entire match with someone else's
         *  (or your own) finished one, played back at a natural pace —
         *  distinct from `resume`, which continues a still-live match.
         *  Mutually exclusive with `net`/`star`/`resume`. `jumpToRound`
         *  instantly fast-forwards (dispatch + headless battles) through
         *  everything before that round before paced playback takes over —
         *  used for both "jump to round N" and "skip to end" (an
         *  unreachably high target). `verify` re-submits the recomputed
         *  result through the normal telemetry pipeline at match end (see
         *  finishMatch) — a fast, no-watching way to check a stored replay
         *  still reproduces its recorded outcome; `mode` is the ORIGINAL
         *  match's mode (net/star are always null while watching, so
         *  reportMatchTelemetry can't otherwise tell a replayed 2v2 from
         *  solo — needed so a verify submission's fingerprint can actually
         *  match the original's). `expected` is the originally-recorded
         *  outcome, shown alongside the recomputed one on the game-over
         *  screen in verify mode so the match/mismatch is visible without
         *  needing to cross-reference replays.html by hand. */
        replay: {
            actions: LoggedAction[];
            jumpToRound?: number;
            verify?: boolean;
            mode?: MatchMode;
            expected?: { result: MatchResult; rounds: number; playerHp: number; enemyHp: number };
        } | null = null,
        /** spectate mode: a read-only live view of someone else's running
         *  match, joined via `joinAsSpectator` (see net.ts). Mutually
         *  exclusive with `net`/`star`/`resume`/`replay`. `initial` is the
         *  same shape `resume` consumes — catch-up reuses `hydrate()`
         *  verbatim, no perspective swap (there is no "my side" to swap to).
         *  Ongoing play streams in over `session` exactly like any other
         *  seat's build traffic (see `onSpectateMessage`/`starRemoteQueue`);
         *  no build UI ever shows because `this.watching` is true, the same
         *  guard replay playback already relies on throughout this class. */
        spectate: {
            session: SpectatorLink;
            /** the watching user's own name — distinct from `playerNames`,
             *  which for spectate mode holds the two PLAYERS' names (for
             *  sideLabel/roster display, not "who is chatting") */
            watcherName: string;
            initial: { actions: LoggedAction[]; battleElapsed: number | null; phaseRemaining: number };
        } | null = null,
        /** fresh match only: hold specialist cards + HUD while the camera
         *  flies in from a wide overlook (menu logo covers the ctor hitch). */
        matchIntro = false,
    ) {
        this.watching = replay !== null || spectate !== null;
        this.watcherName = spectate?.watcherName ?? null;
        this.replayVerify = replay?.verify === true;
        this.replayOriginalMode = replay?.mode ?? null;
        this.replayExpected = replay?.expected ?? null;
        // the field initializer above hardcodes SPEED_STEPS's index of 1 —
        // REPLAY_SPEED_STEPS has 1 at a different position, so correct it
        // now that `watching` (and therefore `speedSteps`) is known
        if (this.watching) this.speedIndex = this.speedSteps.indexOf(1);
        // dev-only cross-client debug bus: "host" here means "where
        // SpectatorHub lives" — classic 1v1's side 'a', or a star host.
        // A spectator is never the host and never streams anywhere else.
        this.debugLog = new DebugLog(
            spectate ? 'spectator' : star ? (star.role === 'host' ? 'host' : 'star-guest') : side === 'a' ? 'host' : 'guest',
            spectate ? spectate.watcherName : playerNames.local,
            spectate ? false : star ? star.role === 'host' : side === 'a',
            debugEnabled(),
        );
        this.debugLog.onThresholdReached = () => this.sendDebugBatch();
        // console-callable dump of the aggregated cross-client timeline —
        // only meaningful wherever SpectatorHub/the aggregator actually
        // lives (this "host"); a guest/star-guest/spectator only ever holds
        // its OWN unaggregated events, so exposing this there would be
        // misleading (looks complete, isn't)
        if (this.debugLog.enabled && this.debugLog.isHost) {
            const debugWindow = window as unknown as {
                mechiliDebugDump?: (opts?: {
                    clientId?: string;
                    category?: string;
                    sinceMs?: number;
                    verbose?: boolean;
                }) => string;
                mechiliDebugClear?: () => void;
            };
            debugWindow.mechiliDebugDump = (opts) => this.debugLog.dump(opts);
            debugWindow.mechiliDebugClear = () => this.debugLog.clear();
        }
        this.settings = normalizeGameSettings(settingsInput);
        const settings = this.settings;
        this.wrapper = wrapper;
        this.threeCanvas = threeCanvas;
        // canonical colors first — units, overlays and HUD CSS all read them
        assignTeamColors(side);
        this.map = new BattleMap(settings.map);
        // sized to THIS match's board — a hardcoded default here silently
        // drops every oil/acid/fire effect placed outside the standard
        // map's extent on any non-standard map (horde's belt, duo's width)
        this.oilField = new HazardField(settings.map);
        this.oilBaseline = new HazardField(settings.map);
        // one SHARED board for both peers: the guest owns the far half and
        // only its camera differs — no coordinates are ever mirrored
        this.map.ownAtFar = side === 'b';
        // Canonical roster, same convention as a star room's
        // CanonicalSeatDef: host is always side 'a'/seat 0, guest is always
        // side 'b'/seat 1, on every client — both clients can reconstruct
        // the identical roster locally (each already knows `side` and both
        // names) without a wire handshake for it. `localizeRoster` then
        // relabels it to THIS client's own "player = mine" view, same as
        // star mode. Solo/AI play (`side` defaults to 'a') gets the exact
        // same seat 0/1 split as before, just also side-tagged.
        const humanSeat = star?.mySeat ?? (side === 'a' ? 0 : 1);
        const baseSeats =
            settings.seats ??
            localizeRoster(
                canonicalClassicSeats(
                    side === 'a' ? this.playerNames.local : this.playerNames.opponent,
                    side === 'a' ? this.playerNames.opponent : this.playerNames.local,
                ),
                side,
            );
        // Local custom face: fill in if the wire/roster didn't already carry one.
        const localAvatar = getAvatarDataUrl();
        this.seats = baseSeats.map((s, i) =>
            i === humanSeat && !s.avatar && localAvatar ? { ...s, avatar: localAvatar } : s,
        );
        this.humanSeat = humanSeat;
        this.economy = new Economy(settings.economy, this.seats.length);
        this.recruitLevel = this.seats.map(() => 1);
        this.creditUsed = this.seats.map(() => false);
        this.creditDebt = this.seats.map(() => false);
        this.starterPicked = this.seats.map(() => false);
        this.itemInventory = this.seats.map(() => []);
        this.tacticInventory = this.seats.map(() => []);
        this.roundCardTaken = this.seats.map(() => false);
        this.speciality = this.seats.map(() => null);
        this.flankSpawnMult = this.seats.map(() => 1);
        this.techTree = new TechTree(this.seats.length);
        this.forgeSlots.player = emptyForgeSlots(
            forgeTeamCapacity(seatIdsOf(this.seats, 'player').length),
        );
        this.forgeSlots.enemy = emptyForgeSlots(
            forgeTeamCapacity(seatIdsOf(this.seats, 'enemy').length),
        );
        // starts at 0: each seat's own card ADDS its own startingHp in
        // chooseCard (additive, so it's safe regardless of which seat's
        // pick a client applies first). Explicitly sized to the roster's
        // real side count (not just "however far the playerHp/enemyHp
        // setters happen to have written") so the enemyHp getter's "sum
        // every other side" loop sees every side from the start, even
        // ones nothing has assigned to yet. Peak grows with grants (see
        // playerHp/enemyHp setters) so the HUD bar max survives reconnect.
        const sides = sideCount(this.seats);
        this.hp = new Array(sides).fill(0);
        this.hpPeak = new Array(sides).fill(0);
        // Prefer the boot-warmed GL context so flame/projectile programs survive;
        // fall back to a fresh renderer after return-to-menu (new canvas).
        this.renderer =
            takePrewarmedRenderer() ??
            new WebGLRenderer({
                canvas: threeCanvas,
                antialias: prefs().antialias,
                // mobile Safari kills tabs that push the GPU too hard — prefer the
                // efficient tier there; desktops ignore or barely notice this hint
                powerPreference: touchFirstDevice() ? 'low-power' : 'default',
            });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = ACESFilmicToneMapping;
        // Slightly above 1 so the denser grass normals/albedo still read under ACES
        this.renderer.toneMappingExposure = touchFirstDevice() ? 1.0 : 1.08;
        this.renderer.setPixelRatio(effectiveDpr());

        this.scene.background = new Color(THEME.sky);
        // scenery 'off' plays without any fog or weather
        this.scene.fog = sceneryWeatherFx() ? new Fog(THEME.sky, THEME.fogNear, THEME.fogFar) : null;
        // ground-mist strength for the current scenery tier (baked into the
        // fog shader chunk before the first material compiles)
        this.heightMistBase = sceneryHeightFog();
        this.applyHeightMistStrength();

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
        // Large square frustum past the near forest. A board-tight box (±half+40)
        // reads as a rotating "cube shadow" when the sun lerps during season/time.
        const shadowExtent = Math.max(this.map.halfW, this.map.halfH) + 280;
        sun.shadow.camera.left = -shadowExtent;
        sun.shadow.camera.right = shadowExtent;
        sun.shadow.camera.top = shadowExtent;
        sun.shadow.camera.bottom = -shadowExtent;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 720;
        sun.shadow.camera.updateProjectionMatrix();
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
        this.gridOverlay = this.map.createOverlayMesh(seatLane(this.seats, this.humanSeat));
        this.scene.add(this.gridOverlay);
        this.projectileRenderer = new ProjectileRenderer(this.scene);
        this.stuckBolts = new StuckBoltRenderer(this.scene);
        this.stoneChips = new StoneChipRenderer(this.scene);
        this.particles = new Particles(this.scene);
        this.fireFx = new FireFx(this.particles, this.scene);
        this.towerDebuffFx = new TowerDebuffFx(this.scene, this.particles, this.map.halfW, this.map.halfH);
        this.hammerFx = new HammerFx(this.scene);
        this.meteorFx = new MeteorFx(this.scene);
        this.cloudFx = new CloudFx(this.scene);
        this.dragonFx = new DragonFx(this.scene);
        this.conversionFx = new ConversionFx(this.scene);
        this.oilDripFx = new OilDripFx(this.scene);
        this.hordeMarkers = new HordeMarkers(this.scene);
        this.oilVisuals = new OilVisuals(this.scene, this.map);
        this.unitInstances = new UnitInstanceRenderer(this.scene);
        setUnitInstanceRenderer(this.unitInstances);
        this.applyShadowQuality();
        this.battleRangeMesh = createRangeRing(this.scene);
        this.battleMinRangeMesh = createRangeRing(this.scene);
        (this.battleMinRangeMesh.material as import('three').MeshBasicMaterial).color.setHex(0xff6a44);
        this.battleAuraMesh = createRangeRing(this.scene);
        (this.battleAuraMesh.material as import('three').MeshBasicMaterial).color.setHex(0xffcf5a);

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map —
        // horde mode widens this so the player can pan out far enough to see the wave
        // approaching through the forest ring (see spawnHordeWave)
        const hordeReach = hordeEnabled(this.settings) ? HORDE_RING_NEAR + HORDE_RING_SPAN : 0;
        this.rig.setBounds(this.map.halfW - 8 + hordeReach, this.map.halfH - 16 + hordeReach);
        this.rig.fitMap(this.map.width, this.map.height, sceneryCameraFar());
        // open centered on the player's own zone (where the starting army
        // stands) — the far-side owner looks at the shared board rotated 180°
        const nearSide = side === 'a';
        this.rig.setBaseHeading(nearSide ? 0 : Math.PI);
        const ownZoneZ =
            (this.map.halfH - (this.map.size.rimCells + this.map.size.zoneRows / 2) * CELL) *
            (nearSide ? 1 : -1);
        this.rig.startAt(0, ownZoneZ, PLAY_START_ZOOM);
        if (matchIntro) {
            const play = this.rig.getPose();
            this.introTo = play;
            this.introFrom = {
                ...play,
                zoom: Math.min(this.rig.maxZoom, MATCH_INTRO_ZOOM),
                pitch: MATCH_INTRO_PITCH,
            };
            this.rig.setPose(this.introFrom);
        }
        this.controls = new CameraControls(this.rig, surface);
        if (matchIntro) this.controls.enabled = false;
        // edge scrolling is hover-based and has no touch equivalent
        const syncEdgeScroll = () => {
            this.controls.edgeScroll = inputMode() !== 'touch';
        };
        syncEdgeScroll();
        this.inputDisposers.push(onInputModeChange(syncEdgeScroll));
        this.rig.floorAt = worldHeightAt; // camera never dives into terrain
        installScreenShake(this.rig.camera, () => this.rig.target);
        this.hpDrawFx = new HpDrawFx(this.scene);
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        this.placement.hasTech = (seat, typeId, techId) => this.unitHasTech(seat, typeId, techId);
        // spectator watching a LIVE match (not a replay, which has no
        // "vision" concept — it's a neutral post-hoc view of everything):
        // neither side is "mine", so both are fogged symmetrically from the
        // start (empty = no live grants yet, battle-vision default). Kept in
        // sync with the host's actual grants via 'visionUpdate' messages —
        // see onSpectateMessage.
        if (spectate) this.placement.spectatorLiveSeats = new Set();
        // one-finger drags aim the carried ghost/tactic instead of panning
        this.controls.suppressTouchPan = () => this.placement.pointerCarries;
        // gamepad: virtual cursor over the same click pipeline (Halo Wars style)
        this.gamepad = new GamepadCursor(surface, this.rig);
        if (matchIntro) this.gamepad.enabled = false;
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
            ? this.scenery.createWeather(
                  this.scene,
                  sun,
                  hemi,
                  this.renderer,
                  seedFrom(this.seed, 'weather'),
                  this.effectToggles,
              )
            : null;
        this.scenery.attachSun(sun);
        this.rngAi = mulberry32(seedFrom(this.seed, 'ai'));
        // specialist streams are keyed by canonical side (different draws)
        this.rngCards = {
            player: mulberry32(seedFrom(this.seed, `cards-${side}`)),
            enemy: mulberry32(seedFrom(this.seed, `cards-${side === 'a' ? 'b' : 'a'}`)),
        };
        // one stream per SEAT, keyed by canonical seat index (same array
        // order/index on every client, star mode or not) — each seat's own
        // independent draw, matching how extraAis' own starter-card pick works
        this.rngRoundCards = this.seats.map((_, seat) => mulberry32(seedFrom(this.seed, `round-cards-${seat}`)));
        this.deployState = {
            limit: this.seats.map(() => settings.deploy.unitsPerRound),
            extra: this.seats.map(() => 0),
            used: this.seats.map(() => 0),
            extrasSpent: this.seats.map(() => 0),
            runesBought: this.seats.map(() => 0),
        };
        this.sellState = { owned: this.seats.map(() => false), used: this.seats.map(() => 0) };
        this.rallyRouteOwned = this.seats.map(() => false);
        this.movePackOwned = this.seats.map(() => false);
        this.boostState = { attack: this.seats.map(() => 0), hp: this.seats.map(() => 0) };
        this.roundBoosts = { range: this.seats.map(() => false), speed: this.seats.map(() => false) };
        this.unlockedUnits = this.seats.map(() => []);
        this.unlockUsedThisRound = this.seats.map(() => false);
        this.placement.roster = this.seats;
        this.hpBars.roster = this.seats;
        this.conversionFx.roster = this.seats;
        this.dispatcher = new ActionDispatcher({
            placement: this.placement,
            economy: this.economy,
            seats: this.seats,
            techTree: this.techTree,
            leveling: settings.leveling,
            towers: settings.towers,
            sellSettings: settings.sell,
            rallyRouteSettings: settings.rallyRoute,
            movePackSettings: settings.movePack,
            deploySettings: settings.deploy,
            boostSettings: settings.boosts,
            recruitLevel: this.recruitLevel,
            sellState: this.sellState,
            rallyRouteOwned: this.rallyRouteOwned,
            movePackOwned: this.movePackOwned,
            deployState: this.deployState,
            boostState: this.boostState,
            roundBoosts: this.roundBoosts,
            creditUsed: this.creditUsed,
            creditDebt: this.creditDebt,
            speciality: this.speciality,
            flankSpawnMult: this.flankSpawnMult,
            items: this.itemInventory,
            tactics: this.tacticInventory,
            forgeSlots: this.forgeSlots,
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
            seatReady: this.seatReady,
            starterPicked: this.starterPicked,
            unlockedUnits: this.unlockedUnits,
            unlockUsedThisRound: this.unlockUsedThisRound,
            hp: {
                get: (team) => (team === 'player' ? this.playerHp : this.enemyHp),
                set: (team, hp) => {
                    if (team === 'player') this.playerHp = hp;
                    else this.enemyHp = hp;
                },
            },
            commanderHpFactor: settings.commanderHpFactor,
            clock: () => ({
                round: this.round,
                t: Math.max(0, this.phaseBudgetSeconds() - this.phaseRemaining),
            }),
            debugLog: (category, data) => this.debugLog.log(category, data),
            onEndDeployment: (team) => {
                if (this.phase !== 'build' || this.matchOver) return;
                // watching: 'player' here just means "the host's endDeployment
                // was applied to this simulation" — none of the "freeze MY OWN
                // input, reveal MY OWN board early" side effects below make
                // sense for a spectator (there's no local input, and an early
                // reveal tied to one specific side locking in isn't the same
                // as both sides locking in or battle actually starting).
                if (team === 'player' && !this.watching) {
                    // Cancel any pending placement/tactic and drop selection —
                    // but do NOT disable placement entirely. `enabled = false`
                    // gates the ENTIRE render-update loop (applyIntelFog,
                    // level arrows, item badges — see PlacementController
                    // .update's per-function `if (!enabled) return` checks),
                    // which would freeze the whole board the instant we lock
                    // in — same "action received but doesn't show" symptom
                    // the spectator exemption above already avoids. Leaving
                    // it enabled lets us keep inspecting any pack (ours or,
                    // once visible, the enemy's — handleClick's own
                    // enemyIntelVisible check already allows that) and see
                    // the enemy's remaining moves render live as they arrive.
                    // Actually placing/moving/buying is still safely refused
                    // — dispatchPlayer rejects everything once
                    // seatReady[humanSeat] is set, regardless of `enabled`
                    // — and the shop stays disabled in the HUD (see
                    // waitingForPeer/shopColumn), so nothing can re-arm a
                    // pending buy after this point.
                    this.placement.deselect();
                    this.armedItem = null;
                    this.cancelTacticPlacement();
                    this.placement.hiddenPlacements = false;
                    this.placement.revealAll();
                    this.enemyIntelSnapshot = null;
                    this.techIntelSnapshot = null;
                    this.buildingIntelSnapshot = null;
                }
                // Star mode deliberately does NOT check maybeStartStarBattle
                // here — this callback fires DURING dispatch, before the
                // action that triggered it has been relayed onward. Every
                // dispatch path (dispatchPlayer, AI, drainStarRemoteQueue)
                // calls relayStarBuildMessage right after its own dispatch
                // completes, and THAT'S where the check correctly lives —
                // checking here too raced the battle-start broadcast ahead
                // of the very action that completed the last lock-in.
                if (!this.star) this.maybeStartBattleAfterDeploy();
            },
            // fires on the dispatching client AND on every other client
            // that later applies the same logged forfeitSide action
            // (live relay, or a resume/replay catch-up) — same "check HP,
            // end the match" logic endBattlePhase already runs after a
            // battle result, just triggered by a different cause
            onForfeit: () => {
                if (this.playerHp <= 0 || this.enemyHp <= 0) this.finishMatch();
            },
        });
        if (this.watching) {
            // every seat's actions come from the replay log — no AI, no
            // human input, on any seat (same no-op used for a star guest,
            // which already never runs local AI or accepts local input)
            this.opponent = new NetworkOpponent();
        } else if (this.star) {
            // star mode: every AI-controlled seat runs uniformly via extraAis
            // (no "primary enemy" concept — could be 1 or 2 enemy seats).
            // Only the HOST ever runs AI locally; a guest's `this.opponent`
            // stays a no-op placeholder, and its extraAis stays empty —
            // every seat's actions (AI or human) arrive over the wire.
            this.opponent = new NetworkOpponent();
            if (this.star.role === 'host') {
                for (let seat = 0; seat < this.seats.length; seat++) {
                    const def = this.seats[seat]!;
                    if (def.controller !== 'ai') continue;
                    const rng = mulberry32(seedFrom(this.seed, `ai-${seat}`));
                    this.extraAis.push({ ai: new AiOpponent(def.team, seat, this.aiCtxFor(rng)), rng, team: def.team, seat });
                }
            }
        } else {
            this.opponent = this.net
                ? new NetworkOpponent()
                : new AiOpponent('enemy', primarySeatOf(this.seats, 'enemy'), this.aiCtxFor(this.rngAi));
            // local duo modes: every further AI seat gets its own brain and rng stream
            for (let seat = 0; seat < this.seats.length; seat++) {
                const def = this.seats[seat]!;
                if (def.controller !== 'ai' || seat === primarySeatOf(this.seats, 'enemy')) continue;
                if (this.net) continue; // networked matches drive remote seats over the wire
                const rng = mulberry32(seedFrom(this.seed, `ai-${seat}`));
                this.extraAis.push({ ai: new AiOpponent(def.team, seat, this.aiCtxFor(rng)), rng, team: def.team, seat });
            }
        }
        this.placement.localSeat = this.humanSeat;
        this.placement.dispatch = (action) => this.dispatchPlayer(action);
        // gold pulse under packs whose next level is buyable right now.
        // canLevel gates on playerCanAct, which is unconditionally false
        // while watching (this.watching — replay OR spectate) OR once WE'VE
        // locked in (seatReady[humanSeat]) — neither case means the arrow
        // itself should disappear, since it's purely informational ("this
        // pack could level up"), not an action button; the actual level-up
        // purchase stays correctly blocked elsewhere via playerCanAct.
        // Route both cases through the gate-free packUpgradeReady directly
        // so arrows for both sides keep showing until battle actually
        // starts (placement.enabled=false there hides them like everything
        // else). Checked per-call (not once at assignment) since
        // seatReady flips mid-round, unlike `watching`.
        this.placement.levelReady = (unit) =>
            this.watching || this.seatReady[this.humanSeat]
                ? this.packUpgradeReady(unit, unit.level, unit.xp)
                : this.canLevel(unit);
        // freeze upgrade-arrow intel at phase start (survives enemy leveling mid-deploy)
        this.placement.upgradeReadyAtCapture = (unit) => this.packUpgradeReady(unit, unit.level, unit.xp);
        // world tech icons — phase-start intel while fogged, live after reveal
        this.placement.ownedTechIcons = (unit) => {
            if (unit.type.structure) return [];
            const selected = techsForUnit(unit.type.id);
            if (selected.length === 0) return [];
            const owned = this.intelTechOwned(unit);
            return selected.filter((t) => owned.has(t.id)).map((t) => techIcon(t));
        };
        // Stronghold oven: rune badges + predicted spell (fog uses phase-start snapshot)
        this.placement.forgeStatusIcons = (unit) => this.forgeWorldBadges(unit);
        // an armed inventory item lands on the next own pack that gets clicked
        this.placement.onSelect = (unit, previous) => {
            if (this.armedItem) {
                const applied =
                    unit.type === STRONGHOLD && unit.team === 'player'
                        ? this.forgeInsertItem(this.armedItem)
                        : this.applyItemTo(unit, this.armedItem);
                if (applied) {
                    this.armedItem = null;
                    this.armedItemIndex = null;
                    // keep details only when this pack's panel was already open;
                    // otherwise don't open the drop target (and close a wrong panel)
                    if (previous && previous !== unit) this.placement.deselect();
                }
                return;
            }
            // buildings act through their details — auto-open the sheet (phone-only visual)
            if (unit.type.structure) this.hud.openUnitDetails();
        };
        this.placement.itemDropValid = (unit) =>
            this.canDropArmedItemOn(unit) || this.canDropForgeOn(unit);
        this.placement.tacticTargetValid = (unit) => {
            const armed = this.armedTactic;
            if (!armed || TACTICS[armed]?.targeting !== 'own-unit') return false;
            return this.canTargetOwnUnit(armed, unit);
        };
        this.placement.groundClickInterceptor = (x, y) => this.handleTacticGroundClick(x, y);
        this.controls.onMiddleClick = () => {
            if (this.armedTactic) return;
            this.placement.rotateSelected();
        };
        this.placement.rangeOf = (unit) => this.resolvedStats(unit).range;
        this.placement.minRangeOf = (unit) => this.resolvedStats(unit).minRange;
        this.placement.auraRangeOf = (unit) => this.auraRadiusOf(unit);
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
        if (matchIntro) {
            this.hud.setMatchChromeVisible(false);
            this.hpBars.view.visible = false;
            this.introActive = true;
        }
        this.hud.setUnitIcons(renderAllUnitIcons(this.renderer));
        // this match's real settings (including any ?hordeFactor= override) —
        // fixed for the match's lifetime, so a one-time snapshot is enough
        this.hud.setSettingsGroups(describeGameSettings(this.settings));
        // watching's own wider-range speed control (replayControls.ts)
        // replaces this button entirely — watching never changes for a
        // Game instance's lifetime, so this is a one-time hide, not a toggle
        if (this.watching) this.hud.setSpeedButtonVisible(false);
        this.hud.setSpeedSteps(this.speedSteps);
        this.hud.onMenuToggle = () => this.togglePauseMenu();
        // touch stand-in for middle-click (rotate)
        this.hud.onTouchRotate = () => this.placement.rotateSelected();
        this.hud.onTouchPickUp = () => this.placement.pickUpSelected();
        this.hud.onUnlockPick = (typeId) => this.unlockUnit(typeId);
        this.hud.unlockCostOf = (typeId) =>
            unlockCostForSpeciality(typeId, this.speciality[this.humanSeat] ?? null);
        this.hud.onBuyRune = (itemId) => this.buyRune(itemId);
        this.hud.onQuitToMenu = () => this.voluntaryQuit();
        // a spectator has no seat of its own to grant vision from
        if (!spectate) this.hud.onGrantSpectatorLive = (name, grant) => this.grantSpectatorLive(name, grant);
        this.hud.setCommanders(this.commanderEntries(), this.humanSeat);
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
            const myName = this.watcherName ?? this.playerNames.local;
            this.hud.addChat(myName, item, 'local');
            const role: 'player' | 'spectator' = this.watcherName ? 'spectator' : 'player';
            this.broadcast({ type: 'chat', item, from: { name: myName, role } });
        };
        this.hud.onArmItem = (itemId, index) => {
            if (!this.playerCanAct || this.armedTactic) return;
            // press the armed slot again to disarm; another slot re-arms there
            if (this.armedItem === itemId && this.armedItemIndex === index) {
                this.armedItem = null;
                this.armedItemIndex = null;
            } else {
                this.armedItem = itemId;
                this.armedItemIndex = index;
            }
        };
        this.hud.onCancelInventoryArm = () => {
            this.armedItem = null;
            this.armedItemIndex = null;
            this.armedTactic = null;
        };
        this.hud.onRemoveItem = (unitId, itemId, slot) => {
            this.removeItemFrom(unitId, itemId, slot);
        };
        this.hud.onRemoveForge = (slot, itemId) => {
            this.forgeRemoveItem(slot, itemId);
        };
        this.hud.onForgeFill = (itemIds) => {
            this.forgeFillItems(itemIds);
        };
        this.hud.onApplyArmedItem = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || !this.armedItem) return;
            if (unit.type === STRONGHOLD) {
                if (this.forgeInsertItem(this.armedItem)) {
                    this.armedItem = null;
                    this.armedItemIndex = null;
                }
                return;
            }
            if (this.applyItemTo(unit, this.armedItem)) {
                this.armedItem = null;
                this.armedItemIndex = null;
                // keep the pack selected so a second item can fill the other slot
            }
        };
        this.hud.onInventoryDragMove = (clientX, clientY) => {
            // strip coords must not project onto the terrain while a tactic is
            // armed. Use the sidebar's layout box — after pick-up the armed
            // button is removed, so elementFromPoint sees the canvas underneath.
            if (this.armedTactic && this.hud.clientOverPlayerInventory(clientX, clientY)) {
                return;
            }
            this.placement.setPointerFromClient(clientX, clientY);
        };
        this.hud.onInventoryDragEnd = ({ clientX, clientY, moved, target }) => {
            if (!this.armedItem) {
                // click-to-arm stays armed. Drag-to-place only when the release
                // leaves the left strip's box (not merely "over canvas" — the
                // armed entry vanishes and punches through to the board).
                if (
                    this.armedTactic &&
                    moved &&
                    !this.hud.clientOverPlayerInventory(clientX, clientY)
                ) {
                    this.tryPlaceArmedTacticAtClient(clientX, clientY);
                }
                return;
            }
            // press-drag release: drop on details panel or 3D pack
            if (moved) {
                const overDetails =
                    target?.closest?.('.item-sq.empty') || target?.closest?.('.mechili-panel');
                if (overDetails) {
                    const unit = this.placement.selectedUnit;
                    if (unit?.type === STRONGHOLD && this.canDropForgeOn(unit) && this.forgeInsertItem(this.armedItem)) {
                        this.armedItem = null;
                        this.armedItemIndex = null;
                        return;
                    }
                    if (unit && this.canDropArmedItemOn(unit) && this.applyItemTo(unit, this.armedItem)) {
                        this.armedItem = null;
                        this.armedItemIndex = null;
                        return;
                    }
                }
                if (this.tryDropArmedItemAtClient(clientX, clientY)) {
                    this.armedItem = null;
                    this.armedItemIndex = null;
                    return;
                }
                // dragged onto nothing valid → cancel arm
                this.armedItem = null;
                this.armedItemIndex = null;
                return;
            }
            // short click: stay armed for the existing click-to-place flow
        };
        this.hud.onArmTactic = (tacticId, index) => {
            if (!this.playerCanAct) return;
            if (this.armedTactic === tacticId && this.armedTacticIndex === index) {
                this.cancelTacticPlacement();
                return;
            }
            this.armedItem = null;
            this.armedItemIndex = null;
            this.placement.deselect();
            this.armedTactic = tacticId;
            this.armedTacticIndex = index;
            this.tacticDraftStart = null;
            this.tacticDraftMid = null;
            this.placement.inputLocked = true;
            // ignore last map hover / strip press — preview starts when the
            // pointer enters the board
            this.placement.clearPointer();
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
        this.hud.onBuyMovePackAbility = () => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== COMMAND_TOWER || unit.team !== 'player') return;
            this.dispatchPlayer({ kind: 'buyMovePackAbility', team: 'player' });
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
        this.hud.onSendSupply = (amount) => {
            const unit = this.placement.selectedUnit;
            if (this.phase !== 'build' || unit?.type !== STRONGHOLD || unit.team !== 'player') return;
            if (!this.playerCanAct) return;
            const ally = seatIdsOf(this.seats, 'player').find((s) => s !== this.humanSeat);
            if (ally === undefined) return; // no ally seat (1v1/solo) — tile never shows anyway
            this.dispatchPlayer({ kind: 'sendSupply', team: 'player', toSeat: ally, amount });
        };
        this.hud.onBuyLevel = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            this.buyLevelFor(unit);
        };
        this.hud.onLevelAll = () => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            // every ready pack of the same kind, oldest first — one undo peels all
            this.buyLevelsFor(this.levelablePacksOf(unit.type));
        };
        this.hud.onLevelAllGlobal = () => {
            if (!this.playerCanAct) return;
            this.buyLevelsFor(this.allLevelablePacks());
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
        // hovering/peeking a tech tile drives its world range preview (Golden Aura ring)
        this.hud.onTechHover = (techId) => {
            this.hoveredTech = techId;
        };
        this.debug = new DebugOverlay(wrapper, debugEnabled());
        if (this.debugLog.enabled && this.debugLog.isHost) {
            this.debugDumpButton = new DebugDumpButton(wrapper, (opts) => this.debugLog.dump(opts));
            this.syncDebugDumpButton();
            this.debug.onCollapsedChange = () => this.syncDebugDumpButton();
        }
        pixiApp.stage.addChild(this.hpBars.view);
        pixiApp.stage.addChild(this.hordeMarkers.edgeView);

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
        } else if (replay) {
            this.replayLog = replay.actions;
            // round 0 (starter pick) dispatches immediately, same as
            // hydrate() does — a natural pace doesn't matter for a one-time
            // card pick, and this gets straight to round 1's build phase,
            // where the per-frame paced dispatch (see the main tick) takes
            // over for everything after
            while (
                this.replayCursor < this.replayLog.length &&
                this.replayLog[this.replayCursor]!.round === 0
            ) {
                this.dispatcher.dispatch(this.replayLog[this.replayCursor]!.action);
                this.replayCursor++;
            }
            this.maybeStartMatch();
            if (replay.jumpToRound !== undefined && replay.jumpToRound > 1) {
                this.fastForwardReplayThroughRound(replay.jumpToRound);
            }
        } else if (spectate) {
            // same catch-up machinery as a reconnecting player — no
            // perspective swap, we render the match exactly as recorded
            this.hydrate(spectate.initial.actions, spectate.initial.battleElapsed, false);
            if (this.phase === 'build') {
                this.phaseRemaining = spectate.initial.phaseRemaining;
            }
        } else if (matchIntro) {
            // hold the specialist overlay until the camera fly-in finishes
            this.deferredStarterOffer = this.draw(START_CARDS, 4, this.rngCards.player);
        } else {
            this.showStarterPick(this.draw(START_CARDS, 4, this.rngCards.player));
        }
        // only now may peer messages flow — everything they touch exists
        if (this.net) this.wireSession(this.net);
        if (resume && this.net && !resume.local) {
            // rebuilt from a peer reconnect (not a solo save) — hold ticking
            // until the peer confirms it's ready too; see awaitPeerReady().
            // Deferred to finishMatchIntro() when there's a fly-in to play
            // through first (see pendingReadyOnIntroFinish's doc comment) —
            // sending it now would tell the peer to resume before this side
            // can actually tick again itself.
            if (matchIntro) this.pendingReadyOnIntroFinish = () => this.awaitPeerReady();
            else this.awaitPeerReady();
        }
        if ((this.net && this.side === 'a') || this.star?.role === 'host') this.startSpectatorHub();
        if (this.star) this.wireStar(this.star);
        if (resume && this.star?.role === 'guest' && !resume.local) {
            // fires for BOTH a cold reconnect via the main menu (see the
            // guest session's 'matchCatchUp' handling) and a mid-match
            // Phase 7 full-rebuild resync (rebuildStarGuestGame, always
            // constructed with matchIntro=false so this sends immediately,
            // not deferred — see the branch below) — the host holds this
            // seat suspended until it hears OUR 'ready' either way.
            // hydrate() above already ran to completion synchronously, but
            // see pendingReadyOnIntroFinish's doc comment for why the SEND
            // itself still needs to wait for the fly-in when there IS one,
            // not just the data hydrate.
            const guestSession = this.star.session;
            const sendReady = () => guestSession.send({ type: 'ready' });
            if (matchIntro) this.pendingReadyOnIntroFinish = sendReady;
            else sendReady();
        }
        if (spectate) this.wireSpectateSession(spectate.session);
        // any of the hydrate/replay paths above may already have a non-
        // empty log (resume/spectate) — seed once construction's own
        // catch-up is fully done, not before
        this.seedSeqTracking();

        // Escape toggles the in-game menu (the match keeps running underneath)
        window.addEventListener('keydown', this.onEscapeKey);

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', this.onWindowResize);
        // Compile remaining cold programs (ground + point-light variants, weather,
        // flame tongues) before the first tick — hides the hitch at match start
        // rather than mid-battle. Boot already warmed the shared context when possible.
        this.warmGpuPrograms();
        pixiApp.ticker.add(this.boundTick);
    }

    /**
     * Drive the menu→match camera fly-in. Accelerates into play framing while
     * main fades the menu backdrop; logo is already hidden before this runs.
     */
    private tickMatchIntro(dtSeconds: number): void {
        if (!this.introActive || !this.introFrom || !this.introTo) return;
        this.introElapsed += dtSeconds;
        const t = Math.min(1, this.introElapsed / MATCH_INTRO_SEC);
        // ease-in: slow start matching menu drift, then accelerate into the board
        const e = t * t;
        const a = this.introFrom;
        const b = this.introTo;
        this.rig.setPose({
            x: a.x + (b.x - a.x) * e,
            z: a.z + (b.z - a.z) * e,
            zoom: a.zoom + (b.zoom - a.zoom) * e,
            heading: a.heading + (b.heading - a.heading) * e,
            pitch: a.pitch + (b.pitch - a.pitch) * e,
        });
        this.onMatchIntroProgress?.(t);
        this.maybeRevealIntroCards(t);
        if (t >= 1) this.finishMatchIntro();
    }

    /** fade specialist / round-card pickers in during the fly-in tail */
    private maybeRevealIntroCards(t: number): void {
        if (t < MATCH_INTRO_CARDS_START) return;
        const linear = Math.min(1, (t - MATCH_INTRO_CARDS_START) / (MATCH_INTRO_CARDS_END - MATCH_INTRO_CARDS_START));
        const fade = 1 - (1 - linear) ** 2;
        if (!this.introCardsRevealed) {
            const offer = this.deferredStarterOffer;
            if (offer) {
                this.introCardsRevealed = true;
                this.deferredStarterOffer = null;
                this.showStarterPick(offer, { duringIntro: true });
            } else if (this.deferredRoundOffer && this.pendingOffer) {
                this.introCardsRevealed = true;
                this.deferredRoundOffer = false;
                const pending = this.pendingOffer;
                this.pendingOffer = null;
                this.showRoundOffer(pending, { duringIntro: true });
            }
        }
        this.hud.setCardOverlayIntroOpacity(fade);
    }

    private finishMatchIntro(): void {
        if (!this.introActive) return;
        this.introActive = false;
        // see pendingReadyOnIntroFinish's doc comment — a reconnecting
        // peer's fairness handshake was deferred until the fly-in this
        // just finished, not fired back at construction time
        const sendReady = this.pendingReadyOnIntroFinish;
        this.pendingReadyOnIntroFinish = null;
        sendReady?.();
        if (this.introTo) this.rig.setPose(this.introTo);
        this.introFrom = null;
        this.introTo = null;
        this.controls.enabled = true;
        this.gamepad.enabled = true;
        this.hpBars.view.visible = true;
        const offer = this.deferredStarterOffer;
        const roundOffer = this.deferredRoundOffer;
        this.deferredStarterOffer = null;
        this.deferredRoundOffer = false;
        const pendingRound = roundOffer ? this.pendingOffer : null;
        if (roundOffer) this.pendingOffer = null;
        this.onMatchIntroProgress?.(1);
        const done = this.onMatchIntroDone;
        this.onMatchIntroProgress = null;
        this.onMatchIntroDone = null;
        done?.();
        this.hud.setMatchChromeVisible(true);
        if (!this.introCardsRevealed) {
            if (offer) this.showStarterPick(offer);
            else if (pendingRound) this.showRoundOffer(pendingRound);
        } else {
            this.hud.finishCardOverlayIntro();
        }
    }

    /** reverse of the menu→match fly-in: pull back, then main restores the menu */
    playMenuOutro(onDone: () => void): void {
        if (this.disposed || this.outroActive || this.introActive || this.hydrating) {
            onDone();
            return;
        }
        this.outroActive = true;
        this.outroDone = onDone;
        this.outroElapsed = 0;
        this.controls.enabled = false;
        this.gamepad.enabled = false;
        this.hpBars.view.visible = false;
        this.hud.hideMatchOverlays();
        this.hud.setMatchChromeVisible(false);
        this.outroFrom = this.rig.getPose();
        this.outroTo = {
            ...this.outroFrom,
            zoom: Math.min(this.rig.maxZoom, MATCH_INTRO_ZOOM),
            pitch: MATCH_INTRO_PITCH,
        };
        this.onMatchOutroProgress?.(0);
    }

    private tickMatchOutro(dtSeconds: number): void {
        if (!this.outroActive || !this.outroFrom || !this.outroTo) return;
        this.outroElapsed += dtSeconds;
        const t = Math.min(1, this.outroElapsed / MATCH_OUTRO_SEC);
        // ease-in: accelerate away from the board as the menu cover takes over
        const e = t * t;
        const a = this.outroFrom;
        const b = this.outroTo;
        this.rig.setPose({
            x: a.x + (b.x - a.x) * e,
            z: a.z + (b.z - a.z) * e,
            zoom: a.zoom + (b.zoom - a.zoom) * e,
            heading: a.heading + (b.heading - a.heading) * e,
            pitch: a.pitch + (b.pitch - a.pitch) * e,
        });
        this.onMatchOutroProgress?.(t);
        if (t >= 1) this.finishMatchOutro();
    }

    private finishMatchOutro(): void {
        if (!this.outroActive) return;
        this.outroActive = false;
        if (this.outroTo) this.rig.setPose(this.outroTo);
        this.outroFrom = null;
        this.outroTo = null;
        this.onMatchOutroProgress?.(1);
        const done = this.outroDone;
        this.outroDone = null;
        this.onMatchOutroProgress = null;
        done?.();
    }

    /**
     * Force first-draw of VFX that stay count=0 / hidden until combat or weather,
     * then sync-compile so mid-match first use does not stall the frame.
     * Safe to call again after graphics pref changes (shadows / scenery / fire).
     */
    private warmGpuPrograms(): void {
        this.fireFx.primeForCompile();
        this.projectileRenderer.primeForCompile();
        this.particles.burst(0, 2, 0, { count: 4, color: 0xff6a18, speed: 1, life: 0.2, up: 2 });
        this.particles.burst(0, 2, 0, {
            count: 4,
            color: 0x2c2824,
            speed: 1,
            life: 0.2,
            up: 1,
            blood: true,
        });
        this.particles.update(1 / 60);
        if (shadowUsesBlobs()) {
            this.blobShadows.sync([{ x: 0, z: 0, radius: 1 }]);
        }
        this.weather?.primeForCompile();

        this.renderer.compile(this.scene, this.rig.camera);
        this.renderer.render(this.scene, this.rig.camera);

        // restore live combat VFX — clear would blank an in-progress battle frame
        this.fireFx.clear();
        this.fireFx.setQuality(prefs().fireVfx);
        if (this.sim && this.phase === 'battle') {
            this.fireFx.update(0, this.sim.hazards, this.sim.elapsed);
            this.projectileRenderer.update(this.sim.projectiles, this.sim.alpha);
        } else {
            this.projectileRenderer.clear();
        }
        // snap weather back to the real atmosphere (prime left rain/stars visible)
        if (this.weather) {
            this.scenery.update(0, this.rig.camera.position);
        }
        this.updateBlobShadows();
        // replace the primed frame so the player never sees a flash of rain/flames
        this.renderer.render(this.scene, this.rig.camera);
    }

    /**
     * Live-applies prefs from the settings menu: scenery rebuild, DPR cap,
     * and unit shadow casting. Re-warms GPU programs when graphics tiers change
     * so new shadow/fog/fire variants are compiled before the next combat frame.
     */
    private applyPrefs(): void {
        if (this.disposed) return;
        const p = prefs();
        const gpuDirty =
            p.fireVfx !== this.appliedFireVfx ||
            p.shadows !== this.appliedShadows ||
            p.scenery !== this.appliedScenery ||
            p.groundEffects !== this.appliedGroundEffects ||
            effectiveDpr() !== this.renderer.getPixelRatio();
        // The overlay can flip live; DebugLog.enabled is readonly, so the
        // recorded timeline still follows whatever was set when the match began.
        this.debug?.setEnabled(debugEnabled());
        this.syncDebugDumpButton();
        this.applyRenderPrefs();
        this.applySceneryQuality();
        if (gpuDirty) this.warmGpuPrograms();
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
            // Medium: PCF (cheap 3×3) — BasicShadowMap turned wall acne into
            // crawling zebra stripes as the sun lerped. High/ultra keep soft PCF.
            const type: ShadowMapType =
                tier === 'medium' ? PCFShadowMap : PCFSoftShadowMap;
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
            // Ortho frustum is huge (~texel 0.8wu on medium) so default bias 0
            // self-shadows building walls. Push along the normal by ~half a texel.
            const extent = Math.max(this.map.halfW, this.map.halfH) + 280;
            const texel = (2 * extent) / res;
            this.sun.shadow.bias = -0.0004;
            this.sun.shadow.normalBias = Math.max(0.1, texel * 0.5);
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
        this.gridOverlay = this.map.createOverlayMesh(seatLane(this.seats, this.humanSeat));
        this.gridOverlay.visible = gridVisible;
        this.scene.add(this.gridOverlay);

        // outer world + weather (restore the current atmosphere)
        const weatherSnapshot = this.weather?.snapshot ?? null;
        this.scene.remove(this.scenery.group);
        disposeTree(this.scenery.group);
        this.scenery = new Scenery(this.map);
        this.scene.add(this.scenery.group);
        if (sceneryWeatherFx(scenery)) {
            if (!this.scene.fog) this.scene.fog = new Fog(THEME.sky, THEME.fogNear, THEME.fogFar);
            this.weather = this.scenery.createWeather(
                this.scene,
                this.sun,
                this.hemi,
                this.renderer,
                seedFrom(this.seed, 'weather'),
                this.effectToggles,
            );
            if (weatherSnapshot) this.weather.restore(weatherSnapshot);
            this.scenery.attachSun(this.sun);
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
            this.scenery.attachSun(this.sun);
            this.hemi.intensity = THEME.hemiIntensity;
        }

        // shadow resolution (force the render target to reallocate)
        this.applyShadowQuality();

        this.rig.setWorldFar(sceneryCameraFar(scenery));

        // ground-mist strength is baked into the fog shader chunk — re-bake
        // for the new tier and recompile every fogged material still alive
        // (the rebuilt ground/scenery materials compile fresh anyway)
        this.heightMistBase = sceneryHeightFog(scenery);
        this.applyHeightMistStrength();
        this.enforceCinemaWorld();
    }

    /**
     * `keepStarSession`: used by a full guest-side resync rebuild
     * (`onNeedsFullResync`) — skips touching `this.star.session` AT ALL
     * (neither `.close()` nor `.discard()`), for two different reasons
     * depending on which trigger is rebuilding:
     * - A real reconnect: `this.star.session` here is the OLD, already-dead
     *   pre-redial session — `StarGuestSession`'s own `fireClose()` already
     *   stopped ITS liveness/detached ITS peer-error listener before we
     *   ever got here, so there's nothing left to clean up except
     *   `.close()`'s `peer.destroy()` — which would kill the shared
     *   `Peer` object (see `StarGuestSession`'s own doc comment: `peer`
     *   is reused across every redial) that the brand-new, already-
     *   reconnected session the replacement `Game` is about to use needs.
     * - A hash-mismatch resync (connection never dropped): `this.star.session`
     *   here IS the exact SAME live object the replacement `Game` will keep
     *   using. Calling `.discard()` on it would stop its liveness watchdog
     *   for good — `StarGuestSession`'s watchdog is created once, in its
     *   constructor, never restarted — silently disabling drop detection
     *   on this connection for the rest of the match.
     * Either way the right move is the same: don't call anything on it.
     */
    destroy(opts?: { keepStarSession?: boolean }): void {
        if (this.disposed) return;
        this.disposed = true;
        this.introActive = false;
        this.outroActive = false;
        this.onMatchIntroProgress = null;
        this.onMatchIntroDone = null;
        this.onMatchOutroProgress = null;
        this.outroDone = null;
        this.deferredStarterOffer = null;
        this.deferredRoundOffer = false;
        this.introCardsRevealed = false;
        this.onStateCheckpoint = null;
        this.onSpeedIndexChange = null;
        this.onReturnToMenu = null;
        this.onConnectionLost = null;
        // network/backend teardown FIRST, before any rendering/HUD disposal
        // below — those touch three.js/pixi resources and a stray exception
        // partway through would abort the rest of this function, silently
        // skipping whatever hadn't run yet. Telling the backend "this room
        // is gone" (spectateRegistration.stop → lobbyLeave) is the one thing
        // here with an externally-visible consequence if it's skipped (a
        // room stays listed until its 15s TTL lapses, or indefinitely if the
        // heartbeat interval itself never gets cleared) — it goes first so
        // it always runs regardless of what happens to the rest of this
        // function.
        this.net?.close();
        this.net = null;
        // star (2v2+) connections were never closed here — a real,
        // separate leak from classic 1v1's this.net above, easy to miss
        // since star is its own optional field. keepStarSession skips this
        // whole branch (see its own doc comment on the destroy() signature).
        if (!opts?.keepStarSession) {
            if (this.star?.role === 'host') this.star.hub.close();
            else if (this.star?.role === 'guest') this.star.session.close();
        }
        // stop an in-flight redial from quietly retrying for the rest of its
        // grace window after we've already left — everything it would do on
        // success/failure is separately disposed-guarded either way, this
        // just avoids the pointless background work
        this.starRedialAbort?.abort();
        this.starRedialAbort = null;
        this.spectatorHub?.close();
        this.spectatorHub = null;
        this.spectateRegistration?.stop();
        this.spectateRegistration = null;
        this.spectateSession?.close();
        this.spectateSession = null;
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
        this.conversionFx.dispose();
        this.oilDripFx.dispose();
        this.hordeMarkers.dispose();
        this.strongholdFlags.dispose();
        this.towerDebuffFx.dispose();
        this.stoneChips.dispose();
        this.controls.dispose();
        this.gamepad.dispose();
        this.hud.destroy();
        this.hpBars.destroy();
        this.hpDrawFx.destroy();
        clearScreenShake();
        this.debug.destroy();
        this.debugDumpButton?.destroy();
        this.scene.overrideMaterial = null;
        this.clayOverride.dispose();
        this.wireOverride.dispose();
        this.normalsOverride.dispose();
        for (const node of [...this.pixiApp.canvas.children]) {
            if (node instanceof HTMLElement) node.remove();
        }
        disposeScene(this.scene);
        this.renderer.dispose();
    }

    /**
     * Each side's buildings (anchors shared with BattleMap so the ground
     * relief stays flat underneath). The Stronghold is the shared castle —
     * ONE per side, centered at the back, regardless of seat count: the
     * joint objective both seats on a side defend together. The Command
     * Tower and Research Center instead spawn once per SEAT, each pair
     * confined to that seat's own half-lane (mirrors {@link seatLane}'s
     * left/right split already used for deploy zones), so a 2-seat side
     * gets two independent tower pairs flanking the one shared Stronghold,
     * instead of a single pair both teammates used to share.
     */
    private spawnTowers(): void {
        const { rimCells, flankCols, zoneCols, zoneRows } = this.map.size;
        const ownFar = this.map.ownAtFar;
        const spawnBuilding = (
            xFrac: number,
            rowFrac: number,
            type: UnitType,
            team: Team,
            seat: SeatId,
        ) => {
            const fp = type.footprint;
            const centerRow = Math.round(rimCells + zoneRows * rowFrac - fp.rows / 2);
            const col = rimCells + flankCols + Math.round(zoneCols * xFrac) - Math.floor(fp.cols / 2);
            // the far side's base is the near layout rotated 180°, so each
            // player sees their own buildings laid out the same way locally
            const near = { col, row: centerRow };
            const far = {
                col: this.map.cols - col - fp.cols,
                row: this.map.rows - centerRow - fp.rows,
            };
            const useFar = (team === 'enemy') !== ownFar;
            this.placement.spawn(type, useFar ? far : near, team, false, false, seat);
        };

        spawnBuilding(
            BASE_ANCHORS.stronghold.xFrac,
            BASE_ANCHORS.stronghold.rowFrac,
            STRONGHOLD,
            'player',
            primarySeatOf(this.seats, 'player'),
        );
        spawnBuilding(
            BASE_ANCHORS.stronghold.xFrac,
            BASE_ANCHORS.stronghold.rowFrac,
            STRONGHOLD,
            'enemy',
            primarySeatOf(this.seats, 'enemy'),
        );

        for (const team of ['player', 'enemy'] as const) {
            for (const seat of seatIdsOf(this.seats, team)) {
                const lane = seatLane(this.seats, seat);
                // remap classic full-zone xFrac into seat's lane; in 2v2 (duo), outer
                // towers use outerTowerXFrac (0.17 / 0.83) to pull horizontally closer
                // to the center stronghold while sitting back at outerTowerRowFrac (0.36)
                const resX =
                    lane === 'full'
                        ? BASE_ANCHORS.research.xFrac
                        : lane === 'left'
                          ? BASE_ANCHORS.outerTowerXFrac
                          : 1 - BASE_ANCHORS.outerTowerXFrac;

                const cmdX =
                    lane === 'full'
                        ? BASE_ANCHORS.command.xFrac
                        : lane === 'left'
                          ? BASE_ANCHORS.command.xFrac * 0.5
                          : 0.5 + BASE_ANCHORS.research.xFrac * 0.5;

                const isOuter = (xFrac: number) => lane !== 'full' && (xFrac < 0.25 || xFrac > 0.75);

                const resRow = isOuter(resX) ? BASE_ANCHORS.outerTowerRowFrac : BASE_ANCHORS.research.rowFrac;
                const cmdRow = isOuter(cmdX) ? BASE_ANCHORS.outerTowerRowFrac : BASE_ANCHORS.command.rowFrac;

                spawnBuilding(
                    resX,
                    resRow,
                    RESEARCH_CENTER,
                    team,
                    seat,
                );
                spawnBuilding(
                    cmdX,
                    cmdRow,
                    COMMAND_TOWER,
                    team,
                    seat,
                );
            }
        }
    }

    /**
     * SP cheat (Shift+U): free-spawn every shop-buyable unit type on both sides
     * during deployment, bump HP sky-high, +10000 supply to both seats, +1 of
     * each item and 1 of each test spell for the human (resets uses so they
     * can be placed again), then let the AI re-spend. Ctrl+Shift+U also grants
     * up to 3 new techs per press, spawns horde types, and scrambles pack
     * levels. Enemy moves stay behind intel fog; newly granted enemy packs are
     * snapshotted at land pose.
     */
    private cheatSpawnAllUnits(opts: { scrambleLevels?: boolean; includeHorde?: boolean } = {}): void {
        if (this.phase !== 'build' || this.matchOver) return;

        const CHEAT_HP = 999_999;
        this.playerHp = CHEAT_HP;
        this.enemyHp = CHEAT_HP;
        this.paintHudHp();
        this.cheatGrantSupply(10_000);
        this.cheatGrantAllTactics();
        this.cheatGrantAllItems();
        if (opts.scrambleLevels) this.cheatGrantTechs(3);
        // sidebar intel: enemy bag unchanged by human-only item/tactic grants
        this.captureEnemyIntelSnapshot();
        this.techIntelSnapshot = this.techTree.snapshotOwned();
        this.buildingIntelSnapshot = this.captureBuildingIntelSnapshot();

        const knownEnemy = new Set(
            this.placement.allUnits().filter((u) => u.team === 'enemy').map((u) => u.id),
        );

        for (const team of ['player', 'enemy'] as const) {
            for (const type of UNIT_TYPES) {
                if (type.id === 'shield' || type.id === 'rocket') continue; // extras clutter the test field
                if (!opts.includeHorde && !isPlayerBuyable(type)) continue; // horde roster only on Ctrl+Shift+U
                const copies = type.id === 'dwarf' ? 3 : 1;
                for (let i = 0; i < copies; i++) {
                    const spot = this.placement.findStartSpot(team, type);
                    if (!spot) break;
                    this.placement.spawn(type, spot, team, false, true);
                }
            }
        }

        if (opts.scrambleLevels) {
            // Ctrl+Shift+U: scramble veterancy so level badges / panel LVL differ
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
                        unit.xp = Math.random() < 0.45 ? need : Math.floor(Math.random() * need);
                    } else {
                        unit.xp = 0;
                    }
                }
                unit.refreshLevelBadge();
            }
        }

        // newly granted enemy packs: visible at land pose; later AI moves stay fogged
        for (const unit of this.placement.allUnits()) {
            if (unit.team !== 'enemy' || knownEnemy.has(unit.id)) continue;
            this.placement.rememberIntelPose(unit);
        }

        // AI already locked in at phase start — re-run buys/moves/items/spells/upgrades
        // behind fog (existing packs stay at phase-start pose)
        this.opponent.rerunBuildActions?.();
        for (const e of this.extraAis) e.ai.rerunBuildActions?.();
        console.info(
            `[cheat] Shift+U${opts.scrambleLevels ? ' (Ctrl: horde + levels + techs)' : ''}: supply/items/spawns`,
        );
    }

    /** A new round: place freely, hidden from the opponent, until timer or button. */
    private startBuildPhase(): void {
        // watching: keep whatever playback speed the viewer picked instead
        // of snapping back to 1x every round — nothing live to reset for
        if (!this.watching) this.resetSpeed();
        this.round++;
        this.weather?.onRound(this.round, this.hydrating);
        this.phase = 'build';
        this.phaseRemaining = this.deploySeconds();
        // scars fade each round so the field heals over a few battles
        if (this.round > 1) this.map.fadeWear(0.68);
        this.stoneChips.clear(); // high-setting collapse rubble lives until here
        this.placement.beginDeployment();
        this.placement.enabled = true;
        this.placement.hiddenPlacements = true;
        this.placement.currentRound = this.round; // earlier deployments are locked now
        this.refreshFlightAlts();
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
        // flanks and the middle strip open up after the first round; the outer
        // rim stays undeployable forever
        const unlocked = this.round >= 2;
        if (unlocked !== this.map.flanksUnlocked || unlocked !== this.map.neutralUnlocked) {
            this.map.flanksUnlocked = unlocked;
            this.map.neutralUnlocked = unlocked;
            this.refreshOverlay();
        }
        this.gridOverlay.visible = true;
        // the horde stands on the board from deployment start — both players
        // see the wave and place against it
        this.spawnHordeWave();
        // elite specialists recruit at level 2 permanently (and free of premium)
        for (let seat = 0; seat < this.seats.length; seat++) {
            this.recruitLevel[seat] = this.speciality[seat] === 'elite' ? 2 : 1;
        }
        this.sellState.used.fill(0);
        this.deployState.extra.fill(0);
        this.roundBoosts.range.fill(false);
        this.roundBoosts.speed.fill(false);
        this.creditUsed.fill(false);
        this.deployState.used.fill(0);
        this.deployState.extrasSpent.fill(0);
        this.deployReady.player = false;
        this.deployReady.enemy = false;
        this.seatReady.length = 0;
        for (const _ of this.seats) this.seatReady.push(false);
        this.battleReady.player = false;
        this.battleReady.enemy = false;
        this.starBattleReadySeats.clear();
        // reset here, not inside endBattlePhase's own host branch: a fast
        // guest can report its battleEnd (and hash) before the HOST's own
        // battle even finishes, so clearing starBattleEndChecks there would
        // race and wipe out an already-stashed hash that will never be
        // resent — this is the one point guaranteed to run before ANYONE
        // could possibly report for the round about to start.
        this.starBattleEndChecks.clear();
        this.starBattleEndChecksCompared = false;
        this.unlockUsedThisRound.fill(false);
        this.hud.refreshCosts();
        this.refreshShopHud();
        this.economy.grantRoundIncome(this.round);
        // Command Tower Credit debt from last round — after income so it always covers
        // NOTE: must also run while hydrating (debt is never in the action log)
        const creditDebtAmount = this.settings.deploy.creditDebt;
        for (let seat = 0; seat < this.seats.length; seat++) {
            if (this.creditDebt[seat]) {
                this.economy.debit(seat, creditDebtAmount);
                this.creditDebt[seat] = false;
            }
        }
        // card speciality income and gifts — per SEAT now, own pick, own reward
        for (let seat = 0; seat < this.seats.length; seat++) {
            const team = this.seats[seat]!.team;
            if (this.speciality[seat] === 'costControl') {
                this.economy.credit(seat, COST_CONTROL_INCOME);
            }
            // the elite's round-1 top-up: exactly two level-2 units at 150
            if (this.speciality[seat] === 'elite' && this.round === 1) {
                this.economy.credit(seat, ELITE_ROUND1_BONUS);
            }
            // Money Queen's one-off purse — same log-free round-1 hook
            if (this.speciality[seat] === 'money' && this.round === 1) {
                this.economy.credit(seat, MONEY_ROUND1_BONUS);
            }
            // Cursed Christine: one Komtur spider a round. Log-free, so it
            // must run while hydrating too (see the archer gift's NOTE below)
            // — a peer that skipped the spawn would rebuild a different board
            // with shifted unit ids.
            if (this.speciality[seat] === 'cursed') {
                const brood = unitTypeById(CURSED_BROOD_TYPE_ID);
                const anchor = brood ? this.placement.findStartSpot(team, brood, seat) : null;
                if (brood && anchor) {
                    this.placement.spawn(brood, anchor, team, false, true, seat);
                }
            }
            // a commander's gifted spell charges (Lord Hitzkopf's meteors).
            // Same log-free reasoning as the archer gift below: it must run on
            // every peer, hydrating included, or the two sides disagree about
            // how many charges exist and one accepts a cast the other rejects
            const card = this.starterCardOfSeat(seat);
            if (card?.tactics && this.round === (card.tacticsRound ?? SPECIALITY_TACTIC_ROUND)) {
                this.tacticInventory[seat]!.push(...card.tactics);
            }
            // NOTE: must also run while hydrating — the gift is never in the
            // action log, so a rebuild that skipped it would produce a
            // different board (and shifted unit ids → guaranteed desync)
            if (this.speciality[seat] === 'archer' && this.round === FREE_ARCHER_ROUND) {
                const type = unitTypeById('archer')!;
                const anchor = this.placement.findStartSpot(team, type, seat);
                const unit = anchor ? this.placement.spawn(type, anchor, team, false, true, seat) : null;
                if (unit) {
                    unit.level = FREE_ARCHER_LEVEL;
                    unit.refreshLevelBadge();
                }
            }
        }
        // deliver last round's ally supply gifts — derived straight from the
        // log (no separate pending-transfer state needed): the sender's
        // spend already happened on commit, and by the time the NEXT round
        // starts every client has fully converged on last round's log, so
        // this credit lands identically everywhere regardless of network
        // timing. A gift undone before lock-in never enters the log at all,
        // so there's nothing extra to cancel here.
        if (this.round > 1) {
            for (const team of ['player', 'enemy'] as const) {
                for (const action of this.dispatcher.actionsFor(this.round - 1, team)) {
                    if (action.kind === 'sendSupply') this.economy.credit(action.toSeat, action.amount);
                }
            }
        }
        this.placement.captureIntelSnapshot();
        this.placement.setIntelFog(true);
        this.captureEnemyIntelSnapshot();
        this.techIntelSnapshot = this.techTree.snapshotOwned();
        this.buildingIntelSnapshot = this.captureBuildingIntelSnapshot();
        // burn AFTER intel capture so the enemy fog still shows last round's oven
        this.burnForges();
        // replay applies every action from the log — only run live AI when not rebuilding
        if (!this.hydrating) {
            this.opponent.onBuildPhase(this.round);
            for (const e of this.extraAis) e.ai.onBuildPhase(this.round);
        }

        // between-round cards (schedule owned by roundCardPreset algorithm)
        if (shouldOfferRoundCards(this.settings, this.round)) this.offerRoundCards();
        // cinema mode: startBuildPhase re-shows grid / deploy chrome — put it back away
        this.enforceCinemaWorld();
    }

    /**
     * SP cheat (Shift+U): set each test tactic to exactly {@link CHEAT_TACTIC_COPIES}
     * charges, and clear placements / sell uses / cooling so they can be
     * applied again. Extra presses do not stack beyond the cap. NOT logged —
     * does not survive reload/replay.
     */
    private cheatGrantAllTactics(): void {
        const seat = this.humanSeat;
        const grants = new Set<string>(CHEAT_TACTIC_GRANTS);
        this.cheatResetTacticUses(seat, grants);
        this.tacticInventory[seat] = this.tacticInventory[seat]!.filter((id) => !grants.has(id));
        for (const id of CHEAT_TACTIC_GRANTS) {
            for (let i = 0; i < CHEAT_TACTIC_COPIES; i++) {
                this.tacticInventory[seat]!.push(id);
            }
            // one-shot cooling is derived from the action log — pad so avail
            // still lands at CHEAT_TACTIC_COPIES without rewriting history
            const tactic = TACTICS[id];
            if (!tactic || tactic.kind !== 'oneShot') continue;
            const cooling = this.dispatcher.tacticUseRounds(
                seat,
                id,
                this.round - tactic.cooldownRounds,
            ).length;
            for (let i = 0; i < cooling; i++) this.tacticInventory[seat]!.push(id);
        }
        this.cancelTacticPlacement();
        this.syncTacticVisuals();
    }

    /**
     * Clear human placements / sell-round uses / spell cooldown windows for
     * cheat-granted tactics so Shift+U can hand out fresh usable charges.
     */
    private cheatResetTacticUses(seat: SeatId, grants: ReadonlySet<string>): void {
        this.sellState.used[seat] = 0;

        for (let i = this.rallyRoutes.length - 1; i >= 0; i--) {
            if (this.rallyRoutes[i]!.seat === seat) this.rallyRoutes.splice(i, 1);
        }

        let oilChanged = false;
        for (let i = this.oilStamps.length - 1; i >= 0; i--) {
            if (this.oilStamps[i]!.seat === seat) {
                this.oilStamps.splice(i, 1);
                oilChanged = true;
            }
        }
        if (oilChanged) {
            resetOilFieldToBaseline({
                oilField: this.oilField,
                oilBaseline: this.oilBaseline,
            });
        }

        // this-round stamps block a charge; older ones only grey the strip —
        // drop both for granted ids so every charge is free again
        for (let i = this.spellStamps.length - 1; i >= 0; i--) {
            const s = this.spellStamps[i]!;
            if (s.seat === seat && grants.has(s.tacticId)) this.spellStamps.splice(i, 1);
        }
    }

    /** SP cheat (Shift+U): +supply to every seat (same amount each press). */
    private cheatGrantSupply(amount = 10_000): void {
        for (let seat = 0; seat < this.seats.length; seat++) this.economy.credit(seat, amount);
    }

    /**
     * SP cheat (Shift+U): top up free bag runes (left strip) for the human seat.
     * Base runes fill to {@link CHEAT_BASE_RUNE_COPIES}; advanced/other to
     * {@link CHEAT_ADVANCED_RUNE_COPIES}. Already-applied pack runes are ignored.
     * Extra presses do not stack beyond the caps.
     */
    private cheatGrantAllItems(): void {
        const bag = this.itemInventory[this.humanSeat]!;
        const base = new Set<string>(BASE_RUNE_IDS);
        for (const id of Object.keys(ITEMS)) {
            const max = base.has(id) ? CHEAT_BASE_RUNE_COPIES : CHEAT_ADVANCED_RUNE_COPIES;
            const have = bag.filter((x) => x === id).length;
            for (let i = have; i < max; i++) bag.push(id);
        }
    }

    /**
     * SP cheat (Shift+U): unlock up to `maxPerPress` unowned selected techs for
     * the human seat (across unit types). Press again for the next batch.
     */
    private cheatGrantTechs(maxPerPress = 3): void {
        const seat = this.humanSeat;
        let granted = 0;
        for (const type of UNIT_TYPES) {
            if (type.structure || type.extra) continue;
            for (const tech of techsForUnit(type.id)) {
                if (granted >= maxPerPress) return;
                if (this.techTree.has(seat, type.id, tech.id)) continue;
                this.techTree.add(seat, type.id, tech.id);
                granted++;
            }
        }
    }

    /**
     * SP cheat (Shift+H): spawn this round's authored horde plan into the forest
     * as two camps (same split as a real wave). Build-phase only.
     */
    private cheatSpawnHordePacks(): void {
        if (this.phase !== 'build') {
            console.info('[cheat] Shift+H only works during build phase (battle actors are already fixed)');
            return;
        }
        // Reuse the real wave spawner path by temporarily ensuring the round
        // plan runs even if the preset would skip — spawnHordeWave gates on
        // isHordeRoundActive, so duplicate the camp logic here lightly.
        const plan = hordeWavePlan(Math.max(1, this.round), hordeCountMult(this.settings));
        if (plan.length === 0) return;
        const rng = mulberry32(seedFrom(this.seed, `horde-cheat:${this.round}:${Date.now()}`));
        const leader: Team | null =
            this.playerHp > this.enemyHp ? 'player' : this.enemyHp > this.playerHp ? 'enemy' : null;
        const ownSign = this.map.ownAtFar ? -1 : 1;
        const outerHalfW = this.map.halfW + HORDE_RING_NEAR + HORDE_RING_SPAN;
        const outerHalfH = this.map.halfH + HORDE_RING_NEAR + HORDE_RING_SPAN;
        const leaderSign =
            leader === 'player' ? ownSign : leader === 'enemy' ? -ownSign : ownSign;
        const trailerSign = -leaderSign;
        const bigCamp = this.findHordeRingSpot(rng, leaderSign, outerHalfW, outerHalfH);
        const smallCamp = this.findHordeRingSpot(rng, trailerSign, outerHalfW, outerHalfH);
        const bigShare = leader !== null ? hordeLeaderShare(this.settings) : 0.5;
        let nBig = Math.floor(plan.length * bigShare + 1e-9);
        if (plan.length >= 2) nBig = Math.min(plan.length - 1, Math.max(1, nBig));
        else nBig = plan.length;
        const nSmall = plan.length - nBig;
        let spawned = 0;
        for (let i = 0; i < plan.length; i++) {
            const entry = plan[i]!;
            const camp = i < nBig ? bigCamp : smallCamp;
            const zSign = i < nBig ? leaderSign : trailerSign;
            const campN = i < nBig ? nBig : nSmall;
            const spot =
                (camp && this.findHordeSpotNear(rng, camp, campN)) ??
                this.findHordeRingSpot(rng, zSign, outerHalfW, outerHalfH);
            if (!spot) continue;
            const unit = this.placement.spawnAtWorld(entry.type, spot.x, spot.z);
            unit.summoned = true;
            unit.deployedRound = this.round;
            unit.marchIn = true;
            unit.level = entry.level;
            unit.applyLevelLook(entry.level);
            spawned++;
        }
        console.info(
            `[cheat] Shift+H: spawned ${spawned}/${plan.length} packs in 2 camps (big ${nBig})`,
        );
    }

    /**
     * SP cheat (Shift+I): end the current round and advance — auto-lock
     * deployment if needed, headless-resolve battle, skip HP-draw VFX.
     * Restores both sides to peak (starting) HP so the skip never chips the
     * bar. Solo only (no net / star / watch).
     */
    private cheatSkipRound(): void {
        if (this.net || this.star || this.watching || this.matchOver || this.hydrating) return;
        if (this.introActive || this.outroActive) return;
        const fromRound = this.round;
        const fromPhase = this.phase;
        // Snapshot peaks before any inflate — setters would raise hpPeak.
        const peaks = this.hpPeak.slice();
        const padHp = () => {
            for (let s = 0; s < this.hp.length; s++) {
                this.hp[s] = (peaks[s] ?? 0) + 1_000_000;
            }
        };
        const restoreHp = () => {
            for (let s = 0; s < this.hp.length; s++) {
                this.hp[s] = peaks[s] ?? 0;
            }
            this.hpDrawAfterMatchOver = false;
            this.pendingHpDrawPlan = null;
            this.pendingHpDrawPreHp = null;
            this.paintHudHp();
        };

        if (this.phase === 'hpDraw') {
            restoreHp();
            this.flushHpDrawDisplay();
            this.proceedAfterHpDraw();
            restoreHp();
            console.info(`[cheat] Shift+I: skipped HP draw → round ${this.round}`);
            return;
        }

        if (this.phase === 'build') {
            if (this.round === 0 && !this.starterPicked[this.humanSeat]) {
                this.autoPickSpecialist();
            }
            if (this.awaitingCards) this.autoSkipRoundCard();
            if (this.phase === 'build' && !this.seatReady[this.humanSeat]) {
                this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
            }
            // Solo AI usually already locked in at build start; if not, force it.
            if (this.phase === 'build' && !this.deployReady.enemy) {
                for (const seat of seatIdsOf(this.seats, 'enemy')) {
                    if (this.seatReady[seat]) continue;
                    this.dispatcher.dispatch({ kind: 'endDeployment', team: 'enemy', seat });
                }
                this.maybeStartBattleAfterDeploy();
            }
        }

        if (this.phase === 'battle' && this.sim) {
            // Pad so applyBattleResult can't zero anyone / end the match.
            padHp();
            this.fastForwardBattle();
        }

        restoreHp();

        // Battle end may land on HP-draw VFX — skip straight to next build.
        if ((this.phase as Phase) === 'hpDraw') {
            this.flushHpDrawDisplay();
            this.proceedAfterHpDraw();
            restoreHp();
        }

        console.info(
            `[cheat] Shift+I: ${fromPhase} r${fromRound} → ${this.phase} r${this.round}`,
        );
    }

    /** local player input — refused once this deployment is locked in.
     *  Build actions are buffered until the peer locks in (wire fog). */
    private dispatchPlayer(action: Action): boolean {
        // watch mode: nothing here is "my" input — every action comes from
        // the replay log (see the per-frame paced dispatch). The real guard,
        // not just hidden/disabled UI.
        if (this.watching) return false;
        if (this.seatReady[this.humanSeat] || this.suspended) return false;
        // stamp explicitly: actorSeat's fallback (primarySeatOf(team)) only
        // equals humanSeat when the human is their side's FIRST seat — false
        // for a star guest assigned to seat 1/2/3
        const stamped: Action = action.seat === this.humanSeat ? action : { ...action, seat: this.humanSeat };
        if (!this.dispatcher.dispatch(stamped)) return false;
        if (stamped.kind === 'buyTech' || stamped.kind === 'buy') this.refreshFlightAlts();
        // classic 1v1's starter pick (round 0) goes out via a dedicated
        // 'starter' message instead — this gate stays as-is for it. Star
        // mode never buffers locally (see sendStarBuildMessage), so its
        // own round-0 starter pick is always safe to send immediately.
        if (this.round >= 1 || (this.star && stamped.kind === 'chooseCard')) {
            this.sendPlayerBuildMessage({
                type: 'action',
                round: this.round,
                action: stamped,
                seq: this.nextSeatSeq(this.humanSeat),
            });
        }
        return true;
    }

    /**
     * Seat research plus {@link UnitType.innateTechs} (e.g. Spinne's
     * Mother of Spiders). Used everywhere combat/UI asks "does this pack
     * own tech X?".
     */
    private unitHasTech(seat: SeatId, typeId: string, techId: string): boolean {
        const type = unitTypeById(typeId);
        if (type?.innateTechs?.includes(techId)) return true;
        return seat >= 0 && this.techTree.has(seat, typeId, techId);
    }

    /** Apply Sky Lift / Earthbound to pack hover altitude during deployment. */
    private refreshFlightAlts(): void {
        const has = (seat: SeatId, typeId: string, techId: string) =>
            this.unitHasTech(seat, typeId, techId);
        for (const u of this.placement.allUnits()) {
            if (u.team === 'horde') {
                u.techFlying = null;
                continue;
            }
            const alt = effectiveFlying(u.type, u.seat, has);
            u.techFlying = alt;
            if (alt <= 0) u.flightLift = 0;
            else if (u.type.rocket) u.flightLift = 1;
            u.seatMembers();
        }
    }

    /** our canonical seat on the wire for spectator vision (`'a'` host, `'b'` guest) */
    private localSeat(): 'a' | 'b' {
        return this.side === 'a' ? 'a' : 'b';
    }

    /**
     * The trusted canonical seat of whoever is on the other end of `this.net`
     * — classic 1v1 has exactly one peer, so this is a fixed function of our
     * own side, not something to trust from message *content*. Mirrors why
     * `onStarMessage`'s host path uses the connection-derived `fromSeat`
     * rather than `msg.action.seat` — a message's own claimed seat is never
     * itself proof of who actually sent it.
     */
    private peerSeat(): SeatId {
        return this.side === 'a' ? 1 : 0;
    }

    /** my own seat's canonical side */
    private mySide(): SideId {
        return this.seats[this.humanSeat]?.side ?? 0;
    }

    /**
     * 2-bucket VIEW over the real per-side `hp` array: "mine" vs "everyone
     * else, combined". Exact for today's only shipped case (exactly 2
     * sides — "everyone else" is exactly one side, so summing changes
     * nothing); a deliberately simple placeholder for a hypothetical 3+-
     * side match later (every non-mine side reads as one merged pool, and
     * `enemyHp = v` sets every one of them to `v`) — no mode ships that
     * yet, and this is exactly the "left = mine+allies, right = everyone
     * else" grouping the HUD itself uses.
     */
    private get playerHp(): number {
        return this.hp[this.mySide()] ?? 0;
    }
    private set playerHp(v: number) {
        const side = this.mySide();
        this.hp[side] = v;
        this.hpPeak[side] = Math.max(this.hpPeak[side] ?? 0, v);
    }
    private get enemyHp(): number {
        let sum = 0;
        for (let side = 0; side < this.hp.length; side++) {
            if (side !== this.mySide()) sum += this.hp[side] ?? 0;
        }
        return sum;
    }
    private set enemyHp(v: number) {
        for (let side = 0; side < this.hp.length; side++) {
            if (side !== this.mySide()) {
                this.hp[side] = v;
                this.hpPeak[side] = Math.max(this.hpPeak[side] ?? 0, v);
            }
        }
    }

    /** HUD bar denominator — peak commander HP, not current (damaged) HP. */
    private get playerHpPeak(): number {
        return this.hpPeak[this.mySide()] ?? 0;
    }
    private get enemyHpPeak(): number {
        let sum = 0;
        for (let side = 0; side < this.hpPeak.length; side++) {
            if (side !== this.mySide()) sum += this.hpPeak[side] ?? 0;
        }
        return sum;
    }

    private paintHudHp(): void {
        this.hud.setHp(
            this.phase === 'hpDraw' ? this.hpDrawDisplayPlayer : this.playerHp,
            this.phase === 'hpDraw' ? this.hpDrawDisplayEnemy : this.enemyHp,
            this.playerHpPeak,
            this.enemyHpPeak,
        );
    }

    /**
     * Send a build-phase action/undo. Always sent immediately, on both
     * sides — classic 1v1 no longer withholds its own outgoing build
     * traffic waiting for the peer to lock in (trust-world tradeoff,
     * deferred encryption reintroduces fog here later; see
     * TEAM_MODES_PLAN.md). Durability follows directly: nothing ever sits
     * only in a sender's memory, so a disconnect can only ever lose an
     * action that never left this machine at all.
     */
    private sendPlayerBuildMessage(msg: Extract<NetMessage, { type: 'action' | 'undo' }>): void {
        if (this.star) {
            this.sendStarBuildMessage(msg);
            return;
        }
        this.net?.send(msg);
        this.mirrorBuildToSpectators(msg, this.localSeat());
    }

    /**
     * Shared AiOpponent context builder — used both at construction (every
     * seat that started AI-controlled) and by `takeOverSeatWithAi` (a seat
     * that quit mid-match). Only reads `this.*` fields, so it's safe to
     * call at any point in the match, not just during the constructor.
     */
    private aiCtxFor(rng: () => number): {
        dispatch: (action: Action) => boolean;
        placement: PlacementController;
        economy: Economy;
        techTree: TechTree;
        unlockedUnits: string[][];
        unlockUsedThisRound: boolean[];
        speciality: (SpecialityId | null)[];
        items: string[][];
        tactics: string[][];
        rng: () => number;
    } {
        return {
            dispatch: (action: Action) => {
                const ok = this.dispatcher.dispatch(action);
                if (ok && (action.kind === 'buyTech' || action.kind === 'buy')) this.refreshFlightAlts();
                // star host: an AI seat's actions bypass dispatchPlayer
                // entirely, so relay them here instead — same fog-filtered
                // path as any human seat's traffic
                if (ok && this.star?.role === 'host' && !this.hydrating) {
                    const seat = action.seat ?? this.humanSeat;
                    if (this.round >= 1 || action.kind === 'chooseCard') {
                        this.relayStarBuildMessage(
                            { type: 'action', round: this.round, action, seq: this.nextSeatSeq(seat) },
                            seat,
                        );
                    }
                }
                return ok;
            },
            placement: this.placement,
            economy: this.economy,
            techTree: this.techTree,
            unlockedUnits: this.unlockedUnits,
            unlockUsedThisRound: this.unlockUsedThisRound,
            speciality: this.speciality,
            items: this.itemInventory,
            tactics: this.tacticInventory,
            rng,
        };
    }

    /**
     * Star mode (2v2+): no local sender-side buffering — the HOST does all
     * fog buffering on the way OUT to each recipient (see `StarHub.relayBuild`),
     * so every client just sends immediately. A guest sends straight to the
     * host; the host relays (its own actions AND anything received from a
     * guest) to every other connected seat.
     */
    private sendStarBuildMessage(msg: Extract<NetMessage, { type: 'action' | 'undo' }>): void {
        if (!this.star) return;
        if (this.star.role === 'guest') {
            this.star.session.send(msg);
            return;
        }
        const fromSeat =
            msg.type === 'action' ? (msg.action.seat ?? this.humanSeat) : (msg.seat ?? this.humanSeat);
        this.relayStarBuildMessage(msg, fromSeat);
    }

    /** star host only: relay a just-applied action/undo to every OTHER connected seat */
    private relayStarBuildMessage(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        fromSeat: SeatId,
    ): void {
        if (!this.star || this.star.role !== 'host') return;
        this.star.hub.relayBuild(msg, fromSeat, (side) => this.starSideLocked(side));
        // single choke point for every star seat's build traffic, self- or
        // guest-originated alike — mirrors classic 1v1's two separate
        // mirrorBuildToSpectators call sites (own outgoing + peer incoming)
        // in one place
        this.mirrorBuildToSpectators(msg, this.star.hub.sideOf(fromSeat));
        if (msg.type === 'action' && msg.action.kind === 'endDeployment') this.maybeStartStarBattle();
    }

    /** (star host only) canonical side → local team — seat 0 is always the host */
    private starTeamForCanonicalSide(side: 'a' | 'b'): Team {
        if (this.star?.role !== 'host') return 'player';
        return side === this.star.hub.sideOf(0) ? 'player' : 'enemy';
    }

    /** (star host only) has every seat on this canonical side locked in this round? */
    private starSideLocked(side: 'a' | 'b'): boolean {
        const team = this.starTeamForCanonicalSide(side);
        return seatIdsOf(this.seats, team).every((seat) => this.seatReady[seat]);
    }

    /**
     * Star host: the sole arbiter of when battle starts. Once both sides are
     * fully locked, flush every recipient's fog buffer and broadcast the go
     * signal BEFORE starting locally — PeerJS connections are ordered, so a
     * guest is guaranteed to receive/apply the flushed backlog before it
     * even sees `starBattleStart`, without needing a separate ack round-trip
     * (unlike 1v1's symmetric peers, there's one arbiter here to race against).
     */
    private maybeStartStarBattle(): void {
        if (!this.star || this.star.role !== 'host') return;
        if (this.phase !== 'build' || this.matchOver) return;
        if (!this.deployReady.player || !this.deployReady.enemy) return;
        if (!this.hydrating) {
            this.star.hub.flushAllBuffers();
            this.star.hub.broadcast({ type: 'starBattleStart', round: this.round });
        }
        this.spectatorHub?.flushBuildBuffers();
        this.startBattlePhase();
    }

    /**
     * Host only: once every connected seat's battle-start hash has arrived
     * for this round, warn (console + debugLog) if any of them disagrees
     * with the host's own, AND treat each disagreeing seat exactly like it
     * needs a resync (see checkStarSeq/'starResyncRequest' — a hash
     * mismatch is really just a gap that per-seq tracking failed to catch,
     * e.g. a logic bug rather than a dropped message). A seat that never
     * reports (e.g. it dropped) just never completes the check — harmless,
     * since a drop already pauses the whole match via wireStar's
     * onSeatDropped.
     */
    /**
     * Star host only: the shared sync-barrier comparator, used by BOTH
     * checkpoints (battle-start via `starChecks`, battle-end via
     * `starBattleEndChecks`). Waits for every seat in `expectedSnapshot`
     * (frozen at collection start — see the field's own doc comment —
     * filtered against CURRENT `connectedSeats()` so a drop still correctly
     * shrinks it) to report into `hashes`, then either fast-paths via
     * `resumeIfAllClear()` if this round's comparison already ran once
     * (a recheck — e.g. triggered by a seat dropping mid-collection — must
     * never redo the comparison itself), or does the one-time compare:
     * all-match just calls `resumeIfAllClear()`; a mismatch batches every
     * disagreeing seat's name into ONE low-key `announceSystem` line (not
     * one per seat — stay low-key), adds each to `pendingSyncSeats`, and
     * unicasts each a fresh `matchCatchUp` via the existing
     * `starSeatReconnected` (already UI-agnostic — safe to reuse verbatim
     * for a reason other than a real disconnect). Returns the (possibly
     * now-true) "already compared" flag for the caller to persist.
     */
    private verifyStarSyncBarrier(
        hashes: ReadonlyMap<SeatId, number>,
        expectedSnapshot: readonly SeatId[],
        alreadyCompared: boolean,
    ): boolean {
        if (!this.star || this.star.role !== 'host') return alreadyCompared;
        const connected = new Set(this.star.hub.connectedSeats());
        const expected = expectedSnapshot.filter((s) => s === 0 || connected.has(s));
        if (!expected.every((s) => hashes.has(s))) return alreadyCompared; // still waiting on someone
        if (alreadyCompared) {
            this.resumeIfAllClear();
            return true;
        }
        const mine = hashes.get(0)!;
        const mismatched = expected.filter((s) => hashes.get(s) !== mine);
        if (mismatched.length > 0) {
            console.warn(
                `[mechili] star desync at round ${this.round}: seat(s) ${mismatched.join(', ')} ` +
                    `disagree with the host's own state hash`,
            );
            this.debugLog.log('star.desyncDetected', {
                round: this.round,
                mismatched,
                hashes: Object.fromEntries(hashes),
            });
            const names = mismatched.map((s) => this.seats[s]?.name).filter((n): n is string => !!n);
            if (names.length > 0) this.announceSystem(`Resyncing ${names.join(', ')}…`, names.join(', '));
            for (const seat of mismatched) {
                this.pendingSyncSeats.add(seat);
                this.starSeatReconnected(seat);
            }
        }
        this.resumeIfAllClear();
        return true;
    }

    /**
     * Star host only: re-run whichever sync-barrier comparison(s) are
     * currently outstanding — needed because a seat dropping mid-collection
     * shrinks its frozen `expectedSnapshot` (via the current-connectedSeats
     * filter inside `verifyStarSyncBarrier`), and nothing else would notice
     * that the barrier is now waiting on a hash that will never arrive (see
     * `verifyStarSyncBarrier`'s own doc comment on this stall risk). Safe to
     * call unconditionally, even with no barrier active: a checkpoint that
     * isn't currently collecting has an empty snapshot/hash map, which fails
     * the "did every expected seat report" gate immediately (seat 0 stays in
     * `expected` even then, but is never in an empty hash map) and no-ops.
     * Also safe against a STALE already-resolved checkpoint from the
     * previous round (both `*Compared` flags and their snapshots only reset
     * at the start of the NEXT collection, not right after resolving) — that
     * just re-triggers `resumeIfAllClear()`'s own no-op guard
     * (`pendingStarSeats`/`pendingSyncSeats` empty and not `suspended`), it
     * can't spuriously resume anything.
     */
    private recheckStarSyncBarriers(): void {
        if (!this.star || this.star.role !== 'host') return;
        this.starChecksCompared = this.verifyStarSyncBarrier(
            this.starChecks,
            this.starChecksExpectedSeats,
            this.starChecksCompared,
        );
        this.starBattleEndChecksCompared = this.verifyStarSyncBarrier(
            this.starBattleEndChecks,
            this.starBattleEndChecksExpectedSeats,
            this.starBattleEndChecksCompared,
        );
    }

    /**
     * Battle starts only when both sides have locked in. Classic 1v1 no
     * longer has anything to "catch up" on first — every build action
     * (its own and the peer's) already sent and dispatched the instant it
     * happened, so whatever's arrived by the time both endDeployments land
     * is already everything there is; star mode never needed a wait here
     * either (see sendStarBuildMessage's doc comment).
     */
    private maybeStartBattleAfterDeploy(): void {
        if (this.phase !== 'build' || this.matchOver) return;
        if (!this.deployReady.player || !this.deployReady.enemy) return;
        this.spectatorHub?.flushBuildBuffers();
        this.startBattlePhase();
    }

    /** a specific seat's own chosen specialist card (null until picked) */
    private starterCardOfSeat(seat: SeatId): StartCard | null {
        const spec = this.speciality[seat];
        return spec ? (START_CARDS.find((c) => c.speciality === spec) ?? null) : null;
    }

    /** the side's DISPLAYED specialist card — the primary seat's pick. Every
     *  seat's own card still grants its own army/tactic/effects (per-seat,
     *  see chooseCard); the persistent top-bar label and reveal screen only
     *  have room for one face per side, so this shows the primary's, same
     *  as speciality/HP already work. */
    private starterCardOf(team: Team): StartCard | null {
        return this.starterCardOfSeat(primarySeatOf(this.seats, team));
    }

    /** speciality names under each commander chip — enemy picks stay hidden
     *  until you have picked and every enemy seat has picked */
    private syncSpecialities(): void {
        const humanPicked = this.starterPicked[this.humanSeat];
        const allEnemiesPicked = seatIdsOf(this.seats, 'enemy').every((s) => this.starterPicked[s]);
        this.hud.setSeatSpecialists(
            this.seats.map((_, seat) => {
                const team = this.seats[seat]!.team;
                if (!this.starterPicked[seat]) return { seat, card: null };
                if (team === 'enemy' && !(humanPicked && allEnemiesPicked)) return { seat, card: null };
                return { seat, card: this.starterCardOfSeat(seat) };
            }),
        );
    }

    /** local specialist is locked in — start match once every seat has picked */
    private afterStarterPick(): void {
        this.refreshShopHud();
        this.syncSpecialities();
        this.maybeStartMatch();
    }

    /** the specialist overlay (also re-shown after a resume that predates the pick) */
    private showStarterPick(offer: StartCard[], opts?: { duringIntro?: boolean }): void {
        if (this.introActive && !opts?.duringIntro) {
            this.deferredStarterOffer = [...offer];
            return;
        }
        this.playerStarterOffer = [...offer];
        // the pick has its own short clock — expiry auto-picks at random
        this.phaseRemaining = secondsForRound(this.settings.specialistTimeSeconds, this.round);
        // team modes: everyone still picks their own troops/gear from their
        // own card, but only the side's primary seat's card sets the shared
        // speciality/HP — make that explicit so a non-primary teammate isn't
        // left wondering why their card's speciality didn't "take"
        const allySeats = seatIdsOf(this.seats, 'player').filter((s) => s !== this.humanSeat);
        const note =
            allySeats.length === 0
                ? undefined
                : this.humanSeat === primarySeatOf(this.seats, 'player')
                  ? 'You bring your own troops & gear — and your pick sets the whole side’s speciality.'
                  : `You bring your own troops & gear — ${this.seats[primarySeatOf(this.seats, 'player')]!.name} decides the side's speciality.`;
        this.hud.showStartCards(offer, note, (cardId) => {
            this.playerStarterOffer = null;
            this.dispatchPlayer({ kind: 'chooseCard', team: 'player', cardId });
            this.broadcast({ type: 'starter', cardId, side: this.localSeat() });
            this.opponent.chooseStarter(this.draw(START_CARDS, 4, this.rngCards.enemy));
            this.triggerExtraStarters('player');
            this.triggerExtraStarters('enemy');
            this.afterStarterPick();
        });
    }

    /**
     * Duo modes: once a side's primary seat has picked (human above, or the
     * classic AI just above/below), every OTHER AI seat on that side also
     * picks its own starter card — own army, own lane. The `chooseCard`
     * guard (actions.ts) only lets the side's FIRST pick set shared
     * HP/speciality/items, so repeat picks are side-effect-free there.
     */
    private triggerExtraStarters(team: Team): void {
        for (const e of this.extraAis) {
            if (e.team !== team) continue;
            e.ai.chooseStarter(this.draw(START_CARDS, 4, e.rng));
        }
    }

    /** timer ran out before the player picked a specialist — choose one at random.
     *  Plain Math.random is correct here: the pick is broadcast/logged as an
     *  action, and consuming the seeded card stream for a timing-dependent
     *  event would desync future offers from what a rebuild computes. */
    private autoPickSpecialist(): void {
        if (this.starterPicked[this.humanSeat] || !this.playerStarterOffer?.length) return;
        const pick =
            this.playerStarterOffer[
                Math.floor(Math.random() * this.playerStarterOffer.length)
            ]!;
        this.hud.hideCardOverlay();
        this.playerStarterOffer = null;
        this.dispatchPlayer({ kind: 'chooseCard', team: 'player', cardId: pick.id });
        this.broadcast({ type: 'starter', cardId: pick.id, side: this.localSeat() });
        this.opponent.chooseStarter(this.draw(START_CARDS, 4, this.rngCards.enemy));
        this.triggerExtraStarters('player');
        this.triggerExtraStarters('enemy');
        this.afterStarterPick();
    }

    /** timer ran out during the card-pick clock — skip the offer */
    private autoSkipRoundCard(): void {
        if (this.round < 2 || this.roundCardTaken[this.humanSeat] || !this.awaitingCards) return;
        this.hud.hideCardOverlay();
        this.dispatchPlayer({ kind: 'roundCard', team: 'player', cardId: null });
        this.awaitingCards = false;
    }

    /** build-phase clock hit zero — finish card pick, or lock in deployment */
    private onDeployTimerExpired(): void {
        if (this.round === 0 && !this.starterPicked[this.humanSeat]) {
            this.autoPickSpecialist();
            return;
        }
        if (this.phase !== 'build' || this.seatReady[this.humanSeat]) return;
        // card pick has its own (shorter) clock; when IT expires, auto-skip
        // and start a fresh deploy clock instead of falling straight through
        // to ending deployment with whatever near-zero time is left
        if (this.awaitingCards) {
            this.autoSkipRoundCard();
            this.phaseRemaining = this.deploySeconds();
            return;
        }
        this.dispatchPlayer({ kind: 'endDeployment', team: 'player' });
    }

    // --- spectators (hub is host-only; roster is readable from either side) -

    /** the guest has no hub of its own — it just tracks whatever the host broadcasts */
    private receivedRoster: RosterEntry[] = [];

    /** everyone currently seated at the match, for future UI use — a host
     *  (classic or star) always has the live answer; a guest or spectator
     *  has whatever it was last told */
    roster(): RosterEntry[] {
        if (this.spectateSession) return this.receivedRoster;
        return this.side === 'a' ? this.buildRoster() : this.receivedRoster;
    }

    /** everyone currently seated at the match, for roster display. Classic
     *  1v1 keeps its original two hardcoded entries (no seat model there);
     *  star matches list every seat instead. */
    private buildRoster(): RosterEntry[] {
        const players: RosterEntry[] = this.star
            ? this.seats.map((def, seat) => ({
                  name: seat === this.humanSeat ? this.playerNames.local : def.name,
                  role: 'player' as const,
                  team: def.team,
                  controller: def.controller,
              }))
            : [
                  { name: this.playerNames.local, role: 'player', team: 'player' },
                  { name: this.playerNames.opponent, role: 'player', team: 'enemy' },
              ];
        return [
            ...players,
            ...(this.spectatorHub?.names().map((name) => ({ name, role: 'spectator' as const })) ?? []),
        ];
    }

    /**
     * {name, side, connected} for every human seat — fed to the backend's
     * room list (see registerSpectateEndpoint's snapshot callback) so a menu
     * can recognize the caller's own name among a running match's
     * DISCONNECTED seats and offer "resume" instead of "spectate", without
     * having to connect first. Star-mode-specific (StarHub.connectedSeats
     * is the only thing that actually tracks per-seat connectivity) — a
     * classic 1v1 host just reports every seat connected, since its own
     * reconnect story is the existing localStorage resume marker, not this.
     */
    private backendRosterSnapshot(): RoomRosterEntry[] {
        const hub = this.star?.role === 'host' ? this.star.hub : null;
        const connected = hub ? new Set(hub.connectedSeats()) : null;
        return this.seats
            .map((def, seat) => ({ def, seat }))
            .filter(
                ({ def, seat }) =>
                    def.controller === 'human' ||
                    // a seat AI took over after its original player dropped —
                    // still worth listing (as disconnected) so that player can
                    // find their way back via the room list's existing Resume
                    // UI, same as a seat mid-grace-window already does. A
                    // seat that started AI-controlled (2v2ai bot fill) is
                    // never reclaimable, so it's correctly excluded here.
                    !!hub?.isReclaimable(seat),
            )
            .map(({ def, seat }) => ({
                name: def.name,
                // canonical 'a'/'b' — hub.sideOf is the authoritative source
                // once one exists; classic 1v1 has exactly two seats, host
                // always seat 0/'a'
                side: hub ? hub.sideOf(seat) : seat === 0 ? 'a' : 'b',
                // seat 0 (the host) is never in StarHub's own bySeat map —
                // it's this client, always connected by definition
                connected: seat === 0 || !connected || connected.has(seat),
                aiControlled: !!hub?.isReclaimable(seat),
            }));
    }

    private broadcastRoster(): void {
        this.broadcast({ type: 'roster', entries: this.buildRoster() });
        this.pushSpectatorBadge();
    }

    /** current spectator names, pushed to the persistent topbar badge —
     *  called whenever the roster changes, from whichever side learns of it */
    private pushSpectatorBadge(): void {
        this.hud.setSpectators(
            this.roster()
                .filter((e) => e.role === 'spectator')
                .map((e) => e.name),
        );
    }

    /** sends to the opponent AND mirrors to any connected spectators */
    private broadcast(msg: NetMessage): void {
        this.net?.send(msg);
        if (this.star) {
            if (this.star.role === 'guest') this.star.session.send(msg);
            else this.star.hub.broadcast(msg);
        }
        this.spectateSession?.send(msg);
        this.mirrorToSpectators(msg);
    }

    /** a host-originated announcement (spectator joined/left, a seat
     *  reconnected) — shown locally AND broadcast, via the same 'chat'
     *  channel real chat rides, but rendered with Hud.addSystemMessage
     *  (no sender chip) instead of addChat. `subject` is the relevant
     *  person's name, kept for context/debugging even though a receiver
     *  never treats a `role:'system'` message as something they said. */
    private announceSystem(text: string, subject: string): void {
        this.hud.addSystemMessage(text);
        this.broadcast({ type: 'chat', item: { kind: 'text', text }, from: { name: subject, role: 'system' } });
    }

    /** relays something we already handled (sent OR just received from the
     *  opponent) out to spectators — never echoed back onto `this.net`,
     *  that's the peer who either sent it to us or already has it */
    private mirrorToSpectators(msg: NetMessage): void {
        if (msg.type === 'action' || msg.type === 'undo') {
            // caller should use mirrorBuildToSpectators with an explicit seat
            return;
        }
        this.spectatorHub?.broadcast(msg);
    }

    /**
     * Vision-filtered relay of build action/undo to spectators. Stamps the
     * WIRE-LEVEL `side` onto the message so a spectator watching both real
     * players at once can tell whose action this is without needing to
     * decode a seat number (see onSpectateMessage) — `action.seat`/
     * `undo.seat` are canonical roster indices now (host=0, guest=1 on
     * every client), so this is purely a display-label convenience, not a
     * perspective fix.
     */
    private mirrorBuildToSpectators(
        msg: Extract<NetMessage, { type: 'action' | 'undo' }>,
        seat: 'a' | 'b',
    ): void {
        const bothLocked = this.deployReady.player && this.deployReady.enemy;
        // `action.seat` (and therefore unit ids derived from it) is
        // canonical on every client now — a guest's own seat is a fixed
        // roster index (host=0, guest=1), not "0 = mine" — so a spectator's
        // placement, which agrees with that same canonical numbering,
        // resolves it correctly with no translation. `action.team` is
        // whatever the sender's own local roster calls its side (still
        // "player" for a guest's own actions), but nothing downstream
        // trusts it — every consumer (drainRemoteQueue, drainStarRemoteQueue,
        // drainSpectateQueue) re-derives team fresh from its OWN local
        // `seats[seat].team` before dispatching, keyed by the canonical
        // seat, so a stale sender-perspective team string here is harmless.
        this.spectatorHub?.relayBuild({ ...msg, side: seat }, bothLocked);
    }

    /**
     * Host-only: opens the dedicated spectator broadcast Peer for this
     * match's lifetime — the classic 1v1 host, or (per TEAM_MODES_PLAN §5b)
     * a star host, since `SpectatorHub`/`SpectatorVision` are already
     * side-based, not seat-count-based. Best-effort — if it fails to open
     * (e.g. offline), spectating just isn't available this match; it never
     * blocks or disrupts play, which only ever depends on `this.net`/`this.star`.
     */
    /**
     * Republish "this match is live, watch it here" with the CURRENT round
     * and roster, on whichever discovery channel this match uses.
     *
     * The cloud backend re-reads its snapshot callback on every beat, so the
     * web path was already self-freshening; Steam and LAN publish a one-shot
     * record via `onLiveRoomAd`, so without an explicit republish their room
     * entries kept advertising the round the match STARTED at and a roster
     * from before anyone dropped. Both now update at the same moments —
     * that "resume vs. spectate" decision reads the same in the menu no
     * matter which transport the match is running on.
     */
    private refreshRoomAd(): void {
        this.spectateRegistration?.refreshNow();
        if (this.spectatePeerId === null) return;
        this.onLiveRoomAd?.({
            spectate: this.spectatePeerId,
            round: this.round,
            roster: this.backendRosterSnapshot(),
        });
    }

    private startSpectatorHub(): void {
        void (async () => {
            let hub: SpectatorHub;
            try {
                const log = (category: string, data?: unknown) => this.debugLog.log(category, data);
                // A Steam match spectates over Steam's own P2P, never PeerJS —
                // main.ts supplies that transport; the hub (and every bit of
                // vision/fog logic in it) is the same object either way.
                const transport = await this.onCreateSpectatorTransport?.();
                hub = transport ? SpectatorHub.openWith(transport, log) : await SpectatorHub.open(log);
            } catch {
                // No hub means nobody can watch, but the room must still stop
                // advertising itself as joinable: a transport's ad marks a
                // match as started by carrying a round, and without that a
                // stranger is still offered a seat the host would have to
                // refuse.
                this.onLiveRoomAd?.({
                    spectate: '',
                    round: this.round,
                    roster: this.backendRosterSnapshot(),
                });
                return;
            }
            if (this.disposed || this.matchOver) {
                hub.close();
                return;
            }
            this.spectatorHub = hub;
            this.spectatePeerId = hub.endpoint;
            // Every transport advertises through its OWN discovery channel
            // (Steam lobby data, LAN announce, the cloud backend below) — this
            // is the one that reaches all three.
            this.onLiveRoomAd?.({
                spectate: hub.endpoint,
                round: this.round,
                roster: this.backendRosterSnapshot(),
            });
            // The cloud backend belongs to the WEB transport alone. A LAN host
            // registered there would put their identity on the internet against
            // the whole point of playing on a LAN, and a Steam host would
            // publish a steamId64 under a field the web room list reads as a
            // peer id — an endpoint no web spectator could ever dial anyway.
            // (a classic, non-star 1v1 host is PeerJS by construction)
            const discovery = this.star?.role === 'host' ? this.star.discovery : undefined;
            const usesCloudDiscovery = !this.star || discovery === undefined || discovery === 'matchmaking';
            if (usesCloudDiscovery) {
                this.spectateRegistration = registerSpectateEndpoint(
                    hub.endpoint,
                    this.playerNames.local,
                    // seat COUNT, not `this.star` truthiness — 1v1 is a 2-seat
                    // star match now too, so `this.star` alone can no longer
                    // tell 1v1 and 2v2 apart (repro: room list showed
                    // "watch mangoo (2v2)" for a plain 1v1 room)
                    this.seats.length > 2 ? '2v2' : '1v1',
                    () => ({ roster: this.backendRosterSnapshot(), round: this.round }),
                );
            }
            hub.onRosterChange = () => this.broadcastRoster();
            hub.onSpectatorChat = (name, item) => {
                const relayed: NetMessage = { type: 'chat', item, from: { name, role: 'spectator' } };
                this.net?.send(relayed);
                if (this.star?.role === 'host') this.star.hub.broadcast(relayed);
                hub.broadcast(relayed);
            };
            hub.onSpectatorDebugLog = (events) => this.debugLog.ingest(events);
            hub.onSpectatorJoined = (name) => this.announceSystem(`${name} joined as a spectator.`, name);
            hub.onSpectatorLeft = (name) => this.announceSystem(`${name} stopped spectating.`, name);
            hub.listen((claimedName, version, conn) => {
                if (version !== GAME_VERSION) {
                    conn.send({
                        type: 'spectateRejected',
                        reason: `Version mismatch — this match runs ${formatGameVersion(GAME_VERSION)}, you have ${formatGameVersion(version)}.`,
                    });
                    conn.close();
                    return;
                }
                // disambiguate a duplicate display name among CURRENTLY
                // connected spectators — a player granting live vision
                // (net.ts's SpectatorHub.setSeatLive) can only identify a
                // spectator by this name, matching the FIRST viewer whose
                // name matches; two spectators sharing one name would let
                // either silently receive a grant meant for the other.
                const existingNames = new Set(hub.names());
                let name = claimedName;
                for (let suffix = 2; existingNames.has(name); suffix++) name = `${claimedName} (${suffix})`;
                const vision: SpectatorVision = { mode: 'battle' };
                const resume = this.exportResumeForSpectator(vision);
                this.debugLog.log('vision.admitSnapshot', {
                    name,
                    round: this.round,
                    phase: this.phase,
                    exportedCount: resume.actions.length,
                    exported: resume.actions.map((e) => ({
                        round: e.round,
                        kind: e.action.kind,
                        team: e.action.team,
                        seat: e.action.seat,
                        typeId: (e.action as { typeId?: string }).typeId,
                        unitId: (e.action as { unitId?: number }).unitId,
                    })),
                });
                conn.send({
                    type: 'matchCatchUp',
                    version: GAME_VERSION,
                    ...resume,
                    viewer: { kind: 'spectator', vision },
                });
                hub.admit(name, conn, vision);
                // backfill whatever the snapshot just excluded (already
                // happened before this connection existed, so relayBuild's
                // buffer never saw it) — flushes naturally at the next
                // reveal (see excludedActionsForSpectatorResume). team is
                // reliably canonical in OUR OWN log (host's own entries are
                // 'player', the guest's are 'enemy' — see swapTeams:false
                // in hydrate's doc comment), so it directly gives the side
                // tag onSpectateMessage now expects on every action.
                const excluded = this.excludedActionsForSpectatorResume(vision);
                this.debugLog.log('vision.admitSeed', {
                    name,
                    round: this.round,
                    phase: this.phase,
                    seededCount: excluded.length,
                    seeded: excluded.map((e) => ({
                        kind: e.action.kind,
                        team: e.action.team,
                        round: e.round,
                    })),
                });
                for (const e of excluded) {
                    hub.seedBuildBuffer(conn, {
                        type: 'action',
                        round: e.round,
                        action: e.action,
                        side: e.action.team === 'player' ? 'a' : 'b',
                        // spectators aren't seq-checked (see NetMessage's
                        // 'action' doc comment) — placeholder only
                        seq: 0,
                    });
                }
            });
        })();
    }

    /**
     * Grant or revoke live deploy vision for a spectator, for MY OWN side
     * only (never someone else's — that side's own players consent for
     * themselves). Works for every real player: the classic 1v1 host/guest,
     * a star host (covers its own seat AND any ally on the same side, since
     * vision is side-keyed, not per-seat), and any star guest (ally or
     * enemy) via its own connection to the host.
     */
    grantSpectatorLive(spectatorName: string, grant: boolean): void {
        const seat = this.localSeat();
        if (this.side === 'a' && this.spectatorHub) {
            this.spectatorHub.setSeatLive(spectatorName, seat, grant);
            return;
        }
        // guest asks the host to update vision — a star guest's connection
        // to the host is `this.star.session`, never `this.net` (that field
        // is classic 1v1's own peer-to-peer link, unused in star mode)
        const msg: NetMessage = { type: 'spectateGrant', spectatorName, seat, grant };
        if (this.star?.role === 'guest') this.star.session.send(msg);
        else this.net?.send(msg);
    }

    /** connects (or re-connects) a peer session to this game */
    private wireSession(session: Session): void {
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

    /**
     * Wires the star (2v2+) transport, for either role and every network.
     *
     * A drop is not terminal: the host suspends the seat and pauses EVERY
     * client for `STAR_RECONNECT_GRACE_MS` (beginStarSeatSuspend), the
     * dropped guest redials underneath (beginStarGuestReconnect), and the
     * window ends in either a reclaim (starSeatReconnected) or AI takeover /
     * forfeit (resolveSeatGone). A player who comes back after that can
     * still take their seat off the AI by name (onSeatReclaimedFromAi).
     */
    private wireStar(star: StarRole): void {
        if (star.role === 'guest') {
            this.wireStarGuestSession(star.session);
        } else {
            star.hub.onDebugEvent = (category, data) => this.debugLog.log(category, data);
            star.hub.onMessage = (seat, msg) => this.onStarMessage(msg, seat);
            star.hub.onSeatSuspended = (seat) => {
                // a seat that just explicitly quit (handleSeatQuit already
                // ran) has its own connection close moments later as its
                // client tears down — that's expected, not a drop to wait
                // out
                if (this.quitSeats.has(seat)) return;
                this.beginStarSeatSuspend(seat);
            };
            star.hub.onSeatReconnected = (seat) => this.starSeatReconnected(seat);
            star.hub.onSeatReclaimedFromAi = (seat) => this.reclaimSeatFromAi(seat);
            star.hub.onSeatDropped = (seat) => {
                // the grace window elapsed with nobody reclaiming this seat
                // — resolve it exactly like a voluntary quit (AI takeover,
                // or a forfeit if it was the last human on its side) rather
                // than leaving the other 3 players permanently frozen
                // because one of them never came back
                if (this.quitSeats.has(seat)) return;
                this.resolveSeatGone(seat);
            };
        }
    }

    /** (re)wires a star guest's connection to the host — called at match
     *  start and again after every successful redial, so a second (or
     *  third...) drop is caught exactly the same way as the first */
    private wireStarGuestSession(session: GuestSession): void {
        session.attach((msg) => this.onStarMessage(msg));
        session.onClose = () => this.beginStarGuestReconnect(session);
    }

    /**
     * Star guest only: the connection to the host just dropped. Pauses
     * locally (same shape as classic 1v1's beginReconnectGrace) and redials
     * the SAME host peer id with our own still-alive Peer object for up to
     * STAR_RECONNECT_GRACE_MS (matching StarHub's own grace window on the
     * host — see dropSeat) instead of classic 1v1's page-reload-based
     * resume. Falls back to today's existing terminal suspend() on any
     * failure/timeout/rejection — the fail-safe design used everywhere else
     * in this feature, since there is zero live-testing coverage for it yet.
     */
    private beginStarGuestReconnect(session: GuestSession): void {
        if (this.matchOver || !this.star || this.star.role !== 'guest' || this.star.session !== session) {
            return;
        }
        const star = this.star;
        this.suspended = true;
        this.hud.hidePauseMenu();
        this.placement.deselect();
        this.armedItem = null;
        this.hud.showNotice('Lost connection to the host — reconnecting…', 'Give up', () =>
            this.quitToMenu(),
        );
        const controller = new AbortController();
        this.starRedialAbort = controller;
        const timeout = setTimeout(() => controller.abort(), STAR_RECONNECT_GRACE_MS);
        void session
            .redial(star.mySeat, controller.signal)
            .then(async (fresh) => {
                if (this.matchOver || this.disposed) {
                    fresh.close();
                    return;
                }
                const reply = await fresh.once();
                if (this.matchOver || this.disposed) {
                    fresh.close();
                    return;
                }
                if (reply.type === 'matchCatchUp' && reply.viewer.kind === 'seat') {
                    // hand off to main.ts for a full teardown-and-reconstruct
                    // (Phase 7) — this (about to be destroyed) Game object
                    // does nothing further with `fresh`/`reply` itself; the
                    // "reconnecting…" notice stays up until the replacement
                    // Game takes over the screen, rather than flashing hidden
                    this.onNeedsFullResync?.(fresh, reply);
                } else {
                    fresh.close();
                    if (!this.matchOver) this.suspend('The host rejected our reconnect.');
                }
            })
            .catch(() => {
                if (!this.matchOver) this.suspend('Lost connection to the host.');
            })
            .finally(() => {
                clearTimeout(timeout);
                if (this.starRedialAbort === controller) this.starRedialAbort = null;
            });
    }

    /**
     * After a hydrate/catch-up that skipped `onBuildPhase` (see startBuildPhase's
     * `!hydrating` guard), any local AI seat that still hasn't locked in for
     * the current build must act now. Otherwise a solo (or host-with-AI)
     * resume that lands on a brand-new deployment — log ended at the previous
     * round's endDeployment pair, battle was fast-forwarded, AI never ran —
     * lets the human lock in and then wait forever on an enemy that will
     * never end. Safe no-op when every AI seat is already seatReady (normal
     * mid-deploy resume where the bot's endDeployment is already in the log)
     * or when this client doesn't drive AI (net peer / star guest / watch).
     */
    private ensureLocalAiBuildActions(): void {
        if (this.watching || this.matchOver || this.phase !== 'build') return;
        if (this.star?.role === 'guest') return;

        if (this.opponent instanceof AiOpponent) {
            const seat = primarySeatOf(this.seats, 'enemy');
            if (!this.seatReady[seat]) this.opponent.onBuildPhase(this.round);
        }
        for (const e of this.extraAis) {
            if (!this.seatReady[e.seat]) e.ai.onBuildPhase(this.round);
        }
        this.maybeStartBattleAfterDeploy();
        if (this.star) this.maybeStartStarBattle();
    }

    /** counts, per seat, how many `LoggedAction`s in `log` originated from
     *  that seat — the exact formula `nextSeatSeq`'s stamping agrees with,
     *  PROVIDED `log` is that seat's own complete, unfiltered history (see
     *  `seedSeqTracking`'s own doc comment on why a fog-filtered log breaks
     *  this assumption for a reconnecting seat). */
    private seatActionCounts(log: LoggedAction[]): number[] {
        const counts = new Array<number>(this.seats.length).fill(0);
        for (const entry of log) {
            const seat = entry.action.seat;
            if (seat !== undefined) counts[seat] = (counts[seat] ?? 0) + 1;
        }
        return counts;
    }

    /**
     * (Re)seeds `seatSendSeq`/`lastSeqSeen` from the current log — called
     * once at construction (fresh match: everything zero) and again after
     * any hydrate/replay completes (cold reconnect, live resync), since a
     * resumed log already reflects everything that happened and both
     * counters must resume from exactly that point.
     *
     * Deliberately ALWAYS counts locally, even for a star guest resuming
     * via `matchCatchUp` whose `actions` are fog-filtered (this-round enemy
     * actions withheld until this seat's own side locks — see
     * `actionsForSeatResume`). This is correct, not an approximation: a
     * withheld seat's excluded entries are always a clean, contiguous TAIL
     * of that seat's history (`revealableToViewer`'s round/lock check is
     * all-or-nothing per round — never excludes entry N while including
     * entry N+1 from the same seat), so the local count already lands
     * exactly on "how many I'll have once the withheld tail is later
     * delivered" — which is exactly the TRUE seq of the next entry to
     * arrive (see `excludedActionsForSeatResume`'s seq computation, the
     * same running-count formula). An earlier version of this function took
     * an `authoritative` override sourced from the host's TRUE unfiltered
     * count instead — that seeded `lastSeqSeen` for the withheld seat
     * HIGHER than what had actually been delivered, so the later real
     * delivery (once this seat locked in) looked like a DUPLICATE/stale seq
     * and got rejected via `requestStarResync` — confirmed live (the
     * backfilled content was silently dropped, not just delayed). Reverted;
     * `matchCatchUp` no longer carries `seatSeq`.
     */
    private seedSeqTracking(): void {
        const counts = this.seatActionCounts(this.dispatcher.serializable());
        this.seatSendSeq = counts.slice();
        this.lastSeqSeen = counts.slice();
    }

    /** the next seq to stamp when originating an action/undo for `seat` —
     *  advances the counter as a side effect, so call exactly once per
     *  message actually sent. */
    private nextSeatSeq(seat: SeatId): number {
        this.seatSendSeq[seat] = (this.seatSendSeq[seat] ?? 0) + 1;
        return this.seatSendSeq[seat];
    }

    /** star host only: a seat's connection just dropped — pause the whole
     *  match (same shape as classic 1v1's beginReconnectGrace) but
     *  recoverable: StarHub itself keeps the seat reserved for
     *  STAR_RECONNECT_GRACE_MS, during which a redial reclaims it (see
     *  starSeatReconnected) instead of immediately falling to the terminal
     *  give-up state onSeatDropped uses once the window elapses. */
    private beginStarSeatSuspend(seat: SeatId): void {
        if (this.matchOver || !this.star || this.star.role !== 'host') return;
        // gate on pendingStarSeats itself, NOT this.suspended — a sync
        // barrier (see verifyStarSyncBarrier) can already have this.suspended
        // true with pendingStarSeats empty; a genuine drop happening then
        // must still broadcast the real "X disconnected" pause (with its
        // deadline/notice), since every other client is currently silently
        // barrier-paused and has no idea a real disconnect just happened.
        // Getting this backwards (keying on this.suspended) would silently
        // skip the broadcast and leave every other client frozen with zero
        // explanation for up to the full reconnect grace window.
        const wasPendingEmpty = this.pendingStarSeats.size === 0;
        // only once per drop, not on every liveness-watchdog re-trigger
        // while it's already pending
        if (!this.pendingStarSeats.has(seat)) {
            const name = this.seats[seat]?.name;
            if (name) this.announceSystem(`${name} disconnected — waiting for them to reconnect.`, name);
        }
        this.pendingStarSeats.add(seat);
        this.pendingDropNames = this.computePendingDropNames();
        if (wasPendingEmpty) {
            this.suspended = true;
            this.suspendDeadline = performance.now() + STAR_RECONNECT_GRACE_MS;
            this.lastSuspendNoticeSecond = -1;
            this.hud.hidePauseMenu();
            this.placement.deselect();
            this.armedItem = null;
            // broadcast, not just host-local — every OTHER connected seat
            // needs to pause too (see NetMessage's 'starSync' doc comment
            // for the bug this closes: previously only the host paused,
            // other seats kept ticking through the whole outage)
            this.star.hub.broadcast({
                type: 'starSync',
                suspended: true,
                round: this.round,
                phase: this.phase,
                target: this.starSyncTarget(),
                names: this.pendingDropNames,
            });
        }
        // recompute every time, not just on the first drop — a second seat
        // dropping while already suspended for a different one must not
        // leave the notice naming only the FIRST seat forever
        this.refreshStarSuspendNotice();
        // let the room list reflect this seat as disconnected right away,
        // not up to HEARTBEAT_MS late — someone deciding "resume vs.
        // spectate" from the menu is trusting this to be current
        this.refreshRoomAd();
        // a seat dropping mid-collection shrinks connectedSeats(), which can
        // be exactly the seat a sync barrier is still waiting on — recheck
        // so the barrier doesn't stall forever waiting for a hash that will
        // never arrive (see recheckStarSyncBarriers' own doc comment)
        this.recheckStarSyncBarriers();
    }

    /**
     * Checks an incoming action/undo's per-seat seq against what's
     * expected (see NetMessage's 'action'/'undo' doc comment). Returns
     * true if the caller should proceed normally (queue + drain this
     * message); false means a guest-side gap triggered a resync request
     * instead, and this particular message must be dropped (the resync's
     * full state resend will bring the true picture).
     *
     * A host-side gap is a different, rarer case (see NetMessage's
     * 'starResyncRequest' doc comment on why it isn't auto-recovered): the
     * message is still legitimate content, just unexpectedly numbered, so
     * it's logged and accepted as-is rather than dropped.
     */
    private checkStarSeq(seat: SeatId, seq: number, isHost: boolean): boolean {
        const expected = (this.lastSeqSeen[seat] ?? 0) + 1;
        if (seq === expected) {
            this.lastSeqSeen[seat] = seq;
            return true;
        }
        if (isHost) {
            this.debugLog.log('star.seqGapHostSide', { seat, expected, got: seq });
            this.lastSeqSeen[seat] = seq;
            return true;
        }
        this.requestStarResync(seat, expected, seq);
        return false;
    }

    /**
     * Star guest only: our own seq tracking noticed a gap in what the
     * host relayed — pause locally (same shape as a real disconnect) and
     * ask the host to treat us exactly like a reconnecting seat (see
     * NetMessage's 'starResyncRequest' doc comment): full matchCatchUp
     * resend, resume once we confirm with 'ready'. The `suspended` guard
     * avoids piling up duplicate requests if more gaps are noticed while
     * one resync is already in flight.
     */
    private requestStarResync(seat: SeatId, expected: number, got: number): void {
        if (!this.star || this.star.role !== 'guest' || this.suspended) return;
        this.debugLog.log('star.seqGapDetected', { seat, expected, got });
        this.suspended = true;
        this.hud.hidePauseMenu();
        this.placement.deselect();
        this.armedItem = null;
        this.hud.showNotice('Waiting…', 'Give up', () => this.quitToMenu());
        this.star.session.send({ type: 'starResyncRequest' });
    }

    /** the exact point every seat should sync to right now — phaseRemaining
     *  during build (no per-tick sim to replay), sim.elapsed during battle
     *  (fastForwardBattle can headless-simulate any seat to this exact
     *  point). See NetMessage's 'starSync' doc comment. */
    private starSyncTarget(): number {
        return this.phase === 'battle' ? (this.sim?.elapsed ?? 0) : this.phaseRemaining;
    }

    /** names every currently-pending seat — called on every pendingStarSeats
     *  change while still suspended, so a second seat dropping while
     *  already suspended for a different one doesn't leave the notice
     *  naming only the first. */
    private refreshStarSuspendNotice(): void {
        if (this.pendingStarSeats.size === 0) return;
        this.pendingDropNames = this.computePendingDropNames();
        this.showSuspendNotice();
    }

    /** host only — the names of every seat in `pendingStarSeats` right now,
     *  in wire order for `starSync`'s `names` field. */
    private computePendingDropNames(): string[] {
        return [...this.pendingStarSeats]
            .map((s) => this.seats[s]?.name)
            .filter((n): n is string => !!n);
    }

    /** the "Waiting…" notice, with a live countdown toward
     *  `suspendDeadline` when one is set (a real seat-drop, not a
     *  requestStarResync gap). Re-invoke whenever the displayed second
     *  should change (see the per-frame check in tick()) or the underlying
     *  pending-seat set changes. */
    private showSuspendNotice(): void {
        this.hud.showNotice(this.suspendNoticeText(), 'Give up', () => this.quitToMenu());
    }

    private suspendNoticeText(): string {
        const who = this.pendingDropNames.length > 0 ? this.pendingDropNames.join(', ') : 'Player';
        if (this.suspendDeadline === null) return `${who} disconnected — waiting…`;
        const remainingS = Math.max(0, Math.ceil((this.suspendDeadline - performance.now()) / 1000));
        const time = `${Math.floor(remainingS / 60)}:${String(remainingS % 60).padStart(2, '0')}`;
        return `${who} disconnected — waiting ${time}`;
    }

    /** star host only: the transport reclaimed the seat — send it
     *  everything it missed, but don't unsuspend yet: wait for its own
     *  'ready' (see onStarMessage's 'ready' case / starSeatReady) so a big
     *  catch-up has time to finish applying on their end before the match
     *  ticks again for everyone, same reasoning as classic 1v1's
     *  awaitPeerReady. */
    private starSeatReconnected(seat: SeatId): void {
        if (!this.star || this.star.role !== 'host') return;
        const hub = this.star.hub;
        hub.send(seat, {
            type: 'matchCatchUp',
            version: GAME_VERSION,
            // seed/settings/roster: only load-bearing for a COLD reconnect
            // (see the message's own doc comment) — cheap to always
            // include, an in-session redial just ignores the repeats
            seed: this.seed,
            settings: this.settings,
            roster: this.canonicalRosterSnapshot(),
            actions: this.actionsForSeatResume(seat),
            battleElapsed: this.phase === 'battle' && this.sim ? this.sim.elapsed : null,
            // Only meaningful while WE are in the build phase. A rejoiner
            // replays the log and lands at the start of the next build phase,
            // then adopts this number — so sending our live clock during
            // 'hpDraw' handed them whatever was left of the finished BATTLE.
            // Reloading while the souls were still flying gave a five-second
            // deployment, observed live. Outside build, send the duration the
            // phase they are about to enter actually gets.
            phaseRemaining: this.phase === 'build' ? this.phaseRemaining : this.deploySeconds(),
            viewer: { kind: 'seat', seat },
        });
        // backfill whatever the snapshot just excluded (see
        // excludedActionsForSeatResume's own doc comment for why this is
        // required, not optional)
        for (const { entry, seq } of this.excludedActionsForSeatResume(seat)) {
            hub.seedBuildBuffer(seat, {
                type: 'action',
                round: entry.round,
                action: entry.action,
                side: entry.action.team === 'player' ? 'a' : 'b',
                seq,
            });
        }
        this.refreshRoomAd();
    }

    /** star host only: a reconnected seat confirmed it finished catching up
     *  — un-suspend once every pending seat has done the same */
    private starSeatReady(seat: SeatId): void {
        const name = this.seats[seat]?.name;
        if (name) this.announceSystem(`${name} reconnected.`, name);
        this.pendingStarSeats.delete(seat);
        this.resumeIfAllClear();
    }

    /**
     * Star host only: broadcasts + applies the "everyone may resume" edge
     * once BOTH `pendingStarSeats` (real disconnects) and `pendingSyncSeats`
     * (sync-barrier resyncs, see verifyStarSyncBarrier) are empty — shared
     * by `starSeatReady` (a seat reconnected), `resolveSeatGone` (the grace
     * window elapsed instead, resolved via AI takeover or forfeit), and
     * `verifyStarSyncBarrier`'s own resync path, so none of them can
     * silently skip telling every OTHER connected seat to resume too.
     * Found live: after `resolveSeatGone`'s AI-takeover, the host kept
     * going but other connected guests stayed stuck on the "Waiting…"
     * notice forever (countdown frozen at 0:00), since only
     * `starSeatReady` used to broadcast this — `resolveSeatGone` cleared
     * its OWN `suspended` flag but never told anyone else. This is also
     * the single place that runs `afterSyncResolved` (a sync-barrier
     * checkpoint's deferred follow-up, e.g. finishMatch()/
     * announceBattleEnd()), so the real-disconnect path and the
     * sync-barrier path can never race each other to decide "we may
     * proceed" independently.
     */
    private resumeIfAllClear(): void {
        if (this.matchOver) {
            // the match ended synchronously inside this same call chain
            // (resolveSeatGone -> starForfeit -> dispatch -> onForfeit ->
            // finishMatch, all before this trailing call runs) — nothing
            // left to wait for or resume, just make sure the "Waiting…"
            // notice can't outlive the match. Found live: a grace-window
            // forfeit left a frozen "X disconnected — waiting 0:00" notice
            // sitting on top of the main menu after the match ended.
            this.suspended = false;
            this.suspendDeadline = null;
            this.afterSyncResolved = null;
            this.hud.hideNotice();
            return;
        }
        if (this.pendingStarSeats.size !== 0 || this.pendingSyncSeats.size !== 0 || !this.suspended) {
            // still waiting on at least one more seat — drop the resolved
            // one's name out of the notice instead of leaving it listed
            // (the notice only ever reflects pendingStarSeats — a pure
            // sync-barrier resync never shows one, see verifyStarSyncBarrier)
            if (this.suspended) this.refreshStarSuspendNotice();
            return;
        }
        this.suspended = false;
        this.suspendDeadline = null;
        this.hud.hideNotice();
        // broadcast the resume too, same reasoning as the pause broadcast
        // in beginStarSeatSuspend — every other connected seat needs to
        // un-pause in lockstep, not just the host. Reuses starSyncTarget():
        // disconnect time is always free, so this is the same number the
        // pause broadcast already sent.
        if (this.star?.role === 'host') {
            this.star.hub.broadcast({
                type: 'starSync',
                suspended: false,
                round: this.round,
                phase: this.phase,
                target: this.starSyncTarget(),
                names: [],
            });
        }
        const cont = this.afterSyncResolved;
        this.afterSyncResolved = null;
        cont?.();
    }

    /**
     * Star host only: a connected seat explicitly quit (see onStarMessage's
     * 'quit' case, fired only for a guest — the host's own quit takes a
     * separate path in voluntaryQuit). Hands the seat to AI if its side
     * still has another human playing; otherwise that whole side forfeits,
     * since a side with zero humans left has nobody to keep playing for.
     */
    private handleSeatQuit(seat: SeatId): void {
        if (!this.star || this.star.role !== 'host' || this.matchOver) return;
        this.quitSeats.add(seat);
        this.resolveSeatGone(seat);
    }

    /**
     * Star host only: `seat` is never coming back — either because it
     * explicitly quit (handleSeatQuit) or its reconnect grace window
     * elapsed with nobody reclaiming it (onSeatDropped, once
     * STAR_RECONNECT_GRACE_MS has passed). Same resolution either way: AI
     * takes over if a teammate is still human, otherwise that whole side
     * forfeits — never just leave the match frozen for the other 3
     * players because one of them never came back.
     */
    private resolveSeatGone(seat: SeatId): void {
        if (!this.star || this.star.role !== 'host' || this.matchOver) return;
        this.pendingStarSeats.delete(seat); // in case this seat was mid-reconnect-grace
        // in case this seat was mid-sync-barrier-resync (verifyStarSyncBarrier's
        // pendingSyncSeats.add) — the only other place that clears this set is
        // onStarMessage's 'ready' handler, keyed on a live connection from this
        // seat that will never arrive now. Without this, recheckStarSyncBarriers()
        // below just keeps re-hitting resumeIfAllClear()'s early-return on a
        // pendingSyncSeats entry nothing can ever remove, freezing the whole
        // match for every other connected seat.
        this.pendingSyncSeats.delete(seat);
        const def = this.seats[seat];
        if (!def) return;
        const remainingHumans = seatIdsOf(this.seats, def.team).filter(
            (s) => s !== seat && this.seats[s]?.controller === 'human',
        );
        // NOTE for future refactors: takeOverSeatWithAi can synchronously
        // cascade into a full round transition (markStarBattleReady →
        // startBuildPhase) before this.suspended is cleared a few lines
        // below — currently safe only because nothing reads `suspended`
        // mid-chain (dispatchPlayer, the sole consumer, fires from user
        // input events, which can't interleave with already-running
        // synchronous code) and rendering doesn't happen until the next
        // animation frame, by which point `suspended` is already correctly
        // false. Don't assume that still holds if either function gains a
        // new `suspended` check.
        if (remainingHumans.length > 0) {
            this.takeOverSeatWithAi(seat);
        } else {
            this.starForfeit(def.team);
        }
        // backendRosterSnapshot only lists controller==='human' seats — this
        // seat just left that set (AI takeover) or the whole match ended
        // (forfeit), either of which the room-list "Resume" button depends
        // on knowing promptly: without this, a departed player can still see
        // a stale Resume entry for up to the next periodic heartbeat, which
        // then fails once they actually try to reclaim an AI-driven seat.
        this.refreshRoomAd();
        // this seat was possibly the one thing this.suspended was waiting
        // on — re-check same as starSeatReady does, AND broadcast the
        // resume to every other connected seat (see resumeIfAllClear's own
        // doc comment on the bug this closes)
        this.resumeIfAllClear();
        // same stall-avoidance recheck as beginStarSeatSuspend — this seat
        // leaving connectedSeats() (quit) or losing its grace window can
        // also be exactly what a sync barrier was still waiting on
        this.recheckStarSyncBarriers();
    }

    /**
     * Star host only: converts a quit seat to AI control for the rest of
     * the match — reuses the same AiOpponent already used for seats that
     * started AI-controlled (extraAis), just constructed mid-match instead
     * of at construction time (see aiCtxFor's doc comment).
     */
    private takeOverSeatWithAi(seat: SeatId): void {
        const def = this.seats[seat];
        if (!def || def.controller === 'ai') return;
        this.seats[seat] = { ...def, controller: 'ai' };
        // StarHub's OWN roster (not just this Game's local `this.seats`) has
        // to reflect the takeover too — nextOpenSeat() reads StarHub.roster,
        // not Game.seats, to decide whether a seat is available to hand to
        // a brand-new joiner. Without this, the lobby's join-acceptor
        // (wired once, before the match started, and never torn down —
        // see StarHub.listen()) would keep believing this seat is still
        // an unfilled human slot forever, and once this seat's own dropped
        // connection eventually ages out of bySeat (its reconnect grace
        // window elapsing), nextOpenSeat() would hand the seat to literally
        // any stranger who happens to send starJoin — who'd then receive
        // the full matchCatchUp (this match's entire seed/settings/
        // action log) as if they were the original player.
        if (this.star?.role === 'host') {
            this.star.hub.setRosterEntry(seat, {
                side: this.star.hub.sideOf(seat),
                controller: 'ai',
                name: def.name,
            });
            // lets the ORIGINAL player find their way back later via the
            // room list's existing Resume UI + a name-matched rejoin — see
            // reclaimSeatFromAi/StarHub.markReclaimable's own doc comments.
            this.star.hub.markReclaimable(seat);
        }
        const rng = mulberry32(seedFrom(this.seed, `ai-quit-${seat}-${this.round}`));
        const ai = new AiOpponent(def.team, seat, this.aiCtxFor(rng));
        this.extraAis.push({ ai, rng, team: def.team, seat });
        this.announceSystem(`${def.name} disconnected — AI has taken over.`, def.name);
        this.broadcastRoster();
        this.refreshCommanders();
        // this round's build may already be in progress with nobody left
        // to finish it for this seat — let the AI lock it in right away
        // instead of leaving the round stuck waiting on an endDeployment
        // that will never come
        if (this.round === 0 && !this.starterPicked[seat]) {
            // round 0's specialist pick is its own gate (starterPicked),
            // separate from the normal build-phase lock-in below — a seat
            // that quit before ever picking a card would otherwise leave
            // maybeStartMatch's `starterPicked.every(Boolean)` check false
            // forever, freezing every player at the specialist screen (same
            // follow-up triggerExtraStarters' own caller runs after a human
            // pick — see afterStarterPick).
            ai.chooseStarter(this.draw(START_CARDS, 4, rng));
            this.afterStarterPick();
        } else if (this.phase === 'build' && !this.seatReady[seat]) {
            ai.onBuildPhase(this.round);
        } else if (this.phase === 'battle' && !this.starBattleReadySeats.has(seat)) {
            // same reasoning, one phase later: markStarBattleReady's
            // allReady check treats AI seats as vacuously ready, but that
            // check only actually RUNS when a battleEnd message arrives —
            // if this seat was the one everyone else was waiting on and it
            // just went AI, nothing else is left to trigger the recheck.
            // Force it now instead of leaving the round frozen for the
            // remaining humans.
            this.markStarBattleReady(seat);
        }
    }

    /**
     * Star host only: undoes takeOverSeatWithAi — the seat's ORIGINAL
     * human player just reclaimed it (StarHub matched their rejoin by name
     * against `markReclaimable`, then wired their connection and flipped
     * its roster entry back to human before calling this). Stops the
     * AiOpponent acting for this seat and flips Game's own local seat
     * record back to human; the per-seat economy/army/tech state needs no
     * changes at all — it was never AI-vs-human-specific to begin with, so
     * the reclaiming player simply takes the wheel from wherever the AI
     * left off. No phase restriction: the full catch-up snapshot
     * (starSeatReconnected, reused verbatim below) already carries whatever
     * a reconnecting client needs regardless of build or battle phase.
     */
    private reclaimSeatFromAi(seat: SeatId): void {
        const def = this.seats[seat];
        if (!def || def.controller !== 'ai') return;
        this.seats[seat] = { ...def, controller: 'human' };
        const idx = this.extraAis.findIndex((e) => e.seat === seat);
        if (idx >= 0) this.extraAis.splice(idx, 1);
        // this seat is live again — clear the voluntary-quit marker so a
        // genuine future drop is treated as a real disconnect (grace
        // window + notice), not silently ignored as an already-handled quit
        this.quitSeats.delete(seat);
        // Send the reconnecting seat its resume snapshot FIRST, before any
        // broadcast reaches its (already-wired) connection — confirmed live
        // this order matters: the reclaiming client's join-handshake handler
        // only recognizes a small set of message types before it's fully
        // constructed a Game object, and misreads anything else (e.g. the
        // chat announcement below, sent to every connected seat including
        // this one) as a fatal protocol error, closing the connection
        // instants after accepting it.
        this.starSeatReconnected(seat);
        this.announceSystem(`${def.name} has taken back their seat.`, def.name);
        this.broadcastRoster();
        this.refreshCommanders();
        this.refreshRoomAd();
    }

    /**
     * Star host only: `team`'s side has no humans left — declare its
     * forfeit. Dispatched+logged locally (through the normal action log,
     * so a later resume/catch-up correctly replays it — see
     * ActionContext.onForfeit), but delivered live via a direct, unfiltered
     * broadcast rather than the ordinary fog/round-gated action relay: a
     * match-ending signal must never sit fog-buffered behind the
     * forfeiting side's own lock-in state (relayBuild's ally/enemy vision
     * gate), or queued behind a recipient's currently-displayed round/phase
     * (drainStarRemoteQueue's gate) — both would delay "the match is over"
     * for however long those happen to hold, which is never acceptable for
     * this specific message.
     */
    private starForfeit(team: Team): void {
        if (!this.star || this.star.role !== 'host' || this.matchOver) return;
        this.dispatcher.dispatch({ kind: 'forfeitSide', team });
        this.star.hub.broadcast({ type: 'starForfeit', team });
        this.spectatorHub?.broadcast({ type: 'starForfeit', team });
    }

    /** Wires a spectator's read-only connection to the host. Applies
     *  incoming build actions via its own queue (`spectateQueue`/
     *  `drainSpectateQueue`) — shaped just like `drainStarRemoteQueue` but
     *  kept as a separate copy for its own debug logging. Round-advance
     *  (battle→build) falls out for free from the same organic
     *  `maybeStartNextRound` cascade already used by classic replay-watch —
     *  no need to relay/handle `starBattleStart`/`starNextRound`.
     *  Build→battle just needs both `endDeployment` actions to have
     *  arrived (`maybeStartBattleAfterDeploy`) — every build action, real
     *  players' and this spectator's own copy alike, now sends/arrives
     *  immediately, so there's nothing else left to wait for. */
    /**
     * Replays chat from before this match existed (the lobby — see main.ts's
     * lobby chat) into the match's own chat panel, so a conversation that
     * started while waiting does not vanish the moment everyone is in.
     * Purely presentational: chat is never an action, so nothing here touches
     * game state, the log or determinism.
     */
    seedChatHistory(entries: { name: string; item: ChatItem; role: 'player' | 'system' }[]): void {
        for (const e of entries) {
            if (e.role === 'system') {
                if (e.item.kind === 'text') this.hud.addSystemMessage(e.item.text);
            } else {
                const mine = e.name === (this.watcherName ?? this.playerNames.local);
                this.hud.addChat(e.name, e.item, mine ? 'local' : 'remote');
            }
        }
    }

    private wireSpectateSession(session: SpectatorLink): void {
        this.spectateSession = session;
        session.attach((msg) => this.onSpectateMessage(msg));
        session.onClose = () => {
            if (this.matchOver) return;
            this.matchOver = true;
            this.hud.showDisconnect();
        };
    }

    private onSpectateMessage(msg: NetMessage): void {
        if (this.disposed || this.matchOver) return;
        if (msg.type === 'starter') {
            this.debugLog.log('spectate.recvStarter', {
                side: msg.side,
                myRound: this.round,
                awaitingCards: this.awaitingCards,
            });
            // round 0 specialist pick: the two real players never need a
            // side tag (each just dispatches its OWN pick locally, then
            // hardcodes 'enemy' for whatever it receives — see
            // onNetMessage's 'starter' handling below) — a spectator
            // watching both sides needs msg.side to know which one this is.
            // Explicit canonical `seat` (matching onNetMessage's own fix):
            // actorSeat's team-based fallback resolves the same seat for an
            // immediate dispatch, but that fallback is never persisted onto
            // the logged action — a future re-export of this spectator's
            // own log would silently mislabel this entry without it.
            const team: Team = msg.side === 'b' ? 'enemy' : 'player';
            const seat: SeatId = msg.side === 'a' ? 0 : 1;
            this.dispatcher.dispatch({ kind: 'chooseCard', team, cardId: msg.cardId, seat });
            this.refreshShopHud();
            this.syncSpecialities();
            this.maybeStartMatch();
        } else if (msg.type === 'action') {
            this.debugLog.log('spectate.recvAction', {
                round: msg.round,
                kind: msg.action.kind,
                side: msg.side,
                myRound: this.round,
                myPhase: this.phase,
            });
            // classic 1v1 ONLY: action.seat is perspective-relative ("0 =
            // mine" on EVERY client — see mirrorBuildToSpectators' doc
            // comment), so it can't tell the two real players apart on its
            // own; msg.side (wire-level 'a'/'b') is what actually does. Star
            // (2v2+) seats are already real/canonical (StarHub assigns
            // them), and `side` there is which SIDE (of up to 4 seats), not
            // which seat — using it here would collapse every seat on a
            // side onto just seat 0 or 1, so this stays classic-1v1-only.
            const seat: SeatId =
                this.seats.length === 2 && msg.side
                    ? msg.side === 'a'
                        ? 0
                        : 1
                    : (msg.action.seat ?? primarySeatOf(this.seats, msg.action.team));
            this.spectateQueue.push({ round: msg.round, seat, action: { ...msg.action, seat } });
            this.drainSpectateQueue();
        } else if (msg.type === 'undo') {
            const seat: SeatId =
                this.seats.length === 2 && msg.side ? (msg.side === 'a' ? 0 : 1) : (msg.seat ?? 0);
            this.spectateQueue.push({ round: msg.round, seat, undo: true });
            this.drainSpectateQueue();
        } else if (msg.type === 'roster') {
            this.receivedRoster = msg.entries;
            this.pushSpectatorBadge();
        } else if (msg.type === 'chat') {
            const now = performance.now();
            if (now - this.lastChatReceived < CHAT_COOLDOWN_MS * 0.5) return;
            this.lastChatReceived = now;
            const item: ChatItem =
                msg.item.kind === 'text'
                    ? { kind: 'text', text: String(msg.item.text).slice(0, CHAT_TEXT_LIMIT) }
                    : msg.item;
            if (msg.from.role === 'system') this.hud.addSystemMessage(item.kind === 'text' ? item.text : '');
            else this.hud.addChat(msg.from.name, item, 'remote');
        } else if (msg.type === 'speed') {
            // follow whichever real player's speed message arrives most
            // recently (last write wins) — otherwise a spectator stuck at 1x
            // while both players fast-forward drifts further behind every
            // round. Search `this.speedSteps` (REPLAY_SPEED_STEPS while
            // watching), NOT the
            // real players' own Game.SPEED_STEPS — same multiplier values,
            // different index positions in the two arrays.
            const index = this.speedSteps.indexOf(msg.multiplier);
            if (index >= 0) {
                this.speedIndex = index;
                this.hud.setSpeed(msg.multiplier);
            }
        } else if (msg.type === 'visionUpdate') {
            // this spectator's own vision grants changed — feed it straight
            // to the fog system so already-fogged units (both teams,
            // symmetric while watching — see PlacementController.isFogged)
            // stop being hidden the instant a grant lands, not just once
            // the round's normal both-locked reveal happens
            // side->seat expansion via sideIdsOf, not a hardcoded 'a'->0/
            // 'b'->1 pair — SpectatorVision.seats is side-granular, but a
            // 2v2+ side can have more than one seat (side 'a' = seats
            // {0,1}, side 'b' = seats {2,3} in a standard 2v2 roster). The
            // old hardcoded mapping only ever unfogged the FIRST seat of a
            // granted side, leaving its second seat still fogged despite
            // being granted, and (for a grant to 'b') incorrectly unfogged
            // seat 1 even though that seat is actually still on side 'a'.
            this.placement.spectatorLiveSeats =
                msg.vision.mode === 'live'
                    ? new Set(msg.vision.seats.flatMap((s) => sideIdsOf(this.seats, s === 'a' ? 0 : 1)))
                    : new Set();
        } else if (msg.type === 'quit') {
            // classic 1v1 forfeit-quit, mirrored (see onNetMessage's own
            // 'quit' case) — or a star host's own quit, ending everything
            // (no host migration). Same "match over, nothing left to
            // watch" outcome as a genuine disconnect.
            if (this.matchOver) return;
            this.matchOver = true;
            this.hud.showDisconnect();
        } else if (msg.type === 'starForfeit') {
            // same hp-zeroing + match-over check the forfeiting host and
            // every guest already ran locally — see starForfeit's doc
            // comment for why this is a direct broadcast, not a relayed
            // action
            if (msg.team === 'player') this.playerHp = 0;
            else this.enemyHp = 0;
            if (this.playerHp <= 0 || this.enemyHp <= 0) this.finishMatch();
        }
        // 'check': nothing for a spectator to act on — hash verification is
        // a player-to-player concern only.
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

    /**
     * The player explicitly clicked "Quit to menu" mid-match (pause menu) —
     * distinct from quitToMenu() itself, which is ALSO the generic post-
     * failure "give up" cleanup (dead connection, nothing left to tell).
     * Here the connection is still alive, so tell whoever's on the other
     * end this was deliberate before tearing it down: classic 1v1's peer
     * resolves an immediate forfeit win instead of running the reconnect-
     * grace flow for someone who is never coming back; a star guest tells
     * the host (which decides AI-takeover vs. forfeit — see
     * handleSeatQuit); a star host tells every guest and spectator the
     * whole match is ending (no host migration — nothing can continue
     * without it).
     */
    /**
     * The page is going away — a tab close, a discard, or a RELOAD.
     *
     * Deliberately not voluntaryQuit(): `pagehide` cannot tell a reload from a
     * close, and a reload is precisely the case the resume marker exists for.
     * Reporting it as a quit made the host hand the seat to AI — or, in 1v1
     * where that seat is the side's only human, forfeit it outright, so
     * pressing reload lost the match instantly.
     *
     * A guest therefore just drops its link. The host still sees it at once
     * (a closed connection suspends the seat immediately, rather than waiting
     * out the ~10s liveness watchdog, which was the point of saying goodbye at
     * all) and holds the seat for the grace window, which is long enough to
     * reload into and reclaim.
     *
     * A host, or a classic 1v1 peer, keeps announcing the quit: neither can be
     * resumed after the page goes away, so leaving the other side hoping for a
     * reconnect that can never arrive would be worse than ending it cleanly.
     */
    leaveForPageHide(): void {
        if (this.matchOver || this.disposed) return;
        if (this.star?.role === 'guest') {
            this.star.session.close();
            return;
        }
        this.voluntaryQuit();
    }

    voluntaryQuit(): void {
        if (!this.matchOver && !this.disposed) {
            if (this.net) {
                this.net.send({ type: 'quit' });
            } else if (this.star?.role === 'guest') {
                this.star.session.send({ type: 'quit' });
            } else if (this.star?.role === 'host') {
                this.star.hub.broadcast({ type: 'quit' });
                this.spectatorHub?.broadcast({ type: 'quit' });
            }
        }
        // tell the backend this room is gone right now, explicitly — don't
        // rely solely on destroy() eventually reaching the same call later
        // (it does, but only after a long chain of three.js/HUD disposal
        // that has nothing to do with the network; any exception in there
        // would silently skip this and leave the room listed until its
        // heartbeat's 15s TTL lapses, or indefinitely if the interval
        // itself never gets cleared). Safe to call twice — its own
        // internal guard makes destroy()'s later call a no-op.
        this.spectateRegistration?.stop();
        this.quitToMenu();
    }

    /** leave the match — fly out to the menu, then main tears down the session */
    quitToMenu(): void {
        this.onStateCheckpoint = null;
        // a live "Waiting…" countdown must not survive the player choosing
        // to leave — otherwise tick()'s per-second re-render (see
        // showSuspendNotice's own doc comment) pops the notice right back
        // up on top of the menu-outro animation that's about to play,
        // making the first "Give up" click look like it did nothing (a
        // second click then short-circuits past the now-already-active
        // outro straight to onReturnToMenu, which is what actually worked)
        this.suspended = false;
        this.suspendDeadline = null;
        this.hud.hideNotice();
        this.hud.hideReconnectWait();
        this.net?.close();
        this.net = null;
        if (!this.disposed && !this.outroActive) {
            this.playMenuOutro(() => this.onReturnToMenu?.());
            return;
        }
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
    resumeWith(session: Session): void {
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
                // classic 1v1's own path never seq-checks (see NetMessage's
                // 'action' doc comment) — placeholder only
                seq: 0,
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
            actions: this.actionsForPeerResume(),
            battleElapsed: this.phase === 'battle' && this.sim ? this.sim.elapsed : null,
            phaseRemaining: this.phaseRemaining,
        };
    }

    /** catch-up payload for a spectator under a given vision policy */
    private exportResumeForSpectator(vision: SpectatorVision): {
        seed: number;
        settings: GameSettings;
        roster: CanonicalSeatDef[];
        actions: LoggedAction[];
        battleElapsed: number | null;
        phaseRemaining: number;
    } {
        return {
            seed: this.seed,
            settings: this.settings,
            roster: this.canonicalRosterSnapshot(),
            actions: this.actionsForSpectatorResume(vision),
            battleElapsed: this.phase === 'battle' && this.sim ? this.sim.elapsed : null,
            phaseRemaining: this.phaseRemaining,
        };
    }

    /**
     * Phase C (TEAM_MODES_PLAN.md §3c): the one mode-agnostic canonical
     * roster snapshot, replacing both `starResumeState`'s star-only
     * `this.star.hub.currentRoster()` and `spectateAccepted`'s
     * `buildRoster()` (which mixed in spectator entries this payload never
     * needed — the ongoing `'roster'` broadcast already covers that). Built
     * straight from `this.seats`, which every mode already keeps live-
     * accurate for exactly this data (name/controller/avatar — see
     * takeOverSeatWithAi/reclaimSeatFromAi, both of which update
     * `this.seats` and the hub's own roster together) — so this needs no
     * `this.star`/hub reach-in and works identically for a classic 1v1 host
     * or a star host of any seat count.
     */
    private canonicalRosterSnapshot(): CanonicalSeatDef[] {
        return this.seats.map((s, seat) => ({
            side: s.side === 0 ? 'a' : 'b',
            controller: s.controller,
            // our OWN seat's name always comes from the live playerNames.local,
            // not the possibly-stale `s.name` baked in at construction — same
            // idiom buildRoster()/opponentDisplayName() already use everywhere
            // else a seat's display name is read (a mid-match name edit
            // updates playerNames.local but nothing resyncs `this.seats`)
            name: seat === this.humanSeat ? this.playerNames.local : s.name,
            avatar: s.avatar,
        }));
    }

    /**
     * Peer resume: the peer already sees our build actions live, immediately
     * (trust-world tradeoff — see sendPlayerBuildMessage), so there's
     * nothing left to withhold here either; a reconnecting peer just gets
     * everything it would already have seen had it stayed connected.
     */
    private actionsForPeerResume(): LoggedAction[] {
        return this.dispatcher.serializable();
    }

    /**
     * Phase C (TEAM_MODES_PLAN.md §3c): the one `isRevealable` reveal check
     * shared by every catch-up path below — a reconnecting/resyncing seat
     * (`actionsForSeatResume`) and a freshly-joined spectator
     * (`actionsForSpectatorResume`/`excludedActionsForSpectatorResume`)
     * used to each hand-roll their own filter (a seat-count-agnostic
     * `hub.sideOf`/`starSideLocked` version for seats, a hand-rolled
     * `livePlayer`/`liveEnemy`/"both locked" version for spectators) that
     * happened to compute the same thing two different ways. `e.action.team`
     * is reliable as the from-side tag in OUR OWN log regardless of mode
     * (host's own entries are always 'player', the guest's/other side's
     * always 'enemy' — see hydrate's `swapTeams:false` doc comment, and the
     * matching note at this function's `startSpectatorHub` call site), and
     * `deployReady.player`/`.enemy` is exactly the side-locked aggregate
     * `starSideLocked` also derives from (`seatReady`'s own doc comment:
     * "aggregated into deployReady per side") — so this single mode-
     * agnostic predicate is correct for a star OR classic 1v1 host, with no
     * `this.star`/`hub` reach-in needed at all. Verified equivalent to the
     * three prior implementations branch-by-branch before landing this,
     * including the seat viewer's "reveal enemy once MY side locked"
     * asymmetry `isRevealable` itself documents.
     */
    private revealableToViewer(policy: VisionPolicy): (e: LoggedAction) => boolean {
        return (e) => {
            if (e.round !== this.round) return true;
            const fromSide: 'a' | 'b' = e.action.team === 'player' ? 'a' : 'b';
            return isRevealable(policy, fromSide, (side) =>
                side === 'a' ? this.deployReady.player : this.deployReady.enemy,
            );
        };
    }

    /**
     * Star host only: the resume payload for a reconnecting seat — round 0
     * and any already-completed round are always included unconditionally
     * (see {@link revealableToViewer}), same shape as `actionsForPeerResume`.
     */
    private actionsForSeatResume(seat: SeatId): LoggedAction[] {
        if (!this.star || this.star.role !== 'host') return [];
        const all = this.dispatcher.serializable();
        if (this.phase !== 'build') return all;
        return all.filter(this.revealableToViewer(seatVisionPolicy(this.star.hub.sideOf(seat))));
    }

    /**
     * The exact complement of {@link actionsForSeatResume} — this-round
     * enemy actions excluded from that snapshot because they aren't
     * revealable to `seat` YET (its own side hasn't locked in). Without
     * backfilling these, they're lost forever the instant they DO become
     * revealable: found live (2v2 host+guest on opposing sides) — a guest
     * who disconnected before locking in, during which the host bought more
     * units, reconnected, finished deployment without ever seeing those
     * units, and desynced at battle start. Unlike a spectator, whose
     * `SpectatorHub.relayBuild` buffer never existed until admission,
     * `StarHub`'s per-seat buffer DID exist before the drop — but
     * `StarHub.dropSeat` deliberately clears it on disconnect (nothing
     * live to relay while the connection is down, and stale entries would
     * risk double-delivery once relay resumes), so it's just as empty by
     * reconnect time. Backfilled into that buffer via `StarHub.seedBuildBuffer`
     * (seat-keyed mirror of `SpectatorHub.seedBuildBuffer`), it flushes
     * naturally at the next reveal — this round's own-side lock-in
     * (`relayBuild`'s inline flush) or battle start (`flushAllBuffers`),
     * exactly like a spectator's seeded backlog.
     *
     * Same-side (ally, 2v2+) actions were never affected by this bug:
     * `isRevealable` always reveals a viewer's OWN side unconditionally, so
     * they were never excluded from the initial snapshot in the first
     * place — matching the live report that a same-side host/guest pair
     * saw no problem.
     *
     * Each entry's `seq` is its TRUE position in the seat's full,
     * unfiltered per-seat action count (`seatActionCounts`, same formula
     * `nextSeatSeq` uses to stamp it originally) — matches exactly what the
     * reconnecting seat's own `lastSeqSeen` will expect next, since
     * `seedSeqTracking`'s local count already lands on that same number
     * (see that function's own doc comment for why counting locally is
     * correct here, not an approximation).
     */
    private excludedActionsForSeatResume(seat: SeatId): { entry: LoggedAction; seq: number }[] {
        if (!this.star || this.star.role !== 'host' || this.phase !== 'build') return [];
        const revealable = this.revealableToViewer(seatVisionPolicy(this.star.hub.sideOf(seat)));
        const counts = new Array<number>(this.seats.length).fill(0);
        const excluded: { entry: LoggedAction; seq: number }[] = [];
        for (const entry of this.dispatcher.serializable()) {
            const fromSeat = entry.action.seat;
            if (fromSeat === undefined) continue;
            counts[fromSeat] = (counts[fromSeat] ?? 0) + 1;
            if (!revealable(entry)) excluded.push({ entry, seq: counts[fromSeat] });
        }
        return excluded;
    }

    /**
     * Spectator mid-join: battle vision omits the unfinished build round's
     * actions until both seats locked; live vision includes granted seats.
     */
    private actionsForSpectatorResume(vision: SpectatorVision): LoggedAction[] {
        const all = this.dispatcher.serializable();
        if (this.phase !== 'build') return all;
        return all.filter(this.revealableToViewer(spectatorVisionPolicy(vision)));
    }

    /**
     * The exact complement of {@link actionsForSpectatorResume} — whatever
     * that function excludes from the initial catch-up snapshot because it
     * isn't revealable to this vision policy YET. Without backfilling these,
     * they're lost forever the moment they DO become revealable: unlike a
     * real player (whose peer already has its own copy either way), a
     * spectator's per-connection relay buffer (`SpectatorHub.relayBuild`)
     * only starts accumulating messages relayed from the moment of
     * admission onward — anything that happened strictly before this
     * spectator connected was never buffered for them at all. Seeded into
     * that same buffer at admission time (see `seedBuildBuffer`), these
     * flush naturally the next time `flushBuildBuffers` runs — this
     * round's both-locked reveal, or round 0's specialists resolving.
     */
    private excludedActionsForSpectatorResume(vision: SpectatorVision): LoggedAction[] {
        const all = this.dispatcher.serializable();
        if (this.phase !== 'build') return [];
        const revealable = this.revealableToViewer(spectatorVisionPolicy(vision));
        return all.filter((e) => !revealable(e));
    }

    /**
     * `hydrate()`'s catch-up loop — always replays the FULL log from index 0
     * onto a brand-new `Game` object (safe: `dispatch()` has no idempotency
     * guard, so this must never run on an already-populated dispatcher).
     * Round/phase advance purely as a side effect of
     * `dispatch()`/`fastForwardBattle()` — same mechanics the live 60fps
     * tick uses. Previously also shared with an in-place, non-zero-index
     * "patch the already-live object" resync path (`applyStarResumeState`)
     * — replaced (Phase 7) by tearing down and reconstructing a fresh
     * `Game` through this same `hydrate()` path instead, so that need is
     * gone; kept as a plain full replay rather than a generalized
     * "resume from anywhere" helper, since nothing else needs the latter.
     */
    private replayLogFrom(log: LoggedAction[], liveBattleElapsed: number | null): void {
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
            const dispatchedRound = entry.round;
            this.dispatcher.dispatch(entry.action);
            i++;
            // Star mode's live endDeployment dispatch deliberately does NOT
            // trigger the battle-phase transition itself (see onEndDeployment's
            // ctx callback doc comment — that's maybeStartStarBattle's job,
            // called from the live relay path after broadcasting, to avoid
            // racing starBattleStart ahead of the triggering action). Replay
            // never goes through that relay path at all, so without this call
            // a star-mode hydrate/resume that crosses a battle boundary just
            // silently gets stuck in 'build' at the round the log ran out —
            // confirmed live: a star (1v1-via-star) cold reconnect hydrated to
            // round 1/build despite the host already being in round 2's
            // deployment. Safe unconditionally (including for classic 1v1,
            // where the phase may already have flipped via the dispatch
            // callback): maybeStartBattleAfterDeploy no-ops unless phase is
            // still 'build' AND both sides are actually locked in.
            this.maybeStartBattleAfterDeploy();
            if ((this.phase as Phase) === 'battle') {
                // Older replays (recorded before classic 1v1 sent build
                // actions immediately) can still have a peer's late-
                // buffered buy/move sitting in the log AFTER that same
                // round's own endDeployment pair — the old buffer only
                // flushed once the recipient locked in, after the gate
                // signal itself had already gone out. Hydrate/replay has no
                // live wire signal to wait for (the whole log already
                // exists, frozen) — without this drain,
                // the entry that just flipped the phase would strand every
                // trailing SAME-round entry forever: they're still tagged
                // with the round that just ended, so the loop's own
                // `entry.round !== this.round` guard would refuse them (and
                // everything after) on the very next iteration. Confirmed
                // live: a spectator's hydrate applied only 6 of 12 available
                // log entries this way, running round 2's battle without
                // the enemy's 2 late-bought units and never advancing past
                // it. apply() itself doesn't gate on phase (only dispatchPlayer/
                // drainRemoteQueue's live SEND-time decisions do), so
                // dispatching these now, with phase already 'battle', is
                // exactly as safe as the live host dispatching them earlier
                // while still gated at 'build'.
                while (i < log.length && log[i]!.round === dispatchedRound) {
                    this.dispatcher.dispatch(log[i]!.action);
                    i++;
                }
                // historical battles run to their exact end; the battle the
                // peer is WATCHING right now only catches up to their clock
                const isLiveBattle = i >= log.length && liveBattleElapsed !== null;
                this.fastForwardBattle(isLiveBattle ? liveBattleElapsed : undefined);
            }
        }
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
        // A foreign log (peer export) carries each action's canonical seat
        // (unaffected by whose machine logged it — seat ids are the same on
        // every client), but `team` is a LOCAL label ("player" always means
        // "the exporting peer's own side"). Re-derive team fresh from MY OWN
        // roster, keyed by that canonical seat — the same pattern every
        // other remote-action consumer uses (drainRemoteQueue,
        // drainStarRemoteQueue, drainSpectateQueue). Our own single-player
        // save never needs this: its actions are already in our own local
        // convention.
        const log = swapTeams
            ? sourceLog.map((e) => {
                  const team = this.seats[e.action.seat!]?.team;
                  return team ? { ...e, action: { ...e.action, team } } : e;
              })
            : sourceLog;
        this.debugLog.log('hp.hydrateStart', {
            watching: this.watching,
            swapTeams,
            liveBattleElapsed,
            logLength: log.length,
            log: log.map((e) => ({
                round: e.round,
                kind: e.action.kind,
                team: e.action.team,
                seat: e.action.seat,
                typeId: (e.action as { typeId?: string }).typeId,
                unitId: (e.action as { unitId?: number }).unitId,
            })),
        });
        const starterOffer = this.draw(START_CARDS, 4, this.rngCards.player);
        this.draw(START_CARDS, 4, this.rngCards.enemy);

        this.replayLogFrom(log, liveBattleElapsed);
        this.hydrating = false;
        // startBuildPhase skips AI while hydrating — if we landed on a fresh
        // build phase (log ended at the previous round's lock-ins), kick the
        // local bots now or a solo resume stays stuck after the player locks in
        this.ensureLocalAiBuildActions();
        this.debugLog.log('hp.hydrateDone', {
            watching: this.watching,
            processed: this.dispatcher.serializable().length,
            logLength: log.length,
            round: this.round,
            phase: this.phase,
            playerHp: this.playerHp,
            enemyHp: this.enemyHp,
        });

        // reopen whatever decision was pending when the state was captured —
        // never for a spectator, who has no seat of its own to decide with
        // (this.humanSeat is just an arbitrary display reference for it)
        if (!this.watching && !this.starterPicked[this.humanSeat]) {
            this.showStarterPick(starterOffer);
        } else if (
            !this.watching &&
            this.pendingOffer &&
            !this.roundCardTaken[this.humanSeat] &&
            this.phase === 'build'
        ) {
            this.awaitingCards = true;
            this.phaseRemaining = this.cardSeconds();
            if (this.introActive) {
                this.deferredRoundOffer = true;
            } else {
                this.showRoundOffer(this.pendingOffer);
                this.pendingOffer = null;
            }
        } else {
            this.pendingOffer = null;
        }
        this.hud.refreshCosts();
        this.refreshShopHud();
        this.syncSpecialities(); // restore the fighter-card labels after a rebuild
    }

    /**
     * Watch mode's per-frame build-phase driver: dispatches `replayLog`
     * entries for the current round once their recorded `t` has been
     * reached, using the exact same elapsed-time formula the recorder used
     * (see `clock()`) — reproduces the original pacing, scaled by whatever
     * speed multiplier is active (see the `gameDt` computation in the main
     * tick). Battle phases need no equivalent method: once a dispatched
     * `endDeployment` flips the phase, the normal per-frame `sim.update()`
     * tick already replays it correctly with no special-casing at all.
     */
    private tickReplayPlayback(): void {
        if (!this.replayLog) return;
        const elapsed = Math.max(0, this.phaseBudgetSeconds() - this.phaseRemaining);
        while (this.replayCursor < this.replayLog.length) {
            const entry = this.replayLog[this.replayCursor]!;
            if (entry.round !== this.round || entry.t > elapsed) break;
            const dispatchedRound = entry.round;
            this.dispatcher.dispatch(entry.action);
            this.replayCursor++;
            if ((this.phase as Phase) === 'battle') {
                // Same root cause as replayLogFrom/fastForwardReplayThroughRound:
                // a peer's late-buffered build action (classic 1v1 only) can
                // legitimately sit in the log after that round's own
                // endDeployment pair, timestamped LATER than `elapsed` has
                // reached yet. This function is only ever called while
                // phase==='build' (see tick()'s own caller), so once a
                // dispatch flips it to 'battle' mid-loop, nothing will call
                // this again for this round — any trailing same-round entry
                // still waiting on its own `t` would otherwise never get a
                // second chance and is permanently stranded. Drain them now,
                // ignoring their timestamp: the round is ending regardless.
                while (
                    this.replayCursor < this.replayLog.length &&
                    this.replayLog[this.replayCursor]!.round === dispatchedRound
                ) {
                    this.dispatcher.dispatch(this.replayLog[this.replayCursor]!.action);
                    this.replayCursor++;
                }
                break;
            }
        }
    }

    /**
     * Watch mode only: instantly fast-forwards through the replay log
     * (dispatch + headless battle via fastForwardBattle — no rendering, no
     * pacing) until reaching `target`'s build phase, or the match/log ends
     * first — the latter is exactly what "skip to end" is (call with an
     * unreachably high target: the loop just runs until matchOver or the
     * log is exhausted, headlessly resolving every remaining battle,
     * finishMatch() firing naturally off the same HP<=0 detection it
     * always has). Parallel to hydrate(), not a refactor of it — hydrate()
     * has its own resume-specific concerns (reopening a pending decision)
     * that don't apply to a fresh replay-mode Game instance.
     */
    private fastForwardReplayThroughRound(target: number): void {
        if (!this.replayLog) return;
        while (this.replayCursor < this.replayLog.length && !this.matchOver) {
            if (this.round === target && this.phase === 'build') return;
            const entry = this.replayLog[this.replayCursor]!;
            if (entry.round !== this.round || this.phase !== 'build') break; // shouldn't happen — safety guard
            const dispatchedRound = entry.round;
            this.dispatcher.dispatch(entry.action);
            this.replayCursor++;
            if ((this.phase as Phase) === 'battle') {
                // see replayLogFrom's identical drain — a peer's late-
                // buffered build action (classic 1v1 only) can legitimately
                // sit in the log after that round's own endDeployment pair;
                // without draining it here first, it (and everything after)
                // gets permanently stranded by this loop's own round guard.
                while (
                    this.replayCursor < this.replayLog.length &&
                    this.replayLog[this.replayCursor]!.round === dispatchedRound
                ) {
                    this.dispatcher.dispatch(this.replayLog[this.replayCursor]!.action);
                    this.replayCursor++;
                }
                this.fastForwardBattle();
            }
        }
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
        this.phaseRemaining = this.battleSeconds() - this.sim.elapsed;
        if (toElapsed === undefined) {
            this.endBattlePhase();
        } else {
            // stay in the battle: normal playback continues from here
            this.sim.syncMeshes();
        }
    }

    /**
     * Canonical (cross-client) rank for a seat id: which side it belongs to
     * canonically (host side always ranks first — both peers agree on this
     * regardless of who's asking), then its position among that side's own
     * seats. `SeatId` itself is canonical now (host=0, guest=1 on every
     * client — see the canonicalClassicSeats/localizeRoster construction in the
     * constructor), but this stays a distinct concept: it's a RANK for
     * ordering purposes (sim battle order, stateHash), not just the seat
     * number — needed because a canonical roster can interleave sides by
     * index (e.g. a future N-side mode), so "host side first" isn't
     * automatically true of the raw seat number alone.
     */
    private seatRank(seat: SeatId): number {
        const def = this.seats[seat];
        if (!def) return 0;
        // `def.side` is canonical now (0 = 'a'/host, on every client) — no
        // per-client reordering needed, and this generalizes to N sides
        // for free (side 2 ranks 2000+, etc.), not just today's pair.
        const within = sideIdsOf(this.seats, def.side).indexOf(seat);
        return def.side * 1000 + within;
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
        mix(this.round);
        // model-derived geometry the sim reads (muzzle / aim heights): a peer
        // whose GLB failed to load flies projectiles differently from the same
        // log, so catch it here instead of a round later — see
        // modelGeometryFingerprint
        mix(modelGeometryFingerprint());
        // `hp`/`side` are canonical now (0 = 'a'/host, on every client) — no
        // per-client reordering needed (that's what the old hostFirst/
        // teamOrder tricks existed for), and this iterates however many
        // sides the roster actually has, not just today's pair.
        for (const v of this.hp) mix(v);
        for (let s = 0; s < sideCount(this.seats); s++) {
            for (const seat of sideIdsOf(this.seats, s)) mix(this.economy.balance(seat));
        }
        for (const a of this.sim?.actors ?? []) {
            // canonicalize: the seat's own counter (client-independent —
            // both clients apply the same buy-action stream in the same
            // order) combined with the seat's canonical host/guest rank
            // (perspective-independent by construction, see seatRank)
            const counter = Math.floor(a.unit.id / this.seats.length);
            mix(counter * 2 + (this.seatRank(a.unit.seat) < 1000 ? 0 : 1));
            mix(a.x);
            mix(a.z);
            // facing drives movement now (cruise flies along it, pivot gates on
            // it) and sets the muzzle — freshly seeded at battle start, so a bad
            // seed shows up here rather than as drifted positions next round
            mix(a.facing);
            mix(a.hp);
            // catches a peer disagreeing about who owns the Aegis tech / Bulwark rune
            mix(a.shieldHp);
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

    /**
     * The player may act: build phase, not locked in, match running.
     * Gated on THIS SEAT's own lock-in (`seatReady`), not the whole side's
     * (`deployReady.player`) — those are the same thing for a single-seat
     * side (deployReady flips the instant that one seat locks in), but they
     * diverge the moment a side has >1 seat: your own lock-in happens
     * first, and deployReady stays false until your ally ALSO locks in.
     * Gating on the side-wide flag left every build action open the whole
     * time you were "waiting for ally" — buy, apply items, tactics, undo,
     * all still callable client-side even though you'd told the system
     * you were done. This is the actual server-side rule, not just what
     * the UI hides: relying on hidden buttons alone would leave a modified
     * client free to keep acting after lock-in.
     */
    private get playerCanAct(): boolean {
        return (
            this.phase === 'build' &&
            !this.seatReady[this.humanSeat] &&
            !this.matchOver &&
            !this.suspended &&
            !this.watching
        );
    }

    /** which speed range applies right now — replay gets a much wider one
     *  (see REPLAY_SPEED_STEPS), live matches keep the existing range */
    private get speedSteps(): number[] {
        return this.watching ? Game.REPLAY_SPEED_STEPS : Game.SPEED_STEPS;
    }

    /** the new replay-controls panel's speed <select> calls this directly —
     *  no peer to broadcast to (watching implies no net/star), unlike the
     *  live cycleSpeed() button handler */
    setReplaySpeedIndex(index: number): void {
        if (!this.watching) return;
        this.applySpeedIndex(index);
    }

    private speedShortcutsActive(): boolean {
        return (
            (this.phase === 'battle' || this.watching) &&
            !this.matchOver &&
            !this.suspended &&
            !this.introActive &&
            !this.outroActive
        );
    }

    /** digit key → speedSteps index; null if unmapped for the current range */
    private speedShortcutIndex(digit: number): number | null {
        if (digit >= 1 && digit <= 9) {
            const index = digit - 1;
            return index < this.speedSteps.length ? index : null;
        }
        // reserved: if the ladder ever exceeds 9 steps again, 0 = fastest
        if (digit === 0 && this.watching && this.speedSteps.length > 9) {
            return this.speedSteps.length - 1;
        }
        return null;
    }

    private applySpeedIndex(index: number): void {
        const clamped = Math.max(0, Math.min(index, this.speedSteps.length - 1));
        if (clamped === this.speedIndex) return;
        this.speedIndex = clamped;
        const multiplier = this.speedSteps[clamped]!;
        this.hud.setSpeed(multiplier);
        if (this.watching) {
            this.onSpeedIndexChange?.(clamped);
        } else if (!this.hydrating) {
            this.broadcast({ type: 'speed', multiplier });
        }
    }

    /**
     * Skip Deployment: instantly dispatches every remaining `replayLog`
     * entry for the CURRENT round (ignoring their recorded `t`) — finishes
     * this round's build phase immediately without jumping rounds, so no
     * Game reconstruction is needed (unlike jump-to-round/skip-to-end).
     * The round-card/log dispatch naturally stops once the round's own
     * entries run out (the next entry, if any, belongs to the next round —
     * battle phases carry no logged actions), so no explicit phase check
     * is needed inside the loop.
     */
    skipReplayDeployment(): void {
        if (!this.watching || !this.replayLog || this.phase !== 'build') return;
        while (
            this.replayCursor < this.replayLog.length &&
            this.replayLog[this.replayCursor]!.round === this.round
        ) {
            this.dispatcher.dispatch(this.replayLog[this.replayCursor]!.action);
            this.replayCursor++;
        }
    }

    /**
     * Skip Battle: instantly resolves the current battle phase headlessly
     * (fastForwardBattle already does exactly this at a battle's natural
     * end — sim.update() in a loop, no rendering) and lands on the next
     * round's build phase, or finishMatch() if this was the last battle.
     * A no-op outside battle phase (mirrors skipReplayDeployment's own
     * phase guard, its build-phase counterpart).
     */
    skipReplayBattle(): void {
        if (!this.watching || this.phase !== 'battle') return;
        this.fastForwardBattle();
    }

    /** verify mode's recomputed outcome once the match has ended, for a
     *  caller (bulk verify in main.ts) to compare against the original
     *  without needing the visual game-over note. Null until finishMatch
     *  runs, or always for a non-verify Game. */
    getFinalResult(): { result: MatchResult; rounds: number; playerHp: number; enemyHp: number } | null {
        return this.replayFinalResult;
    }

    /** round 1 begins once EVERY seat has chosen a specialist (a teammate's may lag) */
    private maybeStartMatch(): void {
        if (!this.awaitingCards || this.round > 0) return;
        // every seat now sets its own speciality slot directly (no more
        // shared side-wide value to check) — starterPicked is the correct,
        // and only, per-seat gate. In star mode a non-primary seat is a
        // separate human on a separate machine who can lag behind; without
        // requiring EVERY seat here, round could advance before a
        // teammate's pick has even arrived. Once that happens their
        // chooseCard shows up tagged for the now-past round and
        // drainStarRemoteQueue's FIFO guard strands it — and everything
        // queued behind it — forever (no starter units, no further build
        // actions ever applied for them).
        if (!this.starterPicked.every(Boolean)) return;
        this.awaitingCards = false;
        this.syncSpecialities();
        this.spectatorHub?.flushBuildBuffers();
        // star host only: relayBuild's fog gate for a cross-side chooseCard
        // is starSideLocked (seatReady/endDeployment), which is what round 1
        // build actions correctly wait for — but round 0 has no lock-in
        // concept yet, so that gate never opens on its own here, and a
        // non-primary ally seat (this round's own real bug: the host's
        // teammate, on the SAME side as the host but relayed the ENEMY
        // side's picks cross-side) is stuck buffered behind a condition
        // that can only become true AFTER round 0 already finished for
        // everyone. Force the flush the same moment every seat's pick has
        // actually landed, exactly like the spectator flush just above.
        if (this.star?.role === 'host') this.star.hub.flushAllBuffers();
        this.startBuildPhase();
    }

    private onNetMessage(msg: NetMessage): void {
        if (this.disposed || this.matchOver) return;
        if (msg.type === 'starter') {
            this.mirrorToSpectators(msg);
            // Stamp the trusted, canonical seat explicitly — actorSeat's own
            // team-based fallback (primarySeatOf) resolves it correctly for
            // an immediate dispatch, but that fallback is never persisted
            // onto the logged action (serializable() returns it verbatim).
            // A reconnecting peer's hydrate() later needs a real `seat` here
            // to remap this entry's team into ITS OWN perspective — without
            // it, the remap silently no-ops and the entry keeps OUR
            // perspective's label, crediting the wrong seat's starterPicked
            // flag on their end (repro: reconnect as the side that picked
            // first — you get asked to pick again).
            this.dispatcher.dispatch({ kind: 'chooseCard', team: 'enemy', cardId: msg.cardId, seat: this.peerSeat() });
            this.refreshShopHud();
            this.syncSpecialities();
            this.maybeStartMatch();
        } else if (msg.type === 'action') {
            const side: 'a' | 'b' = this.side === 'a' ? 'b' : 'a';
            // trust the CONNECTION's identity for who this is, never the
            // message's own claimed seat — same reasoning as onStarMessage's
            // host path using `fromSeat` instead of `msg.action.seat`
            this.remoteQueue.push({ round: msg.round, action: msg.action, seat: this.peerSeat() });
            this.drainRemoteQueue();
            // AFTER drain, not before: mirrorBuildToSpectators reads
            // this.deployReady to decide fog (bothLocked) — reading it
            // before the peer's own action is actually dispatched (which
            // is what sets deployReady in the first place) means an
            // action that itself completes "both locked" gets mirrored as
            // still-fogged, one call too early. Relies on
            // maybeStartBattleAfterDeploy's flushBuildBuffers() to eventually
            // correct this either way, but there's no reason to invite that
            // when reordering costs nothing (drainRemoteQueue doesn't mutate
            // `msg`, and `side` is independent of dispatch).
            this.mirrorBuildToSpectators(msg, side);
        } else if (msg.type === 'undo') {
            const side: 'a' | 'b' = this.side === 'a' ? 'b' : 'a';
            this.remoteQueue.push({ round: msg.round, undo: true, seat: this.peerSeat() });
            this.drainRemoteQueue();
            this.mirrorBuildToSpectators(msg, side);
        } else if (msg.type === 'check') {
            this.peerChecks.set(msg.round, msg.hash);
            this.verifyCheck(msg.round);
        } else if (msg.type === 'debugLog') {
            // only the guest ever populates/sends this over `this.net` (the
            // host ingests its own events directly, never over the wire —
            // see DebugLog.log's isHost branch)
            this.debugLog.ingest(msg.events);
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
            } else if (msg.from.role === 'system') {
                if (item.kind === 'text') this.hud.addSystemMessage(item.text);
                this.mirrorToSpectators({ type: 'chat', item, from: msg.from });
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
            this.pushSpectatorBadge();
        } else if (msg.type === 'spectateGrant') {
            // host only: guest may grant/revoke live vision for seat 'b'
            if (this.side !== 'a' || !this.spectatorHub) return;
            if (msg.seat !== 'b') return;
            this.spectatorHub.setSeatLive(msg.spectatorName, msg.seat, msg.grant);
        } else if (msg.type === 'quit') {
            // the peer explicitly quit (see voluntaryQuit) — not a dropped
            // connection, so there's no reconnect grace window to run: they
            // are not coming back, resolve the forfeit immediately. Mirror
            // it so any spectator (a separate connection via spectatorHub,
            // unaffected by the peer's own net closing) finds out too,
            // instead of being left watching a match that's already over.
            this.mirrorToSpectators({ type: 'quit' });
            this.forfeitWin();
        }
    }

    /**
     * Star mode's own message handler, parallel to `onNetMessage` above
     * (which stays exactly as it was for classic 1v1). `fromSeat` is the
     * TRUSTED seat of the connection a message arrived on — only ever
     * present when we're the host (a guest has one pipe to the host and
     * reads the seat straight out of the already-sanitized payload).
     */
    private onStarMessage(msg: NetMessage, fromSeat?: SeatId): void {
        if (this.disposed || this.matchOver || !this.star) return;
        const star = this.star;
        const isHost = star.role === 'host';
        if (msg.type === 'action') {
            // host: stamp the CONNECTION's seat, never the sender's claim.
            // Relay happens AFTER dispatch (inside drainStarRemoteQueue), not
            // here — relaying before applying would read stale seatReady
            // state and could let a battle-start broadcast race ahead of
            // the very action that completed the last lock-in (see there).
            const seat = isHost ? fromSeat! : msg.action.seat!;
            const action = msg.action.seat === seat ? msg.action : { ...msg.action, seat };
            if (this.checkStarSeq(seat, msg.seq, isHost)) {
                this.starRemoteQueue.push({ round: msg.round, seat, action, seq: msg.seq });
                this.drainStarRemoteQueue();
            }
        } else if (msg.type === 'undo') {
            const seat = isHost ? fromSeat! : (msg.seat ?? this.humanSeat);
            if (this.checkStarSeq(seat, msg.seq, isHost)) {
                this.starRemoteQueue.push({ round: msg.round, seat, undo: true, seq: msg.seq });
                this.drainStarRemoteQueue();
            }
        } else if (msg.type === 'debugLog') {
            // only a star guest ever sends this (the host ingests its own
            // events directly, never over the wire)
            if (isHost) this.debugLog.ingest(msg.events);
        } else if (msg.type === 'chat') {
            const now = performance.now();
            if (now - this.lastChatReceived < CHAT_COOLDOWN_MS * 0.5) return;
            this.lastChatReceived = now;
            const item: ChatItem =
                msg.item.kind === 'text'
                    ? { kind: 'text', text: String(msg.item.text).slice(0, CHAT_TEXT_LIMIT) }
                    : msg.item;
            // trust the CONNECTION's seat for an incoming guest message,
            // never the sender's own claimed name/role — without this a
            // guest could impersonate a different player, or claim
            // role:'system' to make its message look like an authoritative
            // host announcement (announceSystem is host-local only, never
            // legitimately relayed FROM a guest). A message that's already
            // been relayed BY the host (isHost false / fromSeat undefined
            // here) was already sanitized once, at the point the host first
            // received it — see the relay below.
            const from =
                isHost && fromSeat !== undefined
                    ? { name: this.seats[fromSeat]?.name ?? msg.from.name, role: 'player' as const }
                    : msg.from;
            if (from.role === 'system') {
                if (item.kind === 'text') this.hud.addSystemMessage(item.text);
            } else {
                this.hud.addChat(from.name, item, 'remote');
            }
            if (isHost && fromSeat !== undefined) {
                const relayed: NetMessage = { type: 'chat', item, from };
                star.hub.broadcast(relayed, fromSeat);
                this.mirrorToSpectators(relayed);
            }
        } else if (msg.type === 'speed') {
            const index = Game.SPEED_STEPS.indexOf(msg.multiplier);
            if (index >= 0) {
                this.speedIndex = index;
                this.hud.setSpeed(msg.multiplier);
            }
            if (isHost && fromSeat !== undefined) {
                star.hub.broadcast(msg, fromSeat);
                this.mirrorToSpectators(msg);
            }
        } else if (msg.type === 'battleEnd') {
            if (isHost && fromSeat !== undefined && msg.round === this.round) {
                if (msg.hash !== undefined) this.starBattleEndChecks.set(fromSeat, msg.hash);
                this.markStarBattleReady(fromSeat);
            }
        } else if (msg.type === 'starNextRound') {
            // the host only ever sends this from finishOrContinueAfterBattle,
            // AFTER its own sync barrier confirmed everyone agrees — so this
            // guest's own HP is now guaranteed correct too. Run the SAME
            // decision locally (finishMatch() vs. proceed) rather than
            // jumping straight to startBuildPhase(): this message doubles as
            // both outcomes' "go" signal (see finishOrContinueAfterBattle's
            // own doc comment on why the host doesn't precompute a verdict).
            // Clears suspended/the notice itself: the generic starSync
            // resume broadcast deliberately no-ops for "sim already null"
            // (see its own doc comment) so THIS is what actually unsuspends
            // for the battle-end checkpoint.
            if (!isHost && msg.round === this.round) {
                this.suspended = false;
                this.suspendDeadline = null;
                this.hud.hideNotice();
                this.finishOrContinueAfterBattle();
            }
        } else if (msg.type === 'starBattleStart') {
            if (!isHost && msg.round === this.round && this.phase === 'build') this.startBattlePhase();
        } else if (msg.type === 'starCheck') {
            // trust the CONNECTION's seat, never the sender's claim — same
            // reasoning as onStarMessage's 'action' handling above. A guest
            // could otherwise send an arbitrary msg.seat and overwrite a
            // DIFFERENT seat's recorded hash, corrupting the N-way
            // desync-detection tally for a seat that isn't even the sender.
            if (isHost && fromSeat !== undefined && msg.round === this.round) {
                this.starChecks.set(fromSeat, msg.hash);
                this.starChecksCompared = this.verifyStarSyncBarrier(
                    this.starChecks,
                    this.starChecksExpectedSeats,
                    this.starChecksCompared,
                );
            }
        } else if (msg.type === 'starSync') {
            // host already applied this locally at the point it broadcast
            // it; every OTHER connected seat (ally, opponent, or the
            // reconnecting seat itself once it's back) reconciles here.
            // Round/phase mismatch means our own catch-up (matchCatchUp
            // for a reconnecting seat) hasn't reached this point yet, or a
            // stale/out-of-order message — either way, nothing to do.
            if (!isHost && msg.round === this.round && msg.phase === this.phase) {
                if (msg.suspended) {
                    this.suspended = true;
                    // silent (sync-barrier checkpoint): every participant
                    // self-suspends symmetrically, nothing to explain — flip
                    // the flag only, no countdown/modal (see NetMessage's
                    // 'starSync' doc comment on `silent`)
                    if (!msg.silent) {
                        this.suspendDeadline = performance.now() + STAR_RECONNECT_GRACE_MS;
                        this.lastSuspendNoticeSecond = -1;
                        this.pendingDropNames = msg.names;
                        this.showSuspendNotice();
                    }
                } else if (msg.phase === 'battle' && !this.sim) {
                    // the battle-end sync-barrier checkpoint (see
                    // endBattlePhase) also resumes through this same
                    // message, but by then every participant's own battle
                    // has ALREADY ended locally (sim already torn down) —
                    // nothing to reconcile here. Deliberately leave
                    // suspended/the notice untouched rather than clearing
                    // them now: that would let a stray tick() run against a
                    // null sim if it happens to land before the real "go"
                    // signal for this checkpoint (the separate
                    // 'starNextRound' message, handled by
                    // finishOrContinueAfterBattle) arrives.
                } else {
                    // reconcile to the exact target rather than just
                    // resuming wherever we happen to be — a seat that was
                    // already correctly paused at this same point no-ops
                    // here (fastForwardBattle's loop/the direct assignment
                    // both do nothing new); this only does real work for a
                    // seat that's behind. A seat that raced slightly AHEAD
                    // of the target before the pause message reached it
                    // (bounded by one network round-trip, not the multi-
                    // second gaps this was built to fix) stays ahead —
                    // accepted, not worth a full sim-rollback mechanism for.
                    if (msg.phase === 'battle') this.fastForwardBattle(msg.target);
                    else this.phaseRemaining = msg.target;
                    this.suspended = false;
                    this.suspendDeadline = null;
                    this.hud.hideNotice();
                }
            }
        } else if (msg.type === 'starResyncRequest') {
            // a guest's own seq tracking noticed a gap in what we relayed —
            // treat it exactly like that seat needing to reconnect (see
            // NetMessage's doc comment): pause everyone, resend full state.
            if (isHost && fromSeat !== undefined) {
                this.beginStarSeatSuspend(fromSeat);
                this.starSeatReconnected(fromSeat);
            }
        } else if (msg.type === 'matchCatchUp' && msg.viewer.kind === 'seat') {
            // only reached here for a LIVE resync (seq gap or hash
            // mismatch) with the connection never actually dropping — a
            // real cold/in-session reconnect instead consumes this via its
            // own one-time read (beginStarGuestReconnect's fresh.once(), or
            // the main-menu cold-reconnect flow) before onStarMessage is
            // ever wired up to receive it, so there's no double-handling.
            // Phase 7: hand off for a full teardown-and-reconstruct rather
            // than patching this object in place — `star.session` here is
            // this SAME still-connected session (nothing dropped), reused
            // as-is by the replacement Game; the 'ready' ack is sent by
            // that replacement's own constructor once it's built.
            if (star.role === 'guest') {
                this.onNeedsFullResync?.(star.session, msg);
            }
        } else if (msg.type === 'roster' && !isHost) {
            // guest-side only: the host is the only one that ever sends this
            // for a star match — mirrors classic 1v1's onNetMessage roster
            // case. Without the !isHost guard, a guest could send a forged
            // 'roster' here and have the HOST overwrite its own
            // this.seats[].controller bookkeeping from it, corrupting
            // downstream host-authoritative logic (forfeit decisions,
            // battle-readiness tallies) that trusts it as ground truth.
            this.receivedRoster = msg.entries;
            this.pushSpectatorBadge();
            // player entries come first, one per seat (see buildRoster) —
            // sync any controller change (a seat quitting mid-match, handed
            // to AI) so our own commander display doesn't go stale (see
            // takeOverSeatWithAi's doc comment on the bug this closes)
            let controllerChanged = false;
            for (let seat = 0; seat < this.seats.length; seat++) {
                const controller = msg.entries[seat]?.controller;
                const current = this.seats[seat];
                if (controller && current && current.controller !== controller) {
                    this.seats[seat] = { ...current, controller };
                    controllerChanged = true;
                }
            }
            if (controllerChanged) this.refreshCommanders();
        } else if (msg.type === 'spectateGrant') {
            // host only: ANY seat may grant/revoke live vision for its own
            // side — trust the CONNECTION-derived side (fromSeat), never
            // msg.seat itself; a guest's own claimed side is not proof of
            // which side it's actually on, same reasoning as onStarMessage's
            // 'action' handling above.
            if (!isHost || fromSeat === undefined || !this.spectatorHub) return;
            const side = star.hub.sideOf(fromSeat);
            this.spectatorHub.setSeatLive(msg.spectatorName, side, msg.grant);
        } else if (msg.type === 'ready') {
            // host only: a seat finished applying its matchCatchUp
            // catch-up. Two INDEPENDENT checks, not else-if: a seat can be
            // in both pendingStarSeats (real reconnect) AND pendingSyncSeats
            // (a sync-barrier resync) at once — e.g. a genuine drop
            // happening while a barrier-triggered resync for it was already
            // in flight — and each needs its own resolution/announcement.
            if (isHost && fromSeat !== undefined) {
                if (this.pendingStarSeats.has(fromSeat)) this.starSeatReady(fromSeat);
                if (this.pendingSyncSeats.has(fromSeat)) {
                    this.pendingSyncSeats.delete(fromSeat);
                    this.resumeIfAllClear();
                }
            }
        } else if (msg.type === 'quit') {
            // host: a guest explicitly quit (see voluntaryQuit) — decide
            // AI-takeover vs. forfeit (handleSeatQuit). Guest: this can only
            // be the host itself (a guest never receives another guest's
            // traffic directly — see this function's fromSeat doc comment),
            // meaning the whole match is ending; there is no host migration
            // to fall back to.
            if (isHost && fromSeat !== undefined) {
                this.handleSeatQuit(fromSeat);
            } else if (!isHost) {
                this.matchOver = true;
                // see finishMatch's own doc comment — a still-live
                // suspend countdown must not survive past match-end, or
                // the very next tick's re-render stomps the notice we're
                // about to show below right back to the stale countdown
                this.suspended = false;
                this.suspendDeadline = null;
                // the host unilaterally ending the match skips finishMatch()
                // entirely (nobody hit 0 HP) — without this, a host that
                // quits right as it's about to lose leaves ZERO independent
                // telemetry/replay record anywhere, from anyone. Best-effort
                // result from current HP (the match was cut short, not
                // concluded, so this is a snapshot for verification purposes,
                // not a sporting/rating claim — 2v2 telemetry doesn't feed
                // rating anyway, see reportOpenRating's star early-return).
                this.reportMatchTelemetry(
                    this.playerHp <= 0 ? 'defeat' : this.enemyHp <= 0 ? 'victory' : 'draw',
                );
                this.hud.showNotice('The host ended the match.', 'Back to menu', () => this.quitToMenu());
            }
        } else if (msg.type === 'starForfeit' && !isHost) {
            // host-only signal (see starForfeit's doc comment) — only ever
            // legitimately sent host->guests via a direct broadcast, never
            // guest->host, so a HOST receiving this on an incoming
            // connection is a forged message, not a real forfeit; guests
            // apply the same hp-zeroing + match-over check the forfeiting
            // host already ran locally
            if (msg.team === 'player') this.playerHp = 0;
            else this.enemyHp = 0;
            if (this.playerHp <= 0 || this.enemyHp <= 0) this.finishMatch();
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
            // authority check, matching drainStarRemoteQueue's equivalent
            // guard: a seat that already locked in has nothing legitimate
            // left to send. Classic 1v1 used to buffer a seat's own build
            // actions locally and release them only once the RECIPIENT
            // locked in — that could reorder a peer's own earlier action
            // behind their bypass-the-buffer endDeployment, which this
            // guard would have wrongly rejected. Now that every action
            // sends immediately (see sendPlayerBuildMessage), send order
            // always matches dispatch order, so that reordering can't
            // happen and this guard is safe.
            // `head.seat` is the CONNECTION-trusted seat (see peerSeat's doc
            // comment), never the message's own claimed seat — classic 1v1
            // has exactly one peer, so it's a fixed identity, not something
            // to trust from content.
            if (this.seatReady[head.seat!]) continue;
            if (head.undo) {
                this.dispatcher.undoLast(head.round, head.seat!);
            } else if (head.action) {
                // seat ids are canonical on every client now (host=0,
                // guest=1 — see the canonicalClassicSeats/localizeRoster
                // construction in the constructor), so no id/team flip is
                // needed, same as drainStarRemoteQueue. `team` is still
                // whatever the SENDER's own local roster calls its side —
                // re-derive it fresh from OUR OWN roster, keyed by the
                // trusted seat.
                const seat = head.seat!;
                const team = this.seats[seat]?.team;
                if (team) this.dispatcher.dispatch({ ...head.action, team, seat });
            }
            this.syncRallyVisuals();
        }
    }

    /**
     * Star mode's own queue+drain, parallel to `drainRemoteQueue` — kept
     * separate for now so each mode's own quirks (see the reordering note
     * on `drainRemoteQueue`) stay easy to reason about independently. The
     * seat already tells us exactly which physical commander this is, so we
     * just look up OUR OWN local team for it and dispatch — same pattern as
     * `drainRemoteQueue` now uses too.
     *
     * Relay (host only — `relayStarBuildMessage` no-ops for a guest) always
     * happens AFTER the local dispatch, never before: relaying first would
     * read stale seatReady state and, on the action that completes the
     * last lock-in, could let `starBattleStart` race ahead of the very
     * action guests need before that broadcast means anything.
     */
    private drainStarRemoteQueue(): void {
        while (this.starRemoteQueue.length > 0) {
            const head = this.starRemoteQueue[0]!;
            if (head.round !== this.round || this.phase !== 'build') return;
            this.starRemoteQueue.shift();
            // a seat that has already locked in this round has nothing
            // legitimate left to send. This is the actual authority check
            // (not just the sender's own UI/dispatchPlayer gate): this is
            // where another seat's message actually gets applied to OUR
            // copy of the match, including on the star host validating a
            // guest — a modified client that kept sending actions after
            // lock-in gets rejected here regardless of what it sent. Safe
            // to check unconditionally: a legitimate endDeployment is what
            // SETS seatReady, so at the moment it's processed here it's
            // still false; only a message sent AFTER that (or a malicious
            // duplicate) is caught.
            if (this.seatReady[head.seat]) continue;
            if (head.undo) {
                this.dispatcher.undoLast(head.round, head.seat);
                // relay preserves the ORIGINATING seat's seq unchanged —
                // this is a forward, not a new origination
                this.relayStarBuildMessage(
                    { type: 'undo', round: head.round, seat: head.seat, seq: head.seq },
                    head.seat,
                );
            } else if (head.action) {
                const team = this.seats[head.seat]?.team;
                if (team) {
                    const resolved = { ...head.action, team, seat: head.seat };
                    this.dispatcher.dispatch(resolved);
                    this.relayStarBuildMessage(
                        { type: 'action', round: head.round, action: resolved, seq: head.seq },
                        head.seat,
                    );
                    // classic 1v1's dedicated 'starter' message triggers this
                    // same follow-up; star mode's chooseCard rides the normal
                    // action path instead, so it must trigger it here. AFTER
                    // relay, not before: maybeStartMatch's round-0 completion
                    // force-flushes every OTHER buffered pick (see its own
                    // doc comment) — if THIS pick is the one that completes
                    // the set, its own relay/buffer decision needs to already
                    // be made before that flush runs, or this exact pick gets
                    // buffered a moment after the flush already emptied
                    // everything and is never sent (repro: the last seat to
                    // pick leaves the others stuck "waiting for opponent").
                    if (head.action.kind === 'chooseCard') {
                        this.refreshShopHud();
                        this.syncSpecialities();
                        this.maybeStartMatch();
                    }
                }
            }
            this.syncRallyVisuals();
        }
    }

    /** Spectator-only queue+drain — see the doc comment on
     *  `wireSpectateSession` for why this is a deliberate copy of
     *  `drainStarRemoteQueue` rather than a reuse. No "already locked in"
     *  skip guard (a spectator never generates its own actions to send
     *  back, so there's nothing to defend against here) and no relay call
     *  (a spectator never forwards anything onward). */
    private drainSpectateQueue(): void {
        while (this.spectateQueue.length > 0) {
            const head = this.spectateQueue[0]!;
            if (head.round !== this.round || this.phase !== 'build') {
                const key = `${head.round}:${this.round}:${this.phase}`;
                if (this.lastSpectateBlockLog !== key) {
                    this.lastSpectateBlockLog = key;
                    this.debugLog.log('spectate.blocked', {
                        headRound: head.round,
                        headSeat: head.seat,
                        headKind: head.action?.kind,
                        myRound: this.round,
                        myPhase: this.phase,
                        queueLen: this.spectateQueue.length,
                    });
                }
                return;
            }
            this.spectateQueue.shift();
            if (head.undo) {
                this.dispatcher.undoLast(head.round, head.seat);
            } else if (head.action) {
                const team = this.seats[head.seat]?.team;
                if (team) {
                    const resolved = { ...head.action, team, seat: head.seat };
                    const ok = this.dispatcher.dispatch(resolved);
                    this.debugLog.log('spectate.dispatched', {
                        kind: head.action.kind,
                        seat: head.seat,
                        team,
                        round: head.round,
                        ok,
                    });
                    if (head.action.kind === 'chooseCard') {
                        this.refreshShopHud();
                        this.syncSpecialities();
                        this.maybeStartMatch();
                    }
                } else {
                    this.debugLog.log('spectate.noTeam', { seat: head.seat, seats: this.seats });
                }
            }
            this.syncRallyVisuals();
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

    private deploySeconds(): number {
        return secondsForRound(this.settings.buildTimeSeconds, this.round);
    }

    private battleSeconds(): number {
        return secondsForRound(this.settings.battleTimeSeconds, this.round);
    }

    private cardSeconds(): number {
        return secondsForRound(this.settings.cardTimeSeconds, this.round);
    }

    /** active build-phase budget (specialist / card pick / deploy) for the action clock */
    private phaseBudgetSeconds(): number {
        if (this.round === 0) {
            return secondsForRound(this.settings.specialistTimeSeconds, this.round);
        }
        if (this.awaitingCards) return this.cardSeconds();
        return this.deploySeconds();
    }

    /**
     * The between-round card offer: every SEAT gets its own independent
     * draw and picks for itself (own economy, own units/items/tactics) —
     * same per-seat model as the starter pick's extraAis already use, no
     * shared side-wide resource left here to race over. Runs on its own
     * dedicated card-pick clock (separate from the deploy clock); skipping
     * pays a small consolation instead (see showRoundOffer).
     */
    private offerRoundCards(): void {
        this.roundCardTaken.fill(false);

        const draw = (rng: () => number) =>
            roundCardAlgorithmById(this.settings.roundCardPreset).drawOffer(this.round, rng);
        const myOffer = draw(this.rngRoundCards[this.humanSeat]!);
        // the classic single opponent's own seat-scoped draw (vestigial no-op
        // on a star guest, since NetworkOpponent.onRoundCards does nothing —
        // still drawn so every client consumes this seat's stream equally)
        const enemyPrimary = primarySeatOf(this.seats, 'enemy');
        const enemyOffer = draw(this.rngRoundCards[enemyPrimary]!);
        this.triggerExtraRoundCards();
        if (this.hydrating || this.watching) {
            // no UI, no opponent hook — hydrating: the recorded actions
            // carry the picks and this is re-shown once rebuilt (see
            // hydrate()); watching: the replay log drives the pick
            // directly (tickReplayPlayback) and never needs showing at all —
            // the streams were consumed above so future offers stay aligned
            this.pendingOffer = myOffer;
            return;
        }
        this.opponent.onRoundCards(enemyOffer);
        this.awaitingCards = true;
        this.phaseRemaining = this.cardSeconds();
        this.showRoundOffer(myOffer);
    }

    /** every AI-controlled seat beyond the classic opponent also gets its own
     *  round-card offer and picks for itself — mirrors triggerExtraStarters */
    private triggerExtraRoundCards(): void {
        for (const e of this.extraAis) {
            e.ai.onRoundCards(
                roundCardAlgorithmById(this.settings.roundCardPreset).drawOffer(
                    this.round,
                    this.rngRoundCards[e.seat]!,
                ),
            );
        }
    }

    private showRoundOffer(offer: RoundCard[], opts?: { duringIntro?: boolean }): void {
        if (this.introActive && !opts?.duringIntro) {
            this.pendingOffer = offer;
            this.deferredRoundOffer = true;
            this.awaitingCards = true;
            return;
        }
        this.hud.showRoundCards(
            offer,
            SKIP_CARD_REWARD,
            (cardId) => {
                this.dispatchPlayer({ kind: 'roundCard', team: 'player', cardId });
                this.awaitingCards = false;
                this.phaseRemaining = this.deploySeconds();
            },
            roundOfferTitle(offer),
            {
                ownedItemIds: this.ownedRunesForCardPreview(),
                forgePool: this.teamForgePool('player'),
                canAfford: (c) => this.economy.balance(this.humanSeat) >= c.cost,
            },
        );
    }

    /** bag + forge oven runes the player can still use for forging */
    private ownedRunesForCardPreview(): string[] {
        const bag = this.itemInventory[this.humanSeat] ?? [];
        const oven = this.forgeSlots.player
            .filter((s): s is ForgeSlot => !!s)
            .map((s) => s.itemId);
        return [...bag, ...oven];
    }

    /** tech-resolved stats plus army boosts, card speciality, and the pack's items */
    private resolvedStats(unit: Unit) {
        const { team, type } = unit;
        // the horde owns no techs/boosts/speciality/items — plain base stats
        if (team === 'horde') {
            return {
                hp: type.hp,
                damage: type.damage,
                range: type.range,
                minRange: type.minRange ?? 0,
                speed: type.speed,
                attackInterval: type.attackInterval,
                splashRadius: type.splashRadius ?? 0,
            };
        }
        const stats = this.techTree.statsFor(unit.seat, type);
        const b = this.settings.boosts;
        const attackTier = this.boostState.attack[unit.seat]!;
        const hpTier = this.boostState.hp[unit.seat]!;
        if (attackTier > 0) stats.damage *= 1 + b.attackTiers[attackTier - 1]!;
        if (hpTier > 0) stats.hp *= 1 + b.hpTiers[hpTier - 1]!;
        const spec = this.speciality[unit.seat];
        if (spec === 'air' && effectiveFlying(type, unit.seat, (s, t, id) => this.techTree.has(s, t, id)) > 0) {
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
            stats.minRange *= mods.range ?? 1;
            stats.speed *= mods.speed ?? 1;
            stats.attackInterval *= mods.attackInterval ?? 1;
        }
        const rb = this.settings.deploy;
        // flat, and after the item loop on purpose — a speed rune multiplies
        // the unit's own speed, not the commander's gift (same rule as the
        // one-round Vanguard boost below)
        if (spec === 'speed' && !type.structure) stats.speed += SPEED_COMMANDER_BONUS;
        if (this.roundBoosts.speed[unit.seat]) stats.speed += rb.speedBoost;
        if (this.roundBoosts.range[unit.seat] && type.projectileSpeed) stats.range += rb.rangeBoost;
        return stats;
    }

    /** the left-side item strip: one square per item instance, hidden outside build.
     *  Items are per-SEAT — this shows only MY OWN seat's pool, not my ally's.
     *  Same ids are grouped (catalog order), like the spells strip. */
    private inventoryView(): {
        id: string;
        icon: string;
        name: string;
        armed: boolean;
        index: number;
    }[] {
        if (!this.playerCanAct) return [];
        const bag = this.itemInventory[this.humanSeat]!;
        return this.sortedItemIndices(bag).map((index) => {
            const id = bag[index]!;
            const item = ITEMS[id];
            return {
                id,
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
                // duplicates share an id: highlight exactly the clicked slot
                armed: this.armedItem === id && this.armedItemIndex === index,
                index,
            };
        });
    }

    /** stable indices into `bag` grouped by {@link ITEMS} catalog order */
    private sortedItemIndices(bag: readonly string[]): number[] {
        const order = Object.keys(ITEMS);
        const rank = (id: string) => {
            const i = order.indexOf(id);
            return i < 0 ? order.length : i;
        };
        return bag
            .map((_, index) => index)
            .sort((a, b) => {
                const d = rank(bag[a]!) - rank(bag[b]!);
                return d !== 0 ? d : a - b;
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
        /**
         * Corner badge: omit when ready to cast; `'cancel'` while placed/used
         * this deploy; a positive number = rounds until the charge returns.
         */
        badge?: 'cancel' | number;
        hint?: string;
        index: number;
    }[] {
        if (!this.playerCanAct) return [];
        const out: {
            id: string;
            icon: string;
            name: string;
            armed: boolean;
            placed?: boolean;
            routeId?: number;
            badge?: 'cancel' | number;
            hint?: string;
            index: number;
        }[] = [];
        let slot = 0;

        // where each 'placement' tactic keeps its resettable placements —
        // MY OWN seat's, not an ally's (tactics are per-seat now)
        const placementsOf: Record<string, () => readonly { id: number }[]> = {
            [RALLY_ROUTE_ID]: () => this.rallyRoutes.filter((r) => r.seat === this.humanSeat),
            [OIL_SPILL_ID]: () => this.oilStamps.filter((s) => s.seat === this.humanSeat),
        };
        // per-round ability charges layered on top of the inventory (sell only)
        const abilityChargesOf = (tacticId: string): { max: number; used: number } => {
            if (tacticId !== SELL_UNIT_ID || !this.sellState.owned[this.humanSeat]) {
                return { max: 0, used: 0 };
            }
            const max = this.settings.sell.maxPerRound;
            return { max, used: Math.min(this.sellState.used[this.humanSeat]!, max) };
        };

        for (const tactic of Object.values(TACTICS)) {
            const inventory = this.tacticInventory[this.humanSeat]!.filter(
                (id) => id === tactic.id,
            ).length;
            const ability = abilityChargesOf(tactic.id);
            // greyed and available entries are counted from separate sources,
            // so using a charge turns an entry grey instead of removing it
            let placedEntries: { routeId?: number; hint?: string; badge?: 'cancel' | number }[];
            let avail: number;
            if (tactic.kind === 'placement') {
                // charge stays in the inventory; placements are right-click resettable
                const placements = usesSpellPlacement(tactic)
                    ? this.spellStamps.filter(
                          (s) =>
                              s.seat === this.humanSeat &&
                              s.tacticId === tactic.id &&
                              s.placedRound === this.round,
                      )
                    : (placementsOf[tactic.id]?.() ?? []);
                // spells fired in past rounds still cool their charge down
                const cooling = usesSpellPlacement(tactic)
                    ? this.spellStamps.filter(
                          (s) =>
                              s.seat === this.humanSeat &&
                              s.tacticId === tactic.id &&
                              s.placedRound < this.round &&
                              s.placedRound >= this.round - tactic.cooldownRounds,
                      )
                    : [];
                placedEntries = [
                    ...placements.map((p) => ({
                        routeId: p.id,
                        badge: 'cancel' as const,
                    })),
                    ...cooling.map((s) => {
                        const readyIn = s.placedRound + tactic.cooldownRounds + 1 - this.round;
                        return {
                            badge: readyIn,
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
                    this.humanSeat,
                    tactic.id,
                    this.round - tactic.cooldownRounds,
                );
                const coolingHint = (usedRound: number, readyIn: number): string => {
                    const ready = `Ready again in ${readyIn} round${readyIn === 1 ? '' : 's'}.`;
                    return usedRound === this.round
                        ? `${tactic.name} — used this round.\nUndo gives it back. ${ready}`
                        : `${tactic.name} — cooling down.\n${ready}`;
                };
                // A spent one-shot has NO per-entry revert: its effect is already
                // applied to a pack, and only the global undo can take it back.
                // So it never shows the cancel badge — that badge is reserved for
                // entries carrying a routeId, i.e. a placement this strip can
                // actually clear. See the generic rule in `badge` above.
                placedEntries = [
                    ...Array.from({ length: ability.used }, () => ({
                        badge: 1,
                        hint: `${tactic.name} — used this round.\nUndo gives it back. Ready again next round.`,
                    })),
                    ...useRounds.map((r) => {
                        const readyIn = r + tactic.cooldownRounds + 1 - this.round;
                        return { badge: readyIn, hint: coolingHint(r, readyIn) };
                    }),
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
                    index: slot,
                    ...p,
                });
                slot++;
            }
            for (let i = 0; i < avail; i++) {
                // duplicates share an id: this is exactly the clicked slot
                const armed = this.armedTactic === tactic.id && this.armedTacticIndex === slot;
                if (armed) {
                    // picked up: the charge is on the cursor, not in the strip.
                    // `slot` still advances so every other entry keeps its index
                    // (armedTacticIndex is a slot number), and cancelling puts it
                    // straight back.
                    slot++;
                    continue;
                }
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: `${tactic.name} — ${tactic.description}`,
                    armed: false,
                    index: slot,
                    // one-shots aren't "placed on the map" — override the default hint
                    hint:
                        tactic.kind === 'oneShot'
                            ? `${tactic.name}\n${tactic.description}\nRight-click to cancel.`
                            : undefined,
                });
                slot++;
            }
        }

        return out;
    }

    /** merged item pool across every seat on a side — for READ-ONLY display
     *  only (intel/HUD). Consumption always targets one seat's own array
     *  (see actions.ts applyItem) — this never feeds back into gameplay. */
    private itemsForTeam(team: Team): string[] {
        return seatIdsOf(this.seats, team).flatMap((seat) => this.itemInventory[seat]!);
    }

    /** true if ANY seat on the side owns the sell ability — read-only display merge, same idea as {@link itemsForTeam} */
    private sellAbilityOwnedForTeam(team: Team): boolean {
        return seatIdsOf(this.seats, team).some((seat) => this.sellState.owned[seat]);
    }

    /** merged tactic-charge pool across every seat on a side — read-only
     *  display only, same idea as {@link itemsForTeam} */
    private tacticsForTeam(team: Team): string[] {
        return seatIdsOf(this.seats, team).flatMap((seat) => this.tacticInventory[seat]!);
    }

    /** Records the enemy's unequipped items/tactics at deployment-phase start. */
    private captureEnemyIntelSnapshot(): void {
        this.enemyIntelSnapshot = {
            items: this.itemsForTeam('enemy'),
            tactics: this.tacticsForTeam('enemy'),
            sellAbilityOwned: this.sellAbilityOwnedForTeam('enemy'),
        };
    }

    private enemyInventoryView(): {
        items: { id: string; icon: string; name: string }[];
        tactics: { icon: string; name: string }[];
        sellAbility: boolean;
    } {
        if (this.phase !== 'build') {
            return { items: [], tactics: [], sellAbility: false };
        }
        const live = this.deployReady.player;
        const items = live ? this.itemsForTeam('enemy') : (this.enemyIntelSnapshot?.items ?? []);
        const tactics = live ? this.tacticsForTeam('enemy') : (this.enemyIntelSnapshot?.tactics ?? []);
        const sellAbility = live
            ? this.sellAbilityOwnedForTeam('enemy')
            : (this.enemyIntelSnapshot?.sellAbilityOwned ?? false);
        const mapItem = (id: string) => {
            const item = ITEMS[id];
            return {
                id,
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
            items: this.sortedItemIndices(items).map((i) => mapItem(items[i]!)),
            tactics: tactics.map(mapTactic),
            sellAbility,
        };
    }

    /** enemy forge tray ids visible to the local player (live or intel) */
    private enemyForgeOvenView(): string[] {
        if (this.phase !== 'build') return [];
        if (this.deployReady.player) {
            return (this.forgeSlots.enemy ?? [])
                .filter((s): s is ForgeSlot => !!s)
                .map((s) => s.itemId);
        }
        const snap = this.buildingIntelSnapshot?.forge.enemy ?? [];
        return snap.filter((id): id is string => !!id);
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
        // an armed tactic is "picked up": the pointer becomes the spell's own
        // icon (and its strip entry hides — see tacticsView)
        this.pixiApp.canvas.style.cursor = this.armedTactic
            ? iconCursorCss(TACTICS[this.armedTactic]?.icon ?? 'ui-unknown')
            : '';
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
                const maxSpan = TACTICS[RALLY_ROUTE_ID]?.maxSpan;
                if (this.tacticDraftStart && this.tacticDraftMid) {
                    const end = clampTacticEnd(
                        this.tacticDraftMid.x,
                        this.tacticDraftMid.z,
                        pos.x,
                        pos.z,
                        maxSpan,
                    );
                    draft = {
                        startX: this.tacticDraftStart.x,
                        startZ: this.tacticDraftStart.z,
                        midX: this.tacticDraftMid.x,
                        midZ: this.tacticDraftMid.z,
                        endX: end.x,
                        endZ: end.z,
                        mode: 'full',
                    };
                } else if (this.tacticDraftStart) {
                    const mid = clampTacticEnd(
                        this.tacticDraftStart.x,
                        this.tacticDraftStart.z,
                        pos.x,
                        pos.z,
                        maxSpan,
                    );
                    draft = {
                        startX: this.tacticDraftStart.x,
                        startZ: this.tacticDraftStart.z,
                        midX: mid.x,
                        midZ: mid.z,
                        endX: mid.x,
                        endZ: mid.z,
                        mode: 'start-mid',
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
                } else if (armed.targeting === 'two-point') {
                    const start = this.tacticDraftStart ?? pos;
                    const end = this.tacticDraftStart
                        ? clampTacticEnd(
                              start.x,
                              start.z,
                              pos.x,
                              pos.z,
                              armed.maxSpan,
                          )
                        : pos;
                    draft = {
                        tacticId: armed.id,
                        x: end.x,
                        z: end.z,
                        radius,
                        yaw: 0,
                        startX: start.x,
                        startZ: start.z,
                        blocked:
                            !!armed.respectsSafeZone &&
                            this.inSafeZone(end.x, end.z, radius),
                    };
                } else {
                    const hover = pos;
                    draft = {
                        tacticId: armed.id,
                        x: hover.x,
                        z: hover.z,
                        radius,
                        yaw: 0,
                        blocked:
                            !!armed.respectsSafeZone &&
                            this.inSafeZone(hover.x, hover.z, radius),
                    };
                }
            }
        }
        this.spellVisuals.sync(this.visibleSpellStamps(), draft);
        if (armed?.respectsSafeZone && this.playerCanAct) {
            this.spellVisuals.syncSafeZones(
                safeZoneDisks(this.placement.allUnits(), 'player', armed.radius ?? 0),
            );
        } else {
            this.spellVisuals.syncSafeZones([]);
        }
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
        const had =
            this.armedTactic !== null ||
            this.tacticDraftStart !== null ||
            this.tacticDraftMid !== null;
        this.armedTactic = null;
        this.armedTacticIndex = null;
        this.tacticDraftStart = null;
        this.tacticDraftMid = null;
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
            mid?: { x: number; z: number };
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
            case MOVE_UNIT_ID:
                return this.dispatchPlayer({
                    kind: 'mobilizeUnit',
                    team: 'player',
                    unitId: target.unit!.id,
                });
            case TUTOR_ID:
                return this.dispatchPlayer({
                    kind: 'tutorUnit',
                    team: 'player',
                    unitId: target.unit!.id,
                });
            case RALLY_ROUTE_ID:
                return this.dispatchPlayer({
                    kind: 'placeRallyRoute',
                    team: 'player',
                    startX: target.start!.x,
                    startZ: target.start!.z,
                    midX: target.mid!.x,
                    midZ: target.mid!.z,
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

    /**
     * Which of my own packs an 'own-unit' tactic accepts. Move Pack is the
     * mirror of the drag rule: only packs the player may NOT currently move
     * (already-movable ones would waste the charge). Everything else follows
     * sell's rule — any non-structure pack of mine.
     */
    private canTargetOwnUnit(tacticId: string, unit: Unit): boolean {
        if (unit.seat !== this.humanSeat) return false;
        if (tacticId === MOVE_UNIT_ID) {
            return (
                (!unit.type.structure || !!unit.type.extra) &&
                !this.placement.canReposition(unit)
            );
        }
        if (tacticId === TUTOR_ID) {
            // mirrors the action guard: a maxed pack has nothing left to learn
            // and a full bar would waste the charge
            if (unit.type.structure || unit.level >= this.settings.leveling.maxLevel) return false;
            return (
                unit.xp <
                xpThresholdFor(unit.type, unit.level, this.economy, this.settings.leveling)
            );
        }
        return !unit.type.structure;
    }

    /** swallows map clicks while a tactic is armed; targeting is data-driven */
    private handleTacticGroundClick(x: number, y: number): boolean {
        if (!this.playerCanAct || !this.armedTactic) return false;
        const tactic = TACTICS[this.armedTactic];
        if (!tactic) return false;

        if (tactic.targeting === 'own-unit') {
            const unit = this.placement.unitAtPoint(x, y);
            if (unit && this.canTargetOwnUnit(tactic.id, unit)) {
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

        if (tactic.targeting === 'three-point') {
            // start → mid → end; each leg clamps to maxSpan
            if (tactic.respectsSafeZone && this.inSafeZone(ground.x, ground.z, radius)) {
                return true;
            }
            if (!this.tacticDraftStart) {
                this.tacticDraftStart = ground;
                this.syncTacticVisuals();
                return true;
            }
            if (!this.tacticDraftMid) {
                this.tacticDraftMid = clampTacticEnd(
                    this.tacticDraftStart.x,
                    this.tacticDraftStart.z,
                    ground.x,
                    ground.z,
                    tactic.maxSpan,
                );
                this.syncTacticVisuals();
                return true;
            }
            const end = clampTacticEnd(
                this.tacticDraftMid.x,
                this.tacticDraftMid.z,
                ground.x,
                ground.z,
                tactic.maxSpan,
            );
            if (
                this.dispatchTacticUse(tactic.id, {
                    start: this.tacticDraftStart,
                    mid: this.tacticDraftMid,
                    end,
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

    /** true while an inventory item is armed and this pack can still take it */
    private canDropArmedItemOn(unit: Unit): boolean {
        if (!this.armedItem || !this.playerCanAct) return false;
        if (unit.seat !== this.humanSeat || unit.type.structure) return false;
        if (unit.items.length >= itemSlotLimit(unit.type.id)) return false;
        return !!ITEMS[this.armedItem];
    }

    /** armed rune → shared Stronghold forge (any seat on this side) */
    private canDropForgeOn(unit: Unit): boolean {
        if (!this.armedItem || !this.playerCanAct) return false;
        if (unit.type !== STRONGHOLD || unit.team !== 'player') return false;
        if (!ITEMS[this.armedItem]) return false;
        return forgeSeatCanInsert(this.forgeSlots.player, this.humanSeat);
    }

    /** press-drag release over the board — equip if the pack under the cursor is valid */
    private tryDropArmedItemAtClient(clientX: number, clientY: number): boolean {
        if (!this.armedItem || !this.playerCanAct) return false;
        const local = this.placement.clientToLocal(clientX, clientY);
        this.placement.setPointerFromClient(clientX, clientY);
        const unit = this.placement.unitAtPoint(local.x, local.y);
        if (!unit) return false;
        const previouslySelected = this.placement.selectedUnit;
        let ok = false;
        if (this.canDropForgeOn(unit)) ok = this.forgeInsertItem(this.armedItem);
        else if (this.canDropArmedItemOn(unit)) ok = this.applyItemTo(unit, this.armedItem);
        if (!ok) return false;
        // drop on another pack while details show a different one → close the panel
        if (previouslySelected && previouslySelected !== unit) this.placement.deselect();
        return true;
    }

    /** press-drag release — place the armed spell at the pointer (same as a map click) */
    private tryPlaceArmedTacticAtClient(clientX: number, clientY: number): void {
        if (!this.armedTactic || !this.playerCanAct) return;
        const local = this.placement.clientToLocal(clientX, clientY);
        this.placement.setPointerFromClient(clientX, clientY);
        this.handleTacticGroundClick(local.x, local.y);
    }

    /** equips an inventory item onto a pack (dispatch + feedback burst) */
    private applyItemTo(unit: Unit, itemId: string): boolean {
        if (!this.playerCanAct || unit.seat !== this.humanSeat || unit.type.structure) return false;
        if (unit.items.length >= itemSlotLimit(unit.type.id) || !ITEMS[itemId]) return false;
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

    /** returns a this-deploy rune from a pack to the bag (drag-off) */
    private removeItemFrom(unitId: number, itemId: string, slot: number): boolean {
        if (!this.playerCanAct) return false;
        const unit = this.placement.unitById(unitId);
        if (!unit || unit.seat !== this.humanSeat || unit.type.structure) return false;
        return this.dispatchPlayer({
            kind: 'removeItem',
            team: 'player',
            unitId,
            itemId,
            slot,
        });
    }

    /** slot a rune into the shared Stronghold forge */
    private forgeInsertItem(itemId: string): boolean {
        if (!this.playerCanAct || !ITEMS[itemId]) return false;
        if (!forgeSeatCanInsert(this.forgeSlots.player, this.humanSeat)) return false;
        return this.dispatchPlayer({ kind: 'forgeInsert', team: 'player', itemId });
    }

    /** place several bag runes into the forge at once (empty-forge spell suggestion) */
    private forgeFillItems(itemIds: readonly string[]): boolean {
        if (!this.playerCanAct || itemIds.length === 0) return false;
        return this.dispatchPlayer({
            kind: 'forgeFill',
            team: 'player',
            itemIds: [...itemIds],
        });
    }

    /** drag/click a this-deploy forge rune back to the inserter's bag */
    private forgeRemoveItem(slot: number, itemId: string): boolean {
        if (!this.playerCanAct) return false;
        return this.dispatchPlayer({ kind: 'forgeRemove', team: 'player', itemId, slot });
    }

    /**
     * Start of deploy (after intel snapshot): resolve each side's oven → grant
     * one spell to every seat on that side; refund unused runes; clear tray.
     */
    private burnForges(): void {
        if (this.round <= 1) return;
        for (const team of ['player', 'enemy'] as const) {
            const oven = this.forgeSlots[team]!;
            const pool = this.teamForgePool(team);
            const result = resolveForge(oven, pool);
            if (result.product?.kind === 'tactic') {
                for (const seat of seatIdsOf(this.seats, team)) {
                    this.tacticInventory[seat]!.push(result.product.id);
                }
            } else if (result.product?.kind === 'item') {
                // same as spells: every seat on the side receives one copy
                for (const seat of seatIdsOf(this.seats, team)) {
                    this.itemInventory[seat]!.push(result.product.id);
                }
            }
            for (const { itemId, seat } of result.refunds) {
                this.itemInventory[seat]!.push(itemId);
            }
            this.forgeSlots[team] = emptyForgeSlots(
                forgeTeamCapacity(seatIdsOf(this.seats, team).length),
            );
        }
    }

    /** union of forge spells unlocked by specialists on this side */
    private teamForgePool(team: Team): string[] {
        return unionForgeSpellPools(
            ...seatIdsOf(this.seats, team).map(
                (seat) => this.starterCardOfSeat(seat)?.forgeSpells,
            ),
        );
    }

    /** world strip over the Stronghold: predicted bake spell (deploy only; battle = sparks) */
    private forgeWorldBadges(
        unit: Unit,
    ): { runes: string[]; spellIcon: string | null } | null {
        if (unit.type !== STRONGHOLD) return null;
        // battle: chimney sparks only — spell badge is deploy intel / loading UI
        if (this.phase !== 'build') return null;
        const team: Team = unit.team === 'horde' ? 'player' : unit.team;
        const fogged = this.placement.isIntelFogged(unit);
        const snapIds =
            fogged && this.buildingIntelSnapshot
                ? this.buildingIntelSnapshot.forge[team]
                : null;
        const slots: (ForgeSlot | null)[] = snapIds
            ? snapIds.map((id) => (id ? { itemId: id, seat: -1 as SeatId, round: -1 } : null))
            : this.forgeSlots[team]!;
        let filled = false;
        for (const s of slots) {
            if (s) {
                filled = true;
                break;
            }
        }
        if (!filled) return null;
        const result = resolveForge(slots, this.teamForgePool(team));
        const info = result.product
            ? (result.product.kind === 'tactic'
                  ? TACTICS[result.product.id]
                  : ITEMS[result.product.id])
            : null;
        const spellIcon = info?.icon ?? null;
        if (!spellIcon) return null;
        return { runes: [], spellIcon };
    }

    /**
     * Chimney sparks while an oven holds runes (denser when a recipe will bake).
     * Respects intel fog so enemy oven state isn't leaked.
     */
    private updateForgeFx(dt: number): void {
        const targets: { unit: Unit; mode: ReturnType<typeof forgeGlowMode> }[] = [];
        for (const unit of this.placement.allUnits()) {
            if (unit.type !== STRONGHOLD || unit.destroyed) continue;
            const team: Team = unit.team === 'horde' ? 'player' : unit.team;
            const fogged = this.placement.isIntelFogged(unit);
            const snapIds =
                fogged && this.buildingIntelSnapshot
                    ? this.buildingIntelSnapshot.forge[team]
                    : null;
            const oven: (ForgeSlot | null)[] = snapIds
                ? snapIds.map((id) =>
                      id ? { itemId: id, seat: -1 as SeatId, round: -1 } : null,
                  )
                : this.forgeSlots[team]!;
            targets.push({
                unit,
                mode: forgeGlowMode(oven, this.teamForgePool(team)),
            });
        }
        this.forgeFx.update(dt, this.time, targets, this.scene);
    }

    /** Player/enemy avatar flags on each living Stronghold rooftop. */
    private updateStrongholdFlags(): void {
        const keeps: Unit[] = [];
        if (!this.hud.isUiHidden) {
            for (const unit of this.placement.allUnits()) {
                if (unit.type === STRONGHOLD && !unit.destroyed) keeps.push(unit);
            }
        }
        this.strongholdFlags.update(
            this.time,
            keeps,
            this.seats,
            this.scene,
            !this.hud.isUiHidden,
            this.weather?.wind,
        );
    }

    /**
     * Pink octahedron beacons over forest-ring horde packs while they wait /
     * march in. Cleared once `marchIn` ends (on-board combat). During battle,
     * follow living actor centroids — `unit.world` stays at the spawn point.
     */
    private updateHordeMarkers(): void {
        if (this.hud.isUiHidden) {
            this.hordeMarkers.clear();
            return;
        }
        const spots: HordeMarkerSpot[] = [];
        if (this.phase === 'battle' && this.sim) {
            const sums = new Map<number, { x: number; z: number; n: number; seed: number }>();
            for (const a of this.sim.actors) {
                if (!a.alive || a.unit.team !== 'horde' || !a.unit.marchIn) continue;
                const id = a.unit.id;
                let s = sums.get(id);
                if (!s) {
                    s = { x: 0, z: 0, n: 0, seed: id };
                    sums.set(id, s);
                }
                s.x += a.rx;
                s.z += a.rz;
                s.n++;
            }
            for (const s of sums.values()) {
                if (s.n <= 0) continue;
                spots.push({ x: s.x / s.n, z: s.z / s.n, seed: s.seed });
            }
        } else {
            for (const unit of this.placement.allUnits()) {
                if (unit.team !== 'horde' || !unit.marchIn || unit.destroyed) continue;
                spots.push({ x: unit.world.x, z: unit.world.z, seed: unit.id });
            }
        }
        this.hordeMarkers.update(
            this.time,
            spots,
            this.rig.camera,
            this.pixiApp.screen.width,
            this.pixiApp.screen.height,
        );
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
            .filter((u) => u.seat === this.humanSeat && u.type === type && this.canLevel(u))
            .sort((a, b) => a.id - b.id);
    }

    /** every ready-to-level pack on the field, any unit type */
    private allLevelablePacks(): Unit[] {
        return this.placement
            .allUnits()
            .filter((u) => u.seat === this.humanSeat && this.canLevel(u))
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
            affordable: this.economy.balance(this.humanSeat) >= cost,
        };
    }

    /** the panel's level-up offer, with a "level all" when several packs of the kind are ready */
    private levelUpInfo(
        u: Unit,
        lv: { xp: number; xpNext: number },
    ): SelectionInfo['levelUp'] {
        if (u.seat !== this.humanSeat || !this.playerCanAct || u.type.structure || lv.xpNext < 0) {
            return undefined;
        }
        const cost = levelCost(u.type, this.economy, this.settings.leveling);
        const readyPacks = this.levelablePacksOf(u.type);
        return {
            cost,
            ready: lv.xp >= lv.xpNext,
            affordable: this.economy.balance(this.humanSeat) >= cost,
            all:
                readyPacks.length >= 2
                    ? {
                          count: readyPacks.length,
                          cost: cost * readyPacks.length,
                          affordable: this.economy.balance(this.humanSeat) >= cost * readyPacks.length,
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

    /** Level several packs in one action so Undo reverts the whole batch. */
    private buyLevelsFor(units: readonly Unit[]): boolean {
        if (units.length === 0) return false;
        if (units.length === 1) return this.buyLevelFor(units[0]!);
        const before = new Map(units.map((u) => [u.id, u.level] as const));
        if (
            !this.dispatchPlayer({
                kind: 'buyLevelBatch',
                team: 'player',
                unitIds: units.map((u) => u.id),
            })
        ) {
            return false;
        }
        const bursts: SimEvent[] = [];
        for (const unit of units) {
            if ((before.get(unit.id) ?? 0) >= unit.level) continue;
            for (const m of unit.members) {
                bursts.push({
                    kind: 'levelup',
                    x: unit.world.x + m.home.x,
                    y: unit.type.meshScale * 1.5,
                    z: unit.world.z + m.home.z,
                });
            }
        }
        if (bursts.length) this.particles.spawnFromEvents(bursts);
        return true;
    }

    private cycleSpeed(direction: number): void {
        const next = this.speedIndex + direction;
        if (next < 0 || next >= this.speedSteps.length) return;
        this.applySpeedIndex(next);
    }

    /** battle speed returns to 1× at the start of every deployment phase
     *  (never called while watching — see startBuildPhase's guard) */
    private resetSpeed(): void {
        const index = this.speedSteps.indexOf(1);
        if (index < 0) return;
        this.speedIndex = index;
        this.hud.setSpeed(1);
        // during hydration this runs once per replayed round — don't spam the peer
        if (!this.hydrating) this.broadcast({ type: 'speed', multiplier: 1 });
    }

    /** what the player pays right now, including an active recruit-level premium */
    private effectiveCost(type: UnitType): number {
        if (type.extra) return this.economy.costOf(type); // extras never recruit levels
        const extra = this.recruitLevel[this.humanSeat]! - 1;
        return (
            this.economy.costOf(type) +
            extra * levelCost(type, this.economy, this.settings.leveling)
        );
    }

    /** HUD buy button: resolve a spawn spot, then run it through the action system.
     *  Returns whether a buy / place-flow actually started (drives phone-sheet close). */
    private buyUnit(type: UnitType): boolean {
        if (!this.playerCanAct) return false;
        if (!type.extra && !this.unlockedUnits[this.humanSeat]!.includes(type.id)) return false;
        if (this.economy.balance(this.humanSeat) < this.effectiveCost(type)) return false;
        // extras are click-placed: nothing is bought until the placement click
        if (type.extra) {
            const left =
                this.settings.deploy.extrasBudgetPerRound - this.deployState.extrasSpent[this.humanSeat]!;
            if (this.economy.costOf(type) > left) return false; // extras budget exhausted
            this.placement.beginPlacing(type);
            return true;
        }
        // Drop the pack under a visible screen point (not the orbit target —
        // that sits behind the compact shop sheet on phone/small desktop).
        const aim = this.buyAimWorld();
        const anchor = this.placement.findBuySpotNear(type, aim.x, aim.z);
        if (!anchor) return false;
        return this.dispatchPlayer({
            kind: 'buy',
            team: 'player',
            typeId: type.id,
            anchor,
            rotated: false,
        });
    }

    /** HUD: buy a base rune into the bag — shares the per-round purchase limit with units. */
    private buyRune(itemId: string): boolean {
        if (!this.playerCanAct) return false;
        return this.dispatchPlayer({
            kind: 'buyRune',
            team: 'player',
            itemId,
        });
    }

    /**
     * Ground point to seed shop auto-placement. Desktop: view center.
     * Compact chrome: center of the free band above the bottom sheet (~52vh).
     */
    private buyAimWorld(): { x: number; z: number } {
        const w = this.wrapper.clientWidth;
        const h = this.wrapper.clientHeight;
        const screenY = isCompactChrome() ? h * 0.28 : h * 0.5;
        const hit = this.rig.screenToGround(w * 0.5, screenY, w, h);
        if (hit) return { x: hit.x, z: hit.z };
        const t = this.rig.target;
        return { x: t.x, z: t.z };
    }

    /**
     * The undo button: reverts the player's most recent action of the
     * running build phase — click repeatedly to peel back further. Enemy
     * actions and earlier rounds are never touched.
     */
    private undoLast(): void {
        if (!this.canUndo()) return;
        this.placement.deselect();
        if (this.dispatcher.undoLast(this.round, this.humanSeat)) {
            this.sendPlayerBuildMessage({
                type: 'undo',
                round: this.round,
                seat: this.humanSeat,
                seq: this.nextSeatSeq(this.humanSeat),
            });
        }
        this.hud.refreshCosts(); // the undone action may have been the recruit switch
        this.refreshShopHud();
        this.syncTacticVisuals();
        this.refreshFlightAlts();
    }

    private unlockUnit(typeId: string): void {
        if (!this.playerCanAct) return;
        if (this.dispatchPlayer({ kind: 'unlockUnit', team: 'player', typeId })) {
            this.refreshShopHud();
        }
    }

    private refreshShopHud(): void {
        this.hud.updateShop(
            this.unlockedUnits[this.humanSeat]!,
            !this.unlockUsedThisRound[this.humanSeat],
            this.economy.balance(this.humanSeat),
        );
    }

    private canUndo(): boolean {
        return (
            this.phase === 'build' &&
            !this.matchOver &&
            // THIS SEAT locked in, not the whole side — undoLast() below
            // calls the dispatcher directly (unlike buy/applyItem/etc,
            // which route through dispatchPlayer and already check
            // seatReady there), so this was the one real gap: checking the
            // side-wide flag left undo callable for the whole "waiting for
            // ally" window after you'd already locked in
            !this.seatReady[this.humanSeat] &&
            !this.watching &&
            // undoLast() also bypasses dispatchPlayer's own `!this.suspended`
            // gate — without this, undoing while suspended shrinks the local
            // log by one entry with no way to tell the host (the whole point
            // of `suspended` is that nothing can be sent right now). This
            // still matters even after Phase 7's move to full teardown-and-
            // reconstruct on reconnect/resync: `suspended` also covers being
            // paused because a DIFFERENT seat dropped (this Game object is
            // never rebuilt in that case), where a silent local-only undo
            // would permanently diverge from the host with nothing to catch
            // it.
            !this.suspended &&
            this.dispatcher.canUndo(this.round, this.humanSeat)
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
        this.phaseRemaining = this.battleSeconds();
        this.placement.enabled = false;
        this.placement.hiddenPlacements = false;
        this.placement.deselect();
        this.armedItem = null;
        this.cancelTacticPlacement();
        this.gridOverlay.visible = false;
        this.enemyIntelSnapshot = null;
        this.techIntelSnapshot = null;
        this.buildingIntelSnapshot = null;
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
        this.prepareProductionReserves();
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
        // Meteor drop
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
        this.refreshFlightAlts();
        this.sim = new BattleSim(this.placement.allUnits(), {
            towers: this.settings.towers,
            leveling: this.settings.leveling,
            battleSeconds: this.battleSeconds(),
            seatRank: (seat) => this.seatRank(seat),
            costOf: (type) => this.economy.costOf(type),
            statsOf: (unit) => this.resolvedStats(unit),
            hasTech: (seat, typeId, techId) => this.unitHasTech(seat, typeId, techId),
            flankSpawnSeconds: this.settings.deploy.flankSpawnSeconds ?? 5,
            flankSpawnMult: (seat) => (seat < 0 ? 1 : this.flankSpawnMult[seat]!),
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
            spawnOnKill: (parent, typeId, x, z) => this.spawnOnKillChild(parent, typeId, x, z),
            boardHalfW: this.map.halfW,
            boardHalfZ: this.map.halfH,
        });
        this.debugLog.log('sim.battleStart', {
            watching: this.watching,
            hydrating: this.hydrating,
            round: this.round,
            hash: this.stateHash(),
            unitCount: this.sim.actors.length,
            actors: this.sim.actors
                .map((a) => ({
                    id: a.unit.id,
                    seat: a.unit.seat,
                    team: a.unit.team,
                    level: a.unit.level,
                    hp: a.hp,
                    x: Math.round(a.x * 100) / 100,
                    z: Math.round(a.z * 100) / 100,
                }))
                .sort((a, b) => a.id - b.id),
        });
        // per-(type, seat) resolved combat stats — one representative actor
        // per combination, not per actor (sim.battleStart already covers
        // composition; this is for comparing WHY two clients' otherwise
        // identical-looking rosters fight differently, e.g. a tech/boost
        // applied on one client but not yet reflected on another).
        const seenTypeSeat = new Set<string>();
        const statsRows: unknown[] = [];
        for (const a of this.sim.actors) {
            const key = `${a.unit.type.id}:${a.unit.seat}`;
            if (seenTypeSeat.has(key)) continue;
            seenTypeSeat.add(key);
            // the horde pseudo-faction owns no economy/tech/boost/speciality
            // state (see resolvedStats' own early return for it) — every
            // per-seat table below is indexed by real seats only
            if (a.unit.team === 'horde') {
                statsRows.push({
                    typeId: a.unit.type.id,
                    seat: a.unit.seat,
                    team: a.unit.team,
                    level: a.unit.level,
                    stats: this.resolvedStats(a.unit),
                });
                continue;
            }
            statsRows.push({
                typeId: a.unit.type.id,
                seat: a.unit.seat,
                team: a.unit.team,
                level: a.unit.level,
                stats: this.resolvedStats(a.unit),
                techs: [...this.techTree.ownedFor(a.unit.seat, a.unit.type.id)],
                attackBoostTier: this.boostState.attack[a.unit.seat],
                hpBoostTier: this.boostState.hp[a.unit.seat],
                speciality: this.speciality[a.unit.seat],
                roundBoostSpeed: this.roundBoosts.speed[a.unit.seat],
                roundBoostRange: this.roundBoosts.range[a.unit.seat],
                items: a.unit.items,
            });
        }
        this.debugLog.log('sim.battleStartStats', { round: this.round, rows: statsRows });
        // the sync point: both peers hash the identical battle-start state
        if (this.net && !this.hydrating) {
            const hash = this.stateHash();
            this.sentChecks.set(this.round, hash);
            this.net.send({ type: 'check', round: this.round, hash });
            this.verifyCheck(this.round);
        }
        // star mode: the deploy-end/battle-start sync-barrier checkpoint.
        // Every client just built this.sim from the identical replicated
        // deployment log, so this hash IS the pre-simulation state — the
        // exact thing that needs to agree before anyone's battle actually
        // starts ticking. Self-suspend FIRST, before the comparator call:
        // the host's own fast path (e.g. sole connected human) can resolve
        // synchronously inside verifyStarSyncBarrier, and setting suspended
        // after that call would clobber an unsuspend that already happened.
        // No pause broadcast needed here — every participant reaches this
        // point and self-suspends on its own initiative (triggered locally
        // by constructing this.sim), so there's nothing to tell anyone;
        // only the eventual resume (resumeIfAllClear's existing broadcast)
        // needs to travel.
        if (this.star && !this.hydrating) {
            const hash = this.stateHash();
            this.suspended = true;
            if (this.star.role === 'guest') {
                this.star.session.send({ type: 'starCheck', round: this.round, seat: this.humanSeat, hash });
            } else {
                this.starChecks.clear();
                this.starChecks.set(this.humanSeat, hash);
                this.starChecksCompared = false;
                // freeze who this collection is waiting on — see the field's
                // own doc comment on why a LATER join/reclaim must never
                // retroactively grow this
                this.starChecksExpectedSeats = [0, ...this.star.hub.connectedSeats()];
                this.starChecksCompared = this.verifyStarSyncBarrier(
                    this.starChecks,
                    this.starChecksExpectedSeats,
                    this.starChecksCompared,
                );
            }
        }
        this.enforceCinemaWorld();
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
            const unit = this.placement.spawn(type, anchor, stamp.team, false, true, stamp.seat);
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

    /**
     * Mid-battle on-kill spawn: one summoned pack at xz, same team/seat/level
     * as the killer. Ids come from {@link PlacementController.spawnAtWorld}
     * so both peers agree.
     */
    private spawnOnKillChild(parent: Unit, typeId: string, x: number, z: number): Unit | null {
        const type = unitTypeById(typeId);
        if (!type) return null;
        const child = this.placement.spawnAtWorld(type, x, z, parent.team, parent.seat);
        child.summoned = true;
        child.deployedRound = this.round;
        child.level = parent.level;
        child.applyLevelLook(child.level);
        child.marchIn = false;
        child.setDeployment(false);
        return child;
    }

    /**
     * Pre-place dormant production children for every living pack that owns a
     * {@link TechDef.produce} tech. The sim releases them on that tech's timer
     * while the parent lives — packs are created here so ids/meshes stay
     * deterministic across peers (no mid-battle spawn injection). Offspring
     * inherit the parent's level.
     */
    private prepareProductionReserves(): void {
        const parents = this.placement
            .allUnits()
            .filter((u) => !u.destroyed && !u.productionHeld)
            .sort((a, b) => a.id - b.id);
        for (const parent of parents) {
            const lanes = ownedProduceTechs(parent.type, parent.seat, (s, t, id) =>
                this.unitHasTech(s, t, id),
            );
            for (const { tech, produce } of lanes) {
                const childType = unitTypeById(produce.typeId);
                if (!childType) continue;
                for (let i = 0; i < produce.max; i++) {
                    // park off to the side — sim relocates to the parent on release
                    const ang = ((i * 2654435761) >>> 0) * ((Math.PI * 2) / 4294967296);
                    const r = 2 + (i % 7) * 0.4;
                    const x = parent.world.x + detCos(ang) * r;
                    const z = parent.world.z + detSin(ang) * r;
                    const child = this.placement.spawnAtWorld(
                        childType,
                        x,
                        z,
                        parent.team,
                        parent.seat,
                    );
                    child.summoned = true;
                    child.productionHeld = true;
                    child.productionParentId = parent.id;
                    child.productionTechId = tech.id;
                    child.marchIn = parent.marchIn;
                    child.deployedRound = this.round;
                    child.level = parent.level;
                    child.applyLevelLook(child.level);
                    child.setDeployment(false);
                    for (const m of child.members) m.mesh.visible = false;
                }
            }
        }
    }

    /**
     * Horde mode (`hordePreset`): on active rounds (see `isHordeRoundActive`),
     * materializes this round's authored pack list as **two forest camps**:
     * a large army (~{@link hordeLeaderShare} toward the HP leader) and a
     * small one on the trailer's side. Each camp is one ring anchor; packs
     * scatter nearby and march in (`Unit.marchIn`).
     */
    private spawnHordeWave(): void {
        if (!isHordeRoundActive(this.settings, this.round)) return;
        const plan = hordeWavePlan(this.round, hordeCountMult(this.settings));
        if (plan.length === 0) return;
        const rng = mulberry32(seedFrom(this.seed, `horde:${this.round}`));
        const leader: Team | null =
            this.playerHp > this.enemyHp ? 'player' : this.enemyHp > this.playerHp ? 'enemy' : null;
        const ownSign = this.map.ownAtFar ? -1 : 1;
        const outerHalfW = this.map.halfW + HORDE_RING_NEAR + HORDE_RING_SPAN;
        const outerHalfH = this.map.halfH + HORDE_RING_NEAR + HORDE_RING_SPAN;
        // Leader's board half in world z; trailer is the opposite. On a tie,
        // still plant two opposite camps (player half = "big" for determinism).
        const leaderSign =
            leader === 'player' ? ownSign : leader === 'enemy' ? -ownSign : ownSign;
        const trailerSign = -leaderSign;
        const bigCamp = this.findHordeRingSpot(rng, leaderSign, outerHalfW, outerHalfH);
        const smallCamp = this.findHordeRingSpot(rng, trailerSign, outerHalfW, outerHalfH);
        const bigShare = leader !== null ? hordeLeaderShare(this.settings) : 0.5;
        let nBig = Math.floor(plan.length * bigShare + 1e-9);
        if (plan.length >= 2) nBig = Math.min(plan.length - 1, Math.max(1, nBig));
        else nBig = plan.length;
        const nSmall = plan.length - nBig;
        for (let i = 0; i < plan.length; i++) {
            const entry = plan[i]!;
            const camp = i < nBig ? bigCamp : smallCamp;
            const zSign = i < nBig ? leaderSign : trailerSign;
            const campN = i < nBig ? nBig : nSmall;
            const spot =
                (camp && this.findHordeSpotNear(rng, camp, campN)) ??
                this.findHordeRingSpot(rng, zSign, outerHalfW, outerHalfH);
            if (!spot) continue;
            const unit = this.placement.spawnAtWorld(entry.type, spot.x, spot.z);
            unit.summoned = true;
            unit.deployedRound = this.round;
            unit.marchIn = true;
            unit.level = entry.level;
            unit.applyLevelLook(entry.level);
        }
    }

    /**
     * A deterministic spawn point outside the playable board, biased toward
     * `zSign`'s half when there's a leader to hunt (0 = unbiased, full
     * frame). Rejects anything actually inside the board, and anything
     * whose straight walk to center would cross deep water — `marchIn` is a
     * plain straight-line seek with no pathfinding, so lakes have to be
     * avoided here, at spawn time, or not at all. Bounded, deterministic
     * retries (same rng stream ⇒ same outcome on every client); `null` if
     * nothing clears in the attempt budget (that pack is simply skipped).
     */
    private findHordeRingSpot(
        rng: () => number,
        zSign: number,
        outerHalfW: number,
        outerHalfH: number,
    ): { x: number; z: number } | null {
        for (let attempt = 0; attempt < HORDE_SPAWN_ATTEMPTS; attempt++) {
            const x = (rng() * 2 - 1) * outerHalfW;
            const zBase = (rng() * 2 - 1) * outerHalfH;
            const z = zSign === 0 ? zBase : zSign * Math.abs(zBase) * 0.55 + zBase * 0.45;
            // true distance past the board edge (0 inside/on the rectangle;
            // same metric scenery.ts's forest belt uses). Rejecting only
            // "literally inside the board" let spots land right at the edge
            // whenever just one axis barely cleared it — this enforces the
            // real HORDE_RING_NEAR..+SPAN annulus instead.
            const d = Math.max(Math.abs(x) - this.map.halfW, Math.abs(z) - this.map.halfH, 0);
            if (d < HORDE_RING_NEAR || d > HORDE_RING_NEAR + HORDE_RING_SPAN) continue;
            if (this.hordePathCrossesWater(x, z)) continue;
            return { x, z };
        }
        return null;
    }

    /**
     * Scatter a pack near a camp anchor while staying in the forest ring and
     * clear of lakes. Radius grows with how many packs share the camp.
     */
    private findHordeSpotNear(
        rng: () => number,
        camp: { x: number; z: number },
        campPacks: number,
    ): { x: number; z: number } | null {
        // ~12 wu for a lone pack; ~34 for 10; capped so we stay in the annulus
        const scatter = Math.min(48, 10 + Math.max(1, campPacks) * 2.4);
        for (let attempt = 0; attempt < HORDE_SPAWN_ATTEMPTS; attempt++) {
            const ang = rng() * Math.PI * 2;
            const r = rng() * scatter;
            const x = camp.x + detCos(ang) * r;
            const z = camp.z + detSin(ang) * r;
            const d = Math.max(Math.abs(x) - this.map.halfW, Math.abs(z) - this.map.halfH, 0);
            if (d < HORDE_RING_NEAR || d > HORDE_RING_NEAR + HORDE_RING_SPAN) continue;
            if (this.hordePathCrossesWater(x, z)) continue;
            return { x, z };
        }
        return null;
    }

    /** deep water at the spawn point itself, or anywhere along the straight
     *  line to board center (0,0) — sampled at a handful of points along it */
    private hordePathCrossesWater(x: number, z: number): boolean {
        if (worldHeightAt(x, z) < HORDE_LAKE_HEIGHT) return true;
        for (let s = 1; s <= HORDE_PATH_SAMPLES; s++) {
            const t = s / (HORDE_PATH_SAMPLES + 1);
            if (worldHeightAt(x * (1 - t), z * (1 - t)) < HORDE_LAKE_HEIGHT) return true;
        }
        return false;
    }

    /** Battle is over: survivors bite into the opponent's HP, then the board resets. */
    private endBattlePhase(): void {
        let hash: number | undefined;
        this.pendingHpDrawPlan = null;
        this.pendingHpDrawPreHp = null;
        if (this.sim) {
            const preHp = { player: this.playerHp, enemy: this.enemyHp };
            const built = buildHpDrawSources(this.sim, this.economy);
            this.postBattleDeathElapsed = this.sim.elapsed;
            this.postBattleDeathTimeBase = this.time;
            // flames die with the battle; remaining oil (unburned) carries over
            this.oilField.adoptOilFrom(this.sim.hazards);
            this.applyBattleResult(this.sim);
            freezeAllCrowWingRates(this.placement.allUnits());
            if (
                !this.hydrating &&
                built.sources.length > 0 &&
                (built.damageToPlayer > 0 || built.damageToEnemy > 0)
            ) {
                this.pendingHpDrawPreHp = preHp;
                this.pendingHpDrawPlan = scheduleHpDrawParticles(built.sources, {
                    damageToPlayer: built.damageToPlayer,
                    damageToEnemy: built.damageToEnemy,
                    hordeLumpPlayer: built.hordeLumpPlayer,
                    hordeLumpEnemy: built.hordeLumpEnemy,
                });
            }
            // capture the battle-end sync-barrier fingerprint BEFORE the sim
            // (and its actors) are torn down below — stateHash() reads
            // this.sim.actors, so this MUST run before `this.sim = null`.
            if (this.star && !this.hydrating) hash = this.stateHash();
        }
        this.sim = null;
        this.selectedActor = null;
        this.projectileRenderer.clear();
        this.stuckBolts.clear();
        // high collapse rubble persists into build; timed chips do not
        this.stoneChips.clearTimed();
        this.fireFx.clear(); // instanced flame tongues are battle-only
        this.towerDebuffFx.clear();
        this.hammerFx.clear();
        this.meteorFx.clear();
        this.cloudFx.clear();
        this.dragonFx.clear();
        this.conversionFx.clear();
        this.oilDripFx.clear();
        this.spellChargeMarkers = [];
        this.oilVisuals.setDraft(null);
        this.oilVisuals.sync(this.oilField, 0, [], false);
        this.spellVisuals.clear(); // active zone markers are battle-only
        this.rallyVisuals.sync([], null); // battle-only follower markers
        if (hash !== undefined && this.star) {
            // Star mode's battle-end / pre-match-end sync barrier: gates
            // BOTH of what used to run immediately below (finishMatch(), or
            // the round cleanup + announceBattleEnd()) behind every
            // connected seat's hash agreeing first — resyncing whoever
            // doesn't, so a divergence gets caught (and corrected) right
            // here instead of an entire extra build phase playing out on
            // top of it, or a winner being shown before everyone actually
            // agrees who won. No pause broadcast needed to get here: every
            // participant reaches this exact point on its own initiative
            // (its own battle just finished) and self-suspends the same
            // way — see startBattlePhase's matching checkpoint.
            this.battleReady.player = true; // drives "waiting for opponent" HUD text for this whole gap — same flag announceBattleEnd already set here
            this.suspended = true;
            this.afterSyncResolved = () => this.finishOrContinueAfterBattle();
            if (this.star.role === 'guest') {
                this.star.session.send({ type: 'battleEnd', round: this.round, seat: this.humanSeat, hash });
            } else {
                this.starBattleEndChecks.set(this.humanSeat, hash);
                // freeze who this round's battle-end collection is waiting
                // on, taken exactly when the HOST's OWN battle ends (not any
                // earlier, e.g. round start — a seat that legitimately joins
                // mid-round, before this point, still correctly belongs in
                // this round's expected set; the field's own doc comment
                // covers why a join AFTER this point must not). Safe to
                // (re)assign unconditionally: this branch runs exactly once
                // per round, on the host, whenever its own battle ends.
                this.starBattleEndChecksExpectedSeats = [0, ...this.star.hub.connectedSeats()];
                this.markStarBattleReady(this.humanSeat);
            }
            return;
        }
        this.finishOrContinueAfterBattle();
    }

    private finishOrContinueAfterBattle(): void {
        if (this.star && this.star.role === 'host' && !this.hydrating) {
            // every OTHER connected seat is still waiting on this exact
            // decision — tell them to run it too, now that the barrier
            // confirms everyone agrees. Reused for BOTH outcomes (continue
            // or match-over): each client (host included) independently
            // decides finishMatch() vs. proceed from its own now-guaranteed-
            // correct HP, rather than the host trying to precompute and
            // announce a verdict of its own.
            this.star.hub.broadcast({ type: 'starNextRound', round: this.round });
        }
        this.hpDrawAfterMatchOver = this.playerHp <= 0 || this.enemyHp <= 0;
        if (this.pendingHpDrawPlan && this.pendingHpDrawPlan.sources.length > 0) {
            this.hpDrawSettleRemaining = HP_DRAW_BATTLE_SETTLE;
            // Show the pre-battle HP during the settle beat so the bar doesn't
            // flash down-then-up when beginHpDrawPhase sets its display values.
            const pre = this.pendingHpDrawPreHp!;
            this.phase = 'hpDraw';
            this.hpDrawDisplayPlayer = pre.player;
            this.hpDrawDisplayEnemy = pre.enemy;
            return;
        }
        this.proceedAfterHpDraw();
    }

    /** Keep render-only death falls / ground tips / building rubble moving after the sim is torn down. */
    private tickPlacementDeathVisuals(): void {
        for (const unit of this.placement.allUnits()) {
            for (const m of unit.members) {
                const mesh = m.mesh;
                const fall = mesh.userData.deathFall as DeathFallState | undefined;
                const tip = mesh.userData.deathTip as DeathTipState | undefined;
                const collapse = mesh.userData.buildingCollapse as BuildingCollapseState | undefined;
                if (fall) {
                    if (
                        !tickDeathFall(mesh, fall, this.time, (wx, wz) =>
                            worldHeightAt(wx, wz) + GROUND_UNIT_Y,
                        )
                    ) {
                        clearDeathFall(mesh);
                    }
                } else if (tip && !tickDeathTip(mesh, tip, this.time)) {
                    clearDeathTip(mesh);
                } else if (collapse && !tickBuildingCollapse(mesh, collapse, this.time)) {
                    clearBuildingCollapse(mesh);
                }
                if ((unit.type.modelId ?? unit.type.id) === CROW_RIDER_MODEL_ID && mesh.userData.instanced) {
                    setCrowWingDeathSplay(mesh, crowWingDeathSplay(this.time, fall, tip));
                }
            }
        }
    }

    private hasPendingDeathVisuals(): boolean {
        for (const unit of this.placement.allUnits()) {
            for (const m of unit.members) {
                if (
                    m.mesh.userData.deathFall ||
                    m.mesh.userData.deathTip ||
                    m.mesh.userData.buildingCollapse
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    private beginHpDrawPhase(): void {
        const plan = this.pendingHpDrawPlan;
        const pre = this.pendingHpDrawPreHp;
        if (!plan || !pre) {
            this.proceedAfterHpDraw();
            return;
        }
        this.hpDrawPlan = plan;
        this.pendingHpDrawPlan = null;
        this.pendingHpDrawPreHp = null;
        this.phase = 'hpDraw';
        this.hpDrawElapsed = 0;
        this.hpDrawPrePlayer = pre.player;
        this.hpDrawPreEnemy = pre.enemy;
        this.hpDrawDisplayPlayer = pre.player;
        this.hpDrawDisplayEnemy = pre.enemy;
        this.phaseRemaining = Math.min(HP_DRAW_MAX_SECONDS, plan.timelineSeconds + 0.85);
        this.placement.enabled = false;
        this.gridOverlay.visible = false;
        this.selectedActor = null;
        this.hpBars.clear();

        this.hpDrawFx.start(plan.sources);
    }

    private tickHpDraw(dtSeconds: number): void {
        const plan = this.hpDrawPlan;
        if (!plan) return;
        this.hpDrawElapsed += dtSeconds;
        const w = this.pixiApp.screen.width;
        const h = this.pixiApp.screen.height;
        const hits = this.hpDrawFx.update(dtSeconds, this.rig.camera, w, h);
        for (const hit of hits) {
            const dmg = Math.round(hit.damage);
            screenShake({
                intensity: hpDrawShakeIntensity(hit.tier, dmg),
                duration: hit.tier === 'high' ? 0.7 : hit.tier === 'medium' ? 0.55 : 0.44,
                frequency: hit.tier === 'high' ? 72 : hit.tier === 'medium' ? 56 : 48,
            });
            if (hit.victim === 'player') this.hpDrawDisplayPlayer -= dmg;
            else this.hpDrawDisplayEnemy -= dmg;
        }
        this.hpDrawDisplayPlayer = Math.max(this.playerHp, this.hpDrawDisplayPlayer);
        this.hpDrawDisplayEnemy = Math.max(this.enemyHp, this.hpDrawDisplayEnemy);

        const done =
            this.hpDrawFx.allHit() ||
            this.hpDrawElapsed >= plan.timelineSeconds + 0.7 ||
            this.phaseRemaining <= 0;
        if (done) {
            this.flushHpDrawDisplay();
            this.proceedAfterHpDraw();
        }
    }

    private flushHpDrawDisplay(): void {
        this.hpDrawDisplayPlayer = this.playerHp;
        this.hpDrawDisplayEnemy = this.enemyHp;
        this.hpDrawFx.clear();
        this.hpDrawPlan = null;
    }

    /** Continues the round after HP-draw VFX (or when skipped). */
    private proceedAfterHpDraw(): void {
        this.flushHpDrawDisplay();
        this.hpDrawSettleRemaining = 0;
        if (this.hpDrawAfterMatchOver) {
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
        if (this.star && !this.hydrating) {
            this.startBuildPhase();
            return;
        }
        this.announceBattleEnd();
    }

    /** local battle sim finished — tell the peer, then wait for theirs too
     *  before starting the next build phase (fast-forward speed is per-client,
     *  so the two sides don't necessarily finish watching at the same time).
     *  Classic 1v1 / single-player / hydrating fallthrough only — star mode's
     *  own ready+hash reporting happens earlier, in endBattlePhase, since the
     *  sync-barrier check needs the hash before the sim is torn down. */
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

    /**
     * Star host only: track a seat's "done watching" signal; once every
     * HUMAN seat (AI seats never watch, always vacuously ready) has checked
     * in AND its hash has landed in `starBattleEndChecks`, run the shared
     * sync-barrier comparison — which, once it resolves (immediately if
     * everyone already agrees, or after resyncing whoever doesn't), broadcasts
     * the go-ahead and starts the next round via `resumeIfAllClear`'s
     * `afterSyncResolved` continuation (see endBattlePhase/
     * finishOrContinueAfterBattle), not directly here.
     */
    private markStarBattleReady(seat: SeatId): void {
        if (!this.star || this.star.role !== 'host') return;
        this.starBattleReadySeats.add(seat);
        const allReady = this.seats.every(
            (def, i) => def.controller !== 'human' || this.starBattleReadySeats.has(i),
        );
        if (!allReady || this.hydrating) return;
        this.starBattleEndChecksCompared = this.verifyStarSyncBarrier(
            this.starBattleEndChecks,
            this.starBattleEndChecksExpectedSeats,
            this.starBattleEndChecksCompared,
        );
    }

    /** someone hit 0 HP — freeze the game and show the result */
    private finishMatch(): void {
        this.matchOver = true;
        // whatever ended the match, a "Waiting…"/reconnect notice must
        // never survive it — otherwise it can be left mounted (and, on
        // the next tick's countdown re-render, re-shown) after the game
        // is torn down. See resumeIfAllClear's own matchOver branch for
        // the specific sequencing bug this was found from.
        this.suspended = false;
        this.suspendDeadline = null;
        this.hud.hideNotice();
        // watching mode never touches these in the first place (see
        // constructor/main.ts) — clearing them here would wipe out the
        // player's real, unrelated saved game/resume marker
        if (!this.watching) {
            clearStarResumeMarker();
            clearSinglePlayer();
        }
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
        // watching someone else's (or your own) already-recorded match end
        // again isn't a new result to report — it's the same match — EXCEPT
        // verify mode, which specifically re-submits through the normal
        // telemetry pipeline: stats.php's per-side dedupe means an exact
        // recomputed match stores nothing new (implicitly "verified, still
        // matches"), while any divergence creates a second file for that
        // side — exactly the mismatch signal worth flagging for review.
        // Rating never applies here either way — it's not a new result.
        if (!this.watching) {
            this.reportMatchTelemetry(result);
            this.reportOpenRating(result);
        } else if (this.replayVerify) {
            this.reportMatchTelemetry(result);
        }
        if (this.replayVerify) {
            this.replayFinalResult = { result, rounds: this.round, playerHp: this.playerHp, enemyHp: this.enemyHp };
        }
        // a spectator/replay viewer has no side of their own — "VICTORY"/
        // "DEFEAT" is whatever this.humanSeat arbitrarily anchors to, not a
        // real result for them. Show who actually won instead.
        const title = this.watching ? this.winningSideTitle(result) : undefined;
        if (this.replayVerify && this.replayExpected) {
            const exp = this.replayExpected;
            const matches =
                result === exp.result && this.round === exp.rounds &&
                this.playerHp === exp.playerHp && this.enemyHp === exp.enemyHp;
            const note = matches
                ? `✓ Matches recorded result (${exp.result}, ${exp.rounds} rounds, ${exp.playerHp}-${exp.enemyHp})`
                : `⚠ MISMATCH — recorded ${exp.result}/${exp.rounds} rounds/${exp.playerHp}-${exp.enemyHp}, this run: ${result}/${this.round} rounds/${this.playerHp}-${this.enemyHp}`;
            this.hud.showGameOver(result, { note, backLabel: 'Back to replays', title });
        } else {
            this.hud.showGameOver(result, { title });
        }
    }

    /** neutral "who actually won" label for a spectator/replay viewer —
     *  independent of this.humanSeat, which is just an arbitrary display
     *  reference for them, not a real side. */
    private winningSideTitle(result: 'victory' | 'defeat' | 'draw'): string {
        if (result === 'draw') return 'DRAW';
        const alive: SideId[] = [];
        for (let side = 0; side < this.hp.length; side++) {
            if (this.hp[side]! > 0) alive.push(side);
        }
        if (alive.length !== 1) return 'DRAW';
        const names = sideIdsOf(this.seats, alive[0]!)
            .map((seat) => this.seats[seat]!.name)
            .join(' & ');
        return `${names.toUpperCase()} WINS`;
    }

    /** the opponent never reconnected within the grace window — win by forfeit */
    private forfeitWin(): void {
        if (this.matchOver) return;
        this.matchOver = true;
        this.suspended = false;
        clearStarResumeMarker();
        clearSinglePlayer();
        // report before tearing down net — mode/side derive from it still being set.
        // reportMatchTelemetry (not just the rating) matters here specifically: a
        // forfeit-won 1v1 match previously uploaded NOTHING but the bare rating
        // call, so there was no independent replay/action-log record anywhere to
        // cross-check against for exactly the matches most likely to involve a
        // quitting/timed-out opponent trying to dodge a loss.
        this.reportMatchTelemetry('victory');
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
        // 2v2 is unranked v1 (no Elo concept for >2 seats yet, per plan) —
        // skip rather than mislabel; proper mode-tagged telemetry is a
        // separate, later piece of work. Seat COUNT, not `this.star`
        // truthiness — classic 1v1 now runs over the star transport too
        // (Phase 1), so `this.star` alone can no longer tell a real 1v1
        // apart from an actual 2v2+ (this used to unconditionally skip
        // ranked reporting for every 1v1-over-star match — the exact same
        // this.star/this.net-no-longer-distinguishes-1v1 shape already
        // fixed once for startSpectatorHub's room-list "1v1"/"2v2" label).
        if (this.seats.length > 2) return;
        // only ONE side may report a given match, to avoid double-
        // submitting the same result: the star host (mirroring net's own
        // side==='a' check below — this.net is null for a star-based 1v1,
        // so without this a guest would ALSO report, double-counting it).
        if (this.star && this.star.role !== 'host' && !forceReport) return;
        if (this.net && this.side !== 'a' && !forceReport) return;
        try {
            // 'mp' for ANY real network connection — this.net alone used to
            // be sufficient, but is null for a star-based 1v1.
            const mode = this.star || this.net ? 'mp' : 'ai';
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
     * Best-effort upload for balance stats — and, in multiplayer, the raw
     * material for a future replay-divergence check: every real client
     * (both 1v1 sides, every connected star seat) submits its OWN
     * independently-derived record rather than just one side. `stats.php`'s
     * dedup is a content fingerprint that includes `result`, which is
     * perspective-flipped between sides by construction (my victory is your
     * defeat) — so two honest submissions of the same match never collide
     * and both get stored, which is exactly what's wanted here. They aren't
     * yet tied together by an explicit shared match id, though (unlike a
     * dedup fingerprint, that needs to be order-independent between "my
     * name, their name" on each side) — fine for just collecting data now,
     * but worth adding whenever an actual divergence-check tool gets built.
     * Never blocks or throws if the PHP backend is down.
     */
    private reportMatchTelemetry(result: 'victory' | 'defeat' | 'draw'): void {
        try {
            const full = this.exportReplay();
            // Default: seed+settings stub only (empty actions) so matchKey still
            // groups both sides without storing the action log. Opt in with
            // ?telemetryReplay=1 or localStorage mechili-telemetry-replay=1.
            const replay = telemetryIncludeReplay()
                ? full
                : { version: full.version, seed: full.seed, settings: full.settings, actions: [] };
            submitMatchTelemetry({
                schema: TELEMETRY_SCHEMA,
                ts: Math.floor(Date.now() / 1000),
                gameVersion: GAME_VERSION,
                channel: telemetryChannel(),
                // seat COUNT decides '2v2' vs 'mp' now, not `this.star`
                // truthiness — 1v1 is a 2-seat star match too, and should
                // still report as ordinary 'mp', same as it always has.
                mode: this.replayOriginalMode ?? (this.seats.length > 2 ? '2v2' : this.star || this.net ? 'mp' : 'ai'),
                side: this.side,
                source: this.replayVerify ? 'verify' : 'player',
                result,
                rounds: this.round,
                playerHp: this.playerHp,
                enemyHp: this.enemyHp,
                names: { ...this.playerNames },
                // telemetry schema is unchanged (one speciality per side) —
                // reports the primary seat's, same as the persistent UI label
                speciality: {
                    player: this.speciality[primarySeatOf(this.seats, 'player')]!,
                    enemy: this.speciality[primarySeatOf(this.seats, 'enemy')]!,
                },
                units: summarizeUnits(this.placement.allUnits()),
                techs: summarizeTechs(this.techTree, this.seats),
                damage: summarizeDamage(this.matchDamageByType),
                // telemetry reporting only — merges every seat's own unlocks
                // per side (each seat's shop stays exclusively its own in play)
                unlocked: {
                    player: [...new Set(seatIdsOf(this.seats, 'player').flatMap((s) => this.unlockedUnits[s]!))],
                    enemy: [...new Set(seatIdsOf(this.seats, 'enemy').flatMap((s) => this.unlockedUnits[s]!))],
                },
                // full canonical roster — the only place a 2v2+ match's
                // complete participant list (including AI-filled seats)
                // gets recorded; names/speciality/units above stay a
                // 2-bucket "mine vs the other side" reduction for existing
                // consumers (replays.html)
                roster: this.seats.map((s, seat) => ({
                    seat,
                    side: s.side === 0 ? 'a' : ('b' as const),
                    controller: s.controller,
                    name: s.name,
                })),
                replay,
            });
        } catch {
            // telemetry must never affect the game-over flow
        }
    }

    /**
     * Every surviving PLAYER-owned unit deals its value as damage to the
     * other side: the unit's base price scaled by how much of it survived
     * (half the dwarf pack alive = half its cost), always a whole number. On
     * a timeout both sides usually still have some survivors and both take
     * some damage. Horde survivors deal no HP damage while EITHER player
     * still has forces standing — the horde thins out packs (and therefore
     * score) without being a third scoring party of its own. Only once a
     * side is fully wiped (no survivors of its own) does it also take the
     * horde's surviving value on top of the opposing player's: nothing of
     * its own was left to stop either force.
     */
    private applyBattleResult(sim: BattleSim): void {
        accumulateBattleDamage(this.matchDamageByType, sim.damageByType);
        const built = buildHpDrawSources(sim, this.economy);
        const damageToPlayer = built.damageToPlayer;
        const damageToEnemy = built.damageToEnemy;
        this.playerHp = this.playerHp - damageToPlayer;
        this.enemyHp = this.enemyHp - damageToEnemy;
        this.debugLog.log('hp.applyBattleResult', {
            watching: this.watching,
            round: this.round,
            damageToPlayer,
            damageToEnemy,
            hordeValue: built.hordeValue,
            playerSurvived: built.playerSurvived,
            enemySurvived: built.enemySurvived,
            playerHp: this.playerHp,
            enemyHp: this.enemyHp,
            unitCount: sim.unitSurvivors().size,
        });
    }

    /** swaps the build-phase overlay for one matching the current zone rules */
    private refreshOverlay(): void {
        const wasVisible = this.gridOverlay.visible;
        this.scene.remove(this.gridOverlay);
        const material = this.gridOverlay.material as import('three').MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
        this.gridOverlay.geometry.dispose();
        this.gridOverlay = this.map.createOverlayMesh(seatLane(this.seats, this.humanSeat));
        this.gridOverlay.visible = wasVisible;
        this.scene.add(this.gridOverlay);
    }

    private resize(width: number, height: number): void {
        this.renderer.setSize(width, height, false);
        this.rig.resize(width, height);
    }

    /** dev-only (`?debug`): periodically ships pending debug events to the
     *  host over whichever channel this client has — real elapsed time, not
     *  `gameDt`, so the cadence doesn't stall when speed is 0 or watching a
     *  paused replay. No-op on the host itself (nothing ever queues there —
     *  see DebugLog.log's isHost branch). */
    private flushDebugLog(dtSeconds: number): void {
        if (!this.debugLog.enabled) return;
        this.debugFlushAccum += dtSeconds;
        if (this.debugFlushAccum < 0.3) return;
        this.debugFlushAccum = 0;
        this.sendDebugBatch();
    }

    private sendDebugBatch(): void {
        const events = this.debugLog.takePending();
        if (events.length === 0) return;
        if (this.spectateSession) {
            this.spectateSession.send({ type: 'debugLog', events });
        } else if (this.star && this.star.role === 'guest') {
            this.star.session.send({ type: 'debugLog', events });
        } else if (this.net) {
            this.net.send({ type: 'debugLog', events });
        }
    }

    private tick(dtSeconds: number): void {
        if (this.disposed) return;
        // The sim's OWN elapsed time must be the TRUE, unclamped wall-clock
        // gap since the last tick, not dtSeconds — PixiJS's ticker clamps
        // its own deltaMS to at most 100ms by default (minFPS=10),
        // silently DISCARDING anything beyond that rather than deferring
        // it. That's harmless for the purely cosmetic consumers of
        // dtSeconds/gameDt below (camera, particles, ambient motion — a
        // one-time visual jump when a tab refocuses is fine), but the
        // deterministic battle sim can't tolerate it: a backgrounded/
        // throttled tab (a passive spectator tab left unfocused is the
        // common case, but any client's tab losing focus counts) would
        // otherwise permanently process FEWER total fixed steps than a
        // client that never dropped frames, producing a genuinely
        // different, wrong battle result instead of just a delayed one.
        // BattleSim.update() itself now retains and catches up on however
        // large this gets (capped per call, carrying over the rest) — see
        // its own doc comment.
        const nowMs = performance.now();
        // Same condition the sim-update guard below uses. When it's false,
        // sim.update() won't run this frame — and if it was ALSO false on
        // recent prior frames (a star reconnect's "suspended" pause can last
        // up to STAR_RECONNECT_GRACE_MS, and a backgrounded/sleeping tab can
        // let real time pile up across that whole window), a resuming
        // client's catch-up (fastForwardBattle/replayLogFrom — either a
        // still-connected seat just un-pausing, or a reconnected/resynced
        // seat's freshly-reconstructed Game hydrating fresh) already brings
        // sim.elapsed to the correct point on its own. Letting a stale
        // lastSimRealTimeMs leak that same
        // gap into trueDtSeconds on the first tick after resuming would feed
        // it AGAIN, double-advancing the sim past where it should be — reset
        // to null whenever we're not sim-active so the next active tick
        // starts fresh, exactly like the very first tick ever does.
        const simTimingActive = !this.matchOver && !this.suspended && !this.introActive && !this.outroActive;
        const trueDtSeconds =
            this.lastSimRealTimeMs === null ? dtSeconds : (nowMs - this.lastSimRealTimeMs) / 1000;
        this.lastSimRealTimeMs = simTimingActive ? nowMs : null;
        if (this.introActive) this.tickMatchIntro(dtSeconds);
        if (this.outroActive) this.tickMatchOutro(dtSeconds);
        this.flushDebugLog(dtSeconds);
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
        // — except when watching a replay, where the same speed control
        // scales build-phase pacing too (nothing live to keep at real time)
        const gameDt =
            this.phase === 'battle' || this.watching
                ? dtSeconds * this.speedSteps[this.speedIndex]!
                : dtSeconds;
        // same speed-multiplier scaling as gameDt, just built on the TRUE
        // dt — this is what actually reaches sim.update() below
        const trueGameDt =
            this.phase === 'battle' || this.watching
                ? trueDtSeconds * this.speedSteps[this.speedIndex]!
                : trueDtSeconds;
        this.time += gameDt;

        if (this.hpDrawSettleRemaining > 0 || this.hasPendingDeathVisuals()) {
            this.tickPlacementDeathVisuals();
        }
        if (this.hpDrawSettleRemaining > 0) {
            this.hpDrawSettleRemaining -= dtSeconds;
            if (this.hpDrawSettleRemaining <= 0 && this.pendingHpDrawPlan) {
                this.beginHpDrawPhase();
            }
        }

        let simSteps = 0;
        let simCpu: Record<string, number> | undefined;

        if (simTimingActive) {
            // freeze MY clock once I've personally picked, until EVERYONE
            // has (teammate or enemy) — the per-seat analogue of "I've
            // picked, waiting on the opponent" now that there's no single
            // shared per-side speciality value to check anymore
            const waitingForStarterPeer =
                this.round === 0 &&
                this.starterPicked[this.humanSeat] &&
                !this.starterPicked.every(Boolean);
            // freeze once I've locked in — solo used to keep draining the
            // timer (and re-firing onDeployTimerExpired) while waiting on the
            // AI / an ally, which is how a stuck resume showed 0:00 forever
            const waitingForDeployPeer =
                this.phase === 'build' && !!this.seatReady[this.humanSeat];
            if (!waitingForStarterPeer && !waitingForDeployPeer) {
                this.phaseRemaining -= gameDt;
            }
            if (this.phase === 'build') {
                if (this.watching) this.tickReplayPlayback();
                if (this.phaseRemaining <= 0) this.onDeployTimerExpired();
            } else if (this.phase === 'hpDraw') {
                this.tickHpDraw(dtSeconds);
            } else if (this.sim) {
                if (profile) {
                    this.sim.profileEnabled = true;
                    cpu.begin();
                }
                this.sim.update(trueGameDt);
                if (profile) {
                    cpu.end('sim');
                    simSteps = this.sim.lastProfileSteps;
                    simCpu = this.sim.lastProfile;
                    this.sim.profileEnabled = false;
                }
                const battleEvents = this.sim.consumeEvents();
                this.particles.spawnFromEvents(battleEvents);
                this.stuckBolts.spawnFromEvents(battleEvents, (i) => {
                    const a = this.sim?.actors[i];
                    if (!a) return null;
                    return {
                        mesh: a.mesh,
                        modelId: a.unit.type.modelId ?? a.unit.type.id,
                        structure: !!a.unit.type.structure,
                    };
                });
                this.stoneChips.spawnFromEvents(battleEvents, (x, z) => groundHeightAt(x, z));
                this.fireFx.spawnFromEvents(battleEvents);
                this.towerDebuffFx.spawnFromEvents(battleEvents);
                this.stampWearFromEvents(battleEvents);
                for (const ev of battleEvents) {
                    if (ev.kind === 'spellMeteor') {
                        this.meteorFx.spawnShardImpact(ev.x, ev.z, ev.at);
                    } else if (ev.kind === 'spellLightning') {
                        this.cloudFx.spawnLightning(ev.x, ev.z, this.sim.elapsed);
                    } else if (ev.kind === 'hazardDrip') {
                        this.oilDripFx.spawnDrip(ev.hazard, ev.x, ev.z, ev.at);
                    } else if (ev.kind === 'convert') {
                        // flash + move instanced mesh into the new team's pool
                        this.particles.burst(ev.x, ev.y, ev.z, {
                            count: 22,
                            color: colorForBattleTeam(ev.team).hex,
                            speed: 8,
                            life: 0.55,
                            up: 5,
                        });
                        const converted = this.sim.actors.find((a) => a.index === ev.index);
                        if (converted) this.unitInstances.ensureTeam(converted.mesh, ev.team);
                    }
                }
                this.oilVisuals.sync(this.sim.hazards, this.sim.elapsed, [], false);
                this.map.setHazardTime(this.time);
                this.map.flushHazardMask();
                if (profile) cpu.begin();
                this.sim.syncMeshes(); // per-frame interpolated positions
                if (profile) cpu.end('syncMeshes');
                // advance wave before tint gate so rim coverage matches this frame
                this.towerDebuffFx.update(gameDt);
                if (profile) cpu.begin();
                const crashLands = this.sim.syncBattleVisuals(this.time, (seat, x, z) =>
                    this.towerDebuffFx.waveRevealsDebuffTint(seat, x, z),
                );
                for (const p of crashLands) {
                    // soil kick + pale grit when an air wreck hits the lawn
                    this.particles.burst(p.x, p.y, p.z, {
                        count: 14,
                        color: 0x8a6a42,
                        speed: 6,
                        life: 0.5,
                        up: 5,
                    });
                    this.particles.burst(p.x, p.y + 0.15, p.z, {
                        count: 8,
                        color: 0xc4b89a,
                        speed: 3.5,
                        life: 0.6,
                        up: 3,
                        blood: true,
                    });
                }
                if (profile) cpu.end('battleVisuals');
                this.stuckBolts.sync();
                this.projectileRenderer.update(this.sim.projectiles, this.sim.alpha);
                this.dragonFx.update(this.sim.renderElapsed);
                this.fireFx.setBreathTongues(this.dragonFx.getBreathTongueSamples());
                this.fireFx.update(gameDt, this.sim.hazards, this.sim.elapsed);
                this.fireFx.updateBurningActors(gameDt, this.sim.actors, this.sim.elapsed);
                const battleShields = livingShieldDisks(this.placement.allUnits());
                this.hammerFx.update(this.sim.renderElapsed, battleShields);
                this.meteorFx.update(this.sim.renderElapsed, battleShields);
                this.cloudFx.update(this.sim.renderElapsed);
                this.conversionFx.update(this.sim.actors, this.sim.renderElapsed);
                this.oilDripFx.update(this.sim.renderElapsed);
                // acid/poison/storm/meteor-shower zones + hammer charge rings
                // (hidden in cinema — same clean battle look as deploy stamps)
                if (this.hud.isUiHidden) {
                    this.spellVisuals.syncBattleMarkers([], [], this.sim.elapsed);
                } else {
                    this.spellVisuals.syncBattleMarkers(
                        this.sim.activeZoneMarkers(),
                        this.spellChargeMarkers,
                        this.sim.elapsed,
                    );
                }
                // the battle clock is the sim's own fixed-step time; the sim
                // itself stops at the deciding step, identically on any peer
                this.phaseRemaining = this.battleSeconds() - this.sim.elapsed;
                if (this.sim.finished) this.endBattlePhase();
            }
        }
        if (profile) cpu.begin();
        this.particles.update(gameDt);
        this.stoneChips.update(gameDt);
        this.updateForgeFx(gameDt);
        this.updateStrongholdFlags();
        this.updateHordeMarkers();

        if (!this.introActive && !this.outroActive) {
            this.controls.update(dtSeconds);
            this.gamepad.update(dtSeconds);
            this.rig.update(dtSeconds);
        }
        // ambient motion runs on real time, unaffected by battle fast-forward
        this.scenery.update(dtSeconds, this.rig.camera.position);
        // Flash the cinema scene label whenever the season turns over (manual N/X
        // keys or the automatic per-round scene) — only while cinema mode is on.
        if (this.weather) {
            const season = this.weather.season;
            if (season !== this.lastHintSeason) {
                this.lastHintSeason = season;
                this.refreshCinemaHint();
            }
        }
        this.map.setSnowCover(this.scenery.groundSnowCover);
        updateAnimatedUnits(gameDt); // rigged walk/fire — scales with battle speed
        // Hide “you can move me” hints + disable visual repositioning once
        // End Deployment has locked this seat in.
        this.placement.repositioningEnabled = this.playerCanAct;
        this.placement.update(this.time, gameDt);
        if (this.phase === 'build' && !this.hud.isUiHidden) this.syncTacticVisuals();
        if (profile) cpu.end('world/ui');
        if (profile) cpu.begin();
        this.unitInstances.sync(gameDt, this.phase === 'battle');
        if (profile) cpu.end('instances');
        if (profile) cpu.begin();
        this.updateBlobShadows();
        this.tickShadowMapUpdate();
        this.updateSandWear();
        this.updateSelectionUi();
        this.drainRemoteQueue();
        this.drainStarRemoteQueue();
        this.drainSpectateQueue();
        const waitingForPeer =
            ((this.net !== null || this.star !== null) &&
                !this.matchOver &&
                ((this.phase === 'build' && this.deployReady.player && !this.deployReady.enemy) ||
                    (this.awaitingCards && this.round === 0 && this.starterPicked[this.humanSeat]) ||
                    (this.battleReady.player && !this.battleReady.enemy))) ||
            // locked in (solo vs AI too): hide shop / End Deployment — without
            // this, solo showed a clickable End Deployment that no-op'd while
            // waiting on the bot (or after a resume that never re-ran the AI)
            (this.phase === 'build' && !this.matchOver && !!this.seatReady[this.humanSeat]) ||
            // watching: nothing here is ever "mine" to act on — reuse the
            // same full-hide treatment for the whole build UI, not just the
            // few individual gates (playerCanAct, canUndo, round-card
            // offers) patched above
            this.watching;
        // team modes: a teammate on my own side may have locked in deployment
        // already while I haven't clicked yet — deployReady.player only
        // flips once EVERY seat on my side has, so this needs its own check
        const allyLockedIn =
            this.phase === 'build' &&
            !this.deployReady.player &&
            seatIdsOf(this.seats, 'player').some(
                (seat) => seat !== this.humanSeat && this.seatReady[seat],
            );
        this.hud.setPhase(this.round, this.phase, this.phaseRemaining, waitingForPeer, allyLockedIn, this.watching);
        // live countdown on the "Waiting…" seat-drop notice — re-render
        // only when the displayed second actually changes, not every frame.
        // matchOver-gated too: finishMatch/resumeIfAllClear already null
        // this out on every known match-end path, but this is the one
        // per-frame spot that would otherwise re-summon a stale notice on
        // the very next tick if some future path ever misses that.
        if (this.suspendDeadline !== null && !this.matchOver) {
            const remainingS = Math.max(0, Math.ceil((this.suspendDeadline - performance.now()) / 1000));
            if (remainingS !== this.lastSuspendNoticeSecond) {
                this.lastSuspendNoticeSecond = remainingS;
                this.showSuspendNotice();
            }
        }
        this.hud.setUndoVisible(this.canUndo());
        this.hud.setDeploys(
            this.deployState.used[this.humanSeat]!,
            this.deployState.limit[this.humanSeat]! + this.deployState.extra[this.humanSeat]!,
            this.settings.deploy.extrasBudgetPerRound - this.deployState.extrasSpent[this.humanSeat]!,
        );
        this.hud.setShopRuneCost(
            this.settings.deploy.baseRuneCost +
                this.deployState.runesBought[this.humanSeat]! * this.settings.deploy.runeCostStep,
            this.economy.balance(this.humanSeat),
        );
        {
            const oven = this.forgeSlots.player ?? [];
            this.hud.setForgeRecipeContext(
                this.teamForgePool('player'),
                oven.filter((s): s is ForgeSlot => !!s).map((s) => s.itemId),
            );
        }
        this.hud.setInventory(this.inventoryView(), this.tacticsView());
        this.hud.setItemGhostDropReady(this.placement.itemDropHovering);
        const enemyInv = this.enemyInventoryView();
        this.hud.setEnemyInventory(enemyInv.items, enemyInv.tactics, {
            sellAbility: enemyInv.sellAbility,
        });
        this.hud.setEnemyForgeOven(this.enemyForgeOvenView());
        this.hud.setRoundCardPicks(
            this.roundCardPicksView('player'),
            this.enemyActionIntelVisible() ? this.roundCardPicksView('enemy') : [],
        );
        // rally sync is folded into syncTacticVisuals during build; in battle
        // keep a route visible while any living mech is still marching on it
        // (cinema hides these with the other spell ground chrome)
        if (this.phase === 'battle') {
            this.rallyVisuals.sync(
                this.hud.isUiHidden ? [] : (this.sim?.activeRallyRoutes() ?? []),
                null,
            );
        }
        this.hud.setSupply(this.economy.balance(this.humanSeat));
        this.hud.setLevelAllGlobal(this.playerCanAct ? this.globalLevelUpInfo() : null);
        this.refreshShopHud();
        this.paintHudHp();
        this.hud.layout();
        if (profile) cpu.end('hud');
        if (profile) cpu.begin();
        updateScreenShake(dtSeconds);
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
            weatherLines: this.weather?.debugLines(),
            effectLines: this.effectToggles.debugLines(),
        }, dtSeconds);

        if (this.onStateCheckpoint && !this.net && !this.star && !this.matchOver && !this.hydrating) {
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
                // horde packs are numerous enough that even normal per-unit
                // wear stamping (same rate as a player's army) turns the
                // whole board sandy within a match, with a hard rectangular
                // edge at the board boundary (marching units outside never
                // stamp at all) — so horde never stamps ground wear, on or
                // off the board
                if (t.structure || t.extra || t.flying || a.unit.team === 'horde') continue;
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
                if (e.flesh) {
                    this.map.stampBlood(e.x, e.z, 1.1, 0.55, e.blood);
                } else {
                    // grit / soot under masonry and other non-flesh hits
                    this.map.stampScorch(e.x, e.z, e.masonry ? 1.6 : 1.1, e.masonry ? 0.28 : 0.14);
                }
            } else if (e.kind === 'death') {
                if (e.wear === 'ash') {
                    // Structures: brick debris only — no ground ash scar
                    if (e.structure) continue;
                    this.map.stampScorch(
                        e.x,
                        e.z,
                        e.big ? 10 : 7,
                        e.big ? 0.7 : 0.55,
                    );
                } else if (e.wear === 'blood') {
                    this.map.stampBlood(e.x, e.z, e.big ? 2.4 : 1.35, e.big ? 0.75 : 0.65, e.blood);
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
            } else if (e.kind === 'towerDebuff') {
                // dark burn under the lost tower — team-tint flash is visual-only in TowerDebuffFx
                this.map.stampScorch(e.x, e.z, 14, 0.8);
                this.map.stampScorch(e.x, e.z, 22, 0.35);
            }
        }
    }

    /**
     * Living mech under the click: 3D collider / structure-mesh ray first,
     * then a soft screen-distance fallback so tiny mechs stay easy to tap.
     */
    private pickActor(e: PointerEvent): Actor | null {
        if (!this.sim) return null;
        const rect = this.pixiApp.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;

        const raycaster = this.rig.setPickRay(sx, sy, w, h);
        const ray = raycaster.ray;
        let bestRay: Actor | null = null;
        let bestRayT = Infinity;
        let bestScreen: Actor | null = null;
        let bestScreenD = Infinity;

        for (const a of this.sim.actors) {
            if (!a.alive) continue;
            const t = a.unit.type;

            forEachPickSphere(t, a.rx, a.footY, a.rz, (cx, cy, cz, r) => {
                const hitT = raySphereT(ray, cx, cy, cz, r);
                if (hitT !== null && hitT < bestRayT) {
                    bestRayT = hitT;
                    bestRay = a;
                }
            });

            // towers keep real meshes — catch antenna / overhang the spheres miss
            if (t.structure && a.mesh && !a.mesh.userData.instanced) {
                const meshT = rayMeshT(raycaster, a.mesh);
                if (meshT !== null && meshT < bestRayT) {
                    bestRayT = meshT;
                    bestRay = a;
                }
            }

            const groundY = a.altitude > 0 ? 0 : groundHeightAt(a.rx, a.rz);
            const screen = this.rig.worldToScreen(
                a.rx,
                groundY + a.altitude + t.meshScale * 0.55,
                a.rz,
                w,
                h,
            );
            if (!screen) continue;
            const d = Math.hypot(screen.x - sx, screen.y - sy);
            const pickRadius = Math.max(28, t.meshScale * 22);
            if (d < pickRadius && d < bestScreenD) {
                bestScreenD = d;
                bestScreen = a;
            }
        }
        return bestRay ?? bestScreen;
    }

    /** the range ring follows the selected battle mech, tinted by its team */
    private updateBattleRangeRing(): void {
        const a = this.phase === 'battle' ? this.selectedActor : null;
        this.battleRangeMesh.visible = a !== null;
        // gold aura ring for a selected mech with a special-ability radius
        const auraRadius = a ? this.auraRadiusOf(a.unit) : null;
        this.battleAuraMesh.visible = a !== null && auraRadius !== null;
        const minRange = a ? this.resolvedStats(a.unit).minRange : 0;
        this.battleMinRangeMesh.visible = a !== null && minRange > 0;
        if (!a) return;
        const radius =
            this.resolvedStats(a.unit).range + a.unit.type.collisionRadius;
        placeRangeRing(this.battleRangeMesh, a.rx, a.rz, radius);
        const material = this.battleRangeMesh.material as import('three').MeshBasicMaterial;
        material.color.setHex(colorForBattleTeam(actorTeam(a)).hex);
        if (minRange > 0) {
            placeRangeRing(this.battleMinRangeMesh, a.rx, a.rz, minRange + a.unit.type.collisionRadius);
        }
        if (auraRadius !== null) {
            placeRangeRing(this.battleAuraMesh, a.rx, a.rz, auraRadius);
            pulseAuraRing(this.battleAuraMesh, performance.now());
        }
    }

    /**
     * Radius of a unit's special-ability aura, or null when it has none.
     * Currently the ballista Golden Aura (tech `golden`); drives the gold ring.
     */
    private auraRadiusOf(unit: Unit): number | null {
        // only while the matching tech tile is hovered/peeked in the panel.
        // The Golden Aura tile only shows on a ballista, so hovering it is
        // enough — preview the radius whether or not the tech is bought yet.
        if (this.hoveredTech !== 'golden') return null;
        if (unit.type.id === 'ballista') return GOLDEN_AURA_RADIUS;
        return null;
    }

    private updateSelectionUi(): void {
        if (this.disposed) return;
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
            // formations are move-only — no shared details across mixed packs
            if (this.placement.hasSelectedGroup) {
                this.hud.setFormationSelection();
            } else {
                const unit = this.placement.selectedUnit;
                buildInfo = unit ? this.unitInfo(unit) : null;
                this.hud.setSelection(buildInfo);
            }
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
            // Compact bar owns Level / Upgrade; the Unit sheet hides those tiles there
            upgrade:
                build && buildInfo?.towerUpgrade && !buildInfo.towerUpgrade.maxed
                    ? {
                          cost: buildInfo.towerUpgrade.cost,
                          affordable: buildInfo.towerUpgrade.affordable,
                      }
                    : null,
        });
    }

    /**
     * Top-bar label for a whole side: the classic single name in 1v1, or
     * every seat's name joined ("You & Ally") once a side has more than one
     * commander — a cheap fix that surfaces all 4 duo names without
     * reworking the fight bar's fixed one-slot-per-side markup.
     */
    private sideLabel(team: Team): string {
        const ids = seatIdsOf(this.seats, team);
        if (ids.length <= 1) {
            return team === 'player' ? this.playerNames.local : this.playerNames.opponent;
        }
        return ids
            .map((seat) => (seat === this.humanSeat ? this.playerNames.local : this.seats[seat]!.name))
            .join(' & ');
    }

    /** display name for the side (or, in duo modes, the SEAT) that owns a pack */
    private ownerName(team: BattleTeam, seat?: SeatId): string {
        if (team === 'horde') return DISPLAY.horde;
        // classic two-seat roster: exact existing wording, unchanged
        if (this.seats.length <= 2 || seat === undefined || seat < 0) {
            return team === 'player' ? this.playerNames.local : this.playerNames.opponent;
        }
        if (seat === this.humanSeat) return this.playerNames.local;
        return this.seats[seat]?.name ?? (team === 'player' ? this.playerNames.local : this.playerNames.opponent);
    }

    /** the HUD's topbar commander cards — shared by the constructor's
     *  one-time setup and refreshCommanders' live update. `(AI)` only ever
     *  applies to a real networked match (this.star) — single-player's own
     *  AI opponent is already presented as such, nothing new to flag there. */
    private commanderEntries(): {
        seat: SeatId;
        team: Team;
        name: string;
        primary: boolean;
        avatar?: string | null;
    }[] {
        return this.seats.map((def, seat) => ({
            seat,
            team: def.team,
            name:
                this.star && def.controller === 'ai'
                    ? `${this.ownerName(def.team, seat)} (AI)`
                    : this.ownerName(def.team, seat),
            primary: seat === primarySeatOf(this.seats, def.team),
            avatar: def.avatar || null,
        }));
    }

    /** re-renders the topbar commander cards from the current `this.seats` —
     *  called whenever a seat's controller changes mid-match (takeOverSeatWithAi,
     *  or a guest/spectator learning of one via the 'roster' broadcast), which
     *  the constructor's one-time setCommanders call never accounted for
     *  (repro: host saw no change at all when a quitting client's seat got
     *  handed to AI — same stale name, no visible cue anything happened). */
    private refreshCommanders(): void {
        this.hud.setCommanders(this.commanderEntries(), this.humanSeat);
        // new fill nodes — re-apply current HP against match peaks
        this.paintHudHp();
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
        const team = actorTeam(a);
        const seat = actorSeat(a);
        return {
            name: u.type.name,
            team,
            owner: this.ownerName(team, seat),
            hits: targetsLabel(
                effectiveTargets(u.type, seat, (s, typeId, techId) =>
                    this.techTree.has(s, typeId, techId),
                ),
            ),
            hp: a.hp,
            maxHp: a.maxHp,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            minRange: rs.minRange > 0 ? Math.round(rs.minRange) : undefined,
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: rs.splashRadius || undefined,
            structure: !!u.type.structure,
            unitId: u.id,
            items: this.selectionItems(u, false),
            itemSlotCount:
                u.type.structure || u.type.extra ? 0 : itemSlotLimit(u.type.id),
            itemDropReady: !u.type.structure && this.canDropArmedItemOn(u),
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
            ...this.strongholdSelection(u),
        };
    }

    private unitInfo(u: Unit): SelectionInfo {
        const rs = this.resolvedStats(u);
        const lv = this.levelInfo(u);
        const fogItems = this.placement.intelOf(u)?.items;
        const ownInteractive = u.team === 'player' && this.playerCanAct;
        return {
            name: u.type.name,
            team: u.team,
            owner: this.ownerName(u.team, u.seat),
            hits: targetsLabel(
                effectiveTargets(u.type, u.seat, (s, typeId, techId) =>
                    this.techTree.has(s, typeId, techId),
                ),
            ),
            hp: rs.hp * lv.statMult,
            maxHp: rs.hp * lv.statMult,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            minRange: rs.minRange > 0 ? Math.round(rs.minRange) : undefined,
            speed: Math.round(rs.speed * 10) / 10,
            attackInterval: rs.attackInterval,
            splash: rs.splashRadius || undefined,
            alive: u.members.length,
            total: u.members.length,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            structure: !!u.type.structure,
            unitId: u.id,
            items: this.selectionItems(u, ownInteractive && !fogItems, fogItems),
            itemSlotCount:
                u.type.structure || u.type.extra ? 0 : itemSlotLimit(u.type.id),
            itemDropReady: !u.type.structure && this.canDropArmedItemOn(u),
            record: u.type.structure ? undefined : { damageDealt: u.damageDealt, kills: u.kills },
            // base buildings level for supply alone, on a rising price ladder
            towerUpgrade:
                ownInteractive && u.type.structure && !u.type.extra
                    ? {
                          cost: towerUpgradeCost(u.level, this.settings.towers),
                          affordable:
                              this.economy.balance(this.humanSeat) >=
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
            ...this.strongholdSelection(u),
        };
    }

    /** pack detail rune squares — removable only for this-deploy applications on own packs */
    private selectionItems(
        u: Unit,
        allowRemove: boolean,
        fogItems?: readonly string[],
    ): SelectionInfo['items'] {
        const itemIds = fogItems ?? u.items;
        if (!itemIds.length) return undefined;
        return itemIds.map((id, i) => ({
            id,
            icon: ITEMS[id]?.icon ?? '?',
            name: ITEMS[id]?.name ?? id,
            desc: ITEMS[id]?.description ?? '',
            removable:
                allowRemove &&
                u.seat === this.humanSeat &&
                !u.type.structure &&
                u.itemAppliedRound[i] === this.round,
        }));
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

    /** round-card history for the commander detail popup */
    private roundCardPicksView(team: Team): { round: number; title: string; body: string }[] {
        return this.dispatcher.roundCardPicks(team).map((p) => {
            if (p.cardId === null) {
                return {
                    round: p.round,
                    title: 'Skipped',
                    body: `+${SKIP_CARD_REWARD} supply`,
                };
            }
            const card = ROUND_CARDS.find((c) => c.id === p.cardId);
            return {
                round: p.round,
                title: card?.title ?? p.cardId,
                body: card
                    ? (card.unitsLabel ? `${card.unitsLabel} — ` : '') + card.description
                    : '',
            };
        });
    }

    /** pack tech slots — always that unit's {@link techSlotLimit}; empty pads unused picks.
     *  Horde / innate packs list owned techs (e.g. Mother of Spiders) with live produce %. */
    private techSelection(u: Unit): SelectionInfo['techs'] {
        if (u.type.structure || u.type.extra) return undefined;
        const isHorde = u.team === 'horde' || u.seat < 0;
        if (isHorde) {
            const ids = new Set<string>([...(u.type.innateTechs ?? []), ...allowedTechIds(u.type.id)]);
            const slots: NonNullable<SelectionInfo['techs']> = [];
            for (const id of ids) {
                if (!this.unitHasTech(u.seat, u.type.id, id)) continue;
                const t = techById(id);
                if (!t) continue;
                slots.push({
                    id: t.id,
                    name: t.name,
                    desc: techDescription(t),
                    icon: techIcon(t),
                    cost: 0,
                    owned: true,
                    affordable: false,
                    produce: this.produceProgressInfo(u, t.id),
                });
            }
            return slots.length ? slots : undefined;
        }
        const canBuy = u.seat === this.humanSeat && this.playerCanAct;
        const selected = techsForUnit(u.type.id);
        const slotsN = techSlotLimit(u.type.id);
        const owned = this.intelTechOwned(u);
        const ownedCount = owned.size;
        const bal = this.economy.balance(u.seat);
        const slots: NonNullable<SelectionInfo['techs']> = [];
        for (let i = 0; i < slotsN; i++) {
            const t = selected[i];
            if (!t) {
                slots.push({ empty: true });
                continue;
            }
            const isOwned = owned.has(t.id) || !!u.type.innateTechs?.includes(t.id);
            const cost = this.economy.techCostOf(t, ownedCount);
            slots.push({
                id: t.id,
                name: t.name,
                desc: techDescription(t),
                icon: techIcon(t),
                cost,
                owned: isOwned,
                affordable: canBuy && !isOwned && bal >= cost,
                produce: isOwned ? this.produceProgressInfo(u, t.id) : undefined,
            });
        }
        return slots;
    }

    /** Live produce-tech ring data while a battle sim is running. */
    private produceProgressInfo(
        u: Unit,
        techId: string,
    ): NonNullable<Exclude<NonNullable<SelectionInfo['techs']>[number], { empty: true }>>['produce'] {
        if (!this.sim) return undefined;
        const p = this.sim.productionProgress(u, techId);
        return p ?? undefined;
    }

    /**
     * Tech ownership as the local player may see it for this pack: live for
     * unfogged packs, phase-start snapshot while deploy intel fog applies —
     * same window as pack pose / equipped items.
     */
    private intelTechOwned(u: Unit): ReadonlySet<string> {
        if (this.placement.isIntelFogged(u) && this.techIntelSnapshot) {
            return TechTree.ownedIn(this.techIntelSnapshot, u.seat, u.type.id);
        }
        return this.techTree.ownedFor(u.seat, u.type.id);
    }

    /**
     * Research Center tiles — always listed when that building is selected
     * (deploy + battle). Active flags use deploy intel while fogged.
     */
    private researchCenterSelection(u: Unit): Pick<
        SelectionInfo,
        'recruit' | 'deploySlot' | 'rangeBoost' | 'speedBoost' | 'credit'
    > {
        if (u.type !== RESEARCH_CENTER) return {};
        const canBuy = u.seat === this.humanSeat && this.playerCanAct;
        const seat = u.seat;
        const bal = this.economy.balance(seat);
        const intel = this.intelBuildingSeat(u);
        return {
            recruit: {
                cost: this.settings.leveling.recruitLevel2Cost,
                active: intel.recruitLevel > 1,
                affordable: canBuy && bal >= this.settings.leveling.recruitLevel2Cost,
            },
            deploySlot: {
                cost: this.settings.deploy.extraSlotCost,
                active: intel.deployExtra > 0,
                affordable: canBuy && bal >= this.settings.deploy.extraSlotCost,
            },
            rangeBoost: {
                cost: this.settings.deploy.rangedRangeBoostCost,
                bonus: this.settings.deploy.rangeBoost,
                active: intel.rangeBoost,
                affordable: canBuy && bal >= this.settings.deploy.rangedRangeBoostCost,
            },
            speedBoost: {
                cost: this.settings.deploy.armySpeedBoostCost,
                bonus: this.settings.deploy.speedBoost,
                active: intel.speedBoost,
                affordable: canBuy && bal >= this.settings.deploy.armySpeedBoostCost,
            },
            credit: {
                gain: this.settings.deploy.creditGain,
                debt: this.settings.deploy.creditDebt,
                active: intel.creditUsed,
                affordable: canBuy,
            },
        };
    }

    /**
     * Command Tower permanent tracks — always listed when selected; owned /
     * tier state uses deploy intel while fogged.
     */
    private commandTowerSelection(
        u: Unit,
    ): Pick<SelectionInfo, 'boosts' | 'sellAbility' | 'rallyRouteAbility' | 'movePackAbility'> {
        if (u.type !== COMMAND_TOWER) return {};
        const canBuy = u.seat === this.humanSeat && this.playerCanAct;
        const seat = u.seat;
        const bal = this.economy.balance(seat);
        const intel = this.intelBuildingSeat(u);
        return {
            boosts: (['attack', 'hp'] as const).map((id) => {
                const tiers =
                    id === 'attack' ? this.settings.boosts.attackTiers : this.settings.boosts.hpTiers;
                const tier = id === 'attack' ? intel.boostAttack : intel.boostHp;
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
                owned: intel.sellOwned,
                affordable: canBuy && bal >= this.settings.sell.abilityCost,
            },
            rallyRouteAbility: {
                cost: this.settings.rallyRoute.abilityCost,
                owned: intel.rallyOwned,
                affordable: canBuy && bal >= this.settings.rallyRoute.abilityCost,
            },
            movePackAbility: {
                cost: this.settings.movePack.abilityCost,
                owned: intel.movePackOwned,
                affordable: canBuy && bal >= this.settings.movePack.abilityCost,
            },
        };
    }

    /** phase-start building action state, or live once this building isn't fogged */
    private intelBuildingSeat(u: Unit): BuildingIntelSeat {
        const seat = u.seat;
        if (this.placement.isIntelFogged(u) && this.buildingIntelSnapshot) {
            const s = this.buildingIntelSnapshot;
            return {
                recruitLevel: s.recruitLevel[seat] ?? 1,
                deployExtra: s.deployExtra[seat] ?? 0,
                rangeBoost: s.rangeBoost[seat] ?? false,
                speedBoost: s.speedBoost[seat] ?? false,
                creditUsed: s.creditUsed[seat] ?? false,
                boostAttack: s.boostAttack[seat] ?? 0,
                boostHp: s.boostHp[seat] ?? 0,
                sellOwned: s.sellOwned[seat] ?? false,
                rallyOwned: s.rallyOwned[seat] ?? false,
                movePackOwned: s.movePackOwned[seat] ?? false,
            };
        }
        return {
            recruitLevel: this.recruitLevel[seat]!,
            deployExtra: this.deployState.extra[seat]!,
            rangeBoost: this.roundBoosts.range[seat]!,
            speedBoost: this.roundBoosts.speed[seat]!,
            creditUsed: this.creditUsed[seat]!,
            boostAttack: this.boostState.attack[seat]!,
            boostHp: this.boostState.hp[seat]!,
            sellOwned: this.sellState.owned[seat]!,
            rallyOwned: this.rallyRouteOwned[seat]!,
            movePackOwned: this.movePackOwned[seat]!,
        };
    }

    private captureBuildingIntelSnapshot(): BuildingIntelSnapshot {
        return {
            recruitLevel: this.recruitLevel.slice(),
            deployExtra: this.deployState.extra.slice(),
            rangeBoost: this.roundBoosts.range.slice(),
            speedBoost: this.roundBoosts.speed.slice(),
            creditUsed: this.creditUsed.slice(),
            boostAttack: this.boostState.attack.slice(),
            boostHp: this.boostState.hp.slice(),
            sellOwned: this.sellState.owned.slice(),
            rallyOwned: this.rallyRouteOwned.slice(),
            movePackOwned: this.movePackOwned.slice(),
            forge: {
                player: this.forgeSlots.player.map((s) => s?.itemId ?? null),
                enemy: this.forgeSlots.enemy.map((s) => s?.itemId ?? null),
            },
        };
    }

    /**
     * Stronghold tiles — always listed when that building is selected (deploy +
     * battle, own or enemy). Buyable only for your side while you can act.
     * Duo-only actions omit themselves in 1v1; add future abilities here.
     */
    private strongholdSelection(u: Unit): Pick<SelectionInfo, 'sendSupply' | 'forge'> {
        if (u.type !== STRONGHOLD) return {};
        const out: Pick<SelectionInfo, 'sendSupply' | 'forge'> = {};
        const team: Team = u.team === 'horde' ? 'player' : u.team;
        const teamSeats = seatIdsOf(this.seats, team);
        const canBuy = u.team === 'player' && this.playerCanAct;

        // Ally supply gift — only when this side has two seats
        if (teamSeats.length >= 2) {
            const amount = 100;
            out.sendSupply = {
                amount,
                affordable: canBuy && this.economy.balance(this.humanSeat) >= amount,
            };
        }

        const fogged = this.placement.isIntelFogged(u);
        const snapIds =
            fogged && this.buildingIntelSnapshot
                ? this.buildingIntelSnapshot.forge[team]
                : null;
        const live = this.forgeSlots[team]!;
        const hintSlots: (ForgeSlot | null)[] = snapIds
            ? snapIds.map((id) => (id ? { itemId: id, seat: -1 as SeatId, round: -1 } : null))
            : live;
        const slotCount = snapIds?.length ?? live.length;
        const ovenEmpty = !fogged && live.every((s) => s === null);
        const pool = this.teamForgePool(team);
        const suggestions =
            // TEMP: one-click forge-fill shortcuts disabled
            false && ovenEmpty && canBuy && !this.armedItem
                ? forgeRecipesCraftableFromBag(
                      this.itemInventory[this.humanSeat] ?? [],
                      pool,
                  ).map((r) => ({
                      tacticId: r.productId,
                      icon: r.spellIcon,
                      name: r.spellName,
                      desc: r.spellDesc,
                      itemIds: r.ingredients,
                  }))
                : [];
        const bakeResult = resolveForge(hintSlots, pool);
        const bakeInfo = bakeResult.product
            ? forgeProductInfo(bakeResult.product)
            : null;
        out.forge = {
            slotCount,
            dropReady: !fogged && this.canDropForgeOn(u),
            hint: forgeHintText(hintSlots, fogged ? 'this' : 'next', pool),
            suggestions,
            spellPool: pool,
            bake: bakeInfo
                ? {
                      icon: bakeInfo.icon,
                      name: bakeInfo.name,
                      desc: bakeInfo.desc,
                      ingredientIcons:
                          bakeResult.product?.kind === 'tactic'
                              ? forgeIngredientIcons(bakeResult.product.id)
                              : [],
                  }
                : undefined,
            slots: Array.from({ length: slotCount }, (_, i) => {
                if (snapIds) {
                    const id = snapIds[i];
                    if (!id) return null;
                    return {
                        id,
                        icon: ITEMS[id]?.icon ?? '?',
                        name: ITEMS[id]?.name ?? id,
                        desc: ITEMS[id]?.description ?? '',
                        removable: false,
                    };
                }
                const s = live[i];
                if (!s) return null;
                return {
                    id: s.itemId,
                    icon: ITEMS[s.itemId]?.icon ?? '?',
                    name: ITEMS[s.itemId]?.name ?? s.itemId,
                    desc: ITEMS[s.itemId]?.description ?? '',
                    removable:
                        canBuy && s.seat === this.humanSeat && s.round === this.round,
                };
            }),
        };

        return out;
    }
}

/** deploy-intel capture of Research Center / Command Tower seat state */
interface BuildingIntelSnapshot {
    recruitLevel: number[];
    deployExtra: number[];
    rangeBoost: boolean[];
    speedBoost: boolean[];
    creditUsed: boolean[];
    boostAttack: number[];
    boostHp: number[];
    sellOwned: boolean[];
    rallyOwned: boolean[];
    movePackOwned: boolean[];
    /** Stronghold oven contents (item ids) at phase start — fogged view */
    forge: Record<Team, (string | null)[]>;
}

interface BuildingIntelSeat {
    recruitLevel: number;
    deployExtra: number;
    rangeBoost: boolean;
    speedBoost: boolean;
    creditUsed: boolean;
    boostAttack: number;
    boostHp: number;
    sellOwned: boolean;
    rallyOwned: boolean;
    movePackOwned: boolean;
}

/** Short label for the details-pane "Hits" row. */
function targetsLabel(targets: { ground: boolean; air: boolean }): string {
    if (targets.ground && targets.air) return 'Ground & air';
    if (targets.ground) return 'Ground';
    if (targets.air) return 'Air';
    return 'None';
}

/** yaw so local +Z points from (ax,az) toward (bx,bz); 0 if the points coincide */
function yawToward(ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    if (dx * dx + dz * dz < 1e-8) return 0;
    // matches drapeRectGeometry: local +Z → (-sin(yaw), cos(yaw))
    return Math.atan2(-dx, dz);
}
