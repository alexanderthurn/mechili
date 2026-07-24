# Steam graphical assets (English)

Two parallel sets (same logo, 1v1 two-base layout):

| Set | Dragon | Folders |
| --- | --- | --- |
| **Side dragon** | Flies in from the right | `store/`, `library/`, masters without `_center` |
| **Center dragon** | Flies toward camera from midfield; **golden-hour** look | `store_center/`, `library_center/`, `*_center.png` masters |

Center main capsule variants (explorations) live in `store_center/main_variants/` — shipping set uses **v2 golden hour**.

### Archived / alternate sets
| Folder | Style | Contents |
| --- | --- | --- |
| `golden/` | Golden-hour center set (archive) | `store/`, `library/`, `masters/` |
| `epic/` | Epic daylight center set + variants | Full `store/` + `library/` from **a_max_punch**; more main capsules in `epic/variants/` |

## Upload checklist (same filenames in each set)

### Store (`store/` or `store_center/`)
| File | Size | Steam slot |
| --- | --- | --- |
| `header_capsule.png` | 920×430 | Header Capsule * |
| `small_capsule.png` | 462×174 | Small Capsule * |
| `main_capsule.png` | 1232×706 | Main Capsule * |
| `vertical_capsule.png` | 748×896 | Vertical Capsule * |
| `page_background.png` | 1438×810 | Page Background |

### Library (`library/` or `library_center/`)
| File | Size | Steam slot |
| --- | --- | --- |
| `library_capsule.png` | 600×900 | Library Capsule * |
| `library_header.png` | 920×430 | Library Header * |
| `library_hero.png` | 3840×1240 | Library Hero * (no logo) |
| `library_logo.png` | 1280×420 | Library Logo * (transparent) |

In Steamworks Library Logo placement tool, prefer **bottom-left** over the hero.

### Masters (`masters/`)
- Side: `landscape.png`, `portrait.png`, `hero.png`, `logo.png`
- Center: `landscape_center.png`, `portrait_center.png`, `hero_center.png`
- History: `landscape_v1_td.png`, `landscape_v2_side_dragon.png`, `landscape_v3_center_dragon.png`

## Notes
- Capsules include the MELODAN logo only (no quotes/awards).
- Small capsule is logo-first for tiny list thumbnails.
- Screenshots: use `assets/marketing/screenshots/fullhd/` separately.
