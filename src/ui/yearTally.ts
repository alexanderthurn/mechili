/**
 * The Year's progress as the player sees it: one mark per round — taken by the
 * attacker or the defender, the round being played, the rounds still to come —
 * and the tally of both sides. Shared by the loading card, the between-rounds
 * splash and the end screen (styles: theme.ts menuStyles, `.year-`).
 */
import { t } from '../i18n';
import type { YearRoundWinner } from '../game/settings';

export interface YearProgress {
    /** who took each finished round, in order */
    rounds: readonly YearRoundWinner[];
    /** rounds the Year lasts */
    total: number;
    /** the local side's role; null for a spectator */
    you: YearRoundWinner | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function yearRoleName(role: YearRoundWinner): string {
    return role === 'attacker' ? t('hud:yearAttacker', { defaultValue: 'Attacker' }) : t('hud:yearDefender', { defaultValue: 'Defender' });
}

/**
 * The row of round marks. `current` marks the round about to be played (the
 * loading card); the newest finished round can be `fresh` (it pops in).
 */
export function yearMarksHtml(p: YearProgress, opts: { current?: boolean; fresh?: boolean } = {}): string {
    const marks: string[] = [];
    for (let i = 0; i < p.total; i++) {
        const winner = p.rounds[i];
        const cls = winner
            ? `year-mark is-${winner}${opts.fresh && i === p.rounds.length - 1 ? ' is-fresh' : ''}`
            : `year-mark${opts.current && i === p.rounds.length ? ' is-current' : ''}`;
        const letter = winner === 'attacker' ? 'A' : winner === 'defender' ? 'D' : String(i + 1);
        const title = winner ? `${i + 1}: ${yearRoleName(winner)}` : String(i + 1);
        marks.push(`<span class="${cls}" title="${esc(title)}" style="--i:${i}">${letter}</span>`);
    }
    return `<div class="year-marks">${marks.join('')}</div>`;
}

/** "Attacker 3 · 2 Defender", the local side marked */
export function yearTallyHtml(p: YearProgress): string {
    const count = (role: YearRoundWinner) => p.rounds.filter((r) => r === role).length;
    const side = (role: YearRoundWinner) =>
        `<span class="year-side is-${role}${p.you === role ? ' is-you' : ''}">` +
        (role === 'attacker'
            ? `<span class="year-side-name">${esc(yearRoleName(role))}</span><b>${count(role)}</b>`
            : `<b>${count(role)}</b><span class="year-side-name">${esc(yearRoleName(role))}</span>`) +
        (p.you === role ? `<span class="year-you">${esc(t('hud:yearYou', { defaultValue: 'you' }))}</span>` : '') +
        `</span>`;
    return `<div class="year-tally">${side('attacker')}<span class="year-dash">:</span>${side('defender')}</div>`;
}

/** The loading card and the between-rounds splash: round n / total, marks, tally */
export function yearProgressHtml(p: YearProgress, opts: { title: string; current?: boolean; fresh?: boolean }): string {
    return (
        `<div class="year-progress">` +
        `<div class="year-title">${esc(opts.title)}</div>` +
        yearMarksHtml(p, opts) +
        yearTallyHtml(p) +
        `</div>`
    );
}
