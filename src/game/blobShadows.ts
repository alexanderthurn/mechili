import {
    CircleGeometry,
    DoubleSide,
    InstancedMesh,
    MeshBasicMaterial,
    Object3D,
    Vector3,
    type Scene,
} from 'three';
import { groundHeightAt } from './map';

export interface BlobShadowSource {
    x: number;
    z: number;
    /** world-space radius of the dark disc */
    radius: number;
}

const MAX_BLOBS = 2048;
const _dummy = new Object3D();
const _normal = new Vector3();
const _up = new Vector3(0, 1, 0);

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
