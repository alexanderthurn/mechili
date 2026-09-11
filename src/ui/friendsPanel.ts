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
import { t } from '../i18n';

/** EPersonaState — anything other than 0 is some flavour of online */
const STATE_OFFLINE = 0;
/** How often the open panel re-reads the list. Cheap: getAllFriends and
 *  getFriendGamePlayed are local reads out of the Steam client's own cache,
 *  not network calls, so this costs an IPC hop and some FFI, not traffic. */
const POLL_MS = 2000;

/**
 * steamId64 -> avatar data URL, or null when Steam had nothing cached.
 *
 * Caching is what makes 2s polling safe at all: the underlying lookup falls
 * back to fetching from steamcommunity.com when Steam's own image cache is
 * cold, and doing THAT every couple of seconds per friend would be abusive.
 * A hit is therefore kept for the whole session.
 *
 * A MISS is kept only until the panel is next opened (see forgetMissingAvatars).
 * Steam fills its cache in the background, so a friend whose avatar was not
 * ready the first time usually has one moments later — remembering "no avatar"
 * forever would leave them permanently blank for a reason that stopped being
 * true. Retrying on an explicit open, rather than on every poll, keeps the
 * retry rate tied to something the player did.
 */
const avatarCache = new Map<string, string | null>();

function avatarFor(steamId64: string): Promise<string | null> {
    const cached = avatarCache.get(steamId64);
    if (cached !== undefined) return Promise.resolve(cached);
    return steamFriends.avatar(steamId64).then((url) => {
        avatarCache.set(steamId64, url);
        return url;
    });
}

/** give avatars Steam had not cached yet one more chance */
function forgetMissingAvatars(): void {
    for (const [id, url] of avatarCache) if (url === null) avatarCache.delete(id);
}

/** What the rendered list actually depends on — re-render only when this moves,
 *  so a poll does not fight the player's scrolling, hovering or clicking. */
function listSignature(list: SteamFriend[]): string {
    return list.map((f) => `${f.steamId64}:${f.state}:${f.inThisGame ? 1 : 0}:${f.name}`).join('|');
}

function statusLabel(f: SteamFriend): string {
    if (f.inThisGame) return t('menu:statusInGame');
    return f.state === STATE_OFFLINE ? t('menu:statusOffline') : t('menu:statusOnline');
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
    private poll: ReturnType<typeof setInterval> | null = null;
    /** last rendered signature, null before the first render — NOT '', which is
     *  what an empty friends list legitimately signs as (it would match on the
     *  first poll and leave the panel stuck on "Loading friends…" forever) */
    private rendered: string | null = null;
    /** friends already invited this session, so a re-render keeps saying so */
    private readonly invited = new Set<string>();
    private readonly onDocPointer: (e: PointerEvent) => void;

    constructor() {
        this.el.className = 'mechili-friends';
        this.el.style.display = 'none';
        const title = document.createElement('div');
        title.className = 'fr-title';
        title.textContent = t('menu:friendsTitle');
        this.listEl.className = 'fr-list';
        this.noteEl.className = 'fr-note';
        this.noteEl.style.display = 'none';

        const overlayBtn = document.createElement('button');
        overlayBtn.type = 'button';
        overlayBtn.className = 'fr-overlay-btn';
        overlayBtn.textContent = t('menu:openSteamOverlay');
        overlayBtn.addEventListener('click', () => {
            void steamLobby.openInviteDialog().then((opened) => {
                this.note(
                    opened ? t('menu:overlayOpened') : t('menu:overlayFailed'),
                );
            });
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'fr-close';
        closeBtn.title = t('menu:close');
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
        if (this.poll) clearInterval(this.poll);
        this.poll = null;
        this.el.style.display = 'none';
    }

    /** Show the panel, load the list, and keep it current while it is open. */
    show(): void {
        this.open = true;
        this.el.style.display = '';
        this.note('');
        this.rendered = null;
        this.invited.clear();
        forgetMissingAvatars();
        this.listEl.replaceChildren(row(t('menu:loadingFriends'), 'fr-empty'));
        void this.refresh();
        if (this.poll) clearInterval(this.poll);
        // A friend launching the game is the single most likely thing to happen
        // while this is open — it should surface on its own rather than needing
        // the panel closed and reopened.
        this.poll = setInterval(() => void this.refresh(), POLL_MS);
    }

    private async refresh(): Promise<void> {
        const list = sortFriends(await steamFriends.list());
        if (!this.open) return;
        const signature = listSignature(list);
        if (signature === this.rendered) return;   // nothing moved
        this.rendered = signature;
        this.render(list);
    }

    private render(list: SteamFriend[]): void {
        this.listEl.replaceChildren();
        if (list.length === 0) {
            this.listEl.append(row(t('menu:noFriends'), 'fr-empty'));
            // The likeliest reason by far during a playtest, and the one a
            // player cannot deduce from an empty list on their own.
            this.note(t('menu:joinAccessNote'));
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
        void avatarFor(f.steamId64).then((url) => {
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
        const alreadyInvited = this.invited.has(f.steamId64);
        invite.textContent = alreadyInvited ? t('menu:invited') : t('menu:invite');
        invite.disabled = alreadyInvited;
        invite.addEventListener('click', () => {
            invite.disabled = true;
            void steamLobby.inviteUser(f.steamId64).then((sent) => {
                invite.textContent = sent ? t('menu:invited') : t('menu:failed');
                if (sent) {
                    this.invited.add(f.steamId64);
                } else {
                    invite.disabled = false;
                    this.note(t('menu:inviteFailed'));
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
