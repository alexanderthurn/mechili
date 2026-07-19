import { teamColors } from './game/colors';

/**
 * Allied blue vs Soviet red on a bright, warm RA2-style green battlefield.
 * Single source of truth for palette — tweak here to shift the whole look.
 */
export const THEME = {
    // atmosphere (three.js hex) — warm sunny day, not murky dusk
    // `sky` is the fog color and must match the sky dome's horizon band
    sky: 0xb8d4c8,
    fogNear: 520,
    fogFar: 1300,
    hemiSky: 0xd0e8b8,
    hemiGround: 0x6a9a48,
    hemiIntensity: 1.15,
    sun: 0xfff4c8,
    sunIntensity: 1.55,

    // factions (three.js hex) — vivid RA2-style team colors
    player: 0x3d8cd4,
    enemy: 0xe83828,

    // unit materials — light warm tones, deliberately off the grass hue so silhouettes read
    hull: 0xb4b8a4,
    dark: 0x585048,
    light: 0xf0ecd8,
    accentEmissive: 0.85,

    // placement markers — vivid green/red validity feedback on the ground
    valid: 0x00ff66,
    invalid: 0xff2244,
    select: 0xffd040,
    movable: 0xffffff,

    // combat: bright blood spatters; muzzle/debris stay dusty stone-gray
    muzzle: 0x8a8478,
    impact: 0xff1a28,
    death: 0xe01018,
    deathSecondary: 0xff3840,
    deathSmall: 0xff2028,
    levelup: 0xc4b896,
    projectile: 0xffe878,

    // HP bars (pixi hex)
    hpHigh: 0x78c848,
    hpMid: 0xffd040,
    hpLow: 0xe83828,
    veteran: 0xffe040,
    barBg: 0x2a3820,
    selection: 0xffffff,

    // title screen (pixi hex)
    title: 0xfff8e8,
    subtitle: 0xffd040,

    // map zone tints — rgba prefix without the closing alpha paren
    playerTint: 'rgba(61, 140, 212,',
    enemyTint: 'rgba(232, 56, 40,',

    terrain: {
        base: '#55a244',
        // large soft meadow variation — same hue family, gentle contrast
        meadow: ['#63b44e', '#478e38', '#5ba84f', '#6dbe56'],
        // mown-lawn stripes
        stripe: 'rgba(210, 245, 170, 0.06)',
        // grass blade strokes
        bladeDark: '#3c7c30',
        bladeBright: '#8ad85e',
        // rare wildflower dots
        flowers: ['#fff8f0', '#ffd84d', '#ffa8b8'],
        // faint worn-earth patches
        dirt: 'rgba(138, 122, 78, 0.5)',
        // edge darkening — kept very light so the field blends into the outer meadow
        vignette: 'rgba(18, 42, 14, 0.04)',
        grid: 'rgba(255, 255, 255, 0.2)',
        centerLine: 'rgba(255, 220, 80, 0.6)',
        flankLocked: 'rgba(140, 170, 100, 0.14)',
        sunWashTop: 'rgba(255, 248, 200, 0.18)',
        sunWashBottom: 'rgba(255, 248, 200, 0)',
        groundRoughness: 0.88,
        // gentle playable mounds — kept modest so combat stays readable
        // (shots ignore terrain; tall board hills would look like blockers)
        reliefDepth: 2.5,
    },

    scenery: {
        // sky dome gradient, zenith to horizon (horizon must equal `sky` above)
        skyZenith: '#5aa8dc',
        skyMid: '#8cc4e4',
        skyHorizon: '#b8d4c8',
        sunGlow: 'rgba(255, 244, 200, 1)',
        // the world beyond the battlefield — matches terrain.base so the
        // meadow reads as one continuous surface with the field
        outerGround: 0x55a244,
        trunk: 0x6a4a32,
        pine: 0x2e6e34,
        pineLight: 0x48904a,
        leaf: 0x4c9a3e,
        leafLight: 0x74bc52,
        rock: 0x8a8d82,
        snow: 0xeef3f0,
        // drifting clouds + their shadows on the field
        cloudOpacity: 0.85,
        cloudShadowOpacity: 0.1,
    },

    ui: {
        text: '#f0f4e8',
        textMuted: '#a8b898',
        panelBg: 'rgba(32, 48, 28, 0.88)',
        panelBgSolid: 'rgba(32, 48, 28, 0.85)',
        panelBgDark: 'rgba(24, 36, 20, 0.92)',
        border: '#5a7048',
        hover: '#ffd040',
        player: '#3d8cd4',
        enemy: '#e83828',
        brass: '#ffd040',
        brassLight: '#ffe878',
        brassDark: '#b89020',
        hpBar: '#78c848',
        techOwned: '#a8d868',
        barTrack: '#2a3820',
        divider: '#4a6040',
        techBuyBg: '#2a4020',
        phase: '#b8d0a0',
        alliedBtnBg: '#1a3a58',
        alliedBtnHover: '#245078',
        undoBg: '#483020',
        undoHover: '#584030',
        undoBorder: '#a87840',
        undoText: '#ffd878',
        speedBg: '#4a4018',
        speedHover: '#5a5020',
        iconCenter: '#3d8cd4',
        iconEdge: '#1a2818',
        helpBold: '#d0e0c0',
        veteranStar: '#ffe040',
        debug: '#a8d878',
    },
} as const;

/** CSS for the pre-game main menu (exists before the HUD does). */
export function menuStyles(): string {
    const u = THEME.ui;
    const pc = teamColors.player.css;
    return `
.mechili-menu {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -8%);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: clamp(264px, 34vw, 324px);
    box-sizing: border-box;
    padding: 22px 20px 24px;
    background: linear-gradient(180deg, rgba(30, 44, 26, 0.62), rgba(18, 28, 15, 0.74));
    border: 1px solid rgba(255, 216, 64, 0.18);
    border-radius: 18px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    -webkit-backdrop-filter: blur(12px) saturate(1.1);
    backdrop-filter: blur(12px) saturate(1.1);
    font-family: system-ui, sans-serif;
    user-select: none;
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
    background: linear-gradient(180deg, rgba(42, 58, 34, 0.95), rgba(24, 36, 20, 0.95));
    border: 1.5px solid ${u.border};
    border-radius: 11px;
    color: ${u.text};
    font-size: 16px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease,
        background 0.14s ease, color 0.14s ease;
}
.mechili-menu .m-btn .m-ico {
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    font-size: 18px;
    color: ${u.brass};
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
.mechili-menu .m-btn .m-label { flex: 1; }
.mechili-menu .m-btn:hover {
    border-color: ${u.hover};
    color: ${u.brassLight};
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 216, 64, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.mechili-menu .m-btn:active { transform: translateY(0) scale(0.98); }
.mechili-menu .m-btn:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
}
.mechili-menu .m-btn:disabled { opacity: 0.4; pointer-events: none; box-shadow: none; }
/* Single Player — the hero call to action */
.mechili-menu .m-primary {
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border-color: ${u.brassLight};
    color: #20180a;
    font-size: 17px;
    box-shadow: 0 4px 14px rgba(255, 180, 40, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.mechili-menu .m-primary .m-ico { color: #20180a; filter: none; }
.mechili-menu .m-primary:hover {
    color: #20180a;
    background: linear-gradient(180deg, #fff0b0, ${u.brassLight});
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(255, 180, 40, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.mechili-menu .m-small {
    justify-content: center;
    padding: 9px 12px;
    font-size: 13px;
    letter-spacing: 1px;
}
.mechili-menu .m-custom { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.mechili-menu .m-join { display: flex; gap: 8px; }
.mechili-menu .m-input {
    width: 130px;
    padding: 9px 10px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 8px;
    color: ${u.text};
    font-size: 14px;
    letter-spacing: 2px;
    text-align: center;
}
.mechili-menu .m-status { font-size: 14px; color: ${u.phase}; max-width: 380px; text-align: center; }
.mechili-menu .m-cancel { border-color: ${u.undoBorder}; color: ${u.undoText}; }

.mechili-gchat {
    position: absolute;
    left: 50%;
    bottom: calc(14px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(440px, calc(100vw - 32px));
    box-sizing: border-box;
    font-family: system-ui, sans-serif;
    color: ${u.text};
    z-index: 30;
}
.mechili-gchat .g-strip {
    display: block;
    width: 130px;
    margin: 0 auto;
    padding: 6px 0;
    text-align: center;
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    background: ${u.panelBg};
    border: 1px solid ${u.border};
    border-radius: 9px;
    color: ${u.textMuted};
    cursor: pointer;
    opacity: 0.8;
}
.mechili-gchat .g-strip:hover { opacity: 1; border-color: ${u.hover}; color: ${u.text}; }
.mechili-gchat.open .g-strip { display: none; }
.mechili-gchat .g-panel { display: none; }
.mechili-gchat.open .g-panel {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px 12px;
    background: linear-gradient(180deg, rgba(30, 44, 26, 0.72), rgba(18, 28, 15, 0.82));
    border: 1.5px solid ${u.border};
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
}
.mechili-gchat .g-title { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: ${u.textMuted}; }
.mechili-gchat .g-sticky {
    padding: 4px 9px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.brassDark};
    border-radius: 7px;
    color: ${u.brassLight};
    font-size: 12.5px;
}
.mechili-gchat .g-list { display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow-y: auto; }
.mechili-gchat .g-msg { font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere; }
.mechili-gchat .g-msg .g-name { font-weight: bold; color: ${u.brass}; }
.mechili-gchat .g-empty { font-size: 12px; color: ${u.textMuted}; }
.mechili-gchat .g-row { display: flex; gap: 6px; }
.mechili-gchat .g-input {
    flex: 1;
    padding: 6px 9px;
    background: ${u.panelBgDark};
    border: 1px solid ${u.border};
    border-radius: 7px;
    color: ${u.text};
    font-size: 13px;
}
.mechili-gchat .g-send {
    padding: 0 14px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.border};
    border-radius: 7px;
    color: ${u.text};
    cursor: pointer;
    font-size: 13px;
}
.mechili-gchat .g-send { transition: border-color 0.12s ease, background 0.12s ease; }
.mechili-gchat .g-send:hover { border-color: ${u.hover}; }
.mechili-gchat .g-send:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-gchat .g-input:focus-visible { outline: none; border-color: ${u.hover}; }
.mechili-menu .m-lobby { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%; }
.mechili-menu .m-room-list {
    width: 100%;
    box-sizing: border-box;
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    background: rgba(18, 28, 15, 0.6);
    border: 1.5px solid ${u.border};
    border-radius: 10px;
}
.mechili-menu .m-room-list.empty { justify-content: center; align-items: center; color: ${u.textMuted}; font-size: 13px; min-height: 64px; }
.mechili-menu .m-room {
    padding: 10px 12px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 8px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    text-align: left;
    transition: transform 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.mechili-menu .m-room::before { content: '▸ '; color: ${u.brass}; }
.mechili-menu .m-room:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateX(2px); }
.mechili-menu .m-room:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.3); }
.mechili-menu .m-room-row { display: flex; gap: 8px; width: 100%; }
.mechili-menu .m-room-row .m-btn { flex: 1; width: auto; }
.mechili-username {
    position: absolute;
    right: calc(16px + env(safe-area-inset-right));
    bottom: calc(14px + env(safe-area-inset-bottom));
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    color: ${u.text};
    font-family: system-ui, sans-serif;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.mechili-username:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
/* narrow screens: the centered chat would collide with the username pill —
   stack the chat above it */
@media (max-width: 599px) {
    .mechili-gchat { bottom: calc(68px + env(safe-area-inset-bottom)); }
}
.mechili-username:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.3); }

/* big gear, top-right of the main menu */
.mechili-settings-btn {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    right: calc(16px + env(safe-area-inset-right));
    background: none;
    border: none;
    color: ${u.text};
    font-size: 70px;
    line-height: 1;
    cursor: pointer;
    z-index: 30;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    transition: transform 0.25s, color 0.2s;
}
.mechili-settings-btn:hover { color: ${u.brassLight}; transform: rotate(45deg); }
.mechili-settings-btn:focus-visible { outline: none; color: ${u.brassLight}; transform: rotate(45deg); }
@media (pointer: coarse) {
    .mechili-settings-btn { font-size: 40px; }
}

/* suggest chip, top-left of the main menu (same feel as username) */
.mechili-suggest-btn {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    left: calc(16px + env(safe-area-inset-left));
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    color: ${u.text};
    font-family: system-ui, sans-serif;
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
.mechili-suggest-btn:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.3); }

.mechili-username::before { content: '◆ '; color: ${u.brass}; opacity: 0.8; }
.mechili-version {
    position: absolute;
    left: calc(16px + env(safe-area-inset-left));
    bottom: calc(14px + env(safe-area-inset-bottom));
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    color: ${u.textMuted};
    font-family: system-ui, sans-serif;
    font-size: 12px;
    letter-spacing: 0.4px;
    opacity: 0.85;
    pointer-events: none;
    user-select: none;
    text-decoration: none;
    z-index: 30;
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
    font-family: system-ui, sans-serif;
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
.mechili-loading .load-bar {
    width: 100%;
}
.mechili-loading .hp-track {
    height: 36px;
    background: ${u.barTrack};
    border: 2px solid ${u.border};
    border-radius: 4px;
    overflow: hidden;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.5), 0 4px 18px rgba(0, 0, 0, 0.35);
    position: relative;
}
.mechili-loading .hp-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, ${pc}, ${u.hpBar});
    transition: width 0.2s ease-out;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}
.mechili-loading .hp-val {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
    z-index: 2;
}
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
    border-radius: 12px;
    min-width: 280px;
    max-width: min(360px, 92vw);
    color: ${u.text};
    font-family: system-ui, sans-serif;
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
    border-radius: 8px;
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
.mechili-name-edit .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.mechili-name-edit button {
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 8px;
    color: ${u.text};
    font-weight: bold;
    cursor: pointer;
}
.mechili-name-edit button:disabled { opacity: 0.5; cursor: wait; }
.mechili-name-edit button.primary { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-name-edit button { transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease; }
.mechili-name-edit button:hover:not(:disabled) { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-name-edit button:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-name-edit input:focus-visible { outline: none; border-color: ${u.hover}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.25); }

.mechili-settings {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    font-family: system-ui, sans-serif;
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 70;
}
.mechili-settings .box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px;
    background: ${u.panelBgSolid};
    border: 2px solid ${u.border};
    border-radius: 12px;
    min-width: 320px;
    color: ${u.text};
}
.mechili-settings .s-title { font-size: 15px; font-weight: bold; letter-spacing: 2px; }
.mechili-settings .s-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.mechili-settings .s-section-head {
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: ${u.brass};
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
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 6px;
    color: ${u.textMuted};
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
}
.mechili-settings .s-preset:hover {
    border-color: ${u.hover};
    color: ${u.text};
    transform: translateY(-1px);
}
.mechili-settings .s-preset.active {
    border-color: ${u.brass};
    color: ${u.brassLight};
}
.mechili-settings .s-preset:focus-visible {
    outline: none;
    border-color: ${u.brassLight};
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
}
.mechili-settings .s-row {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 13.5px;
    cursor: pointer;
    user-select: none;
}
.mechili-settings .s-row input { width: 16px; height: 16px; accent-color: ${u.brass}; }
.mechili-settings .s-hint {
    font-size: 12px;
    color: ${u.textMuted};
    white-space: nowrap;
}
.mechili-settings .actions { display: flex; justify-content: flex-end; }
.mechili-settings button {
    padding: 8px 14px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 8px;
    color: ${u.text};
    font-weight: bold;
    cursor: pointer;
}
.mechili-settings button.primary { border-color: ${u.hover}; color: ${u.brassLight}; }
.mechili-settings button { transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease; }
.mechili-settings button:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-settings button:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-settings .s-row input:focus-visible { outline: 2px solid ${u.hover}; outline-offset: 1px; }

/* Community Suggest — shared by game menu / pause / homepage */
.mechili-suggest {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    font-family: system-ui, sans-serif;
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
    border-radius: 12px;
    width: min(420px, 100%);
    color: ${u.text};
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
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
    border-radius: 8px;
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
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
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
    border-radius: 8px;
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
    box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35);
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
    font-family: system-ui, sans-serif;
    user-select: none;
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
    border-radius: 14px;
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
    border-radius: 10px;
    color: ${u.undoText};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-resume .resume-cancel { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-resume .resume-cancel:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.mechili-resume .resume-cancel:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

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

/** CSS block for the HTML HUD — generated from {@link THEME} + the match's
 *  canonical team colors (assign those BEFORE the HUD is built). */
export function hudStyles(): string {
    const u = THEME.ui;
    const pc = teamColors.player.css;
    const ec = teamColors.enemy.css;
    return `
.mechili-shop-col {
    position: absolute;
    right: env(safe-area-inset-right);
    bottom: env(safe-area-inset-bottom);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    font-family: system-ui, sans-serif;
    user-select: none;
    pointer-events: none;
}
.mechili-shop-col.disabled { opacity: 0.35; pointer-events: none; }
.mechili-shop-col.battle { display: none; }
.mechili-supply {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 54px;
    padding: 8px 16px;
    background: linear-gradient(180deg, rgba(46, 62, 36, 0.96), rgba(26, 40, 22, 0.96));
    border: 2px solid ${u.brassDark};
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    user-select: none;
    pointer-events: none;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.07);
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
}
.mechili-supply .supply::before {
    content: '⬢';
    font-size: 28px;
    line-height: 1;
    color: ${u.brass};
}
.shop-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
    padding: 0 0 0 8px;
    pointer-events: auto;
}
.shop-toolbar .undo,
.mechili-phone-status .undo {
    margin-right: auto;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 54px;
    padding: 8px 14px;
    background: ${u.undoBg};
    border: 2px solid ${u.undoBorder};
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    color: ${u.undoText};
    font-size: 20px;
    font-weight: bold;
    line-height: 1;
    letter-spacing: 0.5px;
    cursor: pointer;
    appearance: none;
    font-family: system-ui, sans-serif;
    flex-shrink: 0;
}
.shop-toolbar .undo,
.mechili-phone-status .undo { transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease; }
.shop-toolbar .undo:hover,
.mechili-phone-status .undo:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.shop-toolbar .undo:focus-visible,
.mechili-phone-status .undo:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

/* top-right stack docked under the enemy card: ☰ on every device,
   plus supply/undo/level-all on phone */
.mechili-phone-status {
    display: flex;
    position: absolute;
    top: calc(62px + env(safe-area-inset-top));
    right: env(safe-area-inset-right);
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 3;
    font-family: system-ui, sans-serif;
    user-select: none;
    pointer-events: none;
}
/* the twins hide by default (button.* outranks the shared component rules
   below regardless of order): money returns on phone, undo/level-all on any
   coarse pointer — tablets get them top-right too */
.mechili-phone-status .mechili-supply,
.mechili-phone-status button.undo,
.mechili-phone-status button.level-all-global {
    display: none;
}
@media (pointer: coarse) {
    .mechili-phone-status button.undo,
    .mechili-phone-status button.level-all-global {
        display: flex;
    }
    .mechili-shop-col .undo,
    .mechili-shop-col .level-all-global {
        display: none !important;
    }
}
.mechili-phone-status .undo { pointer-events: auto; margin-right: 0; }
/* compact versions of the shop-toolbar frames — the originals crowd End Deployment */
.mechili-phone-status .mechili-supply {
    min-height: 40px;
    padding: 4px 10px;
}
.mechili-phone-status .supply { font-size: 20px; }
.mechili-phone-status .supply::before { font-size: 16px; }
.mechili-phone-status .undo {
    min-height: 40px;
    padding: 6px 10px;
    font-size: 15px;
}
.mechili-phone-status .level-all-global {
    align-self: flex-end;
    min-height: 40px;
    max-width: 110px;
}
.mechili-phone-status.overlay-open { display: none !important; }

/* the ☰ menu: a tab growing out of the enemy card's bottom-right corner —
   same chrome as the card so it reads as part of it */
.mechili-phone-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    align-self: flex-end;
    min-width: 48px;
    min-height: 40px;
    padding: 2px 12px;
    appearance: none;
    background: linear-gradient(180deg, ${u.panelBgSolid} 0%, ${u.panelBgDark} 100%);
    border: 2px solid ${u.border};
    border-top: none;
    border-right: none;
    border-radius: 0 0 0 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    color: ${u.text};
    font-family: system-ui, sans-serif;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    user-select: none;
    transition: color 0.12s ease;
}
.mechili-phone-menu:hover { color: ${u.brassLight}; }
.shop-toolbar-right {
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
}
.shop-toolbar .level-all-global,
.mechili-phone-status .level-all-global {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: auto;
    min-width: 64px;
    max-width: 88px;
    min-height: 44px;
    padding: 4px 8px;
    background: ${u.panelBgSolid};
    border: 2px solid ${u.border};
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    appearance: none;
    font-family: system-ui, sans-serif;
    cursor: pointer;
    pointer-events: auto;
    flex-shrink: 0;
    align-self: flex-start;
}
.shop-toolbar .level-all-global .title,
.mechili-phone-status .level-all-global .title {
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 0.4px;
    line-height: 1.15;
    text-align: center;
    white-space: normal;
    color: ${u.phase};
}
.shop-toolbar .level-all-global .cost,
.mechili-phone-status .level-all-global .cost {
    font-size: 14px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
    line-height: 1;
    margin-top: 2px;
}
.shop-toolbar .level-all-global,
.mechili-phone-status .level-all-global { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.shop-toolbar .level-all-global:hover,
.mechili-phone-status .level-all-global:hover { border-color: ${u.hover}; transform: translateY(-1px); }
.shop-toolbar .level-all-global:active,
.mechili-phone-status .level-all-global:active { transform: scale(0.96); }
.shop-toolbar .level-all-global:focus-visible,
.mechili-phone-status .level-all-global:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }
.shop-toolbar .level-all-global.unaffordable,
.mechili-phone-status .level-all-global.unaffordable { opacity: 0.35; pointer-events: none; }
.mechili-extras {
    display: flex;
    flex-direction: row-reverse;
    align-items: stretch;
    gap: 8px;
    padding: 0 0 0 8px;
    pointer-events: auto;
}
.mechili-shop {
    width: 228px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 10px 10px 12px;
    background: linear-gradient(180deg, rgba(38, 54, 32, 0.9), rgba(22, 34, 19, 0.93));
    border: 1.5px solid ${u.border};
    border-right: none;
    border-bottom: none;
    border-radius: 10px 0 0 0;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    pointer-events: auto;
}
.mechili-shop .shop-header {
    display: flex;
    align-items: center;
    gap: 10px;
}
.mechili-shop .shop-header .unit-cap {
    font-size: 14px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: ${u.phase};
}
.mechili-shop .shop-header .unit-cap::before { content: '⚙ '; opacity: 0.75; }
.mechili-shop .shop-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
}
.mechili-shop-col .shop-tile {
    position: relative;
    overflow: hidden;
    appearance: none;
    -webkit-appearance: none;
    font-family: system-ui, sans-serif;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    border: 1.5px solid ${u.border};
    color: ${u.text};
    cursor: pointer;
}
.mechili-shop-col .shop-tile .title {
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
    color: ${u.text};
    background: rgba(24, 36, 20, 0.88);
    border-bottom: 1px solid ${u.border};
    pointer-events: none;
    z-index: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-shop-col .shop-tile .art {
    position: absolute;
    inset: 0;
    background-color: #f0ecd8;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    pointer-events: none;
}
.mechili-shop-col .shop-tile .cost {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 2px 7px 3px;
    font-size: 12px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: #fff;
    background: rgba(180, 32, 24, 0.92);
    border-radius: 0 6px 0 0;
    pointer-events: none;
    z-index: 1;
}
.mechili-shop-col .shop-tile { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-shop-col .shop-tile:hover { border-color: ${u.hover}; }
.mechili-shop-col .shop-tile:active { transform: scale(0.94); }
.mechili-shop-col .shop-tile:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); z-index: 3; }
.mechili-shop-col .shop-tile.unaffordable { opacity: 0.35; pointer-events: none; }
.mechili-extras .shop-tile {
    width: 64px;
    height: 64px;
    border-radius: 8px;
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
.mechili-shop .shop-grid .shop-tile {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 9px;
}
.mechili-shop .shop-grid .shop-tile .title {
    font-size: 10px;
    padding: 3px 5px;
}
.mechili-shop .shop-tile.unlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 72px;
    aspect-ratio: 1;
    opacity: 0.45;
    pointer-events: none;
    cursor: default;
    background: ${u.panelBgDark};
}
.mechili-shop .shop-tile.unlock.available {
    opacity: 1;
    pointer-events: auto;
    cursor: pointer;
    border-color: ${u.brass};
}
.mechili-shop .shop-tile.unlock.available:hover {
    border-color: ${u.hover};
    transform: translateY(-2px);
}
.mechili-shop .shop-tile.unlock .unlock-icon {
    font-size: 22px;
    line-height: 1;
    color: ${u.textMuted};
}
.mechili-shop .shop-tile.unlock .unlock-label {
    font-size: 9px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: ${u.textMuted};
    text-align: center;
    padding: 0 4px;
}

.mechili-panel {
    position: absolute;
    left: env(safe-area-inset-left);
    bottom: env(safe-area-inset-bottom);
    min-width: 244px;
    max-width: 300px;
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(38, 54, 32, 0.9), rgba(22, 34, 19, 0.93));
    border: 1.5px solid ${u.border};
    border-left: none;
    border-bottom: none;
    border-radius: 0 10px 0 0;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    font-family: system-ui, sans-serif;
    color: ${u.text};
    user-select: none;
}
.mechili-panel .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
.mechili-panel .team { font-size: 11px; letter-spacing: 0.5px; margin-bottom: 8px; }
.mechili-panel .team.player { color: ${pc}; }
.mechili-panel .team.enemy { color: ${ec}; }
.mechili-panel .row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-panel .row .v { color: ${u.brass}; font-variant-numeric: tabular-nums; }
.mechili-panel .xpbar { height: 5px; margin: 0 0 5px; background: rgba(255, 255, 255, 0.38); border-radius: 3px; overflow: hidden; }
.mechili-panel .xpbar.player div { height: 100%; background: ${pc}; }
.mechili-panel .xpbar.enemy div { height: 100%; background: ${ec}; }
/* horizontal row of square action tiles (sell, techs, tower actions) */
.mechili-panel .action-row {
    display: flex; flex-wrap: wrap; gap: 5px;
    margin-top: 10px; border-top: 1px solid ${u.divider}; padding-top: 10px;
}
/* header: big level block · name+team · leveling tiles */
.mechili-panel .panel-head {
    display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.mechili-panel .lvl-big {
    flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-width: 42px; padding: 2px 6px 3px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.brass};
    border-radius: 8px;
    line-height: 1;
}
.mechili-panel .lvl-big .lvl-cap { font-size: 8px; font-weight: bold; letter-spacing: 1.5px; color: ${u.textMuted}; }
.mechili-panel .lvl-big .lvl-num { font-size: 27px; font-weight: 900; color: ${u.brassLight}; }
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
.mechili-panel .action-tile {
    position: relative;
    width: 46px; height: 46px;
    box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    /* leave room at the bottom for the cost strip so the icon centers above it */
    padding: 0 0 12px; margin: 0;
    appearance: none; -webkit-appearance: none;
    background: ${u.techBuyBg};
    border: 1.5px solid ${u.border};
    border-radius: 8px;
    color: ${u.text};
    cursor: pointer;
    overflow: visible;
}
.mechili-panel .action-tile .at-icon { font-size: 27px; line-height: 1; }
.mechili-panel .action-tile .at-cost {
    position: absolute; left: 0; bottom: 0; right: 0;
    padding: 1px 0 2px;
    font-size: 9px; font-weight: bold; text-align: center;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: rgba(180, 32, 24, 0.92);
    border-radius: 0 0 6px 6px;
    pointer-events: none;
}
.mechili-panel .action-tile .at-cost.refund { background: rgba(40, 140, 60, 0.92); }
.mechili-panel .action-tile .at-badge {
    position: absolute; top: -5px; right: -5px;
    width: 16px; height: 16px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: bold;
    color: #0c1408; background: ${u.techOwned};
    border-radius: 50%;
    pointer-events: none;
}
.mechili-panel .action-tile { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-panel .action-tile:hover { border-color: ${u.hover}; transform: translateY(-1px); }
.mechili-panel .action-tile:active { transform: scale(0.94); }
.mechili-panel .action-tile:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }
.mechili-panel .action-tile.locked { opacity: 0.42; }
.mechili-panel .action-tile.owned { border-color: ${u.techOwned}; cursor: default; }
.mechili-panel .action-tile.owned .at-icon { opacity: 0.7; }

/* the big hover frame — pops to the right of the panel with full details */
.mechili-panel .action-info {
    position: absolute;
    left: calc(100% + 8px);
    bottom: 0;
    width: 220px;
    padding: 12px 14px;
    background: ${u.panelBgSolid};
    border: 1.5px solid ${u.brass};
    border-radius: 10px;
    color: ${u.text};
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    z-index: 6;
}
.mechili-panel .action-info .ai-head { display: flex; align-items: center; gap: 10px; }
.mechili-panel .action-info .ai-icon { font-size: 28px; line-height: 1; }
.mechili-panel .action-info .ai-title { font-size: 14px; font-weight: bold; color: ${u.brassLight}; }
.mechili-panel .action-info .ai-desc { font-size: 12px; line-height: 1.5; color: ${u.text}; margin-top: 8px; }
.mechili-panel .action-info .ai-note { font-size: 11px; color: ${u.textMuted}; margin-top: 6px; font-style: italic; }
.mechili-panel .action-info .ai-cost { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: bold; color: ${u.brass}; }
.mechili-panel .action-info .ai-cost.refund { color: ${u.techOwned}; }
.mechili-panel .action-info .ai-cost.owned { color: ${u.techOwned}; }
.mechili-panel .action-info .ai-buy {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 10px 14px;
    appearance: none;
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border: 1.5px solid ${u.brassLight};
    border-radius: 8px;
    color: #20180a;
    font-family: inherit;
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
    background: linear-gradient(180deg, rgba(38, 54, 32, 0.9), rgba(22, 34, 19, 0.93));
    border: 1.5px solid ${u.border};
    border-radius: 0;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-sidebar.left {
    left: env(safe-area-inset-left);
    border-left: none;
    border-radius: 0 10px 10px 0;
}
.mechili-sidebar.right {
    right: env(safe-area-inset-right);
    border-right: none;
    border-radius: 10px 0 0 10px;
    /* enemy intel only shows on the enemy commander's detail screen */
    display: none;
}
.mechili-sidebar.right.reveal:not(.battle) {
    display: flex;
    /* above the detail overlay's dim layer */
    z-index: 60;
}
.mechili-sidebar.battle { display: none; }
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
    border-radius: 8px;
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
    border-radius: 9px;
    color: ${u.text};
    cursor: pointer;
}
.mechili-sidebar .inv-item { transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-sidebar .inv-item:hover { border-color: ${u.hover}; transform: translateY(-1px); }
.mechili-sidebar .inv-item:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }
.mechili-sidebar .inv-item.armed { border-color: ${u.brass}; box-shadow: 0 0 10px ${u.brass}; }
.mechili-sidebar .inv-item.placed {
    border-color: ${u.techOwned};
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
    background: rgba(12, 18, 10, 0.85);
    border: 1px solid ${u.border};
    border-radius: 4px;
    pointer-events: none;
}
.mechili-sidebar .inv-item.placed .inv-cd { color: ${u.techOwned}; }
.mechili-sidebar .inv-item.readonly { cursor: default; pointer-events: none; }
.inv-drag {
    position: fixed;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    background: ${u.techBuyBg};
    border: 1.5px solid ${u.brass};
    border-radius: 9px;
    color: ${u.text};
    pointer-events: none;
    z-index: 50;
    font-family: system-ui, sans-serif;
}

.mechili-panel .item-row { display: flex; gap: 6px; margin: 4px 0 8px; }
.mechili-panel .item-sq {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.brassDark};
    border-radius: 7px;
    cursor: help;
}
.mechili-panel .item-sq { transition: border-color 0.12s ease, transform 0.12s ease; }
.mechili-panel .item-sq:hover { border-color: ${u.hover}; transform: translateY(-1px); }

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
    border-radius: 14px;
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
.mechili-fightbar .chat-bubble.emote { font-size: 56px; padding: 2px 14px; }
@keyframes chat-pop { from { transform: translateX(-50%) scale(0.4); opacity: 0; } }
@keyframes chat-fade { to { opacity: 0; } }

.mechili-chat {
    position: absolute;
    left: 50%;
    bottom: 4px;
    transform: translateX(-50%);
    width: 360px;
    font-family: system-ui, sans-serif;
    user-select: none;
    z-index: 15;
}
.mechili-chat .c-strip {
    width: 110px;
    margin: 0 auto;
    padding: 5px 0;
    text-align: center;
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-radius: 8px;
    background: ${u.panelBg};
    border: 1px solid ${u.border};
    color: ${u.textMuted};
    cursor: pointer;
    opacity: 0.7;
}
.mechili-chat .c-strip:hover { opacity: 1; border-color: ${u.hover}; color: ${u.text}; }
.mechili-chat .c-panel { display: none; }
.mechili-chat.open .c-strip { display: none; }
.mechili-chat.open .c-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: linear-gradient(180deg, rgba(30, 44, 26, 0.72), rgba(18, 28, 15, 0.82));
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
}
.mechili-chat .c-emotes { display: flex; gap: 4px; justify-content: center; }
.mechili-chat .c-emote {
    width: 36px;
    height: 36px;
    font-size: 20px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.border};
    border-radius: 8px;
    cursor: pointer;
}
.mechili-chat .c-emote { transition: transform 0.12s ease, border-color 0.12s ease; }
.mechili-chat .c-emote:hover { border-color: ${u.hover}; transform: scale(1.12); }
.mechili-chat .c-emote:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-chat .c-row { display: flex; gap: 6px; }
.mechili-chat .c-input {
    flex: 1;
    padding: 6px 9px;
    background: ${u.panelBgDark};
    border: 1px solid ${u.border};
    border-radius: 7px;
    color: ${u.text};
    font-size: 13px;
}
.mechili-chat .c-send {
    padding: 0 14px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.border};
    border-radius: 7px;
    color: ${u.text};
    cursor: pointer;
    font-size: 13px;
}
.mechili-chat .c-send { transition: border-color 0.12s ease, background 0.12s ease; }
.mechili-chat .c-send:hover { border-color: ${u.hover}; }
.mechili-chat .c-send:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-chat .c-input:focus-visible { outline: none; border-color: ${u.hover}; }

.mechili-chat-float {
    position: absolute;
    left: 50%;
    bottom: 130px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    font-family: system-ui, sans-serif;
    pointer-events: none;
    z-index: 14;
}
.mechili-chat-float .cf-msg {
    padding: 3px 12px;
    background: ${u.panelBgDark};
    border-radius: 10px;
    color: ${u.text};
    font-size: 13px;
    max-width: 460px;
    animation: chat-pop 0.15s ease-out, chat-fade 0.8s ease-in 6s forwards;
}
.mechili-chat-float .cf-name { font-weight: bold; color: ${u.brassLight}; }
.mechili-chat-float .cf-msg.remote .cf-name { color: ${ec}; }
.mechili-chat-float .cf-msg.local .cf-name { color: ${pc}; }

.mechili-cards {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 26px;
    background: rgba(12, 20, 8, 0.55);
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-cards .cards-title {
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 4px;
    color: ${u.text};
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
}
.mechili-cards .cards-row { display: flex; gap: 18px; }
.mechili-cards.unlock-dialog .unlock-picker {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: min(92vw, 520px);
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
.mechili-cards .unlock-tier-head::before {
    content: '⬢';
    font-size: 18px;
    line-height: 1;
    color: ${u.brass};
}
.mechili-cards .cards-row.unlock-row {
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 12px;
    width: 100%;
}
.mechili-cards .unlock-pick {
    position: relative;
    overflow: hidden;
    appearance: none;
    -webkit-appearance: none;
    font-family: system-ui, sans-serif;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    width: 120px;
    aspect-ratio: 1;
    border: 1.5px solid ${u.border};
    border-radius: 9px;
    color: ${u.text};
    background: ${u.panelBgDark};
    cursor: pointer;
}
.mechili-cards .unlock-pick:hover { border-color: ${u.hover}; transform: translateY(-2px); }
.mechili-cards .unlock-pick:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }
.mechili-cards .unlock-pick:disabled {
    opacity: 0.4;
    pointer-events: none;
}
.mechili-cards .unlock-pick .title {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    font-size: 10px;
    font-weight: bold;
    padding: 3px 5px;
    text-align: center;
    background: rgba(24, 36, 20, 0.88);
    border-bottom: 1px solid ${u.border};
    pointer-events: none;
}
.mechili-cards .unlock-pick .art {
    position: absolute;
    inset: 0;
    background-color: #f0ecd8;
    background-size: cover;
    background-position: center;
    pointer-events: none;
}
.mechili-cards .unlock-pick .cost {
    position: absolute;
    left: 0;
    bottom: 0;
    z-index: 1;
    font-size: 11px;
    font-weight: bold;
    padding: 2px 6px 3px;
    color: #fff;
    background: rgba(180, 32, 24, 0.92);
    border-radius: 0 6px 0 0;
    pointer-events: none;
}
.mechili-cards .card {
    width: 215px;
    min-height: 240px;
    padding: 18px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background: ${u.panelBgDark};
    border: 2px solid ${u.border};
    border-radius: 14px;
    color: ${u.text};
    cursor: pointer;
    transition: transform 0.12s, border-color 0.12s;
}
.mechili-cards .card:hover { border-color: ${u.hover}; transform: translateY(-5px); }
.mechili-cards .card:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); transform: translateY(-5px); }
.mechili-cards .card:disabled { opacity: 0.4; pointer-events: none; }
/* a card shown for information only (waiting / reveal) — no hover, no lift */
.mechili-cards .card.static { cursor: default; }
.mechili-cards .card.static:hover { border-color: ${u.border}; transform: none; }
.mechili-cards .card-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }

/* the both-specialists reveal: cards further apart, then fly to the corners */
.mechili-cards.reveal .cards-row { gap: min(24vw, 340px); }
.mechili-cards.reveal { transition: background 0.5s ease-in; }
.mechili-cards.reveal .card-col { transition: transform 0.55s cubic-bezier(0.5, 0, 0.75, 0.4), opacity 0.55s ease-in; }
.mechili-cards.reveal .cards-title { transition: opacity 0.3s; }
.mechili-cards.reveal.exiting { background: transparent; pointer-events: none; }
.mechili-cards.reveal.exiting .cards-title { opacity: 0; }
.mechili-cards.reveal.exiting .card-col { opacity: 0; }
.mechili-cards.reveal.exiting .card-col.player { transform: translate(-42vw, -44vh) scale(0.18); }
.mechili-cards.reveal.exiting .card-col.enemy { transform: translate(42vw, -44vh) scale(0.18); }
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
.mechili-cards .c-title { font-size: 16px; font-weight: bold; color: ${u.brassLight}; }
.mechili-cards .c-units { font-size: 12.5px; color: ${u.textMuted}; }
.mechili-cards .c-hp { font-size: 14px; font-weight: bold; color: ${u.hpBar}; }
.mechili-cards .c-desc { font-size: 12.5px; color: ${u.phase}; line-height: 1.55; }
.mechili-cards .c-cost { margin-top: auto; font-size: 15px; font-weight: bold; color: ${u.brass}; }
.mechili-cards .cards-skip {
    padding: 9px 24px;
    background: ${u.undoBg};
    border: 1.5px solid ${u.undoBorder};
    border-radius: 10px;
    color: ${u.undoText};
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
}
.mechili-cards .cards-skip { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-cards .cards-skip:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.mechili-cards .cards-skip:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

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
    font-family: system-ui, sans-serif;
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
    border-radius: 14px;
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
.mechili-pause .pause-spectators {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0;
    border-top: 1px solid ${u.border};
    border-bottom: 1px solid ${u.border};
}
.mechili-pause .pause-spectate-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: ${u.text};
    cursor: pointer;
}
.mechili-pause button {
    padding: 11px 16px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    color: ${u.text};
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-pause button { transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease; }
.mechili-pause button:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateY(-1px); }
.mechili-pause button:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.35); }
.mechili-pause .pause-quit {
    border-color: ${u.undoBorder};
    color: ${u.undoText};
}
.mechili-pause .pause-quit:hover { background: ${u.undoHover}; }

.mechili-gameover {
    position: absolute;
    left: 50%;
    top: 40%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 36px 64px;
    background: linear-gradient(180deg, rgba(34, 50, 28, 0.96), rgba(20, 30, 16, 0.97));
    border: 2px solid ${u.border};
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-gameover .go-title { font-size: 44px; font-weight: 900; letter-spacing: 10px; }
.mechili-gameover.victory .go-title { color: ${pc}; }
.mechili-gameover.defeat .go-title { color: ${ec}; }
.mechili-gameover.draw .go-title { color: ${u.brassLight}; }
.mechili-gameover .go-sub { font-size: 14px; letter-spacing: 1px; color: ${u.text}; opacity: 0.75; margin-top: -10px; }
.mechili-cards .reconnect-timer { font-size: 32px; font-variant-numeric: tabular-nums; }
.mechili-cards .reconnect-timer.urgent { animation: mechili-timer-pulse 0.7s ease-in-out infinite; }
.mechili-gameover .go-restart {
    padding: 10px 26px;
    background: ${u.alliedBtnBg};
    border: 1.5px solid ${pc};
    border-radius: 10px;
    color: ${pc};
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-gameover .go-restart { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-gameover .go-restart:hover { background: ${u.alliedBtnHover}; transform: translateY(-2px); }
.mechili-gameover .go-restart:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }

.mechili-report {
    position: absolute;
    right: 0;
    top: 56px;
    min-width: 200px;
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(38, 54, 32, 0.9), rgba(22, 34, 19, 0.93));
    border: 1.5px solid ${u.border};
    border-radius: 10px 0 0 10px;
    border-right: none;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    font-family: system-ui, sans-serif;
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
    font-family: system-ui, sans-serif;
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
    align-items: center;
    justify-content: center;
    gap: 8px;
}
.mechili-topbar .timer {
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8);
}
.mechili-fightbar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    overflow: visible;
    font-family: system-ui, sans-serif;
    user-select: none;
    pointer-events: none;
}
.mechili-fightbar .fighter {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(38vw, 340px);
    min-width: 200px;
    padding: 8px 12px;
    background: linear-gradient(180deg, ${u.panelBgSolid} 0%, ${u.panelBgDark} 100%);
    border: 2px solid ${u.border};
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    pointer-events: none;
}
.mechili-fightbar .fighter.player {
    left: 0;
    border-left: none;
    border-top: none;
    border-radius: 0 0 10px 0;
}
.mechili-fightbar .fighter.enemy {
    right: 0;
    border-right: none;
    border-top: none;
    flex-direction: row-reverse;
    border-radius: 0 0 0 10px;
}
.mechili-fightbar .portrait {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, rgba(46, 62, 36, 0.95), rgba(24, 36, 20, 0.95));
    border: 2px solid ${u.border};
    border-radius: 8px;
    font-size: 22px;
    font-weight: bold;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 4px rgba(0, 0, 0, 0.3);
}
.mechili-fightbar .fighter.player .portrait { color: ${pc}; border-color: ${pc}; }
.mechili-fightbar .fighter.enemy .portrait { color: ${ec}; border-color: ${ec}; }
.mechili-fightbar .fighter-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.mechili-fightbar .fname {
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mechili-fightbar .fighter.player .fname { color: ${pc}; text-align: left; }
.mechili-fightbar .fighter.enemy .fname { color: ${ec}; text-align: right; }
.mechili-fightbar .fspec {
    display: none;
}
.mechili-fightbar .fighter.player .fspec { text-align: left; }
.mechili-fightbar .fighter.enemy .fspec { text-align: right; }
/* a chosen specialist makes the frame clickable (opens its card) */
.mechili-fightbar .fighter.has-spec { pointer-events: auto; cursor: pointer; }
.mechili-fightbar .fighter.has-spec:hover { border-color: ${u.hover}; }
.mechili-fightbar .hp-track {
    height: 22px;
    background: ${u.barTrack};
    border: 1px solid ${u.border};
    border-radius: 3px;
    overflow: hidden;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
    position: relative;
}
.mechili-fightbar .fighter.player .hp-track { direction: ltr; }
.mechili-fightbar .fighter.enemy .hp-track { direction: rtl; }
.mechili-fightbar .hp-fill { height: 100%; width: 100%; transition: width 0.25s ease-out; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28); }
.mechili-fightbar .fighter.player .hp-fill { background: linear-gradient(90deg, ${pc}, ${u.hpBar}); }
.mechili-fightbar .fighter.enemy .hp-fill { background: linear-gradient(90deg, ${ec}, #e85848); }
.mechili-fightbar .hp-val {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
    pointer-events: none;
    z-index: 2;
}
.mechili-topbar .round { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
.mechili-topbar .phase { font-size: 12px; color: ${u.phase}; letter-spacing: 1px; text-transform: uppercase; }
.mechili-topbar .timer { font-size: 22px; font-weight: bold; font-variant-numeric: tabular-nums; color: ${u.brassLight}; }
.mechili-topbar .timer.urgent {
    animation: mechili-timer-pulse 0.7s ease-in-out infinite;
}
@keyframes mechili-timer-pulse {
    0%, 100% { opacity: 1; transform: scale(1); text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8), 0 0 10px rgba(255, 200, 60, 0.35); }
    50% { opacity: 0.55; transform: scale(1.12); text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8), 0 0 18px rgba(255, 216, 64, 0.85); }
}
.mechili-topbar .end-deploy {
    padding: 10px 24px;
    background: linear-gradient(180deg, ${u.brassLight}, ${u.brass});
    border: 2px solid ${u.brassLight};
    border-radius: 9px;
    color: #20180a;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1.5px;
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(255, 180, 40, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transition: transform 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
}
.mechili-topbar .end-deploy:hover {
    background: linear-gradient(180deg, #fff0b0, ${u.brassLight});
    transform: translateY(-2px);
    box-shadow: 0 7px 20px rgba(255, 180, 40, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.mechili-topbar .end-deploy:active { transform: translateY(0) scale(0.97); }
.mechili-topbar .end-deploy:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.5); }
.mechili-topbar.battle .end-deploy { display: none; }
.mechili-topbar.waiting .end-deploy { display: none; }
/* a card overlay is up (specialist pick, reveal, round card) — can't end yet */
.mechili-topbar.overlay-open .end-deploy { display: none; }
.mechili-topbar .speed {
    display: none;
    min-width: 52px;
    padding: 7px 10px;
    background: ${u.speedBg};
    border: 1.5px solid ${u.brass};
    border-radius: 8px;
    color: ${u.brass};
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.mechili-topbar .speed { transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-topbar .speed:hover { background: ${u.speedHover}; border-color: ${u.brassLight}; }
.mechili-topbar .speed:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(255, 216, 64, 0.4); }
.mechili-topbar.battle .speed { display: inline-block; }

/*
 * Touch-first devices (tablet/phone): same layout, but tap targets meet the
 * ~44px minimum and the smallest labels get a readability bump. Desktop with
 * a mouse is untouched. Keyed on pointer capability, not viewport width.
 */
@media (pointer: coarse) {
    .mechili-panel .action-tile {
        width: 54px;
        height: 54px;
        padding-bottom: 14px;
    }
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
    .mechili-shop .shop-grid .shop-tile .title { font-size: 11px; }
    .mechili-shop .shop-tile.unlock .unlock-label { font-size: 11px; }
    .shop-toolbar .level-all-global .title { font-size: 11px; }
    .mechili-panel .lvl-big .lvl-cap { font-size: 9px; }
}

/*
 * Phone-size screens: the fixed desktop panels become one bottom sheet at a
 * time, driven by a bottom tab bar. The bar and the .phone-open class are
 * always maintained by the Hud, but only take visual effect inside the phone
 * media query below — desktop/tablet render exactly as before.
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
    background: linear-gradient(180deg, rgba(26, 40, 22, 0.96), rgba(14, 24, 12, 0.98));
    border-top: 1.5px solid ${u.border};
    font-family: system-ui, sans-serif;
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
    border-radius: 8px;
    color: ${u.textMuted};
    font-family: inherit;
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
.mechili-phonebar .ta-levelall {
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
        border-radius: 14px;
    }
    .mechili-phonebar button { flex: 0 0 auto; padding: 5px 14px; }

    /* card drafts (specialist pick, round cards, unlock): smaller cards that
       wrap — the fixed 4-in-a-row only fits desktop windows */
    .mechili-cards { gap: 10px; overflow-y: auto; }
    .mechili-cards .cards-title { font-size: 17px; letter-spacing: 2px; }
    .mechili-cards .cards-row {
        flex-wrap: wrap;
        justify-content: center;
        max-width: 100vw;
        gap: 10px;
        padding: 4px 10px 12px;
    }
    .mechili-cards .card {
        width: clamp(150px, 22vw, 215px);
        min-height: 0;
        padding: 12px 10px;
        gap: 8px;
    }
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

/* gamepad virtual cursor (left stick moves, A clicks) */
.mechili-gpcursor {
    position: absolute;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border: 2.5px solid ${u.brassLight};
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.65), inset 0 0 5px rgba(0, 0, 0, 0.5);
    z-index: 60;
    pointer-events: none;
    display: none;
}
.mechili-gpcursor::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    background: ${u.brassLight};
    border-radius: 50%;
}
.mechili-gpcursor.visible { display: block; }

/* long-press tooltip card (touch stand-in for title-attribute tooltips) */
.mechili-touchtip {
    position: fixed;
    left: 50%;
    top: 18%;
    transform: translateX(-50%);
    z-index: 90;
    max-width: min(340px, calc(100vw - 32px));
    padding: 12px 14px;
    background: linear-gradient(180deg, rgba(38, 54, 32, 0.97), rgba(22, 34, 19, 0.97));
    border: 1.5px solid ${u.brass};
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color: ${u.text};
    font-family: system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-line;
    user-select: none;
    pointer-events: none;
}

@media (pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 540px) {
    .mechili-phonebar { display: flex; }
    /* phone: back to the full-width bottom strip (tablet uses a pill) */
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
    /* tabs share the bar with the actions: Shop/Tactics only while nothing
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
       the phone enemy card is shorter, so the strip docks higher */
    .mechili-phone-status { top: calc(40px + env(safe-area-inset-top)); }
    .mechili-phone-status .mechili-supply { display: flex; }
    /* no spending during battle — money returns with the next deployment */
    .mechili-phone-status.battle .mechili-supply { display: none; }
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
        border-radius: 10px;
    }
    .mechili-shop-col.phone-open .shop-grid {
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
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
    .mechili-fightbar .fighter {
        width: min(31vw, 210px);
        min-width: 0;
        gap: 6px;
        padding: 4px 8px;
    }
    .mechili-fightbar .portrait { width: 30px; height: 30px; font-size: 15px; }
    .mechili-fightbar .fname { font-size: 11px; letter-spacing: 0.4px; }
    .mechili-fightbar .fighter-info { gap: 3px; }
    .mechili-fightbar .hp-track { height: 14px; }
    .mechili-fightbar .hp-val { font-size: 10px; }
    .mechili-topbar { top: calc(2px + env(safe-area-inset-top)); gap: 2px; }
    .mechili-topbar .round { font-size: 11px; }
    /* no room for the phase words next to Round + timer */
    .mechili-topbar .phase { display: none; }
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
    .mechili-topbar .end-deploy {
        padding: 5px 12px;
        font-size: 11px;
        letter-spacing: 0.8px;
    }
    .mechili-report { max-height: 40vh; overflow-y: auto; }

}
`;
}
