/**
 * The match's side of the Learner's plan simulation (aiThink): dry runs on
 * the live board and the board as a battle for the worker. Kept out of Game,
 * which only hands over what it reads ({@link AiThinkMatchDeps}) and makes
 * one of these when a seat plays the Learner.
 */

import { t } from '../i18n';
import type { ActionDispatcher, TacticIdSource } from './actions';
import { thinkUnitOf, type AiThinkHost, type Board } from './aiThink';
import type { TypeRegistry } from './content/typeRegistry';
import type { BattleMap } from './map';
import type { PlacementController } from './placement';
import type { SeatDef, SeatId } from './seats';
import type { Economy, LevelingSettings, TowerSettings } from './settings';
import type { ResolvedStats, TechTree } from './tech';
import type { Loadout } from './techCatalog';
import type { Unit } from './units';

/** what the plan simulation reads of the match (Game hands it over) */
export interface AiThinkMatchDeps {
    placement: PlacementController;
    dispatcher: ActionDispatcher;
    types: TypeRegistry;
    techTree: TechTree;
    economy: Economy;
    map: BattleMap;
    settings: { towers: TowerSettings; leveling: LevelingSettings; deploy: { flankSpawnSeconds?: number }; strongholdMode: string };
    seats: () => readonly SeatDef[];
    seatReady: () => readonly boolean[];
    flankSpawnMult: () => readonly number[];
    /** the per-seat counters behind spell, rally-route and oil ids — a dry run puts them back */
    tacticIds: readonly TacticIdSource[];
    round: () => number;
    /** the build phase, the match on */
    building: () => boolean;
    /** deploy clock seconds left (Infinity: none) */
    deployLeft: () => number;
    /** the seats a local AI drives */
    localAiSeats: () => ReadonlySet<SeatId>;
    refreshFlightAlts: () => void;
    resolvedStats: (u: Unit) => ResolvedStats;
    loadoutOf: (seat: SeatId) => Loadout | undefined;
    seatRank: (seat: SeatId) => number;
    battleSeconds: () => number;
    /** a chat line from `seat` (shown here, sent to the others) */
    chat: (seat: SeatId, text: string) => void;
}

export class AiThinkMatch {
    /** the ids on the board when this round's thinking began — what an AI may know of */
    private known: { round: number; ids: Set<number> } | null = null;

    constructor(private readonly m: AiThinkMatchDeps) {}

    /** the host one AI seat's thinking talks to */
    hostFor(seat: SeatId): AiThinkHost {
        const m = this.m;
        return {
            begin: () => {
                if (this.known?.round === m.round()) return;
                this.known = { round: m.round(), ids: new Set(m.placement.allUnits().map((u) => u.id)) };
            },
            dispatchDry: (action) => m.dispatcher.dispatch(action),
            dryRun: (aiSeat, team, fn) => this.dryRun(aiSeat, team, fn),
            board: () => this.board(),
            humansReady: () => {
                const ai = m.localAiSeats();
                const ready = m.seatReady();
                return m.seats().every((_, s) => ai.has(s) || !!ready[s]);
            },
            deployLeft: () => m.deployLeft(),
            active: (round) => m.building() && m.round() === round,
            say: (kind, count) =>
                m.chat(
                    seat,
                    kind === 'progress'
                        ? t('hud:aiThinkProgress', { count, defaultValue: 'Testing plans… ({{count}})' })
                        : t('hud:aiThinkDone', { count, defaultValue: 'Plans tested: {{count}}. Ready!' }),
                ),
        };
    }

    /**
     * `fn` as a dry run for `aiSeat`: the other side's packs placed since the
     * phase began out of sight, and afterwards everything the seat logged
     * undone and the id counters put back. False when the board didn't come
     * back as it was.
     */
    private dryRun(aiSeat: SeatId, team: Unit['team'], fn: () => void): boolean {
        const { placement, dispatcher } = this.m;
        const round = this.m.round();
        const known = this.known?.round === round ? this.known.ids : null;
        const hide = (u: Unit) => !!known && u.seat !== aiSeat && u.team !== team && !known.has(u.id);
        const ids = placement.idCounters();
        const tacticIds = this.m.tacticIds.map((src) => [...src.bySeat]);
        const mark = dispatcher.length;
        let ok = true;
        placement.dryRun = true;
        try {
            placement.withHiddenUnits(hide, () => {
                try {
                    fn();
                } finally {
                    for (let guard = 0; dispatcher.length > mark && guard < 1000; guard++) {
                        if (!dispatcher.undoLast(round, aiSeat)) {
                            console.error('[aiThink] dry run: could not undo back to the mark', { mark, length: dispatcher.length });
                            ok = false;
                            break;
                        }
                    }
                }
            });
            if (placement.dryRunLeaked) ok = false;
        } catch (err) {
            console.error('[aiThink] dry run threw', err);
            ok = false;
        } finally {
            placement.dryRun = false;
            placement.restoreIdCounters(ids);
            this.m.tacticIds.forEach((src, i) => {
                src.bySeat.length = 0;
                src.bySeat.push(...tacticIds[i]!);
            });
            this.m.refreshFlightAlts();
        }
        return ok;
    }

    /** the board as it stands, as a battle for the plan worker */
    private board(): Board {
        const m = this.m;
        m.refreshFlightAlts();
        const units = m.placement
            .allUnits()
            .filter((u) => u.team !== 'horde' && !u.summoned && !u.productionHeld && !u.consumed)
            .map((u) => thinkUnitOf(u, m.resolvedStats(u), !u.flankSpawnDone && !u.type.structure && !u.type.extra && m.placement.isOnFlank(u)));
        const seats = m.seats();
        const all = [...m.types.all()];
        const techs: Record<string, string[]> = {};
        seats.forEach((_, s) => {
            for (const type of all) {
                const owned = m.techTree.ownedFor(s, type.id);
                if (owned.size > 0) techs[`${s}:${type.id}`] = [...owned];
            }
        });
        const costs: Record<string, number> = {};
        for (const type of all) costs[type.id] = m.economy.costOf(type);
        const terrain = m.map.terrain;
        return {
            units,
            techs,
            loadouts: seats.map((_, s) => m.loadoutOf(s)),
            seatRanks: seats.map((_, s) => m.seatRank(s)),
            costs,
            flankMult: [...m.flankSpawnMult()],
            flankSpawnSeconds: m.settings.deploy.flankSpawnSeconds ?? 5,
            towers: structuredClone(m.settings.towers),
            leveling: structuredClone(m.settings.leveling),
            battleSeconds: m.battleSeconds(),
            boardHalfW: m.map.halfW,
            boardHalfZ: m.map.halfH,
            strongholdLifeline: m.settings.strongholdMode === 'lifeline',
            terrain: terrain
                ? { cols: (terrain.nx - 1) / 2, rows: (terrain.nz - 1) / 2, halfW: terrain.halfW, halfH: terrain.halfH, heights: terrain.heights.slice() }
                : null,
        };
    }
}
