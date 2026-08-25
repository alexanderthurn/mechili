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
        flowers: ['#fff8f0', '#ffd84d', '#ffa8b8'],
        // faint worn-earth patches
        dirt: 'rgba(138, 122, 78, 0.5)',
        // edge darkening — kept very light so the field blends into the outer meadow
        vignette: 'rgba(18, 42, 14, 0.04)',
        grid: 'rgba(255, 255, 255, 0.2)',
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
function gamepadCursorStyles(u: (typeof THEME)['ui']): string {
    return `
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

/**
 * Shared fantasy material primitives — carved bronze frames, leather fills,
 * recessed slots, bronze buttons. Opt-in via `.m-frame` / `.m-slot` / `.m-btn-bronze`,
 * or applied to specific surfaces (settings, shop) in Phase 1.
 */
function materialStyles(u: (typeof THEME)['ui']): string {
    const leatherFill = `
        radial-gradient(ellipse at 28% 18%, rgba(255, 220, 160, 0.05), transparent 52%),
        radial-gradient(ellipse at 78% 88%, rgba(0, 0, 0, 0.35), transparent 48%),
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 0, 0, 0.035) 2px,
            rgba(0, 0, 0, 0.035) 3px
        ),
        linear-gradient(165deg, ${u.leatherHi} 0%, ${u.leatherMid} 42%, ${u.leather} 100%)
    `;
    const bronzeBevel = `
        0 10px 28px rgba(0, 0, 0, 0.55),
        0 0 0 1px ${u.frameEdge},
        0 0 0 3px ${u.frameMid},
        0 0 0 4px ${u.frameHi},
        0 0 0 5px ${u.frameLo},
        inset 0 1px 0 rgba(255, 230, 180, 0.2),
        inset 0 -2px 6px rgba(0, 0, 0, 0.5),
        inset 1px 0 0 rgba(255, 220, 160, 0.06),
        inset -1px 0 0 rgba(0, 0, 0, 0.28)
    `;
    const gem = (pos: string) =>
        `radial-gradient(circle at ${pos}, ${u.gem} 0 2.5px, ${u.gemDeep} 2.5px 3.5px, ${u.frameHi} 3.5px 6px, ${u.frameLo} 6px 7.5px, transparent 8px)`;

    return `
/* --- fantasy material primitives --- */
.m-frame {
    position: relative;
    color: ${u.cream};
    background: ${leatherFill};
    border: 1px solid ${u.frameLo};
    border-radius: 4px;
    box-shadow: ${bronzeBevel};
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
.m-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    border-radius: inherit;
    background:
        ${gem('8px 8px')},
        ${gem('calc(100% - 8px) 8px')},
        ${gem('8px calc(100% - 8px)')},
        ${gem('calc(100% - 8px) calc(100% - 8px)')};
}
.m-frame--slim {
    box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.45),
        0 0 0 1px ${u.frameEdge},
        0 0 0 2px ${u.frameMid},
        0 0 0 3px ${u.frameLo},
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        inset 0 -1px 4px rgba(0, 0, 0, 0.4);
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
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 55%, #181410 100%);
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.7),
        inset 0 -1px 0 rgba(255, 220, 160, 0.05),
        0 1px 0 rgba(180, 140, 80, 0.12);
}
.m-btn-bronze {
    appearance: none;
    -webkit-appearance: none;
    background: linear-gradient(180deg, #3a3028 0%, ${u.leatherMid} 55%, #181410 100%);
    border: 1.5px solid ${u.frameMid};
    border-radius: 4px;
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
    border-color: ${u.bronzeLight};
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
    border-color: ${u.bronze};
    color: ${u.bronzeLight};
}

/* Auto-apply ornate frames to major dialogs / menus (CSS-only — no HTML churn).
   html prefix beats later single-class chrome rules in this same stylesheet. */
html .mechili-menu,
html .mechili-name-edit .box,
html .mechili-suggest .box,
html .mechili-pause .pause-box,
html .mechili-resume .resume-box {
    position: relative;
    color: ${u.cream};
    background: ${leatherFill};
    border: 1px solid ${u.frameLo};
    border-radius: 4px;
    box-shadow: ${bronzeBevel};
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
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
    inset: 0;
    pointer-events: none;
    z-index: 2;
    border-radius: inherit;
    background:
        ${gem('8px 8px')},
        ${gem('calc(100% - 8px) 8px')},
        ${gem('8px calc(100% - 8px)')},
        ${gem('calc(100% - 8px) calc(100% - 8px)')};
}
/* Slim bronze chrome — compact HUD strips / chips / tips.
   Skip docked corner tabs (phone-menu) — multi-ring shadows look square on asymmetric radii. */
html .mechili-sidebar,
html .mechili-report,
html .mechili-username,
html .mechili-replay-controls,
html .mechili-chat.open .c-panel,
html .mechili-panel .action-info,
html .forge-slot-preview.recipes,
html .mechili-card-spell-tip,
html .mechili-touchtip,
html .m-lobby-setting-tip {
    color: ${u.cream};
    background: ${leatherFill};
    border-color: ${u.frameMid};
    box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.45),
        0 0 0 1px ${u.frameEdge},
        0 0 0 2px ${u.frameMid},
        0 0 0 3px ${u.frameLo},
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        inset 0 -1px 4px rgba(0, 0, 0, 0.4);
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
html .mechili-panel {
    color: ${u.cream};
    background: ${leatherFill};
    border: 1px solid ${u.frameLo};
    border-left: none;
    border-bottom: none;
    border-radius: 6px 0 0 0;
    box-shadow:
        0 8px 22px rgba(0, 0, 0, 0.5),
        0 0 0 1px ${u.frameEdge},
        2px 0 0 0 ${u.frameMid},
        3px 0 0 0 ${u.frameHi},
        4px 0 0 0 ${u.frameLo},
        0 -2px 0 0 ${u.frameMid},
        0 -3px 0 0 ${u.frameHi},
        0 -4px 0 0 ${u.frameLo},
        inset 0 1px 0 rgba(255, 230, 180, 0.16),
        inset 0 -2px 6px rgba(0, 0, 0, 0.45);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
html .mechili-panel::before {
    content: '';
    position: absolute;
    top: -7px;
    right: -7px;
    width: 16px;
    height: 16px;
    pointer-events: none;
    z-index: 2;
    background: radial-gradient(
        circle at 8px 8px,
        ${u.gem} 0 2.5px,
        ${u.gemDeep} 2.5px 3.5px,
        ${u.frameHi} 3.5px 6px,
        ${u.frameLo} 6px 7.5px,
        transparent 8px
    );
}
`;
}

/** Recessed bronze HP/progress tube — shared by boot loader and fightbar. */
function hpTubeTrack(u: (typeof THEME)['ui'], selector: string, height: string): string {
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

function hpTubeFill(
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

function hpTubeVal(selector: string, fontSize: string, extra = ''): string {
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

/** Display + UI face options — OFL, self-hosted for Steam/offline. */
export type UiFontId = 'cinzel' | 'exo2' | 'marcellus';

export const UI_FONTS: Record<
    UiFontId,
    { label: string; hint: string; stack: string }
> = {
    cinzel: {
        label: 'Cinzel',
        hint: 'fantasy titles',
        stack: '"Cinzel", "Palatino Linotype", Palatino, Georgia, serif',
    },
    exo2: {
        label: 'Exo 2',
        hint: 'modern HUD',
        stack: '"Exo 2", "Segoe UI", system-ui, sans-serif',
    },
    marcellus: {
        label: 'Marcellus',
        hint: 'default',
        stack: '"Marcellus", "Palatino Linotype", Palatino, Georgia, serif',
    },
};

/** Default stack (Marcellus) — Pixi / callers that need a concrete family string. */
export const FONT_UI = UI_FONTS.marcellus.stack;

const CINZEL_URL = new URL('../assets/fonts/Cinzel-Variable.ttf', import.meta.url).href;
const EXO2_URL = new URL('../assets/fonts/Exo2-Variable.ttf', import.meta.url).href;
const MARCELLUS_URL = new URL('../assets/fonts/Marcellus-Regular.ttf', import.meta.url).href;

/** Live-switch `--font-ui` (everything inherits via body + form-control rules). */
export function applyUiFont(id: UiFontId): void {
    const font = UI_FONTS[id] ?? UI_FONTS.marcellus;
    document.documentElement.style.setProperty('--font-ui', font.stack);
}

/**
 * One global font setup: @font-face for all candidates, --font-ui, body default,
 * and form-control inherit (buttons/inputs ignore parent font-family otherwise).
 * Safe to inject more than once.
 */
export function fontFaceCss(): string {
    return `
@font-face {
    font-family: 'Cinzel';
    font-style: normal;
    font-weight: 400 900;
    font-display: swap;
    src: url('${CINZEL_URL}') format('truetype');
}
@font-face {
    font-family: 'Exo 2';
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url('${EXO2_URL}') format('truetype');
}
@font-face {
    font-family: 'Marcellus';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('${MARCELLUS_URL}') format('truetype');
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
function dialogFadeStyles(): string {
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

function cardSpellTipStyles(): string {
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

function iconBaseStyles(): string {
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
function chatFloatStyles(u: typeof THEME.ui, pc: string, ec: string): string {
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

function chatBarStyles(u: typeof THEME.ui): string {
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
    background: linear-gradient(180deg, #3a3028 0%, ${u.leatherMid} 55%, #181410 100%);
    border: 1.5px solid ${u.frameMid};
    border-radius: 4px;
    color: ${u.cream};
    font-size: 16px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-align: left;
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
.mechili-menu .m-status { font-size: 14px; color: ${u.phase}; max-width: 380px; text-align: center; }
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
    text-align: left;
    transition: transform 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.mechili-menu .m-room::before { content: '▸ '; color: ${u.brass}; }
.mechili-menu .m-room:hover { border-color: ${u.hover}; color: ${u.brassLight}; transform: translateX(2px); }
.mechili-menu .m-room:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.3); }
/* a running match, joinable only as a spectator — visually distinct from
   an open (joinable-as-player) room above */
.mechili-menu .m-room-spectate { border-style: dashed; }
.mechili-menu .m-room-spectate::before { content: '👁 '; }
.mechili-menu .m-room-spectate:hover { border-color: ${u.hover}; }
/* a running match with OUR OWN seat currently disconnected — resume it
   instead of spectating */
.mechili-menu .m-room-row { display: flex; gap: 8px; width: 100%; }
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
    left: calc(24px + env(safe-area-inset-left));
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
    right: calc(24px + env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: clamp(250px, 26vw, 340px);
    max-height: calc(100% - 120px);
}
.mechili-loadout .lo-corner {
    bottom: calc(24px + env(safe-area-inset-bottom));
    right: calc(24px + env(safe-area-inset-right));
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
    background: rgba(16, 13, 10, 0.72);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    border: 1.5px solid ${u.frameLo};
    border-radius: 4px;
}
.mechili-loadout .lo-stat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 11px;
    border-bottom: 1px solid rgba(92, 70, 52, 0.35);
    font-size: 12px;
}
.mechili-loadout .lo-stat:last-child { border-bottom: none; }
.mechili-loadout .lo-stat .k {
    color: ${u.textMuted};
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 10px;
}
.mechili-loadout .lo-stat .v {
    color: ${u.cream};
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
    background: rgba(16, 13, 10, 0.72);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    border: 1.5px solid ${u.frameLo};
    border-radius: 3px;
    color: ${u.textMuted};
    font-family: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}
.mechili-loadout .lo-tech:hover { border-color: ${u.hover}; color: ${u.cream}; }
.mechili-loadout .lo-tech.is-on {
    background: linear-gradient(180deg, rgba(58, 48, 40, 0.9) 0%, rgba(34, 28, 23, 0.9) 100%);
    border-color: ${u.brass};
    color: ${u.cream};
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
    background: linear-gradient(180deg, rgba(58, 48, 40, 0.9) 0%, rgba(34, 28, 23, 0.9) 100%);
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
    background: rgba(10, 8, 6, 0.6);
    border: 1.5px dashed ${u.slotBorder};
    cursor: default;
}
.mechili-loadout .lo-sico { width: 26px; height: 26px; font-size: 0; }

/* ---- corner buttons ---- */
.mechili-loadout .lo-cornerbtn {
    padding: 9px 18px;
    background: rgba(16, 13, 10, 0.8);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    border: 1.5px solid ${u.border};
    border-radius: 3px;
    color: ${u.text};
    font-family: inherit;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
}
.mechili-loadout .lo-cornerbtn:hover {
    border-color: ${u.hover};
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
        /* keep clear of the corner buttons, which stay pinned top-right */
        padding-right: 104px;
    }
    .mechili-loadout .lo-corner {
        top: calc(10px + env(safe-area-inset-top));
        right: calc(10px + env(safe-area-inset-right));
        bottom: auto;
        flex-direction: column;
        gap: 6px;
    }
    .mechili-loadout .lo-switcher { width: auto; max-width: none; }
    .mechili-loadout .lo-unitname { font-size: 20px; text-align: left; }
    .mechili-loadout .lo-statstoggle {
        display: block;
        width: 100%;
        padding: 6px 10px;
        background: rgba(16, 13, 10, 0.72);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
        border: 1.5px solid ${u.frameLo};
        border-radius: 3px;
        color: ${u.textMuted};
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
.mechili-menu .m-toggle-card {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
    padding: 14px 10px;
    background: linear-gradient(180deg, #3a3028 0%, ${u.leatherMid} 55%, #181410 100%);
    border: 1.5px solid ${u.frameMid};
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
    justify-content: center;
    gap: 6px;
    text-align: center;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 0.2px;
    border-radius: 3px;
    background: ${u.panelBgDark};
    border: 1.5px solid ${u.border};
    color: ${u.text};
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
.mechili-menu .m-lobby-settings .m-field { min-width: 0; }
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
/* Desktop lobby: give name seats more room; widen further when advanced
   settings sit beside the roster */
@media (min-width: 720px) {
    .mechili-menu:has(.m-session.is-active) {
        width: min(440px, 92vw);
    }
    .mechili-menu:has(.m-session.is-active.m-has-lobby-settings.m-lobby-settings-open) {
        width: min(760px, 94vw);
    }
    .mechili-menu .m-session.m-has-lobby-settings.m-lobby-settings-open .m-session-layout {
        display: grid;
        grid-template-columns: minmax(260px, 1.2fr) minmax(200px, 0.85fr);
        gap: 14px 18px;
        align-items: start;
    }
    .mechili-menu .m-session.m-has-lobby-settings.m-lobby-settings-open .m-lobby-settings {
        max-width: none;
    }
}
/* Narrow / single-column lobby: use more horizontal room so advanced
   settings (2-col selects) and the main button stack aren't tiny. */
@media (max-width: 719px) {
    .mechili-menu {
        width: min(92vw, 420px);
    }
    .mechili-menu:has(.m-session.is-active) {
        width: min(94vw, 460px);
    }
    .mechili-menu:has(.m-session.is-active.m-has-lobby-settings.m-lobby-settings-open) {
        width: min(96vw, 520px);
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
    right: calc(16px + env(safe-area-inset-right));
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
.mechili-loadout-btn {
    display: flex;
    bottom: calc(14px + 60px + env(safe-area-inset-bottom));
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

/* Top-right menu chrome: door (Electron quit) + settings gear */
.mechili-corner-actions {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    right: calc(16px + env(safe-area-inset-right));
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
    right: calc(16px + env(safe-area-inset-right));
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

/* suggest chip, top-left of the main menu (same feel as username) */
.mechili-suggest-btn {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top));
    left: calc(16px + env(safe-area-inset-left));
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
    left: calc(16px + env(safe-area-inset-left));
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
.mechili-intro-cover.dive .mechili-match-roster {
    /* same beat as the logo — roster shouldn't linger through the dive */
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
    color: ${u.text};
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
    width: min(360px, calc(100vw - 32px));
    max-height: min(88vh, calc(100dvh - 32px));
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
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
.mechili-settings .s-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.mechili-settings .s-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
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
    transition: border-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
}
.mechili-settings .s-preset:hover {
    border-color: ${u.bronzeLight};
    color: ${u.cream};
    transform: translateY(-1px);
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
.mechili-settings .s-row select {
    margin-left: auto;
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
/* Desktop: use horizontal space — general left, graphics right */
@media (min-width: 720px) {
    .mechili-settings .box {
        width: min(720px, calc(100vw - 48px));
        padding: 22px 24px 18px;
    }
    .mechili-settings .s-title { font-size: 17px; letter-spacing: 0.26em; }
    .mechili-settings .s-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
        gap: 8px 28px;
        align-items: start;
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
    background: ${u.undoBg};
    border: 2px solid ${u.undoBorder};
    border-radius: 3px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
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
.mechili-phone-status .undo:hover { background: ${u.undoHover}; transform: translateY(-1px); }
.mechili-extras .undo:focus-visible,
.shop-toolbar .undo:focus-visible,
.mechili-phone-status .undo:focus-visible { outline: none; border-color: ${u.undoText}; box-shadow: 0 0 0 3px rgba(168, 120, 64, 0.4); }

/* top-right stack under the enemy commander strip: ☰ on every device,
   plus supply/undo/level-all on phone */
.mechili-phone-status {
    display: flex;
    position: absolute;
    /* clear portraits + HP tube + name under the enemy strip */
    top: calc(78px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
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
    min-height: 40px;
    padding: 6px 10px;
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
    background: linear-gradient(180deg, #3a3028 0%, ${u.leatherMid} 55%, #181410 100%);
    border: 1.5px solid ${u.frameMid};
    border-radius: 4px;
    box-shadow:
        inset 0 1px 0 rgba(255, 230, 180, 0.14),
        inset 0 -2px 4px rgba(0, 0, 0, 0.45),
        0 2px 8px rgba(0, 0, 0, 0.4);
    color: ${u.cream};
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
    border-color: ${u.bronzeLight};
    background: linear-gradient(180deg, #4a4034 0%, ${u.leatherHi} 55%, #1c1610 100%);
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
    background: ${u.panelBgSolid};
    border: 2px solid ${u.border};
    border-radius: 3px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
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
.mechili-phone-status .level-all-global:hover { border-color: ${u.hover}; transform: translateY(-1px); }
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
    /* 3× ~80% tiles vs prior 2-col (~97px → ~78px) */
    width: 274px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 12px 14px;
    position: relative;
    color: ${u.cream};
    background:
        radial-gradient(ellipse at 28% 18%, rgba(255, 220, 160, 0.05), transparent 52%),
        radial-gradient(ellipse at 78% 88%, rgba(0, 0, 0, 0.35), transparent 48%),
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 0, 0, 0.035) 2px,
            rgba(0, 0, 0, 0.035) 3px
        ),
        linear-gradient(165deg, ${u.leatherHi} 0%, ${u.leatherMid} 42%, ${u.leather} 100%);
    border: 1px solid ${u.frameLo};
    border-right: none;
    border-bottom: none;
    border-radius: 6px 0 0 0;
    box-shadow:
        0 8px 22px rgba(0, 0, 0, 0.5),
        0 0 0 1px ${u.frameEdge},
        -2px 0 0 0 ${u.frameMid},
        -3px 0 0 0 ${u.frameHi},
        -4px 0 0 0 ${u.frameLo},
        0 -2px 0 0 ${u.frameMid},
        0 -3px 0 0 ${u.frameHi},
        0 -4px 0 0 ${u.frameLo},
        inset 0 1px 0 rgba(255, 230, 180, 0.16),
        inset 0 -2px 6px rgba(0, 0, 0, 0.45);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    pointer-events: auto;
}
.mechili-shop::before {
    content: '';
    position: absolute;
    top: -7px;
    left: -7px;
    width: 16px;
    height: 16px;
    pointer-events: none;
    z-index: 2;
    background: radial-gradient(
        circle at 8px 8px,
        ${u.gem} 0 2.5px,
        ${u.gemDeep} 2.5px 3.5px,
        ${u.frameHi} 3.5px 6px,
        ${u.frameLo} 6px 7.5px,
        transparent 8px
    );
}
.mechili-shop .shop-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${u.frameLo};
    box-shadow: 0 1px 0 rgba(255, 220, 160, 0.06);
}
.mechili-shop .shop-header .unit-cap {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums;
    color: ${u.bronzeLight};
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
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
    grid-template-rows: repeat(2, 78px);
    grid-auto-flow: column;
    /* Keep tile size stable. */
    grid-auto-columns: 78px;
    /* Fill columns from the right edge inward. */
    direction: rtl;
    width: 100%;
    box-sizing: border-box;
    gap: 6px;
}
/* The shared grid above fills from the RIGHT (direction: rtl) because the
   shop is pinned to the right edge of the screen. The unlock dialog is a
   centred modal, so it reads wrong there — fill from the left instead. The
   tiles reset direction themselves so their own content is unaffected. */
.mechili-cards .unlock-picker .shop-grid {
    direction: ltr;
    justify-content: start;
}
.mechili-shop-col .shop-tile,
.mechili-cards .unlock-picker .shop-tile {
    direction: ltr;
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
.mechili-panel .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
.mechili-panel .team { font-size: 11px; letter-spacing: 0.5px; margin-bottom: 8px; }
.mechili-panel .team.player { color: ${pc}; }
.mechili-panel .team.enemy { color: ${ec}; }
.mechili-panel .team.horde { color: ${HORDE_COLOR.css}; }
.mechili-panel .row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-panel .row .v { color: ${u.brass}; font-variant-numeric: tabular-nums; }
.mechili-panel .xpbar { height: 5px; margin: 0 0 5px; background: rgba(255, 255, 255, 0.38); border-radius: 3px; overflow: hidden; }
.mechili-panel .xpbar.player div { height: 100%; background: ${pc}; }
.mechili-panel .xpbar.enemy div { height: 100%; background: ${ec}; }
.mechili-panel .xpbar.horde div { height: 100%; background: ${HORDE_COLOR.css}; }
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
    border-radius: 3px;
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
    background: linear-gradient(180deg, #0c0a08 0%, ${u.slotBg} 55%, #181410 100%);
    border: 1px solid ${u.slotBorder};
    border-radius: 3px;
    color: ${u.cream};
    cursor: pointer;
    overflow: visible;
    box-shadow:
        inset 0 2px 5px rgba(0, 0, 0, 0.65),
        inset 0 -1px 0 rgba(255, 220, 160, 0.05),
        0 1px 0 rgba(180, 140, 80, 0.1);
}
.mechili-panel .action-tile:has(.at-cost) { padding-bottom: 12px; }
.mechili-panel .action-tile .at-icon { font-size: 27px; line-height: 1; }
/* supply / price coin — scales with surrounding text by default */
.money-ico.m-icon {
    width: 1em;
    height: 1em;
    margin-right: 0.2em;
    vertical-align: -0.12em;
}
.mechili-sidebar .inv-item .m-icon { width: 30px; height: 30px; }
.mechili-sidebar .inv-item:not(.tactic) { border-radius: 50%; overflow: hidden; padding: 0; }
.mechili-sidebar .inv-item:not(.tactic) .m-icon { width: 100%; height: 100%; }
.mechili-panel .action-tile .at-icon.m-icon { width: 28px; height: 28px; font-size: 0; }
.mechili-panel .action-info .ai-icon.m-icon { width: 28px; height: 28px; font-size: 0; }
.mechili-panel .item-sq.m-icon { width: 44px; height: 44px; font-size: 0; border-radius: 50%; overflow: hidden; }
.mechili-phonebar button .pb-ico.m-icon { width: 22px; height: 22px; font-size: 0; }
.mechili-fightbar .chat-bubble.emote .m-icon { width: 56px; height: 56px; vertical-align: 0; }
.mechili-fightbar .cf-body .m-icon { width: 28px; height: 28px; vertical-align: -6px; }
.inv-drag.m-icon { width: 40px; height: 40px; font-size: 0; background-color: ${u.techBuyBg}; }
.btn-ico.m-icon { width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px; }
.mechili-phone-status .btn-ico.m-icon { width: 22px; height: 22px; margin: 0; }
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
.mechili-panel .action-tile:focus-visible { outline: none; border-color: ${u.brassLight}; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }
.mechili-panel .action-tile.locked { opacity: 0.42; }
.mechili-panel .action-tile.owned { border-color: ${u.techOwned}; cursor: default; }
.mechili-panel .action-tile.owned .at-icon { opacity: 0.7; }
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
    background: ${u.techBuyBg};
    border: 1.5px solid ${u.border};
    cursor: default;
    pointer-events: auto;
}
.mechili-panel .tech-slots { margin-top: 10px; }

/* the big hover frame — pops to the right of the panel with full details */
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
.mechili-sidebar.right {
    right: env(safe-area-inset-right);
    border-right: none;
    border-radius: 4px 0 0 4px;
    /* enemy intel only shows on the enemy commander's detail screen */
    display: none;
}
.mechili-sidebar.right.reveal:not(.battle) {
    display: flex;
    /* above the detail overlay's dim layer */
    z-index: 60;
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
.mechili-sidebar .inv-item.readonly { cursor: default; pointer-events: none; }
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
.mechili-panel .forge-block { margin: 4px 0 10px; }
.mechili-panel .forge-block.ready {
    padding: 8px 8px 6px;
    margin-left: -8px;
    margin-right: -8px;
    border-radius: 4px;
    background: rgba(0, 80, 40, 0.22);
    box-shadow: inset 0 0 0 1px rgba(0, 255, 102, 0.45);
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
    color: #7dffb0;
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
    color: #7dffb0;
    opacity: 0.9;
    flex: 0 0 auto;
}
.mechili-panel .item-sq.forge-bake {
    box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.85), 0 0 12px rgba(0, 255, 102, 0.45);
    animation: forge-bake-pulse 1.25s ease-in-out infinite;
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
    0%, 100% { box-shadow: inset 0 0 0 1px rgba(0, 255, 102, 0.4); }
    50% { box-shadow: inset 0 0 0 1px rgba(0, 255, 102, 0.85), 0 0 14px rgba(0, 255, 102, 0.2); }
}
@keyframes forge-bake-pulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.7), 0 0 8px rgba(0, 255, 102, 0.35); }
    50% { box-shadow: 0 0 0 3px rgba(0, 255, 102, 1), 0 0 16px rgba(0, 255, 102, 0.65); }
}
@media (prefers-reduced-motion: reduce) {
    .mechili-panel .forge-block.ready,
    .mechili-panel .item-sq.forge-bake { animation: none; }
}
.mechili-panel .item-sq {
    width: 44px;
    height: 44px;
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
    background: ${u.techBuyBg};
    border: 1.5px solid ${u.border};
    cursor: default;
}
.mechili-panel .item-sq.empty.drop-target {
    border-color: #00ff66;
    box-shadow: 0 0 0 1px rgba(0, 255, 102, 0.35), 0 0 10px rgba(0, 255, 102, 0.45);
    cursor: pointer;
}
.mechili-panel .item-sq.empty.drop-target:hover {
    filter: brightness(1.15);
    box-shadow: 0 0 0 2px #00ff66, 0 0 14px rgba(0, 255, 102, 0.7);
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
    box-shadow: 0 0 0 1.5px rgba(0, 255, 102, 0.55);
    opacity: 0.95;
}
.mechili-panel .item-sq.forge-suggest:hover {
    box-shadow: 0 0 0 2px rgba(0, 255, 102, 0.9), 0 0 10px rgba(0, 255, 102, 0.35);
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
    border-left: 1px solid ${u.divider};
    padding-left: 10px;
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
        border-left: none;
        padding-left: 0;
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
    right: 8px;
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
    text-align: left;
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
    padding-right: 8px;
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
.mechili-gameover .go-restart {
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
.mechili-gameover .go-restart {
    align-self: center;
    padding: 10px 26px;
    background: ${u.alliedBtnBg};
    border: 1.5px solid ${pc};
    border-radius: 4px;
    color: ${pc};
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-gameover .go-restart { transition: transform 0.14s ease, background 0.14s ease; }
.mechili-gameover .go-restart:hover { background: ${u.alliedBtnHover}; transform: translateY(-2px); }
.mechili-gameover .go-restart:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.4); }

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
    background: ${u.panelBgSolid};
    border: 1px solid ${u.border};
    border-radius: 999px;
    color: ${u.text};
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
    background: linear-gradient(180deg, ${u.panelBgSolid} 0%, ${u.panelBgDark} 100%);
    border: 1px solid ${u.border};
    border-radius: 3px;
    padding: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
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
    background: rgba(255, 255, 255, 0.06);
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
    padding: 6px 10px;
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
    border-radius: 50%;
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
    align-items: center;
    /* overlap toward the featured main (DOM: sub then main) */
    margin-right: -6px;
}
.mechili-fightbar .fighter.enemy .portrait-sub-stack {
    margin-right: 0;
    margin-left: -6px;
}
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
.mechili-topbar .round { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
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
    background: ${u.bronze};
    border: 1.5px solid ${u.frameHi};
    border-radius: 3px;
    color: #1a140c;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 1.5px;
    cursor: pointer;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
    transition: transform 0.14s ease, box-shadow 0.14s ease, background 0.14s ease, filter 0.14s ease;
}
.mechili-topbar .end-deploy:hover {
    background: ${u.bronzeLight};
    transform: translateY(-1px);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.45);
}
.mechili-topbar .end-deploy:active { transform: translateY(0) scale(0.97); }
.mechili-topbar .end-deploy:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(184, 146, 74, 0.45); }
/* a teammate (2v2/duo) already locked in — left half lights brass so
   both seats on a side can see who's still holding things up */
.mechili-topbar .end-deploy.ally-ready {
    background: linear-gradient(90deg, ${u.brassLight} 0%, ${u.brassLight} 48%, ${u.bronze} 52%, ${u.bronze} 100%);
    border-color: ${u.frameHi};
}
.mechili-topbar .end-deploy.ally-ready:hover {
    background: linear-gradient(90deg, #e8d49a 0%, #e8d49a 48%, ${u.bronzeLight} 52%, ${u.bronzeLight} 100%);
    border-color: ${u.brassLight};
}
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
    border-radius: 3px;
    color: ${u.brass};
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.mechili-topbar .speed { transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; }
.mechili-topbar .speed:hover { background: ${u.speedHover}; border-color: ${u.brassLight}; }
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
    background: linear-gradient(180deg, ${u.leatherHi} 0%, ${u.leather} 100%);
    border-top: 2px solid ${u.frameMid};
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
`;
}
