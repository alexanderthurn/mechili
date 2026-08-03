import { Graphics } from 'pixi.js';
import { Vector3, type PerspectiveCamera } from 'three';
import { colorForUnit } from '../game/colors';
import { isSecondarySeat, type SeatDef } from '../game/seats';
import { groundHeightAt } from '../game/map';
import { actorSeat, actorTeam, HURT_BAR_SECONDS, type Actor } from '../game/sim';
import { THEME } from '../theme';

/**
 * Battle-phase HP bars, drawn into one Pixi Graphics by projecting world
 * positions through the three.js camera. A bar shows while a unit is under
 * attack (fading out afterwards) and for the selected mech, which also gets
 * a ground ring and an outlined bar. Fill color is the owner's team color.
 *
 * While a wizard convert-ray is channeling, convert progress overlays the HP
 * fill in the caster's team color (progress / current HP).
 */
export class HpBars {
    readonly view = new Graphics();
    private readonly tmp = new Vector3();
    /** the match roster — secondary seats tint green/orange */
    roster: SeatDef[] = [];

    /** Pixi v8 nulls `context` on destroy — guard every draw call. */
    private get alive(): boolean {
        return this.view.context != null;
    }

    clear(): void {
        if (!this.alive) return;
        this.view.clear();
    }

    update(
        actors: readonly Actor[],
        camera: PerspectiveCamera,
        width: number,
        height: number,
        selected: Actor | null,
        elapsed: number,
    ): void {
        if (!this.alive) return;
        this.view.clear();
        for (const a of actors) {
            if (!a.alive) continue;
            const isSelected = a === selected;
            const spawning = a.spawnUntil > elapsed + 1e-9;
            const converting = !!(a.convertBy && a.convertProgress > 0);
            if (!isSelected && a.hurtTimer <= 0 && !spawning && !converting) continue;
            // recently-hit bars fade out over the last part of the timer;
            // spawning / converting bars stay fully visible
            const alpha =
                isSelected || spawning || converting
                    ? 1
                    : Math.min(1, a.hurtTimer / (HURT_BAR_SECONDS * 0.35));
            this.drawBar(this.view, a, camera, width, height, alpha, isSelected);
        }
    }

    /** Tear down the Pixi graphics (match exit / Game.destroy). */
    destroy(): void {
        if (!this.alive) return;
        this.view.parent?.removeChild(this.view);
        this.view.destroy({ children: true });
    }

    private drawBar(
        g: Graphics,
        a: Actor,
        camera: PerspectiveCamera,
        width: number,
        height: number,
        alpha: number,
        selected: boolean,
    ): void {
        const t = a.unit.type;
        const ground = a.altitude > 0 ? 0 : groundHeightAt(a.rx, a.rz);
        const barY = ground + a.altitude + (t.structure ? t.meshScale * 4.2 : t.meshScale * 2.2 + 1);
        // rx/rz = interpolated render position, so bars stay glued to meshes
        this.tmp.set(a.rx, barY, a.rz).project(camera);
        if (this.tmp.z > 1 || this.tmp.z < -1) return;
        const sx = (this.tmp.x + 1) * 0.5 * width;
        const sy = (1 - this.tmp.y) * 0.5 * height;
        if (sx < -40 || sx > width + 40 || sy < -20 || sy > height + 20) return;

        const ratio = Math.max(0, Math.min(1, a.hp / a.maxHp));
        const w = t.structure ? 42 : selected ? 26 : 18;
        const h = selected ? 5 : 3;
        const team = actorTeam(a);
        const seat = actorSeat(a);
        const color = colorForUnit(team, isSecondarySeat(this.roster, seat)).hex;
        const left = sx - w / 2;
        const top = sy - h;

        if (selected) {
            // the ground shows the 3D attack-range ring instead of a marker here
            g.rect(left - 1.5, top - 1.5, w + 3, h + 3).stroke({
                width: 1.5,
                color: THEME.selection,
                alpha: 0.8,
            });
        }
        g.rect(left, top, w, h).fill({ color: THEME.barBg, alpha: 0.85 * alpha });
        if (ratio > 0) g.rect(left, top, w * ratio, h).fill({ color, alpha });

        // convert progress overlays the HP fill in the caster's color
        const caster = a.convertBy;
        if (caster && a.convertProgress > 0 && a.hp > 0 && ratio > 0) {
            const fill = Math.max(0, Math.min(1, a.convertProgress / a.hp));
            const cTeam = actorTeam(caster);
            const cSeat = actorSeat(caster);
            const cColor = colorForUnit(cTeam, isSecondarySeat(this.roster, cSeat)).hex;
            // paint over the current-HP segment — full overlay = about to flip
            g.rect(left, top, w * ratio * fill, h).fill({ color: cColor, alpha: 0.92 * alpha });
        }
    }
}
