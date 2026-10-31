/**
 * The dark wet-stain value blood takes on the ground and in the air: each sRGB channel
 * of a unit's bloodColor × BLOOD_CRUSH, keeping its hue. One place so the spray matches
 * the puddle it lands in.
 */
export const BLOOD_CRUSH = 0.14;
/** Airborne drops: a touch lighter than the stain — tiny and backlit, the full crush reads black */
export const BLOOD_CRUSH_AIR = 0.22;

/** `hex` (sRGB) crushed to the blood-stain value, still sRGB hex. */
export function crushBlood(hex: number, k = BLOOD_CRUSH): number {
    const r = Math.round(((hex >> 16) & 255) * k);
    const g = Math.round(((hex >> 8) & 255) * k);
    const b = Math.round((hex & 255) * k);
    return (r << 16) | (g << 8) | b;
}
