import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import {
    TUTORIAL_4_ARCHERS,
    TUTORIAL_4_MIN_RUNES,
} from '../game/tutorial';

export type Tutorial4Highlight =
    | 'runes'
    | 'tech-barrel'
    | 'end-deploy'
    | null;

export type Tutorial4Step =
    | 'r1Intro'
    | 'r1BuyRunes'
    | 'r1EquipHint'
    | 'r1End'
    | 'r2Intro'
    | 'r2SelectArcher'
    | 'r2BuyLongbow'
    | 'r2End'
    | 'done';

export interface Tutorial4BoardState {
    round: number;
    runesBought: number;
    /** runes already slotted into packs — drives the equip hint's counter only */
    runesApplied: number;
    archerSelected: boolean;
    /** Longbow (`barrel`) researched for archers this seat */
    longbowOwned: boolean;
}

/** Steps that wait on the Next button instead of a board change. */
const READ_STEPS: readonly Tutorial4Step[] = [
    'r1Intro',
    'r1EquipHint',
    'r2Intro',
];

/**
 * Soft-hint overlay for Tutorial 4 (Units lesson: runes, then Range talent).
 */
export class TutorialGuide4 extends TutorialPanel {
    private step: Tutorial4Step = 'r1Intro';
    private lastState: Tutorial4BoardState | null = null;

    constructor(
        parent: HTMLElement,
        private readonly onHighlight: (target: Tutorial4Highlight) => void,
    ) {
        super(parent);
    }

    get currentStep(): Tutorial4Step {
        return this.step;
    }

    protected get isDone(): boolean {
        return this.step === 'done';
    }

    /** Begin round 1 after match intro. */
    start(): void {
        if (this.destroyed) return;
        this.step = 'r1Intro';
        this.paint();
    }

    /** Advance the guide when a new build phase begins (round 2). */
    startRound(round: number): void {
        if (this.destroyed) return;
        if (round === 2) this.step = 'r2Intro';
        else return;
        this.paint();
    }

    /**
     * Reconcile with the live board / shop / talent panel.
     * The End Deployment gate is a separate read — see {@link canEndDeploy}.
     */
    syncFromBoard(state: Tutorial4BoardState): void {
        if (this.destroyed || this.step === 'done') return;
        this.lastState = state;

        if (state.round === 1) {
            if (this.step === 'r1BuyRunes' && state.runesBought >= TUTORIAL_4_MIN_RUNES) {
                this.step = 'r1EquipHint';
            }
        } else if (state.round === 2) {
            if (this.step === 'r2SelectArcher' && state.archerSelected) {
                this.step = 'r2BuyLongbow';
            } else if (this.step === 'r2BuyLongbow' && state.longbowOwned) {
                this.step = 'r2End';
            }
        }

        this.paint();
    }

    canEndDeploy(state: Tutorial4BoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        if (state.round === 1) {
            return this.step === 'r1End' && state.runesBought >= TUTORIAL_4_MIN_RUNES;
        }
        if (state.round === 2) {
            return this.step === 'r2End' && state.longbowOwned;
        }
        return false;
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
        switch (this.step) {
            case 'r1Intro':
                this.step = 'r1BuyRunes';
                break;
            case 'r1EquipHint':
                this.step = 'r1End';
                break;
            case 'r2Intro':
                this.step = 'r2SelectArcher';
                break;
            default:
                return;
        }
        this.paint();
    }

    private paint(): void {
        this.setNextVisible((READ_STEPS as readonly string[]).includes(this.step));

        let highlight: Tutorial4Highlight = null;

        switch (this.step) {
            case 'r1Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R1IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1IntroBody');
                break;
            case 'r1BuyRunes': {
                const bought = Math.min(this.lastState?.runesBought ?? 0, TUTORIAL_4_MIN_RUNES);
                this.titleEl.textContent = t('tutorial:tutorial4R1RunesTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1RunesBody', {
                    bought,
                    need: TUTORIAL_4_MIN_RUNES,
                });
                highlight = 'runes';
                break;
            }
            case 'r1EquipHint': {
                const applied = this.lastState?.runesApplied ?? 0;
                this.titleEl.textContent = t('tutorial:tutorial4R1EquipTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1EquipBody', { applied });
                break;
            }
            case 'r1End':
                this.titleEl.textContent = t('tutorial:tutorial4R1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1EndBody');
                highlight = 'end-deploy';
                break;
            case 'r2Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R2IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2IntroBody', {
                    packs: TUTORIAL_4_ARCHERS,
                });
                break;
            case 'r2SelectArcher':
                this.titleEl.textContent = t('tutorial:tutorial4R2SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2SelectBody');
                break;
            case 'r2BuyLongbow':
                this.titleEl.textContent = t('tutorial:tutorial4R2LongbowTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2LongbowBody');
                highlight = 'tech-barrel';
                break;
            case 'r2End':
                this.titleEl.textContent = t('tutorial:tutorial4R2EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2EndBody');
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
