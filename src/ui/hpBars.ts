import { Graphics } from 'pixi.js';
import { Vector3, type PerspectiveCamera } from 'three';
import { HURT_BAR_SECONDS, type Actor } from '../game/sim';
import { THEME } from '../theme';

/**
 * Battle-phase HP bars, drawn into one Pixi Graphics by projecting world
 * positions through the three.js camera. A bar shows while a unit is under
 * attack (fading out afterwards) and for the selected mech, which also gets
 * a ground ring and an outlined bar.
 */
export class HpBars {
    readonly view = new Graphics();
    private readonly tmp = new Vector3();

    clear(): void {
        this.view.clear();
    }

    update(
        actors: readonly Actor[],
        camera: PerspectiveCamera,
        width: number,
        height: number,
        selected: Actor | null,
    ): void {
        this.view.clear();
        for (const a of actors) {
            if (!a.alive) continue;
            const isSelected = a === selected;
            if (!isSelected && a.hurtTimer <= 0) continue;
            // recently-hit bars fade out over the last part of the timer
            const alpha = isSelected ? 1 : Math.min(1, a.hurtTimer / (HURT_BAR_SECONDS * 0.35));
            this.drawBar(a, camera, width, height, alpha, isSelected);
        }
    }

    private drawBar(
        a: Actor,
        camera: PerspectiveCamera,
        width: number,
        height: number,
        alpha: number,
        selected: boolean,
    ): void {
        const t = a.unit.type;
        const barY = a.altitude + (t.structure ? t.meshScale * 4.2 : t.meshScale * 2.2 + 1);
        this.tmp.set(a.x, barY, a.z).project(camera);
        if (this.tmp.z > 1 || this.tmp.z < -1) return;
        const sx = (this.tmp.x + 1) * 0.5 * width;
        const sy = (1 - this.tmp.y) * 0.5 * height;
        if (sx < -40 || sx > width + 40 || sy < -20 || sy > height + 20) return;

        const ratio = Math.max(0, Math.min(1, a.hp / a.maxHp));
        const w = t.structure ? 42 : selected ? 26 : 18;
        const h = selected ? 5 : 3;
        const color = ratio > 0.5 ? THEME.hpHigh : ratio > 0.25 ? THEME.hpMid : THEME.hpLow;
        // veterancy pips above the bar
        for (let i = 0; i < a.unit.level - 1; i++) {
            this.view.circle(sx - ((a.unit.level - 2) * 5) / 2 + i * 5, sy - h - 5, 1.8).fill({ color: THEME.veteran, alpha });
        }

        if (selected) {
            this.view
                .rect(sx - w / 2 - 1.5, sy - h - 1.5, w + 3, h + 3)
                .stroke({ width: 1.5, color: THEME.selection, alpha: 0.8 });
            // ground ring under the selected mech
            this.tmp.set(a.x, 0.05, a.z).project(camera);
            const gx = (this.tmp.x + 1) * 0.5 * width;
            const gy = (1 - this.tmp.y) * 0.5 * height;
            this.view.ellipse(gx, gy, 18, 9).stroke({ width: 2, color: THEME.selection, alpha: 0.9 });
        }
        this.view.rect(sx - w / 2, sy - h, w, h).fill({ color: THEME.barBg, alpha: 0.85 * alpha });
        if (ratio > 0) this.view.rect(sx - w / 2, sy - h, w * ratio, h).fill({ color, alpha });
    }
}
