/**
 * What the HUD shows of the inventories: my items and tactics (with what is
 * armed), the enemy's as far as the fog of his deployment allows, his forge
 * oven and both sides' round-card picks. Reads the match only.
 */

import { t, tacticDescription, tacticName } from '../i18n';
import type { Phase } from '../ui/hud';
import type { ActionDispatcher } from './actions';
import { SKIP_CARD_REWARD } from './cards';
import type { TypeRegistry } from './content/typeRegistry';
import type { ForgeSlot } from './forgeRecipes';
import type { PlacementController } from './placement';
import { seatIdsOf, type SeatDef, type SeatId } from './seats';
import type { BuildingIntelSnapshot } from './selectionInfo';
import type { GameSettings } from './settings';
import { OIL_SPILL_ID, RALLY_ROUTE_ID, usesSpellPlacement, SELL_UNIT_ID, type OilStamp, type RallyRoute, type SpellStamp } from './tactics';
import type { TutorialRuntime } from './tutorialRuntime';
import type { Team } from './units';

/** the enemy's unequipped items/tactics and his target marks, captured when his deployment is fogged */
export interface EnemyIntelSnapshot {
    items: string[];
    tactics: string[];
    sellAbilityOwned: boolean;
    /** the enemy seats' target marks (setTargetMark) — on my walls, never fogged themselves */
    targetMarks: { unitId: number; seat: SeatId }[];
}

/** what the HUD views read of the match — Game hands it out with live getters */
export interface HudViewsHost {
    readonly phase: Phase;
    readonly round: number;
    readonly placement: PlacementController;
    readonly types: TypeRegistry;
    readonly settings: GameSettings;
    readonly seats: readonly SeatDef[];
    readonly humanSeat: SeatId;
    readonly tutorial: TutorialRuntime | null;
    readonly dispatcher: ActionDispatcher;
    readonly playerCanAct: boolean;
    readonly deployReady: Record<Team, boolean>;
    readonly armedItem: string | null;
    readonly armedItemIndex: number | null;
    readonly armedTactic: string | null;
    readonly armedTacticIndex: number | null;
    readonly itemInventory: string[][];
    readonly tacticInventory: string[][];
    readonly sellState: { owned: boolean[]; used: number[] };
    readonly forgeSlots: Record<Team, (ForgeSlot | null)[]>;
    readonly rallyRoutes: readonly RallyRoute[];
    readonly oilStamps: readonly OilStamp[];
    readonly spellStamps: readonly SpellStamp[];
    readonly enemyIntelSnapshot: EnemyIntelSnapshot | null;
    readonly buildingIntelSnapshot: BuildingIntelSnapshot | null;
    revealEnemyDeployIntel(): boolean;
}

export class HudViews {
    constructor(private readonly host: HudViewsHost) {}

    /** the left-side item strip: one square per item instance, hidden outside build.
     *  Items are per-SEAT — this shows only MY OWN seat's pool, not my ally's.
     *  Same ids are grouped (catalog order), like the spells strip. */
    inventoryView(): {
        id: string;
        icon: string;
        name: string;
        armed: boolean;
        index: number;
    }[] {
        if (!this.host.playerCanAct) return [];
        const bag = this.host.itemInventory[this.host.humanSeat]!;
        return this.sortedItemIndices(bag).map((index) => {
            const id = bag[index]!;
            const item = this.host.types.rune(id);
            return {
                id,
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
                // duplicates share an id: highlight exactly the clicked slot
                armed: this.host.armedItem === id && this.host.armedItemIndex === index,
                index,
            };
        });
    }

    /** stable indices into `bag` grouped by rune catalog order (`pack.jsonc` "runes") */
    private sortedItemIndices(bag: readonly string[]): number[] {
        const order = [...this.host.types.runes.keys()];
        const rank = (id: string) => {
            const i = order.indexOf(id);
            return i < 0 ? order.length : i;
        };
        return bag
            .map((_, index) => index)
            .sort((a, b) => {
                const d = rank(bag[a]!) - rank(bag[b]!);
                return d !== 0 ? d : a - b;
            });
    }

    /** the left-side tactics strip: placed routes/oil + remaining slots */
    tacticsView(): {
        id: string;
        icon: string;
        name: string;
        armed: boolean;
        placed?: boolean;
        routeId?: number;
        /**
         * Corner badge: omit when ready to cast; `'cancel'` while placed/used
         * this deploy; a positive number = rounds until the charge returns.
         */
        badge?: 'cancel' | number;
        hint?: string;
        index: number;
    }[] {
        if (!this.host.playerCanAct) return [];
        const out: {
            id: string;
            icon: string;
            name: string;
            armed: boolean;
            placed?: boolean;
            routeId?: number;
            badge?: 'cancel' | number;
            hint?: string;
            index: number;
        }[] = [];
        let slot = 0;

        // where each 'placement' tactic keeps its resettable placements —
        // MY OWN seat's, not an ally's (tactics are per-seat now)
        const placementsOf: Record<string, () => readonly { id: number }[]> = {
            [RALLY_ROUTE_ID]: () => this.host.rallyRoutes.filter((r) => r.seat === this.host.humanSeat),
            [OIL_SPILL_ID]: () => this.host.oilStamps.filter((s) => s.seat === this.host.humanSeat),
        };
        // per-round ability charges layered on top of the inventory (sell only)
        const abilityChargesOf = (tacticId: string): { max: number; used: number } => {
            if (tacticId !== SELL_UNIT_ID || !this.host.sellState.owned[this.host.humanSeat]) {
                return { max: 0, used: 0 };
            }
            const max = this.host.settings.sell.maxPerRound;
            return { max, used: Math.min(this.host.sellState.used[this.host.humanSeat]!, max) };
        };

        for (const tactic of this.host.types.tactics) {
            if (this.host.tutorial?.hidesTacticCharge(tactic.id)) continue;
            const inventory = this.host.tacticInventory[this.host.humanSeat]!.filter(
                (id) => id === tactic.id,
            ).length;
            const ability = abilityChargesOf(tactic.id);
            // greyed and available entries are counted from separate sources,
            // so using a charge turns an entry grey instead of removing it
            let placedEntries: { routeId?: number; hint?: string; badge?: 'cancel' | number }[];
            let avail: number;
            if (tactic.kind === 'placement') {
                // charge stays in the inventory; placements are right-click resettable
                const placements = usesSpellPlacement(tactic)
                    ? this.host.spellStamps.filter(
                          (s) =>
                              s.seat === this.host.humanSeat &&
                              s.tacticId === tactic.id &&
                              s.placedRound === this.host.round,
                      )
                    : (placementsOf[tactic.id]?.() ?? []);
                // spells: past stamps cool the charge. oil: stamps wipe each round,
                // so past uses come from the action log (same as one-shot).
                const coolingStamps = usesSpellPlacement(tactic)
                    ? this.host.spellStamps.filter(
                          (s) =>
                              s.seat === this.host.humanSeat &&
                              s.tacticId === tactic.id &&
                              s.placedRound < this.host.round &&
                              s.placedRound >= this.host.round - tactic.cooldownRounds,
                      )
                    : [];
                const oilUseRounds =
                    tactic.id === OIL_SPILL_ID
                        ? this.host.dispatcher
                              .tacticUseRounds(
                                  this.host.humanSeat,
                                  OIL_SPILL_ID,
                                  this.host.round - tactic.cooldownRounds,
                              )
                              .filter((r) => r < this.host.round)
                        : [];
                placedEntries = [
                    ...placements.map((p) => ({
                        routeId: p.id,
                        badge: 'cancel' as const,
                    })),
                    ...coolingStamps.map((s) => {
                        const readyIn = s.placedRound + tactic.cooldownRounds + 1 - this.host.round;
                        const name = tacticName(tactic.id, tactic.name);
                        return {
                            badge: readyIn,
                            hint: t('hud:tacticCoolingDown', {
                                name,
                                ready: t('hud:tacticReadyAgain', { n: readyIn }),
                            }),
                        };
                    }),
                    ...oilUseRounds.map((r) => {
                        const readyIn = r + tactic.cooldownRounds + 1 - this.host.round;
                        const name = tacticName(tactic.id, tactic.name);
                        return {
                            badge: readyIn,
                            hint: t('hud:tacticCoolingDown', {
                                name,
                                ready: t('hud:tacticReadyAgain', { n: readyIn }),
                            }),
                        };
                    }),
                ];
                // oil: this-round spend is on the stamp (cancel) AND the log —
                // count inventory against log uses so we don't double-subtract
                const blocked =
                    tactic.id === OIL_SPILL_ID
                        ? this.host.dispatcher.tacticUseRounds(
                              this.host.humanSeat,
                              OIL_SPILL_ID,
                              this.host.round - tactic.cooldownRounds,
                          ).length
                        : placements.length + coolingStamps.length;
                avail = inventory + ability.max - ability.used - blocked;
            } else {
                // one-shot: the charge stays in the inventory but cools down
                // after use — both derived from the action log (undo restores)
                const useRounds = this.host.dispatcher.tacticUseRounds(
                    this.host.humanSeat,
                    tactic.id,
                    this.host.round - tactic.cooldownRounds,
                );
                const coolingHint = (usedRound: number, readyIn: number): string => {
                    const name = tacticName(tactic.id, tactic.name);
                    const ready = t('hud:tacticReadyAgain', { n: readyIn });
                    return usedRound === this.host.round
                        ? t('hud:tacticUsedThisRound', { name, ready })
                        : t('hud:tacticCoolingDown', { name, ready });
                };
                // A spent one-shot has NO per-entry revert: its effect is already
                // applied to a pack, and only the global undo can take it back.
                // So it never shows the cancel badge — that badge is reserved for
                // entries carrying a routeId, i.e. a placement this strip can
                // actually clear. See the generic rule in `badge` above.
                placedEntries = [
                    ...Array.from({ length: ability.used }, () => ({
                        badge: 1,
                        hint: t('hud:tacticUsedThisRound', {
                            name: tacticName(tactic.id, tactic.name),
                            ready: t('hud:tacticReadyAgainNext'),
                        }),
                    })),
                    ...useRounds.map((r) => {
                        const readyIn = r + tactic.cooldownRounds + 1 - this.host.round;
                        return { badge: readyIn, hint: coolingHint(r, readyIn) };
                    }),
                ];
                avail = ability.max - ability.used + Math.max(0, inventory - useRounds.length);
            }
            for (const p of placedEntries) {
                const name = tacticName(tactic.id, tactic.name);
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name:
                        tactic.kind === 'placement'
                            ? t('hud:tacticPlaced', { name })
                            : t('hud:tacticUsedLabel', { name }),
                    armed: false,
                    placed: true,
                    index: slot,
                    ...p,
                });
                slot++;
            }
            for (let i = 0; i < avail; i++) {
                // duplicates share an id: this is exactly the clicked slot
                const armed = this.host.armedTactic === tactic.id && this.host.armedTacticIndex === slot;
                if (armed) {
                    // picked up: the charge is on the cursor, not in the strip.
                    // `slot` still advances so every other entry keeps its index
                    // (armedTacticIndex is a slot number), and cancelling puts it
                    // straight back.
                    slot++;
                    continue;
                }
                const desc = tacticDescription(tactic.id, tactic.description);
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: `${tacticName(tactic.id, tactic.name)} — ${desc}`,
                    armed: false,
                    index: slot,
                    // one-shots aren't "placed on the map" — override the default hint
                    hint: tactic.kind === 'oneShot' ? `${desc}\n${t('hud:rightClickCancel')}` : undefined,
                });
                slot++;
            }
        }

        return out;
    }

    /** merged item pool across every seat on a side — for READ-ONLY display
     *  only (intel/HUD). Consumption always targets one seat's own array
     *  (see actions.ts applyItem) — this never feeds back into gameplay. */
    itemsForTeam(team: Team): string[] {
        return seatIdsOf(this.host.seats, team).flatMap((seat) => this.host.itemInventory[seat]!);
    }

    /** true if ANY seat on the side owns the sell ability — read-only display merge, same idea as {@link itemsForTeam} */
    sellAbilityOwnedForTeam(team: Team): boolean {
        return seatIdsOf(this.host.seats, team).some((seat) => this.host.sellState.owned[seat]);
    }

    /** merged tactic-charge pool across every seat on a side — read-only
     *  display only, same idea as {@link itemsForTeam} */
    tacticsForTeam(team: Team): string[] {
        return seatIdsOf(this.host.seats, team).flatMap((seat) => this.host.tacticInventory[seat]!);
    }

    enemyInventoryView(): {
        items: { id: string; icon: string; name: string }[];
        tactics: { id: string; icon: string; name: string; badge?: number; hint?: string }[];
        sellAbility: boolean;
    } {
        if (this.host.phase !== 'build') {
            return { items: [], tactics: [], sellAbility: false };
        }
        const live = this.host.revealEnemyDeployIntel();
        const items = live ? this.itemsForTeam('enemy') : (this.host.enemyIntelSnapshot?.items ?? []);
        const tacticIds = live
            ? this.tacticsForTeam('enemy')
            : (this.host.enemyIntelSnapshot?.tactics ?? []);
        const sellAbility = live
            ? this.sellAbilityOwnedForTeam('enemy')
            : (this.host.enemyIntelSnapshot?.sellAbilityOwned ?? false);
        const mapItem = (id: string) => {
            const item = this.host.types.rune(id);
            return {
                id,
                icon: item?.icon ?? '?',
                name: item ? `${item.name} — ${item.description}` : id,
            };
        };
        return {
            items: this.sortedItemIndices(items).map((i) => mapItem(items[i]!)),
            tactics: this.enemyTacticsStripView(tacticIds, live),
            sellAbility,
        };
    }

    /**
     * Enemy right-strip charges: bag ids plus cooling badges (past-round CDs
     * always; this-round spends only after deploy intel reveals).
     */
    private enemyTacticsStripView(
        tacticIds: readonly string[],
        revealThisRound: boolean,
    ): { id: string; icon: string; name: string; badge?: number; hint?: string }[] {
        const enemySeats = seatIdsOf(this.host.seats, 'enemy');
        const out: { id: string; icon: string; name: string; badge?: number; hint?: string }[] = [];
        for (const tactic of this.host.types.tactics) {
            const inventory = tacticIds.filter((id) => id === tactic.id).length;
            if (inventory < 1) continue;
            const cooling: { badge: number; hint: string }[] = [];
            if (usesSpellPlacement(tactic)) {
                for (const s of this.host.spellStamps) {
                    if (!enemySeats.includes(s.seat) || s.tacticId !== tactic.id) continue;
                    if (s.placedRound > this.host.round) continue;
                    if (s.placedRound === this.host.round && !revealThisRound) continue;
                    if (s.placedRound < this.host.round - tactic.cooldownRounds) continue;
                    const readyIn = s.placedRound + tactic.cooldownRounds + 1 - this.host.round;
                    const name = tacticName(tactic.id, tactic.name);
                    const ready = t('hud:tacticReadyAgain', { n: readyIn });
                    cooling.push({
                        badge: readyIn,
                        hint:
                            s.placedRound === this.host.round
                                ? t('hud:tacticUsedThisRound', { name, ready })
                                : t('hud:tacticCoolingDown', { name, ready }),
                    });
                }
            } else if (tactic.id === OIL_SPILL_ID) {
                // oil stamps wipe each round — CD lives on the action log
                for (const seat of enemySeats) {
                    for (const r of this.host.dispatcher
                        .tacticUseRounds(seat, OIL_SPILL_ID, this.host.round - tactic.cooldownRounds)
                        .filter((round) => round < this.host.round || revealThisRound)) {
                        const readyIn = r + tactic.cooldownRounds + 1 - this.host.round;
                        const name = tacticName(tactic.id, tactic.name);
                        const ready = t('hud:tacticReadyAgain', { n: readyIn });
                        cooling.push({
                            badge: readyIn,
                            hint:
                                r === this.host.round
                                    ? t('hud:tacticUsedThisRound', { name, ready })
                                    : t('hud:tacticCoolingDown', { name, ready }),
                        });
                    }
                }
            } else {
                for (const seat of enemySeats) {
                    for (const r of this.host.dispatcher.tacticUseRounds(
                        seat,
                        tactic.id,
                        this.host.round - tactic.cooldownRounds,
                    )) {
                        if (r >= this.host.round && !revealThisRound) continue;
                        const readyIn = r + tactic.cooldownRounds + 1 - this.host.round;
                        const name = tacticName(tactic.id, tactic.name);
                        const ready = t('hud:tacticReadyAgain', { n: readyIn });
                        cooling.push({
                            badge: readyIn,
                            hint:
                                r === this.host.round
                                    ? t('hud:tacticUsedThisRound', { name, ready })
                                    : t('hud:tacticCoolingDown', { name, ready }),
                        });
                    }
                }
            }
            const readyCount = Math.max(0, inventory - cooling.length);
            for (let i = 0; i < readyCount; i++) {
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: tactic.name,
                });
            }
            for (const c of cooling) {
                out.push({
                    id: tactic.id,
                    icon: tactic.icon,
                    name: tactic.name,
                    badge: c.badge,
                    hint: c.hint,
                });
            }
        }
        return out;
    }

    /** enemy forge tray ids visible to the local player (live or intel) */
    enemyForgeOvenView(): string[] {
        if (this.host.phase !== 'build') return [];
        if (this.host.revealEnemyDeployIntel()) {
            return (this.host.forgeSlots.enemy ?? [])
                .filter((s): s is ForgeSlot => !!s)
                .map((s) => s.itemId);
        }
        const snap = this.host.buildingIntelSnapshot?.forge.enemy ?? [];
        return snap.filter((id): id is string => !!id);
    }

    /** round-card history for the commander detail popup */
    roundCardPicksView(team: Team): { round: number; title: string; body: string }[] {
        return this.host.dispatcher.roundCardPicks(team).map((p) => {
            if (p.cardId === null) {
                return {
                    round: p.round,
                    title: 'Skipped',
                    body: `+${SKIP_CARD_REWARD} supply`,
                };
            }
            const card = this.host.types.roundCard(p.cardId);
            return {
                round: p.round,
                title: card?.title ?? p.cardId,
                body: card
                    ? (card.unitsLabel ? `${card.unitsLabel} — ` : '') + card.description
                    : '',
            };
        });
    }

    /**
     * True when the opponent's purchases are visible: after we lock in, or in
     * battle — same fog as spells / inventory / Command Tower tiles.
     */
    enemyActionIntelVisible(): boolean {
        // live board (fog off / battle / after we lock in) — same window as
        // when enemy packs are selectable with full details
        return (
            this.host.phase === 'battle' ||
            this.host.deployReady.player ||
            !this.host.placement.intelFogOn
        );
    }
}
