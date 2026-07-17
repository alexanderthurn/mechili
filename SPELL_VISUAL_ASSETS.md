# Spell Visual Assets — Generation List

Source of truth for the tactics visual pass. Mechanics are done in
`src/game/tactics.ts`; this list is what still needs art (Tripo GLBs vs
engine/procedural VFX). Style: Melodan fantasy, readable silhouette,
**smart low-poly** GLB, same family as `*-fantasy.glb` / `crow-rider-fantasy-low.glb`.

Target dir: `assets/models/spells/`. Thumbs later if we want strip icons
beyond emoji.

**Credential probe:** `TRIPO_API_KEY=SET`  
**Model version:** `v3.1-20260211` + `--smart-low-poly`

---

## A. Tripo meshes (generate)

| # | Asset | Spells | Notes | Priority | Status |
|---|---|---|---|---|---|
| 1 | `hammer-of-gods.glb` | Hammer of the Gods | Huge divine warhammer, vertical stamp silhouette, stone+metal. Static mesh; stamp anim in engine. | P0 | **done** `d2968c11…` (3.2M) |
| 2 | `dragon.glb` | Dragon Attack | Western fantasy dragon, wings open / glide pose. Flyover path is engine cinematic. | P0 | **done** `5feca8a4…` (2.9M) |
| 3 | `meteor-great.glb` | Great Meteor | Single large flaming rock / iron meteor, glowing cracks. Trail + impact = particles. | P0 | **done** `6e4dfbbf…` (3.7M) |
| 4 | `meteor-shard.glb` | Meteor Shower | Smaller sibling of #3. Instanced for many impacts. | P0 | **done** `50ac2b4b…` (3.1M) |
| 5 | `storm-cloud.glb` | Storm Call | Low-poly thunderhead. Lightning bolts stay procedural. | P1 | **done** `142a3c63…` (1.0M) |
| 6 | `poison-cloud.glb` | Poison Cloud | Soft billowy toxic cloud mass. Tint in engine if needed. | P1 | **done** `203dbb84…` (473K) |
| 7 | `acid-puddle.glb` | Acid Spill | Optional — skip if tinted oil decal is enough. | P2 | deferred |

Raw Tripo downloads (pbr + preview + json) kept in matching subfolders under
`assets/models/spells/<name>/`. Clean GLBs sit at `assets/models/spells/<name>.glb`.

**Do not generate for summons:** dwarves + crow riders already have unit GLBs.
**Deferred / skip Tripo:** skeleton summon variant; acid puddle until playtest.

---

## B. Engine / procedural (no Tripo mesh)

| Item | Spells | Approach |
|---|---|---|
| Hammer stamp animation | Hammer | Drop + impact squash / camera shake + scorch |
| Meteor trail + impact | Great Meteor, Shower | Particle trail, explosion event, ground fire |
| Dragon flyover cinematic | Dragon | Path from stamp → descend → breath along capsule → climb out |
| Storm lightning bolts | Storm | Integrate with `weather.ts` + bolt flashes on tick targets |
| Poison / acid volume FX | Poison, Acid | Particles + ground tint; status tints on units |
| Burning on units | Fire / Dragon / Shower | Done (`FireFx.updateBurningActors`) |
| Marker cleanup | All | Hide/remove aim stamps once effect fires |
| Aim / safe-zone polish | All | Decals only — no new GLBs |

---

## C. Checklist

- [x] `hammer-of-gods.glb`
- [x] `dragon.glb`
- [x] `meteor-great.glb`
- [x] `meteor-shard.glb`
- [x] `storm-cloud.glb`
- [x] `poison-cloud.glb`
- [ ] `acid-puddle.glb` (optional / deferred)
- [x] Wire hammer stamp cinematic (`hammerFx.ts`)
- [ ] Wire loaders + remaining spell cinematics / FX (director pass)
