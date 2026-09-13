import type { Action } from './actions';
import { TUTORIAL_2_START_CARD, TUTORIAL_3_START_CARD, TUTORIAL_START_CARD, type RoundCard, type SpecialityId, type StartCard } from './cards';
import type { Opponent } from './ai';
import type { PlacementController } from './placement';
import type { DeploySettings, Economy } from './settings';
import type { TechTree } from './tech';
import type { Loadout } from './techCatalog';
import type { Team, UnitType } from './units';
import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import type { Cell } from './map';
import { TUTORIAL_1_ID, TUTORIAL_2_ID, TUTORIAL_3_ID, tutorial3CenterArcherCells, tutorial3MirroredArmy } from './tutorial';

/**
 * Tutorial-mode opponent. One file owns every lesson's AI behaviour so later
 * tutorials can branch here without growing AiOpponent.
 */
export class TutorialAi implements Opponent {
    constructor(
        private readonly team: Team,
        private readonly seat: SeatId,
        private readonly tutorialLessonId: number,
        private readonly ctx: {
            /** the unit and building definitions this match plays with */
            types: TypeRegistry;
            dispatch: (action: Action) => boolean;
            placement: PlacementController;
            economy: Economy;
            techTree: TechTree;
            unlockedUnits: string[][];
            unlockUsedThisRound: boolean[];
            items: string[][];
            tactics: string[][];
            speciality: (SpecialityId | null)[];
            rng: () => number;
            loadoutOf: (seat: SeatId) => Loadout | undefined;
            deploySettings: DeploySettings;
            forgeSpellOwned: string[][];
            forgeSpellsOf: (seat: SeatId) => readonly string[] | undefined;
            climb?: boolean;
            rngForRound?: (round: number) => () => number;
        },
    ) {}

    chooseStarter(_offer: readonly StartCard[]): void {
        const cardId =
            this.tutorialLessonId === TUTORIAL_2_ID
                ? TUTORIAL_2_START_CARD.id
                : this.tutorialLessonId === TUTORIAL_3_ID
                  ? TUTORIAL_3_START_CARD.id
                  : TUTORIAL_START_CARD.id;
        this.ctx.dispatch({
            kind: 'chooseCard',
            team: this.team,
            seat: this.seat,
            cardId,
        });
    }

    onRoundCards(_offer: readonly RoundCard[]): void {
        this.ctx.dispatch({
            kind: 'roundCard',
            team: this.team,
            seat: this.seat,
            cardId: null,
        });
    }

    onBuildPhase(round: number): void {
        if (this.tutorialLessonId === TUTORIAL_1_ID) {
            this.runTutorial1(round);
            return;
        }
        if (this.tutorialLessonId === TUTORIAL_2_ID) {
            this.runTutorial2(round);
            return;
        }
        if (this.tutorialLessonId === TUTORIAL_3_ID) {
            this.runTutorial3(round);
            return;
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /** Tutorial 1: four archers near the middle of the enemy zone, then lock in. */
    private runTutorial1(round: number): void {
        if (round === 1) {
            this.ctx.unlockedUnits[this.seat] = ['archer'];
            const type = this.ctx.types.byId('archer');
            if (type) this.placeNearCenter(type, 4);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /** Tutorial 2: center-lane waves; round 3 adds a heavy assault from the left. */
    private runTutorial2(round: number): void {
        if (round === 1) {
            const dwarf = this.ctx.types.byId('dwarf');
            if (dwarf) this.placeNearCenter(dwarf, 1);
        } else if (round === 2) {
            const dwarf = this.ctx.types.byId('dwarf');
            const archer = this.ctx.types.byId('archer');
            if (dwarf) this.placeNearCenter(dwarf, 5);
            if (archer) this.placeNearCenter(archer, 7);
        } else if (round === 3) {
            const dwarf = this.ctx.types.byId('dwarf');
            // Left border only — no archers, so the right-back stays clear for
            // the player's summon and the keep fight stays melee.
            if (dwarf) this.placeAtBorderLeft(dwarf, 6);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    /**
     * Tutorial 3: round 1 stacks the left flank (leaving the right tower
     * exposed), round 2 fields the single center pack the boost lesson is
     * measured against, round 3 brings the mirrored rune army, round 4 the
     * center archer line for Longbow.
     */
    private runTutorial3(round: number): void {
        const dwarf = this.ctx.types.byId('dwarf');
        const archer = this.ctx.types.byId('archer');
        if (round === 1) {
            if (dwarf) this.placeAtBorderLeft(dwarf, 2, /* deeper */ 1);
        } else if (round === 2) {
            if (dwarf) this.placeNearCenter(dwarf, 1);
        } else if (round === 3) {
            for (const pack of tutorial3MirroredArmy(this.ctx.placement.map, 'enemy')) {
                const type = this.ctx.types.byId(pack.typeId);
                if (type) this.buyAt(type, pack.cell);
            }
        } else if (round === 4) {
            for (const cell of tutorial3CenterArcherCells(this.ctx.placement.map, 'enemy')) {
                if (archer) this.buyAt(archer, cell);
            }
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    private placeNearCenter(type: UnitType, count: number): void {
        let placed = 0;
        for (const anchor of this.centerCandidates(type)) {
            if (placed >= count) break;
            if (this.buyAt(type, anchor)) placed++;
        }
        while (placed < count) {
            const spot = this.ctx.placement.findAiSpot(this.team, this.seat, type, this.ctx.rng);
            if (!spot) break;
            if (!this.buyAt(type, spot.anchor, spot.rotated)) break;
            placed++;
        }
    }

    /**
     * Enemy packs on the left side of the shared border.
     * @param deeperCells how many cells to pull back from the absolute front
     *   (Tutorial 3 round 1 uses 1 so the player's facing pad has a little air).
     */
    private placeAtBorderLeft(type: UnitType, count: number, deeperCells = 0): void {
        const map = this.ctx.placement.map;
        const { rimCells, flankCols, zoneCols, zoneRows, neutralRows } = map.size;
        const zoneLeft = rimCells + flankCols;
        const enemyNear = (this.team === 'enemy') === map.ownAtFar;
        const fpCols = type.footprint.cols;
        const fpRows = type.footprint.rows;
        // Player’s left when looking at the enemy = lower col (+X is right).
        const leftCol = zoneLeft + 2;
        const borderRow = enemyNear
            ? rimCells + zoneRows - fpRows - 1 - deeperCells
            : rimCells + zoneRows + neutralRows + 1 + deeperCells;
        const stepC = fpCols + 1;
        const stepR = fpRows + 1;
        const rowDir = enemyNear ? -1 : 1; // stack slightly deeper into enemy half
        let placed = 0;
        for (let i = 0; i < 20 && placed < count; i++) {
            const anchor: Cell = {
                col: leftCol + (i % 3) * stepC,
                row: borderRow + Math.floor(i / 3) * stepR * rowDir,
            };
            // Stay in the left half so we don’t spill toward the summon.
            if (anchor.col > zoneLeft + Math.floor(zoneCols * 0.45)) continue;
            if (this.buyAt(type, anchor)) placed++;
        }
        this.placeNearCenter(type, count - placed);
    }

    private buyAt(type: UnitType, anchor: Cell, rotated = false): boolean {
        return this.ctx.dispatch({
            kind: 'buy',
            team: this.team,
            seat: this.seat,
            typeId: type.id,
            anchor,
            rotated,
        });
    }

    private centerCandidates(type: UnitType): Cell[] {
        const map = this.ctx.placement.map;
        const fpCols = type.footprint.cols;
        const fpRows = type.footprint.rows;
        const midCol = Math.floor((map.cols - fpCols) / 2);
        const enemyNear = (this.team === 'enemy') === map.ownAtFar;
        const frontRow = enemyNear
            ? map.size.rimCells + map.size.zoneRows - fpRows - 2
            : map.rows - map.size.rimCells - map.size.zoneRows + 2;
        const stepC = fpCols + 1;
        const stepR = fpRows + 1;
        const rowDir = enemyNear ? -1 : 1;
        const out: Cell[] = [];
        for (const dr of [0, rowDir, -rowDir]) {
            for (const dc of [0, -stepC, stepC, -2 * stepC, 2 * stepC]) {
                out.push({ col: midCol + dc, row: frontRow + dr * stepR });
            }
        }
        return out;
    }
}
