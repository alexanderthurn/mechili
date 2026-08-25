import {
    AdditiveBlending,
    BackSide,
    BufferAttribute,
    CanvasTexture,
    CircleGeometry,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    Group,
    IcosahedronGeometry,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    RepeatWrapping,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Color,
    Vector2,
    Vector3,
    type DirectionalLight,
    type HemisphereLight,
    type Scene,
    type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Weather, TRANSITION_TAU, type Season } from './weather';
import { THEME } from '../theme';
import type { EffectToggles } from './effectToggles';
import { prefs, sceneryDetailed, sceneryHeightFog, type SceneryQuality } from './prefs';
import {
    CELL,
    makeValueNoise,
    mulberry32,
    registerOuterHeight,
    summerDryUniform,
    type BattleMap,
} from './map';
import { groundDetailCacheKey, groundMaterialProfile, PHOTO_BLEND, bindCloseTileUniforms, closeTileInjectGlsl, closeTileUniformDecls, closeTileWeightFallbackGlsl } from './groundQuality';
import {
    barkUrl,
    foliageUrl,
    iceAlbedoUrl,
    shoreAlbedoUrl,
    loadGrassTextures,
    loadRockTextures,
    loadWorldTexture,
} from './worldTextures';
import {
    BILLBOARD_SCALE,
    BILLBOARD_Y_SINK,
    attachSeasonTint,
    attachVegetationSnow,
    billboardShadowRadius,
    createBillboardInstances,
    createVegetationInstances,
    loadSceneryBillboards,
    loadSceneryVegetation,
    NEAR_TREE_DIST,
    placeVegetationInstance,
    sceneryHqVegetation,
    snapVegetationSeason,
    setVegetationSeason,
    setVegetationSnowCover,
    updateVegetationSeason,
    type VegetationKind,
} from './sceneryVegetation';
import {
    buildFloorPieceMeshes,
    floorPieceGroundSink,
    floorPieceScale,
    floorPiecesEnabled,
    listFloorPieces,
    loadFloorPieces,
    type FloorPiecePlacement,
} from './sceneryFloorPieces';
import { updateBuildingSnowCover, snapBuildingSnowCover } from './buildingSnow';
import { BillboardTreeShadows, type BlobShadowSource } from './blobShadows';

/** Instance / mesh density for scenery tiers (trees stay InstancedMesh). */
function sceneryDensity(quality: SceneryQuality): {
    outer: number;
    field: number;
    meadow: number;
    lake: number;
    segs: number;
    margin: number;
    acceptBase: number;
    /** distance past board where forest belt starts ramping */
    beltNear: number;
    /** how quickly density rises after beltNear */
    beltRamp: number;
    /** distance where far taper begins */
    beltFar: number;
    forestFogCards: number;
    /** summit wisps parked on snowy peaks */
    peakClouds: number;
} {
    if (quality === 'ultra') {
        return {
            outer: 10,
            field: 1.6,
            meadow: 2.2,
            lake: 1.8,
            segs: 400,
            margin: 600,
            acceptBase: 0.85,
            // thick immediately past keep-out — peak density almost at the edge
            beltNear: 8,
            beltRamp: 18,
            // stay dense across green foothills; rockFactor rejects stone
            beltFar: 500,
            forestFogCards: 22,
            peakClouds: 22,
        };
    }
    if (quality === 'high') {
        // Same dense forest belt as ultra, but low-poly cones/blobs (no Tripo GLBs).
        return {
            outer: 10,
            field: 1.6,
            meadow: 2.2,
            lake: 1.8,
            segs: 380,
            margin: 600,
            acceptBase: 0.85,
            beltNear: 8,
            beltRamp: 18,
            beltFar: 500,
            forestFogCards: 18,
            peakClouds: 18,
        };
    }
    // medium — billboard forest (cheaper than high; no blob shadows / Tripo)
    return {
        // ~3.5× former medium tree counts; still well under high/ultra (outer: 10)
        outer: 3.5,
        field: 1.2,
        meadow: 1,
        lake: 1,
        segs: 300,
        margin: 480,
        acceptBase: 0.42,
        beltNear: 14,
        beltRamp: 40,
        beltFar: 380,
        forestFogCards: 12,
        peakClouds: 12,
    };
}

function scaleCount(n: number, mult: number): number {
    return Math.max(1, Math.round(n * mult));
}

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/**
 * Deterministic replacements for `Math.pow(x, exponent)` on `x` clamped to
 * [0, 1] — used only by {@link terrainHeight} below, which feeds
 * `worldHeightAt` → `hordePathCrossesWater` for real GAMEPLAY decisions
 * (horde-wave spawn-point rejection near lakes, see registerOuterHeight's
 * call site further down). `Math.pow` with a fractional exponent is
 * implementation-approximated per spec, not guaranteed bit-identical across
 * engines — the same lockstep hazard `sim.ts`'s local `hypot()` exists to
 * avoid for `Math.hypot`. Each is a degree-7, zero-constant-term least-
 * squares fit of x^exponent on [0,1] (max abs error ~8e-4), evaluated with
 * only +, -, * (exactly specified by IEEE-754) so every peer gets the
 * identical bits — the tiny fit error vs. the "true" curve is invisible in
 * a hand-authored terrain shape and doesn't matter for determinism, only
 * consistency does.
 */
function detPow01(x: number, c: readonly [number, number, number, number, number, number, number]): number {
    const v = Math.min(1, Math.max(0, x));
    // Horner's method
    return v * (c[0] + v * (c[1] + v * (c[2] + v * (c[3] + v * (c[4] + v * (c[5] + v * c[6]))))));
}

const POW_1_45 = [
    0.15304741, 2.50136129, -6.09467962, 11.84031086, -13.80380794, 8.60550388, -2.20198833,
] as const;
const POW_1_3 = [
    0.3007198, 2.57445524, -7.27909887, 14.64816629, -17.34878685, 10.91272683, -2.8085132,
] as const;
const POW_1_35 = [
    0.2418669, 2.60154548, -7.03726829, 14.0043433, -16.50211579, 10.34998924, -2.65867118,
] as const;

/** Deterministic replacement for `Math.hypot` — sqrt IS correctly rounded
 *  per IEEE-754 in every engine, `Math.hypot` is NOT (see detPow01's doc
 *  comment for why that matters here). */
function detHypot(x: number, z: number): number {
    return Math.sqrt(x * x + z * z);
}

/**
 * How far past the board AABB the outer ground covers.
 * Mountains rise from ~d=110, peak ~470, outer slope ~640–900.
 * This keeps a short back-slope without a second countryside behind the ring.
 */
const OUTER_PAST_BOARD = 780;

function outerWorldSize(halfW: number, halfH: number): number {
    return 2 * (Math.max(halfW, halfH) + OUTER_PAST_BOARD);
}

/**
 * Everything around and above the battlefield, generated in code: sky dome,
 * sun glow, the outer world (ground, trees), horizon clouds, forest fog, rain/snow.
 */
export class Scenery {
    readonly group = new Group();

    /** dome + sun glow follow the camera so the horizon never hits the far plane */
    private readonly skyGroup = new Group();
    private readonly clouds: { mesh: Mesh; speed: number }[] = [];
    /** wisps clinging to the snowy summits — they sway in place, never leave */
    private readonly peakClouds: { mesh: Mesh; baseX: number; phase: number; speed: number }[] = [];
    /** low fog cards drifting between the forest trees */
    private readonly fogCards: { mesh: Mesh; baseX: number; phase: number; speed: number }[] = [];
    private forestFogMaterial: MeshBasicMaterial | null = null;
    private time = 0;
    private readonly cloudBoundsX: number;
    /** Square outer-ground size (world units) — mountain ring plus a short skirt. */
    private readonly worldSize: number;
    private readonly map: BattleMap;
    private weather: Weather | null = null;
    /** far-card contact shadows (sun-aligned); built when billboards are placed */
    private readonly treeShadows = new BillboardTreeShadows(this.group);
    private sunLight: DirectionalLight | null = null;

    private waterTexture: CanvasTexture | null = null;
    private waterMaterial: MeshStandardMaterial | null = null;
    private waterFreezeUniform: { value: number } | null = null;
    /** drives the outer meadow's weather-driven snow blend (see `applyMeadowTexture`) */
    private outerGroundSnowUniform: { value: number } | null = null;
    /** 1 = alpine cap on, 0 = summer — peaks go to bare rock */
    private readonly outerGroundAlpineUniform: { value: number } = { value: 1 };
    private alpineCapTarget = 1;
    /** 0 = lush grass, ~0.72 = summer-dry straw (shared `summerDryUniform`) */
    private summerDryTarget = 0;

    /** wildflower materials (meadow clumps + lake blossoms) — opacity-boosted in spring */
    private readonly flowerMaterials: MeshStandardMaterial[] = [];
    /** target opacity for wildflower / lily blossom materials (lerped in update) */
    private flowerOpacityTarget = 1;
    /** fallen-leaf litter on the meadow — built once, opacity eased in autumn */
    private leafLitter: InstancedMesh | null = null;
    private litterOpacityTarget = 0;

    // weather hooks, wired up by the create* builders below
    private repaintSky!: (zenith: string, mid: string, horizon: string) => void;
    private sunGlow!: Sprite;
    private cloudMaterial!: MeshBasicMaterial;
    private cloudTexture!: CanvasTexture;

    /** outer-world height: meadow band with soft relief, then slopes into a mountain ring */
    private readonly terrainHeight: (x: number, z: number) => number;
    /** 0..1 — how much a spot belongs to a lake basin (drives depth + beaches) */
    private readonly lakeAt: (x: number, z: number) => number;
    /** shared value noise for height + vertex color variation */
    private readonly noise: (x: number, z: number) => number;

    /** false with the 'low' scenery pref: flat green world, no decoration */
    private readonly quality: SceneryQuality = prefs().scenery;
    private readonly detailed = sceneryDetailed(this.quality);
    private readonly density = sceneryDensity(this.quality);

    constructor(map: BattleMap, seed = 20260709) {
        const rng = mulberry32(seed);
        this.map = map;
        this.worldSize = outerWorldSize(map.halfW, map.halfH);
        this.cloudBoundsX = map.halfW + 600;

        const noise = makeValueNoise(31337);
        this.noise = noise;
        // a handful of lakes, confined to the VISIBLE ring near the board
        // (verified: 1 big + 1 medium lake and 2 ponds, nearest ~66 from the edge)
        this.lakeAt = (x, z) => {
            const dOut = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            const ring = smooth01((dOut - 30) / 40) * (1 - smooth01((dOut - 260) / 120));
            const basinN = noise(x / 270 + 77.7, z / 270 + 31.3);
            return smooth01((basinN - 0.52) / 0.14) * ring;
        };
        this.terrainHeight = (x, z) => {
            // keep the playable AABB flat — field mesh owns that surface
            if (Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH) return 0;

            // rounded distance past the board + mild noise (not a square cliff line)
            const ox = Math.max(0, Math.abs(x) - map.halfW);
            const oz = Math.max(0, Math.abs(z) - map.halfH);
            let d = detHypot(ox, oz);
            d += (noise(x / 95 + 2.4, z / 95 + 6.1) - 0.5) * 28;
            d += (noise(x / 40 + 9.0, z / 40 + 1.7) - 0.5) * 12;
            d = Math.max(0, d);

            // ~6 tiles stay nearly flat; then hills ease in (some spots earlier
            // via the noise on d, but never the old "wall at 5 tiles")
            const nearFlat = 24; // CELL=4 → 6 tiles
            const ramp = 90;
            const edgeIn = detPow01(smooth01((d - nearFlat) / ramp), POW_1_45);

            const hN =
                noise(x / 110 + 1.2, z / 110 + 4.8) * 0.5 +
                noise(x / 48 + 22.1, z / 48 + 9.3) * 0.32 +
                noise(x / 22 + 8.8, z / 22 + 55.5) * 0.18;
            const knoll = detPow01(Math.max(0, hN - 0.45) / 0.55, POW_1_3);
            // Foothills die as the high range takes over — don't resume a
            // second meadow behind the mountain ring.
            const foothill = 1 - smooth01((d - 400) / 280);
            const rolling = (1.2 + 18 * hN + 14 * knoll) * edgeIn * foothill;

            const rise = smooth01((d - 110) / 360) * (1 - smooth01((d - 640) / 260));
            const n =
                noise(x / 170 + 3.7, z / 170 + 8.1) * 0.55 +
                noise(x / 62 + 51.2, z / 62 + 17.9) * 0.3 +
                noise(x / 24 + 9.4, z / 24 + 63.7) * 0.15;
            const ridge = detPow01(Math.max(0, n - 0.32) / 0.68, POW_1_35);
            const mountain = rise * (28 + 280 * ridge);
            const base = rolling + mountain;
            // Surface wrinkles on the original big shapes — stronger the higher
            // you climb, not extra summits. ~15wu / ~8wu so the mesh can hold them.
            const climb = smooth01((base - 12) / 90);
            const wrinkles =
                (noise(x / 22 + 14.2, z / 22 + 3.6) - 0.5) * 6 * climb +
                (noise(x / 12 + 27.1, z / 12 + 41.8) - 0.5) * 2.2 * climb;

            // lakes win over everything: where the basin noise runs high the
            // ground is pressed to -7, well below the water table at -1.1
            const lake = this.lakeAt(x, z);
            const depth = -7 * smooth01((d - 25) / 45);
            // Short skirt on the outer slope, then the world ends (no hinterland).
            const beyond = smooth01((d - 740) / 160);
            return (base + wrinkles) * (1 - lake) * (1 - beyond) + depth * lake;
        };

        // NOTE: terrainHeight/lakeAt stay real at every quality tier (including
        // 'low'/'off') — this feeds registerOuterHeight below, which in turn
        // feeds worldHeightAt, which horde mode uses for GAMEPLAY decisions
        // (lake avoidance when picking a spawn point, see hordePathCrossesWater
        // in game.ts). Quality is a per-client preference, not synced over the
        // wire — if this height data were quality-gated, a 'low'-quality
        // client and a 'high'-quality client could compute different horde
        // spawn points from the identical seed and desync. Only the DECORATION
        // (trees, lake props, meadow texture, forest fog) stays gated by
        // `detailed` below; the outer ground mesh itself now follows the real
        // heights at every tier too (see createOuterGround's SEGS), just
        // without decoration on 'low'/'off'.
        // the camera rig uses this to stay above the mountains
        registerOuterHeight((x, z) => this.terrainHeight(x, z));

        this.skyGroup.add(this.createSkyDome(), this.createSunGlow());
        this.group.add(this.skyGroup);
        this.group.add(this.createOuterGround(map));
        if (this.detailed) {
            this.group.add(this.createWater());
            this.createLakeDetails(rng);
            this.createForest(map, rng);
            this.createMeadowDetails(map, rng);
        }
        this.createCloudAssets(rng);
        if (this.detailed) this.createHorizonCloudMeshes(map, rng);
        if (this.detailed) this.createForestFog(map, rng);
        if (this.quality === 'off') {
            for (const c of this.clouds) c.mesh.visible = false;
        }
    }

    /**
     * Volumetric-looking forest fog: soft translucent cards hovering low
     * between the trees, swaying in place. One shared material — the weather
     * system drives its opacity and tint (thick grey in rain, faint at noon).
     */
    private createForestFog(map: BattleMap, rng: () => number): void {
        const material = new MeshBasicMaterial({
            map: this.cloudTexture,
            transparent: true,
            depthWrite: false,
            opacity: 0,
        });
        this.forestFogMaterial = material;
        const geometry = new PlaneGeometry(1, 0.55);
        geometry.rotateX(-Math.PI / 2);

        const count = Math.round(14 + this.density.forestFogCards);
        const beltMax = Math.min(this.density.beltFar, 360);
        let placed = 0;
        for (let attempt = 0; attempt < 4000 && placed < count; attempt++) {
            const x = (rng() * 2 - 1) * (map.halfW + beltMax);
            const z = (rng() * 2 - 1) * (map.halfH + beltMax);
            const d = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            if (d < this.density.beltNear + 6 || d > beltMax) continue;
            const h = this.terrainHeight(x, z);
            if (h < -0.5 || h > 60 || !this.isGrassy(x, z)) continue;
            const mesh = new Mesh(geometry, material);
            mesh.position.set(x, h + 2 + rng() * 2.5, z);
            const s = 35 + rng() * 45;
            mesh.scale.set(s, 1, s * (0.5 + rng() * 0.3));
            mesh.rotation.y = rng() * Math.PI * 2;
            this.fogCards.push({
                mesh,
                baseX: x,
                phase: rng() * Math.PI * 2,
                speed: 0.03 + rng() * 0.05,
            });
            this.group.add(mesh);
            placed++;
        }
    }

    /**
     * Matches the outer-ground shader's rock mix (height + slope).
     * 0 = full grass, 1 = full stone — trees only belong on low values.
     */
    private rockFactorAt(x: number, z: number): number {
        const h = this.terrainHeight(x, z);
        const snowF = smooth01((h - 170) / 65);
        const heightRock = smooth01((h - 16) / 39); // smoothstep(16, 55)
        const eps = 2;
        const dhdx = (this.terrainHeight(x + eps, z) - this.terrainHeight(x - eps, z)) / (2 * eps);
        const dhdz = (this.terrainHeight(x, z + eps) - this.terrainHeight(x, z - eps)) / (2 * eps);
        const ny = 1 / Math.hypot(dhdx, 1, dhdz);
        const slope = 1 - ny;
        const slopeRock = smooth01((slope - 0.32) / 0.26) * smooth01((h - 3) / 6);
        return Math.max(heightRock, slopeRock) * (1 - snowF);
    }

    /** 0..1 how well this spot holds snow — slope sheds it, altitude adds it back on peaks. */
    private snowRetentionAt(x: number, z: number, h = this.terrainHeight(x, z)): number {
        const eps = 2;
        const dhdx = (this.terrainHeight(x + eps, z) - this.terrainHeight(x - eps, z)) / (2 * eps);
        const dhdz = (this.terrainHeight(x, z + eps) - this.terrainHeight(x, z - eps)) / (2 * eps);
        const ny = 1 / Math.hypot(dhdx, 1, dhdz);
        const slope = 1 - ny;
        const slopeHold = 1 - smooth01((slope - 0.24) / 0.5) * 0.72;
        const peakBoost = smooth01((h - 120) / 100);
        return Math.min(1, slopeHold + peakBoost * 0.75);
    }

    /** True where the meadow texture still reads green (not mountain stone). */
    private isGrassy(x: number, z: number): boolean {
        return this.rockFactorAt(x, z) < 0.32;
    }

    /**
     * 0..1 scree pockets on mountains — concave gullies/corners and talus
     * piled at cliff bases (stones fall and stock up), not open slopes.
     */
    private screeAccumAt(x: number, z: number, h: number): number {
        if (h < 14) return 0;
        const hAt = (dx: number, dz: number) => this.terrainHeight(x + dx, z + dz);
        // sample at mountain scale — gullies/corners are tens of wu wide, not mesh-sized
        const near = 18;
        const far = 48;
        const ring8 =
            (hAt(-near, 0) +
                hAt(near, 0) +
                hAt(0, -near) +
                hAt(0, near) +
                hAt(-near, -near) +
                hAt(near, -near) +
                hAt(-near, near) +
                hAt(near, near)) /
            8;
        const pocket = smooth01((ring8 - h) / 5.5);
        const lapFar =
            (hAt(-far, 0) + hAt(far, 0) + hAt(0, -far) + hAt(0, far) - 4 * h) / far;
        const concave = smooth01(Math.max(0, lapFar) * 0.45);
        const cliffR = 24;
        const cliffSlopes = [
            Math.abs(hAt(cliffR, 0) - h) / cliffR,
            Math.abs(hAt(-cliffR, 0) - h) / cliffR,
            Math.abs(hAt(0, cliffR) - h) / cliffR,
            Math.abs(hAt(0, -cliffR) - h) / cliffR,
            Math.abs(hAt(cliffR, cliffR) - h) / (cliffR * 1.414),
            Math.abs(hAt(-cliffR, cliffR) - h) / (cliffR * 1.414),
        ];
        const cliffNearby = smooth01((Math.max(...cliffSlopes) - 0.22) / 0.32);
        const fine = 5;
        const dhdx = (hAt(fine, 0) - hAt(-fine, 0)) / (2 * fine);
        const dhdz = (hAt(0, fine) - hAt(0, -fine)) / (2 * fine);
        const localSlope = Math.hypot(dhdx, dhdz);
        const talusBed = (1 - smooth01((localSlope - 0.28) / 0.42)) * cliffNearby;
        let scree = Math.max(pocket, concave * 0.88, talusBed * 0.72);
        scree *= smooth01((h - 14) / 22) * (1 - smooth01((h - 200) / 85));
        scree *= 0.78 + 0.22 * this.noise(x / 23 + 61.3, z / 23 + 14.8);
        return Math.min(1, scree);
    }

    /** 0..1 — moss only on mid-elevation mountains (not foothills or high peaks). */
    private mediumAltBand(h: number): number {
        return smooth01((h - 40) / 22) * (1 - smooth01((h - 100) / 24));
    }

    /**
     * 0..1 moss/lichen on cliff walls — shaded vertical faces and crevices,
     * not scree beds (those stay gravel).
     */
    private mossAccumAt(
        x: number,
        z: number,
        h: number,
        nx: number,
        ny: number,
        nz: number,
        screeLocal: number,
    ): number {
        const midAlt = this.mediumAltBand(h);
        if (midAlt <= 0) return 0;
        const hAt = (dx: number, dz: number) => this.terrainHeight(x + dx, z + dz);
        const sunLen = Math.hypot(0.4, 0.82, 0.25);
        const facing = (nx * 0.4 + ny * 0.82 + nz * 0.25) / sunLen;
        const shadeBoost = 0.72 + 0.28 * smooth01((0.25 - facing) / 0.55);
        const wall = 1 - smooth01((ny - 0.58) / 0.34);
        const near = 16;
        const ring = (hAt(-near, 0) + hAt(near, 0) + hAt(0, -near) + hAt(0, near)) * 0.25;
        const crevice = smooth01((ring - h) / 4.8) * (0.35 + 0.65 * wall);
        const fine = 5;
        const localSlope = Math.hypot(
            (hAt(fine, 0) - hAt(-fine, 0)) / (2 * fine),
            (hAt(0, fine) - hAt(0, -fine)) / (2 * fine),
        );
        const cliffFace = smooth01((localSlope - 0.24) / 0.48) * (0.45 + 0.55 * wall);
        let moss = Math.max(crevice, cliffFace, wall * 0.58);
        moss *= shadeBoost * midAlt;
        moss *= 1 - screeLocal * 0.7;
        moss *= 0.68 + 0.32 * this.noise(x / 13 + 22.7, z / 13 + 8.4);
        return Math.min(1, moss);
    }

    /** builds the scenario system driving sky, fog, lights, clouds, rain/snow, stars */
    createWeather(
        scene: Scene,
        sun: DirectionalLight,
        hemi: HemisphereLight,
        renderer: WebGLRenderer,
        seed: number,
        effectToggles?: EffectToggles,
    ): Weather {
        this.weather = new Weather(
            {
                scene,
                sun,
                hemi,
                renderer,
                repaintSky: this.repaintSky,
                glow: this.sunGlow,
                cloudMaterial: this.cloudMaterial,
                cloudTexture: this.cloudTexture,
                forestFogMaterial: this.forestFogMaterial,
                forestFogScale: Math.min(1.2, sceneryHeightFog(this.quality)),
                skyGroup: this.skyGroup,
                worldGroup: this.group,
                map: this.map,
                onSeasonChange: (season, immediate) => this.setSeason(season, immediate),
                effectToggles,
                suppressVisualWeatherFx: !this.detailed,
            },
            seed,
        );
        this.sunLight = sun;
        return this.weather;
    }

    /** Drive billboard ground blobs when weather is off (createWeather also sets this). */
    attachSun(sun: DirectionalLight): void {
        this.sunLight = sun;
    }

    /** 0..1 how much snow currently lies on the ground (drives the board's own snow blend too) */
    get groundSnowCover(): number {
        return this.weather?.groundSnow ?? 0;
    }

    /**
     * Begin easing foliage toward a season (tint, billboard maps, flowers, litter).
     * Atmosphere already lerps on its own clock; foliage uses the same {@link TRANSITION_TAU}.
     */
    setSeason(season: Season, immediate = false): void {
        if (immediate) snapVegetationSeason(season);
        else setVegetationSeason(season);
        this.flowerOpacityTarget =
            season === 'spring' ? 1 : season === 'summer' ? 0.85 : season === 'autumn' ? 0.45 : 0.15;
        this.litterOpacityTarget = season === 'autumn' ? 1 : 0;
        this.alpineCapTarget = season === 'summer' ? 0 : 1;
        this.summerDryTarget = season === 'summer' ? 0.72 : 0;
        if (immediate) {
            this.outerGroundAlpineUniform.value = this.alpineCapTarget;
            summerDryUniform.value = this.summerDryTarget;
        }
        if (!immediate) return;
        for (const m of this.flowerMaterials) m.opacity = this.flowerOpacityTarget;
        if (this.leafLitter) {
            const mat = this.leafLitter.material as MeshStandardMaterial;
            mat.opacity = this.litterOpacityTarget;
            this.leafLitter.visible = mat.opacity > 0.02;
        }
        setVegetationSnowCover(this.groundSnowCover);
        snapBuildingSnowCover(this.groundSnowCover, this.weather?.weatherKind === 'snow');
    }

    update(dtSeconds: number, cameraPos: Vector3): void {
        this.skyGroup.position.set(cameraPos.x, 0, cameraPos.z);
        this.weather?.update(dtSeconds, cameraPos);
        updateVegetationSeason(dtSeconds);
        const seasonK = Math.min(1, dtSeconds / TRANSITION_TAU);
        for (const m of this.flowerMaterials) {
            m.opacity += (this.flowerOpacityTarget - m.opacity) * seasonK;
        }
        if (this.leafLitter) {
            const mat = this.leafLitter.material as MeshStandardMaterial;
            mat.opacity += (this.litterOpacityTarget - mat.opacity) * seasonK;
            this.leafLitter.visible = mat.opacity > 0.02;
        }
        this.outerGroundAlpineUniform.value +=
            (this.alpineCapTarget - this.outerGroundAlpineUniform.value) * seasonK;
        summerDryUniform.value += (this.summerDryTarget - summerDryUniform.value) * seasonK;
        if (this.outerGroundSnowUniform) this.outerGroundSnowUniform.value = this.groundSnowCover;
        setVegetationSnowCover(this.groundSnowCover);
        updateBuildingSnowCover(
            dtSeconds,
            this.groundSnowCover,
            this.weather?.weatherKind === 'snow',
        );
        // lakes freeze once snow reaches meadow/board level (same snow-line gate)
        if (this.waterFreezeUniform && this.waterMaterial?.userData.iceReady) {
            const cover = this.groundSnowCover;
            const snowLine = 220 - (220 - -15) * cover;
            const freeze = Math.min(1, Math.max(0, (0 - (snowLine - 40)) / 55));
            this.waterFreezeUniform.value = freeze;
            this.waterMaterial.roughness = 0.18 + freeze * 0.55;
            this.waterMaterial.opacity = 0.86 + freeze * 0.12;
        }
        this.time += dtSeconds;
        for (const c of this.clouds) {
            c.mesh.position.x += c.speed * dtSeconds;
            if (c.mesh.position.x > this.cloudBoundsX) c.mesh.position.x = -this.cloudBoundsX;
        }
        for (const p of this.peakClouds) {
            p.mesh.position.x = p.baseX + Math.sin(this.time * p.speed + p.phase) * 12;
        }
        for (const f of this.fogCards) {
            f.mesh.position.x = f.baseX + Math.sin(this.time * f.speed + f.phase) * 8;
            f.mesh.visible = (this.forestFogMaterial?.opacity ?? 0) > 0.02;
        }
        // slow ripple drift on the lakes — stops once mostly frozen
        if (this.waterTexture && (this.waterFreezeUniform?.value ?? 0) < 0.85) {
            const thaw = 1 - (this.waterFreezeUniform?.value ?? 0);
            this.waterTexture.offset.x += dtSeconds * 0.006 * thaw;
            this.waterTexture.offset.y += dtSeconds * 0.0035 * thaw;
        }
        if (this.tuftMaterial?.userData.shader) {
            this.tuftMaterial.userData.shader.uniforms.uTime!.value = this.time;
            this.tuftMaterial.userData.shader.uniforms.uSnowCover!.value = this.groundSnowCover;
        }
        if (this.sunLight) {
            this.treeShadows.update(this.sunLight.position, this.sunLight.intensity);
        }
    }

    /**
     * The water table: one flat translucent plane at y = -1.1. It is hidden
     * under the terrain everywhere, EXCEPT where a lake basin dips below it.
     * A painted ripple texture drifts slowly to make it read as water; under
     * snow cover it crossfades to a frozen ice albedo.
     */
    private createWater(): Mesh {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#3d7fb4';
        ctx.fillRect(0, 0, 256, 256);
        const rng = mulberry32(1234);
        // light wavy ripple strokes, drawn twice with an offset so they tile
        ctx.strokeStyle = 'rgba(210, 235, 255, 0.16)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 26; i++) {
            const y0 = rng() * 256;
            const amp = 2 + rng() * 3;
            const len = 40 + rng() * 80;
            const x0 = rng() * 256;
            for (const [ox, oy] of [
                [0, 0],
                [-256, 0],
                [0, -256],
            ] as const) {
                ctx.beginPath();
                for (let x = 0; x <= len; x += 6) {
                    const px = x0 + x + ox;
                    const py = y0 + Math.sin(x * 0.15) * amp + oy;
                    if (x === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
        }
        this.waterTexture = new CanvasTexture(canvas);
        this.waterTexture.colorSpace = SRGBColorSpace;
        this.waterTexture.wrapS = this.waterTexture.wrapT = RepeatWrapping;
        this.waterTexture.repeat.set(this.worldSize / 14, this.worldSize / 14);

        const geometry = new PlaneGeometry(this.worldSize, this.worldSize);
        geometry.rotateX(-Math.PI / 2);
        const freezeUniform = { value: 0 };
        const iceUniform: { value: import('three').Texture | null } = { value: null };
        this.waterFreezeUniform = freezeUniform;
        const material = new MeshStandardMaterial({
            map: this.waterTexture,
            transparent: true,
            opacity: 0.86,
            roughness: 0.18,
            metalness: 0,
        });
        this.waterMaterial = material;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uFreeze = freezeUniform;
            shader.uniforms.uIce = iceUniform;
            shader.fragmentShader =
                'uniform float uFreeze;\nuniform sampler2D uIce;\n' +
                shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    `#include <map_fragment>
	if (uFreeze > 0.001) {
		vec3 iceCol = texture2D(uIce, vMapUv).rgb;
		diffuseColor.rgb = mix(diffuseColor.rgb, iceCol, uFreeze);
	}`,
                );
        };
        void loadWorldTexture(iceAlbedoUrl).then((ice) => {
            if (!ice) return;
            ice.wrapS = ice.wrapT = RepeatWrapping;
            ice.repeat.set(90, 90);
            ice.colorSpace = SRGBColorSpace;
            iceUniform.value = ice;
            material.userData.iceReady = true;
            material.needsUpdate = true;
        });

        const mesh = new Mesh(geometry, material);
        mesh.position.y = -1.1;
        mesh.receiveShadow = true;
        return mesh;
    }

    private tuftMaterial: MeshStandardMaterial | null = null;

    /**
     * Small-scale life on the outer meadow: wind-swaying grass tufts, small
     * stones, fallen logs and mushrooms. Four instanced draw calls.
     */
    private createMeadowDetails(map: BattleMap, rng: () => number): void {
        const dummy = new Object3D();
        const color = new Color();

        /** random meadow-band point (outside board, on grass, not in water) */
        const meadowSpot = (maxH: number): { x: number; z: number; h: number } | null => {
            for (let attempt = 0; attempt < 60; attempt++) {
                const x = (rng() * 2 - 1) * (map.halfW + 320);
                const z = (rng() * 2 - 1) * (map.halfH + 320);
                if (Math.abs(x) <= map.halfW + 6 && Math.abs(z) <= map.halfH + 6) continue;
                const h = this.terrainHeight(x, z);
                if (h < -0.3 || h > maxH) continue;
                return { x, z, h };
            }
            return null;
        };

        // --- grass tufts: crossed alpha-tested quads, swaying in the wind
        const TUFTS = scaleCount(4200, this.density.meadow);
        const quadA = new PlaneGeometry(1.3, 1).translate(0, 0.5, 0);
        const quadB = quadA.clone().rotateY(Math.PI / 2);
        const tuftGeo = mergeGeometries([quadA, quadB])!;
        this.tuftMaterial = new MeshStandardMaterial({
            map: makeTuftTexture(),
            transparent: true,
            alphaTest: 0.35,
            side: DoubleSide,
            roughness: 1,
        });
        this.tuftMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uSnowCover = { value: 0 };
            shader.uniforms.uDryGrass = summerDryUniform;
            this.tuftMaterial!.userData.shader = shader;
            shader.vertexShader =
                'uniform float uTime;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
    #ifdef USE_INSTANCING
    float phase = instanceMatrix[3].x + instanceMatrix[3].z;
    #else
    float phase = 0.0;
    #endif
    float sway = max(position.y, 0.0); // roots stay planted, tips move
    transformed.x += sin(uTime * 1.6 + phase) * 0.14 * sway;
    transformed.z += cos(uTime * 1.1 + phase) * 0.09 * sway;`,
                );
            shader.fragmentShader =
                'uniform float uSnowCover;\nuniform float uDryGrass;\n' +
                shader.fragmentShader.replace(
                    '#include <color_fragment>',
                    `#include <color_fragment>
#ifdef USE_INSTANCING
    vec3 tuftBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
    vec3 tuftBase = vec3(0.0);
#endif
    vec3 tuftDry = mix(diffuseColor.rgb * vec3(1.22, 1.08, 0.50), vec3(0.78, 0.68, 0.28), 0.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, tuftDry, uDryGrass);
    float alpineSnow = smoothstep(170.0, 235.0, tuftBase.y);
    float snowLine = mix(220.0, -15.0, uSnowCover);
    float weatherSnow = smoothstep(snowLine - 40.0, snowLine + 15.0, tuftBase.y);
    float snowF = max(alpineSnow, weatherSnow) * 0.9;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.98), snowF);`,
                );
        };
        this.tuftMaterial.customProgramCacheKey = () => 'meadow-tuft-wind-snow-dry-v2';
        const tufts = new InstancedMesh(tuftGeo, this.tuftMaterial, TUFTS);
        let tuftI = 0;
        for (let i = 0; i < TUFTS; i++) {
            const spot = meadowSpot(20);
            if (!spot) break;
            const sc = 0.7 + rng() * 1.1;
            dummy.position.set(spot.x, spot.h, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            tufts.setMatrixAt(tuftI, dummy.matrix);
            color.set(0x55a244).lerp(new Color(0x7cc44e), rng()).lerp(new Color(0xffffff), 0.15);
            tufts.setColorAt(tuftI++, color);
        }
        tufts.count = tuftI;

        // --- small stones / logs / mushrooms: GLB floor pieces own these on high/ultra
        if (!floorPiecesEnabled(this.quality)) {
            const STONES = scaleCount(240, this.density.meadow);
            const stones = new InstancedMesh(
                new IcosahedronGeometry(0.3, 0),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
                STONES,
            );
            attachVegetationSnow(stones.material as MeshStandardMaterial, { strength: 0.45 });
            let stoneI = 0;
            for (let i = 0; i < STONES; i++) {
                const spot = meadowSpot(40);
                if (!spot) break;
                const sc = 0.5 + rng() * 1.1;
                dummy.position.set(spot.x, spot.h + 0.12 * sc, spot.z);
                dummy.scale.set(sc, sc * 0.6, sc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                stones.setMatrixAt(stoneI, dummy.matrix);
                color.set(THEME.scenery.rock).lerp(new Color(0x6a6d64), rng() * 0.6);
                stones.setColorAt(stoneI++, color);
            }
            stones.count = stoneI;

            const LOGS = scaleCount(26, this.density.meadow);
            const logs = new InstancedMesh(
                new CylinderGeometry(0.28, 0.36, 3.2, 6),
                new MeshStandardMaterial({ color: THEME.scenery.trunk, roughness: 0.9 }),
                LOGS,
            );
            attachVegetationSnow(logs.material as MeshStandardMaterial, { strength: 0.4 });
            let logI = 0;
            for (let i = 0; i < LOGS; i++) {
                const spot = meadowSpot(24);
                if (!spot) break;
                const sc = 0.7 + rng() * 0.8;
                dummy.position.set(spot.x, spot.h + 0.3 * sc, spot.z);
                dummy.scale.setScalar(sc);
                dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, Math.PI / 2);
                dummy.updateMatrix();
                logs.setMatrixAt(logI++, dummy.matrix);
            }
            logs.count = logI;
            logs.castShadow = true;

            const MUSHROOMS = scaleCount(90, this.density.meadow);
            const stem = new CylinderGeometry(0.09, 0.13, 0.5, 5).translate(0, 0.25, 0);
            const cap = new ConeGeometry(0.32, 0.34, 6).translate(0, 0.62, 0);
            const mushrooms = new InstancedMesh(
                mergeGeometries([stem, cap])!,
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
                MUSHROOMS,
            );
            attachVegetationSnow(mushrooms.material as MeshStandardMaterial, { strength: 0.82 });
            let mushI = 0;
            while (mushI < MUSHROOMS) {
                const spot = meadowSpot(36);
                if (!spot) break;
                const group = 1 + Math.floor(rng() * 3);
                for (let g = 0; g < group && mushI < MUSHROOMS; g++) {
                    const x = spot.x + (rng() - 0.5) * 2.5;
                    const z = spot.z + (rng() - 0.5) * 2.5;
                    const sc = 0.6 + rng() * 0.9;
                    dummy.position.set(x, this.terrainHeight(x, z), z);
                    dummy.scale.setScalar(sc);
                    dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.15);
                    dummy.updateMatrix();
                    mushrooms.setMatrixAt(mushI, dummy.matrix);
                    color.set(rng() < 0.4 ? 0xb84a34 : 0xc8a878).lerp(new Color(0xffffff), rng() * 0.25);
                    mushrooms.setColorAt(mushI++, color);
                }
            }
            mushrooms.count = mushI;

            this.group.add(stones, logs, mushrooms);
        }

        // --- fallen leaf litter: built now, opacity eased in for autumn (see setSeason)
        const LITTER = scaleCount(1200, this.density.meadow);
        const litterGeo = new PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2);
        const litterMaterial = new MeshStandardMaterial({
            color: 0xffffff,
            roughness: 1,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        attachVegetationSnow(litterMaterial, { strength: 0.65 });
        const litter = new InstancedMesh(litterGeo, litterMaterial, LITTER);
        litter.visible = false;
        const litterTones = [0xc86a2c, 0xd8902c, 0xb84824, 0xe0b840];
        let litterI = 0;
        for (let i = 0; i < LITTER; i++) {
            const spot = meadowSpot(30);
            if (!spot) break;
            const sc = 0.6 + rng() * 1.0;
            dummy.position.set(spot.x, spot.h + 0.03, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
            dummy.updateMatrix();
            litter.setMatrixAt(litterI, dummy.matrix);
            color.set(litterTones[Math.floor(rng() * litterTones.length)]!).lerp(new Color(0xffffff), rng() * 0.15);
            litter.setColorAt(litterI++, color);
        }
        litter.count = litterI;
        this.leafLitter = litter;

        this.group.add(tufts, litter);
    }

    /**
     * Life on and around the lakes: reeds along the shores, lily pads on the
     * water, and blossoms on some of the pads. Three instanced draw calls.
     */
    private createLakeDetails(rng: () => number): void {
        const WATER_Y = -1.1;
        const dummy = new Object3D();
        const color = new Color();

        /** random point where the lake factor and height match the given band */
        const lakeSpot = (minLake: number, hMin: number, hMax: number) => {
            for (let attempt = 0; attempt < 400; attempt++) {
                const span = this.worldSize * 0.5;
                const x = (rng() * 2 - 1) * span;
                const z = (rng() * 2 - 1) * span;
                if (this.lakeAt(x, z) < minLake) continue;
                const h = this.terrainHeight(x, z);
                if (h < hMin || h > hMax) continue;
                return { x, z, h };
            }
            return null;
        };

        const REEDS = scaleCount(160, this.density.lake);
        const reeds = new InstancedMesh(
            new CylinderGeometry(0.05, 0.09, 2.4, 4),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
            REEDS,
        );
        let reedI = 0;
        for (let i = 0; i < REEDS; i++) {
            const spot = lakeSpot(0.2, -1.5, -0.1); // shoreline band
            if (!spot) break;
            const sc = 0.7 + rng() * 0.6;
            dummy.position.set(spot.x, spot.h + 1.2 * sc, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
            dummy.updateMatrix();
            reeds.setMatrixAt(reedI, dummy.matrix);
            color.set(0x6a8a3e).lerp(new Color(0x9a8a52), rng());
            reeds.setColorAt(reedI++, color);
        }
        reeds.count = reedI;
        reeds.castShadow = true;

        const PADS = scaleCount(70, this.density.lake);
        const padGeo = new CircleGeometry(0.6, 8);
        padGeo.rotateX(-Math.PI / 2);
        const pads = new InstancedMesh(
            padGeo,
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
            PADS,
        );
        const blossoms = new InstancedMesh(
            new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
            new MeshStandardMaterial({
                map: makeFlowerTexture(),
                transparent: true,
                alphaTest: 0.4,
                roughness: 1,
            }),
            PADS,
        );
        this.flowerMaterials.push(blossoms.material as MeshStandardMaterial);
        const flowerTones = THEME.terrain.flowers;
        let padI = 0;
        let blossomI = 0;
        for (let i = 0; i < PADS; i++) {
            const spot = lakeSpot(0.7, -8, -2); // clearly inside a lake
            if (!spot) break;
            const sc = 0.7 + rng() * 0.9;
            dummy.position.set(spot.x, WATER_Y + 0.04, spot.z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            pads.setMatrixAt(padI, dummy.matrix);
            color.set(0x3e7a34).lerp(new Color(0x5a9a48), rng());
            pads.setColorAt(padI++, color);
            if (rng() < 0.35) {
                dummy.position.y = WATER_Y + 0.09;
                dummy.scale.setScalar(sc * 0.6);
                dummy.updateMatrix();
                blossoms.setMatrixAt(blossomI, dummy.matrix);
                color.set(flowerTones[Math.floor(rng() * flowerTones.length)]!);
                blossoms.setColorAt(blossomI++, color);
            }
        }
        pads.count = padI;
        blossoms.count = blossomI;

        this.group.add(reeds, pads, blossoms);
    }

    /** big back-side sphere with a painted zenith-to-horizon gradient */
    private createSkyDome(): Mesh {
        const s = THEME.scenery;
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        this.repaintSky = (zenith, mid, horizon) => {
            const grad = ctx.createLinearGradient(0, 0, 0, 256);
            grad.addColorStop(0, zenith);
            grad.addColorStop(0.32, mid);
            grad.addColorStop(0.5, horizon); // equator = horizon = fog color
            grad.addColorStop(1, horizon);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 4, 256);
            texture.needsUpdate = true;
        };
        this.repaintSky(s.skyZenith, s.skyMid, s.skyHorizon);

        const mesh = new Mesh(
            new SphereGeometry(850, 32, 16),
            new MeshBasicMaterial({ map: texture, side: BackSide, fog: false, depthWrite: false }),
        );
        mesh.renderOrder = -2; // very first: the stars (order -1) draw right on top of it
        return mesh;
    }

    /** soft additive glow billboard sitting where the directional sun points from */
    private createSunGlow(): Sprite {
        // white gradient — the weather system tints it (warm sun / pale moon)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.5)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;

        const sprite = new Sprite(
            new SpriteMaterial({
                map: texture,
                color: 0xfff2cc,
                blending: AdditiveBlending,
                fog: false,
                depthWrite: false,
                transparent: true,
            }),
        );
        // same direction the DirectionalLight shines from, pushed near the dome shell
        sprite.position.copy(new Vector3(120, 160, 80).normalize().multiplyScalar(760));
        sprite.scale.setScalar(340);
        this.sunGlow = sprite;
        return sprite;
    }

    /**
     * The world beyond the field: the SAME grass as the battlefield (same
     * texture, same tiling, one constant to match the board's macro-darkened
     * tone), with rock and snow taking over on the mountains. Vertex colors
     * carry the rock/snow tint; the grass area stays plain white.
     */
    private createOuterGround(map: BattleMap): Mesh {
        const s = THEME.scenery;
        const SIZE = this.worldSize;
        // 'low'/'off' skip decoration (trees, lake props, meadow texture) but
        // still get a real, if coarse, heightmapped ground — terrainHeight is
        // no longer flattened at these tiers (see the constructor), so a flat
        // 1-segment quad would visibly float/sink units against the relief
        // they and the deterministic horde spawn logic both see.
        // `density.segs` was tuned for a 3000-wide plane; scale so spacing
        // stays ~7.5 wu/quad now that the mesh only covers the mountain ring.
        const REF_WORLD = 3000;
        const SEGS = Math.max(
            24,
            Math.round((this.detailed ? this.density.segs : 96) * (SIZE / REF_WORLD)),
        );
        const geometry = new PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        /** 0..1 per vertex: how sandy/gravelly this spot is (lake shores + rare patches) */
        const beach = new Float32Array(pos.count);
        /** 0..1 scree pockets on mountains (concave corners + talus at cliff bases) */
        const scree = new Float32Array(pos.count);
        const meadow = new Color(0xffffff); // grass texture shows as-is
        // near-white: the tiled rock texture carries the stone color, the
        // vertex tint only adds large-scale light/dark variation
        const rock = new Color(0xf2efe9);
        const rockDark = new Color(0xf2efe9).multiplyScalar(0.75);
        const c = new Color();
        const rockVar = new Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const h = this.terrainHeight(x, z);
            pos.setY(i, h);

            // gravel shore around (and under) the lakes, fading up the banks…
            // tight band: needs solid basin + cuts off quickly uphill
            const shore = smooth01((this.lakeAt(x, z) - 0.12) / 0.45) * (1 - smooth01((h - 0.1) / 1.1));
            // …plus rare small dry patches scattered over the meadow
            const patchN = this.noise(x / 37 + 5.1, z / 37 + 50.4);
            const patch = smooth01((patchN - 0.72) / 0.09) * 0.7 * (h < 10 ? 1 : 0);
            // never right next to the board — it would break the transition
            const dOut = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            beach[i] = Math.min(1, Math.max(shore, patch)) * smooth01((dOut - 15) / 25);
            scree[i] = this.screeAccumAt(x, z, h);

            rockVar.copy(rock).lerp(rockDark, this.noise(x / 55 + 3, z / 55 + 9));
            if (h > 35) rockVar.multiplyScalar(0.68 + 0.32 * (1 - smooth01((h - 35) / 130)));
            c.copy(meadow).lerp(rockVar, smooth01((h - 12) / 45));

            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        pos.needsUpdate = true;
        geometry.setAttribute('color', new BufferAttribute(colors, 3));
        geometry.setAttribute('aBeach', new BufferAttribute(beach, 1));
        geometry.setAttribute('aScree', new BufferAttribute(scree, 1));
        geometry.computeVertexNormals();
        const normalAttr = geometry.attributes.normal!;
        const mossArr = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
            mossArr[i] = this.mossAccumAt(
                pos.getX(i),
                pos.getZ(i),
                pos.getY(i),
                normalAttr.getX(i),
                normalAttr.getY(i),
                normalAttr.getZ(i),
                scree[i]!,
            );
        }
        geometry.setAttribute('aMoss', new BufferAttribute(mossArr, 1));

        const material = new MeshStandardMaterial({
            color: s.outerGround,
            vertexColors: true,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
            flatShading: false,
        });
        const mesh = new Mesh(geometry, material);
        mesh.position.y = -0.05;
        mesh.receiveShadow = true;
        if (this.detailed) void this.applyMeadowTexture(material, map, SIZE);
        else this.applyOuterGroundSnowOnly(material);
        return mesh;
    }

    /**
     * Low/medium quality: keep the coarse (vertex-tinted) outer ground mesh,
     * but still apply weather-driven snow whitening.
     *
     * This intentionally avoids loading the HQ meadow textures; we only need
     * the same `uSnowCover` mix that `applyMeadowTexture` injects.
     */
    private applyOuterGroundSnowOnly(material: MeshStandardMaterial): void {
        material.onBeforeCompile = (shader) => {
            // Drive this uniform from the weather system (see update loop).
            shader.uniforms.uSnowCover = { value: 0 };
            this.outerGroundSnowUniform = shader.uniforms.uSnowCover as { value: number };
            shader.uniforms.uAlpineCap = this.outerGroundAlpineUniform;
            shader.uniforms.uDryGrass = summerDryUniform;

            shader.vertexShader =
                'attribute float aBeach;\nvarying float vBeach;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;\n\tvWorldXZ = position.xz;\n\tvSlope = 1.0 - normal.y;\n\tvBeach = aBeach;\n\tvWorldN = normalize( mat3( modelMatrix ) * objectNormal );',
                );

            const inject = `
${OUTER_MOUNTAIN_SNOW_GLSL}
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
${OUTER_MOUNTAIN_LIGHTING_GLSL}
            `;

            let frag =
                'varying float vBeach;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                'uniform float uSnowCover;\nuniform float uAlpineCap;\nuniform float uDryGrass;\n' +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>${inject}`);

            // Keep Three's chunk boundaries stable; only assign once so the compiler
            // sees a single coherent shader.
            shader.fragmentShader = frag;
        };

        material.customProgramCacheKey = () => `outer-meadow-snowonly-v12-${groundDetailCacheKey(
            groundMaterialProfile(),
        )}`;
        material.needsUpdate = true;
    }

    /**
     * The outer world's grass = the battlefield's grass: same texture, same
     * tile size, phase-aligned so the pattern continues across the border.
     * BOARD_TONE matches the board's average brightness (its painted macro
     * layer darkens it slightly). On the mountains the rock texture takes
     * over (by height and slope), with plain white snow above.
     */
    private async applyMeadowTexture(
        material: MeshStandardMaterial,
        map: BattleMap,
        size: number,
    ): Promise<void> {
        const BOARD_TONE = 0.93;
        const profile = groundMaterialProfile();
        const tileSize = profile.detailTile;
        // Gravel shore tile — smaller than lawn so pebbles stay pebble-sized
        const shoreTile = 11;
        /** Coarser shore on mountain scree pockets (same texture as lake gravel) */
        const shoreMountainTile = 38;
        const rockTile = 34; // legacy rock tile scale
        const rockPhotoTile = PHOTO_BLEND.rock.worldScale;
        const [grass, rockPack, shore] = await Promise.all([
            loadGrassTextures(),
            loadRockTextures(),
            loadWorldTexture(shoreAlbedoUrl),
        ]);
        if (!grass?.albedo) return;
        const { albedo, normal } = grass;
        const rock = rockPack?.albedo ?? null;
        const rockPhoto1 = rockPack?.variants[0] ?? null;
        const rockPhoto2 = rockPack?.variants[1] ?? null;
        // Outer meadow: lighter photo accents only (no dark seamless photo-2)
        const photoGrass =
            grass.variants[0] && grass.variants[1]
                ? ([grass.variants[0], grass.variants[1]] as const)
                : null;
        const frac = (v: number) => ((v % 1) + 1) % 1;
        const configure = (tex: NonNullable<typeof albedo>) => {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(size / tileSize, size / tileSize);
            tex.offset.set(frac(map.halfW / tileSize), frac(map.halfH / tileSize));
            tex.anisotropy = profile.anisotropy;
        };
        configure(albedo);
        albedo.colorSpace = SRGBColorSpace;
        material.map = albedo;
        if (normal) {
            configure(normal);
            material.normalMap = normal;
            const n = profile.normalScale;
            material.normalScale = new Vector2(n, n);
        }
        if (rock) {
            rock.wrapS = rock.wrapT = RepeatWrapping;
            rock.colorSpace = SRGBColorSpace;
            rock.anisotropy = profile.anisotropy;
        }
        for (const rp of [rockPhoto1, rockPhoto2]) {
            if (!rp) continue;
            rp.wrapS = rp.wrapT = RepeatWrapping;
            rp.colorSpace = SRGBColorSpace;
            rp.anisotropy = profile.anisotropy;
        }
        if (shore) {
            shore.wrapS = shore.wrapT = RepeatWrapping;
            shore.colorSpace = SRGBColorSpace;
            shore.anisotropy = profile.anisotropy;
        }
        for (const v of grass.variants) {
            v.wrapS = v.wrapT = RepeatWrapping;
            v.colorSpace = SRGBColorSpace;
            v.anisotropy = profile.anisotropy;
            v.repeat.set(size / tileSize, size / tileSize);
            v.offset.set(frac(map.halfW / tileSize), frac(map.halfH / tileSize));
        }
        material.color.set(0xffffff);
        const useDetail = profile.detailStrength > 0;
        const bomb = useDetail && profile.textureBomb;
        // Soften the flat BOARD_TONE dim on HQ so meadow grass pops with the board.
        const toneMix = 0.35 + 0.65 * profile.macroStrength;
        material.onBeforeCompile = (shader) => {
            if (rock) shader.uniforms.uRock = { value: rock };
            if (rockPhoto1) shader.uniforms.uRockPhoto1 = { value: rockPhoto1 };
            if (rockPhoto2) shader.uniforms.uRockPhoto2 = { value: rockPhoto2 };
            if (photoGrass) {
                shader.uniforms.uPhotoGrass1 = { value: photoGrass[0] };
                shader.uniforms.uPhotoGrass2 = { value: photoGrass[1] };
            }
            if (shore) shader.uniforms.uShore = { value: shore };
            shader.uniforms.uSnowCover = { value: 0 };
            this.outerGroundSnowUniform = shader.uniforms.uSnowCover as { value: number };
            shader.uniforms.uAlpineCap = this.outerGroundAlpineUniform;
            shader.uniforms.uDryGrass = summerDryUniform;
            if (useDetail) {
                shader.uniforms.uDetailScale = { value: profile.detailScale };
                shader.uniforms.uDetailStrength = { value: profile.detailStrength };
            }
            bindCloseTileUniforms(shader.uniforms as Record<string, { value: unknown }>, profile);
            const softBlobFn =
                'float softBlobMask( vec2 uv, float cellScale, float density, float radius ) {\n' +
                '\tvec2 cell = floor( uv * cellScale );\n' +
                '\tfloat acc = 0.0;\n' +
                '\tfor ( int j = -1; j <= 1; j ++ ) {\n' +
                '\t\tfor ( int i = -1; i <= 1; i ++ ) {\n' +
                '\t\t\tvec2 c = cell + vec2( float( i ), float( j ) );\n' +
                '\t\t\tfloat h = fract( sin( dot( c, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );\n' +
                '\t\t\tif ( h <= density ) {\n' +
                '\t\t\t\tvec2 jitter = vec2(\n' +
                '\t\t\t\t\tfract( sin( dot( c, vec2( 269.5, 183.3 ) ) ) * 43758.5453 ),\n' +
                '\t\t\t\t\tfract( sin( dot( c + 19.2, vec2( 113.5, 271.9 ) ) ) * 43758.5453 )\n' +
                '\t\t\t\t);\n' +
                '\t\t\t\tvec2 center = ( c + 0.5 + ( jitter - 0.5 ) * 0.9 ) / cellScale;\n' +
                '\t\t\t\tfloat d = length( uv - center ) * cellScale;\n' +
                '\t\t\t\tfloat r = radius * ( 0.5 + 0.5 * fract( h * 7.13 ) );\n' +
                '\t\t\t\tacc = max( acc, 1.0 - smoothstep( r * 0.25, r, d ) );\n' +
                '\t\t\t}\n' +
                '\t\t}\n' +
                '\t}\n' +
                '\treturn clamp( acc, 0.0, 1.0 );\n' +
                '}\n';
            shader.vertexShader =
                'attribute float aBeach;\nattribute float aScree;\nattribute float aMoss;\nvarying float vBeach;\nvarying float vScree;\nvarying float vMoss;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;\n\tvWorldXZ = position.xz;\n\tvSlope = 1.0 - normal.y;\n\tvBeach = aBeach;\n\tvScree = aScree;\n\tvMoss = aMoss;\n\tvWorldN = normalize( mat3( modelMatrix ) * objectNormal );',
                );
            let inject = `
    diffuseColor.rgb *= mix( 1.0, ${BOARD_TONE.toFixed(2)}, ${toneMix.toFixed(2)} );`;
            if (profile.closeRepeat > 1.01) {
                inject += closeTileInjectGlsl(profile);
            } else {
                inject += closeTileWeightFallbackGlsl(profile);
            }
            if (bomb) {
                inject += `
    vec2 bombUv = vMapUv.yx * vec2( -1.0, 1.0 ) + vec2( 0.37, 0.19 );
    float bombW = fract( sin( dot( floor( vMapUv * 4.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    bombW = smoothstep( 0.28, 0.72, bombW );
    diffuseColor.rgb = mix( diffuseColor.rgb, texture2D( map, bombUv ).rgb, bombW * 0.55 );`;
            }
            if (useDetail) {
                if (profile.closeRepeat > 1.01) {
                    inject += `
    vec3 detailAlb = texture2D(map, mix( vMapUv, closeUv, closeW ) * uDetailScale).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);`;
                } else {
                    inject += `
    vec3 detailAlb = texture2D(map, vMapUv * uDetailScale).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detailAlb * 2.0, uDetailStrength);`;
                }
            }
            if (photoGrass) {
                const pgClose =
                    profile.closeRepeat > 1.01
                        ? `
    float pgSoft = softBlobMask( vMapUv, 1.15, 0.28, 0.12 );
    vec2 pgUv = vMapUv * 3.4;
    float pgWhich = fract( sin( dot( floor( vMapUv * 1.15 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 pgTex = mix(
        texture2D( uPhotoGrass1, pgUv ).rgb,
        texture2D( uPhotoGrass2, pgUv.yx * 1.07 + 0.21 ).rgb,
        step( 0.5, pgWhich ) );
    float pgLum = max( dot( pgTex, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 pgDetail = pgTex / pgLum;
    float pgAmt = pgSoft * 0.55 * mix( 1.0, 0.08, closeW );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pgDetail, pgAmt );`
                        : `
    float pgSoft = softBlobMask( vMapUv, 1.15, 0.28, 0.12 );
    vec2 pgUv = vMapUv * 3.4;
    float pgWhich = fract( sin( dot( floor( vMapUv * 1.15 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 pgTex = mix(
        texture2D( uPhotoGrass1, pgUv ).rgb,
        texture2D( uPhotoGrass2, pgUv.yx * 1.07 + 0.21 ).rgb,
        step( 0.5, pgWhich ) );
    float pgLum = max( dot( pgTex, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 pgDetail = pgTex / pgLum;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pgDetail, pgSoft * 0.55 );`;
                inject += `
    // Photo accents fade when zoomed in — keep close lawn uniform
${pgClose}`;
            }
            if (shore) {
                inject += `
    // gravel shore where the geometry says so: lake banks + rare dry patches
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uShore, vWorldXZ / ${shoreTile.toFixed(1)}).rgb, vBeach);`;
            }
            inject += `
${OUTER_MOUNTAIN_SNOW_GLSL}
    float rockF = 0.0;`;
            if (rock) {
                inject += `
    rockF = max(smoothstep(16.0, 55.0, vTerrainH), smoothstep(0.32, 0.58, vSlope) * smoothstep(3.0, 9.0, vTerrainH));
    rockF = max(rockF * (1.0 - snowF), cliffStrip * (0.14 + breakup * 0.4) * mix(0.1, 0.65, deepWinter));
    vec3 rockTop = texture2D(uRock, vWorldXZ / ${rockTile.toFixed(1)}).rgb;
    vec3 rockSide = texture2D(uRock, vec2(length(vWorldXZ), vTerrainH) / ${rockTile.toFixed(1)}).rgb;
    vec3 rockCol = mix(rockTop, rockSide, smoothstep(0.3, 0.72, vSlope));
    rockCol *= mix(vec3(1.0), vec3(0.42, 0.4, 0.38), deepWinter * mountainZone);`;
                if (rockPhoto1) {
                    const rk = PHOTO_BLEND.rock;
                    inject += `
    vec2 rockUv = vWorldXZ / ${rockPhotoTile.toFixed(1)};
    float rockSoft = softBlobMask( rockUv, ${rk.cellScale.toFixed(2)}, ${rk.density.toFixed(2)}, ${rk.radius.toFixed(2)} );
    float rWhich = fract( sin( dot( floor( rockUv * 0.85 ), vec2( 91.7, 53.1 ) ) ) * 43758.5453 );
    vec3 rockPhoto = texture2D( uRockPhoto1, rockUv * ${rk.uvScale.toFixed(2)} ).rgb;`;
                    if (rockPhoto2) {
                        inject += `
    rockPhoto = mix( rockPhoto, texture2D( uRockPhoto2, rockUv.yx * 1.25 + 0.17 ).rgb, step( 0.5, rWhich ) );`;
                    }
                    inject += `
    float rpLum = max( dot( rockPhoto, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    rockCol = mix( rockCol, rockCol * ( rockPhoto / rpLum ), rockSoft * ${rk.strength.toFixed(2)} );`;
                }
                inject += `
    diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockF);`;
                if (shore) {
                    inject += `
    // scree pockets: shore gravel (small stones piled in concave gullies)
    float screeShow = clamp( vScree * mountainZone * ( 1.0 - snowF ), 0.0, 1.0 );
    vec3 gravelCol = texture2D( uShore, vWorldXZ / ${shoreMountainTile.toFixed(1)} ).rgb;
    diffuseColor.rgb = mix( diffuseColor.rgb, gravelCol, screeShow * max( rockF, 0.3 ) );`;
                }
                inject += `
    // moss: mid-elevation cliffs/crevices only (~40–100 wu), baked in aMoss
    float midAlt = smoothstep( 40.0, 62.0, vTerrainH ) * ( 1.0 - smoothstep( 100.0, 124.0, vTerrainH ) );
    float mossShow = clamp( vMoss * ( 0.38 + 0.22 * breakup ) * midAlt, 0.0, 1.0 );
    // same snow tint as the board (see map.ts) so the field edge matches
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
    diffuseColor.rgb = mix( diffuseColor.rgb, mossDetail( vMapUv * vec2( 1.18, 0.92 ) ), mossShow * ( 1.0 - snowF ) * 0.82 );
${OUTER_MOUNTAIN_LIGHTING_GLSL}`;
            } else {
                inject += `
    diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowF);
${OUTER_MOUNTAIN_LIGHTING_GLSL}`;
            }
            const needBlob = !!(photoGrass || rockPhoto1);
            let frag =
                'varying float vBeach;\nvarying float vScree;\nvarying float vMoss;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\nvarying vec3 vWorldN;\n' +
                (rock ? 'uniform sampler2D uRock;\n' : '') +
                (rockPhoto1 ? 'uniform sampler2D uRockPhoto1;\n' : '') +
                (rockPhoto2 ? 'uniform sampler2D uRockPhoto2;\n' : '') +
                (photoGrass ? 'uniform sampler2D uPhotoGrass1;\nuniform sampler2D uPhotoGrass2;\n' : '') +
                (shore ? 'uniform sampler2D uShore;\n' : '') +
                (useDetail ? 'uniform float uDetailScale;\nuniform float uDetailStrength;\n' : '') +
                closeTileUniformDecls(profile) +
                'uniform float uSnowCover;\nuniform float uAlpineCap;\nuniform float uDryGrass;\n' +
                (needBlob ? softBlobFn : '') +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>${inject}`);
            if (rock) {
                frag = frag.replace(
                    '#include <map_pars_fragment>',
                    `#include <map_pars_fragment>\n${MOSS_DETAIL_FN_GLSL}`,
                );
            }
            if (useDetail && normal) {
                let normalInject = `#include <normal_fragment_maps>
\tvec3 detailN = texture2D( normalMap, vMapUv * uDetailScale ).xyz * 2.0 - 1.0;
\tdetailN.xy *= uDetailStrength;
\tnormal = normalize( vec3( normal.xy + detailN.xy, normal.z ) );`;
                if (profile.closeRepeat > 1.01) {
                    normalInject += `
\tvec3 closeN = texture2D( normalMap, vMapUv * uCloseRepeat ).xyz * 2.0 - 1.0;
\tnormal = normalize( mix( normal, closeN, closeW ) );`;
                }
                frag = frag.replace('#include <normal_fragment_maps>', normalInject);
            }
            if (profile.roughnessFromAlbedo) {
                frag = frag.replace(
                    '#include <roughnessmap_fragment>',
                    `#include <roughnessmap_fragment>
\tfloat grassLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
\troughnessFactor = clamp( roughnessFactor + ( 0.42 - grassLum ) * 0.22, 0.62, 0.98 );`,
                );
            }
            shader.fragmentShader = frag;
        };
        material.customProgramCacheKey = () =>
            `outer-meadow-v50${rock ? '-rock' : ''}${rockPhoto1 ? '-rp' : ''}${photoGrass ? '-pgmild' : ''}${shore ? '-scree-moss' : ''}-t${shoreTile}-m${shoreMountainTile}-${groundDetailCacheKey(profile)}`;
        material.needsUpdate = true;
    }

    /**
     * Trees, bushes — forest belt + a few on the battlefield.
     * High: dense low-poly forest. Ultra: same density with Tripo mid-poly GLBs.
     */
    private createForest(map: BattleMap, rng: () => number): void {
        const s = THEME.scenery;
        const dens = this.density;
        const hq = sceneryHqVegetation(this.quality);
        // reach lower mountain slopes (rise starts ~d=55, foothills to ~350)
        const margin = dens.margin;
        const acceptBase = dens.acceptBase;
        // forest measured from the playable edge so trees sit on the rim;
        // keepOut matches the pre-rim clearance (~2 tiles) so the wall isn't
        // tighter than the old board-edge forest
        const rimW = map.size.rimCells * CELL;
        const forestHalfW = map.halfW - rimW;
        const forestHalfH = map.halfH - rimW;
        const keepOut = 8;

        const distOut = (x: number, z: number) =>
            Math.max(Math.abs(x) - forestHalfW, Math.abs(z) - forestHalfH, 0);

        /** random grassy point outside the field (never on mountain stone) */
        const forestSpot = (maxHeight: number): { x: number; z: number } => {
            const tries = dens.outer >= 5 ? 80 : 24;
            for (let attempt = 0; attempt < tries; attempt++) {
                // ultra: near wall + mid meadow + far green foothills
                let sampleMargin = margin;
                if (dens.outer >= 5) {
                    const roll = rng();
                    if (roll < 0.34) sampleMargin = 140; // board-edge wall
                    else if (roll < 0.55) sampleMargin = 280; // mid meadow
                    else sampleMargin = margin; // green pockets toward mountains
                }
                const x = (rng() * 2 - 1) * (forestHalfW + sampleMargin);
                const z = (rng() * 2 - 1) * (forestHalfH + sampleMargin);
                const d = distOut(x, z);
                if (d < keepOut) continue;
                const h = this.terrainHeight(x, z);
                if (h > maxHeight) continue;
                if (h < -0.4) continue; // no trees in the lakes
                if (!this.isGrassy(x, z)) continue; // no trees on rock/snow
                // thin near the field, dense toward foothills, taper far out
                const belt =
                    smooth01((d - dens.beltNear) / dens.beltRamp) *
                    (1 - smooth01((d - dens.beltFar) / 120));
                if (rng() > acceptBase + belt * (1 - acceptBase)) continue;
                return { x, z };
            }
            // fallback: any grassy outer point
            for (let attempt = 0; attempt < 80; attempt++) {
                const x = (rng() * 2 - 1) * (forestHalfW + margin);
                const z = (rng() * 2 - 1) * (forestHalfH + margin);
                if (distOut(x, z) < keepOut) continue;
                if (this.terrainHeight(x, z) < -0.4) continue;
                if (!this.isGrassy(x, z)) continue;
                return { x, z };
            }
            // last resort (should be rare)
            for (;;) {
                const x = (rng() * 2 - 1) * (forestHalfW + margin);
                const z = (rng() * 2 - 1) * (forestHalfH + margin);
                if (distOut(x, z) >= keepOut) return { x, z };
            }
        };
        // on the battlefield, but never in a base's courtyard
        const anchors = map.baseAnchors();
        const playHalfW = forestHalfW;
        const playHalfH = forestHalfH;
        const fieldSpot = (clearance: number): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * playHalfW;
                const z = (rng() * 2 - 1) * playHalfH;
                if (anchors.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + clearance)) {
                    return { x, z };
                }
            }
        };
        // field relief inside, mountain terrain outside (each is 0 elsewhere)
        const groundY = (x: number, z: number) => this.terrainHeight(x, z) + map.heightAt(x, z);

        const dummy = new Object3D();
        const color = new Color();
        const white = new Color(0xffffff);
        const lighten = (c: Color) => c.lerp(white, 0.45);
        // Ultra: Tripo owns all trees via addHqVegetation.
        // High: Tripo on the board, billboards outside (with blob shadows).
        // Medium: billboards everywhere (no low-poly cones, no blob shadows).
        const billboardMix = this.quality === 'high' || this.quality === 'medium';
        const PINES = hq ? 0 : scaleCount(200, dens.outer);
        const LEAFY = hq ? 0 : scaleCount(120, dens.outer);
        const FIELD_PINES = hq ? 0 : scaleCount(3, dens.field);
        const FIELD_LEAFY = hq ? 0 : scaleCount(3, dens.field);
        const BUSHES = hq ? 0 : scaleCount(90, dens.outer);
        const FIELD_BUSHES = hq ? 0 : scaleCount(22, dens.field);
        // horde mode widens the neutral strip into a real belt — grow a
        // forest in it so the horde has somewhere to live (pure scenery, no
        // collision; packs standing between trunks is the point). Treated
        // as on-field vegetation like FIELD_* above: zeroed on Ultra,
        // billboard/Tripo-routed on High/Medium.
        const beltHalf = (map.size.neutralRows * CELL) / 2;
        const beltWide = map.size.neutralRows > 8;
        const BELT_PINES = hq || !beltWide ? 0 : scaleCount(26, dens.field);
        const BELT_LEAFY = hq || !beltWide ? 0 : scaleCount(30, dens.field);
        const BELT_BUSHES = hq || !beltWide ? 0 : scaleCount(28, dens.field);
        const beltSpot = (): { x: number; z: number } => ({
            x: (rng() * 2 - 1) * (map.halfW - 8),
            z: (rng() * 2 - 1) * Math.max(0, beltHalf - 4),
        });

        const treeCapacity = PINES + LEAFY + FIELD_PINES + FIELD_LEAFY + BELT_PINES + BELT_LEAFY;
        const bushCapacity = BUSHES + FIELD_BUSHES + BELT_BUSHES;
        const placeProceduralTrees = treeCapacity > 0 && !billboardMix;

        let trunks: InstancedMesh | null = null;
        let cones: InstancedMesh | null = null;
        let blobs: InstancedMesh | null = null;
        let bushes: InstancedMesh | null = null;

        if (placeProceduralTrees) {
            trunks = new InstancedMesh(
                new CylinderGeometry(0.35, 0.55, 3.4, 6),
                new MeshStandardMaterial({ color: s.trunk, roughness: 0.9 }),
                treeCapacity,
            );
            cones = new InstancedMesh(
                new ConeGeometry(2.6, 6, 7),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
                (PINES + FIELD_PINES + BELT_PINES) * 2,
            );
            blobs = new InstancedMesh(
                new IcosahedronGeometry(2.4, 1),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
                (LEAFY + FIELD_LEAFY + BELT_LEAFY) * 2,
            );
            attachVegetationSnow(trunks.material as MeshStandardMaterial, { strength: 0.55 });
            attachVegetationSnow(cones.material as MeshStandardMaterial, { strength: 0.92 });
            attachVegetationSnow(blobs.material as MeshStandardMaterial, { strength: 0.92 });
            // pines stay green year-round — only the leafy (oak) canopy retints
            attachSeasonTint(blobs.material as MeshStandardMaterial);
        }
        if (bushCapacity > 0 && !billboardMix) {
            bushes = new InstancedMesh(
                new IcosahedronGeometry(1, 1),
                new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
                bushCapacity,
            );
            attachVegetationSnow(bushes.material as MeshStandardMaterial, { strength: 0.92 });
            attachSeasonTint(bushes.material as MeshStandardMaterial);
        }

        let trunkI = 0;
        let coneI = 0;
        let blobI = 0;
        type PlantSpot = { kind: VegetationKind; x: number; z: number; sc: number };
        const farPlants: PlantSpot[] = [];
        const fieldHqPlants: PlantSpot[] = [];
        /** High: board → Tripo, outside → billboard. Medium: everything → billboard. */
        const routeBillboard = (
            onField: boolean,
            kind: VegetationKind,
            x: number,
            z: number,
            sc: number,
        ) => {
            if (!billboardMix) return false;
            if (this.quality === 'high' && onField) fieldHqPlants.push({ kind, x, z, sc });
            else farPlants.push({ kind, x, z, sc });
            return true;
        };

        const placeTrunk = (x: number, z: number, sc: number, h: number) => {
            if (!trunks) return;
            dummy.position.set(x, h + 1.7 * sc, z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            trunks.setMatrixAt(trunkI++, dummy.matrix);
        };

        // Always walk the counts on high (for billboard/Tripo routing) even with no procedural meshes.
        for (let i = 0; i < PINES + FIELD_PINES + BELT_PINES; i++) {
            const onField = i >= PINES;
            const { x, z } = onField
                ? i < PINES + FIELD_PINES
                    ? fieldSpot(10)
                    : beltSpot()
                : forestSpot(84);
            const sc = onField ? 0.7 + rng() * 0.5 : 0.8 + rng() * 1.1;
            if (routeBillboard(onField, 'pine', x, z, sc)) continue;
            if (!trunks || !cones) continue;
            const h = groundY(x, z);
            placeTrunk(x, z, sc, h);
            lighten(color.set(s.pine).lerp(new Color(s.pineLight), rng()));
            for (const [ty, tsc] of [
                [3.2, 1],
                [6.2, 0.62],
            ] as const) {
                dummy.position.set(x, h + (3.4 * 0.5 + ty) * sc, z);
                dummy.scale.setScalar(sc * tsc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                cones.setMatrixAt(coneI, dummy.matrix);
                cones.setColorAt(coneI++, color);
            }
        }

        for (let i = 0; i < LEAFY + FIELD_LEAFY + BELT_LEAFY; i++) {
            const onField = i >= LEAFY;
            const { x, z } = onField
                ? i < LEAFY + FIELD_LEAFY
                    ? fieldSpot(10)
                    : beltSpot()
                : forestSpot(72);
            const sc = onField ? 0.75 + rng() * 0.55 : 0.9 + rng() * 1.2;
            if (routeBillboard(onField, 'oak', x, z, sc)) continue;
            if (!trunks || !blobs) continue;
            const h = groundY(x, z);
            placeTrunk(x, z, sc, h);
            lighten(color.set(s.leaf).lerp(new Color(s.leafLight), rng()));
            for (const [ox, oy, oz, bsc] of [
                [0, 4.6, 0, 1.15],
                [1.4, 3.6, 0.9, 0.7],
            ] as const) {
                dummy.position.set(x + ox * sc, h + oy * sc, z + oz * sc);
                dummy.scale.set(sc * bsc, sc * bsc * 0.85, sc * bsc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                blobs.setMatrixAt(blobI, dummy.matrix);
                blobs.setColorAt(blobI++, color);
            }
        }

        if (bushes || billboardMix) {
            let bushI = 0;
            for (let i = 0; i < BUSHES + FIELD_BUSHES + BELT_BUSHES; i++) {
                const onField = i >= BUSHES;
                const { x, z } = onField
                    ? i < BUSHES + FIELD_BUSHES
                        ? fieldSpot(5)
                        : beltSpot()
                    : forestSpot(56);
                const sc = 0.6 + rng() * 0.8;
                const kind: VegetationKind = rng() < 0.55 ? 'bushRound' : 'bushTall';
                if (routeBillboard(onField, kind, x, z, sc)) continue;
                if (!bushes) continue;
                dummy.position.set(x, groundY(x, z) + 0.45 * sc, z);
                dummy.scale.set(sc * (0.9 + rng() * 0.4), sc * 0.7, sc * (0.9 + rng() * 0.4));
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                bushes.setMatrixAt(bushI, dummy.matrix);
                lighten(color.set(s.leaf).lerp(new Color(s.leafLight), rng() * 0.8));
                bushes.setColorAt(bushI++, color);
            }
            if (bushes) bushes.count = bushI;
        }

        if (trunks) trunks.count = trunkI;
        if (cones) cones.count = coneI;
        if (blobs) blobs.count = blobI;

        for (const m of [trunks, cones, blobs, bushes]) {
            if (!m) continue;
            m.castShadow = true;
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            this.group.add(m);
        }

        if (farPlants.length > 0) {
            void this.placeFarBillboards(farPlants, groundY, rng, {
                shadows: this.quality !== 'medium',
            });
        }
        if (fieldHqPlants.length > 0) {
            void this.placeTripoVegetation(fieldHqPlants, groundY, rng);
        }

        // wildflowers: 3/4 outer meadow, 1/4 playable board
        const FLOWERS_TOTAL = scaleCount(280, dens.outer); // half of former 560
        const MEADOW_FLOWERS = Math.round(FLOWERS_TOTAL * 0.75);
        const FIELD_FLOWERS = FLOWERS_TOTAL - MEADOW_FLOWERS;
        const FLOWERS = MEADOW_FLOWERS + FIELD_FLOWERS;
        const flowerGeo = new PlaneGeometry(1.1, 1.1);
        flowerGeo.rotateX(-Math.PI / 2);
        const flowers = new InstancedMesh(
            flowerGeo,
            new MeshStandardMaterial({
                map: makeFlowerTexture(),
                transparent: true,
                alphaTest: 0.4,
                roughness: 1,
                metalness: 0,
            }),
            FLOWERS,
        );
        this.flowerMaterials.push(flowers.material as MeshStandardMaterial);
        const flowerTones = THEME.terrain.flowers;
        const clearOfBases = (x: number, z: number) =>
            anchors.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + 3);
        // Board flowers: 1/6 edge strip, 1/3 midfield, 1/2 anywhere.
        const EDGE_BAND = 30;
        const midHalf = Math.max((map.size.neutralRows * CELL) / 2, map.halfH * 0.22, 18);
        const boardEdgeSpot = (): { x: number; z: number } => {
            for (;;) {
                const side = Math.floor(rng() * 4);
                let x: number;
                let z: number;
                if (side === 0) {
                    x = (rng() * 2 - 1) * (map.halfW - 2);
                    z = map.halfH - 2 - rng() * EDGE_BAND;
                } else if (side === 1) {
                    x = (rng() * 2 - 1) * (map.halfW - 2);
                    z = -map.halfH + 2 + rng() * EDGE_BAND;
                } else if (side === 2) {
                    x = map.halfW - 2 - rng() * EDGE_BAND;
                    z = (rng() * 2 - 1) * (map.halfH - 2);
                } else {
                    x = -map.halfW + 2 + rng() * EDGE_BAND;
                    z = (rng() * 2 - 1) * (map.halfH - 2);
                }
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const boardMidSpot = (): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW - 2);
                const z = (rng() * 2 - 1) * Math.min(midHalf, map.halfH - EDGE_BAND - 2);
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const boardRandomSpot = (): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW - 2);
                const z = (rng() * 2 - 1) * (map.halfH - 2);
                if (clearOfBases(x, z)) return { x, z };
            }
        };
        const meadowSpot = (): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (forestHalfW + 260);
                const z = (rng() * 2 - 1) * (forestHalfH + 260);
                if (distOut(x, z) < 1) continue; // just outside the forest edge
                const h = this.terrainHeight(x, z);
                if (h > -0.4 && h < 5) return { x, z }; // meadow only, not in lakes
            }
        };
        // Small color-matched clumps — not large patches
        let flowerI = 0;
        const plantFlowerClump = (cx: number, cz: number, spread: number) => {
            const clumpTone = flowerTones[Math.floor(rng() * flowerTones.length)]!;
            const clump = 3 + Math.floor(rng() * 5);
            for (let f = 0; f < clump && flowerI < FLOWERS; f++) {
                const x = cx + (rng() - 0.5) * spread;
                const z = cz + (rng() - 0.5) * spread;
                const sc = 0.7 + rng() * 0.9;
                dummy.position.set(x, groundY(x, z) + 0.08, z);
                dummy.scale.setScalar(sc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                flowers.setMatrixAt(flowerI, dummy.matrix);
                color.set(rng() < 0.75 ? clumpTone : flowerTones[Math.floor(rng() * flowerTones.length)]!);
                flowers.setColorAt(flowerI++, color);
            }
        };
        while (flowerI < MEADOW_FLOWERS) {
            const center = meadowSpot();
            plantFlowerClump(center.x, center.z, 9);
        }
        const fieldEdgeEnd = MEADOW_FLOWERS + Math.round(FIELD_FLOWERS / 6);
        const fieldMidEnd = MEADOW_FLOWERS + Math.round(FIELD_FLOWERS / 2); // edge 1/6 + mid 1/3
        while (flowerI < fieldEdgeEnd) {
            const center = boardEdgeSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        while (flowerI < fieldMidEnd) {
            const center = boardMidSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        while (flowerI < FLOWERS) {
            const center = boardRandomSpot();
            plantFlowerClump(center.x, center.z, 5);
        }
        flowers.count = flowerI;
        flowers.instanceMatrix.needsUpdate = true;
        if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
        this.group.add(flowers);
        // High+: tint petals sitting in oil/acid (medium skips — one less sample).
        if (this.quality === 'high' || this.quality === 'ultra') {
            for (const m of this.flowerMaterials) {
                attachFlowerHazardTint(m, map);
            }
        }

        if (trunks && cones && blobs && bushes) {
            void this.applyForestTextures(
                trunks.material as MeshStandardMaterial,
                cones.material as MeshStandardMaterial,
                [blobs.material as MeshStandardMaterial, bushes.material as MeshStandardMaterial],
            );
        }

        if (hq) {
            void this.addHqVegetation(map, rng, {
                forestSpot,
                fieldSpot,
                groundY,
                distOut,
            });
        }

        if (floorPiecesEnabled(this.quality)) {
            void this.placeFloorPieces(map, rng, { fieldSpot, forestSpot, groundY });
        }
    }

    /** Ground clutter from floorpieces.glb — board props + a few special placements. */
    private async placeFloorPieces(
        map: BattleMap,
        rng: () => number,
        helpers: {
            fieldSpot: (clearance: number) => { x: number; z: number };
            forestSpot: (maxHeight: number) => { x: number; z: number };
            groundY: (x: number, z: number) => number;
        },
    ): Promise<void> {
        await loadFloorPieces();
        const { fieldSpot, forestSpot, groundY } = helpers;

        // One of each authored piece — shuffle so positions aren't fixed by load order.
        const ids = listFloorPieces();
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = ids[i]!;
            ids[i] = ids[j]!;
            ids[j] = tmp;
        }

        const placements: FloorPiecePlacement[] = [];
        const pushPiece = (id: string, x: number, z: number, tilt = 0.22) => {
            const scale = floorPieceScale(id, rng);
            placements.push({
                id,
                x,
                y: groundY(x, z) - floorPieceGroundSink(scale),
                z,
                scale,
                yaw: rng() * Math.PI * 2,
                tiltX: (rng() - 0.5) * tilt,
                tiltZ: (rng() - 0.5) * tilt,
            });
        };

        for (const id of ids) {
            const { x, z } = fieldSpot(3);
            pushPiece(id, x, z);
        }

        // Same GLB set in the outer forest/meadow (replaces procedural stones/logs/mushrooms).
        const forestPool = listFloorPieces();
        const FOREST = scaleCount(this.quality === 'ultra' ? 160 : 90, this.density.meadow);
        for (let i = 0; i < FOREST && forestPool.length > 0; i++) {
            const id = forestPool[Math.floor(rng() * forestPool.length)]!;
            const { x, z } = forestSpot(40);
            pushPiece(id, x, z);
        }

        // `stone` ×4, evenly along the mid line between the two sides (z ≈ 0).
        const STONE_COUNT = 4;
        const margin = 10;
        const span = map.halfW * 2 - margin * 2;
        for (let i = 0; i < STONE_COUNT; i++) {
            const x = -map.halfW + margin + ((i + 0.5) / STONE_COUNT) * span;
            pushPiece('stone', x, 0, 0.12);
        }

        // Easter-egg coin — once, in the outer woods, well clear of the board.
        {
            const rimW = map.size.rimCells * CELL;
            const forestHalfW = map.halfW - rimW;
            const forestHalfH = map.halfH - rimW;
            const distOut = (x: number, z: number) =>
                Math.max(Math.abs(x) - forestHalfW, Math.abs(z) - forestHalfH, 0);
            const COIN_MIN_DIST = 120;
            let x = 0;
            let z = 0;
            let found = false;
            for (let attempt = 0; attempt < 80; attempt++) {
                const spot = forestSpot(56);
                if (distOut(spot.x, spot.z) < COIN_MIN_DIST) continue;
                x = spot.x;
                z = spot.z;
                found = true;
                break;
            }
            if (!found) {
                // Fallback: push a forest sample outward along its ray from the board.
                const spot = forestSpot(56);
                const d = Math.max(distOut(spot.x, spot.z), 1);
                const scaleOut = COIN_MIN_DIST / d;
                x = spot.x * scaleOut;
                z = spot.z * scaleOut;
            }
            pushPiece('coin', x, z, 0.18);
        }

        const meshes = buildFloorPieceMeshes(placements);
        for (const mesh of meshes) this.group.add(mesh);
        console.info(
            `[scenery] floor pieces: ${placements.length} (board + ${FOREST} forest + specials)`,
        );
    }

    /** Far belt as crossed billboard cards; optional sun-aligned blob shadows. */
    private async placeFarBillboards(
        plants: { kind: VegetationKind; x: number; z: number; sc: number }[],
        groundY: (x: number, z: number) => number,
        rng: () => number,
        opts: { shadows?: boolean } = {},
    ): Promise<void> {
        const withShadows = opts.shadows !== false;
        await loadSceneryBillboards();
        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        const shadows: BlobShadowSource[] = [];
        let total = 0;
        for (const kind of kinds) {
            const list = plants.filter((p) => p.kind === kind);
            if (list.length === 0) continue;
            const mesh = createBillboardInstances(kind, list.length);
            if (!mesh) {
                console.warn(`[scenery] billboard '${kind}' missing`);
                continue;
            }
            for (const p of list) {
                const sc = p.sc * BILLBOARD_SCALE;
                placeVegetationInstance(
                    mesh,
                    p.x,
                    groundY(p.x, p.z) - BILLBOARD_Y_SINK,
                    p.z,
                    sc,
                    rng() * Math.PI * 2,
                    dummy,
                );
                if (withShadows) {
                    shadows.push({ x: p.x, z: p.z, radius: billboardShadowRadius(kind, sc) });
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            total += mesh.count;
        }
        if (withShadows) this.treeShadows.setSources(shadows);
        else this.treeShadows.setSources([]);
        console.info(`[scenery] far billboards: ${total}${withShadows ? ' +shadows' : ''}`);
    }

    /** On-board Tripo GLBs (high) — matches billboard art direction. */
    private async placeTripoVegetation(
        plants: { kind: VegetationKind; x: number; z: number; sc: number }[],
        groundY: (x: number, z: number) => number,
        rng: () => number,
    ): Promise<void> {
        await loadSceneryVegetation();
        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        let total = 0;
        for (const kind of kinds) {
            const list = plants.filter((p) => p.kind === kind);
            if (list.length === 0) continue;
            const mesh = createVegetationInstances(kind, list.length);
            if (!mesh) {
                console.warn(`[scenery] Tripo '${kind}' missing`);
                continue;
            }
            for (const p of list) {
                placeVegetationInstance(
                    mesh,
                    p.x,
                    groundY(p.x, p.z),
                    p.z,
                    p.sc,
                    rng() * Math.PI * 2,
                    dummy,
                );
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.group.add(mesh);
            total += mesh.count;
        }
        console.info(`[scenery] field Tripo: ${total}`);
    }

    /**
     * Ultra: near Tripo mid-poly + far billboards with blob shadows
     * (same headcount as the dense procedural belt).
     */
    private async addHqVegetation(
        map: BattleMap,
        rng: () => number,
        helpers: {
            forestSpot: (maxHeight: number) => { x: number; z: number };
            fieldSpot: (clearance: number) => { x: number; z: number };
            groundY: (x: number, z: number) => number;
            distOut: (x: number, z: number) => number;
        },
    ): Promise<void> {
        await Promise.all([loadSceneryVegetation(), loadSceneryBillboards()]);
        const dens = this.density;
        const { forestSpot, fieldSpot, groundY, distOut } = helpers;

        const OAK = scaleCount(120, dens.outer);
        const PINE = scaleCount(200, dens.outer);
        const BUSH_R = scaleCount(50, dens.outer);
        const BUSH_T = scaleCount(40, dens.outer);
        const FIELD_OAK = scaleCount(3, dens.field);
        const FIELD_PINE = scaleCount(3, dens.field);
        const FIELD_BUSH = scaleCount(22, dens.field);

        type Plant = { kind: VegetationKind; x: number; z: number; sc: number; near: boolean };
        const plants: Plant[] = [];

        for (let i = 0; i < OAK + FIELD_OAK; i++) {
            const onField = i >= OAK;
            const { x, z } = onField ? fieldSpot(10) : forestSpot(72);
            const sc = onField ? 0.7 + rng() * 0.35 : 0.85 + rng() * 0.55;
            plants.push({
                kind: 'oak',
                x,
                z,
                sc,
                near: onField || distOut(x, z) < NEAR_TREE_DIST,
            });
        }
        for (let i = 0; i < PINE + FIELD_PINE; i++) {
            const onField = i >= PINE;
            const { x, z } = onField ? fieldSpot(10) : forestSpot(84);
            const sc = onField ? 0.65 + rng() * 0.3 : 0.8 + rng() * 0.5;
            plants.push({
                kind: 'pine',
                x,
                z,
                sc,
                near: onField || distOut(x, z) < NEAR_TREE_DIST,
            });
        }
        const bushRTotal = BUSH_R + Math.ceil(FIELD_BUSH / 2);
        for (let i = 0; i < bushRTotal; i++) {
            const onField = i >= BUSH_R;
            const { x, z } = onField ? fieldSpot(5) : forestSpot(56);
            plants.push({
                kind: 'bushRound',
                x,
                z,
                sc: 0.75 + rng() * 0.55,
                near: onField || distOut(x, z) < NEAR_TREE_DIST,
            });
        }
        const bushTTotal = BUSH_T + Math.floor(FIELD_BUSH / 2);
        for (let i = 0; i < bushTTotal; i++) {
            const onField = i >= BUSH_T;
            const { x, z } = onField ? fieldSpot(5) : forestSpot(56);
            plants.push({
                kind: 'bushTall',
                x,
                z,
                sc: 0.7 + rng() * 0.5,
                near: onField || distOut(x, z) < NEAR_TREE_DIST,
            });
        }

        const dummy = new Object3D();
        const kinds: VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];
        let nearN = 0;
        let farN = 0;
        const shadows: BlobShadowSource[] = [];

        for (const kind of kinds) {
            const nearList = plants.filter((p) => p.kind === kind && p.near);
            const farList = plants.filter((p) => p.kind === kind && !p.near);

            if (nearList.length > 0) {
                const mesh = createVegetationInstances(kind, nearList.length);
                if (!mesh) {
                    console.warn(`[scenery] HQ '${kind}' missing`);
                } else {
                    for (const p of nearList) {
                        placeVegetationInstance(
                            mesh,
                            p.x,
                            groundY(p.x, p.z),
                            p.z,
                            p.sc,
                            rng() * Math.PI * 2,
                            dummy,
                        );
                    }
                    mesh.instanceMatrix.needsUpdate = true;
                    this.group.add(mesh);
                    nearN += mesh.count;
                }
            }

            if (farList.length > 0) {
                const mesh = createBillboardInstances(kind, farList.length);
                if (!mesh) {
                    console.warn(`[scenery] billboard '${kind}' missing`);
                } else {
                    for (const p of farList) {
                        const sc = p.sc * BILLBOARD_SCALE;
                        placeVegetationInstance(
                            mesh,
                            p.x,
                            groundY(p.x, p.z) - BILLBOARD_Y_SINK,
                            p.z,
                            sc,
                            rng() * Math.PI * 2,
                            dummy,
                        );
                        shadows.push({ x: p.x, z: p.z, radius: billboardShadowRadius(kind, sc) });
                    }
                    mesh.instanceMatrix.needsUpdate = true;
                    this.group.add(mesh);
                    farN += mesh.count;
                }
            }
        }

        this.treeShadows.setSources(shadows);
        console.info(
            `[scenery] HQ vegetation: near3D=${nearN} farBillboards=${farN} (cut=${NEAR_TREE_DIST})`,
        );
    }

    /**
     * Swaps the flat forest colors for generated bark/foliage textures once
     * they load; instance colors keep providing the per-tree hue variation.
     */
    private async applyForestTextures(
        trunkMat: MeshStandardMaterial,
        coneMat: MeshStandardMaterial,
        leafMats: MeshStandardMaterial[],
    ): Promise<void> {
        const [bark, foliage] = await Promise.all([
            loadWorldTexture(barkUrl),
            loadWorldTexture(foliageUrl),
        ]);
        console.info(`[scenery] forest textures: bark=${!!bark} foliage=${!!foliage}`);
        if (bark) {
            bark.colorSpace = SRGBColorSpace;
            bark.wrapS = bark.wrapT = RepeatWrapping;
            bark.repeat.set(1.5, 1);
            trunkMat.map = bark;
            trunkMat.color.set(0xffffff); // the texture carries the brown now
            trunkMat.needsUpdate = true;
        }
        if (foliage) {
            foliage.colorSpace = SRGBColorSpace;
            foliage.wrapS = foliage.wrapT = RepeatWrapping;
            const coneFoliage = foliage.clone();
            coneFoliage.repeat.set(1.5, 1);
            coneMat.map = coneFoliage;
            coneMat.needsUpdate = true;
            for (const m of leafMats) {
                m.map = foliage;
                m.needsUpdate = true;
            }
        }
    }

    /** Shared cloud puff texture — always built so Weather can wire near-cloud FX. */
    private createCloudAssets(rng: () => number): void {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        for (let b = 0; b < 9; b++) {
            const x = 50 + rng() * 156;
            const y = 45 + rng() * 38;
            const r = 22 + rng() * 26;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        this.cloudTexture = texture;
        this.cloudMaterial = new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: THEME.scenery.cloudOpacity,
            depthWrite: false,
        });
    }

    /** flat puffs on the horizon + summit wisps — tinted by the weather system */
    private createHorizonCloudMeshes(map: BattleMap, rng: () => number): void {
        const material = this.cloudMaterial;
        const geometry = new PlaneGeometry(1, 0.5);
        geometry.rotateX(-Math.PI / 2);

        for (let i = 0; i < 12; i++) {
            const mesh = new Mesh(geometry, material);
            const farSide = rng() < 0.7;
            const lane = map.halfH + 100 + rng() * 320;
            mesh.position.set(
                (rng() * 2 - 1) * this.cloudBoundsX,
                110 + rng() * 60,
                farSide ? -lane : lane,
            );
            const scale = 90 + rng() * 130;
            mesh.scale.set(scale, 1, scale * (0.4 + rng() * 0.3));
            this.clouds.push({ mesh, speed: 2 + rng() * 3 });
            this.group.add(mesh);
        }

        if (!this.detailed) return;
        const peakCap = this.density.peakClouds;
        let placed = 0;
        for (let attempt = 0; attempt < 6000 && placed < peakCap; attempt++) {
            const span = this.worldSize * 0.5;
            const x = (rng() * 2 - 1) * span;
            const z = (rng() * 2 - 1) * span;
            const h = this.terrainHeight(x, z);
            if (h < 165) continue;
            if (this.peakClouds.some((p) => Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z) < 90)) {
                continue;
            }
            const mesh = new Mesh(geometry, material);
            mesh.position.set(x, h - 4 + rng() * 16, z);
            const scale = 55 + rng() * 70;
            mesh.scale.set(scale, 1, scale * (0.35 + rng() * 0.3));
            this.peakClouds.push({
                mesh,
                baseX: x,
                phase: rng() * Math.PI * 2,
                speed: 0.05 + rng() * 0.06,
            });
            this.group.add(mesh);
            placed++;
        }
    }
}

/**
 * Moss/lichen on rock — re-tints the meadow grass map yellow/brown (no extra texture).
 * Kept darker/subtle so it reads as damp growth on stone, not bright straw.
 */
const MOSS_DETAIL_FN_GLSL = `
vec3 mossDetail( vec2 uv ) {
    vec3 g = texture2D( map, uv ).rgb;
    float lum = max( dot( g, vec3( 0.299, 0.587, 0.114 ) ), 0.08 );
    vec3 straw = ( g / lum ) * vec3( 0.78, 0.48, 0.06 );
    vec3 darkOrange = vec3( 0.48, 0.28, 0.04 );
    vec3 moss = mix( g * vec3( 0.82, 0.5, 0.06 ), mix( straw, darkOrange, 0.72 ), 0.94 );
    return moss * 0.78;
}
`;

/**
 * Shared outer snow. Meadow (low) matches the board (`map.ts`: snowMask * 0.82
 * toward 0.92/0.95/0.98). Mountains keep extra winter density + rock ribs.
 */
const OUTER_MOUNTAIN_SNOW_GLSL = `
    float mountainZone = smoothstep(16.0, 55.0, vTerrainH);
    float dryPatch = 0.52 + 0.48 * fract(sin(dot(vWorldXZ * 0.068, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 dryCol = mix(diffuseColor.rgb * vec3(1.18, 1.05, 0.55), vec3(0.72, 0.64, 0.28), 0.16);
    diffuseColor.rgb = mix(diffuseColor.rgb, dryCol, uDryGrass * (1.0 - mountainZone) * (1.0 - vBeach) * dryPatch);
    float slopeHold = 1.0 - smoothstep(0.28, 0.82, vSlope) * 0.62;
    float peakBoost = smoothstep(120.0, 240.0, vTerrainH);
    float snowHold = min(1.0, slopeHold + peakBoost * 0.85);
    float deepWinter = smoothstep(0.82, 1.0, uSnowCover);
    float alpineSnow = smoothstep(148.0, 215.0, vTerrainH) * snowHold * uAlpineCap;
    float snowLine = mix(220.0, -15.0, uSnowCover);
    float weatherSnow = smoothstep(snowLine - 40.0, snowLine + 15.0, vTerrainH);
    float meadowSnow = weatherSnow * 0.82;
    float winterAmp = mix(1.05, 1.68, smoothstep(0.72, 1.0, uSnowCover));
    float mountainLift = smoothstep(40.0, 170.0, vTerrainH) * deepWinter * 0.48;
    float mountainSnow = min(1.0, max(alpineSnow, weatherSnow * snowHold * 0.92) * winterAmp + mountainLift);
    float macroN = fract(sin(dot(floor(vWorldXZ * 0.04), vec2(127.1, 311.7))) * 43758.5453);
    float mesoN = fract(sin(dot(vWorldXZ * 0.13, vec2(269.5, 183.3))) * 43758.5453);
    float breakup = macroN * 0.62 + mesoN * 0.38;
    float cliffStrip = smoothstep(0.42, 0.86, vSlope) * smoothstep(40.0, 170.0, vTerrainH);
    mountainSnow = clamp(mountainSnow - cliffStrip * (0.2 + breakup * 0.4), 0.0, 1.0);
    float snowF = mix(meadowSnow, mountainSnow, mountainZone);
    vec3 meadowCol = vec3(0.92, 0.95, 0.98);
    vec3 snowHi = mix(meadowCol, vec3(1.0, 1.0, 1.0), deepWinter);
    vec3 snowLo = mix(meadowCol, vec3(0.86, 0.9, 0.96), deepWinter);
    float sunLit = clamp(dot(normalize(vWorldN), normalize(vec3(0.4, 0.82, 0.25))) * 0.5 + 0.5, 0.0, 1.0);
    vec3 snowCol = mix(meadowCol, mix(snowLo, snowHi, sunLit), mountainZone);`;

/** Directional contrast on mountain relief only — leave the meadow/board edge alone. */
const OUTER_MOUNTAIN_LIGHTING_GLSL = `
    float contrast = mix(0.18, 0.62, deepWinter);
    diffuseColor.rgb *= mix(1.0, mix(0.62, 1.22, sunLit), mountainZone * contrast);`;

/** a handful of tapered grass blades, white — tinted green per instance */
function makeTuftTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(777);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    for (let b = 0; b < 7; b++) {
        const baseX = 8 + rng() * 48;
        const tipX = baseX + (rng() - 0.5) * 18;
        const topY = 4 + rng() * 20;
        const w = 2 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(baseX - w, 64);
        ctx.lineTo(tipX, topY);
        ctx.lineTo(baseX + w, 64);
        ctx.closePath();
        ctx.fill();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** a little cluster of petal flowers on transparent ground — tinted per instance */
function makeFlowerTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(424242);
    const flower = (cx: number, cy: number, r: number) => {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + rng();
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,220,90,1)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
    };
    flower(22, 24, 5.5);
    flower(43, 40, 4.5);
    flower(36, 14, 3.5);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/**
 * High/ultra only: sample the board hazard mask at each flower's world XZ and
 * brown/olive-tint petals over oil/acid so they read as soaked, not floating
 * clean above the slick. Outside the board UV clamps to black (no tint).
 */
function attachFlowerHazardTint(material: MeshStandardMaterial, map: BattleMap): void {
    const hazardMask = map.getHazardMask();
    const boardHalf = new Vector2(map.halfW, map.halfH);
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
        prevCompile?.call(material, shader, renderer);
        shader.uniforms.uFlowerHazardMask = { value: hazardMask };
        shader.uniforms.uFlowerBoardHalf = { value: boardHalf };
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
uniform vec2 uFlowerBoardHalf;
varying vec2 vFlowerHazUv;`,
        );
        // instance origin → board UV (matches ground macro / CanvasTexture flipY)
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
{
  vec3 flowerBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFlowerHazUv = vec2(
    (flowerBase.x + uFlowerBoardHalf.x) / max(2.0 * uFlowerBoardHalf.x, 1e-3),
    (uFlowerBoardHalf.y - flowerBase.z) / max(2.0 * uFlowerBoardHalf.y, 1e-3)
  );
}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform sampler2D uFlowerHazardMask;
varying vec2 vFlowerHazUv;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  vec3 haz = texture2D(uFlowerHazardMask, vFlowerHazUv).rgb;
  float oilM = smoothstep(0.04, 0.28, haz.r);
  float fireG = smoothstep(0.14, 0.5, haz.g);
  float fireB = smoothstep(0.12, 0.48, haz.b);
  float acidM = fireB * (1.0 - fireG * 0.85);
  // Warm mud-brown oil / olive acid
  vec3 oilTint = vec3(0.22, 0.12, 0.05);
  vec3 acidTint = vec3(0.16, 0.22, 0.05);
  diffuseColor.rgb = mix(diffuseColor.rgb, oilTint, oilM * 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, acidTint, acidM * 0.88);
  diffuseColor.a *= 1.0 - oilM * 0.5 - acidM * 0.45;
}`,
        );
    };
    material.customProgramCacheKey = () => `${prevKey()}|flower-hazard-tint-v5`;
    material.needsUpdate = true;
}
