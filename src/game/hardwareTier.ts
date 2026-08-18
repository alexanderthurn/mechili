/**
 * Pick a graphics preset from what this machine looks capable of.
 *
 * Only ever consulted for a profile with NO stored settings — a fresh install,
 * or someone who just hit Reset. It is a starting point, never a correction:
 * once a preference exists it is the player's, and nothing here second-guesses
 * it on a later launch.
 *
 * Deliberately only ever LOWERS from the default. Every signal available in a
 * browser is coarse — a GPU name is a marketing string, deviceMemory is rounded
 * to a power of two, and neither says anything about thermals or what else is
 * running — so guessing UP would hand somebody a slideshow on evidence too weak
 * to justify it. Guessing down costs some prettiness they can undo in Settings,
 * which is the cheaper mistake.
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

function probeRenderer(): string | null {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl || !(gl instanceof WebGLRenderingContext)) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (!ext) return null;
        return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') || null;
    } catch {
        return null;
    }
}

export function probeHardware(): HardwareProbe {
    const renderer = probeRenderer();
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
        return pick('low', 'software renderer');
    }
    // Steam Deck (and its Van Gogh APU under other names). A 15 W handheld that
    // reports 8 threads and plenty of RAM would otherwise read as a desktop.
    if (/van gogh|custom gpu 0405|steam deck/.test(gpu)) {
        return pick('medium', 'Steam Deck class APU');
    }
    if (cores !== null && cores <= 2) return pick('low', `${cores} CPU threads`);
    if (memoryGb !== null && memoryGb <= 2) return pick('low', `${memoryGb} GB RAM`);
    // Intel integrated graphics, excluding Arc — those are discrete parts that
    // happen to share the vendor name.
    if (/intel/.test(gpu) && !/\barc\b/.test(gpu)) {
        return pick('medium', 'Intel integrated graphics');
    }
    if (cores !== null && cores <= 4) return pick('medium', `${cores} CPU threads`);
    if (memoryGb !== null && memoryGb <= 4) return pick('medium', `${memoryGb} GB RAM`);
    // Nothing suggested otherwise. Note this returns the DEFAULT rather than
    // 'ultra': ultra stays something a player chooses, never something a guess
    // about their machine turns on for them.
    return pick('high', 'no constraint detected');
}
