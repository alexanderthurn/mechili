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
import { CameraRig } from '../engine/cameraRig';
import { CameraControls } from '../engine/cameraControls';
import { BattleMap, type Cell } from './map';
import { PlacementController } from './placement';
import { DEFAULT_SETTINGS, Economy, type GameSettings } from './settings';
import { BattleSim } from './sim';
import { TOWER_TYPE, UNIT_TYPES } from './units';
import { DebugOverlay } from '../ui/debug';
import { Hud, type Phase } from '../ui/hud';

/** one deployment, as the future replay system will need it */
interface DeploymentRecord {
    round: number;
    team: string;
    typeId: string;
    anchor: Cell;
    rotated: boolean;
}

/**
 * The battlefield scene: a real three.js world (ground, lights, shadows,
 * unit meshes) rendered below the transparent Pixi UI overlay.
 */
export class Game {
    private readonly map: BattleMap;
    private readonly economy: Economy;
    private readonly scene = new Scene();
    private readonly renderer: WebGLRenderer;
    private readonly rig = new CameraRig();
    private readonly controls: CameraControls;
    private readonly placement: PlacementController;
    private readonly hud: Hud;
    private readonly debug: DebugOverlay;
    private readonly gridOverlay;
    private time = 0;

    private static readonly SPEED_STEPS = [1, 2, 4, 0.5];

    private phase: Phase = 'build';
    private round = 0;
    private phaseRemaining = 0;
    private speedIndex = 0;
    private playerHp: number;
    private enemyHp: number;
    private sim: BattleSim | null = null;
    /** every placement ever made, in order — the seed data for the replay system */
    private readonly deploymentLog: DeploymentRecord[] = [];

    constructor(
        private readonly pixiApp: Application,
        threeCanvas: HTMLCanvasElement,
        wrapper: HTMLElement,
        private readonly settings: GameSettings = DEFAULT_SETTINGS,
    ) {
        this.map = new BattleMap(settings.map);
        this.economy = new Economy(settings.economy);
        this.playerHp = settings.startingHp;
        this.enemyHp = settings.startingHp;
        this.renderer = new WebGLRenderer({ canvas: threeCanvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;

        this.scene.background = new Color(0x0d1016);
        this.scene.fog = new Fog(0x0d1016, 380, 1050);

        this.scene.add(new HemisphereLight(0x9db4c8, 0x2a2620, 0.9));
        const sun = new DirectionalLight(0xfff2dd, 1.6);
        sun.position.set(120, 160, 80);
        sun.castShadow = true;
        sun.shadow.mapSize.set(4096, 4096);
        sun.shadow.camera.left = -this.map.halfW - 10;
        sun.shadow.camera.right = this.map.halfW + 10;
        sun.shadow.camera.top = this.map.halfH + 10;
        sun.shadow.camera.bottom = -this.map.halfH - 10;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 500;
        this.scene.add(sun);

        this.scene.add(this.map.createMesh());
        this.gridOverlay = this.map.createOverlayMesh();
        this.scene.add(this.gridOverlay);

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map
        this.rig.setBounds(this.map.halfW - 8, this.map.halfH - 16);
        this.controls = new CameraControls(this.rig, surface);
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        this.controls.onMiddleClick = () => this.placement.toggleRotation();
        this.hud = new Hud(
            pixiApp,
            wrapper,
            (type) => this.economy.costOf(type),
            (type) => {
                this.placement.selectedType = type;
            },
        );
        this.hud.onEndDeployment = () => {
            if (this.phase === 'build') this.startBattlePhase();
        };
        this.hud.onToggleSpeed = () => {
            this.speedIndex = (this.speedIndex + 1) % Game.SPEED_STEPS.length;
            this.hud.setSpeed(Game.SPEED_STEPS[this.speedIndex]!);
        };
        this.debug = new DebugOverlay(this.hud.mode);
        pixiApp.stage.addChild(this.debug.view);

        this.placement.onSpawn = (unit) => {
            this.deploymentLog.push({
                round: this.round,
                team: unit.team,
                typeId: unit.type.id,
                anchor: unit.cell,
                rotated: unit.rotated,
            });
        };

        // round 0: only the towers are known — every enemy unit arrives
        // through hidden build-phase placements, revealed at battle start
        this.spawnTowers();
        this.startBuildPhase();

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', () => this.resize(wrapper.clientWidth, wrapper.clientHeight));
        pixiApp.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));
    }

    /** each side's two command towers, centered in its territory's depth */
    private spawnTowers(): void {
        const { flankCols, zoneCols, zoneRows } = this.map.size;
        const fp = TOWER_TYPE.footprint;
        const centerRow = Math.round((zoneRows - fp.rows) / 2);
        for (const frac of [0.25, 0.75]) {
            const col = flankCols + Math.round(zoneCols * frac) - Math.floor(fp.cols / 2);
            this.placement.spawn(TOWER_TYPE, { col, row: centerRow }, 'player');
            this.placement.spawn(TOWER_TYPE, { col, row: this.map.rows - centerRow - fp.rows }, 'enemy');
        }
    }

    /** A new round: place freely, hidden from the opponent, until timer or button. */
    private startBuildPhase(): void {
        this.round++;
        this.phase = 'build';
        this.phaseRemaining = this.settings.buildTimeSeconds;
        this.placement.enabled = true;
        this.placement.hiddenPlacements = true;
        this.gridOverlay.visible = true;
        this.economy.grantRoundIncome(this.round);
        // the enemy also deploys this round — invisible to the player until
        // battle, spending its own supply on random affordable units
        for (let guard = 0; guard < 30; guard++) {
            const affordable = UNIT_TYPES.filter((t) => this.economy.canAfford('enemy', t));
            if (affordable.length === 0) break;
            const type = affordable[Math.floor(Math.random() * affordable.length)]!;
            if (!this.placement.spawnEnemyRandom(type)) break; // no space left
        }
    }

    /** Everything is revealed and the sim takes over; the player can only watch. */
    private startBattlePhase(): void {
        this.phase = 'battle';
        this.phaseRemaining = this.settings.battleTimeSeconds;
        this.placement.enabled = false;
        this.placement.hiddenPlacements = false;
        this.gridOverlay.visible = false;
        this.placement.revealAll();
        this.sim = new BattleSim(this.placement.allUnits());
    }

    /** Battle is over: survivors bite into the opponent's HP, then the board resets. */
    private endBattlePhase(): void {
        if (this.sim) this.applyBattleResult(this.sim);
        this.sim = null;
        for (const unit of this.placement.allUnits()) unit.resetFormation();
        this.placement.refaceAll();
        this.startBuildPhase();
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

    private resize(width: number, height: number): void {
        this.renderer.setSize(width, height, false);
        this.rig.resize(width, height);
    }

    private tick(dtSeconds: number): void {
        // battle can be fast-forwarded (or slowed); build always runs at 1x
        const gameDt =
            this.phase === 'battle' ? dtSeconds * Game.SPEED_STEPS[this.speedIndex]! : dtSeconds;
        this.time += gameDt;
        this.phaseRemaining -= gameDt;

        if (this.phase === 'build') {
            if (this.phaseRemaining <= 0) this.startBattlePhase();
        } else if (this.sim) {
            this.sim.update(gameDt);
            if (this.phaseRemaining <= 0 || this.sim.isOver) this.endBattlePhase();
        }

        this.controls.update(dtSeconds);
        this.rig.update(dtSeconds);
        this.placement.update(this.time);
        this.hud.setPhase(this.round, this.phase, this.phaseRemaining);
        this.hud.setSupply(this.economy.balance('player'));
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.hud.layout();
        this.debug.update(this.pixiApp, this.rig, this.placement.unitCount, dtSeconds);
        this.renderer.render(this.scene, this.rig.camera);
    }
}
