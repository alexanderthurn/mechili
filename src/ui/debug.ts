import { Text, type Application } from 'pixi.js';
import type { CameraRig } from '../engine/cameraRig';
import { THEME } from '../theme';

/** Top-left FPS / camera readout, refreshed a few times per second. */
export class DebugOverlay {
    readonly view = new Text({
        text: '',
        style: { fill: THEME.ui.debug, fontSize: 13, fontFamily: 'monospace' },
    });
    private accumulator = 0;

    constructor(private readonly hudMode: string) {
        this.view.position.set(10, 8);
    }

    update(app: Application, rig: CameraRig, unitCount: number, dtSeconds: number): void {
        this.accumulator += dtSeconds;
        if (this.accumulator < 0.25) return;
        this.accumulator = 0;
        const t = rig.target;
        const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(0);
        this.view.text =
            `fps ${app.ticker.FPS.toFixed(0)}  ` +
            `cam (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) zoom ${rig.zoom.toFixed(0)} ` +
            `heading ${deg(rig.heading)}° pitch ${deg(rig.pitch)}°  ` +
            `units ${unitCount}  hud ${this.hudMode}`;
    }
}
