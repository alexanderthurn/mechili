#!/usr/bin/env python3
"""Turn raw field photos into tileable 2K ground textures + normals."""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "textures"
SIZE = 2048
SEAM = 72


def run(*args: str) -> None:
    subprocess.check_call(args)


def load_rgb(path: Path) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    wh = subprocess.check_output(
        ["magick", "identify", "-format", "%w %h", str(path)], text=True
    )
    w, h = map(int, wh.split())
    raw = subprocess.check_output(["magick", str(path), "-depth", "8", "rgb:-"])
    pixels: list[list[tuple[int, int, int]]] = []
    i = 0
    for _y in range(h):
        row: list[tuple[int, int, int]] = []
        for _x in range(w):
            row.append((raw[i], raw[i + 1], raw[i + 2]))
            i += 3
        pixels.append(row)
    return w, h, pixels


def save_rgb(path: Path, w: int, h: int, pixels: list[list[tuple[int, int, int]]]) -> None:
    raw = bytearray()
    for y in range(h):
        for x in range(w):
            raw += bytes(pixels[y][x])
    subprocess.run(
        ["magick", "-size", f"{w}x{h}", "-depth", "8", "rgb:-", str(path)],
        input=raw,
        check=True,
    )


def crop_rect(
    pixels: list[list[tuple[int, int, int]]],
    w: int,
    h: int,
    x0: int,
    y0: int,
    cw: int,
    ch: int,
) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    out: list[list[tuple[int, int, int]]] = []
    for y in range(y0, y0 + ch):
        out.append([pixels[y][x] for x in range(x0, x0 + cw)])
    return cw, ch, out


def center_square(
    pixels: list[list[tuple[int, int, int]]], w: int, h: int, frac: float = 0.72
) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    side = int(min(w, h) * frac)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    return crop_rect(pixels, w, h, x0, y0, side, side)


def resize_nearest_bilinear(
    pixels: list[list[tuple[int, int, int]]], w: int, h: int, tw: int, th: int
) -> tuple[int, int, list[list[tuple[int, int, int]]]]:
    tmp = Path("/tmp/resize_src.png")
    save_rgb(tmp, w, h, pixels)
    out = Path("/tmp/resize_dst.png")
    run("magick", str(tmp), "-filter", "Lanczos", "-resize", f"{tw}x{th}!", str(out))
    return load_rgb(out)


def soften_lighting(pixels: list[list[tuple[int, int, int]]], w: int, h: int, amt: float = 0.12):
    """Pull extreme luminance toward local mean — less baked sun/shade."""
    out = [list(row) for row in pixels]

    def lum(p):
        return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]

    for y in range(h):
        for x in range(w):
            p = pixels[y][x]
            L = lum(p)
            target = 128.0
            t = amt * max(0, abs(L - target) / 128.0)
            out[y][x] = tuple(int(p[c] * (1 - t) + target * t) for c in range(3))
    return out


def make_seamless(pixels: list[list[tuple[int, int, int]]], w: int, h: int, seam: int = SEAM):
    out = [list(row) for row in pixels]
    for y in range(h):
        for i in range(seam):
            t = ((seam - i) / seam) ** 2
            left, right = pixels[y][i], pixels[y][w - 1 - i]
            out[y][i] = tuple(int(left[c] * (1 - t) + right[c] * t) for c in range(3))
            out[y][w - 1 - i] = tuple(int(right[c] * (1 - t) + left[c] * t) for c in range(3))
    mid = [list(row) for row in out]
    for x in range(w):
        for i in range(seam):
            t = ((seam - i) / seam) ** 2
            top, bot = mid[i][x], mid[h - 1 - i][x]
            out[i][x] = tuple(int(top[c] * (1 - t) + bot[c] * t) for c in range(3))
            out[h - 1 - i][x] = tuple(int(bot[c] * (1 - t) + top[c] * t) for c in range(3))
    return out


def make_normal(pixels, w, h, strength=3.0):
    def lum(p):
        return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255.0

    def L(x, y):
        return lum(pixels[y % h][x % w])

    out = []
    for y in range(h):
        row = []
        for x in range(w):
            dx = (L(x + 1, y) - L(x - 1, y)) * strength
            dy = (L(x, y + 1) - L(x, y - 1)) * strength
            nx, ny, nz = -dx, -dy, 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
            nx, ny, nz = nx * inv, ny * inv, nz * inv
            row.append(
                (
                    int((nx * 0.5 + 0.5) * 255),
                    int((ny * 0.5 + 0.5) * 255),
                    int((nz * 0.5 + 0.5) * 255),
                )
            )
        out.append(row)
    return out


def export_pair(stem: str, pixels, w, h, n_strength: float, q_alb=84, q_n=90, seam: int | None = None):
    pixels = soften_lighting(pixels, w, h)
    pixels = make_seamless(pixels, w, h, seam if seam is not None else SEAM)
    tw, th, pixels = resize_nearest_bilinear(pixels, w, h, SIZE, SIZE)
    normals = make_normal(pixels, tw, th, n_strength)
    alb_png = Path(f"/tmp/{stem}_a.png")
    nrm_png = Path(f"/tmp/{stem}_n.png")
    save_rgb(alb_png, tw, th, pixels)
    save_rgb(nrm_png, tw, th, normals)
    alb_webp = OUT / f"{stem}.webp"
    nrm_webp = OUT / f"{stem}-normal.webp"
    run("cwebp", "-q", str(q_alb), str(alb_png), "-o", str(alb_webp))
    run("cwebp", "-q", str(q_n), "-sharp_yuv", str(nrm_png), "-o", str(nrm_webp))
    print(f"  {alb_webp.name} ({alb_webp.stat().st_size // 1024}K)")


def process_grass(src: Path, stem: str, frac=0.68):
    print(f"grass {src.name} -> {stem}")
    w, h, px = load_rgb(src)
    _, _, px = center_square(px, w, h, frac)
    export_pair(stem, px, len(px[0]), len(px), 2.6)


def process_dirt(src: Path, stem: str, *, left_frac: float | None = None, center_frac=0.62):
    print(f"dirt {src.name} -> {stem}")
    w, h, px = load_rgb(src)
    if left_frac is not None:
        cw = int(w * left_frac)
        ch = int(min(h, cw))
        px = crop_rect(px, w, h, 0, (h - ch) // 2, cw, ch)[2]
        w, h = len(px[0]), len(px)
    _, _, px = center_square(px, w, h, center_frac)
    export_pair(stem, px, len(px[0]), len(px), 2.4)


def process_rock(src: Path, stem: str, frac: float = 0.90):
    """Rock-only photos — center crop (no sky/distance strip)."""
    print(f"rock {src.name} -> {stem}")
    w, h, px = load_rgb(src)
    _, _, px = center_square(px, w, h, frac)
    export_pair(stem, px, len(px[0]), len(px), 4.2, q_alb=86)


def process_shore(src: Path, stem: str = "shore-albedo"):
    """Already-tileable shore gravel (full frame, no center crop)."""
    print(f"shore {src.name} -> {stem}")
    w, h, px = load_rgb(src)
    export_pair(stem, px, w, h, 3.2, q_alb=86)
    # Prefer shore-normal.webp naming (sand/dirt style) over stem-normal
    out_n = OUT / f"{stem}-normal.webp"
    pref_n = OUT / "shore-normal.webp"
    if stem != "shore" and out_n.exists():
        out_n.replace(pref_n)


def process_wear(src: Path | None = None, frac: float | None = None):
    """Board footprint / mud wear from the original dry-grass photo (not seamless)."""
    photos = ROOT / "misc/photos/grass"
    if src is None:
        src = photos / "IMG_4881.JPG"
    print(f"wear {src.name} -> wear-albedo")
    w, h, px = load_rgb(src)
    if frac is None:
        frac = None if "seamless" in src.stem.lower() else 0.74
    if frac is not None:
        _, _, px = center_square(px, w, h, frac)
        w, h = len(px[0]), len(px)
    seam = 8 if "seamless" in src.stem.lower() else SEAM
    export_pair("wear-albedo", px, w, h, 2.5, q_alb=86, seam=seam)
    out_n = OUT / "wear-albedo-normal.webp"
    if out_n.exists():
        out_n.replace(OUT / "wear-normal.webp")
    grade_olive_dark(OUT / "wear-albedo.webp")


def grade_olive_dark(alb: Path) -> None:
    """Shared dark olive grade (wear + dark grass accents)."""
    run(
        "magick",
        str(alb),
        "-colorspace",
        "sRGB",
        "-modulate",
        "62,92,96",
        "-brightness-contrast",
        "-8x8",
        "-fill",
        "#355743",
        "-colorize",
        "22%",
        "-sigmoidal-contrast",
        "4x45%",
        "-modulate",
        "100,105,108",
        "-fill",
        "#2d5a40",
        "-colorize",
        "12%",
        "-quality",
        "86",
        str(alb),
    )


def process_dark_grass_photo(src: Path, stem: str = "grass-photo-2"):
    """Seamless dark grass accent for HQ photo blobs."""
    print(f"dark grass {src.name} -> {stem}")
    w, h, px = load_rgb(src)
    export_pair(stem, px, w, h, 2.5, q_alb=86, seam=8)
    # export_pair writes stem.webp and stem-normal.webp when stem is grass-photo-2
    # Actually stem-normal is grass-photo-2-normal.webp — correct naming already
    grade_olive_dark(OUT / f"{stem}.webp")


def main():
    photos = ROOT / "misc/photos"
    # Grass — 3 variants (wild lawn, leaf litter, mossy patch)
    process_grass(photos / "grass/IMG_4835.JPG", "grass-photo-0", 0.70)
    process_grass(photos / "grass/IMG_4837.JPG", "grass-photo-1", 0.66)
    # Dark seamless accent (IMG_4881 seamless) — not the older IMG_4857 crop
    seamless = photos / "grass/IMG_4881-seamless.png"
    if seamless.exists():
        process_dark_grass_photo(seamless, "grass-photo-2")
    else:
        process_grass(photos / "grass/IMG_4857.JPG", "grass-photo-2", 0.78)

    # Dirt — path soil, catkin forest floor, leafy ground
    process_dirt(photos / "dirt/IMG_4834.JPG", "dirt-photo-0", left_frac=0.42, center_frac=0.85)
    process_dirt(photos / "dirt/IMG_4861.JPG", "dirt-photo-1", center_frac=0.68)
    process_dirt(photos / "dirt/IMG_4858.JPG", "dirt-photo-2", center_frac=0.72)

    # Rock — rock-only field photos (center crop)
    process_rock(photos / "rock/IMG_4848.JPG", "rock-photo-0", 0.90)
    process_rock(photos / "rock/IMG_4851.JPG", "rock-photo-1", 0.90)

    # Lake shore gravel (outer meadow beaches)
    process_shore(photos / "water/wsc_s.png")

    # Board wear / footprints from original (non-seamless) IMG_4881
    process_wear()
    print("done")


if __name__ == "__main__":
    main()
