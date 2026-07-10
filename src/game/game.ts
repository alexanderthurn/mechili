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
import { BattleMap, type Cell } from './map';
import { Particles, ProjectileRenderer } from './effects';
import { Scenery } from './scenery';
import { createRangeRing, PlacementController } from './placement';
import { DEFAULT_SETTINGS, Economy, type GameSettings } from './settings';
import { BattleSim, type Actor } from './sim';
import { TechTree } from './tech';
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

    private static readonly SPEED_STEPS = [1, 2, 4, 0.5];

    private phase: Phase = 'build';
    private round = 0;
    private phaseRemaining = 0;
    private speedIndex = 0;
    private playerHp: number;
    private enemyHp: number;
    private matchOver = false;
    private sim: BattleSim | null = null;
    /** player supply, techs and pack positions at build-phase start — what undo restores */
    private roundSnapshot: {
        supply: number;
        techs: Map<string, Set<string>>;
        positions: ReturnType<PlacementController['snapshotPositions']>;
    } | null = null;
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
        this.controls = new CameraControls(this.rig, surface);
        this.placement = new PlacementController(this.rig, this.map, this.economy, this.scene, surface);
        this.controls.onMiddleClick = () => this.placement.rotateSelected();
        this.placement.rangeOf = (unit) => this.techTree.statsFor(unit.team, unit.type).range;
        this.controls.onRightClick = () => {
            this.placement.deselect();
            this.selectedActor = null;
        };
        // Escape deselects, exactly like a right click
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.code !== 'Escape') return;
            this.placement.deselect();
            this.selectedActor = null;
        });
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
        this.hud.onUndo = () => this.undoRound();
        this.hud.onBuyTech = (techId) => {
            const unit = this.placement.selectedUnit;
            if (!unit || this.phase !== 'build' || unit.team !== 'player') return;
            const tech = unit.type.techs.find((t) => t.id === techId);
            if (tech) this.techTree.buy('player', unit.type, tech, this.economy);
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
        // undo restores to right after income, before any spending or moving
        this.roundSnapshot = {
            supply: this.economy.balance('player'),
            techs: this.techTree.snapshot('player'),
            positions: this.placement.snapshotPositions(),
        };
        // the enemy sometimes techs up before spending the rest on units
        if (this.round >= 2 && Math.random() < 0.6) {
            const type = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)]!;
            const unowned = type.techs.filter((t) => !this.techTree.has('enemy', type.id, t.id));
            const tech = unowned[Math.floor(Math.random() * unowned.length)];
            if (tech && this.economy.balance('enemy') >= tech.cost + 200) {
                this.techTree.buy('enemy', type, tech, this.economy);
            }
        }
        // the enemy also deploys this round — invisible to the player until
        // battle, spending its own supply on random affordable units
        for (let guard = 0; guard < 30; guard++) {
            const affordable = UNIT_TYPES.filter((t) => this.economy.canAfford('enemy', t));
            if (affordable.length === 0) break;
            const type = affordable[Math.floor(Math.random() * affordable.length)]!;
            if (!this.placement.spawnEnemyRandom(type)) break; // no space left
        }
    }

    /**
     * The undo button: reverts every player action of the running build
     * phase — units bought this round vanish, everything else returns to its
     * round-start spot, supply and techs return to their post-income state.
     * Earlier rounds are never touched.
     */
    private undoRound(): void {
        if (this.phase !== 'build' || this.matchOver || !this.roundSnapshot) return;
        this.placement.deselect();
        for (const u of [...this.placement.allUnits()]) {
            if (u.team === 'player' && u.deployedRound === this.round) this.placement.removeUnit(u);
        }
        this.placement.restorePositions(this.roundSnapshot.positions);
        this.economy.setBalance('player', this.roundSnapshot.supply);
        this.techTree.restore('player', this.roundSnapshot.techs);
    }

    /** true when the running build phase differs from its snapshot in any way */
    private canUndo(): boolean {
        const snap = this.roundSnapshot;
        if (this.phase !== 'build' || this.matchOver || !snap) return false;
        if (this.economy.balance('player') !== snap.supply) return true; // bought units or techs
        for (const u of this.placement.allUnits()) {
            if (u.team === 'player' && u.deployedRound === this.round) return true;
        }
        return snap.positions.some(
            (s) =>
                s.unit.cell.col !== s.cell.col ||
                s.unit.cell.row !== s.cell.row ||
                s.unit.rotated !== s.rotated,
        );
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
        this.sim = new BattleSim(this.placement.allUnits(), {
            towers: this.settings.towers,
            leveling: this.settings.leveling,
            costOf: (type) => this.economy.costOf(type),
            statsOf: (unit) => this.techTree.statsFor(unit.team, unit.type),
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
        // ambient motion runs on real time, unaffected by battle fast-forward
        this.scenery.update(dtSeconds, this.rig.camera.position);
        this.placement.update(this.time);
        this.updateSelectionUi();
        this.hud.setPhase(this.round, this.phase, this.phaseRemaining);
        this.hud.setUndoVisible(this.canUndo());
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
            const screen = this.rig.worldToScreen(a.x, a.altitude + t.meshScale * 0.55, a.z, w, h);
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
            this.techTree.statsFor(a.unit.team, a.unit.type).range + a.unit.type.collisionRadius;
        this.battleRangeMesh.position.set(a.x, 0.05, a.z);
        this.battleRangeMesh.scale.set(radius, 1, radius);
        const material = this.battleRangeMesh.material as import('three').MeshBasicMaterial;
        material.color.setHex(a.unit.team === 'player' ? THEME.valid : THEME.enemy);
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
        const { statMultiplierPerLevel, xpThresholdFactor, maxLevel } = this.settings.leveling;
        const xpNext =
            u.level >= maxLevel ? -1 : this.economy.costOf(u.type) * xpThresholdFactor * u.level;
        return { level: u.level, xp: u.xp, xpNext, statMult: statMultiplierPerLevel ** (u.level - 1) };
    }

    private actorInfo(a: Actor): SelectionInfo {
        const rs = this.techTree.statsFor(a.unit.team, a.unit.type);
        const lv = this.levelInfo(a.unit);
        return {
            name: a.unit.type.name,
            team: a.unit.team,
            hp: a.hp,
            maxHp: a.maxHp,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            speed: Math.round(rs.speed * 10) / 10,
            alive: 1,
            total: 1,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
        };
    }

    private unitInfo(u: Unit): SelectionInfo {
        const rs = this.techTree.statsFor(u.team, u.type);
        const lv = this.levelInfo(u);
        return {
            name: u.type.name,
            team: u.team,
            hp: rs.hp * lv.statMult,
            maxHp: rs.hp * lv.statMult,
            damage: rs.damage * lv.statMult,
            range: Math.round(rs.range),
            speed: Math.round(rs.speed * 10) / 10,
            alive: u.members.length,
            total: u.members.length,
            level: lv.level,
            xp: lv.xp,
            xpNext: lv.xpNext,
            // techs are buyable on your own packs during deployment
            techs:
                u.team === 'player' && this.phase === 'build' && !u.type.structure
                    ? u.type.techs.map((t) => ({
                          id: t.id,
                          name: t.name,
                          cost: t.cost,
                          owned: this.techTree.has('player', u.type.id, t.id),
                          affordable: this.economy.balance('player') >= t.cost,
                      }))
                    : undefined,
        };
    }
}
