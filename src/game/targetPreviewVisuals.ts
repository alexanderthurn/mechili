import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three';
import { DRAPE_LIFT } from './groundMarkers';
import { groundHeightAt } from './map';

const CHEVRON_SPACING = 14;
const CHEVRON_SPEED = 22;
const CHEVRON_W = 5.2;
const CHEVRON_D = 3.6;
/** max chevrons across all routes (pool size) */
const POOL = 48;

export type TargetPreviewRoute = {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
};

/**
 * Deployment selection: big marching chevrons from a pack to the packs /
 * buildings its mechs would open on when battle starts.
 */
export class TargetPreviewVisuals {
    readonly group = new Group();
    private readonly chevronGeo: BufferGeometry;
    private readonly pool: Mesh[] = [];
    private used = 0;

    constructor(scene: Scene) {
        scene.add(this.group);
        this.chevronGeo = chevronGeometry(CHEVRON_W, CHEVRON_D);
        for (let i = 0; i < POOL; i++) {
            const mat = new MeshBasicMaterial({
                color: 0xffd040,
                transparent: true,
                opacity: 0.7,
                side: DoubleSide,
                depthWrite: false,
            });
            const mesh = new Mesh(this.chevronGeo, mat);
            mesh.frustumCulled = false;
            mesh.visible = false;
            this.group.add(mesh);
            this.pool.push(mesh);
        }
    }

    dispose(): void {
        this.clear();
        for (const mesh of this.pool) {
            (mesh.material as MeshBasicMaterial).dispose();
            this.group.remove(mesh);
        }
        this.pool.length = 0;
        this.chevronGeo.dispose();
        this.group.removeFromParent();
    }

    clear(): void {
        for (let i = 0; i < this.used; i++) this.pool[i]!.visible = false;
        this.used = 0;
    }

    sync(routes: readonly TargetPreviewRoute[], timeSeconds: number, color: number): void {
        this.clear();
        for (const route of routes) this.addRoute(route, timeSeconds, color);
    }

    private addRoute(route: TargetPreviewRoute, timeSeconds: number, color: number): void {
        const dx = route.toX - route.fromX;
        const dz = route.toZ - route.fromZ;
        const len = Math.hypot(dx, dz);
        if (len < 4) return;

        const ux = dx / len;
        const uz = dz / len;
        const heading = Math.atan2(ux, uz);

        const margin = 6;
        const travel = Math.max(0, len - margin * 2);
        if (travel < 2) return;

        const phase =
            ((timeSeconds * CHEVRON_SPEED) % CHEVRON_SPACING + CHEVRON_SPACING) % CHEVRON_SPACING;
        for (let d = phase; d < travel; d += CHEVRON_SPACING) {
            const along = margin + d;
            const tip = along / len;
            this.placeChevron(
                route.fromX + ux * along,
                route.fromZ + uz * along,
                heading,
                color,
                0.35 + 0.5 * tip,
                1,
            );
        }
    }

    private placeChevron(
        x: number,
        z: number,
        heading: number,
        color: number,
        opacity: number,
        scale: number,
    ): void {
        if (this.used >= this.pool.length) return;
        const mesh = this.pool[this.used++]!;
        const mat = mesh.material as MeshBasicMaterial;
        mat.color.setHex(color);
        mat.opacity = opacity;
        mesh.scale.setScalar(scale);
        mesh.rotation.y = heading;
        mesh.position.set(x, groundHeightAt(x, z) + DRAPE_LIFT + 0.08, z);
        mesh.visible = true;
    }
}

/** Flat chevron in XZ; tip points +Z, yawed to face the path. */
function chevronGeometry(width: number, depth: number): BufferGeometry {
    const hw = width / 2;
    const geo = new BufferGeometry();
    geo.setAttribute(
        'position',
        new Float32BufferAttribute(
            [0, 0, depth * 0.5, -hw, 0, -depth * 0.5, hw, 0, -depth * 0.5],
            3,
        ),
    );
    geo.setIndex([0, 1, 2]);
    return geo;
}
