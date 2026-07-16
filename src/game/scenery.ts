import {
    AdditiveBlending,
    BackSide,
    BufferAttribute,
    CanvasTexture,
    ConeGeometry,
    CylinderGeometry,
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
} from 'three';
import { THEME } from '../theme';

const barkUrl = new URL('../../assets/textures/bark.webp', import.meta.url).href;
const foliageUrl = new URL('../../assets/textures/foliage.webp', import.meta.url).href;
import {
    DETAIL_TILE,
    grassAlbedoUrl,
    grassNormalUrl,
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
    private readonly cloudShadow: Mesh;
    private readonly cloudBoundsX: number;

    /** outer-world height: flat meadow band, then slopes rising into a mountain ring */
    private readonly terrainHeight: (x: number, z: number) => number;

    constructor(map: BattleMap, seed = 20260709) {
        const rng = mulberry32(seed);
        this.cloudBoundsX = map.halfW + 600;

        const noise = makeValueNoise(31337);
        this.terrainHeight = (x, z) => {
            const d = Math.max(Math.abs(x) - map.halfW, Math.abs(z) - map.halfH, 0);
            if (d <= 55) return 0;
            // rise into the ring, then settle back down toward the horizon
            const rise = smooth01((d - 55) / 380) * (1 - smooth01((d - 640) / 260));
            const n =
                noise(x / 170 + 3.7, z / 170 + 8.1) * 0.55 +
                noise(x / 62 + 51.2, z / 62 + 17.9) * 0.3 +
                noise(x / 24 + 9.4, z / 24 + 63.7) * 0.15;
            const ridge = Math.pow(Math.max(0, n - 0.35) / 0.65, 1.4);
            return rise * (16 + 135 * ridge);
        };

        this.skyGroup.add(this.createSkyDome(), this.createSunGlow());
        this.group.add(this.skyGroup);
        this.group.add(this.createOuterGround(map));
        this.createForest(map, rng);
        this.cloudShadow = this.createCloudShadow(map);
        this.group.add(this.cloudShadow);
        this.createClouds(map, rng);
    }

    update(dtSeconds: number, cameraPos: Vector3): void {
        this.skyGroup.position.set(cameraPos.x, 0, cameraPos.z);
        const mat = this.cloudShadow.material as MeshBasicMaterial;
        mat.map!.offset.x += dtSeconds * 0.0035;
        mat.map!.offset.y += dtSeconds * 0.0012;
        for (const c of this.clouds) {
            c.mesh.position.x += c.speed * dtSeconds;
            if (c.mesh.position.x > this.cloudBoundsX) c.mesh.position.x = -this.cloudBoundsX;
        }
    }

    /** big back-side sphere with a painted zenith-to-horizon gradient */
    private createSkyDome(): Mesh {
        const s = THEME.scenery;
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, s.skyZenith);
        grad.addColorStop(0.32, s.skyMid);
        grad.addColorStop(0.5, s.skyHorizon); // equator = horizon = fog color
        grad.addColorStop(1, s.skyHorizon);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 4, 256);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;

        const mesh = new Mesh(
            new SphereGeometry(850, 32, 16),
            new MeshBasicMaterial({ map: texture, side: BackSide, fog: false, depthWrite: false }),
        );
        return mesh;
    }

    /** soft additive glow billboard sitting where the directional sun points from */
    private createSunGlow(): Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, THEME.scenery.sunGlow);
        grad.addColorStop(0.25, 'rgba(255, 240, 190, 0.5)');
        grad.addColorStop(1, 'rgba(255, 240, 190, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;

        const sprite = new Sprite(
            new SpriteMaterial({
                map: texture,
                blending: AdditiveBlending,
                fog: false,
                depthWrite: false,
                transparent: true,
            }),
        );
        // same direction the DirectionalLight shines from, pushed near the dome shell
        sprite.position.copy(new Vector3(120, 160, 80).normalize().multiplyScalar(760));
        sprite.scale.setScalar(340);
        return sprite;
    }

    /**
     * The world beyond the field: a meadow band ringed by low-poly mountains.
     * One displaced plane with height-based vertex colors. The meadow band
     * carries the SAME world-aligned grass detail texture as the battlefield,
     * so the two surfaces read as one continuous terrain; the texture fades
     * out with altitude, leaving the mountains their faceted rock/snow look.
     */
    private createOuterGround(map: BattleMap): Mesh {
        const s = THEME.scenery;
        const SIZE = 3000;
        const SEGS = 300;
        const geometry = new PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        // white base: the grass texture (or the material color fallback)
        // provides the meadow green; rock/snow tint the heights
        const meadow = new Color(0xffffff);
        const rock = new Color(s.rock);
        const snow = new Color(s.snow);
        const c = new Color();
        for (let i = 0; i < pos.count; i++) {
            const h = this.terrainHeight(pos.getX(i), pos.getZ(i));
            pos.setY(i, h);
            c.copy(meadow)
                .lerp(rock, smooth01((h - 8) / 38))
                .lerp(snow, smooth01((h - 88) / 32));
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        pos.needsUpdate = true;
        geometry.setAttribute('color', new BufferAttribute(colors, 3));

        const material = new MeshStandardMaterial({
            color: s.outerGround, // swapped to white once the grass texture loads
            vertexColors: true,
            roughness: THEME.terrain.groundRoughness,
            metalness: 0,
            flatShading: true,
        });
        const mesh = new Mesh(geometry, material);
        mesh.position.y = -0.05;
        mesh.receiveShadow = true;
        void this.applyMeadowTexture(material, map, SIZE);
        return mesh;
    }

    /** load the battlefield's grass detail and continue its tiling out here */
    private async applyMeadowTexture(
        material: MeshStandardMaterial,
        map: BattleMap,
        size: number,
    ): Promise<void> {
        const loader = new TextureLoader();
        const [albedo, normal] = await Promise.all([
            loader.loadAsync(grassAlbedoUrl).catch(() => null),
            loader.loadAsync(grassNormalUrl).catch(() => null),
        ]);
        if (!albedo) return;
        // world-aligned tiling: same period as the field, and phase-shifted so
        // the pattern continues ACROSS the field border without a seam
        const frac = (v: number) => ((v % 1) + 1) % 1;
        const configure = (t: NonNullable<typeof albedo>) => {
            t.wrapS = t.wrapT = RepeatWrapping;
            t.repeat.set(size / DETAIL_TILE, size / DETAIL_TILE);
            t.offset.set(frac(map.halfW / DETAIL_TILE), frac(map.halfH / DETAIL_TILE));
            t.anisotropy = 8;
        };
        configure(albedo);
        albedo.colorSpace = SRGBColorSpace;
        material.map = albedo;
        if (normal) {
            configure(normal);
            material.normalMap = normal;
            material.normalScale = new Vector2(0.35, 0.35);
        }
        material.color.set(0xffffff);
        // fade the grass detail out with altitude so the rocky heights keep
        // their clean faceted vertex-color look
        material.onBeforeCompile = (shader) => {
            shader.vertexShader =
                'varying float vTerrainH;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvTerrainH = position.y;',
                );
            shader.fragmentShader =
                'varying float vTerrainH;\n' +
                shader.fragmentShader.replace(
                    '#include <map_fragment>',
                    '#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), smoothstep(8.0, 32.0, vTerrainH));',
                );
        };
        material.customProgramCacheKey = () => 'outer-meadow-grass';
        material.needsUpdate = true;
    }

    /**
     * Low-poly trees, bushes and rocks — a ring around the field, plus a few
     * trees and bushes ON the battlefield (pure scenery: no collision, units
     * simply walk through/behind them). Instanced per part — five draw calls.
     */
    private createForest(map: BattleMap, rng: () => number): void {
        const s = THEME.scenery;
        const margin = 150; // how far beyond the field trees spread
        const keepOut = 8; // gap between field edge and the first trunk

        const spot = (): { x: number; z: number } => {
            for (;;) {
                const x = (rng() * 2 - 1) * (map.halfW + margin);
                const z = (rng() * 2 - 1) * (map.halfH + margin);
                if (Math.abs(x) > map.halfW + keepOut || Math.abs(z) > map.halfH + keepOut) {
                    return { x, z };
                }
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
        const PINES = 55;
        const LEAFY = 35;
        const FIELD_PINES = 5;
        const FIELD_LEAFY = 6;
        const ROCKS = 30;
        const BUSHES = 40; // outer ring
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
            const { x, z } = i < PINES ? spot() : fieldSpot(10);
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
            const { x, z } = i < LEAFY ? spot() : fieldSpot(10);
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

        for (let i = 0; i < ROCKS; i++) {
            const { x, z } = spot();
            const sc = 0.5 + rng() * 1.3;
            dummy.position.set(x, groundY(x, z) + 0.4 * sc, z);
            dummy.scale.set(sc, sc * 0.55, sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            rocks.setMatrixAt(i, dummy.matrix);
        }

        for (let i = 0; i < BUSHES + FIELD_BUSHES; i++) {
            const { x, z } = i < BUSHES ? spot() : fieldSpot(5);
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
        const material = new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: THEME.scenery.cloudOpacity,
            depthWrite: false,
        });
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
    }
}
