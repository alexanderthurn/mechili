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

import { applyUiFont, UI_FONTS, type UiFontId } from '../theme';

/**
 * The settings dialog — one shared overlay, opened from the main menu and
 * from the in-game top bar. Options apply immediately and persist.
 * Desktop: two columns (general | graphics). Narrow: single stacked column.
 */
/** dismiss the shared settings overlay if open (menu or in-match). */
export function closeSettings(): void {
    document.querySelector('.mechili-settings')?.remove();
}

export function openSettings(parent: HTMLElement): void {
    if (document.querySelector('.mechili-settings')) return; // already open

    const fontOptions = (Object.keys(UI_FONTS) as UiFontId[])
        .map((id) => {
            const f = UI_FONTS[id];
            return `<option value="${id}">${f.label}</option>`;
        })
        .join('');

    const overlay = document.createElement('div');
    overlay.className = 'mechili-settings';
    // #match-ui-root is pointer-events:none — without this, in-match Settings
    // (opened from pause) looks fine but nothing inside is clickable.
    overlay.style.pointerEvents = 'auto';
    overlay.innerHTML =
        `<div class="box m-frame">` +
        `<div class="s-title">Settings</div>` +
        `<div class="s-body">` +
        `<div class="s-col s-col-general">` +
        `<section class="s-section">` +
        `<div class="s-section-head">Look</div>` +
        `<label class="s-row">UI font <select class="s-font">${fontOptions}</select>` +
        ` <span class="s-hint s-font-hint"></span></label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Chat</div>` +
        `<label class="s-row"><input type="checkbox" class="s-combat" /> Show combat chat</label>` +
        `<label class="s-row"><input type="checkbox" class="s-global" /> Show global chat (menu)</label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Multiplayer</div>` +
        `<label class="s-row">Connection <select class="s-mp">` +
        `<option value="steam">Steam</option>` +
        `<option value="matchmaking">Web</option>` +
        `<option value="lan">LAN</option>` +
        `</select></label>` +
        `<div class="s-hint s-mp-hint"></div>` +
        `</section>` +
        `</div>` +
        `<div class="s-col s-col-graphics">` +
        `<section class="s-section">` +
        `<div class="s-section-head">Graphics</div>` +
        // Desktop only: browsers refuse fullscreen without a user gesture, and
        // the window mode is remembered by the app (window-state.json), not prefs.
        (isElectron()
            ? `<label class="s-row"><input type="checkbox" class="s-fullscreen" /> Fullscreen <span class="s-hint">F11 / Alt+Enter</span></label>`
            : '') +
        `<div class="s-presets">` +
        (['low', 'medium', 'high', 'ultra'] as const)
            .map(
                (id) =>
                    `<button type="button" class="s-preset" data-preset="${id}">` +
                    `${id.charAt(0).toUpperCase()}${id.slice(1)}</button>`,
            )
            .join('') +
        // Not a button: there is nothing to apply, it only reports that the
        // individual options no longer match any preset.
        `<span class="s-preset s-custom-chip">Custom</span>` +
        `</div>` +
        // Collapsed by default — the presets are the intended control. Opens by
        // itself once values diverge, so a custom setup is never hidden.
        `<details class="s-advanced">` +
        `<summary>Individual settings</summary>` +
        `<label class="s-row">Scenery <select class="s-scenery">` +
        `<option value="ultra">Ultra</option>` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">world detail &amp; weather</span></label>` +
        `<label class="s-row">Ground effects <select class="s-ground">` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">footprints, blood &amp; scorch</span></label>` +
        `<label class="s-row">Fire effects <select class="s-fire">` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">flames &amp; smoke</span></label>` +
        `<label class="s-row">Blood <select class="s-blood">` +
        `<option value="ultra">Ultra</option>` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">spray &amp; fountains</span></label>` +
        `<label class="s-row">Resolution <select class="s-dpr">` +
        `<option value="1">Native (100%)</option>` +
        `<option value="0.75">75%</option>` +
        `<option value="0.5">50%</option>` +
        `<option value="0.33">33%</option>` +
        `</select> <span class="s-hint s-dpr-hint"></span></label>` +
        // Electron only: a browser has no page zoom we may drive, and the OS
        // already applies display scaling there.
        (isElectron()
            ? `<label class="s-row">UI size <select class="s-uiscale">` +
              `<option value="0.75">Smaller (75%)</option>` +
              `<option value="1">Normal (100%)</option>` +
              `<option value="1.25">Larger (125%)</option>` +
              `<option value="1.5">Largest (150%)</option>` +
              `</select> <span class="s-hint">menus &amp; HUD only</span></label>`
            : '') +
        `<label class="s-row">Shadows <select class="s-shadows">` +
        `<option value="ultra">Ultra</option>` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">blobs / sun map</span></label>` +
        `<label class="s-row"><input type="checkbox" class="s-dead" /> Show dead units</label>` +
        `<label class="s-row"><input type="checkbox" class="s-aa" /> Antialiasing <span class="s-hint">smoother edges · next match</span></label>` +
        `</details>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Reset</div>` +
        `<button type="button" class="s-reset" data-act="reset">Reset all settings</button>` +
        `</section>` +
        `</div>` +
        `</div>` +
        `<div class="actions"><button type="button" class="m-btn-bronze primary" data-act="close">Close</button></div>` +
        `</div>`;

    const fullscreen = overlay.querySelector<HTMLInputElement>('.s-fullscreen');
    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    const global = overlay.querySelector<HTMLInputElement>('.s-global')!;
    const mpSel = overlay.querySelector<HTMLSelectElement>('.s-mp')!;
    const mpHint = overlay.querySelector<HTMLElement>('.s-mp-hint')!;
    const fontSel = overlay.querySelector<HTMLSelectElement>('.s-font')!;
    const fontHint = overlay.querySelector<HTMLElement>('.s-font-hint')!;
    const scenery = overlay.querySelector<HTMLSelectElement>('.s-scenery')!;
    const ground = overlay.querySelector<HTMLSelectElement>('.s-ground')!;
    const fire = overlay.querySelector<HTMLSelectElement>('.s-fire')!;
    const blood = overlay.querySelector<HTMLSelectElement>('.s-blood')!;
    const dpr = overlay.querySelector<HTMLSelectElement>('.s-dpr')!;
    const dprHint = overlay.querySelector<HTMLElement>('.s-dpr-hint')!;
    const uiScaleSel = overlay.querySelector<HTMLSelectElement>('.s-uiscale');
    const shadows = overlay.querySelector<HTMLSelectElement>('.s-shadows')!;
    const dead = overlay.querySelector<HTMLInputElement>('.s-dead')!;
    const aa = overlay.querySelector<HTMLInputElement>('.s-aa')!;
    const presetButtons = [...overlay.querySelectorAll<HTMLButtonElement>('.s-preset[data-preset]')];
    const customChip = overlay.querySelector<HTMLElement>('.s-custom-chip')!;
    const advanced = overlay.querySelector<HTMLDetailsElement>('.s-advanced')!;

    const mpHints: Record<Prefs['multiplayerTransport'], string> = {
        steam: 'Steam lobbies only. Needs Steam running at launch.',
        matchmaking: 'Online rooms via PeerJS + server list. Needs internet.',
        lan: 'Local network only (Electron). No internet required.',
    };

    const syncFromPrefs = (): void => {
        const p = prefs();
        combat.checked = p.combatChat;
        global.checked = p.globalChat;
        mpSel.value = p.multiplayerTransport;
        mpHint.textContent = mpHints[p.multiplayerTransport];
        fontSel.value = p.uiFont;
        fontHint.textContent = UI_FONTS[p.uiFont]?.hint ?? '';
        scenery.value = p.scenery;
        ground.value = p.groundEffects;
        fire.value = p.fireVfx;
        blood.value = p.bloodFx;
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

    syncFromPrefs();

    // Window mode is owned by the main process (window-state.json), so read the
    // live value rather than a pref — they would drift on F11 otherwise.
    if (fullscreen) {
        void win.isFullscreen().then((on) => { fullscreen.checked = on; });
        fullscreen.addEventListener('change', () => {
            void win.setFullscreen(fullscreen.checked);
        });
    }

    combat.addEventListener('change', () => updatePrefs({ combatChat: combat.checked }));
    global.addEventListener('change', () => updatePrefs({ globalChat: global.checked }));
    mpSel.addEventListener('change', () => {
        updatePrefs({ multiplayerTransport: mpSel.value as Prefs['multiplayerTransport'] });
        syncFromPrefs();
    });
    fontSel.addEventListener('change', () => {
        const uiFont = fontSel.value as UiFontId;
        updatePrefs({ uiFont });
        applyUiFont(uiFont);
        syncFromPrefs();
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

    overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-act="reset"]')) {
            if (
                !window.confirm(
                    'Reset all settings to defaults?\n\nYour name and avatar are kept. Graphics and other options go back to factory defaults.',
                )
            ) {
                return;
            }
            resetSettingsStorage();
            applyUiFont(prefs().uiFont);
            syncFromPrefs();
            return;
        }
        if (target === overlay || target.closest('[data-act="close"]')) overlay.remove();
    });
    window.addEventListener(
        'keydown',
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            overlay.remove();
            window.removeEventListener('keydown', onKey);
        },
    );
    // Prefer the game wrapper over #match-ui-root (pointer-events:none shell).
    const host =
        parent.id === 'match-ui-root' && parent.parentElement ? parent.parentElement : parent;
    host.appendChild(overlay);
}
