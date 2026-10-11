import { BoxGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, type Scene } from 'three';

/**
 * The red arrows of target marks (see WALL_PLAN.md): the yellow level-up
 * arrow's shape (placement.ts updateLevelArrows), lying just above the ground
 * in front of a marked wall and pointing at it, bobbing toward it. Render
 * only — fed each frame with what to show.
 */
export interface TargetMarkerView {
    /** where the arrow's tip points: the wall's face, on the ground */
    x: number;
    z: number;
    y: number;
    /** unit direction from the arrow toward the wall (flat) */
    dirX: number;
    dirZ: number;
    /** an auto-mark (walled in): drawn fainter */
    faint: boolean;
}

const COLOR = 0xd8312b;
/** world units the arrow's tip stays off the face, and how far it bobs */
const GAP = 1.2;
const BOB = 0.5;
const SCALE = 3;
const FAINT_OPACITY = 0.45;

export class TargetMarkers {
    private readonly arrows: Group[] = [];
    private readonly solid = new MeshBasicMaterial({ color: COLOR });
    private readonly faint = new MeshBasicMaterial({ color: COLOR, transparent: true, opacity: FAINT_OPACITY, depthWrite: false });

    constructor(private readonly scene: Scene) {}

    update(views: readonly TargetMarkerView[], timeSeconds: number): void {
        for (let i = 0; i < views.length; i++) {
            const v = views[i]!;
            const arrow = this.arrows[i] ?? this.make();
            const mat = v.faint ? this.faint : this.solid;
            for (const child of arrow.children) (child as Mesh).material = mat;
            // tip (1 up the built arrow, × SCALE) GAP off the face, swinging toward it
            const bob = (Math.sin(timeSeconds * 3 + i) * 0.5 + 0.5) * BOB;
            const back = GAP + bob + SCALE;
            arrow.position.set(v.x - v.dirX * back, v.y, v.z - v.dirZ * back);
            // built pointing +y: tip it over onto +z (x), then turn +z toward the wall (y)
            arrow.rotation.set(Math.PI / 2, Math.atan2(v.dirX, v.dirZ), 0, 'YXZ');
            arrow.visible = true;
        }
        for (let i = views.length; i < this.arrows.length; i++) this.arrows[i]!.visible = false;
    }

    dispose(): void {
        for (const a of this.arrows) {
            this.scene.remove(a);
            for (const child of a.children) (child as Mesh).geometry.dispose();
        }
        this.arrows.length = 0;
        this.solid.dispose();
        this.faint.dispose();
    }

    private make(): Group {
        const arrow = new Group();
        arrow.scale.setScalar(SCALE);
        // square shaft + pyramid head, as the level-up arrow
        const shaft = new Mesh(new BoxGeometry(0.34, 0.6, 0.34), this.solid);
        const head = new Mesh(new ConeGeometry(0.46, 0.7, 4), this.solid);
        head.rotation.y = Math.PI / 4;
        head.position.y = 0.65;
        arrow.add(shaft, head);
        arrow.visible = false;
        this.scene.add(arrow);
        this.arrows.push(arrow);
        return arrow;
    }
}
