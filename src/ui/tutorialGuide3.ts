import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import {
    TUTORIAL_3_BOOST_MAX_TIERS,
    TUTORIAL_3_MIN_RUNES,
    TUTORIAL_3_R4_ARCHERS,
} from '../game/tutorial';

export type Tutorial3Highlight =
    | 'shop-dwarf'
    | 'shop-ballista'
    | 'vanguard'
    | 'boost-attack'
    | 'boost-hp'
    | 'runes'
    | 'tech-barrel'
    | 'end-deploy'
    | null;

export type Tutorial3Step =
    | 'r1Intro'
    | 'r1BuyDwarf'
    | 'r1PlaceDwarf'
    | 'r1BuyBallista'
    | 'r1PlaceBallista'
    | 'r1DebuffExplain'
    | 'r1End'
    | 'r2Intro'
    | 'r2SelectVanguard'
    | 'r2BoostAttack'
    | 'r2BoostHp'
    | 'r2End'
    | 'r3Intro'
    | 'r3BuyRunes'
    | 'r3EquipHint'
    | 'r3End'
    | 'r4Intro'
    | 'r4SelectArcher'
    | 'r4BuyLongbow'
    | 'r4End'
    | 'done';

export interface Tutorial3BoardState {
    round: number;
    dwarfCount: number;
    ballistaCount: number;
    dwarfPlaced: boolean;
    ballistaPlaced: boolean;
    vanguardSelected: boolean;
    boostAttack: number;
    boostHp: number;
    /** tiers per track (settings.boosts.costs.length) */
    boostMax: number;
    runesBought: number;
    /** runes already slotted into packs — drives the equip hint's counter only */
    runesApplied: number;
    archerSelected: boolean;
    /** Longbow (`barrel`) researched for archers this seat */
    longbowOwned: boolean;
}

/** Steps that wait on the Next button instead of a board change. */
const READ_STEPS: readonly Tutorial3Step[] = [
    'r1Intro',
    'r1DebuffExplain',
    'r2Intro',
    'r3Intro',
    'r3EquipHint',
    'r4Intro',
];

/**
 * Soft-hint overlay for Tutorial 3 (Tower lesson, four rounds).
 */
export class TutorialGuide3 extends TutorialPanel {
    private step: Tutorial3Step = 'r1Intro';
    private lastState: Tutorial3BoardState | null = null;

    constructor(
        parent: HTMLElement,
        private readonly onHighlight: (target: Tutorial3Highlight) => void,
    ) {
        super(parent);
    }

    get currentStep(): Tutorial3Step {
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

    /** Advance the guide when a new build phase begins (rounds 2–4). */
    startRound(round: number): void {
        if (this.destroyed) return;
        if (round === 2) this.step = 'r2Intro';
        else if (round === 3) this.step = 'r3Intro';
        else if (round === 4) this.step = 'r4Intro';
        else return;
        this.paint();
    }

    /**
     * Reconcile with the live board / Vanguard panel / shop.
     * The End Deployment gate is a separate read — see {@link canEndDeploy}.
     */
    syncFromBoard(state: Tutorial3BoardState): void {
        if (this.destroyed || this.step === 'done') return;
        this.lastState = state;

        if (state.round === 1) {
            if (this.step === 'r1BuyDwarf' && state.dwarfCount >= 1) {
                this.step = 'r1PlaceDwarf';
            } else if (this.step === 'r1PlaceDwarf' && state.dwarfPlaced) {
                this.step = 'r1BuyBallista';
            } else if (this.step === 'r1BuyBallista' && state.ballistaCount >= 1) {
                this.step = 'r1PlaceBallista';
            } else if (this.step === 'r1PlaceBallista' && state.ballistaPlaced) {
                this.step = 'r1DebuffExplain';
            }
        } else if (state.round === 2) {
            if (this.step === 'r2SelectVanguard' && state.vanguardSelected) {
                this.step = 'r2BoostAttack';
            } else if (this.step === 'r2BoostAttack' && state.boostAttack >= state.boostMax) {
                this.step = 'r2BoostHp';
            } else if (this.step === 'r2BoostHp' && state.boostHp >= state.boostMax) {
                this.step = 'r2End';
            }
        } else if (state.round === 3) {
            if (this.step === 'r3BuyRunes' && state.runesBought >= TUTORIAL_3_MIN_RUNES) {
                this.step = 'r3EquipHint';
            }
        } else if (state.round === 4) {
            if (this.step === 'r4SelectArcher' && state.archerSelected) {
                this.step = 'r4BuyLongbow';
            } else if (this.step === 'r4BuyLongbow' && state.longbowOwned) {
                this.step = 'r4End';
            }
        }

        this.paint();
    }

    canEndDeploy(state: Tutorial3BoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        if (state.round === 1) {
            return this.step === 'r1End' && state.dwarfPlaced && state.ballistaPlaced;
        }
        if (state.round === 2) {
            return (
                this.step === 'r2End' &&
                state.boostAttack >= state.boostMax &&
                state.boostHp >= state.boostMax
            );
        }
        if (state.round === 3) {
            return this.step === 'r3End' && state.runesBought >= TUTORIAL_3_MIN_RUNES;
        }
        if (state.round === 4) {
            return this.step === 'r4End' && state.longbowOwned;
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
                this.step = 'r1BuyDwarf';
                break;
            case 'r1DebuffExplain':
                this.step = 'r1End';
                break;
            case 'r2Intro':
                this.step = 'r2SelectVanguard';
                break;
            case 'r3Intro':
                this.step = 'r3BuyRunes';
                break;
            case 'r3EquipHint':
                this.step = 'r3End';
                break;
            case 'r4Intro':
                this.step = 'r4SelectArcher';
                break;
            default:
                return;
        }
        this.paint();
    }

    private paint(): void {
        this.setNextVisible((READ_STEPS as readonly string[]).includes(this.step));

        let highlight: Tutorial3Highlight = null;

        switch (this.step) {
            case 'r1Intro':
                this.titleEl.textContent = t('tutorial:tutorial3R1IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1IntroBody');
                break;
            case 'r1BuyDwarf':
                this.titleEl.textContent = t('tutorial:tutorial3R1BuyDwarfTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1BuyDwarfBody');
                highlight = 'shop-dwarf';
                break;
            case 'r1PlaceDwarf':
                this.titleEl.textContent = t('tutorial:tutorial3R1PlaceDwarfTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1PlaceDwarfBody');
                break;
            case 'r1BuyBallista':
                this.titleEl.textContent = t('tutorial:tutorial3R1BuyBallistaTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1BuyBallistaBody');
                highlight = 'shop-ballista';
                break;
            case 'r1PlaceBallista':
                this.titleEl.textContent = t('tutorial:tutorial3R1PlaceBallistaTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1PlaceBallistaBody');
                break;
            case 'r1DebuffExplain':
                this.titleEl.textContent = t('tutorial:tutorial3R1DebuffTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1DebuffBody');
                break;
            case 'r1End':
                this.titleEl.textContent = t('tutorial:tutorial3R1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R1EndBody');
                highlight = 'end-deploy';
                break;
            case 'r2Intro':
                this.titleEl.textContent = t('tutorial:tutorial3R2IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R2IntroBody');
                break;
            case 'r2SelectVanguard':
                this.titleEl.textContent = t('tutorial:tutorial3R2SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R2SelectBody');
                highlight = 'vanguard';
                break;
            case 'r2BoostAttack': {
                const tier = this.lastState?.boostAttack ?? 0;
                const max = this.lastState?.boostMax ?? TUTORIAL_3_BOOST_MAX_TIERS;
                this.titleEl.textContent = t('tutorial:tutorial3R2AttackTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R2AttackBody', { tier, max });
                highlight = 'boost-attack';
                break;
            }
            case 'r2BoostHp': {
                const tier = this.lastState?.boostHp ?? 0;
                const max = this.lastState?.boostMax ?? TUTORIAL_3_BOOST_MAX_TIERS;
                this.titleEl.textContent = t('tutorial:tutorial3R2HpTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R2HpBody', { tier, max });
                highlight = 'boost-hp';
                break;
            }
            case 'r2End':
                this.titleEl.textContent = t('tutorial:tutorial3R2EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R2EndBody');
                highlight = 'end-deploy';
                break;
            case 'r3Intro':
                this.titleEl.textContent = t('tutorial:tutorial3R3IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3IntroBody');
                break;
            case 'r3BuyRunes': {
                const bought = Math.min(this.lastState?.runesBought ?? 0, TUTORIAL_3_MIN_RUNES);
                this.titleEl.textContent = t('tutorial:tutorial3R3RunesTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3RunesBody', {
                    bought,
                    need: TUTORIAL_3_MIN_RUNES,
                });
                highlight = 'runes';
                break;
            }
            case 'r3EquipHint': {
                const applied = this.lastState?.runesApplied ?? 0;
                this.titleEl.textContent = t('tutorial:tutorial3R3EquipTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3EquipBody', { applied });
                break;
            }
            case 'r3End':
                this.titleEl.textContent = t('tutorial:tutorial3R3EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3EndBody');
                highlight = 'end-deploy';
                break;
            case 'r4Intro':
                this.titleEl.textContent = t('tutorial:tutorial3R4IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4IntroBody', {
                    packs: TUTORIAL_3_R4_ARCHERS,
                });
                break;
            case 'r4SelectArcher':
                this.titleEl.textContent = t('tutorial:tutorial3R4SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4SelectBody');
                break;
            case 'r4BuyLongbow':
                this.titleEl.textContent = t('tutorial:tutorial3R4LongbowTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4LongbowBody');
                highlight = 'tech-barrel';
                break;
            case 'r4End':
                this.titleEl.textContent = t('tutorial:tutorial3R4EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4EndBody');
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
