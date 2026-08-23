import { CanvasTexture, type Texture } from 'three';
import { drawIcon } from '../ui/iconAtlas';
import {
    ACID_ID,
    BIG_METEOR_ID,
    DRAGON_ID,
    FIRE_SPILL_ID,
    HAMMER_ID,
    METEOR_SHOWER_ID,
    OIL_SPILL_ID,
    POISON_CLOUD_ID,
    SPAWN_CROWS_ID,
    SPAWN_DWARVES_ID,
    STORM_ID,
    TACTICS,
    tacticWorldGlyph,
} from './tactics';

/** radial glow tint behind each spell's ground icon */
const MARKER_GLOW: Record<string, string> = {
    [SPAWN_DWARVES_ID]: 'rgba(48, 36, 12, 0.55)',
    [BIG_METEOR_ID]: 'rgba(48, 20, 8, 0.55)',
    [SPAWN_CROWS_ID]: 'rgba(12, 28, 48, 0.55)',
    [HAMMER_ID]: 'rgba(40, 28, 8, 0.55)',
    [STORM_ID]: 'rgba(20, 20, 48, 0.55)',
    [METEOR_SHOWER_ID]: 'rgba(48, 24, 8, 0.55)',
    [POISON_CLOUD_ID]: 'rgba(16, 40, 12, 0.55)',
    [OIL_SPILL_ID]: 'rgba(40, 28, 8, 0.55)',
    [ACID_ID]: 'rgba(28, 36, 8, 0.55)',
    [FIRE_SPILL_ID]: 'rgba(48, 20, 8, 0.55)',
    [DRAGON_ID]: 'rgba(36, 14, 10, 0.55)',
};

const MARKER_TACTIC_IDS = Object.keys(MARKER_GLOW);

/** Ground decals that reuse HUD atlas art instead of emoji. */
const ATLAS_MARKER_TACTICS = new Set([
    OIL_SPILL_ID,
    ACID_ID,
    FIRE_SPILL_ID,
    SPAWN_DWARVES_ID,
    SPAWN_CROWS_ID,
    POISON_CLOUD_ID,
    BIG_METEOR_ID,
    METEOR_SHOWER_ID,
]);

const atlasMarkerTex = new Map<string, CanvasTexture>();

/** Cached atlas decal for a tactic (deploy + battle charge markers). */
export function getAtlasMarkerTexture(tacticId: string): CanvasTexture | null {
    if (!ATLAS_MARKER_TACTICS.has(tacticId)) return null;
    let tex = atlasMarkerTex.get(tacticId);
    if (tex) return tex;
    const tactic = TACTICS[tacticId];
    const glow = MARKER_GLOW[tacticId];
    if (!tactic?.icon || !glow) return null;
    tex = makeAtlasMarkerTexture(tactic.icon, glow);
    atlasMarkerTex.set(tacticId, tex);
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

/** Cached ground-decal textures for battle spell markers. */
export class SpellIconTextures {
    private readonly emoji = new Map<string, Texture>();
    private readonly hammerTex: Texture;

    constructor() {
        this.hammerTex = makeHammerFlatTexture();
        for (const id of MARKER_TACTIC_IDS) {
            if (id === HAMMER_ID || ATLAS_MARKER_TACTICS.has(id)) continue;
            const icon = tacticWorldGlyph(id);
            if (TACTICS[id]) this.emoji.set(id, makeEmojiSpellTexture(icon, MARKER_GLOW[id]!));
        }
    }

    textureFor(tacticId: string): Texture | null {
        if (tacticId === HAMMER_ID) return this.hammerTex;
        const atlas = getAtlasMarkerTexture(tacticId);
        if (atlas) return atlas;
        return this.emoji.get(tacticId) ?? null;
    }

    owns(tex: Texture | null | undefined): boolean {
        if (!tex) return false;
        if (tex === this.hammerTex) return true;
        if (ownsAtlasMarkerTexture(tex)) return true;
        for (const t of this.emoji.values()) {
            if (t === tex) return true;
        }
        return false;
    }

    dispose(): void {
        this.hammerTex.dispose();
        for (const t of atlasMarkerTex.values()) t.dispose();
        atlasMarkerTex.clear();
        for (const t of this.emoji.values()) t.dispose();
        this.emoji.clear();
    }
}

/** Emoji + soft glow — readable on draped ground plates. */
function makeEmojiSpellTexture(icon: string, glowInner: string): CanvasTexture {
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

    ctx.font = '132px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 0, 6);

    const tex = new CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
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

/** Flat golden warhammer silhouette for the hammer ground marker. */
function makeHammerFlatTexture(): Texture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.scale(size / 256, size / 256);

    const glow = ctx.createRadialGradient(0, 0, 20, 0, 0, 110);
    glow.addColorStop(0, MARKER_GLOW[HAMMER_ID]!);
    glow.addColorStop(1, 'rgba(40, 28, 8, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d4b24a';
    ctx.strokeStyle = '#5a4010';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(-70, -78);
    ctx.lineTo(70, -78);
    ctx.lineTo(62, -28);
    ctx.lineTo(-62, -28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f0d47a';
    ctx.fillRect(-18, -72, 36, 38);

    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.moveTo(-12, -28);
    ctx.lineTo(12, -28);
    ctx.lineTo(10, 88);
    ctx.lineTo(-10, 88);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 96, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const tex = new CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
}
