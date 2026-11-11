/**
 * Watch-mode-only controls: jump to a round and skip a deployment. The speed
 * is the match's own speed button (shown for the whole replay, see Hud), not
 * a control of its own here.
 * A small, self-contained DOM overlay, not folded into the large Hud class —
 * it survives across the Game reconstructions a round-jump causes (main.ts's
 * rebuildReplayAt), so it can't be owned by the Game instance itself.
 */
import { t } from '../i18n';

export interface ReplayControlsCallbacks {
    onJump(round: number): void;
    onSkipDeployment(): void;
    /** save the board as it stands as a scenario; resolves to a short status line */
    onSaveScenario(): Promise<string>;
}

export class ReplayControls {
    private readonly root: HTMLDivElement;
    private readonly roundSelect: HTMLSelectElement;

    constructor(wrapper: HTMLElement, maxRound: number, cb: ReplayControlsCallbacks) {
        this.root = document.createElement('div');
        this.root.className = 'mechili-replay-controls';
        const roundOptions = Array.from({ length: maxRound }, (_, i) => i + 1)
            .map((r) =>
                `<option value="${r}">${t('hud:replayRoundOpt', { n: r, defaultValue: `Round ${r}` })}</option>`,
            )
            .join('');
        this.root.innerHTML =
            `<div class="rc-row">` +
            `<label>${t('hud:replayRound', { defaultValue: 'Round' })} <select class="rc-round">${roundOptions}</select></label>` +
            `<button type="button" class="rc-skip-deploy">${t('hud:replaySkipDeploy', { defaultValue: 'Skip Deployment' })}</button>` +
            `</div>` +
            // hidden for now: saving a replay's board as a scenario
            `<div class="rc-row" hidden>` +
            `<button type="button" class="rc-save-scenario">${t('hud:replaySaveScenario', { defaultValue: 'Save as scenario' })}</button>` +
            `<span class="rc-save-status"></span>` +
            `</div>`;

        this.roundSelect = this.root.querySelector<HTMLSelectElement>('.rc-round')!;

        // selecting a round jumps immediately — no separate confirm button
        this.roundSelect.addEventListener('change', () => {
            const round = Number(this.roundSelect.value);
            if (Number.isFinite(round) && round >= 1) cb.onJump(round);
        });
        this.root.querySelector('.rc-skip-deploy')!.addEventListener('click', () => cb.onSkipDeployment());
        const saveButton = this.root.querySelector<HTMLButtonElement>('.rc-save-scenario')!;
        const saveStatus = this.root.querySelector<HTMLSpanElement>('.rc-save-status')!;
        saveButton.addEventListener('click', () => {
            saveButton.disabled = true;
            void cb
                .onSaveScenario()
                .then((status) => (saveStatus.textContent = status))
                .catch((e: unknown) => (saveStatus.textContent = e instanceof Error ? e.message : String(e)))
                .finally(() => (saveButton.disabled = false));
        });

        wrapper.appendChild(this.root);
    }

    /** a battle is on or cinema mode (Shift+C): the panel steps aside (the speed button stays) */
    setHidden(on: boolean): void {
        this.root.classList.toggle('is-hidden', on);
    }

    /** a line above the controls (the replay was recorded with another build) */
    setWarning(text: string): void {
        let el = this.root.querySelector<HTMLDivElement>('.rc-warning');
        if (!el) {
            el = document.createElement('div');
            el.className = 'rc-warning';
            this.root.prepend(el);
        }
        el.textContent = text;
    }

    /** re-synced after a jump and at every round's start, so the dropdown shows where you are */
    setCurrentRound(round: number): void {
        this.roundSelect.value = String(round);
    }

    remove(): void {
        this.root.remove();
    }
}
