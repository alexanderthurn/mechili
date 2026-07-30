# Marketing screenshots

Shipped files (used by `web.html` / homepage):

| Slot | Source | Shipped |
| --- | --- | --- |
| Full HD grid + gallery | `fullhd/screen_N.jpg` | `fullhd/screen_N.webp` (1920×1080) |
| 4K masters (local / Steam) | `4k/scN.jpg` | `4k/scN.webp` (3840×2160) |

Homepage grid uses `screen_1`–`screen_4`; the lightbox gallery uses all eight.

Re-encode after replacing the 4K JPG masters:

```bash
for i in 1 2 3 4 5 6 7 8; do
  cwebp -q 85 -m 6 "4k/sc${i}.jpg" -o "4k/sc${i}.webp"
  magick "4k/sc${i}.jpg" -resize 1920x1080 -quality 88 "fullhd/screen_${i}.jpg"
  cwebp -q 80 -m 6 "fullhd/screen_${i}.jpg" -o "fullhd/screen_${i}.webp"
done
```
