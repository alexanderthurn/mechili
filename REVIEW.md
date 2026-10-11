# Code review — 2026-10-11

Two reviews on top of `81b6fe55` (room work). The no-brainer fixes are in the same commit as this file. `tsc`, `check:content` and `check:det-math` all pass. Nothing has been tested in game yet.

---

## A. Room settings (every select, one by one)

### Verdict per setting

| Setting | Default | Verdict |
|---|---|---|
| Players | 1v1 | OK. It rebuilds Practice or re-hosts the room. **Fixed:** it never locked once someone joined (see A1). |
| Mode (Standard / Siege) | Standard | OK end to end. The attacker comes from `yearAttackerFromSeats` with a seeded coin toss, so all peers agree. Each side's wishes are added up in 2v2. |
| Victory (HP / Rounds) | HP | OK. Standard + Rounds uses side 0 as the tally side and a seeded tie-break. With Rounds, Commander HP does nothing (see open issue 2). |
| Horde | off | OK. **Fixed:** the short label was broken in about 12 locales (A3). |
| Pace | standard (Practice: long) | OK. **Fixed:** the closed-box label was always English (A2). |
| Round cards | off | OK. The label fix A3 applies here too. |
| Commander HP | 1× | OK. **Fixed:** the `sheet.commanderHpFixedOption` key was missing in all locales. |
| Money / Start money | 1× / +0 | OK. Values snap to the allowed options. |
| Stronghold | lifeline | OK; Siege skips the attacker's base. **Fixed:** the label was always English, and guests had no tooltip. |
| Terrain | standard | OK. **Fixed:** guests had no tooltip. Ignored when a Map is chosen. |
| Map | Generated | OK. Guests download the scenario before Start is allowed. |
| Fog | on | OK. It turns into `enemyIntel: 'visible'` on all peers, and the host relay uses the same rule. |
| Army chip | Standard | OK. The host can edit its own seat and the AI/open seats; a guest only its own. The host checks guest messages per connection and against `roomArmies()`. |
| Role chip (Siege) | Any | OK. The host can set any seat; a guest only its own. The host accepts it only in a Siege and turns invalid values into Any. |
| Avatar / MMR | — | OK. Cached per name, one redraw per result, no loop. |

### Fixes applied
1. **Players box never locked.** `showHostLobbySettings()` re-enabled it right after `refresh()` disabled it. The lock now runs after it.
2. **Reset button stuck on screen.** In a 2v2 room with guests, Reset stayed visible but couldn't reset anything. Locked selects no longer count when deciding whether to show it.
3. **Localisation:**
   - The Pace and Stronghold closed-box labels used English. New helpers `customGamePaceName()` and `strongholdModeName()` fix that.
   - The preset selects were built once at load. `fillLobbySettingOptions()` now rebuilds them when the language changes.
   - The Horde and Round-card short labels split on " — ". 12 locales used another separator, so the whole blurb showed; those are normalised and a few translation errors fixed. The CJK form "）—" is now accepted too.
   - `menu:waitingScenario` and `settings:sheet.commanderHpFixedOption` were added to all 31 locales.
4. **Guest tips** now cover Stronghold and Terrain.
5. **Dead code removed:**
   - `refreshYearLobbyOptions`, `syncSiegeFields`/`onShapeChange` and `CustomGameConfig.landscape`.
   - `lobbyYear {config,pick}` became `lobbySiege: boolean`. This also removes an extra roster redraw on every guest settings message.

### Open issues (your call)
1. **Medium:** an army pick on an open seat is lost when a human takes that seat. Kick or drop also resets army and role.
2. **Medium:** some settings do nothing in certain combinations, and the UI doesn't say so:
   - Commander HP with Victory=Rounds.
   - Terrain when a Map is chosen.

   Grey them out?
3. **Medium:** a Komtur-army seat still gets the room's Horde waves. Single-player Year turned the horde off when the Komtur attacked.
4. **Low:** every host refresh or guest settings message rebuilds the option lists and rescans maps (async). That can close a dropdown the host has open when a guest joins.
5. **Low:** if the host's saved map is missing locally, it shows in the box but is silently dropped on the next edit.
6. **Low:** changing an army or role doesn't clear the guests' Ready.
7. **Low:** a guest whose name isn't found in the roster assumes seat 1 for chip editability. This is cosmetic only, because the host applies changes per connection.
8. **Low:** the short label for HP `fixed:1` is just "1", which is easy to confuse with "1×".
9. **Info:** an MMR "not found" result is cached for the whole session.

---

## B. Walls, unit behaviour, performance

### How it works (short)
- **Geometry:**
  - Each wall becomes an axis-aligned `WallBox` every step (half 6.9 × 1.3, swapped when rotated). `top` is crown × model height.
  - Joined walls overlap about 1.8 at their shared end tile.
  - `routeBoxes` holds the walls plus a square around each base building.
- **Movement:**
  - `wallWaypoint` follows a Dijkstra route over box corners, replanned every 0.5 s or when the goal drifts.
  - `breachChoice` (melee) compares walking round with breaking through, with hysteresis. When it breaks through, `siegeWall` hits the first enemy wall on the line.
  - `pushOutOfWall` keeps units out of the stone.
- **Fire:**
  - `shotLoft` → `shotClears` samples the arc against relief, buildings and wall stone.
  - In flight, `wallOnSegment` stops shots below the crown, and a direct hit damages the wall.
  - Splash hits walls in full. `buildingDamageMult` is applied in `applyDamage`.
- **Ranged help:** `blockingWall` + `shootWall` when every arc is blocked; `trySiegeShot` on walls that friendly melee are breaching.
- **Posted archers:**
  - On a wall, the archer gets `cover`: reduced splash and front melee only.
  - On a building, the archer is `unaimable`.
  - Posted units die with their host.
- **Overlay:** marching squares over `shotCovers`, which only reads the sim. It is rebuilt only when its key changes.

### Fixes applied (`src/game/sim.ts`)
1. **Route-graph cache (main performance win).**
   - Before, each `planWallRoute` rebuilt the corners and tested every corner-to-corner edge against every box, about O(B³) per plan, every 0.5 s per blocked unit.
   - Corner-to-corner visibility is now memoised per walker radius and cleared when any route box changes.
   - The tests and their order are the same, so results are identical and it stays deterministic.
2. **No per-unit, per-step `routeBoxes.filter()` allocation** in `wallWaypoint`; a reused scratch array instead.
3. **Replan as soon as the wall being breached falls.** Before, units could keep hitting the next wall in line for up to 0.5 s.
4. **A ranged unit shooting a blocking wall now counts as making progress.** Before, after 3 s it "shunned" the foe behind the wall, dropped its target and flipped slide direction, and did this again every 3 s.

### Open issues
1. **High (lockstep risk):**
   - The wall `top` and the posted archer's `pinnedY` come from measuring the GLB model.
   - If one peer starts a battle before the wall model has loaded, crown height and archer height differ between peers, and so do shot outcomes. That means a desync.
   - Fix: give crown height and post height in world units in `wall.jsonc`, or freeze them into the battle-start data.
2. **Medium (melee strikes through walls):**
   - Only covered archers are protected by `wallBlocksMelee`.
   - A wall is 2.6 deep, so melee weapons with range of about 2.6 or more (ogre 3.4, knight 3) hit foes straight across the stone, and those foes often can't hit back.
   - Fix: reject melee targets whose line crosses a wall in `tryMeleeEngage`, `inReach` and `cleaveStrike`.
3. **Medium (overlay cost):**
   - `shotCovers` makes around 2,000 probes at range 30, a hitch of tens of ms on each selection change or when a wall falls.
   - In deployment it also constructs a new probe `BattleSim` every time.
   - Fix: a coarser first pass, and caching the probe sim.
4. **Low–medium (`siegeWall` and `breachChoice` disagree):**
   - The two pick their wall from different goals and skip lists.
   - A unit shoved inside a wall's padded box can choose the wall behind it and lean into the stone.
   - Fix: prefer `a.breachWall` while it is alive.
5. **Low (per-frame garbage):** `WallJoins.update`, the overlay key strings, and a new box per wall every step in `rebuildStructureList`.
6. **Low (goal pushed into a neighbour):** at a joint, the goal can be pushed out of one wall into the next. Fix: loop the push-out 2–3 times.
7. **Low (`breachDps` cost):** it scans all actors once per crossed wall per replan.
8. **Design notes:**
   - A melee unit in front of a wall still targets the posted archer and walks all the way round to his side.
   - The old big-actor swerve in `steerToward` adds on top of the wall waypoint near towers.
