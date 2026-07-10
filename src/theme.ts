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

    // placement markers
    valid: 0x8ec858,
    invalid: 0xe83828,
    select: 0xffd040,
    movable: 0xffffff,

    // combat effects
    muzzle: 0xffe8a0,
    impact: 0xffa040,
    death: 0xff6030,
    deathSecondary: 0xffd060,
    deathSmall: 0xff8840,
    levelup: 0xffe040,
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
        // edge darkening that pushes the eye to the field center
        vignette: 'rgba(18, 42, 14, 0.22)',
        border: 'rgba(100, 140, 70, 0.75)',
        grid: 'rgba(255, 255, 255, 0.2)',
        centerLine: 'rgba(255, 220, 80, 0.6)',
        flankLocked: 'rgba(140, 170, 100, 0.14)',
        sunWashTop: 'rgba(255, 248, 200, 0.18)',
        sunWashBottom: 'rgba(255, 248, 200, 0)',
        groundRoughness: 0.88,
    },

    scenery: {
        // sky dome gradient, zenith to horizon (horizon must equal `sky` above)
        skyZenith: '#5aa8dc',
        skyMid: '#8cc4e4',
        skyHorizon: '#b8d4c8',
        sunGlow: 'rgba(255, 244, 200, 1)',
        // the world beyond the battlefield
        outerGround: 0x4e9040,
        trunk: 0x6a4a32,
        pine: 0x2e6e34,
        pineLight: 0x48904a,
        leaf: 0x4c9a3e,
        leafLight: 0x74bc52,
        rock: 0x8a8d82,
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

/** CSS block for the HTML HUD — generated from {@link THEME}. */
export function hudStyles(): string {
    const u = THEME.ui;
    return `
.mechili-hud {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-hud.disabled { opacity: 0.35; pointer-events: none; }
.mechili-hud button {
    width: 86px;
    height: 86px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px;
    background: ${u.panelBgSolid};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    color: ${u.text};
    cursor: pointer;
}
.mechili-hud button:hover { border-color: ${u.hover}; }
.mechili-hud button:active { transform: scale(0.94); }
.mechili-hud button.unaffordable { opacity: 0.35; pointer-events: none; }

.mechili-panel {
    position: absolute;
    left: 16px;
    bottom: 16px;
    min-width: 180px;
    padding: 12px 14px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    color: ${u.text};
    user-select: none;
}
.mechili-panel .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
.mechili-panel .team { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.mechili-panel .team.player { color: ${u.player}; }
.mechili-panel .team.enemy { color: ${u.enemy}; }
.mechili-panel .row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-panel .row .v { color: ${u.brass}; font-variant-numeric: tabular-nums; }
.mechili-panel .hpbar { height: 6px; margin: 6px 0 8px; background: ${u.barTrack}; border-radius: 3px; overflow: hidden; }
.mechili-panel .hpbar div { height: 100%; background: ${u.hpBar}; }
.mechili-panel .techs { margin-top: 10px; border-top: 1px solid ${u.divider}; padding-top: 8px; }
.mechili-panel .tech-buy {
    display: flex; justify-content: space-between; gap: 12px; width: 100%;
    margin: 3px 0; padding: 5px 8px;
    background: ${u.techBuyBg}; border: 1px solid ${u.border}; border-radius: 6px;
    color: ${u.text}; font-size: 11.5px; cursor: pointer;
}
.mechili-panel .tech-buy:hover { border-color: ${u.hover}; }
.mechili-panel .tech-buy .c { color: ${u.brass}; }
.mechili-panel .tech-buy:disabled { opacity: 0.4; pointer-events: none; }
.mechili-panel .tech-owned {
    display: flex; justify-content: space-between; gap: 12px;
    margin: 3px 0; padding: 5px 8px; font-size: 11.5px; color: ${u.techOwned};
}

.mechili-inv {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 8px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-inv .inv-title { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: ${u.textMuted}; }
.mechili-inv .inv-item {
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
.mechili-inv .inv-item:hover { border-color: ${u.hover}; }
.mechili-inv .inv-item.armed { border-color: ${u.brass}; box-shadow: 0 0 10px ${u.brass}; }
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

.mechili-panel .item-row { display: flex; gap: 4px; margin: 2px 0 6px; }
.mechili-panel .item-sq {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    background: ${u.techBuyBg};
    border: 1px solid ${u.brassDark};
    border-radius: 5px;
}

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
.mechili-cards .card:disabled { opacity: 0.4; pointer-events: none; }
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
.mechili-cards .cards-skip:hover { background: ${u.undoHover}; }

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
    background: ${u.panelBgDark};
    border: 2px solid ${u.border};
    border-radius: 16px;
    font-family: system-ui, sans-serif;
    user-select: none;
}
.mechili-gameover .go-title { font-size: 44px; font-weight: 900; letter-spacing: 10px; }
.mechili-gameover.victory .go-title { color: ${u.player}; }
.mechili-gameover.defeat .go-title { color: ${u.enemy}; }
.mechili-gameover.draw .go-title { color: ${u.brassLight}; }
.mechili-gameover .go-restart {
    padding: 10px 26px;
    background: ${u.alliedBtnBg};
    border: 1.5px solid ${u.player};
    border-radius: 10px;
    color: ${u.player};
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-gameover .go-restart:hover { background: ${u.alliedBtnHover}; }

.mechili-report {
    position: absolute;
    right: 14px;
    top: 64px;
    min-width: 200px;
    padding: 12px 14px;
    background: ${u.panelBg};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    color: ${u.text};
    user-select: none;
}
.mechili-report .r-title { font-size: 13px; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 16px; }
.mechili-report .r-close { background: none; border: none; color: ${u.textMuted}; cursor: pointer; font-size: 14px; padding: 0; }
.mechili-report .r-row { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; padding: 1.5px 0; }
.mechili-report .r-row .n.player { color: ${u.player}; }
.mechili-report .r-row .n.enemy { color: ${u.enemy}; }
.mechili-report .r-row .d { color: ${u.brass}; font-variant-numeric: tabular-nums; }
.mechili-hud .name { font-size: 12px; font-weight: bold; letter-spacing: 1px; }
.mechili-hud .icon { width: 24px; height: 24px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, ${u.iconCenter}, ${u.iconEdge} 70%); }
.mechili-hud .cost { font-size: 12px; color: ${u.brassLight}; }
.mechili-hud .size { font-size: 10px; color: ${u.textMuted}; }

.mechili-help {
    position: absolute;
    right: 14px;
    bottom: 12px;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.7;
    color: ${u.textMuted};
    text-align: right;
    user-select: none;
    pointer-events: none;
}
.mechili-help b { color: ${u.helpBold}; font-weight: 600; }

.mechili-topbar {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 18px;
    background: ${u.panelBgSolid};
    border: 1.5px solid ${u.border};
    border-radius: 10px;
    font-family: system-ui, sans-serif;
    color: ${u.text};
    user-select: none;
}
.mechili-topbar .round { font-size: 15px; font-weight: bold; letter-spacing: 1px; }
.mechili-topbar .phase { font-size: 13px; color: ${u.phase}; letter-spacing: 1px; text-transform: uppercase; }
.mechili-topbar .timer { font-size: 18px; font-weight: bold; font-variant-numeric: tabular-nums; color: ${u.brassLight}; }
.mechili-topbar .supply { font-size: 16px; font-weight: bold; font-variant-numeric: tabular-nums; color: ${u.brass}; }
.mechili-topbar .supply::before { content: '⬢ '; color: ${u.brassDark}; }
.mechili-topbar .deploys { font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums; color: ${u.phase}; }
.mechili-topbar.battle .deploys { display: none; }
.mechili-topbar .hp { font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums; }
.mechili-topbar .hp.player { color: ${u.player}; }
.mechili-topbar .hp.enemy { color: ${u.enemy}; }
.mechili-topbar .hp::before { content: '♥ '; opacity: 0.6; }
.mechili-topbar .end-deploy {
    padding: 7px 14px;
    background: ${u.alliedBtnBg};
    border: 1.5px solid ${u.player};
    border-radius: 8px;
    color: ${u.player};
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 1px;
    cursor: pointer;
}
.mechili-topbar .end-deploy:hover { background: ${u.alliedBtnHover}; }
.mechili-topbar .undo {
    padding: 7px 12px;
    background: ${u.undoBg};
    border: 1.5px solid ${u.undoBorder};
    border-radius: 8px;
    color: ${u.undoText};
    font-size: 13px;
    font-weight: bold;
    cursor: pointer;
}
.mechili-topbar .undo:hover { background: ${u.undoHover}; }
.mechili-topbar.battle .end-deploy, .mechili-topbar.battle .undo { display: none; }
.mechili-topbar.battle .timer { color: ${u.enemy}; }
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
.mechili-topbar .speed:hover { background: ${u.speedHover}; }
.mechili-topbar.battle .speed { display: inline-block; }
`;
}
