import {
    BufferGeometry,
    CircleGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Vector3,
    type Scene,
} from 'three';
import { teamColors } from './colors';
import type { BattleMap } from './map';
import { RALLY_ROUTE_RADIUS, type RallyRoute } from './tactics';

const Y_FILL = 0.032;
const Y_LINE = 0.04;
const Y_ARROW = 0.045;
const ARROW_SPACING = 10;

export type RallyDraft = {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    mode: 'start-only' | 'full';
};

/**
 * Ground overlay for rally routes — filled capsule corridor, edge lines, chevrons.
 */
export class RallyVisuals {
    readonly group = new Group();

    constructor(
        private readonly scene: Scene,
        private readonly map: BattleMap,
    ) {
        scene.add(this.group);
    }

    dispose(): void {
        this.clear();
        this.scene.remove(this.group);
    }

    clear(): void {
        for (const child of [...this.group.children]) {
            child.traverse((o) => {
                const mesh = o as Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat && !Array.isArray(mat)) mat.dispose();
            });
            this.group.remove(child);
        }
    }

    sync(routes: readonly RallyRoute[], draft: RallyDraft | null): void {
        this.clear();
        for (const route of routes) {
            const color =
                route.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex;
            this.addRoute(route.startX, route.startZ, route.endX, route.endZ, color);
        }
        if (!draft) return;
        const draftColor = teamColors.player.hex;
        if (draft.mode === 'start-only') {
            this.addCircleMarker(draft.startX, draft.startZ, draftColor, true);
        } else {
            this.addRoute(draft.startX, draft.startZ, draft.endX, draft.endZ, draftColor, true);
        }
    }

    private addCircleMarker(x: number, z: number, color: number, draft: boolean): void {
        const fillOpacity = draft ? 0.3 : 0.36;
        const lineOpacity = draft ? 0.7 : 0.95;
        const fillMat = new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: fillOpacity,
            side: DoubleSide,
            depthWrite: false,
        });
        const lineMat = new LineBasicMaterial({
            color,
            transparent: true,
            opacity: lineOpacity,
        });
        const disc = new Mesh(new CircleGeometry(RALLY_ROUTE_RADIUS, 48), fillMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, Y_FILL, z);
        this.group.add(disc);
        this.group.add(this.circleRing(x, z, color, lineMat));
    }

    private addRoute(
        startX: number,
        startZ: number,
        endX: number,
        endZ: number,
        color: number,
        draft = false,
    ): void {
        const dx = endX - startX;
        const dz = endZ - startZ;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) {
            this.addCircleMarker(startX, startZ, color, draft);
            return;
        }

        const ux = dx / len;
        const uz = dz / len;
        const px = -uz * RALLY_ROUTE_RADIUS;
        const pz = ux * RALLY_ROUTE_RADIUS;

        const fillOpacity = draft ? 0.26 : 0.32;
        const lineOpacity = draft ? 0.65 : 0.92;
        const arrowOpacity = draft ? 0.45 : 0.6;

        const fillMat = new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: fillOpacity,
            side: DoubleSide,
            depthWrite: false,
        });
        const lineMat = new LineBasicMaterial({
            color,
            transparent: true,
            opacity: lineOpacity,
        });
        const arrowMat = new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: arrowOpacity,
            side: DoubleSide,
            depthWrite: false,
        });

        const fillGeo = this.buildCapsuleFill(startX, startZ, endX, endZ, px, pz, ux, uz);
        this.group.add(new Mesh(fillGeo, fillMat));

        // extra filled discs at endpoints so the circles read clearly
        for (const [x, z] of [
            [startX, startZ],
            [endX, endZ],
        ] as const) {
            const disc = new Mesh(new CircleGeometry(RALLY_ROUTE_RADIUS, 48), fillMat.clone());
            (disc.material as MeshBasicMaterial).opacity = fillOpacity + 0.08;
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(x, Y_FILL + 0.002, z);
            this.group.add(disc);
            this.group.add(this.circleRing(x, z, color, lineMat));
        }

        const lines: [number, number, number, number][] = [
            [startX, startZ, endX, endZ],
            [startX + px, startZ + pz, endX + px, endZ + pz],
            [startX - px, startZ - pz, endX - px, endZ - pz],
        ];
        for (const [x0, z0, x1, z1] of lines) {
            const geo = new BufferGeometry();
            geo.setAttribute(
                'position',
                new Float32BufferAttribute([x0, Y_LINE, z0, x1, Y_LINE, z1], 3),
            );
            this.group.add(new Line(geo, lineMat));
        }

        const arrowGeo = this.chevronGeometry(2.8, 1.6);
        const heading = Math.atan2(ux, uz);
        const count = Math.max(1, Math.floor(len / ARROW_SPACING));
        for (let i = 1; i <= count; i++) {
            const t = i / (count + 1);
            const arrow = new Mesh(arrowGeo, arrowMat);
            arrow.rotation.y = heading;
            arrow.position.set(startX + dx * t, Y_ARROW, startZ + dz * t);
            this.group.add(arrow);
        }
    }

    private circleRing(x: number, z: number, _color: number, lineMat: LineBasicMaterial): Line {
        return new Line(
            new BufferGeometry().setFromPoints(
                Array.from({ length: 49 }, (_, i) => {
                    const a = (i / 48) * Math.PI * 2;
                    return new Vector3(
                        x + Math.cos(a) * RALLY_ROUTE_RADIUS,
                        Y_LINE,
                        z + Math.sin(a) * RALLY_ROUTE_RADIUS,
                    );
                }),
            ),
            lineMat,
        );
    }

    /** corridor rectangle + semicircle caps, built directly in world XZ */
    private buildCapsuleFill(
        sx: number,
        sz: number,
        ex: number,
        ez: number,
        px: number,
        pz: number,
        ux: number,
        uz: number,
    ): BufferGeometry {
        const r = RALLY_ROUTE_RADIUS;
        const positions: number[] = [];
        const indices: number[] = [];
        const push = (x: number, z: number): number => {
            positions.push(x, Y_FILL, z);
            return positions.length / 3 - 1;
        };

        // strip between the side lines
        const q0 = push(sx + px, sz + pz);
        const q1 = push(ex + px, ez + pz);
        const q2 = push(ex - px, ez - pz);
        const q3 = push(sx - px, sz - pz);
        indices.push(q0, q1, q2, q0, q2, q3);

        this.appendSemicircleCap(push, indices, ex, ez, ux, uz, px, pz, r);
        this.appendSemicircleCap(push, indices, sx, sz, -ux, -uz, px, pz, r);

        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        return geo;
    }

    /** fan from circle center along the outer semicircle (bulging in bulgeX/bulgeZ) */
    private appendSemicircleCap(
        push: (x: number, z: number) => number,
        indices: number[],
        cx: number,
        cz: number,
        bulgeX: number,
        bulgeZ: number,
        px: number,
        pz: number,
        r: number,
    ): void {
        const center = push(cx, cz);
        const aLeft = Math.atan2(pz, px);
        const aBulge = Math.atan2(bulgeZ, bulgeX);
        const ccwToBulge = ((aBulge - aLeft) + Math.PI * 2) % (Math.PI * 2);
        const clockwise = ccwToBulge > Math.PI;
        const sweep = clockwise ? -Math.PI : Math.PI;
        const steps = 28;
        let prev = -1;
        for (let i = 0; i <= steps; i++) {
            const a = aLeft + (sweep * i) / steps;
            const idx = push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
            if (prev >= 0) indices.push(center, prev, idx);
            prev = idx;
        }
    }

    /** flat chevron in the XZ plane; tip points +Z, rotated by Y to face the path */
    private chevronGeometry(width: number, depth: number): BufferGeometry {
        const hw = width / 2;
        const geo = new BufferGeometry();
        geo.setAttribute(
            'position',
            new Float32BufferAttribute(
                [
                    0,
                    0,
                    depth * 0.5,
                    -hw,
                    0,
                    -depth * 0.5,
                    hw,
                    0,
                    -depth * 0.5,
                ],
                3,
            ),
        );
        geo.setIndex([0, 1, 2]);
        return geo;
    }

    clamp(x: number, z: number): { x: number; z: number } {
        const m = RALLY_ROUTE_RADIUS;
        return {
            x: Math.max(-this.map.halfW + m, Math.min(this.map.halfW - m, x)),
            z: Math.max(-this.map.halfH + m, Math.min(this.map.halfH - m, z)),
        };
    }
}
