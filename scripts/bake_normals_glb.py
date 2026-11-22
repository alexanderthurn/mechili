#!/usr/bin/env python3
"""
Bake a high-poly model's surface detail into a low-poly version's normal map (Blender, Cycles):
the low-poly keeps its triangles and UVs, its normal map is replaced by one baked from the
high-poly's shading (its geometry + its own normal map) — engraved symbols, grooves and edges
then catch the light though their geometry is gone. Same map size, so no extra memory.

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/bake_normals_glb.py -- \\
    --high misc/model-viewer/out/hammer-of-gods__0-original.glb \\
    --low  misc/model-viewer/out/hammer-of-gods__2000.glb \\
    --output misc/model-viewer/out/hammer-of-gods__2000-baked.glb

The low-poly should come from the high-poly (e.g. scripts/decimate_glb.py --merge), so the two
overlap. Rays are cast from a cage pushed out by --extrusion (a share of the model's size).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    p = argparse.ArgumentParser(description="Bake a high-poly's normals onto a low-poly GLB")
    p.add_argument("--high", required=True, type=Path)
    p.add_argument("--low", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--size", type=int, default=0, help="normal map size (default: the low-poly's own)")
    p.add_argument("--extrusion", type=float, default=0.02, help="cage push-out, share of the model's size")
    p.add_argument("--samples", type=int, default=4)
    return p.parse_args(argv)


def import_one(bpy, path: Path):
    """the file's mesh (joined into one) and everything the import brought (empties too)"""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    brought = [o for o in bpy.context.scene.objects if o not in before]
    meshes = [o for o in brought if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no mesh in {path}")
    if len(meshes) > 1:
        # one object to bake from / onto
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active if len(meshes) > 1 else meshes[0]
    return mesh, [o for o in brought if o.name in bpy.data.objects]


def normal_image_node(mat):
    """the Image Texture node that feeds a Normal Map node (the glTF importer's normal map)"""
    for link in mat.node_tree.links:
        if link.to_node.type == "NORMAL_MAP" and link.from_node.type == "TEX_IMAGE":
            return link.from_node
    return None


def main() -> None:
    import bpy
    from mathutils import Vector

    args = parse_args(sys.argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    high, high_all = import_one(bpy, args.high.resolve())
    low, _ = import_one(bpy, args.low.resolve())

    # model size → cage and ray distance
    corners = [low.matrix_world @ Vector(c) for c in low.bound_box]
    size = max((max(c[i] for c in corners) - min(c[i] for c in corners)) for i in range(3))

    mats = [s.material for s in low.material_slots if s.material]
    if not mats:
        raise SystemExit("the low-poly has no material")
    old = normal_image_node(mats[0])
    res = args.size or (old.image.size[0] if old and old.image else 1024)
    baked = bpy.data.images.new("baked_normal", res, res, alpha=False, float_buffer=False)
    baked.colorspace_settings.name = "Non-Color"
    # the bake writes into each material's ACTIVE image node
    targets = []
    for mat in mats:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = baked
        mat.node_tree.nodes.active = node
        targets.append((mat, node))

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.use_cage = False
    bake.cage_extrusion = size * args.extrusion
    bake.max_ray_distance = size * args.extrusion * 3
    bake.margin = 16
    bake.normal_space = "TANGENT"

    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    print(f"[bake] normals {res}² from {len(high.data.polygons)} onto {len(low.data.polygons)} faces, extrusion {bake.cage_extrusion:.4f}")
    bpy.ops.object.bake(type="NORMAL")

    # the baked map replaces the low-poly's own normal map (or becomes its first one)
    for mat, node in targets:
        img_node = normal_image_node(mat)
        if img_node:
            img_node.image = baked
            mat.node_tree.nodes.remove(node)
        else:
            nm = mat.node_tree.nodes.new("ShaderNodeNormalMap")
            node.image = baked
            mat.node_tree.links.new(node.outputs["Color"], nm.inputs["Color"])
            bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            mat.node_tree.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    # only the low-poly file's objects go out — the high-poly's empties (a dragon's MouthFireSpawn)
    # would otherwise ride along twice
    for o in high_all:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    # the low-poly's objects came in second and got Blender's ".001" suffix — give them their
    # own names back (the game finds markers like MouthFireSpawn by name)
    import re
    for o in list(bpy.data.objects):
        base = re.sub(r"\.\d{3}$", "", o.name)
        if base != o.name and base not in bpy.data.objects:
            o.name = base
    baked.pack()
    dst = args.output.resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(dst),
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,  # the game reads the map in the same tangent frame Blender baked it in
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print(f"[bake] wrote {dst} ({dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
