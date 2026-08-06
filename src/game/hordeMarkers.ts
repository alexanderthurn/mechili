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
    private readonly tmp = new Vector3();
    private pipTexture: PixiTexture | null = null;
    private used = 0;

    constructor(private readonly scene: Scene) {
        this.material = new SpriteMaterial({
            map: this.paintIconTexture(),
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
    ): void {
        this.used = 0;
        const edgePts: { x: number; y: number; seed: number }[] = [];

        for (const spot of spots) {
            const sprite = this.acquire();
            const ground = worldHeightAt(spot.x, spot.z);
            const bob = Math.sin(timeSeconds * BOB_SPEED + spot.seed) * BOB_AMP;
            const y = ground + MARKER_HEIGHT + bob;
            sprite.position.set(spot.x, y, spot.z);
            sprite.visible = true;
            this.used++;

            const edge = this.projectToEdge(spot.x, y, spot.z, camera, viewW, viewH);
            if (edge) edgePts.push({ ...edge, seed: spot.seed });
        }
        for (let i = this.used; i < this.pool.length; i++) {
            this.pool[i]!.visible = false;
        }
        this.syncEdgePips(edgePts);
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
    private projectToEdge(
        x: number,
        y: number,
        z: number,
        camera: PerspectiveCamera,
        viewW: number,
        viewH: number,
    ): { x: number; y: number } | null {
        this.tmp.set(x, y, z).project(camera);
        // behind camera: flip so the pip sits on the opposite rim
        if (this.tmp.z > 1) {
            this.tmp.x = -this.tmp.x;
            this.tmp.y = -this.tmp.y;
        }
        const sx = (this.tmp.x * 0.5 + 0.5) * viewW;
        const sy = (1 - (this.tmp.y * 0.5 + 0.5)) * viewH;

        if (
            sx >= EDGE_PAD &&
            sx <= viewW - EDGE_PAD &&
            sy >= EDGE_PAD &&
            sy <= viewH - EDGE_PAD &&
            this.tmp.z <= 1
        ) {
            return null;
        }

        const cx = viewW * 0.5;
        const cy = viewH * 0.5;
        let dx = sx - cx;
        let dy = sy - cy;
        if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
            dx = 0;
            dy = -1;
        }
        const hx = viewW * 0.5 - EDGE_PAD;
        const hy = viewH * 0.5 - EDGE_PAD;
        const t = Math.min(hx / Math.abs(dx), hy / Math.abs(dy));
        return { x: cx + dx * t, y: cy + dy * t };
    }

    private syncEdgePips(pts: readonly { x: number; y: number; seed: number }[]): void {
        const tex = this.ensurePipTexture();
        let used = 0;
        if (tex) {
            for (const p of pts) {
                const pip = this.acquirePip(used, tex);
                // slight seed jitter so stacked edge hits don't fully overlap
                pip.x = p.x + Math.sin(p.seed * 2.1) * 6;
                pip.y = p.y + Math.cos(p.seed * 1.7) * 6;
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

    /** Atlas stamp for the world sprite (same art as rune badges). */
    private paintIconTexture(): CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = ICON_TEX_SIZE;
        canvas.height = ICON_TEX_SIZE;
        const ctx = canvas.getContext('2d')!;
        drawIcon(ctx, 'ui-horde', 0, 0, ICON_TEX_SIZE);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        return texture;
    }

    /** Pixi copy of the same icon for edge pips. */
    private ensurePipTexture(): PixiTexture | null {
        if (this.pipTexture) return this.pipTexture;
        const map = this.material.map;
        if (!map || !(map.image instanceof HTMLCanvasElement)) return null;
        this.pipTexture = PixiTexture.from(map.image);
        return this.pipTexture;
    }
}
