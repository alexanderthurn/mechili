import { Graphics } from 'pixi.js';
import { Vector3, type PerspectiveCamera } from 'three';
import { colorForUnit } from '../game/colors';
import { isSecondarySeat, type SeatDef } from '../game/seats';
import { groundHeightAt } from '../game/map';
import { actorSeat, actorTeam, HURT_BAR_SECONDS, type Actor } from '../game/sim';
import { getUnitVisualHalfWidth } from '../game/unitModels';

/**
 * The measured mesh box reaches the extremities (a crow rider's wingtips), which
 * overstates the unit's visual mass — span the body instead. Only matters for
 * models wider than their collision circle; everything else floors on that.
 */
const MODEL_WIDTH_FIT = 0.5;
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
    /** scratch for projecting the unit's side edge (bar width = model width) */
    private readonly tmp2 = new Vector3();
    private readonly right = new Vector3();
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
        // Span the model: measured mesh half-width (wingspan etc.) when the GLB
        // has been measured, else the collision circle. Projected to screen so
        // the bar tracks the mech at any zoom; old pixel widths stay as a floor.
        const modelKey = t.modelId ?? t.id;
        const localHalf = getUnitVisualHalfWidth(modelKey);
        const halfW = Math.max(
            localHalf > 0 ? localHalf * t.meshScale * MODEL_WIDTH_FIT : 0,
            t.collisionRadius,
        );
        this.right.setFromMatrixColumn(camera.matrixWorld, 0); // camera-right, normalized
        this.tmp2
            .set(a.rx + this.right.x * halfW, barY + this.right.y * halfW, a.rz + this.right.z * halfW)
            .project(camera);
        const edgeSx = (this.tmp2.x + 1) * 0.5 * width;
        const modelW = Math.abs(edgeSx - sx) * 2;
        const minW = t.structure ? 42 : selected ? 26 : 18;
        const w = Math.min(Math.max(minW, modelW), width * 0.5);
        // Thickness follows ZOOM, not unit width — otherwise wide units (towers,
        // ballistae) get chunky bars while small ones stay thin.
        const pxPerWorld = halfW > 1e-4 ? modelW / (halfW * 2) : 0;
        const h = Math.max(selected ? 5 : 4, Math.min(9, Math.round(pxPerWorld * 0.5)));
        const team = actorTeam(a);
        const seat = actorSeat(a);
        const color = colorForUnit(team, isSecondarySeat(this.roster, seat)).hex;
        const left = sx - w / 2;
        const top = sy - h;

        // (no outline when selected: the plate on the ground marks the selection, and a
        // selected unit's banner is a little taller)
        drawBanner(g, left, top, w, h, ratio, faded(color), alpha);

        // Shield (Aegis / Bulwark): same dimensions as the HP bar, stacked just
        // above it. The empty track stays visible once depleted, so a shielded
        // unit keeps reading as shielded (and you can see it broken).
        if (a.shieldMaxHp > 0) {
            const sRatio = Math.max(0, Math.min(1, a.shieldHp / a.shieldMaxHp));
            const sTop = top - h - 1;
            drawBanner(g, left, sTop, w, h, sRatio, faded(THEME.shieldBar), alpha);
        }

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

/**
 * A small banner like the commanders' health flags (see hud .hp-track): the faded
 * shadow of the full banner, and the cloth in front, as long as `ratio`, with a
 * swallowtail cut into its free end. (No pole: at this size it read as a dark line.)
 */
function drawBanner(
    g: Graphics,
    left: number,
    top: number,
    w: number,
    h: number,
    ratio: number,
    color: number,
    alpha: number,
): void {
    const notch = Math.min(h * 0.7, 5);
    const flag = (len: number): number[] => {
        const r = left + len;
        const n = Math.min(notch, len);
        return [left, top, r, top, r - n, top + h / 2, r, top + h, left, top + h];
    };
    // the full banner's shadow, where health is gone
    g.poly(flag(w)).fill({ color: BANNER_SHADOW, alpha: 0.75 * alpha });
    if (ratio > 0) g.poly(flag(w * ratio)).fill({ color, alpha });
}

const BANNER_SHADOW = 0x2a1f16;

/** the dye faded with age: the team colour pulled a little toward old brown */
function faded(hex: number): number {
    const k = 0.22;
    const mix = (shift: number, toward: number) => Math.round(((hex >> shift) & 0xff) * (1 - k) + toward * k);
    return (mix(16, 0x6a) << 16) | (mix(8, 0x55) << 8) | mix(0, 0x41);
}
