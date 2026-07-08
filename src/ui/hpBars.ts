import { Graphics } from 'pixi.js';
import { Vector3, type PerspectiveCamera } from 'three';
import type { Actor } from '../game/sim';

/**
 * The HP bar over the one highlighted mech (battle phase), drawn into a Pixi
 * Graphics by projecting its world position through the three.js camera.
 */
export class HpBars {
    readonly view = new Graphics();
    private readonly tmp = new Vector3();

    clear(): void {
        this.view.clear();
    }

    update(selected: Actor | null, camera: PerspectiveCamera, width: number, height: number): void {
        this.view.clear();
        if (!selected || !selected.alive) return;
        const a = selected;
        const t = a.unit.type;

        // ground ring under the selected mech
        this.tmp.set(a.x, 0.05, a.z).project(camera);
        if (this.tmp.z > 1 || this.tmp.z < -1) return;
        const gx = (this.tmp.x + 1) * 0.5 * width;
        const gy = (1 - this.tmp.y) * 0.5 * height;
        this.view.ellipse(gx, gy, 18, 9).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });

        const barY = t.structure ? t.meshScale * 4.2 : t.meshScale * 2.2 + 1;
        this.tmp.set(a.x, barY, a.z).project(camera);
        const sx = (this.tmp.x + 1) * 0.5 * width;
        const sy = (1 - this.tmp.y) * 0.5 * height;

        const ratio = Math.max(0, Math.min(1, a.hp / t.hp));
        const w = t.structure ? 42 : 26;
        const h = 5;
        const color = ratio > 0.5 ? 0x5ade6c : ratio > 0.25 ? 0xd8c66a : 0xff5f45;
        this.view.rect(sx - w / 2 - 1.5, sy - h - 1.5, w + 3, h + 3).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
        this.view.rect(sx - w / 2, sy - h, w, h).fill({ color: 0x10161a, alpha: 0.85 });
        if (ratio > 0) this.view.rect(sx - w / 2, sy - h, w * ratio, h).fill(color);
    }
}
