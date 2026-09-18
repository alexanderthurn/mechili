import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import {
    TUTORIAL_3_BOOST_MAX_TIERS,
    TUTORIAL_3_R3_DWARVES,
    TUTORIAL_3_R4_TOWER_LEVEL,
} from '../game/tutorial';

export type Tutorial3Highlight =
    | 'shop-dwarf'
    | 'shop-ballista'
    | 'shop-mortar'
    | 'vanguard'
    | 'garrison'
    | 'boost-attack'
    | 'boost-hp'
    | 'deploy-slot'
    | 'recruit-l2'
    | 'tower-upgrade'
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
    | 'r3SelectGarrison'
    | 'r3Recruit'
    | 'r3BuyTwo'
    | 'r3SelectGarrisonAgain'
    | 'r3DeploySlot'
    | 'r3BuyThird'
    | 'r3End'
    | 'r4Intro'
    | 'r4SelectTower'
    | 'r4Upgrade'
    | 'r4BuyMortar'
    | 'r4PlaceMortar'
    | 'r4BuyMortar2'
    | 'r4PlaceMortar2'
    | 'r4End'
    | 'done';

export interface Tutorial3BoardState {
    round: number;
    dwarfCount: number;
    ballistaCount: number;
    mortarCount: number;
    dwarfPlaced: boolean;
    ballistaPlaced: boolean;
    /** round 3: how many of the three pads are filled */
    r3PadsFilled: number;
    mortarPlaced: boolean;
    mortarPadsFilled: number;
    mortarPlaced0: boolean;
    mortarPlaced1: boolean;
    vanguardSelected: boolean;
    garrisonSelected: boolean;
    boostAttack: number;
    boostHp: number;
    boostMax: number;
    recruitActive: boolean;
    deployExtra: number;
    towerLevel: number;
}

const READ_STEPS: readonly Tutorial3Step[] = [
    'r1Intro',
    'r1DebuffExplain',
    'r2Intro',
    'r3Intro',
    'r4Intro',
];

/**
 * Soft-hint overlay for Tutorial 3 (Towers: debuff, Vanguard, Garrison, mortar).
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
        else return;
        this.paint();
    }

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
            if (this.step === 'r3SelectGarrison' && state.garrisonSelected) {
                this.step = 'r3Recruit';
            } else if (this.step === 'r3Recruit' && state.recruitActive) {
                this.step = 'r3BuyTwo';
            } else if (this.step === 'r3BuyTwo' && state.r3PadsFilled >= 2) {
                this.step = 'r3SelectGarrisonAgain';
            } else if (this.step === 'r3SelectGarrisonAgain' && state.garrisonSelected) {
                this.step = 'r3DeploySlot';
            } else if (this.step === 'r3DeploySlot' && state.deployExtra >= 1) {
                this.step = 'r3BuyThird';
            } else if (this.step === 'r3BuyThird' && state.r3PadsFilled >= TUTORIAL_3_R3_DWARVES) {
                this.step = 'r3End';
            }
        } else if (state.round === 4) {
            if (this.step === 'r4SelectTower' && state.garrisonSelected) {
                this.step = 'r4Upgrade';
            } else if (this.step === 'r4Upgrade' && state.towerLevel >= TUTORIAL_3_R4_TOWER_LEVEL) {
                this.step = 'r4BuyMortar';
            } else if (this.step === 'r4BuyMortar' && state.mortarCount >= 1) {
                this.step = 'r4PlaceMortar';
            } else if (this.step === 'r4PlaceMortar' && state.mortarPlaced0) {
                this.step = 'r4BuyMortar2';
            } else if (this.step === 'r4BuyMortar2' && state.mortarCount >= 2) {
                this.step = 'r4PlaceMortar2';
            } else if (
                this.step === 'r4PlaceMortar2' &&
                state.mortarPlaced0 &&
                state.mortarPlaced1
            ) {
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
            return (
                this.step === 'r3End' &&
                state.recruitActive &&
                state.deployExtra >= 1 &&
                state.r3PadsFilled >= TUTORIAL_3_R3_DWARVES
            );
        }
        if (state.round === 4) {
            return (
                this.step === 'r4End' &&
                state.towerLevel >= TUTORIAL_3_R4_TOWER_LEVEL &&
                state.mortarPlaced0 &&
                state.mortarPlaced1
            );
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
                this.step = 'r3SelectGarrison';
                break;
            case 'r4Intro':
                this.step = 'r4SelectTower';
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
            case 'r3SelectGarrison':
                this.titleEl.textContent = t('tutorial:tutorial3R3SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3SelectBody');
                highlight = 'garrison';
                break;
            case 'r3Recruit':
                this.titleEl.textContent = t('tutorial:tutorial3R3RecruitTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3RecruitBody');
                highlight = 'recruit-l2';
                break;
            case 'r3BuyTwo': {
                const filled = Math.min(this.lastState?.r3PadsFilled ?? 0, 2);
                this.titleEl.textContent = t('tutorial:tutorial3R3BuyTwoTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3BuyTwoBody', {
                    filled,
                    need: 2,
                });
                highlight = 'shop-dwarf';
                break;
            }
            case 'r3SelectGarrisonAgain':
                this.titleEl.textContent = t('tutorial:tutorial3R3SelectAgainTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3SelectAgainBody');
                highlight = 'garrison';
                break;
            case 'r3DeploySlot':
                this.titleEl.textContent = t('tutorial:tutorial3R3SlotTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3SlotBody');
                highlight = 'deploy-slot';
                break;
            case 'r3BuyThird': {
                const filled = this.lastState?.r3PadsFilled ?? 0;
                this.titleEl.textContent = t('tutorial:tutorial3R3BuyThirdTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3BuyThirdBody', {
                    filled,
                    need: TUTORIAL_3_R3_DWARVES,
                });
                highlight = 'shop-dwarf';
                break;
            }
            case 'r3End':
                this.titleEl.textContent = t('tutorial:tutorial3R3EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R3EndBody');
                highlight = 'end-deploy';
                break;
            case 'r4Intro':
                this.titleEl.textContent = t('tutorial:tutorial3R4IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4IntroBody');
                break;
            case 'r4SelectTower':
                this.titleEl.textContent = t('tutorial:tutorial3R4SelectTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4SelectBody');
                highlight = 'garrison';
                break;
            case 'r4Upgrade': {
                const level = this.lastState?.towerLevel ?? 1;
                this.titleEl.textContent = t('tutorial:tutorial3R4UpgradeTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4UpgradeBody', {
                    level,
                    max: TUTORIAL_3_R4_TOWER_LEVEL,
                });
                highlight = 'tower-upgrade';
                break;
            }
            case 'r4BuyMortar':
                this.titleEl.textContent = t('tutorial:tutorial3R4BuyTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4BuyBody');
                highlight = 'shop-mortar';
                break;
            case 'r4PlaceMortar':
                this.titleEl.textContent = t('tutorial:tutorial3R4PlaceTitle');
                this.bodyEl.textContent = t('tutorial:tutorial3R4PlaceBody');
                break;
            case 'r4BuyMortar2':
                this.titleEl.textContent = t('tutorial:tutorial3R4Buy2Title');
                this.bodyEl.textContent = t('tutorial:tutorial3R4Buy2Body');
                highlight = 'shop-mortar';
                break;
            case 'r4PlaceMortar2':
                this.titleEl.textContent = t('tutorial:tutorial3R4Place2Title');
                this.bodyEl.textContent = t('tutorial:tutorial3R4Place2Body');
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
