# Marketing screenshots

Lives in `public/`, so every file ships under its own name: `melodan.com/marketing/screenshots/4k/sc1.jpg`
stays the same address across builds. Used by the homepage (`web.html`), the press kit (`press.html`,
`backend/press.php`), the GitHub README and `scripts/steam_assets.html`. Paths in code: `src/marketingFiles.ts`.

**Adding one:** drop `4k/sc<N>.jpg` (3840×2160), run the re-encode below, raise `SCREENSHOT_COUNT` in
`src/marketingFiles.ts`, and add its caption `homepage:shot.<N>` to `locales/*/homepage.json`.

Shipped files:

| Slot | Source | Shipped |
| --- | --- | --- |
| Grid thumbs | `fullhd/screen_1`–`4` | `01.webp`–`04.webp` (480×270) |
| Full HD gallery | `fullhd/screen_N.jpg` | `fullhd/screen_N.webp` (1920×1080) |
| 4K masters / lightbox link, press kit | `4k/scN.jpg` | `4k/scN.jpg` (3840×2160, no WebP: nothing uses one) |

Homepage grid uses small `01`–`04`; clicking opens the Full HD lightbox. The lightbox “Open 4K JPG” link points at `4k/scN.jpg`.

Re-encode after replacing the 4K JPG masters:

```bash
for i in 1 2 3 4 5 6 7 8 9; do
  magick "4k/sc${i}.jpg" -resize 1920x1080 -quality 88 "fullhd/screen_${i}.jpg"
  cwebp -q 80 -m 6 "fullhd/screen_${i}.jpg" -o "fullhd/screen_${i}.webp"
done
for i in 1 2 3 4; do
  magick "fullhd/screen_${i}.jpg" -resize 480x270 -quality 85 "0${i}.jpg"
  cwebp -q 75 -m 6 "0${i}.jpg" -o "0${i}.webp"
  rm "0${i}.jpg"
done
```
