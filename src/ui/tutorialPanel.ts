import { t } from '../i18n';

/** How long a soft nudge stays on screen. */
const NUDGE_MS = 2400;

/**
 * Shared chrome for the lesson overlays: the panel (title / body / Next), the
 * transient nudge line under it, and their teardown. Each lesson subclass owns
 * its own step machine and paints into {@link titleEl} / {@link bodyEl}.
 */
export abstract class TutorialPanel {
    protected readonly root: HTMLDivElement;
    protected readonly titleEl: HTMLDivElement;
    protected readonly bodyEl: HTMLDivElement;
    protected readonly nextBtn: HTMLButtonElement;
    private readonly nudgeEl: HTMLDivElement;
    private nudgeTimer: number | null = null;
    protected destroyed = false;

    constructor(parent: HTMLElement) {
        this.root = document.createElement('div');
        this.root.className = 'mechili-tutorial';
        this.titleEl = document.createElement('div');
        this.titleEl.className = 'tut-title';
        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'tut-body';
        this.nextBtn = document.createElement('button');
        this.nextBtn.type = 'button';
        this.nextBtn.className = 'tut-next';
        this.nextBtn.style.display = 'none';
        this.nextBtn.addEventListener('click', () => this.onNext());
        this.root.append(this.titleEl, this.bodyEl, this.nextBtn);

        this.nudgeEl = document.createElement('div');
        this.nudgeEl.className = 'mechili-tutorial-nudge';
        this.nudgeEl.style.display = 'none';

        parent.append(this.root, this.nudgeEl);
    }

    /** True once the lesson's overlay has finished (nudges stop). */
    protected abstract get isDone(): boolean;

    /** A read-step's Next button was pressed. */
    protected onNext(): void {}

    /** Show / hide the whole panel — a finished lesson hides it for good. */
    protected setPanelVisible(visible: boolean): void {
        this.root.style.display = visible ? '' : 'none';
    }

    /** Next only shows on steps that wait on the player reading them. */
    protected setNextVisible(visible: boolean): void {
        this.nextBtn.textContent = t('tutorial:tutorialNext');
        this.nextBtn.style.display = visible ? '' : 'none';
    }

    /** Soft nudge — a wrong or early click. Never blocks; fades on its own. */
    nudge(message: string): void {
        if (this.destroyed || this.isDone) return;
        this.nudgeEl.textContent = message;
        this.nudgeEl.style.display = '';
        this.nudgeEl.classList.add('is-visible');
        if (this.nudgeTimer !== null) window.clearTimeout(this.nudgeTimer);
        this.nudgeTimer = window.setTimeout(() => {
            this.nudgeEl.classList.remove('is-visible');
            this.nudgeTimer = null;
        }, NUDGE_MS);
    }

    destroy(): void {
        this.destroyed = true;
        if (this.nudgeTimer !== null) window.clearTimeout(this.nudgeTimer);
        this.onDestroy();
        this.root.remove();
        this.nudgeEl.remove();
    }

    /** Subclass teardown (clear highlights / board markers) before removal. */
    protected onDestroy(): void {}
}
