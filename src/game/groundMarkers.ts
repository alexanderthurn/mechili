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

/** Fill-only draped disk (local verts — safe to scale from mesh.position). */
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

/** Fill-only draped rect (local verts — safe to scale from mesh.position). */
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
 * Oil-style capsule (fill + end caps + side lines), draped over relief.
 * Shared by oil, acid, and dragon path markers.
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
    const lineMat = new LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: lineOpacity,
    });

    if (len < 0.5) {
        addDrapedCircle(group, startX, startZ, radius, fillColor, fillOpacity, lineOpacity);
        fillMat.dispose();
        lineMat.dispose();
        return;
    }

    const ux = dx / len;
    const uz = dz / len;
    const px = -uz * radius;
    const pz = ux * radius;
    const body = new Mesh(
        buildDrapedCapsuleFill(startX, startZ, endX, endZ, px, pz, ux, uz, radius),
        fillMat,
    );
    body.frustumCulled = false;
    group.add(body);

    for (const [x, z] of [
        [startX, startZ],
        [endX, endZ],
    ] as const) {
        const capMat = fillMat.clone();
        capMat.opacity = fillOpacity + 0.06;
        const disc = new Mesh(drapeDiskGeometry(x, z, radius), capMat);
        disc.position.set(x, DRAPE_LIFT + 0.01, z);
        disc.frustumCulled = false;
        group.add(disc);
        group.add(new Line(drapeCircleOutline(x, z, radius), lineMat));
    }

    const sideSteps = Math.max(4, Math.ceil(len / 2));
    for (const [ox, oz] of [
        [px, pz],
        [-px, -pz],
    ] as const) {
        const pts: Vector3[] = [];
        for (let i = 0; i <= sideSteps; i++) {
            const t = i / sideSteps;
            const x = startX + dx * t + ox;
            const z = startZ + dz * t + oz;
            pts.push(new Vector3(x, groundHeightAt(x, z) + DRAPE_LIFT + 0.01, z));
        }
        group.add(new Line(new BufferGeometry().setFromPoints(pts), lineMat));
    }
}

function buildDrapedCapsuleFill(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    px: number,
    pz: number,
    ux: number,
    uz: number,
    r: number,
): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const push = (x: number, z: number): number => {
        positions.push(x, groundHeightAt(x, z), z);
        return positions.length / 3 - 1;
    };
    const q0 = push(sx + px, sz + pz);
    const q1 = push(ex + px, ez + pz);
    const q2 = push(ex - px, ez - pz);
    const q3 = push(sx - px, sz - pz);
    indices.push(q0, q1, q2, q0, q2, q3);
    appendSemicircleCap(push, indices, ex, ez, ux, uz, px, pz, r);
    appendSemicircleCap(push, indices, sx, sz, -ux, -uz, px, pz, r);
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
