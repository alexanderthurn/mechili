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
    TextureLoader,
    Color,
    Vector2,
    Vector3,
    type DirectionalLight,
    type HemisphereLight,
    type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Weather } from './weather';
import { THEME } from '../theme';
import { prefs } from './prefs';

const barkUrl = new URL('../../assets/textures/bark.webp', import.meta.url).href;
const foliageUrl = new URL('../../assets/textures/foliage.webp', import.meta.url).href;
const rockUrl = new URL('../../assets/textures/rock.webp', import.meta.url).href;
import {
    DETAIL_TILE,
    grassAlbedoUrl,
    grassNormalUrl,
    sandAlbedoUrl,
    makeValueNoise,
    mulberry32,
    type BattleMap,
} from './map';

function smooth01(t: number): number {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

/**
 * Everything around and above the battlefield, generated in code: sky dome,
 * sun glow, the outer world (ground, trees, rocks), drifting clouds and
 * their shadows sweeping across the field.
 */
export class Scenery {
    readonly group = new Group();

    /** dome + sun glow follow the camera so the horizon never hits the far plane */
    private readonly skyGroup = new Group();
    private readonly clouds: { mesh: Mesh; speed: number }[] = [];
    /** wisps clinging to the snowy summits — they sway in place, never leave */
    private readonly peakClouds: { mesh: Mesh; baseX: number; phase: number; speed: number }[] = [];
    private time = 0;
    private readonly cloudShadow: Mesh;
    private readonly cloudBoundsX: number;
    private readonly map: BattleMap;
    private weather: Weather | null = null;

    private waterTexture: CanvasTexture | null = null;

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

    /** false with the 'minimal' scenery pref: flat green world, no decoration */
    private readonly detailed = prefs().scenery !== 'minimal';

    constructor(map: BattleMap, seed = 20260709) {
        const rng = mulberry32(seed);
        this.map = map;
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
            let d = Math.hypot(ox, oz);
            d += (noise(x / 95 + 2.4, z / 95 + 6.1) - 0.5) * 28;
            d += (noise(x / 40 + 9.0, z / 40 + 1.7) - 0.5) * 12;
            d = Math.max(0, d);

            // ~6 tiles stay nearly flat; then hills ease in (some spots earlier
            // via the noise on d, but never the old "wall at 5 tiles")
            const nearFlat = 24; // CELL=4 → 6 tiles
            const ramp = 90;
            const edgeIn = Math.pow(smooth01((d - nearFlat) / ramp), 1.45);

            const hN =
                noise(x / 110 + 1.2, z / 110 + 4.8) * 0.5 +
                noise(x / 48 + 22.1, z / 48 + 9.3) * 0.32 +
                noise(x / 22 + 8.8, z / 22 + 55.5) * 0.18;
            const knoll = Math.pow(Math.max(0, hN - 0.45) / 0.55, 1.3);
            // real rolling hills — mountains still carry the big drama farther out
            const rolling = (1.2 + 18 * hN + 14 * knoll) * edgeIn;

            const rise = smooth01((d - 110) / 360) * (1 - smooth01((d - 640) / 260));
            const n =
                noise(x / 170 + 3.7, z / 170 + 8.1) * 0.55 +
                noise(x / 62 + 51.2, z / 62 + 17.9) * 0.3 +
                noise(x / 24 + 9.4, z / 24 + 63.7) * 0.15;
            const ridge = Math.pow(Math.max(0, n - 0.32) / 0.68, 1.35);
            const mountain = rise * (28 + 280 * ridge);

            // lakes win over everything: where the basin noise runs high the
            // ground is pressed to -7, well below the water table at -1.1
            const lake = this.lakeAt(x, z);
            const depth = -7 * smooth01((d - 25) / 45);
            return (rolling + mountain) * (1 - lake) + depth * lake;
        };

        // minimal scenery: flat terrain heights (the closures above return
        // real values, but heightAt/lakeAt get bypassed below) + no decoration
        if (!this.detailed) {
            this.terrainHeight = () => 0;
            this.lakeAt = () => 0;
        }

        this.skyGroup.add(this.createSkyDome(), this.createSunGlow());
        this.group.add(this.skyGroup);
        this.group.add(this.createOuterGround(map));
        if (this.detailed) {
            this.group.add(this.createWater());
            this.createLakeDetails(rng);
            this.createForest(map, rng);
            this.createMeadowDetails(map, rng);
        }
        this.cloudShadow = this.createCloudShadow(map);
        this.group.add(this.cloudShadow);
        this.createClouds(map, rng);
    }

    /** builds the scenario system driving sky, fog, lights, clouds, rain, stars */
    createWeather(scene: Scene, sun: DirectionalLight, hemi: HemisphereLight, seed: number): Weather {
        this.weather = new Weather(
            {
                scene,
                sun,
                hemi,
                repaintSky: this.repaintSky,
                glow: this.sunGlow,
                cloudMaterial: this.cloudMaterial,
                cloudShadowMaterial: this.cloudShadow.material as MeshBasicMaterial,
                cloudTexture: this.cloudTexture,
                skyGroup: this.skyGroup,
                worldGroup: this.group,
                map: this.map,
            },
            seed,
        );
        return this.weather;
    }

    update(dtSeconds: number, cameraPos: Vector3): void {
        this.skyGroup.position.set(cameraPos.x, 0, cameraPos.z);
        this.weather?.update(dtSeconds, cameraPos);
        const mat = this.cloudShadow.material as MeshBasicMaterial;
        mat.map!.offset.x += dtSeconds * 0.0035;
        mat.map!.offset.y += dtSeconds * 0.0012;
        for (const c of this.clouds) {
            c.mesh.position.x += c.speed * dtSeconds;
            if (c.mesh.position.x > this.cloudBoundsX) c.mesh.position.x = -this.cloudBoundsX;
        }
        this.time += dtSeconds;
        for (const p of this.peakClouds) {
            p.mesh.position.x = p.baseX + Math.sin(this.time * p.speed + p.phase) * 12;
        }
        // slow ripple drift on the lakes
        if (this.waterTexture) {
            this.waterTexture.offset.x += dtSeconds * 0.006;
            this.waterTexture.offset.y += dtSeconds * 0.0035;
        }
        if (this.tuftMaterial?.userData.shader) {
            this.tuftMaterial.userData.shader.uniforms.uTime!.value = this.time;
        }
    }

    /**
     * The water table: one flat translucent plane at y = -1.1. It is hidden
     * under the terrain everywhere, EXCEPT where a lake basin dips below it.
     * A painted ripple texture drifts slowly to make it read as water.
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
        this.waterTexture.repeat.set(100, 100); // one ripple tile per 30 world units

        const geometry = new PlaneGeometry(3000, 3000);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new Mesh(
            geometry,
            new MeshStandardMaterial({
                map: this.waterTexture,
                transparent: true,
                opacity: 0.86,
                roughness: 0.18,
                metalness: 0,
            }),
        );
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
        const TUFTS = 4200;
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
        };
        this.tuftMaterial.customProgramCacheKey = () => 'meadow-tuft-wind';
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

        // --- small stones
        const STONES = 240;
        const stones = new InstancedMesh(
            new IcosahedronGeometry(0.3, 0),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
            STONES,
        );
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

        // --- fallen logs
        const LOGS = 26;
        const logs = new InstancedMesh(
            new CylinderGeometry(0.28, 0.36, 3.2, 6),
            new MeshStandardMaterial({ color: THEME.scenery.trunk, roughness: 0.9 }),
            LOGS,
        );
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

        // --- mushrooms (stem + cap merged), often in small groups
        const MUSHROOMS = 90;
        const stem = new CylinderGeometry(0.09, 0.13, 0.5, 5).translate(0, 0.25, 0);
        const cap = new ConeGeometry(0.32, 0.34, 6).translate(0, 0.62, 0);
        const mushrooms = new InstancedMesh(
            mergeGeometries([stem, cap])!,
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
            MUSHROOMS,
        );
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

        this.group.add(tufts, stones, logs, mushrooms);
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
                const x = (rng() * 2 - 1) * 1300;
                const z = (rng() * 2 - 1) * 1300;
                if (this.lakeAt(x, z) < minLake) continue;
                const h = this.terrainHeight(x, z);
                if (h < hMin || h > hMax) continue;
                return { x, z, h };
            }
            return null;
        };

        const REEDS = 160;
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

        const PADS = 70;
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
        const SIZE = 3000;
        const SEGS = this.detailed ? 300 : 1;
        const geometry = new PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        /** 0..1 per vertex: how sandy this spot is (lake shores + rare patches) */
        const beach = new Float32Array(pos.count);
        const meadow = new Color(0xffffff); // grass texture shows as-is
        // near-white: the tiled rock texture carries the stone color, the
        // vertex tint only adds large-scale light/dark variation
        const rock = new Color(0xf2efe9);
        const rockDark = new Color(0xf2efe9).multiplyScalar(0.75);
        const snow = new Color(s.snow);
        const c = new Color();
        const rockVar = new Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const h = this.terrainHeight(x, z);
            pos.setY(i, h);

            // sand around (and under) the lakes, fading up the banks…
            const shore = smooth01(this.lakeAt(x, z) / 0.5) * (1 - smooth01((h - 0.2) / 2.0));
            // …plus rare small dry patches scattered over the meadow
            const patchN = this.noise(x / 37 + 5.1, z / 37 + 50.4);
            const patch = smooth01((patchN - 0.72) / 0.09) * 0.7 * (h < 10 ? 1 : 0);
            // never right next to the board — it would break the transition
            const dOut = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            beach[i] = Math.min(1, Math.max(shore, patch)) * smooth01((dOut - 15) / 25);

            rockVar.copy(rock).lerp(rockDark, this.noise(x / 55 + 3, z / 55 + 9));
            c.copy(meadow)
                .lerp(rockVar, smooth01((h - 12) / 45))
                .lerp(snow, smooth01((h - 180) / 55));

            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        pos.needsUpdate = true;
        geometry.setAttribute('color', new BufferAttribute(colors, 3));
        geometry.setAttribute('aBeach', new BufferAttribute(beach, 1));
        geometry.computeVertexNormals();

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
        return mesh;
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
        const loader = new TextureLoader();
        const [albedo, normal, rock, sand] = await Promise.all([
            loader.loadAsync(grassAlbedoUrl).catch(() => null),
            loader.loadAsync(grassNormalUrl).catch(() => null),
            loader.loadAsync(rockUrl).catch(() => null),
            loader.loadAsync(sandAlbedoUrl).catch(() => null),
        ]);
        if (!albedo) return;
        const frac = (v: number) => ((v % 1) + 1) % 1;
        const configure = (tex: NonNullable<typeof albedo>) => {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(size / DETAIL_TILE, size / DETAIL_TILE);
            tex.offset.set(frac(map.halfW / DETAIL_TILE), frac(map.halfH / DETAIL_TILE));
            tex.anisotropy = 8;
        };
        configure(albedo);
        albedo.colorSpace = SRGBColorSpace;
        material.map = albedo;
        if (normal) {
            configure(normal);
            material.normalMap = normal;
            material.normalScale = new Vector2(0.35, 0.35);
        }
        if (rock) {
            // sampled with explicit world-space UVs in the shader
            rock.wrapS = rock.wrapT = RepeatWrapping;
            rock.colorSpace = SRGBColorSpace;
            rock.anisotropy = 8;
        }
        if (sand) {
            sand.wrapS = sand.wrapT = RepeatWrapping;
            sand.colorSpace = SRGBColorSpace;
            sand.anisotropy = 8;
        }
        material.color.set(0xffffff);
        material.onBeforeCompile = (shader) => {
            if (rock) shader.uniforms.uRock = { value: rock };
            if (sand) shader.uniforms.uSand = { value: sand };
            shader.vertexShader =
                'attribute float aBeach;\nvarying float vBeach;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;\n\tvWorldXZ = position.xz;\n\tvSlope = 1.0 - normal.y;\n\tvBeach = aBeach;',
                );
            const inject = rock
                ? `
    // match the board's average brightness
    diffuseColor.rgb *= ${BOARD_TONE.toFixed(2)};
    ${
        sand
            ? `// sand where the geometry says so: lake shores + rare dry patches
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uSand, vWorldXZ / 20.0).rgb, vBeach);`
            : ''
    }
    // rock takes over with altitude and on steep faces; snow caps the peaks
    float snowF = smoothstep(170.0, 235.0, vTerrainH);
    float rockF = max(smoothstep(16.0, 55.0, vTerrainH), smoothstep(0.32, 0.58, vSlope) * smoothstep(3.0, 9.0, vTerrainH)) * (1.0 - snowF);
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uRock, vWorldXZ / 34.0).rgb, rockF);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), snowF);`
                : `\n\tdiffuseColor.rgb *= ${BOARD_TONE.toFixed(2)};`;
            shader.fragmentShader =
                'varying float vBeach;\nvarying float vTerrainH;\nvarying vec2 vWorldXZ;\nvarying float vSlope;\n' +
                (rock ? 'uniform sampler2D uRock;\n' : '') +
                (sand ? 'uniform sampler2D uSand;\n' : '') +
                shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>${inject}`);
        };
        material.customProgramCacheKey = () => `outer-meadow-simple-v2${rock ? '-rock' : ''}${sand ? '-sand' : ''}`;
        material.needsUpdate = true;
    }

    /**
     * Low-poly trees, bushes and rocks — a forest belt from the field edge
     * up into the mountain foothills, plus a few trees/bushes ON the battlefield
     * (pure scenery: no collision). Instanced per part — five draw calls.
     */
    private createForest(map: BattleMap, rng: () => number): void {
        const s = THEME.scenery;
        // reach lower mountain slopes (rise starts ~d=55, foothills to ~350)
        const margin = 420;
        const keepOut = 8;

        const distOut = (x: number, z: number) =>
            Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);

        /** random point outside the field; biased toward foothill forest density */
        const forestSpot = (maxHeight: number): { x: number; z: number } => {
            for (let attempt = 0; attempt < 16; attempt++) {
                const x = (rng() * 2 - 1) * (map.halfW + margin);
                const z = (rng() * 2 - 1) * (map.halfH + margin);
                const d = distOut(x, z);
                if (d < keepOut) continue;
                const h = this.terrainHeight(x, z);
                if (h > maxHeight) continue;
                if (h < -0.4) continue; // no trees in the lakes
                // thin near the field, dense toward foothills, taper before high rock
                const belt = smooth01((d - 25) / 70) * (1 - smooth01((d - 300) / 120));
                if (rng() > 0.18 + belt * 0.82) continue;
                return { x, z };
            }
            // fallback: any valid outer point
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW + margin);
                const z = (rng() * 2 - 1) * (map.halfH + margin);
                if (distOut(x, z) >= keepOut) return { x, z };
            }
        };
        // on the battlefield, but never in a base's courtyard
        const anchors = map.baseAnchors();
        const fieldSpot = (clearance: number): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW - 10);
                const z = (rng() * 2 - 1) * (map.halfH - 10);
                if (anchors.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + clearance)) {
                    return { x, z };
                }
            }
        };
        // field relief inside, mountain terrain outside (each is 0 elsewhere)
        const groundY = (x: number, z: number) => this.terrainHeight(x, z) + map.heightAt(x, z);

        const dummy = new Object3D();
        const color = new Color();
        // the foliage texture carries the base green; instance tints stay
        // bright so the multiply keeps the leaf pattern readable
        const white = new Color(0xffffff);
        const lighten = (c: Color) => c.lerp(white, 0.45);
        // ~320 outer trees — forest belt, still 5 instanced draw calls
        const PINES = 200;
        const LEAFY = 120;
        const FIELD_PINES = 5;
        const FIELD_LEAFY = 6;
        const ROCKS = 170;
        const BUSHES = 90;
        const FIELD_BUSHES = 45;

        const trunks = new InstancedMesh(
            new CylinderGeometry(0.35, 0.55, 3.4, 6),
            new MeshStandardMaterial({ color: s.trunk, roughness: 0.9 }),
            PINES + LEAFY + FIELD_PINES + FIELD_LEAFY,
        );
        const cones = new InstancedMesh(
            new ConeGeometry(2.6, 6, 7),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
            (PINES + FIELD_PINES) * 2,
        );
        const blobs = new InstancedMesh(
            new IcosahedronGeometry(2.4, 1),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
            (LEAFY + FIELD_LEAFY) * 2,
        );
        const rocks = new InstancedMesh(
            new IcosahedronGeometry(1.4, 0),
            new MeshStandardMaterial({ color: s.rock, roughness: 0.95, flatShading: true }),
            ROCKS,
        );
        const bushes = new InstancedMesh(
            new IcosahedronGeometry(1, 1),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
            BUSHES + FIELD_BUSHES,
        );

        let trunkI = 0;
        let coneI = 0;
        let blobI = 0;

        const placeTrunk = (x: number, z: number, sc: number, h: number) => {
            dummy.position.set(x, h + 1.7 * sc, z);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            trunks.setMatrixAt(trunkI++, dummy.matrix);
        };

        for (let i = 0; i < PINES + FIELD_PINES; i++) {
            const { x, z } = i < PINES ? forestSpot(84) : fieldSpot(10);
            const h = groundY(x, z);
            const sc = i < PINES ? 0.8 + rng() * 1.1 : 0.7 + rng() * 0.5;
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

        for (let i = 0; i < LEAFY + FIELD_LEAFY; i++) {
            const { x, z } = i < LEAFY ? forestSpot(72) : fieldSpot(10);
            const h = groundY(x, z);
            const sc = i < LEAFY ? 0.9 + rng() * 1.2 : 0.75 + rng() * 0.55;
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

        // prefer foothill / lower-slope rocks for silhouette variation
        const rockSpot = (): { x: number; z: number } => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const p = forestSpot(150);
                const h = this.terrainHeight(p.x, p.z);
                if (h > 4 && h < 140) return p;
            }
            return forestSpot(150);
        };
        for (let i = 0; i < ROCKS; i++) {
            const { x, z } = rockSpot();
            const sc = 0.5 + rng() * 1.5;
            dummy.position.set(x, groundY(x, z) + 0.4 * sc, z);
            dummy.scale.set(sc, sc * 0.55, sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            rocks.setMatrixAt(i, dummy.matrix);
        }

        for (let i = 0; i < BUSHES + FIELD_BUSHES; i++) {
            const { x, z } = i < BUSHES ? forestSpot(56) : fieldSpot(5);
            const sc = 0.6 + rng() * 0.8;
            dummy.position.set(x, groundY(x, z) + 0.45 * sc, z);
            dummy.scale.set(sc * (0.9 + rng() * 0.4), sc * 0.7, sc * (0.9 + rng() * 0.4));
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            bushes.setMatrixAt(i, dummy.matrix);
            lighten(color.set(s.leaf).lerp(new Color(s.leafLight), rng() * 0.8));
            bushes.setColorAt(i, color);
        }

        for (const m of [trunks, cones, blobs, rocks, bushes]) {
            m.castShadow = true;
            this.group.add(m);
        }

        // wildflowers on the outer meadow band — matches the field's painted
        // flowers so the grass doesn't read as an empty green carpet
        const FLOWERS = 280;
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
        const flowerTones = THEME.terrain.flowers;
        const meadowSpot = (): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW + 260);
                const z = (rng() * 2 - 1) * (map.halfH + 260);
                if (distOut(x, z) < keepOut) continue;
                const h = this.terrainHeight(x, z);
                if (h > -0.4 && h < 5) return { x, z }; // meadow only, not in lakes
            }
        };
        // flowers grow in clumps (a cluster center + a handful around it),
        // and each clump leans toward one color — like real wildflowers
        let flowerI = 0;
        while (flowerI < FLOWERS) {
            const center = meadowSpot();
            const clumpTone = flowerTones[Math.floor(rng() * flowerTones.length)]!;
            const clump = 4 + Math.floor(rng() * 6);
            for (let f = 0; f < clump && flowerI < FLOWERS; f++) {
                const x = center.x + (rng() - 0.5) * 9;
                const z = center.z + (rng() - 0.5) * 9;
                const sc = 0.7 + rng() * 0.9;
                dummy.position.set(x, groundY(x, z) + 0.08, z);
                dummy.scale.setScalar(sc);
                dummy.rotation.set(0, rng() * Math.PI * 2, 0);
                dummy.updateMatrix();
                flowers.setMatrixAt(flowerI, dummy.matrix);
                color.set(rng() < 0.75 ? clumpTone : flowerTones[Math.floor(rng() * flowerTones.length)]!);
                flowers.setColorAt(flowerI++, color);
            }
        }
        this.group.add(flowers);

        void this.applyForestTextures(
            trunks.material as MeshStandardMaterial,
            cones.material as MeshStandardMaterial,
            [blobs.material as MeshStandardMaterial, bushes.material as MeshStandardMaterial],
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
        const loader = new TextureLoader();
        const [bark, foliage] = await Promise.all([
            loader.loadAsync(barkUrl).catch(() => null),
            loader.loadAsync(foliageUrl).catch(() => null),
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

    /** soft dark blobs on a repeating texture, slowly panning over the field */
    private createCloudShadow(map: BattleMap): Mesh {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d')!;
        const rng = mulberry32(7);
        for (let i = 0; i < 10; i++) {
            const cx = rng() * 512;
            const cy = rng() * 512;
            // each cloud shadow is a cluster of overlapping soft blobs
            for (let b = 0; b < 6; b++) {
                const x = cx + (rng() - 0.5) * 130;
                const y = cy + (rng() - 0.5) * 70;
                const r = 28 + rng() * 45;
                const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        const texture = new CanvasTexture(canvas);
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;

        const geometry = new PlaneGeometry(map.width * 2.5, map.height * 2.5);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: THEME.scenery.cloudShadowOpacity,
                depthWrite: false,
            }),
        );
        mesh.position.y = THEME.terrain.reliefDepth + 0.1; // clears the ground-relief mounds
        return mesh;
    }

    /** flat white puffs drifting near the horizon — never over the field itself */
    private createClouds(map: BattleMap, rng: () => number): void {
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
        const material = new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: THEME.scenery.cloudOpacity,
            depthWrite: false,
        });
        this.cloudMaterial = material;
        const geometry = new PlaneGeometry(1, 0.5);
        geometry.rotateX(-Math.PI / 2);

        for (let i = 0; i < 12; i++) {
            const mesh = new Mesh(geometry, material);
            // lanes beyond the field edges so clouds never hide units from above
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

        // summit wisps: parked just below the white peaks, swaying in place.
        // They share the horizon clouds' material, so every weather scenario
        // tints and fades them automatically.
        if (!this.detailed) return; // flat world has no summits
        let placed = 0;
        for (let attempt = 0; attempt < 6000 && placed < 12; attempt++) {
            const x = (rng() * 2 - 1) * 1300;
            const z = (rng() * 2 - 1) * 1300;
            const h = this.terrainHeight(x, z);
            if (h < 165) continue;
            // keep them spread out — one wisp per summit area
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
