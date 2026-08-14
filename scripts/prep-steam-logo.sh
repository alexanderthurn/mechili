#!/usr/bin/env bash
# Prep Steam wordmark from masters/logo_source.jpeg (Gemini fire/lightning wordmark).
# Fallback: assets/ui/logo-trimmed.png
# See misc/steam/STYLE.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC_JPEG=misc/steam/masters/logo_source.jpeg
SRC_UI=assets/ui/logo-trimmed.png
OUT=misc/steam/masters/logo_trimmed.png

if [[ -f "$SRC_JPEG" ]]; then
  # Dark plate → transparent via corner floodfill; keep fire/lightning glow
  magick "$SRC_JPEG" -alpha set -fuzz 14% \
    -fill none \
    -draw 'color 5,5 floodfill' \
    -draw "color $(magick identify -format '%[fx:w-6]' "$SRC_JPEG"),5 floodfill" \
    -draw "color 5,$(magick identify -format '%[fx:h-6]' "$SRC_JPEG") floodfill" \
    -draw "color $(magick identify -format '%[fx:w-6]' "$SRC_JPEG"),$(magick identify -format '%[fx:h-6]' "$SRC_JPEG") floodfill" \
    -trim +repage \
    PNG32:"$OUT"
else
  [[ -f "$SRC_UI" ]] || { echo "missing $SRC_JPEG and $SRC_UI"; exit 1; }
  # Do NOT use -transparent black (punches letter cracks).
  magick "$SRC_UI" -alpha off \
    \( +clone -colorspace gray -threshold 2% \) \
    -alpha off -compose CopyOpacity -composite -trim +repage \
    PNG32:"$OUT"
fi

cp "$OUT" misc/steam/masters/logo.png
magick "$OUT" -resize '1280x720>' \
  PNG32:misc/steam/library_center/library_logo.png

magick identify "$OUT" misc/steam/library_center/library_logo.png
echo "logo ready"
