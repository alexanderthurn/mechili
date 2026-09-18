/**
 * Custom Game's Map setting: the generated terrain, or the terrain of a saved
 * scenario (Single Player → Editor). The pick names its package; the room
 * hands that package to every seat and the match plays on the terrain (see
 * lobbyMatchSettings in main.ts).
 */
import { t } from '../i18n';
import { scenarioLevels } from '../game/level';
import type { CustomGameConfig } from '../game/net';

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
        this.refresh(undefined);
    }

    /** what the select shows now (undefined = generated) */
    get value(): CustomGameConfig['map'] {
        return this.picks.get(this.select.value);
    }

    /** show `current` — listed even when this client doesn't have it (a guest shows the host's pick by name) */
    private render(current: CustomGameConfig['map']): void {
        const options: [string, string][] = [['', t('menu:mapProcedural', { defaultValue: 'Generated' })]];
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
        this.select.value = mapValue(current);
    }

    /** show `current`, then list the saved scenarios again (async: the scenario cache) */
    refresh(current: CustomGameConfig['map'] = this.value): void {
        this.render(current);
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
            this.render(this.picks.get(this.select.value) ?? current);
        });
    }
}
