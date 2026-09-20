/**
 * In-match clip recorder.
 *
 * - Rolling buffer: silently keeps the last ~6s (canvas + game audio).
 * - Shift+E saves that window to Downloads.
 * - Shift+R pauses the buffer for a manual start/stop take, then resumes.
 *
 * Prefer H.264 MP4 when supported (QuickTime); else WebM. Chunk concat keeps
 * the MediaRecorder init segment plus recent media fragments.
 */

import { audio } from './audio';

export type RecordStartResult =
    | { ok: true }
    | { ok: false; reason: 'unsupported' | 'busy' | 'no-canvas' };

export type RecordStopResult = {
    filename: string;
    mimeType: string;
};

const BUFFER_SECONDS = 6;
const BUFFER_FPS = 30;
const MANUAL_FPS = 60;
const TIMESLICE_MS = 250;

function pickMime(): { mimeType: string; ext: 'mp4' | 'webm' } {
    const candidates: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
        { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
        { mimeType: 'video/mp4;codecs=avc1.4D4028,mp4a.40.2', ext: 'mp4' },
        { mimeType: 'video/mp4;codecs=avc1.64001F,mp4a.40.2', ext: 'mp4' },
        { mimeType: 'video/mp4', ext: 'mp4' },
        { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
        { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
        { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    ];
    for (const c of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) {
            return c;
        }
    }
    return { mimeType: '', ext: 'webm' };
}

function videoBitrate(width: number, height: number, fps: number): number {
    const pixels = Math.max(1, width * height);
    const target = Math.round(pixels * 0.15 * fps);
    return Math.min(48_000_000, Math.max(12_000_000, target));
}

function stampFilename(ext: string, kind: 'clip' | 'replay' = 'clip'): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return kind === 'replay' ? `melodan-replay-${stamp}.${ext}` : `melodan-${stamp}.${ext}`;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type SessionMode = 'buffer' | 'manual';

class VideoRecorder {
    private mode: SessionMode | null = null;
    private recorder: MediaRecorder | null = null;
    private videoTrack: MediaStreamTrack | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private chosenExt: 'mp4' | 'webm' = 'webm';
    private chosenMime = '';
    /** First MediaRecorder blob — container init; always kept for buffer saves. */
    private initChunk: Blob | null = null;
    private ring: { t: number; data: Blob }[] = [];
    private manualChunks: Blob[] = [];
    private stopPromise: Promise<RecordStopResult | null> | null = null;
    /** Resume rolling buffer after a manual take ends. */
    private resumeBufferAfterManual = false;

    /** True while Shift+R manual capture is active. */
    get recording(): boolean {
        return this.mode === 'manual' && this.recorder !== null && this.recorder.state === 'recording';
    }

    get buffering(): boolean {
        return this.mode === 'buffer' && this.recorder !== null && this.recorder.state === 'recording';
    }

    /** Begin (or restart) the silent last-N-seconds buffer for this match canvas. */
    startBuffer(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        if (this.mode === 'manual') {
            this.resumeBufferAfterManual = true;
            return;
        }
        this.teardownSession();
        this.beginSession('buffer', canvas, BUFFER_FPS);
    }

    /** Match teardown — drop buffer / manual without downloading. */
    stopAll(): void {
        this.resumeBufferAfterManual = false;
        this.canvas = null;
        this.teardownSession();
    }

    /**
     * Save the last `seconds` from the rolling buffer (default 6).
     * Does not stop buffering.
     */
    async saveRecent(seconds = BUFFER_SECONDS): Promise<RecordStopResult | null> {
        if (this.mode !== 'buffer' || !this.recorder || !this.initChunk) return null;
        try {
            this.recorder.requestData();
        } catch {
            /* ignore */
        }
        await new Promise<void>((r) => window.setTimeout(r, TIMESLICE_MS + 50));
        if (!this.initChunk) return null;

        const cutoff = performance.now() - seconds * 1000;
        const recent = this.ring.filter((c) => c.t >= cutoff).map((c) => c.data);
        const mime = this.recorder.mimeType || this.chosenMime || 'video/webm';
        const ext = mime.includes('mp4') ? 'mp4' : this.chosenExt;
        const blob = new Blob([this.initChunk, ...recent], { type: mime });
        if (blob.size < 512) return null;
        const filename = stampFilename(ext, 'replay');
        downloadBlob(blob, filename);
        return { filename, mimeType: mime };
    }

    /** Shift+R start — pause buffer and record until {@link stop}. */
    start(canvas: HTMLCanvasElement, fps = MANUAL_FPS): RecordStartResult {
        if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
            return { ok: false, reason: 'unsupported' };
        }
        if (!canvas.width || !canvas.height) return { ok: false, reason: 'no-canvas' };
        if (this.mode === 'manual') return { ok: false, reason: 'busy' };

        this.canvas = canvas;
        this.resumeBufferAfterManual = this.mode === 'buffer' || this.resumeBufferAfterManual;
        this.teardownSession();
        if (!this.beginSession('manual', canvas, fps)) {
            if (this.resumeBufferAfterManual && this.canvas) {
                this.beginSession('buffer', this.canvas, BUFFER_FPS);
                this.resumeBufferAfterManual = false;
            }
            return { ok: false, reason: 'unsupported' };
        }
        return { ok: true };
    }

    /** Shift+R stop — download the manual take, then resume the rolling buffer. */
    stop(): Promise<RecordStopResult | null> {
        if (this.stopPromise) return this.stopPromise;
        if (this.mode !== 'manual') return Promise.resolve(null);
        const recorder = this.recorder;
        if (!recorder || recorder.state === 'inactive') {
            this.finishManualTeardown();
            return Promise.resolve(null);
        }

        this.stopPromise = new Promise((resolve) => {
            const mime = recorder.mimeType || this.chosenMime || 'video/webm';
            const ext = mime.includes('mp4') ? 'mp4' : this.chosenExt;
            const filename = stampFilename(ext, 'clip');

            recorder.onstop = () => {
                const blob = new Blob(this.manualChunks, { type: mime });
                this.manualChunks = [];
                this.recorder = null;
                this.stopPromise = null;
                this.cleanupTracks();
                this.mode = null;
                const canvas = this.canvas;
                const resume = this.resumeBufferAfterManual;
                this.resumeBufferAfterManual = false;
                if (resume && canvas) this.beginSession('buffer', canvas, BUFFER_FPS);
                if (blob.size === 0) {
                    resolve(null);
                    return;
                }
                downloadBlob(blob, filename);
                resolve({ filename, mimeType: mime });
            };
            try {
                recorder.stop();
            } catch (err) {
                console.warn('[videoRecorder] stop failed', err);
                this.stopPromise = null;
                this.finishManualTeardown();
                resolve(null);
            }
        });
        return this.stopPromise;
    }

    /** Discard manual take (or buffer) without downloading. */
    cancel(): void {
        this.resumeBufferAfterManual = false;
        this.teardownSession();
    }

    private finishManualTeardown(): void {
        this.manualChunks = [];
        this.recorder = null;
        this.stopPromise = null;
        this.cleanupTracks();
        this.mode = null;
        const canvas = this.canvas;
        const resume = this.resumeBufferAfterManual;
        this.resumeBufferAfterManual = false;
        if (resume && canvas) this.beginSession('buffer', canvas, BUFFER_FPS);
    }

    private beginSession(mode: SessionMode, canvas: HTMLCanvasElement, fps: number): boolean {
        if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
            return false;
        }
        if (!canvas.width || !canvas.height) return false;

        audio.unlock();
        const { mimeType, ext } = pickMime();
        this.chosenMime = mimeType;
        this.chosenExt = ext;

        const bits = videoBitrate(canvas.width, canvas.height, fps);
        const video = canvas.captureStream(fps);
        const audioStream = audio.enableRecordTap();
        const stream = new MediaStream([...video.getVideoTracks(), ...audioStream.getAudioTracks()]);
        this.videoTrack = video.getVideoTracks()[0] ?? null;

        const opts: MediaRecorderOptions = {
            videoBitsPerSecond: bits,
            audioBitsPerSecond: 192_000,
        };
        if (mimeType) opts.mimeType = mimeType;

        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, opts);
        } catch (err) {
            console.warn('[videoRecorder] MediaRecorder failed', err);
            this.cleanupTracks();
            return false;
        }

        this.initChunk = null;
        this.ring = [];
        this.manualChunks = [];
        this.mode = mode;
        this.recorder = recorder;

        recorder.ondataavailable = (e) => {
            if (e.data.size === 0) return;
            if (this.mode === 'buffer') {
                if (!this.initChunk) this.initChunk = e.data;
                else {
                    const now = performance.now();
                    this.ring.push({ t: now, data: e.data });
                    this.pruneRing(now);
                }
            } else if (this.mode === 'manual') {
                this.manualChunks.push(e.data);
            }
        };

        try {
            recorder.start(TIMESLICE_MS);
        } catch (err) {
            console.warn('[videoRecorder] start failed', err);
            this.recorder = null;
            this.mode = null;
            this.cleanupTracks();
            return false;
        }

        if (mode === 'buffer') {
            console.info(
                `[videoRecorder] buffer ${BUFFER_SECONDS}s ${canvas.width}×${canvas.height}@${fps} ${(bits / 1e6).toFixed(1)}Mbps`,
            );
        } else {
            console.info(
                `[videoRecorder] manual ${canvas.width}×${canvas.height}@${fps} ${(bits / 1e6).toFixed(1)}Mbps`,
            );
        }
        return true;
    }

    private pruneRing(now: number): void {
        const cutoff = now - BUFFER_SECONDS * 1000;
        // Keep a little extra so saves aren't starved of the newest cluster.
        while (this.ring.length > 1 && this.ring[0]!.t < cutoff) this.ring.shift();
    }

    private teardownSession(): void {
        const recorder = this.recorder;
        const track = this.videoTrack;
        this.recorder = null;
        this.videoTrack = null;
        this.mode = null;
        this.initChunk = null;
        this.ring = [];
        this.manualChunks = [];
        this.stopPromise = null;

        const finish = () => {
            try {
                track?.stop();
            } catch {
                /* noop */
            }
            audio.disableRecordTap();
        };

        if (recorder && recorder.state !== 'inactive') {
            try {
                recorder.ondataavailable = null;
                recorder.onstop = finish;
                recorder.stop();
            } catch {
                finish();
            }
        } else {
            finish();
        }
    }

    private cleanupTracks(): void {
        const track = this.videoTrack;
        this.videoTrack = null;
        try {
            track?.stop();
        } catch {
            /* noop */
        }
        audio.disableRecordTap();
    }
}

/** Process-wide — one session at a time across match swaps. */
export const videoRecorder = new VideoRecorder();
