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
    Color,
    Vector3,
} from 'three';
import { THEME } from '../theme';
import { makeValueNoise, mulberry32, type BattleMap } from './map';

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
                noise(x / 170 + 3.7, z / 170 + 8.1) * 0.65 +
                noise(x / 62 + 51.2, z / 62 + 17.9) * 0.35;
            const ridge = Math.pow(Math.max(0, n - 0.35) / 0.65, 1.4);
            return rise * (16 + 135 * ridge);
        };

        this.skyGroup.add(this.createSkyDome(), this.createSunGlow());
        this.group.add(this.skyGroup);
        this.group.add(this.createOuterGround());
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
     * One displaced plane with height-based vertex colors (grass, rock, snow).
     */
    private createOuterGround(): Mesh {
        const s = THEME.scenery;
        const SIZE = 3000;
        const SEGS = 150;
        const geometry = new PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        const grass = new Color(s.outerGround);
        const rock = new Color(s.rock);
        const snow = new Color(s.snow);
        const c = new Color();
        for (let i = 0; i < pos.count; i++) {
            const h = this.terrainHeight(pos.getX(i), pos.getZ(i));
            pos.setY(i, h);
            c.copy(grass)
                .lerp(rock, smooth01((h - 8) / 38))
                .lerp(snow, smooth01((h - 88) / 32));
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        pos.needsUpdate = true;
        geometry.setAttribute('color', new BufferAttribute(colors, 3));

        const mesh = new Mesh(
            geometry,
            new MeshStandardMaterial({
                color: 0xffffff,
                vertexColors: true,
                roughness: 1,
                metalness: 0,
                flatShading: true,
            }),
        );
        mesh.position.y = -0.05;
        mesh.receiveShadow = true;
        return mesh;
    }

    /**
     * Low-poly trees and rocks ringing the battlefield. Instanced per part —
     * the whole forest is four draw calls.
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

        const dummy = new Object3D();
        const color = new Color();
        const PINES = 55;
        const LEAFY = 35;
        const ROCKS = 30;

        const trunks = new InstancedMesh(
            new CylinderGeometry(0.35, 0.55, 3.4, 6),
            new MeshStandardMaterial({ color: s.trunk, roughness: 0.9 }),
            PINES + LEAFY,
        );
        const cones = new InstancedMesh(
            new ConeGeometry(2.6, 6, 7),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
            PINES * 2,
        );
        const blobs = new InstancedMesh(
            new IcosahedronGeometry(2.4, 1),
            new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
            LEAFY * 2,
        );
        const rocks = new InstancedMesh(
            new IcosahedronGeometry(1.4, 0),
            new MeshStandardMaterial({ color: s.rock, roughness: 0.95, flatShading: true }),
            ROCKS,
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

        for (let i = 0; i < PINES; i++) {
            const { x, z } = spot();
            const h = this.terrainHeight(x, z);
            const sc = 0.8 + rng() * 1.1;
            placeTrunk(x, z, sc, h);
            color.set(s.pine).lerp(new Color(s.pineLight), rng());
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

        for (let i = 0; i < LEAFY; i++) {
            const { x, z } = spot();
            const h = this.terrainHeight(x, z);
            const sc = 0.9 + rng() * 1.2;
            placeTrunk(x, z, sc, h);
            color.set(s.leaf).lerp(new Color(s.leafLight), rng());
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
            dummy.position.set(x, this.terrainHeight(x, z) + 0.4 * sc, z);
            dummy.scale.set(sc, sc * 0.55, sc);
            dummy.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy.updateMatrix();
            rocks.setMatrixAt(i, dummy.matrix);
        }

        for (const m of [trunks, cones, blobs, rocks]) {
            m.castShadow = true;
            this.group.add(m);
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
