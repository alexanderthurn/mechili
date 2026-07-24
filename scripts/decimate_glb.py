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
    return p.parse_args(argv)


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
