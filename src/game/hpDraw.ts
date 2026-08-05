import type { Economy } from './settings';
import { actorTeam, type Actor, type BattleSim } from './sim';
import { hpDrawWaveTier, hpWithdrawOf, type HpDrawWaveTier, type Team } from './units';

/** World origin for an HP-draw soul — living unit feet / hover base. */
function hpDrawOrigin(a: Actor): { x: number; y: number; z: number } {
    // footY is terrain-aware for ground units; altitude for flyers
    const y = a.altitude > 0 ? a.altitude : a.footY;
    return { x: a.rx, y, z: a.rz };
}

export type HpDrawTargetTeam = Team;

export type HpDrawSource = {
    /** Stable sim actor index — deterministic sort key */
    index: number;
    /** World position at battle end */
    x: number;
    y: number;
    z: number;
    /** Side whose HP bar receives this damage */
    victim: HpDrawTargetTeam;
    /** Rounded damage this mech contributes (may be 0 until horde lump applied) */
    damage: number;
    withdraw: number;
    tier: HpDrawWaveTier;
    /** Unit visual key for ghost mesh clones (`modelId` or type id) */
    modelId: string;
    /** World mesh scale of the living unit */
    meshScale: number;
    /** Living unit yaw at battle end — ghost should match */
    yaw: number;
};

export type HpDrawScheduledParticle = HpDrawSource & {
    hitTime: number;
    flightDuration: number;
};

export type HpDrawPlan = {
    sources: HpDrawScheduledParticle[];
    /** Seconds until the last scheduled hit (before global cap) */
    timelineSeconds: number;
    damageToPlayer: number;
    damageToEnemy: number;
    /** Extra horde lump folded into the last player/enemy hits when applicable */
    hordeLumpPlayer: number;
    hordeLumpEnemy: number;
};

const WAVE_ORDER: HpDrawWaveTier[] = ['low', 'medium', 'high'];
const MAX_DRAW_SECONDS = 8;
/**
 * Delay between the *start* of successive waves — waves overlap in flight,
 * so medium/high don't wait for every low particle to finish.
 */
const WAVE_START_STAGGER = 0.28;
/** Floor flight time per wave — high needs room for the climb + homing arc. */
const MIN_FLIGHT_BY_TIER: Record<HpDrawWaveTier, number> = {
    low: 0.28,
    medium: 0.4,
    high: 0.55,
};
/** Guaranteed launch-window once that tier appears. */
const MIN_WAVE_BY_TIER: Record<HpDrawWaveTier, number> = {
    low: 0.35,
    medium: 0.4,
    high: 0.55,
};
/** Cap how long a swarm can stretch its launch stagger (keeps waves overlapping). */
const MAX_LAUNCH_SPAN = 1.1;
const FLIGHT_FRACTION = 0.75;

/**
 * Collect surviving mech damage sources and horde lump metadata using the
 * same rules as {@link Game.applyBattleResult}.
 */
export function buildHpDrawSources(sim: BattleSim, economy: Economy): {
    sources: HpDrawSource[];
    damageToPlayer: number;
    damageToEnemy: number;
    hordeValue: number;
    hordeLumpPlayer: number;
    hordeLumpEnemy: number;
    playerSurvived: boolean;
    enemySurvived: boolean;
} {
    const sources: HpDrawSource[] = [];
    let damageToPlayer = 0;
    let damageToEnemy = 0;
    let playerSurvived = false;
    let enemySurvived = false;
    let hordeValue = 0;

    for (const a of sim.actors) {
        if (a.unit.type.structure || !a.alive) continue;
        const headcount = Math.max(1, a.unit.members.length);
        const value = economy.costOf(a.unit.type) / headcount;
        const team = actorTeam(a);
        const withdraw = hpWithdrawOf(a.unit.type);
        const tier = hpDrawWaveTier(withdraw);
        const { x, y, z } = hpDrawOrigin(a);
        const modelId = a.unit.type.modelId ?? a.unit.type.id;
        const meshScale = a.unit.visualMeshScale();
        const yaw = a.mesh.rotation.y;

        if (team === 'player') {
            damageToEnemy += value;
            playerSurvived = true;
            sources.push({
                index: a.index,
                x,
                y,
                z,
                victim: 'enemy',
                damage: value,
                withdraw,
                tier,
                modelId,
                meshScale,
                yaw,
            });
        } else if (team === 'enemy') {
            damageToPlayer += value;
            enemySurvived = true;
            sources.push({
                index: a.index,
                x,
                y,
                z,
                victim: 'player',
                damage: value,
                withdraw,
                tier,
                modelId,
                meshScale,
                yaw,
            });
        } else {
            hordeValue += value;
        }
    }

    damageToPlayer = Math.round(damageToPlayer);
    damageToEnemy = Math.round(damageToEnemy);
    hordeValue = Math.round(hordeValue);

    const hordeLumpPlayer = !playerSurvived ? hordeValue : 0;
    const hordeLumpEnemy = !enemySurvived ? hordeValue : 0;

    // Horde mechs become visible damage sources when a side is wiped — same
    // lump the deterministic HP math applies, but as fly-to-bar particles.
    if (!playerSurvived || !enemySurvived) {
        for (const a of sim.actors) {
            if (a.unit.type.structure || !a.alive) continue;
            if (actorTeam(a) !== null) continue;
            const headcount = Math.max(1, a.unit.members.length);
            const value = economy.costOf(a.unit.type) / headcount;
            const withdraw = hpWithdrawOf(a.unit.type);
            const tier = hpDrawWaveTier(withdraw);
            const { x, y, z } = hpDrawOrigin(a);
            const modelId = a.unit.type.modelId ?? a.unit.type.id;
            const meshScale = a.unit.visualMeshScale();
            const yaw = a.mesh.rotation.y;
            if (!playerSurvived) {
                sources.push({
                    index: a.index,
                    x,
                    y,
                    z,
                    victim: 'player',
                    damage: value,
                    withdraw,
                    tier,
                    modelId,
                    meshScale,
                    yaw,
                });
            }
            if (!enemySurvived) {
                sources.push({
                    index: a.index * 2 + 1,
                    x,
                    y,
                    z,
                    victim: 'enemy',
                    damage: value,
                    withdraw,
                    tier,
                    modelId,
                    meshScale,
                    yaw,
                });
            }
        }
    }

    return {
        sources,
        damageToPlayer,
        damageToEnemy,
        hordeValue,
        hordeLumpPlayer,
        hordeLumpEnemy,
        playerSurvived,
        enemySurvived,
    };
}

/**
 * Assign hit times in low → medium → high waves.
 *
 * Waves overlap: each tier starts a short stagger after the previous wave
 * *begins*, not after it finishes — so medium/high don't sit idle while a
 * dwarf swarm slowly drains. Leftover time is split evenly across present
 * tiers (not by particle count), and launch stagger is capped.
 */
export function scheduleHpDrawParticles(
    raw: HpDrawSource[],
    meta: {
        damageToPlayer: number;
        damageToEnemy: number;
        hordeLumpPlayer: number;
        hordeLumpEnemy: number;
    },
    opts: {
        maxSeconds?: number;
        waveStartStagger?: number;
    } = {},
): HpDrawPlan {
    const maxSeconds = opts.maxSeconds ?? MAX_DRAW_SECONDS;
    const waveStagger = opts.waveStartStagger ?? WAVE_START_STAGGER;

    const damageToPlayer = meta.damageToPlayer;
    const damageToEnemy = meta.damageToEnemy;
    const hordeLumpPlayer = meta.hordeLumpPlayer;
    const hordeLumpEnemy = meta.hordeLumpEnemy;

    const byTier: Record<HpDrawWaveTier, HpDrawSource[]> = {
        low: [],
        medium: [],
        high: [],
    };
    for (const s of raw) {
        byTier[s.tier].push(s);
    }

    const presentWaves = WAVE_ORDER.filter((w) => byTier[w].length > 0);
    const waveCount = presentWaves.length;
    // Overlapping starts: only the longest wave + staggers need to fit the cap.
    const staggerBudget = waveCount > 1 ? waveStagger * (waveCount - 1) : 0;
    const usable = Math.max(0, maxSeconds - staggerBudget);

    // Even split of leftover so a dwarf swarm doesn't monopolize the timeline.
    const waveDur: number[] = presentWaves.map((tier) => MIN_WAVE_BY_TIER[tier]);
    const floorSum = waveDur.reduce((a, b) => a + b, 0);
    let leftover = Math.max(0, usable - floorSum);
    if (leftover > 0 && waveCount > 0) {
        const each = leftover / waveCount;
        for (let wi = 0; wi < waveDur.length; wi++) waveDur[wi]! += each;
    } else if (floorSum > usable && usable > 0) {
        const scale = usable / floorSum;
        for (let wi = 0; wi < waveDur.length; wi++) waveDur[wi]! *= scale;
    }

    const scheduled: HpDrawScheduledParticle[] = [];
    let waveStart = 0;

    for (let wi = 0; wi < presentWaves.length; wi++) {
        const tier = presentWaves[wi]!;
        const group = byTier[tier].sort((a, b) => a.index - b.index);
        const dur = waveDur[wi]!;
        const flight = Math.max(
            MIN_FLIGHT_BY_TIER[tier],
            Math.min(dur * 0.92, dur * FLIGHT_FRACTION),
        );
        const launchSpan = Math.min(MAX_LAUNCH_SPAN, Math.max(0, dur - flight));

        for (let i = 0; i < group.length; i++) {
            const s = group[i]!;
            const launchOffset =
                group.length <= 1 ? launchSpan * 0.5 : (i / (group.length - 1)) * launchSpan;
            const launchTime = waveStart + launchOffset;
            scheduled.push({
                ...s,
                hitTime: launchTime + flight,
                flightDuration: flight,
            });
        }

        if (wi < presentWaves.length - 1) waveStart += waveStagger;
    }

    const timelineSeconds = scheduled.length > 0 ? Math.max(...scheduled.map((p) => p.hitTime)) : 0;

    normalizeVictimDamages(scheduled, 'player', damageToPlayer);
    normalizeVictimDamages(scheduled, 'enemy', damageToEnemy);

    return {
        sources: scheduled,
        timelineSeconds,
        damageToPlayer,
        damageToEnemy,
        hordeLumpPlayer,
        hordeLumpEnemy,
    };
}

/** Shake intensity from wave tier and damage share. */
export function hpDrawShakeIntensity(tier: HpDrawWaveTier, damage: number): number {
    // low = current baseline; medium 2×; high 4×
    const base = tier === 'low' ? 0.24 : tier === 'medium' ? 0.88 : 3.04;
    const dmgCap = tier === 'low' ? 0.7 : tier === 'medium' ? 1.4 : 2.8;
    const dmgDiv = tier === 'low' ? 600 : tier === 'medium' ? 300 : 150;
    return base + Math.min(dmgCap, damage / dmgDiv);
}

/** Scale per-particle shares so they sum to the rounded team totals. */
function normalizeVictimDamages(
    scheduled: HpDrawScheduledParticle[],
    victim: HpDrawTargetTeam,
    targetTotal: number,
): void {
    if (targetTotal <= 0) return;
    const group = scheduled.filter((p) => p.victim === victim);
    if (group.length === 0) return;
    const raw = group.reduce((sum, p) => sum + p.damage, 0);
    if (raw <= 0) {
        group[0]!.damage = targetTotal;
        return;
    }
    let assigned = 0;
    for (let i = 0; i < group.length; i++) {
        const p = group[i]!;
        if (i === group.length - 1) {
            p.damage = Math.max(0, targetTotal - assigned);
        } else {
            const share = Math.round((p.damage / raw) * targetTotal);
            p.damage = share;
            assigned += share;
        }
    }
}
