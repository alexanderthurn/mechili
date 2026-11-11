/**
 * Filming a replay's battle into an .mp4 — a special tool for the developer,
 * kept apart from the game: nothing here runs unless "Film Round N" is
 * clicked in a replay (and this module is only loaded then).
 *
 * Not a screen recording: the game is driven by hand, one fixed step per
 * video frame (Game.beginFilm / filmFrame), and each drawn frame goes to the
 * encoder (WebCodecs H.264 through mediabunny). However long a frame takes to
 * draw, the video plays back smooth. The camera is wherever the viewer left
 * it. Only the 3D world is filmed: the HUD is HTML on top and not part of the
 * canvas; no sound. Saved to the downloads.
 *
 * Two kinds ({@link FILM_SPECS}): the film (4K, 60 fps, Ultra graphics) and a
 * quick preview (540p, 15 fps, the player's own graphics — it looks like the
 * screen). The film's preset is set by main.ts around the take (a rebuild,
 * not saved to the player's settings).
 */

import { BufferTarget, CanvasSource, canEncodeVideo, Mp4OutputFormat, Output } from 'mediabunny';
import type { Phase } from '../ui/hud';
import type { GraphicsPreset } from './prefs';

/** what filming needs of the replay's Game */
export interface FilmGame {
    beginFilm(): boolean;
    filmFrame(dt: number, draw?: boolean): void;
    setFilmSize(size: { width: number; height: number } | null): void;
    setFilmView(view: { aspect: number; x: number; y: number; w: number; h: number } | null): void;
    endFilm(): void;
    readonly filmState: { phase: Phase; matchOver: boolean; ready: boolean };
    skipReplayDeployment(): void;
}

/** a film is downloaded (`file`); a preview is handed back to be played on the spot (`video`) */
export type FilmResult = { ok: true; file: string | null; video: Blob | null; seconds: number } | { ok: false; reason: string };

/** wide: the window's shape; short: 9:16 upright (YouTube Shorts) */
export type FilmKind = 'film' | 'short' | 'preview';

/** a short is the window's view narrowed to this shape (the camera keeps its vertical view, so it is the middle strip) */
export const SHORT_ASPECT = 9 / 16;

/**
 * Each kind's size, rate and graphics. `aspect` null: the window's shape.
 * `fallbackHeight`: tried when the browser can't encode the full size.
 * `preset` null: the player's own graphics, no rebuild before the take.
 */
export const FILM_SPECS: Record<FilmKind, { height: number; fallbackHeight?: number; aspect: number | null; fps: number; preset: GraphicsPreset | null }> = {
    film: { height: 2160, aspect: null, fps: 60, preset: 'ultra' },
    short: { height: 3840, fallbackHeight: 1920, aspect: SHORT_ASPECT, fps: 60, preset: 'ultra' },
    preview: { height: 540, aspect: null, fps: 15, preset: null },
};

/** about 0.1 bits per pixel per frame — crisp for a busy battlefield (4K60: ~50 Mbit/s) */
const BITS_PER_PIXEL_FRAME = 0.1;
/** the battle's longest stretch filmed (a safety stop), seconds */
const MAX_SECONDS = 600;
/** frames run unfilmed while the skipped deployment turns into the battle */
const MAX_LEAD_SECONDS = 20;
/** how long a freshly built game may take to warm up before filming gives up, ms */
const READY_TIMEOUT_MS = 60_000;

/** 202611111924_replay_round2.mp4 (…_preview.mp4) */
function filenameFor(round: number, kind: FilmKind): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `${when}_replay_round${round}${kind === 'film' ? '' : `_${kind}`}.mp4`;
}

function download(data: ArrayBuffer, filename: string): void {
    const url = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** lets the page breathe (paint the progress, run the encoder's callbacks) */
const breathe = () => new Promise<void>((r) => window.setTimeout(r, 0));

/** a note after filming (saved where, or why not); goes away by itself or on a click */
export function showFilmNote(parent: HTMLElement, text: string): void {
    const el = document.createElement('div');
    el.className = 'mechili-film-note';
    el.textContent = text;
    el.addEventListener('click', () => el.remove());
    parent.appendChild(el);
    window.setTimeout(() => el.remove(), 8000);
}

/** a stretch of the battle, in seconds from its start */
export interface FilmRange {
    from: number;
    to: number;
}

/**
 * A Short's area of the wide view, 9:16 upright: its middle (0…1 of the
 * view's width / height) and its height as a part of the view's (1: the
 * full height; smaller: closer, drawn at full resolution all the same).
 */
export interface ShortArea {
    cx: number;
    cy: number;
    h: number;
}

/** the smallest area, as a part of the view's height */
const MIN_SHORT_H = 0.2;

/** the area's rectangle in the view (0…1, from the top left), kept inside it */
function shortRect(area: ShortArea, viewAspect: number): { x: number; y: number; w: number; h: number } {
    const h = Math.max(MIN_SHORT_H, Math.min(1, area.h));
    const w = Math.min(1, (h * SHORT_ASPECT) / viewAspect);
    const x = Math.max(0, Math.min(1 - w, area.cx - w / 2));
    const y = Math.max(0, Math.min(1 - h, area.cy - h / 2));
    return { x, y, w, h };
}

/** the shortest stretch the handles allow, seconds */
const MIN_RANGE = 0.5;

const fmt = (t: number) => `${t.toFixed(1)} s`;

/**
 * A preview played on the spot, over the game. Wide | Short switches the
 * format: a short shows the preview's middle 9:16 strip, which is exactly
 * what the upright film will hold. Under the video a bar with two handles
 * picks the part to keep (left: start, right: end); the video loops just
 * that part. The film button takes the real film of that part only, in the
 * chosen format, from the same shot.
 */
export function showPreviewPlayer(
    parent: HTMLElement,
    video: Blob,
    round: number,
    seconds: number,
    onFilm: (range: FilmRange, kind: 'film' | 'short', area: ShortArea | null) => void,
): void {
    const url = URL.createObjectURL(video);
    const overlay = document.createElement('div');
    overlay.className = 'mechili-film-preview';
    overlay.innerHTML =
        `<div class="fp-box">` +
        `<div class="fp-head-row"><div class="fp-title">Preview of round ${round}</div>` +
        `<div class="fp-format"><button type="button" data-format="film" class="is-on">Wide</button>` +
        `<button type="button" data-format="short">Short</button></div></div>` +
        `<div class="fp-frame"><div class="fp-stage"><video class="fp-video" autoplay playsinline></video>` +
        `<div class="fp-area" hidden><div class="fp-area-size" title="Drag: bigger / smaller"></div></div></div></div>` +
        `<div class="fp-area-hint" hidden>Short: drag the frame to move it, its corner (or the mouse wheel) to size it — a smaller frame is filmed closer, as sharp.</div>` +
        `<div class="fp-bar"><div class="fp-sel"></div><div class="fp-head"></div>` +
        `<div class="fp-handle from" title="Start"></div><div class="fp-handle to" title="End"></div></div>` +
        `<div class="fp-info"></div>` +
        `<div class="fp-actions">` +
        `<button type="button" data-act="play">Pause</button>` +
        `<button type="button" data-act="all">Whole battle</button>` +
        `<span class="fp-gap"></span>` +
        `<button type="button" data-act="close">Close</button>` +
        `<button type="button" class="primary" data-act="film"></button>` +
        `</div></div>`;
    const videoEl = overlay.querySelector<HTMLVideoElement>('video')!;
    const bar = overlay.querySelector<HTMLDivElement>('.fp-bar')!;
    const sel = overlay.querySelector<HTMLDivElement>('.fp-sel')!;
    const head = overlay.querySelector<HTMLDivElement>('.fp-head')!;
    const fromEl = overlay.querySelector<HTMLDivElement>('.fp-handle.from')!;
    const toEl = overlay.querySelector<HTMLDivElement>('.fp-handle.to')!;
    const info = overlay.querySelector<HTMLDivElement>('.fp-info')!;
    const playBtn = overlay.querySelector<HTMLButtonElement>('[data-act="play"]')!;
    const filmBtn = overlay.querySelector<HTMLButtonElement>('[data-act="film"]')!;
    const frame = overlay.querySelector<HTMLDivElement>('.fp-frame')!;
    const stage = overlay.querySelector<HTMLDivElement>('.fp-stage')!;
    const areaEl = overlay.querySelector<HTMLDivElement>('.fp-area')!;
    const areaHint = overlay.querySelector<HTMLDivElement>('.fp-area-hint')!;
    videoEl.src = url;
    let format: 'film' | 'short' = 'film';
    const area: ShortArea = { cx: 0.5, cy: 0.5, h: 1 };
    const videoAspect = () => (videoEl.videoWidth > 0 ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9);
    const paintArea = () => {
        const short = format === 'short';
        areaEl.hidden = !short;
        areaHint.hidden = !short;
        if (!short) return;
        const r = shortRect(area, videoAspect());
        // keep the stored middle where the rectangle really is (it was kept inside the view)
        area.cx = r.x + r.w / 2;
        area.cy = r.y + r.h / 2;
        areaEl.style.left = `${r.x * 100}%`;
        areaEl.style.top = `${r.y * 100}%`;
        areaEl.style.width = `${r.w * 100}%`;
        areaEl.style.height = `${r.h * 100}%`;
    };
    // moving the frame (drag inside) or sizing it (drag its corner, or the wheel)
    let areaDrag: { mode: 'move' | 'size'; x: number; y: number; start: ShortArea } | null = null;
    areaEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = (e.target as HTMLElement).classList.contains('fp-area-size') ? 'size' : 'move';
        areaDrag = { mode, x: e.clientX, y: e.clientY, start: { ...area } };
    });
    const onAreaMove = (e: PointerEvent) => {
        if (!areaDrag) return;
        const box = stage.getBoundingClientRect();
        const dx = (e.clientX - areaDrag.x) / Math.max(1, box.width);
        const dy = (e.clientY - areaDrag.y) / Math.max(1, box.height);
        if (areaDrag.mode === 'move') {
            area.cx = areaDrag.start.cx + dx;
            area.cy = areaDrag.start.cy + dy;
        } else {
            // the corner pulled down/right grows the frame (from its middle)
            area.h = Math.max(MIN_SHORT_H, Math.min(1, areaDrag.start.h + Math.max(dy, (dx * videoAspect()) / SHORT_ASPECT) * 2));
        }
        paintArea();
    };
    const onAreaUp = () => (areaDrag = null);
    stage.addEventListener(
        'wheel',
        (e) => {
            if (format !== 'short') return;
            e.preventDefault();
            area.h = Math.max(MIN_SHORT_H, Math.min(1, area.h * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
            paintArea();
        },
        { passive: false },
    );
    window.addEventListener('pointermove', onAreaMove);
    window.addEventListener('pointerup', onAreaUp);

    let total = Math.max(MIN_RANGE, seconds);
    const range: FilmRange = { from: 0, to: total };
    const pct = (t: number) => `${(Math.max(0, Math.min(total, t)) / total) * 100}%`;
    const paint = () => {
        sel.style.left = pct(range.from);
        sel.style.width = `${((range.to - range.from) / total) * 100}%`;
        fromEl.style.left = pct(range.from);
        toEl.style.left = pct(range.to);
        head.style.left = pct(videoEl.currentTime);
        const whole = range.from <= 0.01 && range.to >= total - 0.01;
        info.textContent = whole ? `The whole battle: ${fmt(total)}` : `From ${fmt(range.from)} to ${fmt(range.to)} — ${fmt(range.to - range.from)}`;
        const what = format === 'short' ? 'as Short' : 'in 4K';
        filmBtn.textContent = whole ? `🎬 Film ${what}` : `🎬 Film ${fmt(range.to - range.from)} ${what}`;
        frame.classList.toggle('short', format === 'short');
        paintArea();
        overlay.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((b) => b.classList.toggle('is-on', b.dataset.format === format));
        playBtn.textContent = videoEl.paused ? 'Play' : 'Pause';
    };
    videoEl.addEventListener('loadedmetadata', () => {
        // the file's own length is the truth (the encoder may round the last frame)
        if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
            total = videoEl.duration;
            range.to = Math.min(range.to, total) || total;
        }
        paint();
    });
    // the loop over the chosen part, checked every frame (timeupdate is too coarse)
    let raf = 0;
    const watch = () => {
        if (!videoEl.paused && (videoEl.currentTime >= range.to || videoEl.currentTime < range.from - 0.05)) {
            videoEl.currentTime = range.from;
        }
        paint();
        raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);

    // dragging a handle moves that end (the video shows the frame there); a click on the bar seeks
    const timeAt = (clientX: number) => {
        const r = bar.getBoundingClientRect();
        return Math.max(0, Math.min(total, ((clientX - r.left) / Math.max(1, r.width)) * total));
    };
    let dragging: 'from' | 'to' | null = null;
    let wasPlaying = false;
    const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const t = timeAt(e.clientX);
        if (dragging === 'from') range.from = Math.min(t, range.to - MIN_RANGE);
        else range.to = Math.max(t, range.from + MIN_RANGE);
        range.from = Math.max(0, range.from);
        range.to = Math.min(total, range.to);
        videoEl.currentTime = dragging === 'from' ? range.from : range.to;
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = null;
        videoEl.currentTime = range.from;
        if (wasPlaying) void videoEl.play();
    };
    const grab = (which: 'from' | 'to') => (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = which;
        wasPlaying = !videoEl.paused;
        videoEl.pause();
    };
    fromEl.addEventListener('pointerdown', grab('from'));
    toEl.addEventListener('pointerdown', grab('to'));
    bar.addEventListener('pointerdown', (e) => {
        if (dragging) return;
        videoEl.currentTime = Math.max(range.from, Math.min(range.to - 0.05, timeAt(e.clientX)));
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    const close = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointermove', onAreaMove);
        window.removeEventListener('pointerup', onAreaUp);
        videoEl.pause();
        overlay.remove();
        URL.revokeObjectURL(url);
    };
    // Escape closes, Space plays/pauses; no key reaches the game behind it (camera keys, speed digits)
    const onKey = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
        if (e.key === ' ') {
            e.preventDefault();
            if (videoEl.paused) void videoEl.play();
            else videoEl.pause();
        }
    };
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return close();
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (button?.dataset.format) format = button.dataset.format === 'short' ? 'short' : 'film';
        const act = button?.dataset.act;
        if (act === 'close') close();
        if (act === 'play') {
            if (videoEl.paused) void videoEl.play();
            else videoEl.pause();
        }
        if (act === 'all') {
            range.from = 0;
            range.to = total;
        }
        if (act === 'film') {
            const chosen = { ...range };
            const chosenArea = format === 'short' ? { ...area } : null;
            close();
            onFilm(chosen, format, chosenArea);
        }
    });
    parent.appendChild(overlay);
    paint();
}

/** the progress line while filming, with a Cancel */
function progressOverlay(parent: HTMLElement): { set(text: string): void; cancelled(): boolean; remove(): void } {
    const el = document.createElement('div');
    el.className = 'mechili-replay-loader mechili-film-progress';
    el.innerHTML = `<div class="rl-spin"></div><div class="rl-text"></div><button type="button">Cancel</button>`;
    let cancelled = false;
    el.querySelector('button')!.addEventListener('click', () => (cancelled = true));
    parent.appendChild(el);
    return {
        set: (text) => (el.querySelector('.rl-text')!.textContent = text),
        cancelled: () => cancelled,
        remove: () => el.remove(),
    };
}

/**
 * Films the battle of the round the replay stands at: its deployment
 * skipped, then the battle and its soul drain, frame by frame — into the
 * downloads as e.g. 202611111924_replay_round2.mp4.
 */
export async function filmBattle(
    game: FilmGame,
    canvas: HTMLCanvasElement,
    parent: HTMLElement,
    round: number,
    kind: FilmKind,
    /** only this stretch of the battle (seconds from its start); null: all of it */
    range: FilmRange | null = null,
    /** a Short: the part of the view it holds (null: the middle strip, full height) */
    area: ShortArea | null = null,
): Promise<FilmResult> {
    if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'This browser cannot encode video (no WebCodecs).' };
    const spec = FILM_SPECS[kind];
    const { fps } = spec;
    // the spec's shape (else the window's) at its lines, even sides as H.264 wants; the fallback
    // size when the full one can't be encoded here
    const viewAspect = Math.max(0.5, Math.min(4, canvas.clientWidth / Math.max(1, canvas.clientHeight)));
    const aspect = spec.aspect ?? viewAspect;
    const sizeAt = (h: number) => {
        const height = h - (h % 2);
        const width = Math.round((height * aspect) / 2) * 2;
        return { width, height, bitrate: Math.max(1_500_000, Math.round(width * height * fps * BITS_PER_PIXEL_FRAME)) };
    };
    let size = sizeAt(spec.height);
    if (!(await canEncodeVideo('avc', size)) && spec.fallbackHeight) size = sizeAt(spec.fallbackHeight);
    const { width, height, bitrate } = size;
    if (!(await canEncodeVideo('avc', size))) {
        return { ok: false, reason: `This browser cannot encode H.264 at ${width}×${height}.` };
    }
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });

    const progress = progressOverlay(parent);
    // a freshly built game draws nothing until its warm-up is done — a film started before
    // would record one frozen frame forever
    progress.set('Preparing…');
    const readyBy = performance.now() + READY_TIMEOUT_MS;
    while (!game.filmState.ready && performance.now() < readyBy && !progress.cancelled()) await new Promise((r) => window.setTimeout(r, 50));
    if (!game.filmState.ready || progress.cancelled() || !game.beginFilm()) {
        progress.remove();
        return { ok: false, reason: progress.cancelled() ? 'Cancelled.' : 'The replay was not ready to film.' };
    }
    const dt = 1 / fps;
    let frames = 0;
    let finished = false;
    try {
        game.setFilmSize({ width, height });
        // a Short draws its area of the window's view (sharp at full size), not a squeezed view
        if (kind === 'short') game.setFilmView({ aspect: viewAspect, ...shortRect(area ?? { cx: 0.5, cy: 0.5, h: 1 }, viewAspect) });
        await output.start();
        // the rest of the deployment at once; frames run (unfilmed) until the battle is on
        game.skipReplayDeployment();
        for (let lead = 0; lead < MAX_LEAD_SECONDS * fps && game.filmState.phase !== 'battle' && !game.filmState.matchOver; lead++) {
            game.filmFrame(dt);
        }
        if (game.filmState.phase !== 'battle') throw new Error(`the battle of round ${round} did not start`);
        const filming = () => {
            const { phase, matchOver } = game.filmState;
            return (phase === 'battle' || phase === 'hpDraw') && !matchOver;
        };
        // battle time by frame; before the chosen part the battle only runs on (no drawing, no frame kept)
        const from = range ? Math.round(range.from * fps) : 0;
        const to = range ? Math.round(range.to * fps) : MAX_SECONDS * fps;
        for (let step = 0; filming() && step < to && step < MAX_SECONDS * fps && !progress.cancelled(); step++) {
            if (step < from) {
                game.filmFrame(dt, false);
                if (step % 30 === 0) {
                    progress.set(`Running to ${(from * dt).toFixed(1)} s… ${(step * dt).toFixed(1)} s`);
                    await breathe();
                }
                continue;
            }
            game.filmFrame(dt);
            // the canvas is read in the same task it was drawn in (CanvasSource takes it at once)
            await source.add(frames * dt, dt);
            frames++;
            if (frames % 10 === 0) {
                const of = range ? ` of ${((to - from) * dt).toFixed(1)} s` : ' of battle';
                progress.set(`${kind === 'preview' ? 'Preview of' : kind === 'short' ? 'Short of' : 'Filming'} round ${round}… ${(frames * dt).toFixed(1)} s${of}`);
                await breathe();
            }
        }
        if (frames === 0 && !progress.cancelled()) throw new Error('the chosen part lies after the battle ended');
        if (progress.cancelled()) {
            await output.cancel();
            return { ok: false, reason: 'Cancelled.' };
        }
        progress.set('Writing the file…');
        await output.finalize();
        finished = true;
        if (kind === 'preview') {
            return { ok: true, file: null, video: new Blob([target.buffer!], { type: 'video/mp4' }), seconds: frames * dt };
        }
        const file = filenameFor(round, kind);
        download(target.buffer!, file);
        return { ok: true, file, video: null, seconds: frames * dt };
    } catch (err) {
        if (!finished) await output.cancel().catch(() => undefined);
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
        progress.remove();
        game.endFilm();
    }
}
