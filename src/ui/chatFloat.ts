/**
 * The pop-up chat lines that rise above the chat bar and fade out — shared by
 * the match HUD and the menu's lobby, so a message looks and behaves the same
 * whether it arrives while waiting or mid-battle.
 *
 * Paired with `ChatBar`: the bar is what you type into, this is what everyone
 * sees. It is the only display a collapsed chat has, which is exactly why the
 * lobby needs it too — a folded panel would otherwise swallow every message.
 *
 * The match's speech bubble (pinned to the sender's commander card) stays in
 * the HUD: it needs commander chips, which do not exist before a match starts.
 */

import { emoteById, type ChatItem } from '../game/emotes';
import { iconHtml } from './iconAtlas';

/** how the sender is coloured — teams only mean something inside a match */
export type ChatTone = 'player' | 'enemy' | 'neutral' | 'system';

const MAX_LINES = 4;
/** matches the CSS fade-out, so a line is removed once it is invisible */
const LINE_LIFETIME_MS = 7000;

export class ChatFloat {
    readonly el = document.createElement('div');

    constructor(inline = false) {
        this.el.className = inline ? 'mechili-chat-float inline' : 'mechili-chat-float';
    }

    /** a person's message: name chip + emote icon or text */
    addMessage(name: string, item: ChatItem, tone: ChatTone = 'neutral'): void {
        const icon = item.kind === 'emote' ? (emoteById(item.id)?.icon ?? null) : null;
        // an emote with no icon still has to say something
        const text = item.kind === 'text' ? item.text : (emoteById(item.id)?.label ?? '');

        const line = document.createElement('div');
        line.className = `cf-msg ${tone}`;
        const who = document.createElement('span');
        who.className = 'cf-name';
        who.textContent = name;
        const what = document.createElement('span');
        what.className = 'cf-body';
        if (icon) {
            // icon only — the emote speaks for itself. Markup is ours (an atlas
            // id from EMOTES), never player-supplied.
            what.innerHTML = ` ${iconHtml(icon, 'chat-emote-ico')}`;
        } else {
            // textContent, never innerHTML: this is text another player typed
            what.textContent = ` ${text}`;
        }
        line.append(who, what);
        this.push(line);
    }

    /** a neutral announcement with no sender ("X joined.") */
    addSystem(text: string): void {
        const line = document.createElement('div');
        line.className = 'cf-msg system';
        const what = document.createElement('span');
        what.className = 'cf-body';
        what.textContent = text;
        line.append(what);
        this.push(line);
    }

    private push(line: HTMLDivElement): void {
        this.el.appendChild(line);
        while (this.el.children.length > MAX_LINES) this.el.firstChild?.remove();
        setTimeout(() => line.remove(), LINE_LIFETIME_MS);
    }

    clear(): void {
        this.el.replaceChildren();
    }
}
