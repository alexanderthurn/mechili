/**
 * The Terrain tool's panel in the scenario editor window: the brushes (by
 * mouse button), radius and strength, the steep-slope overlay, "Generated
 * terrain", and a terrain as a file of its own (save it here, load it into
 * another scenario). It only drives {@link TerrainBrushes}; what the terrain
 * means for the draft is the editor session's business.
 */
import { t } from '../i18n';
import { decodeLandscape, encodeLandscape, isLandscapeFile } from '../game/landscape';
import { TerrainBrushes, type TerrainBrush } from '../game/terrainBrushes';

export interface TerrainPanelActions {
    /** "Generated terrain": throw the sculpted terrain away */
    generated(): void;
    /** the terrain as the draft means it (the right way round, whichever side the editor shows) */
    capture(): ReturnType<TerrainBrushes['capture']>;
    /** a loaded terrain file, as the draft means it: shown (turned as the view is) as one undoable edit; an error text when it can't be */
    load(data: ReturnType<typeof decodeLandscape>): string | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TOOLS: { group: string; groupLabel: string; tools: { brush: TerrainBrush; key: string; label: string; fallback: string }[] }[] = [
    {
        group: 'shape',
        groupLabel: 'Shape',
        tools: [
            { brush: 'raise', key: '1', label: 'terrainRaise', fallback: 'Raise' },
            { brush: 'lower', key: '2', label: 'terrainLower', fallback: 'Lower' },
            { brush: 'flatten', key: '3', label: 'terrainFlatten', fallback: 'Flatten' },
            { brush: 'lean', key: '4', label: 'terrainLean', fallback: 'Lean' },
        ],
    },
    {
        group: 'paint',
        groupLabel: 'Paint',
        tools: [
            { brush: 'mat-grass', key: 'G', label: 'terrainGrass', fallback: 'Grass' },
            { brush: 'mat-rock', key: 'K', label: 'terrainRock', fallback: 'Rock' },
            { brush: 'mat-snow', key: 'N', label: 'terrainSnow', fallback: 'Snow' },
            { brush: 'mat-beach', key: 'H', label: 'terrainBeach', fallback: 'Beach' },
            { brush: 'mat-scree', key: 'C', label: 'terrainScree', fallback: 'Scree' },
        ],
    },
    {
        group: 'plants',
        groupLabel: 'Plants',
        tools: [
            { brush: 'obj-oak', key: 'O', label: 'terrainOak', fallback: 'Oak' },
            { brush: 'obj-pine', key: 'P', label: 'terrainPine', fallback: 'Pine' },
            { brush: 'obj-bushRound', key: 'B', label: 'terrainBush', fallback: 'Bush' },
            { brush: 'obj-bushTall', key: 'T', label: 'terrainTallBush', fallback: 'Tall bush' },
            { brush: 'obj-erase', key: 'X', label: 'terrainErase', fallback: 'Erase' },
        ],
    },
];

export class TerrainPanel {
    readonly el: HTMLDivElement;
    private readonly radiusInput: HTMLInputElement;
    private readonly strengthInput: HTMLInputElement;
    private readonly statusEl: HTMLDivElement;

    constructor(
        private readonly brushes: TerrainBrushes,
        private readonly actions: TerrainPanelActions,
        /** the file name a saved terrain gets (the scenario's name) */
        private readonly fileName: () => string,
    ) {
        const el = document.createElement('div');
        el.className = 'te-panel';
        const R = TerrainBrushes.RADIUS;
        const S = TerrainBrushes.STRENGTH;
        el.innerHTML =
            TOOLS.map(
                (g) =>
                    `<div class="se-label">${t(`editor:terrain${g.groupLabel}`, { defaultValue: g.groupLabel })}</div>` +
                    `<div class="se-row">` +
                    g.tools
                        .map(
                            (tool) =>
                                `<button type="button" class="te-tool" data-brush="${tool.brush}">` +
                                `${t(`editor:${tool.label}`, { defaultValue: tool.fallback })} <kbd>${tool.key}</kbd><span class="slot-tags"></span></button>`,
                        )
                        .join('') +
                    `</div>`,
            ).join('') +
            `<div class="te-sliders">` +
            `<span>${t('editor:terrainRadius', { defaultValue: 'Radius' })} <kbd>5</kbd>/<kbd>6</kbd></span>` +
            `<input type="range" class="te-r" min="${R.min}" max="${R.max}" step="1">` +
            `<span>${t('editor:terrainStrength', { defaultValue: 'Strength' })} <kbd>7</kbd>/<kbd>8</kbd></span>` +
            `<input type="range" class="te-s" min="${S.min}" max="${S.max}" step="0.1">` +
            `</div>` +
            `<div class="se-row">` +
            `<button type="button" class="te-steep" title="${esc(t('editor:terrainSteepTip', { defaultValue: 'Amber: slows units · red: too steep to walk up' }))}">${t('editor:terrainSteep', { defaultValue: 'Steep slopes' })}</button>` +
            `<button type="button" class="te-generated" title="${esc(t('editor:terrainGeneratedTip', { defaultValue: 'Throw the sculpted terrain away and start from the board’s own' }))}">${t('editor:terrainGenerated', { defaultValue: 'Generated terrain' })}</button>` +
            `</div>` +
            `<div class="se-row">` +
            `<button type="button" class="te-save" title="${esc(t('editor:terrainSaveTip', { defaultValue: 'The terrain as a file of its own — load it into another scenario' }))}">${t('editor:terrainSaveFile', { defaultValue: 'Save terrain file' })}</button>` +
            `<button type="button" class="te-load">${t('editor:terrainLoadFile', { defaultValue: 'Load terrain file' })}</button>` +
            `</div>` +
            `<div class="te-status"></div>` +
            `<div class="se-hint">${t('editor:terrainHint', {
                defaultValue: 'Left drag: L tool · Shift+right drag: R · Shift+middle drag: M · right- or middle-click a tool to put it on that button',
            })}</div>`;
        this.el = el;
        this.radiusInput = el.querySelector<HTMLInputElement>('.te-r')!;
        this.strengthInput = el.querySelector<HTMLInputElement>('.te-s')!;
        this.statusEl = el.querySelector<HTMLDivElement>('.te-status')!;

        for (const button of el.querySelectorAll<HTMLButtonElement>('.te-tool')) {
            const brush = button.dataset.brush as TerrainBrush;
            button.addEventListener('click', () => brushes.setBrush(brush));
            // right-click a tool: the right button; middle-click: the middle button
            button.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                brushes.setSlot('right', brush);
            });
            button.addEventListener('mousedown', (ev) => {
                if (ev.button === 1) ev.preventDefault(); // no autoscroll
            });
            button.addEventListener('auxclick', (ev) => {
                if (ev.button !== 1) return;
                ev.preventDefault();
                brushes.setSlot('middle', brush);
            });
        }
        this.radiusInput.addEventListener('input', () => brushes.setRadius(Number(this.radiusInput.value)));
        this.strengthInput.addEventListener('input', () => brushes.setStrength(Number(this.strengthInput.value)));
        el.querySelector('.te-steep')!.addEventListener('click', () => (brushes.steepShown = !brushes.steepShown));
        el.querySelector('.te-generated')!.addEventListener('click', () => actions.generated());
        el.querySelector('.te-save')!.addEventListener('click', () => this.saveFile());
        el.querySelector('.te-load')!.addEventListener('click', () => this.loadFile());

        // A slider or button keeps keyboard focus after a click, and the camera
        // ignores keys aimed at inputs — hand focus back so WASD keeps working.
        const release = () => {
            const active = document.activeElement as HTMLElement | null;
            if (active && el.contains(active)) active.blur();
        };
        el.addEventListener('pointerup', () => requestAnimationFrame(release));
        el.addEventListener('change', () => requestAnimationFrame(release));
        this.sync();
    }

    /** show the brushes' current tools and settings (after a key or a click changed them) */
    sync(): void {
        for (const button of this.el.querySelectorAll<HTMLButtonElement>('.te-tool')) {
            const brush = button.dataset.brush as TerrainBrush;
            button.classList.toggle('active', this.brushes.leftBrush === brush);
            const tags = button.querySelector('.slot-tags');
            if (tags) tags.textContent = this.brushes.slotsOf(brush).map((slot) => (slot === 'left' ? 'L' : slot === 'right' ? 'R' : 'M')).join('');
        }
        this.radiusInput.value = String(Math.round(this.brushes.radius));
        this.strengthInput.value = String(this.brushes.strength);
        this.el.querySelector('.te-steep')!.classList.toggle('active', this.brushes.steepShown);
    }

    private setStatus(text: string): void {
        this.statusEl.textContent = text;
    }

    /** the terrain as a file of its own (to reuse it in another scenario) */
    private saveFile(): void {
        const data = this.actions.capture();
        if (!data) {
            this.setStatus(t('editor:terrainUnreadable', { defaultValue: 'Could not read the terrain' }));
            return;
        }
        const file = `${fileSlug(this.fileName())}.terrain.json`;
        const url = URL.createObjectURL(new Blob([JSON.stringify(encodeLandscape(data))], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file;
        a.click();
        // revoking right away can cancel the download in some browsers
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        this.setStatus(t('editor:terrainSaved', { defaultValue: 'Saved {{file}}', file }));
    }

    private loadFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
                try {
                    const raw: unknown = JSON.parse(text);
                    if (!isLandscapeFile(raw)) throw new Error(t('editor:terrainNotAFile', { defaultValue: 'not a terrain file' }));
                    const error = this.actions.load(decodeLandscape(raw));
                    this.setStatus(error ?? t('editor:terrainLoaded', { defaultValue: 'Loaded {{file}}', file: file.name }));
                } catch (e) {
                    this.setStatus(
                        t('editor:terrainLoadFailed', { defaultValue: 'Load failed: {{reason}}', reason: e instanceof Error ? e.message : String(e) }),
                    );
                }
            });
        };
        input.click();
    }
}

/** a file name from a scenario name: lower-case words joined by dashes */
function fileSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'terrain';
}
