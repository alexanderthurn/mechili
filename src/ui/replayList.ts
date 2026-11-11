/**
 * The replay list in the menu: your own recorded matches (or everyone's),
 * newest first, each one a click away from watching. Reads the same stats
 * backend the matches were uploaded to; the dialog wears the profile
 * dialog's look (`mechili-name-edit`), so it needs no styling of its own
 * beyond the list.
 */

import { formatGameVersion, GAME_VERSION } from '../game/net';
import { fetchReplayList, gameVersionLabel, replayBuildMismatch, type ReplayListGroup, type ReplayListRecord } from '../game/telemetry';
import { t } from '../i18n';

export interface ReplayListOptions {
    /** the local player's name — "mine" shows the matches they reported */
    playerName: string;
    onWatch: (id: string, side: 'a' | 'b') => void;
}

const PAGE = 30;

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function difficultyLabel(d: string | null): string {
    if (!d) return t('menu:replaysAi', { defaultValue: 'AI' });
    return t(`menu:aiDifficulty.${d}`, { defaultValue: d });
}

/** a side's seats: 'mangoo + Ally (Learner)' */
function sideNames(r: ReplayListRecord, side: 'a' | 'b'): string {
    const seats = r.seats.filter((s) => s.side === side);
    if (seats.length === 0) return escapeHtml(side === r.side ? r.names.local : r.names.opponent);
    return seats
        .map((s) => `${escapeHtml(s.name)}${s.ai ? ` <span class="rp-ai">(${escapeHtml(difficultyLabel(s.difficulty))})</span>` : ''}`)
        .join(' + ');
}

function modeLabel(r: ReplayListRecord): string {
    if (r.mode === 'ai') return t('menu:replaysModeAi', { defaultValue: 'vs AI' });
    if (r.mode === 'mp') return t('menu:replaysModeMp', { defaultValue: '1v1 online' });
    const per = (side: 'a' | 'b') => r.seats.filter((s) => s.side === side).length;
    return r.seats.length ? `${per('a')}v${per('b')}` : r.mode;
}

/** the record to show for a match: the player's own report, else the first original */
function recordOf(group: ReplayListGroup, name: string): ReplayListRecord | null {
    const own = (r: ReplayListRecord) => r.source !== 'verify' && r.names.local.toLowerCase() === name.toLowerCase();
    return group.records.find(own) ?? group.records.find((r) => r.source !== 'verify') ?? group.records[0] ?? null;
}

function rowHtml(r: ReplayListRecord): string {
    const result = r.quit
        ? t('menu:replaysQuit', { defaultValue: 'Quit' })
        : r.result === 'victory'
          ? t('menu:replaysVictory', { defaultValue: 'Victory' })
          : r.result === 'defeat'
            ? t('menu:replaysDefeat', { defaultValue: 'Defeat' })
            : t('menu:replaysDraw', { defaultValue: 'Draw' });
    const cls = r.quit ? 'quit' : r.result;
    const rounds = t('menu:replaysRounds', { count: r.rounds, defaultValue: '{{count}} rounds' });
    const when = new Date(r.ts * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    const other = replayBuildMismatch(r);
    const version = `${gameVersionLabel(r.gameVersion)}${other ? ' ⚠' : ''}`;
    const watchTitle = other
        ? t('menu:replaysOtherBuild', {
              why: other,
              defaultValue: '{{why}} — the battles may play out differently than they did.',
          })
        : '';
    const watch = r.hasReplay
        ? `<button type="button" class="rp-watch" data-id="${escapeHtml(r.id)}" data-side="${r.side}" title="${escapeHtml(watchTitle)}">▶ ${t('menu:replaysWatch', { defaultValue: 'Watch' })}</button>`
        : `<button type="button" class="rp-watch" disabled title="${escapeHtml(t('menu:replaysNoLog', { defaultValue: 'Recorded without its moves' }))}">▶ ${t('menu:replaysWatch', { defaultValue: 'Watch' })}</button>`;
    const theirs = r.side === 'a' ? 'b' : 'a';
    return (
        `<div class="rp-row">` +
        `<div class="rp-main">` +
        `<div class="rp-head"><span class="rp-result ${cls}">${escapeHtml(result)}</span> · ${escapeHtml(modeLabel(r))} · ${escapeHtml(rounds)}</div>` +
        `<div class="rp-names">${sideNames(r, r.side)} <span class="rp-vs">vs</span> ${sideNames(r, theirs)}</div>` +
        `<div class="rp-meta">${escapeHtml(when)} · <span${other ? ` title="${escapeHtml(watchTitle)}"` : ''}>${escapeHtml(version)}</span></div>` +
        `</div>` +
        watch +
        `</div>`
    );
}

/** opens the list over `parent`; closes on Escape, the backdrop or Close */
export function showReplayList(parent: HTMLElement, opts: ReplayListOptions): void {
    const overlay = document.createElement('div');
    overlay.className = 'mechili-name-edit mechili-replays';
    overlay.innerHTML =
        `<div class="box">` +
        `<div class="title">${t('menu:replaysTitle', { defaultValue: 'Replays' })}</div>` +
        `<div class="rp-filter">` +
        `<button type="button" class="rp-scope is-on" data-scope="mine">${t('menu:replaysMine', { defaultValue: 'My matches' })}</button>` +
        `<button type="button" class="rp-scope" data-scope="all">${t('menu:replaysAll', { defaultValue: 'All players' })}</button>` +
        `</div>` +
        `<div class="rp-list"></div>` +
        `<div class="hint rp-status"></div>` +
        `<button type="button" class="rp-more" hidden>${t('menu:replaysMore', { defaultValue: 'Load more' })}</button>` +
        `<div class="hint">${t('menu:replaysBuild', { version: formatGameVersion(GAME_VERSION), defaultValue: 'Replays play with this build ({{version}}); ⚠ marks ones recorded with another.' })}</div>` +
        `<div class="actions"><button type="button" data-act="close">${t('menu:close')}</button></div>` +
        `</div>`;
    const listEl = overlay.querySelector<HTMLDivElement>('.rp-list')!;
    const statusEl = overlay.querySelector<HTMLDivElement>('.rp-status')!;
    const moreBtn = overlay.querySelector<HTMLButtonElement>('.rp-more')!;

    let scope: 'mine' | 'all' = 'mine';
    let next: string | null = null;
    /** bumped per fresh load, so a slow earlier answer can't land in a newer list */
    let gen = 0;
    let shown = 0;

    const load = async (append: boolean) => {
        const mine = ++gen;
        if (!append) {
            listEl.innerHTML = '';
            shown = 0;
            next = null;
        }
        moreBtn.disabled = true;
        statusEl.textContent = t('menu:replaysLoading', { defaultValue: 'Loading…' });
        const page = await fetchReplayList({
            name: scope === 'mine' ? opts.playerName : undefined,
            limit: PAGE,
            before: append ? next : null,
        });
        if (mine !== gen || !overlay.isConnected) return;
        moreBtn.disabled = false;
        if (!page) {
            statusEl.textContent = t('menu:replaysOffline', { defaultValue: 'The replay server could not be reached.' });
            return;
        }
        const rows = page.groups.map((g) => recordOf(g, opts.playerName)).filter((r): r is ReplayListRecord => !!r);
        listEl.insertAdjacentHTML('beforeend', rows.map(rowHtml).join(''));
        shown += rows.length;
        next = page.next;
        moreBtn.hidden = !next;
        statusEl.textContent = shown === 0 ? t('menu:replaysNone', { defaultValue: 'No recorded matches yet.' }) : '';
    };

    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    const close = () => {
        if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
        overlay.remove();
    };

    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target === overlay) {
            close();
            return;
        }
        const button = target.closest<HTMLButtonElement>('button');
        if (!button || button.disabled) return;
        if (button.dataset.act === 'close') {
            close();
        } else if (button.classList.contains('rp-watch') && button.dataset.id) {
            close();
            opts.onWatch(button.dataset.id, button.dataset.side === 'b' ? 'b' : 'a');
        } else if (button.dataset.scope) {
            scope = button.dataset.scope === 'all' ? 'all' : 'mine';
            overlay.querySelectorAll('.rp-scope').forEach((b) => b.classList.toggle('is-on', b === button));
            void load(false);
        } else if (button === moreBtn) {
            void load(true);
        }
    });
    onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
    };
    window.addEventListener('keydown', onKeyDown);

    parent.appendChild(overlay);
    void load(false);
}
