/**
 * Outer-terrain material weights for the mountain editor.
 * Channels map to mesh attributes the outer shader already understands
 * (plus aRock / aSnow / aGrass for authored overrides).
 */

import { BufferAttribute, type BufferGeometry, type Mesh } from 'three';
import {
    makeLandscapeHeightfieldBounds,
    sampleHeightfield,
    type LandscapeHeightfield,
} from './landscapeHeight';

export type OuterMaterialKind = 'grass' | 'rock' | 'snow' | 'beach' | 'scree';

export interface OuterMaterialFields {
    originX: number;
    originZ: number;
    size: number;
    res: number;
    grass: number[];
    rock: number[];
    snow: number[];
    beach: number[];
    scree: number[];
}

const ATTRS = ['aGrass', 'aRock', 'aSnow', 'aBeach', 'aScree'] as const;

/** Ensure outer mesh has paintable material attributes (zeros if missing). */
export function ensureOuterMaterialAttrs(geometry: BufferGeometry): void {
    const n = geometry.attributes.position!.count;
    for (const name of ATTRS) {
        if (geometry.getAttribute(name)) continue;
        geometry.setAttribute(name, new BufferAttribute(new Float32Array(n), 1));
    }
}

function asFloatAttr(geometry: BufferGeometry, name: string): BufferAttribute {
    ensureOuterMaterialAttrs(geometry);
    return geometry.getAttribute(name) as BufferAttribute;
}

/** Paint one material channel on the outer mesh (board is ignored). */
export function paintOuterMaterial(
    mesh: Mesh,
    kind: OuterMaterialKind,
    cx: number,
    cz: number,
    radius: number,
    strength: number,
): void {
    const geo = mesh.geometry;
    ensureOuterMaterialAttrs(geo);
    const pos = geo.attributes.position as BufferAttribute;
    const grass = asFloatAttr(geo, 'aGrass');
    const rock = asFloatAttr(geo, 'aRock');
    const snow = asFloatAttr(geo, 'aSnow');
    const beach = asFloatAttr(geo, 'aBeach');
    const scree = asFloatAttr(geo, 'aScree');
    const r2 = radius * radius;
    const amt = Math.min(1, Math.max(0.02, strength * 0.22));

    for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - cx;
        const dz = pos.getZ(i) - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const fall = 1 - Math.sqrt(d2) / radius;
        const w = fall * fall * amt;

        const blendUp = (attr: BufferAttribute, target: number) => {
            const cur = attr.getX(i);
            attr.setX(i, cur + (target - cur) * w);
        };
        const blendDown = (attr: BufferAttribute) => {
            const cur = attr.getX(i);
            attr.setX(i, cur * (1 - w));
        };

        if (kind === 'grass') {
            blendUp(grass, 1);
            blendDown(rock);
            blendDown(snow);
            blendDown(beach);
            blendDown(scree);
        } else if (kind === 'rock') {
            blendUp(rock, 1);
            blendDown(grass);
            blendDown(snow);
            blendDown(beach);
        } else if (kind === 'snow') {
            blendUp(snow, 1);
            blendDown(grass);
            blendDown(beach);
        } else if (kind === 'beach') {
            blendUp(beach, 1);
            blendDown(grass);
            blendDown(snow);
            blendDown(rock);
        } else {
            blendUp(scree, 1);
            blendDown(grass);
            blendDown(snow);
        }
    }

    grass.needsUpdate = true;
    rock.needsUpdate = true;
    snow.needsUpdate = true;
    beach.needsUpdate = true;
    scree.needsUpdate = true;
}

function channelFromAttr(mesh: Mesh, name: string, bounds: ReturnType<typeof makeLandscapeHeightfieldBounds>): number[] {
    const { originX, originZ, size, res } = bounds;
    const cell = size / Math.max(1, res - 1);
    const out = new Float32Array(res * res);
    const filled = new Uint8Array(res * res);
    const geo = mesh.geometry;
    ensureOuterMaterialAttrs(geo);
    const pos = geo.attributes.position as BufferAttribute;
    const attr = asFloatAttr(geo, name);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const ix = Math.min(res - 1, Math.max(0, Math.floor((x - originX) / cell)));
        const iz = Math.min(res - 1, Math.max(0, Math.floor((z - originZ) / cell)));
        const idx = iz * res + ix;
        const v = attr.getX(i);
        if (!filled[idx] || v > out[idx]!) {
            out[idx] = v;
            filled[idx] = 1;
        }
    }
    // cheap dilate so High sparse verts still pick up painted pockets
    for (let pass = 0; pass < 2; pass++) {
        const next = filled.slice();
        for (let iz = 0; iz < res; iz++) {
            for (let ix = 0; ix < res; ix++) {
                const idx = iz * res + ix;
                if (filled[idx]) continue;
                let best = Infinity;
                let val = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dz) continue;
                        const jx = ix + dx;
                        const jz = iz + dz;
                        if (jx < 0 || jz < 0 || jx >= res || jz >= res) continue;
                        const j = jz * res + jx;
                        if (!filled[j]) continue;
                        const d2 = dx * dx + dz * dz;
                        if (d2 < best) {
                            best = d2;
                            val = out[j]!;
                        }
                    }
                }
                if (Number.isFinite(best)) {
                    out[idx] = val;
                    next[idx] = 1;
                }
            }
        }
        filled.set(next);
    }
    return Array.from(out);
}

export function rasterizeOuterMaterials(
    mesh: Mesh,
    map: { halfW: number; halfH: number },
): OuterMaterialFields {
    const bounds = makeLandscapeHeightfieldBounds(map);
    return {
        ...bounds,
        grass: channelFromAttr(mesh, 'aGrass', bounds),
        rock: channelFromAttr(mesh, 'aRock', bounds),
        snow: channelFromAttr(mesh, 'aSnow', bounds),
        beach: channelFromAttr(mesh, 'aBeach', bounds),
        scree: channelFromAttr(mesh, 'aScree', bounds),
    };
}

function sampleChannel(fields: OuterMaterialFields, channel: number[], x: number, z: number): number {
    const hf: LandscapeHeightfield = {
        originX: fields.originX,
        originZ: fields.originZ,
        size: fields.size,
        res: fields.res,
        heights: channel,
    };
    return sampleHeightfield(hf, x, z);
}

/** Drape authored material weights onto an outer mesh (any scenery tier). */
export function applyMaterialFieldsToMesh(mesh: Mesh, fields: OuterMaterialFields): void {
    const geo = mesh.geometry;
    ensureOuterMaterialAttrs(geo);
    const pos = geo.attributes.position as BufferAttribute;
    const grass = asFloatAttr(geo, 'aGrass');
    const rock = asFloatAttr(geo, 'aRock');
    const snow = asFloatAttr(geo, 'aSnow');
    const beach = asFloatAttr(geo, 'aBeach');
    const scree = asFloatAttr(geo, 'aScree');
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        grass.setX(i, sampleChannel(fields, fields.grass, x, z));
        rock.setX(i, sampleChannel(fields, fields.rock, x, z));
        snow.setX(i, sampleChannel(fields, fields.snow, x, z));
        beach.setX(i, sampleChannel(fields, fields.beach, x, z));
        scree.setX(i, sampleChannel(fields, fields.scree, x, z));
    }
    grass.needsUpdate = true;
    rock.needsUpdate = true;
    snow.needsUpdate = true;
    beach.needsUpdate = true;
    scree.needsUpdate = true;
}
