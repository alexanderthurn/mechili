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
     * Skip the collapsed "Chat" strip and stay open.
     *
     * The match keeps it collapsed because the bar sits over the board and
     * every pixel is play area; the lobby is a waiting screen where chat is
     * the main thing on offer, so hiding it behind a click would be silly.
     */
    alwaysOpen?: boolean;
    /** lay out in normal document flow instead of floating bottom-center */
    inline?: boolean;
}

export class ChatBar {
    readonly el: HTMLDivElement;
    private readonly input: HTMLInputElement;
    private readonly collapsible: boolean;
    private readonly onDocPointer: (e: PointerEvent) => void;

    constructor(private readonly opts: ChatBarOptions) {
        this.collapsible = !opts.alwaysOpen;
        const bar = document.createElement('div');
        this.el = bar;
        bar.className = 'mechili-chat';
        if (opts.inline) bar.classList.add('inline');
        if (!this.collapsible) bar.classList.add('open', 'no-strip');

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
                // Collapsible: Escape belongs to the chat — it closes it, and
                // must not also reach the game's own Escape handling. Always-
                // open: there is nothing to close, so let it through to
                // whatever owns the screen (the menu backs out of the lobby).
                if (!this.collapsible) return;
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
        if (this.collapsible) document.addEventListener('pointerdown', this.onDocPointer);
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
        if (this.isOpen) return;
        this.el.classList.add('open');
        if (focus) this.input.focus();
    }

    /** no-op when this bar was built always-open */
    close(): void {
        if (!this.collapsible) return;
        this.el.classList.remove('open');
    }

    /** wipes any half-typed text — for reuse across separate rooms */
    reset(): void {
        this.input.value = '';
    }

    dispose(): void {
        document.removeEventListener('pointerdown', this.onDocPointer);
        this.el.remove();
    }
}
