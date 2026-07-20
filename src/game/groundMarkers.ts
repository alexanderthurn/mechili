import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Texture,
    Vector3,
    type Group,
} from 'three';
import { groundHeightAt } from './map';

/** small lift on draped plates (same idea as unit footprint plates) */
export const DRAPE_LIFT = 0.08;

/**
 * Tessellated ground-aligned rect, yawed in XZ, draped over board relief.
 * Vertices are local to the stamp center — caller sets mesh.position to (x, lift, z).
 */
export function drapeRectGeometry(
    halfW: number,
    halfD: number,
    yaw: number,
    cx: number,
    cz: number,
): PlaneGeometry {
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
        pos.setXYZ(i, wx, groundHeightAt(cx + wx, cz + wz), wz);
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
            out.push(new Vector3(wx, groundHeightAt(wx, wz) + DRAPE_LIFT + 0.01, wz));
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
 * Concentric-ring disk draped over relief. Vertices are local to center —
 * caller sets mesh.position to (x, lift, z).
 */
export function drapeDiskGeometry(cx: number, cz: number, radius: number): BufferGeometry {
    const segs = Math.max(24, Math.min(64, Math.ceil(radius * 4)));
    const rings = Math.max(2, Math.ceil(radius / 2));
    const positions: number[] = [];
    const indices: number[] = [];
    // center
    positions.push(0, groundHeightAt(cx, cz), 0);
    for (let r = 1; r <= rings; r++) {
        const rr = (r / rings) * radius;
        for (let i = 0; i < segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const lx = Math.cos(a) * rr;
            const lz = Math.sin(a) * rr;
            positions.push(lx, groundHeightAt(cx + lx, cz + lz), lz);
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

/** Closed circle outline draped on the relief. */
export function drapeCircleOutline(cx: number, cz: number, radius: number): BufferGeometry {
    const steps = Math.max(32, Math.min(96, Math.ceil(radius * 6)));
    const pts: Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = cx + Math.cos(a) * radius;
        const z = cz + Math.sin(a) * radius;
        pts.push(new Vector3(x, groundHeightAt(x, z) + DRAPE_LIFT + 0.01, z));
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
    mesh.position.set(cx, DRAPE_LIFT, cz);
    mesh.scale.set(1, 1, 1);
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
    disc.position.set(x, DRAPE_LIFT, z);
    disc.frustumCulled = false;
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
    mesh.position.set(x, DRAPE_LIFT + 0.02, z);
    mesh.frustumCulled = false;
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
    mesh.position.set(cx, DRAPE_LIFT, cz);
    mesh.scale.set(1, 1, 1);
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
    fill.position.set(x, DRAPE_LIFT, z);
    fill.frustumCulled = false;
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
    // one mesh = one opacity (no overlapping end discs that darken under alpha)
    const body = new Mesh(
        buildDrapedCapsuleFill(startX, startZ, endX, endZ, px, pz, ux, uz, radius),
        fillMat,
    );
    body.frustumCulled = false;
    group.add(body);

    group.add(
        new Line(
            drapeCapsuleOutline(startX, startZ, endX, endZ, radius),
            new LineBasicMaterial({
                color: lineColor,
                transparent: true,
                opacity: lineOpacity,
            }),
        ),
    );
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
    const pts: Vector3[] = [];
    const lift = DRAPE_LIFT + 0.01;
    const push = (x: number, z: number) => {
        pts.push(new Vector3(x, groundHeightAt(x, z) + lift, z));
    };

    const sideSteps = Math.max(4, Math.ceil(len / 2));
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
 * Caller sets mesh.position to (cx, lift, cz) with identity rotation.
 */
export function drapeChevronGeometry(
    cx: number,
    cz: number,
    width: number,
    depth: number,
    yaw: number,
): BufferGeometry {
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
        positions.push(wx, groundHeightAt(cx + wx, cz + wz), wz);
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
    // tessellate along the strip so the fill hugs hills (a single quad clips terrain)
    const along = Math.max(4, Math.ceil(len / 2));
    const across = Math.max(2, Math.ceil(r / 2));
    const positions: number[] = [];
    const indices: number[] = [];
    const push = (x: number, z: number): number => {
        positions.push(x, groundHeightAt(x, z) + DRAPE_LIFT, z);
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

    // semicircle caps at each end (already sampled densely)
    appendSemicircleCap(push, indices, ex, ez, dx / len, dz / len, px, pz, r);
    appendSemicircleCap(push, indices, sx, sz, -dx / len, -dz / len, px, pz, r);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

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
    const center = push(cx, cz);
    const aLeft = Math.atan2(pz, px);
    const aBulge = Math.atan2(bulgeZ, bulgeX);
    const ccwToBulge = (((aBulge - aLeft) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const clockwise = ccwToBulge > Math.PI;
    const sweep = clockwise ? -Math.PI : Math.PI;
    const steps = 28;
    let prev = -1;
    for (let i = 0; i <= steps; i++) {
        const a = aLeft + (sweep * i) / steps;
        const idx = push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
        if (prev >= 0) indices.push(center, prev, idx);
        prev = idx;
    }
}
