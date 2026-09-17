/**
 * Dev landscape editor — open a match with `?editor=true` (add
 * `&landscape=<id>` to edit a bundled map). Left-drag brushes the outer ground
 * and the battle board as one landscape; paint surface and plants; Save
 * downloads `<id>.json` for `assets/data/landscapes/` (a static map a match
 * can name), Load opens such a file (or an older mountain-sculpt bake).
 *
 * Nothing is kept in the browser: while editing, the meshes are the truth (the
 * sim samples them live); outside the editor a match only ever plays a
 * bundled map file.
 */

import {
    Mesh,
    MeshBasicMaterial,
    Plane,
    Raycaster,
    Vector2,
    Vector3,
    type BufferAttribute,
    type Camera,
    type PerspectiveCamera,
    type Scene,
} from 'three';
import { createRangeRing } from './placement';
import { worldHeightAt } from './map';
import {
    applyLandscapeToBoardMesh,
    applyLandscapeToOuterGeometry,
    captureLandscape,
    decodeLandscape,
    encodeLandscape,
    isLandscapeFile,
    landscapeFits,
    latticeOf,
    MATERIAL_ATTR,
    MATERIAL_CHANNELS,
    type LandscapeBoard,
    type LandscapeData,
} from './landscape';
import { ensureOuterMaterialAttrs, paintOuterMaterial, type OuterMaterialKind } from './landscapeMaterials';
import {
    defaultPlantScale,
    plantMinSpacing,
    type AuthoredPlant,
    type PlantBrushKind,
    type PlantClearDisk,
} from './landscapePlants';
import type { VegetationKind } from './sceneryVegetation';

export type MountainBrush =
    | 'raise'
    | 'lower'
    | 'flatten'
    | 'lean'
    | 'mat-grass'
    | 'mat-rock'
    | 'mat-snow'
    | 'mat-beach'
    | 'mat-scree'
    | 'obj-oak'
    | 'obj-pine'
    | 'obj-bushRound'
    | 'obj-bushTall'
    | 'obj-erase';

/** the bake the first editor wrote (browser storage, v1/v2) — import-only now */
interface LegacyBake {
    version: 1 | 2;
    kind: 'mountain-sculpt';
    vertCount?: number;
    positions?: number[];
    board?: { vertCount: number; positions: number[] };
    heightfield?: { originX: number; originZ: number; size: number; res: number; heights: number[] };
    materials?: { originX: number; originZ: number; size: number; res: number } & Partial<Record<(typeof MATERIAL_CHANNELS)[number], number[]>>;
    plants?: AuthoredPlant[];
    plantClears?: PlantClearDisk[];
}

/** where the first editor kept its bake — read once for the import button, then removed */
const LEGACY_STORAGE_KEY = 'melodan.mountainBake.v1';

export function mountainEditorEnabled(): boolean {
    try {
        return new URLSearchParams(location.search).get('editor') === 'true';
    } catch {
        return false;
    }
}

export interface MountainEditorOpts {
    mesh: Mesh;
    /** Battle-map ground — brushed together with the outer ring. */
    boardMesh: Mesh;
    scene: Scene;
    camera: PerspectiveCamera;
    domElement: HTMLElement;
    map: LandscapeBoard;
    /** the map being edited (its id / name), null for the procedural terrain */
    landscape: LandscapeData | null;
    /** After a sculpt stroke / load / reset — rebind sim heights + deploy grid. */
    onLandscapeChanged?: () => void;
    /** Terrain editing switched on (true) or off to play the match normally (false). */
    onActiveChange?: (active: boolean) => void;
    /** Live plant paint/erase against scenery pools. */
    plants?: {
        getPlants: () => AuthoredPlant[];
        getClears: () => PlantClearDisk[];
        paint: (kind: VegetationKind, x: number, z: number, sc: number, yaw: number) => void;
        erase: (x: number, z: number, radius: number) => void;
        setAll: (plants: AuthoredPlant[], clears: PlantClearDisk[]) => void;
    };
}

export class MountainEditor {
    brush: MountainBrush = 'raise';
    radius = 28;
    strength = 2.2;
    private mesh: Mesh;
    private board: Mesh;
    private readonly camera: Camera;
    private readonly dom: HTMLElement;
    private readonly map: LandscapeBoard;
    private readonly halfW: number;
    private readonly halfH: number;
    private readonly raycaster = new Raycaster();
    private readonly ndc = new Vector2();
    private painting = false;
    /**
     * A height-changing stroke aims on a flat plane at the height it started
     * on: raising the ground under the brush would otherwise pull the ray's
     * hit toward the camera and walk the brush away from where you point.
     */
    private readonly strokePlane = new Plane(new Vector3(0, 1, 0), 0);
    private strokeLocked = false;
    private readonly strokeHit = new Vector3();
    /**
     * Terrain editing takes the board's left clicks and the brush keys; off
     * ("Play"), the match's own controls get them back — placing units,
     * casting spells — with the landscape as it is.
     */
    private editing = true;
    private readonly onActiveChange: ((active: boolean) => void) | null;
    private readonly panel: HTMLDivElement;
    private readonly disposers: (() => void)[] = [];
    /** the landscape as the editor opened — Reset returns to it, on any mesh */
    private baseline: LandscapeData | null = null;
    private readonly cursor: Mesh;
    private hover: { x: number; z: number } | null = null;
    /** Scratch lists for draping the cursor over nearby mesh verts. */
    private readonly nearX: number[] = [];
    private readonly nearY: number[] = [];
    private readonly nearZ: number[] = [];
    private radiusInput!: HTMLInputElement;
    private strengthInput!: HTMLInputElement;
    private idInput!: HTMLInputElement;
    private nameInput!: HTMLInputElement;
    private statusEl!: HTMLDivElement;
    private readonly onLandscapeChanged: (() => void) | null;
    private readonly plantsApi: NonNullable<MountainEditorOpts['plants']> | null;
    /** Min time between plant stamps while dragging. */
    private lastPlantStampMs = 0;

    constructor(opts: MountainEditorOpts) {
        this.mesh = opts.mesh;
        this.board = opts.boardMesh;
        this.camera = opts.camera;
        this.dom = opts.domElement;
        this.map = opts.map;
        this.halfW = opts.map.halfW;
        this.halfH = opts.map.halfH;
        this.onLandscapeChanged = opts.onLandscapeChanged ?? null;
        this.onActiveChange = opts.onActiveChange ?? null;
        this.plantsApi = opts.plants ?? null;
        ensureOuterMaterialAttrs(this.mesh.geometry);

        this.cursor = createRangeRing(opts.scene);
        const mat = this.cursor.material as MeshBasicMaterial;
        mat.color.setHex(0xd4b878);
        mat.opacity = 0.55;

        this.panel = this.buildPanel();
        document.body.appendChild(this.panel);

        const onDown = (e: PointerEvent) => {
            if (!this.editing || e.button !== 0) return;
            if ((e.target as HTMLElement).closest?.('.mtn-editor')) return;
            this.painting = true;
            this.dom.setPointerCapture(e.pointerId);
            this.onPointer(e.clientX, e.clientY, true);
            e.preventDefault();
            e.stopPropagation();
        };
        const onMove = (e: PointerEvent) => {
            if (!this.editing) return;
            if ((e.target as HTMLElement).closest?.('.mtn-editor')) return;
            this.onPointer(e.clientX, e.clientY, this.painting);
            if (this.painting) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        const onUp = (e: PointerEvent) => {
            if (!this.painting) return;
            this.painting = false;
            this.strokeLocked = false;
            try {
                this.dom.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
            if (!this.isMaterialBrush() && !this.isObjectBrush()) {
                this.mesh.geometry.computeVertexNormals();
                this.board.geometry.computeVertexNormals();
                this.onLandscapeChanged?.();
            }
            if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        };
        const onLeave = () => {
            if (this.painting) return;
            this.hover = null;
            this.cursor.visible = false;
        };

        this.dom.addEventListener('pointerdown', onDown, true);
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        this.dom.addEventListener('pointerleave', onLeave);
        const onKey = (e: KeyboardEvent) => this.onKeyDown(e);
        window.addEventListener('keydown', onKey, true);
        this.disposers.push(() => {
            this.dom.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            this.dom.removeEventListener('pointerleave', onLeave);
            window.removeEventListener('keydown', onKey, true);
        });

        this.idInput.value = opts.landscape?.id || 'landscape';
        this.nameInput.value = opts.landscape?.name || opts.landscape?.id || 'New landscape';
        // Reset returns here — also after a quality change rebuilt the meshes
        this.baseline = this.capture();
    }

    /** After scenery / ground rebuild (quality change) — point at the new meshes; Reset still returns to the start. */
    reattach(mesh: Mesh, boardMesh: Mesh): void {
        this.mesh = mesh;
        this.board = boardMesh;
        ensureOuterMaterialAttrs(this.mesh.geometry);
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
    }

    dispose(): void {
        for (const d of this.disposers) d();
        this.disposers.length = 0;
        this.panel.remove();
        this.cursor.removeFromParent();
        this.cursor.geometry.dispose();
        (this.cursor.material as MeshBasicMaterial).dispose();
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        // the key left of 1 (` on US, ^ on German keyboards) switches between editing the terrain and playing the match
        if (e.code === 'Backquote') {
            this.setEditing(!this.editing);
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (!this.editing) return;

        const brushByKey: Record<string, MountainBrush> = {
            '1': 'raise',
            '2': 'lower',
            '3': 'flatten',
            '4': 'lean',
            g: 'mat-grass',
            k: 'mat-rock',
            n: 'mat-snow',
            h: 'mat-beach',
            c: 'mat-scree',
            o: 'obj-oak',
            p: 'obj-pine',
            b: 'obj-bushRound',
            t: 'obj-bushTall',
            x: 'obj-erase',
        };
        const brush = brushByKey[e.key.toLowerCase()];
        if (brush) {
            this.setBrush(brush);
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // 5/6 radius up/down · 7/8 strength up/down
        if (e.key === '5' || e.key === '6' || e.key === '7' || e.key === '8') {
            if (e.key === '5') this.nudgeRadius(4);
            else if (e.key === '6') this.nudgeRadius(-4);
            else if (e.key === '7') this.nudgeStrength(5);
            else this.nudgeStrength(-5);
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private isMaterialBrush(): boolean {
        return this.brush.startsWith('mat-');
    }

    private isObjectBrush(): boolean {
        return this.brush.startsWith('obj-');
    }

    private materialKind(): OuterMaterialKind | null {
        switch (this.brush) {
            case 'mat-grass':
                return 'grass';
            case 'mat-rock':
                return 'rock';
            case 'mat-snow':
                return 'snow';
            case 'mat-beach':
                return 'beach';
            case 'mat-scree':
                return 'scree';
            default:
                return null;
        }
    }

    private objectKind(): PlantBrushKind | null {
        switch (this.brush) {
            case 'obj-oak':
                return 'oak';
            case 'obj-pine':
                return 'pine';
            case 'obj-bushRound':
                return 'bushRound';
            case 'obj-bushTall':
                return 'bushTall';
            case 'obj-erase':
                return 'erase';
            default:
                return null;
        }
    }

    private setBrush(brush: MountainBrush): void {
        this.brush = brush;
        for (const input of this.panel.querySelectorAll<HTMLInputElement>('input[name="mtn-brush"]')) {
            input.checked = input.value === brush;
        }
        for (const lab of this.panel.querySelectorAll('label.tool')) {
            lab.classList.toggle('active', lab.querySelector('input')?.checked === true);
        }
    }

    private nudgeRadius(delta: number): void {
        const min = Number(this.radiusInput.min);
        const max = Number(this.radiusInput.max);
        this.radius = Math.min(max, Math.max(min, this.radius + delta));
        this.radiusInput.value = String(Math.round(this.radius));
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
    }

    private nudgeStrength(delta: number): void {
        // Slider is strength×10 (min 5 … max 80).
        const min = Number(this.strengthInput.min);
        const max = Number(this.strengthInput.max);
        const next = Math.min(max, Math.max(min, Math.round(this.strength * 10) + delta));
        this.strength = next / 10;
        this.strengthInput.value = String(next);
    }

    private onPointer(clientX: number, clientY: number, paint: boolean): void {
        const hit = this.pick(clientX, clientY, paint);
        if (!hit) {
            this.hover = null;
            this.cursor.visible = false;
            return;
        }
        this.hover = { x: hit.x, z: hit.z };
        if (paint) this.applyBrush(hit.x, hit.z);
        this.drapeCursor(hit.x, hit.z);
    }

    private pick(clientX: number, clientY: number, painting = false): Vector3 | null {
        const rect = this.dom.getBoundingClientRect();
        this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.ndc, this.camera);
        // mid-stroke with a height brush: stay on the plane the stroke started on
        if (painting && this.strokeLocked) {
            const onPlane = this.raycaster.ray.intersectPlane(this.strokePlane, this.strokeHit);
            if (onPlane) return onPlane;
        }
        const hits = this.raycaster.intersectObjects([this.board, this.mesh], false);
        const hit = hits.length ? hits[0]!.point : null;
        if (painting && hit && !this.strokeLocked && this.changesHeight()) {
            this.strokePlane.constant = -hit.y;
            this.strokeLocked = true;
        }
        return hit;
    }

    /** raise / lower / flatten / lean move the surface itself (paint and plants don't) */
    private changesHeight(): boolean {
        return !this.isMaterialBrush() && !this.isObjectBrush();
    }

    private gatherNear(cx: number, cz: number, gatherR2: number): void {
        const xs = this.nearX;
        const ys = this.nearY;
        const zs = this.nearZ;
        xs.length = 0;
        ys.length = 0;
        zs.length = 0;
        const addMesh = (mesh: Mesh) => {
            const pos = mesh.geometry.attributes.position as BufferAttribute;
            const yOff = mesh.position.y;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const z = pos.getZ(i);
                const dx = x - cx;
                const dz = z - cz;
                if (dx * dx + dz * dz > gatherR2) continue;
                xs.push(x);
                ys.push(pos.getY(i) + yOff);
                zs.push(z);
            }
        };
        addMesh(this.mesh);
        addMesh(this.board);
    }

    /**
     * Placement-style draped ring: Y follows sculpted board + outer mesh.
     */
    private drapeCursor(cx: number, cz: number): void {
        const r = this.radius;
        this.gatherNear(cx, cz, (r + 12) * (r + 12));
        const xs = this.nearX;
        const ys = this.nearY;
        const zs = this.nearZ;

        const sampleY = (wx: number, wz: number): number => {
            let best = Infinity;
            let y = 0;
            for (let i = 0; i < xs.length; i++) {
                const ddx = xs[i]! - wx;
                const ddz = zs[i]! - wz;
                const d2 = ddx * ddx + ddz * ddz;
                if (d2 < best) {
                    best = d2;
                    y = ys[i]!;
                }
            }
            return Number.isFinite(best) ? y : worldHeightAt(wx, wz);
        };

        const anchorY = sampleY(cx, cz);
        const cpos = this.cursor.geometry.attributes.position!;
        for (let i = 0; i < cpos.count; i++) {
            const wx = cx + cpos.getX(i) * r;
            const wz = cz + cpos.getZ(i) * r;
            cpos.setY(i, sampleY(wx, wz) - anchorY);
        }
        cpos.needsUpdate = true;
        this.cursor.position.set(cx, 0.12 + anchorY, cz);
        this.cursor.scale.set(r, 1, r);
        this.cursor.renderOrder = 10;
        this.cursor.visible = true;
    }

    private applyBrush(cx: number, cz: number): void {
        const obj = this.objectKind();
        if (obj) {
            this.applyObjectBrush(obj, cx, cz);
            return;
        }

        const kind = this.materialKind();
        if (kind) {
            ensureOuterMaterialAttrs(this.mesh.geometry);
            paintOuterMaterial(this.mesh, kind, cx, cz, this.radius, this.strength);
            return;
        }

        const r = this.radius;
        const r2 = r * r;
        const str = this.strength;

        let avgWorldY = 0;
        if (this.brush === 'flatten') {
            let sumY = 0;
            let nY = 0;
            const accum = (mesh: Mesh) => {
                const pos = mesh.geometry.attributes.position as BufferAttribute;
                const yOff = mesh.position.y;
                for (let i = 0; i < pos.count; i++) {
                    const dx = pos.getX(i) - cx;
                    const dz = pos.getZ(i) - cz;
                    if (dx * dx + dz * dz > r2) continue;
                    sumY += pos.getY(i) + yOff;
                    nY++;
                }
            };
            accum(this.mesh);
            accum(this.board);
            avgWorldY = nY > 0 ? sumY / nY : 0;
        }

        this.sculptMesh(this.mesh, cx, cz, r, r2, str, avgWorldY);
        this.sculptMesh(this.board, cx, cz, r, r2, str, avgWorldY);
    }

    private applyObjectBrush(kind: PlantBrushKind, cx: number, cz: number): void {
        if (!this.plantsApi) return;
        if (kind === 'erase') {
            const now = performance.now();
            if (now - this.lastPlantStampMs < 40) return;
            this.lastPlantStampMs = now;
            this.plantsApi.erase(cx, cz, this.radius);
            return;
        }

        const now = performance.now();
        // Stronger brush → faster stamp rate
        const gap = Math.max(35, 140 - this.strength * 12);
        if (now - this.lastPlantStampMs < gap) return;
        this.lastPlantStampMs = now;

        const plants = this.plantsApi.getPlants();
        const spacing = plantMinSpacing(kind);
        const spacing2 = spacing * spacing;
        const tries = 1 + Math.floor(this.strength / 3);
        for (let t = 0; t < tries; t++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = Math.random() * this.radius * 0.92;
            const x = cx + Math.cos(ang) * dist;
            const z = cz + Math.sin(ang) * dist;
            let ok = true;
            for (const p of plants) {
                const dx = p.x - x;
                const dz = p.z - z;
                if (dx * dx + dz * dz < spacing2) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
            const sc = defaultPlantScale(kind) * (0.85 + Math.random() * 0.35);
            const yaw = Math.random() * Math.PI * 2;
            this.plantsApi.paint(kind, x, z, sc, yaw);
            plants.push({ kind, x, z, sc, yaw });
        }
    }

    private sculptMesh(
        mesh: Mesh,
        cx: number,
        cz: number,
        r: number,
        r2: number,
        str: number,
        avgWorldY: number,
    ): void {
        const pos = mesh.geometry.attributes.position as BufferAttribute;
        const yOff = mesh.position.y;
        for (let i = 0; i < pos.count; i++) {
            let x = pos.getX(i);
            let yWorld = pos.getY(i) + yOff;
            let z = pos.getZ(i);
            const dx = x - cx;
            const dz = z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 > r2) continue;
            const fall = 1 - Math.sqrt(d2) / r;
            const w = fall * fall;

            if (this.brush === 'raise') {
                yWorld += str * w;
            } else if (this.brush === 'lower') {
                yWorld -= str * w;
            } else if (this.brush === 'flatten') {
                yWorld = yWorld * (1 - w * 0.85) + avgWorldY * (w * 0.85);
            } else if (this.brush === 'lean') {
                const wx = Math.max(0, Math.abs(x) - this.halfW);
                const wz = Math.max(0, Math.abs(z) - this.halfH);
                const d = Math.hypot(wx, wz) || 1;
                const fwdX = ((x < -this.halfW ? -1 : x > this.halfW ? 1 : 0) * wx) / d;
                const fwdZ = ((z < -this.halfH ? -1 : z > this.halfH ? 1 : 0) * wz) / d;
                const hLean = Math.min(1, Math.max(0, (yWorld - 20) / 180));
                const lean = str * 3 * w * hLean * hLean;
                x -= fwdX * lean;
                z -= fwdZ * lean;
            }
            pos.setXYZ(i, x, yWorld - yOff, z);
        }
        pos.needsUpdate = true;
    }

    /** the landscape the editor shows right now (null if the meshes can't be read) */
    capture(): LandscapeData | null {
        return captureLandscape({
            id: this.currentId(),
            name: this.nameInput?.value.trim() || this.currentId(),
            map: this.map,
            boardMesh: this.board,
            outerMesh: this.mesh,
            plants: this.plantsApi?.getPlants() ?? [],
            plantClears: this.plantsApi?.getClears() ?? [],
        });
    }

    private currentId(): string {
        const raw = this.idInput?.value ?? '';
        return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'landscape';
    }

    private setStatus(text: string): void {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    /** show a landscape on the meshes: board relief, outer heights / lean / paint, plants */
    private applyData(data: LandscapeData): void {
        if (!landscapeFits(data, this.map)) {
            this.setStatus(`"${data.id}" is made for a ${data.map.cols}×${data.map.rows} board, this one is ${this.map.cols}×${this.map.rows}`);
            return;
        }
        applyLandscapeToBoardMesh(this.board, data);
        ensureOuterMaterialAttrs(this.mesh.geometry);
        applyLandscapeToOuterGeometry(this.mesh.geometry, data, { heights: true });
        this.mesh.geometry.computeVertexNormals();
        this.plantsApi?.setAll(data.plants, data.plantClears);
        this.onLandscapeChanged?.();
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
    }

    save(): void {
        const data = this.capture();
        if (!data) {
            this.setStatus('Could not read the landscape from the meshes');
            return;
        }
        const text = JSON.stringify(encodeLandscape(data));
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.id}.json`;
        a.click();
        // revoking right away can cancel the download in some browsers
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        this.setStatus(`Saved ${data.id}.json (${Math.round(text.length / 1024)} KB) — put it in assets/data/landscapes/`);
    }

    loadFromFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
                try {
                    this.loadJson(JSON.parse(text), file.name.replace(/\.json$/i, ''));
                } catch (e) {
                    this.setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            });
        };
        input.click();
    }

    private loadJson(raw: unknown, fallbackId: string): void {
        if (isLandscapeFile(raw)) {
            const data = decodeLandscape(raw);
            if (!data.id) data.id = fallbackId;
            this.idInput.value = data.id;
            this.nameInput.value = data.name || data.id;
            this.applyData(data);
            this.setStatus(`Loaded ${data.id}`);
            return;
        }
        const legacy = raw as Partial<LegacyBake> | null;
        if (legacy?.kind === 'mountain-sculpt' && (legacy.version === 1 || legacy.version === 2)) {
            this.importLegacy(legacy as LegacyBake);
            return;
        }
        throw new Error('not a landscape file');
    }

    /**
     * An older bake: its heightfield was rounded down into 5 wu cells (so each
     * value belongs half a cell further +X/+Z) — sampled back at the right
     * place; vertex dumps restore the exact meshes when their topology matches.
     */
    private importLegacy(bake: LegacyBake): void {
        const boardPos = this.board.geometry.attributes.position as BufferAttribute;
        const outerPos = this.mesh.geometry.attributes.position as BufferAttribute;
        const dumpFits = (dump: { vertCount?: number; positions?: number[] } | undefined, pos: BufferAttribute) =>
            !!dump?.positions && dump.vertCount === pos.count && dump.positions.length === pos.count * 3;
        const restore = (dump: { positions?: number[] }, pos: BufferAttribute) => {
            for (let i = 0; i < pos.count; i++) pos.setXYZ(i, dump.positions![i * 3]!, dump.positions![i * 3 + 1]!, dump.positions![i * 3 + 2]!);
            pos.needsUpdate = true;
        };
        const hf = bake.heightfield;
        const shifted = (grid: { originX: number; originZ: number; size: number; res: number }, values: number[]) => {
            const cell = grid.size / Math.max(1, grid.res - 1);
            return (x: number, z: number) => {
                const fx = (x - cell * 0.5 - grid.originX) / cell;
                const fz = (z - cell * 0.5 - grid.originZ) / cell;
                const x0 = Math.min(grid.res - 2, Math.max(0, Math.floor(fx)));
                const z0 = Math.min(grid.res - 2, Math.max(0, Math.floor(fz)));
                const tx = Math.min(1, Math.max(0, fx - x0));
                const tz = Math.min(1, Math.max(0, fz - z0));
                const i = z0 * grid.res + x0;
                const y0 = values[i]! * (1 - tx) + values[i + 1]! * tx;
                const y1 = values[i + grid.res]! * (1 - tx) + values[i + grid.res + 1]! * tx;
                return y0 * (1 - tz) + y1 * tz;
            };
        };
        if (dumpFits(bake.board, boardPos)) restore(bake.board!, boardPos);
        else if (hf) {
            const h = shifted(hf, hf.heights);
            for (let i = 0; i < boardPos.count; i++) boardPos.setY(i, h(boardPos.getX(i), boardPos.getZ(i)) - this.board.position.y);
            boardPos.needsUpdate = true;
        } else {
            this.setStatus('This bake has neither a heightfield nor matching vertex data');
            return;
        }
        if (dumpFits(bake, outerPos)) restore(bake, outerPos);
        else if (hf) {
            const lat = latticeOf(this.mesh.geometry);
            const h = shifted(hf, hf.heights);
            for (let v = 0; v < outerPos.count; v++) {
                const x = lat ? lat.xs[lat.vix[v]!]! : outerPos.getX(v);
                const z = lat ? lat.zs[lat.viz[v]!]! : outerPos.getZ(v);
                const inside = Math.abs(x) <= this.halfW && Math.abs(z) <= this.halfH;
                outerPos.setXYZ(v, x, inside ? 0 : h(x, z), z);
            }
            outerPos.needsUpdate = true;
        }
        if (bake.materials) {
            ensureOuterMaterialAttrs(this.mesh.geometry);
            const lat = latticeOf(this.mesh.geometry);
            for (const ch of MATERIAL_CHANNELS) {
                const values = bake.materials[ch];
                if (!values) continue;
                const sample = shifted(bake.materials, values);
                const attr = this.mesh.geometry.getAttribute(MATERIAL_ATTR[ch]) as BufferAttribute;
                for (let v = 0; v < attr.count; v++) {
                    const x = lat ? lat.xs[lat.vix[v]!]! : outerPos.getX(v);
                    const z = lat ? lat.zs[lat.viz[v]!]! : outerPos.getZ(v);
                    attr.setX(v, sample(x, z));
                }
                attr.needsUpdate = true;
            }
        }
        this.board.geometry.computeVertexNormals();
        this.mesh.geometry.computeVertexNormals();
        this.plantsApi?.setAll(bake.plants ?? [], bake.plantClears ?? []);
        this.onLandscapeChanged?.();
        this.setStatus('Imported an older bake — Save writes it as a landscape file');
    }

    /** the bake the first editor left in browser storage: import it once, then drop it */
    private importBrowserBake(): void {
        try {
            const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (!raw) {
                this.setStatus('No browser bake found');
                return;
            }
            this.loadJson(JSON.parse(raw), 'landscape');
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            this.panel.querySelector<HTMLButtonElement>('.import-browser')?.remove();
        } catch (e) {
            this.setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** whether terrain editing currently owns the board's clicks and brush keys */
    get active(): boolean {
        return this.editing;
    }

    setEditing(on: boolean): void {
        if (this.editing === on) return;
        this.editing = on;
        if (!on) {
            this.painting = false;
            this.strokeLocked = false;
            this.hover = null;
            this.cursor.visible = false;
        }
        this.panel.classList.toggle('playing', !on);
        const toggle = this.panel.querySelector<HTMLButtonElement>('.mode');
        if (toggle) toggle.textContent = on ? 'Editing terrain — Play (^ / `)' : 'Playing — Edit terrain (^ / `)';
        this.onActiveChange?.(on);
    }

    resetToBase(): void {
        if (this.baseline) this.applyData(this.baseline);
    }

    private hasLegacyBrowserBake(): boolean {
        try {
            return localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    }

    private buildPanel(): HTMLDivElement {
        const el = document.createElement('div');
        el.className = 'mtn-editor';
        el.innerHTML = `
<style>
.mtn-editor{position:fixed;left:12px;bottom:12px;z-index:99999;font:13px/1.35 system-ui,sans-serif;
  background:rgba(22,18,14,.94);color:#f0e8d8;border:1px solid #8a6d4a;border-radius:8px;
  padding:10px 12px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:auto}
.mtn-editor h3{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#d4b878}
.mtn-editor .row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.mtn-editor button,.mtn-editor label.tool{appearance:none;border:1px solid #5c4634;background:#2a221a;
  color:#f0e8d8;border-radius:5px;padding:5px 8px;cursor:pointer;font:inherit}
.mtn-editor button:hover,.mtn-editor label.tool:hover{border-color:#d4b878}
.mtn-editor label.tool.active{background:#4a3828;border-color:#d4b878;color:#d4b878}
.mtn-editor label.tool input{display:none}
.mtn-editor kbd{font:10px/1 ui-monospace,monospace;opacity:.65;margin-left:2px}
.mtn-editor .sliders{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;margin-top:8px}
.mtn-editor .hint{margin-top:8px;opacity:.7;font-size:11px}
.mtn-editor.playing > :not(h3):not(.row:first-of-type){display:none}
.mtn-editor .mode{width:100%}
.mtn-editor .status{margin-top:6px;font-size:11px;color:#d4b878;min-height:1em;max-width:320px}
.mtn-editor input[type=text]{background:#2a221a;border:1px solid #5c4634;color:#f0e8d8;border-radius:4px;padding:3px 6px;font:inherit}
</style>
<h3>Mountain editor</h3>
<div class="row"><button type="button" class="mode" title="The key left of 1">Editing terrain — Play (^ / \`)</button></div>
<div class="row tools">
  <label class="tool active"><input type="radio" name="mtn-brush" value="raise" checked>Raise <kbd>1</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="lower">Lower <kbd>2</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="flatten">Flatten <kbd>3</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="lean">Lean <kbd>4</kbd></label>
</div>
<div class="row tools">
  <label class="tool"><input type="radio" name="mtn-brush" value="mat-grass">Grass <kbd>G</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="mat-rock">Rock <kbd>K</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="mat-snow">Snow <kbd>N</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="mat-beach">Beach <kbd>H</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="mat-scree">Scree <kbd>C</kbd></label>
</div>
<div class="row tools">
  <label class="tool"><input type="radio" name="mtn-brush" value="obj-oak">Oak <kbd>O</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="obj-pine">Pine <kbd>P</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="obj-bushRound">Bush <kbd>B</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="obj-bushTall">Tall <kbd>T</kbd></label>
  <label class="tool"><input type="radio" name="mtn-brush" value="obj-erase">Erase <kbd>X</kbd></label>
</div>
<div class="sliders">
  <span>Radius <kbd>5</kbd>/<kbd>6</kbd></span><input type="range" class="r" min="8" max="120" value="28">
  <span>Strength <kbd>7</kbd>/<kbd>8</kbd></span><input type="range" class="s" min="5" max="80" value="22">
</div>
<div class="sliders">
  <span>Map id</span><input type="text" class="map-id" spellcheck="false" autocomplete="off">
  <span>Name</span><input type="text" class="map-name" spellcheck="false" autocomplete="off">
</div>
<div class="row">
  <button type="button" class="save">Save</button>
  <button type="button" class="load">Load</button>
  <button type="button" class="reset">Reset</button>
  <button type="button" class="import-browser" hidden>Import browser bake</button>
</div>
<div class="status"></div>
<div class="hint">Sculpt · paint · plants (outer + board) · Save downloads &lt;id&gt;.json for assets/data/landscapes/ · play it with ?landscape=&lt;id&gt;</div>`;

        const tools = el.querySelectorAll<HTMLInputElement>('input[name="mtn-brush"]');
        for (const input of tools) {
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.setBrush(input.value as MountainBrush);
            });
        }
        this.radiusInput = el.querySelector<HTMLInputElement>('.r')!;
        this.strengthInput = el.querySelector<HTMLInputElement>('.s')!;
        this.radiusInput.addEventListener('input', () => {
            this.radius = Number(this.radiusInput.value);
            if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        });
        this.strengthInput.addEventListener('input', () => {
            this.strength = Number(this.strengthInput.value) / 10;
        });
        this.radius = Number(this.radiusInput.value);
        this.strength = Number(this.strengthInput.value) / 10;

        this.idInput = el.querySelector<HTMLInputElement>('.map-id')!;
        this.nameInput = el.querySelector<HTMLInputElement>('.map-name')!;
        this.statusEl = el.querySelector<HTMLDivElement>('.status')!;
        el.querySelector('.mode')!.addEventListener('click', () => this.setEditing(!this.editing));
        el.querySelector('.save')!.addEventListener('click', () => this.save());
        el.querySelector('.load')!.addEventListener('click', () => this.loadFromFile());
        el.querySelector('.reset')!.addEventListener('click', () => this.resetToBase());
        const importBrowser = el.querySelector<HTMLButtonElement>('.import-browser')!;
        importBrowser.hidden = !this.hasLegacyBrowserBake();
        importBrowser.addEventListener('click', () => this.importBrowserBake());

        // Don't let panel clicks hit the canvas
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        // A slider or button keeps keyboard focus after a click, and the camera
        // ignores keys aimed at inputs — hand focus back so WASD keeps working.
        // Text fields keep it while typing (Enter / Escape give it back).
        const release = () => {
            const active = document.activeElement as HTMLElement | null;
            if (!active || !el.contains(active)) return;
            if (active instanceof HTMLInputElement && active.type === 'text') return;
            active.blur();
        };
        el.addEventListener('pointerup', () => requestAnimationFrame(release));
        el.addEventListener('change', () => requestAnimationFrame(release));
        for (const field of [this.idInput, this.nameInput]) {
            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === 'Escape') field.blur();
            });
        }
        return el;
    }
}
