#!/usr/bin/env python3
"""
Bake a single camera-facing billboard PNG (RGBA) from a tree/bush GLB.

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/bake_tree_billboard.py -- \\
    --input assets/models/scenery/tree-oak.glb \\
    --output assets/textures/scenery/billboard-oak.png \\
    --size 512
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--size", type=int, default=512)
    return p.parse_args(argv)


def main() -> None:
    import bpy
    from mathutils import Vector

    args = parse_args(sys.argv)
    src = args.input.resolve()
    dst = args.output.resolve()
    if not src.is_file():
        raise SystemExit(f"missing input: {src}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.import_scene.gltf(filepath=str(src))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no meshes in {src}")

    # World bounds of all imported meshes
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    center = (mins + maxs) * 0.5
    size = maxs - mins
    height = max(size.z, 0.01)
    radius = max(size.x, size.y, height) * 0.55

    # Simple sun + fill so albedo reads clearly
    sun_data = bpy.data.lights.new(name="Sun", type="SUN")
    sun_data.energy = 2.5
    sun = bpy.data.objects.new(name="Sun", object_data=sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(30))

    # Orthographic camera looking from +Y (front), upright Z-up Blender → tree stands up
    cam_data = bpy.data.cameras.new("BillboardCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(size.x, size.z) * 1.15
    cam = bpy.data.objects.new("BillboardCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Place camera in front of the tree (Blender: Z up, -Y toward camera for "front")
    cam.location = (center.x, center.y - radius * 2.4, center.z)
    # Aim at center
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(dst)

    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[billboard] wrote {dst} (bounds h={height:.2f} w={max(size.x, size.y):.2f})")


if __name__ == "__main__":
    main()
