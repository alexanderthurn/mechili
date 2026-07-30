#!/usr/bin/env bash
# Prep Steam wordmark from assets/ui/logo-trimmed.png
# See assets/marketing/steam/STYLE.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC=assets/ui/logo-trimmed.png
OUT=assets/marketing/steam/masters/logo_trimmed.png
[[ -f "$SRC" ]] || { echo "missing $SRC"; exit 1; }

# Do NOT use -transparent black (punches letter cracks).
magick "$SRC" -alpha off \
  \( +clone -colorspace gray -threshold 2% \) \
  -alpha off -compose CopyOpacity -composite -trim +repage \
  PNG32:"$OUT"

cp "$OUT" assets/marketing/steam/masters/logo.png
magick "$OUT" -resize '1280x720>' \
  PNG32:assets/marketing/steam/library_center/library_logo.png

magick identify "$OUT" assets/marketing/steam/library_center/library_logo.png
echo "logo ready"
