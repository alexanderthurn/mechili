/** The match HUD's CSS: generated from the theme and the match's team colors. */
import { HORDE_COLOR, shadeCss, teamColors } from '../game/colors';
import { THEME, gamepadCursorStyles, POLE, PARCHMENT_FILL, INK, INK_MUTED, INK_RUST, PARCHMENT_EDGE, WOOD_BUTTON, materialStyles, hpTubeTrack, hpTubeFill, hpTubeVal, fontFaceCss, dialogFadeStyles, cardSpellTipStyles, iconBaseStyles, chatFloatStyles, chatBarStyles, type BarAssets } from '../theme';

/** frayed cloth edge for the health banner: a jagged band, tiled along it */
const FRAY_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='100' viewBox='0 0 40 100' preserveAspectRatio='none'><path d='M0 4 L3 1 L5 5 L8 2 L11 6 L13 1 L16 3 L19 0 L22 5 L25 2 L27 6 L30 1 L33 4 L36 2 L40 4 L40 96 L37 99 L35 95 L32 98 L29 94 L26 100 L23 96 L20 99 L17 95 L14 98 L12 94 L9 99 L6 96 L3 100 L0 96 Z' fill='black'/></svg>";

/** canvas grain for the painted portrait (an SVG noise tile) */
const GRAIN_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.38 0 0 0 0 0.28 0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>";

/** CSS block for the HTML HUD — generated from {@link THEME} + the match's
 *  canonical team colors (assign those BEFORE the HUD is built). */
export function hudStyles(bars?: BarAssets): string {
    const u = THEME.ui;
    const pc = teamColors.player.css;
    const ec = teamColors.enemy.css;
    return `
${fontFaceCss()}
${materialStyles(u)}
${iconBaseStyles()}
${dialogFadeStyles()}
${cardSpellTipStyles()}
${chatBarStyles(u)}
${chatFloatStyles(u, pc, ec)}
.mechili-cinema-hide {
    visibility: hidden !important;
    pointer-events: none !important;
}
/* match-intro hold: fade chrome in once the camera fly-in finishes */
.mechili-intro-hide {
    opacity: 0 !important;
    pointer-events: none !important;
}
.mechili-cinema-hint {
    position: absolute;
    left: 12px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    z-index: 200;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(8, 8, 6, 0.72);
    border: 1px solid rgba(168, 216, 120, 0.35);
    color: ${u.debug};
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0;
    pointer-events: none;
    user-select: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    white-space: pre;
    opacity: 0;
    transition: opacity 0.4s ease;
}
.mechili-cinema-hint.is-visible {
    opacity: 1;
}
/* Below .mechili-pause (55) / .mechili-gameover (56) so Esc chrome wins. */
.mechili-tutorial {
    position: absolute;
    left: 50%;
    top: 18%;
    transform: translateX(-50%);
    z-index: 52;
    width: min(420px, calc(100vw - 32px));
    padding: 14px 16px 12px;
    border-radius: 10px;
    background: rgba(10, 12, 8, 0.88);
    border: 1px solid rgba(200, 180, 120, 0.45);
    color: ${u.text};
    font: 14px/1.45 var(--font-ui);
    text-align: center;
    pointer-events: auto;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.mechili-tutorial .tut-title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin-bottom: 6px;
    color: ${u.debug};
}
.mechili-tutorial .tut-body {
    color: ${u.textMuted};
    margin-bottom: 10px;
}
.mechili-tutorial .tut-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 0 10px;
    text-align: left;
}
.mechili-tutorial .tut-ctrl {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 8px;
    align-items: start;
    padding: 7px 9px;
    border-radius: 7px;
    background: rgba(255, 220, 100, 0.08);
    border: 1px solid rgba(200, 180, 120, 0.35);
    font-size: 12.5px;
    line-height: 1.35;
}
.mechili-tutorial .tut-ctrl-kind {
    font-weight: 700;
    color: ${u.debug};
    letter-spacing: 0.02em;
}
.mechili-tutorial .tut-ctrl-detail {
    color: ${u.text};
}
.mechili-tutorial .tut-next {
    appearance: none;
    border: 1px solid rgba(200, 180, 120, 0.55);
    background: rgba(40, 36, 24, 0.9);
    color: ${u.text};
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
    font: inherit;
}
.mechili-tutorial .tut-next:hover {
    border-color: rgba(230, 210, 140, 0.85);
}
.mechili-tutorial-nudge {
    position: absolute;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 53;
    max-width: min(360px, calc(100vw - 24px));
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(8, 8, 6, 0.82);
    border: 1px solid rgba(168, 216, 120, 0.4);
    color: ${u.debug};
    font: 13px/1.4 var(--font-ui);
    text-align: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.25s ease;
}
.mechili-tutorial-nudge.is-visible {
    opacity: 1;
}
.mechili-tut-callout {
    position: absolute;
    z-index: 54;
    box-sizing: border-box;
    border-radius: 8px;
    border: 2.5px solid rgba(255, 220, 100, 0.95);
    box-shadow:
        0 0 0 3px rgba(255, 210, 80, 0.28),
        0 0 18px rgba(255, 200, 60, 0.45),
        inset 0 0 12px rgba(255, 220, 100, 0.12);
    background: rgba(255, 210, 80, 0.06);
    pointer-events: none;
    animation: tut-callout-pulse 1.25s ease-in-out infinite;
}
@keyframes tut-callout-pulse {
    0%, 100% {
        border-color: rgba(255, 220, 100, 0.95);
        box-shadow:
            0 0 0 3px rgba(255, 210, 80, 0.28),
            0 0 18px rgba(255, 200, 60, 0.45),
            inset 0 0 12px rgba(255, 220, 100, 0.12);
        transform: scale(1);
    }
    50% {
        border-color: rgba(255, 245, 170, 1);
        box-shadow:
            0 0 0 6px rgba(255, 220, 100, 0.18),
            0 0 28px rgba(255, 210, 80, 0.65),
            inset 0 0 16px rgba(255, 230, 140, 0.18);
        transform: scale(1.035);
    }
}
.mechili-shop-col {
    position: absolute;
    right: env(safe-area-inset-right);
    bottom: env(safe-area-inset-bottom);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    user-select: none;
    pointer-events: none;
    transition: opacity 0.28s ease, transform 0.28s ease, visibility 0.28s;
}
/* build chrome fades out for battle / lock-in (absolute — no layout gap) */
/* the scenario editor's Terrain tool: no shop while sculpting */
.mechili-shop-col.editor-terrain { display: none !important; }
.mechili-shop-col.disabled,
.mechili-shop-col.battle {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(10px);
}
/* children opt into pointer-events:auto — kill those while faded out */
.mechili-shop-col.disabled *,
.mechili-shop-col.battle * {
    pointer-events: none !important;
}
@media (prefers-reduced-motion: reduce) {
    .mechili-shop-col,
    .mechili-sidebar,
    .mechili-phone-status .mechili-supply {
        transition: none !important;
    }
    .mechili-shop-col.disabled,
    .mechili-shop-col.battle {
        transform: none !important;
    }
    .mechili-sidebar.left.battle,
    .mechili-sidebar.left.waiting {
        transform: translateY(-50%) !important;
    }
    .mechili-sidebar.right.battle {
        transform: translateY(-50%) !important;
    }
}
.mechili-supply {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 54px;
    padding: 4px 6px;
    background: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    user-select: none;
    pointer-events: none;
    flex-shrink: 0;
}
.mechili-supply .supply {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 34px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${u.brassLight};
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    /* hits go to the clickable frame — avoid mid-click DOM thrash on the icon */
    pointer-events: none;
}
.mechili-supply .supply-ico.m-icon {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
}
.mechili-supply.clickable {
    pointer-events: auto;
    cursor: pointer;
    transition: transform 0.12s, filter 0.12s;
}
.mechili-supply.clickable:hover {
    filter: brightness(1.12);
}
.mechili-supply.clickable:active { transform: translateY(1px); }
.shop-toolbar {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 6px;
    width: 100%;
    padding: 0 3px 0 8px;
    box-sizing: border-box;
    pointer-events: auto;
}
.mechili-extras {
    display: flex;
    align-items: stretch;
    justify-content: flex-end;
    flex-wrap: wrap;
    width: 100%;
    padding: 0 3px 0 8px;
    box-sizing: border-box;
    pointer-events: auto;
    gap: 8px;
    /* board extras (any count) + level-all share one row above the shop */
    max-width: 100%;
}
.mechili-extras .undo,
.shop-toolbar .undo,
.mechili-phone-status .undo {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    height: 54px;
    min-height: 54px;
    padding: 8px 14px;
    border-radius: 3px;
    ${WOOD_BUTTON}
    border-width: 2px;
    color: ${u.undoText};
    font-size: 20px;
    font-weight: bold;
    line-height: 1;
    letter-spacing: 0.5px;
    cursor: pointer;
    appearance: none;
    flex-shrink: 0;
}
.mechili-extras .undo,
.shop-toolbar .undo,
.mechili-phone-status .undo { transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease; }
.mechili-extras .undo:hover,
.shop-toolbar .undo:hover,
.mechili-phone-status .undo:hover { border-color: #6a6058; filter: brightness(1.12); transform: translateY(-1px); }
.mechili-extras .undo:focus-visible,
.shop-toolbar .undo:focus-visible,
.mechili-phone-status .undo:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

/* top-right stack under the enemy commander strip: ☰ on every device,
   plus supply/undo/level-all on phone */
.mechili-phone-status {
    display: flex;
    position: absolute;
    /* right under the enemy's portrait frame in the screen corner (64px: the 58px
       picture in its 3px frame) — the ☰ hangs from it (compact layouts move it) */
    top: calc(64px + env(safe-area-inset-top));
    right: env(safe-area-inset-right);
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 3;
    user-select: none;
    pointer-events: none;
    background: none;
    border: none;
    box-shadow: none;
}
/* the ☰ hangs from the portrait frame: its usual small square size, flush against
   the frame, the lower corners rounded */
.mechili-phone-status .mechili-phone-menu {
    border-top: none;
    border-radius: 0 0 3px 3px;
}
/* the twins hide by default (button.* outranks the shared component rules
   below regardless of order): money returns in compact chrome; undo/level-all
   move to the top strip on touch devices OR any compact window (shop toolbar
   is sheeted away) */
.mechili-phone-status .mechili-supply,
.mechili-phone-status button.undo,
.mechili-phone-status button.level-all-global {
    display: none;
}
@media (pointer: coarse), (max-width: 599px), (max-height: 540px) {
    .mechili-phone-status button.undo,
    .mechili-phone-status button.level-all-global {
        display: flex;
    }
    .mechili-shop-col .undo,
    .mechili-shop-col .level-all-global {
        display: none !important;
    }
    .undo .undo-label {
        display: none;
    }
}
.mechili-phone-status .undo { pointer-events: auto; }
/* compact versions of the shop-toolbar frames — the originals crowd End Deployment */
.mechili-phone-status .mechili-supply {
    min-height: 40px;
    padding: 2px 4px;
}
.mechili-phone-status .supply { font-size: 20px; }
.mechili-phone-status .supply-ico.m-icon {
    width: 20px;
    height: 20px;
}
.mechili-phone-status .undo {
    height: 40px;
    min-height: 40px;
    width: 40px;
    min-width: 40px;
    padding: 0;
    justify-content: center;
    font-size: 15px;
}
.mechili-phone-status .level-all-global {
    align-self: flex-end;
    min-height: 54px;
    max-width: 110px;
}
.mechili-phone-status.overlay-open { display: none !important; }

/* ☰ menu — standalone bronze control (no longer a tab off the old plaque) */
.mechili-phone-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    align-self: flex-end;
    min-width: 44px;
    min-height: 40px;
    padding: 6px 12px;
    appearance: none;
    -webkit-appearance: none;
    ${WOOD_BUTTON}
    border-radius: 3px;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    user-select: none;
    transition:
        color 0.12s ease,
        background 0.12s ease,
        transform 0.12s ease,
        box-shadow 0.12s ease,
        border-color 0.12s ease;
}
.mechili-phone-menu:hover {
    color: ${u.brassLight};
    border-color: #6a6058;
    filter: brightness(1.12);
    transform: translateY(-1px);
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.16),
        inset 0 -2px 4px rgba(0, 0, 0, 0.4),
        0 4px 12px rgba(0, 0, 0, 0.45);
}
.mechili-phone-menu:active {
    transform: translateY(0) scale(0.98);
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.1),
        inset 0 -1px 3px rgba(0, 0, 0, 0.5),
        0 1px 4px rgba(0, 0, 0, 0.35);
}
.mechili-phone-menu:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        0 0 0 3px rgba(184, 146, 74, 0.35),
        0 2px 8px rgba(0, 0, 0, 0.4);
}
.shop-toolbar-right {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 8px;
    flex-shrink: 0;
}
.mechili-extras .level-all-global,
.shop-toolbar .level-all-global,
.mechili-phone-status .level-all-global {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    box-sizing: border-box;
    width: auto;
    min-width: 72px;
    max-width: 140px;
    height: 54px;
    min-height: 54px;
    padding: 4px 8px;
    ${WOOD_BUTTON}
    border-width: 2px;
    border-radius: 3px;
    appearance: none;
    cursor: pointer;
    pointer-events: auto;
    flex-shrink: 0;
    color: ${u.brassLight};
}
.mechili-extras .level-all-global .lag-copy,
.shop-toolbar .level-all-global .lag-copy,
.mechili-phone-status .level-all-global .lag-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
}
.mechili-extras .level-all-global .title,
.shop-toolbar .level-all-global .title,
.mechili-phone-status .level-all-global .title {
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 0.4px;
    line-height: 1.15;
    text-align: left;
    white-space: normal;
    color: ${u.phase};
}
.mechili-extras .level-all-global .lag-ico.m-icon,
.shop-toolbar .level-all-global .lag-ico.m-icon,
.mechili-phone-status .level-all-global .lag-ico.m-icon {
    width: 26px;
    height: 26px;
    font-size: 0;
    flex-shrink: 0;
}
.mechili-extras .level-all-global .cost,
.shop-toolbar .level-all-global .cost,
.mechili-phone-status .level-all-global .cost {
    font-size: 14px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
    line-height: 1;
    margin-top: 2px;
}
.mechili-extras .level-all-global,
.shop-toolbar .level-all-global,
.mechili-phone-status .level-all-global { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-extras .level-all-global:hover,
.shop-toolbar .level-all-global:hover,
.mechili-phone-status .level-all-global:hover { border-color: #6a6058; filter: brightness(1.12); transform: translateY(-1px); }
.mechili-extras .level-all-global:active,
.shop-toolbar .level-all-global:active,
.mechili-phone-status .level-all-global:active { transform: scale(0.96); }
.mechili-extras .level-all-global:focus-visible,
.shop-toolbar .level-all-global:focus-visible,
.mechili-phone-status .level-all-global:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
.mechili-extras .level-all-global.unaffordable,
.shop-toolbar .level-all-global.unaffordable,
.mechili-phone-status .level-all-global.unaffordable { opacity: 0.35; pointer-events: none; }
.mechili-shop {
    /* sized by its unit grid (2 rows, a column per 2 units, growing left) —
       at least the old 3-column width so the header / rune row keep room,
       at most half the screen; past that the grid goes to 3 rows (hud.ts fitShopRows) */
    width: max-content;
    min-width: 274px;
    max-width: 50vw;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 12px 14px;
    position: relative;
    /* parchment, like the details pane, hung from its pole */
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    pointer-events: auto;
}
/* the shop hangs from a pole along its top edge (run past the screen edge on the right) */
.mechili-shop::before {
    content: '';
    position: absolute;
    pointer-events: none;
    z-index: 2;
    ${POLE}
    right: -12px;
}
.mechili-shop .shop-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(90, 55, 20, 0.35);
}
.mechili-shop .shop-header .unit-cap {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums;
    color: ${INK_RUST};
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.mechili-shop .shop-header .unit-cap .btn-ico.m-icon {
    width: 14px;
    height: 14px;
    margin: 0;
}
.mechili-shop .shop-runes {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}
.mechili-shop .shop-rune {
    position: relative;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    padding: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    border: 1.5px solid ${u.slotBorder};
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 100%);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.65);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
}
.mechili-shop .shop-rune:hover { border-color: ${u.bronzeLight}; transform: translateY(-1px); }
.mechili-shop .shop-rune:active { transform: scale(0.94); }
.mechili-shop .shop-rune:focus-visible { outline: none; border-color: ${u.bronzeLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
.mechili-shop .shop-rune.unaffordable { opacity: 0.35; }
.mechili-shop .shop-rune.unaffordable:hover { border-color: ${u.bronzeLight}; transform: none; }
.mechili-shop .shop-rune .shop-rune-ico,
.mechili-shop .shop-rune .shop-rune-ico.m-icon {
    display: block;
    width: 100%;
    height: 100%;
    font-size: 0;
}
.mechili-shop .shop-rune .cost {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    font-size: 9px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    text-align: center;
    color: ${u.bronzeLight};
    background: linear-gradient(180deg, transparent, rgba(8, 8, 6, 0.9) 35%);
    padding: 6px 0 1px;
    pointer-events: none;
}
.mechili-shop .shop-grid,
.mechili-cards .unlock-picker .shop-grid {
    display: grid;
    /* 2 vertical tiles per column; add columns as needed. */
    grid-template-rows: repeat(var(--shop-rows, 2), var(--shop-tile, 78px));
    grid-auto-flow: column;
    /* Keep tile size stable (fitShopRows halves it for a crowded shop). */
    grid-auto-columns: var(--shop-tile, 78px);
    /* Fill columns from the right edge inward. */
    direction: rtl;
    width: 100%;
    min-width: max-content;
    box-sizing: border-box;
    gap: 6px;
}
/* The shared grid above fills from the RIGHT (direction: rtl) because the
   shop is pinned to the right edge of the screen. The unlock dialog is a
   centred modal, so it reads wrong there — fill from the left instead. The
   tiles reset direction themselves so their own content is unaffected. */
/* Unlock picker fills LTR; shop grid still fills from the physical right.
   Tile content inherits document dir so Arabic labels read correctly. */
.mechili-cards .unlock-picker .shop-grid {
    direction: ltr;
    justify-content: start;
}
.mechili-shop-col .shop-tile,
.mechili-cards .unlock-picker .shop-tile {
    direction: inherit;
    position: relative;
    overflow: hidden;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    color: ${u.cream};
    cursor: pointer;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.55),
        0 1px 0 rgba(180, 140, 80, 0.1);
}
.mechili-shop-col .shop-tile .title,
.mechili-cards .unlock-picker .shop-tile .title {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 3px 4px;
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 0.6px;
    text-align: center;
    line-height: 1.1;
    color: ${u.cream};
    background: linear-gradient(180deg, rgba(34, 28, 22, 0.94), rgba(20, 16, 12, 0.9));
    border-bottom: 1px solid ${u.frameLo};
    pointer-events: none;
    z-index: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-shop-col .shop-tile .art,
.mechili-cards .unlock-picker .shop-tile .art {
    position: absolute;
    inset: 0;
    background-color: #e8dcc4;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    pointer-events: none;
}
.mechili-shop-col .shop-tile .cost,
.mechili-cards .unlock-picker .shop-tile .cost {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 2px 7px 3px;
    font-size: 12px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: #fff;
    background: rgba(160, 40, 28, 0.92);
    border-radius: 0 4px 0 0;
    pointer-events: none;
    z-index: 1;
}
.mechili-shop-col .shop-tile,
.mechili-cards .unlock-picker .shop-tile { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
/* the tiles pop in one after another (shop back for a new deployment, a tab switch);
   'backwards' holds only the from-state during the delay, so hover / press still work */
.mechili-shop-col .shop-tile.is-popping { animation: mechili-tile-pop 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.25) backwards; }
@keyframes mechili-tile-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.85); }
    to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-shop-col .shop-tile.is-popping { animation: none; }
}
.mechili-shop-col .shop-tile:hover,
.mechili-cards .unlock-picker .shop-tile:hover { border-color: ${u.bronzeLight}; }
.mechili-shop-col .shop-tile:active,
.mechili-cards .unlock-picker .shop-tile:active { transform: scale(0.94); }
.mechili-shop-col .shop-tile:focus-visible,
.mechili-cards .unlock-picker .shop-tile:focus-visible { outline: none; border-color: ${u.bronzeLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); z-index: 3; }
/* Dimmed but still HOVERABLE: you often want to read a unit's talents
   precisely when you cannot afford it yet. pointer-events:none would take
   the info frame away with the click, so the click is refused in JS instead
   — same treatment the panel's locked/owned tiles already get. */
.mechili-shop-col .shop-tile.unaffordable,
.mechili-cards .unlock-picker .shop-tile.unaffordable {
    opacity: 0.35;
    cursor: default;
}
.mechili-extras .shop-tile {
    width: 54px;
    height: 54px;
    border-radius: 3px;
    flex-shrink: 0;
}
.mechili-extras .shop-tile .title {
    font-size: 8px;
    padding: 2px 3px;
    letter-spacing: 0.4px;
}
.mechili-extras .shop-tile .cost {
    font-size: 10px;
    padding: 1px 5px 2px;
}
.mechili-shop .shop-grid .shop-tile,
.mechili-cards .unlock-picker .shop-grid .shop-tile {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 3px;
}
.mechili-shop .shop-grid .shop-tile .title,
.mechili-cards .unlock-picker .shop-grid .shop-tile .title {
    font-size: 9px;
    padding: 2px 4px;
    letter-spacing: 0.5px;
}
.mechili-shop .shop-grid .shop-tile .cost,
.mechili-cards .unlock-picker .shop-grid .shop-tile .cost {
    font-size: 11px;
    padding: 2px 6px 2px;
}
/* a crowded shop's half-size tiles: smaller labels so name and price still fit */
.mechili-shop .shop-grid.compact .shop-tile .title { font-size: 7.5px; padding: 1px 3px; letter-spacing: 0.2px; }
.mechili-shop .shop-grid.compact .shop-tile .cost { font-size: 9px; padding: 1px 4px 1px; }
.mechili-shop .shop-tile.unlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 0;
    aspect-ratio: 1;
    opacity: 0.45;
    pointer-events: none;
    cursor: default;
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 100%);
}
.mechili-shop .shop-tile.unlock.available {
    opacity: 1;
    pointer-events: auto;
    cursor: pointer;
    border-color: ${u.bronze};
}
.mechili-shop .shop-tile.unlock.available:hover {
    border-color: ${u.bronzeLight};
    transform: translateY(-2px);
}
.mechili-shop .shop-tile.unlock .unlock-icon {
    font-size: 18px;
    line-height: 1;
    color: ${u.creamMuted};
}
.mechili-shop .shop-tile.unlock .unlock-label {
    font-size: 8px;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: ${u.textMuted};
    text-align: center;
    padding: 0 3px;
}

.mechili-panel {
    position: absolute;
    left: env(safe-area-inset-left);
    bottom: env(safe-area-inset-bottom);
    min-width: 244px;
    max-width: 300px;
    padding: 12px 14px;
    /* chrome filled by materialStyles docked-panel frame */
    color: ${u.cream};
    user-select: none;
}
/* the details pane: up and in when it appears, down and out when it goes */
.mechili-panel.is-entering { animation: mechili-panel-in 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.1) both; }
.mechili-panel.is-leaving { animation: mechili-panel-out 0.24s ease-in both; pointer-events: none; }
@keyframes mechili-panel-in {
    from { opacity: 0; transform: translateY(14px) scale(0.98); }
    to { opacity: 1; transform: none; }
}
@keyframes mechili-panel-out {
    from { opacity: 1; transform: none; }
    to { opacity: 0; transform: translateY(10px); }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-panel.is-entering, .mechili-panel.is-leaving { animation: none; }
}
.mechili-panel .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
.mechili-panel .team { font-size: 11px; letter-spacing: 0.5px; margin-bottom: 8px; }
.mechili-panel .team.player { color: ${shadeCss(teamColors.player.hex, -0.3)}; }
.mechili-panel .team.enemy { color: ${shadeCss(teamColors.enemy.hex, -0.3)}; }
.mechili-panel .team.horde { color: ${HORDE_COLOR.css}; }
.mechili-panel .row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-panel .row .v { color: ${INK_RUST}; font-weight: 700; font-variant-numeric: tabular-nums; }
/* the XP bar as a small banner like the commanders' (a faded shadow of the full
   length, the cloth with a swallowtail end) */
.mechili-panel .xpbar {
    position: relative;
    height: 7px;
    margin: 0 0 6px;
    background: rgba(60, 35, 12, 0.28);
    clip-path: polygon(0 0, 100% 0, calc(100% - 5px) 50%, 100% 100%, 0 100%);
    border-radius: 0;
    overflow: hidden;
}
.mechili-panel .xpbar div {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    clip-path: polygon(0 0, 100% 0, calc(100% - 5px) 50%, 100% 100%, 0 100%);
    filter: saturate(0.78) sepia(0.2);
}
.mechili-panel .xpbar.player div { background: ${pc}; }
.mechili-panel .xpbar.enemy div { background: ${ec}; }
.mechili-panel .xpbar.horde div { background: ${HORDE_COLOR.css}; }
/* horizontal row of square action tiles (sell, techs, tower actions) */
.mechili-panel .action-row {
    display: flex; flex-wrap: wrap; gap: 5px;
    margin-top: 10px; border-top: 1px solid rgba(90, 55, 20, 0.35); padding-top: 10px;
}
/* header: big level block · name+team · leveling tiles */
.mechili-panel .panel-head {
    display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.mechili-panel .lvl-big {
    flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-width: 42px; padding: 2px 6px 3px;
    /* stamped in ink on the parchment */
    background: rgba(110, 62, 20, 0.1);
    border: 1.5px solid rgba(90, 48, 16, 0.6);
    border-radius: 3px;
    box-shadow: inset 0 0 6px rgba(90, 48, 16, 0.18);
    line-height: 1;
}
.mechili-panel .lvl-big .lvl-cap { font-size: 8px; font-weight: bold; letter-spacing: 1.5px; color: ${INK_MUTED}; }
.mechili-panel .lvl-big .lvl-num { font-size: 27px; font-weight: 900; color: ${INK_RUST}; }
/* level 2+: a solid badge in the level's own colour (exactly the unit's tint in the
   world — blue, gold), a darker rim, light lettering with a dark shadow so it reads
   on either */
.mechili-panel .lvl-big[style*="--lvl"] {
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, transparent 45%, rgba(0, 0, 0, 0.12) 100%),
        var(--lvl);
    border-color: color-mix(in srgb, var(--lvl) 55%, black);
    box-shadow: 0 1px 3px rgba(40, 20, 4, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.mechili-panel .lvl-big[style*="--lvl"] .lvl-num,
.mechili-panel .lvl-big[style*="--lvl"] .lvl-cap {
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.45);
}
.mechili-panel .head-main { flex: 1; min-width: 0; }
.mechili-panel .head-names {
    display: flex; align-items: baseline; gap: 8px; min-width: 0;
    white-space: nowrap; overflow: hidden;
}
.mechili-panel .head-names .title {
    margin-bottom: 0; min-width: 0;
    overflow: hidden; text-overflow: ellipsis;
}
.mechili-panel .head-names .team {
    margin-bottom: 0; flex-shrink: 0; opacity: 0.9;
}
.mechili-panel .level-actions { display: flex; gap: 5px; flex-shrink: 0; }
.mechili-panel .level-actions .action-tile { color: ${u.brassLight}; }
.mechili-panel .action-tile {
    position: relative;
    width: 46px; height: 46px;
    box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    /* leave room at the bottom for the cost strip so the icon centers above it;
       when there's no strip (owned / no price), center in the full tile */
    padding: 0; margin: 0;
    appearance: none; -webkit-appearance: none;
    /* a dark wooden slot with an iron rim, set into the parchment */
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #24180f 0%, #1a110a 55%, #22170e 100%);
    border: 1.5px solid #2c2723;
    border-radius: 3px;
    color: ${u.cream};
    cursor: pointer;
    overflow: visible;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.65),
        inset 0 -1px 0 rgba(214, 170, 120, 0.06),
        0 1px 2px rgba(60, 30, 8, 0.35);
}
.mechili-panel .action-tile:has(.at-cost) { padding-bottom: 12px; }
.mechili-panel .action-tile .at-icon { font-size: 27px; line-height: 1; }
/* supply / price coin — scales with surrounding text by default */
.money-ico.m-icon {
    width: 1em;
    height: 1em;
    margin-inline-end: 0.2em;
    vertical-align: -0.12em;
}
.mechili-sidebar .inv-item .m-icon { width: 30px; height: 30px; }
.mechili-sidebar .inv-item:not(.tactic) { border-radius: 50%; overflow: hidden; padding: 0; }
.mechili-sidebar .inv-item:not(.tactic) .m-icon { width: 100%; height: 100%; }
.mechili-panel .action-tile .at-icon.m-icon { width: 28px; height: 28px; font-size: 0; }
/* a rendered unit portrait instead of an icon (e.g. a wall's Make gate) — the whole tile, cost strip on top */
.mechili-panel .action-tile .at-icon.at-art {
    position: absolute;
    inset: 2px;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    pointer-events: none;
}
.mechili-panel .action-info .ai-icon.m-icon { width: 28px; height: 28px; font-size: 0; }
.mechili-panel .item-sq.m-icon { width: 44px; height: 44px; font-size: 0; border-radius: 50%; overflow: hidden; }
.mechili-phonebar button .pb-ico.m-icon { width: 22px; height: 22px; font-size: 0; }
.mechili-fightbar .chat-bubble.emote .m-icon { width: 56px; height: 56px; vertical-align: 0; }
.mechili-fightbar .cf-body .m-icon { width: 28px; height: 28px; vertical-align: -6px; }
.inv-drag.m-icon { width: 40px; height: 40px; font-size: 0; background-color: ${u.techBuyBg}; }
.btn-ico.m-icon { width: 16px; height: 16px; margin-inline-end: 4px; vertical-align: -3px; }
.mechili-phone-status .btn-ico.m-icon { width: 22px; height: 22px; margin: 0; }
.mechili-panel .action-tile .at-cost {
    position: absolute; left: 0; bottom: 0; right: 0;
    padding: 1px 0 2px;
    font-size: 9px; font-weight: bold; text-align: center;
    font-variant-numeric: tabular-nums;
    color: #f6ecd8;
    background: linear-gradient(180deg, #8e2418 0%, #6c160e 100%);
    border-radius: 0 0 2px 2px;
    pointer-events: none;
}
.mechili-panel .action-tile .at-cost.refund { background: linear-gradient(180deg, #3d6e2a 0%, #2b5220 100%); }
.mechili-panel .action-tile .at-badge {
    position: absolute; top: -5px; right: -5px;
    width: 16px; height: 16px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: bold;
    color: #f4ecd8; background: #5c7a2c;
    border: 1px solid #2c3a14;
    border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
    pointer-events: none;
}
.mechili-panel .action-tile { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-panel .action-tile:hover { border-color: #6a6058; transform: translateY(-1px); }
.mechili-panel .action-tile:active { transform: scale(0.94); }
.mechili-panel .action-tile:focus-visible { outline: none; border-color: #8a7f74; box-shadow: 0 0 0 3px rgba(90, 48, 16, 0.4); }
.mechili-panel .action-tile.locked { opacity: 0.42; }
.mechili-panel .action-tile.owned { border-color: #5c7a2c; cursor: default; }
.mechili-panel .action-tile.on { border-color: #c0392b; box-shadow: 0 0 0 1px #c0392b inset; }
.mechili-panel .action-tile.owned .at-icon { opacity: 0.7; }
.mechili-panel .action-tile.owned.hexed,
.mechili-panel .action-tile.buy.hexed,
.mechili-panel .action-tile.locked.hexed {
    position: relative;
    overflow: hidden;
    border-color: #4ec8ff;
    background:
        linear-gradient(145deg, rgba(12, 48, 90, 0.94), rgba(6, 16, 36, 0.96));
    box-shadow:
        0 0 0 1px rgba(80, 200, 255, 0.55) inset,
        0 0 14px rgba(40, 160, 255, 0.5);
    opacity: 1;
    filter: none;
    cursor: default;
    animation: mechili-hex-pulse 0.28s steps(2, end) infinite;
}
.mechili-panel .action-tile.owned.hexed:hover,
.mechili-panel .action-tile.buy.hexed:hover,
.mechili-panel .action-tile.locked.hexed:hover {
    border-color: #8adcff;
    transform: none;
}
.mechili-panel .action-tile.hexed .at-icon,
.mechili-panel .action-tile.hexed .at-produce {
    opacity: 0.28;
    filter: grayscale(1) brightness(0.7);
}
.mechili-panel .action-tile.hexed .at-cost {
    display: none;
}
.mechili-panel .action-tile .at-hex-slash {
    position: absolute;
    inset: -20%;
    z-index: 2;
    pointer-events: none;
    background: linear-gradient(
        to top left,
        transparent calc(50% - 2.5px),
        #5ad4ff calc(50% - 2px),
        #5ad4ff calc(50% + 2px),
        transparent calc(50% + 2.5px)
    );
    opacity: 0.95;
}
@keyframes mechili-hex-pulse {
    0%, 49.9% {
        box-shadow: 0 0 0 1px rgba(140, 230, 255, 0.95) inset, 0 0 18px rgba(60, 200, 255, 0.85);
        border-color: #8adcff;
    }
    50%, 100% {
        /* stay cyan — only ease the glow, don't drop into steel grey */
        box-shadow: 0 0 0 1px rgba(90, 190, 240, 0.55) inset, 0 0 8px rgba(50, 160, 230, 0.4);
        border-color: #4eb8e8;
    }
}
.mechili-panel .action-tile.hexed .at-hex-slash {
    animation: mechili-hex-slash 0.28s steps(2, end) infinite;
}
@keyframes mechili-hex-slash {
    0%, 49.9% { opacity: 1; }
    50%, 100% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-panel .action-tile.hexed,
    .mechili-panel .action-tile.hexed .at-hex-slash { animation: none; }
}
.mechili-panel .action-tile.producing .at-icon { opacity: 1; }
.mechili-panel .action-tile .at-produce {
    position: relative;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
}
.mechili-panel .action-tile .at-produce-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(
        from -90deg,
        ${u.techOwned} calc(var(--p, 0) * 100%),
        rgba(255, 255, 255, 0.14) 0
    );
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
    pointer-events: none;
}
.mechili-panel .action-tile .at-produce.done .at-produce-ring {
    background: conic-gradient(from -90deg, ${u.techOwned} 100%, ${u.techOwned} 0);
}
.mechili-panel .action-tile .at-produce .at-icon.m-icon {
    width: 22px;
    height: 22px;
    position: relative;
    z-index: 1;
}
.mechili-panel .action-tile .at-badge.produce-count {
    font-size: 8px;
    letter-spacing: -0.2px;
    padding: 1px 3px;
    min-width: 0;
}
.mechili-panel .action-tile.empty {
    background: linear-gradient(180deg, #1c130b 0%, #24190f 100%);
    border: 1.5px solid #3a342e;
    cursor: default;
    pointer-events: auto;
}
.mechili-panel .tech-slots { margin-top: 10px; }

/* the big hover frame — pops to the right of the panel with full details
   (panel stays physical-left; do not flip with locale dir) */
.mechili-panel .action-info {
    position: absolute;
    left: calc(100% + 8px);
    bottom: 0;
    width: 220px;
    padding: 12px 14px;
    background: ${u.panelBgSolid};
    border: 1.5px solid ${u.brass};
    border-radius: 4px;
    color: ${u.text};
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
    z-index: 6;
}
.mechili-panel .action-info .ai-head { display: flex; align-items: center; gap: 10px; }
.mechili-panel .action-info .ai-icon { font-size: 28px; line-height: 1; }
.mechili-panel .action-info .ai-title {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: bold;
    color: ${u.brassLight};
}
.mechili-panel .action-info .ai-desc { font-size: 12px; line-height: 1.5; color: ${u.text}; margin-top: 8px; }
.mechili-panel .action-info .ai-forge-ings {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 3px;
    margin: 0 0 0 auto;
    align-items: center;
    flex-shrink: 0;
}
.mechili-panel .action-info .ai-forge-fee {
    margin-left: 2px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
    white-space: nowrap;
}
.mechili-panel .action-info .ai-forge-ing {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
}
.mechili-panel .action-info .ai-note { font-size: 11px; color: ${u.textMuted}; margin-top: 6px; font-style: italic; }
.mechili-panel .action-info .ai-cost { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: bold; color: ${u.brass}; }
.mechili-panel .action-info .ai-cost.refund { color: ${u.techOwned}; }
.mechili-panel .action-info .ai-cost.owned { color: ${u.techOwned}; }
.mechili-panel .action-info .ai-cost.hexed { color: #6ad4ff; font-weight: 800; }
.mechili-panel .action-info .ai-note:has(+ .ai-cost.hexed),
.mechili-panel .action-info:has(.ai-cost.hexed) .ai-note { color: #8adcff; font-style: normal; font-weight: 600; }
.mechili-panel .action-info .ai-buy {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 10px 14px;
    appearance: none;
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border: 1.5px solid ${u.brassLight};
    border-radius: 3px;
    color: #20180a;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 0.6px;
    cursor: pointer;
}

.mechili-sidebar {
    position: absolute;
    /* biased upward with a guaranteed clearance to the bottom panels
       (selection details left, money/shop right) */
    top: 40%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    /* many tactics: wrap into extra columns instead of growing off-screen */
    flex-wrap: wrap;
    align-content: flex-start;
    max-height: min(56vh, calc(100vh - 360px));
    align-items: center;
    gap: 6px;
    padding: 8px 6px;
    background: linear-gradient(180deg, rgba(44, 36, 28, 0.94), rgba(22, 18, 14, 0.96));
    border: 1.5px solid ${u.border};
    border-radius: 0;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    user-select: none;
    transition: opacity 0.28s ease, transform 0.28s ease, visibility 0.28s;
}
.mechili-sidebar.left {
    left: env(safe-area-inset-left);
    border-left: none;
    border-radius: 0 4px 4px 0;
}
/* taller shop/money stack than the left detail panel — wrap sooner */
.mechili-sidebar.right {
    right: env(safe-area-inset-right);
    border-right: none;
    border-radius: 4px 0 0 4px;
    max-height: min(48vh, calc(100vh - 440px));
}
/* enemy intel: half-size only when the bag is long (>5 tiles) */
.mechili-sidebar.right.compact {
    gap: 3px;
    padding: 5px 4px;
}
.mechili-sidebar.right.compact .inv-title {
    width: 24px;
    font-size: 7px;
    letter-spacing: 0.4px;
    padding: 1px 0;
}
.mechili-sidebar.right.compact .inv-title-meta {
    font-size: 7px;
    gap: 2px;
}
.mechili-sidebar.right.compact .inv-title .inv-chevron {
    border-left-width: 2.5px;
    border-right-width: 2.5px;
    border-top-width: 3.5px;
}
.mechili-sidebar.right.compact .inv-item {
    width: 24px;
    height: 24px;
    font-size: 11px;
    border-width: 1px;
}
.mechili-sidebar.right.compact .inv-item .m-icon {
    width: 16px;
    height: 16px;
}
.mechili-sidebar.right.compact .inv-item:not(.tactic) .m-icon {
    width: 100%;
    height: 100%;
}
.mechili-sidebar.right.compact .inv-item .inv-cd {
    right: 0;
    bottom: 0;
    min-width: 9px;
    padding: 0 2px;
    font-size: 7px;
    line-height: 9px;
    border-radius: 2px;
}
.mechili-sidebar.right.compact .inv-item .rune-lvl {
    right: -5px;
    bottom: -5px;
    width: 14px;
    height: 14px;
    font-size: 9px;
    border-width: 1.5px;
}
.mechili-sidebar.right.compact .inv-item:has(.inv-cd.cancel) {
    padding-bottom: 8px;
}
.mechili-sidebar.battle,
.mechili-sidebar.left.waiting {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}
.mechili-sidebar.battle *,
.mechili-sidebar.left.waiting * {
    pointer-events: none !important;
}
.mechili-sidebar.left.battle,
.mechili-sidebar.left.waiting {
    transform: translate(-12px, -50%);
}
.mechili-sidebar.right.battle {
    transform: translate(12px, -50%);
}
/* the hover peek must not sit under the cursor — it would steal the hover
   from the commander card and flicker */
.mechili-cards.detail.peek { pointer-events: none; }
.mechili-cards .round-picks {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    min-width: 220px;
    max-width: 320px;
}
.mechili-cards .round-picks-title {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${u.textMuted};
}
.mechili-cards .round-pick {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    padding: 8px 10px;
    background: ${u.panelBgDark};
    border: 1px solid ${u.border};
    border-radius: 3px;
}
.mechili-cards .round-pick .rp-round {
    grid-row: 1 / span 2;
    align-self: center;
    font-size: 12px;
    font-weight: 800;
    color: ${u.brass};
}
.mechili-cards .round-pick .rp-title {
    font-size: 14px;
    font-weight: 700;
    color: ${u.text};
}
.mechili-cards .round-pick .rp-body {
    grid-column: 2;
    font-size: 12px;
    color: ${u.textMuted};
    line-height: 1.35;
}
.mechili-sidebar .inv-title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    margin: 0;
    padding: 2px 0;
    width: 48px;
    box-sizing: border-box;
    font: inherit;
    font-size: 9px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: ${u.textMuted};
    background: transparent;
    border: none;
    cursor: default;
    pointer-events: none;
}
.mechili-sidebar .inv-title-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mechili-sidebar .inv-title-meta {
    display: none;
    align-items: center;
    gap: 3px;
    font-size: 9px;
    letter-spacing: 0;
    text-transform: none;
    color: ${u.brass};
}
.mechili-sidebar .inv-title .inv-chevron {
    width: 0;
    height: 0;
    border-left: 3.5px solid transparent;
    border-right: 3.5px solid transparent;
    border-top: 4.5px solid ${u.brass};
    transition: transform 0.12s ease;
}
.mechili-sidebar.folded .inv-title .inv-chevron {
    transform: rotate(-90deg);
}
.mechili-sidebar.can-collapse .inv-title {
    pointer-events: auto;
    cursor: pointer;
    border-radius: 6px;
}
.mechili-sidebar.can-collapse .inv-title:hover {
    color: ${u.brassLight};
    background: rgba(255, 255, 255, 0.06);
}
.mechili-sidebar.can-collapse .inv-title-meta { display: inline-flex; }
.mechili-sidebar.folded .inv-item { display: none !important; }
.mechili-sidebar .inv-item {
    position: relative;
    width: 48px;
    height: 48px;
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${u.techBuyBg};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    cursor: pointer;
}
.mechili-sidebar .inv-item { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-sidebar .inv-item:hover { border-color: ${u.hover}; transform: translateY(-1px); }
.mechili-sidebar .inv-item:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
.mechili-sidebar .inv-item:not(.tactic) {
    background: transparent;
    border: none;
}
.mechili-sidebar .inv-item:not(.tactic):hover { filter: brightness(1.1); }
.mechili-sidebar .inv-item:not(.tactic).armed { box-shadow: 0 0 10px ${u.brass}; }
.mechili-sidebar .inv-item:not(.tactic).placed {
    box-shadow: 0 0 8px rgba(80, 200, 100, 0.45);
    cursor: default;
}
.mechili-sidebar .inv-item.placed .i { opacity: 0.85; }
.mechili-sidebar .inv-item .inv-cd {
    position: absolute;
    right: 2px;
    bottom: 1px;
    min-width: 12px;
    padding: 0 3px;
    font-size: 9px;
    font-weight: 700;
    line-height: 12px;
    text-align: center;
    color: ${u.brassLight};
    background: rgba(12, 10, 8, 0.85);
    border: 1px solid ${u.border};
    border-radius: 4px;
    pointer-events: none;
    text-transform: lowercase;
}
.mechili-sidebar .inv-item:not(.tactic).rune-leveled,
.mechili-panel .item-sq.rune-leveled {
    overflow: visible;
    border: 2px solid;
    box-sizing: border-box;
    z-index: 2;
}
.mechili-sidebar .inv-item .rune-lvl,
.mechili-panel .item-sq .rune-lvl {
    position: absolute;
    right: -7px;
    bottom: -7px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    font-size: 14px;
    font-weight: 900;
    line-height: 1;
    color: #fff;
    background: rgba(8, 6, 4, 0.94);
    border: 2px solid var(--rune-lvl, ${u.brassLight});
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
    pointer-events: none;
    z-index: 3;
}
.mechili-sidebar .inv-item .inv-cd.wait {
    color: ${u.brassLight};
}
/* same full-bleed bottom strip as .action-tile .at-cost — brass, not red */
.mechili-sidebar .inv-item:has(.inv-cd.cancel) {
    padding-bottom: 12px;
}
.mechili-sidebar .inv-item .inv-cd.cancel {
    left: 0;
    right: 0;
    bottom: 0;
    min-width: 0;
    padding: 1px 0 2px;
    font-size: 9px;
    font-weight: bold;
    line-height: 1.2;
    letter-spacing: 0.3px;
    color: #20180a;
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border: none;
    border-radius: 0 0 7px 7px;
}
.mechili-sidebar .inv-item.cancelable {
    box-shadow: 0 0 8px rgba(200, 140, 60, 0.35);
}
.mechili-sidebar .inv-item.cooling {
    opacity: 0.72;
}
.mechili-sidebar .inv-item.placed .inv-cd.wait { color: ${u.brassLight}; }
.mechili-sidebar .inv-item.readonly { cursor: default; }
.mechili-sidebar .inv-item.readonly:not([data-spell-tip]) { pointer-events: none; }
.inv-drag {
    position: fixed;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    background: transparent;
    border: none;
    border-radius: 50%;
    overflow: visible;
    color: ${u.text};
    pointer-events: none;
    z-index: 50;
    transition: box-shadow 0.12s ease, transform 0.12s ease;
}
.inv-drag.m-icon { width: 40px; height: 40px; font-size: 0; background-color: ${u.techBuyBg}; }
.inv-drag .inv-drag-rune {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    background-color: ${u.techBuyBg};
    flex: 0 0 auto;
}
.inv-drag .inv-drag-spells {
    position: absolute;
    left: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 6px;
}
.inv-drag .inv-drag-spell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
}
.inv-drag .inv-drag-spell-ico {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    background: ${u.panelBgDark};
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.inv-drag .inv-drag-spell.bake .inv-drag-spell-ico {
    width: 30px;
    height: 30px;
    box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.85), 0 0 10px rgba(0, 255, 102, 0.45);
}
.inv-drag .inv-drag-spell.path .inv-drag-spell-ico {
    opacity: 0.9;
    filter: saturate(0.9);
}
.inv-drag .inv-drag-missing {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 1px;
    justify-content: center;
    min-height: 12px;
}
.inv-drag .inv-drag-miss {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    overflow: hidden;
    opacity: 0.8;
}
.inv-drag.forge-preview {
    overflow: visible;
}
.forge-slot-preview {
    position: fixed;
    z-index: 52;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 6px;
    transform: translateY(-50%);
    pointer-events: none;
}
.forge-slot-preview[hidden] {
    display: none !important;
}
.forge-slot-preview.recipes {
    flex-direction: column;
    transform: none;
    align-items: stretch;
    gap: 0;
    max-width: min(96vw, 640px);
    max-height: min(78vh, 520px);
    overflow-y: auto;
    overflow-x: auto;
    padding: 8px 10px 10px;
    border-radius: 4px;
    background: linear-gradient(180deg, rgba(44, 36, 28, 0.96), rgba(22, 18, 14, 0.96));
    border: 1.5px solid ${u.border};
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 80;
    /* must hit-test: otherwise outside/preview clicks pass through and the
     * panel never dismisses (touch peek / sticky after click-open) */
    pointer-events: auto;
    cursor: default;
}
.forge-slot-preview.recipes .forge-recipes-block {
    margin: 0;
    padding: 0;
}
.forge-slot-preview.recipes .forge-recipes-hint {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: ${u.phase};
    margin: 0 0 8px;
    padding: 0 2px;
    text-align: center;
}
.forge-slot-preview.recipes .forge-tile {
    padding: 6px 8px;
    column-gap: 4px;
    row-gap: 2px;
    background: ${u.panelBgDark};
    border-color: ${u.border};
    min-width: 0;
    max-width: none;
}
.forge-slot-preview.recipes .forge-tile .forge-spell {
    width: 26px;
    height: 26px;
}
.forge-slot-preview.recipes .forge-tile-ings .forge-ing {
    width: 22px;
    height: 22px;
}
.forge-slot-preview.recipes .forge-tile-name {
    font-size: 11px;
}
.forge-slot-preview .inv-drag-spell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
}
.forge-slot-preview .inv-drag-spell-ico {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    background: ${u.panelBgDark};
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.forge-slot-preview .inv-drag-spell.bake .inv-drag-spell-ico {
    width: 30px;
    height: 30px;
    box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.85), 0 0 10px rgba(0, 255, 102, 0.45);
}
.forge-slot-preview .inv-drag-spell.path .inv-drag-spell-ico {
    opacity: 0.9;
    filter: saturate(0.9);
}
.forge-slot-preview .inv-drag-missing {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 1px;
    justify-content: center;
    min-height: 12px;
}
.forge-slot-preview .inv-drag-miss {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    overflow: hidden;
    opacity: 0.8;
}
.inv-drag.drop-ready {
    box-shadow: 0 0 0 3px #00ff66, 0 0 14px rgba(0, 255, 102, 0.85);
    transform: scale(1.12);
}

.mechili-panel .item-row { display: flex; gap: 6px; margin: 4px 0 8px; }
/* oven slots three to a line (a shared 2v2 oven: 3 + 3); the buy tile / product sit beside them */
.mechili-panel .forge-row { align-items: center; }
.mechili-panel .forge-row .forge-slots {
    display: grid;
    grid-template-columns: repeat(3, 44px);
    gap: 6px;
    flex: 0 0 auto;
}
.mechili-panel .forge-block { margin: 4px 0 10px; }
.mechili-panel .forge-block.ready {
    padding: 8px 8px 6px;
    margin-left: -8px;
    margin-right: -8px;
    border-radius: 4px;
    background: rgba(60, 110, 30, 0.14);
    box-shadow: inset 0 0 0 1px rgba(64, 150, 44, 0.45);
    animation: forge-panel-ready 1.6s ease-in-out infinite;
}
.mechili-panel .forge-label {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
    margin-bottom: 4px;
}
.mechili-panel .forge-block.ready .forge-label {
    opacity: 1;
    color: #2f6b1f;
}
.mechili-panel .forge-hint {
    font-size: 12px;
    line-height: 1.35;
    opacity: 0.85;
    margin-top: 4px;
    max-width: 280px;
}
.mechili-panel .forge-bake-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    font-size: 14px;
    font-weight: 700;
    color: #2f6b1f;
    opacity: 0.9;
    flex: 0 0 auto;
}
.mechili-panel .item-sq.forge-bake {
    box-shadow: 0 0 0 2px rgba(64, 150, 44, 0.85), 0 0 12px rgba(64, 150, 44, 0.45);
    animation: forge-bake-pulse 1.25s ease-in-out infinite;
}
.mechili-panel .item-sq.forge-bake.rune-leveled {
    border-width: 2px;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--rune-lvl) 85%, transparent),
        0 0 12px color-mix(in srgb, var(--rune-lvl) 45%, transparent);
    animation: forge-bake-lvl-pulse 1.25s ease-in-out infinite;
}
@keyframes forge-bake-lvl-pulse {
    0%, 100% {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--rune-lvl) 70%, transparent),
            0 0 8px color-mix(in srgb, var(--rune-lvl) 35%, transparent);
    }
    50% {
        box-shadow: 0 0 0 3px var(--rune-lvl),
            0 0 16px color-mix(in srgb, var(--rune-lvl) 65%, transparent);
    }
}
.mechili-panel .item-sq.forge-bake.cancelable {
    cursor: pointer;
    padding: 0;
}
.mechili-panel .item-sq.forge-bake.cancelable:hover {
    box-shadow: 0 0 0 2px rgba(220, 70, 55, 0.95), 0 0 12px rgba(220, 70, 55, 0.5);
    animation: none;
}
/* the unpaid oven's buy button: an action tile sized to sit in the rune row,
   with the product on it and the price in the red band the shop tiles use */
.mechili-panel .forge-row .action-tile.forge-buy {
    width: 44px;
    height: 44px;
    padding: 0 0 12px;
    flex: 0 0 auto;
    position: relative;
    border-radius: 6px;
}
.mechili-panel .forge-row .action-tile.forge-buy .at-icon {
    width: 30px;
    height: 30px;
}
@keyframes forge-panel-ready {
    0%, 100% { box-shadow: inset 0 0 0 1px rgba(64, 150, 44, 0.4); }
    50% { box-shadow: inset 0 0 0 1px rgba(64, 150, 44, 0.85), 0 0 14px rgba(64, 150, 44, 0.2); }
}
@keyframes forge-bake-pulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(64, 150, 44, 0.7), 0 0 8px rgba(64, 150, 44, 0.35); }
    50% { box-shadow: 0 0 0 3px rgba(64, 150, 44, 1), 0 0 16px rgba(64, 150, 44, 0.65); }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-panel .forge-block.ready,
    .mechili-panel .item-sq.forge-bake,
    .mechili-panel .item-sq.forge-bake.rune-leveled { animation: none; }
}
.mechili-panel .item-sq {
    position: relative;
    width: 44px;
    height: 44px;
    /* never squeezed by a full row — a shrunk width turned the round slots into eggs */
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    background: transparent;
    border: none;
    border-radius: 50%;
    overflow: hidden;
    cursor: help;
}
.mechili-panel .item-sq.empty {
    background: radial-gradient(circle at 50% 40%, #2a1d12 0%, #170f08 100%);
    border: 1.5px solid #3a342e;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
    cursor: default;
}
.mechili-panel .item-sq.empty.drop-target {
    border-color: #3f8f2a;
    box-shadow: 0 0 0 1px rgba(64, 150, 44, 0.35), 0 0 10px rgba(64, 150, 44, 0.45);
    cursor: pointer;
}
.mechili-panel .item-sq.empty.drop-target:hover {
    filter: brightness(1.15);
    box-shadow: 0 0 0 2px #3f8f2a, 0 0 14px rgba(64, 150, 44, 0.7);
}
.mechili-panel .item-sq:not(.empty) { transition: transform 0.12s ease, filter 0.12s ease; }
.mechili-panel .item-sq:not(.empty):hover { transform: translateY(-1px); filter: brightness(1.12); }
.mechili-panel .item-sq.removable {
    cursor: pointer;
    box-shadow: 0 0 0 1px rgba(255, 200, 80, 0.45);
}
.mechili-panel .item-sq.removable:active { cursor: grabbing; }
.mechili-panel .item-sq.forge-suggest {
    cursor: pointer;
    box-shadow: 0 0 0 1.5px rgba(64, 150, 44, 0.55);
    opacity: 0.95;
}
.mechili-panel .item-sq.forge-suggest:hover {
    box-shadow: 0 0 0 2px rgba(64, 150, 44, 0.9), 0 0 10px rgba(64, 150, 44, 0.35);
    filter: brightness(1.12);
}

.mechili-cards.detail .forge-group-note {
    margin: 0 0 12px;
    font-size: 12px;
    line-height: 1.4;
    color: ${u.textMuted};
    text-align: center;
    max-width: 52rem;
    margin-left: auto;
    margin-right: auto;
}
/* specialist detail: forge list beside the card on desktop; hidden when cramped */
.mechili-cards.detail .spec-card-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}
.mechili-cards.detail .forge-recipes-block {
    display: none;
}
@media (min-width: 700px) and (min-height: 541px) {
    .mechili-cards.detail .spec-card-row {
        flex-direction: row;
        align-items: flex-start;
        gap: 14px;
    }
    .mechili-cards.detail .forge-recipes-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: auto;
        margin: 0;
        padding: 0;
        min-width: 0;
        max-width: min(72vw, 640px);
    }
    .mechili-cards.detail .forge-tile {
        padding: 6px 8px;
        column-gap: 4px;
        row-gap: 2px;
        background: ${u.panelBgDark};
        border-color: ${u.border};
    }
    .mechili-cards.detail .forge-tile .forge-spell {
        width: 26px;
        height: 26px;
    }
    .mechili-cards.detail .forge-tile-ings .forge-ing {
        width: 22px;
        height: 22px;
    }
    .mechili-cards.detail .forge-tile-name {
        font-size: 11px;
    }
}
.forge-panel {
    max-width: min(96vw, 1100px);
}
.forge-recipe-groups {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 10px;
}
.forge-recipe-group {
    flex: 1 1 0;
    min-width: 168px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.forge-recipe-group + .forge-recipe-group {
    border-inline-start: 1px solid ${u.divider};
    padding-inline-start: 10px;
}
.forge-recipe-group-title {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${u.brassLight};
    text-align: center;
    padding: 0 2px 2px;
}
.forge-recipe-group .forge-tile-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
@media (max-width: 599px), (max-height: 540px) {
    .forge-recipe-groups {
        flex-direction: column;
        gap: 12px;
    }
    .forge-recipe-group + .forge-recipe-group {
        border-inline-start: none;
        padding-inline-start: 0;
        border-top: 1px solid ${u.divider};
        padding-top: 10px;
    }
}
.forge-tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 10px;
}
.forge-tile {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 6px;
    row-gap: 4px;
    padding: 10px 10px 8px;
    border-radius: 4px;
    border: 1.5px solid ${u.divider};
    background: rgba(0, 0, 0, 0.18);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.forge-tile-ings {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    grid-column: 1;
    grid-row: 1;
    min-height: 28px;
}
.forge-tile .forge-arrow {
    grid-column: 2;
    grid-row: 1;
    color: ${u.brassLight};
    font-weight: 800;
    font-size: 14px;
}
.forge-tile .forge-spell {
    grid-column: 3;
    grid-row: 1;
    width: 32px;
    height: 32px;
}
.forge-tile-ings .forge-ing {
    width: 26px;
    height: 26px;
    flex: 0 0 auto;
    box-sizing: border-box;
    border-radius: 50%;
}
.forge-tile-ings .forge-ing.owned {
    border: 2.5px solid rgb(0, 220, 90);
    box-shadow: none;
}
.forge-tile-ings .forge-ing.in-forge {
    border: 2.5px solid rgb(255, 168, 40);
    box-shadow: none;
}
.forge-tile-ings .forge-tile-fee {
    /* the fee reads as part of what you hand over: runes + this */
    margin-left: 2px;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
    white-space: nowrap;
}
.forge-tile-name {
    grid-column: 1 / -1;
    grid-row: 2;
    font-size: 12px;
    font-weight: 700;
    color: ${u.text};
    line-height: 1.25;
    min-width: 0;
}
.forge-tile-partial {
    border-color: rgba(255, 208, 64, 0.75);
    box-shadow: 0 0 0 1px rgba(255, 208, 64, 0.25), 0 0 14px rgba(255, 208, 64, 0.28);
    animation: forge-pulse-partial 1.6s ease-in-out infinite;
}
.forge-tile-ready {
    border-color: rgba(0, 255, 102, 0.85);
    box-shadow: 0 0 0 1px rgba(0, 255, 102, 0.35), 0 0 18px rgba(0, 255, 102, 0.4);
    animation: forge-pulse-ready 1.25s ease-in-out infinite;
}
.mechili-cards .c-forge-spells {
    display: flex;
    flex-direction: row;
    gap: 8px;
    justify-content: center;
    margin-top: 8px;
}
.mechili-cards .c-forge-spell-hit {
    display: inline-flex;
    cursor: help;
    border-radius: 50%;
    flex: 0 0 auto;
}
.mechili-cards .c-forge-spell-hit:hover {
    filter: brightness(1.15);
    transform: translateY(-1px);
}
.mechili-cards .c-forge-spells .c-forge-spell-ico {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.35);
}
@keyframes forge-pulse-partial {
    0%, 100% { transform: translateY(0); box-shadow: 0 0 0 1px rgba(255, 208, 64, 0.25), 0 0 10px rgba(255, 208, 64, 0.22); }
    50% { transform: translateY(-1px); box-shadow: 0 0 0 2px rgba(255, 208, 64, 0.45), 0 0 18px rgba(255, 208, 64, 0.4); }
}
@keyframes forge-pulse-ready {
    0%, 100% { transform: translateY(0) scale(1); box-shadow: 0 0 0 1px rgba(0, 255, 102, 0.35), 0 0 12px rgba(0, 255, 102, 0.3); }
    50% { transform: translateY(-2px) scale(1.02); box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.55), 0 0 22px rgba(0, 255, 102, 0.55); }
}
@media (prefers-reduced-motion: reduce) {
    .forge-tile-partial,
    .forge-tile-ready { animation: none; }
}

/* --- in-match chat ------------------------------------------------------ */
.mechili-fightbar .fighter { position: relative; }
.mechili-fightbar .chat-bubble {
    position: absolute;
    top: 100%;
    margin-top: 6px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 18px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.brassDark};
    border-radius: 4px;
    color: ${u.text};
    font-size: 26px;
    white-space: nowrap;
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: chat-pop 0.18s ease-out, chat-fade 0.6s ease-in 3.9s forwards;
    pointer-events: none;
    z-index: 20;
}
.mechili-fightbar .chat-bubble.emote {
    font-size: 56px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    overflow: visible;
}


.mechili-cards {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Do NOT use justify-content: center here. With overflow-y: auto it
     * clips overflowing content equally top+bottom, but only the bottom
     * is scrollable — on a short phone (e.g. 320×480) the first commander
     * cards sit above the scroll range and can never be reached.
     * ::before/::after spacers center when the list fits, and collapse to
     * 0 when it overflows so scroll starts at the real top. */
    gap: clamp(10px, 2vw, 26px);
    background: rgba(12, 20, 8, 0.55);
    user-select: none;
    /* .mechili-topbar sets z-index: 1 to sit above ordinary HUD elements —
     * without an explicit z-index here (auto) a card-style overlay (round
     * cards, specialist reveal, unlock dialog, and now the settings panel)
     * still lost that stacking fight and rendered BEHIND the topbar's own
     * stacking context, regardless of DOM order. Comfortably above the
     * topbar, below .mechili-pause's 55 and .mechili-gameover's 56. */
    z-index: 50;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    /* Top clears the always-visible pick timer (round + seconds in
     * .mechili-topbar). Without this, overflowing lists pin the title under
     * the topbar on phone/tablet; desktop already looked lower because a
     * single horizontal card row + spacers centered the block. */
    padding:
        max(52px, calc(48px + env(safe-area-inset-top)))
        10px
        max(10px, env(safe-area-inset-bottom));
    box-sizing: border-box;
}
/* overflow-safe vertical centering — see .mechili-cards comment above */
.mechili-cards::before,
.mechili-cards::after {
    content: '';
    flex: 1 0 0;
}
.mechili-cards .cards-title {
    font-size: clamp(17px, 2.4vw, 26px);
    font-weight: 900;
    letter-spacing: clamp(2px, 0.35vw, 4px);
    color: ${u.text};
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
}
.mechili-cards .cards-note {
    font-size: 13.5px;
    color: ${u.phase};
    max-width: 480px;
    text-align: center;
    margin-top: -8px;
}
.mechili-cards .cards-row {
    /* 4 → 2 → 1 only — flex-wrap allowed a awkward 3-across band between
     * "fits three min cards" and "fits four". Default max 2; four-card
     * offers go 4-across on wide screens; very narrow phones stack.
     * Columns are fluid (1fr) so leftover horizontal space goes into the
     * cards instead of empty margins; width caps keep them from ballooning. */
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: center;
    justify-items: stretch;
    width: min(100%, 640px);
    max-width: 100%;
    gap: clamp(10px, 1.4vw, 18px);
    padding: 4px 10px 12px;
    box-sizing: border-box;
}
/* lone card on the last row of a 2-col grid (e.g. 3-card offer) — center it */
.mechili-cards .cards-row > .card:last-child:nth-child(odd) {
    grid-column: 1 / -1;
    width: min(100%, calc((100% - clamp(10px, 1.4vw, 18px)) / 2));
    justify-self: center;
}
@media (min-width: 720px) {
    .mechili-cards .cards-row:has(> .card:nth-child(4)) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        width: min(100%, 920px);
    }
    .mechili-cards .cards-row:has(> .card:nth-child(4)) > .card:last-child:nth-child(odd) {
        grid-column: auto;
        width: auto;
        justify-self: stretch;
    }
    /* Full-roster test offers (5+) — keep a tidy 4-across wrap, no lonely full-row card. */
    .mechili-cards .cards-row:has(> .card:nth-child(5)) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        width: min(100%, 960px);
    }
    .mechili-cards .cards-row:has(> .card:nth-child(5)) > .card:last-child:nth-child(odd) {
        grid-column: auto;
        width: auto;
        justify-self: stretch;
    }
}
@media (max-width: 359px) {
    .mechili-cards .cards-row {
        grid-template-columns: minmax(0, 1fr);
        width: min(100%, 340px);
    }
    .mechili-cards .cards-row > .card:last-child:nth-child(odd) {
        grid-column: auto;
        width: auto;
        justify-self: stretch;
    }
}
.mechili-cards.unlock-dialog .unlock-picker {
    display: flex;
    flex-direction: column;
    gap: 16px;
    /* Match shop grid content width (274px panel − horizontal padding) */
    width: min(92vw, 248px);
}
/* Tablet+ — cost bands sit side by side so the modal uses the middle of
   the screen instead of a phone-narrow vertical stack. Phone keeps the
   column above (same 599px break as the compact HUD). */
@media (min-width: 600px) {
    .mechili-cards.unlock-dialog .unlock-picker {
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        align-items: flex-start;
        gap: 20px 28px;
        width: min(92vw, 720px);
    }
    .mechili-cards.unlock-dialog .unlock-tier {
        flex: 0 0 auto;
        align-items: flex-start;
    }
    /* Shop grid is width:100% for the docked panel; size to tiles here. */
    .mechili-cards.unlock-dialog .unlock-picker .shop-grid {
        width: auto;
    }
}
.mechili-cards .unlock-tier {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
}
.mechili-cards .unlock-tier-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 16px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    text-align: left;
    color: ${u.brassLight};
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.mechili-cards .card {
    --card-pad-x: clamp(10px, 1.1vw, 14px);
    --card-pad-y: clamp(12px, 1.4vw, 18px);
    position: relative;
    width: 100%;
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
    min-height: 0;
    padding: var(--card-pad-y) var(--card-pad-x);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(8px, 1vw, 12px);
    overflow: hidden;
    background:
        /* worn corners */
        radial-gradient(ellipse at 0% 0%, rgba(55, 35, 15, 0.34), transparent 46%),
        radial-gradient(ellipse at 100% 0%, rgba(55, 35, 15, 0.34), transparent 46%),
        radial-gradient(ellipse at 0% 100%, rgba(50, 32, 12, 0.38), transparent 48%),
        radial-gradient(ellipse at 100% 100%, rgba(50, 32, 12, 0.38), transparent 48%),
        radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(70, 45, 20, 0.12) 100%),
        radial-gradient(ellipse at 22% 12%, rgba(255, 245, 220, 0.28), transparent 48%),
        radial-gradient(ellipse at 78% 88%, rgba(120, 85, 45, 0.2), transparent 52%),
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(90, 65, 35, 0.05) 3px,
            rgba(90, 65, 35, 0.05) 4px
        ),
        linear-gradient(165deg, ${u.parchmentHi} 0%, ${u.parchment} 45%, ${u.parchmentLo} 100%);
    border: 1px solid #4a3420;
    border-radius: 5px;
    color: ${u.parchmentInk};
    cursor: pointer;
    box-shadow:
        0 8px 22px rgba(0, 0, 0, 0.42),
        0 0 0 1px rgba(30, 18, 8, 0.35),
        /* double inset frame: cream rule + dark inner */
        inset 0 0 0 1px rgba(232, 210, 160, 0.55),
        inset 0 0 0 3px rgba(90, 60, 30, 0.4),
        inset 0 0 40px rgba(80, 50, 20, 0.14);
    transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s;
}
.mechili-cards .card:hover {
    border-color: ${u.bronzeDark};
    transform: translateY(-5px);
    box-shadow:
        0 12px 28px rgba(0, 0, 0, 0.48),
        0 0 0 1px rgba(30, 18, 8, 0.4),
        inset 0 0 0 1px rgba(232, 210, 160, 0.6),
        inset 0 0 0 3px rgba(90, 60, 30, 0.45),
        inset 0 0 40px rgba(80, 50, 20, 0.14);
}
.mechili-cards .card:focus-visible {
    outline: none;
    border-color: ${u.bronze};
    transform: translateY(-5px);
    box-shadow:
        0 0 0 3px rgba(184, 146, 74, 0.4),
        0 8px 22px rgba(0, 0, 0, 0.42),
        inset 0 0 0 1px rgba(232, 210, 160, 0.55),
        inset 0 0 0 3px rgba(90, 60, 30, 0.4);
}
.mechili-cards .card:disabled { opacity: 0.4; pointer-events: none; }
.mechili-cards .card.locked-card:disabled { opacity: 1; }
/* a card shown for information only (waiting / reveal) — no hover, no lift */
.mechili-cards .card.static { cursor: default; }
.mechili-cards .card.static:hover {
    border-color: #4a3420;
    transform: none;
    box-shadow:
        0 8px 22px rgba(0, 0, 0, 0.42),
        0 0 0 1px rgba(30, 18, 8, 0.35),
        inset 0 0 0 1px rgba(232, 210, 160, 0.55),
        inset 0 0 0 3px rgba(90, 60, 30, 0.4),
        inset 0 0 40px rgba(80, 50, 20, 0.14);
}
.mechili-cards .card-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }

/* specialist pick: wobble in place, then fly to commander frame */
.mechili-cards.locked .card.faded {
    visibility: hidden;
    pointer-events: none;
}
.mechili-cards.locked .card.locked-card {
    opacity: 1;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}
.mechili-cards .card.wobble {
    animation: mechili-card-wobble 0.24s ease-in-out 2;
}
@keyframes mechili-card-wobble {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-2.5deg); }
    75% { transform: rotate(2.5deg); }
}
.mechili-cards.flying {
    background: transparent !important;
    transition: background 0.35s ease-out;
}
@keyframes mechili-card-reveal-in {
    from { opacity: 0; transform: translateY(14px) scale(0.94); }
    to { opacity: 1; transform: none; }
}
/* pick confirmed: other cards/title fade, chosen card lifts in place */
.mechili-cards.picking .cards-title,
.mechili-cards.picking .cards-note,
.mechili-cards.picking .cards-skip,
.mechili-cards.picking .card:not(.chosen) {
    opacity: 0 !important;
    transition: opacity 0.2s ease-out;
    pointer-events: none;
}
.mechili-cards.picking .card.chosen {
    position: relative;
    z-index: 2;
    pointer-events: none;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    transition: box-shadow 0.25s ease-out;
}
.mechili-cards.picking.dismissing,
.mechili-cards.dismissing {
    background: transparent !important;
    transition: background 0.28s ease-out, opacity 0.28s ease-out;
}
.mechili-cards.dismissing {
    opacity: 0;
    pointer-events: none;
}
.mechili-fightbar .fighter.landed-pulse .portrait {
    animation: mechili-commander-land 0.5s ease-out;
}
@keyframes mechili-commander-land {
    0% {
        box-shadow:
            0 0 0 1px ${u.frameLo},
            0 0 0 2px ${u.frameHi},
            inset 0 1px 2px rgba(255, 230, 180, 0.2),
            0 2px 6px rgba(0, 0, 0, 0.35),
            0 0 0 0 rgba(255, 220, 120, 0);
    }
    35% {
        box-shadow:
            0 0 0 1px ${u.frameLo},
            0 0 0 2px ${u.frameHi},
            inset 0 1px 2px rgba(255, 230, 180, 0.2),
            0 2px 6px rgba(0, 0, 0, 0.35),
            0 0 0 3px rgba(255, 220, 120, 0.45);
    }
    100% {
        box-shadow:
            0 0 0 1px ${u.frameLo},
            0 0 0 2px ${u.frameHi},
            inset 0 1px 2px rgba(255, 230, 180, 0.2),
            0 2px 6px rgba(0, 0, 0, 0.35),
            0 0 0 0 rgba(255, 220, 120, 0);
    }
}

/* Round-win commander portrait: fly from fight bar → center, speak-shake, hard end */
.mechili-victor-celebrate {
    position: fixed;
    z-index: 12000;
    pointer-events: none;
    margin: 0;
    padding: 0;
    transform-origin: center center;
    transition:
        transform 0.32s cubic-bezier(0.22, 1.15, 0.36, 1),
        opacity 0.38s ease-in;
    will-change: transform, opacity;
}
.mechili-victor-celebrate.leaving {
    opacity: 0;
}
.mechili-victor-face {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
        radial-gradient(circle at 35% 28%, rgba(255, 230, 180, 0.22), transparent 55%),
        linear-gradient(165deg, ${u.leatherHi}, ${u.leather});
    border: 1.5px solid ${u.frameMid};
    box-shadow:
        0 0 0 1px ${u.frameLo},
        0 0 0 3px ${u.frameHi},
        inset 0 1px 2px rgba(255, 230, 180, 0.22),
        0 10px 28px rgba(0, 0, 0, 0.45);
}
.mechili-victor-celebrate.player .mechili-victor-face {
    box-shadow:
        0 0 0 1px ${u.frameLo},
        0 0 0 3px ${pc},
        inset 0 1px 2px rgba(255, 230, 180, 0.22),
        0 10px 28px rgba(0, 0, 0, 0.45),
        0 0 36px color-mix(in srgb, ${pc} 45%, transparent);
}
.mechili-victor-celebrate.enemy .mechili-victor-face {
    box-shadow:
        0 0 0 1px ${u.frameLo},
        0 0 0 3px ${ec},
        inset 0 1px 2px rgba(255, 230, 180, 0.22),
        0 10px 28px rgba(0, 0, 0, 0.45),
        0 0 36px color-mix(in srgb, ${ec} 45%, transparent);
}
.mechili-victor-face .fighter-portrait-img,
.mechili-victor-face .m-icon,
.mechili-victor-face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.mechili-victor-face .portrait-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    font-size: 18px;
    font-weight: 700;
    line-height: 0;
}
.mechili-victor-celebrate.speaking .mechili-victor-face {
    animation: mechili-victor-speak 0.28s ease-in-out infinite;
}
@keyframes mechili-victor-speak {
    0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
    20% { transform: translate(-1.5%, 1.2%) rotate(-2.2deg) scale(1.03); }
    45% { transform: translate(1.8%, -1%) rotate(2deg) scale(1.015); }
    70% { transform: translate(-1%, -1.4%) rotate(-1.4deg) scale(1.04); }
}
.mechili-cards .c-owner {
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    max-width: 215px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-cards .c-owner.player { color: ${pc}; }
.mechili-cards .c-owner.enemy { color: ${ec}; }
.mechili-cards .c-title {
    align-self: stretch;
    width: calc(100% + 2 * var(--card-pad-x));
    margin: 2px calc(-1 * var(--card-pad-x)) 0;
    padding: 7px var(--card-pad-x) 8px;
    box-sizing: border-box;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
    color: ${u.parchmentInk};
    background:
        linear-gradient(180deg, rgba(90, 60, 30, 0.12), transparent 40%),
        linear-gradient(180deg, ${u.parchmentLo} 0%, #c2a070 100%);
    border-top: 1px solid rgba(70, 45, 20, 0.35);
    border-bottom: 1px solid rgba(70, 45, 20, 0.4);
    box-shadow:
        inset 0 1px 0 rgba(255, 240, 210, 0.28),
        0 1px 0 rgba(255, 240, 210, 0.12);
}
.mechili-cards .c-portrait {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 78px;
    height: 78px;
    flex-shrink: 0;
    border-radius: 50%;
    overflow: hidden;
    background:
        radial-gradient(circle at 35% 30%, rgba(255, 245, 220, 0.45), transparent 55%),
        linear-gradient(165deg, ${u.parchmentHi}, ${u.parchmentLo});
    border: 2px solid ${u.frameMid};
    box-shadow:
        0 0 0 2px ${u.frameLo},
        0 0 0 4px ${u.frameHi},
        0 0 0 5px ${u.frameEdge},
        inset 0 1px 2px rgba(255, 245, 220, 0.35),
        inset 0 -2px 6px rgba(0, 0, 0, 0.25),
        0 4px 10px rgba(0, 0, 0, 0.3);
}
.mechili-cards .c-portrait .m-icon { width: 100%; height: 100%; }
.mechili-cards .c-units { font-size: 12.5px; color: ${u.parchmentInk}; }
.mechili-cards .c-hp { font-size: 14px; font-weight: bold; color: ${u.parchmentInk}; }
.mechili-cards .c-desc { font-size: 12.5px; color: ${u.parchmentInkMuted}; line-height: 1.55; }
.mechili-cards .c-forge {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: 6px;
    width: 100%;
    margin-top: 2px;
}
.mechili-cards .c-forge-spell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
}
.mechili-cards .c-forge-spell-ico {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    overflow: hidden;
    background: ${u.panelBg};
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.mechili-cards .c-forge-spell.bake .c-forge-spell-ico {
    width: 28px;
    height: 28px;
    box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.85), 0 0 8px rgba(0, 255, 102, 0.4);
}
.mechili-cards .c-forge-spell.path .c-forge-spell-ico {
    opacity: 0.9;
    filter: saturate(0.9);
}
.mechili-cards .c-forge-missing {
    display: grid;
    grid-template-columns: repeat(3, 12px);
    gap: 1px;
    justify-content: center;
    min-height: 12px;
}
.mechili-cards .c-forge-miss {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    overflow: hidden;
}
.mechili-cards .c-forge-miss.ghost {
    visibility: hidden;
    pointer-events: none;
}
.mechili-cards .c-forge-miss.owned {
    box-shadow: 0 0 0 1px rgba(0, 255, 102, 0.9);
}
/* trio arc: left + right up, center a bit down (left slot is usually ghost) */
.mechili-cards .c-forge-missing.trio .c-forge-miss:first-child,
.mechili-cards .c-forge-missing.trio .c-forge-miss:last-child {
    transform: translateY(-3px);
}
.mechili-cards .c-cost {
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 3px;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    color: ${u.parchmentInk};
    background: rgba(90, 60, 30, 0.14);
    border: 1px solid rgba(70, 45, 20, 0.38);
    box-shadow: inset 0 1px 0 rgba(255, 240, 210, 0.35);
    text-shadow: none;
}
.mechili-cards .c-cost .money-ico.m-icon {
    width: 16px;
    height: 16px;
    margin: 0;
}
.mechili-cards .unlock-tier-head .money-ico.m-icon {
    width: 18px;
    height: 18px;
    margin: 0;
}
.mechili-panel .action-info .ai-cost .money-ico.m-icon,
.mechili-panel .action-info .ai-buy .money-ico.m-icon {
    width: 14px;
    height: 14px;
    margin-right: 0.2em;
}
.mechili-cards .cards-skip .money-ico.m-icon {
    width: 14px;
    height: 14px;
    margin: 0 0.15em;
    vertical-align: -0.15em;
}
.mechili-phonebar .pb-label .money-ico.m-icon {
    width: 14px;
    height: 14px;
    margin: 0 0.12em;
    vertical-align: -0.15em;
}
.mechili-cards .cards-skip {
    padding: 9px 24px;
    background: ${u.undoBg};
    border: 1.5px solid ${u.undoBorder};
    border-radius: 4px;
    color: ${u.undoText};
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
}
.mechili-cards .cards-skip { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-cards .cards-skip:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.mechili-cards .cards-skip:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

.settings-panel {
    position: relative;
    width: min(96vw, 1100px);
    max-height: min(82vh, 720px);
    overflow-y: auto;
    padding: 10px 12px 12px;
    border-radius: 4px;
    border: 2px solid ${u.border};
    background: ${u.panelBgDark};
    user-select: text;
    box-sizing: border-box;
}
.settings-panel-title {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 1.5px;
    color: ${u.brassLight};
    text-align: center;
}
.settings-close {
    position: absolute;
    top: 6px;
    inset-inline-end: 8px;
    background: none;
    border: none;
    color: ${u.textMuted};
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
}
.settings-close:hover { color: ${u.text}; }
.settings-grid {
    display: grid;
    /* more columns → less vertical scroll for the same content */
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
}
.settings-card {
    padding: 6px 8px 7px;
    border-radius: 3px;
    border: 1px solid ${u.divider};
    background: rgba(0, 0, 0, 0.15);
}
.settings-card h3 {
    margin: 0 0 4px;
    color: ${u.brassLight};
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.settings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    line-height: 1.25;
}
.settings-table th,
.settings-table td {
    text-align: start;
    padding: 2px 0;
    vertical-align: top;
}
.settings-table tr:not(:last-child) th,
.settings-table tr:not(:last-child) td {
    border-bottom: 1px solid ${u.divider};
}
.settings-table th {
    color: ${u.textMuted};
    font-weight: 600;
    padding-inline-end: 8px;
    white-space: nowrap;
    width: 38%;
}
.settings-table td {
    color: ${u.text};
    font-variant-numeric: tabular-nums;
}
.settings-desc {
    display: block;
    color: ${u.textMuted};
    font-size: 10px;
    font-weight: 400;
    font-variant-numeric: normal;
    margin-top: 1px;
    line-height: 1.25;
    white-space: normal;
}
.mechili-cards.settings-detail {
    /* fightbar is 51 — settings must cover commander HP, not sit under it */
    z-index: 54;
    justify-content: stretch;
    align-items: stretch;
    padding: 0;
    gap: 0;
}
.mechili-cards.settings-detail .settings-panel {
    width: 100%;
    max-width: none;
    max-height: none;
    height: 100%;
    border-radius: 0;
    border-width: 0;
    padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
        max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
}

.mechili-pause {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(12, 20, 8, 0.5);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 55;
    user-select: none;
}
.mechili-pause .pause-box {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    min-width: 260px;
    padding: 22px 24px;
    background: ${u.panelBg};
    border: 2px solid ${u.border};
    border-radius: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}
.mechili-pause .pause-title {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 3px;
    text-align: center;
    color: ${u.brassLight};
    margin-bottom: 4px;
}
.mechili-pause .pause-subtitle {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: ${u.textMuted};
    text-align: center;
}
.mechili-pause button {
    padding: 11px 16px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-pause button { transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease; }
.mechili-pause button:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-pause button:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35); }
.mechili-pause .pause-quit {
    border-color: ${u.undoBorder};
    color: ${u.undoText};
}
.mechili-pause .pause-quit:hover { background: ${u.undoHover}; }

/* One panel for victory / defeat / draw / disconnect — fullscreen soft
 * clash plaque matching the pre-match intro roster. */
.mechili-gameover {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    box-sizing: border-box;
    padding: clamp(24px, 6vh, 64px) 16px;
    overflow: hidden;
    z-index: 56;
    background: transparent;
    border: none;
    box-shadow: none;
    user-select: none;
}
.mechili-climb-splash {
    position: absolute;
    inset: 0;
    z-index: 55;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    background: radial-gradient(ellipse 70% 55% at 50% 48%, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.45) 55%, rgba(0, 0, 0, 0.65) 100%);
}
.mechili-climb-splash .cs-title {
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.cream};
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85), 0 0 40px rgba(184, 146, 74, 0.25);
}
.mechili-gameover::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    background:
        radial-gradient(ellipse 70% 55% at 50% 48%, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.38) 48%, rgba(0, 0, 0, 0.55) 100%);
    pointer-events: none;
}
.mechili-gameover .go-bg {
    position: absolute;
    left: 50%;
    top: 50%;
    width: min(110vw, 920px);
    height: min(70vh, 520px);
    transform: translate(-50%, -50%);
    z-index: 0;
    pointer-events: none;
    -webkit-mask-image: radial-gradient(ellipse 68% 54% at 50% 50%, #000 12%, rgba(0, 0, 0, 0.85) 42%, transparent 72%);
    mask-image: radial-gradient(ellipse 68% 54% at 50% 50%, #000 12%, rgba(0, 0, 0, 0.85) 42%, transparent 72%);
}
.mechili-gameover .go-bg-core,
.mechili-gameover .go-bg-glow {
    position: absolute;
    inset: 0;
    display: block;
}
.mechili-gameover .go-bg-core {
    background:
        radial-gradient(ellipse 48% 42% at 50% 48%, rgba(62, 44, 28, 0.88) 0%, transparent 68%),
        radial-gradient(ellipse 72% 58% at 50% 50%, rgba(18, 12, 8, 0.82) 0%, transparent 74%),
        radial-gradient(ellipse 90% 70% at 50% 52%, rgba(6, 4, 3, 0.55) 0%, transparent 78%);
    filter: blur(0.5px);
}
.mechili-gameover .go-bg-glow {
    filter: blur(28px);
    opacity: 0.72;
    animation: mechili-go-aura 4.8s ease-in-out infinite;
}
.mechili-gameover .go-bg-glow-player {
    background:
        radial-gradient(ellipse 42% 55% at 22% 48%,
            color-mix(in srgb, ${pc} 55%, transparent) 0%,
            transparent 70%);
}
.mechili-gameover .go-bg-glow-enemy {
    background:
        radial-gradient(ellipse 42% 55% at 78% 52%,
            color-mix(in srgb, ${ec} 55%, transparent) 0%,
            transparent 70%);
    animation-delay: -2.4s;
}
@keyframes mechili-go-aura {
    0%, 100% { opacity: 0.58; transform: scale(1); }
    50% { opacity: 0.86; transform: scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-gameover .go-bg-glow { animation: none; }
}
.mechili-gameover .go-title,
.mechili-gameover .go-teams,
.mechili-gameover .go-note,
.mechili-gameover .go-rated-note,
.mechili-gameover .go-sub,
.mechili-gameover .go-stats,
.mechili-gameover .go-actions,
.mechili-gameover .go-restart,
.mechili-gameover .go-retry,
.mechili-gameover .go-rematch,
.mechili-gameover .go-next {
    position: relative;
    z-index: 1;
}
.mechili-gameover .go-title {
    font-size: clamp(28px, 5vw, 44px);
    font-weight: 900;
    letter-spacing: clamp(4px, 0.8vw, 10px);
    text-align: center;
    line-height: 1.15;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
}
.mechili-gameover.victory .go-title { color: ${pc}; }
.mechili-gameover.defeat .go-title { color: ${ec}; }
.mechili-gameover.draw .go-title { color: ${u.brassLight}; }
/* The Year's result: who took it, the score, every round */
.mechili-gameover .go-year {
    --year-attacker: #d8643f;
    --year-defender: #5d97c9;
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: -6px;
    text-align: center;
}
.mechili-gameover .go-year-winner {
    font-size: clamp(20px, 3.4vw, 32px);
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
    animation: year-mark-pop 0.8s cubic-bezier(0.2, 1.6, 0.4, 1) 0.2s both;
}
.mechili-gameover .go-year-winner.is-attacker { color: var(--year-attacker); }
.mechili-gameover .go-year-winner.is-defender { color: var(--year-defender); }
.mechili-gameover .go-year-score {
    display: flex;
    gap: 12px;
    font-size: clamp(15px, 2vw, 19px);
    font-weight: 700;
    letter-spacing: 0.06em;
    color: ${u.cream};
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
}
.mechili-gameover .go-year-score .is-attacker { color: var(--year-attacker); }
.mechili-gameover .go-year-score .is-defender { color: var(--year-defender); }
.mechili-gameover .go-sub { font-size: 14px; letter-spacing: 0.5px; color: ${u.text}; opacity: 0.85; margin-top: -10px; text-align: center; max-width: 28em; line-height: 1.45; }
.mechili-gameover .go-stats { font-size: 13px; color: ${u.textMuted}; letter-spacing: 0.5px; margin-top: -6px; }
.mechili-gameover .go-teams {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(18px, 4.5vw, 40px);
    width: min(94vw, 760px);
    margin-top: 4px;
}
.mechili-gameover .go-vs {
    align-self: center;
    font-size: clamp(22px, 3.2vw, 32px);
    font-weight: 900;
    letter-spacing: 5px;
    color: ${u.brassLight};
    text-shadow:
        0 0 18px color-mix(in srgb, ${u.brassLight} 35%, transparent),
        0 1px 3px rgba(0, 0, 0, 0.85);
    flex-shrink: 0;
    padding-top: 0;
    opacity: 1;
}
.mechili-gameover .go-team {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.mechili-gameover .go-team-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    opacity: 0.65;
    text-align: center;
}
.mechili-gameover .go-team-player .go-team-label { color: ${pc}; }
.mechili-gameover .go-team-enemy .go-team-label { color: ${ec}; }
.mechili-gameover .go-player {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 4px;
    border: none;
    border-radius: 0;
    background: transparent;
    min-width: 0;
}
/* Portrait on the outer edge; name/mmr flush against it toward VS. */
.mechili-gameover .go-team-player .go-player { justify-content: flex-start; }
.mechili-gameover .go-team-enemy .go-player {
    flex-direction: row-reverse;
    justify-content: flex-start;
}
.mechili-gameover .go-team-player .go-player-info { text-align: left; }
.mechili-gameover .go-team-enemy .go-player-info { text-align: right; }
.mechili-gameover .go-portrait {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    border: 2px solid ${u.frameMid};
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.mechili-gameover .go-portrait.player { border-color: ${pc}; }
.mechili-gameover .go-portrait.enemy { border-color: ${ec}; }
.mechili-gameover .go-portrait-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mechili-gameover .go-portrait-ph {
    width: 58%;
    height: 58%;
    border-radius: 50%;
    background: ${u.textMuted};
    opacity: 0.35;
}
.mechili-gameover .go-player-info { min-width: 0; flex: 0 1 auto; }
.mechili-gameover .go-player-name {
    font-size: 16px;
    font-weight: 700;
    color: ${u.cream};
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.25;
}
.mechili-gameover .go-ai, .mechili-gameover .go-unrated {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-left: 6px;
    opacity: 0.65;
    text-transform: uppercase;
    white-space: nowrap;
}
.mechili-gameover .go-spec { font-size: 11px; color: ${u.textMuted}; margin-top: 1px; }
.mechili-gameover .go-mmr {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin-top: 3px;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
    opacity: 1;
}
.mechili-gameover .go-mmr.up { color: #7fd88a; }
.mechili-gameover .go-mmr.down { color: #ff8a7a; }
.mechili-gameover .go-mmr.flat { color: ${u.brassLight}; }

.mechili-gameover .go-mmr-delta {
    display: block;
    margin-top: 1px;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.95;
}

@media (max-width: 599px), (max-height: 540px) {
    .mechili-gameover {
        padding: 16px 12px;
        gap: 12px;
    }
    .mechili-gameover .go-bg {
        width: min(120vw, 640px);
        height: min(62vh, 420px);
    }
    .mechili-gameover .go-teams {
        gap: 12px;
        width: min(96vw, 560px);
    }
    .mechili-gameover .go-vs {
        font-size: 18px;
        letter-spacing: 3px;
    }
    .mechili-gameover .go-player {
        gap: 8px;
        padding: 6px 2px;
    }
    .mechili-gameover .go-portrait {
        width: 40px;
        height: 40px;
        display: flex;
    }
    .mechili-gameover .go-player-name {
        font-size: 13px;
    }
    .mechili-gameover .go-mmr {
        font-size: 14px;
        margin-top: 1px;
        letter-spacing: 0.35px;
    }
}
.mechili-gameover .go-rated-note {
    font-size: 11px;
    color: ${u.textMuted};
    text-align: center;
    max-width: 26em;
    line-height: 1.4;
}
.mechili-gameover .go-note { font-size: 13px; color: ${u.text}; opacity: 0.85; max-width: 32em; text-align: center; }
.mechili-cards .reconnect-timer { font-size: 32px; font-variant-numeric: tabular-nums; }
.mechili-cards .reconnect-timer.urgent { animation: mechili-timer-pulse 0.7s ease-in-out infinite; }
@keyframes mechili-timer-pulse {
    0%, 100% { opacity: 1; transform: scale(1); text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8), 0 0 10px rgba(255, 200, 60, 0.35); }
    50% { opacity: 0.55; transform: scale(1.12); text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8), 0 0 18px rgba(255, 216, 64, 0.85); }
}
.mechili-gameover .go-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 1;
}
.mechili-gameover .go-restart,
.mechili-gameover .go-view,
.mechili-gameover .go-retry,
.mechili-gameover .go-rematch,
.mechili-gameover .go-next {
    align-self: center;
    padding: 10px 26px;
    /* wood with an iron edge, like every other button; the main action in brass */
    ${WOOD_BUTTON}
    border-radius: 3px;
    color: ${u.brassLight};
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    transition: transform 0.14s ease, background 0.14s ease;
}
.mechili-gameover .go-restart:hover,
.mechili-gameover .go-view:hover,
.mechili-gameover .go-retry:hover,
.mechili-gameover .go-rematch:hover:not(:disabled),
.mechili-gameover .go-next:hover { border-color: #6a6058; filter: brightness(1.12); transform: translateY(-2px); }
.mechili-gameover .go-restart:focus-visible,
.mechili-gameover .go-view:focus-visible,
.mechili-gameover .go-retry:focus-visible,
.mechili-gameover .go-rematch:focus-visible,
.mechili-gameover .go-next:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
.mechili-gameover .go-rematch:disabled { opacity: 0.6; cursor: default; }
/* a quieter secondary action: look over the battlefield */
.mechili-gameover .go-view {
    color: ${u.creamMuted};
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.6px;
    padding: 8px 18px;
}
/* while viewing the battlefield: the way back to the results, or out — top centre,
   above every match layer, so it can't end up behind anything */
.mechili-battlefield-bar {
    position: absolute;
    left: 50%;
    top: 14px;
    transform: translateX(-50%);
    display: flex;
    gap: 10px;
    padding: 8px 10px;
    /* a parchment strip */
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    z-index: 60;
}
.mechili-battlefield-bar button {
    padding: 8px 18px;
    ${WOOD_BUTTON}
    border-radius: 3px;
    color: ${u.brassLight};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 0.6px;
    cursor: pointer;
}
.mechili-battlefield-bar button:hover { border-color: #6a6058; filter: brightness(1.12); }
.mechili-battlefield-bar .bf-leave { color: ${u.creamMuted}; }
.mechili-gameover .go-rematch.is-asked { border-color: ${u.brassLight}; color: ${u.brassLight}; box-shadow: 0 0 16px rgba(212, 184, 120, 0.45); animation: year-mark-pulse 1.6s ease-in-out infinite; }
.mechili-gameover .go-actions:has(.go-rematch) .go-restart,
.mechili-gameover .go-actions:has(.go-retry) .go-restart,
.mechili-gameover .go-actions:has(.go-next) .go-restart {
    color: ${u.creamMuted};
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.6px;
    padding: 8px 18px;
}
.mechili-gameover .go-actions:has(.go-retry) .go-restart:hover,
.mechili-gameover .go-actions:has(.go-next) .go-restart:hover {
    color: ${u.cream};
}

.mechili-report {
    position: absolute;
    right: 0;
    top: 56px;
    min-width: 200px;
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(44, 36, 28, 0.94), rgba(22, 18, 14, 0.96));
    border: 1.5px solid ${u.border};
    border-radius: 10px 0 0 10px;
    border-right: none;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: ${u.text};
    user-select: none;
}
.mechili-report .r-title { font-size: 13px; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 16px; }
.mechili-report .r-close { background: none; border: none; color: ${u.textMuted}; cursor: pointer; font-size: 14px; padding: 0; transition: color 0.12s ease; }
.mechili-report .r-close:hover { color: ${u.brassLight}; }
.mechili-report .r-close:focus-visible { outline: none; color: ${u.brassLight}; }
.mechili-report .r-row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-report .r-row .n.player { color: ${pc}; }
.mechili-report .r-row .n.enemy { color: ${ec}; }
.mechili-report .r-row .d { color: ${u.brass}; font-variant-numeric: tabular-nums; }

.mechili-topbar {
    position: absolute;
    left: 50%;
    top: calc(6px + env(safe-area-inset-top));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0;
    background: none;
    border: none;
    color: ${u.text};
    user-select: none;
    pointer-events: auto;
    z-index: 1;
}
.mechili-topbar .top-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.75);
}
.mechili-topbar .top-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
}
.mechili-topbar .timer {
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8);
}
.mechili-topbar .spectator-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    ${WOOD_BUTTON}
    border-width: 1px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    pointer-events: auto;
}
.mechili-topbar .spectator-badge:hover {
    border-color: ${u.hover};
}
.mechili-topbar .spectator-list {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 6px;
    min-width: 160px;
    max-height: 220px;
    overflow-y: auto;
    /* a parchment note, in ink */
    background: ${PARCHMENT_FILL};
    color: ${INK};
    text-shadow: none;
    border: none;
    border-radius: 0;
    padding: 6px;
    box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(70, 40, 15, 0.55),
        inset 0 0 14px rgba(105, 56, 18, 0.5);
    pointer-events: auto;
}
.mechili-topbar .spectator-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    font-size: 13px;
    white-space: nowrap;
}
.mechili-topbar label.spectator-row {
    cursor: pointer;
}
.mechili-topbar .spectator-row:hover {
    background: rgba(90, 55, 20, 0.12);
    border-radius: 4px;
}
.mechili-fightbar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    overflow: visible;
    user-select: none;
    pointer-events: none;
    /* above .mechili-cards (50) so commander HP strips stay under the cursor
       during specialist peek — otherwise the full-screen dim steals hover and
       the bars flicker. Pick overlays set .overlay-open to hide the strips
       (timer topbar stays); peek does not, so this stacking still matters. */
    z-index: 51;
}
/* card pick / pause / settings — hide HP strips only (topbar lives in here) */
.mechili-fightbar.overlay-open .fighter-stack {
    display: none !important;
}
.mechili-fightbar .fighter-stack {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: min(42vw, 460px);
    min-width: 220px;
    pointer-events: none;
}
.mechili-fightbar .fighter-stack.player { left: 0; align-items: stretch; }
.mechili-fightbar .fighter-stack.enemy { right: 0; align-items: stretch; }
.mechili-fightbar .fighter-stack.multi .fighter {
    min-width: 0;
    gap: 0;
}
.mechili-fightbar .fighter-stack.multi .fname {
    font-size: 13px;
}
.mechili-fightbar .fighter-stack.multi .hp-val {
    font-size: 13px;
}
.mechili-fightbar .fighter {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    display: flex;
    align-items: center;
    gap: 0;
    width: 100%;
    box-sizing: border-box;
    min-width: 220px;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    pointer-events: auto;
    cursor: pointer;
}
.mechili-fightbar .fighter.player {
    border-radius: 0;
}
.mechili-fightbar .fighter.enemy {
    flex-direction: row-reverse;
    border-radius: 0;
}
.mechili-fightbar .portrait-group {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    flex-shrink: 0;
}
.mechili-fightbar .fighter.enemy .portrait-group {
    flex-direction: row-reverse;
}
.mechili-fightbar .portrait {
    position: relative;
    z-index: 2;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    overflow: hidden;
    background:
        radial-gradient(circle at 35% 28%, rgba(255, 230, 180, 0.2), transparent 55%),
        linear-gradient(165deg, ${u.leatherHi}, ${u.leather});
    border: 1.5px solid ${u.frameMid};
    box-shadow:
        0 0 0 1px ${u.frameLo},
        0 0 0 2px ${u.frameHi},
        inset 0 1px 2px rgba(255, 230, 180, 0.2),
        0 2px 6px rgba(0, 0, 0, 0.35);
    font-size: 22px;
    font-weight: bold;
    line-height: 1;
}
.mechili-fightbar .portrait .portrait-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    line-height: 0;
    font-size: 18px;
    font-weight: 700;
}
.mechili-fightbar .portrait .portrait-placeholder::before {
    content: '◆';
    /* diamond glyph sits low in many fonts — pull up to circle center */
    display: block;
    line-height: 1;
    transform: translateY(-0.12em);
}
.mechili-fightbar .portrait-sub-stack {
    position: relative;
    z-index: 1;
    display: flex;
    /* top-aligned with the main frame, flush beside it (each in its own wooden frame) */
    align-items: flex-start;
    align-self: flex-start;
}
.mechili-fightbar .fighter.enemy .portrait-sub-stack { flex-direction: row-reverse; }
.mechili-fightbar .portrait-group { align-items: flex-start; }
.mechili-fightbar .portrait .m-icon {
    width: 100%;
    height: 100%;
}
.mechili-fightbar .portrait .fighter-portrait-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
}
.mechili-fightbar .fighter.player .portrait { color: ${pc}; }
.mechili-fightbar .fighter.enemy .portrait { color: ${ec}; }
/* The featured portrait in an old frame that suits the weathered flag: darkened oak,
   its edges rubbed lighter, grain and a few scratches, forged iron brackets nailed
   over each corner with spots of rust; the (square) picture sunk into it, bigger than
   the rest. */
.mechili-fightbar .portrait-mount {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
    padding: 3px;
    border-radius: 3px;
    background:
        radial-gradient(circle at 2px 2px, #8a7f74 0 0.5px, #4a423b 0.8px, #15110e 1.2px, transparent 1.4px),
        radial-gradient(circle at calc(100% - 2px) 2px, #8a7f74 0 0.5px, #4a423b 0.8px, #15110e 1.2px, transparent 1.4px),
        radial-gradient(circle at 2px calc(100% - 2px), #8a7f74 0 0.5px, #4a423b 0.8px, #15110e 1.2px, transparent 1.4px),
        radial-gradient(circle at calc(100% - 2px) calc(100% - 2px), #8a7f74 0 0.5px, #4a423b 0.8px, #15110e 1.2px, transparent 1.4px),
        radial-gradient(circle at 6px 1.5px, rgba(150, 72, 24, 0.7) 0 1px, rgba(120, 60, 20, 0.35) 1.8px, transparent 2.5px),
        radial-gradient(circle at calc(100% - 1.5px) 7px, rgba(150, 72, 24, 0.7) 0 1px, rgba(120, 60, 20, 0.35) 1.8px, transparent 2.5px),
        radial-gradient(circle at 1.5px calc(100% - 6px), rgba(150, 72, 24, 0.7) 0 1px, rgba(120, 60, 20, 0.35) 1.8px, transparent 2.5px),
        radial-gradient(circle at calc(100% - 7px) calc(100% - 1.5px), rgba(150, 72, 24, 0.7) 0 1px, rgba(120, 60, 20, 0.35) 1.8px, transparent 2.5px),
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 0 0 / 10px 3px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 0 0 / 3px 10px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 100% 0 / 10px 3px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 100% 0 / 3px 10px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 0 100% / 10px 3px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 0 100% / 3px 10px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 100% 100% / 10px 3px no-repeat,
        linear-gradient(180deg, #4b4540 0%, #2f2a26 55%, #1d1916 100%) 100% 100% / 3px 10px no-repeat,
        linear-gradient(33deg, transparent 46%, rgba(220, 180, 130, 0.18) 47%, transparent 48.5%) 0 0 / 100% 100% no-repeat,
        linear-gradient(-58deg, transparent 70%, rgba(220, 180, 130, 0.14) 71%, transparent 72%) 0 0 / 100% 100% no-repeat,
        repeating-linear-gradient(92deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px, rgba(255, 220, 170, 0.05) 3px 4px, transparent 4px 6px),
        repeating-linear-gradient(2deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 4px),
        linear-gradient(150deg, #4a3422 0%, #33231a 45%, #22170f 100%);
    box-shadow:
        0 0 0 1px #120d09,
        /* edges rubbed lighter, the inner side in shadow */
        inset 1px 1px 0 rgba(214, 170, 120, 0.22),
        inset -1px -1px 0 rgba(0, 0, 0, 0.5),
        0 3px 8px rgba(0, 0, 0, 0.6);
}
/* the bezel sits right in the screen corner: no gap above or beside it, and its
   corner there is square so it reads as anchored to the edge */
.mechili-fightbar .fighter-stack .fighter.player { padding-top: 0; padding-left: 0; }
/* the banner hangs from the very top of the screen, beside the frame, name below it */
.mechili-fightbar .fighter-stack .fighter { align-items: flex-start; }
.mechili-fightbar .fighter-stack .fighter.enemy { padding-top: 0; padding-right: 0; }
.mechili-fightbar .fighter.player .portrait-group > :first-child:is(.portrait-mount),
.mechili-fightbar .fighter.player .portrait-sub-stack > .portrait-mount:first-child { border-top-left-radius: 0; }
.mechili-fightbar .fighter.enemy .portrait-group > :first-child:is(.portrait-mount),
.mechili-fightbar .fighter.enemy .portrait-sub-stack > .portrait-mount:first-child { border-top-right-radius: 0; }
/* the picture itself: bigger (players like seeing their own), sunk into the frame
   (a dark lip, shadow inside), no rings of its own */
.mechili-fightbar .portrait-mount .portrait {
    border: 1px solid ${u.frameEdge};
    box-shadow:
        inset 0 3px 6px rgba(0, 0, 0, 0.7),
        inset 0 0 0 1px rgba(0, 0, 0, 0.35),
        0 0 0 1px rgba(255, 230, 180, 0.12);
    border-radius: 2px;
}
.mechili-fightbar .portrait-mount .portrait.main {
    width: 58px;
    height: 58px;
    border-radius: 2px;
    border: 1px solid ${u.frameEdge};
    box-shadow:
        inset 0 3px 6px rgba(0, 0, 0, 0.7),
        inset 0 0 0 1px rgba(0, 0, 0, 0.35),
        0 0 0 1px rgba(255, 230, 180, 0.12);
}
/* an old painting, like the portraits hanging in a castle: warm aged varnish, the
   colours a little faded, canvas grain, and the edges sunk into shadow */
.mechili-fightbar .portrait-mount .portrait .fighter-portrait-img,
.mechili-fightbar .portrait-mount .portrait .m-icon {
    filter: sepia(0.35) saturate(0.78) contrast(1.08) brightness(0.94);
}
.mechili-fightbar .portrait-mount .portrait::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
        radial-gradient(ellipse 85% 80% at 50% 40%, transparent 48%, rgba(28, 16, 6, 0.6) 100%),
        linear-gradient(160deg, rgba(255, 210, 130, 0.2) 0%, rgba(120, 70, 20, 0.12) 55%, rgba(60, 32, 8, 0.3) 100%),
        url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}");
    mix-blend-mode: multiply;
}
/* a glint of varnish across the top */
.mechili-fightbar .portrait-mount .portrait::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(170deg, rgba(255, 245, 220, 0.16) 0%, transparent 32%);
}
/* Meter column = portrait height: HP tube + name footplate */
.mechili-fightbar .fighter-info {
    flex: 1;
    min-width: 0;
    height: 44px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
    z-index: 1;
}
.mechili-fightbar .fighter.player .fighter-info {
    margin-left: -18px;
}
.mechili-fightbar .fighter.enemy .fighter-info {
    margin-right: -18px;
}
/* Name under the tube — text only */
.mechili-fightbar .fname {
    flex: 0 0 auto;
    align-self: flex-start;
    position: relative;
    z-index: 2;
    margin-top: -2px;
    max-width: 100%;
    width: fit-content;
    padding: 0;
    box-sizing: border-box;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: ${u.cream};
    background: none;
    border: none;
    box-shadow: none;
    text-shadow:
        0 1px 2px rgba(0, 0, 0, 0.95),
        0 0 8px rgba(0, 0, 0, 0.7);
}
.mechili-fightbar .fname.tall {
    margin-top: 2px;
}
.mechili-fightbar .fighter.player .fname {
    text-align: left;
    /* clear of the medallion that overlaps the tube */
    margin-left: 22px;
}
.mechili-fightbar .fighter.enemy .fname {
    align-self: flex-end;
    text-align: right;
    margin-right: 22px;
}
.mechili-fightbar .fspec {
    display: none;
}
.mechili-fightbar .fighter.no-hp .fighter-info { gap: 2px; }
.mechili-fightbar .fighter.no-hp .fname { font-size: 11px; }
.mechili-fightbar .fighter.player .fspec { text-align: left; }
.mechili-fightbar .fighter.enemy .fspec { text-align: right; }
/* a chosen specialist makes the frame clickable (opens its card) */
.mechili-fightbar .fighter.has-spec { pointer-events: auto; cursor: pointer; }
.mechili-fightbar .fighter.has-spec:hover .portrait {
    border-color: ${u.brassLight};
    filter: brightness(1.08);
}
${hpTubeTrack(u, '.mechili-fightbar .hp-track', 'auto')}
.mechili-fightbar .hp-track {
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
}
.mechili-fightbar .fighter.player .hp-track {
    direction: ltr;
    border-radius: 0 2px 2px 0;
}
.mechili-fightbar .fighter.enemy .hp-track {
    direction: rtl;
    border-radius: 2px 0 0 2px;
}
${/* Highlight and shadow are derived from the team colour, not hardcoded:
      these used to be fixed blues around ${pc} and fixed reds around ${ec},
      which only agreed on the host. A guest (side 'b') has pc=red/ec=blue, so
      every fighter bar showed both colours at once. */ ''}
${hpTubeFill(
    '.mechili-fightbar .fighter.player .hp-fill',
    `linear-gradient(180deg, ${shadeCss(teamColors.player.hex, 0.45)} 0%, ${pc} 42%, ${shadeCss(teamColors.player.hex, -0.35)} 100%)`,
)}
${hpTubeFill(
    '.mechili-fightbar .fighter.enemy .hp-fill',
    `linear-gradient(180deg, ${shadeCss(teamColors.enemy.hex, 0.45)} 0%, ${ec} 42%, ${shadeCss(teamColors.enemy.hex, -0.35)} 100%)`,
    { origin: 'right center' },
)}
${hpTubeVal('.mechili-fightbar .hp-val', '13px')}
/* HP label rides the fill tip — inside when full, in the empty track when space allows */
.mechili-fightbar .hp-val {
    left: auto;
    right: auto;
    width: auto;
    max-width: 45%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    box-sizing: border-box;
    overflow: hidden;
    transition: left 0.25s ease-out, transform 0.25s ease-out;
}
.mechili-fightbar .fighter.player .hp-val {
    /* floor at 24px so a near-empty / negative bar keeps the label out of the
       portrait, which the tube tucks under (info margin-left + lower z-index) */
    left: max(24px, calc(2px + var(--hp, 1) * (100% - 4px)));
    transform: translateX(-100%); /* inside the fill */
}
.mechili-fightbar .fighter.player .hp-val.outside {
    transform: translateX(0); /* just past the tip, in empty track */
}
.mechili-fightbar .fighter.enemy .hp-val {
    /* cap so a near-empty bar keeps the label clear of the enemy portrait */
    left: min(calc(100% - 24px), calc(2px + (1 - var(--hp, 1)) * (100% - 4px)));
    transform: translateX(0); /* inside the fill */
}
.mechili-fightbar .fighter.enemy .hp-val.outside {
    transform: translateX(-100%); /* just past the tip, in empty track */
}
/* ── The health bar as a banner ─────────────────────────────────────────
   An old, weathered flag hanging out of the portrait frame: faded, yellowed dye,
   stains and grime, a few set folds, coarse weave, frayed hems and stitching, a
   swallowtail end. It gets shorter as health goes; the lost
   length shows as a faded, worn shadow of the banner, and a pale strip of cloth
   trails the fill down after each hit (.hp-lag). The level comes as --hp on the
   track — a length, not a scale, so the swallowtail keeps its shape. */
.mechili-fightbar .hp-track {
    --notch: 12px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
    overflow: visible;
}
/* the banner's shadow */
.mechili-fightbar .fighter-stack .fighter-info { filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55)); }
/* a fixed height: it used to take what the name below left over, and a name with
   capitals (".tall") sits lower — so the two banners came out different heights */
.mechili-fightbar .fighter-stack .hp-track { flex: 0 0 34px; height: 34px; }
/* room for the name under the taller banner */
.mechili-fightbar .fighter-stack .fighter-info { height: 53px; }
.mechili-fightbar .fighter.player .hp-track { transform-origin: left center; }
.mechili-fightbar .fighter.enemy .hp-track { transform-origin: right center; }
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track::before,
.mechili-fightbar .fighter:is(.player, .enemy) .hp-lag,
.mechili-fightbar .fighter:is(.player, .enemy) .hp-fill {
    position: absolute;
    /* hangs from the pole */
    top: 3px;
    bottom: 0;
    left: 0;
    right: auto;
    border-radius: 0;
}
.mechili-fightbar .fighter-stack .fighter.enemy .hp-track::before,
.mechili-fightbar .fighter-stack .fighter.enemy .hp-lag,
.mechili-fightbar .fighter-stack .fighter.enemy .hp-fill {
    left: auto;
    right: 0;
}
/* frayed hems: a jagged edge top and bottom (the swallowtail clip still cuts the end) */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track::before,
.mechili-fightbar .fighter:is(.player, .enemy) .hp-lag,
.mechili-fightbar .fighter:is(.player, .enemy) .hp-fill {
    -webkit-mask: url("data:image/svg+xml,${encodeURIComponent(FRAY_SVG)}") repeat-x 0 0 / 40px 100%;
    mask: url("data:image/svg+xml,${encodeURIComponent(FRAY_SVG)}") repeat-x 0 0 / 40px 100%;
}
/* swallowtail at the free end */
.mechili-fightbar .fighter.player .hp-track::before,
.mechili-fightbar .fighter.player .hp-lag,
.mechili-fightbar .fighter.player .hp-fill {
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--notch)) 50%, 100% 100%, 0 100%);
}
.mechili-fightbar .fighter.enemy .hp-track::before,
.mechili-fightbar .fighter.enemy .hp-lag,
.mechili-fightbar .fighter.enemy .hp-fill {
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, var(--notch) 50%);
}
/* the full banner's ghost: faded, worn cloth where health has been lost */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track::before {
    content: '';
    width: 100%;
    z-index: 0;
    opacity: 0.5;
    background:
        repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.12) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #2c2620 0%, #1a1612 100%);
}
/* pale cloth trailing the fill down after a hit */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-lag {
    width: calc(var(--hp, 1) * 100%);
    z-index: 1;
    background: linear-gradient(180deg, rgba(226, 206, 166, 0.8), rgba(176, 152, 112, 0.72));
    transition: width 0.55s ease-in 0.35s;
}
.mechili-fightbar .fighter:is(.player, .enemy) .hp-fill {
    width: calc(var(--hp, 1) * 100%);
    transform: none !important;
    transition: width 0.18s ease-out;
    z-index: 2;
    box-shadow: none;
}
/* stitched hems along the top and bottom */
.mechili-fightbar .hp-fill::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 3px;
    bottom: 3px;
    border-top: 1px dashed rgba(230, 210, 170, 0.32);
    border-bottom: 1px dashed rgba(230, 210, 170, 0.32);
    pointer-events: none;
}
.mechili-fightbar .fighter.player .hp-fill {
    background:
        /* stains and grime: old water marks, smoke, a scorch near the end */
        radial-gradient(ellipse 34px 10px at 22% 70%, rgba(40, 24, 8, 0.32), transparent 70%),
        radial-gradient(ellipse 22px 14px at 58% 30%, rgba(40, 24, 8, 0.24), transparent 70%),
        radial-gradient(ellipse 40px 12px at 86% 78%, rgba(20, 12, 4, 0.38), transparent 72%),
        radial-gradient(ellipse 16px 8px at 40% 18%, rgba(255, 236, 190, 0.12), transparent 70%),
        /* a few irregular folds, set in the cloth (not periodic) */
        linear-gradient(90deg, transparent 0 9%, rgba(0, 0, 0, 0.18) 13%, transparent 17%, transparent 31%, rgba(255, 240, 200, 0.08) 35%, transparent 39%, transparent 52%, rgba(0, 0, 0, 0.2) 57%, transparent 62%, transparent 74%, rgba(255, 240, 200, 0.07) 78%, transparent 82%),
        /* grime gathered along the hems */
        linear-gradient(180deg, rgba(30, 18, 6, 0.35) 0%, transparent 22%, transparent 76%, rgba(30, 18, 6, 0.45) 100%),
        /* coarse weave */
        repeating-linear-gradient(0deg, rgba(255, 240, 210, 0.07) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0 1px, transparent 1px 3px),
        /* the dye, faded and yellowed with age */
        linear-gradient(180deg, ${shadeCss(teamColors.player.hex, 0.15)} 0%, ${pc} 45%, ${shadeCss(teamColors.player.hex, -0.5)} 100%);
    filter: saturate(0.72) sepia(0.28) brightness(0.92);
}
.mechili-fightbar .fighter.enemy .hp-fill {
    background:
        /* stains and grime: old water marks, smoke, a scorch near the end */
        radial-gradient(ellipse 34px 10px at 22% 70%, rgba(40, 24, 8, 0.32), transparent 70%),
        radial-gradient(ellipse 22px 14px at 58% 30%, rgba(40, 24, 8, 0.24), transparent 70%),
        radial-gradient(ellipse 40px 12px at 86% 78%, rgba(20, 12, 4, 0.38), transparent 72%),
        radial-gradient(ellipse 16px 8px at 40% 18%, rgba(255, 236, 190, 0.12), transparent 70%),
        /* a few irregular folds, set in the cloth (not periodic) */
        linear-gradient(90deg, transparent 0 9%, rgba(0, 0, 0, 0.18) 13%, transparent 17%, transparent 31%, rgba(255, 240, 200, 0.08) 35%, transparent 39%, transparent 52%, rgba(0, 0, 0, 0.2) 57%, transparent 62%, transparent 74%, rgba(255, 240, 200, 0.07) 78%, transparent 82%),
        /* grime gathered along the hems */
        linear-gradient(180deg, rgba(30, 18, 6, 0.35) 0%, transparent 22%, transparent 76%, rgba(30, 18, 6, 0.45) 100%),
        /* coarse weave */
        repeating-linear-gradient(0deg, rgba(255, 240, 210, 0.07) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0 1px, transparent 1px 3px),
        /* the dye, faded and yellowed with age */
        linear-gradient(180deg, ${shadeCss(teamColors.enemy.hex, 0.15)} 0%, ${ec} 45%, ${shadeCss(teamColors.enemy.hex, -0.5)} 100%);
    filter: saturate(0.72) sepia(0.28) brightness(0.92);
}
/* The pole the flag hangs from: dark wood coming out of the portrait frame (the
   track starts under it), held by an iron band where it leaves the frame, running the
   flag's full length — it stays when the cloth gets shorter — to an iron knob. */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track::after {
    content: '';
    position: absolute;
    top: 0;
    height: 5px;
    z-index: 4;
    pointer-events: none;
    border-radius: 2px;
    box-shadow: 0 2px 2px rgba(0, 0, 0, 0.55);
}
.mechili-fightbar .fighter.player .hp-track::after {
    left: 0;
    right: -6px;
    background:
        /* iron band at the frame */
        linear-gradient(180deg, #5a534c 0%, #2c2723 60%, #17130f 100%) 17px 0 / 4px 100% no-repeat,
        /* iron knob at the end */
        radial-gradient(circle at calc(100% - 3.5px) 50%, #7a7068 0 1px, #3a342e 2px, #16120e 3.2px, transparent 3.6px),
        /* grain along the pole */
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.2) 0 2px, transparent 2px 9px, rgba(220, 180, 130, 0.08) 9px 10px, transparent 10px 17px) 0 0 / calc(100% - 7px) 100% no-repeat,
        linear-gradient(180deg, #6b4c30 0%, #3d2a1a 55%, #1f150c 100%) 0 0 / calc(100% - 7px) 100% no-repeat;
}
.mechili-fightbar .fighter.enemy .hp-track::after {
    right: 0;
    left: -6px;
    background:
        linear-gradient(180deg, #5a534c 0%, #2c2723 60%, #17130f 100%) calc(100% - 17px) 0 / 4px 100% no-repeat,
        radial-gradient(circle at 3.5px 50%, #7a7068 0 1px, #3a342e 2px, #16120e 3.2px, transparent 3.6px),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.2) 0 2px, transparent 2px 9px, rgba(220, 180, 130, 0.08) 9px 10px, transparent 10px 17px) 100% 0 / calc(100% - 7px) 100% no-repeat,
        linear-gradient(180deg, #6b4c30 0%, #3d2a1a 55%, #1f150c 100%) 100% 0 / calc(100% - 7px) 100% no-repeat;
}
/* the flag hangs from its top edge (a hit sways it from there) */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track { transform-origin: 50% 0; }
/* a hit: a jolt runs through the banner */
.mechili-fightbar .fighter:is(.player, .enemy) .hp-track.is-hit { animation: mechili-banner-jolt 0.4s ease-out; }
@keyframes mechili-banner-jolt {
    0% { transform: none; }
    20% { transform: scaleY(1.06) skewX(-4deg); }
    45% { transform: scaleY(0.97) skewX(2.5deg); }
    70% { transform: skewX(-1deg); }
    100% { transform: none; }
}
/* the number on the cloth, clear of the swallowtail */
.mechili-fightbar .hp-val {
    top: 50%;
    bottom: auto;
    height: 17px;
    margin-top: -8.5px;
    padding: 0 5px;
    z-index: 3;
    font-size: 12px;
    color: ${u.cream};
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 5px rgba(0, 0, 0, 0.7);
}
.mechili-fightbar .fighter.player .hp-val { transform: translateX(calc(-100% - var(--notch) - 2px)); }
.mechili-fightbar .fighter.player .hp-val.outside { transform: translateX(4px); }
.mechili-fightbar .fighter.enemy .hp-val { transform: translateX(calc(var(--notch) + 2px)); }
.mechili-fightbar .fighter.enemy .hp-val.outside { transform: translateX(calc(-100% - 4px)); }
@media (prefers-reduced-motion: reduce) {
    .mechili-fightbar .fighter:is(.player, .enemy) .hp-track.is-hit { animation: none; }
}
.mechili-topbar .round { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
.mechili-topbar .timer { font-size: 22px; font-weight: bold; font-variant-numeric: tabular-nums; color: ${u.brassLight}; }
.mechili-topbar .timer.urgent {
    animation: mechili-timer-urgent 1s steps(1, end) infinite;
}
@keyframes mechili-timer-urgent {
    0%, 49% {
        color: #e24b3c;
        text-shadow: 0 1px 8px rgba(0, 0, 0, 0.85), 0 0 14px rgba(226, 75, 60, 0.55);
        transform: scale(1.06);
    }
    50%, 100% {
        color: ${u.brassLight};
        text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8);
        transform: scale(1);
    }
}
.mechili-topbar .end-deploy {
    /* a wooden button like the rest, white lettering */
    position: relative;
    padding: 10px 24px;
    ${WOOD_BUTTON}
    border-radius: 3px;
    color: #fff;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1.5px;
    cursor: pointer;
}
.mechili-topbar .end-deploy:hover {
    border-color: #6a6058;
    filter: brightness(1.12);
    transform: translateY(-1px);
}
.mechili-topbar .end-deploy:active { transform: translateY(0) scale(0.97); }
.mechili-topbar .end-deploy:focus-visible { outline: none; border-color: #8a7f74; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.45); }
/* a teammate (2v2/duo) already locked in — left half lights brass so
   both seats on a side can see who's still holding things up */
.mechili-topbar .end-deploy.ally-ready {
    /* the teammate's half lit: a pale wash over the left half of the cloth (::after) */
}
.mechili-topbar .end-deploy.ally-ready::after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 50%;
    background: rgba(255, 236, 190, 0.22);
    pointer-events: none;
}
.mechili-topbar.battle .end-deploy { display: none; }
.mechili-topbar.waiting .end-deploy { display: none; }
/* a card overlay is up (specialist pick, reveal, round card) — can't end yet */
.mechili-topbar.overlay-open .end-deploy { display: none; }
.mechili-topbar .speed {
    display: none;
    min-width: 52px;
    padding: 7px 10px;
    ${WOOD_BUTTON}
    border-radius: 3px;
    color: ${u.brassLight};
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.mechili-topbar .speed { transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-topbar .speed:hover { border-color: #6a6058; filter: brightness(1.12); }
.mechili-topbar .speed:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
/* sit below End Deployment's deploy-phase hitbox so a phase swap can't
 * land a speed click on "End Deployment" (or the reverse) */
.mechili-topbar.battle .speed {
    display: inline-block;
    margin-top: 44px;
}
/* the settings panel (or a card overlay) is up — no speeding through the
 * battle you can't see behind it; !important since .battle .speed's own
 * display:inline-block would otherwise win when both classes are present */
.mechili-topbar.overlay-open .speed { display: none !important; }

/*
 * Touch-first devices (tablet/phone): same layout, but tap targets meet the
 * ~44px minimum and the smallest labels get a readability bump. Desktop with
 * a mouse is untouched. Keyed on pointer capability, not viewport width.
 */
@media (pointer: coarse) {
    .mechili-panel .action-tile {
        width: 54px;
        height: 54px;
    }
    .mechili-panel .action-tile:has(.at-cost) { padding-bottom: 14px; }
    .mechili-panel .action-tile .at-cost { font-size: 10px; }
    .mechili-sidebar .inv-item {
        width: 54px;
        height: 54px;
        font-size: 25px;
    }
    .mechili-sidebar .inv-title { width: 54px; }
    .mechili-chat .c-emote {
        width: 44px;
        height: 44px;
        font-size: 24px;
    }
    .mechili-topbar .speed {
        min-width: 64px;
        padding: 10px 12px;
        font-size: 14px;
    }
    /* backdrop blur + WebGL memory pressure crashes mobile Safari tabs */
    .mechili-shop,
    .mechili-panel,
    .mechili-sidebar,
    .mechili-chat.open .c-panel,
    .mechili-cards .cards-skip,
    .mechili-pause,
    .mechili-report {
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
    }
    .mechili-extras .shop-tile .title { font-size: 10px; }
    .mechili-extras .shop-tile .cost { font-size: 11px; }
    .mechili-shop-col .shop-tile .title { font-size: 11px; }
    .mechili-shop .shop-grid .shop-tile .title { font-size: 10px; }
    .mechili-shop .shop-tile.unlock .unlock-label { font-size: 9px; }
    .mechili-extras .level-all-global .title,
    .shop-toolbar .level-all-global .title { font-size: 11px; }
    .mechili-panel .lvl-big .lvl-cap { font-size: 9px; }
}

/*
 * Compact windows (narrow or short): side panels become bottom sheets behind a
 * tab bar. Same chrome on phone and small desktop — hover peeks stay on
 * inputMode() in JS; GPU/texture budgets stay on touchFirstDevice().
 * The bar and .phone-open class are always maintained by the Hud; they only
 * take visual effect inside this size query (and the tablet pill above).
 */
.mechili-phonebar {
    display: none;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    gap: 6px;
    padding: 4px calc(8px + env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom))
        calc(8px + env(safe-area-inset-left));
    /* a dark wooden bar with an iron edge */
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #3d2a1a 0%, #241810 100%);
    border-top: 2px solid #3a342e;
    box-shadow: inset 0 1px 0 rgba(255, 230, 180, 0.12);
    user-select: none;
    pointer-events: auto;
}
.mechili-phonebar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 5px 4px;
    appearance: none;
    background: none;
    border: none;
    border-radius: 3px;
    color: ${u.textMuted};
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    cursor: pointer;
}
.mechili-phonebar button .pb-ico { font-size: 20px; line-height: 1.15; }
.mechili-phonebar button.active { color: ${u.brassLight}; background: ${u.techBuyBg}; }
/* sheet tabs are phone-only: the phone media query opts them back in */
.mechili-phonebar .pb-tab { display: none; }
/* contextual field actions (inline display driven by setTouchActions) —
   same icon-over-label structure and flat look as the tabs */
.mechili-phonebar .ta-btn {
    min-height: 44px;
    color: ${u.text};
}
.mechili-phonebar .ta-level,
.mechili-phonebar .ta-levelall,
.mechili-phonebar .ta-upgrade {
    color: ${u.brassLight};
    font-variant-numeric: tabular-nums;
}
.mechili-phonebar button.disabled {
    opacity: 0.45;
    pointer-events: none;
}
/* card pick / pause overlays own the screen — the bar steps aside */
.mechili-phonebar.overlay-open { display: none !important; }
@media (pointer: coarse) {
    /* tablets: no tab UI — the bar appears as a small centered pill whenever
       move/rotate/cancel apply, clear of the shop and details panels (the
       phone media query below restores the full-width strip) */
    .mechili-phonebar.acting { display: flex; }
    .mechili-phonebar {
        left: 50%;
        right: auto;
        bottom: 44px;
        transform: translateX(-50%);
        padding: 4px 8px;
        gap: 10px;
        border: 1.5px solid ${u.border};
        border-radius: 4px;
    }
    .mechili-phonebar button { flex: 0 0 auto; padding: 5px 14px; }
}

/* iOS long-press: no text-selection loupe / copy callout on HUD chrome —
   long-press is a gameplay gesture here. Typing fields stay selectable. */
.mechili-shop-col,
.mechili-panel,
.mechili-sidebar,
.mechili-topbar,
.mechili-fightbar,
.mechili-phonebar,
.mechili-cards,
.mechili-pause,
.mechili-report {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
}
.mechili-shop-col *,
.mechili-panel *,
.mechili-sidebar *,
.mechili-cards * {
    -webkit-touch-callout: none;
}
input,
textarea {
    -webkit-user-select: text;
    user-select: text;
}

${gamepadCursorStyles(u)}

/* long-press tooltip card (touch stand-in for title-attribute tooltips) */
.mechili-touchtip {
    position: fixed;
    left: 50%;
    top: 18%;
    transform: translateX(-50%);
    z-index: 90;
    max-width: min(340px, calc(100vw - 32px));
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(44, 36, 28, 0.97), rgba(22, 18, 14, 0.97));
    border: 1.5px solid ${u.brass};
    border-radius: 4px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color: ${u.text};
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-line;
    user-select: none;
    pointer-events: auto;
}

@media (max-width: 599px), (max-height: 540px) {
    .mechili-phonebar { display: flex; }
    /* compact: full-width bottom strip (tablet pill above is overridden here) */
    .mechili-phonebar {
        left: 0;
        right: 0;
        bottom: 0;
        transform: none;
        padding: 4px calc(8px + env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom))
            calc(8px + env(safe-area-inset-left));
        gap: 6px;
        border: none;
        border-top: 1.5px solid ${u.border};
        border-radius: 0;
    }
    .mechili-phonebar button { flex: 1; padding: 5px 4px; }
    /* tabs share the bar with the actions: Shop/Spells only while nothing
       is selected; the Unit tab (and actions) take over on selection */
    .mechili-phonebar:not(.has-unit):not(.battle) .pb-shop { display: flex; }
    .mechili-phonebar:not(.has-unit):not(.battle).has-tactics .pb-tactics { display: flex; }
    .mechili-phonebar:not(.has-unit):not(.battle).has-chat .pb-chat { display: flex; }
    /* details tab makes way while the pack rides the finger */
    .mechili-phonebar.has-unit:not(.carrying) .pb-unit { display: flex; }
    /* the action-info frame renders BESIDE the panel on desktop — off-screen
       inside the phone sheet. Pin it above the bar instead, tappable (Buy). */
    .mechili-panel .action-info {
        position: fixed;
        left: 8px;
        right: 8px;
        top: auto;
        bottom: calc(64px + env(safe-area-inset-bottom));
        width: auto;
        pointer-events: auto;
        z-index: 20;
    }
    /* money joins the strip on phone (the shop toolbar lives in a sheet);
       dock below the enemy HP + name (portraits hidden, but name remains) */
    .mechili-phone-status { top: calc(72px + env(safe-area-inset-top)); }
    .mechili-phone-status .mechili-supply {
        display: flex;
        transition: opacity 0.28s ease, visibility 0.28s;
    }
    /* no spending during battle — money returns with the next deployment */
    .mechili-phone-status.battle .mechili-supply {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
    }
    .mechili-shop-col .mechili-supply { display: none !important; }
    /* menu button moves to the left edge; End Deployment stays centered alone */
    /* spectating a battle with nothing selected: no empty strip */
    .mechili-phonebar.battle:not(.has-unit):not(.acting) { display: none; }
    /* deployment: the chat is a bar sheet (Chat tab); battle: the normal
       floating bar returns, lifted clear of the tab bar */
    .mechili-chat {
        width: min(360px, calc(100vw - 12px));
        bottom: calc(58px + env(safe-area-inset-bottom));
    }
    .mechili-chat:not(.phone-open):not(.battle) { display: none; }
    /* float lines clear the raised (and opened) chat frame */
    .mechili-chat-float {
        bottom: calc(215px + env(safe-area-inset-bottom));
        z-index: 16;
    }
    .mechili-shop-col:not(.phone-open),
    .mechili-panel:not(.phone-open),
    .mechili-sidebar.left:not(.phone-open),
    .mechili-sidebar.right {
        display: none !important;
    }

    /* the open sheet docks above the tab bar and scrolls */
    .mechili-shop-col.phone-open,
    .mechili-panel.phone-open,
    .mechili-sidebar.left.phone-open {
        position: absolute;
        left: env(safe-area-inset-left);
        right: env(safe-area-inset-right);
        top: auto;
        bottom: calc(56px + env(safe-area-inset-bottom));
        transform: none;
        width: auto;
        max-width: none;
        max-height: 52vh;
        overflow-y: auto;
        border-radius: 12px 12px 0 0;
    }
    .mechili-shop-col.phone-open { align-items: stretch; }
    .mechili-shop-col.phone-open .mechili-shop {
        width: auto;
        border-right: 1.5px solid ${u.border};
        border-radius: 4px;
    }
    /* Keep the 78px 2-row tiles — stretching 3×1fr across the sheet
       made each unit huge (width:100% + aspect-ratio:1). */
    .mechili-shop-col.phone-open .shop-grid {
        grid-template-columns: none;
    }
    .mechili-shop-col.phone-open .mechili-extras { flex-wrap: wrap; justify-content: flex-end; }
    .mechili-sidebar.left.phone-open {
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        align-content: flex-start;
        border-left: 1.5px solid ${u.border};
    }

    /* compact commander bar + center controls */
    .mechili-fightbar .fighter-stack {
        width: min(40vw, 280px);
        min-width: 0;
    }
    .mechili-fightbar .fighter {
        min-width: 0;
        gap: 6px;
        padding: 4px 8px;
    }
    .mechili-fightbar .portrait-group { display: none; }
    .mechili-fightbar .fighter.player .fighter-info,
    .mechili-fightbar .fighter.enemy .fighter-info {
        margin-left: 0;
        margin-right: 0;
    }
    .mechili-fightbar .fighter.player .hp-track,
    .mechili-fightbar .fighter.enemy .hp-track {
        border-radius: 2px;
    }
    .mechili-fightbar .fighter.player .fname {
        margin-left: 8px;
    }
    .mechili-fightbar .fighter.enemy .fname {
        margin-right: 8px;
    }
    .mechili-fightbar .fighter { padding-bottom: 4px; }
    .mechili-fightbar .fighter-info { height: 40px; }
    .mechili-fightbar .fname { font-size: 12px; letter-spacing: 0.4px; margin-top: -2px; }
    .mechili-fightbar .fname.tall { margin-top: 2px; }
    .mechili-fightbar .fighter-stack.multi .fname { font-size: 12px; }
    .mechili-fightbar .fighter-info { gap: 0; }
    .mechili-fightbar .hp-track { height: auto; }
    .mechili-fightbar .hp-val { font-size: 11px; }
    .mechili-topbar { top: calc(2px + env(safe-area-inset-top)); gap: 2px; }
    .mechili-topbar .round { font-size: 11px; }
    .mechili-topbar .timer { font-size: 16px; }
    /* uniform 38px control row, clear of the commander HP bars; nowrap so a
       tight row never lets End Deployment wrap and grow vertically */
    .mechili-topbar .top-controls { margin-top: 10px; }
    .mechili-topbar .end-deploy,
    .mechili-topbar .speed {
        box-sizing: border-box;
        height: 38px;
        min-height: 38px;
        white-space: nowrap;
    }
    .mechili-topbar.battle .speed { margin-top: 40px; }
    .mechili-topbar .end-deploy {
        padding: 5px 12px;
        font-size: 11px;
        letter-spacing: 0.8px;
    }
    .mechili-report { max-height: 40vh; overflow-y: auto; }

}

/* ── one button feel for the whole match UI ──────────────────────────────
   hover: up 1px (cards keep their own bigger lift), eased, never abrupt
   press: small tiles 94%, wide buttons 97% and back down; quick in
   release: a short spring back to full size
   Colours and looks stay each button's own; only the motion is shared. */
:is(
    .mechili-shop-col .shop-tile,
    .mechili-shop .shop-rune,
    .mechili-shop .shop-tab,
    .mechili-panel .action-tile,
    .mechili-sidebar .inv-item,
    .mechili-extras .level-all-global,
    .shop-toolbar .level-all-global,
    .mechili-topbar .end-deploy,
    .mechili-topbar .speed,
    .mechili-topbar button,
    .mechili-corner-actions button,
    .mechili-pause button,
    .mechili-gameover button,
    .mechili-battlefield-bar button,
    .mechili-report button,
    .mechili-cards .card,
    .mechili-cards button:not(.card)
) {
    transition-property: transform, border-color, background-color, color, box-shadow, filter, opacity;
    transition-duration: 0.18s;
    /* the release: springs back past full size for a moment */
    transition-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
}
:is(
    .mechili-shop .shop-tab,
    .mechili-topbar .speed,
    .mechili-topbar button,
    .mechili-corner-actions button,
    .mechili-gameover button,
    .mechili-battlefield-bar button,
    .mechili-report button,
    .mechili-cards button:not(.card),
    .mechili-shop-col .shop-tile,
    .mechili-shop .shop-rune
):hover:not(:disabled) {
    transform: translateY(-1px);
}
/* small tiles */
:is(
    .mechili-shop-col .shop-tile,
    .mechili-shop .shop-rune,
    .mechili-panel .action-tile,
    .mechili-sidebar .inv-item,
    .mechili-extras .level-all-global,
    .shop-toolbar .level-all-global
):active:not(:disabled) {
    transform: scale(0.94);
    transition-duration: 0.06s;
    transition-timing-function: ease-out;
}
/* wide buttons */
:is(
    .mechili-shop .shop-tab,
    .mechili-topbar .end-deploy,
    .mechili-topbar .speed,
    .mechili-topbar button,
    .mechili-corner-actions button,
    .mechili-pause button,
    .mechili-gameover button,
    .mechili-battlefield-bar button,
    .mechili-report button,
    .mechili-cards button:not(.card)
):active:not(:disabled) {
    transform: translateY(0) scale(0.97);
    transition-duration: 0.06s;
    transition-timing-function: ease-out;
}
/* picker cards keep their lift while pressed, just give a little */
.mechili-cards .card:not(.static):active:not(:disabled) {
    transform: translateY(-3px) scale(0.98);
    transition-duration: 0.06s;
    transition-timing-function: ease-out;
}
@media (prefers-reduced-motion: reduce) {
    :is(
        .mechili-shop-col .shop-tile, .mechili-shop .shop-rune, .mechili-shop .shop-tab,
        .mechili-panel .action-tile, .mechili-sidebar .inv-item, .mechili-extras .level-all-global,
        .shop-toolbar .level-all-global, .mechili-topbar .end-deploy, .mechili-topbar .speed,
        .mechili-topbar button, .mechili-corner-actions button, .mechili-pause button,
        .mechili-gameover button, .mechili-battlefield-bar button, .mechili-report button,
        .mechili-cards .card, .mechili-cards button:not(.card)
    ) {
        transition-duration: 0s !important;
        transform: none !important;
    }
}
`;
}
