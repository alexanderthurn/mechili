import { t } from '../i18n';
import { TutorialPanel } from './tutorialPanel';

export type TutorialHighlight = 'hp' | 'shop-dwarf' | 'end-deploy' | 'rotate' | null;

export type Tutorial1Step =
    | 'camLeft'
    | 'camRight'
    | 'camForward'
    | 'camBack'
    | 'camOrbit'
    | 'camZoom'
    | 'buy1'
    | 'place1'
    | 'buy2'
    | 'place2'
    | 'goal'
    | 'end'
    | 'done';

export type TutorialSlotMask = 'none' | 'first' | 'second' | 'both';

export interface TutorialBoardState {
    dwarfCount: number;
    slot0Filled: boolean;
    slot1Filled: boolean;
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
];

function isCameraStep(step: Tutorial1Step): boolean {
    return (CAMERA_STEPS as readonly string[]).includes(step);
}

/** World units of pan / rad of orbit / zoom delta to clear a camera lesson. */
const PAN_NEED = 18;
const ORBIT_NEED = 0.32;
const ZOOM_NEED = 14;

/**
 * Soft-hint overlay for Tutorial 1. Teaches camera, forced pads, then
 * life bars / goal just before end deployment.
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

    /** True while a camera lesson is waiting for a fresh pose baseline. */
    get needsCameraBaseline(): boolean {
        return !this.destroyed && isCameraStep(this.step) && this.camBase === null;
    }

    /** True during camera lessons (blocks shop buys with a soft nudge). */
    get isCameraLesson(): boolean {
        return isCameraStep(this.step);
    }

    /** Call once build chrome is visible (after match intro). */
    start(): void {
        if (this.destroyed) return;
        this.step = 'camLeft';
        this.camBase = null;
        this.paint();
    }

    beginCameraTracking(snap: TutorialCameraSnap): void {
        if (!this.needsCameraBaseline) return;
        this.camBase = snap;
    }

    /** Poll after the rig updates — advances when the player moves enough. */
    tickCamera(live: TutorialCameraSnap): void {
        if (this.destroyed || !this.camBase || !isCameraStep(this.step)) return;
        const b = this.camBase;
        const dx = live.x - b.x;
        const dz = live.z - b.z;
        const alongRight = dx * b.right.x + dz * b.right.z;
        const alongForward = dx * b.forward.x + dz * b.forward.z;
        // Pan left moves the look-target to the right in camera space.
        const panLeft = -alongRight;
        const panRight = alongRight;
        const panForward = alongForward;
        const panBack = -alongForward;
        const orbit = Math.abs(live.heading - b.heading);
        const zoomIn = b.zoom - live.zoom;

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
        }
        if (!done) return;

        const idx = CAMERA_STEPS.indexOf(this.step);
        this.step = idx >= 0 && idx < CAMERA_STEPS.length - 1 ? CAMERA_STEPS[idx + 1]! : 'buy1';
        this.camBase = null;
        this.paint();
    }

    /** Reconcile the step with the live board after a buy / move / rotate. */
    syncFromBoard(state: TutorialBoardState): void {
        if (this.destroyed || this.step === 'done') return;
        if (isCameraStep(this.step) || this.step === 'goal') return;

        if (this.step === 'buy1' && state.dwarfCount >= 1) {
            this.step = 'place1';
            this.paint();
        }
        if (this.step === 'place1' && state.slot0Filled) {
            this.step = 'buy2';
            this.paint();
        }
        if (this.step === 'buy2' && state.dwarfCount >= 2) {
            this.step = 'place2';
            this.paint();
        }
        if (this.step === 'place2' && state.slot0Filled && state.slot1Filled) {
            this.step = 'goal';
            this.paint();
        }
    }

    onPlayerEndedDeployment(): void {
        if (this.destroyed) return;
        // No post-fight dialog — battle runs on its own after End Deployment.
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
        if (this.step === 'goal') {
            this.step = 'end';
            this.paint();
        }
    }

    private paint(): void {
        this.setNextVisible(this.step === 'goal');

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
            case 'done':
                this.setPanelVisible(false);
                this.setHighlight(null);
                this.onSlotMask('none');
                return;
        }
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
