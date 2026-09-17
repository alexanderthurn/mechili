#!/usr/bin/env bash
set -euo pipefail

# Fallback atlas regeneration using a saved TexturePacker project (.tps).
# This is useful if the normal CLI command ever misbehaves: you can always
# regenerate from the exact saved settings here.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${SCRIPT_DIR}"

# Pack PNG + JSON from the .tps settings, but override outputs explicitly
# because the .tps was saved without absolute sheet/data filenames.
printf 'agree\n' | TexturePacker icons.tps \
  --sheet "icons.png" \
  --data "${ROOT_DIR}/assets/icons/icons.json"

# Convert PNG -> WEBP for runtime (matches package.json icons:pack)
uv run --with pillow python -c "from PIL import Image; Image.open('icons.png').save('${ROOT_DIR}/assets/icons/icons.webp','WEBP',quality=90,method=6)"

echo "Packed: icons.png + icons.webp (+ icons.json)"

