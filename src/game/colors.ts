import type { Color } from 'three';

/**
 * Team colors are keyed by CANONICAL side, not by local perspective: the
 * host ('a') is blue on both screens, the guest ('b') red. The palette is a
 * list so 2v2+ can add more sides later.
 */
export interface SideColor {
    hex: number;
    css: string;
    /** rgba prefix without the closing alpha paren (zone tints) */
    tint: string;
}

export const SIDE_COLORS: SideColor[] = [
    { hex: 0x3d8cd4, css: '#3d8cd4', tint: 'rgba(61, 140, 212,' }, // blue
    { hex: 0xe83828, css: '#e83828', tint: 'rgba(232, 56, 40,' }, // red
    { hex: 0x48b048, css: '#48b048', tint: 'rgba(72, 176, 72,' }, // green (future 2v2)
    { hex: 0xe8a020, css: '#e8a020', tint: 'rgba(232, 160, 32,' }, // orange (future 2v2)
];

/** the running match's mapping — assign BEFORE any unit or HUD is created */
export const teamColors: { player: SideColor; enemy: SideColor } = {
    player: SIDE_COLORS[0]!,
    enemy: SIDE_COLORS[1]!,
};

export function assignTeamColors(side: 'a' | 'b'): void {
    teamColors.player = SIDE_COLORS[side === 'a' ? 0 : 1]!;
    teamColors.enemy = SIDE_COLORS[side === 'a' ? 1 : 0]!;
}

/** the neutral horde (PvPvE mode) — pink, never perspective-swapped */
export const HORDE_COLOR: SideColor = {
    hex: 0xe860b0,
    css: '#e860b0',
    tint: 'rgba(232, 96, 176,',
};

/** side color for any battle team, horde included */
export function colorForBattleTeam(team: 'player' | 'enemy' | 'horde'): SideColor {
    return team === 'horde' ? HORDE_COLOR : teamColors[team];
}

/**
 * Pack veterancy tint on the 3D mesh (level 1 = untinted).
 * 2 blue, 3+ yellow.
 */
export const LEVEL_TINT_COLORS: readonly (number | null)[] = [
    null,
    null, // 1 — natural model colors
    0x1a6ad8, // 2 blue
    0xd4a810, // 3+ yellow
    0xd4a810,
    0xd4a810,
    0xd4a810,
    0xd4a810,
    0xd4a810,
    0xd4a810,
];

/** dye amount for level tint multiply (0 = none, 1 = full color) */
export const LEVEL_TINT_STRENGTH = 0.75;

const _mul = { r: 1, g: 1, b: 1 };

/**
 * Dye material color toward a level hue without washing to pastel.
 * Multiplies the base albedo by lerp(white, tint, strength) — keeps texture,
 * reads as real color instead of sky-blue whitening from color.lerp.
 */
export function applyLevelTintColor(
    mat: { color: Color },
    base: Color,
    tintHex: number,
    strength = LEVEL_TINT_STRENGTH,
): void {
    const t = strength;
    const r = ((tintHex >> 16) & 255) / 255;
    const g = ((tintHex >> 8) & 255) / 255;
    const b = (tintHex & 255) / 255;
    _mul.r = 1 - t + r * t;
    _mul.g = 1 - t + g * t;
    _mul.b = 1 - t + b * t;
    mat.color.copy(base);
    mat.color.r *= _mul.r;
    mat.color.g *= _mul.g;
    mat.color.b *= _mul.b;
}
