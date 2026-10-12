import { HORDE_COLOR, shadeCss, teamColors } from './game/colors';

/**
 * Allied blue vs Soviet red on a bright, warm RA2-style green battlefield.
 * Single source of truth for palette — tweak here to shift the whole look.
 */
export const THEME = {
    // atmosphere (three.js hex) — crisp sunny day: deep blue sky, punchy warm
    // sun, not murky dusk. Matches TIME_PRESETS.day in game/weather.ts so
    // there's no color pop once the weather system takes over (and it's the
    // only sky ever seen with scenery 'off', which never runs the weather sim).
    // `sky` is the fog color and must match the sky dome's horizon band
    sky: 0xace0f0,
    fogNear: 820,
    fogFar: 2700,
    hemiSky: 0xe8f6cc,
    hemiGround: 0x6a9a48,
    hemiIntensity: 1.0,
    sun: 0xfff2c8,
    sunIntensity: 2.05,

    // factions (three.js hex) — vivid RA2-style team colors
    player: 0x3d8cd4,
    enemy: 0xe83828,

    // unit materials — light warm tones, deliberately off the grass hue so silhouettes read
    hull: 0xb4b8a4,
    dark: 0x585048,
    light: 0xf0ecd8,
    accentEmissive: 0.85,

    // placement markers — valid stays neon green; invalid is hot magenta so it
    // never reads as the red faction color (SIDE_COLORS guest / Soviet red)
    valid: 0x00ff66,
    invalid: 0xff3dce,
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
    /** wizard magic orb — cool cyan, distinct from the yellow energy bolt */
    projectileOrb: 0x5ce8ff,

    // HP bars (pixi hex)
    hpHigh: 0x78c848,
    hpMid: 0xffd040,
    hpLow: 0xe83828,
    veteran: 0xffe040,
    barBg: 0x2a3820,
    /** shield (Aegis / Bulwark) absorb bar above the HP bar */
    shieldBar: 0x8fd8ff,
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
        // grass blade strokes
        bladeDark: '#3c7c30',
        bladeBright: '#8ad85e',
        // rare wildflower dots
        flowers: ['#d2c4ae', '#e0b830', '#e898a8'],
        // faint worn-earth patches
        dirt: 'rgba(138, 122, 78, 0.5)',
        // edge darkening — kept very light so the field blends into the outer meadow
        vignette: 'rgba(18, 42, 14, 0.04)',
        grid: 'rgba(255, 255, 255, 0.2)',
        // the same single-cell lines while the ground is white: white would vanish, so a dark slate
        // twin of the grid fades in over them with the snow (see BattleMap.createOverlayMesh)
        gridSnow: 'rgba(30, 45, 70, 0.34)',
        centerLine: 'rgba(255, 220, 80, 0.6)',
        /** duo/2v2: dashed divider marking where your own lane ends */
        laneLine: 'rgba(255, 255, 255, 0.5)',
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
        skyZenith: '#1f6fc4',
        skyMid: '#4f9fe0',
        skyHorizon: '#ace0f0',
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
        /** Tower / masonry dust + ash ground tint (#989f85) */
        masonry: 0x989f85,
        snow: 0xeef3f0,
        cloudOpacity: 0.85,
    },

    ui: {
        // Fantasy leather / bronze (global HUD + menus)
        text: '#f0e8d8',
        textMuted: '#b8a890',
        panelBg: 'rgba(34, 28, 22, 0.94)',
        panelBgSolid: 'rgba(34, 28, 22, 0.96)',
        panelBgDark: 'rgba(22, 18, 14, 0.96)',
        border: '#8a6d4a',
        hover: '#d4b878',
        player: '#3d8cd4',
        enemy: '#e83828',
        brass: '#b8924a',
        brassLight: '#d4b878',
        brassDark: '#6a5030',
        hpBar: '#78c848',
        techOwned: '#a8d868',
        barTrack: '#1a1612',
        divider: '#5c4634',
        techBuyBg: '#181410',
        phase: '#c4b89a',
        alliedBtnBg: '#1a3a58',
        alliedBtnHover: '#245078',
        undoBg: '#483020',
        undoHover: '#584030',
        undoBorder: '#a87840',
        undoText: '#ffd878',
        speedBg: '#4a4018',
        speedHover: '#5a5020',
        iconCenter: '#3d8cd4',
        iconEdge: '#1a1612',
        helpBold: '#e8dcc4',
        veteranStar: '#d4b878',
        debug: '#a8d878',

        // Fantasy carved-bronze / leather material system
        frameHi: '#c4a574',
        frameMid: '#8a6d4a',
        frameLo: '#3a2e24',
        frameEdge: '#1e1812',
        leather: '#1a1612',
        leatherHi: '#2c241c',
        leatherMid: '#221c17',
        gem: '#3db8a8',
        gemDeep: '#1a7a70',
        slotBg: '#100e0c',
        slotBorder: '#5c4634',
        bronze: '#b8924a',
        bronzeLight: '#d4b878',
        bronzeDark: '#6a5030',
        cream: '#f0e8d8',
        creamMuted: '#b8a890',
        // Old-paper cards / commander plaques
        parchment: '#d4bc8a',
        parchmentHi: '#e2cfa0',
        parchmentLo: '#c4a878',
        parchmentEdge: '#8a6d48',
        parchmentInk: '#2e2214',
        parchmentInkMuted: '#5a4834',
    },
} as const;

/** Shared gamepad crosshair — used on the main menu and in-match HUD. */
export function gamepadCursorStyles(u: (typeof THEME)['ui']): string {
    return `
/* gamepad virtual cursor (left stick moves, A clicks) */
/* Off-screen horde locators: their own layer over the HUD, so a pip on the
   screen's rim is never hidden by a panel. Pointer-transparent throughout. */
.mechili-horde-pips {
    position: absolute;
    inset: 0;
    z-index: 70;
    pointer-events: none;
    overflow: hidden;
}
.mechili-horde-pips .horde-pip {
    position: absolute;
    left: 0;
    top: 0;
    width: 40px;
    height: 40px;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
}
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
.mechili-gpcursor .gp-arrow {
    position: absolute;
    width: 0;
    height: 0;
    border: solid transparent;
    opacity: 0;
    transition: opacity 0.12s ease;
    pointer-events: none;
}
.mechili-gpcursor.pan-mode .gp-arrow {
    opacity: 0.95;
}
.mechili-gpcursor .gp-arrow-n {
    left: 50%;
    top: -9px;
    margin-left: -4px;
    border-width: 0 4px 6px 4px;
    border-bottom-color: ${u.brassLight};
}
.mechili-gpcursor .gp-arrow-s {
    left: 50%;
    bottom: -9px;
    margin-left: -4px;
    border-width: 6px 4px 0 4px;
    border-top-color: ${u.brassLight};
}
.mechili-gpcursor .gp-arrow-e {
    right: -9px;
    top: 50%;
    margin-top: -4px;
    border-width: 4px 0 4px 6px;
    border-left-color: ${u.brassLight};
}
.mechili-gpcursor .gp-arrow-w {
    left: -9px;
    top: 50%;
    margin-top: -4px;
    border-width: 4px 6px 4px 0;
    border-right-color: ${u.brassLight};
}
.mechili-gpcursor.visible { display: block; }
`;
}

// the pole a cloth surface hangs from: dark wood along its top edge, iron caps at the ends
export const POLE = `
    inset: auto;
    top: -5px;
    left: -9px;
    right: -9px;
    height: 8px;
    border-radius: 3px;
    box-shadow: 0 2px 3px rgba(0, 0, 0, 0.6);
    background:
        radial-gradient(circle at 4px 50%, #7a7068 0 1.2px, #3a342e 2.4px, #16120e 3.8px, transparent 4.2px),
        radial-gradient(circle at calc(100% - 4px) 50%, #7a7068 0 1.2px, #3a342e 2.4px, #16120e 3.8px, transparent 4.2px),
        linear-gradient(180deg, #5a534c 0%, #2c2723 60%, #17130f 100%) 18px 0 / 4px 100% no-repeat,
        linear-gradient(180deg, #5a534c 0%, #2c2723 60%, #17130f 100%) calc(100% - 18px) 0 / 4px 100% no-repeat,
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.2) 0 2px, transparent 2px 9px, rgba(220, 180, 130, 0.08) 9px 10px, transparent 10px 17px),
        linear-gradient(180deg, #6b4c30 0%, #3d2a1a 55%, #1f150c 100%);
    `;

/** parchment mottling (large soft blotches) and fibre (fine streaks), as SVG noise tiles */
const PARCHMENT_MOTTLE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='m'><feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='3' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.38 0 0 0 0 0.24 0 0 0 0 0.1 0 0 0 0.8 -0.18'/></filter><rect width='100%' height='100%' filter='url(#m)'/></svg>";
const PARCHMENT_FIBRE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.75 0.25' numOctaves='2' seed='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.25 0 0 0 0 0.14 0 0 0 0.22 0'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>";

/**
 * Old parchment: light and warm, smooth, faintly mottled and fibrous, browned toward
 * the edges (the inset shadow of the surface does the burnt edge). Dark ink on it.
 */
export const PARCHMENT_FILL = `
        url("data:image/svg+xml,${encodeURIComponent(PARCHMENT_FIBRE_SVG)}"),
        url("data:image/svg+xml,${encodeURIComponent(PARCHMENT_MOTTLE_SVG)}"),
        /* stains: water marks, smudges of soot from handling */
        radial-gradient(ellipse 60px 34px at 22% 74%, rgba(105, 60, 22, 0.24), transparent 72%),
        radial-gradient(ellipse 40px 26px at 64% 86%, rgba(70, 42, 18, 0.2), transparent 70%),
        radial-gradient(ellipse 34px 20px at 12% 20%, rgba(60, 40, 22, 0.16), transparent 70%),
        radial-gradient(ellipse 26px 18px at 90% 70%, rgba(40, 26, 12, 0.18), transparent 70%),
        /* yellowed with age, darker toward the edges */
        radial-gradient(ellipse at 48% 40%, #e2cfa0 0%, #d2b783 50%, #b8955f 100%)
    `;
/** the ink on parchment */
export const INK = '#2b1d10';
/** muted ink (captions, secondary text) and a rust-brown ink (values, numbers) */
export const INK_MUTED = '#5e4630';
export const INK_RUST = '#6a3410';
/** parchment's drop shadow, outline and browned, burnt edges */
export const PARCHMENT_EDGE = `
        0 8px 22px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(70, 40, 15, 0.55),
        inset 0 0 26px rgba(105, 56, 18, 0.6),
        inset 0 0 8px rgba(70, 34, 8, 0.6),
        inset 0 0 2px rgba(40, 18, 4, 0.7)`;
/** wooden buttons / tabs on parchment: grained wood, an iron edge, light text */
export const WOOD_BUTTON = `
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #4a3422 0%, #33231a 55%, #1f150c 100%);
    border: 1.5px solid #3a342e;
    color: #f0e8d8;
    box-shadow: inset 0 1px 0 rgba(255, 230, 180, 0.14), inset 0 -2px 4px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.35);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.8);`;

/**
 * Shared fantasy material primitives, in the look of the commanders' top bar (a
 * painted portrait in a worn wooden frame, an old banner on a pole): surfaces are aged
 * parchment hung from a wooden pole and written in ink (PARCHMENT_FILL, INK…), buttons
 * and tabs are wood with an iron edge (WOOD_BUTTON), slots are dark wood with an iron
 * rim. Opt-in via `.m-frame` / `.m-slot` / `.m-btn-bronze`, or applied to specific
 * surfaces below (menus, dialogs, docked panels, tips).
 */
export function materialStyles(u: (typeof THEME)['ui']): string {
    return `
/* --- fantasy material primitives --- */
.m-frame {
    position: relative;
    /* parchment hung from a pole (::before), written in ink */
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
.m-frame::before {
    content: '';
    position: absolute;
    pointer-events: none;
    z-index: 2;
    ${POLE}
    /* inside the top edge: these boxes clip their content (settings scrolls inside) */
    top: 0;
    left: 0;
    right: 0;
    border-radius: 0;
}
.m-frame--slim {
    box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(12, 8, 5, 0.9),
        inset 0 0 14px rgba(20, 12, 5, 0.34);
    outline-offset: -4px;
}
.m-frame--slim::before { display: none; }
.m-titleplate {
    font-family: var(--font-ui);
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    text-align: center;
    color: ${u.cream};
    padding: 8px 14px 10px;
    margin: 0 0 4px;
    border-bottom: 1px solid ${u.frameLo};
    box-shadow: 0 1px 0 rgba(255, 220, 160, 0.08);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.m-slot {
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #0d0906 0%, #17100a 55%, #1d140c 100%);
    border: 1px solid #2c2723;
    border-radius: 2px;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.75),
        inset 0 -1px 0 rgba(214, 170, 120, 0.06),
        0 1px 0 rgba(214, 170, 120, 0.1);
}
.m-btn-bronze {
    appearance: none;
    -webkit-appearance: none;
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #4a3422 0%, #33231a 55%, #1f150c 100%);
    border: 1.5px solid #3a342e;
    border-radius: 3px;
    color: ${u.cream};
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        inset 0 -2px 4px rgba(0, 0, 0, 0.45),
        0 2px 6px rgba(0, 0, 0, 0.35);
    transition: border-color 0.12s ease, color 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
}
.m-btn-bronze:hover {
    border-color: #6a6058;
    color: ${u.bronzeLight};
    transform: translateY(-1px);
}
.m-btn-bronze:active { transform: translateY(0) scale(0.98); }
.m-btn-bronze:focus-visible {
    outline: none;
    border-color: ${u.bronzeLight};
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        0 0 0 3px rgba(184, 146, 74, 0.35);
}
.m-btn-bronze.primary {
    border-color: #5a524a;
    color: ${u.bronzeLight};
}

/* Auto-apply ornate frames to major dialogs / menus (CSS-only — no HTML churn).
   html prefix beats later single-class chrome rules in this same stylesheet. */
html .mechili-menu {
    position: relative;
    /* parchment, written in ink; its buttons are wood, its rows and fields dark wells */
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
/* the menu hangs from a pole along its top, inside its edge (it scrolls; anything
   outside would be clipped) — in place of the old brass accent line */
html .mechili-menu::before {
    ${POLE}
    top: 0;
    left: 0;
    right: 0;
    border-radius: 0;
    opacity: 1;
}
/* text that sits on the menu's parchment itself (rows, buttons and fields keep theirs) */
html .mechili-menu :is(.m-spmode-row, .m-spmode-horde, .m-lobby-role-row, .m-lobby-ready-row) { color: ${INK}; }
html .mechili-menu :is(.m-status, .m-rooms-label, .m-scenario-list-label, .m-lobby-settings-toggle, .m-lobby-settings-reset) { color: ${INK_MUTED}; }
/* field labels on the parchment in ink — the room's settings included (no dark box of their own) */
html .mechili-menu .m-field { color: ${INK_MUTED}; }
/* dark wells on the parchment whose text only inherited the menu's colour: light again */
html .mechili-menu :is(.m-room-list, .m-scenario-row) { color: ${u.cream}; }
html .mechili-menu .m-room-list.empty { color: ${u.textMuted}; }
html .mechili-menu :is(.m-scenario-status, .m-spmode-title, .m-roster-vs) { color: ${INK_RUST}; }
html .mechili-menu .m-lobby-settings-toggle:hover { color: ${INK}; }
html .mechili-menu .m-roster-col-a .m-roster-col-header { color: #1f5c94; }
html .mechili-menu .m-roster-col-b .m-roster-col-header { color: #9a2a1a; }
/* settings and the controls help on parchment: their text in ink (tabs, presets,
   selects and key caps stay dark inlaid slots with light lettering) */
html .mechili-settings .s-title,
html .mechili-controls-help .ch-title {
    color: ${INK};
    text-shadow: none;
    border-bottom-color: rgba(90, 55, 20, 0.35);
    box-shadow: none;
}
html .mechili-controls-help .ch-head { border-bottom-color: rgba(90, 55, 20, 0.35); }
html .mechili-settings .s-section-head,
html .mechili-settings .s-lang-globe,
html .mechili-settings .s-hint a,
html .mechili-settings .s-advanced > summary::before,
html .mechili-controls-help .ch-section h2 { color: ${INK_RUST}; }
html .mechili-settings .s-hint a { border-bottom-color: rgba(106, 52, 16, 0.4); }
html .mechili-settings .s-row,
html .mechili-controls-help .ch-row,
html .mechili-controls-help .ch-desc { color: ${INK}; }
html .mechili-controls-help .ch-row { border-bottom-color: rgba(90, 55, 20, 0.18); }
html .mechili-settings .s-hint,
html .mechili-settings .s-advanced > summary,
html .mechili-controls-help .ch-note { color: ${INK_MUTED}; }
html .mechili-settings .s-advanced > summary:hover,
html .mechili-settings .s-hint a:hover,
html .mechili-settings .s-lang-row:hover .s-lang-globe { color: ${INK}; }
html .mechili-settings .s-advanced { border-top-color: rgba(90, 55, 20, 0.3); }
html .mechili-settings .s-audio-slider input[type="range"] { accent-color: ${INK_RUST}; }
html .mechili-settings .s-reset { border-color: rgba(106, 52, 16, 0.6); color: ${INK_RUST}; }
html .mechili-settings .s-reset:hover { border-color: ${INK_RUST}; background: rgba(140, 40, 24, 0.12); }
/* the inventory strips at the screen edges: parchment, captions in ink; the tactic
   tiles are dark wooden slots with an iron rim, like the details pane's */
html .mechili-sidebar {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-sidebar .inv-title { color: ${INK_MUTED}; }
html .mechili-sidebar .inv-title-meta { color: ${INK_RUST}; }
html .mechili-sidebar .inv-title .inv-chevron { border-top-color: ${INK_RUST}; }
html .mechili-sidebar.can-collapse .inv-title:hover { color: ${INK}; background: rgba(90, 55, 20, 0.1); }
html .mechili-sidebar .inv-item.tactic {
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 4px),
        linear-gradient(180deg, #24180f 0%, #1a110a 55%, #22170e 100%);
    border-color: #2c2723;
    color: ${u.cream};
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(60, 30, 8, 0.35);
}
html .mechili-sidebar .inv-item.tactic:hover { border-color: #6a6058; }
/* the hover tips (shop tiles, abilities, the details pane's action tiles): small
   parchment notes in ink; the buy button stays brass */
html .mechili-card-spell-tip,
html .mechili-panel .action-info {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    box-shadow:
        0 6px 18px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(70, 40, 15, 0.55),
        inset 0 0 18px rgba(105, 56, 18, 0.55),
        inset 0 0 3px rgba(60, 28, 6, 0.6);
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-title,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-row-cost,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-cost,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-forge-fee { color: ${INK_RUST}; }
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-desc { color: ${INK}; }
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-row-desc,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-note { color: ${INK_MUTED}; }
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-row,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-cost.refund,
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-cost.owned { color: #3d6e2a; }
html :is(.mechili-card-spell-tip, .mechili-panel .action-info) .ai-cost.hexed,
html .mechili-panel .action-info:has(.ai-cost.hexed) .ai-note { color: #1f6f9a; }
html .mechili-card-spell-tip .ai-desc + .ai-rows { border-top-color: rgba(90, 55, 20, 0.35); }
html .mechili-card-spell-tip .ai-forge-ing { box-shadow: 0 0 0 1px rgba(60, 30, 8, 0.45); }
/* the round report, the touch tip and the forge's recipe preview: parchment notes too */
html .mechili-report,
html .mechili-touchtip,
html .forge-slot-preview.recipes {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    box-shadow:
        0 6px 18px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(70, 40, 15, 0.55),
        inset 0 0 18px rgba(105, 56, 18, 0.55),
        inset 0 0 3px rgba(60, 28, 6, 0.6);
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-report .r-close { color: ${INK_MUTED}; }
html .mechili-report .r-close:hover,
html .mechili-report .r-close:focus-visible { color: ${INK}; }
html .mechili-report .r-row .n.player { color: ${shadeCss(teamColors.player.hex, -0.3)}; }
html .mechili-report .r-row .n.enemy { color: ${shadeCss(teamColors.enemy.hex, -0.3)}; }
html .mechili-report .r-row .d { color: ${INK_RUST}; font-weight: 700; }
html .forge-slot-preview.recipes .forge-recipes-hint { color: ${INK_MUTED}; }
/* its recipe tiles are dark wells: their names stay light */
html .forge-slot-preview.recipes .forge-tile { color: ${u.cream}; }
/* small parchment chips: the player's name in the menu corner, the replay controls,
   the lobby settings' tip */
html .mechili-username,
html .mechili-replay-controls,
html .m-lobby-setting-tip {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(70, 40, 15, 0.55),
        inset 0 0 14px rgba(105, 56, 18, 0.5),
        inset 0 0 3px rgba(60, 28, 6, 0.55);
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-username:hover { color: ${INK_RUST}; }
html .mechili-username::before { color: ${INK_RUST}; }
html .mechili-replay-controls .rc-speed-hint { color: ${INK_MUTED}; }
html .mechili-replay-controls button {
    ${WOOD_BUTTON}
}
html .mechili-replay-controls button:hover { border-color: #6a6058; color: ${u.brassLight}; }
/* the scenario editor's window and its test-battle strip: parchment in ink, wooden
   buttons and tools, dark fields */
html .mechili-scenario-editor,
html .mechili-test-battle {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
}
html .mechili-scenario-editor :is(.se-head, .se-section) { border-color: rgba(90, 55, 20, 0.3); }
html .mechili-scenario-editor :is(.se-title, .te-status, .se-status, .se-rules > summary),
html .mechili-test-battle .tb-title { color: ${INK_RUST}; }
html .mechili-scenario-editor :is(.se-muted, .se-hint, .se-label, .se-rule > span),
html .mechili-test-battle :is(.tb-earlier-head, .tb-earlier.other) { color: ${INK_MUTED}; }
html .mechili-test-battle .tb-earlier { color: ${INK}; }
html .mechili-scenario-editor .se-issues { color: #8a5a10; }
html .mechili-scenario-editor .se-issues.error { color: #9a2a1a; }
html .mechili-scenario-editor :is(button, .te-tool):not(.se-collapse),
html .mechili-test-battle button {
    ${WOOD_BUTTON}
    border-radius: 3px;
}
html .mechili-scenario-editor :is(button, .te-tool):not(.se-collapse):hover:not(:disabled),
html .mechili-test-battle button:hover { border-color: #6a6058; color: ${u.brassLight}; }
html .mechili-scenario-editor :is(button, .te-tool).active {
    border-color: #6a6058;
    color: ${u.brassLight};
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6);
}
html .mechili-scenario-editor .se-collapse { color: ${INK_RUST}; }
/* the footer: a slightly darker band of the same parchment */
html .mechili-scenario-editor .se-footer {
    color: ${INK};
    background: rgba(110, 62, 20, 0.14);
    border-top-color: rgba(90, 55, 20, 0.35);
}
/* the tutorial's instructions: a parchment note in ink, its Next button wood */
html .mechili-tutorial {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
}
html .mechili-tutorial :is(.tut-title, .tut-ctrl-kind) { color: ${INK_RUST}; }
html .mechili-tutorial .tut-body { color: ${INK_MUTED}; }
html .mechili-tutorial .tut-ctrl-detail { color: ${INK}; }
html .mechili-tutorial .tut-ctrl {
    background: rgba(110, 62, 20, 0.1);
    border-color: rgba(90, 48, 16, 0.4);
}
html .mechili-tutorial .tut-next {
    ${WOOD_BUTTON}
    border-radius: 3px;
}
html .mechili-tutorial .tut-next:hover { border-color: #6a6058; color: ${u.brassLight}; }
/* the menu's Cancel had no ground of its own (and the menu buttons' brass hover on
   bare parchment was unreadable): a wooden button like the rest, lettering muted */
html .mechili-menu .m-btn.m-cancel {
    ${WOOD_BUTTON}
    color: ${u.creamMuted};
}
html .mechili-menu .m-btn.m-cancel:hover { border-color: #6a6058; color: ${u.brassLight}; }
/* the Steam friends list: a parchment note in ink, its invite buttons wood */
html .mechili-friends {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
}
html .mechili-friends .fr-title { color: ${INK_RUST}; }
html .mechili-friends :is(.fr-close, .fr-state, .fr-empty, .fr-note, .fr-overlay-btn) { color: ${INK_MUTED}; }
html .mechili-friends .fr-close:hover { color: ${INK}; }
html .mechili-friends .fr-row.in-game { border-color: #3d6e2a; }
html .mechili-friends .fr-row.in-game .fr-state { color: #3d6e2a; }
html .mechili-friends .fr-overlay-btn { border-color: rgba(90, 48, 16, 0.45); }
html .mechili-friends .fr-invite {
    ${WOOD_BUTTON}
    border-radius: 3px;
}
html .mechili-friends .fr-invite:hover:not(:disabled) { border-color: #6a6058; color: ${u.brassLight}; }
/* the dialogs as parchment hung from a pole (::before below), written in ink;
   their buttons are wood, their input fields dark wells */
html .mechili-name-edit .box,
html .mechili-suggest .box,
html .mechili-pause .pause-box,
html .mechili-resume .resume-box {
    position: relative;
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-name-edit .title,
html .mechili-suggest .s-title { color: ${INK}; }
html .mechili-pause .pause-title,
html .mechili-resume .resume-msg,
html .mechili-suggest .s-field,
html .mechili-suggest .s-status,
html .mechili-suggest .s-discord a { color: ${INK_RUST}; }
html .mechili-pause .pause-subtitle,
html .mechili-resume .resume-sub,
html .mechili-name-edit .field,
html .mechili-name-edit .hint,
html .mechili-suggest .s-lead,
html .mechili-suggest .s-discord { color: ${INK_MUTED}; }
html .mechili-name-edit .error { color: #9a2a1a; }
/* the avatar upload is a label styled as a button: wood like the others */
html .mechili-name-edit .avatar-pick {
    ${WOOD_BUTTON}
}
html .mechili-name-edit .avatar-pick:hover { border-color: #6a6058; color: ${u.brassLight}; }
html .mechili-name-edit .box button,
html .mechili-suggest .box button,
html .mechili-pause .pause-box button,
html .mechili-resume .resume-box button {
    ${WOOD_BUTTON}
}
html .mechili-name-edit .box button:hover:not(:disabled),
html .mechili-suggest .box button:hover,
html .mechili-pause .pause-box button:hover,
html .mechili-resume .resume-box button:hover { border-color: #6a6058; color: ${u.brassLight}; }
html .mechili-name-edit .box button.primary,
html .mechili-suggest .box button.primary { color: ${u.brassLight}; }
html .mechili-pause .pause-box .pause-quit { color: ${u.undoText}; }
/* Soft clash plaque — match the pre-match intro roster (no leather card / gems). */
html .mechili-gameover {
    position: absolute;
    inset: 0;
    left: 0;
    top: 0;
    transform: none;
    box-sizing: border-box;
    width: auto;
    max-width: none;
    color: ${u.cream};
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-name-edit .box::before,
html .mechili-suggest .box::before,
html .mechili-pause .pause-box::before,
html .mechili-resume .resume-box::before {
    content: '';
    position: absolute;
    pointer-events: none;
    z-index: 2;
    ${POLE}
}
/* the open chat: a dark wooden board (its lines keep their own light colours) */
html .mechili-chat.open .c-panel {
    color: ${u.cream};
    background:
        repeating-linear-gradient(1.5deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 4px, rgba(255, 220, 170, 0.03) 4px 5px, transparent 5px 7px),
        linear-gradient(160deg, #3a2a1c 0%, #2a1e14 48%, #1b130c 100%);
    border-color: #3a342e;
    box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.45),
        0 0 0 1px #120d09,
        inset 1px 1px 0 rgba(214, 170, 120, 0.14);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
/* Commander HUD — bare: portraits + name + HP only (no plaque chrome) */
html .mechili-fightbar .fighter {
    color: ${u.cream};
    background: none;
    border: none;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}

/* Docked unit panel — ornate but edge-aware (like shop) */
/* the details pane as parchment (hung from its pole like a scroll), dark ink */
html .mechili-panel {
    color: ${INK};
    background: ${PARCHMENT_FILL};
    border: none;
    border-radius: 0;
    box-shadow: ${PARCHMENT_EDGE};
    text-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
/* the panel hangs from a pole along its top edge (run past the screen edge on the left) */
html .mechili-panel::before {
    content: '';
    position: absolute;
    pointer-events: none;
    z-index: 2;
    ${POLE}
    left: -12px;
}
`;
}

/** Recessed bronze HP/progress tube — shared by boot loader and fightbar. */
export function hpTubeTrack(u: (typeof THEME)['ui'], selector: string, height: string): string {
    return `
${selector} {
    height: ${height};
    box-sizing: border-box;
    padding: 2px;
    background: linear-gradient(180deg, #080604 0%, ${u.slotBg} 55%, #14100c 100%);
    border: 1px solid ${u.frameMid};
    border-radius: 2px;
    overflow: hidden;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.75),
        inset 0 0 0 1px rgba(0, 0, 0, 0.45),
        0 1px 0 rgba(196, 165, 116, 0.18);
    position: relative;
}`;
}

export function hpTubeFill(
    selector: string,
    fillBg: string,
    opts?: { transition?: string; origin?: string },
): string {
    const transition = opts?.transition ?? '0.25s ease-out';
    const origin = opts?.origin ?? 'left center';
    return `
${selector} {
    position: absolute;
    left: 2px;
    right: 2px;
    top: 2px;
    bottom: 2px;
    width: auto;
    height: auto;
    border-radius: 1px;
    transform: scaleX(0);
    transform-origin: ${origin};
    transition: transform ${transition};
    pointer-events: none;
    z-index: 1;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
    background: ${fillBg};
}`;
}

export function hpTubeVal(selector: string, fontSize: string, extra = ''): string {
    return `
${selector} {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    direction: ltr;
    font-size: ${fontSize};
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.65);
    pointer-events: none;
    z-index: 2;
    ${extra}
}`;
}

/** CSS for the pre-game main menu (exists before the HUD does). */
export interface BarAssets {
    /** glass tube overlay sprite URL (9-slice, sits on top) */
    barGlass: string;
    /** red/blood liquid fill sprite URL (9-slice, HP fill) */
    barFillRed: string;
    /** blue liquid fill sprite URL (9-slice, loading/player fill) */
    barFillBlue: string;
}

import { EXO2_LANGUAGE_IDS, LANGUAGE_IDS, type LanguageId } from './i18n/languages';
import { assetUrl } from './game/assets';

/** Brand Latin serif; Exo 2 only fills rare missing glyphs (e.g. Romanian ș/ț). */
const MARCELLUS_STACK = '"Marcellus", "Exo 2", "Palatino Linotype", Palatino, Georgia, serif';
const EXO2_STACK = '"Exo 2", "Segoe UI", system-ui, sans-serif';

/**
 * Per-language UI face — OFL, self-hosted for Steam/offline.
 * Default Marcellus; override only when Marcellus cannot render the script.
 */
const FONT_STACKS = Object.fromEntries(LANGUAGE_IDS.map((id) => [id, MARCELLUS_STACK])) as Record<
    LanguageId,
    string
>;
FONT_STACKS.zh = '"Noto Serif SC", "Songti SC", "SimSun", serif';
FONT_STACKS['zh-Hant'] = '"Noto Serif TC", "PingFang TC", "Microsoft JhengHei", serif';
FONT_STACKS.ko = '"Noto Serif KR", "Apple SD Gothic Neo", "Malgun Gothic", serif';
FONT_STACKS.ja = '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif';
FONT_STACKS.th = '"Noto Serif Thai", "Thonburi", "Tahoma", serif';
FONT_STACKS.ar = '"Noto Naskh Arabic", "Segoe UI", "Tahoma", sans-serif';
FONT_STACKS.el = '"Noto Serif", "Times New Roman", Georgia, serif';
for (const id of EXO2_LANGUAGE_IDS) {
    FONT_STACKS[id] = EXO2_STACK;
}

/** Primary family name for Pixi Text (must match an @font-face). */
const FONT_FAMILY = Object.fromEntries(LANGUAGE_IDS.map((id) => [id, 'Marcellus'])) as Record<
    LanguageId,
    string
>;
FONT_FAMILY.zh = 'Noto Serif SC';
FONT_FAMILY['zh-Hant'] = 'Noto Serif TC';
FONT_FAMILY.ko = 'Noto Serif KR';
FONT_FAMILY.ja = 'Noto Serif JP';
FONT_FAMILY.th = 'Noto Serif Thai';
FONT_FAMILY.ar = 'Noto Naskh Arabic';
FONT_FAMILY.el = 'Noto Serif';
for (const id of EXO2_LANGUAGE_IDS) {
    FONT_FAMILY[id] = 'Exo 2';
}

export { FONT_FAMILY };

// Ensure every shipped language has an entry (dev catch).
for (const id of LANGUAGE_IDS) {
    if (!FONT_STACKS[id] || !FONT_FAMILY[id]) {
        throw new Error(`Missing font mapping for language ${id}`);
    }
}

/** Default stack (English / Marcellus). */
export const FONT_UI = FONT_STACKS.en;

const EXO2_URL = (): string => assetUrl('fonts/Exo2-Variable.ttf');
const MARCELLUS_URL = (): string => assetUrl('fonts/Marcellus-Regular.ttf');
const NOTO_SC_URL = (): string => assetUrl('fonts/NotoSerifSC-Regular.otf');
const NOTO_TC_URL = (): string => assetUrl('fonts/NotoSerifTC-Regular.otf');
const NOTO_KR_URL = (): string => assetUrl('fonts/NotoSerifKR-Regular.otf');
const NOTO_JP_URL = (): string => assetUrl('fonts/NotoSerifJP-Regular.otf');
const NOTO_THAI_URL = (): string => assetUrl('fonts/NotoSerifThai-Regular.ttf');
const NOTO_ARABIC_URL = (): string => assetUrl('fonts/NotoNaskhArabic-Regular.ttf');
const NOTO_SERIF_URL = (): string => assetUrl('fonts/NotoSerif-Regular.ttf');

const injectedFaces = new Set<string>();

async function ensureLazyFace(opts: {
    id: string;
    family: string;
    url: string;
    format: 'opentype' | 'truetype';
}): Promise<void> {
    if (injectedFaces.has(opts.id)) {
        await document.fonts.load(`400 16px "${opts.family}"`).catch(() => {});
        return;
    }
    const style = document.createElement('style');
    style.dataset.font = opts.id;
    style.textContent = `
@font-face {
    font-family: '${opts.family}';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('${opts.url}') format('${opts.format}');
}`;
    document.head.appendChild(style);
    injectedFaces.add(opts.id);
    await document.fonts.load(`400 16px "${opts.family}"`).catch(() => {});
}

/** Live-switch `--font-ui` (and document direction) from the active language. */
export async function applyLanguageFont(language: LanguageId): Promise<void> {
    if (language === 'zh') {
        await ensureLazyFace({
            id: 'noto-serif-sc',
            family: 'Noto Serif SC',
            url: NOTO_SC_URL(),
            format: 'opentype',
        });
    } else if (language === 'zh-Hant') {
        await ensureLazyFace({
            id: 'noto-serif-tc',
            family: 'Noto Serif TC',
            url: NOTO_TC_URL(),
            format: 'opentype',
        });
    } else if (language === 'ko') {
        await ensureLazyFace({
            id: 'noto-serif-kr',
            family: 'Noto Serif KR',
            url: NOTO_KR_URL(),
            format: 'opentype',
        });
    } else if (language === 'ja') {
        await ensureLazyFace({
            id: 'noto-serif-jp',
            family: 'Noto Serif JP',
            url: NOTO_JP_URL(),
            format: 'opentype',
        });
    } else if (language === 'th') {
        await ensureLazyFace({
            id: 'noto-serif-thai',
            family: 'Noto Serif Thai',
            url: NOTO_THAI_URL(),
            format: 'truetype',
        });
    } else if (language === 'ar') {
        await ensureLazyFace({
            id: 'noto-naskh-arabic',
            family: 'Noto Naskh Arabic',
            url: NOTO_ARABIC_URL(),
            format: 'truetype',
        });
    } else if (language === 'el') {
        await ensureLazyFace({
            id: 'noto-serif',
            family: 'Noto Serif',
            url: NOTO_SERIF_URL(),
            format: 'truetype',
        });
    }
    const stack = FONT_STACKS[language] ?? FONT_STACKS.en;
    document.documentElement.style.setProperty('--font-ui', stack);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

/**
 * One global font setup: @font-face for Marcellus + Exo 2, --font-ui, body
 * default, and form-control inherit. Script-heavy faces (CJK / Thai / Arabic /
 * Greek) are injected on demand in {@link applyLanguageFont}.
 * Safe to inject more than once.
 */
export function fontFaceCss(): string {
    return `
@font-face {
    font-family: 'Exo 2';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url('${EXO2_URL()}') format('truetype');
}
@font-face {
    font-family: 'Marcellus';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('${MARCELLUS_URL()}') format('truetype');
}
:root { --font-ui: ${FONT_UI}; }
html, body { font-family: var(--font-ui); }
button, input, select, textarea { font-family: inherit; }
`;
}

/** The chat composer's own styling. Both sheets include it because the same
 *  ChatBar component mounts in the match HUD and in the menu's lobby — the
 *  menu only injects menuStyles(), so leaving this in hudStyles() rendered
 *  the lobby's composer as unstyled markup. */
/** The atlas icon primitive. Shared because BOTH sheets need it: the menu's
 *  own buttons carry scoped rules that happen to set these properties
 *  themselves, but anything relying on the bare class (chat emotes) rendered
 *  as nothing in the menu until a match injected hudStyles() — after which it
 *  stayed, so icons "started working" once you had played a round. */
/** The floating hover tip (CardSpellTips). Shared because BOTH sheets need
 *  it: the same component is used by the match HUD and by the menu's loadout
 *  screen, and the menu only injects menuStyles() — left in hudStyles() alone
 *  the tip mounted as an unstyled, unpositioned div at the end of <body>,
 *  i.e. invisible, until a match had injected hudStyles() once. Same trap
 *  iconBaseStyles() below documents. */

/**
 * Shared modal enter/exit. Keep duration in sync with `DIALOG_FADE_MS` in
 * `ui/dialogFade.ts`. Used by pause, game-over, settings, notices, etc.
 */
export function dialogFadeStyles(): string {
    return `
@keyframes mechili-dialog-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes mechili-dialog-out {
    from { opacity: 1; }
    to { opacity: 0; }
}
.mechili-dialog-fade {
    animation: mechili-dialog-in 0.2s ease-out;
}
.mechili-dialog-fade.mechili-dialog-out {
    animation: mechili-dialog-out 0.2s ease-in forwards;
    pointer-events: none !important;
}
@media (prefers-reduced-motion: reduce) {
    .mechili-dialog-fade,
    .mechili-dialog-fade.mechili-dialog-out {
        animation: none !important;
    }
}
`;
}

export function cardSpellTipStyles(): string {
    const u = THEME.ui;
    return `
.mechili-card-spell-tip {
    position: fixed;
    z-index: 10050;
    width: 280px;
    padding: 12px 14px;
    border-radius: 4px;
    border: 1.5px solid ${u.border};
    background: ${u.panelBgDark};
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
    cursor: default;
    color: ${u.text};
}
.mechili-card-spell-tip .ai-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.mechili-card-spell-tip .ai-icon {
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
}
.mechili-card-spell-tip .ai-title {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: bold;
    color: ${u.brassLight};
}
.mechili-card-spell-tip .ai-desc {
    font-size: 12px;
    line-height: 1.5;
    color: ${u.text};
    margin-top: 8px;
}
/* vertical icon+label list (a unit's chosen talent loadout) */
.mechili-card-spell-tip .ai-rows {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 8px;
}
/* only a rule when something sits above it */
.mechili-card-spell-tip .ai-desc + .ai-rows {
    padding-top: 8px;
    border-top: 1px solid ${u.divider};
}
.mechili-card-spell-tip .ai-row {
    display: flex;
    /* top, not centre: rows are two lines tall once a description is there,
       and the icon and cost should line up with the NAME */
    align-items: flex-start;
    gap: 7px;
    font-size: 12px;
    color: ${u.techOwned};
}
.mechili-card-spell-tip .ai-row-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
}
.mechili-card-spell-tip .ai-row-label { font-weight: bold; }
.mechili-card-spell-tip .ai-row-desc {
    font-size: 11px;
    line-height: 1.35;
    color: ${u.textMuted};
}
.mechili-card-spell-tip .ai-row-cost {
    flex: 0 0 auto;
    color: ${u.brassLight};
    font-weight: bold;
    font-variant-numeric: tabular-nums;
}
.mechili-card-spell-tip .ai-row-ico {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    font-size: 0;
}
.mechili-card-spell-tip .ai-cost {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
}
.mechili-card-spell-tip .ai-cost .money-ico.m-icon {
    width: 14px;
    height: 14px;
    margin: 0;
}
.mechili-card-spell-tip .ai-forge-ings {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 3px;
    margin: 0 0 0 auto;
    align-items: center;
    flex-shrink: 0;
}
.mechili-card-spell-tip .ai-forge-fee {
    margin-left: 2px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: ${u.brass};
    white-space: nowrap;
}
.mechili-card-spell-tip .ai-forge-ing {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
}
`;
}

export function iconBaseStyles(): string {
    return `
.m-icon {
    display: inline-block;
    width: 1.15em;
    height: 1.15em;
    vertical-align: middle;
    flex-shrink: 0;
    line-height: 0;
    color: transparent;
    overflow: hidden;
    background-repeat: no-repeat;
}
`;
}

/** Pop-up chat lines. Shared for the same reason as the composer: the same
 *  ChatFloat renders messages in the match and in the menu's lobby, and a
 *  component's styling has to live wherever the component can mount. */
export function chatFloatStyles(u: typeof THEME.ui, pc: string, ec: string): string {
    return `
@keyframes chat-pop { from { transform: translateX(-50%) scale(0.4); opacity: 0; } }
@keyframes chat-fade { to { opacity: 0; } }
.mechili-chat-float {
    position: absolute;
    left: 50%;
    bottom: 130px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    pointer-events: none;
    z-index: 14;
}
.mechili-chat-float .cf-msg {
    padding: 3px 12px;
    background: ${u.panelBgDark};
    border-radius: 4px;
    color: ${u.text};
    font-size: 13px;
    max-width: 460px;
    animation: chat-pop 0.15s ease-out, chat-fade 0.8s ease-in 6s forwards;
}
.mechili-chat-float .cf-name { font-weight: bold; color: ${u.brassLight}; }
.mechili-chat-float .cf-msg.enemy .cf-name { color: ${ec}; }
.mechili-chat-float .cf-msg.player .cf-name { color: ${pc}; }
.mechili-chat-float .cf-msg.system { font-style: italic; color: ${u.textMuted}; }
.mechili-chat-float .cf-msg.system .cf-body { color: ${u.textMuted}; }
/* lobby: sits directly above its chat bar inside the positioned container,
   instead of floating at a fixed height over the board */
.mechili-chat-float.inline { position: static; transform: none; margin-bottom: 6px; }
.mechili-chat-float .cf-msg.neutral .cf-name { color: ${u.brassLight}; }
`;
}

export function chatBarStyles(u: typeof THEME.ui): string {
    return `
.mechili-chat .c-emote { display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.mechili-chat .c-emote .m-icon { width: 26px; height: 26px; }
.mechili-chat {
    position: absolute;
    left: 50%;
    bottom: 4px;
    transform: translateX(-50%);
    width: 360px;
    user-select: none;
    z-index: 15;
}
/* lobby variant: in normal flow inside the session panel, and permanently
   expanded — see ChatBar's inline / alwaysOpen options */
.mechili-chat.inline {
    position: static;
    transform: none;
    width: 100%;
    z-index: auto;
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
    border-radius: 3px;
    background: ${u.panelBg};
    border: 1px solid ${u.border};
    color: ${u.textMuted};
    cursor: pointer;
    opacity: 0.7;
}
.mechili-chat .c-strip:hover { opacity: 1; border-color: ${u.hover}; color: ${u.text}; }
/* something was said while collapsed */
.mechili-chat.unread .c-strip { opacity: 1; border-color: ${u.brass}; color: ${u.brassLight}; }
.mechili-chat .c-panel { display: none; }
.mechili-chat.open .c-strip { display: none; }
.mechili-chat.open .c-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: linear-gradient(180deg, rgba(40, 32, 24, 0.92), rgba(20, 16, 12, 0.95));
    border: 1.5px solid ${u.border};
    border-radius: 4px;
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
    border-radius: 3px;
    cursor: pointer;
}
.mechili-chat .c-emote { transition: transform 0.12s ease, border-color 0.12s ease; }
.mechili-chat .c-emote:hover { border-color: ${u.hover}; transform: scale(1.12); }
.mechili-chat .c-emote:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35); }
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
.mechili-chat .c-send:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.35); }
.mechili-chat .c-input:focus-visible { outline: none; border-color: ${u.hover}; }
`;
}
