import type { Action } from './actions';
import type { Opponent } from './ai';
import type { BattleMap } from './map';
import type { PlacementController } from './placement';
import type { SeatDef, SeatId } from './seats';
import type { Economy, GameSettings } from './settings';
import type { TechTree } from './tech';
import type { OilStamp, SpellStamp } from './tactics';
import type { Hud, SelectionInfo } from '../ui/hud';
import type { Tutorial2BoardState } from '../ui/tutorialGuide2';
import type { Tutorial3BoardState, Tutorial3Highlight } from '../ui/tutorialGuide3';
import type { TutorialCameraSnap, TutorialSlotMask } from '../ui/tutorialGuide';
import { primarySeatOf } from './seats';
import { t } from '../i18n';
import { TutorialGuide } from '../ui/tutorialGuide';
import { TutorialGuide2 } from '../ui/tutorialGuide2';
import { TutorialGuide3 } from '../ui/tutorialGuide3';
import { TUTORIAL_2_START_CARD, TUTORIAL_3_START_CARD, TUTORIAL_START_CARD } from './cards';
import { BASE_ANCHORS } from './map';
import { DRAGON_ID, OIL_SPILL_ID, SPAWN_DWARVES_ID } from './tactics';
import {
    COMMAND_TOWER,
    STRONGHOLD_ARCHER,
    STRONGHOLD_ARCHER_SLOTS,
    RESEARCH_CENTER,
    STRONGHOLD,
    unitTypeById,
    type Team,
    type Unit,
    type UnitType,
} from './units';
import {
    cellEq,
    pointNear,
    stampMatchesCorridor,
    stampMatchesPoint,
    tutorial1PlaceSlots,
    tutorial2DragonCorridor,
    tutorial2OilCorridor,
    tutorial2SummonNearKeep,
    tutorial3BallistaSlot,
    tutorial3CenterArcherCells,
    tutorial3CenterDwarfCell,
    tutorial3DwarfSlot,
    tutorial3MirroredArmy,
    tutorialBallistaFootprint,
    tutorialBaseCell,
    tutorialDwarfFootprint,
    tutorialId,
    unitMatchesTutorialSlot,
    zoneClickTol,
    TUTORIAL_1_ID,
    TUTORIAL_2_ID,
    TUTORIAL_2_ROUNDS,
    TUTORIAL_2_STRONGHOLD_ROW_FRAC,
    TUTORIAL_3_ARCHER_RANGE_TECH,
    TUTORIAL_3_ID,
    TUTORIAL_3_MIN_RUNES,
    TUTORIAL_3_R4_ARCHERS,
    TUTORIAL_3_ROUNDS,
    type TutorialPlaceSlot,
    type TutorialWorldZone,
} from './tutorial';

/**
 * The slice of {@link Game} the tutorial lessons are allowed to touch. Kept
 * deliberately narrow: everything here is either match state the lessons read
 * to decide which step the player is on, or a seam they drive to stage a round.
 */
export interface TutorialHost {
    readonly settings: GameSettings;
    readonly map: BattleMap;
    readonly placement: PlacementController;
    readonly economy: Economy;
    readonly techTree: TechTree;
    readonly hud: Hud;
    /** mutable: Tutorial 3 replaces the human seat entry to force Longbow */
    readonly seats: SeatDef[];
    readonly humanSeat: SeatId;
    readonly opponent: Opponent;
    readonly round: number;
    readonly hydrating: boolean;
    readonly watching: boolean;
    readonly introActive: boolean;
    readonly starterPicked: boolean[];
    readonly unlockUsedThisRound: boolean[];
    readonly unlockedUnits: string[][];
    readonly deployState: { limit: number[]; runesBought: number[] };
    readonly boostState: Record<'attack' | 'hp', number[]>;
    readonly tacticInventory: string[][];
    readonly forgeSpellOwned: string[][];
    readonly oilStamps: OilStamp[];
    readonly spellStamps: SpellStamp[];
    readonly armedTactic: string | null;
    readonly tacticDraftStart: { x: number; z: number } | null;
    /** live camera pose for Tutorial 1's pan / orbit / zoom lesson */
    cameraSnap(): TutorialCameraSnap;
    dispatchPlayer(action: Action): boolean;
    afterStarterPick(): void;
    refreshShopHud(): void;
    updateSelectionUi(): void;
    unitInfo(unit: Unit): SelectionInfo;
    strongholdArcherCount(team: Team): number;
    /** the seat's commander card spells, before this lesson's round filter */
    starterForgeSpellsOf(seat: SeatId): readonly string[] | undefined;
    cancelTacticPlacement(): boolean;
    /** multi-round modes: reset both sides to a fixed sudden-death HP */
    restoreSideHp(hp: number): void;
}

/** What a finished multi-round tutorial battle means for the match. */
export type TutorialRoundResult = 'continue' | 'roundWon' | 'victory' | 'defeat';

/**
 * Everything the three tutorial lessons need on top of a normal match: the
 * soft-hint overlays, the forced pads / spell corridors, the per-round board
 * staging and the shop / End Deployment gates that keep a lesson on rails.
 *
 * One instance lives for the whole match (created only when
 * `settings.tutorial` is set); {@link Game} keeps thin `this.tutorial?.…`
 * seams and holds no lesson state of its own.
 */
export class TutorialRuntime {
    private readonly host: TutorialHost;
    private readonly lesson: number | null;
    /** Soft-hint overlay for Tutorial 1; null outside that lesson. */
    private guide1: TutorialGuide | null = null;
    /** Soft-hint overlay for Tutorial 2; null outside that lesson. */
    private guide2: TutorialGuide2 | null = null;
    /** Soft-hint overlay for Tutorial 3; null outside that lesson. */
    private guide3: TutorialGuide3 | null = null;
    /** Tutorial 1 forced pads (exact cell + rotation). */
    private placeSlots1: TutorialPlaceSlot[] = [];
    /** Tutorial 3 round-1 forced pads: [0] = dwarf (left), [1] = ballista (right). */
    private placeSlots3: TutorialPlaceSlot[] = [];
    /** Lesson progress: battles won so far. */
    private wins = 0;
    private pendingOutcome: 'win' | 'loss' | null = null;

    constructor(host: TutorialHost) {
        this.host = host;
        this.lesson = tutorialId(host.settings);
    }

    // ---------------------------------------------------------------- setup

    /** Chrome a lesson strips for its whole match (runes, and T2's shop column). */
    applyInitialChrome(): void {
        this.host.hud.setShopRunesVisible(false);
        if (this.lesson === TUTORIAL_2_ID) this.host.hud.setShopColumnVisible(false);
    }

    /**
     * Skip the specialist overlay — both seats auto-pick the hidden Tutorial
     * Commander. Shop unlocks are applied inside chooseCard so a reload /
     * hydrate restores the same roster.
     */
    applyStarters(): void {
        const host = this.host;
        if (host.starterPicked[host.humanSeat]) {
            // Resume path: chooseCard already ran via hydrate — refresh shop
            // chrome and start the guide if needed.
            host.unlockUsedThisRound[host.humanSeat] = true;
            host.refreshShopHud();
            this.maybeStartGuide();
            return;
        }
        const starterCard =
            this.lesson === TUTORIAL_2_ID
                ? TUTORIAL_2_START_CARD
                : this.lesson === TUTORIAL_3_ID
                  ? TUTORIAL_3_START_CARD
                  : TUTORIAL_START_CARD;
        host.dispatchPlayer({
            kind: 'chooseCard',
            team: 'player',
            cardId: starterCard.id,
        });
        // Block the unlock picker for this stripped lesson.
        host.unlockUsedThisRound[host.humanSeat] = true;
        host.opponent.chooseStarter([starterCard]);
        host.afterStarterPick();
        this.maybeStartGuide();
    }

    /**
     * A rebuild finished outside the match intro (finishMatchIntro covers the
     * other case): restore shop chrome + the guide so a reload mid-build isn't
     * silent.
     */
    onHydrateComplete(): void {
        this.host.unlockUsedThisRound[this.host.humanSeat] = true;
        this.host.refreshShopHud();
        this.maybeStartGuide();
    }

    maybeStartGuide(): void {
        const host = this.host;
        if (host.watching) return;
        if (this.guide1 || this.guide2 || this.guide3) return;
        // Wait until build chrome is up (after intro / starter assign).
        if (host.introActive || host.round < 1) return;
        const mount = this.mount();
        if (this.lesson === TUTORIAL_1_ID) {
            this.placeSlots1 = tutorial1PlaceSlots(host.map);
            this.guide1 = new TutorialGuide(
                mount,
                (target) => host.hud.setTutorialHighlight(target),
                (mask) => this.applySlotMask(mask),
            );
            this.guide1.start();
            return;
        }
        if (this.lesson === TUTORIAL_2_ID) {
            // Intro asks the player to click the keep — start with nothing selected.
            host.placement.deselect();
            this.guide2 = this.newGuide2(mount);
            this.guide2.start();
            this.sync2();
            return;
        }
        if (this.lesson === TUTORIAL_3_ID) {
            this.placeSlots3 = [tutorial3DwarfSlot(host.map), tutorial3BallistaSlot(host.map)];
            this.guide3 = this.newGuide3(mount);
            this.guide3.start();
            this.sync3();
        }
    }

    dispose(): void {
        this.guide1?.destroy();
        this.guide1 = null;
        this.guide2?.destroy();
        this.guide2 = null;
        this.guide3?.destroy();
        this.guide3 = null;
        this.host.placement.clearTutorialTargets();
    }

    private mount(): HTMLElement {
        return (document.getElementById('match-ui-root') as HTMLElement | null) ?? document.body;
    }

    private newGuide2(mount: HTMLElement): TutorialGuide2 {
        return new TutorialGuide2(mount, (target, spellId) => {
            // Panel / phone-bar tiles must exist before the callout binds —
            // paint Stronghold selection first (same pattern as Tutorial 3).
            if (
                target === 'stronghold-archers' ||
                target === 'upgrade' ||
                target === 'forge-spell'
            ) {
                this.ensurePlayerStrongholdSelected();
                const keep = this.playerStronghold();
                if (keep) this.host.hud.setSelection(this.host.unitInfo(keep));
                // Phone compact chrome puts Upgrade on the bottom bar via
                // setTouchActions — that only runs from updateSelectionUi.
                this.host.updateSelectionUi();
            }
            this.host.hud.setTutorial2Highlight(target, spellId);
            this.refresh2Zones();
        });
    }

    private newGuide3(mount: HTMLElement): TutorialGuide3 {
        return new TutorialGuide3(mount, (target) => this.onGuide3Highlight(target));
    }

    /** Boost / Longbow steps need the right panel open; select steps must not cheat it. */
    private onGuide3Highlight(target: Tutorial3Highlight): void {
        const host = this.host;
        if (target === 'boost-attack' || target === 'boost-hp') {
            this.ensurePlayerCommandTowerSelected();
            // The callout binds to a live boost tile — paint the panel first,
            // or the very first frame frames the whole sheet instead.
            const tower = this.playerCommandTower();
            if (tower) host.hud.setSelection(host.unitInfo(tower));
        } else if (target === 'tech-barrel') {
            this.ensurePlayerArcherSelected();
            const archer = this.playerArcher();
            if (archer) host.hud.setSelection(host.unitInfo(archer));
        }
        host.hud.setTutorial3Highlight(target);
        this.refresh3Zones();
    }

    // ------------------------------------------------------------- per-round

    /** Battlement pads available this match (all five are archer posts). */
    strongholdArcherSlots(): readonly number[] {
        return STRONGHOLD_ARCHER_SLOTS;
    }

    /**
     * Tutorial 1: empty map. Tutorial 2: player Stronghold only (forward).
     * Tutorial 3: per-round tower sets, spawned by {@link setupRound3}.
     */
    spawnBaseTowers(): void {
        if (this.lesson !== TUTORIAL_2_ID) return;
        this.spawnPlayerStronghold();
    }

    /** Tutorial 1: the player is capped at 2 packs; the AI still fields four archers. */
    applyDeployCaps(): void {
        if (this.lesson !== TUTORIAL_1_ID) return;
        const host = this.host;
        for (let seat = 0; seat < host.seats.length; seat++) {
            if (host.seats[seat]!.team === 'enemy') host.deployState.limit[seat] = 4;
        }
    }

    /** Tutorial 1: top up the enemy so four archers are affordable while the
     *  human stays on the 200 starting purse. */
    topUpRoundIncome(): void {
        if (this.lesson !== TUTORIAL_1_ID || this.host.round !== 1) return;
        const enemySeat = primarySeatOf(this.host.seats, 'enemy');
        const need = 400;
        const have = this.host.economy.balance(enemySeat);
        if (have < need) this.host.economy.credit(enemySeat, need - have);
    }

    /** Stage the board for a deployment round (clears leftovers, re-arms the guide). */
    onBuildPhase(round: number): void {
        if (this.lesson === TUTORIAL_2_ID) {
            this.clearFieldUnits();
            this.setupRound2(round);
        }
        if (this.lesson === TUTORIAL_3_ID) {
            this.clearFieldUnits();
            this.setupRound3(round);
        }
    }

    /** R2–R4 armies are pre-staged — freeze after both sides have spawned. */
    onAiBuildPhaseDone(): void {
        if (this.lesson !== TUTORIAL_3_ID) return;
        const round = this.host.round;
        if (round < 2) return;
        // Mark field packs as prior-round so drag-reposition is denied
        // (runes / techs still work).
        for (const u of this.host.placement.allUnits()) {
            if (u.type.structure || u.type === STRONGHOLD_ARCHER) continue;
            u.deployedRound = 0;
        }
    }

    private clearFieldUnits(): void {
        for (const u of [...this.host.placement.allUnits()]) {
            if (u.type.structure || u.type === STRONGHOLD_ARCHER) continue;
            this.host.placement.removeUnit(u);
        }
    }

    /** Round 3 opens on a bare field — every building comes down first. */
    private clearStructures(): void {
        for (const u of [...this.host.placement.allUnits()]) {
            if (u.type.structure || u.type === STRONGHOLD_ARCHER) {
                this.host.placement.removeUnit(u);
            }
        }
    }

    // ------------------------------------------------------------- selection

    private playerStronghold(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.type === STRONGHOLD && u.team === 'player' && !u.destroyed);
    }

    private ensurePlayerStrongholdSelected(): void {
        const keep = this.playerStronghold();
        if (!keep) return;
        if (this.host.placement.selectedUnit?.id !== keep.id) {
            this.host.placement.selectUnit(keep);
        }
        this.host.hud.openUnitDetails();
    }

    private playerCommandTower(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.type === COMMAND_TOWER && u.team === 'player' && !u.destroyed);
    }

    private ensurePlayerCommandTowerSelected(): void {
        const tower = this.playerCommandTower();
        if (!tower) return;
        if (this.host.placement.selectedUnit?.id === tower.id) return;
        this.host.placement.selectUnit(tower);
        this.host.hud.openUnitDetails();
    }

    private playerArcher(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.seat === this.host.humanSeat && u.type.id === 'archer' && !u.destroyed);
    }

    private ensurePlayerArcherSelected(): void {
        const archer = this.playerArcher();
        if (!archer) return;
        if (this.host.placement.selectedUnit?.id === archer.id) return;
        this.host.placement.selectUnit(archer);
        this.host.hud.openUnitDetails();
    }

    /** A pack was clicked: the panel-driven lessons re-read the board. */
    onUnitSelected(): void {
        this.sync2();
        this.sync3();
    }

    // ------------------------------------------------------------ tutorial 1

    /** Snapshot / poll camera pose while Tutorial 1 teaches pan / orbit / zoom. */
    tickCamera(): void {
        const guide = this.guide1;
        if (!guide || this.lesson !== TUTORIAL_1_ID) return;
        const snap = this.host.cameraSnap();
        if (guide.needsCameraBaseline) guide.beginCameraTracking(snap);
        guide.tickCamera(snap);
    }

    private board1(): { dwarfCount: number; slot0Filled: boolean; slot1Filled: boolean } {
        const slots = this.placeSlots1;
        const dwarves = this.host.placement
            .allUnits()
            .filter(
                (u) =>
                    u.seat === this.host.humanSeat && u.type.id === 'dwarf' && !u.type.structure,
            );
        const slot0 = slots[0];
        const slot1 = slots[1];
        let slot0Filled = false;
        let slot1Filled = false;
        for (const u of dwarves) {
            if (slot0 && unitMatchesTutorialSlot(u, slot0)) slot0Filled = true;
            if (slot1 && unitMatchesTutorialSlot(u, slot1)) slot1Filled = true;
        }
        return { dwarfCount: dwarves.length, slot0Filled, slot1Filled };
    }

    sync1(): void {
        if (!this.guide1 || this.lesson !== TUTORIAL_1_ID) return;
        const before = this.guide1.currentStep;
        this.guide1.syncFromBoard(this.board1());
        this.refreshSlotMask();
        this.maybeNudgeRotation(before);
    }

    /** If a dwarf sits on pad 2's cell but isn't rotated yet, nudge rotate. */
    private maybeNudgeRotation(stepBefore: string): void {
        if (this.guide1?.currentStep !== 'place2' && stepBefore !== 'place2') return;
        if (this.guide1?.currentStep !== 'place2') return;
        const slot1 = this.placeSlots1[1];
        if (!slot1) return;
        const board = this.board1();
        if (board.slot1Filled) return;
        const onCellWrongRot = this.host.placement.allUnits().some(
            (u) =>
                u.seat === this.host.humanSeat &&
                u.type.id === 'dwarf' &&
                u.cell.col === slot1.anchor.col &&
                u.cell.row === slot1.anchor.row &&
                u.rotated !== slot1.rotated,
        );
        if (onCellWrongRot) this.guide1.nudge(t('tutorial:tutorialNudgeRotate'));
    }

    private refreshSlotMask(): void {
        const step = this.guide1?.currentStep;
        if (!step) return;
        const mask: TutorialSlotMask =
            step === 'place1' || step === 'buy2'
                ? 'first'
                : step === 'place2' || step === 'goal' || step === 'end'
                  ? 'both'
                  : 'none';
        this.applySlotMask(mask);
    }

    private applySlotMask(mask: TutorialSlotMask): void {
        const placement = this.host.placement;
        if (this.lesson !== TUTORIAL_1_ID) {
            placement.clearTutorialTargets();
            return;
        }
        const slots = this.placeSlots1;
        if (mask === 'none' || slots.length === 0) {
            placement.clearTutorialTargets();
            return;
        }
        const board = this.board1();
        const targets: {
            anchor: { col: number; row: number };
            cols: number;
            rows: number;
            filled?: boolean;
        }[] = [];
        const push = (slot: TutorialPlaceSlot, filled: boolean) => {
            const fp = tutorialDwarfFootprint(slot.rotated);
            targets.push({
                anchor: slot.anchor,
                cols: fp.cols,
                rows: fp.rows,
                filled,
            });
        };
        if (mask === 'first' || mask === 'both') {
            if (slots[0]) push(slots[0], board.slot0Filled);
        }
        if (mask === 'second' || mask === 'both') {
            if (slots[1]) push(slots[1], board.slot1Filled);
        }
        placement.setTutorialPlaceTargets(targets);
    }

    // ------------------------------------------------------------ tutorial 2

    private spawnPlayerStronghold(): void {
        const host = this.host;
        const cell = tutorialBaseCell(
            host.map,
            BASE_ANCHORS.stronghold.xFrac,
            TUTORIAL_2_STRONGHOLD_ROW_FRAC,
            STRONGHOLD.footprint,
            'player',
        );
        host.placement.spawn(
            STRONGHOLD,
            cell,
            'player',
            false,
            false,
            primarySeatOf(host.seats, 'player'),
        );
    }

    private spawnEnemyStronghold(): void {
        const host = this.host;
        const exists = host.placement
            .allUnits()
            .some((u) => u.type === STRONGHOLD && u.team === 'enemy' && !u.destroyed);
        if (exists) return;
        // Same anchors as a normal match — back of the enemy zone, centered.
        const cell = tutorialBaseCell(
            host.map,
            BASE_ANCHORS.stronghold.xFrac,
            BASE_ANCHORS.stronghold.rowFrac,
            STRONGHOLD.footprint,
            'enemy',
        );
        host.placement.spawn(
            STRONGHOLD,
            cell,
            'enemy',
            false,
            false,
            primarySeatOf(host.seats, 'enemy'),
        );
    }

    private setupRound2(round: number): void {
        const host = this.host;
        const enemySeat = primarySeatOf(host.seats, 'enemy');
        host.unlockedUnits[enemySeat] = round === 3 ? ['dwarf'] : ['dwarf', 'archer'];
        // Match-wide unitsPerRound is 0 (player uses Stronghold only) — give the
        // AI an explicit deploy cap per round or it places nothing and the
        // battle ends instantly.
        const enemyCap = round === 1 ? 2 : round === 2 ? 12 : 6;
        host.deployState.limit[enemySeat] = enemyCap;
        const need = 2500;
        const have = host.economy.balance(enemySeat);
        if (have < need) host.economy.credit(enemySeat, need - have);

        if (round === 3) {
            this.spawnEnemyStronghold();
            host.unlockedUnits[host.humanSeat] = [];
            host.deployState.limit[host.humanSeat] = 0;
            host.hud.setShopColumnVisible(false);
            // Round 3 is Summon-only — drop leftover oil/dragon charges from R2.
            host.tacticInventory[host.humanSeat] = host.tacticInventory[host.humanSeat]!.filter(
                (id) => id !== OIL_SPILL_ID && id !== DRAGON_ID,
            );
            for (let i = host.spellStamps.length - 1; i >= 0; i--) {
                const s = host.spellStamps[i]!;
                if (
                    s.seat === host.humanSeat &&
                    (s.tacticId === OIL_SPILL_ID || s.tacticId === DRAGON_ID)
                ) {
                    host.spellStamps.splice(i, 1);
                }
            }
            if (host.armedTactic === OIL_SPILL_ID || host.armedTactic === DRAGON_ID) {
                host.cancelTacticPlacement();
            }
            // Enough for max keep upgrades (100+150+200+250) + summon (100).
            const humanNeed = 900;
            const humanHave = host.economy.balance(host.humanSeat);
            if (humanHave < humanNeed) host.economy.credit(host.humanSeat, humanNeed - humanHave);
        } else {
            host.unlockedUnits[host.humanSeat] = [];
            host.deployState.limit[host.humanSeat] = 0;
            host.hud.setShopColumnVisible(false);
        }

        if (round >= 2) {
            if (!this.guide2 || this.guide2.currentStep === 'done') {
                this.guide2?.destroy();
                this.guide2 = this.newGuide2(this.mount());
            }
            this.guide2.startRound(round);
        }
        this.sync2();
    }

    private board2(): Tutorial2BoardState {
        const host = this.host;
        const keep = this.playerStronghold();
        const oilZone = tutorial2OilCorridor(host.map);
        const dragonZone = tutorial2DragonCorridor(host.map);
        const oil = host.oilStamps.find((s) => s.seat === host.humanSeat);
        const oilPlaced = oil
            ? stampMatchesCorridor(oil.startX, oil.startZ, oil.endX, oil.endZ, oilZone)
            : false;
        const oilTol = zoneClickTol(oilZone.radius);
        const oilStartDrafted =
            oilPlaced ||
            (!!host.tacticDraftStart &&
                host.armedTactic === OIL_SPILL_ID &&
                pointNear(
                    host.tacticDraftStart.x,
                    host.tacticDraftStart.z,
                    oilZone.startX,
                    oilZone.startZ,
                    oilTol,
                ));
        const spells = host.spellStamps.filter((s) => s.seat === host.humanSeat);
        const dragonPlaced = spells.some(
            (s) =>
                s.tacticId === DRAGON_ID &&
                stampMatchesCorridor(s.x, s.z, s.endX ?? s.x, s.endZ ?? s.z, dragonZone),
        );
        const dragonTol = zoneClickTol(dragonZone.radius);
        const dragonStartDrafted =
            dragonPlaced ||
            (!!host.tacticDraftStart &&
                host.armedTactic === DRAGON_ID &&
                pointNear(
                    host.tacticDraftStart.x,
                    host.tacticDraftStart.z,
                    dragonZone.startX,
                    dragonZone.startZ,
                    dragonTol,
                ));
        const summonZone = this.summonZone();
        const summonPlaced = spells.some(
            (s) =>
                s.tacticId === SPAWN_DWARVES_ID &&
                !!summonZone &&
                stampMatchesPoint(s.x, s.z, summonZone),
        );
        return {
            round: host.round,
            strongholdArcherCount: host.strongholdArcherCount('player'),
            keepLevel: keep?.level ?? 1,
            keepMaxLevel: host.settings.towers.upgrade.maxLevel,
            keepSelected: !!keep && host.placement.selectedUnit?.id === keep.id,
            forgeOwned: host.forgeSpellOwned[host.humanSeat] ?? [],
            oilArmed: host.armedTactic === OIL_SPILL_ID,
            oilStartDrafted,
            oilPlaced,
            dragonArmed: host.armedTactic === DRAGON_ID,
            dragonStartDrafted,
            dragonPlaced,
            summonArmed: host.armedTactic === SPAWN_DWARVES_ID,
            summonPlaced,
        };
    }

    /** Glowing summon target behind + right of the enemy keep (round 3). */
    private summonZone(): TutorialWorldZone | null {
        const host = this.host;
        const enemyKeep = host.placement
            .allUnits()
            .find((u) => u.type === STRONGHOLD && u.team === 'enemy' && !u.destroyed);
        if (!enemyKeep) return null;
        const mid = tutorial2OilCorridor(host.map);
        return tutorial2SummonNearKeep(
            host.map,
            enemyKeep.world.x,
            enemyKeep.world.z,
            (mid.startX + mid.endX) / 2,
            (mid.startZ + mid.endZ) / 2,
        );
    }

    sync2(): void {
        if (!this.guide2 || this.lesson !== TUTORIAL_2_ID) return;
        this.guide2.syncFromBoard(this.board2());
        this.refresh2Zones();
        this.host.updateSelectionUi();
    }

    private refresh2Zones(): void {
        const host = this.host;
        if (this.lesson !== TUTORIAL_2_ID || !this.guide2) {
            host.placement.clearTutorialTargets();
            return;
        }
        const step = this.guide2.currentStep;
        const state = this.board2();

        if (host.round === 2) {
            const oilZone = tutorial2OilCorridor(host.map);
            const dragonZone = tutorial2DragonCorridor(host.map);
            const zones: { x: number; z: number; radius: number; filled?: boolean }[] = [];
            if (step === 'r2PlaceOilStart') {
                zones.push({
                    x: oilZone.startX,
                    z: oilZone.startZ,
                    radius: oilZone.radius,
                });
            } else if (step === 'r2PlaceOilEnd') {
                zones.push({
                    x: oilZone.endX,
                    z: oilZone.endZ,
                    radius: oilZone.radius,
                    filled: state.oilPlaced,
                });
            } else if (step === 'r2PlaceDragonStart') {
                zones.push({
                    x: dragonZone.startX,
                    z: dragonZone.startZ,
                    radius: dragonZone.radius,
                });
            } else if (step === 'r2PlaceDragonEnd') {
                zones.push({
                    x: dragonZone.endX,
                    z: dragonZone.endZ,
                    radius: dragonZone.radius,
                    filled: state.dragonPlaced,
                });
            }
            if (zones.length > 0) {
                host.placement.setTutorialWorldZones(zones);
                return;
            }
        }

        if (host.round === 3 && step === 'r3PlaceSummon') {
            const z = this.summonZone();
            if (z) {
                host.placement.setTutorialWorldZones([
                    { x: z.x, z: z.z, radius: z.radius, filled: state.summonPlaced },
                ]);
                return;
            }
        }

        host.placement.clearTutorialTargets();
    }

    /**
     * Tutorial 2: force oil/dragon clicks onto the glowing start/end circles.
     * Returns snapped world point, `'miss'` (nudge + swallow), or null (no gate).
     */
    corridorClick(
        tacticId: string,
        ground: { x: number; z: number },
    ): { x: number; z: number } | 'miss' | null {
        if (this.lesson !== TUTORIAL_2_ID || !this.guide2) return null;
        const step = this.guide2.currentStep;
        const oilSteps = step === 'r2PlaceOilStart' || step === 'r2PlaceOilEnd';
        const dragonSteps = step === 'r2PlaceDragonStart' || step === 'r2PlaceDragonEnd';
        if (tacticId === OIL_SPILL_ID && !oilSteps) return null;
        if (tacticId === DRAGON_ID && !dragonSteps) return null;
        if (tacticId !== OIL_SPILL_ID && tacticId !== DRAGON_ID) return null;

        const corridor =
            tacticId === OIL_SPILL_ID
                ? tutorial2OilCorridor(this.host.map)
                : tutorial2DragonCorridor(this.host.map);
        const tol = zoneClickTol(corridor.radius);
        const wantStart = step === 'r2PlaceOilStart' || step === 'r2PlaceDragonStart';
        const tx = wantStart ? corridor.startX : corridor.endX;
        const tz = wantStart ? corridor.startZ : corridor.endZ;
        if (!pointNear(ground.x, ground.z, tx, tz, tol)) {
            this.guide2.nudge(t('tutorial:tutorial2R2PlaceOilMiss'));
            return 'miss';
        }
        return { x: tx, z: tz };
    }

    /**
     * Tutorial 2 summon: only the glowing circle near the enemy keep counts.
     * Returns the snapped point, `'miss'` (nudge + swallow), or null (no gate).
     */
    summonPointClick(
        tacticId: string,
        ground: { x: number; z: number },
    ): { x: number; z: number } | 'miss' | null {
        if (
            this.lesson !== TUTORIAL_2_ID ||
            this.guide2?.currentStep !== 'r3PlaceSummon' ||
            tacticId !== SPAWN_DWARVES_ID
        ) {
            return null;
        }
        const zone = this.summonZone();
        if (!zone || !stampMatchesPoint(ground.x, ground.z, zone)) {
            this.guide2.nudge(t('tutorial:tutorial2R2PlaceOilMiss'));
            return 'miss';
        }
        return { x: zone.x, z: zone.z };
    }

    /** Tutorial 2 round 3: only Summon Dwarves — hide oil/dragon charges. */
    hidesTacticCharge(tacticId: string): boolean {
        return (
            this.lesson === TUTORIAL_2_ID &&
            this.host.round === 3 &&
            (tacticId === OIL_SPILL_ID || tacticId === DRAGON_ID)
        );
    }

    /** Tutorial 2 round 1 teaches the wall only — the forge shelf stays empty. */
    get forgeSpellsHidden(): boolean {
        return this.lesson === TUTORIAL_2_ID && this.host.round < 2;
    }

    /** Forge spells buyable this round (Tutorial 2 gates oil/dragon vs summon by round). */
    forgeSpellsOf(seat: SeatId): readonly string[] | undefined {
        const spells = this.host.starterForgeSpellsOf(seat);
        if (!spells) return undefined;
        if (this.lesson !== TUTORIAL_2_ID) return spells;
        if (this.host.round < 3) {
            return spells.filter((id) => id !== SPAWN_DWARVES_ID);
        }
        // Round 3: only Summon Dwarves — oil/dragon already taught.
        return spells.filter((id) => id === SPAWN_DWARVES_ID);
    }

    // ------------------------------------------------------------ tutorial 3

    /**
     * The Garrison / Vanguard pair for one side (or both), on the same anchors
     * a normal match uses — no Stronghold, and never a duplicate.
     */
    private spawnTowers3(team: 'player' | 'enemy' | 'both'): void {
        const host = this.host;
        const spawnBuilding = (
            xFrac: number,
            rowFrac: number,
            type: UnitType,
            side: 'player' | 'enemy',
        ) => {
            host.placement.spawn(
                type,
                tutorialBaseCell(host.map, xFrac, rowFrac, type.footprint, side),
                side,
                false,
                false,
                primarySeatOf(host.seats, side),
            );
        };
        const sides: ('player' | 'enemy')[] = team === 'both' ? ['player', 'enemy'] : [team];
        for (const side of sides) {
            const standing = (type: UnitType) =>
                host.placement
                    .allUnits()
                    .some((u) => u.type === type && u.team === side && !u.destroyed);
            if (!standing(RESEARCH_CENTER)) {
                spawnBuilding(
                    BASE_ANCHORS.research.xFrac,
                    BASE_ANCHORS.research.rowFrac,
                    RESEARCH_CENTER,
                    side,
                );
            }
            if (!standing(COMMAND_TOWER)) {
                spawnBuilding(
                    BASE_ANCHORS.command.xFrac,
                    BASE_ANCHORS.command.rowFrac,
                    COMMAND_TOWER,
                    side,
                );
            }
        }
    }

    /** Round 3: the player's own half of the mirrored 2 dwarf + 3 archer army. */
    private spawnPlayerArmy3(): void {
        const seat = this.host.humanSeat;
        for (const pack of tutorial3MirroredArmy(this.host.map, 'player')) {
            const type = unitTypeById(pack.typeId);
            if (!type) continue;
            this.host.placement.spawn(type, pack.cell, 'player', false, true, seat);
        }
    }

    /** Round 4: five archers across the player's zone center. */
    private spawnPlayerArchers3(): void {
        const seat = this.host.humanSeat;
        const type = unitTypeById('archer');
        if (!type) return;
        for (const cell of tutorial3CenterArcherCells(
            this.host.map,
            'player',
            TUTORIAL_3_R4_ARCHERS,
        )) {
            this.host.placement.spawn(type, cell, 'player', false, true, seat);
        }
    }

    /**
     * Tutorial 3's four lessons: enemy towers only (debuff), mirrored towers +
     * one pack a side (Vanguard boosts), locked mirrored armies (runes), then
     * center archers (Longbow).
     */
    private setupRound3(round: number): void {
        const host = this.host;
        const humanSeat = host.humanSeat;
        const enemySeat = primarySeatOf(host.seats, 'enemy');
        host.unlockedUnits[enemySeat] = ['dwarf', 'archer'];
        // Explicit per-round AI cap: the match-wide unitsPerRound only fits
        // round 1, and a cap of 0 would leave the enemy field empty.
        host.deployState.limit[enemySeat] =
            round === 1 ? 2 : round === 2 ? 1 : round === 3 ? 5 : TUTORIAL_3_R4_ARCHERS;
        const enemyNeed = 2000;
        const enemyHave = host.economy.balance(enemySeat);
        if (enemyHave < enemyNeed) host.economy.credit(enemySeat, enemyNeed - enemyHave);

        const credit = (need: number) => {
            const have = host.economy.balance(humanSeat);
            if (have < need) host.economy.credit(humanSeat, need - have);
        };

        // Force Longbow onto the human archer loadout for this lesson (readonly
        // Loadout — replace the seat entry rather than mutating nested arrays).
        const seatEntry = host.seats[humanSeat];
        if (seatEntry?.loadout) {
            const archerTechs = [...(seatEntry.loadout.techs.archer ?? [])];
            if (!archerTechs.includes(TUTORIAL_3_ARCHER_RANGE_TECH)) {
                host.seats[humanSeat] = {
                    ...seatEntry,
                    loadout: {
                        techs: {
                            ...seatEntry.loadout.techs,
                            archer: [TUTORIAL_3_ARCHER_RANGE_TECH, ...archerTechs].slice(0, 3),
                        },
                    },
                };
            }
        }

        if (round === 1) {
            this.spawnTowers3('enemy');
            host.unlockedUnits[humanSeat] = ['dwarf', 'ballista'];
            host.deployState.limit[humanSeat] = 2;
            host.hud.setShopColumnVisible(true);
            host.hud.setShopRunesVisible(false);
            credit(1500); // one dwarf (100) + one ballista (400), with room to spare
        } else if (round === 2) {
            this.spawnTowers3('both');
            // One pack a side, nose to nose — the boosts are the only difference.
            const dwarf = unitTypeById('dwarf');
            if (dwarf) {
                host.placement.spawn(
                    dwarf,
                    tutorial3CenterDwarfCell(host.map),
                    'player',
                    false,
                    true,
                    humanSeat,
                );
            }
            host.unlockedUnits[humanSeat] = [];
            host.deployState.limit[humanSeat] = 0;
            host.hud.setShopColumnVisible(false);
            host.hud.setShopRunesVisible(false);
            // Both tracks, every tier — the round's gate needs all of it.
            credit(2 * host.settings.boosts.costs.reduce((sum, c) => sum + c, 0));
        } else if (round === 3) {
            this.clearStructures();
            this.spawnPlayerArmy3();
            // Shop runes share the unit buy limit; leave headroom past the gate.
            host.unlockedUnits[humanSeat] = [];
            host.deployState.limit[humanSeat] = 20;
            host.hud.setShopColumnVisible(true);
            host.hud.setShopRunesVisible(true);
            const ds = host.settings.deploy;
            const runes = TUTORIAL_3_MIN_RUNES * 2;
            credit(runes * ds.baseRuneCost + ((runes * (runes - 1)) / 2) * ds.runeCostStep);
        } else {
            this.clearStructures();
            this.spawnPlayerArchers3();
            host.unlockedUnits[humanSeat] = [];
            host.deployState.limit[humanSeat] = 0;
            host.hud.setShopColumnVisible(false);
            host.hud.setShopRunesVisible(false);
            // Longbow base cost (200) — enough even if a prior talent somehow exists.
            credit(400);
        }
        host.refreshShopHud();

        if (round >= 2) {
            if (!this.guide3 || this.guide3.currentStep === 'done') {
                this.guide3?.destroy();
                this.guide3 = this.newGuide3(this.mount());
            }
            // Each round opens on nothing selected — the lesson asks for the click.
            host.placement.deselect();
            this.guide3.startRound(round);
        }
        this.sync3();
    }

    private board3(): Tutorial3BoardState {
        const host = this.host;
        const dwarfSlot = this.placeSlots3[0];
        const ballistaSlot = this.placeSlots3[1];
        const own = host.placement
            .allUnits()
            .filter((u) => u.seat === host.humanSeat && !u.type.structure);
        const dwarves = own.filter((u) => u.type.id === 'dwarf');
        const ballistas = own.filter((u) => u.type.id === 'ballista');
        const tower = this.playerCommandTower();
        const selected = host.placement.selectedUnit;
        return {
            round: host.round,
            dwarfCount: dwarves.length,
            ballistaCount: ballistas.length,
            dwarfPlaced: !!dwarfSlot && dwarves.some((u) => unitMatchesTutorialSlot(u, dwarfSlot)),
            // The ballista footprint is square — rotating it changes nothing,
            // so the pad accepts either orientation on the right cell.
            ballistaPlaced:
                !!ballistaSlot && ballistas.some((u) => cellEq(u.cell, ballistaSlot.anchor)),
            vanguardSelected: !!tower && selected?.id === tower.id,
            boostAttack: host.boostState.attack[host.humanSeat]!,
            boostHp: host.boostState.hp[host.humanSeat]!,
            boostMax: host.settings.boosts.costs.length,
            runesBought: host.deployState.runesBought[host.humanSeat]!,
            runesApplied: own.reduce((n, u) => n + u.items.length, 0),
            archerSelected:
                !!selected && selected.seat === host.humanSeat && selected.type.id === 'archer',
            longbowOwned: host.techTree.has(
                host.humanSeat,
                'archer',
                TUTORIAL_3_ARCHER_RANGE_TECH,
            ),
        };
    }

    sync3(): void {
        if (!this.guide3 || this.lesson !== TUTORIAL_3_ID) return;
        this.guide3.syncFromBoard(this.board3());
        this.refresh3Zones();
        this.host.updateSelectionUi();
    }

    /** Round 1's forced pads: the dwarf pad opens first, the ballista pad after it. */
    private refresh3Zones(): void {
        const host = this.host;
        const guide = this.guide3;
        if (this.lesson !== TUTORIAL_3_ID || !guide || host.round !== 1) {
            host.placement.clearTutorialTargets();
            return;
        }
        const step = guide.currentStep;
        const showDwarf = step !== 'r1Intro' && step !== 'r1BuyDwarf' && step !== 'done';
        const showBallista =
            step === 'r1PlaceBallista' || step === 'r1DebuffExplain' || step === 'r1End';
        const dwarfSlot = this.placeSlots3[0];
        const ballistaSlot = this.placeSlots3[1];
        const targets: {
            anchor: { col: number; row: number };
            cols: number;
            rows: number;
            filled?: boolean;
        }[] = [];
        const state = this.board3();
        if (showDwarf && dwarfSlot) {
            const fp = tutorialDwarfFootprint(dwarfSlot.rotated);
            targets.push({
                anchor: dwarfSlot.anchor,
                cols: fp.cols,
                rows: fp.rows,
                filled: state.dwarfPlaced,
            });
        }
        if (showBallista && ballistaSlot) {
            const fp = tutorialBallistaFootprint();
            targets.push({
                anchor: ballistaSlot.anchor,
                cols: fp.cols,
                rows: fp.rows,
                filled: state.ballistaPlaced,
            });
        }
        if (targets.length === 0) {
            host.placement.clearTutorialTargets();
            return;
        }
        host.placement.setTutorialPlaceTargets(targets);
    }

    /** Tutorial 3 round 2 is the boost lesson — the other tracks stay hidden. */
    get boostLessonOnly(): boolean {
        return this.lesson === TUTORIAL_3_ID && this.host.round === 2;
    }

    /** Tutorial 3 round 4: an archer's tech list narrows to Longbow alone. */
    soleTechFor(unit: Unit): string | null {
        return this.lesson === TUTORIAL_3_ID &&
            this.host.round === 4 &&
            unit.type.id === 'archer'
            ? TUTORIAL_3_ARCHER_RANGE_TECH
            : null;
    }

    // ----------------------------------------------------------------- gates

    /** Whichever lesson overlay is live — nudges go to it, never to a fixed one. */
    private nudge(message: string): void {
        (this.guide1 ?? this.guide2 ?? this.guide3)?.nudge(message);
    }

    /** Every lesson re-reads the board after a placement / purchase. */
    syncFromBoard(): void {
        this.sync1();
        this.sync2();
        this.sync3();
    }

    onPlayerEndedDeployment(): void {
        this.guide1?.onPlayerEndedDeployment();
        this.guide2?.onPlayerEndedDeployment();
        this.guide3?.onPlayerEndedDeployment();
        this.host.placement.clearTutorialTargets();
    }

    /** End Deployment: true when this lesson's step is satisfied (else it nudges). */
    tryEndDeploy(): boolean {
        if (this.lesson === TUTORIAL_1_ID) {
            const board = this.board1();
            if (!board.slot0Filled || !board.slot1Filled) {
                this.guide1?.nudge(t('tutorial:tutorialNudgePlacePads'));
                return false;
            }
        }
        if (this.lesson === TUTORIAL_2_ID && this.guide2) {
            const state = this.board2();
            if (!this.guide2.canEndDeploy(state)) {
                if (state.round === 3 && state.keepLevel < state.keepMaxLevel) {
                    this.guide2.nudge(
                        t('tutorial:tutorial2R3UpgradeNudge', {
                            level: state.keepLevel,
                            max: state.keepMaxLevel,
                        }),
                    );
                } else {
                    this.guide2.nudge(t('tutorial:tutorial2NudgeFinishStep'));
                }
                return false;
            }
        }
        if (this.lesson === TUTORIAL_3_ID && this.guide3) {
            const state = this.board3();
            if (!this.guide3.canEndDeploy(state)) {
                if (state.round === 1) {
                    this.guide3.nudge(t('tutorial:tutorial3NudgePlacePads'));
                } else if (state.round === 2) {
                    this.guide3.nudge(
                        t('tutorial:tutorial3NudgeBoosts', {
                            attack: state.boostAttack,
                            hp: state.boostHp,
                            max: state.boostMax,
                        }),
                    );
                } else if (state.round === 3) {
                    this.guide3.nudge(
                        t('tutorial:tutorial3NudgeRunes', {
                            bought: state.runesBought,
                            need: TUTORIAL_3_MIN_RUNES,
                        }),
                    );
                } else {
                    this.guide3.nudge(t('tutorial:tutorial3NudgeLongbow'));
                }
                return false;
            }
        }
        return true;
    }

    /** Shop gates that run before the unlock / affordability checks. */
    blocksBuyEarly(_type: UnitType): boolean {
        if (this.lesson === TUTORIAL_2_ID && this.host.round < 3) {
            this.guide2?.nudge(t('tutorial:tutorial2NudgeNoShop'));
            return true;
        }
        if (this.lesson === TUTORIAL_3_ID) {
            if (this.host.round >= 2) {
                this.guide3?.nudge(t('tutorial:tutorial3NudgeNoShop'));
                return true;
            }
            const step = this.guide3?.currentStep;
            if (step === 'r1Intro') {
                this.guide3?.nudge(t('tutorial:tutorial3NudgeReadIntro'));
                return true;
            }
            if (step === 'r1PlaceDwarf' || step === 'r1PlaceBallista') {
                this.guide3?.nudge(t('tutorial:tutorialNudgeFinishPad'));
                return true;
            }
        }
        return false;
    }

    /** Tutorial 1's shop gates — only reached once the buy is otherwise legal. */
    blocksBuyLate(): boolean {
        const step = this.guide1?.currentStep;
        if (step === 'place1' || step === 'place2') {
            this.guide1?.nudge(t('tutorial:tutorialNudgeFinishPad'));
            return true;
        }
        if (this.guide1?.isCameraLesson) {
            this.guide1?.nudge(t('tutorial:tutorialNudgeCameraFirst'));
            return true;
        }
        if (step === 'goal') {
            this.guide1?.nudge(t('tutorial:tutorialNudgeReadGoal'));
            return true;
        }
        return false;
    }

    /** Tutorial 3's rune round is the only place a lesson sells runes. */
    blocksBuyRune(): boolean {
        if (this.lesson === TUTORIAL_3_ID && this.host.round === 3) return false;
        this.nudge(t('tutorial:tutorialNudgeRunes'));
        return true;
    }

    /** Tutorial 3 round 4: Longbow is the only talent the lesson pays for. */
    blocksBuyTech(techId: string): boolean {
        if (
            this.lesson !== TUTORIAL_3_ID ||
            this.host.round !== 4 ||
            techId === TUTORIAL_3_ARCHER_RANGE_TECH
        ) {
            return false;
        }
        this.guide3?.nudge(t('tutorial:tutorial3NudgeLongbow'));
        return true;
    }

    // --------------------------------------------------------- round outcome

    /** Battles this lesson must win to finish (Tutorial 1 is a single round). */
    private get roundsToWin(): number {
        if (this.lesson === TUTORIAL_3_ID) return TUTORIAL_3_ROUNDS;
        if (this.lesson === TUTORIAL_2_ID) return TUTORIAL_2_ROUNDS;
        return 1;
    }

    /**
     * Every lesson scores its own battles, the way the campaign does: higher
     * remaining HP wins the round, equal HP is a loss. Returns whether this
     * lesson claimed the verdict — without it a mutual wipe leaves both sides
     * on their untouched sudden-death HP and the match would roll on into an
     * unscripted extra round.
     */
    armRoundOutcome(playerHp: number, enemyHp: number, live: boolean): boolean {
        if (this.lesson === null || !live) return false;
        this.pendingOutcome = playerHp > enemyHp ? 'win' : 'loss';
        return true;
    }

    /** Shift+I must not read the padded/restored HP as a lesson verdict. */
    clearPendingOutcome(): void {
        this.pendingOutcome = null;
    }

    get hasPendingOutcome(): boolean {
        return this.pendingOutcome !== null;
    }

    consumeRoundOutcome(): TutorialRoundResult {
        const outcome = this.pendingOutcome;
        this.pendingOutcome = null;
        if (this.host.hydrating) {
            // A lesson's progress lives only here, never in the action log, so
            // a replayed battle must not count. (Tutorials are not persisted —
            // see constructGame — so today this only guards replay playback.)
            if (outcome === 'win') this.restoreHp();
            return 'continue';
        }
        if (outcome !== 'win') return 'defeat';
        if (++this.wins >= this.roundsToWin) return 'victory';
        this.restoreHp();
        return 'roundWon';
    }

    /** The Round n/total beat shown between lesson rounds. */
    roundSplash(): { round: number; total: number } {
        const total = this.roundsToWin;
        return { round: Math.min(this.wins + 1, total), total };
    }

    /** Multi-round tutorials (2 / 3): reset sudden-death HP between rounds. */
    private restoreHp(): void {
        this.host.restoreSideHp(this.host.settings.tutorial?.sideHp ?? 1);
    }
}
