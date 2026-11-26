/**
 * The player's profile corner: the name / avatar label in the menu and the
 * dialog behind it (rename, avatar, open profile, the loadout and replay
 * shortcuts). main.ts owns the corner's elements and hands them over once
 * ({@link initProfileEditor}).
 */
import { steam } from 'steam-electron-build/native';
import { claimName, getCachedProfile, shouldPersistAvatarToPhp, syncOpenProfile, uploadAvatar } from '../game/account';
import { getAvatarDataUrl, resizeImageFileToAvatar, setAvatarDataUrl } from '../game/avatar';
import { getPlayerName, PLAYER_NAME_MAX, setPlayerName, validatePlayerName } from '../game/player';
import { t } from '../i18n';
import { escapeHtml } from '../ui/escapeHtml';
import { showReplayList } from '../ui/replayList';

/** what the profile dialog needs from the menu */
export interface ProfileEditorDeps {
    /** the game layer root — the dialog mounts here */
    wrapper: HTMLElement;
    /** the corner button and its avatar / name parts */
    usernameEl: HTMLButtonElement;
    usernameAvatarEl: HTMLImageElement;
    usernameTextEl: HTMLSpanElement;
    /** a match is running or a connection is pending — the dialog stays shut */
    isMenuBusy: () => boolean;
    /** the loadout screen takes over the whole viewport (the menu chrome steps aside) */
    openLoadout: () => void;
    watchReplay: (id: string, side: 'a' | 'b') => Promise<void> | void;
}

let deps!: ProfileEditorDeps;

export function initProfileEditor(profileDeps: ProfileEditorDeps): void {
    deps = profileDeps;
}

export function refreshUsernameLabel(): void {
    const name = getPlayerName();
    const profile = getCachedProfile();
    // Password UI is inactive — never show a lock badge. If the backend still
    // has a password on this name (legacy), we simply omit MMR until a session
    // exists; the local display name still works for lobbies / matches.
    deps.usernameTextEl.textContent = profile ? `${name} · ${profile.mmr}` : name;
    const avatar = getAvatarDataUrl();
    if (avatar) {
        deps.usernameAvatarEl.src = avatar;
        deps.usernameAvatarEl.hidden = false;
        deps.usernameEl.classList.add('has-avatar');
    } else {
        deps.usernameAvatarEl.removeAttribute('src');
        deps.usernameAvatarEl.hidden = true;
        deps.usernameEl.classList.remove('has-avatar');
    }
}

export async function refreshOpenProfile(): Promise<void> {
    const profile = await syncOpenProfile(getPlayerName());
    // Restore avatar from PHP when online PeerJS (not LAN / Steam transport).
    if (shouldPersistAvatarToPhp() && !steam.isAvailable() && profile && 'avatar' in profile) {
        if (typeof profile.avatar === 'string' && profile.avatar.startsWith('data:image/')) {
            setAvatarDataUrl(profile.avatar);
        } else if (profile.avatar === null && profile.hasAvatar === false) {
            // Server explicitly has no avatar — keep local (may not have synced yet).
        }
    }
    refreshUsernameLabel();
}

export function showNameEditor(): void {
    if (deps.isMenuBusy()) return;
    const steamLocked = steam.isAvailable();
    const overlay = document.createElement('div');
    overlay.className = 'mechili-name-edit';
    const currentAvatar = getAvatarDataUrl();
    const syncHint = steamLocked
        ? t('menu:hintSteamAvatar')
        : shouldPersistAvatarToPhp()
          ? t('menu:hintOnlineAvatar')
          : t('menu:hintLocalAvatar');
    overlay.innerHTML =
        `<div class="box">` +
        `<div class="title">${steamLocked ? t('menu:profileAvatar') : t('menu:profileUsername')}</div>` +
        `<div class="avatar-row">` +
        `<img class="avatar-preview" alt="" hidden />` +
        `<label class="avatar-pick">${t('menu:uploadImage')}<input class="avatar-file" type="file" accept="image/*" hidden /></label>` +
        `<button type="button" data-act="clear-avatar">${t('menu:clearAvatar')}</button>` +
        `</div>` +
        `<input class="name-input" maxlength="${PLAYER_NAME_MAX}" spellcheck="false" value="${escapeHtml(getPlayerName())}" ${steamLocked ? 'readonly' : ''} />` +
        `<div class="hint">${syncHint}</div>` +
        `<div class="error" hidden></div>` +
        `<button type="button" class="profile-loadout" data-act="loadout">${t('menu:unitLoadout')}</button>` +
        `<button type="button" class="profile-loadout" data-act="replays">${t('menu:replays', { defaultValue: 'Replays' })}</button>` +
        `<div class="actions">` +
        `<button type="button" data-act="cancel">${t('menu:cancel')}</button>` +
        `<button type="button" class="primary" data-act="save">${t('menu:save')}</button>` +
        `</div></div>`;

    const nameInput = overlay.querySelector<HTMLInputElement>('.name-input')!;
    const fileInput = overlay.querySelector<HTMLInputElement>('.avatar-file')!;
    const previewEl = overlay.querySelector<HTMLImageElement>('.avatar-preview')!;
    if (currentAvatar) {
        previewEl.src = currentAvatar;
        previewEl.hidden = false;
    }
    const errorEl = overlay.querySelector<HTMLDivElement>('.error')!;
    if (!steamLocked) nameInput.select();

    let pendingAvatar: string | null | undefined = undefined; // undefined = unchanged

    const setError = (msg: string) => {
        errorEl.hidden = !msg;
        errorEl.textContent = msg;
    };

    const showPreview = (url: string | null) => {
        if (url) {
            previewEl.src = url;
            previewEl.hidden = false;
        } else {
            previewEl.removeAttribute('src');
            previewEl.hidden = true;
        }
    };

    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    const close = () => {
        if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
        overlay.remove();
    };

    const setBusy = (busy: boolean) => {
        // every button in the dialog, not just the .actions pair — the Edit
        // Loadout button lives outside that row and saves on its way out, so
        // it must not stay clickable while a save is already in flight
        overlay.querySelectorAll('button').forEach((b) => {
            b.disabled = busy;
        });
        if (!steamLocked) nameInput.disabled = busy;
        fileInput.disabled = busy;
    };

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        void (async () => {
            setError('');
            const dataUrl = await resizeImageFileToAvatar(file);
            if (!dataUrl) {
                setError(t('menu:errBadImage'));
                return;
            }
            pendingAvatar = dataUrl;
            showPreview(dataUrl);
        })();
    });

    /** @returns true once the edit was accepted and the dialog closed. */
    const save = async (): Promise<boolean> => {
        const next = steamLocked ? getPlayerName() : validatePlayerName(nameInput.value);
        if (!next) {
            nameInput.style.borderColor = '#e83828';
            setError(t('menu:errBadName'));
            return false;
        }
        nameInput.style.borderColor = '';
        setError('');
        setBusy(true);

        if (!steamLocked) setPlayerName(next);
        if (pendingAvatar !== undefined) setAvatarDataUrl(pendingAvatar);
        refreshUsernameLabel();
        if (!steamLocked) {
            const result = await claimName({ name: next });
            if (pendingAvatar !== undefined && shouldPersistAvatarToPhp()) {
                await uploadAvatar({ name: next, avatar: pendingAvatar });
            } else if (result.ok) {
                void refreshOpenProfile();
            }
        }
        setBusy(false);
        close();
        return true;
    };

    overlay.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
        if (act === 'cancel' || e.target === overlay) {
            close();
            return;
        }
        if (act === 'clear-avatar') {
            pendingAvatar = null;
            showPreview(null);
            return;
        }
        if (act === 'loadout') {
            // save first, then navigate — leaving through this button must not
            // silently discard a name/avatar edit the player already made
            void save().then((saved) => {
                // a rejected name leaves the dialog open — navigating anyway
                // would strand the overlay on top of the loadout screen
                if (!saved) return;
                // the loadout screen takes over the whole viewport, so the
                // whole menu chrome steps aside until it closes
                deps.openLoadout();
            });
            return;
        }
        if (act === 'replays') {
            // same as the loadout: an edit already made is saved on the way out
            void save().then((saved) => {
                if (!saved) return;
                showReplayList(deps.wrapper, {
                    playerName: getPlayerName(),
                    onWatch: (id, side) => void deps.watchReplay(id, side),
                });
            });
            return;
        }
        if (act === 'save') void save();
    });

    onKeyDown = (e) => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') close();
        if (e.key === 'Enter') void save();
    };
    window.addEventListener('keydown', onKeyDown);

    nameInput.focus();
    deps.wrapper.appendChild(overlay);
}
