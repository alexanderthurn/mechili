/**
 * The terrain brushes behind the scenario editor's Terrain tool: left-drag
 * works the outer ground and the battle board as one landscape — raise,
 * lower, flatten, lean — and paints surface and plants. Mesh work, input and
 * undo only: the panel is ui/terrainPanel.ts, and the editor session
 * (scenario/editorSession.ts) turns the result into the draft's terrain.
 *
 * While editing, the meshes are the truth (the sim samples them live). Every
 * edit is undoable: it records only the values it changed.
 */

import {
    Mesh,
    MeshBasicMaterial,
    Plane,
    Raycaster,
    ShaderMaterial,
    Vector2,
    Vector3,
    type BufferAttribute,
    type Camera,
    type PerspectiveCamera,
    type Scene,
} from 'three';
import { createRangeRing } from './placement';
import { SLOPE_BLOCK_GRADE } from './terrainCombat';
import { worldHeightAt } from './map';
import {
    applyLandscapeToBoardMesh,
    applyLandscapeToOuterGeometry,
    captureLandscape,
    landscapeFits,
    MATERIAL_ATTR,
    MATERIAL_CHANNELS,
    type LandscapeBoard,
    type LandscapeData,
} from './landscape';
import { clampBoardY } from './terrainGrid';
import { ensureOuterMaterialAttrs, paintOuterMaterial, type OuterMaterialKind } from './landscapeMaterials';
import {
    defaultPlantScale,
    plantMinSpacing,
    type AuthoredPlant,
    type PlantBrushKind,
    type PlantClearDisk,
} from './landscapePlants';
import type { VegetationKind } from './sceneryVegetation';

export type TerrainBrush =
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

export type MouseSlot = 'left' | 'right' | 'middle';

/** what a new left tool puts on the other buttons (a panel right/middle click overrides it) */
function companions(left: TerrainBrush): Partial<Record<Exclude<MouseSlot, 'left'>, TerrainBrush>> {
    if (left === 'raise') return { right: 'lower', middle: 'flatten' };
    if (left === 'lower') return { right: 'raise', middle: 'flatten' };
    if (left === 'flatten' || left === 'lean') return { right: 'lower', middle: 'flatten' };
    if (left.startsWith('obj-') && left !== 'obj-erase') return { right: 'obj-erase' };
    return {};
}

/** one undoable edit: the values it changed, per tracked array, and the plants before/after */
interface TerrainEdit {
    diffs: { key: string; length: number; idx: Uint32Array; before: Float32Array; after: Float32Array }[];
    plants: { before: PlantState; after: PlantState } | null;
}

interface PlantState {
    plants: AuthoredPlant[];
    clears: PlantClearDisk[];
}

/** the undo history, handed across the restarts the editor causes (test battle and back) */
export interface TerrainHistory {
    undo: TerrainEdit[];
    redo: TerrainEdit[];
    /** the oldest state the history reaches is the generated terrain */
    fromGenerated: boolean;
}

/** strokes kept for undo — each holds only what it changed */
const MAX_UNDO = 80;

export interface TerrainBrushesOpts {
    mesh: Mesh;
    /** Battle-map ground — brushed together with the outer ring. */
    boardMesh: Mesh;
    scene: Scene;
    camera: PerspectiveCamera;
    domElement: HTMLElement;
    map: LandscapeBoard;
    /** the scenario's name — the captured terrain's name */
    name: () => string;
    /** After a sculpt stroke / load / undo — rebind sim heights + deploy grid. */
    onLandscapeChanged?: () => void;
    /**
     * The terrain changed: a new edit ('edit', undoable — one per stroke or
     * file load) or a step through the history ('history').
     */
    onEdited?: (kind: 'edit' | 'history') => void;
    /** the history was dropped (a quality change rebuilt the meshes) */
    onHistoryCleared?: () => void;
    /** the meshes show the generated terrain (no sculpted one) as the editor opens */
    fromGenerated: boolean;
    /** a tool, the radius, the strength or the steep overlay changed (keys included) — the panel follows */
    onSettingsChanged?: () => void;
    /** Terrain editing switched on (true) or off (false). */
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

/**
 * Steep-ground overlay for the board: amber where a slope starts to slow
 * units, red where it is too steep to walk up ({@link SLOPE_BLOCK_GRADE}).
 * Shares the board geometry, so it follows every brush stroke; the slope comes
 * from screen-space derivatives, so it needs no normals.
 */
function createSteepOverlay(): Mesh {
    const material = new ShaderMaterial({
        uniforms: {
            uFrom: { value: SLOPE_BLOCK_GRADE * 0.6 },
            uBlock: { value: SLOPE_BLOCK_GRADE },
        },
        vertexShader: `
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}`,
        fragmentShader: `
uniform float uFrom;
uniform float uBlock;
varying vec3 vWorld;
void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float ny = max(abs(n.y), 1e-3);
    float grade = sqrt(max(0.0, 1.0 - ny * ny)) / ny;
    if (grade < uFrom) discard;
    float blocked = step(uBlock, grade);
    vec3 color = mix(vec3(1.0, 0.72, 0.12), vec3(0.95, 0.12, 0.08), blocked);
    gl_FragColor = vec4(color, mix(0.3, 0.55, blocked));
}`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const mesh = new Mesh(undefined, material);
    mesh.name = 'steep-overlay';
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return mesh;
}

export class TerrainBrushes {
    /** the brush a stroke paints with (the button's slot while a stroke runs, else the left slot) */
    brush: TerrainBrush = 'raise';
    /**
     * A tool per mouse button: left paints with a plain drag; right and middle
     * need Shift (without it they stay the camera's pan and orbit).
     */
    private readonly slots: Record<MouseSlot, TerrainBrush> = { left: 'raise', right: 'lower', middle: 'flatten' };
    static readonly RADIUS = { min: 8, max: 120 };
    /** strength runs 0.5 … 8 */
    static readonly STRENGTH = { min: 0.5, max: 8 };
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
    private editing = false;
    private readonly steepOverlay = createSteepOverlay();
    private steepVisible = true;
    private readonly onActiveChange: ((active: boolean) => void) | null;
    private readonly onEdited: ((kind: 'edit' | 'history') => void) | null;
    private readonly onSettingsChanged: (() => void) | null;
    private readonly onHistoryCleared: (() => void) | null;
    /** the oldest state the undo history reaches is the generated terrain */
    private fromGenerated: boolean;
    private readonly name: () => string;
    private readonly disposers: (() => void)[] = [];
    private undoStack: TerrainEdit[] = [];
    private redoStack: TerrainEdit[] = [];
    /** the tracked values when the edit now running began (null = none running) */
    private before: { arrays: Map<string, Float32Array>; plants: PlantState } | null = null;
    private readonly cursor: Mesh;
    private hover: { x: number; z: number } | null = null;
    /** Scratch lists for draping the cursor over nearby mesh verts. */
    private readonly nearX: number[] = [];
    private readonly nearY: number[] = [];
    private readonly nearZ: number[] = [];
    private readonly onLandscapeChanged: (() => void) | null;
    private readonly plantsApi: NonNullable<TerrainBrushesOpts['plants']> | null;
    /** Min time between plant stamps while dragging. */
    private lastPlantStampMs = 0;

    constructor(opts: TerrainBrushesOpts) {
        this.mesh = opts.mesh;
        this.board = opts.boardMesh;
        this.attachSteepOverlay();
        this.camera = opts.camera;
        this.dom = opts.domElement;
        this.map = opts.map;
        this.halfW = opts.map.halfW;
        this.halfH = opts.map.halfH;
        this.onLandscapeChanged = opts.onLandscapeChanged ?? null;
        this.onActiveChange = opts.onActiveChange ?? null;
        this.onEdited = opts.onEdited ?? null;
        this.onSettingsChanged = opts.onSettingsChanged ?? null;
        this.onHistoryCleared = opts.onHistoryCleared ?? null;
        this.fromGenerated = opts.fromGenerated;
        this.name = opts.name;
        this.plantsApi = opts.plants ?? null;
        ensureOuterMaterialAttrs(this.mesh.geometry);

        this.cursor = createRangeRing(opts.scene);
        const mat = this.cursor.material as MeshBasicMaterial;
        mat.color.setHex(0xd4b878);
        mat.opacity = 0.55;


        const onDown = (e: PointerEvent) => {
            if (!this.editing) return;
            // left paints; Shift+right / Shift+middle paint their slots — without
            // Shift those buttons stay the camera's (pan / orbit)
            const slot: MouseSlot | null =
                e.button === 0 ? 'left' : e.button === 2 && e.shiftKey ? 'right' : e.button === 1 && e.shiftKey ? 'middle' : null;
            if (!slot) return;
            this.brush = this.slots[slot];
            this.painting = true;
            this.beginEdit();
            this.dom.setPointerCapture(e.pointerId);
            this.onPointer(e.clientX, e.clientY, true);
            e.preventDefault();
            // the camera listens on the same element — keep the stroke from also panning / orbiting
            e.stopImmediatePropagation();
        };
        const onMove = (e: PointerEvent) => {
            if (!this.editing) return;
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
            this.endEdit();
            this.brush = this.slots.left;
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

        this.updateSteepOverlay();
    }

    /** After scenery / ground rebuild (quality change) — point at the new meshes; Reset still returns to the start. */
    reattach(mesh: Mesh, boardMesh: Mesh): void {
        this.mesh = mesh;
        this.board = boardMesh;
        this.attachSteepOverlay();
        ensureOuterMaterialAttrs(this.mesh.geometry);
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        // the rebuilt meshes may have another resolution: old strokes no longer fit
        const had = this.undoStack.length + this.redoStack.length > 0;
        this.undoStack = [];
        this.redoStack = [];
        this.before = null;
        // what is shown now is the new start — generated only if nothing was sculpted
        this.fromGenerated = this.fromGenerated && !had;
        if (had) this.onHistoryCleared?.();
    }

    dispose(): void {
        for (const d of this.disposers) d();
        this.disposers.length = 0;
        this.steepOverlay.removeFromParent();
        (this.steepOverlay.material as ShaderMaterial).dispose();
        this.cursor.removeFromParent();
        this.cursor.geometry.dispose();
        (this.cursor.material as MeshBasicMaterial).dispose();
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (!this.editing) return;

        const brushByKey: Record<string, TerrainBrush> = {
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
            if (e.key === '5') this.setRadius(this.radius + 4);
            else if (e.key === '6') this.setRadius(this.radius - 4);
            else if (e.key === '7') this.setStrength(this.strength + 0.5);
            else this.setStrength(this.strength - 0.5);
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

    /** a new left tool (key or panel click) — the other buttons follow with its companions */
    setBrush(brush: TerrainBrush): void {
        this.slots.left = brush;
        Object.assign(this.slots, companions(brush));
        if (!this.painting) this.brush = brush;
        this.onSettingsChanged?.();
    }

    /** put a tool on the right or middle button (panel right / middle click) */
    setSlot(slot: Exclude<MouseSlot, 'left'>, brush: TerrainBrush): void {
        this.slots[slot] = brush;
        this.onSettingsChanged?.();
    }

    /** the mouse buttons that hold `brush` */
    slotsOf(brush: TerrainBrush): MouseSlot[] {
        return (['left', 'right', 'middle'] as const).filter((slot) => this.slots[slot] === brush);
    }

    get leftBrush(): TerrainBrush {
        return this.slots.left;
    }

    setRadius(radius: number): void {
        this.radius = Math.min(TerrainBrushes.RADIUS.max, Math.max(TerrainBrushes.RADIUS.min, radius));
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        this.onSettingsChanged?.();
    }

    setStrength(strength: number): void {
        this.strength = Math.min(TerrainBrushes.STRENGTH.max, Math.max(TerrainBrushes.STRENGTH.min, strength));
        this.onSettingsChanged?.();
    }

    get steepShown(): boolean {
        return this.steepVisible;
    }

    set steepShown(on: boolean) {
        this.steepVisible = on;
        this.updateSteepOverlay();
        this.onSettingsChanged?.();
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
            // the board (and the outer ground over it, so the edge stays seamless) stays between sea level and the board ceiling
            if (Math.abs(pos.getX(i)) <= this.halfW && Math.abs(pos.getZ(i)) <= this.halfH) {
                yWorld = clampBoardY(pos.getY(i) + yOff, yWorld);
            }
            pos.setXYZ(i, x, yWorld - yOff, z);
        }
        pos.needsUpdate = true;
    }

    /** the landscape the editor shows right now (null if the meshes can't be read) */
    capture(): LandscapeData | null {
        const name = this.name().trim() || 'Terrain';
        return captureLandscape({
            id: fileSlug(name),
            name,
            map: this.map,
            boardMesh: this.board,
            outerMesh: this.mesh,
            plants: this.plantsApi?.getPlants() ?? [],
            plantClears: this.plantsApi?.getClears() ?? [],
        });
    }

    // ---- undo: an edit keeps only the values it changed

    /** every value an edit can change, by a stable key */
    private tracked(): Map<string, Float32Array> {
        const out = new Map<string, Float32Array>();
        out.set('board', (this.board.geometry.attributes.position as BufferAttribute).array as Float32Array);
        out.set('outer', (this.mesh.geometry.attributes.position as BufferAttribute).array as Float32Array);
        for (const ch of MATERIAL_CHANNELS) {
            const attr = this.mesh.geometry.getAttribute(MATERIAL_ATTR[ch]) as BufferAttribute | undefined;
            if (attr) out.set(`mat-${ch}`, attr.array as Float32Array);
        }
        return out;
    }

    private plantState(): PlantState {
        return {
            plants: structuredClone(this.plantsApi?.getPlants() ?? []),
            clears: structuredClone(this.plantsApi?.getClears() ?? []),
        };
    }

    /** an edit starts: remember the values it may change */
    private beginEdit(): void {
        if (this.before) return;
        ensureOuterMaterialAttrs(this.mesh.geometry);
        const arrays = new Map<string, Float32Array>();
        for (const [key, values] of this.tracked()) arrays.set(key, values.slice());
        this.before = { arrays, plants: this.plantState() };
    }

    /** the edit is done: keep what it changed as one undo step (false = it changed nothing) */
    private endEdit(): boolean {
        const before = this.before;
        this.before = null;
        if (!before) return false;
        const edit: TerrainEdit = { diffs: [], plants: null };
        for (const [key, now] of this.tracked()) {
            const was = before.arrays.get(key);
            if (!was || was.length !== now.length) continue;
            const changed: number[] = [];
            for (let i = 0; i < now.length; i++) if (now[i] !== was[i]) changed.push(i);
            if (changed.length === 0) continue;
            const idx = Uint32Array.from(changed);
            const b = new Float32Array(idx.length);
            const f = new Float32Array(idx.length);
            for (let k = 0; k < idx.length; k++) {
                b[k] = was[idx[k]!]!;
                f[k] = now[idx[k]!]!;
            }
            edit.diffs.push({ key, length: now.length, idx, before: b, after: f });
        }
        const plantsAfter = this.plantState();
        if (JSON.stringify(plantsAfter) !== JSON.stringify(before.plants)) edit.plants = { before: before.plants, after: plantsAfter };
        if (edit.diffs.length === 0 && !edit.plants) return false;
        this.undoStack.push(edit);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
        this.redoStack = [];
        this.onEdited?.('edit');
        return true;
    }

    /** put an edit's values back (undo) or on again (redo); false when it no longer fits the meshes */
    private applyEdit(edit: TerrainEdit, forward: boolean): boolean {
        ensureOuterMaterialAttrs(this.mesh.geometry);
        const arrays = this.tracked();
        if (edit.diffs.some((d) => arrays.get(d.key)?.length !== d.length)) return false;
        for (const d of edit.diffs) {
            const values = arrays.get(d.key)!;
            const src = forward ? d.after : d.before;
            for (let k = 0; k < d.idx.length; k++) values[d.idx[k]!] = src[k]!;
        }
        for (const attr of [this.board.geometry.attributes.position, this.mesh.geometry.attributes.position]) attr!.needsUpdate = true;
        for (const ch of MATERIAL_CHANNELS) {
            const attr = this.mesh.geometry.getAttribute(MATERIAL_ATTR[ch]);
            if (attr) attr.needsUpdate = true;
        }
        this.board.geometry.computeVertexNormals();
        this.mesh.geometry.computeVertexNormals();
        if (edit.plants) {
            const state = forward ? edit.plants.after : edit.plants.before;
            this.plantsApi?.setAll(structuredClone(state.plants), structuredClone(state.clears));
        }
        this.onLandscapeChanged?.();
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        this.onEdited?.('history');
        return true;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /** a stroke is being painted — undo waits for it to end */
    get busy(): boolean {
        return this.painting;
    }

    /** every edit is undone and the start was the generated terrain */
    get atGenerated(): boolean {
        return this.fromGenerated && this.undoStack.length === 0;
    }

    /** take the last terrain edit back (false = nothing to take back) */
    undo(): boolean {
        const edit = this.undoStack.pop();
        if (!edit) return false;
        if (!this.applyEdit(edit, false)) {
            this.undoStack = [];
            this.redoStack = [];
            return false;
        }
        this.redoStack.push(edit);
        return true;
    }

    redo(): boolean {
        const edit = this.redoStack.pop();
        if (!edit) return false;
        if (!this.applyEdit(edit, true)) {
            this.undoStack = [];
            this.redoStack = [];
            return false;
        }
        this.undoStack.push(edit);
        return true;
    }

    exportHistory(): TerrainHistory {
        return { undo: this.undoStack, redo: this.redoStack, fromGenerated: this.fromGenerated };
    }

    /** the history from before a restart — dropped if it no longer fits the meshes */
    importHistory(history: TerrainHistory): void {
        const arrays = this.tracked();
        const fits = (e: TerrainEdit) => e.diffs.every((d) => arrays.get(d.key)?.length === d.length);
        if (![...history.undo, ...history.redo].every(fits)) return;
        this.undoStack = history.undo;
        this.redoStack = history.redo;
        this.fromGenerated = history.fromGenerated;
    }

    /** forget every stroke: what the meshes show now is the start */
    clearHistory(generated: boolean): void {
        this.undoStack = [];
        this.redoStack = [];
        this.fromGenerated = generated;
    }

    // ---- files

    /**
     * Put a landscape on the meshes: board relief, outer heights / lean /
     * paint, plants. `record`: as one undoable edit (a loaded file), else
     * silently (the view turned, the history goes). False when it is made for
     * another board size.
     */
    show(data: LandscapeData, record: boolean): boolean {
        if (!landscapeFits(data, this.map)) return false;
        if (record) this.beginEdit();
        applyLandscapeToBoardMesh(this.board, data);
        ensureOuterMaterialAttrs(this.mesh.geometry);
        applyLandscapeToOuterGeometry(this.mesh.geometry, data, { heights: true });
        this.board.geometry.computeVertexNormals();
        this.mesh.geometry.computeVertexNormals();
        this.plantsApi?.setAll(data.plants, data.plantClears);
        this.onLandscapeChanged?.();
        if (this.hover) this.drapeCursor(this.hover.x, this.hover.z);
        if (record) this.endEdit();
        return true;
    }

    /** hang the steep overlay on the current board mesh (it shares the board's geometry) */
    private attachSteepOverlay(): void {
        this.steepOverlay.geometry = this.board.geometry;
        this.board.add(this.steepOverlay);
        this.updateSteepOverlay();
    }

    private updateSteepOverlay(): void {
        this.steepOverlay.visible = this.editing && this.steepVisible;
    }

    /** whether terrain editing currently owns the board's clicks and brush keys */
    get active(): boolean {
        return this.editing;
    }

    setEditing(on: boolean): void {
        if (this.editing === on) return;
        this.editing = on;
        if (!on) {
            if (this.painting) this.endEdit();
            this.painting = false;
            this.strokeLocked = false;
            this.hover = null;
            this.cursor.visible = false;
        }
        this.updateSteepOverlay();
        this.onActiveChange?.(on);
    }
}

/** a file name from a scenario name: lower-case words joined by dashes */
function fileSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'terrain';
}
