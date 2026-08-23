/**
 * Loadout screen — the pregame talent picker (PROGRESSION_PLAN.md §1g).
 *
 * A full-screen 3D stage with the unit on it and the UI floating over the
 * top: unit switcher and stats on the left, talents and slots on the right.
 * Not a menu panel — the model IS the screen, so this is its own overlay
 * rather than a `.m-view` squeezed inside the menu frame.
 *
 * Nothing here is earned or gated — every talent is selectable from the
 * first match (PROGRESSION_PLAN.md §0.1). The only limit is the unit's own
 * slot count, which is balance, not progression.
 */

import {
    activeLoadout,
    defaultLoadout,
    loadoutUnitTypes,
    saveLoadout,
    toggleTech,
    type Loadout,
} from '../game/loadouts';
import { allowedTechIds, techById, techSlotLimit } from '../game/techCatalog';
import { hasAnimatedModel } from '../game/unitAnimated';
import { hasUnitModel } from '../game/unitModels';
import { techDescription, techIcon, type UnitType } from '../game/units';
import { CardSpellTips } from './cardSpellTip';
import { iconHtml } from './iconAtlas';
import { createShowcaseViewer, type ShowcaseViewer } from './modelViewer';

/** Trims the trailing `.0` that whole numbers pick up from toFixed. */
function num(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function targetsLabel(type: UnitType): string {
    const { ground, air } = type.targets;
    if (ground && air) return 'Ground + Air';
    if (air) return 'Air only';
    if (ground) return 'Ground only';
    return 'None';
}

/** Base combat stats — before any talent applies. */
function statRows(type: UnitType): { label: string; value: string }[] {
    const rows = [
        { label: 'Supply', value: String(type.cost) },
        { label: 'HP', value: num(type.hp) },
        { label: 'Damage', value: num(type.damage) },
        { label: 'Range', value: num(type.range) },
        // rate = 1 / interval, shown per second: "interval" reads as a delay,
        // and players compare attack SPEED
        { label: 'Attacks/s', value: num(1 / type.attackInterval) },
        { label: 'Move', value: num(type.speed) },
        { label: 'Targets', value: targetsLabel(type) },
    ];
    if (type.minRange) rows.splice(4, 0, { label: 'Min range', value: num(type.minRange) });
    if (type.flying) rows.push({ label: 'Flying', value: 'Yes' });
    return rows;
}

export interface LoadoutPanel {
    readonly el: HTMLElement;
    open(): void;
    close(): void;
}

/**
 * Build the screen. Edits save immediately (there is no OK/Cancel): a
 * loadout is a preference, and a half-applied one is more confusing than an
 * instantly-applied one.
 */
/**
 * How much smaller the model renders once the panels overlay it.
 *
 * On a phone the switcher, stats and talents all sit ON the stage, so a
 * full-size model fights them for the same pixels; shrinking it turns the
 * model into a backdrop, which is what it is at that size. `meshScale` is
 * the viewer's own size lever (see its STAGE_REF_MESH_SCALE note).
 */
const NARROW_MODEL_SCALE = 0.55;
const NARROW_QUERY = '(max-width: 860px)';

export function createLoadoutPanel(onClose: () => void): LoadoutPanel {
    const el = document.createElement('div');
    el.className = 'mechili-loadout';
    el.style.display = 'none';

    // The stage fills the whole overlay; everything else floats above it.
    const stage = document.createElement('canvas');
    stage.className = 'lo-stage';

    const unitName = document.createElement('div');
    unitName.className = 'lo-unitname';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'lo-arrow';
    prevBtn.innerHTML = '&#9664;';
    prevBtn.setAttribute('aria-label', 'Previous unit');
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'lo-arrow';
    nextBtn.innerHTML = '&#9654;';
    nextBtn.setAttribute('aria-label', 'Next unit');
    const switcher = document.createElement('div');
    switcher.className = 'lo-switcher';
    switcher.append(prevBtn, unitName, nextBtn);

    const stats = document.createElement('div');
    stats.className = 'lo-stats';

    // Mobile only (CSS hides it elsewhere): stats start collapsed there, so
    // the model and the talents get the screen. Desktop always shows them.
    const statsToggle = document.createElement('button');
    statsToggle.type = 'button';
    statsToggle.className = 'lo-statstoggle';
    let statsOpen = false;
    const syncStatsToggle = () => {
        el.classList.toggle('is-statsopen', statsOpen);
        statsToggle.textContent = statsOpen ? 'Stats \u25B4' : 'Stats \u25BE';
        statsToggle.setAttribute('aria-expanded', String(statsOpen));
    };
    statsToggle.addEventListener('click', () => {
        statsOpen = !statsOpen;
        syncStatsToggle();
    });

    const left = document.createElement('div');
    left.className = 'lo-left';
    left.append(switcher, statsToggle, stats);

    const techTitle = document.createElement('div');
    techTitle.className = 'lo-paneltitle';
    techTitle.textContent = 'Talents';
    const techList = document.createElement('div');
    techList.className = 'lo-techlist';
    const slots = document.createElement('div');
    slots.className = 'lo-slots';
    const right = document.createElement('div');
    right.className = 'lo-right';
    right.append(techTitle, techList, slots);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'lo-cornerbtn';
    backBtn.textContent = 'Back';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'lo-cornerbtn';
    // "all", not "Reset": everything else on this screen is scoped to the
    // selected unit, so an unqualified label would read as "reset the dwarf"
    resetBtn.textContent = 'Reset all';
    const corner = document.createElement('div');
    corner.className = 'lo-corner';
    corner.append(resetBtn, backBtn);

    el.append(stage, left, right, corner);

    const types = loadoutUnitTypes();
    let current: Loadout = defaultLoadout();
    let index = 0;
    /** created on first OPEN, disposed on close — never at construction, or
     *  every player pays for a second WebGL context at startup for a screen
     *  they may never visit */
    let viewer: ShowcaseViewer | null = null;
    /** what the viewer is actually showing, as `unitId:scale` — so toggling a
     *  talent (which re-renders) doesn't reload the same model, while a
     *  resize across the narrow breakpoint DOES re-show it at the new size */
    let shownUnitId = '';
    let isOpen = false;
    /** bound only while this screen is open — each instance adds its own
     *  document-level listeners, so two live at once would show two tips */
    const tips = new CardSpellTips();

    function selected(): UnitType | undefined {
        return types[index];
    }

    function write(next: Loadout): void {
        current = next;
        saveLoadout(next);
    }

    function picksFor(typeId: string): readonly string[] {
        return current.techs[typeId] ?? [];
    }

    function step(delta: number): void {
        if (types.length === 0) return;
        index = (index + delta + types.length) % types.length;
        render();
    }

    function renderStats(type: UnitType): void {
        stats.innerHTML = statRows(type)
            .map(
                (s) =>
                    `<div class="lo-stat"><span class="k">${s.label}</span>` +
                    `<span class="v">${s.value}</span></div>`,
            )
            .join('');
    }

    /**
     * Point the shared hover tip (the same one the in-match rune/spell hover
     * uses) at a talent. Attributes go on via `dataset` rather than being
     * interpolated into innerHTML, so quotes and newlines in a description
     * cannot break the markup.
     */
    function attachTechTip(btn: HTMLElement, techId: string): void {
        const tech = techById(techId);
        if (!tech) return;
        btn.dataset.spellTip = '1';
        // both lists hug a screen edge, so the tip flips onto the cursor
        // unless it is pushed further out
        btn.dataset.tipWide = '1';
        btn.dataset.ttitle = tech.name;
        btn.dataset.tdesc = techDescription(tech);
        btn.dataset.ticon = techIcon(tech);
    }

    function renderTechs(type: UnitType): void {
        const picks = picksFor(type.id);
        techList.textContent = '';
        for (const id of allowedTechIds(type.id)) {
            const tech = techById(id);
            if (!tech) continue;
            const on = picks.includes(id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `lo-tech${on ? ' is-on' : ''}`;
            attachTechTip(btn, id);
            btn.innerHTML =
                `${iconHtml(techIcon(tech), 'lo-tico mask-ico')}` +
                `<span class="lo-tname">${tech.name}</span>` +
                `<span class="lo-tcost">${tech.cost}</span>`;
            btn.addEventListener('click', () => {
                write(toggleTech(current, type.id, id));
                render();
            });
            techList.appendChild(btn);
        }

        // Slot row: one box per allowed slot, so the limit is visible without
        // a label spelling it out. Filled boxes clear on click.
        const limit = techSlotLimit(type.id);
        slots.textContent = '';
        for (let i = 0; i < limit; i++) {
            const id = picks[i];
            const tech = id ? techById(id) : null;
            if (!tech) {
                const empty = document.createElement('div');
                empty.className = 'lo-slot is-empty';
                slots.appendChild(empty);
                continue;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lo-slot';
            attachTechTip(btn, tech.id);
            btn.innerHTML = iconHtml(techIcon(tech), 'lo-sico mask-ico');
            btn.addEventListener('click', () => {
                write(toggleTech(current, type.id, tech.id));
                render();
            });
            slots.appendChild(btn);
        }
    }

    /**
     * Show the selected unit's model, creating the viewer on first need.
     *
     * Only marks a unit as shown once its model actually EXISTS: boot assets
     * may still be loading and `ShowcaseViewer.show` no-ops silently then, so
     * recording it as shown anyway would leave an empty stage forever.
     */
    function syncModel(): void {
        const type = selected();
        if (!isOpen || !type) return;
        // Short viewports hide the stage entirely (see the max-height rule in
        // theme.ts). A display:none canvas measures 0, so there is nothing to
        // render — and a renderer left running against it would burn a WebGL
        // context and a rAF loop for something nobody can see.
        if (stage.clientWidth < 1 || stage.clientHeight < 1) {
            viewer?.dispose();
            viewer = null;
            shownUnitId = '';
            return;
        }
        const narrow = window.matchMedia(NARROW_QUERY).matches;
        // a width change across the breakpoint has to re-show at the new
        // scale, so the shown-key carries the scale as well as the unit
        const key = `${type.id}:${narrow ? 'n' : 'w'}`;
        if (shownUnitId === key) return;
        if (!hasUnitModel(type.id) && !hasAnimatedModel(type.id)) return;
        if (!viewer) viewer = createShowcaseViewer(stage);
        viewer.show(type.id, type.meshScale * (narrow ? NARROW_MODEL_SCALE : 1));
        shownUnitId = key;
    }

    /** the stage can appear or vanish as the window crosses the height
     *  breakpoint, so re-check whenever the viewport changes */
    const onViewportResize = () => syncModel();

    function render(): void {
        const type = selected();
        if (!type) return;
        unitName.textContent = type.name;
        renderStats(type);
        renderTechs(type);
        syncModel();
    }

    function open(): void {
        isOpen = true;
        tips.bind();
        window.addEventListener('resize', onViewportResize);
        syncStatsToggle();
        el.style.display = '';
        current = activeLoadout();
        if (index >= types.length) index = 0;
        render();
    }

    function close(): void {
        isOpen = false;
        tips.destroy();
        window.removeEventListener('resize', onViewportResize);
        el.style.display = 'none';
        // don't leave a second WebGL context alive behind the menu
        viewer?.dispose();
        viewer = null;
        shownUnitId = '';
        onClose();
    }

    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    resetBtn.addEventListener('click', () => {
        write(defaultLoadout());
        render();
    });
    backBtn.addEventListener('click', () => close());

    return { el, open, close };
}
