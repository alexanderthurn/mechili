#!/usr/bin/env python3
"""Chroma-key Gemini icon sheets and split into 128×128 PNGs for TexturePacker.

Reads misc/icons/manifest.json, processes misc/icons/sheets/<file>,
writes misc/icons/src/<id>.png
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "misc/icons/manifest.json"
SHEETS = ROOT / "misc/icons/sheets"
OUT = ROOT / "misc/icons/src"
SIZE = 128


def chroma_key(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    assert px is not None
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            is_key = (
                (r >= 180 and b >= 160 and g <= 120 and (r - g) >= 50 and (b - g) >= 40)
                or (r >= 220 and b >= 100 and g <= 90)
                or (r >= 200 and b >= 200 and g <= 160)
            )
            if is_key:
                px[x, y] = (0, 0, 0, 0)
                continue
            if r > g + 30 and b > g + 20 and r > 140:
                spill = min(r - g, b - g)
                nr = int(r * 0.4 + g * 0.5 + 30 * 0.1)
                nb = int(b * 0.4 + g * 0.5 + 25 * 0.1)
                ng = int(g * 0.9 + 25 * 0.1)
                px[x, y] = (nr, ng, nb, max(0, a - spill // 2))
    a = im.getchannel("A").filter(ImageFilter.MinFilter(3))
    im.putalpha(a)
    return im


def split_grid(im: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    w, h = im.size
    cw, ch = w // cols, h // rows
    cells: list[Image.Image] = []
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            bbox = cell.getbbox()
            if bbox:
                cell = cell.crop(bbox)
            # pad to square then resize
            side = max(cell.size)
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2), cell)
            cells.append(canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS))
    return cells


def main() -> None:
    data = json.loads(MANIFEST.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    wrote = 0
    for sheet in data["sheets"]:
        path = SHEETS / sheet["file"]
        if not path.exists():
            print(f"skip missing {path.name}", file=sys.stderr)
            continue
        im = chroma_key(Image.open(path))
        cells = split_grid(im, sheet["cols"], sheet["rows"])
        ids = sheet["ids"]
        if len(cells) < len(ids):
            print(f"warn {path.name}: {len(cells)} cells < {len(ids)} ids", file=sys.stderr)
        for i, icon_id in enumerate(ids):
            if i >= len(cells):
                break
            dest = OUT / f"{icon_id}.png"
            cells[i].save(dest, "PNG")
            wrote += 1
            print(f"  {dest.relative_to(ROOT)}")
    print(f"wrote {wrote} icons -> {OUT}")


if __name__ == "__main__":
    main()
