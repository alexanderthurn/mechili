#!/usr/bin/env bash
# Export Melodan Steam store_center + library_center capsules from masters.
# Style lock / prompts: misc/steam/STYLE.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LAND=misc/steam/masters/landscape_center.png
LAND_LOGO=misc/steam/masters/landscape_center_logo.png
PORT=misc/steam/masters/portrait_center.png
HERO=misc/steam/masters/hero_center.png
PBG=misc/steam/masters/page_bg_center.png
LOGO=misc/steam/masters/logo_trimmed.png
STORE=misc/steam/store_center
LIB=misc/steam/library_center

for f in "$LAND" "$PORT" "$HERO" "$PBG" "$LOGO"; do
  [[ -f "$f" ]] || { echo "missing $f"; exit 1; }
done

mkdir -p "$STORE" "$LIB" "$STORE/header_ideas"

# Landscape capsules: prefer baked Gemini logo art (O-on-moon). Fallback: Magick south overlay.
if [[ -f "$LAND_LOGO" ]]; then
  echo "header/main/small from landscape_center_logo.png (baked logo)…"
  magick "$LAND_LOGO" -resize 920x430^ -gravity center -extent 920x430 \
    PNG32:"$STORE/header_capsule.png"
  magick "$LAND_LOGO" -resize 1232x706^ -gravity center -extent 1232x706 \
    PNG32:"$STORE/main_capsule.png"
  magick "$LAND_LOGO" -resize 462x174^ -gravity center -extent 462x174 \
    PNG32:"$STORE/small_capsule.png"
else
  echo "header/main/small from landscape + Magick logo (fallback)…"
  magick "$LAND" -resize 920x430^ -gravity center -extent 920x430 \
    \( "$LOGO" -resize 680x \) -gravity south -geometry +0+22 \
    -compose over -composite PNG32:"$STORE/header_capsule.png"
  magick "$LAND" -resize 1232x706^ -gravity center -extent 1232x706 \
    \( "$LOGO" -resize 900x \) -gravity south -geometry +0+32 \
    -compose over -composite PNG32:"$STORE/main_capsule.png"
  magick -size 462x174 \
    \( "$LAND" -resize 462x174^ -gravity center -extent 462x174 -blur 0x1.2 -modulate 70,80,100 \) \
    \( "$LOGO" -resize 400x \) -gravity center \
    -compose over -composite PNG32:"$STORE/small_capsule.png"
fi

cp "$STORE/header_capsule.png" "$LIB/library_header.png"
cp "$STORE/header_capsule.png" "$STORE/header_ideas/LOCKED_h4_higher_ground_units_header.png"
cp "$LAND" "$STORE/header_ideas/LOCKED_h4_higher_ground_units_scene.png"
cp "$LAND" misc/steam/masters/landscape_center_main.png

echo "library capsule 600x900 (portrait already has baked logo)…"
magick "$PORT" -resize 600x900^ -gravity center -extent 600x900 \
  PNG32:"$LIB/library_capsule.png"

echo "vertical 748x896 (library framing → scale, baked logo)…"
magick "$PORT" \
  -resize 600x900^ -gravity center -extent 600x900 \
  -resize 748x896! \
  PNG32:"$STORE/vertical_capsule.png"
cp "$PORT" misc/steam/masters/portrait_vertical.png

echo "page background 1438x810 (no logo)…"
magick "$PBG" -resize 1438x810^ -gravity center -extent 1438x810 \
  PNG32:"$STORE/page_background.png"

echo "library hero 3840x1240 (no logo)…"
magick "$HERO" -resize 3840x1240^ -gravity center -extent 3840x1240 \
  PNG32:"$LIB/library_hero.png"

echo "library logo…"
magick "$LOGO" -resize '1280x720>' PNG32:"$LIB/library_logo.png"

echo "done:"
magick identify \
  "$STORE/header_capsule.png" \
  "$STORE/main_capsule.png" \
  "$STORE/small_capsule.png" \
  "$STORE/vertical_capsule.png" \
  "$STORE/page_background.png" \
  "$LIB/library_capsule.png" \
  "$LIB/library_header.png" \
  "$LIB/library_hero.png" \
  "$LIB/library_logo.png"
