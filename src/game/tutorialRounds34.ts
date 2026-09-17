/**
 * Round staging helpers for Tutorials 3–4 (kept out of tutorialRuntime so the
 * lesson boards stay readable).
 */
import { primarySeatOf, type SeatDef, type SeatId } from './seats';
import { BASE_ANCHORS, type BattleMap } from './map';
import { HAMMER_ID, type SpellStamp } from './tactics';
import { resolveForge, type ForgeSlot } from './forgeRecipes';
import type { Economy, GameSettings } from './settings';
import type { TechTree } from './tech';
import type { Hud } from '../ui/hud';
import type { PlacementController } from './placement';
import type { TypeRegistry } from './content/typeRegistry';
import {
    cellEq,
    tutorial3CenterDwarfCell,
    tutorial3R3DwarfSlots,
    tutorial3R4MortarSlot,
    tutorial4CenterArcherCells,
    tutorial4HammerZone,
    tutorial4MirroredArmy,
    tutorialBaseCell,
    tutorialDwarfFootprint,
    tutorialMortarFootprint,
    unitMatchesTutorialSlot,
    TUTORIAL_4_ARCHER_RANGE_TECH,
    TUTORIAL_4_ARCHERS,
    TUTORIAL_4_FORGE_PRODUCT,
    TUTORIAL_4_RUNE_LESSON,
    TUTORIAL_ARCHER_ID,
    TUTORIAL_BALLISTA_ID,
    TUTORIAL_DWARF_ID,
    TUTORIAL_MORTAR_ID,
    type TutorialPlaceSlot,
} from './tutorial';
import type { Tutorial3BoardState } from '../ui/tutorialGuide3';
import type { Tutorial4BoardState } from '../ui/tutorialGuide4';
import type { Unit, UnitType } from './units';

/** Narrow host slice used by round staging (avoids circular import with runtime). */
export interface TutorialRoundHost {
    readonly types: TypeRegistry;
    readonly settings: GameSettings;
    readonly map: BattleMap;
    readonly placement: PlacementController;
    readonly economy: Economy;
    readonly techTree: TechTree;
    readonly hud: Hud;
    readonly seats: SeatDef[];
    readonly humanSeat: SeatId;
    readonly round: number;
    readonly unlockedUnits: string[][];
    readonly deployState: {
        limit: number[];
        runesBought: number[];
        extra: number[];
    };
    readonly boostState: Record<'attack' | 'hp', number[]>;
    readonly tacticInventory: string[][];
    readonly spellStamps: SpellStamp[];
    readonly armedTactic: string | null;
    readonly recruitLevel: number[];
    readonly itemInventory: string[][];
    readonly forgeSlots: Record<'player' | 'enemy', (ForgeSlot | null)[]>;
    readonly armedItem: string | null;
    refreshShopHud(): void;
}

export function creditSeat(host: TutorialRoundHost, seat: number, need: number): void {
    const have = host.economy.balance(seat);
    if (have < need) host.economy.credit(seat, need - have);
}

export function setUnitLevel(unit: Unit, level: number): void {
    unit.level = level;
    unit.refreshLevelBadge();
}

export function spawnBuilding(
    host: TutorialRoundHost,
    type: UnitType,
    xFrac: number,
    rowFrac: number,
    side: 'player' | 'enemy',
): Unit | null {
    return host.placement.spawn(
        type,
        tutorialBaseCell(host.map, xFrac, rowFrac, type.footprint, side),
        side,
        false,
        false,
        primarySeatOf(host.seats, side),
    );
}

/** Garrison + Vanguard for one or both sides. */
export function spawnGarrisonVanguard(
    host: TutorialRoundHost,
    garrison: UnitType,
    vanguard: UnitType,
    team: 'player' | 'enemy' | 'both',
): void {
    const sides: ('player' | 'enemy')[] = team === 'both' ? ['player', 'enemy'] : [team];
    for (const side of sides) {
        const standing = (type: UnitType) =>
            host.placement.allUnits().some((u) => u.type === type && u.team === side && !u.destroyed);
        if (!standing(garrison)) {
            spawnBuilding(host, garrison, BASE_ANCHORS.research.xFrac, BASE_ANCHORS.research.rowFrac, side);
        }
        if (!standing(vanguard)) {
            spawnBuilding(host, vanguard, BASE_ANCHORS.command.xFrac, BASE_ANCHORS.command.rowFrac, side);
        }
    }
}

export function spawnPlayerStronghold(
    host: TutorialRoundHost,
    stronghold: UnitType,
    rowFrac = BASE_ANCHORS.stronghold.rowFrac,
): void {
    const exists = host.placement
        .allUnits()
        .some((u) => u.type === stronghold && u.team === 'player' && !u.destroyed);
    if (exists) return;
    spawnBuilding(host, stronghold, BASE_ANCHORS.stronghold.xFrac, rowFrac, 'player');
}

export function clearFieldUnits(host: TutorialRoundHost): void {
    for (const u of [...host.placement.allUnits()]) {
        if (u.type.structure || u.type.fixture) continue;
        host.placement.removeUnit(u);
    }
}

export function clearStructures(host: TutorialRoundHost): void {
    for (const u of [...host.placement.allUnits()]) {
        if (u.type.structure || u.type.fixture) host.placement.removeUnit(u);
    }
}

export function freezeFieldPacks(host: TutorialRoundHost): void {
    for (const u of host.placement.allUnits()) {
        if (u.type.structure || u.type.fixture) continue;
        u.deployedRound = 0;
    }
}

export function setupTutorial3Round(
    host: TutorialRoundHost,
    round: number,
    types: { garrison: UnitType; vanguard: UnitType },
): TutorialPlaceSlot[] {
    const human = host.humanSeat;
    const enemy = primarySeatOf(host.seats, 'enemy');
    host.unlockedUnits[enemy] = [TUTORIAL_DWARF_ID, TUTORIAL_ARCHER_ID];
    creditSeat(host, enemy, 2500);

    let placeSlots: TutorialPlaceSlot[] = [];

    if (round === 1) {
        spawnGarrisonVanguard(host, types.garrison, types.vanguard, 'enemy');
        host.unlockedUnits[human] = [TUTORIAL_DWARF_ID, TUTORIAL_BALLISTA_ID];
        host.deployState.limit[human] = 2;
        host.deployState.limit[enemy] = 2;
        host.hud.setShopColumnVisible(true);
        host.hud.setShopRunesVisible(false);
        creditSeat(host, human, 1500);
    } else if (round === 2) {
        spawnGarrisonVanguard(host, types.garrison, types.vanguard, 'both');
        const dwarf = host.types.byId(TUTORIAL_DWARF_ID);
        if (dwarf) {
            host.placement.spawn(dwarf, tutorial3CenterDwarfCell(host.map), 'player', false, true, human);
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = 1;
        host.hud.setShopColumnVisible(false);
        host.hud.setShopRunesVisible(false);
        creditSeat(host, human, 2 * host.settings.boosts.costs.reduce((s, c) => s + c, 0));
    } else if (round === 3) {
        // R2's Vanguard boosts are permanent in normal play — clear them so
        // this round teaches Garrison alone.
        host.boostState.attack.fill(0);
        host.boostState.hp.fill(0);
        spawnGarrisonVanguard(host, types.garrison, types.vanguard, 'both');
        placeSlots = tutorial3R3DwarfSlots(host.map);
        host.unlockedUnits[human] = [TUTORIAL_DWARF_ID];
        host.deployState.limit[human] = 2; // base 2; +1 slot bought in-lesson
        host.deployState.limit[enemy] = 2;
        host.hud.setShopColumnVisible(true);
        host.hud.setShopRunesVisible(false);
        // Veteran (100) + slot (50) + 3× dwarf with L2 premium
        creditSeat(host, human, 2000);
    } else {
        // R4: player Garrison only — wipe leftover towers/boosts from R3.
        host.boostState.attack.fill(0);
        host.boostState.hp.fill(0);
        clearStructures(host);
        spawnBuilding(
            host,
            types.garrison,
            BASE_ANCHORS.research.xFrac,
            BASE_ANCHORS.research.rowFrac,
            'player',
        );
        placeSlots = [tutorial3R4MortarSlot(host.map)];
        host.unlockedUnits[human] = [TUTORIAL_MORTAR_ID];
        host.deployState.limit[human] = 1;
        host.deployState.limit[enemy] = 2;
        host.hud.setShopColumnVisible(true);
        host.hud.setShopRunesVisible(false);
        // upgrades to L5 (100+150+200+250) + mortar 200
        creditSeat(host, human, 1500);
    }
    host.refreshShopHud();
    return placeSlots;
}

export function setupTutorial4Round(
    host: TutorialRoundHost,
    round: number,
    stronghold: UnitType,
): void {
    const human = host.humanSeat;
    const enemy = primarySeatOf(host.seats, 'enemy');
    host.unlockedUnits[enemy] = [TUTORIAL_DWARF_ID, TUTORIAL_ARCHER_ID];
    creditSeat(host, enemy, 2500);

    // Force Longbow onto human archer loadout for talent round
    const seatEntry = host.seats[human];
    if (seatEntry?.loadout && round === 4) {
        const archerTechs = [...(seatEntry.loadout.techs.archer ?? [])];
        if (!archerTechs.includes(TUTORIAL_4_ARCHER_RANGE_TECH)) {
            host.seats[human] = {
                ...seatEntry,
                loadout: {
                    techs: {
                        ...seatEntry.loadout.techs,
                        archer: [TUTORIAL_4_ARCHER_RANGE_TECH, ...archerTechs].slice(0, 3),
                    },
                },
            };
        }
    }

    if (round === 1) {
        clearStructures(host);
        for (const pack of tutorial4MirroredArmy(host.map, 'player')) {
            const type = host.types.byId(pack.typeId);
            if (type) host.placement.spawn(type, pack.cell, 'player', false, true, human);
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = 4;
        host.hud.setShopColumnVisible(true);
        host.hud.setShopRunesVisible(true);
        creditSeat(host, human, 800);
    } else if (round === 2) {
        clearFieldUnits(host);
        clearStructures(host);
        spawnPlayerStronghold(host, stronghold);
        // Pre-stage mirrored army again for forge context (optional visual)
        for (const pack of tutorial4MirroredArmy(host.map, 'player')) {
            const type = host.types.byId(pack.typeId);
            if (type) host.placement.spawn(type, pack.cell, 'player', false, true, human);
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = 4;
        host.hud.setShopColumnVisible(true);
        host.hud.setShopRunesVisible(true);
        creditSeat(host, human, 600);
    } else if (round === 3) {
        clearFieldUnits(host);
        // Keep stronghold if present; clear otherwise re-spawn none needed for apply
        clearStructures(host);
        for (const pack of tutorial4MirroredArmy(host.map, 'player')) {
            const type = host.types.byId(pack.typeId);
            if (type) host.placement.spawn(type, pack.cell, 'player', false, true, human);
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = 4;
        host.hud.setShopColumnVisible(false);
        host.hud.setShopRunesVisible(false);
        creditSeat(host, human, 200);
    } else if (round === 4) {
        clearFieldUnits(host);
        clearStructures(host);
        const type = host.types.byId(TUTORIAL_ARCHER_ID);
        if (type) {
            for (const cell of tutorial4CenterArcherCells(host.map, 'player', TUTORIAL_4_ARCHERS)) {
                host.placement.spawn(type, cell, 'player', false, true, human);
            }
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = TUTORIAL_4_ARCHERS;
        host.hud.setShopColumnVisible(false);
        host.hud.setShopRunesVisible(false);
        creditSeat(host, human, 400);
    } else {
        clearFieldUnits(host);
        clearStructures(host);
        const type = host.types.byId(TUTORIAL_ARCHER_ID);
        if (type) {
            for (const cell of tutorial4CenterArcherCells(host.map, 'player', TUTORIAL_4_ARCHERS)) {
                host.placement.spawn(type, cell, 'player', false, true, human);
            }
        }
        host.unlockedUnits[human] = [];
        host.deployState.limit[human] = 0;
        host.deployState.limit[enemy] = TUTORIAL_4_ARCHERS;
        host.hud.setShopColumnVisible(false);
        host.hud.setShopRunesVisible(false);
        // Grant Hammer of the Gods
        const bag = host.tacticInventory[human]!;
        if (!bag.includes(HAMMER_ID)) bag.push(HAMMER_ID);
        creditSeat(host, human, 200);
    }
    host.refreshShopHud();
}

export function boardState3(
    host: TutorialRoundHost,
    placeSlots: TutorialPlaceSlot[],
    garrisonType: UnitType,
    vanguardType: UnitType,
): Tutorial3BoardState {
    const own = host.placement
        .allUnits()
        .filter((u) => u.seat === host.humanSeat && !u.type.structure);
    const dwarves = own.filter((u) => u.type.id === TUTORIAL_DWARF_ID);
    const ballistas = own.filter((u) => u.type.id === TUTORIAL_BALLISTA_ID);
    const mortars = own.filter((u) => u.type.id === TUTORIAL_MORTAR_ID);
    const selected = host.placement.selectedUnit;
    const garrison = host.placement
        .allUnits()
        .find((u) => u.type === garrisonType && u.team === 'player' && !u.destroyed);
    const vanguard = host.placement
        .allUnits()
        .find((u) => u.type === vanguardType && u.team === 'player' && !u.destroyed);
    const dwarfSlot = placeSlots[0];
    const ballistaSlot = placeSlots[1];
    const mortarSlot = placeSlots[0];
    let r3PadsFilled = 0;
    if (host.round === 3) {
        for (const slot of placeSlots) {
            if (dwarves.some((u) => unitMatchesTutorialSlot(u, slot))) r3PadsFilled++;
        }
    }
    return {
        round: host.round,
        dwarfCount: dwarves.length,
        ballistaCount: ballistas.length,
        mortarCount: mortars.length,
        dwarfPlaced: !!dwarfSlot && dwarves.some((u) => unitMatchesTutorialSlot(u, dwarfSlot)),
        ballistaPlaced:
            !!ballistaSlot && ballistas.some((u) => cellEq(u.cell, ballistaSlot.anchor)),
        r3PadsFilled,
        mortarPlaced:
            host.round === 4 &&
            !!mortarSlot &&
            mortars.some((u) => cellEq(u.cell, mortarSlot.anchor)),
        vanguardSelected: !!vanguard && selected?.id === vanguard.id,
        garrisonSelected: !!garrison && selected?.id === garrison.id,
        boostAttack: host.boostState.attack[host.humanSeat]!,
        boostHp: host.boostState.hp[host.humanSeat]!,
        boostMax: host.settings.boosts.costs.length,
        recruitActive: (host.recruitLevel?.[host.humanSeat] ?? 1) > 1,
        deployExtra: host.deployState.extra[host.humanSeat]!,
        towerLevel: garrison?.level ?? 1,
    };
}

export function boardState4(host: TutorialRoundHost, strongholdType: UnitType): Tutorial4BoardState {
    const human = host.humanSeat;
    const own = host.placement
        .allUnits()
        .filter((u) => u.seat === human && !u.type.structure)
        .sort((a, b) => a.cell.col - b.cell.col || a.cell.row - b.cell.row);
    const selected = host.placement.selectedUnit;
    const keep = host.placement
        .allUnits()
        .find((u) => u.type === strongholdType && u.team === 'player' && !u.destroyed);
    const army = tutorial4MirroredArmy(host.map, 'player');
    const runeAssigned = TUTORIAL_4_RUNE_LESSON.map((step) => {
        const expected = army[step.packIndex];
        if (!expected) return false;
        const pack = own.find(
            (u) => u.type.id === expected.typeId && cellEq(u.cell, expected.cell),
        );
        return !!pack?.items.includes(step.runeId);
    });
    const oven = host.forgeSlots?.player ?? [];
    const forgeInserts = oven.filter(Boolean).length;
    const product = resolveForge(host.types, oven, 'all').product;
    const forgeReady = product?.id === TUTORIAL_4_FORGE_PRODUCT;
    const bag = host.itemInventory?.[human] ?? [];
    const forgedOwned = bag.includes(TUTORIAL_4_FORGE_PRODUCT);
    const leftDwarf = army[0]
        ? own.find((u) => u.type.id === TUTORIAL_DWARF_ID && cellEq(u.cell, army[0]!.cell))
        : undefined;
    const forgedApplied = !!leftDwarf?.items.includes(TUTORIAL_4_FORGE_PRODUCT);
    const hammerZone = tutorial4HammerZone(host.map);
    const hammerPlaced = host.spellStamps.some(
        (s) =>
            s.seat === human &&
            s.tacticId === HAMMER_ID &&
            (s.x - hammerZone.x) ** 2 + (s.z - hammerZone.z) ** 2 <=
                (hammerZone.radius * 1.2) ** 2,
    );
    return {
        round: host.round,
        runeAssigned,
        armedRuneId: host.armedItem,
        forgeReady,
        forgeInserts,
        forgedOwned,
        forgedApplied,
        archerSelected:
            !!selected && selected.seat === human && selected.type.id === TUTORIAL_ARCHER_ID,
        longbowOwned: host.techTree.has(human, TUTORIAL_ARCHER_ID, TUTORIAL_4_ARCHER_RANGE_TECH),
        hammerArmed: host.armedTactic === HAMMER_ID,
        hammerPlaced,
        keepSelected: !!keep && selected?.id === keep.id,
    };
}

export function r3PadTargets(
    placeSlots: TutorialPlaceSlot[],
    filled: number,
    visibleCount = placeSlots.length,
): { anchor: { col: number; row: number }; cols: number; rows: number; filled?: boolean }[] {
    const fp = tutorialDwarfFootprint(false);
    return placeSlots.slice(0, visibleCount).map((slot, i) => ({
        anchor: slot.anchor,
        cols: fp.cols,
        rows: fp.rows,
        filled: i < filled,
    }));
}

export function mortarPadTarget(
    slot: TutorialPlaceSlot,
    placed: boolean,
): { anchor: { col: number; row: number }; cols: number; rows: number; filled?: boolean } {
    const fp = tutorialMortarFootprint(false);
    return { anchor: slot.anchor, cols: fp.cols, rows: fp.rows, filled: placed };
}

// silence unused in case tree-shaken differently
