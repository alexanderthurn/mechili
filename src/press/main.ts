/**
 * Press kit page (press.html): the texts are plain HTML there; this fills in
 * what needs bundled asset URLs — the screenshot gallery (every 4K shot in
 * assets/marketing/screenshots/4k, so new ones show up by themselves), the
 * download links, and a click-to-load trailer (no YouTube request until the
 * visitor asks for it).
 */
import './press.css';

/** the current trailer — change it here for the next one */
const TRAILER_YOUTUBE_ID = 'GFsskMER_mM';

const shots4k = import.meta.glob('../../assets/marketing/screenshots/4k/sc*.jpg', {
    eager: true,
    query: '?url',
    import: 'default',
}) as Record<string, string>;
const shotsHd = import.meta.glob('../../assets/marketing/screenshots/fullhd/screen_*.webp', {
    eager: true,
    query: '?url',
    import: 'default',
}) as Record<string, string>;

const assets: Record<string, string> = {
    logo: new URL('../../assets/ui/logo-trimmed.png', import.meta.url).href,
    icon: new URL('../../public/favicon-256.png', import.meta.url).href,
    photo: new URL('../../assets/press/alexander-thurn.jpg', import.meta.url).href,
};

const numberOf = (path: string): number => Number(/(\d+)\.\w+$/.exec(path)?.[1] ?? 0);

function renderShots(): void {
    const root = document.getElementById('pk-shots');
    if (!root) return;
    const hdByN = new Map(Object.entries(shotsHd).map(([p, url]) => [numberOf(p), url]));
    const shots = Object.entries(shots4k)
        .map(([p, url]) => ({ n: numberOf(p), full: url, preview: hdByN.get(numberOf(p)) ?? url }))
        .sort((a, b) => a.n - b.n);
    root.innerHTML = shots
        .map(
            (s) =>
                `<a class="pk-shot" href="${s.full}" download="melodan-screenshot-${s.n}.jpg" title="Download 4K JPG">` +
                `<img src="${s.preview}" alt="Melodan screenshot ${s.n}" loading="lazy" width="1920" height="1080" />` +
                `</a>`,
        )
        .join('');
}

function wireDownloads(): void {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-asset]')) {
        const url = assets[a.dataset.asset ?? ''];
        if (!url) continue;
        a.href = url;
        if (a.dataset.name) a.download = a.dataset.name;
    }
}

function wireTrailer(): void {
    const box = document.getElementById('pk-trailer');
    const play = box?.querySelector('button');
    if (!box || !play) return;
    // a poster of our own: YouTube's thumbnail would contact Google before the click
    const poster = Object.entries(shotsHd).sort(([a], [b]) => numberOf(a) - numberOf(b))[0]?.[1];
    if (poster) box.style.backgroundImage = `url(${poster})`;
    play.addEventListener('click', () => {
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0`;
        iframe.title = 'Melodan – Gameplay Trailer';
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        iframe.allowFullscreen = true;
        box.replaceChildren(iframe);
    });
}

renderShots();
wireDownloads();
wireTrailer();
