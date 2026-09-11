import { buildingAbilities } from '../game/buildingAbilities';
import { START_CARDS, ROUND_RUNE_CARDS, type RoundCard, type StartCard } from '../game/cards';
import { DISPLAY } from '../game/displayNames';
import { DEFAULT_SETTINGS, describeGameSettings, type SettingGroup } from '../game/settings';
import { ADVANCED_RUNE_IDS, BASE_RUNE_IDS, ITEMS, itemSlotLimit, type ItemDef } from '../game/items';
import { FORGE_RECIPES } from '../game/forgeRecipes';
import {
    MOVE_UNIT_ID,
    RALLY_ROUTE_ID,
    SELL_UNIT_ID,
    TACTICS,
    TUTOR_ID,
    formatTacticStats,
} from '../game/tactics';
import { techsForUnit } from '../game/techCatalog';
import {
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
    UNIT_TYPES,
    isPlayerBuyable,
    preloadUnitVisuals,
    techDescription,
    techIcon,
    type UnitType,
} from '../game/units';
import { MODEL_SPECS } from '../game/unitModels';
import { type SpellAssetId } from '../game/spellAssets';
import { initI18n, t, setLanguage, LANGUAGE_IDS, LANGUAGE_NATIVE_NAMES, type LanguageId } from '../i18n';
import {
    commanderTitle,
    itemDescription,
    itemName,
    midTerm,
    roundCardTitle,
    tacticDescription,
    tacticName,
    techName,
    unitName,
} from '../i18n/format';
import { prefs, updatePrefs, applySteamLanguageDefault } from '../game/prefs';
import { applyLanguageFont, hudStyles, menuStyles } from '../theme';
import { CardSpellTips, startCardFaceHtml } from '../ui/cardSpellTip';
import { roundCardFaceHtml } from '../ui/roundCardFace';
import { cssUrl, iconHtml, moneyHtml } from '../ui/iconAtlas';
import { openSuggest } from '../suggest';
import { createShowcaseViewer } from '../ui/modelViewer';
import { homepageStyles } from './styles';

/**
 * The homepage is its own Vite entry (web.html) — nothing boots i18n for it the
 * way src/main.ts does for the game. Language follows the shared prefs key
 * (same as in-game Settings); first visit uses Steam game language when available,
 * otherwise the device language. Everything
 * below this line reads copy through t() while the module body runs, so this
 * has to stay ahead of any string lookups.
 */
const language = await initI18n(await applySteamLanguageDefault());
await applyLanguageFont(language);

const logoUrl = new URL('../../assets/ui/logo.webp', import.meta.url).href;
const menuBgUrl = new URL('../../assets/ui/menu-bg.webp', import.meta.url).href;
const feuerwareLogoUrl = new URL('../../assets/marketing/feuerware.webp', import.meta.url).href;
const steamLogoSmallUrl = new URL('../../assets/marketing/steam-logo-small.png', import.meta.url).href;

const STEAM_URL = 'https://steam.melodan.com';
const DISCORD_URL = 'https://discord.melodan.com';
const GITHUB_URL = 'https://github.melodan.com';
const TRAILER_URL = 'https://trailer.melodan.com';
const DEVLOG_URL = 'https://devlog.melodan.com';
const PLAY_URL =
    location.hostname === 'melodan.com' || location.hostname === 'www.melodan.com'
        ? 'https://play.melodan.com/'
        : new URL('./index.html', location.href).href;

const SCREENSHOT_DEFS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    n,
    label: t(`homepage:shot.${n}`),
}));

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

/** GLB key for the showcase viewer (`modelId` when a type shares a mesh). */
function showcaseModelKey(t: UnitType): string {
    return t.modelId ?? t.id;
}

/** Distinct The Komtur packs — skip spawn-only brood duplicate. */
function isHordeShowcaseUnit(t: UnitType): boolean {
    return !t.structure && !isPlayerBuyable(t) && t.id.startsWith('horde') && t.id !== 'hordeBrutSpawn';
}

const SHOWCASE_UNITS: UnitType[] = [
    ...UNIT_TYPES,
    COMMAND_TOWER,
    RESEARCH_CENTER,
    STRONGHOLD,
].filter(
    (t) =>
        showcaseModelKey(t) in MODEL_SPECS &&
        (t.structure || isPlayerBuyable(t) || isHordeShowcaseUnit(t)),
);

const BUILDINGS = SHOWCASE_UNITS.filter((t) => t.structure);
const UNITS = SHOWCASE_UNITS.filter((t) => !t.structure && isPlayerBuyable(t));
const HORDE_UNITS = SHOWCASE_UNITS.filter((t) => isHordeShowcaseUnit(t));

/** Spell GLBs for the 3D showcase (not army units — preview-only). */
const SHOWCASE_SPELL_IDS: SpellAssetId[] = [
    'dragon',
    'hammer',
    'meteor-great',
    'meteor-shard',
    'storm',
    'poison',
];

const SHOWCASE_SPELLS: { id: SpellAssetId; name: string; blurb: string }[] = SHOWCASE_SPELL_IDS.map(
    (id) => ({
        id,
        name: t(`homepage:spell.${id}.name`),
        blurb: t(`homepage:spell.${id}.blurb`),
    }),
);

function pickButtons(list: UnitType[], activeId: string): string {
    return list
        .map(
            (t) =>
                `<button type="button" class="mh-pick${t.id === activeId ? ' active' : ''}" role="option" aria-selected="${t.id === activeId}" data-unit-id="${esc(t.id)}" data-mesh-scale="${t.meshScale}">${esc(unitName(t.id, t.name))}</button>`,
        )
        .join('');
}

function spellPickButtons(activeSpellId: string | null): string {
    return SHOWCASE_SPELLS.map(
        (s) =>
            `<button type="button" class="mh-pick${s.id === activeSpellId ? ' active' : ''}" role="option" aria-selected="${s.id === activeSpellId}" data-spell-id="${esc(s.id)}">${esc(s.name)}</button>`,
    ).join('');
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
    return `<span class="${esc(cls)} disabled" aria-disabled="true" title="${esc(t('homepage:hero.steamSoon'))}">${inner}</span>`;
}

/** The GitHub link, ready to drop into a `{{github}}` slot in translated copy. */
function githubLink(label: string): string {
    return `<a href="${esc(GITHUB_URL)}" rel="noopener noreferrer" target="_blank">${esc(label)}</a>`;
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

function unitFlags(type: UnitType): string[] {
    const flags: string[] = [];
    if (type.flying) flags.push(t('homepage:flag.flying'));
    if (type.structure) flags.push(t('homepage:flag.structure'));
    if (type.extra) flags.push(t('homepage:flag.extra'));
    if (type.targets.ground) flags.push(t('homepage:flag.attacksGround'));
    if (type.targets.air) flags.push(t('homepage:flag.attacksAir'));
    if (type.shield) flags.push(t('homepage:flag.shield'));
    if (type.rocket) flags.push(t('homepage:flag.rocket'));
    return flags;
}

function statsHtml(type: UnitType): string {
    const flags = unitFlags(type)
        .map((f) => `<span class="mh-flag">${esc(f)}</span>`)
        .join('');
    const unitTechs = techsForUnit(type.id);
    const techs =
        unitTechs.length > 0
            ? `<div class="mh-techs">
        <div class="mh-techs-label">${DISPLAY.techs}</div>
        <ul class="mh-tech-list">
          ${unitTechs
              .map(
                  (tech) =>
                      `<li>${iconHtml(techIcon(tech), 'mh-tech-ico')}<span class="mh-tech-text"><strong>${esc(techName(tech.id, tech.name))}</strong> <span class="mh-tech-cost">${moneyHtml(tech.cost)}</span><br /><span class="mh-tech-desc">${esc(techDescription(tech))}</span></span></li>`,
              )
              .join('')}
        </ul>
      </div>`
            : '';
    const abilities = buildingAbilities(type);
    const abilityBlock =
        abilities.length > 0
            ? `<div class="mh-techs">
        <div class="mh-techs-label">${esc(t('homepage:stats.abilities'))}</div>
        <ul class="mh-tech-list">
          ${abilities
              .map(
                  (a) =>
                      `<li>${iconHtml(a.icon, 'mh-tech-ico')}<span class="mh-tech-text"><strong>${esc(a.name)}</strong>${a.cost !== undefined ? ` <span class="mh-tech-cost">${moneyHtml(a.cost)}</span>` : ''}<br /><span class="mh-tech-desc">${esc(a.description)}</span></span></li>`,
              )
              .join('')}
        </ul>
      </div>`
            : '';
    return `
    <h3>${esc(unitName(type.id, type.name))}</h3>
    <dl class="mh-stat-grid">
      <dt>${esc(t('homepage:stats.cost'))}</dt><dd>${type.cost}</dd>
      <dt>${esc(t('homepage:stats.hp'))}</dt><dd>${type.hp}</dd>
      <dt>${esc(t('homepage:stats.damage'))}</dt><dd>${type.damage}</dd>
      <dt>${esc(t('homepage:stats.range'))}</dt><dd>${type.range}</dd>
      <dt>${esc(t('homepage:stats.attackInterval'))}</dt><dd>${esc(t('homepage:stats.seconds', { value: type.attackInterval }))}</dd>
      <dt>${esc(t('homepage:stats.speed'))}</dt><dd>${type.speed}</dd>
    </dl>
    ${flags ? `<div class="mh-flags">${flags}</div>` : ''}
    ${techs}
    ${abilityBlock}`;
}

function spellStatsHtml(spell: (typeof SHOWCASE_SPELLS)[number]): string {
    return `
    <h3>${esc(spell.name)}</h3>
    <p class="mh-sub" style="margin:0.4rem 0 0">${esc(spell.blurb)}</p>
    <div class="mh-flags"><span class="mh-flag">${esc(t('homepage:stats.spellModel'))}</span></div>`;
}

function shotCard(shot: { src: string; label: string; index: number }): string {
    return `
<button type="button" class="mh-shot" data-shot="${shot.index}" aria-haspopup="dialog" aria-label="${esc(t('homepage:screenshots.open', { label: shot.label }))}">
  <img src="${esc(shot.src)}" alt="${esc(shot.label)}" loading="lazy" data-placeholder="${esc(shot.label)}" />
</button>`;
}

/**
 * Where a tactic's price lives depends on which building sells it. The eleven
 * commander spells carry their own `strongholdCost`; the Vanguard's one-time
 * buys are match settings, so read them from there rather than copying the
 * numbers and letting them drift.
 */
const VANGUARD_TACTIC_COST: Record<string, number> = {
    [RALLY_ROUTE_ID]: DEFAULT_SETTINGS.rallyRoute.abilityCost,
    [MOVE_UNIT_ID]: DEFAULT_SETTINGS.movePack.abilityCost,
    [SELL_UNIT_ID]: DEFAULT_SETTINGS.sell.abilityCost,
    // NOTE: Field Lesson has no purchase action yet — it only arrives on a
    // commander card. Listed at its intended price so the catalog is complete.
    [TUTOR_ID]: 100,
};

function tacticPrice(tactic: (typeof TACTICS)[string]): { cost: number; where: string } | null {
    if (tactic.strongholdCost !== undefined) {
        return { cost: tactic.strongholdCost, where: unitName(STRONGHOLD.id, STRONGHOLD.name) };
    }
    const vanguard = VANGUARD_TACTIC_COST[tactic.id];
    return vanguard === undefined
        ? null
        : { cost: vanguard, where: unitName(COMMAND_TOWER.id, COMMAND_TOWER.name) };
}

/** Base runes the forge turns into this one, in recipe order. */
function runeRecipeIcons(runeId: string): string[] {
    const recipe = FORGE_RECIPES.find(
        (r) => r.product.kind === 'item' && r.product.id === runeId,
    );
    if (!recipe) return [];
    return recipe.ingredients
        .map((id) => ITEMS[id]?.icon)
        .filter((ico): ico is string => !!ico);
}

function runeCard(item: ItemDef, isBase: boolean, isFirst: boolean): string {
    // One price tag either way — a base rune is bought, a forged one is paid for
    // in ingredients plus the forge fee, so the band shows whichever applies.
    const recipe = isBase ? [] : runeRecipeIcons(item.id);
    const costHtml = isBase
        ? `<div class="mh-tactic-cost" title="${esc(t('homepage:runes.shopTitle'))}" aria-label="${esc(t('homepage:runes.shopLabel'))}">${DEFAULT_SETTINGS.deploy.baseRuneCost}</div>`
        : `<div class="mh-tactic-cost" title="${esc(t('homepage:runes.forgeTitle', { building: unitName(STRONGHOLD.id, STRONGHOLD.name) }))}" aria-label="${esc(t('homepage:runes.forgeLabel'))}">${recipe
              .map((ico) => iconHtml(ico, 'mh-cost-rune'))
              .join('')}<span class="mh-cost-plus">+</span>${item.forgeCost ?? 0}</div>`;
    return `
<article class="mh-tactic mh-rune${isFirst ? ' mh-active' : ''}" data-key="${esc(item.id)}">
  <span class="mh-rune-tag${isBase ? '' : ' forged'}">${esc(t(isBase ? 'homepage:runes.base' : 'homepage:runes.advanced'))}</span>
  <div class="mh-tactic-icon" aria-hidden="true">${iconHtml(item.icon, 'mh-tactic-tile')}</div>
  <div class="mh-tactic-body">
    <div class="mh-tactic-head">
      <h3>${esc(itemName(item.id, item.name))}</h3>
    </div>
    <p class="mh-tactic-desc">${esc(itemDescription(item.id, item.description))}</p>
    ${costHtml}
  </div>
</article>`;
}

function tacticCard(tactic: (typeof TACTICS)[string], isFirst: boolean): string {
    const kindLabel = t(
        tactic.kind === 'placement' ? 'homepage:tactics.placement' : 'homepage:tactics.oneShot',
    );
    const stats = formatTacticStats(tactic);
    const statsHtml = stats.length
        ? `<ul class="mh-tactic-stats">${stats.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
        : '';
    // Price replaces the old rune row: tactics are bought now, so what a player
    // wants to see is the supply, not a recipe.
    const price = tacticPrice(tactic);
    const costHtml = price
        ? `<div class="mh-tactic-cost" title="${esc(t('homepage:tactics.buyTitle', { building: price.where }))}" aria-label="${esc(t('homepage:tactics.priceLabel', { building: price.where }))}">${price.cost}</div>`
        : '';
    return `
<article class="mh-tactic${isFirst ? ' mh-active' : ''}" data-key="${esc(tactic.id)}">
  <div class="mh-tactic-icon" aria-hidden="true">${iconHtml(tactic.icon, 'mh-tactic-tile')}</div>
  <div class="mh-tactic-body">
    <div class="mh-tactic-head">
      <h3>${esc(tacticName(tactic.id, tactic.name))}</h3>
    </div>
    <p class="mh-tactic-meta">${esc(kindLabel)} · ${esc(t(`homepage:targeting.${tactic.targeting}`))}</p>
    <p class="mh-tactic-desc">${esc(tacticDescription(tactic.id, tactic.description))}</p>
    ${statsHtml}
    ${costHtml}
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
    hordePreset: 'low',
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

/** Base runes first, then the forged ones — the order a player meets them. */
const ALL_RUNES: { item: ItemDef; isBase: boolean }[] = [
    ...BASE_RUNE_IDS.map((id) => ({ item: ITEMS[id]!, isBase: true })),
    ...ADVANCED_RUNE_IDS.map((id) => ({ item: ITEMS[id]!, isBase: false })),
].filter((e) => !!e.item);

const ALL_TACTICS = Object.values(TACTICS);

/** The hex divider that breaks a lead paragraph in two — passed into copy so
 *  translators keep one whole sentence per key instead of two halves. */
const SEP = '<span class="mh-sep">⬢</span>';

const versionLabel = `v${__APP_VERSION__}`;
const first =
    BUILDINGS.find((t) => t.id === STRONGHOLD.id) ?? BUILDINGS[0] ?? UNITS[0]!;

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

app.style.setProperty('--menu-bg', cssUrl(menuBgUrl));

const style = document.createElement('style');
style.textContent = menuStyles() + hudStyles() + homepageStyles();
document.head.appendChild(style);

app.innerHTML = `
<label class="mh-lang">
  <svg class="mh-lang-globe" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25"/>
    <ellipse cx="8" cy="8" rx="2.6" ry="6.25" fill="none" stroke="currentColor" stroke-width="1.1"/>
    <path d="M2.1 8h11.8M3.2 4.8h9.6M3.2 11.2h9.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  </svg>
  <select class="mh-lang-select" aria-label="${esc(t('common:language'))}">
    ${LANGUAGE_IDS.map(
        (id) =>
            `<option value="${id}"${id === language ? ' selected' : ''}>${LANGUAGE_NATIVE_NAMES[id]}</option>`,
    ).join('')}
  </select>
</label>

<header class="mh-hero mh-wrap">
  <div class="mh-brand">
    <img class="mh-logo" src="${esc(logoUrl)}" alt="MELODAN" width="520" height="180" />
    <p class="mh-version">${esc(versionLabel)}</p>
  </div>
  <p class="mh-tagline">${esc(t('homepage:tagline'))}</p>
  <p class="mh-lead">${esc(t('homepage:lead'))}</p>
  <div class="mh-play mh-hero-ctas">
    ${steamLink(
        'mh-play-btn steam',
        `<span class="mh-play-title">
        <span class="mh-steam-cta-icon-wrap" aria-hidden="true">
          <img class="mh-steam-cta-icon" src="${esc(steamLogoSmallUrl)}" alt="" width="84" height="84" />
        </span>
        ${esc(t('homepage:hero.wishlist'))}
      </span>`,
    )}
    <a class="mh-trailer-btn" href="${esc(TRAILER_URL)}" rel="noopener noreferrer" target="_blank">
      ${YOUTUBE_ICON_SVG}
      <span>${esc(t('homepage:hero.trailer'))}</span>
    </a>
  </div>
</header>

<main class="mh-wrap">
  <section class="mh-section" id="screenshots">
    <h2>${esc(t('homepage:screenshots.title'))}</h2>
    <p class="mh-sub">${esc(t('homepage:screenshots.sub'))}</p>
    <div class="mh-shots">
      ${SCREENSHOTS.map(shotCard).join('')}
    </div>
    <div class="mh-shots-more-wrap">
      <button type="button" class="mh-shots-more-btn" id="mh-shots-more" aria-haspopup="dialog">
        ${esc(t('homepage:screenshots.browse'))}
      </button>
    </div>
  </section>

  <section class="mh-section" id="units">
    <h2>${esc(t('homepage:showcase.title'))}</h2>
    <p class="mh-sub">${esc(t('homepage:showcase.sub', { horde: DISPLAY.horde }))}</p>
    <div class="mh-showcase">
      <div class="mh-showcase-view">
        <canvas id="mh-unit-canvas" aria-label="${esc(t('homepage:showcase.canvas'))}"></canvas>
        <div class="mh-showcase-loading" id="mh-showcase-loading" aria-hidden="true">
          <span class="mh-showcase-spin" aria-hidden="true">⬢</span>
          ${esc(t('homepage:showcase.loading'))}
        </div>
        <div class="mh-showcase-hint" id="mh-showcase-hint">${esc(t('homepage:showcase.hint'))}</div>
      </div>
      <div class="mh-showcase-side">
        <select class="mh-card-select" id="mh-unit-select" aria-label="${esc(t('homepage:showcase.select'))}">
          <optgroup label="${esc(t('homepage:showcase.buildings'))}">
            ${BUILDINGS.map((type) => `<option value="${esc(type.id)}"${type.id === first.id ? ' selected' : ''}>${esc(unitName(type.id, type.name))}</option>`).join('')}
          </optgroup>
          <optgroup label="${esc(t('homepage:showcase.units'))}">
            ${UNITS.map((type) => `<option value="${esc(type.id)}"${type.id === first.id ? ' selected' : ''}>${esc(unitName(type.id, type.name))}</option>`).join('')}
          </optgroup>
          <optgroup label="${esc(DISPLAY.horde)}">
            ${HORDE_UNITS.map((type) => `<option value="${esc(type.id)}"${type.id === first.id ? ' selected' : ''}>${esc(unitName(type.id, type.name))}</option>`).join('')}
          </optgroup>
          <optgroup label="${esc(t('homepage:showcase.spells'))}">
            ${SHOWCASE_SPELLS.map((s) => `<option value="spell:${esc(s.id)}">${esc(s.name)}</option>`).join('')}
          </optgroup>
        </select>
        <div class="mh-unit-picks" role="listbox" aria-label="${esc(t('homepage:showcase.list'))}">
          <div class="mh-pick-group">
            <div class="mh-pick-label">${esc(t('homepage:showcase.buildings'))}</div>
            <div class="mh-pick-row">${pickButtons(BUILDINGS, first.id)}</div>
          </div>
          <div class="mh-pick-group">
            <div class="mh-pick-label">${esc(t('homepage:showcase.units'))}</div>
            <div class="mh-pick-row">${pickButtons(UNITS, first.id)}</div>
          </div>
          <div class="mh-pick-group">
            <div class="mh-pick-label">${esc(DISPLAY.horde)}</div>
            <div class="mh-pick-row">${pickButtons(HORDE_UNITS, first.id)}</div>
          </div>
          <div class="mh-pick-group">
            <div class="mh-pick-label">${esc(t('homepage:showcase.spells'))}</div>
            <div class="mh-pick-row">${spellPickButtons(null)}</div>
          </div>
        </div>
        <div class="mh-unit-stats" id="mh-unit-stats">${statsHtml(first)}</div>
      </div>
    </div>
  </section>

  <section class="mh-section" id="specialists">
    <h2>${esc(DISPLAY.commanders)}</h2>
    <p class="mh-sub">${esc(
        t('homepage:commanders.sub', {
            commander: midTerm(DISPLAY.commander),
            tactics: midTerm(DISPLAY.tactics),
        }),
    )}</p>
    <select class="mh-card-select" id="mh-specialists-select" aria-label="${esc(
        t('homepage:commanders.select', { commander: midTerm(DISPLAY.commander) }),
    )}">
      ${START_CARDS.map((c) => `<option value="${esc(c.id)}">${esc(commanderTitle(c.id, c.title))}</option>`).join('')}
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

  <section class="mh-section" id="runes">
    <h2>${esc(DISPLAY.items)}</h2>
    <p class="mh-sub">${t('homepage:runes.sub', {
        sep: SEP,
        packLimit: itemSlotLimit('dwarf'),
        ballistaLimit: itemSlotLimit('ballista'),
    })}</p>
    <select class="mh-card-select" id="mh-runes-select" aria-label="${esc(
        t('homepage:runes.select', { item: midTerm(DISPLAY.item) }),
    )}">
      ${ALL_RUNES.map(({ item }) => `<option value="${esc(item.id)}">${esc(itemName(item.id, item.name))}</option>`).join('')}
    </select>
    <div class="mh-tactics" id="mh-runes-grid">
      ${ALL_RUNES.map(({ item, isBase }, i) => runeCard(item, isBase, i === 0)).join('')}
    </div>
  </section>

  <section class="mh-section" id="tactics">
    <h2>${esc(DISPLAY.tactics)}</h2>
    <p class="mh-sub">${t('homepage:tactics.sub', {
        sep: SEP,
        tactics: midTerm(DISPLAY.tactics),
    })}</p>
    <select class="mh-card-select" id="mh-tactics-select" aria-label="${esc(
        t('homepage:tactics.select', { tactic: midTerm(DISPLAY.tactic) }),
    )}">
      ${ALL_TACTICS.map((tactic) => `<option value="${esc(tactic.id)}">${esc(tacticName(tactic.id, tactic.name))}</option>`).join('')}
    </select>
    <div class="mh-tactics" id="mh-tactics-grid">
      ${ALL_TACTICS.map((tactic, i) => tacticCard(tactic, i === 0)).join('')}
    </div>
  </section>

  <section class="mh-section" id="round-cards">
    <h2>${esc(t('homepage:roundCards.title'))}</h2>
    <p class="mh-sub">${esc(t('homepage:roundCards.sub', { items: midTerm(DISPLAY.items) }))}</p>
    <select class="mh-card-select" id="mh-round-cards-select" aria-label="${esc(t('homepage:roundCards.select'))}">
      ${ROUND_RUNE_CARDS.map((c) => `<option value="${esc(c.id)}">${esc(roundCardTitle(c.id, c.title))}</option>`).join('')}
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

  <section class="mh-section" id="settings">
    <h2>${esc(t('homepage:matchSettings.title'))}</h2>
    <p class="mh-sub">${esc(t('homepage:matchSettings.sub'))}</p>
    <div class="mh-settings-grid">
      ${SETTINGS_GROUPS.map(settingsGroupHtml).join('')}
    </div>
  </section>

  <section class="mh-section mh-together" id="suggest">
    <h2>${esc(t('homepage:contribute.title'))}</h2>
    <p class="mh-sub">${esc(t('homepage:contribute.sub1'))} <br /><br />${t('homepage:contribute.sub2', { sep: SEP })}</p>
    <div class="mh-together-cta">
      <a class="mh-suggest-btn" href="${PLAY_URL}">${esc(t('homepage:contribute.play'))}</a>
      <button type="button" class="mh-suggest-btn" id="mh-suggest-open">${esc(t('homepage:contribute.feedback'))}</button>
      <a class="mh-suggest-btn mh-discord-btn" href="${esc(DISCORD_URL)}" rel="noopener noreferrer" target="_blank">${DISCORD_ICON_SVG} ${esc(t('homepage:contribute.discord'))}</a>
      <a class="mh-trailer-btn" href="${esc(DEVLOG_URL)}" rel="noopener noreferrer" target="_blank">
        ${YOUTUBE_ICON_SVG}
        <span>${esc(t('homepage:contribute.devlog'))}</span>
      </a>
    </div>
    <div class="mh-community-body">
      <div class="mh-community-block">
        <h3>${esc(t('homepage:contribute.waysTitle'))}</h3>
        <ul class="mh-help-list">
          <li>${esc(t('homepage:contribute.way1'))}</li>
          <li>${t('homepage:contribute.way2', { github: githubLink('GitHub') })}</li>
          <li>${esc(t('homepage:contribute.way3'))}</li>
          <li>${esc(t('homepage:contribute.way4'))}</li>
          <li>${esc(t('homepage:contribute.way5'))}</li>
        </ul>
      </div>
    </div>
  </section>
  <section class="mh-section mh-about-section" id="about">
    <h2>${esc(t('homepage:about.title'))}</h2>
    <div class="mh-about">
      <a class="mh-about-brand" href="https://feuerware.com/" rel="noopener noreferrer" target="_blank">
        <img src="${esc(feuerwareLogoUrl)}" alt="Feuerware" width="307" height="307" />
      </a>
      <p class="mh-about-lead">
        ${esc(t('homepage:about.lead'))}
      </p>
      <p>
        ${t('homepage:about.inspired', {
            mechabellum: `<a href="https://www.playmechabellum.com/" rel="noopener noreferrer" target="_blank">Mechabellum</a>`,
        })}
      </p>
      <p>
        ${t('homepage:about.openSource', {
            github: githubLink(t('homepage:about.openSourceLink')),
            email: `<a href="mailto:alex@feuerware.com">alex@feuerware.com</a>`,
        })}
      </p>
    </div>
  </section>
</main>

<footer class="mh-wrap mh-footer">
  <div class="mh-footer-links">
    <a href="${PLAY_URL}">${esc(t('homepage:footer.play'))}</a>
    ${steamLink('', esc(t('homepage:footer.steam')))}
    <a href="#suggest" id="mh-footer-suggest">${esc(t('homepage:footer.feedback'))}</a>
    <a href="https://feuerware.com/2025/imprint.html" rel="noopener noreferrer" target="_blank">${esc(t('homepage:footer.imprint'))}</a>
    <a href="https://feuerware.com/2025/privacy.html" rel="noopener noreferrer" target="_blank">${esc(t('homepage:footer.privacy'))}</a>
  </div>
  <div class="mh-footer-meta">
    <label class="mh-lang mh-lang-footer">
      <svg class="mh-lang-globe" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25"/>
        <ellipse cx="8" cy="8" rx="2.6" ry="6.25" fill="none" stroke="currentColor" stroke-width="1.1"/>
        <path d="M2.1 8h11.8M3.2 4.8h9.6M3.2 11.2h9.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
      <select class="mh-lang-select" aria-label="${esc(t('common:language'))}">
        ${LANGUAGE_IDS.map(
            (id) =>
                `<option value="${id}"${id === language ? ' selected' : ''}>${LANGUAGE_NATIVE_NAMES[id]}</option>`,
        ).join('')}
      </select>
    </label>
    <span>${esc(versionLabel)} · MELODAN · Feuerware</span>
  </div>
</footer>

<aside class="mh-sticky-play" id="mh-sticky-play" aria-hidden="true">
  <a class="mh-sticky-btn discord icon-only" href="${esc(DISCORD_URL)}" rel="noopener noreferrer" target="_blank" aria-label="${esc(t('homepage:contribute.discord'))}" title="${esc(t('homepage:contribute.discord'))}">
    <svg class="mh-sticky-icon" viewBox="0 0 127.14 96.36" width="28" height="22" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1A105.25 105.25 0 0 0 126.6 80.22c2.64-27.38-4.51-51.14-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53 91.08 65.69 84.69 65.69Z"/>
    </svg>
  </a>
  <a class="mh-sticky-btn steam mh-steam-link" href="${esc(STEAM_URL)}" rel="noopener noreferrer" target="_blank" aria-label="${esc(t('homepage:hero.wishlist'))}" title="${esc(t('homepage:hero.wishlist'))}">
    <img class="mh-sticky-icon mh-sticky-steam" src="${esc(steamLogoSmallUrl)}" alt="" width="84" height="84" />
    ${esc(t('homepage:hero.wishlist'))}
  </a>
</aside>

<dialog class="mh-lightbox" id="mh-lightbox" aria-label="${esc(t('homepage:lightbox.gallery'))}">
  <div class="mh-lightbox-chrome">
    <p class="mh-lightbox-count" id="mh-lightbox-count" aria-live="polite"></p>
    <button type="button" class="mh-lightbox-close" id="mh-lightbox-close" aria-label="${esc(t('homepage:lightbox.close'))}">&times;</button>
  </div>
  <button type="button" class="mh-lightbox-nav prev" id="mh-lightbox-prev" aria-label="${esc(t('homepage:lightbox.prev'))}">&#8249;</button>
  <button type="button" class="mh-lightbox-nav next" id="mh-lightbox-next" aria-label="${esc(t('homepage:lightbox.next'))}">&#8250;</button>
  <div class="mh-lightbox-stage" id="mh-lightbox-stage">
    <img class="mh-lightbox-img" id="mh-lightbox-img" alt="" draggable="false" />
  </div>
  <div class="mh-lightbox-footer">
    <p class="mh-lightbox-caption" id="mh-lightbox-caption"></p>
    <div class="mh-lightbox-links">
      <a class="mh-lightbox-link" id="mh-lightbox-fullhd" href="#" target="_blank" rel="noopener noreferrer">${esc(t('homepage:lightbox.fullhd'))}</a>
      <a class="mh-lightbox-link" id="mh-lightbox-4k" href="#" target="_blank" rel="noopener noreferrer">${esc(t('homepage:lightbox.uhd'))}</a>
    </div>
  </div>
  <div class="mh-lightbox-dots" id="mh-lightbox-dots" role="tablist" aria-label="${esc(t('homepage:lightbox.dots'))}"></div>
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

app.querySelectorAll<HTMLSelectElement>('.mh-lang-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
        const next = (e.currentTarget as HTMLSelectElement).value as LanguageId;
        if (next === language) return;
        updatePrefs({ language: next });
        void (async () => {
            await setLanguage(next);
            await applyLanguageFont(next);
            location.reload();
        })();
    });
});

for (const img of app.querySelectorAll<HTMLImageElement>('.mh-shot img')) {
    img.addEventListener('error', () => {
        const label = img.dataset.placeholder ?? t('homepage:screenshots.fallback');
        const span = document.createElement('span');
        span.textContent = t('homepage:screenshots.missing', { label });
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
    viewer.show(showcaseModelKey(first), first.meshScale);
    showcaseLoading.remove();
    showcaseHint.classList.add('visible');
    const hideHint = () => showcaseHint.classList.remove('visible');
    canvas.addEventListener('pointerdown', hideHint, { once: true });
    canvas.addEventListener('wheel', hideHint, { once: true, passive: true });

    const unitSelect = app.querySelector<HTMLSelectElement>('#mh-unit-select');

    function setActivePick(opts: { unitId?: string; spellId?: string }): void {
        for (const p of picks) {
            const isUnit = opts.unitId != null && p.dataset.unitId === opts.unitId;
            const isSpell = opts.spellId != null && p.dataset.spellId === opts.spellId;
            const on = isUnit || isSpell;
            p.classList.toggle('active', on);
            p.setAttribute('aria-selected', on ? 'true' : 'false');
        }
    }

    function selectUnit(id: string): void {
        const type = SHOWCASE_UNITS.find((t) => t.id === id);
        if (!type) return;
        setActivePick({ unitId: id });
        if (unitSelect) unitSelect.value = id;
        viewer.show(showcaseModelKey(type), type.meshScale);
        statsEl.innerHTML = statsHtml(type);
    }

    function selectSpell(id: SpellAssetId): void {
        const spell = SHOWCASE_SPELLS.find((s) => s.id === id);
        if (!spell) return;
        setActivePick({ spellId: id });
        if (unitSelect) unitSelect.value = `spell:${id}`;
        statsEl.innerHTML = spellStatsHtml(spell);
        void viewer.showSpell(id);
    }

    for (const btn of picks) {
        btn.addEventListener('click', () => {
            const spellId = btn.dataset.spellId as SpellAssetId | undefined;
            if (spellId) {
                selectSpell(spellId);
                return;
            }
            const id = btn.dataset.unitId;
            if (id) selectUnit(id);
        });
    }
    unitSelect?.addEventListener('change', () => {
        const v = unitSelect.value;
        if (v.startsWith('spell:')) {
            selectSpell(v.slice('spell:'.length) as SpellAssetId);
            return;
        }
        selectUnit(v);
    });
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
wireCardSelect('mh-runes-select', '#mh-runes-grid > .mh-tactic');
wireCardSelect('mh-tactics-select', '#mh-tactics-grid > .mh-tactic');

const commanderSpellTips = new CardSpellTips();
const specialistsRow = document.getElementById('mh-specialists-row');
if (specialistsRow) commanderSpellTips.bind(specialistsRow);
const roundCardsRow = document.getElementById('mh-round-cards-row');
if (roundCardsRow) commanderSpellTips.bind(roundCardsRow);
