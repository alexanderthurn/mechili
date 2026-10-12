import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Scene } from 'three';

/**
 * Debug: lines from the selected battle unit — yellow to what it goes for
 * (its target, a wall at the point it aims at), and one to each marked wall
 * it passes over, colored by why. Drawn over everything. Render only — fed
 * each frame.
 */
export interface TargetLineSegment {
    to: { x: number; y: number; z: number };
    color: number;
}

const MAX_SEGMENTS = 64;

export class TargetLine {
    private readonly lines: LineSegments;
    private readonly positions = new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3);
    private readonly colors = new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3);

    constructor(private readonly scene: Scene) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', this.positions);
        geometry.setAttribute('color', this.colors);
        const material = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
        this.lines = new LineSegments(geometry, material);
        this.lines.renderOrder = 999;
        this.lines.frustumCulled = false;
        this.lines.visible = false;
        scene.add(this.lines);
    }

    /** segments from `from`; null / none hides them */
    update(from: { x: number; y: number; z: number } | null, segments: readonly TargetLineSegment[]): void {
        const n = from ? Math.min(MAX_SEGMENTS, segments.length) : 0;
        if (n === 0) {
            this.lines.visible = false;
            return;
        }
        for (let i = 0; i < n; i++) {
            const s = segments[i]!;
            const r = ((s.color >> 16) & 255) / 255;
            const g = ((s.color >> 8) & 255) / 255;
            const b = (s.color & 255) / 255;
            this.positions.setXYZ(i * 2, from!.x, from!.y, from!.z);
            this.positions.setXYZ(i * 2 + 1, s.to.x, s.to.y, s.to.z);
            this.colors.setXYZ(i * 2, r, g, b);
            this.colors.setXYZ(i * 2 + 1, r, g, b);
        }
        this.positions.needsUpdate = true;
        this.colors.needsUpdate = true;
        this.lines.geometry.setDrawRange(0, n * 2);
        this.lines.visible = true;
    }

    dispose(): void {
        this.scene.remove(this.lines);
        this.lines.geometry.dispose();
        (this.lines.material as LineBasicMaterial).dispose();
    }
}
