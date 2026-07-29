#!/usr/bin/env bash
# Regenerate one icon at a time into misc/icons/sheets/_regen/_solo-<id>.png
set -euo pipefail
REF="${REF:-misc/icons/src/ability-ward.png}"
SCRIPT="${HOME}/.claude/skills/threejs-image-generator/scripts/generate_image.py"
OUT="misc/icons/sheets/_regen"
mkdir -p "$OUT"

gen() {
  local id="$1"
  local subject="$2"
  echo ">>> $id"
  uv run "$SCRIPT" --input-image "$REF" --resolution 1K \
    --filename "$OUT/_solo-${id}.png" \
    --prompt "$(cat <<EOF
Create ONE isolated game UI icon. Do NOT copy the reference subject.
Use the reference ONLY for material, lighting, and stamped-relief style.
Solid flat magenta #FF00FF background.

Style: warm BROWN aged bronze/brass rounded-square tile (NOT green, NOT sage).
Deep carved emboss, top-left highlights, bottom-right shadows, matte metal, readable at 64px.
The single tile must FILL most of the frame — large, centered, one tile only.

Subject: ${subject}

STRICT:
- Exactly ONE icon tile — never two, never a sheet, never a grid, never side-by-side duplicates
- NO text, NO letters, NO digits, NO labels
- Magenta fills all empty space outside the single tile
- Fantasy medieval look — NO sci-fi, NO modern rockets, NO plastics, NO chrome UI
EOF
)" || { echo "FAIL $id"; return 1; }
}

# args: id subject pairs passed as: gen id "subject"
gen "$@"
