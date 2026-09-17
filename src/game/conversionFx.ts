import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    DoubleSide,
    DynamicDrawUsage,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    PlaneGeometry,
    Quaternion,
    RepeatWrapping,
    SRGBColorSpace,
    ShaderMaterial,
    TextureLoader,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorForUnit } from './colors';
import type { BloomQuality } from './prefs';
import { isSecondarySeat, type SeatDef } from './seats';
import { actorSeat, actorTeam, type Actor } from './sim';
import { attackNodeWorld, getUnitAttackNodeLocal } from './unitModels';
import { projectileAimY } from './units';
import { THEME } from '../theme';
import { assetUrl } from './assets';

const MAX_CONVERT = 64;
const MAX_PRISM = 48;
/** half-width of each lightning card (world units before instance scale) */
const CORE_HALF_W = 0.28;
const GLOW_HALF_W = 0.55;
const TEX_URL = (): string => assetUrl('textures/fx/convert-ray-lightning.png');

const _pos = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _mat = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _axis = new Vector3();
const _color = new Color();
const _color2 = new Color();
const _white = new Color(0xffffff);
const _orb = new Color(THEME.projectileOrb);

const _sunCore = new Color(0xffff66);
const _skyCore = new Color(0xfff25a);

/** Soft god-ray from above into the prism (world units). */
const PRISM_SKY_H = 440;
/** Attack beam matches the previous sky look (soft sunlight pipe). */
const PRISM_ATTACK_W = 3.2;
const PRISM_ATTACK_HDR = 1.85;
/** Sky shaft: much wider / much fainter than the attack pipe. */
const PRISM_SKY_W = PRISM_ATTACK_W * 27;
const PRISM_SKY_HDR = PRISM_ATTACK_HDR / 50;

/**
 * Crossed cards along +Y (beam length). More planes ≈ rounder pipe from the
 * side; 2 is enough for the wizard bolt, prism uses more so the sky shaft
 * doesn't go paper-thin when the camera catches a card edge-on.
 */
function makeBeamCardGeo(halfWidth: number, vRepeat: number, planes = 2): BufferGeometry {
    const mk = (): PlaneGeometry => {
        const g = new PlaneGeometry(halfWidth * 2, 1, 1, 4);
        g.translate(0, 0.5, 0);
        const uv = g.attributes.uv;
        if (uv) {
            for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i)! * vRepeat);
            uv.needsUpdate = true;
        }
        return g;
    };
    const count = Math.max(2, Math.floor(planes));
    const parts: PlaneGeometry[] = [];
    for (let i = 0; i < count; i++) {
        const g = mk();
        g.rotateY((i * Math.PI) / count);
        parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) throw new Error('[conversionFx] failed to merge beam cards');
    return merged;
}

/** Stable +Y → dir rotation (setFromUnitVectors alone blows up when nearly parallel). */
function quatFromUpTo(dir: Vector3, out: Quaternion): void {
    const d = dir.dot(_up);
    if (d > 0.999) {
        out.identity();
        return;
    }
    if (d < -0.999) {
        out.setFromAxisAngle(_axis.set(1, 0, 0), Math.PI);
        return;
    }
    out.setFromUnitVectors(_up, dir);
}

/** Beam muzzle for FX (interpolated xz) — matches sim {@link beamRayOrigin} policy. */
function beamFxOrigin(caster: Actor): { x: number; y: number; z: number } {
    const ut = caster.unit.type;
    const authored = ut.rampBeam?.muzzleLocal;
    if (authored) {
        return attackNodeWorld(
            authored,
            caster.rx,
            caster.footY,
            caster.rz,
            caster.mesh.rotation.y,
            ut.meshScale,
        );
    }
    const modelKey = ut.modelId ?? ut.id;
    const local = getUnitAttackNodeLocal(modelKey);
    if (local) {
        return attackNodeWorld(
            local,
            caster.rx,
            caster.footY,
            caster.rz,
            caster.mesh.rotation.y,
            ut.meshScale,
        );
    }
    return {
        x: caster.rx,
        y: caster.footY + Math.max(1.6, ut.meshScale * 1.15),
        z: caster.rz,
    };
}

type RayLayer = {
    core: InstancedMesh;
    glow: InstancedMesh;
    coreMat: MeshBasicMaterial;
    glowMat: MeshBasicMaterial;
    glowWidthMul: number;
};

/**
 * Procedural sunlight pipe — same noise family as ground fire tongues, but
 * shaped as a continuous yellow beam (no lightning PNG).
 */
const PRISM_VERT = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vColor;
    void main() {
        vUv = uv;
        // InstancedMesh.setColorAt — Three already declares instanceColor.
        #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
        #else
            vColor = vec3(1.0);
        #endif
        vec4 world = instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * world;
    }
`;

const PRISM_FRAG = /* glsl */ `
    uniform float uTime;
    uniform float uGain;
    varying vec2 vUv;
    varying vec3 vColor;

    float fHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float fNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x),
            mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x),
            f.y
        );
    }

    void main() {
        // Scroll opposite the wizard bolt; dense along-beam fire churn.
        float t = uTime * 1.55;
        vec2 nUv = vec2(vUv.x * 2.6, vUv.y * 14.0 + t);
        float n = fNoise(nUv) * 0.6 + fNoise(nUv * 2.4 + 9.3) * 0.4;

        float r = abs(vUv.x - 0.5) * 2.0;
        // Soft pipe: bright core, thin luminous rim, hard cut at the edge.
        float core = smoothstep(0.68, 0.0, r);
        float sheath = smoothstep(1.0, 0.22, r);
        float body = sheath * (0.4 + 0.6 * core);
        body *= 0.78 + 0.28 * n;
        if (body < 0.03) discard;

        // White-hot center → bright yellow → warm fringe.
        vec3 hot = vec3(1.35, 1.28, 0.95);
        vec3 mid = vec3(1.15, 1.05, 0.12);
        vec3 edge = vec3(1.05, 0.55, 0.04);
        vec3 col = mix(edge, mid, core);
        col = mix(col, hot, core * core * (0.55 + 0.45 * n));
        col *= vColor * (1.35 + 0.4 * n) * uGain;

        gl_FragColor = vec4(col, body);
    }
`;

function placeOnLayer(
    layer: RayLayer,
    n: number,
    ox: number,
    oy: number,
    oz: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    len: number,
    width: number,
    core: Color,
    glow: Color,
    coreHdr: number,
    glowHdr: number,
): void {
    _pos.set(ox, oy, oz);
    _dir.set(dirX, dirY, dirZ);
    quatFromUpTo(_dir, _quat);
    _scale.set(width, len, width);
    _mat.compose(_pos, _quat, _scale);
    layer.core.setMatrixAt(n, _mat);
    _scale.set(width * layer.glowWidthMul, len, width * layer.glowWidthMul);
    _mat.compose(_pos, _quat, _scale);
    layer.glow.setMatrixAt(n, _mat);
    _color.copy(core).multiplyScalar(coreHdr);
    layer.core.setColorAt(n, _color);
    _color2.copy(glow).multiplyScalar(glowHdr);
    layer.glow.setColorAt(n, _color2);
}

function placePrismPipe(
    mesh: InstancedMesh,
    n: number,
    ox: number,
    oy: number,
    oz: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    len: number,
    width: number,
    tint: Color,
    hdr: number,
): void {
    _pos.set(ox, oy, oz);
    _dir.set(dirX, dirY, dirZ);
    quatFromUpTo(_dir, _quat);
    _scale.set(width, len, width);
    _mat.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(n, _mat);
    _color.copy(tint).multiplyScalar(hdr);
    mesh.setColorAt(n, _color);
}

function finishLayer(layer: RayLayer, n: number): void {
    layer.core.count = n;
    layer.glow.count = n;
    layer.core.instanceMatrix.needsUpdate = true;
    layer.glow.instanceMatrix.needsUpdate = true;
    if (layer.core.instanceColor) layer.core.instanceColor.needsUpdate = true;
    if (layer.glow.instanceColor) layer.glow.instanceColor.needsUpdate = true;
}

/**
 * Sustained conversion beams — textured lightning cards + soft glow.
 * Prism ramp beams use a procedural yellow fire-pipe shader (no lightning PNG).
 */
export class ConversionFx {
    private readonly group = new Group();
    private readonly convert: RayLayer;
    private readonly prismMesh: InstancedMesh;
    private readonly prismMat: ShaderMaterial;
    private readonly texture: Texture;
    private bloomBoost = 1;
    private bloom: BloomQuality = 'off';
    roster: SeatDef[] = [];

    constructor(scene: Scene) {
        this.texture = new TextureLoader().load(TEX_URL());
        this.texture.colorSpace = SRGBColorSpace;
        this.texture.wrapS = RepeatWrapping;
        this.texture.wrapT = RepeatWrapping;
        this.texture.repeat.set(1, 1);

        this.convert = this.makeLayer(this.texture, 0xa8f7ff, MAX_CONVERT);

        this.prismMat = new ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uGain: { value: 1 },
            },
            vertexShader: PRISM_VERT,
            fragmentShader: PRISM_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false,
        });
        // 6 radial cards ≈ pipe from every yaw (2 cards go paper-thin edge-on).
        this.prismMesh = new InstancedMesh(makeBeamCardGeo(CORE_HALF_W, 1, 6), this.prismMat, MAX_PRISM);
        this.prismMesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.prismMesh.frustumCulled = false;
        this.prismMesh.count = 0;
        this.prismMesh.renderOrder = 50;
        for (let i = 0; i < MAX_PRISM; i++) this.prismMesh.setColorAt(i, _sunCore);
        this.group.add(this.prismMesh);

        scene.add(this.group);
    }

    private makeLayer(map: Texture, glowHex: number, max: number): RayLayer {
        const coreMat = new MeshBasicMaterial({
            map,
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false,
        });
        const glowMat = new MeshBasicMaterial({
            map,
            color: glowHex,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false,
        });
        const core = new InstancedMesh(makeBeamCardGeo(CORE_HALF_W, 2.5), coreMat, max);
        const glow = new InstancedMesh(makeBeamCardGeo(GLOW_HALF_W, 1.8), glowMat, max);
        for (const mesh of [core, glow]) {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.count = 0;
            mesh.renderOrder = 50;
            this.group.add(mesh);
        }
        for (let i = 0; i < max; i++) {
            core.setColorAt(i, _white);
            glow.setColorAt(i, _orb);
        }
        return { core, glow, coreMat, glowMat, glowWidthMul: 1.85 };
    }

    /**
     * When bloom is on, raise beam HDR / widen the glow card so the ray gets a
     * real screen-space halo (the soft look with bloom off is just additive cards).
     */
    setBloomComp(bloom: BloomQuality): void {
        this.bloom = bloom;
        if (bloom === 'off') {
            this.bloomBoost = 1;
            this.convert.glowWidthMul = 1.85;
            this.convert.coreMat.color.setRGB(1, 1, 1);
            this.convert.glowMat.color.setRGB(0.66, 0.97, 1);
            this.prismMat.uniforms.uGain!.value = 1.25;
            return;
        }
        if (bloom === 'high') {
            this.bloomBoost = 2.1;
            this.convert.glowWidthMul = 2.35;
            this.prismMat.uniforms.uGain!.value = 1.65;
        } else {
            // ultra — push HDR so selective bloom wraps the pipe in a yellow halo
            this.bloomBoost = 2.6;
            this.convert.glowWidthMul = 2.55;
            this.prismMat.uniforms.uGain!.value = 2.15;
        }
        const b = this.bloomBoost;
        this.convert.coreMat.color.setRGB(b, b, b);
        this.convert.glowMat.color.setRGB(0.66 * b, 0.97 * b, 1 * b);
    }

    /**
     * Draw convert + prism beams. Prism uses the fire-pipe shader.
     * `simTime` is battle elapsed seconds so scroll/pulse freeze when the sim pauses.
     */
    update(actors: readonly Actor[], simTime = 0): void {
        this.texture.offset.y = (simTime * 1.8) % 1;
        this.prismMat.uniforms.uTime!.value = simTime;

        const pulse = 0.92 + 0.08 * Math.sin(simTime * 12);
        this.convert.coreMat.opacity = pulse;
        this.convert.glowMat.opacity = (0.55 + 0.2 * pulse) * (this.bloomBoost > 1 ? 0.85 : 1);

        let cn = 0;
        let pn = 0;
        for (const caster of actors) {
            if (!caster.alive || !caster.convertRayActive) continue;
            const isRamp = !!caster.unit.type.rampBeam;
            const isConvert = !!caster.unit.type.convertRay;
            if (!isRamp && !isConvert) continue;

            const from = beamFxOrigin(caster);

            if (isRamp) {
                const bloomOn = this.bloom !== 'off';
                const bloomUltra = this.bloom === 'ultra';
                if (pn < MAX_PRISM) {
                    const skyPulse = 0.88 + 0.12 * Math.sin(simTime * 2.2 + caster.index);
                    const skyW = PRISM_SKY_W * skyPulse;
                    const skyHdr =
                        PRISM_SKY_HDR * (bloomUltra ? 1.35 : bloomOn ? 1.15 : 1);
                    placePrismPipe(
                        this.prismMesh,
                        pn++,
                        from.x,
                        from.y + PRISM_SKY_H,
                        from.z,
                        0,
                        -1,
                        0,
                        PRISM_SKY_H,
                        skyW,
                        _skyCore,
                        skyHdr,
                    );
                }

                const victims =
                    caster.rampBeamTargets?.length > 0
                        ? caster.rampBeamTargets
                        : caster.rampBeamTarget
                          ? [caster.rampBeamTarget]
                          : [];
                const atkPulse = 0.88 + 0.12 * Math.sin(simTime * 2.2 + caster.index);
                const atkW = PRISM_ATTACK_W * atkPulse;
                const atkHdr =
                    PRISM_ATTACK_HDR * (bloomUltra ? 1.35 : bloomOn ? 1.15 : 1);
                for (let vi = 0; vi < victims.length; vi++) {
                    const victim = victims[vi]!;
                    if (!victim.alive) continue;
                    const vt = victim.unit.type;
                    const toY = victim.footY + projectileAimY(vt) * vt.meshScale;
                    _dir.set(victim.rx - from.x, toY - from.y, victim.rz - from.z);
                    const len = Math.max(_dir.length(), 0.35);
                    _dir.multiplyScalar(1 / len);
                    if (pn < MAX_PRISM) {
                        placePrismPipe(
                            this.prismMesh,
                            pn++,
                            from.x,
                            from.y,
                            from.z,
                            _dir.x,
                            _dir.y,
                            _dir.z,
                            len,
                            atkW,
                            _skyCore,
                            atkHdr,
                        );
                    }
                }
                continue;
            }

            const victims =
                caster.convertTargets?.length > 0
                    ? caster.convertTargets
                    : caster.convertTarget
                      ? [caster.convertTarget]
                      : [null];

            const team = actorTeam(caster);
            const seat = actorSeat(caster);
            const teamHex = colorForUnit(team, isSecondarySeat(this.roster, seat)).hex;

            for (let vi = 0; vi < victims.length; vi++) {
                if (cn >= MAX_CONVERT) break;
                const victim = victims[vi];
                if (victim?.alive && victim.convertBy === caster) {
                    const vt = victim.unit.type;
                    const toY = victim.footY + projectileAimY(vt) * vt.meshScale;
                    _dir.set(victim.rx - from.x, toY - from.y, victim.rz - from.z);
                } else if (vi === 0) {
                    _dir.set(
                        caster.convertRayTipX - from.x,
                        caster.convertRayTipY - from.y,
                        caster.convertRayTipZ - from.z,
                    );
                } else if (victim?.alive) {
                    const vt = victim.unit.type;
                    const toY = victim.footY + projectileAimY(vt) * vt.meshScale;
                    _dir.set(victim.rx - from.x, toY - from.y, victim.rz - from.z);
                } else {
                    continue;
                }
                const len = Math.max(_dir.length(), 0.35);
                _dir.multiplyScalar(1 / len);
                const width = 1.05 + 0.12 * Math.sin(simTime * 10 + caster.index + vi);
                _color.setHex(teamHex).lerp(_orb, 0.5);
                placeOnLayer(
                    this.convert,
                    cn++,
                    from.x,
                    from.y,
                    from.z,
                    _dir.x,
                    _dir.y,
                    _dir.z,
                    len,
                    width,
                    _white,
                    _color,
                    1,
                    1,
                );
            }
        }
        finishLayer(this.convert, cn);
        this.prismMesh.count = pn;
        this.prismMesh.instanceMatrix.needsUpdate = true;
        if (this.prismMesh.instanceColor) this.prismMesh.instanceColor.needsUpdate = true;
    }

    clear(): void {
        this.convert.core.count = 0;
        this.convert.glow.count = 0;
        this.prismMesh.count = 0;
    }

    dispose(): void {
        this.group.removeFromParent();
        this.convert.core.geometry.dispose();
        this.convert.glow.geometry.dispose();
        this.convert.coreMat.dispose();
        this.convert.glowMat.dispose();
        this.prismMesh.geometry.dispose();
        this.prismMat.dispose();
        this.texture.dispose();
    }
}
