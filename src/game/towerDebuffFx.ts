import {
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    Mesh,
    NormalBlending,
    ShaderMaterial,
    Vector2,
    type Scene,
} from 'three';
import { colorForBattleTeam } from './colors';
import type { Particles } from './effects';
import { groundHeightAt } from './map';
import { screenShake } from './screenShake';
import type { SimEvent } from './sim';

/** seconds for the ring to expand and fade (after the column peaks) */
const WAVE_DURATION = 1.15;
/** wave starts expanding once the column has risen */
const WAVE_DELAY = 0.18;
/** slight elliptical stretch (1 = circle) — wider “sideways” across the field */
const SIDEWAYS_STRETCH = 1.25;
const COLUMN_RISE = 0.22;
const COLUMN_FADE = 0.4;
const FLASH_DURATION = 0.5;
/** clearance above the tallest terrain under the flash disc */
const FLASH_CLEARANCE = 1.8;
/** peak flash radius (matches update scale: 6 + 16) — used for height sampling */
const FLASH_MAX_RADIUS = 22;
const COLUMN_HEIGHT = 28;
const MAX_ACTIVE = 6;

type Wave = {
    mesh: Mesh;
    mat: ShaderMaterial;
    age: number;
    duration: number;
    maxRadius: number;
};

type Column = {
    mesh: Mesh;
    mat: ShaderMaterial;
    age: number;
    groundY: number;
};

type Flash = {
    mesh: Mesh;
    mat: ShaderMaterial;
    age: number;
};

/**
 * Visual-only tower-loss FX: upward team-color column that collapses into a
 * board-spanning wave, plus a brief ground flash (scorch is stamped in game.ts).
 * Driven by {@link SimEvent} `towerDebuff` — never touches sim state.
 */
export class TowerDebuffFx {
    private readonly waves: Wave[] = [];
    private readonly columns: Column[] = [];
    private readonly flashes: Flash[] = [];
    private readonly waveGeo = new CircleGeometry(1, 96);
    private readonly flashGeo = new CircleGeometry(1, 48);
    private readonly columnGeo = new CylinderGeometry(1, 1, 1, 24, 1, true);

    constructor(
        private readonly scene: Scene,
        private readonly particles: Particles,
        /** board half-extents — wave radius covers the full playable field */
        private readonly halfW: number,
        private readonly halfH: number,
    ) {
        this.waveGeo.rotateX(-Math.PI / 2);
        this.flashGeo.rotateX(-Math.PI / 2);
    }

    spawnFromEvents(events: readonly SimEvent[]): void {
        for (const e of events) {
            if (e.kind !== 'towerDebuff') continue;
            this.spawn(e);
        }
    }

    /** radius that reaches every board corner from (x, z), plus a little padding */
    private boardCoverRadius(x: number, z: number): number {
        const hw = this.halfW;
        const hh = this.halfH;
        return (
            Math.max(
                Math.hypot(x - -hw, z - -hh),
                Math.hypot(x - hw, z - -hh),
                Math.hypot(x - -hw, z - hh),
                Math.hypot(x - hw, z - hh),
            ) * 1.08
        );
    }

    /** highest ground under a disc so the flat flash clears hills on either side */
    private maxGroundUnderDisc(x: number, z: number, radius: number): number {
        let maxY = groundHeightAt(x, z);
        const rings = 3;
        const spokes = 8;
        for (let ring = 1; ring <= rings; ring++) {
            const r = (radius * ring) / rings;
            for (let s = 0; s < spokes; s++) {
                const ang = (s / spokes) * Math.PI * 2;
                const y = groundHeightAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
                if (y > maxY) maxY = y;
            }
        }
        return maxY;
    }

    private makeTeamMat(
        color: Color,
        extras: Record<string, { value: unknown }> = {},
        fragment: string,
    ): ShaderMaterial {
        return new ShaderMaterial({
            uniforms: {
                uFade: { value: 1 },
                uColor: { value: color.clone() },
                ...extras,
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: NormalBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vLocal;
                varying float vY;
                void main() {
                    vLocal = position.xz;
                    vY = position.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: fragment,
        });
    }

    private spawn(e: Extract<SimEvent, { kind: 'towerDebuff' }>): void {
        while (this.waves.length >= MAX_ACTIVE) {
            this.retireWave(this.waves[0]!);
            if (this.columns[0]) this.retireColumn(this.columns[0]);
            if (this.flashes[0]) this.retireFlash(this.flashes[0]);
        }

        const teamHex = colorForBattleTeam(e.team).hex;
        // same hue, lower value — easier to read on bright terrain
        const teamColor = new Color(teamHex).multiplyScalar(0.55);
        const darkHex = teamColor.getHex();
        const gy = groundHeightAt(e.x, e.z);
        const len = Math.hypot(e.x, e.z) || 1;
        const dir = new Vector2(-e.x / len, -e.z / len);

        // --- 10: ground flash (team tint) — scorch stamp is in game.ts ---
        const flashMat = this.makeTeamMat(
            teamColor,
            { uProgress: { value: 0 } },
            /* glsl */ `
                uniform float uFade;
                uniform vec3 uColor;
                uniform float uProgress;
                varying vec2 vLocal;
                void main() {
                    float r = length(vLocal);
                    float core = 1.0 - smoothstep(0.0, 0.55 + uProgress * 0.35, r);
                    float rim = smoothstep(0.35, 0.7, r) * (1.0 - smoothstep(0.7, 1.0, r));
                    // denser stamp — less see-through than the air wave
                    float a = (core * 0.95 + rim * 1.0) * uFade;
                    if (a < 0.03) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
                }
            `,
        );
        const flash = new Mesh(this.flashGeo, flashMat);
        const flashY = this.maxGroundUnderDisc(e.x, e.z, FLASH_MAX_RADIUS) + FLASH_CLEARANCE;
        flash.position.set(e.x, flashY, e.z);
        flash.scale.set(6, 1, 6);
        flash.frustumCulled = false;
        flash.renderOrder = 3;
        this.scene.add(flash);
        this.flashes.push({ mesh: flash, mat: flashMat, age: 0 });

        // --- 9: upward column that feeds the wave ---
        const colMat = this.makeTeamMat(
            teamColor,
            {},
            /* glsl */ `
                uniform float uFade;
                uniform vec3 uColor;
                varying vec2 vLocal;
                varying float vY;
                void main() {
                    float radial = 1.0 - smoothstep(0.35, 1.0, length(vLocal));
                    // brighter mid-height, soft tip
                    float along = 1.0 - abs(vY) * 1.6;
                    float a = radial * max(0.0, along) * uFade * 0.9;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
                }
            `,
        );
        const column = new Mesh(this.columnGeo, colMat);
        column.position.set(e.x, gy, e.z);
        column.scale.set(1.2, 0.01, 1.2);
        column.frustumCulled = false;
        column.renderOrder = 5;
        this.scene.add(column);
        this.columns.push({ mesh: column, mat: colMat, age: 0, groundY: gy });

        // --- spreading wave (starts after WAVE_DELAY) ---
        const waveMat = this.makeTeamMat(
            teamColor,
            {
                uProgress: { value: 0 },
                uWidth: { value: 0.022 },
                uDir: { value: dir },
                uStretch: { value: SIDEWAYS_STRETCH },
            },
            /* glsl */ `
                uniform float uProgress;
                uniform float uFade;
                uniform vec3 uColor;
                uniform float uWidth;
                uniform vec2 uDir;
                uniform float uStretch;
                varying vec2 vLocal;
                void main() {
                    vec2 d = normalize(uDir + 1e-5);
                    vec2 across = vec2(-d.y, d.x);
                    float along = abs(dot(vLocal, d));
                    float side = abs(dot(vLocal, across));
                    float r = length(vec2(along, side / uStretch));
                    float band = smoothstep(uProgress - uWidth, uProgress, r)
                        * (1.0 - smoothstep(uProgress, uProgress + uWidth * 1.15, r));
                    float wash = (1.0 - smoothstep(0.0, uProgress + 0.02, r))
                        * (0.55 + 0.45 * (1.0 - uProgress));
                    float lobe = 0.65 + 0.35 * smoothstep(-0.1, 0.4, abs(dot(normalize(vLocal + 1e-5), across)));
                    // angular breakup — petal gaps instead of a solid sheet
                    float ang = atan(vLocal.y, vLocal.x);
                    float petals = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(ang * 6.0), 1.4);
                    // thinner rim, slightly softer wash so the edge stays the focus
                    float a = (band * 1.05 * lobe + wash * 0.42) * petals * uFade;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
                }
            `,
        );
        const wave = new Mesh(this.waveGeo, waveMat);
        wave.position.set(e.x, e.y, e.z);
        wave.scale.set(0.01, 1, 0.01);
        wave.visible = false;
        wave.frustumCulled = false;
        wave.renderOrder = 4;
        this.scene.add(wave);
        this.waves.push({
            mesh: wave,
            mat: waveMat,
            age: 0,
            duration: WAVE_DURATION,
            maxRadius: this.boardCoverRadius(e.x, e.z),
        });

        // particles: upward spike first, then outward skirt
        this.particles.burst(e.x, gy + 1, e.z, {
            count: 50,
            color: darkHex,
            speed: 8,
            life: 0.7,
            up: 22,
        });
        this.particles.burst(e.x, e.y, e.z, {
            count: 70,
            color: 0x2a1828,
            speed: 22,
            life: 1.0,
            up: 5,
            blood: true,
        });
        this.particles.burst(e.x, e.y, e.z, {
            count: 60,
            color: darkHex,
            speed: 20,
            life: 0.9,
            up: 7,
        });
        this.particles.burst(e.x, e.y + 1.5, e.z, {
            count: 30,
            color: 0xffffff,
            speed: 10,
            life: 0.5,
            up: 12,
        });

        screenShake({
            intensity: 1.4 + e.level * 0.15,
            duration: 0.7,
            frequency: 32,
        });
    }

    update(dt: number): void {
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i]!;
            f.age += dt;
            const t = Math.min(1, f.age / FLASH_DURATION);
            const ease = 1 - (1 - t) * (1 - t);
            f.mesh.scale.set(6 + ease * 16, 1, 6 + ease * 16);
            f.mat.uniforms.uProgress!.value = ease;
            f.mat.uniforms.uFade!.value = Math.max(0, 1 - t * t * 0.85);
            if (t >= 1) this.retireFlash(f);
        }

        for (let i = this.columns.length - 1; i >= 0; i--) {
            const c = this.columns[i]!;
            c.age += dt;
            const riseT = Math.min(1, c.age / COLUMN_RISE);
            const riseEase = 1 - (1 - riseT) * (1 - riseT);
            const h = Math.max(0.05, COLUMN_HEIGHT * riseEase);
            // flare out slightly as it peaks, then thin while fading
            const fadeT = c.age < COLUMN_RISE ? 0 : Math.min(1, (c.age - COLUMN_RISE) / COLUMN_FADE);
            const radius = 1.4 + riseEase * 1.6 - fadeT * 2.2;
            c.mesh.scale.set(Math.max(0.15, radius), h, Math.max(0.15, radius));
            c.mesh.position.y = c.groundY + h * 0.5;
            c.mat.uniforms.uFade!.value = riseT < 1 ? 0.4 + riseT * 0.6 : 1 - fadeT;
            if (fadeT >= 1) this.retireColumn(c);
        }

        for (let i = this.waves.length - 1; i >= 0; i--) {
            const w = this.waves[i]!;
            w.age += dt;
            const local = w.age - WAVE_DELAY;
            if (local < 0) {
                w.mesh.visible = false;
                continue;
            }
            w.mesh.visible = true;
            const t = Math.min(1, local / w.duration);
            const ease = 1 - (1 - t) * (1 - t);
            const radius = Math.max(0.01, w.maxRadius * ease);
            w.mesh.scale.set(radius, 1, radius);
            w.mat.uniforms.uProgress!.value = ease * 0.98;
            w.mat.uniforms.uFade!.value = 1 - t * t * t;
            w.mat.uniforms.uWidth!.value = 0.016 + 0.014 * (1 - t);
            if (t >= 1) this.retireWave(w);
        }
    }

    clear(): void {
        while (this.waves.length > 0) this.retireWave(this.waves[0]!);
        while (this.columns.length > 0) this.retireColumn(this.columns[0]!);
        while (this.flashes.length > 0) this.retireFlash(this.flashes[0]!);
    }

    dispose(): void {
        this.clear();
        this.waveGeo.dispose();
        this.flashGeo.dispose();
        this.columnGeo.dispose();
    }

    private retireWave(w: Wave): void {
        const i = this.waves.indexOf(w);
        if (i >= 0) this.waves.splice(i, 1);
        this.scene.remove(w.mesh);
        w.mat.dispose();
    }

    private retireColumn(c: Column): void {
        const i = this.columns.indexOf(c);
        if (i >= 0) this.columns.splice(i, 1);
        this.scene.remove(c.mesh);
        c.mat.dispose();
    }

    private retireFlash(f: Flash): void {
        const i = this.flashes.indexOf(f);
        if (i >= 0) this.flashes.splice(i, 1);
        this.scene.remove(f.mesh);
        f.mat.dispose();
    }
}
