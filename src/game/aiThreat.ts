/**
 * What an AI seat reads about the enemy before it builds (AI_PLAN.md, "Threat
 * map"): where the enemy's army value stands across its front, how far
 * forward, which posture that is — and how the towers did in the last battle.
 * Reading only: nothing here changes the match.
 */
import { sideFrontline } from './aiWalls';
import type { PlacementController } from './placement';
import type { SeatId } from './seats';
import type { BattleSim } from './sim';
import type { Team, Unit } from './units';
import { CELL } from './map';

/** the seat's own base towers: what a sector is named after */
export type TowerKind = 'research' | 'command';

export interface Sector {
    kind: 'flank' | 'tower' | 'centre';
    /** the seat's own tower this sector holds (tower sectors) or lies beside (flanks); null for the centre */
    tower: TowerKind | null;
    /** the column the sector is centred on */
    col: number;
    /** the enemy's army value in it: cost × level, summed */
    value: number;
    /** value-weighted tiles behind their own zone's front edge (0 = right at it, below 0 = out in the neutral strip) */
    depth: number;
}

/**
 * a) home: the enemy stands back; b/c) tower: one tower sector holds most of
 * it; d) flank: a flank sector holds a big part; e) mixed: spread out,
 * maybe with a small flank poke. none: nothing to read.
 */
export type Posture = 'none' | 'home' | 'tower' | 'flank' | 'mixed';

export interface ThreatMap {
    /** flank, tower, centre, tower, flank — by column, ascending */
    sectors: Sector[];
    total: number;
    /** value-weighted depth of the whole enemy army */
    depth: number;
    /** share of the value on each side of the seat's front (flank + tower sector there), by column: lower, higher */
    sides: [number, number];
    posture: Posture;
    /** the sector the posture points at (tower / flank), else null */
    focus: number | null;
    /** a small flank poke beside the main posture (a sector index), else null */
    poke: number | null;
}

/** value-weighted depth from which the enemy counts as standing at home */
const HOME_DEPTH = 12;
/** share of the value in one tower sector that makes it a tower push */
const TOWER_SHARE = 0.5;
/** share of the value in one flank sector that makes it a flank attack */
const FLANK_SHARE = 0.35;
/** a flank sector with at most this share (and something in it) is a poke */
const POKE_SHARE = 0.15;
/** enemies this many tiles beyond the seat's lane don't threaten it (the other lane in 2v2) */
const LANE_MARGIN = 6;

/** the seat's columns: the side's zone, or its lane of it in duo modes */
function laneCols(placement: PlacementController, team: Team, seat: SeatId): { min: number; max: number } {
    const { colMin, colMax } = sideFrontline(placement, team);
    const lane = placement.laneOf(seat);
    const mid = Math.floor(placement.map.cols / 2);
    if (lane === 'left') return { min: colMin, max: mid - 1 };
    if (lane === 'right') return { min: mid, max: colMax };
    return { min: colMin, max: colMax };
}

/** the seat's own research centre and command tower, by column */
function ownTowers(placement: PlacementController, seat: SeatId): { kind: TowerKind; col: number }[] {
    return placement
        .allUnits()
        .filter((u) => u.seat === seat && !u.destroyed && (u.type.baseAnchor === 'research' || u.type.baseAnchor === 'command'))
        .map((u) => ({ kind: u.type.baseAnchor as TowerKind, col: u.cell.col + u.type.footprint.cols / 2 }))
        .sort((a, b) => a.col - b.col);
}

/**
 * Tiles between a unit and its own zone's front edge — the zone's, not the
 * deploy front's: an unlocked neutral strip moves that forward, and a pack
 * at the very front would suddenly read as standing back. Below 0 = out in
 * the neutral strip.
 */
function depthOf(placement: PlacementController, u: Unit): number {
    const { forward } = sideFrontline(placement, u.team === 'player' ? 'player' : 'enemy');
    const map = placement.map;
    const rim = map.size.rimCells;
    const zoneFront = forward > 0 ? rim + map.size.zoneRows - 1 : map.rows - rim - map.size.zoneRows;
    const rows = u.rotated ? u.type.footprint.cols : u.type.footprint.rows;
    const centerRow = u.gridless ? u.cell.row : u.cell.row + rows / 2;
    return (zoneFront + 0.5 - centerRow) * forward;
}

/** the enemy as seat `seat` of `team` sees it right now */
export function readThreat(placement: PlacementController, team: Team, seat: SeatId): ThreatMap {
    const lane = laneCols(placement, team, seat);
    const towers = ownTowers(placement, seat);
    const [a, b] = towers.length >= 2 ? [towers[0]!, towers[towers.length - 1]!] : [null, null];
    const towerA = a?.col ?? lane.min + (lane.max - lane.min) * 0.25;
    const towerB = b?.col ?? lane.min + (lane.max - lane.min) * 0.75;
    const sectors: Sector[] = [
        { kind: 'flank', tower: a?.kind ?? null, col: lane.min, value: 0, depth: 0 },
        { kind: 'tower', tower: a?.kind ?? null, col: towerA, value: 0, depth: 0 },
        { kind: 'centre', tower: null, col: (towerA + towerB) / 2, value: 0, depth: 0 },
        { kind: 'tower', tower: b?.kind ?? null, col: towerB, value: 0, depth: 0 },
        { kind: 'flank', tower: b?.kind ?? null, col: lane.max, value: 0, depth: 0 },
    ];

    let total = 0;
    let depthSum = 0;
    const map = placement.map;
    for (const u of placement.allUnits()) {
        if (u.team === team || u.team === 'horde' || u.destroyed || u.summoned || u.type.structure || u.type.extra) continue;
        const col = (u.world.x + map.halfW) / CELL;
        if (col < lane.min - LANE_MARGIN || col > lane.max + LANE_MARGIN) continue;
        const value = u.type.cost * Math.max(1, u.level);
        const depth = depthOf(placement, u);
        let best = 0;
        for (let i = 1; i < sectors.length; i++) if (Math.abs(sectors[i]!.col - col) < Math.abs(sectors[best]!.col - col)) best = i;
        const s = sectors[best]!;
        s.depth = (s.depth * s.value + depth * value) / (s.value + value);
        s.value += value;
        total += value;
        depthSum += depth * value;
    }

    const depth = total > 0 ? depthSum / total : 0;
    const share = (i: number) => (total > 0 ? sectors[i]!.value / total : 0);
    const strongest = (kind: Sector['kind']) => {
        let best: number | null = null;
        sectors.forEach((s, i) => {
            if (s.kind === kind && (best === null || s.value > sectors[best]!.value)) best = i;
        });
        return best;
    };
    let posture: Posture = 'mixed';
    let focus: number | null = null;
    const tower = strongest('tower');
    const flank = strongest('flank');
    if (total === 0) posture = 'none';
    else if (depth >= HOME_DEPTH) posture = 'home';
    else if (tower !== null && share(tower) >= TOWER_SHARE) {
        posture = 'tower';
        focus = tower;
    } else if (flank !== null && share(flank) >= FLANK_SHARE) {
        posture = 'flank';
        focus = flank;
    }
    // a small flank poke beside it: the bigger of the flanks that hold a little
    let poke: number | null = null;
    sectors.forEach((s, i) => {
        if (s.kind !== 'flank' || i === focus || share(i) <= 0 || share(i) > POKE_SHARE) return;
        if (poke === null || s.value > sectors[poke]!.value) poke = i;
    });
    const sides: [number, number] = [share(0) + share(1), share(3) + share(4)];
    return { sectors, total, depth, sides, posture, focus, poke };
}

/** how one base tower did in a battle */
export interface TowerRecord {
    seat: SeatId;
    team: Team;
    kind: TowerKind;
    /** seconds into the battle it fell, or null if it stood */
    fellAt: number | null;
    /** what was left of its HP at the end, 0…1 */
    hpLeft: number;
}

/** the towers of the last battle (AI_PLAN.md, "Last battle") */
export interface BattleRecord {
    round: number;
    /** how long the battle ran, seconds */
    duration: number;
    towers: TowerRecord[];
}

/** read from a finished battle — the same on every peer and in a resumed match (battles replay) */
export function recordBattle(sim: BattleSim, round: number): BattleRecord {
    const towers: TowerRecord[] = [];
    for (const a of sim.actors) {
        const kind = a.unit.type.baseAnchor;
        if (kind !== 'research' && kind !== 'command') continue;
        if (a.unit.team === 'horde') continue;
        towers.push({
            seat: a.unit.seat,
            team: a.unit.team,
            kind,
            fellAt: a.alive ? null : (sim.towerFellAt.get(a.unit.id) ?? sim.elapsed),
            hpLeft: a.alive ? Math.max(0, Math.min(1, a.hp / Math.max(1, a.maxHp))) : 0,
        });
    }
    return { round, duration: sim.elapsed, towers };
}

/** the threat map and the last battle as lines for the debug overlay */
export function threatLines(name: string, threat: ThreatMap, last: BattleRecord | null, team: Team, seat: SeatId): string[] {
    const label = (s: Sector) =>
        s.kind === 'centre' ? 'centre' : `${s.kind === 'flank' ? 'flank' : 'tower'} ${s.tower === 'research' ? 'RC' : s.tower === 'command' ? 'CT' : '?'}`;
    const posture =
        threat.posture === 'tower' || threat.posture === 'flank'
            ? `${threat.posture} → ${label(threat.sectors[threat.focus!]!)}`
            : threat.posture;
    const side = (i: 0 | 1) => {
        const tower = threat.sectors[i === 0 ? 1 : 3]!.tower;
        return `${tower === 'research' ? 'RC' : tower === 'command' ? 'CT' : '?'} side ${Math.round(threat.sides[i] * 100)}%`;
    };
    const out = [
        `${name}: enemy ${Math.round(threat.total)} at depth ${threat.depth.toFixed(1)} — ${posture}${threat.poke !== null ? `, poke ${label(threat.sectors[threat.poke]!)}` : ''} (${side(0)}, ${side(1)})`,
        '  ' + threat.sectors.map((s) => `${label(s)} ${Math.round(s.value)}${s.value > 0 ? `@${s.depth.toFixed(0)}` : ''}`).join(' | '),
    ];
    if (last) {
        const fate = (t: TowerRecord) => `${t.kind === 'research' ? 'RC' : 'CT'} ${t.fellAt !== null ? `fell ${t.fellAt.toFixed(0)}s` : `${Math.round(t.hpLeft * 100)}%`}`;
        const mine = last.towers.filter((t) => t.seat === seat).map(fate);
        const theirs = last.towers.filter((t) => t.team !== team).map(fate);
        out.push(`  round ${last.round} (${last.duration.toFixed(0)}s): own ${mine.join(', ') || '—'} · theirs ${theirs.join(', ') || '—'}`);
    }
    return out;
}
