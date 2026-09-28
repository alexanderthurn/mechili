/**
 * Forest-ring horde locators: camera-facing `ui-horde` sprites above the
 * canopy, plus matching Pixi edge pips when a pack sits off-camera.
 * Visual-only.
 */
import { Container, Sprite as PixiSprite, Texture as PixiTexture } from 'pixi.js';
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
import { drawIcon } from '../ui/iconAtlas';

/** altitude above terrain — clears canopy */
const MARKER_HEIGHT = 55;
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

/** How far HUD chrome reaches in from each edge (CSS px) — see Hud.edgeInsets. */
export type EdgeInsets = { top: number; right: number; bottom: number; left: number };

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
/** edge pip diameter in Pixi pixels */
const PIP_SIZE = 40;
const ICON_TEX_SIZE = 128;

export type HordeMarkerSpot = {
    x: number;
    z: number;
    /** phase offset so neighboring markers don't bob in lockstep */
    seed: number;
};

/**
 * One marker per march-in horde pack. Hidden once `marchIn` clears (on-board).
 * Off-screen packs get a small `ui-horde` icon on the viewport edge.
 */
export class HordeMarkers {
    /** Pixi overlay — add to the stage alongside HP bars */
    readonly edgeView = new Container();
    private readonly pool: Sprite[] = [];
    private readonly pipPool: PixiSprite[] = [];
    private readonly material: SpriteMaterial;
    private readonly iconCanvas: HTMLCanvasElement;
    private readonly tmp = new Vector3();
    private pipTexture: PixiTexture | null = null;
    private used = 0;

    constructor(private readonly scene: Scene) {
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

    /** viewport of the last update — rimPoint measures the screen centre from it */
    private screenW = 0;
    private screenH = 0;

    update(
        timeSeconds: number,
        spots: readonly HordeMarkerSpot[],
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
        /** HUD chrome per edge — pips stay out of it (the HUD draws over the board) */
        insets: EdgeInsets = NO_INSETS,
    ): void {
        this.used = 0;
        this.screenW = viewW;
        this.screenH = viewH;
        const edgePts: { x: number; y: number; seed: number }[] = [];

        for (const spot of spots) {
            const sprite = this.acquire();
            const ground = worldHeightAt(spot.x, spot.z);
            const bob = Math.sin(timeSeconds * BOB_SPEED + spot.seed) * BOB_AMP;
            const y = ground + MARKER_HEIGHT + bob;
            sprite.position.set(spot.x, y, spot.z);
            this.used++;

            // One marker per pack: the world sprite while it stands in the
            // free area, the edge pip the moment it would leave it (behind the
            // camera, off screen, or under HUD chrome) — never both.
            //
            // The sprite decides WHEN to hand over (it is what the player sees
            // leave), the pack's feet decide WHERE the pip goes: aiming at the
            // sprite would point a little above the pack, which reads as the
            // wrong direction when a pack stands near the middle of the board.
            const box = this.safeBox(viewW, viewH, insets);
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
        this.syncEdgePips(edgePts, this.safeBox(viewW, viewH, insets));
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
        for (const pip of this.pipPool) pip.destroy();
        this.pipPool.length = 0;
        this.pipTexture?.destroy(true);
        this.pipTexture = null;
        this.edgeView.parent?.removeChild(this.edgeView);
        this.edgeView.destroy({ children: true });
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
    /**
     * The board area the HUD leaves free: the viewport minus its chrome, minus
     * the pip's own padding. Never smaller than a third of the screen — with a
     * crowded HUD a pip slightly under a panel still beats no pip at all.
     */
    private safeBox(
        viewW: number,
        viewH: number,
        insets: EdgeInsets,
    ): { left: number; right: number; top: number; bottom: number } {
        const pad = EDGE_PAD + PIP_JITTER;
        const minW = viewW / 3;
        const minH = viewH / 3;
        let left = pad + insets.left;
        let right = viewW - pad - insets.right;
        let top = pad + insets.top;
        let bottom = viewH - pad - insets.bottom;
        if (right - left < minW) {
            const mid = viewW * 0.5;
            left = mid - minW * 0.5;
            right = mid + minW * 0.5;
        }
        if (bottom - top < minH) {
            const mid = viewH * 0.5;
            top = mid - minH * 0.5;
            bottom = mid + minH * 0.5;
        }
        return { left, right, top, bottom };
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

    /**
     * Where the line from the player's eye to `aim` leaves the HUD-free area.
     *
     * The line starts in the middle of the SCREEN, not of the box: the box is
     * lopsided wherever the HUD is (a tall shop bottom-right), and starting
     * there would tilt every pip off its pack. Only the rim it stops at is the
     * box. A box that no longer holds the screen centre falls back to its own.
     */
    private rimPoint(
        aim: { x: number; y: number },
        box: { left: number; right: number; top: number; bottom: number },
    ): { x: number; y: number } {
        const viewCx = (box.left + box.right) * 0.5;
        const viewCy = (box.top + box.bottom) * 0.5;
        const screenX = this.screenW * 0.5;
        const screenY = this.screenH * 0.5;
        const centred =
            screenX > box.left && screenX < box.right && screenY > box.top && screenY < box.bottom;
        const cx = centred ? screenX : viewCx;
        const cy = centred ? screenY : viewCy;
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
        const tex = this.ensurePipTexture();
        let used = 0;
        if (tex) {
            for (const p of pts) {
                const pip = this.acquirePip(used, tex);
                // slight seed jitter so stacked edge hits don't fully overlap —
                // kept inside the free area, or it slides back under the HUD
                const jx = p.x + Math.sin(p.seed * 2.1) * PIP_JITTER;
                const jy = p.y + Math.cos(p.seed * 1.7) * PIP_JITTER;
                pip.x = box ? Math.min(Math.max(jx, box.left), box.right) : jx;
                pip.y = box ? Math.min(Math.max(jy, box.top), box.bottom) : jy;
                pip.visible = true;
                used++;
            }
        }
        for (let i = used; i < this.pipPool.length; i++) {
            this.pipPool[i]!.visible = false;
        }
    }

    private acquirePip(index: number, texture: PixiTexture): PixiSprite {
        let pip = this.pipPool[index];
        if (!pip) {
            pip = new PixiSprite(texture);
            pip.anchor.set(0.5);
            pip.width = PIP_SIZE;
            pip.height = PIP_SIZE;
            this.edgeView.addChild(pip);
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

    private ensurePipTexture(): PixiTexture | null {
        if (this.pipTexture) return this.pipTexture;
        this.pipTexture = PixiTexture.from(this.iconCanvas);
        return this.pipTexture;
    }
}
