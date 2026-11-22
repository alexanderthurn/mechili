# Model viewer

A standalone page (not part of the game build) to look at any `.glb` — the game's
models under `assets/models/` and raw material here in `raw/` — play its clips and
pick the four the engine needs (walk / fire / idle / death).

    npm run viewer        # http://localhost:5180

- `raw/` — source models as exported (Tripo, all clips, full textures). Never loaded
  by the game; the game ships the cut, compressed copy in `assets/models/units/`.
- `recipes/` — one JSON per model: which source clip plays which role. Written by
  the page's W / F / I / D buttons, readable and editable by hand.

From raw to game (see `scripts/MODELS.md`): `scripts/glb-prep-clips.mjs` cuts the
clips, then WebP textures (1024²) and Draco. The Teutonic (`assets/models/units/teutonic.glb`):

    node scripts/glb-prep-clips.mjs misc/model-viewer/raw/teutonic-knight.glb out.glb \
      '{"hips":"mixamorig:Hips","clips":{"walk":{"from":"walk","loop":true},
        "fire":{"from":"box_01","start":0.2,"end":1.5},"death":{"from":"fall","start":0.9,"end":2.4}},
        "idleLoop":{"from":"cheer","min":11,"max":12.1,"loopFix":0.5}}'
    npx @gltf-transform/cli@4.1.1 resize out.glb t1.glb --width 1024 --height 1024 --filter lanczos3
    npx @gltf-transform/cli@4.1.1 webp t1.glb t2.glb --quality 80 --effort 60
    # Draco with the settings in scripts/compress-glb-draco.sh
