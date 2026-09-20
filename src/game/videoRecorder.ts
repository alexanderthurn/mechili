/**
 * Short in-match clip recorder: Three canvas + game audio → local download.
 *
 * Prefer H.264 MP4 when the browser supports it (QuickTime / Mac Finder).
 * Fall back to WebM (Chrome / VLC) when MP4 MediaRecorder isn't available.
 * The `<a download>` path lands in the Mac Downloads folder by default.
 */

import { audio } from './audio';

export type RecordStartResult =
    | { ok: true }
    | { ok: false; reason: 'unsupported' | 'busy' | 'no-canvas' };

export type RecordStopResult = {
    filename: string;
    mimeType: string;
};

function pickMime(): { mimeType: string; ext: 'mp4' | 'webm' } {
    // Prefer High/Main H.264 over Baseline (avc1.42E01E) — Baseline looks muddy
    // on busy game frames. QuickTime still plays High profile fine on modern Macs.
    // VP9 WebM is often sharper than low-bitrate MP4 when MP4 isn't available.
    const candidates: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
        { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' }, // High@4.0
        { mimeType: 'video/mp4;codecs=avc1.4D4028,mp4a.40.2', ext: 'mp4' }, // Main@4.0
        { mimeType: 'video/mp4;codecs=avc1.64001F,mp4a.40.2', ext: 'mp4' }, // High@3.1
        { mimeType: 'video/mp4', ext: 'mp4' },
        { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
        { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
        // Baseline last — only if nothing better is offered
        { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    ];
    for (const c of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) {
            return c;
        }
    }
    return { mimeType: '', ext: 'webm' };
}

/** Scale encode bitrate to the canvas backing store (Retina can be 2–3× CSS pixels). */
function videoBitrate(width: number, height: number, fps: number): number {
    const pixels = Math.max(1, width * height);
    // ~0.15 bits/pixel/frame keeps game detail; floor/ceiling avoid tiny/huge files.
    const target = Math.round(pixels * 0.15 * fps);
    return Math.min(48_000_000, Math.max(16_000_000, target));
}

function stampFilename(ext: string): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `melodan-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

/** Trigger a browser/Electron download into the user's Downloads folder. */
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
    // Revoke after the download has a chance to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

class VideoRecorder {
    private recorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private videoTrack: MediaStreamTrack | null = null;
    private stopPromise: Promise<RecordStopResult | null> | null = null;
    private chosenExt: 'mp4' | 'webm' = 'webm';
    private chosenMime = '';

    get recording(): boolean {
        return this.recorder !== null && this.recorder.state === 'recording';
    }

    start(canvas: HTMLCanvasElement, fps = 60): RecordStartResult {
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
        const tracks = [...video.getVideoTracks(), ...audioStream.getAudioTracks()];
        const stream = new MediaStream(tracks);
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
            this.videoTrack?.stop();
            this.videoTrack = null;
            audio.disableRecordTap();
            return { ok: false, reason: 'unsupported' };
        }

        console.info(
            `[videoRecorder] ${canvas.width}×${canvas.height}@${fps} ${(bits / 1e6).toFixed(1)}Mbps ${recorder.mimeType || mimeType || 'default'}`,
        );

        this.chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.chunks.push(e.data);
        };
        this.recorder = recorder;
        try {
            // Smaller timeslice → encoder gets steadier rate control (less blocky spikes).
            recorder.start(250);
        } catch (err) {
            console.warn('[videoRecorder] start failed', err);
            this.recorder = null;
            this.videoTrack?.stop();
            this.videoTrack = null;
            audio.disableRecordTap();
            return { ok: false, reason: 'unsupported' };
        }
        return { ok: true };
    }

    /** Stop, download to Downloads, and return the filename (or null if nothing to save). */
    stop(): Promise<RecordStopResult | null> {
        if (this.stopPromise) return this.stopPromise;
        const recorder = this.recorder;
        if (!recorder || recorder.state === 'inactive') {
            this.cleanupTracks();
            return Promise.resolve(null);
        }

        this.stopPromise = new Promise((resolve) => {
            const mime = recorder.mimeType || this.chosenMime || 'video/webm';
            const ext = mime.includes('mp4') ? 'mp4' : this.chosenExt;
            const filename = stampFilename(ext);

            recorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: mime });
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
                this.recorder = null;
                this.stopPromise = null;
                this.cleanupTracks();
                resolve(null);
            }
        });
        return this.stopPromise;
    }

    /** Discard without downloading (e.g. match teardown mid-clip). */
    cancel(): void {
        const recorder = this.recorder;
        this.recorder = null;
        this.chunks = [];
        this.stopPromise = null;
        if (recorder && recorder.state !== 'inactive') {
            try {
                recorder.ondataavailable = null;
                recorder.onstop = () => this.cleanupTracks();
                recorder.stop();
            } catch {
                this.cleanupTracks();
            }
        } else {
            this.cleanupTracks();
        }
    }

    private cleanupTracks(): void {
        try {
            this.videoTrack?.stop();
        } catch {
            /* noop */
        }
        this.videoTrack = null;
        audio.disableRecordTap();
    }
}

/** Process-wide — one clip at a time across match swaps. */
export const videoRecorder = new VideoRecorder();
