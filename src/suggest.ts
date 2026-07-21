/**
 * Community Suggest — posts to backend/suggest.php (file store + daily mail ping).
 */
import { isLocalhost } from './game/net';
import { prefs } from './game/prefs';

export const SUGGEST_CATEGORIES = [
    'Bug',
    'Balance',
    'Feature',
    'Models / art',
    'Community',
    'Other',
] as const;

export type SuggestCategory = (typeof SUGGEST_CATEGORIES)[number];

export type SuggestSource = 'homepage' | 'game menu';

const DISCORD_URL = 'https://discord.melodan.com';

/** Same host resolution as matchUrl() in net.ts — kept local so homepage does not pull PeerJS. */
function suggestEndpoint(): string {
    const params = new URLSearchParams(location.search);
    const override = params.get('suggest');
    if (override) return override;

    if (isLocalhost()) {
        const branch = params.get('branch');
        if (branch) {
            return `https://feuerware.com/2025/mechili/${encodeURIComponent(branch)}/backend/suggest.php`;
        }
        return 'https://play.melodan.com/backend/suggest.php';
    }

    return new URL('./backend/suggest.php', location.href).href;
}

export interface ClientSpecsOptions {
    /** homepage can skip prefs / WebGL probe */
    light?: boolean;
    phase?: string;
    round?: number | string;
    webglRenderer?: string;
}

/** Gather a short diagnostics block for bug reports. */
export function collectClientSpecs(opts: ClientSpecsOptions = {}): string {
    const lines = [
        `MELODAN v${__APP_VERSION__}`,
        `ua ${navigator.userAgent}`,
        `lang ${navigator.language}`,
        `platform ${navigator.platform}`,
        `viewport ${window.innerWidth}x${window.innerHeight}` +
            ` dpr ${window.devicePixelRatio || 1}`,
    ];
    if (!opts.light) {
        try {
            const p = prefs();
            lines.push(
                `prefs scenery=${p.scenery} ground=${p.groundEffects}` +
                    ` fire=${p.fireVfx} dprCap=${p.dprCap} shadows=${p.shadows}`,
            );
        } catch {
            /* prefs unavailable */
        }
        const gl = opts.webglRenderer ?? probeWebGlRenderer();
        if (gl) lines.push(`webgl ${gl}`);
    }
    if (opts.phase !== undefined || opts.round !== undefined) {
        lines.push(`match phase=${opts.phase ?? '?'} round=${opts.round ?? '?'}`);
    }
    return lines.join('\n');
}

function probeWebGlRenderer(): string | null {
    try {
        const canvas = document.createElement('canvas');
        const gl =
            canvas.getContext('webgl') ||
            canvas.getContext('experimental-webgl');
        if (!gl || !(gl instanceof WebGLRenderingContext)) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (!ext) return null;
        const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        return `${vendor} / ${renderer}`;
    } catch {
        return null;
    }
}

export interface SubmitSuggestInput {
    category: SuggestCategory;
    message: string;
    source: SuggestSource;
    specs?: string;
}

export async function submitSuggest(input: SubmitSuggestInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const message = input.message.trim();
    if (!message) return { ok: false, error: 'Write a short message first.' };

    try {
        const res = await fetch(`${suggestEndpoint()}?action=submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category: input.category,
                message,
                source: input.source,
                specs: input.specs ?? '',
                website: '', // honeypot
            }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
        if (res.status === 429) {
            const wait = data.retryAfter ?? 45;
            return { ok: false, error: `Too many suggestions — try again in ${wait}s.` };
        }
        if (!res.ok) {
            return { ok: false, error: data.error === 'empty message' ? 'Write a short message first.' : 'Could not send. Try again later.' };
        }
        return { ok: true };
    } catch {
        return { ok: false, error: 'Network error — try again later.' };
    }
}

export interface OpenSuggestOptions {
    parent: HTMLElement;
    source: SuggestSource;
    /** Extra specs lines (phase/round etc.). Defaults to collectClientSpecs. */
    specs?: string;
    lightSpecs?: boolean;
}

/**
 * Shared Suggest modal — category + message, then Submit to PHP store.
 */
export function openSuggest(opts: OpenSuggestOptions): void {
    if (document.querySelector('.mechili-suggest')) return;

    const specs =
        opts.specs ??
        collectClientSpecs({ light: opts.lightSpecs === true });

    const overlay = document.createElement('div');
    overlay.className = 'mechili-suggest';
    overlay.innerHTML =
        `<div class="box" role="dialog" aria-labelledby="mh-suggest-title">` +
        `<div class="s-title" id="mh-suggest-title">Send feedback</div>` +
        `<p class="s-lead">Tell us what to build, fix, or try. If you want you can add your name and email address.</p>` +
        `<p class="s-discord">Prefer chat? Join the <a href="${DISCORD_URL}" rel="noopener noreferrer" target="_blank">Discord</a> community.</p>` +
        `<label class="s-field">Category` +
        `<select class="s-cat">` +
        SUGGEST_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('') +
        `</select></label>` +
        `<label class="s-field">Message` +
        `<textarea class="s-msg" rows="6" placeholder="What should change? What broke? What would help?"></textarea></label>` +
        `<input class="s-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />` +
        `<p class="s-status" aria-live="polite"></p>` +
        `<div class="actions">` +
        `<button type="button" data-act="cancel">Cancel</button>` +
        `<button type="button" class="primary" data-act="submit">Submit</button>` +
        `</div></div>`;

    const cat = overlay.querySelector<HTMLSelectElement>('.s-cat')!;
    const msg = overlay.querySelector<HTMLTextAreaElement>('.s-msg')!;
    const hp = overlay.querySelector<HTMLInputElement>('.s-hp')!;
    const status = overlay.querySelector<HTMLElement>('.s-status')!;
    const submitBtn = overlay.querySelector<HTMLButtonElement>('[data-act="submit"]')!;

    const close = () => {
        overlay.remove();
        window.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
    submitBtn.addEventListener('click', () => {
        if (hp.value.trim() !== '') {
            status.textContent = 'Thanks — sent.';
            setTimeout(close, 600);
            return;
        }
        submitBtn.disabled = true;
        status.textContent = 'Sending…';
        void submitSuggest({
            category: cat.value as SuggestCategory,
            message: msg.value,
            source: opts.source,
            specs,
        }).then((result) => {
            if (result.ok) {
                status.textContent = 'Thanks — saved.';
                setTimeout(close, 900);
            } else {
                status.textContent = result.error;
                submitBtn.disabled = false;
            }
        });
    });

    opts.parent.appendChild(overlay);
    msg.focus();
}
