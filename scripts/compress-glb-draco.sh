#!/usr/bin/env bash
# Compress game GLBs with Draco (KHR_draco_mesh_compression).
# Requires network once for npx @gltf-transform/cli.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Draco-compressing GLBs under assets/models…"
before=0
after=0
count=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # skip nested Tripo dumps under spells/*/
  case "$f" in
    assets/models/spells/*/*) continue ;;
  esac
  count=$((count + 1))
  b=$(wc -c < "$f" | tr -d ' ')
  before=$((before + b))
  tmp="${f}.draco.tmp.glb"
  npx --yes @gltf-transform/cli@4.1.1 draco "$f" "$tmp" \
    --method edgebreaker \
    --encode-speed 5 \
    --decode-speed 5 \
    --quantize-position 14 \
    --quantize-normal 10 \
    --quantize-texcoord 12 \
    --quantize-color 8 \
    --quantize-generic 12
  mv "$tmp" "$f"
  a=$(wc -c < "$f" | tr -d ' ')
  after=$((after + a))
  echo "  $f  ${b} → ${a} bytes"
done < <(find assets/models -name '*.glb' -type f | sort)

echo "Done ($count files). Total bytes: $before → $after"
