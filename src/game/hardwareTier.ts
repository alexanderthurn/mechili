/**
 * Pick a graphics preset from what this machine looks capable of.
 *
 * Only ever consulted for a profile with NO stored settings — a fresh install,
 * or someone who just hit Reset. It is a starting point, never a correction:
 * once a preference exists it is the player's, and nothing here second-guesses
 * it on a later launch.
 *
 * Desktop default is Medium (full world detail, no bloom / AO / vignette).
 * High (cinematic post) is only raised into when the GPU name clearly looks
 * like a strong discrete part — RTX 30-series+ or RX 6000+. Guessing up on
 * weaker evidence would hand somebody a slideshow; unknown / Apple Silicon /
 * iGPUs stay on Medium (or lower when other signals force it). Ultra is never
 * auto-selected.
 */

import type { GraphicsPreset } from './prefs';

/** what the probe saw, for the debug overlay and support questions */
export interface HardwareProbe {
    preset: GraphicsPreset;
    renderer: string | null;
    cores: number | null;
    memoryGb: number | null;
    reason: string;
}

interface GlProbe {
    /** null on iOS, where Safari strips WEBGL_debug_renderer_info entirely */
    renderer: string | null;
    /** a decent age/capability proxy: ~4096 on old parts, 16384 on modern ones */
    maxTexture: number;
    webgl2: boolean;
}

function probeGl(): GlProbe {
    const out: GlProbe = { renderer: null, maxTexture: 0, webgl2: false };
    try {
        const canvas = document.createElement('canvas');
        out.webgl2 = !!canvas.getContext('webgl2');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl || !(gl instanceof WebGLRenderingContext)) return out;
        out.maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) out.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') || null;
    } catch {
        /* no WebGL at all — the caller's floor applies */
    }
    return out;
}

/**
 * Strong discrete GPUs that can usually sustain High (bloom + AO).
 * Floors, not a fixed generation list: later RTX / RX series with the same
 * naming scheme qualify automatically. Unknown names do not.
 *
 * - NVIDIA: GeForce / Quadro RTX series number ≥ 3000 (30xx+)
 * - AMD: Radeon RX series number ≥ 6000 (RDNA2+)
 * Apple Silicon is intentionally excluded — High is playable on M-series but
 * post FX stay opt-in.
 */
export function isStrongDiscreteGpu(renderer: string | null | undefined): boolean {
    const gpu = (renderer ?? '').toLowerCase();
    if (!gpu) return false;

    // "rtx 3080", "rtx 4090", "rtx a4500", "rtxa4000"
    const rtx = gpu.match(/\brtx\s*a?\s*(\d{3,5})\b/) ?? gpu.match(/\brtxa(\d{4})\b/);
    if (rtx) {
        const n = Number(rtx[1]);
        if (Number.isFinite(n) && n >= 3000) return true;
    }

    // "rx 6800", "rx 7900", "rx 9060" (future-ish same pattern)
    const rx = gpu.match(/\brx\s*(\d{4})\b/);
    if (rx) {
        const n = Number(rx[1]);
        if (Number.isFinite(n) && n >= 6000) return true;
    }

    return false;
}

/**
 * Starting preset for a phone or tablet.
 *
 * Model detection is not available where it would matter most: Safari strips
 * the renderer string, so every iPhone reports the same thing, and iOS has no
 * deviceMemory. What IS readable is what the GPU can actually do — WebGL2
 * support and the maximum texture size — and that separates hardware from
 * roughly 2018 onward from what came before, on both platforms, without
 * needing to know the model at all.
 *
 * Never raises to High: mobile does not get cinematic post by default.
 */
export function probeMobile(): HardwareProbe {
    const gl = probeGl();
    const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
    const modern = gl.webgl2 && gl.maxTexture >= 8192 && (cores === null || cores >= 4);
    return {
        preset: modern ? 'low' : 'minimal',
        renderer: gl.renderer,
        cores,
        memoryGb: null,
        reason: modern
            ? `modern mobile GPU (WebGL2, ${gl.maxTexture}px textures)`
            : `older mobile GPU (WebGL2=${gl.webgl2}, ${gl.maxTexture}px textures)`,
    };
}

export function probeHardware(): HardwareProbe {
    const renderer = probeGl().renderer;
    const gpu = (renderer ?? '').toLowerCase();
    const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
    const memoryGb = typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number'
        ? (navigator as { deviceMemory?: number }).deviceMemory!
        : null;

    const pick = (preset: GraphicsPreset, reason: string): HardwareProbe =>
        ({ preset, renderer, cores, memoryGb, reason });

    // No hardware acceleration at all: the GPU is a CPU pretending. Anything
    // above the floor is unplayable here, and this is the one case where the
    // signal is unambiguous rather than a guess.
    if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) {
        return pick('minimal', 'software renderer');
    }
    // Steam Deck (and its Van Gogh APU under other names). A 15 W handheld that
    // reports 8 threads and plenty of RAM would otherwise read as a desktop.
    if (/van gogh|custom gpu 0405|steam deck/.test(gpu)) {
        return pick('low', 'Steam Deck class APU');
    }
    if (cores !== null && cores <= 2) return pick('minimal', `${cores} CPU threads`);
    if (memoryGb !== null && memoryGb <= 2) return pick('minimal', `${memoryGb} GB RAM`);
    // Intel integrated graphics, excluding Arc — those are discrete parts that
    // happen to share the vendor name. Arc is not in the High allowlist either;
    // it falls through to Medium like other non-RTX/RX parts.
    if (/intel/.test(gpu) && !/\barc\b/.test(gpu)) {
        return pick('low', 'Intel integrated graphics');
    }
    // Soft constraints: former "Medium" world cost — new Low. Do not raise to
    // High on these machines even if the GPU name looks strong (thin laptops).
    if (cores !== null && cores <= 4) return pick('low', `${cores} CPU threads`);
    if (memoryGb !== null && memoryGb <= 4) return pick('low', `${memoryGb} GB RAM`);

    if (isStrongDiscreteGpu(renderer)) {
        return pick('high', 'strong discrete GPU (RTX 30+/RX 6000+)');
    }

    // Desktop default: full world detail, no expensive post.
    // Ultra stays something a player chooses, never something a guess turns on.
    return pick('medium', 'default desktop (no strong GPU match)');
}
