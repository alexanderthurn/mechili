/**
 * How a match's settings come together before the Game starts: the URL's dev
 * overrides, the Custom Game room config (load, save, apply), and the modes
 * that shape them (horde, duo, The Year, local vs AI).
 */
import type { CustomGameConfig, CustomGameMode } from '../game/net';
import { boardSizeOption, generatedBoard, mapOption } from './mapChoice';
import { DEFAULT_TERRAIN_SHAPE, terrainShapeOption } from '../game/terrainShapes';
import {
    DEFAULT_STRONGHOLD_MODE,
    strongholdModeOption,
    CUSTOM_GAME_PACE_PRESETS,
    CLIMB_ROUNDS,
    CLIMB_SIDE_HP,
    CLIMB_SUPPLY_GROWTH_PER_ROUND,
    type ClimbRole,
    DEFAULT_COMMANDER_HP_FACTOR,
    DEFAULT_CUSTOM_GAME_PACE_ID,
    DEFAULT_HORDE_PRESET_ID,
    DEFAULT_MONEY_FACTOR,
    DEFAULT_START_MONEY,
    DEFAULT_SETTINGS,
    HORDE_ALGORITHMS,
    commanderHpFactorOption,
    customGamePaceById,
    hordeAlgorithmById,
    moneyFactorOption,
    startMoneyOption,
    resolveCommanderHpFactor,
    resolveFixedSideHp,
    resolveMoneyFactor,
    resolveStartMoney,
    type GameSettings,
} from '../game/settings';
import { applyTutorialMode } from '../game/tutorial';
import { DEFAULT_ROUND_CARD_PRESET_ID, roundCardAlgorithmById } from '../game/roundCardAlgorithms';
import { duoSeats } from '../game/seats';

// the only mode right now (Single Player / Matchmaking both force this) —
// PvPvE: a neutral dwarf horde spawns from the forest ring outside the
// normal board and marches in, hostile to both players. The normal map's
// own dimensions apply (see the rim widen in map.ts/scenery.ts for horde
// mode specifically). `?hordePreset=` / `?hordeFactor=` selects an algorithm id.
export function applyHordeMode(settings: GameSettings): void {
    // Normal single-player / forced-horde modes: Low (mid + Mother night).
    // `?hordePreset=` / `?hordeFactor=` still overrides.
    settings.hordePreset = 'low';
    const params = new URLSearchParams(location.search);
    const presetParam = params.get('hordePreset') ?? params.get('hordeFactor');
    if (!presetParam) return;
    if (HORDE_ALGORITHMS.some((a) => a.id === presetParam)) {
        settings.hordePreset = presetParam;
    }
}

/**
 * SP Campaign: sudden-death climb. Income growth defaults to the normal
 * match economy; set {@link CLIMB_SUPPLY_GROWTH_PER_ROUND} in settings.ts
 * to override while playtesting.
 */
export function applyClimbMode(settings: GameSettings, variant: ClimbVariant = { role: 'attacker' }): void {
    settings.climb = {
        rounds: CLIMB_ROUNDS,
        ...(variant.attackerSide !== undefined ? { attackerSide: variant.attackerSide } : {}),
        sideHp: CLIMB_SIDE_HP,
        // the normal income, the same as the match's own growth
        playerSupplyGrowthPerRound: settings.economy.supplyGrowthPerRound,
        ...(variant.role === 'defender' ? { humanRole: variant.role } : {}),
        ...(variant.komtur ? { attackerCommander: 'cursed' } : {}),
    };
    // The Year fields The Komtur's waves at Medium (not Off / not the Low SP-horde default) —
    // unless the Komtur is the attacker himself: then there is no third party
    if (variant.komtur) settings.hordePreset = 'off';
    else if (!variant.keepHorde) settings.hordePreset = 'medium';
    if (CLIMB_SUPPLY_GROWTH_PER_ROUND != null) {
        settings.economy = {
            ...settings.economy,
            supplyGrowthPerRound: CLIMB_SUPPLY_GROWTH_PER_ROUND,
        };
    }
}

// shared by local duo-vs-AI and online 2v2 — 4 armies need more elbow room
// (kept modest — each seat now gets its own pair of towers within its own
// half-lane, so this doesn't need to be as wide as when towers were shared)
export function widenMapForDuo(settings: GameSettings): void {
    settings.map = { ...settings.map, zoneCols: Math.round(settings.map.zoneCols * 1.3) };
}

// ?duo=1 / the 2v2 Skirmish menu button — you + an AI ally against two AI
// commanders, split lanes, wider board. Combines with horde mode.
export function applyDuoMode(settings: GameSettings): void {
    settings.seats = duoSeats('You');
    widenMapForDuo(settings);
}

// ---- Custom Game screen: config, persistence, and the actual hosting -----
// CustomGameMode/CustomGameConfig now live in game/net.ts — the config
// travels over the wire now (see the 'lobbySettings' NetMessage), so the
// single source of truth moved to where NetMessage itself is defined.

export const DEFAULT_CUSTOM_GAME: CustomGameConfig = {
    mode: '1v1',
    pace: DEFAULT_CUSTOM_GAME_PACE_ID,
    hordePreset: DEFAULT_HORDE_PRESET_ID,
    roundCardPreset: DEFAULT_ROUND_CARD_PRESET_ID,
    commanderHpFactor: DEFAULT_COMMANDER_HP_FACTOR,
    fixedSideHp: null,
    moneyFactor: DEFAULT_MONEY_FACTOR,
    startMoney: DEFAULT_START_MONEY,
    strongholdMode: DEFAULT_STRONGHOLD_MODE,
    terrainShape: DEFAULT_TERRAIN_SHAPE,
};

export const CUSTOM_GAME_KEY = 'mechili-custom-game';

/** localStorage only (never the URL — this is testing-tool state, not a
 *  shareable link) — matches getPlayerName's own storage pattern. */
export function normalizeCustomGameMode(mode: CustomGameMode | '1v1ai' | undefined): CustomGameMode {
    if (mode === '1v1ai') return '1v1';
    return mode ?? DEFAULT_CUSTOM_GAME.mode;
}

/**
 * A room's shape in today's terms: the players are 1v1 or 2v2, Siege and the
 * Victory rule are settings of their own. Rooms of before ('year' — 1v1
 * Siege on Rounds; '2v2ai' — 2v2) are read as those.
 */
export function roomConfig<T extends CustomGameConfig>(cfg: T): T {
    if (cfg.mode === 'year') return { ...cfg, mode: '1v1', siege: true, victory: 'rounds' };
    if (cfg.mode === '2v2ai') return { ...cfg, mode: '2v2' };
    return cfg;
}


export function loadCustomGameConfig(): CustomGameConfig {
    try {
        const raw = localStorage.getItem(CUSTOM_GAME_KEY);
        if (!raw) return { ...DEFAULT_CUSTOM_GAME };
        const parsed = JSON.parse(raw) as Partial<CustomGameConfig> & {
            buildSeconds?: number;
            battleSeconds?: number;
            specialistSeconds?: number;
            cardSeconds?: number;
            roundCards?: boolean;
            horde?: string;
        };
        let pace = parsed.pace;
        // migrate legacy free-form second fields → nearest / matching preset
        if (!pace && typeof parsed.buildSeconds === 'number') {
            pace = CUSTOM_GAME_PACE_PRESETS.find(
                (p) =>
                    p.buildSeconds === parsed.buildSeconds &&
                    p.battleSeconds === parsed.battleSeconds &&
                    p.specialistSeconds === parsed.specialistSeconds &&
                    p.cardSeconds === parsed.cardSeconds,
            )?.id;
        }
        let roundCardPreset = parsed.roundCardPreset;
        if (!roundCardPreset && typeof parsed.roundCards === 'boolean') {
            roundCardPreset = parsed.roundCards ? 'runes-every' : 'off';
        }
        let hordePreset = parsed.hordePreset ?? parsed.horde;
        const loaded: CustomGameConfig = {
            ...DEFAULT_CUSTOM_GAME,
            // '1v1ai' was a Custom Game option once; hosting 1v1 and clicking
            // "Start with AI" is the same thing, so a stored one lands on 1v1
            // rather than a mode with no button behind it.
            mode: normalizeCustomGameMode(parsed.mode),
            pace: customGamePaceById(pace).id,
            hordePreset: hordeAlgorithmById(hordePreset).id,
            roundCardPreset: roundCardAlgorithmById(roundCardPreset).id,
            commanderHpFactor: commanderHpFactorOption(parsed.commanderHpFactor),
            fixedSideHp: resolveFixedSideHp(parsed.fixedSideHp),
            moneyFactor: moneyFactorOption(parsed.moneyFactor),
            startMoney: startMoneyOption(parsed.startMoney),
            strongholdMode: strongholdModeOption(parsed.strongholdMode),
            map: mapOption(parsed.map),
            boardSize: boardSizeOption(parsed.boardSize),
            terrainShape: terrainShapeOption(parsed.terrainShape),
            siege: parsed.siege === true,
            victory: parsed.victory === 'rounds' ? 'rounds' : 'hp',
            fog: parsed.fog !== false,
        };
        return roomConfig(loaded);
    } catch {
        return { ...DEFAULT_CUSTOM_GAME };
    }
}

export function saveCustomGameConfig(cfg: CustomGameConfig): void {
    try {
        localStorage.setItem(CUSTOM_GAME_KEY, JSON.stringify(cfg));
    } catch {
        /* private browsing */
    }
}

export function applyCustomGameConfig(settings: GameSettings, cfg: CustomGameConfig): void {
    const pace = customGamePaceById(cfg.pace);
    settings.buildTimeSeconds = pace.buildSeconds;
    settings.battleTimeSeconds = pace.battleSeconds;
    settings.specialistTimeSeconds = pace.specialistSeconds;
    settings.cardTimeSeconds = pace.cardSeconds;
    settings.roundCardPreset = roundCardAlgorithmById(cfg.roundCardPreset).id;
    settings.hordePreset = hordeAlgorithmById(cfg.hordePreset).id;
    settings.commanderHpFactor = resolveCommanderHpFactor(cfg.commanderHpFactor);
    settings.fixedSideHp = resolveFixedSideHp(cfg.fixedSideHp);
    settings.moneyFactor = resolveMoneyFactor(cfg.moneyFactor);
    settings.startMoney = resolveStartMoney(cfg.startMoney);
    settings.strongholdMode = strongholdModeOption(cfg.strongholdMode);
    settings.terrainShape = terrainShapeOption(cfg.terrainShape);
    // the generated terrain's board size (a saved map replaces it with its own, see lobbyMatchSettings)
    settings.map = generatedBoard(cfg.boardSize);
    // Custom Game rooms play the base game (scenarios are single player: Single Player → Editor)
    // deleted, not set to undefined: the room's transport turns undefined into null
    delete settings.level;
}

// dev override: tweak match settings from the URL, e.g. ?build=20&nocards
export function settingsFromUrl(): GameSettings {
    const params = new URLSearchParams(location.search);
    const settings = structuredClone(DEFAULT_SETTINGS);
    const hpFactor = Number(params.get('commanderHpFactor') ?? params.get('hpFactor'));
    if (hpFactor > 0) settings.commanderHpFactor = hpFactor;
    const moneyFactor = Number(params.get('moneyFactor') ?? params.get('money'));
    if (moneyFactor > 0) settings.moneyFactor = moneyFactor;
    const startMoney = Number(params.get('startMoney'));
    if (Number.isFinite(startMoney) && startMoney >= 0) settings.startMoney = startMoney;
    const seed = Number(params.get('seed'));
    if (seed > 0) settings.seed = seed;
    // no ?horde=1 opt-in anymore — the menu forces applyHordeMode itself
    // now that Horde is the only mode; ?hordeFactor= (including `off`)
    // overrides the level — see applyHordeMode
    if (params.get('duo')) applyDuoMode(settings);
    // ?landscape=<id>: play a map from assets/data/landscapes/
    const landscape = params.get('landscape');
    if (landscape) settings.landscape = landscape;
    // ?terrain=hills|highlands|wall: the generated board relief
    const terrain = params.get('terrain');
    if (terrain) settings.terrainShape = terrainShapeOption(terrain);

    const parseTimer = (raw: string | null): number | number[] | null => {
        if (!raw) return null;
        const parts = raw
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (parts.length === 0) return null;
        return parts.length === 1 ? parts[0]! : parts;
    };
    const build = parseTimer(params.get('build'));
    if (build !== null) settings.buildTimeSeconds = build;
    const battle = parseTimer(params.get('battle'));
    if (battle !== null) settings.battleTimeSeconds = battle;
    const specialist = parseTimer(params.get('specialist'));
    if (specialist !== null) settings.specialistTimeSeconds = specialist;
    const card = parseTimer(params.get('card'));
    if (card !== null) settings.cardTimeSeconds = card;

    // between-round cards: ?nocards | ?roundCardPreset=full | legacy ?roundCards=
    if (params.has('nocards') || params.get('roundCards') === 'off' || params.get('roundCardPreset') === 'off') {
        settings.roundCardPreset = 'off';
    } else {
        const presetRaw = params.get('roundCardPreset');
        if (presetRaw) {
            settings.roundCardPreset = roundCardAlgorithmById(presetRaw).id;
        } else if (params.get('roundCards') === 'true' || params.get('roundCards') === '1') {
            settings.roundCardPreset = 'runes-every';
        } else {
            const raw = params.get('roundCards');
            if (raw && raw.includes(',')) {
                // legacy sparse list → spare if even rounds, else every
                settings.roundCardPreset = 'runes-spare';
            }
        }
    }
    return settings;
}

/** a way to play The Year: your role, and whether the attacker is The Komtur */
export type ClimbVariant = {
    role: ClimbRole;
    komtur?: boolean;
    /** a room: the canonical side that attacks (0 = the host's) — `role` is then unused */
    attackerSide?: number;
    /** a room: keep the lobby's Komtur waves setting */
    keepHorde?: boolean;
};
export type LocalMatchOpts = { climb?: ClimbVariant; tutorial?: number };

/** local-vs-AI modes share the relaxed-timer, same-fog-rules setup as Single Player */
export function localMatchSettings(opts: LocalMatchOpts = {}): GameSettings {
    const settings = settingsFromUrl();
    settings.buildTimeSeconds = 60 * 60;
    settings.specialistTimeSeconds = 60 * 60;
    settings.cardTimeSeconds = 60 * 60;
    if (opts.climb) applyClimbMode(settings, opts.climb);
    if (opts.tutorial != null) applyTutorialMode(settings, opts.tutorial);
    return settings;
}
