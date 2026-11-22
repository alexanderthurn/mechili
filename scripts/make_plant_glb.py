#!/usr/bin/env python3
"""
Build a low-poly plant (Blender) from scratch: a closed trunk with branches split recursively
(thin tubes, a few sides), and leaves — each a small folded kite of two triangles — over the
crown. No texture: vertex colours (darker inside the crown, lighter tips) and leaf normals bent
outward, so the crown shades as one volume like the billboard cards. Double-sided material.

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/make_plant_glb.py -- --style round --output misc/model-viewer/out/bush-round__gen.glb \\
    --seed 1 --faces 1000

Styles: `round` (bush-round: a short trunk, a ball crown), `tall` (bush-tall: a leader with
whorls of branches, a narrow cone), `oak` (tree-oak: a forked trunk, leaf clumps at the bough
ends, crumpled hanging leaves), `pine` (tree-pine: a straight trunk, whorls of branches, needle
clumps lying over them) — both trees tuned against their Tripo originals' measured leaves,
outline, colours and bark.
Height 1, base on the origin — the game normalizes the size.
The same arguments always build the same plant (the seed drives every random choice).

The game's plants (the trees' texture then to WebP: scripts/glb-textures-webp.py --quality 90;
then Draco, settings as in scripts/compress-glb-draco.sh):
  assets/models/scenery/bush-round.glb  --style round --seed 1 --faces 1500
  assets/models/scenery/bush-tall.glb   --style tall --seed 2 --faces 2000
  assets/models/scenery/tree-oak.glb    --style oak --seed 3 --faces 4000
  assets/models/scenery/tree-pine.glb   --style pine --seed 2 --faces 4000
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    p = argparse.ArgumentParser(description="Build a low-poly plant GLB")
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--style", choices=["round", "tall", "oak", "pine"], default="round")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--faces", type=int, default=1000, help="triangle budget (wood + leaves)")
    p.add_argument("--leaf", type=float, default=1.0, help="leaf size multiplier")
    p.add_argument("--leaf-width", type=float, default=None, help="leaf half-width / length (default: round 0.55, tall 0.17)")
    p.add_argument("--leaf-points", type=int, default=None, help="outline points per side: 1 = pointed kite (2 tris), 2 = oval (4 tris); default round 2, tall 1")
    p.add_argument(
        "--leaf-color",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=None,
        help="r,g,b (sRGB 0..1) of a lit leaf (default: bushes 0.36,0.5,0.2; oak a dark olive 0.3,0.38,0.11)",
    )
    p.add_argument(
        "--wood-color",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=None,
        help="r,g,b (sRGB 0..1) of the bark (default: bushes 0.24,0.14,0.09; oak a warm brown 0.36,0.27,0.15)",
    )
    a = p.parse_args(argv)
    # round: big oval leaves; tall: long narrow pointed ones, twice as many for the same budget
    if a.leaf_width is None:
        a.leaf_width = {"tall": 0.17, "oak": 0.5, "pine": 0.55}.get(a.style, 0.55)
    if a.leaf_color is None:
        a.leaf_color = {"oak": (0.3, 0.38, 0.11), "pine": (0.38, 0.5, 0.14)}.get(a.style, (0.36, 0.5, 0.2))
    if a.wood_color is None:
        a.wood_color = {"oak": (0.36, 0.27, 0.15), "pine": (0.67, 0.475, 0.235)}.get(a.style, (0.24, 0.14, 0.09))
    if a.leaf_points is None:
        a.leaf_points = 2 if a.style == "round" else 1
    return a


def plant_texture(bpy, size: int):
    """A small greyscale-ish texture the vertex colours multiply: left half one leaf (lighter
    midrib, side veins, soft darker edges, mottling; base at v 0, tip at v 1), right half bark
    (vertical furrows, a few cross cracks). Fixed seed — every tree shares the look."""
    import numpy as np

    rng = np.random.default_rng(12345)

    def noise(h: int, w: int, ch: int, cw: int) -> np.ndarray:
        g = rng.standard_normal((ch + 1, cw + 1))
        ys = np.linspace(0, ch, h)
        xs = np.linspace(0, cw, w)
        y0 = np.floor(ys).astype(int).clip(0, ch - 1)
        x0 = np.floor(xs).astype(int).clip(0, cw - 1)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]
        b = g[y0][:, x0 + 1]
        c = g[y0 + 1][:, x0]
        d = g[y0 + 1][:, x0 + 1]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

    h = w = size
    img = np.ones((h, w, 3))
    half = w // 2
    # leaf
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(-1, 1, half)[None, :]
    bright = 0.8 + 0.18 * y
    bright = bright * (1 - 0.28 * np.abs(x) ** 2)
    rib = np.exp(-((x / 0.05) ** 2)) * 0.16
    t = (y - 0.5 * np.abs(x)) * 7
    vein = np.exp(-(((t % 1) - 0.5) / 0.07) ** 2) * 0.09 * (1 - np.abs(x))
    mott = noise(h, half, 10, 6) * 0.05 + noise(h, half, 40, 24) * 0.025
    leaf = np.clip(bright + rib + vein + mott, 0, 1)
    img[:, :half, 0] = leaf * (1 + rib * 0.4)
    img[:, :half, 1] = leaf * (1 + rib * 0.3)
    img[:, :half, 2] = leaf * (1 - rib * 0.5)
    # bark
    fur = noise(h, w - half, 6, 28) * 0.18 + noise(h, w - half, 24, 60) * 0.08
    crack = (np.abs(noise(h, w - half, 14, 4)) < 0.06) * -0.12
    bark = np.clip(0.82 + fur + crack, 0.45, 1)
    img[:, half:, :] = bark[:, :, None]
    im = bpy.data.images.new("PlantTex", w, h, alpha=False)
    rgba = np.concatenate([np.clip(img, 0, 1), np.ones((h, w, 1))], axis=2)
    im.pixels.foreach_set(rgba.astype(np.float32).ravel())
    im.pack()
    return im


def main() -> None:
    import bmesh
    import bpy
    from mathutils import Vector

    args = parse_args(sys.argv)
    rnd = random.Random(args.seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bm = bmesh.new()
    vnorm: list[Vector] = []  # per-vertex shading normal
    vcol: list[tuple[float, float, float]] = []

    rough = args.style in ("oak", "pine")  # the trees: gnarled bark, crumpled hanging leaves
    rbark = random.Random(args.seed * 7919 + 1)  # bark and leaf-shade noise only

    # the trees also get a small texture (leaf veins, bark furrows) through UVs; the bushes stay
    # vertex colour only
    textured = rough
    vuv: list[tuple[float, float]] = []
    face_uvs: list[tuple | None] = []

    def vert(co: Vector, n: Vector, c: tuple[float, float, float], uv: tuple[float, float] = (0.75, 0.5)):
        v = bm.verts.new(co)
        vnorm.append(n.normalized())
        vcol.append(c)
        vuv.append(uv)
        return v

    def tri(a, b, c, uvs: tuple | None = None):
        bm.faces.new((a, b, c))
        face_uvs.append(uvs)

    def frame(d: Vector) -> tuple[Vector, Vector]:
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        s = d.cross(up).normalized()
        return s, d.cross(s).normalized()

    # ---- wood: tubes along polylines --------------------------------------------------------
    wood_tris = 0

    # wood leaves may grow on: (a, b, radius at a, radius at b)
    leafy: list[tuple[Vector, Vector, float, float]] = []

    def tube(
        pts: list[Vector], radii: list[float], sides: int, leaves_from: int | None = None, gnarl: float = 0.18
    ) -> None:
        """a closed tube; segments from `leaves_from` on carry leaves (None: none)"""
        nonlocal wood_tris
        if leaves_from is not None:
            for i in range(leaves_from, len(pts) - 1):
                leafy.append((pts[i], pts[i + 1], radii[i], radii[i + 1]))
        rings = []
        run = 0.0  # length along the tube (bark texture runs up it)
        for i, p in enumerate(pts):
            if i:
                run += (p - pts[i - 1]).length
            bv = run * 6.0
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            s, t = frame(d)
            ring = []
            shade = 0.75 + 0.25 * (i / max(1, len(pts) - 1))
            c = tuple(min(1.0, x * shade) for x in args.wood_color)
            band = rbark.uniform(0.85, 1.1) if rough else 1.0  # lighter and darker bands up the wood
            twist = rbark.uniform(-0.3, 0.3) if rough else 0.0  # rings turned a little: no straight ridges
            for k in range(sides):
                a = math.tau * (k + twist) / sides
                n = s * math.cos(a) + t * math.sin(a)
                if rough:
                    # gnarled bark: a lumpy outline (the original's trunk varies ±25–30 % round
                    # it), dark furrows and light ridges (its own random stream, so the plant's
                    # shape stays the same as without it)
                    r = radii[i] * rbark.uniform(1 - gnarl, 1 + gnarl)
                    m = rbark.uniform(0.55, 1.25) * band
                    ring.append(vert(p + n * r, n, tuple(min(1.0, x * m) for x in c), (0.5 + 0.5 * k / sides, bv)))
                else:
                    ring.append(vert(p + n * radii[i], n, c))
            rings.append(ring)
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(sides):
                a, b = r0[k], r0[(k + 1) % sides]
                c, d = r1[(k + 1) % sides], r1[k]
                if textured and k == sides - 1:
                    # the seam: the wrapping corners take u = 1, not 0.5
                    ua, ub, uc, ud = (vuv[x.index] for x in (a, b, c, d))
                    tri(a, b, c, (ua, (1.0, ub[1]), (1.0, uc[1])))
                    tri(a, c, d, (ua, (1.0, uc[1]), ud))
                else:
                    tri(a, b, c)
                    tri(a, c, d)
                wood_tris += 2
        if radii[-1] < 0.006:
            return  # a twig's end is too thin to see open
        tip = rings[-1]
        cen = vert(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1], (pts[-1] - pts[-2]), vcol[-1])
        for k in range(sides):
            tri(tip[k], tip[(k + 1) % sides], cen)
            wood_tris += 1

    def bend(a: Vector, b: Vector, n: int, wobble: float, droop: float = 0.0) -> list[Vector]:
        pts = []
        for i in range(n + 1):
            f = i / n
            p = a.lerp(b, f)
            if 0 < i < n:
                p += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * wobble
            p.z -= droop * f * f
            pts.append(p)
        return pts

    def twigs(a: Vector, b: Vector, n: int, ln: tuple[float, float], spread: float, lift: float = 0.15) -> None:
        """n thin twigs off the segment a→b, out of its outer part"""
        d = (b - a).normalized()
        s, t = frame(d)
        for _ in range(n):
            st = a.lerp(b, rnd.uniform(0.35, 1.0))
            ang = rnd.uniform(0, math.tau)
            perp = s * math.cos(ang) + t * math.sin(ang)
            dd = (d * (1 - spread) + perp * spread + Vector((0, 0, lift))).normalized()
            tube([st, st + dd * rnd.uniform(*ln)], [0.007, 0.0025], 3, leaves_from=0)

    if args.style == "round":
        crown_c = Vector((0, 0, 0.55))
        crown_r = Vector((0.42, 0.42, 0.45))
        # a small bush: one rod up into the crown — the leaves around it hide the rest, so they
        # don't need branches to hang on
        tube(
            bend(Vector((0, 0, -0.02)), Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), 0.6)), 3, 0.012),
            [0.06, 0.045, 0.03, 0.012],
            6,
        )

        def outward(p: Vector) -> tuple[Vector, float]:
            v = p - crown_c
            e = Vector((v.x / crown_r.x, v.y / crown_r.y, v.z / crown_r.z))
            o = Vector((e.x / crown_r.x, e.y / crown_r.y, e.z / crown_r.z))
            return (o.normalized() if o.length > 1e-4 else Vector((0, 0, 1))), min(1.0, e.length)

        leaf_len = 0.11 * args.leaf
    elif args.style == "oak":
        # an oak (after the Tripo original it replaces): a trunk to about 40 % of the height forking
        # into a few limbs that go up and out, short side boughs spreading nearly level, gnarled
        # dark bark — and the crown as leaf islands, a dense clump of small pointed leaves round
        # each bough's and limb's end, with gaps between them where the branches show
        crown_c = Vector((0, 0, 0.64))
        crown_r = Vector((0.4, 0.4, 0.3))
        # leaf islands: a clump round each bough's and limb's outer end (centre, radius)
        clumps: list[tuple[Vector, float]] = []

        def zigzag(st: Vector, d: Vector, ln: float, n: int, kink: float, droop: float = 0.0) -> list[Vector]:
            pts = [st]
            p, cur = st.copy(), d.normalized()
            for _ in range(n):
                s_, t_ = frame(cur)
                ang = rnd.uniform(0, math.tau)
                cur = (cur + (s_ * math.cos(ang) + t_ * math.sin(ang)) * kink).normalized()
                cur.z -= droop
                cur.normalize()
                p = p + cur * (ln / n)
                pts.append(p)
            return pts

        # a stout trunk to about 40 % of the height, forking into thick limbs that go up and out
        fork_z = 0.4
        # crooked, in short sections, thick at the foot, lumpy all round (8 sides, many rings)
        trunk = zigzag(Vector((0, 0, -0.02)), Vector((0, 0, 1)), fork_z + 0.02, 7, 0.11)
        tube(trunk, [0.032, 0.026, 0.022, 0.02, 0.019, 0.018, 0.018, 0.017], 8, gnarl=0.3)
        fork = trunk[-1]

        def bough(st: Vector, d: Vector, ln: float, r0: float, nside: int) -> None:
            """a secondary bough: crooked, drooping a little, twigs and leaves along its outer part"""
            bp = zigzag(st, d, ln, 3, 0.12, droop=0.04)
            tube(bp, [r0, r0 * 0.65, r0 * 0.4, 0.002], nside, leaves_from=1)
            clumps.append((bp[2].lerp(bp[3], 0.6), rnd.uniform(0.08, 0.12)))

        nlimb = rnd.choice([4, 5])
        off = rnd.uniform(0, math.tau)
        for i in range(nlimb):
            a = off + math.tau * (i + rnd.uniform(-0.15, 0.15)) / nlimb
            up = rnd.uniform(0.9, 1.6) if i else 2.6  # one limb carries on as the top
            d = Vector((math.cos(a), math.sin(a), up)).normalized()
            ln = rnd.uniform(0.27, 0.33) if i else 0.4
            lp = zigzag(fork, d, ln, 3, 0.08)
            tube(lp, [0.016, 0.011, 0.007, 0.003], 5, leaves_from=2)
            twigs(lp[2], lp[3], 3, (0.06, 0.1), 0.8)
            clumps.append((lp[3], rnd.uniform(0.11, 0.15)))
            # secondary boughs off the limb: spreading wide and nearly level, longer low down
            for j in range(3):
                k = j + 1
                st = lp[min(k, 2)].lerp(lp[min(k + 1, 3)], rnd.uniform(0.2, 0.8))
                b = a + rnd.uniform(-0.7, 0.7)
                d2 = Vector((math.cos(b), math.sin(b), rnd.uniform(0.0, 0.5))).normalized()
                bough(st, d2, rnd.uniform(0.16, 0.21) * (1.15 - 0.15 * j), 0.007, 4)
        # two low boughs straight off the trunk, long and nearly level — the crown reaches down
        for i in range(2):
            a = off + math.pi * i + rnd.uniform(0.5, 1.2)
            st = trunk[-2].lerp(fork, rnd.uniform(0.3, 0.9))
            d = Vector((math.cos(a), math.sin(a), rnd.uniform(0.15, 0.35))).normalized()
            bough(st, d, rnd.uniform(0.22, 0.26), 0.009, 4)

        def outward(p: Vector) -> tuple[Vector, float]:
            v = p - crown_c
            e = Vector((v.x / crown_r.x, v.y / crown_r.y, v.z / crown_r.z))
            o = Vector((e.x / crown_r.x, e.y / crown_r.y, e.z / crown_r.z))
            return (o.normalized() if o.length > 1e-4 else Vector((0, 0, 1))), min(1.0, e.length)

        leaf_len = 0.034 * args.leaf
    elif args.style == "pine":
        # a pine (after the Tripo original it replaces): one straight trunk to the very top, bare
        # at the foot, whorls of slightly drooping branches whose reach follows the original's
        # outline (≈ 0.45 × height wide from 15 to 40 % up, ≈ 0.2 from 50 to 80 %, a point at
        # 90 %), needle clumps along the branches — small, hard-crumpled shards
        crown_c = Vector((0, 0, 0.45))
        height = 1.0
        trunk = [Vector((rnd.uniform(-0.004, 0.004), rnd.uniform(-0.004, 0.004), -0.02 + 1.02 * i / 8)) for i in range(9)]
        tube(trunk, [0.03, 0.024, 0.02, 0.016, 0.013, 0.01, 0.007, 0.004, 0.002], 7, leaves_from=6, gnarl=0.2)
        reach_at = [(0.1, 0.1), (0.15, 0.23), (0.4, 0.21), (0.5, 0.13), (0.8, 0.1), (0.92, 0.02)]

        def reach(z: float) -> float:
            for (z0, r0), (z1, r1) in zip(reach_at, reach_at[1:]):
                if z <= z1:
                    return r0 + (r1 - r0) * max(0.0, (z - z0) / (z1 - z0))
            return 0.02

        z = 0.11
        while z < 0.9:
            n = rnd.choice([4, 5])
            off = rnd.uniform(0, math.tau)
            for i in range(n):
                a = off + math.tau * (i + rnd.uniform(-0.2, 0.2)) / n
                d = Vector((math.cos(a), math.sin(a), rnd.uniform(-0.1, 0.15))).normalized()
                ln = reach(z) * rnd.uniform(0.85, 1.1) / max(0.5, math.hypot(d.x, d.y))
                st = Vector((0, 0, z))
                bp = bend(st, st + d * ln, 2, 0.006, droop=ln * 0.25)
                tube(bp, [0.0045, 0.0028, 0.0012], 3, leaves_from=0)
            z += rnd.uniform(0.05, 0.065)

        def outward(p: Vector) -> tuple[Vector, float]:
            radial = Vector((p.x, p.y, 0))
            o = (radial.normalized() if radial.length > 1e-4 else Vector((1, 0, 0))) + Vector((0, 0, 0.3))
            return o.normalized(), min(1.0, radial.length / max(0.04, reach(p.z)))

        leaf_len = 0.04 * args.leaf  # (the original's needle area is 86 % of its surface)
    else:
        crown_c = Vector((0, 0, 0.55))
        height = 1.0
        tube(
            bend(Vector((0, 0, -0.02)), Vector((0, 0, height)), 5, 0.008),
            [0.04, 0.032, 0.026, 0.018, 0.01, 0.004],
            5,
            leaves_from=2,
        )
        z = 0.14
        whorls = []
        while z < 0.92:
            whorls.append(z)
            z += rnd.uniform(0.07, 0.09)
        for wi, z in enumerate(whorls):
            f = (z - 0.14) / 0.8
            ln = 0.3 * (1 - f) + 0.05
            n = 3 if wi % 2 else 4
            off = rnd.uniform(0, math.tau)
            for i in range(n):
                a = off + math.tau * (i + rnd.uniform(-0.15, 0.15)) / n
                d = Vector((math.cos(a), math.sin(a), rnd.uniform(0.15, 0.45))).normalized()
                start = Vector((0, 0, z))
                end = start + d * ln * rnd.uniform(0.85, 1.1)
                tube(bend(start, end, 1, 0.0, droop=ln * 0.15), [0.011, 0.004], 3, leaves_from=0)

        def outward(p: Vector) -> tuple[Vector, float]:
            radial = Vector((p.x, p.y, 0))
            o = (radial.normalized() if radial.length > 1e-4 else Vector((1, 0, 0))) + Vector((0, 0, 0.35))
            cone = max(0.06, 0.38 * (1 - (p.z - 0.14) / 0.8) + 0.06)
            return o.normalized(), min(1.0, radial.length / cone)

        leaf_len = 0.085 * args.leaf

    # a leaf's spot: on the surface of a leafy branch (weighted by length, mostly its outer part)
    weights = [(b - a).length for a, b, _, _ in leafy]
    total_w = sum(weights) or 1.0

    def leaf_spot():
        if args.style == "oak":
            # one of the leaf islands (bigger ones get more), most leaves near its surface;
            # shaded as its own little ball, so the crown reads as clumps with gaps between
            c, rad = rnd.choices(clumps, weights=[r * r for _, r in clumps])[0]
            while True:
                v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
                if 0.05 < v.length <= 1:
                    break
            v.normalize()
            dep = rnd.random() ** 0.4
            p = c + Vector((v.x, v.y, v.z * 0.8)) * rad * dep
            crown_out, _ = outward(p)
            out = (v * 0.7 + crown_out * 0.3).normalized()
            s, t = frame(out)
            ang = rnd.uniform(0, math.tau)
            return p, out, dep, out, s * math.cos(ang) + t * math.sin(ang)
        if args.style == "round":
            # anywhere in the crown, most near its shell, down to just above the ground
            while True:
                v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
                if 0.05 < v.length <= 1:
                    v.normalize()
                    p = crown_c + Vector((v.x * crown_r.x, v.y * crown_r.y, v.z * crown_r.z)) * rnd.random() ** 0.4
                    if p.z > 0.12:
                        break
            out, depth = outward(p)
            s, t = frame(out)
            ang = rnd.uniform(0, math.tau)
            return p, out, depth, out, s * math.cos(ang) + t * math.sin(ang)
        r = rnd.uniform(0, total_w)
        for (a, b, ra, rb), w in zip(leafy, weights):
            r -= w
            if r <= 0:
                break
        f = rnd.random() ** 0.6
        d = (b - a).normalized()
        s, t = frame(d)
        ang = rnd.uniform(0, math.tau)
        perp = s * math.cos(ang) + t * math.sin(ang)
        p = a.lerp(b, f) + perp * (ra + (rb - ra) * f) * 0.8  # its base sits in the bark
        out, depth = outward(p)
        return p, out, depth, d, perp

    # ---- leaves: folded kites / ovals ------------------------------------------------------
    nleaves = max(0, (args.faces - wood_tris) // (2 * args.leaf_points))
    lc = args.leaf_color
    for _ in range(nleaves):
        p, out, depth, bdir, perp = leaf_spot()
        # the leaf grows off its branch: sideways, along it, outward, a little down
        s, t = frame(out)
        if rough:
            # hanging leaves: pointing outward-ish and down, the blade's face turned up to the sun
            up = Vector((0, 0, 1))
            h = Vector((out.x + perp.x * 0.8, out.y + perp.y * 0.8, 0))
            if h.length < 1e-4:
                h = Vector((1, 0, 0))
            # how steeply: drawn from the Tripo original's own leaf tilts (share of leaf area per
            # 15° from flat — measured: 6 / 17 / 23 / 24 / 18 / 14 %), so they hang like its
            # (the pine's needles start flatter: they crumple harder, which steepens them, and lie
            # mostly level over their branch)
            tilts = [28, 36, 22, 9, 4, 1] if args.style == "pine" else [6, 17, 23, 24, 18, 14]
            bin_ = rnd.choices(range(6), weights=tilts)[0]
            tilt = math.radians(rnd.uniform(bin_ * 15, bin_ * 15 + 15))
            axis = (h.normalized() * math.cos(tilt) + Vector((0, 0, -math.sin(tilt)))).normalized()
            side = axis.cross(up).normalized()
            # a little roll about its midrib, so not every blade lies level across
            roll = math.radians(rnd.uniform(-25, 25))
            side = (side * math.cos(roll) + axis.cross(side) * math.sin(roll)).normalized()
            face_n = side.cross(axis).normalized()
            if face_n.z < 0:
                face_n = -face_n
        else:
            axis = (perp * 0.8 + bdir * 0.45 + out * 0.4 + Vector((0, 0, -0.15))).normalized()
            side = axis.cross(out)
            if side.length < 1e-4:
                side = s
            side.normalize()
            face_n = side.cross(axis).normalized()
            if face_n.dot(out) < 0:
                face_n = -face_n
        L = leaf_len * (min(1.35, math.exp(rnd.gauss(0, 0.35))) if rough else rnd.uniform(0.75, 1.25))
        W = L * args.leaf_width * rnd.uniform(0.85, 1.15)
        if args.style == "pine":
            p = p + Vector((0, 0, 0.35 * L))  # needles sit on top of their branch, not under it
        base, tip = p, p + axis * L
        # brightness: inside the crown darker (cheap occlusion), lighter tips, a little jitter
        inner = {"oak": 0.6, "pine": 0.72}.get(args.style, 0.45)  # brightness deep inside the crown
        k = (inner + (1 - inner) * depth) * rnd.uniform(0.85, 1.12)
        if rough and rbark.random() < 0.3:
            k *= rbark.uniform(0.5, 0.75)  # leaves in each other's shade
        hue = rnd.uniform(-0.04, 0.04)
        cb = (lc[0] * k * 0.8 + hue, lc[1] * k * 0.8, lc[2] * k * 0.8)
        ct = (lc[0] * k * 1.1 + hue, lc[1] * k * 1.08, lc[2] * k)
        # shading normal: mostly the crown's outward direction — the crown reads as one volume
        if rough:  # lit from above, rounded by its clump
            sn = (face_n * 0.55 + out * 0.45).normalized()
        else:
            sn = (out * 0.65 + face_n * 0.35).normalized()
        if rough:
            # a crumpled shard, like the Tripo original's leaves (measured there: 1–9 triangles a
            # piece, median 3; sizes spread wide; neighbouring faces folded 21° median, some
            # nearly folded over) — not a flat, evenly folded paper kite: 1–3 triangles fanned
            # from the base over a jagged outline, every outer point bent off the blade at random,
            # and the colour mottled per point
            n = rnd.choices([1, 2, 3], weights=[1, 2, 1])[0]
            vb = vert(base, (sn - axis * 0.25), cb, (0.25, 0.03))
            ring = []
            for i in range(n + 1):
                u = i / n  # 0 = one edge, 1 = the other
                lat = math.cos(math.pi * u) * rnd.uniform(0.7, 1.25)
                along_f = (0.45 + 0.55 * math.sin(math.pi * u)) * rnd.uniform(0.8, 1.15)
                bendv = rnd.gauss(0, 0.2 if args.style == "pine" else 0.22) * L
                if args.style == "pine":
                    bendv = -abs(bendv)  # needles crumple downward, never up
                q = p + axis * (L * along_f) + side * (W * lat) + face_n * bendv
                if args.style == "pine":
                    # no needle points up: every corner level with its base or below (flat,
                    # sideways or hanging)
                    q.z = min(q.z, p.z + 0.05 * L)
                mot = rbark.uniform(0.75, 1.15)
                # soft: each corner's normal leans toward its own side of the blade, so the light
                # runs across the leaf like over a slightly domed one instead of one flat shade
                qn = sn + ((q - p).normalized()) * 0.35
                quv = (0.25 + 0.2 * max(-1.0, min(1.0, lat / 1.25)), 0.06 + 0.88 * min(1.0, along_f / 1.27))
                ring.append(vert(q, qn, tuple(x * mot for x in ct), quv))
            for a_, b_ in zip(ring, ring[1:]):
                tri(vb, a_, b_)
            continue
        # an oval outline: `leaf_points` per side along the vein, the halves folded back a little
        m = args.leaf_points
        left, right = [], []
        for i in range(1, m + 1):
            f = i / (m + 1)
            w = W * math.sin(math.pi * f) ** 0.6  # round, widest a bit before the middle
            if rough:
                w *= rnd.uniform(0.75, 1.05)  # slightly lobed
            along = axis * (L * f ** 1.15)
            fold = face_n * (-w * 0.25)
            left.append(vert(p + along + side * w + fold, sn, ct))
            right.append(vert(p + along - side * w + fold, sn, ct))
        vb = vert(base, sn, cb)
        vt = vert(tip, sn, ct)
        ring = [*left, vt, *reversed(right)]  # base → left → tip → right
        for a_, b_ in zip(ring, ring[1:]):
            tri(vb, a_, b_)

    me = bpy.data.meshes.new("plant")
    bm.verts.index_update()
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("Plant", me)
    bpy.context.collection.objects.link(obj)
    me.normals_split_custom_set([tuple(vnorm[l.vertex_index]) for l in me.loops])
    if textured:
        uvl = me.uv_layers.new(name="UVMap")
        for poly, fu in zip(me.polygons, face_uvs):
            for j, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = fu[j] if fu else vuv[me.loops[li].vertex_index]

    lin = lambda c: (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for i, c in enumerate(vcol):
        col.data[i].color = (lin(max(0, min(1, c[0]))), lin(max(0, min(1, c[1]))), lin(max(0, min(1, c[2]))), 1.0)

    mat = bpy.data.materials.new("Plant")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    if textured:
        # the texture goes to Base Color; the exporter still writes the vertex colours (COLOR_0),
        # and three.js multiplies the two
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = plant_texture(bpy, 256)
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.use_backface_culling = False  # leaves are seen from both sides
    me.materials.append(mat)

    dst = args.output.resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
    )
    print(f"[plant] {args.style} seed {args.seed}: {len(me.polygons)} tris ({wood_tris} wood, {nleaves} leaves) → {dst} ({dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
