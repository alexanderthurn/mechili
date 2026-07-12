import { prefs, updatePrefs } from '../game/prefs';

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
        `<div class="actions"><button type="button" class="primary" data-act="close">Close</button></div>` +
        `</div>`;

    const combat = overlay.querySelector<HTMLInputElement>('.s-combat')!;
    combat.checked = prefs().combatChat;
    combat.addEventListener('change', () => updatePrefs({ combatChat: combat.checked }));

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
