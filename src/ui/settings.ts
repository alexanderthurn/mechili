import {
    applyGraphicsPreset,
    detectGraphicsPreset,
    prefs,
    updatePrefs,
    type GraphicsPreset,
    type Prefs,
} from '../game/prefs';

/**
 * The settings dialog — one shared overlay, opened from the main menu and
 * from the in-game top bar. Options apply immediately and persist.
 */
export function openSettings(parent: HTMLElement): void {
    if (document.querySelector('.mechili-settings')) return; // already open

    const overlay = document.createElement('div');
    overlay.className = 'mechili-settings';
    overlay.innerHTML =
        `<div class="box">` +
        `<div class="s-title">Settings</div>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Chat</div>` +
        `<label class="s-row"><input type="checkbox" class="s-combat" /> Show combat chat</label>` +
        `<label class="s-row"><input type="checkbox" class="s-global" /> Show global chat (menu)</label>` +
        `</section>` +
        `<section class="s-section">` +
        `<div class="s-section-head">Graphics</div>` +
        `<div class="s-presets">` +
        (['low', 'medium', 'high', 'ultra'] as const)
            .map(
                (id) =>
                    `<button type="button" class="s-preset" data-preset="${id}">` +
                    `${id.charAt(0).toUpperCase()}${id.slice(1)}</button>`,
            )
            .join('') +
        `</div>` +
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
        `<label class="s-row">Resolution <select class="s-dpr">` +
        `<option value="2">High</option>` +
        `<option value="1.5">Medium</option>` +
        `<option value="1">Low</option>` +
        `</select> <span class="s-hint">pixel density</span></label>` +
        `<label class="s-row">Unit shadows <select class="s-unit-shadows">` +
        `<option value="all">All</option>` +
        `<option value="structures">Structures</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">cast shadows</span></label>` +
        `<label class="s-row"><input type="checkbox" class="s-dead" /> Show dead units</label>` +
        `</section>` +
        `<div class="actions"><button type="button" class="primary" data-act="close">Close</button></div>` +
        `</div>`;

    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    const global = overlay.querySelector<HTMLInputElement>('.s-global')!;
    const scenery = overlay.querySelector<HTMLSelectElement>('.s-scenery')!;
    const ground = overlay.querySelector<HTMLSelectElement>('.s-ground')!;
    const fire = overlay.querySelector<HTMLSelectElement>('.s-fire')!;
    const dpr = overlay.querySelector<HTMLSelectElement>('.s-dpr')!;
    const unitShadows = overlay.querySelector<HTMLSelectElement>('.s-unit-shadows')!;
    const dead = overlay.querySelector<HTMLInputElement>('.s-dead')!;
    const presetButtons = [...overlay.querySelectorAll<HTMLButtonElement>('.s-preset')];

    const syncFromPrefs = (): void => {
        const p = prefs();
        combat.checked = p.combatChat;
        global.checked = p.globalChat;
        scenery.value = p.scenery;
        ground.value = p.groundEffects;
        fire.value = p.fireVfx;
        dpr.value = String(p.dprCap);
        unitShadows.value = p.unitShadows;
        dead.checked = p.renderDeadUnits;
        const active = detectGraphicsPreset(p);
        for (const button of presetButtons) {
            button.classList.toggle(
                'active',
                button.dataset.preset === active,
            );
        }
    };

    syncFromPrefs();

    combat.addEventListener('change', () => updatePrefs({ combatChat: combat.checked }));
    global.addEventListener('change', () => updatePrefs({ globalChat: global.checked }));

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
    dpr.addEventListener('change', () => {
        updatePrefs({ dprCap: Number(dpr.value) as Prefs['dprCap'] });
        syncFromPrefs();
    });
    unitShadows.addEventListener('change', () => {
        updatePrefs({ unitShadows: unitShadows.value as Prefs['unitShadows'] });
        syncFromPrefs();
    });
    dead.addEventListener('change', () => {
        updatePrefs({ renderDeadUnits: dead.checked });
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
    parent.appendChild(overlay);
}
