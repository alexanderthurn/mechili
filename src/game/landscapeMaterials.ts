/**
 * Outer-terrain material weights for the mountain editor.
 * Channels map to mesh attributes the outer shader already understands
 * (plus aRock / aSnow / aGrass for authored overrides).
 */

import { BufferAttribute, type BufferGeometry, type Mesh } from 'three';

export type OuterMaterialKind = 'grass' | 'rock' | 'snow' | 'beach' | 'scree';


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
