import {
    DynamicDrawUsage,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    SphereGeometry,
    type Scene,
} from 'three';
import type { Projectile } from './sim';

const MAX_PROJECTILES = 512;

/** Draws the sim's bullets as one instanced mesh (a single draw call). */
export class ProjectileRenderer {
    private readonly mesh: InstancedMesh;
    private readonly matrix = new Matrix4();

    constructor(scene: Scene) {
        this.mesh = new InstancedMesh(
            new SphereGeometry(0.28, 6, 5),
            new MeshBasicMaterial({ color: 0xffd980 }),
            MAX_PROJECTILES,
        );
        this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    update(projectiles: readonly Projectile[]): void {
        const count = Math.min(projectiles.length, MAX_PROJECTILES);
        for (let i = 0; i < count; i++) {
            const p = projectiles[i]!;
            this.matrix.makeTranslation(p.x, p.y, p.z);
            this.mesh.setMatrixAt(i, this.matrix);
        }
        this.mesh.count = count;
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    clear(): void {
        this.mesh.count = 0;
    }
}
