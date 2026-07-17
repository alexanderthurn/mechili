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
import { addCapsuleOutline } from './oilVisuals';
import { ACID_ID, DRAGON_ID, POISON_CLOUD_ID, TACTICS, type SpellStamp } from './tactics';
import { THEME } from '../theme';

// floats just above the tallest board-relief mound, like the rally overlay
const Y_RELIEF = THEME.terrain.reliefDepth;
const Y_FILL = Y_RELIEF + 0.03;
const Y_LINE = Y_RELIEF + 0.038;

/** the aim circle riding the cursor while a spell is armed; two-point drafts
 *  additionally carry the already-placed start circle */
export type SpellDraft = {
    tacticId: string;
    x: number;
    z: number;
    radius: number;
    blocked: boolean;
    startX?: number;
    startZ?: number;
};

const BLOCKED_COLOR = 0xff3b30;

/** capsule tints per tactic — the oil deploy look, recolored */
const CAPSULE_TINTS: Record<string, { fill: number; line: number }> = {
    [ACID_ID]: { fill: 0x2e3a08, line: 0xc9e34a }, // sludgy acid green
    [DRAGON_ID]: { fill: 0x3a140a, line: 0xe07a2e }, // scorched fire path
};

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
            if (s.endX !== undefined && s.endZ !== undefined) {
                // two-point spells reuse the oil deploy capsule, tinted
                const tint = CAPSULE_TINTS[s.tacticId] ?? {
                    fill: s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
                    line: s.team === 'player' ? teamColors.player.hex : teamColors.enemy.hex,
                };
                addCapsuleOutline(
                    this.group, s.x, s.z, s.endX, s.endZ, radius, false, tint.fill, tint.line,
                );
                continue;
            }
            const color =
                s.tacticId === POISON_CLOUD_ID
                    ? 0x7ec850 // toxic green regardless of team
                    : s.team === 'player'
                      ? teamColors.player.hex
                      : teamColors.enemy.hex;
            this.addCircle(s.x, s.z, radius, color, 0.24, 0.9);
        }
        if (!draft) return;
        if (draft.startX !== undefined && draft.startZ !== undefined) {
            const tint = draft.blocked
                ? { fill: BLOCKED_COLOR, line: BLOCKED_COLOR }
                : (CAPSULE_TINTS[draft.tacticId] ?? {
                      fill: teamColors.player.hex,
                      line: teamColors.player.hex,
                  });
            addCapsuleOutline(
                this.group, draft.startX, draft.startZ, draft.x, draft.z,
                draft.radius, true, tint.fill, tint.line,
            );
        } else {
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
