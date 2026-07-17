import { prefs, updatePrefs, type Prefs } from '../game/prefs';

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
        `<label class="s-row"><input type="checkbox" class="s-combat" /> Show combat chat</label>` +
        `<label class="s-row"><input type="checkbox" class="s-global" /> Show global chat (menu)</label>` +
        `<label class="s-row">Scenery <select class="s-scenery">` +
        `<option value="ultra">Ultra</option>` +
        `<option value="high">High (dense forests)</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low (flat world)</option>` +
        `<option value="off">Off (no weather)</option>` +
        `</select> <span class="s-hint">trees &amp; mountains</span></label>` +
        `<label class="s-row">Ground effects <select class="s-ground">` +
        `<option value="high">High (sand &amp; blood)</option>` +
        `<option value="medium">Medium (sand &amp; scorch)</option>` +
        `<option value="low">Low (texture only)</option>` +
        `<option value="off">Off (plain ground)</option>` +
        `</select> <span class="s-hint">battlefield wear</span></label>` +
        `<label class="s-row">Fire effects <select class="s-fire">` +
        `<option value="high">High</option>` +
        `<option value="medium">Medium</option>` +
        `<option value="low">Low</option>` +
        `<option value="off">Off</option>` +
        `</select> <span class="s-hint">flames (visual)</span></label>` +
        `<label class="s-row">Resolution <select class="s-dpr">` +
        `<option value="2">High (retina)</option>` +
        `<option value="1.5">Medium</option>` +
        `<option value="1">Low (1×)</option>` +
        `</select> <span class="s-hint">pixel density</span></label>` +
        `<label class="s-row">Unit shadows <select class="s-unit-shadows">` +
        `<option value="all">All units</option>` +
        `<option value="structures">Structures only</option>` +
        `<option value="off">Off</option>` +
        `</select></label>` +
        `<label class="s-row"><input type="checkbox" class="s-dead" /> Show dead units</label>` +
        `<div class="actions"><button type="button" class="primary" data-act="close">Close</button></div>` +
        `</div>`;

    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    combat.checked = prefs().combatChat;
    combat.addEventListener('change', () => updatePrefs({ combatChat: combat.checked }));

    const scenery = overlay.querySelector<HTMLSelectElement>('.s-scenery')!;
    scenery.value = prefs().scenery;
    scenery.addEventListener('change', () =>
        updatePrefs({ scenery: scenery.value as Prefs['scenery'] }),
    );

    const ground = overlay.querySelector<HTMLSelectElement>('.s-ground')!;
    ground.value = prefs().groundEffects;
    ground.addEventListener('change', () =>
        updatePrefs({ groundEffects: ground.value as Prefs['groundEffects'] }),
    );

    const fire = overlay.querySelector<HTMLSelectElement>('.s-fire')!;
    fire.value = prefs().fireVfx;
    fire.addEventListener('change', () =>
        updatePrefs({ fireVfx: fire.value as Prefs['fireVfx'] }),
    );

    const dpr = overlay.querySelector<HTMLSelectElement>('.s-dpr')!;
    dpr.value = String(prefs().dprCap);
    dpr.addEventListener('change', () =>
        updatePrefs({ dprCap: Number(dpr.value) as Prefs['dprCap'] }),
    );

    const unitShadows = overlay.querySelector<HTMLSelectElement>('.s-unit-shadows')!;
    unitShadows.value = prefs().unitShadows;
    unitShadows.addEventListener('change', () =>
        updatePrefs({ unitShadows: unitShadows.value as Prefs['unitShadows'] }),
    );

    const dead = overlay.querySelector<HTMLInputElement>('.s-dead')!;
    dead.checked = prefs().renderDeadUnits;
    dead.addEventListener('change', () => updatePrefs({ renderDeadUnits: dead.checked }));

    const global = overlay.querySelector<HTMLInputElement>('.s-global')!;
    global.checked = prefs().globalChat;
    global.addEventListener('change', () => updatePrefs({ globalChat: global.checked }));

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
