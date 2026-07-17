# Session Summary — Tactics & Battle Spells (2026-07-17)

What we built, fixed, and decided in this session, plus everything still open.
Roadmap lives in `TACTICS_PLAN.md`; this is the session record.

## 1. Sell became a tactic

- Removed the sell button from the unit menu; selling is now a 💰 entry in the
  left tactics strip: arm it (crosshair cursor), click one of your packs.
- Charges come from the Command Tower ability (max/round) AND from a round
  card ("Buyback Deal"). Used charges show greyed; undo restores them.
- A free sell charge is granted at round 1 for testing (`TEST_TACTIC_GRANTS`).

## 2. Bugs found & fixed along the way

- **Reload lost placed tactics** (oil placed + bolt bought → after reload only
  the bolt): dev/test tactic grants are not in the action log and were applied
  AFTER the replay — replayed actions failed validation and vanished silently.
  Grants now apply BEFORE hydrate's replay.
- **Wrong sell-button counts / all buttons highlighting**: double-subtraction
  in the strip math; armed flag applied to every entry of a tactic type.
  Both fixed (only one entry arms now — also for rally/oil).
- **Right-click reset could hit the wrong tactic**: rally/oil/spell stamp ids
  come from separate counters and could collide — the strip now passes the
  tactic id along with the stamp id.
- **Summons misbehaved** (crows stayed grounded, dwarves ignored terrain):
  they spawn after `placement.beginBattle()` and stayed in deployment mode —
  `setDeployment(false)` at spawn fixed both.
- **Out-of-log cheats documented**: KeyM (+1000 supply) and KeyU (spawn all)
  corrupt saves on reload (not in the action log; KeyU also shifts unit ids).
  Known, not yet fixed — see open points.

## 3. The solid tactic system (rails)

Everything is registry-driven in `src/game/tactics.ts` (how-to checklist at
the top of that file):

- Each TACTICS entry declares: `kind` ('placement' | 'oneShot'), `targeting`
  ('point' | 'two-point' | 'own-unit'), `cooldownRounds`, `radius`, `maxSpan`,
  `respectsSafeZone`, and a `spell` payload (delay + strike / spawn / zone /
  igniteCapsule).
- **Cooldowns are derived from the action log / stamp history** — zero extra
  state, so undo, save/reload, and multiplayer replay are correct by
  construction. Used in round R → ready in round R + 1 + cooldown.
- **Safe zone** = circles around the ENEMY's base buildings; validated in the
  dispatcher (not just the aiming UI) so peers can't bypass it. Red preview
  while aiming.
- One generic armed-click state machine; per tactic only the action payload
  (one switch case) and optional preview visuals.
- The tactics sidebar wraps into extra columns when it grows.

## 4. Locked design decisions

- Summons are **battle-only** (vanish after the battle).
- Safe zone around **enemy** buildings only; spells otherwise place anywhere.
- Per-spell **round cooldowns** instead of one-shot consumption
  (sell 0, rally 0, oil 1, meteor 3, …).
- Spell delay = counterplay: battle runs normally, units can march out of
  (or into) the marked area before the effect lands.

## 5. All nine battle spells implemented (mechanics)

| Spell | Behavior |
|---|---|
| ⚒ Summon Dwarves | point circle, safe-zone-blocked; 2 packs (~48) rise out of the soil one by one at +2s |
| 🐦 Summon Crow Riders | 2 flocks (~24) dive in from the sky onto combat altitude |
| 🔨 Hammer of the Gods | huge circle, 1000 dmg at +4s; ward domes absorb once, can break |
| ☄ Great Meteor | small circle, 3000 dmg at +4s |
| 🌩 Storm Call | wide circle; a bolt zaps a random unit every 0.7s for 10s |
| 🌠 Meteor Shower | wide circle; mini-strikes on random spots for 8s + ground fire |
| ☠ Poison Cloud | flat dps ticks to everything inside for 12s; seeps under wards; `poisonImmune` flag |
| 🧪 Acid Spill | two-point capsule (same look as oil, tinted green); 3% max-HP/s + corroded debuff (+25% damage taken) |
| 🐉 Dragon Attack | two-point path (wider + longer via `maxSpan`); whole corridor ignites at +5s |

Supporting systems: dormant-summon lifecycle (one-by-one materialize with
soil/feather bursts; battle can't end while summons are inbound), strike-vs-
ward-dome resolution, ticking zone scheduler with per-effect seeded rng,
capsule hazard containment, **visible burning on units** (from the existing
burn DoT), acid/dragon deploy capsules reuse the oil renderer with tints.

## 6. Determinism / multiplayer review (done this session)

- Manual review found and fixed 3 lockstep hazards: `Math.cos/sin` in summon
  scatter + meteor-shower impacts (→ rejection sampling), `Math.hypot` in
  `clampTacticEnd` and `pointInSafeZone` (→ correctly-rounded sqrt length).
- All spell randomness uses per-effect seeded streams; timing uses the fixed-
  step sim clock; summons spawn sorted by stamp id before the state snapshot.
- The battle-start `stateHash` exchange remains the desync safety net.

## 7. Commits (this session)

```
01860e7 tactics: solid extensible charge system
3b03404 tactics: battle spells — summons, strikes, ticking zones
59bcb06 tactics: acid capsule, dragon attack, per-tactic max span
34fd89a tactics: lockstep-determinism hardening for spells
b57ac8b tactics: summon entrances, acid = tinted oil capsule, sidebar columns
d246ff6 tactics: summons get battle prep — flyers climb, walkers ride terrain
```

Uncommitted: your one-line `weather.ts` tweak (cloudShadowOpacity).

---

# Open Points

## Visual pass (threejs-game-director — the big one)
- [ ] Hammer model + stamp animation; Great Meteor / Meteor Shower trails
- [ ] Dragon flyover cinematic (descend at the mountains → fire breath along
      the path → climb out the other side)
- [ ] Storm clouds + lightning integrated with the weather system
- [ ] Poison/acid cloud + puddle VFX (zone visuals during battle)
- [ ] Unit status VFX: corroded + poisoned tints/particles (burning is done)
- [ ] Spell markers should clean up once the effect fires (currently they
      stay visible through the whole battle)
- [ ] Nicer aim decals / safe-zone display

## Design questions to answer while playtesting
- [ ] Should surviving summons count toward the end-of-battle HP bite?
      (currently: yes)
- [ ] Should lightning/hammer/meteor hit base buildings? (currently: yes)
- [ ] Dormant (not yet materialized) summons are untouchable — keep?
- [ ] Acid skips flyers and structures; poison hits flyers — keep?
- [ ] Oil charge is currently reusable every round (stamps clear per round);
      you wanted "wait 1 round" — decide if oil should use the real cooldown
- [ ] Balance: all damages/radii/delays/tick rates/cooldowns/card costs are
      single numbers in tactics.ts / cards.ts, untuned
- [ ] Skeleton variant of Summon Dwarves ("later skeletons") — just a typeId
      + model swap once a skeleton unit exists

## System work
- [ ] Enemy AI never uses tactics/spells (single-player gap widens with every
      spell added) — needs a simple "use a held charge on a good cluster"
      heuristic
- [ ] Empirical two-client multiplayer desync test (stateHash would catch it,
      but it hasn't been exercised with spells yet)
- [ ] KeyM/KeyU dev cheats are not in the action log → corrupt saves on
      reload; fix = turn them into logged single-player-only actions
- [ ] Remove the free `TEST_TACTIC_GRANTS` before any release build
