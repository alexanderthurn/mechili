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
    TextureLoader,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorForUnit } from './colors';
import { isSecondarySeat, type SeatDef } from './seats';
import { actorSeat, actorTeam, type Actor } from './sim';
import { attackNodeWorld, getUnitAttackNodeLocal } from './unitModels';
import { projectileAimY } from './units';
import { THEME } from '../theme';

const MAX_RAYS = 64;
/** half-width of each lightning card (world units before instance scale) */
const CORE_HALF_W = 0.28;
const GLOW_HALF_W = 0.55;
const TEX_URL = new URL('../../assets/textures/fx/convert-ray-lightning.png', import.meta.url).href;

const _pos = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _mat = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _axis = new Vector3();
const _color = new Color();
const _white = new Color(0xffffff);
const _orb = new Color(THEME.projectileOrb);

/**
 * Two planes crossed at 90° along +Y (beam length). The convert texture is a
 * flat bolt sprite — a tube wraps it into mush; crossed cards read from every
 * camera angle (DoubleSide).
 */
function makeBeamCardGeo(halfWidth: number, vRepeat: number): BufferGeometry {
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
    const a = mk();
    const b = mk();
    b.rotateY(Math.PI / 2);
    const merged = mergeGeometries([a, b], false);
    a.dispose();
    b.dispose();
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

/**
 * Sustained conversion beams — textured lightning cards + soft glow.
 * Visual-only; sim owns progress / allegiance.
 */
export class ConversionFx {
    private readonly group = new Group();
    private readonly core: InstancedMesh;
    private readonly glow: InstancedMesh;
    private readonly coreMat: MeshBasicMaterial;
    private readonly glowMat: MeshBasicMaterial;
    private readonly texture: Texture;
    roster: SeatDef[] = [];

    constructor(scene: Scene) {
        this.texture = new TextureLoader().load(TEX_URL);
        this.texture.colorSpace = SRGBColorSpace;
        this.texture.wrapS = RepeatWrapping;
        this.texture.wrapT = RepeatWrapping;
        this.texture.repeat.set(1, 1);

        this.coreMat = new MeshBasicMaterial({
            map: this.texture,
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false, // keep lightning bright under ACES
        });
        this.glowMat = new MeshBasicMaterial({
            map: this.texture,
            color: 0xa8f7ff,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            depthTest: true,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false,
        });

        this.core = new InstancedMesh(makeBeamCardGeo(CORE_HALF_W, 2.5), this.coreMat, MAX_RAYS);
        this.glow = new InstancedMesh(makeBeamCardGeo(GLOW_HALF_W, 1.8), this.glowMat, MAX_RAYS);
        for (const mesh of [this.core, this.glow]) {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.count = 0;
            mesh.renderOrder = 50;
            this.group.add(mesh);
        }
        for (let i = 0; i < MAX_RAYS; i++) {
            this.core.setColorAt(i, _white);
            this.glow.setColorAt(i, _orb);
        }
        scene.add(this.group);
    }

    /**
     * Draw a beam from every living caster with an active convert ray.
     * Tip comes from the sim (`convertRayTip*`) so ward blocks clip the beam.
     * Origin prefers GLB `AttackNode` (else chest height); uses interpolated rx/rz.
     * `simTime` is battle elapsed seconds so scroll/pulse freeze when the sim pauses.
     */
    update(actors: readonly Actor[], simTime = 0): void {
        // scroll lightning along the beam (sim clock — not wall clock)
        this.texture.offset.y = (simTime * 1.8) % 1;

        const pulse = 0.92 + 0.08 * Math.sin(simTime * 12);
        this.coreMat.opacity = pulse;
        this.glowMat.opacity = 0.55 + 0.2 * pulse;

        let n = 0;
        for (const caster of actors) {
            if (n >= MAX_RAYS) break;
            if (!caster.alive || !caster.convertRayActive || !caster.unit.type.convertRay) continue;

            const ut = caster.unit.type;
            const modelKey = ut.modelId ?? ut.id;
            const local = getUnitAttackNodeLocal(modelKey);
            const from = local
                ? attackNodeWorld(
                      local,
                      caster.rx,
                      caster.footY,
                      caster.rz,
                      caster.mesh.rotation.y,
                      ut.meshScale,
                  )
                : {
                      x: caster.rx,
                      y: caster.footY + Math.max(1.6, ut.meshScale * 1.15),
                      z: caster.rz,
                  };
            _pos.set(from.x, from.y, from.z);
            const victim = caster.convertTarget;
            // unblocked: stick tip to the victim mesh; blocked: sim tip on the ward skin
            if (victim?.alive && victim.convertBy === caster) {
                const vt = victim.unit.type;
                const toY = victim.footY + projectileAimY(vt) * vt.meshScale;
                _dir.set(victim.rx - from.x, toY - from.y, victim.rz - from.z);
            } else {
                _dir.set(
                    caster.convertRayTipX - from.x,
                    caster.convertRayTipY - from.y,
                    caster.convertRayTipZ - from.z,
                );
            }
            const len = Math.max(_dir.length(), 0.35);
            _dir.multiplyScalar(1 / len);
            quatFromUpTo(_dir, _quat);

            const width = 1.05 + 0.12 * Math.sin(simTime * 10 + caster.index);
            _scale.set(width, len, width);
            _mat.compose(_pos, _quat, _scale);
            this.core.setMatrixAt(n, _mat);

            _scale.set(width * 1.85, len, width * 1.85);
            _mat.compose(_pos, _quat, _scale);
            this.glow.setMatrixAt(n, _mat);

            const team = actorTeam(caster);
            const seat = actorSeat(caster);
            _color.setHex(colorForUnit(team, isSecondarySeat(this.roster, seat)).hex);
            this.core.setColorAt(n, _white);
            this.glow.setColorAt(n, _color.lerp(_orb, 0.5));
            n++;
        }
        this.core.count = n;
        this.glow.count = n;
        this.core.instanceMatrix.needsUpdate = true;
        this.glow.instanceMatrix.needsUpdate = true;
        if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
        if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    }

    clear(): void {
        this.core.count = 0;
        this.glow.count = 0;
    }

    dispose(): void {
        this.group.removeFromParent();
        this.core.geometry.dispose();
        this.glow.geometry.dispose();
        this.coreMat.dispose();
        this.glowMat.dispose();
        this.texture.dispose();
    }
}
