import {
    Group,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    type Scene,
} from 'three';
import { groundHeightAt } from './map';
import { HAZARD_DRIP_FALL_SEC } from './fire';

const DROP_HEIGHT = 28;
const DROP_SCALE = 1.35;
const SPLASH_SEC = 0.18;

const OIL_COLOR = 0x5a3a12;
const ACID_COLOR = 0x9ccc3a;

type DripActive = {
    hazard: 'oil' | 'acid';
    x: number;
    z: number;
    at: number;
    root: Mesh;
    groundY: number;
    phase: 'fall' | 'splash';
    splashUntil: number;
};

/**
 * Render-only oil/acid drips: blobs fall from the air onto each pour landing
 * spot, then briefly splat. Timing matches sim `hazardDrip` events.
 */
export class OilDripFx {
    private readonly group = new Group();
    private readonly geo = new SphereGeometry(1, 8, 6);
    private readonly oilMat = new MeshBasicMaterial({
        color: OIL_COLOR,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
    });
    private readonly acidMat = new MeshBasicMaterial({
        color: ACID_COLOR,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
    });
    private readonly active: DripActive[] = [];
    private readonly pool: Mesh[] = [];

    constructor(scene: Scene) {
        scene.add(this.group);
    }

    spawnDrip(hazard: 'oil' | 'acid', x: number, z: number, at: number): void {
        const root = this.pool.pop() ?? new Mesh(this.geo, this.oilMat);
        root.material = hazard === 'oil' ? this.oilMat : this.acidMat;
        const groundY = groundHeightAt(x, z);
        // slight left→right lean so the pour reads as a stream, not a column
        const lean = 4;
        root.position.set(x - lean, groundY + DROP_HEIGHT, z);
        root.scale.set(DROP_SCALE * 0.55, DROP_SCALE * 1.15, DROP_SCALE * 0.55);
        root.visible = true;
        this.group.add(root);
        this.active.push({
            hazard,
            x,
            z,
            at,
            root,
            groundY,
            phase: 'fall',
            splashUntil: 0,
        });
    }

    clear(): void {
        for (const d of this.active) {
            this.group.remove(d.root);
            d.root.visible = false;
            this.pool.push(d.root);
        }
        this.active.length = 0;
    }

    dispose(): void {
        this.clear();
        this.geo.dispose();
        this.oilMat.dispose();
        this.acidMat.dispose();
        this.group.parent?.remove(this.group);
    }

    update(elapsed: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const d = this.active[i]!;
            if (d.phase === 'fall') {
                const start = d.at - HAZARD_DRIP_FALL_SEC;
                const t = Math.min(1, Math.max(0, (elapsed - start) / HAZARD_DRIP_FALL_SEC));
                const ease = t * t; // accelerate into the ground
                const lean = 4 * (1 - ease);
                d.root.position.set(
                    d.x - lean,
                    d.groundY + DROP_HEIGHT * (1 - ease),
                    d.z,
                );
                const squash = 1 - ease * 0.25;
                d.root.scale.set(
                    DROP_SCALE * (0.55 + ease * 0.2),
                    DROP_SCALE * 1.15 * squash,
                    DROP_SCALE * (0.55 + ease * 0.2),
                );
                if (elapsed >= d.at) {
                    d.phase = 'splash';
                    d.splashUntil = d.at + SPLASH_SEC;
                    d.root.position.set(d.x, d.groundY + 0.35, d.z);
                    d.root.scale.set(DROP_SCALE * 1.6, DROP_SCALE * 0.35, DROP_SCALE * 1.6);
                }
                continue;
            }
            // splash: flatten then disappear (shared materials — no per-drip opacity)
            const u = Math.min(1, Math.max(0, (elapsed - d.at) / SPLASH_SEC));
            d.root.scale.set(
                DROP_SCALE * (1.6 + u * 1.2),
                DROP_SCALE * (0.35 * (1 - u)),
                DROP_SCALE * (1.6 + u * 1.2),
            );
            if (elapsed >= d.splashUntil) {
                this.group.remove(d.root);
                d.root.visible = false;
                this.pool.push(d.root);
                this.active.splice(i, 1);
            }
        }
    }
}
