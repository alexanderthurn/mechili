import {
    applyGraphicsPreset,
    detectGraphicsPreset,
    prefs,
    resetSettingsStorage,
    updatePrefs,
    type GraphicsPreset,
    type Prefs,
} from '../game/prefs';
import { isElectron, win } from 'steam-electron-build/native';

import { availableTransports } from '../game/multiplayerTransport';
import {
    LANGUAGE_IDS,
    LANGUAGE_NATIVE_NAMES,
    setLanguage,
    t,
    type LanguageId,
} from '../i18n';
import { applyLanguageFont } from '../theme';
import { removeWithDialogFade, withDialogFade } from './dialogFade';

const STEAM_URL = 'https://steam.melodan.com';

/** Copy goes through innerHTML in the help sheet — keep translated text inert. */
function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * The settings dialog — one shared overlay, opened from the main menu and
 * from the in-game top bar. Options apply immediately and persist.
 * Desktop: two columns (general | graphics). Narrow: single stacked column.
 */
/** dismiss the shared settings overlay if open (menu or in-match). */
export function closeSettings(immediate = false): void {
    const el = document.querySelector<HTMLElement>('.mechili-settings');
    if (!el) return;
    if (immediate) el.remove();
    else removeWithDialogFade(el, () => el.remove());
}

export function openSettings(parent: HTMLElement): void {
    if (document.querySelector('.mechili-settings')) return; // already open

    const langOptions = LANGUAGE_IDS.map(
        (id) => `<option value="${id}">${LANGUAGE_NATIVE_NAMES[id]}</option>`,
    ).join('');

    const overlay = withDialogFade(document.createElement('div'));
    overlay.classList.add('mechili-settings');
    // #match-ui-root is pointer-events:none — without this, in-match Settings
    // (opened from pause) looks fine but nothing inside is clickable.
    overlay.style.pointerEvents = 'auto';

    const paintChrome = (): void => {
        overlay.querySelector('.s-title')!.textContent = t('settings:title');
        overlay.querySelector('.s-look-head')!.textContent = t('settings:look');
        overlay.querySelector('.s-lang-label')!.textContent = t('common:language');
        overlay.querySelector('.s-controls-head')!.textContent = t('settings:controls');
        overlay.querySelector('[data-act="controls-help"]')!.textContent = t('settings:controlsHelp');
        overlay.querySelector('.s-chat-head')!.textContent = t('settings:chat');
        overlay.querySelector('.s-combat-text')!.textContent = t('settings:combatChat');
        overlay.querySelector('.s-mp-head')!.textContent = t('settings:multiplayer');
        overlay.querySelector('.s-mp-label')!.textContent = t('settings:connection');
        overlay.querySelector('.s-debug-head')!.textContent = t('settings:debug');
        overlay.querySelector('.s-debug-text')!.textContent = t('settings:debugOverlay');
        overlay.querySelector('.s-debug-hint')!.textContent = t('settings:debugHint');
        overlay.querySelector('.s-gfx-head')!.textContent = t('settings:graphics');
        overlay.querySelector('[data-act="reset"]')!.textContent = t('settings:resetAll');
        overlay.querySelector('[data-act="close"]')!.textContent = t('settings:close');
        const note = overlay.querySelector<HTMLElement>('.s-mp-note');
        if (note) {
            note.innerHTML = t('settings:mpNote', {
                link: `<a href="${STEAM_URL}" target="_blank" rel="noopener noreferrer">${STEAM_URL}</a>`,
            });
        }
        const fsText = overlay.querySelector<HTMLElement>('.s-fullscreen-text');
        if (fsText) fsText.textContent = t('settings:gfx.fullscreen');
        const fsHint = overlay.querySelector<HTMLElement>('.s-fullscreen-hint');
        if (fsHint) fsHint.textContent = t('settings:gfx.fullscreenHint');
        for (const button of overlay.querySelectorAll<HTMLButtonElement>('.s-preset[data-preset]')) {
            const id = button.dataset.preset!;
            button.textContent = t(`settings:gfx.preset${id.charAt(0).toUpperCase()}${id.slice(1)}`);
        }
        overlay.querySelector('.s-custom-chip')!.textContent = t('settings:gfx.presetCustom');
        overlay.querySelector('.s-advanced > summary')!.textContent = t('settings:gfx.advanced');
        const setLabel = (sel: string, key: string) => {
            const el = overlay.querySelector<HTMLElement>(sel);
            if (el) el.textContent = t(key);
        };
        setLabel('.s-scenery-label', 'settings:gfx.scenery');
        setLabel('.s-scenery-hint', 'settings:gfx.sceneryHint');
        setLabel('.s-ground-label', 'settings:gfx.groundEffects');
        setLabel('.s-ground-hint', 'settings:gfx.groundHint');
        setLabel('.s-fire-label', 'settings:gfx.fireEffects');
        setLabel('.s-fire-hint', 'settings:gfx.fireHint');
        setLabel('.s-blood-label', 'settings:gfx.blood');
        setLabel('.s-blood-hint', 'settings:gfx.bloodHint');
        setLabel('.s-stuck-label', 'settings:gfx.stuckBolts');
        setLabel('.s-stuck-hint', 'settings:gfx.stuckHint');
        setLabel('.s-dpr-label', 'settings:gfx.resolution');
        setLabel('.s-shadows-label', 'settings:gfx.shadows');
        setLabel('.s-shadows-hint', 'settings:gfx.shadowsHint');
        setLabel('.s-dead-text', 'settings:gfx.showDead');
        setLabel('.s-aa-text', 'settings:gfx.antialias');
        setLabel('.s-aa-hint', 'settings:gfx.antialiasHint');
        setLabel('.s-uiscale-label', 'settings:gfx.uiSize');
        setLabel('.s-uiscale-hint', 'settings:gfx.uiHint');
        const fillOpts = (selectSel: string, map: Record<string, string>) => {
            const sel = overlay.querySelector<HTMLSelectElement>(selectSel);
            if (!sel) return;
            for (const opt of sel.options) {
                const key = map[opt.value];
                if (key) opt.textContent = t(key);
            }
        };
        const quality = {
            ultra: 'settings:gfx.presetUltra',
            high: 'settings:gfx.presetHigh',
            medium: 'settings:gfx.presetMedium',
            low: 'settings:gfx.presetLow',
            off: 'settings:gfx.presetOff',
        };
        fillOpts('.s-scenery', quality);
        fillOpts('.s-ground', quality);
        fillOpts('.s-fire', quality);
        fillOpts('.s-blood', quality);
        fillOpts('.s-shadows', quality);
        fillOpts('.s-stuck', {
            high: 'settings:gfx.stuckHigh',
            low: 'settings:gfx.stuckLow',
            off: 'settings:gfx.presetOff',
        });
        fillOpts('.s-dpr', {
            '1': 'settings:gfx.resNative',
            '0.75': '75%',
            '0.5': '50%',
            '0.33': '33%',
        });
        fillOpts('.s-uiscale', {
            '0.25': '25%',
            '0.5': '50%',
            '0.75': '75%',
            '1': 'settings:gfx.uiNormal',
            '1.25': '125%',
            '1.5': '150%',
            '2': '200%',
        });
    };

    overlay.innerHTML =
        `<div class="box m-frame">` +
        `<div class="s-title"></div>` +
        `<div class="s-body">` +
        `<div class="s-col s-col-general">` +
        `<section class="s-section">` +
        `<div class="s-section-head s-look-head"></div>` +
        `<label class="s-row s-lang-row">` +
        `<svg class="s-lang-globe" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">` +
        `<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25"/>` +
        `<ellipse cx="8" cy="8" rx="2.6" ry="6.25" fill="none" stroke="currentColor" stroke-width="1.1"/>` +
        `<path d="M2.1 8h11.8M3.2 4.8h9.6M3.2 11.2h9.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>` +
        `</svg>` +
        `<span class="s-lang-label"></span> <select class="s-lang">${langOptions}</select></label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head s-controls-head"></div>` +
        `<button type="button" class="m-btn-bronze s-help-btn" data-act="controls-help"></button>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head s-chat-head"></div>` +
        `<label class="s-row"><input type="checkbox" class="s-combat" /> <span class="s-combat-text"></span></label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head s-mp-head"></div>` +
        `<label class="s-row"><span class="s-mp-label"></span> <select class="s-mp">` +
        `<option value="steam">Steam</option>` +
        `<option value="matchmaking">Web</option>` +
        `<option value="lan">LAN</option>` +
        `</select></label>` +
        `<div class="s-hint s-mp-hint"></div>` +
        // Web build only: Steam and LAN show as unavailable there, which invites
        // the question this answers.
        (!isElectron() ? `<div class="s-hint s-mp-note"></div>` : '') +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head s-debug-head"></div>` +
        `<label class="s-row"><input type="checkbox" class="s-debug" /> <span class="s-debug-text"></span>` +
        ` <span class="s-hint s-debug-hint"></span></label>` +
        `</section>` +
        `</div>` +
        `<div class="s-col s-col-graphics">` +
        `<section class="s-section">` +
        `<div class="s-section-head s-gfx-head"></div>` +
        // Desktop only: browsers refuse fullscreen without a user gesture, and
        // the window mode is remembered by the app (window-state.json), not prefs.
        (isElectron()
            ? `<label class="s-row"><input type="checkbox" class="s-fullscreen" /> <span class="s-fullscreen-text"></span> <span class="s-hint s-fullscreen-hint"></span></label>`
            : '') +
        `<div class="s-presets">` +
        (['low', 'medium', 'high', 'ultra'] as const)
            .map((id) => `<button type="button" class="s-preset" data-preset="${id}"></button>`)
            .join('') +
        // Not a button: there is nothing to apply, it only reports that the
        // individual options no longer match any preset.
        `<span class="s-preset s-custom-chip"></span>` +
        `</div>` +
        // Collapsed by default — the presets are the intended control. Opens by
        // itself once values diverge, so a custom setup is never hidden.
        `<details class="s-advanced">` +
        `<summary></summary>` +
        `<label class="s-row"><span class="s-scenery-label"></span> <select class="s-scenery">` +
        `<option value="ultra"></option>` +
        `<option value="high"></option>` +
        `<option value="medium"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-scenery-hint"></span></label>` +
        `<label class="s-row"><span class="s-ground-label"></span> <select class="s-ground">` +
        `<option value="high"></option>` +
        `<option value="medium"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-ground-hint"></span></label>` +
        `<label class="s-row"><span class="s-fire-label"></span> <select class="s-fire">` +
        `<option value="high"></option>` +
        `<option value="medium"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-fire-hint"></span></label>` +
        `<label class="s-row"><span class="s-blood-label"></span> <select class="s-blood">` +
        `<option value="ultra"></option>` +
        `<option value="high"></option>` +
        `<option value="medium"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-blood-hint"></span></label>` +
        `<label class="s-row"><span class="s-stuck-label"></span> <select class="s-stuck">` +
        `<option value="high"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-stuck-hint"></span></label>` +
        `<label class="s-row"><span class="s-dpr-label"></span> <select class="s-dpr">` +
        `<option value="1"></option>` +
        `<option value="0.75">75%</option>` +
        `<option value="0.5">50%</option>` +
        `<option value="0.33">33%</option>` +
        `</select> <span class="s-hint s-dpr-hint"></span></label>` +
        // Electron only: a browser has no page zoom we may drive, and the OS
        // already applies display scaling there.
        (isElectron()
            ? `<label class="s-row"><span class="s-uiscale-label"></span> <select class="s-uiscale">` +
              `<option value="0.25">25%</option>` +
              `<option value="0.5">50%</option>` +
              `<option value="0.75">75%</option>` +
              `<option value="1"></option>` +
              `<option value="1.25">125%</option>` +
              `<option value="1.5">150%</option>` +
              `<option value="2">200%</option>` +
              `</select> <span class="s-hint s-uiscale-hint"></span></label>`
            : '') +
        `<label class="s-row"><span class="s-shadows-label"></span> <select class="s-shadows">` +
        `<option value="ultra"></option>` +
        `<option value="high"></option>` +
        `<option value="medium"></option>` +
        `<option value="low"></option>` +
        `<option value="off"></option>` +
        `</select> <span class="s-hint s-shadows-hint"></span></label>` +
        `<label class="s-row"><input type="checkbox" class="s-dead" /> <span class="s-dead-text"></span></label>` +
        `<label class="s-row"><input type="checkbox" class="s-aa" /> <span class="s-aa-text"></span> <span class="s-hint s-aa-hint"></span></label>` +
        `</details>` +
        `</section>` +
        `</div>` +
        `</div>` +
        `<div class="actions">` +
        `<button type="button" class="s-reset" data-act="reset"></button>` +
        `<button type="button" class="m-btn-bronze primary" data-act="close"></button>` +
        `</div>` +
        `</div>`;

    paintChrome();

    const fullscreen = overlay.querySelector<HTMLInputElement>('.s-fullscreen');
    const debugToggle = overlay.querySelector<HTMLInputElement>('.s-debug')!;
    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    const mpSel = overlay.querySelector<HTMLSelectElement>('.s-mp')!;
    const mpHint = overlay.querySelector<HTMLElement>('.s-mp-hint')!;
    const langSel = overlay.querySelector<HTMLSelectElement>('.s-lang')!;
    const scenery = overlay.querySelector<HTMLSelectElement>('.s-scenery')!;
    const ground = overlay.querySelector<HTMLSelectElement>('.s-ground')!;
    const fire = overlay.querySelector<HTMLSelectElement>('.s-fire')!;
    const blood = overlay.querySelector<HTMLSelectElement>('.s-blood')!;
    const stuck = overlay.querySelector<HTMLSelectElement>('.s-stuck')!;
    const dpr = overlay.querySelector<HTMLSelectElement>('.s-dpr')!;
    const dprHint = overlay.querySelector<HTMLElement>('.s-dpr-hint')!;
    const uiScaleSel = overlay.querySelector<HTMLSelectElement>('.s-uiscale');
    const shadows = overlay.querySelector<HTMLSelectElement>('.s-shadows')!;
    const dead = overlay.querySelector<HTMLInputElement>('.s-dead')!;
    const aa = overlay.querySelector<HTMLInputElement>('.s-aa')!;
    const presetButtons = [...overlay.querySelectorAll<HTMLButtonElement>('.s-preset[data-preset]')];
    const customChip = overlay.querySelector<HTMLElement>('.s-custom-chip')!;
    const advanced = overlay.querySelector<HTMLDetailsElement>('.s-advanced')!;

    const mpHintKeys: Record<Prefs['multiplayerTransport'], string> = {
        steam: 'settings:mpHintSteam',
        matchmaking: 'settings:mpHintMatchmaking',
        lan: 'settings:mpHintLan',
    };

    const syncFromPrefs = (): void => {
        const p = prefs();
        debugToggle.checked = p.debugOverlay;
        combat.checked = p.combatChat;
        mpSel.value = p.multiplayerTransport;
        mpHint.textContent = t(mpHintKeys[p.multiplayerTransport]);
        langSel.value = p.language;
        scenery.value = p.scenery;
        ground.value = p.groundEffects;
        fire.value = p.fireVfx;
        blood.value = p.bloodFx;
        stuck.value = p.stuckProjectiles;
        dpr.value = String(p.renderScale);
        if (uiScaleSel) uiScaleSel.value = String(p.uiScale);
        updateDprHint();
        shadows.value = p.shadows;
        dead.checked = p.renderDeadUnits;
        aa.checked = p.antialias;
        const active = detectGraphicsPreset(p);
        for (const button of presetButtons) {
            button.classList.toggle(
                'active',
                button.dataset.preset === active,
            );
        }
        customChip.classList.toggle('active', active === null);
        // Only ever open it: closing on a preset click would yank the panel away
        // while the player is still working in it.
        if (active === null) advanced.open = true;
        paintChrome();
    };

    /**
     * What the 3D canvas will actually render at: the renderer multiplies the
     * canvas CSS size by effectiveDpr() = min(devicePixelRatio, cap). Shown
     * because a multiplier means nothing without the window it applies to.
     */
    function updateDprHint(): void {
        const fraction = Number(dpr.value) || 1;
        const ratio = (window.devicePixelRatio || 1) * fraction;
        const w = Math.round(window.innerWidth * ratio);
        const h = Math.round(window.innerHeight * ratio);
        dprHint.textContent = `${w} × ${h} px`;
    }

    // Resizing the window while this is open changes the answer. Self-cleaning:
    // the dialog is removed from the DOM rather than hidden.
    const dprObserver = new ResizeObserver(() => {
        if (!overlay.isConnected) {
            dprObserver.disconnect();
            return;
        }
        updateDprHint();
    });
    dprObserver.observe(document.documentElement);

    // Options that cannot work here are disabled rather than hidden: a browser
    // has neither Steam nor the LAN host, and a desktop launched without Steam
    // never gets it back (steam.init runs once at process start). Leaving them
    // visible answers "where is Steam?" instead of raising it.
    void availableTransports().then((available) => {
        for (const option of [...mpSel.options]) {
            const id = option.value as Prefs['multiplayerTransport'];
            if (available.includes(id)) continue;
            option.disabled = true;
            // Flag rather than sniff the label: the suffix is translated, so
            // "does it already say unavailable" is not a text question.
            if (option.dataset.unavailable) continue;
            option.dataset.unavailable = '1';
            option.textContent += t('settings:mpUnavailable');
        }
    });

    syncFromPrefs();

    // Window mode is owned by the main process (window-state.json), so read the
    // live value rather than a pref — they would drift on F11 otherwise.
    if (fullscreen) {
        void win.isFullscreen().then((on) => { fullscreen.checked = on; });
        fullscreen.addEventListener('change', () => {
            void win.setFullscreen(fullscreen.checked);
        });
    }

    debugToggle.addEventListener('change', () => updatePrefs({ debugOverlay: debugToggle.checked }));
    combat.addEventListener('change', () => updatePrefs({ combatChat: combat.checked }));
    mpSel.addEventListener('change', () => {
        updatePrefs({
            multiplayerTransport: mpSel.value as Prefs['multiplayerTransport'],
            transportChosen: true,
        });
        syncFromPrefs();
    });
    langSel.addEventListener('change', () => {
        const language = langSel.value as LanguageId;
        updatePrefs({ language });
        void (async () => {
            await setLanguage(language);
            await applyLanguageFont(language);
            syncFromPrefs();
        })();
    });

    scenery.addEventListener('change', () => {
        updatePrefs({ scenery: scenery.value as Prefs['scenery'] });
        syncFromPrefs();
    });
    ground.addEventListener('change', () => {
        updatePrefs({ groundEffects: ground.value as Prefs['groundEffects'] });
        syncFromPrefs();
    });
    fire.addEventListener('change', () => {
        updatePrefs({ fireVfx: fire.value as Prefs['fireVfx'] });
        syncFromPrefs();
    });
    blood.addEventListener('change', () => {
        updatePrefs({ bloodFx: blood.value as Prefs['bloodFx'] });
        syncFromPrefs();
    });
    stuck.addEventListener('change', () => {
        updatePrefs({ stuckProjectiles: stuck.value as Prefs['stuckProjectiles'] });
        syncFromPrefs();
    });
    dpr.addEventListener('change', () => {
        updatePrefs({ renderScale: Number(dpr.value) as Prefs['renderScale'] });
        syncFromPrefs();
    });
    uiScaleSel?.addEventListener('change', () => {
        const factor = Number(uiScaleSel.value) as Prefs['uiScale'];
        updatePrefs({ uiScale: factor });
        void win.setUiScale(factor);
        syncFromPrefs();
    });
    shadows.addEventListener('change', () => {
        updatePrefs({ shadows: shadows.value as Prefs['shadows'] });
        syncFromPrefs();
    });
    dead.addEventListener('change', () => {
        updatePrefs({ renderDeadUnits: dead.checked });
        syncFromPrefs();
    });
    aa.addEventListener('change', () => {
        updatePrefs({ antialias: aa.checked });
        syncFromPrefs();
    });

    for (const button of presetButtons) {
        button.addEventListener('click', () => {
            const preset = button.dataset.preset as GraphicsPreset | undefined;
            if (!preset) return;
            applyGraphicsPreset(preset);
            syncFromPrefs();
        });
    }

    // Prefer the game wrapper over #match-ui-root (pointer-events:none shell).
    const host =
        parent.id === 'match-ui-root' && parent.parentElement ? parent.parentElement : parent;

    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-act="controls-help"]')) {
            openControlsHelp(host);
            return;
        }
        if (target.closest('[data-act="reset"]')) {
            if (!window.confirm(t('settings:resetConfirm'))) {
                return;
            }
            resetSettingsStorage();
            void (async () => {
                await setLanguage(prefs().language);
                await applyLanguageFont(prefs().language);
                syncFromPrefs();
            })();
            return;
        }
        if (target === overlay || target.closest('[data-act="close"]')) {
            removeWithDialogFade(overlay, () => overlay.remove());
        }
    });
    window.addEventListener(
        'keydown',
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            if (document.querySelector('.mechili-controls-help')) return;
            removeWithDialogFade(overlay, () => overlay.remove());
            window.removeEventListener('keydown', onKey);
        },
    );
    host.appendChild(overlay);
}

function row(keys: string, text: string): string {
    return (
        `<div class="ch-row">` +
        `<span class="ch-keys">${keys
            .split(' · ')
            .map((k) => `<kbd>${esc(k)}</kbd>`)
            .join('')}</span>` +
        `<span class="ch-desc">${esc(text)}</span>` +
        `</div>`
    );
}

function section(title: string, body: string): string {
    return `<section class="ch-section"><h2>${esc(title)}</h2>${body}</section>`;
}

/** `settings:controlsKeys.*` — the gesture / device labels inside a `<kbd>`.
 *  Physical key caps (W A S D, Shift+N, F11, gamepad faces) stay literal. */
function keyLabel(id: string): string {
    return t(`settings:controlsKeys.${id}`);
}

/** Full-screen controls reference — opened from Settings → Controls → Help. */
export function openControlsHelp(parent: HTMLElement): void {
    if (document.querySelector('.mechili-controls-help')) return;

    const overlay = withDialogFade(document.createElement('div'));
    overlay.classList.add('mechili-controls-help');
    overlay.style.pointerEvents = 'auto';
    overlay.innerHTML =
        `<div class="ch-box m-frame">` +
        `<div class="ch-head">` +
        `<div class="ch-title">${esc(t('settings:controlsTitle'))}</div>` +
        `<button type="button" class="m-btn-bronze primary" data-act="close">${esc(t('common:close'))}</button>` +
        `</div>` +
        `<div class="ch-body">` +
        section(
            t('settings:controlsTouch.head'),
            row(keyLabel('tap1'), t('settings:controlsTouch.tap')) +
                row(keyLabel('pinch2'), t('settings:controlsTouch.pinch')) +
                row(keyLabel('drag2'), t('settings:controlsTouch.pan')) +
                row(keyLabel('drag3'), t('settings:controlsTouch.orbit')),
        ) +
        section(
            t('settings:controlsMouse.head'),
            row(keyLabel('leftClick'), t('settings:controlsMouse.select')) +
                row(keyLabel('leftDrag'), t('settings:controlsMouse.box')) +
                row(keyLabel('rightClick'), t('settings:controlsMouse.cancel')) +
                row(keyLabel('rightDrag'), t('settings:controlsMouse.pan')) +
                row(keyLabel('middleClick'), t('settings:controlsMouse.rotate')) +
                row(keyLabel('middleDrag'), t('settings:controlsMouse.orbit')) +
                row(keyLabel('wheel'), t('settings:controlsMouse.zoom')) +
                row(keyLabel('edges'), t('settings:controlsMouse.edgePan')) +
                row(keyLabel('speedButton'), t('settings:controlsMouse.speed')),
        ) +
        section(
            t('settings:controlsKeyboard.head'),
            row(`W A S D · ${keyLabel('arrows')}`, t('settings:controlsKeyboard.pan')) +
                row('Q · E', t('settings:controlsKeyboard.heading')) +
                row('Home', t('settings:controlsKeyboard.resetView')) +
                row('R', t('settings:controlsKeyboard.rotate')) +
                row('Escape', t('settings:controlsKeyboard.pause')) +
                row('Enter', t('settings:controlsKeyboard.chat')) +
                row('F11 · Alt+Enter', t('settings:controlsKeyboard.fullscreen')),
        ) +
        section(
            t('settings:controlsGamepad.head'),
            row(keyLabel('leftStick'), t('settings:controlsGamepad.cursor')) +
                row('A', t('settings:controlsGamepad.click')) +
                row('B', t('settings:controlsGamepad.cancel')) +
                row('X', t('settings:controlsGamepad.rotate')) +
                row('Start', t('settings:controlsGamepad.pause')) +
                row('Back / Select', t('settings:controlsGamepad.resetView')) +
                row(keyLabel('rightStick'), t('settings:controlsGamepad.orbit')) +
                row(keyLabel('bumpersStick'), t('settings:controlsGamepad.pan')) +
                row('LT · RT', t('settings:controlsGamepad.zoom')),
        ) +
        section(
            t('settings:debugHelp.head'),
            `<p class="ch-note">${esc(t('settings:debugHelp.note'))}</p>` +
                row('Shift+N', t('settings:debugHelp.scene')) +
                row('Shift+X', t('settings:debugHelp.season')) +
                row('Shift+V', t('settings:debugHelp.weather')) +
                row('Shift+Y', t('settings:debugHelp.timeOfDay')) +
                row('Shift+U', t('settings:debugHelp.spawnAll')) +
                row('Ctrl+Shift+U', t('settings:debugHelp.spawnAllPlus')) +
                row('Shift+H', t('settings:debugHelp.hordePacks')) +
                row('Shift+I', t('settings:debugHelp.skipRound')) +
                row('Shift+K', t('settings:debugHelp.killStronghold')) +
                row('Shift+C', t('settings:debugHelp.cinema')) +
                row('Shift+T', t('settings:debugHelp.material')) +
                row('Shift+1 … 7', t('settings:debugHelp.layers')) +
                row('Shift+0', t('settings:debugHelp.layersOn')),
        ) +
        `</div>` +
        `</div>`;

    const close = (): void => {
        removeWithDialogFade(overlay, () => overlay.remove());
        window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation();
        close();
    };
    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target === overlay || target.closest('[data-act="close"]')) close();
    });
    window.addEventListener('keydown', onKey, true);
    parent.appendChild(overlay);
}
