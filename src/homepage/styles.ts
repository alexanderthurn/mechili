import { THEME } from '../theme';

/** Homepage layout CSS. Card face styles come from hudStyles(); menu accents from menuStyles(). */
export function homepageStyles(): string {
    const u = THEME.ui;
    const sky = THEME.scenery.skyHorizon;
    return `
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
html, body {
    margin: 0;
    min-height: 100%;
    min-height: 100dvh;
    color: ${u.text};
    background: #1a2818;
}

.melodan-home {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    background: linear-gradient(180deg, #1a2818 0%, #121c12 35%, #0a0e0a 70%, #000000 100%);
}
@media (min-width: 721px) {
    .melodan-home {
        background:
            linear-gradient(180deg, rgba(12, 20, 10, 0.55), rgba(18, 28, 14, 0.88)),
            var(--menu-bg) center / cover no-repeat fixed;
    }
}

.mh-lang {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 6;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: ${u.brassLight};
}
.mh-lang-globe {
    flex-shrink: 0;
    display: block;
}
.mh-lang-select {
    background: rgba(18, 28, 14, 0.72);
    border: 1px solid ${u.divider};
    border-radius: 3px;
    color: ${u.cream};
    font: inherit;
    font-size: 13px;
    padding: 4px 8px;
    cursor: pointer;
}
.mh-lang-select:hover,
.mh-lang-select:focus-visible {
    border-color: ${u.brass};
    outline: none;
}
.mh-lang-select option {
    color: ${u.cream};
    background: #1a2818;
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

.mh-play,
.mh-hero-ctas {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: max-content;
    max-width: 92vw;
    margin-top: 8px;
}

.mh-hero-ctas .mh-play-btn.steam,
.mh-hero-ctas .mh-trailer-btn {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    margin-top: 0;
    padding: 14px 28px;
    border-radius: 14px;
    border-width: 2px;
    font-size: 1.1rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    box-sizing: border-box;
}
.mh-hero-ctas .mh-play-btn.steam .mh-play-title {
    font-size: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    gap: 10px;
    min-height: 0;
    line-height: 1;
}

.mh-play-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 14px 18px;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 1.15rem;
    letter-spacing: 0.02em;
    gap: 8px;
    text-align: center;
    line-height: 1.2;
    min-height: 1.4em;
}
.mh-play-btn.steam .mh-play-title { color: #fff; }
.mh-steam-cta-icon-wrap {
    width: 1.35em;
    height: 1.35em;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: #111;
}
.mh-steam-cta-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transform: scale(1.18);
}
.mh-play-note {
    font-size: 12px;
    line-height: 1.35;
    color: ${u.phase};
    opacity: 0.95;
    text-align: center;
}

.mh-sticky-play {
    display: flex;
    position: fixed;
    z-index: 50;
    right: 0;
    bottom: 0;
    left: auto;
    transform: translateY(110%);
    align-items: stretch;
    justify-content: flex-end;
    gap: 0;
    padding: 0;
    border-radius: 6px 0 0 0;
    border: 1px solid ${u.frameMid};
    border-right: none;
    border-bottom: none;
    background:
        radial-gradient(ellipse at 28% 18%, rgba(255, 220, 160, 0.05), transparent 52%),
        linear-gradient(165deg, ${u.leatherHi} 0%, ${u.leatherMid} 42%, ${u.leather} 100%);
    backdrop-filter: none;
    box-shadow:
        -6px -6px 24px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 230, 180, 0.12);
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
.mh-sticky-btn.discord {
    background: linear-gradient(180deg, #5865f2, #404eed);
    color: #f0f1ff;
}
.mh-sticky-btn.steam {
    background: linear-gradient(180deg, #2a4a2e, #1a3020);
    color: #fff;
}
.mh-sticky-btn.icon-only {
    padding: 8px 14px;
    min-width: 3.2rem;
}
.mh-sticky-icon {
    display: block;
    width: 1.85rem;
    height: 1.85rem;
    object-fit: contain;
    pointer-events: none;
}
.mh-sticky-btn.discord .mh-sticky-icon {
    width: 1.7rem;
    height: 1.3rem;
}
.mh-sticky-steam {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
}
@media (min-width: 720px) {
    .mh-sticky-btn {
        padding: 8px 18px;
        font-size: 0.92rem;
        gap: 8px;
    }
    .mh-sticky-btn.icon-only {
        padding: 8px 16px;
        min-width: 3.6rem;
    }
    .mh-sticky-icon {
        width: 2.05rem;
        height: 2.05rem;
    }
    .mh-sticky-btn.discord .mh-sticky-icon {
        width: 1.9rem;
        height: 1.45rem;
    }
    .mh-sticky-steam {
        width: 1.45rem;
        height: 1.45rem;
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

.mh-trailer-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 4px;
    padding: 14px 28px;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.text};
    font-family: inherit;
    font-size: 1.1rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-decoration: none;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, transform 0.12s;
}
.mh-trailer-btn:hover {
    border-color: #ff4d4d;
    background: rgba(180, 20, 20, 0.28);
    transform: translateY(-2px);
}
.mh-trailer-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 80, 80, 0.35);
}
.mh-youtube-icon {
    display: block;
    flex-shrink: 0;
    width: 1.35em;
    height: 1.05em;
    color: #ff2a2a;
}

.mh-shots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 22px;
    margin: 8px 12px 0;
}
.mh-shots-more-wrap {
    display: flex;
    justify-content: center;
    margin-top: 22px;
}
.mh-shots-more-btn {
    padding: 10px 18px;
    border-radius: 12px;
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.brassLight};
    font-family: inherit;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, transform 0.12s;
}
.mh-shots-more-btn:hover {
    border-color: ${u.brass};
    background: ${u.techBuyBg};
    transform: translateY(-1px);
}
.mh-shots-more-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
}
@media (max-width: 720px) {
    #screenshots.mh-section {
        margin: 24px 0 36px;
        padding-top: 56px;
    }
    #screenshots .mh-sub {
        margin-bottom: 12px;
        padding: 0 4px;
    }
    .mh-shots {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin: 0;
    }
    .mh-shots-more-wrap {
        margin-top: 14px;
    }
}

@media (max-width: 520px) {
    .mh-shots {
        gap: 6px;
    }
}
.mh-shot {
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    overflow: hidden;
    display: grid;
    place-items: center;
    color: ${u.textMuted};
    font-size: 13px;
    padding: 0;
    margin: 0;
    width: 100%;
    cursor: pointer;
    font: inherit;
    transition: border-color 0.15s ease, transform 0.15s ease;
}
@media (max-width: 720px) {
    .mh-shot {
        border-radius: 8px;
        border-width: 1.5px;
    }
}
.mh-shot:hover {
    border-color: ${u.brass};
    transform: translateY(-1px);
}
.mh-shot:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
}
.mh-shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
}

.mh-lightbox {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: none;
    background: rgba(4, 8, 6, 0.94);
    color: ${u.text};
    overflow: hidden;
}
.mh-lightbox::backdrop {
    background: rgba(0, 0, 0, 0.72);
}
.mh-lightbox-chrome {
    position: absolute;
    z-index: 3;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    pointer-events: none;
}
.mh-lightbox-count {
    margin: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.45);
    color: ${u.brassLight};
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
}
.mh-lightbox-close {
    pointer-events: auto;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.text};
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
}
.mh-lightbox-close:hover {
    border-color: ${u.brass};
    background: ${u.techBuyBg};
}
.mh-lightbox-nav {
    position: absolute;
    z-index: 3;
    top: 50%;
    transform: translateY(-50%);
    width: 48px;
    height: 72px;
    border: 1.5px solid ${u.border};
    border-radius: 12px;
    background: rgba(12, 18, 14, 0.78);
    color: ${u.brassLight};
    font-size: 36px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
}
.mh-lightbox-nav:hover {
    border-color: ${u.brass};
    background: ${u.techBuyBg};
}
.mh-lightbox-nav.prev { left: 12px; }
.mh-lightbox-nav.next { right: 12px; }
.mh-lightbox-stage {
    position: absolute;
    inset: 56px 64px 88px;
    display: grid;
    place-items: center;
    touch-action: none;
    cursor: pointer;
    user-select: none;
    overflow: hidden;
}
.mh-lightbox-stage.mh-lightbox-left { cursor: w-resize; }
.mh-lightbox-stage.mh-lightbox-right { cursor: e-resize; }
.mh-lightbox-stage:active { cursor: grabbing; }
.mh-lightbox-stage.mh-lightbox-zoomed {
    cursor: grab;
}
.mh-lightbox-stage.mh-lightbox-zoomed:active {
    cursor: grabbing;
}
.mh-lightbox-stage.mh-lightbox-zoomed.mh-lightbox-left,
.mh-lightbox-stage.mh-lightbox-zoomed.mh-lightbox-right {
    cursor: grab;
}
.mh-lightbox-img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 10px;
    border: 2px solid ${u.border};
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    transition: transform 0.18s ease;
    transform-origin: center center;
    pointer-events: none;
    will-change: transform;
}
.mh-lightbox-footer {
    position: absolute;
    z-index: 3;
    left: 50%;
    bottom: 48px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: min(720px, calc(100% - 32px));
    pointer-events: none;
}
.mh-lightbox-caption {
    margin: 0;
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.4);
    color: ${u.phase};
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
}
.mh-lightbox-links {
    display: flex;
    gap: 8px;
    pointer-events: auto;
}
.mh-lightbox-link {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid ${u.border};
    background: rgba(0, 0, 0, 0.45);
    color: ${u.brassLight};
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-decoration: none;
    text-transform: uppercase;
}
.mh-lightbox-link:hover {
    border-color: ${u.brass};
    background: ${u.techBuyBg};
    color: ${u.text};
}
.mh-lightbox-dots {
    position: absolute;
    z-index: 3;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
}
.mh-lightbox-dot {
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgba(255, 208, 64, 0.45);
    background: rgba(255, 255, 255, 0.18);
    cursor: pointer;
}
.mh-lightbox-dot.active {
    background: ${u.brass};
    border-color: ${u.brassLight};
}
@media (max-width: 720px) {
    .mh-lightbox-stage {
        inset: 48px 0 84px;
    }
    .mh-lightbox-nav {
        display: none;
    }
    .mh-lightbox-img {
        border-radius: 0;
        border-left: none;
        border-right: none;
        max-height: 100%;
        width: 100%;
        object-fit: contain;
    }
    .mh-lightbox-footer {
        bottom: 40px;
        gap: 6px;
    }
    .mh-lightbox-caption {
        font-size: 12px;
        padding: 4px 10px;
    }
    .mh-lightbox-link {
        padding: 6px 12px;
        font-size: 11px;
    }
    .mh-lightbox-dots {
        bottom: 10px;
        gap: 10px;
    }
    .mh-lightbox-dot {
        width: 8px;
        height: 8px;
    }
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
/* Below this width, tall galleries (and the unit roster) swap to a <select>
   that shows one item / drives the 3D preview — chips and card grids hide. */
@media (max-width: 720px) {
    .mh-card-select {
        display: block;
        max-width: none;
        width: 100%;
        box-sizing: border-box;
    }
    #mh-specialists-row > .card:not(.mh-active),
    #mh-round-cards-row > .card:not(.mh-active),
    #mh-tactics-grid > .mh-tactic:not(.mh-active) {
        display: none;
    }
    /* Same 1-col cap as in-match phones — select picks which face is shown */
    #mh-specialists-row,
    #mh-round-cards-row {
        grid-template-columns: minmax(0, 1fr);
        width: min(100%, 340px);
    }
    #mh-specialists-row > .card:last-child:nth-child(odd),
    #mh-round-cards-row > .card:last-child:nth-child(odd) {
        grid-column: auto;
        width: auto;
        justify-self: stretch;
    }
    #mh-tactics-grid {
        grid-template-columns: 1fr;
    }
    #mh-tactics-grid > .mh-tactic.mh-active {
        width: 100%;
    }
    #mh-tactics-grid > .mh-tactic.mh-active .mh-tactic-icon {
        width: 100%;
        max-width: 100%;
    }
    .mh-unit-picks {
        display: none !important;
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
.mh-tech-ico.m-icon {
    width: 28px;
    height: 28px;
    font-size: 0;
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
    display: inline-flex;
    align-items: center;
    gap: 3px;
}
.mh-tech-cost .money-ico.m-icon {
    width: 13px;
    height: 13px;
    margin: 0;
    vertical-align: -0.15em;
}
.mh-tech-desc {
    color: ${u.phase};
}

/* Overlay chrome off — card grid/size comes from in-match .mechili-cards */
.melodan-home .mechili-cards {
    position: relative;
    inset: auto;
    z-index: auto;
    background: transparent;
    padding: 0;
    overflow: visible;
    user-select: text;
}
.melodan-home .mechili-cards::before,
.melodan-home .mechili-cards::after {
    content: none;
}

.mh-tactics {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
}
.mh-tactic {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    overflow: hidden;
    user-select: text;
}
.mh-tactic-icon {
    display: flex;
    justify-content: center;
    margin: 14px auto 0;
}
.mh-tactic-body {
    padding: 14px 14px 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
    /* everything centres under the icon, which is centred itself */
    text-align: center;
    align-items: center;
}
.mh-tactic-head {
    margin-bottom: 4px;
}
.mh-tactic-head h3 {
    margin: 0;
    font-size: 1.05rem;
    color: ${u.brassLight};
}
.mh-tactic-tile.m-icon {
    width: 72px;
    height: 72px;
    font-size: 0;
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
/* Base vs advanced reads as a corner tag rather than a line of subtitle: an
   outline for the raw runes you buy, filled brass for the ones that came out of
   a forge — the same "upgraded" jump the runes themselves make. */
.mh-rune-tag {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${u.textMuted};
    background: rgba(12, 9, 6, 0.55);
    border: 1px solid ${u.border};
}
.mh-rune-tag.forged {
    color: ${u.parchmentInk};
    background: ${u.brassLight};
    border-color: ${u.brassLight};
    box-shadow: 0 1px 6px rgba(212, 184, 120, 0.35);
}

/* the in-game price tag (.mechili-panel .action-tile .at-cost): a red band
   across the bottom edge, white and centred. The card's own overflow:hidden
   rounds the band's corners to match. */
.mh-tactic-cost {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 8px 0 9px;
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: rgba(180, 32, 24, 0.92);
    pointer-events: none;
    /* a forged rune pays in ingredients + fee, so the band holds icons too */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
}
.mh-cost-rune {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
}
.mh-cost-plus {
    opacity: 0.75;
    font-weight: 600;
}
/* room for the band, the same way the game pads a tile that carries one */
.mh-tactic:has(.mh-tactic-cost) .mh-tactic-body {
    padding-bottom: 58px;
}
.mh-tactic-stats {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
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
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 12px;
    margin: 8px 0 4px;
}
.mh-together-cta .mh-suggest-btn {
    text-decoration: none;
}
.mh-together-cta .mh-trailer-btn {
    margin-top: 6px;
}
.mh-community-body {
    max-width: 520px;
    margin: 28px auto 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    text-align: left;
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
.mh-discord-btn {
    border-color: #5865f2;
    background: linear-gradient(180deg, #5865f2, #404eed);
    color: #f0f1ff;
    text-decoration: none;
    gap: 10px;
}
.mh-discord-btn:hover {
    border-color: #7289da;
}
.mh-discord-icon {
    display: block;
    flex-shrink: 0;
    width: 1.35em;
    height: 1.05em;
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
.mh-footer-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 18px;
}
.mh-lang-footer {
    position: static;
}
.mh-lang-footer .mh-lang-select {
    background: transparent;
}

.mh-settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin-top: 8px;
}
.mh-settings-card {
    padding: 14px 16px 16px;
    border-radius: 14px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
}
.mh-settings-card h3 {
    margin: 0 0 8px;
    color: ${u.brassLight};
    font-size: 1rem;
}
.mh-settings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}
.mh-settings-table th,
.mh-settings-table td {
    text-align: left;
    padding: 5px 0;
    vertical-align: top;
}
.mh-settings-table tr:not(:last-child) th,
.mh-settings-table tr:not(:last-child) td {
    border-bottom: 1px solid ${u.divider};
}
.mh-settings-table th {
    color: ${u.textMuted};
    font-weight: 600;
    padding-right: 12px;
    white-space: nowrap;
}
.mh-settings-table td {
    color: ${u.text};
    font-variant-numeric: tabular-nums;
}
.mh-settings-desc {
    display: block;
    color: ${u.textMuted};
    font-size: 11.5px;
    font-weight: 400;
    font-variant-numeric: normal;
    margin-top: 2px;
    white-space: normal;
}
`;
}
