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
