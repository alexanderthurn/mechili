/**
 * The scenario editor's Rules section (plan §5, §8.3): every rule a scenario
 * carries, edited in place. Each change is one draft edit; nothing on the
 * board changes (rules apply when the scenario is tested or played).
 */
import type { TypeRegistry } from '../game/content/typeRegistry';
import { HORDE_ALGORITHMS } from '../game/hordeAlgorithms';
import { ROUND_CARD_ALGORITHMS } from '../game/roundCardAlgorithms';
import type { ScenarioDef, ScenarioRules } from '../game/scenario/scenarioDef';
import type { StrongholdMode } from '../game/settings';
import type { Season, TimeOfDay, WeatherKind } from '../game/weather';
import { t } from '../i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const WEATHERS: WeatherKind[] = ['clear', 'rain', 'snow'];
const TIMES: TimeOfDay[] = ['dawn', 'day', 'golden', 'dusk', 'night'];
const STRONGHOLD_MODES: StrongholdMode[] = ['standard', 'lifeline', 'none'];

function options(values: readonly { value: string; label: string }[], selected: string): string {
    return values.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

const plain = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

function row(label: string, control: string, title?: string): string {
    return `<label class="se-rule"${title ? ` title="${esc(title)}"` : ''}><span>${esc(label)}</span>${control}</label>`;
}

function num(rule: string, value: number | null, opts: { min?: number; placeholder?: string } = {}): string {
    return `<input type="number" data-rule="${rule}" value="${value ?? ''}"${opts.min !== undefined ? ` min="${opts.min}"` : ''}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>`;
}

function sel(rule: string, values: readonly { value: string; label: string }[], selected: string): string {
    return `<select data-rule="${rule}">${options(values, selected)}</select>`;
}

function unitChecks(rule: string, types: TypeRegistry, chosen: readonly string[]): string {
    return (
        `<div class="se-checks" data-rule-list="${rule}">` +
        types.shopUnitIds
            .map((id) => `<label><input type="checkbox" value="${esc(id)}"${chosen.includes(id) ? ' checked' : ''}> ${esc(types.byId(id)?.name ?? id)}</label>`)
            .join('') +
        `</div>`
    );
}

export function rulesHtml(def: ScenarioDef, types: TypeRegistry): string {
    const r = def.rules;
    const hpFixed = r.sideHp !== 'commander';
    const commanderValue = r.commander.mode === 'fixed' ? `fixed:${r.commander.id}` : r.commander.mode;
    const unlockedMode = r.unlockedUnits ? 'list' : 'commander';
    const unlockableMode = r.unlockable === undefined ? 'any' : r.unlockable.length === 0 ? 'none' : 'list';
    return (
        `<div class="se-rules-grid">` +
        row(t('editor:ruleSideHp', { defaultValue: 'Side HP' }), sel('sideHpMode', [
            { value: 'fixed', label: t('editor:fixed', { defaultValue: 'fixed' }) },
            { value: 'commander', label: t('editor:fromCommander', { defaultValue: 'from commander' }) },
        ], hpFixed ? 'fixed' : 'commander')) +
        (hpFixed && r.sideHp !== 'commander'
            ? row(t('editor:rulePlayerEnemy', { defaultValue: 'Player / enemy' }), num('sideHp.player', r.sideHp.player, { min: 1 }) + num('sideHp.enemy', r.sideHp.enemy, { min: 1 }))
            : '') +
        row(t('editor:ruleCommander', { defaultValue: 'Commander' }), sel('commander', [
            { value: 'none', label: t('editor:none', { defaultValue: 'none' }) },
            { value: 'pick', label: t('editor:pick', { defaultValue: 'player picks' }) },
            ...types.commanders.filter((c) => c.id !== 'none').map((c) => ({ value: `fixed:${c.id}`, label: c.title })),
        ], commanderValue)) +
        (r.commander.mode === 'fixed'
            ? row(t('editor:ruleStarterArmy', { defaultValue: 'Its starting army' }), `<input type="checkbox" data-rule="starterArmy"${r.commander.starterArmy ? ' checked' : ''}>`)
            : '') +
        row(t('editor:ruleOpponent', { defaultValue: 'Computer' }), sel('opponents', [
            { value: 'lockInOnly', label: t('editor:lockInOnly', { defaultValue: 'fights as placed' }) },
            { value: 'build', label: t('editor:build', { defaultValue: 'builds every round' }) },
        ], r.opponents)) +
        row(t('editor:ruleIncome', { defaultValue: 'Supply round 1 / growth' }), num('income.round1', r.income.round1, { min: 0 }) + num('income.growth', r.income.growth, { min: 0 })) +
        row(t('editor:ruleDeploy', { defaultValue: 'Packs / extras per round' }), num('deploy.unitsPerRound', r.deploy.unitsPerRound, { min: 0 }) + num('deploy.extrasBudgetPerRound', r.deploy.extrasBudgetPerRound, { min: 0 })) +
        row(t('editor:ruleStrips', { defaultValue: 'Flanks / middle open in round' }), num('flanksOpenFromRound', r.flanksOpenFromRound, { min: 1, placeholder: 'never' }) + num('neutralOpenFromRound', r.neutralOpenFromRound, { min: 1, placeholder: 'never' }), t('editor:ruleStripsTip', { defaultValue: 'Empty = never' })) +
        row(t('editor:ruleRoundCards', { defaultValue: 'Round cards' }), sel('roundCards', ROUND_CARD_ALGORITHMS.map((a) => ({ value: a.id, label: a.id })), r.roundCards)) +
        row(t('editor:ruleHorde', { defaultValue: 'Horde waves' }), sel('hordeWaves', HORDE_ALGORITHMS.map((a) => ({ value: a.id, label: a.id })), r.hordeWaves)) +
        row(t('editor:ruleStronghold', { defaultValue: 'Stronghold' }), sel('strongholdMode', plain(STRONGHOLD_MODES), r.strongholdMode)) +
        row(t('editor:ruleIntel', { defaultValue: 'Enemy deployment' }), sel('enemyIntel', [
            { value: 'visible', label: t('editor:visible', { defaultValue: 'visible' }) },
            { value: 'fogged', label: t('editor:fogged', { defaultValue: 'hidden until lock-in' }) },
        ], r.enemyIntel)) +
        row(t('editor:ruleSeason', { defaultValue: 'Season / weather / time' }),
            sel('atmosphere.season', plain(SEASONS), r.atmosphere.season) +
            sel('atmosphere.weather', plain(WEATHERS), r.atmosphere.weather ?? 'clear') +
            sel('atmosphere.time', plain(TIMES), r.atmosphere.time ?? 'day')) +
        row(t('editor:ruleRotate', { defaultValue: 'Weather changes each round' }), `<input type="checkbox" data-rule="atmosphere.rotate"${r.atmosphere.rotate ? ' checked' : ''}>`) +
        row(t('editor:ruleShop', { defaultValue: 'Shop' }), sel('unlockedMode', [
            { value: 'commander', label: t('editor:shopCommander', { defaultValue: 'what the commander gives' }) },
            { value: 'list', label: t('editor:shopList', { defaultValue: 'these units' }) },
        ], unlockedMode)) +
        (unlockedMode === 'list' ? unitChecks('unlockedUnits', types, r.unlockedUnits ?? []) : '') +
        row(t('editor:ruleUnlockable', { defaultValue: 'Round unlock' }), sel('unlockableMode', [
            { value: 'any', label: t('editor:unlockAny', { defaultValue: 'any unit' }) },
            { value: 'none', label: t('editor:unlockNone', { defaultValue: 'no unlocking' }) },
            { value: 'list', label: t('editor:unlockList', { defaultValue: 'only these' }) },
        ], unlockableMode)) +
        (unlockableMode === 'list' ? unitChecks('unlockable', types, r.unlockable ?? []) : '') +
        row(t('editor:ruleLoadout', { defaultValue: 'Player talents' }), sel('loadout', [
            { value: 'player', label: t('editor:loadoutPlayer', { defaultValue: 'own loadout' }) },
            { value: 'open', label: t('editor:loadoutOpen', { defaultValue: 'every talent' }) },
            ...(r.loadout?.mode === 'fixed' || r.loadout?.mode === 'restrict'
                ? [{ value: r.loadout.mode, label: r.loadout.mode === 'fixed' ? 'fixed (from the file)' : 'restricted (from the file)' }]
                : []),
        ], r.loadout?.mode ?? 'player')) +
        row(t('editor:ruleSeed', { defaultValue: 'Seed' }), num('seed', def.seed, { min: 0 })) +
        row(t('editor:ruleDescription', { defaultValue: 'Description' }), `<input type="text" data-rule="description" maxlength="200" value="${esc(def.description ?? '')}">`) +
        `</div>`
    );
}

/** Apply one control's value to a copy of the draft; null when the value isn't usable. */
function withRule(def: ScenarioDef, rule: string, el: HTMLInputElement | HTMLSelectElement, types: TypeRegistry): ScenarioDef | null {
    const next = structuredClone(def);
    const r: ScenarioRules = next.rules;
    const value = el.value;
    const int = (min: number) => {
        const n = Math.round(Number(value));
        return value.trim() !== '' && Number.isFinite(n) ? Math.max(min, n) : null;
    };
    const checked = (el as HTMLInputElement).checked;
    switch (rule) {
        case 'sideHpMode':
            r.sideHp = value === 'commander' ? 'commander' : r.sideHp === 'commander' ? { player: 6000, enemy: 6000 } : r.sideHp;
            break;
        case 'sideHp.player':
        case 'sideHp.enemy': {
            const n = int(1);
            if (n === null || r.sideHp === 'commander') return null;
            r.sideHp[rule === 'sideHp.player' ? 'player' : 'enemy'] = n;
            break;
        }
        case 'commander':
            if (value === 'none' || value === 'pick') r.commander = { mode: value };
            else if (value.startsWith('fixed:')) {
                const id = value.slice('fixed:'.length);
                if (!types.commander(id)) return null;
                r.commander = { mode: 'fixed', id, starterArmy: r.commander.mode === 'fixed' ? r.commander.starterArmy : false };
            }
            break;
        case 'starterArmy':
            if (r.commander.mode !== 'fixed') return null;
            r.commander = { ...r.commander, starterArmy: checked };
            break;
        case 'opponents':
            r.opponents = value === 'build' ? 'build' : 'lockInOnly';
            break;
        case 'income.round1':
        case 'income.growth':
        case 'deploy.unitsPerRound':
        case 'deploy.extrasBudgetPerRound': {
            const n = int(0);
            if (n === null) return null;
            const [group, key] = rule.split('.') as ['income' | 'deploy', string];
            (r[group] as unknown as Record<string, number>)[key] = n;
            break;
        }
        case 'flanksOpenFromRound':
        case 'neutralOpenFromRound':
            r[rule] = value.trim() === '' ? null : int(1);
            break;
        case 'roundCards':
            r.roundCards = value;
            break;
        case 'hordeWaves':
            r.hordeWaves = value;
            break;
        case 'strongholdMode':
            r.strongholdMode = value as StrongholdMode;
            break;
        case 'enemyIntel':
            r.enemyIntel = value === 'fogged' ? 'fogged' : 'visible';
            break;
        case 'atmosphere.season':
            r.atmosphere = { ...r.atmosphere, season: value as Season };
            break;
        case 'atmosphere.weather':
            r.atmosphere = { ...r.atmosphere, weather: value as WeatherKind };
            break;
        case 'atmosphere.time':
            r.atmosphere = { ...r.atmosphere, time: value as TimeOfDay };
            break;
        case 'atmosphere.rotate':
            r.atmosphere = { ...r.atmosphere, rotate: checked };
            break;
        case 'unlockedMode':
            if (value === 'commander') delete r.unlockedUnits;
            else r.unlockedUnits ??= [...types.shopUnitIds];
            break;
        case 'unlockableMode':
            if (value === 'any') delete r.unlockable;
            else if (value === 'none') r.unlockable = [];
            else r.unlockable = r.unlockable?.length ? r.unlockable : [...types.shopUnitIds];
            break;
        case 'loadout':
            if (value === 'player') delete r.loadout;
            else if (value === 'open') r.loadout = { mode: 'open' };
            else return null;
            break;
        case 'seed': {
            const n = int(0);
            if (n === null) return null;
            next.seed = n;
            break;
        }
        case 'description':
            if (value.trim()) next.description = value.trim();
            else delete next.description;
            break;
        default:
            return null;
    }
    return next;
}

/** Wire the rules section; `commit` records the changed draft (and redraws). */
export function wireRules(
    root: HTMLElement,
    getDraft: () => ScenarioDef,
    types: TypeRegistry,
    commit: (next: ScenarioDef) => void,
): void {
    for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-rule]')) {
        el.addEventListener('change', () => {
            const next = withRule(getDraft(), el.dataset.rule!, el, types);
            if (next) commit(next);
        });
    }
    for (const list of root.querySelectorAll<HTMLElement>('[data-rule-list]')) {
        const rule = list.dataset.ruleList as 'unlockedUnits' | 'unlockable';
        list.addEventListener('change', () => {
            const chosen = [...list.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
            const next = structuredClone(getDraft());
            next.rules[rule] = chosen;
            commit(next);
        });
    }
}
