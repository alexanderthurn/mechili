/**
 * Forest-ring horde locators: camera-facing `ui-horde` sprites above the
 * canopy, plus matching edge pips when a pack sits off-camera.
 *
 * The pips are HTML, not canvas: they belong on the very edge of the screen,
 * and the HUD (HTML, drawn over the board) would cover them there. As DOM in
 * their own layer they sit above it instead. Visual-only.
 */
import {
    CanvasTexture,
    SRGBColorSpace,
    Sprite,
    SpriteMaterial,
    Vector3,
    type PerspectiveCamera,
    type Scene,
} from 'three';
import { worldHeightAt } from './map';
import { applyIcon, drawIcon } from '../ui/iconAtlas';

/**
 * How high the icon floats.
 *
 * Over the board it rides just above the pack ({@link MARKER_CLEARANCE} over
 * its head) — close enough to read as "these units". Out in the forest ring it
 * has to clear the canopy instead, so it rises to {@link MARKER_FOREST_HEIGHT}
 * as the pack walks out past the board edge, blended over
 * {@link MARKER_BLEND_SPAN} so it never pops.
 */
const MARKER_CLEARANCE = 8;
const MARKER_FOREST_HEIGHT = 40;
const MARKER_BLEND_SPAN = 25;
/** world-space sprite diameter */
const MARKER_SIZE = 12;
const BOB_AMP = 2.5;
const BOB_SPEED = 2.1;

/** inset from screen edges for off-camera pips */
const EDGE_PAD = 28;
/** how far a pip may be jittered off its spot so stacked ones stay readable */
const PIP_JITTER = 6;
/**
 * The world sprite hands over to the edge pip this far before it would reach
 * the rim — the sprite has size, and half of it sliding under a panel (or off
 * screen) reads as two markers for the same pack.
 */
const SNAP_MARGIN = 26;

const ICON_TEX_SIZE = 128;

export type HordeMarkerSpot = {
    x: number;
    z: number;
    /** phase offset so neighboring markers don't bob in lockstep */
    seed: number;
    /** how far the pack's own visuals reach above the ground under it */
    top: number;
};

/**
 * One marker per march-in horde pack. Hidden once `marchIn` clears (on-board).
 * Off-screen packs get a small `ui-horde` icon on the viewport edge.
 */
export class HordeMarkers {
    /** the pips' own layer — mount over the HUD (see theme.ts) */
    readonly edgeView = document.createElement('div');
    private readonly pool: Sprite[] = [];
    private readonly pipPool: HTMLDivElement[] = [];
    private readonly material: SpriteMaterial;
    private readonly iconCanvas: HTMLCanvasElement;
    private readonly tmp = new Vector3();
    private used = 0;

    constructor(private readonly scene: Scene) {
        this.edgeView.className = 'mechili-horde-pips';
        this.iconCanvas = this.stampIconCanvas();
        this.material = new SpriteMaterial({
            map: this.canvasTexture(this.iconCanvas),
            transparent: false,
            alphaTest: 0.5,
            depthTest: true,
            depthWrite: true,
            fog: false,
        });
    }

    update(
        timeSeconds: number,
        spots: readonly HordeMarkerSpot[],
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
        /** board half sizes — outside them the icon has trees to clear */
        halfW: number,
        halfH: number,
    ): void {
        this.used = 0;
        const edgePts: { x: number; y: number; seed: number }[] = [];

        for (const spot of spots) {
            const sprite = this.acquire();
            const ground = worldHeightAt(spot.x, spot.z);
            const bob = Math.sin(timeSeconds * BOB_SPEED + spot.seed) * BOB_AMP;
            // trees only stand outside the board — the further out the pack
            // still is, the more the icon climbs toward canopy height
            const pastEdge = Math.max(Math.abs(spot.x) - halfW, Math.abs(spot.z) - halfH, 0);
            const inForest = Math.min(1, pastEdge / MARKER_BLEND_SPAN);
            const overPack = spot.top + MARKER_CLEARANCE;
            const target = Math.max(overPack, MARKER_FOREST_HEIGHT);
            const y = ground + overPack + (target - overPack) * inForest + bob;
            sprite.position.set(spot.x, y, spot.z);
            this.used++;

            // One marker per pack: the world sprite while it is on screen, the
            // edge pip the moment it would leave (behind the camera or past
            // the rim) — never both.
            //
            // The sprite decides WHEN to hand over (it is what the player sees
            // leave), the pack's feet decide WHERE the pip goes: aiming at the
            // sprite would point a little above the pack, which reads as the
            // wrong direction when a pack stands near the middle of the board.
            const box = this.screenBox(viewW, viewH);
            const shown = this.onScreen(spot.x, y, spot.z, camera, viewW, viewH, box);
            sprite.visible = shown;
            if (!shown) {
                const aim = this.project(spot.x, ground, spot.z, camera, viewW, viewH);
                edgePts.push({ ...this.rimPoint(aim, box), seed: spot.seed });
            }
        }
        for (let i = this.used; i < this.pool.length; i++) {
            this.pool[i]!.visible = false;
        }
        this.syncEdgePips(edgePts, this.screenBox(viewW, viewH));
    }

    clear(): void {
        for (const sprite of this.pool) sprite.visible = false;
        this.used = 0;
        this.syncEdgePips([]);
    }

    dispose(): void {
        for (const sprite of this.pool) {
            this.scene.remove(sprite);
        }
        this.pool.length = 0;
        this.material.map?.dispose();
        this.material.dispose();
        this.pipPool.length = 0;
        this.edgeView.remove();
    }

    private acquire(): Sprite {
        let sprite = this.pool[this.used];
        if (!sprite) {
            sprite = new Sprite(this.material);
            sprite.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
            sprite.renderOrder = 0;
            sprite.frustumCulled = false;
            this.scene.add(sprite);
            this.pool.push(sprite);
        }
        return sprite;
    }

    /**
     * Screen-edge position for an off-camera marker, or null when the sprite
     * is already inside the padded viewport.
     */
    /** the viewport, minus the pip's own padding — where a pip may sit */
    private screenBox(
        viewW: number,
        viewH: number,
    ): { left: number; right: number; top: number; bottom: number } {
        const pad = EDGE_PAD + PIP_JITTER;
        return { left: pad, right: viewW - pad, top: pad, bottom: viewH - pad };
    }

    /**
     * A world point in screen pixels. A point behind the camera is mirrored
     * through the middle, so it reads as "that way, behind you" instead of
     * landing on the wrong rim.
     */
    private project(
        x: number,
        y: number,
        z: number,
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
    ): { x: number; y: number } {
        this.tmp.set(x, y, z).project(camera);
        if (this.tmp.z > 1) {
            this.tmp.x = -this.tmp.x;
            this.tmp.y = -this.tmp.y;
        }
        return {
            x: (this.tmp.x * 0.5 + 0.5) * viewW,
            y: (1 - (this.tmp.y * 0.5 + 0.5)) * viewH,
        };
    }

    /** the world sprite still stands well inside the HUD-free area */
    private onScreen(
        x: number,
        y: number,
        z: number,
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
        box: { left: number; right: number; top: number; bottom: number },
    ): boolean {
        this.tmp.set(x, y, z).project(camera);
        if (this.tmp.z > 1) return false; // behind the camera
        const sx = (this.tmp.x * 0.5 + 0.5) * viewW;
        const sy = (1 - (this.tmp.y * 0.5 + 0.5)) * viewH;
        const m = Math.min(SNAP_MARGIN, (box.right - box.left) * 0.25, (box.bottom - box.top) * 0.25);
        return sx >= box.left + m && sx <= box.right - m && sy >= box.top + m && sy <= box.bottom - m;
    }

    /** Where the line from the middle of the screen to `aim` leaves the viewport. */
    private rimPoint(
        aim: { x: number; y: number },
        box: { left: number; right: number; top: number; bottom: number },
    ): { x: number; y: number } {
        const cx = (box.left + box.right) * 0.5;
        const cy = (box.top + box.bottom) * 0.5;
        let dx = aim.x - cx;
        let dy = aim.y - cy;
        if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
            dx = 0;
            dy = -1;
        }
        const tx = dx > 0 ? (box.right - cx) / dx : dx < 0 ? (box.left - cx) / dx : Infinity;
        const ty = dy > 0 ? (box.bottom - cy) / dy : dy < 0 ? (box.top - cy) / dy : Infinity;
        const t = Math.min(tx, ty);
        return { x: cx + dx * t, y: cy + dy * t };
    }

    private syncEdgePips(
        pts: readonly { x: number; y: number; seed: number }[],
        box?: { left: number; right: number; top: number; bottom: number },
    ): void {
        let used = 0;
        for (const p of pts) {
            const pip = this.acquirePip(used);
            // slight seed jitter so stacked edge hits don't fully overlap —
            // clamped to the viewport so a pip can't drift off screen
            const jx = p.x + Math.sin(p.seed * 2.1) * PIP_JITTER;
            const jy = p.y + Math.cos(p.seed * 1.7) * PIP_JITTER;
            const x = box ? Math.min(Math.max(jx, box.left), box.right) : jx;
            const y = box ? Math.min(Math.max(jy, box.top), box.bottom) : jy;
            pip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
            pip.style.display = '';
            used++;
        }
        for (let i = used; i < this.pipPool.length; i++) {
            this.pipPool[i]!.style.display = 'none';
        }
    }

    private acquirePip(index: number): HTMLDivElement {
        let pip = this.pipPool[index];
        if (!pip) {
            pip = document.createElement('div');
            pip.className = 'horde-pip';
            applyIcon(pip, 'ui-horde');
            this.edgeView.appendChild(pip);
            this.pipPool.push(pip);
        }
        return pip;
    }

    /** Atlas stamp — expects `ui-horde` PNG alpha from the icon pipeline. */
    private stampIconCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = ICON_TEX_SIZE;
        canvas.height = ICON_TEX_SIZE;
        const ctx = canvas.getContext('2d')!;
        drawIcon(ctx, 'ui-horde', 0, 0, ICON_TEX_SIZE);
        return canvas;
    }

    private canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        return texture;
    }
}
