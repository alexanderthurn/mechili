#!/usr/bin/env python3
"""
Build a low-poly cloud (Blender): metaball puffs merged into ONE closed, smooth surface, a
flattened underside, decimated to a face budget, shaded by vertex colour only — lighter on top,
darker below, no texture. The game tints it itself (storm slate, poison green, see cloudFx.ts)
and draws it translucent, so a single surface and a clean gradient matter more than detail.

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/make_cloud_glb.py -- --output assets/models/spells/storm-cloud.glb \\
    --seed 7 --faces 800

Sized like the Tripo clouds it replaces: about 1 wide and deep, centred on the origin.
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
    p = argparse.ArgumentParser(description="Build a low-poly cloud GLB")
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--faces", type=int, default=800)
    p.add_argument("--puffs", type=int, default=14, help="metaball puffs")
    p.add_argument("--height", type=float, default=0.6, help="height / width of the cloud")
    p.add_argument("--bottom", type=float, default=0.55, help="vertex brightness at the underside")
    p.add_argument("--top", type=float, default=1.0, help="vertex brightness at the top")
    p.add_argument(
        "--color",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=(1.0, 1.0, 1.0),
        help="r,g,b the brightness multiplies (0..1) — e.g. a poison cloud's acid green 0.52,0.61,0.06",
    )
    return p.parse_args(argv)


def main() -> None:
    import bmesh
    import bpy

    args = parse_args(sys.argv)
    rnd = random.Random(args.seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # puffs: a ring of big ones at the base, smaller ones heaped on top (Blender is Z-up)
    mb = bpy.data.metaballs.new("cloud")
    mb.resolution = 0.04
    mb.threshold = 0.6
    obj = bpy.data.objects.new("Cloud", mb)
    bpy.context.collection.objects.link(obj)
    for i in range(args.puffs):
        base = i < args.puffs * 0.6
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.0, 0.32) if base else rnd.uniform(0.0, 0.2)
        e = mb.elements.new()
        e.co = (math.cos(a) * d, math.sin(a) * d * 0.85, rnd.uniform(0.0, 0.06) if base else rnd.uniform(0.1, 0.22))
        e.radius = rnd.uniform(0.2, 0.3) if base else rnd.uniform(0.17, 0.26)

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    me = obj.data

    # a flatter underside: everything below the base line pulled up to it, softly
    bm = bmesh.new()
    bm.from_mesh(me)
    zs = [v.co.z for v in bm.verts]
    zmin, zmax = min(zs), max(zs)
    floor = zmin + (zmax - zmin) * 0.22
    for v in bm.verts:
        if v.co.z < floor:
            v.co.z = floor - (floor - v.co.z) * 0.25
    # triangles, so the face budget counts what the game draws
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()

    # the face budget
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, args.faces / max(1, len(me.polygons)))
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()

    # size like the clouds it replaces: 1 wide, `height` tall, centred on the origin
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    w = max(max(xs) - min(xs), max(ys) - min(ys))
    cx, cy, cz = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2
    h = max(zs) - min(zs)
    for v in me.vertices:
        v.co.x = (v.co.x - cx) / w
        v.co.y = (v.co.y - cy) / w
        v.co.z = (v.co.z - cz) / h * args.height

    # brightness by height (the game's tint multiplies it): lighter crown, darker belly
    col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    for i, v in enumerate(me.vertices):
        t = (v.co.z - lo) / max(1e-6, hi - lo)
        b = args.bottom + (args.top - args.bottom) * (t ** 0.8) + rnd.uniform(-0.02, 0.02)
        b = max(0.0, min(1.0, b))
        # --color and the brightness are screen (sRGB) values, like a texture's; the attribute
        # (and glTF's COLOR_0) is linear — unconverted, 0.5 showed as ~0.73 and the cloud washed out
        lin = lambda c: (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        r, g, bl = args.color
        col.data[i].color = (lin(min(1.0, r * b)), lin(min(1.0, g * b)), lin(min(1.0, bl * b)), 1.0)

    mat = bpy.data.materials.new("Cloud")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    # single-sided: the game draws the cloud translucent without depth writes, and a double-sided
    # one showed its own far inside through it (murky, denser than meant)
    mat.use_backface_culling = True
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    me.materials.append(mat)

    dst = args.output.resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
    )
    print(f"[cloud] seed {args.seed}: {len(me.polygons)} faces → {dst} ({dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
