# Battle Spells / Tactics — Expansion Plan

Plan for the new tactic family (spawns, strikes, hazards). Gameplay-first;
the visual/3D pass (models, cinematics) comes afterwards via the
threejs-game-director workflow, consuming this document.

## Locked design decisions

1. **Summons are battle-only.** Units spawned by tactics fight the current
   battle and vanish when it ends. They are sim actors, not packs — no XP,
   no items, no deploy-limit interaction, not part of next round's board.
2. **Safe zone = circles around the ENEMY's base buildings.** One global
   definition used by every tactic that opts in (`respectsSafeZone`).
   Derived from the base-building anchors/radii already in `map.ts`
   (BASE_ANCHORS) + a configurable margin. Shown as red circles while aiming.
3. **Placement anywhere outside the safe zone.** Spawns behind enemy lines
   are legal aggressive play; only the enemy base perimeter is protected.
   Mighty attack spells ignore the safe zone entirely.
4. **Per-tactic round cooldown instead of one-shot consumption.**
   Charges stay in `tacticInventory` permanently. Using one in round R makes
   it unavailable until round `R + 1 + cooldownRounds`:
   - `cooldownRounds: 0` → available again every round (sell, rally)
   - `cooldownRounds: 1` → skip one round (oil, acid)
   - `cooldownRounds: 3` → e.g. big meteor
   - `Infinity` → true one-shot
   Availability is DERIVED FROM THE ACTION LOG (uses of tactic X in rounds
   `> round − 1 − cooldown`), so undo, reload/replay and multiplayer get it
   for free — no new persistent state. The strip shows cooling charges
   greyed out with "ready in N rounds".

## Registry model (tactics.ts)

Each TACTICS entry becomes fully data-driven:

```
id, name, icon, description
targeting: 'point' | 'two-point' | 'own-unit' | 'none'
radius / width        — aim shape (point circle, capsule width)
respectsSafeZone      — spawn-likes true, attack spells false
cooldownRounds        — see above
effect:               — what the battle does with the committed stamp
  delaySeconds        — battle runs normally, effect lands at t = delay
  (per-effect config: damage, count, duration, dps, percentDps, amp, …)
```

Placement flow stays what it is today: during deploy the player stamps an
INTENT marker (like oil), right-click resets it, lock-in reveals it to the
opponent, battle start commits it. Coordinates quantized (`quantizeWorld`),
randomness only from seeded sim streams — never `Math.random`, never prefs.

## Shared infrastructure (work packages)

- **W1 Generic targeting.** `targeting` field drives one armed-click state
  machine (point / two-point / own-unit / none) replacing the per-tactic
  if-chain in `handleTacticGroundClick`. Per tactic only: action payload +
  preview visual. Includes safe-zone validation + red overlay while aiming.
- **W2 Cooldown availability.** Log-derived (`usedTacticCharges` scans a
  round window). Strip entries: available / cooling ("ready in N") / placed.
- **W3 Battle-effect scheduler.** Committed stamps become a plain-data list
  the sim consumes: each effect fires at `sim.elapsed >= delaySeconds`
  (single strike) or ticks over a duration (storm, meteors, clouds). One
  seeded rng stream per effect instance (`seedFrom(matchSeed, 'fx:'+id)`).
- **W4 Strike-vs-shield resolution.** One shared rule for all strikes:
  targets under a living ward dome are protected; the strike damages the
  ward stone's HP instead (it can break mid-effect). Reuses
  `livingShieldDisks`.
- **W5 Unit status effects.** Small per-actor status set with sim logic +
  VFX hook: `burning` (exists as damage via fire field — needs the visual),
  `poisoned` (flat dps, `poisonImmune` flag on unit types, default false),
  `corroded` (acid: %HP/s + takes bonus damage). Tint + particle emitter per
  affected pack.
- **W6 Summon lifecycle.** Battle-only actors spawned at t=delay, scattered
  in the circle (seeded), despawn at battle end. Decide crowd-limit
  interaction (`SOFT_CROWD_LIMIT`) when implementing.
- **W7 Hazard channels.** Acid joins the oil/fire grid as a channel
  (same stamping, holes under wards); poison cloud is a zone entity
  (airborne, affects flying, ignores ground grid).

## The spells

| Spell | Targeting | Safe zone | Cooldown | Effect (all numbers tunable in registry) |
|---|---|---|---|---|
| 1 Spawn Dwarves (later Skeletons) | point + radius | yes | 1 | at t=delay spawn `count` dwarves scattered in circle (W3, W6) |
| 2 Spawn Crow Riders | point + radius | yes | 1 | same, flying |
| 3a Hammer of the Gods | point, HUGE radius | no | 2–3 | single strike at t=delay: 1000 dmg to everything not shielded (W3, W4) |
| 3b Dragon Attack | two-point capsule (wider/longer than oil) | no | 3 | at t=delay the capsule catches fire (existing fire field); path defines the flyover direction for the later cinematic (W3, W7) |
| 3c Storm | point, wide radius | no | 2 | for `duration`: lightning hits random units in area every ~0.8 s, medium dmg; shields absorb & can break (W3, W4) |
| 3d Meteor Shower | point, wide radius | no | 2 | for `duration`: random ground impacts, splash dmg + ignite fire cells (W3, W4, W7) |
| 3e Poison Cloud | point + radius | no | 1–2 | zone for `duration`: flat dps to units inside unless `poisonImmune` (W3, W5, W7) |
| 3f Big Meteor | point, SMALL radius | no | 3 | single strike at t=delay: 3000 dmg (W3, W4) |
| 3g Acid | two-point capsule (= oil placement) | no | 1 | grid hazard: 3% max-HP/s for a period + corroded debuff (takes bonus dmg); visible on units (W5, W7) |

Design note on `delaySeconds`: the battle runs normally during the delay —
units march out of (or into!) the marked area, which is the counterplay.
"Watch the deployment for a few seconds, then the hammer falls."

## Determinism rules (multiplayer / replay)

- Every placement is a logged action with quantized world coords; no unit
  ids in these actions → nothing to add to `swapPerspective` (coords pass
  through; team flips). Verify per new action anyway (checklist in tactics.ts).
- All in-battle randomness (scatter, storm targets, meteor spots) from
  seeded per-effect streams; effect timing from `sim.elapsed` only.
- Sim never reads prefs/graphics settings. VFX read the sim, never the
  other way around.

## Build order

1. **Rails — DONE:** W1 targeting + safe zone, W2 cooldowns (sell/rally/oil
   migrated: sell 0, rally 0, oil via stamp expiry). Implemented:
   `targeting`/`cooldownRounds`/`radius`/`respectsSafeZone` in TACTICS;
   generic armed-click machine + `dispatchTacticUse` switch in game.ts;
   log-derived availability (`tacticUseRounds`/`availableTacticCharges` +
   `consumeTacticCharge` in the dispatcher); `inSafeZone` helper (UI-side).
   TODO with the first point-targeting action (W3): validate the safe zone
   in the DISPATCHER too — UI-side checks don't bind a hostile peer — and
   add the red safe-zone overlay while aiming.
2. **First two spells — DONE:** Summon Dwarves (W3+W6) and Great Meteor
   (W3+W4). Implemented: `spell` config in TACTICS (delay + spawn/strike);
   `placeSpell`/`removeSpell` actions with dispatcher-side safe-zone +
   cooldown validation; `spellStamps` history (never cleared — IS the
   cooldown record); summons = real packs flagged `summoned`, spawned
   seeded/sorted before the sim snapshot, riding the flank-spawn ramp
   (`summonDelayOf`), removed at battle end; `SpellStrike` scheduler in the
   sim with ward-dome absorption (dome eats the hit once, can break);
   spellVisuals.ts markers + aim circle (red when safe-zone-blocked).
   Placeholder impact = existing explosion event (particles + scorch).
   Note: surviving summons DO count toward the end-of-battle HP bite.
3. **Hammer + Crow Riders — DONE** (pure registry entries on the rails).
4. **Acid + Poison Cloud — DONE.** Poison = per-tick gas zone (ignores
   wards, `poisonImmune` unit flag, toxic-green marker). Acid ended up
   NOT a battle spell at all: after two revisions it's now a genuine
   third HazardField channel (`acidExpires`, round-based expiry) —
   technically identical to oil (same capsule stamp, same commit-at-
   battle-start moment, no delay, ward-stone blocking, ground texture
   channel), just a different per-step effect (percent-of-max-HP damage
   instead of a speed penalty) plus the `corrodedUntil` debuff
   (CORRODE_TAKEN_MULT stacks in `damageTakenMult`, so weapons AND burn
   hit harder). Its placement/aim/cooldown still ride the generic
   placeSpell/SpellStamp system (`usesSpellPlacement()` gate in
   tactics.ts) — only what happens at battle-start commit changed. Both
   oil and acid currently default to 1 round (`OIL_SPILL_DURATION_ROUNDS`
   / `ACID_SPILL_DURATION_ROUNDS` in fire.ts — tune there). Burning units
   are visible (FireFx.updateBurningActors). Still open from W5: corroded
   / poisoned VFX on units (visual pass).
5. **Storm + Meteor Shower — DONE** (SpellZone ticking effects, per-effect
   seeded rng; storm bolts pick random units, wards absorb per bolt;
   shower drops mini-strikes + ground fire).
6. **Dragon Attack — DONE mechanically** (SpellIgnite: capsule catches
   fire at the delay via overlapping fire stamps). The flyover cinematic
   is the visual pass's job.
7. **Visual pass (threejs-game-director):** hammer model + stamp anim,
   dragon flyover cinematic (mountain descent → fire breath → climb),
   storm clouds/lightning integrated with the weather system, meteor
   trails, poison/acid clouds and decals, unit status VFX
   (burning/poisoned/corroded), aim previews (red safe zone, area rings).
8. Round cards granting each spell (one entry each in cards.ts) + AI usage
   (simple "use a held charge on a good cluster" heuristic) when ready.
