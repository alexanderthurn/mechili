import { THEME } from '../theme';

/** Homepage layout CSS. Card face styles come from hudStyles(); menu accents from menuStyles(). */
export function homepageStyles(): string {
    const u = THEME.ui;
    const sky = THEME.scenery.skyHorizon;
    return `
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
    margin: 0;
    min-height: 100%;
    color: ${u.text};
    font-family: "Segoe UI", system-ui, sans-serif;
    background: #1a2818;
}

.melodan-home {
    min-height: 100vh;
    background:
        linear-gradient(180deg, rgba(12, 20, 10, 0.55), rgba(18, 28, 14, 0.88)),
        var(--menu-bg) center / cover no-repeat fixed;
}

.mh-wrap {
    width: min(1120px, calc(100% - 32px));
    margin: 0 auto;
    padding: 28px 0 48px;
}

.mh-hero {
    display: grid;
    gap: 18px;
    justify-items: center;
    text-align: center;
    padding: 48px 12px 36px;
}

.mh-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
}

.mh-logo {
    width: min(520px, 88vw);
    height: auto;
    display: block;
    filter: drop-shadow(0 10px 28px rgba(0, 0, 0, 0.45));
}

/* logo.webp is 1500×818 with ~258px empty alpha under the wordmark */
.mh-version {
    margin: calc(min(520px, 88vw) * -258 / 1500 + 4px) 0 0;
    margin-bottom: 50px;
    color: ${u.textMuted};
    font-size: 12px;
    letter-spacing: 0.4px;
    opacity: 0.9;
    position: relative;
    z-index: 1;
}

.mh-tagline {
    margin: 0;
    font-size: clamp(14px, 2.2vw, 18px);
    letter-spacing: 0.28em;
    font-weight: 700;
    color: ${u.brassLight};
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.mh-lead {
    margin: 0;
    max-width: 42rem;
    color: ${u.phase};
    line-height: 1.55;
    font-size: 1.05rem;
}

.mh-play {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 260px));
    gap: 12px;
    justify-content: center;
    width: 100%;
    margin-top: 8px;
}

.mh-play-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 16px 18px;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.text};
    text-decoration: none;
    transition: transform 0.12s, border-color 0.12s, background 0.12s;
}
.mh-play-btn:hover { border-color: ${u.hover}; transform: translateY(-2px); }
.mh-play-btn.primary {
    background: linear-gradient(180deg, ${u.alliedBtnHover}, ${u.alliedBtnBg});
    border-color: ${u.player};
}
.mh-play-btn.steam {
    background: linear-gradient(180deg, #2a4a2e, #1a3020);
    border-color: ${u.brassDark};
}
.mh-steam-link.disabled {
    cursor: not-allowed;
    opacity: 0.6;
    pointer-events: none;
}
.mh-footer-links .mh-steam-link.disabled {
    opacity: 0.5;
}
.mh-play-title {
    font-weight: 900;
    font-size: 1.15rem;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.mh-play-btn.steam .mh-play-title { color: ${u.brassLight}; }
.mh-steam-logo {
    width: 2.7em;
    height: 2.7em;
    object-fit: contain;
    display: block;
}
.mh-play-note {
    font-size: 12px;
    line-height: 1.35;
    color: ${u.phase};
    opacity: 0.95;
}

.mh-sticky-play {
    display: flex;
    position: fixed;
    z-index: 40;
    right: 0;
    bottom: 0;
    left: auto;
    transform: translateY(110%);
    align-items: stretch;
    justify-content: flex-end;
    gap: 0;
    padding: 0;
    border-radius: 14px 0 0 0;
    border: 1px solid rgba(255, 208, 64, 0.28);
    border-right: none;
    border-bottom: none;
    background: rgba(12, 18, 14, 0.92);
    backdrop-filter: blur(10px);
    box-shadow: -6px -6px 24px rgba(0, 0, 0, 0.35);
    opacity: 0;
    pointer-events: none;
    transition: transform 0.28s ease, opacity 0.28s ease;
}
.mh-sticky-play.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
}
.mh-sticky-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 0;
    border: none;
    border-left: 1px solid rgba(255, 208, 64, 0.18);
    background: ${u.panelBgDark};
    color: ${u.text};
    text-decoration: none;
    font-family: inherit;
    font-weight: 800;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.12s, filter 0.12s;
}
.mh-sticky-btn:first-child { border-left: none; }
.mh-sticky-btn:hover { filter: brightness(1.08); }
.mh-sticky-btn.primary {
    background: linear-gradient(180deg, ${u.alliedBtnHover}, ${u.alliedBtnBg});
}
.mh-sticky-btn.suggest {
    background: linear-gradient(180deg, rgba(48, 58, 40, 0.95), rgba(28, 38, 24, 0.95));
    color: ${u.brassLight};
}
.mh-sticky-btn.steam {
    background: linear-gradient(180deg, #2a4a2e, #1a3020);
    color: ${u.brassLight};
    padding: 4px 12px 4px 8px;
}
.mh-sticky-steam {
    width: 2.2em;
    height: 2.2em;
    object-fit: contain;
    display: block;
    pointer-events: none;
}
@media (min-width: 720px) {
    .mh-sticky-btn {
        padding: 8px 18px;
        font-size: 0.92rem;
        gap: 8px;
    }
    .mh-sticky-btn.steam {
        padding: 5px 14px 5px 10px;
    }
    .mh-sticky-steam {
        width: 2.4em;
        height: 2.4em;
    }
}

.mh-section {
    margin: 40px 0 56px;
    padding-top: 80px;
    position: relative;
}
.mh-section::before {
    content: '⬢';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    color: ${u.brass};
    font-size: 11px;
    line-height: 1;
    opacity: 0.9;
    pointer-events: none;
}
.mh-section::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: min(280px, 55vw);
    height: 1px;
    transform: translate(-50%, -50%);
    background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 208, 64, 0.15) 18%,
        rgba(255, 208, 64, 0.45) 50%,
        rgba(255, 208, 64, 0.15) 82%,
        transparent
    );
    pointer-events: none;
}
.mh-section h2 {
    margin: 0 0 8px;
    font-size: clamp(1.35rem, 3vw, 1.75rem);
    letter-spacing: 0.06em;
    color: ${u.brassLight};
    text-align: center;
}
.mh-section .mh-sub {
    margin: 0 auto 20px;
    color: ${u.textMuted};
    max-width: 40rem;
    line-height: 1.5;
    text-align: center;
}

.mh-sep {
    color: ${u.brass};
    font-weight: 700;
    padding: 0 0.15em;
}

.mh-shots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
}
@media (max-width: 720px) {
    .mh-shots {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
    }

    .mh-shot {
        margin: 45px;
    }
}

@media (max-width: 520px) {
    .mh-shot {
        margin: 5px;
    }
}
.mh-shot {
    aspect-ratio: 16 / 10;
    border-radius: 12px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    overflow: hidden;
    display: grid;
    place-items: center;
    color: ${u.textMuted};
    font-size: 13px;
}
.mh-shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.mh-showcase {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(280px, 2fr);
    gap: 18px;
    align-items: start;
}
@media (max-width: 720px) {
    .mh-showcase { grid-template-columns: 1fr; }
}

.mh-showcase-view {
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    max-width: none;
    max-height: none;
    border-radius: 14px;
    border: 2px solid ${u.border};
    overflow: hidden;
    background:
        radial-gradient(ellipse at 50% 70%, rgba(90, 140, 70, 0.35), transparent 65%),
        linear-gradient(180deg, ${sky}, #3a5a32);
}
.mh-showcase-view canvas {
    width: 100%;
    height: 100%;
    display: block;
}
.mh-showcase-view canvas.mh-draggable {
    cursor: grab;
    touch-action: none;
}
.mh-showcase-view canvas.mh-draggable.dragging {
    cursor: grabbing;
}
.mh-showcase-hint {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.45);
    color: ${u.textMuted};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
}
.mh-showcase-hint.visible {
    opacity: 1;
}
.mh-showcase-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: ${u.textMuted};
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    pointer-events: none;
}
.mh-showcase-spin {
    color: ${u.brass};
    font-size: 22px;
    animation: mh-showcase-spin-anim 1.1s linear infinite;
}
@keyframes mh-showcase-spin-anim {
    to { transform: rotate(360deg); }
}

.mh-showcase-side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
}

.mh-card-select {
    display: none;
    width: 100%;
    max-width: 480px;
    margin: 0 auto 18px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.text};
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
}
/* Below this width, cards/tactics/units pile up too tall to browse — swap the
   full gallery for a <select> that shows one item (.mh-active) at a time. */
@media (max-width: 720px) {
    .mh-card-select {
        display: block;
    }
    #mh-specialists-row > .card:not(.mh-active),
    #mh-round-cards-row > .card:not(.mh-active),
    #mh-tactics-grid > .mh-tactic:not(.mh-active) {
        display: none;
    }
    #mh-specialists-row,
    #mh-round-cards-row {
        justify-content: center;
    }
    .mh-unit-picks {
        display: none;
    }
}

.mh-unit-picks {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.mh-pick-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mh-pick-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.textMuted};
}
.mh-pick-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.mh-pick {
    padding: 8px 12px;
    border-radius: 10px;
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.text};
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
}
.mh-pick:hover { border-color: ${u.hover}; }
.mh-pick.active {
    border-color: ${u.brass};
    background: ${u.techBuyBg};
    color: ${u.brassLight};
}

.mh-unit-stats {
    padding: 14px 16px 16px;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    user-select: text;
}
.mh-unit-stats h3 {
    margin: 0 0 8px;
    color: ${u.brassLight};
    font-size: 1.15rem;
}
.mh-stat-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
}
.mh-stat-grid dt {
    margin: 0;
    color: ${u.textMuted};
    font-weight: 600;
}
.mh-stat-grid dd {
    margin: 0;
    color: ${u.text};
    font-variant-numeric: tabular-nums;
}
.mh-flags {
    margin: 10px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.mh-flag {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid ${u.divider};
    color: ${u.phase};
    font-size: 11px;
    font-weight: 700;
}

.mh-techs {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid ${u.divider};
}
.mh-techs-label {
    margin-bottom: 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.textMuted};
}
.mh-tech-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.mh-tech-list li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.mh-tech-ico {
    flex: 0 0 auto;
    font-size: 1.15rem;
    line-height: 1.2;
}
.mh-tech-text {
    font-size: 13px;
    line-height: 1.4;
    color: ${u.text};
}
.mh-tech-text strong {
    color: ${u.brassLight};
    font-weight: 800;
}
.mh-tech-cost {
    color: ${u.brass};
    font-weight: 700;
    font-size: 12px;
}
.mh-tech-desc {
    color: ${u.phase};
}

/* In-game card chrome, adapted for a scrolling catalog */
.melodan-home .mechili-cards {
    position: relative;
    inset: auto;
    background: transparent;
    gap: 16px;
    user-select: text;
    justify-content: flex-start;
    align-items: center;
}
.melodan-home .mechili-cards .cards-title {
    letter-spacing: 0.12em;
    font-size: 1.1rem;
    text-align: center;
    text-shadow: none;
    color: ${u.brassLight};
}
.melodan-home .mechili-cards .cards-row {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    justify-content: center;
}
.melodan-home .mechili-cards .card.static {
    user-select: text;
}

.mh-tactics {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
}
.mh-tactic {
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    overflow: hidden;
    user-select: text;
}
.mh-tactic-art {
    width: 50%;
    max-width: 50%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    display: block;
    margin: 12px auto 0;
    border-radius: 8px;
    background: #1a2818;
}
.mh-tactic-icon {
    display: grid;
    place-items: center;
    width: 50%;
    margin: 12px auto 0;
    aspect-ratio: 1;
    font-size: 40px;
    border-radius: 8px;
    background:
        radial-gradient(ellipse at 50% 60%, rgba(90, 140, 70, 0.35), transparent 65%),
        ${u.panelBgSolid};
}
.mh-tactic-body {
    padding: 14px 14px 16px;
}
.mh-tactic-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}
.mh-tactic-head h3 {
    margin: 0;
    font-size: 1.05rem;
    color: ${u.brassLight};
}
.mh-tactic-emoji {
    font-size: 1.25rem;
    line-height: 1;
}
.mh-tactic-meta {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${u.textMuted};
}
.mh-tactic-desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: ${u.phase};
}
.mh-tactic-stats {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.mh-tactic-stats li {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: ${u.brassLight};
    line-height: 1.3;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 208, 64, 0.2);
    background: rgba(0, 0, 0, 0.28);
}

.mh-about {
    max-width: 42rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
}
.mh-about-brand {
    display: inline-block;
    width: fit-content;
    margin-bottom: 4px;
}
.mh-about-brand img {
    display: block;
    height: 148px;
    width: auto;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
}
.mh-about-lead {
    font-size: 1.05rem;
    color: ${u.text};
}
.mh-about p {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.65;
    color: ${u.phase};
}
.mh-about a {
    color: ${u.brassLight};
    font-weight: 700;
    text-decoration: none;
}
.mh-about a:hover { text-decoration: underline; }
.mh-about strong {
    color: ${u.text};
    font-weight: 800;
}

.mh-together-cta {
    display: flex;
    justify-content: center;
    margin: 8px 0 4px;
}
.mh-community-body {
    max-width: 920px;
    margin: 28px auto 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    text-align: left;
}
@media (min-width: 720px) {
    .mh-community-body {
        grid-template-columns: 1fr 1fr;
        gap: 18px;
    }
}
.mh-community-block {
    padding: 20px 22px;
    border-radius: 14px;
    border: 1.5px solid rgba(255, 208, 64, 0.28);
    background: rgba(12, 18, 14, 0.55);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.mh-community-block h3 {
    margin: 0 0 12px;
    font-size: 1.05rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${u.brass};
    text-align: center;
}
.mh-community-block p {
    margin: 0 0 10px;
    font-size: 0.95rem;
    line-height: 1.6;
    color: ${u.phase};
}
.mh-community-block p:last-child { margin-bottom: 0; }
.mh-community-block a {
    color: ${u.brassLight};
    font-weight: 700;
    text-decoration: none;
}
.mh-community-block a:hover { text-decoration: underline; }
.mh-community-block strong {
    color: ${u.text};
    font-weight: 800;
}
.mh-help-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 0.95rem;
    line-height: 1.55;
    color: ${u.phase};
}
.mh-help-list li::before {
    content: '⬢ ';
    color: ${u.brass};
    font-size: 0.75em;
}
.mh-suggest-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 6px;
    padding: 14px 28px;
    border-radius: 14px;
    border: 2px solid ${u.player};
    background: linear-gradient(180deg, ${u.alliedBtnHover}, ${u.alliedBtnBg});
    color: ${u.text};
    font-weight: 900;
    font-size: 1.1rem;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: transform 0.12s, border-color 0.12s, filter 0.12s;
}
.mh-suggest-btn:hover {
    border-color: ${u.hover};
    transform: translateY(-2px);
    filter: brightness(1.05);
}
.mh-suggest-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
}

.mh-footer {
    margin-top: 56px;
    padding: 28px 0 8px;
    border-top: 1px solid ${u.divider};
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
    align-items: center;
    justify-content: space-between;
    color: ${u.textMuted};
    font-size: 13px;
}
.mh-footer a {
    color: ${u.brassLight};
    text-decoration: none;
}
.mh-footer a:hover { text-decoration: underline; }
.mh-footer .mh-steam-link.disabled {
    color: ${u.textMuted};
}
.mh-footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
}
`;
}
