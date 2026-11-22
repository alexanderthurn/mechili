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
whorls of branches, a narrow cone). Height 1, base on the origin — the game normalizes the size.
The same arguments always build the same plant (the seed drives every random choice).

The game's plants (then Draco, settings as in scripts/compress-glb-draco.sh):
  assets/models/scenery/bush-round.glb  --style round --seed 1 --faces 1500
  assets/models/scenery/bush-tall.glb   --style tall --seed 2 --faces 2000
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
    p.add_argument("--style", choices=["round", "tall"], default="round")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--faces", type=int, default=1000, help="triangle budget (wood + leaves)")
    p.add_argument("--leaf", type=float, default=1.0, help="leaf size multiplier")
    p.add_argument("--leaf-width", type=float, default=None, help="leaf half-width / length (default: round 0.55, tall 0.17)")
    p.add_argument("--leaf-points", type=int, default=None, help="outline points per side: 1 = pointed kite (2 tris), 2 = oval (4 tris); default round 2, tall 1")
    p.add_argument(
        "--leaf-color",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=(0.36, 0.5, 0.2),
        help="r,g,b (sRGB 0..1) of a lit leaf",
    )
    p.add_argument(
        "--wood-color",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=(0.24, 0.14, 0.09),
    )
    a = p.parse_args(argv)
    # round: big oval leaves; tall: long narrow pointed ones, twice as many for the same budget
    if a.leaf_width is None:
        a.leaf_width = 0.55 if a.style == "round" else 0.17
    if a.leaf_points is None:
        a.leaf_points = 2 if a.style == "round" else 1
    return a


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

    def vert(co: Vector, n: Vector, c: tuple[float, float, float]):
        v = bm.verts.new(co)
        vnorm.append(n.normalized())
        vcol.append(c)
        return v

    def tri(a, b, c):
        bm.faces.new((a, b, c))

    def frame(d: Vector) -> tuple[Vector, Vector]:
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        s = d.cross(up).normalized()
        return s, d.cross(s).normalized()

    # ---- wood: tubes along polylines --------------------------------------------------------
    wood_tris = 0

    # wood leaves may grow on: (a, b, radius at a, radius at b)
    leafy: list[tuple[Vector, Vector, float, float]] = []

    def tube(pts: list[Vector], radii: list[float], sides: int, leaves_from: int | None = None) -> None:
        """a closed tube; segments from `leaves_from` on carry leaves (None: none)"""
        nonlocal wood_tris
        if leaves_from is not None:
            for i in range(leaves_from, len(pts) - 1):
                leafy.append((pts[i], pts[i + 1], radii[i], radii[i + 1]))
        rings = []
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            s, t = frame(d)
            ring = []
            shade = 0.75 + 0.25 * (i / max(1, len(pts) - 1))
            c = tuple(min(1.0, x * shade) for x in args.wood_color)
            for k in range(sides):
                a = math.tau * k / sides
                n = s * math.cos(a) + t * math.sin(a)
                ring.append(vert(p + n * radii[i], n, c))
            rings.append(ring)
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(sides):
                a, b = r0[k], r0[(k + 1) % sides]
                c, d = r1[(k + 1) % sides], r1[k]
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
        axis = (perp * 0.8 + bdir * 0.45 + out * 0.4 + Vector((0, 0, -0.15))).normalized()
        side = axis.cross(out)
        if side.length < 1e-4:
            side = s
        side.normalize()
        face_n = side.cross(axis).normalized()
        if face_n.dot(out) < 0:
            face_n = -face_n
        L = leaf_len * rnd.uniform(0.75, 1.25)
        W = L * args.leaf_width * rnd.uniform(0.85, 1.15)
        base, tip = p, p + axis * L
        # brightness: inside the crown darker (cheap occlusion), lighter tips, a little jitter
        k = (0.45 + 0.55 * depth) * rnd.uniform(0.85, 1.12)
        hue = rnd.uniform(-0.04, 0.04)
        cb = (lc[0] * k * 0.8 + hue, lc[1] * k * 0.8, lc[2] * k * 0.8)
        ct = (lc[0] * k * 1.1 + hue, lc[1] * k * 1.08, lc[2] * k)
        # shading normal: mostly the crown's outward direction — the crown reads as one volume
        sn = (out * 0.65 + face_n * 0.35).normalized()
        # an oval outline: `leaf_points` per side along the vein, the halves folded back a little
        m = args.leaf_points
        left, right = [], []
        for i in range(1, m + 1):
            f = i / (m + 1)
            w = W * math.sin(math.pi * f) ** 0.6  # round, widest a bit before the middle
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

    lin = lambda c: (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for i, c in enumerate(vcol):
        col.data[i].color = (lin(max(0, min(1, c[0]))), lin(max(0, min(1, c[1]))), lin(max(0, min(1, c[2]))), 1.0)

    mat = bpy.data.materials.new("Plant")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
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
