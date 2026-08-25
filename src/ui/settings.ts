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

import { applyUiFont, UI_FONTS, type UiFontId } from '../theme';
import { removeWithDialogFade, withDialogFade } from './dialogFade';

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

    const fontOptions = (Object.keys(UI_FONTS) as UiFontId[])
        .map((id) => {
            const f = UI_FONTS[id];
            return `<option value="${id}">${f.label}</option>`;
        })
        .join('');

    const overlay = withDialogFade(document.createElement('div'));
    overlay.classList.add('mechili-settings');
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
        `<div class="s-section-head">Controls</div>` +
        `<button type="button" class="m-btn-bronze s-help-btn" data-act="controls-help">Help</button>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Chat</div>` +
        `<label class="s-row"><input type="checkbox" class="s-combat" /> Show combat chat</label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Multiplayer</div>` +
        `<label class="s-row">Connection <select class="s-mp">` +
        `<option value="steam">Steam</option>` +
        `<option value="matchmaking">Web</option>` +
        `<option value="lan">LAN</option>` +
        `</select></label>` +
        `<div class="s-hint s-mp-hint"></div>` +
        // Web build only: Steam and LAN show as unavailable there, which invites
        // the question this answers.
        (!isElectron()
            ? `<div class="s-hint s-mp-note">Steam and LAN need the Steam version ` +
              `<a href="https://steam.melodan.com" target="_blank" rel="noopener noreferrer">https://steam.melodan.com</a></div>`
            : '') +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Debug</div>` +
        `<label class="s-row"><input type="checkbox" class="s-debug" /> Debug overlay` +
        ` <span class="s-hint">FPS, timings, sync — in match</span></label>` +
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
        `<summary>Advanced settings</summary>` +
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
        `</select> <span class="s-hint">flames, smoke &amp; acid fumes</span></label>` +
        `<label class="s-row">Blood <select class="s-blood">` +
        `<option value="ultra">Ultra</option>` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">spray &amp; fountains</span></label>` +
        `<label class="s-row">Stuck bolts <select class="s-stuck">` +
        `<option value="high">High (128)</option>` +
        `<option value="low">Low (32)</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">arrows left in dirt / flesh</span></label>` +
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
              `<option value="0.25">25%</option>` +
              `<option value="0.5">50%</option>` +
              `<option value="0.75">75%</option>` +
              `<option value="1">100% (normal)</option>` +
              `<option value="1.25">125%</option>` +
              `<option value="1.5">150%</option>` +
              `<option value="2">200%</option>` +
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
        `</div>` +
        `</div>` +
        `<div class="actions">` +
        `<button type="button" class="s-reset" data-act="reset">Reset all settings</button>` +
        `<button type="button" class="m-btn-bronze primary" data-act="close">Close</button>` +
        `</div>` +
        `</div>`;

    const fullscreen = overlay.querySelector<HTMLInputElement>('.s-fullscreen');
    const debugToggle = overlay.querySelector<HTMLInputElement>('.s-debug')!;
    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    const mpSel = overlay.querySelector<HTMLSelectElement>('.s-mp')!;
    const mpHint = overlay.querySelector<HTMLElement>('.s-mp-hint')!;
    const fontSel = overlay.querySelector<HTMLSelectElement>('.s-font')!;
    const fontHint = overlay.querySelector<HTMLElement>('.s-font-hint')!;
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

    const mpHints: Record<Prefs['multiplayerTransport'], string> = {
        steam: 'Steam lobbies only. Needs Steam running at launch.',
        matchmaking: 'Online rooms via PeerJS + server list. Needs internet.',
        lan: 'Local network only (Electron). No internet required.',
    };

    const syncFromPrefs = (): void => {
        const p = prefs();
        debugToggle.checked = p.debugOverlay;
        combat.checked = p.combatChat;
        mpSel.value = p.multiplayerTransport;
        mpHint.textContent = mpHints[p.multiplayerTransport];
        fontSel.value = p.uiFont;
        fontHint.textContent = UI_FONTS[p.uiFont]?.hint ?? '';
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
            if (!option.textContent?.includes('—')) option.textContent += ' — unavailable';
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
            .map((k) => `<kbd>${k}</kbd>`)
            .join('')}</span>` +
        `<span class="ch-desc">${text}</span>` +
        `</div>`
    );
}

function section(title: string, body: string): string {
    return `<section class="ch-section"><h2>${title}</h2>${body}</section>`;
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
        `<div class="ch-title">Controls</div>` +
        `<button type="button" class="m-btn-bronze primary" data-act="close">Close</button>` +
        `</div>` +
        `<div class="ch-body">` +
        section(
            'Touch',
            row('1 finger tap', 'Select, place, or buy — same as a left click') +
                row('2 finger pinch', 'Zoom — spread or pinch in any direction, not only vertical') +
                row('2 finger drag', 'Both fingers moving together pans the map') +
                row('3 finger drag', 'Orbit: left/right rotates heading, up/down tilts'),
        ) +
        section(
            'Mouse',
            row('Left click', 'Select a pack, place a carried pack, or drop a rune/tactic') +
                row('Left drag', 'Box-select packs') +
                row('Right click', 'Cancel / deselect (clears a carried pack, armed rune, or tactic)') +
                row('Right drag', 'Grab the ground and pan') +
                row('Middle click', 'Rotate the selected pack') +
                row('Middle drag', 'Orbit — left/right heading, up/down tilt') +
                row('Scroll wheel', 'Zoom toward the cursor') +
                row('Screen edges', 'Pan while the cursor sits at the edge of the window') +
                row('Speed button', 'Click faster, right-click slower (battle)'),
        ) +
        section(
            'Keyboard',
            row('W A S D · Arrows', 'Pan, relative to camera heading') +
                row('Q · E', 'Rotate heading') +
                row('Home', 'Reset rotation, tilt, and zoom') +
                row('R', 'Rotate the selected pack') +
                row('Escape', 'Pause menu. In cinema mode, first restores the HUD.') +
                row('Enter', 'Send chat') +
                row('F11 · Alt+Enter', 'Fullscreen (desktop app)'),
        ) +
        section(
            'Gamepad',
            row('Left stick', 'Move the on-screen cursor') +
                row('A', 'Click. Hold and drag to box-select.') +
                row('B', 'Cancel / deselect') +
                row('X', 'Rotate the selected pack') +
                row('Start', 'Pause menu') +
                row('Back / Select', 'Reset camera view') +
                row('Right stick', 'Orbit (heading + tilt)') +
                row('LB / RB + right stick', 'Pan') +
                row('LT · RT', 'Zoom toward the cursor'),
        ) +
        section(
            'Cheats &amp; debug',
            `<p class="ch-note">Most spawn/skip cheats are single-player only. Atmosphere keys work in any match (visual). Typed into the field, not chat.</p>` +
                row('Shift+N', 'Next atmosphere scene, +1000 supply, +5000 HP both sides, battle timer 500s') +
                row('Shift+X', 'Next season') +
                row('Shift+V', 'Next weather') +
                row('Shift+Y', 'Next time of day') +
                row('Shift+U', 'Single-player: free-spawn every shop unit, max supply, tactics, and bag runes') +
                row('Ctrl+Shift+U', 'Same as Shift+U, plus horde units, pack-level scramble, and up to 3 techs per press') +
                row('Shift+H', 'Single-player, deploy phase: extra horde packs (repeat to pile on)') +
                row('Shift+I', 'Single-player: skip the rest of this round') +
                row('Shift+C', 'Cinema — hide HUD for screenshots. Escape restores it.') +
                row('Shift+T', 'Cycle material debug: clay → wireframe → normals → off') +
                row('Shift+1 … 7', 'Toggle visual layers: clouds, distance fog, height mist, forest fog, rain, snow, stars') +
                row('Shift+0', 'Turn every visual layer back on'),
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
