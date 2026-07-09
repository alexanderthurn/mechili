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
import { Particles, ProjectileRenderer } from './effects';
import { PlacementController } from './placement';
import { DEFAULT_SETTINGS, Economy, type GameSettings } from './settings';
import { BattleSim, type Actor } from './sim';
import { TOWER_TYPE, UNIT_TYPES, type Unit } from './units';
import { DebugOverlay } from '../ui/debug';
import { HpBars } from '../ui/hpBars';
import { Hud, type Phase, type SelectionInfo } from '../ui/hud';

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
    private readonly hpBars = new HpBars();
    private readonly projectileRenderer: ProjectileRenderer;
    private readonly particles: Particles;
    private gridOverlay;
    private time = 0;
    /** battle-phase selection: one individual mech (own or enemy) */
    private selectedActor: Actor | null = null;

    private static readonly SPEED_STEPS = [1, 2, 4, 0.5];

    private phase: Phase = 'build';
    private round = 0;
    private phaseRemaining = 0;
    private speedIndex = 0;
    private playerHp: number;
    private enemyHp: number;
    private matchOver = false;
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
        this.projectileRenderer = new ProjectileRenderer(this.scene);
        this.particles = new Particles(this.scene);

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map
        this.rig.setBounds(this.map.halfW - 8, this.map.halfH - 16);
        this.rig.fitMap(this.map.width, this.map.height);
        this.controls = new CameraControls(this.rig, surface);
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        this.controls.onMiddleClick = () => this.placement.rotateSelected();
        this.controls.onRightClick = () => {
            this.placement.deselect();
            this.selectedActor = null;
        };
        this.hud = new Hud(
            pixiApp,
            wrapper,
            (type) => this.economy.costOf(type),
            (type) => this.placement.buy(type),
        );
        this.hud.onEndDeployment = () => {
            if (this.phase === 'build') this.startBattlePhase();
        };
        this.hud.onToggleSpeed = () => {
            this.speedIndex = (this.speedIndex + 1) % Game.SPEED_STEPS.length;
            this.hud.setSpeed(Game.SPEED_STEPS[this.speedIndex]!);
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
        this.placement.deselect();
        this.gridOverlay.visible = false;
        this.placement.revealAll();
        // snapshot this round's deployments with their FINAL positions (they
        // may have been moved around) — the seed data for the replay system
        for (const u of this.placement.allUnits()) {
            if (u.deployedRound !== this.round) continue;
            this.deploymentLog.push({
                round: this.round,
                team: u.team,
                typeId: u.type.id,
                anchor: { ...u.cell },
                rotated: u.rotated,
            });
        }
        this.sim = new BattleSim(this.placement.allUnits(), this.settings.towers);
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
        for (const unit of this.placement.allUnits()) unit.resetFormation();
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

        if (!this.matchOver) {
            this.phaseRemaining -= gameDt;
            if (this.phase === 'build') {
                if (this.phaseRemaining <= 0) this.startBattlePhase();
            } else if (this.sim) {
                this.sim.update(gameDt);
                this.particles.spawnFromEvents(this.sim.consumeEvents());
                this.projectileRenderer.update(this.sim.projectiles);
                if (this.phaseRemaining <= 0 || this.sim.isOver) this.endBattlePhase();
            }
        }
        this.particles.update(gameDt);

        this.controls.update(dtSeconds);
        this.rig.update(dtSeconds);
        this.placement.update(this.time);
        this.updateSelectionUi();
        this.hud.setPhase(this.round, this.phase, this.phaseRemaining);
        this.hud.setSupply(this.economy.balance('player'));
        this.hud.setHp(this.playerHp, this.enemyHp);
        this.hud.layout();
        this.debug.update(this.pixiApp, this.rig, this.placement.unitCount, dtSeconds);
        this.renderer.render(this.scene, this.rig.camera);
    }

    /** the living mech closest to the clicked ground point, within a pick radius */
    private pickActor(e: PointerEvent): Actor | null {
        if (!this.sim) return null;
        const rect = this.pixiApp.canvas.getBoundingClientRect();
        const ground = this.rig.screenToGround(
            e.clientX - rect.left,
            e.clientY - rect.top,
            rect.width,
            rect.height,
        );
        if (!ground) return null;
        let best: Actor | null = null;
        let bestD = Infinity;
        for (const a of this.sim.actors) {
            if (!a.alive) continue;
            const d = (a.x - ground.x) ** 2 + (a.z - ground.z) ** 2;
            const radius = Math.max(2.5, a.unit.type.meshScale * 1.5);
            if (d < radius * radius && d < bestD) {
                bestD = d;
                best = a;
            }
        }
        return best;
    }

    private updateSelectionUi(): void {
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

    private actorInfo(a: Actor): SelectionInfo {
        const t = a.unit.type;
        return {
            name: t.name,
            team: a.unit.team,
            hp: a.hp,
            maxHp: t.hp,
            damage: t.damage,
            range: t.range,
            speed: t.speed,
            alive: 1,
            total: 1,
        };
    }

    private unitInfo(u: Unit): SelectionInfo {
        const t = u.type;
        return {
            name: t.name,
            team: u.team,
            hp: t.hp,
            maxHp: t.hp,
            damage: t.damage,
            range: t.range,
            speed: t.speed,
            alive: u.members.length,
            total: u.members.length,
        };
    }
}
