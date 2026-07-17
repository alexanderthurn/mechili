import {
    BufferGeometry,
    CircleGeometry,
    DoubleSide,
    Group,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Vector3,
    type Scene,
} from 'three';
import { teamColors } from './colors';
import { POISON_CLOUD_ID, TACTICS, type SpellStamp } from './tactics';
import { THEME } from '../theme';

// floats just above the tallest board-relief mound, like the rally overlay
const Y_RELIEF = THEME.terrain.reliefDepth;
const Y_FILL = Y_RELIEF + 0.03;
const Y_LINE = Y_RELIEF + 0.038;

/** the aim circle riding the cursor while a point spell is armed */
export type SpellDraft = { x: number; z: number; radius: number; blocked: boolean };

const BLOCKED_COLOR = 0xff3b30;

/** Ground markers for placed battle spells + the aim preview circle. */
export class SpellVisuals {
    readonly group = new Group();

    constructor(private readonly scene: Scene) {
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

    sync(stamps: readonly SpellStamp[], draft: SpellDraft | null): void {
        this.clear();
        for (const s of stamps) {
            const radius = TACTICS[s.tacticId]?.radius ?? 8;
            const color =
                s.tacticId === POISON_CLOUD_ID
                    ? 0x7ec850 // toxic green regardless of team
                    : s.team === 'player'
                      ? teamColors.player.hex
                      : teamColors.enemy.hex;
            this.addCircle(s.x, s.z, radius, color, 0.24, 0.9);
        }
        if (draft) {
            const color = draft.blocked ? BLOCKED_COLOR : teamColors.player.hex;
            this.addCircle(draft.x, draft.z, draft.radius, color, 0.18, 0.75);
        }
    }

    private addCircle(
        x: number,
        z: number,
        radius: number,
        color: number,
        fillOpacity: number,
        lineOpacity: number,
    ): void {
        const disc = new Mesh(
            new CircleGeometry(radius, 48),
            new MeshBasicMaterial({
                color,
                transparent: true,
                opacity: fillOpacity,
                side: DoubleSide,
                depthWrite: false,
            }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, Y_FILL, z);
        this.group.add(disc);
        this.group.add(
            new Line(
                new BufferGeometry().setFromPoints(
                    Array.from({ length: 49 }, (_, i) => {
                        const a = (i / 48) * Math.PI * 2;
                        return new Vector3(
                            x + Math.cos(a) * radius,
                            Y_LINE,
                            z + Math.sin(a) * radius,
                        );
                    }),
                ),
                new LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
            ),
        );
    }
}
