# Walls back to simple: target marks, plus the gate

Status: plan, nothing built yet. 2026-10-11.

## Goal

The units go back to the basic rule:

1. **Target:** the nearest enemy they can attack.
2. **Approach:** walk toward it.
3. **Attack:** hit it, and keep that target as long as it stays within reach.

Walls (and the new gate) are normal units again, with two differences:
- they are **obstacles** that units walk round. A gate lets its own side through.
- by default they are **not a target**. A player's mark, or an auto-mark when a pack is walled in, makes one a target for that player. The horde attacks all of them.

All the automatic wall weighing goes.

## Rules

1. **Walls are obstacles.**
   - Ground units walk round them: the route planner, plus push-out from the walkers' box (stone and walkway).
   - A shot stops in the stone below the crown, and a shot that clears the crown flies over.
2. **Whether something is a target is a general per-seat property** of every unit and building (see Data).
   - Its default comes from the unit type: `"target": true` for everything, `false` for the wall and the gate.
   - **A mark** sets it for the marking seat only. An ally's units are not affected.
   - Both sides see marks.
   - Targeting has no wall rule. It asks only "is this a target for me?" (`targetFor`).
3. **Horde: monsters, nothing to think about.**
   - For horde units, every wall and gate is always a target (`targetFor` says yes).
   - No marks, no auto-marks, no checks per wave. They take whatever is nearest, wall or not.
4. **Distance to a wall:**
   - Every distance is measured from the target's **aim point**.
   - For a wall, the aim point is the nearest point on its middle line, clamped along its length, with radius = its half depth.
   - For every other unit it's the centre, as before.
   - Everything after that (choosing a target, approaching, reach, the hit itself) stays as it is.
5. **Keeping the target:**
   - Unchanged: a unit keeps its target as long as it stays within reach.
   - **No exception for walls at first.** A unit at a marked wall keeps hitting it until it falls, melee too; this is to be tried in a test.
   - If melee should defend themselves, the possible rule is "for melee, a foe within reach beats a marked wall", but only if the test shows it's needed.
6. **Lifetime:** until removed. Walls come back every round, and so do their marks.
7. **Cost and limit:** free and unlimited (for now).
8. **Auto-mark when walled in** (player seats and bot seats only, **once at battle start**):
   - **Per pack:** can it walk to any enemy?
     - Walls its seat has marked count as open, so a manual mark is already a way out.
     - Its own side's gates count as open; they're open for it anyway.
   - **If it can't get out:** it picks the first enemy wall on the straight line to its nearest enemy. If the line crosses several, it picks all of them in order.
   - **Merge per side:**
     - packs that pick the same wall mark it once;
     - of two picked walls that are close together (`AUTO_MARK_MERGE`, about one wall length, to be tuned), only the one more packs picked is kept;
     - packs standing together thus gather on one wall, while packs far apart each get their own.
   - **Afterwards:** each unit takes its nearest marked wall, by the normal rule. Units that appear during the battle obey the marks already set, so they need no check of their own.
   - **Own walls are never marked or hit.** Whoever walls themselves in stays stuck.
   - Auto-marks last for **this battle only**. They are set on the battle's units, never stored as the player's marks, and calculated again next battle.
9. **Gate:**
   - **A second wall type, `gate`.** Everything is like the wall (shape, HP, price, upgrade, walkway, posts, joining with walls), except this:
     - **Its own side's units walk through it**, like through open ground. That's all of its team: own units, allies, and enemies converted to its side (`actorTeam`).
     - **For the enemy it's a wall:** an obstacle, not a target, markable, and attacked by the horde.
   - **Shots:** like the wall, the stone below the crown stops shots from both sides. The gate is closed for shots; only walkers pass. Archers posted on it shoot over it, as on the wall.
   - **Model:** for now the wall's model (`"modelId": "wall"`). You'll build the wooden gate later. Until then it looks the same as the wall on the board; you tell them apart by the name in the info panel.

## Decisions

- **Marking:** select the enemy wall or gate; its info panel shows a "Target" toggle, like Upgrade and Post on own walls.
- **Bot seats:** no marks of their own; they rely on the auto-mark when walled in.
- **Horde:** walls and gates are always targets for it (Rule 3).
- **Old automatic wall logic:** delete it, no flag. It stays in git history at `46c94387`.
- **Archers on a marked wall:** no special case, the nearer target wins (wall or archer), measured as usual.
- **Melee defend:** left out for now (fewer exceptions). Test first, then decide.
- **Gate price:** the same as the wall (50, upgrade 25).
- **Bots** don't build gates (later).
- **Commits:** one per step of the order of work, on `horde`, once `tsc` and the checks pass.
- **Testing:** everything built in one go, then tested as a whole.
- **A fallen marked wall** keeps its mark; it comes back with the wall next round.

## Data

```jsonc
// unit type (units.ts UnitType, data files): omit = true
"target": false,   // wall.jsonc and gate.jsonc
// in the "wall" block, gate.jsonc only: its own side walks through
"wall": { …, "gate": true }
```

```ts
// units.ts, on Unit (any unit or building): one entry per player seat
targetBy: boolean[];   // starts as type.target for every seat; a mark flips the marking seat's entry
```

- **A mark** = an entry that differs from the type's default. "Remove the mark" = set it back to the default.
- **`targetFor(target, actor)`**, the only place targeting asks:
  - horde actor and `target.unit.type.wall`: yes;
  - otherwise the entry for the actor's seat (`actorSeat`), with auto-marks taken from the battle copy (see Sim).
- **Room to grow:**
  - Entries can later become `boolean | TargetFilter`, for example only artillery: `{ kind: 'ranged' }`, `{ kind: 'types', ids: [...] }`.
  - Only `targetFor` changes then.
  - Different values per seat are already built in.
- **Sim:**
  - **Battle copy:** at battle start, each actor gets its own copy of `targetBy`. Auto-marks write only there, never into the persistent `Unit`.
  - **Targeting:** walls keep `extra` (immunities); only targeting checks `targetFor` (Code check 1).
- **Actions (`actions.ts`, deployment):**
  - `setTargetMark { team, targetId, on }`.
  - Valid only on an enemy wall or gate that exists. It's a general property, but the UI only offers walls for now.
  - It goes through the normal action log, so all peers agree.
- **Fog:**
  - The enemy's frozen packs work because their data sits on their own units. An enemy mark, however, sits on **my** wall, which is never hidden from me.
  - So, just like the enemy's items and tactics (`captureEnemyIntelSnapshot` in `game.ts`): at deployment start, freeze the list of enemy marks.
  - While the enemy is hidden by fog, show that frozen list; after my deployment ends (`revealEnemyDeployIntel`), show the live one.
  - My own marks and my ally's are always shown live.
- **Sync:** reconnect replays the action log, so marks arrive by themselves. Only the state hash at battle start gets `targetBy`.
- **Editor and scenario:** later. `SceneUnit.targetBy` is optional.

## Code check (2026-10-11)

1. **Keep `extra` on walls and gates.**
   - In the sim, `extra` mostly means immunity: no burning, no EMP, no spells, no death talents, no cleave, no rays.
   - Only targeting swaps `extra` for `targetFor`:
     - `closestEnemy` (`cacheOk` and the search);
     - the `stillOk` checks of the convert ray and ramp beam (`sim.ts:7969`, `8106`);
     - the beam targets (`sim.ts:8296`).
2. **Search:**
   - `closestEnemy` searches a grid by **centre point** and stops early once further rings can't beat the best.
   - A wall's nearest point can be 10.9 from its centre, so it would be found too late or not at all.
   - So walls stay out of that grid (`targetHash`) and are checked in their own small list (`wallBoxes`), measured from the aim point, only those `targetFor` allows.
3. **Aim point:**
   - `sim.ts` reads `target.x/z` in 85 places, but only about a dozen of them are about the current target of a unit:
     - the step loop (`tdx`/`tDist`), `closestEnemy` (`inWeaponRange`), `approachGoal`;
     - `tryMeleeEngage`, the reach check in `resolveAttackPending`, `strikeMelee` (hit point);
     - `planShot` / `shotLoft` (aim), `trackProgress`.
   - Those get `aimPoint`. Spells, splash and the like don't need it.
   - The aim point also keeps the approach on the unit's own side of the wall, since it is the nearest point of the stone.
4. **Sync is free:** the action log carries `setTargetMark`; only the state hash needs it.
5. **Walled-in check, once at battle start:**
   - `planWallRoute` caches its corner graph, but the check needs a side's marked walls and own gates counted as open.
   - So it builds an uncached graph per side, once. The horde doesn't need it.
6. **Hits on walls work already:**
   - Shots that hit stone damage the wall, including splash and `buildingDamageMult`.
   - `strikeMelee` → `applyDamage` takes walls too.
   - The hit code from `shootWall` / `siegeWall` therefore isn't needed; the normal fire and strike paths do it.
7. **Archers on a marked wall:** unchanged. They die with their wall (`hostUnitId`), and cover and `wallBlocksMelee` stay.
8. **Gate: walking through per team.**
   - `routeBoxes` is one list for everybody today. A gate needs a list **per team** that leaves out that team's own gates.
   - The route graph cache (`routeGraphs`) is then keyed by radius **and** team.
   - `pushOutOfWall` skips the actor's own gates.
   - `wallWaypoint` (the goal push-out and `ends`) uses the actor's team list.
   - Shots stay unchanged (`wallBoxes`, both sides). With the old breach logic gone, there's less code to adapt.
9. **Gate: shop and data:**
   - `gate.jsonc` is a copy of `wall.jsonc` with `"modelId": "wall"`, `"gate": true` and its own name.
   - It's added to `DEFAULT_BOARD_EXTRAS` (`settings.ts`) and `pack.jsonc`, and uses the wall's icon.
   - Code that asks `type.wall` treats the gate as a wall: placement, joining, walkway, posts, upgrades. Only walking through is new.
   - Checked: the only place that names the wall by id is `DEFAULT_BOARD_EXTRAS`. The `'wall'` in `map.ts` and `terrainShapes.ts` is a terrain shape and has nothing to do with it.

## Order of work

1. **Data and action:**
   - `UnitType.target` and its schema;
   - `Unit.targetBy`;
   - `setTargetMark` with validation;
   - hash.
2. **Sim targeting:**
   - `targetFor`, including the horde rule, in place of the `extra` check in targeting only;
   - walls in their own list next to the grid search (Code check 1 and 2);
   - `aimPoint(target, from)` at the target sites (Code check 3).
3. *(Melee defend: only if the test shows it's needed, see Rules 5.)*
4. **Auto-mark** once at battle start, per side, with the merge.
5. **Remove the old wall logic:**
   - `breachChoice` and `breachDps`, and `BREACH`;
   - `rangedBreachWorth`, `weighRangedBreach`, `rangedDetourSeconds` and `RANGED_BREACH`, plus the cache fields `worth*` and `detour*`;
   - the `blockingWall` branch in the step;
   - `trySiegeShot`, `breachMarks`, `siegeShotWall` and `prevSiegeShotWall`;
   - `breachFirst` (unit field, ballista data, `canShootWall`);
   - `postedWallInRange` and `findPostedWall`; the player now marks the wall under the archer instead;
   - `siegeWall` and `wallWaypoint`'s `'walled'` result. Walled in now means auto-marked, or stuck.
6. **Gate:**
   - `gate.jsonc`, `"gate": true`, shop entry, icon, and the name "Gate" in every locale;
   - per-team route lists, the graph cache keyed by team, push-out (Code check 8).
7. **UI:**
   - a mark/unmark button on an enemy wall or gate during deployment, labelled "Target" in English (translated in every locale), using any existing icon as a placeholder; you'll pick the final one later.
   - **Marker during deployment:** a red 3D arrow, the yellow upgrade arrow (`updateLevelArrows` in `placement.ts`: box shaft plus four-sided pyramid head) built again in red.
     - It lies just above the ground in front of the wall, on its front side, the side facing the marking seat, at the wall's middle.
     - It points horizontally at the wall and bobs toward it.
     - The yellow upgrade arrow stays above the wall, pointing down from overhead, so the two don't get in each other's way.
     - One red arrow per marking seat. If two seats mark the same wall, the arrows sit side by side.
     - Own marks are removable through the wall's button; the opponent's are display only.
   - **In battle:** the arrow stays until the wall falls, but is hidden in cinema mode (Shift+C).
   - Auto-marks are shown at battle start, in the same style but fainter.
8. **Update `REVIEW.md`:** the open wall points that no longer apply.

## Open

- `AUTO_MARK_MERGE`: how close counts as "close together" (start at about 22, one wall length).
- Later: the bot setting marks itself and building gates.
- Later filters per seat entry, and what a mark means on normal targets ("prefer", "only").
- Later: the gate's own model (wood).
