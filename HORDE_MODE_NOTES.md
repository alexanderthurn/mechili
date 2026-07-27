# Horde / forest walk-in — notes

Saved before reverting the SP cheat prototype. Ideas + what we learned from trying it.

## Goal

Make horde-style play feel different: enemies come from **outside** the board (forest / meadow), not only from the deploy zone. Blood and spawn should eventually work in a fringe under the first trees if we widen the board a bit.

## What the board / systems allow today

| System | Off-board? |
|--------|------------|
| Sim movement | Unclamped XZ — units can leave the AABB |
| Pathfinding | None — direct seek + separation |
| Trees / rocks | Visual only — no collision |
| Blood / sand / scorch | **Board wear mask only** — stamps off-canvas or on outer meadow are invisible |
| Oil / fire / acid | Hazard grid is board-sized |
| Unit seating Y | Was board relief only; outer hills need `worldHeightAt` (board + outer) |
| Deploy / buy spawn | Cell + `inBounds` |

**Blood specifically:** `stampBlood` does not reject off-board coords, but the wear texture only covers the battle ground mesh. Outer meadow shader does not sample that mask → **no visible blood in the deep forest**.

## Design options discussed

### 1. Widen the board a little (preferred cheap path)

- Grow `MapSize` by ~1–3 cells (~4–12 wu) past today’s edge.
- Lower forest `keepOut` so the **first trees sit on that fringe**.
- Blood, spawn, oil all work there automatically.
- Keep deep forest atmospheric only — don’t make the whole meadow playable.
- **Deploy:** raising `zoneRows`/`zoneCols` also grows deploy; a non-deploy “rim” may be needed later if deploy should stay the same size.

### 2. Forest = entrance only

- Spawn just outside the rim, march onto the board.
- Blood starts once they die **on** the field.
- Least engine work; good enough for a first horde mode.

### 3. Full forest battlefield

- Outer wear mask + hazards + walkability — **large** job. Not recommended first.

## Prototype that was tried (SP cheat `H`)

Intended as a local stress / feel test, not shipping netcode.

### Behaviour

1. Spawn ~**400 solo wild dwarves** on the **enemy** team only (not both — otherwise they fight each other outside).
2. Positions: random angle + radius in a ring past the board (`outNear`…`outFar`), skip deep lakes (`worldHeightAt < -0.5`).
3. Each unit was a **1×1 formation** copy of the dwarf type (not packed 8×3 armies) so they read as wildlife, not parade lines.
4. Marked `summoned` (cleared after battle) + `marchIn`.
5. Camera bounds opened (`halfW/H + 160`) so you can pan into the forest.
6. Worked in deploy (then start battle) or mid-battle via `BattleSim.injectUnit`.

### Performance: `marchIn` state

While **outside** the playable AABB (`|x| > halfW` or `|z| > halfH`):

- Only move toward **board center** (no enemy search).
- Skip spatial hash / target hash / soft crowd / overlaps.
- Untargetable (not in target hash); no footprint stamps.
- Not counted toward soft-crowd mobile limit.

Once inside the board AABB → clear `marchIn` → **normal combat AI**.

### Code touchpoints (for re-implementation)

- `Unit.marchIn` flag
- `Actor.marchIn` in `sim.ts` — AI early-out, hash skips, `injectUnit`
- `PlacementController.spawnAtWorld(type, team, x, z)` — free-world, no grid occupancy
- `groundSupportAt` → include `outerHeightFn` so feet sit on outer hills
- `Game.cheatHordeTest()` on `KeyH` (SP only, like `U`)

### Lessons from the test

- **Both teams outside** → they murder each other in the trees; AI-only spawn for a walk-in test.
- **Packs** look like organized armies; **solo 1×1** scatter feels more “wild”.
- Without `marchIn`, hundreds of off-board seekers + collision destroy perf.
- They still **walk through trees** until you add corridors or collision.
- Seating without outer height → float/sink on hills.

## Suggested next steps (when revisiting)

1. Decide: rim-widened board vs spawn-just-outside only.
2. If rim: bump `STANDARD_MAP` / settings + tune `keepOut` / `beltNear` in `scenery.ts`.
3. Reintroduce `marchIn` (or a proper “approach” phase) for wave spawns.
4. Optional: spawn lanes / thinned trees on approach bearings.
5. Keep blood story simple: stains on board (+ rim if widened); ignore deep forest gore.

## Related files

- `src/game/map.ts` — `MapSize`, wear mask, heights
- `src/game/scenery.ts` — `keepOut`, `beltNear`, `terrainHeight`, `registerOuterHeight`
- `src/game/sim.ts` — seek AI, hashes, overlaps
- `src/game/placement.ts` — spawn / cells
- `src/game/fire.ts` — hazard field size
- `TEAM_MODES_PLAN.md` — broader mode plans (not forest-specific)
