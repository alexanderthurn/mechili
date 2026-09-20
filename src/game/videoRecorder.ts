/**
 * In-match clip recorder (opt-in only — nothing runs until Shift+R):
 *
 * - Shift+R: start / stop a full take (download on stop)
 * - Shift+E while recording: save the last ~6s without stopping
 *
 * Prefer H.264 MP4 when supported (QuickTime); else WebM.
 */

import { audio } from './audio';

export type RecordStartResult =
    | { ok: true }
    | { ok: false; reason: 'unsupported' | 'busy' | 'no-canvas' };

export type RecordStopResult = {
    filename: string;
    mimeType: string;
};

const REPLAY_SECONDS = 6;
const RECORD_FPS = 60;
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

class VideoRecorder {
    private recorder: MediaRecorder | null = null;
    private videoTrack: MediaStreamTrack | null = null;
    private chosenExt: 'mp4' | 'webm' = 'webm';
    private chosenMime = '';
    /** Container init segment — required for both full and last-N saves. */
    private initChunk: Blob | null = null;
    /** Timed media fragments after the init (kept for the whole take). */
    private chunks: { t: number; data: Blob }[] = [];
    private stopPromise: Promise<RecordStopResult | null> | null = null;

    get recording(): boolean {
        return this.recorder !== null && this.recorder.state === 'recording';
    }

    /** Shift+R start. */
    start(canvas: HTMLCanvasElement, fps = RECORD_FPS): RecordStartResult {
        if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
            return { ok: false, reason: 'unsupported' };
        }
        if (this.recorder) return { ok: false, reason: 'busy' };
        if (!canvas.width || !canvas.height) return { ok: false, reason: 'no-canvas' };

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
            return { ok: false, reason: 'unsupported' };
        }

        this.initChunk = null;
        this.chunks = [];
        this.recorder = recorder;

        recorder.ondataavailable = (e) => {
            if (e.data.size === 0) return;
            if (!this.initChunk) this.initChunk = e.data;
            else this.chunks.push({ t: performance.now(), data: e.data });
        };

        try {
            recorder.start(TIMESLICE_MS);
        } catch (err) {
            console.warn('[videoRecorder] start failed', err);
            this.recorder = null;
            this.cleanupTracks();
            return { ok: false, reason: 'unsupported' };
        }

        console.info(
            `[videoRecorder] ${canvas.width}×${canvas.height}@${fps} ${(bits / 1e6).toFixed(1)}Mbps`,
        );
        return { ok: true };
    }

    /**
     * Shift+E while recording — download the last `seconds` without stopping.
     * No-op when idle.
     */
    async saveRecent(seconds = REPLAY_SECONDS): Promise<RecordStopResult | null> {
        if (!this.recording || !this.recorder || !this.initChunk) return null;
        try {
            this.recorder.requestData();
        } catch {
            /* ignore */
        }
        await new Promise<void>((r) => window.setTimeout(r, TIMESLICE_MS + 50));
        if (!this.initChunk) return null;

        const cutoff = performance.now() - seconds * 1000;
        const recent = this.chunks.filter((c) => c.t >= cutoff).map((c) => c.data);
        const mime = this.recorder.mimeType || this.chosenMime || 'video/webm';
        const ext = mime.includes('mp4') ? 'mp4' : this.chosenExt;
        const blob = new Blob([this.initChunk, ...recent], { type: mime });
        if (blob.size < 512) return null;
        const filename = stampFilename(ext, 'replay');
        downloadBlob(blob, filename);
        return { filename, mimeType: mime };
    }

    /** Shift+R stop — download the full take. */
    stop(): Promise<RecordStopResult | null> {
        if (this.stopPromise) return this.stopPromise;
        const recorder = this.recorder;
        if (!recorder || recorder.state === 'inactive') {
            this.teardown();
            return Promise.resolve(null);
        }

        this.stopPromise = new Promise((resolve) => {
            const mime = recorder.mimeType || this.chosenMime || 'video/webm';
            const ext = mime.includes('mp4') ? 'mp4' : this.chosenExt;
            const filename = stampFilename(ext, 'clip');

            recorder.onstop = () => {
                const parts: Blob[] = [];
                if (this.initChunk) parts.push(this.initChunk);
                for (const c of this.chunks) parts.push(c.data);
                const blob = new Blob(parts, { type: mime });
                this.initChunk = null;
                this.chunks = [];
                this.recorder = null;
                this.stopPromise = null;
                this.cleanupTracks();
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
                this.teardown();
                resolve(null);
            }
        });
        return this.stopPromise;
    }

    /** Match teardown — discard without downloading. */
    stopAll(): void {
        this.teardown();
    }

    private teardown(): void {
        const recorder = this.recorder;
        const track = this.videoTrack;
        this.recorder = null;
        this.videoTrack = null;
        this.initChunk = null;
        this.chunks = [];
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

/** Process-wide — one take at a time across match swaps. */
export const videoRecorder = new VideoRecorder();
