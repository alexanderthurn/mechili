import { buildingAbilities } from '../game/buildingAbilities';
import { START_CARDS, ROUND_CARDS, type RoundCard, type StartCard } from '../game/cards';
import { GAME_VERSION } from '../game/net';
import { TACTICS, formatTacticStats } from '../game/tactics';
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
import { openSuggest } from '../suggest';
import { createShowcaseViewer } from './modelViewer';
import { homepageStyles } from './styles';

const logoUrl = new URL('../../assets/ui/logo.webp', import.meta.url).href;
const menuBgUrl = new URL('../../assets/ui/menu-bg.webp', import.meta.url).href;
const iconUrl = new URL('../../icon.png', import.meta.url).href;
const feuerwareLogoUrl = new URL('../../assets/marketing/feuerware.webp', import.meta.url).href;
const steamLogoUrl = new URL('../../assets/marketing/steam-logo.png', import.meta.url).href;

/** Optional art for battle spells that have Tripo stills */
const TACTIC_ART: Partial<Record<string, string>> = {
    hammerOfGods: new URL(
        '../../assets/models/spells/hammer-of-gods/d2968c11-be8b-42db-8568-3e91102e2355-rendered_image.webp',
        import.meta.url,
    ).href,
    dragonAttack: new URL(
        '../../assets/models/spells/dragon/5feca8a4-bd39-4375-9ec2-849c497f3633-rendered_image.webp',
        import.meta.url,
    ).href,
    bigMeteor: new URL(
        '../../assets/models/spells/meteor-great/6e4dfbbf-4d47-40b5-81db-27726f0f2e15-rendered_image.webp',
        import.meta.url,
    ).href,
    meteorShower: new URL(
        '../../assets/models/spells/meteor-shard/50ac2b4b-1284-4082-806a-107eaa33281d-rendered_image.webp',
        import.meta.url,
    ).href,
    storm: new URL(
        '../../assets/models/spells/storm-cloud/142a3c63-8343-4a85-a851-4246e2029a67-rendered_image.webp',
        import.meta.url,
    ).href,
    poisonCloud: new URL(
        '../../assets/models/spells/poison-cloud/203dbb84-af0a-466d-8e14-074ce5c1fff8-rendered_image.webp',
        import.meta.url,
    ).href,
};

/** No Steam store page yet — buttons render disabled (no href) until this is a real app id. */
const STEAM_URL: string | null = null;
const PLAY_URL =
    location.hostname === 'melodan.com' || location.hostname === 'www.melodan.com'
        ? 'https://play.melodan.com/'
        : new URL('./index.html', location.href).href;

const SCREENSHOTS = [
    { file: '01.webp', label: 'Screenshot 1' },
    { file: '02.webp', label: 'Screenshot 2' },
    { file: '03.webp', label: 'Screenshot 3' },
    { file: '04.webp', label: 'Screenshot 4' },
].map((s) => ({
    src: new URL(`../../assets/marketing/screenshots/${s.file}`, import.meta.url).href,
    label: s.label,
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
    return (
        `<div class="c-title">${esc(c.title)}</div>` +
        `<div class="c-units">${esc(c.unitsLabel)}</div>` +
        `<div class="c-hp">♥ ${c.startingHp} HP</div>` +
        `<div class="c-desc">${esc(c.description)}</div>`
    );
}

function roundCardFace(c: RoundCard): string {
    const extras: string[] = [];
    if (c.unitsLabel) extras.push(c.unitsLabel);
    if (c.items?.length) extras.push(`Items: ${c.items.join(', ')}`);
    if (c.tactics?.length) extras.push(`Tactics: ${c.tactics.join(', ')}`);
    return (
        `<div class="c-title">${esc(c.title)}</div>` +
        (extras.length ? `<div class="c-units">${esc(extras.join(' · '))}</div>` : '') +
        `<div class="c-desc">${esc(c.description)}</div>` +
        `<div class="c-cost">${c.cost > 0 ? `⬢ ${c.cost}` : 'Free'}</div>`
    );
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
    const techs =
        t.techs.length > 0
            ? `<div class="mh-techs">
        <div class="mh-techs-label">Techs</div>
        <ul class="mh-tech-list">
          ${t.techs
              .map(
                  (tech) =>
                      `<li><span class="mh-tech-ico" aria-hidden="true">${techIcon(tech)}</span><span class="mh-tech-text"><strong>${esc(tech.name)}</strong> <span class="mh-tech-cost">⬢ ${tech.cost}</span><br /><span class="mh-tech-desc">${esc(techDescription(tech))}</span></span></li>`,
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
                      `<li><span class="mh-tech-ico" aria-hidden="true">${a.icon}</span><span class="mh-tech-text"><strong>${esc(a.name)}</strong>${a.cost !== undefined ? ` <span class="mh-tech-cost">⬢ ${a.cost}</span>` : ''}<br /><span class="mh-tech-desc">${esc(a.description)}</span></span></li>`,
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

function shotCard(shot: { src: string; label: string }, index: number): string {
    return `
<figure class="mh-shot" data-shot="${index}">
  <img src="${esc(shot.src)}" alt="${esc(shot.label)}" loading="lazy" data-placeholder="${esc(shot.label)}" />
</figure>`;
}

function tacticCard(t: (typeof TACTICS)[string]): string {
    const art = TACTIC_ART[t.id];
    const kindLabel = t.kind === 'placement' ? 'Placement' : 'One-shot';
    const stats = formatTacticStats(t);
    const media = art
        ? `<img class="mh-tactic-art" src="${esc(art)}" alt="" loading="lazy" />`
        : `<div class="mh-tactic-icon" aria-hidden="true">${t.icon}</div>`;
    const statsHtml = stats.length
        ? `<ul class="mh-tactic-stats">${stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
        : '';
    return `
<article class="mh-tactic">
  ${media}
  <div class="mh-tactic-body">
    <div class="mh-tactic-head">
      <span class="mh-tactic-emoji" aria-hidden="true">${t.icon}</span>
      <h3>${esc(t.name)}</h3>
    </div>
    <p class="mh-tactic-meta">${kindLabel} · ${esc(t.targeting)}</p>
    <p class="mh-tactic-desc">${esc(t.description)}</p>
    ${statsHtml}
  </div>
</article>`;
}

const ALL_TACTICS = Object.values(TACTICS);

const versionLabel = `v${__APP_VERSION__} · ${GAME_VERSION}`;
const first = BUILDINGS[0] ?? UNITS[0]!;

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

app.style.setProperty('--menu-bg', `url(${menuBgUrl})`);

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = iconUrl;
document.head.appendChild(favicon);

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
        <img class="mh-steam-logo" src="${esc(steamLogoUrl)}" alt="" width="56" height="56" />
        Coming Soon
      </span>
      <span class="mh-play-note">Ranked Multiplayer · Play with your Friends</span>`,
    )}
  </div>
</header>

<main class="mh-wrap">
  <section class="mh-section" id="screenshots">
    <h2>Screenshots</h2>
    <p class="mh-sub">A look at deployment and battle.</p>
    <div class="mh-shots">
      ${SCREENSHOTS.map(shotCard).join('')}
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
    <h2>Specialists</h2>
    <p class="mh-sub">Before round one, each player picks a specialist. It sets your starting army, HP pool, and a permanent speciality for the rest of the match.</p>
    <div class="mechili-cards">
      <div class="cards-row">
        ${START_CARDS.map((c) => `<div class="card static">${startCardFace(c)}</div>`).join('')}
      </div>
    </div>
  </section>

  <section class="mh-section" id="round-cards">
    <h2>Round cards</h2>
    <p class="mh-sub">From round two onward there is a chance to draft from a random offer. Cards grant packs, items, or tactic charges.</p>
    <div class="mechili-cards">
      <div class="cards-row">
        ${ROUND_CARDS.map((c) => `<div class="card static">${roundCardFace(c)}</div>`).join('')}
      </div>
    </div>
  </section>

  <section class="mh-section" id="tactics">
    <h2>Tactics &amp; spells</h2>
    <p class="mh-sub">These are the skills on your tactics strip <span class="mh-sep">⬢</span> rallies, spills, summons, and battle spells like the dragon’s fire breath. Some arrive as round cards; others come from buildings or specialities. Icons match what you see in-game.</p>
    <div class="mh-tactics">
      ${ALL_TACTICS.map(tacticCard).join('')}
    </div>
  </section>
  <section class="mh-section mh-together" id="suggest">
    <h2>Contribute</h2>
    <p class="mh-sub">Melodan is developed by a single person, me. I am passionate about this game, but i can not make an AAA title and keep everything perfect, balanced and so on. The idea is to have an open game where anybody can contribute. <br /><br />Let&rsquo;s make this together. Balance, bugs, features, art ideas <span class="mh-sep">⬢</span> send a short note and I will read it. If you want to do more, welcome!</p>
    <div class="mh-together-cta">
      <button type="button" class="mh-suggest-btn" id="mh-suggest-open">Suggest</button>
    </div>
    <div class="mh-community-body">
      <div class="mh-community-block">
        <h3>Ways to help</h3>
        <ul class="mh-help-list">
          <li>Share ideas and bug reports</li>
          <li>Open pull requests on <a href="https://github.com/alexanderthurn/mechili" rel="noopener noreferrer" target="_blank">GitHub</a> (GPL-3.0)</li>
          <li>Make or improve 3D models</li> 
          <li>Take care of balancing, invent new spells, cards, ideas.</li>
          <li>Welcome players, write guides, help with moderation if you want to take that on</li>
        </ul>
      </div>
      <div class="mh-community-block">
        <h3>3D models with Tripo3D</h3>
        <p>
          Most unit, building, and spell meshes are GLB files under the repo.
          Many were made with <a href="https://www.tripo3d.ai/" rel="noopener noreferrer" target="_blank">Tripo3D</a>
          (text or image to 3D), then exported as game-ready <strong>GLB / PBR</strong> with a reasonable polycount for crowds.
        </p>
        <p>
          Workflow sketch: concept <span class="mh-sep">⬢</span> Tripo <span class="mh-sep">⬢</span> export GLB
          <span class="mh-sep">⬢</span> pull request or Suggest with a link / file note.
          Animated characters may need a rig (ask if unsure). Contributed assets must be OK to ship with the game.
        </p>
      </div>
    </div>
  </section>
  <section class="mh-section mh-about-section" id="about">
    <h2>About</h2>
    <div class="mh-about">
      <a class="mh-about-brand" href="https://feuerware.com/" rel="noopener noreferrer" target="_blank">
        <img src="${esc(feuerwareLogoUrl)}" alt="Feuerware" width="320" height="64" />
      </a>
      <p class="mh-about-lead">
        MELODAN is made by <strong>Alexander Thurn</strong> at Feuerware.
      </p>
      <p>
        Inspired by <a href="https://www.playmechabellum.com/" rel="noopener noreferrer" target="_blank">Mechabellum</a>
        <span class="mh-sep">⬢</span>
        thank you for the spark. MELODAN is an independent fantasy take; please support the original.
      </p>
      <p>
        The game is <a href="https://github.com/alexanderthurn/mechili" rel="noopener noreferrer" target="_blank">open source on GitHub</a>
        (GPL-3.0). Copyright stays with Alexander Thurn / Feuerware. Feel free to fork it privately, invent new units, and open pull requests.
        For something bigger <span class="mh-sep">⬢</span> a new setting, a commercial spin-off, a full rebrand
        <span class="mh-sep">⬢</span>
        feel free to ask me at <a href="mailto:alex@feuerware.com">alex@feuerware.com</a>.
        Want to chip in? See <a href="#suggest">Suggest</a>.
      </p>
    </div>
  </section>
</main>

<footer class="mh-wrap mh-footer">
  <div class="mh-footer-links">
    <a href="${PLAY_URL}">Play</a>
    ${steamLink('', 'Steam')}
    <a href="#suggest" id="mh-footer-suggest">Suggest</a>
    <a href="https://feuerware.com/2025/imprint.html" rel="noopener noreferrer" target="_blank">Imprint</a>
    <a href="https://feuerware.com/2025/privacy.html" rel="noopener noreferrer" target="_blank">Data privacy</a>
  </div>
  <span>${esc(versionLabel)} · MELODAN · Feuerware</span>
</footer>

<aside class="mh-sticky-play" id="mh-sticky-play" aria-hidden="true">
  <button type="button" class="mh-sticky-btn suggest" id="mh-sticky-suggest">Suggest</button>
  <a class="mh-sticky-btn primary" href="${PLAY_URL}">Play in Browser</a>
  ${steamLink(
      'mh-sticky-btn steam',
      `<img class="mh-sticky-steam" src="${esc(steamLogoUrl)}" alt="" width="28" height="28" />
    Buy`,
  )}
</aside>
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
app.querySelector('#mh-sticky-suggest')?.addEventListener('click', openHomepageSuggest);
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

    for (const btn of picks) {
        btn.addEventListener('click', () => {
            const id = btn.dataset.unitId;
            if (!id) return;
            const type = SHOWCASE_UNITS.find((t) => t.id === id);
            if (!type) return;
            for (const p of picks) {
                p.classList.toggle('active', p === btn);
                p.setAttribute('aria-selected', p === btn ? 'true' : 'false');
            }
            viewer.show(type.id, type.meshScale);
            statsEl.innerHTML = statsHtml(type);
        });
    }
});
