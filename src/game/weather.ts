import {
    AdditiveBlending,
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
    SpriteMaterial,
    SRGBColorSpace,
    Sprite,
    Vector3,
    type DirectionalLight,
    type Fog,
    type HemisphereLight,
    type Scene,
    type Texture,
    type WebGLRenderer,
} from 'three';
import { mulberry32, type BattleMap } from './map';
import { sceneryFogScale } from './prefs';
import { loadWorldTexture, moonUrl } from './worldTextures';

/** slow seasonal look — biases the sky tint and drives vegetation via `onSeasonChange` */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** precipitation, independent of time of day and season */
export type WeatherKind = 'clear' | 'rain' | 'snow';
/** where the sun/moon sits — owns the base sky, sun, stars, exposure, sun direction */
export type TimeOfDay = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

/** the three independent axes composed into one atmosphere every update */
export interface Atmosphere {
    season: Season;
    weatherKind: WeatherKind;
    /** 0..1, meaningless while weatherKind is 'clear' */
    weatherIntensity: number;
    timeOfDay: TimeOfDay;
}

/** everything a time-of-day owns — base sky/sun/stars/exposure/sun direction */
interface TimePreset {
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
    /** opacity of the fog cards drifting between the forest trees */
    forestFog: number;
    stars: number;
    /** multiplies the renderer's base tone-mapping exposure */
    exposureMul: number;
}

/** what rain/snow tug the composed sky/light/cloud values toward, blended in by intensity */
interface WeatherOverlay {
    skyZenith: number;
    skyMid: number;
    skyHorizon: number;
    fogNear: number;
    fogFar: number;
    sun: number;
    sunIntensity: number;
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    glow: number;
    glowScale: number;
    glowOpacity: number;
    cloudTint: number;
    cloudOpacity: number;
    cloudShadowOpacity: number;
    nearCloudOpacity: number;
    forestFog: number;
    exposureMul: number;
}

/** the fully composed, still-numeric (not yet lerped) target for one frame */
interface ComposedTarget extends TimePreset {
    rain: number;
    snow: number;
}

const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
    // early morning: cool blue up top fading into a soft peach horizon, low
    // sun still gathering strength, a little dawn haze and a few fading stars
    dawn: {
        skyZenith: 0x1c3f72,
        skyMid: 0x6a80ab,
        skyHorizon: 0xf0b98c,
        fogNear: 380,
        fogFar: 1350,
        sun: 0xffd8a8,
        sunIntensity: 1.15,
        sunPos: { x: -170, y: 50, z: 30 },
        hemiSky: 0xcdd6ec,
        hemiGround: 0x5c6c4a,
        hemiIntensity: 0.85,
        glow: 0xffe0b4,
        glowScale: 300,
        glowOpacity: 0.9,
        cloudTint: 0xffd9c2,
        cloudOpacity: 0.55,
        cloudShadowOpacity: 0.08,
        nearCloudOpacity: 0.18,
        forestFog: 0.32,
        stars: 0.08,
        exposureMul: 0.95,
    },
    // crisp bright day — deep saturated sky, minimal haze, strong warm sun with
    // real contrast against the ambient fill so it reads as "fresh", not flat
    day: {
        skyZenith: 0x1560b8,
        skyMid: 0x2f86d4,
        skyHorizon: 0x6eb8e8,
        fogNear: 820,
        fogFar: 2700,
        sun: 0xfff2c8,
        sunIntensity: 2.05,
        sunPos: { x: 120, y: 210, z: 60 },
        hemiSky: 0xe8f6cc,
        hemiGround: 0x6a9a48,
        hemiIntensity: 1.0,
        glow: 0xfff6d8,
        glowScale: 340,
        glowOpacity: 1,
        cloudTint: 0xffffff,
        cloudOpacity: 0.8,
        cloudShadowOpacity: 0.14,
        nearCloudOpacity: 0.12,
        forestFog: 0.07,
        stars: 0,
        exposureMul: 1.08,
    },
    // golden hour: low warm amber sun, rich orange-gold horizon, sky still
    // bluish up high — punchiest light of the day
    golden: {
        skyZenith: 0x1c5aa0,
        skyMid: 0x5f8fc4,
        skyHorizon: 0xffb058,
        fogNear: 520,
        fogFar: 1950,
        sun: 0xffb247,
        sunIntensity: 1.9,
        sunPos: { x: -195, y: 65, z: 85 },
        hemiSky: 0xffdcac,
        hemiGround: 0x8c6c3a,
        hemiIntensity: 1.05,
        glow: 0xffc670,
        glowScale: 390,
        glowOpacity: 1,
        cloudTint: 0xffd39a,
        cloudOpacity: 0.5,
        cloudShadowOpacity: 0.1,
        nearCloudOpacity: 0.14,
        forestFog: 0.12,
        stars: 0,
        exposureMul: 1.18,
    },
    // sunset: deep purple-blue overhead, glowing orange-red horizon, sun low
    // on the opposite side from dawn
    dusk: {
        skyZenith: 0x162a54,
        skyMid: 0x6c4f7c,
        skyHorizon: 0xd8703e,
        fogNear: 360,
        fogFar: 1300,
        sun: 0xff9a5c,
        sunIntensity: 1.05,
        sunPos: { x: 175, y: 42, z: -55 },
        hemiSky: 0xb99098,
        hemiGround: 0x4a3a30,
        hemiIntensity: 0.8,
        glow: 0xffab6a,
        glowScale: 330,
        glowOpacity: 0.95,
        cloudTint: 0xff9a6c,
        cloudOpacity: 0.6,
        cloudShadowOpacity: 0.1,
        nearCloudOpacity: 0.2,
        forestFog: 0.34,
        stars: 0.12,
        exposureMul: 0.88,
    },
    // starlit night — "movie night": cool, dark-ish, but units stay readable.
    // No clouds (see composeTarget) unless a storm is actively rolling through.
    night: {
        skyZenith: 0x050912,
        skyMid: 0x0b1428,
        skyHorizon: 0x18253e,
        fogNear: 620,
        fogFar: 2100,
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
        cloudOpacity: 0,
        cloudShadowOpacity: 0,
        nearCloudOpacity: 0,
        forestFog: 0.28,
        stars: 1,
        exposureMul: 0.82,
    },
};

// grey drizzle — close fog, dim cool light, heavy cloud work; blended in by
// `weatherIntensity` on top of whatever the current time of day looks like
const RAIN_OVERLAY: WeatherOverlay = {
    skyZenith: 0x5c6c7a,
    skyMid: 0x8a969c,
    skyHorizon: 0xa8b2b2,
    fogNear: 130,
    fogFar: 620,
    sun: 0xc0ccd8,
    sunIntensity: 0.75,
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
    forestFog: 0.55,
    exposureMul: 0.9,
};

// overcast snowfall — pale cold sky, soft even light; ground accumulation is
// handled separately by `Weather.groundSnow` so it lags/lingers realistically
const SNOW_OVERLAY: WeatherOverlay = {
    skyZenith: 0x9fb4c4,
    skyMid: 0xc6d6de,
    skyHorizon: 0xe6eef2,
    fogNear: 260,
    fogFar: 950,
    sun: 0xe2ecf4,
    sunIntensity: 1.0,
    hemiSky: 0xe2ecee,
    hemiGround: 0x84948a,
    hemiIntensity: 1.15,
    glow: 0xeef6fa,
    glowScale: 220,
    glowOpacity: 0.32,
    cloudTint: 0xdfe7ea,
    cloudOpacity: 0.9,
    cloudShadowOpacity: 0.04,
    nearCloudOpacity: 0.3,
    forestFog: 0.35,
    exposureMul: 0.97,
};

function lerpHex(a: number, b: number, t: number): number {
    return new Color(a).lerp(new Color(b), t).getHex();
}

/** light seasonal push on the sky/ambient tint — fully washed out by a storm
 *  (the weather overlay blend happens on top of this, see composeTarget) */
function applySeasonBias(p: TimePreset, season: Season): void {
    switch (season) {
        case 'spring':
            p.skyHorizon = lerpHex(p.skyHorizon, 0x9fe4f0, 0.12);
            p.hemiGround = lerpHex(p.hemiGround, 0x78c058, 0.15);
            break;
        case 'autumn':
            p.skyHorizon = lerpHex(p.skyHorizon, 0xd89858, 0.2);
            p.hemiGround = lerpHex(p.hemiGround, 0x9a7c3c, 0.2);
            break;
        case 'winter':
            p.skyHorizon = lerpHex(p.skyHorizon, 0xb9ccd8, 0.16);
            p.hemiGround = lerpHex(p.hemiGround, 0x7c8c82, 0.18);
            break;
        case 'summer':
            break; // current THEME greens — no bias
    }
}

function lerpOverlay(p: TimePreset, overlay: WeatherOverlay, t: number): void {
    p.skyZenith = lerpHex(p.skyZenith, overlay.skyZenith, t);
    p.skyMid = lerpHex(p.skyMid, overlay.skyMid, t);
    p.skyHorizon = lerpHex(p.skyHorizon, overlay.skyHorizon, t);
    p.fogNear += (overlay.fogNear - p.fogNear) * t;
    p.fogFar += (overlay.fogFar - p.fogFar) * t;
    p.sun = lerpHex(p.sun, overlay.sun, t);
    p.sunIntensity += (overlay.sunIntensity - p.sunIntensity) * t;
    p.hemiSky = lerpHex(p.hemiSky, overlay.hemiSky, t);
    p.hemiGround = lerpHex(p.hemiGround, overlay.hemiGround, t);
    p.hemiIntensity += (overlay.hemiIntensity - p.hemiIntensity) * t;
    p.glow = lerpHex(p.glow, overlay.glow, t);
    p.glowScale += (overlay.glowScale - p.glowScale) * t;
    p.glowOpacity += (overlay.glowOpacity - p.glowOpacity) * t;
    p.cloudTint = lerpHex(p.cloudTint, overlay.cloudTint, t);
    p.cloudOpacity += (overlay.cloudOpacity - p.cloudOpacity) * t;
    p.cloudShadowOpacity += (overlay.cloudShadowOpacity - p.cloudShadowOpacity) * t;
    p.nearCloudOpacity += (overlay.nearCloudOpacity - p.nearCloudOpacity) * t;
    p.forestFog += (overlay.forestFog - p.forestFog) * t;
    p.exposureMul += (overlay.exposureMul - p.exposureMul) * t;
}

/**
 * Composes the three independent axes into one numeric target: time of day
 * owns the base sky/sun/stars/exposure/sun-direction, season lightly biases
 * the tint, and — unless clear — the weather kind pulls sky/fog/light/clouds
 * toward its overlay by `weatherIntensity`. Night keeps zero clouds only
 * while clear; a storm can still roll clouds in over a clear night sky.
 */
function composeTarget(atmosphere: Atmosphere): ComposedTarget {
    const time = TIME_PRESETS[atmosphere.timeOfDay];
    const p: TimePreset = { ...time, sunPos: time.sunPos };
    applySeasonBias(p, atmosphere.season);
    if (atmosphere.weatherKind === 'clear' && atmosphere.timeOfDay === 'night') {
        p.cloudOpacity = 0;
        p.cloudShadowOpacity = 0;
        p.nearCloudOpacity = 0;
    }
    if (atmosphere.weatherKind !== 'clear') {
        lerpOverlay(p, atmosphere.weatherKind === 'rain' ? RAIN_OVERLAY : SNOW_OVERLAY, atmosphere.weatherIntensity);
    }
    return {
        ...p,
        rain: atmosphere.weatherKind === 'rain' ? atmosphere.weatherIntensity : 0,
        snow: atmosphere.weatherKind === 'snow' ? atmosphere.weatherIntensity : 0,
    };
}

const SEASON_CYCLE: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const TIME_CYCLE: TimeOfDay[] = ['dawn', 'day', 'golden', 'dusk', 'night'];
const WEATHER_STEPS: { kind: WeatherKind; intensity: number }[] = [
    { kind: 'clear', intensity: 0 },
    { kind: 'rain', intensity: 0.45 },
    { kind: 'rain', intensity: 1 },
    { kind: 'snow', intensity: 0.4 },
    { kind: 'snow', intensity: 1 },
];

/** seconds for the exponential ease toward a new target (sky + foliage share this) */
export const TRANSITION_TAU = 3.5;
const RAIN_DROPS = 2200;
const RAIN_BOX = { x: 170, y: 80, z: 170 };
const STAR_COUNT = 1400;
const SNOW_FLAKES = 1600;
/** World-space slab around the camera. `y` is the vertical span above the camera. */
const SNOW_BOX = { x: 190, y: 110, z: 190 };
/** How far below the camera flakes may fall before respawning (keeps near-ground fill). */
const SNOW_BELOW = 55;
/** ground snow builds up while it's snowing and melts (slower) once it stops.
 *  Seconds for an exponential ease — lower = faster. Production ~45 / 100;
 *  use ~8 / 20 while testing the look. */
const SNOW_COVER_GROW_TAU = 8;
const SNOW_COVER_MELT_TAU = 20;

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
    /** shared material of the forest fog cards (null on low scenery) */
    forestFogMaterial: MeshBasicMaterial | null;
    /** scenery-tier multiplier on the fog cards' opacity */
    forestFogScale: number;
    /** camera-following group (sky dome home) — stars live here */
    skyGroup: Group;
    /** world-space scenery group — rain + near clouds live here */
    worldGroup: Group;
    map: BattleMap;
    renderer: WebGLRenderer;
    /** fired whenever the season changes, so scenery can retint vegetation */
    onSeasonChange?: (season: Season) => void;
}

/** a fully numeric/lerpable copy of a composed target, used as the live state */
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
    forestFog = 0;
    stars = 0;
    rain = 0;
    snow = 0;
    exposureMul = 1;

    set(p: ComposedTarget): void {
        this.lerpToward(p, 1);
    }

    lerpToward(p: ComposedTarget, k: number): void {
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
        this.forestFog += (p.forestFog - this.forestFog) * k;
        this.stars += (p.stars - this.stars) * k;
        this.rain += (p.rain - this.rain) * k;
        this.snow += (p.snow - this.snow) * k;
        this.exposureMul += (p.exposureMul - this.exposureMul) * k;
    }
}

/**
 * Atmosphere system: season / weather / time of day are independent axes,
 * composed into one numeric target every time any of them changes and eased
 * into smoothly (see `composeTarget` + `WeatherState`). `onRound` deterministically
 * rolls a new weather (seeded, so network peers stay in sync); `nextSeason` /
 * `nextWeather` / `nextTime` cycle manually (hotkeys N / V / B).
 */
export class Weather {
    private readonly state = new WeatherState();
    private atmosphere: Atmosphere = {
        season: 'summer',
        weatherKind: 'clear',
        weatherIntensity: 0,
        timeOfDay: 'day',
    };
    private target: ComposedTarget;
    private readonly rng: () => number;
    /** renderer's tone-mapping exposure before the weather system starts driving it */
    private readonly baseExposure: number;

    private readonly rainGroup = new Group();
    private readonly rainMaterial: PointsMaterial;
    private readonly rainPositions: Float32Array;
    private readonly rainSpeeds: Float32Array;
    private readonly rainGeometry: BufferGeometry;

    private readonly snowGroup = new Group();
    private readonly snowMaterial: PointsMaterial;
    private readonly snowPositions: Float32Array;
    private readonly snowSpeeds: Float32Array;
    private readonly snowPhase: Float32Array;
    private readonly snowGeometry: BufferGeometry;
    private snowTime = 0;
    /** 0..1 ground accumulation — builds while it snows, melts (slower) once it stops */
    private snowCover = 0;

    private readonly starMaterial: PointsMaterial;
    private readonly nearClouds: { mesh: Mesh; speed: number }[] = [];
    private readonly nearCloudMaterial: MeshBasicMaterial;
    private skyDirty = true;

    constructor(
        private readonly h: WeatherHandles,
        seed: number,
    ) {
        this.rng = mulberry32(seed);
        this.target = composeTarget(this.atmosphere);
        this.state.set(this.target);
        this.baseExposure = h.renderer.toneMappingExposure;
        h.onSeasonChange?.(this.atmosphere.season);

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

        // --- snow: soft round flakes, much slower than rain and drifting side to side
        this.snowPositions = new Float32Array(SNOW_FLAKES * 3);
        this.snowSpeeds = new Float32Array(SNOW_FLAKES);
        this.snowPhase = new Float32Array(SNOW_FLAKES);
        const snowRoll = mulberry32(seed ^ 0x50f7);
        for (let i = 0; i < SNOW_FLAKES; i++) {
            this.snowPositions[i * 3] = (snowRoll() * 2 - 1) * SNOW_BOX.x;
            // start distributed through a tall column; first updates re-anchor to camera
            this.snowPositions[i * 3 + 1] = snowRoll() * (SNOW_BOX.y + SNOW_BELOW);
            this.snowPositions[i * 3 + 2] = (snowRoll() * 2 - 1) * SNOW_BOX.z;
            this.snowSpeeds[i] = 4 + snowRoll() * 7;
            this.snowPhase[i] = snowRoll() * Math.PI * 2;
        }
        this.snowGeometry = new BufferGeometry();
        this.snowGeometry.setAttribute('position', new BufferAttribute(this.snowPositions, 3));
        this.snowMaterial = new PointsMaterial({
            map: makeSnowflakeTexture(),
            color: 0xffffff,
            size: 3.4,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        const snowPoints = new Points(this.snowGeometry, this.snowMaterial);
        snowPoints.frustumCulled = false;
        this.snowGroup.add(snowPoints);
        this.snowGroup.visible = false;
        h.worldGroup.add(this.snowGroup);

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
        // NOT transparent: additive stars render in the OPAQUE pass right
        // after the sky dome, so mountains (and everything else) paint over
        // them — the star shell is nearer than far peaks and would otherwise
        // depth-test in front of them in the transparent pass.
        this.starMaterial = new PointsMaterial({
            map: makeStarTexture(),
            color: 0xffffff,
            size: 2.6,
            sizeAttenuation: false,
            transparent: false,
            blending: AdditiveBlending,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            fog: false,
        });
        const stars = new Points(starGeometry, this.starMaterial);
        stars.visible = false;
        stars.frustumCulled = false;
        stars.renderOrder = -1; // right after the dome, behind everything solid
        h.skyGroup.add(stars);
        this.starsMesh = stars;

        // --- sun disc + moon, riding the glow sprite's direction
        this.sunDisc = new Sprite(
            new SpriteMaterial({
                map: makeSunDiscTexture(),
                color: 0xfff6d8,
                blending: AdditiveBlending,
                transparent: true,
                depthWrite: false,
                fog: false,
                opacity: 0,
            }),
        );
        this.sunDisc.scale.setScalar(85);
        this.sunDisc.visible = false;
        h.skyGroup.add(this.sunDisc);

        this.moon = new Sprite(
            new SpriteMaterial({
                map: makeFallbackMoonTexture(),
                color: 0xffffff,
                blending: AdditiveBlending, // generated on pure black — adds cleanly
                transparent: true,
                depthWrite: false,
                fog: false,
                opacity: 0,
            }),
        );
        this.moon.scale.setScalar(120);
        this.moon.visible = false;
        h.skyGroup.add(this.moon);
        // upgrade to the painted moon once (if) it loads
        void loadWorldTexture(moonUrl).then((t) => {
            if (!t) return;
            t.colorSpace = SRGBColorSpace;
            this.moon.material.map = t;
            this.moon.material.needsUpdate = true;
        });

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
    private readonly sunDisc: Sprite;
    private readonly moon: Sprite;

    get season(): Season {
        return this.atmosphere.season;
    }

    get weatherKind(): WeatherKind {
        return this.atmosphere.weatherKind;
    }

    get weatherIntensity(): number {
        return this.atmosphere.weatherIntensity;
    }

    get timeOfDay(): TimeOfDay {
        return this.atmosphere.timeOfDay;
    }

    /** immutable copy of the current atmosphere — stash it, then `setAtmosphere` it back later */
    get snapshot(): Atmosphere {
        return { ...this.atmosphere };
    }

    /**
     * 0..1 how much snow currently lies on the ground — lags the sky, melts
     * slowly. Quadratic ease-in on top of the raw accumulator (see
     * `snowCover`) so the very start of a snowfall stays close to bare ground
     * for a while instead of an immediately-visible wash.
     */
    get groundSnow(): number {
        return this.snowCover * this.snowCover;
    }

    /** compact live-state dump for the debug overlay — for finetuning presets */
    debugLines(): string[] {
        const s = this.state;
        const a = this.atmosphere;
        const hex = (c: Color) => `#${c.getHexString()}`;
        return [
            `season ${a.season}  weather ${a.weatherKind} ${(a.weatherIntensity * 100).toFixed(0)}%  time ${a.timeOfDay}`,
            `ground-snow accum ${(this.snowCover * 100).toFixed(0)}% visual ${(this.groundSnow * 100).toFixed(0)}%`,
            `sky zenith ${hex(s.skyZenith)} mid ${hex(s.skyMid)} horizon ${hex(s.skyHorizon)}`,
            `fog near ${s.fogNear.toFixed(0)} far ${s.fogFar.toFixed(0)}`,
            `sun ${hex(s.sun)} int ${s.sunIntensity.toFixed(2)}  hemi ${hex(s.hemiSky)}/${hex(s.hemiGround)} int ${s.hemiIntensity.toFixed(2)}`,
            `exposureMul ${s.exposureMul.toFixed(2)}  glow ${hex(s.glow)} op ${s.glowOpacity.toFixed(2)}`,
            `rain ${s.rain.toFixed(2)}  snow ${s.snow.toFixed(2)}  stars ${s.stars.toFixed(2)}  forestFog ${s.forestFog.toFixed(2)}`,
        ];
    }

    /** partial update — merge in whichever axes changed and recompose the target */
    setAtmosphere(partial: Partial<Atmosphere>): void {
        const prevSeason = this.atmosphere.season;
        this.atmosphere = { ...this.atmosphere, ...partial };
        this.target = composeTarget(this.atmosphere);
        if (this.atmosphere.season !== prevSeason) this.h.onSeasonChange?.(this.atmosphere.season);
    }

    /** manual cycle (hotkey N) */
    nextSeason(): void {
        const i = SEASON_CYCLE.indexOf(this.atmosphere.season);
        this.setAtmosphere({ season: SEASON_CYCLE[(i + 1) % SEASON_CYCLE.length]! });
    }

    /** manual cycle (hotkey V): clear → rain 0.45 → rain 1 → snow 0.4 → snow 1 → clear… */
    nextWeather(): void {
        const i = WEATHER_STEPS.findIndex(
            (step) =>
                step.kind === this.atmosphere.weatherKind &&
                Math.abs(step.intensity - this.atmosphere.weatherIntensity) < 0.01,
        );
        const next = WEATHER_STEPS[(i + 1) % WEATHER_STEPS.length]!;
        this.setAtmosphere({ weatherKind: next.kind, weatherIntensity: next.intensity });
    }

    /** manual cycle (hotkey B): dawn → day → golden → dusk → night → dawn… */
    nextTime(): void {
        const i = TIME_CYCLE.indexOf(this.atmosphere.timeOfDay);
        this.setAtmosphere({ timeOfDay: TIME_CYCLE[(i + 1) % TIME_CYCLE.length]! });
    }

    /**
     * Once per round: maybe drift to another weather (occasionally the time
     * of day too), respecting the current season. Consumes the seeded stream
     * identically on every peer, so the sky stays in sync online.
     */
    onRound(round: number): void {
        const roll = this.rng();
        if (round <= 1 || roll >= 0.45) return;
        const season = this.atmosphere.season;
        const pick = this.rng();
        let kind: WeatherKind;
        let intensity = 0;
        if (season === 'winter') {
            // prefers clear/snow — no rain
            kind = pick < 0.5 ? 'clear' : 'snow';
            if (kind === 'snow') intensity = 0.5 + this.rng() * 0.5;
        } else if (season === 'spring' || season === 'summer') {
            // no snow weather
            kind = pick < 0.6 ? 'clear' : 'rain';
            if (kind === 'rain') intensity = 0.35 + this.rng() * 0.55;
        } else {
            // autumn: rain is common, an early cold snap can still snow lightly
            kind = pick < 0.5 ? 'clear' : pick < 0.85 ? 'rain' : 'snow';
            if (kind === 'rain') intensity = 0.35 + this.rng() * 0.55;
            if (kind === 'snow') intensity = 0.3 + this.rng() * 0.4;
        }
        this.setAtmosphere({ weatherKind: kind, weatherIntensity: intensity });
        if (this.rng() < 0.2) {
            this.setAtmosphere({ timeOfDay: TIME_CYCLE[Math.floor(this.rng() * TIME_CYCLE.length)]! });
        }
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
        const fogScale = sceneryFogScale();
        fog.near = s.fogNear * fogScale;
        fog.far = s.fogFar * fogScale;

        h.sun.color.copy(s.sun);
        h.sun.intensity = s.sunIntensity;
        h.sun.position.copy(s.sunPos);
        h.hemi.color.copy(s.hemiSky);
        h.hemi.groundColor.copy(s.hemiGround);
        h.hemi.intensity = s.hemiIntensity;
        h.renderer.toneMappingExposure = this.baseExposure * s.exposureMul;

        const glowMat = h.glow.material;
        glowMat.color.copy(s.glow);
        glowMat.opacity = s.glowOpacity;
        h.glow.scale.setScalar(s.glowScale);
        h.glow.position.copy(s.sunPos).normalize().multiplyScalar(760);
        h.glow.visible = s.glowOpacity > 0.02;

        // celestial bodies share the glow's direction; night (= star amount)
        // crossfades the crisp sun disc into the moon
        const night = s.stars;
        this.sunDisc.position.copy(h.glow.position);
        this.sunDisc.material.opacity = s.glowOpacity * (1 - night);
        this.sunDisc.visible = this.sunDisc.material.opacity > 0.02;
        this.moon.position.copy(h.glow.position);
        this.moon.material.opacity = night;
        this.moon.visible = night > 0.02;

        h.cloudMaterial.color.copy(s.cloudTint);
        h.cloudMaterial.opacity = s.cloudOpacity;
        h.cloudShadowMaterial.opacity = s.cloudShadowOpacity;

        this.starMaterial.opacity = s.stars;
        this.starsMesh.visible = s.stars > 0.02;

        if (h.forestFogMaterial) {
            // fog cards blend toward the horizon/fog color of the scenario
            h.forestFogMaterial.opacity = s.forestFog * h.forestFogScale;
            h.forestFogMaterial.color.copy(s.skyHorizon);
        }

        this.nearCloudMaterial.opacity = s.nearCloudOpacity;
        for (const c of this.nearClouds) {
            c.mesh.visible = s.nearCloudOpacity > 0.02;
            c.mesh.position.x += c.speed * dtSeconds;
            const bound = this.h.map.halfW + 200;
            if (c.mesh.position.x > bound) c.mesh.position.x = -bound;
        }

        this.updateRain(dtSeconds, cameraPos);
        this.updateSnow(dtSeconds, cameraPos);

        // ground accumulation lags well behind the sky: builds slowly while it
        // actively snows, melts even slower once the weather moves on
        const targetCover = this.atmosphere.weatherKind === 'snow' ? this.atmosphere.weatherIntensity : 0;
        const tau = targetCover > this.snowCover ? SNOW_COVER_GROW_TAU : SNOW_COVER_MELT_TAU;
        this.snowCover += (targetCover - this.snowCover) * Math.min(1, dtSeconds / tau);
    }

    private updateRain(dt: number, cameraPos: Vector3): void {
        this.rainMaterial.opacity = this.state.rain * 0.55;
        const active = this.state.rain > 0.02;
        this.rainGroup.visible = active;
        if (!active) return;
        // drops live in WORLD space (the group never moves): panning the
        // camera streams past them naturally. Drops leaving the window around
        // the camera wrap to its other side while off-screen.
        const p = this.rainPositions;
        const wind = 14;
        for (let i = 0; i < RAIN_DROPS; i++) {
            p[i * 3] = p[i * 3]! + wind * dt;
            p[i * 3 + 1] = p[i * 3 + 1]! - this.rainSpeeds[i]! * dt;
            if (p[i * 3 + 1]! < 0) {
                p[i * 3 + 1] = RAIN_BOX.y;
                p[i * 3] = cameraPos.x + (Math.random() * 2 - 1) * RAIN_BOX.x;
                p[i * 3 + 2] = cameraPos.z + (Math.random() * 2 - 1) * RAIN_BOX.z;
            }
            const dx = p[i * 3]! - cameraPos.x;
            if (dx > RAIN_BOX.x) p[i * 3] = p[i * 3]! - 2 * RAIN_BOX.x;
            else if (dx < -RAIN_BOX.x) p[i * 3] = p[i * 3]! + 2 * RAIN_BOX.x;
            const dz = p[i * 3 + 2]! - cameraPos.z;
            if (dz > RAIN_BOX.z) p[i * 3 + 2] = p[i * 3 + 2]! - 2 * RAIN_BOX.z;
            else if (dz < -RAIN_BOX.z) p[i * 3 + 2] = p[i * 3 + 2]! + 2 * RAIN_BOX.z;
        }
        this.rainGeometry.attributes.position!.needsUpdate = true;
    }

    private updateSnow(dt: number, cameraPos: Vector3): void {
        this.snowMaterial.opacity = this.state.snow * 0.8;
        const active = this.state.snow > 0.02;
        this.snowGroup.visible = active;
        if (!active) return;
        this.snowTime += dt;
        // Camera-relative volume: XZ wraps like rain; Y spans from below the
        // camera up into the sky so the top of the frustum stays filled when
        // zoomed out / pitched (fixed world Y=90 left the upper screen empty).
        const p = this.snowPositions;
        const wind = 4;
        const yCeil = cameraPos.y + SNOW_BOX.y;
        const yFloor = cameraPos.y - SNOW_BELOW;
        for (let i = 0; i < SNOW_FLAKES; i++) {
            const sway = Math.sin(this.snowTime * 0.6 + this.snowPhase[i]!) * 3.2;
            p[i * 3] = p[i * 3]! + (wind + sway) * dt;
            p[i * 3 + 1] = p[i * 3 + 1]! - this.snowSpeeds[i]! * dt;
            if (p[i * 3 + 1]! < yFloor) {
                p[i * 3 + 1] = yCeil;
                p[i * 3] = cameraPos.x + (Math.random() * 2 - 1) * SNOW_BOX.x;
                p[i * 3 + 2] = cameraPos.z + (Math.random() * 2 - 1) * SNOW_BOX.z;
            } else if (p[i * 3 + 1]! > yCeil + 5) {
                // camera zoomed/moved under a flake — drop it back into the slab
                p[i * 3 + 1] = yFloor + Math.random() * (yCeil - yFloor);
            }
            const dx = p[i * 3]! - cameraPos.x;
            if (dx > SNOW_BOX.x) p[i * 3] = p[i * 3]! - 2 * SNOW_BOX.x;
            else if (dx < -SNOW_BOX.x) p[i * 3] = p[i * 3]! + 2 * SNOW_BOX.x;
            const dz = p[i * 3 + 2]! - cameraPos.z;
            if (dz > SNOW_BOX.z) p[i * 3 + 2] = p[i * 3 + 2]! - 2 * SNOW_BOX.z;
            else if (dz < -SNOW_BOX.z) p[i * 3 + 2] = p[i * 3 + 2]! + 2 * SNOW_BOX.z;
        }
        this.snowGeometry.attributes.position!.needsUpdate = true;
    }
}

/** soft round flake — a diffuse dot, unlike rain's crisp streak */
function makeSnowflakeTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 24, 24);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
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

/** crisp bright circle with a thin soft edge — the visible sun disc */
function makeSunDiscTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.42, 'rgba(255,255,255,1)');
    grad.addColorStop(0.52, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** procedural stand-in until the painted moon texture loads */
function makeFallbackMoonTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 58);
    grad.addColorStop(0, 'rgba(228,238,252,1)');
    grad.addColorStop(0.85, 'rgba(206,220,240,0.95)');
    grad.addColorStop(1, 'rgba(206,220,240,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,168,196,0.5)';
    for (const [x, y, r] of [
        [46, 50, 9],
        [72, 68, 12],
        [58, 86, 6],
        [84, 42, 5],
    ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
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
