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

import {
    AudioBufferSource,
    BufferTarget,
    CanvasSource,
    canEncodeVideo,
    getFirstEncodableAudioCodec,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    QUALITY_MEDIUM,
} from 'mediabunny';
import { audio } from './audio';
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
export type FilmResult =
    | { ok: true; file: string | null; video: Blob | null; seconds: number; sound: FilmSoundParts | null }
    | { ok: false; reason: string };

/** a preview's soundtrack apart: the player mixes it live, as the SFX / Music buttons say */
export type FilmSoundParts = { sfx: AudioBuffer; music: AudioBuffer };

/** what the preview player was set to — it opens like that again after a film */
export interface PreviewState {
    range: FilmRange;
    format: FilmFormat;
    area: ShortArea | null;
    mix: FilmSound;
}

/** what the film's first sound track (the one players play) holds; the sounds and the music also come as tracks of their own */
export type FilmSound = { sfx: boolean; music: boolean };

/** wide: the window's shape; short: 9:16 upright (YouTube Shorts) */
export type FilmKind = 'film' | 'short' | '2k' | 'preview';

/** what the preview offers to film */
export type FilmFormat = Exclude<FilmKind, 'preview'>;

/** a short is the window's view narrowed to this shape (the camera keeps its vertical view, so it is the middle strip) */
export const SHORT_ASPECT = 9 / 16;

/** 2K: 16:9 out of the middle of the view, 1080p — what X (Twitter) takes */
export const TWO_K_ASPECT = 16 / 9;

/**
 * Each kind's size, rate and graphics. `aspect` null: the window's shape.
 * `fallbackHeight`: tried when the browser can't encode the full size.
 * `preset` null: the player's own graphics, no rebuild before the take.
 * `maxBitrate`: a cap the upload site sets. `oneSoundTrack`: only the mix, no
 * sounds / music tracks apart (an upload site may refuse several).
 */
export const FILM_SPECS: Record<
    FilmKind,
    { height: number; fallbackHeight?: number; aspect: number | null; fps: number; preset: GraphicsPreset | null; maxBitrate?: number; oneSoundTrack?: boolean }
> = {
    film: { height: 2160, aspect: null, fps: 60, preset: 'ultra' },
    short: { height: 3840, fallbackHeight: 1920, aspect: SHORT_ASPECT, fps: 60, preset: 'ultra' },
    '2k': { height: 1080, aspect: TWO_K_ASPECT, fps: 60, preset: 'ultra', maxBitrate: 12_000_000, oneSoundTrack: true },
    preview: { height: 540, aspect: null, fps: 15, preset: null, oneSoundTrack: true },
};

/** about 0.1 bits per pixel per frame — crisp for a busy battlefield (4K60: ~50 Mbit/s) */
const BITS_PER_PIXEL_FRAME = 0.1;
/** the battle's longest stretch filmed (a safety stop), seconds */
const MAX_SECONDS = 600;
/** frames run unfilmed while the skipped deployment turns into the battle */
const MAX_LEAD_SECONDS = 20;
/** a soundtrack without a chosen part (the preview of a whole battle) is recorded this long at most */
const MAX_SOUND_SECONDS = 300;
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

/** 2K's rectangle in the view: 16:9 from its middle, as high or as wide as the view allows */
function twoKRect(viewAspect: number): { x: number; y: number; w: number; h: number } {
    const w = Math.min(1, TWO_K_ASPECT / viewAspect);
    const h = Math.min(1, viewAspect / TWO_K_ASPECT);
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

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
    /** its sound apart (null: the file's own track, if any) */
    sound: FilmSoundParts | null,
    onFilm: (state: PreviewState) => void,
    /** opened again after a film: as it was set then */
    initial: PreviewState | null = null,
): void {
    const url = URL.createObjectURL(video);
    const overlay = document.createElement('div');
    overlay.className = 'mechili-film-preview';
    overlay.innerHTML =
        `<div class="fp-box">` +
        `<div class="fp-head-row"><div class="fp-title">Preview of round ${round}</div>` +
        `<div class="fp-format"><button type="button" data-format="film" class="is-on">Wide</button>` +
        `<button type="button" data-format="short">Short</button>` +
        `<button type="button" data-format="2k" title="1080p, 16:9 from the middle — small enough for X">2K</button></div></div>` +
        `<div class="fp-frame"><div class="fp-stage"><video class="fp-video" autoplay playsinline></video>` +
        `<div class="fp-area" hidden><div class="fp-area-size" title="Drag: bigger / smaller"></div></div></div></div>` +
        `<div class="fp-area-hint" hidden>Short: drag the frame to move it, its corner (or the mouse wheel) to size it — a smaller frame is filmed closer, as sharp.</div>` +
        `<div class="fp-bar"><div class="fp-sel"></div><div class="fp-head"></div>` +
        `<div class="fp-handle from" title="Start"></div><div class="fp-handle to" title="End"></div></div>` +
        `<div class="fp-info"></div>` +
        `<div class="fp-actions">` +
        `<button type="button" data-act="play">Pause</button>` +
        `<button type="button" data-act="all">Whole battle</button>` +
        `<button type="button" data-act="mix" data-part="sfx" class="fp-mix is-on" title="The battle's sounds — in the preview and the film's sound (a film also has them as a track of their own)">🔊 SFX</button>` +
        `<button type="button" data-act="mix" data-part="music" class="fp-mix is-on" title="The match's music — in the preview and the film's sound (a film also has it as a track of its own)">♪ Music</button>` +
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
    let format: FilmFormat = initial?.format ?? 'film';
    const area: ShortArea = initial?.area ? { ...initial.area } : { cx: 0.5, cy: 0.5, h: 1 };
    const mix: FilmSound = initial ? { ...initial.mix } : { sfx: true, music: true };
    overlay.querySelectorAll<HTMLButtonElement>('.fp-mix').forEach((b) => b.classList.toggle('is-on', mix[b.dataset.part as keyof FilmSound]));

    // the sound: both parts played along with the video in a context of the player's own — heard
    // whatever the game's mute or volumes, and the SFX / Music buttons switch them live
    const listen = sound ? new AudioContext() : null;
    const partGain = listen
        ? { sfx: listen.createGain(), music: listen.createGain() }
        : null;
    if (listen && partGain) {
        partGain.sfx.connect(listen.destination);
        partGain.music.connect(listen.destination);
        videoEl.muted = true;
    }
    const applyMix = () => {
        if (!partGain) return;
        partGain.sfx.gain.value = mix.sfx ? 1 : 0;
        partGain.music.gain.value = mix.music ? 1 : 0;
    };
    applyMix();
    let playing: AudioBufferSourceNode[] = [];
    /** where the sound was started (context time) and from which video time */
    let soundAt = { ctx: 0, video: 0 };
    const stopSound = () => {
        for (const src of playing) {
            try {
                src.stop();
            } catch {
                /* not started */
            }
            src.disconnect();
        }
        playing = [];
    };
    const startSound = () => {
        stopSound();
        if (!listen || !partGain || !sound || videoEl.paused) return;
        void listen.resume();
        const from = videoEl.currentTime;
        for (const part of ['sfx', 'music'] as const) {
            const src = listen.createBufferSource();
            src.buffer = sound[part];
            src.connect(partGain[part]);
            src.start(0, Math.min(from, sound[part].duration));
            playing.push(src);
        }
        soundAt = { ctx: listen.currentTime, video: from };
    };
    videoEl.addEventListener('playing', startSound);
    videoEl.addEventListener('seeked', startSound);
    videoEl.addEventListener('pause', stopSound);
    const videoAspect = () => (videoEl.videoWidth > 0 ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9);
    const paintArea = () => {
        const short = format === 'short';
        // 2K shows its fixed middle part; only a Short's frame can be moved and sized
        areaEl.hidden = !short && format !== '2k';
        areaEl.classList.toggle('fixed', format === '2k');
        areaHint.hidden = !short;
        if (format === '2k') {
            const r = twoKRect(videoAspect());
            areaEl.style.left = `${r.x * 100}%`;
            areaEl.style.top = `${r.y * 100}%`;
            areaEl.style.width = `${r.w * 100}%`;
            areaEl.style.height = `${r.h * 100}%`;
            return;
        }
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
    const range: FilmRange = initial ? { ...initial.range } : { from: 0, to: total };
    const pct = (t: number) => `${(Math.max(0, Math.min(total, t)) / total) * 100}%`;
    const paint = () => {
        sel.style.left = pct(range.from);
        sel.style.width = `${((range.to - range.from) / total) * 100}%`;
        fromEl.style.left = pct(range.from);
        toEl.style.left = pct(range.to);
        head.style.left = pct(videoEl.currentTime);
        const whole = range.from <= 0.01 && range.to >= total - 0.01;
        info.textContent = whole ? `The whole battle: ${fmt(total)}` : `From ${fmt(range.from)} to ${fmt(range.to)} — ${fmt(range.to - range.from)}`;
        const what = format === 'short' ? 'as Short' : format === '2k' ? 'in 2K' : 'in 4K';
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
            range.from = Math.min(range.from, Math.max(0, range.to - MIN_RANGE));
        }
        if (range.from > 0) videoEl.currentTime = range.from;
        paint();
    });
    // the loop over the chosen part, checked every frame (timeupdate is too coarse)
    let raf = 0;
    const watch = () => {
        if (!videoEl.paused && (videoEl.currentTime >= range.to || videoEl.currentTime < range.from - 0.05)) {
            videoEl.currentTime = range.from;
        }
        // the sound kept with the picture (a stall, a dropped frame): restarted where the video is
        if (playing.length && listen && !videoEl.paused && !videoEl.seeking) {
            const heard = soundAt.video + (listen.currentTime - soundAt.ctx);
            if (Math.abs(heard - videoEl.currentTime) > 0.12) startSound();
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
        stopSound();
        void listen?.close().catch(() => undefined);
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
        const picked = button?.dataset.format;
        if (picked) format = picked === 'short' || picked === '2k' ? picked : 'film';
        const act = button?.dataset.act;
        if (act === 'close') close();
        if (act === 'play') {
            if (videoEl.paused) void videoEl.play();
            else videoEl.pause();
        }
        if (act === 'mix') {
            const part = button!.dataset.part as keyof FilmSound;
            mix[part] = !mix[part];
            button!.classList.toggle('is-on', mix[part]);
            applyMix();
        }
        if (act === 'all') {
            range.from = 0;
            range.to = total;
        }
        if (act === 'film') {
            const chosen = { ...range };
            const chosenArea = format === 'short' ? { ...area } : null;
            close();
            onFilm({ range: chosen, format, area: chosenArea, mix: { ...mix } });
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

/** the sounds and the music summed as `mix` asks (left out: silent) */
function mixOf(parts: { sfx: AudioBuffer; music: AudioBuffer }, mix: FilmSound): AudioBuffer {
    const { length, sampleRate } = parts.sfx;
    const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
    for (let ch = 0; ch < 2; ch++) {
        const o = out.getChannelData(ch);
        const a = parts.sfx.getChannelData(ch);
        const b = parts.music.getChannelData(ch);
        for (let i = 0; i < length; i++) o[i] = (mix.sfx ? a[i]! : 0) + (mix.music ? b[i]! : 0);
    }
    return out;
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
    /** what the mix (the first sound track) holds */
    mix: FilmSound = { sfx: true, music: true },
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
        const bitrate = Math.max(1_500_000, Math.round(width * height * fps * BITS_PER_PIXEL_FRAME));
        return { width, height, bitrate: Math.min(bitrate, spec.maxBitrate ?? Infinity) };
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
    // the battle's sound, rendered along with the frames (audio.ts filmAudio*); none where nothing encodes it.
    // Track 1 is the mix players play; a film also carries the sounds and the music apart, for a video editor.
    const soundCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48_000 });
    const quality = kind === 'preview' ? QUALITY_MEDIUM : QUALITY_HIGH;
    const track = (name: string, primary: boolean) => {
        const src = new AudioBufferSource({ codec: soundCodec!, quality });
        output.addAudioTrack(src, { name, disposition: { default: primary, primary } });
        return src;
    };
    // the preview's file stays silent: its player mixes the parts itself (any codec or none)
    const sound =
        kind === 'preview'
            ? { mix: null, apart: null }
            : soundCodec
              ? {
                    mix: track('Mix', true),
                    apart: spec.oneSoundTrack ? null : { sfx: track('Sounds', false), music: track('Music', false) },
                }
              : null;
    let previewSound: FilmSoundParts | null = null;

    const progress = progressOverlay(parent);
    // a freshly built game draws nothing until its warm-up is done — a film started before
    // would record one frozen frame forever
    progress.set('Preparing…');
    // every sound decoded up front: one decoded mid-film would sound late
    if (sound) await audio.preload().catch(() => undefined);
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
        // the speakers stay silent; from the chosen part on, every sound goes to the soundtrack
        if (sound) audio.filmAudioBegin();
        game.setFilmSize({ width, height });
        // a Short draws its area of the window's view (sharp at full size), not a squeezed view
        if (kind === 'short') game.setFilmView({ aspect: viewAspect, ...shortRect(area ?? { cx: 0.5, cy: 0.5, h: 1 }, viewAspect) });
        if (kind === '2k') game.setFilmView({ aspect: viewAspect, ...twoKRect(viewAspect) });
        await output.start();
        // the rest of the deployment at once; frames run (unfilmed) until the battle is on
        game.skipReplayDeployment();
        for (let lead = 0; lead < MAX_LEAD_SECONDS * fps && game.filmState.phase !== 'battle' && !game.filmState.matchOver; lead++) {
            game.filmFrame(dt);
        }
        if (game.filmState.phase !== 'battle') throw new Error(`the battle of round ${round} did not start`);
        // the battle's own bed is asked for now (the deployment had another): decoded before it is needed
        if (sound) await audio.filmAudioPrepare().catch(() => undefined);
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
            if (frames === 0 && sound) audio.filmAudioStart(range ? range.to - range.from : MAX_SOUND_SECONDS, step * dt);
            game.filmFrame(dt);
            // the canvas is read in the same task it was drawn in (CanvasSource takes it at once)
            await source.add(frames * dt, dt);
            frames++;
            // the frame's sounds started at its time; the soundtrack renders on to the next
            if (sound) await audio.filmAudioStep(dt);
            if (frames % 10 === 0) {
                const of = range ? ` of ${((to - from) * dt).toFixed(1)} s` : ' of battle';
                progress.set(`${kind === 'preview' ? 'Preview of' : kind === 'short' ? 'Short of' : kind === '2k' ? '2K of' : 'Filming'} round ${round}… ${(frames * dt).toFixed(1)} s${of}`);
                await breathe();
            }
        }
        if (frames === 0 && !progress.cancelled()) throw new Error('the chosen part lies after the battle ended');
        if (progress.cancelled()) {
            await output.cancel();
            return { ok: false, reason: 'Cancelled.' };
        }
        if (sound) {
            progress.set('Adding the sound…');
            const parts = await audio.filmAudioFinish(frames * dt);
            if (parts && kind === 'preview') previewSound = parts;
            if (parts && sound.mix) {
                await sound.mix.add(mixOf(parts, mix));
                if (sound.apart) {
                    await sound.apart.sfx.add(parts.sfx);
                    await sound.apart.music.add(parts.music);
                }
            }
        }
        progress.set('Writing the file…');
        await output.finalize();
        finished = true;
        if (kind === 'preview') {
            return { ok: true, file: null, video: new Blob([target.buffer!], { type: 'video/mp4' }), seconds: frames * dt, sound: previewSound };
        }
        const file = filenameFor(round, kind);
        download(target.buffer!, file);
        return { ok: true, file, video: null, seconds: frames * dt, sound: null };
    } catch (err) {
        if (!finished) await output.cancel().catch(() => undefined);
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
        progress.remove();
        audio.filmAudioEnd();
        game.endFilm();
    }
}
