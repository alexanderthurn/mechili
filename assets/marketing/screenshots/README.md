# Marketing screenshots

Shipped files (used by `web.html`):

| Slot | Source | Shipped |
| --- | --- | --- |
| 01 | `01.jpg` (still) | `01.webp` |
| 02 | `02.gif` (animated) | `02.webp` (animated) |
| 03 | `03.jpg` (still) | `03.webp` |
| 04 | `04.gif` (animated) | `04.webp` (animated) |
| Full HD (gallery) | `fullhd/screen_N.jpg` | `fullhd/screen_N.webp` |

Keep jpg/gif as edit masters. Re-encode after changes:

```bash
cwebp -q 82 -m 6 01.jpg -o 01.webp
cwebp -q 82 -m 6 03.jpg -o 03.webp
gif2webp -q 50 -m 6 -lossy -min_size 02.gif -o 02.webp
gif2webp -q 50 -m 6 -lossy -min_size 04.gif -o 04.webp
for f in fullhd/screen_*.jpg; do cwebp -q 80 -m 6 "$f" -o "${f%.jpg}.webp"; done
```
