import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import { TUTORIAL_5_ARCHERS } from '../game/tutorial';

export type Tutorial5Highlight = 'end-deploy' | null;

export type Tutorial5Step = 'r1Intro' | 'r1End' | 'done';

export interface Tutorial5BoardState {
    round: number;
}

const READ_STEPS: readonly Tutorial5Step[] = ['r1Intro'];

/**
 * Soft-hint overlay for Tutorial 5 (Terrain: high ground).
 * Not wired into the menu yet — runtime can still drive it by lesson id.
 */
export class TutorialGuide5 extends TutorialPanel {
    private step: Tutorial5Step = 'r1Intro';

    constructor(
        parent: HTMLElement,
        private readonly onHighlight: (target: Tutorial5Highlight) => void,
    ) {
        super(parent);
    }

    get currentStep(): Tutorial5Step {
        return this.step;
    }

    protected get isDone(): boolean {
        return this.step === 'done';
    }

    start(): void {
        if (this.destroyed) return;
        this.step = 'r1Intro';
        this.paint();
    }

    startRound(_round: number): void {
        // Only R1 for now.
    }

    syncFromBoard(_state: Tutorial5BoardState): void {
        if (this.destroyed || this.step === 'done') return;
        this.paint();
    }

    canEndDeploy(state: Tutorial5BoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        return state.round === 1 && this.step === 'r1End';
    }

    onPlayerEndedDeployment(): void {
        if (this.destroyed) return;
        this.step = 'done';
        this.onHighlight(null);
        this.setPanelVisible(false);
    }

    protected override onDestroy(): void {
        this.onHighlight(null);
    }

    protected override onNext(): void {
        if (this.step === 'r1Intro') {
            this.step = 'r1End';
            this.paint();
        }
    }

    private paint(): void {
        this.setNextVisible((READ_STEPS as readonly string[]).includes(this.step));

        let highlight: Tutorial5Highlight = null;
        switch (this.step) {
            case 'r1Intro':
                this.titleEl.textContent = t('tutorial:tutorial5R1IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial5R1IntroBody', {
                    packs: TUTORIAL_5_ARCHERS,
                });
                break;
            case 'r1End':
                this.titleEl.textContent = t('tutorial:tutorial5R1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial5R1EndBody');
                highlight = 'end-deploy';
                break;
            case 'done':
                this.setPanelVisible(false);
                this.onHighlight(null);
                return;
        }

        this.onHighlight(highlight);
        this.setPanelVisible(true);
    }
}
