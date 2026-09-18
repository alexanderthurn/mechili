import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';

export type TutorialHighlight =
    | 'hp'
    | 'shop-dwarf'
    | 'shop-archer'
    | 'shop-hammerer'
    | 'end-deploy'
    | 'rotate'
    | null;

export type Tutorial1Step =
    | 'camLeft'
    | 'camRight'
    | 'camForward'
    | 'camBack'
    | 'camOrbit'
    | 'camZoom'
    | 'camZoomOut'
    | 'buy1'
    | 'place1'
    | 'buy2'
    | 'place2'
    | 'goal'
    | 'end'
    | 'r2Intro'
    | 'r2Buy0'
    | 'r2Place0'
    | 'r2Buy1'
    | 'r2Place1'
    | 'r2End'
    | 'r3Intro'
    | 'r3BuyDwarf'
    | 'r3PlaceDwarf'
    | 'r3BuyArcher'
    | 'r3PlaceArcher'
    | 'r3Explain'
    | 'r3End'
    | 'r4Intro'
    | 'r4BuyArcher'
    | 'r4PlaceArcher'
    | 'r4SelectOwn'
    | 'r4SelectEnemy'
    | 'r4End'
    | 'done';

export type TutorialSlotMask = 'none' | 'first' | 'second' | 'both';

export interface TutorialBoardState {
    round: number;
    dwarfCount: number;
    archerCount: number;
    hammererCount: number;
    slot0Filled: boolean;
    slot1Filled: boolean;
    ownArcherSelected: boolean;
    enemyArcherSelected: boolean;
}

export interface TutorialCameraSnap {
    x: number;
    z: number;
    zoom: number;
    heading: number;
    pitch: number;
    /** Heading axes frozen at step start so pan checks stay stable while orbiting. */
    right: { x: number; z: number };
    forward: { x: number; z: number };
}

const CAMERA_STEPS: readonly Tutorial1Step[] = [
    'camLeft',
    'camRight',
    'camForward',
    'camBack',
    'camOrbit',
    'camZoom',
    'camZoomOut',
];

function isCameraStep(step: Tutorial1Step): boolean {
    return (CAMERA_STEPS as readonly string[]).includes(step);
}

/** World units of pan / rad of orbit / zoom delta to clear a camera lesson. */
const PAN_NEED = 18;
const ORBIT_NEED = 0.32;
const ZOOM_NEED = 14;

const READ_STEPS: readonly Tutorial1Step[] = [
    'goal',
    'r2Intro',
    'r3Intro',
    'r3Explain',
    'r4Intro',
];

/**
 * Soft-hint overlay for Tutorial 1.
 * R1 camera + pads · R2 income + Hammerers · R3 closest-target · R4 height.
 */
export class TutorialGuide extends TutorialPanel {
    private readonly controlsEl: HTMLDivElement;
    private step: Tutorial1Step = 'camLeft';
    private camBase: TutorialCameraSnap | null = null;

    constructor(
        parent: HTMLElement,
        private readonly onHighlight: (target: TutorialHighlight) => void,
        private readonly onSlotMask: (mask: TutorialSlotMask) => void,
    ) {
        super(parent);
        this.controlsEl = document.createElement('div');
        this.controlsEl.className = 'tut-controls';
        this.root.insertBefore(this.controlsEl, this.nextBtn);
        this.paint();
    }

    get currentStep(): Tutorial1Step {
        return this.step;
    }

    protected get isDone(): boolean {
        return this.step === 'done';
    }

    get needsCameraBaseline(): boolean {
        return !this.destroyed && isCameraStep(this.step) && this.camBase === null;
    }

    get isCameraLesson(): boolean {
        return isCameraStep(this.step);
    }

    start(): void {
        if (this.destroyed) return;
        this.step = 'camLeft';
        this.camBase = null;
        this.paint();
    }

    startRound(round: number): void {
        if (this.destroyed) return;
        if (round === 2) this.step = 'r2Intro';
        else if (round === 3) this.step = 'r3Intro';
        else if (round === 4) this.step = 'r4Intro';
        else return;
        this.camBase = null;
        this.paint();
    }

    beginCameraTracking(snap: TutorialCameraSnap): void {
        if (!this.needsCameraBaseline) return;
        this.camBase = snap;
    }

    tickCamera(live: TutorialCameraSnap): void {
        if (this.destroyed || !this.camBase || !isCameraStep(this.step)) return;
        const b = this.camBase;
        const dx = live.x - b.x;
        const dz = live.z - b.z;
        const alongRight = dx * b.right.x + dz * b.right.z;
        const alongForward = dx * b.forward.x + dz * b.forward.z;
        const panLeft = -alongRight;
        const panRight = alongRight;
        const panForward = alongForward;
        const panBack = -alongForward;
        const orbit = Math.abs(live.heading - b.heading);
        const zoomIn = b.zoom - live.zoom;
        const zoomOut = live.zoom - b.zoom;

        let done = false;
        switch (this.step) {
            case 'camLeft':
                done = panLeft >= PAN_NEED;
                break;
            case 'camRight':
                done = panRight >= PAN_NEED;
                break;
            case 'camForward':
                done = panForward >= PAN_NEED;
                break;
            case 'camBack':
                done = panBack >= PAN_NEED;
                break;
            case 'camOrbit':
                done = orbit >= ORBIT_NEED;
                break;
            case 'camZoom':
                done = zoomIn >= ZOOM_NEED;
                break;
            case 'camZoomOut':
                done = zoomOut >= ZOOM_NEED;
                break;
        }
        if (!done) return;

        const idx = CAMERA_STEPS.indexOf(this.step);
        this.step = idx >= 0 && idx < CAMERA_STEPS.length - 1 ? CAMERA_STEPS[idx + 1]! : 'buy1';
        this.camBase = null;
        this.paint();
    }

    syncFromBoard(state: TutorialBoardState): void {
        if (this.destroyed || this.step === 'done') return;
        if (
            isCameraStep(this.step) ||
            (READ_STEPS as readonly string[]).includes(this.step)
        ) {
            return;
        }

        if (state.round === 1) {
            if (this.step === 'buy1' && state.dwarfCount >= 1) this.step = 'place1';
            else if (this.step === 'place1' && state.slot0Filled) this.step = 'buy2';
            else if (this.step === 'buy2' && state.dwarfCount >= 2) this.step = 'place2';
            else if (this.step === 'place2' && state.slot0Filled && state.slot1Filled) {
                this.step = 'goal';
            }
        } else if (state.round === 2) {
            if (this.step === 'r2Buy0' && state.hammererCount >= 1) this.step = 'r2Place0';
            else if (this.step === 'r2Place0' && state.slot0Filled) this.step = 'r2Buy1';
            else if (this.step === 'r2Buy1' && state.hammererCount >= 2) this.step = 'r2Place1';
            else if (this.step === 'r2Place1' && state.slot0Filled && state.slot1Filled) {
                this.step = 'r2End';
            }
        } else if (state.round === 3) {
            if (this.step === 'r3BuyDwarf' && state.dwarfCount >= 1) this.step = 'r3PlaceDwarf';
            else if (this.step === 'r3PlaceDwarf' && state.slot0Filled) this.step = 'r3BuyArcher';
            else if (this.step === 'r3BuyArcher' && state.archerCount >= 1) {
                this.step = 'r3PlaceArcher';
            } else if (this.step === 'r3PlaceArcher' && state.slot0Filled && state.slot1Filled) {
                this.step = 'r3Explain';
            }
        } else if (state.round === 4) {
            if (this.step === 'r4BuyArcher' && state.archerCount >= 1) this.step = 'r4PlaceArcher';
            else if (this.step === 'r4PlaceArcher' && state.slot0Filled) this.step = 'r4SelectOwn';
            else if (this.step === 'r4SelectOwn' && state.ownArcherSelected) {
                this.step = 'r4SelectEnemy';
            } else if (this.step === 'r4SelectEnemy' && state.enemyArcherSelected) {
                this.step = 'r4End';
            }
        }
        this.paint();
    }

    canEndDeploy(state: TutorialBoardState): boolean {
        if (this.destroyed || this.step === 'done') return true;
        if (state.round === 1) {
            return this.step === 'end' && state.slot0Filled && state.slot1Filled;
        }
        if (state.round === 2) {
            return this.step === 'r2End' && state.slot0Filled && state.slot1Filled;
        }
        if (state.round === 3) {
            return this.step === 'r3End' && state.slot0Filled && state.slot1Filled;
        }
        if (state.round === 4) {
            return this.step === 'r4End' && state.slot0Filled;
        }
        return false;
    }

    onPlayerEndedDeployment(): void {
        if (this.destroyed) return;
        this.step = 'done';
        this.onHighlight(null);
        this.onSlotMask('none');
        this.setPanelVisible(false);
    }

    protected override onDestroy(): void {
        this.onHighlight(null);
        this.onSlotMask('none');
    }

    protected override onNext(): void {
        switch (this.step) {
            case 'goal':
                this.step = 'end';
                break;
            case 'r2Intro':
                this.step = 'r2Buy0';
                break;
            case 'r3Intro':
                this.step = 'r3BuyDwarf';
                break;
            case 'r3Explain':
                this.step = 'r3End';
                break;
            case 'r4Intro':
                this.step = 'r4BuyArcher';
                break;
            default:
                return;
        }
        this.paint();
    }

    private paint(): void {
        this.setNextVisible((READ_STEPS as readonly string[]).includes(this.step));

        this.controlsEl.replaceChildren();
        this.controlsEl.style.display = 'none';

        switch (this.step) {
            case 'camLeft':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamLeftTitle'),
                    t('tutorial:tutorial1CamLeftBody'),
                    t('tutorial:tutorial1CamLeftKeyboard'),
                    t('tutorial:tutorial1CamLeftMouse'),
                    t('tutorial:tutorial1CamLeftTouch'),
                );
                break;
            case 'camRight':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamRightTitle'),
                    t('tutorial:tutorial1CamRightBody'),
                    t('tutorial:tutorial1CamRightKeyboard'),
                    t('tutorial:tutorial1CamRightMouse'),
                    t('tutorial:tutorial1CamRightTouch'),
                );
                break;
            case 'camForward':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamForwardTitle'),
                    t('tutorial:tutorial1CamForwardBody'),
                    t('tutorial:tutorial1CamForwardKeyboard'),
                    t('tutorial:tutorial1CamForwardMouse'),
                    t('tutorial:tutorial1CamForwardTouch'),
                );
                break;
            case 'camBack':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamBackTitle'),
                    t('tutorial:tutorial1CamBackBody'),
                    t('tutorial:tutorial1CamBackKeyboard'),
                    t('tutorial:tutorial1CamBackMouse'),
                    t('tutorial:tutorial1CamBackTouch'),
                );
                break;
            case 'camOrbit':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamOrbitTitle'),
                    t('tutorial:tutorial1CamOrbitBody'),
                    t('tutorial:tutorial1CamOrbitKeyboard'),
                    t('tutorial:tutorial1CamOrbitMouse'),
                    t('tutorial:tutorial1CamOrbitTouch'),
                );
                break;
            case 'camZoom':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamZoomTitle'),
                    t('tutorial:tutorial1CamZoomBody'),
                    t('tutorial:tutorial1CamZoomKeyboard'),
                    t('tutorial:tutorial1CamZoomMouse'),
                    t('tutorial:tutorial1CamZoomTouch'),
                );
                break;
            case 'camZoomOut':
                this.paintCameraStep(
                    t('tutorial:tutorial1CamZoomOutTitle'),
                    t('tutorial:tutorial1CamZoomOutBody'),
                    t('tutorial:tutorial1CamZoomOutKeyboard'),
                    t('tutorial:tutorial1CamZoomOutMouse'),
                    t('tutorial:tutorial1CamZoomOutTouch'),
                );
                break;
            case 'buy1':
                this.titleEl.textContent = t('tutorial:tutorial1Buy1Title');
                this.bodyEl.textContent = t('tutorial:tutorial1Buy1Body');
                this.setHighlight('shop-dwarf');
                this.onSlotMask('none');
                break;
            case 'place1':
                this.titleEl.textContent = t('tutorial:tutorial1Place1Title');
                this.bodyEl.textContent = t('tutorial:tutorial1Place1Body');
                this.setHighlight(null);
                this.onSlotMask('first');
                break;
            case 'buy2':
                this.titleEl.textContent = t('tutorial:tutorial1Buy2Title');
                this.bodyEl.textContent = t('tutorial:tutorial1Buy2Body');
                this.setHighlight('shop-dwarf');
                this.onSlotMask('first');
                break;
            case 'place2':
                this.titleEl.textContent = t('tutorial:tutorial1Place2Title');
                this.bodyEl.textContent = t('tutorial:tutorial1Place2Body');
                this.setHighlight('rotate');
                this.onSlotMask('both');
                break;
            case 'goal':
                this.titleEl.textContent = t('tutorial:tutorial1GoalTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1GoalBody');
                this.setHighlight('hp');
                this.onSlotMask('both');
                break;
            case 'end':
                this.titleEl.textContent = t('tutorial:tutorial1EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1EndBody');
                this.setHighlight('end-deploy');
                this.onSlotMask('both');
                break;
            case 'r2Intro':
                this.titleEl.textContent = t('tutorial:tutorial1R2IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R2IntroBody');
                this.setHighlight(null);
                this.onSlotMask('none');
                break;
            case 'r2Buy0':
            case 'r2Buy1':
                this.titleEl.textContent = t('tutorial:tutorial1R2BuyHammererTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R2BuyHammererBody');
                this.setHighlight('shop-hammerer');
                this.onSlotMask(this.step === 'r2Buy1' ? 'first' : 'none');
                break;
            case 'r2Place0':
                this.titleEl.textContent = t('tutorial:tutorial1R2PlaceHammererTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R2PlaceHammererBody');
                this.setHighlight(null);
                this.onSlotMask('first');
                break;
            case 'r2Place1':
                this.titleEl.textContent = t('tutorial:tutorial1R2PlaceHammerer2Title');
                this.bodyEl.textContent = t('tutorial:tutorial1R2PlaceHammerer2Body');
                this.setHighlight(null);
                this.onSlotMask('both');
                break;
            case 'r2End':
                this.titleEl.textContent = t('tutorial:tutorial1R2EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R2EndBody');
                this.setHighlight('end-deploy');
                this.onSlotMask('both');
                break;
            case 'r3Intro':
                this.titleEl.textContent = t('tutorial:tutorial1R3IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3IntroBody');
                this.setHighlight(null);
                this.onSlotMask('none');
                break;
            case 'r3BuyDwarf':
                this.titleEl.textContent = t('tutorial:tutorial1R3BuyDwarfTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3BuyDwarfBody');
                this.setHighlight('shop-dwarf');
                this.onSlotMask('none');
                break;
            case 'r3PlaceDwarf':
                this.titleEl.textContent = t('tutorial:tutorial1R3PlaceDwarfTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3PlaceDwarfBody');
                this.setHighlight(null);
                this.onSlotMask('first');
                break;
            case 'r3BuyArcher':
                this.titleEl.textContent = t('tutorial:tutorial1R3BuyArcherTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3BuyArcherBody');
                this.setHighlight('shop-archer');
                this.onSlotMask('first');
                break;
            case 'r3PlaceArcher':
                this.titleEl.textContent = t('tutorial:tutorial1R3PlaceArcherTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3PlaceArcherBody');
                this.setHighlight(null);
                this.onSlotMask('both');
                break;
            case 'r3Explain':
                this.titleEl.textContent = t('tutorial:tutorial1R3ExplainTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3ExplainBody');
                this.setHighlight(null);
                this.onSlotMask('both');
                break;
            case 'r3End':
                this.titleEl.textContent = t('tutorial:tutorial1R3EndTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R3EndBody');
                this.setHighlight('end-deploy');
                this.onSlotMask('both');
                break;
            case 'r4Intro':
                this.titleEl.textContent = t('tutorial:tutorial1R4IntroTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R4IntroBody');
                this.setHighlight(null);
                this.onSlotMask('none');
                break;
            case 'r4BuyArcher':
                this.titleEl.textContent = t('tutorial:tutorial1R4BuyArcherTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R4BuyArcherBody');
                this.setHighlight('shop-archer');
                this.onSlotMask('none');
                break;
            case 'r4PlaceArcher':
                this.titleEl.textContent = t('tutorial:tutorial1R4PlaceArcherTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R4PlaceArcherBody');
                this.setHighlight(null);
                this.onSlotMask('first');
                break;
            case 'r4SelectOwn':
                this.titleEl.textContent = t('tutorial:tutorial1R4SelectOwnTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R4SelectOwnBody');
                this.setHighlight(null);
                this.onSlotMask('none');
                break;
            case 'r4SelectEnemy':
                this.titleEl.textContent = t('tutorial:tutorial1R4SelectEnemyTitle');
                this.bodyEl.textContent = t('tutorial:tutorial1R4SelectEnemyBody');
                this.setHighlight(null);
                this.onSlotMask('none');
                break;
            case 'r4End':
                this.titleEl.textContent = '';
                this.titleEl.style.display = 'none';
                this.bodyEl.textContent = t('tutorial:tutorial1R4EndBody');
                this.setHighlight('end-deploy');
                this.onSlotMask('none');
                break;
            case 'done':
                this.setPanelVisible(false);
                this.setHighlight(null);
                this.onSlotMask('none');
                return;
        }
        if (this.step !== 'r4End') this.titleEl.style.display = '';
        this.setPanelVisible(true);
    }

    private paintCameraStep(
        title: string,
        body: string,
        keyboard: string,
        mouse: string,
        touch: string,
    ): void {
        this.titleEl.textContent = title;
        this.bodyEl.textContent = body;
        this.setHighlight(null);
        this.onSlotMask('none');
        this.controlsEl.style.display = '';
        const rows: HTMLDivElement[] = [];
        if (keyboard) rows.push(this.controlRow(t('tutorial:tutorialCtrlKeyboard'), keyboard));
        rows.push(
            this.controlRow(t('tutorial:tutorialCtrlMouse'), mouse),
            this.controlRow(t('tutorial:tutorialCtrlTouch'), touch),
        );
        this.controlsEl.append(...rows);
    }

    private controlRow(kind: string, detail: string): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'tut-ctrl';
        const kindEl = document.createElement('span');
        kindEl.className = 'tut-ctrl-kind';
        kindEl.textContent = kind;
        const detailEl = document.createElement('span');
        detailEl.className = 'tut-ctrl-detail';
        detailEl.textContent = detail;
        row.append(kindEl, detailEl);
        return row;
    }

    private setHighlight(target: TutorialHighlight): void {
        this.onHighlight(target);
    }
}
