# Marketing screenshots

Shipped files (used by `web.html` / homepage):

| Slot | Source | Shipped |
| --- | --- | --- |
| Grid thumbs | `fullhd/screen_1`–`4` | `01.webp`–`04.webp` (480×270) |
| Full HD gallery | `fullhd/screen_N.jpg` | `fullhd/screen_N.webp` (1920×1080) |
| 4K masters / lightbox link | `4k/scN.jpg` | `4k/scN.webp` (3840×2160) |

Homepage grid uses small `01`–`04`; clicking opens the Full HD lightbox. The lightbox “Open 4K JPG” link points at `4k/scN.jpg`.

Re-encode after replacing the 4K JPG masters:

```bash
for i in 1 2 3 4 5 6 7 8; do
  cwebp -q 85 -m 6 "4k/sc${i}.jpg" -o "4k/sc${i}.webp"
  magick "4k/sc${i}.jpg" -resize 1920x1080 -quality 88 "fullhd/screen_${i}.jpg"
  cwebp -q 80 -m 6 "fullhd/screen_${i}.jpg" -o "fullhd/screen_${i}.webp"
done
for i in 1 2 3 4; do
  magick "fullhd/screen_${i}.jpg" -resize 480x270 -quality 85 "0${i}.jpg"
  cwebp -q 75 -m 6 "0${i}.jpg" -o "0${i}.webp"
  rm "0${i}.jpg"
done
```
