# Unit model pipeline

Game GLBs ship Draco-compressed with WebP textures. Rigged crowd units are drawn by
the instance pools with GPU skinning (`src/game/instancedSkin.ts`): a model opts in
with `"instancedSkin": true` and an `animation` block in `assets/data/models/<id>.jsonc`.

## Bringing in a rigged unit

1. **Plain copy for Tripo Studio** (it can't read Draco or WebP):
   `node scripts/glb-plain.mjs ~/Desktop/melodan-units-plain assets/models/units/*.glb`
2. Rig and animate in Tripo; export the GLB.
3. **Look at the rig** (generic bone names, which part each bone moves):
   `node scripts/glb-bones.mjs export.glb`
4. **Cut the clips** to the engine roles `walk` / `idle` / `fire` / `death`: trim long
   source clips to the part that matters, pin the hips (the sim moves the unit), ease
   loops closed. See the example at the top of `glb-prep-clips.mjs`.
5. **Compress**: `python3 scripts/glb-textures-webp.py --quality 80 out.glb`, then Draco
   with the settings in `compress-glb-draco.sh`.
6. **Config**: `yawDeg` from the rig's facing (the game wants −Z forward; Tripo
   models face +X by default), `death.fallLocal` from where the clip lays the body.

A rig nobody can animate by hand can be keyframed by script —
`glb-animate-crow.mjs` is how the crow rider's clips were made. A biped with no
idle gets one from `glb-make-idle.mjs` (a calm upper-body frame of another clip,
rest-pose legs, slow breathing) — that's the ogre's idle.

Hips are pinned in world space, so Z-up rigs (Tripo biped presets turn the root
−90° about X) work the same as Y-up Mixamo rigs.

## Mesh checks

- `node scripts/glb-holes.mjs <files>` — open loops (holes) and non-manifold edges
- `node scripts/glb-fill-holes.mjs in.glb [out.glb]` — close the small ones (dry run without `out`)
