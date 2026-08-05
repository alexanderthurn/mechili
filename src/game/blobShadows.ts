import {
    CanvasTexture,
    CircleGeometry,
    DoubleSide,
    InstancedMesh,
    MeshBasicMaterial,
    Object3D,
    Vector3,
    type Object3D as Obj3D,
    type Scene,
} from 'three';
import { groundHeightAt, worldHeightAt } from './map';

export interface BlobShadowSource {
    x: number;
    z: number;
    /** world-space radius of the dark disc */
    radius: number;
}

const MAX_BLOBS = 2048;
const MAX_TREE_BLOBS = 6144;
const _dummy = new Object3D();
const _normal = new Vector3();
const _up = new Vector3(0, 1, 0);
const _sun = new Vector3();

/**
 * Terrain normal from central differences of the static height field.
 * `h` is the sample half-step — roughly the disc radius so the tilt matches
 * the slope under the whole disc, not a single point.
 */
function terrainNormalAt(x: number, z: number, h: number, out: Vector3): Vector3 {
    const dx = groundHeightAt(x + h, z) - groundHeightAt(x - h, z);
    const dz = groundHeightAt(x, z + h) - groundHeightAt(x, z - h);
    return out.set(-dx, 2 * h, -dz).normalize();
}

function worldNormalAt(x: number, z: number, h: number, out: Vector3): Vector3 {
    const dx = worldHeightAt(x + h, z) - worldHeightAt(x - h, z);
    const dz = worldHeightAt(x, z + h) - worldHeightAt(x, z - h);
    return out.set(-dx, 2 * h, -dz).normalize();
}

function softBlobTexture(): CanvasTexture {
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    // Soft black disc — keep center mild so clustered trees don't stack to pitch.
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

/**
 * Cheap contact shadows for the Low tier — dark discs on the ground, no shadow-map pass.
 */
export class BlobShadows {
    private readonly mesh: InstancedMesh;

    constructor(scene: Scene) {
        const geo = new CircleGeometry(1, 20);
        geo.rotateX(-Math.PI / 2);
        const mat = new MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            side: DoubleSide,
        });
        this.mesh = new InstancedMesh(geo, mat, MAX_BLOBS);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    setEnabled(on: boolean): void {
        this.mesh.visible = on;
        if (!on) this.mesh.count = 0;
    }

    sync(sources: readonly BlobShadowSource[]): void {
        if (!this.mesh.visible) return;
        let i = 0;
        for (const s of sources) {
            if (i >= MAX_BLOBS) break;
            const y = groundHeightAt(s.x, s.z) + 0.05;
            _dummy.position.set(s.x, y, s.z);
            // lay the disc on the slope: rotate its up-axis onto the terrain normal
            terrainNormalAt(s.x, s.z, Math.max(0.5, s.radius), _normal);
            _dummy.quaternion.setFromUnitVectors(_up, _normal);
            // slight stretch away from the sun (matches the scene's key light direction)
            _dummy.scale.set(s.radius * 1.35, 1, s.radius * 1.05);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(i++, _dummy.matrix);
        }
        this.mesh.count = i;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as MeshBasicMaterial).dispose();
        this.mesh.removeFromParent();
    }
}

/**
 * Soft contact ellipses under far billboard trees. Stretch + offset follow the
 * live sun so dawn/dusk cast longer shadows without baking into the PNG.
 */
export class BillboardTreeShadows {
    private mesh: InstancedMesh | null = null;
    private sources: BlobShadowSource[] = [];
    private readonly parent: Obj3D;
    private readonly softMap = softBlobTexture();
    private lastKey = '';

    constructor(parent: Obj3D) {
        this.parent = parent;
    }

    /** Replace all registered billboard footprints (call after placement / LOD). */
    setSources(sources: readonly BlobShadowSource[]): void {
        const next = sources.length > MAX_TREE_BLOBS ? sources.slice(0, MAX_TREE_BLOBS) : sources.slice();
        const need = next.length;
        const cap = this.mesh?.instanceMatrix.count ?? 0;
        if (!this.mesh || need > cap) {
            this.sources = next;
            this.rebuild(Math.max(need, 1));
        } else {
            this.sources = next;
        }
        this.lastKey = '';
    }

    /**
     * Relayout ellipses from the directional sun. Cheap when the sun hasn't moved.
     * @param sunPos — light position (same space as DirectionalLight.position)
     * @param sunIntensity — fades blobs at night / overcast
     */
    update(sunPos: Vector3, sunIntensity: number): void {
        if (!this.mesh || this.sources.length === 0) return;

        _sun.copy(sunPos);
        const elev = Math.max(0, _sun.y);
        const horiz = Math.hypot(_sun.x, _sun.z);
        // night / below-horizon → hide; low sun → long stretch
        const day = Math.min(1, elev / 35) * Math.min(1, sunIntensity / 0.35);
        const mat = this.mesh.material as MeshBasicMaterial;
        mat.opacity = 0.85 * day;
        this.mesh.visible = day > 0.04;
        if (!this.mesh.visible) return;

        const key = `${_sun.x.toFixed(1)},${_sun.y.toFixed(1)},${_sun.z.toFixed(1)},${day.toFixed(2)}`;
        if (key === this.lastKey) return;
        this.lastKey = key;

        // Cast direction on the ground = opposite of sun's horizontal bearing
        let castX = 0;
        let castZ = 1;
        if (horiz > 1e-3) {
            castX = -_sun.x / horiz;
            castZ = -_sun.z / horiz;
        }
        const yaw = Math.atan2(castX, castZ);
        // noon (high elev) ≈ round; dawn/dusk stretch up to ~3×
        const elev01 = Math.min(1, elev / 200);
        const stretch = 1.15 + (1 - elev01) * 2.4;

        let i = 0;
        for (const s of this.sources) {
            const width = s.radius * 0.82;
            const length = s.radius * stretch;
            const ox = castX * (length - width) * 0.42;
            const oz = castZ * (length - width) * 0.42;
            const x = s.x + ox;
            const z = s.z + oz;
            const y = worldHeightAt(x, z) + 0.06;
            _dummy.position.set(x, y, z);
            worldNormalAt(x, z, Math.max(0.6, s.radius), _normal);
            _dummy.quaternion.setFromUnitVectors(_up, _normal);
            _dummy.rotateY(yaw);
            _dummy.scale.set(width, 1, length);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(i++, _dummy.matrix);
        }
        this.mesh.count = i;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    dispose(): void {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            (this.mesh.material as MeshBasicMaterial).dispose();
            this.mesh.removeFromParent();
            this.mesh = null;
        }
        this.softMap.dispose();
        this.sources = [];
    }

    private rebuild(capacity = this.sources.length): void {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            (this.mesh.material as MeshBasicMaterial).map = null;
            (this.mesh.material as MeshBasicMaterial).dispose();
            this.mesh.removeFromParent();
            this.mesh = null;
        }
        if (capacity < 1 && this.sources.length === 0) return;
        const n = Math.max(capacity, this.sources.length, 1);

        const geo = new CircleGeometry(1, 24);
        geo.rotateX(-Math.PI / 2);
        const mat = new MeshBasicMaterial({
            map: this.softMap,
            color: 0x000000,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            side: DoubleSide,
        });
        this.mesh = new InstancedMesh(geo, mat, n);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.mesh.count = 0;
        this.parent.add(this.mesh);
    }
}
