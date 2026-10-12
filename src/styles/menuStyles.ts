/** The menu screens' CSS (title, lobby, settings, tutorials, Year screens): generated from the theme. */
import { teamColors } from '../game/colors';
import { THEME, gamepadCursorStyles, PARCHMENT_FILL, INK, INK_MUTED, INK_RUST, PARCHMENT_EDGE, WOOD_BUTTON, materialStyles, hpTubeTrack, hpTubeFill, hpTubeVal, fontFaceCss, dialogFadeStyles, cardSpellTipStyles, iconBaseStyles, chatFloatStyles, chatBarStyles, type BarAssets } from '../theme';

export function menuStyles(bars?: BarAssets): string {
    const u = THEME.ui;
    const pc = teamColors.player.css;
    // only used by the shared chat styles below — a lobby has no teams, but
    // the same rules serve both sheets
    const ec = teamColors.enemy.css;
    return `
${fontFaceCss()}
${materialStyles(u)}
${iconBaseStyles()}
${dialogFadeStyles()}
${cardSpellTipStyles()}
${chatBarStyles(u)}
${chatFloatStyles(u, pc, ec)}
.mechili-menu {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: clamp(264px, 34vw, 324px);
    box-sizing: border-box;
    padding: 22px 20px 24px;
    max-height: min(88vh, calc(100dvh - 200px));
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    /* chrome filled by materialStyles ornate frame */
    user-select: none;
    z-index: 30;
}
/* Exclusive submenu screens — only .is-active is shown (see showMenuView).
   :not(.is-active) beats later .m-main/.m-custom display:flex rules. */
.mechili-menu .m-view:not(.is-active) { display: none; }
.mechili-menu .m-view.is-active {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: 100%;
}
/* ── menu motion (see ui/menuMotion.ts) ── */
/* the menu painting: zooms slowly into one spot and back out (focus = the zoom's centre) */
.mechili-menu-backdrop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
}
.mechili-menu-backdrop .m-backdrop-img {
    position: absolute;
    inset: 0;
    background: center / cover no-repeat;
    transform-origin: 75% 40%;
    animation: m-backdrop-zoom 52s ease-in-out infinite alternate;
    animation-play-state: paused;
    will-change: transform;
}
.mechili-menu-backdrop.is-live .m-backdrop-img { animation-play-state: running; }
@keyframes m-backdrop-zoom {
    from { transform: scale(1); }
    to   { transform: scale(1.18); }
}
@keyframes m-arrive {
    from { opacity: 0; translate: 0 8px; }
    to { opacity: 1; translate: 0 0; }
}
.mechili-menu .m-arrive { animation: m-arrive 300ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
/* between two screens the parchment grows / shrinks: no scrollbar flashing meanwhile */
.mechili-menu.is-resizing { overflow-y: hidden; }
@keyframes m-panel-in {
    from { opacity: 0; scale: 0.96; }
    to { opacity: 1; scale: 1; }
}
@keyframes m-chrome-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
.mechili-menu-chrome.is-arriving .mechili-menu { animation: m-panel-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms backwards; }
.mechili-menu-chrome.is-arriving > :not(.mechili-menu) { animation: m-chrome-in 600ms ease-out 450ms backwards; }
@media (prefers-reduced-motion: reduce) {
    .mechili-menu-backdrop .m-backdrop-img,
    .mechili-menu .m-arrive,
    .mechili-menu-chrome.is-arriving > * { animation: none; }
}
/* short viewports: keep the button stack readable above bottom chrome */
@media (max-height: 720px) {
    .mechili-menu {
        gap: 8px;
        padding: 14px 16px 16px;
        max-height: min(86vh, calc(100dvh - 168px));
    }
    .mechili-menu .m-btn {
        padding: 11px 14px;
        font-size: 15px;
    }
    .mechili-menu .m-primary { font-size: 16px; }
    .mechili-menu .m-main { gap: 8px; }
    .mechili-menu .m-room-list {
        max-height: min(120px, 22vh);
        min-height: 48px;
    }
}
/* brass accent line across the top of the console */
.mechili-menu::before {
    content: '';
    position: absolute;
    left: 20px;
    right: 20px;
    top: 0;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, ${u.brass}, transparent);
    opacity: 0.7;
}
.mechili-menu .m-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 13px 16px;
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #4a3422 0%, #33231a 55%, #1f150c 100%);
    border: 1.5px solid #3a342e;
    border-radius: 4px;
    color: ${u.cream};
    font-size: 16px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-align: start;
    cursor: pointer;
    box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 230, 180, 0.12),
        inset 0 -2px 4px rgba(0, 0, 0, 0.4);

    transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease,
        background 0.14s ease, color 0.14s ease;
}
.mechili-menu .m-btn .m-ico {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 0;
    color: ${u.brass};
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
.mechili-menu .m-btn .m-ico.m-icon {
    width: 24px;
    height: 24px;
    font-size: 0;
    line-height: 0;
}
.mechili-menu .m-btn .m-label { flex: 1; }
.mechili-menu .m-btn:hover {
    border-color: ${u.hover};
    color: ${u.brassLight};
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(184, 146, 74, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.mechili-menu .m-btn:active { transform: translateY(0) scale(0.98); }
.mechili-menu .m-btn:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
.mechili-menu .m-btn:disabled { opacity: 0.4; pointer-events: none; box-shadow: none; }
/* Single Player — the hero call to action */
.mechili-menu .m-primary {
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border-color: ${u.brassLight};
    color: #20180a;
    font-size: 17px;
    box-shadow: 0 4px 14px rgba(184, 146, 74, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.mechili-menu .m-primary .m-ico { color: #20180a; filter: none; }
.mechili-menu .m-primary:hover {
    color: #20180a;
    background: linear-gradient(180deg, #fff0b0, ${u.brassLight});
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(184, 146, 74, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
/* every joined player is ready — the host's cue to start */
.mechili-menu .m-btn.is-go {
    border-color: ${u.techOwned};
    color: ${u.techOwned};
    box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.35),
        0 0 0 1px rgba(168, 216, 104, 0.35),
        inset 0 1px 0 rgba(255, 230, 180, 0.12);
}
.mechili-menu .m-small {
    justify-content: center;
    padding: 9px 12px;
    font-size: 13px;
    letter-spacing: 1px;
}
.mechili-menu .m-custom { flex-direction: column; align-items: center; gap: 10px; }
.mechili-menu .m-join { display: flex; gap: 8px; }
.mechili-menu .m-input {
    width: 130px;
    padding: 9px 10px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-size: 14px;
    letter-spacing: 2px;
    text-align: center;
}
.mechili-menu .m-status { font-size: 14px; color: ${u.phase}; max-width: 380px; text-align: center; margin-inline: auto; align-self: center; }
/* Cancel is the way OUT of a lobby, never the thing to do in it — but it
   inherited .m-btn's full-width leather-and-shadow treatment, which read as
   the primary action while the real one ("I'm ready", "Start") sat above it
   looking secondary. Same colours, none of the weight. */
.mechili-menu .m-cancel {
    width: auto;
    align-self: center;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: normal;
    letter-spacing: 1px;
    background: none;
    box-shadow: none;
    border-color: ${u.undoBorder};
    color: ${u.undoText};
    opacity: 0.8;
}
.mechili-menu .m-cancel:hover { opacity: 1; border-color: ${u.hover}; }
/* Floating bottom-center over the menu, matching where the match keeps its
   chat — the panel chrome lives here so the ChatBar inside can stay bare. */
/* Steam friends + invite, opened from an empty seat in the lobby roster.
   Centered over the menu like a small dialog — it is a deliberate detour, not
   ambient chrome, so it sits above everything until dismissed. */
.mechili-friends {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(340px, calc(100vw - 32px));
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    color: ${u.text};
    background: linear-gradient(180deg, rgba(40, 32, 24, 0.96), rgba(20, 16, 12, 0.98));
    border: 1.5px solid ${u.border};
    border-radius: 5px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    z-index: 40;
}
.mechili-friends .fr-title {
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${u.brass};
}
.mechili-friends .fr-close {
    position: absolute;
    top: 8px;
    right: 10px;
    padding: 0 4px;
    background: none;
    border: none;
    color: ${u.textMuted};
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
}
.mechili-friends .fr-close:hover { color: ${u.text}; }
.mechili-friends .fr-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 260px;
    overflow-y: auto;
}
.mechili-friends .fr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
}
.mechili-friends .fr-row.in-game { border-color: ${u.techOwned}; }
.mechili-friends .fr-avatar {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 3px;
    background: ${u.panelBgDark} center/cover no-repeat;
}
.mechili-friends .fr-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}
.mechili-friends .fr-state { flex: none; font-size: 11px; color: ${u.textMuted}; }
.mechili-friends .fr-row.in-game .fr-state { color: ${u.techOwned}; }
.mechili-friends .fr-invite {
    flex: none;
    padding: 3px 10px;
    font: inherit;
    font-size: 11.5px;
    color: ${u.text};
    background: ${u.techBuyBg};
    border: 1px solid ${u.border};
    border-radius: 3px;
    cursor: pointer;
    transition: border-color 0.12s ease;
}
.mechili-friends .fr-invite:hover:not(:disabled) { border-color: ${u.hover}; }
.mechili-friends .fr-invite:disabled { opacity: 0.6; cursor: default; }
.mechili-friends .fr-empty { font-size: 12.5px; color: ${u.textMuted}; padding: 6px 2px; }
.mechili-friends .fr-note { font-size: 11.5px; color: ${u.textMuted}; line-height: 1.4; }
.mechili-friends .fr-overlay-btn {
    padding: 5px 10px;
    font: inherit;
    font-size: 11.5px;
    color: ${u.textMuted};
    background: none;
    border: 1px solid ${u.border};
    border-radius: 3px;
    cursor: pointer;
}
.mechili-friends .fr-overlay-btn:hover { color: ${u.text}; border-color: ${u.hover}; }
/* Positioning only. The panel chrome belongs to the ChatBar inside, which
   collapses to a strip — a box drawn out here would stay behind as an empty
   frame around it. Mounted on the wrapper rather than inside .mechili-menu,
   so it inherits none of the menu's text colour: without the explicit colour
   the messages render near-black on the dark panel. */
.mechili-lobby-chat {
    position: absolute;
    left: 50%;
    bottom: calc(14px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(360px, calc(100vw - 24px));
    box-sizing: border-box;
    color: ${u.text};
    z-index: 30;
}
.mechili-menu .m-lobby { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%; }
.mechili-menu .m-mp-count {
    display: inline-flex;
    gap: 6px;
    margin-inline-start: auto;
    padding-inline-start: 10px;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.3px;
    text-transform: none;
}
.mechili-menu .m-mp-count[hidden] { display: none; }
/* the "n open" badge is a button: it joins an open game — lit and breathing so it reads as one */
.mechili-menu .m-mp-open {
    cursor: pointer;
    background: rgba(120, 200, 90, 0.18) !important;
    box-shadow: 0 0 0 1px rgba(150, 220, 110, 0.35), 0 0 10px rgba(150, 220, 110, 0.45);
    animation: m-mp-open-glow 1.8s ease-in-out infinite;
    transition: transform 0.12s ease, background 0.12s ease;
}
.mechili-menu .m-mp-open:hover {
    transform: scale(1.08);
    background: rgba(120, 200, 90, 0.34) !important;
}
.mechili-menu .m-mp-open:active { transform: scale(0.97); }
@keyframes m-mp-open-glow {
    0%, 100% { box-shadow: 0 0 0 1px rgba(150, 220, 110, 0.35), 0 0 6px rgba(150, 220, 110, 0.3); }
    50% { box-shadow: 0 0 0 1px rgba(150, 220, 110, 0.6), 0 0 16px rgba(150, 220, 110, 0.7); }
}
@media (prefers-reduced-motion: reduce) { .mechili-menu .m-mp-open { animation: none; } }
.mechili-menu .m-mp-count > span {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid ${u.border};
    background: rgba(0, 0, 0, 0.3);
    white-space: nowrap;
}
.mechili-menu .m-mp-open { color: ${u.hpBar}; border-color: currentColor; }
.mechili-menu .m-mp-open::before { content: '● '; }
.mechili-menu .m-mp-running { color: ${u.brassLight}; }
.mechili-menu .m-mp-running::before { content: '▶ '; font-size: 0.85em; }
.mechili-menu .m-rooms {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mechili-menu .m-rooms-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 2px;
}
.mechili-menu .m-rooms-label {
    color: ${u.textMuted};
    font-size: 12px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
}
.mechili-menu .m-rooms-refresh {
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    color: ${u.textMuted};
    border-radius: 6px;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.12s ease, color 0.12s ease;
}
.mechili-menu .m-rooms-refresh:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-menu .m-rooms-refresh:focus-visible { outline: none; border-color: ${u.brassLight}; }
.mechili-menu .m-rooms-refresh:disabled { opacity: 0.5; cursor: default; }
.mechili-menu .m-room-list {
    width: 100%;
    box-sizing: border-box;
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    background: rgba(20, 16, 12, 0.75);
    border: 1.5px solid ${u.border};
    border-radius: 4px;
}
.mechili-menu .m-room-list.empty { justify-content: center; align-items: center; color: ${u.textMuted}; font-size: 13px; min-height: 64px; }
.mechili-menu .m-room {
    padding: 10px 12px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    text-align: start;
    transition: transform 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.mechili-menu .m-room::before { content: '▸ '; color: ${u.brass}; }
.mechili-menu .m-room:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateX(2px); }
:dir(rtl) .mechili-menu .m-room::before { content: '◂ '; }
:dir(rtl) .mechili-menu .m-room:hover { transform: translateX(-2px); }
.mechili-menu .m-room:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.3); }
/* a running match, joinable only as a spectator — visually distinct from
   an open (joinable-as-player) room above */
.mechili-menu .m-room-spectate { border-style: dashed; }
.mechili-menu .m-room-spectate::before { content: '👁 '; }
.mechili-menu .m-room-spectate:hover { border-color: ${u.hover}; }
/* a running match with OUR OWN seat currently disconnected — resume it
   instead of spectating */
.mechili-menu .m-room-row { display: flex; gap: 8px; width: 100%; }
.mechili-menu .m-scenario-list { max-height: min(46vh, 420px); }
.mechili-menu .m-scenario-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
}
.mechili-menu .m-scenario-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; color: ${u.text}; }
.mechili-menu .m-scenario-btn {
    font: inherit;
    font-size: 13px;
    padding: 4px 10px;
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    background: ${u.panelBgDark};
    color: ${u.text};
    cursor: pointer;
}
.mechili-menu .m-scenario-btn:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-menu .m-scenario-import { display: flex; gap: 6px; width: 100%; }
.mechili-menu .m-scenario-open { display: flex; gap: 8px; width: 100%; }
.mechili-menu .m-scenario-open .m-scenario-btn { flex: 1; padding: 10px 12px; font-size: 15px; font-weight: bold; }
.mechili-menu .m-scenario-list-label { width: 100%; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: ${u.textMuted}; }
.mechili-menu .m-scenario-package { background: rgba(212, 184, 120, 0.1); }
.mechili-menu .m-scenario-level { margin-inline-start: 16px; }
.mechili-menu .m-scenario-level.is-done .m-scenario-name { color: ${u.brassLight}; }
.mechili-menu .m-scenario-code {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    padding: 4px 8px;
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    background: #1e1b15;
    color: ${u.text};
}
.mechili-menu .m-scenario-status { min-height: 1.2em; font-size: 13px; color: ${u.brassLight}; text-align: center; }
.mechili-menu .m-room-row .m-btn { flex: 1; width: auto; }
.mechili-menu .m-main {
    gap: 12px;
}
.mechili-menu .m-spmode {
    gap: 14px;
}
.mechili-menu .m-spmode-title {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 2px;
    text-align: center;
    color: ${u.brassLight};
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    text-transform: uppercase;
}
.mechili-menu .m-spmode-row {
    display: flex;
    gap: 16px;
    justify-content: center;
    font-size: 15px;
    color: ${u.text};
}
.mechili-menu .m-spmode-row label,
.mechili-menu .m-spmode-horde {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
.mechili-menu .m-spmode-horde { justify-content: center; font-size: 14px; color: ${u.text}; }
/* Loadout screen (PROGRESSION_PLAN.md §1g) — the 3D stage IS the screen;
   every panel floats over it. Its own overlay, not a menu view, so the menu
   frame's width never constrains it. */
.mechili-loadout {
    position: absolute;
    inset: 0;
    z-index: 40;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 46%, #2a2119 0%, #14100c 62%, #0a0806 100%);
    color: ${u.text};
    user-select: none;
}
.mechili-loadout .lo-stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
}
.mechili-loadout .lo-stage.mh-draggable { cursor: grab; }
.mechili-loadout .lo-stage.dragging { cursor: grabbing; }

/* ---- floating panels ---- */
.mechili-loadout .lo-left,
.mechili-loadout .lo-right,
.mechili-loadout .lo-corner {
    position: absolute;
    z-index: 1;
}
.mechili-loadout .lo-left {
    top: calc(24px + env(safe-area-inset-top));
    inset-inline-start: calc(24px + env(safe-area-inset-left));
    /* bounded to the viewport so the stats can never run off the bottom of
       a short window — they shrink and scroll instead */
    bottom: calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: clamp(210px, 22vw, 280px);
}
.mechili-loadout .lo-right {
    top: calc(24px + env(safe-area-inset-top));
    inset-inline-end: calc(24px + env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: clamp(250px, 26vw, 340px);
    max-height: calc(100% - 120px);
}
.mechili-loadout .lo-corner {
    bottom: calc(24px + env(safe-area-inset-bottom));
    inset-inline-end: calc(24px + env(safe-area-inset-right));
    display: flex;
    gap: 8px;
}

/* ---- unit switcher ---- */
.mechili-loadout .lo-switcher {
    display: flex;
    align-items: center;
    gap: 10px;
    /* The name is a headline and should not be boxed in by the STATS column
       width — "Crow Rider" at 34px needs more than the ~280px that panel
       wants. Overflowing to the right is free: this floats over the stage,
       and nothing sits beside it. */
    width: max-content;
    min-width: 100%;
    max-width: min(48vw, 520px);
}
.mechili-loadout .lo-unitname {
    flex: 1;
    font-size: clamp(22px, 2.6vw, 34px);
    font-weight: bold;
    letter-spacing: 1px;
    color: ${u.brassLight};
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-loadout .lo-arrow {
    flex: 0 0 auto;
    padding: 4px 8px;
    background: none;
    border: none;
    color: ${u.brass};
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
    transition: color 0.14s ease, transform 0.14s ease;
}
.mechili-loadout .lo-arrow:hover { color: ${u.hover}; transform: scale(1.2); }

/* ---- stat list: label left, value right, one row each ---- */
.mechili-loadout .lo-stats {
    display: flex;
    flex-direction: column;
    /* take what is left under the switcher, but never more: past that the
       list scrolls rather than overflowing the window */
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    width: 100%;
    box-sizing: border-box;
    /* parchment, in ink (like the details pane in the match) */
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    color: ${INK};
}
.mechili-loadout .lo-stat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 11px;
    border-bottom: 1px solid rgba(90, 55, 20, 0.25);
    font-size: 12px;
}
.mechili-loadout .lo-stat:last-child { border-bottom: none; }
.mechili-loadout .lo-stat .k {
    color: ${INK_MUTED};
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 10px;
}
.mechili-loadout .lo-stat .v {
    color: ${INK_RUST};
    font-weight: bold;
    font-variant-numeric: tabular-nums;
}

/* Stats collapse toggle — mobile only; desktop has room to show stats
   outright, so it never appears there. */
.mechili-loadout .lo-statstoggle { display: none; }

/* ---- talents ---- */
.mechili-loadout .lo-paneltitle {
    text-align: center;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${u.cream};
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}
.mechili-loadout .lo-techlist {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-height: 0;
    overflow-y: auto;
}
.mechili-loadout .lo-tech {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 11px 8px 9px;
    ${WOOD_BUTTON}
    border-radius: 3px;
    color: ${u.creamMuted};
    font-family: inherit;
    font-size: 13px;
    text-align: start;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}
.mechili-loadout .lo-tech:hover { border-color: #6a6058; color: ${u.cream}; }
/* the chosen talent: pressed in, a brass edge, light lettering */
.mechili-loadout .lo-tech.is-on {
    border-color: ${u.brass};
    color: ${u.cream};
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(184, 146, 74, 0.35);
}
.mechili-loadout .lo-tico {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    font-size: 0;
}
.mechili-loadout .lo-tech:not(.is-on) .lo-tico { opacity: 0.55; }
.mechili-loadout .lo-tname {
    flex: 1;
    font-weight: bold;
    letter-spacing: 0.5px;
    min-width: 0;
}
.mechili-loadout .lo-tcost {
    flex: 0 0 auto;
    color: ${u.brassLight};
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
}

/* ---- chosen slots ---- */
.mechili-loadout .lo-slots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
}
.mechili-loadout .lo-slot {
    width: 46px;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #4a3422 0%, #33231a 55%, #1f150c 100%);
    border: 1.5px solid ${u.brass};
    border-radius: 3px;
    /* REQUIRED, not cosmetic: mask icons tint with background-color:
       currentColor, and a button does not inherit color — the UA stylesheet
       sets it to black, so the icon renders black without this. */
    color: ${u.cream};
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease;
}
.mechili-loadout .lo-slot:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
/* an unfilled slot is a placeholder, not a control */
.mechili-loadout .lo-slot.is-empty {
    background: linear-gradient(180deg, #1c130b 0%, #24190f 100%);
    border: 1.5px dashed #4a423b;
    cursor: default;
}
.mechili-loadout .lo-sico { width: 26px; height: 26px; font-size: 0; }

/* ---- corner buttons ---- */
.mechili-loadout .lo-cornerbtn {
    padding: 9px 18px;
    ${WOOD_BUTTON}
    border-radius: 3px;
    font-family: inherit;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
}
.mechili-loadout .lo-cornerbtn:hover {
    border-color: #6a6058;
    color: ${u.brassLight};
    transform: translateY(-1px);
}

/* ---- mobile / narrow ----
   Panels flow from the TOP — switcher, then talents and slots — while the
   stage stays absolutely positioned behind everything, so it never pushes
   anything down (that was the bug when the stage was a flow item: the
   talent list could start near the bottom of the screen). Whatever height
   the panels do not use is left at the BOTTOM, which is where the model
   shows through. */
@media (max-width: 860px) {
    .mechili-loadout {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: calc(10px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right))
            calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));
        box-sizing: border-box;
    }
    .mechili-loadout .lo-left,
    .mechili-loadout .lo-right {
        position: static;
        inset: auto;
        width: auto;
    }
    .mechili-loadout .lo-left {
        order: 1;
        flex: 0 0 auto;
        gap: 6px;
        /* keep clear of the corner buttons, which stay pinned inline-end */
        padding-inline-end: 104px;
    }
    .mechili-loadout .lo-corner {
        top: calc(10px + env(safe-area-inset-top));
        inset-inline-end: calc(10px + env(safe-area-inset-right));
        bottom: auto;
        flex-direction: column;
        gap: 6px;
    }
    .mechili-loadout .lo-switcher { width: auto; max-width: none; }
    .mechili-loadout .lo-unitname { font-size: 20px; text-align: start; }
    .mechili-loadout .lo-statstoggle {
        display: block;
        width: 100%;
        padding: 6px 10px;
        ${WOOD_BUTTON}
        border-radius: 3px;
        color: ${u.creamMuted};
        font-family: inherit;
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 1px;
        text-transform: uppercase;
        cursor: pointer;
    }
    /* collapsed by default — only the toggle expands it */
    .mechili-loadout .lo-stats {
        display: none;
        grid-template-columns: 1fr 1fr;
    }
    .mechili-loadout.is-statsopen .lo-stats { display: grid; }
    /* the 2-column grid makes the per-row bottom border look like a ladder;
       dropping it on the last pair reads cleanly in both columns */
    .mechili-loadout .lo-stats .lo-stat:nth-last-child(-n + 2) { border-bottom: none; }
    /* talents sit directly under the switcher; the cap is what reserves the
       bottom of the screen for the model */
    .mechili-loadout .lo-right {
        order: 2;
        flex: 0 1 auto;
        min-height: 0;
        max-height: 56vh;
    }
    .mechili-loadout .lo-slots { justify-content: center; }
}
/* Short viewports (laptop windows, phones in landscape). Nothing is hidden
   any more — the panels OVERLAY the stage rather than sharing height with
   it, so a short window costs the model no space. The panels just have to
   stay inside the screen. */
@media (max-height: 700px) {
    .mechili-loadout .lo-right { max-height: calc(100% - 64px); }
}
/* touch: the switcher arrows and corner buttons need real tap targets */
@media (pointer: coarse) {
    .mechili-loadout .lo-arrow {
        min-width: 44px;
        min-height: 44px;
        font-size: 20px;
    }
    .mechili-loadout .lo-cornerbtn { min-height: 44px; }
    .mechili-loadout .lo-statstoggle { min-height: 40px; }
    .mechili-loadout .lo-tech { padding-top: 11px; padding-bottom: 11px; }
    .mechili-loadout .lo-slot { width: 48px; height: 48px; }
}
/* card-style team-size / Horde toggles (Single Player) — same visual
   language as .m-btn, built on real radio/checkbox inputs (hidden, not
   removed) so the existing :checked-based JS needs no changes at all */
.mechili-menu .m-toggle-row { display: flex; gap: 10px; width: 100%; }
/* four entries: two rows of two */
.mechili-menu .m-toggle-row.m-toggle-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mechili-menu .m-toggle-card {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* .m-btn sets text-align:start for the icon+label ROW buttons. A card
       stacks instead, and align-items only centers a label that fits on one
       line — without this, a wrapped label goes left. */
    text-align: center;
    gap: 4px;
    box-sizing: border-box;
    padding: 14px 10px;
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #4a3422 0%, #33231a 55%, #1f150c 100%);
    border: 1.5px solid #3a342e;
    border-radius: 4px;
    color: ${u.cream};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 230, 180, 0.12),
        inset 0 -2px 4px rgba(0, 0, 0, 0.4);
    transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease,
        background 0.14s ease, color 0.14s ease;
}
.mechili-menu .m-toggle-card input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
}
/* card labels may carry an explicit newline (e.g. the number over the name) */
.mechili-menu .m-toggle-card .m-label { white-space: pre-line; }
.mechili-menu .m-toggle-card .m-ico {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
.mechili-menu .m-toggle-card .m-ico.m-icon {
    width: 20px;
    height: 20px;
    font-size: 0;
    line-height: 0;
}
.mechili-menu .m-toggle-card:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-2px); }
.mechili-menu .m-toggle-card:has(input:checked) {
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border-color: ${u.brassLight};
    color: #20180a;
    box-shadow: 0 4px 14px rgba(184, 146, 74, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.mechili-menu .m-toggle-card:has(input:checked) .m-ico { filter: none; }
.mechili-menu .m-toggle-card:has(input:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
.mechili-menu .m-toggle-pill {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}
.mechili-menu .m-toggle-pill input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    pointer-events: none;
}
.mechili-menu .m-toggle-pill:hover { border-color: ${u.hover}; }
.mechili-menu .m-toggle-pill:has(input:checked) {
    background: linear-gradient(180deg, rgba(184, 146, 74, 0.22), rgba(184, 146, 74, 0.14));
    border-color: ${u.brassLight};
    color: ${u.brassLight};
}
.mechili-menu .m-toggle-pill:has(input:focus-visible) {
    outline: none;
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
/* Custom Game screen: mode toggle reuses m-toggle-row/card above; these are
   just the timer/horde/roundcards form rows */
.mechili-menu .m-custom { align-items: stretch; gap: 14px; }
.mechili-menu .m-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px 14px; width: 100%; }
.mechili-menu .m-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.5px;
    color: ${u.textMuted};
    text-transform: uppercase;
}
.mechili-menu .m-field input[type="number"],
.mechili-menu .m-field select {
    box-sizing: border-box;
    width: 100%;
    padding: 10px 12px;
    background: rgba(28, 22, 16, 0.85);
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-size: 14px;
    font-weight: normal;
    text-transform: none;
    letter-spacing: normal;
}
.mechili-menu .m-field input[type="number"]:focus,
.mechili-menu .m-field select:focus {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.3);
}
.mechili-menu .m-field input[type="checkbox"] { width: 16px; height: 16px; accent-color: ${u.brass}; }
.mechili-menu .m-seats { display: flex; gap: 10px; width: 100%; }
.mechili-menu .m-seat {
    flex: 1;
    box-sizing: border-box;
    padding: 14px 10px;
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 0.5px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    color: ${u.text};
}
.mechili-menu .m-seat-you { color: ${u.brassLight}; }
.mechili-menu .m-roster-table {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: none;
}
.mechili-menu .m-roster-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    align-items: center;
}
.mechili-menu .m-roster-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mechili-menu .m-roster-col-header {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    text-align: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}
/* Canonical team colors (side a = blue, side b = red) — lightened for dark panel. */
.mechili-menu .m-roster-col-a .m-roster-col-header { color: #8ec8f8; }
.mechili-menu .m-roster-col-b .m-roster-col-header { color: #ff8a7a; }
.mechili-menu .m-roster-vs {
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: lowercase;
    color: ${u.brassLight};
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    padding: 0 2px;
    user-select: none;
}
.mechili-menu .m-roster-seat {
    box-sizing: border-box;
    padding: 8px 10px;
    min-height: 36px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    text-align: start;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 0.2px;
    border-radius: 3px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    color: ${u.text};
}
.mechili-menu .m-roster-seat:has(.m-roster-tags) { flex-wrap: wrap; row-gap: 4px; }
/* the player's face and MMR beside the name */
.mechili-menu .m-roster-avatar {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid ${u.border};
}
.mechili-menu .m-roster-avatar img { width: 100%; height: 100%; object-fit: cover; }
.mechili-menu .m-roster-avatar-ico { width: 14px; height: 14px; }
.mechili-menu .m-roster-mmr { flex: none; font-weight: normal; font-size: 12px; color: ${u.textMuted}; }
/* the seat's army / role chips: their own line under the name, the name keeps the full width */
.mechili-menu .m-roster-tags {
    order: 10;
    flex: 0 0 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 4px;
    font-style: normal;
}
.mechili-menu .m-roster-seat-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-menu .m-roster-seat.filled.you { border-color: ${u.brassLight}; color: ${u.brassLight}; }
.mechili-menu .m-roster-seat.filled:not(.you) { border-color: ${u.hpBar}; }
.mechili-menu .m-roster-seat.empty { border-style: dashed; color: ${u.textMuted}; font-weight: normal; }
.mechili-menu .m-roster-seat.ai { border-color: ${u.speedBg}; color: ${u.textMuted}; font-style: italic; }
/* the "+" on a still-open seat — mirrors the kick button opposite it, in
   brass rather than undo red: one adds a player, the other removes one */
.mechili-menu .m-roster-seat.invitable { cursor: pointer; }
.mechili-menu .m-roster-invite {
    flex: none;
    width: 18px;
    height: 18px;
    line-height: 16px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid ${u.border};
    background: none;
    color: ${u.brass};
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease;
}
.mechili-menu .m-roster-invite:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-menu .m-roster-invite:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35); }
.mechili-menu .m-roster-kick {
    flex: none;
    width: 18px;
    height: 18px;
    line-height: 16px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid ${u.undoBorder};
    background: ${u.undoBg};
    color: ${u.undoText};
    font-size: 13px;
    font-weight: bold;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
}
.mechili-menu .m-roster-kick:hover { border-color: ${u.hover}; background: ${u.undoHover}; }
.mechili-menu .m-roster-role {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid ${u.border};
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 0.3px;
    color: ${u.textMuted};
    white-space: nowrap;
}
.mechili-menu .m-roster-role.is-attacker { border-color: #d8643f; color: #f0a184; }
.mechili-menu .m-roster-role.is-defender { border-color: #5d97c9; color: #9cc3e4; }
.mechili-menu .m-roster-role.is-editable { cursor: pointer; background: rgba(0, 0, 0, 0.25); }
.mechili-menu .m-roster-role.is-editable:hover { border-color: ${u.brassLight}; color: ${u.brassLight}; }
/* the seat's army — a chip; where this client may change it, a button that walks the armies */
.mechili-menu .m-roster-army {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid ${u.border};
    background: rgba(0, 0, 0, 0.25);
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 0.3px;
    color: ${u.textMuted};
    white-space: nowrap;
}
.mechili-menu .m-roster-army.is-komtur { border-color: #8f6bc4; color: #c9b0ef; }
.mechili-menu .m-roster-army.is-editable { cursor: pointer; }
.mechili-menu .m-roster-army.is-editable:hover { border-color: ${u.brassLight}; color: ${u.brassLight}; }
.mechili-menu .m-lobby-role-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: bold;
    color: ${u.text};
}
.mechili-menu .m-lobby-role-label { margin-inline-end: 4px; }
.mechili-menu .m-lobby-role {
    font: inherit;
    font-size: 13px;
    padding: 4px 12px;
    border: 1.5px solid ${u.border};
    border-radius: 999px;
    background: ${u.panelBgDark};
    color: ${u.text};
    cursor: pointer;
}
.mechili-menu .m-lobby-role:hover { border-color: ${u.hover}; }
.mechili-menu .m-lobby-role.active { border-color: ${u.brassLight}; color: ${u.brassLight}; box-shadow: 0 0 0 2px rgba(212, 184, 120, 0.2); }
.mechili-menu .m-lobby-role[data-role="attacker"].active { border-color: #d8643f; color: #f0a184; }
.mechili-menu .m-lobby-role[data-role="defender"].active { border-color: #5d97c9; color: #9cc3e4; }
.mechili-menu .m-roster-ready {
    flex: none;
    color: ${u.hpBar};
    font-weight: bold;
    font-size: 13px;
}
.mechili-menu .m-lobby-settings-toggle {
    background: none;
    border: none;
    padding: 2px 0;
    width: auto;
    align-self: flex-start;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.3px;
    color: ${u.textMuted};
    cursor: pointer;
    transition: color 0.12s ease;
}
.mechili-menu .m-lobby-settings-toggle:hover { color: ${u.brassLight}; }
.mechili-menu .m-lobby-settings {
    display: none;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
    width: 100%;
    padding: 12px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    box-sizing: border-box;
}
.mechili-menu .m-session.m-lobby-settings-open .m-lobby-settings { display: grid; }
/* the match's basics (players, mode, victory, waves) stay in view; only the rest folds away.
   Both stand on the parchment, no dark box: the basics two to a row under the two team
   columns (the gap is the teams' "vs" column) */
.mechili-menu .m-session.m-has-lobby-settings .m-lobby-basic { display: grid; }
.mechili-menu .m-lobby-settings {
    background: none;
    border: none;
    padding: 0;
}
.mechili-menu :is(.m-lobby-basic, .m-lobby-advanced) {
    /* four settings to a row: the basics, and the advanced ones under them */
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: 10px;
    row-gap: 8px;
}
/* phones: two to a row */
@media (max-width: 719px) {
    .mechili-menu :is(.m-lobby-basic, .m-lobby-advanced) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* Back on the left, Start on the right, across the room's full width */
.mechili-menu .m-lobby-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
}
.mechili-menu .m-lobby-footer > .m-cancel { flex: none; width: auto; align-self: center; }
.mechili-menu .m-lobby-footer > [data-mode="startstar"] {
    flex: 1;
    width: auto;
    max-width: 60%;
    margin-inline-start: auto;
    justify-content: center;
    padding: 12px 18px;
    font-size: 15px;
}
.mechili-menu .m-lobby-settings .m-field { min-width: 0; }
.mechili-menu .m-lobby-settings .m-field[hidden] { display: none; }
/* a room setting off its default: a brass box, so a changed match reads at a glance */
.mechili-menu .m-lobby-settings select.is-changed {
    /* a setting off its default: tinted brass, so a changed match reads at a glance */
    background: linear-gradient(180deg, #6a4f22 0%, #4a3616 100%);
    border: 2px solid ${u.brassLight};
    color: #ffe7b0;
    font-weight: bold;
    box-shadow: 0 0 0 1px rgba(212, 184, 120, 0.35), 0 0 10px rgba(212, 184, 120, 0.35);
}
/* the advanced toggle on the left, Reset on the right */
.mechili-menu .m-lobby-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.mechili-menu .m-lobby-settings-reset {
    grid-column: 1 / -1;
    justify-self: start;
    margin: 2px 0 0;
    padding: 2px 0;
    width: auto;
    background: none;
    border: none;
    border-radius: 0;
    color: ${u.textMuted};
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: color 0.12s ease;
}
.mechili-menu .m-lobby-settings-reset:hover:not(:disabled) {
    color: ${u.brassLight};
}
.mechili-menu .m-lobby-settings-reset:disabled,
.mechili-menu .m-lobby-settings.m-readonly .m-lobby-settings-reset,
.mechili-menu .m-lobby-settings-reset[hidden] {
    display: none;
}
.mechili-menu .m-session-layout {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: 100%;
}
.mechili-menu .m-session-primary {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    min-width: 0;
}
.mechili-menu .m-lobby-settings select:disabled {
    opacity: 0.85;
    pointer-events: none;
    cursor: inherit;
}
.mechili-menu .m-lobby-settings.m-readonly .m-field {
    cursor: help;
}
.mechili-menu .m-lobby-settings.m-readonly .m-field:hover select:disabled,
.mechili-menu .m-lobby-settings.m-readonly .m-field:active select:disabled {
    border-color: ${u.brassLight};
}
.m-lobby-setting-tip {
    position: fixed;
    z-index: 80;
    max-width: min(320px, calc(100vw - 24px));
    padding: 10px 12px;
    background: linear-gradient(180deg, rgba(44, 36, 28, 0.97), rgba(22, 18, 14, 0.97));
    border: 1.5px solid ${u.brass};
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    color: ${u.text};
    font-size: 13px;
    line-height: 1.45;
    pointer-events: none;
    user-select: none;
}
.m-lobby-setting-tip.sticky {
    pointer-events: auto;
}
.mechili-menu .m-lobby-ready-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 0.3px;
    text-transform: none;
    color: ${u.text};
    cursor: pointer;
}
/* Desktop lobby: one column — seats, the basics, the advanced settings folded
   under them, Back / Start — wide enough for four settings to a row, and the
   same width open or closed (nothing jumps) */
@media (min-width: 720px) {
    .mechili-menu:has(.m-session.is-active) {
        width: min(440px, 92vw);
    }
    .mechili-menu:has(.m-session.is-active.m-has-lobby-settings) {
        width: min(760px, 94vw);
    }
}
/* Narrow / single-column lobby: use more horizontal room so advanced
   settings (2-col selects) and the main button stack aren't tiny. */
/* Phone / narrow: submenu sheets go edge-to-edge; the root main menu
   stays a floating console. Corner chrome + lobby chat stay above. */
@media (max-width: 719px) {
    html .mechili-menu:has([data-view="main"].is-active) {
        width: min(92vw, 420px);
    }
    html .mechili-menu:not(:has([data-view="main"].is-active)) {
        position: absolute;
        inset: 0;
        left: 0;
        top: 0;
        transform: none;
        width: auto;
        max-width: none;
        height: auto;
        max-height: none;
        border-radius: 0;
        border: none;
        box-shadow: none;
        gap: 10px;
        overflow: hidden;
        padding:
            max(56px, calc(10px + env(safe-area-inset-top) + 44px))
            max(16px, env(safe-area-inset-right))
            max(64px, calc(14px + env(safe-area-inset-bottom) + 48px))
            max(16px, env(safe-area-inset-left));
    }
    .mechili-menu:not(:has([data-view="main"].is-active))::before {
        left: 16px;
        right: 16px;
    }
    .mechili-menu:not(:has([data-view="main"].is-active)) .m-view.is-active {
        flex: 1;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    .mechili-menu:not(:has([data-view="main"].is-active)) .m-room-list,
    .mechili-menu:not(:has([data-view="main"].is-active)) .m-scenario-list {
        max-height: none;
        flex: 1;
        min-height: 120px;
    }
    .mechili-corner-actions,
    .mechili-username,
    .mechili-loadout-btn,
    .mechili-lobby-chat {
        z-index: 35;
    }
    .mechili-lobby-chat {
        width: min(420px, calc(100vw - 24px));
    }
}
.mechili-menu .m-lobby-ready-check { width: 18px; height: 18px; accent-color: ${u.brass}; cursor: pointer; }
button.m-seat-invite {
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
}
button.m-seat-invite:hover:not(:disabled) { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
button.m-seat-invite:disabled { opacity: 0.7; cursor: default; }
.mechili-menu .m-mm-link {
    font-size: 12.5px;
    color: ${u.textMuted};
    text-align: center;
    word-break: break-all;
    padding: 8px 10px;
    background: rgba(20, 16, 12, 0.75);
    border: 1px solid ${u.border};
    border-radius: 3px;
}
.mechili-username {
    position: absolute;
    inset-inline-end: calc(16px + env(safe-area-inset-right));
    bottom: calc(14px + env(safe-area-inset-bottom));
    padding: 6px 12px 6px 8px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease;
    display: flex;
    align-items: center;
    gap: 8px;
}
/* Shared round player avatar (menu chip + name-edit preview; matches fightbar) */
.mechili-username .u-avatar,
.mechili-name-edit .avatar-preview {
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background:
        radial-gradient(circle at 35% 28%, rgba(255, 230, 180, 0.2), transparent 55%),
        linear-gradient(165deg, ${u.leatherHi}, ${u.leather});
    border: 1.5px solid ${u.frameMid};
    box-shadow:
        0 0 0 1px ${u.frameLo},
        0 0 0 2px ${u.frameHi},
        inset 0 1px 2px rgba(255, 230, 180, 0.2),
        0 2px 6px rgba(0, 0, 0, 0.35);
}
.mechili-username .u-avatar {
    width: 36px;
    height: 36px;
}
.mechili-username .u-avatar[hidden] { display: none; }
/* Wide screens only: a Loadout chip stacked above the username one, wearing
   the same .mechili-username styling. Dropped under the breakpoint, where
   the corner is already crowded and the profile dialog's own "Unit loadout"
   button is the route. The 60px offset clears the username chip (6px
   padding + 36px avatar + borders, plus a gap); it is deliberately
   generous, so a chip without an avatar just sits a little higher. */
/* bottom-right corner: the loadout button over the username, one column, same width */
.mechili-corner-stack {
    position: absolute;
    inset-inline-end: calc(16px + env(safe-area-inset-right));
    bottom: calc(14px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    pointer-events: none;
}
.mechili-corner-stack .mechili-username {
    position: static;
    pointer-events: auto;
}
.mechili-loadout-btn {
    display: flex;
    justify-content: center;
}
@media (max-width: 720px) {
    .mechili-loadout-btn { display: none; }
}
.mechili-username:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-username:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.3); }

/* Single container for every piece of menu chrome (see menuChromeEl in
   main.ts). Full-bleed so its absolutely-positioned children keep the exact
   containing block they had as siblings of the wrapper, but transparent to
   the pointer so it cannot swallow clicks meant for the 3D scene behind it;
   the children opt back in. No z-index on purpose: that would create a
   stacking context and trap children that currently compete globally. */
.mechili-menu-chrome {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.mechili-menu-chrome > * { pointer-events: auto; }

/* Menu chrome: door (Electron quit) + settings gear — inline-end follows reading dir */
.mechili-corner-actions {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    inset-inline-end: calc(16px + env(safe-area-inset-right));
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 4px;
}
.mechili-exit-btn,
.mechili-settings-btn {
    background: none;
    border: none;
    color: ${u.text};
    padding: 0;
    width: 44px;
    height: 44px;
    font-size: 0;
    line-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    transition: transform 0.2s ease, color 0.2s ease;
}
.mechili-exit-btn .m-icon {
    width: 34px;
    height: 34px;
    display: block;
}
.mechili-settings-btn .m-icon {
    width: 44px;
    height: 44px;
    font-size: 0;
}
.mechili-exit-btn:hover { color: ${u.brassLight}; transform: translateX(2px); }
:dir(rtl) .mechili-exit-btn:hover { transform: translateX(-2px); }
.mechili-settings-btn:hover { color: ${u.brassLight}; transform: rotate(45deg); }
.mechili-exit-btn:focus-visible,
.mechili-settings-btn:focus-visible {
    outline: none;
    color: ${u.brassLight};
}
@media (pointer: coarse) {
    .mechili-exit-btn,
    .mechili-settings-btn {
        width: 32px;
        height: 32px;
    }
    .mechili-exit-btn .m-icon {
        width: 24px;
        height: 24px;
    }
    .mechili-settings-btn .m-icon {
        width: 32px;
        height: 32px;
    }
}

/* watch-mode-only jump/speed controls — top-right, deliberately NOT
   top-center: the round/phase/timer readout (.mechili-topbar) already lives
   there and this panel used to sit directly on top of it, hiding the one
   piece of info (time left in the round) replay viewers actually want */
.mechili-replay-controls {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    inset-inline-end: calc(16px + env(safe-area-inset-right));
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    font-size: 13px;
    color: ${u.text};
}
.mechili-replay-controls .rc-row { display: flex; align-items: center; gap: 8px; }
.mechili-replay-controls label { display: flex; align-items: center; gap: 4px; }
.mechili-replay-controls input, .mechili-replay-controls select {
    font: inherit;
    padding: 3px 6px;
    border: 1px solid ${u.border};
    border-radius: 4px;
    background: #1e1b15;
    color: ${u.text};
}
.mechili-replay-controls input.rc-round { width: 4.5em; }
.mechili-replay-controls button {
    font: inherit;
    padding: 4px 10px;
    border: 1.5px solid ${u.border};
    border-radius: 6px;
    background: ${u.panelBgDark};
    color: ${u.text};
    cursor: pointer;
}
.mechili-replay-controls button:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-replay-controls .rc-speed-hint { font-size: 11px; color: ${u.textMuted}; white-space: nowrap; }

/* scenario editor (author mode) — a floating window; drag it by its head */
.mechili-scenario-editor {
    position: absolute;
    top: calc(64px + env(safe-area-inset-top));
    left: calc(12px + env(safe-area-inset-left));
    z-index: 40;
    width: min(270px, calc(100vw - 24px));
    max-height: min(64vh, calc(100vh - 80px));
    display: flex;
    flex-direction: column;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    font-size: 13px;
    color: ${u.text};
    pointer-events: auto;
}
.mechili-scenario-editor .se-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    cursor: move;
    user-select: none;
    border-bottom: 1px solid rgba(138, 109, 74, 0.35);
}
.mechili-scenario-editor.collapsed .se-head { border-bottom: none; }
.mechili-scenario-editor.collapsed .se-body { display: none; }
.mechili-scenario-editor .se-body { overflow-y: auto; padding: 0 10px 8px; display: flex; flex-direction: column; gap: 6px; }
.mechili-scenario-editor .se-title { font-size: 14px; font-weight: 700; color: ${u.brassLight}; }
.mechili-scenario-editor .se-muted, .mechili-scenario-editor .se-hint { color: ${u.textMuted}; font-size: 11px; }
.mechili-scenario-editor .se-label { color: ${u.textMuted}; font-size: 11px; margin-top: 4px; }
.mechili-scenario-editor .se-section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid rgba(138, 109, 74, 0.35); padding-top: 7px; }
.mechili-scenario-editor .se-body > .se-section:first-child { border-top: none; }
.mechili-scenario-editor .se-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.mechili-scenario-editor input, .mechili-scenario-editor select {
    font: inherit;
    padding: 3px 6px;
    border: 1px solid ${u.border};
    border-radius: 4px;
    background: #1e1b15;
    color: ${u.text};
}
.mechili-scenario-editor input[type='checkbox'] { padding: 0; }
.mechili-scenario-editor .se-name { width: 100%; box-sizing: border-box; }
.mechili-scenario-editor label { display: inline-flex; align-items: center; gap: 4px; }
.mechili-scenario-editor button, .mechili-test-battle button {
    font: inherit;
    padding: 3px 8px;
    border: 1.5px solid ${u.border};
    border-radius: 6px;
    background: ${u.panelBgDark};
    color: ${u.text};
    cursor: pointer;
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mechili-scenario-editor button:hover:not(:disabled), .mechili-test-battle button:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-scenario-editor button:disabled { opacity: 0.45; cursor: default; }
.mechili-scenario-editor button.active { border-color: ${u.brassLight}; background: rgba(212, 184, 120, 0.18); color: ${u.brassLight}; }
/* Terrain tool: the terrain editor's panel inside the window */
.mechili-scenario-editor .te-panel { display: flex; flex-direction: column; gap: 5px; }
.mechili-scenario-editor .te-tool {
    padding: 3px 7px;
    border: 1.5px solid ${u.border};
    border-radius: 6px;
    background: ${u.panelBgDark};
    color: ${u.text};
    cursor: pointer;
    white-space: nowrap;
}
.mechili-scenario-editor .te-tool:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-scenario-editor .te-tool.active { border-color: ${u.brassLight}; background: rgba(212, 184, 120, 0.18); color: ${u.brassLight}; }
.mechili-scenario-editor .te-panel kbd { font: 10px/1 ui-monospace, monospace; opacity: 0.6; }
.mechili-scenario-editor .te-panel .slot-tags { font: 700 10px/1 ui-monospace, monospace; color: ${u.brassLight}; letter-spacing: 0.05em; }
.mechili-scenario-editor .te-panel .slot-tags:empty { display: none; }
.mechili-scenario-editor .te-sliders { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 12px; }
.mechili-scenario-editor .te-sliders input[type='range'] { width: 100%; }
.mechili-scenario-editor .te-status { min-height: 1em; font-size: 11px; color: ${u.brassLight}; }
.mechili-scenario-editor .se-collapse { padding: 0 6px; border: none; background: none; font-size: 14px; }
.mechili-scenario-editor .se-sel-name { font-weight: 600; }
.mechili-scenario-editor .se-level { min-width: 1.6em; text-align: center; font-weight: 700; }
/* the editor shop's tabs (Units · Horde · Buildings), between the header and the grid */
.mechili-shop .shop-tabs { display: flex; gap: 4px; margin: 2px 0 6px; }
.mechili-shop .shop-tab {
    flex: 1;
    padding: 4px 6px;
    border-radius: 3px;
    ${WOOD_BUTTON}
    color: ${u.creamMuted};
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}
.mechili-shop .shop-tab:hover { border-color: #6a6058; color: ${u.brassLight}; }
/* the open tab: pressed in, brass lettering */
.mechili-shop .shop-tab.active {
    border-color: #6a6058;
    color: ${u.brassLight};
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6);
}
/* the editor's Erase tool: a delete cursor over the board (red disc, white ✕, hotspot centred) */
.mechili-erase-cursor {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%23c0392b' stroke='white' stroke-width='2'/%3E%3Cpath d='M8 8l8 8M16 8l-8 8' stroke='white' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E") 12 12, not-allowed;
}
/* the editor's side switch in the top bar, under End Deployment */
.mechili-topbar .editor-side {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    ${WOOD_BUTTON}
    border: 1.5px solid var(--es-team, #3a342e);
    border-radius: 3px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    pointer-events: auto;
}
.mechili-topbar .editor-side:hover { filter: brightness(1.12); }
.mechili-topbar .editor-side .es-now { color: var(--es-team, ${u.text}); font-weight: 700; }
.mechili-topbar .editor-side .es-arrow { color: ${u.textMuted}; }
.mechili-topbar .editor-side .es-other { color: ${u.textMuted}; }
/* footer: always visible at the bottom of the scrolling body — history, the test, saving */
.mechili-scenario-editor .se-footer {
    position: sticky;
    bottom: -8px;
    margin: 2px -10px -8px;
    padding: 7px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: ${u.panelBgDark};
    border-top: 1px solid rgba(138, 109, 74, 0.55);
    z-index: 1;
}
.mechili-scenario-editor .se-save-into { flex: 1; text-align: center; }

    border: 1.5px solid ${u.border};
    border-radius: 6px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}
.mechili-scenario-editor .se-issues { font-size: 12px; color: #e8b04a; cursor: help; }
.mechili-scenario-editor .se-issues.error { color: #ff7a60; }
.mechili-scenario-editor .se-status { min-height: 1.2em; color: ${u.brassLight}; }
.mechili-scenario-editor .se-rules > summary { cursor: pointer; font-weight: 600; color: ${u.brassLight}; }
.mechili-scenario-editor .se-rules-grid { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
.mechili-scenario-editor .se-rule { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px; }
.mechili-scenario-editor .se-rule > span { flex: 1 1 100%; color: ${u.textMuted}; font-size: 11px; }
.mechili-scenario-editor .se-rule input[type='number'] { width: 5.5em; }
.mechili-scenario-editor .se-rule input[type='text'] { flex: 1; min-width: 0; }
.mechili-scenario-editor .se-rule select { flex: 1; min-width: 0; }
.mechili-scenario-editor .se-rule input[type='checkbox'] { margin-inline-start: auto; }
.mechili-scenario-editor .se-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 6px; font-size: 12px; }

/* scenario editor test battle strip */
.mechili-test-battle {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    inset-inline-start: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: calc(100vw - 32px);
    padding: 8px 12px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    font-size: 13px;
    color: ${u.text};
    pointer-events: auto;
}
.mechili-test-battle .tb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mechili-test-battle .tb-title { font-weight: 700; color: ${u.brassLight}; }
.mechili-test-battle .tb-headline { font-size: 16px; font-weight: 700; }
.mechili-test-battle .tb-side { border-inline-start: 4px solid var(--se-team); padding-inline-start: 6px; }
.mechili-test-battle:not(.done) .tb-result { display: none; }
.mechili-test-battle.done .tb-skip { display: none; }
.mechili-test-battle .tb-earlier-head { margin-top: 4px; font-size: 11px; color: ${u.textMuted}; }
.mechili-test-battle .tb-earlier { font-size: 12px; color: ${u.text}; }
.mechili-test-battle .tb-earlier.other { color: ${u.textMuted}; font-style: italic; }

/* suggest chip, inline-start of the main menu (same feel as username) */
.mechili-suggest-btn {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    inset-inline-start: calc(16px + env(safe-area-inset-left));
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 4px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    user-select: none;
    z-index: 30;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.mechili-suggest-btn::before { content: '✦ '; color: ${u.brass}; opacity: 0.9; }
.mechili-suggest-btn:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-suggest-btn:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.3); }

.mechili-username.has-avatar::before { display: none; }
.mechili-username::before { content: '◆ '; color: ${u.brass}; opacity: 0.8; }
.mechili-version {
    position: absolute;
    inset-inline-start: calc(16px + env(safe-area-inset-left));
    bottom: calc(14px + env(safe-area-inset-bottom));
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    color: ${u.textMuted};
    font-size: 12px;
    letter-spacing: 0.4px;
    opacity: 0.85;
    pointer-events: none;
    user-select: none;
    text-decoration: none;
    z-index: 30;
}
/* Sits above the menu panel (z 30) — positioned from layoutTitle in canvas px.
   font-size is set there too, so it tracks the logo's responsive width. */
.mechili-playtest {
    position: absolute;
    transform: translate(-50%, 0);
    color: ${u.brassLight};
    font-weight: 700;
    letter-spacing: 0.28em;
    text-indent: 0.28em;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75);
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    z-index: 40;
}
.mechili-version.link {
    pointer-events: auto;
    cursor: pointer;
    transition: color 0.12s ease, opacity 0.12s ease;
}
.mechili-version.link:hover { color: ${u.brassLight}; opacity: 1; }
.mechili-version.link:focus-visible { outline: none; color: ${u.brassLight}; opacity: 1; }

/* boot loading — same track/fill look as fightbar HP bars (tune together) */
.mechili-loading {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, 12%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    width: min(520px, calc(100vw - 48px));
    z-index: 35;
    user-select: none;
    pointer-events: none;
}
.mechili-feuerware {
    position: absolute;
    bottom: calc(28px + env(safe-area-inset-bottom));
    right: calc(28px + env(safe-area-inset-right));
    top: auto;
    left: auto;
    width: min(82px, 20vw);
    height: auto;
    opacity: 0.85;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.4));
    z-index: 36;
    pointer-events: none;
    user-select: none;
}
/* menu→match: compositor-thread bg zoom (keeps moving during sync Game boot) */
@keyframes mechili-intro-dive {
    from { transform: translate3d(0, 0, 0) scale3d(1, 1, 1); }
    to { transform: translate3d(0, 0, 0) scale3d(3.5, 3.5, 1); }
}
@keyframes mechili-intro-logo-fade {
    from { opacity: 1; }
    to { opacity: 0; }
}
.mechili-intro-cover {
    position: absolute;
    inset: 0;
    z-index: 9;
    pointer-events: none;
}
.mechili-intro-cover .mechili-intro-menu-bg {
    position: absolute;
    inset: 0;
    /* --zoom-ox / --zoom-oy set per-start in JS */
    transform-origin: var(--zoom-ox, 50%) var(--zoom-oy, 28%);
    transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    pointer-events: none;
    will-change: transform;
}
.mechili-intro-cover.dive .mechili-intro-menu-bg {
    animation: mechili-intro-dive 8s linear forwards;
}
.mechili-intro-cover .mechili-intro-logo {
    position: absolute;
    left: 0;
    top: 0;
    height: auto;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 0 24px rgba(255, 220, 120, 0.35));
    pointer-events: none;
    user-select: none;
    opacity: 1;
    z-index: 1;
}
.mechili-intro-cover.active .mechili-intro-logo {
    opacity: 1;
}
.mechili-intro-cover.dive .mechili-intro-logo {
    /* dissolve as soon as the menu zoom starts — not tied to the 3D handoff */
    animation: mechili-intro-logo-fade 0.55s ease-out forwards;
}
.mechili-intro-cover.dive .mechili-match-roster,
.mechili-intro-cover.dive .mechili-climb-intro {
    /* same beat as the logo — roster/card shouldn't linger through the dive */
    animation: mechili-intro-logo-fade 0.55s ease-out forwards;
}
@keyframes mechili-outro-rise {
    from { transform: translate3d(0, 0, 0) scale3d(3.5, 3.5, 1); }
    to { transform: translate3d(0, 0, 0) scale3d(1, 1, 1); }
}
.mechili-intro-cover.outro .mechili-intro-menu-bg {
    transform: translate3d(0, 0, 0) scale3d(3.5, 3.5, 1);
}
.mechili-intro-cover.outro.active .mechili-intro-menu-bg {
    animation: mechili-outro-rise 0.8s ease-in forwards;
}
.mechili-intro-cover.outro .mechili-intro-logo {
    animation: none;
    opacity: 0;
}
.mechili-intro-cover.outro.active .mechili-intro-logo {
    /* The menu logo is the Pixi sprite; keep the HTML clone hidden to avoid
     * a "double logo" during the fly-out transition. */
    animation: none;
    opacity: 0;
}
/* Campaign level card — same cover slot as the VS roster, simpler. */
.mechili-climb-intro {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 2;
    padding: clamp(24px, 6vh, 64px) 16px;
    box-sizing: border-box;
}
.mechili-climb-intro::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
        radial-gradient(ellipse 70% 55% at 50% 48%, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.38) 48%, rgba(0, 0, 0, 0.55) 100%);
    pointer-events: none;
}
.mechili-climb-intro .ci-frame {
    position: relative;
    z-index: 1;
    text-align: center;
}
.mechili-climb-intro .ci-subtitle {
    margin-top: 14px;
    max-width: min(640px, 86vw);
    margin-inline: auto;
    font-size: clamp(15px, 2vw, 20px);
    line-height: 1.4;
    color: ${u.cream};
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.85);
}
.mechili-climb-intro .ci-title {
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.cream};
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85), 0 0 40px rgba(184, 146, 74, 0.25);
}

/* The Year's progress (ui/yearTally.ts): round marks and the tally — loading
 * card, between-rounds splash, end screen. In menuStyles, which stay injected
 * for the whole session, so the HUD can use them too. */
.year-progress {
    --year-attacker: #d8643f;
    --year-defender: #5d97c9;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(12px, 2.2vh, 20px);
    text-align: center;
}
.year-title {
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.cream};
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85), 0 0 40px rgba(184, 146, 74, 0.25);
}
.year-marks {
    --year-attacker: #d8643f;
    --year-defender: #5d97c9;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: clamp(5px, 1vw, 10px);
    max-width: 92vw;
}
.year-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: clamp(28px, 4.6vw, 44px);
    height: clamp(28px, 4.6vw, 44px);
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid rgba(240, 232, 216, 0.28);
    background: rgba(0, 0, 0, 0.35);
    color: rgba(240, 232, 216, 0.45);
    font-size: clamp(11px, 1.6vw, 15px);
    font-weight: 800;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
    animation: year-mark-in 0.35s ease-out both;
    animation-delay: calc(var(--i, 0) * 45ms);
}
.year-mark.is-attacker { border-color: var(--year-attacker); background: color-mix(in srgb, var(--year-attacker) 78%, #000); color: ${u.cream}; }
.year-mark.is-defender { border-color: var(--year-defender); background: color-mix(in srgb, var(--year-defender) 78%, #000); color: ${u.cream}; }
.year-mark.is-current {
    border-color: ${u.brassLight};
    color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(212, 184, 120, 0.25), 0 0 18px rgba(212, 184, 120, 0.45);
    animation: year-mark-in 0.35s ease-out both, year-mark-pulse 1.6s ease-in-out 0.4s infinite;
}
.year-mark.is-fresh { animation: year-mark-pop 0.7s cubic-bezier(0.2, 1.6, 0.4, 1) 0.25s both; }
/* the final stand: a level Year's deciding round, ringed in brass */
.year-mark.is-final { outline: 2px solid ${u.brassLight}; outline-offset: 2px; }
@keyframes year-mark-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes year-mark-pop { 0% { opacity: 0; transform: scale(2.2); } 100% { opacity: 1; transform: scale(1); } }
@keyframes year-mark-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
@media (prefers-reduced-motion: reduce) {
    .year-mark, .year-mark.is-current, .year-mark.is-fresh { animation: none; }
}
.year-tally {
    --year-attacker: #d8643f;
    --year-defender: #5d97c9;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: clamp(15px, 2vw, 20px);
    color: ${u.cream};
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.85);
}
.year-side { display: inline-flex; align-items: center; gap: 8px; letter-spacing: 0.08em; text-transform: uppercase; }
.year-side b { font-size: 1.6em; font-weight: 900; }
.year-side.is-attacker b { color: var(--year-attacker); }
.year-side.is-defender b { color: var(--year-defender); }
.year-side-name { opacity: 0.85; }
.year-side.is-you .year-side-name { opacity: 1; font-weight: 800; }
.year-you {
    font-size: 0.62em;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid ${u.brassLight};
    color: ${u.brassLight};
    letter-spacing: 0.1em;
}
.year-dash { opacity: 0.6; font-weight: 700; }
.mechili-climb-splash.is-year .year-progress { padding: 0 16px; }

/* Pre-match roster on the intro cover — menuStyles only: the cover runs
 * before Game/Hud boots, so hudStyles() is not injected yet. */
.mechili-match-roster {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 2;
    padding: clamp(24px, 6vh, 64px) 16px;
    box-sizing: border-box;
}
.mechili-match-roster::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
        radial-gradient(ellipse 70% 55% at 50% 48%, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.38) 48%, rgba(0, 0, 0, 0.55) 100%);
    pointer-events: none;
}
.mechili-match-roster .mr-frame {
    position: relative;
    z-index: 1;
    width: min(94vw, 760px);
    padding: clamp(28px, 5vh, 48px) clamp(22px, 5vw, 44px);
    box-sizing: border-box;
    border: none;
    background: transparent;
    box-shadow: none;
    overflow: visible;
}
.mechili-match-roster .mr-bg {
    position: absolute;
    inset: -18% -10%;
    z-index: 0;
    pointer-events: none;
    -webkit-mask-image: radial-gradient(ellipse 68% 54% at 50% 50%, #000 12%, rgba(0, 0, 0, 0.85) 42%, transparent 72%);
    mask-image: radial-gradient(ellipse 68% 54% at 50% 50%, #000 12%, rgba(0, 0, 0, 0.85) 42%, transparent 72%);
}
.mechili-match-roster .mr-bg-core,
.mechili-match-roster .mr-bg-glow {
    position: absolute;
    inset: 0;
    display: block;
}
.mechili-match-roster .mr-bg-core {
    background:
        radial-gradient(ellipse 48% 42% at 50% 48%, rgba(62, 44, 28, 0.88) 0%, transparent 68%),
        radial-gradient(ellipse 72% 58% at 50% 50%, rgba(18, 12, 8, 0.82) 0%, transparent 74%),
        radial-gradient(ellipse 90% 70% at 50% 52%, rgba(6, 4, 3, 0.55) 0%, transparent 78%);
    filter: blur(0.5px);
}
.mechili-match-roster .mr-bg-glow {
    filter: blur(28px);
    opacity: 0.72;
    animation: mechili-roster-aura 4.8s ease-in-out infinite;
}
.mechili-match-roster .mr-bg-glow-player {
    background:
        radial-gradient(ellipse 42% 55% at 22% 48%,
            color-mix(in srgb, var(--mr-player, ${pc}) 55%, transparent) 0%,
            transparent 70%);
}
.mechili-match-roster .mr-bg-glow-enemy {
    background:
        radial-gradient(ellipse 42% 55% at 78% 52%,
            color-mix(in srgb, var(--mr-enemy, ${ec}) 55%, transparent) 0%,
            transparent 70%);
    animation-delay: -2.4s;
}
@keyframes mechili-roster-aura {
    0%, 100% { opacity: 0.58; transform: scale(1); }
    50% { opacity: 0.86; transform: scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-match-roster .mr-bg-glow { animation: none; }
}
.mechili-match-roster .mr-cols {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(18px, 4.5vw, 40px);
}
.mechili-match-roster .mr-vs {
    font-size: clamp(22px, 3.2vw, 32px);
    font-weight: 900;
    letter-spacing: 5px;
    color: ${u.brassLight};
    text-shadow:
        0 0 18px color-mix(in srgb, ${u.brassLight} 35%, transparent),
        0 1px 3px rgba(0, 0, 0, 0.85);
    flex-shrink: 0;
}
.mechili-match-roster .mr-team {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.mechili-match-roster .mr-team-player { text-align: right; align-items: flex-end; }
.mechili-match-roster .mr-team-enemy { text-align: left; align-items: flex-start; }
.mechili-match-roster .mr-player {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 4px;
}
.mechili-match-roster .mr-team-player .mr-player { justify-content: flex-end; }
.mechili-match-roster .mr-team-enemy .mr-player {
    justify-content: flex-start;
    flex-direction: row-reverse; /* name/mmr then portrait on the right */
}
.mechili-match-roster .mr-portrait {
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
.mechili-match-roster .mr-portrait.player { border-color: var(--mr-player, ${pc}); }
.mechili-match-roster .mr-portrait.enemy { border-color: var(--mr-enemy, ${ec}); }
.mechili-match-roster .mr-portrait-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mechili-match-roster .mr-portrait-ph {
    width: 58%;
    height: 58%;
    border-radius: 50%;
    background: ${u.textMuted};
    opacity: 0.35;
}
.mechili-match-roster .mr-info { min-width: 0; }
.mechili-match-roster .mr-name {
    font-size: 16px;
    font-weight: 700;
    color: ${u.cream};
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-match-roster .mr-ai {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-left: 6px;
    opacity: 0.65;
    text-transform: uppercase;
}
.mechili-match-roster .mr-mmr {
    font-size: 19px;
    font-weight: 700;
    color: ${u.brassLight};
    font-variant-numeric: tabular-nums;
    margin-top: 3px;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
}
.mechili-match-roster .mr-mmr.loading {
    opacity: 0.45;
    animation: mechili-roster-pulse 1.1s ease-in-out infinite;
}
@keyframes mechili-roster-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.75; }
}

/* Small screens: compress intro roster so names + MMR fit. */
@media (max-width: 599px), (max-height: 540px) {
    .mechili-match-roster {
        padding: 16px 12px;
    }
    .mechili-match-roster .mr-frame {
        width: min(96vw, 560px);
        padding: 22px 16px;
    }
    .mechili-match-roster .mr-bg {
        inset: -14% -6%;
    }
    .mechili-match-roster .mr-cols {
        gap: 12px;
    }
    .mechili-match-roster .mr-vs {
        font-size: 18px;
        letter-spacing: 3px;
    }
    .mechili-match-roster .mr-team {
        gap: 8px;
    }
    .mechili-match-roster .mr-player {
        gap: 8px;
        padding: 6px 2px;
    }
    .mechili-match-roster .mr-portrait {
        width: 40px;
        height: 40px;
    }
    .mechili-match-roster .mr-name {
        font-size: 13px;
    }
    .mechili-match-roster .mr-ai {
        font-size: 9px;
        margin-left: 5px;
    }
    .mechili-match-roster .mr-mmr {
        font-size: 14px;
        margin-top: 1px;
        letter-spacing: 0.35px;
    }
}
.mechili-loading .load-bar {
    width: 100%;
}
${hpTubeTrack(u, '.mechili-loading .hp-track', '36px')}
${hpTubeFill(
    '.mechili-loading .hp-fill',
    `linear-gradient(180deg, #7ec4f0 0%, ${pc} 42%, #2d6a9e 100%)`,
    { transition: '0.2s ease-out' },
)}
${hpTubeVal('.mechili-loading .hp-val', '16px', 'letter-spacing: 1px;')}
.mechili-loading .load-status {
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${u.textMuted};
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
.mechili-name-edit {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 70;
}
.mechili-name-edit .box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 20px;
    background: ${u.panelBgSolid};
    border: 2px solid ${u.border};
    border-radius: 4px;
    min-width: 280px;
    max-width: min(360px, 92vw);
    max-height: min(88vh, calc(100dvh - 32px));
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    color: ${u.text};
    box-sizing: border-box;
}
.mechili-name-edit .title {
    font-size: 14px;
    font-weight: 600;
    color: ${u.text};
    letter-spacing: 0;
}
.mechili-name-edit input {
    padding: 10px 12px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-size: 15px;
    letter-spacing: 1px;
    width: 100%;
    box-sizing: border-box;
}
.mechili-name-edit .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: ${u.textMuted};
}
.mechili-name-edit .error {
    font-size: 12px;
    color: #e87868;
}
.mechili-name-edit .hint { font-size: 12px; color: ${u.textMuted}; }
.mechili-name-edit .avatar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.mechili-name-edit .avatar-preview {
    width: 72px;
    height: 72px;
}
.mechili-name-edit .avatar-preview[hidden] { display: none; }
.mechili-name-edit .avatar-pick {
    display: inline-flex;
    align-items: center;
    padding: 8px 12px;
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    cursor: pointer;
    color: ${u.text};
    font-size: 13px;
    font-weight: bold;
}
.mechili-name-edit .avatar-pick:hover { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-name-edit .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
/* leaves the dialog rather than committing it — full width, above the
   Cancel/Save pair, so it never reads as a third commit action */
.mechili-name-edit .profile-loadout {
    width: 100%;
    justify-content: center;
    text-align: center;
}
.mechili-name-edit button {
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-weight: bold;
    cursor: pointer;
}
.mechili-name-edit button:disabled { opacity: 0.5; cursor: wait; }
.mechili-name-edit button.primary { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-name-edit button { transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease; }
.mechili-name-edit button:hover:not(:disabled) { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-name-edit button:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35); }
.mechili-name-edit input:focus-visible { outline: none; border-color: ${u.hover}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.25); }

.mechili-settings {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 70;
    padding: 16px;
    box-sizing: border-box;
}
.mechili-settings .box {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px 16px;
    width: min(420px, calc(100vw - 32px));
    max-height: min(88vh, calc(100dvh - 32px));
    overflow: hidden;
    box-sizing: border-box;
}
.mechili-settings .s-title {
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    text-align: center;
    color: ${u.cream};
    padding: 6px 8px 12px;
    margin: 0;
    border-bottom: 1px solid ${u.frameLo};
    box-shadow: 0 1px 0 rgba(255, 220, 160, 0.08);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.mechili-settings .s-tabs {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}
.mechili-settings .s-tab {
    flex: 1;
    padding: 7px 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${u.creamMuted};
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 55%, #181410 100%);
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    cursor: pointer;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.55);
    transition-property: border-color, color, transform;
    transition-duration: 0.18s;
    transition-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
}
.mechili-settings .s-tab:hover {
    border-color: ${u.bronzeLight};
    color: ${u.cream};
    transform: translateY(-1px);
}
.mechili-settings .s-tab:active {
    transform: translateY(0) scale(0.97);
    transition-duration: 0.06s;
    transition-timing-function: ease-out;
}
.mechili-settings .s-tab.active {
    border-color: ${u.bronze};
    color: ${u.bronzeLight};
    box-shadow:
        inset 0 2px 4px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(184, 146, 74, 0.25);
}
.mechili-settings .s-tab:focus-visible {
    outline: none;
    border-color: ${u.bronzeLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
.mechili-settings .s-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    /* room inside the scroll box for a hovered button's lift and the 3px focus ring
       (they were cut off at its edges); the negative margin keeps the layout where it was */
    padding: 4px;
    margin: -4px;
}
.mechili-settings .s-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
}
.mechili-settings .s-panel[hidden] {
    display: none;
}
.mechili-settings .s-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.mechili-settings .s-section-head {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${u.bronzeLight};
}
.mechili-settings .s-presets {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}
.mechili-settings .s-preset {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.4px;
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 55%, #181410 100%);
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    color: ${u.creamMuted};
    cursor: pointer;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.55);
    /* the match UI's button feel: eased hover lift, quick press, a springy release */
    transition-property: border-color, color, transform, box-shadow;
    transition-duration: 0.18s;
    transition-timing-function: cubic-bezier(0.3, 1.6, 0.5, 1);
}
.mechili-settings .s-preset:hover {
    border-color: ${u.bronzeLight};
    color: ${u.cream};
    transform: translateY(-1px);
}
.mechili-settings button.s-preset:active {
    transform: translateY(0) scale(0.97);
    transition-duration: 0.06s;
    transition-timing-function: ease-out;
}
.mechili-settings .s-preset.active {
    border-color: ${u.bronze};
    color: ${u.bronzeLight};
    box-shadow:
        inset 0 2px 4px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(184, 146, 74, 0.25);
}
.mechili-settings .s-preset:focus-visible {
    outline: none;
    border-color: ${u.bronzeLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
/* Reports "your options differ from every preset" — not clickable, so it does
   not pretend to be something you can apply. */
.mechili-settings .s-custom-chip {
    cursor: default;
    opacity: 0.45;
}
.mechili-settings .s-custom-chip:hover {
    border-color: ${u.slotBorder};
    color: ${u.creamMuted};
    transform: none;
}
.mechili-settings .s-custom-chip.active {
    opacity: 1;
    border-color: ${u.bronze};
    color: ${u.bronzeLight};
}
.mechili-settings .s-advanced {
    margin-top: 10px;
    border-top: 1px solid rgba(184, 146, 74, 0.18);
    padding-top: 6px;
}
.mechili-settings .s-advanced > summary {
    cursor: pointer;
    list-style: none;
    padding: 4px 0;
    font-size: 12px;
    letter-spacing: 0.4px;
    color: ${u.creamMuted};
    user-select: none;
}
.mechili-settings .s-advanced > summary::-webkit-details-marker { display: none; }
.mechili-settings .s-advanced > summary::before {
    content: '▸ ';
    color: ${u.bronze};
}
:dir(rtl) .mechili-settings .s-advanced > summary::before { content: '◂ '; }
.mechili-settings .s-advanced[open] > summary::before { content: '▾ '; }
.mechili-settings .s-advanced > summary:hover { color: ${u.cream}; }
.mechili-settings .s-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
    font-size: 13.5px;
    color: ${u.cream};
    cursor: pointer;
    user-select: none;
}
.mechili-settings .s-audio-slider {
    cursor: default;
}
.mechili-settings .s-audio-slider span {
    min-width: 7.5em;
}
.mechili-settings .s-audio-slider input[type="range"] {
    flex: 1;
    min-width: 100px;
    accent-color: ${u.brassLight};
}
.mechili-settings .s-lang-globe {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: ${u.brassLight};
    display: block;
}
.mechili-settings .s-lang-row:hover .s-lang-globe {
    color: ${u.cream};
}
.mechili-settings .s-row select {
    margin-inline-start: auto;
    min-width: 110px;
    background: ${u.leatherMid};
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    color: ${u.cream};
    padding: 4px 6px;
}
.mechili-settings .s-row input { width: 16px; height: 16px; accent-color: ${u.bronze}; }
.mechili-settings .s-hint {
    font-size: 12px;
    color: ${u.creamMuted};
}
.mechili-settings .s-mp-note {
    margin-top: 4px;
}
.mechili-settings .s-hint a {
    color: ${u.brassLight};
    text-decoration: none;
    border-bottom: 1px solid rgba(212, 184, 120, 0.4);
}
.mechili-settings .s-hint a:hover {
    color: ${u.cream};
    border-bottom-color: ${u.cream};
}
.mechili-settings .s-reset {
    padding: 5px 12px;
    font-size: 12px;
    border: 1px solid ${u.bronze};
    border-radius: 6px;
    background: transparent;
    color: ${u.brassLight};
    letter-spacing: 0.06em;
    cursor: pointer;
}
.mechili-settings .s-reset:hover {
    border-color: ${u.brassLight};
    background: rgba(160, 56, 40, 0.18);
}
/* Reset sits far left, away from Close, so the destructive one is never the
   button your hand is already near. */
.mechili-settings .actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.mechili-settings button {
    padding: 8px 16px;
}
.mechili-settings .s-help-btn {
    align-self: flex-start;
    padding: 6px 16px;
    font-size: 13px;
}

.mechili-controls-help {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    background: rgba(0, 0, 0, 0.62);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    z-index: 82;
    padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right))
        max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
    box-sizing: border-box;
}
.mechili-controls-help .ch-box {
    display: flex;
    flex-direction: column;
    width: min(760px, 100%);
    max-height: 100%;
    padding: 14px 16px 12px;
    box-sizing: border-box;
    overflow: hidden;
}
.mechili-controls-help .ch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    padding: 4px 4px 12px;
    border-bottom: 1px solid ${u.frameLo};
    box-shadow: 0 1px 0 rgba(255, 220, 160, 0.08);
}
.mechili-controls-help .ch-title {
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${u.cream};
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.mechili-controls-help .ch-head button { padding: 6px 14px; font-size: 13px; }
.mechili-controls-help .ch-body {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 8px 4px 12px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.mechili-controls-help .ch-section h2 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${u.brassLight};
}
.mechili-controls-help .ch-note {
    margin: 0 0 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: ${u.creamMuted};
}
.mechili-controls-help .ch-row {
    display: grid;
    grid-template-columns: minmax(7.5rem, 34%) 1fr;
    gap: 8px 12px;
    align-items: start;
    padding: 6px 0;
    border-bottom: 1px solid rgba(184, 146, 74, 0.12);
    font-size: 13.5px;
    color: ${u.cream};
}
.mechili-controls-help .ch-keys {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.mechili-controls-help kbd {
    display: inline-block;
    padding: 2px 7px;
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 55%, #181410 100%);
    color: ${u.bronzeLight};
    font: 700 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.02em;
    white-space: nowrap;
}
.mechili-controls-help .ch-desc {
    line-height: 1.4;
    color: ${u.cream};
}
@media (max-width: 519px) {
    .mechili-controls-help .ch-row {
        grid-template-columns: 1fr;
        gap: 4px;
    }
}
.mechili-settings .s-row input:focus-visible { outline: 2px solid ${u.bronze}; outline-offset: 1px; }
/* Phone / narrow: edge-to-edge sheet — more room for tabs + graphics advanced. */
@media (max-width: 719px) {
    .mechili-settings {
        padding: 0;
        align-items: stretch;
        justify-content: stretch;
        background: rgba(0, 0, 0, 0.72);
    }
    .mechili-settings .box {
        width: 100%;
        max-width: none;
        height: 100%;
        max-height: none;
        border-radius: 0;
        border: none;
        box-shadow: none;
        gap: 12px;
        padding:
            max(14px, env(safe-area-inset-top))
            max(16px, env(safe-area-inset-right))
            max(14px, env(safe-area-inset-bottom))
            max(16px, env(safe-area-inset-left));
    }
    .mechili-settings .box::before { display: none; }
    .mechili-settings .s-tab {
        padding: 10px 8px;
        font-size: 11px;
        letter-spacing: 0.08em;
    }
    .mechili-settings .s-row {
        font-size: 14px;
        gap: 10px;
        min-height: 28px;
    }
    .mechili-settings .actions {
        padding-top: 4px;
        flex-shrink: 0;
    }
}
@media (min-width: 720px) {
    .mechili-settings .box {
        width: min(480px, calc(100vw - 48px));
        padding: 22px 24px 18px;
    }
    .mechili-settings .s-title { font-size: 17px; letter-spacing: 0.26em; }
}

/* Shared phone sheet: profile / suggest / pause match settings fullscreen. */
@media (max-width: 719px) {
    .mechili-name-edit,
    .mechili-suggest,
    .mechili-pause {
        padding: 0;
        align-items: stretch;
        justify-content: stretch;
        background: rgba(0, 0, 0, 0.72);
    }
    html .mechili-name-edit .box,
    html .mechili-suggest .box,
    html .mechili-pause .pause-box {
        width: 100%;
        max-width: none;
        min-width: 0;
        height: 100%;
        max-height: none;
        border-radius: 0;
        border: none;
        box-shadow: none;
        gap: 12px;
        padding:
            max(14px, env(safe-area-inset-top))
            max(16px, env(safe-area-inset-right))
            max(14px, env(safe-area-inset-bottom))
            max(16px, env(safe-area-inset-left));
    }
    html .mechili-name-edit .box::before,
    html .mechili-suggest .box::before,
    html .mechili-pause .pause-box::before {
        display: none;
    }
    .mechili-pause .pause-box {
        justify-content: center;
    }
}

/* Community Suggest — shared by game menu / pause / homepage */
.mechili-suggest {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 80;
    padding: 16px;
}
.mechili-suggest .box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px;
    background: ${u.panelBgSolid};
    border: 2px solid ${u.border};
    border-radius: 4px;
    width: min(420px, 100%);
    max-height: min(88vh, calc(100dvh - 32px));
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    color: ${u.text};
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    box-sizing: border-box;
}
.mechili-suggest .s-title {
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 2px;
}
.mechili-suggest .s-lead {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: ${u.phase};
}
.mechili-suggest .s-discord {
    margin: -4px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: ${u.phase};
}
.mechili-suggest .s-discord a {
    color: ${u.brassLight};
    font-weight: 700;
    text-decoration: none;
}
.mechili-suggest .s-discord a:hover { text-decoration: underline; }
.mechili-suggest .s-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: ${u.brass};
}
.mechili-suggest .s-cat,
.mechili-suggest .s-msg {
    font: inherit;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: ${u.text};
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    padding: 8px 10px;
}
.mechili-suggest .s-msg {
    resize: vertical;
    min-height: 120px;
    line-height: 1.45;
}
.mechili-suggest .s-cat:focus-visible,
.mechili-suggest .s-msg:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}
.mechili-suggest .s-status {
    margin: 0;
    min-height: 1.2em;
    font-size: 12px;
    color: ${u.brassLight};
}
.mechili-suggest .s-hp {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}
.mechili-suggest .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
}
.mechili-suggest button {
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-weight: bold;
    cursor: pointer;
    transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.mechili-suggest button.primary { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-suggest button:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-suggest button:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35);
}

.mechili-resume {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.58);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 30;
    user-select: none;
}
/* reload reconnect: menu zoom keeps moving underneath — only the dialog blocks */
.mechili-resume-over-intro {
    background: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    pointer-events: none;
}
.mechili-resume-over-intro .resume-box {
    pointer-events: auto;
}
.mechili-resume .resume-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 28px 36px;
    min-width: 280px;
    background: ${u.panelBg};
    border: 2px solid ${u.border};
    border-radius: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}
.mechili-resume .resume-msg {
    font-size: 17px;
    font-weight: bold;
    letter-spacing: 1.5px;
    color: ${u.brassLight};
    text-align: center;
    line-height: 1.45;
}
.mechili-resume .resume-sub {
    font-size: 13px;
    color: ${u.textMuted};
    text-align: center;
    max-width: 320px;
    line-height: 1.5;
}
.mechili-resume .resume-cancel {
    padding: 10px 28px;
    background: ${u.panelBgDark};
    border: 2px solid ${u.undoBorder};
    border-radius: 4px;
    color: ${u.undoText};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-resume .resume-cancel { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-resume .resume-cancel:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.mechili-resume .resume-cancel:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

${gamepadCursorStyles(u)}

/* Respect users who prefer reduced motion: neutralize UI transitions/animations. */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
    }
}
`;
}
