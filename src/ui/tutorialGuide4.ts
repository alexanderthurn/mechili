import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import {
    TUTORIAL_4_ARCHERS,
    TUTORIAL_4_FORGE_PRODUCT,
    TUTORIAL_4_RUNE_LESSON,
} from '../game/tutorial';

export type Tutorial4Highlight =
    | 'runes'
    | 'rune-fire'
    | 'rune-earth'
    | 'rune-water'
    | 'rune-wind'
    | 'stronghold'
    | 'tech-barrel'
    | 'tactics-hammer'
    | 'end-deploy'
    | null;

export type Tutorial4Step =
    | 'r1Intro'
    | 'r1Buy0'
    | 'r1Assign0'
    | 'r1Buy1'
    | 'r1Assign1'
    | 'r1Buy2'
    | 'r1Assign2'
    | 'r1Buy3'
    | 'r1Assign3'
    | 'r1End'
    | 'r2Intro'
    | 'r2SelectKeep'
    | 'r2Forge'
    | 'r2End'
    | 'r3Intro'
    | 'r3Apply'
    | 'r3End'
    | 'r4Intro'
    | 'r4SelectArcher'
    | 'r4BuyLongbow'
    | 'r4End'
    | 'r5Intro'
    | 'r5ArmHammer'
    | 'r5PlaceHammer'
    | 'r5End'
    | 'done';

export interface Tutorial4BoardState {
    round: number;
    /** whether each guided-rune step's pack already holds that rune */
    runeAssigned: boolean[];
    /** bag currently holds the armed shop rune id (after buy) */
    armedRuneId: string | null;
    forgeReady: boolean;
    forgeInserts: number;
    forgedOwned: boolean;
    forgedApplied: boolean;
    archerSelected: boolean;
    longbowOwned: boolean;
    hammerArmed: boolean;
    hammerPlaced: boolean;
    keepSelected: boolean;
}

const READ_STEPS: readonly Tutorial4Step[] = [
    'r1Intro',
    'r2Intro',
    'r3Intro',
    'r4Intro',
    'r5Intro',
];

const RUNE_HIGHLIGHT: Record<string, Tutorial4Highlight> = {
    fire: 'rune-fire',
    earth: 'rune-earth',
    wind: 'rune-wind',
    water: 'rune-water',
};

/**
 * Soft-hint overlay for Tutorial 4 (Units: runes, forge, talent, height+Hammer).
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

    start(): void {
        if (this.destroyed) return;
        this.step = 'r1Intro';
        this.paint();
    }

    startRound(round: number): void {
        if (this.destroyed) return;
        if (round === 2) this.step = 'r2Intro';
        else if (round === 3) this.step = 'r3Intro';
        else if (round === 4) this.step = 'r4Intro';
        else if (round === 5) this.step = 'r5Intro';
        else return;
        this.paint();
    }

    syncFromBoard(state: Tutorial4BoardState): void {
        if (this.destroyed || this.step === 'done') return;
        this.lastState = state;

        if (state.round === 1) {
            for (let i = 0; i < TUTORIAL_4_RUNE_LESSON.length; i++) {
                const buy = `r1Buy${i}` as Tutorial4Step;
                const assign = `r1Assign${i}` as Tutorial4Step;
                const runeId = TUTORIAL_4_RUNE_LESSON[i]!.runeId;
                if (this.step === buy && state.armedRuneId === runeId) {
                    this.step = assign;
                } else if (this.step === assign && state.runeAssigned[i]) {
                    this.step = (i + 1 < TUTORIAL_4_RUNE_LESSON.length
                        ? (`r1Buy${i + 1}` as Tutorial4Step)
                        : 'r1End');
                }
            }
        } else if (state.round === 2) {
            if (this.step === 'r2SelectKeep' && state.keepSelected) {
                this.step = 'r2Forge';
            } else if (this.step === 'r2Forge' && state.forgeReady) {
                this.step = 'r2End';
            }
        } else if (state.round === 3) {
            if (this.step === 'r3Apply' && state.forgedApplied) {
                this.step = 'r3End';
            }
        } else if (state.round === 4) {
            if (this.step === 'r4SelectArcher' && state.archerSelected) {
                this.step = 'r4BuyLongbow';
            } else if (this.step === 'r4BuyLongbow' && state.longbowOwned) {
                this.step = 'r4End';
            }
        } else if (state.round === 5) {
            if (this.step === 'r5ArmHammer' && state.hammerArmed) {
                this.step = 'r5PlaceHammer';
            } else if (this.step === 'r5PlaceHammer' && state.hammerPlaced) {
                this.step = 'r5End';
            }
        }

        this.paint();
    }

    canEndDeploy(state: Tutorial4BoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        if (state.round === 1) {
            return this.step === 'r1End' && state.runeAssigned.every(Boolean);
        }
        if (state.round === 2) {
            return this.step === 'r2End' && state.forgeReady;
        }
        if (state.round === 3) {
            return this.step === 'r3End' && state.forgedApplied;
        }
        if (state.round === 4) {
            return this.step === 'r4End' && state.longbowOwned;
        }
        if (state.round === 5) {
            return this.step === 'r5End' && state.hammerPlaced;
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
                this.step = 'r1Buy0';
                break;
            case 'r2Intro':
                this.step = 'r2SelectKeep';
                break;
            case 'r3Intro':
                this.step = 'r3Apply';
                break;
            case 'r4Intro':
                this.step = 'r4SelectArcher';
                break;
            case 'r5Intro':
                this.step = 'r5ArmHammer';
                break;
            default:
                return;
        }
        this.paint();
    }

    private paint(): void {
        this.setNextVisible((READ_STEPS as readonly string[]).includes(this.step));

        let highlight: Tutorial4Highlight = null;
        const lesson = TUTORIAL_4_RUNE_LESSON;

        switch (this.step) {
            case 'r1Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R1IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1IntroBody');
                break;
            case 'r1Buy0':
            case 'r1Buy1':
            case 'r1Buy2':
            case 'r1Buy3': {
                const i = Number(this.step.slice(-1));
                const runeId = lesson[i]!.runeId;
                this.titleEl.textContent = t(`tutorial:tutorial4R1Buy${runeId}Title`);
                this.bodyEl.textContent = t(`tutorial:tutorial4R1Buy${runeId}Body`);
                highlight = RUNE_HIGHLIGHT[runeId] ?? 'runes';
                break;
            }
            case 'r1Assign0':
            case 'r1Assign1':
            case 'r1Assign2':
            case 'r1Assign3': {
                const i = Number(this.step.slice(-1));
                const runeId = lesson[i]!.runeId;
                this.titleEl.textContent = t(`tutorial:tutorial4R1Assign${runeId}Title`);
                this.bodyEl.textContent = t(`tutorial:tutorial4R1Assign${runeId}Body`);
                break;
            }
            case 'r1End':
                this.titleEl.textContent = t('tutorial:tutorial4R1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R1EndBody');
                highlight = 'end-deploy';
                break;
            case 'r2Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R2IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2IntroBody');
                break;
            case 'r2SelectKeep':
                this.titleEl.textContent = t('tutorial:tutorial4R2SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2SelectBody');
                highlight = 'stronghold';
                break;
            case 'r2Forge': {
                const n = this.lastState?.forgeInserts ?? 0;
                this.titleEl.textContent = t('tutorial:tutorial4R2ForgeTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2ForgeBody', {
                    n,
                    need: 3,
                    product: TUTORIAL_4_FORGE_PRODUCT,
                });
                highlight = 'rune-fire';
                break;
            }
            case 'r2End':
                this.titleEl.textContent = t('tutorial:tutorial4R2EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R2EndBody');
                highlight = 'end-deploy';
                break;
            case 'r3Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R3IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R3IntroBody');
                break;
            case 'r3Apply':
                this.titleEl.textContent = t('tutorial:tutorial4R3ApplyTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R3ApplyBody');
                break;
            case 'r3End':
                this.titleEl.textContent = t('tutorial:tutorial4R3EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R3EndBody');
                highlight = 'end-deploy';
                break;
            case 'r4Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R4IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R4IntroBody', {
                    packs: TUTORIAL_4_ARCHERS,
                });
                break;
            case 'r4SelectArcher':
                this.titleEl.textContent = t('tutorial:tutorial4R4SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R4SelectBody');
                break;
            case 'r4BuyLongbow':
                this.titleEl.textContent = t('tutorial:tutorial4R4LongbowTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R4LongbowBody');
                highlight = 'tech-barrel';
                break;
            case 'r4End':
                this.titleEl.textContent = t('tutorial:tutorial4R4EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R4EndBody');
                highlight = 'end-deploy';
                break;
            case 'r5Intro':
                this.titleEl.textContent = t('tutorial:tutorial4R5IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R5IntroBody');
                break;
            case 'r5ArmHammer':
                this.titleEl.textContent = t('tutorial:tutorial4R5ArmTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R5ArmBody');
                highlight = 'tactics-hammer';
                break;
            case 'r5PlaceHammer':
                this.titleEl.textContent = t('tutorial:tutorial4R5PlaceTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R5PlaceBody');
                break;
            case 'r5End':
                this.titleEl.textContent = t('tutorial:tutorial4R5EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial4R5EndBody');
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
