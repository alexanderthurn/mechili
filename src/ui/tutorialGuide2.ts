import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';
import { TUTORIAL_2_ARCHER_COUNT, TUTORIAL_2_SPELL_IDS } from '../game/tutorial';

export type Tutorial2Highlight =
    | 'stronghold'
    | 'stronghold-archers'
    | 'upgrade'
    | 'forge-spell'
    | 'tactics'
    | 'end-deploy'
    | null;

export type Tutorial2Step =
    | 'r1Intro'
    | 'r1Archers'
    | 'r1End'
    | 'r2Intro'
    | 'r2BuyOil'
    | 'r2ArmOil'
    | 'r2PlaceOilStart'
    | 'r2PlaceOilEnd'
    | 'r2BuyDragon'
    | 'r2ArmDragon'
    | 'r2PlaceDragonStart'
    | 'r2PlaceDragonEnd'
    | 'r2End'
    | 'r3Intro'
    | 'r3Upgrade'
    | 'r3BuySummon'
    | 'r3ArmSummon'
    | 'r3PlaceSummon'
    | 'r3End'
    | 'done';

export interface Tutorial2BoardState {
    round: number;
    strongholdArcherCount: number;
    keepLevel: number;
    keepMaxLevel: number;
    keepSelected: boolean;
    forgeOwned: readonly string[];
    oilArmed: boolean;
    oilStartDrafted: boolean;
    oilPlaced: boolean;
    dragonArmed: boolean;
    dragonStartDrafted: boolean;
    dragonPlaced: boolean;
    summonArmed: boolean;
    summonPlaced: boolean;
}

const OIL_ID = TUTORIAL_2_SPELL_IDS[0]!;
const DRAGON_ID = TUTORIAL_2_SPELL_IDS[1]!;
const SUMMON_ID = TUTORIAL_2_SPELL_IDS[2]!;

/**
 * Soft-hint overlay for Tutorial 2 (Stronghold lesson, three rounds).
 */
export class TutorialGuide2 extends TutorialPanel {
    private step: Tutorial2Step = 'r1Intro';
    private lastState: Tutorial2BoardState | null = null;

    constructor(
        parent: HTMLElement,
        private readonly onHighlight: (target: Tutorial2Highlight, spellId?: string) => void,
    ) {
        super(parent);
    }

    get currentStep(): Tutorial2Step {
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

    /** Advance the guide when a new build phase begins (round 2 / 3). */
    startRound(round: number): void {
        if (this.destroyed) return;
        if (round === 2) this.step = 'r2Intro';
        else if (round === 3) this.step = 'r3Intro';
        else return;
        this.paint();
    }

    /**
     * Reconcile with the live board / Stronghold panel state.
     * The End Deployment gate is a separate read — see {@link canEndDeploy}.
     */
    syncFromBoard(state: Tutorial2BoardState): void {
        if (this.destroyed || this.step === 'done') return;
        this.lastState = state;

        if (state.round === 1) {
            if (this.step === 'r1Intro' && state.keepSelected) {
                this.step = 'r1Archers';
            } else if (this.step === 'r1Archers') {
                if (state.strongholdArcherCount >= TUTORIAL_2_ARCHER_COUNT) this.step = 'r1End';
            }
        } else if (state.round === 2) {
            if (this.step === 'r2Intro' && state.keepSelected) {
                this.step = 'r2BuyOil';
            } else if (this.step === 'r2BuyOil' && state.forgeOwned.includes(OIL_ID)) {
                this.step = 'r2ArmOil';
            } else if (this.step === 'r2ArmOil' && (state.oilArmed || state.oilStartDrafted || state.oilPlaced)) {
                this.step = 'r2PlaceOilStart';
            } else if (
                (this.step === 'r2PlaceOilStart' || this.step === 'r2PlaceOilEnd') &&
                !state.oilArmed &&
                !state.oilStartDrafted &&
                !state.oilPlaced
            ) {
                this.step = 'r2ArmOil';
            } else if (this.step === 'r2PlaceOilStart' && (state.oilStartDrafted || state.oilPlaced)) {
                this.step = 'r2PlaceOilEnd';
            } else if (this.step === 'r2PlaceOilEnd' && state.oilPlaced) {
                this.step = 'r2BuyDragon';
            } else if (this.step === 'r2BuyDragon' && state.forgeOwned.includes(DRAGON_ID)) {
                this.step = 'r2ArmDragon';
            } else if (
                this.step === 'r2ArmDragon' &&
                (state.dragonArmed || state.dragonStartDrafted || state.dragonPlaced)
            ) {
                this.step = 'r2PlaceDragonStart';
            } else if (
                (this.step === 'r2PlaceDragonStart' || this.step === 'r2PlaceDragonEnd') &&
                !state.dragonArmed &&
                !state.dragonStartDrafted &&
                !state.dragonPlaced
            ) {
                this.step = 'r2ArmDragon';
            } else if (
                this.step === 'r2PlaceDragonStart' &&
                (state.dragonStartDrafted || state.dragonPlaced)
            ) {
                this.step = 'r2PlaceDragonEnd';
            } else if (this.step === 'r2PlaceDragonEnd' && state.dragonPlaced) {
                this.step = 'r2End';
            }
        } else if (state.round === 3) {
            if (this.step === 'r3Intro' && state.keepSelected) {
                this.step = 'r3Upgrade';
            } else if (this.step === 'r3Upgrade' && state.keepLevel >= state.keepMaxLevel) {
                this.step = 'r3BuySummon';
            } else if (this.step === 'r3BuySummon' && state.forgeOwned.includes(SUMMON_ID)) {
                this.step = 'r3ArmSummon';
            } else if (
                this.step === 'r3ArmSummon' &&
                (state.summonArmed || state.summonPlaced)
            ) {
                this.step = 'r3PlaceSummon';
            } else if (
                this.step === 'r3PlaceSummon' &&
                !state.summonArmed &&
                !state.summonPlaced
            ) {
                this.step = 'r3ArmSummon';
            } else if (this.step === 'r3PlaceSummon' && state.summonPlaced) {
                this.step = 'r3End';
            }
        }

        this.paint();
    }

    canEndDeploy(state: Tutorial2BoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        if (state.round === 1) {
            return this.step === 'r1End' && state.strongholdArcherCount >= TUTORIAL_2_ARCHER_COUNT;
        }
        if (state.round === 2) {
            return this.step === 'r2End' && state.oilPlaced && state.dragonPlaced;
        }
        if (state.round === 3) {
            return (
                this.step === 'r3End' &&
                state.keepLevel >= state.keepMaxLevel &&
                state.summonPlaced
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

    private paint(): void {
        // This lesson has no read-only steps: every step advances off the
        // board or the Stronghold panel, so Next never shows.
        this.setNextVisible(false);

        let highlight: Tutorial2Highlight = null;
        let spellId: string | undefined;

        switch (this.step) {
            case 'r1Intro':
                this.titleEl.textContent = t('tutorial:tutorial2R1IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R1IntroBody');
                highlight = null;
                break;
            case 'r1Archers':
                this.titleEl.textContent = t('tutorial:tutorial2R1ArchersTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R1ArchersBody', {
                    slots: TUTORIAL_2_ARCHER_COUNT,
                });
                highlight = 'stronghold-archers';
                break;
            case 'r1End':
                this.titleEl.textContent = t('tutorial:tutorial2R1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R1EndBody');
                highlight = 'end-deploy';
                break;
            case 'r2Intro':
                this.titleEl.textContent = t('tutorial:tutorial2R2IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2IntroBody');
                highlight = null;
                break;
            case 'r2BuyOil':
                this.titleEl.textContent = t('tutorial:tutorial2R2BuyOilTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2BuyOilBody');
                highlight = 'forge-spell';
                spellId = OIL_ID;
                break;
            case 'r2ArmOil':
                this.titleEl.textContent = t('tutorial:tutorial2R2ArmOilTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2ArmOilBody');
                highlight = 'tactics';
                spellId = OIL_ID;
                break;
            case 'r2PlaceOilStart':
                this.titleEl.textContent = t('tutorial:tutorial2R2PlaceOilStartTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2PlaceOilStartBody');
                highlight = null;
                break;
            case 'r2PlaceOilEnd':
                this.titleEl.textContent = t('tutorial:tutorial2R2PlaceOilEndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2PlaceOilEndBody');
                highlight = null;
                break;
            case 'r2BuyDragon':
                this.titleEl.textContent = t('tutorial:tutorial2R2BuyDragonTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2BuyDragonBody');
                highlight = 'forge-spell';
                spellId = DRAGON_ID;
                break;
            case 'r2ArmDragon':
                this.titleEl.textContent = t('tutorial:tutorial2R2ArmDragonTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2ArmDragonBody');
                highlight = 'tactics';
                spellId = DRAGON_ID;
                break;
            case 'r2PlaceDragonStart':
                this.titleEl.textContent = t('tutorial:tutorial2R2PlaceDragonStartTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2PlaceDragonStartBody');
                highlight = null;
                break;
            case 'r2PlaceDragonEnd':
                this.titleEl.textContent = t('tutorial:tutorial2R2PlaceDragonEndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2PlaceDragonEndBody');
                highlight = null;
                break;
            case 'r2End':
                this.titleEl.textContent = t('tutorial:tutorial2R2EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R2EndBody');
                highlight = 'end-deploy';
                break;
            case 'r3Intro':
                this.titleEl.textContent = t('tutorial:tutorial2R3IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3IntroBody');
                highlight = null;
                break;
            case 'r3Upgrade': {
                const level = this.lastState?.keepLevel ?? 1;
                const max = this.lastState?.keepMaxLevel ?? 5;
                this.titleEl.textContent = t('tutorial:tutorial2R3UpgradeTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3UpgradeBody', { level, max });
                highlight = 'upgrade';
                break;
            }
            case 'r3BuySummon':
                this.titleEl.textContent = t('tutorial:tutorial2R3BuySummonTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3BuySummonBody');
                highlight = 'forge-spell';
                spellId = SUMMON_ID;
                break;
            case 'r3ArmSummon':
                this.titleEl.textContent = t('tutorial:tutorial2R3ArmSummonTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3ArmSummonBody');
                highlight = 'tactics';
                spellId = SUMMON_ID;
                break;
            case 'r3PlaceSummon':
                this.titleEl.textContent = t('tutorial:tutorial2R3PlaceSummonTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3PlaceSummonBody');
                highlight = null;
                break;
            case 'r3End':
                this.titleEl.textContent = t('tutorial:tutorial2R3EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial2R3EndBody');
                highlight = 'end-deploy';
                break;
            case 'done':
                this.setPanelVisible(false);
                this.onHighlight(null);
                return;
        }

        this.onHighlight(highlight, spellId);
        this.setPanelVisible(true);
    }
}
