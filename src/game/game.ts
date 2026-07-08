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
import { BattleMap, STANDARD_MAP } from './map';
import { PlacementController } from './placement';
import { UNIT_TYPES } from './units';
import { DebugOverlay } from '../ui/debug';
import { Hud } from '../ui/hud';

/**
 * The battlefield scene: a real three.js world (ground, lights, shadows,
 * unit meshes) rendered below the transparent Pixi UI overlay.
 */
export class Game {
    private readonly map = new BattleMap(STANDARD_MAP);
    private readonly scene = new Scene();
    private readonly renderer: WebGLRenderer;
    private readonly rig = new CameraRig();
    private readonly controls: CameraControls;
    private readonly placement: PlacementController;
    private readonly hud: Hud;
    private readonly debug: DebugOverlay;
    private time = 0;

    constructor(
        private readonly pixiApp: Application,
        threeCanvas: HTMLCanvasElement,
        wrapper: HTMLElement,
    ) {
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

        // input listens on the Pixi canvas — it's the top-most surface
        const surface = pixiApp.canvas;
        // keep the camera target well inside the field so the view never leaves the map
        this.rig.setBounds(this.map.halfW - 8, this.map.halfH - 16);
        this.controls = new CameraControls(this.rig, surface);
        this.placement = new PlacementController(this.rig, this.map, this.scene, surface);
        this.hud = new Hud(pixiApp, wrapper, (type) => {
            this.placement.selectedType = type;
        });
        this.debug = new DebugOverlay(this.hud.mode);
        pixiApp.stage.addChild(this.debug.view);

        this.spawnEnemyArmy();

        this.resize(wrapper.clientWidth, wrapper.clientHeight);
        window.addEventListener('resize', () => this.resize(wrapper.clientWidth, wrapper.clientHeight));
        pixiApp.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));
    }

    /** static dummy opposition so the far zone isn't empty */
    private spawnEnemyArmy(): void {
        const [crawler, marksman, fortress] = UNIT_TYPES as [
            (typeof UNIT_TYPES)[number],
            (typeof UNIT_TYPES)[number],
            (typeof UNIT_TYPES)[number],
        ];
        const { flankCols } = this.map.size;
        const { cols, rows } = this.map;
        for (let col = flankCols + 6; col <= cols - flankCols - 10; col += 16) {
            this.placement.spawn(fortress, { col, row: rows - 8 }, 'enemy'); // 4x4
        }
        for (let col = flankCols + 3; col <= cols - flankCols - 5; col += 6) {
            this.placement.spawn(marksman, { col, row: rows - 12 }, 'enemy'); // 2x2
        }
        for (let col = flankCols + 2; col <= cols - flankCols - 7; col += 8) {
            this.placement.spawn(crawler, { col, row: rows - 16 }, 'enemy'); // 5x2 swarm
        }
        // crawler swarms on the enemy's flanks, beside the player's half
        for (const col of [0, cols - 5]) {
            this.placement.spawn(crawler, { col, row: 4 }, 'enemy');
            this.placement.spawn(crawler, { col, row: 10 }, 'enemy');
        }
    }

    private resize(width: number, height: number): void {
        this.renderer.setSize(width, height, false);
        this.rig.resize(width, height);
    }

    private tick(dtSeconds: number): void {
        this.time += dtSeconds;
        this.controls.update(dtSeconds);
        this.rig.update(dtSeconds);
        this.placement.update(this.time);
        this.hud.layout();
        this.debug.update(this.pixiApp, this.rig, this.placement.unitCount, dtSeconds);
        this.renderer.render(this.scene, this.rig.camera);
    }
}
