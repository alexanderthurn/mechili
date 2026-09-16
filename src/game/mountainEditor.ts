/**
 * Dev mountain sculptor — activate with `?editor=true` on a match URL.
 * Left-drag brushes outer ground + battle board for a continuous landscape;
 * Save / Load via the floating panel.
 */

import {
    Mesh,
    MeshBasicMaterial,
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
    applyHeightfieldToMesh,
    applyHeightfieldToPositions,
    rasterizeLandscapeHeightfield,
    type LandscapeHeightfield,
} from './landscapeHeight';
import {
    applyMaterialFieldsToMesh,
    ensureOuterMaterialAttrs,
    paintOuterMaterial,
    rasterizeOuterMaterials,
    type OuterMaterialFields,
    type OuterMaterialKind,
} from './landscapeMaterials';
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

export interface MountainBakeBoard {
    vertCount: number;
    positions: number[];
}

/**
 * Authored landscape. `heightfield` is the quality-independent source of truth
 * (sim + any-quality mesh drape). Optional vert dumps help Ultra editor reload
 * when the mesh topology still matches.
 */
export interface MountainBake {
    version: 1 | 2;
    kind: 'mountain-sculpt';
    /** @deprecated v1 — use heightfield. Kept for Ultra exact reload when counts match. */
    vertCount?: number;
    positions?: number[];
    board?: MountainBakeBoard;
    /** World Y grid — preferred apply path on every scenery tier. */
    heightfield?: LandscapeHeightfield;
    /** Outer material weights (grass/rock/snow/beach/scree), same grid as heightfield. */
    materials?: OuterMaterialFields;
    /** Hand-placed trees/bushes (XZ + scale); Y from world height on load. */
    plants?: AuthoredPlant[];
    /** Disks that suppress procedural vegetation on reload + live erase. */
    plantClears?: PlantClearDisk[];
}

const STORAGE_KEY = 'melodan.mountainBake.v1';

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
    halfW: number;
    halfH: number;
    /** After a sculpt stroke / load / reset — rebind sim heights + deploy grid. */
    onLandscapeChanged?: () => void;
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
    private readonly halfW: number;
    private readonly halfH: number;
    private readonly raycaster = new Raycaster();
    private readonly ndc = new Vector2();
    private painting = false;
    private readonly panel: HTMLDivElement;
    private readonly disposers: (() => void)[] = [];
    private basePositions: Float32Array;
    private boardBasePositions: Float32Array;
    private matBaseGrass: Float32Array;
    private matBaseRock: Float32Array;
    private matBaseSnow: Float32Array;
    private matBaseBeach: Float32Array;
    private matBaseScree: Float32Array;
    private readonly cursor: Mesh;
    private hover: { x: number; z: number } | null = null;
    /** Scratch lists for draping the cursor over nearby mesh verts. */
    private readonly nearX: number[] = [];
    private readonly nearY: number[] = [];
    private readonly nearZ: number[] = [];
    private radiusInput!: HTMLInputElement;
    private strengthInput!: HTMLInputElement;
    private readonly onLandscapeChanged: (() => void) | null;
    private readonly plantsApi: NonNullable<MountainEditorOpts['plants']> | null;
    /** Authored plants snapshot at construct / reattach (Reset). */
    private basePlants: AuthoredPlant[] = [];
    private basePlantClears: PlantClearDisk[] = [];
    /** Min time between plant stamps while dragging. */
    private lastPlantStampMs = 0;

    constructor(opts: MountainEditorOpts) {
        this.mesh = opts.mesh;
        this.board = opts.boardMesh;
        this.camera = opts.camera;
        this.dom = opts.domElement;
        this.halfW = opts.halfW;
        this.halfH = opts.halfH;
        this.onLandscapeChanged = opts.onLandscapeChanged ?? null;
        this.plantsApi = opts.plants ?? null;
        if (this.plantsApi) {
            this.basePlants = this.plantsApi.getPlants().map((p) => ({ ...p }));
            this.basePlantClears = this.plantsApi.getClears().map((c) => ({ ...c }));
        }
        const pos = this.mesh.geometry.attributes.position!;
        this.basePositions = new Float32Array(pos.array as ArrayLike<number>);
        const bpos = this.board.geometry.attributes.position!;
        this.boardBasePositions = new Float32Array(bpos.array as ArrayLike<number>);
        this.matBaseGrass = new Float32Array(0);
        this.matBaseRock = new Float32Array(0);
        this.matBaseSnow = new Float32Array(0);
        this.matBaseBeach = new Float32Array(0);
        this.matBaseScree = new Float32Array(0);
        this.captureMaterialBases();

        this.cursor = createRangeRing(opts.scene);
        const mat = this.cursor.material as MeshBasicMaterial;
        mat.color.setHex(0xd4b878);
        mat.opacity = 0.55;

        this.panel = this.buildPanel();
        document.body.appendChild(this.panel);

        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest?.('.mtn-editor')) return;
            this.painting = true;
            this.dom.setPointerCapture(e.pointerId);
            this.onPointer(e.clientX, e.clientY, true);
            e.preventDefault();
            e.stopPropagation();
        };
        const onMove = (e: PointerEvent) => {
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
    }

    /** After scenery / ground rebuild — point at the new meshes. */
    reattach(mesh: Mesh, boardMesh: Mesh): void {
        this.mesh = mesh;
        this.board = boardMesh;
        const pos = mesh.geometry.attributes.position!;
        this.basePositions = new Float32Array(pos.array as ArrayLike<number>);
        const bpos = boardMesh.geometry.attributes.position!;
        this.boardBasePositions = new Float32Array(bpos.array as ArrayLike<number>);
        this.captureMaterialBases();
        if (this.plantsApi) {
            this.basePlants = this.plantsApi.getPlants().map((p) => ({ ...p }));
            this.basePlantClears = this.plantsApi.getClears().map((c) => ({ ...c }));
        }
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
        const hit = this.pick(clientX, clientY);
        if (!hit) {
            this.hover = null;
            this.cursor.visible = false;
            return;
        }
        this.hover = { x: hit.x, z: hit.z };
        if (paint) this.applyBrush(hit.x, hit.z);
        this.drapeCursor(hit.x, hit.z);
    }

    private pick(clientX: number, clientY: number): Vector3 | null {
        const rect = this.dom.getBoundingClientRect();
        this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.ndc, this.camera);
        const hits = this.raycaster.intersectObjects([this.board, this.mesh], false);
        return hits.length ? hits[0]!.point : null;
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

    private serializeMesh(mesh: Mesh): MountainBakeBoard {
        const pos = mesh.geometry.attributes.position!;
        const positions: number[] = [];
        for (let i = 0; i < pos.count; i++) {
            positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        }
        return { vertCount: pos.count, positions };
    }

    private serialize(): MountainBake {
        const outer = this.serializeMesh(this.mesh);
        const heightfield = rasterizeLandscapeHeightfield(this.board, this.mesh, {
            halfW: this.halfW,
            halfH: this.halfH,
        });
        return {
            version: 2,
            kind: 'mountain-sculpt',
            heightfield,
            materials: rasterizeOuterMaterials(this.mesh, {
                halfW: this.halfW,
                halfH: this.halfH,
            }),
            plants: this.plantsApi?.getPlants().map((p) => ({ ...p })) ?? [],
            plantClears: this.plantsApi?.getClears().map((c) => ({ ...c })) ?? [],
            // Ultra vert dumps — exact reload when topology matches.
            vertCount: outer.vertCount,
            positions: outer.positions,
            board: this.serializeMesh(this.board),
        };
    }

    private applyMeshBake(mesh: Mesh, part: MountainBakeBoard, label: string): boolean {
        const pos = mesh.geometry.attributes.position!;
        if (part.vertCount !== pos.count || part.positions.length !== pos.count * 3) {
            return false;
        }
        for (let i = 0; i < pos.count; i++) {
            pos.setXYZ(i, part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!);
        }
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        return true;
    }

    private applyBake(bake: MountainBake): void {
        // Prefer heightfield (works on any scenery tier). Vert dumps only when counts match.
        if (bake.heightfield) {
            applyHeightfieldToMesh(this.mesh, bake.heightfield);
            applyHeightfieldToMesh(this.board, bake.heightfield);
            // Restore Ultra XZ lean when the outer dump still matches.
            if (
                bake.vertCount != null &&
                bake.positions &&
                bake.vertCount === this.mesh.geometry.attributes.position!.count
            ) {
                this.applyMeshBake(
                    this.mesh,
                    { vertCount: bake.vertCount, positions: bake.positions },
                    'Outer',
                );
            }
        } else if (bake.vertCount != null && bake.positions) {
            if (
                !this.applyMeshBake(
                    this.mesh,
                    { vertCount: bake.vertCount, positions: bake.positions },
                    'Outer',
                )
            ) {
                alert(
                    `Outer vertex count mismatch (file ${bake.vertCount}, mesh ${this.mesh.geometry.attributes.position!.count}). Re-save on Ultra to write a heightfield.`,
                );
                return;
            }
            if (bake.board) this.applyMeshBake(this.board, bake.board, 'Board');
        } else {
            alert('Bake has no heightfield or vertex data');
            return;
        }
        if (bake.materials) {
            applyMaterialFieldsToMesh(this.mesh, bake.materials);
        }
        this.plantsApi?.setAll(bake.plants ?? [], bake.plantClears ?? []);
        this.onLandscapeChanged?.();
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
    }

    save(): void {
        const bake = this.serialize();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bake));
        } catch {
            /* quota */
        }
        const blob = new Blob([JSON.stringify(bake)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mountain-ring.json';
        a.click();
        URL.revokeObjectURL(a.href);
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
                    const bake = JSON.parse(text) as MountainBake;
                    if (bake.kind !== 'mountain-sculpt' || (bake.version !== 1 && bake.version !== 2)) {
                        alert('Not a mountain-sculpt v1/v2 file');
                        return;
                    }
                    this.applyBake(bake);
                    try {
                        localStorage.setItem(STORAGE_KEY, text);
                    } catch {
                        /* ignore */
                    }
                } catch (e) {
                    alert(`Load failed: ${e}`);
                }
            });
        };
        input.click();
    }

    loadFromStorage(): boolean {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        try {
            const bake = JSON.parse(raw) as MountainBake;
            if (bake.kind !== 'mountain-sculpt' || (bake.version !== 1 && bake.version !== 2)) return false;
            this.applyBake(bake);
            return true;
        } catch {
            return false;
        }
    }

    resetToBase(): void {
        const restore = (mesh: Mesh, base: Float32Array) => {
            const pos = mesh.geometry.attributes.position!;
            for (let i = 0; i < pos.count; i++) {
                pos.setXYZ(i, base[i * 3]!, base[i * 3 + 1]!, base[i * 3 + 2]!);
            }
            pos.needsUpdate = true;
            mesh.geometry.computeVertexNormals();
        };
        restore(this.mesh, this.basePositions);
        restore(this.board, this.boardBasePositions);
        this.restoreMaterialBases();
        this.plantsApi?.setAll(
            this.basePlants.map((p) => ({ ...p })),
            this.basePlantClears.map((c) => ({ ...c })),
        );
        this.onLandscapeChanged?.();
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
    }

    private captureMaterialBases(): void {
        ensureOuterMaterialAttrs(this.mesh.geometry);
        const copy = (name: string): Float32Array => {
            const attr = this.mesh.geometry.getAttribute(name) as BufferAttribute;
            return new Float32Array(attr.array as ArrayLike<number>);
        };
        this.matBaseGrass = copy('aGrass');
        this.matBaseRock = copy('aRock');
        this.matBaseSnow = copy('aSnow');
        this.matBaseBeach = copy('aBeach');
        this.matBaseScree = copy('aScree');
    }

    private restoreMaterialBases(): void {
        ensureOuterMaterialAttrs(this.mesh.geometry);
        const write = (name: string, base: Float32Array) => {
            const attr = this.mesh.geometry.getAttribute(name) as BufferAttribute;
            if (base.length !== attr.count) return;
            for (let i = 0; i < attr.count; i++) attr.setX(i, base[i]!);
            attr.needsUpdate = true;
        };
        write('aGrass', this.matBaseGrass);
        write('aRock', this.matBaseRock);
        write('aSnow', this.matBaseSnow);
        write('aBeach', this.matBaseBeach);
        write('aScree', this.matBaseScree);
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
</style>
<h3>Mountain editor</h3>
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
<div class="row">
  <button type="button" class="save">Save</button>
  <button type="button" class="load">Load</button>
  <button type="button" class="reset">Reset</button>
</div>
<div class="hint">Sculpt · materials · plants (outer/board) · Save packs height + mats + plants</div>`;

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

        el.querySelector('.save')!.addEventListener('click', () => this.save());
        el.querySelector('.load')!.addEventListener('click', () => this.loadFromFile());
        el.querySelector('.reset')!.addEventListener('click', () => this.resetToBase());

        // Don't let panel clicks hit the canvas
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        return el;
    }
}

/** Apply a previously saved bake onto a position attribute (same vert count). */
export function applyMountainBakeToPositions(
    pos: BufferAttribute | { count: number; setXYZ: (i: number, x: number, y: number, z: number) => void; needsUpdate: boolean },
    bake: Pick<MountainBake, 'vertCount' | 'positions'>,
): boolean {
    if (bake.vertCount == null || !bake.positions) return false;
    if (bake.vertCount !== pos.count || bake.positions.length !== pos.count * 3) return false;
    for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, bake.positions[i * 3]!, bake.positions[i * 3 + 1]!, bake.positions[i * 3 + 2]!);
    }
    pos.needsUpdate = true;
    return true;
}

/** Apply authored landscape onto the battle ground mesh (any scenery quality). */
export function applyBoardBakeToMesh(mesh: Mesh, bake: MountainBake): boolean {
    if (bake.heightfield) {
        applyHeightfieldToMesh(mesh, bake.heightfield);
        return true;
    }
    const board = bake.board;
    if (!board) return false;
    const pos = mesh.geometry.attributes.position!;
    if (!applyMountainBakeToPositions(pos, board)) return false;
    mesh.geometry.computeVertexNormals();
    return true;
}

/**
 * Apply authored landscape onto the outer-ground positions (any scenery tier).
 * Heightfield drapes Y; matching Ultra vert dumps also restore XZ lean.
 */
export function applyOuterBakeToPositions(pos: BufferAttribute, bake: MountainBake, yOff = -0.05): boolean {
    if (bake.heightfield) {
        applyHeightfieldToPositions(pos, bake.heightfield, yOff);
        if (bake.vertCount === pos.count && bake.positions && bake.positions.length === pos.count * 3) {
            applyMountainBakeToPositions(pos, bake);
        }
        return true;
    }
    return applyMountainBakeToPositions(pos, bake);
}

/** Drape authored outer material weights onto a mesh (any scenery tier). */
export function applyOuterMaterialBake(mesh: Mesh, bake: MountainBake): boolean {
    if (!bake.materials) return false;
    applyMaterialFieldsToMesh(mesh, bake.materials);
    return true;
}

export function readMountainBakeFromStorage(): MountainBake | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const bake = JSON.parse(raw) as MountainBake;
        if (bake.kind !== 'mountain-sculpt' || (bake.version !== 1 && bake.version !== 2)) return null;
        return bake;
    } catch {
        return null;
    }
}
