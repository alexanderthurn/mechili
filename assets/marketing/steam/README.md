# Steam graphical assets (English)

**Shipping set:** `h4-night-units-aerial-fire`  
Folders: `store_center/`, `library_center/`

**Prompts, logo prep, export commands, lessons:** see **[STYLE.md](./STYLE.md)** (same idea as `misc/icons/STYLE.md`).

Quick regen after editing masters:

```bash
bash scripts/prep-steam-logo.sh      # if logo-trimmed.png changed
bash scripts/export-steam-center.sh  # rebuild all Steam sizes
```

## Style lock (short)

- Night, full moon **right**, dragon **back-left** with aerial center fire (not hitting units/ground)
- Left keep + red banner; right azure wizard tower
- Chunky dwarfs vs knights on raised dark ground
- Wordmark: `assets/ui/logo-trimmed.png` on dark ground

Locked refs: `store_center/header_ideas/LOCKED_h4_higher_ground_units_*`

## Upload checklist

### Store (`store_center/`)
| File | Size | Steam slot |
| --- | --- | --- |
| `header_capsule.png` | 920×430 | Header Capsule * |
| `small_capsule.png` | 462×174 | Small Capsule * |
| `main_capsule.png` | 1232×706 | Main Capsule * |
| `vertical_capsule.png` | 748×896 | Vertical Capsule * |
| `page_background.png` | 1438×810 | Page Background |

### Library (`library_center/`)
| File | Size | Steam slot |
| --- | --- | --- |
| `library_capsule.png` | 600×900 | Library Capsule * |
| `library_header.png` | 920×430 | Library Header * |
| `library_hero.png` | 3840×1240 | Library Hero * (no logo) |
| `library_logo.png` | transparent wordmark | Library Logo * |

Prefer Library Logo **bottom-left** over the hero in Steamworks.

### Masters (`masters/`)
- `landscape_center.png` / `landscape_center_main.png`
- `portrait_center.png` / `portrait_vertical.png`
- `hero_center.png`
- `page_bg_center.png`
- `logo_trimmed.png` / `logo.png`

### Notes
- Capsules: MELODAN wordmark only
- Small capsule is logo-first
- `icons/` may still be from an older generation
- Screenshots: `assets/marketing/screenshots/fullhd/`
