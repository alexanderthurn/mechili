/**
 * The chat composer — emote row, text input, send — shared by the match HUD
 * and the menu's lobby.
 *
 * Only the COMPOSER is shared, deliberately. How messages are DISPLAYED
 * genuinely differs between the two: the match floats a few short-lived lines
 * over the battlefield and pins a speech bubble to the sender's commander
 * card (neither of which exists before a match starts), while the lobby keeps
 * a plain scrollback of everything said while waiting. Forcing one renderer
 * to do both would be a worse component than two small ones. Everything a
 * player actually touches — the same emotes, the same Enter-to-send, the same
 * length limit — lives here, once.
 */

import { CHAT_TEXT_LIMIT, EMOTES, type ChatItem } from '../game/emotes';
import { iconHtml } from './iconAtlas';

export interface ChatBarOptions {
    onSend: (item: ChatItem) => void;
    /**
     * Mounted at the top of the panel, above the emotes — the lobby puts its
     * message scrollback here so the list collapses and expands WITH the bar
     * rather than floating beside it.
     */
    leading?: HTMLElement;
    /** lay out in normal document flow instead of floating bottom-center */
    inline?: boolean;
}

export class ChatBar {
    readonly el: HTMLDivElement;
    private readonly input: HTMLInputElement;
    private readonly onDocPointer: (e: PointerEvent) => void;

    constructor(private readonly opts: ChatBarOptions) {
        const bar = document.createElement('div');
        this.el = bar;
        bar.className = 'mechili-chat';
        if (opts.inline) bar.classList.add('inline');

        const emoteButtons = EMOTES.map(
            (e) =>
                `<button type="button" class="c-emote" data-emote="${e.id}" title="${e.label}">${iconHtml(e.icon, 'c-emote-ico')}</button>`,
        ).join('');
        bar.innerHTML =
            `<div class="c-strip">Chat</div>` +
            `<div class="c-panel">` +
            `<div class="c-emotes">${emoteButtons}</div>` +
            `<div class="c-row">` +
            `<input class="c-input" maxlength="${CHAT_TEXT_LIMIT}" placeholder="message…" spellcheck="false" />` +
            `<button type="button" class="c-send">Send</button>` +
            `</div></div>`;
        this.input = bar.querySelector('.c-input')!;
        if (opts.leading) bar.querySelector('.c-panel')!.prepend(opts.leading);

        const strip = bar.querySelector('.c-strip')!;
        strip.addEventListener('click', () => this.open(true));
        strip.addEventListener('pointerenter', () => this.open(false));
        bar.addEventListener('click', (e) => {
            const emote = (e.target as HTMLElement).closest<HTMLButtonElement>('.c-emote');
            if (emote?.dataset.emote) opts.onSend({ kind: 'emote', id: emote.dataset.emote });
        });
        bar.querySelector('.c-send')!.addEventListener('click', () => this.submit());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.submit();
                e.stopPropagation();
                return;
            }
            if (e.key === 'Escape') {
                // Escape belongs to the chat while typing in it: it closes the
                // panel and stops there, rather than also reaching whatever
                // owns the screen (the game's pause menu, the menu's back).
                this.close();
                this.input.blur();
                e.stopPropagation();
                return;
            }
            // ordinary typing must never reach hotkey handling
            e.stopPropagation();
        });

        // click anywhere outside collapses it; the input keeps its text so a
        // half-typed message survives. Self-detaches once the bar is gone.
        this.onDocPointer = (e: PointerEvent) => {
            if (!bar.isConnected) {
                document.removeEventListener('pointerdown', this.onDocPointer);
                return;
            }
            if (bar.classList.contains('open') && !bar.contains(e.target as Node)) this.close();
        };
        document.addEventListener('pointerdown', this.onDocPointer);
    }

    private submit(): void {
        const text = this.input.value.trim().slice(0, CHAT_TEXT_LIMIT);
        if (text) this.opts.onSend({ kind: 'text', text });
        this.input.value = '';
        this.input.focus();
    }

    get isOpen(): boolean {
        return this.el.classList.contains('open');
    }

    open(focus = true): void {
        this.el.classList.remove('unread');
        if (this.isOpen) return;
        this.el.classList.add('open');
        if (focus) this.input.focus();
    }

    /**
     * Flag the collapsed strip so an arriving message is not simply missed.
     * Deliberately not auto-opening: a player who just closed the panel should
     * not have it reopen itself in their face. Cleared when they open it.
     */
    markUnread(): void {
        if (!this.isOpen) this.el.classList.add('unread');
    }

    close(): void {
        this.el.classList.remove('open');
    }

    /** back to a clean collapsed bar — for reuse across separate rooms */
    reset(): void {
        this.input.value = '';
        this.el.classList.remove('unread');
        this.close();
    }

    dispose(): void {
        document.removeEventListener('pointerdown', this.onDocPointer);
        this.el.remove();
    }
}
