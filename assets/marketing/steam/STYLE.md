# Melodan Steam art style lock

**Style name:** `h4-night-units-aerial-fire`  
**Locked:** 2026-07-30  
**Shipping folders:** `store_center/`, `library_center/`  
**Locked scene:** `store_center/header_ideas/LOCKED_h4_higher_ground_units_scene.png`  
**Locked header:** `store_center/header_ideas/LOCKED_h4_higher_ground_units_header.png`  
**Landscape master:** `masters/landscape_center.png` (= locked scene)  
**Logo source:** `assets/ui/logo-trimmed.png` (text only — no axe/arrow mark)  
**Tool:** Gemini via `threejs-image-generator`

Upload sizes / checklist: see [README.md](./README.md).

---

## Style lock (visual)

- Night sky, deep indigo / purple
- **Full moon on the RIGHT**
- **Dragon in the BACK LEFT** — not a huge center hero
- Dragon spits a **dramatic aerial fire arc** into the empty CENTER sky
- Fire must **NOT** hit units or ground
- LEFT: grey stone keep + red banner
- RIGHT: azure / teal conical-roof wizard tower + glowing blue windows
- Raised dark grassy ground with Melodan-style **chunky dwarfs vs knights** (toy-like game units, readable silhouettes)
- Wordmark sits on **dark ground** (higher soil band on landscape; thin band on portrait)
- Darker grounded materials — NOT bright comic low-poly cel look
- Capsules: **logo only** (no quotes, awards, UI chrome)

---

## Exact prompts (copy these)

Use:

```bash
uv run ~/.claude/skills/threejs-image-generator/scripts/generate_image.py \
  --input-image <REF> \
  --prompt "…" \
  --filename <OUT> \
  --resolution 2K   # or 4K for hero
```

Prefer `--input-image` = locked scene or current landscape master so style stays consistent.  
**Never** put text / logos / UI in the prompt — logo is composited later with ImageMagick.

### Shared style block

```text
Match EXACTLY this Melodan LOCKED h4 style: night sky, FULL MOON on the RIGHT, dragon in the BACK LEFT sky spitting a dramatic aerial fire arc into the empty CENTER (fire must NOT hit units or ground), LEFT grey stone keep with red banner, RIGHT azure wizard tower with glowing blue windows, raised dark grassy ground with Melodan-style chunky dwarfs vs knights facing off, darker grounded materials. No text, logos, UI, watermarks.
```

### Landscape (header / main / small / library header)

```text
Create / revise Melodan Steam HEADER / landscape key art (wide ~2:1).

Match EXACTLY this Melodan LOCKED h4 style: night sky, FULL MOON on the RIGHT, dragon in the BACK LEFT sky spitting a dramatic aerial fire arc into the empty CENTER (fire must NOT hit units or ground), LEFT grey stone keep with red banner, RIGHT azure wizard tower with glowing blue windows, raised dark grassy ground with Melodan-style chunky dwarfs vs knights facing off, darker grounded materials. No text, logos, UI, watermarks.

COMPOSITION: Raise the dark grassy GROUND / soil line so the dark foreground band is about the bottom 35–40%. Units sit on that higher ground above where a large logo will go. Quiet dark soil across the full width under the logo. Wide cinematic Steam header framing.
```

Save as: `masters/landscape_center.png` (also copy to `landscape_center_main.png` and update LOCKED files if this becomes the new lock).

### Portrait (library capsule)

```text
Create a TIGHT tall PORTRAIT Steam library capsule (~2:3) for Melodan. Pack the scene densely — minimal empty space.

Match EXACTLY this Melodan LOCKED h4 style: night sky, FULL MOON on the RIGHT, dragon in the BACK LEFT sky spitting a dramatic aerial fire arc into the empty CENTER (fire must NOT hit units or ground), LEFT grey stone keep with red banner, RIGHT azure wizard tower with glowing blue windows, Melodan-style chunky dwarfs vs knights. No text, logos, UI, watermarks.

COMPOSITION (critical):
- Top ~55%: sky + moon + dragon + fire (close together, not huge empty sky)
- Mid ~30%: towers + unit clash, fairly large and readable
- Bottom ~15% only: thin dark ground strip for logo — NO tall dirt wall / cutaway, NO huge empty grass foreground
Think movie poster: action fills the frame, small quiet band at bottom for title.
```

Save as: `masters/portrait_center.png`

### Ultra-wide hero (library hero)

```text
Recompose into an ULTRA-WIDE Library Hero banner (~3.1:1).

Match EXACTLY this Melodan LOCKED h4 style: night sky, FULL MOON on the RIGHT, dragon in the BACK LEFT sky spitting a dramatic aerial fire arc into the empty CENTER (fire must NOT hit units or ground), LEFT grey stone keep with red banner, RIGHT azure wizard tower with glowing blue windows, raised dark grassy ground with Melodan-style chunky dwarfs vs knights. No text, logos, UI, watermarks.

Opposing towers left/right, dragon back-left with aerial center fire, units on raised ground across the wide midfield. Moon visible right. NO logo, NO text. Subjects in center safe band.
```

Save as: `masters/hero_center.png` at **4K**.

### Page background

```text
Create a Steam PAGE BACKGROUND plate in the same locked h4 style.

Match EXACTLY this Melodan LOCKED h4 style: night sky, FULL MOON on the RIGHT, dragon in the BACK LEFT sky spitting a dramatic aerial fire arc into the empty CENTER (fire must NOT hit units or ground), LEFT grey stone keep with red banner, RIGHT azure wizard tower with glowing blue windows, raised dark grassy ground with Melodan-style chunky dwarfs vs knights. No text, logos, UI, watermarks.

Slightly calmer wider framing; keep night moon, back-left dragon with aerial fire, both towers, dwarfs vs knights on raised ground. Landscape ~16:9.
```

Save as: `masters/page_bg_center.png`

---

## Logo prep (do this once / when logo changes)

**Do NOT** use `magick … -transparent black` — it punches holes through dark cracks in the letters.

```bash
# Luma-key: only near-pure black → transparent; letter faces stay solid
magick assets/ui/logo-trimmed.png -alpha off \
  \( +clone -colorspace gray -threshold 2% \) \
  -alpha off -compose CopyOpacity -composite -trim +repage \
  PNG32:assets/marketing/steam/masters/logo_trimmed.png

cp assets/marketing/steam/masters/logo_trimmed.png \
   assets/marketing/steam/masters/logo.png

magick assets/marketing/steam/masters/logo_trimmed.png -resize '1280x720>' \
  PNG32:assets/marketing/steam/library_center/library_logo.png
```

---

## Export all Steam sizes

From repo root, after masters exist:

```bash
bash scripts/export-steam-center.sh
```

Or manually (sizes / logo placement locked here):

| Output | Size | Master | Logo |
| --- | --- | --- | --- |
| `store_center/header_capsule.png` | 920×430 | landscape | ~680px wide, south +22 |
| `library_center/library_header.png` | 920×430 | = header | copy of header |
| `store_center/main_capsule.png` | 1232×706 | landscape | ~900px, south +32 |
| `store_center/small_capsule.png` | 462×174 | landscape blurred/darkened | ~400px, center |
| `store_center/vertical_capsule.png` | 748×896 | portrait via **library framing** | see script |
| `store_center/page_background.png` | 1438×810 | page_bg | none |
| `library_center/library_capsule.png` | 600×900 | portrait center-cover | ~460px, south +22 |
| `library_center/library_hero.png` | 3840×1240 | hero | none |

**Vertical capsule rule:** do **not** cover-crop portrait directly to 748×896 (wider aspect eats the library look). Instead: same 600×900 center crop as library, then `-resize 748x896!`, then logo.

---

## Lessons learned

1. **Logo alpha:** global `-transparent black` destroys letter cracks; use 2% gray threshold CopyOpacity.
2. **Portrait ground:** Gemini loves huge dirt cutaways on tall images — prompt hard against “dirt wall / cross-section”; keep ~15% soil strip.
3. **Vertical ≠ library aspect:** matching library means clone the 2:3 crop then scale, not a fresh cover-crop.
4. **Header logo size:** large wordmark needs dark ground under it; aerial fire must stay above units.
5. **Alternates:** keep only LOCKED refs under `header_ideas/`; wipe discarded mood variants to avoid clutter.

---

## Quick change recipes

**Tweak fire only (keep rest):**

```text
Edit ONLY the dragon fire. Keep all else identical. No text/logos/UI.
[describe fire change — e.g. softer / straighter / stronger curl]
Fire stays in the air only — does not hit units or ground.
```

Input: current `landscape_center.png` → overwrite → re-run `scripts/export-steam-center.sh`.

**Tweak units / ground height:** edit landscape with a clear “raise/lower soil band” instruction → export.

**New logo file:** replace `assets/ui/logo-trimmed.png` → re-run logo prep → export.
