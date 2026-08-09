#!/usr/bin/env bash
# Cap textures at N×N, re-encode WebP, then Draco-compress meshes.
# Usage: bash scripts/resize-glb-textures.sh [size]
# Requires: npx @gltf-transform/cli
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SIZE="${1:-1024}"
echo "Textures → max ${SIZE}×${SIZE} + WebP + Draco under assets/models…"
before=0
after=0
count=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in
    assets/models/spells/*/*) continue ;;
  esac
  count=$((count + 1))
  b=$(wc -c < "$f" | tr -d ' ')
  before=$((before + b))
  t1="${f}.step1.tmp.glb"
  t2="${f}.step2.tmp.glb"
  t3="${f}.step3.tmp.glb"
  npx --yes @gltf-transform/cli@4.1.1 resize "$f" "$t1" \
    --width "$SIZE" --height "$SIZE" --filter lanczos3
  npx --yes @gltf-transform/cli@4.1.1 webp "$t1" "$t2" --quality 80 --effort 60
  rm -f "$t1"
  npx --yes @gltf-transform/cli@4.1.1 draco "$t2" "$t3" \
    --method edgebreaker \
    --encode-speed 5 \
    --decode-speed 5 \
    --quantize-position 14 \
    --quantize-normal 10 \
    --quantize-texcoord 12 \
    --quantize-color 8 \
    --quantize-generic 12
  rm -f "$t2"
  mv "$t3" "$f"
  a=$(wc -c < "$f" | tr -d ' ')
  after=$((after + a))
  echo "  $f  ${b} → ${a} bytes"
done < <(find assets/models -name '*.glb' -type f | sort)

echo "Done ($count files). Total bytes: $before → $after"
