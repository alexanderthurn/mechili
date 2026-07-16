import {
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Points,
    PointsMaterial,
    SRGBColorSpace,
    Sprite,
    Vector3,
    type DirectionalLight,
    type Fog,
    type HemisphereLight,
    type Scene,
    type Texture,
} from 'three';
import { mulberry32, type BattleMap } from './map';

export type WeatherId = 'sunny' | 'rain' | 'night';

/** everything a scenario tunes — all lerpable, so switching is a smooth fade */
export interface WeatherPreset {
    id: WeatherId;
    skyZenith: number;
    skyMid: number;
    skyHorizon: number;
    fogNear: number;
    fogFar: number;
    sun: number;
    sunIntensity: number;
    /** direction the sun/moon shines from (also places the glow sprite) */
    sunPos: { x: number; y: number; z: number };
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    /** the sun disc / moon sprite */
    glow: number;
    glowScale: number;
    glowOpacity: number;
    cloudTint: number;
    cloudOpacity: number;
    cloudShadowOpacity: number;
    nearCloudOpacity: number;
    stars: number;
    rain: number;
}

export const WEATHER_PRESETS: Record<WeatherId, WeatherPreset> = {
    // warm bright day — haze pushed far out, saturated sky, strong warm sun
    sunny: {
        id: 'sunny',
        skyZenith: 0x3888d8,
        skyMid: 0x7cc0ec,
        skyHorizon: 0xc4e0ee,
        fogNear: 700,
        fogFar: 2600,
        sun: 0xffe9b0,
        sunIntensity: 1.8,
        sunPos: { x: 120, y: 210, z: 60 },
        hemiSky: 0xd8ecc0,
        hemiGround: 0x6a9a48,
        hemiIntensity: 1.2,
        glow: 0xfff2cc,
        glowScale: 340,
        glowOpacity: 1,
        cloudTint: 0xffffff,
        cloudOpacity: 0.85,
        cloudShadowOpacity: 0.1,
        nearCloudOpacity: 0.16,
        stars: 0,
        rain: 0,
    },
    // grey drizzle — close fog, dim cool light, heavy cloud work + rain streaks
    rain: {
        id: 'rain',
        skyZenith: 0x5c6c7a,
        skyMid: 0x8a969c,
        skyHorizon: 0xa8b2b2,
        fogNear: 300,
        fogFar: 950,
        sun: 0xc0ccd8,
        sunIntensity: 0.75,
        sunPos: { x: 120, y: 160, z: 80 },
        hemiSky: 0x9ab0b8,
        hemiGround: 0x4e6a48,
        hemiIntensity: 0.95,
        glow: 0xd8e0e8,
        glowScale: 200,
        glowOpacity: 0,
        cloudTint: 0x8a949a,
        cloudOpacity: 0.95,
        cloudShadowOpacity: 0.2,
        nearCloudOpacity: 0.42,
        stars: 0,
        rain: 1,
    },
    // starlit night — "movie night": cool, dark-ish, but units stay readable
    night: {
        id: 'night',
        skyZenith: 0x050912,
        skyMid: 0x0b1428,
        skyHorizon: 0x18253e,
        fogNear: 380,
        fogFar: 1150,
        sun: 0xa8c4e8,
        sunIntensity: 0.8,
        sunPos: { x: -100, y: 190, z: -60 },
        hemiSky: 0x2a3c5e,
        hemiGround: 0x14201a,
        hemiIntensity: 0.7,
        glow: 0xe8f2ff,
        glowScale: 170,
        glowOpacity: 0.95,
        cloudTint: 0x3a465a,
        cloudOpacity: 0.3,
        cloudShadowOpacity: 0.03,
        nearCloudOpacity: 0.12,
        stars: 1,
        rain: 0,
    },
};

const CYCLE: WeatherId[] = ['sunny', 'rain', 'night'];
/** seconds for the exponential ease toward a new preset */
const TRANSITION_TAU = 3.5;
const RAIN_DROPS = 2200;
const RAIN_BOX = { x: 170, y: 80, z: 170 };
const STAR_COUNT = 1400;

/** hooks into the scene/scenery objects the weather drives */
export interface WeatherHandles {
    scene: Scene;
    sun: DirectionalLight;
    hemi: HemisphereLight;
    /** repaint the sky dome gradient with the given sRGB hex strings */
    repaintSky: (zenith: string, mid: string, horizon: string) => void;
    /** sun disc/moon sprite (white radial texture, tinted via material.color) */
    glow: Sprite;
    cloudMaterial: MeshBasicMaterial;
    cloudShadowMaterial: MeshBasicMaterial;
    cloudTexture: Texture;
    /** camera-following group (sky dome home) — stars live here */
    skyGroup: Group;
    /** world-space scenery group — rain + near clouds live here */
    worldGroup: Group;
    map: BattleMap;
}

/** a fully numeric/lerpable copy of a preset, used as the live state */
class WeatherState {
    skyZenith = new Color();
    skyMid = new Color();
    skyHorizon = new Color();
    fogNear = 0;
    fogFar = 0;
    sun = new Color();
    sunIntensity = 0;
    sunPos = new Vector3();
    hemiSky = new Color();
    hemiGround = new Color();
    hemiIntensity = 0;
    glow = new Color();
    glowScale = 0;
    glowOpacity = 0;
    cloudTint = new Color();
    cloudOpacity = 0;
    cloudShadowOpacity = 0;
    nearCloudOpacity = 0;
    stars = 0;
    rain = 0;

    set(p: WeatherPreset): void {
        this.lerpToward(p, 1);
    }

    lerpToward(p: WeatherPreset, k: number): void {
        this.skyZenith.lerp(new Color(p.skyZenith), k);
        this.skyMid.lerp(new Color(p.skyMid), k);
        this.skyHorizon.lerp(new Color(p.skyHorizon), k);
        this.fogNear += (p.fogNear - this.fogNear) * k;
        this.fogFar += (p.fogFar - this.fogFar) * k;
        this.sun.lerp(new Color(p.sun), k);
        this.sunIntensity += (p.sunIntensity - this.sunIntensity) * k;
        this.sunPos.lerp(new Vector3(p.sunPos.x, p.sunPos.y, p.sunPos.z), k);
        this.hemiSky.lerp(new Color(p.hemiSky), k);
        this.hemiGround.lerp(new Color(p.hemiGround), k);
        this.hemiIntensity += (p.hemiIntensity - this.hemiIntensity) * k;
        this.glow.lerp(new Color(p.glow), k);
        this.glowScale += (p.glowScale - this.glowScale) * k;
        this.glowOpacity += (p.glowOpacity - this.glowOpacity) * k;
        this.cloudTint.lerp(new Color(p.cloudTint), k);
        this.cloudOpacity += (p.cloudOpacity - this.cloudOpacity) * k;
        this.cloudShadowOpacity += (p.cloudShadowOpacity - this.cloudShadowOpacity) * k;
        this.nearCloudOpacity += (p.nearCloudOpacity - this.nearCloudOpacity) * k;
        this.stars += (p.stars - this.stars) * k;
        this.rain += (p.rain - this.rain) * k;
    }
}

/**
 * Scenario system: sunny / rain / night presets eased into smoothly.
 * Deterministically rolls a new scenario at most once per round (seeded, so
 * network peers stay in sync); `next()` cycles manually (hotkey N).
 */
export class Weather {
    private readonly state = new WeatherState();
    private target: WeatherPreset = WEATHER_PRESETS.sunny;
    private readonly rng: () => number;

    private readonly rainGroup = new Group();
    private readonly rainMaterial: PointsMaterial;
    private readonly rainPositions: Float32Array;
    private readonly rainSpeeds: Float32Array;
    private readonly rainGeometry: BufferGeometry;

    private readonly starMaterial: PointsMaterial;
    private readonly nearClouds: { mesh: Mesh; speed: number }[] = [];
    private readonly nearCloudMaterial: MeshBasicMaterial;
    private skyDirty = true;

    constructor(
        private readonly h: WeatherHandles,
        seed: number,
    ) {
        this.rng = mulberry32(seed);
        this.state.set(this.target);

        // --- rain: one Points cloud in a camera-following box
        this.rainPositions = new Float32Array(RAIN_DROPS * 3);
        this.rainSpeeds = new Float32Array(RAIN_DROPS);
        const roll = mulberry32(seed ^ 0x7a1d);
        for (let i = 0; i < RAIN_DROPS; i++) {
            this.rainPositions[i * 3] = (roll() * 2 - 1) * RAIN_BOX.x;
            this.rainPositions[i * 3 + 1] = roll() * RAIN_BOX.y;
            this.rainPositions[i * 3 + 2] = (roll() * 2 - 1) * RAIN_BOX.z;
            this.rainSpeeds[i] = 55 + roll() * 40;
        }
        this.rainGeometry = new BufferGeometry();
        this.rainGeometry.setAttribute('position', new BufferAttribute(this.rainPositions, 3));
        this.rainMaterial = new PointsMaterial({
            map: makeStreakTexture(),
            color: 0xcfe0f0,
            size: 2.4,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        const rain = new Points(this.rainGeometry, this.rainMaterial);
        rain.frustumCulled = false;
        this.rainGroup.add(rain);
        this.rainGroup.visible = false;
        h.worldGroup.add(this.rainGroup);

        // --- stars: points pinned to the (camera-following) sky dome shell
        const starPositions = new Float32Array(STAR_COUNT * 3);
        for (let i = 0; i < STAR_COUNT; i++) {
            // random upper-hemisphere direction, kept above the horizon band
            let x = 0;
            let y = 0;
            let z = 0;
            let len = 0;
            do {
                x = roll() * 2 - 1;
                y = roll();
                z = roll() * 2 - 1;
                len = Math.hypot(x, y, z);
            } while (len > 1 || len < 1e-4 || y / len < 0.06);
            starPositions[i * 3] = (x / len) * 830;
            starPositions[i * 3 + 1] = (y / len) * 830;
            starPositions[i * 3 + 2] = (z / len) * 830;
        }
        const starGeometry = new BufferGeometry();
        starGeometry.setAttribute('position', new BufferAttribute(starPositions, 3));
        this.starMaterial = new PointsMaterial({
            map: makeStarTexture(),
            color: 0xffffff,
            size: 2.6,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false,
        });
        const stars = new Points(starGeometry, this.starMaterial);
        stars.visible = false;
        stars.frustumCulled = false;
        stars.renderOrder = -1; // right after the dome, behind everything solid
        h.skyGroup.add(stars);
        this.starsMesh = stars;

        // --- near clouds: translucent wisps drifting over the battlefield
        this.nearCloudMaterial = new MeshBasicMaterial({
            map: h.cloudTexture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            color: 0xffffff,
        });
        const geo = new PlaneGeometry(1, 0.5);
        geo.rotateX(-Math.PI / 2);
        for (let i = 0; i < 7; i++) {
            const mesh = new Mesh(geo, this.nearCloudMaterial);
            mesh.position.set(
                (roll() * 2 - 1) * (h.map.halfW + 120),
                58 + roll() * 26,
                (roll() * 2 - 1) * (h.map.halfH + 120),
            );
            const s = 70 + roll() * 90;
            mesh.scale.set(s, 1, s * (0.4 + roll() * 0.3));
            mesh.visible = false;
            this.nearClouds.push({ mesh, speed: 5 + roll() * 6 });
            h.worldGroup.add(mesh);
        }
    }

    private readonly starsMesh: Points;

    get currentId(): WeatherId {
        return this.target.id;
    }

    /** manual cycle (hotkey) */
    next(): void {
        const i = CYCLE.indexOf(this.target.id);
        this.setTarget(CYCLE[(i + 1) % CYCLE.length]!);
    }

    setTarget(id: WeatherId): void {
        this.target = WEATHER_PRESETS[id];
    }

    /**
     * Once per round: maybe drift to another scenario. Consumes the seeded
     * stream identically on every peer, so the sky stays in sync online.
     */
    onRound(round: number): void {
        const roll = this.rng();
        const pick = this.rng();
        if (round <= 1 || roll >= 0.45) return;
        // weighted: sunny half the time, rain/night a quarter each
        const id: WeatherId = pick < 0.5 ? 'sunny' : pick < 0.75 ? 'rain' : 'night';
        this.setTarget(id);
    }

    update(dtSeconds: number, cameraPos: Vector3): void {
        const k = Math.min(1, dtSeconds / TRANSITION_TAU);
        const before = this.state.skyZenith.getHex() + this.state.skyMid.getHex();
        this.state.lerpToward(this.target, k);
        if (before !== this.state.skyZenith.getHex() + this.state.skyMid.getHex()) {
            this.skyDirty = true;
        }
        const s = this.state;
        const h = this.h;

        if (this.skyDirty) {
            h.repaintSky(
                `#${s.skyZenith.getHexString()}`,
                `#${s.skyMid.getHexString()}`,
                `#${s.skyHorizon.getHexString()}`,
            );
            this.skyDirty = false;
        }
        (h.scene.background as Color).copy(s.skyHorizon);
        const fog = h.scene.fog as Fog;
        fog.color.copy(s.skyHorizon);
        fog.near = s.fogNear;
        fog.far = s.fogFar;

        h.sun.color.copy(s.sun);
        h.sun.intensity = s.sunIntensity;
        h.sun.position.copy(s.sunPos);
        h.hemi.color.copy(s.hemiSky);
        h.hemi.groundColor.copy(s.hemiGround);
        h.hemi.intensity = s.hemiIntensity;

        const glowMat = h.glow.material;
        glowMat.color.copy(s.glow);
        glowMat.opacity = s.glowOpacity;
        h.glow.scale.setScalar(s.glowScale);
        h.glow.position.copy(s.sunPos).normalize().multiplyScalar(760);
        h.glow.visible = s.glowOpacity > 0.02;

        h.cloudMaterial.color.copy(s.cloudTint);
        h.cloudMaterial.opacity = s.cloudOpacity;
        h.cloudShadowMaterial.opacity = s.cloudShadowOpacity;

        this.starMaterial.opacity = s.stars;
        this.starsMesh.visible = s.stars > 0.02;

        this.nearCloudMaterial.opacity = s.nearCloudOpacity;
        for (const c of this.nearClouds) {
            c.mesh.visible = s.nearCloudOpacity > 0.02;
            c.mesh.position.x += c.speed * dtSeconds;
            const bound = this.h.map.halfW + 200;
            if (c.mesh.position.x > bound) c.mesh.position.x = -bound;
        }

        this.updateRain(dtSeconds, cameraPos);
    }

    private updateRain(dt: number, cameraPos: Vector3): void {
        this.rainMaterial.opacity = this.state.rain * 0.55;
        const active = this.state.rain > 0.02;
        this.rainGroup.visible = active;
        if (!active) return;
        this.rainGroup.position.set(cameraPos.x, 0, cameraPos.z);
        const p = this.rainPositions;
        const wind = 14;
        for (let i = 0; i < RAIN_DROPS; i++) {
            p[i * 3] = p[i * 3]! + wind * dt;
            p[i * 3 + 1] = p[i * 3 + 1]! - this.rainSpeeds[i]! * dt;
            if (p[i * 3 + 1]! < 0) {
                p[i * 3 + 1] = RAIN_BOX.y;
                p[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX.x;
                p[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX.z;
            }
            if (p[i * 3]! > RAIN_BOX.x) p[i * 3] = -RAIN_BOX.x;
        }
        this.rainGeometry.attributes.position!.needsUpdate = true;
    }
}

/** thin vertical white streak — reads as a falling drop at RTS pitch */
function makeStreakTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(3, 0, 2, 32);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** soft round dot with a hot core */
function makeStarTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}
