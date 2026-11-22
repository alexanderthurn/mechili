#!/usr/bin/env python3
"""
Decimate a GLB with Blender's Decimate modifier (same mesh / UVs / materials).

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/decimate_glb.py -- \\
    --input misc/tripo-raw/high-poly/tree-oak.glb \\
    --output assets/models/scenery/tree-oak.glb \\
    --faces 12000
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    # Blender passes its own args before "--"
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    p = argparse.ArgumentParser(description="Decimate a GLB via Blender")
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument(
        "--faces",
        type=int,
        default=12000,
        help="Target triangle count for the whole scene (default 12000)",
    )
    p.add_argument(
        "--ratio",
        type=float,
        default=None,
        help="Optional Decimate ratio (0–1). Overrides --faces when set.",
    )
    p.add_argument(
        "--min-part-faces",
        type=int,
        default=None,
        help="Decimate each loose part (a cloud's puffs) on its own, never below this many faces"
        " — a small closed blob cut proportionally breaks open. The global --faces target is met"
        " as closely as the parts' floors allow. Implies welding with --merge first.",
    )
    p.add_argument(
        "--merge",
        type=float,
        default=None,
        help="Merge vertices closer than this (model units) before decimating — glTF splits"
        " vertices at every UV seam, and Decimate then collapses each side on its own and"
        " tears the surface apart. UVs stay per face corner, so the seams survive. E.g. 1e-5.",
    )
    return p.parse_args(argv)


def decimate_parts(bpy, obj, target: int, floor: int) -> None:
    """split into loose parts, cut each by one shared ratio but never below `floor` faces
    (smaller parts stay as they are), then join them back"""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    sizes = [len(o.data.polygons) for o in parts]
    want = lambda r: [n if n <= floor else max(floor, int(round(n * r))) for n in sizes]
    lo, hi = 0.0, 1.0
    for _ in range(40):  # the ratio whose kept faces meet the target
        mid = (lo + hi) / 2
        if sum(want(mid)) > target:
            hi = mid
        else:
            lo = mid
    goals = want(lo)
    print(f"[decimate] {len(parts)} parts, floor {floor}: ratio {lo:.3f} → {sum(goals)} faces (target {target})")
    for o, n, g in zip(parts, sizes, goals):
        if g >= n:
            continue
        mod = o.modifiers.new(name="Decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = g / n
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    src = args.input.resolve()
    dst = args.output.resolve()
    if not src.is_file():
        raise SystemExit(f"missing input: {src}")

    # fresh scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.import_scene.gltf(filepath=str(src))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no meshes in {src}")

    before = sum(len(o.data.polygons) for o in meshes)
    print(f"[decimate] {src.name}: {before} faces → target {args.faces}")

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if args.merge is not None:
            # weld the seams first so the surface collapses as one piece
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            n0 = len(bm.verts)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=args.merge)
            bm.to_mesh(obj.data)
            print(f"[decimate] {obj.name}: merged {n0 - len(bm.verts)} of {n0} vertices")
            bm.free()
        if args.min_part_faces is not None:
            decimate_parts(bpy, obj, args.faces, args.min_part_faces)
            obj.select_set(False)
            continue
        mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        if args.ratio is not None:
            mod.ratio = max(0.0001, min(1.0, args.ratio))
        else:
            faces = max(1, len(obj.data.polygons))
            # share the global face budget across meshes by current face weight
            share = faces / max(1, before)
            want = max(64, int(args.faces * share))
            mod.ratio = max(0.0001, min(1.0, want / faces))
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]  # parts were joined back
    after = sum(len(o.data.polygons) for o in meshes)
    print(f"[decimate] done: {after} faces ({100 * after / max(1, before):.2f}% kept)")

    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print(f"[decimate] wrote {dst} ({dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
