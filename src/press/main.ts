/**
 * Press kit page (press.html): the texts are plain HTML there; this fills in
 * the screenshot gallery, the download links, and a click-to-load trailer (no
 * YouTube request until the visitor asks for it). All files are fixed paths in
 * public/ (see marketingFiles.ts); the ZIP comes from backend/press.php.
 */
import './press.css';
import { pressFiles, SCREENSHOT_NUMBERS, screenshotFiles } from '../marketingFiles';

/** the current trailer — change it here for the next one */
const TRAILER_YOUTUBE_ID = 'GFsskMER_mM';

function renderShots(): void {
    const root = document.getElementById('pk-shots');
    if (!root) return;
    root.innerHTML = SCREENSHOT_NUMBERS.map(
        (n) =>
            `<a class="pk-shot" href="${screenshotFiles.uhdJpg(n)}" download="melodan-screenshot-${n}.jpg" title="Download 4K JPG">` +
            `<img src="${screenshotFiles.fullHdWebp(n)}" alt="Melodan screenshot ${n}" loading="lazy" width="1920" height="1080" />` +
            `</a>`,
    ).join('');
}

function wireDownloads(): void {
    const urls: Record<string, string> = pressFiles;
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-asset]')) {
        const url = urls[a.dataset.asset ?? ''];
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
    box.style.backgroundImage = `url(${screenshotFiles.fullHdWebp(1)})`;
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
