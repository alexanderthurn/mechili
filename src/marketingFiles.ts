/**
 * Marketing files in public/ — uploaded as they are, under fixed names, so
 * melodan.com/marketing/screenshots/4k/sc1.jpg stays the same address across
 * builds (editors, the README and posts can link it). Paths are relative to a
 * page at the site root (web.html, press.html). The game itself keeps Vite's
 * hashed assets; none of this is loaded by it.
 *
 * Add a screenshot: put sc<N>.jpg (3840×2160) into public/marketing/screenshots/4k,
 * make its Full HD versions (see that folder's README), raise SCREENSHOT_COUNT,
 * and give it a caption (homepage:shot.<N> in locales/<lang>/homepage.json).
 */
export const SCREENSHOT_COUNT = 9;

export const SCREENSHOT_NUMBERS: readonly number[] = Array.from({ length: SCREENSHOT_COUNT }, (_, i) => i + 1);

export const screenshotFiles = {
    /** 480×270 grid thumb — only 1–4 exist (the homepage grid) */
    thumb: (n: number) => `./marketing/screenshots/0${n}.webp`,
    fullHdWebp: (n: number) => `./marketing/screenshots/fullhd/screen_${n}.webp`,
    fullHdJpg: (n: number) => `./marketing/screenshots/fullhd/screen_${n}.jpg`,
    uhdJpg: (n: number) => `./marketing/screenshots/4k/sc${n}.jpg`,
};

/** press kit files (public/press) */
export const pressFiles = {
    logo: './press/melodan-logo.png',
    icon: './favicon-256.png',
    photo: './press/alexander-thurn.jpg',
};
