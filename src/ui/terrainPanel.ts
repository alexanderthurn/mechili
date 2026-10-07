/**
 * The Terrain tool's panel in the scenario editor window: the shape and plant
 * brushes (by mouse button), radius and strength, and the steep-slope overlay.
 * It only drives {@link TerrainBrushes}; what the terrain means for the draft
 * is the editor session's business.
 */
import { t } from '../i18n';
import { TerrainBrushes, type TerrainBrush } from '../game/terrainBrushes';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TOOLS: { group: string; groupLabel: string; tools: { brush: TerrainBrush; key: string; label: string; fallback: string }[] }[] = [
    {
        group: 'shape',
        groupLabel: 'Shape',
        tools: [
            { brush: 'raise', key: '1', label: 'terrainRaise', fallback: 'Raise' },
            { brush: 'lower', key: '2', label: 'terrainLower', fallback: 'Lower' },
            { brush: 'flatten', key: '3', label: 'terrainFlatten', fallback: 'Flatten' },
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

    constructor(private readonly brushes: TerrainBrushes) {
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
            `<button type="button" class="te-steep" title="${esc(t('editor:terrainSteepTip', { defaultValue: 'Amber: slows units · red: too steep to walk up' }))}">${t('editor:terrainSteepOverlay', { defaultValue: 'Show slope overlay' })}</button>` +
            `</div>` +
            `<div class="se-hint">${t('editor:terrainHint', {
                defaultValue: 'Left drag: L tool · Shift+right drag: R · Shift+middle drag: M · right- or middle-click a tool to put it on that button',
            })}</div>`;
        this.el = el;
        this.radiusInput = el.querySelector<HTMLInputElement>('.te-r')!;
        this.strengthInput = el.querySelector<HTMLInputElement>('.te-s')!;

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
}
