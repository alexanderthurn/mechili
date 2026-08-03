import {
    AdditiveBlending,
    Color,
    CylinderGeometry,
    DoubleSide,
    DynamicDrawUsage,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { colorForUnit } from './colors';
import { isSecondarySeat, type SeatDef } from './seats';
import { actorSeat, actorTeam, type Actor } from './sim';
import { THEME } from '../theme';

const MAX_RAYS = 64;
/** world-space tube radius before instance width scale */
const CORE_RADIUS = 0.42;
const GLOW_RADIUS = 0.95;
const TEX_URL = new URL('../../assets/textures/fx/convert-ray-lightning.png', import.meta.url).href;

const _pos = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _mat = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _color = new Color();
const _white = new Color(0xffffff);
const _orb = new Color(THEME.projectileOrb);

function makeBeamGeo(radius: number, vRepeat: number): CylinderGeometry {
    const geo = new CylinderGeometry(radius, radius * 1.15, 1, 10, 6, true);
    geo.translate(0, 0.5, 0);
    const uv = geo.attributes.uv;
    if (uv) {
        for (let i = 0; i < uv.count; i++) {
            // V along the beam; multiply so the lightning tiles along long shots
            uv.setY(i, uv.getY(i) * vRepeat);
        }
        uv.needsUpdate = true;
    }
    return geo;
}

/**
 * Sustained conversion beams — textured lightning tube + soft glow.
 * Visual-only; sim owns progress / allegiance.
 */
export class ConversionFx {
    private readonly group = new Group();
    private readonly core: InstancedMesh;
    private readonly glow: InstancedMesh;
    private readonly coreMat: MeshBasicMaterial;
    private readonly glowMat: MeshBasicMaterial;
    private readonly texture: Texture;
    private readonly t0 = performance.now();
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
            depthTest: false,
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
            depthTest: false,
            side: DoubleSide,
            blending: AdditiveBlending,
            fog: false,
            toneMapped: false,
        });

        this.core = new InstancedMesh(makeBeamGeo(CORE_RADIUS, 2.5), this.coreMat, MAX_RAYS);
        this.glow = new InstancedMesh(makeBeamGeo(GLOW_RADIUS, 1.8), this.glowMat, MAX_RAYS);
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
     * Uses interpolated rx/rz for the caster origin so the ray sticks to meshes.
     */
    update(actors: readonly Actor[]): void {
        const t = (performance.now() - this.t0) * 0.001;
        // scroll lightning along the beam
        this.texture.offset.y = (t * 1.8) % 1;

        const pulse = 0.92 + 0.08 * Math.sin(t * 12);
        this.coreMat.opacity = pulse;
        this.glowMat.opacity = 0.55 + 0.2 * pulse;

        let n = 0;
        for (const caster of actors) {
            if (n >= MAX_RAYS) break;
            if (!caster.alive || !caster.convertRayActive || !caster.unit.type.convertRay) continue;

            const fromY = caster.footY + Math.max(1.6, caster.unit.type.meshScale * 1.15);
            _pos.set(caster.rx, fromY, caster.rz);
            const victim = caster.convertTarget;
            // unblocked: stick tip to the victim mesh; blocked: sim tip on the ward skin
            if (victim?.alive && victim.convertBy === caster) {
                const toY = victim.footY + Math.max(1.0, victim.unit.type.meshScale * 0.9);
                _dir.set(victim.rx - caster.rx, toY - fromY, victim.rz - caster.rz);
            } else {
                _dir.set(
                    caster.convertRayTipX - caster.rx,
                    caster.convertRayTipY - fromY,
                    caster.convertRayTipZ - caster.rz,
                );
            }
            const len = Math.max(_dir.length(), 0.35);
            _dir.multiplyScalar(1 / len);
            _quat.setFromUnitVectors(_up, _dir);

            const width = 1.05 + 0.12 * Math.sin(t * 10 + caster.index);
            _scale.set(width, len, width);
            _mat.compose(_pos, _quat, _scale);
            this.core.setMatrixAt(n, _mat);

            _scale.set(width * 1.9, len, width * 1.9);
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
