/**
 * Watch-mode-only controls: jump to a round, skip to the end, and a much
 * wider speed range than the live-match speed button (which is hidden for
 * the whole life of a watching Game instance — see Hud.setSpeedButtonVisible).
 * A small, self-contained DOM overlay, not folded into the large Hud class —
 * it survives across the Game reconstructions a round-jump causes (main.ts's
 * rebuildReplayAt), so it can't be owned by the Game instance itself.
 */
export interface ReplayControlsCallbacks {
    onJump(round: number): void;
    onSkipToEnd(): void;
    onSpeedChange(index: number): void;
}

export class ReplayControls {
    private readonly root: HTMLDivElement;
    private readonly roundInput: HTMLInputElement;
    private readonly speedSelect: HTMLSelectElement;

    constructor(
        wrapper: HTMLElement,
        maxRound: number,
        speedSteps: readonly number[],
        initialSpeedIndex: number,
        cb: ReplayControlsCallbacks,
    ) {
        this.root = document.createElement('div');
        this.root.className = 'mechili-replay-controls';
        this.root.innerHTML =
            `<div class="rc-row">` +
            `<label>Round <input type="number" class="rc-round" min="1" max="${maxRound}" value="1" /></label>` +
            `<button type="button" class="rc-jump">Jump</button>` +
            `<button type="button" class="rc-end">Skip to End</button>` +
            `</div>` +
            `<div class="rc-row">` +
            `<label>Speed <select class="rc-speed">` +
            speedSteps.map((s, i) => `<option value="${i}">${s}×</option>`).join('') +
            `</select></label>` +
            `</div>`;

        this.roundInput = this.root.querySelector<HTMLInputElement>('.rc-round')!;
        this.speedSelect = this.root.querySelector<HTMLSelectElement>('.rc-speed')!;
        this.speedSelect.value = String(initialSpeedIndex);

        this.root.querySelector('.rc-jump')!.addEventListener('click', () => {
            const round = parseInt(this.roundInput.value, 10);
            if (Number.isFinite(round) && round >= 1) cb.onJump(round);
        });
        this.root.querySelector('.rc-end')!.addEventListener('click', () => cb.onSkipToEnd());
        this.speedSelect.addEventListener('change', () => cb.onSpeedChange(Number(this.speedSelect.value)));

        wrapper.appendChild(this.root);
    }

    /** re-applied after rebuildReplayAt reconstructs the Game (a fresh
     *  instance otherwise resets to 1x) — the panel is the source of truth
     *  for "what speed did the viewer pick", since it survives reconstruction */
    getSpeedIndex(): number {
        return Number(this.speedSelect.value);
    }

    remove(): void {
        this.root.remove();
    }
}
