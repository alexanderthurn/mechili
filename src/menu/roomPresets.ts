/**
 * Room presets: a few ready-made kinds of match for the lobby (Custom Game,
 * Practice). Clicking one writes its values over the room's settings; every
 * other setting keeps what the host picked. All presets set the SAME keys,
 * so switching from one to another never leaves a value of the last behind.
 *
 * A room "is" a preset while its preset keys hold that preset's values — the
 * lobby highlights it, and judges the other settings (the gold "changed"
 * boxes) against it. First tuning; adjust the values here.
 */
import type { CustomGameConfig } from '../game/net';
import { hordeAlgorithmById } from '../game/hordeAlgorithms';
import {
    commanderHpFactorOption,
    moneyFactorOption,
    postedUnitsModeOption,
    resolveFixedSideHp,
    startMoneyOption,
    wallsModeOption,
} from '../game/settings';
import { seasonsModeOption } from '../game/seasons';

export type RoomPresetId = 'standard' | 'siege' | 'komtur';

/** what a preset writes: these keys, and only these */
export type RoomPresetValues = Required<
    Pick<
        CustomGameConfig,
        | 'siege'
        | 'victory'
        | 'hordePreset'
        | 'moneyFactor'
        | 'startMoney'
        | 'commanderHpFactor'
        | 'fixedSideHp'
        | 'walls'
        | 'postedUnits'
        | 'seasons'
    >
>;

export interface RoomPreset {
    id: RoomPresetId;
    values: RoomPresetValues;
}

export const ROOM_PRESETS: readonly RoomPreset[] = [
    {
        // both sides equal, won on hit points, a light Komtur on the side
        id: 'standard',
        values: {
            siege: false,
            victory: 'hp',
            hordePreset: 'low',
            moneyFactor: 1,
            startMoney: 0,
            commanderHpFactor: 1,
            fixedSideHp: null,
            walls: 'normal',
            postedUnits: 'normal',
            seasons: 'randomSeason',
        },
    },
    {
        // an attacker against a defender behind ready walls, a Year of 12 rounds through the
        // seasons — the two of them alone, the archers on the walls only defend
        id: 'siege',
        values: {
            siege: true,
            victory: 'rounds',
            hordePreset: 'off',
            moneyFactor: 1,
            startMoney: 0,
            commanderHpFactor: 1,
            fixedSideHp: null,
            walls: 'prebuilt',
            postedUnits: 'passive',
            seasons: 'year',
        },
    },
    {
        // a standard match against the strongest Komtur: double money, double HP, a head start,
        // and cheap archers on the walls that only defend
        id: 'komtur',
        values: {
            siege: false,
            victory: 'hp',
            hordePreset: 'ultra',
            moneyFactor: 2,
            startMoney: 300,
            commanderHpFactor: 2,
            fixedSideHp: null,
            walls: 'normal',
            postedUnits: 'passiveCheap',
            seasons: 'randomSeason',
        },
    },
];

export const DEFAULT_ROOM_PRESET: RoomPreset = ROOM_PRESETS[0]!;

/** a room's preset keys, read as their stored values resolve (older rooms lack some) */
function presetValuesOf(cfg: Partial<CustomGameConfig>): RoomPresetValues {
    return {
        siege: cfg.siege === true,
        victory: cfg.victory === 'rounds' ? 'rounds' : 'hp',
        hordePreset: hordeAlgorithmById(cfg.hordePreset).id,
        moneyFactor: moneyFactorOption(cfg.moneyFactor),
        startMoney: startMoneyOption(cfg.startMoney),
        commanderHpFactor: commanderHpFactorOption(cfg.commanderHpFactor),
        fixedSideHp: resolveFixedSideHp(cfg.fixedSideHp),
        walls: wallsModeOption(cfg.walls),
        postedUnits: postedUnitsModeOption(cfg.postedUnits),
        seasons: seasonsModeOption(cfg.seasons),
    };
}

/** the preset the room's settings match, if any */
export function matchingRoomPreset(cfg: Partial<CustomGameConfig>): RoomPreset | null {
    const v = presetValuesOf(cfg);
    return (
        ROOM_PRESETS.find((p) =>
            (Object.keys(p.values) as (keyof RoomPresetValues)[]).every((k) => p.values[k] === v[k]),
        ) ?? null
    );
}
