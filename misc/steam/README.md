# Steam graphical assets (English)

**Shipping set (2026-08-14):** `a3-wall-moon-storm` — red/blue split, center moon, curtain wall, dragon + Komtur, teal storm on the right  
**Wordmark:** `masters/logo_trimmed.png` from `newlogoonly` / `logo_source.jpeg` (fire|lightning, transparent)  
Folders: `store_center/`, `library_center/`

**Prompts, masters split, export commands, lessons:** see **[STYLE.md](./STYLE.md)**.

Quick regen after editing masters:

```bash
bash scripts/prep-steam-logo.sh      # if logo-trimmed.png changed (library_logo / Magick fallback)
bash scripts/export-steam-center.sh  # rebuild Steam sizes
```

## Style lock (short)

- Night; **moon center**; left **red** / right **blue-teal**; low wall keep→tower; dragon left, Komtur right; storm/lightning on the **right half**
- **No-logo master:** `masters/landscape_center.png` → page background, library hero
- **Logo master:** `masters/landscape_center_logo.png` (Gemini `testwithlogo`) → header / main / small / library header (O on moon)
- Do **not** put the wordmark on hero or page background

Locked scene/header copies: `store_center/header_ideas/LOCKED_h4_higher_ground_units_*` (names legacy; content is a3)

## Upload checklist

### Store (`store_center/`)
| File | Size | Steam slot | Source |
| --- | --- | --- | --- |
| `header_capsule.png` | 920×430 | Header Capsule * | logo art |
| `small_capsule.png` | 462×174 | Small Capsule * | logo art |
| `main_capsule.png` | 1232×706 | Main Capsule * | logo art |
| `vertical_capsule.png` | 748×896 | Vertical Capsule * | portrait crop + wordmark |
| `page_background.png` | 1438×810 | Page Background | no-logo landscape |

### Library (`library_center/`)
| File | Size | Steam slot | Source |
| --- | --- | --- | --- |
| `library_capsule.png` | 600×900 | Library Capsule * | portrait crop + wordmark |
| `library_header.png` | 920×430 | Library Header * | = header |
| `library_hero.png` | 3840×1240 | Library Hero * | no-logo (cover-crop; Gemini later if needed) |
| `library_logo.png` | transparent wordmark | Library Logo * | wordmark only |

Prefer Library Logo **bottom-left** over the hero in Steamworks.

### Masters (`masters/`)
- `landscape_center.png` / `landscape_center_main.png` — **no logo**
- `landscape_center_logo.png` — **baked logo** (Gemini)
- `portrait_center.png` / `portrait_vertical.png` — cover-crop from a3 landscape
- `hero_center.png` / `page_bg_center.png` — no logo
- `logo_source.jpeg` / `logo_trimmed.png` / `logo.png` — general Magick wordmark

### Notes
- Capsules: MELODAN wordmark only
- Small capsule is logo-first
- Trial folder: `store_center/header_ideas/darker_trials_2026-08-14/`
- `icons/` may still be from an older generation
- Screenshots: `assets/marketing/screenshots/fullhd/`
