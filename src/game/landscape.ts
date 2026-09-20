/**
 * Static landscapes ("maps"): an authored board relief, outer ring (height,
 * overhang lean, surface paint) and hand-placed plants, used instead of the
 * procedural terrain when a match names one ({@link GameSettings.landscape}).
 *
 * Files live in `assets/data/landscapes/<id>.json`. That folder is part of the
 * content hash, and the match settings carry the id, so every client of a
 * match plays the same heights — which matters: the sim's ground and the horde
 * spawn checks read them.
 *
 * Heights are quality-independent: the board is stored at exactly the board
 * mesh's vertices, the outer ring on a regular grid sampled from the mesh
 * surface (never rounded into cells), so a save → load round trip keeps every
 * hill where it was sculpted.
 */
import { BufferAttribute, type BufferGeometry, type Mesh } from 'three';
import type { AuthoredPlant, PlantClearDisk } from './landscapePlants';
import type { VegetationKind } from './sceneryVegetation';

/** how far past the board the outer ring reaches (scenery's MOUNTAIN_PEAK_END) */
export const LANDSCAPE_OUTER_SPAN = 500;
/** outer grid spacing (world units) */
export const LANDSCAPE_OUTER_CELL = 4;

export type HeightSampler = (x: number, z: number) => number;

export const MATERIAL_CHANNELS = ['grass', 'rock', 'snow', 'beach', 'scree'] as const;
export type MaterialChannel = (typeof MATERIAL_CHANNELS)[number];
export const MATERIAL_ATTR: Record<MaterialChannel, string> = {
    grass: 'aGrass',
    rock: 'aRock',
    snow: 'aSnow',
    beach: 'aBeach',
    scree: 'aScree',
};

/** the board a landscape is made for */
export interface LandscapeBoard {
    cols: number;
    rows: number;
    halfW: number;
    halfH: number;
}

/** square outer grid: node (ix, iz) sits at (originX + ix·cell, originZ + iz·cell) */
export interface LandscapeGrid {
    originX: number;
    originZ: number;
    cell: number;
    res: number;
}

export interface LandscapeData {
    id: string;
    name: string;
    map: LandscapeBoard;
    /** board relief at the board mesh vertices: (cols·2+1) × (rows·2+1), row-major, rows from −z */
    board: Float32Array;
    outer: LandscapeGrid;
    /** outer ground height per grid node (0 under the board) */
    outerHeights: Float32Array;
    /** visual overhang: how far each node's surface sits off its grid position (no gameplay effect) */
    lean: { dx: Float32Array; dz: Float32Array } | null;
    /** painted surface weights 0..1 per grid node */
    materials: Partial<Record<MaterialChannel, Float32Array>>;
    plants: AuthoredPlant[];
    plantClears: PlantClearDisk[];
}

// ---- grids and samplers

export function landscapeBoardOf(map: LandscapeBoard): LandscapeBoard {
    return { cols: map.cols, rows: map.rows, halfW: map.halfW, halfH: map.halfH };
}

export function outerGridFor(map: Pick<LandscapeBoard, 'halfW' | 'halfH'>): LandscapeGrid {
    const halfSpan = Math.max(map.halfW, map.halfH) + LANDSCAPE_OUTER_SPAN;
    const res = Math.round((halfSpan * 2) / LANDSCAPE_OUTER_CELL) + 1;
    return { originX: -halfSpan, originZ: -halfSpan, cell: (halfSpan * 2) / (res - 1), res };
}

/**
 * The landscape turned half around the board's middle: (x, z) → (−x, −z).
 * The scenario editor shows the enemy side this way (its army turned to the
 * near edge), so the ground has to turn with it. Every grid here is centred on
 * the origin, so turning one is reversing its values; lean offsets point the
 * other way, plants move to the mirrored spot.
 */
export function rotateLandscape180(data: LandscapeData): LandscapeData {
    const reversed = (values: Float32Array) => values.slice().reverse();
    const centred = Math.abs(data.outer.originX + ((data.outer.res - 1) * data.outer.cell) / 2) < 1e-6 && Math.abs(data.outer.originZ - data.outer.originX) < 1e-6;
    if (!centred) throw new Error('landscape: the outer grid is not centred — it cannot be turned');
    const materials: Partial<Record<MaterialChannel, Float32Array>> = {};
    for (const ch of MATERIAL_CHANNELS) {
        const values = data.materials[ch];
        if (values) materials[ch] = reversed(values);
    }
    return {
        ...data,
        board: reversed(data.board),
        outerHeights: reversed(data.outerHeights),
        lean: data.lean
            ? { dx: reversed(data.lean.dx).map((v) => -v), dz: reversed(data.lean.dz).map((v) => -v) }
            : null,
        materials,
        plants: data.plants.map((p) => ({ ...p, x: -p.x, z: -p.z, yaw: p.yaw + Math.PI })),
        plantClears: data.plantClears.map((c) => ({ ...c, x: -c.x, z: -c.z })),
    };
}

/** does a landscape belong on this board? (a 2v2 board is wider, for one) */
export function landscapeFits(data: LandscapeData, map: LandscapeBoard): boolean {
    return (
        data.map.cols === map.cols &&
        data.map.rows === map.rows &&
        Math.abs(data.map.halfW - map.halfW) < 1e-6 &&
        Math.abs(data.map.halfH - map.halfH) < 1e-6 &&
        data.board.length === (map.cols * 2 + 1) * (map.rows * 2 + 1)
    );
}

function gridValue(grid: LandscapeGrid, values: Float32Array, x: number, z: number): number {
    const { originX, originZ, cell, res } = grid;
    const fx = (x - originX) / cell;
    const fz = (z - originZ) / cell;
    const x0 = Math.min(res - 2, Math.max(0, Math.floor(fx)));
    const z0 = Math.min(res - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const tz = Math.min(1, Math.max(0, fz - z0));
    const i = z0 * res + x0;
    const y0 = values[i]! * (1 - tx) + values[i + 1]! * tx;
    const y1 = values[i + res]! * (1 - tx) + values[i + res + 1]! * tx;
    return y0 * (1 - tz) + y1 * tz;
}

/** board relief from a grid laid out like the board mesh (bilinear between its vertices) */
function boardGridSampler(map: LandscapeBoard, heights: ArrayLike<number>): HeightSampler {
    const segsW = map.cols * 2;
    const segsH = map.rows * 2;
    const nx = segsW + 1;
    const width = map.halfW * 2;
    const height = map.halfH * 2;
    return (x, z) => {
        const fx = ((x + map.halfW) / width) * segsW;
        const fz = ((z + map.halfH) / height) * segsH;
        const x0 = Math.min(segsW - 1, Math.max(0, Math.floor(fx)));
        const z0 = Math.min(segsH - 1, Math.max(0, Math.floor(fz)));
        const tx = Math.min(1, Math.max(0, fx - x0));
        const tz = Math.min(1, Math.max(0, fz - z0));
        const i = z0 * nx + x0;
        const y0 = heights[i]! * (1 - tx) + heights[i + 1]! * tx;
        const y1 = heights[i + nx]! * (1 - tx) + heights[i + nx + 1]! * tx;
        return y0 * (1 - tz) + y1 * tz;
    };
}

/** the board relief of a landscape — what the sim walks on */
export function landscapeBoardSampler(data: LandscapeData): HeightSampler {
    return boardGridSampler(data.map, data.board);
}

/** the outer ring height of a landscape (0 on the board, like the procedural terrain) */
export function landscapeOuterSampler(data: LandscapeData): HeightSampler {
    const { halfW, halfH } = data.map;
    return (x, z) => (Math.abs(x) <= halfW && Math.abs(z) <= halfH ? 0 : gridValue(data.outer, data.outerHeights, x, z));
}

// ---- the outer mesh lattice

/**
 * The outer ground mesh is a rectilinear lattice (outerGroundGrid.ts) with a
 * hole under the board: `xs`/`zs` are its column/row positions, `keep` maps a
 * lattice point to its vertex (−1 in the hole), `vix`/`viz` a vertex back to
 * its lattice point. Sampling goes through the lattice, so a vertex that an
 * overhang moved sideways still counts where it belongs.
 */
export interface OuterLattice {
    xs: Float64Array;
    zs: Float64Array;
    keep: Int32Array;
    vix: Int32Array;
    viz: Int32Array;
}

export function latticeOf(geometry: BufferGeometry): OuterLattice | null {
    return (geometry.userData.lattice as OuterLattice | undefined) ?? null;
}

/** largest i with axis[i] ≤ v, kept inside [0, n−2] */
function axisCell(axis: Float64Array, v: number): number {
    let lo = 0;
    let hi = axis.length - 2;
    if (v <= axis[0]!) return 0;
    if (v >= axis[hi]!) return hi;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (axis[mid]! <= v) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/** bilinear over the lattice surface at a world point; `read` gives a vertex's value */
function latticeSample(lat: OuterLattice, read: (vertex: number) => number, x: number, z: number, fallback: number): number {
    const nx = lat.xs.length;
    const ix = axisCell(lat.xs, x);
    const iz = axisCell(lat.zs, z);
    const tx = Math.min(1, Math.max(0, (x - lat.xs[ix]!) / (lat.xs[ix + 1]! - lat.xs[ix]! || 1)));
    const tz = Math.min(1, Math.max(0, (z - lat.zs[iz]!) / (lat.zs[iz + 1]! - lat.zs[iz]! || 1)));
    const corners = [
        [lat.keep[iz * nx + ix]!, (1 - tx) * (1 - tz)],
        [lat.keep[iz * nx + ix + 1]!, tx * (1 - tz)],
        [lat.keep[(iz + 1) * nx + ix]!, (1 - tx) * tz],
        [lat.keep[(iz + 1) * nx + ix + 1]!, tx * tz],
    ] as const;
    let sum = 0;
    let weight = 0;
    for (const [vertex, w] of corners) {
        if (vertex < 0) continue;
        sum += read(vertex) * w;
        weight += w;
    }
    return weight > 1e-9 ? sum / weight : fallback;
}

// ---- live samplers (editor: the meshes are the truth until the next save)

/** exact board relief from the board mesh (bilinear between its vertices), or null for a foreign mesh */
export function boardSamplerFromMesh(mesh: Mesh, map: LandscapeBoard): HeightSampler | null {
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    if (pos.count !== (map.cols * 2 + 1) * (map.rows * 2 + 1)) return null;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) heights[i] = pos.getY(i) + mesh.position.y;
    return boardGridSampler(map, heights);
}

/** outer ring height from the outer mesh's lattice (0 on the board), or null without a lattice */
export function outerSamplerFromMesh(mesh: Mesh, map: LandscapeBoard): HeightSampler | null {
    const lat = latticeOf(mesh.geometry);
    if (!lat) return null;
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) heights[i] = pos.getY(i);
    const read = (v: number) => heights[v]!;
    const { halfW, halfH } = map;
    return (x, z) => (Math.abs(x) <= halfW && Math.abs(z) <= halfH ? 0 : latticeSample(lat, read, x, z, 0));
}

// ---- capture (meshes → data) and apply (data → meshes)

/** everything the editor shows, as a landscape */
export function captureLandscape(opts: {
    id: string;
    name: string;
    map: LandscapeBoard;
    boardMesh: Mesh;
    outerMesh: Mesh;
    plants: AuthoredPlant[];
    plantClears: PlantClearDisk[];
}): LandscapeData | null {
    const { map, boardMesh, outerMesh } = opts;
    const boardPos = boardMesh.geometry.attributes.position as BufferAttribute;
    if (boardPos.count !== (map.cols * 2 + 1) * (map.rows * 2 + 1)) return null;
    const lat = latticeOf(outerMesh.geometry);
    if (!lat) return null;
    const board = new Float32Array(boardPos.count);
    for (let i = 0; i < boardPos.count; i++) board[i] = boardPos.getY(i) + boardMesh.position.y;

    const grid = outerGridFor(map);
    const n = grid.res * grid.res;
    const pos = outerMesh.geometry.attributes.position as BufferAttribute;
    const outerHeights = new Float32Array(n);
    const leanX = new Float32Array(n);
    const leanZ = new Float32Array(n);
    let anyLean = false;
    const materials: Partial<Record<MaterialChannel, Float32Array>> = {};
    const attrs = MATERIAL_CHANNELS.map((ch) => [ch, outerMesh.geometry.getAttribute(MATERIAL_ATTR[ch]) as BufferAttribute | undefined] as const);
    for (const [ch, attr] of attrs) if (attr) materials[ch] = new Float32Array(n);
    const readY = (v: number) => pos.getY(v);
    const readDx = (v: number) => pos.getX(v) - lat.xs[lat.vix[v]!]!;
    const readDz = (v: number) => pos.getZ(v) - lat.zs[lat.viz[v]!]!;
    for (let iz = 0; iz < grid.res; iz++) {
        const z = grid.originZ + iz * grid.cell;
        for (let ix = 0; ix < grid.res; ix++) {
            const x = grid.originX + ix * grid.cell;
            const i = iz * grid.res + ix;
            if (Math.abs(x) <= map.halfW && Math.abs(z) <= map.halfH) continue; // under the board: 0
            outerHeights[i] = latticeSample(lat, readY, x, z, 0);
            leanX[i] = latticeSample(lat, readDx, x, z, 0);
            leanZ[i] = latticeSample(lat, readDz, x, z, 0);
            if (leanX[i] !== 0 || leanZ[i] !== 0) anyLean = true;
            for (const [ch, attr] of attrs) {
                if (attr) materials[ch]![i] = latticeSample(lat, (v) => attr.getX(v), x, z, 0);
            }
        }
    }
    return {
        id: opts.id,
        name: opts.name,
        map: landscapeBoardOf(map),
        board,
        outer: grid,
        outerHeights,
        lean: anyLean ? { dx: leanX, dz: leanZ } : null,
        materials,
        plants: opts.plants.map((p) => ({ ...p })),
        plantClears: opts.plantClears.map((c) => ({ ...c })),
    };
}

/** put a landscape's board relief on the board mesh (same topology) */
export function applyLandscapeToBoardMesh(mesh: Mesh, data: LandscapeData): boolean {
    const pos = mesh.geometry.attributes.position as BufferAttribute;
    if (pos.count !== data.board.length) return false;
    for (let i = 0; i < pos.count; i++) pos.setY(i, data.board[i]! - mesh.position.y);
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    return true;
}

/**
 * Put a landscape on the outer ground geometry: heights (unless the caller
 * already set them), overhang lean and surface paint, at every vertex's own
 * lattice position. Returns false without a lattice.
 */
export function applyLandscapeToOuterGeometry(geometry: BufferGeometry, data: LandscapeData, opts: { heights: boolean }): boolean {
    const lat = latticeOf(geometry);
    if (!lat) return false;
    const pos = geometry.attributes.position as BufferAttribute;
    const height = landscapeOuterSampler(data);
    const channels = MATERIAL_CHANNELS.filter((ch) => data.materials[ch]);
    const attrs = channels.map((ch) => {
        let attr = geometry.getAttribute(MATERIAL_ATTR[ch]) as BufferAttribute | undefined;
        if (!attr) {
            attr = new BufferAttribute(new Float32Array(pos.count), 1);
            geometry.setAttribute(MATERIAL_ATTR[ch], attr);
        }
        return [data.materials[ch]!, attr] as const;
    });
    for (let v = 0; v < pos.count; v++) {
        const x = lat.xs[lat.vix[v]!]!;
        const z = lat.zs[lat.viz[v]!]!;
        const dx = data.lean ? gridValue(data.outer, data.lean.dx, x, z) : 0;
        const dz = data.lean ? gridValue(data.outer, data.lean.dz, x, z) : 0;
        pos.setXYZ(v, x + dx, opts.heights ? height(x, z) : pos.getY(v), z + dz);
        for (const [values, attr] of attrs) attr.setX(v, gridValue(data.outer, values, x, z));
    }
    pos.needsUpdate = true;
    for (const [, attr] of attrs) attr.needsUpdate = true;
    return true;
}

// ---- files

const FILE_KIND = 'melodan-landscape';
/** heights and lean are stored as 16-bit steps of this size (±655 wu) */
const HEIGHT_STEP = 0.02;

interface QuantizedArray {
    step: number;
    /** base64 of little-endian Int16 */
    data: string;
}

export interface LandscapeFile {
    version: 3;
    kind: typeof FILE_KIND;
    id: string;
    name: string;
    map: LandscapeBoard;
    board: QuantizedArray;
    outer: LandscapeGrid & { heights: QuantizedArray };
    lean?: { dx: QuantizedArray; dz: QuantizedArray };
    /** base64 of Uint8 (0..255 → 0..1) per channel */
    materials?: Partial<Record<MaterialChannel, string>>;
    plants?: AuthoredPlant[];
    plantClears?: PlantClearDisk[];
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function quantize(values: Float32Array): QuantizedArray {
    const buf = new ArrayBuffer(values.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < values.length; i++) {
        const q = Math.max(-32768, Math.min(32767, Math.round(values[i]! / HEIGHT_STEP)));
        view.setInt16(i * 2, q, true);
    }
    return { step: HEIGHT_STEP, data: toBase64(new Uint8Array(buf)) };
}

function dequantize(q: QuantizedArray, length: number, what: string): Float32Array {
    const bytes = fromBase64(q.data);
    if (bytes.length !== length * 2) throw new Error(`landscape: ${what} has ${bytes.length / 2} values, expected ${length}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = view.getInt16(i * 2, true) * q.step;
    return out;
}

export function encodeLandscape(data: LandscapeData): LandscapeFile {
    const materials: Partial<Record<MaterialChannel, string>> = {};
    for (const ch of MATERIAL_CHANNELS) {
        const values = data.materials[ch];
        if (!values || !values.some((v) => v > 1 / 510)) continue; // an unpainted channel is left out
        const bytes = new Uint8Array(values.length);
        for (let i = 0; i < values.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(values[i]! * 255)));
        materials[ch] = toBase64(bytes);
    }
    return {
        version: 3,
        kind: FILE_KIND,
        id: data.id,
        name: data.name,
        map: data.map,
        board: quantize(data.board),
        outer: { ...data.outer, heights: quantize(data.outerHeights) },
        ...(data.lean ? { lean: { dx: quantize(data.lean.dx), dz: quantize(data.lean.dz) } } : {}),
        ...(Object.keys(materials).length > 0 ? { materials } : {}),
        plants: data.plants,
        plantClears: data.plantClears,
    };
}

const PLANT_KINDS: readonly VegetationKind[] = ['oak', 'pine', 'bushRound', 'bushTall'];

export function isLandscapeFile(raw: unknown): raw is LandscapeFile {
    const f = raw as Partial<LandscapeFile> | null;
    return !!f && f.kind === FILE_KIND && f.version === 3;
}

/** a landscape file, checked; throws with the reason when it isn't usable */
export function decodeLandscape(raw: unknown): LandscapeData {
    if (!isLandscapeFile(raw)) throw new Error('landscape: not a v3 landscape file');
    const { map, outer } = raw;
    if (!map || !(map.cols > 0) || !(map.rows > 0) || !(map.halfW > 0) || !(map.halfH > 0)) throw new Error('landscape: bad board size');
    if (!outer || !(outer.res >= 2) || !(outer.cell > 0)) throw new Error('landscape: bad outer grid');
    const n = outer.res * outer.res;
    const materials: Partial<Record<MaterialChannel, Float32Array>> = {};
    for (const ch of MATERIAL_CHANNELS) {
        const text = raw.materials?.[ch];
        if (!text) continue;
        const bytes = fromBase64(text);
        if (bytes.length !== n) throw new Error(`landscape: ${ch} paint has ${bytes.length} values, expected ${n}`);
        const values = new Float32Array(n);
        for (let i = 0; i < n; i++) values[i] = bytes[i]! / 255;
        materials[ch] = values;
    }
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    return {
        id: String(raw.id ?? ''),
        name: String(raw.name ?? raw.id ?? ''),
        map: landscapeBoardOf(map),
        board: dequantize(raw.board, (map.cols * 2 + 1) * (map.rows * 2 + 1), 'board'),
        outer: { originX: outer.originX, originZ: outer.originZ, cell: outer.cell, res: outer.res },
        outerHeights: dequantize(outer.heights, n, 'outer heights'),
        lean: raw.lean ? { dx: dequantize(raw.lean.dx, n, 'lean'), dz: dequantize(raw.lean.dz, n, 'lean') } : null,
        materials,
        plants: (raw.plants ?? []).filter(
            (p) => PLANT_KINDS.includes(p?.kind) && finite(p.x) && finite(p.z) && finite(p.sc) && finite(p.yaw),
        ),
        plantClears: (raw.plantClears ?? []).filter((c) => finite(c?.x) && finite(c.z) && finite(c.r)),
    };
}

// ---- the maps that ship with the game

const FILES = import.meta.glob('../../assets/data/landscapes/*.json', { query: '?raw', import: 'default' }) as Record<
    string,
    () => Promise<string>
>;

const idOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);

/** ids of the bundled landscapes (file names) */
export function landscapeIds(): string[] {
    return Object.keys(FILES).map(idOf).sort();
}

const loaded = new Map<string, LandscapeData>();
const loading = new Map<string, Promise<LandscapeData>>();

/** a landscape already loaded this session, or null */
export function loadedLandscape(id: string): LandscapeData | null {
    return loaded.get(id) ?? null;
}

/** load a bundled landscape (once per session) */
export function loadLandscape(id: string): Promise<LandscapeData> {
    const done = loaded.get(id);
    if (done) return Promise.resolve(done);
    let pending = loading.get(id);
    if (!pending) {
        const entry = Object.entries(FILES).find(([path]) => idOf(path) === id);
        pending = entry
            ? entry[1]().then((text) => {
                  const data = decodeLandscape(JSON.parse(text));
                  data.id = id; // the file name is the id the match settings carry
                  loaded.set(id, data);
                  return data;
              })
            : Promise.reject(new Error(`landscape "${id}" is not in this build`));
        pending.catch(() => loading.delete(id));
        loading.set(id, pending);
    }
    return pending;
}
