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
    endFilm(): void;
    readonly filmState: { phase: Phase; matchOver: boolean; ready: boolean };
    skipReplayDeployment(): void;
}

/** a film is downloaded (`file`); a preview is handed back to be played on the spot (`video`) */
export type FilmResult = { ok: true; file: string | null; video: Blob | null; seconds: number } | { ok: false; reason: string };

export type FilmKind = 'film' | 'preview';

/** each kind's size, rate and graphics */
/** `preset` null: the player's own graphics, no rebuild before the take */
export const FILM_SPECS: Record<FilmKind, { height: number; fps: number; preset: GraphicsPreset | null }> = {
    film: { height: 2160, fps: 60, preset: 'ultra' },
    preview: { height: 540, fps: 15, preset: null },
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
    return `${when}_replay_round${round}${kind === 'preview' ? '_preview' : ''}.mp4`;
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

/** the shortest stretch the handles allow, seconds */
const MIN_RANGE = 0.5;

const fmt = (t: number) => `${t.toFixed(1)} s`;

/**
 * A preview played on the spot, over the game. Under the video a bar with
 * two handles picks the part to keep (left: start, right: end); the video
 * loops just that part. "Film in 4K" takes the real film of that part only,
 * from the same shot.
 */
export function showPreviewPlayer(parent: HTMLElement, video: Blob, round: number, seconds: number, onFilm: (range: FilmRange) => void): void {
    const url = URL.createObjectURL(video);
    const overlay = document.createElement('div');
    overlay.className = 'mechili-film-preview';
    overlay.innerHTML =
        `<div class="fp-box">` +
        `<div class="fp-title">Preview of round ${round}</div>` +
        `<video class="fp-video" autoplay playsinline></video>` +
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
    videoEl.src = url;

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
        filmBtn.textContent = whole ? '🎬 Film in 4K' : `🎬 Film ${fmt(range.to - range.from)} in 4K`;
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
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
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
            close();
            onFilm(chosen);
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
): Promise<FilmResult> {
    if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'This browser cannot encode video (no WebCodecs).' };
    const { height, fps } = FILM_SPECS[kind];
    // the window's shape at the spec's lines (even sides, as H.264 wants)
    const aspect = Math.max(0.5, Math.min(4, canvas.clientWidth / Math.max(1, canvas.clientHeight)));
    const width = Math.round((height * aspect) / 2) * 2;
    const bitrate = Math.max(1_500_000, Math.round(width * height * fps * BITS_PER_PIXEL_FRAME));
    if (!(await canEncodeVideo('avc', { width, height, bitrate }))) {
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
                progress.set(`${kind === 'preview' ? 'Preview of' : 'Filming'} round ${round}… ${(frames * dt).toFixed(1)} s${of}`);
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
