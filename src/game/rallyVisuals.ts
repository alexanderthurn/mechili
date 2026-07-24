import {
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    type Scene,
} from 'three';
import { teamColors } from './colors';
import {
    addDrapedCapsule,
    addDrapedCircle,
    drapeChevronGeometry,
    DRAPE_RENDER_ORDER,
    setDrapedObjectPosition,
} from './groundMarkers';
import { type BattleMap } from './map';
import { RALLY_ROUTE_RADIUS, type RallyRoute } from './tactics';

const ARROW_SPACING = 10;

export type RallyDraft = {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    mode: 'start-only' | 'full';
};

/**
 * Ground overlay for rally routes — draped capsule corridor + chevrons
 * (same hill-hugging path markers as oil / acid / dragon).
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
        addDrapedCircle(this.group, x, z, RALLY_ROUTE_RADIUS, color, fillOpacity, lineOpacity);
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

        const fillOpacity = draft ? 0.26 : 0.32;
        const lineOpacity = draft ? 0.65 : 0.92;
        const arrowOpacity = draft ? 0.45 : 0.6;

        addDrapedCapsule(
            this.group,
            startX,
            startZ,
            endX,
            endZ,
            RALLY_ROUTE_RADIUS,
            color,
            color,
            fillOpacity,
            lineOpacity,
        );

        const ux = dx / len;
        const uz = dz / len;
        // drapeChevronGeometry: local +Z → world (-sin(yaw), cos(yaw))
        const heading = Math.atan2(-ux, uz);
        const count = Math.max(1, Math.floor(len / ARROW_SPACING));
        for (let i = 1; i <= count; i++) {
            const t = i / (count + 1);
            const x = startX + dx * t;
            const z = startZ + dz * t;
            const arrow = new Mesh(
                drapeChevronGeometry(x, z, 2.8, 1.6, heading),
                new MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: arrowOpacity,
                    side: DoubleSide,
                    depthWrite: false,
                }),
            );
            setDrapedObjectPosition(arrow, x, z, 0.04);
            arrow.frustumCulled = false;
            arrow.renderOrder = DRAPE_RENDER_ORDER;
            this.group.add(arrow);
        }
    }

    clamp(x: number, z: number): { x: number; z: number } {
        const m = RALLY_ROUTE_RADIUS;
        return {
            x: Math.max(-this.map.halfW + m, Math.min(this.map.halfW - m, x)),
            z: Math.max(-this.map.halfH + m, Math.min(this.map.halfH - m, z)),
        };
    }
}
