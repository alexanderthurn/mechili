import { CanvasTexture, type Texture } from 'three';
import { drawIcon } from '../ui/iconAtlas';
import type { TypeRegistry } from './content/typeRegistry';
import { OIL_SPILL_ID } from './tactics';
import { BASE_TYPES } from './units';

/** decals by icon + glow, so a level restyling a spell never reuses the old one */
const atlasMarkerTex = new Map<string, CanvasTexture>();

/**
 * Ground decal for a spell (deploy + battle charge markers): its HUD icon on
 * the spell's `marker.glow`. Null for a spell without a glow.
 */
export function getAtlasMarkerTexture(tacticId: string, types: TypeRegistry = BASE_TYPES): CanvasTexture | null {
    const tactic = types.tactic(tacticId);
    const glow = tactic?.marker?.glow;
    if (!tactic?.icon || !glow) return null;
    const key = `${tactic.icon}|${glow}`;
    let tex = atlasMarkerTex.get(key);
    if (!tex) {
        tex = makeAtlasMarkerTexture(tactic.icon, glow);
        atlasMarkerTex.set(key, tex);
    }
    return tex;
}

export function ownsAtlasMarkerTexture(tex: Texture | null | undefined): boolean {
    if (!tex) return false;
    for (const t of atlasMarkerTex.values()) {
        if (t === tex) return true;
    }
    return false;
}

/** @deprecated use {@link getAtlasMarkerTexture}(OIL_SPILL_ID) */
export function getOilBarrelMarkerTexture(): CanvasTexture {
    return getAtlasMarkerTexture(OIL_SPILL_ID)!;
}

/** @deprecated use {@link ownsAtlasMarkerTexture} */
export function ownsOilBarrelMarkerTexture(tex: Texture | null | undefined): boolean {
    return ownsAtlasMarkerTexture(tex);
}

/** Ground-decal textures for battle spell markers, from the match's spells. */
export class SpellIconTextures {
    constructor(private readonly types: TypeRegistry) {}

    textureFor(tacticId: string): Texture | null {
        return getAtlasMarkerTexture(tacticId, this.types);
    }

    owns(tex: Texture | null | undefined): boolean {
        return ownsAtlasMarkerTexture(tex);
    }

    dispose(): void {
        for (const t of atlasMarkerTex.values()) t.dispose();
        atlasMarkerTex.clear();
    }
}

/** Atlas sprite + soft glow — matches HUD spell art on draped ground plates. */
function makeAtlasMarkerTexture(iconId: string, glowInner: string): CanvasTexture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);

    const glow = ctx.createRadialGradient(0, 0, 16, 0, 0, 112);
    glow.addColorStop(0, glowInner);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 112, 0, Math.PI * 2);
    ctx.fill();

    const iconSize = Math.round(size * 0.54);
    drawIcon(ctx, iconId, -iconSize / 2, -iconSize / 2 + 4, iconSize);

    const tex = new CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
}
