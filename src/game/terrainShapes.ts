/**
 * The generated board relief a match plays on (Match settings → Terrain).
 * 'standard' sparse low mounds · 'hills' more, taller rolling hills ·
 * 'highlands' each Stronghold at the top of a broad rise · 'ridges' a flat
 * middle, low foothills, and a ridge with passes guarding each base.
 * Every shape is point symmetric (neither side gets the better ground) and
 * meets the meadow at y 0 along the board's edge.
 */
export type TerrainShape = 'standard' | 'hills' | 'highlands' | 'ridges';
export const TERRAIN_SHAPES: readonly TerrainShape[] = ['standard', 'hills', 'highlands', 'ridges'];
export const DEFAULT_TERRAIN_SHAPE: TerrainShape = 'standard';
export function terrainShapeOption(raw: unknown): TerrainShape {
    return TERRAIN_SHAPES.includes(raw as TerrainShape) ? (raw as TerrainShape) : DEFAULT_TERRAIN_SHAPE;
}
