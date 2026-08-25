/**
 * Pre-match roster on the CSS menu-zoom cover — not the 3D match view.
 * Stays on the cover and dissolves with it into the 3D scene.
 */

import { fetchPlayerPublic, getCachedProfile } from '../game/account';
import { SIDE_COLORS } from '../game/colors';
import { DEFAULT_MMR } from '../game/mmr';
import {
    canonicalClassicSeats,
    localizeRoster,
    type SeatDef,
} from '../game/seats';
import { getAvatarDataUrl } from '../game/avatar';
import type { GameSettings } from '../game/settings';
import type { StarRole } from '../game/net';
import { withDialogFade } from './dialogFade';

export type IntroRosterEntry = {
    team: 'player' | 'enemy';
    name: string;
    avatar?: string | null;
    controller: 'human' | 'ai';
    mmr: number | null;
    isLocal: boolean;
};

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '&#10;');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Localized seats for the intro roster — mirrors Game constructor logic. */
export function introRosterEntries(
    settings: GameSettings,
    side: 'a' | 'b',
    names: { local: string; opponent: string },
    star: StarRole | null,
): IntroRosterEntry[] {
    const humanSeat = star?.mySeat ?? (side === 'a' ? 0 : 1);
    const baseSeats: SeatDef[] =
        settings.seats ??
        localizeRoster(
            canonicalClassicSeats(
                side === 'a' ? names.local : names.opponent,
                side === 'a' ? names.opponent : names.local,
            ),
            side,
        );
    const localAvatar = getAvatarDataUrl();
    const seats = baseSeats.map((s, i) =>
        i === humanSeat && !s.avatar && localAvatar ? { ...s, avatar: localAvatar } : s,
    );
    return seats.map((s, i) => ({
        team: s.team,
        name: s.name,
        avatar: s.avatar,
        controller: s.controller,
        mmr: s.controller === 'ai' ? DEFAULT_MMR : null,
        isLocal: i === humanSeat,
    }));
}

function teamHtml(team: 'player' | 'enemy', entries: IntroRosterEntry[]): string {
    const rows = entries
        .map((e) => {
            const portrait = e.avatar
                ? `<img class="mr-portrait-img" src="${escapeAttr(e.avatar)}" alt="" draggable="false" />`
                : `<span class="mr-portrait-ph" aria-hidden="true"></span>`;
            const mmrText = e.mmr === null ? '…' : String(e.mmr);
            const mmrClass = e.mmr === null ? 'mr-mmr loading' : 'mr-mmr';
            const localClass = e.isLocal ? ' mr-local' : '';
            const aiTag = e.controller === 'ai' ? `<span class="mr-ai">AI</span>` : '';
            return (
                `<div class="mr-player${localClass}" data-name="${escapeAttr(e.name)}">` +
                `<div class="mr-portrait ${team}">${portrait}</div>` +
                `<div class="mr-info">` +
                `<div class="mr-name">${escapeHtml(e.name)}${aiTag}</div>` +
                `<div class="${mmrClass}">${mmrText}</div>` +
                `</div></div>`
            );
        })
        .join('');
    return `<div class="mr-team mr-team-${team}">${rows}</div>`;
}

/** Append the roster panel to an active intro cover.
 *  `side` sets local team CSS colors — menu styles bake defaults at boot
 *  (host blue), so guests must override via variables here. */
export function mountIntroRoster(
    cover: HTMLElement,
    entries: readonly IntroRosterEntry[],
    side: 'a' | 'b' = 'a',
): void {
    unmountIntroRoster(cover);
    const player = SIDE_COLORS[side === 'a' ? 0 : 1]!.css;
    const enemy = SIDE_COLORS[side === 'a' ? 1 : 0]!.css;
    const el = withDialogFade(document.createElement('div'));
    el.classList.add('mechili-match-roster');
    el.style.setProperty('--mr-player', player);
    el.style.setProperty('--mr-enemy', enemy);
    el.style.setProperty('--mr-local', player);
    el.innerHTML =
        `<div class="mr-frame">` +
        `<div class="mr-bg" aria-hidden="true">` +
        `<span class="mr-bg-glow mr-bg-glow-player"></span>` +
        `<span class="mr-bg-glow mr-bg-glow-enemy"></span>` +
        `<span class="mr-bg-core"></span>` +
        `</div>` +
        `<div class="mr-cols">` +
        teamHtml('player', entries.filter((e) => e.team === 'player')) +
        `<div class="mr-vs">VS</div>` +
        teamHtml('enemy', entries.filter((e) => e.team === 'enemy')) +
        `</div></div>`;
    cover.appendChild(el);
}

export function updateIntroRosterMmrs(
    cover: HTMLElement,
    updates: { name: string; mmr: number }[],
): void {
    const roster = cover.querySelector('.mechili-match-roster');
    if (!roster) return;
    for (const { name, mmr } of updates) {
        const row = roster.querySelector<HTMLElement>(
            `.mr-player[data-name="${CSS.escape(name)}"] .mr-mmr`,
        );
        if (row) {
            row.textContent = String(mmr);
            row.classList.remove('loading');
        }
    }
}

export function unmountIntroRoster(cover: HTMLElement | null): void {
    cover?.querySelector('.mechili-match-roster')?.remove();
}

/** Fetch MMR in the background — updates the cover roster when ready. */
export async function prefetchIntroRosterMmrs(
    cover: HTMLElement,
    entries: readonly IntroRosterEntry[],
): Promise<Map<string, number>> {
    const mmr = new Map<string, number>();
    for (const e of entries) {
        if (e.controller === 'ai') mmr.set(e.name, DEFAULT_MMR);
    }
    const humanNames = [...new Set(entries.filter((e) => e.controller === 'human').map((e) => e.name))];
    const results = await Promise.all(humanNames.map((name) => fetchPlayerPublic(name)));
    for (let i = 0; i < humanNames.length; i++) {
        const name = humanNames[i]!;
        const fetched = results[i];
        const cached = getCachedProfile();
        mmr.set(name, fetched?.mmr ?? (cached?.name === name ? cached.mmr : DEFAULT_MMR));
    }
    updateIntroRosterMmrs(
        cover,
        humanNames.map((name) => ({ name, mmr: mmr.get(name) ?? DEFAULT_MMR })),
    );
    return mmr;
}
