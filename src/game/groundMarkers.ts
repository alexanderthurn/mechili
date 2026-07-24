import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PlaneGeometry,
    Texture,
    Vector3,
    type Group,
} from 'three';
import { groundHeightAt } from './map';

/** small lift on draped plates (same idea as unit footprint plates) */
export const DRAPE_LIFT = 0.08;
/** above ground tiles; transparent overlays sort by object position — keep fills/lines aligned */
export const DRAPE_RENDER_ORDER = 10;

/** Yaw so local +Z points from (ax,az) toward (bx,bz); matches drapeRectGeometry. */
export function drapeYawToward(ax: number, az: number, bx: number, bz: number): number {
    return Math.atan2(-(bx - ax), bz - az);
}

function drapeAnchorY(cx: number, cz: number): number {
    return groundHeightAt(cx, cz);
}

/** Local Y for a draped vertex — height relative to the anchor so object.position sits on relief. */
function drapeLocalY(wx: number, wz: number, anchorY: number): number {
    return groundHeightAt(wx, wz) - anchorY;
}

/** Anchor object origin on relief + lift (transparent sort uses object position, not verts). */
export function setDrapedObjectPosition(
    obj: Object3D,
    cx: number,
    cz: number,
    extraLift = 0,
): void {
    obj.position.set(cx, drapeAnchorY(cx, cz) + DRAPE_LIFT + extraLift, cz);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
}

/** Anchor mesh origin on relief + lift (transparent sort uses object position, not verts). */
export function setDrapedMeshPosition(
    mesh: Mesh,
    cx: number,
    cz: number,
    extraLift = 0,
): void {
    setDrapedObjectPosition(mesh, cx, cz, extraLift);
}

function prepDrapedLine(line: Line, cx: number, cz: number, extraLift = 0.01): void {
    setDrapedObjectPosition(line, cx, cz, extraLift);
    line.frustumCulled = false;
    line.renderOrder = DRAPE_RENDER_ORDER + 1;
}

function prepDrapedFill(mesh: Mesh): void {
    mesh.frustumCulled = false;
    mesh.renderOrder = DRAPE_RENDER_ORDER;
}

/**
 * Tessellated ground-aligned rect, yawed in XZ, draped over board relief.
 * Vertices are local XZ + relative Y — caller sets position via {@link setDrapedMeshPosition}.
 */
export function drapeRectGeometry(
    halfW: number,
    halfD: number,
    yaw: number,
    cx: number,
    cz: number,
): PlaneGeometry {
    const anchorY = drapeAnchorY(cx, cz);
    const segsW = Math.max(2, Math.ceil((halfW * 2) / 2));
    const segsD = Math.max(2, Math.ceil((halfD * 2) / 2));
    const geo = new PlaneGeometry(halfW * 2, halfD * 2, segsW, segsD);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = lx * c - lz * s;
        const wz = lx * s + lz * c;
        pos.setXYZ(i, wx, drapeLocalY(cx + wx, cz + wz, anchorY), wz);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

/** Closed outline of a yawed rect, sampled densely and draped on the relief. */
export function drapeRectOutline(
    cx: number,
    cz: number,
    halfW: number,
    halfD: number,
    yaw: number,
): BufferGeometry {
    const anchorY = drapeAnchorY(cx, cz);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const edge = (ax: number, az: number, bx: number, bz: number, steps: number) => {
        const out: Vector3[] = [];
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const lx = ax + (bx - ax) * t;
            const lz = az + (bz - az) * t;
            const wx = cx + lx * c - lz * s;
            const wz = cz + lx * s + lz * c;
            out.push(new Vector3(wx - cx, drapeLocalY(wx, wz, anchorY) + 0.01, wz - cz));
        }
        return out;
    };
    const steps = Math.max(4, Math.ceil(Math.max(halfW, halfD)));
    const pts = [
        ...edge(-halfW, -halfD, halfW, -halfD, steps),
        ...edge(halfW, -halfD, halfW, halfD, steps),
        ...edge(halfW, halfD, -halfW, halfD, steps),
        ...edge(-halfW, halfD, -halfW, -halfD, steps),
    ];
    pts.push(pts[0]!.clone());
    return new BufferGeometry().setFromPoints(pts);
}

/**
 * Concentric-ring disk draped over relief. Vertices are local XZ + relative Y —
 * caller sets position via {@link setDrapedMeshPosition}.
 */
export function drapeDiskGeometry(cx: number, cz: number, radius: number): BufferGeometry {
    const anchorY = drapeAnchorY(cx, cz);
    const segs = Math.max(24, Math.min(64, Math.ceil(radius * 4)));
    const rings = Math.max(2, Math.ceil(radius / 2));
    const positions: number[] = [];
    const indices: number[] = [];
    // center
    positions.push(0, 0, 0);
    for (let r = 1; r <= rings; r++) {
        const rr = (r / rings) * radius;
        for (let i = 0; i < segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const lx = Math.cos(a) * rr;
            const lz = Math.sin(a) * rr;
            positions.push(lx, drapeLocalY(cx + lx, cz + lz, anchorY), lz);
        }
    }
    for (let i = 0; i < segs; i++) {
        const a = 1 + i;
        const b = 1 + ((i + 1) % segs);
        indices.push(0, a, b);
    }
    for (let r = 1; r < rings; r++) {
        const ring0 = 1 + (r - 1) * segs;
        const ring1 = 1 + r * segs;
        for (let i = 0; i < segs; i++) {
            const i1 = (i + 1) % segs;
            const a = ring0 + i;
            const b = ring0 + i1;
            const c = ring1 + i1;
            const d = ring1 + i;
            indices.push(a, d, b, b, d, c);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/** Closed circle outline draped on the relief (local XZ + relative Y — position the Line at center). */
export function drapeCircleOutline(cx: number, cz: number, radius: number): BufferGeometry {
    const anchorY = drapeAnchorY(cx, cz);
    const steps = Math.max(32, Math.min(96, Math.ceil(radius * 6)));
    const pts: Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = cx + Math.cos(a) * radius;
        const z = cz + Math.sin(a) * radius;
        pts.push(new Vector3(x - cx, drapeLocalY(x, z, anchorY) + 0.01, z - cz));
    }
    return new BufferGeometry().setFromPoints(pts);
}

/** Add a draped filled disk + outline into a group. */
export function addDrapedCircle(
    group: Group,
    x: number,
    z: number,
    radius: number,
    color: number,
    fillOpacity: number,
    lineOpacity: number,
): { fill?: Mesh; line: Line } {
    let fill: Mesh | undefined;
    if (fillOpacity > 0) {
        fill = addDrapedCircleFill(group, x, z, radius, color, fillOpacity);
    }
    const line = new Line(
        drapeCircleOutline(x, z, radius),
        new LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
    );
    prepDrapedLine(line, x, z);
    group.add(line);
    return { fill, line };
}

/** Replace a draped disk fill's geometry at a new radius (do not XZ-scale — Y stays wrong on slopes). */
export function rebuildDrapedCircleFill(
    mesh: Mesh,
    cx: number,
    cz: number,
    radius: number,
): void {
    mesh.geometry.dispose();
    mesh.geometry = drapeDiskGeometry(cx, cz, radius);
    setDrapedMeshPosition(mesh, cx, cz);
}

/** Fill-only draped disk (local verts + mesh.position at center). */
export function addDrapedCircleFill(
    group: Group,
    x: number,
    z: number,
    radius: number,
    color: number,
    fillOpacity: number,
): Mesh {
    const disc = new Mesh(
        drapeDiskGeometry(x, z, radius),
        new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: fillOpacity,
            side: DoubleSide,
            depthWrite: false,
        }),
    );
    setDrapedMeshPosition(disc, x, z);
    prepDrapedFill(disc);
    group.add(disc);
    return disc;
}

/** Draped square decal for a spell icon texture (hammer silhouette or emoji). */
export function addDrapedIconDecal(
    group: Group,
    texture: Texture,
    x: number,
    z: number,
    halfSize: number,
    yaw = 0,
    opacity = 0.72,
): void {
    const mesh = new Mesh(
        drapeRectGeometry(halfSize, halfSize, yaw, x, z),
        new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity,
            side: DoubleSide,
            depthWrite: false,
        }),
    );
    setDrapedMeshPosition(mesh, x, z, 0.02);
    prepDrapedFill(mesh);
    group.add(mesh);
}

/** Add a draped yawed rect + outline into a group. */
export function addDrapedRect(
    group: Group,
    x: number,
    z: number,
    halfW: number,
    halfD: number,
    yaw: number,
    color: number,
    fillOpacity: number,
    lineOpacity: number,
): { fill?: Mesh; line: Line } {
    let fill: Mesh | undefined;
    if (fillOpacity > 0) {
        fill = addDrapedRectFill(group, x, z, halfW, halfD, yaw, color, fillOpacity);
    }
    const line = new Line(
        drapeRectOutline(x, z, halfW, halfD, yaw),
        new LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
    );
    prepDrapedLine(line, x, z);
    group.add(line);
    return { fill, line };
}

/** Replace a draped rect fill at new half extents (do not XZ-scale — Y stays wrong on slopes). */
export function rebuildDrapedRectFill(
    mesh: Mesh,
    cx: number,
    cz: number,
    halfW: number,
    halfD: number,
    yaw: number,
): void {
    mesh.geometry.dispose();
    mesh.geometry = drapeRectGeometry(halfW, halfD, yaw, cx, cz);
    setDrapedMeshPosition(mesh, cx, cz);
}

/** Fill-only draped rect (local verts + mesh.position at center). */
export function addDrapedRectFill(
    group: Group,
    x: number,
    z: number,
    halfW: number,
    halfD: number,
    yaw: number,
    color: number,
    fillOpacity: number,
): Mesh {
    const fill = new Mesh(
        drapeRectGeometry(halfW, halfD, yaw, x, z),
        new MeshBasicMaterial({
            color,
            transparent: true,
            opacity: fillOpacity,
            side: DoubleSide,
            depthWrite: false,
        }),
    );
    setDrapedMeshPosition(fill, x, z);
    prepDrapedFill(fill);
    group.add(fill);
    return fill;
}

/**
 * Oil-style capsule (fill + single outer border), draped over relief.
 * Shared by oil, acid, fire, dragon, and rally path markers.
 * Border is the stadium silhouette only — no full end-circle rims inside.
 */
export function addDrapedCapsule(
    group: Group,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    radius: number,
    fillColor: number,
    lineColor: number,
    fillOpacity: number,
    lineOpacity: number,
): void {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.hypot(dx, dz);
    const fillMat = new MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        side: DoubleSide,
        depthWrite: false,
    });

    if (len < 0.5) {
        addDrapedCircle(group, startX, startZ, radius, fillColor, fillOpacity, lineOpacity);
        fillMat.dispose();
        return;
    }

    const ux = dx / len;
    const uz = dz / len;
    const px = -uz * radius;
    const pz = ux * radius;
    const mx = (startX + endX) * 0.5;
    const mz = (startZ + endZ) * 0.5;
    // one mesh = one opacity (no overlapping end discs that darken under alpha)
    const body = new Mesh(
        buildDrapedCapsuleFill(startX, startZ, endX, endZ, px, pz, ux, uz, radius),
        fillMat,
    );
    setDrapedMeshPosition(body, mx, mz);
    prepDrapedFill(body);
    group.add(body);

    const line = new Line(
        drapeCapsuleOutline(startX, startZ, endX, endZ, radius),
        new LineBasicMaterial({
            color: lineColor,
            transparent: true,
            opacity: lineOpacity,
        }),
    );
    prepDrapedLine(line, mx, mz);
    group.add(line);
}

/**
 * Closed stadium outline: two side rails + outer end caps only
 * (no interior arcs where the end circles would cut through the strip).
 */
export function drapeCapsuleOutline(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    radius: number,
): BufferGeometry {
    const dx = ex - sx;
    const dz = ez - sz;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz * radius;
    const pz = ux * radius;
    const mx = (sx + ex) * 0.5;
    const mz = (sz + ez) * 0.5;
    const anchorY = drapeAnchorY(mx, mz);
    const pts: Vector3[] = [];
    const push = (x: number, z: number) => {
        pts.push(new Vector3(x - mx, drapeLocalY(x, z, anchorY) + 0.01, z - mz));
    };

    const sideSteps = Math.max(4, Math.ceil(len / 1.5));
    // +perp rail: start → end
    for (let i = 0; i <= sideSteps; i++) {
        const t = i / sideSteps;
        push(sx + dx * t + px, sz + dz * t + pz);
    }
    // outer semicircle at end (bulge along +forward)
    appendDrapedSemicircleOutline(push, ex, ez, ux, uz, px, pz, radius);
    // -perp rail: end → start
    for (let i = 0; i <= sideSteps; i++) {
        const t = i / sideSteps;
        push(ex - dx * t - px, ez - dz * t - pz);
    }
    // outer semicircle at start (bulge along −forward); rails arrive at −perp
    appendDrapedSemicircleOutline(push, sx, sz, -ux, -uz, -px, -pz, radius);

    if (pts.length > 0) pts.push(pts[0]!.clone());
    return new BufferGeometry().setFromPoints(pts);
}

/**
 * Tessellated chevron draped over relief. Tip points +Z in local space; yaw rotates in XZ.
 * Caller sets position via {@link setDrapedMeshPosition}.
 */
export function drapeChevronGeometry(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    yaw: number,
): BufferGeometry {
    const anchorY = drapeAnchorY(cx, cz);
    const hw = width / 2;
    const tipZ = depth * 0.5;
    const baseZ = -depth * 0.5;
    const segsAlong = Math.max(3, Math.ceil(depth / 1.5));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const positions: number[] = [];
    const indices: number[] = [];
    const rowStarts: number[] = [];
    const rowCounts: number[] = [];

    const pushLocal = (lx: number, lz: number): number => {
        const wx = lx * c - lz * s;
        const wz = lx * s + lz * c;
        positions.push(wx, drapeLocalY(cx + wx, cz + wz, anchorY), wz);
        return positions.length / 3 - 1;
    };

    for (let row = 0; row <= segsAlong; row++) {
        const t = row / segsAlong;
        const lz = baseZ + t * (tipZ - baseZ);
        const halfW = hw * (1 - t);
        const segsAcross = halfW < 0.05 ? 0 : Math.max(1, Math.ceil((halfW * 2) / 1.5));
        rowStarts.push(positions.length / 3);
        rowCounts.push(segsAcross + 1);
        if (segsAcross === 0) {
            pushLocal(0, lz);
            continue;
        }
        for (let col = 0; col <= segsAcross; col++) {
            const u = col / segsAcross;
            pushLocal(-halfW + u * halfW * 2, lz);
        }
    }

    for (let row = 0; row < segsAlong; row++) {
        const n0 = rowCounts[row]!;
        const n1 = rowCounts[row + 1]!;
        const s0 = rowStarts[row]!;
        const s1 = rowStarts[row + 1]!;
        if (n1 === 1) {
            for (let a = 0; a < n0 - 1; a++) {
                indices.push(s1, s0 + a, s0 + a + 1);
            }
            continue;
        }
        for (let a = 0; a < n0 - 1; a++) {
            const b = Math.min(Math.floor((a / (n0 - 1)) * (n1 - 1)), n1 - 2);
            const i0 = s0 + a;
            const i1 = s0 + a + 1;
            const j0 = s1 + b;
            const j1 = s1 + b + 1;
            indices.push(i0, j0, i1, i1, j0, j1);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/** walk the outer semicircle from +perp → −perp through the bulge direction */
function appendDrapedSemicircleOutline(
    push: (x: number, z: number) => void,
    cx: number,
    cz: number,
    bulgeX: number,
    bulgeZ: number,
    px: number,
    pz: number,
    r: number,
): void {
    const aLeft = Math.atan2(pz, px);
    const aBulge = Math.atan2(bulgeZ, bulgeX);
    const ccwToBulge = (((aBulge - aLeft) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const clockwise = ccwToBulge > Math.PI;
    const sweep = clockwise ? -Math.PI : Math.PI;
    const steps = Math.max(16, Math.min(48, Math.ceil(r * 4)));
    // skip i=0 — already at +perp from the incoming rail
    for (let i = 1; i <= steps; i++) {
        const a = aLeft + (sweep * i) / steps;
        push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
}

function buildDrapedCapsuleFill(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    px: number,
    pz: number,
    _ux: number,
    _uz: number,
    r: number,
): BufferGeometry {
    const dx = ex - sx;
    const dz = ez - sz;
    const len = Math.hypot(dx, dz);
    // tessellate along/across the strip so the fill hugs hills (a single quad clips terrain)
    const along = Math.max(4, Math.ceil(len / 1.5));
    const across = Math.max(3, Math.ceil(r / 1.5));
    const mx = (sx + ex) * 0.5;
    const mz = (sz + ez) * 0.5;
    const anchorY = drapeAnchorY(mx, mz);
    const positions: number[] = [];
    const indices: number[] = [];
    // local XZ relative to route midpoint; Y relative to midpoint relief
    const push = (wx: number, wz: number): number => {
        positions.push(wx - mx, drapeLocalY(wx, wz, anchorY), wz - mz);
        return positions.length / 3 - 1;
    };

    const cols = across + 1;
    for (let i = 0; i <= along; i++) {
        const t = i / along;
        const cx = sx + dx * t;
        const cz = sz + dz * t;
        for (let j = 0; j <= across; j++) {
            const s = (j / across) * 2 - 1; // -1 … +1 across the strip
            push(cx + px * s, cz + pz * s);
        }
    }
    for (let i = 0; i < along; i++) {
        for (let j = 0; j < across; j++) {
            const a = i * cols + j;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    // semicircle caps — concentric rings (same density as the strip), not a fan
    // that spans the full radius in one triangle and clips hills
    appendSemicircleCap(push, indices, ex, ez, dx / len, dz / len, px, pz, r);
    appendSemicircleCap(push, indices, sx, sz, -dx / len, -dz / len, px, pz, r);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Draped semicircle fill at a capsule end. Concentric rings + angular steps so
 * interior verts sample relief (a center→rim fan floats/clips on mounds).
 */
function appendSemicircleCap(
    push: (x: number, z: number) => number,
    indices: number[],
    cx: number,
    cz: number,
    bulgeX: number,
    bulgeZ: number,
    px: number,
    pz: number,
    r: number,
): void {
    const aLeft = Math.atan2(pz, px);
    const aBulge = Math.atan2(bulgeZ, bulgeX);
    const ccwToBulge = (((aBulge - aLeft) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const clockwise = ccwToBulge > Math.PI;
    const sweep = clockwise ? -Math.PI : Math.PI;
    const rings = Math.max(2, Math.ceil(r / 1.5));
    const steps = Math.max(16, Math.min(48, Math.ceil(r * 4)));
    const center = push(cx, cz);

    // each ring: steps+1 verts from +perp through bulge to −perp (inclusive ends)
    const ringStarts: number[] = [];
    for (let ring = 1; ring <= rings; ring++) {
        const rr = (ring / rings) * r;
        let start = -1;
        for (let i = 0; i <= steps; i++) {
            const a = aLeft + (sweep * i) / steps;
            const idx = push(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
            if (start < 0) start = idx;
        }
        ringStarts.push(start);
    }

    // center → first ring
    const s0 = ringStarts[0]!;
    for (let i = 0; i < steps; i++) {
        indices.push(center, s0 + i, s0 + i + 1);
    }
    // ring → ring
    for (let ring = 0; ring < rings - 1; ring++) {
        const a = ringStarts[ring]!;
        const b = ringStarts[ring + 1]!;
        for (let i = 0; i < steps; i++) {
            const i0 = a + i;
            const i1 = a + i + 1;
            const j0 = b + i;
            const j1 = b + i + 1;
            indices.push(i0, j0, i1, i1, j0, j1);
        }
    }
}
