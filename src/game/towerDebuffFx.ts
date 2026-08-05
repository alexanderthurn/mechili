import {
    CircleGeometry,
    Color,
    DoubleSide,
    Mesh,
    NormalBlending,
    ShaderMaterial,
    Vector2,
    type Scene,
} from 'three';
import { colorForBattleTeam } from './colors';
import type { Particles } from './effects';
import { screenShake } from './screenShake';
import type { SimEvent } from './sim';

/** seconds for the ring to expand and fade */
const WAVE_DURATION = 1.15;
/** slight elliptical stretch (1 = circle) — wider “sideways” across the field */
const SIDEWAYS_STRETCH = 1.25;
const MAX_ACTIVE = 6;

type Wave = {
    mesh: Mesh;
    mat: ShaderMaterial;
    age: number;
    duration: number;
    maxRadius: number;
};

/**
 * Visual-only tower-loss shockwave: board-spanning sickly wash at half tower
 * height, plus ash/debris particle skirt.
 * Driven by {@link SimEvent} `towerDebuff` — never touches sim state.
 */
export class TowerDebuffFx {
    private readonly waves: Wave[] = [];
    private readonly geo = new CircleGeometry(1, 96);

    constructor(
        private readonly scene: Scene,
        private readonly particles: Particles,
        /** board half-extents — wave radius covers the full playable field */
        private readonly halfW: number,
        private readonly halfH: number,
    ) {
        this.geo.rotateX(-Math.PI / 2);
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

    private spawn(e: Extract<SimEvent, { kind: 'towerDebuff' }>): void {
        while (this.waves.length >= MAX_ACTIVE) this.retire(this.waves[0]!);

        const teamHex = colorForBattleTeam(e.team).hex;
        const teamColor = new Color(teamHex);
        // direction: from ruin toward map center (into the fight)
        const len = Math.hypot(e.x, e.z) || 1;
        const dir = new Vector2(-e.x / len, -e.z / len);

        const mat = new ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uFade: { value: 1 },
                uColor: { value: teamColor },
                uWidth: { value: 0.09 },
                uDir: { value: dir },
                uStretch: { value: SIDEWAYS_STRETCH },
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            // Normal (not additive) so team blue/red reads true under tone mapping
            blending: NormalBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vLocal;
                void main() {
                    vLocal = position.xz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
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
                    // thick leading front
                    float band = smoothstep(uProgress - uWidth, uProgress, r)
                        * (1.0 - smoothstep(uProgress, uProgress + uWidth * 1.6, r));
                    // board-filling wash behind the front
                    float wash = (1.0 - smoothstep(0.0, uProgress + 0.02, r))
                        * (0.55 + 0.45 * (1.0 - uProgress));
                    float lobe = 0.65 + 0.35 * smoothstep(-0.1, 0.4, abs(dot(normalize(vLocal + 1e-5), across)));
                    // alpha only — keep RGB = exact team color (no boost that shifts hue)
                    float a = (band * 0.95 * lobe + wash * 0.55) * uFade;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
                }
            `,
        });

        const mesh = new Mesh(this.geo, mat);
        // half tower height (sim emits altitude + half collider top) — clear of terrain
        mesh.position.set(e.x, e.y, e.z);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        this.scene.add(mesh);

        const maxRadius = this.boardCoverRadius(e.x, e.z);
        this.waves.push({
            mesh,
            mat,
            age: 0,
            duration: WAVE_DURATION,
            maxRadius,
        });

        // heavy ash / debris / team-color skirt
        const y = e.y;
        this.particles.burst(e.x, y, e.z, {
            count: 90,
            color: 0x2a1828,
            speed: 28,
            life: 1.1,
            up: 6,
            blood: true,
        });
        this.particles.burst(e.x, y, e.z, {
            count: 70,
            color: teamHex,
            speed: 24,
            life: 0.9,
            up: 8,
        });
        this.particles.burst(e.x, y, e.z, {
            count: 50,
            color: teamHex,
            speed: 18,
            life: 1.0,
            up: 5,
        });
        this.particles.burst(e.x, y + 1.5, e.z, {
            count: 40,
            color: 0xffffff,
            speed: 12,
            life: 0.55,
            up: 10,
        });

        screenShake({
            intensity: 1.4 + e.level * 0.15,
            duration: 0.7,
            frequency: 32,
        });
    }

    update(dt: number): void {
        for (let i = this.waves.length - 1; i >= 0; i--) {
            const w = this.waves[i]!;
            w.age += dt;
            const t = Math.min(1, w.age / w.duration);
            // ease-out expand — front reaches board edge near the end
            const ease = 1 - (1 - t) * (1 - t);
            const radius = Math.max(0.01, w.maxRadius * ease);
            w.mesh.scale.set(radius, 1, radius);
            w.mat.uniforms.uProgress!.value = ease * 0.98;
            w.mat.uniforms.uFade!.value = 1 - t * t * t;
            w.mat.uniforms.uWidth!.value = 0.06 + 0.05 * (1 - t);
            if (t >= 1) this.retire(w);
        }
    }

    clear(): void {
        while (this.waves.length > 0) this.retire(this.waves[0]!);
    }

    dispose(): void {
        this.clear();
        this.geo.dispose();
    }

    private retire(w: Wave): void {
        const i = this.waves.indexOf(w);
        if (i >= 0) this.waves.splice(i, 1);
        this.scene.remove(w.mesh);
        w.mat.dispose();
    }
}
