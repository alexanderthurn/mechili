/**
 * Custom Game's Map setting: the generated terrain on one of the board sizes,
 * or the terrain of a saved scenario (Single Player → Editor), which brings
 * the size it was made for. The pick names its package; the room hands that
 * package to every seat and the match plays on the terrain (see
 * lobbyMatchSettings in main.ts).
 */
import { t } from '../i18n';
import { scenarioLevels } from '../game/level';
import type { MapSize } from '../game/map';
import type { CustomGameConfig, GeneratedBoardSize } from '../game/net';
import { MAP_PRESETS } from '../game/scenario/editorDraft';

/** the generated board sizes offered, in this order (tiny leaves no room for the base buildings; compact is on trial) */
export const GENERATED_BOARD_SIZES: readonly GeneratedBoardSize[] = ['compact', 'standard', 'wide', 'deep'];

/** a stored / received board size, checked ('standard' when unknown) */
export function boardSizeOption(value: unknown): GeneratedBoardSize {
    return GENERATED_BOARD_SIZES.includes(value as GeneratedBoardSize) ? (value as GeneratedBoardSize) : 'standard';
}

/** the board of a generated-terrain match */
export function generatedBoard(size: GeneratedBoardSize | undefined): MapSize {
    return { ...MAP_PRESETS[boardSizeOption(size)] };
}

/** a generated size as a select value ('' = standard, as before there were sizes) */
function sizeValue(size: GeneratedBoardSize): string {
    return size === 'standard' ? '' : `gen:${size}`;
}

export type MapPick = NonNullable<CustomGameConfig['map']>;

/** a pick as a select value ('' = generated) */
export function mapValue(map: CustomGameConfig['map']): string {
    return map ? `${map.hash}:${map.scenario}` : '';
}

/** a stored / received pick, checked for shape (whether this client has it is asked later) */
export function mapOption(value: unknown): CustomGameConfig['map'] {
    const m = value as CustomGameConfig['map'] | null;
    if (!m || typeof m !== 'object') return undefined;
    if (typeof m.id !== 'string' || typeof m.hash !== 'string' || typeof m.scenario !== 'string' || typeof m.name !== 'string') return undefined;
    if (!m.board || typeof m.board !== 'object' || typeof m.board.zoneCols !== 'number') return undefined;
    return { id: m.id, hash: m.hash, scenario: m.scenario, name: m.name, board: m.board };
}

/** the Map select: lists the saved scenarios that have a sculpted terrain */
export class MapChoice {
    private readonly picks = new Map<string, MapPick>();

    constructor(private readonly select: HTMLSelectElement) {
        this.refresh(undefined, 'standard');
    }

    /** what the select shows now (undefined = generated) */
    get value(): CustomGameConfig['map'] {
        return this.picks.get(this.select.value);
    }

    /** the generated board size the select shows ('standard' for a saved map — it brings its own) */
    get boardSize(): GeneratedBoardSize {
        const v = this.select.value;
        return boardSizeOption(v.startsWith('gen:') ? v.slice(4) : 'standard');
    }

    /** show `current` — listed even when this client doesn't have it (a guest shows the host's pick by name) */
    private render(current: CustomGameConfig['map'], size: GeneratedBoardSize): void {
        const options: [string, string][] = GENERATED_BOARD_SIZES.map((id) => [
            sizeValue(id),
            t(`menu:boardSize_${id}`, { defaultValue: id[0]!.toUpperCase() + id.slice(1) }),
        ]);
        for (const [value, map] of this.picks) options.push([value, map.name]);
        if (current && !this.picks.has(mapValue(current))) options.push([mapValue(current), current.name]);
        this.select.replaceChildren(
            ...options.map(([v, text]) => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = text;
                return opt;
            }),
        );
        this.select.value = current ? mapValue(current) : sizeValue(size);
    }

    /** show `current` (else the generated `size`), then list the saved scenarios again (async: the scenario cache) */
    refresh(current: CustomGameConfig['map'] = this.value, size: GeneratedBoardSize = this.boardSize): void {
        this.render(current, size);
        void scenarioLevels().then((levels) => {
            this.picks.clear();
            for (const level of levels) {
                for (const sc of level.scenarios) {
                    if (!sc.terrain || !sc.map) continue;
                    const name = level.scenarios.length > 1 ? `${level.name} · ${sc.name}` : sc.name;
                    const map = { id: level.ref.id, hash: level.ref.hash, scenario: sc.id, name, board: sc.map };
                    this.picks.set(mapValue(map), map);
                }
            }
            // the form may have moved on while the list loaded — keep what it shows now
            const shown = this.select.value;
            this.render(shown.startsWith('gen:') || shown === '' ? undefined : (this.picks.get(shown) ?? current), this.boardSize);
        });
    }
}
