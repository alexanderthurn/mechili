# Steam graphical assets (English)

**Shipping set:** night / moon-right / back-left dragon with aerial fire / dwarfs vs knights on raised ground  
Folders: `store_center/`, `library_center/`

Style lock (h4):
- Night sky, full moon on the **right**
- Dragon in the **back left**, spitting an aerial fire arc into the empty center (does not hit units/ground)
- Left grey stone keep + red banner; right azure wizard tower + blue windows
- Raised dark grassy ground with Melodan-style chunky dwarfs vs knights
- Wordmark from `assets/ui/logo-trimmed.png` (text only, on dark ground)

Locked reference: `store_center/header_ideas/LOCKED_h4_higher_ground_units_*`

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

### Pipeline
1. Gemini for scene masters (no text in prompts)
2. ImageMagick composites logo (luma-keyed alpha from `logo-trimmed.png`)

### Notes
- Capsules: MELODAN wordmark only
- Small capsule is logo-first
- `icons/` may still be from an older generation
- Screenshots: `assets/marketing/screenshots/fullhd/`
