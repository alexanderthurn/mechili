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
import type { Tutorial4BoardState, Tutorial4Highlight } from '../ui/tutorialGuide4';
import type { Tutorial5BoardState, Tutorial5Highlight } from '../ui/tutorialGuide5';
import type { TutorialCameraSnap, TutorialSlotMask } from '../ui/tutorialGuide';
import { primarySeatOf } from './seats';
import { t } from '../i18n';
import { TutorialGuide } from '../ui/tutorialGuide';
import { TutorialGuide2 } from '../ui/tutorialGuide2';
import { TutorialGuide3 } from '../ui/tutorialGuide3';
import { TutorialGuide4 } from '../ui/tutorialGuide4';
import { TutorialGuide5 } from '../ui/tutorialGuide5';
import {
    TUTORIAL_2_START_CARD_ID,
    TUTORIAL_3_START_CARD_ID,
    TUTORIAL_4_START_CARD_ID,
    TUTORIAL_5_START_CARD_ID,
    TUTORIAL_START_CARD_ID,
} from './cards';
import { BASE_ANCHORS } from './map';
import { DRAGON_ID, OIL_SPILL_ID, SPAWN_DWARVES_ID } from './tactics';
import {
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
    tutorial3DwarfSlot,
    tutorial4MirroredArmy,
    tutorial4OgreCell,
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
    TUTORIAL_3_ID,
    TUTORIAL_3_ROUNDS,
    TUTORIAL_3_R3_DWARVES,
    TUTORIAL_3_R4_TOWER_LEVEL,
    TUTORIAL_4_ARCHER_RANGE_TECH,
    TUTORIAL_4_ID,
    TUTORIAL_4_ROUNDS,
    TUTORIAL_4_RUNE_LESSON,
    TUTORIAL_5_ID,
    TUTORIAL_5_ROUNDS,
    TUTORIAL_ARCHER_ID,
    TUTORIAL_DWARF_ID,
    TUTORIAL_OGRE_ID,
    tutorialContentProblems,
    type TutorialPlaceSlot,
    type TutorialWorldZone,
} from './tutorial';
import {
    boardState3,
    boardState4,
    mortarPadTarget,
    r3PadTargets,
    setupTutorial3Round,
    setupTutorial4Round,
    setupTutorial5Round,
} from './tutorialRounds34';
import type { TypeRegistry } from './content/typeRegistry';

/**
 * The slice of {@link Game} the tutorial lessons are allowed to touch. Kept
 * deliberately narrow: everything here is either match state the lessons read
 * to decide which step the player is on, or a seam they drive to stage a round.
 */
export interface TutorialHost {
    /** the unit and building definitions this match plays with */
    readonly types: TypeRegistry;
    readonly settings: GameSettings;
    readonly map: BattleMap;
    readonly placement: PlacementController;
    readonly economy: Economy;
    readonly techTree: TechTree;
    readonly hud: Hud;
    /** mutable: Tutorial 4 replaces the human seat entry to force Longbow */
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
    readonly deployState: { limit: number[]; runesBought: number[]; extra: number[]; used: number[] };
    readonly boostState: Record<'attack' | 'hp', number[]>;
    readonly tacticInventory: string[][];
    readonly forgeSpellOwned: string[][];
    readonly oilStamps: OilStamp[];
    readonly spellStamps: SpellStamp[];
    readonly armedTactic: string | null;
    readonly tacticDraftStart: { x: number; z: number } | null;
    readonly recruitLevel: number[];
    readonly itemInventory: string[][];
    readonly forgeSlots: Record<'player' | 'enemy', (import('./forgeRecipes').ForgeSlot | null)[]>;
    readonly armedItem: string | null;
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
 * Everything the tutorial lessons need on top of a normal match: the
 * soft-hint overlays, the forced pads / spell corridors, the per-round board
 * staging and the shop / End Deployment gates that keep a lesson on rails.
 *
 * One instance lives for the whole match (created only when
 * `settings.tutorial` is set); {@link Game} keeps thin `this.tutorial?.…`
 * seams and holds no lesson state of its own.
 */
export class TutorialRuntime {
    // Lessons name specific base buildings on purpose (plan §17.1 rule 7) —
    // resolved through the match's registry, never module constants.
    private get STRONGHOLD() {
        return this.host.types.require('stronghold');
    }
    private get COMMAND_TOWER() {
        return this.host.types.require('command-tower');
    }
    private get RESEARCH_CENTER() {
        return this.host.types.require('research-center');
    }

    private readonly host: TutorialHost;
    private readonly lesson: number | null;
    /** Soft-hint overlay for Tutorial 1; null outside that lesson. */
    private guide1: TutorialGuide | null = null;
    /** Soft-hint overlay for Tutorial 2; null outside that lesson. */
    private guide2: TutorialGuide2 | null = null;
    /** Soft-hint overlay for Tutorial 3; null outside that lesson. */
    private guide3: TutorialGuide3 | null = null;
    /** Soft-hint overlay for Tutorial 4; null outside that lesson. */
    private guide4: TutorialGuide4 | null = null;
    /** Soft-hint overlay for Tutorial 5; null outside that lesson. */
    private guide5: TutorialGuide5 | null = null;
    /** Tutorial 1 forced pads (exact cell + rotation). */
    private placeSlots1: TutorialPlaceSlot[] = [];
    /** Tutorial 3 round-1 forced pads: [0] = dwarf (left), [1] = ballista (right). */
    private placeSlots3: TutorialPlaceSlot[] = [];
    /** Lesson progress: battles won so far. */
    private wins = 0;
    private pendingOutcome: 'win' | 'loss' | null = null;

    constructor(host: TutorialHost) {
        const problems = tutorialContentProblems(host.types);
        if (problems.length > 0) throw new Error(`[tutorial] content changed under the lessons: ${problems.join('; ')}`);
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
        const starterCardId =
            this.lesson === TUTORIAL_2_ID
                ? TUTORIAL_2_START_CARD_ID
                : this.lesson === TUTORIAL_3_ID
                  ? TUTORIAL_3_START_CARD_ID
                  : this.lesson === TUTORIAL_4_ID
                    ? TUTORIAL_4_START_CARD_ID
                    : this.lesson === TUTORIAL_5_ID
                      ? TUTORIAL_5_START_CARD_ID
                      : TUTORIAL_START_CARD_ID;
        host.dispatchPlayer({
            kind: 'chooseCard',
            team: 'player',
            cardId: starterCardId,
        });
        // Block the unlock picker for this stripped lesson.
        host.unlockUsedThisRound[host.humanSeat] = true;
        const starterCard = host.types.commander(starterCardId);
        host.opponent.chooseStarter(starterCard ? [starterCard] : []);
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
        if (this.guide1 || this.guide2 || this.guide3 || this.guide4 || this.guide5) return;
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
            return;
        }
        if (this.lesson === TUTORIAL_4_ID) {
            host.placement.deselect();
            this.guide4 = this.newGuide4(mount);
            this.guide4.start();
            this.sync4();
            return;
        }
        if (this.lesson === TUTORIAL_5_ID) {
            host.placement.deselect();
            this.guide5 = this.newGuide5(mount);
            this.guide5.start();
            this.sync5();
        }
    }

    dispose(): void {
        this.guide1?.destroy();
        this.guide1 = null;
        this.guide2?.destroy();
        this.guide2 = null;
        this.guide3?.destroy();
        this.guide3 = null;
        this.guide4?.destroy();
        this.guide4 = null;
        this.guide5?.destroy();
        this.guide5 = null;
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

    private newGuide4(mount: HTMLElement): TutorialGuide4 {
        return new TutorialGuide4(mount, (target) => this.onGuide4Highlight(target));
    }

    private newGuide5(mount: HTMLElement): TutorialGuide5 {
        return new TutorialGuide5(mount, (target) => {
            this.host.hud.setTutorial3Highlight(target);
        });
    }

    /** Boost / Garrison panel steps need the right building selected. */
    private onGuide3Highlight(target: Tutorial3Highlight): void {
        const host = this.host;
        if (target === 'boost-attack' || target === 'boost-hp') {
            this.ensurePlayerCommandTowerSelected();
            const tower = this.playerCommandTower();
            if (tower) host.hud.setSelection(host.unitInfo(tower));
        } else if (
            target === 'deploy-slot' ||
            target === 'recruit-l2' ||
            target === 'tower-upgrade'
        ) {
            this.ensurePlayerGarrisonSelected();
            const g = this.playerGarrison();
            if (g) host.hud.setSelection(host.unitInfo(g));
        }
        host.hud.setTutorial3Highlight(target);
        this.refresh3Zones();
    }

    /** Longbow / forge steps need the right panel open. */
    private onGuide4Highlight(target: Tutorial4Highlight): void {
        const host = this.host;
        if (target === 'tech-barrel') {
            this.ensurePlayerArcherSelected();
            const archer = this.playerArcher();
            if (archer) host.hud.setSelection(host.unitInfo(archer));
        } else if (target === 'stronghold') {
            // world click — no UI frame
        }
        host.hud.setTutorial3Highlight(target);
        this.refresh4Zones();
    }

    // ------------------------------------------------------------- per-round

    /**
     * Tutorial 1: empty map. Tutorial 2: player Stronghold only (forward).
     * Tutorial 3: per-round tower sets, spawned by {@link setupRound3}.
     * Tutorial 4: no buildings — armies staged by {@link setupRound4}.
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
        if (this.lesson === TUTORIAL_4_ID) {
            this.clearFieldUnits();
            this.setupRound4(round);
        }
        if (this.lesson === TUTORIAL_5_ID) {
            this.clearFieldUnits();
            this.setupRound5(round);
        }
    }

    /** Pre-staged armies freeze after both sides have spawned. */
    onAiBuildPhaseDone(): void {
        if (this.lesson === TUTORIAL_3_ID && this.host.round >= 2) {
            this.freezeFieldPacks();
            return;
        }
        if (this.lesson === TUTORIAL_4_ID || this.lesson === TUTORIAL_5_ID) {
            this.freezeFieldPacks();
        }
    }

    private freezeFieldPacks(): void {
        // Mark field packs as prior-round so drag-reposition is denied
        // (runes / techs still work).
        for (const u of this.host.placement.allUnits()) {
            if (u.type.structure || u.type.fixture) continue;
            u.deployedRound = 0;
        }
    }

    private clearFieldUnits(): void {
        for (const u of [...this.host.placement.allUnits()]) {
            if (u.type.structure || u.type.fixture) continue;
            this.host.placement.removeUnit(u);
        }
    }

    /** Round 3 opens on a bare field — every building comes down first. */
    private clearStructures(): void {
        for (const u of [...this.host.placement.allUnits()]) {
            if (u.type.structure || u.type.fixture) {
                this.host.placement.removeUnit(u);
            }
        }
    }

    // ------------------------------------------------------------- selection

    private playerStronghold(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.type === this.STRONGHOLD && u.team === 'player' && !u.destroyed);
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
            .find((u) => u.type === this.COMMAND_TOWER && u.team === 'player' && !u.destroyed);
    }

    private ensurePlayerCommandTowerSelected(): void {
        const tower = this.playerCommandTower();
        if (!tower) return;
        if (this.host.placement.selectedUnit?.id === tower.id) return;
        this.host.placement.selectUnit(tower);
        this.host.hud.openUnitDetails();
    }

    private playerGarrison(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.type === this.RESEARCH_CENTER && u.team === 'player' && !u.destroyed);
    }

    private ensurePlayerGarrisonSelected(): void {
        const g = this.playerGarrison();
        if (!g) return;
        if (this.host.placement.selectedUnit?.id === g.id) return;
        this.host.placement.selectUnit(g);
        this.host.hud.openUnitDetails();
    }

    private playerArcher(): Unit | undefined {
        return this.host.placement
            .allUnits()
            .find((u) => u.seat === this.host.humanSeat && u.type.id === TUTORIAL_ARCHER_ID && !u.destroyed);
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
        this.sync4();
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
                    u.seat === this.host.humanSeat && u.type.id === TUTORIAL_DWARF_ID && !u.type.structure,
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
                u.type.id === TUTORIAL_DWARF_ID &&
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
            this.STRONGHOLD.footprint,
            'player',
        );
        host.placement.spawn(
            this.STRONGHOLD,
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
            .some((u) => u.type === this.STRONGHOLD && u.team === 'enemy' && !u.destroyed);
        if (exists) return;
        // Same anchors as a normal match — back of the enemy zone, centered.
        const cell = tutorialBaseCell(
            host.map,
            BASE_ANCHORS.stronghold.xFrac,
            BASE_ANCHORS.stronghold.rowFrac,
            this.STRONGHOLD.footprint,
            'enemy',
        );
        host.placement.spawn(
            this.STRONGHOLD,
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
        host.unlockedUnits[enemySeat] = round === 3 ? [TUTORIAL_DWARF_ID] : [TUTORIAL_DWARF_ID, TUTORIAL_ARCHER_ID];
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
            .find((u) => u.type === this.STRONGHOLD && u.team === 'enemy' && !u.destroyed);
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

    // ------------------------------------------------------------ tutorial 3 / 4

    private setupRound3(round: number): void {
        const host = this.host;
        // Round 1 pads come from maybeStartGuide; R3/R4 replace them here.
        const slots = setupTutorial3Round(host, round, {
            garrison: this.RESEARCH_CENTER,
            vanguard: this.COMMAND_TOWER,
        });
        if (round === 1) {
            this.placeSlots3 = [tutorial3DwarfSlot(host.map), tutorial3BallistaSlot(host.map)];
        } else {
            this.placeSlots3 = slots;
        }
        if (round >= 2) {
            if (!this.guide3 || this.guide3.currentStep === 'done') {
                this.guide3?.destroy();
                this.guide3 = this.newGuide3(this.mount());
            }
            host.placement.deselect();
            this.guide3.startRound(round);
        }
        this.sync3();
    }

    private setupRound4(round: number): void {
        const host = this.host;
        setupTutorial4Round(host, round, this.STRONGHOLD);
        if (round >= 2) {
            if (!this.guide4 || this.guide4.currentStep === 'done') {
                this.guide4?.destroy();
                this.guide4 = this.newGuide4(this.mount());
            }
            host.placement.deselect();
            this.guide4.startRound(round);
        }
        this.sync4();
    }

    private setupRound5(round: number): void {
        setupTutorial5Round(this.host, round);
        this.sync5();
    }

    private board3(): Tutorial3BoardState {
        return boardState3(
            this.host,
            this.placeSlots3,
            this.RESEARCH_CENTER,
            this.COMMAND_TOWER,
        );
    }

    private board4(): Tutorial4BoardState {
        return boardState4(this.host, this.STRONGHOLD);
    }

    sync3(): void {
        if (!this.guide3 || this.lesson !== TUTORIAL_3_ID) return;
        const prev = this.guide3.currentStep;
        this.guide3.syncFromBoard(this.board3());
        // After the first two L2 dwarves, force a fresh Garrison click for +1 slot.
        if (prev === 'r3BuyTwo' && this.guide3.currentStep === 'r3SelectGarrisonAgain') {
            this.host.placement.deselect();
        }
        this.refresh3Zones();
        this.host.updateSelectionUi();
    }

    sync4(): void {
        if (!this.guide4 || this.lesson !== TUTORIAL_4_ID) return;
        this.guide4.syncFromBoard(this.board4());
        this.refresh4Zones();
        this.host.updateSelectionUi();
    }

    private board5(): Tutorial5BoardState {
        return { round: this.host.round };
    }

    sync5(): void {
        if (!this.guide5 || this.lesson !== TUTORIAL_5_ID) return;
        this.guide5.syncFromBoard(this.board5());
        this.host.updateSelectionUi();
    }

    private refresh3Zones(): void {
        const host = this.host;
        const guide = this.guide3;
        if (this.lesson !== TUTORIAL_3_ID || !guide) {
            host.placement.clearTutorialTargets();
            return;
        }
        const state = this.board3();
        if (host.round === 1) {
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
            if (targets.length === 0) host.placement.clearTutorialTargets();
            else host.placement.setTutorialPlaceTargets(targets);
            return;
        }
        if (host.round === 3) {
            const step = guide.currentStep;
            if (step === 'r3BuyTwo') {
                host.placement.setTutorialPlaceTargets(
                    r3PadTargets(this.placeSlots3, state.r3PadsFilled, 2),
                );
            } else if (step === 'r3BuyThird' || step === 'r3End') {
                host.placement.setTutorialPlaceTargets(
                    r3PadTargets(this.placeSlots3, state.r3PadsFilled, 3),
                );
            } else {
                host.placement.clearTutorialTargets();
            }
            return;
        }
        if (host.round === 4) {
            const step = guide.currentStep;
            const slot = this.placeSlots3[0];
            if (slot && (step === 'r4PlaceMortar' || step === 'r4End' || step === 'r4BuyMortar')) {
                host.placement.setTutorialPlaceTargets([
                    mortarPadTarget(slot, state.mortarPlaced),
                ]);
            } else {
                host.placement.clearTutorialTargets();
            }
            return;
        }
        host.placement.clearTutorialTargets();
    }

    private refresh4Zones(): void {
        const host = this.host;
        const guide = this.guide4;
        if (this.lesson !== TUTORIAL_4_ID || !guide) {
            host.placement.clearTutorialTargets();
            return;
        }
        if (host.round === 1) {
            const step = guide.currentStep;
            const assignMatch = /^r1Assign(\d)$/.exec(step);
            if (assignMatch) {
                const i = Number(assignMatch[1]);
                const lesson = TUTORIAL_4_RUNE_LESSON[i];
                const army = tutorial4MirroredArmy(host.map, 'player');
                const pack = lesson ? army[lesson.packIndex] : undefined;
                if (pack) {
                    const type = host.types.byId(pack.typeId);
                    const fp = type?.footprint ?? { cols: 2, rows: 2 };
                    host.placement.setTutorialPlaceTargets([
                        { anchor: pack.cell, cols: fp.cols, rows: fp.rows, filled: false },
                    ]);
                    return;
                }
            }
            host.placement.clearTutorialTargets();
            return;
        }
        if (host.round === 3) {
            const step = guide.currentStep;
            if (step === 'r3Apply' || step === 'r3End') {
                const cell = tutorial4OgreCell(host.map, 'player');
                const type = host.types.byId(TUTORIAL_OGRE_ID);
                const fp = type?.footprint ?? { cols: 2, rows: 2 };
                host.placement.setTutorialPlaceTargets([
                    { anchor: cell, cols: fp.cols, rows: fp.rows, filled: false },
                ]);
                return;
            }
            host.placement.clearTutorialTargets();
            return;
        }
        host.placement.clearTutorialTargets();
    }

    /** No hammer lesson in Tutorial 4 anymore — keep the hook for game.ts. */
    hammerPointClick(_ground: { x: number; z: number }): { x: number; z: number } | 'miss' | null {
        return null;
    }

    get boostLessonOnly(): boolean {
        return this.lesson === TUTORIAL_3_ID && this.host.round === 2;
    }

    soleTechFor(unit: Unit): string | null {
        return this.lesson === TUTORIAL_4_ID &&
            this.host.round === 4 &&
            unit.type.id === TUTORIAL_ARCHER_ID
            ? TUTORIAL_4_ARCHER_RANGE_TECH
            : null;
    }

    private nudge(message: string): void {
        (this.guide1 ?? this.guide2 ?? this.guide3 ?? this.guide4 ?? this.guide5)?.nudge(message);
    }

    syncFromBoard(): void {
        this.sync1();
        this.sync2();
        this.sync3();
        this.sync4();
        this.sync5();
    }

    onPlayerEndedDeployment(): void {
        this.guide1?.onPlayerEndedDeployment();
        this.guide2?.onPlayerEndedDeployment();
        this.guide3?.onPlayerEndedDeployment();
        this.guide4?.onPlayerEndedDeployment();
        this.guide5?.onPlayerEndedDeployment();
        this.host.placement.clearTutorialTargets();
    }

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
                    if (!state.recruitActive) {
                        this.guide3.nudge(t('tutorial:tutorial3NudgeRecruit'));
                    } else if (state.r3PadsFilled < 2) {
                        this.guide3.nudge(
                            t('tutorial:tutorial3NudgeDwarves', {
                                filled: state.r3PadsFilled,
                                need: 2,
                            }),
                        );
                    } else if (state.deployExtra < 1) {
                        this.guide3.nudge(t('tutorial:tutorial3NudgeSlot'));
                    } else {
                        this.guide3.nudge(
                            t('tutorial:tutorial3NudgeDwarves', {
                                filled: state.r3PadsFilled,
                                need: TUTORIAL_3_R3_DWARVES,
                            }),
                        );
                    }
                } else if (state.towerLevel < TUTORIAL_3_R4_TOWER_LEVEL) {
                    this.guide3.nudge(
                        t('tutorial:tutorial3NudgeUpgrade', {
                            level: state.towerLevel,
                            max: TUTORIAL_3_R4_TOWER_LEVEL,
                        }),
                    );
                } else {
                    this.guide3.nudge(t('tutorial:tutorial3NudgeMortar'));
                }
                return false;
            }
        }
        if (this.lesson === TUTORIAL_4_ID && this.guide4) {
            const state = this.board4();
            if (!this.guide4.canEndDeploy(state)) {
                if (state.round === 1) this.guide4.nudge(t('tutorial:tutorial4NudgeRune'));
                else if (state.round === 2) this.guide4.nudge(t('tutorial:tutorial4NudgeForge'));
                else if (state.round === 3) this.guide4.nudge(t('tutorial:tutorial4NudgeApply'));
                else this.guide4.nudge(t('tutorial:tutorial4NudgeLongbow'));
                return false;
            }
        }
        if (this.lesson === TUTORIAL_5_ID && this.guide5) {
            const state = this.board5();
            if (!this.guide5.canEndDeploy(state)) {
                this.guide5.nudge(t('tutorial:tutorial5NudgeHeight'));
                return false;
            }
        }
        return true;
    }

    blocksBuyEarly(_type: UnitType): boolean {
        if (this.lesson === TUTORIAL_2_ID && this.host.round < 3) {
            this.guide2?.nudge(t('tutorial:tutorial2NudgeNoShop'));
            return true;
        }
        if (this.lesson === TUTORIAL_3_ID) {
            const round = this.host.round;
            if (round === 2) {
                this.guide3?.nudge(t('tutorial:tutorial3NudgeNoShop'));
                return true;
            }
            if (round === 3) {
                const step = this.guide3?.currentStep;
                if (
                    step === 'r3Intro' ||
                    step === 'r3SelectGarrison' ||
                    step === 'r3Recruit' ||
                    step === 'r3SelectGarrisonAgain' ||
                    step === 'r3DeploySlot'
                ) {
                    this.guide3?.nudge(t('tutorial:tutorial3NudgeGarrison'));
                    return true;
                }
            }
            if (round === 4) {
                const step = this.guide3?.currentStep;
                if (step === 'r4Intro' || step === 'r4SelectTower' || step === 'r4Upgrade') {
                    this.guide3?.nudge(
                        t('tutorial:tutorial3NudgeUpgrade', {
                            level: this.board3().towerLevel,
                            max: TUTORIAL_3_R4_TOWER_LEVEL,
                        }),
                    );
                    return true;
                }
            }
            if (round === 1) {
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
        }
        if (this.lesson === TUTORIAL_4_ID) {
            const round = this.host.round;
            if (round === 1 || round === 2) return false; // rune shop
            if (round >= 3) {
                this.guide4?.nudge(t('tutorial:tutorial3NudgeNoShop'));
                return true;
            }
        }
        return false;
    }

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

    blocksBuyRune(): boolean {
        if (this.lesson === TUTORIAL_4_ID && (this.host.round === 1 || this.host.round === 2)) {
            return false;
        }
        this.nudge(t('tutorial:tutorialNudgeRunes'));
        return true;
    }

    blocksBuyTech(techId: string): boolean {
        if (
            this.lesson !== TUTORIAL_4_ID ||
            this.host.round !== 4 ||
            techId === TUTORIAL_4_ARCHER_RANGE_TECH
        ) {
            return false;
        }
        this.guide4?.nudge(t('tutorial:tutorial4NudgeLongbow'));
        return true;
    }

    // --------------------------------------------------------- round outcome

    /** Battles this lesson must win to finish (Tutorial 1 is a single round). */
    private get roundsToWin(): number {
        if (this.lesson === TUTORIAL_5_ID) return TUTORIAL_5_ROUNDS;
        if (this.lesson === TUTORIAL_4_ID) return TUTORIAL_4_ROUNDS;
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
