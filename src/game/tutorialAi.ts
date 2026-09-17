import type { Action } from './actions';
import {
    TUTORIAL_2_START_CARD_ID,
    TUTORIAL_3_START_CARD_ID,
    TUTORIAL_4_START_CARD_ID,
    TUTORIAL_START_CARD_ID,
    type RoundCard,
    type SpecialityId,
    type StartCard,
} from './cards';
import type { Opponent } from './ai';
import type { PlacementController } from './placement';
import type { DeploySettings, Economy } from './settings';
import type { TechTree } from './tech';
import type { Loadout } from './techCatalog';
import type { Team, UnitType } from './units';
import type { TypeRegistry } from './content/typeRegistry';
import type { SeatId } from './seats';
import type { Cell } from './map';
import {
    TUTORIAL_1_ID,
    TUTORIAL_2_ID,
    TUTORIAL_3_ID,
    TUTORIAL_4_ID,
    TUTORIAL_ARCHER_ID,
    TUTORIAL_DWARF_ID,
    TUTORIAL_OGRE_ID,
    tutorial3R3EnemyDwarfCells,
    tutorial4CenterArcherCells,
    tutorial4MirroredArmy,
    tutorial4OgreCell,
} from './tutorial';
import { setUnitLevel } from './tutorialRounds34';

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
                ? TUTORIAL_2_START_CARD_ID
                : this.tutorialLessonId === TUTORIAL_3_ID
                  ? TUTORIAL_3_START_CARD_ID
                  : this.tutorialLessonId === TUTORIAL_4_ID
                    ? TUTORIAL_4_START_CARD_ID
                    : TUTORIAL_START_CARD_ID;
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
        if (this.tutorialLessonId === TUTORIAL_4_ID) {
            this.runTutorial4(round);
            return;
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    private runTutorial1(round: number): void {
        if (round === 1) {
            this.ctx.unlockedUnits[this.seat] = [TUTORIAL_ARCHER_ID];
            const type = this.ctx.types.byId(TUTORIAL_ARCHER_ID);
            if (type) this.placeNearCenter(type, 4);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    private runTutorial2(round: number): void {
        if (round === 1) {
            const dwarf = this.ctx.types.byId(TUTORIAL_DWARF_ID);
            if (dwarf) this.placeNearCenter(dwarf, 1);
        } else if (round === 2) {
            const dwarf = this.ctx.types.byId(TUTORIAL_DWARF_ID);
            const archer = this.ctx.types.byId(TUTORIAL_ARCHER_ID);
            if (dwarf) this.placeNearCenter(dwarf, 5);
            if (archer) this.placeNearCenter(archer, 7);
        } else if (round === 3) {
            const dwarf = this.ctx.types.byId(TUTORIAL_DWARF_ID);
            if (dwarf) this.placeAtBorderLeft(dwarf, 6);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    private runTutorial3(round: number): void {
        const dwarf = this.ctx.types.byId(TUTORIAL_DWARF_ID);
        if (round === 1) {
            if (dwarf) this.placeAtBorderLeft(dwarf, 2, /* deeper */ 1);
        } else if (round === 2) {
            if (dwarf) this.placeNearCenter(dwarf, 1);
        } else if (round === 3) {
            // Two L2 dwarves on the opposite border, centered on the player's three.
            if (dwarf) {
                for (const cell of tutorial3R3EnemyDwarfCells(this.ctx.placement.map)) {
                    if (this.buyAt(dwarf, cell)) {
                        const u = this.ctx.placement
                            .allUnits()
                            .find(
                                (unit) =>
                                    unit.seat === this.seat &&
                                    unit.type.id === TUTORIAL_DWARF_ID &&
                                    unit.cell.col === cell.col &&
                                    unit.cell.row === cell.row,
                            );
                        if (u) setUnitLevel(u, 2);
                    }
                }
            }
        } else if (round === 4) {
            // Two dwarves chewing the player's Garrison.
            if (dwarf) this.placeAtBorderLeft(dwarf, 2, 0);
        }
        this.ctx.dispatch({ kind: 'endDeployment', team: this.team, seat: this.seat });
    }

    private runTutorial4(round: number): void {
        const archer = this.ctx.types.byId(TUTORIAL_ARCHER_ID);
        if (round === 1 || round === 2) {
            for (const pack of tutorial4MirroredArmy(this.ctx.placement.map, 'enemy')) {
                const type = this.ctx.types.byId(pack.typeId);
                if (type) this.buyAt(type, pack.cell);
            }
        } else if (round === 3) {
            const ogre = this.ctx.types.byId(TUTORIAL_OGRE_ID);
            if (ogre) this.buyAt(ogre, tutorial4OgreCell(this.ctx.placement.map, 'enemy'));
        } else if (round === 4 || round === 5) {
            for (const cell of tutorial4CenterArcherCells(this.ctx.placement.map, 'enemy')) {
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

    private placeAtBorderLeft(type: UnitType, count: number, deeperCells = 0): void {
        const map = this.ctx.placement.map;
        const { rimCells, flankCols, zoneCols, zoneRows, neutralRows } = map.size;
        const zoneLeft = rimCells + flankCols;
        const enemyNear = (this.team === 'enemy') === map.ownAtFar;
        const fpCols = type.footprint.cols;
        const fpRows = type.footprint.rows;
        const leftCol = zoneLeft + 2;
        const borderRow = enemyNear
            ? rimCells + zoneRows - fpRows - 1 - deeperCells
            : rimCells + zoneRows + neutralRows + 1 + deeperCells;
        const stepC = fpCols + 1;
        const stepR = fpRows + 1;
        const rowDir = enemyNear ? -1 : 1;
        let placed = 0;
        for (let i = 0; i < 20 && placed < count; i++) {
            const anchor: Cell = {
                col: leftCol + (i % 3) * stepC,
                row: borderRow + Math.floor(i / 3) * stepR * rowDir,
            };
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
