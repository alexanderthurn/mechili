/**
 * The generated board relief a match plays on (Match settings → Terrain).
 * 'standard' sparse low mounds · 'hills' many taller, steeper hills ·
 * 'highlands' each Stronghold on a small high plateau with one ramp up ·
 * 'wall' a hilly wall with gaps between the two sides, the rest nearly flat.
 * Every shape is point symmetric (neither side gets the better ground) and
 * meets the meadow at y 0 along the board's edge.
 */
export type TerrainShape = 'standard' | 'hills' | 'highlands' | 'wall';
export const TERRAIN_SHAPES: readonly TerrainShape[] = ['standard', 'hills', 'highlands', 'wall'];
export const DEFAULT_TERRAIN_SHAPE: TerrainShape = 'standard';
export function terrainShapeOption(raw: unknown): TerrainShape {
    return TERRAIN_SHAPES.includes(raw as TerrainShape) ? (raw as TerrainShape) : DEFAULT_TERRAIN_SHAPE;
}
