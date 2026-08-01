import { buildingAbilities } from '../game/buildingAbilities';
import { START_CARDS, ROUND_RUNE_CARDS, type RoundCard, type StartCard } from '../game/cards';
import { DISPLAY } from '../game/displayNames';
import { forgeIngredientIcons } from '../game/forgeRecipes';
import { DEFAULT_SETTINGS, describeGameSettings, type SettingGroup } from '../game/settings';
import { TACTICS, formatTacticStats } from '../game/tactics';
import { techsForUnit } from '../game/techCatalog';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    UNIT_TYPES,
    preloadUnitVisuals,
    techDescription,
    techIcon,
    type UnitType,
} from '../game/units';
import { MODEL_SPECS } from '../game/unitModels';
import { hudStyles, menuStyles } from '../theme';
import { CardSpellTips, startCardFaceHtml } from '../ui/cardSpellTip';
import { roundCardFaceHtml } from '../ui/roundCardFace';
import { iconHtml } from '../ui/iconAtlas';
import { openSuggest } from '../suggest';
import { createShowcaseViewer } from './modelViewer';
import { homepageStyles } from './styles';

const logoUrl = new URL('../../assets/ui/logo.webp', import.meta.url).href;
const menuBgUrl = new URL('../../assets/ui/menu-bg.webp', import.meta.url).href;
const feuerwareLogoUrl = new URL('../../assets/marketing/feuerware.webp', import.meta.url).href;
const steamLogoUrl = new URL('../../assets/marketing/steam-logo.png', import.meta.url).href;

const STEAM_URL = 'https://steam.melodan.com';
const DISCORD_URL = 'https://discord.melodan.com';
const GITHUB_URL = 'https://github.melodan.com';
const TRAILER_URL = 'https://trailer.melodan.com';
const DEVLOG_URL = 'https://devlog.melodan.com';
const PLAY_URL =
    location.hostname === 'melodan.com' || location.hostname === 'www.melodan.com'
        ? 'https://play.melodan.com/'
        : new URL('./index.html', location.href).href;

const SCREENSHOT_DEFS = [
    { n: 1, label: 'Army deployment in the forest clearing' },
    { n: 2, label: 'Deployment phase and unit shop' },
    { n: 3, label: 'Dragon fire breath over the field' },
    { n: 4, label: 'Side-by-side deployment zones' },
    { n: 5, label: 'Mass battle on the plains' },
    { n: 6, label: 'Winter stronghold in the snow' },
    { n: 7, label: 'Dual bases on the grid' },
    { n: 8, label: 'Large fortified base' },
] as const;

const MORE_SCREENSHOTS = SCREENSHOT_DEFS.map((s) => ({
    src: new URL(`../../assets/marketing/screenshots/fullhd/screen_${s.n}.webp`, import.meta.url).href,
    fullhd: new URL(`../../assets/marketing/screenshots/fullhd/screen_${s.n}.jpg`, import.meta.url).href,
    raw4k: new URL(`../../assets/marketing/screenshots/4k/sc${s.n}.jpg`, import.meta.url).href,
    label: s.label,
}));

/** Small thumbs for the homepage grid (first four). */
const SCREENSHOTS = SCREENSHOT_DEFS.slice(0, 4).map((s, i) => ({
    src: new URL(`../../assets/marketing/screenshots/0${s.n}.webp`, import.meta.url).href,
    label: s.label,
    index: i,
}));

const SHOWCASE_UNITS: UnitType[] = [
    ...UNIT_TYPES,
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
].filter((t) => t.id in MODEL_SPECS);

const BUILDINGS = SHOWCASE_UNITS.filter((t) => t.structure);
const UNITS = SHOWCASE_UNITS.filter((t) => !t.structure);

function pickButtons(list: UnitType[], activeId: string): string {
    return list
        .map(
            (t) =>
                `<button type="button" class="mh-pick${t.id === activeId ? ' active' : ''}" role="option" aria-selected="${t.id === activeId}" data-unit-id="${esc(t.id)}" data-mesh-scale="${t.meshScale}">${esc(t.name)}</button>`,
        )
        .join('');
}

const DISCORD_ICON_SVG =
    `<svg class="mh-discord-icon" viewBox="0 0 127.14 96.36" width="22" height="17" aria-hidden="true" focusable="false">` +
    `<path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1A105.25 105.25 0 0 0 126.6 80.22c2.64-27.38-4.51-51.14-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53 91.08 65.69 84.69 65.69Z"/>` +
    `</svg>`;

const YOUTUBE_ICON_SVG =
    `<svg class="mh-youtube-icon" viewBox="0 0 24 24" width="22" height="16" aria-hidden="true" focusable="false">` +
    `<path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/>` +
    `</svg>`;

/** Renders a real link when STEAM_URL is set, otherwise an inert placeholder. */
function steamLink(className: string, inner: string): string {
    const cls = (className ? `${className} ` : '') + 'mh-steam-link';
    if (STEAM_URL) {
        return `<a class="${esc(cls)}" href="${esc(STEAM_URL)}" rel="noopener noreferrer" target="_blank">${inner}</a>`;
    }
    return `<span class="${esc(cls)} disabled" aria-disabled="true" title="Steam page coming soon">${inner}</span>`;
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function startCardFace(c: StartCard): string {
    return startCardFaceHtml(c);
}

function roundCardFace(c: RoundCard): string {
    return roundCardFaceHtml(c, { catalog: true });
}

function unitFlags(t: UnitType): string[] {
    const flags: string[] = [];
    if (t.flying) flags.push('Flying');
    if (t.structure) flags.push('Structure');
    if (t.extra) flags.push('Extra');
    if (t.targets.ground) flags.push('Attacks ground');
    if (t.targets.air) flags.push('Attacks air');
    if (t.shield) flags.push('Ward dome');
    if (t.rocket) flags.push('Homing bolt');
    return flags;
}

function statsHtml(t: UnitType): string {
    const flags = unitFlags(t)
        .map((f) => `<span class="mh-flag">${esc(f)}</span>`)
        .join('');
    const unitTechs = techsForUnit(t.id);
    const techs =
        unitTechs.length > 0
            ? `<div class="mh-techs">
        <div class="mh-techs-label">${DISPLAY.techs}</div>
        <ul class="mh-tech-list">
          ${unitTechs
              .map(
                  (tech) =>
                      `<li>${iconHtml(techIcon(tech), 'mh-tech-ico')}<span class="mh-tech-text"><strong>${esc(tech.name)}</strong> <span class="mh-tech-cost">⬢ ${tech.cost}</span><br /><span class="mh-tech-desc">${esc(techDescription(tech))}</span></span></li>`,
              )
              .join('')}
        </ul>
      </div>`
            : '';
    const abilities = buildingAbilities(t);
    const abilityBlock =
        abilities.length > 0
            ? `<div class="mh-techs">
        <div class="mh-techs-label">Abilities</div>
        <ul class="mh-tech-list">
          ${abilities
              .map(
                  (a) =>
                      `<li>${iconHtml(a.icon, 'mh-tech-ico')}<span class="mh-tech-text"><strong>${esc(a.name)}</strong>${a.cost !== undefined ? ` <span class="mh-tech-cost">⬢ ${a.cost}</span>` : ''}<br /><span class="mh-tech-desc">${esc(a.description)}</span></span></li>`,
              )
              .join('')}
        </ul>
      </div>`
            : '';
    return `
    <h3>${esc(t.name)}</h3>
    <dl class="mh-stat-grid">
      <dt>Cost</dt><dd>${t.cost}</dd>
      <dt>HP</dt><dd>${t.hp}</dd>
      <dt>Damage</dt><dd>${t.damage}</dd>
      <dt>Range</dt><dd>${t.range}</dd>
      <dt>Attack interval</dt><dd>${t.attackInterval}s</dd>
      <dt>Speed</dt><dd>${t.speed}</dd>
    </dl>
    ${flags ? `<div class="mh-flags">${flags}</div>` : ''}
    ${techs}
    ${abilityBlock}`;
}

function shotCard(shot: { src: string; label: string; index: number }): string {
    return `
<button type="button" class="mh-shot" data-shot="${shot.index}" aria-haspopup="dialog" aria-label="Open screenshot: ${esc(shot.label)}">
  <img src="${esc(shot.src)}" alt="${esc(shot.label)}" loading="lazy" data-placeholder="${esc(shot.label)}" />
</button>`;
}

function tacticCard(t: (typeof TACTICS)[string], isFirst: boolean): string {
    const kindLabel = t.kind === 'placement' ? 'Placement' : 'One-shot';
    const stats = formatTacticStats(t);
    const statsHtml = stats.length
        ? `<ul class="mh-tactic-stats">${stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
        : '';
    const forgeIcons = forgeIngredientIcons(t.id);
    const forgeHtml = forgeIcons.length
        ? `<div class="mh-tactic-forge" aria-label="Required runes">${forgeIcons
              .map((ico) => iconHtml(ico, 'mh-tactic-rune'))
              .join('')}</div>`
        : '';
    return `
<article class="mh-tactic${isFirst ? ' mh-active' : ''}" data-key="${esc(t.id)}">
  <div class="mh-tactic-icon" aria-hidden="true">${iconHtml(t.icon, 'mh-tactic-tile')}</div>
  <div class="mh-tactic-body">
    <div class="mh-tactic-head">
      <h3>${esc(t.name)}</h3>
    </div>
    <p class="mh-tactic-meta">${kindLabel} · ${esc(t.targeting)}</p>
    <p class="mh-tactic-desc">${esc(t.description)}</p>
    ${forgeHtml}
    ${statsHtml}
  </div>
</article>`;
}

// the homepage shows the defaults as if applyHordeMode had run (Single
// Player/Matchmaking's forced default), so horde mode reads as "on" here
// too instead of "unset" — describeGameSettings is shared with the
// in-game settings panel (see hud.ts/game.ts), which passes the REAL
// per-match settings instead of these defaults.
const SETTINGS_GROUPS: SettingGroup[] = describeGameSettings({
    ...DEFAULT_SETTINGS,
    hordePreset: 'medium',
});

function settingsGroupHtml(g: SettingGroup): string {
    return `
<div class="mh-settings-card">
  <h3>${esc(g.title)}</h3>
  <table class="mh-settings-table">
    <tbody>
      ${g.rows
          .map(
              (r) =>
                  `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}${r.note ? `<span class="mh-settings-desc">${esc(r.note)}</span>` : ''}</td></tr>`,
          )
          .join('')}
    </tbody>
  </table>
</div>`;
}

const ALL_TACTICS = Object.values(TACTICS);

const versionLabel = `v${__APP_VERSION__}`;
const first =
    BUILDINGS.find((t) => t.id === STRONGHOLD.id) ?? BUILDINGS[0] ?? UNITS[0]!;

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

app.style.setProperty('--menu-bg', `url(${menuBgUrl})`);

const style = document.createElement('style');
style.textContent = menuStyles() + hudStyles() + homepageStyles();
document.head.appendChild(style);

app.innerHTML = `
<header class="mh-hero mh-wrap">
  <div class="mh-brand">
    <img class="mh-logo" src="${esc(logoUrl)}" alt="MELODAN" width="520" height="180" />
    <p class="mh-version">${esc(versionLabel)}</p>
  </div>
  <p class="mh-tagline">FANTASY AUTO·BATTLER</p>
  <p class="mh-lead">Deploy armies in secret and watch the round play out. Your enemy does the same. Adapt, repeat until one of you runs out of HP.</p>
  <div class="mh-play">
    <a class="mh-play-btn primary" href="${PLAY_URL}">
      <span class="mh-play-title">Play in Browser</span>
      <span class="mh-play-note">Free to play · Single & Multiplayer</span>
    </a>
    ${steamLink(
        'mh-play-btn steam',
        `<span class="mh-play-title">
        <img class="mh-steam-logo" src="${esc(steamLogoUrl)}" alt="Steam" width="256" height="77" />
      </span>
      <span class="mh-play-note">Ranked Multiplayer · Play with Friends</span>`,
    )}
  </div>
  <a class="mh-trailer-btn" href="${esc(TRAILER_URL)}" rel="noopener noreferrer" target="_blank">
    ${YOUTUBE_ICON_SVG}
    <span>Watch Trailer</span>
  </a>
</header>

<main class="mh-wrap">
  <section class="mh-section" id="screenshots">
    <h2>Screenshots</h2>
    <p class="mh-sub">A look at deployment and battle.</p>
    <div class="mh-shots">
      ${SCREENSHOTS.map(shotCard).join('')}
    </div>
    <div class="mh-shots-more-wrap">
      <button type="button" class="mh-shots-more-btn" id="mh-shots-more" aria-haspopup="dialog">
        Browse screenshots
      </button>
    </div>
  </section>

  <section class="mh-section" id="units">
    <h2>Units &amp; buildings</h2>
    <p class="mh-sub">Your army and buildings. Pick one to inspect. </p>
    <div class="mh-showcase">
      <div class="mh-showcase-view">
        <canvas id="mh-unit-canvas" aria-label="Unit 3D preview"></canvas>
        <div class="mh-showcase-loading" id="mh-showcase-loading" aria-hidden="true">
          <span class="mh-showcase-spin" aria-hidden="true">⬢</span>
          Loading model&hellip;
        </div>
        <div class="mh-showcase-hint" id="mh-showcase-hint">Drag to rotate · Scroll to zoom</div>
      </div>
      <div class="mh-showcase-side">
        <select class="mh-card-select" id="mh-unit-select" aria-label="Choose a unit or building">
          <optgroup label="Buildings">
            ${BUILDINGS.map((t) => `<option value="${esc(t.id)}"${t.id === first.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </optgroup>
          <optgroup label="Units">
            ${UNITS.map((t) => `<option value="${esc(t.id)}"${t.id === first.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </optgroup>
        </select>
        <div class="mh-unit-picks" role="listbox" aria-label="Units and buildings">
          <div class="mh-pick-group">
            <div class="mh-pick-label">Buildings</div>
            <div class="mh-pick-row">${pickButtons(BUILDINGS, first.id)}</div>
          </div>
          <div class="mh-pick-group">
            <div class="mh-pick-label">Units</div>
            <div class="mh-pick-row">${pickButtons(UNITS, first.id)}</div>
          </div>
        </div>
        <div class="mh-unit-stats" id="mh-unit-stats">${statsHtml(first)}</div>
      </div>
    </div>
  </section>

  <section class="mh-section" id="specialists">
    <h2>${DISPLAY.commanders}</h2>
    <p class="mh-sub">Before round one, each player picks a ${DISPLAY.commander.toLowerCase()}. It sets your starting army, HP pool, a permanent speciality, and three Stronghold forge ${DISPLAY.tactics.toLowerCase()} (weak / mid / strong). Teammates share the union of their forge ${DISPLAY.tactics.toLowerCase()}.</p>
    <select class="mh-card-select" id="mh-specialists-select" aria-label="Choose a ${DISPLAY.commander.toLowerCase()}">
      ${START_CARDS.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}
    </select>
    <div class="mechili-cards">
      <div class="cards-row" id="mh-specialists-row">
        ${START_CARDS.map(
            (c, i) =>
                `<div class="card static${i === 0 ? ' mh-active' : ''}" data-key="${esc(c.id)}">${startCardFace(c)}</div>`,
        ).join('')}
      </div>
    </div>
  </section>

  <section class="mh-section" id="round-cards">
    <h2>Round cards</h2>
    <p class="mh-sub">From round two onward, draft one of several offered ${DISPLAY.items.toLowerCase()} cards drawn from the match pool. Forgeable battle spells come from the Stronghold, not cards.</p>
    <select class="mh-card-select" id="mh-round-cards-select" aria-label="Choose a round card">
      ${ROUND_RUNE_CARDS.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}
    </select>
    <div class="mechili-cards">
      <div class="cards-row" id="mh-round-cards-row">
        ${ROUND_RUNE_CARDS.map(
            (c, i) =>
                `<div class="card static${i === 0 ? ' mh-active' : ''}" data-key="${esc(c.id)}">${roundCardFace(c)}</div>`,
        ).join('')}
      </div>
    </div>
  </section>

  <section class="mh-section" id="tactics">
    <h2>${DISPLAY.tactics}</h2>
    <p class="mh-sub">These are the skills on your ${DISPLAY.tactics.toLowerCase()} strip <span class="mh-sep">⬢</span> rallies, spills, summons, and battle casts like the dragon’s fire breath. Most battle spells are forged at the Stronghold. Icons match what you see in-game.</p>
    <select class="mh-card-select" id="mh-tactics-select" aria-label="Choose a ${DISPLAY.tactic.toLowerCase()}">
      ${ALL_TACTICS.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
    </select>
    <div class="mh-tactics" id="mh-tactics-grid">
      ${ALL_TACTICS.map((t, i) => tacticCard(t, i === 0)).join('')}
    </div>
  </section>

  <section class="mh-section" id="settings">
    <h2>Match settings</h2>
    <p class="mh-sub">The default rules for a match, pulled straight from the game's settings code so this can't drift from what actually ships. Everything here is tunable &mdash; it's open source.</p>
    <div class="mh-settings-grid">
      ${SETTINGS_GROUPS.map(settingsGroupHtml).join('')}
    </div>
  </section>

  <section class="mh-section mh-together" id="suggest">
    <h2>Contribute</h2>
    <p class="mh-sub">Melodan is developed by a single person, me. I am passionate about this game, but i can not make an AAA title and keep everything perfect, balanced and so on. The idea is to have an open game where anybody can contribute. <br /><br />Let&rsquo;s make this together. Balance, bugs, features, art ideas <span class="mh-sep">⬢</span> send a short note and I will read it. If you want to do more, welcome!</p>
    <div class="mh-together-cta">
      <button type="button" class="mh-suggest-btn" id="mh-suggest-open">Send feedback</button>
      <a class="mh-suggest-btn mh-discord-btn" href="${esc(DISCORD_URL)}" rel="noopener noreferrer" target="_blank">${DISCORD_ICON_SVG} Discord</a>
      <a class="mh-trailer-btn" href="${esc(DEVLOG_URL)}" rel="noopener noreferrer" target="_blank">
        ${YOUTUBE_ICON_SVG}
        <span>Developer Log</span>
      </a>
    </div>
    <div class="mh-community-body">
      <div class="mh-community-block">
        <h3>Ways to help</h3>
        <ul class="mh-help-list">
          <li>Share ideas and bug reports</li>
          <li>Open pull requests on <a href="${esc(GITHUB_URL)}" rel="noopener noreferrer" target="_blank">GitHub</a> (GPL-3.0)</li>
          <li>Make or improve 3D models</li>
          <li>Take care of balancing, invent new spells, cards, ideas.</li>
          <li>Welcome players, write guides, help with moderation if you want to take that on</li>
        </ul>
      </div>
    </div>
  </section>
  <section class="mh-section mh-about-section" id="about">
    <h2>About</h2>
    <div class="mh-about">
      <a class="mh-about-brand" href="https://feuerware.com/" rel="noopener noreferrer" target="_blank">
        <img src="${esc(feuerwareLogoUrl)}" alt="Feuerware" width="307" height="307" />
      </a>
      <p class="mh-about-lead">
        MELODAN is made by Feuerware. A small team of germans who love to code and make games.
      </p>
      <p>
        This game is inspired by <a href="https://www.playmechabellum.com/" rel="noopener noreferrer" target="_blank">Mechabellum</a>
        thank you for the spark. MELODAN is an independent fantasy take; please support the original and buy Mechabelum. Thank you!
      </p>
      <p>
        The game is <a href="${esc(GITHUB_URL)}" rel="noopener noreferrer" target="_blank">open source on GitHub</a>
        (GPL-3.0). Copyright stays with Alexander Thurn / Feuerware. Feel free to fork it privately, invent new units, and open pull requests.
        For something bigger <span class="mh-sep">⬢</span> a new setting, a commercial spin-off, a full rebrand
        <span class="mh-sep">⬢</span>
        feel free to ask me at <a href="mailto:alex@feuerware.com">alex@feuerware.com</a>.
        Want to chip in? See <a href="#suggest">Contribute</a>.
      </p>
    </div>
  </section>
</main>

<footer class="mh-wrap mh-footer">
  <div class="mh-footer-links">
    <a href="${PLAY_URL}">Play</a>
    ${steamLink('', 'Steam')}
    <a href="#suggest" id="mh-footer-suggest">Feedback</a>
    <a href="https://feuerware.com/2025/imprint.html" rel="noopener noreferrer" target="_blank">Imprint</a>
    <a href="https://feuerware.com/2025/privacy.html" rel="noopener noreferrer" target="_blank">Data privacy</a>
  </div>
  <span>${esc(versionLabel)} · MELODAN · Feuerware</span>
</footer>

<aside class="mh-sticky-play" id="mh-sticky-play" aria-hidden="true">
  <a class="mh-sticky-btn discord icon-only" href="${esc(DISCORD_URL)}" rel="noopener noreferrer" target="_blank" aria-label="Discord" title="Discord">
    <svg class="mh-sticky-icon" viewBox="0 0 127.14 96.36" width="28" height="22" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1A105.25 105.25 0 0 0 126.6 80.22c2.64-27.38-4.51-51.14-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53 91.08 65.69 84.69 65.69Z"/>
    </svg>
  </a>
  <a class="mh-sticky-btn primary" href="${PLAY_URL}">Play in Browser</a>
  <a class="mh-sticky-btn steam icon-only mh-steam-link" href="${esc(STEAM_URL)}" rel="noopener noreferrer" target="_blank" aria-label="Steam" title="Steam">
    <img class="mh-sticky-icon mh-sticky-steam" src="${esc(steamLogoUrl)}" alt="" width="84" height="84" />
  </a>
</aside>

<dialog class="mh-lightbox" id="mh-lightbox" aria-label="Screenshot gallery">
  <div class="mh-lightbox-chrome">
    <p class="mh-lightbox-count" id="mh-lightbox-count" aria-live="polite"></p>
    <button type="button" class="mh-lightbox-close" id="mh-lightbox-close" aria-label="Close gallery">&times;</button>
  </div>
  <button type="button" class="mh-lightbox-nav prev" id="mh-lightbox-prev" aria-label="Previous screenshot">&#8249;</button>
  <button type="button" class="mh-lightbox-nav next" id="mh-lightbox-next" aria-label="Next screenshot">&#8250;</button>
  <div class="mh-lightbox-stage" id="mh-lightbox-stage">
    <img class="mh-lightbox-img" id="mh-lightbox-img" alt="" draggable="false" />
  </div>
  <div class="mh-lightbox-footer">
    <p class="mh-lightbox-caption" id="mh-lightbox-caption"></p>
    <div class="mh-lightbox-links">
      <a class="mh-lightbox-link" id="mh-lightbox-fullhd" href="#" target="_blank" rel="noopener noreferrer">Full HD</a>
      <a class="mh-lightbox-link" id="mh-lightbox-4k" href="#" target="_blank" rel="noopener noreferrer">4K</a>
    </div>
  </div>
  <div class="mh-lightbox-dots" id="mh-lightbox-dots" role="tablist" aria-label="Screenshots"></div>
</dialog>
`;

const heroPlay = app.querySelector('.mh-play');
const stickyPlay = app.querySelector<HTMLElement>('#mh-sticky-play');
const footerEl = app.querySelector('.mh-footer');
if (heroPlay && stickyPlay && typeof IntersectionObserver !== 'undefined') {
    let pastHero = false;
    let footerVisible = false;
    const syncSticky = () => {
        const show = pastHero && !footerVisible;
        stickyPlay.classList.toggle('visible', show);
        stickyPlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    };
    new IntersectionObserver(
        ([entry]) => {
            if (!entry) return;
            pastHero = !entry.isIntersecting;
            syncSticky();
        },
        { threshold: 0 },
    ).observe(heroPlay);
    if (footerEl) {
        new IntersectionObserver(
            ([entry]) => {
                if (!entry) return;
                footerVisible = entry.isIntersecting;
                syncSticky();
            },
            { threshold: 0, rootMargin: '0px 0px -8px 0px' },
        ).observe(footerEl);
    }
}

const openHomepageSuggest = () => {
    openSuggest({ parent: document.body, source: 'homepage', lightSpecs: true });
};
app.querySelector('#mh-suggest-open')?.addEventListener('click', openHomepageSuggest);
app.querySelector('#mh-footer-suggest')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('suggest')?.scrollIntoView({ behavior: 'smooth' });
    openHomepageSuggest();
});

for (const img of app.querySelectorAll<HTMLImageElement>('.mh-shot img')) {
    img.addEventListener('error', () => {
        const label = img.dataset.placeholder ?? 'Screenshot';
        const span = document.createElement('span');
        span.textContent = `${label} ⬢ drop file in assets/marketing/screenshots/`;
        img.replaceWith(span);
    });
}

{
    const lightbox = app.querySelector<HTMLDialogElement>('#mh-lightbox');
    const imgEl = app.querySelector<HTMLImageElement>('#mh-lightbox-img');
    const countEl = app.querySelector<HTMLElement>('#mh-lightbox-count');
    const captionEl = app.querySelector<HTMLElement>('#mh-lightbox-caption');
    const linkFullhd = app.querySelector<HTMLAnchorElement>('#mh-lightbox-fullhd');
    const link4k = app.querySelector<HTMLAnchorElement>('#mh-lightbox-4k');
    const dotsEl = app.querySelector<HTMLElement>('#mh-lightbox-dots');
    const stageEl = app.querySelector<HTMLElement>('#mh-lightbox-stage');
    const openBtn = app.querySelector<HTMLButtonElement>('#mh-shots-more');
    const closeBtn = app.querySelector<HTMLButtonElement>('#mh-lightbox-close');
    const prevBtn = app.querySelector<HTMLButtonElement>('#mh-lightbox-prev');
    const nextBtn = app.querySelector<HTMLButtonElement>('#mh-lightbox-next');
    let index = 0;

    if (lightbox && imgEl && countEl && captionEl && linkFullhd && link4k && dotsEl && stageEl && openBtn) {
        dotsEl.innerHTML = MORE_SCREENSHOTS.map(
            (s, i) =>
                `<button type="button" class="mh-lightbox-dot" role="tab" aria-label="${esc(s.label)}" data-index="${i}"></button>`,
        ).join('');
        const dots = [...dotsEl.querySelectorAll<HTMLButtonElement>('.mh-lightbox-dot')];

        const show = (i: number) => {
            const n = MORE_SCREENSHOTS.length;
            index = ((i % n) + n) % n;
            const shot = MORE_SCREENSHOTS[index]!;
            imgEl.src = shot.src;
            imgEl.alt = shot.label;
            countEl.textContent = `${index + 1} / ${n}`;
            captionEl.textContent = shot.label;
            linkFullhd.href = shot.fullhd;
            link4k.href = shot.raw4k;
            resetZoom(false);
            for (const [di, dot] of dots.entries()) {
                const on = di === index;
                dot.classList.toggle('active', on);
                dot.setAttribute('aria-selected', on ? 'true' : 'false');
            }
        };

        const open = (i = 0) => {
            show(i);
            if (!lightbox.open) lightbox.showModal();
        };
        const close = () => {
            if (lightbox.open) lightbox.close();
        };

        openBtn.addEventListener('click', () => open(0));
        for (const btn of app.querySelectorAll<HTMLButtonElement>('.mh-shot[data-shot]')) {
            btn.addEventListener('click', () => open(Number(btn.dataset.shot)));
        }
        closeBtn?.addEventListener('click', close);
        prevBtn?.addEventListener('click', () => show(index - 1));
        nextBtn?.addEventListener('click', () => show(index + 1));
        for (const dot of dots) {
            dot.addEventListener('click', () => show(Number(dot.dataset.index)));
        }

        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) close();
        });
        lightbox.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                show(index - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                show(index + 1);
            }
        });

        const MIN_SCALE = 1;
        const MAX_SCALE = 4;
        const pointers = new Map<number, { x: number; y: number }>();
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let mode: 'none' | 'swipe' | 'pan' | 'pinch' = 'none';
        let startX = 0;
        let startY = 0;
        let originPanX = 0;
        let originPanY = 0;
        let pinchStartDist = 0;
        let pinchStartScale = 1;
        let lastTapAt = 0;
        let lastTapX = 0;
        let lastTapY = 0;

        const applyTransform = (animated: boolean) => {
            imgEl.style.transition = animated ? 'transform 0.18s ease' : 'none';
            imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
            stageEl.classList.toggle('mh-lightbox-zoomed', scale > 1.02);
        };

        const clampPan = () => {
            if (scale <= 1.02) {
                panX = 0;
                panY = 0;
                return;
            }
            const rect = stageEl.getBoundingClientRect();
            const maxX = (rect.width * (scale - 1)) * 0.5;
            const maxY = (rect.height * (scale - 1)) * 0.5;
            panX = Math.max(-maxX, Math.min(maxX, panX));
            panY = Math.max(-maxY, Math.min(maxY, panY));
        };

        function resetZoom(animated: boolean): void {
            scale = 1;
            panX = 0;
            panY = 0;
            mode = 'none';
            pointers.clear();
            applyTransform(animated);
        }

        const pointerList = () => [...pointers.values()];
        const distBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
            Math.hypot(a.x - b.x, a.y - b.y);

        stageEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            stageEl.setPointerCapture(e.pointerId);
            imgEl.style.transition = 'none';

            if (pointers.size >= 2) {
                const [a, b] = pointerList();
                if (!a || !b) return;
                mode = 'pinch';
                pinchStartDist = distBetween(a, b) || 1;
                pinchStartScale = scale;
                return;
            }

            startX = e.clientX;
            startY = e.clientY;
            originPanX = panX;
            originPanY = panY;
            mode = scale > 1.02 ? 'pan' : 'swipe';
        });

        stageEl.addEventListener('pointermove', (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (mode === 'pinch' && pointers.size >= 2) {
                const [a, b] = pointerList();
                if (!a || !b) return;
                const d = distBetween(a, b) || 1;
                scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScale * (d / pinchStartDist)));
                clampPan();
                applyTransform(false);
                return;
            }

            if (mode === 'pan') {
                panX = originPanX + (e.clientX - startX);
                panY = originPanY + (e.clientY - startY);
                clampPan();
                applyTransform(false);
                return;
            }

            if (mode === 'swipe') {
                const dx = e.clientX - startX;
                imgEl.style.transform = `translateX(${dx}px)`;
                return;
            }

            if (e.pointerType === 'touch' || scale > 1.02) return;
            const rect = stageEl.getBoundingClientRect();
            stageEl.classList.toggle('mh-lightbox-left', e.clientX < rect.left + rect.width / 2);
            stageEl.classList.toggle('mh-lightbox-right', e.clientX >= rect.left + rect.width / 2);
        });

        const endPointer = (e: PointerEvent) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (stageEl.hasPointerCapture(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);

            if (pointers.size >= 2) {
                const [a, b] = pointerList();
                if (a && b) {
                    mode = 'pinch';
                    pinchStartDist = distBetween(a, b) || 1;
                    pinchStartScale = scale;
                }
                return;
            }

            if (pointers.size === 1) {
                const remaining = pointerList()[0]!;
                startX = remaining.x;
                startY = remaining.y;
                originPanX = panX;
                originPanY = panY;
                mode = scale > 1.02 ? 'pan' : 'swipe';
                applyTransform(false);
                return;
            }

            const endedMode = mode;
            mode = 'none';
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (endedMode === 'pinch') {
                if (scale < 1.05) resetZoom(true);
                else applyTransform(true);
                return;
            }

            if (endedMode === 'pan') {
                applyTransform(true);
                return;
            }

            if (endedMode === 'swipe') {
                imgEl.style.transition = '';
                if (scale <= 1.02) imgEl.style.transform = '';
                else applyTransform(false);

                if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) {
                    show(dx < 0 ? index + 1 : index - 1);
                    return;
                }
                if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
                    const now = performance.now();
                    const isDoubleTap =
                        now - lastTapAt < 320 &&
                        Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 36;
                    lastTapAt = now;
                    lastTapX = e.clientX;
                    lastTapY = e.clientY;
                    if (isDoubleTap) {
                        if (scale > 1.02) resetZoom(true);
                        else {
                            scale = 2.4;
                            panX = 0;
                            panY = 0;
                            clampPan();
                            applyTransform(true);
                        }
                        return;
                    }
                    const rect = stageEl.getBoundingClientRect();
                    show(e.clientX < rect.left + rect.width / 2 ? index - 1 : index + 1);
                }
            }
        };

        stageEl.addEventListener('pointerup', endPointer);
        stageEl.addEventListener('pointercancel', endPointer);
        stageEl.addEventListener('pointerleave', () => {
            if (mode !== 'none') return;
            stageEl.classList.remove('mh-lightbox-left', 'mh-lightbox-right');
        });

        stageEl.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const factor = Math.exp(-e.deltaY * 0.0015);
                const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
                if (next === scale) return;
                scale = next;
                if (scale <= 1.02) {
                    resetZoom(false);
                    return;
                }
                clampPan();
                applyTransform(false);
            },
            { passive: false },
        );

        lightbox.addEventListener('close', () => resetZoom(false));
    }
}

const canvas = app.querySelector<HTMLCanvasElement>('#mh-unit-canvas')!;
const statsEl = app.querySelector<HTMLElement>('#mh-unit-stats')!;
const picks = app.querySelectorAll<HTMLButtonElement>('.mh-pick');

const showcaseLoading = app.querySelector<HTMLElement>('#mh-showcase-loading')!;
const showcaseHint = app.querySelector<HTMLElement>('#mh-showcase-hint')!;

void preloadUnitVisuals().then(() => {
    const viewer = createShowcaseViewer(canvas);
    viewer.show(first.id, first.meshScale);
    showcaseLoading.remove();
    showcaseHint.classList.add('visible');
    const hideHint = () => showcaseHint.classList.remove('visible');
    canvas.addEventListener('pointerdown', hideHint, { once: true });
    canvas.addEventListener('wheel', hideHint, { once: true, passive: true });

    const unitSelect = app.querySelector<HTMLSelectElement>('#mh-unit-select');

    function selectUnit(id: string): void {
        const type = SHOWCASE_UNITS.find((t) => t.id === id);
        if (!type) return;
        for (const p of picks) {
            p.classList.toggle('active', p.dataset.unitId === id);
            p.setAttribute('aria-selected', p.dataset.unitId === id ? 'true' : 'false');
        }
        if (unitSelect) unitSelect.value = id;
        viewer.show(type.id, type.meshScale);
        statsEl.innerHTML = statsHtml(type);
    }

    for (const btn of picks) {
        btn.addEventListener('click', () => {
            const id = btn.dataset.unitId;
            if (id) selectUnit(id);
        });
    }
    unitSelect?.addEventListener('change', () => selectUnit(unitSelect.value));
});

/** Mobile-only: a <select> drives which single card/tactic stays visible (see .mh-card-select CSS). */
function wireCardSelect(selectId: string, cardSelector: string): void {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    const cards = document.querySelectorAll<HTMLElement>(cardSelector);
    select.addEventListener('change', () => {
        for (const card of cards) {
            card.classList.toggle('mh-active', card.dataset.key === select.value);
        }
    });
}
wireCardSelect('mh-specialists-select', '#mh-specialists-row > .card');
wireCardSelect('mh-round-cards-select', '#mh-round-cards-row > .card');
wireCardSelect('mh-tactics-select', '#mh-tactics-grid > .mh-tactic');

const commanderSpellTips = new CardSpellTips();
const specialistsRow = document.getElementById('mh-specialists-row');
if (specialistsRow) commanderSpellTips.bind(specialistsRow);
const roundCardsRow = document.getElementById('mh-round-cards-row');
if (roundCardsRow) commanderSpellTips.bind(roundCardsRow);
