/**
 * Steam friends, and inviting one into the room you are hosting.
 *
 * Exists because Steam's own overlay picker cannot be relied on: it shows only
 * what Steam is willing to list, which for a playtest or an unreleased app is
 * often nobody, and it reports nothing back either way — so a player who
 * clicked "invite" got a panel that never opened and no explanation. Reading
 * the friends list ourselves means we can show who is actually there, say so
 * plainly when nobody is, and send the invite directly (`lobby.inviteUser`)
 * with no overlay in the path at all.
 *
 * Steam has no ownership API — who owns your app is private — so the list
 * cannot be filtered to "friends who have the game". Anyone can be invited and
 * Steam decides what they can do with it; `inThisGame` is the one honest
 * signal available, so those friends sort first.
 */

import { friends as steamFriends, lobby as steamLobby, type SteamFriend } from 'steam-electron-build/native';

/** EPersonaState — anything other than 0 is some flavour of online */
const STATE_OFFLINE = 0;

function statusLabel(f: SteamFriend): string {
    if (f.inThisGame) return 'In game';
    return f.state === STATE_OFFLINE ? 'Offline' : 'Online';
}

/** in-game first, then online, then offline; alphabetical inside each band */
function sortFriends(list: SteamFriend[]): SteamFriend[] {
    const rank = (f: SteamFriend): number => (f.inThisGame ? 0 : f.state !== STATE_OFFLINE ? 1 : 2);
    return [...list].sort(
        (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

export class FriendsPanel {
    readonly el = document.createElement('div');
    private readonly listEl = document.createElement('div');
    private readonly noteEl = document.createElement('div');
    private open = false;
    private readonly onDocPointer: (e: PointerEvent) => void;

    constructor() {
        this.el.className = 'mechili-friends';
        this.el.style.display = 'none';
        const title = document.createElement('div');
        title.className = 'fr-title';
        title.textContent = 'Invite a friend';
        this.listEl.className = 'fr-list';
        this.noteEl.className = 'fr-note';
        this.noteEl.style.display = 'none';

        const overlayBtn = document.createElement('button');
        overlayBtn.type = 'button';
        overlayBtn.className = 'fr-overlay-btn';
        overlayBtn.textContent = 'Open Steam overlay…';
        overlayBtn.addEventListener('click', () => {
            void steamLobby.openInviteDialog().then((opened) => {
                this.note(
                    opened
                        ? 'Steam overlay opened — pick a friend there.'
                        : 'Steam would not open the overlay picker.',
                );
            });
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'fr-close';
        closeBtn.title = 'Close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.hide());

        this.el.append(closeBtn, title, this.listEl, this.noteEl, overlayBtn);

        this.onDocPointer = (e: PointerEvent) => {
            if (!this.el.isConnected) {
                document.removeEventListener('pointerdown', this.onDocPointer);
                return;
            }
            if (this.open && !this.el.contains(e.target as Node)) this.hide();
        };
        document.addEventListener('pointerdown', this.onDocPointer);
    }

    private note(text: string): void {
        this.noteEl.textContent = text;
        this.noteEl.style.display = text ? '' : 'none';
    }

    hide(): void {
        this.open = false;
        this.el.style.display = 'none';
    }

    /** Show the panel and (re)load the list. */
    show(): void {
        this.open = true;
        this.el.style.display = '';
        this.note('');
        this.listEl.replaceChildren(row('Loading friends…', 'fr-empty'));
        void steamFriends.list().then((list) => {
            if (!this.open) return;
            this.render(sortFriends(list));
        });
    }

    private render(list: SteamFriend[]): void {
        this.listEl.replaceChildren();
        if (list.length === 0) {
            this.listEl.append(row('No Steam friends found.', 'fr-empty'));
            // The likeliest reason by far during a playtest, and the one a
            // player cannot deduce from an empty list on their own.
            this.note('Only friends with access to this build can join.');
            return;
        }
        for (const f of list) this.listEl.append(this.friendRow(f));
    }

    private friendRow(f: SteamFriend): HTMLElement {
        const el = document.createElement('div');
        el.className = f.inThisGame ? 'fr-row in-game' : 'fr-row';

        const avatar = document.createElement('span');
        avatar.className = 'fr-avatar';
        // lazily: Steam may not have this cached yet, and a row must not wait
        void steamFriends.avatar(f.steamId64).then((url) => {
            if (url) avatar.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`;
        });

        const name = document.createElement('span');
        name.className = 'fr-name';
        name.textContent = f.name;          // textContent: a persona name is user-controlled
        const state = document.createElement('span');
        state.className = 'fr-state';
        state.textContent = statusLabel(f);

        const invite = document.createElement('button');
        invite.type = 'button';
        invite.className = 'fr-invite';
        invite.textContent = 'Invite';
        invite.addEventListener('click', () => {
            invite.disabled = true;
            void steamLobby.inviteUser(f.steamId64).then((sent) => {
                invite.textContent = sent ? 'Invited' : 'Failed';
                if (!sent) {
                    invite.disabled = false;
                    this.note('Could not send that invite — are you still hosting a room?');
                }
            });
        });

        el.append(avatar, name, state, invite);
        return el;
    }
}

function row(text: string, className: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
}
